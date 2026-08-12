import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock, Inbox, UserCheck, X } from 'lucide-react';
import { blinkerApi } from 'blinker-platform/api';
import { track } from 'blinker-platform/telemetry';
import { useActiveOrg, MY_ID } from '../../shell/active-org-context.jsx';
import { useSessionData } from '../../lib/session-data.js';
import { AssignmentDropdown } from './AssignmentDropdown.jsx';
import { BulkReassignBar } from './BulkReassignBar.jsx';
import { reduceSourceOrgPolicy } from './AgentPicker.jsx';
import {
  TYPE_LABELS,
  TYPE_BADGE,
  ageDays,
  statusPillClasses,
} from '../../lib/canon.js';
import personasCanon from '../../constants/canon/personas.json';
import orgRegistry from '../../constants/canon/org-registry.json';

// Wave 28e — Assignment screen.
//
// Two-column routing workbench (ADR 19 §5.4):
//   Left  = queues (Unassigned, Stuck > 7d, API failure)
//   Right = selected queue's contents with inline AssignmentDropdown +
//           bulk-select + sticky BulkReassignBar
//
// Reused substrate:
//   - scoreAgents (via AssignmentDropdown) — packages/utils
//   - BulkReassignBar — sibling 28d component, mounted unmodified
//   - useActiveOrg() — single source of truth for org scope (single + allOrgs)
//
// Cross-org assignment:
//   When the manager picks a destination agent whose org_ids[] doesn't
//   include the source opp's contact.org_id, we surface a confirmation
//   modal before persisting + emit `cross_org: true` on the telemetry.
//   The cascade goes through blinkerApi.contacts.crossOrgMove which
//   re-stamps the contact's org_id (Phase 1) and returns a magnitude
//   summary for the assigned event.
//
// Deep-link: `?from_agent=<id>` from AgentProfile → both queues
// pre-filter to that agent's owned opps + a clear-filter banner appears.

const STALE_MS = 7 * 24 * 3600 * 1000;

const LOSING_STATUSES = new Set([
  'Lost', 'Abandoned', 'Cancelled', 'Cold', 'Disqualified', 'Declined',
  'Not Interested', 'Payment Failed', 'Working - Rejected',
]);
const WINNING_STATUSES = new Set([
  'Won', 'Booked', 'Agreement Signed', 'Product Agreement Signed',
  'Payment Agreement Signed', 'Remitted', 'Active', 'Paid in Full',
  'Funded', 'Policy Written',
]);

function presetHasBadge(presetId, badge) {
  const personas = personasCanon.personas || {};
  for (const persona of Object.values(personas)) {
    const preset = (persona.presets || []).find((p) => p.id === presetId);
    if (preset) return (preset.badges || []).includes(badge);
  }
  return false;
}

function orgNameOf(orgId) {
  const orgs = orgRegistry.orgs || [];
  return orgs.find((o) => o.id === orgId)?.name || `Org ${orgId}`;
}

export function Assignment() {
  const { orgId, orgName, allOrgs, accessibleOrgIds } = useActiveOrg();
  // Wave 31b-fu3 — opt out of writer registration; App.jsx is the host.
  // Assignment is a read-only consumer (no opportunitiesApi.create() calls);
  // registering as host here would shadow App.jsx's writer whenever the
  // manager switches to the Assignment tab.
  const session = useSessionData({ registerAsHost: false });
  const scopeLabel = allOrgs ? 'All my orgs' : orgName;

  // Identity → preset → badge gating.
  const me = useMemo(() => blinkerApi.agents.get(MY_ID), []);
  const myPresetId = me?.preset_id || 'manager_standard';
  const canViewApiFailures = presetHasBadge(myPresetId, 'view_api_responses');

  // Deep-link: ?from_agent=<id> from AgentProfile's "Reassign workload".
  const [fromAgentId, setFromAgentId] = useState(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get('from_agent');
    if (id) setFromAgentId(id);
  }, []);
  const fromAgent = useMemo(
    () => (fromAgentId ? blinkerApi.agents.get(fromAgentId) : null),
    [fromAgentId],
  );
  function clearFromAgent() {
    setFromAgentId(null);
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        params.delete('from_agent');
        const search = params.toString();
        const next =
          window.location.pathname +
          (search ? `?${search}` : '') +
          (window.location.hash || '');
        window.history.replaceState({}, '', next);
      } catch {
        // ignore
      }
    }
  }

  // Build the opportunity pool from session.opportunities, scoped by org.
  const allTeamOpps = session?.opportunities || [];
  const contacts = session?.contacts || {};

  // Resolve contact→org_id from session contacts (so cross-org cascade,
  // when applied, immediately re-buckets opps).
  const contactsOrgMap = useMemo(() => {
    const m = new Map();
    for (const c of Object.values(contacts)) {
      if (c && c.id && typeof c.org_id === 'number') m.set(c.id, c.org_id);
    }
    return m;
  }, [contacts]);

  // Scope-filter opps. allOrgs → union across accessibleOrgIds. Single-org
  // → that orgId. The session contacts may be a superset of the canonical
  // map — that's fine, we want session truth for live mutations.
  const scopedOpps = useMemo(() => {
    if (allOrgs) {
      if (!Array.isArray(accessibleOrgIds) || accessibleOrgIds.length === 0) {
        return [];
      }
      const set = new Set(accessibleOrgIds);
      return allTeamOpps.filter((o) => set.has(contactsOrgMap.get(o.contact_id)));
    }
    if (orgId == null) return [];
    return allTeamOpps.filter((o) => contactsOrgMap.get(o.contact_id) === orgId);
  }, [allTeamOpps, contactsOrgMap, allOrgs, accessibleOrgIds, orgId]);

  // Optional from_agent filter — applied AFTER org scoping so a manager
  // drilling in from AgentProfile sees only that agent's pile inside the
  // active scope.
  const filteredOpps = useMemo(() => {
    if (!fromAgent) return scopedOpps;
    return scopedOpps.filter(
      (o) => o.owner === fromAgent.name || o.owner_id === fromAgent.id,
    );
  }, [scopedOpps, fromAgent]);

  // Queue projections.
  const unassignedOpps = useMemo(
    () =>
      filteredOpps.filter((o) => {
        const noOwner = o.owner == null || o.owner === '';
        const noOwnerId = o.owner_id == null || o.owner_id === '';
        return noOwner && noOwnerId;
      }),
    [filteredOpps],
  );
  const stuckOpps = useMemo(() => {
    const now = Date.now();
    return filteredOpps.filter((o) => {
      if (WINNING_STATUSES.has(o.status)) return false;
      if (LOSING_STATUSES.has(o.status)) return false;
      const t = Date.parse(o.updated_at || '');
      return Number.isFinite(t) && now - t > STALE_MS;
    });
  }, [filteredOpps]);

  // Active queue. Default = 'unassigned'. The from_agent deep-link keeps
  // 'unassigned' as the entry queue but the manager can flip to 'stuck'.
  const [activeQueue, setActiveQueue] = useState('unassigned');
  const queues = useMemo(
    () => [
      {
        key: 'unassigned',
        label: 'Unassigned',
        icon: Inbox,
        rows: unassignedOpps,
      },
      {
        key: 'stuck',
        label: 'Stuck > 7d',
        icon: Clock,
        rows: stuckOpps,
      },
      // API failure surfaced only when the manager carries view_api_responses.
      ...(canViewApiFailures
        ? [
            {
              key: 'api_failure',
              label: 'API failure',
              icon: AlertTriangle,
              rows: [],
              placeholder: 'Coming soon — log not yet wired',
            },
          ]
        : []),
    ],
    [unassignedOpps, stuckOpps, canViewApiFailures],
  );
  const activeQueueObj = useMemo(
    () => queues.find((q) => q.key === activeQueue) || queues[0],
    [queues, activeQueue],
  );

  // Eligible agents — union across the manager's accessible orgs. The
  // AgentPicker receives the SAME pool regardless of single-vs-all org
  // mode; the picker itself decides per-source-org whether cross-org rows
  // surface (based on the source org's cross_org_assignment.enabled).
  //
  // Root cause of the W28e empty "Assign to agent…" bulk dropdown:
  // BulkReassignBar's caller (this screen) passed the same pool the inline
  // dropdown used, but BulkReassignBar pre-W29a invoked scoreAgentsForOpps
  // BEFORE the user opened the dropdown — that path is fine. The actual
  // regression was that ManagerInbox's `eligibleAgentsForBulk` memo guarded
  // on `if (!pendingReassign) return [];` then filtered by orgId, which
  // returned [] for any opp originating outside the active org (single-org
  // mode). Centralising via AgentPicker + accessible-orgs union + the new
  // sourceOrgPolicy reduction removes the per-surface re-derivation.
  const eligibleAgents = useMemo(() => {
    const pool = blinkerApi.agents.list().filter((a) => a.persona === 'agent');
    if (!Array.isArray(accessibleOrgIds) || accessibleOrgIds.length === 0) {
      return pool;
    }
    const set = new Set(accessibleOrgIds);
    return pool.filter(
      (a) => Array.isArray(a.org_ids) && a.org_ids.some((id) => set.has(id)),
    );
  }, [accessibleOrgIds]);

  useEffect(() => {
    track('mission_control.assignment.viewed', {
      scope: allOrgs ? 'all_orgs' : 'single_org',
      from_agent_id: fromAgentId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Selection state for bulk reassign — keyed to the active queue so
  // switching queues resets the picker (the previous selection is no
  // longer in the rendered list).
  const [selectedOppIds, setSelectedOppIds] = useState([]);
  useEffect(() => {
    setSelectedOppIds([]);
  }, [activeQueue]);

  function toggleSelect(oppId) {
    setSelectedOppIds((prev) =>
      prev.includes(oppId) ? prev.filter((x) => x !== oppId) : [...prev, oppId],
    );
  }
  function toggleSelectAll() {
    const all = (activeQueueObj?.rows || []).map((o) => o.id);
    if (selectedOppIds.length === all.length) {
      setSelectedOppIds([]);
    } else {
      setSelectedOppIds(all);
    }
  }

  // Cross-org confirmation state.
  const [pendingCrossOrg, setPendingCrossOrg] = useState(null);
  // { opp, agent, wasSuggested, fromOrgId, toOrgId, mode, policy }

  function persistSameOrg({ opp, agent }) {
    if (session?.updateOpportunity) {
      session.updateOpportunity(opp.id, {
        owner: agent.name || null,
        owner_id: agent.id,
      });
    }
  }

  function persistCrossOrg({ opp, agent, mode, policy }) {
    const fromOrgId = contactsOrgMap.get(opp.contact_id);
    const toOrgId = Array.isArray(agent.org_ids) ? agent.org_ids[0] : null;
    if (toOrgId == null) return null;
    if (session?.updateOpportunity) {
      session.updateOpportunity(opp.id, {
        owner: agent.name || null,
        owner_id: agent.id,
      });
    }
    const helper = mode === 'move'
      ? blinkerApi.contacts.crossOrgMove
      : blinkerApi.contacts.crossOrgCopy;
    return helper(opp.contact_id, fromOrgId, toOrgId, { session, policy });
  }

  function handleAssignSingle(opp, agentId, info) {
    const agent = blinkerApi.agents.get(agentId);
    if (!agent) return;
    if (info.isCrossOrg) {
      setPendingCrossOrg({
        opp,
        agent,
        wasSuggested: info.wasSuggested,
        fromOrgId: info.sourceOrgId,
        toOrgId: info.destOrgId ?? (Array.isArray(agent.org_ids) ? agent.org_ids[0] : null),
        mode: info.mode,
        policy: reduceSourceOrgPolicy([opp], contacts),
      });
      return;
    }
    persistSameOrg({ opp, agent });
    // info-level telemetry already emitted by AgentPicker; emit the
    // screen-scoped event so existing dashboards continue receiving it.
    track('mission_control.assignment.assigned', {
      opp_id: opp.id,
      agent_id: agent.id,
      was_suggested: !!info.wasSuggested,
      is_cross_org: false,
      source: 'assignment_screen',
      mode: 'same-org',
      queue: activeQueue,
      from_agent_id: fromAgentId,
    });
  }

  function confirmCrossOrg() {
    if (!pendingCrossOrg) return;
    const { opp, agent, wasSuggested, mode, policy } = pendingCrossOrg;
    const cascade = persistCrossOrg({ opp, agent, mode, policy });
    track('mission_control.assignment.assigned', {
      opp_id: opp.id,
      agent_id: agent.id,
      was_suggested: !!wasSuggested,
      is_cross_org: true,
      source: 'assignment_screen',
      mode,
      queue: activeQueue,
      from_agent_id: fromAgentId,
      cascade_moved_opps: cascade?.moved_opps ?? cascade?.copied_opps ?? null,
      readonly_applied: cascade?.readonly_applied ?? null,
    });
    setPendingCrossOrg(null);
  }

  // Bulk reassign — opens the BulkReassignBar; selection sticks until the
  // bar dispatches confirmBulkAssign or the user dismisses. Bulk path is
  // best-effort cross-org-aware: when the destination agent doesn't carry
  // the source opp's org_id, the per-opp source policy drives copy-vs-move
  // (no per-opp modal for bulk; the manager owns the decision when they
  // picked the agent).
  function confirmBulkAssign(agentId, info) {
    const agent = blinkerApi.agents.get(agentId);
    if (!agent) {
      setSelectedOppIds([]);
      return;
    }
    const destOrgIds = Array.isArray(agent.org_ids) ? agent.org_ids : [];
    const cascadeIds = [];
    for (const oppId of selectedOppIds) {
      const opp = filteredOpps.find((o) => o.id === oppId);
      if (!opp) continue;
      const sourceOrgId = contactsOrgMap.get(opp.contact_id);
      const isCrossOrg =
        sourceOrgId != null && !destOrgIds.includes(sourceOrgId);
      if (isCrossOrg) {
        const policy = reduceSourceOrgPolicy([opp], contacts);
        persistCrossOrg({ opp, agent, mode: info.mode, policy });
        cascadeIds.push(opp.id);
      } else {
        persistSameOrg({ opp, agent });
      }
    }
    track('mission_control.assignment.bulk_committed', {
      opp_ids: selectedOppIds,
      agent_id: agentId,
      was_suggested: !!info.wasSuggested,
      cross_org_count: cascadeIds.length,
      mode: info.mode,
      source: 'assignment_screen',
      queue: activeQueue,
    });
    setSelectedOppIds([]);
  }

  const selectedOpps = useMemo(
    () => filteredOpps.filter((o) => selectedOppIds.includes(o.id)),
    [filteredOpps, selectedOppIds],
  );

  // Reduce policy across the active selection (bulk bar) — strictest wins.
  const bulkSourceOrgPolicy = useMemo(
    () => reduceSourceOrgPolicy(selectedOpps, contacts),
    [selectedOpps, contacts],
  );

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-6xl mx-auto p-8">
        <div className="flex items-center gap-2 text-emerald-600 mb-2">
          <UserCheck className="w-4 h-4" />
          <span className="text-xs uppercase tracking-wide font-semibold">Manager · Assignment</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 mb-1">
          Assignment{scopeLabel ? ` · ${scopeLabel}` : ''}
        </h1>
        <p className="text-sm text-slate-500 mb-4">
          Routing queues + workload-aware suggested-agent dropdown.
        </p>

        {fromAgent && (
          <div className="mb-4 flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-amber-50 ring-1 ring-inset ring-amber-200 text-xs text-amber-800">
            <span>
              Showing opportunities currently assigned to{' '}
              <span className="font-semibold">{fromAgent.name}</span>
            </span>
            <button
              type="button"
              onClick={clearFromAgent}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-amber-100"
            >
              <X className="w-3 h-3" />
              Clear filter
            </button>
          </div>
        )}

        <div className="grid grid-cols-12 gap-4">
          <QueuesColumn
            queues={queues}
            activeQueue={activeQueue}
            onSelect={(k) => {
              track('mission_control.assignment.queue_selected', { queue: k });
              setActiveQueue(k);
            }}
          />
          <div className="col-span-8">
            <QueueContents
              queue={activeQueueObj}
              eligibleAgents={eligibleAgents}
              selectedOppIds={selectedOppIds}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              onAssign={handleAssignSingle}
              contacts={contacts}
            />
          </div>
        </div>
      </div>

      {selectedOpps.length > 0 && (
        <BulkReassignBar
          selectedOppIds={selectedOppIds}
          selectedOpps={selectedOpps}
          eligibleAgents={eligibleAgents}
          sourceOrgPolicy={bulkSourceOrgPolicy}
          contacts={contacts}
          onAssign={confirmBulkAssign}
          onDismiss={() => setSelectedOppIds([])}
          surface="bulk_bar"
        />
      )}

      {pendingCrossOrg && (
        <CrossOrgConfirmModal
          opp={pendingCrossOrg.opp}
          agent={pendingCrossOrg.agent}
          fromOrgId={pendingCrossOrg.fromOrgId}
          toOrgId={pendingCrossOrg.toOrgId}
          mode={pendingCrossOrg.mode}
          policy={pendingCrossOrg.policy}
          onConfirm={confirmCrossOrg}
          onCancel={() => setPendingCrossOrg(null)}
        />
      )}
    </div>
  );
}

// ── Left column: queues ────────────────────────────────────────────
function QueuesColumn({ queues, activeQueue, onSelect }) {
  return (
    <div className="col-span-4 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 text-xs uppercase tracking-wide font-semibold text-slate-500">
        Queues
      </div>
      <ul>
        {queues.map((q) => {
          const Icon = q.icon;
          const active = q.key === activeQueue;
          return (
            <li key={q.key}>
              <button
                type="button"
                onClick={() => onSelect(q.key)}
                className={
                  'w-full px-4 py-3 border-b border-slate-100 last:border-b-0 flex items-center justify-between text-sm text-left hover:bg-slate-50 ' +
                  (active ? 'bg-emerald-50 hover:bg-emerald-50' : '')
                }
              >
                <span className="flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5 text-slate-500" />
                  <span className={active ? 'text-emerald-800 font-semibold' : 'text-slate-700'}>
                    {q.label}
                  </span>
                </span>
                <span className={active ? 'text-emerald-700 font-semibold' : 'text-slate-500'}>
                  {q.placeholder ? '—' : q.rows.length}
                </span>
              </button>
              {q.placeholder && active && (
                <div className="px-4 py-2 text-[11px] text-slate-400 italic border-b border-slate-100">
                  {q.placeholder}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Right column: queue contents ─────────────────────────────────────
function QueueContents({
  queue,
  eligibleAgents,
  selectedOppIds,
  onToggleSelect,
  onToggleSelectAll,
  onAssign,
  contacts,
}) {
  const rows = queue?.rows || [];
  if (queue?.placeholder) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 text-sm text-slate-500">
        <div className="font-semibold text-slate-700 mb-1">{queue.label}</div>
        <div>{queue.placeholder}</div>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-10 flex flex-col items-center justify-center text-sm text-slate-400 gap-2">
        <Inbox className="w-5 h-5" />
        <span>No {queue?.label?.toLowerCase() || ''} opportunities</span>
      </div>
    );
  }
  const allSelected =
    rows.length > 0 && selectedOppIds.length === rows.length;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <span className="text-sm text-slate-700">
          <span className="font-semibold">{rows.length}</span>{' '}
          opportunit{rows.length === 1 ? 'y' : 'ies'}
        </span>
        <label className="text-xs text-slate-500 inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onToggleSelectAll}
          />
          Select all
        </label>
      </div>
      <ul>
        {rows.map((o) => (
          <QueueRow
            key={o.id}
            opp={o}
            checked={selectedOppIds.includes(o.id)}
            onCheck={() => onToggleSelect(o.id)}
            eligibleAgents={eligibleAgents}
            onAssign={onAssign}
            contacts={contacts}
            contact={contacts[o.contact_id]}
          />
        ))}
      </ul>
    </div>
  );
}

function QueueRow({ opp, checked, onCheck, eligibleAgents, onAssign, contacts, contact }) {
  const contactName =
    contact?.name?.preferred ||
    `${contact?.name?.first || ''} ${contact?.name?.last || ''}`.trim() ||
    opp.contact_name ||
    opp.contact_id;
  const age = ageDays(opp.updated_at || opp.created_at);
  const sourceOrgPolicy = reduceSourceOrgPolicy([opp], contacts);
  return (
    <li className="px-4 py-2.5 border-b border-slate-100 last:border-b-0 flex items-center gap-3 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={onCheck}
        className="shrink-0"
      />
      <span
        className={
          'px-1.5 py-0.5 rounded text-[10px] font-medium ring-1 ring-inset shrink-0 ' +
          (TYPE_BADGE[opp.type] || 'bg-slate-50 text-slate-600 ring-slate-200')
        }
      >
        {TYPE_LABELS[opp.type] || opp.type}
      </span>
      <span className="text-slate-800 font-medium truncate w-32">{contactName}</span>
      <span className="text-slate-500 truncate w-40">{opp.vehicle || '—'}</span>
      <span className="text-slate-400 shrink-0">
        {age}d
      </span>
      <span
        className={
          'px-1.5 py-0.5 rounded text-[10px] font-medium ring-1 ring-inset truncate ' +
          statusPillClasses(opp.type, opp.status)
        }
      >
        {opp.status}
      </span>
      <span className="ml-auto shrink-0">
        <AssignmentDropdown
          opp={opp}
          eligibleAgents={eligibleAgents}
          sourceOrgPolicy={sourceOrgPolicy}
          contacts={contacts}
          onAssign={(agentId, info) => onAssign(opp, agentId, info)}
          triggerLabel={opp.owner ? opp.owner : 'Assign'}
        />
      </span>
    </li>
  );
}

// ── Cross-org confirmation modal ────────────────────────────────────
function CrossOrgConfirmModal({ opp, agent, fromOrgId, toOrgId, mode, policy, onConfirm, onCancel }) {
  const fromName = orgNameOf(fromOrgId);
  const toName = orgNameOf(toOrgId);
  const isCopy = mode === 'copy';
  const verb = isCopy ? 'Copy' : 'Move';
  const cta = isCopy ? 'Copy and assign' : 'Move and assign';
  const readonlyNote =
    isCopy &&
    policy &&
    (policy.mark_contact_readonly_on_copy ||
      policy.mark_opportunity_readonly_on_copy);
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-5">
        <div className="flex items-center gap-2 text-amber-600 mb-2">
          <AlertTriangle className="w-4 h-4" />
          <span className="text-xs uppercase tracking-wide font-semibold">
            Cross-org assignment
          </span>
        </div>
        <h2 className="text-base font-semibold text-slate-900 mb-2">
          <span className="font-semibold">{verb}</span> to {toName}?
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed mb-3">
          Assigning <span className="font-semibold">{opp.contact_name || opp.contact_id}</span>'s
          {' '}opportunity to <span className="font-semibold">{agent.name}</span> will{' '}
          {isCopy ? 'copy' : 'move'} the contact (and its related opportunities, activities, and tags) from
          {' '}<span className="font-semibold">{fromName}</span> to{' '}
          <span className="font-semibold">{toName}</span>.
        </p>
        {readonlyNote && (
          <p className="text-xs text-slate-500 leading-relaxed mb-4 italic">
            {fromName} will retain a read-only mirror so the previous owner
            can see the record but cannot continue working it.
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="text-xs px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
          >
            {cta}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Assignment;
