import * as THREE from 'three';

export function prepareBakedLevelScene(root) {
  root.name = 'Baked MOD level';
  root.traverse(obj => {
    if (!obj.isMesh) return;
    obj.frustumCulled = true;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m) continue;
      m.side = THREE.DoubleSide;
      m.needsUpdate = true;
    }
  });
  return root;
}
