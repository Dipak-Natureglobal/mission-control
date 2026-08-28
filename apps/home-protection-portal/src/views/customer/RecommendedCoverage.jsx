// Customer view · Step 3 — Recommended coverage.
//
// Three tier cards plus two global controls: the coverage TERM (12 / 24 / 36 /
// 48 months) and the BILLING MODE switch (fixed term ↔ month-to-month), which
// reuses the pattern ADR 28 established for the auto monthly-membership plans.
//
// THE 12-MONTH GAP
// ----------------
// Omega offers plan 35 at 12/24/36/48 months but plans 36 and 37 only at
// 24/36/48. At 12 months, Better and Best therefore do not exist. They render
// an explicit "not available at 12 months — Omega offers this at 24, 36, 48"
// card. They are NOT filled by borrowing a 24-month plan: the consumer chose a
// term, and quoting a different one under the same label would be a lie the
// agreement would then contradict.
//
// WHAT THE CARDS LEAD WITH
// ------------------------
// The MONTHLY PAYMENT, not the term total. A home warranty is bought as a
// monthly line in a household budget, and the term total was burying that.
// The total is still there, one line down, because the consumer is signing
// for it.
//
// When the home-features answers imply paid optional coverages, the card
// shows a RANGE: low is the plan alone, high is the plan plus every implied
// add-on at marked-up retail. Nothing is committed yet — the picker two steps
// later is where the consumer actually chooses — so a single number would be
// a guess in one direction. With no implied add-ons there is no range and the
// card shows one figure.
//
// The divisor under the monthly figure is the org's months-to-pay default FOR
// THE SELECTED COVERAGE TERM (12-month coverage defaults to 6 payments, the
// rest to 12), and the down payment equals one monthly payment — so the
// monthly recomputes when the term flips. All of that math lives in
// packages/utils/home-pricing.js; this screen only chooses the inputs.
//
// ADD-ON INVALIDATION
// -------------------
// Every plan change, term change and mode flip runs syncAddOns() before the
// new selection is committed. Both the OptionId and the price of an optional
// coverage move with the plan and the term, and those dollars are in the
// charge path (ADR 30 D7) — so a stale selection surviving a flip would
// mischarge. The picker on the next step revalidates again on mount; this is
// the first and more important of the two gates, because from here a consumer
// can flip the term and walk straight to Confirm.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, AlertCircle, Info, SlidersHorizontal, Loader2 } from 'lucide-react';
import { ScreenHeader, WizardFooter } from 'blinker-platform/components';
import { getRatesForHome } from 'blinker-platform/integrations/product_admin';
import { computeHomePriceRange } from 'blinker-platform/utils';
import { track } from 'blinker-platform/telemetry';
import { PlanCard } from '../../components/PlanCard.jsx';
import { PICKER_ORDER } from '../../components/homePlanCopy.js';
import {
  selectHomePlans,
  buildSelectedPlan,
  defaultTerm,
} from '../../lib/home-plan-selector.js';
import { syncAddOns, availableAddOns, impliedAddOnCosts } from '../../lib/addon-sync.js';
import { pricingState, paymentBasis } from '../../lib/home-money.js';

export function RecommendedCoverage({ form, update, onNext, persona = 'consumer' }) {
  const viewedRef = useRef(false);
  const ratesFetchRef = useRef(false);
  const [isFetching, setIsFetching] = useState(false);

  // Backstop GetRates dispatch. The normal path fires it on home_add's
  // Continue; this covers an agent who resumed the wizard at this step from a
  // 'Quoted' opportunity whose rate payload was never persisted.
  useEffect(() => {
    if (ratesFetchRef.current) return;
    if (form.rates) return;
    const state = form.home?.address?.state;
    if (!state) return;
    ratesFetchRef.current = true;
    track('home_protection.customer.recommended_coverage.get_rates.fallback_requested', { state });
    (async () => {
      // setState lives inside the async callback, not the effect body: this
      // effect subscribes to an external system (the rater) and writes React
      // state only when that system answers.
      setIsFetching(true);
      try {
        const rates = await getRatesForHome({ state }, { orgId: form.org_id });
        track('home_protection.customer.recommended_coverage.get_rates.fallback_received', {
          product_count: rates?.products?.length ?? 0,
        });
        setIsFetching(false);
        update({ rates, status: (rates?.products?.length ?? 0) > 0 ? 'Quoted' : 'Quoted - No Results' });
      } catch (err) {
        track('home_protection.customer.recommended_coverage.get_rates.fallback_failed', {
          error: err?.message || 'unknown',
        });
        setIsFetching(false);
        ratesFetchRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.home?.address?.state]);

  const billingMode = form.billingMode === 'monthly' ? 'monthly' : 'term';

  // Term-independent facts about the quote: which terms exist overall, and
  // which exist per tier. Computed with a placeholder term so availableTerms
  // and termsByTier are populated before a term is chosen.
  const state = pricingState(form);

  const shape = useMemo(
    () => selectHomePlans({ rates: form.rates, orgId: form.org_id, termMonths: null, state }),
    [form.rates, form.org_id, state],
  );

  const coverageTerm = form.coverageTerm;

  // Seed the term on first arrival: the longest term at which all three tiers
  // exist, so the consumer's first paint is never two "not available" cards.
  useEffect(() => {
    if (billingMode === 'monthly') return;
    if (coverageTerm != null) return;
    const seed = defaultTerm(shape);
    if (seed == null) return;
    update({ coverageTerm: seed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape.availableTerms.join(','), billingMode]);

  const result = useMemo(
    () =>
      selectHomePlans({
        rates: form.rates,
        orgId: form.org_id,
        mode: billingMode,
        termMonths: coverageTerm,
        state,
      }),
    [form.rates, form.org_id, billingMode, coverageTerm, state],
  );

  const activePlans = billingMode === 'monthly' && result.hasMonthly
    ? (result.monthly || { good: null, better: null, best: null })
    : result.plans;

  // Default-select Best on entry.
  useEffect(() => {
    if (form.selectedPlan?.tier) return;
    const tier = activePlans.best ? 'best' : activePlans.better ? 'better' : activePlans.good ? 'good' : null;
    if (!tier) return;
    commitPlan(tier, activePlans[tier], coverageTerm, billingMode, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlans.best?.id, activePlans.better?.id, activePlans.good?.id]);

  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    track('home_protection.customer.recommended_coverage.viewed', {
      product_count: result.debug.product_count,
      has_monthly: result.hasMonthly,
      available_terms: result.availableTerms,
      persona,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Commit a plan choice AND re-resolve every add-on selection against it in
   * the SAME update, so no render can ever observe a plan and a selection
   * from different scopes.
   */
  function commitPlan(tier, planCandidate, termMonths, mode, { silent = false } = {}) {
    const selectedPlan = buildSelectedPlan(tier, planCandidate);
    const sync = syncAddOns({
      selected: form.selectedAddOns,
      plan: selectedPlan,
      termMonths: mode === 'monthly' ? null : termMonths,
      orgId: form.org_id,
    });

    update({
      selectedPlan,
      coverageTerm: mode === 'monthly' ? null : termMonths,
      billingMode: mode,
      selectedAddOns: sync.selectedAddOns,
      addOnsRevalidatedFor: sync.scopeKey,
      // The payment slice is seeded from canon defaults on Confirm and
      // branches on billing model. Clearing it forces a correct re-seed
      // rather than leaving a down payment on a monthly plan.
      payment: null,
      paymentSchedule: null,
      status: form.status === 'Empty' ? 'Quoted' : form.status,
    });

    if (sync.changed && !silent) {
      track('home_protection.customer.recommended_coverage.add_ons_revalidated', {
        kept: sync.selectedAddOns.length,
        dropped: sync.dropped.length,
        dropped_keys: sync.dropped.map((d) => d.key),
        scope: sync.scopeKey,
      });
    }
    return sync;
  }

  function pick(tier) {
    const candidate = activePlans[tier];
    if (!candidate) return;
    const prevTier = form.selectedPlan?.tier ?? null;
    commitPlan(tier, candidate, coverageTerm, billingMode);
    track('home_protection.customer.recommended_coverage.plan_selected', {
      tier,
      from_tier: prevTier,
      plan_code: candidate.plan_code,
      term_months: candidate.coverage_period_months,
      billing_model: candidate.billing_model,
      persona,
    });
  }

  function pickTerm(nextTerm) {
    if (nextTerm === coverageTerm) return;
    const next = selectHomePlans({
      rates: form.rates,
      orgId: form.org_id,
      mode: 'term',
      termMonths: nextTerm,
      state,
    });
    const curTier = form.selectedPlan?.tier ?? null;
    const tier = next.plans[curTier]
      ? curTier
      : next.plans.best ? 'best'
      : next.plans.better ? 'better'
      : next.plans.good ? 'good'
      : null;

    if (!tier) {
      // No plan at all at this term — still record the term so the cards can
      // explain themselves, and drop any stale selection.
      const sync = syncAddOns({ selected: form.selectedAddOns, plan: null, termMonths: nextTerm, orgId: form.org_id });
      update({
        coverageTerm: nextTerm,
        selectedPlan: null,
        selectedAddOns: sync.selectedAddOns,
        addOnsRevalidatedFor: null,
        payment: null,
        paymentSchedule: null,
      });
    } else {
      commitPlan(tier, next.plans[tier], nextTerm, 'term');
    }

    track('home_protection.customer.recommended_coverage.term_changed', {
      from_term: coverageTerm,
      to_term: nextTerm,
      tier,
      tier_changed: tier !== curTier,
      persona,
    });
  }

  function switchBillingMode(nextMode) {
    if (nextMode === billingMode) return;
    const nextTerm = nextMode === 'monthly' ? null : (coverageTerm ?? defaultTerm(shape));
    const next = selectHomePlans({
      rates: form.rates,
      orgId: form.org_id,
      mode: nextMode,
      termMonths: nextTerm,
      state,
    });
    const set = nextMode === 'monthly' ? (next.monthly || {}) : next.plans;
    const curTier = form.selectedPlan?.tier ?? null;
    const tier = set[curTier] ? curTier : set.best ? 'best' : set.better ? 'better' : set.good ? 'good' : null;

    if (tier) {
      commitPlan(tier, set[tier], nextTerm, nextMode);
    } else {
      update({ billingMode: nextMode, coverageTerm: nextTerm, selectedPlan: null, selectedAddOns: [], addOnsRevalidatedFor: null });
    }

    track('home_protection.customer.recommended_coverage.billing_mode_switched', {
      to_mode: nextMode,
      tier,
      persona,
    });
  }

  function handleNext() {
    track('home_protection.customer.recommended_coverage.continued', {
      tier: form.selectedPlan?.tier,
      plan_code: form.selectedPlan?.plan_code,
      billing_model: form.selectedPlan?.billing_model,
      persona,
    });
    update({ customizeRequested: false, status: 'Selected' });
    onNext();
  }

  function handleCustomize() {
    track('home_protection.customer.recommended_coverage.customize_requested', {
      tier: form.selectedPlan?.tier,
      plan_code: form.selectedPlan?.plan_code,
      persona,
    });
    update({ customizeRequested: true });
    onNext();
  }

  const isMonthlyMode = billingMode === 'monthly';
  const selectedTier = form.selectedPlan?.tier ?? null;
  const noPlans = !activePlans.good && !activePlans.better && !activePlans.best;
  const seError = form.rates?._error_classified ?? null;

  // ── the money on the cards ──────────────────────────────────────────────
  // The months-to-pay basis is per COVERAGE TERM, so it is re-read whenever
  // the term changes. Nothing is memoized: three tiers x twelve options is
  // trivial, and a stale range here is a wrong price on screen.
  const basis = paymentBasis({ orgId: form.org_id, coverageTermMonths: coverageTerm });
  const ranges = {};
  if (!isMonthlyMode) {
    for (const tier of PICKER_ORDER) {
      const candidate = activePlans[tier];
      if (!candidate) { ranges[tier] = null; continue; }
      ranges[tier] = computeHomePriceRange({
        orgId: form.org_id,
        basePrice: candidate.base_price,
        impliedAddOns: impliedAddOnCosts(
          availableAddOns(candidate, coverageTerm, form.org_id),
          form.homeFeatures,
        ),
        coverageTermMonths: coverageTerm,
        state,
        monthsToPay: basis.months,
      });
    }
  }

  return (
    <>
      <ScreenHeader
        icon={Sparkles}
        eyebrow="Coverage · Recommendation"
        title="Pick the coverage that fits"
        subtitle="Every plan carries a $75 deductible and a $75 service call fee."
      />

      <div className="px-6 space-y-4">
        {seError && (
          <div className="text-sm flex items-start gap-2 border rounded-md p-3 text-rose-700 border-rose-200 bg-rose-50">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold mb-0.5">Coverage rates unavailable</div>
              <div>{seError.displayMessage}</div>
            </div>
          </div>
        )}

        {isFetching && (
          <div className="text-xs text-blue-600 flex items-center justify-center gap-1 py-4">
            <Loader2 className="w-3 h-3 animate-spin" /> Pricing coverage…
          </div>
        )}

        {/* Billing-mode switch — only meaningful when the rater returned a
            month-to-month set. */}
        {result.hasMonthly && (
          <div className="flex items-center justify-center">
            <div className="inline-flex rounded-md border border-slate-200 overflow-hidden">
              <ModeButton
                active={!isMonthlyMode}
                onClick={() => switchBillingMode('term')}
                label="Fixed term"
              />
              <ModeButton
                active={isMonthlyMode}
                onClick={() => switchBillingMode('monthly')}
                label="Month to month"
              />
            </div>
          </div>
        )}

        {/* Term selector — term mode only. Monthly plans have no fixed term. */}
        {!isMonthlyMode && result.availableTerms.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wide font-semibold text-slate-500 mb-2 text-center">
              Coverage term
            </div>
            <div className="flex gap-2 justify-center">
              {result.availableTerms.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => pickTerm(t)}
                  className={
                    'px-4 py-1.5 text-sm rounded-md border font-semibold ' +
                    (t === coverageTerm
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50')
                  }
                >
                  {t} mo
                </button>
              ))}
            </div>
            {coverageTerm != null &&
              PICKER_ORDER.some((tier) => !activePlans[tier]) && (
                <div className="mt-2 text-[11px] text-slate-500 flex items-start gap-1.5 justify-center">
                  <Info className="w-3 h-3 mt-0.5 shrink-0" />
                  Not every plan is offered at {coverageTerm} months — see below.
                </div>
              )}
          </div>
        )}

        {isMonthlyMode && (
          <div className="text-[11px] text-slate-500 text-center">
            Month-to-month coverage runs 1–23 months. No down payment, no fixed
            number of payments, cancel any time.
          </div>
        )}

        {noPlans && !isFetching ? (
          <div className="text-sm text-slate-600 border border-dashed border-slate-300 rounded-md px-4 py-8 text-center">
            No coverage came back for this property
            {coverageTerm ? ` at ${coverageTerm} months` : ''}.
            {result.availableTerms.length > 0 && ' Try another coverage term above.'}
          </div>
        ) : (
          <div className="space-y-3">
            {PICKER_ORDER.map((tier) => (
              <PlanCard
                key={tier}
                tier={tier}
                plan={activePlans[tier]}
                active={selectedTier === tier}
                onClick={() => pick(tier)}
                orgId={form.org_id}
                termMonths={isMonthlyMode ? null : coverageTerm}
                otherTerms={result.termsByTier?.[tier] || []}
                range={isMonthlyMode ? null : ranges[tier]}
                monthsToPay={isMonthlyMode ? null : basis.months}
              />
            ))}
          </div>
        )}
      </div>

      <WizardFooter
        onNext={handleNext}
        disabled={!form.selectedPlan}
        nextLabel="Continue with this plan"
        secondary={
          <button
            type="button"
            onClick={handleCustomize}
            disabled={noPlans}
            className="text-xs text-slate-600 hover:text-slate-900 underline underline-offset-2 flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <SlidersHorizontal className="w-3 h-3" /> Customize coverage
          </button>
        }
      />
    </>
  );
}

function ModeButton({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'px-4 py-1.5 text-xs font-semibold ' +
        (active ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50')
      }
    >
      {label}
    </button>
  );
}
