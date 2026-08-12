// super-admin-storage.js — localStorage shim for the super-admin shell
// (Wave 19 Task 6 + Wave 20 Task 1+2 expansion).
//
// Scope:
//   * users                       — overlays src/fixtures/users.json
//   * orgs                        — overlays src/constants/canon/org-registry.json
//   * persona_presets             — sourced from src/constants/canon/personas.json#personas.<id>.presets
//                                   (Wave 20 — switched FROM src/fixtures/persona-presets.json which is
//                                    now DEPRECATED-DELETE-AFTER-VERIFY)
//   * relationship_types_custom   — per-org custom relationship-type overrides
//                                   (Wave 20 — replaces src/fixtures/relationship-types-custom.json
//                                    as the write surface; canon ships the empty default)
//
// Why a separate file from contact-storage.js: a parallel agent is editing
// contact-storage.js in this same wave; isolating super-admin persistence
// avoids a merge race. Same conventions, different keys. We can consolidate
// in a 3-strikes lift once both agents land.
//
// Storage keys:
//   * blinker.super.users.v1                          → User[]
//   * blinker.super.orgs.v1                           → Org[]
//   * blinker.super.persona_presets.v1                → PresetMap
//   * blinker.super_admin.relationship_types_custom.v1 → { [org_id]: CustomType[] }
//
// Each list is seeded ONCE per browser from the bundled fixture/canon copy on
// first read. Subsequent reads come from localStorage. A `reset*` helper
// clears the key so the next read re-seeds.
//
// Phase 2 swap point: replace function bodies with `await blinkerApi.users.*`
// / `await blinkerApi.orgs.*` / `await blinkerApi.personaPresets.*` /
// `await blinkerApi.relationshipTypes.*` calls. Public signatures stay stable —
// UserDirectory / OrgRegistry don't change.

import usersFixture from '../fixtures/users.json';
import orgRegistry from '../constants/canon/org-registry.json';
import personasCanon from '../constants/canon/personas.json';
import relationshipsCanon from '../constants/canon/relationships.json';

const KEY_USERS = 'blinker.super.users.v1';
const KEY_ORGS = 'blinker.super.orgs.v1';
const KEY_PRESETS = 'blinker.super.persona_presets.v1';
const KEY_RELATIONSHIP_TYPES_CUSTOM =
  'blinker.super_admin.relationship_types_custom.v1';

// ─── tiny localStorage helpers ─────────────────────────────────────────────

function _read(key) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function _write(key, value) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[super-admin-storage] write failed (in-memory only):', err);
  }
}

function _clear(key) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(key);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[super-admin-storage] clear failed:', err);
  }
}

// ─── users ─────────────────────────────────────────────────────────────────

// Normalize a single user record from the legacy `org_id: int` shape to
// `org_ids: int[]`. Safe to call on records that already use org_ids.
// Phase 2 swap point: drop this once the API always returns org_ids.
function _normalizeUser(u) {
  if (Array.isArray(u.org_ids)) return u;
  // Legacy shape: has org_id but no org_ids.
  const ids = u.org_id != null ? [u.org_id] : [];
  const { org_id: _dropped, ...rest } = u; // eslint-disable-line no-unused-vars
  return { ...rest, org_ids: ids };
}

// Always returns an int[] even if the record is still in the legacy shape.
export function getUserOrgIds(user) {
  if (Array.isArray(user.org_ids)) return user.org_ids;
  if (user.org_id != null) return [user.org_id];
  return [];
}

export function listUsers() {
  const stored = _read(KEY_USERS);
  if (Array.isArray(stored)) return stored.map(_normalizeUser);
  const seed = (usersFixture.users || []).map((u) => _normalizeUser({ ...u }));
  _write(KEY_USERS, seed);
  return seed;
}

function _saveUsers(users) {
  _write(KEY_USERS, users);
  return users;
}

export function addUser(user) {
  const users = listUsers();
  // Generate a stable id if caller didn't supply one.
  const id = user.id || `u_${Date.now().toString(36)}`;
  const next = _normalizeUser({
    id,
    first_name: '',
    last_name: '',
    email: '',
    persona: 'agent',
    preset_id: null,
    added_badges: [],
    removed_badges: [],
    status: 'active',
    org_ids: [],
    last_active_at: null,
    created_at: new Date().toISOString(),
    ...user,
    id,
  });
  return _saveUsers([...users, next]);
}

export function updateUser(id, patch) {
  const users = listUsers();
  return _saveUsers(
    users.map((u) => (u.id === id ? { ...u, ...patch } : u)),
  );
}

export function deleteUser(id) {
  const users = listUsers();
  return _saveUsers(users.filter((u) => u.id !== id));
}

export function resetPassword(id) {
  // Phase 1: stub — no actual credential mutation; fixture just records the
  // timestamp so the UI can confirm the reset and PostHog can fire.
  return updateUser(id, { _last_password_reset_at: new Date().toISOString() });
}

export function resetUsersToFixture() {
  _clear(KEY_USERS);
  return listUsers();
}

// ─── orgs ──────────────────────────────────────────────────────────────────

export function listOrgs() {
  const stored = _read(KEY_ORGS);
  if (Array.isArray(stored)) return stored;
  const seed = (orgRegistry.orgs || []).map((o) => ({ ...o }));
  _write(KEY_ORGS, seed);
  return seed;
}

function _saveOrgs(orgs) {
  _write(KEY_ORGS, orgs);
  return orgs;
}

// W20 — defaults for the new v3.0.3 hierarchical config blocks. Used both as
// addOrg seed AND as the read-side fallback so OrgRegistry can render an
// uninitialized org without null-checks at every input.
export const DEFAULT_SYSTEM = {
  code: '',
  name_legal: '',
  name_dba: '',
  contact_email: '',
  contact_phone: '',
  support_email: '',
  support_phone: '',
  info_email: '',
  feedback_email: '',
  faq_url: '',
  support_hours_text: '',
  default_owner_id: null,
  call_center_name: '',
  call_center_logo_path: '',
  call_center_link: '',
  call_center_code: 'AMR2',
};

export const DEFAULT_CONTACTS = {
  do_not_contact_policy: 'honor',
  dedup_match_fields: ['email', 'phone'],
  tag_presets: [],
  tcpa_consent_copy: '',
};

export const DEFAULT_REFI = {
  enabled: false,
  min_term: 12,
  max_term: 84,
  estimated_payment_term: 60,
  estimated_payment_down_pct: 0,
  min_monthly_payment: 50,
  max_monthly_payment: 2000,
  max_vehicle_age: 15,
  max_vehicle_mileage: 200000,
  max_min_amount_financed: 50000,
  refi_min_pmt_diff: 50,
  refi_min_cash_back: 500,
  cross_sell_protection_enabled: false,
  cross_sell_insurance_enabled: false,
};

export const DEFAULT_INSURANCE = {
  enabled: false,
  quote_display_mode: 'summary',
};

export const DEFAULT_PROTECTION = {
  enabled: true,
  discount: { max_percent: 20, max_dollars: 540, disabled_in_states: ['FL'] },
  down_payment: { default_percent: 10, min_percent: 10, max_percent_of_total: 75 },
  first_payment_date: { default_strategy: 'first_of_next_month', min_days_from_today: 31, max_days_from_today: 45 },
  payment_term: { options_months: [1, 6, 12, 18, 24], default_months: 12 },
  markup: { default_dollars: 2700, florida_dollars: 2550 },
  validation_discount_max: 0,
};

export const DEFAULT_PAYMENTS = {
  primary_processor: 'fluidpay',
  lienholder_default: 'EFS',
  payment_confirmation_required: false,
  processing_fee_percent: 0,
  refund_policy_days: 30,
};

export function addOrg(org) {
  const orgs = listOrgs();
  // Pick a numeric id one above the current max so we don't collide with
  // canon ids (canon orgs sit in the 1-110 range).
  const nextId = orgs.reduce((max, o) => Math.max(max, Number(o.id) || 0), 0) + 1;
  const next = {
    id: nextId,
    name: 'New Org',
    type: 'child',
    status: 'paused',
    parent_org_id: null,
    timezone: 'America/Chicago',
    test_mode: false,
    integrations: {},
    vehicle_defaults: { annual_mileage_estimate: 12000 },
    // Legacy W19 flat blocks — kept for back-compat with consumers that read
    // org.cross_sell / org.protection_billing directly. The new hierarchical
    // blocks below are the authoritative editor surface.
    cross_sell: { insurance_enabled: false, refi_enabled: false },
    protection_billing: {
      discount: { max_percent: 20, max_dollars: 540, disabled_in_states: ['FL'] },
      down_payment: { default_percent: 10, min_percent: 10, max_percent_of_total: 75 },
      first_payment_date: { default_strategy: 'first_of_next_month', min_days_from_today: 31, max_days_from_today: 45 },
      payment_term: { options_months: [1, 6, 12, 18, 24], default_months: 12 },
      markup: { default_dollars: 2700, florida_dollars: 2550 },
    },
    // W20 v3.0.3 hierarchical blocks.
    system: { ...DEFAULT_SYSTEM },
    contacts: { ...DEFAULT_CONTACTS },
    opportunities: {
      refinance: { ...DEFAULT_REFI },
      insurance: { ...DEFAULT_INSURANCE },
      protection: JSON.parse(JSON.stringify(DEFAULT_PROTECTION)),
    },
    payments: { ...DEFAULT_PAYMENTS },
    ...org,
    id: org.id != null ? org.id : nextId,
  };
  return _saveOrgs([...orgs, next]);
}

// W20 — fold defaults into a possibly-partial org so editors always have a
// fully-populated shape to bind inputs against. Pure read; no persistence.
// Preserves any pre-existing values on the org record (canon-seeded orgs only
// carry the W19-era cross_sell + protection_billing blocks, so the new
// hierarchical blocks are seeded fresh).
export function withConfigDefaults(org) {
  if (!org) return org;
  const proto = org.opportunities?.protection || {};
  const protectionMerged = {
    ...JSON.parse(JSON.stringify(DEFAULT_PROTECTION)),
    ...proto,
    // Mirror the legacy protection_billing block when present so the canon-
    // seeded orgs (which only carry protection_billing) bring those values
    // into the new opportunities.protection editor.
    ...(org.protection_billing || {}),
  };
  return {
    ...org,
    system: { ...DEFAULT_SYSTEM, ...(org.system || {}) },
    contacts: { ...DEFAULT_CONTACTS, ...(org.contacts || {}) },
    opportunities: {
      refinance: {
        ...DEFAULT_REFI,
        // Seed enabled from the legacy cross_sell.refi_enabled when the new
        // hierarchical block is missing.
        ...(org.cross_sell?.refi_enabled != null ? { enabled: !!org.cross_sell.refi_enabled } : {}),
        ...(org.cross_sell?.protection_plan_financing
          ? { protection_plan_financing: org.cross_sell.protection_plan_financing }
          : {}),
        ...(org.opportunities?.refinance || {}),
      },
      insurance: {
        ...DEFAULT_INSURANCE,
        ...(org.cross_sell?.insurance_enabled != null ? { enabled: !!org.cross_sell.insurance_enabled } : {}),
        ...(org.opportunities?.insurance || {}),
      },
      protection: protectionMerged,
    },
    payments: { ...DEFAULT_PAYMENTS, ...(org.payments || {}) },
  };
}

export function updateOrg(id, patch) {
  const orgs = listOrgs();
  return _saveOrgs(
    orgs.map((o) => (o.id === id ? { ...o, ...patch } : o)),
  );
}

export function copyOrg(id) {
  const orgs = listOrgs();
  const src = orgs.find((o) => o.id === id);
  if (!src) return orgs;
  const nextId = orgs.reduce((max, o) => Math.max(max, Number(o.id) || 0), 0) + 1;
  const copy = {
    ...src,
    id: nextId,
    name: `${src.name}_copy`,
    ghl_location_id: null, // child copies start without their own GHL anchor
    status: 'paused',
  };
  return _saveOrgs([...orgs, copy]);
}

export function deleteOrg(id) {
  const orgs = listOrgs();
  return _saveOrgs(orgs.filter((o) => o.id !== id));
}

export function resetOrgsToCanon() {
  _clear(KEY_ORGS);
  return listOrgs();
}

// Returns ids that may legally be a parent for `selfId` — excludes self and
// any descendants (so we don't create cycles).
export function eligibleParents(orgs, selfId) {
  if (selfId == null) return orgs;
  const descendants = new Set();
  function collect(id) {
    descendants.add(id);
    for (const o of orgs) {
      if (o.parent_org_id === id) collect(o.id);
    }
  }
  collect(selfId);
  return orgs.filter((o) => !descendants.has(o.id));
}

// ─── persona presets ───────────────────────────────────────────────────────
//
// W20 — switched read source from src/fixtures/persona-presets.json to
// src/constants/canon/personas.json#personas.<id>.presets. The canon shape
// is `personas: { <id>: { presets: PresetDef[] } }`; the public API of this
// module still returns a flat map `{ <persona_id>: PresetDef[] }` so
// UserDirectory keeps working unchanged. Once the user verifies the smoke,
// the fixture file (marked DEPRECATED-DELETE-AFTER-VERIFY) can be deleted.

function _seedPresetsFromCanon() {
  const personas = personasCanon.personas || {};
  const out = {};
  for (const [pid, def] of Object.entries(personas)) {
    if (Array.isArray(def?.presets)) {
      out[pid] = JSON.parse(JSON.stringify(def.presets));
    }
  }
  return out;
}

export function listPresets() {
  const stored = _read(KEY_PRESETS);
  if (stored && typeof stored === 'object') return stored;
  const seed = _seedPresetsFromCanon();
  _write(KEY_PRESETS, seed);
  return seed;
}

function _savePresets(presets) {
  _write(KEY_PRESETS, presets);
  return presets;
}

export function upsertPreset(persona, preset) {
  const all = listPresets();
  const existing = Array.isArray(all[persona]) ? all[persona] : [];
  const idx = existing.findIndex((p) => p.id === preset.id);
  const next =
    idx >= 0
      ? existing.map((p, i) => (i === idx ? { ...p, ...preset } : p))
      : [...existing, preset];
  return _savePresets({ ...all, [persona]: next });
}

export function deletePreset(persona, presetId) {
  const all = listPresets();
  const existing = Array.isArray(all[persona]) ? all[persona] : [];
  return _savePresets({
    ...all,
    [persona]: existing.filter((p) => p.id !== presetId),
  });
}

export function resetPresetsToFixture() {
  _clear(KEY_PRESETS);
  return listPresets();
}

// ─── relationship-type overrides (per-org custom) ──────────────────────────
//
// W20 — closes the W19 backlog item "wire super-admin Manage Relationship
// Types UI". canon/relationships.json carries `system_types` (immutable) +
// `custom_types_per_org` (an empty object by default). This shim persists
// per-org additions to localStorage; HouseholdSection / RelationshipPicker
// consume the union of system + custom (system wins on collision).
//
// Storage shape: { [org_id_string]: CustomType[] }
// CustomType: { id, label, category, added_by?, added_at? }

const RELATIONSHIP_CATEGORIES = ['household', 'extended', 'cohabitant', 'other'];

export function getRelationshipCategories() {
  return [...RELATIONSHIP_CATEGORIES];
}

export function getSystemRelationshipTypes() {
  return Array.isArray(relationshipsCanon.system_types)
    ? JSON.parse(JSON.stringify(relationshipsCanon.system_types))
    : [];
}

function _readRelationshipOverrides() {
  const stored = _read(KEY_RELATIONSHIP_TYPES_CUSTOM);
  if (stored && typeof stored === 'object') return stored;
  // Seed from canon's empty default (canon ships {} on first ever load).
  const seed = JSON.parse(
    JSON.stringify(relationshipsCanon.custom_types_per_org || {}),
  );
  _write(KEY_RELATIONSHIP_TYPES_CUSTOM, seed);
  return seed;
}

function _writeRelationshipOverrides(map) {
  _write(KEY_RELATIONSHIP_TYPES_CUSTOM, map);
  return map;
}

export function listRelationshipTypeOverrides(orgId) {
  if (orgId == null) return [];
  const map = _readRelationshipOverrides();
  const list = map[String(orgId)];
  return Array.isArray(list) ? list : [];
}

// Returns { ok: true } | { ok: false, error: string }
export function addRelationshipTypeOverride(orgId, entry, addedByUserId = null) {
  if (orgId == null) return { ok: false, error: 'orgId required' };
  const id = (entry?.id || '').trim();
  const label = (entry?.label || '').trim();
  const category = (entry?.category || '').trim();
  if (!id) return { ok: false, error: 'id required' };
  if (!/^[a-z][a-z0-9_]*$/.test(id)) {
    return { ok: false, error: 'id must be snake_case (lowercase letters, digits, underscore; start with a letter)' };
  }
  if (!label) return { ok: false, error: 'label required' };
  if (!RELATIONSHIP_CATEGORIES.includes(category)) {
    return { ok: false, error: `category must be one of ${RELATIONSHIP_CATEGORIES.join(', ')}` };
  }
  // Collision check vs system_types.
  const sys = getSystemRelationshipTypes();
  if (sys.some((s) => s.id === id)) {
    return { ok: false, error: `id "${id}" collides with a system relationship type` };
  }
  // Collision check vs existing org overrides.
  const existing = listRelationshipTypeOverrides(orgId);
  if (existing.some((e) => e.id === id)) {
    return { ok: false, error: `id "${id}" already exists for this org` };
  }
  const map = _readRelationshipOverrides();
  const next = {
    id,
    label,
    category,
    added_by: addedByUserId,
    added_at: new Date().toISOString(),
  };
  const orgKey = String(orgId);
  const updated = { ...map, [orgKey]: [...existing, next] };
  _writeRelationshipOverrides(updated);
  return { ok: true, entry: next };
}

export function removeRelationshipTypeOverride(orgId, entryId) {
  if (orgId == null) return { ok: false, error: 'orgId required' };
  const map = _readRelationshipOverrides();
  const orgKey = String(orgId);
  const existing = Array.isArray(map[orgKey]) ? map[orgKey] : [];
  const filtered = existing.filter((e) => e.id !== entryId);
  const updated = { ...map, [orgKey]: filtered };
  _writeRelationshipOverrides(updated);
  return { ok: true };
}

export function resetRelationshipTypeOverrides() {
  _clear(KEY_RELATIONSHIP_TYPES_CUSTOM);
  return _readRelationshipOverrides();
}
