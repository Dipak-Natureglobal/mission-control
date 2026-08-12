// Customer view · Step 9c — Rates Changed (post-VIN divergence).
//
// Mounts when form.opportunityFlags?.rates_changed is true, which is set
// by VinValidate when classifyRatesChange returns one of the two
// forced-rebranch kinds (per ADR 17):
//   - plan_disappeared: the customer's selected plan is not available for
//     the actual VIN. They must pick a different plan or get a refund.
//   - plan_price_higher_outside_tolerance: the same plan re-priced higher
//     than the org's margin_tolerance_pct allows. They can re-pick, refund,
//     or (if the org allows) continue at the higher price.
//
// Three CTAs:
//   1. Pick a different plan — renders Good/Better/Best from vinRates via
//      selectPlans(). On selection, writes form.selectedPlan, recomputes
//      paymentSchedule, and advances to eSign (next step in normal order,
//      skipping back over RatesChanged).
//   2. Refund and exit — calls refundCharge from blinker-platform/integrations/payment.
//      On success: sets form.opportunityFlags.refunded=true, routes to ThankYou.
//      On failure: shows classified displayMessage + fallback CTA.
//      Gated by org.protection_billing.vin_validate.auto_refund_on_decline:
//      when false, the CTA becomes "Flag for manual review" and skips the
//      refund call entirely.
//   3. Continue with original — only when kind=plan_price_higher_outside_tolerance
//      AND org.protection_billing.vin_validate.allow_over_tolerance_proceed=true.
//
// Telemetry: protection.customer.rates_changed.{viewed,plan_repicked,
//   refund_initiated,refund_succeeded,refund_failed,continued_with_original}
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Loader2, AlertCircle, RefreshCw, ArrowRight, Flag,
} from 'lucide-react';
import { ScreenHeader, WizardFooter } from 'blinker-platform/components';
import { refundCharge } from 'blinker-platform/integrations/payment';
import { track } from 'blinker-platform/telemetry';
import { buildPassthroughForPlan } from 'blinker-platform/utils';
import { selectPlans } from '../../lib/plan-selector.js';
import { PlanCard } from '../../components/PlanCard.jsx';
import { TIER_ORDER } from '../../components/planCardCopy.js';
import orgRegistry from '../../constants/canon/org-registry.json';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readVinValidateConfig(orgId) {
  const org = orgRegistry.orgs.find((o) => o.id === orgId);
  const cfg = org?.protection_billing?.vin_validate ?? {};
  return {
    allowDownPaymentBypass:    cfg.allow_down_payment_bypass    ?? false,
    autoRefundOnDecline:       cfg.auto_refund_on_decline       ?? true,
    allowOverToleranceProceed: cfg.allow_over_tolerance_proceed ?? false,
    minDownPercent:            org?.protection_billing?.down_payment?.min_percent ?? 10,
  };
}

function fmtCurrency(v) {
  if (v == null) return '—';
  return `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Minimal proportional schedule recompute — same helper pattern as VinValidate.
function recomputeSchedule(schedule, newTotalCost) {
  if (!schedule || !newTotalCost) return schedule;
  const oldTotal = schedule.total_cost ?? 0;
  if (!oldTotal) return { ...schedule, total_cost: newTotalCost };
  const ratio = newTotalCost / oldTotal;
  return {
    ...schedule,
    total_cost:      newTotalCost,
    monthly_payment: schedule.monthly_payment != null ? Math.round(schedule.monthly_payment * ratio * 100) / 100 : schedule.monthly_payment,
    down_payment:    schedule.down_payment    != null ? Math.round(schedule.down_payment    * ratio * 100) / 100 : schedule.down_payment,
    due_today:       schedule.due_today       != null ? Math.round(schedule.due_today       * ratio * 100) / 100 : schedule.due_today,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RatesChanged({ form, update, onNext, persona = 'consumer' }) {
  const viewedRef = useRef(false);
  const kind = form.ratesChangeKind;
  const [refunding, setRefunding] = useState(false);
  const [refundError, setRefundError] = useState(null); // { displayMessage, kind }
  const [selectedVinTier, setSelectedVinTier] = useState(null);

  const config = useMemo(
    () => readVinValidateConfig(form.org_id),
    [form.org_id],
  );

  // Compute the Good/Better/Best plans from form.vinRates (VIN-decoded rates).
  const { plans: vinPlans } = useMemo(
    () => selectPlans({
      rates: form.vinRates,
      vehicle: { year: form.year, mileage: form.mileage },
      orgId: form.org_id,
    }),
    [form.vinRates, form.year, form.mileage, form.org_id],
  );

  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    track('protection.customer.rates_changed.viewed', {
      kind,
      org_id: form.org_id,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Banner copy per kind ──────────────────────────────────────────────────
  const bannerCopy =
    kind === 'plan_disappeared'
      ? "The coverage option you picked isn't available for this exact VIN. Pick a different plan or get your down payment refunded."
      : kind === 'plan_price_higher_outside_tolerance'
      ? "Your selected plan is available, but pricing came back higher than your initial quote. Pick a different plan, refund your down payment, or continue with the new pricing."
      : "Your coverage options changed after VIN verification. Please choose how you'd like to proceed.";

  // ── Plan re-pick handlers ─────────────────────────────────────────────────
  function pickVinPlan(tier) {
    setSelectedVinTier(tier);
  }

  function confirmRepick() {
    if (!selectedVinTier) return;
    const plan = vinPlans[selectedVinTier];
    if (!plan) return;

    const newPlan = {
      tier:        selectedVinTier,
      id:          plan.id,
      plan_code:   plan.raw?.plan_code ?? null,
      plan_name:   plan.name,
      provider:    plan.provider,
      term_months: plan.coverage_months,
      miles:       plan.coverage_miles,
      deductible:  plan.deductible,
      total_cost:  plan.total_cost,
      monthly_cost: plan.monthly_cost,
      // Wave 38: monthly-membership pass-through (term plans default term_total).
      billing_model: plan.billing_model ?? plan.raw?.billing_model ?? 'term_total',
      monthly_charge: plan.monthly_charge ?? plan.raw?.monthly_charge ?? null,
      term_used: plan.term_used ?? plan.raw?.coverage_period_months ?? plan.coverage_months ?? null,
    };

    // Down-payment bypass decision.
    // When allow_down_payment_bypass=false AND new plan's min-down > collected DP,
    // we surface a top-up notice (Phase 2 wires the real top-up flow).
    const collectedDp = form.paymentSchedule?.down_payment ?? 0;
    const newMinDown = (config.minDownPercent / 100) * plan.total_cost;
    const needsTopUp = !config.allowDownPaymentBypass && newMinDown > collectedDp;

    const newSchedule = recomputeSchedule(form.paymentSchedule, plan.total_cost);

    update({
      selectedPlan:    newPlan,
      paymentSchedule: newSchedule,
      opportunityFlags: {
        ...(form.opportunityFlags || {}),
        rates_changed:  true,
        plan_repicked:  true,
        needs_down_payment_top_up: needsTopUp || false,
      },
    });

    track('protection.customer.rates_changed.plan_repicked', {
      kind,
      tier:       selectedVinTier,
      plan_code:  plan.id,
      new_price:  plan.total_cost,
      needs_top_up: needsTopUp,
    });

    onNext(); // Advance to eSign (RatesChanged is skipped on back-nav because rates_changed still set).
  }

  // ── Refund & exit handlers ────────────────────────────────────────────────
  async function handleRefund() {
    // When auto_refund_on_decline=false, skip the call and just set the manual-review flag.
    if (!config.autoRefundOnDecline) {
      update({
        opportunityFlags: {
          ...(form.opportunityFlags || {}),
          manual_review_requested: true,
        },
      });
      track('protection.customer.rates_changed.refund_initiated', {
        kind,
        auto_refund: false,
      });
      onNext(); // Route to ThankYou — ThankYou reads opportunityFlags.manual_review_requested.
      return;
    }

    setRefunding(true);
    setRefundError(null);
    track('protection.customer.rates_changed.refund_initiated', {
      kind,
      charge_id: form.payment?.charge_id,
    });

    let result;
    try {
      result = await refundCharge(
        {
          charge_id: form.payment?.charge_id,
          amount:    form.payment?.amount_charged,
          reason:    `vin_validate_${kind}`,
        },
        { orgId: form.org_id },
      );
    } catch (err) {
      setRefunding(false);
      setRefundError({ displayMessage: err?.message || 'Refund call failed unexpectedly.', kind: 'network_error' });
      track('protection.customer.rates_changed.refund_failed', {
        kind,
        error: err?.message || 'unknown',
      });
      return;
    }

    setRefunding(false);

    if (result.outcome === 'approved') {
      update({
        refund: result,
        opportunityFlags: {
          ...(form.opportunityFlags || {}),
          refunded: true,
        },
      });
      track('protection.customer.rates_changed.refund_succeeded', {
        kind,
        refund_id: result.refund_id,
      });
      onNext(); // ThankYou handles the refunded variant.
    } else {
      setRefundError({
        displayMessage: result.classified?.displayMessage || 'Refund could not be processed at this time.',
        kind:           result.classified?.kind || result.outcome,
      });
      track('protection.customer.rates_changed.refund_failed', {
        kind,
        outcome:    result.outcome,
        error_kind: result.classified?.kind,
      });
    }
  }

  // ── Continue with original (outside-tolerance only, if org allows) ────────
  function handleContinueOriginal() {
    // Rewrite total_cost to the VIN-priced amount so eSign contract uses the real number.
    const vinPrice = form.vinRates && form.selectedPlan
      ? (() => {
          const sp = form.selectedPlan;
          const products = Array.isArray(form.vinRates?.products) ? form.vinRates.products : [];
          const match = products.find(
            (p) => String(p.plan_code ?? '') === String(sp.plan_code ?? '') &&
                   Number(p.coverage_period_months) === Number(sp.term_months) &&
                   Number(p.mileage) === Number(sp.miles),
          );
          return match?.base_price ?? sp.total_cost;
        })()
      : form.selectedPlan?.total_cost;

    const newPlan = { ...(form.selectedPlan || {}), total_cost: vinPrice };
    update({ selectedPlan: newPlan });

    track('protection.customer.rates_changed.continued_with_original', {
      kind,
      vin_price:  vinPrice,
      ymmt_price: form.selectedPlan?.total_cost,
    });

    onNext();
  }

  const noVinPlans = !vinPlans.best && !vinPlans.better && !vinPlans.good;
  const showContinueOriginal =
    kind === 'plan_price_higher_outside_tolerance' && config.allowOverToleranceProceed;

  return (
    <>
      <ScreenHeader
        icon={AlertTriangle}
        eyebrow="Coverage · Plan update needed"
        title="Your coverage options changed"
        subtitle={bannerCopy}
      />

      <div className="px-6 space-y-4">
        {/* ── Section 1: Pick a different plan ─────────────────────────── */}
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
            Option 1 — Pick a different plan
          </div>

          {noVinPlans && (
            <div className="text-sm text-amber-700 flex items-start gap-2 border border-amber-200 bg-amber-50 rounded-md p-3">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>No alternative plans are available for this VIN. Please refund your down payment or contact us for assistance.</div>
            </div>
          )}

          {TIER_ORDER.map((tier) => {
            const plan = vinPlans[tier];
            if (!plan) return null;
            const product =
              (form.vinRates?.products || []).find((p) => p.id === plan.id) || plan.raw || null;
            const passthrough = buildPassthroughForPlan({
              form,
              rates: form.vinRates,
              product,
            });
            return (
              <PlanCard
                key={tier}
                tier={tier}
                plan={plan}
                active={selectedVinTier === tier}
                onClick={() => pickVinPlan(tier)}
                orgId={form.org_id}
                passthrough={passthrough}
              />
            );
          })}

          {selectedVinTier && (
            <button
              onClick={confirmRepick}
              className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition"
            >
              <ArrowRight className="w-4 h-4" />
              Continue with {selectedVinTier} plan — {fmtCurrency(vinPlans[selectedVinTier]?.total_cost)}
            </button>
          )}

          {/* Down-payment top-up notice (Phase 1 stub — Phase 2 wires the real collect flow). */}
          {form.opportunityFlags?.needs_down_payment_top_up && (
            <div className="mt-2 text-xs text-amber-700 border border-amber-200 bg-amber-50 rounded-md px-3 py-2">
              <span className="font-semibold">Top-up required:</span> the new plan requires a higher minimum down payment than what was collected. An agent will follow up to collect the difference before your coverage activates.
            </div>
          )}
        </div>

        {/* ── Section 2: Refund and exit ───────────────────────────────── */}
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
            {config.autoRefundOnDecline ? 'Option 2 — Refund and exit' : 'Option 2 — Flag for manual review'}
          </div>

          {refundError && (
            <div className="text-sm text-rose-700 flex items-start gap-2 border border-rose-200 bg-rose-50 rounded-md p-3 mb-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold">Refund failed</div>
                <div className="mt-0.5">{refundError.displayMessage}</div>
                <div className="mt-1 text-xs">Please flag this for manual review — an agent will process the refund within 1 business day.</div>
              </div>
            </div>
          )}

          <button
            onClick={handleRefund}
            disabled={refunding}
            className={
              'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-semibold transition ' +
              (refunding
                ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                : config.autoRefundOnDecline
                ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200'
                : 'bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200')
            }
          >
            {refunding ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Processing refund…</>
            ) : config.autoRefundOnDecline ? (
              <><RefreshCw className="w-4 h-4" /> Refund my down payment and exit</>
            ) : (
              <><Flag className="w-4 h-4" /> Flag for manual review</>
            )}
          </button>

          {config.autoRefundOnDecline && (
            <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">
              Your down payment will be refunded in 5–7 business days. You can close this window after confirming.
            </p>
          )}
        </div>

        {/* ── Section 3: Continue with original (gated) ────────────────── */}
        {showContinueOriginal && (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
              Option 3 — Continue with updated pricing
            </div>
            <button
              onClick={handleContinueOriginal}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition"
            >
              <ArrowRight className="w-4 h-4" />
              Accept the new price and continue
            </button>
            <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">
              This continues coverage at the updated price returned for your VIN.
            </p>
          </div>
        )}
      </div>

      {/* No WizardFooter primary CTA — all CTAs are inline buttons above. */}
      <div className="h-6" />
    </>
  );
}
