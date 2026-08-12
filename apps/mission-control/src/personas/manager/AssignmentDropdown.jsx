import { AgentPicker } from './AgentPicker.jsx';

// Wave 28e / Wave 29a — inline single-opp variant. Thin wrapper around
// AgentPicker (placement='inline') that lets every row in Assignment.jsx
// render a single dropdown without re-resolving suggestion / grouping /
// telemetry logic.
//
// Props:
//   opp:            Opportunity record (drives scoring)
//   eligibleAgents: Agent[] — pre-filtered by caller's accessible orgs
//   sourceOrgPolicy: per-org policy block (see canon org-registry)
//   contacts:       map (used for source-org resolution)
//   onAssign(agentId, info) — info per AgentPicker contract
//   triggerLabel:   text on the trigger button (default 'Assign')

export function AssignmentDropdown({
  opp,
  eligibleAgents,
  sourceOrgPolicy,
  contacts,
  onAssign,
  triggerLabel = 'Assign',
  surface = 'assignment_screen',
}) {
  return (
    <AgentPicker
      placement="inline"
      surface={surface}
      selectedOpps={opp ? [opp] : []}
      eligibleAgents={eligibleAgents}
      sourceOrgPolicy={sourceOrgPolicy}
      contacts={contacts}
      onAssign={onAssign}
      triggerLabel={triggerLabel}
    />
  );
}

export default AssignmentDropdown;
