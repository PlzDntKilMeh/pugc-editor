export function getPugcObjectsFromJson(pugcJson) {
  if (!pugcJson) return null;
  const objects = pugcJson.objects || pugcJson.modObjects;
  return Array.isArray(objects) ? objects : null;
}

export function isCatalogDeviceObjectId(catalog, objectId) {
  return Boolean(catalog.devices[String(objectId)]);
}

export function nextDeviceIndexForObject(objects, objectId) {
  const indexes = (objects || [])
    .filter(obj => Number(obj.objectId) === Number(objectId) && Number(obj.deviceIndex) !== -1)
    .map(obj => Number(obj.deviceIndex))
    .filter(Number.isFinite);
  return indexes.length ? Math.max(...indexes) + 1 : 0;
}

export function removePugcObject(objects, ueObj) {
  if (!objects) return;
  const idx = objects.indexOf(ueObj);
  if (idx >= 0) objects.splice(idx, 1);
}
