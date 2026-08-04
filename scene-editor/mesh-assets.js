import * as THREE from 'three';
import { textureUrls, bpMeshUrls, assetMeshUrls, fetchBin } from './asset-source.js';

const geoCache = new Map();
const texCache = new Map();
const utf8 = new TextDecoder('utf-8');

export function clearBpGeoCache() {
  for (const promise of geoCache.values()) {
    Promise.resolve(promise).then(disposeBpGeoData);
  }
  geoCache.clear();
  for (const promise of assetGeoCache.values()) {
    Promise.resolve(promise).then(disposeBpGeoData);
  }
  assetGeoCache.clear();
}

export function clearTextureCache() {
  for (const promise of texCache.values()) {
    Promise.resolve(promise).then(tex => tex?.dispose());
  }
  texCache.clear();
}

// Load a THREE.Texture from a URL, configured for tiling. crossOrigin is cleared (assets are
// same-origin) so Firefox actually reuses the cached image instead of re-fetching the CORS variant.
function loadImageTexture(loader, url, onLoad, onError) {
  loader.load(url, t => {
    t.colorSpace = THREE.SRGBColorSpace;
    // PUBG modular/building UVs run past 0-1 so the texture tiles; RepeatWrapping honours that instead
    // of three.js's default ClampToEdge (which smears edge pixels into the "stretched texture" look).
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8; // sharpen textures on surfaces viewed at grazing angles (floors, walls)
    t.needsUpdate = true;
    onLoad(t);
  }, undefined, onError);
}

export function loadTexture(gamePath) {
  const path = String(gamePath || '').trim();
  if (!path || path.toLowerCase() === 'none') return Promise.resolve(null);
  if (texCache.has(path)) return texCache.get(path);
  const p = (async () => {
    const urls = await textureUrls(path); // resolves material->texture against the static alias map
    if (!urls) return null;
    return new Promise(resolve => {
      const loader = new THREE.TextureLoader();
      loader.crossOrigin = undefined;
      loadImageTexture(loader, urls.webp, resolve, () => resolve(null));
    });
  })();
  texCache.set(path, p);
  p.then(t => { if (!t) texCache.delete(path); }); // allow a retry if it failed to resolve
  return p;
}

// Instanced format:
//   [u32 magic=0xFFFFFFFE][u32 meshCount]
//   per mesh: [u32 vc][f32x3 pos][f32x3 nrm][f32x2 uv][u32 secCount]
//             per sec: [u32 firstTri][u32 triCount][u32 pathLen][utf8 matPath]
//   [u32 instanceCount][per instance: u32 meshIndex + 16 f32 (column-major matrix)]
//
// Returns { instanced:true, meshes:[{geo,sections}], instances:[{meshIndex,matrix}],
//          sections:<flattened unique sections> } or null for the empty stub.
// Typed arrays are copied via buffer.slice because variable-length matPaths leave the
// following floats unaligned (Float32Array views require 4-byte-aligned offsets).
export function decodeBpMesh(buffer) {
  if (buffer.byteLength < 8) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0xFFFFFFFE) return null; // empty stub / unsupported
  const meshCount = view.getUint32(4, true);
  if (meshCount === 0 || meshCount > 100000) return null;

  let off = 8;
  const meshes = [];
  const flatSections = [];
  for (let m = 0; m < meshCount; m++) {
    const vc = view.getUint32(off, true); off += 4;
    const posArr = new Float32Array(buffer.slice(off, off + vc * 12)); off += vc * 12;
    const nrmArr = new Float32Array(buffer.slice(off, off + vc * 12)); off += vc * 12;
    const uvArr  = new Float32Array(buffer.slice(off, off + vc * 8));  off += vc * 8;

    const secCount = view.getUint32(off, true); off += 4;
    const sections = [];
    for (let i = 0; i < secCount; i++) {
      const firstTri = view.getUint32(off, true); off += 4;
      const triCount = view.getUint32(off, true); off += 4;
      const pathLen = view.getUint32(off, true); off += 4;
      const matPath = pathLen > 0 ? utf8.decode(new Uint8Array(buffer, off, pathLen)) : '';
      off += pathLen;
      sections.push({ firstTri, triCount, matPath });
      flatSections.push({ firstTri, triCount, matPath });
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrmArr, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
    if (sections.length > 1)
      for (let i = 0; i < sections.length; i++)
        geo.addGroup(sections[i].firstTri * 3, sections[i].triCount * 3, i);

    meshes.push({ geo, sections });
  }

  const instCount = view.getUint32(off, true); off += 4;
  const instances = [];
  for (let i = 0; i < instCount; i++) {
    const meshIndex = view.getUint32(off, true); off += 4;
    const matrix = new Float32Array(buffer.slice(off, off + 64)); off += 64;
    instances.push({ meshIndex, matrix });
  }

  return { instanced: true, meshes, instances, sections: flatSections };
}

// Dispose every GPU resource owned by a decoded geoData (called from the geo cache).
export function disposeBpGeoData(geoData) {
  if (!geoData) return;
  if (geoData.instanced) { for (const m of geoData.meshes) m.geo?.dispose(); return; }
  geoData.centeredGeo?.dispose();
  if (geoData.geo && geoData.geo !== geoData.centeredGeo) geoData.geo.dispose();
}

// Mesh paths + bp class come from the .json sidecar (the /api route used to fold them into headers).
async function fetchMeshMeta(url) {
  try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch { return null; }
}

async function fetchBpGeo(objectId) {
  try {
    const { bin, meta } = bpMeshUrls(objectId);
    const buf = await fetchBin(bin);
    if (!buf) return null;
    const geoData = decodeBpMesh(buf);
    if (!geoData) return null;
    const m = await fetchMeshMeta(meta);
    geoData.bpClass = m?.bpClass || '';
    geoData.meshPaths = Array.isArray(m?.meshPaths) ? m.meshPaths : [];
    return geoData;
  } catch {
    return null;
  }
}

export function getBpGeo(objectId) {
  if (!geoCache.has(objectId)) geoCache.set(objectId, fetchBpGeo(objectId));
  return geoCache.get(objectId);
}

// Mesh for a device pick-list asset (meshName / spawnVehicleName). Pre-dumped to asset-mesh/<sha1>.bin
// in the same instanced bin format as bp-mesh (so decodeBpMesh decodes it, with dump-time normals and
// material paths). Handles both direct static meshes and composed Blueprints (e.g. vehicles).
const assetGeoCache = new Map();
async function fetchAssetGeo(assetPath) {
  try {
    const { bin, meta } = await assetMeshUrls(assetPath);
    const buf = await fetchBin(bin);
    if (!buf) return null;
    const geoData = decodeBpMesh(buf);
    if (!geoData) return null;
    const m = await fetchMeshMeta(meta);
    geoData.meshPaths = Array.isArray(m?.meshPaths) ? m.meshPaths : [];
    return geoData;
  } catch {
    return null;
  }
}

// Geometry for a static mesh referenced by game asset path (device meshName / vehicle pick-lists).
export function getAssetMeshGeo(assetPath) {
  const key = String(assetPath || '').trim();
  if (!key) return Promise.resolve(null);
  if (!assetGeoCache.has(key)) assetGeoCache.set(key, fetchAssetGeo(key));
  return assetGeoCache.get(key);
}

export function prepareEditorPivotGeo(geoData) {
  if (!geoData || geoData.pivotOffset) return geoData;

  if (geoData.instanced) {
    // Combined bounding box across all placed instances; pivot at its center.
    const box = new THREE.Box3();
    const tmpBox = new THREE.Box3();
    const tmpMat = new THREE.Matrix4();
    for (const mesh of geoData.meshes) mesh.geo.computeBoundingBox();
    for (const inst of geoData.instances) {
      const mesh = geoData.meshes[inst.meshIndex];
      if (!mesh?.geo.boundingBox) continue;
      tmpMat.fromArray(inst.matrix);
      tmpBox.copy(mesh.geo.boundingBox).applyMatrix4(tmpMat);
      box.union(tmpBox);
    }
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    // Re-center by subtracting the pivot from each instance's translation (column-major: 12,13,14).
    geoData.centeredInstances = geoData.instances.map(inst => {
      const m = inst.matrix.slice();
      m[12] -= center.x; m[13] -= center.y; m[14] -= center.z;
      return { meshIndex: inst.meshIndex, matrix: m };
    });
    geoData.pivotOffset = center;
    return geoData;
  }

  const geo = geoData.geo;
  geo.computeBoundingBox();
  const center = geo.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
  geo.translate(-center.x, -center.y, -center.z);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geoData.centeredGeo = geo;
  geoData.pivotOffset = center;
  return geoData;
}
