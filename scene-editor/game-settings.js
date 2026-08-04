// --- Project / game settings (creator, round/game rules) - schema from rules.json ----------------
const RULE_SECTION_TITLES = {
  creatorData: 'Creator', roundRuleData: 'Round Rules', gameRuleData: 'Game Rules',
  characterRuleData: 'Character Rules', userSelectableData: 'User Selectable',
};

function gsEsc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function gsLabel(k) { return k.replace(/^b([A-Z])/, '$1').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase()); }
// Maps UE4 schema Type strings to the gs render type used in data-gs-type / input logic.
function gsNormalizeType(field) {
  const t = String(field.type || '');
  if (t === 'Bool') return 'bool';
  if (t === 'Enum') return 'enum';
  if (t === 'Array') return 'array';
  // Int/Float passed through; change handler and input branch both check for them.
  return t || 'string';
}
// Returns a short range annotation string for a game-settings field, e.g. "1 - 100" or ">= 1".
function gsRangeNote(field) {
  const vp = field.validatorParam || {};
  const mn = vp.minValue ?? vp.minNum ?? null;
  const mx = vp.maxValue ?? vp.maxNum ?? null;
  if (mn != null && mx != null) return `${mn} - ${mx}`;
  if (mn != null) return `>= ${mn}`;
  if (mx != null) return `<= ${mx}`;
  return '';
}
// Returns [{key, field}] for a section value - handles both new (array) and legacy (object) formats.
function gsSectionFields(sectionValue) {
  if (Array.isArray(sectionValue))
    return sectionValue.filter(f => f && f.path).map(f => ({ key: f.path, field: f }));
  if (sectionValue && typeof sectionValue === 'object')
    return Object.entries(sectionValue).map(([key, def]) => ({ key, field: def }));
  return [];
}

// --- Game Settings tag pickers (driven by tags.json / tagCategories.json) ---
const MAIN_TAG_CATEGORY = 'MainTag';
const bySortOrder = (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.label).localeCompare(String(b.label));

export function createGameSettingsController({ catalog, getPugcJson, getPugcFileInfo, getEnums, translateText, commitHistory, setStatus }) {
  function gsEnumOptions(name) {
    const rows = getEnums()[name];
    return Array.isArray(rows) ? rows.map(r => ({ value: r.value, label: r.label || r.value })) : [];
  }
  // New array-format: field has unrealType (for enum class lookup) or legacy enum string.
  function gsEnumOptionsForField(field) {
    return gsEnumOptions(field.unrealType || field.enum || '');
  }

  function mainTagList() { return catalog.tags.filter(t => t.categoryId === MAIN_TAG_CATEGORY).sort(bySortOrder); }
  function tagsInCategory(catId) { return catalog.tags.filter(t => t.categoryId === catId).sort(bySortOrder); }
  function currentMainTagId() {
    return getPugcJson()?.creatorData?.mainTagId ?? 'MainTag_None';
  }
  function subCategoriesForMain(mainTagId) {
    return catalog.tagCategories.filter(c => c.id !== MAIN_TAG_CATEGORY
      && Array.isArray(c.availableForMainTagIds) && c.availableForMainTagIds.includes(mainTagId));
  }
  // Drop selected sub-tags whose category isn't available for the given main tag.
  function validSubTagIds(mainTagId, selected) {
    const allowed = new Set(subCategoriesForMain(mainTagId).map(c => c.id));
    const byId = new Map(catalog.tags.map(t => [t.id, t]));
    return (Array.isArray(selected) ? selected : []).filter(id => allowed.has(byId.get(id)?.categoryId));
  }

  function tagLabel(t) { return translateText('NS_UGC_TAG', t.displayKey, t.label || t.id); }

  function renderMainTagRow(sec, key, cur) {
    const options = mainTagList().map(t =>
      `<option value="${gsEsc(t.id)}"${t.id === cur ? ' selected' : ''}>${gsEsc(tagLabel(t))}</option>`).join('');
    return `<label class="gs-row"><span>${gsEsc(gsLabel(key))}</span>` +
      `<select data-gs-sec="${sec}" data-gs-key="${key}" data-gs-type="string" data-gs-maintag="1">${options}</select></label>`;
  }

  function renderSubTagSection(mainTagId, selected) {
    const cats = subCategoriesForMain(mainTagId);
    if (!cats.length) return '';
    const sel = new Set(Array.isArray(selected) ? selected : []);
    let html = '<div class="gs-row gs-row-block"><span>Sub Tags</span><div class="gs-tag-groups">';
    for (const cat of cats) {
      const tags = tagsInCategory(cat.id);
      if (!tags.length) continue;
      const limit = Number(cat.maxSelectCount) || 0;
      const note = limit > 0 ? ` <span class="gs-tag-limit">(max ${limit})</span>` : '';
      const catLabel = translateText('NS_UGC_TAG', cat.displayKey, cat.label || cat.id);
      html += `<div class="gs-tag-group"><div class="gs-tag-group-title">${gsEsc(catLabel)}${note}</div>`;
      for (const t of tags) {
        html += `<label class="gs-tag-option"><input type="checkbox" data-gs-subtag="${gsEsc(t.id)}"` +
          ` data-gs-cat="${gsEsc(cat.id)}" data-gs-max="${limit}"${sel.has(t.id) ? ' checked' : ''}>` +
          `<span>${gsEsc(tagLabel(t))}</span></label>`;
      }
      html += '</div>';
    }
    return html + '</div></div>';
  }

  function toggleSubTag(tagId, catId, maxSelect, checked) {
    const pugcJson = getPugcJson();
    const cur = Array.isArray(pugcJson.creatorData?.subTagIds) ? [...pugcJson.creatorData.subTagIds] : [];
    let next = cur;
    if (checked) {
      if (maxSelect > 0) {
        const inCat = tagsInCategory(catId).map(t => t.id).filter(id => cur.includes(id));
        // Make room within this category's limit (drop the oldest selections), then add.
        const drop = new Set(inCat.slice(0, Math.max(0, inCat.length - (maxSelect - 1))));
        next = cur.filter(id => !drop.has(id));
      }
      if (!next.includes(tagId)) next.push(tagId);
    } else {
      next = cur.filter(id => id !== tagId);
    }
    (pugcJson.creatorData ??= {}).subTagIds = next;
    commitHistory('Edit Game Settings');
    renderGameSettings();
  }

  // userSelectableData.modUserSelectPlayType is stored as "<GROUP>_<VALUE>" (e.g. SHOOTING_OCCUPATION) or
  // "NONE" - i.e. the enum rowName minus the EModUserSelectPlayType_ prefix. Offer it as one dropdown built
  // from the NONE / SHOOTING / NONSHOOTING enums, labels localized via NS_UGC_ENUM.
  function playTypeOptions() {
    const out = [];
    const seen = new Set();
    const push = (enumName) => (catalog.enums?.[enumName] || []).forEach(e => {
      const value = (e.rowName || '').replace(/^EModUserSelectPlayType_/, '') || e.value;
      if (!value || seen.has(value)) return;
      seen.add(value);
      out.push({ value, label: translateText('NS_UGC_ENUM', e.key, e.label || value) });
    });
    push('EModUserSelectPlayType');
    push('EModUserSelectPlayType_SHOOTING');
    push('EModUserSelectPlayType_NONSHOOTING');
    return out;
  }
  function renderPlayTypeRow(sec, key, cur) {
    const opts = playTypeOptions().map(o =>
      `<option value="${gsEsc(o.value)}"${String(o.value) === String(cur) ? ' selected' : ''}>${gsEsc(o.label)}</option>`).join('');
    return `<label class="gs-row"><span>Play Type</span>` +
      `<select data-gs-sec="${sec}" data-gs-key="${key}" data-gs-type="string">${opts}</select></label>`;
  }

  function renderFileHeaderSection() {
    const info = getPugcFileInfo?.() || {};
    const status = info.hasHeader === true
      ? 'New header present'
      : info.hasHeader === false
        ? 'Legacy/no header loaded'
        : 'No .pugc header loaded';
    const rows = [
      ['Loaded file', info.source || 'Untitled blank project'],
      ['Loaded header', status],
      ['Save header', info.saveHeader === false ? 'No' : 'Yes, writes 13-byte v2 header'],
    ];
    if (info.magic) rows.push(['Magic', info.magic]);
    if (info.version != null) rows.push(['Version', String(info.version)]);
    if (info.marker) rows.push(['Marker', info.marker]);
    if (info.headerHex) rows.push(['Header bytes', info.headerHex]);
    return '<div class="gs-section gs-file-header"><div class="gs-section-title">File Header</div>' +
      rows.map(([label, value]) =>
        `<div class="gs-info-row"><span>${gsEsc(label)}</span><code>${gsEsc(value)}</code></div>`).join('') +
      '</div>';
  }

  function renderGameSettings() {
    const pugcJson = getPugcJson();
    const body = document.getElementById('gsBody');
    let html = '';
    for (const [sec, sectionValue] of Object.entries(catalog.rules || {})) {
      const entries = gsSectionFields(sectionValue);
      if (!entries.length) continue;
      if (!pugcJson[sec] || typeof pugcJson[sec] !== 'object') pugcJson[sec] = {};
      html += `<div class="gs-section"><div class="gs-section-title">${gsEsc(RULE_SECTION_TITLES[sec] || sec)}</div>`;
      for (const { key: k, field: def } of entries) {
        const type = gsNormalizeType(def);
        const cur  = pugcJson[sec][k] ?? def.default;
        const label = def.label || gsLabel(k);
        const desc  = def.description || '';
        const descAttr = desc ? ` title="${gsEsc(desc)}"` : '';
        if (k === 'mainTagId' && mainTagList().length) { html += renderMainTagRow(sec, k, cur); continue; }
        if (k === 'subTagIds') { html += renderSubTagSection(currentMainTagId(), cur); continue; }
        if (k === 'modUserSelectPlayType' && playTypeOptions().length > 1) { html += renderPlayTypeRow(sec, k, cur); continue; }
        if (type === 'array' || type === 'Array') continue;
        const attrs = `data-gs-sec="${sec}" data-gs-key="${k}" data-gs-type="${type}"`;
        const vp = def.validatorParam || {};
        // validators use minValue/maxValue (game schema) or minNum/maxNum (legacy)
        const vpMin = vp.minValue ?? vp.minNum ?? null;
        const vpMax = vp.maxValue ?? vp.maxNum ?? null;
        const rangeNote = gsRangeNote(def);
        const labelHtml = rangeNote
          ? `${gsEsc(label)}<span class="devf-range">${gsEsc(rangeNote)}</span>`
          : gsEsc(label);
        let input;
        if (type === 'bool') {
          input = `<input type="checkbox" ${attrs}${cur ? ' checked' : ''}>`;
        } else if (type === 'enum') {
          const opts = gsEnumOptionsForField(def);
          input = `<select ${attrs}>${opts.map(o => `<option value="${gsEsc(o.value)}"${String(o.value) === String(cur) ? ' selected' : ''}>${gsEsc(o.label)}</option>`).join('')}</select>`;
        } else if (type === 'number' || type === 'Float' || type === 'Int') {
          const step = type === 'Float' ? 'any' : '1';
          const minA = vpMin != null ? ` min="${vpMin}"` : '';
          const maxA = vpMax != null ? ` max="${vpMax}"` : '';
          const displayVal = cur ?? vpMin ?? '';
          input = `<input type="number" step="${step}" ${attrs}${minA}${maxA} value="${gsEsc(displayVal)}">`;
        } else {
          input = `<input type="text" ${attrs} value="${gsEsc(cur ?? '')}">`;
        }
        html += `<label class="gs-row"${descAttr}><span>${labelHtml}</span>${input}</label>`;
      }
      html += '</div>';
    }
    html += renderFileHeaderSection();
    body.innerHTML = html || '<div class="subtle" style="padding:12px">No settings schema loaded.</div>';
    body.querySelectorAll('[data-gs-sec]').forEach(el => {
      el.addEventListener('change', () => {
        const sec = el.dataset.gsSec, key = el.dataset.gsKey, t = el.dataset.gsType;
        let v;
        if (t === 'bool') v = el.checked;
        else if (t === 'number' || t === 'Float' || t === 'Int') {
          v = Number(el.value);
          if (!Number.isFinite(v)) return;
          if (el.min !== '') v = Math.max(v, Number(el.min));
          if (el.max !== '') v = Math.min(v, Number(el.max));
        } else v = el.value;
        (pugcJson[sec] ??= {})[key] = v;
        if (el.dataset.gsMaintag) {
          pugcJson[sec].subTagIds = validSubTagIds(v, pugcJson[sec].subTagIds);
          commitHistory('Edit Game Settings');
          renderGameSettings();
          return;
        }
        commitHistory('Edit Game Settings');
      });
    });
    body.querySelectorAll('[data-gs-subtag]').forEach(el => {
      el.addEventListener('change', () =>
        toggleSubTag(el.dataset.gsSubtag, el.dataset.gsCat, Number(el.dataset.gsMax) || 0, el.checked));
    });
  }

  function openGameSettings() {
    if (!getPugcJson()) { setStatus('Open or start a project first', true); return; }
    renderGameSettings();
    document.getElementById('gameSettingsModal').hidden = false;
  }

  // Builds default creator/rule data for a new blank project, from rules.json's schema.
  function defaultRuleSections() {
    const out = {};
    for (const [sec, sectionValue] of Object.entries(catalog.rules || {})) {
      out[sec] = {};
      for (const { key, field } of gsSectionFields(sectionValue)) {
        const type = gsNormalizeType(field);
        const vp = field.validatorParam || {};
        const vpMin = vp.minValue ?? vp.minNum ?? null;
        if (type === 'Int') out[sec][key] = vpMin ?? 0;
        else if (type === 'Float') out[sec][key] = vpMin ?? 0;
        else if (type === 'bool' || type === 'Bool') out[sec][key] = false;
      }
    }
    if (out.roundRuleData) out.roundRuleData.timeLimit = 300;
    return out;
  }

  return { renderGameSettings, openGameSettings, defaultRuleSections };
}
