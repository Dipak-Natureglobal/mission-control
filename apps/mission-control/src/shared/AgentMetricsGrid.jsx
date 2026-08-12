import { useMemo, useState } from 'react';
import {
  Banknote,
  Clock,
  Inbox,
  RefreshCcw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Umbrella,
} from 'lucide-react';
import { useSessionData } from '../lib/session-data.js';
import {
  TYPE_LABELS,
  TYPE_BADGE,
  DATE_LENS_OPTIONS,
  ageDays,
  ageLabel,
  dateLensRange,
  withinLens,
  crmStageOf,
  statusPillClasses,
} from '../lib/canon.js';
import { blinkerApi } from 'blinker-platform/api';
import { Tooltip } from './Tooltip.jsx';
import { KpiTile } from './KpiTile.jsx';
import { track } from 'blinker-platform/telemetry';

// AgentMetricsGrid — Wave 29c. Shared metrics surface consumed by both
// Agent Home (no agentId) and AgentProfile (with agentId for a single
// team member). Computes:
//   Top row  — 4 KPI tiles (Open, Avg Age, Lost, Conversions).
//   Bottom row — 4 by-type cards with status-pill chips.
//
// Props:
//   agentId?   — when set, filter all opportunities to this agent's
//                owned set (matched by agent.name). When omitted, falls
//                back to the full session opportunity set (Agent Home
//                aggregate behavior).
//   lens       — date-lens token; see canon.DATE_LENS_OPTIONS.
//   orgIds     — number[]; reserved for Phase 2 once opps carry org_id.
//                Today fixture opps do NOT denormalize org_id (ADR 19 §6
//                Phase 1 cascade depth), so this prop is currently a
//                no-op filter. Kept on the API surface so consumers can
//                pass the active-org context without churn later.
//   onPillClick — ({ filter }) => void. Receives the same payload shape
//                AgentHome's handleFilterClick expects:
//                  'by_type:<type>' or 'by_status:<type>:<status>'.
//
// IMPORTANT: visual output when `agentId` is null is byte-identical to
// today's AgentHome KpiGrid + ByTypeRow.

const TERMINAL_STATUS_RE =
  /(funded|policy bound|policy written|paid in full|active|remitted|won|lost|closed|cancelled?|declined?|not interested|signed)/i;

function isOpen(opp) {
  if (!opp.status) return true;
  return !TERMINAL_STATUS_RE.test(opp.status);
}

const TYPE_TILE_ICON = {
  protection: ShieldCheck,
  refi: RefreshCcw,
  insurance: Umbrella,
  payments: Banknote,
};

const PILLS_PER_CARD_VISIBLE = 4;

export function AgentMetricsGrid({
  agentId = null,
  lens = 'recent',
  // eslint-disable-next-line no-unused-vars
  orgIds = [],
  onPillClick,
  // Optional — pass the App-level session bag so adds in Home reflect in
  // the metrics grid. Falls back to a fresh useSessionData() when unset
  // (AgentProfile uses the fallback today — the manager-pane mutates
  // nothing inline so a derived bag is sufficient).
  session: sessionProp,
}) {
  // Wave 31b-fu3 — opt out of writer registration; App.jsx is the host.
  const localSession = useSessionData({ registerAsHost: false });
  const session = sessionProp || localSession;
  const { opportunities } = session;

  const agent = useMemo(
    () => (agentId ? blinkerApi.agents.get(agentId) : null),
    [agentId],
  );

  const lensRange = useMemo(() => dateLensRange(lens), [lens]);
  const lensOption = useMemo(
    () => DATE_LENS_OPTIONS.find((o) => o.value === lens) || DATE_LENS_OPTIONS[0],
    [lens],
  );

  // Owner-scoped (when agentId set) + lens-scoped opportunity set.
  // Owner filtering uses agent.name to match opportunities.json's
  // `owner` field; see AgentProfile.jsx for the same pattern.
  const ownerScoped = useMemo(() => {
    if (!agent) return opportunities;
    return opportunities.filter((o) => o.owner === agent.name);
  }, [opportunities, agent]);

  const enriched = useMemo(
    () => ownerScoped.map((o) => ({ ...o, age: ageDays(o.created_at) })),
    [ownerScoped],
  );

  const lensScopedOpps = useMemo(
    () => enriched.filter((o) => withinLens(o.created_at, lensRange)),
    [enriched, lensRange],
  );

  const openOpps = useMemo(() => lensScopedOpps.filter(isOpen), [lensScopedOpps]);

  const byType = useMemo(() => {
    const counts = { protection: 0, refi: 0, insurance: 0, payments: 0 };
    for (const o of openOpps) {
      if (counts[o.type] !== undefined) counts[o.type] += 1;
    }
    return counts;
  }, [openOpps]);

  const avgAge = useMemo(() => {
    if (openOpps.length === 0) return 0;
    const total = openOpps.reduce((acc, o) => acc + o.age, 0);
    return Math.round(total / openOpps.length);
  }, [openOpps]);

  const oldest = useMemo(() => {
    if (openOpps.length === 0) return null;
    return openOpps.reduce((acc, o) => (acc && acc.age >= o.age ? acc : o));
  }, [openOpps]);

  const lostOpps = useMemo(
    () => lensScopedOpps.filter((o) => crmStageOf(o) === 'lost'),
    [lensScopedOpps],
  );
  const lostOldest = useMemo(() => {
    if (lostOpps.length === 0) return null;
    return lostOpps.reduce((acc, o) => (acc && acc.age >= o.age ? acc : o));
  }, [lostOpps]);

  const byStatusByType = useMemo(() => {
    const groups = {
      protection: new Map(),
      refi: new Map(),
      insurance: new Map(),
      payments: new Map(),
    };
    for (const o of openOpps) {
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
  }, [openOpps]);

  function fire(payload) {
    if (onPillClick) onPillClick(payload);
  }

  const totalByType = byType.protection + byType.refi + byType.insurance + byType.payments;

  return (
    <div>
      {/* KPI tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KpiTile
          icon={Inbox}
          iconClass="bg-blue-50 text-blue-600 ring-blue-200"
          label="Open opportunities"
          value={openOpps.length}
          sub={totalByType > 0 ? `${totalByType} workable` : 'queue empty'}
          onClick={() => fire('open_opps')}
        />
        <KpiTile
          icon={Clock}
          iconClass="bg-amber-50 text-amber-600 ring-amber-200"
          label="Avg open age"
          value={avgAge}
          suffix={avgAge === 1 ? 'day' : 'days'}
          sub={oldest ? `oldest: ${ageLabel(oldest.age)}` : '—'}
          onClick={() => fire('avg_age')}
        />
        <KpiTile
          icon={TrendingDown}
          iconClass="bg-rose-50 text-rose-600 ring-rose-200"
          label="Lost opportunities"
          value={lostOpps.length}
          sub={
            lostOpps.length === 0
              ? `no losses ${lensOption.headerLabel}`
              : lostOldest
                ? `oldest: ${ageLabel(lostOldest.age)}`
                : '—'
          }
          onClick={() => fire('lost_opps')}
        />
        <KpiTile
          icon={TrendingUp}
          iconClass="bg-emerald-50 text-emerald-600 ring-emerald-200"
          label={`Conversions ${lensOption.headerLabel}`}
          value={3}
          sub="placeholder count"
          onClick={() => fire('conversions')}
        />
      </div>

      {/* By-type cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {['protection', 'refi', 'insurance', 'payments'].map((t) => (
          <TypeCard
            key={t}
            type={t}
            count={byType[t]}
            pills={byStatusByType[t] || []}
            onClick={fire}
          />
        ))}
      </div>
    </div>
  );
}

function TypeCard({ type, count, pills, onClick }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = TYPE_TILE_ICON[type];
  const visiblePills = expanded ? pills : pills.slice(0, PILLS_PER_CARD_VISIBLE);
  const overflow = pills.length - PILLS_PER_CARD_VISIBLE;

  function handleExpand(e) {
    e.stopPropagation();
    track('mission_control.home.status_pills_expanded', {
      type,
      hidden_count: overflow,
    });
    setExpanded(true);
  }

  function handleCollapse(e) {
    e.stopPropagation();
    setExpanded(false);
  }

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
              onClick={handleExpand}
              aria-label={`Show ${overflow} more status${overflow === 1 ? '' : 'es'}`}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-medium ring-1 ring-inset bg-slate-50 text-slate-500 ring-slate-200 hover:bg-slate-100"
            >
              +{overflow} more
            </button>
          )}
          {expanded && overflow > 0 && (
            <button
              type="button"
              onClick={handleCollapse}
              aria-label="Show fewer statuses"
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
