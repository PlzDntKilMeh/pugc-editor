import * as THREE from 'three';
import { renderFlagsUrl } from './asset-source.js';
import { MISSING_TEXTURE_COLOR, MISSING_TEXTURE_OPACITY } from './selection.js';

const UNTEXTURED_SECTION_COLOR = 0xb0b0b0;
let materialRenderFlagsPromise = null;

async function loadMaterialRenderFlags() {
  if (!materialRenderFlagsPromise) {
    materialRenderFlagsPromise = fetch(renderFlagsUrl())
      .then(r => r.ok ? r.json() : {})
      .catch(() => ({}));
  }
  return materialRenderFlagsPromise;
}

function materialFlagsFor(flags, matPath) {
  const path = String(matPath || '').trim();
  if (!path) return {};
  const normalized = path.replaceAll('\\', '/');
  const base = normalized.split('/').pop();
  return flags[normalized] || flags[base] || {};
}

function markTextureState(material, { matPath, tex, texturesRequested }) {
  material.userData.matPath = matPath || '';
  material.userData.missingTexture = Boolean(texturesRequested && matPath && !tex);
}

function sectionColor({ selected, selectionColor, tex, matPath, texturesRequested, fallbackColor }) {
  if (selected) return selectionColor;
  if (tex) return 0xffffff;
  if (texturesRequested && matPath) return MISSING_TEXTURE_COLOR;
  return fallbackColor;
}

function shouldUseTransparency(selected, opacity, missingTexture = false) {
  // Selection is fully opaque (it only tints colour), so only real <1 opacity needs alpha blending.
  // Flagging selected items transparent made them render see-through against overlapping geometry.
  return (!selected && missingTexture) || opacity < 0.999;
}

export async function applyRealMeshToItem(item, geoData, {
  isSelected,
  loadTextures,
  loadTexture,
  normalOpacity,
  selectionColor,
  selectionOpacity,
  prepareEditorPivotGeo,
  rootPositionForItem,
  pivotOffsetForItem,
  positionToUe4,
  allowReplace = false,
}) {
  // allowReplace lets a device swap its preview mesh after one is already applied (pick-list change).
  if (item.hasRealMesh && !allowReplace) return;
  if (allowReplace) item.hasRealMesh = false;
  prepareEditorPivotGeo(geoData);

  item.group.remove(item.mesh);
  disposeItemRenderObject(item);
  for (const m of item.materials) m.dispose();

  const rootBeforePivot = rootPositionForItem(item);
  item.pivotOffset = geoData.pivotOffset.clone();
  if (item.keepEditorPivotOnMeshLoad) {
    item.ueObj.spawnTransform.translation = positionToUe4(rootBeforePivot);
  } else {
    item.group.position.copy(rootBeforePivot).add(pivotOffsetForItem(item));
    item.ueObj.spawnTransform.translation = positionToUe4(rootBeforePivot);
  }

  // Render flags are one cached fetch; await them so alpha-test is correct from the first frame.
  const renderFlags = loadTextures ? await loadMaterialRenderFlags() : {};

  const selected = isSelected(item);
  const opacity = selected ? selectionOpacity : normalOpacity;
  // Build each section's material WITHOUT its texture - the mesh appears immediately and the
  // texture is streamed in below (streamItemTextures). Blocking the mesh on its textures made
  // meshes invisible until every texture loaded, and serialized loading into per-batch waves.
  const makeSectionMaterial = (matPath) => {
    const flags = materialFlagsFor(renderFlags, matPath);
    const isMissing = !selected && loadTextures && Boolean(matPath);
    const secOpacity = isMissing ? Math.min(opacity, MISSING_TEXTURE_OPACITY) : opacity;
    const material = new THREE.MeshStandardMaterial({
      color: sectionColor({
        selected, selectionColor, tex: null, matPath,
        texturesRequested: loadTextures,
        fallbackColor: loadTextures ? UNTEXTURED_SECTION_COLOR : item.meta.color,
      }),
      map: null,
      roughness: 0.8,
      metalness: 0.0,
      opacity: secOpacity,
      transparent: shouldUseTransparency(selected, secOpacity, isMissing),
      alphaTest: (flags.alphaTest || flags.AlphaTest) ? 0.5 : 0,
      emissive: selected ? selectionColor : 0x000000,
      emissiveIntensity: selected ? 0.28 : 1,
    });
    markTextureState(material, { matPath, tex: null, texturesRequested: loadTextures });
    return material;
  };

  // Build the render object. flatMats/flatSecs stay index-aligned (same order) so the
  // texture-toggle and selection passes can keep using a single flat array.
  let renderObj;
  const flatMats = [];
  const flatSecs = [];

  if (geoData.instanced) {
    const group = new THREE.Group();
    const matricesByMesh = new Map();
    for (const inst of geoData.centeredInstances) {
      if (!matricesByMesh.has(inst.meshIndex)) matricesByMesh.set(inst.meshIndex, []);
      matricesByMesh.get(inst.meshIndex).push(inst.matrix);
    }
    const tmp = new THREE.Matrix4();
    for (let mi = 0; mi < geoData.meshes.length; mi++) {
      const matrices = matricesByMesh.get(mi);
      if (!matrices || matrices.length === 0) continue;
      const mesh = geoData.meshes[mi];
      const mats = mesh.sections.length > 0
        ? mesh.sections.map(s => makeSectionMaterial(s.matPath))
        : [makeSectionMaterial('')];
      const inst = new THREE.InstancedMesh(mesh.geo, mats.length === 1 ? mats[0] : mats, matrices.length);
      matrices.forEach((m, k) => { tmp.fromArray(m); inst.setMatrixAt(k, tmp); });
      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);
      flatMats.push(...mats);
      flatSecs.push(...mesh.sections);
    }
    renderObj = group;
  } else {
    const { centeredGeo: geo, sections } = geoData;
    const mats = sections.length > 0
      ? sections.map(s => makeSectionMaterial(s.matPath))
      : [makeSectionMaterial('')];
    renderObj = new THREE.Mesh(geo, mats.length === 1 ? mats[0] : mats);
    flatMats.push(...mats);
    flatSecs.push(...sections);
  }

  item.group.add(renderObj);
  item.mesh = renderObj;
  item.mat = flatMats[0];
  item.materials = flatMats;
  item.sections = flatSecs;
  item.bpClass = geoData.bpClass || '';
  item.meshPaths = geoData.meshPaths || [];
  item.ownedGeo = false; // geometry is shared via the geo cache; never disposed per-item
  item.hasRealMesh = true;

  // Stream textures in without blocking the mesh: it is already on screen with fallback colours;
  // each texture is applied to its sections as it arrives. Fires every request up front (best use
  // of the browser's connection pool) instead of the mesh waiting on all of them. Guarded so a
  // later texture-toggle or item disposal isn't clobbered by a late-arriving texture.
  if (loadTextures) {
    const builtMats = flatMats;
    const builtSecs = flatSecs;
    for (const p of new Set(builtSecs.map(s => s.matPath).filter(Boolean))) {
      loadTexture(p).then(tex => {
        if (!tex) return;
        const sel = isSelected(item);
        for (let i = 0; i < builtSecs.length; i++) {
          if (builtSecs[i].matPath !== p) continue;
          const m = builtMats[i];
          if (!m || item.materials[i] !== m) continue; // superseded or disposed
          m.map = tex;
          m.color.set(sectionColor({
            selected: sel, selectionColor, tex, matPath: p,
            texturesRequested: true, fallbackColor: UNTEXTURED_SECTION_COLOR,
          }));
          markTextureState(m, { matPath: p, tex, texturesRequested: true });
          // Texture loaded — restore opacity from missing-texture value back to base.
          if (m.opacity <= MISSING_TEXTURE_OPACITY) m.opacity = opacity;
          m.transparent = shouldUseTransparency(sel, m.opacity, false);
          m.needsUpdate = true;
        }
      });
    }
  }
}

// Dispose an item's current render object without touching shared (cached) geometry.
// Frees per-item resources: InstancedMesh instance buffers, and owned legacy geometry.
export function disposeItemRenderObject(item) {
  const obj = item.mesh;
  if (!obj) return;
  if (obj.isInstancedMesh) { obj.dispose(); return; }
  if (obj.isGroup) { obj.traverse(o => { if (o.isInstancedMesh) o.dispose(); }); return; }
  if (item.ownedGeo && obj.geometry) obj.geometry.dispose();
}

export async function upgradeMeshesForItems(items, {
  batchSize = 6,
  getGeo,
  applyRealMesh,
  onComplete,
}) {
  // Group items by objectId once (O(n)) so each id's batch only touches its own items, instead of
  // rescanning the whole item list per id (O(unique x total) - costly on large levels).
  const itemsById = new Map();
  for (const item of items) {
    let bucket = itemsById.get(item.ueObj.objectId);
    if (!bucket) itemsById.set(item.ueObj.objectId, bucket = []);
    bucket.push(item);
  }
  const propIds = [...itemsById.keys()];
  for (let i = 0; i < propIds.length; i += batchSize) {
    const batch = propIds.slice(i, i + batchSize);
    await Promise.all(batch.map(async id => {
      const geoData = await getGeo(id);
      if (!geoData) return;
      for (const item of itemsById.get(id)) {
        if (!item.hasRealMesh) await applyRealMesh(item, geoData);
      }
    }));
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  onComplete?.();
}

export function applyOpacityToItems(items, { selected, normalOpacity }) {
  for (const item of items) {
    if (item === selected) continue;
    for (const m of item.materials) {
      const missing = m.userData.missingTexture;
      m.opacity = missing ? Math.min(normalOpacity, MISSING_TEXTURE_OPACITY) : normalOpacity;
      m.transparent = shouldUseTransparency(false, m.opacity, missing);
      m.needsUpdate = true;
    }
  }
}

export async function applyTextureToggleToItems(items, {
  selected,
  loadTextures,
  loadTexture,
  selectionColor,
}) {
  for (const item of items) {
    if (!item.hasRealMesh || !item.sections) continue;
    const isSel = item === selected;
    if (loadTextures) {
      const uniquePaths = [...new Set(item.sections.map(s => s.matPath).filter(Boolean))];
      const texMap = new Map();
      await Promise.all(uniquePaths.map(async p => texMap.set(p, await loadTexture(p))));
      item.sections.forEach((s, i) => {
        const m = item.materials[i];
        if (!m) return;
        const tex = texMap.get(s.matPath) || null;
        m.map = tex;
        markTextureState(m, { matPath: s.matPath, tex, texturesRequested: true });
        m.transparent = shouldUseTransparency(isSel, m.opacity);
        m.color.set(sectionColor({
          selected: isSel,
          selectionColor,
          tex,
          matPath: s.matPath,
          texturesRequested: true,
          fallbackColor: UNTEXTURED_SECTION_COLOR,
        }));
        m.needsUpdate = true;
      });
    } else {
      item.materials.forEach(m => {
        m.map = null;
        markTextureState(m, { matPath: m.userData.matPath, tex: null, texturesRequested: false });
        m.transparent = shouldUseTransparency(isSel, m.opacity);
        m.color.set(isSel ? selectionColor : item.meta.color);
        m.needsUpdate = true;
      });
    }
  }
}
