// contact-storage.js — localStorage shim for contact-level tag + household
// persistence.
//
// Scope: tags + household members. Notes and activities are handled by the
// platform SDK (blinker-platform/api: blinkerApi.addNote,
// blinkerApi.activities.create).
//
// Storage key: `blinker.tags.v1.<contact_id>`
// Shape: Tag[] (matches canon/blinker-domain.json `tag` + TagPicker inventory)
//
//   {
//     id:         string  — stable id (from system-tags.json or generated)
//     name:       string  — display label
//     color:      string? — hex (#RRGGBB); null for legacy fixture tags without color
//     source:     string  — 'system' | 'by_org' | 'created' | 'blinker'
//     system:     boolean — true = non-removable
//     applied_at: string  — ISO timestamp
//     applied_by: string? — actor id / 'agent_session'
//   }
//
// Seed: on first read for a contact, the tags array is seeded from the
// contact record's own `tags` array (passed in by the caller — it comes from
// the session-data fixture map). Subsequent reads and all writes go through
// localStorage. This mirrors the pattern used by blinker-platform/api's
// notes.js and activities.js.
//
// Phase 2 swap: replace function bodies with `await blinkerApi.tags.*` calls.
// Public signatures stay stable; no ContactProfile changes required.

const KEY_PREFIX = 'blinker.tags.v1.';

function _key(contactId) {
  return `${KEY_PREFIX}${contactId}`;
}

function _read(contactId) {
  if (!contactId) return null;
  try {
    const raw =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(_key(contactId))
        : null;
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function _write(contactId, tags) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(_key(contactId), JSON.stringify(tags));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[contact-storage] tag write failed (in-memory only):', err);
  }
}

/**
 * List tags for a contact.
 *
 * On first call for a contact, seeds from `fixtureTags` (the tags[] array
 * from the contact record). Normalizes legacy fixture tags that lack `system`
 * and `color` fields so the TagPicker and ContactProfile can render them
 * consistently.
 *
 * Returns the stored tag array (newest additions first for session adds; seed
 * order preserved for fixture tags since they have no meaningful timestamp
 * ordering that beats their original fixture order).
 */
export function listTags({ contact_id, fixtureTags = [] }) {
  if (!contact_id) return [];
  const stored = _read(contact_id);
  if (stored !== null) return stored;
  // First read — seed from fixture and persist.
  const seeded = (fixtureTags || []).map((t) => ({
    ...t,
    // Normalize: older fixture tags use `source: 'system'` string rather
    // than a boolean `system` field. Derive the boolean from the source
    // field so TagPicker's `canAdd && !tag.system` remove-button gate works.
    system: t.system !== undefined ? Boolean(t.system) : t.source === 'system',
    // Fixture tags from contacts.json use color-less shapes; provide a
    // neutral fallback so the pill renders without a style crash.
    color: t.color || null,
  }));
  _write(contact_id, seeded);
  return seeded;
}

/**
 * Append a tag to the contact's stored list.
 * Idempotent on id — duplicate adds are silently dropped.
 * Returns the updated tag array.
 */
export function addTag({ contact_id, tag }) {
  if (!contact_id || !tag) return [];
  const current = _read(contact_id) || [];
  if (current.some((t) => t.id === tag.id)) return current;
  const next = [tag, ...current];
  _write(contact_id, next);
  return next;
}

/**
 * Remove a tag from the contact's stored list by id.
 * No-ops if the tag is marked system (caller should gate this too, but
 * double-checking here prevents accidental system-tag removal via direct
 * API misuse). Returns the updated tag array.
 */
export function removeTag({ contact_id, tag_id }) {
  if (!contact_id || !tag_id) return [];
  const current = _read(contact_id) || [];
  const target = current.find((t) => t.id === tag_id);
  // Refuse to remove system tags.
  if (target?.system) return current;
  const next = current.filter((t) => t.id !== tag_id);
  _write(contact_id, next);
  return next;
}

// ─── Household helpers ───────────────────────────────────────────────────
//
// Wave 19 Task 5. Storage layout (mirrors the tag pattern above so future
// migration into blinker-platform/api is mechanical):
//
//   blinker.household.v1.<contact_id> → HouseholdMemberLink[]
//   {
//     id:                 string  — 'hr_<uuid>' (one per relationship link)
//     member_contact_id:  string  — the OTHER contact's id
//     relationship:       string  — slug from canon/relationships.json
//                                   `system_types` (e.g. 'spouse') OR an
//                                   org-custom slug. Free-text "Other"
//                                   detail goes in `relationship_other`.
//     relationship_other: string? — free-text when relationship === 'other'
//     household_id:       string  — shared between both contacts'
//                                   stored links + mirrored on the contact
//                                   record (canon `contact.household_id`)
//     added_at:           string  — ISO; rendered via canon.js relativeTime
//     added_by:           string? — actor id / 'agent_session'
//   }
//
// The canonical household record itself (id + member_ids + cluster_method)
// is canon-stub today (see blinker-domain.json `household._TODO`); per-
// contact link records here are the prototype's best-fit until canon
// formalizes the entity. Phase 2 swap point: each function body becomes
// `await blinkerApi.households.{list,append,remove}` calls. Public
// signatures stay stable; no ContactProfile changes.
//
// Mint convention for new households (when a previously-solo contact gets
// their first member): `hh_<contactId>_<unix>`. Mirrors the existing
// `hh_alvarez_brooks` convention from contacts fixture (org-meaningful
// slug) while staying collision-free for runtime-minted households.

const HH_KEY_PREFIX = 'blinker.household.v1.';

function _hhKey(contactId) {
  return `${HH_KEY_PREFIX}${contactId}`;
}

function _hhRead(contactId) {
  if (!contactId) return null;
  try {
    const raw =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(_hhKey(contactId))
        : null;
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function _hhWrite(contactId, links) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(_hhKey(contactId), JSON.stringify(links));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[contact-storage] household write failed (in-memory only):', err);
  }
}

function _hhNewLinkId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `hr_${crypto.randomUUID()}`;
  }
  return `hr_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Mint a new household_id for a contact who is becoming a household head
 * for the first time. Format: `hh_<contactId>_<unix-ms>`.
 */
export function mintHouseholdId(contactId) {
  if (!contactId) return null;
  return `hh_${contactId}_${Date.now()}`;
}

/**
 * List household-member link records for a contact.
 *
 * Seed: on first read for a contact, seeds from the contact's existing
 * `household_member_ids[]` array (synthesizing minimal link records with
 * relationship='other' for backfill). Subsequent reads + all writes go
 * through localStorage. This mirrors `listTags()` above.
 *
 * Returns: HouseholdMemberLink[] (newest first).
 */
export function listHouseholdMembers({ contact_id, fixtureMemberIds = [], fixtureHouseholdId = null }) {
  if (!contact_id) return [];
  const stored = _hhRead(contact_id);
  if (stored !== null) return stored;
  // First read — seed from fixture member ids (relationship unknown for
  // pre-existing fixtures so we use 'other' as a neutral backfill; agent
  // can edit + re-add to upgrade).
  const seeded = (fixtureMemberIds || []).map((memberId) => ({
    id: _hhNewLinkId(),
    member_contact_id: memberId,
    relationship: 'other',
    relationship_other: '',
    household_id: fixtureHouseholdId || null,
    added_at: new Date().toISOString(),
    added_by: null,
  }));
  _hhWrite(contact_id, seeded);
  return seeded;
}

/**
 * Append a household-member link to the contact's stored list.
 *
 * Idempotent on member_contact_id — duplicate adds replace the existing
 * link's relationship field rather than minting a second link.
 *
 * Returns the updated link array.
 */
export function addHouseholdMember({
  contact_id,
  member_contact_id,
  relationship,
  relationship_other = '',
  household_id,
  added_at,
  added_by = 'agent_session',
}) {
  if (!contact_id || !member_contact_id || !relationship) return [];
  const current = _hhRead(contact_id) || [];
  const existingIdx = current.findIndex((l) => l.member_contact_id === member_contact_id);
  const link = {
    id: existingIdx >= 0 ? current[existingIdx].id : _hhNewLinkId(),
    member_contact_id,
    relationship,
    relationship_other: relationship === 'other' ? (relationship_other || '') : '',
    household_id: household_id || null,
    added_at: added_at || (existingIdx >= 0 ? current[existingIdx].added_at : new Date().toISOString()),
    added_by,
  };
  let next;
  if (existingIdx >= 0) {
    next = [...current];
    next[existingIdx] = link;
  } else {
    next = [link, ...current];
  }
  _hhWrite(contact_id, next);
  return next;
}

/**
 * Remove a household-member link by member_contact_id. Returns the
 * updated link array. Does NOT delete either contact record.
 */
export function removeHouseholdMember({ contact_id, member_contact_id }) {
  if (!contact_id || !member_contact_id) return [];
  const current = _hhRead(contact_id) || [];
  const next = current.filter((l) => l.member_contact_id !== member_contact_id);
  _hhWrite(contact_id, next);
  return next;
}
