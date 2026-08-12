// Customer view · Step 5 — Recommended Coverage.
//
// Wave 32 v3.0.12 — RecommendedCoverage redesign.
// Replaces the stacked PlanCard layout with a segmented tier picker
// (3 horizontal buttons — Best / Better / Good) and a single selected-plan
// details card. Total price and add-ons breakdown are hidden at this stage
// per ADR 22 D2 (they reappear at Customize / Confirm / Billing).
//
// Coverage heading sourcing: hardcoded tier strings ("Most comprehensive
// coverage available" / "Extensive coverage…" / "Affordable coverage…")
// matching the H2 text from plan_coverage_default_html. Avoids fragile
// DOM parsing of coverageHtml at runtime. When an org override or catalog
// entry provides custom coverageHtml, the tier heading may diverge from
// that HTML — acceptable for v3.0.12; a Phase 2 admin field can surface
// a plan-specific heading string if needed.
//
// Covered components: sourced from resolvePlanPresentation().coveredComponents
// (string array). Falls back through org_override → catalog → level_default →
// [] per ADR 22 D4.
//
// Insurance savings integration (ADR 22 D5):
//   monthlySavingsCents > 0  → info box + strikethrough + footnote
//   status === 'no_savings'  → original monthly only (no info box, no strikethrough)
//   insuranceSavings == null → same as no_savings (cross-sell not run yet)
//
// Wave 31b regression preserved (ADR 22 D6):
//   CrossSellCtas Result Chip  → "We will continue to monitor savings" when no_savings
//   Find insurance savings CTA → marked DONE when hasInsuranceResult is truthy
//   PlanCard savings line      → no longer mounted here; replaced by tier-picker
//                                 strikethrough (conditional on monthlySavingsCents > 0,
//                                 so zero-savings → plain monthly, same net outcome)
//
// HMR caveat: Vite HMR doesn't reliably propagate edits inside `file:`-
// linked deps. After upstream changes restart `npm run dev`.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles, AlertCircle, Info,
  TrendingDown, Calculator, X, SlidersHorizontal,
  ShieldCheck, Check, Zap,
} from 'lucide-react';
import { ScreenHeader, WizardFooter } from 'blinker-platform/components';
import { selectPlans } from '../../lib/plan-selector.js';
// Wave 21: lifted to blinker-platform/integrations/product_admin. Phase 2 swap
// will flip the package's _PROVIDER_MODE constant from 'fixture' to 'proxy'
// at packages/integrations/product_admin/stoneeagle.js — single line change,
// no consumer-side update needed.
import { getRates } from 'blinker-platform/integrations/product_admin';
import { formatCents } from 'insurance-portal/src/lib/money.js';
import orgRegistry from '../../constants/canon/org-registry.json';
import { track } from 'blinker-platform/telemetry';
import { buildPassthroughForPlan, resolvePlanPresentation } from 'blinker-platform/utils';
import { PlanCoverageModal } from '../../components/PlanCoverageModal.jsx';
// TIER_ORDER still used for iteration; PlanCard no longer mounted here
// (it remains exported from PlanCard.jsx — Customize and RatesChanged still use it).
import { TIER_ORDER } from '../../components/planCardCopy.js';

const DEFAULT_CROSS_SELL = { insurance_enabled: false, refi_enabled: false };

// Coverage headings per tier — hardcoded to match the H2 text in
// plan_coverage_default_html. Safe fallback when coverageHtml is absent.
const TIER_COVERAGE_HEADING = {
  best:   'Most comprehensive coverage available',
  better: 'Extensive coverage that protects a wide range of components',
  good:   'Affordable coverage designed for older vehicles',
};

// Wave 38: build the form.selectedPlan slice from a selector candidate.
// Always copies billing_model / monthly_charge / term_used so the Confirm
// screen can branch. Term plans default billing_model to 'term_total'.
function buildSelectedPlan(tier, plan) {
  return {
    tier,
    id:        plan.id,
    plan_code: plan.raw?.plan_code ?? null,
    plan_name: plan.name,
    provider: plan.provider,
    term_months: plan.coverage_months,
    miles: plan.coverage_miles,
    deductible: plan.deductible,
    total_cost: plan.total_cost,
    monthly_cost: plan.monthly_cost,
    // Monthly-membership pass-through.
    billing_model: plan.billing_model ?? plan.raw?.billing_model ?? 'term_total',
    monthly_charge: plan.monthly_charge ?? plan.raw?.monthly_charge ?? null,
    term_used: plan.term_used ?? plan.raw?.coverage_period_months ?? plan.coverage_months ?? null,
  };
}

function readCrossSellConfig(orgId, devOverrides) {
  const fromCanon =
    orgRegistry.orgs.find((o) => o.id === orgId)?.cross_sell || DEFAULT_CROSS_SELL;
  return {
    insurance_enabled: devOverrides?.insurance_enabled ?? fromCanon.insurance_enabled ?? false,
    refi_enabled: devOverrides?.refi_enabled ?? fromCanon.refi_enabled ?? false,
  };
}

export function RecommendedCoverage({
  form,
  update,
  onNext,
  // Persona-driven affordance ordering: agent persona puts CTAs ABOVE
  // the tier picker (proactive selling tool); consumer persona puts them
  // BELOW (soft suggestion after the consumer has seen the recommendations).
  persona = 'consumer',
  // Callback fired when the consumer / agent clicks one of the CTAs.
  onOpenCrossSell,
  // DEV CONTROLS overrides for cross-sell gating (Chunk 5).
  crossSellOverrides,
}) {
  const viewedRef = useRef(false);
  const ratesFetchRef = useRef(false);
  const loadingShownRef = useRef(false);
  const [isFetching, setIsFetching] = useState(false);

  // Wave 16 F4: GetRates dispatch fallback — backstop for when GarageLocation
  // short-circuits (contact already has zip+state from MC prefill).
  useEffect(() => {
    if (ratesFetchRef.current) return;
    if (form.rates) return;
    const c = form.contact || {};
    const stateForRates = c.state ?? form.state ?? null;
    if (!c.zip || !stateForRates) return;
    ratesFetchRef.current = true;
    track('protection.customer.recommended_coverage.get_rates.fallback_requested', {
      year: form.year,
      make: form.make,
      model: form.model,
      trim: form.trim,
      mileage: form.mileage,
      condition: form.condition,
      state: stateForRates,
    });
    setIsFetching(true);
    (async () => {
      try {
        const rates = await getRates({
          year: form.year,
          make: form.make,
          model: form.model,
          trim: form.trim,
          mileage: form.mileage,
          condition: form.condition,
          vin: form.vin || null,
          state: stateForRates,
          asset_type: form.vehicle?.asset_type ?? null,
        }, { orgId: form.org_id });
        track('protection.customer.recommended_coverage.get_rates.fallback_received', {
          product_count: rates?.products?.length ?? 0,
          add_on_count: rates?.add_ons?.length ?? 0,
          error_classified: rates?._error_classified?.kind ?? null,
        });
        setIsFetching(false);
        update({ rates, status: 'rates_received' });
      } catch (err) {
        track('protection.customer.recommended_coverage.get_rates.fallback_failed', {
          error: err?.message || 'unknown',
        });
        setIsFetching(false);
        ratesFetchRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.contact?.zip, form.contact?.state]);

  const { plans, monthly, hasMonthly, debug } = useMemo(
    () => selectPlans({
      rates: form.rates,
      vehicle: { year: form.year, mileage: form.mileage },
      orgId: form.org_id,
    }),
    [form.rates, form.year, form.mileage, form.org_id],
  );

  // Wave 38: global term↔monthly switch. Only meaningful when hasMonthly.
  // 'term' = show the term-total Good/Better/Best set (result.plans);
  // 'monthly' = show the monthly-membership set (result.monthly).
  const [billingMode, setBillingMode] = useState('term');
  const activePlans = billingMode === 'monthly' && hasMonthly ? (monthly || {}) : plans;

  const crossSell = useMemo(
    () => readCrossSellConfig(form.org_id, crossSellOverrides),
    [form.org_id, crossSellOverrides],
  );

  // Default-select Best on entry per plan_level_defaults.best.default_selected.
  useEffect(() => {
    if (form.selectedPlan?.tier) return;
    const defaultTier = plans.best ? 'best' : plans.better ? 'better' : plans.good ? 'good' : null;
    if (!defaultTier) return;
    update({ selectedPlan: buildSelectedPlan(defaultTier, plans[defaultTier]) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans.best?.id, plans.better?.id, plans.good?.id]);

  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    track('protection.customer.recommended_coverage.viewed', {
      best_plan_code: plans.best?.id || null,
      better_plan_code: plans.better?.id || null,
      good_plan_code: plans.good?.id || null,
      candidate_count: debug.candidate_count,
      fallbacks_used: debug.fallbacks,
      cross_sell_insurance_enabled: crossSell.insurance_enabled,
      cross_sell_refi_enabled: crossSell.refi_enabled,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pick(tier) {
    const plan = activePlans[tier];
    if (!plan) return;
    const prevTier = form.selectedPlan?.tier ?? null;
    update({ selectedPlan: buildSelectedPlan(tier, plan) });
    track('protection.customer.recommended_coverage.plan_selected', {
      tier,
      plan_code: plan.id,
      term_months: plan.coverage_months,
      miles: plan.coverage_miles,
      billing_model: plan.billing_model ?? 'term_total',
    });
    // Wave 32 v3.0.12 — new tier-toggle event
    track('protection.customer.recommended_coverage.tier_toggled', {
      from_tier: prevTier,
      to_tier: tier,
      has_insurance_savings: (form.insuranceSavings?.monthlySavingsCents ?? 0) > 0,
      monthly_savings_cents: form.insuranceSavings?.monthlySavingsCents ?? 0,
    });
  }

  // Wave 38: flip the whole picker between term and monthly. On flip we
  // re-select the same tier (or Best fallback) from the new side so the
  // details card + Continue stay populated, and clear any stale payment
  // controls that don't apply to the new billing model.
  function switchBillingMode(nextMode) {
    if (nextMode === billingMode) return;
    setBillingMode(nextMode);
    const nextSet = nextMode === 'monthly' && hasMonthly ? (monthly || {}) : plans;
    const curTier = form.selectedPlan?.tier ?? null;
    const tier = nextSet[curTier] ? curTier
      : nextSet.best ? 'best'
      : nextSet.better ? 'better'
      : nextSet.good ? 'good'
      : null;
    if (tier) {
      // Reset the payment slice so Confirm re-seeds correctly for the new
      // billing model (term seeds down_payment/months_to_pay; monthly skips them).
      update({ selectedPlan: buildSelectedPlan(tier, nextSet[tier]), payment: null });
    }
    track('protection.customer.recommended_coverage.billing_mode_switched', {
      to_mode: nextMode,
      tier,
    });
  }

  function handleNext() {
    track('protection.customer.recommended_coverage.continued', {
      tier: form.selectedPlan?.tier,
      plan_code: form.selectedPlan?.plan_code,
    });
    update({ customizeRequested: false });
    onNext();
  }

  function handleCustomize() {
    track('protection.customer.recommended_coverage.customize_requested', {
      tier: form.selectedPlan?.tier,
      plan_code: form.selectedPlan?.plan_code,
    });
    update({ customizeRequested: true });
    onNext();
  }

  function openInsuranceCrossSell() {
    if (!crossSell.insurance_enabled) return;
    track('protection.cross_sell.insurance_clicked', {
      persona,
      org_id: form.org_id,
      surface: persona === 'agent' ? 'side_pane' : 'sub_flow',
    });
    onOpenCrossSell?.('insurance');
  }

  function openRefiCrossSell() {
    if (!crossSell.refi_enabled) return;
    track('protection.cross_sell.refi_clicked', {
      persona,
      org_id: form.org_id,
      surface: persona === 'agent' ? 'side_pane' : 'sub_flow',
    });
    onOpenCrossSell?.('refi');
  }

  function clearInsuranceSavings() {
    update({ insuranceSavings: null });
    track('protection.cross_sell.insurance_cleared', { persona });
  }

  function clearRefiOffer() {
    update({ refiOffer: null });
    track('protection.cross_sell.refi_cleared', { persona });
  }

  const noPlans = !activePlans.best && !activePlans.better && !activePlans.good;
  const selectedTier = form.selectedPlan?.tier;
  const isMonthlyMode = billingMode === 'monthly' && hasMonthly;

  // Wave 23 Task 7: SE error classification.
  const seError = form.rates?._error_classified ?? null;
  const showFixtureFallback =
    seError?.kind === 'empty' &&
    orgRegistry.orgs.find((o) => o.id === form.org_id)?.se_getrates?.error_handling?.default_strategy === 'fallback_fixture';

  // Insurance savings — monthlySavingsCents > 0 drives strikethrough + info box.
  // status === 'no_savings' or null → monthlySavingsCents is 0 or absent → no display.
  const monthlySavingsCents = form.insuranceSavings?.monthlySavingsCents ?? 0;
  const monthlySavingsDollars = monthlySavingsCents > 0 ? Math.round(monthlySavingsCents / 100) : 0;
  const hasSavings = monthlySavingsDollars > 0;
  const captureCarrier = form.insuranceSavings?.captureCarrier ?? null;

  const ctaBlock = (
    <CrossSellCtas
      crossSell={crossSell}
      onInsurance={openInsuranceCrossSell}
      onRefi={openRefiCrossSell}
      hasInsuranceResult={!!form.insuranceSavings}
      hasRefiResult={!!form.refiOffer}
      onClearInsurance={clearInsuranceSavings}
      onClearRefi={clearRefiOffer}
      insuranceSavings={form.insuranceSavings}
      refiOffer={form.refiOffer}
    />
  );

  // Tier order for picker — Best first (upsell emphasis per ADR 22 D1)
  const PICKER_ORDER = ['best', 'better', 'good'];

  // Build the selected plan's details for the details card
  const selectedPlan = selectedTier ? activePlans[selectedTier] : null;
  const selectedProduct = selectedPlan
    ? (form.rates?.products || []).find((p) => p.id === selectedPlan.id) || selectedPlan.raw || null
    : null;
  const selectedPassthrough = selectedPlan
    ? buildPassthroughForPlan({ form, rates: form.rates, product: selectedProduct })
    : { totalDelta: 0, badges: [] };
  const selectedPresentation = selectedPlan
    ? resolvePlanPresentation({
        orgId: form.org_id,
        tpaCode: selectedPlan.raw?.tpa_code ?? null,
        productTypeCode: selectedPlan.raw?.product_type_code ?? null,
        planCode: selectedPlan.raw?.plan_code ?? null,
        planName: selectedPlan.name,
      })
    : null;

  const [coverageModalOpen, setCoverageModalOpen] = useState(false);

  return (
    <>
      <ScreenHeader
        icon={Sparkles}
        eyebrow="Coverage · Recommendation"
        title="Pick the coverage that fits"
        subtitle={null}
      />

      <div className="px-6 space-y-3">
        {/* Subtitle — per ADR 22 D1 + refi reference */}
        <p className="text-sm text-slate-500 text-center italic">
          Here is your personal quote based on your vehicle and info you provided
        </p>

        {/* Wave 23 Task 7: SE error callout */}
        {seError && (
          <div className={
            'text-sm flex items-start gap-2 border rounded-md p-3 ' +
            (showFixtureFallback
              ? 'text-amber-800 border-amber-200 bg-amber-50'
              : 'text-rose-700 border-rose-200 bg-rose-50')
          }>
            {showFixtureFallback
              ? <Info className="w-4 h-4 mt-0.5 shrink-0" />
              : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
            <div className="min-w-0 flex-1">
              <div className="font-semibold mb-0.5">
                {showFixtureFallback ? 'Showing example pricing' : 'Coverage rates unavailable'}
              </div>
              <div>{seError.displayMessage}</div>
              {persona === 'super_admin' && (
                <div className="border-t border-current/20 pt-2 mt-2 space-y-1">
                  <div className="text-xs font-semibold opacity-70 uppercase tracking-wide">Details</div>
                  <div className="text-xs space-y-0.5">
                    <div><span className="opacity-60">kind</span>{' '}<span className="font-mono">{seError.kind ?? '—'}</span></div>
                    <div><span className="opacity-60">code</span>{' '}<span className="font-mono">{seError.code ?? '—'}</span></div>
                    <div><span className="opacity-60">action</span>{' '}{seError.internalAction ?? '—'}</div>
                  </div>
                  {seError.raw != null && (
                    <pre className="font-mono text-xs mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-all opacity-80">
                      {String(seError.raw).length > 2000
                        ? String(seError.raw).slice(0, 2000) + '…[truncated]'
                        : String(seError.raw)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {!seError && noPlans && isFetching && (() => {
          if (!loadingShownRef.current) {
            loadingShownRef.current = true;
            track('protection.customer.recommended_coverage.fetch_loading_shown', { trigger: 'fallback_dispatch' });
          }
          return (
            <div className="text-sm text-blue-800 flex items-start gap-2 border border-blue-200 bg-blue-50 rounded-md p-3">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                We are finding the coverage options, thanks for hanging tight as we discover the best options available
              </div>
            </div>
          );
        })()}

        {!seError && noPlans && !isFetching && (
          <div className="text-sm text-amber-700 flex items-start gap-2 border border-amber-200 bg-amber-50 rounded-md p-3">
            <AlertCircle className="w-4 h-4 mt-0.5" />
            <div>
              No coverage options came back for this vehicle. Go back and confirm your VIN, year, make, and mileage,
              or call us to walk through it together.
            </div>
          </div>
        )}

        {/* Agent persona: cross-sell CTAs above tier picker */}
        {persona === 'agent' && ctaBlock}

        {/* ── Insurance buying-power info box (ADR 22 D5) ────────────────── */}
        {hasSavings && (
          <div className="p-3 bg-gradient-to-r from-orange-50 to-blue-50 border border-orange-200 rounded-lg flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4 text-orange-600" />
            </div>
            <div className="flex-1">
              <div className="text-xs font-semibold text-orange-800">Insurance savings = buying power</div>
              <div className="text-xs text-slate-600">
                {captureCarrier
                  ? <>The <span className="font-semibold text-orange-700">${monthlySavingsDollars}/mo</span> in insurance savings when compared to {captureCarrier}, which can help offset the cost of a protection plan.</>
                  : <>The <span className="font-semibold text-orange-700">${monthlySavingsDollars}/mo</span> in insurance savings can help offset the cost of a protection plan.</>
                }
              </div>
            </div>
          </div>
        )}

        {/* ── Wave 38: global term↔monthly switch — only when monthly plans exist ── */}
        {hasMonthly && (!seError || showFixtureFallback) && (
          <div className="flex flex-col items-center gap-1">
            <div className="inline-flex rounded-md border border-blue-200 overflow-hidden bg-white">
              <button
                type="button"
                onClick={() => switchBillingMode('term')}
                className={
                  'px-4 py-1.5 text-xs font-semibold transition ' +
                  (!isMonthlyMode
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-blue-700 hover:bg-blue-50')
                }
              >
                Pay per term
              </button>
              <button
                type="button"
                onClick={() => switchBillingMode('monthly')}
                className={
                  'px-4 py-1.5 text-xs font-semibold border-l border-blue-200 transition ' +
                  (isMonthlyMode
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-blue-700 hover:bg-blue-50')
                }
              >
                Monthly membership
              </button>
            </div>
            <p className="text-[11px] text-slate-500 text-center italic">
              {isMonthlyMode
                ? 'Pay a flat monthly charge — cancel anytime, unlimited miles.'
                : 'One coverage term, financed or paid up front.'}
            </p>
          </div>
        )}

        {/* ── Tier picker (3-up segmented) — Best / Better / Good ────────── */}
        {(!seError || showFixtureFallback) && (
          <div className="grid grid-cols-3 gap-2">
            {PICKER_ORDER.map((tier) => {
              const plan = activePlans[tier];
              if (!plan) return null;
              const isSelected = selectedTier === tier;
              const baseMonthly = isMonthlyMode
                ? (plan.monthly_charge != null ? Math.round(plan.monthly_charge) : 0)
                : (plan.monthly_cost ? Math.round(plan.monthly_cost) : 0);
              const adjustedMonthly = hasSavings ? Math.max(0, baseMonthly - monthlySavingsDollars) : null;
              return (
                <TierPickerButton
                  key={tier}
                  tier={tier}
                  isSelected={isSelected}
                  baseMonthly={baseMonthly}
                  adjustedMonthly={adjustedMonthly}
                  hasSavings={hasSavings}
                  isMonthlyMode={isMonthlyMode}
                  onClick={() => pick(tier)}
                />
              );
            })}
          </div>
        )}

        {/* Adjustment footnote — only when savings exist */}
        {hasSavings && (!seError || showFixtureFallback) && (
          <p className="text-xs text-slate-500 text-center italic">
            *Adjusted by ${monthlySavingsDollars} per month in Auto Insurance Savings
          </p>
        )}

        {/* ── Selected plan details card ──────────────────────────────────── */}
        {(!seError || showFixtureFallback) && selectedPlan && selectedPresentation && (
          <SelectedPlanDetails
            tier={selectedTier}
            plan={selectedPlan}
            presentation={selectedPresentation}
            passthrough={selectedPassthrough}
            isMonthlyMode={isMonthlyMode}
            onOpenCoverage={() => {
              setCoverageModalOpen(true);
              track('protection.customer.plan_card.coverage_modal_opened', {
                tier: selectedTier,
                plan_code: selectedPlan.raw?.plan_code,
                source: selectedPresentation.source.coverage,
              });
            }}
          />
        )}

        {/* Consumer persona: cross-sell CTAs below tier picker */}
        {persona === 'consumer' && ctaBlock}

        {form.requiresBusinessUse && (
          <div className="text-xs text-slate-500 border-t border-slate-100 pt-3">
            <span className="font-semibold text-slate-700">Note:</span> your selected use (rideshare or commercial)
            requires the Business Use add-on, which we&apos;ll attach automatically before checkout.
          </div>
        )}

        {form.flagAgentReview && (
          <div className="text-xs text-slate-500">
            <span className="font-semibold text-slate-700">Heads up:</span> the modifications you flagged will be
            reviewed by an agent before final coverage activates.
          </div>
        )}
      </div>

      {/* Coverage modal — rendered outside card's overflow-hidden ancestor */}
      {selectedPlan && selectedPresentation && (
        <PlanCoverageModal
          open={coverageModalOpen}
          onClose={() => setCoverageModalOpen(false)}
          title={selectedPresentation.planTitle}
          coverageHtml={selectedPresentation.coverageHtml}
          sampleAgreementUrl={selectedPresentation.sampleAgreementUrl}
          tpaCode={selectedPlan.raw?.tpa_code ?? null}
          planCode={selectedPlan.raw?.plan_code ?? null}
          planDescription={selectedPlan.raw?.plan_description ?? selectedPlan.name ?? null}
        />
      )}

      <WizardFooter
        onNext={handleNext}
        disabled={!form.selectedPlan?.tier}
        nextLabel="Continue with this plan"
        secondary={
          <button
            type="button"
            onClick={handleCustomize}
            disabled={!form.selectedPlan?.tier}
            className={
              'px-3 py-1.5 rounded-md text-xs font-medium border flex items-center gap-1.5 transition ' +
              (!form.selectedPlan?.tier
                ? 'border-slate-200 text-slate-400 cursor-not-allowed'
                : 'border-slate-300 text-slate-600 hover:border-slate-500 hover:text-slate-800 bg-white')
            }
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Customize coverage
          </button>
        }
      />
    </>
  );
}

// ── TierPickerButton ──────────────────────────────────────────────────────────
//
// Single button in the 3-up segmented tier picker.
// When savings exist: shows adjusted (emerald) + original (strikethrough).
// When no savings:    shows original monthly only.
function TierPickerButton({ tier, isSelected, baseMonthly, adjustedMonthly, hasSavings, isMonthlyMode, onClick }) {
  const tierLabel = tier.toUpperCase();
  const perLabel = isMonthlyMode ? 'per month · membership' : 'per month';
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'relative rounded-lg border-2 p-3 text-center transition-all ' +
        (isSelected
          ? 'border-blue-600 bg-blue-600 text-white shadow-md'
          : 'border-blue-200 bg-white text-blue-700 hover:border-blue-400')
      }
    >
      <div className={
        'text-xs font-bold uppercase tracking-wide mb-1 ' +
        (isSelected ? 'text-blue-100' : 'text-blue-500')
      }>
        {tierLabel}
      </div>

      {hasSavings && adjustedMonthly !== null ? (
        <>
          <div className="leading-tight">
            <span className={
              'text-lg font-bold ' +
              (isSelected ? 'text-emerald-200' : 'text-emerald-600')
            }>
              ${adjustedMonthly}
            </span>
            <span className={
              'text-sm mx-0.5 ' +
              (isSelected ? 'text-blue-200' : 'text-slate-400')
            }>/</span>
            <span className={
              'text-sm line-through ' +
              (isSelected ? 'text-blue-200' : 'text-slate-400')
            }>
              ${baseMonthly}
            </span>
          </div>
          <div className={
            'text-xs ' +
            (isSelected ? 'text-blue-100' : 'text-slate-500')
          }>
            {perLabel}
          </div>
        </>
      ) : (
        <>
          <div className={
            'text-lg font-bold ' +
            (isSelected ? 'text-white' : 'text-slate-900')
          }>
            ${baseMonthly}
          </div>
          <div className={
            'text-xs ' +
            (isSelected ? 'text-blue-100' : 'text-slate-500')
          }>
            {perLabel}
          </div>
        </>
      )}
    </button>
  );
}

// ── SelectedPlanDetails ───────────────────────────────────────────────────────
//
// Single card below the tier picker showing the currently selected tier's data.
// Contains (in order per ADR 22 D1 + D3):
//   1. Header band — planTitle + New rate pill + term/miles subtitle
//   2. Features + add-ons badges row (ABOVE coverage components per D3)
//   3. Coverage heading (hardcoded tier string — see file header comment)
//   4. Covered components grid (2-col, from resolvePlanPresentation().coveredComponents)
//   5. "See what's covered" modal trigger
//
// Total price / add-ons breakdown is NOT rendered here per ADR 22 D2.
function SelectedPlanDetails({ tier, plan, presentation, passthrough, isMonthlyMode, onOpenCoverage }) {
  const badges = passthrough?.badges || [];
  const coverageHeading = TIER_COVERAGE_HEADING[tier] ?? '';

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      {/* Header band */}
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-900">{presentation.planTitle}</span>
          {plan.rate_class === 'new' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-violet-200 text-violet-700 bg-violet-50 text-[10px] font-semibold shrink-0">
              <Zap className="w-3 h-3" />
              New rate
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500 mt-0.5">
          {isMonthlyMode
            ? `$${plan.monthly_charge != null ? Math.round(plan.monthly_charge) : 0}/mo · unlimited miles · cancel anytime`
            : `${plan.coverage_months} months or ${Number(plan.coverage_miles).toLocaleString()} miles`}
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-3">
        {/* Features + add-ons pills — above coverage per D3 */}
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {badges.map((b) => {
              const isInformational = b.deltaCost === null;
              const isPriced = (b.deltaCost ?? 0) > 0;
              const TagIcon = isPriced ? Sparkles : Check;
              const cls = isInformational
                ? 'border-slate-200 text-slate-600 bg-slate-50'
                : isPriced
                  ? 'border-amber-200 text-amber-700 bg-amber-50'
                  : 'border-emerald-200 text-emerald-700 bg-emerald-50';
              return (
                <span
                  key={b.key}
                  className={'inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium ' + cls}
                >
                  <TagIcon className="w-3 h-3" />
                  {b.label}{isPriced ? ` +$${b.deltaCost}` : ''}
                </span>
              );
            })}
          </div>
        )}

        {/* Coverage heading */}
        {coverageHeading && (
          <div className="text-xs font-medium text-slate-700">{coverageHeading}</div>
        )}

        {/* Covered components grid */}
        {presentation.coveredComponents.length > 0 && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {presentation.coveredComponents.map((component) => (
              <div key={component} className="text-xs text-slate-600 flex items-center gap-1.5">
                <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                {component}
              </div>
            ))}
          </div>
        )}

        {/* "See what's covered" modal trigger */}
        <button
          type="button"
          onClick={onOpenCoverage}
          className="text-[11px] text-slate-600 underline underline-offset-2 decoration-slate-400 hover:text-slate-800 hover:decoration-slate-600 transition-colors"
        >
          See what&apos;s covered
        </button>
      </div>
    </div>
  );
}

// ── CrossSellCtas ─────────────────────────────────────────────────────────────
// Unchanged from Wave 31b. The boost-slot Result Chip + Find-insurance-savings
// CTA + no_savings handling are preserved exactly.
function CrossSellCtas({
  crossSell,
  onInsurance,
  onRefi,
  hasInsuranceResult,
  hasRefiResult,
  onClearInsurance,
  onClearRefi,
  insuranceSavings,
  refiOffer,
}) {
  const showAny = crossSell.insurance_enabled || crossSell.refi_enabled || hasInsuranceResult || hasRefiResult;
  if (!showAny) return null;

  return (
    <div className="border border-slate-200 rounded-md bg-slate-50 px-4 py-3 space-y-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
        Boost your buying power
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <CtaButton
          icon={TrendingDown}
          label="Find insurance savings"
          subtitle="Quote a new policy and apply the savings"
          enabled={crossSell.insurance_enabled}
          onClick={onInsurance}
          tone="emerald"
          completed={hasInsuranceResult}
        />
        <CtaButton
          icon={Calculator}
          label="Lower your monthly with refinance"
          subtitle="Pre-qualify for a refi and finance the plan"
          enabled={crossSell.refi_enabled}
          onClick={onRefi}
          tone="blue"
          completed={hasRefiResult}
        />
      </div>
      {hasInsuranceResult && insuranceSavings && (
        insuranceSavings.status === 'no_savings' ? (
          // Wave 31 v3.0.11 D6 — no-savings branch. Result still counts
          // as "ran" (CTA stays marked done above) but the savings copy
          // is replaced with a muted "we will continue to monitor"
          // message. Reached from BOTH cross-sell launchers:
          //   - protection-portal's own CrossSellSubFlow completes with
          //     a zero-savings quote → onComplete writes
          //     { monthlySavingsCents: 0, status: 'no_savings', ... }
          //     onto form.insuranceSavings.
          //   - mission-control's insurance CoPilot reads its workflow
          //     state via mapInsuranceWorkflowToSavings() and passes the
          //     same shape into RecommendedCoverage when cross-shown.
          // TierPickerButton's -$/mo display is suppressed automatically
          // because monthlySavingsCents === 0 → hasSavings === false.
          <ResultChip
            tone="emerald"
            label="We will continue to monitor savings"
            detail={
              insuranceSavings.captureCarrier
                ? `Current carrier: ${insuranceSavings.captureCarrier}`
                : null
            }
            onClear={onClearInsurance}
          />
        ) : (
          <ResultChip
            tone="emerald"
            label={`Insurance savings: -${formatCents(insuranceSavings.monthlySavingsCents, { whole: true })}/mo`}
            detail={
              insuranceSavings.captureCarrier && insuranceSavings.newCarrier
                ? `${insuranceSavings.captureCarrier} → ${insuranceSavings.newCarrier}`
                : null
            }
            onClear={onClearInsurance}
          />
        )
      )}
      {hasRefiResult && refiOffer && (
        <ResultChip
          tone="blue"
          label={`Refi prequal: ${(refiOffer.apr * 100).toFixed(2)}% APR · ${refiOffer.termMonths}mo`}
          detail={
            refiOffer.protectionPlanPortionCents != null
              ? `Plan financed: +$${(refiOffer.protectionPlanPortionCents / 100).toFixed(2)}/mo`
              : null
          }
          onClear={onClearRefi}
        />
      )}
    </div>
  );
}

function CtaButton({ icon: Icon, label, subtitle, enabled, onClick, tone, completed }) {
  const toneClass =
    tone === 'emerald'
      ? 'border-emerald-200 hover:border-emerald-500 hover:bg-emerald-50'
      : 'border-blue-200 hover:border-blue-500 hover:bg-blue-50';
  const iconColor =
    tone === 'emerald' ? 'text-emerald-600' : 'text-blue-600';

  if (!enabled) {
    return (
      <button
        disabled
        title="Not enabled for this org"
        className="text-left px-3 py-2 rounded-md border border-slate-200 bg-white opacity-50 cursor-not-allowed"
      >
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-semibold text-slate-500">{label}</span>
        </div>
        <div className="text-[11px] text-slate-400 mt-0.5">Not enabled for this org</div>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={'text-left px-3 py-2 rounded-md border bg-white transition ' + toneClass}
    >
      <div className="flex items-center gap-2">
        <Icon className={'w-4 h-4 ' + iconColor} />
        <span className="text-xs font-semibold text-slate-700">{label}</span>
        {completed && (
          <span className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold ml-auto">
            ✓ done
          </span>
        )}
      </div>
      <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>
    </button>
  );
}

function ResultChip({ tone, label, detail, onClear }) {
  const toneClass =
    tone === 'emerald'
      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
      : 'bg-blue-50 border-blue-200 text-blue-800';
  return (
    <div className={'flex items-center gap-2 px-3 py-2 rounded-md border ' + toneClass}>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold truncate">{label}</div>
        {detail && <div className="text-[11px] opacity-80 truncate">{detail}</div>}
      </div>
      <button
        onClick={onClear}
        className="p-1 rounded hover:bg-white/60"
        title="Clear"
        aria-label="Clear cross-sell result"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
