import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity as ActivityIcon,
  Banknote,
  BarChart3,
  Calendar as CalendarIcon,
  Clock,
  Inbox,
  RefreshCcw,
  ShieldCheck,
  TrendingUp,
  Umbrella,
} from 'lucide-react';
import { blinkerApi } from 'blinker-platform/api';
import { track } from 'blinker-platform/telemetry';
import { useActiveOrg } from '../../shell/active-org-context.jsx';
import {
  TYPE_LABELS,
  TYPE_BADGE,
  TODAY,
  ageDays,
  relativeTime,
  statusPillClasses,
  formatOrgTime,
  getOrgTimezone,
  crmStageOf,
} from '../../lib/canon.js';
import { KpiTile } from '../../shared/KpiTile.jsx';
import { Tooltip } from '../../shared/Tooltip.jsx';
import { BackToTop } from '../../shared/BackToTop.jsx';
import { Leaderboard } from '../../shared/Leaderboard.jsx';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll.js';

// ManagerHome — Wave 28c.
//
// Team-rollup landing page. Mirrors AgentHome's structural layout (eyebrow
// + greeting, lens selector, KPI tile grid, by-type rollup, recent
// activity) with manager-specific content:
//
//   - KPIs scoped to ALL agents in the active org(s), not one agent's pile
//   - Adds a by-agent strip with conversion / age dot per agent
//   - Recent activity reads cross-contact via blinkerApi.activities.listAll
//   - Funnel-header counts are all-time (mirrors Agent funnel; bypasses lens)
//
// Data scoping — `useActiveOrg()` is the source of truth. When
// `allOrgs === true`, iterate `accessibleOrgIds` to union the data
// (agents, opportunities, activities).
//
// Manager identity is hard-coded to "Taylor" today; replaced when
// agents.json[me].name lookup lands (mirrors AgentHome's `Devon` placeholder).

const MANAGER_FIRST_NAME = 'Taylor';

// Status taxonomy mirrors packages/api/agents.js (computeWorkload's
// LOSING_STATUSES / WINNING_STATUSES). Kept local so the page-level
// derivations (sparkline buckets, lens-scoped conversion) match what
// the agents SDK reports for the chip-level numbers. _TODO: promote to
// canon-derived helper alongside the agents.js TODO.
const LOSING_STATUSES = new Set([
  'Lost', 'Abandoned', 'Cancelled', 'Cold', 'Disqualified', 'Declined',
  'Not Interested', 'Payment Failed', 'Working - Rejected',
]);
const WINNING_STATUSES = new Set([
  'Won', 'Booked', 'Agreement Signed', 'Product Agreement Signed',
  'Payment Agreement Signed', 'Remitted', 'Active', 'Paid in Full',
  'Funded', 'Policy Written',
]);

function isOpen(opp) {
  return !LOSING_STATUSES.has(opp?.status) && !WINNING_STATUSES.has(opp?.status);
}

function isWon(opp) {
  return WINNING_STATUSES.has(opp?.status);
}

function isLost(opp) {
  return LOSING_STATUSES.has(opp?.status);
}

// Manager-flavored date-lens. ADR 19 §5.1 calls out 7d / 30d / 90d / qtd /
// all (different from Agent's calendar lens). Kept local to this file —
// AgentHome's lens stays unchanged.
const LENS_OPTIONS = [
  { value: '7d', label: 'Last 7 days', headerLabel: 'last 7 days' },
  { value: '30d', label: 'Last 30 days', headerLabel: 'last 30 days' },
  { value: '90d', label: 'Last 90 days', headerLabel: 'last 90 days' },
  { value: 'qtd', label: 'Quarter to date', headerLabel: 'this quarter' },
  { value: 'all', label: 'All time', headerLabel: 'all time' },
];

const LENS_MS = {
  '7d': 7 * 24 * 3600 * 1000,
  '30d': 30 * 24 * 3600 * 1000,
  '90d': 90 * 24 * 3600 * 1000,
};

function lensCutoff(value) {
  if (!value || value === 'all') return null;
  if (value === 'qtd') {
    const now = new Date();
    const q = Math.floor(now.getUTCMonth() / 3);
    return Date.UTC(now.getUTCFullYear(), q * 3, 1);
  }
  return Date.now() - LENS_MS[value];
}

// Resolve which org-ids the manager is currently looking at. Single-org
// mode → [orgId]. "All my orgs" → accessibleOrgIds. Used to filter the
// agents list, the contacts→activities scope, and the opportunity scope.
function useScopeOrgIds() {
  const { orgId, allOrgs, accessibleOrgIds } = useActiveOrg();
  return useMemo(() => {
    if (allOrgs) return accessibleOrgIds;
    if (orgId == null) return [];
    return [orgId];
  }, [orgId, allOrgs, accessibleOrgIds]);
}

export function ManagerHome({ session, onHomeFilter, onNavigate }) {
  const { orgName, allOrgs } = useActiveOrg();
  const scopeLabel = allOrgs ? 'All my orgs' : orgName;
  const scopeOrgIds = useScopeOrgIds();

  const [lens, setLens] = useState('30d');
  const [leaderboardMetric, setLeaderboardMetric] = useState('wins');
  const lensOption = useMemo(
    () => LENS_OPTIONS.find((o) => o.value === lens) || LENS_OPTIONS[1],
    [lens],
  );

  useEffect(() => {
    track('mission_control.manager_home.viewed', {
      scope: allOrgs ? 'all_orgs' : 'single_org',
      lens,
    });
    track('mission_control.manager.leaderboard_viewed', {
      org_ids: scopeOrgIds,
      metric: leaderboardMetric,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Idempotent rank-history snapshot — feeds the Trend column over time.
  useEffect(() => {
    if (scopeOrgIds.length === 0) return;
    try {
      blinkerApi.leaderboard.snapshotRanksForToday({ org_ids: scopeOrgIds });
    } catch (_) {
      // ignore
    }
  }, [scopeOrgIds]);

  // Rankings for the leaderboard widget — uses ADR-aligned 'this_week'
  // window so the table feels live and matches Manager Team's Rank
  // column lens.
  const leaderboardRankings = useMemo(() => {
    if (scopeOrgIds.length === 0) return [];
    return blinkerApi.leaderboard.getRankings({
      org_ids: scopeOrgIds,
      lens: 'this_week',
      metric: leaderboardMetric,
    });
  }, [scopeOrgIds, leaderboardMetric]);

  function handleLeaderboardMetricChange(next) {
    track('mission_control.manager.leaderboard_metric_toggled', {
      from: leaderboardMetric,
      to: next,
    });
    setLeaderboardMetric(next);
  }

  // Session data — runtime-mutable opportunities + contacts. Same source
  // the Agent surfaces read so adds/changes elsewhere stay in sync.
  const { opportunities, contacts } = session || { opportunities: [], contacts: {} };

  // Agents in scope — union across all scope orgs when allOrgs===true.
  // Filtering to persona='agent' excludes managers (manager records
  // appear in the same agents.json fixture but shouldn't show in the
  // by-agent strip or contribute to team KPIs).
  const agents = useMemo(() => {
    if (scopeOrgIds.length === 0) return [];
    if (scopeOrgIds.length === 1) {
      return blinkerApi.agents
        .list({ org_id: scopeOrgIds[0], lens })
        .filter((a) => a.persona === 'agent');
    }
    // Multi-org union: collect, dedupe by id, pass lens through.
    const seen = new Map();
    for (const id of scopeOrgIds) {
      for (const a of blinkerApi.agents.list({ org_id: id, lens })) {
        if (a.persona === 'agent' && !seen.has(a.id)) seen.set(a.id, a);
      }
    }
    return [...seen.values()];
  }, [scopeOrgIds, lens]);

  // Team opps — every opp owned by an agent in scope. Owner is matched by
  // name (matches the existing fixture convention; the SDK does the same).
  const agentNames = useMemo(() => new Set(agents.map((a) => a.name)), [agents]);
  const teamOpps = useMemo(
    () => opportunities.filter((o) => agentNames.has(o.owner)),
    [opportunities, agentNames],
  );

  // Lens-scoped opps for historical metrics (conversion, avg-handle-time).
  // Filters by updated_at >= cutoff. Open / stale counts use teamOpps
  // directly (now-snapshot).
  const cutoff = useMemo(() => lensCutoff(lens), [lens]);
  const lensOpps = useMemo(() => {
    if (cutoff == null) return teamOpps;
    return teamOpps.filter((o) => {
      const t = Date.parse(o.updated_at || '');
      return Number.isFinite(t) && t >= cutoff;
    });
  }, [teamOpps, cutoff]);

  const enrichedOpen = useMemo(
    () => teamOpps.filter(isOpen).map((o) => ({ ...o, age: ageDays(o.created_at) })),
    [teamOpps],
  );
  const openCount = enrichedOpen.length;

  // Stale = open + updated_at older than 7 days (matches agents.js threshold).
  const staleCount = useMemo(() => {
    const now = Date.now();
    const STALE_MS = 7 * 24 * 3600 * 1000;
    return enrichedOpen.filter((o) => {
      const t = Date.parse(o.updated_at || '');
      return Number.isFinite(t) && now - t > STALE_MS;
    }).length;
  }, [enrichedOpen]);

  // Conversion: won / (won + lost) over lens window.
  const conversionRate = useMemo(() => {
    const won = lensOpps.filter(isWon).length;
    const lost = lensOpps.filter(isLost).length;
    if (won + lost === 0) return null;
    return won / (won + lost);
  }, [lensOpps]);

  // Median handle days across won opps in the lens window.
  const avgHandleDays = useMemo(() => {
    const days = lensOpps
      .filter(isWon)
      .map((o) => {
        const a = Date.parse(o.created_at || '');
        const b = Date.parse(o.updated_at || '');
        if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
        return (b - a) / (24 * 3600 * 1000);
      })
      .filter((v) => v != null && v >= 0);
    if (days.length === 0) return null;
    const sorted = days.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }, [lensOpps]);

  // 14-day sparkline data: daily count of opps active (updated_at within
  // that day, regardless of stage). Buckets are anchored to TODAY so they
  // line up with the rest of the lens math.
  const sparklineCounts = useMemo(() => {
    const buckets = new Array(14).fill(0);
    const todayUtc = Date.UTC(
      TODAY.getUTCFullYear(),
      TODAY.getUTCMonth(),
      TODAY.getUTCDate(),
    );
    for (const o of teamOpps) {
      const t = Date.parse(o.updated_at || '');
      if (!Number.isFinite(t)) continue;
      const dayUtc = Date.UTC(
        new Date(t).getUTCFullYear(),
        new Date(t).getUTCMonth(),
        new Date(t).getUTCDate(),
      );
      const daysAgo = Math.floor((todayUtc - dayUtc) / (24 * 3600 * 1000));
      if (daysAgo >= 0 && daysAgo < 14) buckets[13 - daysAgo] += 1;
    }
    return buckets;
  }, [teamOpps]);

  // By-type counts (open subset, scoped by lens for the cards' totals).
  const byType = useMemo(() => {
    const counts = { protection: 0, refi: 0, insurance: 0, payments: 0 };
    for (const o of enrichedOpen) {
      // Lens-narrow only when not 'all' — by-type is a "current open"
      // surface but the brief calls it lens-scoped. Use lensOpps filter
      // on the open subset.
      if (cutoff != null) {
        const t = Date.parse(o.updated_at || '');
        if (!Number.isFinite(t) || t < cutoff) continue;
      }
      if (counts[o.type] !== undefined) counts[o.type] += 1;
    }
    return counts;
  }, [enrichedOpen, cutoff]);

  // By-type → by-status pill rollup (mirrors AgentHome's pattern). Used
  // by the per-type cards.
  const byStatusByType = useMemo(() => {
    const groups = { protection: new Map(), refi: new Map(), insurance: new Map(), payments: new Map() };
    for (const o of enrichedOpen) {
      if (cutoff != null) {
        const t = Date.parse(o.updated_at || '');
        if (!Number.isFinite(t) || t < cutoff) continue;
      }
      if (!groups[o.type]) continue;
      const m = groups[o.type];
      m.set(o.status, (m.get(o.status) || 0) + 1);
    }
    const out = {};
    for (const t of Object.keys(groups)) {
      out[t] = [...groups[t].entries()]
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count);
    }
    return out;
  }, [enrichedOpen, cutoff]);

  // Funnel header — all-time, never lens-scoped. Mirrors AgentHome 3F.
  const funnelCounts = useMemo(() => {
    const counts = { open: 0, won: 0, lost: 0, abandoned: 0 };
    for (const o of teamOpps) {
      const s = crmStageOf(o);
      if (s === 'unknown') counts.open += 1;
      else if (counts[s] !== undefined) counts[s] += 1;
    }
    return counts;
  }, [teamOpps]);

  // Contacts in scope — filter the session contacts map down to those
  // whose org_id falls inside scope. Drives the activity feed's
  // contact_ids list. When orgs are unknown on a contact (shouldn't
  // happen with fixture data but defensive), exclude.
  const scopedContactIds = useMemo(() => {
    if (scopeOrgIds.length === 0) return [];
    const set = new Set(scopeOrgIds);
    return Object.values(contacts || {})
      .filter((c) => c && set.has(c.org_id))
      .map((c) => c.id);
  }, [contacts, scopeOrgIds]);

  // Recent team activity — cross-contact merged feed via blinkerApi.
  const recentActivities = useMemo(
    () => blinkerApi.activities.listAll({ contact_ids: scopedContactIds }),
    [scopedContactIds],
  );

  // Active-org TZ for activity timestamps. When allOrgs, fall back to the
  // first scope org's tz. (Acceptable for Phase 1 — surfaces are clearly
  // a rollup view; we don't aggregate timezones into a synthetic one.)
  const tzOrgId = scopeOrgIds[0] ?? null;
  const activeOrgTz = useMemo(() => getOrgTimezone(tzOrgId), [tzOrgId]);

  const pageScrollerRef = useRef(null);

  function handleKpiClick(tile) {
    track('mission_control.manager_home.kpi_clicked', { tile, lens });
    if (tile === 'stale') {
      // Wave 28e — seed `?filter=stuck` so ManagerInbox's mount effect
      // toggles the Stuck derived filter on without a second click. Use
      // replaceState so back-nav from Inbox returns to wherever the user
      // was before. ManagerInbox reads the param via its existing
      // useEffect (post-28d) — see ManagerInbox.jsx::useEffect with
      // `params.get('filter')`.
      if (typeof window !== 'undefined') {
        try {
          const params = new URLSearchParams(window.location.search);
          params.set('filter', 'stuck');
          const next = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
          window.history.replaceState({}, '', next);
        } catch {
          // ignore — Inbox still opens, just unfiltered
        }
      }
      if (onNavigate) onNavigate('inbox');
      return;
    }
    if (onNavigate) onNavigate('inbox');
  }

  function handleFunnelClick(stage) {
    track('mission_control.manager_home.funnel_clicked', { stage });
    // Mirrors AgentHome — re-uses the by_stage:<bucket> filter pipeline.
    if (onHomeFilter) onHomeFilter(`by_stage:${stage}`);
  }

  function handleByTypeClick(payload) {
    track('mission_control.manager_home.inbox_filter_applied', { payload });
    if (onHomeFilter) onHomeFilter(payload);
  }

  return (
    <div ref={pageScrollerRef} className="flex-1 overflow-auto bg-slate-50 relative">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <Header
          scopeLabel={scopeLabel}
          funnelCounts={funnelCounts}
          onFunnelClick={handleFunnelClick}
        />
        <LensRow
          lens={lens}
          onLensChange={(v) => {
            track('mission_control.manager_home.lens_changed', { lens: v });
            setLens(v);
          }}
        />
        <KpiGrid
          openCount={openCount}
          conversionRate={conversionRate}
          avgHandleDays={avgHandleDays}
          staleCount={staleCount}
          sparklineCounts={sparklineCounts}
          lensHeaderLabel={lensOption.headerLabel}
          onClick={handleKpiClick}
        />
        <div className="mb-4">
          <Leaderboard
            rankings={leaderboardRankings}
            metric={leaderboardMetric}
            onMetricChange={handleLeaderboardMetricChange}
            lens="this week"
          />
        </div>
        <ByTypeRow
          byType={byType}
          byStatusByType={byStatusByType}
          onClick={handleByTypeClick}
        />
        <TeamActivityFeed
          activities={recentActivities}
          contacts={contacts}
          agents={agents}
          orgTz={activeOrgTz}
        />
      </div>
      <BackToTop scrollerRef={pageScrollerRef} threshold={400} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header — eyebrow + greeting + all-time funnel snapshot (matches AgentHome).
// ---------------------------------------------------------------------------
function Header({ scopeLabel, funnelCounts, onFunnelClick }) {
  const stagesInOrder = [
    { key: 'open', label: 'open' },
    { key: 'won', label: 'won' },
    { key: 'lost', label: 'lost' },
    { key: 'abandoned', label: 'abandoned' },
  ];
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 text-emerald-600 mb-1">
        <BarChart3 className="w-4 h-4" />
        <span className="text-xs uppercase tracking-wide font-semibold">
          Manager · Home
        </span>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Hello, {MANAGER_FIRST_NAME}
        {scopeLabel ? <> — <span className="text-slate-700">{scopeLabel}</span></> : null}
      </h1>
      <p className="text-sm text-slate-500 mt-1 flex flex-wrap items-center gap-x-1">
        {stagesInOrder.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-1">
            <Tooltip content={`Filter inbox to ${s.label}`} placement="bottom-left">
              <button
                type="button"
                onClick={() => onFunnelClick(s.key)}
                className="font-semibold text-slate-700 hover:text-emerald-600 hover:underline"
              >
                {funnelCounts[s.key] ?? 0}
              </button>
            </Tooltip>
            <span>{s.label}</span>
            {i < stagesInOrder.length - 1 && <span className="text-slate-300">·</span>}
          </span>
        ))}
        <span className="ml-1">across the team</span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LensRow — manager-flavored date filter selector (7d / 30d / 90d / qtd / all).
// ---------------------------------------------------------------------------
function LensRow({ lens, onLensChange }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <div className="ml-auto flex items-center gap-2">
        <CalendarIcon className="w-3.5 h-3.5 text-slate-400" />
        <select
          value={lens}
          onChange={(e) => onLensChange(e.target.value)}
          className="text-sm border border-slate-200 rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          aria-label="Date lens"
        >
          {LENS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KpiGrid — 4 lens-scoped tiles. The Open tile carries a 14-day sparkline.
// ---------------------------------------------------------------------------
function KpiGrid({
  openCount,
  conversionRate,
  avgHandleDays,
  staleCount,
  sparklineCounts,
  lensHeaderLabel,
  onClick,
}) {
  const convStr = conversionRate == null ? '—' : `${Math.round(conversionRate * 100)}%`;
  const handleStr = avgHandleDays == null ? '—' : `${avgHandleDays.toFixed(1)}`;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <KpiTile
        icon={Inbox}
        iconClass="bg-blue-50 text-blue-600 ring-blue-200"
        label="Open opportunities"
        value={openCount}
        sub="across the team"
        onClick={() => onClick('open')}
      >
        <Sparkline counts={sparklineCounts} />
      </KpiTile>
      <KpiTile
        icon={TrendingUp}
        iconClass="bg-emerald-50 text-emerald-600 ring-emerald-200"
        label={`Conversion · ${lensHeaderLabel}`}
        value={convStr}
        sub="won ÷ (won + lost)"
        onClick={() => onClick('conversion')}
      />
      <KpiTile
        icon={Clock}
        iconClass="bg-amber-50 text-amber-600 ring-amber-200"
        label={`Avg handle · ${lensHeaderLabel}`}
        value={handleStr}
        suffix={avgHandleDays == null || avgHandleDays === 1 ? 'day' : 'days'}
        sub="median created → won"
        onClick={() => onClick('avg_handle')}
      />
      <KpiTile
        icon={ActivityIcon}
        iconClass="bg-rose-50 text-rose-600 ring-rose-200"
        label="Stale open opps"
        value={staleCount}
        sub={staleCount === 0 ? 'none stale' : 'no movement in 7d+'}
        onClick={() => onClick('stale')}
      />
    </div>
  );
}

// 14-bar inline SVG sparkline. No external lib. Bars are auto-scaled to the
// max-count in the series; an empty series renders a flat baseline.
function Sparkline({ counts }) {
  const max = counts.reduce((a, b) => Math.max(a, b), 0);
  const W = 120;
  const H = 24;
  const bw = W / counts.length;
  return (
    <svg
      width={W}
      height={H}
      role="img"
      aria-label="Last 14 days of team activity"
      className="block"
    >
      {counts.map((c, i) => {
        const h = max === 0 ? 1 : Math.max(1, Math.round((c / max) * (H - 2)));
        const y = H - h;
        const x = i * bw + 0.5;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={Math.max(1, bw - 1.5)}
            height={h}
            fill="currentColor"
            className="text-blue-400"
          />
        );
      })}
    </svg>
  );
}

// initials — small helper retained from the retired ByAgentStrip; still
// used by TeamActivityFeed for actor avatars. Wave 30 dropped the inline
// by-agent chip strip in favor of the shared Leaderboard widget.
function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]).join('').toUpperCase();
}

// ---------------------------------------------------------------------------
// ByTypeRow — mirrors AgentHome ByTypeRow structurally. Manager-scoped data.
// ---------------------------------------------------------------------------
const TYPE_TILE_ICON = {
  protection: ShieldCheck,
  refi: RefreshCcw,
  insurance: Umbrella,
  payments: Banknote,
};

const PILLS_PER_CARD_VISIBLE = 4;

function ByTypeRow({ byType, byStatusByType, onClick }) {
  const items = ['protection', 'refi', 'insurance', 'payments'];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      {items.map((t) => (
        <TypeCard
          key={t}
          type={t}
          count={byType[t] || 0}
          pills={(byStatusByType && byStatusByType[t]) || []}
          onClick={onClick}
        />
      ))}
    </div>
  );
}

function TypeCard({ type, count, pills, onClick }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = TYPE_TILE_ICON[type];
  const visiblePills = expanded ? pills : pills.slice(0, PILLS_PER_CARD_VISIBLE);
  const overflow = pills.length - PILLS_PER_CARD_VISIBLE;

  return (
    <div className="bg-white rounded-lg ring-1 ring-slate-200 hover:ring-slate-300 px-3 py-2.5 transition-colors">
      <button
        type="button"
        onClick={() => onClick(`by_type:${type}`)}
        className="flex items-center gap-3 w-full text-left"
      >
        <span
          className={
            'inline-flex w-7 h-7 rounded-md items-center justify-center ring-1 ring-inset ' +
            TYPE_BADGE[type]
          }
        >
          <Icon className="w-3.5 h-3.5" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
            {TYPE_LABELS[type]}
          </div>
          <div className="text-base font-semibold text-slate-900">{count}</div>
        </div>
      </button>
      {visiblePills.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {visiblePills.map((p) => (
            <Tooltip
              key={`${type}::${p.status}`}
              content={`Filter inbox to ${TYPE_LABELS[type]} / ${p.status}`}
              placement="bottom-left"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClick(`by_status:${type}:${p.status}`);
                }}
                className={
                  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium ring-1 ring-inset cursor-pointer hover:opacity-80 ' +
                  statusPillClasses(type, p.status)
                }
              >
                <span className="truncate max-w-[120px]">{p.status}</span>
                <span className="text-[9.5px] font-semibold opacity-70">{p.count}</span>
              </button>
            </Tooltip>
          ))}
          {!expanded && overflow > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(true);
              }}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-medium ring-1 ring-inset bg-slate-50 text-slate-500 ring-slate-200 hover:bg-slate-100"
            >
              +{overflow} more
            </button>
          )}
          {expanded && overflow > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(false);
              }}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-medium ring-1 ring-inset bg-slate-50 text-slate-400 ring-slate-200 hover:bg-slate-100"
            >
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TeamActivityFeed — cross-contact activity stream w/ agent + type filters.
//
// Kept inline (not extracted to src/shared/) because the manager-flavored
// row layout (agent persona pill, agent name) is specific to this surface.
// AgentHome's RecentActivityCard renders the contact-first shape and reuses
// useInfiniteScroll the same way — extracting a shared component would mean
// designing the larger superset of both rows' affordances, which is out of
// scope for 28c. See report notes for 28d coordinator follow-up.
// ---------------------------------------------------------------------------
const ACTIVITY_TYPES = ['call', 'sms', 'email', 'note', 'status_change', 'agent_action', 'partner_event'];

function TeamActivityFeed({ activities, contacts, agents, orgTz }) {
  const [agentFilter, setAgentFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  // Map actor_id → display name. Activities.json uses short actor ids
  // like `agent_jordan` while agents.json uses `agent_jordan_reese`.
  // Best-effort match: longest agents-fixture id whose prefix matches
  // the actor_id (e.g. "agent_jordan" matches "agent_jordan_reese").
  // Falls back to the raw actor_id string when no match.
  const actorLookup = useMemo(() => {
    const map = new Map();
    for (const a of agents) {
      map.set(a.id, a);
      // Add an alias for the agents.json id stripped of the surname suffix.
      const short = a.id.replace(/_[^_]+$/, '');
      if (!map.has(short)) map.set(short, a);
    }
    return map;
  }, [agents]);

  function resolveActor(actor_id) {
    if (!actor_id) return null;
    return actorLookup.get(actor_id) || null;
  }

  // Filter pipeline — agent filter scopes by actor_id match; type
  // filter scopes by activity.type.
  const filtered = useMemo(() => {
    let rows = activities;
    if (agentFilter !== 'all') {
      rows = rows.filter((r) => {
        const a = resolveActor(r.actor_id);
        return a && a.id === agentFilter;
      });
    }
    if (typeFilter !== 'all') {
      rows = rows.filter((r) => r.type === typeFilter);
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities, agentFilter, typeFilter, actorLookup]);

  const { visibleRows, sentinelRef, hasMore } = useInfiniteScroll(filtered, {
    pageSize: 25,
  });

  return (
    <div className="bg-white rounded-lg ring-1 ring-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
        <ActivityIcon className="w-3.5 h-3.5 text-slate-400" />
        <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
          Recent team activity
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={agentFilter}
            onChange={(e) => {
              track('mission_control.manager_home.activity_agent_filter', {
                agent_id: e.target.value,
              });
              setAgentFilter(e.target.value);
            }}
            className="text-[11px] border border-slate-200 rounded-md px-1.5 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            aria-label="Filter activity by agent"
          >
            <option value="all">All agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => {
              track('mission_control.manager_home.activity_type_filter', {
                type: e.target.value,
              });
              setTypeFilter(e.target.value);
            }}
            className="text-[11px] border border-slate-200 rounded-md px-1.5 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            aria-label="Filter activity by type"
          >
            <option value="all">All types</option>
            {ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-slate-400">
            {visibleRows.length} of {filtered.length}
          </span>
        </div>
      </div>
      <ul className="divide-y divide-slate-100">
        {visibleRows.map((a) => {
          const c = contacts[a.contact_id];
          const name = c
            ? c.name?.preferred ||
              `${c.name?.first ?? ''} ${c.name?.last ?? ''}`.trim()
            : a.contact_id;
          const actor = resolveActor(a.actor_id);
          return (
            <li key={a.id} className="px-4 py-2.5 flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0 text-[10px] font-semibold">
                {actor ? initials(actor.name) : '?'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-slate-800 truncate">
                  {actor ? (
                    <>
                      <span className="font-medium">{actor.name}</span>
                      <span className="inline-flex items-center ml-1.5 px-1 py-0.5 rounded text-[9.5px] font-semibold uppercase tracking-wide bg-slate-100 text-slate-500">
                        {actor.persona}
                      </span>
                    </>
                  ) : (
                    <span className="font-medium text-slate-500">
                      {a.actor_id || 'system'}
                    </span>
                  )}
                  <span className="text-slate-400"> · </span>
                  <span className="text-slate-500 truncate">{a.summary_text}</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  <span className="text-slate-500">{name}</span>
                  <span className="mx-1">·</span>
                  {relativeTime(a.occurred_at)}
                  <span className="mx-1">·</span>
                  <span className="text-slate-500">
                    {formatOrgTime(a.occurred_at, orgTz)}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="px-4 py-6 text-sm text-slate-400 text-center">
            No activity in scope.
          </li>
        )}
        {hasMore && (
          <li
            ref={sentinelRef}
            className="px-4 py-3 text-center text-[11px] text-slate-400 italic"
          >
            Loading more…
          </li>
        )}
      </ul>
    </div>
  );
}

