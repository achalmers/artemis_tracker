// main.js — App entry-point, Router, Animation loop
import { Trajectory }   from './trajectory.js';
import { Scene3D }      from './scene3d.js';
import { UI }           from './ui.js';
import { LiveTracker }  from './live-tracker.js';
import { CONFIG }       from './config.js';

// ── Hash-based App Router ─────────────────────────────────────────────────
class Router {
  constructor() {
    this.routes = {
      '/':          'visualization',
      '/telemetry': 'telemetry',
      '/about':     'about',
    };
  }

  init() {
    window.addEventListener('hashchange', () => this._navigate());
    this._navigate();
  }

  _navigate() {
    const hash  = window.location.hash.replace('#', '') || '/';
    const view  = this.routes[hash] ?? 'visualization';
    document.querySelectorAll('.view').forEach(v  => v.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.getElementById(`view-${view}`)?.classList.add('active');
    document.querySelector(`.nav-link[data-view="${view}"]`)?.classList.add('active');
  }
}

// ── App ────────────────────────────────────────────────────────────────────
class ArtemisApp {
  constructor() {
    this.trajectory  = new Trajectory();
    this.canvas      = document.getElementById('main-canvas');
    this.scene       = new Scene3D(this.canvas, this.trajectory);
    this.ui          = new UI(this.trajectory, this.scene);
    this.router      = new Router();
    this.liveTracker = new LiveTracker();

    this._lastTime   = null;
    this._raf        = null;
  }

  async init() {
    this.router.init();
    this.scene.init();
    this.ui.init();

    // ── Wire live tracker ────────────────────────────────────────────────
    const launchDate = this.trajectory.MISSION_START_UTC;

    this.liveTracker.onUpdate(event => {
      // Always inform the UI (status badge, data readouts)
      this.ui.onLiveEvent(event);

      if (event.type === 'fix') {
        // Update 3D scene
        this.scene.updateLiveData(event.history, event.fix, launchDate);

        // Advance the model time slider to match the live MET so the Moon
        // and model spacecraft stay in sync
        const liveMET = (new Date(event.fix.utc) - launchDate) / 3_600_000;
        if (liveMET >= 0 && liveMET <= this.trajectory.MISSION_DURATION_H) {
          this.trajectory.currentMET = liveMET;
          this.trajectory.isPlaying  = false; // freeze model playback at live time
        }
      }

      // If there's already history stored from a previous session, replay it
      if (event.type === 'fix' || event.type === 'countdown') {
        const history = this.liveTracker.getHistory();
        if (history.length >= 1) {
          this.scene.updateLiveData(history, this.liveTracker.lastFix, launchDate);
        }
      }
    });

    // Restore any previously stored history from localStorage immediately
    const savedHistory = this.liveTracker.getHistory();
    if (savedHistory.length >= 1) {
      const lastFix = savedHistory[savedHistory.length - 1];
      this.scene.updateLiveData(savedHistory, lastFix, launchDate);
      const restoredMET = (new Date(lastFix.utc) - launchDate) / 3_600_000;
      if (restoredMET >= 0) {
        this.trajectory.currentMET = Math.min(restoredMET, this.trajectory.MISSION_DURATION_H);
      }
    }

    // "Clear track" button in sidebar
    window.addEventListener('artemis:clearTrack', () => {
      this.liveTracker.clearHistory();
      // Remove the live visuals from the scene
      if (this.scene.liveTrackLine) {
        this.scene.scene.remove(this.scene.liveTrackLine);
        this.scene.liveTrackLine.geometry.dispose();
        this.scene.liveTrackLine = null;
      }
      if (this.scene.liveDot) {
        this.scene.scene.remove(this.scene.liveDot);
        this.scene.liveDot = null;
      }
      if (this.scene.liveGlow) {
        this.scene.scene.remove(this.scene.liveGlow);
        this.scene.liveGlow = null;
      }
      if (this.scene.liveLabel && this.scene._labelRoot) {
        this.scene._labelRoot.remove(this.scene.liveLabel);
        this.scene.liveLabel = null;
      }
      this.scene._hasLiveData = false;
      // Restore model-based red track visibility
      if (this.scene.trackDone) this.scene.trackDone.visible = true;
      // Restore full cyan track
      if (this.scene.trackFull) {
        this.scene.trackFull.geometry.setDrawRange(0, this.scene._totalPoints);
      }
    });

    // Start polling the tracking site
    this.liveTracker.start();

    // Start playing model at default speed
    this.trajectory.isPlaying = true;

    // Kick off animation loop
    this._raf = requestAnimationFrame(ts => this._loop(ts));
  }

  _loop(timestamp) {
    this._raf = requestAnimationFrame(ts => this._loop(ts));

    // Advance model time if playing (only when no live data is syncing it)
    if (this._lastTime !== null && this.trajectory.isPlaying) {
      const dt = (timestamp - this._lastTime) / 1000;
      this.trajectory.currentMET += dt * this.trajectory.playSpeed;
      if (this.trajectory.currentMET >= this.trajectory.MISSION_DURATION_H) {
        this.trajectory.currentMET = this.trajectory.MISSION_DURATION_H;
        this.trajectory.isPlaying  = false;
      }
    }
    this._lastTime = timestamp;

    const met = this.trajectory.currentMET;

    // Only render 3D scene when the visualization view is visible
    const visView = document.getElementById('view-visualization');
    if (visView?.classList.contains('active')) {
      this.scene.update(met);
    }

    // Always update UI
    this.ui.update(met);
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────
const app = new ArtemisApp();
app.init().catch(err => console.error('ArtemisApp init failed:', err));
