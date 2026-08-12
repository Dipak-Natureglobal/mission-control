// Agent force-status bar — production affordance to override
// `workflow.status` directly from the post-send agent surface.
//
// Replaces some of the dev-only "Simulate X" buttons that previously
// existed only as DEV CONTROLS sidebar buttons (View Quote, View Policy,
// etc.). Those simulators force-advance the workflow status without
// waiting for a partner webhook; this picker exposes the same affordance
// inside the production agent UI for any persona that owns a workflow.
//
// Design notes:
//   * For insurance, the value held in `workflow.status` is a machine_id
//     (e.g. 'capture.completed') — NOT a display label. So the <option>
//     `value` is the machine_id and the visible text is the canon
//     display-name label looked up via getInsuranceStatus.
//   * `availableStatuses` (when set + non-empty) is treated as the
//     authoritative list of machine_ids; falls back to the canon
//     `insurance.statuses` keys → resolved to machine_ids. This mirrors
//     the protection-portal AgentTopBar contract — the embedder
//     (mission-control's CoPilotPane) decides which subset to expose.
//   * Persona gating: only rendered for agent / manager / admin /
//     super_admin. Consumer never sees this. Caller is responsible for
//     not mounting in lean mode (consumer-context embeds).
//   * Source of truth: caller passes `setStatus` which is just a
//     wrapper around `updateWorkflow({ status: nextMachineId })` — keeps
//     the mutation point identical to the existing dev simulators so
//     the LeadStatusTimeline + webhook handler don't need to change.
//
// PostHog: emits `insurance.agent.status_forced { from, to, persona }`
// per selection (no event when the picker re-renders or the value is
// unchanged).
import { Eye, Settings, ShieldAlert } from 'lucide-react';
import canon from '../../constants/canon/ghl-status.json';
import personasJson from '../../constants/canon/personas.json';
import { getInsuranceStatus } from '../../constants/status-map.js';
import { captureEvent } from 'blinker-platform/telemetry';

function hasViewApiPermission(persona) {
  const perms = personasJson?.personas?.[persona]?.permissions || [];
  return perms.includes('view_api_responses');
}

// Canon-derived machine_id list for the insurance workflow. Order is
// canon's display order (Object.values walk → machine_id) — this is the
// agent-facing default ordering when no override is supplied.
const CANON_INSURANCE_MACHINE_IDS = Object.values(
  canon?.insurance?.statuses || {},
).map((s) => s.machine_id);

function labelFor(machineId) {
  const entry = getInsuranceStatus(machineId);
  return entry?.label || machineId;
}

export function AgentForceStatusBar({
  workflow,
  updateWorkflow,
  persona = 'agent',
  availableStatuses,
  // Wave 14-fu — optional trigger for the View API Responses modal.
  // When provided, renders the trigger button on the right side of the
  // bar gated to personas with the canon `view_api_responses`
  // permission (super_admin + admin). Caller (AgentView) owns the
  // modal open/close state and the modal mount itself; this bar only
  // surfaces the affordance.
  onOpenApiResponses,
}) {
  const status = workflow?.status || '';
  const options =
    Array.isArray(availableStatuses) && availableStatuses.length > 0
      ? availableStatuses
      : CANON_INSURANCE_MACHINE_IDS;
  const canViewApi = hasViewApiPermission(persona);

  // If the current status isn't in the option list (e.g. a status the
  // operator's mapping doesn't include yet, or a transient state like
  // not_started / started), surface it as a synthetic option so the
  // <select> has something selected and the agent can switch away.
  const showSynthetic = status && !options.includes(status);

  function onForceStatus(e) {
    const next = e.target.value;
    if (!next || next === status) return;
    captureEvent('insurance.agent.status_forced', {
      from: status || null,
      to: next,
      persona,
      lead_id: workflow?.lead?.leadId || null,
    });
    updateWorkflow({ status: next });
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-2.5 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <Settings className="w-3.5 h-3.5 text-slate-400" />
        <label className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">
          Force status
        </label>
        <select
          value={status}
          onChange={onForceStatus}
          className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:border-blue-500 font-mono"
        >
          {showSynthetic && (
            <option key={status} value={status}>
              {labelFor(status)} ({status})
            </option>
          )}
          {options.map((mid) => (
            <option key={mid} value={mid}>
              {labelFor(mid)} ({mid})
            </option>
          ))}
        </select>
      </div>
      <p className="text-[11px] text-slate-400 leading-snug max-w-sm">
        Production override — advances the workflow without waiting for
        a partner webhook. Drives the same mutation path as the DEV
        simulators.
      </p>

      <div className="ml-auto flex items-center gap-2">
        {onOpenApiResponses && canViewApi && (
          <button
            onClick={onOpenApiResponses}
            className="text-xs font-semibold px-3 py-1.5 rounded-md border border-slate-200 hover:border-blue-500 hover:text-blue-700 text-slate-700 flex items-center gap-1"
          >
            <Eye className="w-3 h-3" /> View API responses
          </button>
        )}
        {onOpenApiResponses && !canViewApi && (
          <span
            className="text-[11px] text-slate-400 flex items-center gap-1"
            title="Requires the `view_api_responses` permission (super_admin / admin)."
          >
            <ShieldAlert className="w-3 h-3" /> API responses (super only)
          </span>
        )}
      </div>
    </div>
  );
}
