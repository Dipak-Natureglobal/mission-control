// Shared plan card. Lifted from RecommendedCoverage.jsx so Customize
// (Step 6) can reuse the same rich card. Visual + behavioral parity
// with the original is the contract — when you change anything here,
// both screens see it.
//
// Props:
//   tier — 'good' | 'better' | 'best'
//   plan — a candidate plan from selectPlans / listMatchingPlans
//   active — true → blue ring + "Selected" pill in header
//   onClick — fired on card click (Customize passes a no-op since
//     selection there is committed via Continue, not card click)
//   insuranceMonthlyDollars — when > 0, shows the strike-through line
//   refiAdditionDollars — when > 0, shows the refi addition line
//   insuranceCarrier — used in the "vs {carrier}" copy on the savings line
//
//   Wave 22 additions:
//   passthrough — { totalDelta, badges } from packages/utils/protection-addons
//                 buildPassthroughForPlan({ form, rates, product }). Drives:
//                   • a chip row of badges between plan name and stat grid
//                   • a "+ $XX add-ons" line below the total
//   orgId — used to resolve the per-org payment-plan provider config that
//           fills the $X/mo tooltip (Task 6).
//
// PUBLIC_TIER_COPY and TIER_ORDER live in ./planCardCopy.js so Vite
// Fast Refresh stays happy (this file exports only components).

import { useRef, useState } from 'react';
import { Sparkles, Check, Zap } from 'lucide-react';
import { effectiveMonthly } from '../lib/protection-pricing.js';
import { PUBLIC_TIER_COPY } from './planCardCopy.js';
import { PlanCoverageModal } from './PlanCoverageModal.jsx';
import orgRegistry from '../constants/canon/org-registry.json';
import { track } from 'blinker-platform/telemetry';
import { resolvePlanPresentation } from 'blinker-platform/utils';

// Wave 22 Task 6 — resolve the per-org payment-plan provider defaults.
// Phase 1 hardcodes the lookup priority: prefer Ensurety, fall back to
// FloPay, then org-level protection_billing defaults. Phase 2 will be
// smarter (org-selected primary provider).
function resolveBillingDefaults(org) {
  const env = org?.test_mode ? 'test' : 'live';
  const ens = org?.integrations?.ensurety?.credentials?.[env];
  const flo = org?.integrations?.flopay?.credentials?.[env];
  const provider = ens || flo || null;
  const term =
    provider?.default_term_months ??
    org?.protection_billing?.payment_term?.default_months ??
    12;
  const mode = provider?.down_payment_mode ?? 'percent_of_price';
  const value =
    provider?.down_payment_value ??
    org?.protection_billing?.down_payment?.default_percent ??
    10;
  return { term, mode, value };
}

function computeDownPayment({ mode, value, monthly, totalCost }) {
  if (mode === 'same_as_monthly') return Math.round(monthly || 0);
  if (mode === 'percent_of_price') return Math.round((Number(totalCost) || 0) * (Number(value) || 0) / 100);
  if (mode === 'fixed_dollars') return Math.round(Number(value) || 0);
  return 0;
}

// Wave 38: `isMonthly` flips the trigger + tooltip copy for monthly-membership
// plans. Monthly plans have no amortization (no "~"), no fixed N months, and no
// down payment — they're a flat recurring charge, unlimited miles, cancellable.
function MonthlyTooltip({ monthly, term, downPayment, downMode, tier, isMonthly = false }) {
  const trackedRef = useRef(false);
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  function show() {
    if (open) return;
    // Compute fixed coords from trigger's viewport position BEFORE opening.
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setCoords({ top: r.bottom + 4, left: r.right });
    setOpen(true);
    if (!trackedRef.current) {
      trackedRef.current = true;
      track('protection.customer.recommended_coverage.monthly_tooltip_shown', {
        tier,
        term,
        down_mode: downMode,
        billing_model: isMonthly ? 'monthly_subscription' : 'term_total',
      });
    }
  }
  function hide() { setOpen(false); }
  function toggle(e) {
    // Stop propagation so we don't fire the parent card's onClick.
    e.stopPropagation();
    e.preventDefault();
    if (open) hide();
    else show();
  }

  return (
    <span className="inline-block">
      <span
        ref={triggerRef}
        tabIndex={0}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={toggle}
        className="cursor-help underline decoration-dotted decoration-slate-300 underline-offset-2"
      >
        {isMonthly ? `$${monthly}/mo` : `~$${monthly}/mo`}
      </span>
      <span
        role="tooltip"
        style={{ position: 'fixed', top: coords.top, left: coords.left, transform: 'translateX(-100%)' }}
        className={
          'z-[60] w-max max-w-[220px] px-2.5 py-1.5 rounded-md border border-slate-300 bg-white shadow-md text-[11px] text-slate-900 leading-snug transition-opacity ' +
          (open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none')
        }
      >
        {isMonthly
          ? `$${monthly}/mo · cancel anytime · unlimited miles`
          : `$${monthly}/mo for ${term} months with $${downPayment} down`}
      </span>
    </span>
  );
}

// Wave 23 Task 6a: term_basis-aware display formatters.
function formatTermDisplay(months, termBasis) {
  if (termBasis === 'additive') return `+${months} mo`;
  if (termBasis === 'absolute') return `Up to ${months} mo`;
  return `${months} mo`;
}
function formatMilesDisplay(miles, termBasis) {
  const formatted = Number(miles).toLocaleString();
  if (termBasis === 'additive') return `+${formatted} mi`;
  if (termBasis === 'absolute') return `Up to ${formatted} mi`;
  return formatted;
}

export function PlanCard({
  tier, plan, active, onClick,
  insuranceMonthlyDollars = 0,
  refiAdditionDollars = 0,
  insuranceCarrier,
  // Wave 22 — passthrough block from buildPassthroughForPlan + orgId for
  // per-org payment-plan provider defaults. Both have safe fallbacks so
  // call sites that haven't been wired yet still render correctly.
  passthrough = { totalDelta: 0, badges: [] },
  orgId = null,
}) {
  const copy = PUBLIC_TIER_COPY[tier];
  const Icon = copy.icon;

  // Wave 27 v3.0.8 Task 1 — resolve org-overridable plan title, tagline,
  // and coverage HTML. Per-product `tpa_code` (tagged by the SE normalizer)
  // wins; resolver falls back to deriving TpaCode from org's StoneEagle
  // credentials when the rater didn't surface one.
  const presentation = resolvePlanPresentation({
    orgId,
    tpaCode: plan.raw?.tpa_code ?? null,
    productTypeCode: plan.raw?.product_type_code ?? null,
    planCode: plan.raw?.plan_code ?? null,
    planName: plan.name,
  });

  // Coverage modal state.
  const [coverageModalOpen, setCoverageModalOpen] = useState(false);

  // Wave 38: monthly-membership gate. STRICTLY billing_model ===
  // 'monthly_subscription'; missing / 'term_total' renders byte-for-byte as
  // before. Monthly plans surface a flat recurring charge from `monthly_charge`
  // (fallbacks `monthly_cost`/`monthly`) — NOT a term/12 amortization.
  const isMonthly = plan.billing_model === 'monthly_subscription';
  const monthlyMembershipCharge = Math.round(
    Number(plan.monthly_charge ?? plan.monthly_cost ?? plan.monthly ?? 0),
  );
  const baseMonthly = isMonthly
    ? monthlyMembershipCharge
    : (plan.monthly_cost ? Math.round(plan.monthly_cost) : 0);
  const hasCrossSellAdjustment = insuranceMonthlyDollars > 0 || refiAdditionDollars > 0;
  const effective = effectiveMonthly({
    baseProtectionMonthly: baseMonthly,
    insuranceSavings: insuranceMonthlyDollars,
    refiAddition: refiAdditionDollars,
  });

  // Resolve org for tooltip math. orgId may be null in test renders or
  // if a parent forgot to wire — fall back to safe defaults.
  const org = orgId != null ? orgRegistry.orgs.find((o) => o.id === orgId) : null;
  const billing = resolveBillingDefaults(org || {});
  const downPayment = computeDownPayment({
    mode: billing.mode,
    value: billing.value,
    monthly: baseMonthly,
    totalCost: plan.total_cost,
  });

  const badges = passthrough?.badges || [];
  const totalDelta = passthrough?.totalDelta || 0;

  return (
    <>
    {/* Wave 27: Fragment needed so PlanCoverageModal can be a sibling to the
        card div while remaining inside the component return. */}
    {/* Outer div is role="button" (not <button>) so overflow-hidden is NOT
        set here — that was the clip ancestor that swallowed the tooltip.
        overflow-hidden + rounded corners are applied on the inner visual div. */}
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(e); } }}
      className={
        'w-full text-left rounded-md ' +
        (active ? 'ring-2 ring-blue-200' : '')
      }
    >
      <div
        className={
          'rounded-md border overflow-hidden ' +
          (active ? 'border-blue-600' : 'border-slate-200 hover:border-slate-300')
        }
      >
      <div
        className={
          'px-4 py-2 flex items-center justify-between border-b ' +
          (active ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-100')
        }
      >
        <div className="flex items-center gap-2">
          <Icon className={'w-4 h-4 ' + (active ? 'text-blue-600' : 'text-slate-500')} />
          <span className="text-xs uppercase tracking-wide font-semibold text-slate-600">{copy.label}</span>
        </div>
        {active && (
          <span className="text-[10px] uppercase tracking-wide font-semibold text-blue-700">Selected</span>
        )}
      </div>
      <div className="px-4 py-3 space-y-1">
        <div className="flex items-center gap-2">
          {/* Wave 27 v3.0.8 Task 1: use resolver planTitle instead of raw plan.name */}
          <div className="text-sm font-semibold text-slate-900">{presentation.planTitle}</div>
          {/* Wave 23 Task 5a: new-rate badge — visually distinct from coverage
              badges (violet vs. emerald/amber) so agents can scan at a glance. */}
          {plan.rate_class === 'new' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-violet-200 text-violet-700 bg-violet-50 text-[10px] font-semibold shrink-0">
              <Zap className="w-3 h-3" />
              New rate
            </span>
          )}
        </div>
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
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
        {/* Wave 27 v3.0.8 Task 1: tagline from resolver (canon plan_level_defaults) */}
        <div className="text-xs text-slate-500">{presentation.tagline}</div>
        {/* "See what's covered" trigger — opens coverage HTML modal */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setCoverageModalOpen(true);
            track('protection.customer.plan_card.coverage_modal_opened', {
              tier,
              plan_code: plan.raw?.plan_code,
              source: presentation.source.coverage,
            });
          }}
          className="text-[11px] text-slate-600 underline underline-offset-2 decoration-slate-400 hover:text-slate-800 hover:decoration-slate-600 transition-colors"
        >
          See what&apos;s covered
        </button>
        <div className="grid grid-cols-3 gap-2 pt-2 text-xs">
          {/* Wave 23 Task 6a: term_basis-aware display. additive → "+X mo",
              absolute → "Up to X mo", null/missing → legacy bare "X mo".
              Wave 38: monthly-membership plans are unlimited term + unlimited
              miles (recurring charge, not a fixed term). Deductible stays the
              real GetRates value for both billing models. */}
          <Stat k="Term" v={isMonthly ? 'Unlimited' : formatTermDisplay(plan.coverage_months, plan.term_basis)} />
          <Stat k="Miles" v={isMonthly ? 'Unlimited' : formatMilesDisplay(plan.coverage_miles, plan.term_basis)} />
          <Stat k="Deductible" v={`$${Math.round(plan.deductible)}`} />
        </div>
      </div>
      <div className="px-4 py-2 border-t border-slate-100 bg-white flex items-center justify-between">
        <span className="text-xs text-slate-500">Total</span>
        <div className="text-right">
          <div className="text-sm font-bold text-slate-900">${plan.total_cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          {totalDelta > 0 && (
            <div
              className="text-[10px] text-slate-600"
              title="Add-on costs are passed through without markup"
            >
              + ${totalDelta} add-ons
            </div>
          )}
          {/* Wave 38: monthly-membership plans always show the monthly line
              (their `monthly_cost` may be 0 — the charge lives in
              `monthly_charge`). Term plans keep the prior `plan.monthly_cost`
              truthiness gate exactly. */}
          {(isMonthly || plan.monthly_cost) ? (
            hasCrossSellAdjustment ? (
              <>
                <div className="text-[11px] text-slate-400 line-through">
                  <MonthlyTooltip
                    monthly={baseMonthly}
                    term={billing.term}
                    downPayment={downPayment}
                    downMode={billing.mode}
                    tier={tier}
                    isMonthly={isMonthly}
                  />
                </div>
                <div className="text-[12px] font-semibold text-emerald-700">~${Math.round(effective)}/mo</div>
                {insuranceMonthlyDollars > 0 && (
                  <div className="text-[10px] text-emerald-700">
                    -${Math.round(insuranceMonthlyDollars)}/mo (insurance{insuranceCarrier ? ` vs ${insuranceCarrier}` : ''})
                  </div>
                )}
                {refiAdditionDollars > 0 && (
                  <div className="text-[10px] text-blue-700">
                    +${Math.round(refiAdditionDollars)}/mo on your refi
                  </div>
                )}
              </>
            ) : (
              <div className="text-[11px] text-slate-500">
                <MonthlyTooltip
                  monthly={baseMonthly}
                  term={billing.term}
                  downPayment={downPayment}
                  downMode={billing.mode}
                  tier={tier}
                  isMonthly={isMonthly}
                />
              </div>
            )
          ) : null}
        </div>
      </div>
      </div>
    </div>

    {/* Wave 27 v3.0.8 Task 1: coverage modal rendered outside the card's
        overflow-hidden ancestor to prevent clipping. */}
    <PlanCoverageModal
      open={coverageModalOpen}
      onClose={() => setCoverageModalOpen(false)}
      title={presentation.planTitle}
      coverageHtml={presentation.coverageHtml}
      sampleAgreementUrl={presentation.sampleAgreementUrl}
      tpaCode={plan.raw?.tpa_code ?? null}
      planCode={plan.raw?.plan_code ?? null}
      planDescription={plan.raw?.plan_description ?? plan.name ?? null}
    />
    </>
  );
}

function Stat({ k, v }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{k}</div>
      <div className="text-slate-900 font-medium">{v}</div>
    </div>
  );
}
