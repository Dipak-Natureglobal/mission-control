// Home money — the thin adapter between the platform pricing resolver and
// this repo's screens.
//
// NOTHING IN HERE COMPUTES A PRICE. Every dollar comes out of
// packages/utils/home-pricing.js:
//
//   resolveHomePlanPrice      plan retail  = Omega remit + flat org markup
//   resolveHomeAddOnPrice     add-on retail = Omega cost x (1 + add_on_percent)
//   getHomePaymentTermOptions months-to-pay options AND default, PER coverage term
//   computeHomePaymentPlan    monthly = total / (months + 1)  — the +1 IS the down payment
//   computeHomePriceRange     the low/high band on the coverage step
//   getHomeDiscountCaps       plan caps and add-on caps — SEPARATE cap sets
//   applyAddOnDiscount        discounted add-on, floored at Omega cost
//
// What this file adds is only the wiring the screens would otherwise repeat:
// which state to price against, which months-to-pay basis is in force right
// now, and how a single add-on discount percent lands across a list of
// selections.

import {
  computeHomePaymentPlan,
  getHomePaymentTermOptions,
  applyAddOnDiscount,
} from 'blinker-platform/utils';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * The state the markup and the discount rules are evaluated against.
 *
 * The COVERED PROPERTY wins over the agreement holder's mailing address: the
 * Florida split exists because of where the coverage is written, not where
 * the bill is sent. The contact's state is the fallback for the stretch of
 * the wizard before an address has been captured.
 *
 * @param {object|null} form
 * @returns {string|null}
 */
export function pricingState(form) {
  const property = form?.home?.address?.state;
  if (property) return String(property).trim().toUpperCase();
  const contact = form?.contact?.state;
  if (contact) return String(contact).trim().toUpperCase();
  return null;
}

/**
 * The months-to-pay basis in force for a coverage term.
 *
 * Both the OPTIONS and the DEFAULT are per coverage term — 12-month coverage
 * offers [1, 6] defaulting to 6, everything else [1, 6, 12] defaulting to 12 —
 * so flipping the coverage term can change the divisor under the monthly
 * figure. An explicit agent choice (form.payment.months_to_pay) wins, but only
 * while it is still one of the options for the term now selected.
 *
 * @param {object} args
 * @param {number|string|null} args.orgId
 * @param {number|null} args.coverageTermMonths
 * @param {number|null} [args.chosenMonths]  form.payment?.months_to_pay
 * @returns {{ options: number[], months: number, default_months: number, source: string, chosenHonored: boolean }}
 */
export function paymentBasis({ orgId, coverageTermMonths, chosenMonths = null }) {
  const term = getHomePaymentTermOptions({ orgId, coverageTermMonths });
  const chosen = Number(chosenMonths);
  const honored = Number.isFinite(chosen) && term.options_months.includes(chosen);
  return {
    options: term.options_months,
    default_months: term.default_months,
    months: honored ? chosen : term.default_months,
    source: term.source,
    chosenHonored: honored,
  };
}

/**
 * One line item's share of a monthly payment, on the same divisor the plan
 * uses — so an add-on's "+$2.10 per month" and the plan's "$132.69 /mo" add up
 * to the total's monthly figure instead of drifting by a rounding rule.
 *
 * @param {number} price
 * @param {number} monthsToPay
 * @returns {number}
 */
export function perMonth(price, monthsToPay) {
  return computeHomePaymentPlan({ total: price, monthsToPay }).monthly;
}

/**
 * Apply ONE add-on discount percent across the selected add-ons.
 *
 * Every row goes through applyAddOnDiscount, which floors at Omega cost — a
 * belt-and-braces guard on top of the break-even clamp getHomeDiscountCaps
 * already applies to the configured percent. A row with no `cost` on it (a
 * selection made before markup was wired, or a hand-built fixture) is left at
 * its stored price rather than being discounted against a cost basis we do
 * not have.
 *
 * @param {object} args
 * @param {number|string|null} args.orgId
 * @param {Array} args.addOns          form.selectedAddOns
 * @param {number} args.discountPercent whole percent, e.g. 10
 * @returns {{ rows: Array, total: number, retailTotal: number, discount: number, floored: boolean }}
 */
export function discountAddOns({ orgId, addOns, discountPercent = 0 }) {
  const pct = Math.max(0, Number(discountPercent) || 0);
  let total = 0;
  let retailTotal = 0;
  let discount = 0;
  let floored = false;

  const rows = (Array.isArray(addOns) ? addOns : []).map((a) => {
    const retail = Number(a?.price) || 0;
    retailTotal += retail;
    if (pct <= 0 || a?.cost == null) {
      total += retail;
      return { ...a, retail_price: retail, discounted_price: retail, discount_applied: 0 };
    }
    const r = applyAddOnDiscount({ orgId, cost: a.cost, discountPercent: pct });
    total += r.price;
    discount += r.discount_applied;
    floored = floored || r.floored;
    return {
      ...a,
      retail_price: r.retail,
      discounted_price: r.price,
      discount_applied: r.discount_applied,
    };
  });

  return {
    rows,
    total: round2(total),
    retailTotal: round2(retailTotal),
    discount: round2(discount),
    floored,
  };
}
