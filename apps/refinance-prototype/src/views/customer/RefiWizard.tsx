// RefiWizard — composes the lifted refi screens into a single-flow wizard.
// Mirrors protection-portal's ProtectionWizard pattern. Owns no state
// (caller passes form + stepIdx + dev) so AgentView can read/write the
// same state from outside the wizard for Save & Send / status overrides /
// View API Responses, and DEV CONTROLS at the App.jsx level can drive
// prefill / jump-to-screen / force outcomes.
//
// Step sequence comes from the prototype's getSequence(form, hasCoApp):
//
//   1. vehicle_add
//   2. vehicle_drive
//   3. s1_ownership
//   4. s1_auto_loan
//   5. s1_credit
//   6+. middle (credit-band-dependent — see below)
//   7. s1_identity_consent
//   8. decision_engine
//   9. stage2_result   ← renders StageTwoResult (heavyweight fan-out:
//                         offers + insurance / protection upsell)
//
// Middle ordering:
//   poor band (300_579):       co_app_decision -> [co_app_contact,
//                              co_app_employment if hasCoApp] ->
//                              applicant -> housing -> employment
//   fair-or-better:            applicant -> housing -> employment ->
//                              co_app_decision -> [co_app_contact,
//                              co_app_employment if hasCoApp]
//
// Notes on the filename-vs-sequence drift this session uncovered: the
// PROMPTS.md § 1.5b sketch had auto_loan + co_app_decision after
// applicant; the actual prototype puts auto_loan + credit BEFORE the
// applicant cluster, and the co-app cluster reorders by credit band.
// We follow the source. § 1.5c should re-confirm against
// documentation/refinance-version-2-wiki.md.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FC } from 'react';
import { WizardShell } from 'blinker-platform/components';
import {
  STAGE1_TERMINUS,
} from '../../refinance-v2-prototype';
import { runDecision, DISQUAL_REASONS, getSequence, useRefiPrequal } from '../../lib/refi';
import { track } from 'blinker-platform/telemetry';
import { VehicleAdd } from './VehicleAdd';
import { VehicleDrive } from './VehicleDrive';
import { Ownership } from './Ownership';
import { AutoLoan } from './AutoLoan';
import { Credit } from './Credit';
import { CoAppDecision } from './CoAppDecision';
import { CoAppContact } from './CoAppContact';
import { CoAppEmployment } from './CoAppEmployment';
import { Applicant } from './Applicant';
import { Housing } from './Housing';
import { Employment } from './Employment';
import { IdentityConsent } from './IdentityConsent';
import { DecisionEngine } from './DecisionEngine';
import { StageTwoResult } from './StageTwoResult';
import type { RefiForm, WizardDevOptions, StepChangeContext } from '../../types';

// Initial form state mirrors emptyForm() from the monolith — same shape so
// every screen keeps working without prop adjustment.
export const INITIAL_FORM: RefiForm = {
  // protection plan teaser default — already-sold flag suppresses the
  // upsell in the standalone wizard. AgentView in § 1.5c can flip these.
  planSold: true,
  smsSent: false,
  // insurance teaser default
  insuranceReviewed: true,
  insuranceSavingsFound: false,
  insuranceMonthlySavings: 0,
  insuranceSmsSent: false,
  // vehicle
  vin: '',
  vinDecoded: false,
  vinDecodeLoading: false,
  year: null,
  make: '',
  model: '',
  trim: '',
  mileage: 14000,
  condition: 'Used',
  extraMakes: [],
  extraModels: [],
  extraTrims: [],
  // applicant primary
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  // current loan
  ownership: null,
  lender: '',
  monthlyPayment: '',
  payoff: '',
  // credit
  creditBand: null,
  // co-applicant
  hasCoApplicant: null,
  coAppFirst: '',
  coAppLast: '',
  coAppPhone: '',
  coAppEmail: '',
  coAppRelationship: '',
  coAppRelationshipOther: '',
  coAppDob: '',
  coAppSsn: '',
  coAppEmployer: '',
  coAppEmploymentType: '',
  coAppIncome: '',
  coAppConsent: false,
  // housing
  address: '',
  city: '',
  state: '',
  zip: '',
  ownRent: null,
  moveInDate: '',
  housingPayment: '',
  // employment
  employer: '',
  employmentType: '',
  income: '',
  startDate: '',
  // identity + consent
  dob: '',
  ssn: '',
  consentConfirmed: false,
  // vehicle valuation (populated by MarketCheck API in the real flow)
  valuationMarketCheckPrice: null,
  valuationRetailPrice: null,
  valuationLoading: false,
  // agent-side notes + tags (per § 1.5/wave 12 — shared NotesPanel +
  // TagPicker live in src/components/, parent owns state). The
  // customer wizard never reads these slots; they ride along on the
  // shared form so AgentView can thread them into the right pane
  // without forking the form shape.
  notes: '',
  tags: [],
  tagsCreated: [] as Array<{ id: string; label: string; color?: string }>,
};

// The reusable wizard. Caller owns form + stepIdx so AgentView can
// compose this with its own outer chrome, and App.jsx can route
// DEV CONTROLS prefill / jump-to-screen through to it.
//
// Per the monolith there are TWO co-applicant override modes:
// dev.coAppOverride can be 'auto' (read form.hasCoApplicant) | 'yes' |
// 'no'. RefiWizard reads this from `dev` when present; legacy callers
// without `dev` can still pass the explicit `hasCoAppOverride` prop.
interface RefiWizardProps {
  form: RefiForm;
  update: (updates: Partial<RefiForm>) => void;
  stepIdx: number;
  setStepIdx: (idx: number) => void;
  hasCoAppOverride?: boolean;
  beforeStepChange?: (ctx: StepChangeContext) => void;
  dev?: Partial<WizardDevOptions>;
}

export const RefiWizard: FC<RefiWizardProps> = ({
  form,
  update,
  stepIdx,
  setStepIdx,
  // hasCoApp override — pass true/false to skip the form's own answer.
  // Default: read from form.hasCoApplicant (the auto mode).
  hasCoAppOverride,
  // beforeStepChange fires for analytics + parent-side bookkeeping.
  beforeStepChange,
  // DEV CONTROLS slice (Phase 1.5e). Drives runDecision arguments
  // when the wizard hits the decision_engine step. Optional — when
  // absent, the decision runs with built-in defaults (auto routing).
  dev,
}) => {
  // Honor dev.coAppOverride first (DEV CONTROLS Section 7), then the
  // explicit hasCoAppOverride prop (legacy), then the form answer.
  const devCoApp = dev?.coAppOverride;
  const effectiveHasCoApp =
    devCoApp === 'yes'
      ? true
      : devCoApp === 'no'
        ? false
        : hasCoAppOverride !== undefined
          ? !!hasCoAppOverride
          : form.hasCoApplicant === true;

  const sequence = useMemo(
    () => getSequence(form, effectiveHasCoApp),
    [form, effectiveHasCoApp]
  );

  const stepKey = sequence[Math.min(stepIdx, sequence.length - 1)];

  // Disclosure modal state for the s1_identity_consent step. The monolith's
  // ScreenIdentityConsent renders the row + DisclosureModal but expects the
  // open/close state to be owned by a parent — previously we passed a no-op
  // pair, which silently broke the "Read and agree to disclosure" click.
  // Now owned here so the click opens the modal, and "Confirm consent"
  // flips form.consentConfirmed (+ form.coAppConsent), which gates the
  // "Submit for prequal" CTA via consentReady.
  //
  // _TODO: real per-org disclosure copy needs to come from canon
  // (org-disclaimers.json — pending on the platform's canon roadmap per
  // blinker-platform/STATUS.md). Today the placeholder text lives inside
  // the monolith's DisclosureModal component.
  const [showDisclosureModal, setShowDisclosureModal] = useState(false);
  const [selectedOfferId, setSelectedOfferId] = useState(null);
  const [offerConfirmed, setOfferConfirmed] = useState(false);

  function openDisclosure(): void {
    track('refi.prequal.disclosure_opened', {
      surface: 'RefiWizard',
      step: stepKey,
      has_co_app: effectiveHasCoApp,
    });
    setShowDisclosureModal(true);
  }
  function closeDisclosure(): void {
    setShowDisclosureModal(false);
  }

  // Fire the agreed event when consentConfirmed transitions false → true.
  // The monolith's DisclosureModal onConfirm sets consentConfirmed (+
  // coAppConsent) via update(), so this effect catches the agreement
  // regardless of how the field flipped (modal "Confirm" today; could be
  // DEV CONTROLS prefill in future).
  const prevConsentRef = useRef(form.consentConfirmed);
  useEffect(() => {
    if (!prevConsentRef.current && form.consentConfirmed) {
      track('refi.prequal.disclosure_agreed', {
        surface: 'RefiWizard',
        step: stepKey,
        has_co_app: effectiveHasCoApp,
        co_app_consent: !!form.coAppConsent,
      });
    }
    prevConsentRef.current = form.consentConfirmed;
  }, [form.consentConfirmed, form.coAppConsent, effectiveHasCoApp, stepKey]);

  // Stage 1 progress reads only the Stage 1 screens (everything up to
  // identity_consent). The decision_engine and stage2_result steps render
  // their own non-progress chrome.
  const stage1End = sequence.indexOf(STAGE1_TERMINUS);
  const stage1Length = stage1End + 1;
  const inStage1 = stepIdx <= stage1End;
  const progress = inStage1 && stage1Length > 0
    ? Math.round(((stepIdx + 1) / stage1Length) * 100)
    : 100;

  function goNext(): void {
    setStepIdx(Math.min(stepIdx + 1, sequence.length - 1));
    beforeStepChange?.({ direction: 'next', from: stepKey });
  }
  function goBack(): void {
    if (stepIdx === 0) return;
    setStepIdx(Math.max(stepIdx - 1, 0));
    beforeStepChange?.({ direction: 'back', from: stepKey });
  }

  // Local synchronous decision — used as the immediate fallback and for
  // DEV CONTROLS force-outcomes before the API responds.
  const decision = useMemo(
    () =>
      runDecision({
        form,
        orgConfig: dev?.orgConfig,
        forcePartner: dev?.forcePartner ?? 'auto',
        forceResult: dev?.forceResult ?? 'auto',
        includeSsn: dev?.includeSsn ?? true,
        disqualReason: dev?.disqualReason ?? 'credit_out_of_range',
        hasCoApp: effectiveHasCoApp,
      }),
    [form, dev, effectiveHasCoApp]
  );

  // Real API hook — fires submitPrequal when the wizard reaches the
  // decision_engine step. In DEV CONTROLS force-mode (forcePartner/
  // forceResult != 'auto') the hook falls back to runDecision() internally,
  // so DEV CONTROLS overrides continue to work without network calls.
  const { submitPrequal, decision: apiDecision, prequalState } = useRefiPrequal();
  const submittedRef = useRef(false);

  useEffect(() => {
    if (stepKey === 'decision_engine' && !submittedRef.current) {
      submittedRef.current = true;
      submitPrequal(form, {
        forcePartner:  dev?.forcePartner  ?? 'auto',
        forceResult:   dev?.forceResult   ?? 'auto',
        includeSsn:    dev?.includeSsn    ?? !!form.ssn,
        disqualReason: dev?.disqualReason,
        hasCoApp:      effectiveHasCoApp,
        orgConfig:     dev?.orgConfig,
      });
    }
  }, [stepKey, form, dev, effectiveHasCoApp, submitPrequal]);

  // Reset submitted flag when user navigates back before the decision step
  // so a re-entry (e.g. after editing a field) triggers a fresh API call.
  useEffect(() => {
    if (stepKey !== 'decision_engine' && stepKey !== 'stage2_result') {
      submittedRef.current = false;
    }
  }, [stepKey]);

  // Prefer the real API decision; fall back to local runDecision() while
  // the request is in flight or when in DEV CONTROLS force-mode.
  const finalDecision = apiDecision ?? decision;
  const isDecisionLoading = stepKey === 'decision_engine' &&
    prequalState === 'submitted' && !apiDecision;

  // Stage 1 screens get the WizardShell chrome. decision_engine +
  // stage2_result render their own.
  if (stepKey === 'decision_engine') {
    if (isDecisionLoading) {
      return (
        <div className="min-h-[300px] flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin h-8 w-8 border-4 border-emerald-600 border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-slate-600 text-sm">Checking your eligibility…</p>
          </div>
        </div>
      );
    }
    return (
      <DecisionEngine
        decision={finalDecision}
        onDone={goNext}
      />
    );
  }

  if (stepKey === 'stage2_result') {
    return (
      <StageTwoResult
        decision={finalDecision}
        form={form}
        update={update}
        selectedOfferId={selectedOfferId}
        setSelectedOfferId={setSelectedOfferId}
        offerConfirmed={offerConfirmed}
        setOfferConfirmed={setOfferConfirmed}
        onReturn={goBack}
        onReset={() => {
          setStepIdx(0);
          setSelectedOfferId(null);
          setOfferConfirmed(false);
        }}
      />
    );
  }

  return (
    <WizardShell
      progress={progress}
      stepIndex={Math.min(stepIdx + 1, stage1Length)}
      stepTotal={stage1Length}
      onBack={stepIdx > 0 ? goBack : undefined}
    >
      {stepKey === 'vehicle_add' && <VehicleAdd form={form} update={update} onNext={goNext} />}
      {stepKey === 'vehicle_drive' && <VehicleDrive form={form} update={update} onNext={goNext} orgVehicleDefaults={dev?.orgConfig ?? null} />}
      {stepKey === 's1_ownership' && <Ownership form={form} update={update} onNext={goNext} />}
      {stepKey === 's1_auto_loan' && <AutoLoan form={form} update={update} onNext={goNext} />}
      {stepKey === 's1_credit' && <Credit form={form} update={update} onNext={goNext} />}
      {stepKey === 's1_co_app_decision' && <CoAppDecision form={form} update={update} onNext={goNext} />}
      {stepKey === 's1_co_app_contact' && <CoAppContact form={form} update={update} onNext={goNext} />}
      {stepKey === 's1_co_app_employment' && <CoAppEmployment form={form} update={update} onNext={goNext} />}
      {stepKey === 's1_applicant' && <Applicant form={form} update={update} onNext={goNext} />}
      {stepKey === 's1_housing' && <Housing form={form} update={update} onNext={goNext} />}
      {stepKey === 's1_employment' && <Employment form={form} update={update} onNext={goNext} />}
      {stepKey === 's1_identity_consent' && (
        <IdentityConsent
          form={form}
          update={update}
          onNext={goNext}
          effectiveHasCoApp={effectiveHasCoApp}
          // Modal open/close + agreement state owned by RefiWizard so the
          // "Read and agree to disclosure" row actually opens the modal.
          // The monolith's onConfirm wires update({ consentConfirmed,
          // coAppConsent }) which this wizard's useEffect picks up to
          // fire refi.prequal.disclosure_agreed.
          showDisclosureModal={showDisclosureModal}
          setShowDisclosureModal={(open: boolean) =>
            open ? openDisclosure() : closeDisclosure()
          }
        />
      )}
    </WizardShell>
  );
}
