// Logic tests for the parts of the app that are pure math: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createYawTracker, distanceFromTap, focalPx, offsetForDepression, poseFromUp } from '../src/lib/arGeometry';
import { crossing, depthFt, formatDepth, localClock, scenarios, series, stageAt, stepHours, THRESHOLDS } from '../src/lib/flood';
import { hash } from '../src/lib/labels';

test('scenarios are well formed', () => {
  assert.equal(scenarios.length, 4);
  for (const sc of scenarios) {
    assert.ok(sc.hours.length > 10, sc.id);
    assert.equal(sc.stage_ft.length, sc.hours.length, `${sc.id} stage length`);
    assert.ok(sc.peak_ft > sc.baseline_ft, `${sc.id} rises`);
    for (const lead of ['1', '3', '6']) {
      const f = sc.forecast?.by_lead?.[lead];
      if (f) assert.equal(series(sc, 'forecast', Number(lead)).length, sc.hours.length, `${sc.id} forecast ${lead}`);
    }
  }
});

test('stage interpolation holds the last reading over gaps and stays in bounds', () => {
  const sc = scenarios[0];
  const v = sc.stage_ft;
  assert.equal(stageAt(v, 0), v[0]);
  assert.equal(stageAt(v, -5), v[0]);
  const last = [...v].reverse().find(x => x != null)!;
  assert.equal(stageAt(v, 1e6), last);
});

test('depth and threshold crossings agree', () => {
  const sc = scenarios[0];
  const ground = 20;
  const wet = crossing(sc.stage_ft, sc, ground, 0.01);
  const knee = crossing(sc.stage_ft, sc, ground, 1.7);
  assert.ok(wet != null && knee != null && knee >= wet);
  assert.ok(Math.abs(depthFt(stageAt(sc.stage_ft, knee!), sc, ground) - 1.7) < 0.05);
  assert.equal(depthFt(null, sc, ground), 0);
  assert.ok(THRESHOLDS.every((th, i) => i === 0 || th.ft > THRESHOLDS[i - 1].ft));
});

test('replay clock matches the real USGS readings', () => {
  // Kerrville peaked at 34.29 ft at 6:30 AM CDT on Jul 4 2025 (USGS 08166200)
  const k = scenarios.find(s => s.id === 'kerrville_2025')!;
  assert.equal(stepHours(k), 0.25);
  const v = k.stage_ft;
  const peak = v.reduce((m, x, i) => (x != null && x > (v[m] ?? -1) ? i : m), 0);
  assert.equal(v[peak], 34.29);
  assert.equal(localClock(k, peak).time, '6:30 AM');
});

test('formatting', () => {
  assert.equal(formatDepth(0), 'Dry');
  assert.equal(formatDepth(0.5), '6 in');
  assert.equal(formatDepth(2.25), '2 ft 3 in');
  assert.match(localClock(scenarios[0], 0).time, /^\d{1,2}:\d{2} (AM|PM)$/);
});

test('camera geometry: a tapped ground point round-trips to its distance', () => {
  const pose = poseFromUp({ x: 0, y: Math.cos(-0.25), z: -Math.sin(-0.25) });
  const f = focalPx(390, 500, 69);
  for (const d of [2, 4, 8, 15]) {
    const off = offsetForDepression(Math.atan(1.4 / d), pose, f);
    assert.ok(Math.abs(distanceFromTap(off, pose, f, 1.4)! - d) < 0.01, `distance ${d}`);
  }
  // pointing at or above the horizon gives no distance
  assert.equal(distanceFromTap(-200, pose, f, 1.4), null);
});

test('yaw tracker calibrates units and sign from tilting', () => {
  for (const [unit, sign] of [[Math.PI / 180, 1], [Math.PI / 180, -1], [1, 1], [1, -1]] as const) {
    const tr = createYawTracker();
    let pitch = 0;
    let yawTrue = 0;
    for (let i = 0; i < 400; i++) {
      const t = i * 0.02;
      const pRate = t < 4 ? 0.35 * Math.PI * Math.cos(Math.PI * t) : 0;
      const yRate = t >= 4 ? (30 * Math.PI) / 180 / 4 : 0;
      pitch += pRate * 0.02;
      yawTrue += yRate * 0.02;
      const up = { x: 0, y: Math.cos(pitch), z: -Math.sin(pitch) };
      const rate = { x: pRate + yRate * up.x, y: yRate * up.y, z: yRate * up.z };
      tr.update(up, { x: (sign * rate.x) / unit, y: (sign * rate.y) / unit, z: (sign * rate.z) / unit }, poseFromUp(up), 0.02);
    }
    assert.ok(Math.abs(tr.yaw - yawTrue) < 0.02, `unit ${unit} sign ${sign}: ${tr.yaw} vs ${yawTrue}`);
  }
});

test('label order is deterministic', () => {
  assert.equal(hash('TX001_2017_NOAA'), hash('TX001_2017_NOAA'));
  assert.notEqual(hash('a'), hash('b'));
});
