import { iconTextureUrl } from './asset-source.js';

// Optional (namespace, key) -> localized text hook, injected by the editor so catalog labels follow the
// chosen language. Entries that carry a namespace + displayKey (devices) get localized; the rest (objects,
// which PUBG does not localize) fall through to the derived English name.
let _nameTranslator = null;
export function setNameTranslator(fn) { _nameTranslator = typeof fn === 'function' ? fn : null; }

const PLACEMENT_CATEGORY_ORDER = [
  'LargeHouse',
  'MediumHouse',
  'SmallHouse',
  'Wall',
  'Floor',
  'Stair',
  'Foliage',
  'Prop',
  'Destructible',
  'Devices',
];

export function catalogLabel(entry) {
  if (!entry) return '';
  const friendly = friendlyCatalogName(entry);
  const raw = entry.name || entry.displayKey || entry.rowName || `Object ${entry.objectId ?? ''}`;
  return friendly && friendly !== raw ? `${friendly} (${raw})` : raw;
}

export function friendlyCatalogName(entry) {
  if (!entry) return '';
  if (_nameTranslator && entry.namespace && entry.displayKey) {
    const localized = _nameTranslator(entry.namespace, entry.displayKey);
    if (localized) return localized;
  }
  if (entry.name && !/^LargeHouse\d+|MediumHouse\d+|SmallHouse\d+|Prop\d+|StaticMesh\d+$/i.test(entry.name)) {
    return entry.name;
  }
  const source = entry.iconTexture || entry.objectClass || entry.previewActorClass || entry.rowName || entry.displayKey || '';
  let name = String(source).split('/').pop() || '';
  name = name.split('.').pop() || name;
  name = name
    .replace(/^T_/, '')
    .replace(/^BP_/, '')
    .replace(/_C$/, '')
    .replace(/_Mod(House|Object|Prop|StaticMesh)?$/i, '')
    .replace(/_Thumbnail$/i, '')
    .replace(/_on$/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name || entry.displayKey || entry.rowName || `Object ${entry.objectId ?? ''}`;
}

export function catalogKind(entry, devices = {}) {
  return entry?.kind || (devices[String(entry?.objectId)] ? 'Device' : 'Object');
}

export function cleanCategoryKey(value) {
  return String(value || '')
    .replace(/^EModObjectSubCategory::/, '')
    .replace(/^EModObjectType::/, '')
    .trim();
}

export function categoryLabel(key) {
  if (key === 'Devices') return 'Devices';
  if (key === 'Stair') return 'Stairs';
  return String(key || 'Other')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function placementCategoryKey(entry, devices = {}) {
  if (entry?.kind === 'Device' || devices[String(entry?.objectId)]) return 'Devices';
  return cleanCategoryKey(entry?.subCategory) || cleanCategoryKey(entry?.objectType) || 'Other';
}

export function placementCategoryRank(key) {
  const index = PLACEMENT_CATEGORY_ORDER.indexOf(key);
  if (index >= 0) return index;
  return PLACEMENT_CATEGORY_ORDER.length - (key === 'Devices' ? 0 : 1);
}

export function placementIconUrl(entry) {
  return entry?.iconTexture ? iconTextureUrl(entry.iconTexture) : '';
}
