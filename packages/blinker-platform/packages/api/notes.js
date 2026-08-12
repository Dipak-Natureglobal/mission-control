// Phase 1 notes API — localStorage-backed, fixture-seeded.
//
// Canon shape (mirrors canon/blinker-domain.json `note` and matches the
// fixture under _fixtures/notes.json):
//
//   {
//     id,                  // 'n_session_<uuid>' for runtime-created
//     contact_id,          // FK
//     opportunity_id?,     // FK or null (null = contact-level note)
//     body,
//     author_id,           // 'agent_session' for runtime, fixture-specific otherwise
//     author_persona,      // 'agent' | 'manager' | 'admin' | 'super_admin'
//     created_at,          // ISO
//     updated_at,          // ISO (== created_at on first write)
//     _session?: true,     // runtime-created marker
//   }
//
// Phase 2 swap point — replace the function bodies with API calls. Public
// signatures stay stable so consumers keep working unchanged.
//
// Storage keys: `blinker.notes.v1.<contact_id>` per contact. Each value
// is the FULL note array for that contact (fixture + runtime). On first
// read for a contact with no localStorage entry, the fixture-filtered
// seed is returned. After any write, the localStorage entry holds the
// authoritative array; the fixture is only the initial seed.
//
// Append-only by design. Notes are an activity-log primitive — each call
// to `create` produces a new record + a paired activity (via the
// `addNote` helper in index.js). No update/delete in Phase 1; if the user
// wants to "edit", they create a new note.

import notesFixture from './_fixtures/notes.json';

const KEY_PREFIX = 'blinker.notes.v1.';

function _key(contactId) {
  return `${KEY_PREFIX}${contactId}`;
}

function _seedForContact(contactId) {
  return (notesFixture.notes || [])
    .filter((n) => n.contact_id === contactId)
    .slice()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
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
    console.warn('[blinker-platform/api] notes read failed, using fixture seed:', err);
    return _seedForContact(contactId);
  }
}

function _writeContact(contactId, arr) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(_key(contactId), JSON.stringify(arr));
  } catch (err) {
    // Quota exceeded / private mode — accept the loss; in-memory state
    // already updated upstream so the user sees their note this session.
    // eslint-disable-next-line no-console
    console.warn('[blinker-platform/api] notes write failed (in-memory only):', err);
  }
}

function _newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `n_session_${crypto.randomUUID()}`;
  }
  return `n_session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * List notes for a contact. Optional `opportunity_id` filter.
 * Returns newest-first.
 */
export function list({ contact_id, opportunity_id } = {}) {
  if (!contact_id) return [];
  const all = _readContact(contact_id);
  if (opportunity_id == null) return all;
  return all.filter((n) => n.opportunity_id === opportunity_id);
}

/**
 * Create a new note record. Persists to localStorage and returns the
 * record. Pair with `activities.create({ type: 'note', payload: {
 * note_id } })` for the activity-log dual-write — or use the `addNote`
 * helper exported from `index.js` which handles both atomically.
 */
export function create({
  contact_id,
  opportunity_id = null,
  body,
  author_id = null,
  author_persona = null,
} = {}) {
  if (!contact_id) throw new Error('blinker-platform/api notes.create: contact_id required');
  const trimmed = String(body || '').trim();
  if (!trimmed) throw new Error('blinker-platform/api notes.create: body required');
  const now = new Date().toISOString();
  const note = {
    id: _newId(),
    contact_id,
    opportunity_id: opportunity_id || null,
    body: trimmed,
    author_id,
    author_persona,
    created_at: now,
    updated_at: now,
    _session: true,
  };
  const next = [note, ..._readContact(contact_id)];
  _writeContact(contact_id, next);
  return note;
}
