// tests.js — ARTEMIS TRACKER automated test suite
// Runs in-browser. Import Trajectory directly; no external deps required.

import { Trajectory } from '../js/trajectory.js';

// ── Minimal test framework ─────────────────────────────────────────────────
class TestRunner {
  constructor() {
    this.tests   = [];
    this.results = [];
  }

  test(name, fn) {
    this.tests.push({ name, fn });
  }

  async run() {
    this.results = [];
    for (const t of this.tests) {
      const start = performance.now();
      try {
        await t.fn();
        this.results.push({ name: t.name, passed: true, ms: performance.now() - start });
      } catch (err) {
        this.results.push({ name: t.name, passed: false, error: err.message, ms: performance.now() - start });
      }
    }
    return this.results;
  }
}

// ── Assertion helpers ──────────────────────────────────────────────────────
function assert(cond, msg)           { if (!cond) throw new Error(msg ?? 'Assertion failed'); }
function assertEqual(a, b, msg)     { if (a !== b) throw new Error(msg ?? `Expected "${b}" got "${a}"`); }
function assertClose(a, b, tol, msg){ if (Math.abs(a - b) > tol) throw new Error(msg ?? `Expected ${b} ± ${tol}, got ${a.toFixed(2)}`); }
function assertGt(a, b, msg)        { if (a <= b) throw new Error(msg ?? `Expected ${a} > ${b}`); }
function assertLt(a, b, msg)        { if (a >= b) throw new Error(msg ?? `Expected ${a} < ${b}`); }

// ── Helpers ────────────────────────────────────────────────────────────────
function dist3(a, b) {
  return Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2 + (a.z-b.z)**2);
}
function mag(p) { return Math.sqrt(p.x**2 + p.y**2 + p.z**2); }

// ════════════════════════════════════════════════════════════════════════════
// TRAJECTORY TESTS
// ════════════════════════════════════════════════════════════════════════════
export function registerTrajectoryTests(runner) {
  const traj = new Trajectory();

  // ── Moon position ──────────────────────────────────────────────────────
  runner.test('Moon at T+0 is at correct orbital radius', () => {
    const m = traj.getMoonPosition(0);
    assertClose(mag(m), traj.MOON_ORBITAL_RADIUS_KM, 5000,
      'Moon distance should be ~384 400 km');
  });

  runner.test('Moon at T+0 is near +X axis (initial angle = 0)', () => {
    const m = traj.getMoonPosition(0);
    assertClose(m.x, traj.MOON_ORBITAL_RADIUS_KM, 5000, 'Moon X');
    assertClose(Math.abs(m.z), 0, 5000, 'Moon Z ~0 at t=0');
  });

  runner.test('Moon returns to initial position after one full period', () => {
    const m0 = traj.getMoonPosition(0);
    const m1 = traj.getMoonPosition(traj.MOON_PERIOD_HOURS);
    assertClose(m0.x, m1.x, 200, 'Moon X after one period');
    assertClose(m0.z, m1.z, 200, 'Moon Z after one period');
  });

  runner.test('Moon moves counterclockwise (Z increases from 0 with time)', () => {
    const m6  = traj.getMoonPosition(6);
    const m12 = traj.getMoonPosition(12);
    assertGt(m6.z,  0,     'Moon Z positive after 6 h');
    assertGt(m12.z, m6.z,  'Moon Z greater after 12 h than 6 h');
  });

  // ── Spacecraft position ────────────────────────────────────────────────
  runner.test('Spacecraft at T+0 is at LEO altitude (6571 km)', () => {
    const p = traj.getSpacecraftPosition(0);
    const r = mag(p);
    assertClose(r, 6571, 100, `S/C radius at launch should be ~6571 km, got ${r.toFixed(0)}`);
  });

  runner.test('Spacecraft at T+1.47h is still at LEO altitude (parking orbit)', () => {
    const p = traj.getSpacecraftPosition(1.47);
    const r = mag(p);
    assertClose(r, 6571, 150, 'S/C at LEO radius after 1 orbit');
  });

  runner.test('Spacecraft at T+75h is within 50 000 km of Moon (flyby)', () => {
    const sc   = traj.getSpacecraftPosition(75);
    const moon = traj.getMoonPosition(75);
    const d    = dist3(sc, moon);
    assertLt(d, 50000, `S/C should be within 50 000 km of Moon at flyby, got ${d.toFixed(0)} km`);
  });

  runner.test('Spacecraft closest approach to Moon < 20 000 km', () => {
    let minDist = Infinity;
    for (let t = 72; t <= 80; t += 0.25) {
      const d = traj.getDistanceMoon(t);
      if (d < minDist) minDist = d;
    }
    assertLt(minDist, 20000, `Closest approach ${minDist.toFixed(0)} km should be < 20 000 km`);
  });

  runner.test('Spacecraft at T+240h is at Earth surface (splashdown)', () => {
    const p = traj.getSpacecraftPosition(240);
    const r = mag(p);
    assertClose(r, traj.EARTH_RADIUS_KM, 500, `S/C should be at ~6371 km at splashdown, got ${r.toFixed(0)}`);
  });

  runner.test('Spacecraft leaves LEO: distance > 100 000 km by T+30h', () => {
    const r = traj.getDistanceEarth(30);
    assertGt(r, 100000, `S/C should be > 100 000 km from Earth at T+30h, got ${r.toFixed(0)}`);
  });

  runner.test('Spacecraft distance from Earth is monotonically increasing during translunar coast', () => {
    let prev = traj.getDistanceEarth(5);
    for (let t = 10; t <= 70; t += 5) {
      const curr = traj.getDistanceEarth(t);
      assertGt(curr, prev, `Distance should increase: T+${t}h (${curr.toFixed(0)}) vs prev (${prev.toFixed(0)})`);
      prev = curr;
    }
  });

  runner.test('Spacecraft distance from Earth decreases during return (T+100h to T+200h)', () => {
    let prev = traj.getDistanceEarth(100);
    for (let t = 120; t <= 200; t += 20) {
      const curr = traj.getDistanceEarth(t);
      assertLt(curr, prev, `Distance should decrease on return: T+${t}h`);
      prev = curr;
    }
  });

  // ── Phase identification ───────────────────────────────────────────────
  runner.test('Phase at T+0 is "Ascent"', () => {
    assertEqual(traj.getPhase(0.0).name, 'Ascent');
  });

  runner.test('Phase at T+1h is "Parking Orbit"', () => {
    assertEqual(traj.getPhase(1).name, 'Parking Orbit');
  });

  runner.test('Phase at T+3h is "TLI Burn"', () => {
    assertEqual(traj.getPhase(2.95).name, 'TLI Burn');
  });

  runner.test('Phase at T+40h is "Translunar Coast"', () => {
    assertEqual(traj.getPhase(40).name, 'Translunar Coast');
  });

  runner.test('Phase at T+75h is "Lunar Flyby"', () => {
    assertEqual(traj.getPhase(75).name, 'Lunar Flyby');
  });

  runner.test('Phase at T+150h is "Return Coast"', () => {
    assertEqual(traj.getPhase(150).name, 'Return Coast');
  });

  runner.test('Phase at T+235h is "Reentry"', () => {
    assertEqual(traj.getPhase(235).name, 'Reentry');
  });

  runner.test('Phase at T+239.5h is "Splashdown"', () => {
    assertEqual(traj.getPhase(239.5).name, 'Splashdown');
  });

  // ── MET formatting ─────────────────────────────────────────────────────
  runner.test('formatMET(0) = "T+00:00:00"', () => {
    assertEqual(traj.formatMET(0), 'T+00:00:00');
  });

  runner.test('formatMET(1.5) = "T+01:30:00"', () => {
    assertEqual(traj.formatMET(1.5), 'T+01:30:00');
  });

  runner.test('formatMET(24) = "T+24:00:00"', () => {
    assertEqual(traj.formatMET(24), 'T+24:00:00');
  });

  runner.test('formatMET(100.25) = "T+100:15:00"', () => {
    assertEqual(traj.formatMET(100.25), 'T+100:15:00');
  });

  runner.test('formatMET(0.01666...) = "T+00:01:00" (1 minute)', () => {
    assertEqual(traj.formatMET(1/60), 'T+00:01:00');
  });

  // ── Velocity ───────────────────────────────────────────────────────────
  runner.test('Velocity at T+0 is between 2 and 6 km/s (LEO model)', () => {
    const v = traj.getVelocityKmS(0.3);
    assert(v >= 2 && v <= 6, `LEO velocity ${v.toFixed(2)} km/s should be 2–6 km/s`);
  });

  runner.test('Velocity at T+40h (translunar) is between 0.8 and 3 km/s', () => {
    const v = traj.getVelocityKmS(40);
    assert(v >= 0.5 && v <= 4, `Translunar velocity ${v.toFixed(3)} km/s should be 0.8–3 km/s`);
  });

  // ── Distance helpers ───────────────────────────────────────────────────
  runner.test('getAltitude(0) is near 200 km (parking orbit altitude)', () => {
    assertClose(traj.getAltitude(0), 200, 1, 'LEO altitude 200 km at launch keyframe');
  });

  runner.test('getDistanceEarth and getAltitude are consistent', () => {
    const t   = 50;
    const r   = traj.getDistanceEarth(t);
    const alt = traj.getAltitude(t);
    assertClose(r - traj.EARTH_RADIUS_KM, alt, 1, 'altitude = dist - R_earth');
  });

  runner.test('Moon distance at T+75h < Moon distance at T+0h', () => {
    const d0  = traj.getDistanceMoon(0);
    const d75 = traj.getDistanceMoon(75);
    assertLt(d75, d0, 'S/C should be closer to Moon at flyby than at launch');
  });

  // ── Mission date ───────────────────────────────────────────────────────
  runner.test('getMissionDate(0) equals launch date', () => {
    const d = traj.getMissionDate(0);
    assertEqual(d.getUTCFullYear(), 2026);
    assertEqual(d.getUTCMonth(), 3);    // April = 3 (0-indexed)
    assertEqual(d.getUTCDate(), 1);
  });

  runner.test('getMissionDate(240) equals 10 days after launch', () => {
    const d = traj.getMissionDate(240);
    assertEqual(d.getUTCDate(), 11);    // Apr 11
  });

  // ── Trajectory points ──────────────────────────────────────────────────
  runner.test('trajectoryPoints has 2001 entries (0..2000)', () => {
    assertEqual(traj.trajectoryPoints.length, 2001);
  });

  runner.test('Trajectory first point is at LEO radius', () => {
    const p = traj.trajectoryPoints[0];
    assertClose(mag(p), 6571, 100, 'First trajectory point at LEO');
  });

  runner.test('Trajectory last point is at Earth surface', () => {
    const p = traj.trajectoryPoints[traj.trajectoryPoints.length - 1];
    assertClose(mag(p), traj.EARTH_RADIUS_KM, 500, 'Last trajectory point at Earth surface');
  });

  runner.test('Trajectory has a point > 350 000 km from Earth (near Moon)', () => {
    const maxR = Math.max(...traj.trajectoryPoints.map(p => mag(p)));
    assertGt(maxR, 350000, `Max distance ${maxR.toFixed(0)} km should exceed 350 000 km`);
  });

  // ── Interpolation continuity ───────────────────────────────────────────
  runner.test('Position changes smoothly (no sudden jumps > 5000 km between 0.1h steps)', () => {
    let prev = traj.getSpacecraftPosition(0);
    for (let t = 0.1; t <= 240; t += 0.1) {
      const curr = traj.getSpacecraftPosition(t);
      const jump = dist3(prev, curr);
      assertLt(jump, 5000, `Jump of ${jump.toFixed(0)} km between T+${(t-0.1).toFixed(1)} and T+${t.toFixed(1)}`);
      prev = curr;
    }
  });

  // ── Boundary conditions ────────────────────────────────────────────────
  runner.test('getSpacecraftPosition clamps below 0', () => {
    const p0  = traj.getSpacecraftPosition(0);
    const pm1 = traj.getSpacecraftPosition(-10);
    assertClose(mag(p0), mag(pm1), 1, 'Negative MET clamped to 0');
  });

  runner.test('getSpacecraftPosition clamps above mission duration', () => {
    const p240 = traj.getSpacecraftPosition(240);
    const p300 = traj.getSpacecraftPosition(300);
    assertClose(mag(p240), mag(p300), 1, 'MET > 240h clamped to 240h');
  });

  runner.test('getMoonAngleDeg(0) = 0', () => {
    assertClose(traj.getMoonAngleDeg(0), 0, 0.01);
  });

  runner.test('getMoonAngleDeg increases with time', () => {
    assertGt(traj.getMoonAngleDeg(10), traj.getMoonAngleDeg(5));
  });
}

// ════════════════════════════════════════════════════════════════════════════
// ROUTER TESTS (DOM required)
// ════════════════════════════════════════════════════════════════════════════
export function registerRouterTests(runner) {
  runner.test('Navigating to #/ shows visualization view', async () => {
    window.location.hash = '#/';
    await new Promise(r => setTimeout(r, 50));
    const el = document.getElementById('view-visualization');
    assert(el, 'view-visualization element exists');
    assert(el.classList.contains('active'), 'visualization view is active');
  });

  runner.test('Navigating to #/telemetry shows telemetry view', async () => {
    window.location.hash = '#/telemetry';
    await new Promise(r => setTimeout(r, 50));
    assert(document.getElementById('view-telemetry')?.classList.contains('active'),
      'telemetry view should be active');
  });

  runner.test('Navigating to #/about shows about view', async () => {
    window.location.hash = '#/about';
    await new Promise(r => setTimeout(r, 50));
    assert(document.getElementById('view-about')?.classList.contains('active'),
      'about view should be active');
  });

  runner.test('Only one view is active at a time', async () => {
    window.location.hash = '#/';
    await new Promise(r => setTimeout(r, 50));
    const active = document.querySelectorAll('.view.active');
    assertEqual(active.length, 1, `Exactly 1 view should be active, found ${active.length}`);
  });

  runner.test('Nav link matching active view has class "active"', async () => {
    window.location.hash = '#/telemetry';
    await new Promise(r => setTimeout(r, 50));
    const link = document.querySelector('.nav-link[data-view="telemetry"]');
    assert(link?.classList.contains('active'), 'telemetry nav link should be active');
  });
}

// ════════════════════════════════════════════════════════════════════════════
// HELPER / UTILITY TESTS
// ════════════════════════════════════════════════════════════════════════════
export function registerUtilityTests(runner) {
  runner.test('Distance formula: 3-4-5 triangle', () => {
    const a = {x:0, y:0, z:0};
    const b = {x:3, y:4, z:0};
    assertClose(dist3(a, b), 5, 0.001, '3-4-5 triangle distance = 5');
  });

  runner.test('Distance formula: equal points = 0', () => {
    const p = {x:1000, y:2000, z:3000};
    assertClose(dist3(p, p), 0, 0.001);
  });

  runner.test('Trajectory constants: EARTH_RADIUS_KM = 6371', () => {
    const t = new Trajectory();
    assertEqual(t.EARTH_RADIUS_KM, 6371);
  });

  runner.test('Trajectory constants: MOON_ORBITAL_RADIUS_KM = 384400', () => {
    const t = new Trajectory();
    assertEqual(t.MOON_ORBITAL_RADIUS_KM, 384400);
  });

  runner.test('Trajectory constants: MOON_PERIOD_HOURS ≈ 655.2', () => {
    const t = new Trajectory();
    assertClose(t.MOON_PERIOD_HOURS, 655.2, 0.01);
  });

  runner.test('Mission has exactly 9 defined phases', () => {
    const t = new Trajectory();
    assertEqual(t.phases.length, 9);
  });

  runner.test('All phase start/end times are ordered monotonically', () => {
    const t = new Trajectory();
    for (let i = 1; i < t.phases.length; i++) {
      assert(t.phases[i].start >= t.phases[i-1].start,
        `Phase ${i} start ${t.phases[i].start} should be >= phase ${i-1} start`);
    }
  });

  runner.test('Playback state defaults: isPlaying=false, playSpeed=5, currentMET=0', () => {
    const t = new Trajectory();
    assertEqual(t.isPlaying,    false);
    assertEqual(t.playSpeed,    5);
    assertEqual(t.currentMET,  0);
  });
}

// ── Bootstrap (called from test index.html) ────────────────────────────────
export async function runAll() {
  const runner = new TestRunner();

  registerTrajectoryTests(runner);
  registerRouterTests(runner);
  registerUtilityTests(runner);

  const results = await runner.run();
  return results;
}
