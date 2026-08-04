import * as THREE from 'three';

export function objectEulerDegrees(item) {
  const euler = new THREE.Euler().setFromQuaternion(item.group.quaternion, 'YXZ');
  return {
    p: THREE.MathUtils.radToDeg(euler.x),
    y: THREE.MathUtils.radToDeg(euler.y),
    r: THREE.MathUtils.radToDeg(euler.z),
  };
}

export function itemTransformSnapshot(item, rootPositionForItem) {
  return {
    root: rootPositionForItem(item),
    quaternion: item.group.quaternion.clone(),
    scale: item.group.scale.clone(),
  };
}

export function createMultiTransformStart(selected, selectedItems, rootPositionForItem) {
  if (!selected || selectedItems.size <= 1 || !selectedItems.has(selected)) return null;
  return {
    primary: itemTransformSnapshot(selected, rootPositionForItem),
    items: new Map([...selectedItems].map(item => [item, itemTransformSnapshot(item, rootPositionForItem)])),
  };
}

export function applyMultiSelectionTransform(start, selected, selectedItems, {
  rootPositionForItem,
  pivotOffsetForItem,
  clampScale,
  positionToUe4,
  quaternionToUe4,
  scaleToUe4,
}) {
  if (!start || !selected || !start.items.has(selected)) return;
  const primaryStart = start.primary;
  const primaryNow = itemTransformSnapshot(selected, rootPositionForItem);
  const qDelta = primaryNow.quaternion.clone().multiply(primaryStart.quaternion.clone().invert());
  const scaleRatio = new THREE.Vector3(
    primaryStart.scale.x ? primaryNow.scale.x / primaryStart.scale.x : 1,
    primaryStart.scale.y ? primaryNow.scale.y / primaryStart.scale.y : 1,
    primaryStart.scale.z ? primaryNow.scale.z / primaryStart.scale.z : 1,
  );

  for (const item of selectedItems) {
    if (item === selected) continue;
    const itemStart = start.items.get(item);
    if (!itemStart) continue;
    const relativeRoot = itemStart.root.clone().sub(primaryStart.root).multiply(scaleRatio).applyQuaternion(qDelta);
    const root = primaryNow.root.clone().add(relativeRoot);
    item.group.scale.copy(clampScale(itemStart.scale.clone().multiply(scaleRatio)));
    item.group.quaternion.copy(qDelta).multiply(itemStart.quaternion);
    item.group.position.copy(root).add(pivotOffsetForItem(item));
    item.ueObj.spawnTransform.translation = positionToUe4(root);
    item.ueObj.spawnTransform.rotation = quaternionToUe4(item.group.quaternion);
    item.ueObj.spawnTransform.scale3D = scaleToUe4(item.group.scale);
  }
}
