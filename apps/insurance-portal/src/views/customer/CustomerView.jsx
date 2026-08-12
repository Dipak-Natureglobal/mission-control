// Customer-side wizard. **This is a SIMULATOR.** Production has none
// of these screens on a Blinker URL — EI hosts the entire consumer
// flow on their microsite (architecture/06-embedded-insurance-contract.md).
// We keep this view as demoware so stakeholders can see what the
// consumer experiences without redirecting to a partner sandbox. The
// banner at the top and the muted Blinker chrome are deliberate
// honesty about that.
//
// Two flow paths drive different step sequences (ADR 21 D2 / Wave 31
// v3.0.11):
//
//   capture_and_quote (preferred):
//     capture → vehicle_drive → getting_quote → quote_review → policy_bound
//
//   quote_only (escape hatch):
//     vehicle_drive → getting_quote → quote_review → policy_bound
//
// vehicle_drive precedes the EI quote request because mileage and
// annual_miles_estimate are underwriting inputs — the quote cannot fire
// until the consumer completes this step.
//
// flowPath is read from workflow.flowPath when an agent-originated
// lead exists, else from dev.flowPath (standalone simulator access).
import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { WizardShell } from 'blinker-platform/components';
import { CaptureForm } from './CaptureForm.jsx';
import { VehicleDrive } from './VehicleDrive.jsx';
import { GettingQuote } from './GettingQuote.jsx';
import { QuoteReview } from './QuoteReview.jsx';
import { PolicyBound } from './PolicyBound.jsx';
import { subscribeWebhooks } from '../../lib/embedded-insurance-mock.js';
import { applyWebhookEvent } from '../../lib/insurance-webhook-handler.js';
import { captureEvent } from 'blinker-platform/telemetry';
import { STATUS } from '../../constants/status-map.js';

// Step ID → displayed step number is dynamic per flow path.
// vehicle_drive is a wizard-only step (no new canon status row — the
// partner-facing status doesn't change between capture.completed and
// the moment we fire the quote). ADR 21 D2.
const CAPTURE_AND_QUOTE_STEPS = ['capture', 'vehicle_drive', 'getting_quote', 'quote_review', 'policy_bound'];
const QUOTE_ONLY_STEPS = ['vehicle_drive', 'getting_quote', 'quote_review', 'policy_bound'];

function stepFor(status, flowPath, vehicleDriveCompleted) {
  // Pre-flight: render the capture form (only for capture+quote) or
  // the vehicle_drive step (quote_only first step).
  if (status === STATUS.NOT_STARTED || status === STATUS.STARTED) {
    if (flowPath === 'quote_only') {
      // quote_only: first step is always vehicle_drive.
      return vehicleDriveCompleted ? 'getting_quote' : 'vehicle_drive';
    }
    return 'capture';
  }
  // After capture.completed (LEAD_CREATED for capture+quote): land on
  // vehicle_drive so mileage is collected before the EI quote fires.
  // Gate: once vehicle_drive is done, advance to getting_quote.
  if (status === STATUS.LEAD_CREATED) {
    return vehicleDriveCompleted ? 'getting_quote' : 'vehicle_drive';
  }
  if (status === STATUS.CAPTURE_COMPLETED) return 'getting_quote';
  if (status === STATUS.ERROR_VERIFICATION) return 'getting_quote';
  if (status === STATUS.QUOTE_COMPLETED || status === STATUS.QUOTE_VIEWED) return 'quote_review';
  if (status === STATUS.ERROR_QUOTE) return 'quote_review';
  if (status === STATUS.POLICY_BOUND) return 'policy_bound';
  return flowPath === 'quote_only' ? 'vehicle_drive' : 'capture';
}

function SimulatorBanner() {
  return (
    <div className="mb-4 px-4 py-2 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
      <ExternalLink className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-600" />
      <div className="leading-snug">
        <span className="font-semibold">EI microsite simulator.</span> In
        production this entire flow runs on Embedded Insurance's hosted
        microsite, not on a Blinker URL. Blinker only listens for
        webhook events. These screens approximate what the consumer
        sees on EI's surface.
      </div>
    </div>
  );
}

export function CustomerView({ workflow, updateWorkflow, dev }) {
  const status = workflow?.status;
  const flowPath = workflow?.flowPath || dev?.flowPath || 'capture_and_quote';

  // vehicle_drive is a wizard-only step — no new canon status row.
  // vehicleDriveCompleted is the local gate that advances past vehicle_drive
  // into getting_quote.
  //
  // Derived from two sources of truth so a reset or dev-seed takes effect
  // without a separate setState effect:
  //   1. mileage already on the workflow (dev seed or back-navigation after
  //      the consumer completed the step in the same session).
  //   2. onVehicleDriveNext has been clicked (local flag).
  //
  // Both signals collapse to a single computed boolean so the wizard doesn't
  // call setState in an effect (avoids cascading renders + lint warning).
  const [onVehicleDriveNextClicked, setOnVehicleDriveNextClicked] = useState(false);
  const mileageAlreadySet =
    workflow?.vehicle?.mileage != null && workflow?.vehicle?.mileage >= 0;
  // When NOT_STARTED the workflow is fully reset — clear the local next-clicked
  // flag via a key on this component if needed, but for simplicity we also
  // treat NOT_STARTED as "not completed" regardless of the mileage flag so
  // the agent can re-run the step in a fresh session.
  const vehicleDriveCompleted =
    status !== STATUS.NOT_STARTED && (mileageAlreadySet || onVehicleDriveNextClicked);

  const stepId = stepFor(status, flowPath, vehicleDriveCompleted);
  const stepList =
    flowPath === 'quote_only' ? QUOTE_ONLY_STEPS : CAPTURE_AND_QUOTE_STEPS;
  const stepIndex = Math.max(0, stepList.indexOf(stepId));
  const progress = useMemo(
    () => Math.round(((stepIndex + 1) / stepList.length) * 100),
    [stepIndex, stepList.length]
  );

  const [submitting, setSubmitting] = useState(false);

  // Webhook subscription anchored at the wizard root — survives the
  // step transition that unmounts CaptureForm. Subscribes on first
  // leadId, re-subscribes if a new lead replaces the old one.
  const leadId = workflow?.lead?.leadId;
  const unsubRef = useRef(null);
  useEffect(() => {
    if (!leadId) return undefined;
    unsubRef.current?.();
    unsubRef.current = subscribeWebhooks(leadId, (envelope) => {
      applyWebhookEvent(envelope, updateWorkflow);
      captureEvent('insurance_webhook_received', {
        lead_id: leadId,
        ei_status: envelope.status,
        view: 'customer',
      });
    });
    return () => {
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [leadId, updateWorkflow]);

  return (
    <>
      <SimulatorBanner />
      <WizardShell
        progress={progress}
        stepIndex={stepIndex + 1}
        stepTotal={stepList.length}
      >
        {stepId === 'capture' && (
          <CaptureForm
            workflow={workflow}
            updateWorkflow={updateWorkflow}
            submitting={submitting}
            setSubmitting={setSubmitting}
            dev={dev}
          />
        )}
        {stepId === 'vehicle_drive' && (
          <VehicleDrive
            workflow={workflow}
            updateWorkflow={updateWorkflow}
            onNext={() => setOnVehicleDriveNextClicked(true)}
          />
        )}
        {stepId === 'getting_quote' && <GettingQuote workflow={workflow} />}
        {stepId === 'quote_review' && <QuoteReview workflow={workflow} />}
        {stepId === 'policy_bound' && <PolicyBound workflow={workflow} />}
      </WizardShell>
    </>
  );
}
