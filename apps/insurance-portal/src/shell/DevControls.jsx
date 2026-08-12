// DEV CONTROLS sidebar contents. The chrome (dark sidebar, Section,
// Segmented) lives in src/shared/DevPanel.jsx — this file owns the
// portal-specific controls.
//
// EI contract toggles:
//   nextVerificationOutcome: 'completed' | 'error'
//     — only shown when the current/about-to-be flow path is
//       capture_and_quote (quote_only skips verification).
//   nextQuoteOutcome: 'completed' | 'error'
//     — relevant for both flow paths.
//   quoteSavingsOutcome: 'savings' | 'no_savings'  (Wave 31b-fu)
//     — controls whether quote.completed fires with a positive
//       savingsAmountCents or 0. Lets the agent demo both
//       InsuranceSavingsCard states (savings vs. no-savings) in isolation.
//
// Agent flow simulators (when ?view=agent) — Wave 31b-fu: each step is
// now triggered manually so the agent can pause at each card state:
//   - "Simulate consumer opens link" → flips to capture_link.viewed ONLY
//     (Blinker-internal signal). No webhook fires automatically.
//   - "Simulate capture completed"   → simulateWebhook(leadId, 'verification.completed')
//   - "Simulate quote completed"     → simulateWebhook(leadId, 'quote.completed')
//   - "Simulate quote viewed"        → simulateWebhook(leadId, 'quote.viewed')
//   - "Simulate policy bound"        → simulateWebhook(leadId, 'policy.bound')
//   - "Force duplicate on next create" → before the agent clicks
//     Generate, arms the mock to throw DuplicateLeadError (real EI
//     returns 4xx, not a webhook).
//   - "Open as consumer" → opens the EI-microsite simulator URL in a
//     new tab.
import { Car, Check, ExternalLink, Eye, RefreshCcw, ShieldAlert } from 'lucide-react';
import { DevPanel, Section, Segmented } from 'blinker-platform/components';
import { JsonPeek } from 'blinker-platform/components';
import { VIEW_KEYS } from './ViewSwitcher.jsx';
import { STATUS } from '../constants/status-map.js';
import { DEV_SEED_VEHICLE } from '../constants/dev-seeds.js';
import {
  simulateWebhook,
  setForceDuplicateOnNextCreate,
} from '../lib/embedded-insurance-mock.js';

const SIMULATED_FIRST_WEBHOOK_DELAY_MS = 800;

export function DevControls({
  open, view, setView,
  workflowState, resetWorkflow,
  dev, updateDev,
  workflow, updateWorkflow,
}) {
  const flowPath = workflow?.flowPath || dev?.flowPath || 'capture_and_quote';
  const showVerificationToggle = flowPath === 'capture_and_quote';

  return (
    <DevPanel open={open}>
      <Section label="View">
        <Segmented
          value={view}
          onChange={setView}
          options={VIEW_KEYS.map((v) => ({ v, l: v[0].toUpperCase() + v.slice(1) }))}
        />
        <p className="text-xs text-slate-500 mt-2 leading-snug">
          Mirrors <span className="font-mono">?view=</span> in the URL. The
          customer view is an EI-microsite simulator — production this is
          hosted by Embedded Insurance.
        </p>
      </Section>

      <Section label="Default flow path">
        <Segmented
          value={dev?.flowPath || 'capture_and_quote'}
          onChange={(v) => updateDev?.({ flowPath: v })}
          options={[
            { v: 'capture_and_quote', l: 'Capture + Quote' },
            { v: 'quote_only',        l: 'Quote Only' },
          ]}
        />
        <p className="text-xs text-slate-500 mt-2 leading-snug">
          Default the agent's <span className="font-mono">LeadOriginationForm</span>
          flow-path toggle to this. Also drives the customer-simulator's
          standalone behavior (when no agent-originated lead exists yet).
        </p>
      </Section>

      {showVerificationToggle && (
        <Section label="Next verification outcome">
          <Segmented
            value={dev?.nextVerificationOutcome || 'completed'}
            onChange={(v) => updateDev?.({ nextVerificationOutcome: v })}
            options={[
              { v: 'completed', l: 'Completed' },
              { v: 'error',     l: 'Error' },
            ]}
          />
          <p className="text-xs text-slate-500 mt-2 leading-snug">
            Drives the verification webhook (EI status:
            <span className="font-mono"> verification.completed</span>) for
            Capture+Quote. Quote Only skips this step entirely.
          </p>
        </Section>
      )}

      <Section label="Next quote outcome">
        <Segmented
          value={dev?.nextQuoteOutcome || 'completed'}
          onChange={(v) => updateDev?.({ nextQuoteOutcome: v })}
          options={[
            { v: 'completed', l: 'Completed' },
            { v: 'error',     l: 'Error' },
          ]}
        />
        <p className="text-xs text-slate-500 mt-2 leading-snug">
          Drives the quote webhook (EI status:
          <span className="font-mono"> quote.completed</span>). Quote-stage
          errors fire EI's shared <span className="font-mono">error</span> event;
          adapter discriminates as <span className="font-mono">error.quote</span>
          via summary contents.
        </p>
      </Section>

      {view === 'agent' && (
        <AgentSimulators
          workflow={workflow}
          updateWorkflow={updateWorkflow}
          dev={dev}
          updateDev={updateDev}
        />
      )}

      <Section label="vehicle_drive step (Wave 31)">
        <p className="text-xs text-slate-500 mb-2 leading-snug">
          Seed a realistic vehicle so QA can jump past the
          <span className="font-mono"> vehicle_drive </span>
          step without manually entering mileage. Also useful when
          testing the agent left-rail mileage / annual-miles display.
        </p>
        <button
          onClick={() => updateWorkflow?.({ vehicle: DEV_SEED_VEHICLE })}
          className="w-full flex items-center justify-center gap-2 text-xs px-3 py-2 rounded font-semibold bg-slate-700 hover:bg-slate-600 text-slate-100"
        >
          <Car className="w-3 h-3" /> Seed vehicle (skip drive step)
        </button>
        <p className="text-xs text-slate-500 mt-1 leading-snug">
          Seeds mileage 28,100 · condition Used · est. 14,100 mi/yr.
          CustomerView treats mileage-present as vehicle_drive completed.
        </p>
      </Section>

      <Section label="Workflow state">
        <JsonPeek label="insurance · live workflow" data={workflowState} />
        <p className="text-xs text-slate-500 mt-2 leading-snug">
          EI <span className="font-mono">lead_summary</span> webhook events
          land here as they're delivered.
        </p>
        {resetWorkflow && (
          <button
            onClick={resetWorkflow}
            className="w-full mt-3 flex items-center justify-center gap-2 text-xs px-3 py-2 bg-red-600 hover:bg-red-500 rounded font-semibold"
          >
            <RefreshCcw className="w-3 h-3" /> Reset workflow
          </button>
        )}
      </Section>
    </DevPanel>
  );
}

// Agent-flow simulators. Two distinct kinds of "advance the status"
// controls go through different paths on purpose:
//
//   1. Link-viewed flips (capture_link.viewed / quote_link.viewed) are
//      Blinker-internal signals (canon `signal_source: blinker_internal`).
//      In production they come from our URL-shortener telemetry, NOT
//      from EI. So we update workflow directly. No webhook auto-fires
//      after the flip (Wave 31b-fu: discrete buttons replaced the chain).
//
//   2. Partner-driven webhooks (verification.completed, quote.completed,
//      quote.viewed, policy.bound) go through simulateWebhook so the
//      lead_summary envelope flows through the same handler the real
//      adapter will use. Each is triggered by a separate button so the
//      agent can pause at each InsuranceSavingsCard state.
//
// Wave 14-fu: AgentView now ships a production "Force status" picker
// (AgentForceStatusBar) that handles plain status advancement — the
// picker writes `workflow.status` directly without going through the
// partner webhook pipeline. These simulators are KEPT because they
// each do something the picker can't:
//   * Simulate consumer opens link    — fires the link-viewed flip ONLY
//     (no auto-chained webhook; use the next button for that).
//   * Simulate capture completed      — exercises verification webhook,
//     populates workflow.capture with the fixture payload.
//   * Simulate quote completed        — exercises quote webhook,
//     populates workflow.quote; honors QUOTE SAVINGS toggle.
//   * Simulate quote viewed           — exercises EI's webhook handler,
//     populates workflow.quote.payload with the fixture (the picker
//     would only flip status, leaving workflow.quote unset).
//   * Simulate policy bound           — same as above for workflow.policy.
//   * Force duplicate on next         — error-injection on createLead, not
//     status forcing at all.
//   * Open as consumer                — utility, not status forcing.
// Use the picker for plain status-only forcing; use these to exercise
// the webhook contract end-to-end with realistic partner payloads.
function AgentSimulators({ workflow, updateWorkflow, dev, updateDev }) {
  const status = workflow?.status;
  const flowPath = workflow?.flowPath || 'capture_and_quote';
  const link = workflow?.consumer_link;
  const leadId = workflow?.lead?.leadId;
  const verificationOutcome = dev?.nextVerificationOutcome || 'completed';
  const quoteOutcome = dev?.nextQuoteOutcome || 'completed';
  const quoteSavingsOutcome = dev?.quoteSavingsOutcome || 'savings';

  const linkSentStatuses = [STATUS.CAPTURE_LINK_SENT, STATUS.QUOTE_LINK_SENT];
  const canSimulateView = linkSentStatuses.includes(status);
  // Capture completed: only enabled after link.viewed (agent must have
  // clicked "Simulate consumer opens link" first). quote_only skips this.
  const canSimulateCaptureCompleted =
    flowPath === 'capture_and_quote' &&
    status === STATUS.CAPTURE_LINK_VIEWED;
  // Quote completed: enabled after capture.completed (capture_and_quote)
  // OR after link.viewed (quote_only, which skips the capture step).
  const canSimulateQuoteCompleted =
    status === STATUS.CAPTURE_COMPLETED ||
    (flowPath === 'quote_only' && status === STATUS.QUOTE_LINK_VIEWED);
  const canSimulateQuoteViewed = status === STATUS.QUOTE_COMPLETED;
  // Per real EI: consumers can bind from quote.completed (skip the
  // quote-view screen) OR from quote.viewed.
  const canSimulatePolicyBound = [
    STATUS.QUOTE_COMPLETED,
    STATUS.QUOTE_VIEWED,
  ].includes(status);
  const canOpenAsConsumer = Boolean(link?.url);

  // Wave 31b-fu: link-viewed flip ONLY — no auto-chained webhook.
  // The agent must click "Simulate capture completed" separately to
  // progress. This lets the InsuranceSavingsCard pause at the
  // capture_link.viewed state (Customer reviewing — savings TBD).
  function simulateConsumerOpenedLink() {
    if (!canSimulateView || !leadId) return;
    updateWorkflow({
      status:
        flowPath === 'quote_only'
          ? STATUS.QUOTE_LINK_VIEWED
          : STATUS.CAPTURE_LINK_VIEWED,
    });
  }

  // Wave 31b-fu: discrete button for verification.completed. Honors
  // nextVerificationOutcome toggle (error path fires EI error event).
  function simulateCaptureCompleted() {
    if (!canSimulateCaptureCompleted || !leadId) return;
    if (verificationOutcome === 'error') {
      simulateWebhook(leadId, 'error', { errorPhase: 'verification' });
    } else {
      simulateWebhook(leadId, 'verification.completed', { chain: false });
    }
  }

  // Wave 31b-fu: discrete button for quote.completed. Honors
  // nextQuoteOutcome toggle (error path) AND quoteSavingsOutcome toggle
  // (savings vs. no-savings card state).
  function simulateQuoteCompleted() {
    if (!canSimulateQuoteCompleted || !leadId) return;
    if (quoteOutcome === 'error') {
      simulateWebhook(leadId, 'error', { errorPhase: 'quote' });
    } else {
      simulateWebhook(leadId, 'quote.completed', {
        chain: false,
        savingsOutcome: quoteSavingsOutcome,
      });
    }
  }

  function simulateQuoteViewed() {
    if (!canSimulateQuoteViewed || !leadId) return;
    simulateWebhook(leadId, 'quote.viewed');
  }
  function simulatePolicyBound() {
    if (!canSimulatePolicyBound || !leadId) return;
    simulateWebhook(leadId, 'policy.bound');
  }

  function openAsConsumer() {
    if (!canOpenAsConsumer || typeof window === 'undefined') return;
    window.open(link.url, '_blank', 'noopener,noreferrer');
  }

  return (
    <Section label="Agent flow simulators">
      <p className="text-[11px] text-slate-500 mb-2 leading-snug">
        For plain status forcing, use the production
        <span className="font-mono"> Force status </span>
        picker on the post-send AgentView. These DEV simulators
        additionally exercise the partner webhook pipeline (envelope
        handler → workflow.capture / quote / policy payload writes) and
        the createLead 4xx path. Step through in order to observe each
        InsuranceSavingsCard state.
      </p>

      {/* Step 1: link.viewed — Blinker-internal flip, no webhook */}
      <button
        onClick={simulateConsumerOpenedLink}
        disabled={!canSimulateView}
        className={
          'w-full flex items-center justify-center gap-2 text-xs px-3 py-2 rounded font-semibold ' +
          (canSimulateView
            ? 'bg-blue-600 hover:bg-blue-500 text-white'
            : 'bg-slate-800 text-slate-500 cursor-not-allowed')
        }
      >
        <Eye className="w-3 h-3" /> Simulate consumer opens link
      </button>
      <p className="text-xs text-slate-500 mt-1 mb-2 leading-snug">
        Flips to <span className="font-mono">capture_link.viewed</span> (Blinker-internal
        signal). No webhook fires — use "Simulate capture completed" next.
      </p>

      {/* Step 2: verification.completed → capture.completed */}
      {flowPath === 'capture_and_quote' && (
        <>
          <button
            onClick={simulateCaptureCompleted}
            disabled={!canSimulateCaptureCompleted}
            className={
              'w-full flex items-center justify-center gap-2 text-xs px-3 py-2 rounded font-semibold ' +
              (canSimulateCaptureCompleted
                ? 'bg-blue-600 hover:bg-blue-500 text-white'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed')
            }
          >
            <Check className="w-3 h-3" /> Simulate capture completed
          </button>
          <p className="text-xs text-slate-500 mt-1 mb-2 leading-snug">
            Fires EI's <span className="font-mono">verification.completed</span> webhook
            — populates workflow.capture with the carrier verification fixture.
            Honors the Next Verification Outcome toggle.
          </p>
        </>
      )}

      {/* Step 3: quote.completed — with QUOTE SAVINGS toggle */}
      <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold mb-1">
        Quote savings
      </div>
      <Segmented
        value={quoteSavingsOutcome}
        onChange={(v) => updateDev?.({ quoteSavingsOutcome: v })}
        options={[
          { v: 'savings',    l: 'Savings' },
          { v: 'no_savings', l: 'No savings' },
        ]}
      />
      <p className="text-[11px] text-slate-500 mt-1 mb-2 leading-snug">
        Controls <span className="font-mono">savingsAmountCents</span> in the
        quote.completed payload: Savings = positive fixture value; No savings = 0.
        Lets you demo both InsuranceSavingsCard states.
      </p>
      <button
        onClick={simulateQuoteCompleted}
        disabled={!canSimulateQuoteCompleted}
        className={
          'w-full flex items-center justify-center gap-2 text-xs px-3 py-2 rounded font-semibold ' +
          (canSimulateQuoteCompleted
            ? 'bg-blue-600 hover:bg-blue-500 text-white'
            : 'bg-slate-800 text-slate-500 cursor-not-allowed')
        }
      >
        <Check className="w-3 h-3" /> Simulate quote completed
      </button>
      <p className="text-xs text-slate-500 mt-1 mb-2 leading-snug">
        Fires EI's <span className="font-mono">quote.completed</span> webhook
        — populates workflow.quote with the quote fixture. Honors the Next
        Quote Outcome toggle (error path) and the Quote Savings toggle above.
      </p>

      {/* Step 4: quote.viewed */}
      <button
        onClick={simulateQuoteViewed}
        disabled={!canSimulateQuoteViewed}
        className={
          'w-full flex items-center justify-center gap-2 text-xs px-3 py-2 rounded font-semibold ' +
          (canSimulateQuoteViewed
            ? 'bg-blue-600 hover:bg-blue-500 text-white'
            : 'bg-slate-800 text-slate-500 cursor-not-allowed')
        }
      >
        <Eye className="w-3 h-3" /> Simulate quote viewed
      </button>
      <p className="text-xs text-slate-500 mt-1 mb-2 leading-snug">
        Fires EI's <span className="font-mono">quote.viewed</span> webhook
        with the fixture payload — populates workflow.quote with viewed
        timestamp. The picker can flip status alone; this exercises the
        envelope handler.
      </p>

      {/* Step 5: policy.bound */}
      <button
        onClick={simulatePolicyBound}
        disabled={!canSimulatePolicyBound}
        className={
          'w-full flex items-center justify-center gap-2 text-xs px-3 py-2 rounded font-semibold ' +
          (canSimulatePolicyBound
            ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
            : 'bg-slate-800 text-slate-500 cursor-not-allowed')
        }
      >
        <Check className="w-3 h-3" /> Simulate policy bound
      </button>
      <p className="text-xs text-slate-500 mt-1 mb-2 leading-snug">
        Fires EI's <span className="font-mono">policy.bound</span> webhook
        with the fixture payload — populates workflow.policy. The picker
        can flip status alone; this exercises the envelope handler.
      </p>

      <button
        onClick={() => setForceDuplicateOnNextCreate(true)}
        className="w-full flex items-center justify-center gap-2 text-xs px-3 py-2 rounded font-semibold bg-amber-700 hover:bg-amber-600 text-white"
      >
        <ShieldAlert className="w-3 h-3" /> Force duplicate on next create
      </button>
      <p className="text-xs text-slate-500 mt-1 mb-2 leading-snug">
        Arms the mock to throw <span className="font-mono">DuplicateLeadError</span>
        on the next <span className="font-mono">createLead</span>. EI returns
        these as 4xx synchronously, not as a webhook — distinct from
        anything the picker can do.
      </p>

      <button
        onClick={openAsConsumer}
        disabled={!canOpenAsConsumer}
        className={
          'w-full flex items-center justify-center gap-2 text-xs px-3 py-2 rounded font-semibold ' +
          (canOpenAsConsumer
            ? 'bg-slate-800 hover:bg-slate-700 text-slate-100'
            : 'bg-slate-800 text-slate-500 cursor-not-allowed')
        }
      >
        <ExternalLink className="w-3 h-3" /> Open as consumer
      </button>
      <p className="text-xs text-slate-500 mt-1 leading-snug">
        Opens the EI-microsite simulator at the lead's link in a new tab.
        Cross-tab webhooks won't propagate (each tab has its own mock).
      </p>
    </Section>
  );
}
