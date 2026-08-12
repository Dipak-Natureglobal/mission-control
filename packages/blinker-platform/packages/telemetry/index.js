// Public surface for blinker-platform's telemetry layer.
//
// CHARTER: thin `track(eventName, payload)` wrapper around PostHog plus
// (Wave 15c-fu) a registry of allowed event names. Today every child app
// inlines `posthog.capture(...)` with hand-typed event names; this causes
// drift (e.g. case mismatches, prefix variants — see audit § 6.4 for
// the insurance-portal snake_case-vs-dotted drift). The registry validates
// event names at call site (warns in dev, no-op in prod).
//
// API surface:
//   track(eventName, payload?)                         → void   [shipped 15c]
//   captureEvent(eventName, payload?)                  → void   [alias of
//                                                                track —
//                                                                back-compat
//                                                                for the
//                                                                insurance-
//                                                                portal API
//                                                                name; @deprecated]
//   registerEvents([{ name, props?, description? }, …]) → void  [Wave 15c-fu]
//   getEventCatalog()                                   → meta  [Wave 15c-fu]
//
// Event-name convention (from architecture/01-event-taxonomy.md):
//   <app>.<surface>.<verb>            e.g. mission_control.copilot.opened
//   <app>.<surface>.<noun>_<verb>     e.g. protection.cross_sell.cta_clicked
//
// Dep direction (per architecture/11):
//   - MAY read `../../canon/*.json` (event catalog, when canonized).
//   - MAY import sibling packages (none expected — telemetry is a leaf).
//   - MUST NOT import from any child app.
//
// Consumers MUST import from this file ONLY.

// ---------------------------------------------------------------------
// Event registry — module-scope, page-lifetime only (no persistence).
// Apps populate at boot; downstream consumers read via getEventCatalog().
// ---------------------------------------------------------------------

const _registry = new Map(); // name -> { name, props?, description? }

/**
 * Register a batch of event descriptors. Idempotent — re-registering the
 * same `name` overwrites the prior descriptor. Apps typically call this
 * once at boot with the full inventory of events the app emits.
 *
 * @param {Array<{ name: string, props?: object, description?: string }>} events
 */
export function registerEvents(events) {
  if (!Array.isArray(events)) return;
  for (const ev of events) {
    if (!ev || typeof ev.name !== 'string' || ev.name.length === 0) continue;
    _registry.set(ev.name, {
      name: ev.name,
      props: ev.props,
      description: ev.description,
    });
  }
}

/**
 * Return the currently-registered event descriptors as an array. Used by
 * super-admin "events I can see" views and event-name registry
 * visualization.
 *
 * @returns {Array<{ name: string, props?: object, description?: string }>}
 */
export function getEventCatalog() {
  return Array.from(_registry.values());
}

// ---------------------------------------------------------------------
// Dev-mode validator. The registry being EMPTY means "no app registered
// yet" — in that case validate-nothing (the consumer hasn't opted in).
// Once any app calls registerEvents(), unknown event names start warning.
// ---------------------------------------------------------------------

function _isDev() {
  try {
    if (typeof import.meta !== 'undefined' && import.meta && import.meta.env) {
      return Boolean(import.meta.env.DEV);
    }
  } catch (_) {
    /* import.meta may be unavailable in some bundler contexts */
  }
  // Fallback: dev-ish if we're in a browser without window.posthog wired up.
  return typeof window !== 'undefined' && !window.posthog;
}

function _maybeWarnUnknown(event) {
  if (_registry.size === 0) return;
  if (_registry.has(event)) return;
  if (!_isDev()) return;
  // eslint-disable-next-line no-console
  console.warn(
    '[blinker-platform/telemetry] Unknown event name:',
    event,
    '— register it via registerEvents([...]) so it appears in the catalog.'
  );
}

// ---------------------------------------------------------------------
// track() — Phase 1 shim: if window.posthog is loaded, capture normally;
// otherwise console.log so events surface in the browser console during
// local dev. Replace the body when posthog-js is wired (no contract
// change).
//
// Mirrors the per-app posthog.js helpers across all 4 runnable apps —
// 15c-fu lifts those four shims and converges on this surface.
// ---------------------------------------------------------------------

export function track(event, props = {}) {
  _maybeWarnUnknown(event);
  if (
    typeof window !== 'undefined' &&
    window.posthog &&
    typeof window.posthog.capture === 'function'
  ) {
    window.posthog.capture(event, props);
    return;
  }
  // eslint-disable-next-line no-console
  console.log('[PostHog]', event, props);
}

/**
 * @deprecated Use `track` instead. Alias retained for back-compat with
 * insurance-portal's pre-15c-fu `captureEvent(name, props)` API. Prefer
 * `track` in new code so the call surface is consistent across the
 * platform.
 */
export function captureEvent(event, props = {}) {
  return track(event, props);
}
