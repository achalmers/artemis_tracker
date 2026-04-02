// config.js — ARTEMIS TRACKER runtime configuration
// Edit this file to change the tracking endpoint or poll interval.

export const CONFIG = {
  // ── Live data source ─────────────────────────────────────────────────────
  // Primary: artemistracker.com WordPress REST API (sourced from JPL Horizons)
  TRACKING_URL: 'https://artemistracker.com/wp-json/adc/v1/distance',

  // Fallback: requests are relayed through the local CORS proxy in server.py
  // so the browser can reach the external API without CORS errors.
  PROXY_URL: 'http://localhost:8080/proxy',

  // ── Polling ───────────────────────────────────────────────────────────────
  // artemistracker.com caches its upstream data every 60 s; polling every
  // 5 minutes is respectful and gives smooth-enough live updates.
  POLL_INTERVAL_MS: 5 * 60 * 1000,

  // Retry after a failed poll (network error / rate-limit)
  RETRY_INTERVAL_MS: 30 * 1000,

  // ── Mission epoch ─────────────────────────────────────────────────────────
  // Launch epoch published by artemistracker.com site code.
  // Corresponds to approximately 2026-04-01T22:21:52Z.
  LAUNCH_EPOCH_MS: 1775082912000,
};
