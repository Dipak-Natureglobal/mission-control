import { Flame, Zap, Target, TrendingUp, Rocket, Medal } from 'lucide-react';

// AchievementChip — Wave 30 shared. Renders one earned (or
// not-yet-earned) achievement as a chip with a lucide icon + label +
// optional value badge.
//
// Props:
//   achievement — { id, type, label, icon, value?, active }
//                 from blinkerApi.leaderboard.getAchievements(...)
//
// Active chips render filled (colored bg, white-ish text). Inactive
// chips render outlined (muted). Icons map by name so the SDK stays
// component-agnostic.

const ICON_MAP = {
  flame: Flame,
  zap: Zap,
  target: Target,
  trendingUp: TrendingUp,
  rocket: Rocket,
  medal: Medal,
};

const ACTIVE_TONE = {
  streak: 'bg-rose-100 text-rose-700 ring-rose-200',
  fast_close: 'bg-amber-100 text-amber-700 ring-amber-200',
  first_of_week: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  beat_team_avg_weeks: 'bg-blue-100 text-blue-700 ring-blue-200',
  fast_start: 'bg-purple-100 text-purple-700 ring-purple-200',
  streak_milestone: 'bg-yellow-100 text-yellow-800 ring-yellow-200',
};

export function AchievementChip({ achievement }) {
  if (!achievement) return null;
  const Icon = ICON_MAP[achievement.icon] || Flame;
  const tone = achievement.active
    ? (ACTIVE_TONE[achievement.type] || 'bg-slate-100 text-slate-700 ring-slate-200')
    : 'bg-white text-slate-400 ring-slate-200';
  return (
    <span
      className={
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium ring-1 ring-inset ' +
        tone
      }
    >
      <Icon className="w-3.5 h-3.5" />
      <span>{achievement.label}</span>
      {achievement.value != null && achievement.value !== 0 && achievement.type !== 'streak_milestone' && (
        <span className="text-[10px] font-semibold opacity-80">
          {achievement.value}
        </span>
      )}
    </span>
  );
}

export default AchievementChip;
