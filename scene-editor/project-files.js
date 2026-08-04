import {
  createEditorSession,
  parseEditorSession,
} from './session-format.js';
import { getPugcObjectsFromJson } from './pugc-objects.js';
import { getPugcCodec } from './codec/pugc-codec.js';
import { trackEvent } from './analytics.js';

const DEFAULT_PUGC_NAME = 'Untitled.pugc';
// The .pugc wrapper format version - effectively invariant (see PUGC_V2_HEADER in the codec), so unlike
// buildVersion it's safe to default without a catalog: there's nothing to go stale.
const SAVE_FORMAT_DATA_VERSION = 1;

// The game's save format carries top-level name/dataVersion/buildVersion/editFileData fields that the editor
// never had a reason to populate for a scene built from scratch. Without them the game silently rejects the file.
// buildVersion has no invariant fallback - it changes every PUBG patch, so guessing a stale value here would
// just reproduce the original bug more quietly. If data/catalog/saveFormat.json (from pak-server's
// CatalogExtractor.BuildSaveFormatDefaults()) hasn't loaded, `warn` is called instead of faking a value.
function ensurePugcSaveMetadata(pugcJson, saveFormatDefaults, warn) {
  const now = Math.floor(Date.now() / 1000);
  const accountId = String(pugcJson.creatorData?.ownerAccountId || '').trim();
  const defaults = saveFormatDefaults && typeof saveFormatDefaults === 'object' ? saveFormatDefaults : {};

  if (typeof pugcJson.name !== 'string') pugcJson.name = '';
  if (typeof pugcJson.dataVersion !== 'number') pugcJson.dataVersion = SAVE_FORMAT_DATA_VERSION;
  if (!pugcJson.buildVersion) {
    if (defaults.buildVersion) {
      pugcJson.buildVersion = defaults.buildVersion;
    } else {
      warn?.('buildVersion missing from saveFormat catalog - run a fresh pak-server dump; this .pugc may not load in-game.');
    }
  }

  const efd = pugcJson.editFileData || (pugcJson.editFileData = {
    createAccountId: accountId,
    createTime: now,
    lastModifierAccountId: accountId,
    lastModifiedTime: now,
    editPlayers: [],
    lastHostPlayerData: null,
  });
  efd.lastModifierAccountId = accountId || efd.lastModifierAccountId || '';
  efd.lastModifiedTime = now;
  if (accountId) {
    efd.editPlayers ||= [];
    let entry = efd.editPlayers.find(p => p.accountId === accountId);
    if (!entry) {
      entry = { accountId, editData: { editCount: 0, editTime: 0 } };
      efd.editPlayers.push(entry);
    }
    entry.editData.editCount = (entry.editData.editCount || 0) + 1;
    efd.lastHostPlayerData = { accountId, editData: { ...entry.editData } };
  }
  return pugcJson;
}

function formatSaveTimestamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function bestSaveName(pugcName, pugcJson) {
  const base = String(pugcName || '').replace(/\.(pugc|json|pugcedit)$/i, '').trim();
  if (base && base.toLowerCase() !== 'untitled') return pugcName;
  const creatorName = String(pugcJson?.creatorData?.name || '').trim();
  return creatorName || pugcName || DEFAULT_PUGC_NAME;
}

function timestampedSaveName(sourceName, extension) {
  const base = String(sourceName || 'Untitled')
    .replace(/\.(pugc|json|pugcedit)$/i, '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .trim() || 'Untitled';
  return `${base}_${formatSaveTimestamp()}${extension}`;
}

function downloadBlob(blob, downloadName) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: downloadName });
  a.click();
  URL.revokeObjectURL(url);
}

async function saveBlob(blob, suggestedName, pickerOptions = {}) {
  if (typeof window.showSaveFilePicker === 'function') {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      ...pickerOptions,
    });
    const writable = await handle.createWritable();
    try {
      await writable.write(blob);
    } finally {
      await writable.close();
    }
    return handle.name || suggestedName;
  }
  downloadBlob(blob, suggestedName);
  return suggestedName;
}

// Saves a blob and reports the result via setStatus, swallowing user-cancelled
// (AbortError) save-picker dismissals. Returns the saved name, or null if the
// save did not complete.
async function saveBlobWithStatus(blob, suggestedName, pickerOptions, setStatus, errorType) {
  try {
    const savedName = await saveBlob(blob, suggestedName, pickerOptions);
    setStatus(`Saved ${savedName}`);
    return savedName;
  } catch (err) {
    if (err?.name !== 'AbortError') {
      setStatus(`Save error: ${err.message}`, true);
      trackEvent('app_error', { error_type: errorType, message: err.message });
    }
    return null;
  }
}

export function createProjectFileController({
  getPugcJson,
  setPugcJson,
  getPugcName,
  setPugcName,
  getPugcFileInfo,
  setPugcFileInfo,
  resetHistory,
  getPugcObjects,
  buildScene,
  makeSnapshot,
  restoreSnapshot,
  setStatus,
  makeNewProjectData,
  getSaveFormatDefaults,
  els,
}) {
  function enableSaves() {
    if (els.savePugc) els.savePugc.disabled = false;
    if (els.saveProject) els.saveProject.disabled = false;
  }

  function setProjectLabel(text) {
    if (els.projectName) els.projectName.textContent = text;
  }

  return {
    startDefaultProject() {
      setPugcJson({ objects: [], ...(makeNewProjectData?.() || {}) });
      setPugcName(DEFAULT_PUGC_NAME);
      setPugcFileInfo?.({
        source: 'Blank project',
        hasHeader: false,
        format: 'New PUGC export',
        headerLength: 0,
        headerHex: '',
        magic: '',
        version: null,
        marker: '',
        saveHeader: true,
      });
      resetHistory();
      setProjectLabel('Untitled blank project');
      enableSaves();
      buildScene(getPugcObjects() || []);
      setStatus('Blank project ready');
    },

    async loadEditorProjectFile(file) {
      setStatus(`Opening ${file.name}...`);
      try {
        const session = parseEditorSession(await file.text());
        setPugcName(session.metadata?.pugcName || DEFAULT_PUGC_NAME);
        setPugcFileInfo?.(session.metadata?.pugcFileInfo || {
          source: 'Editor project',
          hasHeader: null,
          format: 'Editor project',
          saveHeader: true,
        });
        resetHistory();
        restoreSnapshot(session.snapshot);
        setProjectLabel(`${file.name} (editor project)`);
        enableSaves();
        setStatus(`Opened ${file.name}`);
        trackEvent('project_open', { method: 'pugcedit' });
      } catch (err) {
        setStatus(`Project open error: ${err.message}`, true);
        console.error(err);
        trackEvent('app_error', { error_type: 'load_pugcedit', message: err.message });
      }
    },

    async loadPugcFile(file) {
      setStatus(`Decoding ${file.name}...`);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const codec = await getPugcCodec();
        const { json, name, fileInfo } = await codec.decode(bytes, file.name);
        const objects = getPugcObjectsFromJson(json);
        if (!Array.isArray(objects)) throw new Error('No objects[] array found in decoded PUGC');

        setPugcJson(json);
        setPugcName(name);
        setPugcFileInfo?.({ source: file.name, ...(fileInfo || {}), saveHeader: true });
        resetHistory();
        setProjectLabel(file.name);
        enableSaves();
        buildScene(objects);
        trackEvent('project_open', { method: 'pugc' });
      } catch (err) {
        setStatus(`Error: ${err.message}`, true);
        console.error(err);
        trackEvent('app_error', { error_type: 'load_pugc', message: err.message });
      }
    },

    openSceneFile(file) {
      if (!file) return;
      if (/\.pugcedit$/i.test(file.name)) {
        this.loadEditorProjectFile(file);
      } else if (/\.pugc$/i.test(file.name)) {
        this.loadPugcFile(file);
      } else {
        setStatus('Open a .pugc or .pugcedit file', true);
      }
    },

    async saveEditorProject() {
      const snapshot = makeSnapshot();
      if (!snapshot) return;
      const pugcName = bestSaveName(getPugcName(), getPugcJson());
      const session = createEditorSession(snapshot, { pugcName, pugcFileInfo: getPugcFileInfo?.() || null });
      const downloadName = timestampedSaveName(pugcName, '.pugcedit');
      const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
      const savedName = await saveBlobWithStatus(blob, downloadName, {
        types: [{ description: 'PUGC Editor Project', accept: { 'application/json': ['.pugcedit'] } }],
      }, setStatus, 'save_pugcedit');
      if (savedName) trackEvent('project_save', { format: 'pugcedit'});
    },

    async savePugc() {
      const pugcJson = getPugcJson();
      const pugcName = bestSaveName(getPugcName(), pugcJson);
      if (!pugcJson || !pugcName) return;
      ensurePugcSaveMetadata(pugcJson, getSaveFormatDefaults?.(), message => {
        console.warn(`[savePugc] ${message}`);
        trackEvent('app_error', { error_type: 'save_pugc_missing_build_version', message });
      });
      setStatus('Repacking...');
      try {
        const codec = await getPugcCodec();
        const bytes = await codec.encode(pugcJson, pugcName);

        const downloadName = timestampedSaveName(pugcName, '.pugc');
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        const savedName = await saveBlobWithStatus(blob, downloadName, {
          types: [{ description: 'PUGC File', accept: { 'application/octet-stream': ['.pugc'] } }],
        }, setStatus, 'save_pugc');
        if (savedName) {
          setPugcFileInfo?.({
            source: savedName,
            hasHeader: true,
            format: 'PUGC v2 wrapper',
            headerLength: 13,
            headerHex: '2E 70 75 67 63 01 00 00 00 99 76 E5 CD',
            magic: '.pugc',
            version: 1,
            marker: '99 76 E5 CD',
            saveHeader: true,
          });
          trackEvent('project_export', { format: 'pugc', object_count: (getPugcObjects() || []).length });
        }
      } catch (err) {
        setStatus(`Save error: ${err.message}`, true);
        trackEvent('app_error', { error_type: 'save_pugc_encode', message: err.message });
      }
    },
  };
}
