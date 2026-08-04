import * as THREE from 'three';

export function disposeObjectMaterials(material) {
  const mats = Array.isArray(material) ? material : [material];
  for (const m of mats) m?.dispose?.();
}

export function disposeSceneObject(root) {
  root.traverse(obj => {
    if (!obj.isMesh) return;
    obj.geometry?.dispose();
    disposeObjectMaterials(obj.material);
  });
}

export function frameObject(root, { camera, orbitControls }) {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const diag = Math.sqrt(size.x * size.x + size.z * size.z);
  orbitControls.target.copy(center);
  camera.position.set(center.x, center.y + diag * 0.3, center.z + diag * 0.55);
  orbitControls.update();
}
