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
    // Launch epoch: 2026-04-01 22:35 UTC  (epoch ms from artemistracker.com)
    this.MISSION_START_UTC    = new Date(1775082912000);
    this.MISSION_DURATION_H   = 240;      // 10 days
    // Moon angle in scene XZ at launch — derived from JPL Horizons EME2000 Moon
    // position at 2026-Apr-01 22:35 UTC: scene(x,z) = (-386582, -68681) km
    // atan2(-68681, -386582) = -169.93° (190.07° CCW from +X)
    this.MOON_INITIAL_DEG     = -169.93;
    // NASA confirmed closest Moon approach: 2026-Apr-06 ~19:00 EDT ≈ T+120h.
    // Moon ECI at T+120h: (-92 986, 0, -373 019) km.
    // Retrograde far-side flyby: closest approach ~8 250 km from centre (≈ 6 513 km surface).

    // ── Playback state ──────────────────────────────────────────────────────
    this.currentMET   = 0;       // Mission Elapsed Time, hours
    this.isPlaying    = false;
    this.playSpeed    = 5;       // mission-hours per real second

    // ── Mission phases ──────────────────────────────────────────────────────
    this.phases = [
      { id: 'ascent',          name: 'Ascent',            start: 0,     end: 0.15  },
      { id: 'parking_orbit',   name: 'Parking Orbit',     start: 0.15,  end: 2.94  },
      { id: 'tli',             name: 'TLI Burn',          start: 2.94,  end: 3.1   },
      { id: 'translunar',      name: 'Translunar Coast',  start: 3.1,   end: 117   },
      { id: 'lunar_approach',  name: 'Lunar Approach',    start: 117,   end: 120   },
      { id: 'lunar_flyby',     name: 'Lunar Flyby',       start: 120,   end: 126   },
      { id: 'return',          name: 'Return Coast',      start: 126,   end: 232   },
      { id: 'reentry',         name: 'Reentry',           start: 232,   end: 239   },
      { id: 'splashdown',      name: 'Splashdown',        start: 239,   end: 240   },
    ];

    // ── Pre-compute ─────────────────────────────────────────────────────────
    this._keyframes         = this._buildKeyframes();
    this.trajectoryPoints   = this._precomputeTrajectory(2000);
  }

  // ── Keyframe table ────────────────────────────────────────────────────────
  // Each entry: [t_hours, x_km, y_km, z_km]  — ECI scene frame (Y = north)
  // Translunar coast arcs toward the Moon's ECI position at T+120h:
  //   Moon angle at T+120h = -169.93 + 0.5494×120 = -104.00°
  //   Moon ECI = (-92 986, 0, -373 019) km
  // S/C closest approach at T+120h: ~11 200 km from Moon centre (≈9 450 km surface)
  _buildKeyframes() {
    return [
      // ── Parking orbit – 2 circular orbits ─────────────────────────────────
      [0,      1149,     0,     -6470],   // launch / LEO insertion
      [0.74,  -6470,     0,     -1149],   // 90°
      [1.47,  -1149,     0,      6470],   // 180°
      [2.21,   6470,     0,      1149],   // 270°
      [2.94,   1149,     0,     -6470],   // 360° – TLI point (2 orbits)

      // ── Translunar coast – arc toward Moon at T+120h ──────────────────────
      // Intermediate positions interpolated along the straight-line ECI chord
      // TLI→approach with a modest out-of-plane (y) excursion.
      [5,      -265,   100,    -12700],
      [10,    -3840,   280,    -28460],
      [20,   -10908,   700,    -59600],
      [40,   -25126,  1300,   -122300],
      [60,   -39345,  1500,   -185000],
      [80,   -53563,  1300,   -247700],
      [100,  -67781,   800,   -310300],
      [114,  -77750,   333,   -354200],
      [118,  -80606,   100,   -366900],   // near-side approach, ~14 k km from Moon

      // ── Lunar flyby — retrograde far-side arc (CW when viewed from +Y) ────
      // Moon centre at T+120h: (-92 986, 0, -373 019) km EME2000.
      // Arc: near-side → right-side → far-side → left-side → departure.
      // Far-side closest approach: ~8 250 km from centre (≈ 6 513 km surface).
      [119,  -84738,  1000,   -375075],   // right side, ~8 500 km from Moon centre
      [120,  -94981,  1500,   -381024],   // FAR SIDE closest approach (~6 513 km surface)
      [121, -101559,  1500,   -378171],   // continuing CW past far side
      [122, -104630,  1000,   -370116],   // left side, ~12 k km from Moon
      [124, -101000,   100,   -356000],   // departing Moon region, heading back
      [126,  -98000,     0,   -344000],   // ~25 k km from Moon, return underway

      // ── Return coast — mirrors outbound in XZ → figure-8 crossing at T+180h ─
      // Outbound Y > 0; return Y < 0 → paths cross in top-down (XZ) projection.
      [130,  -90000,  -300,   -328000],
      [135,  -80000,  -600,   -316000],
      [140,  -67781,  -800,   -310300],   // mirror of outbound T+100 h
      [160,  -53563, -1300,   -247700],   // mirror of outbound T+80 h
      [180,  -39345, -1500,   -185000],   // CROSSING POINT — mirror of outbound T+60 h
      [200,  -25126, -1300,   -122300],   // mirror of outbound T+40 h
      [220,  -10908,  -700,    -59600],   // mirror of outbound T+20 h
      [228,   -4000,  -300,    -28000],   // approaching entry interface
      [232,   -8463,  -480,     -2672],   // Entry Interface (≈ 122 km alt)
      [237,   -6922,  -145,     -1626],
      [239,   -6382,   -40,     -1235],
      [240,    1114,     0,     -6273],   // splashdown (Earth surface, Pacific)
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
