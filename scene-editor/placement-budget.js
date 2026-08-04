import { cleanCategoryKey } from './catalog-utils.js';

function placementBudgetRules(placementBudget) {
  const rules = Array.isArray(placementBudget?.rules) ? placementBudget.rules : [];
  return rules.length ? rules : [{ key: 'total', label: 'Total', match: 'all' }];
}

function budgetCatalogEntry(objectId, catalog) {
  return catalog.objects[String(objectId)] || catalog.devices[String(objectId)] || null;
}

function objectBudgetMeta(objectId, catalog) {
  const entry = budgetCatalogEntry(objectId, catalog);
  const isDevice = Boolean(catalog.devices[String(objectId)]);
  const weight = Number(entry?.spawnWeight ?? entry?.SpawnWeight ?? 1);
  return {
    objectId: Number(objectId),
    entry,
    objectType: isDevice ? 'Device' : cleanCategoryKey(entry?.objectType),
    subCategory: cleanCategoryKey(entry?.subCategory),
    weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
  };
}

function budgetRuleMatches(rule, meta) {
  if (rule.match === 'all') return true;
  if (rule.objectType && rule.objectType !== meta.objectType) return false;
  if (rule.subCategory && rule.subCategory !== meta.subCategory) return false;
  if (Number.isFinite(rule.objectId) && Number(rule.objectId) !== meta.objectId) return false;
  return true;
}

export function computePlacementBudgetRows(objects, catalog) {
  const rows = placementBudgetRules(catalog.placementBudget).map(rule => ({ ...rule, count: 0, weighted: 0 }));
  for (const obj of objects || []) {
    const meta = objectBudgetMeta(obj.objectId, catalog);
    for (const row of rows) {
      if (!budgetRuleMatches(row, meta)) continue;
      row.count++;
      row.weighted += meta.weight;
    }
  }
  return rows;
}
