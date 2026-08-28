// Customer view · Step 3b — Customize coverage (conditional, opt-in).
//
// The auto Customize screen is a filtered browser over hundreds of
// (plan × term × mileage × deductible) permutations, backed by range sliders
// and a rate-class chip row. A home quote has exactly THIRTEEN rows: three
// fixed-term plans across up to four terms, plus three month-to-month plans.
// Every one carries the same $75 deductible and no mileage axis at all.
//
// So this screen shows all of them, grouped by tier, and lets the consumer
// pick any row directly. No sliders, no chips — filters over a list this
// small would be furniture, not function.
//
// Choosing a row here changes the plan AND possibly the term, which is
// precisely the flip that invalidates optional-coverage selections (ADR 30
// D7). syncAddOns runs in the same update as the selection, so no render can
// observe a plan from one scope and an add-on price from another. That is
// also why customize is spliced BEFORE optional_coverages rather than after.
import { useMemo, useRef, useEffect } from 'react';
import { SlidersHorizontal, Check, Info } from 'lucide-react';
import { ScreenHeader, WizardFooter } from 'blinker-platform/components';
import { resolveHomePlanPrice } from 'blinker-platform/utils';
import { track } from 'blinker-platform/telemetry';
import { HOME_TIER_COPY, PICKER_ORDER } from '../../components/homePlanCopy.js';
import { selectHomePlans, buildSelectedPlan, tierOf, billingModel } from '../../lib/home-plan-selector.js';
import { syncAddOns } from '../../lib/addon-sync.js';
import { pricingState } from '../../lib/home-money.js';

function fmtDollars(v) {
  return `$${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function Customize({ form, update, onNext, persona = 'consumer' }) {
  const viewedRef = useRef(false);
  const orgId = form.org_id;
  const state = pricingState(form);

  // Every product the rater returned, normalized through the same selector
  // helpers the recommendation screen uses so tier resolution can't diverge
  // between the two views of the same data.
  const rows = useMemo(() => {
    const products = form.rates?.products || [];
    const built = products.map((p) => {
      const tier = tierOf(p, orgId);
      const isMonthly = billingModel(p) === 'monthly_subscription';
      // Retail, never the Omega remit — the browser has to agree with the
      // recommendation cards, and both are what the consumer will be charged.
      const priced = resolveHomePlanPrice({
        orgId,
        basePrice: isMonthly
          ? (p.monthly_charge ?? p.monthly_price ?? p.base_price ?? 0)
          : (p.base_price ?? 0),
        state,
        billingModel: isMonthly ? 'monthly' : 'term',
      });
      return {
        tier,
        isMonthly,
        id: p.id,
        plan_code: p.plan_code,
        term: p.coverage_period_months != null ? Number(p.coverage_period_months) : null,
        price: priced.price,
        product: p,
      };
    });
    built.sort((a, b) => {
      if (a.isMonthly !== b.isMonthly) return a.isMonthly ? 1 : -1;
      const ai = PICKER_ORDER.indexOf(a.tier);
      const bi = PICKER_ORDER.indexOf(b.tier);
      if (ai !== bi) return ai - bi;
      return (a.term ?? 0) - (b.term ?? 0);
    });
    return built;
  }, [form.rates, orgId, state]);

  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    track('home_protection.customer.customize.viewed', { row_count: rows.length, persona });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedId = form.selectedPlan?.id ?? null;

  function pickRow(row) {
    // Rebuild the candidate through the selector so the committed plan has
    // exactly the shape RecommendedCoverage would have produced.
    const mode = row.isMonthly ? 'monthly' : 'term';
    const res = selectHomePlans({
      rates: form.rates,
      orgId,
      mode,
      termMonths: row.isMonthly ? null : row.term,
      state,
    });
    const set = row.isMonthly ? (res.monthly || {}) : res.plans;
    const candidate = set[row.tier];
    if (!candidate) return;

    const selectedPlan = buildSelectedPlan(row.tier, candidate);
    const sync = syncAddOns({
      selected: form.selectedAddOns,
      plan: selectedPlan,
      termMonths: row.isMonthly ? null : row.term,
      orgId,
    });

    update({
      selectedPlan,
      coverageTerm: row.isMonthly ? null : row.term,
      billingMode: mode,
      selectedAddOns: sync.selectedAddOns,
      addOnsRevalidatedFor: sync.scopeKey,
      payment: null,
      paymentSchedule: null,
    });

    track('home_protection.customer.customize.plan_selected', {
      tier: row.tier,
      plan_code: row.plan_code,
      term_months: row.term,
      billing_model: selectedPlan.billing_model,
      add_ons_kept: sync.selectedAddOns.length,
      add_ons_dropped: sync.dropped.length,
      persona,
    });
  }

  function handleNext() {
    track('home_protection.customer.customize.continued', {
      plan_code: form.selectedPlan?.plan_code,
      term_months: form.selectedPlan?.coverage_period_months,
      persona,
    });
    update({ status: 'Selected' });
    onNext();
  }

  const termRows = rows.filter((r) => !r.isMonthly);
  const monthlyRows = rows.filter((r) => r.isMonthly);

  return (
    <>
      <ScreenHeader
        icon={SlidersHorizontal}
        eyebrow="Coverage · Customize"
        title="Browse every plan"
        subtitle="All coverage Omega offers for this property. Every plan carries a $75 deductible and a $75 service call fee."
      />

      <div className="px-6 space-y-4">
        {rows.length === 0 && (
          <div className="text-sm text-slate-600 border border-dashed border-slate-300 rounded-md px-4 py-8 text-center">
            No coverage came back for this property.
          </div>
        )}

        {termRows.length > 0 && (
          <PlanTable
            label="Fixed term"
            rows={termRows}
            selectedId={selectedId}
            onPick={pickRow}
          />
        )}

        {monthlyRows.length > 0 && (
          <>
            <PlanTable
              label="Month to month"
              rows={monthlyRows}
              selectedId={selectedId}
              onPick={pickRow}
            />
            <div className="text-[11px] text-slate-500 flex items-start gap-1.5">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              Month-to-month plans carry no optional coverages — picking one skips
              that step.
            </div>
          </>
        )}
      </div>

      <WizardFooter
        onNext={handleNext}
        disabled={!form.selectedPlan}
        nextLabel="Continue with this plan"
      />
    </>
  );
}

function PlanTable({ label, rows, selectedId, onPick }) {
  return (
    <div className="border border-slate-200 rounded-md overflow-hidden">
      <div className="px-4 py-2 bg-slate-50 border-b border-slate-100">
        <span className="text-xs uppercase tracking-wide font-semibold text-slate-600">{label}</span>
      </div>
      <div className="divide-y divide-slate-100">
        {rows.map((row) => {
          const copy = HOME_TIER_COPY[row.tier] || HOME_TIER_COPY.good;
          const Icon = copy.icon;
          const active = row.id === selectedId;
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => onPick(row)}
              className={
                'w-full px-4 py-3 flex items-center gap-3 text-left ' +
                (active ? 'bg-blue-50' : 'bg-white hover:bg-slate-50')
              }
            >
              <Icon className={'w-4 h-4 shrink-0 ' + (active ? 'text-blue-600' : 'text-slate-400')} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-900 truncate">
                  {copy.planLabel}
                  <span className="ml-2 text-[10px] uppercase tracking-wide font-semibold text-slate-400">
                    {copy.label}
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  {row.isMonthly ? 'Month to month · unlimited' : `${row.term} months`} · plan {row.plan_code}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-bold text-slate-900">
                  {row.isMonthly ? `${fmtDollars(row.price)}/mo` : fmtDollars(row.price)}
                </div>
                {active && (
                  <div className="text-[10px] uppercase tracking-wide font-semibold text-blue-700 flex items-center gap-1 justify-end">
                    <Check className="w-3 h-3" /> Selected
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
