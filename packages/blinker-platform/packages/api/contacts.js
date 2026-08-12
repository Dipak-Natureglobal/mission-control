// Phase 1 contacts API — fixture-backed reads.
//
// Contacts mutations in Phase 1 still flow through
// `mission-control/src/lib/session-data.js` (appendContact /
// appendVehicleToContact / updateContactVehicle / dedupAndUpsertVehicle —
// localStorage-overlayed, session-scoped). When the next migration wave
// lifts those into this module, follow the notes.js / activities.js
// pattern: localStorage overlay keyed `blinker.contacts.v1.<contact_id>`,
// fixture seed on first read, append-friendly write helpers.
//
// Today this module exposes read-only `list()` / `get(id)` so that
// AgentInbox + AgentContacts + ContactProfile can consume canonical
// contact data without each child app importing the JSON directly.
//
// Canon shape (mirrors canon/blinker-domain.json `contact` and matches
// _fixtures/contacts.json — keyed by contact_id):
//
//   {
//     id, org_id, external_ids, household_id,
//     name: { first, last, preferred? },
//     phones[], emails[], addresses[], vehicles[],
//     opportunity_ids[], household_member_ids[], tags[],
//     notes_ref, activities_ref, attribution_data, consent,
//     created_at, updated_at,
//     _test_case?,    // fixture-only annotation (test/demo modes)
//   }

import contactsFixture from './_fixtures/contacts.json';

function _records() {
  const block = contactsFixture.contacts;
  if (!block || typeof block !== 'object') return [];
  return Object.values(block);
}

/**
 * List all contacts. Returns a fresh array of contact records (newest
 * `created_at` first to match notes/activities ordering — keeps the
 * Contacts surface stable as new fixtures are added at the bottom or
 * sprinkled in).
 *
 * Filters available:
 *   - org_id: number — restrict to a single org
 *   - has_opportunity: boolean — only contacts with (or without) opportunities
 */
export function list({ org_id, has_opportunity } = {}) {
  let rows = _records();
  if (typeof org_id === 'number') rows = rows.filter((c) => c.org_id === org_id);
  if (typeof has_opportunity === 'boolean') {
    rows = rows.filter((c) => {
      const has = Array.isArray(c.opportunity_ids) && c.opportunity_ids.length > 0;
      return has === has_opportunity;
    });
  }
  return rows
    .slice()
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

/**
 * Look up a single contact by id. Returns the contact record or null.
 */
export function get(id) {
  if (!id) return null;
  const block = contactsFixture.contacts;
  if (!block || typeof block !== 'object') return null;
  return block[id] || null;
}

/**
 * Convenience: return the contacts as a `{ [id]: contact }` map. mc's
 * session-data.js seeds session state from this shape, so exposing a map
 * accessor avoids re-keying at the consumer.
 */
export function asMap() {
  const block = contactsFixture.contacts;
  if (!block || typeof block !== 'object') return {};
  return { ...block };
}

// ── Cross-org cascade (Wave 28e + Wave 29a v3.0.10 Task 1) ───────────
//
// Two flavors:
//   - crossOrgMove(contactId, fromOrgId, toOrgId, { session?, policy? })
//   - crossOrgCopy(contactId, fromOrgId, toOrgId, { session?, policy? })
//
// The shape of `policy` mirrors canon/org-registry.json _cross_org_assignment_shape:
//   { contact_mode: 'copy' | 'move',
//     opportunity_mode: 'copy' | 'move',
//     mark_contact_readonly_on_copy: boolean,
//     mark_opportunity_readonly_on_copy: boolean }
//
// Default policy is { contact_mode: 'move', opportunity_mode: 'move' } so
// the W28e single-arg / no-policy callers keep their existing semantics
// while new W29a callers route the per-org policy through.
//
// Phase 1 is a best-effort in-memory + localStorage mutation. When a
// `session` handle is provided (mc/src/lib/session-data.useSessionData()),
// move re-stamps the contact's org_id via `patchContact`; copy duplicates
// the contact via `appendContact` (linking via `source_contact_id`) and
// flags the source mirror readonly when policy requires. Without a session
// handle the call still writes the `blinker.contacts.cross_org.v1`
// localStorage trail so Phase 2 migrations have a recoverable record of
// demo-time cross-org actions.
//
// _TODO: Phase 2 server-side cascade with audit log. The server walks
// (contact, vehicles, opportunities, activities, notes, tags) and
// re-stamps any org_id columns + emits an audit record. The Phase 1
// helpers exist primarily so the UI confirmation modal has somewhere
// real to dispatch.

const CROSS_ORG_TRAIL_KEY = 'blinker.contacts.cross_org.v1';

function _appendTrail(entry) {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(CROSS_ORG_TRAIL_KEY);
    const entries = raw ? JSON.parse(raw) : [];
    entries.push(entry);
    localStorage.setItem(CROSS_ORG_TRAIL_KEY, JSON.stringify(entries));
  } catch {
    // ignore
  }
}

const DEFAULT_MOVE_POLICY = {
  contact_mode: 'move',
  opportunity_mode: 'move',
  mark_contact_readonly_on_copy: true,
  mark_opportunity_readonly_on_copy: true,
};

const DEFAULT_COPY_POLICY = {
  contact_mode: 'copy',
  opportunity_mode: 'copy',
  mark_contact_readonly_on_copy: true,
  mark_opportunity_readonly_on_copy: true,
};

export function crossOrgMove(contactId, fromOrgId, toOrgId, opts = {}) {
  if (!contactId || typeof toOrgId !== 'number') {
    return { moved_opps: 0, moved_activities: 0, ok: false };
  }
  const contact = get(contactId);
  if (!contact) return { moved_opps: 0, moved_activities: 0, ok: false };

  const session = opts.session || null;
  const policy = { ...DEFAULT_MOVE_POLICY, ...(opts.policy || {}) };

  // Patch the contact's org_id via session (live UI updates) when available.
  if (session && typeof session.patchContact === 'function') {
    session.patchContact(contactId, { org_id: toOrgId });
  }

  // Count what would cascade. Opportunities don't carry org_id in fixtures
  // today (they hop through contact.org_id), so the "moved" count here is
  // the count of related rows the Phase 2 cascade would touch — surfaces
  // through telemetry as a magnitude indicator.
  const oppIds = Array.isArray(contact.opportunity_ids)
    ? contact.opportunity_ids
    : [];
  const movedOpps = oppIds.length;
  const movedActivities = 0;

  _appendTrail({
    mode: 'move',
    contact_id: contactId,
    from_org_id: fromOrgId,
    to_org_id: toOrgId,
    moved_at: new Date().toISOString(),
    moved_opp_ids: oppIds,
    policy,
  });

  return {
    moved_opps: movedOpps,
    moved_activities: movedActivities,
    ok: true,
  };
}

/**
 * Duplicate a contact (and its opportunity refs) into a different org,
 * leaving a flagged-readonly mirror on the source. Returns
 * `{ source_contact_id, dest_contact_id, copied_opps, copied_activities,
 *    readonly_applied: { contact, opportunities } }`.
 *
 * Phase 1: writes via `session.appendContact` when available; otherwise
 * the call still records the intent in the cross-org localStorage trail.
 */
export function crossOrgCopy(contactId, fromOrgId, toOrgId, opts = {}) {
  if (!contactId || typeof toOrgId !== 'number') {
    return {
      source_contact_id: contactId || null,
      dest_contact_id: null,
      copied_opps: 0,
      copied_activities: 0,
      readonly_applied: { contact: false, opportunities: 0 },
      ok: false,
    };
  }
  const contact = get(contactId);
  if (!contact) {
    return {
      source_contact_id: contactId,
      dest_contact_id: null,
      copied_opps: 0,
      copied_activities: 0,
      readonly_applied: { contact: false, opportunities: 0 },
      ok: false,
    };
  }

  const session = opts.session || null;
  const policy = { ...DEFAULT_COPY_POLICY, ...(opts.policy || {}) };

  // Mint a fresh destination contact id. Stable suffix lets demo smoke
  // recognize copies; Phase 2 server returns a real uuid.
  const destContactId = `${contactId}__copy_${toOrgId}_${Date.now()}`;
  const nowIso = new Date().toISOString();

  const oppIds = Array.isArray(contact.opportunity_ids)
    ? contact.opportunity_ids
    : [];

  const destContact = {
    ...contact,
    id: destContactId,
    org_id: toOrgId,
    source_contact_id: contactId,
    created_at: nowIso,
    updated_at: nowIso,
  };

  // Mirror flags on the SOURCE contact when policy requires.
  if (session) {
    if (typeof session.appendContact === 'function') {
      session.appendContact(destContact);
    }
    if (
      policy.mark_contact_readonly_on_copy &&
      typeof session.patchContact === 'function'
    ) {
      session.patchContact(contactId, {
        readonly: true,
        readonly_reason: 'cross_org_copy',
        cross_org_copy_dest_id: destContactId,
      });
    }
    // Phase 1 only marks the SOURCE opportunities readonly on the session
    // mirror; the destination opps stay active under the new contact id.
    // Until opp duplication lands server-side, we rely on the source
    // opp.readonly flag (read by mc inbox/copilot) to block continued work.
    if (
      policy.mark_opportunity_readonly_on_copy &&
      typeof session.updateOpportunity === 'function'
    ) {
      for (const oppId of oppIds) {
        session.updateOpportunity(oppId, {
          readonly: true,
          readonly_reason: 'cross_org_copy',
          cross_org_copy_dest_contact_id: destContactId,
        });
      }
    }
  }

  _appendTrail({
    mode: 'copy',
    source_contact_id: contactId,
    dest_contact_id: destContactId,
    from_org_id: fromOrgId,
    to_org_id: toOrgId,
    copied_at: nowIso,
    copied_opp_ids: oppIds,
    policy,
  });

  return {
    source_contact_id: contactId,
    dest_contact_id: destContactId,
    copied_opps: oppIds.length,
    copied_activities: 0,
    readonly_applied: {
      contact: !!policy.mark_contact_readonly_on_copy,
      opportunities: policy.mark_opportunity_readonly_on_copy ? oppIds.length : 0,
    },
    ok: true,
  };
}
