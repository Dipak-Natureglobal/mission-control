// Customer view container — owns the wizard state, the step list, and the
// per-screen routing. Each step is a self-contained file under views/customer/
// and gets {form, update, onNext} so they can be lifted as-is from the
// refi prototype's substrate.
//
// Phase 1A complete wizard:
//   vehicle_add → vehicle_drive → vehicle_use → modifications →
//   (garage_location?) → recommended_coverage → (customize?) →
//   confirm → billing_payment → (vin_validate?) → docuseal → thank_you
//
// garage_location now slots BEFORE recommended_coverage (was: after,
// before confirm). Reason: StoneEagle GetRates needs `form.state` to
// quote accurately, and state is collected in GarageLocation. Pre-fix
// the GetRates call fired on VehicleDrive's Continue with state=null →
// rates were either rejected by SE or fell back to a stale state. The
// dispatch now lives on GarageLocation's Continue (see GarageLocation.jsx).
//
// CONTACT · CAPTURE removed (UX feedback 2026-05-04). Contact data flows
// through Confirm + BillingPayment instead:
//   - Agent mode: form.contact.* is prefilled from mission-control's
//     CoPilot session before the wizard mounts (Phase 2 wires the prop
//     thread; Phase 1 leaves contact null on first paint).
//   - Customer mode: name/email/phone collected on BillingPayment with
//     the address (AddressBlock owns address fields).
// vin_validate is conditional: it fires post-payment only when no VIN
// was entered at quote time (form.vehicle.source !== 'vin' AND
// form.vehicle.source !== 'vin_confirmed' AND no VIN on file). Mirrors
// legacy /vin_check route per BlinkerLegacy AUDIT-2026-05-02.md § 2.
//
// AgentView composes this same wizard by importing ProtectionWizard
// directly and passing in its own form / step state — that's how the
// agent shell layers chrome (Save and Send, status overrides, notes,
// View API Responses) without duplicating any customer screens.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useForm } from '../../hooks/useForm.js';
import { WizardShell } from 'blinker-platform/components';
import { VehicleAdd } from './VehicleAdd.jsx';
// VehicleDrive + GarageLocation both pull the refi-portal monolith into
// their module graphs (VehicleDrive imports refi-portal's full
// VehicleDrive view; GarageLocation imports AddressBlock from refi-portal).
// Static imports landed those chunks in the initial bundle; React.lazy
// pushes them to async chunks fetched only when the wizard reaches each
// step. Matches the CrossSellSubFlow pattern (commit 202958c).
const VehicleDrive = lazy(() => import('./VehicleDrive.jsx'));
const GarageLocation = lazy(() => import('./GarageLocation.jsx'));
import { VehicleUse } from './VehicleUse.jsx';
import { Modifications } from './Modifications.jsx';
import { RecommendedCoverage } from './RecommendedCoverage.jsx';
import { Customize } from './Customize.jsx';
// CaptureContact step removed from wizard (UX feedback 2026-05-04).
// File deleted in cleanup follow-up — contact data flows through Confirm
// + BillingPayment instead.
import { Confirm } from './Confirm.jsx';
import { BillingPayment } from './BillingPayment.jsx';
import { VinValidate } from './VinValidate.jsx';
import { RatesChanged } from './RatesChanged.jsx';
import { DocuSeal } from './DocuSeal.jsx';
import { ThankYou } from './ThankYou.jsx';
import { CrossSellBreadcrumb, CrossSellLoading } from './CrossSellChrome.jsx';
import { track } from 'blinker-platform/telemetry';
import { buildMockHousehold } from '../../lib/contact.js';

// CrossSellSubFlow drags in the refi-portal monolith via PrequalForm —
// React.lazy keeps it off the initial bundle. Substep is a URL-driven
// detour (?substep=...) that the customer only hits via cross-sell CTAs
// on RecommendedCoverage, so the small async fetch on first open is fine.
const CrossSellSubFlow = lazy(() => import('./CrossSellSubFlow.jsx'));

const VALID_SUBSTEPS = { 'insurance-savings': 'insurance', 'refi-prequal': 'refi' };

function readSubstepFromUrl() {
  if (typeof window === 'undefined') return null;
  const v = new URLSearchParams(window.location.search).get('substep');
  return VALID_SUBSTEPS[v] ? v : null;
}

function writeSubstepToUrl(substep) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (substep) url.searchParams.set('substep', substep);
  else url.searchParams.delete('substep');
  window.history.pushState({}, '', url.toString());
}

export const INITIAL_FORM = {
  // Org context — drives per-org cross-sell gating on RecommendedCoverage.
  // Default 102 (Apex Auto Solutions) because it's the canonical demo org
  // with both cross_sell flags enabled in canon org-registry.json.
  // Production lifts this from the partner-supplied lead or the agent's
  // org membership; Phase 1 hard-codes the demo org.
  org_id: 102,

  // Vehicle Add
  vin: '',
  vinDecoded: false,
  vinDecodeLoading: false,
  vinDecodeError: null,
  _lastDecodedVin: null,
  decodedYmmt: null,
  manuallyEdited: false,
  year: null,
  make: '',
  model: '',
  trim: '',
  vehicle: null, // { year, make, model, trim, vin, source } — committed by VehicleAdd

  // Vehicle Drive
  mileage: 50000,
  condition: 'Used',
  // purchaseDate is read + written by refi-portal's VehicleDrive when
  // condition === 'Used'. Seeded null so the date input renders empty.
  // The screen itself computes annual_miles from (today - purchaseDate)
  // when present, falling back to mileage / vehicle_age when blank.
  purchaseDate: null,
  state: null,

  // MarketCheck (mock client) — populated by VehicleDrive's wrapper
  // effect once year+make+model are known. The canonical persisted
  // value lives at form.vehicle.market_value (set in the same patch);
  // these slots are the loading/error UI state + the raw mock response
  // (super_admin View API Responses surface).
  marketCheck: null,
  marketCheckLoading: false,
  marketCheckError: null,

  // Vehicle Use
  use: null,
  requiresBusinessUse: false,
  // Wave 22 Task 1 — canonical list of `add_on_passthrough` keys the
  // wizard has flagged for cost passthrough on coverage cards. Each
  // entry corresponds to a key in canon plan-mappings.json#add_on_passthrough
  // (e.g. 'business_use', 'enhanced_electronics', 'navigation'). Read by
  // packages/utils/protection-addons.js#triggeredPassthroughKeys to drive
  // PlanCard badge + cost rendering. VehicleUse owns 'business_use';
  // Modifications owns 'enhanced_electronics' and 'navigation'.
  requiredAddOns: [],

  // Modifications
  modifications: [],
  flagAgentReview: false,

  // Coverage
  rates: null,
  selectedPlan: null,
  customizeCriteria: null,
  // Customize step is OPT-IN. RecommendedCoverage's primary CTA
  // ("Continue with this plan") leaves this false → wizard skips
  // straight to confirm. The smaller secondary CTA
  // ("Customize coverage") flips this true and the customize step
  // is inserted into the step list dynamically (see buildSteps).
  customizeRequested: false,

  // Cross-sell results (RecommendedCoverage step). Populated by the
  // sub-flow (consumer) or side pane (agent) after the consumer
  // completes the corresponding embed. Each is independent — set
  // either, neither, or both. The buying-power UI on plan cards
  // reflects whichever are populated.
  //
  // insuranceSavings shape:
  //   { monthlySavingsCents, captureCarrier, newCarrier, quoteId, source }
  // refiOffer shape:
  //   { apr, termMonths, loanPrincipalCents, protectionPlanPortionCents,
  //     prequalApprovedAt, source }
  insuranceSavings: null,
  refiOffer: null,

  // Contact
  // Seeded with the tagging slots so the agent-side TagPicker (NotesPanel)
  // can write applied tag IDs and any session-created user tags without
  // a defensive null-check on every read. household_members is also
  // pre-seeded (empty array) so cross-sell embeds (RefiMiniFlow's co-app
  // decision step) can read length without null-guards. Other contact
  // fields populate lazily — every existing consumer reads via
  // `form.contact || {}` and remains compatible with a populated initial
  // object.
  contact: { tags: [], tagsCreated: [], household_members: [] },

  // Confirm / Payment
  paymentSchedule: null,
  payment: null,

  // VIN validate (post-payment)
  vinValidate: null,

  // VIN validate rates divergence (Wave 25 v3.0.7, ADR 17).
  // vinRates:        second SE GetRates response (VIN-attached); null until VinValidate fires.
  // ratesChangeKind: one of the 8 ADR-17 kind strings; null until classified.
  // opportunityFlags: object of boolean flags threaded to downstream steps + MC inbox.
  vinRates: null,
  ratesChangeKind: null,
  opportunityFlags: {
    vehicle_revised: false,
    rates_changed:   false,
    refunded:        false,
  },

  // Agreements
  docusealCompleted: false,
  signedAt: null,

  // Final
  opportunityId: null,
  completedAt: null,

  status: 'started',
};

export const BASE_STEPS = [
  'vehicle_add',
  'vehicle_drive',
  'vehicle_use',
  'modifications',
  'recommended_coverage',
  // 'garage_location' — conditional, inserted dynamically when
  //   shouldRunGarageLocation(form) is true (i.e., we don't already have
  //   a contact address on file). Slotted BEFORE recommended_coverage so
  //   StoneEagle GetRates (fired on its Continue) has form.state populated.
  // 'customize' — conditional, inserted dynamically when shouldRunCustomize(form)
  //   is true (i.e., user clicked "Customize coverage" on RecommendedCoverage).
  //   Default flow skips straight from recommended_coverage → confirm.
  'confirm',
  'billing_payment',
  // 'vin_validate' — conditional, inserted dynamically when shouldRunVinValidate(form) is true.
  'docuseal',
  'thank_you',
];

// Post-payment VIN check fires when (a) the package was created without a
// VIN, or (b) the VIN entered at quote time wasn't decoded against
// VinAudit (manual-only path). See AUDIT-2026-05-02.md § "Consumer
// /vin_check route".
export function shouldRunVinValidate(form) {
  const v = form.vehicle || {};
  const hasVinOnFile = !!(v.vin || form.vin);
  const sourceUsedVin = v.source === 'vin' || v.source === 'vin_confirmed';
  return !hasVinOnFile || !sourceUsedVin;
}

// RatesChanged step (9c) fires when VinValidate's second SE GetRates call
// returned a forced-rebranch kind (plan_disappeared or
// plan_price_higher_outside_tolerance). VinValidate sets
// form.opportunityFlags.rates_changed=true before calling onNext().
// eslint-disable-next-line react-refresh/only-export-components
export function shouldRunRatesChanged(form) {
  return form.opportunityFlags?.rates_changed === true;
}

// Customize is opt-in: only inserted when the user explicitly clicks the
// "Customize coverage" secondary CTA on RecommendedCoverage, which sets
// form.customizeRequested = true. Default flow skips it.
// eslint-disable-next-line react-refresh/only-export-components
export function shouldRunCustomize(form) {
  return form.customizeRequested === true;
}

// Garage Location asks where the vehicle is garaged so per-state coverage
// availability can be confirmed before checkout. It runs whenever we
// don't already have a usable contact location on file.
//
// Wave 16 F4: skip predicate now keys on zip+city+state, NOT street.
// Street is collected on BillingPayment's AddressBlock anyway; GetRates
// is keyed on (year/make/model/trim/mileage/state) and per-state
// availability only needs zip+city+state to be confirmed. When MC
// contact-prefill threads in zip+city+state from the lead, the step
// short-circuits and the GetRates dispatch falls through to
// RecommendedCoverage's mount useEffect (see that file's GetRates
// fallback). When zip+city+state are all present, we have what we need
// to quote without forcing the user through an extra screen.
// eslint-disable-next-line react-refresh/only-export-components
export function shouldRunGarageLocation(form) {
  if (form.garage_location_started) return true;
  const c = form.contact || {};
  return !(c.zip && c.city && c.state);
}

export function buildSteps(form) {
  let steps = BASE_STEPS;
  // GarageLocation is anchored on recommended_coverage (slotted BEFORE)
  // because GetRates is dispatched from its Continue and needs form.state
  // populated before RecommendedCoverage renders plan cards. Customize is
  // anchored on confirm (slotted BEFORE) so it sits AFTER
  // recommended_coverage when both run. Anchors are decoupled — neither
  // affects the other's index resolution.
  if (shouldRunGarageLocation(form)) {
    const idx = steps.indexOf('recommended_coverage');
    steps = [...steps.slice(0, idx), 'garage_location', ...steps.slice(idx)];
  }
  if (shouldRunCustomize(form)) {
    const idx = steps.indexOf('confirm');
    steps = [...steps.slice(0, idx), 'customize', ...steps.slice(idx)];
  }
  if (shouldRunVinValidate(form)) {
    const idx = steps.indexOf('docuseal');
    steps = [...steps.slice(0, idx), 'vin_validate', ...steps.slice(idx)];
  }
  // rates_changed (Step 9c) is inserted immediately after vin_validate when the
  // classifier returned a forced-rebranch kind. Anchored on docuseal so that
  // when vin_validate is also present, rates_changed slots between them.
  // When vin_validate is NOT in the list (edge: form arrived with rates_changed
  // pre-set), it inserts just before docuseal as a safe fallback.
  if (shouldRunRatesChanged(form)) {
    const anchorIdx = steps.includes('vin_validate')
      ? steps.indexOf('vin_validate') + 1
      : steps.indexOf('docuseal');
    steps = [...steps.slice(0, anchorIdx), 'rates_changed', ...steps.slice(anchorIdx)];
  }
  // When refund or manual-review flow has fired in RatesChanged (Step 9c),
  // skip docuseal so onNext() from rates_changed lands on thank_you.
  // ThankYou already renders both refunded and manual_review_requested variants.
  if (
    form.opportunityFlags?.refunded === true ||
    form.opportunityFlags?.manual_review_requested === true
  ) {
    steps = steps.filter((s) => s !== 'docuseal');
  }
  return steps;
}

// The reusable wizard. Owns no state — caller passes in form + stepIdx
// so that AgentView can read/write the same state from outside the
// wizard (for Save-and-Send, status pill, View API Responses, etc.).
//
// trackPrefix lets the caller namespace events: 'protection.customer'
// when CustomerView mounts it, 'protection.agent' isn't used here
// because the per-screen events are still consumer-driven actions even
// when the agent is co-piloting; agent-shell-driven events live in
// AgentView. Keeping the prefix configurable means we can split later
// if the convention shifts.
export function ProtectionWizard({
  form,
  update,
  stepIdx,
  setStepIdx,
  trackPrefix = 'protection.customer',
  beforeStepChange,
  // Per-screen knobs threaded from the App / DEV CONTROLS. Default to the
  // production-leaning value so a screen rendered standalone (in Storybook,
  // tests, or a partner host that doesn't pass props) still does something
  // sensible.
  showInsuranceCrossSell = true,
  // Cross-sell orchestration (§ 1.5d). RecommendedCoverage signals which
  // workflow to open via onOpenCrossSell(workflow). The actual surface
  // (sub-flow vs side pane) is owned by ProtectionWizard's caller (or
  // ProtectionWizard itself in customer mode) — not by this screen.
  persona = 'consumer',
  onOpenCrossSell,
  crossSellOverrides,
}) {
  const steps = useMemo(
    () => buildSteps(form),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      form.vehicle,
      form.vin,
      form.customizeRequested,
      form.contact?.zip,
      form.contact?.city,
      form.contact?.state,
      form.opportunityFlags?.rates_changed,
      form.opportunityFlags?.refunded,
      form.opportunityFlags?.manual_review_requested,
    ],
  );
  const stepKey = steps[Math.min(stepIdx, steps.length - 1)];
  const stepIndex = stepIdx + 1;
  const stepTotal = steps.length;
  const progress = stepTotal > 1 ? Math.round((stepIdx / (stepTotal - 1)) * 100) : 100;

  function goNext() {
    setStepIdx((i) => Math.min(i + 1, steps.length - 1));
    beforeStepChange?.({ direction: 'next', from: stepKey });
  }
  function goBack() {
    if (stepIdx === 0) return;
    track(`${trackPrefix}.wizard.back`, { from: stepKey });
    setStepIdx((i) => Math.max(i - 1, 0));
    beforeStepChange?.({ direction: 'back', from: stepKey });
  }

  return (
    <WizardShell
      progress={progress}
      stepIndex={stepIndex}
      stepTotal={stepTotal}
      onBack={stepIdx > 0 ? goBack : null}
    >
      {stepKey === 'vehicle_add' && <VehicleAdd form={form} update={update} onNext={goNext} />}
      {stepKey === 'vehicle_drive' && (
        <Suspense fallback={<CrossSellLoading />}>
          <VehicleDrive form={form} update={update} onNext={goNext} />
        </Suspense>
      )}
      {stepKey === 'vehicle_use' && <VehicleUse form={form} update={update} onNext={goNext} />}
      {stepKey === 'modifications' && <Modifications form={form} update={update} onNext={goNext} />}
      {stepKey === 'recommended_coverage' && (
        <RecommendedCoverage
          form={form}
          update={update}
          onNext={goNext}
          persona={persona}
          onOpenCrossSell={onOpenCrossSell}
          crossSellOverrides={crossSellOverrides}
        />
      )}
      {stepKey === 'customize' && <Customize form={form} update={update} onNext={goNext} />}
      {stepKey === 'garage_location' && (
        <Suspense fallback={<CrossSellLoading />}>
          <GarageLocation form={form} update={update} onNext={goNext} />
        </Suspense>
      )}
      {stepKey === 'confirm' && <Confirm form={form} update={update} onNext={goNext} persona={persona} showInsuranceCrossSell={showInsuranceCrossSell} />}
      {stepKey === 'billing_payment' && <BillingPayment form={form} update={update} onNext={goNext} persona={persona} />}
      {stepKey === 'vin_validate' && <VinValidate form={form} update={update} onNext={goNext} />}
      {stepKey === 'rates_changed' && <RatesChanged form={form} update={update} onNext={goNext} persona={persona} />}
      {stepKey === 'docuseal' && <DocuSeal form={form} update={update} onNext={goNext} />}
      {stepKey === 'thank_you' && <ThankYou form={form} update={update} persona={persona} />}
    </WizardShell>
  );
}

export function CustomerView({
  showInsuranceCrossSell = true,
  crossSellOverrides,
  seedMultiContactHousehold = false,
} = {}) {
  const [form, update] = useForm(INITIAL_FORM);
  const [stepIdx, setStepIdx] = useState(0);

  // DEV CONTROLS · seed mock multi-contact household when toggled on
  // and form.contact.household_members is empty/undefined. Phase 1
  // standin for the real prefill from mission-control's CoPilot. Only
  // seeds once per toggle-on; clearing form.contact and re-toggling
  // re-seeds. Customer mode rarely needs this (the multi-contact UX
  // is agent-only), but the flag is honored here for parity if a demo
  // flips views mid-flow.
  useEffect(() => {
    if (!seedMultiContactHousehold) return;
    const existing = form.contact?.household_members;
    if (Array.isArray(existing) && existing.length > 0) return;
    const members = buildMockHousehold(form.contact || {});
    const primary = members.find((m) => m.is_primary) || members[0];
    update({
      contact: {
        ...(form.contact || {}),
        first_name: form.contact?.first_name || primary.first_name,
        last_name: form.contact?.last_name || primary.last_name,
        email: form.contact?.email || primary.email,
        phone: form.contact?.phone || primary.phone,
        household_members: members,
        active_member_id: primary.id,
        active_address_id: primary.addresses?.[0]?.id || null,
      },
    });
    track('dev.seed_multi_contact_applied', {
      view: 'customer',
      member_count: members.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedMultiContactHousehold]);

  // Cross-sell sub-flow surface (consumer persona). The URL drives
  // visibility — `?substep=insurance-savings` or `?substep=refi-prequal`
  // mounts the embed in place of the wizard. The wizard's form state
  // stays alive underneath; this is a layered detour, not a step
  // transition. Returning to the coverage step is a `?substep=` clear.
  const [substep, setSubstep] = useState(() => readSubstepFromUrl());

  // Keep state in sync with browser back/forward.
  useEffect(() => {
    function onPop() {
      setSubstep(readSubstepFromUrl());
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function handleOpenCrossSell(workflow) {
    const sub = workflow === 'insurance' ? 'insurance-savings' : 'refi-prequal';
    writeSubstepToUrl(sub);
    setSubstep(sub);
    track('protection.cross_sell.subflow_opened', { workflow, surface: 'sub_flow' });
  }

  function closeSubstep() {
    writeSubstepToUrl(null);
    setSubstep(null);
    track('protection.cross_sell.subflow_closed', {
      workflow: VALID_SUBSTEPS[substep] || null,
      surface: 'sub_flow',
    });
  }

  function handleSubstepComplete(patch) {
    // The embed components (CrossSellSubFlow.jsx) fire their own
    // protection.cross_sell.{insurance,refi}_completed events with
    // detail; this handler just lifts the result into form state and
    // closes the sub-flow.
    if (patch?.insuranceSavings) {
      update({ insuranceSavings: patch.insuranceSavings });
    }
    if (patch?.refiOffer) {
      update({ refiOffer: patch.refiOffer });
    }
    closeSubstep();
  }

  if (substep) {
    const workflow = VALID_SUBSTEPS[substep];
    return (
      <>
        <CrossSellBreadcrumb workflow={workflow} onBack={closeSubstep} />
        <Suspense fallback={<CrossSellLoading />}>
          <CrossSellSubFlow
            workflow={workflow}
            form={form}
            onComplete={handleSubstepComplete}
            onCancel={closeSubstep}
            persona="consumer"
            personaLocked={true}
          />
        </Suspense>
      </>
    );
  }

  return (
    <ProtectionWizard
      form={form}
      update={update}
      stepIdx={stepIdx}
      setStepIdx={setStepIdx}
      showInsuranceCrossSell={showInsuranceCrossSell}
      persona="consumer"
      onOpenCrossSell={handleOpenCrossSell}
      crossSellOverrides={crossSellOverrides}
    />
  );
}
