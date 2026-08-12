// Agent chrome — top bar + sticky Save and Send footer.
//
// Top bar shows:
//   * Status pill (current opportunity status, color from canon crm_stage
//     when available)
//   * "Force opportunity status" select (canon vsc display names)
//   * Persona switcher (canon personas — drives gating for the API
//     responses button)
//   * "View API Responses" button (super_admin only)
//
// Footer is a sticky Save and Send button. Visible on every wizard step
// EXCEPT the initial CaptureLinkForm gate (caller controls visibility
// via the showSaveAndSend prop). Save and Send re-syntheszies the
// consumer link with a deep-link to the current step and re-mocks the
// Twilio + Mandrill send.
//
// Notes on canon coupling:
//   * VSC status taxonomy in canon/ghl-status.json has no `machine_id`
//     field per status (only insurance does). We render display names
//     verbatim. When canon adds machine_ids for VSC, swap the selected
//     value for the code while keeping the display name as the label.
//   * crm_stage → color mapping is local here. mission-control's
//     AgentInbox does the same lookup; we should consolidate into
//     src/lib/canon.js when a second consumer materializes.
import { Eye, Save, Send, AlertTriangle, ShieldAlert, CheckCircle2, Settings } from 'lucide-react';
import vscCanon from '../../constants/canon/ghl-status.json';
import personasCanon from '../../constants/canon/personas.json';
import { track } from 'blinker-platform/telemetry';

const VSC_STATUS_NAMES = Object.keys(vscCanon?.vsc?.statuses || {});
const VSC_STATUS_META = vscCanon?.vsc?.statuses || {};
const PERSONA_LIST = Object.entries(personasCanon?.personas || {})
  .filter(([key]) => key !== 'consumer') // consumer not a mission-control persona
  .map(([key, meta]) => ({ key, label: meta.label }));

function pillClasses(status) {
  const stage = VSC_STATUS_META[status]?.crm_stage;
  if (!stage) return 'bg-slate-100 text-slate-700 border-slate-200';
  if (/won|payment success|paid in full|active/i.test(stage)) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (/lost|cancelled/i.test(stage)) return 'bg-rose-100 text-rose-700 border-rose-200';
  if (/working|quoted|contacted|new lead/i.test(stage)) return 'bg-amber-100 text-amber-700 border-amber-200';
  if (/pending/i.test(stage)) return 'bg-blue-100 text-blue-700 border-blue-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

export function AgentTopBar({
  opportunity,
  setOpportunityStatus,
  persona,
  setPersona,
  personaLocked = false,
  onOpenApiResponses,
  // Wave 13-fu-1 — optional override for the FORCE STATUS picker list.
  // When mission-control's SuperHome StatusMappingEditor publishes a
  // per-org subset (via `mc.status-mapping.v1`), CoPilotPane threads it
  // through AgentView → AgentTopBar so this picker only offers statuses
  // the active org has mapped. Unset or empty → falls back to the canon
  // VSC display-name list (today's behavior, fully backwards compatible).
  availableStatuses,
}) {
  const status = opportunity?.status || 'Empty';
  const canViewApi = persona === 'super_admin';
  const statusOptions =
    Array.isArray(availableStatuses) && availableStatuses.length > 0
      ? availableStatuses
      : VSC_STATUS_NAMES;

  function onForceStatus(e) {
    const next = e.target.value;
    if (!next || next === status) return;
    track('protection.agent.status_overridden', { from: status, to: next, opportunity_id: opportunity?.id });
    setOpportunityStatus(next);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3 mb-4 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">Status</span>
        <span className={'text-xs font-semibold px-2 py-0.5 rounded border ' + pillClasses(status)}>
          {status}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Settings className="w-3 h-3 text-slate-400" />
        <label className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">Force status</label>
        <select
          value={status}
          onChange={onForceStatus}
          className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:border-blue-500"
        >
          {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {!personaLocked && (
        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">Persona</label>
          <select
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:border-blue-500"
          >
            {PERSONA_LIST.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        {canViewApi ? (
          <button
            onClick={onOpenApiResponses}
            className="text-xs font-semibold px-3 py-1.5 rounded-md border border-slate-200 hover:border-blue-500 hover:text-blue-700 text-slate-700 flex items-center gap-1"
          >
            <Eye className="w-3 h-3" /> View API responses
          </button>
        ) : (
          <span className="text-[11px] text-slate-400 flex items-center gap-1" title="Super admin only">
            <ShieldAlert className="w-3 h-3" /> API responses (super only)
          </span>
        )}
      </div>
    </div>
  );
}

// Sticky footer — Save in-flight opportunity + (re-)send the consumer
// link with a deep-link to the current step. Phase 1 is mock: we log a
// Twilio/Mandrill payload to console and emit a posthog event. The deep
// link uses ?step=<stepKey> as a hint; the customer view doesn't honor
// it yet (would require seeded form state from a backend), so noting it
// as a TODO.
export function SaveAndSendFooter({ opportunity, currentStepKey, sentSummary, onSent }) {
  function onClick() {
    if (!opportunity?.captureLink?.url) return;
    const deepLink = `${opportunity.captureLink.url}&step=${currentStepKey}`;
    const twilioPayload = {
      to: opportunity?.contact?.phone || null,
      body: `Pick up where we left off: ${deepLink}`,
    };
    const mandrillPayload = {
      to: opportunity?.contact?.email || null,
      subject: 'Continue your protection plan quote',
      bodyHtml: `<a href="${deepLink}">Tap here to continue</a>`,
    };
    // eslint-disable-next-line no-console
    console.log('[twilio:mock]', twilioPayload);
    // eslint-disable-next-line no-console
    console.log('[mandrill:mock]', mandrillPayload);
    track('protection.agent.save_and_send', {
      opportunity_id: opportunity?.id,
      from_step: currentStepKey,
      deep_link: deepLink,
    });
    onSent?.({ at: new Date().toISOString(), step: currentStepKey });
  }

  const disabled = !opportunity?.captureLink?.url;

  return (
    <div className="mt-4 bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Save className="w-4 h-4 text-slate-400" />
        <span>
          Save the in-flight opportunity and re-send the consumer link with a deep-link to{' '}
          <span className="font-semibold text-slate-700">{currentStepKey}</span>.
        </span>
        {sentSummary && (
          <span className="ml-2 text-emerald-600 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Sent at {new Date(sentSummary.at).toTimeString().slice(0, 8)}
          </span>
        )}
      </div>
      <button
        onClick={onClick}
        disabled={disabled}
        title={disabled ? 'Generate and send the capture link first.' : undefined}
        className={
          'text-xs font-semibold px-4 py-2 rounded-md flex items-center gap-1.5 ' +
          (disabled
            ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-700 text-white')
        }
      >
        <Send className="w-3 h-3" />
        Save and Send
      </button>
    </div>
  );
}

// Surfaces the canon-coupling caveat so anyone reading the agent shell
// in dev sees it without having to read source. Rendered inside AgentView
// alongside the chrome.
export function CanonNotice() {
  return (
    <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-3 flex items-start gap-2">
      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
      <div>
        <span className="font-semibold">Canon TODO:</span> VSC status taxonomy has no <code>machine_id</code> field
        yet (only insurance does). The dropdown above uses display names verbatim — swap for codes when canon ships
        the VSC machine-id pass.
      </div>
    </div>
  );
}
