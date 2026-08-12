import { useState } from 'react';
import { Users } from 'lucide-react';
import { useActiveOrg } from '../../shell/active-org-context.jsx';
import { AgentRosterTable } from './AgentRosterTable.jsx';
import { AgentProfile } from './AgentProfile.jsx';
import { track } from 'blinker-platform/telemetry';

// ManagerTeam — Wave 28b. Replaces the 28a stub. Two-pane host:
//
//   Left  = AgentRosterTable (full roster, filters, KPIs)
//   Right = AgentProfile     (drill-in) when `right.kind === 'agent_profile'`
//
// Right-pane state plumbing mirrors AgentInbox / AgentContacts — a single
// `right` state machine owned by THIS screen. Sibling Manager screens
// own their own right-state (Home, Inbox, Assignment, Metrics) and the
// shell's NAV_BY_PERSONA selects which screen is mounted. Reassign
// navigates to the Assignment screen via the `onNavigate` prop (Phase 1
// stores no query params — Wave 28e lands the real handoff payload).
export function ManagerTeam({ persona = 'manager', onNavigate, onOpenOppInCoPilot }) {
  const { orgName, allOrgs } = useActiveOrg();
  const scopeLabel = allOrgs ? 'All my orgs' : orgName;

  const [right, setRight] = useState(null); // null | { kind: 'agent_profile', agentId }

  function openAgent(agentId) {
    setRight({ kind: 'agent_profile', agentId });
  }
  function closeRight() {
    setRight(null);
  }
  function handleReassign(agentId) {
    track('mission_control.manager.team.reassign_navigate', { agent_id: agentId });
    // Wave 28e — write `?from_agent=<id>` to the URL search params so the
    // Assignment screen (mounted next) can read it on mount and pre-filter
    // both queues to this agent's owned opps. Use replaceState so the
    // back button still returns the user to wherever they were before
    // opening the agent profile.
    if (typeof window !== 'undefined' && agentId) {
      try {
        const params = new URLSearchParams(window.location.search);
        params.set('from_agent', agentId);
        const next = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
        window.history.replaceState({}, '', next);
      } catch {
        // ignore — Assignment falls back to showing all queues.
      }
    }
    if (onNavigate) onNavigate('assignment');
  }

  if (right?.kind === 'agent_profile') {
    return (
      <AgentProfile
        key={right.agentId}
        agentId={right.agentId}
        persona={persona}
        onClose={closeRight}
        onOpenOppInCoPilot={onOpenOppInCoPilot}
        onReassign={handleReassign}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50">
      <div className="px-6 pt-5 pb-3 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-2 text-emerald-600 mb-1">
          <Users className="w-4 h-4" />
          <span className="text-xs uppercase tracking-wide font-semibold">Manager · Team</span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          Team{scopeLabel ? ` · ${scopeLabel}` : ''}
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Agents roster + drill-in. Click a row to see workload, conversion, recent activity, and coaching notes.
        </p>
      </div>
      <AgentRosterTable onAgentClick={openAgent} />
    </div>
  );
}
