import { useEffect, useMemo, useState } from 'react';
import { Trophy } from 'lucide-react';
import { blinkerApi } from 'blinker-platform/api';
import { track } from 'blinker-platform/telemetry';
import { useActiveOrg } from '../../shell/active-org-context.jsx';
import { DateLensSelect } from '../../shared/DateLensSelect.jsx';
import { Leaderboard } from '../../shared/Leaderboard.jsx';
import { GoalCard } from '../../shared/GoalCard.jsx';
import { AchievementChip } from '../../shared/AchievementChip.jsx';
import { HeroRank } from './components/HeroRank.jsx';
import { OutPaceRow } from './components/OutPaceRow.jsx';

// AgentCompete — Wave 30. Agent persona Compete screen.
//
// Spec: architecture/20-sales-leaderboard.md §3.
//
// Reads `blinkerApi.leaderboard` for rankings + goals + achievements +
// team medians. The active-org context drives scoping (single-org for
// agents today — agent personas don't span orgs in Phase 1).
//
// Agent identity is hard-coded to `agent_jordan_reese` (Apex, agent_lead)
// so the screen has a stable demo subject. Mirrors AgentHome's hard-coded
// "Devon" placeholder pattern — replaced when agents.json[me] auth lands.

const ME_AGENT_ID = 'agent_jordan_reese';

export function AgentCompete({ session: _session }) {
  const { orgId, orgName } = useActiveOrg();
  const [lens, setLens] = useState('recent_30d');
  const [metric, setMetric] = useState('wins');

  // Idempotent per-day snapshot for trend arrows. Mounted once per nav.
  useEffect(() => {
    if (orgId == null) return;
    try {
      blinkerApi.leaderboard.snapshotRanksForToday({ org_ids: [orgId] });
    } catch (_) {
      // ignore — trend display tolerates missing history (renders dash)
    }
    track('mission_control.compete.viewed', {
      agent_id: ME_AGENT_ID,
      org_id: orgId,
      lens,
      metric,
    });
    // Fire once per mount; lens/metric toggles emit their own events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolved agent record — drives the "you" lookup in the leaderboard
  // row highlighting + HeroRank rank derivation. Resilient to a missing
  // fixture id (returns null when MY_ID not seeded).
  const meAgent = useMemo(
    () => blinkerApi.agents.get(ME_AGENT_ID),
    [],
  );

  // Rankings — scoped to the active org; current week for HeroRank,
  // selected lens for the table.
  const weeklyRankings = useMemo(() => {
    if (orgId == null) return [];
    return blinkerApi.leaderboard.getRankings({
      org_ids: [orgId],
      lens: 'this_week',
      metric: 'wins',
    });
  }, [orgId]);

  const lensRankings = useMemo(() => {
    if (orgId == null) return [];
    return blinkerApi.leaderboard.getRankings({
      org_ids: [orgId],
      lens,
      metric,
    });
  }, [orgId, lens, metric]);

  const myRankRow = useMemo(
    () => weeklyRankings.find((r) => r.agent?.id === ME_AGENT_ID) || null,
    [weeklyRankings],
  );

  // Goal cards — week / month wins + month revenue.
  const goalWeek = useMemo(
    () => blinkerApi.leaderboard.getAgentGoalProgress(ME_AGENT_ID, { period: 'week' }),
    [],
  );
  const goalMonth = useMemo(
    () => blinkerApi.leaderboard.getAgentGoalProgress(ME_AGENT_ID, { period: 'month' }),
    [],
  );
  const goalRevenue = useMemo(
    () => blinkerApi.leaderboard.getAgentGoalProgress(ME_AGENT_ID, { period: 'month_revenue' }),
    [],
  );

  // Achievements — across the active lens.
  const achievements = useMemo(
    () => blinkerApi.leaderboard.getAchievements(ME_AGENT_ID, { lens }),
    [lens],
  );

  // Out-pace — agent self workload vs team medians.
  const teamMedians = useMemo(() => {
    if (orgId == null) return null;
    return blinkerApi.leaderboard.getTeamMedians({ org_ids: [orgId], lens });
  }, [orgId, lens]);

  const myWorkload = useMemo(() => {
    if (!meAgent) return null;
    return {
      conversion: meAgent.conversion,
      avg_handle_days: meAgent.avg_handle_days,
      stale_count: meAgent.stale_count,
    };
  }, [meAgent]);

  const heroStreakDays = useMemo(() => {
    const s = achievements.find((a) => a.type === 'streak');
    return s ? s.value || 0 : 0;
  }, [achievements]);
  const heroFastClose = useMemo(() => {
    const f = achievements.find((a) => a.type === 'fast_close');
    return f ? f.value || 0 : 0;
  }, [achievements]);

  function handleMetricChange(next) {
    track('mission_control.compete.metric_toggled', { from: metric, to: next });
    setMetric(next);
  }

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <Header
          orgName={orgName}
          lens={lens}
          onLensChange={(v) => {
            track('mission_control.compete.lens_changed', { lens: v });
            setLens(v);
          }}
        />

        <HeroRank
          rank={myRankRow?.rank}
          total={weeklyRankings.length}
          orgName={orgName}
          wins={goalWeek?.wins ?? 0}
          weeklyGoal={goalWeek?.goal ?? 0}
          paceStatus={goalWeek?.pace_status ?? 'on_pace'}
          streakDays={heroStreakDays}
          fastCloseCount={heroFastClose}
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
          <GoalCard
            label="This week"
            current={goalWeek?.wins ?? 0}
            goal={goalWeek?.goal ?? 0}
            paceStatus={goalWeek?.pace_status ?? 'on_pace'}
          />
          <GoalCard
            label="This month"
            current={goalMonth?.wins ?? 0}
            goal={goalMonth?.goal ?? 0}
            paceStatus={goalMonth?.pace_status ?? 'on_pace'}
          />
          <GoalCard
            label="Monthly revenue"
            current={goalRevenue?.wins ?? 0}
            goal={goalRevenue?.goal ?? 0}
            paceStatus={goalRevenue?.pace_status ?? 'on_pace'}
            currency
          />
        </div>

        <div className="mb-5">
          <Leaderboard
            rankings={lensRankings}
            metric={metric}
            onMetricChange={handleMetricChange}
            lens={lens.replace(/_/g, ' ')}
            currentAgentId={ME_AGENT_ID}
          />
        </div>

        <div className="mb-5">
          <OutPaceRow agent={myWorkload} team={teamMedians} />
        </div>

        <Achievements achievements={achievements} />
      </div>
    </div>
  );
}

function Header({ orgName, lens, onLensChange }) {
  return (
    <div className="mb-6 flex items-start gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-blue-600 mb-1">
          <Trophy className="w-4 h-4" />
          <span className="text-xs uppercase tracking-wide font-semibold">
            Agent · Compete
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          See where you stand
          {orgName ? <> — <span className="text-slate-700">{orgName}</span></> : null}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Live ranking, goal pacing, and the badges you're working on this period.
        </p>
      </div>
      <div className="shrink-0 mt-1">
        <DateLensSelect value={lens} onChange={onLensChange} />
      </div>
    </div>
  );
}

function Achievements({ achievements }) {
  if (!achievements || achievements.length === 0) return null;
  return (
    <div className="bg-white rounded-lg ring-1 ring-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
          Achievements
        </div>
      </div>
      <div className="flex gap-2 flex-wrap p-3">
        {achievements.map((a) => (
          <AchievementChip key={a.id} achievement={a} />
        ))}
      </div>
    </div>
  );
}
