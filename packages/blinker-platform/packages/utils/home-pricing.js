// Home protection pricing — ADR 30 (Wave 39 follow-up, 2026-08-26).
//
// The auto workflow's protection-pricing.js prices a plan against
// `protection_billing`. Home has its own product line, its own margins, and
// two things auto has never needed:
//
//   1. A PRICE RANGE. When the consumer's home-features answers imply paid
//      optional coverages, the coverage step shows a low/high band — low is
//      the plan alone, high is the plan plus every implied add-on. The
//      customer has not chosen add-ons yet, so a single number would be a
//      guess in one direction or the other.
//   2. A MONTHLY PAYMENT as the dominant figure, derived from the org's
//      months-to-pay default for THAT coverage term, with a down payment
//      equal to one monthly payment.
//
// Down-payment-equals-one-payment makes the monthly fall out cleanly:
//
//     total = down + (months x monthly)  and  down = monthly
//   =>total = monthly x (months + 1)
//   => monthly = total / (months + 1)
//
// ---------------------------------------------------------------------------
// The cost floor (important)
//
// Add-ons carry their own percentage markup, and a SEPARATE discount cap. The
// intent is that a discount must never sell an add-on below Omega's cost. A
// naive "discount % <= markup %" rule does NOT achieve that, because the two
// percentages apply to different bases:
//
//     cost 100 -> retail 130 (30% markup) -> less 30% -> 91   BELOW COST
//
// Break-even is markup / (1 + markup) — 23.08% at a 30% markup. So the
// configured cap is CLAMPED to that ceiling, and `applyAddOnDiscount` enforces
// a hard floor at cost besides, so a mis-set org config still cannot price
// below cost.
// ---------------------------------------------------------------------------

import orgRegistry from '../../canon/org-registry.json' with { type: 'json' };

const FLORIDA_STATES = new Set(['FL', 'FLORIDA']);

function orgFor(orgId) {
  if (orgId == null) return null;
  return (orgRegistry.orgs || []).find((o) => String(o.id) === String(orgId)) || null;
}

function billingFor(orgId) {
  return orgFor(orgId)?.home_protection_billing || null;
}

function isFlorida(state) {
  return FLORIDA_STATES.has(String(state ?? '').trim().toUpperCase());
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Plan price = SE base (Omega remit) + the org's flat home markup.
 *
 * @param {object} args
 * @param {number|string} args.orgId
 * @param {number} args.basePrice   the rater's base_price for the plan+term
 * @param {string} [args.state]     buyer state — selects the FL markup split
 * @param {'term'|'monthly'} [args.billingModel]
 * @returns {{ price: number, base_price: number, markup_applied: number, is_florida: boolean, enabled: boolean }}
 */
export function resolveHomePlanPrice({ orgId, basePrice, state, billingModel = 'term' }) {
  const billing = billingFor(orgId);
  const base = Number(basePrice) || 0;
  if (!billing) {
    return { price: round2(base), base_price: round2(base), markup_applied: 0, is_florida: false, enabled: false };
  }
  const fl = isFlorida(state);
  const mk = billing.markup || {};
  const markup = billingModel === 'monthly'
    ? Number(fl ? mk.florida_monthly_dollars : mk.monthly_dollars) || 0
    : Number(fl ? mk.florida_fixed_term_dollars : mk.fixed_term_dollars) || 0;
  return {
    price: round2(base + markup),
    base_price: round2(base),
    markup_applied: round2(markup),
    is_florida: fl,
    enabled: billing.enabled !== false,
  };
}

/**
 * Add-on retail = Omega cost x (1 + add_on_percent).
 *
 * `add_on_percent` is a fraction (0.30 = 30%). A value > 1 is read as a whole
 * percent (30 -> 0.30) so a mis-typed config degrades sanely instead of
 * marking an add-on up 3000%.
 *
 * @param {object} args
 * @param {number|string} args.orgId
 * @param {number} args.cost  the rater's RetailRate for this option
 * @returns {{ price: number, cost: number, markup_applied: number, percent: number }}
 */
export function resolveHomeAddOnPrice({ orgId, cost }) {
  const c = Number(cost) || 0;
  const pct = getAddOnMarkupPercent(orgId);
  const price = round2(c * (1 + pct));
  return { price, cost: round2(c), markup_applied: round2(price - c), percent: pct };
}

/** @returns {number} fraction, e.g. 0.30 */
export function getAddOnMarkupPercent(orgId) {
  const raw = Number(billingFor(orgId)?.markup?.add_on_percent);
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return raw > 1 ? raw / 100 : raw;
}

/**
 * Months-to-pay options for a given COVERAGE term.
 *
 * Some payment terms do not qualify for a given coverage term, so the options
 * list itself is per coverage term — not just the default (user, 2026-08-26).
 * Falls back to the flat options_months/default_months when a coverage term
 * has no entry.
 *
 * @param {object} args
 * @param {number|string} args.orgId
 * @param {number} args.coverageTermMonths
 * @returns {{ options_months: number[], default_months: number, source: 'by_coverage_term'|'fallback'|'none' }}
 */
export function getHomePaymentTermOptions({ orgId, coverageTermMonths }) {
  const pt = billingFor(orgId)?.payment_term;
  if (!pt) return { options_months: [], default_months: 1, source: 'none' };

  const entry = pt.by_coverage_term?.[String(coverageTermMonths)];
  if (entry && Array.isArray(entry.options_months) && entry.options_months.length) {
    return {
      options_months: [...entry.options_months],
      default_months: Number(entry.default_months) || entry.options_months[0],
      source: 'by_coverage_term',
    };
  }
  const opts = Array.isArray(pt.options_months) ? [...pt.options_months] : [];
  return {
    options_months: opts,
    default_months: Number(pt.default_months) || opts[0] || 1,
    source: opts.length ? 'fallback' : 'none',
  };
}

/**
 * Payment plan where the down payment equals one monthly payment.
 *
 * @param {object} args
 * @param {number} args.total       full amount financed (plan + add-ons, post-discount)
 * @param {number} args.monthsToPay
 * @returns {{ monthly: number, down_payment: number, months_to_pay: number, total: number, financed: number }}
 */
export function computeHomePaymentPlan({ total, monthsToPay }) {
  const t = Number(total) || 0;
  const m = Math.max(0, Math.floor(Number(monthsToPay) || 0));
  // monthly = total / (months + 1) — the +1 IS the down payment.
  const monthly = round2(t / (m + 1));
  return {
    monthly,
    down_payment: monthly,
    months_to_pay: m,
    total: round2(t),
    financed: round2(t - monthly),
  };
}

/**
 * The low/high band shown on the coverage step.
 *
 * Low  = plan alone (base + markup).
 * High = plan + every add-on implied by the home-features answers, each at its
 *        marked-up retail. Nothing is committed yet — the customer chooses on
 *        the optional-coverages step, which is why this is a range.
 *
 * @param {object} args
 * @param {number|string} args.orgId
 * @param {number} args.basePrice
 * @param {Array<{ key: string, price: number }>} args.impliedAddOns  resolveHomeAddOns output filtered to home-features hits (price = Omega cost)
 * @param {number} args.coverageTermMonths
 * @param {string} [args.state]
 * @param {number} [args.monthsToPay]  overrides the org default for this coverage term
 * @returns {{ low, high, hasRange, addOnTotal, monthsToPay, lowMonthly, highMonthly, downPaymentLow, downPaymentHigh, markupApplied }}
 */
export function computeHomePriceRange({
  orgId, basePrice, impliedAddOns = [], coverageTermMonths, state, monthsToPay,
}) {
  const plan = resolveHomePlanPrice({ orgId, basePrice, state });
  const addOnTotal = round2(
    (impliedAddOns || []).reduce(
      (sum, a) => sum + resolveHomeAddOnPrice({ orgId, cost: a?.price }).price,
      0,
    ),
  );

  const term = getHomePaymentTermOptions({ orgId, coverageTermMonths });
  const months = Number.isFinite(Number(monthsToPay)) ? Number(monthsToPay) : term.default_months;

  const low = plan.price;
  const high = round2(plan.price + addOnTotal);
  const lowPlan = computeHomePaymentPlan({ total: low, monthsToPay: months });
  const highPlan = computeHomePaymentPlan({ total: high, monthsToPay: months });

  return {
    low,
    high,
    hasRange: addOnTotal > 0,
    addOnTotal,
    monthsToPay: months,
    lowMonthly: lowPlan.monthly,
    highMonthly: highPlan.monthly,
    downPaymentLow: lowPlan.down_payment,
    downPaymentHigh: highPlan.down_payment,
    markupApplied: plan.markup_applied,
  };
}

/**
 * Discount caps. The add-on cap is clamped to the break-even ceiling so a
 * mis-set config cannot authorize a below-cost sale.
 *
 * @param {object} args
 * @param {number|string} args.orgId
 * @param {string} [args.state]
 * @returns {{ plan, addOn }} each { max_percent, max_dollars, allowed }
 */
export function getHomeDiscountCaps({ orgId, state }) {
  const billing = billingFor(orgId);
  const disc = billing?.discount || {};
  const disabled = (disc.disabled_in_states || []).some(
    (s) => String(s).toUpperCase() === String(state ?? '').trim().toUpperCase(),
  );

  const mk = getAddOnMarkupPercent(orgId);
  // Break-even: retail x (1 - d) >= cost  =>  d <= markup / (1 + markup)
  const breakEven = mk > 0 ? mk / (1 + mk) : 0;
  const configuredAddOn = (Number(disc.add_on?.max_percent) || 0) / 100;
  const effectiveAddOn = Math.max(0, Math.min(configuredAddOn, breakEven));

  return {
    plan: {
      max_percent: Number(disc.max_percent) || 0,
      max_dollars: Number(disc.max_dollars) || 0,
      allowed: !disabled,
    },
    addOn: {
      max_percent: round2(effectiveAddOn * 100),
      configured_percent: round2(configuredAddOn * 100),
      break_even_percent: round2(breakEven * 100),
      clamped: configuredAddOn > breakEven,
      allowed: !disabled && effectiveAddOn > 0,
    },
  };
}

/**
 * Apply a discount to one add-on, never below Omega's cost.
 *
 * The clamp in getHomeDiscountCaps already prevents this for a well-formed
 * config; this is the belt-and-braces floor so a caller passing an arbitrary
 * percent still cannot go below cost.
 *
 * @param {object} args
 * @param {number|string} args.orgId
 * @param {number} args.cost            Omega cost
 * @param {number} args.discountPercent whole percent, e.g. 10
 * @returns {{ price, cost, retail, discount_applied, floored }}
 */
export function applyAddOnDiscount({ orgId, cost, discountPercent }) {
  const { price: retail, cost: c } = resolveHomeAddOnPrice({ orgId, cost });
  const pct = Math.max(0, Number(discountPercent) || 0) / 100;
  const raw = retail * (1 - pct);
  const floored = raw < c;
  const price = round2(floored ? c : raw);
  return { price, cost: c, retail, discount_applied: round2(retail - price), floored };
}

export default {
  resolveHomePlanPrice,
  resolveHomeAddOnPrice,
  getAddOnMarkupPercent,
  getHomePaymentTermOptions,
  computeHomePaymentPlan,
  computeHomePriceRange,
  getHomeDiscountCaps,
  applyAddOnDiscount,
};
