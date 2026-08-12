// PrequalForm — slim single-page condensed prequal form for embed.
//
// This is the public surface that protection-portal's RecommendedCoverage
// (planned § 1.5d) embeds inside its "Find refinance savings" affordance.
// It is NOT the full multi-screen RefiWizard. It collects the minimum
// fields needed for the decision engine to route to a partner — applicant
// contact, employment, housing — in a single scroll, then submits via
// useRefiPrequal() and hands the resulting decision to the parent via
// onComplete.
//
// Field selection rationale (condensed from Applicant + Employment +
// Housing screens of the full wizard):
//
//   Applicant block  : firstName, lastName, phone, email
//                      (DOB intentionally NOT included — Applicant.jsx
//                       collects it on its own screen behind a soft
//                       "we'll need this for the credit pull" prompt;
//                       embed callers can pass DOB via prefill or defer
//                       to the post-prequal flow)
//   Employment block : employer, employmentType, income (annual)
//                      (startDate omitted — optional in the full flow,
//                       not required for prequal routing)
//   Housing block    : zip, ownRent, housingPayment
//                      (full address + city/state autocomplete dropped —
//                       the embed uses ZIP-only as a coarse signal; the
//                       full address comes back later in the multi-screen
//                       wizard if the consumer continues. moveInDate
//                       same — defer to full flow)
//
// SSN / consent are NOT collected here. The refi decision engine reads
// `includeSsn` as a routing flag (Savings Group is no-SSN; Gravity
// requires SSN). For embed, we default `includeSsn: false` so the
// decision routes to Savings Group when otherwise eligible — this
// mirrors the protection-portal flow where the consumer hasn't yet
// agreed to a credit pull.
//
// Consumed by: protection-portal/src/views/customer/RecommendedCoverage.jsx (planned § 1.5d)

import { useMemo, useState } from 'react';
import type { FC } from 'react';
import { Briefcase, Home, User } from 'lucide-react';
import {
  ScreenHeader,
  WizardFooter,
} from 'blinker-platform/components';
import {
  Field,
  PhoneField,
  SelectField,
} from 'blinker-platform/components';
import { useForm } from '../../hooks/useForm';
import {
  EMPLOYMENT_TYPES,
  HOUSING_OPTIONS,
  validators,
  sanitizeNumeric,
} from '../../refinance-v2-prototype';
import { useRefiPrequal } from '../../lib/refi';
import { MOCK_OFFERS } from '../../constants/mock-data';
import { track } from 'blinker-platform/telemetry';
import type { Persona, RefiForm, Decision, RefiOffer } from '../../types';

const INITIAL = {
  // applicant
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  // employment
  employer: '',
  employmentType: '',
  income: '',
  // housing
  zip: '',
  ownRent: null,
  housingPayment: '',
};

// Consumed by: protection-portal/src/views/customer/RecommendedCoverage.jsx (planned § 1.5d)
interface PrequalFormProps {
  persona?: Persona;
  personaLocked?: boolean;
  onComplete?: (result: Decision & { offers: RefiOffer[] }) => void;
  contactId?: string | null;
  vehicleId?: string | null;
  initialValues?: Partial<{
    firstName: string; lastName: string; phone: string; email: string;
    employer: string; employmentType: string; income: string;
    zip: string; ownRent: string | null; housingPayment: string;
  }>;
}

export const PrequalForm: FC<PrequalFormProps> = ({
  persona = 'consumer',
  personaLocked = false,
  onComplete,
  contactId,
  vehicleId,
  initialValues,
}) => {
  // persona / personaLocked are accepted to match the embed contract on
  // every public refi-portal export; today they're informational
  // (forward-compat for copy variants).
  void persona;
  void personaLocked;
  const [form, update] = useForm({ ...INITIAL, ...(initialValues || {}) });
  const { submitPrequal, prequalState, decision } = useRefiPrequal({
    contactId,
    vehicleId,
  });

  const [submitted, setSubmitted] = useState(false);

  const errs = useMemo(
    () => ({
      firstName: validators.required(form.firstName),
      lastName: validators.required(form.lastName),
      phone: validators.required(form.phone) || validators.usPhone(form.phone),
      email: validators.required(form.email) || validators.email(form.email),
      employer: validators.required(form.employer),
      employmentType: validators.required(form.employmentType),
      income:
        validators.required(form.income) ||
        validators.positiveCurrency(form.income),
      zip: validators.required(form.zip) || validators.zip(form.zip),
      ownRent: validators.required(form.ownRent),
      housingPayment:
        validators.required(form.housingPayment) ||
        validators.positiveCurrency(form.housingPayment),
    }),
    [form]
  );

  const ok = Object.values(errs).every((e) => !e);
  const isSubmitting = submitted && prequalState === 'idle';

  function handleSubmit() {
    if (!ok) return;
    setSubmitted(true);
    track('refi.prequal.submitted', {
      contact_id: contactId || null,
      vehicle_id: vehicleId || null,
      surface: 'PrequalForm',
    });
    // Embed default: no SSN provided → routes Savings Group when
    // otherwise eligible. Consumers can override by passing through
    // their own runDecision wrapper if/when they collect SSN inline.
    const next = submitPrequal(form as Partial<RefiForm>, { includeSsn: false });
    // Mirror useRefiPrequal's offers derivation — but compute from `next`
    // directly because the hook's `offers` is useMemo'd on the React
    // `decision` state, which hasn't re-rendered yet inside this handler.
    // Always include the offers field (empty array for non-offers branches)
    // so embedders can render OffersCard without synthesizing placeholders.
    const offers = next.result === 'offers_returned' ? MOCK_OFFERS : [];
    onComplete?.({ ...next, offers });
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <ScreenHeader
        icon={User}
        eyebrow="Refinance · Prequal"
        title="See if you qualify for a better rate"
        subtitle="A few details — no SSN, no hard pull. We use this to match you to a refinance partner."
      />

      {/* Applicant block */}
      <div className="px-6 pb-2">
        <div className="text-xs uppercase tracking-wide font-semibold text-slate-500 mb-2 flex items-center gap-2">
          <User className="w-3 h-3" /> Applicant
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="First name"
            value={form.firstName}
            onChange={(v) => update({ firstName: v })}
            placeholder="First name"
          />
          <Field
            label="Last name"
            value={form.lastName}
            onChange={(v) => update({ lastName: v })}
            placeholder="Last name"
          />
          <PhoneField
            label="Phone"
            value={form.phone}
            onChange={(v) => update({ phone: v })}
            error={form.phone ? validators.usPhone(form.phone) : null}
          />
          <Field
            label="Email"
            value={form.email}
            onChange={(v) => update({ email: v })}
            placeholder="name@example.com"
            inputMode="email"
            error={form.email ? validators.email(form.email) : null}
          />
        </div>
      </div>

      {/* Employment block */}
      <div className="px-6 pt-4 pb-2">
        <div className="text-xs uppercase tracking-wide font-semibold text-slate-500 mb-2 flex items-center gap-2">
          <Briefcase className="w-3 h-3" /> Employment
        </div>
        <div className="space-y-3">
          <Field
            label="Current employer"
            value={form.employer}
            onChange={(v) => update({ employer: v })}
            placeholder="e.g. Walmart"
          />
          <SelectField
            label="Employment type"
            value={form.employmentType}
            onChange={(v) => update({ employmentType: v })}
            options={EMPLOYMENT_TYPES}
          />
          <Field
            label="Annual income"
            value={form.income}
            onChange={(v) => update({ income: sanitizeNumeric(v) })}
            placeholder="65250"
            prefix="$"
            inputMode="decimal"
            error={form.income ? validators.positiveCurrency(form.income) : null}
          />
        </div>
      </div>

      {/* Housing block */}
      <div className="px-6 pt-4 pb-4">
        <div className="text-xs uppercase tracking-wide font-semibold text-slate-500 mb-2 flex items-center gap-2">
          <Home className="w-3 h-3" /> Housing
        </div>
        <div className="space-y-3">
          <Field
            label="Zip code"
            value={form.zip}
            onChange={(v) => update({ zip: sanitizeNumeric(v, { decimal: false }).slice(0, 5) })}
            placeholder="30305"
            inputMode="numeric"
            maxLength={5}
            error={form.zip ? validators.zip(form.zip) : null}
          />
          <div>
            <div className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wide">Housing status</div>
            <div className="flex gap-2">
              {HOUSING_OPTIONS.map((o) => (
                <button
                  key={o}
                  onClick={() => update({ ownRent: o })}
                  className={
                    'flex-1 py-2 rounded-md border text-sm font-medium ' +
                    (form.ownRent === o
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-slate-200 hover:border-slate-300')
                  }
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
          <Field
            label="Housing monthly payment"
            value={form.housingPayment}
            onChange={(v) => update({ housingPayment: sanitizeNumeric(v) })}
            placeholder="1,450"
            prefix="$"
            inputMode="decimal"
            error={
              form.housingPayment
                ? validators.positiveCurrency(form.housingPayment)
                : null
            }
          />
        </div>
      </div>

      <WizardFooter
        onNext={handleSubmit}
        disabled={!ok || isSubmitting}
        nextLabel={isSubmitting ? 'Checking…' : 'See my offers'}
      />

      {decision && prequalState === 'submitted' && (
        <div className="px-6 pb-4 pt-2 text-[11px] text-slate-400">
          Decision: <span className="font-mono">{decision.result}</span>
          {decision.partner && decision.partner !== 'none' ? ` · ${decision.partner}` : ''}
        </div>
      )}
    </div>
  );
};
