// Cross-sell sub-flow surface — used by both consumer mode (full-page
// detour from RecommendedCoverage with breadcrumb back) and agent mode
// (right-hand pane next to the wizard). The visual chrome differs per
// surface but the embed contents are identical.
//
// Surface props are owned by the caller (CustomerView / AgentView):
//   - workflow:    'insurance' | 'refi'
//   - onComplete:  fired with { insuranceSavings? | refiOffer? }
//                  populated; caller writes into form.{slot}.
//   - onCancel:    user closed without completing.
//   - persona:     forwarded to the embed for forward-compat copy.
//   - personaLocked: same.
//
// === Refi surface ===
//   Embeds refi-portal's RefiSubFlow (the step-by-step wizard wrapper),
//   not the legacy slim PrequalForm. The host (this file) supplies a
//   prefilledForm built from form.contact + form.vehicle and drops the
//   consumer at s1_ownership — the first refi-specific question — so
//   the wizard skips re-asking for fields protection-portal already
//   collected upstream.
//
//   When the contact has household members on file (resolved by
//   mission-control's contact-prefill, surfaced as
//   form.contact.household_members), RefiMiniFlow first shows a
//   co-applicant decision card BEFORE the wizard mounts. Choosing a
//   household member as co-applicant flips RefiSubFlow's
//   form.hasCoApplicant=true and pre-fills the coApp* fields so
//   s1_co_app_decision lands with the answer pre-selected.
//
//   PrequalForm remains available on refi-portal's public surface for
//   hosts that prefer the legacy single-page mini-capture; protection-
//   portal moved off it so the consumer walks the canonical refi
//   screens (better surface area for trust + completeness).
//
//   After RefiSubFlow.onComplete returns a decision payload (same shape
//   as PrequalForm), this component branches on decision.result and
//   renders the matching public card:
//     pre_approved    → QualifiedCard
//     offers_returned → OffersCard, fed directly from
//                        decision.offers — RefiSubFlow.onComplete
//                        always includes an `offers` array (empty for
//                        non-offers branches, MOCK_OFFERS for
//                        offers_returned). Per-offer apr/term flow
//                        through to applyRefiOffer for the
//                        protectionPlanPortionCents math.
//     disqualified    → DisqualifiedCard
//     pending         → PendingCard
//   The consumer accepts via OffersCard.onSelect (offer row click) or
//   QualifiedCard.onContinue. We compute protectionPlanPortionCents
//   via protectionPlanMonthlyOnRefi() using the selected plan's total
//   as both planTotal and loanPrincipal (Phase 1 simplification —
//   real refi rolls vehicle payoff + plan total into one principal;
//   Phase 2 surfaces vehicle payoff inline).
//
// === Insurance surface (Wave 13 rewrite, 2026-05-05) ===
//   The user-facing flow per the Wave 13 brief:
//     1. Confirm contact (name / email / phone) — read from
//        form.contact, allow inline edit.
//     2. Collect DOB if missing (canonical YYYY-MM-DD on
//        form.contact.date_of_birth — matches mission-control's Wave
//        13a DOB collection contract per blinker-domain.json).
//     3. Pick flowPath ('capture_and_quote' | 'quote_only').
//     4. Mount insurance-portal's public AgentView (which composes
//        LeadOriginationForm + LeadStatusTimeline + NotesPanel
//        internally) wired to a local workflow state. The form's
//        fields are seeded from our contact (via the AgentView
//        `contact` prop). The agent persona on AgentView is an
//        embed-contract artifact — copy reads "agent" but the
//        consumer drives the same buttons.
//     5. After Generate + Send, mount InsuranceDevControls (also
//        public) so the consumer / demo can simulate the EI mock
//        chain (verification.completed → quote.completed) and watch
//        the timeline progress.
//     6. When workflow.status === 'quote.completed' AND
//        workflow.quote.payload.savingsAmountCents > 0, fire
//        onComplete() with insuranceSavings populated. Confirm.jsx
//        then drops the SavingsCard in the protection plan view
//        (handled in commit 3 of this wave).
//
//   Why AgentView (not CaptureForm or LeadOriginationForm directly):
//   insurance-portal/src/views/agent/index.js exports ONLY
//   AgentView (LeadOriginationForm + LeadStatusTimeline are
//   explicitly private). The public surface is the unit; we use it
//   as-is per the platform "don't modify sibling repos" rule.
//   Extra render of NotesPanel beneath the timeline is harmless in
//   this context — the workflow's notes/tags slots persist into the
//   local workflow state alongside the lead.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, Users, XCircle, Cake, Mail, Phone, User } from 'lucide-react';
import { AgentView, InsuranceDevControls } from 'insurance-portal/src/views/agent';
import { subscribeWebhooks } from 'insurance-portal/src/lib/embedded-insurance-mock.js';
import { applyWebhookEvent } from 'insurance-portal/src/lib/insurance-webhook-handler.js';
// Note: DisqualifiedCard from refi-portal currently imports from
// `../../constants` (resolves to refi-portal/src/constants/index.js)
// which has a syntax error in upstream as of 2026-05-03. The other
// public exports (RefiSubFlow / OffersCard / QualifiedCard / PendingCard)
// don't share that transitive dep, so we cherry-pick the four working
// exports and render the disqualified branch inline below using a
// local DISQUAL_REASONS mirror. Spec gap to fix in § 1.5e:
// refi-portal/src/constants/index.js needs its missing closing brackets.
import {
  RefiSubFlow,
  OffersCard,
  QualifiedCard,
  PendingCard,
} from 'refi-portal/src/views/customer';
import { protectionPlanMonthlyOnRefi } from '../../lib/protection-pricing.js';
import orgRegistry from '../../constants/canon/org-registry.json';
import { track } from 'blinker-platform/telemetry';
// Wave 17 P1-fu — VIN-collection pre-step. Both insurance and refi
// cross-sells require a 17-char VIN downstream (EI origination requires
// it; refi's RefiSubFlow tries to MarketCheck on VIN). Protection's
// own wizard intentionally allows YMMT-only entry, so a YMMT-only
// vehicle reaches this sub-flow without a VIN. We mount the lifted
// platform component as a pre-step before the embed-specific UX.
import { VehicleAddOrConfirm, WizardShell } from 'blinker-platform/components';

// Local mirror of DISQUAL_REASONS for the inline disqualified card,
// because the public DisqualifiedCard from refi-portal pulls in a
// broken constants barrel (see import note above). Keys here match
// the runDecision() reason field shape from refi-portal/src/lib/refi.js.
// When the upstream barrel is fixed we can delete this and re-import
// the public DisqualifiedCard.
const DISQUAL_REASONS = {
  no_consent: { title: 'Consent required', msg: 'A soft credit pull consent is required before we can submit to any partner.' },
  ssn_required_for_partner: { title: 'SSN required', msg: 'The matched partner requires an SSN to prequalify.' },
  state_ineligible: { title: 'State not eligible', msg: 'No refinance partner is currently available in your state.' },
  credit_out_of_range: { title: 'Credit band out of range', msg: 'The self-reported credit range is outside all configured partner thresholds.' },
  income_below_min: { title: 'Annual income below minimum', msg: 'The stated annual income is below configured partner minimums.' },
  payoff_below_min: { title: 'Estimated payoff below minimum', msg: 'The estimated payoff is below configured partner minimums.' },
  under_18: { title: 'Applicant must be 18 or older', msg: 'Refinance partners require all applicants to be at least 18 years old.' },
  vehicle_too_old: { title: 'Vehicle too old to refinance', msg: 'The vehicle\'s model year is outside the configured maximum age.' },
  mileage_too_high: { title: 'Odometer too high', msg: 'The reported mileage exceeds the configured maximum.' },
  ownership_ineligible: { title: 'Ownership status not eligible', msg: 'Refinancing requires an existing auto loan or lease.' },
  credit_requires_coapp: { title: 'Co-applicant required', msg: 'With a credit band below 580 and no co-applicant, we can\'t match a partner.' },
  employment_and_credit: { title: 'Employment + credit not eligible', msg: 'Your employment type combined with this credit band falls outside partner rules.' },
  ltv_too_high: { title: 'Loan-to-Value too high', msg: 'The payoff amount exceeds the maximum allowable LTV for this credit band.' },
};

// CrossSellBreadcrumb + WORKFLOW_ICONS live in ./CrossSellChrome.jsx so
// the chrome can stay in the initial bundle while this module (which
// pulls in the refi-portal monolith via PrequalForm) is React.lazy'd at
// the call site.

// Wave 17 P1-fu — Build the in-flight VIN/YMMT entry form for the
// cross-sell pre-step. Pre-fills year/make/model/trim from the
// upstream protection wizard form so the agent / consumer only needs
// to enter the VIN. Mirrors insurance-portal's buildInitialVehicleForm
// (insurance-portal/src/views/agent/AgentView.jsx) — same recognized
// fields VehicleAddOrConfirm reads.
function buildInitialCrossSellVehicleForm(form) {
  const v = form?.vehicle || {};
  return {
    vin: form?.vin || v.vin || '',
    year: form?.year ?? v.year ?? null,
    make: form?.make || v.make || '',
    model: form?.model || v.model || '',
    trim: form?.trim || v.trim || '',
    vinDecoded: false,
    vinDecodeLoading: false,
    vinDecodeError: null,
    _lastDecodedVin: null,
    decodedYmmt: null,
    manuallyEdited: false,
    extraMakes: [],
    extraModels: [],
    extraTrims: [],
  };
}

/**
 * CrossSellSubFlow — the embed body. Renders the insurance or refi
 * workflow with onComplete wiring back to the form slots.
 *
 * Wave 17 P1-fu — When the upstream protection vehicle has no 17-char
 * VIN (protection's wizard intentionally allows YMMT-only entry per
 * "VIN OR manual YMMT" canon decision), we render a VIN-collection
 * pre-step BEFORE the workflow-specific embed. EI origination
 * (insurance) and refi prequal both require a VIN downstream, so
 * collecting it here prevents the cross-sell from punting to a Confirm-
 * contact form for a vehicle the partner can't actually quote.
 *
 * The committed VIN+YMMT is merged back into the cross-sell-local form
 * slice and passed to InsuranceMiniFlow / RefiMiniFlow so their
 * canonical-vehicle / prefilledForm builders pick up the VIN. When the
 * embedder (protection-portal AgentView CrossSellPane → mc CoPilotPane)
 * passes onVehicleCommitted, we forward the committed vehicle so mc's
 * left "Vehicle" pane reflects the new VIN immediately.
 */
export function CrossSellSubFlow({
  workflow,
  form,
  onComplete,
  onCancel,
  persona = 'consumer',
  personaLocked = true,
  // Wave 17 P1-fu — optional wire-back to mc. Mirrors the contract
  // protection-portal's AgentView already exposes (Wave 16 F2-fu11)
  // and insurance-portal's AgentView (Wave 16 F2-fu12-insurance):
  // fired once when the pre-step commits a vehicle locally so mc's
  // CoPilotPane can patch the canonical contact.vehicles entry. Idempotent
  // by design — mc's handler dedupes by id (xs_vin_<VIN> | xs_ymmt_...).
  // Standalone callers (protection-portal CustomerView, App.jsx) leave
  // undefined and the observer below becomes a no-op.
  onVehicleCommitted,
}) {
  // ── VIN-collection pre-step gate ────────────────────────────────────
  // The vehicle we evaluate is the committed snapshot at form.vehicle if
  // protection's own wizard wrote one; otherwise the flat YMMT slots that
  // VehicleAdd populates pre-commit. VIN may live on either the flat
  // form.vin (during VehicleAdd entry) or form.vehicle.vin (post-commit).
  const upstreamVin = form?.vehicle?.vin || form?.vin || null;
  const vehicleHasVin = Boolean(upstreamVin && upstreamVin.length === 17);

  const [vehicleForm, setVehicleForm] = useState(() =>
    buildInitialCrossSellVehicleForm(form),
  );
  const [collectedVehicle, setCollectedVehicle] = useState(null);
  const updateVehicleForm = (patch) =>
    setVehicleForm((prev) => ({ ...prev, ...patch }));

  // Wire-back observer — mirrors protection-portal/src/views/agent/AgentView.jsx
  // Wave 16 F2-fu11 + insurance-portal AgentView Wave 16 F2-fu12-insurance.
  // Fires once when the local pre-step commits, with a deterministic id so
  // mc's dedupe is stable. Skipped entirely when the embedder didn't pass
  // onVehicleCommitted (consumer/standalone callers).
  useEffect(() => {
    if (typeof onVehicleCommitted !== 'function') return;
    if (!collectedVehicle) return;
    const v = collectedVehicle;
    const hasYmmt = v.year && v.make && v.model && v.trim;
    if (!hasYmmt && !v.vin) return;
    const id = v.vin
      ? `xs_vin_${v.vin}`
      : `xs_ymmt_${v.year}_${(v.make || '').replace(/\s+/g, '_')}_${(v.model || '').replace(/\s+/g, '_')}_${(v.trim || '').replace(/\s+/g, '_')}`;
    onVehicleCommitted({
      id,
      year: v.year ?? null,
      make: v.make || '',
      model: v.model || '',
      trim: v.trim || '',
      vin: v.vin || null,
      source: v.vin ? 'vin' : 'manual',
    });
  }, [
    onVehicleCommitted,
    collectedVehicle,
    collectedVehicle?.vin,
    collectedVehicle?.year,
    collectedVehicle?.make,
    collectedVehicle?.model,
    collectedVehicle?.trim,
  ]);

  function commitVehicleAndAdvance() {
    // Merge upstream YMMT (from protection wizard) with locally-collected
    // VIN/YMMT — mirrors insurance AgentView's commitVehicle (Wave 16 F2-fu10).
    // The pre-step's auto-fill under requireVin=true normally leaves
    // vehicleForm.{year,make,model,trim} populated, but if a decode
    // returned partial data we still want the upstream YMMT to win as a
    // fallback rather than forwarding null/empty.
    const upstreamVehicle = form?.vehicle || {};
    const v = {
      vin: vehicleForm.vin || null,
      year: vehicleForm.year ?? upstreamVehicle.year ?? form?.year ?? null,
      make: vehicleForm.make || upstreamVehicle.make || form?.make || '',
      model: vehicleForm.model || upstreamVehicle.model || form?.model || '',
      trim: vehicleForm.trim || upstreamVehicle.trim || form?.trim || '',
    };
    setCollectedVehicle(v);
  }

  // Effective form for the workflow embed — splices the collected VIN +
  // YMMT into form so InsuranceMiniFlow's toCanonicalVehicle and
  // RefiMiniFlow's prefilledForm pick up the VIN without each having to
  // reach into vehicleForm separately.
  const effectiveForm = useMemo(() => {
    if (!collectedVehicle) return form;
    return {
      ...form,
      vin: collectedVehicle.vin || form?.vin,
      year: collectedVehicle.year ?? form?.year,
      make: collectedVehicle.make || form?.make,
      model: collectedVehicle.model || form?.model,
      trim: collectedVehicle.trim || form?.trim,
      vehicle: {
        ...(form?.vehicle || {}),
        vin: collectedVehicle.vin || form?.vehicle?.vin || null,
        year: collectedVehicle.year ?? form?.vehicle?.year ?? null,
        make: collectedVehicle.make || form?.vehicle?.make || '',
        model: collectedVehicle.model || form?.vehicle?.model || '',
        trim: collectedVehicle.trim || form?.vehicle?.trim || '',
        source: collectedVehicle.vin ? 'vin' : (form?.vehicle?.source || 'manual'),
      },
    };
  }, [form, collectedVehicle]);

  // Pre-step gate: fires when the upstream vehicle has no 17-char VIN AND
  // we haven't yet locally committed one. Identical predicate shape to
  // insurance-portal AgentView's needsVehicleStep (Wave 16 F2-fu10).
  const needsVehicleStep = !vehicleHasVin && !collectedVehicle;
  if (needsVehicleStep) {
    return (
      <div className="space-y-3">
        <WizardShell stepIndex={1} stepTotal={2} progress={50}>
          <VehicleAddOrConfirm
            form={vehicleForm}
            update={updateVehicleForm}
            onNext={commitVehicleAndAdvance}
            requireVin
            telemetryPrefix="protection.crosssell.vehicle_add"
          />
        </WizardShell>
        <div className="text-right">
          <button
            onClick={onCancel}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (workflow === 'insurance') {
    return (
      <InsuranceMiniFlow
        form={effectiveForm}
        onComplete={onComplete}
        onCancel={onCancel}
        persona={persona}
        personaLocked={personaLocked}
      />
    );
  }
  if (workflow === 'refi') {
    return (
      <RefiMiniFlow
        form={effectiveForm}
        onComplete={onComplete}
        onCancel={onCancel}
        persona={persona}
        personaLocked={personaLocked}
      />
    );
  }
  return null;
}

// ============================================================================
// Insurance mini-flow — confirm contact + DOB gate + EI lead origination
// (via insurance-portal's public AgentView) + auto-complete on quote.
// ============================================================================

// Build a canonical mission-control contact record from protection-portal's
// flat form.contact. AgentView's `contact` prop expects:
//   { id, name: { first, last }, emails: [{ address, is_primary }],
//     phones: [{ number, is_primary }] }
// — see insurance-portal/src/views/agent/index.js prop docstring.
function toCanonicalContact(local) {
  const phoneE164 =
    local?.phone && /^\d{10}$/.test(String(local.phone))
      ? `+1${local.phone}`
      : (local?.phone || null);
  return {
    id: local?.id || `xs_${Date.now()}`,
    name: {
      first: local?.first_name || '',
      last: local?.last_name || '',
    },
    emails: local?.email
      ? [{ address: local.email, is_primary: true }]
      : [],
    phones: phoneE164
      ? [{ number: phoneE164, is_primary: true }]
      : [],
    date_of_birth: local?.date_of_birth || null,
  };
}

// Canonical vehicle for AgentView's `vehicle` prop. Same shape as the
// mission-control vehicle record consumed by LeadOriginationForm.
function toCanonicalVehicle(local) {
  if (!local?.vehicle && !(local?.year && local?.make && local?.model)) return null;
  const v = local.vehicle || {};
  return {
    id: v.id || `xs_${Date.now()}`,
    year: v.year ?? local.year,
    make: v.make ?? local.make,
    model: v.model ?? local.model,
    trim: v.trim ?? local.trim,
    vin: v.vin || local.vin || null,
    source: v.source || (local.vin ? 'vin' : 'manual'),
  };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dobIsValid(s) {
  if (!s || !ISO_DATE_RE.test(s)) return false;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  // Must be at least 18 years old and at most 110 — sane bounds for
  // an insurance applicant.
  const minAge = new Date(now.getFullYear() - 110, now.getMonth(), now.getDate());
  const maxAge = new Date(now.getFullYear() - 18, now.getMonth(), now.getDate());
  return d >= minAge && d <= maxAge;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function InsuranceMiniFlow({ form, onComplete, onCancel, persona, personaLocked }) {
  // Step machine:
  //   'confirm'   — confirm contact + DOB + flowPath, gate on validation
  //   'originate' — AgentView mounted; user clicks Generate + Send and
  //                 watches the timeline; auto-completes on
  //                 quote.completed with savings.
  const [step, setStep] = useState('confirm');

  // Local editable copies of contact fields, seeded from form.contact.
  const [firstName, setFirstName] = useState(form.contact?.first_name || '');
  const [lastName, setLastName] = useState(form.contact?.last_name || '');
  const [email, setEmail] = useState(form.contact?.email || '');
  const [phone, setPhone] = useState(form.contact?.phone || '');
  const [dob, setDob] = useState(form.contact?.date_of_birth || '');
  const [flowPath, setFlowPath] = useState('capture_and_quote');

  // Local workflow state for the embedded insurance lead. AgentView
  // owns no internal state — parent supplies workflow + updateWorkflow.
  // tags / notes / tagsCreated arrays seeded so NotesPanel doesn't
  // null-guard. flowPath is NOT seeded here — it's merged from the
  // top-level `flowPath` setting in the prop derivation below until
  // origination lands; once createLead returns, AgentView writes
  // flowPath into workflow itself and that wins.
  const [workflow, setWorkflow] = useState({
    status: 'not_started',
    notes: '',
    tags: [],
    tagsCreated: [],
  });
  const updateWorkflow = (patch) =>
    setWorkflow((w) => ({ ...w, ...patch }));

  // DEV outcomes — only the EI-mock outcome knobs need to live on local
  // state. flowPath is derived from the segmented control above.
  const [devOutcomes, setDevOutcomes] = useState({
    nextVerificationOutcome: 'completed',
    nextQuoteOutcome: 'completed',
  });
  // updateDev intentionally drops any flowPath patch — flowPath is
  // derived from the segmented control above, not local dev state.
  // Other knobs (nextVerificationOutcome, nextQuoteOutcome) flow
  // through.
  const updateDev = (patch) =>
    setDevOutcomes((d) => {
      const { flowPath: _ignored, ...rest } = patch || {};
      return { ...d, ...rest };
    });
  // Compose the prop AgentView + InsuranceDevControls expect.
  const dev = useMemo(
    () => ({
      flowPath: workflow.flowPath || flowPath,
      ...devOutcomes,
    }),
    [flowPath, workflow.flowPath, devOutcomes],
  );
  // Compose the workflow prop with the live flowPath merged in — so
  // LeadOriginationForm's `workflow.flowPath || form.flowPath` picks up
  // the user's pick before lead origination. After origination,
  // workflow.flowPath is set internally and wins.
  const workflowForAgent = useMemo(
    () => ({ ...workflow, flowPath: workflow.flowPath || flowPath }),
    [workflow, flowPath],
  );

  // Build canonical contact / vehicle for AgentView, recomputed when
  // the user edits inline. Memoized on the relevant inputs so AgentView
  // doesn't churn its useForm seed every keystroke (the prefill
  // memoizes on contact?.id / vehicle?.id, so we keep the id stable).
  // useState (lazy-init) gives us a stable id without ref-during-render
  // lint pain.
  const [stableContactId] = useState(() => `xs_${Date.now()}`);
  const [stableVehicleId] = useState(() => `xs_v_${Date.now()}`);
  const canonicalContact = useMemo(
    () => ({
      ...toCanonicalContact({
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        date_of_birth: dob,
      }),
      id: stableContactId,
    }),
    [firstName, lastName, email, phone, dob, stableContactId],
  );
  const canonicalVehicle = useMemo(() => {
    const v = toCanonicalVehicle(form);
    if (!v) return null;
    return { ...v, id: stableVehicleId };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.vehicle, form.year, form.make, form.model, form.trim, form.vin, stableVehicleId]);

  // Validation — gates the "Generate insurance link" CTA.
  const errors = useMemo(() => {
    const e = {};
    if (!firstName.trim()) e.firstName = 'Required';
    if (!lastName.trim()) e.lastName = 'Required';
    if (!email.trim() || !EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email';
    const phoneDigits = String(phone).replace(/\D/g, '');
    if (phoneDigits.length !== 10) e.phone = 'Enter a 10-digit phone';
    if (!dob) e.dob = 'Required for insurance underwriting';
    else if (!dobIsValid(dob)) e.dob = 'Enter a valid birthdate (18+)';
    return e;
  }, [firstName, lastName, email, phone, dob]);
  const canContinue = Object.keys(errors).length === 0;

  function handleContinue() {
    if (!canContinue) return;
    track('protection.cross_sell.insurance_contact_confirmed', {
      persona,
      flow_path: flowPath,
      had_dob_on_entry: !!form.contact?.date_of_birth,
      collected_dob_inline: !form.contact?.date_of_birth && !!dob,
    });

    // Wave 17 P1-fu2 — F6 deleted the embedded LeadOriginationForm but
    // never moved its createLead + onSend handlers into the embedder.
    // Without flipping consumer_link.sentAt, insurance AgentView's
    // isLinkSent gate (AgentView.jsx:272) stays false and the
    // showOriginationForm={false} branch returns null → blank pane.
    //
    // Prototype-grade simulation: inline the EI mock pipeline (mirrors
    // insurance-portal LeadOriginationForm.jsx createLead :266-323 and
    // onSend :325-356) so the post-send branch (ConsumerLinkPanel +
    // LeadStatusTimeline + InsuranceDevControls) lights up with a fully
    // populated workflow. The InsuranceDevControls simulator then drives
    // verification.completed → quote.completed against the lead's
    // synthetic leadId. Replace with a public-export of insurance-portal's
    // createLead (Option 2) when that lands.
    const leadId = `xs_lead_${Date.now().toString(36)}`;
    const partnerExternalId = `xs_blinkerExt_${Date.now().toString(36)}`;
    const sentAtIso = new Date().toISOString();
    const link = {
      url: `https://insurance.blinker.com/quote/${leadId}`,
      token: leadId,
      generatedAt: sentAtIso,
      sentAt: sentAtIso,
    };
    // Lead shape mirrors insurance-portal createLead resolve()
    // (embedded-insurance-mock.js :158 → { leadId, partnerExternalId }).
    // flowPath stored on workflow alongside (LeadOriginationForm.jsx :287
    // updateWorkflow({ lead, status: LEAD_CREATED })) is what AgentView
    // and the timeline read.
    const lead = { leadId, partnerExternalId };
    // Status taxonomy: capture_link.sent / quote_link.sent — canon
    // ghl-status.json#insurance.statuses; same pair LeadOriginationForm
    // writes on send (linkSentStatus :86-90, applied :352).
    const status =
      flowPath === 'quote_only' ? 'quote_link.sent' : 'capture_link.sent';

    setWorkflow((prev) => ({
      ...prev,
      lead,
      consumer_link: link,
      flowPath,
      status,
    }));

    // Telemetry — protection-portal embedder spine + the two insurance
    // events the embedded LeadOriginationForm would have fired itself
    // (captureEvent('insurance_consumer_link_created') :316,
    //  captureEvent('insurance_consumer_link_sent') :342).
    track('protection.cross_sell.insurance_link_sent', {
      persona,
      flow_path: flowPath,
      lead_id: leadId,
    });
    track('insurance_consumer_link_created', {
      lead_id: leadId,
      flow_path: flowPath,
      persona,
    });
    track('insurance_consumer_link_sent', {
      lead_id: leadId,
      flow_path: flowPath,
      channels: ['sms', 'email'],
      persona,
    });

    setStep('originate');
  }

  // Wave 31b-fu6 — Subscribe to EI mock webhooks for the synthetic lead.
  // LeadOriginationForm.jsx:295-303 sets up this subscription as part of
  // its createLead flow; the inlined lead creation at handleContinue()
  // (the "Generate insurance link" block, ~line 542) didn't replicate it.
  // Without this, simulator-driven webhooks (verification.completed,
  // quote.completed, etc.) deliver into the void — the envelope is fired
  // but no callback runs, so workflow.status never advances past
  // capture_link.sent and the downstream simulator buttons stay enabled
  // with no visible state change.
  //
  // Subscribe when leadId is first set; tear down on change/unmount.
  useEffect(() => {
    const leadId = workflow?.lead?.leadId;
    if (!leadId) return undefined;
    const unsub = subscribeWebhooks(leadId, (envelope) => {
      applyWebhookEvent(envelope, updateWorkflow);
    });
    return () => {
      try { unsub?.(); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow?.lead?.leadId]);

  // Watch for quote.completed with savings → fire onComplete with
  // populated insuranceSavings. Once-fired guard: completedRef stops
  // a quote.viewed re-render from re-firing onComplete.
  const completedRef = useRef(false);
  useEffect(() => {
    if (completedRef.current) return;
    if (workflow?.status !== 'quote.completed') return;
    const payload = workflow?.quote?.payload;
    if (!payload) return;

    const savings = Number(payload.savingsAmountCents || 0);
    const totalPremium = Number(payload.totalPremiumCents || 0);
    const carrier = payload.carrier || 'Geico';
    const captureCarrier =
      workflow?.capture?.verification?.policyInfo?.carrier ||
      workflow?.capture?.verification?.carrier ||
      null;

    // Only fire onComplete when there are real savings to apply against
    // the protection plan. Quote Only path may return null savings —
    // in that case we just leave the timeline running and let the user
    // manually cancel out (Skip insurance) without applying savings.
    if (savings > 0) {
      completedRef.current = true;
      // 6-month period assumption per architecture/06.
      const monthlySavingsCents = Math.round(savings / 6);
      track('protection.cross_sell.insurance_completed', {
        persona,
        flow_path: workflow.flowPath || flowPath,
        monthly_savings_cents: monthlySavingsCents,
        carrier,
        capture_carrier: captureCarrier,
      });
      onComplete?.({
        insuranceSavings: {
          monthlySavingsCents,
          savingsAmountCents: savings,
          totalPremiumCents: totalPremium,
          captureCarrier,
          newCarrier: carrier,
          quoteId: payload.id,
          flowPath: workflow.flowPath || flowPath,
          source: 'protection_cross_sell_ei_lead',
        },
      });
    }
  }, [workflow?.status, workflow?.quote?.payload, workflow?.capture, workflow?.flowPath, flowPath, onComplete, persona]);

  if (step === 'confirm') {
    return (
      <div className="space-y-3">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 pt-5 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2 text-emerald-600 mb-2">
              <ShieldCheck className="w-4 h-4" />
              <span className="text-xs uppercase tracking-wide font-semibold">
                Insurance · Find savings
              </span>
            </div>
            <h2 className="text-xl font-semibold tracking-tight">Confirm your contact details</h2>
            <p className="text-sm text-slate-500 mt-1">
              We'll send you a one-time link to a secure insurance quote.
              Pick the flow path, confirm the basics, and we'll do the rest.
            </p>
          </div>

          <div className="px-6 py-5 space-y-4">
            <FlowPathPicker value={flowPath} onChange={setFlowPath} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <LabeledInput
                label="First name"
                icon={User}
                value={firstName}
                onChange={setFirstName}
                error={errors.firstName}
              />
              <LabeledInput
                label="Last name"
                icon={User}
                value={lastName}
                onChange={setLastName}
                error={errors.lastName}
              />
            </div>

            <LabeledInput
              label="Email"
              icon={Mail}
              value={email}
              onChange={setEmail}
              placeholder="name@example.com"
              error={errors.email}
            />

            <LabeledInput
              label="Phone"
              icon={Phone}
              value={phone}
              onChange={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))}
              placeholder="5125550199"
              error={errors.phone}
              inputMode="numeric"
            />

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold flex items-center gap-1">
                  <Cake className="w-3 h-3" /> Date of birth
                </label>
                {!form.contact?.date_of_birth && (
                  <span className="text-[10px] uppercase tracking-wide text-amber-700 font-semibold">
                    Required for insurance
                  </span>
                )}
              </div>
              <input
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                className={
                  'w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:border-blue-400 ' +
                  (errors.dob ? 'border-rose-300 bg-rose-50' : 'border-slate-200')
                }
                max={new Date(new Date().getFullYear() - 18, 0, 1).toISOString().slice(0, 10)}
              />
              {errors.dob && (
                <div className="text-xs text-rose-700 mt-1">{errors.dob}</div>
              )}
            </div>
          </div>

          <div className="px-6 pb-5 pt-4 flex items-center justify-between border-t border-slate-100">
            <button
              onClick={onCancel}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
            <button
              onClick={handleContinue}
              disabled={!canContinue}
              className={
                'px-5 py-2 rounded-md font-semibold text-sm ' +
                (canContinue
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed')
              }
            >
              Generate insurance link
            </button>
          </div>
        </div>
      </div>
    );
  }

  // step === 'originate' — AgentView (LeadOriginationForm + timeline +
  // notes) wired to local workflow state. InsuranceDevControls drives
  // the EI mock chain so the timeline animates through verification →
  // quote without us needing the real partner.
  const showSimulator =
    !!workflow?.lead?.leadId &&
    workflow?.status !== 'quote.completed' &&
    workflow?.status !== 'quote.viewed' &&
    workflow?.status !== 'policy.bound';

  return (
    <div className="space-y-3">
      <AgentView
        workflow={workflowForAgent}
        updateWorkflow={updateWorkflow}
        dev={dev}
        contact={canonicalContact}
        vehicle={canonicalVehicle}
        persona={persona}
        personaLocked={personaLocked}
        mode="lean" // mode="lean" — Wave 13-fu-2 — suppresses NotesPanel + single-column post-send for consumer cross-sell context
        showOriginationForm={false} // Wave 16 F6 — CrossSellSubFlow's own Confirm-contact step (the kept form) precedes this; the embedded LeadOriginationForm here would be a redundant duplicate.
      />

      {showSimulator && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">
            Demo · simulate consumer journey
          </div>
          <p className="text-xs text-slate-500 mb-3 leading-relaxed">
            In production these progress automatically as the consumer
            navigates the partner microsite. For the prototype, drive the
            EI mock from here to advance the timeline.
          </p>
          <InsuranceDevControls
            dev={dev}
            updateDev={updateDev}
            workflow={workflowForAgent}
            updateWorkflow={updateWorkflow}
          />
        </div>
      )}

      <div className="text-right">
        <button
          onClick={onCancel}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          Skip insurance
        </button>
      </div>
    </div>
  );
}

// Tiny presentational helpers used only by the confirm step. Keeping
// them local avoids dragging in shared/FormFields.jsx (which is fine,
// just unnecessary for this short-lived form).

function FlowPathPicker({ value, onChange }) {
  const opts = [
    { v: 'capture_and_quote', l: 'Capture + Quote', sub: 'Preferred · partner captures current policy & computes savings' },
    { v: 'quote_only',        l: 'Quote Only',      sub: 'Skip the policy capture — savings comparison may not be available' },
  ];
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1">
        Flow path
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {opts.map((o) => {
          const active = value === o.v;
          return (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange(o.v)}
              className={
                'text-left px-3 py-2 rounded-md border transition ' +
                (active
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-200 hover:border-slate-300 bg-white')
              }
            >
              <div className={'text-xs font-semibold ' + (active ? 'text-blue-700' : 'text-slate-700')}>
                {o.l}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{o.sub}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LabeledInput({ label, icon: Icon, value, onChange, placeholder, error, inputMode }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1 flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />} {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className={
          'w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:border-blue-400 ' +
          (error ? 'border-rose-300 bg-rose-50' : 'border-slate-200')
        }
      />
      {error && <div className="text-xs text-rose-700 mt-1">{error}</div>}
    </div>
  );
}

// ============================================================================
// Refi mini-flow — RefiSubFlow (step-by-step wizard) + co-applicant
// decision step + result-branching cards.
// ============================================================================

// Strip a leading "+1" or "1" country prefix from a US phone number.
// Mirror of refi-portal/src/views/customer/RefiSubFlow.jsx's stripPlusOne
// (kept local because crossing the seam for a 4-line helper isn't worth
// a public-export bump). Phone shape comes from the canonical mission-
// control household member contract: phones[].number may include "+1".
function stripPlusOne(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits.slice(0, 10);
}

// Display name for a household member. Handles both the canonical
// mission-control shape (`name.first` / `name.last`) and the local
// flat shape used by buildMockHousehold (DEV CONTROLS toggle).
function memberDisplayName(member) {
  if (!member) return '';
  const first = member.name?.first || member.first_name || '';
  const last = member.name?.last || member.last_name || '';
  const full = `${first} ${last}`.trim();
  return full || member.email || 'household member';
}

function RefiMiniFlow({ form, onComplete, onCancel, persona, personaLocked }) {
  const householdMembers = Array.isArray(form.contact?.household_members)
    ? form.contact.household_members
    : [];
  const hasHouseholdMembers = householdMembers.length > 0;

  // step state machine — see header doc.
  //   'co_app_decision' | 'subflow' | 'result_pre_approved' |
  //   'result_offers' | 'result_disqualified' | 'result_pending'
  // Initial: 'co_app_decision' only when there's at least one household
  // member to offer; otherwise skip straight to 'subflow'.
  const [step, setStep] = useState(
    hasHouseholdMembers ? 'co_app_decision' : 'subflow'
  );
  const [coApplicant, setCoApplicant] = useState(null);
  const [decision, setDecision] = useState(null);

  // Plan total drives the principal for protectionPlanMonthlyOnRefi.
  // Phase 1 simplification: planTotal === loanPrincipal. Phase 2 lifts
  // vehicle payoff into the equation.
  const planTotal = form.selectedPlan?.total_cost || 0;

  // Org-config drives the financing parameters.
  const orgFinancing = useMemo(() => {
    const orgConf = orgRegistry.orgs.find((o) => o.id === form.org_id);
    return (
      orgConf?.cross_sell?.protection_plan_financing || {
        default_apr: 0.0899,
        default_term_months: 60,
      }
    );
  }, [form.org_id]);

  // Build the prefilledForm RefiSubFlow expects (flat refi shape) from
  // protection-portal's wizard form. Computed once per render — cheap
  // shallow copy of scalar fields.
  const prefilledForm = useMemo(
    () => ({
      firstName: form.contact?.first_name || '',
      lastName: form.contact?.last_name || '',
      email: form.contact?.email || '',
      phone: form.contact?.phone || '',
      address: form.contact?.address1 || '',
      city: form.contact?.city || '',
      state: form.contact?.state || '',
      zip: form.contact?.zip || '',
      org_id: form.org_id,
      vin: form.vin || form.vehicle?.vin || '',
      year: form.year ?? form.vehicle?.year ?? null,
      make: form.make || form.vehicle?.make || '',
      model: form.model || form.vehicle?.model || '',
      trim: form.trim || form.vehicle?.trim || '',
      mileage: form.mileage,
      condition: form.condition || 'Used',
    }),
    [
      form.contact,
      form.org_id,
      form.vin,
      form.vehicle,
      form.year,
      form.make,
      form.model,
      form.trim,
      form.mileage,
      form.condition,
    ]
  );

  // Build the canonical co-applicant payload RefiSubFlow expects.
  // Source shape is the mission-control "household member" full-contact
  // record (name.first, emails[], phones[]). When the chosen member is
  // a flat-shape DEV-mock entry, name.first / emails / phones are
  // undefined and we pass empty strings — RefiSubFlow handles that
  // gracefully (s1_co_app_decision still lands pre-selected, downstream
  // contact screen lands empty for the consumer to fill in).
  const coApplicantPayload = useMemo(() => {
    if (!coApplicant) return null;
    const primaryEmail =
      (Array.isArray(coApplicant.emails) &&
        (coApplicant.emails.find((e) => e?.is_primary) ||
          coApplicant.emails[0])) ||
      null;
    const primaryPhone =
      (Array.isArray(coApplicant.phones) &&
        (coApplicant.phones.find((p) => p?.is_primary) ||
          coApplicant.phones[0])) ||
      null;
    return {
      first_name: coApplicant.name?.first || '',
      last_name: coApplicant.name?.last || '',
      email: primaryEmail?.address || '',
      phone: stripPlusOne(primaryPhone?.number) || '',
      relationship: coApplicant.relationship || '',
    };
  }, [coApplicant]);

  function handleChooseCoApp(member) {
    setCoApplicant(member);
    track('protection.cross_sell.refi_co_app_chosen', {
      persona,
      included: true,
      member_name: memberDisplayName(member),
    });
    setStep('subflow');
  }

  function handleSkipCoApp() {
    track('protection.cross_sell.refi_co_app_chosen', {
      persona,
      included: false,
      member_name: '',
    });
    setCoApplicant(null);
    setStep('subflow');
  }

  function handlePrequalComplete(d) {
    setDecision(d);
    track('protection.cross_sell.refi_prequal_decision', {
      persona,
      result: d.result,
      partner: d.partner,
      reason: d.reason,
    });
    if (d.result === 'pre_approved') setStep('result_pre_approved');
    else if (d.result === 'offers_returned') setStep('result_offers');
    else if (d.result === 'pending') setStep('result_pending');
    else setStep('result_disqualified');
  }

  function applyRefiOffer(decisionForOffer, offer) {
    // protectionPlanPortionCents — the AFFORDABILITY math model.
    const apr = offer?.apr != null ? offer.apr / 100 : orgFinancing.default_apr;
    const termMonths = offer?.term || orgFinancing.default_term_months;
    const monthlyDollars = protectionPlanMonthlyOnRefi({
      planTotal,
      loanPrincipal: planTotal,
      apr,
      termMonths,
    });
    const protectionPlanPortionCents = Math.round(monthlyDollars * 100);
    const refiOffer = {
      apr,
      termMonths,
      loanPrincipalCents: Math.round(planTotal * 100),
      protectionPlanPortionCents,
      partner: decisionForOffer.partner,
      partnerName: decisionForOffer.partnerName,
      externalApplicationId: decisionForOffer.externalApplicationId,
      offerId: offer?.id || null,
      prequalApprovedAt: new Date().toISOString(),
      source: 'refi_prequal',
    };
    track('protection.cross_sell.refi_completed', {
      persona,
      apr,
      term_months: termMonths,
      protection_plan_portion_cents: protectionPlanPortionCents,
      partner: decisionForOffer.partner,
    });
    onComplete?.({ refiOffer });
  }

  // ── Step: co-applicant decision ────────────────────────────────────
  // Multi-member picker is out of scope for Phase 1; if more than one
  // member is on file, we offer the first and note "+N more available".
  if (step === 'co_app_decision') {
    const member = householdMembers[0];
    const memberName = memberDisplayName(member);
    const memberFirst =
      member?.name?.first || member?.first_name || memberName.split(' ')[0];
    const primaryFirst = form.contact?.first_name || 'primary applicant';
    const extraCount = householdMembers.length - 1;
    return (
      <div className="space-y-3">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 pt-5 pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2 text-blue-600 mb-2">
              <Users className="w-4 h-4" />
              <span className="text-xs uppercase tracking-wide font-semibold">
                Refinance · Co-applicant
              </span>
            </div>
            <h2 className="text-xl font-semibold tracking-tight">
              Add a co-applicant?
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              {memberFirst} is a household member. Would you like to include
              them as a co-applicant on this refinance application?
              Including a co-applicant can improve approval odds and rate.
            </p>
          </div>
          <div className="px-6 py-4">
            <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
              <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-1">
                Suggested co-applicant
              </div>
              <div className="text-sm font-semibold text-slate-800">
                {memberName}
              </div>
              {extraCount > 0 && (
                <div className="text-[11px] text-slate-500 mt-1">
                  +{extraCount} more available
                </div>
              )}
            </div>
          </div>
          <div className="px-6 pb-5 pt-2 flex flex-col gap-2">
            <button
              onClick={() => handleChooseCoApp(member)}
              className="px-5 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm"
            >
              Yes, include {memberFirst}
            </button>
            <button
              onClick={handleSkipCoApp}
              className="px-5 py-2 rounded-md border border-slate-200 hover:border-slate-300 text-slate-700 font-semibold text-sm"
            >
              No, just {primaryFirst}
            </button>
          </div>
        </div>
        <div className="text-right">
          <button
            onClick={onCancel}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Step: subflow (RefiSubFlow wizard) ─────────────────────────────
  if (step === 'subflow') {
    return (
      <div className="space-y-3">
        <RefiSubFlow
          prefilledForm={prefilledForm}
          coApplicant={coApplicantPayload}
          onComplete={handlePrequalComplete}
          onCancel={onCancel}
          persona={persona}
          personaLocked={personaLocked}
        />
        <div className="text-right">
          <button
            onClick={onCancel}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Result branching ───────────────────────────────────────────────
  if (step === 'result_pre_approved' && decision) {
    return (
      <div className="space-y-3">
        <QualifiedCard
          persona={persona}
          personaLocked={personaLocked}
          partnerName={decision.partnerName}
          partnerPhone={decision.partnerPhone}
          externalApplicationId={decision.externalApplicationId}
          onContinue={() => applyRefiOffer(decision, null)}
        />
        <div className="text-right">
          <button
            onClick={onCancel}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            Skip refinance
          </button>
        </div>
      </div>
    );
  }

  if (step === 'result_offers' && decision) {
    // RefiSubFlow.onComplete surfaces the offers array directly (same
    // payload shape as PrequalForm), so we forward it straight into
    // OffersCard. Per-offer apr/term drives applyRefiOffer's
    // protectionPlanPortionCents math.
    const offers = decision.offers || [];
    return (
      <div className="space-y-3">
        <OffersCard
          persona={persona}
          personaLocked={personaLocked}
          offers={offers}
          partnerName={decision.partnerName}
          partnerPhone={decision.partnerPhone}
          onSelect={(offer) => applyRefiOffer(decision, offer)}
        />
        <div className="text-right">
          <button
            onClick={onCancel}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            Skip refinance
          </button>
        </div>
      </div>
    );
  }

  if (step === 'result_pending' && decision) {
    return (
      <div className="space-y-3">
        <PendingCard
          persona={persona}
          personaLocked={personaLocked}
          partnerName={decision.partnerName}
          partnerPhone={decision.partnerPhone}
          onContinue={onCancel}
        />
      </div>
    );
  }

  // step === 'result_disqualified' (or unknown). Inline render — see
  // DISQUAL_REASONS import note above for why we don't use refi-portal's
  // public DisqualifiedCard today. Decision is guaranteed populated here
  // because the only way to reach result_disqualified is through
  // handlePrequalComplete().
  if (step === 'result_disqualified' && decision) {
    void personaLocked;
    const reasonEntry = decision.reason && DISQUAL_REASONS[decision.reason]
      ? DISQUAL_REASONS[decision.reason]
      : null;
    const title = reasonEntry ? reasonEntry.title : 'Not eligible to refinance';
    const msg = reasonEntry
      ? reasonEntry.msg
      : "We weren't able to match a refinance partner with the information provided.";

    return (
      <div className="space-y-3">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wide">Refinance · Not Eligible</div>
              <div className="font-semibold text-lg">{decision.partnerName || 'Refinance partner'}</div>
            </div>
            <span className="text-xs font-semibold px-2 py-1 rounded border bg-rose-100 text-rose-700 border-rose-200">
              Not Eligible
            </span>
          </div>
          <div className="px-6 py-5">
            <div className="border border-rose-100 bg-rose-50 rounded-lg p-4 mb-4">
              <div className="flex items-center gap-2 text-rose-800 font-semibold">
                <XCircle className="w-4 h-4" /> {title}
              </div>
              <p className="text-sm text-rose-900 mt-1">{msg}</p>
            </div>
            <button
              onClick={onCancel}
              className="w-full px-3 py-2 border border-slate-200 hover:border-blue-500 hover:text-blue-700 text-slate-700 text-sm rounded-md font-semibold"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Defensive fallback — unreachable under the documented step machine.
  return null;
}

// Default export so React.lazy() can pick this up directly without a
// re-import wrapper. Named export preserved for any callers that use
// the static import (none today; both call sites lazy-load via the
// default export).
export default CrossSellSubFlow;

// WORKFLOW_ICONS moved to ./CrossSellChrome.jsx — see header note.
