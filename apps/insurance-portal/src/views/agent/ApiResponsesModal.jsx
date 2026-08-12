// "View API responses" modal — super_admin (or any persona with the
// canon `view_api_responses` permission) only.
//
// Surfaces raw Embedded Insurance webhook payloads landed on the
// workflow so a privileged operator can debug or audit what each EI
// event returned. Mirrors protection-portal/src/views/agent/
// ApiResponsesModal.jsx — same single-modal-with-sections layout and
// JsonPeek-per-payload presentation.
//
// Source of payloads (per src/lib/insurance-webhook-handler.js):
//   * verification.completed → workflow.capture.verification (raw EI
//     summary.insuranceVerification fixture: id-card source, policyInfo,
//     media, vehicles, namedInsureds)
//   * quote.completed        → workflow.quote.payload (raw EI
//     summary.quote: id, carrier, totalPremiumCents, savingsAmountCents,
//     createdAt)
//   * quote.viewed           → workflow.quote.payload (overlaid with
//     status='viewed' + viewedAt by the mock when re-fired)
//   * policy.bound           → workflow.policy.payload (raw EI
//     summary.policy: id, carrier, boundAt)
//   * error.verification / error.quote → carries whichever summary
//     blocks the partner included (capture and/or quote with status
//     'failed') — same workflow.capture / workflow.quote slots, just
//     with failed-status payloads.
//
// Persona gating: AgentForceStatusBar's neighbor in AgentView hides the
// trigger button for non-qualifying personas. We still render-guard
// here so a stale modal flag can't leak the data after a persona
// switch. Permission check matches canon/personas.json — super_admin
// + admin both carry `view_api_responses`.
//
// PostHog: emits insurance.agent.api_responses_event_expanded per
// JsonPeek toggle so we can see which integrations operators actually
// dig into. The open event itself is fired by AgentView when the
// caller clicks the trigger button, not here.
import { useState } from 'react';
import { ExternalLink, X, ChevronDown, ChevronRight } from 'lucide-react';
import { JsonPeek } from 'blinker-platform/components';
import { captureEvent } from 'blinker-platform/telemetry';
import personasJson from '../../constants/canon/personas.json';

function hasViewApiPermission(persona) {
  const perms = personasJson?.personas?.[persona]?.permissions || [];
  return perms.includes('view_api_responses');
}

// Order matches the EI lifecycle so a reader scanning top-down sees
// the same sequence the timeline shows — verification → quote →
// quote-viewed (overlaid on quote.payload) → policy.
const SECTIONS = [
  {
    eventType: 'verification.completed',
    label: 'EI · Verification (capture)',
    statusPill: 'capture.completed',
    pick: (workflow) => workflow?.capture?.verification || null,
    meta: (workflow) => ({
      eventId: workflow?.capture?.eventId || null,
      eventTime: workflow?.capture?.eventTime || null,
    }),
  },
  {
    eventType: 'quote.completed',
    label: 'EI · Quote',
    statusPill: 'quote.completed',
    pick: (workflow) => workflow?.quote?.payload || null,
    meta: (workflow) => ({
      eventId: workflow?.quote?.eventId || null,
      eventTime: workflow?.quote?.eventTime || null,
    }),
  },
  {
    eventType: 'policy.bound',
    label: 'EI · Policy bound',
    statusPill: 'policy.bound',
    pick: (workflow) => workflow?.policy?.payload || null,
    meta: (workflow) => ({
      eventId: workflow?.policy?.eventId || null,
      eventTime: workflow?.policy?.eventTime || null,
    }),
  },
];

function CollapsibleSection({ section, workflow, persona }) {
  const [open, setOpen] = useState(false);
  const data = section.pick(workflow);
  const meta = section.meta(workflow);
  const present = data != null;

  function onToggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      captureEvent('insurance.agent.api_responses_event_expanded', {
        event_type: section.eventType,
        persona,
        present,
      });
    }
  }

  return (
    <div className="border border-slate-200 rounded-md overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 text-left"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
        )}
        <span className="text-xs font-semibold text-slate-700">
          {section.label}
        </span>
        <span className="text-[10px] uppercase tracking-wide font-mono text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded">
          {section.statusPill}
        </span>
        {!present && (
          <span className="ml-auto text-[10px] uppercase tracking-wide font-semibold text-slate-400">
            Not yet received
          </span>
        )}
        {present && meta.eventTime && (
          <span className="ml-auto text-[10px] font-mono text-slate-400">
            {new Date(meta.eventTime).toTimeString().slice(0, 8)}
          </span>
        )}
      </button>
      {open && (
        <div className="p-3 space-y-2 bg-white">
          <JsonPeek
            label={`${section.eventType} · raw partner payload`}
            data={present ? { ...meta, payload: data } : null}
          />
        </div>
      )}
    </div>
  );
}

export function ApiResponsesModal({ workflow, persona, onClose }) {
  if (!hasViewApiPermission(persona)) return null;

  return (
    <div className="fixed inset-0 bg-slate-900 bg-opacity-60 flex items-center justify-center p-4 z-50">
      <div
        className="bg-white rounded-xl shadow-xl max-w-3xl w-full overflow-hidden flex flex-col"
        style={{ maxHeight: '90vh' }}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ExternalLink className="w-4 h-4 text-blue-600" />
            <div className="font-semibold">View API responses</div>
            <span className="text-[10px] uppercase tracking-wide font-semibold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
              {persona === 'super_admin' ? 'super admin' : persona}
            </span>
            <span className="text-[10px] uppercase tracking-wide font-mono text-slate-500 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">
              lead {workflow?.lead?.leadId || '—'}
            </span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-auto flex-1 space-y-3">
          <p className="text-[11px] text-slate-500 leading-snug">
            Raw <span className="font-mono">lead_summary</span> envelope
            blocks the Embedded Insurance partner returned for this lead.
            Each section expands to show the full JSON payload —
            verification (Capture+Quote only), quote, and policy. Error
            envelopes overlay the same blocks with a{' '}
            <span className="font-mono">status: failed</span> field.
          </p>
          {SECTIONS.map((section) => (
            <CollapsibleSection
              key={section.eventType}
              section={section}
              workflow={workflow}
              persona={persona}
            />
          ))}
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
