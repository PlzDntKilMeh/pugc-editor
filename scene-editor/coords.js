import * as THREE from 'three';

export const MIN_OBJECT_SCALE = 0.1;

let _transPrecision = null;
let _rotPrecision = null;
let _mode = 'round';     // shared rounding mode for both translation and rotation decimals
let _rotFormat = 'quat'; // 'quat' | 'euler'
let _rotSnapDeg = 0;     // 0 = off; snap to nearest N degrees (always nearest)

export function setPrecisionTest({ translation = null, rotation = null, mode = 'round', rotFormat = 'quat', rotSnapDeg = 0 } = {}) {
  _transPrecision = translation;
  _rotPrecision = rotation;
  _mode = mode;
  _rotFormat = rotFormat;
  _rotSnapDeg = rotSnapDeg;
}

function applyPrec(v, precision, mode) {
  if (precision === null || !Number.isFinite(precision)) return v;
  const f = 10 ** precision;
  switch (mode) {
    case 'floor': return Math.floor(v * f) / f;
    case 'ceil':  return Math.ceil(v * f) / f;
    case 'trunc': return Math.trunc(v * f) / f;
    default:      return Math.round(v * f) / f;
  }
}

export function ue4PosToThree(t) {
  return new THREE.Vector3(t.x / 100, t.z / 100, t.y / 100);
}

export function ue4QuatToThree(q) {
  // det(T)=-1 mapping conjugation negates the vector part.
  return new THREE.Quaternion(-q.x, -q.z, -q.y, q.w);
}

export function ue4ScaleToThree(s) {
  return new THREE.Vector3(s.x, s.z, s.y);
}

export function threePosToUe4(v) {
  const p = (n) => applyPrec(n, _transPrecision, _mode);
  return { x: p(v.x * 100), y: p(v.z * 100), z: p(v.y * 100) };
}

export function threeQuatToUe4(q) {
  if (_rotSnapDeg > 0 || _rotFormat === 'euler') {
    const euler = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    const processAngle = (rad) => {
      const deg = THREE.MathUtils.radToDeg(rad);
      if (_rotSnapDeg > 0) return THREE.MathUtils.degToRad(Math.round(deg / _rotSnapDeg) * _rotSnapDeg);
      return THREE.MathUtils.degToRad(applyPrec(deg, _rotPrecision, _mode));
    };
    const eq = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(processAngle(euler.x), processAngle(euler.y), processAngle(euler.z), 'YXZ')
    );
    return { x: -eq.x, y: -eq.z, z: -eq.y, w: eq.w };
  }
  const p = (n) => applyPrec(n, _rotPrecision, _mode);
  return { x: p(-q.x), y: p(-q.z), z: p(-q.y), w: p(q.w) };
}

export function threeScaleToUe4(s) {
  return { x: s.x, y: s.z, z: s.y };
}

export function clampObjectScaleValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(MIN_OBJECT_SCALE, n) : MIN_OBJECT_SCALE;
}

export function clampUeScale3D(s = {}) {
  return {
    x: clampObjectScaleValue(s.x ?? 1),
    y: clampObjectScaleValue(s.y ?? 1),
    z: clampObjectScaleValue(s.z ?? 1),
  };
}

export function clampThreeScale(v) {
  v.set(
    clampObjectScaleValue(v.x),
    clampObjectScaleValue(v.y),
    clampObjectScaleValue(v.z)
  );
  return v;
}

export function multiplyScale3D(a, b) {
  return clampUeScale3D({
    x: Number(a?.x ?? 1) * Number(b?.x ?? 1),
    y: Number(a?.y ?? 1) * Number(b?.y ?? 1),
    z: Number(a?.z ?? 1) * Number(b?.z ?? 1),
  });
}
