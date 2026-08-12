// Customer view · Step 6 — Customize Coverage.
//
// Tier-aware plan browser. The user adjusts a tier filter (Good /
// Better / Best) plus three exact filters (term / miles / deductible)
// and we surface ALL plans matching the combo as a swipe carousel —
// one card visible at a time, arrow buttons + "Plan N of M" counter +
// dot indicators + touch swipe.
//
// Defaults:
//   - tier  = form.selectedPlan?.tier  (the tier picked on RecommendedCoverage)
//   - term, miles, deductible = form.selectedPlan?.{term_months, miles, deductible}
//   - carouselIndex = position of form.selectedPlan within the matching
//     array; 0 if not present
//
// Continue commits the currently-visible carousel card to
// form.selectedPlan (overrides whatever RecommendedCoverage left there).
// Empty state offers a "Reset to recommended" button that restores all
// four filters from form.selectedPlan and resets the carousel to 0.
//
// Cross-sell entry stays at RecommendedCoverage; this screen only
// READS form.insuranceSavings / form.refiOffer to feed the PlanCard
// the same way RecommendedCoverage does.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Sliders, AlertCircle, ChevronLeft, ChevronRight, Car } from 'lucide-react';
import { ScreenHeader, WizardFooter } from 'blinker-platform/components';
import { listMatchingPlans, billingModel } from '../../lib/plan-selector.js';
import { track } from 'blinker-platform/telemetry';
import { buildPassthroughForPlan } from 'blinker-platform/utils';
import { PlanCard } from '../../components/PlanCard.jsx';
import { RangeSlider } from '../../components/RangeSlider.jsx';
import { PUBLIC_TIER_COPY, TIER_ORDER } from '../../components/planCardCopy.js';
import orgRegistry from '../../constants/canon/org-registry.json';

function nearestInList(list, value) {
  if (!list || list.length === 0) return value;
  let best = list[0];
  let bestDiff = Math.abs(list[0] - value);
  for (const v of list) {
    const d = Math.abs(v - value);
    if (d < bestDiff) {
      best = v;
      bestDiff = d;
    }
  }
  return best;
}

// Snap a [min,max] pair to the nearest discrete options. Returns [low, high]
// with low <= high. If options is empty, returns the input unchanged.
function snapRangeToOptions(range, options) {
  if (!Array.isArray(options) || options.length === 0) return range;
  const sorted = [...options].sort((a, b) => a - b);
  const [a, b] = range || [];
  let lo = nearestInList(sorted, a ?? sorted[0]);
  let hi = nearestInList(sorted, b ?? sorted[sorted.length - 1]);
  if (lo > hi) [lo, hi] = [hi, lo];
  return [lo, hi];
}

function indexOfSelectedPlan(plans, selectedPlanCode) {
  if (!selectedPlanCode || !plans?.length) return 0;
  const idx = plans.findIndex((p) => p.id === selectedPlanCode);
  return idx >= 0 ? idx : 0;
}

export function Customize({ form, update, onNext }) {
  const filters = form.rates?.filters || {};
  // Wave 22 Task 5 — exclude 999999 from mileage options (reserved for the
  // monthly-membership UX). stoneeagle.js#normalizeToFixtureShape already
  // filters this in fixture mode, but defend at the consumer too.
  const termOptions = (filters.coverage_periods_months || []).slice();
  const mileOptions = (filters.mileages || []).filter((m) => m < 999999);
  // Wave 38: `filters.deductibles` is the TERM-plan deductible set only — the
  // upstream normalizer excludes monthly rows from that list. termDedOptions is
  // the term-mode source; monthlyDedOptions (below, gated on isMonthlyMode) is
  // derived from the monthly products' own deductibles so the filter pill
  // matches the monthly card (e.g. R6 → $0). Term mode is unchanged.
  const termDedOptions = filters.deductibles || [];

  // Wave 22 Task 5 — per-org default thumb positions for term + miles
  // sliders. Bounds (slider min/max) come from the GetRates filter lists
  // above; defaults seed the initial selected range. Snap to nearest
  // discrete option so the displayed range respects the actual response.
  const org = useMemo(
    () => orgRegistry.orgs.find((o) => o.id === form.org_id) || null,
    [form.org_id],
  );
  const termDefaults = org?.protection_billing?.coverage_term_defaults || { min: 48, max: 60 };
  const milesDefaults = org?.protection_billing?.coverage_miles_defaults || { min: 50000, max: 75000 };

  const seedTermRange = useMemo(
    () => snapRangeToOptions([termDefaults.min, termDefaults.max], termOptions),
    [termDefaults.min, termDefaults.max, termOptions],
  );
  const seedMilesRange = useMemo(
    () => snapRangeToOptions([milesDefaults.min, milesDefaults.max], mileOptions),
    [milesDefaults.min, milesDefaults.max, mileOptions],
  );

  // Wave 38: term↔monthly filter. 'term' (default) browses term-total plans;
  // 'monthly' browses monthly-membership plans (sliders hidden). The pill row
  // only renders when the rates response actually carries monthly products.
  // Declared early because the deductible-filter source + the initial
  // deductible seed both depend on the active billing mode.
  const hasMonthly = useMemo(
    () => (form.rates?.products || []).some((p) => billingModel(p) === 'monthly_subscription'),
    [form.rates],
  );
  const [billingFilter, setBillingFilter] = useState(
    () => (form.selectedPlan?.billing_model === 'monthly_subscription' && hasMonthly ? 'monthly' : 'term'),
  );
  const isMonthlyMode = billingFilter === 'monthly' && hasMonthly;

  // Wave 38: monthly-mode deductible options. The term-plan filter set
  // (termDedOptions / filters.deductibles) excludes monthly rows upstream, so
  // in monthly mode we derive the pill list from the monthly products' OWN
  // deductibles — sorted unique. This makes the pill match the monthly card
  // (e.g. R6 → $0). Term mode keeps termDedOptions untouched.
  const monthlyDedOptions = useMemo(
    () => [
      ...new Set(
        (form.rates?.products || [])
          .filter((p) => billingModel(p) === 'monthly_subscription')
          .map((p) => Number(p.deductible || 0)),
      ),
    ].sort((a, b) => a - b),
    [form.rates],
  );
  // Effective deductible options for the active billing mode.
  const dedOptions = isMonthlyMode ? monthlyDedOptions : termDedOptions;

  const initialTier = form.customizeCriteria?.tier ?? form.selectedPlan?.tier ?? 'best';
  // Range-aware initial values. Back-compat: if customizeCriteria carries
  // legacy term/miles scalars (from a prior visit before sliders), upgrade
  // them into [v, v] ranges.
  const initialTermRange =
    form.customizeCriteria?.termRange
    ?? (form.customizeCriteria?.term != null
        ? [form.customizeCriteria.term, form.customizeCriteria.term]
        : seedTermRange);
  const initialMilesRange =
    form.customizeCriteria?.milesRange
    ?? (form.customizeCriteria?.miles != null
        ? [form.customizeCriteria.miles, form.customizeCriteria.miles]
        : seedMilesRange);
  const initialDeductible = form.customizeCriteria?.deductible ?? form.selectedPlan?.deductible ?? dedOptions[0] ?? 0;

  // Persist initial criteria once, so subsequent renders read from form.
  useEffect(() => {
    if (form.customizeCriteria) return;
    update({
      customizeCriteria: {
        tier: initialTier,
        termRange: initialTermRange,
        milesRange: initialMilesRange,
        deductible: initialDeductible,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Read-only criteria projection. Defensive normalize handles legacy
  // form state that carries scalar `term`/`miles` (from a prior wave) by
  // upgrading them to single-point ranges. We never mutate the source
  // form value — we derive a local view of it.
  const rawCriteria = form.customizeCriteria || {
    tier: initialTier,
    termRange: initialTermRange,
    milesRange: initialMilesRange,
    deductible: initialDeductible,
  };
  const criteria = {
    ...rawCriteria,
    termRange: rawCriteria.termRange
      ?? (rawCriteria.term != null ? [rawCriteria.term, rawCriteria.term] : initialTermRange),
    milesRange: rawCriteria.milesRange
      ?? (rawCriteria.miles != null ? [rawCriteria.miles, rawCriteria.miles] : initialMilesRange),
  };
  const termLo = criteria.termRange?.[0];
  const termHi = criteria.termRange?.[1];
  const milesLo = criteria.milesRange?.[0];
  const milesHi = criteria.milesRange?.[1];

  // Wave 38: when in monthly mode, keep criteria.deductible inside the monthly
  // deductible set. The term-mode default (e.g. $100) is often absent from the
  // monthly products' deductibles ($0 for R6), which would filter every card
  // out. Snap to the selected monthly plan's deductible if known, else the
  // first monthly option. Term mode never runs this — guarded on isMonthlyMode.
  useEffect(() => {
    if (!isMonthlyMode || monthlyDedOptions.length === 0) return;
    if (monthlyDedOptions.includes(Number(criteria.deductible))) return;
    const selDed =
      form.selectedPlan?.billing_model === 'monthly_subscription'
        ? Number(form.selectedPlan?.deductible)
        : null;
    const next =
      selDed != null && monthlyDedOptions.includes(selDed) ? selDed : monthlyDedOptions[0];
    update({ customizeCriteria: { ...criteria, deductible: next } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMonthlyMode, monthlyDedOptions, criteria.deductible]);

  // Wave 23 Task 5c: rate-class chip filter. 'all' = show every plan.
  // Chips only render when the plan set actually contains both rate classes.
  const [rateClassFilter, setRateClassFilter] = useState('all');

  // Wave 23 Task 6b: compute vehicle's current term (months since in-service)
  // for additive term_basis filter math. Falls back to 0 when the date is
  // unknown so additive math degrades gracefully ("as if a new contract").
  const currentTermMonths = useMemo(() => {
    const raw = form.vehicle?.in_service_date || form.purchaseDate || null;
    if (!raw) return 0;
    const inService = new Date(raw);
    if (isNaN(inService.getTime())) return 0;
    const now = new Date();
    return Math.max(0, Math.round((now - inService) / (1000 * 60 * 60 * 24 * 30.44)));
  }, [form.vehicle?.in_service_date, form.purchaseDate]);

  const currentMiles = Number(form.mileage || 0);

  // Cross-sell math — mirror RecommendedCoverage lines 220-226 + 276
  // so the carousel card renders the same strike-through / addition
  // lines the user already saw on the previous screen.
  const insuranceMonthlyDollars = form.insuranceSavings?.monthlySavingsCents
    ? form.insuranceSavings.monthlySavingsCents / 100
    : 0;
  const refiAdditionDollars = form.refiOffer?.protectionPlanPortionCents
    ? form.refiOffer.protectionPlanPortionCents / 100
    : 0;
  const insuranceCarrier = form.insuranceSavings?.captureCarrier;

  const matchingPlans = useMemo(
    () => listMatchingPlans({
      rates: form.rates,
      vehicle: { year: form.year, mileage: form.mileage },
      orgId: form.org_id,
      tier: criteria.tier,
      // Wave 38: in monthly mode the selector ignores term/mile ranges, so we
      // pass them anyway for term mode and the selector drops them for monthly.
      termRange: [termLo, termHi],
      milesRange: [milesLo, milesHi],
      deductible: criteria.deductible,
      // Wave 23 Task 5c + 6b.
      rateClass: rateClassFilter === 'all' ? null : rateClassFilter,
      currentTermMonths,
      currentMiles,
      mode: isMonthlyMode ? 'monthly' : 'term',
    }),
    // Range fields extracted to scalars above so eslint can statically
    // check the dependency array.
    [
      form.rates,
      form.year,
      form.mileage,
      form.org_id,
      criteria.tier,
      termLo,
      termHi,
      milesLo,
      milesHi,
      criteria.deductible,
      rateClassFilter,
      currentTermMonths,
      currentMiles,
      isMonthlyMode,
    ],
  );

  // Wave 23 Task 5c: only show rate-class chips when the full (unfiltered)
  // candidate set has at least one 'new' plan. Avoids a confusing disabled
  // chip row when all plans are fixture-mode (rate_class = null).
  const allCandidatesForTier = useMemo(
    () => listMatchingPlans({
      rates: form.rates,
      vehicle: { year: form.year, mileage: form.mileage },
      orgId: form.org_id,
      tier: criteria.tier,
      currentTermMonths,
      currentMiles,
    }),
    [form.rates, form.year, form.mileage, form.org_id, criteria.tier, currentTermMonths, currentMiles],
  );
  const hasNewPlans  = allCandidatesForTier.some((p) => p.rate_class === 'new');
  const hasUsedPlans = allCandidatesForTier.some((p) => p.rate_class === 'used');
  const showRateClassChips = hasNewPlans && hasUsedPlans;

  const matchCount = matchingPlans.length;

  // Carousel index. Reset on filter change — but if the new array
  // contains form.selectedPlan, jump to that position so the user lands
  // on their previously-selected card.
  const [carouselIndex, setCarouselIndex] = useState(() =>
    indexOfSelectedPlan(matchingPlans, form.selectedPlan?.plan_code),
  );

  // When matchingPlans changes (filter change), recompute index.
  // Track the array identity so we only reset when the matching set
  // actually changes — not on unrelated re-renders.
  const matchingPlansRef = useRef(matchingPlans);
  useEffect(() => {
    if (matchingPlansRef.current === matchingPlans) return;
    matchingPlansRef.current = matchingPlans;
    setCarouselIndex(indexOfSelectedPlan(matchingPlans, form.selectedPlan?.plan_code));
  }, [matchingPlans, form.selectedPlan?.plan_code]);

  const visiblePlan = matchCount > 0 ? matchingPlans[Math.min(carouselIndex, matchCount - 1)] : null;

  // PostHog: viewed (once on mount).
  const viewedRef = useRef(false);
  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    track('protection.customer.customize.viewed', {
      starting_tier: criteria.tier,
      starting_term_range: criteria.termRange,
      starting_miles_range: criteria.milesRange,
      starting_deductible: criteria.deductible,
      match_count: matchCount,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setCriteria(patch) {
    const next = { ...criteria, ...patch };
    update({ customizeCriteria: next });
    track('protection.customer.customize.criteria_changed', next);
  }

  // Wave 22 Task 5 — distinct PostHog event per range slider change so we
  // can analyze tightening/loosening behavior independent of the umbrella
  // criteria_changed event.
  function setTermRange(nextRange) {
    setCriteria({ termRange: nextRange });
    track('protection.customer.customize.range_changed', {
      field: 'term',
      min: nextRange?.[0] ?? null,
      max: nextRange?.[1] ?? null,
    });
  }
  function setMilesRange(nextRange) {
    setCriteria({ milesRange: nextRange });
    track('protection.customer.customize.range_changed', {
      field: 'miles',
      min: nextRange?.[0] ?? null,
      max: nextRange?.[1] ?? null,
    });
  }

  function navigate(toIndex, source) {
    if (toIndex < 0 || toIndex >= matchCount) return;
    if (toIndex === carouselIndex) return;
    const fromIndex = carouselIndex;
    setCarouselIndex(toIndex);
    track('protection.customer.customize.plan_navigated', {
      from_index: fromIndex,
      to_index: toIndex,
      plan_code: matchingPlans[toIndex]?.id || null,
      total_matching: matchCount,
      source,
    });
  }

  function resetToRecommended() {
    // Center each range on the previously-selected plan's value (if any),
    // otherwise fall back to the per-org canon defaults — same seed used
    // on first mount.
    const selT = form.selectedPlan?.term_months;
    const selM = form.selectedPlan?.miles;
    const reset = {
      tier: form.selectedPlan?.tier ?? 'best',
      termRange: selT != null
        ? snapRangeToOptions([selT, selT], termOptions)
        : seedTermRange,
      milesRange: selM != null
        ? snapRangeToOptions([selM, selM], mileOptions)
        : seedMilesRange,
      deductible: form.selectedPlan?.deductible ?? dedOptions[0] ?? 0,
    };
    update({ customizeCriteria: reset });
    setCarouselIndex(0);
    track('protection.customer.customize.reset_to_recommended', reset);
  }

  function handleNext() {
    if (!visiblePlan) {
      // Empty state — Continue is disabled, but guard anyway.
      return;
    }
    const isMonthlyPlan = visiblePlan.billing_model === 'monthly_subscription';
    update({
      selectedPlan: {
        tier: visiblePlan.plan_quality,
        plan_code: visiblePlan.id,
        plan_name: visiblePlan.name,
        provider: visiblePlan.provider,
        term_months: visiblePlan.coverage_months,
        miles: visiblePlan.coverage_miles,
        deductible: visiblePlan.deductible,
        total_cost: visiblePlan.total_cost,
        monthly_cost: visiblePlan.monthly_cost,
        // Wave 38: monthly-membership pass-through (term plans default term_total).
        billing_model: visiblePlan.billing_model ?? 'term_total',
        monthly_charge: visiblePlan.monthly_charge ?? null,
        term_used: visiblePlan.term_used ?? visiblePlan.coverage_months ?? null,
      },
      // Reset payment slice so Confirm re-seeds for the right billing model.
      ...(isMonthlyPlan !== (form.selectedPlan?.billing_model === 'monthly_subscription')
        ? { payment: null }
        : {}),
    });
    track('protection.customer.customize.continued', {
      tier: visiblePlan.plan_quality,
      plan_code: visiblePlan.id,
      plan_name: visiblePlan.name,
      term_months: visiblePlan.coverage_months,
      miles: visiblePlan.coverage_miles,
      deductible: visiblePlan.deductible,
      total_cost: visiblePlan.total_cost,
      monthly_cost: visiblePlan.monthly_cost,
      carousel_index: carouselIndex,
      total_matching: matchCount,
    });
    onNext();
  }

  // Touch swipe handlers — hand-rolled, no dep. >50px horizontal swipe
  // steps the carousel ±1. Also tracks pointerdown / mousedown for desktop
  // testing in Cowork's iframe (touch events don't always fire there).
  const swipeStartX = useRef(null);
  function onTouchStart(e) {
    if (matchCount <= 1) return;
    swipeStartX.current = e.touches?.[0]?.clientX ?? e.clientX ?? null;
  }
  function onTouchEnd(e) {
    if (matchCount <= 1 || swipeStartX.current == null) return;
    const endX = e.changedTouches?.[0]?.clientX ?? e.clientX ?? null;
    if (endX == null) {
      swipeStartX.current = null;
      return;
    }
    const dx = endX - swipeStartX.current;
    swipeStartX.current = null;
    if (Math.abs(dx) < 50) return;
    if (dx < 0) navigate(carouselIndex + 1, 'swipe');
    else navigate(carouselIndex - 1, 'swipe');
  }

  return (
    <>
      <ScreenHeader
        icon={Sliders}
        eyebrow="Coverage · Customize"
        title="Browse plans that fit"
        subtitle="Pick a tier and your ideal term, mileage, and deductible. Swipe through every plan that matches."
      />

      <div className="px-6 space-y-5">
        {/* Wave 38: term↔monthly filter pills — mirrors the Rate class pill
            pattern. Only shown when monthly-membership plans exist. Switching
            to monthly hides the term/mile sliders (they don't apply). */}
        {hasMonthly && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Billing</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { key: 'term', label: 'Pay per term' },
                { key: 'monthly', label: 'Monthly membership' },
              ].map(({ key, label }) => {
                const active = billingFilter === key;
                return (
                  <button
                    key={key}
                    onClick={() => {
                      setBillingFilter(key);
                      track('protection.customer.customize.billing_filter_changed', { to_mode: key });
                    }}
                    className={
                      'px-3 py-1.5 rounded-md border text-xs font-medium ' +
                      (active
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700')
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Tier filter pills */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tier</span>
            <span className="text-sm font-semibold text-slate-900">
              {PUBLIC_TIER_COPY[criteria.tier]?.label || criteria.tier}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {TIER_ORDER.map((t) => {
              const active = t === criteria.tier;
              return (
                <button
                  key={t}
                  onClick={() => setCriteria({ tier: t })}
                  className={
                    'px-3 py-1.5 rounded-md border text-xs font-medium ' +
                    (active
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700')
                  }
                >
                  {PUBLIC_TIER_COPY[t]?.label || t}
                </button>
              );
            })}
          </div>
        </div>

        {/* Term/mile sliders — hidden in monthly mode (unlimited miles, term
            is the charge basis, not a customer-selectable range). */}
        {!isMonthlyMode && (
          <>
            <RangeSlider
              label="Coverage period"
              unit="months"
              options={termOptions}
              value={criteria.termRange}
              onChange={setTermRange}
            />
            <RangeSlider
              label="Mileage cap"
              unit="miles"
              options={mileOptions}
              value={criteria.milesRange}
              formatValue={(v) => v.toLocaleString()}
              onChange={setMilesRange}
            />
          </>
        )}
        <Stepper
          label="Deductible"
          unit=""
          options={dedOptions}
          value={criteria.deductible}
          formatValue={(v) => `$${v}`}
          onChange={(v) => setCriteria({ deductible: v })}
        />

        {/* Wave 23 Task 5c: rate-class chip filter. Only surfaces when SE
            returned both new-rate and used-rate plans (proxy mode + new vehicle).
            Single-select; All = no filter. Matches existing tier pill styling. */}
        {showRateClassChips && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rate class</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { key: 'all',  label: 'All' },
                { key: 'new',  label: 'New rate' },
                { key: 'used', label: 'Used rate' },
              ].map(({ key, label }) => {
                const active = rateClassFilter === key;
                return (
                  <button
                    key={key}
                    onClick={() => setRateClassFilter(key)}
                    className={
                      'px-3 py-1.5 rounded-md border text-xs font-medium ' +
                      (active
                        ? 'border-violet-600 bg-violet-600 text-white'
                        : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700')
                    }
                  >
                    {key === 'new' && <Car className="inline w-3 h-3 mr-1 -mt-0.5" />}
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Carousel or empty state */}
        {matchCount === 0 ? (
          <div className="border border-amber-200 rounded-md p-4 bg-amber-50 space-y-3">
            <div className="text-sm text-amber-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5" />
              <div>No plans match these filters.</div>
            </div>
            <button
              onClick={resetToRecommended}
              className="w-full px-3 py-2 rounded-md border border-amber-300 bg-white text-xs font-semibold text-amber-800 hover:bg-amber-100"
            >
              Reset to recommended
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <button
                onClick={() => navigate(carouselIndex - 1, 'arrow')}
                disabled={carouselIndex === 0}
                aria-label="Previous plan"
                className={
                  'p-2 rounded-md border ' +
                  (carouselIndex === 0
                    ? 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300')
                }
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Plan {carouselIndex + 1} of {matchCount}
              </span>
              <button
                onClick={() => navigate(carouselIndex + 1, 'arrow')}
                disabled={carouselIndex >= matchCount - 1}
                aria-label="Next plan"
                className={
                  'p-2 rounded-md border ' +
                  (carouselIndex >= matchCount - 1
                    ? 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300')
                }
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
            >
              <PlanCard
                tier={visiblePlan.plan_quality}
                plan={visiblePlan}
                active={true}
                onClick={() => {}}
                insuranceMonthlyDollars={insuranceMonthlyDollars}
                refiAdditionDollars={refiAdditionDollars}
                insuranceCarrier={insuranceCarrier}
                passthrough={buildPassthroughForPlan({
                  form,
                  rates: form.rates,
                  product: (form.rates?.products || []).find((p) => p.id === visiblePlan.id) || visiblePlan.raw || null,
                })}
                orgId={form.org_id}
              />
            </div>

            {matchCount > 1 && (
              <div className="flex items-center justify-center gap-2 pt-1">
                {matchingPlans.map((p, i) => {
                  const active = i === carouselIndex;
                  return (
                    <button
                      key={p.id}
                      onClick={() => navigate(i, 'dot')}
                      aria-label={`Jump to plan ${i + 1}`}
                      className={
                        'w-2 h-2 rounded-full ' +
                        (active ? 'bg-blue-600' : 'bg-slate-300 hover:bg-slate-400')
                      }
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <WizardFooter
        onNext={handleNext}
        disabled={!visiblePlan}
        nextLabel="Looks good — continue"
      />
    </>
  );
}

// A discrete stepper bound to the StoneEagle filter list. We use a plain
// list of option pills rather than a range slider because the available
// values are discrete and arbitrary (e.g. miles = [36k, 48k, 50k, 60k...]).
function Stepper({ label, unit, options, value, onChange, formatValue }) {
  const fmt = formatValue || ((v) => String(v));
  const sorted = [...options].sort((a, b) => a - b);
  const snapped = sorted.includes(value) ? value : nearestInList(sorted, value);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <span className="text-sm font-semibold text-slate-900">
          {fmt(snapped)}{unit ? ` ${unit}` : ''}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {sorted.map((opt) => {
          const active = opt === snapped;
          return (
            <button
              key={opt}
              onClick={() => onChange(opt)}
              className={
                'px-3 py-1.5 rounded-md border text-xs font-medium ' +
                (active
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700')
              }
            >
              {fmt(opt)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
