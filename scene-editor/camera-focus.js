import * as THREE from 'three';

function moveCameraTo(center, dist, { camera, orbitControls }) {
  orbitControls.target.copy(center);
  camera.position.set(center.x, center.y + dist * 0.5, center.z + dist);
  orbitControls.update();
}

export function fitCameraToItems(items, controls) {
  if (!items.length) return;
  const box = new THREE.Box3();
  for (const { group } of items) box.expandByPoint(group.position);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.6 + 100;
  controls.orbitControls.target.copy(center);
  controls.camera.position.set(center.x, center.y + radius * 0.45, center.z + radius);
  controls.orbitControls.update();
}

export function focusCircleTool(tool, controls) {
  const center = tool.group.position.clone();
  const dist = tool.params.diameter * 1.2 + 20;
  moveCameraTo(center, dist, controls);
}

export function focusGridTool(tool, controls) {
  const center = tool.group.position.clone();
  const width = (Math.max(1, tool.params.columns || 1) - 1) * Number(tool.params.spacingX || 0);
  const depth = (Math.max(1, tool.params.rows || 1) - 1) * Number(tool.params.spacingY || 0);
  const dist = Math.max(width, depth, 20) * 1.2 + 20;
  moveCameraTo(center, dist, controls);
}

export function focusSelectedItems({ selected, selectedItems }, controls) {
  if (!selected) return;
  let center;
  let dist;
  if (selectedItems.size > 1) {
    const box = new THREE.Box3();
    for (const item of selectedItems) box.expandByObject(item.group);
    center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    dist = Math.max(size.x, size.y, size.z) * 1.5 + 20;
  } else if (selected.hasRealMesh) {
    const box = new THREE.Box3().setFromObject(selected.mesh);
    center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    dist = Math.max(size.x, size.y, size.z) * 1.5 + 20;
  } else {
    center = selected.group.position.clone();
    const [, h] = selected.meta.boxSize;
    dist = Math.max(h * 3, 30);
  }
  moveCameraTo(center, dist, controls);
}
