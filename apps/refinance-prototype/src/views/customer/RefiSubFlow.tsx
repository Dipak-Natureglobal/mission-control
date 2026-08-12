// RefiSubFlow — step-by-step wizard entry point for cross-sell hosts.
//
// The complement to PrequalForm. Where PrequalForm collects applicant +
// employment + housing in a single condensed scroll, RefiSubFlow wraps
// the actual multi-step RefiWizard so the consumer walks through the
// same screens a standalone refi customer would. The defining use case
// is protection-portal's "Find refinance savings" cross-sell, which
// already has the contact + vehicle on file: it can pre-fill those and
// drop the consumer at s1_ownership (the first refi-specific question)
// rather than re-asking for fields the host already collected upstream.
//
// onComplete payload mirrors PrequalForm exactly so embedders'
// QualifiedCard / OffersCard / DisqualifiedCard / PendingCard render
// without any branching on which entry surface produced the decision.
//
// Co-applicant prefill: when `coApplicant` is non-null, RefiSubFlow flips
// form.hasCoApplicant=true and pre-populates coAppFirst/coAppLast/
// coAppEmail/coAppPhone/coAppRelationship from the canonical mission-
// control "household member" shape. The wizard's s1_co_app_decision
// screen will land with the answer pre-selected; CoAppContact lands with
// the four contact fields already filled, leaving the consumer to
// confirm + add SSN / DOB / employment further along.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FC } from 'react';
import { X } from 'lucide-react';
import { RefiWizard, INITIAL_FORM } from './RefiWizard';
import { useRefiPrequal, getSequence } from '../../lib/refi';
import { MOCK_OFFERS } from '../../constants/mock-data';
import {
  RELATIONSHIP_OPTIONS,
} from '../../refinance-v2-prototype';
import { track } from 'blinker-platform/telemetry';
import type { RefiForm, WizardDevOptions, Persona, ScreenKey, Decision, RefiOffer } from '../../types';

// Shape of the external co-applicant payload passed by embedding hosts
// (e.g. mission-control's household-member object).
type CoApplicantPayload = {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string | null;
  relationship?: string;
};

// Strip a leading "+1" or "1" country prefix from a US phone number — the
// canonical mission-control household-member phone shape may include one,
// the wizard's coAppPhone field stores 10 raw digits.
function stripPlusOne(raw: string | number | null | undefined): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits.slice(0, 10);
}

// Map a free-text relationship onto the canonical RELATIONSHIP_OPTIONS
// list (case-insensitive). If no match, fall back to "Other" + stash the
// raw string in coAppRelationshipOther — same convention as
// App.jsx's buildPrefillPatch().
function mapRelationship(rel: string | undefined): { coAppRelationship: string; coAppRelationshipOther: string } {
  if (!rel) return { coAppRelationship: '', coAppRelationshipOther: '' };
  const found = RELATIONSHIP_OPTIONS.find(
    (o) => o.toLowerCase() === String(rel).toLowerCase()
  );
  if (found) {
    return { coAppRelationship: found, coAppRelationshipOther: '' };
  }
  return {
    coAppRelationship: 'Other',
    coAppRelationshipOther: String(rel),
  };
}

// Build the seeded form by merging prefilledForm + coApplicant onto
// INITIAL_FORM. Vehicle + applicant fields write through directly;
// coApplicant fields fan out to the canonical coApp* slots.
function buildInitialForm(prefilledForm: Partial<RefiForm> | null | undefined, coApplicant: CoApplicantPayload | null): RefiForm {
  const next: RefiForm = { ...INITIAL_FORM };
  if (prefilledForm) {
    if (prefilledForm.firstName  !== undefined) next.firstName  = prefilledForm.firstName;
    if (prefilledForm.lastName   !== undefined) next.lastName   = prefilledForm.lastName;
    if (prefilledForm.email      !== undefined) next.email      = prefilledForm.email;
    if (prefilledForm.phone      !== undefined) next.phone      = stripPlusOne(prefilledForm.phone);
    if (prefilledForm.address    !== undefined) next.address    = prefilledForm.address;
    if (prefilledForm.city       !== undefined) next.city       = prefilledForm.city;
    if (prefilledForm.state      !== undefined) next.state      = prefilledForm.state;
    if (prefilledForm.zip        !== undefined) next.zip        = prefilledForm.zip;
    if (prefilledForm.vin        !== undefined) next.vin        = prefilledForm.vin.toUpperCase();
    if (prefilledForm.year       !== undefined) next.year       = prefilledForm.year;
    if (prefilledForm.make       !== undefined) next.make       = prefilledForm.make;
    if (prefilledForm.model      !== undefined) next.model      = prefilledForm.model;
    if (prefilledForm.trim       !== undefined) next.trim       = prefilledForm.trim;
    if (prefilledForm.mileage    !== undefined) next.mileage    = prefilledForm.mileage;
    if (prefilledForm.condition  !== undefined) next.condition  = prefilledForm.condition;
    if (prefilledForm.org_id     !== undefined) next.org_id     = prefilledForm.org_id;
  }
  if (coApplicant) {
    next.hasCoApplicant = true;
    next.coAppFirst = coApplicant.first_name || '';
    next.coAppLast = coApplicant.last_name || '';
    next.coAppEmail = coApplicant.email || '';
    next.coAppPhone = stripPlusOne(coApplicant.phone);
    const relPatch = mapRelationship(coApplicant.relationship);
    next.coAppRelationship = relPatch.coAppRelationship;
    next.coAppRelationshipOther = relPatch.coAppRelationshipOther;
  }
  return next;
}

/**
 * RefiSubFlow — host-embedding wrapper around RefiWizard with applicant
 * + co-applicant prefill and configurable starting step.
 *
 * @param {object} props
 * @param {object} [props.prefilledForm] - applicant + vehicle prefill;
 *   shape mirrors INITIAL_FORM keys (firstName, lastName, email, phone,
 *   address, city, state, zip, vin, year, make, model, trim, mileage,
 *   condition, org_id).
 * @param {object|null} [props.coApplicant] - household member; shape
 *   `{ first_name, last_name, email, phone, relationship? }`. When
 *   present, sets form.hasCoApplicant=true.
 * @param {string} [props.startStep='s1_ownership'] - initial wizard step
 *   key; resolved against getSequence(form, hasCoApp). Falls back to 0
 *   if the key isn't found.
 * @param {(payload: object) => void} [props.onComplete] - fires once
 *   when the wizard's decision_engine produces a decision. Payload shape
 *   matches PrequalForm.onComplete: { partner, partnerName, partnerPhone,
 *   result, reason, ruleId, log, externalApplicationId, valuation, offers }.
 * @param {() => void} [props.onCancel] - fires when the user clicks the
 *   Cancel link in the chrome.
 * @param {'agent'|'manager'|'admin'|'super_admin'|'consumer'} [props.persona='consumer']
 * @param {boolean} [props.personaLocked=true] - cross-sell embeds always
 *   have parent-controlled persona; informational today.
 *
 * @returns {JSX.Element}
 */
interface RefiSubFlowProps {
  prefilledForm?: Partial<RefiForm> | null;
  coApplicant?: CoApplicantPayload | null;
  startStep?: ScreenKey;
  onComplete?: (result: Decision & { offers: RefiOffer[] }) => void;
  onCancel?: () => void;
  persona?: Persona;
  personaLocked?: boolean;
  dev?: Partial<WizardDevOptions>;
}

export const RefiSubFlow: FC<RefiSubFlowProps> = ({
  prefilledForm,
  coApplicant = null,
  startStep = 's1_ownership',
  onComplete,
  onCancel,
  persona = 'consumer',
  personaLocked = true,
}) => {
  // persona / personaLocked accepted for embed-contract parity; today
  // they're informational (forward-compat for copy variants).
  void persona;
  void personaLocked;

  const seeded = useMemo(
    () => buildInitialForm(prefilledForm, coApplicant),
    [prefilledForm, coApplicant]
  );

  const [form, setForm] = useState(seeded);
  const update = (patch: Partial<RefiForm>): void => setForm((prev) => ({ ...prev, ...patch }));

  // Derive the sequence at the same `effectiveHasCoApp` the wizard uses
  // (the wizard reads form.hasCoApplicant when no override is passed).
  // For startStep resolution we use the seeded form so the index lookup
  // is stable on first mount even if the user later flips
  // hasCoApplicant in s1_co_app_decision.
  const initialStepIdx = useMemo(() => {
    const seq = getSequence(seeded, seeded.hasCoApplicant === true);
    const idx = seq.indexOf(startStep);
    return idx >= 0 ? idx : 0;
  }, [seeded, startStep]);

  const [stepIdx, setStepIdx] = useState(initialStepIdx);

  // Subscribe to the decision via useRefiPrequal — same hook PrequalForm
  // uses, so onComplete fires from the same source of truth.
  const { submitPrequal, decision } = useRefiPrequal({
    contactId: null,
    vehicleId: form.vin || null,
  });

  // Track the step we're rendering so we can fire submitPrequal exactly
  // once when the wizard transitions to decision_engine.
  const sequence = useMemo(
    () => getSequence(form, form.hasCoApplicant === true),
    [form]
  );
  const stepKey = sequence[Math.min(stepIdx, sequence.length - 1)];

  const submittedRef = useRef(false);
  useEffect(() => {
    if (stepKey === 'decision_engine' && !submittedRef.current) {
      submittedRef.current = true;
      submitPrequal(form, {
        includeSsn: !!form.ssn,
        hasCoApp: form.hasCoApplicant === true,
      });
    }
  }, [stepKey, form, submitPrequal]);

  // Fire onComplete exactly once when the decision lands. Mirrors
  // PrequalForm's offers-injection so embedders don't have to synthesize
  // a fallback for non-offers branches.
  const completedRef = useRef(false);
  useEffect(() => {
    if (decision && !completedRef.current) {
      completedRef.current = true;
      const offers = decision.result === 'offers_returned' ? MOCK_OFFERS : [];
      const payload = { ...decision, offers };
      track('refi.subflow.completed', {
        result: decision.result,
        partner: decision.partner,
        surface: 'RefiSubFlow',
      });
      onComplete?.(payload);
    }
  }, [decision, onComplete]);

  // PostHog open event — fires once on mount.
  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    track('refi.subflow.opened', {
      start_step: startStep,
      has_co_app_prefill: !!coApplicant,
      has_vehicle_prefill: !!(prefilledForm && (prefilledForm.vin || prefilledForm.year)),
      surface: 'RefiSubFlow',
    });
    // intentionally fire once on mount; deps are seed-only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCancel(): void {
    track('refi.subflow.cancelled', {
      step: stepKey,
      surface: 'RefiSubFlow',
    });
    onCancel?.();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-4 py-2.5 shadow-sm">
        <div className="text-xs">
          <div className="font-semibold text-slate-700">Refi prequal — pre-filled</div>
          <div className="text-[11px] text-slate-500">
            We pre-filled the fields your host app already collected. Confirm and continue.
          </div>
        </div>
        {onCancel && (
          <button
            onClick={handleCancel}
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded-md hover:bg-slate-100"
          >
            <X className="w-3 h-3" /> Cancel
          </button>
        )}
      </div>
      <RefiWizard
        form={form}
        update={update}
        stepIdx={stepIdx}
        setStepIdx={setStepIdx}
      />
    </div>
  );
};
