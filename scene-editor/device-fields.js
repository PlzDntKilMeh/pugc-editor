import { validatorFor, enumOptions } from './field-utils.js';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function parseDeviceProps(ueObj) {
  if (!ueObj.devicePropertyData) return {};
  try { return JSON.parse(ueObj.devicePropertyData); } catch { return {}; }
}

function getPath(root, path) {
  const parts = path.split('.');
  let cur = root;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part.replace(/\[\]$/, '')];
  }
  return cur;
}

export function setPath(root, path, value) {
  const parts = path.split('.');
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!cur[key] || typeof cur[key] !== 'object') cur[key] = {};
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value;
}

// String fields with a ModStringValidator.stringDataTable are pick-lists, not free text. Options come
// from stringTables.json: [{ value: DataStr, label: DisplayText, rowName }].
// `value` is what the game stores in the pugc file (the full asset/sound path).
// Held at module scope because fieldHtml is only called from renderDeviceFields, which sets it.
let _stringTables = {};
function stringTableFor(field) {
  const t = field.validatorParam && field.validatorParam.stringDataTable;
  if (!t || t === 'None') return null;
  const rows = _stringTables[t];
  return Array.isArray(rows) && rows.length ? rows : null;
}

// Clamp a numeric value to an input's min/max attributes (which are set from the field validator).
// Skipped when the global allow-out-of-range toggle is on.
function clampToInput(value, el) {
  if (!Number.isFinite(value)) return 0;
  if (isOutOfRangeAllowed()) return value;
  if (el.min !== '' && value < Number(el.min)) value = Number(el.min);
  if (el.max !== '' && value > Number(el.max)) value = Number(el.max);
  return value;
}

// Returns true when the global out-of-range toggle is checked.
function isOutOfRangeAllowed() {
  return document.getElementById('gsAllowOutOfRange')?.checked ?? false;
}

// Strip or restore min/max attributes on all numeric inputs inside a container.
export function applyOutOfRangeMode(container, allow) {
  container.querySelectorAll('input[type="number"]').forEach(input => {
    if (allow) {
      if (input.hasAttribute('min')) { input.dataset.savedMin = input.min; input.removeAttribute('min'); }
      if (input.hasAttribute('max')) { input.dataset.savedMax = input.max; input.removeAttribute('max'); }
    } else {
      if (input.dataset.savedMin !== undefined) { input.setAttribute('min', input.dataset.savedMin); delete input.dataset.savedMin; }
      if (input.dataset.savedMax !== undefined) { input.setAttribute('max', input.dataset.savedMax); delete input.dataset.savedMax; }
    }
  });
}

// Item stackability: categories that are always non-stackable (count locked to 1).
// Misc is mixed - a per-itemId allow-list covers the stackable exceptions.
const NON_STACKABLE_CATEGORIES = new Set([
  'EModItemCategory::AR', 'EModItemCategory::Armor', 'EModItemCategory::Attachment',
  'EModItemCategory::Backpack', 'EModItemCategory::Crossbow', 'EModItemCategory::DMR',
  'EModItemCategory::Handgun', 'EModItemCategory::Helmet', 'EModItemCategory::LMG',
  'EModItemCategory::Launcher', 'EModItemCategory::Melee', 'EModItemCategory::Misc',
  'EModItemCategory::SMG', 'EModItemCategory::SR', 'EModItemCategory::Shotgun',
  'EModItemCategory::Wearable',
]);
const STACKABLE_MISC_IDS = new Set(['Item_Tiger_SelfRevive_C', 'Item_Neon_Coin_C']);
// Per-ID overrides: stackable-category items that must be locked to count=1.
const NON_STACKABLE_ITEM_IDS = new Set(['InstantRevivalKit_C']);

function itemStackable(itemId, items) {
  if (!itemId || itemId === 'None') return true;
  if (NON_STACKABLE_ITEM_IDS.has(itemId)) return false;
  if (STACKABLE_MISC_IDS.has(itemId)) return true;
  const entry = (items || []).find(i => i.itemId === itemId);
  return entry ? !NON_STACKABLE_CATEGORIES.has(entry.category) : true;
}

// Show or hide the count input for a row depending on whether the selected item is stackable.
function applyItemStackability(itemId, countEl, items) {
  if (!countEl || countEl.type === 'hidden') return;
  if (itemStackable(itemId, items)) {
    countEl.hidden = false;
  } else {
    countEl.value = 1;
    countEl.hidden = true;
  }
}

// Matches a description line against an option's *English* label (the pak schema always writes
// per-value tip lines in English, e.g. "None: Activates only when triggered by an event.").
// Sorted longest-first so more-specific labels match before shorter prefix labels.
function enumTipLineMatch(line, options) {
  const seen = new Set();
  const candidates = [];
  for (const o of (options || [])) {
    if (!o?.key) continue;
    for (const raw of [o.englishLabel, o.value]) {
      const label = String(raw || '').trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);
      candidates.push({ option: o, label });
    }
  }
  candidates.sort((a, b) => b.label.length - a.label.length);
  for (const { option, label } of candidates) {
    if (line.startsWith(label + ':')) return { option, text: line.slice(label.length + 1).trim() };
  }
  return null;
}

// Strips a leading "Label:" / "Label：" prefix (ASCII or full-width colon) from a tip line.
const TIP_PREFIX_RE = /^[^:：]{1,80}[:：]\s*/;

// Returns the description text for the currently-selected enum value. Per-value tip lines are
// located by matching field.englishDescription (always English, with literal "Label:" prefixes)
// against options' englishLabel; the matched line range is then re-read from field.description
// (which may be translated and use localized labels/punctuation that don't match directly) at the
// same line indices. Falls back to the English tip text if the translation reflowed the line count.
function selectedEnumHint(field, value, options) {
  const description = field?.description;
  const englishDescription = field?.englishDescription || description;
  if (!description || !Array.isArray(options) || !options.length) return '';
  const selected = options.find(o => String(o.value) === String(value ?? ''));
  if (!selected?.key) return '';
  const selectedValue = String(selected.value);

  // Some translations use U+FFFC (object replacement char) where a line break belongs - treat it
  // as one too, so the line count still lines up with the English description.
  const splitLines = s => String(s).replace(/\r\n/g, '\n').replace(/￼/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
  const enLines = splitLines(englishDescription);
  const trLines = splitLines(description);

  const marks = [];
  for (let i = 0; i < enLines.length; i++) {
    const match = enumTipLineMatch(enLines[i], options);
    if (match) marks.push({ value: String(match.option.value), idx: i });
  }
  const mi = marks.findIndex(m => m.value === selectedValue);
  if (mi === -1) return '';
  const start = marks[mi].idx;
  const end = mi + 1 < marks.length ? marks[mi + 1].idx : enLines.length;

  const lines = trLines.length === enLines.length ? trLines : enLines;
  return lines.slice(start, end).join('\n').replace(TIP_PREFIX_RE, '').trim();
}

function hintText(field, value, options) {
  if (!field?.description) return '';
  return field.type === 'Enum'
    ? (selectedEnumHint(field, value, options) || field.description)
    : field.description;
}

function hintHtml(field, value, options) {
  const text = hintText(field, value, options);
  return text ? `<div class="devf-hint">${esc(text)}</div>` : '';
}

function updateSelectHint(selectEl, field, options) {
  const hint = selectEl?.closest('.devf-field')?.querySelector(':scope > .devf-hint');
  if (!hint) return;
  hint.textContent = hintText(field, selectEl.value, options);
}

function itemOptions(field, items) {
  const v = validatorFor(field);
  const cats = Array.isArray(v.itemCategories) ? v.itemCategories : [];
  const rows = (items || [])
    .filter(item => !cats.length || cats.includes(String(item.category || '').replace('EModItemCategory::', '')))
    .map(item => {
      const id = item.itemId || 'None';
      return { value: id, label: id.replace(/^Item_/, '').replace(/_C$/, '').replace(/_/g, ' ') };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  rows.unshift({ value: 'None', label: 'None' });
  return rows;
}

function deviceOptions(field, getPlacedDevices) {
  if (!getPlacedDevices) return [];
  const v = validatorFor(field);
  const allowedIds = Array.isArray(v.availableDeviceObjectIdList) ? v.availableDeviceObjectIdList : [];
  return getPlacedDevices(allowedIds);
}

function deviceRefKey(value) {
  if (value != null && typeof value === 'object' && value.objectId != null && value.deviceIndex != null) {
    return `${value.objectId}:${value.deviceIndex}`;
  }
  return '';
}

function parseDeviceRefKey(key) {
  if (!key) return null;
  const [oidStr, didxStr] = key.split(':');
  const objectId = parseInt(oidStr);
  const deviceIndex = parseInt(didxStr);
  return (Number.isFinite(objectId) && Number.isFinite(deviceIndex)) ? { objectId, deviceIndex } : null;
}

// Returns a short muted range annotation for a field label, e.g. "0 – 100" or "max 20".
function validatorRangeNote(field) {
  const v = validatorFor(field);
  if (field.type === 'Int' || field.type === 'Float') {
    const hasMin = v.minValue !== undefined;
    const hasMax = v.maxValue !== undefined;
    if (hasMin && hasMax) return `${v.minValue} – ${v.maxValue}`;
    if (hasMin) return `≥ ${v.minValue}`;
    if (hasMax) return `≤ ${v.maxValue}`;
  }
  if (field.type === 'Vector') {
    const mn = v.minVector;
    const mx = v.maxVector;
    if (!mn && !mx) return '';
    const axes = ['x', 'y', 'z'];
    const mins = axes.map(a => (mn && mn[a] != null) ? Number(mn[a]) : null);
    const maxs = axes.map(a => (mx && mx[a] != null) ? Number(mx[a]) : null);
    const sameMin = mins.every(m => m === mins[0]);
    const sameMax = maxs.every(m => m === maxs[0]);
    if (sameMin && sameMax) {
      if (mins[0] != null && maxs[0] != null) return `${mins[0]} to ${maxs[0]}`;
      if (mins[0] != null) return `>= ${mins[0]}`;
      if (maxs[0] != null) return `<= ${maxs[0]}`;
    }
    return axes.map((a, i) => {
      if (mins[i] != null && maxs[i] != null) return `${a.toUpperCase()} ${mins[i]}-${maxs[i]}`;
      if (mins[i] != null) return `${a.toUpperCase()} >= ${mins[i]}`;
      if (maxs[i] != null) return `${a.toUpperCase()} <= ${maxs[i]}`;
      return null;
    }).filter(Boolean).join(' ');
  }
  if (field.type === 'String' && v.maxLen !== undefined) {
    return `max ${v.maxLen}`;
  }
  return '';
}

function labelWithRange(field) {
  const note = validatorRangeNote(field);
  if (!note) return esc(field.label);
  return `${esc(field.label)}<span class="devf-range">${esc(note)}</span>`;
}

function fieldGroupName(field) {
  const path = field.path || '';
  if (!path.includes('.')) return 'General';
  const key = path.split('.')[0];
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, c => c.toUpperCase())
    .trim();
}

// Renders a single child field inside a struct array item
function structItemFieldHtml(cf, value, enums, items, getPlacedDevices) {
  const fieldKey = cf.path.split('[].')[1];
  const hint = hintHtml(cf, value);

  if (cf.type === 'Bool') {
    return `<label class="devf-check"><input type="checkbox" data-devf-sa-key="${esc(fieldKey)}" data-devf-sa-type="bool"${value ? ' checked' : ''}><span>${esc(cf.label)}</span></label>${hint}`;
  }

  if (cf.type === 'Int' || cf.type === 'Float') {
    const v = validatorFor(cf);
    const step = cf.type === 'Float' ? 'any' : '1';
    const min = v.minValue !== undefined ? ` min="${esc(v.minValue)}"` : '';
    const max = v.maxValue !== undefined ? ` max="${esc(v.maxValue)}"` : '';
    return `<label class="devf-label">${labelWithRange(cf)}</label>` +
      `<input class="devf-input" type="number" step="${step}"${min}${max} data-devf-sa-key="${esc(fieldKey)}" data-devf-sa-type="number" value="${esc(value ?? '')}">` +
      hint;
  }

  if (cf.type === 'Device') {
    const placed = deviceOptions(cf, getPlacedDevices);
    const curKey = deviceRefKey(value);
    const optHtml = [
      `<option value=""${!curKey ? ' selected' : ''}>(None)</option>`,
      ...placed.map(p => { const k = `${p.objectId}:${p.deviceIndex}`; return `<option value="${esc(k)}"${k === curKey ? ' selected' : ''}>${esc(p.label)}</option>`; }),
    ].join('');
    return `<label class="devf-label">${esc(cf.label)}</label>` +
      `<select class="devf-select" data-devf-sa-key="${esc(fieldKey)}" data-devf-sa-type="device">${optHtml}</select>` +
      hint;
  }

  if (cf.type === 'Enum') {
    const opts = enumOptions(cf, enums);
    if (opts.length) {
      const hint = hintHtml(cf, value, opts);
      const optHtml = opts.map(o =>
        `<option value="${esc(o.value)}"${String(o.value) === String(value ?? '') ? ' selected' : ''}>${esc(o.label)}</option>`
      ).join('');
      return `<label class="devf-label">${esc(cf.label)}</label>` +
        `<select class="devf-select" data-devf-sa-key="${esc(fieldKey)}" data-devf-sa-type="string">${optHtml}</select>` +
        hint;
    }
    return `<label class="devf-label">${esc(cf.label)}</label>` +
      `<input class="devf-input" type="text" data-devf-sa-key="${esc(fieldKey)}" data-devf-sa-type="string" value="${esc(value ?? '')}">` +
      hint;
  }

  if (cf.type === 'Item') {
    const opts = itemOptions(cf, items);
    const cv = validatorFor(cf);
    const curId = value?.itemId ?? 'None';
    const maxCount = !itemStackable(curId, items) ? 1 : (cv.maxNum ?? 999);
    const minCount = cv.minNum ?? 1;
    const curCount = Math.min(maxCount, Math.max(minCount, value?.itemCount ?? 1));
    const optHtml = opts.map(o => `<option value="${esc(o.value)}"${o.value === curId ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
    const countInput = maxCount > 1
      ? `<input class="devf-input devf-count" type="number" min="${minCount}" max="${maxCount}" step="1" data-devf-sa-count value="${esc(curCount)}" title="Count">`
      : '';
    return `<label class="devf-label">${esc(cf.label)}</label>` +
      `<div class="devf-item-row">` +
        `<select class="devf-select" data-devf-sa-key="${esc(fieldKey)}" data-devf-sa-type="item">${optHtml}</select>` +
        countInput +
      `</div>` + hint;
  }

  return `<label class="devf-label">${esc(cf.label)}</label>` +
    `<input class="devf-input" type="text" data-devf-sa-key="${esc(fieldKey)}" data-devf-sa-type="string" value="${esc(value ?? '')}">` +
    hint;
}

function renderStructArrayItemHtml(idx, item, childFields, enums, items, getPlacedDevices) {
  const fieldsHtml = childFields.map(cf => {
    const key = cf.path.split('[].')[1];
    return `<div class="devf-field">${structItemFieldHtml(cf, item?.[key], enums, items, getPlacedDevices)}</div>`;
  }).join('');
  return `<div class="devf-sa-item">` +
    `<div class="devf-sa-header"><span class="devf-sa-num">${idx + 1}</span><button class="devf-sa-remove" type="button" title="Remove">x</button></div>` +
    fieldsHtml +
    `</div>`;
}

function structArrayHtml(field, arr, childFields, enums, items, getPlacedDevices, maxNum) {
  const path = field.path;
  const hint = field.description ? `<div class="devf-hint">${esc(field.description)}</div>` : '';
  const itemsHtml = arr.map((item, idx) =>
    renderStructArrayItemHtml(idx, item, childFields, enums, items, getPlacedDevices)
  ).join('');
  return `<label class="devf-label">${esc(field.label)}</label>${hint}` +
    `<div class="devf-sa" data-devf-path="${esc(path)}" data-devf-type="struct-array" data-devf-max="${maxNum}">` +
      `<div class="devf-sa-list">${itemsHtml}</div>` +
      `<button class="devf-sa-add button compact" type="button"${arr.length >= maxNum ? ' disabled' : ''}>+ Add</button>` +
    `</div>`;
}

// A list of plain items ({itemId,itemCount}) - e.g. Player Event eventItemList, Air Drop items,
// Item Spawn modItemList, weapon attachmentIDs - rendered as item-picker rows instead of raw JSON.
function itemArrayRowHtml(idx, it, opts, maxCount = 999, minCount = 1, items = []) {
  const curId = it?.itemId ?? 'None';
  const effectiveMax = (curId && curId !== 'None') ? (!itemStackable(curId, items) ? 1 : maxCount) : maxCount;
  const curCount = Math.min(effectiveMax, Math.max(minCount, it?.itemCount ?? 1));
  const optHtml = opts.map(o => `<option value="${esc(o.value)}"${o.value === curId ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
  const countPart = effectiveMax > 1
    ? `<input class="devf-input devf-count" type="number" min="${minCount}" max="${maxCount}" step="1" data-ia-role="count" value="${esc(curCount)}" title="Count">`
    : `<input type="hidden" data-ia-role="count" value="1">`;
  return `<div class="devf-sa-item devf-item-arr-row">` +
    `<span class="devf-sa-num">${idx + 1}</span>` +
    `<select class="devf-select" data-ia-role="item">${optHtml}</select>` +
    countPart +
    `<button class="devf-sa-remove" type="button" title="Remove">x</button>` +
  `</div>`;
}

function itemArrayHtml(field, arr, elemField, items) {
  const v = validatorFor(field);
  const maxNum = v.maxNum ?? 999;
  const ev = validatorFor(elemField);
  const maxCount = ev.maxNum ?? 999;
  const minCount = ev.minNum ?? 1;
  const opts = itemOptions(elemField, items);
  const hint = field.description ? `<div class="devf-hint">${esc(field.description)}</div>` : '';
  const rows = arr.map((it, i) => itemArrayRowHtml(i, it, opts, maxCount, minCount, items)).join('');
  return `<label class="devf-label">${esc(field.label)}</label>${hint}` +
    `<div class="devf-sa" data-devf-path="${esc(field.path)}" data-devf-type="item-array" data-devf-max="${maxNum}" data-devf-max-count="${maxCount}" data-devf-min-count="${minCount}">` +
      `<div class="devf-sa-list">${rows}</div>` +
      `<button class="devf-sa-add button compact" type="button"${arr.length >= maxNum ? ' disabled' : ''}>+ Add item</button>` +
    `</div>`;
}

// Array of plain enum values (e.g. RestrictedWeaponSlotTypes, AllowDamageTypes): a checkbox per
// option, since it's a set chosen from a fixed enum. Value is the array of checked enum values.
function enumArrayHtml(field, arr, elemField, enums) {
  const v = validatorFor(field);
  const maxNum = v.maxNum ?? 999;
  const opts = enumOptions(elemField, enums);
  const selected = new Set((Array.isArray(arr) ? arr : []).map(String));
  const hint = field.description ? `<div class="devf-hint">${esc(field.description)}</div>` : '';
  const box = (val, label, checked) =>
    `<label class="devf-check"><input type="checkbox" data-ea-val="${esc(val)}"${checked ? ' checked' : ''}><span>${esc(label)}</span></label>`;
  const boxes = opts.map(o => box(o.value, o.label, selected.has(String(o.value)))).join('');
  // Preserve any stored value not in the current option set so editing doesn't silently drop it.
  const unknown = [...selected].filter(s => !opts.some(o => String(o.value) === s));
  const unknownBoxes = unknown.map(s => box(s, s + ' (unknown)', true)).join('');
  return `<label class="devf-label">${esc(field.label)}</label>${hint}` +
    `<div class="devf-enum-arr" data-devf-path="${esc(field.path)}" data-devf-type="enum-array" data-devf-max="${maxNum}">${boxes}${unknownBoxes}</div>`;
}

// Reorderable list of Device-reference slots (e.g. checkpointList).
// Each row: number | device dropdown (like billboard) | up | down | remove.
function deviceArrayRowHtml(idx, value, elemField, getPlacedDevices) {
  const placed = deviceOptions(elemField, getPlacedDevices);
  const curKey = deviceRefKey(value);
  const noneLabel = placed.length ? '(None)' : '(No matching devices in scene)';
  const optHtml = [
    `<option value=""${!curKey ? ' selected' : ''}>${esc(noneLabel)}</option>`,
    ...placed.map(p => { const k = `${p.objectId}:${p.deviceIndex}`; return `<option value="${esc(k)}"${k === curKey ? ' selected' : ''}>${esc(p.label)}</option>`; }),
  ].join('');
  return `<div class="devf-sa-item devf-device-arr-row">` +
    `<span class="devf-sa-num">${idx + 1}</span>` +
    `<select class="devf-select" data-da-role="device">${optHtml}</select>` +
    `<button class="devf-sa-up" type="button" title="Move up">&uarr;</button>` +
    `<button class="devf-sa-down" type="button" title="Move down">&darr;</button>` +
    `<button class="devf-sa-remove" type="button" title="Remove">x</button>` +
  `</div>`;
}

function deviceArrayHtml(field, arr, elemField, getPlacedDevices) {
  const v = validatorFor(field);
  const maxNum = v.maxNum ?? 999;
  const hint = field.description ? `<div class="devf-hint">${esc(field.description)}</div>` : '';
  const rows = arr.map((val, i) => deviceArrayRowHtml(i, val, elemField, getPlacedDevices)).join('');
  return `<label class="devf-label">${esc(field.label)}</label>${hint}` +
    `<div class="devf-sa" data-devf-path="${esc(field.path)}" data-devf-type="device-array" data-devf-max="${maxNum}">` +
      `<div class="devf-sa-list">${rows}</div>` +
      `<button class="devf-sa-add button compact" type="button"${arr.length >= maxNum ? ' disabled' : ''}>+ Add</button>` +
    `</div>`;
}

function bindStructArray(saEl, childFields, enums, items, getPlacedDevices, onChange) {
  const path = saEl.dataset.devfPath;
  const maxNum = parseInt(saEl.dataset.devfMax) || 999;

  function getArrayValue() {
    const result = [];
    saEl.querySelectorAll('.devf-sa-item').forEach(itemEl => {
      const item = {};
      itemEl.querySelectorAll('[data-devf-sa-key]').forEach(input => {
        const key = input.dataset.devfSaKey;
        const type = input.dataset.devfSaType;
        if (type === 'bool') item[key] = input.checked;
        else if (type === 'number') item[key] = clampToInput(input.value === '' ? 0 : Number(input.value), input);
        else if (type === 'device') item[key] = parseDeviceRefKey(input.value);
        else if (type === 'item') {
          const countEl = input.parentElement?.querySelector('[data-devf-sa-count]');
          const rawCount = parseInt(countEl?.value) || 1;
          const count = countEl ? clampToInput(rawCount, countEl) : rawCount;
          item[key] = { itemId: input.value, itemCount: count };
        } else item[key] = input.value;
      });
      result.push(item);
    });
    return result;
  }

  function updateAddButton() {
    const addBtn = saEl.querySelector('.devf-sa-add');
    if (addBtn) addBtn.disabled = saEl.querySelectorAll('.devf-sa-item').length >= maxNum;
  }

  function renumberItems() {
    saEl.querySelectorAll('.devf-sa-num').forEach((numEl, idx) => {
      numEl.textContent = idx + 1;
    });
  }

  function bindItemEvents(itemEl) {
    // Apply stackability for the initially selected item in this row.
    itemEl.querySelectorAll('[data-devf-sa-type="item"]').forEach(sel => {
      applyItemStackability(sel.value, sel.parentElement?.querySelector('[data-devf-sa-count]'), items);
    });
    itemEl.querySelector('.devf-sa-remove')?.addEventListener('click', () => {
      itemEl.remove();
      renumberItems();
      updateAddButton();
      onChange(path, getArrayValue());
    });
    itemEl.querySelectorAll('[data-devf-sa-key], [data-devf-sa-count]').forEach(input => {
      input.addEventListener('change', () => {
        const fieldKey = input.dataset.devfSaKey;
        const field = fieldKey ? childFields.find(cf => cf.path.endsWith('[].' + fieldKey)) : null;
        if (field?.type === 'Enum' && input.tagName === 'SELECT') {
          updateSelectHint(input, field, enumOptions(field, enums));
        }
        if (input.dataset.devfSaType === 'number') {
          const n = clampToInput(input.value === '' ? 0 : Number(input.value), input);
          if (String(n) !== input.value) input.value = n;
        }
        if (input.dataset.devfSaType === 'item') {
          applyItemStackability(input.value, input.parentElement?.querySelector('[data-devf-sa-count]'), items);
        }
        onChange(path, getArrayValue());
      });
    });
  }

  saEl.querySelectorAll('.devf-sa-item').forEach(bindItemEvents);

  saEl.querySelector('.devf-sa-add')?.addEventListener('click', () => {
    const listEl = saEl.querySelector('.devf-sa-list');
    const idx = saEl.querySelectorAll('.devf-sa-item').length;
    if (idx >= maxNum) return;
    const temp = document.createElement('div');
    temp.innerHTML = renderStructArrayItemHtml(idx, {}, childFields, enums, items, getPlacedDevices);
    const newItem = temp.firstElementChild;
    listEl.appendChild(newItem);
    bindItemEvents(newItem);
    updateAddButton();
    onChange(path, getArrayValue());
  });
}

function isTagField(field) {
  const leaf = String(field?.path || '').split('.').pop().toLowerCase();
  return field?.type === 'String' && (leaf === 'tag' || leaf.endsWith('tag') || leaf.includes('playertag'));
}

function fieldHtml(field, value, enums, items, getPlacedDevices, allFields, getTagSuggestions) {
  const path = field.path;
  const id = 'df-' + path.replace(/[^a-z0-9]+/gi, '-');
  const hint = hintHtml(field, value);

  if (field.type === 'Bool') {
    return `<label class="devf-check"><input type="checkbox" id="${id}" data-devf-path="${esc(path)}" data-devf-type="bool"${value ? ' checked' : ''}><span>${esc(field.label)}</span></label>${hint}`;
  }

  if (field.type === 'Int' || field.type === 'Float') {
    const v = validatorFor(field);
    const step = field.type === 'Float' ? 'any' : '1';
    const min = v.minValue !== undefined ? ` min="${esc(v.minValue)}"` : '';
    const max = v.maxValue !== undefined ? ` max="${esc(v.maxValue)}"` : '';
    return `<label class="devf-label" for="${id}">${labelWithRange(field)}</label>` +
      `<input class="devf-input" type="number" id="${id}" data-devf-path="${esc(path)}" data-devf-type="number" step="${step}"${min}${max} value="${esc(value ?? '')}">` +
      hint;
  }

  if (field.type === 'Enum') {
    const opts = enumOptions(field, enums);
    if (opts.length) {
      const hint = hintHtml(field, value, opts);
      const optHtml = opts.map(o =>
        `<option value="${esc(o.value)}"${String(o.value) === String(value ?? '') ? ' selected' : ''}>${esc(o.label)}</option>`
      ).join('');
      return `<label class="devf-label" for="${id}">${esc(field.label)}</label>` +
        `<select class="devf-select" id="${id}" data-devf-path="${esc(path)}" data-devf-type="string">${optHtml}</select>` +
        hint;
    }
    return `<label class="devf-label" for="${id}">${esc(field.label)}</label>` +
      `<input class="devf-input" type="text" id="${id}" data-devf-path="${esc(path)}" data-devf-type="string" value="${esc(value ?? '')}">` +
      hint;
  }

  if (field.type === 'String') {
    // DataTable-backed pick-list (mesh name, vehicle, BGM, ...). The stored field value is the asset
    // path (DataStr) - that is what the game writes and what the viewport loads - so the option value
    // is the asset path and the label is the friendly DisplayText.
    const table = stringTableFor(field);
    if (table) {
      const allowEmpty = field.validatorParam?.bAllowEmpty;
      const cur = String(value ?? '');
      // value is DataStr (asset path). o.asset is a backward-compat alias from the old format.
      const storedVal = (o) => o.value ?? o.asset ?? '';
      const matchRow = table.find(o => String(storedVal(o)) === cur);
      const optHtml = [
        allowEmpty ? `<option value=""${cur === '' ? ' selected' : ''}>(None)</option>` : '',
        // Preserve an unrecognized saved value so editing the device doesn't silently drop it.
        (!matchRow && cur !== '') ? `<option value="${esc(cur)}" selected>${esc(cur)} (unknown)</option>` : '',
        ...table.map(o => `<option value="${esc(storedVal(o))}"${o === matchRow ? ' selected' : ''}>${esc(o.label)}</option>`),
      ].join('');
      return `<label class="devf-label" for="${id}">${esc(field.label)}</label>` +
        `<select class="devf-select" id="${id}" data-devf-path="${esc(path)}" data-devf-type="string">${optHtml}</select>` +
        hint;
    }
    if (isTagField(field)) {
      const suggestions = [...new Set((getTagSuggestions?.() || [])
        .map(v => String(v || '').trim())
        .filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
      const opts = suggestions.length
        ? suggestions.map(tag => `<button type="button" data-devf-tag-option="${esc(tag)}">${esc(tag)}</button>`).join('')
        : '<div class="devf-tag-empty">No tags used yet</div>';
      return `<label class="devf-label" for="${id}">${labelWithRange(field)}</label>` +
        `<div class="devf-tag-combo" data-devf-tag-combo>` +
          `<input class="devf-input" type="text" id="${id}" data-devf-path="${esc(path)}" data-devf-type="string" value="${esc(value ?? '')}" placeholder="Choose or type a new tag" autocomplete="off">` +
          `<button class="devf-tag-toggle" type="button" data-devf-tag-toggle title="Show used tags">v</button>` +
          `<div class="devf-tag-menu" data-devf-tag-menu hidden>${opts}</div>` +
        `</div>` +
        hint;
    }
    return `<label class="devf-label" for="${id}">${labelWithRange(field)}</label>` +
      `<input class="devf-input" type="text" id="${id}" data-devf-path="${esc(path)}" data-devf-type="string" value="${esc(value ?? '')}">` +
      hint;
  }

  if (field.type === 'Device') {
    const placed = deviceOptions(field, getPlacedDevices);
    const curKey = deviceRefKey(value);
    const noneLabel = placed.length ? '(None)' : '(No matching devices in scene)';
    const optHtml = [
      `<option value=""${!curKey ? ' selected' : ''}>${esc(noneLabel)}</option>`,
      ...placed.map(p => { const k = `${p.objectId}:${p.deviceIndex}`; return `<option value="${esc(k)}"${k === curKey ? ' selected' : ''}>${esc(p.label)}</option>`; }),
    ].join('');
    return `<label class="devf-label" for="${id}">${esc(field.label)}</label>` +
      `<select class="devf-select" id="${id}" data-devf-path="${esc(path)}" data-devf-type="device">${optHtml}</select>` +
      hint;
  }

  if (field.type === 'Item') {
    const opts = itemOptions(field, items);
    const fv = validatorFor(field);
    const curId = value?.itemId ?? 'None';
    const maxCount = !itemStackable(curId) ? 1 : (fv.maxNum ?? 999);
    const minCount = fv.minNum ?? 1;
    const curCount = Math.min(maxCount, Math.max(minCount, value?.itemCount ?? 1));
    const optHtml = opts.map(o =>
      `<option value="${esc(o.value)}"${o.value === curId ? ' selected' : ''}>${esc(o.label)}</option>`
    ).join('');
    const countInput = maxCount > 1
      ? `<input class="devf-input devf-count" type="number" min="${minCount}" max="${maxCount}" step="1" data-devf-path="${esc(path)}" data-devf-type="item-count" data-devf-item-id="${esc(curId)}" value="${esc(curCount)}" title="Count">`
      : '';
    return `<label class="devf-label" for="${id}">${esc(field.label)}</label>` +
      `<div class="devf-item-row">` +
        `<select class="devf-select" id="${id}" data-devf-path="${esc(path)}" data-devf-type="item" data-devf-count="${esc(curCount)}">${optHtml}</select>` +
        countInput +
      `</div>` +
      hint;
  }

  if (field.type === 'Vector') {
    const vec = (value && typeof value === 'object') ? value : { x: 0, y: 0, z: 0 };
    const vv = validatorFor(field);
    const bound = (ax) => {
      const mn = vv.minVector && vv.minVector[ax] !== undefined ? ` min="${esc(vv.minVector[ax])}"` : '';
      const mx = vv.maxVector && vv.maxVector[ax] !== undefined ? ` max="${esc(vv.maxVector[ax])}"` : '';
      return mn + mx;
    };
    return `<label class="devf-label">${labelWithRange(field)}</label>` +
      `<div class="devf-vec" data-devf-path="${esc(path)}" data-devf-type="vector">` +
        `<label>X<input type="number" step="any" data-devf-axis="x"${bound('x')} value="${esc(vec.x ?? 0)}"></label>` +
        `<label>Y<input type="number" step="any" data-devf-axis="y"${bound('y')} value="${esc(vec.y ?? 0)}"></label>` +
        `<label>Z<input type="number" step="any" data-devf-axis="z"${bound('z')} value="${esc(vec.z ?? 0)}"></label>` +
      `</div>` +
      hint;
  }

  if (field.type === 'Array' || field.path.endsWith('[]') || Array.isArray(value)) {
    // Array of plain items (element field path is `${path}[]` of type Item) -> item-picker list.
    const elemField = (allFields || []).find(cf => cf.path === path + '[]');
    if (elemField && elemField.type === 'Item') {
      return itemArrayHtml(field, Array.isArray(value) ? value : [], elemField, items);
    }
    if (elemField && elemField.type === 'Enum') {
      return enumArrayHtml(field, Array.isArray(value) ? value : [], elemField, enums);
    }
    if (elemField && elemField.type === 'Device') {
      return deviceArrayHtml(field, Array.isArray(value) ? value : [], elemField, getPlacedDevices);
    }
    const childFields = (allFields || []).filter(cf => cf.path.startsWith(path + '[].') && cf.type !== 'Object');
    if (childFields.length) {
      const arr = Array.isArray(value) ? value : [];
      const v = validatorFor(field);
      const maxNum = v.maxNum ?? 999;
      return structArrayHtml(field, arr, childFields, enums, items, getPlacedDevices, maxNum);
    }
    return `<label class="devf-label" for="${id}">${esc(field.label)}</label>` +
      `<textarea class="devf-textarea" id="${id}" data-devf-path="${esc(path)}" data-devf-type="json">${esc(JSON.stringify(value ?? [], null, 2))}</textarea>` +
      hint;
  }

  return `<label class="devf-label" for="${id}">${esc(field.label)}</label>` +
    `<input class="devf-input" type="text" id="${id}" data-devf-path="${esc(path)}" data-devf-type="string" value="${esc(value ?? '')}">` +
    hint;
}

// Conditional field visibility rules: leaf field name -> { ctrl, when, def }.
// Each rule hides a field unless the sibling `ctrl` field's value is in `when`.
// Derived from sample data (no EditCondition exists in the schema).
// Exported so props-panel can drive re-renders when a controlling field changes.
const SHOW_WHEN = {
  teamId:                        { ctrl: 'targetType',            when: ['SelectedParty', 'SelectedPlayer'], def: 'AllPlayers' },
  squadMemberId:                 { ctrl: 'targetType',            when: ['SelectedPlayer'],                  def: 'AllPlayers' },
  targetPlayerTag:               { ctrl: 'targetType',            when: ['HasTagPlayer'],                    def: 'AllPlayers' },
  specificRound:                 { ctrl: 'roundConditionScope',   when: ['SpecificRound'],                   def: '' },
  delayedRoundStartEventSecond:  { ctrl: 'roundEventCondition',   when: ['AfterRoundStartDelay'],            def: '' },
};

// Set of field leaf names whose change requires re-rendering the whole field list.
// Includes the SHOW_WHEN controllers plus volumeShape/shape (gate which size fields are shown).
export const RERENDER_ON_CHANGE = new Set([
  ...Object.values(SHOW_WHEN).map(r => r.ctrl),
  'volumeShape',
  'shape',
  'tag',
  'targetPlayerTag',
]);

// advancedMode: 'basic' = non-advanced fields, 'advanced' = bIsAdvancedDisplay fields, 'all' = both.
export function renderDeviceFields(container, ueObj, devCatalog, enums, items, onChange, { advancedMode = 'all', getPlacedDevices = null, stringTables = null, getTagSuggestions = null } = {}) {
  if (stringTables) _stringTables = stringTables;
  const props = parseDeviceProps(ueObj);
  const allFields = devCatalog?.fields || [];
  // Only show the size field for the currently-selected volume shape (hide the other shapes' sizes).
  const SHAPE_SIZE_PATHS = ['boxExtent', 'cubeExtent', 'sphereRadius'];
  const shapeField = allFields.find(f => f.path === 'volumeShape');
  const shapeSizeField = shapeField
    ? ({ box: 'boxExtent', cube: 'cubeExtent', sphere: 'sphereRadius' })[
        String(getPath(props, 'volumeShape') || shapeField.validatorParam?.selectEnums?.[0] || 'Box').toLowerCase()
      ]
    : null;
  // CheckpointDevice uses ECheckpointShape (Square/Circle) to gate which size fields are visible.
  // Square shows width+height; Circle shows radius.
  const CHECKPOINT_SIZE_PATHS = ['radius', 'width', 'height'];
  const checkpointShapeField = allFields.find(f => f.path === 'shape' && f.unrealType === 'ECheckpointShape');
  const checkpointShownPaths = checkpointShapeField
    ? (String(getPath(props, 'shape') || 'Square') === 'Square' ? ['width', 'height'] : ['radius'])
    : null;
  // Returns true if this field should be rendered hidden (in stable position) rather than omitted.
  const hiddenByCondition = (f) => {
    const leaf = f.path.split('.').pop();
    const rule = SHOW_WHEN[leaf];
    if (rule) {
      const ctrlPath = f.path.slice(0, f.path.length - leaf.length) + rule.ctrl;
      if (allFields.some(af => af.path === ctrlPath)) {
        const val = String(getPath(props, ctrlPath) || rule.def);
        if (!rule.when.includes(val)) return true;
      }
    }
    if (shapeField && SHAPE_SIZE_PATHS.includes(f.path) && f.path !== shapeSizeField) return true;
    if (checkpointShapeField && CHECKPOINT_SIZE_PATHS.includes(f.path) && !checkpointShownPaths.includes(f.path)) return true;
    return false;
  };
  const isDependentField = (f) => {
    const leaf = f.path.split('.').pop();
    return !!(SHOW_WHEN[leaf] || (shapeField && SHAPE_SIZE_PATHS.includes(f.path)) || (checkpointShapeField && CHECKPOINT_SIZE_PATHS.includes(f.path)));
  };

  const fields = allFields.filter(f => {
    if (f.type === 'Object') return false;
    if (f.path.includes('[].')) return false;
    if (f.path.endsWith('[]')) return false; // array element schema - rendered by its parent array field
    if (f.hidden) return false;
    if (advancedMode === 'basic' && f.advanced) return false;
    if (advancedMode === 'advanced' && !f.advanced) return false;
    return true;
  });

  if (!fields.length) {
    container.innerHTML = '<div class="devf-empty">No properties</div>';
    return;
  }

  const grouped = new Map();
  for (const f of fields) {
    const g = fieldGroupName(f);
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g).push(f);
  }
  // Anchor every dependent field immediately after its controller so toggling visibility
  // never shifts unrelated fields above the controller.
  const anchorDependents = (arr) => {
    const deps = new Map(); // ctrlPath -> [depPath, ...]
    for (const f of arr) {
      const leaf = f.path.split('.').pop();
      const rule = SHOW_WHEN[leaf];
      if (rule) {
        const ctrlPath = f.path.slice(0, f.path.length - leaf.length) + rule.ctrl;
        if (!deps.has(ctrlPath)) deps.set(ctrlPath, []);
        deps.get(ctrlPath).push(f.path);
      }
      if (SHAPE_SIZE_PATHS.includes(f.path)) {
        if (!deps.has('volumeShape')) deps.set('volumeShape', []);
        deps.get('volumeShape').push(f.path);
      }
      if (checkpointShapeField && CHECKPOINT_SIZE_PATHS.includes(f.path)) {
        if (!deps.has('shape')) deps.set('shape', []);
        deps.get('shape').push(f.path);
      }
    }
    for (const [ctrlPath, depPaths] of deps) {
      if (!arr.some(f => f.path === ctrlPath)) continue;
      const depFields = depPaths.map(dp => {
        const idx = arr.findIndex(f => f.path === dp);
        return idx >= 0 ? arr.splice(idx, 1)[0] : null;
      }).filter(Boolean);
      arr.splice(arr.findIndex(f => f.path === ctrlPath) + 1, 0, ...depFields);
    }
  };
  for (const arr of grouped.values()) anchorDependents(arr);
  const groups = [...grouped.entries()].sort(([a], [b]) => {
    if (a === 'General') return -1;
    if (b === 'General') return 1;
    return a.localeCompare(b);
  });

  let html = '';
  for (const [groupName, groupFields] of groups) {
    const showTitle = groupName !== 'General' || groups.length > 1;
    html += `<div class="devf-group">`;
    if (showTitle) html += `<div class="devf-group-title">${esc(groupName)}</div>`;
    for (const f of groupFields) {
      const dep = isDependentField(f);
      const hidden = hiddenByCondition(f);
      html += `<div class="devf-field${dep ? ' devf-field--dep' : ''}"${hidden ? ' hidden' : ''}>${fieldHtml(f, getPath(props, f.path), enums, items, getPlacedDevices, allFields, getTagSuggestions)}</div>`;
    }
    html += `</div>`;
  }
  container.innerHTML = html;

  container.querySelectorAll('[data-devf-path]:not([data-devf-type="vector"]):not([data-devf-type="struct-array"]):not([data-devf-type="item-array"]):not([data-devf-type="enum-array"]):not([data-devf-type="device-array"])').forEach(el => {
    const path = el.dataset.devfPath;
    const type = el.dataset.devfType;
    const field = allFields.find(f => f.path === path);
    el.addEventListener('change', () => {
      let value;
      if (type === 'bool') {
        value = el.checked;
      } else if (type === 'number') {
        value = el.value === '' ? 0 : Number(el.value);
        value = clampToInput(value, el); // enforce validator min/max
        if (String(value) !== el.value) el.value = value;
      } else if (type === 'json') {
        try { value = JSON.parse(el.value); } catch { return; }
      } else if (type === 'device') {
        value = parseDeviceRefKey(el.value);
      } else if (type === 'item') {
        const count = parseInt(el.dataset.devfCount) || 1;
        value = { itemId: el.value, itemCount: count };
        el.dataset.devfCount = count;
        const countInput = el.parentElement?.querySelector('[data-devf-type="item-count"]');
        if (countInput) countInput.dataset.devfItemId = el.value;
      } else if (type === 'item-count') {
        const itemId = el.dataset.devfItemId || 'None';
        const count = parseInt(el.value) || 1;
        value = { itemId, itemCount: count };
        const itemSelect = el.parentElement?.querySelector('[data-devf-type="item"]');
        if (itemSelect) itemSelect.dataset.devfCount = count;
      } else {
        value = el.value;
      }
      if (field?.type === 'Enum' && el.tagName === 'SELECT') {
        updateSelectHint(el, field, enumOptions(field, enums));
      }
      onChange(path, value);
    });
  });

  container.querySelectorAll('[data-devf-tag-combo]').forEach(combo => {
    const input = combo.querySelector('input[data-devf-path]');
    const menu = combo.querySelector('[data-devf-tag-menu]');
    const toggle = combo.querySelector('[data-devf-tag-toggle]');
    if (!input || !menu || !toggle) return;
    let closeController = null;
    const open = () => {
      if (input.disabled) return;
      menu.hidden = false;
      closeController?.abort();
      closeController = new AbortController();
      document.addEventListener('pointerdown', e => {
        if (!combo.contains(e.target)) close();
      }, { signal: closeController.signal });
    };
    const close = () => {
      menu.hidden = true;
      closeController?.abort();
      closeController = null;
    };
    input.addEventListener('focus', open);
    input.addEventListener('pointerdown', () => {
      if (document.activeElement === input) open();
    });
    toggle.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      if (menu.hidden) {
        input.focus();
        open();
      } else {
        close();
      }
    });
    menu.querySelectorAll('[data-devf-tag-option]').forEach(option => {
      option.addEventListener('click', e => {
        e.preventDefault();
        input.value = option.dataset.devfTagOption || '';
        input.dispatchEvent(new Event('change', { bubbles: true }));
        close();
      });
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') close();
    });
  });

  container.querySelectorAll('[data-devf-type="vector"]').forEach(vecEl => {
    const path = vecEl.dataset.devfPath;
    const getVec = () => {
      const vec = {};
      vecEl.querySelectorAll('[data-devf-axis]').forEach(ax => {
        const v = clampToInput(ax.value === '' ? 0 : Number(ax.value), ax);
        if (String(v) !== ax.value) ax.value = v;
        vec[ax.dataset.devfAxis] = v;
      });
      return vec;
    };
    vecEl.querySelectorAll('[data-devf-axis]').forEach(ax => {
      ax.addEventListener('change', () => onChange(path, getVec()));
    });
  });

  container.querySelectorAll('[data-devf-type="struct-array"]').forEach(saEl => {
    const saPath = saEl.dataset.devfPath;
    const childFields = allFields.filter(cf => cf.path.startsWith(saPath + '[].') && cf.type !== 'Object');
    bindStructArray(saEl, childFields, enums, items, getPlacedDevices, onChange);
  });

  container.querySelectorAll('[data-devf-type="item-array"]').forEach(iaEl => {
    const iaPath = iaEl.dataset.devfPath;
    const maxNum = parseInt(iaEl.dataset.devfMax) || 999;
    const maxCount = parseInt(iaEl.dataset.devfMaxCount) || 999;
    const minCount = parseInt(iaEl.dataset.devfMinCount) || 1;
    const opts = itemOptions(allFields.find(cf => cf.path === iaPath + '[]') || {}, items);
    const getVal = () => {
      const out = [];
      iaEl.querySelectorAll('.devf-sa-item').forEach(row => {
        const countEl = row.querySelector('[data-ia-role="count"]');
        const rawCount = parseInt(countEl?.value) || 1;
        const count = Math.min(maxCount, Math.max(minCount, rawCount));
        if (countEl && countEl.type !== 'hidden' && count !== rawCount) countEl.value = count;
        out.push({
          itemId: row.querySelector('[data-ia-role="item"]')?.value || 'None',
          itemCount: count,
        });
      });
      return out;
    };
    const renumber = () => iaEl.querySelectorAll('.devf-sa-num').forEach((n, i) => { n.textContent = i + 1; });
    const updateAdd = () => { const b = iaEl.querySelector('.devf-sa-add'); if (b) b.disabled = iaEl.querySelectorAll('.devf-sa-item').length >= maxNum; };
    const bindRow = (row) => {
      // Apply stackability for the initially selected item in this row.
      const itemSel = row.querySelector('[data-ia-role="item"]');
      applyItemStackability(itemSel?.value, row.querySelector('[data-ia-role="count"]'), items);
      row.querySelector('.devf-sa-remove')?.addEventListener('click', () => { row.remove(); renumber(); updateAdd(); onChange(iaPath, getVal()); });
      row.querySelectorAll('[data-ia-role]').forEach(inp => inp.addEventListener('change', () => {
        if (inp === itemSel) applyItemStackability(itemSel.value, row.querySelector('[data-ia-role="count"]'), items);
        onChange(iaPath, getVal());
      }));
    };
    iaEl.querySelectorAll('.devf-sa-item').forEach(bindRow);
    iaEl.querySelector('.devf-sa-add')?.addEventListener('click', () => {
      const idx = iaEl.querySelectorAll('.devf-sa-item').length;
      if (idx >= maxNum) return;
      const temp = document.createElement('div');
      temp.innerHTML = itemArrayRowHtml(idx, {}, opts, maxCount, minCount, items);
      const row = temp.firstElementChild;
      iaEl.querySelector('.devf-sa-list').appendChild(row);
      bindRow(row);
      updateAdd();
      onChange(iaPath, getVal());
    });
  });

  // Enum-value arrays: a checkbox per option; value is the array of checked enum values.
  container.querySelectorAll('[data-devf-type="enum-array"]').forEach(eaEl => {
    const eaPath = eaEl.dataset.devfPath;
    const maxNum = parseInt(eaEl.dataset.devfMax) || 999;
    const boxes = [...eaEl.querySelectorAll('input[type="checkbox"]')];
    const getVal = () => boxes.filter(c => c.checked).map(c => c.dataset.eaVal);
    const enforceMax = () => { const atMax = getVal().length >= maxNum; boxes.forEach(c => { c.disabled = atMax && !c.checked; }); };
    boxes.forEach(c => c.addEventListener('change', () => { enforceMax(); onChange(eaPath, getVal()); }));
    enforceMax();
  });

  // Reorderable device-reference arrays (e.g. checkpointList).
  // Each row: number | device dropdown | up | down | remove.
  container.querySelectorAll('[data-devf-type="device-array"]').forEach(daEl => {
    const daPath = daEl.dataset.devfPath;
    const maxNum = parseInt(daEl.dataset.devfMax) || 999;
    const elemField = allFields.find(cf => cf.path === daPath + '[]');
    const listEl = daEl.querySelector('.devf-sa-list');

    const placed = deviceOptions(elemField, getPlacedDevices);

    const getVal = () => {
      const out = [];
      listEl.querySelectorAll('.devf-sa-item').forEach(row => {
        out.push(parseDeviceRefKey(row.querySelector('[data-da-role="device"]')?.value || ''));
      });
      return out;
    };

    const renumber = () => listEl.querySelectorAll('.devf-sa-num').forEach((n, i) => { n.textContent = i + 1; });
    const updateAdd = () => { const b = daEl.querySelector('.devf-sa-add'); if (b) b.disabled = listEl.querySelectorAll('.devf-sa-item').length >= maxNum; };

    // Rebuild each row's <select> to exclude devices already chosen in other rows.
    const refreshAllSelects = () => {
      const rows = [...listEl.querySelectorAll('.devf-sa-item')];
      rows.forEach(r => {
        const sel = r.querySelector('[data-da-role="device"]');
        if (!sel) return;
        const own = sel.value;
        const used = new Set(rows.filter(o => o !== r).map(o => o.querySelector('[data-da-role="device"]')?.value || '').filter(Boolean));
        const noneLabel = placed.length ? '(None)' : '(No matching devices in scene)';
        sel.innerHTML = [
          `<option value=""${!own ? ' selected' : ''}>${esc(noneLabel)}</option>`,
          ...placed
            .filter(p => { const k = `${p.objectId}:${p.deviceIndex}`; return !used.has(k) || k === own; })
            .map(p => { const k = `${p.objectId}:${p.deviceIndex}`; return `<option value="${esc(k)}"${k === own ? ' selected' : ''}>${esc(p.label)}</option>`; }),
        ].join('');
      });
    };

    const bindRow = (row) => {
      row.querySelector('[data-da-role="device"]')?.addEventListener('change', () => {
        refreshAllSelects();
        onChange(daPath, getVal());
      });
      row.querySelector('.devf-sa-remove')?.addEventListener('click', () => {
        row.remove(); renumber(); updateAdd(); refreshAllSelects(); onChange(daPath, getVal());
      });
      row.querySelector('.devf-sa-up')?.addEventListener('click', () => {
        const prev = row.previousElementSibling;
        if (prev) { listEl.insertBefore(row, prev); renumber(); onChange(daPath, getVal()); }
      });
      row.querySelector('.devf-sa-down')?.addEventListener('click', () => {
        const next = row.nextElementSibling;
        if (next) { listEl.insertBefore(row, next.nextElementSibling); renumber(); onChange(daPath, getVal()); }
      });
    };

    listEl.querySelectorAll('.devf-sa-item').forEach(bindRow);
    refreshAllSelects();

    daEl.querySelector('.devf-sa-add')?.addEventListener('click', () => {
      const idx = listEl.querySelectorAll('.devf-sa-item').length;
      if (idx >= maxNum) return;
      const temp = document.createElement('div');
      temp.innerHTML = deviceArrayRowHtml(idx, null, elemField, getPlacedDevices);
      const row = temp.firstElementChild;
      listEl.appendChild(row);
      bindRow(row);
      refreshAllSelects();
      updateAdd();
      onChange(daPath, getVal());
    });
  });
}
