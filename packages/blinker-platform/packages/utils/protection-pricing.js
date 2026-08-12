// Protection-plan pricing math: cost → customer-facing price.
//
// Wave 22-fu — landed when real OMGA UAT GetRates surfaced `<Cost>907.00</Cost>`
// being shown to the customer as Total. The OMGA partner has zero markup
// configured at the SCS side (`MarkupMin`/`MarkupMax`/`AdminMarkup`/
// `BaseMarkup`/`FIMarkup` all 0), so the response's `RetailRate` equals the
// dealer cost. Blinker layers markup at the platform level — sourced from
// `canon/org-registry.json::orgs[].protection_billing.markup`.
//
// Contract:
//   computePlanPrice({ cost, regulated_rule_id, retail_rate }, { orgId, state })
//     → { price, markup_applied, regulation }
//
// Regulation matrix (per canon/plan-mappings.json::regulated_rules):
//   - 0 free_markup       → price = cost + org_markup
//   - 3 fixed_retail      → price = retail_rate (response-locked; markup ignored)
//   - 5 capped_markup     → price = cost + clamp(org_markup, MarkupMin, MarkupMax)
//   - 6 finance_capped    → price = cost + min(org_markup, MaxRetailRate - cost)
//   - null/undefined      → treated as 0 (free_markup) — defensive default
//
// Capped (5) + finance-capped (6) require the response's MarkupMin/MarkupMax
// (and MaxRetailRate for 6). Pass them in via `bounds`. When unspecified,
// degrade to "use response retail_rate as-is" (don't risk an out-of-spec
// price for a regulated rate).
//
// CHARTER: pure function. Reads canon/org-registry.json only.

import orgRegistry from '../../canon/org-registry.json' with { type: 'json' };

const FLORIDA_STATES = new Set(['FL', 'fl', 'Florida', 'FLORIDA']);

// Wave 22-fu5: hard ceiling on customer-facing plan price. Plans where
// `base_price > max_plan_price` are filtered out before Good/Better/Best
// tier selection. Org-configurable via
// `canon/org-registry.json::orgs[].protection_billing.max_plan_price`.
// Surfaced when real OMGA UAT returned 72-month rate-classes north of
// $6000 — those distorted BETTER selection toward outliers.
const DEFAULT_MAX_PLAN_PRICE = 4000;

function resolveOrgMarkup(orgId, state) {
  if (orgId == null) return 0;
  const org = (orgRegistry.orgs || []).find((o) => String(o.id) === String(orgId));
  const markup = org?.protection_billing?.markup;
  if (!markup) return 0;
  const isFL = state != null && FLORIDA_STATES.has(state);
  const v = isFL ? markup.florida_dollars : markup.default_dollars;
  return Number.isFinite(v) ? Number(v) : 0;
}

function clamp(n, lo, hi) {
  if (Number.isFinite(lo) && n < lo) return lo;
  if (Number.isFinite(hi) && n > hi) return hi;
  return n;
}

/**
 * @param {object} input
 * @param {number} input.cost                  TPA cost (SCS `<Cost>` / `<NetRate>`).
 * @param {number|null} [input.retail_rate]    SCS `<RetailRate>` — used for fixed_retail.
 * @param {number|null} [input.regulated_rule_id]
 * @param {object} [input.bounds]              { markup_min, markup_max, max_retail_rate }
 * @param {object} ctx
 * @param {string|number} ctx.orgId
 * @param {string|null} [ctx.state]            2-letter state for FL split.
 * @returns {{ price: number, markup_applied: number, regulation: string }}
 */
export function computePlanPrice(input, ctx) {
  const cost = Number(input?.cost) || 0;
  const retail_rate = input?.retail_rate != null ? Number(input.retail_rate) : null;
  const ruleId = input?.regulated_rule_id != null ? Number(input.regulated_rule_id) : 0;
  const bounds = input?.bounds || {};
  const orgMarkup = resolveOrgMarkup(ctx?.orgId, ctx?.state);

  if (ruleId === 3) {
    const price = retail_rate != null ? retail_rate : cost;
    return { price, markup_applied: Math.max(0, price - cost), regulation: 'fixed_retail' };
  }

  if (ruleId === 5) {
    const lo = Number(bounds.markup_min);
    const hi = Number(bounds.markup_max);
    const applied = clamp(orgMarkup, lo, hi);
    return { price: cost + applied, markup_applied: applied, regulation: 'capped_markup' };
  }

  if (ruleId === 6) {
    const cap = Number.isFinite(Number(bounds.max_retail_rate))
      ? Math.max(0, Number(bounds.max_retail_rate) - cost)
      : Infinity;
    const applied = Math.max(0, Math.min(orgMarkup, cap));
    return { price: cost + applied, markup_applied: applied, regulation: 'finance_capped' };
  }

  return { price: cost + orgMarkup, markup_applied: orgMarkup, regulation: 'free_markup' };
}

/**
 * Snapshot the org's markup config for telemetry / DevPanel display.
 * Returns null if the org isn't in canon.
 */
export function getOrgMarkupSnapshot(orgId) {
  if (orgId == null) return null;
  const org = (orgRegistry.orgs || []).find((o) => String(o.id) === String(orgId));
  const markup = org?.protection_billing?.markup;
  if (!markup) return null;
  return {
    default_dollars: Number(markup.default_dollars) || 0,
    florida_dollars: Number(markup.florida_dollars) || 0,
  };
}

/**
 * Per-org hard ceiling on customer-facing plan price (cost + markup).
 * Falls back to $4,000 when org isn't in canon or value is missing/invalid.
 *
 * @param {string|number|null|undefined} orgId
 * @returns {number} ceiling in dollars
 */
export function getOrgMaxPlanPrice(orgId) {
  if (orgId == null) return DEFAULT_MAX_PLAN_PRICE;
  const org = (orgRegistry.orgs || []).find((o) => String(o.id) === String(orgId));
  const v = Number(org?.protection_billing?.max_plan_price);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_PLAN_PRICE;
}

export const MAX_PLAN_PRICE_DEFAULT = DEFAULT_MAX_PLAN_PRICE;

// ─── Monthly-membership pricing (the 999999-sentinel VSC class) ──────────────
//
// Monthly-membership products (M2M / Residual / RAP) are billed as a recurring
// monthly charge, NOT a term-total. The StoneEagle response returns the plan
// across many month-by-month terms (1, 2, 3, …), each with its own per-month
// `<Cost>`. The org config picks WHICH term's cost is the basis and adds a flat
// per-plan markup. There is no down-payment and no finite months-to-pay.
//
// per-month charge = cost_at(term_to_use) + markup (FL split honored)
//
// Config: canon/org-registry.json::orgs[].protection_billing.monthly_membership
//   { enabled, default:{term_to_use, markup_dollars, florida_markup_dollars},
//     by_plan_code:{ "<code>": {…same…} }, discount:{max_percent,max_dollars,disabled_in_states} }
//
// computePlanPrice (above) is deliberately untouched — term plans never call
// this path, and monthly plans bypass getOrgMaxPlanPrice.
// See architecture/28-monthly-membership-vsc.md.

function resolveMonthlyConfig(orgId) {
  if (orgId == null) return null;
  const org = (orgRegistry.orgs || []).find((o) => String(o.id) === String(orgId));
  return org?.protection_billing?.monthly_membership || null;
}

/**
 * @param {object} args
 * @param {string|number} args.orgId
 * @param {string|null} [args.planCode]      bare PlanCode (e.g. '41') for the by_plan_code override.
 * @param {Array<{term:number, cost:number, rate?:number}>} args.monthlyTerms  per-term rows from the normalizer.
 * @param {string|null} [args.state]         2-letter state for FL markup split.
 * @returns {{ monthly_charge:number, term_used:number|null, term_requested:number|null,
 *             used_term_fallback:boolean, markup_applied:number, markup_regulation:string,
 *             cost_at_term:number, enabled:boolean }}
 */
export function resolveMonthlyMembershipPricing({ orgId, planCode = null, monthlyTerms = [], state = null } = {}) {
  const cfg = resolveMonthlyConfig(orgId);
  const base = cfg?.default || {};
  const perPlan = cfg?.by_plan_code && planCode != null ? cfg.by_plan_code[String(planCode)] : null;
  const resolved = { ...base, ...(perPlan || {}) };

  const termToUse = Number(resolved.term_to_use);
  const isFL = state != null && FLORIDA_STATES.has(state);
  const flMarkup = Number(resolved.florida_markup_dollars);
  const stdMarkup = Number(resolved.markup_dollars);
  const markup = isFL
    ? (Number.isFinite(flMarkup) ? flMarkup : (Number.isFinite(stdMarkup) ? stdMarkup : 0))
    : (Number.isFinite(stdMarkup) ? stdMarkup : 0);

  const terms = (Array.isArray(monthlyTerms) ? monthlyTerms : [])
    .filter((t) => t && Number.isFinite(Number(t.term)));
  let chosen = null;
  let usedFallback = false;
  if (terms.length) {
    chosen = terms.find((t) => Number(t.term) === termToUse) || null;
    if (!chosen) {
      usedFallback = true;
      // nearest available term to the configured one (deterministic tie-break: lower term wins)
      chosen = terms.slice().sort((a, b) => {
        const da = Math.abs(Number(a.term) - termToUse);
        const db = Math.abs(Number(b.term) - termToUse);
        return da !== db ? da - db : Number(a.term) - Number(b.term);
      })[0];
    }
  }

  const costAtTerm = chosen ? (Number(chosen.cost) || 0) : 0;
  const monthlyCharge = Math.round((costAtTerm + markup) * 100) / 100;

  return {
    monthly_charge: monthlyCharge,
    term_used: chosen ? Number(chosen.term) : null,
    term_requested: Number.isFinite(termToUse) ? termToUse : null,
    used_term_fallback: usedFallback,
    markup_applied: markup,
    markup_regulation: 'monthly_flat',
    cost_at_term: costAtTerm,
    enabled: cfg ? cfg.enabled !== false : false,
  };
}

/**
 * Snapshot the org's monthly-membership config for telemetry / DevPanel.
 * Returns null if the org isn't in canon or has no monthly_membership block.
 */
export function getOrgMonthlyMembershipSnapshot(orgId) {
  const cfg = resolveMonthlyConfig(orgId);
  if (!cfg) return null;
  return {
    enabled: cfg.enabled !== false,
    default: cfg.default || null,
    by_plan_code: cfg.by_plan_code || {},
    discount: cfg.discount || null,
  };
}
