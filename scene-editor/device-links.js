import * as THREE from 'three';
import { placementIconUrl } from './catalog-utils.js';

export function getDevicePropPath(root, path) {
  const parts = String(path || '').split('.');
  let cur = root;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part.replace(/\[\]$/, '')];
  }
  return cur;
}

// Resolves Device-typed field references (single or Array-of-struct) between placed items into
// {from, to} pairs, used both for the AI-path arrow visualization and the logic graph edges.
export function getDeviceFieldConnectionsForItems(items, catalog) {
  const connections = [];
  const itemList = items || [];
  // Map "objectId:deviceIndex" -> item, built once, so device-ref lookups below are O(1)
  // instead of an Array.find scan per device-link field (matters with many placed devices).
  const itemByDeviceRef = new Map();
  for (const item of itemList) {
    if (!item.ueObj || item.ueObj.deviceIndex == null) continue;
    itemByDeviceRef.set(`${Number(item.ueObj.objectId)}:${Number(item.ueObj.deviceIndex)}`, item);
  }
  const resolveDeviceRef = ref => itemByDeviceRef.get(`${Number(ref.objectId)}:${Number(ref.deviceIndex)}`);
  for (const fromItem of itemList) {
    if (!fromItem.ueObj.devicePropertyData) continue;
    const dev = catalog.devices[String(fromItem.ueObj.objectId)];
    if (!dev?.fields) continue;
    let props;
    try { props = JSON.parse(fromItem.ueObj.devicePropertyData); } catch { continue; }
    for (const field of dev.fields) {
      if (field.type === 'Device') {
        const val = getDevicePropPath(props, field.path);
        if (val?.objectId != null && val?.deviceIndex != null) {
          const toItem = resolveDeviceRef(val);
          if (toItem && toItem !== fromItem) connections.push({ from: fromItem, to: toItem });
        }
      }
      if (field.type === 'Array') {
        const arr = getDevicePropPath(props, field.path);
        if (!Array.isArray(arr)) continue;
        // Array whose elements ARE Device refs directly (e.g. checkpointList[]).
        // Generate sequential connections: manager->cp[0]->cp[1]->... to show the ordered path.
        const elemDevField = dev.fields.find(cf => cf.path === `${field.path}[]` && cf.type === 'Device');
        if (elemDevField) {
          const resolved = arr
            .map(entry => (entry?.objectId != null && entry?.deviceIndex != null) ? resolveDeviceRef(entry) : null)
            .filter(Boolean);
          if (resolved.length > 0) {
            if (resolved[0] !== fromItem) connections.push({ from: fromItem, to: resolved[0] });
            for (let i = 0; i < resolved.length - 1; i++) {
              if (resolved[i] !== resolved[i + 1]) connections.push({ from: resolved[i], to: resolved[i + 1] });
            }
          }
          continue;
        }
        // Array of structs containing Device fields.
        const childDevFields = dev.fields.filter(cf => cf.path.startsWith(`${field.path}[].`) && cf.type === 'Device');
        for (const childField of childDevFields) {
          const childKey = childField.path.split('[].')[1];
          for (const entry of arr) {
            const devRef = getDevicePropPath(entry || {}, childKey);
            if (devRef?.objectId != null && devRef?.deviceIndex != null) {
              const toItem = resolveDeviceRef(devRef);
              if (toItem && toItem !== fromItem) connections.push({ from: fromItem, to: toItem });
            }
          }
        }
      }
    }
  }
  return connections;
}

export function getObjectIconUrl(objectId, catalog) {
  const entry = catalog.objects[String(objectId)] || catalog.devices[String(objectId)];
  return placementIconUrl(entry);
}

const _arrowUp = new THREE.Vector3(0, 1, 0);
const _arrowDir = new THREE.Vector3();
const _arrowPos = new THREE.Vector3();
const _arrowQuat = new THREE.Quaternion();
const _arrowScl = new THREE.Vector3();
const _arrowMat = new THREE.Matrix4();
const _arrowConeGeo = new THREE.ConeGeometry(0.5, 1, 12); // shared unit cone, tip at +Y

// Manages the blue line+arrow visualization of Device-field connections (AI travel paths etc.)
// between placed items in the 3D scene.
export function createDeviceLinkController({ scene, getConnections, getShowAiPaths }) {
  let deviceLinkGroup = null;
  let deviceLinkLines = null;
  let deviceLinkArrows = null;

  function dispose() {
    if (!deviceLinkGroup) return;
    scene.remove(deviceLinkGroup);
    deviceLinkLines?.geometry.dispose();
    deviceLinkLines?.material.dispose();
    deviceLinkArrows?.dispose();
    deviceLinkArrows?.material.dispose();
    deviceLinkGroup = null;
    deviceLinkLines = null;
    deviceLinkArrows = null;
  }

  function update() {
    if (!scene) return;
    const connections = getConnections();
    const n = connections.length;
    if (!n) { dispose(); return; }

    // Reuse line/arrow buffers across frames (e.g. a drag) when the connection count is unchanged -
    // only the endpoints move - and rebuild only when links are actually added/removed.
    const needed = n * 2;
    if (!deviceLinkLines || deviceLinkLines.geometry.getAttribute('position').count !== needed) {
      dispose();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(needed * 3), 3));
      deviceLinkLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x4da6ff, transparent: true, opacity: 0.55, depthTest: false }));
      deviceLinkLines.renderOrder = 1;
      deviceLinkArrows = new THREE.InstancedMesh(_arrowConeGeo, new THREE.MeshBasicMaterial({ color: 0x4da6ff, transparent: true, opacity: 0.9, depthTest: false }), n);
      deviceLinkArrows.renderOrder = 2;
      deviceLinkArrows.raycast = () => {};
      deviceLinkGroup = new THREE.Group();
      deviceLinkGroup.add(deviceLinkLines, deviceLinkArrows);
      scene.add(deviceLinkGroup);
    }
    const pos = deviceLinkLines.geometry.getAttribute('position');
    let i = 0, k = 0;
    for (const { from, to } of connections) {
      const a = from.group.position, b = to.group.position;
      pos.setXYZ(i++, a.x, a.y, a.z);
      pos.setXYZ(i++, b.x, b.y, b.z);
      // Arrowhead near the destination, pointing from->to, sized to the segment length (clamped).
      _arrowDir.subVectors(b, a);
      const len = _arrowDir.length() || 1;
      _arrowDir.multiplyScalar(1 / len);
      const h = Math.min(Math.max(len * 0.12, 1.5), 40);
      _arrowQuat.setFromUnitVectors(_arrowUp, _arrowDir);
      _arrowPos.copy(b).addScaledVector(_arrowDir, -h * 0.5); // so the cone tip lands on the destination
      _arrowScl.set(h * 0.5, h, h * 0.5);
      _arrowMat.compose(_arrowPos, _arrowQuat, _arrowScl);
      deviceLinkArrows.setMatrixAt(k++, _arrowMat);
    }
    pos.needsUpdate = true;
    deviceLinkLines.geometry.computeBoundingSphere();
    deviceLinkArrows.instanceMatrix.needsUpdate = true;
    deviceLinkArrows.computeBoundingSphere();
    deviceLinkGroup.visible = getShowAiPaths();
  }

  function setVisible(visible) {
    if (deviceLinkGroup) deviceLinkGroup.visible = visible;
  }

  return { update, dispose, setVisible };
}
