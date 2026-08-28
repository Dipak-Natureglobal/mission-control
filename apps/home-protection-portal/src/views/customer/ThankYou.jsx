// Customer view · Step 8 — Complete.
//
// Ported from protection-portal's ThankYou with the vehicle eyebrow replaced
// by the covered property, the plan spec line rebuilt around term + deductible
// (a home has no mileage), and the optional coverages itemized — the consumer
// paid for them, so they belong on the receipt.
//
// The agreement number is a Phase 1 placeholder (ADR 30 R4). eContracting is
// not built, so nothing has issued a real ProductAgreementNumber; the
// agreement payload sends an empty string for it and the number shown here is
// a local reference so the consumer and the agent can talk about the same
// deal. It is minted ONCE and persisted to form.agreement_number so a remount
// doesn't hand the consumer a different number.
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, House } from 'lucide-react';
import { track } from 'blinker-platform/telemetry';

function generateOpportunityId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `op_${crypto.randomUUID()}`;
  return `op_${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

// Phase 1 mock in the legacy "AMR2711602690526" shape so mission-control's
// inbox can render it without re-skinning. Replaced by the real remit number
// when eContracting lands.
function generateAgreementNumber() {
  const rand = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2);
  const digits = Array.from(rand)
    .map((c) => String(c.charCodeAt(0) % 10))
    .join('')
    .replace(/[^0-9]/g, '')
    .padEnd(13, '0')
    .slice(0, 13);
  return `OHC${digits}`;
}

function fmtCurrency(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(d);
}

export function ThankYou({ form, update, persona = 'consumer' }) {
  const firedRef = useRef(false);
  void persona; // plumbed for a future agent-side compact variant

  const [agreementNumber] = useState(() => form.agreement_number ?? generateAgreementNumber());

  useEffect(() => {
    if (form.agreement_number !== agreementNumber) {
      update({ agreement_number: agreementNumber });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agreementNumber]);

  const plan = form.selectedPlan || {};
  const contact = form.contact || {};
  const home = form.home || {};
  const schedule = form.paymentSchedule || {};
  const addOns = Array.isArray(form.selectedAddOns) ? form.selectedAddOns : [];
  const firstName = contact.first_name || '';

  const homeLabel = [
    home.square_feet ? `${Number(home.square_feet).toLocaleString()} sq ft` : null,
    home.home_type ? home.home_type.replace(/_/g, ' ') : null,
  ].filter(Boolean).join(' ');
  const cityState = [home.address?.city, home.address?.state].filter(Boolean).join(', ');

  const isMonthlySchedule =
    (schedule.billing_model ?? plan.billing_model) === 'monthly_subscription';

  const monthly = schedule.monthly_payment;
  const paidToday = schedule.due_today;
  const downPayment = schedule.down_payment;
  const monthsToPay = schedule.months_to_pay;
  const paymentDate = schedule.first_payment_date;
  const totalPayments = schedule.total_cost ?? plan.total_cost;

  const planSpec = [
    isMonthlySchedule ? 'Month to month' : (plan.coverage_period_months ? `${plan.coverage_period_months} months` : null),
    plan.deductible != null ? `$${Math.round(plan.deductible)} deductible` : null,
    '$75 service call fee',
  ].filter(Boolean).join(' · ');

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    const opportunityId = form.opportunityId || generateOpportunityId();
    if (!form.opportunityId) {
      update({
        opportunityId,
        agreement_number: agreementNumber,
        status: 'Agreement Signed',
        completedAt: new Date().toISOString(),
      });
    }
    track('home_protection.customer.thank_you.viewed', {
      opportunity_id: opportunityId,
      agreement_number: agreementNumber,
    });
    track('home_protection.customer.flow_completed', {
      opportunity_id: opportunityId,
      agreement_number: agreementNumber,
      plan_code: plan.plan_code,
      tier: plan.tier,
      billing_model: plan.billing_model ?? 'term_total',
      dwelling_class: home.dwelling_class ?? null,
      plan_cost: schedule.plan_cost ?? plan.total_cost ?? null,
      add_ons_total: schedule.add_ons_total ?? 0,
      add_on_count: addOns.length,
      total_cost: schedule.total_cost ?? null,
      template_id: form.docusealTemplateId ?? null,
      submission_id: form.submission_id ?? null,
      second_holder: !!form.secondaryContact?.first_name,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleAgreementClick(kind) {
    return (e) => {
      e.preventDefault();
      // Phase 2 wires the DocuSeal-generated PDF URL here; today the event
      // measures download intent so the funnel can see it.
      track('home_protection.customer.thank_you.agreement_clicked', {
        kind,
        opportunity_id: form.opportunityId,
        agreement_number: agreementNumber,
        submission_id: form.submission_id ?? null,
      });
    };
  }

  return (
    <>
      <div className="px-6 pt-4 flex items-start justify-between gap-3">
        <div className="text-xs uppercase tracking-wide font-semibold text-emerald-700 flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4" />
          Your coverage is complete for:
        </div>
        {(homeLabel || cityState) && (
          <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-full px-3 py-1 capitalize">
            <House className="w-4 h-4 text-slate-500" />
            {homeLabel}{cityState ? ` · ${cityState}` : ''}
          </div>
        )}
      </div>

      <div className="px-6 pt-6 text-center">
        <h2 className="text-2xl font-bold text-slate-900">
          Thank you{firstName ? `, ${firstName}` : ''}!
        </h2>
        <p className="text-sm text-slate-600 mt-2">
          Your home coverage has been activated, and you can close this window.
        </p>
      </div>

      <div className="px-6 mt-6 text-center">
        <div className="text-base font-semibold text-slate-900">{plan.plan_name || 'Coverage'}</div>
        {planSpec && <div className="text-xs text-slate-500 mt-1">{planSpec}</div>}
      </div>

      {addOns.length > 0 && (
        <div className="px-6 mt-5">
          <div className="border border-slate-200 rounded-md overflow-hidden">
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-100">
              <span className="text-xs uppercase tracking-wide font-semibold text-slate-600">
                Optional coverages included
              </span>
            </div>
            <div className="px-4 py-3 space-y-2">
              {addOns.map((a) => (
                <Line key={a.key} label={a.label || a.key} value={fmtCurrency(a.price)} muted />
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="px-6 mt-5">
        <div className="border border-slate-200 rounded-md overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-sm text-slate-700 font-medium">
              {isMonthlySchedule ? 'Monthly charge' : 'Monthly payment'}
            </span>
            <span className="text-xl font-bold text-slate-900">
              {isMonthlySchedule ? `${fmtCurrency(monthly)}/mo` : fmtCurrency(monthly)}
            </span>
          </div>
          <div className="px-4 py-3 space-y-2 text-sm">
            {isMonthlySchedule ? (
              <>
                <Line label="Charged today" value={fmtCurrency(paidToday)} highlight />
                <Line label="First monthly charge" value={fmtDate(paymentDate)} muted />
                <Line label="Billing" value="Recurring monthly · cancel anytime" muted />
              </>
            ) : (
              <>
                <Line label="Paid today" value={fmtCurrency(paidToday)} highlight />
                <Line label="Down payment" value={fmtCurrency(downPayment)} muted />
                {schedule.add_ons_total > 0 && (
                  <Line label="Optional coverages" value={fmtCurrency(schedule.add_ons_total)} muted />
                )}
                <Line
                  label="Months to pay"
                  value={monthsToPay != null ? `${monthsToPay} months` : '—'}
                  muted
                />
                <Line label="Payment date" value={fmtDate(paymentDate)} muted />
                <Line label="Total payments" value={fmtCurrency(totalPayments)} muted />
              </>
            )}
          </div>
        </div>
      </div>

      <div className="px-6 mt-6 text-center">
        <div className="text-sm font-bold text-slate-900 tracking-wide">
          Agreement # {agreementNumber}
        </div>
        <div className="mt-3 flex flex-col items-center gap-1.5">
          <a
            href="#"
            onClick={handleAgreementClick('product')}
            className="text-sm text-blue-600 underline hover:text-blue-800"
          >
            Home Protection Agreement
          </a>
          <a
            href="#"
            onClick={handleAgreementClick('payment')}
            className="text-sm text-blue-600 underline hover:text-blue-800"
          >
            Payment Agreement
          </a>
        </div>
        {/* ADR 30 R4 — this is a local reference, not a remit number. */}
        <div className="mt-2 text-[10px] text-slate-400">
          Reference number — your official agreement number arrives by email once
          the plan is registered.
        </div>
      </div>

      {form.secondaryContact?.first_name && (
        <div className="px-6 mt-4 text-xs text-slate-600 text-center">
          Also on this agreement:{' '}
          {[form.secondaryContact.first_name, form.secondaryContact.last_name].filter(Boolean).join(' ')}
        </div>
      )}

      <div className="px-6 mt-6 text-[11px] text-slate-400 text-center">
        Reference: {form.opportunityId || '(generating…)'}
      </div>

      <div className="h-6" />
    </>
  );
}

function Line({ label, value, highlight, muted }) {
  return (
    <div className="flex items-center justify-between">
      <span className={'text-xs ' + (muted ? 'text-slate-500' : 'text-slate-700 font-medium')}>{label}</span>
      <span
        className={
          'text-sm font-semibold ' +
          (highlight ? 'text-rose-600' : muted ? 'text-slate-700' : 'text-slate-900')
        }
      >
        {value}
      </span>
    </div>
  );
}
