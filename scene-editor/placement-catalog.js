import {
  catalogLabel,
  categoryLabel,
  placementCategoryKey,
  placementCategoryRank,
} from './catalog-utils.js';

export function buildPlacementRows(catalog) {
  return [
    ...Object.values(catalog.objects).map(entry => ({ ...entry, kind: 'Object' })),
    ...Object.values(catalog.devices).map(entry => ({ ...entry, kind: 'Device' })),
  ].map(entry => {
    const category = placementCategoryKey(entry);
    const label = catalogLabel(entry);
    const typeName = String(entry.rowName || entry.displayKey || entry.name || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    return {
      ...entry,
      category,
      categoryLabel: categoryLabel(category),
      label,
      searchText: [
        entry.objectId,
        label,
        entry.name,
        entry.rowName,
        entry.displayKey,
        typeName,
        entry.namespace,
        category,
      ].filter(v => v != null && v !== '').join(' ').toLowerCase(),
    };
  }).sort((a, b) =>
    placementCategoryRank(a.category) - placementCategoryRank(b.category) ||
    a.label.localeCompare(b.label) ||
    Number(a.objectId) - Number(b.objectId)
  );
}

export function placementCategories(placementRows) {
  return [...new Set(placementRows.map(r => r.category))]
    .sort((a, b) => placementCategoryRank(a) - placementCategoryRank(b) || categoryLabel(a).localeCompare(categoryLabel(b)));
}

export function selectedCatalogValue(catalog, objectId) {
  const entry = catalog.objects[String(objectId)] || catalog.devices[String(objectId)];
  return entry ? `${entry.objectId} | ${catalogLabel(entry)} | ${catalog.devices[String(objectId)] ? 'Device' : 'Object'}` : String(objectId);
}
