import * as THREE from 'three';

export function patternTemplatesKey(templates) {
  return JSON.stringify(templates || []);
}

export function getPatternTemplates(tool) {
  return tool.templates?.length
    ? tool.templates
    : [{
        objectId: tool.objectId,
        source: null,
        offset: { x: 0, y: 0, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        scale3D: { x: 1, y: 1, z: 1 },
      }];
}

export function patternToolEulerDegrees(tool) {
  const e = new THREE.Euler().setFromQuaternion(tool.group.quaternion, 'YXZ');
  return {
    p: THREE.MathUtils.radToDeg(e.x),
    y: THREE.MathUtils.radToDeg(e.y),
    r: THREE.MathUtils.radToDeg(e.z),
  };
}

export function serializePatternTool(tool, objectIndex, clonePlain) {
  return {
    id: tool.id,
    objectId: tool.objectId,
    templates: clonePlain(tool.templates || []),
    templateVersion: tool.templateVersion || 0,
    params: clonePlain(tool.params),
    position: { x: tool.group.position.x, y: tool.group.position.y, z: tool.group.position.z },
    quaternion: { x: tool.group.quaternion.x, y: tool.group.quaternion.y, z: tool.group.quaternion.z, w: tool.group.quaternion.w },
    itemIndexes: tool.items
      .map(item => objectIndex.get(item.ueObj))
      .filter(Number.isInteger),
  };
}

export function createPatternToolFromSnapshot(data, items, { label, userDataKey, clonePlain }) {
  const tool = {
    id: data.id,
    objectId: data.objectId,
    templates: clonePlain(data.templates || []),
    templateVersion: data.templateVersion || 0,
    params: clonePlain(data.params || {}),
    group: new THREE.Group(),
    items: (data.itemIndexes || []).map(idx => items[idx]).filter(Boolean),
  };
  tool.group.position.set(data.position?.x || 0, data.position?.y || 0, data.position?.z || 0);
  tool.group.quaternion.set(data.quaternion?.x || 0, data.quaternion?.y || 0, data.quaternion?.z || 0, data.quaternion?.w ?? 1);
  tool.group.name = `${label} ${tool.id}`;
  tool.group.userData[userDataKey] = tool;
  return tool;
}
