// Home plan selection — good / better / best from a home GetRates response.
//
// THIS IS DELIBERATELY NOT A PORT OF protection-portal/src/lib/plan-selector.js
// -----------------------------------------------------------------------------
// The auto selector is a five-phase engine: build a candidate set per tier by
// quality substring + deductible threshold, apply a new-vs-used preference,
// optimize over a (term × mileage) grid highest-first, tie-break on
// term/miles/rate-class/cost, then borrow from a neighbouring tier when a tier
// comes back empty.
//
// A home has none of the axes that engine exists to navigate (ADR 30 D4 /
// spec §7.3):
//
//   * no mileage        — there is no odometer, so no (term × miles) grid and
//                         no highest-first optimizer
//   * no new/used axis  — NewUsed is '*'; classifyAsNew has nothing to read
//   * no deductible spread — every one of the six plans is a flat $75
//   * no tier ambiguity — the catalog states plan_level per plan code, so
//                         there is no quality() substring match to disambiguate
//   * no tier borrowing — a tier that is genuinely unavailable at the selected
//                         term (Better and Best at 12 months) must SAY SO.
//                         Borrowing a 24-month plan into the 12-month Better
//                         slot would quote a term the consumer did not pick.
//
// What remains is: partition by billing model, filter term products to the
// selected term, bucket by catalog plan_level. That is this file.
//
// Tier resolution goes through resolvePlanPresentation(), which applies the
// org_override → catalog → name_match → fallback precedence from ADR 18. Its
// fallback collapses to 'good', so we only trust it when it actually matched
// catalog or override data; otherwise we fall back to the product's tier_hint
// before letting a name match decide. Same precedence the auto selector uses
// for monthly plans, for the same reason.

import { resolvePlanPresentation, resolveHomePlanPrice } from 'blinker-platform/utils';

const TIERS = ['good', 'better', 'best'];

/**
 * Billing-model accessor — the single source of truth for the missing-field
 * default. A missing / null / unrecognised billing_model is 'term_total'.
 *
 * @param {object} product
 * @returns {'term_total'|'monthly_subscription'}
 */
export function billingModel(product) {
  return product?.billing_model === 'monthly_subscription'
    ? 'monthly_subscription'
    : 'term_total';
}

/**
 * Resolve a product's tier.
 *
 * @param {object} product
 * @param {number|string|null} orgId
 * @returns {'good'|'better'|'best'}
 */
export function tierOf(product, orgId) {
  const presentation = resolvePlanPresentation({
    orgId: orgId ?? null,
    tpaCode: product?.tpa_code ?? null,
    productTypeCode: product?.product_type_code ?? null,
    planCode: product?.plan_code ?? null,
    planName: product?.name ?? product?.plan_description ?? null,
  });
  const source = presentation?.source?.level ?? null;
  if (presentation?.planLevel && (source === 'org_override' || source === 'catalog')) {
    return presentation.planLevel;
  }
  if (TIERS.includes(product?.tier_hint)) return product.tier_hint;
  return presentation?.planLevel && TIERS.includes(presentation.planLevel)
    ? presentation.planLevel
    : 'good';
}

/**
 * Normalize one rate product into the candidate shape the UI and the
 * downstream money path read.
 *
 * PRICING (Wave 39 follow-up)
 * ---------------------------
 * The rater's `base_price` is OMEGA'S REMIT — the org's cost, with no margin
 * in it. Every price the consumer sees, and every dollar that reaches
 * paymentSchedule, has to be retail. That conversion happens HERE, once, so
 * no screen can render one number while the charge uses another:
 *
 *   base_price  = Omega remit (kept, because the range resolver re-derives
 *                 retail from it and the agreement needs the cost basis)
 *   total_cost  = retail = base_price + the org's flat home markup
 *
 * The markup itself is never computed in this repo — resolveHomePlanPrice()
 * owns it, including the Florida split and the term-vs-monthly distinction.
 *
 * `coverage_period_months` is carried under its raw name AND mirrored to
 * `term_months` because the DocuSeal field builder reads the former while the
 * screens read the latter — keeping both avoids a translation layer that
 * could silently drop one.
 *
 * @param {object} product
 * @param {string} tier
 * @param {object} [pricing]
 * @param {number|string|null} [pricing.orgId]
 * @param {string|null} [pricing.state]  buyer state — selects the FL markup
 * @returns {object}
 */
function buildCandidate(product, tier, { orgId = null, state = null } = {}) {
  const isMonthly = billingModel(product) === 'monthly_subscription';

  const termPrice = resolveHomePlanPrice({
    orgId,
    basePrice: product.base_price ?? 0,
    state,
    billingModel: 'term',
  });
  const monthlyPrice = resolveHomePlanPrice({
    orgId,
    basePrice: product.monthly_charge ?? product.monthly_price ?? product.base_price ?? 0,
    state,
    billingModel: 'monthly',
  });

  return {
    id: product.id,
    name: product.name ?? product.plan_description ?? null,
    provider: product.provider ?? null,
    tier,

    plan_code: product.plan_code ?? null,
    tpa_code: product.tpa_code ?? null,
    product_type_code: product.product_type_code ?? null,
    program_code: product.program_code ?? null,

    coverage_period_months: product.coverage_period_months != null
      ? Number(product.coverage_period_months)
      : null,
    term_months: product.coverage_period_months != null
      ? Number(product.coverage_period_months)
      : null,
    deductible: Number(product.deductible ?? 0),

    // Retail. `base_price` is the Omega remit it was derived from.
    total_cost: isMonthly ? monthlyPrice.price : termPrice.price,
    base_price: termPrice.base_price,
    markup_applied: isMonthly ? monthlyPrice.markup_applied : termPrice.markup_applied,
    markup_enabled: termPrice.enabled,
    monthly_cost: isMonthly ? monthlyPrice.price : Number(product.monthly_price ?? 0),

    billing_model: billingModel(product),
    monthly_charge: isMonthly ? monthlyPrice.price : null,
    base_monthly_charge: isMonthly ? monthlyPrice.base_price : null,
    // Home month-to-month plans run 1–23 months and carry no mileage axis at
    // all, so both are "unlimited" from the consumer's point of view.
    unlimited: isMonthly,

    // RAW <Option> rows, unfiltered. Filtering is the job of
    // resolveHomeAddOns on the optional_coverages step, because it depends on
    // the term the consumer picks AFTER this screen.
    options: Array.isArray(product.options) ? product.options : [],

    raw: product,
  };
}

// Within a tier there should be exactly one product per (plan_code, term).
// If a rater ever returns more, pick deterministically — cheapest wins — so
// the same response always produces the same quote.
function cheapest(candidates, isMonthly) {
  if (candidates.length === 0) return null;
  const key = isMonthly
    ? (c) => Number(c.monthly_charge ?? c.total_cost ?? Infinity)
    : (c) => Number(c.total_cost ?? Infinity);
  return [...candidates].sort((a, b) => key(a) - key(b))[0];
}

/**
 * Select the good / better / best set for a home quote.
 *
 * @param {object} args
 * @param {object} args.rates        the normalized GetRates response
 * @param {number|string} args.orgId
 * @param {'term'|'monthly'} [args.mode]
 * @param {number|null} [args.termMonths]  required in term mode
 * @param {string|null} [args.state]  buyer state — selects the FL markup split
 * @returns {{
 *   plans: { good: object|null, better: object|null, best: object|null },
 *   monthly: { good: object|null, better: object|null, best: object|null }|null,
 *   hasMonthly: boolean,
 *   availableTerms: number[],
 *   termsByTier: Record<string, number[]>,
 *   debug: object,
 * }}
 */
export function selectHomePlans({ rates, orgId, mode = 'term', termMonths = null, state = null } = {}) {
  const pricing = { orgId, state };
  const products = Array.isArray(rates?.products) ? rates.products : [];

  const termProducts = products.filter((p) => billingModel(p) !== 'monthly_subscription');
  const monthlyProducts = products.filter((p) => billingModel(p) === 'monthly_subscription');

  // Every distinct fixed term the rater returned, ascending. Drives the term
  // selector. Note this is the UNION across plans — 12 appears because plan 35
  // offers it, even though 36 and 37 do not. `termsByTier` carries the
  // per-tier truth so the UI can name the gap instead of hiding it.
  const availableTerms = [
    ...new Set(
      termProducts
        .map((p) => Number(p.coverage_period_months))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ].sort((a, b) => a - b);

  const termsByTier = { good: [], better: [], best: [] };
  for (const p of termProducts) {
    const tier = tierOf(p, orgId);
    const t = Number(p.coverage_period_months);
    if (!Number.isFinite(t)) continue;
    if (!termsByTier[tier]) termsByTier[tier] = [];
    if (!termsByTier[tier].includes(t)) termsByTier[tier].push(t);
  }
  for (const tier of Object.keys(termsByTier)) termsByTier[tier].sort((a, b) => a - b);

  // ── term set ────────────────────────────────────────────────────────────
  const effectiveTerm = Number(termMonths);
  const termCandidates = Number.isFinite(effectiveTerm)
    ? termProducts.filter((p) => Number(p.coverage_period_months) === effectiveTerm)
    : [];

  const plans = { good: null, better: null, best: null };
  for (const tier of TIERS) {
    const forTier = termCandidates
      .filter((p) => tierOf(p, orgId) === tier)
      .map((p) => buildCandidate(p, tier, pricing));
    // NO tier borrowing. An empty tier at this term stays null, and the UI
    // renders an explicit "not available at N months" state.
    plans[tier] = cheapest(forTier, false);
  }

  // ── monthly set ─────────────────────────────────────────────────────────
  const hasMonthly = monthlyProducts.length > 0;
  let monthly = null;
  if (hasMonthly) {
    monthly = { good: null, better: null, best: null };
    for (const tier of TIERS) {
      const forTier = monthlyProducts
        .filter((p) => tierOf(p, orgId) === tier)
        .map((p) => buildCandidate(p, tier, pricing));
      monthly[tier] = cheapest(forTier, true);
    }
  }

  return {
    plans,
    monthly,
    hasMonthly,
    availableTerms,
    termsByTier,
    debug: {
      mode,
      term_months: Number.isFinite(effectiveTerm) ? effectiveTerm : null,
      product_count: products.length,
      term_product_count: termProducts.length,
      monthly_product_count: monthlyProducts.length,
      candidate_count: termCandidates.length,
      // There is no fallbacks[] here on purpose — home never borrows a tier.
    },
  };
}

/**
 * The default term to land on when the consumer first reaches the coverage
 * step: the longest term at which ALL THREE tiers exist, so the first paint
 * is never a screen with two "not available" cards. Falls back to the longest
 * available term, then to null.
 *
 * @param {object} args
 * @param {number[]} args.availableTerms
 * @param {Record<string, number[]>} args.termsByTier
 * @returns {number|null}
 */
export function defaultTerm({ availableTerms = [], termsByTier = {} } = {}) {
  const complete = availableTerms.filter((t) =>
    TIERS.every((tier) => (termsByTier[tier] || []).includes(t)),
  );
  if (complete.length > 0) return complete[complete.length - 1];
  if (availableTerms.length > 0) return availableTerms[availableTerms.length - 1];
  return null;
}

/**
 * Build the `form.selectedPlan` slice from a selector candidate.
 *
 * Everything the money path and the agreement need travels on this object:
 * `total_cost` and `coverage_period_months` are read by the DocuSeal field
 * builder; `options` and `plan_code` are read by optional_coverages;
 * `billing_model` and `monthly_charge` are read by Confirm.
 *
 * @param {string} tier
 * @param {object} plan  a candidate from selectHomePlans
 * @returns {object}
 */
export function buildSelectedPlan(tier, plan) {
  if (!plan) return null;
  return {
    tier,
    id: plan.id,
    plan_code: plan.plan_code,
    tpa_code: plan.tpa_code,
    product_type_code: plan.product_type_code,
    program_code: plan.program_code,
    plan_name: plan.name,
    provider: plan.provider,

    coverage_period_months: plan.coverage_period_months,
    term_months: plan.term_months,
    deductible: plan.deductible,

    // Retail (markup applied). `base_price` is the Omega remit it came from —
    // computeHomePriceRange() re-derives retail from it, so it must survive.
    total_cost: plan.total_cost,
    base_price: plan.base_price,
    markup_applied: plan.markup_applied,
    monthly_cost: plan.monthly_cost,
    billing_model: plan.billing_model,
    monthly_charge: plan.monthly_charge,
    base_monthly_charge: plan.base_monthly_charge,
    unlimited: plan.unlimited,

    options: plan.options,
  };
}

export const TIER_ORDER = TIERS;
