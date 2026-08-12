// Capture step of the EI-microsite simulator. In production this UI
// lives on EI's microsite, not Blinker — see
// architecture/06-embedded-insurance-contract.md. The simulator's job
// is to model what the consumer would do there:
//   1. Upload an insurance card (or skip / go third-party).
//   2. Confirm carrier name (the OCR result that EI's microsite would
//      pre-fill).
//   3. Submit → fires verification.completed via simulateWebhook.
//
// EI does NOT return coverage limits, deductibles, or current premium
// from verification — so this form doesn't ask for them. The earlier
// prototype's "current carrier / policy expiration / vehicle confirm"
// fields are gone.
//
// If no lead exists yet (the simulator was opened standalone via
// ?view=customer instead of via an agent-generated link), the submit
// also calls createLead first.
import { useState } from 'react';
import { ScanLine, ShieldCheck } from 'lucide-react';
import { ScreenHeader, WizardFooter } from 'blinker-platform/components';
import { Field } from 'blinker-platform/components';
import { useForm } from '../../hooks/useForm.js';
import { createLead, simulateWebhook } from '../../lib/embedded-insurance-mock.js';
import { captureEvent } from 'blinker-platform/telemetry';
import { STATUS } from '../../constants/status-map.js';

// Mock contact context. Real values arrive on EI's microsite from the
// one-time link's token resolution; we keep a stub here so standalone
// simulator access (no agent precursor) renders something realistic.
const MOCK_CONTACT = {
  firstName: 'Jordan',
  vehicle: '2021 Toyota RAV4 · ending in 4F2A',
};

export function CaptureForm({ workflow, updateWorkflow, submitting, setSubmitting, dev }) {
  const [form, updateForm] = useForm({
    currentCarrier: '',
    cardFile: null,
  });
  const [errors, setErrors] = useState({});

  function validate() {
    const e = {};
    if (!form.currentCarrier?.trim()) e.currentCarrier = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function onCardChange(file) {
    updateForm({ cardFile: file });
    if (file) {
      captureEvent('insurance_capture_card_uploaded', {
        filename: file.name,
        size_bytes: file.size,
        type: file.type,
      });
    }
  }

  async function onSubmit() {
    if (!validate()) return;
    setSubmitting(true);
    captureEvent('insurance_capture_submitted', {
      has_card: Boolean(form.cardFile),
      carrier: form.currentCarrier,
    });

    // If the simulator was opened cold (?view=customer without an
    // agent-originated lead), create one on the fly so the webhook
    // chain has somewhere to land. Mirrors what EI's microsite does
    // in production: a lead already exists from the agent's create
    // call before the consumer touches anything.
    let leadId = workflow?.lead?.leadId;
    let flowPath = workflow?.flowPath;
    if (!leadId) {
      const created = await createLead(
        {
          applicant: { firstName: MOCK_CONTACT.firstName },
          vehicles: { 1: { make: 'Toyota', model: 'RAV4', year: 2021 } },
          partnerBrand: 'Blinker',
          partnerData: { sourceSystem: 'PartnerPortal' },
        },
        {
          flowPath: dev?.flowPath || 'capture_and_quote',
          nextVerificationOutcome: dev?.nextVerificationOutcome || 'completed',
          nextQuoteOutcome: dev?.nextQuoteOutcome || 'completed',
          autoChain: false, // we drive verification ourselves on submit
        }
      );
      leadId = created.leadId;
      flowPath = dev?.flowPath || 'capture_and_quote';
      updateWorkflow({
        flowPath,
        lead: { ...created },
        status: STATUS.LEAD_CREATED,
      });
    }

    // Fire the verification webhook the way EI would after the
    // consumer completes their card upload + confirm step on the
    // microsite. Honor the verification outcome the agent (or
    // standalone DEV CONTROLS) selected.
    const verificationOutcome = dev?.nextVerificationOutcome || 'completed';
    simulateWebhook(
      leadId,
      verificationOutcome === 'error' ? 'error' : 'verification.completed',
      verificationOutcome === 'error' ? { errorPhase: 'verification' } : {}
    );
    setSubmitting(false);
  }

  return (
    <>
      <ScreenHeader
        icon={ShieldCheck}
        eyebrow="Insurance Quote"
        title={`Hi ${MOCK_CONTACT.firstName} — let's verify your current policy`}
        subtitle="Snap a photo of your insurance card or enter your carrier manually. Takes about a minute."
      />

      <div className="px-6 pb-2 space-y-4">
        <div>
          <div className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wide">
            Insurance card photo
          </div>
          <label className="flex items-center gap-2 cursor-pointer border border-dashed border-slate-300 rounded-md px-3 py-3 text-sm text-slate-600 hover:border-blue-400 hover:bg-blue-50/30">
            <ScanLine className="w-4 h-4 text-slate-400" />
            <span className="flex-1 truncate">
              {form.cardFile
                ? form.cardFile.name
                : 'Snap or upload a photo of the front of your card'}
            </span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onCardChange(e.target.files?.[0] || null)}
            />
          </label>
          <p className="text-xs text-slate-400 mt-1 leading-snug">
            Optional — speeds up the OCR step. Skip and confirm carrier manually below.
          </p>
        </div>

        <Field
          label="Current insurance carrier"
          value={form.currentCarrier}
          onChange={(v) => updateForm({ currentCarrier: v })}
          placeholder="GEICO, Progressive, State Farm…"
          error={errors.currentCarrier}
        />

        <div className="text-xs text-slate-500 leading-snug bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
          Vehicle on file: <span className="font-mono">{MOCK_CONTACT.vehicle}</span>.
          We'll attach this to the quote request.
        </div>
      </div>

      <WizardFooter
        onNext={onSubmit}
        disabled={submitting}
        nextLabel={submitting ? 'Verifying…' : 'Verify my policy'}
      />
    </>
  );
}
