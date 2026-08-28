// Home plan card. Shared by RecommendedCoverage (the tier picker) and
// Customize (the plan browser), so visual and behavioural parity between the
// two screens is the contract — change it here and both see it.
//
// Two states beyond the ordinary one:
//
//   * MONTHLY — plans 38 / 48 / 49 bill a flat recurring charge over 1–23
//     months. There is no term total to show and no amortization, so the
//     price line is "$40/mo", Term reads "Unlimited", and the tooltip drops
//     the "for N months with $X down" clause that only makes sense for a
//     financed term total.
//
//   * UNAVAILABLE — at 12 months only plan 35 exists. Better and Best render
//     an explicit "not available at 12 months" card rather than disappearing
//     or, worse, silently borrowing a 24-month plan into the slot. The
//     consumer picked a term; showing them a different one would be a lie.
//
// THE MONTHLY PAYMENT IS THE HEADLINE (Wave 39 follow-up)
// -------------------------------------------------------
// A home warranty is bought as a monthly line in a household budget, so the
// card leads with the monthly figure and demotes the term total to the helper
// line beneath it. The divisor is the org's months-to-pay basis for the
// SELECTED coverage term, and the down payment equals one monthly payment —
// both facts are on the card, because an unexplained monthly figure reads as
// a trick.
//
// Add-on dollars ARE reflected here, but only as a RANGE and only when the
// consumer's home-features answers imply paid optional coverages: low is the
// plan alone, high is the plan plus every implied add-on at retail. Nothing is
// committed until optional_coverages, which is exactly why it is a band and
// not a number. With no implied add-ons there is no range.
//
// Every figure comes from computeHomePriceRange() in
// packages/utils/home-pricing.js — this component formats, it does not price.
import { useState } from 'react';
import { Check, CalendarX2 } from 'lucide-react';
import { resolvePlanPresentation } from 'blinker-platform/utils';
import { track } from 'blinker-platform/telemetry';
import { Tooltip } from './Tooltip.jsx';
import { PlanCoverageModal } from './PlanCoverageModal.jsx';
import { HOME_TIER_COPY, taglineFor } from './homePlanCopy.js';

function fmtDollars(v) {
  return `$${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtCents(v) {
  return `$${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "$133" or "$133–$136" — the dominant figure is kept to whole dollars. */
function bandDollars(low, high, hasRange) {
  return hasRange && Math.round(high) !== Math.round(low)
    ? `${fmtDollars(low)}–${fmtDollars(high)}`
    : fmtDollars(low);
}

/**
 * @param {object} props
 * @param {'good'|'better'|'best'} props.tier
 * @param {object|null} props.plan       a candidate from selectHomePlans; null
 *                                       means "this tier is not offered at the
 *                                       selected term"
 * @param {boolean} props.active
 * @param {Function} props.onClick
 * @param {number|string|null} props.orgId
 * @param {number|null} props.termMonths the term the consumer selected — used
 *                                       to phrase the unavailable state
 * @param {number[]} props.otherTerms    terms where this tier IS offered
 * @param {object|null} props.range      computeHomePriceRange() output for
 *                                       this tier — the monthly headline, the
 *                                       total band, and the payment basis
 * @param {number|null} props.monthsToPay the months-to-pay basis in force
 */
export function PlanCard({
  tier,
  plan,
  active = false,
  onClick,
  orgId = null,
  termMonths = null,
  otherTerms = [],
  range = null,
  monthsToPay = null,
}) {
  const copy = HOME_TIER_COPY[tier] || HOME_TIER_COPY.good;
  const Icon = copy.icon;
  const [coverageOpen, setCoverageOpen] = useState(false);

  // ── unavailable state ───────────────────────────────────────────────────
  if (!plan) {
    const alternatives = otherTerms.filter((t) => t !== termMonths);
    return (
      <div className="rounded-md border border-dashed border-slate-300 bg-slate-50/60 overflow-hidden">
        <div className="px-4 py-2 flex items-center gap-2 border-b border-slate-200 bg-slate-100/60">
          <Icon className="w-4 h-4 text-slate-400" />
          <span className="text-xs uppercase tracking-wide font-semibold text-slate-500">
            {copy.label}
          </span>
        </div>
        <div className="px-4 py-4 flex items-start gap-2">
          <CalendarX2 className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" />
          <div className="text-xs text-slate-600 leading-relaxed">
            <div className="font-semibold text-slate-700 mb-0.5">
              {copy.planLabel} isn&apos;t available
              {termMonths ? ` at ${termMonths} months` : ''}
            </div>
            {alternatives.length > 0 ? (
              <>
                Omega offers this plan at{' '}
                <span className="font-semibold">
                  {alternatives.map((t) => `${t}`).join(', ')} months
                </span>
                . Choose a longer term above to see it.
              </>
            ) : (
              <>This plan isn&apos;t offered for this property.</>
            )}
          </div>
        </div>
      </div>
    );
  }

  const presentation = resolvePlanPresentation({
    orgId,
    tpaCode: plan.tpa_code ?? null,
    productTypeCode: plan.product_type_code ?? null,
    planCode: plan.plan_code ?? null,
    planName: plan.name,
  });

  const isMonthly = plan.billing_model === 'monthly_subscription';
  const monthlyCharge = Math.round(Number(plan.monthly_charge ?? plan.monthly_cost ?? 0));

  // ── term-plan money ─────────────────────────────────────────────────────
  // `range` is authoritative when present. The fallback keeps the card
  // renderable for a caller that has not wired the resolver yet (Customize's
  // browser, a test harness) rather than blanking the price.
  const hasRange = Boolean(range?.hasRange && range.high > range.low);
  const lowTotal = range?.low ?? Number(plan.total_cost ?? 0);
  const highTotal = range?.high ?? lowTotal;
  const months = range?.monthsToPay ?? monthsToPay ?? null;
  const lowMonthly = range?.lowMonthly ?? null;
  const highMonthly = range?.highMonthly ?? lowMonthly;

  const monthlyLabel = lowMonthly != null
    ? bandDollars(lowMonthly, highMonthly, hasRange)
    : '—';
  const totalLabel = bandDollars(lowTotal, highTotal, hasRange);

  const priceExplainer = lowMonthly == null
    ? `${fmtCents(lowTotal)} total for ${plan.coverage_period_months} months of coverage. Payment terms are set at checkout.`
    : hasRange
    ? `${fmtCents(lowMonthly)}/mo covers the plan on its own. ${fmtCents(highMonthly)}/mo adds every optional coverage your answers imply — you choose them on the next step. Either way it is ${months} payments plus a down payment equal to one monthly payment, on ${plan.coverage_period_months} months of coverage.`
    : `${fmtCents(lowTotal)} total for ${plan.coverage_period_months} months of coverage: ${months} payments of ${fmtCents(lowMonthly)} plus a ${fmtCents(lowMonthly)} down payment. The down payment is one monthly payment.`;

  return (
    <>
      {/* role="button" on the outer div (not a real <button>) so no
          overflow-hidden is needed here — that was the clipping ancestor
          that used to swallow the tooltip. overflow-hidden lives on the
          inner visual div, which the fixed-position tooltip escapes. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick?.(e);
          }
        }}
        className={'w-full text-left rounded-md ' + (active ? 'ring-2 ring-blue-200' : '')}
      >
        <div
          className={
            'rounded-md border overflow-hidden bg-white ' +
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
              <span className="text-xs uppercase tracking-wide font-semibold text-slate-600">
                {copy.label}
              </span>
            </div>
            {active && (
              <span className="text-[10px] uppercase tracking-wide font-semibold text-blue-700">
                Selected
              </span>
            )}
          </div>

          <div className="px-4 py-3 space-y-1">
            <div className="text-sm font-semibold text-slate-900">
              {presentation.planTitle || plan.name}
            </div>
            <div className="text-xs text-slate-500">{taglineFor(presentation, tier)}</div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setCoverageOpen(true);
                track('home_protection.customer.plan_card.coverage_modal_opened', {
                  tier,
                  plan_code: plan.plan_code,
                  source: presentation.source?.coverage ?? null,
                });
              }}
              className="text-[11px] text-slate-600 underline underline-offset-2 decoration-slate-400 hover:text-slate-800 hover:decoration-slate-600 transition-colors"
            >
              See what&apos;s covered
            </button>

            <div className="grid grid-cols-3 gap-2 pt-2 text-xs">
              <Stat
                k="Term"
                v={isMonthly ? 'Unlimited' : `${plan.coverage_period_months} mo`}
              />
              <Stat k="Deductible" v={`$${Math.round(plan.deductible || 0)}`} />
              <Stat k="Service call" v="$75" />
            </div>
          </div>

          <div className="px-4 py-2 border-t border-slate-100 bg-white flex items-center justify-between">
            <span className="text-xs text-slate-500">Per month</span>
            <div className="text-right">
              {isMonthly ? (
                <>
                  <div className="text-sm font-bold text-slate-900">
                    <Tooltip
                      content="Billed monthly. Unlimited term, cancel anytime — no down payment and no fixed number of payments."
                      onFirstShow={() =>
                        track('home_protection.customer.plan_card.price_tooltip_shown', {
                          tier,
                          billing_model: 'monthly_subscription',
                        })
                      }
                    >
                      ${monthlyCharge}/mo
                    </Tooltip>
                  </div>
                  <div className="text-[11px] text-slate-500">cancel anytime</div>
                </>
              ) : (
                <>
                  <div className="text-lg font-bold text-slate-900 leading-none">
                    {monthlyLabel}
                    <span className="text-xs font-semibold text-slate-500 ml-0.5">/mo</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    <Tooltip
                      content={priceExplainer}
                      onFirstShow={() =>
                        track('home_protection.customer.plan_card.price_tooltip_shown', {
                          tier,
                          billing_model: 'term_total',
                          term_months: plan.coverage_period_months,
                          has_range: hasRange,
                          months_to_pay: months,
                        })
                      }
                    >
                      {totalLabel} total
                      {months != null ? ` · ${months} payments + 1 down` : ''}
                    </Tooltip>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Rendered outside the card's overflow-hidden ancestor. */}
      <PlanCoverageModal
        open={coverageOpen}
        onClose={() => setCoverageOpen(false)}
        tier={tier}
        presentation={presentation}
        plan={plan}
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

export function SelectedPill() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700">
      <Check className="w-3 h-3" /> Selected
    </span>
  );
}
