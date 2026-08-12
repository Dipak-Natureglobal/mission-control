// Port of BlinkerLegacy/blinker/app/services/plan_selector_service.rb.
import { getOrgMaxPlanPrice, resolvePlanPresentation } from 'blinker-platform/utils';
import { track } from 'blinker-platform/telemetry';
// Selects Good / Better / Best from a StoneEagle GetRates response.
//
// The Ruby service is a 5-phase algorithm:
//   1. Build candidate set per quality tier (filter by deductible threshold).
//   2. Apply New-vs-Used preference.
//   3. Optimize by term + mileage (highest-first).
//   4. Final tie-break: longest term, highest miles, then lowest cost.
//   5. Fallback: if a tier has no candidates, borrow from another tier.
//
// Differences from the Rails implementation, all marked inline:
//   - The fixture's product shape is flat (one option per product) rather
//     than the legacy nested `options` array. The port treats each product
//     as its own option.
//   - PLAN_QUALITY_MAPPING is matched by case-insensitive substring against
//     the product name (the canon comment for plan-mappings.json says
//     "partial match on plan name returned from SE GetRates"). The Rails
//     version exact-matches on `category` because the legacy GetRates
//     normalization populates a `category` code; our normalized fixture
//     has product names instead.
//   - First-match wins, in canonical key order. Order matters: we list
//     more-specific keys before less-specific ones (e.g. POWERTRAIN PLUS
//     and POWERTRAIN ENHANCED before POWERTRAIN, EXCL before ADD-ON) so
//     "MC_EXCL-Add-on miles" classifies as best, not good.
//   - No DB persistence (no PlanMapping). Pure function in/out.
//   - No Rails.logger; debug info is returned alongside the picks.
//
// Inputs:
//   - rates: the StoneEagle GetRates response (matches src/fixtures/stone-eagle-get-rates.json)
//   - vehicle: { year, mileage } — used by classify_as_new()
//   - settings: { defaultDeductible, termMonths, coverageMiles, newMaxAgeYears, newMaxMileage }
// Output (Wave 38 — additive, back-compat):
//   - {
//       plans:      { good, better, best },   // TERM plans — unchanged
//       monthly:    { good, better, best } | null,  // MONTHLY-membership plans
//       hasMonthly: boolean,                  // true when monthly products exist
//       debug,
//     }
//
// Wave 38 — monthly-membership VSC plans (ADR 28 / architecture/28-monthly-membership-vsc.md):
//   StoneEagle returns a class of VSC products billed as a recurring MONTHLY
//   charge rather than a fixed-term total. The platform normalizer tags these
//   `billing_model: 'monthly_subscription'`; everything else is `'term_total'`.
//
//   CRITICAL: fixture-mode products are pre-normalized and have NO billing_model
//   field. A MISSING / undefined billing_model is treated as 'term_total'
//   everywhere (see billingModel() below). Never assume the field is present.
//
//   The term plans path (`plans`) keeps its EXACT prior behavior — it only ever
//   sees term_total products, so tiering and counts do not change. Monthly plans
//   are partitioned out FIRST so they never pollute the term optimizer.
//
//   The monthly path (`monthly`) builds a PARALLEL Good/Better/Best set that:
//     - does NOT run optimizeByTermAndMileage (term/miles don't apply — miles
//       are unlimited, term is the configured charge basis),
//     - does NOT apply the org max_plan_price ceiling (that cap is a term-total
//       dollar amount; monthly charges are per-month and incomparable),
//     - classifies tier the SAME way term plans do: prefer the catalog
//       plan_level via resolvePlanPresentation(), then the product's tier_hint,
//       then a plan-name substring match. So a monthly plan is NOT always "good".

const QUALITY_KEYS_ORDERED = [
  // Best — exclusionary plans
  ['EXCLUSIONARY', 'best'],
  ['EXCL', 'best'],
  // Better — powertrain plus / enhanced
  ['POWERTRAIN PLUS', 'better'],
  ['POWERTRAIN ENHANCED', 'better'],
  // Good — vanilla powertrain, used-stated, add-ons
  ['POWERTRAIN', 'good'],
  ['USED STATED', 'good'],
  ['ADD-ON', 'good'],
];

const DEFAULT_SETTINGS = {
  defaultDeductible: 500,
  termMonths: [12, 24, 36],
  coverageMiles: [25000, 50000, 100000],
  newMaxAgeYears: 3,
  newMaxMileage: 36000,
};

export function quality(name) {
  if (!name) return 'good';
  const upper = String(name).toUpperCase();
  for (const [key, q] of QUALITY_KEYS_ORDERED) {
    if (upper.includes(key)) return q;
  }
  return 'good';
}

// Billing-model accessor — the single source of truth for the missing-field
// default. Fixture-mode products carry NO billing_model; treat undefined/null
// (and any non-monthly value) as 'term_total'.
export function billingModel(product) {
  return product?.billing_model === 'monthly_subscription'
    ? 'monthly_subscription'
    : 'term_total';
}

function isMonthlyProduct(product) {
  return billingModel(product) === 'monthly_subscription';
}

const VALID_TIERS = ['good', 'better', 'best'];

// Tier classification for a MONTHLY-membership product. Mirrors the term-plan
// precedence used everywhere else:
//   1. catalog / org-override plan_level via resolvePlanPresentation()
//   2. the product's tier_hint (good | better | best)
//   3. plan-name substring match (quality())
// resolvePlanPresentation() already falls back through org_override → catalog →
// name_match → 'good', so it never throws and never returns an invalid tier.
function classifyMonthlyTier(product, orgId) {
  const presentation = resolvePlanPresentation({
    orgId: orgId ?? null,
    tpaCode: product?.tpa_code ?? null,
    productTypeCode: product?.product_type_code ?? null,
    planCode: product?.plan_code ?? null,
    planName: product?.name ?? product?.plan_description ?? null,
  });
  // Only trust the resolver when it matched real catalog/override data.
  // Its fallback collapses to 'good', so when no catalog match exists we
  // prefer the product's tier_hint before defaulting via name match.
  const source = presentation?.source?.level ?? presentation?.levelSource ?? null;
  if (presentation?.planLevel && (source === 'org_override' || source === 'catalog')) {
    return presentation.planLevel;
  }
  if (VALID_TIERS.includes(product?.tier_hint)) return product.tier_hint;
  return quality(product?.name ?? product?.plan_description ?? null);
}

function classifyAsNew(vehicle, settings) {
  if (!vehicle) return false;
  const currentYear = new Date().getFullYear();
  const age = currentYear - Number(vehicle.year || currentYear);
  const miles = Number(vehicle.mileage || 0);
  return age <= settings.newMaxAgeYears && miles <= settings.newMaxMileage;
}

function buildCandidate(product, vehicle, settings) {
  return {
    id: product.id,
    name: product.name,
    provider: product.provider,
    plan_quality: quality(product.name),
    coverage_months: Number(product.coverage_period_months || 0),
    coverage_miles: Number(product.mileage || 0),
    deductible: Number(product.deductible || 0),
    total_cost: Number(product.base_price || 0),
    monthly_cost: Number(product.monthly_price || 0),
    add_ons_included: product.add_ons_included || [],
    is_new: classifyAsNew(vehicle, settings),
    // Wave 23: pass through so PlanCard / Customize branch on rate_class badge,
    // filter chips, and term_basis display/filter math.
    rate_class: product.rate_class ?? null,
    term_basis: product.term_basis ?? null,
    // Wave 38: monthly-membership pass-through. billing_model defaults to
    // 'term_total' when absent (fixture mode). monthly_charge is the per-month
    // customer charge surfaced by the monthly UX; term_used is the configured
    // term basis (coverage_period_months). Both null on term plans.
    billing_model: billingModel(product),
    monthly_charge: product.monthly_charge != null ? Number(product.monthly_charge) : null,
    term_used: product.coverage_period_months != null ? Number(product.coverage_period_months) : null,
    raw: product,
  };
}

// Phase 1: candidate set for a tier — filter by quality and deductible.
function buildCandidateSet(allCandidates, qualityTier, alreadySelectedIds, settings) {
  return allCandidates.filter((c) =>
    c.plan_quality === qualityTier &&
    c.deductible <= settings.defaultDeductible &&
    !alreadySelectedIds.has(c.id),
  );
}

// Phase 2: prefer is_new candidates if any exist; otherwise return all.
function applyNewVsUsed(candidates) {
  const isNew = candidates.filter((c) => c.is_new);
  return isNew.length > 0 ? isNew : candidates;
}

// Phase 3: try (term, miles) combinations highest-first, return first
// non-empty match — matches the legacy algorithm.
function optimizeByTermAndMileage(candidates, settings) {
  const combos = [];
  for (const t of settings.termMonths) {
    for (const m of settings.coverageMiles) {
      combos.push([t, m]);
    }
  }
  // Sort ascending then reverse — same as Ruby `.sort.reverse`.
  combos.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  combos.reverse();

  for (const [months, miles] of combos) {
    const matching = candidates.filter((c) => c.coverage_months >= months && c.coverage_miles >= miles);
    if (matching.length > 0) return matching;
  }
  return [];
}

// Phase 4: tie-break — longest term, highest miles, rate_class='new' preferred,
// lowest total cost. rate_class sort is injected before cost so same-term
// same-miles tied candidates bubble the new-rate plan to the front.
function selectBest(candidates) {
  const sorted = [...candidates].sort((a, b) => {
    if (b.coverage_months !== a.coverage_months) return b.coverage_months - a.coverage_months;
    if (b.coverage_miles !== a.coverage_miles) return b.coverage_miles - a.coverage_miles;
    // Wave 23 Task 5b: prefer new-rate plans within the same term+miles bucket.
    const aNew = a.rate_class === 'new' ? 0 : 1;
    const bNew = b.rate_class === 'new' ? 0 : 1;
    if (aNew !== bNew) return aNew - bNew;
    return a.total_cost - b.total_cost;
  });
  return sorted[0] || null;
}

// Phase 5: borrow from another tier when this one is empty.
function fallbackForQuality(qualityTier) {
  if (qualityTier === 'best') return ['better', 'good'];
  if (qualityTier === 'better') return ['best', 'good'];
  return ['better', 'best'];
}

function selectForQuality(allCandidates, qualityTier, alreadySelectedIds, settings, debug) {
  let candidates = buildCandidateSet(allCandidates, qualityTier, alreadySelectedIds, settings);

  if (candidates.length === 0) {
    debug.fallbacks.push(qualityTier);
    for (const fb of fallbackForQuality(qualityTier)) {
      candidates = buildCandidateSet(allCandidates, fb, alreadySelectedIds, settings);
      if (candidates.length > 0) break;
    }
    if (candidates.length === 0) return null;
  }

  const filtered = applyNewVsUsed(candidates);
  if (filtered.length === 0) return null;

  const optimized = optimizeByTermAndMileage(filtered, settings);
  if (optimized.length === 0) return filtered[0]; // Phase 5 inner fallback

  return selectBest(optimized);
}

// Shared candidate-set builder. selectPlans + listMatchingPlans both
// start from the same per-product Candidate shape so we never have two
// drifting "what's eligible" filters. Each consumer does its own
// downstream filtering on top.
//
// maxPrice: when finite, drops any candidate whose total_cost exceeds the cap
// (org-level hard ceiling from org-registry.json::protection_billing.max_plan_price).
// Pass Infinity (or omit) to skip the filter — used when orgId is unknown.
//
// Wave 38: this returns TERM-TOTAL candidates ONLY. Monthly-membership products
// are partitioned out so they never enter the term optimizer or the term
// max_plan_price ceiling (their charge is per-month, not a comparable total).
function buildAllCandidates(rates, vehicle, settings, maxPrice) {
  const products = (rates?.products || []).filter((p) => !isMonthlyProduct(p));
  const candidates = products.map((p) => buildCandidate(p, vehicle, settings));
  if (Number.isFinite(maxPrice)) {
    return candidates.filter((c) => c.total_cost <= maxPrice);
  }
  return candidates;
}

// Wave 38: monthly-membership candidates ONLY. No max_plan_price filter — the
// per-month charge isn't comparable to the term-total ceiling. Tier is set the
// same way term plans are (catalog → tier_hint → name match).
function buildMonthlyCandidates(rates, vehicle, settings, orgId) {
  const products = (rates?.products || []).filter((p) => isMonthlyProduct(p));
  return products.map((p) => {
    const c = buildCandidate(p, vehicle, settings);
    c.plan_quality = classifyMonthlyTier(p, orgId);
    return c;
  });
}

// Pick one monthly plan per tier — lowest monthly_charge first within a tier.
// No term/miles optimizer (doesn't apply); no max-price cap. Tier borrowing is
// intentionally NOT applied: monthly tiers are sparse and a borrowed plan would
// misrepresent the tier label, so an empty tier stays null.
function selectMonthlyForTier(monthlyCandidates, tier, alreadySelectedIds) {
  const inTier = monthlyCandidates
    .filter((c) => c.plan_quality === tier && !alreadySelectedIds.has(c.id))
    .sort((a, b) => Number(a.monthly_charge ?? Infinity) - Number(b.monthly_charge ?? Infinity));
  return inTier[0] || null;
}

export function selectPlans({ rates, vehicle, orgId, settings: overrides } = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...(overrides || {}) };
  const maxPrice = getOrgMaxPlanPrice(orgId);
  // Wave 38: count TERM products only — monthly products are partitioned out
  // separately, so they must not register as "max-price filtered" here.
  const termProductsTotal = (rates?.products || []).filter((p) => !isMonthlyProduct(p)).length;
  const allCandidates = buildAllCandidates(rates, vehicle, settings, maxPrice);
  const productsDropped = termProductsTotal - allCandidates.length;

  if (productsDropped > 0) {
    track('protection.plan_selector.max_price_filtered', {
      org_id: orgId,
      max_plan_price: maxPrice,
      products_total: termProductsTotal,
      products_dropped: productsDropped,
    });
  }

  const debug = {
    candidate_count: allCandidates.length,
    by_quality: allCandidates.reduce((acc, c) => {
      acc[c.plan_quality] = (acc[c.plan_quality] || 0) + 1;
      return acc;
    }, {}),
    fallbacks: [],
    max_plan_price: maxPrice,
    filtered_by_max_price: productsDropped,
  };

  const plans = { good: null, better: null, best: null };
  const alreadySelectedIds = new Set();

  // Best → Better → Good, matching legacy order.
  for (const tier of ['best', 'better', 'good']) {
    const pick = selectForQuality(allCandidates, tier, alreadySelectedIds, settings, debug);
    if (pick) {
      pick.plan_quality = tier;
      plans[tier] = pick;
      alreadySelectedIds.add(pick.id);
    }
  }

  // Wave 38: parallel monthly-membership tier set. Built only when the rates
  // response actually carries monthly products; otherwise `monthly` is null and
  // `hasMonthly` is false so the consumer never shows the term↔monthly switch.
  const monthlyCandidates = buildMonthlyCandidates(rates, vehicle, settings, orgId);
  const hasMonthly = monthlyCandidates.length > 0;
  let monthly = null;
  if (hasMonthly) {
    monthly = { good: null, better: null, best: null };
    const monthlySelectedIds = new Set();
    for (const tier of ['best', 'better', 'good']) {
      const pick = selectMonthlyForTier(monthlyCandidates, tier, monthlySelectedIds);
      if (pick) {
        pick.plan_quality = tier;
        monthly[tier] = pick;
        monthlySelectedIds.add(pick.id);
      }
    }
    debug.monthly_candidate_count = monthlyCandidates.length;
    debug.monthly_by_quality = monthlyCandidates.reduce((acc, c) => {
      acc[c.plan_quality] = (acc[c.plan_quality] || 0) + 1;
      return acc;
    }, {});
  }

  return { plans, monthly, hasMonthly, debug };
}

// Sibling export for the Customize tier-aware browser. Unlike
// selectPlans (which collapses to one pick per tier via the Phase 3/4
// optimization heuristics), this returns the FULL array of plans
// matching the (tier, term, miles, deductible) filter combo.
//
// Filter shape:
//   - plan_quality === tier
//   - term:
//       • termRange = [min, max] → coverage_months in [min, max]  (preferred)
//       • term (scalar)          → coverage_months === Number(term) (legacy)
//       • neither                → no term filter
//     Range arrays may have null entries; treat null as "no bound on that side".
//   - miles: same shape (milesRange [min,max] OR exact miles OR neither).
//   - deductible: exact (Customize keeps deductible as a single Stepper).
//   - new-vs-used eligibility — same precedence as selectPlans:
//     when any candidate matching the filter is_new, prefer those;
//     otherwise return all matches. Mirrors applyNewVsUsed so the
//     "what's eligible for this vehicle" rule stays one source of truth.
//
// Sorted by total_cost asc.
//
// Wave 22 Task 5 — added termRange + milesRange to back the Customize
// range sliders. Back-compat: existing `term`/`miles` scalar callers
// continue to exact-match.
function inRange(value, range) {
  if (!Array.isArray(range)) return true;
  const [lo, hi] = range;
  if (lo != null && Number(value) < Number(lo)) return false;
  if (hi != null && Number(value) > Number(hi)) return false;
  return true;
}

export function listMatchingPlans({
  rates,
  vehicle,
  orgId,
  tier,
  term,
  termRange,
  miles,
  milesRange,
  deductible,
  // Wave 23 Task 5c: 'new' | 'used' | null. When null/undefined shows all.
  rateClass,
  // Wave 23 Task 6b: vehicle's current term (months since in-service) and
  // current mileage for additive term_basis filter math. Both default to 0
  // so additive plans degrade gracefully when the values are unknown.
  currentTermMonths = 0,
  currentMiles = 0,
  // Wave 38: 'term' (default) | 'monthly'. In 'monthly' mode the browser lists
  // ONLY monthly-membership products: tier + deductible filters still apply,
  // but the term/miles range math is dropped (unlimited miles, term is the
  // charge basis) and the set is sorted by monthly_charge ascending.
  mode = 'term',
  settings: overrides,
} = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...(overrides || {}) };

  // ── Monthly mode ──────────────────────────────────────────────────────────
  if (mode === 'monthly') {
    const monthlyCandidates = buildMonthlyCandidates(rates, vehicle, settings, orgId);
    const matches = monthlyCandidates.filter((c) => {
      if (c.plan_quality !== tier) return false;
      if (deductible != null && c.deductible !== Number(deductible)) return false;
      // No term/miles range filtering and no max-price cap in monthly mode.
      return true;
    });
    const filtered = applyNewVsUsed(matches);
    return [...filtered].sort(
      (a, b) => Number(a.monthly_charge ?? Infinity) - Number(b.monthly_charge ?? Infinity),
    );
  }

  // ── Term mode (default — unchanged behavior) ───────────────────────────────
  // Customize browses ALL priced plans — skip the org max_plan_price cap (applied only in selectPlans).
  const allCandidates = buildAllCandidates(rates, vehicle, settings, Infinity);

  const useTermRange = Array.isArray(termRange);
  const useMilesRange = Array.isArray(milesRange);

  const matches = allCandidates.filter((c) => {
    if (c.plan_quality !== tier) return false;
    // Wave 23 Task 6b: term/miles filter math branches on term_basis.
    // 'additive' plans extend the existing contract term/mileage, so we
    // compare against the effective end-state. 'absolute' plans are raw
    // from-zero terms. Missing term_basis falls back to raw comparison.
    const effectiveMonths =
      c.term_basis === 'additive' ? c.coverage_months + Number(currentTermMonths) : c.coverage_months;
    const effectiveMiles =
      c.term_basis === 'additive' ? c.coverage_miles + Number(currentMiles) : c.coverage_miles;
    if (useTermRange) {
      if (!inRange(effectiveMonths, termRange)) return false;
    } else if (term != null) {
      if (effectiveMonths !== Number(term)) return false;
    }
    if (useMilesRange) {
      if (!inRange(effectiveMiles, milesRange)) return false;
    } else if (miles != null) {
      if (effectiveMiles !== Number(miles)) return false;
    }
    if (deductible != null && c.deductible !== Number(deductible)) return false;
    // Wave 23 Task 5c: rate-class chip filter ('new' | 'used'). Skip when
    // rateClass is null / 'all' — shows everything, including plans where
    // rate_class is null (fixture mode or pre-B1 proxy).
    if (rateClass && rateClass !== 'all' && c.rate_class !== rateClass) return false;
    return true;
  });

  const filtered = applyNewVsUsed(matches);
  return [...filtered].sort((a, b) => a.total_cost - b.total_cost);
}
