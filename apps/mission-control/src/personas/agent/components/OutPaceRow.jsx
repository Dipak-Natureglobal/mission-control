// OutPaceRow — Wave 30. You-vs-Team comparison strip on AgentCompete.
//
// Renders three rows: Conversion, Avg handle time, Stale opps. Each row
// shows the agent's value, the team median, and a delta colored by
// improvement direction.
//
// Props:
//   agent     — { conversion, avg_handle_days, stale_count }
//   team      — { conversion, avg_handle_days, stale_count }  (medians)

function fmtPercent(v) {
  if (v == null) return '—';
  return `${Math.round(v * 100)}%`;
}
function fmtDays(v) {
  if (v == null) return '—';
  return `${v.toFixed(1)}d`;
}
function fmtInt(v) {
  if (v == null) return '—';
  return String(Math.round(v));
}

function deltaTone(direction) {
  // direction === 'better' → emerald; 'worse' → rose; 'same' → slate
  if (direction === 'better') return 'text-emerald-600';
  if (direction === 'worse') return 'text-rose-600';
  return 'text-slate-400';
}

// For metrics where higher is better, agentVal - teamVal > 0 = better.
// For metrics where lower is better (handle time, stale), flip.
function classifyDelta(agentVal, teamVal, lowerIsBetter = false) {
  if (agentVal == null || teamVal == null) return { direction: 'same', display: '—' };
  const raw = agentVal - teamVal;
  if (Math.abs(raw) < 1e-9) return { direction: 'same', display: '0' };
  const better = lowerIsBetter ? raw < 0 : raw > 0;
  return { direction: better ? 'better' : 'worse', display: raw };
}

function Row({ label, agentText, teamText, delta }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-slate-100 last:border-b-0">
      <div className="w-32 text-[11px] uppercase tracking-wider font-semibold text-slate-500">
        {label}
      </div>
      <div className="text-sm">
        <span className="font-semibold text-slate-900">{agentText}</span>
        <span className="text-slate-400 ml-2 text-[11px]">you</span>
      </div>
      <div className="text-sm">
        <span className="text-slate-700">{teamText}</span>
        <span className="text-slate-400 ml-2 text-[11px]">team median</span>
      </div>
      <div className={'ml-auto text-xs font-semibold ' + deltaTone(delta.direction)}>
        {delta.display}
      </div>
    </div>
  );
}

export function OutPaceRow({ agent, team }) {
  const a = agent || {};
  const t = team || {};

  const convDelta = classifyDelta(a.conversion, t.conversion, false);
  const handleDelta = classifyDelta(a.avg_handle_days, t.avg_handle_days, true);
  const staleDelta = classifyDelta(a.stale_count, t.stale_count, true);

  return (
    <div className="bg-white rounded-lg ring-1 ring-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
          You vs team
        </div>
      </div>
      <div className="px-4">
        <Row
          label="Conversion"
          agentText={fmtPercent(a.conversion)}
          teamText={fmtPercent(t.conversion)}
          delta={{
            direction: convDelta.direction,
            display: convDelta.direction === 'same'
              ? '—'
              : `${convDelta.display > 0 ? '+' : ''}${Math.round((convDelta.display || 0) * 100)}%`,
          }}
        />
        <Row
          label="Avg handle time"
          agentText={fmtDays(a.avg_handle_days)}
          teamText={fmtDays(t.avg_handle_days)}
          delta={{
            direction: handleDelta.direction,
            display: handleDelta.direction === 'same'
              ? '—'
              : `${handleDelta.display > 0 ? '+' : ''}${(handleDelta.display || 0).toFixed(1)}d`,
          }}
        />
        <Row
          label="Stale opps"
          agentText={fmtInt(a.stale_count)}
          teamText={fmtInt(t.stale_count)}
          delta={{
            direction: staleDelta.direction,
            display: staleDelta.direction === 'same'
              ? '—'
              : `${staleDelta.display > 0 ? '+' : ''}${Math.round(staleDelta.display || 0)}`,
          }}
        />
      </div>
    </div>
  );
}

export default OutPaceRow;
