import { Flame, Zap, Trophy } from 'lucide-react';

// HeroRank — Wave 30 Agent Compete hero block.
//
// Top of the screen. Renders:
//   - rank chip ("#2 of 8")
//   - headline ("You're #2 in Apex this week")
//   - big number (wins so far) + "N to goal · on pace" line
//   - pacing bar colored by status
//   - inline streak + fast-close chip strip
//
// Props:
//   rank          — integer
//   total         — integer (denominator for "of N")
//   orgName       — display string for the headline
//   wins          — current week wins
//   weeklyGoal    — number; renders "to goal" + bar
//   paceStatus    — 'ahead' | 'on_pace' | 'behind'
//   streakDays    — integer; chip rendered when > 0
//   fastCloseCount — integer; chip rendered when > 0

const PACE_BAR_COLOR = {
  ahead: 'bg-emerald-500',
  on_pace: 'bg-blue-500',
  behind: 'bg-slate-400',
};

const PACE_TEXT = {
  ahead: 'Ahead of pace',
  on_pace: 'On pace',
  behind: 'Behind pace',
};

const PACE_TEXT_COLOR = {
  ahead: 'text-emerald-700',
  on_pace: 'text-blue-700',
  behind: 'text-slate-600',
};

export function HeroRank({
  rank,
  total,
  orgName,
  wins = 0,
  weeklyGoal = 0,
  paceStatus = 'on_pace',
  streakDays = 0,
  fastCloseCount = 0,
}) {
  const toGoal = Math.max(0, (weeklyGoal || 0) - (wins || 0));
  const pct = weeklyGoal > 0 ? Math.max(0, Math.min(100, (wins / weeklyGoal) * 100)) : 0;
  const rankLabel = rank ? `#${rank}` : '—';

  return (
    <div className="bg-white rounded-lg ring-1 ring-slate-200 px-5 py-5 mb-5">
      <div className="flex items-start gap-4">
        <div className="shrink-0 inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-blue-50 to-emerald-50 ring-1 ring-slate-200">
          <span className="text-2xl font-bold text-slate-900">{rankLabel}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
            Your rank
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            {rank
              ? <>You're <span className="text-blue-600">{rankLabel}</span> of {total || 0} in {orgName || 'your team'} this week</>
              : <>Get on the board this week</>}
          </h2>
          <div className="mt-2 flex items-baseline gap-2 flex-wrap">
            <span className="text-3xl font-semibold text-slate-900 tabular-nums">{wins}</span>
            <span className="text-sm text-slate-500">
              {weeklyGoal > 0
                ? <>wins · <span className="font-semibold text-slate-700">{toGoal}</span> to goal</>
                : 'wins this week'}
            </span>
            {weeklyGoal > 0 && (
              <span className={'ml-auto text-xs font-semibold ' + (PACE_TEXT_COLOR[paceStatus] || PACE_TEXT_COLOR.on_pace)}>
                {PACE_TEXT[paceStatus] || PACE_TEXT.on_pace}
              </span>
            )}
          </div>
          {weeklyGoal > 0 && (
            <div className="mt-2 h-2 bg-slate-100 rounded overflow-hidden">
              <div
                className={'h-full rounded ' + (PACE_BAR_COLOR[paceStatus] || PACE_BAR_COLOR.on_pace)}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {streakDays > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-200">
                <Flame className="w-3.5 h-3.5" />
                <span>{streakDays}-day streak</span>
              </span>
            )}
            {fastCloseCount > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200">
                <Zap className="w-3.5 h-3.5" />
                <span>{fastCloseCount} fast close{fastCloseCount === 1 ? '' : 's'}</span>
              </span>
            )}
            {rank === 1 && (
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium bg-yellow-100 text-yellow-800 ring-1 ring-inset ring-yellow-200">
                <Trophy className="w-3.5 h-3.5" />
                <span>Top of the board</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default HeroRank;
