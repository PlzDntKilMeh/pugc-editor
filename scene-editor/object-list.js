import { escHtml } from './text-utils.js';

function templateNames(tool, getTemplates, getObjectMeta) {
  const templates = getTemplates(tool);
  const names = templates.map(template => {
    const meta = getObjectMeta(template.objectId);
    return `${meta.name} (${template.objectId})`;
  });
  return {
    templates,
    label: names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`,
  };
}

function thumbHtml(objectId, getObjectIconUrl, fallback = '') {
  const url = getObjectIconUrl?.(objectId);
  const label = fallback || String(objectId || '?');
  return `<span class="scene-obj-thumb">${url
    ? `<img src="${escHtml(url)}" loading="lazy" alt="">`
    : `<span>${escHtml(label.slice(0, 1) || '?')}</span>`}</span>`;
}

function openAttr(open) {
  return open ? ' open' : '';
}

// Standard disclosure triangle used by every collapsible node (sections, collections, tools).
function toggleBtn(key, open) {
  return `<button class="scene-list-toggle" type="button" title="${open ? 'Collapse' : 'Expand'}" data-toggle-node="${key}">${open ? 'v' : '>'}</button>`;
}

function readOpenState(list) {
  const state = new Map();
  list.querySelectorAll('details[data-node-key]').forEach(details => {
    state.set(details.dataset.nodeKey, details.open);
  });
  return state;
}

function isOpen(openState, key, defaultOpen = true) {
  return openState.has(key) ? openState.get(key) : defaultOpen;
}

function renderToolNode({ tool, type, color, selected, getTemplates, getObjectMeta, getObjectIconUrl, selectedItems, items, selectedBase }) {
  const { templates, label } = templateNames(tool, getTemplates, getObjectMeta);
  const slots = type === 'Circle'
    ? Math.max(1, Math.round(tool.params?.count || 0))
    : Math.max(1, Math.round(tool.params?.columns || 1)) * Math.max(1, Math.round(tool.params?.rows || 1));
  const idAttr = type === 'Circle' ? `data-circle-id="${tool.id}"` : `data-grid-id="${tool.id}"`;
  const firstTemplate = templates[0];
  // The stamped copies are locked, but the BASE template objects are listed here as selectable rows
  // (each selects/edits the tool's slot-0 source) with a remove button.
  const baseType = type === 'Circle' ? 'circle' : 'grid';
  const baseRows = templates.map((t, i) => {
    const meta = getObjectMeta(t.objectId);
    const baseItem = tool.items[i];
    const isSel = (selectedBase?.tool === tool && selectedBase?.templateIndex === i)
      || (baseItem != null && selectedItems.has(baseItem));
    return `<div class="scene-obj-row child scene-tool-base-row${isSel ? ' active' : ''}" data-base-tool="${tool.id}" data-base-type="${baseType}" data-base-index="${i}" title="Select to edit this base object. Shift-click to add to selection">
      ${thumbHtml(t.objectId, getObjectIconUrl, meta.name)}
      <span class="scene-obj-text">
        <span class="scene-obj-name">${escHtml(meta.name)}</span>
        <span class="scene-obj-sub">base object ${i + 1}</span>
      </span>
      <button class="scene-list-delete scene-tool-base-remove" type="button" title="Remove from base" data-base-remove>x</button>
    </div>`;
  }).join('');
  const key = type === 'Circle' ? `circle:${tool.id}` : `grid:${tool.id}`;
  const open = isOpen(renderToolNode.openState, key, false);
  return `<details class="scene-list-node scene-tool-node" data-node-key="${key}"${openAttr(open)}>
    <summary class="scene-obj-row scene-tool-list-row${selected ? ' active' : ''}" ${idAttr}>
      ${toggleBtn(key, open)}
      ${thumbHtml(firstTemplate?.objectId, getObjectIconUrl, type)}
      <span class="scene-obj-text">
        <span class="scene-obj-name">${type} Tool ${tool.id}</span>
        <span class="scene-obj-sub">${escHtml(label || `${slots} slots`)}</span>
      </span>
      <button class="scene-list-add" type="button" title="Add selected object(s) to this tool's base" ${type === 'Circle' ? `data-add-circle="${tool.id}"` : `data-add-grid="${tool.id}"`}>+</button>
      <span class="scene-obj-badge" style="border-color:${color}">${tool.items.length}</span>
    </summary>
    <div class="scene-list-empty">Base: ${templates.length} object${templates.length === 1 ? '' : 's'} x ${slots} slots = ${tool.items.length} stamped</div>
    ${baseRows}
  </details>`;
}

function renderItemRow(item, items, selectedItems, getObjectIconUrl, { child = false } = {}) {
  const isSel = selectedItems.has(item);
  const label = escHtml(item.ueObj.userDeviceName || item.meta.name);
  const idx = items.indexOf(item);
  return `<button class="scene-obj-row${child ? ' child' : ''}${isSel ? ' active' : ''}" data-idx="${idx}" draggable="true">
    ${thumbHtml(item.ueObj.objectId, getObjectIconUrl, item.meta.name)}
    <span class="scene-obj-text">
      <span class="scene-obj-name">${label}</span>
      <span class="scene-obj-sub">${escHtml(item.meta.name)}</span>
    </span>
  </button>`;
}

function searchableItemText(item) {
  const meta = item.meta || {};
  const catalog = meta.catalog || {};
  const spacedRowName = String(catalog.rowName || catalog.displayKey || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return [
    item.ueObj.userDeviceName,
    meta.name,
    catalog.name,
    catalog.rowName,
    catalog.displayKey,
    spacedRowName,
    item.ueObj.objectId,
  ].filter(v => v != null && v !== '').join(' ');
}

function renderCollection(collection, items, selectedItems, selectedCollection, getObjectIconUrl, visibleItems = null) {
  const collectionItems = collection.items.filter(item => items.includes(item) && (!visibleItems || visibleItems.has(item)));
  const selected = collection === selectedCollection;
  const rows = collectionItems.map(item => renderItemRow(item, items, selectedItems, getObjectIconUrl, { child: true })).join('');
  const key = `collection:${collection.id}`;
  const open = isOpen(renderCollection.openState, key, false);
  return `<details class="scene-list-group scene-collection-group" data-node-key="${key}" data-collection-id="${collection.id}"${openAttr(open)}>
    <summary class="${selected ? 'active' : ''}" data-collection-summary="${collection.id}">
      ${toggleBtn(key, open)}
      <span class="scene-collection-icon"></span>
      <span class="scene-list-group-title">${escHtml(collection.name)}</span>
      <span class="scene-list-group-count">${collectionItems.length}</span>
      <button class="scene-list-add" type="button" title="Add selected object(s) to this collection" data-add-collection="${collection.id}">+</button>
      <button class="scene-list-delete" type="button" title="Delete collection" data-delete-collection="${collection.id}">x</button>
    </summary>
    ${rows || '<div class="scene-list-empty">Empty collection</div>'}
  </details>`;
}

export function renderObjectList({
  list,
  countEl,
  filterText,
  items,
  circleTools,
  gridTools,
  selectedItems,
  selectedCollection,
  collections = [],
  selectedCircle,
  selectedGrid,
  selectedBase,
  getObjectMeta,
  getObjectIconUrl,
  getTemplates,
  renderPlacementBudget,
  updateClipboardButtons,
  onSelectCollection,
  onDeleteCollection,
  onSelectCircle,
  onSelectGrid,
  onSelectItem,
  onFocusSelected,
  onRenderRequested,
  onAddToCollection,
  onAddToCircle,
  onAddToGrid,
  onSelectBase,
  onRemoveBase,
}) {
  renderPlacementBudget();
  updateClipboardButtons();
  const openState = readOpenState(list);
  renderToolNode.openState = openState;
  renderCollection.openState = openState;

  const q = filterText.trim().toLowerCase();
  const shownCircles = circleTools.filter(tool => {
    const childText = tool.items.map(searchableItemText).join(' ');
    const haystack = `circle tool ${tool.id} ${getObjectMeta(tool.objectId).name} ${tool.objectId} ${childText}`.toLowerCase();
    return !q || haystack.includes(q);
  });
  const shownGrids = gridTools.filter(tool => {
    const childText = tool.items.map(searchableItemText).join(' ');
    const haystack = `grid tool ${tool.id} ${getObjectMeta(tool.objectId).name} ${tool.objectId} ${childText}`.toLowerCase();
    return !q || haystack.includes(q);
  });
  const shown = q
    ? items.filter(item => searchableItemText(item).toLowerCase().includes(q))
    : items;

  countEl.textContent =
    shown.length === items.length && shownCircles.length === circleTools.length && shownGrids.length === gridTools.length
      ? `${items.length} objects, ${circleTools.length} circle tools, ${gridTools.length} grid tools`
      : `${shown.length} / ${items.length} objects, ${shownCircles.length} / ${circleTools.length} circles, ${shownGrids.length} / ${gridTools.length} grids`;

  if (!shown.length && !shownCircles.length && !shownGrids.length) {
    list.innerHTML = '<div style="padding:14px;color:var(--muted);font-size:13px">No matches</div>';
    return;
  }

  const circleHtml = shownCircles.map(tool => {
    return renderToolNode({
      tool,
      type: 'Circle',
      color: '#33b6ff',
      selected: tool === selectedCircle,
      getTemplates,
      getObjectMeta,
      getObjectIconUrl,
      selectedItems,
      items,
      selectedBase,
    });
  }).join('');

  const gridHtml = shownGrids.map(tool => {
    return renderToolNode({
      tool,
      type: 'Grid',
      color: '#7bd56f',
      selected: tool === selectedGrid,
      getTemplates,
      getObjectMeta,
      getObjectIconUrl,
      selectedItems,
      items,
      selectedBase,
    });
  }).join('');

  const collectionSet = new Set(collections.flatMap(collection => collection.items));
  const toolItemSet = new Set([
    ...circleTools.flatMap(tool => tool.items),
    ...gridTools.flatMap(tool => tool.items),
  ]);
  const shownCollections = collections
    .filter(collection => !q || collection.items.some(item => shown.includes(item)));
  const looseItems = shown.filter(item => !collectionSet.has(item) && !toolItemSet.has(item));

  const collectionHtml = shownCollections.map(collection =>
    renderCollection(collection, items, selectedItems, selectedCollection, getObjectIconUrl, q ? new Set(shown) : null)
  ).join('');
  const itemHtml = looseItems.map(item => renderItemRow(item, items, selectedItems, getObjectIconUrl)).join('');

  const sectionNode = (key, title, count, defaultOpen, body) => {
    const open = isOpen(openState, key, defaultOpen);
    return `<details class="scene-list-group" data-node-key="${key}"${openAttr(open)}>
      <summary>${toggleBtn(key, open)}<span class="scene-list-group-title">${title}</span><span class="scene-list-group-count">${count}</span></summary>
      ${body}
    </details>`;
  };
  const toolCount = shownCircles.length + shownGrids.length;
  const toolHtml = circleHtml || gridHtml ? sectionNode('section:tools', 'Tools', toolCount, false, circleHtml + gridHtml) : '';
  const objectsHtml = itemHtml ? sectionNode('section:objects', collections.length ? 'Loose Objects' : 'Objects', looseItems.length, true, itemHtml) : '';
  const collectionsHtml = collectionHtml ? sectionNode('section:collections', 'Collections', shownCollections.length, false, collectionHtml) : '';
  list.innerHTML = toolHtml + collectionsHtml + objectsHtml;
  renderToolNode.openState = null;
  renderCollection.openState = null;

  list.querySelectorAll('[data-toggle-node]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const details = btn.closest('details[data-node-key]');
      if (details) details.open = !details.open;
    });
  });

  list.querySelectorAll('[data-collection-summary]').forEach(summary => {
    const collection = collections.find(c => c.id === Number(summary.dataset.collectionSummary));
    summary.addEventListener('click', e => {
      e.preventDefault();
      if (collection) onSelectCollection(collection);
      onRenderRequested();
    });
    summary.addEventListener('dblclick', e => {
      e.preventDefault();
      if (collection) {
        onSelectCollection(collection);
        onFocusSelected();
      }
      onRenderRequested();
    });
  });

  list.querySelectorAll('[data-delete-collection]').forEach(btn => {
    const collection = collections.find(c => c.id === Number(btn.dataset.deleteCollection));
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      if (collection) onDeleteCollection(collection);
      onRenderRequested();
    });
  });

  list.querySelectorAll('.scene-obj-row[data-circle-id]').forEach(btn => {
    const tool = circleTools.find(t => t.id === Number(btn.dataset.circleId));
    btn.addEventListener('click', e => {
      e.preventDefault(); // select without toggling the <details> (expand only via the arrow)
      if (tool) onSelectCircle(tool);
      window.setTimeout(onRenderRequested, 0);
    });
    btn.addEventListener('dblclick', e => {
      e.preventDefault();
      if (tool) {
        onSelectCircle(tool);
        onFocusSelected();
      }
      window.setTimeout(onRenderRequested, 0);
    });
  });

  list.querySelectorAll('.scene-obj-row[data-grid-id]').forEach(btn => {
    const tool = gridTools.find(t => t.id === Number(btn.dataset.gridId));
    btn.addEventListener('click', e => {
      e.preventDefault();
      if (tool) onSelectGrid(tool);
      window.setTimeout(onRenderRequested, 0);
    });
    btn.addEventListener('dblclick', e => {
      e.preventDefault();
      if (tool) {
        onSelectGrid(tool);
        onFocusSelected();
      }
      window.setTimeout(onRenderRequested, 0);
    });
  });

  list.querySelectorAll('.scene-obj-row').forEach(btn => {
    if (!btn.dataset.idx) return;
    const idx = Number(btn.dataset.idx);
    btn.addEventListener('click', e => {
      onSelectItem(items[idx], { add: e.ctrlKey || e.metaKey || e.shiftKey, toggle: e.ctrlKey || e.metaKey || e.shiftKey });
      onRenderRequested();
    });
    btn.addEventListener('dblclick', () => {
      onSelectItem(items[idx]);
      onFocusSelected();
      onRenderRequested();
    });
  });

  // "+" add buttons (use current selection) and drag-onto-node (use the dragged row) - both routed
  // through the same onAddTo* callbacks so collections and tool bases share one path.
  list.querySelectorAll('[data-add-collection]').forEach(btn => {
    const collection = collections.find(c => c.id === Number(btn.dataset.addCollection));
    btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); if (collection) onAddToCollection?.(collection, null); });
  });
  list.querySelectorAll('[data-add-circle]').forEach(btn => {
    const tool = circleTools.find(t => t.id === Number(btn.dataset.addCircle));
    btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); if (tool) onAddToCircle?.(tool, null); });
  });
  list.querySelectorAll('[data-add-grid]').forEach(btn => {
    const tool = gridTools.find(t => t.id === Number(btn.dataset.addGrid));
    btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); if (tool) onAddToGrid?.(tool, null); });
  });

  list.querySelectorAll('.scene-obj-row[data-idx]').forEach(btn => {
    btn.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', btn.dataset.idx);
      e.dataTransfer.effectAllowed = 'copy';
    });
  });

  // Tool base-object rows: click selects/edits the base object, the x removes it from the template.
  list.querySelectorAll('.scene-tool-base-row').forEach(row => {
    const type = row.dataset.baseType;
    const idx = Number(row.dataset.baseIndex);
    const tool = (type === 'grid' ? gridTools : circleTools).find(t => t.id === Number(row.dataset.baseTool));
    row.addEventListener('click', e => {
      if (e.target.closest('[data-base-remove]')) return;
      if (tool) onSelectBase?.(tool, type, idx, { add: e.shiftKey || e.ctrlKey || e.metaKey });
      onRenderRequested();
    });
    row.querySelector('[data-base-remove]')?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      if (tool) onRemoveBase?.(tool, type, idx);
    });
  });

  const onDrop = (el, e) => {
    e.preventDefault();
    el.classList.remove('drop-target');
    const idx = Number(e.dataTransfer.getData('text/plain'));
    if (!Number.isInteger(idx)) return;
    if (el.dataset.collectionSummary != null) {
      const c = collections.find(x => x.id === Number(el.dataset.collectionSummary));
      if (c) onAddToCollection?.(c, idx);
    } else if (el.dataset.circleId != null) {
      const t = circleTools.find(x => x.id === Number(el.dataset.circleId));
      if (t) onAddToCircle?.(t, idx);
    } else if (el.dataset.gridId != null) {
      const t = gridTools.find(x => x.id === Number(el.dataset.gridId));
      if (t) onAddToGrid?.(t, idx);
    }
  };
  [
    ...list.querySelectorAll('[data-collection-summary]'),
    ...list.querySelectorAll('.scene-obj-row[data-circle-id]'),
    ...list.querySelectorAll('.scene-obj-row[data-grid-id]'),
  ].forEach(el => {
    el.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; el.classList.add('drop-target'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', e => onDrop(el, e));
  });
}

// Update only the .active highlight in-place (no DOM rebuild). Selection changes don't alter the list
// structure, so this avoids the full renderObjectList rebuild + listener rebind on every click.
export function applySelectionClasses(list, { items, selectedItems, selectedCircle, selectedGrid, selectedCollection, selectedBase, circleTools, gridTools }) {
  if (!list) return;
  list.querySelectorAll('.scene-obj-row[data-idx]').forEach(el => {
    const it = items[Number(el.dataset.idx)];
    el.classList.toggle('active', Boolean(it) && selectedItems.has(it));
  });
  list.querySelectorAll('[data-circle-id]').forEach(el => {
    el.classList.toggle('active', Boolean(selectedCircle) && Number(el.dataset.circleId) === selectedCircle.id);
  });
  list.querySelectorAll('[data-grid-id]').forEach(el => {
    el.classList.toggle('active', Boolean(selectedGrid) && Number(el.dataset.gridId) === selectedGrid.id);
  });
  list.querySelectorAll('[data-collection-summary]').forEach(el => {
    el.classList.toggle('active', Boolean(selectedCollection) && Number(el.dataset.collectionSummary) === selectedCollection.id);
  });
  list.querySelectorAll('.scene-tool-base-row').forEach(el => {
    const toolId = Number(el.dataset.baseTool);
    const baseType = el.dataset.baseType;
    const idx = Number(el.dataset.baseIndex);
    const isPrimary = Boolean(selectedBase)
      && selectedBase.tool.id === toolId
      && selectedBase.type === baseType
      && selectedBase.templateIndex === idx;
    let isMulti = false;
    if (!isPrimary && selectedItems.size > 0) {
      const tools = baseType === 'circle' ? circleTools : gridTools;
      const tool = tools?.find(t => t.id === toolId);
      const baseItem = tool?.items[idx];
      isMulti = Boolean(baseItem) && selectedItems.has(baseItem);
    }
    el.classList.toggle('active', isPrimary || isMulti);
  });
}

export function scrollListToActiveItem(list) {
  const btn = list.querySelector('.scene-obj-row.active');
  if (btn) btn.scrollIntoView({ block: 'nearest' });
}
