# ADR 20 — Sales Leaderboard & Competitive Agent View

**Status:** Accepted 2026-05-13. Wave 30 first draft.
**Owner:** Coordinator (`blinker-platform/`).
**Related:** [`19-manager-experience.md`](19-manager-experience.md) (Manager cascade), [`04-personas.md`](04-personas.md), [`canon/org-registry.json::sales_goals`](../canon/org-registry.json).

## 1. Problem

Agents work alone in their Inbox. There's no social or competitive signal — no "you're #2 this week", no streak counter, no peer comparison, no goal pacing. Sales-floor culture (whiteboard rankings, end-of-week call-outs, "rep of the week") doesn't have a digital surface in the platform yet.

## 2. Decision

Ship a dedicated **Compete** screen for the Agent persona that motivates through:
1. **Live peer ranking** — where you stand vs other agents in your org.
2. **Goal pacing** — weekly + monthly targets with "on pace / ahead / behind" indicators.
3. **Achievements** — earned badges for streaks, fast closes, fast starts, beating team avg.
4. **Out-pace metrics** — your conversion / handle time / stale count vs team median.
5. **Trends** — daily rank-history snapshots producing trend arrows.

Cascade to Manager via:
- Manager Home **Leaderboard widget** (replaces or augments today's by-agent strip).
- Team page **rank + trend columns** on AgentRosterTable.
- AgentProfile **goal-pacing card** + (Phase 2) per-agent goal editor + 1:1 reminder hook.

## 3. Agent Compete screen — layout

Nav key: `compete`. Eyebrow: `AGENT · COMPETE`.

Top to bottom:

### 3.1 Hero
- "You're **#2 of 8** in Apex this week"
- Big number: `7 wins · 3 to goal · On pace`
- Pacing bar: `[████████░░░] 70%` colored by status (slate=behind, blue=on-pace, emerald=ahead)
- Streak chip + fast-close count chip

### 3.2 Goal cards (3 across)
- **This week** — `7 of 10` + sparkline of last 7 days
- **This month** — `24 of 40` + sparkline of last 30 days
- **Monthly revenue** — `$18,400 of $30,000` + sparkline

Each card subtitle: "On pace" / "Ahead by N" / "Behind by N" based on linear extrapolation from elapsed-period%.

### 3.3 Leaderboard
- Toggle metric pills: **Wins** (default) / **Conversion** / **Revenue** / **Speed (avg handle time)**.
- Table rows: Rank, Agent (initials + name), Metric value, Trend arrow (▲N / ▼N / —).
- Current user row highlighted with `←You` chip.
- Top of list gets 🏆 emoji; bottom quartile gets no decoration.
- Lens-scoped (default `recent_30d`, reuses `DateLensSelect`).
- Sort follows the selected metric.

### 3.4 You vs Team (out-pace)
- Three rows: Conversion / Avg handle time / Stale opps.
- Each row: agent value · team median value · delta (color-coded improvement vs regression).

### 3.5 Achievements
- Horizontal chip strip — earned this period.
- Chip examples:
  - 🔥 `<N>-day streak` (active when streak ongoing)
  - ⚡ `Fast close (under 24h)` — count of qualifying closes this period
  - 🎯 `First of the week` — fired on Monday's first win
  - 📈 `Beat team avg <N>w` — rolling weekly comparison streak
  - 🚀 `Fast Start` — by EOD Tuesday, ≥ `fast_start_threshold_pct` of weekly goal hit
  - 🏅 `Streak milestone <N>` — unlocks at canon `streak_milestones[]` values

## 4. Manager cascade

### 4.1 Manager Home — Leaderboard widget
Replace or augment the existing by-agent strip with a ranked-list widget:
- Top 3 + bottom 3 (collapsible "show all").
- Columns: Rank, Agent, Wins (week), Trend.
- Click → AgentProfile drill-in.
- Metric toggle (Wins / Conversion / Revenue / Speed) matches Agent Compete.

### 4.2 Team page — rank + trend columns
- `AgentRosterTable` gains a **Rank** column (this week's rank) and **Trend** arrow.
- Quick filter pills extended: `Top performers` (top quartile), `Coaching candidates` (bottom quartile).

### 4.3 AgentProfile — goal-pacing card
- New section between header and workload: goal progress for this agent (mirror of Agent Compete's goal cards, manager-visible).
- Achievements strip (read-only mirror).
- Phase 2: per-agent goal override editor + "Add 1:1 reminder" affordance.

### 4.4 Multi-org leaderboard (when manager spans orgs)
- Manager Home gains an **Orgs** sub-tab on the leaderboard widget.
- Ranks the orgs themselves by team-wide metric.
- Click an org → drills into that org's agent leaderboard.

## 5. Data model

### 5.1 `canon/org-registry.json::sales_goals` (Phase 1)

```jsonc
"sales_goals": {
  "weekly_wins":              10,
  "monthly_wins":             40,
  "monthly_revenue":          30000,
  "fast_start_threshold_pct": 30,    // EOD Tuesday % of weekly_wins
  "fast_close_hours":         24,
  "streak_milestones":        [3, 5, 10, 15, 20]
}
```

Seeded on Apex 102 / Kings DR 103 / Rewardsco 106. Other orgs inherit defaults when the field is absent (consumer falls back to the Apex template).

### 5.2 Derived metrics

All computed at read time from `opportunities.json` + `activities.json`:

| Metric | Formula |
|---|---|
| Wins this period | `opps.filter(o => isWonStatus(o.status) && inLens(o.updated_at)).filter(o => o.owner === agent.name).length` |
| Revenue this period | `sumOf(opp.value)` across wins |
| Conversion | `wins / (wins + losses)` |
| Avg handle time | `median(won_at - created_at)` in days |
| Stale count | open opps where `updated_at < now - 7d` |
| Streak | consecutive days with ≥1 win (look back 30d) |
| Fast close | any opp where `won_at - created_at < fast_close_hours` |
| Fast start | by Tuesday EOD of current week, wins ≥ `weekly_wins × fast_start_threshold_pct / 100` |
| First of the week | first win of Monday→Sunday window for this agent |
| Beat team avg | rolling: each Monday compute team median for prior week; if agent ≥ median, increment streak |

### 5.3 Trend snapshots (Phase 1 localStorage)

Key: `blinker.leaderboard.history.v1`
Shape:
```json
{
  "<YYYY-MM-DD>": {
    "<org_id>": {
      "ranks": {
        "<agent_id>": { "wins": 12, "conversion": 0.67, "revenue": 18400 }
      }
    }
  }
}
```

Read at render time: compare today's snapshot to N days ago (default 7) to produce ▲N / ▼N / — arrows. Written by a `useEffect` on Compete-screen / Manager-Home mount (idempotent per-day per-org).

## 6. SDK — `packages/api/leaderboard.js`

New module. Methods:

- `getRankings({ org_ids, lens, metric }) → Array<{ rank, agent, value, trend }>` — sorted desc by metric (except `speed` ascending).
- `getAgentGoalProgress(agent_id, { period: 'week' | 'month' }) → { wins, goal, percent, pace_status }`
- `getAchievements(agent_id, { lens }) → Achievement[]`
- `getTeamMedians({ org_ids, lens }) → { conversion, avg_handle_days, stale_count }`
- `snapshotRanksForToday({ org_ids })` — idempotent localStorage write
- `getRankTrend(agent_id, org_id, metric, { days_ago = 7 }) → number` — +N / -N / 0 / null

Reads from existing `blinkerApi.agents.list()` + `blinkerApi.opportunities.list()` + `blinkerApi.activities.listAll()`. No new fixtures.

## 7. Telemetry

- `mission_control.compete.viewed { agent_id, org_id, lens, metric }`
- `mission_control.compete.metric_toggled { from, to }`
- `mission_control.compete.achievement_earned { id, period }` — fired once per achievement per period (idempotent via localStorage `blinker.leaderboard.achievements_seen.v1`)
- `mission_control.compete.fast_start_hit { agent_id, week }`
- `mission_control.compete.streak_milestone { agent_id, days }`
- `mission_control.manager.leaderboard_viewed { org_ids, metric }`
- `mission_control.manager.leaderboard_metric_toggled { from, to }`

## 8. Phasing

### Wave 30 (this build) — Agent Compete + Manager cascade MVP

- canon `sales_goals` block on 3 active orgs.
- `packages/api/leaderboard.js` SDK.
- `src/personas/agent/AgentCompete.jsx` screen (Hero + Goals + Leaderboard + Out-pace + Achievements).
- `src/personas/agent/components/{Leaderboard,GoalCard,AchievementChip}.jsx` (or under `src/shared/` if cleanly reusable).
- Nav: `compete` entry for Agent persona.
- Manager Home: leaderboard widget swap (toggle between by-agent strip + ranked leaderboard).
- AgentRosterTable: Rank + Trend columns.
- AgentProfile: goal-pacing card.

### Wave 30+1 — Polish

- Animated rank-change toast on win events.
- Multi-org leaderboard sub-tab on Manager Home.
- Streak-at-risk callout ("Win one today to keep your streak alive").
- Spotlight callout ("Top performer this week: Jordan Reese").

### Wave 31+ — Goal-setting + Phase 2

- Manager UI for per-agent goal overrides.
- "Set team target" affordance.
- Phase 2 DB backing (replace localStorage snapshots with server-side daily aggregate).
- Optional Slack/email digest of weekly leaderboard.

## 9. Out of scope

- Cash incentives / commission math (lives in legacy compensation system).
- External leaderboards (e.g., between dealerships in a network) — that's a parent-partner-manager view, not Phase 1.
- Customer-visible agent ratings.

## 10. Open questions

- **What counts as a "win"?** Today the consumer reads `status` against a hard-coded WIN list (`agents.js::WINNING_STATUSES`). The canonical winning-status set should land in `canon/ghl-status.json` per-type — once the agent leaderboard is real, this becomes load-bearing. Tracked as a follow-up.
- **Lens vocabulary alignment.** Compete uses `recent_30d` default (matches AgentProfile lens vocab from Wave 29c). Confirm this is the right default vs `this_week` (more leaderboard-natural). Phase 1: 30d default; provide week toggle.
- **Multi-org agents** (cross-org reassignment from Wave 29a creates agents whose `org_ids[]` spans multiple). For the leaderboard, an agent is ranked WITHIN each org they belong to (counted multiple times across org leaderboards, scoped per leaderboard).
- **Privacy** of bottom-rank visibility. Today every agent sees the full ranking. Worth a manager toggle later: "hide ranks below #N" so the bottom isn't publicly named.
