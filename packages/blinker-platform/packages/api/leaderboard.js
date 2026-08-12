// Wave 30 — Sales Leaderboard SDK.
//
// Drives the Agent Compete screen + Manager Home leaderboard widget +
// Manager Team rank/trend columns + AgentProfile goal-pacing card.
// Spec: architecture/20-sales-leaderboard.md.
//
// All computations read fixture-backed `blinkerApi.agents.list()` +
// `blinkerApi.opportunities.list()`. No new fixtures; reuses canon
// `org-registry.json::sales_goals`. Trend history persists in
// localStorage under `blinker.leaderboard.history.v1` — idempotent
// per-day per-org-id-set.
//
// Phase 2: replace localStorage trend snapshots with server-side daily
// aggregates; the call surface stays the same.
//
// Dep direction (per architecture/11):
//   - MAY read `../../canon/*.json` directly.
//   - MAY import sibling packages (api/agents, api/opportunities).
//   - MUST NOT import from any child app.

import * as agents from './agents.js';
import * as opportunities from './opportunities.js';
import orgRegistry from '../../canon/org-registry.json';
import { WINNING_STATUSES, LOSING_STATUSES } from './agents.js';

const HISTORY_KEY = 'blinker.leaderboard.history.v1';

// Fallback template — if an org has no `sales_goals` block, fall back to
// Apex's seeded values (the highest-volume org). Mirrors ADR §5.1.
const SALES_GOALS_FALLBACK = {
  weekly_wins: 10,
  monthly_wins: 40,
  monthly_revenue: 30000,
  fast_start_threshold_pct: 30,
  fast_close_hours: 24,
  streak_milestones: [3, 5, 10, 15, 20],
};

// ── canon + win-state helpers ─────────────────────────────────────────

function _orgById(orgId) {
  return (orgRegistry.orgs || []).find((o) => o.id === orgId) || null;
}

function _salesGoalsFor(orgId) {
  const org = _orgById(orgId);
  return (org && org.sales_goals) || SALES_GOALS_FALLBACK;
}

function _isWon(opp) {
  return WINNING_STATUSES.has(opp?.status);
}

function _isLost(opp) {
  return LOSING_STATUSES.has(opp?.status);
}

// ── lens window ─────────────────────────────────────────────────────
// Mirrors agents.lensRange() but kept local so this module doesn't
// depend on the (private) helper. Returns { from, to } epoch-ms inclusive.

const _MS_DAY = 24 * 3600 * 1000;

function _startOfDay(d) {
  const c = new Date(d);
  c.setUTCHours(0, 0, 0, 0);
  return c.getTime();
}
function _endOfDay(d) {
  const c = new Date(d);
  c.setUTCHours(23, 59, 59, 999);
  return c.getTime();
}

function _lensRange(lens) {
  if (!lens || lens === 'all') return null;
  const now = new Date();
  const todayStart = _startOfDay(now);
  const todayEnd = _endOfDay(now);
  if (lens === '7d') return { from: Date.now() - 7 * _MS_DAY, to: Date.now() };
  if (lens === '30d') return { from: Date.now() - 30 * _MS_DAY, to: Date.now() };
  if (lens === '90d') return { from: Date.now() - 90 * _MS_DAY, to: Date.now() };
  if (lens === 'recent_30d' || lens === 'recent') {
    return { from: todayStart - 30 * _MS_DAY, to: todayEnd };
  }
  if (lens === 'this_week') {
    const dow = new Date(todayStart).getUTCDay();
    const daysSinceMon = (dow + 6) % 7;
    return { from: todayStart - daysSinceMon * _MS_DAY, to: todayEnd };
  }
  if (lens === 'last_week') {
    const dow = new Date(todayStart).getUTCDay();
    const daysSinceMon = (dow + 6) % 7;
    const thisMon = todayStart - daysSinceMon * _MS_DAY;
    return { from: thisMon - 7 * _MS_DAY, to: thisMon - 1 };
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
  if (lens === 'yesterday') {
    return { from: todayStart - _MS_DAY, to: todayStart - 1 };
  }
  return null;
}

function _inLens(iso, range) {
  if (!iso || !range) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t >= range.from && t <= range.to;
}

// ── current-week math ────────────────────────────────────────────────

function _currentWeekRange() {
  return _lensRange('this_week');
}

function _currentMonthRange() {
  return _lensRange('this_month');
}

function _elapsedFractionOfWeek() {
  const r = _currentWeekRange();
  if (!r) return 0;
  const total = r.to - r.from;
  const elapsed = Math.max(0, Math.min(total, Date.now() - r.from));
  return total > 0 ? elapsed / total : 0;
}

function _elapsedFractionOfMonth() {
  const r = _currentMonthRange();
  if (!r) return 0;
  const total = r.to - r.from;
  const elapsed = Math.max(0, Math.min(total, Date.now() - r.from));
  return total > 0 ? elapsed / total : 0;
}

// ── data helpers ─────────────────────────────────────────────────────

function _resolveAgentsForOrgs(orgIds) {
  if (!Array.isArray(orgIds) || orgIds.length === 0) return [];
  const seen = new Map();
  for (const id of orgIds) {
    if (typeof id !== 'number') continue;
    for (const a of agents.list({ org_id: id })) {
      if (a.persona !== 'agent') continue;
      if (!seen.has(a.id)) seen.set(a.id, a);
    }
  }
  return [...seen.values()];
}

function _oppsOwnedBy(agent, allOpps) {
  return allOpps.filter((o) => o.owner === agent.name);
}

function _winsInRange(opps, range) {
  return opps.filter(
    (o) => _isWon(o) && (range == null ? true : _inLens(o.updated_at, range)),
  );
}

function _lossesInRange(opps, range) {
  return opps.filter(
    (o) => _isLost(o) && (range == null ? true : _inLens(o.updated_at, range)),
  );
}

function _median(nums) {
  if (!nums.length) return null;
  const sorted = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ── public API ──────────────────────────────────────────────────────

/**
 * Compute a ranked list of agents across the given orgs for the chosen
 * metric + lens. Returns `[{ rank, agent, value, trend }]` sorted by
 * descending metric (ascending for `speed`). `trend` is the +N/-N/0
 * delta vs the snapshot from 7 days ago when available, else null.
 *
 * @param {object} opts
 * @param {number[]} opts.org_ids
 * @param {'recent_30d'|'this_week'|'this_month'|'ytd'|...} [opts.lens='recent_30d']
 * @param {'wins'|'conversion'|'revenue'|'speed'} [opts.metric='wins']
 */
export function getRankings({ org_ids, lens = 'recent_30d', metric = 'wins' } = {}) {
  const agentList = _resolveAgentsForOrgs(org_ids);
  if (agentList.length === 0) return [];
  const range = _lensRange(lens);
  const allOpps = opportunities.list({});

  const rows = agentList.map((agent) => {
    const owned = _oppsOwnedBy(agent, allOpps);
    const wins = _winsInRange(owned, range);
    const losses = _lossesInRange(owned, range);
    let value = 0;
    if (metric === 'wins') {
      value = wins.length;
    } else if (metric === 'conversion') {
      const denom = wins.length + losses.length;
      value = denom > 0 ? wins.length / denom : 0;
    } else if (metric === 'revenue') {
      value = wins.reduce((acc, o) => acc + (Number(o.value) || 0), 0);
    } else if (metric === 'speed') {
      const days = wins
        .map((o) => {
          const a = Date.parse(o.created_at || '');
          const b = Date.parse(o.updated_at || '');
          return Number.isFinite(a) && Number.isFinite(b) ? (b - a) / _MS_DAY : null;
        })
        .filter((v) => v != null && v >= 0);
      value = _median(days);
    }
    const primaryOrg = (org_ids && org_ids[0]) || null;
    const trend = primaryOrg != null
      ? getRankTrend(agent.id, primaryOrg, metric, { days_ago: 7 })
      : null;
    return { agent, value, trend };
  });

  // Sort. Speed is ascending (lower is better); nulls land last.
  const speedMode = metric === 'speed';
  rows.sort((a, b) => {
    const av = a.value;
    const bv = b.value;
    const an = av == null;
    const bn = bv == null;
    if (an && bn) return 0;
    if (an) return 1;
    if (bn) return -1;
    return speedMode ? av - bv : bv - av;
  });

  return rows.map((r, idx) => ({ rank: idx + 1, agent: r.agent, value: r.value, trend: r.trend }));
}

/**
 * Compute goal progress for a single agent over the current week or
 * month. Returns `{ wins, goal, percent, pace_status }` or null when
 * the goal is missing/zero.
 *
 * `pace_status`:
 *   'ahead'   — wins >= 110% of expected
 *   'behind'  — wins <= 90% of expected
 *   'on_pace' — otherwise
 *
 * Revenue period: `period === 'month_revenue'` switches the metric to
 * sum-of-won-revenue against `sales_goals.monthly_revenue`.
 */
export function getAgentGoalProgress(agent_id, { period = 'week' } = {}) {
  if (!agent_id) return null;
  const agent = agents.get(agent_id);
  if (!agent) return null;
  const primaryOrg = (agent.org_ids && agent.org_ids[0]) || null;
  const goals = _salesGoalsFor(primaryOrg);

  let range, goal, wins, elapsed;
  if (period === 'month_revenue') {
    range = _currentMonthRange();
    goal = goals.monthly_revenue;
    elapsed = _elapsedFractionOfMonth();
    const owned = _oppsOwnedBy(agent, opportunities.list({}));
    const winOpps = _winsInRange(owned, range);
    wins = winOpps.reduce((acc, o) => acc + (Number(o.value) || 0), 0);
  } else if (period === 'month') {
    range = _currentMonthRange();
    goal = goals.monthly_wins;
    elapsed = _elapsedFractionOfMonth();
    const owned = _oppsOwnedBy(agent, opportunities.list({}));
    wins = _winsInRange(owned, range).length;
  } else {
    range = _currentWeekRange();
    goal = goals.weekly_wins;
    elapsed = _elapsedFractionOfWeek();
    const owned = _oppsOwnedBy(agent, opportunities.list({}));
    wins = _winsInRange(owned, range).length;
  }

  if (!goal || goal <= 0) return null;
  const rawPct = (wins / goal) * 100;
  const percent = Math.max(0, Math.min(200, rawPct));
  const expected = goal * elapsed;
  let pace_status = 'on_pace';
  if (expected > 0) {
    if (wins >= expected * 1.1) pace_status = 'ahead';
    else if (wins <= expected * 0.9) pace_status = 'behind';
  } else if (wins > 0) {
    pace_status = 'ahead';
  }
  return { wins, goal, percent, pace_status };
}

/**
 * Compute the achievement strip for an agent over the given lens.
 * Returns an array of `{ id, type, label, icon, value?, active }`.
 *
 * Active means the achievement is currently earned / counts > 0 /
 * streak ongoing.
 */
export function getAchievements(agent_id, { lens = 'recent_30d' } = {}) {
  if (!agent_id) return [];
  const agent = agents.get(agent_id);
  if (!agent) return [];
  const primaryOrg = (agent.org_ids && agent.org_ids[0]) || null;
  const goals = _salesGoalsFor(primaryOrg);
  const allOpps = opportunities.list({});
  const owned = _oppsOwnedBy(agent, allOpps);
  const lensRange = _lensRange(lens);

  const out = [];

  // streak — consecutive days with ≥1 win, look back 30d. Active when
  // today has a win OR the streak ended within the last 24h (still alive).
  const winsByDay = new Map();
  for (const o of owned.filter(_isWon)) {
    const t = Date.parse(o.updated_at || '');
    if (!Number.isFinite(t)) continue;
    const day = _startOfDay(new Date(t));
    winsByDay.set(day, (winsByDay.get(day) || 0) + 1);
  }
  const today = _startOfDay(new Date());
  let streak = 0;
  let cursor = today;
  // Step backward from today; allow today to be empty so a streak that
  // ended yesterday is still surfaced as "still alive".
  let crossedFirstWin = false;
  for (let i = 0; i < 30; i++) {
    const hasWin = (winsByDay.get(cursor) || 0) > 0;
    if (!crossedFirstWin && !hasWin) {
      // tolerate exactly one empty leading day (= grace period from today)
      if (i === 0) {
        cursor -= _MS_DAY;
        continue;
      }
      break;
    }
    if (hasWin) {
      crossedFirstWin = true;
      streak += 1;
      cursor -= _MS_DAY;
    } else {
      break;
    }
  }
  out.push({
    id: 'streak',
    type: 'streak',
    label: streak > 0 ? `${streak}-day streak` : 'Build a streak',
    icon: 'flame',
    value: streak,
    active: streak > 0,
  });

  // fast_close — count of wins where won_at - created_at < fast_close_hours.
  const fastCloseMs = (goals.fast_close_hours || 24) * 3600 * 1000;
  const fastCloseCount = owned.filter((o) => {
    if (!_isWon(o)) return false;
    if (lensRange && !_inLens(o.updated_at, lensRange)) return false;
    const a = Date.parse(o.created_at || '');
    const b = Date.parse(o.updated_at || '');
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    return b - a < fastCloseMs;
  }).length;
  out.push({
    id: 'fast_close',
    type: 'fast_close',
    label: `Fast close (under ${goals.fast_close_hours || 24}h)`,
    icon: 'zap',
    value: fastCloseCount,
    active: fastCloseCount > 0,
  });

  // first_of_week — true if agent has the earliest win-timestamp among
  // their own wins this Monday→Sunday. (ADR phrasing: "first of THE week
  // for this agent" — single-agent surface.)
  const weekRange = _currentWeekRange();
  const weekWins = owned
    .filter((o) => _isWon(o) && _inLens(o.updated_at, weekRange))
    .map((o) => Date.parse(o.updated_at || ''))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  const firstOfWeek = weekWins.length > 0;
  out.push({
    id: 'first_of_week',
    type: 'first_of_week',
    label: firstOfWeek ? 'First of the week' : 'Open the week with a win',
    icon: 'target',
    active: firstOfWeek,
  });

  // beat_team_avg_weeks — rolling count of past weeks (excluding current)
  // where this agent's wins ≥ team median wins. Look back 12 weeks.
  const teamAgents = primaryOrg != null ? _resolveAgentsForOrgs([primaryOrg]) : [];
  let beatCount = 0;
  const thisWeekStart = weekRange ? weekRange.from : today;
  for (let w = 1; w <= 12; w++) {
    const wkFrom = thisWeekStart - w * 7 * _MS_DAY;
    const wkTo = wkFrom + 7 * _MS_DAY - 1;
    const wkRange = { from: wkFrom, to: wkTo };
    const myWins = owned.filter((o) => _isWon(o) && _inLens(o.updated_at, wkRange)).length;
    const teamWinCounts = teamAgents.map((a) => {
      const ao = _oppsOwnedBy(a, allOpps);
      return ao.filter((o) => _isWon(o) && _inLens(o.updated_at, wkRange)).length;
    });
    const teamMed = _median(teamWinCounts);
    if (teamMed != null && myWins >= teamMed && myWins > 0) beatCount += 1;
  }
  out.push({
    id: 'beat_team_avg',
    type: 'beat_team_avg_weeks',
    label: `Beat team avg ${beatCount}w`,
    icon: 'trendingUp',
    value: beatCount,
    active: beatCount > 0,
  });

  // fast_start — by Tuesday EOD, wins this week ≥ weekly_wins * pct/100.
  const nowDow = new Date().getUTCDay();
  const isTueOrLater = nowDow === 0 || nowDow >= 2; // Sun (0) counts as past-Sat (week wrap); be permissive
  const weeklyWinsCount = owned.filter((o) => _isWon(o) && _inLens(o.updated_at, weekRange)).length;
  const fastStartThreshold = Math.ceil(
    (goals.weekly_wins || 0) * ((goals.fast_start_threshold_pct || 30) / 100),
  );
  const fastStartHit = isTueOrLater && weeklyWinsCount >= fastStartThreshold && fastStartThreshold > 0;
  out.push({
    id: 'fast_start',
    type: 'fast_start',
    label: 'Fast Start',
    icon: 'rocket',
    value: weeklyWinsCount,
    active: fastStartHit,
  });

  // streak_milestone — highest milestone the active streak has crossed.
  const milestones = Array.isArray(goals.streak_milestones) ? goals.streak_milestones : [];
  let crossed = null;
  for (const m of milestones) {
    if (streak >= m) crossed = m;
  }
  if (crossed != null) {
    out.push({
      id: `streak_milestone_${crossed}`,
      type: 'streak_milestone',
      label: `Streak milestone ${crossed}`,
      icon: 'medal',
      value: crossed,
      active: true,
    });
  }

  return out;
}

/**
 * Cross-agent medians for the You-vs-Team out-pace row on Compete.
 * Returns `{ conversion, avg_handle_days, stale_count }`.
 */
export function getTeamMedians({ org_ids, lens = 'recent_30d' } = {}) {
  const agentList = _resolveAgentsForOrgs(org_ids);
  if (agentList.length === 0) {
    return { conversion: null, avg_handle_days: null, stale_count: null };
  }
  const range = _lensRange(lens);
  const allOpps = opportunities.list({});

  const convs = [];
  const handleDays = [];
  const staleCounts = [];
  const STALE_MS = 7 * _MS_DAY;
  const now = Date.now();
  for (const a of agentList) {
    const owned = _oppsOwnedBy(a, allOpps);
    const wins = _winsInRange(owned, range);
    const losses = _lossesInRange(owned, range);
    const denom = wins.length + losses.length;
    if (denom > 0) convs.push(wins.length / denom);
    for (const o of wins) {
      const ca = Date.parse(o.created_at || '');
      const cb = Date.parse(o.updated_at || '');
      if (Number.isFinite(ca) && Number.isFinite(cb) && cb >= ca) {
        handleDays.push((cb - ca) / _MS_DAY);
      }
    }
    const stale = owned.filter((o) => {
      if (_isWon(o) || _isLost(o)) return false;
      const t = Date.parse(o.updated_at || '');
      return Number.isFinite(t) && now - t > STALE_MS;
    }).length;
    staleCounts.push(stale);
  }
  return {
    conversion: _median(convs),
    avg_handle_days: _median(handleDays),
    stale_count: _median(staleCounts),
  };
}

// ── Trend snapshot persistence ─────────────────────────────────────

function _formatLocalDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function _readHistory() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed != null ? parsed : {};
  } catch {
    return {};
  }
}

function _writeHistory(obj) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(obj));
  } catch {
    // ignore quota / serializer errors
  }
}

/**
 * Idempotent per-day snapshot of wins / conversion / revenue per agent
 * across the given orgs. Returns `{ written, date }`. Skips when today's
 * snapshot for this org_id set is already present.
 *
 * Storage shape (per ADR §5.3):
 *   { "<YYYY-MM-DD>": {
 *       "<org_id>": {
 *         "ranks": { "<agent_id>": { "wins": N, "conversion": F, "revenue": N } }
 *       }
 *     } }
 */
export function snapshotRanksForToday({ org_ids } = {}) {
  if (!Array.isArray(org_ids) || org_ids.length === 0) {
    return { written: false, date: null };
  }
  const date = _formatLocalDate(new Date());
  const history = _readHistory();
  if (!history[date]) history[date] = {};
  // Idempotency check — if every org already has an entry for today, skip.
  const allPresent = org_ids.every(
    (id) => history[date][String(id)] && history[date][String(id)].ranks,
  );
  if (allPresent) return { written: false, date };

  const allOpps = opportunities.list({});
  for (const orgId of org_ids) {
    const list = agents.list({ org_id: orgId }).filter((a) => a.persona === 'agent');
    const ranks = {};
    for (const ag of list) {
      const owned = _oppsOwnedBy(ag, allOpps);
      // Wins/conversion/revenue snapshot uses RECENT_30D as the reference
      // window — keeps the trend signal usable for the most common
      // leaderboard lens. Specific-lens trends are out of scope today.
      const range = _lensRange('recent_30d');
      const wins = _winsInRange(owned, range);
      const losses = _lossesInRange(owned, range);
      const denom = wins.length + losses.length;
      ranks[ag.id] = {
        wins: wins.length,
        conversion: denom > 0 ? wins.length / denom : 0,
        revenue: wins.reduce((acc, o) => acc + (Number(o.value) || 0), 0),
      };
    }
    history[date][String(orgId)] = { ranks };
  }
  _writeHistory(history);
  return { written: true, date };
}

/**
 * Compute the rank delta for an agent vs N days ago. Returns +N when
 * the rank improved (lower rank number is better), -N when worsened,
 * 0 when unchanged, null when history is missing for either side.
 *
 * Ranks are re-derived from the stored per-agent metric values for both
 * the today snapshot and the past snapshot so the trend stays consistent
 * even if agents were added/removed.
 */
export function getRankTrend(agent_id, org_id, metric, { days_ago = 7 } = {}) {
  if (!agent_id || org_id == null || !metric) return null;
  const history = _readHistory();
  const today = _formatLocalDate(new Date());
  const past = _formatLocalDate(new Date(Date.now() - days_ago * _MS_DAY));
  const todayEntry = history[today] && history[today][String(org_id)];
  const pastEntry = history[past] && history[past][String(org_id)];
  if (!todayEntry || !pastEntry) return null;

  const rankOf = (entry) => {
    const ranks = entry.ranks || {};
    const ids = Object.keys(ranks);
    if (!ids.length) return null;
    const speedMode = metric === 'speed';
    const rows = ids.map((id) => ({ id, value: ranks[id][metric] ?? 0 }));
    rows.sort((a, b) => (speedMode ? a.value - b.value : b.value - a.value));
    const idx = rows.findIndex((r) => r.id === agent_id);
    return idx >= 0 ? idx + 1 : null;
  };

  const todayRank = rankOf(todayEntry);
  const pastRank = rankOf(pastEntry);
  if (todayRank == null || pastRank == null) return null;
  // Improved = rank number decreased ⇒ positive delta.
  return pastRank - todayRank;
}

export default {
  getRankings,
  getAgentGoalProgress,
  getAchievements,
  getTeamMedians,
  snapshotRanksForToday,
  getRankTrend,
};
