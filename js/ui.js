// ui.js — UI controls, data display and routing for ARTEMIS TRACKER

export class UI {
  constructor(trajectory, scene3d) {
    this.traj  = trajectory;
    this.scene = scene3d;

    // DOM element cache (populated in init)
    this._el = {};

    // Slider dragging state
    this._draggingSlider = false;
    this._wasPlayingBeforeDrag = false;

    // Live tracker state (set by onLiveEvent)
    this._liveStatus   = 'idle';
    this._lastFix      = null;
    this._historyCount = 0;
    this._countdown    = 0;
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  init() {
    this._cacheElements();
    this._setNavSubtitle();
    this._bindTimeControls();
    this._bindCameraControls();
    this._bindDisplayOptions();
    this._bindLiveControls();
    this._populateMissionTimeline();
    this._populateAboutView();
  }

  _setNavSubtitle() {
    const el = document.getElementById('nav-subtitle');
    if (!el) return;
    const d = this.traj.MISSION_START_UTC;
    const month = d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
    const year  = d.getUTCFullYear();
    el.textContent = `Artemis 2 \u00B7 ${month} ${year}`;
  }

  // ── Live tracker event handler (called from main.js) ──────────────────────
  onLiveEvent(event) {
    switch (event.type) {
      case 'fetching':
        this._liveStatus = 'fetching';
        break;
      case 'pre_launch':
        this._liveStatus = 'pre_launch';
        break;
      case 'fix':
        this._liveStatus   = 'live';
        this._lastFix      = event.fix;
        this._historyCount = event.history.length;
        this._updateLiveTelemetry(event.fix);
        break;
      case 'error':
        this._liveStatus = 'error';
        break;
      case 'countdown':
        this._countdown = event.seconds;
        break;
      case 'history_cleared':
        this._historyCount = 0;
        this._lastFix = null;
        break;
    }
    this._updateLiveBadge();
  }

  // ── Per-frame update ──────────────────────────────────────────────────────
  update(met) {
    const traj = this.traj;
    const el   = this._el;

    // Slider position (only when not dragging)
    if (!this._draggingSlider && el.slider) {
      el.slider.value = met;
    }

    // Format strings
    const met_str  = traj.formatMET(met);
    const phase    = traj.getPhase(met);
    const pos      = traj.getSpacecraftPosition(met);
    const moonPos  = traj.getMoonPosition(met);
    const distEarth = traj.getDistanceEarth(met);
    const distMoon  = traj.getDistanceMoon(met);
    const vel       = traj.getVelocityKmS(met);
    const alt       = traj.getAltitude(met);
    const date      = traj.getMissionDate(met);
    const moonAngle = traj.getMoonAngleDeg(met);

    const fmt  = (n, d=0) => n.toLocaleString('en-US', { maximumFractionDigits: d });
    const fmt3 = (n)      => fmt(n, 0);

    // Nav MET
    if (el.navMet) el.navMet.textContent = met_str;

    // Controls sidebar — live data
    if (el.miniPhase)     el.miniPhase.textContent     = phase.name;
    if (el.miniEarthDist) el.miniEarthDist.textContent = fmt3(distEarth) + ' km';
    if (el.miniMoonDist)  el.miniMoonDist.textContent  = fmt3(distMoon)  + ' km';
    if (el.miniVelocity)  el.miniVelocity.textContent  = vel.toFixed(2)  + ' km/s';
    if (el.timeDisplay)   el.timeDisplay.textContent   = met_str;

    // Play/pause button icon
    if (el.btnPlay)  el.btnPlay.textContent  = traj.isPlaying ? '⏸ Pause' : '▶ Play';

    // Phase badge
    const badge = document.getElementById('phase-badge');
    if (badge) {
      badge.textContent = phase.name;
      badge.className   = 'phase-badge phase-' + phase.id;
    }

    // ── Telemetry view ───────────────────────────────────────────────────
    if (el.telMet)       el.telMet.textContent       = met_str;
    if (el.telPhase)     el.telPhase.textContent     = phase.name;
    if (el.telDate)      el.telDate.textContent      = date.toUTCString();
    if (el.telX)         el.telX.textContent         = fmt3(pos.x);
    if (el.telY)         el.telY.textContent         = fmt3(pos.y);
    if (el.telZ)         el.telZ.textContent         = fmt3(pos.z);
    if (el.telR)         el.telR.textContent         = fmt3(distEarth);
    if (el.telAlt)       el.telAlt.textContent       = fmt3(alt);
    if (el.telEarthDist) el.telEarthDist.textContent = fmt3(distEarth);
    if (el.telMoonDist)  el.telMoonDist.textContent  = fmt3(distMoon);
    if (el.telVel)       el.telVel.textContent       = vel.toFixed(3);
    if (el.telMoonAngle) el.telMoonAngle.textContent = moonAngle.toFixed(1) + '°';
    if (el.telMoonX)     el.telMoonX.textContent     = fmt3(moonPos.x);
    if (el.telMoonY)     el.telMoonY.textContent     = fmt3(moonPos.y);
    if (el.telMoonZ)     el.telMoonZ.textContent     = fmt3(moonPos.z);

    // Update phase status in mission timeline
    this._updateTimelineHighlight(phase.id);
  }

  // ── Private ───────────────────────────────────────────────────────────────
  _cacheElements() {
    const map = {
      'nav-met':             'navMet',
      'btn-play':            'btnPlay',
      'btn-reset':           'btnReset',
      'mission-time-slider': 'slider',
      'time-display':        'timeDisplay',
      'mini-phase':          'miniPhase',
      'mini-earth-dist':     'miniEarthDist',
      'mini-moon-dist':      'miniMoonDist',
      'mini-velocity':       'miniVelocity',
      'show-orbit':          'showOrbit',
      'show-grid':           'showGrid',
      'show-labels':         'showLabels',
      'tel-met':             'telMet',
      'tel-phase':           'telPhase',
      'tel-date':            'telDate',
      'tel-x':               'telX',
      'tel-y':               'telY',
      'tel-z':               'telZ',
      'tel-r':               'telR',
      'tel-alt':             'telAlt',
      'tel-earth-dist':      'telEarthDist',
      'tel-moon-dist':       'telMoonDist',
      'tel-vel':             'telVel',
      'tel-moon-angle':      'telMoonAngle',
      'tel-moon-x':          'telMoonX',
      'tel-moon-y':          'telMoonY',
      'tel-moon-z':          'telMoonZ',
      // Live signal
      'live-badge':          'liveBadge',
      'live-countdown':      'liveCountdown',
      'live-last-fix':       'liveLastFix',
      'live-fix-count':      'liveFixCount',
      'btn-clear-track':     'btnClearTrack',
      // Live telemetry rows
      'tel-live-dist':       'telLiveDist',
      'tel-live-rate':       'telLiveRate',
      'tel-live-vel':        'telLiveVel',
    };
    this._el = {};
    for (const [id, key] of Object.entries(map)) {
      this._el[key] = document.getElementById(id);
    }
  }

  _bindTimeControls() {
    const traj = this.traj;

    // Play / Pause toggle
    this._el.btnPlay?.addEventListener('click', () => {
      traj.isPlaying = !traj.isPlaying;
      if (traj.currentMET >= traj.MISSION_DURATION_H) {
        traj.currentMET = 0;
        traj.isPlaying  = true;
      }
    });

    // Reset
    this._el.btnReset?.addEventListener('click', () => {
      traj.currentMET = 0;
      traj.isPlaying  = false;
    });

    // Slider
    const slider = this._el.slider;
    if (slider) {
      slider.addEventListener('mousedown',  () => {
        this._draggingSlider     = true;
        this._wasPlayingBeforeDrag = traj.isPlaying;
        traj.isPlaying = false;
      });
      slider.addEventListener('touchstart', () => {
        this._draggingSlider     = true;
        this._wasPlayingBeforeDrag = traj.isPlaying;
        traj.isPlaying = false;
      }, { passive: true });
      slider.addEventListener('input', () => {
        traj.currentMET = parseFloat(slider.value);
      });
      const endDrag = () => {
        if (this._draggingSlider) {
          this._draggingSlider = false;
          traj.isPlaying = this._wasPlayingBeforeDrag;
        }
      };
      document.addEventListener('mouseup', endDrag);
      document.addEventListener('touchend', endDrag);
    }

    // Speed buttons
    document.querySelectorAll('.speed-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        traj.playSpeed = parseFloat(btn.dataset.speed);
      });
    });
  }

  _bindCameraControls() {
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.scene.setCameraView(btn.dataset.view);
      });
    });
  }

  _bindDisplayOptions() {
    this._el.showOrbit?.addEventListener('change', e => {
      this.scene.setShowOrbit(e.target.checked);
    });
    this._el.showGrid?.addEventListener('change', e => {
      this.scene.setShowGrid(e.target.checked);
    });
    this._el.showLabels?.addEventListener('change', e => {
      this.scene.setShowLabels(e.target.checked);
    });
  }

  _bindLiveControls() {
    this._el.btnClearTrack?.addEventListener('click', () => {
      if (confirm('Clear the stored live track? This removes all saved position fixes.')) {
        // Dispatch a custom event so main.js can tell the LiveTracker
        window.dispatchEvent(new CustomEvent('artemis:clearTrack'));
      }
    });
  }

  _updateLiveBadge() {
    const el = this._el;
    const LABELS = {
      idle:       { text: 'CONNECTING…', cls: 'badge-idle'      },
      fetching:   { text: 'FETCHING…',   cls: 'badge-fetching'  },
      pre_launch: { text: 'PRE-LAUNCH',  cls: 'badge-prelaunched'},
      live:       { text: '⬤ LIVE',      cls: 'badge-live'      },
      stale:      { text: 'STALE',       cls: 'badge-stale'     },
      error:      { text: 'NO SIGNAL',   cls: 'badge-error'     },
    };
    const info = LABELS[this._liveStatus] ?? LABELS.idle;
    if (el.liveBadge) {
      el.liveBadge.textContent = info.text;
      el.liveBadge.className   = `live-badge ${info.cls}`;
    }
    if (el.liveCountdown) {
      el.liveCountdown.textContent = this._countdown > 0 ? `${this._countdown}s` : '—';
    }
    if (el.liveFixCount) {
      el.liveFixCount.textContent = this._historyCount > 0 ? `${this._historyCount} fixes` : '—';
    }
    if (el.liveLastFix && this._lastFix) {
      const d = new Date(this._lastFix.utc);
      el.liveLastFix.textContent = d.toUTCString().replace(/.*(\d{2}:\d{2}:\d{2}).*/, '$1') + ' UTC';
    }
  }

  _updateLiveTelemetry(fix) {
    const fmt = n => Math.round(n).toLocaleString('en-US');
    if (this._el.telLiveDist) this._el.telLiveDist.textContent = fmt(fix.distKm);
    if (this._el.telLiveRate) this._el.telLiveRate.textContent = fix.rangeRate.toFixed(3);
    if (this._el.telLiveVel)  this._el.telLiveVel.textContent  = fix.velKmS.toFixed(3);
    // Highlight live rows in telemetry table
    document.querySelectorAll('.live-row').forEach(r => r.classList.add('live-row-active'));
  }

  _populateMissionTimeline() {
    const tbody = document.getElementById('mission-timeline-body');
    if (!tbody) return;
    this.traj.phases.forEach(ph => {
      const tr = document.createElement('tr');
      tr.dataset.phaseId = ph.id;
      tr.innerHTML = `
        <td>${ph.name}</td>
        <td>${this.traj.formatMET(ph.start)}</td>
        <td>${this.traj.formatMET(ph.end)}</td>
        <td><span class="status-dot" data-id="${ph.id}">—</span></td>
      `;
      tbody.appendChild(tr);
    });
  }

  _updateTimelineHighlight(activeId) {
    document.querySelectorAll('#mission-timeline-body tr').forEach(tr => {
      const id = tr.dataset.phaseId;
      tr.classList.toggle('phase-active',   id === activeId);
      tr.classList.toggle('phase-complete', this._isComplete(id, activeId));
      const dot = tr.querySelector('.status-dot');
      if (dot) {
        if (id === activeId)                      dot.textContent = '▶ Active';
        else if (this._isComplete(id, activeId))  dot.textContent = '✓ Done';
        else                                       dot.textContent = '— Pending';
      }
    });
  }

  _isComplete(id, activeId) {
    const order = this.traj.phases.map(p => p.id);
    return order.indexOf(id) < order.indexOf(activeId);
  }

  _populateAboutView() {
    const el = document.getElementById('about-content');
    if (!el) return;
    el.innerHTML = `
      <div class="about-grid">
        <div class="about-card">
          <h3>Mission Overview</h3>
          <p>Artemis II is NASA's first crewed mission of the Artemis program. Four astronauts
          aboard the Orion Multi-Purpose Crew Vehicle (MPCV) fly a free-return trajectory
          around the Moon—the first humans to travel beyond low-Earth orbit since Apollo 17
          in December 1972.</p>
        </div>
        <div class="about-card">
          <h3>Trajectory Profile</h3>
          <ul>
            <li><strong>Launch:</strong> SLS Block 1 from LC-39B, Kennedy Space Center</li>
            <li><strong>Parking Orbit:</strong> 200 km circular LEO, 2 revolutions</li>
            <li><strong>TLI Burn:</strong> T+2 h 56 m — raises apogee to lunar distance</li>
            <li><strong>Transit:</strong> ≈ 72-hour translunar coast</li>
            <li><strong>Lunar Flyby:</strong> Free-return trajectory, closest approach ≈ 8 900 km</li>
            <li><strong>Return:</strong> ≈ 6-day coast back to Earth</li>
            <li><strong>Splashdown:</strong> Pacific Ocean, Day 10</li>
          </ul>
        </div>
        <div class="about-card">
          <h3>Crew</h3>
          <ul>
            <li>Commander: Reid Wiseman</li>
            <li>Pilot: Victor Glover</li>
            <li>Mission Specialist 1: Christina Koch</li>
            <li>Mission Specialist 2: Jeremy Hansen (CSA)</li>
          </ul>
        </div>
        <div class="about-card">
          <h3>Spacecraft Specifications</h3>
          <table class="spec-table">
            <tr><td>Crew Module Mass</td><td>~10 400 kg</td></tr>
            <tr><td>Service Module Mass</td><td>~15 400 kg</td></tr>
            <tr><td>Crew Capacity</td><td>4 astronauts</td></tr>
            <tr><td>Mission Duration</td><td>10 days</td></tr>
            <tr><td>SLS Thrust (liftoff)</td><td>8.8 MN</td></tr>
          </table>
        </div>
        <div class="about-card">
          <h3>Coordinate System</h3>
          <p>Positions are given in the <strong>Earth-Centered Inertial (ECI)</strong> frame:</p>
          <ul>
            <li><strong>Origin:</strong> Earth's centre of mass</li>
            <li><strong>X axis:</strong> Moon's initial direction at launch</li>
            <li><strong>Y axis:</strong> North (Earth's rotation axis)</li>
            <li><strong>Z axis:</strong> Completes right-hand system</li>
            <li><strong>Units:</strong> Kilometres (km)</li>
          </ul>
        </div>
        <div class="about-card">
          <h3>About This Application</h3>
          <p>ARTEMIS TRACKER is a standalone HTML5 Single-Page Application (SPA).
          It uses <strong>Three.js</strong> for WebGL 3D rendering, a hash-based App Router
          for navigation, and a parametric Catmull–Rom spline trajectory model.
          No server or internet connection is required after initial load.</p>
          <p>Use the 3D view controls to orbit, zoom and pan the scene.
          The timeline slider lets you step through the entire 240-hour mission.</p>
        </div>
      </div>
    `;
  }
}
