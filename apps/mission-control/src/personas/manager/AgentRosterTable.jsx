import { useMemo, useRef, useState } from 'react';
import { Search, SlidersHorizontal, X, ArrowUpDown, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { blinkerApi } from 'blinker-platform/api';
import { useActiveOrg } from '../../shell/active-org-context.jsx';
import {
  AdvancedFilter,
  applyFilters,
  describeFilterValue,
} from '../../shared/AdvancedFilter.jsx';
import { BackToTop } from '../../shared/BackToTop.jsx';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll.js';
import { relativeTime } from '../../lib/canon.js';
import { track } from 'blinker-platform/telemetry';

// AgentRosterTable — Wave 28b. Manager Team page left pane.
//
// Spec: architecture/19-manager-experience.md §5.2.
//
// Columns: Agent / Open / Stale / Conversion / Avg handle time /
// Last active / Preset+tags. Reuses AdvancedFilter, useInfiniteScroll,
// BackToTop — does not reinvent any.
//
// Default sort = stale_count desc. Header click toggles sort.
// Quick-filter pills above the table; selecting one re-derives `visible`.
// Header KPI strip shows: total / with-stale-work / no-open-opps.

const PAGE_SIZE = 25;
const QUICK_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active_today', label: 'Active today' },
  { value: 'stale', label: 'Stale work' },
  { value: 'below_conversion', label: 'Below conversion threshold' },
  // Wave 30 — rank-driven cohorts. Top performers = top quartile by
  // this-week wins rank; coaching candidates = bottom quartile.
  { value: 'top_performers', label: 'Top performers' },
  { value: 'coaching_candidates', label: 'Coaching candidates' },
];
const CONVERSION_THRESHOLD = 0.4;
const ACTIVE_TODAY_WINDOW_MS = 24 * 3600 * 1000;

function initialsOf(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function sortValueFor(row, key) {
  switch (key) {
    case 'name': return (row.name || '').toLowerCase();
    case 'open_count': return row.open_count ?? 0;
    case 'stale_count': return row.stale_count ?? 0;
    case 'conversion': return row.conversion ?? -1;
    case 'avg_handle_days': return row.avg_handle_days ?? Number.POSITIVE_INFINITY;
    case 'last_active_at': return Date.parse(row.last_active_at || '') || 0;
    case 'preset_id': return row.preset_id || '';
    default: return row[key];
  }
}

export function AgentRosterTable({ onAgentClick }) {
  const { orgId, allOrgs, accessibleOrgIds } = useActiveOrg();
  const filter = allOrgs || orgId == null ? {} : { org_id: orgId };

  const allAgents = useMemo(
    () => blinkerApi.agents.list(filter).filter((a) => a.persona === 'agent'),
    // The active-org context is the only thing that should re-derive the
    // roster — list() is a pure read over fixtures + computeWorkload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orgId, allOrgs],
  );

  // Wave 30 — pre-compute the this-week wins ranking across the same
  // scope so each row can render its rank + trend without per-row SDK
  // calls. Trend is derived from localStorage snapshots; null on first
  // run / when history is missing.
  const scopeOrgIds = useMemo(() => {
    if (allOrgs) return accessibleOrgIds;
    if (orgId == null) return [];
    return [orgId];
  }, [orgId, allOrgs, accessibleOrgIds]);

  const rankings = useMemo(() => {
    if (scopeOrgIds.length === 0) return [];
    return blinkerApi.leaderboard.getRankings({
      org_ids: scopeOrgIds,
      lens: 'this_week',
      metric: 'wins',
    });
  }, [scopeOrgIds]);

  const rankByAgent = useMemo(() => {
    const m = new Map();
    for (const r of rankings) {
      if (r.agent?.id) m.set(r.agent.id, r);
    }
    return m;
  }, [rankings]);

  // Quartile boundaries on rank for Top / Coaching cohorts.
  const quartiles = useMemo(() => {
    const n = rankings.length;
    if (n < 4) return { topMax: Math.max(1, Math.ceil(n / 2)), bottomMin: n };
    const topMax = Math.max(1, Math.ceil(n * 0.25));
    const bottomMin = Math.max(1, Math.floor(n * 0.75) + 1);
    return { topMax, bottomMin };
  }, [rankings]);

  const [search, setSearch] = useState('');
  const [quick, setQuick] = useState('all');
  const [advOpen, setAdvOpen] = useState(false);
  const [advValues, setAdvValues] = useState({});
  const [sortCol, setSortCol] = useState('stale_count');
  const [sortDir, setSortDir] = useState('desc');

  const presetEnum = useMemo(() => {
    const seen = new Set();
    allAgents.forEach((a) => { if (a.preset_id) seen.add(a.preset_id); });
    return Array.from(seen).sort().map((p) => ({ value: p, label: p }));
  }, [allAgents]);

  const tagEnum = useMemo(() => {
    const seen = new Set();
    allAgents.forEach((a) => (a.tags || []).forEach((t) => seen.add(t)));
    return Array.from(seen).sort().map((t) => ({ value: t, label: t }));
  }, [allAgents]);

  const filterSchema = useMemo(() => ([
    { key: 'preset_id', label: 'Preset', field: 'agent.preset_id', type: 'enum', enumValues: presetEnum, level: 'agent' },
    { key: 'tag', label: 'Tag', field: 'agent.tags', type: 'enum', enumValues: tagEnum, level: 'agent' },
    { key: 'last_active_at', label: 'Last active', field: 'agent.last_active_at', type: 'date_range', level: 'agent' },
    { key: 'open_count', label: 'Open count', field: 'agent.open_count', type: 'number_range', level: 'agent' },
  ]), [presetEnum, tagEnum]);

  function getter(row, field) {
    if (!field) return null;
    if (field === 'agent.tags') return row.tags || [];
    if (field.startsWith('agent.')) {
      const rest = field.slice('agent.'.length);
      return rest.split('.').reduce((acc, k) => (acc == null ? null : acc[k]), row);
    }
    return null;
  }

  const visible = useMemo(() => {
    let rows = allAgents;
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      rows = rows.filter((a) => {
        const hay = [
          a.name, a.email, a.preset_id, ...(a.tags || []),
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    rows = applyFilters(rows, filterSchema, advValues, getter);
    if (quick === 'active_today') {
      const cutoff = Date.now() - ACTIVE_TODAY_WINDOW_MS;
      rows = rows.filter((a) => (Date.parse(a.last_active_at || '') || 0) >= cutoff);
    } else if (quick === 'stale') {
      rows = rows.filter((a) => (a.stale_count || 0) > 0);
    } else if (quick === 'below_conversion') {
      rows = rows.filter((a) => a.conversion != null && a.conversion < CONVERSION_THRESHOLD);
    } else if (quick === 'top_performers') {
      rows = rows.filter((a) => {
        const r = rankByAgent.get(a.id);
        return r != null && r.rank <= quartiles.topMax;
      });
    } else if (quick === 'coaching_candidates') {
      rows = rows.filter((a) => {
        const r = rankByAgent.get(a.id);
        return r != null && r.rank >= quartiles.bottomMin;
      });
    }
    rows = [...rows].sort((a, b) => {
      const va = sortValueFor(a, sortCol);
      const vb = sortValueFor(b, sortCol);
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va;
      }
      const sa = String(va ?? '');
      const sb = String(vb ?? '');
      return sortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
    return rows;
  }, [allAgents, search, advValues, filterSchema, quick, sortCol, sortDir, rankByAgent, quartiles]);

  const kpis = useMemo(() => ({
    total: allAgents.length,
    withStale: allAgents.filter((a) => (a.stale_count || 0) > 0).length,
    noOpen: allAgents.filter((a) => (a.open_count || 0) === 0).length,
  }), [allAgents]);

  const activeAdvChips = useMemo(() => (
    filterSchema
      .map((f) => {
        const desc = describeFilterValue(f, advValues[f.key]);
        if (desc == null) return null;
        return { field: f, text: desc };
      })
      .filter(Boolean)
  ), [advValues, filterSchema]);

  const { visibleRows, sentinelRef, scrollerRef, hasMore } = useInfiniteScroll(
    visible,
    { pageSize: PAGE_SIZE },
  );
  const scrollContainerRef = useRef(null);

  function toggleSort(col) {
    if (col === sortCol) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir(col === 'stale_count' || col === 'open_count' ? 'desc' : 'asc');
    }
    track('mission_control.manager.team.roster_sorted', { column: col });
  }

  function clearAdvChip(key) {
    setAdvValues((v) => {
      const next = { ...v };
      delete next[key];
      return next;
    });
  }

  function handleRowClick(agent) {
    track('mission_control.manager.team.agent_row_clicked', { agent_id: agent.id });
    if (onAgentClick) onAgentClick(agent.id);
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-white">
      <div className="px-5 pt-4 pb-3 border-b border-slate-200">
        <div className="grid grid-cols-3 gap-3 mb-3">
          <KpiTile label="Agents in scope" value={kpis.total} />
          <KpiTile label="With stale work" value={kpis.withStale} tone={kpis.withStale > 0 ? 'rose' : null} />
          <KpiTile label="No open opps" value={kpis.noOpen} tone={kpis.noOpen > 0 ? 'amber' : null} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-50 ring-1 ring-slate-200 rounded-md p-0.5">
            {QUICK_FILTERS.map((q) => (
              <button
                key={q.value}
                type="button"
                onClick={() => setQuick(q.value)}
                className={
                  'text-xs font-medium px-2.5 py-1 rounded ' +
                  (quick === q.value
                    ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                    : 'text-slate-600 hover:text-slate-900')
                }
              >
                {q.label}
              </button>
            ))}
          </div>

          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents…"
              className="w-full text-sm border border-slate-200 rounded-md pl-7 pr-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <button
            type="button"
            onClick={() => setAdvOpen(true)}
            className="inline-flex items-center gap-1.5 text-sm border border-slate-200 rounded-md px-2.5 py-1.5 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <SlidersHorizontal className="w-4 h-4 text-slate-500" />
            Filters
            {activeAdvChips.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-4 px-1 rounded-full bg-emerald-600 text-white text-[10px] font-semibold">
                {activeAdvChips.length}
              </span>
            )}
          </button>
        </div>

        {activeAdvChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {activeAdvChips.map(({ field, text }) => (
              <span
                key={field.key}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"
              >
                <span className="font-semibold">{field.label}:</span> {text}
                <button
                  type="button"
                  onClick={() => clearAdvChip(field.key)}
                  className="ml-0.5 hover:text-emerald-900"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div
        ref={(node) => { scrollContainerRef.current = node; scrollerRef.current = node; }}
        className="flex-1 overflow-auto"
      >
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 sticky top-0 z-10">
            <tr>
              <th className="text-left px-3 py-2 font-semibold w-12">Rank</th>
              <Th label="Agent" col="name" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
              <th className="text-center px-2 py-2 font-semibold w-16">Trend</th>
              <Th label="Open" col="open_count" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} align="right" />
              <Th label="Stale" col="stale_count" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} align="right" />
              <Th label="Conversion" col="conversion" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} align="right" />
              <Th label="Avg handle" col="avg_handle_days" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} align="right" />
              <Th label="Last active" col="last_active_at" sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
              <th className="text-left px-3 py-2 font-semibold">Preset / Tags</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((a) => {
              const r = rankByAgent.get(a.id);
              return (
              <tr
                key={a.id}
                onClick={() => handleRowClick(a)}
                className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
              >
                <td className="px-3 py-2 font-semibold text-slate-700">
                  {r ? (
                    <>
                      {r.rank === 1 ? <span className="mr-1" aria-hidden="true">🏆</span> : null}
                      {r.rank}
                    </>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2.5">
                    <Avatar initials={initialsOf(a.name)} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">{a.name}</div>
                      <div className="text-[11px] text-slate-500 truncate">{a.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2 text-center">
                  <TrendCell delta={r?.trend} />
                </td>
                <td className="px-3 py-2 text-right">
                  <OpenCountBadge value={a.open_count} />
                </td>
                <td className="px-3 py-2 text-right">
                  <span className={(a.stale_count || 0) > 0 ? 'text-rose-600 font-medium' : 'text-slate-400'}>
                    {a.stale_count || 0}
                  </span>
                </td>
                <td className="px-3 py-2 text-right text-slate-700">
                  {a.conversion == null ? <span className="text-slate-300">—</span> : `${(a.conversion * 100).toFixed(0)}%`}
                </td>
                <td className="px-3 py-2 text-right text-slate-700">
                  {a.avg_handle_days == null ? <span className="text-slate-300">—</span> : `${a.avg_handle_days.toFixed(1)}d`}
                </td>
                <td className="px-3 py-2 text-slate-600 text-[12px] whitespace-nowrap">
                  {a.last_active_at ? relativeTime(a.last_active_at) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {a.preset_id && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700">
                        {a.preset_id}
                      </span>
                    )}
                    {(a.tags || []).slice(0, 3).map((t) => (
                      <span key={t} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700">
                        {t}
                      </span>
                    ))}
                    {(a.tags || []).length > 3 && (
                      <span className="text-[10px] text-slate-400">
                        +{(a.tags || []).length - 3}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-sm text-slate-400">
                  No agents match the current filters.
                </td>
              </tr>
            )}
            {hasMore && (
              <tr ref={sentinelRef}>
                <td colSpan={9} className="px-4 py-3 text-center text-[11px] text-slate-400 italic">
                  Loading more…
                </td>
              </tr>
            )}
            {!hasMore && visible.length > PAGE_SIZE && (
              <tr>
                <td colSpan={9} className="px-4 py-3 text-center text-[11px] text-slate-400 italic">
                  End of list · {visible.length} agents
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <BackToTop scrollerRef={scrollContainerRef} threshold={600} />

      <AdvancedFilter
        open={advOpen}
        onClose={() => setAdvOpen(false)}
        schema={filterSchema}
        values={advValues}
        onApply={(next) => setAdvValues(next)}
        onClear={() => setAdvValues({})}
      />
    </div>
  );
}

function Th({ label, col, sortCol, sortDir, onSort, align = 'left' }) {
  const active = sortCol === col;
  const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      className={
        'px-3 py-2 font-semibold cursor-pointer select-none ' +
        (align === 'right' ? 'text-right' : 'text-left')
      }
      onClick={() => onSort(col)}
    >
      <span className={'inline-flex items-center gap-1 ' + (active ? 'text-slate-900' : 'text-slate-500')}>
        {label}
        <Icon className="w-3 h-3" />
      </span>
    </th>
  );
}

function Avatar({ initials }) {
  return (
    <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold flex items-center justify-center shrink-0">
      {initials}
    </div>
  );
}

function OpenCountBadge({ value }) {
  const v = value || 0;
  const tone = v > 10 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700';
  return (
    <span className={'inline-flex items-center justify-center min-w-[1.75rem] px-1.5 py-0.5 rounded text-xs font-medium ' + tone}>
      {v}
    </span>
  );
}

// TrendCell — renders the Wave 30 trend delta column. null = no history
// yet (first snapshot run); 0 = no change; +N improved; -N worsened.
function TrendCell({ delta }) {
  if (delta == null) {
    return <span className="text-slate-300 text-[11px]">—</span>;
  }
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-slate-400" aria-label="No change">
        <Minus className="w-3 h-3" />
      </span>
    );
  }
  if (delta > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-emerald-600 font-semibold" aria-label={`Up ${delta}`}>
        <ArrowUp className="w-3 h-3" />
        <span className="text-[11px]">{delta}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-rose-600 font-semibold" aria-label={`Down ${-delta}`}>
      <ArrowDown className="w-3 h-3" />
      <span className="text-[11px]">{Math.abs(delta)}</span>
    </span>
  );
}

function KpiTile({ label, value, tone }) {
  const toneClass =
    tone === 'rose' ? 'text-rose-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-900';
  return (
    <div className="bg-slate-50 ring-1 ring-slate-200 rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">{label}</div>
      <div className={'text-xl font-semibold mt-0.5 ' + toneClass}>{value}</div>
    </div>
  );
}
