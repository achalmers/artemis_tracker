// live-tracker.js — polls artemistracker.com every 5 minutes for the live
// Artemis 2 / Orion spacecraft position and accumulates a track in localStorage.
//
// Coordinate conversion
// ─────────────────────
// artemistracker.com sources positions from JPL Horizons with a geocentric
// origin in the EME2000 frame:
//   EME2000  X  →  toward vernal equinox
//   EME2000  Y  →  completing right-hand in equatorial plane
//   EME2000  Z  →  Earth north pole
//
// Our Three.js scene uses Y-up (north), so the mapping is:
//   scene.x = eme.x
//   scene.y = eme.z   (north pole → Y-up)
//   scene.z = eme.y   (completes RH)

import { CONFIG } from './config.js';

const STORAGE_KEY = 'artemis2_live_track_v2';

export class LiveTracker {
  constructor() {
    this.lastFix       = null;   // most recent successfully parsed fix
    this.preLaunch     = true;   // true until server confirms mission started
    this.lastFetchTime = null;
    this.lastError     = null;
    this.nextPollIn    = 0;      // seconds until next poll (for countdown UI)
    this.status        = 'idle'; // 'idle' | 'fetching' | 'live' | 'stale' | 'error' | 'pre_launch'

    this._history      = this._loadHistory();
    this._listeners    = [];
    this._timerId      = null;
    this._countdownId  = null;
    this._nextPollAt   = null;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Register a callback.  Called with an event object on every state change. */
  onUpdate(fn) { this._listeners.push(fn); }

  /** Start polling.  Fires the first request immediately. */
  start() {
    this._poll();
    this._startCountdown();
  }

  stop() {
    if (this._timerId)     clearTimeout(this._timerId);
    if (this._countdownId) clearInterval(this._countdownId);
  }

  /** All accumulated live position fixes (scene-space km). */
  getHistory() { return this._history; }

  /** Wipe stored track (e.g. after a mission reset). */
  clearHistory() {
    this._history = [];
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    this._emit({ type: 'history_cleared' });
  }

  // ── Polling ────────────────────────────────────────────────────────────────

  async _poll() {
    clearTimeout(this._timerId);
    this.status = 'fetching';
    this._emit({ type: 'fetching' });

    const data = await this._fetchWithFallback();

    if (data) {
      this._processFix(data);
      this.lastError = null;
      this._scheduleNext(CONFIG.POLL_INTERVAL_MS);
    } else {
      this.status    = 'error';
      this.lastError = 'Could not reach tracking server (direct + proxy both failed)';
      this._emit({ type: 'error', error: this.lastError });
      this._scheduleNext(CONFIG.RETRY_INTERVAL_MS);
    }

    this.lastFetchTime = new Date();
    this._nextPollAt   = new Date(Date.now() + (data ? CONFIG.POLL_INTERVAL_MS : CONFIG.RETRY_INTERVAL_MS));
  }

  _scheduleNext(delayMs) {
    this._timerId = setTimeout(() => this._poll(), delayMs);
  }

  _startCountdown() {
    this._countdownId = setInterval(() => {
      if (this._nextPollAt) {
        this.nextPollIn = Math.max(0, Math.round((this._nextPollAt - Date.now()) / 1000));
        this._emit({ type: 'countdown', seconds: this.nextPollIn });
      }
    }, 1000);
  }

  // ── Network ────────────────────────────────────────────────────────────────

  async _fetchWithFallback() {
    // 1. Try the API directly (works if the server sends CORS headers)
    let data = await this._fetchJSON(CONFIG.TRACKING_URL);
    if (data) return data;

    // 2. Route through the local CORS proxy
    const proxied = CONFIG.PROXY_URL + '?url=' + encodeURIComponent(CONFIG.TRACKING_URL);
    return await this._fetchJSON(proxied);
  }

  async _fetchJSON(url) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 9000);
      const resp = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'Accept': 'application/json' },
      });
      clearTimeout(tid);
      if (!resp.ok) return null;
      return await resp.json();
    } catch {
      return null;
    }
  }

  // ── Data parsing ───────────────────────────────────────────────────────────

  _processFix(data) {
    // Handle pre-launch state
    if (data.pre_launch === true) {
      this.preLaunch = true;
      this.status    = 'pre_launch';
      this._emit({ type: 'pre_launch', data });
      return;
    }
    this.preLaunch = false;

    const cache = data.cache;
    if (!cache || !Array.isArray(cache.position_km) || cache.position_km.length < 3) {
      this.status    = 'error';
      this.lastError = 'Unexpected response format';
      this._emit({ type: 'error', error: this.lastError });
      return;
    }

    const [ex, ey, ez] = cache.position_km;
    const vel          = cache.velocity_km_s ?? [0, 0, 0];

    // Convert EME2000 → scene axes (Y-up / north)
    const fix = {
      utc:      cache.utc || data.server_utc,
      x:        ex,          // EME2000 X  → scene X
      y:        ez,          // EME2000 Z  → scene Y  (north = up)
      z:        ey,          // EME2000 Y  → scene Z
      distKm:   cache.range_center_km   ?? Math.sqrt(ex*ex + ey*ey + ez*ez),
      rangeRate: cache.range_rate_km_s  ?? 0,
      velKmS:   Math.sqrt(vel[0]**2 + vel[1]**2 + vel[2]**2),
      raw:      { x: ex, y: ey, z: ez },  // keep original for debugging
    };

    this.lastFix = fix;
    this.status  = 'live';

    // Append to history if this is a new observation
    const prev = this._history[this._history.length - 1];
    if (!prev || prev.utc !== fix.utc) {
      this._history.push({ x: fix.x, y: fix.y, z: fix.z, utc: fix.utc });
      this._saveHistory();
    }

    this._emit({ type: 'fix', fix, history: this._history });
  }

  // ── Storage ────────────────────────────────────────────────────────────────

  _loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      // Validate shape
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(p => typeof p.x === 'number' && typeof p.y === 'number' && typeof p.z === 'number');
    } catch {
      return [];
    }
  }

  _saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._history));
    } catch {
      // localStorage full: drop the oldest half and retry
      this._history = this._history.slice(Math.floor(this._history.length / 2));
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this._history)); } catch {}
    }
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  _emit(event) {
    this._listeners.forEach(fn => {
      try { fn(event); } catch (err) { console.error('LiveTracker listener error:', err); }
    });
  }
}
