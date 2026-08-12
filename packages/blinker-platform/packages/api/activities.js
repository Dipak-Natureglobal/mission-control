// Phase 1 activities API — localStorage-backed, fixture-seeded.
//
// Canon shape (mirrors canon/blinker-domain.json `activity` and matches
// _fixtures/activities.json):
//
//   {
//     id,                  // 'a_session_<uuid>' for runtime-created
//     contact_id,          // FK
//     opportunity_id?,     // FK or null (null = contact-level activity)
//     type,                // 'note' | 'agent_action' | 'status_change' |
//                          // 'call' | 'sms' | 'partner_event' | ...
//     occurred_at,         // ISO
//     source,              // 'agent' | 'system' | 'consumer' | 'partner'
//     actor_id?,           // 'agent_session' for runtime, fixture-specific otherwise
//     payload,             // type-specific structured data
//     summary_text,        // human-readable line for the timeline
//     _session?: true,     // runtime-created marker
//   }
//
// Activity types currently produced at runtime by callers:
//   - 'note' (via `addNote()` in index.js — payload: { note_id })
//
// Phase 2 swap point: replace function bodies with API calls. Stable
// public signatures so consumers don't change.
//
// Storage keys: `blinker.activities.v1.<contact_id>`. Same fixture-seed-
// then-localStorage semantics as notes.js. Append-only.

import activitiesFixture from './_fixtures/activities.json';

const KEY_PREFIX = 'blinker.activities.v1.';

function _key(contactId) {
  return `${KEY_PREFIX}${contactId}`;
}

function _seedForContact(contactId) {
  return (activitiesFixture.activities || [])
    .filter((a) => a.contact_id === contactId)
    .slice()
    .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
}

function _readContact(contactId) {
  if (!contactId) return [];
  try {
    const raw =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(_key(contactId))
        : null;
    if (raw == null) return _seedForContact(contactId);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return _seedForContact(contactId);
    return parsed;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[blinker-platform/api] activities read failed, using fixture seed:', err);
    return _seedForContact(contactId);
  }
}

function _writeContact(contactId, arr) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(_key(contactId), JSON.stringify(arr));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[blinker-platform/api] activities write failed (in-memory only):', err);
  }
}

function _newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `a_session_${crypto.randomUUID()}`;
  }
  return `a_session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * List activities for a contact. Optional `opportunity_id` filter.
 * Returns newest-first.
 */
export function list({ contact_id, opportunity_id } = {}) {
  if (!contact_id) return [];
  const all = _readContact(contact_id);
  if (opportunity_id == null) return all;
  return all.filter((a) => a.opportunity_id === opportunity_id);
}

/**
 * Cross-contact activity feed. Returns activities across many contacts
 * (e.g. agent dashboard "recent activity" panel), newest-first, optionally
 * sliced to `limit`.
 *
 * Per-contact storage means we need the caller to declare which contacts
 * are in scope — pass `contact_ids: string[]`. When omitted, the SDK falls
 * back to every distinct `contact_id` in the seed fixture (preserves the
 * pre-SDK demo behavior where AgentHome read straight from the fixture).
 *
 * Each underlying read goes through the same fixture-seed-then-localStorage
 * pipeline as `list({ contact_id })`, so runtime-created activities (e.g.
 * notes added in ContactProfile) surface in the cross-contact feed as soon
 * as they're written.
 */
export function listAll({ contact_ids, limit } = {}) {
  const ids =
    Array.isArray(contact_ids) && contact_ids.length
      ? contact_ids
      : [...new Set((activitiesFixture.activities || []).map((a) => a.contact_id))];
  const merged = [];
  for (const id of ids) {
    const arr = _readContact(id);
    for (const a of arr) merged.push(a);
  }
  merged.sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
  if (typeof limit === 'number' && limit >= 0) return merged.slice(0, limit);
  return merged;
}

/**
 * Create a new activity record. Persists to localStorage and returns
 * the record.
 */
export function create({
  contact_id,
  opportunity_id = null,
  type,
  source = 'agent',
  actor_id = null,
  payload = {},
  summary_text = '',
} = {}) {
  if (!contact_id) throw new Error('blinker-platform/api activities.create: contact_id required');
  if (!type) throw new Error('blinker-platform/api activities.create: type required');
  const now = new Date().toISOString();
  const activity = {
    id: _newId(),
    contact_id,
    opportunity_id: opportunity_id || null,
    type,
    occurred_at: now,
    source,
    actor_id,
    payload,
    summary_text,
    _session: true,
  };
  const next = [activity, ..._readContact(contact_id)];
  _writeContact(contact_id, next);
  return activity;
}
