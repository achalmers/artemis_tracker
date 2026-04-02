// trajectory.js — Artemis 2 Mission Trajectory Calculator
// Coordinate system: Earth at origin, Y-up (north pole), Moon initially along +X axis,
// Z completes the right-hand system. Moon orbits counterclockwise in XZ plane when
// viewed from above (+Y). Distances in km.

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
    this.MOON_INITIAL_DEG     = 0;        // Moon starts at +X axis at T+0

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
  // Moon at T+75 h ≈ (289 100, 0, 253 300) km  →  S/C closest approach ~8 300 km
  _buildKeyframes() {
    const R = this.EARTH_RADIUS_KM + this.LEO_ALTITUDE_KM;  // 6571 km
    return [
      // ── Parking orbit – 2 circular orbits in XZ plane (Y=0) ──────────────
      [0,     0,        0,     R      ],   // launch / LEO insertion
      [0.74,  R,        0,     0      ],   // 90°
      [1.47,  0,        0,    -R      ],   // 180°
      [2.21, -R,        0,     0      ],   // 270°
      [2.94,  0,        0,     R      ],   // 360° – TLI point  (2 orbits)

      // ── Translunar coast – arc toward Moon ────────────────────────────────
      [5,      5000,    2000,  14000  ],
      [15,    28000,    4500,  52000  ],
      [30,    74000,    6500, 116000  ],
      [45,   140000,    5500, 179000  ],
      [60,   204000,    3000, 225000  ],
      [70,   258000,     900, 253000  ],

      // ── Lunar approach & flyby ────────────────────────────────────────────
      [73,   277000,     400, 248000  ],   // entering lunar SOI
      [74,   283000,    1800, 250000  ],
      [75,   287000,    4500, 258000  ],   // closest approach (≈ 8 300 km from Moon centre)
      [76,   291000,    2800, 253000  ],
      [77.5, 296000,     900, 247000  ],
      [79,   300000,       0, 242000  ],   // departing Moon region

      // ── Return coast ──────────────────────────────────────────────────────
      [95,   295000,  -3000, 218000  ],
      [115,  271000,  -6000, 178000  ],
      [140,  231000,  -8000, 132000  ],
      [165,  177000,  -7500,  83000  ],
      [190,  114000,  -5500,  39000  ],
      [210,   59000,  -3500,  11500  ],
      [225,   21500,  -1500,   3400  ],
      [232,    8800,   -480,   1150  ],   // Entry Interface  (≈ 122 km alt)
      [237,    7100,   -145,    390  ],
      [239,    6500,    -40,    100  ],
      [240,       0,      0,   6371  ],   // splashdown (Earth surface, Pacific)
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
      y:  R * Math.sin(angle) * 0.089,   // ≈ 5.1° inclination
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
