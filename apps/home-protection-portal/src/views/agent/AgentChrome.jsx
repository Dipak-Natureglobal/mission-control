// Agent chrome — top bar + the sticky Save and Send footer.
//
// Structural twin of protection-portal/src/views/agent/AgentChrome.jsx, with
// the status taxonomy pointed at canon's `home_protection` block instead of
// `vsc`.
//
// Canon coupling note: like `vsc`, the `home_protection` status block has no
// per-status `machine_id` — only insurance does. So display names are rendered
// verbatim and are also what gets stored. When canon ships machine ids for
// this block, swap the option VALUE for the code and keep the display name as
// the label; nothing else here changes.
import { Eye, Save, Send, ShieldAlert, CheckCircle2, Settings } from 'lucide-react';
import { track } from 'blinker-platform/telemetry';
import statusCanon from '../../constants/canon/ghl-status.json' with { type: 'json' };
import personasCanon from '../../constants/canon/personas.json' with { type: 'json' };

const HP_STATUSES = statusCanon?.home_protection?.statuses || {};
const HP_STATUS_NAMES = Object.keys(HP_STATUSES);

// eslint-disable-next-line react-refresh/only-export-components
export const HP_STATUS = { EMPTY: 'Empty' };

const PERSONA_LIST = Object.entries(personasCanon?.personas || {})
  .filter(([key]) => key !== 'consumer')
  .map(([key, meta]) => ({ key, label: meta.label }));

function pillClasses(status) {
  const stage = HP_STATUSES[status]?.crm_stage;
  if (!stage) return 'bg-slate-100 text-slate-700 border-slate-200';
  if (/won|payment success|paid in full|active/i.test(stage)) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (/lost|cancelled/i.test(stage)) return 'bg-rose-100 text-rose-700 border-rose-200';
  if (/working|quoted|contacted|new lead/i.test(stage)) return 'bg-amber-100 text-amber-700 border-amber-200';
  if (/pending/i.test(stage)) return 'bg-blue-100 text-blue-700 border-blue-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

// Canon tags every home_protection status with an actor (ADR 27) — agent,
// consumer, or system. Surfacing it next to the pill tells the agent at a
// glance whether the ball is in their court or the consumer's.
function actorFor(status) {
  return HP_STATUSES[status]?.actor ?? null;
}

export function AgentTopBar({
  opportunity,
  setOpportunityStatus,
  persona,
  setPersona,
  personaLocked = false,
  onOpenApiResponses,
  // When mission-control publishes a per-org mapped subset, it threads it
  // here and the picker offers only statuses that org has actually mapped.
  // Unset or empty falls back to the full canon list.
  availableStatuses,
}) {
  const status = opportunity?.status || HP_STATUS.EMPTY;
  const canViewApi = persona === 'super_admin';
  const statusOptions =
    Array.isArray(availableStatuses) && availableStatuses.length > 0
      ? availableStatuses
      : HP_STATUS_NAMES;
  const actor = actorFor(status);

  function onForceStatus(e) {
    const next = e.target.value;
    if (!next || next === status) return;
    track('home_protection.agent.status_overridden', {
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
        {actor && (
          <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-400">
            {actor}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Settings className="w-3 h-3 text-slate-400" />
        <label className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">
          Force status
        </label>
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
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <ShieldAlert className="w-3 h-3" /> API responses (super only)
          </span>
        )}
      </div>
    </div>
  );
}

// Save the in-flight opportunity and re-send the consumer link deep-linked to
// the current step. Phase 1 mocks the Twilio / Mandrill send.
export function SaveAndSendFooter({ opportunity, currentStepKey, sentSummary, onSent }) {
  const disabled = !opportunity?.captureLink?.url;

  function onClick() {
    if (disabled) return;
    const deepLink = `${opportunity.captureLink.url}&step=${currentStepKey}`;
    // Phase 1 mock — Phase 2 swaps these two for the real notification calls.
    console.log('[twilio:mock]', {
      to: opportunity?.contact?.phone || null,
      body: `Pick up where we left off: ${deepLink}`,
    });
    console.log('[mandrill:mock]', {
      to: opportunity?.contact?.email || null,
      subject: 'Continue your home protection quote',
      bodyHtml: `<a href="${deepLink}">Tap here to continue</a>`,
    });
    track('home_protection.agent.save_and_send', {
      opportunity_id: opportunity?.id,
      from_step: currentStepKey,
      deep_link: deepLink,
    });
    onSent?.({ at: new Date().toISOString(), step: currentStepKey });
  }

  return (
    <div className="mt-4 bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Save className="w-4 h-4 text-slate-400" />
        <span>
          Save the in-flight opportunity and re-send the consumer link, deep-linked
          to <span className="font-semibold text-slate-700">{currentStepKey}</span>.
        </span>
        {sentSummary && (
          <span className="ml-2 text-emerald-600 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Sent at {new Date(sentSummary.at).toTimeString().slice(0, 8)}
          </span>
        )}
        {/* Inline rather than a native title= — see components/Tooltip.jsx for
            why title= is banned repo-wide. */}
        {disabled && (
          <span className="ml-2 text-slate-400">Generate the link first.</span>
        )}
      </div>
      <button
        onClick={onClick}
        disabled={disabled}
        className={
          'text-xs font-semibold px-4 py-2 rounded-md flex items-center gap-1.5 ' +
          (disabled ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white')
        }
      >
        <Send className="w-3 h-3" /> Save and Send
      </button>
    </div>
  );
}

export { HP_STATUS_NAMES };
