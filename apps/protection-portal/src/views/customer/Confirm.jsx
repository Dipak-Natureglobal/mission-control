// Customer view · Step (post-coverage) — Confirm Coverage & Payment.
//
// Read-only summary of vehicle + plan + (agent-only) contact + payment
// math. Lifted shape from BlinkerLegacy/.../screens/10-consumer-confirm.md
// (Monthly Payment / Due today / Down payment / Months / Payment Date /
// Total Payments).
//
// Per UX feedback 2026-05-04 (CONTACT·CAPTURE removal):
//   - Contact card renders only for agent persona (form.contact prefilled
//     from mission-control's CoPilot session). Customer mode hides the
//     card entirely — contact is collected on BillingPayment instead.
//     _TODO Phase 2: wire mission-control → AgentView contact-prop
//     threading so form.contact is hydrated before Confirm mounts.
//
// Agent payment controls (NEW, behind persona === 'agent' OR DEV
// CONTROLS preview toggle):
//   1. Discount — segmented %/$ toggle + numeric input. Bidirectional
//      clamp: max_percent and max_dollars enforced together; whichever
//      cap reaches first wins (canonical behavior in
//      MissionControl/src/features/refiApp/productsForm.tsx:230-326).
//      Disabled when form.contact.address.state ∈ disabled_in_states
//      (FL today; canon-driven).
//   2. Down payment — segmented %/$ toggle + numeric input. Min from
//      canon `min_percent`; max = total * max_percent_of_total / 100
//      (75% canon floor — replaces hardcoded validation in legacy
//      product_option.rb:30-34 + paymentOptions.tsx:156).
//   3. First payment date — HTML5 date input bounded by today +
//      min_days_from_today / today + max_days_from_today. Default
//      strategy 'first_of_next_month' clamped forward to today + min_days
//      when "first of next month" resolves to fewer days than the floor
//      (e.g., today is the 25th).
//   4. Months to pay — segmented control from canon `options_months`,
//      default from `default_months`. When months === 1 (pay-in-full),
//      first_payment_date resets to today (legacy
//      packages_controller.rb:53 behavior — agent's date pick is
//      forgotten on flip to PIF).
//
// All control values write into form.payment.* so BillingPayment + later
// screens read a consistent shape. Monthly Payment / Due Today / Total
// Payments figures recompute live from these controls.
//
// Discount math: applies ONLY to plan base (plan.total_cost), never to
// surcharges. Today protection-portal doesn't surface surcharges as a
// separate line on selectedPlan — when business-use add-on / agent-review
// flag get a dollar value, isolate them from the discount base
// (canonical math in MissionControl/src/helpers/calculateProductPricing.ts).
//
// Insurance cross-sell:
//   - SavingsCard is imported from insurance-portal via a `file:` dep.
//     Mission-control composes protection-portal the same way; same
//     pattern, no surprises. HMR doesn't propagate edits inside the
//     linked dep — restart `npm run dev` after any insurance-portal
//     SavingsCard change.
//   - Wave 13 (2026-05-05): the card now SOURCES from
//     form.insuranceSavings (set by CrossSellSubFlow's onComplete on
//     quote.completed with savings > 0), not the static fixture. It
//     anchors at the TOP-LEFT of the form per the Wave 13 brief
//     ("drops the savings card to the left in the protection plan
//     view") and renders ONLY when there's a real insurance
//     opportunity that reached quote.completed AND has savings.
//   - The fixture (`src/fixtures/insurance-cross-sell.json`) is
//     retained for DEV CONTROLS preview when the user toggles
//     showInsuranceCrossSell ON without having gone through Step 5.
//     The two paths render different chrome so the prototype can
//     demo both states.
//   - Visibility gates:
//       form.insuranceSavings present       → real SavingsCard at top
//       showInsuranceCrossSell + no result  → fixture SavingsCard
//                                             (DEV preview)
//   - `onCtaClick` is intentionally NOT passed — Confirm has its own
//     primary CTA ("Confirm and pay").
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardCheck,
  Car,
  ShieldCheck,
  UserCheck,
  Calendar,
  Sparkles,
  Percent,
  DollarSign,
  Tag,
  Settings2,
} from 'lucide-react';
import { ScreenHeader, WizardFooter } from 'blinker-platform/components';
import { SavingsCard } from 'insurance-portal/src/views/customer';
import crossSellFixture from '../../fixtures/insurance-cross-sell.json';
import orgRegistry from '../../constants/canon/org-registry.json';
import { track } from 'blinker-platform/telemetry';

function fmtCurrency(v) {
  if (v == null) return '—';
  return `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDateLong(iso) {
  if (!iso) return '—';
  // iso is yyyy-mm-dd from the date input; parse as local to avoid TZ
  // shift surprising the consumer.
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: '2-digit' });
}

function toIsoDate(date) {
  // Local-time iso (yyyy-mm-dd) — date inputs ignore TZ but we want
  // round-trip consistency with fmtDateLong.
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
  // Clamp forward when strategy resolves below the floor.
  if (candidate < minDate) candidate = minDate;
  if (candidate > maxDate) candidate = maxDate;
  return toIsoDate(candidate);
}

function getOrg(orgId) {
  return orgRegistry.orgs.find((o) => o.id === orgId);
}

export function Confirm({
  form,
  update,
  onNext,
  persona = 'consumer',
  showInsuranceCrossSell = true,
}) {
  const plan = form.selectedPlan || {};
  const contact = form.contact || {};

  // Wave 38: monthly-membership branch. A MISSING billing_model is term_total.
  const isMonthly = plan?.billing_model === 'monthly_subscription';
  const monthlyCharge = Number(plan.monthly_charge || 0);

  // Discount base: term plans discount the term total; monthly plans discount
  // the per-month charge.
  const total = isMonthly ? monthlyCharge : Number(plan.total_cost || 0);

  // Canon-driven billing config. Null-safe per architecture/09 read
  // pattern: "caller is responsible for null-safety if the org isn't
  // recognized." Falling back to inline defaults so the screen still
  // composes if canon was hand-edited.
  const org = getOrg(form.org_id);
  const billing = org?.protection_billing;

  const minPercent = billing?.down_payment?.min_percent ?? 10;
  const maxPercentOfTotal = billing?.down_payment?.max_percent_of_total ?? 75;

  // Wave 38: monthly plans use the SEPARATE monthly_membership.discount caps;
  // term plans use the term discount block.
  const monthlyMembership = billing?.monthly_membership;
  const maxDiscountPercent = isMonthly
    ? (monthlyMembership?.discount?.max_percent ?? 15)
    : (billing?.discount?.max_percent ?? 20);
  const maxDiscountDollars = isMonthly
    ? (monthlyMembership?.discount?.max_dollars ?? 10.0)
    : (billing?.discount?.max_dollars ?? 540.0);
  const disabledStates = isMonthly
    ? (monthlyMembership?.discount?.disabled_in_states || ['FL'])
    : (billing?.discount?.disabled_in_states || ['FL']);
  const monthsOptions = billing?.payment_term?.options_months || [1, 6, 12, 18, 24];
  const monthsDefault = billing?.payment_term?.default_months ?? 12;

  // DEV CONTROLS preview toggle — agents see controls by default; in
  // customer mode the agent-control section can be revealed for QA.
  const [previewAgentControls, setPreviewAgentControls] = useState(false);
  const showAgentControls = persona === 'agent' || previewAgentControls;

  // Initialize form.payment slice from canon defaults the first time the
  // screen renders — keeps the math hookups simple and lets BillingPayment
  // read a fully-populated shape. Once seeded, edits flow through update().
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    const next = { ...(form.payment || {}) };
    let dirty = false;
    if (next.discount_type == null) {
      next.discount_type = 'percent';
      dirty = true;
    }
    if (next.discount_value == null) {
      next.discount_value = 0;
      dirty = true;
    }
    // Wave 38: monthly plans have NO down-payment and NO finite months-to-pay.
    // Skip seeding those fields and clear any stale values left from a prior
    // term-plan selection (e.g. the user flipped term→monthly upstream).
    if (isMonthly) {
      if (next.down_payment_value != null) { next.down_payment_value = null; dirty = true; }
      if (next.down_payment_type != null) { next.down_payment_type = null; dirty = true; }
      if (next.months_to_pay != null) { next.months_to_pay = null; dirty = true; }
    } else {
      if (next.down_payment_type == null) {
        next.down_payment_type = 'percent';
        dirty = true;
      }
      if (next.down_payment_value == null) {
        next.down_payment_value = minPercent;
        dirty = true;
      }
      if (next.months_to_pay == null) {
        next.months_to_pay = monthsDefault;
        dirty = true;
      }
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
  const downType = payment.down_payment_type || 'percent';
  const downValue = payment.down_payment_value != null ? Number(payment.down_payment_value) : minPercent;
  const months = payment.months_to_pay ?? monthsDefault;
  const firstPaymentDate = payment.first_payment_date || resolveDefaultFirstPaymentDate(billing);

  // Discount disable per state. form.state is the GarageLocation address
  // state (flat field set by AddressBlock); contact.state is captured at
  // billing. Either one wins to disable the discount.
  const stateForRules = (contact.address?.state || contact.state || form.state || '').toUpperCase();
  const discountDisabled = disabledStates.includes(stateForRules);

  // Bidirectional clamp: convert the entered value to BOTH dollars and
  // percent, then enforce the min of the two ceilings. The smaller cap
  // wins. Mirrors MissionControl/.../productsForm.tsx:230-326.
  const discountDollarsCandidate = discountType === 'percent'
    ? (total * discountValue) / 100
    : discountValue;
  const cappedDollars = Math.max(0, Math.min(
    discountDollarsCandidate,
    maxDiscountDollars,
    (total * maxDiscountPercent) / 100,
  ));
  const effectiveDiscountDollars = discountDisabled ? 0 : cappedDollars;
  const effectiveDiscountPercent = total > 0
    ? Math.round((effectiveDiscountDollars / total) * 100 * 100) / 100
    : 0;

  // Discount applies only to plan base (plan.total_cost); preserve any
  // future surcharge as a separate line. For now, plan.total_cost IS the
  // base because protection-portal doesn't model surcharges as dollars.
  const discountedTotal = Math.max(0, total - effectiveDiscountDollars);

  // Down-payment cap = max_percent_of_total of the discounted total
  // (75% canon). Min = min_percent (10%). When user enters dollars,
  // clamp against the same dollar ceiling. Min in dollars = discountedTotal * minPercent / 100.
  // Wave 38: monthly plans have no down-payment / months-to-pay — these are
  // computed but unused (the monthly branch below overrides dueToday/monthly).
  const minDownDollars = (discountedTotal * minPercent) / 100;
  const maxDownDollars = (discountedTotal * maxPercentOfTotal) / 100;
  const downDollarsCandidate = downType === 'percent'
    ? (discountedTotal * downValue) / 100
    : downValue;
  const downDollars = Math.max(minDownDollars, Math.min(maxDownDollars, downDollarsCandidate));
  const downPercent = discountedTotal > 0
    ? Math.round((downDollars / discountedTotal) * 100 * 100) / 100
    : 0;

  // Wave 38: monthly plans bill a flat recurring charge. The discounted
  // per-month charge IS both the recurring "monthly" figure and the due-today
  // amount (the first monthly charge collected at checkout). No down payment,
  // no finite months-to-pay.
  const remaining = Math.max(discountedTotal - downDollars, 0);
  const safeMonths = months === 1 ? 1 : (months || monthsDefault);
  const monthly = isMonthly
    ? Math.round(discountedTotal * 100) / 100
    : (safeMonths > 0 ? Math.round((remaining / safeMonths) * 100) / 100 : 0);
  const dueToday = isMonthly
    ? Math.round(discountedTotal * 100) / 100
    : (months === 1 ? discountedTotal : downDollars);

  // Date bounds for the date input.
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
    track('protection.customer.confirm.viewed', {
      plan_code: plan.plan_code,
      tier: plan.tier,
      total_cost: total,
      persona,
      cross_sell_visible: showInsuranceCrossSell,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- Agent control handlers (write through to form.payment) --
  function setDiscountType(next) {
    if (next === discountType) return;
    // Convert value across units so the cap visible to the user stays
    // sensible after the toggle.
    const convertedValue = next === 'percent'
      ? (total > 0 ? Math.round((effectiveDiscountDollars / total) * 100 * 100) / 100 : 0)
      : Math.round(effectiveDiscountDollars * 100) / 100;
    update({
      payment: {
        ...payment,
        discount_type: next,
        discount_value: convertedValue,
      },
    });
  }
  function setDiscountValue(rawString) {
    const v = rawString === '' ? 0 : Math.max(0, Number(rawString));
    update({
      payment: { ...payment, discount_value: v },
    });
    track('confirm.discount_applied', {
      type: discountType,
      value: v,
      effective_dollars: Math.round(cappedDollars * 100) / 100,
    });
  }
  function setDownType(next) {
    if (next === downType) return;
    const convertedValue = next === 'percent'
      ? (discountedTotal > 0 ? Math.round((downDollars / discountedTotal) * 100 * 100) / 100 : minPercent)
      : Math.round(downDollars * 100) / 100;
    update({
      payment: {
        ...payment,
        down_payment_type: next,
        down_payment_value: convertedValue,
      },
    });
  }
  function setDownValue(rawString) {
    const v = rawString === '' ? 0 : Math.max(0, Number(rawString));
    update({
      payment: { ...payment, down_payment_value: v },
    });
    track('confirm.down_payment_changed', {
      type: downType,
      value: v,
      effective_dollars: Math.round(downDollars * 100) / 100,
    });
  }
  function setFirstPaymentDate(iso) {
    update({ payment: { ...payment, first_payment_date: iso } });
    track('confirm.first_payment_date_changed', { date: iso });
  }
  function setMonthsToPay(next) {
    const patch = { ...payment, months_to_pay: next };
    // Pay-in-full: legacy resets first_payment_date (packages_controller.rb:53).
    // We mirror by setting it to today — agent's prior pick is forgotten.
    if (next === 1) {
      patch.first_payment_date = toIsoDate(new Date());
    }
    update({ payment: patch });
    track('confirm.months_to_pay_changed', {
      months: next,
      pay_in_full: next === 1,
    });
  }

  function handleNext() {
    update({
      paymentSchedule: {
        billing_model: isMonthly ? 'monthly_subscription' : 'term_total',
        total_cost: discountedTotal,
        original_total_cost: total,
        discount_dollars: Math.round(effectiveDiscountDollars * 100) / 100,
        due_today: Math.round(dueToday * 100) / 100,
        // Monthly plans carry no down-payment / finite months-to-pay.
        down_payment: isMonthly ? null : Math.round(downDollars * 100) / 100,
        months_to_pay: isMonthly ? null : months,
        first_payment_date: firstPaymentDate,
        first_payment_date_label: fmtDateLong(firstPaymentDate),
        monthly_payment: monthly,
        monthly_charge: isMonthly ? Math.round(discountedTotal * 100) / 100 : null,
      },
    });
    track('protection.customer.confirm.continued', {
      plan_code: plan.plan_code,
      due_today: Math.round(dueToday * 100) / 100,
      monthly,
      months,
      discount_dollars: Math.round(effectiveDiscountDollars * 100) / 100,
      persona,
    });
    onNext();
  }

  // Render — agent contact card visible only when persona === 'agent' AND
  // we already have prefilled contact data; otherwise show a thin
  // placeholder strip for agents (Phase 2 prefill will close this gap).
  const showContactCard = persona === 'agent';

  return (
    <>
      <ScreenHeader
        icon={ClipboardCheck}
        eyebrow="Coverage · Confirm"
        title="Confirm coverage & payment"
        subtitle={
          showContactCard && contact.first_name
            ? `${contact.first_name}, here's what we'll set up. Review and continue to payment.`
            : "Review your plan and payment, then continue to billing."
        }
      />

      <div className="px-6 space-y-4">
        {form.insuranceSavings && form.insuranceSavings.savingsAmountCents > 0 && (
          <InsuranceSavingsAnchor savings={form.insuranceSavings} />
        )}

        <Section icon={Car} label="Vehicle">
          <div className="text-sm font-semibold text-slate-900">
            {[form.year, form.make, form.model, form.trim].filter(Boolean).join(' ') || '—'}
          </div>
          <div className="text-xs text-slate-500">
            VIN {form.vehicle?.vin || form.vin || '—'} · {form.mileage?.toLocaleString() || '—'} mi · {form.condition || '—'}
            {form.use && ` · ${form.use}`}
          </div>
        </Section>

        <Section icon={ShieldCheck} label="Plan">
          <div className="text-sm font-semibold text-slate-900">{plan.plan_name || '—'}</div>
          <div className="text-xs text-slate-500">
            {isMonthly
              ? `Monthly membership · $${Math.round(monthlyCharge)}/mo · unlimited miles · $${Math.round(plan.deductible || 0)} deductible · ${plan.tier?.toUpperCase()} tier`
              : `${plan.term_months} months · ${plan.miles?.toLocaleString()} miles · $${Math.round(plan.deductible || 0)} deductible · ${plan.tier?.toUpperCase()} tier`}
          </div>
          {form.requiresBusinessUse && (
            <div className="text-[11px] text-amber-700 mt-1">+ Business Use add-on</div>
          )}
          {form.flagAgentReview && (
            <div className="text-[11px] text-amber-700 mt-1">+ Agent review (modifications flagged)</div>
          )}
        </Section>

        {showInsuranceCrossSell && !form.insuranceSavings && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span className="text-xs uppercase tracking-wide font-semibold text-slate-600">
                Save on your insurance too?
              </span>
              <span className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">
                fixture · DEV preview
              </span>
            </div>
            <SavingsCard
              quote={crossSellFixture.quote}
              captureCarrier={crossSellFixture.captureCarrier}
            />
          </div>
        )}

        {showContactCard && (
          contact.first_name ? (
            <Section icon={UserCheck} label="Contact">
              <div className="text-sm font-semibold text-slate-900">
                {[contact.first_name, contact.last_name].filter(Boolean).join(' ') || '—'}
              </div>
              <div className="text-xs text-slate-500">
                {contact.email || '—'} · {contact.phone ? formatPhone(contact.phone) : '—'}
              </div>
              <div className="text-xs text-slate-500">
                {[contact.address1, contact.address2].filter(Boolean).join(', ') || '—'}
                {contact.city || contact.state || contact.zip ? <br /> : null}
                {[contact.city, contact.state, contact.zip].filter(Boolean).join(', ')}
              </div>
            </Section>
          ) : (
            <div className="text-[11px] text-slate-500 border border-dashed border-slate-200 rounded-md px-4 py-3">
              Contact will be collected at billing. _TODO Phase 2: prefill from
              mission-control's CoPilot contact thread so this card hydrates here.
            </div>
          )
        )}

        {showAgentControls && (
          <AgentPaymentControls
            isMonthly={isMonthly}
            discountType={discountType}
            discountValue={discountValue}
            discountDisabled={discountDisabled}
            disabledStates={disabledStates}
            stateForRules={stateForRules}
            maxDiscountPercent={maxDiscountPercent}
            maxDiscountDollars={maxDiscountDollars}
            effectiveDiscountDollars={effectiveDiscountDollars}
            effectiveDiscountPercent={effectiveDiscountPercent}
            onDiscountType={setDiscountType}
            onDiscountValue={setDiscountValue}
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

        {/* Customer-mode preview affordance — lets a customer-view tester
            peek at what agents see. Only renders when not in agent mode
            and the controls aren't already shown. */}
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
                <Line label="Billing" value="Recurring monthly · unlimited miles · cancel anytime" muted />
              </>
            ) : (
              <>
                <Line label="Monthly payment" value={fmtCurrency(monthly)} />
                <Line label="Due today" value={fmtCurrency(dueToday)} highlight />
                <Line label="Down payment" value={fmtCurrency(downDollars)} muted />
                <Line label="Months to pay" value={`${months} ${months === 1 ? 'payment (paid in full today)' : 'months'}`} muted />
                <Line label="First payment date" value={months === 1 ? '—' : fmtDateLong(firstPaymentDate)} muted />
                {effectiveDiscountDollars > 0 && (
                  <Line label="Discount" value={`− ${fmtCurrency(effectiveDiscountDollars)}`} muted />
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

// --- Agent payment controls block. Pure presentation; all state lives
// on form.payment via the parent's setters. Tailwind-only, no new deps. ---
function AgentPaymentControls({
  isMonthly,
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

      <div className="px-4 py-3 space-y-4">
        {/* 1. Discount */}
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
            <PercentDollarToggle
              type={discountType}
              onChange={onDiscountType}
              disabled={discountDisabled}
            />
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
              {(discountType === 'percent' ? discountValue > maxDiscountPercent : discountValue > maxDiscountDollars) && (
                <span className="ml-1 text-amber-700">— clamped to canon cap</span>
              )}
            </div>
          )}
        </div>

        {/* 2. Down payment — hidden for monthly-membership plans (no down payment). */}
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

        {/* 3. First payment date — relabeled "First monthly charge" for monthly plans. */}
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
            <div className="text-[11px] text-slate-500 mt-1">
              Disabled — pay-in-full today (canon: legacy packages_controller.rb:53).
            </div>
          )}
          {isMonthly && (
            <div className="text-[11px] text-slate-500 mt-1">
              The recurring monthly charge begins on this date.
            </div>
          )}
        </div>

        {/* 4. Months to pay — hidden for monthly-membership plans (term is unlimited). */}
        {!isMonthly && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-700 flex items-center gap-1">
              <Percent className="w-3 h-3" /> Months to pay
            </label>
            <div className="text-[11px] text-slate-500">canon options</div>
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
          (type === 'percent'
            ? 'bg-blue-600 text-white'
            : 'bg-white text-slate-700 hover:bg-slate-50') +
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
          (type === 'dollars'
            ? 'bg-blue-600 text-white'
            : 'bg-white text-slate-700 hover:bg-slate-50') +
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
      <span className={
        'text-sm font-semibold ' +
        (highlight ? 'text-rose-600' : muted ? 'text-slate-700' : 'text-slate-900')
      }>{value}</span>
    </div>
  );
}

function formatPhone(raw) {
  const d = String(raw).replace(/\D/g, '');
  if (d.length !== 10) return raw;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

// Top-anchored insurance savings card — shown when an insurance
// opportunity reached quote.completed AND has savings > 0. Sourced
// from form.insuranceSavings (set by CrossSellSubFlow's onComplete).
// Anchors LEFT via max-w + mr-auto so on wider viewports it visually
// pulls to the side rather than stretching across the column.
//
// Uses the same SavingsCard component the customer-portal embeds —
// shape:
//   { id, status, carrier, totalPremiumCents, savingsAmountCents }
// Re-built here from the lighter insuranceSavings payload because
// the upstream onComplete strips to just what protection-portal
// needs (savingsAmountCents, totalPremiumCents, captureCarrier,
// newCarrier, quoteId).
function InsuranceSavingsAnchor({ savings }) {
  const quote = {
    id: savings.quoteId || 'quote_pp',
    status: 'completed',
    carrier: savings.newCarrier || 'New carrier',
    totalPremiumCents: savings.totalPremiumCents || 0,
    savingsAmountCents: savings.savingsAmountCents,
  };
  return (
    <div className="max-w-md mr-auto">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-4 h-4 text-emerald-600" />
        <span className="text-xs uppercase tracking-wide font-semibold text-slate-600">
          Insurance savings · applied
        </span>
      </div>
      <SavingsCard quote={quote} captureCarrier={savings.captureCarrier} />
    </div>
  );
}
