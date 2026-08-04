// Read-only, pan/zoom logic-flow graph for the scene editor. Device nodes are laid out by a layered
// BFS (the same approach the logic editor uses) and connected by two edge kinds drawn as SVG beziers:
//   - event wiring (deviceEventList): trigger -> action
//   - device-field references (Device-type fields, e.g. AI nav / firstNavDevice links), dashed
// Clicking a node selects that device (driving the existing props panel + 3D selection); double-click
// focuses it in 3D. This view never mutates the mod - all editing stays in the props panel.

const NODE_W = 310;
const NODE_H = 86;
const COL_GAP = 410;
const ROW_GAP = 116;
const MARGIN = 28;
const TAG_ROW_H = 26;    // extra header height reserved for a row of clickable group-tag chips
const BAND_GAP = 56 + TAG_ROW_H; // vertical gap between connected clusters / the unconnected grid
const GROUP_PAD = 18;    // padding of a group's background box around its nodes
const GROUP_HEADER = 34 + TAG_ROW_H; // top band reserved for group title/select controls + tag chips
const SINGLE_COLS_MIN = 4; // min columns in the unconnected-devices grid
const FOCUS_SCALE = 1.35;

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Brandes-Koepf coordinate assignment. Given the per-layer node order (`order` = array of layers, each
// an array of node keys top->bottom) and adjacent-layer neighbour lists (`above`/`below`: key ->
// neighbour keys in the layer immediately before/after it), assign each node a cross-axis coordinate so
// that connected nodes line up (straight edges) without overlapping or breaking the given order. Runs
// the four alignments (align to upper/lower neighbours x leftmost/rightmost bias) and takes the median
// of the four, which balances the result. `sep` is the minimum gap between nodes in a layer.
// Exported for unit testing.
export function bkCoords(order, above, below, sep) {
  const keys = [];
  for (const layer of order) for (const id of layer) keys.push(id);

  // One alignment+compaction. vertDown: process layers front->back aligning to the previous layer's
  // neighbours (`above`); else back->front using `below`. horizLeft: keep layer order (top bias); else
  // reverse it (bottom bias) and flip the result back so all four share one orientation.
  function oneDir(vertDown, horizLeft) {
    const oriented = order.map(layer => (horizLeft ? layer.slice() : layer.slice().reverse()));
    const layers = vertDown ? oriented : oriented.slice().reverse();
    const pos = new Map();
    const layerIdx = new Map();
    layers.forEach((layer, l) => layer.forEach((id, i) => { pos.set(id, i); layerIdx.set(id, l); }));
    const upperOf = vertDown ? above : below;
    const uppers = (v) => (upperOf.get(v) || []).filter(u => pos.has(u)).sort((a, b) => pos.get(a) - pos.get(b));

    const root = new Map(keys.map(k => [k, k]));
    const align = new Map(keys.map(k => [k, k]));
    for (let l = 1; l < layers.length; l++) {
      let r = -1; // last upper position consumed, keeps alignments non-crossing
      for (const v of layers[l]) {
        const us = uppers(v);
        if (!us.length) continue;
        const mids = [Math.floor((us.length - 1) / 2), Math.ceil((us.length - 1) / 2)];
        for (const m of mids) {
          if (align.get(v) !== v) continue;
          const u = us[m];
          if (pos.get(u) > r) {
            align.set(u, v);
            root.set(v, root.get(u));
            align.set(v, root.get(v));
            r = pos.get(u);
          }
        }
      }
    }

    const sink = new Map(keys.map(k => [k, k]));
    const shift = new Map(keys.map(k => [k, Infinity]));
    const x = new Map();
    const placeBlock = (v) => {
      if (x.has(v)) return;
      x.set(v, 0);
      let w = v;
      do {
        const p = pos.get(w);
        if (p > 0) {
          const pred = layers[layerIdx.get(w)][p - 1];
          const u = root.get(pred);
          placeBlock(u);
          if (sink.get(v) === v) sink.set(v, sink.get(u));
          if (sink.get(v) !== sink.get(u)) {
            shift.set(sink.get(u), Math.min(shift.get(sink.get(u)), x.get(v) - x.get(u) - sep));
          } else {
            x.set(v, Math.max(x.get(v), x.get(u) + sep));
          }
        }
        w = align.get(w);
      } while (w !== v);
    };
    for (const v of keys) if (root.get(v) === v) placeBlock(v);

    const coord = new Map();
    for (const v of keys) {
      let c = x.get(root.get(v));
      const s = shift.get(sink.get(root.get(v)));
      if (s < Infinity) c += s;
      coord.set(v, horizLeft ? c : -c); // un-flip the reversed-orientation runs
    }
    return coord;
  }

  const runs = [oneDir(true, true), oneDir(true, false), oneDir(false, true), oneDir(false, false)];
  for (const c of runs) { // zero-base each run so the four are comparable
    let mn = Infinity;
    for (const v of c.values()) mn = Math.min(mn, v);
    for (const k of c.keys()) c.set(k, c.get(k) - mn);
  }
  const result = new Map();
  for (const id of keys) {
    const vals = runs.map(c => c.get(id)).sort((a, b) => a - b);
    result.set(id, (vals[1] + vals[2]) / 2); // median of the four
  }
  // Safety: the averaged result can in rare cases violate the min gap; enforce it per layer in order.
  for (const layer of order) {
    for (let i = 1; i < layer.length; i++) {
      const need = result.get(layer[i - 1]) + sep;
      if (result.get(layer[i]) < need) result.set(layer[i], need);
    }
  }
  return result;
}

export function createLogicGraph({
  container,
  getItems,
  getDeviceEventList,
  getFieldConnections,
  getObjectMeta,
  getObjectIconUrl,
  catalog,
  onSelectNode,
  onFocusNode,
  getSelectedNodeIds,
  onClearSelection,
  onSelectGroup,
  getItemTags,
}) {
  const view = { scale: 1, tx: 0, ty: 0 };
  let selectedId = '';
  let fitted = false;
  let inner = null;
  let nodePositions = new Map();
  const itemById = new Map();

  const idOf = (ueObj) => `${ueObj.objectId}:${ueObj.deviceIndex}`;

  function deviceItems() {
    return (getItems() || []).filter(it => it?.ueObj && it.meta?.isDevice && it.ueObj.deviceIndex !== -1);
  }

  // Build the node set plus the two edge lists, keyed by "objectId:deviceIndex".
  function collectGraph() {
    itemById.clear();
    const nodeMap = new Map();
    for (const it of deviceItems()) {
      const id = idOf(it.ueObj);
      nodeMap.set(id, it);
      itemById.set(id, it);
    }

    const eventEdges = [];
    for (const g of (getDeviceEventList() || [])) {
      const s = g?.eventId?.deviceInstanceId;
      if (!s) continue;
      const sId = `${s.objectId}:${s.deviceIndex}`;
      for (const r of (g.relationEventId || [])) {
        const t = r?.deviceInstanceId;
        if (!t) continue;
        const tId = `${t.objectId}:${t.deviceIndex}`;
        if (nodeMap.has(sId) && nodeMap.has(tId)) {
          eventEdges.push({ sId, tId, label: `${g.eventId.eventName || ''} -> ${r.eventName || ''}` });
        }
      }
    }

    const fieldEdges = [];
    for (const { from, to } of (getFieldConnections() || [])) {
      if (!from?.ueObj || !to?.ueObj) continue;
      const sId = idOf(from.ueObj), tId = idOf(to.ueObj);
      if (nodeMap.has(sId) && nodeMap.has(tId)) fieldEdges.push({ sId, tId, label: 'device reference' });
    }
    return { nodeMap, eventEdges, fieldEdges };
  }

  // Group-based layout: split the devices into connected clusters (components over both edge kinds),
  // lay out each cluster on its own with a layered BFS, stack the clusters vertically inside a faint
  // group box, and drop the unconnected devices into a compact grid at the end. Edges only ever live
  // inside one cluster, so each box cleanly contains its own wiring.
  function layout(nodeMap, edges) {
    const outgoing = new Map(); // global degree maps (for the per-node in/out counts)
    const incoming = new Map();
    const adj = new Map();      // undirected adjacency, for component detection
    for (const id of nodeMap.keys()) { incoming.set(id, 0); adj.set(id, new Set()); }
    for (const { sId, tId } of edges) {
      if (!outgoing.has(sId)) outgoing.set(sId, new Set());
      outgoing.get(sId).add(tId);
      incoming.set(tId, (incoming.get(tId) || 0) + 1);
      if (!incoming.has(sId)) incoming.set(sId, 0);
      adj.get(sId)?.add(tId); adj.get(tId)?.add(sId);
    }

    // Connected components (undirected flood fill).
    const seen = new Set();
    const comps = [];
    for (const id of nodeMap.keys()) {
      if (seen.has(id)) continue;
      const comp = []; const stack = [id]; seen.add(id);
      while (stack.length) {
        const n = stack.pop(); comp.push(n);
        for (const m of adj.get(n) || []) if (!seen.has(m)) { seen.add(m); stack.push(m); }
      }
      comps.push(comp);
    }

    // Layered layout within one cluster, returning local positions (relative to 0,0) + size.
    function layoutComponent(comp) {
      const set = new Set(comp);
      // Directed adjacency within the cluster (event + field edges all point source -> target).
      const out = new Map(comp.map(id => [id, []]));
      for (const { sId, tId } of edges) {
        if (set.has(sId) && set.has(tId) && sId !== tId) out.get(sId).push(tId);
      }
      // Phase 1 - cycle removal: a DFS marks any edge to a node still on the stack as a "back" edge;
      // dropping those from layering makes a DAG so every other edge can point forward (left -> right).
      const state = new Map(); // 0 unseen, 1 on-stack, 2 done
      const back = new Set();
      const startDfs = (root) => {
        const st = [{ id: root, i: 0 }];
        state.set(root, 1);
        while (st.length) {
          const top = st[st.length - 1];
          const nbrs = out.get(top.id);
          if (top.i < nbrs.length) {
            const v = nbrs[top.i++];
            const s = state.get(v) || 0;
            if (s === 1) back.add(`${top.id} ${v}`);
            else if (s === 0) { state.set(v, 1); st.push({ id: v, i: 0 }); }
          } else { state.set(top.id, 2); st.pop(); }
        }
      };
      for (const id of comp) if ((state.get(id) || 0) === 0) startDfs(id);
      // Phase 2 - longest-path layering on the DAG: level(v) = max(level(pred) + 1), so edges run
      // forward and never backward (the few removed cycle edges are the only ones that curve back).
      const fout = new Map(comp.map(id => [id, []]));
      const indeg = new Map(comp.map(id => [id, 0]));
      for (const u of comp) for (const v of out.get(u)) {
        if (back.has(`${u} ${v}`)) continue;
        fout.get(u).push(v); indeg.set(v, indeg.get(v) + 1);
      }
      const levels = new Map(comp.map(id => [id, 0]));
      const ind = new Map(indeg);
      const queue = comp.filter(id => ind.get(id) === 0);
      while (queue.length) {
        const u = queue.shift();
        for (const v of fout.get(u)) {
          if (levels.get(v) < levels.get(u) + 1) levels.set(v, levels.get(u) + 1);
          ind.set(v, ind.get(v) - 1);
          if (ind.get(v) === 0) queue.push(v);
        }
      }
      const maxCol = Math.max(0, ...comp.map(id => levels.get(id) || 0));
      const columns = Array.from({ length: maxCol + 1 }, () => []);
      for (const id of comp) columns[levels.get(id) || 0].push(id); // initial order = BFS discovery order

      // Undirected neighbours, used to order rows so connected nodes sit close (crossing reduction).
      const nbr = new Map(comp.map(id => [id, []]));
      for (const { sId, tId } of edges) {
        if (!set.has(sId) || !set.has(tId)) continue;
        nbr.get(sId).push(tId);
        nbr.get(tId).push(sId);
      }
      // Barycenter heuristic: sweep down then up a few times, ordering each column by the average row
      // index of each node's neighbours in the adjacent column. Nodes with no neighbour there hold place.
      const reorder = (col, refCol) => {
        const refIdx = new Map(columns[refCol].map((id, i) => [id, i]));
        const bary = new Map(columns[col].map((id, i) => {
          const ns = nbr.get(id).filter(n => refIdx.has(n));
          return [id, ns.length ? ns.reduce((s, n) => s + refIdx.get(n), 0) / ns.length : i];
        }));
        columns[col] = [...columns[col]].sort((a, b) => bary.get(a) - bary.get(b));
      };
      for (let iter = 0; iter < 4; iter++) {
        if (iter % 2 === 0) for (let l = 1; l <= maxCol; l++) reorder(l, l - 1);
        else for (let l = maxCol - 1; l >= 0; l--) reorder(l, l + 1);
      }

      // Coordinate assignment via Brandes-Koepf: align nodes with their median adjacent-layer neighbour
      // (forming straight runs) while respecting the column order and the min row gap. Only edges between
      // adjacent columns can be straightened; longer/flat edges are left to curve.
      const above = new Map(comp.map(id => [id, []]));
      const below = new Map(comp.map(id => [id, []]));
      for (const { sId, tId } of edges) {
        if (!set.has(sId) || !set.has(tId)) continue;
        const ls = levels.get(sId) || 0, lt = levels.get(tId) || 0;
        if (Math.abs(ls - lt) !== 1) continue;
        const [lo, hi] = ls < lt ? [sId, tId] : [tId, sId];
        below.get(lo).push(hi);
        above.get(hi).push(lo);
      }
      const y = bkCoords(columns, above, below, ROW_GAP);

      let minY = Infinity, maxY = -Infinity;
      for (const v of y.values()) { minY = Math.min(minY, v); maxY = Math.max(maxY, v); }
      const local = new Map();
      for (const id of comp) local.set(id, { x: (levels.get(id) || 0) * COL_GAP, y: y.get(id) - minY });
      return { local, w: maxCol * COL_GAP + NODE_W, h: (maxY - minY) + NODE_H };
    }

    // Unique device tags (e.g. trigger/player tags) used anywhere within a group's devices, for display
    // in the group header.
    const tagsForIds = (ids) => {
      if (!getItemTags) return [];
      const set = new Set();
      for (const id of ids) {
        const item = nodeMap.get(id);
        if (!item) continue;
        for (const t of (getItemTags(item) || [])) set.add(t);
      }
      return [...set].sort((a, b) => a.localeCompare(b));
    };

    const positions = new Map();
    const groups = [];
    const multi = comps.filter(c => c.length > 1).sort((a, b) => b.length - a.length); // big clusters first
    const singles = comps.filter(c => c.length === 1).map(c => c[0]);

    let y = MARGIN;
    let maxRight = MARGIN + NODE_W;
    for (const comp of multi) {
      const { local, w, h } = layoutComponent(comp);
      for (const [id, p] of local) positions.set(id, { x: MARGIN + p.x, y: y + p.y });
      groups.push({ x: MARGIN - GROUP_PAD, y: y - GROUP_HEADER, w: w + GROUP_PAD * 2, h: h + GROUP_HEADER + GROUP_PAD, kind: 'cluster', ids: comp.slice(), tags: tagsForIds(comp) });
      maxRight = Math.max(maxRight, MARGIN + w);
      y += h + BAND_GAP;
    }

    if (singles.length) {
      const byObjectId = new Map();
      for (const id of singles) {
        const objectId = Number(nodeMap.get(id)?.ueObj?.objectId) || 0;
        if (!byObjectId.has(objectId)) byObjectId.set(objectId, []);
        byObjectId.get(objectId).push(id);
      }
      const looseGroups = [...byObjectId.entries()]
        .sort(([aId, aIds], [bId, bIds]) => bIds.length - aIds.length || aId - bId);
      for (const [objectId, ids] of looseGroups) {
        ids.sort((a, b) => a.localeCompare(b));
        const cols = Math.max(1, Math.min(SINGLE_COLS_MIN, Math.ceil(Math.sqrt(ids.length))));
        const rows = Math.ceil(ids.length / cols);
        ids.forEach((id, i) => {
          positions.set(id, { x: MARGIN + (i % cols) * COL_GAP, y: y + Math.floor(i / cols) * ROW_GAP });
        });
        const w = (cols - 1) * COL_GAP + NODE_W;
        const h = (rows - 1) * ROW_GAP + NODE_H;
        const meta = getObjectMeta(objectId);
        const label = `${meta?.name || `Device ${objectId}`} (${ids.length})`;
        groups.push({ x: MARGIN - GROUP_PAD, y: y - GROUP_HEADER, w: w + GROUP_PAD * 2, h: h + GROUP_HEADER + GROUP_PAD, kind: 'loose', label, ids: ids.slice(), tags: tagsForIds(ids) });
        maxRight = Math.max(maxRight, MARGIN + w);
        y += h + BAND_GAP;
      }
    }

    const width = maxRight + MARGIN;
    const height = (y - BAND_GAP) + MARGIN;
    return { positions, width, height, outgoing, incoming, groups };
  }

  function edgePath(a, b, yOffset = 0) {
    const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2 + yOffset;
    const x2 = b.x, y2 = b.y + NODE_H / 2 + yOffset;
    const mid = Math.max(32, Math.abs(x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2}`;
  }

  function nodeCard(id, item, pos, outCount, inCount) {
    const selectedIds = getSelectedNodeIds?.();
    const isSelected = id === selectedId || selectedIds?.has?.(id);
    const meta = getObjectMeta(item.ueObj.objectId);
    const dev = catalog?.devices?.[String(item.ueObj.objectId)];
    const name = item.ueObj.userDeviceName || meta.name;
    const sub = `${meta.name} - id ${item.ueObj.objectId} idx ${item.ueObj.deviceIndex}`;
    const iconUrl = getObjectIconUrl?.(item.ueObj.objectId) || '';
    const fallback = esc((meta.name || name || '?').slice(0, 1).toUpperCase());
    const icon = iconUrl
      ? `<span class="flow-node-icon"><img src="${esc(iconUrl)}" loading="lazy" alt=""></span>`
      : `<span class="flow-node-icon flow-node-icon-fallback">${fallback}</span>`;
    return `<button class="flow-node${isSelected ? ' selected' : ''}" data-node-id="${esc(id)}"
        style="left:${pos.x}px;top:${pos.y}px;width:${NODE_W}px;height:${NODE_H}px">
      ${icon}
      <span class="flow-node-main">
        <strong>${esc(name)}</strong>
        <span>${esc(sub)}</span>
        <span class="node-ports muted">
          <span>${(dev?.triggers?.length || 0)} triggers . ${(dev?.actions?.length || 0)} actions</span>
          <span>${inCount} in . ${outCount} out</span>
        </span>
      </span>
    </button>`;
  }

  function render() {
    if (!container) return;
    const { nodeMap, eventEdges, fieldEdges } = collectGraph();
    if (!nodeMap.size) {
      container.innerHTML = `<div class="empty-card" style="margin:24px"><strong>No devices placed</strong><div class="subtle">Place devices to see their logic graph.</div></div>`;
      inner = null;
      return;
    }
    const { positions, width, height, outgoing, incoming, groups } = layout(nodeMap, [...eventEdges, ...fieldEdges]);
    nodePositions = positions;

    // Map each device tag to every node (graph-wide, not just within one group) that uses it, so
    // clicking a tag in a group header can highlight/select all of its occurrences.
    const tagIndex = new Map();
    if (getItemTags) {
      for (const [id, item] of nodeMap) {
        for (const t of (getItemTags(item) || [])) {
          if (!tagIndex.has(t)) tagIndex.set(t, new Set());
          tagIndex.get(t).add(id);
        }
      }
    }

    const groupRects = groups.map(g => {
      const cls = g.kind === 'loose' ? 'flow-group flow-group-loose' : 'flow-group';
      const label = g.label ? `<text class="flow-group-label" x="${g.x + 88}" y="${g.y + 22}">${esc(g.label)}</text>` : '';
      return `<rect class="${cls}" x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="14"></rect>${label}`;
    }).join('');

    // SVG has pointer-events disabled (so panning works through it), so the per-tag controls are
    // plain HTML buttons overlaid on a second header row, like the existing group-select buttons.
    const groupTagRows = groups.map(g => {
      if (!g.tags?.length) return '';
      const chips = g.tags.map(t =>
        `<button class="flow-group-select flow-group-tag" type="button" data-tag="${esc(t)}"
            title="Select every node tagged '${esc(t)}'">${esc(t)}</button>`).join('');
      return `<div class="flow-group-tag-row" style="left:${g.x + 10}px;top:${g.y + 38}px;width:${g.w - 20}px">${chips}</div>`;
    }).join('');

    const drawEdges = (edges, cls, yOff) => edges.map(({ sId, tId, label }) => {
      const a = positions.get(sId), b = positions.get(tId);
      if (!a || !b) return '';
      // Relative to the selected node: outgoing (it is the source) vs incoming (it is the target).
      const dir = sId === selectedId ? ' sg-out' : (tId === selectedId ? ' sg-in' : '');
      return `<path class="flow-edge ${cls}${dir}" data-src="${esc(sId)}" data-tgt="${esc(tId)}" d="${edgePath(a, b, yOff)}"><title>${esc(label)}</title></path>`;
    }).join('');

    const nodes = [...nodeMap.keys()].map(id =>
      nodeCard(id, nodeMap.get(id), positions.get(id), outgoing.get(id)?.size || 0, incoming.get(id) || 0)
    ).join('');
    const groupButtons = groups.map((g, i) => {
      const count = g.ids?.length || 0;
      const label = g.kind === 'loose' ? 'Select' : 'Group';
      return `<button class="flow-group-select" type="button" data-group-idx="${i}"
          style="left:${g.x + 10}px;top:${g.y + 8}px"
          title="Select ${esc(label.toLowerCase())} (${count})">${esc(label)} <span>${count}</span></button>`;
    }).join('');

    container.innerHTML = `
      <div class="flow-inner" style="width:${width}px;height:${height}px">
        <svg class="flow-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">
          <defs>
            <marker id="sgArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill="context-stroke"></path></marker>
            <marker id="sgArrowDev" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M 0 0 L 7 3.5 L 0 7 z" fill="context-stroke"></path></marker>
          </defs>
          ${groupRects}${drawEdges(eventEdges, 'sg-event', 0)}${drawEdges(fieldEdges, 'device-link', 8)}
        </svg>
        ${groupButtons}
        ${groupTagRows}
        ${nodes}
      </div>`;
    inner = container.querySelector('.flow-inner');

    container.querySelectorAll('.flow-node').forEach(btn => {
      const id = btn.dataset.nodeId;
      btn.addEventListener('click', (e) => { e.stopPropagation(); selectedId = id; applySelection(); onSelectNode?.(itemById.get(id), id, e); });
      btn.addEventListener('dblclick', (e) => { e.stopPropagation(); onFocusNode?.(itemById.get(id)); });
    });
    container.querySelectorAll('.flow-group-select:not(.flow-group-tag)').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const ids = groups[Number(btn.dataset.groupIdx)]?.ids || [];
        selectedId = '';
        applySelection();
        onSelectGroup?.(ids, e);
      });
    });
    container.querySelectorAll('.flow-group-tag').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const ids = [...(tagIndex.get(el.dataset.tag) || [])];
        if (!ids.length) return;
        selectedId = '';
        applySelection();
        onSelectGroup?.(ids, e);
      });
    });

    applySelection(); // re-apply selected/neighbour highlight classes after the rebuild
    if (!fitted) { fit(width, height); fitted = true; }
    applyTransform();
  }

  function applyTransform() {
    if (inner) inner.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
  }

  function focusNodeId(id) {
    if (!id) return false;
    if (!inner || !nodePositions.has(id)) render();
    const pos = nodePositions.get(id);
    if (!pos) return false;
    const cw = container.clientWidth || 1;
    const ch = container.clientHeight || 1;
    view.scale = Math.max(view.scale, FOCUS_SCALE);
    view.tx = (cw / 2) - (pos.x + NODE_W / 2) * view.scale;
    view.ty = (ch / 2) - (pos.y + NODE_H / 2) * view.scale;
    applyTransform();
    return true;
  }

  function fit(width, height) {
    const cw = container.clientWidth || 1, ch = container.clientHeight || 1;
    view.scale = Math.min(1, Math.max(0.2, Math.min(cw / width, ch / height) * 0.92));
    view.tx = Math.max(0, (cw - width * view.scale) / 2);
    view.ty = Math.max(MARGIN, (ch - height * view.scale) / 2);
  }

  function applySelection() {
    // Colour the selected node's edges and remember which nodes they reach, so those neighbours can be
    // outlined to match: in-neighbours (feed it) orange, out-neighbours (it drives) green.
    const inNodes = new Set(), outNodes = new Set();
    const selectedIds = getSelectedNodeIds?.();
    container.querySelectorAll('.flow-edge').forEach(p => {
      const isOut = Boolean(selectedId) && p.dataset.src === selectedId; // node drives these
      const isIn = Boolean(selectedId) && p.dataset.tgt === selectedId;  // these feed the node
      p.classList.toggle('sg-out', isOut);
      p.classList.toggle('sg-in', isIn);
      if (isOut) outNodes.add(p.dataset.tgt);
      if (isIn) inNodes.add(p.dataset.src);
    });
    container.querySelectorAll('.flow-node').forEach(n => {
      const id = n.dataset.nodeId;
      n.classList.toggle('selected', id === selectedId || selectedIds?.has?.(id));
      n.classList.toggle('sg-in-node', id !== selectedId && inNodes.has(id));
      n.classList.toggle('sg-out-node', id !== selectedId && outNodes.has(id));
    });
  }

  // --- pan + zoom -------------------------------------------------------------------------------
  let panning = false, panStart = null;
  container.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.flow-node, .flow-group-select, .flow-group-tag')) return;
    panning = true; panStart = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    container.setPointerCapture(e.pointerId);
  });
  container.addEventListener('pointermove', (e) => {
    if (!panning) return;
    view.tx = panStart.tx + (e.clientX - panStart.x);
    view.ty = panStart.ty + (e.clientY - panStart.y);
    applyTransform();
  });
  container.addEventListener('pointerup', (e) => {
    if (panning && panStart) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      if (Math.hypot(dx, dy) < 4 && !e.target.closest('.flow-node, .flow-group-select, .flow-group-tag')) {
        selectedId = '';
        applySelection();
        onClearSelection?.(e);
      }
    }
    panning = false;
  });
  const endPan = () => { panning = false; };
  container.addEventListener('pointercancel', endPan);
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const next = Math.min(3, Math.max(0.1, view.scale * factor));
    const ratio = next / view.scale;
    view.tx = cx - (cx - view.tx) * ratio;
    view.ty = cy - (cy - view.ty) * ratio;
    view.scale = next;
    applyTransform();
  }, { passive: false });

  return {
    render,
    setSelected(item) {
      selectedId = item?.ueObj ? idOf(item.ueObj) : '';
      applySelection();
    },
    focusNode(itemOrId) {
      const id = typeof itemOrId === 'string'
        ? itemOrId
        : (itemOrId?.ueObj ? idOf(itemOrId.ueObj) : selectedId);
      if (id) selectedId = id;
      applySelection();
      return focusNodeId(id);
    },
    resetView() { fitted = false; },
    setSelectedIds(ids, options = {}) {
      if (!options.keepFocused) selectedId = '';
      const selectedIds = ids instanceof Set ? ids : new Set(ids || []);
      container.querySelectorAll('.flow-node').forEach(n => n.classList.toggle('selected', selectedIds.has(n.dataset.nodeId)));
      applySelection();
    },
  };
}
