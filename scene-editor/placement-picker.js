import {
  categoryLabel,
  placementCategoryRank,
  placementIconUrl,
} from './catalog-utils.js';
import { escHtml } from './text-utils.js';

export function renderPlacementPicker({
  categoryList,
  grid,
  placementRows,
  placementCategory,
  selectedId,
  query,
  onCategoryChange,
  onObjectSelect,
}) {
  if (!categoryList || !grid) return;

  const categories = [...new Set(placementRows.map(r => r.category))]
    .sort((a, b) => placementCategoryRank(a) - placementCategoryRank(b) || categoryLabel(a).localeCompare(categoryLabel(b)));

  categoryList.innerHTML = categories.map(category => {
    const count = placementRows.filter(r => r.category === category).length;
    const active = category === placementCategory ? ' active' : '';
    return `<button class="place-category${active}" type="button" data-category="${escHtml(category)}">${escHtml(categoryLabel(category))}<span>${count}</span></button>`;
  }).join('');

  const rows = query
    ? placementRows.filter(entry => entry.searchText.includes(query))
    : placementRows.filter(entry => entry.category === placementCategory);

  grid.innerHTML = rows.length ? rows.map(entry => {
    const active = Number(entry.objectId) === selectedId ? ' active' : '';
    const img = placementIconUrl(entry);
    return `<button class="place-object-card${active}" type="button" data-object-id="${entry.objectId}">
      <span class="place-object-thumb">${img ? `<img src="${escHtml(img)}" loading="lazy" alt="">` : `<span>${escHtml(String(entry.label || '?').slice(0, 1))}</span>`}</span>
      <span class="place-object-text">
        <span class="place-object-name">${escHtml(entry.label)}</span>
        <span class="place-object-meta">${escHtml(entry.kind)} ${entry.objectId}</span>
      </span>
    </button>`;
  }).join('') : `<div class="place-object-empty">No matches${query ? '' : ` in ${escHtml(categoryLabel(placementCategory))}`}</div>`;

  categoryList.querySelectorAll('.place-category').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      onCategoryChange(btn.dataset.category || placementCategory);
    });
  });
  grid.querySelectorAll('.place-object-card').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      onObjectSelect(Number(btn.dataset.objectId));
    });
  });
}
