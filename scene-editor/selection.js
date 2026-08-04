import * as THREE from 'three';

// Selected objects tint by a hue cycle so each object in a multi-selection is an obviously different
// colour (golden-angle spacing for good separation at any count). SELECTION_COLOR is the index-0 /
// fallback colour (used at mesh build time when the index isn't known).
export const SELECTION_OPACITY = 1.0; // mesh stays solid; the tint is an overlay, not transparency
export const SELECTION_TINT_MIX = 0.55; // how much the hue overlays the original colour (0 = none, 1 = full)
export const MISSING_TEXTURE_COLOR   = 0xff3bd5;
export const MISSING_TEXTURE_OPACITY = 0.55;

const _selColor = new THREE.Color();
export function selectionColorForIndex(index = 0) {
  return _selColor.setHSL((0.085 + index * 0.61803398875) % 1, 0.7, 0.52);
}
export const SELECTION_COLOR = selectionColorForIndex(0).clone();

export function itemNormalColor(item, material) {
  if (!item.hasRealMesh) return item.meta.color;
  if (material.userData?.missingTexture) return MISSING_TEXTURE_COLOR;
  return material.map ? 0xffffff : 0xb0b0b0;
}

export const SELECTION_EMISSIVE_INTENSITY = 0.28;

const _tintColor = new THREE.Color();
export function setItemSelectedMaterials(item, color = SELECTION_COLOR) {
  for (const material of item.materials) {
    // Overlay the hue on top of the material's normal colour (lerp), so the texture still reads through
    // instead of being replaced - and keep the mesh opaque.
    _tintColor.set(itemNormalColor(item, material)).lerp(color, SELECTION_TINT_MIX);
    material.color.copy(_tintColor);
    material.opacity = SELECTION_OPACITY;
    material.transparent = SELECTION_OPACITY < 0.999;
    if (material.emissive) { // a faint glow in the selection hue makes the object pop
      material.emissive.copy(color);
      if ('emissiveIntensity' in material) material.emissiveIntensity = SELECTION_EMISSIVE_INTENSITY;
      else material.emissive.multiplyScalar(SELECTION_EMISSIVE_INTENSITY);
    }
    material.needsUpdate = true;
  }
}

export function setItemNormalMaterials(item, opacity) {
  for (const material of item.materials) {
    material.color.set(itemNormalColor(item, material));
    const missing = material.userData?.missingTexture;
    const secOpacity = missing ? Math.min(opacity, MISSING_TEXTURE_OPACITY) : opacity;
    material.opacity = secOpacity;
    material.transparent = secOpacity < 0.999 || Boolean(missing);
    if (material.emissive) {
      material.emissive.setRGB(0, 0, 0);
      if ('emissiveIntensity' in material) material.emissiveIntensity = 1;
    }
    material.needsUpdate = true;
  }
}

export function clearItemSelection(selectedItems, normalOpacity) {
  for (const item of selectedItems) setItemNormalMaterials(item, normalOpacity);
  selectedItems.clear();
  return null;
}

// Re-tint every selected item by its position so hues stay distinct after a removal.
export function recolorSelection(selectedItems) {
  let i = 0;
  for (const item of selectedItems) setItemSelectedMaterials(item, selectionColorForIndex(i++));
}

export function applyItemSelection({
  item,
  selectedItems,
  current,
  add = false,
  toggle = false,
  normalOpacity,
}) {
  let selected = current;
  if (!add && !toggle) selected = clearItemSelection(selectedItems, normalOpacity);

  if (toggle && selectedItems.has(item)) {
    setItemNormalMaterials(item, normalOpacity);
    selectedItems.delete(item);
    recolorSelection(selectedItems); // reindex remaining so hues stay distinct
    return [...selectedItems].at(-1) || null;
  }

  const idx = selectedItems.has(item) ? [...selectedItems].indexOf(item) : selectedItems.size;
  selectedItems.add(item);
  setItemSelectedMaterials(item, selectionColorForIndex(idx));
  return item;
}
