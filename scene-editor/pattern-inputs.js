const CIRCLE_RANGE_LIMITS = {
  circleDiameterSlider: { min: 0.5, max: 2000 },
  circleCountSlider: { min: 3, max: 1000 },
};

export function formatCircleNumber(value, precision = 1) {
  if (!Number.isFinite(value)) return '';
  const s = value.toFixed(precision);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

export function circleSliderToNumber(rangeId) {
  const range = document.getElementById(rangeId);
  const limits = CIRCLE_RANGE_LIMITS[rangeId];
  if (!range || !limits) return 0;
  const sliderMin = Number(range.min || 0);
  const sliderMax = Number(range.max || 10000);
  const t = Math.max(0, Math.min(1, (Number(range.value) - sliderMin) / (sliderMax - sliderMin)));
  return limits.min * Math.pow(limits.max / limits.min, t);
}

export function syncCircleRange(rangeId, value) {
  const range = document.getElementById(rangeId);
  const limits = CIRCLE_RANGE_LIMITS[rangeId];
  if (!range || !limits || !Number.isFinite(value)) return;
  const sliderMin = Number(range.min || 0);
  const sliderMax = Number(range.max || 10000);
  const clamped = Math.max(limits.min, Math.min(limits.max, value));
  const t = Math.log(clamped / limits.min) / Math.log(limits.max / limits.min);
  range.value = String(Math.round(sliderMin + t * (sliderMax - sliderMin)));
}

export function circleInputPrecision(id) {
  if (String(id).includes('Scale')) return 3;
  if (String(id).includes('RadialStep') || String(id).includes('HeightStep')) return 2;
  return 1;
}

export function setInputValue(id, value, precision = circleInputPrecision(id)) {
  const el = document.getElementById(id);
  if (el) el.value = formatCircleNumber(value, precision);
}

export function syncLinearRange(rangeId, value) {
  const range = document.getElementById(rangeId);
  if (!range || !Number.isFinite(value)) return;
  const min = Number(range.min || 0);
  const max = Number(range.max || 100);
  range.value = String(Math.max(min, Math.min(max, value)));
}
