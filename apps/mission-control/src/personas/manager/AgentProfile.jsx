import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Send,
  Pencil,
  Trash2,
  ArrowRight,
  Users,
  Activity as ActivityIcon,
  Phone,
  Mail,
  MessageSquare,
  RotateCcw,
  StickyNote,
  Share2,
} from 'lucide-react';
import { blinkerApi } from 'blinker-platform/api';
import { track } from 'blinker-platform/telemetry';
import orgRegistry from '../../constants/canon/org-registry.json';
import {
  TYPE_LABELS,
  TYPE_BADGE,
  statusPillClasses,
  ageDays,
  ageLabel,
  relativeTime,
  dateLensRange,
  withinLens,
} from '../../lib/canon.js';
import { useActiveOrg } from '../../shell/active-org-context.jsx';
import { DateLensSelect } from '../../shared/DateLensSelect.jsx';
import { AgentMetricsGrid } from '../../shared/AgentMetricsGrid.jsx';
import { GoalCard } from '../../shared/GoalCard.jsx';
import { AchievementChip } from '../../shared/AchievementChip.jsx';

// AgentProfile — Wave 28b. Right pane of Manager Team page.
//
// Spec: architecture/19-manager-experience.md §5.2.
// Sections: 1 header, 2 workload KPIs, 3 inbox snapshot, 4 conversion by
// type, 5 recent activity, 6 coaching notes (manager-only), 7 reassign
// workload (manager-only).
//
// Mirrors ContactProfile.jsx structurally (Header + sections in a scroll
// container). URL/right-state plumbing is owned by ManagerTeam.jsx — this
// component is presentational + delegates clicks via props.

const TYPES_ORDER = ['protection', 'refi', 'insurance', 'payments'];

function initialsOf(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function orgChips(agent) {
  const byId = new Map((orgRegistry.orgs || []).map((o) => [o.id, o]));
  return (agent.org_ids || []).map((id) => byId.get(id)).filter(Boolean);
}

export function AgentProfile({
  agentId,
  persona = 'manager',
  onClose,
  onOpenOppInCoPilot,
  onReassign,
}) {
  // Wave 29c — date lens drives Workload (AgentMetricsGrid), Conversion
  // by Type, and Recent Activity. Inbox Snapshot is explicitly NOT lens-
  // filtered per spec (always shows the 10 oldest open opps).
  const [dateLens, setDateLens] = useState('recent');
  const lensRange = useMemo(() => dateLensRange(dateLens), [dateLens]);

  const { orgId } = useActiveOrg();

  const agent = useMemo(() => blinkerApi.agents.get(agentId), [agentId]);

  const [coachingNotes, setCoachingNotes] = useState(() =>
    agentId ? blinkerApi.agents.listCoachingNotes(agentId) : [],
  );
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');

  useEffect(() => {
    if (!agent) return;
    track('mission_control.manager.agent_profile.opened', { agent_id: agentId });
    return () => {
      track('mission_control.manager.agent_profile.closed', { agent_id: agentId });
    };
  }, [agentId, agent]);

  if (!agent) {
    return (
      <section className="flex-1 flex flex-col bg-white">
        <Header title="Agent not found" onBack={onClose} />
        <div className="flex-1 flex items-center justify-center text-sm text-slate-400">
          No agent record for <code className="font-mono mx-1">{agentId}</code>.
        </div>
      </section>
    );
  }

  // ── Inbox snapshot — 10 oldest open opps owned by this agent ──
  // NOT lens-filtered per spec — always the 10 oldest currently-open.
  const ownedOpps = useMemo(
    () => blinkerApi.opportunities.list({}).filter((o) => o.owner === agent.name),
    [agent.name],
  );
  const oldestOpen = useMemo(() => {
    const LOSING = /(lost|abandoned|cancelled|cold|disqualified|declined|not interested|payment failed|rejected)/i;
    return ownedOpps
      .filter((o) => !LOSING.test(o.status || ''))
      .slice()
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .slice(0, 10);
  }, [ownedOpps]);

  // Lens-scoped owned opps — drives Conversion by Type (Option A: agent
  // vs org-median comparison) below. Workload itself now lives in the
  // shared AgentMetricsGrid which manages its own lens-aware data path.
  const lensScopedOwnedOpps = useMemo(
    () => ownedOpps.filter((o) => withinLens(o.created_at, lensRange)),
    [ownedOpps, lensRange],
  );

  // ── Conversion by type: agent vs org median, lens-scoped ──
  // Kept (Option A) because AgentMetricsGrid surfaces per-type counts
  // but NOT the cross-agent median context that helps a manager
  // calibrate this agent's per-type performance.
  const conversionByType = useMemo(() => {
    const orgAgents = blinkerApi.agents.list({}).filter((a) => a.persona === 'agent');
    const allOpps = blinkerApi.opportunities.list({});
    const lensOpps = allOpps.filter((o) => withinLens(o.created_at, lensRange));
    const WINNING = /(won|funded|policy written|paid in full|booked|agreement signed|remitted|active)/i;
    const LOSING = /(lost|abandoned|cancelled|cold|disqualified|declined|not interested|payment failed)/i;
    const out = [];
    for (const t of TYPES_ORDER) {
      const agentOpps = lensScopedOwnedOpps.filter((o) => o.type === t);
      const w = agentOpps.filter((o) => WINNING.test(o.status || '')).length;
      const l = agentOpps.filter((o) => LOSING.test(o.status || '')).length;
      const denom = w + l;
      const value = denom > 0 ? w / denom : null;
      // Org median for type, same lens window.
      const peerRates = orgAgents
        .map((peer) => {
          const peerOpps = lensOpps.filter((o) => o.type === t && o.owner === peer.name);
          const pw = peerOpps.filter((o) => WINNING.test(o.status || '')).length;
          const pl = peerOpps.filter((o) => LOSING.test(o.status || '')).length;
          return (pw + pl) > 0 ? pw / (pw + pl) : null;
        })
        .filter((v) => v != null);
      let median = null;
      if (peerRates.length) {
        const sorted = peerRates.slice().sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
      }
      out.push({ type: t, value, median });
    }
    return out;
  }, [lensScopedOwnedOpps, lensRange]);

  // ── Recent activity — lens-filtered by occurred_at ──
  const recentActivity = useMemo(() => {
    const all = blinkerApi.activities.listAll({ limit: 200 });
    // Fixture actor_ids today are short slugs like 'agent_jordan' that
    // don't perfectly match agents.json ids ('agent_jordan_reese'). We
    // first try strict-equality then a prefix-match fallback so the feed
    // surfaces something useful without a fixture rewrite. When zero
    // matches, the section renders an attribution-coming placeholder.
    const exact = all.filter((a) => a.actor_id === agent.id);
    const matched = exact.length > 0
      ? exact
      : all.filter((a) => {
          const prefixSlug = agent.id.split('_').slice(0, 2).join('_');
          return a.actor_id && a.actor_id.startsWith(prefixSlug);
        });
    return matched
      .filter((a) => withinLens(a.occurred_at, lensRange))
      .slice(0, 25);
  }, [agent.id, lensRange]);

  function addCoachingNote() {
    const body = draft.trim();
    if (!body) return;
    const note = blinkerApi.agents.addCoachingNote(agent.id, body, { author_id: 'manager_session' });
    setCoachingNotes((prev) => [note, ...prev]);
    setDraft('');
    track('mission_control.manager.agent_profile.coaching_note_added', {
      agent_id: agent.id,
      body_length: body.length,
    });
  }

  function startEdit(note) {
    setEditingId(note.id);
    setEditDraft(note.body);
  }
  function commitEdit() {
    if (!editingId) return;
    const body = editDraft.trim();
    if (!body) return;
    const updated = blinkerApi.agents.editCoachingNote(agent.id, editingId, body);
    if (updated) {
      setCoachingNotes((prev) => prev.map((n) => (n.id === editingId ? updated : n)));
    }
    setEditingId(null);
    setEditDraft('');
    track('mission_control.manager.agent_profile.coaching_note_edited', { agent_id: agent.id });
  }
  function deleteNote(noteId) {
    if (blinkerApi.agents.deleteCoachingNote(agent.id, noteId)) {
      setCoachingNotes((prev) => prev.filter((n) => n.id !== noteId));
      track('mission_control.manager.agent_profile.coaching_note_deleted', { agent_id: agent.id });
    }
  }

  function handleReassign() {
    track('mission_control.manager.agent_profile.reassign_clicked', { agent_id: agent.id });
    if (onReassign) onReassign(agent.id);
  }

  function handleOppClick(oppId) {
    track('mission_control.manager.agent_profile.opp_clicked', { agent_id: agent.id, opp_id: oppId });
    if (onOpenOppInCoPilot) onOpenOppInCoPilot(oppId);
  }

  // Wave 29c — AgentMetricsGrid pill clicks. KPI tile tokens
  // ('open_opps' | 'avg_age' | 'lost_opps' | 'conversions') and
  // by-type/by-status payloads. AgentProfile lives in a right-pane
  // context — without an inbox-route handoff prop we just record the
  // intent so the manager-Inbox handoff lands in a follow-up wave
  // (filter by owner = this agent + type/status).
  function handleMetricsClick(payload) {
    track('mission_control.manager.agent_profile.metric_clicked', {
      agent_id: agent.id,
      payload,
    });
  }

  const orgs = orgChips(agent);
  const canCoach = persona === 'manager' || persona === 'admin' || persona === 'super_admin';
  const canReassign = canCoach;

  // Wave 30 — manager-only goal pacing card. Reads canon `sales_goals`
  // for the agent's primary org via leaderboard SDK; null pace means
  // missing/zero goal (renders nothing). Achievements mirror the Agent
  // Compete strip read-only.
  const goalWeek = useMemo(
    () => (canCoach ? blinkerApi.leaderboard.getAgentGoalProgress(agent.id, { period: 'week' }) : null),
    [agent.id, canCoach],
  );
  const goalMonth = useMemo(
    () => (canCoach ? blinkerApi.leaderboard.getAgentGoalProgress(agent.id, { period: 'month' }) : null),
    [agent.id, canCoach],
  );
  const goalRevenue = useMemo(
    () => (canCoach ? blinkerApi.leaderboard.getAgentGoalProgress(agent.id, { period: 'month_revenue' }) : null),
    [agent.id, canCoach],
  );
  const agentAchievements = useMemo(
    () => (canCoach ? blinkerApi.leaderboard.getAchievements(agent.id, { lens: dateLens }) : []),
    [agent.id, canCoach, dateLens],
  );

  return (
    <section className="flex-1 flex flex-col bg-white overflow-hidden">
      <Header title={agent.name} subtitle={agent.id} onBack={onClose} />

      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-6 py-5 space-y-5">

          {/* 1. Header — agent identity + date-lens select on the right
              edge. Lens drives Workload, Conversion by Type, and Recent
              Activity sections. Inbox Snapshot intentionally ignores it. */}
          <Section title="Agent">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 text-base font-semibold flex items-center justify-center shrink-0">
                {initialsOf(agent.name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold text-slate-900">{agent.name}</div>
                <div className="text-xs text-slate-500">{agent.email}</div>
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  {agent.preset_id && (
                    <Pill className="bg-slate-100 text-slate-700">{agent.preset_id}</Pill>
                  )}
                  {orgs.map((o) => (
                    <Pill key={o.id} className="bg-emerald-50 text-emerald-700">
                      {o.name}
                    </Pill>
                  ))}
                  {agent.last_active_at && (
                    <span className="text-[11px] text-slate-500">
                      Last active {relativeTime(agent.last_active_at)}
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0">
                <DateLensSelect
                  value={dateLens}
                  onChange={(v) => {
                    track('mission_control.manager.agent_profile.date_lens_changed', {
                      agent_id: agent.id,
                      lens: v,
                    });
                    setDateLens(v);
                  }}
                />
              </div>
            </div>
          </Section>

          {/* 1b. Goal pacing — Wave 30 manager-visible insert. Reads
              canon `sales_goals` via blinkerApi.leaderboard. Gated to
              manager / admin / super_admin only — agents never see
              another agent's goal pacing through this view. */}
          {canCoach && (goalWeek || goalMonth || goalRevenue) && (
            <Section title="Goal pacing">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {goalWeek && (
                  <GoalCard
                    label="This week"
                    current={goalWeek.wins}
                    goal={goalWeek.goal}
                    paceStatus={goalWeek.pace_status}
                  />
                )}
                {goalMonth && (
                  <GoalCard
                    label="This month"
                    current={goalMonth.wins}
                    goal={goalMonth.goal}
                    paceStatus={goalMonth.pace_status}
                  />
                )}
                {goalRevenue && (
                  <GoalCard
                    label="Monthly revenue"
                    current={goalRevenue.wins}
                    goal={goalRevenue.goal}
                    paceStatus={goalRevenue.pace_status}
                    currency
                  />
                )}
              </div>
              {agentAchievements.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {agentAchievements.map((a) => (
                    <AchievementChip key={a.id} achievement={a} />
                  ))}
                </div>
              )}
            </Section>
          )}

          {/* 2. Workload — shared AgentMetricsGrid filtered to this agent.
              Replaces the original 4-tile mini-KPI strip. */}
          <Section title="Workload">
            <AgentMetricsGrid
              agentId={agent.id}
              lens={dateLens}
              orgIds={orgId ? [orgId] : agent.org_ids || []}
              onPillClick={handleMetricsClick}
            />
          </Section>

          {/* 3. Inbox snapshot — NOT lens-filtered per spec.
              Each row routes to CoPilot for that opp. */}
          <Section title={`Inbox snapshot (${oldestOpen.length}/10 oldest open)`}>
            {oldestOpen.length === 0 ? (
              <div className="text-xs text-slate-400">No open opportunities.</div>
            ) : (
              <ul className="divide-y divide-slate-100 ring-1 ring-slate-200 rounded-md overflow-hidden">
                {oldestOpen.map((o) => (
                  <li
                    key={o.id}
                    className="group flex items-center gap-3 px-3 py-2 bg-white hover:bg-slate-50 cursor-pointer"
                    onClick={() => handleOppClick(o.id)}
                  >
                    <span
                      className={
                        'inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ring-1 ring-inset ' +
                        TYPE_BADGE[o.type]
                      }
                    >
                      {TYPE_LABELS[o.type]}
                    </span>
                    <span className="text-sm text-slate-800 truncate flex-1">
                      {o.contact_name || o.contact_id}
                    </span>
                    <span
                      className={
                        'inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ring-1 ring-inset ' +
                        statusPillClasses(o.type, o.status)
                      }
                    >
                      {o.status}
                    </span>
                    <span className="text-xs text-slate-500 whitespace-nowrap">
                      {ageLabel(ageDays(o.created_at))}
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-700" />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* 4. Conversion by type */}
          <Section title="Conversion by type">
            <div className="space-y-2">
              {conversionByType.map((row) => (
                <ConversionBar key={row.type} row={row} />
              ))}
            </div>
          </Section>

          {/* 5. Recent activity */}
          <Section icon={ActivityIcon} title={`Recent activity (${recentActivity.length})`}>
            {recentActivity.length === 0 ? (
              <div className="text-xs text-slate-400 italic">
                Activity attribution lands when actor_id is on activity records.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {recentActivity.map((a) => <ActivityRow key={a.id} activity={a} />)}
              </ul>
            )}
          </Section>

          {/* 6. Coaching notes — manager-only */}
          {canCoach && (
            <Section icon={StickyNote} title={`Coaching notes (${coachingNotes.length})`}>
              <div className="bg-emerald-50 ring-1 ring-emerald-200 rounded-md p-3 mb-3">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Add a coaching note (manager-only — agents never see these)…"
                  rows={2}
                  className="w-full text-sm bg-white border border-emerald-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-emerald-800">
                    Manager-only. Stored locally for this demo. Phase 2: DB + manage_agents ACL.
                  </span>
                  <button
                    onClick={addCoachingNote}
                    disabled={!draft.trim()}
                    className="text-xs font-medium px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white inline-flex items-center gap-1.5"
                  >
                    <Send className="w-3 h-3" />
                    Add
                  </button>
                </div>
              </div>

              {coachingNotes.length === 0 ? (
                <div className="text-xs text-slate-400">No coaching notes yet.</div>
              ) : (
                <ul className="space-y-2">
                  {coachingNotes.map((n) => (
                    <li key={n.id} className="bg-white ring-1 ring-slate-200 rounded-md p-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Pill className="bg-emerald-50 text-emerald-700">Manager</Pill>
                        <span className="text-[11px] font-mono text-slate-500">
                          {n.author_id || 'manager_session'}
                        </span>
                        <span className="ml-auto text-[11px] text-slate-400">
                          {relativeTime(n.created_at)}
                          {n.edited_at && ` · edited ${relativeTime(n.edited_at)}`}
                        </span>
                        <button
                          onClick={() => startEdit(n)}
                          className="text-slate-400 hover:text-slate-700"
                          title="Edit"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => deleteNote(n.id)}
                          className="text-slate-400 hover:text-rose-600"
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      {editingId === n.id ? (
                        <div>
                          <textarea
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            rows={2}
                            className="w-full text-sm bg-white border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                          <div className="flex items-center gap-2 mt-1.5 justify-end">
                            <button
                              onClick={() => { setEditingId(null); setEditDraft(''); }}
                              className="text-[11px] text-slate-500 hover:text-slate-700 px-2 py-1"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={commitEdit}
                              disabled={!editDraft.trim()}
                              className="text-[11px] font-medium px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-slate-800 whitespace-pre-wrap">{n.body}</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {/* 7. Reassign workload — manager-only */}
          {canReassign && (
            <Section title="Reassign workload">
              <div className="bg-slate-50 ring-1 ring-slate-200 rounded-md p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-800">
                    Move opportunities off this agent
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Opens the Assignment screen filtered to this agent's owned opps. Bulk picker lands in Wave 28e.
                  </div>
                </div>
                <button
                  onClick={handleReassign}
                  className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white"
                >
                  <Users className="w-3.5 h-3.5" />
                  Reassign
                </button>
              </div>
            </Section>
          )}
        </div>
      </div>
    </section>
  );
}

function Header({ title, subtitle, onBack }) {
  return (
    <div className="px-4 py-2 border-b border-slate-200 flex items-center gap-3 bg-white">
      <button
        onClick={onBack}
        className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-100"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        Back to team
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-slate-900 truncate">{title}</div>
        {subtitle && (
          <div className="text-[11px] font-mono text-slate-500 truncate">{subtitle}</div>
        )}
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, children }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {Icon && <Icon className="w-3.5 h-3.5 text-slate-500" />}
        <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
          {title}
        </div>
      </div>
      {children}
    </div>
  );
}

function Pill({ className = '', children, title }) {
  return (
    <span
      title={title}
      className={
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ' +
        className
      }
    >
      {children}
    </span>
  );
}

function ConversionBar({ row }) {
  const aPct = row.value == null ? 0 : Math.max(0, Math.min(1, row.value));
  const mPct = row.median == null ? 0 : Math.max(0, Math.min(1, row.median));
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="font-medium text-slate-700">{TYPE_LABELS[row.type]}</span>
        <span className="text-slate-500">
          {row.value == null ? '—' : `${(row.value * 100).toFixed(0)}%`}
          <span className="text-slate-300 mx-1">·</span>
          <span className="text-slate-400">org {row.median == null ? '—' : `${(row.median * 100).toFixed(0)}%`}</span>
        </span>
      </div>
      <div className="relative h-2 bg-slate-100 rounded">
        <div
          className="absolute left-0 top-0 h-full bg-emerald-500 rounded"
          style={{ width: `${aPct * 100}%` }}
        />
        {row.median != null && (
          <div
            className="absolute top-[-2px] h-3 w-0.5 bg-slate-700"
            style={{ left: `calc(${mPct * 100}% - 1px)` }}
            title={`Org median ${(mPct * 100).toFixed(0)}%`}
          />
        )}
      </div>
    </div>
  );
}

const ACTIVITY_ICON = {
  call: Phone,
  sms: MessageSquare,
  email: Mail,
  status_change: RotateCcw,
  note: StickyNote,
  agent_action: ArrowRight,
  partner_event: Share2,
};

function ActivityRow({ activity }) {
  const Icon = ACTIVITY_ICON[activity.type] || ActivityIcon;
  return (
    <li className="flex items-start gap-3 px-3 py-2 bg-white ring-1 ring-slate-200 rounded-md">
      <div className="mt-0.5 p-1.5 rounded-md bg-slate-50 text-slate-500">
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-800">{activity.summary_text}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-slate-400">{relativeTime(activity.occurred_at)}</span>
          {activity.contact_id && (
            <span className="text-[11px] font-mono text-slate-400">{activity.contact_id}</span>
          )}
        </div>
      </div>
    </li>
  );
}
