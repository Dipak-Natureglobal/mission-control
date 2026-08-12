// Agent chrome — top bar + sticky Save and Send footer.
//
// Mirrors protection-portal/src/views/agent/AgentChrome.jsx with the
// REFI status taxonomy substituted for VSC. Top bar shows:
//   * Status pill — colored from canon refi crm_stage when available;
//     falls back to a regex-bucketed lookup because canon's refi block
//     contains "** TBD **" rows whose crm_stage is unset.
//   * "Force opportunity status" select — sourced from canon
//     ghl-status.json `refi.statuses_summary` (display strings only —
//     the refi block has no per-status `machine_id` field yet, see
//     CanonNotice).
//   * Persona switcher (gated by !personaLocked) — drives gating for
//     the "View API Responses" button.
//   * "View API Responses" button — super_admin only.
//
// The sticky Save and Send footer mocks Twilio + Mandrill payloads with
// a deep-link to the current refi step (?step=<stepKey>) and emits
// refi.agent.save_and_send.
//
// Canon coupling note (also surfaced in CanonNotice for in-shell
// visibility): canon/ghl-status.json `refi` block has no `statuses` map
// — only `statuses_summary` (strings) — and no machine_ids. We render
// display names verbatim and bucket crm_stage colors via the regex
// fallback below. When canon adds a per-status object map for refi,
// swap the rendered string for `{ machine_id, crm_stage }` lookup.
import type { FC } from 'react';
import { Eye, Save, Send, AlertTriangle, ShieldAlert, CheckCircle2, Settings } from 'lucide-react';
import vscCanon from '../../constants/canon/ghl-status.json';
import personasCanon from '../../constants/canon/personas.json';
import { track } from 'blinker-platform/telemetry';
import type { Opportunity, Persona, SentSummary } from '../../types';

// Refi status display names — pulled from canon/ghl-status.json `refi.statuses_summary`.
// TODO: when canon adds a `refi.statuses` object map (with machine_id +
// crm_stage per status, like the insurance block), replace this array with
// Object.keys(refi.statuses) and surface crm_stage directly instead of the
// regex bucketing in pillClasses().
const REFI_STATUS_NAMES = vscCanon?.refi?.statuses_summary || [];

const PERSONA_LIST = Object.entries(personasCanon?.personas || {})
  .filter(([key]) => key !== 'consumer') // consumer not a mission-control persona
  .map(([key, meta]) => ({ key, label: meta.label }));

// Refi crm_stage color buckets. Canon doesn't expose stage-per-status for
// refi yet, so we regex-match on the status NAME itself (the same string
// the agent sees in the dropdown). Phrases tuned to the refi taxonomy
// surfaced in canon: Funded → won, Declined/Not Interested → lost,
// Working/Working - * / Offers Returned / Offer Selected / Applied →
// in-progress, Pending Funding → pending, Started/New Lead → neutral.
function pillClasses(status: string | null | undefined): string {
  if (!status) return 'bg-slate-100 text-slate-700 border-slate-200';
  if (/funded/i.test(status)) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (/declined|not interested/i.test(status)) return 'bg-rose-100 text-rose-700 border-rose-200';
  if (/working|offers returned|offer selected|applied|prequalification/i.test(status)) {
    return 'bg-amber-100 text-amber-700 border-amber-200';
  }
  if (/pending/i.test(status)) return 'bg-blue-100 text-blue-700 border-blue-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

interface AgentTopBarProps {
  opportunity: Opportunity | null;
  setOpportunityStatus: (status: string) => void;
  persona: Persona;
  setPersona: (p: Persona) => void;
  personaLocked: boolean;
  onOpenApiResponses: () => void;
}

export const AgentTopBar: FC<AgentTopBarProps> = ({
  opportunity,
  setOpportunityStatus,
  persona,
  setPersona,
  personaLocked,
  onOpenApiResponses,
}) => {
  const status = opportunity?.status || 'Empty';
  const canViewApi = persona === 'super_admin';

  function onForceStatus(e: React.ChangeEvent<HTMLSelectElement>): void {
    const next = e.target.value;
    if (!next || next === status) return;
    track('refi.agent.status_overridden', {
      from: status,
      to: next,
      opportunity_id: opportunity?.id,
    });
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
          value={REFI_STATUS_NAMES.includes(status) ? status : ''}
          onChange={onForceStatus}
          className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white focus:outline-none focus:border-blue-500"
        >
          <option value="" disabled>{status}</option>
          {REFI_STATUS_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {!personaLocked && (
        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">Persona</label>
          <select
            value={persona}
            onChange={(e) => setPersona(e.target.value as Persona)}
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
};

// Sticky Save and Send footer — visible on every wizard step (caller
// controls visibility — AgentView only mounts this once the capture link
// exists). Synthesizes a deep-link URL with ?step=<currentStepKey> so the
// agent can hand off mid-flow; mocks Twilio + Mandrill console payloads.
interface SaveAndSendFooterProps {
  opportunity: Opportunity | null;
  currentStepKey: string;
  sentSummary?: SentSummary | null;
  onSent?: (summary: SentSummary) => void;
}

export const SaveAndSendFooter: FC<SaveAndSendFooterProps> = ({ opportunity, currentStepKey, sentSummary, onSent }) => {
  function onClick(): void {
    if (!opportunity?.captureLink?.url) return;
    const deepLink = `${opportunity.captureLink.url}&step=${currentStepKey}`;
    const twilioPayload = {
      to: opportunity?.contact?.phone || null,
      body: `Pick up where we left off on your refi: ${deepLink}`,
    };
    const mandrillPayload = {
      to: opportunity?.contact?.email || null,
      subject: 'Continue your auto refinance application',
      bodyHtml: `<a href="${deepLink}">Tap here to continue</a>`,
    };
     
    console.log('[twilio:mock]', twilioPayload);
     
    console.log('[mandrill:mock]', mandrillPayload);
    track('refi.agent.save_and_send', {
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
};

// Surfaces the canon-coupling caveat so anyone reading the agent shell
// in dev sees it without having to read source. Rendered inside
// AgentView alongside the chrome.
export const CanonNotice: FC = () => {
  return (
    <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-3 flex items-start gap-2">
      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
      <div>
        <span className="font-semibold">Canon TODO:</span> The <code>refi</code> block in canon/ghl-status.json
        exposes only <code>statuses_summary</code> (strings) — no per-status <code>machine_id</code> or{' '}
        <code>crm_stage</code> map yet (insurance has it, refi doesn't). The Force-status dropdown above renders
        display names verbatim, and pill colors are bucketed by name regex. Swap to canonical lookup when canon
        ships the refi machine-id pass.
      </div>
    </div>
  );
};
