export function escHtml(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function fmt1(n) {
  return typeof n === 'number' ? n.toFixed(1) : String(n);
}

export function formatTransformNumber(value, precision = 3) {
  if (!Number.isFinite(value)) return '';
  return value.toFixed(precision).replace(/\.?0+$/, '');
}

export function setNumericInputValue(id, value, precision = 3, force = false) {
  const el = document.getElementById(id);
  if (!el || (!force && document.activeElement === el)) return;
  el.value = formatTransformNumber(Number(value), precision);
}
