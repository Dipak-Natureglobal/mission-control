// Customer view · Step 5 — Review & confirm.
//
// The last look before payment: the home, the plan, an ITEMIZED list of the
// optional coverages chosen, and the money.
//
// THE ONE THING THAT DIFFERS FROM AUTO (ADR 30 D7)
// -----------------------------------------------
//   totalCost = plan.total_cost + Σ selectedAddOns.price
//
// and EVERY downstream figure derives from that total: the discount ceiling,
// the down payment floor and cap, the monthly payment, the amount due today,
// and the amount actually charged at billing. In protection-portal,
// buildPassthroughForPlan's totalDelta reaches PlanCard for display and never
// touches paymentSchedule, FluidPay, or the completion record. Home optional
// coverages are things the consumer picked and will be billed for, so they
// have to be in the money path — and the same number lands on ProductPrice
// on the signed agreement.
//
// The payment-control math (bidirectional discount clamp, down-payment floor
// and ceiling, first-payment-date bounds, pay-in-full reset) is ported from
// protection-portal/src/views/customer/Confirm.jsx with exactly two changes:
// caps and markup read `org.home_protection_billing` instead of
// `org.protection_billing`, and the discount/down-payment base is `totalCost`
// rather than `plan.total_cost`.
//
// TWO DISCOUNTS, TWO CAP SETS (Wave 39 follow-up)
// -----------------------------------------------
// The plan discount and the optional-coverage discount are separate controls
// with separate ceilings, because they protect different things. The plan cap
// is a margin policy (15% / $150). The add-on cap is a floor: an add-on may
// never be sold below Omega's cost, and because markup and discount apply to
// different bases a naive "discount <= markup" rule does not achieve that —
// break-even at a 30% markup is 23.08%. getHomeDiscountCaps() clamps the
// configured percent to that ceiling and says so via `clamped`, which this
// screen surfaces rather than quietly applying a different number than the
// admin configured. applyAddOnDiscount() then enforces a hard floor at cost
// per row.
//
// MONTHS TO PAY AND THE DOWN PAYMENT
// ----------------------------------
// Both the options and the default come from getHomePaymentTermOptions() for
// the SELECTED COVERAGE TERM — 12-month coverage offers [1, 6] defaulting to
// 6, everything else [1, 6, 12] defaulting to 12. The default down payment is
// ONE MONTHLY PAYMENT (computeHomePaymentPlan: monthly = total / (months + 1),
// where the +1 is the down payment), which is the same basis the coverage step
// quoted, so the number the consumer decided on is the number they are asked
// for.
//
// Monthly branch: identical in shape to ADR 28 D6. Due today is the monthly
// charge, the down-payment and months-to-pay controls are hidden AND not
// seeded, and the monthly discount caps apply. Monthly plans carry no
// optional coverages at all, so the itemized block collapses to the plan.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardCheck, House, ShieldCheck, UserCheck, Calendar,
  Percent, DollarSign, Tag, Settings2, ListChecks,
} from 'lucide-react';
import { ScreenHeader, WizardFooter } from 'blinker-platform/components';
import {
  sumAddOnPrices,
  formatPhoneDisplay,
  getHomePaymentTermOptions,
  getHomeDiscountCaps,
  computeHomePaymentPlan,
} from 'blinker-platform/utils';
import { track } from 'blinker-platform/telemetry';
import { discountAddOns } from '../../lib/home-money.js';
import orgRegistry from '../../constants/canon/org-registry.json' with { type: 'json' };

function fmtCurrency(v) {
  if (v == null) return '—';
  return `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDateLong(iso) {
  if (!iso) return '—';
  // iso is yyyy-mm-dd from the date input; parse as local so the displayed
  // date can't shift a day against what the consumer picked.
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: '2-digit',
  });
}

function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function firstOfNextMonth(today = new Date()) {
  const d = new Date(today);
  d.setMonth(d.getMonth() + 1);
  d.setDate(1);
  return d;
}

function resolveDefaultFirstPaymentDate(billing) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minDays = billing?.first_payment_date?.min_days_from_today ?? 31;
  const maxDays = billing?.first_payment_date?.max_days_from_today ?? 45;
  const minDate = addDays(today, minDays);
  const maxDate = addDays(today, maxDays);
  const strategy = billing?.first_payment_date?.default_strategy || 'first_of_next_month';
  let candidate = strategy === 'first_of_next_month' ? firstOfNextMonth(today) : minDate;
  if (candidate < minDate) candidate = minDate;
  if (candidate > maxDate) candidate = maxDate;
  return toIsoDate(candidate);
}

function getOrg(orgId) {
  return orgRegistry.orgs.find((o) => o.id === orgId);
}

export function Confirm({ form, update, onNext, persona = 'consumer' }) {
  const plan = form.selectedPlan || {};
  const contact = form.contact || {};
  const home = form.home || {};
  const addOns = Array.isArray(form.selectedAddOns) ? form.selectedAddOns : [];

  const isMonthly = plan.billing_model === 'monthly_subscription';
  const monthlyCharge = Number(plan.monthly_charge || 0);

  // ── THE TOTAL (ADR 30 D7) ───────────────────────────────────────────────
  // Add-on dollars are part of the amount financed and the amount charged,
  // not a display line. Monthly plans carry no add-ons, so their base is just
  // the recurring charge.
  const addOnsTotal = sumAddOnPrices(addOns);
  const planTotal = Number(plan.total_cost || 0);
  const totalCost = isMonthly ? monthlyCharge : planTotal + addOnsTotal;

  // Canon-driven billing config — the HOME block, which carries its own
  // margins, discount caps and EFS terms. Null-safe per the architecture/09
  // read pattern: the caller owns null-safety when an org isn't recognized.
  const org = getOrg(form.org_id);
  const billing = org?.home_protection_billing;
  const billingTodo = billing?._TODO ?? null;

  const minPercent = billing?.down_payment?.min_percent ?? 10;
  const maxPercentOfTotal = billing?.down_payment?.max_percent_of_total ?? 75;
  const disabledStates = billing?.discount?.disabled_in_states || ['FL'];

  // Discount is disabled in certain states. Either the billing address on the
  // contact or the covered property's state can trigger it.
  const stateForRules = String(
    contact.state || home.address?.state || '',
  ).toUpperCase();
  const discountDisabled = disabledStates.includes(stateForRules);

  // TWO cap sets. `caps.addOn.max_percent` is already clamped to break-even —
  // `caps.addOn.clamped` says whether that clamp bit.
  const caps = getHomeDiscountCaps({ orgId: form.org_id, state: stateForRules });
  const maxDiscountPercent = caps.plan.max_percent || 15;
  const maxDiscountDollars = caps.plan.max_dollars || 150.0;
  const maxAddOnDiscountPercent = caps.addOn.max_percent;

  // Months to pay: options AND default are per COVERAGE term.
  const coverageTermMonths = plan.coverage_period_months ?? form.coverageTerm ?? null;
  const paymentTerm = getHomePaymentTermOptions({
    orgId: form.org_id,
    coverageTermMonths,
  });
  const monthsOptions = paymentTerm.options_months.length
    ? paymentTerm.options_months
    : [1, 6, 12];
  const monthsDefault = paymentTerm.default_months;

  // The default down payment IS one monthly payment — the same basis the
  // coverage step quoted. Computed off the undiscounted total because it only
  // seeds the control; the live figure below re-derives from the discounted
  // total on every render.
  const seedDownPayment = computeHomePaymentPlan({
    total: totalCost,
    monthsToPay: monthsDefault,
  }).monthly;

  const [previewAgentControls, setPreviewAgentControls] = useState(false);
  const showAgentControls = persona === 'agent' || previewAgentControls;

  // Seed form.payment from canon defaults once, so BillingPayment reads a
  // fully-populated shape and the math hookups stay simple.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    const next = { ...(form.payment || {}) };
    let dirty = false;
    if (next.discount_type == null) { next.discount_type = 'percent'; dirty = true; }
    if (next.discount_value == null) { next.discount_value = 0; dirty = true; }
    if (isMonthly) {
      // Monthly plans have NO down payment and NO finite months-to-pay.
      // Clear anything left over from a term plan the consumer flipped away
      // from — a stale down payment would silently inflate due-today.
      if (next.down_payment_value != null) { next.down_payment_value = null; dirty = true; }
      if (next.down_payment_type != null) { next.down_payment_type = null; dirty = true; }
      if (next.months_to_pay != null) { next.months_to_pay = null; dirty = true; }
    } else {
      // Dollars, not percent: the down payment is one monthly payment, which
      // is a dollar fact about the schedule, not a percentage of the total.
      if (next.down_payment_type == null) { next.down_payment_type = 'dollars'; dirty = true; }
      if (next.down_payment_value == null) { next.down_payment_value = seedDownPayment; dirty = true; }
      if (next.months_to_pay == null || !monthsOptions.includes(next.months_to_pay)) {
        // A months-to-pay carried over from a different coverage term may not
        // be offered at this one (12-month coverage has no 12-payment option).
        next.months_to_pay = monthsDefault;
        dirty = true;
      }
      if (next.add_on_discount_percent == null) { next.add_on_discount_percent = 0; dirty = true; }
    }
    if (next.first_payment_date == null) {
      next.first_payment_date = resolveDefaultFirstPaymentDate(billing);
      dirty = true;
    }
    if (dirty) update({ payment: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const payment = form.payment || {};
  const discountType = payment.discount_type || 'percent';
  const discountValue = Number(payment.discount_value || 0);
  const downType = payment.down_payment_type || 'dollars';
  const downValue = payment.down_payment_value != null ? Number(payment.down_payment_value) : seedDownPayment;
  const months = monthsOptions.includes(payment.months_to_pay) ? payment.months_to_pay : monthsDefault;
  const firstPaymentDate = payment.first_payment_date || resolveDefaultFirstPaymentDate(billing);
  const addOnDiscountValue = Number(payment.add_on_discount_percent || 0);

  // ── PLAN discount ───────────────────────────────────────────────────────
  // Base is the PLAN only. Optional coverages have their own cap set below,
  // because their floor is Omega's cost rather than a margin policy.
  const planDiscountBase = isMonthly ? monthlyCharge : planTotal;
  // Bidirectional clamp: convert the entered value to BOTH dollars and
  // percent, then enforce the min of the two ceilings — the smaller cap wins.
  const discountDollarsCandidate = discountType === 'percent'
    ? (planDiscountBase * discountValue) / 100
    : discountValue;
  const cappedDollars = Math.max(0, Math.min(
    discountDollarsCandidate,
    maxDiscountDollars,
    (planDiscountBase * maxDiscountPercent) / 100,
  ));
  const effectivePlanDiscountDollars = discountDisabled ? 0 : cappedDollars;
  const effectivePlanDiscountPercent = planDiscountBase > 0
    ? Math.round((effectivePlanDiscountDollars / planDiscountBase) * 100 * 100) / 100
    : 0;

  // ── ADD-ON discount ─────────────────────────────────────────────────────
  // Percent only, clamped to the break-even ceiling, and routed through
  // applyAddOnDiscount per row so no coverage can land below Omega's cost.
  const cappedAddOnPercent = discountDisabled || isMonthly
    ? 0
    : Math.max(0, Math.min(addOnDiscountValue, maxAddOnDiscountPercent));
  const addOnDiscount = discountAddOns({
    orgId: form.org_id,
    addOns,
    discountPercent: cappedAddOnPercent,
  });
  const addOnsChargedTotal = isMonthly ? 0 : addOnDiscount.total;
  const effectiveAddOnDiscountDollars = isMonthly ? 0 : addOnDiscount.discount;

  const effectiveDiscountDollars =
    Math.round((effectivePlanDiscountDollars + effectiveAddOnDiscountDollars) * 100) / 100;
  const effectiveDiscountPercent = totalCost > 0
    ? Math.round((effectiveDiscountDollars / totalCost) * 100 * 100) / 100
    : 0;

  const discountedTotal = Math.max(
    0,
    (planDiscountBase - effectivePlanDiscountDollars) + addOnsChargedTotal,
  );

  const safeMonths = months === 1 ? 1 : (months || monthsDefault);
  // One monthly payment — the schedule's own down payment, and the basis the
  // coverage step quoted.
  const oneMonthlyDown = computeHomePaymentPlan({
    total: discountedTotal,
    monthsToPay: safeMonths,
  }).monthly;

  const canonMinDownDollars = (discountedTotal * minPercent) / 100;
  // The one-payment down is ALWAYS allowed. At 12 payments it lands at 7.69%
  // of the total, under canon's 10% floor — so the floor yields to it rather
  // than silently charging more than the quote the consumer agreed to. Canon's
  // floor still governs everything below that.
  const minDownDollars = Math.min(canonMinDownDollars, oneMonthlyDown);
  const downFloorRelaxed = canonMinDownDollars - oneMonthlyDown > 0.01;
  const maxDownDollars = (discountedTotal * maxPercentOfTotal) / 100;
  const downDollarsCandidate = downType === 'percent'
    ? (discountedTotal * downValue) / 100
    : downValue;
  const downDollars = Math.max(minDownDollars, Math.min(maxDownDollars, downDollarsCandidate));
  const downPercent = discountedTotal > 0
    ? Math.round((downDollars / discountedTotal) * 100 * 100) / 100
    : 0;

  const remaining = Math.max(discountedTotal - downDollars, 0);
  const monthly = isMonthly
    ? Math.round(discountedTotal * 100) / 100
    : (safeMonths > 0 ? Math.round((remaining / safeMonths) * 100) / 100 : 0);
  const dueToday = isMonthly
    ? Math.round(discountedTotal * 100) / 100
    : (months === 1 ? discountedTotal : downDollars);

  const dateBounds = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const minDays = billing?.first_payment_date?.min_days_from_today ?? 31;
    const maxDays = billing?.first_payment_date?.max_days_from_today ?? 45;
    return {
      min: toIsoDate(addDays(today, minDays)),
      max: toIsoDate(addDays(today, maxDays)),
      minDays,
      maxDays,
    };
  }, [billing]);

  const viewedRef = useRef(false);
  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    track('home_protection.customer.confirm.viewed', {
      plan_code: plan.plan_code,
      tier: plan.tier,
      plan_total: planTotal,
      add_ons_total: addOnsTotal,
      total_cost: totalCost,
      add_on_count: addOns.length,
      billing_model: plan.billing_model ?? 'term_total',
      persona,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── agent control handlers ──────────────────────────────────────────────
  function setDiscountType(next) {
    if (next === discountType) return;
    const convertedValue = next === 'percent'
      ? (planDiscountBase > 0
        ? Math.round((effectivePlanDiscountDollars / planDiscountBase) * 100 * 100) / 100
        : 0)
      : Math.round(effectivePlanDiscountDollars * 100) / 100;
    update({ payment: { ...payment, discount_type: next, discount_value: convertedValue } });
  }
  function setDiscountValue(rawString) {
    const v = rawString === '' ? 0 : Math.max(0, Number(rawString));
    update({ payment: { ...payment, discount_value: v } });
    track('home_protection.customer.confirm.discount_applied', {
      type: discountType,
      value: v,
      effective_dollars: Math.round(cappedDollars * 100) / 100,
      scope: 'plan',
    });
  }
  function setAddOnDiscountValue(rawString) {
    const v = rawString === '' ? 0 : Math.max(0, Number(rawString));
    update({ payment: { ...payment, add_on_discount_percent: v } });
    track('home_protection.customer.confirm.add_on_discount_applied', {
      requested_percent: v,
      applied_percent: Math.max(0, Math.min(v, maxAddOnDiscountPercent)),
      cap_percent: maxAddOnDiscountPercent,
      cap_clamped: caps.addOn.clamped,
      effective_dollars: effectiveAddOnDiscountDollars,
      floored: addOnDiscount.floored,
    });
  }
  function setDownType(next) {
    if (next === downType) return;
    const convertedValue = next === 'percent'
      ? (discountedTotal > 0 ? Math.round((downDollars / discountedTotal) * 100 * 100) / 100 : minPercent)
      : Math.round(downDollars * 100) / 100;
    update({ payment: { ...payment, down_payment_type: next, down_payment_value: convertedValue } });
  }
  function setDownValue(rawString) {
    const v = rawString === '' ? 0 : Math.max(0, Number(rawString));
    update({ payment: { ...payment, down_payment_value: v } });
    track('home_protection.customer.confirm.down_payment_changed', {
      type: downType,
      value: v,
      effective_dollars: Math.round(downDollars * 100) / 100,
    });
  }
  function setFirstPaymentDate(iso) {
    update({ payment: { ...payment, first_payment_date: iso } });
    track('home_protection.customer.confirm.first_payment_date_changed', { date: iso });
  }
  function setMonthsToPay(next) {
    const patch = { ...payment, months_to_pay: next };
    // The divisor moved, so one-monthly moved. Re-seed the down payment to it
    // rather than leaving the previous basis's dollar amount behind.
    if (next !== 1) {
      patch.down_payment_type = 'dollars';
      patch.down_payment_value = computeHomePaymentPlan({
        total: discountedTotal,
        monthsToPay: next,
      }).monthly;
    }
    // Pay-in-full forgets the agent's date pick, mirroring the legacy
    // packages_controller behavior the auto flow ports.
    if (next === 1) patch.first_payment_date = toIsoDate(new Date());
    update({ payment: patch });
    track('home_protection.customer.confirm.months_to_pay_changed', {
      months: next,
      pay_in_full: next === 1,
    });
  }

  function handleNext() {
    update({
      paymentSchedule: {
        billing_model: isMonthly ? 'monthly_subscription' : 'term_total',
        // plan_cost and add_ons_total are carried separately from total_cost
        // so the completion record, the agreement and mission-control can all
        // show what the consumer actually bought — not just a lump sum.
        plan_cost: planTotal,
        add_ons_total: addOnsTotal,
        add_ons_charged_total: Math.round(addOnsChargedTotal * 100) / 100,
        add_on_count: addOns.length,
        add_ons: addOnDiscount.rows.map((a) => ({
          key: a.key,
          label: a.label ?? a.key,
          option_id: a.option_id ?? null,
          cost: a.cost ?? null,
          retail_price: a.retail_price,
          price: a.discounted_price,
        })),
        original_total_cost: totalCost,
        total_cost: discountedTotal,
        discount_dollars: Math.round(effectiveDiscountDollars * 100) / 100,
        discount_percent_of_total: effectiveDiscountPercent,
        plan_discount_dollars: Math.round(effectivePlanDiscountDollars * 100) / 100,
        add_on_discount_dollars: Math.round(effectiveAddOnDiscountDollars * 100) / 100,
        add_on_discount_percent: cappedAddOnPercent,
        due_today: Math.round(dueToday * 100) / 100,
        down_payment: isMonthly ? null : Math.round(downDollars * 100) / 100,
        months_to_pay: isMonthly ? null : months,
        first_payment_date: firstPaymentDate,
        first_payment_date_label: fmtDateLong(firstPaymentDate),
        monthly_payment: monthly,
        monthly_charge: isMonthly ? Math.round(discountedTotal * 100) / 100 : null,
      },
      // The sale date is pinned here rather than at signing so the agreement's
      // purchase date matches the moment the consumer agreed to the price.
      saleDate: form.saleDate || toIsoDate(new Date()),
      status: 'Booked',
    });
    track('home_protection.customer.confirm.continued', {
      plan_code: plan.plan_code,
      due_today: Math.round(dueToday * 100) / 100,
      monthly,
      months,
      add_ons_total: addOnsTotal,
      add_ons_charged_total: Math.round(addOnsChargedTotal * 100) / 100,
      discount_dollars: Math.round(effectiveDiscountDollars * 100) / 100,
      plan_discount_dollars: Math.round(effectivePlanDiscountDollars * 100) / 100,
      add_on_discount_dollars: Math.round(effectiveAddOnDiscountDollars * 100) / 100,
      persona,
    });
    onNext();
  }

  const showContactCard = persona === 'agent';
  const homeLabel = [
    home.square_feet ? `${Number(home.square_feet).toLocaleString()} sq ft` : null,
    home.home_type ? home.home_type.replace(/_/g, ' ') : null,
  ].filter(Boolean).join(' ');

  return (
    <>
      <ScreenHeader
        icon={ClipboardCheck}
        eyebrow="Coverage · Confirm"
        title="Confirm coverage & payment"
        subtitle={
          showContactCard && contact.first_name
            ? `${contact.first_name}, here's what we'll set up. Review and continue to payment.`
            : 'Review your plan and payment, then continue to billing.'
        }
      />

      <div className="px-6 space-y-4">
        <Section icon={House} label="Home">
          <div className="text-sm font-semibold text-slate-900 capitalize">
            {homeLabel || '—'}
          </div>
          <div className="text-xs text-slate-500">
            {[home.address?.address1, home.address?.address2].filter(Boolean).join(', ') || '—'}
            {(home.address?.city || home.address?.state || home.address?.zip) && <br />}
            {[home.address?.city, home.address?.state, home.address?.zip].filter(Boolean).join(', ')}
          </div>
          {home.year_built && (
            <div className="text-[11px] text-slate-500 mt-1">Built {home.year_built}</div>
          )}
        </Section>

        <Section icon={ShieldCheck} label="Plan">
          <div className="text-sm font-semibold text-slate-900">{plan.plan_name || '—'}</div>
          <div className="text-xs text-slate-500">
            {isMonthly
              ? `Month to month · $${Math.round(monthlyCharge)}/mo · $${Math.round(plan.deductible || 0)} deductible · ${String(plan.tier || '').toUpperCase()} tier`
              : `${plan.coverage_period_months} months · $${Math.round(plan.deductible || 0)} deductible · ${String(plan.tier || '').toUpperCase()} tier`}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">$75 service call fee per claim</div>
        </Section>

        {/* Itemized coverages — the consumer's last look before signing, and
            the same list that becomes ticked checkboxes on the agreement. */}
        {!isMonthly && (
          <div className="border border-slate-200 rounded-md overflow-hidden">
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
              <ListChecks className="w-4 h-4 text-slate-500" />
              <span className="text-xs uppercase tracking-wide font-semibold text-slate-600">
                What you&apos;re buying
              </span>
            </div>
            <div className="px-4 py-3 space-y-2 text-sm">
              <Line label={plan.plan_name || 'Plan'} value={fmtCurrency(planTotal)} />
              {addOns.length === 0 ? (
                <div className="text-[11px] text-slate-500">No optional coverages added.</div>
              ) : (
                addOns.map((a) => (
                  <Line key={a.key} label={a.label || a.key} value={fmtCurrency(a.price)} muted />
                ))
              )}
              <div className="pt-2 border-t border-slate-100">
                <Line label="Subtotal" value={fmtCurrency(totalCost)} />
              </div>
              <div className="text-[11px] text-slate-500">
                {months === 1
                  ? 'Paid in full today.'
                  : `${months} payments of ${fmtCurrency(monthly)}, plus a down payment of ${fmtCurrency(downDollars)} today.`}
              </div>
            </div>
          </div>
        )}

        {showContactCard && (
          contact.first_name ? (
            <Section icon={UserCheck} label="Agreement holder">
              <div className="text-sm font-semibold text-slate-900">
                {[contact.first_name, contact.last_name].filter(Boolean).join(' ') || '—'}
              </div>
              <div className="text-xs text-slate-500">
                {contact.email || '—'} · {contact.phone ? formatPhoneDisplay(contact.phone) : '—'}
              </div>
              {form.secondaryContact?.first_name && (
                <div className="text-[11px] text-slate-500 mt-1">
                  Second holder: {[form.secondaryContact.first_name, form.secondaryContact.last_name].filter(Boolean).join(' ')}
                </div>
              )}
            </Section>
          ) : (
            <div className="text-[11px] text-slate-500 border border-dashed border-slate-200 rounded-md px-4 py-3">
              Contact will be collected at billing.
            </div>
          )
        )}

        {showAgentControls && (
          <AgentPaymentControls
            isMonthly={isMonthly}
            billingTodo={billingTodo}
            discountType={discountType}
            discountValue={discountValue}
            discountDisabled={discountDisabled}
            disabledStates={disabledStates}
            stateForRules={stateForRules}
            maxDiscountPercent={maxDiscountPercent}
            maxDiscountDollars={maxDiscountDollars}
            effectiveDiscountDollars={effectivePlanDiscountDollars}
            effectiveDiscountPercent={effectivePlanDiscountPercent}
            onDiscountType={setDiscountType}
            onDiscountValue={setDiscountValue}
            hasAddOns={addOns.length > 0}
            addOnDiscountValue={addOnDiscountValue}
            maxAddOnDiscountPercent={maxAddOnDiscountPercent}
            addOnCaps={caps.addOn}
            effectiveAddOnDiscountDollars={effectiveAddOnDiscountDollars}
            addOnsTotal={addOnsTotal}
            addOnsChargedTotal={addOnsChargedTotal}
            addOnDiscountFloored={addOnDiscount.floored}
            onAddOnDiscountValue={setAddOnDiscountValue}
            downFloorRelaxed={downFloorRelaxed}
            oneMonthlyDown={oneMonthlyDown}
            downType={downType}
            downValue={downValue}
            minPercent={minPercent}
            maxPercentOfTotal={maxPercentOfTotal}
            minDownDollars={minDownDollars}
            maxDownDollars={maxDownDollars}
            downDollars={downDollars}
            downPercent={downPercent}
            onDownType={setDownType}
            onDownValue={setDownValue}
            firstPaymentDate={firstPaymentDate}
            dateBounds={dateBounds}
            onFirstPaymentDate={setFirstPaymentDate}
            months={months}
            monthsOptions={monthsOptions}
            onMonthsToPay={setMonthsToPay}
            previewToggle={persona !== 'agent'}
            previewActive={previewAgentControls}
            onTogglePreview={() => setPreviewAgentControls((v) => !v)}
          />
        )}

        {persona !== 'agent' && !showAgentControls && (
          <button
            type="button"
            onClick={() => setPreviewAgentControls(true)}
            className="text-[11px] text-slate-400 underline hover:text-slate-600 self-start"
          >
            DEV: Show agent payment controls
          </button>
        )}

        <div className="border border-slate-200 rounded-md overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-500" />
            <span className="text-xs uppercase tracking-wide font-semibold text-slate-600">Payment</span>
          </div>
          <div className="px-4 py-3 space-y-2 text-sm">
            {isMonthly ? (
              <>
                <Line label="Monthly charge" value={`${fmtCurrency(monthly)}/mo`} />
                <Line label="Due today" value={fmtCurrency(dueToday)} highlight />
                <Line label="First monthly charge" value={fmtDateLong(firstPaymentDate)} muted />
                {effectiveDiscountDollars > 0 && (
                  <Line label="Monthly discount" value={`− ${fmtCurrency(effectiveDiscountDollars)}/mo`} muted />
                )}
                <Line label="Billing" value="Recurring monthly · cancel anytime" muted />
              </>
            ) : (
              <>
                <Line label="Monthly payment" value={fmtCurrency(monthly)} />
                <Line label="Due today" value={fmtCurrency(dueToday)} highlight />
                <Line label="Down payment" value={fmtCurrency(downDollars)} muted />
                <Line
                  label="Months to pay"
                  value={`${months} ${months === 1 ? 'payment (paid in full today)' : 'monthly payments'}`}
                  muted
                />
                <Line label="First payment date" value={months === 1 ? '—' : fmtDateLong(firstPaymentDate)} muted />
                {addOnsTotal > 0 && (
                  <Line label="Optional coverages included" value={fmtCurrency(addOnsChargedTotal)} muted />
                )}
                {effectivePlanDiscountDollars > 0 && (
                  <Line label="Plan discount" value={`− ${fmtCurrency(effectivePlanDiscountDollars)}`} muted />
                )}
                {effectiveAddOnDiscountDollars > 0 && (
                  <Line
                    label="Optional coverage discount"
                    value={`− ${fmtCurrency(effectiveAddOnDiscountDollars)}`}
                    muted
                  />
                )}
                <Line label="Total payments" value={fmtCurrency(discountedTotal)} muted />
              </>
            )}
          </div>
        </div>
      </div>

      <WizardFooter onNext={handleNext} nextLabel="Confirm and pay" />
    </>
  );
}

// Agent payment controls. Pure presentation — every value lives on
// form.payment via the parent's setters.
function AgentPaymentControls({
  isMonthly,
  billingTodo,
  discountType,
  discountValue,
  discountDisabled,
  disabledStates,
  stateForRules,
  maxDiscountPercent,
  maxDiscountDollars,
  effectiveDiscountDollars,
  effectiveDiscountPercent,
  onDiscountType,
  onDiscountValue,
  hasAddOns,
  addOnDiscountValue,
  maxAddOnDiscountPercent,
  addOnCaps,
  effectiveAddOnDiscountDollars,
  addOnsTotal,
  addOnsChargedTotal,
  addOnDiscountFloored,
  onAddOnDiscountValue,
  downFloorRelaxed,
  oneMonthlyDown,
  downType,
  downValue,
  minPercent,
  maxPercentOfTotal,
  minDownDollars,
  maxDownDollars,
  downDollars,
  downPercent,
  onDownType,
  onDownValue,
  firstPaymentDate,
  dateBounds,
  onFirstPaymentDate,
  months,
  monthsOptions,
  onMonthsToPay,
  previewToggle,
  previewActive,
  onTogglePreview,
}) {
  return (
    <div className="border border-blue-200 bg-blue-50/40 rounded-md overflow-hidden">
      <div className="px-4 py-2 bg-blue-100/60 border-b border-blue-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-blue-700" />
          <span className="text-xs uppercase tracking-wide font-semibold text-blue-800">
            Agent payment controls
          </span>
        </div>
        {previewToggle && (
          <button
            type="button"
            onClick={onTogglePreview}
            className="text-[11px] text-blue-700 underline hover:text-blue-900"
          >
            {previewActive ? 'Hide' : 'Preview'}
          </button>
        )}
      </div>

      {/* Canon carries an explicit _TODO on the home billing block — the
          margins, caps and EFS terms are educated guesses pending product
          confirmation. Surface it to the agent rather than letting the
          numbers read as settled. */}
      {billingTodo && (
        <div className="px-4 py-2 text-[11px] text-amber-800 bg-amber-50 border-b border-amber-200">
          <span className="font-semibold">Unconfirmed:</span> home billing caps and
          markup in canon are placeholder values pending product sign-off.
        </div>
      )}

      <div className="px-4 py-3 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-700 flex items-center gap-1">
              <Tag className="w-3 h-3" /> {isMonthly ? 'Monthly discount' : 'Plan discount'}
            </label>
            <div className="text-[11px] text-slate-500">
              max {maxDiscountPercent}% / {fmtCurrency(maxDiscountDollars)}
            </div>
          </div>
          <div className="flex gap-2">
            <PercentDollarToggle type={discountType} onChange={onDiscountType} disabled={discountDisabled} />
            <input
              type="number"
              value={discountValue}
              onChange={(e) => onDiscountValue(e.target.value)}
              disabled={discountDisabled}
              min={0}
              step={discountType === 'percent' ? 0.5 : 5}
              className="flex-1 px-3 py-1.5 border border-slate-200 rounded-md text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400"
            />
          </div>
          {discountDisabled ? (
            <div className="text-[11px] text-amber-700 mt-1">
              Discount disabled in {stateForRules || 'this state'} (canon: {disabledStates.join(', ')}).
            </div>
          ) : (
            <div className="text-[11px] text-slate-500 mt-1">
              Applied: {fmtCurrency(effectiveDiscountDollars)} ({effectiveDiscountPercent}%)
              {(discountType === 'percent'
                ? discountValue > maxDiscountPercent
                : discountValue > maxDiscountDollars) && (
                <span className="ml-1 text-amber-700">— clamped to canon cap</span>
              )}
            </div>
          )}
          {!isMonthly && (
            <div className="text-[11px] text-slate-400 mt-1">
              Applies to the plan only. Optional coverages discount separately below.
            </div>
          )}
        </div>

        {/* Optional-coverage discount — its own cap set, and its own floor.
            The cap shown here is the EFFECTIVE one: getHomeDiscountCaps has
            already clamped the configured percent to break-even, and says so
            below rather than letting a number the admin never chose apply
            silently. */}
        {!isMonthly && hasAddOns && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-700 flex items-center gap-1">
                <ListChecks className="w-3 h-3" /> Optional coverage discount
              </label>
              <div className="text-[11px] text-slate-500">max {maxAddOnDiscountPercent}%</div>
            </div>
            <div className="flex gap-2 items-center">
              <span className="px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-md bg-white text-slate-700">
                %
              </span>
              <input
                type="number"
                value={addOnDiscountValue}
                onChange={(e) => onAddOnDiscountValue(e.target.value)}
                disabled={discountDisabled || !addOnCaps?.allowed}
                min={0}
                step={0.5}
                className="flex-1 px-3 py-1.5 border border-slate-200 rounded-md text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400"
              />
            </div>
            {discountDisabled ? (
              <div className="text-[11px] text-amber-700 mt-1">
                Discount disabled in {stateForRules || 'this state'}.
              </div>
            ) : (
              <div className="text-[11px] text-slate-500 mt-1">
                Applied: {fmtCurrency(effectiveAddOnDiscountDollars)} —{' '}
                {fmtCurrency(addOnsTotal)} of coverages bills at{' '}
                {fmtCurrency(addOnsChargedTotal)}
                {addOnDiscountValue > maxAddOnDiscountPercent && (
                  <span className="ml-1 text-amber-700">— clamped to {maxAddOnDiscountPercent}%</span>
                )}
              </div>
            )}
            {addOnCaps?.clamped && (
              <div className="text-[11px] text-amber-700 mt-1">
                Cap reduced from the configured {addOnCaps.configured_percent}% to{' '}
                {addOnCaps.break_even_percent}% — above that an optional coverage would
                sell below Omega&apos;s cost.
              </div>
            )}
            {addOnDiscountFloored && (
              <div className="text-[11px] text-amber-700 mt-1">
                One or more coverages hit the cost floor and were not discounted the full
                amount.
              </div>
            )}
          </div>
        )}

        {!isMonthly && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-700 flex items-center gap-1">
                <DollarSign className="w-3 h-3" /> Down payment
              </label>
              <div className="text-[11px] text-slate-500">
                min {minPercent}% · max {maxPercentOfTotal}% of total
              </div>
            </div>
            <div className="flex gap-2">
              <PercentDollarToggle type={downType} onChange={onDownType} />
              <input
                type="number"
                value={downValue}
                onChange={(e) => onDownValue(e.target.value)}
                min={0}
                step={downType === 'percent' ? 1 : 25}
                className="flex-1 px-3 py-1.5 border border-slate-200 rounded-md text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Default is one monthly payment ({fmtCurrency(oneMonthlyDown)}).
            </div>
            {downFloorRelaxed && (
              <div className="text-[11px] text-slate-400 mt-0.5">
                Canon&apos;s {minPercent}% floor yields to it — one payment down is the
                schedule&apos;s own structure.
              </div>
            )}
            <div className="text-[11px] text-slate-500 mt-1">
              Applied: {fmtCurrency(downDollars)} ({downPercent}%)
              {downDollars >= maxDownDollars - 0.01 && downValue > maxDownDollars && (
                <span className="ml-1 text-amber-700">— clamped to canon ceiling</span>
              )}
              {downDollars <= minDownDollars + 0.01 && downValue < minDownDollars && (
                <span className="ml-1 text-amber-700">— floored at min {minPercent}%</span>
              )}
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-700 flex items-center gap-1">
              <Calendar className="w-3 h-3" /> {isMonthly ? 'First monthly charge' : 'First payment date'}
            </label>
            <div className="text-[11px] text-slate-500">
              {dateBounds.minDays}–{dateBounds.maxDays} days from today
            </div>
          </div>
          <input
            type="date"
            value={firstPaymentDate}
            min={dateBounds.min}
            max={dateBounds.max}
            disabled={!isMonthly && months === 1}
            onChange={(e) => onFirstPaymentDate(e.target.value)}
            className="w-full px-3 py-1.5 border border-slate-200 rounded-md text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400"
          />
          {!isMonthly && months === 1 && (
            <div className="text-[11px] text-slate-500 mt-1">Disabled — paid in full today.</div>
          )}
        </div>

        {!isMonthly && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-700 flex items-center gap-1">
                <Percent className="w-3 h-3" /> Months to pay
              </label>
              <div className="text-[11px] text-slate-500">options for this coverage term</div>
            </div>
            <div className="flex gap-1">
              {monthsOptions.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onMonthsToPay(m)}
                  className={
                    'flex-1 px-2 py-1.5 text-xs rounded-md border ' +
                    (m === months
                      ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50')
                  }
                >
                  {m === 1 ? 'PIF' : m}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PercentDollarToggle({ type, onChange, disabled = false }) {
  return (
    <div className="inline-flex rounded-md border border-slate-200 overflow-hidden">
      <button
        type="button"
        onClick={() => onChange('percent')}
        disabled={disabled}
        className={
          'px-3 py-1.5 text-xs font-semibold ' +
          (type === 'percent' ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50') +
          (disabled ? ' opacity-50 cursor-not-allowed' : '')
        }
      >
        %
      </button>
      <button
        type="button"
        onClick={() => onChange('dollars')}
        disabled={disabled}
        className={
          'px-3 py-1.5 text-xs font-semibold border-l border-slate-200 ' +
          (type === 'dollars' ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50') +
          (disabled ? ' opacity-50 cursor-not-allowed' : '')
        }
      >
        $
      </button>
    </div>
  );
}

function Section({ icon: Icon, label, children }) {
  return (
    <div className="border border-slate-200 rounded-md overflow-hidden">
      <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
        <Icon className="w-4 h-4 text-slate-500" />
        <span className="text-xs uppercase tracking-wide font-semibold text-slate-600">{label}</span>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
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
