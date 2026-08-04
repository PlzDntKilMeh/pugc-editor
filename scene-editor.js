import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import {
  MIN_OBJECT_SCALE,
  clampObjectScaleValue,
  clampThreeScale,
  clampUeScale3D,
  multiplyScale3D,
  setPrecisionTest,
  threePosToUe4,
  threeQuatToUe4,
  threeScaleToUe4,
  ue4PosToThree,
  ue4QuatToThree,
  ue4ScaleToThree,
} from './scene-editor/coords.js';
import {
  createPatternToolFromSnapshot,
  getPatternTemplates,
  patternTemplatesKey,
  patternToolEulerDegrees,
  serializePatternTool,
} from './scene-editor/pattern-tools.js';
import {
  circleInputPrecision,
  circleSliderToNumber,
  formatCircleNumber,
  setInputValue,
  syncCircleRange,
  syncLinearRange,
} from './scene-editor/pattern-inputs.js';
import { createHistoryController } from './scene-editor/history.js';
import {
  SELECTION_COLOR as SEL_COLOR,
  SELECTION_OPACITY as SEL_OPACITY,
  applyItemSelection,
  clearItemSelection,
  itemNormalColor as itemNrmColor,
  selectionColorForIndex,
  setItemNormalMaterials,
  setItemSelectedMaterials,
} from './scene-editor/selection.js';
import {
  bindNumericInput,
  bindSliderInputPair,
  numericInputValue,
  sanitizeNumericText,
} from './scene-editor/form-utils.js';
import { trackEvent } from './scene-editor/analytics.js';
import {
  catalogKind,
  catalogLabel,
  cleanCategoryKey,
  placementCategoryKey,
  placementIconUrl,
  setNameTranslator,
} from './scene-editor/catalog-utils.js';
import {
  buildPlacementRows,
  placementCategories,
  selectedCatalogValue as formatSelectedCatalogValue,
} from './scene-editor/placement-catalog.js';
import { getObjectMeta as getCatalogObjectMeta } from './scene-editor/object-meta.js';
import { computePlacementBudgetRows } from './scene-editor/placement-budget.js';
import {
  clearBpGeoCache,
  clearTextureCache,
  decodeBpMesh,
  getAssetMeshGeo,
  getBpGeo,
  loadTexture,
  prepareEditorPivotGeo,
} from './scene-editor/mesh-assets.js';
import {
  disposeObjectMaterials,
  disposeSceneObject,
  frameObject as frameThreeObject,
} from './scene-editor/three-utils.js';
import { prepareBakedLevelScene } from './scene-editor/terrain-utils.js';
import {
  escHtml,
  setNumericInputValue,
} from './scene-editor/text-utils.js';
import {
  applyMultiSelectionTransform,
  createMultiTransformStart,
  objectEulerDegrees,
} from './scene-editor/transform-utils.js';
import { createPropsPanelController } from './scene-editor/props-panel.js';
import { applyOutOfRangeMode } from './scene-editor/device-fields.js';
import { createLogicGraph } from './scene-editor/logic-graph.js';
import { createGameSettingsController } from './scene-editor/game-settings.js';
import {
  getDevicePropPath,
  getDeviceFieldConnectionsForItems as _getDeviceFieldConnectionsForItems,
  getObjectIconUrl as _getObjectIconUrl,
  createDeviceLinkController,
} from './scene-editor/device-links.js';
import {
  applySelectionClasses,
  renderObjectList,
  scrollListToActiveItem,
} from './scene-editor/object-list.js';
import { renderPlacementPicker as renderPlacementPickerView } from './scene-editor/placement-picker.js';
import {
  clipboardAnchorToThree,
  clipboardEntryOffsetToThree,
  clonePlain,
  makeObjectsClipboardPayload,
  makePatternClipboardPayload,
  makePastedObject as makePastedObjectFromSource,
  objectClipboardEntries,
} from './scene-editor/clipboard-utils.js';
import { newSceneObject as createSceneObjectData } from './scene-editor/scene-object-factory.js';
import {
  fitCameraToItems,
  focusCircleTool,
  focusGridTool,
  focusSelectedItems,
} from './scene-editor/camera-focus.js';
import {
  applyFlyMovement as applyFlyMovementStep,
  formatFlySpeed,
  updateFpsHud as updateFpsHudState,
} from './scene-editor/viewport-motion.js';
import { createProjectFileController } from './scene-editor/project-files.js';
import { parseEditorSession } from './scene-editor/session-format.js';
import { getPugcCodec } from './scene-editor/codec/pugc-codec.js';
import {
  createEditorItem,
  disposeEditorItem,
  resetEditorItemToPlaceholder,
} from './scene-editor/scene-items.js';
import {
  applyOpacityToItems,
  applyRealMeshToItem,
  applyTextureToggleToItems,
  upgradeMeshesForItems,
} from './scene-editor/mesh-items.js';
import {
  getPugcObjectsFromJson,
  isCatalogDeviceObjectId,
  nextDeviceIndexForObject,
  removePugcObject as removePugcObjectFromArray,
} from './scene-editor/pugc-objects.js';

// --- Catalog ------------------------------------------------------------------

const catalog = { devices: {}, objects: {}, placementBudget: { rules: [] }, enums: {}, items: [], stringTables: {}, tags: [], tagCategories: [], translations: {}, saveFormat: {}, deviceFieldDefaults: {} };

// Display language for localized labels (tags etc.). Defaults to English; persisted across sessions.
// translations.json is culture -> namespace -> key -> text; tr() falls back en -> the baked English label.
let currentLang = 'en';
try { currentLang = localStorage.getItem('pugcLang') || 'en'; } catch { /* storage blocked */ }
function availableLanguages() {
  const set = new Set(['en', ...Object.keys(catalog.translations || {})]);
  return [...set].sort((a, b) => (a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b)));
}
function tr(ns, key, fallback) {
  if (!key) return fallback;
  const t = catalog.translations || {};
  return t[currentLang]?.[ns]?.[key] ?? t.en?.[ns]?.[key] ?? fallback;
}
// Enum option labels live in NS_UGC_ENUM keyed by each row's `key`. Return a localized clone of
// catalog.enums for the current language (cached), used by every enum dropdown.
// englishLabel is preserved alongside label so selectedEnumHint can match description lines
// (which are always English in the pak schema) regardless of the display language.
let _locEnumsLang = null, _locEnums = null;
function localizedEnums() {
  if (_locEnumsLang === currentLang && _locEnums) return _locEnums;
  const out = {};
  for (const [name, rows] of Object.entries(catalog.enums || {})) {
    out[name] = Array.isArray(rows)
      ? rows.map(r => ({
          ...r,
          englishLabel: r.label || r.value,
          label: tr('NS_UGC_ENUM', r.key, r.label || r.value),
        }))
      : rows;
  }
  _locEnumsLang = currentLang;
  _locEnums = out;
  return out;
}
// ASCII-only display names for the culture codes the game ships (per project ASCII-only rule).
const LANG_NAMES = {
  en: 'English', es: 'Spanish', 'es-MX': 'Spanish (Mexico)', fr: 'French', de: 'German', it: 'Italian',
  pl: 'Polish', pt: 'Portuguese', 'pt-BR': 'Portuguese (Brazil)', ru: 'Russian', tr: 'Turkish',
  ar: 'Arabic', ja: 'Japanese', ko: 'Korean', 'zh-CN': 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)', th: 'Thai', id: 'Indonesian', vi: 'Vietnamese',
};
function languageLabel(code) { return LANG_NAMES[code] || code; }
function setupLanguageSelect() {
  const sel = document.getElementById('langSelect');
  if (!sel) return;
  const langs = availableLanguages();
  sel.innerHTML = langs.map(c => `<option value="${c}"${c === currentLang ? ' selected' : ''}>${languageLabel(c)}</option>`).join('');
  sel.hidden = langs.length <= 1; // nothing to switch until translations.json ships >1 culture
  trackEvent('language_loaded', {
    language_code: currentLang
  });
  sel.addEventListener('change', () => {
    currentLang = sel.value || 'en';
    try { localStorage.setItem('pugcLang', currentLang); } catch { /* storage blocked */ }
    trackEvent('language_change', { language_code: currentLang });
    applyLanguageToUi();
  });
}

// Re-render the language-dependent UI after a language change: the object outliner, placement preview,
// the selected object's panel, and the Game Settings modal if open. (Device names localize; object names,
// which PUBG doesn't translate, keep their derived English label.)
function applyLanguageToUi() {
  // Each scene item caches its display name in item.meta (frozen at the language when placed); recompute
  // so the outliner rows and the selected object's name/type follow the language switch.
  for (const item of ITEMS) item.meta = getObjectMeta(item.ueObj.objectId);
  for (const item of referenceLogicItems) item.meta = { ...getObjectMeta(item.ueObj.objectId), isDevice: true };
  try { renderList(); } catch { /* not ready */ }
  try { updatePlacementPreview(); } catch { /* not ready */ }
  // placementRows/labels are built once at startup; rebuild + re-render the placeObjectMenu grid and
  // category list so device/object names and categories follow the language switch.
  try { populatePlacementCatalog(); } catch { /* not ready */ }
  try {
    const btnText = document.getElementById('placeObjectButtonText');
    const entry = placementCatalogEntry();
    if (btnText) btnText.textContent = entry ? catalogLabel(entry) : 'Choose an object';
  } catch { /* not ready */ }
  if (selected) { try { updatePropsPanel(selected); } catch { /* not ready */ } }
  // Logic graph node labels (device names, group labels) are baked at render time - redraw it
  // (if it's the visible view) so they follow the language switch too.
  try { refreshGraphIfActive(); } catch { /* not ready */ }
  if (!document.getElementById('gameSettingsModal')?.hidden) gameSettings?.renderGameSettings();
}
let placementRows = [];
let placementCategory = '';

async function loadCatalog() {
  const [d, o, b, enums, items, rules, stringTables, tags, tagCategories, translations, saveFormat, deviceFieldDefaults] = await Promise.all([
    fetch('data/catalog/devices.json').then(r => r.json()),
    fetch('data/catalog/objects.json').then(r => r.json()),
    fetch('data/catalog/placementBudget.json').then(r => r.ok ? r.json() : { rules: [] }).catch(() => ({ rules: [] })),
    fetch('data/catalog/enums.json').then(r => r.json()).catch(() => ({})),
    fetch('data/catalog/items.json').then(r => r.json()).catch(() => []),
    fetch('data/catalog/rules.json').then(r => r.ok ? r.json() : {}).catch(() => ({})),
    fetch('data/catalog/stringTables.json').then(r => r.ok ? r.json() : {}).catch(() => ({})),
    fetch('data/catalog/tags.json').then(r => r.ok ? r.json() : []).catch(() => []),
    fetch('data/catalog/tagCategories.json').then(r => r.ok ? r.json() : []).catch(() => []),
    fetch('data/catalog/translations.json').then(r => r.ok ? r.json() : {}).catch(() => ({})),
    // Optional: may not exist yet on older published sites until the next pak-server dump.
    fetch('data/catalog/saveFormat.json').then(r => r.ok ? r.json() : {}).catch(() => ({})),
    fetch('data/catalog/deviceFieldDefaults.json').then(r => r.ok ? r.json() : {}).catch(() => ({})),
  ]);
  Object.assign(catalog.devices, d);
  Object.assign(catalog.objects, o);
  catalog.placementBudget = b && Array.isArray(b.rules) ? b : { rules: [] };
  catalog.enums = enums || {};
  catalog.items = Array.isArray(items) ? items : [];
  catalog.rules = rules || {};
  catalog.stringTables = stringTables || {};
  catalog.tags = Array.isArray(tags) ? tags : [];
  catalog.tagCategories = Array.isArray(tagCategories) ? tagCategories : [];
  catalog.translations = translations && typeof translations === 'object' ? translations : {};
  catalog.saveFormat = saveFormat && typeof saveFormat === 'object' ? saveFormat : {};
  catalog.deviceFieldDefaults = deviceFieldDefaults && typeof deviceFieldDefaults === 'object' ? deviceFieldDefaults : {};
  if (!availableLanguages().includes(currentLang)) currentLang = 'en';
}

function populatePlacementCatalog() {
  placementRows = buildPlacementRows(catalog);
  const categories = placementCategories(placementRows);
  if (!placementCategory || !categories.includes(placementCategory)) placementCategory = categories[0] || '';
  renderPlacementPicker();
}

function setPlacementObject(objectId, { close = true, apply = true, keepTemplates = false } = {}) {
  if (!keepTemplates) {
    placementTemplates = null;
    placementTemplateVersion++;
  }
  const input = document.getElementById('placeObjectInput');
  if (input) input.value = selectedCatalogValue(objectId);
  const entry = catalog.objects[String(objectId)] || catalog.devices[String(objectId)] || null;
  const buttonText = document.getElementById('placeObjectButtonText');
  if (buttonText) buttonText.textContent = entry ? catalogLabel(entry) : 'Choose an object';
  if (entry) placementCategory = placementCategoryKey({ ...entry, kind: catalog.devices[String(objectId)] ? 'Device' : 'Object' });
  updatePlacementPreview();
  renderPlacementPicker();
  if (apply) applyPlacementInputsToSelected();
  if (close) document.getElementById('placeObjectMenu')?.setAttribute('hidden', '');
}

function renderPlacementPicker() {
  renderPlacementPickerView({
    categoryList: document.getElementById('placeCategoryList'),
    grid: document.getElementById('placeObjectGrid'),
    placementRows,
    placementCategory,
    selectedId: parsePlacementObjectId(),
    query: (document.getElementById('placeObjectSearch')?.value || '').trim().toLowerCase(),
    onCategoryChange: category => {
      placementCategory = category || placementCategory;
      renderPlacementPicker();
    },
    onObjectSelect: objectId => setPlacementObject(objectId),
  });
}

function placementCatalogEntry() {
  const objectId = parsePlacementObjectId();
  if (!Number.isFinite(objectId)) return null;
  return catalog.objects[String(objectId)] || catalog.devices[String(objectId)] || null;
}

function updatePlacementPreview() {
  const entry = placementCatalogEntry();
  const img = document.getElementById('placePreviewImg');
  const name = document.getElementById('placePreviewName');
  const type = document.getElementById('placePreviewType');
  if (!img || !name || !type) return;

  if (!entry) {
    img.removeAttribute('src');
    img.style.display = 'none';
    name.textContent = 'Choose an object';
    type.textContent = '';
    return;
  }

  name.textContent = catalogLabel(entry);
  type.textContent = `${catalogKind(entry, catalog.devices)} ${entry.objectId}${entry.subCategory ? ` - ${entry.subCategory.replace(/^EModObjectSubCategory::/, '')}` : ''}`;
  if (entry.iconTexture) {
    img.onload = () => { img.style.display = 'block'; };
    img.onerror = () => { img.style.display = 'none'; };
    img.src = placementIconUrl(entry);
  } else {
    img.removeAttribute('src');
    img.style.display = 'none';
  }
}

function getObjectMeta(objectId) {
  return getCatalogObjectMeta(catalog, objectId);
}

function getPlacedDevices(allowedObjectIds) {
  const allowedSet = Array.isArray(allowedObjectIds) && allowedObjectIds.length
    ? new Set(allowedObjectIds.map(Number))
    : null;
  return ITEMS
    .filter(item =>
      item.ueObj &&
      item.ueObj.deviceIndex !== -1 &&
      (!allowedSet || allowedSet.has(Number(item.ueObj.objectId)))
    )
    .map(item => {
      const meta = getObjectMeta(item.ueObj.objectId);
      const name = item.ueObj.userDeviceName || meta?.name || `Device ${item.ueObj.deviceIndex}`;
      return {
        objectId: Number(item.ueObj.objectId),
        deviceIndex: item.ueObj.deviceIndex,
        label: `#${item.ueObj.deviceIndex} ${name}`,
      };
    })
    .sort((a, b) => (a.deviceIndex ?? 0) - (b.deviceIndex ?? 0));
}

function isDeviceTagPath(path) {
  const leaf = String(path || '').split('.').pop().toLowerCase();
  return leaf === 'tag' || leaf.endsWith('tag') || leaf.includes('playertag');
}

function collectTagStringsFromProps(value, path, tags) {
  if (typeof value === 'string') {
    if (isDeviceTagPath(path) && value.trim()) tags.add(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, idx) => collectTagStringsFromProps(entry, `${path}[${idx}]`, tags));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    collectTagStringsFromProps(child, path ? `${path}.${key}` : key, tags);
  }
}

function deviceTagsForItem(item) {
  const tags = new Set();
  const ueObj = item?.ueObj || item;
  const dev = catalog.devices[String(ueObj?.objectId)];
  if (!ueObj?.devicePropertyData) return tags;
  let props;
  try { props = JSON.parse(ueObj.devicePropertyData); } catch { return tags; }
  collectTagStringsFromProps(props, '', tags);
  for (const field of dev?.fields || []) {
    if (field.type !== 'String' || !isDeviceTagPath(field.path)) continue;
    const value = getDevicePropPath(props, field.path);
    if (typeof value === 'string' && value.trim()) tags.add(value.trim());
  }
  return tags;
}

function collectDeviceTagsFromItems(items) {
  const tags = new Set();
  for (const item of items || []) for (const t of deviceTagsForItem(item)) tags.add(t);
  return [...tags].sort((a, b) => a.localeCompare(b));
}

function usedDeviceTags() {
  return collectDeviceTagsFromItems(getPugcObjects() || []);
}

function referenceUsedDeviceTags() {
  return collectDeviceTagsFromItems(referenceLogicItems);
}

function getDeviceFieldConnectionsForItems(items) {
  return _getDeviceFieldConnectionsForItems(items, catalog);
}

function getDeviceFieldConnections() {
  return getDeviceFieldConnectionsForItems(ITEMS);
}

function disposeDeviceLinkObjects() {
  deviceLinks?.dispose();
}

function updateDeviceLinkLines() {
  deviceLinks?.update();
}

function getObjectIconUrl(objectId) {
  return _getObjectIconUrl(objectId, catalog);
}

// --- Coordinate conversion: UE4 (cm, left-hand Z-up) <-> Three.js (m, right-hand Y-up)
// UE4 (x,y,z) -> Three.js (x/100, z/100, y/100)   det=-1: correct left->right handedness change
// Quaternion: ue(qx,qy,qz,qw) -> three(qx, qz, qy, qw)
// Scale: ue(sx,sy,sz) -> three(sx, sz, sy)   [only axis-swap, magnitudes unchanged]

function renderPlacementBudget() {
  const panel = document.getElementById('limitPanel');
  if (!panel) return;
  const objects = getPugcObjects() || [];
  const rows = computePlacementBudgetRows(objects, catalog);
  const summary = document.getElementById('budgetOverlaySummary');
  const overCount = rows.filter(row => Number.isFinite(row.limit) && row.weighted > row.limit).length;
  if (summary) {
    summary.textContent = overCount
      ? `${overCount} over limit`
      : `${objects.length.toLocaleString()} object${objects.length === 1 ? '' : 's'}`;
    summary.classList.toggle('over', overCount > 0);
  }
  const body = rows.map(row => {
    const limit = Number.isFinite(row.limit) ? row.limit : null;
    const over = limit !== null && row.weighted > limit;
    const full = limit !== null && row.weighted === limit;
    const cls = over ? ' over' : (full ? ' full' : '');
    const value = Number.isInteger(row.weighted) ? row.weighted : row.weighted.toFixed(1);
    const count = row.count !== row.weighted ? ` (${row.count})` : '';
    const limitText = limit === null ? '?' : String(limit);
    return `<div class="scene-limit-row${cls}">
      <span>${escHtml(row.label)}</span>
      <strong>${escHtml(value)}${escHtml(count)} / ${escHtml(limitText)}</strong>
    </div>`;
  }).join('');
  panel.innerHTML = `<div class="scene-limit-title">
    <span>Placement Budget</span>
    <span>weighted</span>
  </div>${body}`;
}

// --- Blueprint mesh loading ---------------------------------------------------

function transformedPivotOffset(item) {
  const offset = item.pivotOffset ?? new THREE.Vector3();
  return offset.clone().multiply(item.group.scale).applyQuaternion(item.group.quaternion);
}

function editorPivotToRootPosition(item) {
  return item.group.position.clone().sub(transformedPivotOffset(item));
}

// --- Three.js scene globals ---------------------------------------------------

let scene, camera, renderer, orbitControls, transformControls, raycaster;
const WORLD_START_TARGET = new THREE.Vector3(); // default camera look-at (middle of the map)
const ITEMS = [];   // { ueObj, group, mesh, mat, meta }
let selected = null;
let selAlignActive = false;
const selectedItems = new Set();
const CIRCLE_TOOLS = [];
let selectedCircle = null;
let circleToolSeq = 1;
const GRID_TOOLS = [];
let selectedGrid = null;
let gridToolSeq = 1;
const COLLECTIONS = [];
let selectedCollection = null;
let selectedBase = null; // { tool, type, templateIndex } - editing a tool's slot-0 source object
let collectionSeq = 1;
let copiedPayload = null;
let placementTemplates = null;
let placementTemplateVersion = 0;
const flyKeys = new Set();
let bakedLevelGroup = null;
let deviceLinks = null;
let showAiPaths = true; // device link traces (AI travel paths) visibility
let showDeviceIcons = true; // floating device symbol sprites

const VIEWER_SETTINGS_KEY = 'pugc.viewerSettings';
function saveViewerSettings() {
  try {
    localStorage.setItem(VIEWER_SETTINGS_KEY, JSON.stringify({
      areas: viewerAreaVisible, aiPaths: showAiPaths, deviceIcons: showDeviceIcons, textures: loadTextures, opacity: nrmOpacity,
      skyboxBrightness,
    }));
  } catch {}
}
function loadViewerSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(VIEWER_SETTINGS_KEY) || 'null');
    if (!s) return;
    if (s.areas) for (const id in viewerAreaVisible) if (id in s.areas) viewerAreaVisible[id] = !!s.areas[id];
    if (typeof s.aiPaths === 'boolean') showAiPaths = s.aiPaths;
    if (typeof s.deviceIcons === 'boolean') showDeviceIcons = s.deviceIcons;
    if (typeof s.textures === 'boolean') loadTextures = s.textures;
    if (typeof s.opacity === 'number') nrmOpacity = s.opacity;
    if (typeof s.skyboxBrightness === 'number') skyboxBrightness = Math.max(0, Math.min(s.skyboxBrightness, 3));
  } catch {}
}
function applyDeviceIconVisibility() {
  for (const item of ITEMS) if (item.iconSprite) item.iconSprite.visible = showDeviceIcons;
}
let flySpeed = 1.0;
let rightLookActive = false, rightLookLastX = 0, rightLookLastY = 0;
const fpsState = { lastTime: performance.now(), frameCount: 0, displayValue: 0 };

let nrmOpacity  = 1.0;
let loadTextures = true;
let skyboxBrightness = 0.5;
const HISTORY_LIMIT = 60;
let history = null;
let multiTransformStart = null;
const HDR_SKYBOX_PATH = 'cache/T_Sky_Desert_FoggyRain.hdr';

function updateSkyboxBrightnessLabel() {
  const value = document.getElementById('skyboxBrightnessValue');
  if (value) value.textContent = Math.round(skyboxBrightness * 100) + '%';
}

function applySkyboxBrightness() {
  if (scene) {
    scene.backgroundIntensity = skyboxBrightness;
    scene.environmentIntensity = skyboxBrightness;
  }
  if (renderer) renderer.toneMappingExposure = skyboxBrightness;
  updateSkyboxBrightnessLabel();
}

const _precOriginals = new Map(); // item -> { rootPos: THREE.Vector3, quaternion: THREE.Quaternion }

function capturePrecOriginal(item) {
  if (!_precOriginals.has(item)) {
    _precOriginals.set(item, {
      rootPos: editorPivotToRootPosition(item).clone(),
      quaternion: item.group.quaternion.clone(),
    });
  }
}

function snapItemToRoundedUe4(item) {
  item.group.quaternion.copy(ue4QuatToThree(item.ueObj.spawnTransform.rotation));
  item.group.position.copy(ue4PosToThree(item.ueObj.spawnTransform.translation)).add(transformedPivotOffset(item));
}

function applyPrecisionTest() {
  const transVal = document.getElementById('precTransDecimals')?.value ?? 'full';
  const rotVal = document.getElementById('precRotDecimals')?.value ?? 'full';
  const mode = document.getElementById('precRoundMode')?.value || 'round';
  const rotFormat = document.getElementById('precRotFormat')?.value || 'quat';
  const rotSnapDeg = Math.max(0, Number(document.getElementById('precRotSnap')?.value || 0));
  const transPrecision = transVal === 'full' ? null : Number(transVal);
  const rotPrecision = rotVal === 'full' ? null : Number(rotVal);
  setPrecisionTest({ translation: transPrecision, rotation: rotPrecision, mode, rotFormat, rotSnapDeg });

  const active = transPrecision !== null || rotPrecision !== null || rotSnapDeg > 0;

  for (const item of ITEMS) {
    if (active) {
      capturePrecOriginal(item);
      const orig = _precOriginals.get(item);
      item.ueObj.spawnTransform.translation = threePosToUe4(orig.rootPos);
      item.ueObj.spawnTransform.rotation = threeQuatToUe4(orig.quaternion);
      snapItemToRoundedUe4(item);
    } else {
      const orig = _precOriginals.get(item);
      if (orig) {
        item.group.quaternion.copy(orig.quaternion);
        item.group.position.copy(orig.rootPos).add(transformedPivotOffset(item));
        item.ueObj.spawnTransform.translation = threePosToUe4(orig.rootPos);
        item.ueObj.spawnTransform.rotation = threeQuatToUe4(orig.quaternion);
      }
    }
  }
  if (!active) _precOriginals.clear();

  for (const tool of CIRCLE_TOOLS) {
    rebuildCircleTool(tool);
    if (active) for (const item of tool.items) snapItemToRoundedUe4(item);
  }
  for (const tool of GRID_TOOLS) {
    rebuildGridTool(tool);
    if (active) for (const item of tool.items) snapItemToRoundedUe4(item);
  }

  const status = document.getElementById('precStatus');
  if (!status) return;
  if (!active) {
    status.textContent = 'Full precision (no rounding)';
  } else {
    const parts = [];
    if (transPrecision !== null) parts.push(`trans: ${transPrecision}dp`);
    if (rotSnapDeg > 0) parts.push(`rot snap: ${rotSnapDeg}deg`);
    else if (rotPrecision !== null) parts.push(`rot: ${rotPrecision}dp ${rotFormat === 'euler' ? 'euler' : 'quat'}`);
    if (!rotSnapDeg && (transPrecision !== null || rotPrecision !== null)) parts.push(mode);
    status.textContent = `Active - ${parts.join(', ')}`;
  }
}

async function fetchGzipArrayBuffer(url) {
  if (typeof DecompressionStream !== 'function') return null;
  const res = await fetch(url);
  if (!res.ok || !res.body) return null;
  const inflated = res.body.pipeThrough(new DecompressionStream('gzip'));
  return await new Response(inflated).arrayBuffer();
}

async function loadHdrSkybox() {
  const loader = new RGBELoader();
  const applySkyboxTexture = texture => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = texture;
    scene.environment = texture;
    applySkyboxBrightness();
  };
  const loadTextureUrl = url => new Promise((resolve, reject) => {
    loader.load(url, texture => { applySkyboxTexture(texture); resolve(texture); }, undefined, reject);
  });

  try {
    const buffer = await fetchGzipArrayBuffer(`${HDR_SKYBOX_PATH}.gz`);
    if (buffer) {
      const blobUrl = URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' }));
      try {
        await loadTextureUrl(blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
      return;
    }
  } catch (error) {
    console.warn('HDR skybox gzip load failed, falling back to raw HDR.', error);
  }

  loadTextureUrl(HDR_SKYBOX_PATH).catch(error => {
    console.warn('HDR skybox load failed.', error);
  });
}

function initThree() {
  const canvas = document.getElementById('sceneCanvas');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1117);
  scene.fog = new THREE.FogExp2(0x0d1117, 0.00025);

  camera = new THREE.PerspectiveCamera(55, 1, 0.5, 80000);
  // Start near the middle of the map (UE ~36867, 55351, 9632) instead of world origin.
  WORLD_START_TARGET.copy(ue4PosToThree({ x: 36867, y: 55351, z: 9632 }));
  camera.position.copy(WORLD_START_TARGET).add(new THREE.Vector3(0, 300, 600));

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  applySkyboxBrightness();
  loadHdrSkybox();

  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const sun = new THREE.DirectionalLight(0xfff5e0, 1.0);
  sun.position.set(300, 600, 200);
  scene.add(sun);

  const grid = new THREE.GridHelper(4000, 400, 0x1e2d40, 0x1a2535);
  scene.add(grid);

  raycaster = new THREE.Raycaster();

  orbitControls = new OrbitControls(camera, canvas);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.07;
  orbitControls.maxDistance = 40000;
  orbitControls.screenSpacePanning = true;
  orbitControls.target.copy(WORLD_START_TARGET);
  orbitControls.mouseButtons.RIGHT = -1; // right-drag handled as first-person look below
  // Left-drag no longer orbits: a mis-drag while trying to grab an object used to fling the camera
  // around a possibly-distant orbit target. Left is now select / box-select; orbit moves to the
  // middle button (drag), and right-drag look + WASD fly + wheel-zoom remain the primary nav.
  orbitControls.mouseButtons.LEFT = -1;
  orbitControls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;

  transformControls = new TransformControls(camera, canvas);
    transformControls.setSize(1.4);
    transformControls.addEventListener('dragging-changed', (e) => {
      orbitControls.enabled = !e.value;
      if (e.value) {
        beginHistory('Transform');
        beginMultiTransform();
      } else {
        multiTransformStart = null;
        commitHistory('Transform');
      }
    });
    transformControls.addEventListener('objectChange', onTransformChange);
    transformControls.addEventListener('mouseUp', () => {
      if (selectedCircle) updateCirclePropsPanel(selectedCircle);
      if (selectedGrid) updateGridPropsPanel(selectedGrid);
      // A scale change alters the group scale the volume box counters; rebuild it.
      for (const it of selectedItems) updateDeviceVolume(it);
    });
  scene.add(transformControls);

  new ResizeObserver(onResize).observe(document.getElementById('viewport'));
  onResize();

  // Left button: a short press selects (onCanvasClick); a drag draws a marquee that box-selects every
  // item whose centre falls inside it. Press/move/up live on window so a drag that leaves the canvas
  // still finalises. Box-select is suppressed when the press lands on the transform gizmo.
  let mouseDownAt = { x: 0, y: 0 };
  let leftDownOnCanvas = false;
  let boxSelStart = null;
  let boxSelActive = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    mouseDownAt = { x: e.clientX, y: e.clientY };
    leftDownOnCanvas = true;
    if (transformControls.axis) return; // grabbing a gizmo axis - let it drag, no marquee
    boxSelStart = { x: e.clientX, y: e.clientY };
    boxSelActive = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (!boxSelStart) return;
    if (!boxSelActive && Math.hypot(e.clientX - boxSelStart.x, e.clientY - boxSelStart.y) < 5) return;
    boxSelActive = true;
    drawBoxSelRect(boxSelStart, { x: e.clientX, y: e.clientY });
  });
  window.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return;
    const onCanvas = leftDownOnCanvas;
    leftDownOnCanvas = false;
    const wasBox = boxSelActive;
    const start = boxSelStart;
    boxSelStart = null;
    boxSelActive = false;
    hideBoxSelRect();
    if (!onCanvas) return; // press began on a panel/UI element, not the 3D canvas
    if (wasBox && start) {
      boxSelectItems(
        { x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY) },
        { x: Math.max(start.x, e.clientX), y: Math.max(start.y, e.clientY) },
        e.shiftKey || e.ctrlKey || e.metaKey,
      );
      return;
    }
    if (Math.hypot(e.clientX - mouseDownAt.x, e.clientY - mouseDownAt.y) < 5) onCanvasClick(e);
  });

  // Right-click first-person look (yaw around world-Y, pitch around camera-X)
  const _worldUp   = new THREE.Vector3(0, 1, 0);
  const _localRight = new THREE.Vector3(1, 0, 0);
  const _lookFwd   = new THREE.Vector3();

  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    clearFlyInput();
  });
  // Always swallow the context menu (and stop fly input) - during a right-drag look the pointer is
  // captured to the window, so on release the contextmenu event's target may not be #viewport;
  // checking the target there let the menu through when shift was held. Unconditional is correct
  // for a fullscreen editor and prevents the "menu pops up on right-release" case.
  document.addEventListener('contextmenu', e => {
    e.preventDefault();
    clearFlyInput();
  }, { capture: true });
  // If focus is stolen (e.g. a menu, alt-tab) the keyup for held movement keys never arrives, so
  // the camera keeps drifting. Clear all input on blur so movement stops cleanly.
  window.addEventListener('blur', clearFlyInput);
  document.addEventListener('pointerdown', e => {
    if (e.button !== 2 || !e.shiftKey) return;
    clearFlyInput();
    if (e.target.closest?.('#viewport')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, { capture: true });

  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 2) return;
    rightLookActive = true;
    rightLookLastX = e.clientX;
    rightLookLastY = e.clientY;
  });
  window.addEventListener('pointermove', e => {
    if (!rightLookActive) return;
    const dx = e.clientX - rightLookLastX;
    const dy = e.clientY - rightLookLastY;
    rightLookLastX = e.clientX;
    rightLookLastY = e.clientY;
    if (!dx && !dy) return;
    const camDist = camera.position.distanceTo(orbitControls.target);
    camera.rotateOnWorldAxis(_worldUp, -dx * 0.003);
    camera.rotateOnAxis(_localRight, -dy * 0.003);
    camera.getWorldDirection(_lookFwd);
    orbitControls.target.copy(camera.position).addScaledVector(_lookFwd, camDist);
  });
  window.addEventListener('pointerup', e => {
    if (e.button === 2) rightLookActive = false;
  });
  window.addEventListener('pointercancel', clearFlyInput);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearFlyInput();
  });

  // Scroll while right-look is active -> adjust fly speed instead of zooming
  canvas.addEventListener('wheel', e => {
    if (!rightLookActive) return;
    e.preventDefault();
    e.stopPropagation();
    flySpeed = Math.max(0.01, Math.min(flySpeed * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 200));
    updateSpeedHud();
  }, { passive: false, capture: true });
}

function onResize() {
  const vp = document.getElementById('viewport');
  const w = vp.clientWidth, h = vp.clientHeight;
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

function applyFlyMovement() {
  applyFlyMovementStep({ camera, orbitControls, flyKeys, flySpeed });
}

function animate() {
  requestAnimationFrame(animate);
  if (graphActive) return; // graph overlay is shown; the 3D view is occluded, so skip rendering it
  applyFlyMovement();
  orbitControls.update();
  renderer.render(scene, camera);
  updateFpsHud();
}

function updateFpsHud(now = performance.now()) {
  updateFpsHudState(fpsState, document.getElementById('fpsValue'), now);
}

// --- Placeholder geometry -----------------------------------------------------

function createItem(ueObj, meta) {
  return createEditorItem(ueObj, meta, nrmOpacity);
}

// Replace placeholder with real mesh geometry and textures (async).
async function applyRealMesh(item, geoData, { allowReplace = false } = {}) {
  await applyRealMeshToItem(item, geoData, {
    isSelected: candidate => selectedItems.has(candidate) || isToolSourceItem(candidate),
    loadTextures,
    loadTexture,
    normalOpacity: nrmOpacity,
    selectionColor: SEL_COLOR,
    selectionOpacity: SEL_OPACITY,
    prepareEditorPivotGeo,
    rootPositionForItem: editorPivotToRootPosition,
    pivotOffsetForItem: transformedPivotOffset,
    positionToUe4: threePosToUe4,
    allowReplace,
  });
  if (item === selected) updatePropsPanel(item);
}

// Resolve a device's selected pick-list value (meshName / spawnVehicleName) to a game asset path via
// stringTables.json. Returns null when the device has no DataTable-backed mesh field or none chosen.
function deviceMeshAssetFor(ueObj) {
  const dev = catalog.devices?.[String(ueObj?.objectId)];
  if (!dev || !Array.isArray(dev.fields)) return null;
  let props = null;
  for (const f of dev.fields) {
    if (f.type !== 'String') continue;
    const t = f.validatorParam?.stringDataTable;
    if (!t || t === 'None') continue;
    const rows = catalog.stringTables?.[t];
    if (!Array.isArray(rows)) continue;
    if (!props) { try { props = JSON.parse(ueObj.devicePropertyData || '{}'); } catch { props = {}; } }
    const val = f.path.split('.').reduce((o, k) => (o == null ? o : o[k]), props);
    if (val == null || val === '') continue;
    const sval = String(val);
    // value IS the DataStr (asset path). Only return it if it's an actual asset path (contains '/').
    // Non-path values (e.g. BGM sound names like "BGM_Landmark") have no mesh asset.
    if (sval.includes('/')) return sval;
    const row = rows.find(r => String(r.value ?? r.asset ?? '') === sval);
    if (row) {
      const asset = String(row.value ?? row.asset ?? '');
      if (asset.includes('/')) return asset;
    }
  }
  return null;
}

// Switch a device item's preview mesh to its currently-selected pick-list asset, if that changed.
async function swapDeviceMeshIfNeeded(item) {
  if (!item) return;
  const asset = deviceMeshAssetFor(item.ueObj);
  if (!asset || item.currentMeshAsset === asset) return;
  item.currentMeshAsset = asset;
  const geoData = await getAssetMeshGeo(asset);
  // currentMeshAsset may have changed again while awaiting; don't clobber a newer selection.
  if (item.currentMeshAsset !== asset) return;
  if (!geoData) {
    // Asset isn't available (404 - not dumped or unconvertible). Show the default placeholder rather
    // than leaving the previously loaded mesh in place.
    if (item.hasRealMesh) resetEditorItemToPlaceholder(item, nrmOpacity);
    if (item === selected) updatePropsPanel(item);
    return;
  }
  await applyRealMesh(item, geoData, { allowReplace: true });
}

// Staggered async loader: fetch unique objectIds a few at a time
async function startMeshUpgrades() {
  // Devices with a per-instance pick-list mesh (meshName / spawnVehicleName) resolve their own asset
  // and can't be batched by objectId - two instances of the same device may select different meshes.
  // Everything else shares one mesh per objectId.
  const assetItems = [];
  const rest = [];
  for (const item of ITEMS) {
    if (deviceMeshAssetFor(item.ueObj)) assetItems.push(item);
    else if (!SUPPRESS_BP_MESH_IDS.has(String(item.ueObj.objectId))) rest.push(item);
    // else: volume-only device (e.g. Conquest 23) - no mesh, keep the placeholder + volume.
  }

  await upgradeMeshesForItems(rest, { getGeo: getBpGeo, applyRealMesh });

  // Per-instance asset meshes (getAssetMeshGeo is cached per asset, so duplicates share a fetch).
  const CONCURRENCY = 4;
  for (let i = 0; i < assetItems.length; i += CONCURRENCY)
    await Promise.all(assetItems.slice(i, i + CONCURRENCY).map(upgradeItemMesh));

  setStatus(`${ITEMS.length} objects - meshes loaded`);
}

// --- Viewport settings --------------------------------------------------------

function updateSpeedHud() {
  const el = document.getElementById('flySpeedDisplay');
  if (el) el.textContent = formatFlySpeed(flySpeed);
}

function clearFlyInput() {
  flyKeys.clear();
  rightLookActive = false;
}

function applyOpacityToAll() {
  applyOpacityToItems(ITEMS, { selected, normalOpacity: nrmOpacity });
  const tool = selectedCircle || selectedGrid;
  if (tool) updateToolSourceHighlight(tool, true);
}

async function applyTextureToggle() {
  await applyTextureToggleToItems(ITEMS, {
    selected,
    loadTextures,
    loadTexture,
    selectionColor: SEL_COLOR,
  });
  const tool = selectedCircle || selectedGrid;
  if (tool) updateToolSourceHighlight(tool, true);
}

// --- Terrain -----------------------------------------------------------------

const BAKED_LEVEL_PATH = 'cache/mod_main_level.glb';

function frameObject(root) {
  frameThreeObject(root, { camera, orbitControls });
}

async function tryLoadBakedLevel() {
  // Stable URL + default cache so the (large) baked level is reused from the browser cache. The server
  // sends a validator/max-age; after re-baking the .glb, hard-refresh (Ctrl+F5) to pick it up.
  const res = await fetch(BAKED_LEVEL_PATH);
  if (!res.ok) return false;
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const gltf = await new GLTFLoader().loadAsync(objectUrl);
    if (bakedLevelGroup) {
      scene.remove(bakedLevelGroup);
      disposeSceneObject(bakedLevelGroup);
    }
    bakedLevelGroup = prepareBakedLevelScene(gltf.scene);
    scene.add(bakedLevelGroup);
    frameObject(bakedLevelGroup);
    setStatus(`Baked level loaded - ${BAKED_LEVEL_PATH}`);
    return true;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function loadBaseTerrain() {
  const btn = document.getElementById('btnLoadWorld');
  if (btn) btn.disabled = true;
  setStatus('Loading baked level...');
  try {
    if (!await tryLoadBakedLevel())
      setStatus(`Baked level not found - place mod_main_level.glb in web/cache/`, true);
  } catch (err) {
    setStatus(`Baked level error: ${err.message}`, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}


// --- Scene build / clear ------------------------------------------------------

function clearScene(clearGeo = true) {
  deselectObject();
  for (const tool of CIRCLE_TOOLS) {
    scene.remove(tool.group);
    disposeSceneObject(tool.group);
  }
  CIRCLE_TOOLS.length = 0;
  selectedCircle = null;
  for (const tool of GRID_TOOLS) {
    scene.remove(tool.group);
    disposeSceneObject(tool.group);
  }
  GRID_TOOLS.length = 0;
  selectedGrid = null;
  COLLECTIONS.length = 0;
  selectedCollection = null;
  collectionSeq = 1;
  selectedItems.clear();
  for (const item of ITEMS) {
    disposeEditorItem(item, scene);
  }
  ITEMS.length = 0;
  disposeDeviceLinkObjects();
  if (clearGeo) {
    clearBpGeoCache();
    clearTextureCache();
  }
}

function buildScene(objects) {
  clearScene();
  for (const ueObj of objects) {
    buildSceneItem(ueObj);
  }
  resetCameraToStart();
  renderList();
  if (!ITEMS.length) {
    setStatus('No objects in project');
    return;
  }
  setStatus(`${ITEMS.length} objects loaded - fetching meshes...`);
  startMeshUpgrades();
  updateDeviceLinkLines();
  logicGraph?.resetView(); // re-fit the logic graph to the newly loaded scene
  refreshGraphIfActive();
}

function buildSceneItem(ueObj) {
  const meta = getObjectMeta(ueObj.objectId);
  const item = createItem(ueObj, meta);
  item.group.userData.itemRef = item;
  scene.add(item.group);
  ITEMS.push(item);
  decorateDeviceItem(item);
  return item;
}

// Visualize an area-volume device's configured shape so its coverage is visible in the scene.
// volumeShape picks Box (boxExtent = UE cm half-extent vector), Cube (cubeExtent = half-size) or
// Sphere (sphereRadius). Devices: Area Blocking 5 (Box), Trigger Area 6 (Box/Sphere), Conquest 23
// (Box/Cube/Sphere), Vehicle Spawn 25 (Sphere), Blue Zone 42. Drawn as a translucent fill + wireframe.
// Per-device-type default colours. (The visualizeColor/lightColor enums are not enumerated in the
// catalog, so their stored values can't be reliably mapped to RGB - we use stable defaults instead.)
const DEVICE_VOLUME_DEFAULT_COLOR = { '5': 0xff7a3a, '6': 0x35d0ff, '23': 0x9be24a, '25': 0xffd24a, '42': 0x3aa0ff, '47': 0x3ad5a0 };

// Devices whose blueprint mesh is only a unit-size boundary placeholder (e.g. Conquest 23's two
// overlapping capture-line cylinders). The translucent volume already represents the area, so the
// mesh would just double-render at the wrong scale - skip it and keep the volume + icon.
const SUPPRESS_BP_MESH_IDS = new Set(['23']);

function deviceProps(ueObj) {
  try { return ueObj.devicePropertyData ? JSON.parse(ueObj.devicePropertyData) : null; } catch { return null; }
}
function readVec3(b) {
  if (Array.isArray(b)) return { x: +b[0] || 0, y: +b[1] || 0, z: +b[2] || 0 };
  if (b && (b.x != null || b.y != null || b.z != null)) return { x: +b.x || 0, y: +b.y || 0, z: +b.z || 0 };
  return null;
}
function deviceVolumeColor(id) {
  return DEVICE_VOLUME_DEFAULT_COLOR[id] ?? 0x9ad0ff;
}
function disposeVolumeGroup(group) {
  group.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
}

// Devices whose spatial extent is a single radius (UE cm) rather than a volumeShape: drawn as a sphere.
const DEVICE_RADIUS_FIELD = { '2': 'enemyDetectionSize', '24': 'zoneRadius', '26': 'zoneRadius', '33': 'attenuationRadius' };
const DEVICE_RADIUS_COLOR = { '2': 0x53d769, '24': 0xff5a4a, '26': 0xff8a3a, '33': 0xffdf7a };
function deviceRadiusColor(id) {
  return DEVICE_RADIUS_COLOR[id] ?? 0x9ad0ff;
}
// Area/volume device types shown in the Viewer Settings toggle panel, with default visibility.
const AREA_DEVICE_TYPES = [
  { id: '5', name: 'Area Blocking', on: true }, { id: '6', name: 'Trigger Area', on: true }, { id: '23', name: 'Conquest Area', on: true },
  { id: '47', name: 'Checkpoint', on: true },
  { id: '25', name: 'Vehicle Spawn', on: false }, { id: '42', name: 'Blue Zone Gen', on: false }, { id: '24', name: 'Red Zone', on: false },
  { id: '26', name: 'Special Zone', on: false }, { id: '33', name: 'Light range', on: false }, { id: '2', name: 'Spawn detect', on: false },
];
const viewerAreaVisible = {};
for (const t of AREA_DEVICE_TYPES) viewerAreaVisible[t.id] = t.on;
function areaVisible(id) { return viewerAreaVisible[id] !== false; }
function reconcileAreaVolumes(id) {
  for (const item of ITEMS) if (String(item.ueObj.objectId) === id) updateDeviceVolume(item);
}
// Parse a numeric prop, falling back to dflt only when unset/blank/NaN - a real 0 stays 0 (so a
// 0 radius/size draws nothing instead of snapping to the default).
function numOr(v, dflt) {
  const n = Number(v);
  return (v == null || v === '' || Number.isNaN(n)) ? dflt : n;
}

function updateDeviceVolume(item) {
  if (item.volumeBox) { item.group.remove(item.volumeBox); disposeVolumeGroup(item.volumeBox); item.volumeBox = null; }
  const id = String(item.ueObj.objectId);
  const fields = catalog.devices[id]?.fields || [];
  const hasVolume = fields.some(f => ['boxExtent', 'sphereRadius', 'cubeExtent'].includes(f.path));
  const hasCheckpointShape = fields.some(f => f.path === 'shape' && f.unrealType === 'ECheckpointShape');
  const radiusField = DEVICE_RADIUS_FIELD[id];
  if (!hasVolume && !hasCheckpointShape && !radiusField) return; // nothing spatial to draw
  if (!areaVisible(id)) return; // hidden via Viewer Settings toggle

  const props = deviceProps(item.ueObj);
  const s = item.group.scale; // counter-scale so the drawn volume is true world size
  let geo, color;
  if (hasCheckpointShape) {
    // CheckPointDevice: ECheckpointShape Square (width x height gate) or Circle (cylinder).
    color = deviceVolumeColor(id, props);
    const shape = String(props?.shape || 'Square');
    if (shape === 'Circle') {
      const r = numOr(props?.radius, 250) / 100 / (s.z || 1);
      geo = new THREE.CylinderGeometry(r, r, 0.5 / (s.x || 1), 32);
      geo.rotateZ(Math.PI / 2);
    } else {
      const w = numOr(props?.width, 300) / 100 / (s.z || 1);
      const h = numOr(props?.height, 300) / 100 / (s.y || 1);
      geo = new THREE.BoxGeometry(0.5 / (s.x || 1), h, w);
    }
  } else if (hasVolume) {
    // Shape: explicit volumeShape, else the device's only allowed shape, else Box.
    const allowed = fields.find(f => f.path === 'volumeShape')?.validatorParam?.selectEnums || [];
    const shape = String(props?.volumeShape || allowed[0] || 'Box').toLowerCase();
    if (shape === 'sphere') {
      geo = new THREE.SphereGeometry(numOr(props?.sphereRadius, 250) / 100 / (s.x || 1), 24, 16);
    } else if (shape === 'cube') {
      const c = numOr(props?.cubeExtent, 250);
      geo = new THREE.BoxGeometry((2 * c / 100) / (s.x || 1), (2 * c / 100) / (s.y || 1), (2 * c / 100) / (s.z || 1));
    } else {
      const e = readVec3(props?.boxExtent) || { x: 250, y: 250, z: 250 };
      geo = new THREE.BoxGeometry((2 * e.x / 100) / (s.x || 1), (2 * e.z / 100) / (s.y || 1), (2 * e.y / 100) / (s.z || 1));
    }
    color = deviceVolumeColor(id, props);
  } else {
    // Radius zone (Red/Special zone, Light reach, spawn detection) - a sphere of the given radius.
    geo = new THREE.SphereGeometry(numOr(props?.[radiusField], 500) / 100 / (s.x || 1), 24, 16);
    color = deviceRadiusColor(id, props);
  }

  const group = new THREE.Group();
  const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }));
  fill.renderOrder = 2;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
  edges.renderOrder = 3;
  group.add(fill, edges);
  group.traverse(o => { o.raycast = () => {}; }); // never block picking the device itself
  item.group.add(group);
  item.volumeBox = group;
}

// Floating device symbol (the device's catalog icon) above each device, as a camera-facing sprite.
const _deviceIconTex = new Map();
function deviceIconTexture(url) {
  if (_deviceIconTex.has(url)) return _deviceIconTex.get(url);
  const tex = new THREE.TextureLoader().load(url);
  if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
  _deviceIconTex.set(url, tex);
  return tex;
}
function updateDeviceIcon(item) {
  if (!item.meta?.isDevice || item.iconSprite) return;
  const url = getObjectIconUrl(item.ueObj.objectId);
  if (!url) return;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: deviceIconTexture(url), transparent: true, depthTest: false, depthWrite: false }));
  sprite.scale.set(0.6, 0.6, 1);
  sprite.position.set(0, 0.9, 0); // just above the device placeholder (local space)
  sprite.renderOrder = 5;
  sprite.raycast = () => {};
  sprite.visible = showDeviceIcons;
  item.group.add(sprite);
  item.iconSprite = sprite;
}

function decorateDeviceItem(item) {
  updateDeviceVolume(item);
  updateDeviceIcon(item);
}

function getPugcObjects() {
  return getPugcObjectsFromJson(pugcJson);
}

function parsePlacementObjectId() {
  const raw = document.getElementById('placeObjectInput')?.value || '';
  const match = raw.match(/\d+/);
  return match ? Number(match[0]) : NaN;
}

function isDeviceObjectId(objectId) {
  return isCatalogDeviceObjectId(catalog, objectId);
}

function nextSceneDeviceIndex(objectId) {
  return nextDeviceIndexForObject(getPugcObjects() || [], objectId);
}

function removePugcObject(ueObj) {
  removePugcObjectFromArray(getPugcObjects(), ueObj);
}

function disposeItem(item) {
  disposeEditorItem(item, scene);
}

function deleteItem(item, removeFromPugc = true) {
  if (!item) return;
  if (selected === item) selected = null;
  selectedItems.delete(item);
  for (const collection of COLLECTIONS) {
    const idx = collection.items.indexOf(item);
    if (idx >= 0) collection.items.splice(idx, 1);
  }
  for (const tool of CIRCLE_TOOLS) {
    const idx = tool.items.indexOf(item);
    if (idx >= 0) tool.items.splice(idx, 1);
  }
  for (const tool of GRID_TOOLS) {
    const idx = tool.items.indexOf(item);
    if (idx >= 0) tool.items.splice(idx, 1);
  }
  if (removeFromPugc) removePugcObject(item.ueObj);
  const idx = ITEMS.indexOf(item);
  if (idx >= 0) ITEMS.splice(idx, 1);
  disposeItem(item);
}

function sceneSnapshot() {
  if (!pugcJson) return null;
  const objects = getPugcObjects() || [];
  const objectIndex = new Map(objects.map((obj, idx) => [obj, idx]));
  return {
    pugcJson: clonePlain(pugcJson),
    pugcFileInfo: clonePlain(pugcFileInfo),
    circleToolSeq,
    gridToolSeq,
    collectionSeq,
    circles: CIRCLE_TOOLS.map(tool => serializePatternTool(tool, objectIndex, clonePlain)),
    grids: GRID_TOOLS.map(tool => serializePatternTool(tool, objectIndex, clonePlain)),
    collections: COLLECTIONS.map(collection => ({
      id: collection.id,
      name: collection.name,
      itemIndexes: collection.items
        .map(item => objectIndex.get(item.ueObj))
        .filter(Number.isInteger),
    })),
    selection: selectedBase
      ? { type: 'base', toolType: selectedBase.type, toolId: selectedBase.tool.id, templateIndex: selectedBase.templateIndex }
      : selectedCircle
      ? { type: 'circle', id: selectedCircle.id }
      : selectedGrid
        ? { type: 'grid', id: selectedGrid.id }
        : selectedCollection
          ? { type: 'collection', id: selectedCollection.id }
          : {
              type: 'items',
              primaryIndex: selected ? objectIndex.get(selected.ueObj) : null,
              indexes: [...selectedItems].map(item => objectIndex.get(item.ueObj)).filter(Number.isInteger),
            },
  };
}

function sceneSnapshotKey(snapshot) {
  if (!snapshot) return '';
  return JSON.stringify({
    pugcJson: snapshot.pugcJson,
    circles: snapshot.circles,
    grids: snapshot.grids,
    collections: snapshot.collections,
  });
}

function beginHistory(label = 'Edit') {
  history?.begin(label);
}

function commitHistory(label) {
  history?.commit(label);
  refreshGraphIfActive(); // any committed mutation (place/delete/paste/wire) may change the graph
}

function cancelHistory() {
  history?.cancel();
}

function restoreSceneSnapshot(snapshot) {
  if (!snapshot) return;
  pugcJson = clonePlain(snapshot.pugcJson);
  pugcFileInfo = clonePlain(snapshot.pugcFileInfo || pugcFileInfo);
  clearScene(false);

  const objects = getPugcObjects() || [];
  for (const ueObj of objects) {
    buildSceneItem(ueObj);
  }

  circleToolSeq = snapshot.circleToolSeq || 1;
  for (const data of snapshot.circles || []) {
    const tool = createPatternToolFromSnapshot(data, ITEMS, {
      label: 'Circle Tool',
      userDataKey: 'circleToolRef',
      clonePlain,
    });
    CIRCLE_TOOLS.push(tool);
    scene.add(tool.group);
    setCircleHelperRadius(tool);
    circleToolSeq = Math.max(circleToolSeq, tool.id + 1);
  }

  gridToolSeq = snapshot.gridToolSeq || 1;
  for (const data of snapshot.grids || []) {
    const tool = createPatternToolFromSnapshot(data, ITEMS, {
      label: 'Grid Tool',
      userDataKey: 'gridToolRef',
      clonePlain,
    });
    GRID_TOOLS.push(tool);
    scene.add(tool.group);
    setGridHelperSize(tool);
    gridToolSeq = Math.max(gridToolSeq, tool.id + 1);
  }

  collectionSeq = snapshot.collectionSeq || 1;
  const assignedCollectionItems = new Set();
  for (const data of snapshot.collections || []) {
    const collectionItems = (data.itemIndexes || [])
      .map(idx => ITEMS[idx])
      .filter(item => item && !assignedCollectionItems.has(item));
    for (const item of collectionItems) assignedCollectionItems.add(item);
    const collection = {
      id: data.id,
      name: data.name || `Collection ${data.id}`,
      items: collectionItems,
    };
    COLLECTIONS.push(collection);
    collectionSeq = Math.max(collectionSeq, collection.id + 1);
  }

  const sel = snapshot.selection;
  if (sel?.type === 'items') {
    const indexes = sel.indexes?.length ? sel.indexes : [];
    for (const idx of indexes) {
      if (ITEMS[idx]) selectItem(ITEMS[idx], { add: true });
    }
    if (Number.isInteger(sel.primaryIndex) && ITEMS[sel.primaryIndex]) selectItem(ITEMS[sel.primaryIndex], { add: true });
  } else if (sel?.type === 'circle') {
    const tool = CIRCLE_TOOLS.find(t => t.id === sel.id);
    if (tool) selectCircleTool(tool);
    else deselectObject();
  } else if (sel?.type === 'grid') {
    const tool = GRID_TOOLS.find(t => t.id === sel.id);
    if (tool) selectGridTool(tool);
    else deselectObject();
  } else if (sel?.type === 'base') {
    const arr = sel.toolType === 'grid' ? GRID_TOOLS : CIRCLE_TOOLS;
    const tool = arr.find(t => t.id === sel.toolId);
    if (tool && tool.items[sel.templateIndex]) selectBaseObject(tool, sel.toolType, sel.templateIndex);
    else deselectObject();
  } else if (sel?.type === 'collection') {
    const collection = COLLECTIONS.find(c => c.id === sel.id);
    if (collection) selectCollection(collection);
    else deselectObject();
  } else {
    deselectObject();
  }

  renderList();
  updateCirclePreview();
  updateGridPreview();
  startMeshUpgrades();
  refreshGraphIfActive(); // undo/redo may have added/removed devices; keep the user's pan/zoom
}

function undoSceneEdit() {
  history?.undo();
}

function redoSceneEdit() {
  history?.redo();
}

function makePastedObject(source, offsetCm = 100) {
  return makePastedObjectFromSource(source, {
    offsetCm,
    isDeviceObjectId,
    nextDeviceIndex: nextSceneDeviceIndex,
  });
}

function updateClipboardButtons() {
  const hasCopyable = Boolean(selected || selectedItems.size || selectedCircle || selectedGrid || selectedCollection);
  document.getElementById('btnCopy').disabled = !hasCopyable;
  document.getElementById('btnPaste').disabled = !copiedPayload || !getPugcObjects();
}

// A tool-owned object is driven by its circle/grid tool: it isn't individually selectable, can't
// join a collection, and the tool overwrites its transform on every rebuild. Ownership is derived
// from tool.items - the circleToolId/gridToolId tag isn't restored by snapshot/undo loads.
function toolOwning(item) {
  for (const tool of CIRCLE_TOOLS) if (tool.items.includes(item)) return { tool, type: 'circle' };
  for (const tool of GRID_TOOLS) if (tool.items.includes(item)) return { tool, type: 'grid' };
  return null;
}

function toolOwnedItemSet() {
  const owned = new Set();
  for (const tool of CIRCLE_TOOLS) for (const item of tool.items) owned.add(item);
  for (const tool of GRID_TOOLS) for (const item of tool.items) owned.add(item);
  return owned;
}

// Detach a tool's objects into free scene objects and drop the controller ("bake"). The objects stay
// in pugcJson untouched; only tool ownership ends. Wrapped in history so undo restores the whole tool.
function releaseToolObjects(tool, type) {
  if (!tool || !tool.items.length) return;
  beginHistory('Release Tool Objects');
  const freed = [...tool.items];
  for (const item of freed) { delete item.circleToolId; delete item.gridToolId; }
  const count = freed.length;
  tool.items.length = 0;
  scene.remove(tool.group);
  disposeSceneObject(tool.group);
  const arr = type === 'grid' ? GRID_TOOLS : CIRCLE_TOOLS;
  const idx = arr.indexOf(tool);
  if (idx >= 0) arr.splice(idx, 1);
  if (selectedCircle === tool) selectedCircle = null;
  if (selectedGrid === tool) selectedGrid = null;
  placementTemplates = null;
  // Keep the baked objects grouped: drop them into a new collection so they stay movable together.
  const collection = {
    id: collectionSeq++,
    name: uniqueCollectionName(`${type === 'grid' ? 'Grid' : 'Circle'} Tool ${tool.id}`),
    items: freed,
  };
  COLLECTIONS.push(collection);
  selectCollection(collection);
  renderList();
  commitHistory('Release Tool Objects');
  setStatus(`Released ${count} object${count === 1 ? '' : 's'} into ${collection.name} - undo to restore the tool`);
}

function uniqueCollectionName(base) {
  const names = new Set(COLLECTIONS.map(c => c.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

function uniqueCollectionItems(items) {
  const owned = toolOwnedItemSet();
  return [...new Set(items)].filter(item => ITEMS.includes(item) && !owned.has(item));
}

// --- Unified "add selected objects to a group" (collection or tool base) ----------------------
// Shared trigger/plumbing; each group type implements its own accept(). draggedIdx is set by a
// drag-onto-node drop (the dragged row), null by the "+" button (uses the current selection).
function resolveAddItems(draggedIdx) {
  if (draggedIdx == null) return uniqueCollectionItems([...selectedItems]);
  const item = ITEMS[draggedIdx];
  if (!item) return [];
  return selectedItems.has(item) ? uniqueCollectionItems([...selectedItems]) : uniqueCollectionItems([item]);
}

// Collection accept: the object stays put and gains membership (single-membership across collections).
function addItemsToCollection(collection, items) {
  const add = items.filter(it => !collection.items.includes(it));
  if (!collection || !add.length) return 0;
  beginHistory('Add to Collection');
  removeItemsFromCollections(add, collection);
  collection.items.push(...add);
  selectCollection(collection);
  renderList();
  commitHistory('Add to Collection');
  return add.length;
}

// Slot-0 stamping frame (template offsets/quats/scales are measured against it). Reuses the same
// per-slot frame functions the rebuild uses, so inverting it yields a faithful template.
function circleSlotZeroFrame(tool) { return circleSlotFrame(tool, 0, 1); }
function gridSlotZeroFrame(tool) { return gridSlotFrame(tool, 0); }

// Invert the slot-0 stamping math: a free object's world transform -> a template entry.
function templateEntryFromItem(item, frame) {
  const invQ = frame.quat.clone().invert();
  const offset = editorPivotToRootPosition(item).sub(frame.root).applyQuaternion(invQ);
  if (frame.scaleOffsets) offset.divide(new THREE.Vector3(frame.scale.x || 1, frame.scale.z || 1, frame.scale.y || 1));
  const q = invQ.clone().multiply(item.group.quaternion);
  const s = threeScaleToUe4(item.group.scale); // live group scale (mid-drag the ueObj value is stale)
  return {
    objectId: item.ueObj.objectId,
    source: clonePlain(item.ueObj),
    offset: { x: offset.x, y: offset.y, z: offset.z },
    quaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
    scale3D: clampUeScale3D({
      x: (s.x ?? 1) / (frame.scale.x || 1),
      y: (s.y ?? 1) / (frame.scale.y || 1),
      z: (s.z ?? 1) / (frame.scale.z || 1),
    }),
  };
}

// Tool-base accept: the object is absorbed into the template (relative to the tool frame) and stamped
// across every slot, so one object becomes N. The original free object is consumed.
function addItemsToToolBase(tool, type, items) {
  if (!tool || !items.length) return 0;
  beginHistory('Add to Tool Base');
  if (!tool.templates?.length) tool.templates = clonePlain(getPatternTemplates(tool)); // keep the implicit base
  const frame = type === 'grid' ? gridSlotZeroFrame(tool) : circleSlotZeroFrame(tool);
  for (const item of items) tool.templates.push(templateEntryFromItem(item, frame));
  for (const item of items) deleteItem(item, true);
  tool.templateVersion = (tool.templateVersion || 0) + 1;
  placementTemplates = clonePlain(tool.templates);
  placementTemplateVersion++;
  if (type === 'grid') { selectedGrid = null; rebuildGridTool(tool); selectGridTool(tool); }
  else { selectedCircle = null; rebuildCircleTool(tool); selectCircleTool(tool); }
  renderList();
  commitHistory('Add to Tool Base');
  return items.length;
}

function addToCollectionFromUi(collection, draggedIdx) {
  const items = resolveAddItems(draggedIdx);
  if (!items.length) { setStatus('Select object(s) first, then add them'); return; }
  const n = addItemsToCollection(collection, items);
  if (n) setStatus(`Added ${n} object${n === 1 ? '' : 's'} to ${collection.name}`);
}

function addToToolFromUi(tool, type, draggedIdx) {
  const items = resolveAddItems(draggedIdx);
  if (!items.length) { setStatus('Select object(s) first, then add them to the base'); return; }
  const n = addItemsToToolBase(tool, type, items);
  if (n) setStatus(`Added ${n} object${n === 1 ? '' : 's'} to ${type === 'grid' ? 'Grid' : 'Circle'} Tool ${tool.id} base`);
}

function removeItemsFromCollections(items, except = null) {
  const removeSet = new Set(items);
  for (const collection of COLLECTIONS) {
    if (collection === except) continue;
    collection.items = collection.items.filter(item => !removeSet.has(item));
  }
}

function collectionNameCopy(baseName) {
  const base = `${baseName || 'Collection'} Copy`;
  const names = new Set(COLLECTIONS.map(collection => collection.name));
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base} ${index}`)) index++;
  return `${base} ${index}`;
}

function itemInAnyCollection(item) {
  return COLLECTIONS.some(c => c.items.includes(item));
}

// A duplicate of an object at the same transform (used when a selection drawn into a new group already
// belongs to a collection - we copy rather than steal it from that collection).
function duplicateItemAtSameSpot(item) {
  return addSceneObject(makePastedObject(clonePlain(item.ueObj), 0));
}

function createCollectionFromSelection() {
  const sel = uniqueCollectionItems([...selectedItems]);
  beginHistory('Create Collection');
  // Objects already in a collection are COPIED into the new one (the original stays in its collection);
  // loose objects just move in.
  const items = sel.map(item => (itemInAnyCollection(item) ? duplicateItemAtSameSpot(item) || item : item));
  const collection = {
    id: collectionSeq++,
    name: `Collection ${collectionSeq - 1}`,
    items,
  };
  COLLECTIONS.push(collection);
  selectCollection(collection);
  renderList();
  commitHistory('Create Collection');
  setStatus(items.length
    ? `Created ${collection.name} with ${items.length} object${items.length === 1 ? '' : 's'}`
    : `Created empty ${collection.name}`);
}

// Create a circle/grid pattern tool from the current selection (mirrors New Collection). The selected
// objects become the tool's base; the tool spawns at the selection anchor and the originals are
// consumed into the stamped pattern (slot 0 lands where they were).
function createToolFromSelection(type) {
  const items = uniqueCollectionItems([...selectedItems]);
  if (!items.length) { setStatus('Select object(s) first, then create a tool', true); return; }
  const built = makeCircleTemplatesFromSelection();
  if (!built?.templates?.length) { setStatus('Select object(s) first', true); return; }
  const anchorRoot = editorPivotToRootPosition(built.anchor);
  const anchorQuat = built.anchor.group.quaternion.clone();
  const params = type === 'grid' ? readGridParamsFromInputs() : readCircleParamsFromInputs();
  placementTemplateVersion++;
  beginHistory(type === 'grid' ? 'Create Grid Tool' : 'Create Circle Tool');
  // Consume loose originals (the tool re-stamps them from the captured template). Objects that belong
  // to a collection are left in place so that collection isn't emptied - the tool uses copies.
  for (const item of items) {
    if (!itemInAnyCollection(item)) deleteItem(item, true);
  }
  const tool = type === 'grid'
    ? createGridTool(built.templates[0].objectId, anchorRoot, params, built.templates, { quaternion: anchorQuat })
    : createCircleTool(built.templates[0].objectId, anchorRoot, params, built.templates, { quaternion: anchorQuat });
  if (type === 'grid') selectGridTool(tool); else selectCircleTool(tool);
  renderList();
  commitHistory(type === 'grid' ? 'Create Grid Tool' : 'Create Circle Tool');
  setStatus(`Created ${type === 'grid' ? 'Grid' : 'Circle'} Tool ${tool.id} from ${items.length} object${items.length === 1 ? '' : 's'}`);
}

function deleteCollection(collection) {
  if (!collection) return;
  const idx = COLLECTIONS.indexOf(collection);
  if (idx >= 0) COLLECTIONS.splice(idx, 1);
  if (selectedCollection === collection) selectedCollection = null;
}

// Chain the selected AI Navigation devices (objectId 39) into a linear travel path, ordered by
// device {objectId, deviceIndex} (not selection order, which is ambiguous - box-select adds in list
// order, ctrl-click in click order). Each one's cadidateNavPointList is set to point
// nextPointNavDevice at the next nav; if an AI Player Spawn (34) is also selected, its firstNavDevice
// points at the head. Defaults (availAITeamId 100 = all teams, weight 1) match the game's own
// ai_example.pugc. This is the only place AI paths are connected - copy/paste only ever remaps
// existing references onto the copies, it never invents new hops.
const AI_NAV_OBJECT_ID = 39;
const AI_PLAYER_SPAWN_OBJECT_ID = 34;
function chainSelectedAiPath() {
  const sel = [...selectedItems];
  const navs = sel
    .filter(it => Number(it.ueObj?.objectId) === AI_NAV_OBJECT_ID)
    .sort((a, b) =>
      (Number(a.ueObj.objectId) - Number(b.ueObj.objectId)) ||
      ((a.ueObj.deviceIndex ?? 0) - (b.ueObj.deviceIndex ?? 0)));
  if (navs.length < 2) { setStatus('Select 2+ AI Navigation devices', true); return; }
  const spawn = sel.find(it => Number(it.ueObj?.objectId) === AI_PLAYER_SPAWN_OBJECT_ID);

  const editProps = (item, mutate) => {
    let props; try { props = JSON.parse(item.ueObj.devicePropertyData || '{}'); } catch { props = {}; }
    mutate(props);
    item.ueObj.devicePropertyData = JSON.stringify(props);
  };

  beginHistory('Chain AI Path');
  // Non-terminal nav points become a single linear hop to the next; the last nav is left as-is.
  for (let i = 0; i < navs.length - 1; i++) {
    const next = navs[i + 1].ueObj;
    editProps(navs[i], (p) => {
      p.cadidateNavPointList = [{
        availAITeamId: 100,
        nextPointNavDevice: { objectId: next.objectId, deviceIndex: next.deviceIndex },
        weight: 1,
      }];
    });
  }
  if (spawn) {
    const head = navs[0].ueObj;
    editProps(spawn, (p) => { p.firstNavDevice = { objectId: head.objectId, deviceIndex: head.deviceIndex }; });
  }
  updateDeviceLinkLines();
  if (selected && (navs.includes(selected) || selected === spawn)) updatePropsPanel(selected);
  commitHistory('Chain AI Path');
  setStatus(`Chained ${navs.length} AI nav points into a path${spawn ? ' (+ spawn)' : ''}`);
}

// --- Selection distribute / align -------------------------------------------------

function distributeSelection(axis) {
  const items = uniqueCollectionItems([...selectedItems]);
  if (items.length < 2) return;
  const ax = axis.toLowerCase();
  const spacing = numericInputValue('distSpacing' + axis, 5) * 100; // m -> cm
  beginHistory('Distribute Selection');
  const sorted = [...items].sort((a, b) =>
    a.ueObj.spawnTransform.translation[ax] - b.ueObj.spawnTransform.translation[ax]
  );
  const anchor = sorted[0].ueObj.spawnTransform.translation[ax];
  for (let i = 0; i < sorted.length; i++) {
    sorted[i].ueObj.spawnTransform.translation[ax] = anchor + i * spacing;
    sorted[i].group.position.copy(
      ue4PosToThree(sorted[i].ueObj.spawnTransform.translation).add(transformedPivotOffset(sorted[i]))
    );
  }
  updateDeviceLinkLines();
  if (selected) updatePropsPanel(selected);
  commitHistory('Distribute Selection');
}

function alignSelection(axis, edge) {
  const items = uniqueCollectionItems([...selectedItems]);
  if (items.length < 2) return;
  const ax = axis.toLowerCase();
  const vals = items.map(it => it.ueObj.spawnTransform.translation[ax]);
  const target = edge === 'min' ? Math.min(...vals)
    : edge === 'max' ? Math.max(...vals)
    : vals.reduce((s, v) => s + v, 0) / vals.length;
  beginHistory('Align Selection');
  for (const item of items) {
    item.ueObj.spawnTransform.translation[ax] = target;
    item.group.position.copy(
      ue4PosToThree(item.ueObj.spawnTransform.translation).add(transformedPivotOffset(item))
    );
  }
  updateDeviceLinkLines();
  if (selected) updatePropsPanel(selected);
  commitHistory('Align Selection');
}

// --- Modular device copy: remap device->device references so a copied set rewires onto its copies ---
// References use one identity {objectId, deviceIndex} in two channels: Device-type fields in
// devicePropertyData (catalog-marked) and deviceEventList wiring. One rule covers both: a reference
// pointing INTO the copied set repoints to the copy; a reference to a non-copied device is left as-is.

function setDevicePropPath(root, path, value) {
  const parts = String(path).split('.').map(p => p.replace(/\[\]$/, ''));
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

// Flat {src,tgt} wiring edges touching any of `items`, so paste can replay them with remapped ends.
function captureWiringForItems(items) {
  const keys = new Set((items || [])
    .filter(it => it?.ueObj && isDeviceObjectId(it.ueObj.objectId) && it.ueObj.deviceIndex !== -1)
    .map(it => `${it.ueObj.objectId}:${it.ueObj.deviceIndex}`));
  if (!keys.size || !Array.isArray(pugcJson?.deviceEventList)) return [];
  const edges = [];
  for (const g of pugcJson.deviceEventList) {
    const s = g?.eventId?.deviceInstanceId;
    if (!s) continue;
    const sKey = `${s.objectId}:${s.deviceIndex}`;
    for (const r of (g.relationEventId || [])) {
      const t = r?.deviceInstanceId;
      if (!t) continue;
      const tKey = `${t.objectId}:${t.deviceIndex}`;
      if (keys.has(sKey) || keys.has(tKey)) {
        edges.push({
          src: { objectId: s.objectId, deviceIndex: s.deviceIndex, eventName: g.eventId.eventName },
          tgt: { objectId: t.objectId, deviceIndex: t.deviceIndex, eventName: r.eventName },
        });
      }
    }
  }
  return edges;
}

// oldKey -> new {objectId,deviceIndex} for a freshly pasted device set.
function buildPasteRemap(pairs) {
  const remap = new Map();
  for (const { source, item } of pairs) {
    if (!source || !item) continue;
    if (isDeviceObjectId(source.objectId) && source.deviceIndex != null && source.deviceIndex !== -1) {
      remap.set(`${source.objectId}:${source.deviceIndex}`, { objectId: item.ueObj.objectId, deviceIndex: item.ueObj.deviceIndex });
    }
  }
  return remap;
}

function remapDeviceRefsInItem(item, remap) {
  const dev = catalog.devices[String(item.ueObj.objectId)];
  if (!dev?.fields || !item.ueObj.devicePropertyData) return;
  let props;
  try { props = JSON.parse(item.ueObj.devicePropertyData); } catch { return; }
  let changed = false;
  const mapRef = (v) => {
    if (v && v.objectId != null && v.deviceIndex != null) {
      const n = remap.get(`${v.objectId}:${v.deviceIndex}`);
      if (n) return { objectId: n.objectId, deviceIndex: n.deviceIndex };
    }
    return null;
  };
  for (const field of dev.fields) {
    if (field.type === 'Device') {
      const nv = mapRef(getDevicePropPath(props, field.path));
      if (nv) { setDevicePropPath(props, field.path, nv); changed = true; }
    } else if (field.type === 'Array') {
      const arr = getDevicePropPath(props, field.path);
      if (!Array.isArray(arr)) continue;
      const childKeys = dev.fields
        .filter(c => c.path.startsWith(`${field.path}[].`) && c.type === 'Device')
        .map(c => c.path.split('[].')[1]);
      for (const entry of arr) for (const k of childKeys) {
        const nv = mapRef(entry?.[k]);
        if (nv) { entry[k] = nv; changed = true; }
      }
    }
  }
  if (changed) item.ueObj.devicePropertyData = JSON.stringify(props);
}

function replayCopiedWiring(wiring, remap) {
  if (!Array.isArray(wiring) || !wiring.length || !pugcJson) return;
  if (!Array.isArray(pugcJson.deviceEventList)) pugcJson.deviceEventList = [];
  const list = pugcJson.deviceEventList;
  const mapInst = (e) => {
    const n = remap.get(`${e.objectId}:${e.deviceIndex}`);
    return n ? { objectId: n.objectId, deviceIndex: n.deviceIndex } : { objectId: e.objectId, deviceIndex: e.deviceIndex };
  };
  const sameInst = (a, b) => Number(a?.objectId) === Number(b.objectId) && Number(a?.deviceIndex) === Number(b.deviceIndex);
  for (const edge of wiring) {
    if (!remap.has(`${edge.src.objectId}:${edge.src.deviceIndex}`) &&
        !remap.has(`${edge.tgt.objectId}:${edge.tgt.deviceIndex}`)) continue;
    const srcInst = mapInst(edge.src), tgtInst = mapInst(edge.tgt);
    let g = list.find(x => x?.eventId?.eventName === edge.src.eventName && sameInst(x.eventId?.deviceInstanceId, srcInst));
    if (!g) { g = { eventId: { deviceInstanceId: srcInst, eventName: edge.src.eventName }, relationEventId: [] }; list.push(g); }
    if (!Array.isArray(g.relationEventId)) g.relationEventId = [];
    const dup = g.relationEventId.some(r => r?.eventName === edge.tgt.eventName && sameInst(r.deviceInstanceId, tgtInst));
    if (!dup) g.relationEventId.push({ deviceInstanceId: tgtInst, eventName: edge.tgt.eventName });
  }
}

// Apply field-reference remap + wiring replay for a just-pasted device set ({source,item} pairs).
function applyPasteReferenceRemap(pairs, wiring) {
  const remap = buildPasteRemap(pairs);
  if (!remap.size) return;
  for (const { item } of pairs) if (item) remapDeviceRefsInItem(item, remap);
  replayCopiedWiring(wiring, remap);
  updateDeviceLinkLines();
}

function copySelectedObject() {
  if (selectedCollection) {
    const items = uniqueCollectionItems(selectedCollection.items);
    if (!items.length) return;
    const anchorItem = selected && items.includes(selected) ? selected : items[0];
    copiedPayload = {
      ...makeObjectsClipboardPayload(items, anchorItem, editorPivotToRootPosition),
      type: 'collection',
      collectionName: selectedCollection.name,
      wiring: captureWiringForItems(items),
    };
    updateClipboardButtons();
    setStatus(`Copied ${selectedCollection.name}`);
    return;
  }
  if (selectedCircle) {
    const templates = selectedCircle.templates?.length ? selectedCircle.templates : getPatternTemplates(selectedCircle);
    copiedPayload = makePatternClipboardPayload('circleTool', selectedCircle, templates);
    updateClipboardButtons();
    setStatus(`Copied Circle Tool ${selectedCircle.id}`);
    return;
  }
  if (selectedGrid) {
    const templates = selectedGrid.templates?.length ? selectedGrid.templates : getPatternTemplates(selectedGrid);
    copiedPayload = makePatternClipboardPayload('gridTool', selectedGrid, templates);
    updateClipboardButtons();
    setStatus(`Copied Grid Tool ${selectedGrid.id}`);
    return;
  }
  if (!selectedItems.size && !selected) return;
  const items = [...selectedItems].sort((a, b) => ITEMS.indexOf(a) - ITEMS.indexOf(b));
  const copyItems = items.length ? items : [selected];
  const anchorItem = selected && copyItems.includes(selected) ? selected : copyItems[0];
  copiedPayload = makeObjectsClipboardPayload(copyItems, anchorItem, editorPivotToRootPosition);
  copiedPayload.wiring = captureWiringForItems(copyItems);
  updateClipboardButtons();
  setStatus(copyItems.length === 1
    ? `Copied ${copyItems[0].meta.name} (${copyItems[0].ueObj.objectId})`
    : `Copied ${copyItems.length} objects`);
}

function pasteCopiedObject() {
  const objects = getPugcObjects();
  if (!objects || !copiedPayload) return;

  if (copiedPayload.type === 'circleTool' || copiedPayload.type === 'gridTool') {
    const isCircle = copiedPayload.type === 'circleTool';
    beginHistory(isCircle ? 'Paste Circle Tool' : 'Paste Grid Tool');
    const center = new THREE.Vector3(
      Number(copiedPayload.position?.x || 0),
      Number(copiedPayload.position?.y || 0),
      Number(copiedPayload.position?.z || 0)
    );
    const quaternion = new THREE.Quaternion(
      copiedPayload.quaternion?.x || 0,
      copiedPayload.quaternion?.y || 0,
      copiedPayload.quaternion?.z || 0,
      copiedPayload.quaternion?.w ?? 1
    );
    const tool = isCircle
      ? createCircleTool(copiedPayload.objectId, center, clonePlain(copiedPayload.params), clonePlain(copiedPayload.templates || []), { quaternion })
      : createGridTool(copiedPayload.objectId, center, clonePlain(copiedPayload.params), clonePlain(copiedPayload.templates || []), { quaternion });
    if (isCircle) selectCircleTool(tool);
    else selectGridTool(tool);
    renderList();
    commitHistory(isCircle ? 'Paste Circle Tool' : 'Paste Grid Tool');
    setStatus(`Pasted ${isCircle ? 'Circle' : 'Grid'} Tool ${tool.id}`);
    return;
  }

  if (copiedPayload.type === 'collection') {
    const entries = objectClipboardEntries(copiedPayload);
    if (!entries.length) return;
    beginHistory('Paste Collection');
    const pastedAnchor = clipboardAnchorToThree(copiedPayload, entries);
    const pasted = [];
    const pairs = [];
    for (const entry of entries) {
      const clone = makePastedObject(entry.source, 0);
      const rel = clipboardEntryOffsetToThree(entry);
      clone.spawnTransform.translation = threePosToUe4(pastedAnchor.clone().add(rel));
      const item = addSceneObject(clone);
      if (item) { pasted.push(item); pairs.push({ source: entry.source, item }); }
    }
    if (!pasted.length) { cancelHistory(); return; }
    applyPasteReferenceRemap(pairs, copiedPayload.wiring);
    const collection = {
      id: collectionSeq++,
      name: collectionNameCopy(copiedPayload.collectionName),
      items: pasted,
    };
    COLLECTIONS.push(collection);
    selectCollection(collection);
    renderList();
    commitHistory('Paste Collection');
    setStatus(`Pasted ${collection.name}`);
    return;
  }

  const entries = objectClipboardEntries(copiedPayload);
  if (!entries.length) return;
  beginHistory(entries.length === 1 ? 'Paste Object' : 'Paste Objects');
  const pastedAnchor = clipboardAnchorToThree(copiedPayload, entries);
  const pasted = [];
  const pairs = [];
  for (const entry of entries) {
    const clone = makePastedObject(entry.source, 0);
    const rel = clipboardEntryOffsetToThree(entry);
    clone.spawnTransform.translation = threePosToUe4(pastedAnchor.clone().add(rel));
    const item = addSceneObject(clone);
    if (item) { pasted.push(item); pairs.push({ source: entry.source, item }); }
  }
  if (!pasted.length) { cancelHistory(); return; }
  applyPasteReferenceRemap(pairs, copiedPayload.wiring);
  deselectObject();
  for (const item of pasted) selectItem(item, { add: true });
  renderList();
  commitHistory(entries.length === 1 ? 'Paste Object' : 'Paste Objects');
  setStatus(pasted.length === 1
    ? `Pasted ${pasted[0].meta.name} (${pasted[0].ueObj.objectId})`
    : `Pasted ${pasted.length} objects`);
}

async function decodeReferenceLogicFile(file) {
  if (/\.pugcedit$/i.test(file.name)) {
    const session = parseEditorSession(await file.text());
    return { json: session.snapshot.pugcJson, name: session.metadata?.pugcName || file.name };
  }
  if (/\.pugc$/i.test(file.name)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const codec = await getPugcCodec();
    const { json, name } = await codec.decode(bytes, file.name);
    return { json, name: name || file.name };
  }
  throw new Error('Open a .pugc or .pugcedit file');
}

function makeReferenceLogicItems(json) {
  return (getPugcObjectsFromJson(json) || [])
    .filter(ueObj => isDeviceObjectId(ueObj?.objectId) && ueObj.deviceIndex !== -1)
    .map(ueObj => ({
      ueObj,
      meta: { ...getObjectMeta(ueObj.objectId), isDevice: true },
      group: {
        position: ue4PosToThree(ueObj.spawnTransform?.translation || { x: 0, y: 0, z: 0 }),
        quaternion: ue4QuatToThree(ueObj.spawnTransform?.rotation || { x: 0, y: 0, z: 0, w: 1 }),
        scale: ue4ScaleToThree(ueObj.spawnTransform?.scale3D || { x: 1, y: 1, z: 1 }),
      },
    }));
}

function referenceNodeId(item) {
  return item?.ueObj ? `${item.ueObj.objectId}:${item.ueObj.deviceIndex}` : '';
}

function referencePlacedDevices(allowedObjectIds) {
  const allowedSet = Array.isArray(allowedObjectIds) && allowedObjectIds.length
    ? new Set(allowedObjectIds.map(Number))
    : null;
  return referenceLogicItems
    .filter(item =>
      item.ueObj &&
      item.ueObj.deviceIndex !== -1 &&
      (!allowedSet || allowedSet.has(Number(item.ueObj.objectId)))
    )
    .map(item => {
      const meta = getObjectMeta(item.ueObj.objectId);
      const name = item.ueObj.userDeviceName || meta?.name || `Device ${item.ueObj.deviceIndex}`;
      return {
        objectId: Number(item.ueObj.objectId),
        deviceIndex: item.ueObj.deviceIndex,
        label: `#${item.ueObj.deviceIndex} ${name}`,
      };
    })
    .sort((a, b) => (a.deviceIndex ?? 0) - (b.deviceIndex ?? 0));
}

function lockReferencePropsView() {
  const root = document.getElementById('propsDetailsContent');
  if (!root) return;
  root.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = true; });
  root.querySelectorAll('button:not(.scene-dev-tab)').forEach(el => { el.disabled = true; });
  const nameSection = document.getElementById('devNameSection');
  if (nameSection) nameSection.style.display = 'none';
  const meshDetails = document.getElementById('meshDetailsSection');
  if (meshDetails) meshDetails.open = false;
}

function renderReferenceNodeDetails(item = referenceLogicFocusedItem) {
  if (!item?.ueObj) {
    hidePropsPanels();
    return;
  }
  propsPanelReferenceMode = true;
  try {
    propsPanel?.updateObject(item);
  } finally {
    propsPanelReferenceMode = false;
  }
  lockReferencePropsView();
}

function captureInternalWiringForReference(items) {
  const keys = new Set((items || [])
    .filter(it => it?.ueObj && isDeviceObjectId(it.ueObj.objectId) && it.ueObj.deviceIndex !== -1)
    .map(it => `${it.ueObj.objectId}:${it.ueObj.deviceIndex}`));
  if (!keys.size || !Array.isArray(referenceLogicJson?.deviceEventList)) return [];
  const edges = [];
  for (const g of referenceLogicJson.deviceEventList) {
    const s = g?.eventId?.deviceInstanceId;
    if (!s) continue;
    const sKey = `${s.objectId}:${s.deviceIndex}`;
    for (const r of (g.relationEventId || [])) {
      const t = r?.deviceInstanceId;
      if (!t) continue;
      const tKey = `${t.objectId}:${t.deviceIndex}`;
      if (keys.has(sKey) && keys.has(tKey)) {
        edges.push({
          src: { objectId: s.objectId, deviceIndex: s.deviceIndex, eventName: g.eventId.eventName },
          tgt: { objectId: t.objectId, deviceIndex: t.deviceIndex, eventName: r.eventName },
        });
      }
    }
  }
  return edges;
}

function updateReferenceLogicUi() {
  reconcileReferenceLogicSelection();
  const panel = document.getElementById('referenceGraphPanel');
  const count = document.getElementById('referenceGraphCount');
  const copyBtn = document.getElementById('btnCopyReferenceLogic');
  const clearBtn = document.getElementById('btnClearReferenceSelection');
  const selectAllBtn = document.getElementById('btnSelectAllReferenceLogic');
  const refTab = document.getElementById('btnGraphReferenceTab');
  const showReferenceTools = graphActiveTab === 'reference';
  if (panel) panel.hidden = graphActiveTab !== 'reference';
  if (refTab) refTab.classList.toggle('has-reference', Boolean(referenceLogicJson));
  const selectedCount = referenceLogicSelectedIds.size;
  if (count) count.textContent = referenceLogicJson
    ? `${referenceLogicName || 'Reference'} - ${referenceLogicItems.length} devices, ${selectedCount} selected`
    : 'Load a second file to browse its device logic';
  if (count) count.hidden = !showReferenceTools;
  if (selectAllBtn) {
    selectAllBtn.hidden = !showReferenceTools;
    selectAllBtn.disabled = !referenceLogicItems.length;
  }
  if (copyBtn) {
    copyBtn.hidden = !showReferenceTools;
    copyBtn.disabled = !selectedCount || !getPugcObjects();
  }
  if (clearBtn) {
    clearBtn.hidden = !showReferenceTools;
    clearBtn.disabled = !selectedCount;
  }
  if (showReferenceTools) renderReferenceNodeDetails();
}

function reconcileReferenceLogicSelection() {
  const liveIds = new Set(referenceLogicItems.map(item => `${item.ueObj.objectId}:${item.ueObj.deviceIndex}`));
  for (const id of [...referenceLogicSelectedIds]) {
    if (!liveIds.has(id)) referenceLogicSelectedIds.delete(id);
  }
  if (referenceLogicFocusedItem && !liveIds.has(referenceNodeId(referenceLogicFocusedItem))) {
    referenceLogicFocusedItem = null;
  }
}

function setGraphTab(tab) {
  graphActiveTab = tab === 'reference' ? 'reference' : 'current';
  document.getElementById('btnGraphCurrentTab')?.classList.toggle('active', graphActiveTab === 'current');
  document.getElementById('btnGraphReferenceTab')?.classList.toggle('active', graphActiveTab === 'reference');
  document.getElementById('liveGraphPanel')?.toggleAttribute('hidden', graphActiveTab !== 'current');
  document.getElementById('referenceGraphPanel')?.toggleAttribute('hidden', graphActiveTab !== 'reference');
  updateReferenceLogicUi();
  if (!graphActive) return;
  if (graphActiveTab === 'reference') {
    reconcileReferenceLogicSelection();
    referenceLogicGraph?.render();
    referenceLogicGraph?.setSelectedIds(referenceLogicSelectedIds, { keepFocused: true });
    renderReferenceNodeDetails();
  } else {
    logicGraph?.render();
    logicGraph?.setSelected(selected);
    if (selected) updatePropsPanel(selected);
    else hidePropsPanels();
  }
}

function setReferenceLogicSelection(nextIds) {
  referenceLogicFocusedItem = null;
  referenceLogicSelectedIds.clear();
  for (const id of nextIds || []) referenceLogicSelectedIds.add(id);
  referenceLogicGraph?.setSelectedIds(referenceLogicSelectedIds);
  renderReferenceNodeDetails();
  updateReferenceLogicUi();
}

function selectReferenceLogicGroup(ids, event) {
  referenceLogicFocusedItem = null;
  if (!event?.shiftKey && !event?.ctrlKey && !event?.metaKey) referenceLogicSelectedIds.clear();
  for (const id of ids || []) referenceLogicSelectedIds.add(id);
  referenceLogicGraph?.setSelectedIds(referenceLogicSelectedIds);
  renderReferenceNodeDetails();
  updateReferenceLogicUi();
}

function toggleReferenceLogicNode(item, id, event) {
  if (!item || !id) return;
  referenceLogicFocusedItem = item;
  if (event?.shiftKey || event?.ctrlKey || event?.metaKey) {
    if (referenceLogicSelectedIds.has(id)) referenceLogicSelectedIds.delete(id);
    else referenceLogicSelectedIds.add(id);
  } else {
    referenceLogicSelectedIds.clear();
    referenceLogicSelectedIds.add(id);
  }
  referenceLogicGraph?.setSelectedIds(referenceLogicSelectedIds, { keepFocused: true });
  renderReferenceNodeDetails(item);
  updateReferenceLogicUi();
}

async function loadReferenceLogicFile(file) {
  if (!file) return;
  setStatus(`Loading reference logic from ${file.name}...`);
  try {
    const { json, name } = await decodeReferenceLogicFile(file);
    referenceLogicJson = json;
    referenceLogicName = file.name || name || 'Reference logic';
    referenceLogicItems = makeReferenceLogicItems(json);
    referenceLogicFocusedItem = null;
    referenceLogicSelectedIds.clear();
    referenceLogicGraph?.resetView();
    renderReferenceNodeDetails(null);
    setSceneView('graph');
    setGraphTab('reference');
    setStatus(`Loaded ${referenceLogicItems.length} reference device${referenceLogicItems.length === 1 ? '' : 's'} from ${referenceLogicName}`);
  } catch (err) {
    setStatus(`Reference load error: ${err.message}`, true);
    console.error(err);
  }
}

function selectAllReferenceLogic() {
  setReferenceLogicSelection(referenceLogicItems.map(item => `${item.ueObj.objectId}:${item.ueObj.deviceIndex}`));
}

function copyReferenceLogicSelection() {
  reconcileReferenceLogicSelection();
  const selectedRefItems = referenceLogicItems.filter(item => referenceLogicSelectedIds.has(`${item.ueObj.objectId}:${item.ueObj.deviceIndex}`));
  if (!selectedRefItems.length) return;
  const anchor = selectedRefItems[0].ueObj.spawnTransform?.translation || { x: 0, y: 0, z: 0 };
  copiedPayload = {
    type: selectedRefItems.length === 1 ? 'object' : 'objects',
    objects: selectedRefItems.map(item => {
      const t = item.ueObj.spawnTransform?.translation || { x: 0, y: 0, z: 0 };
      return {
        source: clonePlain(item.ueObj),
        relativeTranslation: {
          x: Number(t.x || 0) - Number(anchor.x || 0),
          y: Number(t.y || 0) - Number(anchor.y || 0),
          z: Number(t.z || 0) - Number(anchor.z || 0),
        },
      };
    }),
    wiring: captureInternalWiringForReference(selectedRefItems),
  };
  updateClipboardButtons();
  setStatus(`Copied ${selectedRefItems.length} reference device${selectedRefItems.length === 1 ? '' : 's'} - use Paste to transfer`);
}

function placementCenterThree() {
  return ue4PosToThree({
    x: numericInputValue('placeCenterX'),
    y: numericInputValue('placeCenterY'),
    z: numericInputValue('placeCenterZ'),
  });
}

function setPlacementCenterFromThree(v) {
  const ue = threePosToUe4(v);
  const x = document.getElementById('placeCenterX');
  const y = document.getElementById('placeCenterY');
  const z = document.getElementById('placeCenterZ');
  if (!x || !y || !z) return; // spawn-centre inputs were removed (tools are created from selection)
  x.value = Math.round(ue.x);
  y.value = Math.round(ue.y);
  z.value = Math.round(ue.z);
  updateCirclePreview();
  updateGridPreview();
}

function selectedCatalogValue(objectId) {
  return formatSelectedCatalogValue(catalog, objectId);
}

function newSceneObject(objectId, posThree, quatThree, scale3D = { x: 1, y: 1, z: 1 }) {
  return createSceneObjectData(objectId, posThree, quatThree, {
    scale3D,
    catalog,
    isDeviceObjectId,
    nextDeviceIndex: nextSceneDeviceIndex,
  });
}

async function upgradeItemMesh(item) {
  // Devices with a DataTable-backed mesh pick-list render the selected asset rather than the
  // (empty) generic-actor blueprint mesh.
  const asset = deviceMeshAssetFor(item.ueObj);
  if (asset) {
    const geoData = await getAssetMeshGeo(asset);
    if (geoData) { item.currentMeshAsset = asset; await applyRealMesh(item, geoData, { allowReplace: true }); return; }
  }
  if (SUPPRESS_BP_MESH_IDS.has(String(item.ueObj.objectId))) return; // volume-only device; keep placeholder
  const geoData = await getBpGeo(item.ueObj.objectId);
  if (geoData && !item.hasRealMesh) await applyRealMesh(item, geoData);
}

function addSceneObject(ueObj, options = {}) {
  const objects = getPugcObjects();
  if (!objects) {
    setStatus('Open a .pugc file before placing objects', true);
    return null;
  }
  objects.push(ueObj);
  const item = createItem(ueObj, getObjectMeta(ueObj.objectId));
  item.group.userData.itemRef = item;
  item.keepEditorPivotOnMeshLoad = options.keepEditorPivotOnMeshLoad ?? false;
  item.circleToolId = options.circleToolId ?? null;
  item.gridToolId = options.gridToolId ?? null;
  scene.add(item.group);
  ITEMS.push(item);
  decorateDeviceItem(item);
  upgradeItemMesh(item);
  return item;
}

function readCircleParamsFromInputs() {
  return {
    diameter: Math.max(0, numericInputValue('circleDiameter', 20)),
    count: Math.max(3, Math.min(1000, Math.round(numericInputValue('circleCount', 3)))),
    offsetDeg: numericInputValue('circleRotOffsetManual', 0),
    objectPitchDeg: numericInputValue('circleObjectPitch', 0),
    objectRollDeg: numericInputValue('circleObjectRoll', 0),
    radialStep: numericInputValue('circleRadialStep', 0),
    heightStep: numericInputValue('circleHeightStep', 0),
    rotationStepDeg: numericInputValue('circleRotationStep', 0),
    scaleX: clampObjectScaleValue(numericInputValue('circleScaleX', 1)),
    scaleY: clampObjectScaleValue(numericInputValue('circleScaleY', 1)),
    scaleZ: clampObjectScaleValue(numericInputValue('circleScaleZ', 1)),
    scaleStepX: numericInputValue('circleScaleStepX', 0),
    scaleStepY: numericInputValue('circleScaleStepY', 0),
    scaleStepZ: numericInputValue('circleScaleStepZ', 0),
    scaleOffsets: Boolean(document.getElementById('circleScaleOffsets')?.checked),
  };
}

function updateCircleSliderLabels(params = readCircleParamsFromInputs()) {
  syncCircleRange('circleDiameterSlider', params.diameter);
  syncCircleRange('circleCountSlider', circlePlacementCount(params));
  syncLinearRange('circleObjectPitchSlider', params.objectPitchDeg || 0);
  syncLinearRange('circleRotOffsetSlider', params.offsetDeg || 0);
  syncLinearRange('circleObjectRollSlider', params.objectRollDeg || 0);
  syncLinearRange('circleRotationStepSlider', params.rotationStepDeg || 0);
  syncLinearRange('circleRadialStepSlider', params.radialStep || 0);
  syncLinearRange('circleHeightStepSlider', params.heightStep || 0);
  syncLinearRange('circleScaleXSlider', params.scaleX || 1);
  syncLinearRange('circleScaleYSlider', params.scaleY || 1);
  syncLinearRange('circleScaleZSlider', params.scaleZ || 1);
  syncLinearRange('circleScaleStepXSlider', params.scaleStepX || 0);
  syncLinearRange('circleScaleStepYSlider', params.scaleStepY || 0);
  syncLinearRange('circleScaleStepZSlider', params.scaleStepZ || 0);
}

function writeCircleParamsToInputs(tool) {
  setPlacementObject(tool.objectId, { close: false, apply: false, keepTemplates: true });
  document.getElementById('circleDiameter').value = tool.params.diameter;
  document.getElementById('circleCount').value = circlePlacementCount(tool.params);
  setInputValue('circleObjectPitch', tool.params.objectPitchDeg || 0);
  setInputValue('circleRotOffsetManual', tool.params.offsetDeg || 0);
  setInputValue('circleObjectRoll', tool.params.objectRollDeg || 0);
  setInputValue('circleRadialStep', tool.params.radialStep || 0);
  setInputValue('circleHeightStep', tool.params.heightStep || 0);
  setInputValue('circleRotationStep', tool.params.rotationStepDeg || 0);
  setInputValue('circleScaleX', tool.params.scaleX || 1, 3);
  setInputValue('circleScaleY', tool.params.scaleY || 1, 3);
  setInputValue('circleScaleZ', tool.params.scaleZ || 1, 3);
  setInputValue('circleScaleStepX', tool.params.scaleStepX || 0, 3);
  setInputValue('circleScaleStepY', tool.params.scaleStepY || 0, 3);
  setInputValue('circleScaleStepZ', tool.params.scaleStepZ || 0, 3);
  const scaleOffsets = document.getElementById('circleScaleOffsets');
  if (scaleOffsets) scaleOffsets.checked = Boolean(tool.params.scaleOffsets);
  setPlacementCenterFromThree(tool.group.position);
  updateCircleSliderLabels(tool.params);
}

function makeCircleTemplatesFromSelection() {
  const items = [...selectedItems].sort((a, b) => ITEMS.indexOf(a) - ITEMS.indexOf(b));
  if (!items.length) return null;
  const anchor = selected && selectedItems.has(selected) ? selected : items[0];
  const anchorRoot = editorPivotToRootPosition(anchor);
  const anchorInv = anchor.group.quaternion.clone().invert();
  return {
    anchor,
    templates: items.map(item => {
      const localOffset = editorPivotToRootPosition(item).sub(anchorRoot).applyQuaternion(anchorInv);
      const localQuat = anchorInv.clone().multiply(item.group.quaternion);
      return {
        objectId: item.ueObj.objectId,
        source: clonePlain(item.ueObj),
        offset: { x: localOffset.x, y: localOffset.y, z: localOffset.z },
        quaternion: { x: localQuat.x, y: localQuat.y, z: localQuat.z, w: localQuat.w },
        scale3D: clampUeScale3D(item.ueObj.spawnTransform.scale3D),
      };
    }),
  };
}

function circleTemplatesKey(templates) {
  return patternTemplatesKey(templates);
}

function useSelectedPlacementTemplate() {
  if (!selected) return;
  const multi = makeCircleTemplatesFromSelection();
  placementTemplates = multi?.templates?.length > 1 ? multi.templates : null;
  placementTemplateVersion++;
  const r = objectEulerDegrees(selected);
  const s = clampUeScale3D(selected.ueObj.spawnTransform.scale3D);
  setPlacementObject(selected.ueObj.objectId, { close: false, apply: false, keepTemplates: true });
  setPlacementCenterFromThree(editorPivotToRootPosition(selected));
  if (activeToolMode() === 'grid') {
    setInputValue('gridObjectPitch', r.p);
    setInputValue('gridObjectYaw', r.y);
    setInputValue('gridObjectRoll', r.r);
    setInputValue('gridScaleX', s.x, 3);
    setInputValue('gridScaleY', s.y, 3);
    setInputValue('gridScaleZ', s.z, 3);
    updateGridSliderLabels(readGridParamsFromInputs());
  } else {
    setInputValue('circleObjectPitch', r.p);
    setInputValue('circleRotOffsetManual', r.y);
    setInputValue('circleObjectRoll', r.r);
    setInputValue('circleScaleX', s.x, 3);
    setInputValue('circleScaleY', s.y, 3);
    setInputValue('circleScaleZ', s.z, 3);
    updateCircleSliderLabels(readCircleParamsFromInputs());
  }
  updatePlacementPreview();
  applyPlacementInputsToSelected();
  if (placementTemplates) setStatus(`Using ${placementTemplates.length} selected objects as placement template`);
}

function circlePlacementCount(params = readCircleParamsFromInputs()) {
  if (Number.isFinite(params.count)) {
    return Math.max(3, Math.min(1000, Math.round(params.count)));
  }
  return Math.max(3, Math.min(1000, Math.round(Math.PI * params.diameter / Math.max(0.1, params.spacing || 2))));
}

function updateCirclePreview() {
  const el = document.getElementById('circlePreviewText');
  if (!el) return;
  const params = readCircleParamsFromInputs();
  updateCircleSliderLabels(params);
  const count = circlePlacementCount(params);
  const actualSpacing = Math.PI * params.diameter / count;
  const radialStep = params.radialStep || 0;
  const heightStep = params.heightStep || 0;
  const scaleStep = params.scaleStepX || params.scaleStepY || params.scaleStepZ;
  const spiral = radialStep || heightStep || params.rotationStepDeg || scaleStep;
  el.textContent = `${count} objects, ${actualSpacing.toFixed(2)} m spacing${spiral ? `, step R ${formatCircleNumber(radialStep, 2)} m H ${formatCircleNumber(heightStep, 2)} m S ${formatCircleNumber(params.scaleStepX || 0, 3)},${formatCircleNumber(params.scaleStepY || 0, 3)},${formatCircleNumber(params.scaleStepZ || 0, 3)}` : ''}${params.scaleOffsets ? ', scaled offsets' : ''}`;
}

function applyCircleInputsToSelected() {
  updateCirclePreview();
  if (!selectedCircle) return;
  const objectId = parsePlacementObjectId();
  if (!Number.isFinite(objectId) || (!catalog.objects[String(objectId)] && !catalog.devices[String(objectId)])) return;
  beginHistory('Edit Circle Tool');
  syncToolTemplates(selectedCircle, objectId);
  selectedCircle.params = readCircleParamsFromInputs();
  rebuildCircleTool(selectedCircle);
  renderList();
  commitHistory('Edit Circle Tool');
}


function circleToolEulerDegrees(tool) {
  return patternToolEulerDegrees(tool);
}

function circleObjectScale(params, index) {
  return clampUeScale3D({
    x: Number(params.scaleX ?? 1) + Number(params.scaleStepX || 0) * index,
    y: Number(params.scaleY ?? 1) + Number(params.scaleStepY || 0) * index,
    z: Number(params.scaleZ ?? 1) + Number(params.scaleStepZ || 0) * index,
  });
}

function circleTemplateOffsetVector(template, slotScale, scaleOffsets) {
  const offset = template.offset || { x: 0, y: 0, z: 0 };
  const v = new THREE.Vector3(offset.x || 0, offset.y || 0, offset.z || 0);
  return scaleOffsets
    ? v.multiply(new THREE.Vector3(slotScale.x ?? 1, slotScale.z ?? 1, slotScale.y ?? 1))
    : v;
}

function getCircleTemplates(tool) {
  return getPatternTemplates(tool);
}

function activeToolMode() {
  return document.getElementById('gridToolPanel')?.hasAttribute('hidden') ? 'circle' : 'grid';
}

function circleObjectLocalQuaternion(params, angle, index) {
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(Number(params.objectPitchDeg || 0)),
    -angle + THREE.MathUtils.degToRad(Number(params.offsetDeg || 0) + Number(params.rotationStepDeg || 0) * index),
    THREE.MathUtils.degToRad(Number(params.objectRollDeg || 0)),
    'YXZ'
  );
  return new THREE.Quaternion().setFromEuler(euler);
}

function setCircleHelperRadius(tool) {
  const radius = tool.params.diameter / 2;
  if (tool.helperRadius === radius && tool.group.children.length) {
    updateCircleHelperSelection(tool);
    return;
  }
  tool.helperRadius = radius;
  disposeHelperChildren(tool.group);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.15, 8, 128),
    new THREE.MeshBasicMaterial({ color: 0x33b6ff, transparent: true, opacity: selectedCircle === tool ? 0.95 : 0.55 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.userData.circleToolRef = tool;
  tool.group.add(ring);

  const center = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 16, 8),
    new THREE.MeshBasicMaterial({ color: 0x33b6ff, transparent: true, opacity: selectedCircle === tool ? 0.95 : 0.65 })
  );
  center.userData.circleToolRef = tool;
  tool.group.add(center);
}

function updateCircleHelperSelection(tool) {
  setHelperChildrenOpacity(tool.group, selectedCircle === tool);
  updateToolSourceHighlight(tool, selectedCircle === tool);
}

// The slot-0 instances (items[0..templateCount-1]) are the editable base; highlight them while the
// tool is selected. Shared by circle and grid.
function toolSourceItems(tool) {
  if (!tool) return [];
  const templateCount = Math.max(1, getCircleTemplates(tool).length);
  return tool.items.slice(0, templateCount).filter(Boolean);
}

function isToolSourceItem(item) {
  const tool = selectedCircle || selectedGrid;
  return tool && toolSourceItems(tool).includes(item);
}

function updateToolSourceHighlight(tool, highlight) {
  toolSourceItems(tool).forEach((item, i) => {
    if (selectedItems.has(item)) return;
    if (highlight) setItemSelectedMaterials(item, selectionColorForIndex(i)); // distinct hue per base object
    else setItemNormalMaterials(item, nrmOpacity);
  });
}

function deselectAllTools() {
  selectedBase = null;
  if (selectedCircle) {
    const old = selectedCircle;
    selectedCircle = null;
    updateCircleHelperSelection(old);
  }
  if (selectedGrid) {
    const old = selectedGrid;
    selectedGrid = null;
    updateGridHelperSelection(old);
  }
}

function setHelperChildrenOpacity(group, isSelected) {
  for (const child of group.children) {
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const m of mats) { m.opacity = isSelected ? 0.95 : 0.55; m.needsUpdate = true; }
  }
}

function disposeHelperChildren(group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.geometry?.dispose();
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const m of mats) m?.dispose?.();
  }
}

function syncToolTemplates(tool, objectId) {
  if (
    placementTemplates?.length &&
    tool.templateVersion !== placementTemplateVersion &&
    circleTemplatesKey(tool.templates) !== circleTemplatesKey(placementTemplates)
  ) {
    for (const item of [...tool.items]) deleteItem(item, true);
    tool.items.length = 0;
    tool.templates = clonePlain(placementTemplates);
    tool.templateVersion = placementTemplateVersion;
    tool.objectId = tool.templates[0].objectId;
  } else if (!tool.templates?.length && objectId !== tool.objectId) {
    for (const item of [...tool.items]) deleteItem(item, true);
    tool.items.length = 0;
    tool.templates = null;
    placementTemplates = null;
    placementTemplateVersion++;
    tool.templateVersion = 0;
    tool.objectId = objectId;
  }
}

function syncToolItemPool(tool, totalItems, templates, toolKey) {
  const needsRebuild = tool.items.some((item, idx) => Number(item.ueObj.objectId) !== Number(templates[idx % templates.length].objectId));
  if (needsRebuild) {
    for (const item of [...tool.items]) deleteItem(item, true);
    tool.items.length = 0;
  }
  while (tool.items.length > totalItems) deleteItem(tool.items.at(-1), true);
  while (tool.items.length < totalItems) {
    const template = templates[tool.items.length % templates.length];
    const tq = template.quaternion || { x: 0, y: 0, z: 0, w: 1 };
    const ueObj = template.source
      ? makePastedObject(template.source, 0)
      : newSceneObject(
          template.objectId,
          tool.group.position,
          new THREE.Quaternion(tq.x || 0, tq.y || 0, tq.z || 0, tq.w ?? 1),
          template.scale3D || { x: 1, y: 1, z: 1 }
        );
    const item = addSceneObject(ueObj, { keepEditorPivotOnMeshLoad: false, [toolKey]: tool.id });
    if (item) {
      item[toolKey] = tool.id;
      tool.items.push(item);
    }
  }
}

// --- One pattern-tool system: circle and grid differ only in slot count + per-slot frame ----------
function toolSlotCount(tool, type) {
  return type === 'grid'
    ? Math.max(1, Math.round(tool.params.columns || 1)) * Math.max(1, Math.round(tool.params.rows || 1)) * Math.max(1, Math.round(tool.params.layers || 1))
    : circlePlacementCount(tool.params);
}

// A slot frame = where one slot's objects are stamped: { root, quat, scale, scaleOffsets }.
function circleSlotFrame(tool, slot, count) {
  const params = tool.params;
  const angle = (slot / count) * Math.PI * 2;
  const radialAmount = params.diameter / 2 + Number(params.radialStep || 0) * slot;
  const local = new THREE.Vector3(Math.cos(angle) * radialAmount, Number(params.heightStep || 0) * slot, Math.sin(angle) * radialAmount);
  const root = local.applyQuaternion(tool.group.quaternion).add(tool.group.position);
  const quat = tool.group.quaternion.clone().multiply(circleObjectLocalQuaternion(params, angle, slot));
  return { root, quat, scale: circleObjectScale(params, slot), scaleOffsets: Boolean(params.scaleOffsets) };
}

function gridSlotFrame(tool, slot) {
  const params = tool.params;
  const columns = Math.max(1, Math.round(params.columns || 1));
  const rows = Math.max(1, Math.round(params.rows || 1));
  const col = slot % columns;
  const row = Math.floor((slot / columns) % rows);
  const layer = Math.floor(slot / (columns * rows));
  const local = new THREE.Vector3(
    (col - (columns - 1) / 2) * Number(params.spacingX || 0),
    Number(params.heightStep || 0) * row + Number(params.spacingZ || 0) * layer,
    (row - (rows - 1) / 2) * Number(params.spacingY || 0),
  );
  const root = local.applyQuaternion(tool.group.quaternion).add(tool.group.position);
  const quat = tool.group.quaternion.clone().multiply(gridObjectLocalQuaternion(params, slot));
  return { root, quat, scale: circleObjectScale(params, slot), scaleOffsets: false };
}

function toolSlotFrame(tool, type, slot, count) {
  return type === 'grid' ? gridSlotFrame(tool, slot) : circleSlotFrame(tool, slot, count);
}

function rebuildPatternTool(tool, type) {
  const templates = getCircleTemplates(tool);
  const count = toolSlotCount(tool, type);
  const totalItems = count * templates.length;
  syncToolItemPool(tool, totalItems, templates, type === 'grid' ? 'gridToolId' : 'circleToolId');

  for (let slot = 0; slot < count; slot++) {
    const frame = toolSlotFrame(tool, type, slot, count);
    for (let t = 0; t < templates.length; t++) {
      const item = tool.items[slot * templates.length + t];
      const template = templates[t];
      const tq = template.quaternion || { x: 0, y: 0, z: 0, w: 1 };
      const rootPosition = circleTemplateOffsetVector(template, frame.scale, frame.scaleOffsets)
        .applyQuaternion(frame.quat)
        .add(frame.root);
      const scale = multiplyScale3D(template.scale3D, frame.scale);
      item.group.scale.copy(ue4ScaleToThree(scale));
      item.group.quaternion.copy(frame.quat).multiply(new THREE.Quaternion(tq.x || 0, tq.y || 0, tq.z || 0, tq.w ?? 1));
      item.group.position.copy(rootPosition).add(transformedPivotOffset(item));
      item.ueObj.spawnTransform.translation = threePosToUe4(rootPosition);
      item.ueObj.spawnTransform.rotation = threeQuatToUe4(item.group.quaternion);
      item.ueObj.spawnTransform.scale3D = scale;
    }
  }

  if (type === 'grid') {
    setGridHelperSize(tool);
    updateGridPreview();
    if (selectedGrid === tool) updateGridPropsPanel(tool);
  } else {
    setCircleHelperRadius(tool);
    updateCirclePreview();
    if (selectedCircle === tool) updateCirclePropsPanel(tool);
  }
}

function rebuildCircleTool(tool) { rebuildPatternTool(tool, 'circle'); }

function createCircleTool(objectId, center, params, templates = null, options = {}) {
  const tool = {
    id: circleToolSeq++,
    objectId: templates?.[0]?.objectId ?? objectId,
    templates: templates?.length ? clonePlain(templates) : null,
    templateVersion: templates?.length ? placementTemplateVersion : 0,
    params: { ...params },
    group: new THREE.Group(),
    items: [],
  };
  tool.group.position.copy(center);
  if (options.quaternion) tool.group.quaternion.copy(options.quaternion);
  tool.group.name = `Circle Tool ${tool.id}`;
  tool.group.userData.circleToolRef = tool;
  CIRCLE_TOOLS.push(tool);
  scene.add(tool.group);
  rebuildCircleTool(tool);
  return tool;
}

let placeOneTracked = false;

function placeOneObject() {
  const objectId = parsePlacementObjectId();
  if (!Number.isFinite(objectId)) { setStatus('Choose an object/device to place', true); return; }
  if (!catalog.objects[String(objectId)] && !catalog.devices[String(objectId)]) { setStatus(`Unknown objectId ${objectId}`, true); return; }
  beginHistory('Place Object');
  // Spawn at the camera position, then select it so the gizmo is ready to drag it into place.
  const item = addSceneObject(newSceneObject(
    objectId,
    camera.position.clone(),
    new THREE.Quaternion(),
    { x: 1, y: 1, z: 1 }
  ));
  if (!item) { cancelHistory(); return; }
  selectItem(item);
  setMode('translate');
  updatePlacementPreview();
  renderList();
  commitHistory('Place Object');
  setStatus(`Placed ${item.meta.name} (${objectId}) - drag to position`);
  if (!placeOneTracked) {
    placeOneTracked = true;
    trackEvent('first_place_object');
  }
}

function placeCircleObjects() {
  const objectId = parsePlacementObjectId();
  if (!Number.isFinite(objectId)) { setStatus('Choose an object/device to place', true); return; }
  if (!catalog.objects[String(objectId)] && !catalog.devices[String(objectId)]) { setStatus(`Unknown objectId ${objectId}`, true); return; }
  const objects = getPugcObjects();
  if (!objects) { setStatus('Open a .pugc file before placing objects', true); return; }

  const params = readCircleParamsFromInputs();
  const templates = placementTemplates;
  beginHistory('Create Circle Tool');
  const tool = createCircleTool(objectId, placementCenterThree(), params, templates);
  selectCircleTool(tool);
  updatePlacementPreview();
  renderList();
  commitHistory('Create Circle Tool');
  setStatus(`Created Circle Tool ${tool.id}: ${tool.items.length} object${tool.items.length === 1 ? '' : 's'}`);
}

function readGridParamsFromInputs() {
  return {
    columns: Math.max(1, Math.min(250, Math.round(numericInputValue('gridColumns', 3)))),
    rows: Math.max(1, Math.min(250, Math.round(numericInputValue('gridRows', 3)))),
    layers: Math.max(1, Math.min(250, Math.round(numericInputValue('gridLayers', 1)))),
    spacingX: Math.max(0, numericInputValue('gridSpacingX', 5)),
    spacingY: Math.max(0, numericInputValue('gridSpacingY', 5)),
    spacingZ: numericInputValue('gridSpacingZ', 0),
    heightStep: numericInputValue('gridHeightStep', 0),
    yawStepDeg: numericInputValue('gridYawStep', 0),
    objectPitchDeg: numericInputValue('gridObjectPitch', 0),
    offsetDeg: numericInputValue('gridObjectYaw', 0),
    objectRollDeg: numericInputValue('gridObjectRoll', 0),
    scaleX: clampObjectScaleValue(numericInputValue('gridScaleX', 1)),
    scaleY: clampObjectScaleValue(numericInputValue('gridScaleY', 1)),
    scaleZ: clampObjectScaleValue(numericInputValue('gridScaleZ', 1)),
    scaleStepX: 0,
    scaleStepY: 0,
    scaleStepZ: 0,
  };
}

function gridPlacementCount(params = readGridParamsFromInputs()) {
  return Math.max(1, Math.min(250, Math.round(params.columns || 1))) *
    Math.max(1, Math.min(250, Math.round(params.rows || 1))) *
    Math.max(1, Math.min(250, Math.round(params.layers || 1)));
}

function updateGridSliderLabels(params = readGridParamsFromInputs()) {
  for (const [sliderId, value] of [
    ['gridColumnsSlider', params.columns || 3],
    ['gridRowsSlider', params.rows || 3],
    ['gridLayersSlider', params.layers || 1],
    ['gridSpacingXSlider', params.spacingX || 0],
    ['gridSpacingYSlider', params.spacingY || 0],
    ['gridSpacingZSlider', params.spacingZ || 0],
    ['gridHeightStepSlider', params.heightStep || 0],
    ['gridYawStepSlider', params.yawStepDeg || 0],
    ['gridObjectPitchSlider', params.objectPitchDeg || 0],
    ['gridObjectYawSlider', params.offsetDeg || 0],
    ['gridObjectRollSlider', params.objectRollDeg || 0],
    ['gridScaleXSlider', params.scaleX || 1],
    ['gridScaleYSlider', params.scaleY || 1],
    ['gridScaleZSlider', params.scaleZ || 1],
  ]) syncLinearRange(sliderId, value);
}

function updateGridPreview() {
  const el = document.getElementById('gridPreviewText');
  if (!el) return;
  const params = readGridParamsFromInputs();
  updateGridSliderLabels(params);
  const templates = placementTemplates?.length || 1;
  const rotated = params.objectPitchDeg || params.offsetDeg || params.objectRollDeg || params.yawStepDeg;
  const scaled = params.scaleX !== 1 || params.scaleY !== 1 || params.scaleZ !== 1;
  const layers = Math.max(1, Math.round(params.layers || 1));
  const gridDesc = layers > 1 ? `${params.columns} x ${params.rows} x ${layers}L` : `${params.columns} x ${params.rows}`;
  el.textContent = `${gridDesc} grid, ${gridPlacementCount(params) * templates} object${gridPlacementCount(params) * templates === 1 ? '' : 's'}${rotated ? ', object rotation' : ''}${scaled ? ', scaled' : ''}`;
}

function writeGridParamsToInputs(tool) {
  setPlacementObject(tool.objectId, { close: false, apply: false, keepTemplates: true });
  setInputValue('gridColumns', tool.params.columns || 3, 0);
  setInputValue('gridRows', tool.params.rows || 3, 0);
  setInputValue('gridLayers', tool.params.layers || 1, 0);
  setInputValue('gridSpacingX', tool.params.spacingX || 0, 2);
  setInputValue('gridSpacingY', tool.params.spacingY || 0, 2);
  setInputValue('gridSpacingZ', tool.params.spacingZ || 0, 2);
  setInputValue('gridHeightStep', tool.params.heightStep || 0, 2);
  setInputValue('gridYawStep', tool.params.yawStepDeg || 0);
  setInputValue('gridObjectPitch', tool.params.objectPitchDeg || 0);
  setInputValue('gridObjectYaw', tool.params.offsetDeg || 0);
  setInputValue('gridObjectRoll', tool.params.objectRollDeg || 0);
  setInputValue('gridScaleX', tool.params.scaleX || 1, 3);
  setInputValue('gridScaleY', tool.params.scaleY || 1, 3);
  setInputValue('gridScaleZ', tool.params.scaleZ || 1, 3);
  setPlacementCenterFromThree(tool.group.position);
  updateGridSliderLabels(tool.params);
}

function applyGridInputsToSelected() {
  updateGridPreview();
  if (!selectedGrid) return;
  const objectId = parsePlacementObjectId();
  if (!Number.isFinite(objectId) || (!catalog.objects[String(objectId)] && !catalog.devices[String(objectId)])) return;
  beginHistory('Edit Grid Tool');
  syncToolTemplates(selectedGrid, objectId);
  selectedGrid.params = readGridParamsFromInputs();
  rebuildGridTool(selectedGrid);
  renderList();
  commitHistory('Edit Grid Tool');
}

function applyPlacementInputsToSelected() {
  if (selectedGrid) applyGridInputsToSelected();
  else applyCircleInputsToSelected();
}

function gridObjectLocalQuaternion(params, index) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(Number(params.objectPitchDeg || 0)),
    THREE.MathUtils.degToRad(Number(params.offsetDeg || 0) + Number(params.yawStepDeg || 0) * index),
    THREE.MathUtils.degToRad(Number(params.objectRollDeg || 0)),
    'YXZ'
  ));
}

function setGridHelperSize(tool) {
  const columns = Math.max(1, Math.round(tool.params.columns || 1));
  const rows = Math.max(1, Math.round(tool.params.rows || 1));
  const layers = Math.max(1, Math.round(tool.params.layers || 1));
  const spacingX = Number(tool.params.spacingX || 0);
  const spacingY = Number(tool.params.spacingY || 0);
  const spacingZ = Number(tool.params.spacingZ || 0);
  const width = Math.max(0.5, (columns - 1) * spacingX);
  const depth = Math.max(0.5, (rows - 1) * spacingY);
  const key = `${columns}:${rows}:${layers}:${spacingX}:${spacingY}:${spacingZ}`;
  if (tool.helperKey === key && tool.group.children.length) {
    updateGridHelperSelection(tool);
    return;
  }
  tool.helperKey = key;
  disposeHelperChildren(tool.group);

  const lineMat = new THREE.LineBasicMaterial({ color: 0x7bd56f, transparent: true, opacity: selectedGrid === tool ? 0.95 : 0.55 });
  const points = [];
  const left = -width / 2;
  const right = width / 2;
  const top = -depth / 2;
  const bottom = depth / 2;
  for (let l = 0; l < layers; l++) {
    const y = spacingZ * l;
    for (let c = 0; c < columns; c++) {
      const x = (c - (columns - 1) / 2) * spacingX;
      points.push(new THREE.Vector3(x, y, top), new THREE.Vector3(x, y, bottom));
    }
    for (let r = 0; r < rows; r++) {
      const z = (r - (rows - 1) / 2) * spacingY;
      points.push(new THREE.Vector3(left, y, z), new THREE.Vector3(right, y, z));
    }
  }
  if (layers > 1) {
    const topY = spacingZ * (layers - 1);
    for (const cx of [left, right]) {
      for (const cz of [top, bottom]) {
        points.push(new THREE.Vector3(cx, 0, cz), new THREE.Vector3(cx, topY, cz));
      }
    }
  }
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const lines = new THREE.LineSegments(geo, lineMat);
  lines.userData.gridToolRef = tool;
  tool.group.add(lines);

  const center = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.25, 1.4),
    new THREE.MeshBasicMaterial({ color: 0x7bd56f, transparent: true, opacity: selectedGrid === tool ? 0.95 : 0.65 })
  );
  center.userData.gridToolRef = tool;
  tool.group.add(center);
}

function updateGridHelperSelection(tool) {
  setHelperChildrenOpacity(tool.group, selectedGrid === tool);
  updateToolSourceHighlight(tool, selectedGrid === tool);
}

function rebuildGridTool(tool) { rebuildPatternTool(tool, 'grid'); }

function createGridTool(objectId, center, params, templates = null, options = {}) {
  const tool = {
    id: gridToolSeq++,
    objectId: templates?.[0]?.objectId ?? objectId,
    templates: templates?.length ? clonePlain(templates) : null,
    templateVersion: templates?.length ? placementTemplateVersion : 0,
    params: { ...params },
    group: new THREE.Group(),
    items: [],
  };
  tool.group.position.copy(center);
  if (options.quaternion) tool.group.quaternion.copy(options.quaternion);
  tool.group.name = `Grid Tool ${tool.id}`;
  tool.group.userData.gridToolRef = tool;
  GRID_TOOLS.push(tool);
  scene.add(tool.group);
  rebuildGridTool(tool);
  return tool;
}

function placeGridObjects() {
  const objectId = parsePlacementObjectId();
  if (!Number.isFinite(objectId)) { setStatus('Choose an object/device to place', true); return; }
  if (!catalog.objects[String(objectId)] && !catalog.devices[String(objectId)]) { setStatus(`Unknown objectId ${objectId}`, true); return; }
  const objects = getPugcObjects();
  if (!objects) { setStatus('Open a .pugc file before placing objects', true); return; }

  const params = readGridParamsFromInputs();
  const templates = placementTemplates;
  beginHistory('Create Grid Tool');
  const tool = createGridTool(objectId, placementCenterThree(), params, templates);
  selectGridTool(tool);
  updatePlacementPreview();
  renderList();
  commitHistory('Create Grid Tool');
  setStatus(`Created Grid Tool ${tool.id}: ${tool.items.length} object${tool.items.length === 1 ? '' : 's'}`);
}

function fitCamera() {
  fitCameraToItems(ITEMS, { camera, orbitControls });
}

// Park the camera near the middle of the map (used on scene load / refresh) rather than framing the
// whole level, which puts you very far out.
function resetCameraToStart() {
  if (!camera || !orbitControls) return;
  orbitControls.target.copy(WORLD_START_TARGET);
  camera.position.copy(WORLD_START_TARGET).add(new THREE.Vector3(0, 300, 600));
  camera.lookAt(orbitControls.target);
  orbitControls.update();
}

// --- Selection ----------------------------------------------------------------

function restoreSelectedItemColor() {
  selected = clearItemSelection(selectedItems, nrmOpacity);
}

function selectedDeviceNodeIds() {
  return new Set([...selectedItems]
    .filter(item => item?.ueObj && isDeviceObjectId(item.ueObj.objectId) && item.ueObj.deviceIndex !== -1)
    .map(item => `${item.ueObj.objectId}:${item.ueObj.deviceIndex}`));
}

function selectCurrentGraphGroup(ids, event) {
  const idSet = new Set(ids || []);
  const items = ITEMS.filter(item => idSet.has(`${item.ueObj?.objectId}:${item.ueObj?.deviceIndex}`));
  if (!items.length) return;
  const additive = Boolean(event?.shiftKey || event?.ctrlKey || event?.metaKey);
  if (!additive) deselectObject();
  for (const item of items) selectItem(item, { add: true });
  logicGraph?.setSelectedIds(selectedDeviceNodeIds());
  setStatus(`Selected ${items.length} graph node${items.length === 1 ? '' : 's'}`);
}

function updateSelectionButtons() {
  const hasItem = selectedItems.size > 0;
  const hasSelection = hasItem || Boolean(selectedCircle) || Boolean(selectedGrid) || Boolean(selectedCollection) || Boolean(selectedBase);
  document.getElementById('btnFocus').disabled = !hasSelection;
  document.getElementById('btnDelete').disabled = !hasSelection;
  document.getElementById('btnCreateCollection').disabled = !getPugcObjects();
  // Tool creation works on a free-object selection (like New Collection).
  const hasFreeSel = uniqueCollectionItems([...selectedItems]).length > 0;
  const btnCircle = document.getElementById('btnCreateCircleTool');
  const btnGrid = document.getElementById('btnCreateGridTool');
  if (btnCircle) btnCircle.disabled = !hasFreeSel;
  if (btnGrid) btnGrid.disabled = !hasFreeSel;
  const btnAiPath = document.getElementById('btnChainAiPath');
  if (btnAiPath) btnAiPath.disabled = [...selectedItems].filter(it => Number(it.ueObj?.objectId) === AI_NAV_OBJECT_ID).length < 2;
  const relC = document.getElementById('btnReleaseCircle');
  if (relC) relC.hidden = !selectedCircle;
  const relG = document.getElementById('btnReleaseGrid');
  if (relG) relG.hidden = !selectedGrid;
  // The tool params/menu only appears while a tool is selected.
  const toolSection = document.getElementById('toolParamsSection');
  if (toolSection) toolSection.hidden = !(selectedCircle || selectedGrid);
  // Align button: enabled when 2+ free items selected; collapse if selection drops below that.
  const hasDist = uniqueCollectionItems([...selectedItems]).length >= 2;
  const btnSelTools = document.getElementById('btnSelectionTools');
  if (!hasDist && selAlignActive) {
    selAlignActive = false;
    if (btnSelTools) btnSelTools.classList.remove('active');
  }
  if (btnSelTools) btnSelTools.disabled = !hasDist;
  const selToolSection = document.getElementById('selectionToolSection');
  if (selToolSection) selToolSection.hidden = !selAlignActive;
  // Disable Scale for devices the catalog marks unscaleable (and leave scale mode if active).
  const noScale = selectionScaleMode() === 'none';
  const scaleBtn = document.getElementById('btnScale');
  if (scaleBtn) scaleBtn.disabled = noScale;
  if (noScale && transformControls?.mode === 'scale') setMode('translate');
  updateClipboardButtons();
}

function hidePropsPanels() {
  document.getElementById('propsEmpty').style.display = 'none';
  document.getElementById('propsContent').style.display = 'none';
  document.getElementById('propsDetailsEmpty').style.display = '';
  document.getElementById('propsDetailsContent').style.display = 'none';
}

function selectItem(item, { add = false, toggle = false } = {}) {
  if (!item) return;
  window.getSelection()?.removeAllRanges(); // selecting a scene object clears any page text selection
  selectedCollection = null;
  deselectAllTools();
  if (!add && !toggle) restoreSelectedItemColor();
  selected = applyItemSelection({
    item,
    selectedItems,
    current: selected,
    add: true,
    toggle,
    normalOpacity: nrmOpacity,
  });
  if (selected) {
    transformControls.attach(selected.group);
    updatePropsPanel(selected);
    refreshListSelection();
    scrollListToSelected();
  } else {
    transformControls.detach();
    hidePropsPanels();
    refreshListSelection();
  }
  logicGraph?.setSelected(selected);
  updateSelectionButtons();
}

function selectCircleTool(tool) {
  if (selectedCircle === tool) return;
  selectedCollection = null;
  restoreSelectedItemColor();
  placementTemplates = tool.templates?.length ? clonePlain(tool.templates) : null;
  placementTemplateVersion = tool.templateVersion || placementTemplateVersion + 1;
  if (tool.templates?.length && !tool.templateVersion) tool.templateVersion = placementTemplateVersion;
  deselectAllTools();
  selectedCircle = tool;
  selected = null;
  updateCircleHelperSelection(tool);
  setToolTab('circle');
  writeCircleParamsToInputs(tool);
  setMode('translate');
  transformControls.attach(tool.group);
  updateCirclePropsPanel(tool);
  updateSelectionButtons();
}

function selectGridTool(tool) {
  if (selectedGrid === tool) return;
  selectedCollection = null;
  restoreSelectedItemColor();
  placementTemplates = tool.templates?.length ? clonePlain(tool.templates) : null;
  placementTemplateVersion = tool.templateVersion || placementTemplateVersion + 1;
  if (tool.templates?.length && !tool.templateVersion) tool.templateVersion = placementTemplateVersion;
  deselectAllTools();
  selectedGrid = tool;
  selected = null;
  updateGridHelperSelection(tool);
  setToolTab('grid');
  writeGridParamsToInputs(tool);
  setMode('translate');
  transformControls.attach(tool.group);
  updateGridPropsPanel(tool);
  updateSelectionButtons();
}

function selectCollection(collection) {
  if (!collection) return;
  restoreSelectedItemColor();
  deselectAllTools();
  selectedCollection = collection;
  selected = null;
  for (const item of collection.items) {
    if (!ITEMS.includes(item)) continue;
    selected = applyItemSelection({
      item,
      selectedItems,
      current: selected,
      add: true,
      toggle: false,
      normalOpacity: nrmOpacity,
    });
  }
  if (selected) {
    transformControls.attach(selected.group);
    updatePropsPanel(selected);
  } else {
    transformControls.detach();
    hidePropsPanels();
  }
  updateSelectionButtons();
}

// Slot-0 of a tool is its editable "source" (Blender array/collection-instance model): selecting one
// of those objects edits the template entry and re-stamps every slot; all other slots stay locked.
function selectBaseObject(tool, type, templateIndex, { add = false } = {}) {
  if (!tool.templates?.length) tool.templates = clonePlain(getPatternTemplates(tool));
  const item = tool.items[templateIndex];
  if (!item) return;

  if (add && selectedBase?.tool === tool) {
    selected = applyItemSelection({ item, selectedItems, current: selected, add: true, toggle: true, normalOpacity: nrmOpacity });
    if (selectedItems.has(item)) {
      selectedBase = { tool, type, templateIndex };
      transformControls.attach(item.group);
    } else if (selected) {
      const newIdx = tool.items.indexOf(selected);
      if (newIdx >= 0) selectedBase = { tool, type, templateIndex: newIdx };
      transformControls.attach(selected.group);
    } else {
      selectedBase = null;
      if (type === 'circle') selectCircleTool(tool); else selectGridTool(tool);
      return;
    }
  } else {
    restoreSelectedItemColor();
    deselectAllTools();
    selectedCollection = null;
    selected = clearItemSelection(selectedItems, nrmOpacity);
    selected = applyItemSelection({ item, selectedItems, current: null, add: true, toggle: false, normalOpacity: nrmOpacity });
    selectedBase = { tool, type, templateIndex };
    transformControls.attach(item.group);
    setMode('translate');
  }

  updatePropsPanel(item);
  updateSelectionButtons();
  const meta = getObjectMeta(item.ueObj.objectId);
  const multi = selectedItems.size > 1 ? ` (${selectedItems.size} selected)` : '';
  setStatus(`Editing ${type === 'grid' ? 'Grid' : 'Circle'} Tool ${tool.id} base object ${templateIndex + 1} (${meta.name})${multi} - move to reshape the pattern, Delete button removes it from the base`);
}

function removeBaseObjectByIndex(tool, type, templateIndex) {
  if (!tool) return;
  if (!tool.templates?.length) tool.templates = clonePlain(getPatternTemplates(tool));
  if (templateIndex < 0 || templateIndex >= tool.templates.length) return;
  if (tool.templates.length <= 1) { setStatus('A tool needs at least one base object', true); return; }
  beginHistory('Remove Base Object');
  tool.templates.splice(templateIndex, 1);
  tool.templateVersion = (tool.templateVersion || 0) + 1;
  placementTemplates = clonePlain(tool.templates);
  placementTemplateVersion++;
  selectedBase = null;
  selected = clearItemSelection(selectedItems, nrmOpacity);
  if (type === 'grid') { selectedGrid = null; rebuildGridTool(tool); selectGridTool(tool); }
  else { selectedCircle = null; rebuildCircleTool(tool); selectCircleTool(tool); }
  renderList();
  commitHistory('Remove Base Object');
  setStatus('Removed object from tool base');
}

function removeBaseObject() {
  if (selectedBase) removeBaseObjectByIndex(selectedBase.tool, selectedBase.type, selectedBase.templateIndex);
}

function deselectObject() {
  restoreSelectedItemColor();
  selectedBase = null;
  selectedCollection = null;
  if (selectedCircle) {
    const old = selectedCircle;
    selectedCircle = null;
    updateCircleHelperSelection(old);
  }
  if (selectedGrid) {
    const old = selectedGrid;
    selectedGrid = null;
    updateGridHelperSelection(old);
  }
  transformControls.detach();
  hidePropsPanels();
  logicGraph?.setSelected(null);
  updateSelectionButtons();
  document.getElementById('hudCoords').textContent = '';
}

// --- Box (marquee) selection --------------------------------------------------
let boxSelEl = null;
const _boxSelVec = new THREE.Vector3();

function drawBoxSelRect(a, b) {
  if (!boxSelEl) {
    boxSelEl = document.createElement('div');
    boxSelEl.style.cssText =
      'position:fixed;border:1px solid #4ea3ff;background:rgba(78,163,255,0.12);' +
      'pointer-events:none;z-index:9999;display:none;';
    document.body.appendChild(boxSelEl);
  }
  boxSelEl.style.left   = Math.min(a.x, b.x) + 'px';
  boxSelEl.style.top    = Math.min(a.y, b.y) + 'px';
  boxSelEl.style.width  = Math.abs(a.x - b.x) + 'px';
  boxSelEl.style.height = Math.abs(a.y - b.y) + 'px';
  boxSelEl.style.display = 'block';
}

function hideBoxSelRect() {
  if (boxSelEl) boxSelEl.style.display = 'none';
}

function boxSelectItems(min, max, additive) {
  const rect = document.getElementById('sceneCanvas').getBoundingClientRect();
  if (!additive) {
    restoreSelectedItemColor();
    selected = clearItemSelection(selectedItems, nrmOpacity);
    selectedCollection = null;
    deselectAllTools();
  }
  const owned = toolOwnedItemSet();
  for (const item of ITEMS) {
    if (!item.group.visible || owned.has(item)) continue; // tool objects are locked to their tool
    item.group.getWorldPosition(_boxSelVec);
    _boxSelVec.project(camera);
    if (_boxSelVec.z > 1) continue; // behind the camera
    const sx = rect.left + ( _boxSelVec.x * 0.5 + 0.5) * rect.width;
    const sy = rect.top  + (-_boxSelVec.y * 0.5 + 0.5) * rect.height;
    if (sx < min.x || sx > max.x || sy < min.y || sy > max.y) continue;
    selected = applyItemSelection({
      item,
      selectedItems,
      current: selected,
      add: true,
      toggle: false,
      normalOpacity: nrmOpacity,
    });
  }
  if (selected) {
    transformControls.attach(selected.group);
    updatePropsPanel(selected);
    scrollListToSelected();
  } else {
    transformControls.detach();
    hidePropsPanels();
  }
  updateSelectionButtons();
  refreshListSelection();
}

function onCanvasClick(event) {
  const canvas = document.getElementById('sceneCanvas');
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width)  *  2 - 1,
    ((event.clientY - rect.top)  / rect.height) * -2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);

  // Objects first, then tool helpers. The grid helper's line-grid spans the whole pattern and would
  // otherwise intercept clicks on grid objects (so the grid base was never selectable in the viewport).
  // item.mesh may be a Group of InstancedMeshes; walk up to the group tagged with itemRef.
  const meshes = ITEMS.map(i => i.mesh).filter(Boolean);
  const hits = raycaster.intersectObjects(meshes, true);
  if (hits.length) {
    let o = hits[0].object;
    while (o && !o.userData?.itemRef) o = o.parent;
    const hit = o?.userData?.itemRef;
    if (hit) {
      const owner = toolOwning(hit);
      if (owner) {
        // Slot 0 (the first instance of each template) is the editable source; clicking it edits the
        // base. Any other slot is a locked projection and selects the tool controller.
        const tIdx = owner.tool.items.indexOf(hit);
        const templateCount = getCircleTemplates(owner.tool).length;
        if (tIdx >= 0 && tIdx < templateCount) {
          selectBaseObject(owner.tool, owner.type, tIdx, { add: event.shiftKey || event.ctrlKey || event.metaKey });
        } else if (owner.type === 'circle') {
          selectCircleTool(owner.tool);
        } else {
          selectGridTool(owner.tool);
        }
        refreshListSelection();
        return;
      }
      selectItem(hit, { add: event.ctrlKey || event.metaKey || event.shiftKey, toggle: event.ctrlKey || event.metaKey || event.shiftKey });
      refreshListSelection();
      return;
    }
  }

  // Tool helpers (ring / grid lines / centre marker) - select the tool when no object was hit.
  const toolMeshes = [...CIRCLE_TOOLS, ...GRID_TOOLS]
    .flatMap(tool => tool.group.children.filter(child => child.isMesh || child.isLineSegments));
  const toolHits = raycaster.intersectObjects(toolMeshes, false);
  if (toolHits.length) {
    const ref = toolHits[0].object.userData;
    if (ref.circleToolRef) { selectCircleTool(ref.circleToolRef); refreshListSelection(); return; }
    if (ref.gridToolRef) { selectGridTool(ref.gridToolRef); refreshListSelection(); return; }
  }

  deselectObject();
  refreshListSelection();
}

// --- Transform change -> write back to pugcJson --------------------------------

function beginMultiTransform() {
  multiTransformStart = createMultiTransformStart(selected, selectedItems, editorPivotToRootPosition);
}

function applyMultiTransformDelta() {
  applyMultiSelectionTransform(multiTransformStart, selected, selectedItems, {
    rootPositionForItem: editorPivotToRootPosition,
    pivotOffsetForItem: transformedPivotOffset,
    clampScale: clampThreeScale,
    positionToUe4: threePosToUe4,
    quaternionToUe4: threeQuatToUe4,
    scaleToUe4: threeScaleToUe4,
  });
}

function onTransformChange() {
  if (selectedBase) {
    const { tool, type, templateIndex } = selectedBase;
    const item = tool.items[templateIndex];
    if (!item || !tool.templates?.[templateIndex]) return;
    clampThreeScale(item.group.scale);
    applyMultiTransformDelta();
    const frame = type === 'grid' ? gridSlotZeroFrame(tool) : circleSlotZeroFrame(tool);
    const templateCount = getCircleTemplates(tool).length;
    for (const baseItem of selectedItems) {
      const tIdx = tool.items.indexOf(baseItem);
      if (tIdx < 0 || tIdx >= templateCount || !tool.templates[tIdx]) continue;
      clampThreeScale(baseItem.group.scale);
      const e = templateEntryFromItem(baseItem, frame);
      tool.templates[tIdx] = { ...tool.templates[tIdx], offset: e.offset, quaternion: e.quaternion, scale3D: e.scale3D };
    }
    tool.templateVersion = (tool.templateVersion || 0) + 1;
    placementTemplates = clonePlain(tool.templates);
    placementTemplateVersion++;
    if (type === 'grid') rebuildGridTool(tool); else rebuildCircleTool(tool);
    updatePropsPanel(tool.items[templateIndex]);
    const entry = templateEntryFromItem(item, frame);
    document.getElementById('hudCoords').textContent =
      `Base ${templateIndex + 1} - offset ${entry.offset.x.toFixed(2)}, ${entry.offset.y.toFixed(2)}, ${entry.offset.z.toFixed(2)} m`;
    return;
  }
  if (selectedCircle) {
    rebuildCircleTool(selectedCircle);
    updateDeviceLinkLines();
    setPlacementCenterFromThree(selectedCircle.group.position);
    const t = threePosToUe4(selectedCircle.group.position);
    const r = circleToolEulerDegrees(selectedCircle);
    document.getElementById('hudCoords').textContent =
      `Circle X ${t.x.toFixed(0)}  Y ${t.y.toFixed(0)}  Z ${t.z.toFixed(0)} cm  Rot P ${r.p.toFixed(1)} Y ${r.y.toFixed(1)} R ${r.r.toFixed(1)} deg`;
    return;
  }
  if (selectedGrid) {
    rebuildGridTool(selectedGrid);
    updateDeviceLinkLines();
    setPlacementCenterFromThree(selectedGrid.group.position);
    const t = threePosToUe4(selectedGrid.group.position);
    const r = circleToolEulerDegrees(selectedGrid);
    document.getElementById('hudCoords').textContent =
      `Grid X ${t.x.toFixed(0)}  Y ${t.y.toFixed(0)}  Z ${t.z.toFixed(0)} cm  Rot P ${r.p.toFixed(1)} Y ${r.y.toFixed(1)} R ${r.r.toFixed(1)} deg`;
    return;
  }
  if (!selected) return;
  const { group, ueObj } = selected;
  clampThreeScale(group.scale);
  const sMode = itemScaleMode(selected);
  if (sMode === 'none') group.scale.set(1, 1, 1); // catalog says this device can't be scaled
  else if (sMode === 'uniform') { const u = group.scale.x; group.scale.set(u, u, u); }
  ueObj.spawnTransform.translation = threePosToUe4(editorPivotToRootPosition(selected));
  ueObj.spawnTransform.rotation    = threeQuatToUe4(group.quaternion);
  ueObj.spawnTransform.scale3D     = threeScaleToUe4(group.scale);
  applyMultiTransformDelta();
  updateDeviceLinkLines();
  updatePropsPanel(selected);
  const t = ueObj.spawnTransform.translation;
  document.getElementById('hudCoords').textContent =
    `X ${t.x.toFixed(0)}  Y ${t.y.toFixed(0)}  Z ${t.z.toFixed(0)} cm`;
}

// --- Properties panel ---------------------------------------------------------

function applyObjectTransformInputs() {
  if (!selected) return;
  beginHistory('Transform');
  const multiStart = createMultiTransformStart(selected, selectedItems, editorPivotToRootPosition);
  const root = {
    x: numericInputValue('propPosX', selected.ueObj.spawnTransform.translation.x),
    y: numericInputValue('propPosY', selected.ueObj.spawnTransform.translation.y),
    z: numericInputValue('propPosZ', selected.ueObj.spawnTransform.translation.z),
  };
  const scale = clampUeScale3D({
    x: numericInputValue('propScaleX', selected.ueObj.spawnTransform.scale3D.x),
    y: numericInputValue('propScaleY', selected.ueObj.spawnTransform.scale3D.y),
    z: numericInputValue('propScaleZ', selected.ueObj.spawnTransform.scale3D.z),
  });
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(numericInputValue('propRotP', objectEulerDegrees(selected).p)),
    THREE.MathUtils.degToRad(numericInputValue('propRotY', objectEulerDegrees(selected).y)),
    THREE.MathUtils.degToRad(numericInputValue('propRotR', objectEulerDegrees(selected).r)),
    'YXZ'
  );
  const cur = selected.ueObj.spawnTransform.translation;
  const posChanged = Math.abs(root.x - cur.x) > 0.01 || Math.abs(root.y - cur.y) > 0.01 || Math.abs(root.z - cur.z) > 0.01;
  const visualCenter = selected.group.position.clone();
  selected.group.scale.copy(ue4ScaleToThree(scale));
  selected.group.quaternion.setFromEuler(euler);
  selected.ueObj.spawnTransform.scale3D = scale;
  selected.ueObj.spawnTransform.rotation = threeQuatToUe4(selected.group.quaternion);
  if (posChanged) {
    // User explicitly moved actor root: use typed position, visual center follows
    selected.ueObj.spawnTransform.translation = root;
    selected.group.position.copy(ue4PosToThree(root).add(transformedPivotOffset(selected)));
  } else {
    // Only rotation/scale changed: keep visual center fixed to match game behavior
    const newRoot = threePosToUe4(visualCenter.clone().sub(transformedPivotOffset(selected)));
    selected.ueObj.spawnTransform.translation = newRoot;
    selected.group.position.copy(visualCenter);
  }
  applyMultiSelectionTransform(multiStart, selected, selectedItems, {
    rootPositionForItem: editorPivotToRootPosition,
    pivotOffsetForItem: transformedPivotOffset,
    clampScale: clampThreeScale,
    positionToUe4: threePosToUe4,
    quaternionToUe4: threeQuatToUe4,
    scaleToUe4: threeScaleToUe4,
  });
  updatePropsPanel(selected);
  setNumericInputValue('propScaleX', scale.x, 6, true);
  setNumericInputValue('propScaleY', scale.y, 6, true);
  setNumericInputValue('propScaleZ', scale.z, 6, true);
  renderList();
  updateDeviceLinkLines();
  commitHistory('Transform');
}

function applyCircleTransformInputs() {
  if (!selectedCircle) return;
  beginHistory('Transform Circle Tool');
  selectedCircle.group.position.copy(ue4PosToThree({
    x: numericInputValue('propPosX', threePosToUe4(selectedCircle.group.position).x),
    y: numericInputValue('propPosY', threePosToUe4(selectedCircle.group.position).y),
    z: numericInputValue('propPosZ', threePosToUe4(selectedCircle.group.position).z),
  }));
  selectedCircle.group.quaternion.setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(numericInputValue('propRotP', circleToolEulerDegrees(selectedCircle).p)),
      THREE.MathUtils.degToRad(numericInputValue('propRotY', circleToolEulerDegrees(selectedCircle).y)),
      THREE.MathUtils.degToRad(numericInputValue('propRotR', circleToolEulerDegrees(selectedCircle).r)),
      'YXZ'
    )
  );
  rebuildCircleTool(selectedCircle);
  updateCirclePropsPanel(selectedCircle);
  renderList();
  updateDeviceLinkLines();
  commitHistory('Transform Circle Tool');
}

function applyGridTransformInputs() {
  if (!selectedGrid) return;
  beginHistory('Transform Grid Tool');
  selectedGrid.group.position.copy(ue4PosToThree({
    x: numericInputValue('propPosX', threePosToUe4(selectedGrid.group.position).x),
    y: numericInputValue('propPosY', threePosToUe4(selectedGrid.group.position).y),
    z: numericInputValue('propPosZ', threePosToUe4(selectedGrid.group.position).z),
  }));
  selectedGrid.group.quaternion.setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(numericInputValue('propRotP', circleToolEulerDegrees(selectedGrid).p)),
      THREE.MathUtils.degToRad(numericInputValue('propRotY', circleToolEulerDegrees(selectedGrid).y)),
      THREE.MathUtils.degToRad(numericInputValue('propRotR', circleToolEulerDegrees(selectedGrid).r)),
      'YXZ'
    )
  );
  rebuildGridTool(selectedGrid);
  updateGridPropsPanel(selectedGrid);
  renderList();
  updateDeviceLinkLines();
  commitHistory('Transform Grid Tool');
}

// Numeric panel edits for a selected slot-0 base object: apply to the item's group then route through
// the same template write-back as the gizmo (onTransformChange's selectedBase branch).
function applyBaseTransformInputs() {
  if (!selectedBase) return;
  const item = selectedBase.tool.items[selectedBase.templateIndex];
  if (!item) return;
  beginHistory('Transform');
  const curRoot = threePosToUe4(editorPivotToRootPosition(item));
  const root = {
    x: numericInputValue('propPosX', curRoot.x),
    y: numericInputValue('propPosY', curRoot.y),
    z: numericInputValue('propPosZ', curRoot.z),
  };
  const curScale = threeScaleToUe4(item.group.scale);
  const scale = clampUeScale3D({
    x: numericInputValue('propScaleX', curScale.x),
    y: numericInputValue('propScaleY', curScale.y),
    z: numericInputValue('propScaleZ', curScale.z),
  });
  const cur = objectEulerDegrees(item);
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(numericInputValue('propRotP', cur.p)),
    THREE.MathUtils.degToRad(numericInputValue('propRotY', cur.y)),
    THREE.MathUtils.degToRad(numericInputValue('propRotR', cur.r)),
    'YXZ'
  );
  item.group.scale.copy(ue4ScaleToThree(scale));
  item.group.quaternion.setFromEuler(euler);
  item.group.position.copy(ue4PosToThree(root).add(transformedPivotOffset(item)));
  onTransformChange(); // writes the template + re-stamps
  renderList();
  commitHistory('Transform');
}

function applyTransformInputs() {
  if (selectedBase) applyBaseTransformInputs();
  else if (selected) applyObjectTransformInputs();
  else if (selectedCircle) applyCircleTransformInputs();
  else if (selectedGrid) applyGridTransformInputs();
}

function updatePropsPanel(item) {
  propsPanel?.updateObject(item);
}

// --- Object list sidebar ------------------------------------------------------

function updateCirclePropsPanel(tool) {
  propsPanel?.updateCircle(tool);
}

function updateGridPropsPanel(tool) {
  propsPanel?.updateGrid(tool);
}

let filterText = '';

function renderList() {
  renderObjectList({
    list: document.getElementById('objList'),
    countEl: document.getElementById('objCount'),
    filterText,
    items: ITEMS,
    circleTools: CIRCLE_TOOLS,
    gridTools: GRID_TOOLS,
    selectedItems,
    selectedCollection,
    collections: COLLECTIONS,
    selectedCircle,
    selectedGrid,
    selectedBase,
    getObjectMeta,
    getObjectIconUrl,
    getTemplates: getCircleTemplates,
    renderPlacementBudget,
    updateClipboardButtons,
    onSelectCollection: selectCollection,
    onDeleteCollection: deleteCollectionFromUi,
    onSelectCircle: selectCircleTool,
    onSelectGrid: selectGridTool,
    onSelectItem: selectItem,
    onFocusSelected: focusSelected,
    onRenderRequested: renderList,
    onAddToCollection: addToCollectionFromUi,
    onAddToCircle: (tool, idx) => addToToolFromUi(tool, 'circle', idx),
    onAddToGrid: (tool, idx) => addToToolFromUi(tool, 'grid', idx),
    onSelectBase: (tool, type, idx, opts) => selectBaseObject(tool, type, idx, opts),
    onRemoveBase: (tool, type, idx) => removeBaseObjectByIndex(tool, type, idx),
  });
}

function scrollListToSelected() {
  scrollListToActiveItem(document.getElementById('objList'));
}

// Update only the list's active highlight (cheap), for selection changes that don't alter list
// structure - avoids a full renderList DOM rebuild on every click/deselect.
function refreshListSelection() {
  applySelectionClasses(document.getElementById('objList'), {
    items: ITEMS, selectedItems, selectedCircle, selectedGrid, selectedCollection, selectedBase,
    circleTools: CIRCLE_TOOLS, gridTools: GRID_TOOLS,
  });
}

function deletePatternTool(tool, type) {
  if (!tool) return;
  for (const item of [...tool.items]) deleteItem(item, true);
  scene.remove(tool.group);
  disposeSceneObject(tool.group);
  const list = type === 'grid' ? GRID_TOOLS : CIRCLE_TOOLS;
  const idx = list.indexOf(tool);
  if (idx >= 0) list.splice(idx, 1);
  if (type === 'grid') {
    if (selectedGrid === tool) selectedGrid = null;
  } else {
    if (selectedCircle === tool) selectedCircle = null;
  }
}

function deleteCollectionFromUi(collection) {
  if (!collection) return;
  beginHistory('Delete Collection');
  const name = collection.name;
  deleteCollection(collection);
  deselectObject();
  renderList();
  updateDeviceLinkLines();
  commitHistory('Delete Collection');
  setStatus(`Deleted ${name}`);
}

function deleteSelected() {
  if (selectedBase) {
    removeBaseObject();
    return;
  }
  if (selectedCircle) {
    const id = selectedCircle.id;
    beginHistory('Delete Circle Tool');
    deletePatternTool(selectedCircle, 'circle');
    deselectObject();
    renderList();
    updateDeviceLinkLines();
    commitHistory('Delete Circle Tool');
    setStatus(`Deleted Circle Tool ${id}`);
    return;
  }
  if (selectedGrid) {
    const id = selectedGrid.id;
    beginHistory('Delete Grid Tool');
    deletePatternTool(selectedGrid, 'grid');
    deselectObject();
    renderList();
    updateDeviceLinkLines();
    commitHistory('Delete Grid Tool');
    setStatus(`Deleted Grid Tool ${id}`);
    return;
  }
  if (selectedCollection) {
    deleteCollectionFromUi(selectedCollection);
    return;
  }
  if (!selectedItems.size) return;
  const items = [...selectedItems];
  const name = items.length === 1 ? items[0].meta.name : `${items.length} objects`;
  beginHistory(items.length === 1 ? 'Delete Object' : 'Delete Objects');
  for (const item of items) deleteItem(item, true);
  deselectObject();
  renderList();
  updateDeviceLinkLines();
  commitHistory(items.length === 1 ? 'Delete Object' : 'Delete Objects');
  setStatus(`Deleted ${name}`);
}

function focusSelected() {
  if (graphActive) {
    const currentGraphItem = (selected?.ueObj && isDeviceObjectId(selected.ueObj.objectId) && selected.ueObj.deviceIndex !== -1)
      ? selected
      : [...selectedItems].find(it =>
        it?.ueObj && isDeviceObjectId(it.ueObj.objectId) && it.ueObj.deviceIndex !== -1
      );
    if (currentGraphItem) {
      if (graphActiveTab !== 'current') setGraphTab('current');
      logicGraph?.render();
      logicGraph?.setSelected(currentGraphItem);
      if (logicGraph?.focusNode(currentGraphItem)) return;
    }
    if (graphActiveTab === 'reference') {
      const id = referenceLogicFocusedItem
        ? referenceNodeId(referenceLogicFocusedItem)
        : [...referenceLogicSelectedIds][0];
      if (id && referenceLogicGraph?.focusNode(id)) return;
    }
    setStatus('Select a graph node first', true);
    return;
  }
  if (selectedCircle) {
    focusCircleTool(selectedCircle, { camera, orbitControls });
    return;
  }
  if (selectedGrid) {
    focusGridTool(selectedGrid, { camera, orbitControls });
    return;
  }
  focusSelectedItems({ selected, selectedItems }, { camera, orbitControls });
}

// --- 3D <-> Logic graph view switch -------------------------------------------
// The graph is a read-only overlay; the 3D render loop is paused while it's shown (it's occluded).
function setSceneView(mode) {
  graphActive = mode === 'graph';
  const graphEl = document.getElementById('sceneGraph');
  const canvas = document.getElementById('sceneCanvas');
  if (graphEl) graphEl.hidden = !graphActive;
  if (canvas) canvas.style.visibility = graphActive ? 'hidden' : '';
  // Hide the 3D viewport overlays (budget/settings, transform gizmo panel, HUD) - they don't apply
  // to and would sit on top of the graph. CSS does the hiding via this class.
  document.getElementById('viewport')?.classList.toggle('graph-mode', graphActive);
  document.getElementById('btnView3d')?.classList.toggle('active', !graphActive);
  document.getElementById('btnViewGraph')?.classList.toggle('active', graphActive);
  if (graphActive) {
    setGraphTab(graphActiveTab);
  }
}

// Rebuild the graph only when it's the visible view, so edits in 3D stay cheap.
function refreshGraphIfActive() {
  if (!graphActive) return;
  if (graphActiveTab === 'reference') referenceLogicGraph?.render();
  else logicGraph?.render();
}

// --- PUGC load / save ---------------------------------------------------------

let pugcJson = null;
let pugcName = null;
let pugcFileInfo = null;
let projectFiles = null;
let gameSettings = null;
let propsPanel = null;
let propsPanelReferenceMode = false;
let logicGraph = null;
let graphActive = false;
let graphActiveTab = 'current';
let referenceLogicGraph = null;
let referenceLogicJson = null;
let referenceLogicName = '';
let referenceLogicItems = [];
let referenceLogicFocusedItem = null;
const referenceLogicSelectedIds = new Set();

// --- Status bar ---------------------------------------------------------------

function setStatus(msg, isError = false) {
  const el = document.getElementById('sceneStatus');
  el.textContent = msg;
  el.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

// --- Mode buttons -------------------------------------------------------------

// Device scaling capability from the catalog (bUnScaleable / bUniformScaleOnly). Non-devices scale freely.
function itemScaleMode(item) {
  const dev = item && catalog.devices[String(item.ueObj.objectId)];
  if (!dev) return 'free';
  if (dev.unscaleable) return 'none';
  if (dev.uniformScaleOnly) return 'uniform';
  return 'free';
}
function selectionScaleMode() {
  let mode = 'free';
  const items = selectedItems.size ? selectedItems : (selected ? [selected] : []);
  for (const it of items) {
    const m = itemScaleMode(it);
    if (m === 'none') return 'none';
    if (m === 'uniform') mode = 'uniform';
  }
  return mode;
}

function setMode(mode) {
  if (mode === 'scale' && selectionScaleMode() === 'none') {
    setStatus("This device can't be scaled", true);
    return;
  }
  transformControls.setMode(mode);
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  const map = { translate: 'btnTranslate', rotate: 'btnRotate', scale: 'btnScale' };
  document.getElementById(map[mode])?.classList.add('active');
}

// Snap move/rotate to fixed increments. Move snap is entered in UE4 cm (gizmo space is metres, 1m=100cm);
// rotate snap is entered in degrees. Disabled -> null (free transform).
function applySnap() {
  const on = document.getElementById('snapToggle')?.checked;
  const cm = parseFloat(document.getElementById('snapMove')?.value);
  const deg = parseFloat(document.getElementById('snapRot')?.value);
  transformControls.setTranslationSnap(on && cm > 0 ? cm / 100 : null);
  transformControls.setRotationSnap(on && deg > 0 ? deg * Math.PI / 180 : null);
  transformControls.setScaleSnap(on && deg > 0 ? 0.1 : null);
}

function setToolTab(tab) {
  const isGrid = tab === 'grid';
  document.getElementById('toolTabCircle')?.classList.toggle('active', !isGrid);
  document.getElementById('toolTabGrid')?.classList.toggle('active', isGrid);
  document.getElementById('circleToolPanel')?.toggleAttribute('hidden', isGrid);
  document.getElementById('gridToolPanel')?.toggleAttribute('hidden', !isGrid);
  updateCirclePreview();
  updateGridPreview();
}

// --- Init ---------------------------------------------------------------------

async function main() {
  try {
    await loadCatalog();
    setNameTranslator((ns, key) => tr(ns, key, ''));
    setupLanguageSelect();
    initThree();
    history = createHistoryController({
      canRecord: () => Boolean(pugcJson),
      makeSnapshot: sceneSnapshot,
      restoreSnapshot: restoreSceneSnapshot,
      snapshotKey: sceneSnapshotKey,
      setStatus,
      limit: HISTORY_LIMIT,
    });
    gameSettings = createGameSettingsController({
      catalog,
      getPugcJson: () => pugcJson,
      getPugcFileInfo: () => pugcFileInfo,
      getEnums: () => localizedEnums(),
      translateText: tr,
      commitHistory,
      setStatus,
    });
    deviceLinks = createDeviceLinkController({
      scene,
      getConnections: getDeviceFieldConnections,
      getShowAiPaths: () => showAiPaths,
    });
    propsPanel = createPropsPanelController({
      getObjectMeta,
      getTemplates: getCircleTemplates,
      toolPlacementCount: circlePlacementCount,
      toolEulerDegrees: circleToolEulerDegrees,
      catalog,
      translateText: tr,
      getEnums: () => localizedEnums(),
      getPlacedDevices: (allowedObjectIds) => propsPanelReferenceMode
        ? referencePlacedDevices(allowedObjectIds)
        : getPlacedDevices(allowedObjectIds),
      getTagSuggestions: () => propsPanelReferenceMode
        ? referenceUsedDeviceTags()
        : usedDeviceTags(),
      getDeviceEventList() {
        if (propsPanelReferenceMode) {
          return referenceLogicJson && Array.isArray(referenceLogicJson.deviceEventList) ? referenceLogicJson.deviceEventList : [];
        }
        if (!pugcJson) return [];
        if (!Array.isArray(pugcJson.deviceEventList)) pugcJson.deviceEventList = [];
        return pugcJson.deviceEventList;
      },
      onWiringChange() {
        commitHistory('Edit Device Wiring'); // commitHistory refreshes the graph if it's active
      },
      onDeviceNameChange(ueObj) {
        renderList();
        commitHistory('Rename Device');
      },
      onDevicePropertyChange(ueObj) {
        commitHistory('Edit Device Properties');
        updateDeviceLinkLines();
        const it = ITEMS.find(i => i.ueObj === ueObj);
        if (it) {
          updateDeviceVolume(it); // reflect a new Block Area / Area Size immediately
          swapDeviceMeshIfNeeded(it); // switch the preview mesh if meshName/vehicle changed
        }
      },
    });
    logicGraph = createLogicGraph({
      container: document.getElementById('liveGraph'),
      getItems: () => ITEMS,
      getDeviceEventList: () => (pugcJson && Array.isArray(pugcJson.deviceEventList) ? pugcJson.deviceEventList : []),
      getFieldConnections: getDeviceFieldConnections,
      getObjectMeta,
      getObjectIconUrl,
      catalog,
      getSelectedNodeIds: selectedDeviceNodeIds,
      onSelectNode: (item, id, event) => {
        if (item) selectItem(item, { add: Boolean(event?.shiftKey || event?.ctrlKey || event?.metaKey), toggle: Boolean(event?.shiftKey || event?.ctrlKey || event?.metaKey) });
      }, // drives props panel + 3D selection
      onFocusNode: (item) => { if (item) { selectItem(item); setSceneView('3d'); focusSelected(); } },
      onClearSelection: () => { deselectObject(); refreshListSelection(); },
      onSelectGroup: selectCurrentGraphGroup,
      getItemTags: deviceTagsForItem,
    });
    referenceLogicGraph = createLogicGraph({
      container: document.getElementById('referenceGraph'),
      getItems: () => referenceLogicItems,
      getDeviceEventList: () => (referenceLogicJson && Array.isArray(referenceLogicJson.deviceEventList) ? referenceLogicJson.deviceEventList : []),
      getFieldConnections: () => getDeviceFieldConnectionsForItems(referenceLogicItems),
      getObjectMeta,
      getObjectIconUrl,
      catalog,
      getSelectedNodeIds: () => referenceLogicSelectedIds,
      onSelectNode: toggleReferenceLogicNode,
      onClearSelection: () => setReferenceLogicSelection([]),
      onSelectGroup: selectReferenceLogicGroup,
      getItemTags: deviceTagsForItem,
    });
    projectFiles = createProjectFileController({
      getPugcJson: () => pugcJson,
      setPugcJson: value => { pugcJson = value; },
      getPugcName: () => pugcName,
      setPugcName: value => { pugcName = value; },
      getPugcFileInfo: () => pugcFileInfo,
      setPugcFileInfo: value => { pugcFileInfo = value; },
      resetHistory: () => history?.reset(),
      getPugcObjects,
      buildScene,
      makeSnapshot: sceneSnapshot,
      restoreSnapshot: restoreSceneSnapshot,
      setStatus,
      makeNewProjectData: () => gameSettings.defaultRuleSections(),
      getSaveFormatDefaults: () => catalog.saveFormat,
      els: {
        projectName: document.getElementById('pugcName'),
        savePugc: document.getElementById('btnSave'),
        saveProject: document.getElementById('btnSaveProject'),
      },
    });
    populatePlacementCatalog();
    updatePlacementPreview();
    setPlacementCenterFromThree(orbitControls.target);
    updateCirclePreview();
    updateGridPreview();
    // Restore persisted viewer settings, then reflect them into the controls, before the first build.
    loadViewerSettings();
    document.getElementById('chkTextures').checked = loadTextures;
    document.getElementById('opacitySlider').value = nrmOpacity;
    document.getElementById('opacityValue').textContent = Math.round(nrmOpacity * 100) + '%';
    document.getElementById('skyboxBrightnessSlider').value = skyboxBrightness;
    updateSkyboxBrightnessLabel();
    applySkyboxBrightness();
    document.getElementById('chkAiPaths').checked = showAiPaths;
    document.getElementById('chkDeviceIcons').checked = showDeviceIcons;
    projectFiles.startDefaultProject();
    document.getElementById('placeObjectButton')?.addEventListener('click', e => {
      e.stopPropagation();
      const menu = document.getElementById('placeObjectMenu');
      if (!menu) return;
      const willOpen = menu.hasAttribute('hidden');
      menu.toggleAttribute('hidden', !willOpen);
      if (willOpen) {
        renderPlacementPicker();
        document.getElementById('placeObjectSearch')?.focus();
      }
    });
    document.getElementById('placeObjectSearch')?.addEventListener('input', renderPlacementPicker);
    document.getElementById('placeObjectMenu')?.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', e => {
      if (!e.target.closest?.('.place-picker')) document.getElementById('placeObjectMenu')?.setAttribute('hidden', '');
    });

    // File input
    document.getElementById('fileInput').addEventListener('change', e => {
      projectFiles.openSceneFile(e.target.files[0]);
      e.target.value = '';
    });
    document.getElementById('referenceFileInput')?.addEventListener('change', e => {
      loadReferenceLogicFile(e.target.files[0]);
      e.target.value = '';
    });
    document.getElementById('btnSelectAllReferenceLogic')?.addEventListener('click', selectAllReferenceLogic);
    document.getElementById('btnClearReferenceSelection')?.addEventListener('click', () => setReferenceLogicSelection([]));
    document.getElementById('btnCopyReferenceLogic')?.addEventListener('click', copyReferenceLogicSelection);
    document.getElementById('btnGraphCurrentTab')?.addEventListener('click', () => setGraphTab('current'));
    document.getElementById('btnGraphReferenceTab')?.addEventListener('click', () => setGraphTab('reference'));
    setGraphTab('current');

    // Drag-and-drop on viewport
    const vp = document.getElementById('viewport');
    vp.addEventListener('dragover', e => e.preventDefault());
    vp.addEventListener('drop', e => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      projectFiles.openSceneFile(f);
    });

    // Transform mode
    document.getElementById('btnTranslate').addEventListener('click', () => setMode('translate'));
    document.getElementById('btnRotate').addEventListener('click',    () => setMode('rotate'));
    document.getElementById('btnScale').addEventListener('click',     () => setMode('scale'));
    document.getElementById('snapToggle')?.addEventListener('change', applySnap);
    document.getElementById('snapMove')?.addEventListener('change', applySnap);
    document.getElementById('snapRot')?.addEventListener('change', applySnap);
    applySnap();

    document.getElementById('btnReleaseCircle')?.addEventListener('click', () => { if (selectedCircle) releaseToolObjects(selectedCircle, 'circle'); });
    document.getElementById('btnReleaseGrid')?.addEventListener('click', () => { if (selectedGrid) releaseToolObjects(selectedGrid, 'grid'); });

    const areaList = document.getElementById('areaToggleList');
    if (areaList) {
      for (const t of AREA_DEVICE_TYPES) {
        const label = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = viewerAreaVisible[t.id];
        cb.addEventListener('change', () => { viewerAreaVisible[t.id] = cb.checked; reconcileAreaVolumes(t.id); saveViewerSettings(); });
        label.append(cb, ` ${t.name}`);
        areaList.appendChild(label);
      }
    }
    document.getElementById('chkAiPaths')?.addEventListener('change', e => {
      showAiPaths = e.target.checked;
      deviceLinks?.setVisible(showAiPaths);
      saveViewerSettings();
    });
    document.getElementById('chkDeviceIcons')?.addEventListener('change', e => {
      showDeviceIcons = e.target.checked;
      applyDeviceIconVisibility();
      saveViewerSettings();
    });
    document.getElementById('btnView3d')?.addEventListener('click', () => setSceneView('3d'));
    document.getElementById('btnViewGraph')?.addEventListener('click', () => setSceneView('graph'));
    document.getElementById('btnFocus').addEventListener('click',     focusSelected);
    document.getElementById('btnCopy').addEventListener('click',      copySelectedObject);
    document.getElementById('btnPaste').addEventListener('click',     pasteCopiedObject);
    document.getElementById('btnDelete').addEventListener('click',    deleteSelected);
    document.getElementById('btnCreateCollection').addEventListener('click', createCollectionFromSelection);
    document.getElementById('btnCreateCircleTool')?.addEventListener('click', () => createToolFromSelection('circle'));
    document.getElementById('btnCreateGridTool')?.addEventListener('click', () => createToolFromSelection('grid'));
    document.getElementById('btnChainAiPath')?.addEventListener('click', chainSelectedAiPath);
    document.getElementById('btnSelectionTools')?.addEventListener('click', (e) => {
      selAlignActive = !selAlignActive;
      e.currentTarget.classList.toggle('active', selAlignActive);
      const sec = document.getElementById('selectionToolSection');
      if (sec) sec.hidden = !selAlignActive;
    });
    document.getElementById('btnDistX')?.addEventListener('click', () => distributeSelection('X'));
    document.getElementById('btnDistY')?.addEventListener('click', () => distributeSelection('Y'));
    document.getElementById('btnDistZ')?.addEventListener('click', () => distributeSelection('Z'));
    for (const [axis, edge] of [['X','Min'],['X','Center'],['X','Max'],['Y','Min'],['Y','Center'],['Y','Max'],['Z','Min'],['Z','Center'],['Z','Max']]) {
      document.getElementById(`btnAlign${axis}${edge}`)?.addEventListener('click', () => alignSelection(axis, edge.toLowerCase()));
    }
    document.getElementById('btnSaveProject').addEventListener('click', () => projectFiles.saveEditorProject());
    document.getElementById('btnSave').addEventListener('click',      () => projectFiles.savePugc());
    document.getElementById('btnGameSettings')?.addEventListener('click', () => gameSettings.openGameSettings());
    document.getElementById('gsClose')?.addEventListener('click', () => { document.getElementById('gameSettingsModal').hidden = true; });
    document.getElementById('gameSettingsModal')?.addEventListener('click', e => { if (e.target.id === 'gameSettingsModal') e.currentTarget.hidden = true; });
    // Out-of-range toggle — persist state across reloads via localStorage.
    const gsAllowOutOfRange = document.getElementById('gsAllowOutOfRange');
    if (gsAllowOutOfRange) {
      gsAllowOutOfRange.checked = localStorage.getItem('pugc_allow_oor') === '1';
      gsAllowOutOfRange.addEventListener('change', () => {
        const allow = gsAllowOutOfRange.checked;
        localStorage.setItem('pugc_allow_oor', allow ? '1' : '0');
        document.querySelectorAll('.devf-container').forEach(c => applyOutOfRangeMode(c, allow));
      });
    }
    const tipBtn = document.getElementById('btnTipJar');
    const tipPanel = document.getElementById('tipJarPanel');
    tipBtn?.addEventListener('click', e => { e.stopPropagation(); tipPanel.hidden = !tipPanel.hidden; });
    document.addEventListener('click', () => { if (tipPanel) tipPanel.hidden = true; });
    document.getElementById('btnHelp')?.addEventListener('click', () => { document.getElementById('helpModal').hidden = false; });
    document.getElementById('helpClose')?.addEventListener('click', () => { document.getElementById('helpModal').hidden = true; });
    document.getElementById('helpModal')?.addEventListener('click', e => { if (e.target.id === 'helpModal') e.currentTarget.hidden = true; });
    document.getElementById('btnPlaceOne').addEventListener('click',  placeOneObject);
    for (const id of [
      'circleDiameter', 'circleCount',
      'circleObjectPitch', 'circleRotOffsetManual', 'circleObjectRoll', 'circleRotationStep',
      'circleRadialStep', 'circleHeightStep',
      'circleScaleX', 'circleScaleY', 'circleScaleZ',
      'circleScaleStepX', 'circleScaleStepY', 'circleScaleStepZ',
      'circleScaleOffsets',
    ]) {
      document.getElementById(id)?.addEventListener('input', applyPlacementInputsToSelected);
      document.getElementById(id)?.addEventListener('change', applyPlacementInputsToSelected);
    }
    for (const id of [
      'gridColumns', 'gridRows', 'gridLayers', 'gridSpacingX', 'gridSpacingY', 'gridSpacingZ',
      'gridObjectPitch', 'gridObjectYaw', 'gridObjectRoll',
      'gridYawStep', 'gridHeightStep',
      'gridScaleX', 'gridScaleY', 'gridScaleZ',
    ]) {
      document.getElementById(id)?.addEventListener('input', applyGridInputsToSelected);
      document.getElementById(id)?.addEventListener('change', applyGridInputsToSelected);
    }
    for (const [sliderId, inputId] of [['circleDiameterSlider', 'circleDiameter'], ['circleCountSlider', 'circleCount']]) {
      bindSliderInputPair(sliderId, inputId, () => {
        const value = circleSliderToNumber(sliderId);
        return inputId === 'circleCount' ? String(Math.round(value)) : formatCircleNumber(value);
      }, applyPlacementInputsToSelected);
    }
    for (const [sliderId, inputId] of [
      ['circleObjectPitchSlider', 'circleObjectPitch'],
      ['circleRotOffsetSlider', 'circleRotOffsetManual'],
      ['circleObjectRollSlider', 'circleObjectRoll'],
      ['circleRotationStepSlider', 'circleRotationStep'],
      ['circleRadialStepSlider', 'circleRadialStep'],
      ['circleHeightStepSlider', 'circleHeightStep'],
      ['circleScaleXSlider', 'circleScaleX'],
      ['circleScaleYSlider', 'circleScaleY'],
      ['circleScaleZSlider', 'circleScaleZ'],
      ['circleScaleStepXSlider', 'circleScaleStepX'],
      ['circleScaleStepYSlider', 'circleScaleStepY'],
      ['circleScaleStepZSlider', 'circleScaleStepZ'],
    ]) {
      const precision = circleInputPrecision(inputId);
      bindSliderInputPair(sliderId, inputId, slider => formatCircleNumber(Number(slider.value), precision), applyPlacementInputsToSelected);
    }
    for (const [sliderId, inputId] of [
      ['gridColumnsSlider', 'gridColumns'],
      ['gridRowsSlider', 'gridRows'],
      ['gridLayersSlider', 'gridLayers'],
      ['gridSpacingXSlider', 'gridSpacingX'],
      ['gridSpacingYSlider', 'gridSpacingY'],
      ['gridSpacingZSlider', 'gridSpacingZ'],
      ['gridObjectPitchSlider', 'gridObjectPitch'],
      ['gridObjectYawSlider', 'gridObjectYaw'],
      ['gridObjectRollSlider', 'gridObjectRoll'],
      ['gridYawStepSlider', 'gridYawStep'],
      ['gridHeightStepSlider', 'gridHeightStep'],
      ['gridScaleXSlider', 'gridScaleX'],
      ['gridScaleYSlider', 'gridScaleY'],
      ['gridScaleZSlider', 'gridScaleZ'],
    ]) {
      const precision = circleInputPrecision(inputId);
      bindSliderInputPair(sliderId, inputId, (slider, input) =>
        input?.dataset.integer === 'true'
          ? String(Math.round(Number(slider.value)))
          : formatCircleNumber(Number(slider.value), precision),
        applyGridInputsToSelected);
    }
    for (const id of ['placeCenterX', 'placeCenterY', 'placeCenterZ']) {
      document.getElementById(id)?.addEventListener('input', applyPlacementInputsToSelected);
    }
    document.querySelectorAll('.numeric-input').forEach(bindNumericInput);
    document.querySelectorAll('.transform-input').forEach(input => {
      input.addEventListener('change', applyTransformInputs);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyTransformInputs();
          input.blur();
        }
      });
    });
    document.getElementById('placeObjectInput')?.addEventListener('input', () => {
      updatePlacementPreview();
      applyPlacementInputsToSelected();
    });
    document.getElementById('placeObjectInput')?.addEventListener('change', () => {
      updatePlacementPreview();
      applyPlacementInputsToSelected();
    });

    // Opacity slider
    document.getElementById('opacitySlider').addEventListener('input', e => {
      nrmOpacity = Number(e.target.value);
      document.getElementById('opacityValue').textContent = Math.round(nrmOpacity * 100) + '%';
      applyOpacityToAll();
      saveViewerSettings();
    });
    document.getElementById('skyboxBrightnessSlider')?.addEventListener('input', e => {
      skyboxBrightness = Math.max(0, Math.min(Number(e.target.value), 3));
      applySkyboxBrightness();
      saveViewerSettings();
    });


    // Fly speed reset on double-click
    document.getElementById('flySpeedDisplay').addEventListener('dblclick', () => {
      flySpeed = 1.0;
      updateSpeedHud();
    });

    // Texture toggle
    document.getElementById('chkTextures').addEventListener('change', e => {
      loadTextures = e.target.checked;
      if (loadTextures) clearTextureCache();
      applyTextureToggle();
      saveViewerSettings();
    });

    for (const id of ['precTransDecimals', 'precRotDecimals', 'precRoundMode', 'precRotFormat']) {
      document.getElementById(id)?.addEventListener('change', applyPrecisionTest);
    }
    const precSnapEl = document.getElementById('precRotSnap');
    precSnapEl?.addEventListener('change', applyPrecisionTest);
    precSnapEl?.addEventListener('input', applyPrecisionTest);

    // Filter
    document.getElementById('objFilter').addEventListener('input', e => {
      filterText = e.target.value;
      renderList();
    });

    // Keyboard shortcuts (skip when typing in inputs)
    window.addEventListener('keydown', e => {
      const typing = ['INPUT', 'TEXTAREA'].includes(e.target.tagName);
      if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoSceneEdit();
        else undoSceneEdit();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redoSceneEdit();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'c' && graphActive && graphActiveTab === 'reference') {
        if (window.getSelection()?.toString()) return; // let browser copy selected text
        e.preventDefault();
        if (referenceLogicSelectedIds.size) copyReferenceLogicSelection();
        else setStatus('Select reference graph nodes first', true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && (selected || selectedItems.size || selectedCircle || selectedGrid) && !typing) {
        if (window.getSelection()?.toString()) return; // let browser copy selected text
        e.preventDefault();
        copySelectedObject();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && copiedPayload && !typing) {
        e.preventDefault();
        pasteCopiedObject();
        return;
      }
      if (typing) return;
      const k = e.key.toLowerCase();
      if (['w','a','s','d','q','e','shift'].includes(k)) { flyKeys.add(k); return; }
      switch (k) {
        case 'r':      setMode('scale');     break;
        case 'f':      focusSelected();      break;
        case 'delete':
        case 'backspace': deleteSelected(); break;
        case 'escape': deselectObject(); renderList(); break;
      }
    });
    window.addEventListener('keyup', e => {
      flyKeys.delete(e.key.toLowerCase());
    });
    window.addEventListener('blur', clearFlyInput);
    window.addEventListener('pagehide', clearFlyInput);

    animate();
    loadBaseTerrain();
  } catch (err) {
    setStatus(`Startup error: ${err.message}`, true);
    console.error(err);
    trackEvent('app_error', { error_type: 'startup', message: err.message });
  }
}

main();
