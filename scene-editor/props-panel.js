import * as THREE from 'three';
import { threePosToUe4 } from './coords.js';
import {
  fmt1,
  formatTransformNumber,
  setNumericInputValue,
} from './text-utils.js';
import { objectEulerDegrees } from './transform-utils.js';
import {
  parseDeviceProps,
  renderDeviceFields,
  setPath,
  RERENDER_ON_CHANGE,
  applyOutOfRangeMode,
} from './device-fields.js';

function setTransformScaleInputsDisabled(disabled) {
  for (const id of ['propScaleX', 'propScaleY', 'propScaleZ']) {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  }
}

function syncObjectTransformInputs(item) {
  const t = item.ueObj.spawnTransform.translation;
  const s = item.ueObj.spawnTransform.scale3D;
  const r = objectEulerDegrees(item);
  setTransformScaleInputsDisabled(false);
  setNumericInputValue('propPosX', t.x);
  setNumericInputValue('propPosY', t.y);
  setNumericInputValue('propPosZ', t.z);
  setNumericInputValue('propRotP', r.p);
  setNumericInputValue('propRotY', r.y);
  setNumericInputValue('propRotR', r.r);
  setNumericInputValue('propScaleX', s.x, 6);
  setNumericInputValue('propScaleY', s.y, 6);
  setNumericInputValue('propScaleZ', s.z, 6);
}

function syncToolTransformInputs(tool, toolEulerDegrees) {
  const t = threePosToUe4(tool.group.position);
  const r = toolEulerDegrees(tool);
  setTransformScaleInputsDisabled(true);
  setNumericInputValue('propPosX', t.x);
  setNumericInputValue('propPosY', t.y);
  setNumericInputValue('propPosZ', t.z);
  setNumericInputValue('propRotP', r.p);
  setNumericInputValue('propRotY', r.y);
  setNumericInputValue('propRotR', r.r);
  setNumericInputValue('propScaleX', 1);
  setNumericInputValue('propScaleY', 1);
  setNumericInputValue('propScaleZ', 1);
}

function showPropsContent() {
  document.getElementById('propsEmpty').style.display = 'none';
  document.getElementById('propsContent').style.display = '';
  document.getElementById('propsDetailsEmpty').style.display = 'none';
  document.getElementById('propsDetailsContent').style.display = '';
}

function setTransformTarget(text) {
  const el = document.getElementById('propTransformTarget');
  if (el) el.textContent = text;
}

function meshBoundsLines(item) {
  if (!item?.hasRealMesh || !item.mesh) return [];
  const box = new THREE.Box3().setFromObject(item.mesh);
  if (box.isEmpty()) return [];
  const center = threePosToUe4(box.getCenter(new THREE.Vector3()));
  const t = item.ueObj.spawnTransform.translation;
  return [
    '',
    `Mesh bounds center: X ${fmt1(center.x)}  Y ${fmt1(center.y)}  Z ${fmt1(center.z)}`,
    `Mesh center delta: X ${fmt1(center.x - t.x)}  Y ${fmt1(center.y - t.y)}  Z ${fmt1(center.z - t.z)}`,
  ];
}

function toolTemplateLines(tool, getTemplates, getObjectMeta) {
  const templates = getTemplates(tool);
  const lines = [`Templates: ${templates.length}`];
  templates.forEach((template, idx) => {
    const meta = getObjectMeta(template.objectId);
    const offset = template.offset || { x: 0, y: 0, z: 0 };
    const scale = template.scale3D || { x: 1, y: 1, z: 1 };
    lines.push(
      `${idx + 1}. ${meta.name} (${template.objectId})`,
      `   offset ${fmt1(offset.x || 0)}, ${fmt1(offset.y || 0)}, ${fmt1(offset.z || 0)} m`,
      `   scale ${fmt1(scale.x ?? 1)}, ${fmt1(scale.y ?? 1)}, ${fmt1(scale.z ?? 1)}`
    );
  });
  return lines;
}

export function createPropsPanelController({
  getObjectMeta,
  getTemplates,
  toolPlacementCount,
  toolEulerDegrees,
  catalog,
  translateText,
  getEnums,
  getPlacedDevices,
  getTagSuggestions,
  getDeviceEventList,
  onWiringChange,
  onDeviceNameChange,
  onDevicePropertyChange,
}) {
  function refreshDeviceFields(ueObj, devCatalog) {
    const onChange = (path, value) => {
      const props = parseDeviceProps(ueObj);
      setPath(props, path, value);
      ueObj.devicePropertyData = JSON.stringify(props);
      onDevicePropertyChange?.(ueObj);
      // Re-render when a field that controls other fields' visibility changes.
      if (RERENDER_ON_CHANGE.has(path.split('.').pop())) refreshDeviceFields(ueObj, devCatalog);
    };
    const basicEl = document.getElementById('propDeviceFields');
    const advEl = document.getElementById('propDeviceFieldsAdvanced');
    const enums = getEnums?.() ?? catalog?.enums;
    const commonOptions = { getPlacedDevices, getTagSuggestions, stringTables: catalog?.stringTables };
    const allow = document.getElementById('gsAllowOutOfRange')?.checked ?? false;
    if (basicEl) {
      renderDeviceFields(basicEl, ueObj, devCatalog, enums, catalog?.items, onChange, { ...commonOptions, advancedMode: 'basic' });
      applyOutOfRangeMode(basicEl, allow);
    }
    if (advEl) {
      renderDeviceFields(advEl, ueObj, devCatalog, enums, catalog?.items, onChange, { ...commonOptions, advancedMode: 'advanced' });
      applyOutOfRangeMode(advEl, allow);
    }
  }

  // Localize a device entry's fields/triggers/actions to the current language.
  // Each entry carries its own labelNs/labelKey and descriptionNs/descriptionKey (baked by
  // pak-server). translateText(ns, key, fallback) resolves against the loaded translations;
  // the inlined English label/description serves as the fallback when no translation exists.
  function localizeDevice(dev) {
    if (!dev || !translateText) return dev;
    const devNs = dev.namespace || '';
    const mapEntry = (e) => ({
      ...e,
      label:       translateText(e.labelNs       || devNs, e.labelKey,       e.label)       || e.label,
      description: translateText(e.descriptionNs || devNs, e.descriptionKey, e.description) || e.description,
      // Kept alongside the (possibly translated) description: enum per-value tip lines are always
      // authored in English, so this lets selectedEnumHint locate the right line by English label
      // even when `description` above has been translated to a different language.
      englishDescription: e.description,
    });
    return {
      ...dev,
      fields:   Array.isArray(dev.fields)   ? dev.fields.map(mapEntry)   : dev.fields,
      triggers: Array.isArray(dev.triggers) ? dev.triggers.map(mapEntry) : dev.triggers,
      actions:  Array.isArray(dev.actions)  ? dev.actions.map(mapEntry)  : dev.actions,
    };
  }

  function showDeviceSection(ueObj, meta) {
    const devCatalog = localizeDevice(meta.catalog);
    const nameSection = document.getElementById('devNameSection');
    const dataSection = document.getElementById('devDataSection');
    const nameInput = document.getElementById('propDeviceName');
    const meshDetails = document.getElementById('meshDetailsSection');

    if (nameSection) nameSection.style.display = '';
    if (dataSection) dataSection.style.display = '';
    if (meshDetails) meshDetails.open = false;

    if (nameInput) {
      nameInput.value = ueObj.userDeviceName || '';
      nameInput.oninput = (e) => {
        ueObj.userDeviceName = e.target.value;
        const nameEl = document.getElementById('propName');
        if (nameEl) nameEl.textContent = ueObj.userDeviceName || meta.name;
        onDeviceNameChange?.(ueObj);
      };
    }

    refreshDeviceFields(ueObj, devCatalog);
    // Hide the Change tab when the device has no advanced ("change") properties.
    const fields = devCatalog?.fields || [];
    const hasAdvanced = fields.some(f => f.advanced && f.type !== 'Object' && !f.path.includes('[].'));
    const changeTab = document.querySelector('.scene-dev-tab[data-dev-tab="change"]');
    if (changeTab) changeTab.hidden = !hasAdvanced;
    // Triggers/Actions tabs show this device's actual event wiring (deviceEventList), editable.
    // Basic/Change split is by the bIsAdvancedDisplay flag (the data has no per-property category).
    renderDeviceWiring(document.getElementById('devTabTriggers'), ueObj, devCatalog, 'triggers');
    renderDeviceWiring(document.getElementById('devTabActions'), ueObj, devCatalog, 'actions');
    selectDeviceTab('basic');
  }

  function devEsc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function devCatFor(objectId) { return localizeDevice(catalog?.devices?.[String(objectId)]); }
  function eventLabelOf(objectId, name, kind) {
    const arr = kind === 'trigger' ? devCatFor(objectId)?.triggers : devCatFor(objectId)?.actions;
    return arr?.find(e => e.name === name)?.label || name;
  }

  // Editable per-device event wiring. kind 'triggers' = this device's outgoing trigger -> other
  // device action; 'actions' = other device's trigger -> this device's action. Stored in
  // deviceEventList groups: { eventId:{deviceInstanceId, eventName}, relationEventId:[{...}] }.
  function renderDeviceWiring(container, ueObj, devCatalog, kind) {
    if (!container) return;
    const groups = getDeviceEventList?.() || [];
    const myId = Number(ueObj.objectId);
    const myIdx = ueObj.deviceIndex;
    const others = (getPlacedDevices?.() || []).filter(d => !(d.objectId === myId && d.deviceIndex === myIdx));
    const myEvents = (kind === 'triggers' ? devCatalog?.triggers : devCatalog?.actions) || [];
    const opt = (val, label, sel) => `<option value="${devEsc(val)}"${String(val) === String(sel) ? ' selected' : ''}>${devEsc(label)}</option>`;
    const myEventOpts = (sel) => myEvents.map(e => opt(e.name, e.label || e.name, sel)).join('');
    const deviceOpts = (sel) => others.map(d => opt(`${d.objectId}:${d.deviceIndex}`, d.label, sel)).join('');
    const otherEventsOf = (oid) => (kind === 'triggers' ? devCatFor(oid)?.actions : devCatFor(oid)?.triggers) || [];
    const otherEventOpts = (oid, sel) => otherEventsOf(oid).map(e => opt(e.name, e.label || e.name, sel)).join('');
    const parseKey = (k) => { const [a, b] = String(k).split(':'); return { objectId: Number(a), deviceIndex: Number(b) }; };
    // Interface constraint (targetClass) is carried per event in the catalog. Surface it so the modder
    // sees which connections require a specific device interface (e.g. Mover <-> Trigger Area).
    const shortIface = (cls) => (!cls || cls === 'None') ? '' : String(cls).replace(/^Class'.*\./, '').replace(/'$/, '').replace(/ModInterface$/, '');
    const ifaceOf = (events, name) => shortIface((events.find(e => e.name === name) || {}).targetClass);

    // existing connections relevant to this device
    const conns = [];
    groups.forEach((g, gi) => {
      const s = g.eventId?.deviceInstanceId;
      (g.relationEventId || []).forEach((r, ri) => {
        const t = r.deviceInstanceId;
        if (kind === 'triggers' && Number(s?.objectId) === myId && s?.deviceIndex === myIdx) {
          conns.push({ gi, ri, myEvent: g.eventId.eventName, otherKey: `${t?.objectId}:${t?.deviceIndex}`, otherEvent: r.eventName });
        }
        if (kind === 'actions' && Number(t?.objectId) === myId && t?.deviceIndex === myIdx) {
          conns.push({ gi, ri, myEvent: r.eventName, otherKey: `${s?.objectId}:${s?.deviceIndex}`, otherEvent: g.eventId.eventName });
        }
      });
    });

    const defaultKey = others[0] ? `${others[0].objectId}:${others[0].deviceIndex}` : '';
    const rowHtml = (c, isAdd) => {
      const key = c.otherKey || defaultKey;
      const oid = key.split(':')[0];
      const myIface = ifaceOf(myEvents, c.myEvent);
      const otherIface = ifaceOf(otherEventsOf(oid), c.otherEvent);
      const chip = (i) => i ? `<span class="scene-dev-iface" title="Requires ${devEsc(i)} interface">${devEsc(i)}</span>` : '';
      const my = `<select data-w="myEvent">${myEventOpts(c.myEvent)}</select>${chip(myIface)}`;
      const dev = `<select data-w="otherDevice">${deviceOpts(key)}</select>`;
      const oev = `<select data-w="otherEvent">${otherEventOpts(oid, c.otherEvent)}</select>${chip(otherIface)}`;
      const btn = isAdd ? '<button data-w="add" class="button compact" type="button">Add</button>' : '<button data-conn-remove class="scene-dev-conn-x" type="button" title="Remove">x</button>';
      const inner = kind === 'triggers' ? `${my}<span class="scene-dev-conn-arrow">-&gt;</span>${dev}${oev}` : `${dev}${oev}<span class="scene-dev-conn-arrow">-&gt;</span>${my}`;
      // Warn (do not block) when both ends declare different interface requirements.
      const mismatch = myIface && otherIface && myIface !== otherIface;
      const cls = 'scene-dev-conn' + (mismatch ? ' scene-dev-conn-warn' : '');
      const warnTitle = mismatch ? ` title="Interface mismatch: ${devEsc(myIface)} vs ${devEsc(otherIface)}"` : '';
      return `<div class="${cls}"${warnTitle}${isAdd ? '' : ` data-gi="${c.gi}" data-ri="${c.ri}"`}>${inner}${btn}</div>`;
    };

    let html = '<div class="scene-dev-wiring">';
    if (!others.length) {
      html += '<div class="devf-empty">Place another device to connect.</div>';
    } else {
      html += conns.length ? conns.map(c => rowHtml(c, false)).join('') : `<div class="devf-empty">No ${kind === 'triggers' ? 'outgoing' : 'incoming'} connections yet.</div>`;
      html += '<div class="scene-settings-sub">Add connection</div>';
      html += rowHtml({ myEvent: myEvents[0]?.name, otherKey: defaultKey, otherEvent: '' }, true);
    }
    html += '</div>';
    container.innerHTML = html;

    const rerender = () => renderDeviceWiring(container, ueObj, devCatalog, kind);

    // existing connection rows: edit in place
    container.querySelectorAll('.scene-dev-conn[data-gi]').forEach(row => {
      const g = groups[Number(row.dataset.gi)];
      const ri = Number(row.dataset.ri);
      if (!g?.relationEventId?.[ri]) return;
      const setMyEvent = (v) => { if (kind === 'triggers') g.eventId.eventName = v; else g.relationEventId[ri].eventName = v; };
      const setOtherEvent = (v) => { if (kind === 'triggers') g.relationEventId[ri].eventName = v; else g.eventId.eventName = v; };
      const setOtherDevice = (inst) => { if (kind === 'triggers') g.relationEventId[ri].deviceInstanceId = inst; else g.eventId.deviceInstanceId = inst; };
      row.querySelector('[data-w="myEvent"]').addEventListener('change', e => { setMyEvent(e.target.value); onWiringChange?.(); rerender(); });
      row.querySelector('[data-w="otherEvent"]').addEventListener('change', e => { setOtherEvent(e.target.value); onWiringChange?.(); rerender(); });
      row.querySelector('[data-w="otherDevice"]').addEventListener('change', e => {
        const inst = parseKey(e.target.value);
        setOtherDevice(inst);
        setOtherEvent(otherEventsOf(inst.objectId)[0]?.name || ''); // event list changes with the device
        onWiringChange?.();
        rerender();
      });
      row.querySelector('[data-conn-remove]').addEventListener('click', () => {
        g.relationEventId.splice(ri, 1);
        if (!g.relationEventId.length) groups.splice(Number(row.dataset.gi), 1);
        onWiringChange?.();
        rerender();
      });
    });

    // add row
    const addRow = container.querySelector('.scene-dev-conn:not([data-gi])');
    if (addRow) {
      const addDev = addRow.querySelector('[data-w="otherDevice"]');
      const addOev = addRow.querySelector('[data-w="otherEvent"]');
      addDev.addEventListener('change', () => { addOev.innerHTML = otherEventOpts(addDev.value.split(':')[0], ''); });
      addRow.querySelector('[data-w="add"]').addEventListener('click', () => {
        const myEvent = addRow.querySelector('[data-w="myEvent"]').value;
        const otherEvent = addOev.value;
        if (!myEvent || !addDev.value || !otherEvent) return;
        const myInst = { objectId: myId, deviceIndex: myIdx };
        const otherInst = parseKey(addDev.value);
        if (kind === 'triggers') groups.push({ eventId: { deviceInstanceId: myInst, eventName: myEvent }, relationEventId: [{ deviceInstanceId: otherInst, eventName: otherEvent }] });
        else groups.push({ eventId: { deviceInstanceId: otherInst, eventName: otherEvent }, relationEventId: [{ deviceInstanceId: myInst, eventName: myEvent }] });
        onWiringChange?.();
        rerender();
      });
    }
  }
  function selectDeviceTab(tab) {
    const panels = { basic: 'devTabBasic', change: 'devTabChange', triggers: 'devTabTriggers', actions: 'devTabActions' };
    document.querySelectorAll('.scene-dev-tab').forEach(t => t.classList.toggle('active', t.dataset.devTab === tab));
    for (const [key, id] of Object.entries(panels)) {
      const el = document.getElementById(id);
      if (el) el.hidden = key !== tab;
    }
  }
  document.querySelectorAll('.scene-dev-tab').forEach(t => { t.onclick = () => selectDeviceTab(t.dataset.devTab); });

  function hideDeviceSection() {
    const nameSection = document.getElementById('devNameSection');
    const dataSection = document.getElementById('devDataSection');
    const meshDetails = document.getElementById('meshDetailsSection');
    if (nameSection) nameSection.style.display = 'none';
    if (dataSection) dataSection.style.display = 'none';
    if (meshDetails) meshDetails.open = true;
  }

  return {
    updateObject(item) {
      const { ueObj, meta } = item;
      showPropsContent();

      document.getElementById('propName').textContent =
        ueObj.userDeviceName || meta.name;
      setTransformTarget(ueObj.userDeviceName || meta.name);
      document.getElementById('propType').textContent =
        `${meta.name}  -  id ${ueObj.objectId}  idx ${ueObj.deviceIndex ?? '-'}`;

      const t = ueObj.spawnTransform.translation;
      document.getElementById('propPos').textContent =
        `X ${fmt1(t.x)}  Y ${fmt1(t.y)}  Z ${fmt1(t.z)}`;

      const eulerDeg = objectEulerDegrees(item);
      const toDeg = d => d.toFixed(1) + ' deg';
      document.getElementById('propRot').textContent =
        `P ${toDeg(eulerDeg.p)}  Y ${toDeg(eulerDeg.y)}  R ${toDeg(eulerDeg.r)}`;

      const s = ueObj.spawnTransform.scale3D;
      document.getElementById('propScale').textContent =
        `X ${formatTransformNumber(s.x, 6)}  Y ${formatTransformNumber(s.y, 6)}  Z ${formatTransformNumber(s.z, 6)}`;
      syncObjectTransformInputs(item);

      const meshLines = [];
      if (item.meshPaths?.length) {
        meshLines.push(...item.meshPaths);
      } else if (item.hasRealMesh) {
        meshLines.push('(mesh path not reported)');
      } else {
        meshLines.push('(loading mesh...)');
      }
      if (item.bpClass) meshLines.push(`BP: ${item.bpClass}`);
      meshLines.push(...meshBoundsLines(item));
      const mats = [...new Set((item.sections || []).map(section => section.matPath).filter(Boolean))];
      if (mats.length) {
        meshLines.push('', 'Materials:');
        meshLines.push(...mats);
      }
      document.getElementById('propMeshPath').textContent = meshLines.join('\n');

      if (meta.isDevice) {
        showDeviceSection(ueObj, meta);
      } else {
        hideDeviceSection();
      }
    },

    updateCircle(tool) {
      showPropsContent();
      hideDeviceSection();

      const meta = getObjectMeta(tool.objectId);
      document.getElementById('propName').textContent = `Circle Tool ${tool.id}`;
      setTransformTarget(`Circle Tool ${tool.id}`);
      document.getElementById('propType').textContent =
        `${tool.items.length} x ${meta.name}  -  id ${tool.objectId}`;

      const t = threePosToUe4(tool.group.position);
      const r = toolEulerDegrees(tool);
      document.getElementById('propPos').textContent =
        `X ${fmt1(t.x)}  Y ${fmt1(t.y)}  Z ${fmt1(t.z)}`;
      document.getElementById('propRot').textContent =
        `Circle P ${fmt1(r.p)}  Y ${fmt1(r.y)}  R ${fmt1(r.r)} deg\nObject P ${fmt1(tool.params.objectPitchDeg || 0)}  Y ${fmt1(tool.params.offsetDeg || 0)}  R ${fmt1(tool.params.objectRollDeg || 0)} deg  Step ${fmt1(tool.params.rotationStepDeg || 0)} deg`;
      const count = toolPlacementCount(tool.params);
      const actualSpacing = Math.PI * tool.params.diameter / count;
      document.getElementById('propScale').textContent =
        `Diameter ${fmt1(tool.params.diameter)} m  Count ${count}  Spacing ${fmt1(actualSpacing)} m\nScale X ${fmt1(tool.params.scaleX ?? 1)} Y ${fmt1(tool.params.scaleY ?? 1)} Z ${fmt1(tool.params.scaleZ ?? 1)}\nStep R ${fmt1(tool.params.radialStep || 0)} m  H ${fmt1(tool.params.heightStep || 0)} m  Scale ${fmt1(tool.params.scaleStepX || 0)}, ${fmt1(tool.params.scaleStepY || 0)}, ${fmt1(tool.params.scaleStepZ || 0)}${tool.params.scaleOffsets ? '\nTemplate offsets scale with slot scale' : ''}`;
      syncToolTransformInputs(tool, toolEulerDegrees);
      document.getElementById('propMeshPath').textContent =
        [`Session circle controller`, `Owns ${tool.items.length} placed object(s)`, ...toolTemplateLines(tool, getTemplates, getObjectMeta)].join('\n');
    },

    updateGrid(tool) {
      showPropsContent();
      hideDeviceSection();

      const meta = getObjectMeta(tool.objectId);
      document.getElementById('propName').textContent = `Grid Tool ${tool.id}`;
      setTransformTarget(`Grid Tool ${tool.id}`);
      document.getElementById('propType').textContent =
        `${tool.items.length} x ${meta.name}  -  id ${tool.objectId}`;

      const t = threePosToUe4(tool.group.position);
      const r = toolEulerDegrees(tool);
      document.getElementById('propPos').textContent =
        `X ${fmt1(t.x)}  Y ${fmt1(t.y)}  Z ${fmt1(t.z)}`;
      document.getElementById('propRot').textContent =
        `Grid P ${fmt1(r.p)}  Y ${fmt1(r.y)}  R ${fmt1(r.r)} deg\nObject P ${fmt1(tool.params.objectPitchDeg || 0)}  Y ${fmt1(tool.params.offsetDeg || 0)}  R ${fmt1(tool.params.objectRollDeg || 0)} deg  Step ${fmt1(tool.params.yawStepDeg || 0)} deg`;
      document.getElementById('propScale').textContent =
        `Columns ${tool.params.columns || 1}  Rows ${tool.params.rows || 1}\nSpacing X ${fmt1(tool.params.spacingX || 0)} m  Y ${fmt1(tool.params.spacingY || 0)} m  Height ${fmt1(tool.params.heightStep || 0)} m\nScale X ${fmt1(tool.params.scaleX ?? 1)} Y ${fmt1(tool.params.scaleY ?? 1)} Z ${fmt1(tool.params.scaleZ ?? 1)}`;
      syncToolTransformInputs(tool, toolEulerDegrees);
      document.getElementById('propMeshPath').textContent =
        [`Session grid controller`, `Owns ${tool.items.length} placed object(s)`, ...toolTemplateLines(tool, getTemplates, getObjectMeta)].join('\n');
    },
  };
}
