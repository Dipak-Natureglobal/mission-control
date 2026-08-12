// Phase 1 opportunities API — fixture-backed reads + Wave 31 create() wrapper.
//
// Opportunity mutations in Phase 1 still flow through
// `mission-control/src/lib/session-data.js` (appendOpportunity /
// updateOpportunity — session-scoped, localStorage-overlayed). When the
// next migration wave lifts those into this module, follow the notes.js
// / activities.js pattern.
//
// Today this module exposes read-only `list()` / `get(id)` so that
// AgentInbox can consume canonical opportunity data without each child
// app importing the JSON directly.
//
// Wave 31 v3.0.11 — `create(opp)` is the Phase-1 entry point for the
// reverse-direction cross-sell spawn (insurance CoPilot "Find Coverage"
// minting a new protection opportunity for the same contact + vehicle).
// To keep the existing session-scoped mutation model intact, `create()`
// is a thin wrapper that delegates to a writer registered by the host
// app on boot — typically `session-data.js::appendOpportunity` in
// mission-control. Standalone callers that haven't registered a writer
// get a single dev-console warning and a fixture-mode echo of the input
// (so unit tests / isolated consumers still get back the same object).
// Phase 2: replace the wrapper body with `await fetch(POST /opportunities)`
// — the public signature stays stable.
//
// Shape (matches _fixtures/opportunities.json):
//
//   {
//     id, type, contact_id, contact_name, household,
//     vehicle, status, owner,
//     created_at, updated_at, value, next_action, deadline,
//     _test_case?,    // fixture-only annotation (test/demo modes)
//   }
//
// `type` is one of: 'protection' | 'refi' | 'insurance' | 'payments'.
// `status` values must match canon/ghl-status.json for the corresponding
// type (payments uses the EFS construct — no GHL canon).

import opportunitiesFixture from './_fixtures/opportunities.json';
import contactsFixture from './_fixtures/contacts.json';

function _records() {
  const arr = opportunitiesFixture.opportunities;
  return Array.isArray(arr) ? arr : [];
}

// Build a contact_id → org_id map from the contacts fixture. Memoized so
// `list({ org_id })` doesn't reduce the contacts block on every call.
// Opportunities don't carry org_id directly (per canon/blinker-domain.json
// — org membership lives on the contact). Phase 2: server-side join.
let _contactOrgMap = null;
function _contactOrgs() {
  if (_contactOrgMap) return _contactOrgMap;
  const block = contactsFixture.contacts;
  const map = new Map();
  if (block && typeof block === 'object') {
    for (const c of Object.values(block)) {
      if (c && c.id && typeof c.org_id === 'number') map.set(c.id, c.org_id);
    }
  }
  _contactOrgMap = map;
  return map;
}

/**
 * List opportunities. Returns a fresh array of opportunity records.
 *
 * Filters available:
 *   - type: 'protection' | 'refi' | 'insurance' | 'payments' — restrict by type
 *   - contact_id: string — restrict to one contact
 *   - status: string | string[] — restrict to one or more status values
 *   - owner: string — exact match on opportunity.owner (agent name today;
 *     swap to id once owners migrate to id refs in Phase 2)
 *   - owner_id: string — exact match on opportunity.owner_id (null-safe;
 *     fixtures may not carry this field yet, which makes the filter a no-op
 *     for legacy rows)
 *   - unassigned: true — opportunities with no owner / owner_id set; mutually
 *     exclusive with owner / owner_id (caller's responsibility — combining
 *     them returns the empty intersection)
 *   - org_id: number — restrict to opportunities whose contact.org_id matches
 *     (joins through _fixtures/contacts.json). Used by the Manager surface
 *     to scope routing queues to the active org.
 *   - org_ids: number[] — alternative to org_id for cross-org rollup ("All
 *     my orgs"); matches when the opp's contact's org_id is in the set.
 *
 * Ordering is preserved from the fixture (sorted there); callers that
 * need a specific sort (e.g. AgentInbox by `age`) sort downstream.
 */
export function list({ type, contact_id, status, owner, owner_id, unassigned, org_id, org_ids } = {}) {
  let rows = _records();
  if (type) rows = rows.filter((o) => o.type === type);
  if (contact_id) rows = rows.filter((o) => o.contact_id === contact_id);
  if (status) {
    const statuses = Array.isArray(status) ? status : [status];
    rows = rows.filter((o) => statuses.includes(o.status));
  }
  if (owner) rows = rows.filter((o) => o.owner === owner);
  if (owner_id) rows = rows.filter((o) => o.owner_id === owner_id);
  if (unassigned === true) {
    rows = rows.filter((o) => {
      const noOwner = o.owner == null || o.owner === '';
      const noOwnerId = o.owner_id == null || o.owner_id === '';
      return noOwner && noOwnerId;
    });
  }
  if (typeof org_id === 'number') {
    const m = _contactOrgs();
    rows = rows.filter((o) => m.get(o.contact_id) === org_id);
  }
  if (Array.isArray(org_ids) && org_ids.length > 0) {
    const m = _contactOrgs();
    const set = new Set(org_ids);
    rows = rows.filter((o) => set.has(m.get(o.contact_id)));
  }
  return rows.slice();
}

/**
 * Look up a single opportunity by id. Returns the opportunity record or null.
 */
export function get(id) {
  if (!id) return null;
  return _records().find((o) => o.id === id) || null;
}

// ---------------------------------------------------------------------
// Wave 31 — create() wrapper + writer registration.
// ---------------------------------------------------------------------
//
// The host app (mission-control today) registers a writer once at boot:
//
//   import { registerOpportunityWriter } from 'blinker-platform/api';
//   // …inside useSessionData() after appendOpportunity is built:
//   registerOpportunityWriter((opp) => {
//     appendOpportunity(opp);
//     return opp; // echo the persisted record so callers can switch to it
//   });
//
// Then any consumer (e.g. CoPilotPane's Find Coverage handler) can call
// `blinkerApi.opportunities.create({ … })` without owning the mc-specific
// session-data plumbing. Standalone test/demo callers that never
// registered a writer still get back the input shape (with a normalized
// id + timestamps if missing) so the rest of the flow can proceed.

let _writer = null;
let _warnedNoWriter = false;

/**
 * Register the host app's opportunity writer. Mission-control wires this
 * to session-data.appendOpportunity at app boot. Calling twice replaces
 * the previous writer (last registration wins). Pass `null` to
 * unregister.
 *
 * The writer receives the create() input (with id/timestamps filled in
 * if absent) and should persist + return the record it actually stored.
 * The returned record is what `create()` resolves to.
 */
export function registerOpportunityWriter(fn) {
  _writer = typeof fn === 'function' ? fn : null;
  _warnedNoWriter = false;
}

function _ensureId(opp) {
  if (opp && opp.id) return opp.id;
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `opp_new_${crypto.randomUUID()}`;
  }
  return `opp_new_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Create a new opportunity. Phase 1: delegates to the registered writer
 * (mission-control's session-data.appendOpportunity). When no writer is
 * registered, emits a single dev-console warning and echoes the input
 * (with `id`, `created_at`, `updated_at` filled in) so standalone callers
 * can still proceed in fixture mode.
 *
 * Phase 2: replace the writer-delegation body with a real API call:
 *   const res = await fetch('/opportunities', { method: 'POST', body });
 *   return await res.json();
 * The public signature does not change.
 *
 * @param {Object} opp
 *   Opportunity-shape input. At minimum: { type, contact_id }. Any of:
 *   { vehicle_id, status, owner, owner_id, value, next_action, deadline,
 *     _prefill, flowPath, ... } pass through. Caller may pre-set `id`;
 *   if absent, a new `opp_new_<uuid>` id is minted.
 *
 *   Wave 31: `_prefill` carries cross-workflow seed data (mileage,
 *   condition, purchase_date, annual_miles_estimate, year/make/model/
 *   trim/vin) that ProtectionEmbed's `buildProtectionInitialForm`
 *   overlays onto the form on first mount. Fields persist on the
 *   opportunity record itself so reopening the CoPilot re-seeds.
 *
 * @returns {Object} the persisted opportunity record (or the echo when
 *   no writer is registered).
 */
export function create(opp = {}) {
  if (!opp || typeof opp !== 'object') {
    throw new Error('blinker-platform/api opportunities.create: opp object required');
  }
  if (!opp.type) {
    throw new Error('blinker-platform/api opportunities.create: opp.type required');
  }
  if (!opp.contact_id) {
    throw new Error('blinker-platform/api opportunities.create: opp.contact_id required');
  }
  const now = new Date().toISOString();
  const record = {
    ...opp,
    id: _ensureId(opp),
    created_at: opp.created_at || now,
    updated_at: opp.updated_at || now,
  };
  if (typeof _writer === 'function') {
    const persisted = _writer(record);
    return persisted || record;
  }
  if (!_warnedNoWriter) {
    _warnedNoWriter = true;
    // eslint-disable-next-line no-console
    console.warn(
      '[blinker-platform/api] opportunities.create() invoked with no writer ' +
        'registered — running in fixture-mode echo. Call ' +
        'registerOpportunityWriter(fn) at app boot to persist. ' +
        '(This warning fires once per page load.)',
    );
  }
  return record;
}
