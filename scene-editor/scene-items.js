import * as THREE from 'three';
import {
  clampUeScale3D,
  ue4PosToThree,
  ue4QuatToThree,
  ue4ScaleToThree,
} from './coords.js';
import { disposeItemRenderObject } from './mesh-items.js';

export function createEditorItem(ueObj, meta, normalOpacity) {
  ueObj.spawnTransform.scale3D = clampUeScale3D(ueObj.spawnTransform.scale3D);
  const group = new THREE.Group();
  group.position.copy(ue4PosToThree(ueObj.spawnTransform.translation));
  group.quaternion.copy(ue4QuatToThree(ueObj.spawnTransform.rotation));
  group.scale.copy(ue4ScaleToThree(ueObj.spawnTransform.scale3D));

  const [w, h, d] = meta.boxSize;
  const geo = meta.isDevice
    ? new THREE.SphereGeometry(0.6, 8, 6)
    : new THREE.BoxGeometry(w, h, d);

  const mat = new THREE.MeshLambertMaterial({
    color: meta.color,
    wireframe: true,
    transparent: true,
    opacity: normalOpacity,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  group.add(mesh);
  group.userData.itemRef = null;

  return {
    ueObj,
    group,
    mesh,
    mat,
    materials: [mat],
    meta,
    ownedGeo: true,
    hasRealMesh: false,
    pivotOffset: new THREE.Vector3(),
  };
}

// Revert an item that had a real mesh back to its default placeholder (wireframe sphere for devices,
// box otherwise) - used when a device's selected pick-list mesh can't be loaded, so it shows the
// default primitive instead of the previously loaded mesh.
export function resetEditorItemToPlaceholder(item, normalOpacity) {
  item.group.remove(item.mesh);
  disposeItemRenderObject(item);
  for (const m of item.materials ?? [item.mat]) m.dispose();

  const meta = item.meta;
  const [w, h, d] = meta.boxSize;
  const geo = meta.isDevice
    ? new THREE.SphereGeometry(0.6, 8, 6)
    : new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshLambertMaterial({
    color: meta.color,
    wireframe: true,
    transparent: true,
    opacity: normalOpacity,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  item.group.add(mesh);
  item.mesh = mesh;
  item.mat = mat;
  item.materials = [mat];
  item.sections = [];
  item.ownedGeo = true;
  item.hasRealMesh = false;
  // Drop the mesh pivot offset and restore the group to the device's own transform position.
  item.pivotOffset.set(0, 0, 0);
  item.group.position.copy(ue4PosToThree(item.ueObj.spawnTransform.translation));
}

export function disposeEditorItem(item, scene) {
  scene.remove(item.group);
  disposeItemRenderObject(item);
  for (const m of item.materials ?? [item.mat]) m.dispose();
  // Device volume is a group (fill + wireframe) with its own per-volume geometries/materials.
  if (item.volumeBox) item.volumeBox.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  // Icon sprite material is disposed; its texture is shared/cached, so leave it.
  if (item.iconSprite) item.iconSprite.material.dispose();
}
