// GoalCard — Wave 30 shared. Renders weekly/monthly/revenue goal pacing
// with a colored progress bar, "On pace / Ahead by N / Behind by N"
// sub-line, and an optional inline SVG sparkline (12 bars, no external dep).
//
// Props:
//   label          — eyebrow text ("This week", "This month")
//   current        — current count or amount
//   goal           — target count or amount; renders "—" when 0/missing
//   paceStatus     — 'ahead' | 'on_pace' | 'behind'
//   sparklineData  — optional number[] (last N buckets); auto-scaled
//   currency       — when true, formats current/goal as $ amounts
//
// The progress bar caps visually at 100% but always reflects the real
// percent in the label.

function formatAmount(n, currency) {
  if (n == null) return '—';
  if (currency) return `$${Math.round(n).toLocaleString()}`;
  return String(n);
}

function paceLabel(current, goal, status) {
  if (current == null || goal == null || goal <= 0) return '';
  // Expected at "now" is implicit in pace_status; we surface a rounded
  // delta for the user-facing sub-line.
  if (status === 'ahead') {
    const overshoot = Math.max(0, Math.round(current - goal * 0.5));
    return `Ahead${overshoot > 0 ? ` by ${overshoot}` : ''}`;
  }
  if (status === 'behind') {
    const gap = Math.max(0, Math.round(goal - current));
    return `Behind by ${gap}`;
  }
  return 'On pace';
}

const PACE_COLOR = {
  ahead: 'bg-emerald-500',
  on_pace: 'bg-blue-500',
  behind: 'bg-slate-400',
};

const PACE_LABEL_COLOR = {
  ahead: 'text-emerald-700',
  on_pace: 'text-blue-700',
  behind: 'text-slate-600',
};

function Sparkline({ data }) {
  if (!Array.isArray(data) || data.length === 0) return null;
  const max = data.reduce((a, b) => Math.max(a, b || 0), 0);
  const W = 120;
  const H = 24;
  const bw = W / data.length;
  return (
    <svg
      width={W}
      height={H}
      role="img"
      aria-label="Goal pace trend"
      className="block"
    >
      {data.map((c, i) => {
        const v = c || 0;
        const h = max === 0 ? 1 : Math.max(1, Math.round((v / max) * (H - 2)));
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
            className="text-slate-400"
          />
        );
      })}
    </svg>
  );
}

export function GoalCard({
  label,
  current,
  goal,
  paceStatus = 'on_pace',
  sparklineData,
  currency = false,
}) {
  const hasGoal = goal != null && goal > 0;
  const rawPct = hasGoal ? (current / goal) * 100 : 0;
  const barPct = Math.max(0, Math.min(100, rawPct));
  const barColor = PACE_COLOR[paceStatus] || PACE_COLOR.on_pace;
  const labelColor = PACE_LABEL_COLOR[paceStatus] || PACE_LABEL_COLOR.on_pace;

  return (
    <div className="bg-white rounded-lg ring-1 ring-slate-200 px-4 py-3.5">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
        {label}
      </div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className="text-2xl font-semibold tracking-tight text-slate-900">
          {formatAmount(current, currency)}
        </span>
        {hasGoal && (
          <span className="text-xs text-slate-500 font-medium">
            of {formatAmount(goal, currency)}
          </span>
        )}
      </div>
      <div className="mt-2 h-2 bg-slate-100 rounded overflow-hidden">
        <div
          className={'h-full rounded ' + barColor}
          style={{ width: `${barPct}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className={'text-[11px] font-semibold ' + labelColor}>
          {paceLabel(current, goal, paceStatus)}
        </span>
        <span className="text-[11px] text-slate-400">
          {hasGoal ? `${Math.round(rawPct)}%` : '—'}
        </span>
      </div>
      {sparklineData && sparklineData.length > 0 && (
        <div className="mt-2">
          <Sparkline data={sparklineData} />
        </div>
      )}
    </div>
  );
}

export default GoalCard;
