// Where dumped assets (bins, textures, alias maps) are fetched from, and the material->texture
// resolution - ported from web/server.js so the editor can fetch dump files directly as static files
// (no /api needed). The base is the URL the dump/dist is served at; override for a hosted deploy with
//   <script>window.PUGC_ASSET_BASE = 'https://cdn.example/pubg-assets'</script>
const ASSET_BASE = (typeof window !== 'undefined' && window.PUGC_ASSET_BASE) || 'dump';
// '' = fetch bins as-is (the node /dump server sends them, decompressing/Content-Encoding for us).
// 'gz' = the dist on a dumb static host stores bins as <bin>.gz; fetch that and inflate in the browser
// (DecompressionStream supports gzip but not brotli). Set window.PUGC_ASSET_ENCODING='gz' for that host.
const ASSET_ENCODING = (typeof window !== 'undefined' && (window.PUGC_ASSET_ENCODING || '')).toLowerCase();

// Fetch a mesh .bin as an ArrayBuffer, inflating client-side when the dist stores gzipped bins.
export async function fetchBin(binUrl) {
  if (ASSET_ENCODING === 'gz') {
    const r = await fetch(`${binUrl}.gz`);
    if (!r.ok) return null;
    const inflated = r.body.pipeThrough(new DecompressionStream('gzip'));
    return await new Response(inflated).arrayBuffer();
  }
  const r = await fetch(binUrl);
  return r.ok ? await r.arrayBuffer() : null;
}

// /Game/X.Y -> TslGame/Content/X  (drop the package's object suffix after the last slash).
export function normalizeGamePathForPak(gamePath) {
  const v = String(gamePath || '').trim()
    .replace(/^\/Game\//i, 'TslGame/Content/')
    .replace(/^Game\//i, 'TslGame/Content/');
  if (!v || v.toLowerCase() === 'none') return '';
  const slash = v.lastIndexOf('/');
  const dot = v.indexOf('.', slash + 1);
  return dot >= 0 ? v.slice(0, dot) : v;
}

// Material -> diffuse-texture alias map (built at dump time). Loaded once; case-insensitive fallback.
let _aliasPromise = null;
function aliasView() {
  if (!_aliasPromise) {
    _aliasPromise = fetch(`${ASSET_BASE}/_material_texture_aliases.json`)
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then(map => ({ map, lower: new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v])) }));
  }
  return _aliasPromise;
}
const baseName = (p) => String(p).replace(/\\/g, '/').split('/').pop();
const aliasLookup = (view, key) => (key && (view.map[key] || view.lower.get(String(key).toLowerCase()))) || '';

function resolveAlias(view, gamePath) {
  const normalized = normalizeGamePathForPak(gamePath);
  const bn = baseName(normalized);
  const direct = aliasLookup(view, normalized) || aliasLookup(view, bn);
  if (direct) return direct;
  // A tree's "..._wind_Branch" slot is a raw name with no package; branches are woody, so use the
  // sibling trunk's bark texture, then any aliased trunk for the same tree, then the leaf as a last resort.
  if (bn.toLowerCase().endsWith('_wind_branch')) {
    const stem = bn.slice(0, -'_wind_branch'.length);
    let hit = aliasLookup(view, stem + '_wind_Trunk');
    if (!hit) {
      const stemLower = stem.toLowerCase();
      for (const [k, v] of Object.entries(view.map)) {
        const kl = k.toLowerCase();
        if (kl.startsWith(stemLower) && kl.includes('trunk')) { hit = v; break; }
      }
    }
    return hit || aliasLookup(view, stem + '_wind_Leaf');
  }
  return '';
}

// Resolve a material/texture game path to its dumped webp URL, or null if unresolvable.
// Dump always produces .webp (pak-server DumpOptions default); no PNG fallback needed.
export async function textureUrls(gamePath) {
  const view = await aliasView();
  const rel = resolveAlias(view, gamePath) || normalizeGamePathForPak(gamePath);
  if (!rel) return null;
  return { webp: `${ASSET_BASE}/${rel}.webp` };
}

export const bpMeshUrls = (objectId) => ({
  bin: `${ASSET_BASE}/bp-mesh/${objectId}.bin`,
  meta: `${ASSET_BASE}/bp-mesh/${objectId}.json`,
});

// Every Vehicle Spawn entry shows the same Buggy, dumped once; any /Vehicles/ path maps to it.
const VEHICLE_PLACEHOLDER = '/Game/Vehicles/Buggy/BluePrint/Buggy.Buggy';
async function sha1Hex(str) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function assetMeshUrls(assetPath) {
  const p = /\/Vehicles\//i.test(assetPath) ? VEHICLE_PLACEHOLDER : assetPath;
  const hash = await sha1Hex(String(p));
  return { bin: `${ASSET_BASE}/asset-mesh/${hash}.bin`, meta: `${ASSET_BASE}/asset-mesh/${hash}.json` };
}

export const renderFlagsUrl = () => `${ASSET_BASE}/_material_render_flags.json`;

// A catalog icon/thumbnail is a direct texture game path (device icon or object thumbnail), already
// dumped as webp - no alias map needed, so this stays synchronous for use as an <img> src.
export function iconTextureUrl(gamePath) {
  const rel = normalizeGamePathForPak(gamePath);
  return rel ? `${ASSET_BASE}/${rel}.webp` : '';
}
