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
import { runDecision, DISQUAL_REASONS, getSequence, useRefiPrequal, isQualifiedDecision, disqualStepTarget } from '../../lib/refi';
import { resolveWriteContext, ensureDirectEntities, submitRefiApplication, createRefiPrequal, disqualifyRefiPrequal, syncUser } from '../../lib/blinkerWrite';
import { track } from 'blinker-platform/telemetry';
import { AlertCircle } from 'lucide-react';
import { readViewFromUrl } from '../../shell/ViewSwitcher';
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

// Return link back to MissionControl after Stage 1. When MissionControl
// launches the AGENT flow it attaches `user_id` (and `view=agent`) to the
// refi-portal URL (see ApplyForFinancingBtn.tsx). On "Continue to Stage 2" we
// send the agent to {VITE_MISSION_CONTROL_URL}/user/{user_id}. A full
// navigation (not a pushState) is required so MissionControl loads fresh —
// refi-portal is a separate origin, where history.push would throw a
// cross-origin SecurityError and would not reload the app.
//
// Agent view ONLY: the customer view keeps the in-wizard Stage 2 result flow.
// Returns null when not agent view (or no user id anywhere) so the caller
// falls back to goNext().
//
// The view check goes through readViewFromUrl(), NOT a raw `view` param read.
// Production MissionControl sets REACT_APP_REFI_AGENT_URL to a bare
// https://refi.blinker-prod.com — the `?view=agent` suffix only exists in
// ApplyForFinancingBtn's localhost default. readViewFromUrl() already defaults
// a missing/unavailable `view` to 'agent' (that's why the agent chrome renders
// in prod at all), so reading the param directly made this return null for
// every real MissionControl hand-off and silently fall back to goBack().
//
// userId source: the MissionControl hand-off carries `user_id` in the URL. The
// DIRECT-login flow has NO user_id in the URL — it mints the User during
// bootstrap (see bootstrapDirectContext), so we fall back to that id via
// `ctxUserId` (writeCtx.userId). Without this fallback the direct flow's
// "Mark transfer complete" had no id and never redirected.
function missionControlReturnUrl(ctxUserId?: string): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  if (readViewFromUrl() !== 'agent') return null;
  // Env override when set; otherwise default to the local MissionControl dev
  // server so the agent hand-off works without a .env file.
  const base = ((import.meta.env.VITE_MISSION_CONTROL_URL as string | undefined) ||
    'http://localhost:3000').replace(/\/$/, '');
  const userId = params.get('user_id') || ctxUserId || '';
  if (!userId) return null;
  return `${base}/users/${userId}`;
}

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
  trimCandidates: [],
  trimLookupLoading: false,
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
  apt_suite: '',
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

// Wizard steps whose fields feed a backend entity (vehicle / user / address /
// ownership). On leaving one in the direct flow we run the incremental
// create-or-update pass (ensureDirectEntities) before advancing.
const ENTITY_STEPS = new Set<string>([
  'vehicle_add',
  'vehicle_drive',
  's1_ownership',
  's1_applicant',
  's1_housing',
]);

// Top-of-screen error banner shown when a backend write fails — the Stage-2
// refi_applications POST, or a per-step create-or-update (direct flow). Renders
// the backend's validation / missing-field message as a form breadcrumb.
function SubmitErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
      <span>{message}</span>
    </div>
  );
}

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
  // Agent flow turns this on to surface the s1_co_app_decision step (the
  // "do you have a co-applicant?" gate). Customer/partner leave it off.
  includeCoAppDecision?: boolean;
  // Remittance lock. True once the ProductPackage attached to this vehicle is
  // `remitted` — blinker freezes the Vehicle at that point
  // (Vehicle#remittance_locked?).
  //
  // The backend lock is whole-record, not field-scoped: RemittanceLock's
  // `before_update` raises RemittedRecordError whenever `has_changes_to_save?`
  // is true for ANY attribute (app/models/concerns/remittance_lock.rb:20,34).
  // So every Vehicle column is frozen, mileage included.
  //
  // UI coverage today: VIN + year/make/model/trim (vehicle_add) and the
  // odometer slider (vehicle_drive) render read-only. Condition, purchase date
  // and ownership are still editable on screen even though blinker would
  // reject those writes too — remaining gap, not a decision.
  // Resolved by the parent (AgentView); customer/partner leave it off.
  vehicleLocked?: boolean;
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
  // Surface the co-applicant decision step (agent flow). Default off.
  includeCoAppDecision = false,
  // Vehicle fields frozen by a remitted package. Default off.
  vehicleLocked = false,
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
    () => getSequence(form, effectiveHasCoApp, { includeCoAppDecision }),
    [form, effectiveHasCoApp, includeCoAppDecision]
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

  // Write-back context: MissionControl hand-off (URL token + ids) OR the
  // direct-login session context. Held in state (not useMemo) because the
  // direct flow MUTATES it once on first submit — bootstrapDirectContext()
  // creates the User / Vehicle / Address / ProductPackage and fills in their
  // ids, after which it drives the same refi_prequals + refi_applications POSTs
  // as the hand-off.
  const [writeCtx, setWriteCtx] = useState(() => resolveWriteContext());
  // Error banner shown at the top when the Stage-2 submit fails, just before
  // we redirect the agent back to MissionControl.
  const [submitError, setSubmitError] = useState<string | null>(null);
  // True while the "Continue to Stage 2" POST is in flight — disables the CTA
  // so the agent can't double-submit. Stays true through the success redirect.
  const [submitting, setSubmitting] = useState(false);
  // True while a per-step create-or-update (ensureDirectEntities) is in flight,
  // so a double-click on a screen's Next can't fire two passes.
  const [stepBusy, setStepBusy] = useState(false);

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

  async function goNext(): Promise<void> {
    const from = stepKey;
    // Direct (fresh) flow: create-or-update the User / Address / Vehicle /
    // ProductPackage as their sections complete (tasks 1-5). A backend
    // validation / missing-field error holds the agent on the step and shows a
    // breadcrumb (task 7). No-op for the MissionControl hand-off (ctx.direct is
    // false), whose per-section updates flow through App's syncForStep instead.
    if (writeCtx.direct && ENTITY_STEPS.has(from)) {
      if (stepBusy) return;
      setStepBusy(true);
      setSubmitError(null);
      const { ctx, error } = await ensureDirectEntities(writeCtx, form);
      setWriteCtx(ctx);
      setStepBusy(false);
      if (error) {
        setSubmitError(error);
        track('refi.direct.step_write_failed', { step: from });
        return;
      }
    }
    setStepIdx(Math.min(stepIdx + 1, sequence.length - 1));
    beforeStepChange?.({ direction: 'next', from });
  }
  function goBack(): void {
    if (stepIdx === 0) return;
    setSubmitError(null); // drop any stale per-step write error breadcrumb
    setStepIdx(Math.max(stepIdx - 1, 0));
    beforeStepChange?.({ direction: 'back', from: stepKey });
  }

  // "Submit for prequal" handler (s1_identity_consent CTA). Fires TWO requests
  // in sequence and only advances if BOTH succeed:
  //   1. syncUser            → POST /admin/graphql  (updateUser / DOB push)
  //   2. createRefiPrequal   → POST /api/v3/refi_prequals (LoanApplicantsExternal upsert)
  // While in flight the button is disabled (submitting). If either request
  // fails the agent stays on this screen with an inline error and can retry.
  // Standalone refi (writeCtx.enabled === false) makes both no-ops returning
  // { ok: true }, so the step advances immediately as before.
  async function submitPrequalCreate(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);

    // 0. DIRECT login (no MC hand-off): make sure the User / Address / Vehicle /
    //    ProductPackage all exist (they normally do by now — created
    //    incrementally on the applicant + housing steps). This is the idempotent
    //    backstop that also picks up any last edits; no-op for the MC hand-off.
    let ctx = writeCtx;
    if (ctx.direct && !ctx.packageId) {
      const ensured = await ensureDirectEntities(ctx, form);
      ctx = ensured.ctx;
      setWriteCtx(ctx); // persist ids for goToStageTwo's refi_applications POST
      if (ensured.error || !ctx.packageId) {
        setSubmitting(false);
        setSubmitError(
          ensured.error ||
            'We couldn’t start your application. Please check your connection and try again.'
        );
        return;
      }
    }

    // 1. /admin/graphql first.
    const userRes = await syncUser(ctx, form);
    if (!userRes.ok) {
      setSubmitting(false);
      // userRes.error is set only for data-validation failures ("Email is
      // invalid"), which name the field the agent has to fix. Auth denials and
      // 500s arrive undefined on purpose — their wording is internal — so those
      // fall back to the generic line. See userSafeMessage in blinkerWrite.
      setSubmitError(
        userRes.error ||
          'We couldn’t save your details. Please check your connection and try again.'
      );
      return;
    }

    // 2. /api/v3/refi_prequals second.
    const prequalRes = await createRefiPrequal(ctx, form);
    setSubmitting(false);
    if (prequalRes.ok) {
      goNext();
    } else {
      setSubmitError(
        prequalRes.error ||
          'We couldn’t submit your prequal. Please check your connection and try again.'
      );
    }
  }

  // "Continue to Stage 2" handler. Only reachable when the application is
  // QUALIFIED (DecisionEngineScreen renders this CTA only in that branch).
  // The real refi API (submitPrequal) fires HERE — NOT on entry to the
  // decision_engine screen — so "Submit for prequal" merely lands the
  // consumer on the local-decision preview without a network call.
  //
  // When launched from MissionControl (user_id present + VITE_MISSION_CONTROL_URL
  // set), hand the agent back to the user dashboard with a full navigation so
  // MissionControl reloads fresh. Standalone refi falls back to the in-wizard
  // Stage 2 result screen.
  // Recomputes once the direct-login bootstrap fills in writeCtx.userId (the
  // MC hand-off has it from the URL on mount; direct login gets it post-submit).
  const mcReturnUrl = useMemo(
    () => missionControlReturnUrl(writeCtx.userId),
    [writeCtx.userId]
  );

  // "Continue to Stage 2" — fire the refi_applications POST, then advance to
  // the in-wizard Stage 2 result screen (StageTwoResult), exactly like the main
  // branch's standalone flow. NO MissionControl redirect here anymore; that
  // happens only on the final "Mark transfer complete" button (see
  // completeAndReturnToMc). On failure we keep the agent on the decision screen
  // with an inline error so they can retry.
  async function goToStageTwo(): Promise<void> {
    // Already submitted (e.g. a second click): just advance, don't re-POST.
    if (submittedRef.current) {
      goNext();
      return;
    }
    submittedRef.current = true;
    setSubmitting(true);
    setSubmitError(null);

    // Local synchronous decision preview (mock; also feeds the in-wizard
    // Stage 2 result screen for standalone refi).
    submitPrequal(form, {
      forcePartner:  dev?.forcePartner  ?? 'auto',
      forceResult:   dev?.forceResult   ?? 'auto',
      includeSsn:    dev?.includeSsn    ?? !!form.ssn,
      disqualReason: dev?.disqualReason,
      hasCoApp:      effectiveHasCoApp,
      orgConfig:     dev?.orgConfig,
    });

    // Fire the REAL refi_applications POST HERE — moved off the
    // "Submit for prequal" (s1_identity_consent) step so it only runs for a
    // qualified application after the decision-engine preview. No-op for
    // standalone refi (writeCtx.enabled === false), which returns { ok: true }.
    const { ok, error } = await submitRefiApplication(writeCtx, form);
    setSubmitting(false);
    if (!ok) {
      submittedRef.current = false; // allow a retry
      setSubmitError(
        error ||
          'We couldn’t submit this application. Please check your connection and try again.'
      );
      track('refi.stage1.submit_failed', { surface: 'RefiWizard' });
      return;
    }

    track('refi.stage1.complete', { surface: 'RefiWizard' });
    goNext();
  }

  // Final "Mark transfer complete & return to quote card" CTA on the qualified
  // Stage 2 handoff card. In the agent hand-off (agent view + user_id) this
  // redirects to the MissionControl user dashboard with a full navigation so MC
  // reloads fresh. Standalone refi (no MC context) falls back to the in-wizard
  // quote-card return (goBack), preserving the main-branch behavior.
  function completeAndReturnToMc(): void {
    if (mcReturnUrl) {
      track('refi.stage2.transfer_complete_redirect_mc', {
        surface: 'RefiWizard',
        url: mcReturnUrl,
      });
      if (typeof window !== 'undefined') window.location.href = mcReturnUrl;
      return;
    }
    goBack();
  }

  // Not-qualified branch CTA. Routes the consumer straight to the screen whose
  // data caused the disqualification (disqualStepTarget maps the decision's
  // reason → step key) instead of always dropping them on vehicle_add. Falls
  // back to s1_credit, then step 0, when the target step isn't in the current
  // sequence (e.g. s1_co_app_decision is absent in the customer flow). No refi
  // API call fires on this path.
  function goToFailedStep(): void {
    const target = disqualStepTarget(finalDecision);
    let idx = target ? sequence.indexOf(target.step) : -1;
    if (idx < 0) idx = sequence.indexOf('s1_credit');
    if (idx < 0) idx = 0;
    track('refi.stage1.requalify_step', {
      surface: 'RefiWizard',
      result: finalDecision?.result,
      reason: finalDecision?.reason,
      step: sequence[idx],
    });
    setStepIdx(idx);
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

  // Real API hook. submitPrequal NO LONGER fires on entry to decision_engine —
  // "Submit for prequal" only lands the consumer on the local-decision preview.
  // The API fires from goToStageTwo() ("Continue to Stage 2"), and only for a
  // qualified application. In DEV CONTROLS force-mode (forcePartner/forceResult
  // != 'auto') the hook falls back to runDecision() internally, so DEV CONTROLS
  // overrides continue to work without network calls.
  const { submitPrequal, decision: apiDecision } = useRefiPrequal();
  const submittedRef = useRef(false);
  const disqualifiedRef = useRef(false);

  // Reset the fire-once flags when the user navigates away from the decision /
  // stage-2 steps (e.g. back to vehicle_add to re-enter VIN) so a re-entry
  // triggers a fresh API call on the next "Continue to Stage 2" / disqualify.
  useEffect(() => {
    if (stepKey !== 'decision_engine' && stepKey !== 'stage2_result') {
      submittedRef.current = false;
      disqualifiedRef.current = false;
    }
  }, [stepKey]);

  // Prefer the real API decision (set once Stage 2 is entered); fall back to
  // the local runDecision() preview shown on the decision_engine screen and
  // used to gate qualification before any API call.
  const finalDecision = apiDecision ?? decision;

  // When the prequal decision resolves to disqualified, flip the
  // LoanApplicantsExternal to "Disqualified" (POST /api/v3/refi_prequals).
  // Fires once per decision-screen entry; gated to the decision/stage-2 steps
  // so the always-computed local preview can't write on an earlier step.
  // No-op for standalone refi (writeCtx.enabled === false).
  useEffect(() => {
    if (stepKey !== 'decision_engine' && stepKey !== 'stage2_result') return;
    if (finalDecision?.result !== 'disqualified') return;
    if (disqualifiedRef.current) return;
    disqualifiedRef.current = true;
    void disqualifyRefiPrequal(writeCtx, finalDecision.reason);
  }, [stepKey, finalDecision, writeCtx]);

  // Stage 1 screens get the WizardShell chrome. decision_engine +
  // stage2_result render their own. No loading spinner here anymore — the
  // local decision is computed synchronously and shown immediately; the API
  // call is deferred to "Continue to Stage 2" (qualified path only).
  if (stepKey === 'decision_engine') {
    return (
      <>
        {submitError && <SubmitErrorBanner message={submitError} />}
        <DecisionEngine
          decision={finalDecision}
          onDone={goToStageTwo}
          isQualified={isQualifiedDecision(finalDecision)}
          onGoToVehicle={goToFailedStep}
          failedStepLabel={disqualStepTarget(finalDecision)?.label}
          submitting={submitting}
        />
      </>
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
        onComplete={completeAndReturnToMc}
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
      {/* Per-step create-or-update error (direct flow) — surfaced as a form
          breadcrumb so the agent sees the backend's validation / missing-field
          message and can fix it before advancing. IdentityConsent renders its
          own copy via the submitError prop, so skip the duplicate there. */}
      {submitError && stepKey !== 's1_identity_consent' && (
        <SubmitErrorBanner message={submitError} />
      )}
      {stepKey === 'vehicle_add' && <VehicleAdd form={form} update={update} onNext={goNext} busy={stepBusy} locked={vehicleLocked} />}
      {stepKey === 'vehicle_drive' && <VehicleDrive form={form} update={update} onNext={goNext} orgVehicleDefaults={dev?.orgConfig ?? null} busy={stepBusy} locked={vehicleLocked} />}
      {stepKey === 's1_ownership' && <Ownership form={form} update={update} onNext={goNext} busy={stepBusy} />}
      {stepKey === 's1_auto_loan' && <AutoLoan form={form} update={update} onNext={goNext} orgConfig={dev?.orgConfig} />}
      {stepKey === 's1_credit' && <Credit form={form} update={update} onNext={goNext} />}
      {stepKey === 's1_co_app_decision' && <CoAppDecision form={form} update={update} onNext={goNext} />}
      {stepKey === 's1_co_app_contact' && <CoAppContact form={form} update={update} onNext={goNext} />}
      {stepKey === 's1_co_app_employment' && <CoAppEmployment form={form} update={update} onNext={goNext} />}
      {stepKey === 's1_applicant' && <Applicant form={form} update={update} onNext={goNext} busy={stepBusy} />}
      {stepKey === 's1_housing' && <Housing form={form} update={update} onNext={goNext} busy={stepBusy} />}
      {stepKey === 's1_employment' && <Employment form={form} update={update} onNext={goNext} orgConfig={dev?.orgConfig} />}
      {stepKey === 's1_identity_consent' && (
        <IdentityConsent
          form={form}
          update={update}
          onNext={submitPrequalCreate}
          submitting={submitting}
          submitError={submitError}
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
