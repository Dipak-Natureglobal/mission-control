// Phase 1 agents API — fixture-backed reads + derived workload.
//
// Manager-persona consumer. Drives the Team roster, the Inbox group-by-
// agent header counts, and the Assignment dropdown's workload-aware
// ranking (see architecture/19-manager-experience.md §9).
//
// Workload / conversion / stale counts are NOT stored on the fixture —
// they are computed at call time from opportunities.json so the same
// fixture changes that move the Inbox also move the manager surface
// without a separate sync step.
//
// Canon shape (matches _fixtures/agents.json):
//
//   {
//     id, name, email, persona, preset_id,
//     org_ids[], tags[],
//     last_active_at, created_at,
//   }
//
// Derived workload shape (added by list/get):
//
//   { open_count, stale_count, conversion, avg_handle_days }

import agentsFixture from './_fixtures/agents.json';
import opportunitiesFixture from './_fixtures/opportunities.json';

// _TODO(canon): promote LOSING_STATUSES / WINNING_STATUSES to a derived
// view over canon/ghl-status.json (crm_stage === 'Lost' / 'Won' /
// 'Cancelled' across vsc / insurance / refi / payments). Today we hard-
// code the slugs observed in opportunities.json — keeps this module
// self-contained until the canon-derived helper lands and avoids
// reaching across packages.
const LOSING_STATUSES = new Set([
  'Lost',
  'Abandoned',
  'Cancelled',
  'Cold',
  'Disqualified',
  'Declined',
  'Not Interested',
  'Payment Failed',
  'Working - Rejected',
]);

// _TODO(canon): same — promote to a canon-derived view. The "won" bucket
// for handle-time + conversion math needs to follow crm_stage === 'Won'
// across canon files. Today the fixture-observed terminal-success
// statuses are hard-coded.
const WINNING_STATUSES = new Set([
  'Won',
  'Booked',
  'Agreement Signed',
  'Product Agreement Signed',
  'Payment Agreement Signed',
  'Remitted',
  'Active',
  'Paid in Full',
  'Funded',
  'Policy Written',
]);

// _TODO(canon): the 7-day stale window should come from per-org SLA
// config (architecture/19-manager-experience.md §11). Falling back to
// 7 days for orgs without an SLA is also acceptable per the ADR — but
// today every call uses the constant.
const STALE_THRESHOLD_MS = 7 * 24 * 3600 * 1000;

// Lens windows (ms) — used to scope historical workload metrics
// (conversion + avg-handle-days) to a recent period. Open/stale counts
// are inherently "now" snapshots and never lens-filter.
const LENS_WINDOW_MS = {
  '7d': 7 * 24 * 3600 * 1000,
  '30d': 30 * 24 * 3600 * 1000,
  '90d': 90 * 24 * 3600 * 1000,
  // 'qtd' (quarter-to-date) is computed at call time relative to Date.now()
  // 'all' is a no-op (returns null window → no filter applied)
};

// Wave 29c — extended lens vocabulary mirrors the mission-control date
// lens used on Agent Home + AgentProfile. Returns an absolute { from, to }
// epoch-ms window so callers can apply inclusive bounds; back-compat
// _lensCutoff() wraps this for the legacy "from-only" filter shape.
function _utcStartOfDay(d) {
  const c = new Date(d);
  c.setUTCHours(0, 0, 0, 0);
  return c.getTime();
}
function _utcEndOfDay(d) {
  const c = new Date(d);
  c.setUTCHours(23, 59, 59, 999);
  return c.getTime();
}

export function lensRange(lens) {
  if (!lens || lens === 'all') return null;
  const now = new Date();
  const todayStart = _utcStartOfDay(now);
  const todayEnd = _utcEndOfDay(now);

  // Legacy rolling-window aliases — kept for back-compat.
  if (lens === '7d' || lens === '30d' || lens === '90d') {
    const ms = LENS_WINDOW_MS[lens];
    return { from: Date.now() - ms, to: Date.now() };
  }
  if (lens === 'qtd') {
    const q = Math.floor(now.getUTCMonth() / 3);
    return { from: Date.UTC(now.getUTCFullYear(), q * 3, 1), to: todayEnd };
  }

  // Extended vocabulary (Wave 29c).
  if (lens === 'recent_30d' || lens === 'recent') {
    return { from: todayStart - 30 * 24 * 3600 * 1000, to: todayEnd };
  }
  if (lens === 'this_month') {
    return { from: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1), to: todayEnd };
  }
  if (lens === 'last_month') {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const from = Date.UTC(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1, 1);
    const to = Date.UTC(y, m, 0, 23, 59, 59, 999);
    return { from, to };
  }
  if (lens === 'ytd' || lens === 'year_to_date') {
    return { from: Date.UTC(now.getUTCFullYear(), 0, 1), to: todayEnd };
  }
  if (lens === 'this_week') {
    // ISO Monday-start week.
    const dow = new Date(todayStart).getUTCDay();
    const daysSinceMon = (dow + 6) % 7;
    return { from: todayStart - daysSinceMon * 24 * 3600 * 1000, to: todayEnd };
  }
  if (lens === 'last_week') {
    const dow = new Date(todayStart).getUTCDay();
    const daysSinceMon = (dow + 6) % 7;
    const thisMon = todayStart - daysSinceMon * 24 * 3600 * 1000;
    return { from: thisMon - 7 * 24 * 3600 * 1000, to: thisMon - 1 };
  }
  if (lens === 'yesterday') {
    return { from: todayStart - 24 * 3600 * 1000, to: todayStart - 1 };
  }
  return null;
}

// Resolve a lens token to an absolute `from` epoch-ms (inclusive lower
// bound on opportunity.updated_at). Returns null when lens is 'all' or
// unrecognized so callers skip filtering. Kept as a thin wrapper around
// lensRange() for the existing computeWorkload path that only needs a
// from-cutoff (it filters `t >= cutoff`).
function _lensCutoff(lens) {
  const r = lensRange(lens);
  return r ? r.from : null;
}

function _records() {
  const arr = agentsFixture.agents;
  return Array.isArray(arr) ? arr : [];
}

function _opps() {
  const arr = opportunitiesFixture.opportunities;
  return Array.isArray(arr) ? arr : [];
}

function _isLosing(opp) {
  return LOSING_STATUSES.has(opp?.status);
}

function _isWinning(opp) {
  return WINNING_STATUSES.has(opp?.status);
}

function _median(nums) {
  if (!nums.length) return null;
  const sorted = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Compute workload metrics for one agent. Reads opportunities.json fresh
 * on every call — no caching. Returns:
 *
 *   {
 *     open_count: integer count of opps owned by this agent that aren't
 *                 in a losing status,
 *     stale_count: subset of open_count where Date.now() - updated_at
 *                  exceeds the stale threshold,
 *     conversion: won / (won + lost) over the lens window; null when the
 *                 denominator is 0,
 *     avg_handle_days: median (updated_at - created_at) across won opps
 *                      in days, over the lens window; null when none won.
 *   }
 *
 * Optional `opts.lens`: extended vocabulary (Wave 29c) —
 *   Legacy rolling windows: '7d' | '30d' | '90d' | 'qtd' | 'all'
 *   Calendar lenses (mc-aligned): 'recent_30d' (alias 'recent') |
 *     'this_month' | 'last_month' | 'ytd' (alias 'year_to_date') |
 *     'this_week' | 'last_week' | 'yesterday'
 * When set, opps are filtered by updated_at >= range.from BEFORE
 * computing conversion / avg_handle_days. Open / stale counts intentionally
 * IGNORE the lens — they are "right now" snapshots, not historical aggregates.
 *
 * Phase 2: replace with server-side lens-aware aggregation.
 */
export function computeWorkload(id, opts = {}) {
  const agent = _records().find((a) => a.id === id);
  if (!agent) {
    return { open_count: 0, stale_count: 0, conversion: null, avg_handle_days: null };
  }
  const owned = _opps().filter((o) => o.owner === agent.name);

  // Open + stale are "now" snapshots — never lens-filter.
  const open = owned.filter((o) => !_isLosing(o));
  const now = Date.now();
  const stale = open.filter((o) => {
    const t = Date.parse(o.updated_at || '');
    return Number.isFinite(t) && now - t > STALE_THRESHOLD_MS;
  });

  // Historical metrics — lens-scoped. Cutoff null = no filter (all-time).
  const cutoff = _lensCutoff(opts.lens);
  const inWindow = cutoff == null
    ? owned
    : owned.filter((o) => {
        const t = Date.parse(o.updated_at || '');
        return Number.isFinite(t) && t >= cutoff;
      });

  const wonCount = inWindow.filter(_isWinning).length;
  const lostCount = inWindow.filter(_isLosing).length;
  const denom = wonCount + lostCount;
  const conversion = denom > 0 ? wonCount / denom : null;

  const handleDays = inWindow
    .filter(_isWinning)
    .map((o) => {
      const a = Date.parse(o.created_at || '');
      const b = Date.parse(o.updated_at || '');
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      return (b - a) / (24 * 3600 * 1000);
    })
    .filter((v) => v != null && v >= 0);
  const avg_handle_days = _median(handleDays);

  return {
    open_count: open.length,
    stale_count: stale.length,
    conversion,
    avg_handle_days,
  };
}

function _enrich(agent, opts = {}) {
  if (!agent) return null;
  return { ...agent, ...computeWorkload(agent.id, opts) };
}

/**
 * List agents. Returns a fresh array of enriched agent records.
 *
 * Filters:
 *   - org_id: number — intersects with agent.org_ids[]
 *   - preset_id: string — exact match on agent.preset_id
 *   - has_tag: string — membership in agent.tags[]
 *   - lens: '7d' | '30d' | '90d' | 'qtd' | 'all' — windows historical
 *           workload metrics (conversion, avg_handle_days). Open/stale
 *           counts ignore lens.
 *
 * Default ordering preserves the fixture order (managers last today,
 * which matches the seed layout); callers that need a specific sort
 * (e.g. Team page default = stale_count desc) sort downstream.
 */
export function list({ org_id, preset_id, has_tag, lens } = {}) {
  let rows = _records();
  if (typeof org_id === 'number') {
    rows = rows.filter((a) => Array.isArray(a.org_ids) && a.org_ids.includes(org_id));
  }
  if (preset_id) rows = rows.filter((a) => a.preset_id === preset_id);
  if (has_tag) rows = rows.filter((a) => Array.isArray(a.tags) && a.tags.includes(has_tag));
  return rows.map((a) => _enrich(a, { lens }));
}

/**
 * Look up a single agent by id. Returns the enriched agent record or null.
 * Accepts optional `opts.lens` to scope historical workload metrics.
 */
export function get(id, opts = {}) {
  if (!id) return null;
  const agent = _records().find((a) => a.id === id);
  return agent ? _enrich(agent, opts) : null;
}

// ── Coaching notes ──────────────────────────────────────────────────
// Manager-only surface. Storage key parallels the contact-notes pattern
// (`blinker.notes.v1.<contact_id>`) but namespaced under `agent.<id>` so
// per-agent coaching can't collide with contact notes. Phase 2 swap:
// same call signatures, server-side ACL gated on `manage_agents`
// (architecture/19-manager-experience.md §9). No paired activity
// dual-write — coaching notes are an internal manager surface, NOT
// part of the consumer-facing activity log.

const COACHING_KEY_PREFIX = 'blinker.notes.v1.agent.';

function _coachingKey(agentId) {
  return `${COACHING_KEY_PREFIX}${agentId}`;
}

function _readCoachingNotes(agentId) {
  if (!agentId) return [];
  try {
    const raw =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(_coachingKey(agentId))
        : null;
    if (raw == null) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[blinker-platform/api] coaching notes read failed:', err);
    return [];
  }
}

function _writeCoachingNotes(agentId, arr) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(_coachingKey(agentId), JSON.stringify(arr));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[blinker-platform/api] coaching notes write failed:', err);
  }
}

function _newCoachingId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `cn_session_${crypto.randomUUID()}`;
  }
  return `cn_session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * List coaching notes for an agent. Newest-first. Returns [] when no
 * notes exist (no fixture seed — coaching notes are session-local in
 * Phase 1).
 */
export function listCoachingNotes(agentId) {
  return _readCoachingNotes(agentId);
}

/**
 * Append a coaching note. Returns the new record.
 */
export function addCoachingNote(agentId, body, { author_id = null } = {}) {
  if (!agentId) throw new Error('blinker-platform/api agents.addCoachingNote: agentId required');
  const trimmed = String(body || '').trim();
  if (!trimmed) throw new Error('blinker-platform/api agents.addCoachingNote: body required');
  const now = new Date().toISOString();
  const note = {
    id: _newCoachingId(),
    body: trimmed,
    author_id,
    created_at: now,
  };
  const next = [note, ..._readCoachingNotes(agentId)];
  _writeCoachingNotes(agentId, next);
  return note;
}

/**
 * In-place edit. Stamps `edited_at` on the touched record.
 */
export function editCoachingNote(agentId, noteId, body) {
  const trimmed = String(body || '').trim();
  if (!trimmed) throw new Error('blinker-platform/api agents.editCoachingNote: body required');
  const arr = _readCoachingNotes(agentId);
  const idx = arr.findIndex((n) => n.id === noteId);
  if (idx < 0) return null;
  const updated = { ...arr[idx], body: trimmed, edited_at: new Date().toISOString() };
  const next = arr.slice();
  next[idx] = updated;
  _writeCoachingNotes(agentId, next);
  return updated;
}

/**
 * Splice + persist. Returns true when a note was removed.
 */
export function deleteCoachingNote(agentId, noteId) {
  const arr = _readCoachingNotes(agentId);
  const idx = arr.findIndex((n) => n.id === noteId);
  if (idx < 0) return false;
  const next = arr.slice();
  next.splice(idx, 1);
  _writeCoachingNotes(agentId, next);
  return true;
}

export default {
  list,
  get,
  computeWorkload,
  lensRange,
  listCoachingNotes,
  addCoachingNote,
  editCoachingNote,
  deleteCoachingNote,
};

export { WINNING_STATUSES, LOSING_STATUSES };
