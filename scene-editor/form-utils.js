export function setPathValue(target, dottedPath, value) {
  const parts = String(dottedPath || '').split('.').filter(Boolean);
  if (!parts.length) return;
  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] ??= {};
    cur = cur[parts[i]];
  }
  cur[parts.at(-1)] = value;
}

export function sanitizeNumericText(value, integerOnly = false) {
  let out = '';
  let dot = false;
  for (const ch of String(value || '')) {
    if (ch >= '0' && ch <= '9') {
      out += ch;
    } else if (!integerOnly && ch === '.' && !dot) {
      out += ch;
      dot = true;
    } else if (!integerOnly && ch === '-' && out.length === 0) {
      out += ch;
    }
  }
  return out;
}

export function numericInputValue(id, fallback = 0) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const cleaned = sanitizeNumericText(el.value, el.dataset.integer === 'true');
  if (el.value !== cleaned) el.value = cleaned;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

export function bindNumericInput(el) {
  el.addEventListener('beforeinput', e => {
    const integerOnly = el.dataset.integer === 'true';
    if (!e.data || (integerOnly ? /^[0-9]+$/ : /^[0-9.-]+$/).test(e.data)) return;
    e.preventDefault();
  });
  el.addEventListener('input', () => {
    el.value = sanitizeNumericText(el.value, el.dataset.integer === 'true');
  });
}

// Binds a <input type="range"> slider to a paired numeric input: on 'input'/'change',
// formats the slider's value into the input (via formatValue) and calls onApply.
export function bindSliderInputPair(sliderId, inputId, formatValue, onApply) {
  const slider = document.getElementById(sliderId);
  const input = document.getElementById(inputId);
  const handler = () => {
    if (input) input.value = formatValue(slider, input);
    onApply();
  };
  slider?.addEventListener('input', handler);
  slider?.addEventListener('change', handler);
}
