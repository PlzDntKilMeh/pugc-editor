import * as THREE from 'three';

export function applyFlyMovement({ camera, orbitControls, flyKeys, flySpeed }) {
  if (!flyKeys.size) return;
  const dist = camera.position.distanceTo(orbitControls.target);
  const speed = Math.max(dist * 0.02, 0.5) * flySpeed * (flyKeys.has('shift') ? 5 : 1);

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);

  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  const up = new THREE.Vector3(0, 1, 0);

  const delta = new THREE.Vector3();
  if (flyKeys.has('w')) delta.addScaledVector(forward, speed);
  if (flyKeys.has('s')) delta.addScaledVector(forward, -speed);
  if (flyKeys.has('a')) delta.addScaledVector(right, -speed);
  if (flyKeys.has('d')) delta.addScaledVector(right, speed);
  if (flyKeys.has('q')) delta.addScaledVector(up, -speed);
  if (flyKeys.has('e')) delta.addScaledVector(up, speed);

  camera.position.add(delta);
  orbitControls.target.add(delta);
}

export function formatFlySpeed(flySpeed) {
  const value = flySpeed < 1
    ? flySpeed.toFixed(2)
    : (flySpeed < 10 ? flySpeed.toFixed(1) : Math.round(flySpeed));
  return `${value}x`;
}

export function updateFpsHud(state, el, now = performance.now()) {
  state.frameCount++;
  const elapsed = now - state.lastTime;
  if (elapsed < 500) return;
  state.displayValue = Math.round((state.frameCount * 1000) / elapsed);
  state.frameCount = 0;
  state.lastTime = now;
  if (el) el.textContent = String(state.displayValue);
}
