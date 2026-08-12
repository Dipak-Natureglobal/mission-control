import { useState } from 'react';
import { Users, X } from 'lucide-react';
import { AgentPicker } from './AgentPicker.jsx';

// Wave 28d / Wave 29a — fixed bottom strip shown when one or more opps are
// selected for reassignment. Consumed by both ManagerInbox (W28d) and
// Assignment.jsx (W28e). Picker logic + suggestion ranking now lives in
// the shared AgentPicker; the bar is a thin shell around it.
//
// Props:
//   selectedOppIds: string[]
//   selectedOpps:   Opportunity[]  — full records (drives scoring + source-org)
//   eligibleAgents: Agent[]        — pre-filtered by accessible orgs by caller
//   sourceOrgPolicy: per-org policy (see canon org-registry _cross_org_assignment_shape)
//   contacts:       map of contact_id → contact (for source-org resolution)
//   onAssign(agentId, info)        — info = { wasSuggested, isCrossOrg,
//                                     sourceOrgId, destOrgId, mode }
//   onDismiss()                    — close without assigning
//   surface:        telemetry source label (default 'bulk_bar')

export function BulkReassignBar({
  selectedOppIds,
  selectedOpps = [],
  eligibleAgents,
  sourceOrgPolicy,
  contacts,
  onAssign,
  onDismiss,
  surface = 'bulk_bar',
}) {
  const [open, setOpen] = useState(false);

  function handleAssign(agentId, info) {
    if (onAssign) onAssign(agentId, info);
    setOpen(false);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white shadow-[0_-8px_24px_-12px_rgba(15,23,42,0.18)]">
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
        <Users className="w-4 h-4 text-slate-400 shrink-0" />
        <span className="text-xs text-slate-700">
          <span className="font-semibold text-slate-900">{selectedOppIds.length}</span>{' '}
          opportunit{selectedOppIds.length === 1 ? 'y' : 'ies'} selected for reassignment
        </span>
        <div className="relative flex-1 max-w-sm">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="w-full text-xs px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-left flex items-center justify-between"
          >
            <span>Assign to agent…</span>
            <span className="text-slate-400">{open ? '▲' : '▼'}</span>
          </button>
          <AgentPicker
            placement="bulk-bar"
            surface={surface}
            selectedOpps={selectedOpps}
            eligibleAgents={eligibleAgents}
            sourceOrgPolicy={sourceOrgPolicy}
            contacts={contacts}
            onAssign={handleAssign}
            onCancel={() => setOpen(false)}
            open={open}
          />
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-auto text-slate-400 hover:text-slate-700 p-1 rounded inline-flex items-center gap-1 text-xs"
          aria-label="Cancel reassignment"
        >
          <X className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Cancel</span>
        </button>
      </div>
    </div>
  );
}

export default BulkReassignBar;
