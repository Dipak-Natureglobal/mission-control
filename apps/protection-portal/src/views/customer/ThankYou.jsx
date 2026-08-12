// Customer view · Step 11 — Thank You.
//
// Final card. Lifted shape from BlinkerLegacy/.../screens/14-consumer-thank-you.md
// and the legacy "Thank you, STACEY!" reference layout — vehicle eyebrow in
// top-right, plan summary line, bordered payment box, agreement number,
// product/payment agreement download links. Both customer and agent personas
// render this identically today; persona is now threaded so a future
// agent-side variant (compact header / "copy reference" affordance per
// AgentView _TODO) can branch without re-plumbing.
//
// Phase 1 stubs the agreement number client-side. Phase 2 wires it from
// `blinkerApi.protection.agreements.get(opportunity_id)` once StoneEagle
// remit returns the real AMR number, and replaces the agreement download
// hrefs with DocuSeal-generated PDF URLs.
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Car, RefreshCw } from 'lucide-react';
import { track } from 'blinker-platform/telemetry';

function generateOpportunityId() {
  // Phase 1 placeholder. Real opportunity ID comes from the backend on
  // package create. Format mirrors the legacy `customer_token` UUID
  // shape so the agent inbox can render it without re-skinning.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `op_${crypto.randomUUID()}`;
  return `op_${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function generateAgreementNumber() {
  // Phase 1 mock. Phase 2 wires this from
  // `blinkerApi.protection.agreements.get(opportunity_id)` once
  // StoneEagle remit lands. Format: AMR + 13 digits to match the
  // legacy "AMR2711602690526" pattern.
  const rand = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2);
  // Hex → digits-only by hashing to numeric chars; pad to ensure 13 digits.
  const digits = Array.from(rand)
    .map((c) => {
      const code = c.charCodeAt(0);
      return String(code % 10);
    })
    .join('')
    .replace(/[^0-9]/g, '')
    .padEnd(13, '0')
    .slice(0, 13);
  return `AMR${digits}`;
}

function fmtCurrency(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(value) {
  // Accept either an ISO string, an already-formatted "May 22, 2026"-style
  // string from Confirm, or a Date. Normalize via Intl.DateTimeFormat so
  // the legacy "May 22, 2026" pattern shows up consistently.
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(d);
}

export function ThankYou({ form, update, persona = 'consumer' }) {
  const firedRef = useRef(false);

  // Stable agreement number — generate once and persist to
  // form.agreement_number on first render so a remount (e.g., user
  // navigates away and back, or a parent re-keys) reuses the existing
  // value instead of re-minting. Phase 2 reads this from the API
  // response and falls back to the local mock only if the call fails.
  const [agreementNumber] = useState(
    () => form.agreement_number ?? generateAgreementNumber(),
  );

  useEffect(() => {
    if (form.agreement_number !== agreementNumber) {
      update({ agreement_number: agreementNumber });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agreementNumber]);
  // persona prop is plumbed for future agent-side variants (compact
  // header tweak per AgentView _TODO). No persona-derived branching
  // here today — kept in scope so callers don't have to add a prop
  // later.
  void persona;

  const plan = form.selectedPlan || {};
  const contact = form.contact || {};
  const schedule = form.paymentSchedule || {};
  const ymmt = [form.year, form.make, form.model].filter(Boolean).join(' ');
  const firstName = contact.first_name || '';

  // Payment math — prefer `paymentSchedule` written by Confirm; fall back
  // to deriving from the plan if the user reaches ThankYou via DEV jump.
  const monthly = schedule.monthly_payment;
  const paidToday = schedule.due_today;
  const downPayment = schedule.down_payment;
  // _TODO: VIP Activation is a future canon field for orgs that charge a
  // VIP activation fee at remit. Wire from `org_config.vip_activation_fee`
  // once that lands; default $0.00 covers the ~95% case today.
  const vipActivation = 0;
  const monthsToPay = schedule.months_to_pay;
  const paymentDate = schedule.first_payment_date;
  const totalPayments = schedule.total_cost ?? plan.total_cost;
  // Wave 38: monthly-membership variant. Prefer the schedule's billing_model
  // (written by Confirm), fall back to the selected plan's. Missing ⇒ term.
  const isMonthlySchedule =
    (schedule.billing_model ?? plan.billing_model) === 'monthly_subscription';

  // Plan spec line: "60mo / 50000mi $100 Deductible".
  const planSpec = [
    plan.term_months ? `${plan.term_months}mo` : null,
    plan.miles ? `${Number(plan.miles).toLocaleString()}mi` : null,
    plan.deductible != null ? `$${Math.round(plan.deductible)} Deductible` : null,
  ].filter(Boolean).join(' / ');

  const isRefunded = !!(form.opportunityFlags?.refunded);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    const opportunityId = form.opportunityId || generateOpportunityId();
    if (!form.opportunityId) {
      update({
        opportunityId,
        agreement_number: agreementNumber,
        status: isRefunded ? 'refunded' : 'completed',
        completedAt: new Date().toISOString(),
      });
    }
    track('protection.customer.thank_you.viewed', {
      opportunity_id: opportunityId,
      agreement_number: agreementNumber,
      refunded_variant: isRefunded,
    });
    if (isRefunded) {
      track('protection.customer.thank_you.refunded_variant_shown', {
        opportunity_id: opportunityId,
        refund_id: form.refund?.refund_id ?? null,
        rates_change_kind: form.ratesChangeKind ?? null,
      });
    } else {
      track('protection.customer.flow_completed', {
        opportunity_id: opportunityId,
        agreement_number: agreementNumber,
        plan_code: plan.plan_code,
        tier: plan.tier,
        total_cost: plan.total_cost,
        had_vin_at_quote: form.vehicle?.source === 'vin' || form.vehicle?.source === 'vin_confirmed',
        vin_validated_post_payment: !!form.vinValidate,
        flag_agent_review: !!form.flagAgentReview,
        requires_business_use: !!form.requiresBusinessUse,
        vehicle_revised: !!form.opportunityFlags?.vehicle_revised,
        plan_repicked:   !!form.opportunityFlags?.plan_repicked,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleProductAgreement(e) {
    e.preventDefault();
    // Phase 2 wires DocuSeal-generated PDF URLs. For now, fire the event
    // so funnel analytics can measure download intent.
    track('protection.customer.thank_you.product_agreement_clicked', {
      opportunity_id: form.opportunityId,
      agreement_number: agreementNumber,
    });
  }

  function handlePaymentAgreement(e) {
    e.preventDefault();
    // Phase 2 wires DocuSeal-generated PDF URLs.
    track('protection.customer.thank_you.payment_agreement_clicked', {
      opportunity_id: form.opportunityId,
      agreement_number: agreementNumber,
    });
  }

  // ── Refund variant ────────────────────────────────────────────────────────
  if (isRefunded) {
    return (
      <>
        <div className="px-6 pt-4 flex items-start justify-between gap-3">
          <div className="text-xs uppercase tracking-wide font-semibold text-blue-700 flex items-center gap-1.5">
            <RefreshCw className="w-4 h-4" />
            Down payment refunded
          </div>
          {ymmt && (
            <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-full px-3 py-1">
              <Car className="w-4 h-4 text-slate-500" />
              {ymmt}
            </div>
          )}
        </div>

        <div className="px-6 pt-6 text-center">
          <h2 className="text-2xl font-bold text-slate-900">
            Your down payment has been refunded
          </h2>
          <p className="text-sm text-slate-600 mt-2">
            We&apos;re sorry we couldn&apos;t find the right coverage for your VIN. Your refund will appear in 5–7 business days.
          </p>
        </div>

        {form.refund?.refund_id && (
          <div className="px-6 mt-6 text-center">
            <div className="text-sm font-bold text-slate-900 tracking-wide">
              Refund reference: {form.refund.refund_id}
            </div>
          </div>
        )}

        <div className="px-6 mt-5">
          <div className="border border-blue-100 rounded-md bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <div className="font-semibold mb-1">What happens next</div>
            <ul className="list-disc list-inside space-y-1 text-[13px]">
              <li>Your refund will post within 5–7 business days to the original payment method.</li>
              <li>If your coverage needs changed, you can restart the process anytime.</li>
              <li>Have questions? Call us or contact your dealer.</li>
            </ul>
          </div>
        </div>

        {form.opportunityFlags?.manual_review_requested && (
          <div className="px-6 mt-4 text-xs text-amber-700 text-center">
            <span className="font-semibold">Flagged for review:</span> an agent will process your refund manually within 1 business day.
          </div>
        )}

        <div className="px-6 mt-6 text-[11px] text-slate-400 text-center">
          Reference: {form.opportunityId || '(generating…)'}
        </div>

        <div className="h-6" />
      </>
    );
  }

  // ── Normal (coverage activated) variant ──────────────────────────────────
  return (
    <>
      {/* Vehicle eyebrow — top-right, mirrors the legacy "2014 Toyota Tundra 🚗" pattern. */}
      <div className="px-6 pt-4 flex items-start justify-between gap-3">
        <div className="text-xs uppercase tracking-wide font-semibold text-emerald-700 flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4" />
          Your coverage is complete for:
        </div>
        {ymmt && (
          <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-full px-3 py-1">
            <Car className="w-4 h-4 text-slate-500" />
            {ymmt}
          </div>
        )}
      </div>

      <div className="px-6 pt-6 text-center">
        <h2 className="text-2xl font-bold text-slate-900">
          Thank you{firstName ? `, ${firstName}` : ''}!
        </h2>
        <p className="text-sm text-slate-600 mt-2">
          Your coverage has been activated, and you can close this window.
        </p>
      </div>

      <div className="px-6 mt-6 text-center">
        <div className="text-base font-semibold text-slate-900">{plan.plan_name || 'Coverage'}</div>
        {planSpec && (
          <div className="text-xs text-slate-500 mt-1">
            {plan.plan_name ? `${plan.plan_name}: ` : ''}{planSpec}
          </div>
        )}
      </div>

      <div className="px-6 mt-5">
        <div className="border border-slate-200 rounded-md overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-sm text-slate-700 font-medium">
              {isMonthlySchedule ? 'Monthly Charge' : 'Monthly Payment'}
            </span>
            <span className="text-xl font-bold text-slate-900">
              {isMonthlySchedule ? `${fmtCurrency(monthly)}/mo` : fmtCurrency(monthly)}
            </span>
          </div>
          <div className="px-4 py-3 space-y-2 text-sm">
            {isMonthlySchedule ? (
              <>
                <Line label="Charged today" value={fmtCurrency(paidToday)} highlight />
                <Line label="VIP Activation" value={fmtCurrency(vipActivation)} muted />
                <Line label="First monthly charge" value={fmtDate(paymentDate)} muted />
                <Line label="Billing" value="Recurring monthly · unlimited miles · cancel anytime" muted />
              </>
            ) : (
              <>
                <Line label="Paid today" value={fmtCurrency(paidToday)} highlight />
                <Line label="Down payment" value={fmtCurrency(downPayment)} muted />
                <Line label="VIP Activation" value={fmtCurrency(vipActivation)} muted />
                <Line label="Months to pay" value={monthsToPay != null ? `${monthsToPay} months` : '—'} muted />
                <Line label="Payment Date" value={fmtDate(paymentDate)} muted />
                <Line label="Total Payments" value={fmtCurrency(totalPayments)} muted />
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
            onClick={handleProductAgreement}
            className="text-sm text-blue-600 underline hover:text-blue-800"
          >
            Product Agreement
          </a>
          <a
            href="#"
            onClick={handlePaymentAgreement}
            className="text-sm text-blue-600 underline hover:text-blue-800"
          >
            Payment Agreement
          </a>
        </div>
      </div>

      {form.flagAgentReview && (
        <div className="px-6 mt-5 text-xs text-amber-700 text-center">
          <span className="font-semibold">Heads up:</span> the modifications you flagged are being
          reviewed by an agent. We'll reach out if anything affects your coverage.
        </div>
      )}

      {form.opportunityFlags?.vehicle_revised && (
        <div className="px-6 mt-3 text-xs text-blue-700 text-center">
          <span className="font-semibold">Note:</span> your vehicle details were updated during VIN verification.
        </div>
      )}

      <div className="px-6 mt-6 text-[11px] text-slate-400 text-center">
        Reference: {form.opportunityId || '(generating…)'}
      </div>

      {/* _TODO (persona): when persona === 'agent', mission-control wants a
          compact agent-side header tweak (agreement # + opportunity_id +
          a "copy reference" affordance). The persona prop is now threaded
          here (CustomerView → ProtectionWizard → ThankYou); wire the
          actual variant in §1.6 alongside the agent inbox handoff work. */}

      <div className="h-6" />
    </>
  );
}

function Line({ label, value, highlight, muted }) {
  return (
    <div className="flex items-center justify-between">
      <span className={'text-xs ' + (muted ? 'text-slate-500' : 'text-slate-700 font-medium')}>{label}</span>
      <span className={
        'text-sm font-semibold ' +
        (highlight ? 'text-red-600' : muted ? 'text-slate-700' : 'text-slate-900')
      }>{value}</span>
    </div>
  );
}
