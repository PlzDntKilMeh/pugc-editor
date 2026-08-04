import { setPathValue } from './form-utils.js';
import { validatorFor, enumOptions } from './field-utils.js';

export function defaultDeviceFieldValue(field, enums) {
  const v = validatorFor(field);
  if (field.type === 'Bool') return false;
  if (field.type === 'Int' || field.type === 'Float') return Number(v.minValue ?? 0);
  if (field.type === 'Enum') {
    if (field.path === 'activationRoundPhase') return 'DeviceCreation';
    if (v.valueSet?.[0]) return v.valueSet[0];
    const first = enumOptions(field, enums)[0];
    return first?.value ?? '';
  }
  if (field.type === 'String') return '';
  if (field.type === 'Item') return { itemId: 'None', itemCount: 1 };
  if (field.type === 'Array') return [];
  if (field.type === 'Vector') return v.minVector || { x: 0, y: 0, z: 0 };
  return '';
}

export function defaultDeviceProperties(deviceEntry, enums) {
  const props = {};
  for (const field of deviceEntry?.fields || []) {
    if (!field.path || field.type === 'Object' || field.path.includes('[].') || field.path.endsWith('[]')) continue;
    setPathValue(props, field.path, defaultDeviceFieldValue(field, enums));
  }
  return props;
}
