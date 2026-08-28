// Customer view container — owns the wizard state, the step list, and the
// per-screen routing. Each step is a self-contained file under
// views/customer/ and receives { form, update, onNext }.
//
// The nine steps (ADR 30 §6.1):
//
//   home_add              type, address, year built, sq ft; eligibility gate;
//                         fires GetRates on Continue
//   home_features         the twelve "does the home have X" questions
//   recommended_coverage  good/better/best + the term <-> monthly switch
//   [customize]           conditional — opt-in plan browser
//   optional_coverages    priced add-ons, plan- and term-scoped
//                         CONDITIONAL — dropped for monthly plans 38/48/49
//   confirm               review; totals INCLUDE add-on dollars
//   billing_payment       FluidPay hosted fields + contact capture
//   docuseal              real signing integration
//   thank_you             completion
//
// Dropped from the auto sequence: vehicle_add, vehicle_drive, vehicle_use,
// vin_validate and rates_changed (a home has no VIN, so there is no
// post-payment VIN divergence path at all), and garage_location — the
// covered-property address is collected on home_add, and <State> is the
// only location input GetRates takes, so rates can fire from there.
//
// AgentView composes this same wizard by importing HomeWizard directly and
// passing in its own form / step state — that is how the agent shell layers
// chrome (status overrides, Save and Send, notes) without duplicating any
// customer screens.
import { useEffect, useMemo, useState } from 'react';
import { WizardShell } from 'blinker-platform/components';
import { track } from 'blinker-platform/telemetry';
import { useForm } from '../../hooks/useForm.js';
import { buildMockHousehold } from '../../lib/contact.js';

import { HomeAdd } from './HomeAdd.jsx';
import { HomeFeatures } from './HomeFeatures.jsx';
import { RecommendedCoverage } from './RecommendedCoverage.jsx';
import { Customize } from './Customize.jsx';
import { OptionalCoverages } from './OptionalCoverages.jsx';
import { Confirm } from './Confirm.jsx';
import { BillingPayment } from './BillingPayment.jsx';
import { DocuSeal } from './DocuSeal.jsx';
import { ThankYou } from './ThankYou.jsx';

/**
 * The wizard's form shape (ADR 30 §6.2).
 *
 * Workflow-agnostic keys carry over unchanged from protection-portal's
 * INITIAL_FORM: org_id, contact, rates, selectedPlan, payment,
 * paymentSchedule, status, opportunityId, completedAt, docusealCompleted.
 *
 * Vehicle-shaped keys are replaced by home, homeFeatures, coverageTerm and
 * selectedAddOns.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const INITIAL_FORM = {
  // Org context. Default 102 (Apex Auto Solutions) — the canonical demo org
  // and the only one with opportunities.home_protection.enabled === true,
  // because it carries the OMGA AUG2 credentials that serve home rates.
  org_id: 102,

  // ── home_add ────────────────────────────────────────────────────────────
  // Mirrors canon/blinker-domain.json#home. `address` is the COVERED
  // PROPERTY address — distinct from the agreement holder's mailing address,
  // which lives on `contact` and is collected at billing.
  home: {
    id: null,
    home_type: '',
    address: {
      address1: '',
      address2: '',
      city: '',
      state: '',
      zip: '',
      zip4: '',
      country: 'US',
    },
    year_built: null,
    square_feet: null,
    purchase_price: null,
    disposition: null,
    // DERIVED, not authored: classifyDwelling(home, canon) writes the
    // resolved bucket here on every home_type / square_feet change. null
    // means INELIGIBLE — no dwelling checkbox exists on the agreement.
    dwelling_class: null,
    // Provenance of `address`, not part of the canon home entity — seeded
    // from opportunity._prefill.home.source by AgentView's
    // buildInitialFormSeed (ADR 30 R8 follow-up). 'contact_address' means
    // the address is ASSUMED from the agreement holder's mailing address and
    // not yet confirmed as the covered property; HomeAdd shows a quiet note
    // in that case. null for a manually-entered or on-file home.
    address_source: null,
  },

  // ── home_features ───────────────────────────────────────────────────────
  // One boolean per canon plan-mappings.json#home_add_ons category key
  // (swimming_pool, spa, well_pump, septic, …). Seeded empty and rendered
  // from canon rather than a hard-coded list, so changing the covered
  // categories is a canon edit. These answers PRE-CHECK the priced picker
  // on optional_coverages; they are not themselves a purchase.
  homeFeatures: {},

  // ── coverage ────────────────────────────────────────────────────────────
  rates: null,
  selectedPlan: null,
  // 12 | 24 | 36 | 48 in term mode; null in monthly mode.
  coverageTerm: null,
  // 'term' | 'monthly' — the global switch from ADR 28, reused here.
  billingMode: 'term',
  customizeCriteria: null,
  // Customize is OPT-IN: RecommendedCoverage's primary CTA leaves this false
  // and the wizard skips straight past it.
  customizeRequested: false,

  // ── optional_coverages ──────────────────────────────────────────────────
  // [{ key, label, option_id, price, docuseal_field, variant }]
  // These dollars are IN the money path (ADR 30 D7) — unlike auto, where
  // passthrough add-on totals are display-only.
  selectedAddOns: [],
  // `${plan_code}::${termMonths}` of the last revalidation. When this drifts
  // from the current plan+term, OptionalCoverages re-resolves and re-prices
  // every selection before Confirm can read it.
  addOnsRevalidatedFor: null,
  // Set ONCE, by OptionalCoverages only, the first time the homeFeatures
  // pre-check has been applied. Deliberately separate from
  // addOnsRevalidatedFor, which RecommendedCoverage/Customize also write on
  // every plan/term flip — sharing one flag made the pre-check think a
  // first-time visitor was returning and skip it.
  addOnsPrecheckedFor: null,

  // ── contact ─────────────────────────────────────────────────────────────
  // Seeded with the tagging + household slots so agent-side reads are
  // null-safe without a guard at every call site.
  contact: { tags: [], tagsCreated: [], household_members: [] },
  // ADR 30 D2 — the Omega home agreement has TWO holder slots. Captured and
  // rendered in Phase 1; not written to a relationship store until the
  // Phase 2 data layer lands (ADR 30 R3).
  secondaryContact: null,

  // ── confirm / payment ───────────────────────────────────────────────────
  paymentSchedule: null,
  payment: null,

  // ── agreements ──────────────────────────────────────────────────────────
  saleDate: null,
  productEffectiveDate: null,
  // ADR 30 R4 — eContracting is not built; Phase 1 emits an empty string on
  // the agreement and mints a display-only reference on thank_you.
  agreement_number: null,
  docusealTemplateId: null,
  docusealFields: null,
  submission_id: null,
  docusealCompleted: false,
  signedAt: null,

  // ── final ───────────────────────────────────────────────────────────────
  opportunityId: null,
  completedAt: null,

  // canon/ghl-status.json#home_protection display name.
  status: 'Empty',
};

// eslint-disable-next-line react-refresh/only-export-components
export const BASE_STEPS = [
  'home_add',
  'home_features',
  'recommended_coverage',
  // 'customize' — conditional; inserted when the consumer clicks the
  //   "Customize coverage" secondary CTA on recommended_coverage. It is
  //   anchored BEFORE optional_coverages (see buildSteps) because changing
  //   the plan changes which add-ons exist and what they cost.
  'optional_coverages',
  'confirm',
  'billing_payment',
  'docuseal',
  'thank_you',
];

/**
 * Optional coverages exist only on the fixed-term plans. Plans 38 / 48 / 49
 * (month-to-month) return no <Option> rows at all, so the step is REMOVED
 * from the list rather than rendered empty (ADR 30 D5).
 *
 * @param {object} form
 * @returns {boolean}
 */
// eslint-disable-next-line react-refresh/only-export-components
export function shouldRunOptionalCoverages(form) {
  return form?.selectedPlan?.billing_model !== 'monthly_subscription';
}

/**
 * Customize is opt-in — only inserted when the consumer explicitly asked
 * for it on recommended_coverage.
 *
 * @param {object} form
 * @returns {boolean}
 */
// eslint-disable-next-line react-refresh/only-export-components
export function shouldRunCustomize(form) {
  return form?.customizeRequested === true;
}

/**
 * Build the live step list for a given form.
 *
 * Anchoring note (a deliberate deviation from the plan's literal wording,
 * which said "splice customize before confirm"): ADR 30 D5 states
 * optional_coverages runs AFTER customize when that conditional runs.
 * Anchoring customize on confirm would place it after optional_coverages and
 * let a plan change silently invalidate an add-on selection the consumer had
 * already made. So customize anchors on optional_coverages when that step is
 * present, and falls back to confirm when it is not (monthly plans) — which
 * is the same position the plan's wording describes for that case.
 *
 * @param {object} form
 * @returns {string[]}
 */
// eslint-disable-next-line react-refresh/only-export-components
export function buildSteps(form) {
  let steps = BASE_STEPS;

  if (!shouldRunOptionalCoverages(form)) {
    steps = steps.filter((s) => s !== 'optional_coverages');
  }

  if (shouldRunCustomize(form)) {
    const anchor = steps.includes('optional_coverages') ? 'optional_coverages' : 'confirm';
    const idx = steps.indexOf(anchor);
    steps = [...steps.slice(0, idx), 'customize', ...steps.slice(idx)];
  }

  return steps;
}

/**
 * The reusable wizard. Owns no state — the caller passes form + stepIdx so
 * AgentView can read and write the same state from outside (status pill,
 * Save and Send, resume-at-step).
 */
export function HomeWizard({
  form,
  update,
  stepIdx,
  setStepIdx,
  trackPrefix = 'home_protection.customer',
  beforeStepChange,
  persona = 'consumer',
}) {
  const steps = useMemo(
    () => buildSteps(form),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form.customizeRequested, form.selectedPlan?.billing_model],
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
      {stepKey === 'home_add' && <HomeAdd form={form} update={update} onNext={goNext} persona={persona} />}
      {stepKey === 'home_features' && <HomeFeatures form={form} update={update} onNext={goNext} persona={persona} />}
      {stepKey === 'recommended_coverage' && (
        <RecommendedCoverage form={form} update={update} onNext={goNext} persona={persona} />
      )}
      {stepKey === 'customize' && <Customize form={form} update={update} onNext={goNext} persona={persona} />}
      {stepKey === 'optional_coverages' && (
        <OptionalCoverages form={form} update={update} onNext={goNext} persona={persona} />
      )}
      {stepKey === 'confirm' && <Confirm form={form} update={update} onNext={goNext} persona={persona} />}
      {stepKey === 'billing_payment' && (
        <BillingPayment form={form} update={update} onNext={goNext} persona={persona} />
      )}
      {stepKey === 'docuseal' && <DocuSeal form={form} update={update} onNext={goNext} persona={persona} />}
      {stepKey === 'thank_you' && <ThankYou form={form} update={update} persona={persona} />}
    </WizardShell>
  );
}

export function CustomerView({
  seedMultiContactHousehold = false,
  form: formProp,
  update: updateProp,
} = {}) {
  const [ownForm, ownUpdate] = useForm(INITIAL_FORM);
  const form = formProp ?? ownForm;
  const update = updateProp ?? ownUpdate;
  const [stepIdx, setStepIdx] = useState(0);

  // DEV CONTROLS · seed a mock multi-contact household. Phase 1 stand-in for
  // the real prefill from mission-control's CoPilot session. Only seeds once
  // per toggle-on so a manual edit is not clobbered.
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
    track('dev.seed_multi_contact_applied', { view: 'customer', member_count: members.length });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedMultiContactHousehold]);

  return (
    <HomeWizard
      form={form}
      update={update}
      stepIdx={stepIdx}
      setStepIdx={setStepIdx}
      persona="consumer"
    />
  );
}
