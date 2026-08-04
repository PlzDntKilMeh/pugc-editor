import {
  clampUeScale3D,
  threePosToUe4,
  threeQuatToUe4,
} from './coords.js';
import { defaultDeviceProperties } from './device-defaults.js';

export function newSceneObject(objectId, posThree, quatThree, {
  scale3D = { x: 1, y: 1, z: 1 },
  catalog,
  isDeviceObjectId,
  nextDeviceIndex,
} = {}) {
  const isDevice = isDeviceObjectId(objectId);
  const deviceEntry = catalog.devices[String(objectId)];
  const obj = {
    objectId,
    deviceIndex: isDevice ? nextDeviceIndex(objectId) : -1,
    userDeviceName: '',
    spawnTransform: {
      rotation: threeQuatToUe4(quatThree),
      translation: threePosToUe4(posThree),
      scale3D: clampUeScale3D(scale3D),
    },
  };
  if (isDevice) {
    const knownDefaults = catalog.deviceFieldDefaults?.[String(objectId)];
    obj.devicePropertyData = JSON.stringify(defaultDeviceProperties(deviceEntry, catalog.enums, catalog.stringTables, knownDefaults));
  }
  return obj;
}
