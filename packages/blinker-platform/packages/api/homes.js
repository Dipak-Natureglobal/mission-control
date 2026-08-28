// Phase 1 homes API — fixture-backed reads + a writer-delegated create.
//
// ADR 30 D1/D2. `home` is a first-class canon entity, sibling to `vehicle`.
// The one structural difference from every other entity here: a home belongs
// to MULTIPLE contacts (`contact_ids[]`), because the Omega home agreement has
// two agreement-holder slots. So `list({ contact_id })` matches membership in
// that array, not equality against a single owner field.
//
// Mutations follow the opportunities.js writer-registration model rather than
// the notes/activities localStorage-overlay model: mission-control owns
// session persistence for contact-graph entities, and a home must land in the
// same session store as the contact it attaches to.
//
// Canon shape (mirrors canon/blinker-domain.json#home and matches
// _fixtures/homes.json — keyed by home_id):
//
//   {
//     id, org_id, household_id,
//     contact_ids[], primary_contact_id,
//     home_type, address{}, year_built, square_feet,
//     purchase_price, disposition, source,
//     created_at, updated_at,
//     _test_case?,   // fixture-only annotation
//   }
//
// `dwelling_class` is DERIVED, never stored — compute it with
// packages/utils/dwelling-class.js#classifyDwelling so a canon bucket change
// does not require rewriting records.

import homesFixture from './_fixtures/homes.json' with { type: 'json' };

let _writer = null;
let _warnedNoWriter = false;

function _records() {
  const block = homesFixture.homes;
  if (!block || typeof block !== 'object') return [];
  return Object.values(block);
}

/**
 * List homes, newest first.
 *
 * Filters:
 *   - org_id: number       — restrict to a single org
 *   - contact_id: string   — homes this contact is a holder on (membership in
 *                            contact_ids, NOT primary_contact_id — a secondary
 *                            holder's profile must still show the home)
 *   - household_id: string — homes attached to a household
 *
 * @returns {Array<object>}
 */
export function list({ org_id, contact_id, household_id } = {}) {
  let rows = _records();
  if (typeof org_id === 'number') rows = rows.filter((h) => h.org_id === org_id);
  if (contact_id) {
    rows = rows.filter((h) => Array.isArray(h.contact_ids) && h.contact_ids.includes(contact_id));
  }
  if (household_id) rows = rows.filter((h) => h.household_id === household_id);
  return rows
    .slice()
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

/**
 * @param {string} id
 * @returns {object|null}
 */
export function get(id) {
  if (!id) return null;
  return homesFixture.homes?.[id] ?? null;
}

/**
 * @returns {Record<string, object>} id → home
 */
export function asMap() {
  const out = {};
  for (const h of _records()) out[h.id] = h;
  return out;
}

/**
 * Register the host app's persistence function (mission-control's
 * session-data.appendHome). Last registration wins; pass null to unregister.
 *
 * @param {Function|null} fn
 */
export function registerHomeWriter(fn) {
  _writer = typeof fn === 'function' ? fn : null;
  _warnedNoWriter = false;
}

function _ensureId(home) {
  if (home && home.id) return home.id;
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `home_new_${crypto.randomUUID()}`;
  }
  return `home_new_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Create a home. Phase 1 delegates to the registered writer; with none
 * registered it warns once and echoes the record so standalone portal callers
 * still work in fixture mode. Phase 2 replaces the body with a real POST; the
 * signature does not change.
 *
 * @param {object} home  at minimum { org_id, primary_contact_id, home_type, address, square_feet }
 * @returns {object} the persisted record (or the echo)
 */
export function create(home = {}) {
  if (!home || typeof home !== 'object') {
    throw new Error('blinker-platform/api homes.create: home object required');
  }
  if (!home.primary_contact_id) {
    throw new Error('blinker-platform/api homes.create: home.primary_contact_id required');
  }
  if (!home.home_type) {
    throw new Error('blinker-platform/api homes.create: home.home_type required');
  }

  // primary_contact_id must always appear in contact_ids — the agreement's
  // first holder is a holder.
  const contactIds = Array.isArray(home.contact_ids) && home.contact_ids.length
    ? [...new Set([home.primary_contact_id, ...home.contact_ids])]
    : [home.primary_contact_id];

  const now = new Date().toISOString();
  const record = {
    ...home,
    id: _ensureId(home),
    contact_ids: contactIds,
    source: home.source || 'manual',
    created_at: home.created_at || now,
    updated_at: home.updated_at || now,
  };

  if (typeof _writer === 'function') {
    const persisted = _writer(record);
    return persisted || record;
  }
  if (!_warnedNoWriter) {
    _warnedNoWriter = true;
    // eslint-disable-next-line no-console
    console.warn(
      '[blinker-platform/api] homes.create() invoked with no writer registered '
      + '— running in fixture-mode echo. Call registerHomeWriter(fn) at app boot '
      + 'to persist. (This warning fires once per page load.)',
    );
  }
  return record;
}

export default { list, get, asMap, create, registerHomeWriter };
