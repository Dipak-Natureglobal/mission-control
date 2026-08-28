// Add-on invalidation — the single implementation of ADR 30 D7's
// consequence rule, shared by RecommendedCoverage and OptionalCoverages.
//
// THE RULE
// --------
// When the plan or the term changes, BOTH the OptionId and the price of every
// optional coverage change with it. Internal plumbing is $57 at 12 months,
// $152 at 36 months on plan 35, and $186 at 36 months on plans 36/37. A
// selection carried forward across that flip would charge the wrong amount
// against a signed agreement — the money is in the charge path here, unlike
// auto where passthrough totals are display-only.
//
// So selections are never carried forward. They are re-resolved by canonical
// key against the freshly computed available set and re-priced from it;
// anything no longer offered is dropped and reported so the UI can say what
// disappeared instead of silently shrinking the total.
//
// Both screens call this so the two can't drift. RecommendedCoverage calls it
// on every plan / term / mode flip; OptionalCoverages calls it again on mount
// as a backstop, because a consumer can reach Confirm through paths that skip
// a re-render of the picker.

import {
  resolveHomeAddOns,
  revalidateSelections,
  resolveHomeAddOnPrice,
} from 'blinker-platform/utils';
import planMappings from '../constants/canon/plan-mappings.json' with { type: 'json' };

const ADDON_CANON = planMappings.home_add_ons;

/**
 * A stable identity for "which add-on catalogue applies right now".
 * When this string changes, every prior selection is suspect.
 *
 * @param {object|null} plan  form.selectedPlan
 * @param {number|null} termMonths
 * @returns {string|null}
 */
export function addOnScopeKey(plan, termMonths) {
  if (!plan?.plan_code) return null;
  const term = plan.billing_model === 'monthly_subscription'
    ? 'monthly'
    : (termMonths ?? plan.coverage_period_months ?? null);
  return `${plan.plan_code}::${term ?? 'none'}`;
}

/**
 * Resolve what this plan+term actually offers, AT RETAIL.
 *
 * The rater's RetailRate is — despite the name — Omega's cost to the org. The
 * consumer never sees it: every row leaves here carrying `cost` (Omega) and
 * `price` (cost + the org's add-on markup, from resolveHomeAddOnPrice). Both
 * are needed downstream — `price` is what gets charged, `cost` is the floor an
 * agent discount can never go below.
 *
 * @param {object|null} plan
 * @param {number|null} termMonths
 * @param {number|string|null} [orgId]
 * @returns {Array<{ key, label, option_id, price, cost, markup_applied, docuseal_field, variant }>}
 */
export function availableAddOns(plan, termMonths, orgId = null) {
  if (!plan) return [];
  // Monthly plans (38 / 48 / 49) return no <Option> rows at all. Asking the
  // resolver anyway would work — plan_variant_rule maps them to null — but
  // short-circuiting makes the intent legible at the call site.
  if (plan.billing_model === 'monthly_subscription') return [];
  const rows = resolveHomeAddOns({
    options: plan.options || [],
    planCode: plan.plan_code,
    termMonths: termMonths ?? plan.coverage_period_months ?? null,
    canonBlock: ADDON_CANON,
  });
  return rows.map((row) => {
    const priced = resolveHomeAddOnPrice({ orgId, cost: row.price });
    return {
      ...row,
      cost: priced.cost,
      price: priced.price,
      markup_applied: priced.markup_applied,
    };
  });
}

/**
 * The add-ons the consumer's home-features answers imply, expressed as OMEGA
 * COST rows — the shape computeHomePriceRange() wants, because it applies the
 * markup itself and would otherwise mark up an already-marked-up number.
 *
 * @param {Array} rows  availableAddOns() output
 * @param {object|null} homeFeatures  form.homeFeatures
 * @returns {Array<{ key: string, price: number }>}
 */
export function impliedAddOnCosts(rows, homeFeatures) {
  const features = homeFeatures || {};
  return (rows || [])
    .filter((r) => features[r.key] === true)
    .map((r) => ({ key: r.key, price: r.cost ?? r.price }));
}

/**
 * Re-resolve and re-price the current selections for a new plan / term.
 *
 * @param {object} args
 * @param {Array} args.selected      form.selectedAddOns
 * @param {object|null} args.plan    the NEW selected plan
 * @param {number|null} args.termMonths  the NEW term
 * @param {number|string|null} [args.orgId]  drives the add-on markup
 * @returns {{
 *   available: Array,
 *   selectedAddOns: Array,
 *   dropped: Array,
 *   scopeKey: string|null,
 *   changed: boolean,
 * }}
 */
export function syncAddOns({ selected, plan, termMonths, orgId = null }) {
  const available = availableAddOns(plan, termMonths, orgId);
  const { kept, dropped } = revalidateSelections({
    selected: Array.isArray(selected) ? selected : [],
    available,
  });
  const before = JSON.stringify((selected || []).map((s) => [s?.key, s?.option_id, s?.price]));
  const after = JSON.stringify(kept.map((s) => [s.key, s.option_id, s.price]));
  return {
    available,
    selectedAddOns: kept,
    dropped,
    scopeKey: addOnScopeKey(plan, termMonths),
    changed: before !== after,
  };
}

export { ADDON_CANON };
