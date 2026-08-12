import { ArrowUp, ArrowDown, Minus } from 'lucide-react';

// Leaderboard — Wave 30 shared widget. Consumed by AgentCompete + ManagerHome.
//
// Renders metric toggle pills (Wins / Conversion / Revenue / Speed)
// followed by a ranked table: Rank · Agent · Value · Trend. The current
// user's row (when supplied via `currentAgentId`) is highlighted with a
// slate background and a `←You` chip. Rank 1 picks up a 🏆 emoji.
//
// Props:
//   rankings        — [{ rank, agent, value, trend }] from blinkerApi.leaderboard.getRankings
//   metric          — 'wins' | 'conversion' | 'revenue' | 'speed'
//   onMetricChange  — (next) => void; omit to render pills as read-only
//   lens            — optional badge string ("recent 30d", "this week")
//   onLensChange    — currently unused; reserved for future inline lens pill
//   currentAgentId  — optional; highlights the matching row + ←You chip
//
// Data-shape notes:
//   - `value` is null when there is no signal (no wins => no speed); the
//     row renders an em-dash.
//   - `trend` is +N/-N/0/null. null means "no history yet" (first day or
//     history was cleared); render a flat dash.

const METRICS = [
  { key: 'wins', label: 'Wins' },
  { key: 'conversion', label: 'Conversion' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'speed', label: 'Speed' },
];

function initialsOf(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatValue(metric, value) {
  if (value == null) return '—';
  if (metric === 'wins') return String(value);
  if (metric === 'conversion') return `${Math.round(value * 100)}%`;
  if (metric === 'revenue') {
    return `$${Math.round(value).toLocaleString()}`;
  }
  if (metric === 'speed') {
    return `${value.toFixed(1)}d`;
  }
  return String(value);
}

function Trend({ delta }) {
  if (delta == null) {
    return <span className="inline-flex items-center text-slate-300" aria-label="No trend data">—</span>;
  }
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-slate-400" aria-label="No change">
        <Minus className="w-3 h-3" />
        <span className="text-[11px]">0</span>
      </span>
    );
  }
  if (delta > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-emerald-600" aria-label={`Up ${delta}`}>
        <ArrowUp className="w-3 h-3" />
        <span className="text-[11px] font-semibold">{delta}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-rose-600" aria-label={`Down ${-delta}`}>
      <ArrowDown className="w-3 h-3" />
      <span className="text-[11px] font-semibold">{Math.abs(delta)}</span>
    </span>
  );
}

export function Leaderboard({
  rankings,
  metric = 'wins',
  onMetricChange,
  lens,
  currentAgentId = null,
}) {
  const rows = Array.isArray(rankings) ? rankings : [];

  return (
    <div className="bg-white rounded-lg ring-1 ring-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
          Leaderboard
        </div>
        {lens && (
          <span className="text-[11px] text-slate-400">· {lens}</span>
        )}
        <div className="ml-auto flex items-center gap-1 bg-slate-50 ring-1 ring-slate-200 rounded-md p-0.5">
          {METRICS.map((m) => {
            const active = m.key === metric;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => onMetricChange && onMetricChange(m.key)}
                disabled={!onMetricChange}
                className={
                  'text-xs font-medium px-2.5 py-1 rounded transition-colors ' +
                  (active
                    ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                    : 'text-slate-600 hover:text-slate-900')
                }
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-slate-400 text-center">
          No ranked agents in scope.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[10.5px] uppercase tracking-wider text-slate-500 bg-slate-50">
            <tr>
              <th className="text-left px-3 py-2 font-semibold w-12">Rank</th>
              <th className="text-left px-3 py-2 font-semibold">Agent</th>
              <th className="text-right px-3 py-2 font-semibold">{METRICS.find((m) => m.key === metric)?.label}</th>
              <th className="text-right px-3 py-2 font-semibold w-16">Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isCurrent = currentAgentId && r.agent?.id === currentAgentId;
              return (
                <tr
                  key={r.agent?.id || r.rank}
                  className={
                    'border-t border-slate-100 ' +
                    (isCurrent ? 'bg-slate-50' : 'hover:bg-slate-50')
                  }
                >
                  <td className="px-3 py-2 font-semibold text-slate-700">
                    {r.rank === 1 ? <span className="mr-1" aria-hidden="true">🏆</span> : null}
                    {r.rank}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-full bg-slate-100 text-slate-700 text-[11px] font-semibold flex items-center justify-center">
                        {initialsOf(r.agent?.name)}
                      </span>
                      <span className="text-sm text-slate-800 truncate">{r.agent?.name}</span>
                      {isCurrent && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700">
                          ←You
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-900">
                    {formatValue(metric, r.value)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Trend delta={r.trend} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default Leaderboard;
