// trajectory.js — Artemis 2 Mission Trajectory Calculator
// Coordinate system: Earth at origin, Y-up (north pole). Scene X/Z aligned with EME2000
// equatorial plane (scene.x = EME2000.x, scene.y = EME2000.z, scene.z = EME2000.y).
// MOON_INITIAL_DEG is set from JPL Horizons Moon position at launch so the model
// coordinate frame matches the live EME2000 data from artemistracker.com.
// Distances in km.

export class Trajectory {
  constructor() {
    // ── Physical constants ──────────────────────────────────────────────────
    this.EARTH_RADIUS_KM        = 6371;
    this.MOON_RADIUS_KM         = 1737;
    this.MOON_ORBITAL_RADIUS_KM = 384400;
    this.MOON_PERIOD_HOURS      = 27.3 * 24;          // 655.2 h
    this.MOON_ANG_VEL_DEG_H     = 360 / (27.3 * 24);  // 0.5494 °/h
    this.LEO_ALTITUDE_KM        = 200;

    // ── Mission parameters ──────────────────────────────────────────────────
    // Launch epoch from artemistracker.com site data ≈ 2026-04-01T22:21:52Z
    this.MISSION_START_UTC    = new Date(1775082912000);
    this.MISSION_DURATION_H   = 240;      // 10 days
    // Moon angle in scene XZ at launch — derived from JPL Horizons EME2000 Moon
    // position at 2026-Apr-01 22:35 UTC: scene(x,z) = (-386582, -68681) km
    // atan2(-68681, -386582) = -169.93° (190.07° CCW from +X)
    this.MOON_INITIAL_DEG     = -169.93;

    // ── Playback state ──────────────────────────────────────────────────────
    this.currentMET   = 0;       // Mission Elapsed Time, hours
    this.isPlaying    = false;
    this.playSpeed    = 5;       // mission-hours per real second

    // ── Mission phases ──────────────────────────────────────────────────────
    this.phases = [
      { id: 'ascent',          name: 'Ascent',            start: 0,     end: 0.15  },
      { id: 'parking_orbit',   name: 'Parking Orbit',     start: 0.15,  end: 2.94  },
      { id: 'tli',             name: 'TLI Burn',          start: 2.94,  end: 3.1   },
      { id: 'translunar',      name: 'Translunar Coast',  start: 3.1,   end: 73    },
      { id: 'lunar_approach',  name: 'Lunar Approach',    start: 73,    end: 75    },
      { id: 'lunar_flyby',     name: 'Lunar Flyby',       start: 75,    end: 78    },
      { id: 'return',          name: 'Return Coast',      start: 78,    end: 232   },
      { id: 'reentry',         name: 'Reentry',           start: 232,   end: 239   },
      { id: 'splashdown',      name: 'Splashdown',        start: 239,   end: 240   },
    ];

    // ── Pre-compute ─────────────────────────────────────────────────────────
    this._keyframes         = this._buildKeyframes();
    this.trajectoryPoints   = this._precomputeTrajectory(2000);
  }

  // ── Keyframe table ────────────────────────────────────────────────────────
  // Each entry: [t_hours, x_km, y_km, z_km]
  // All XZ coordinates rotated by -169.93° to align scene frame with EME2000
  // (Moon starts at scene angle -169.93° matching JPL Horizons data at launch).
  // S/C closest Moon approach at T+75h ≈ 5 200 km.
  _buildKeyframes() {
    return [
      // ── Parking orbit – 2 circular orbits ─────────────────────────────────
      [0,      1149,      0,    -6470],   // launch / LEO insertion
      [0.74,  -6470,      0,    -1149],   // 90°
      [1.47,  -1149,      0,     6470],   // 180°
      [2.21,   6470,      0,     1149],   // 270°
      [2.94,   1149,      0,    -6470],   // 360° – TLI point (2 orbits)

      // ── Translunar coast – arc toward Moon ────────────────────────────────
      [5,     -2474,   2000,   -14659],
      [15,   -18472,   4500,   -56096],
      [30,   -52568,   6500,  -127156],
      [45,  -106530,   5500,  -200729],
      [60,  -161497,   3000,  -257215],
      [70,  -209767,    900,  -294229],

      // ── Lunar approach & flyby ────────────────────────────────────────────
      [73,  -229348,    400,  -292630],   // entering lunar SOI
      [74,  -234906,   1800,  -295649],
      [75,  -237445,   4500,  -304225],   // closest approach (~5 200 km from Moon)
      [76,  -242258,   2800,  -300002],
      [77.5,-248230,    900,  -294969],
      [79,  -253043,      0,  -290746],   // departing Moon region

      // ── Return coast ──────────────────────────────────────────────────────
      [95,  -252319,  -3000,  -266241],
      [115, -235685,  -6000,  -222660],
      [140, -204349,  -8000,  -170372],
      [165, -159752,  -7500,  -112682],
      [190, -105420,  -5500,   -58340],
      [210,  -56079,  -3500,   -21643],
      [225,  -20574,  -1500,    -7108],
      [232,   -8463,   -480,    -2672],   // Entry Interface (≈ 122 km alt)
      [237,   -6922,   -145,    -1626],
      [239,   -6382,    -40,    -1235],
      [240,    1114,      0,    -6273],   // splashdown (Earth surface, Pacific)
    ];
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Moon position in km (ECI). */
  getMoonPosition(met_h) {
    const omega  = (2 * Math.PI) / this.MOON_PERIOD_HOURS;
    const angle  = (this.MOON_INITIAL_DEG * Math.PI / 180) + omega * met_h;
    const R      = this.MOON_ORBITAL_RADIUS_KM;
    return {
      x:  R * Math.cos(angle),
      y:  0,   // simplified model: Moon orbits in equatorial plane (XZ)
      z:  R * Math.sin(angle),
    };
  }

  /** Spacecraft position in km (ECI). */
  getSpacecraftPosition(met_h) {
    const t = Math.max(0, Math.min(met_h, this.MISSION_DURATION_H));
    return this._interpolate(t);
  }

  /** Velocity in km/s (numerical derivative). */
  getVelocityKmS(met_h) {
    const dt = 0.01;
    const p1 = this.getSpacecraftPosition(met_h - dt / 2);
    const p2 = this.getSpacecraftPosition(met_h + dt / 2);
    const dx  = (p2.x - p1.x) / dt;
    const dy  = (p2.y - p1.y) / dt;
    const dz  = (p2.z - p1.z) / dt;
    return Math.sqrt(dx*dx + dy*dy + dz*dz) / 3600;  // km/h → km/s
  }

  /** Distance from Earth centre in km. */
  getDistanceEarth(met_h) {
    const p = this.getSpacecraftPosition(met_h);
    return Math.sqrt(p.x*p.x + p.y*p.y + p.z*p.z);
  }

  /** Distance from Moon centre in km. */
  getDistanceMoon(met_h) {
    const sc = this.getSpacecraftPosition(met_h);
    const m  = this.getMoonPosition(met_h);
    const dx = sc.x - m.x, dy = sc.y - m.y, dz = sc.z - m.z;
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
  }

  /** Altitude above Earth surface in km. */
  getAltitude(met_h) {
    return this.getDistanceEarth(met_h) - this.EARTH_RADIUS_KM;
  }

  /** Current mission phase object. */
  getPhase(met_h) {
    for (const ph of this.phases) {
      if (met_h >= ph.start && met_h < ph.end) return ph;
    }
    return { id: 'complete', name: 'Mission Complete' };
  }

  /** Format MET as T+HH:MM:SS. */
  formatMET(met_h) {
    if (met_h < 0) return 'T-' + this._hhmmss(-met_h);
    return 'T+' + this._hhmmss(met_h);
  }

  /** UTC Date object for a given MET. */
  getMissionDate(met_h) {
    return new Date(this.MISSION_START_UTC.getTime() + met_h * 3_600_000);
  }

  /** Moon angle in degrees (0° = +X axis). */
  getMoonAngleDeg(met_h) {
    return (this.MOON_INITIAL_DEG + this.MOON_ANG_VEL_DEG_H * met_h) % 360;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  _hhmmss(hours) {
    const totalSec = Math.round(hours * 3600);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  _precomputeTrajectory(n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * this.MISSION_DURATION_H;
      pts.push(this.getSpacecraftPosition(t));
    }
    return pts;
  }

  _interpolate(t) {
    const kf = this._keyframes;
    if (t <= kf[0][0])         return { x: kf[0][1],        y: kf[0][2],        z: kf[0][3]        };
    if (t >= kf[kf.length-1][0]) return { x: kf[kf.length-1][1], y: kf[kf.length-1][2], z: kf[kf.length-1][3] };

    let i = 1;
    while (i < kf.length && kf[i][0] < t) i++;

    const tau = (t - kf[i-1][0]) / (kf[i][0] - kf[i-1][0]);
    const p0  = kf[Math.max(0, i-2)];
    const p1  = kf[i-1];
    const p2  = kf[i];
    const p3  = kf[Math.min(kf.length-1, i+1)];

    return this._catmullRom(tau,
      { x: p0[1], y: p0[2], z: p0[3] },
      { x: p1[1], y: p1[2], z: p1[3] },
      { x: p2[1], y: p2[2], z: p2[3] },
      { x: p3[1], y: p3[2], z: p3[3] },
    );
  }

  _catmullRom(t, p0, p1, p2, p3) {
    const t2 = t*t, t3 = t2*t;
    const interp = (a, b, c, d) =>
      0.5 * ((2*b) + (-a+c)*t + (2*a - 5*b + 4*c - d)*t2 + (-a + 3*b - 3*c + d)*t3);
    return {
      x: interp(p0.x, p1.x, p2.x, p3.x),
      y: interp(p0.y, p1.y, p2.y, p3.y),
      z: interp(p0.z, p1.z, p2.z, p3.z),
    };
  }
}
