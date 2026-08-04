import * as THREE from 'three';
import {
  threePosToUe4,
  threeQuatToUe4,
  threeScaleToUe4,
  ue4PosToThree,
} from './coords.js';

export function clonePlain(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function makePastedObject(source, {
  offsetCm = 100,
  isDeviceObjectId,
  nextDeviceIndex,
} = {}) {
  const clone = clonePlain(source);
  clone.spawnTransform ??= {
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    translation: { x: 0, y: 0, z: 0 },
    scale3D: { x: 1, y: 1, z: 1 },
  };
  clone.spawnTransform.translation ??= { x: 0, y: 0, z: 0 };
  clone.spawnTransform.rotation ??= { x: 0, y: 0, z: 0, w: 1 };
  clone.spawnTransform.scale3D ??= { x: 1, y: 1, z: 1 };
  clone.spawnTransform.translation.x = Number(clone.spawnTransform.translation.x || 0) + offsetCm;
  if (isDeviceObjectId?.(clone.objectId)) {
    clone.deviceIndex = nextDeviceIndex?.(clone.objectId) ?? 0;
    if (clone.userDeviceName) clone.userDeviceName = `${clone.userDeviceName} Copy`;
  } else {
    clone.deviceIndex = -1;
  }
  return clone;
}

export function makePatternClipboardPayload(type, tool, templates) {
  return {
    type,
    objectId: tool.objectId,
    templates: clonePlain(templates),
    params: clonePlain(tool.params || {}),
    position: { x: tool.group.position.x, y: tool.group.position.y, z: tool.group.position.z },
    quaternion: {
      x: tool.group.quaternion.x,
      y: tool.group.quaternion.y,
      z: tool.group.quaternion.z,
      w: tool.group.quaternion.w,
    },
  };
}

// rootPos is the object's true root position in Three space (item.group.position is the editor PIVOT
// for mesh items, which differs from the root by the mesh-centre offset). Anchor/relative/translation
// must all be root-based or pasted mesh objects scatter by their per-object pivot offset.
export function makeObjectClipboardSource(item, rootPos) {
  const source = clonePlain(item.ueObj);
  source.spawnTransform ??= {};
  source.spawnTransform.translation = threePosToUe4(rootPos || item.group.position);
  source.spawnTransform.rotation = threeQuatToUe4(item.group.quaternion);
  source.spawnTransform.scale3D = threeScaleToUe4(item.group.scale);
  return source;
}

export function makeObjectsClipboardPayload(copyItems, anchorItem, positionForItem = item => item.group.position) {
  const anchorV = positionForItem(anchorItem);
  const anchor = { x: anchorV.x, y: anchorV.y, z: anchorV.z };
  return {
    type: copyItems.length === 1 ? 'object' : 'objects',
    anchorSpace: 'three',
    anchor,
    objects: copyItems.map(item => {
      const t = positionForItem(item);
      return {
        source: makeObjectClipboardSource(item, t),
        relativePosition: {
          x: Number(t.x || 0) - Number(anchor.x || 0),
          y: Number(t.y || 0) - Number(anchor.y || 0),
          z: Number(t.z || 0) - Number(anchor.z || 0),
        },
      };
    }),
  };
}

export function objectClipboardEntries(payload) {
  if (payload.objects?.length) {
    const rawAnchor = payload.objects[0]?.spawnTransform?.translation || { x: 0, y: 0, z: 0 };
    return payload.objects.map(obj => {
      if (obj.source) return obj;
      const t = obj.spawnTransform?.translation || { x: 0, y: 0, z: 0 };
      return {
        source: obj,
        relativeTranslation: {
          x: Number(t.x || 0) - Number(rawAnchor.x || 0),
          y: Number(t.y || 0) - Number(rawAnchor.y || 0),
          z: Number(t.z || 0) - Number(rawAnchor.z || 0),
        },
      };
    });
  }
  if (payload.object) {
    return [{
      source: payload.object,
      relativePosition: { x: 0, y: 0, z: 0 },
    }];
  }
  return [];
}

export function clipboardAnchorToThree(payload, entries) {
  const fallbackAnchor = entries[0]?.source?.spawnTransform?.translation || { x: 0, y: 0, z: 0 };
  if (payload.anchorSpace === 'three') {
    return new THREE.Vector3(
      Number(payload.anchor.x || 0),
      Number(payload.anchor.y || 0),
      Number(payload.anchor.z || 0)
    );
  }
  return ue4PosToThree(payload.anchor ?? fallbackAnchor);
}

export function clipboardEntryOffsetToThree(entry) {
  if (entry.relativePosition) {
    return new THREE.Vector3(
      Number(entry.relativePosition.x || 0),
      Number(entry.relativePosition.y || 0),
      Number(entry.relativePosition.z || 0)
    );
  }
  return ue4PosToThree(entry.relativeTranslation || { x: 0, y: 0, z: 0 });
}
