import { catalogLabel } from './catalog-utils.js';

const DEVICE_COLOR = 0xf5a623;

const CAT_PATTERNS = [
  ['LargeHouse',  0xcc3333, [22, 14, 22]],   // red
  ['MediumHouse', 0xdd7722, [14, 9,  14]],   // orange
  ['SmallHouse',  0xccbb11, [ 8, 6,   8]],   // yellow
  ['House',       0xdd7722, [12, 8,  12]],   // orange
  ['Floor',       0x995522, [ 4, 0.15, 4]],  // brown
  ['Wall',        0x3366cc, [ 4, 3, 0.25]],  // blue
  ['Stair',       0x7722cc, [ 4, 3,   4]],   // purple
  ['LargeProp',   0x22aaaa, [ 7, 5,   7]],   // cyan
  ['MediumProp',  0x22aaaa, [ 3, 3,   3]],   // cyan
  ['SmallProp',   0x22aaaa, [1.5, 1.5, 1.5]],// cyan
  ['Prop',        0x22aaaa, [ 3, 3,   3]],   // cyan
  ['Tree',        0x228833, [ 3, 9,   3]],   // green
  ['Bush',        0x228833, [ 2, 1.5,  2]],  // green
  ['Foliage',     0x228833, [ 3, 4,   3]],   // green
  ['ReactionProp',0xcc22aa, [ 2, 2,   2]],   // magenta
  ['StaticMesh',  0x888888, [ 3, 3,   3]],   // gray
];

function resolveCategory(subCat) {
  const key = (subCat || '').replace(/^EModObjectSubCategory::/, '');
  const hit = CAT_PATTERNS.find(([p]) => key.includes(p));
  return hit ? [hit[1], hit[2]] : [0x999999, [2, 2, 2]];
}

export function getObjectMeta(catalog, objectId) {
  const dev = catalog.devices[String(objectId)];
  if (dev) {
    return {
      name: catalogLabel(dev) || `Device ${objectId}`,
      isDevice: true,
      color: DEVICE_COLOR,
      boxSize: [1, 1, 1],
      catalog: dev,
    };
  }
  const obj = catalog.objects[String(objectId)];
  if (obj) {
    const [color, boxSize] = resolveCategory(obj.subCategory);
    return {
      name: catalogLabel(obj) || `Object ${objectId}`,
      isDevice: false,
      color,
      boxSize,
      catalog: obj,
    };
  }
  return { name: `Unknown(${objectId})`, isDevice: false, color: 0x888888, boxSize: [2, 2, 2], catalog: null };
}
