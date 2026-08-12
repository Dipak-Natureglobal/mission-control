// Protection-portal add-on matching + cost passthrough.
//
// Single source of truth for the v3.0.4 PDF tasks 1, 2, 4 ("when StoneEagle
// returns an option whose name matches one of these canonical strings, treat
// it as a passthrough add-on — add the cost without markup, render a badge
// on the coverage card"). Reads canon/plan-mappings.json#add_on_passthrough
// at module load.
//
// Two distinct match surfaces:
//   - rates.add_ons[]                  — separately-quoted options the user
//                                        could opt into (e.g. BUSINESS USE
//                                        when rideshare/commercial is picked,
//                                        EEP when "Enhanced Electronics" is
//                                        flagged on Modifications).
//   - product.add_ons_included[]       — options BUNDLED in the plan price
//                                        (e.g. EXT_MAINT_ANNUAL — show a
//                                        "Maintenance Feature included" badge
//                                        but no price change).
//
// Two passthrough modes:
//   - cost_passthrough=true            — sum the matched add-on price_deltas
//                                        into a totalDelta the card displays
//                                        as "+ $X". Markup not applied.
//   - cost_passthrough=false           — informational badge only.
//
// CHARTER: pure functions. No React, no network. Reads canon JSON only.
// Matches the dep-direction rule for packages/utils.

import planMappings from '../../canon/plan-mappings.json' with { type: 'json' };

const PASSTHROUGH = planMappings.add_on_passthrough || {};

/**
 * Case-insensitive substring match. Returns true when needle appears anywhere
 * in haystack — both sides normalized to lowercase + trimmed. Either side can
 * be the longer string (a haystack of "BUSINESS USE option" matches a needle
 * "business use", and vice versa).
 *
 * @param {string} haystack
 * @param {string} needle
 * @returns {boolean}
 */
function softIncludes(haystack, needle) {
  if (!haystack || !needle) return false;
  const a = String(haystack).toLowerCase().trim();
  const b = String(needle).toLowerCase().trim();
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * Test whether a single add-on name matches any of the canonical strings for
 * a passthrough key.
 *
 * @param {string} addOnName
 * @param {string[]} canonicalNames
 * @returns {boolean}
 */
export function matchAddOnByName(addOnName, canonicalNames) {
  if (!addOnName || !Array.isArray(canonicalNames)) return false;
  return canonicalNames.some((c) => softIncludes(addOnName, c));
}

/**
 * Look up an add-on in rates.add_ons[] by name match against canonical
 * strings, return its price_delta (0 when not found or surcharge=true).
 *
 * @param {string[]} canonicalNames
 * @param {object} rates                 — StoneEagle GetRates response
 * @returns {number} price delta (dollars; 0 when no match)
 */
export function resolveAddOnDelta(canonicalNames, rates) {
  const addOns = rates?.add_ons || [];
  for (const ao of addOns) {
    if (matchAddOnByName(ao.name, canonicalNames)) {
      return Number(ao.price_delta || 0);
    }
  }
  return 0;
}

/**
 * Test whether any entry in the included list matches one of the canonical
 * names. The included list often carries IDs (e.g. 'EXT_MAINT_ANNUAL'), not
 * display names — so we ALSO dereference each ID against rates.add_ons[] and
 * try matching that entry's name. Both forms succeed: pure-name lists work
 * AND ID lists with a populated rates.add_ons[] catalog work.
 *
 * @param {string[]} included            — product.add_ons_included
 * @param {string[]} canonicalNames
 * @param {object} rates                 — for ID dereferencing
 * @returns {boolean}
 */
function anyIncludedMatches(included, canonicalNames, rates) {
  if (!Array.isArray(included)) return false;
  const addOnsCatalog = (rates?.add_ons || []);
  return included.some((entry) => {
    if (matchAddOnByName(entry, canonicalNames)) return true;
    const ref = addOnsCatalog.find((ao) => ao.id === entry);
    return ref ? matchAddOnByName(ref.name, canonicalNames) : false;
  });
}

/**
 * Resolve which passthrough keys are TRIGGERED by the current wizard state
 * + a specific plan. Triggers are documented as strings in canon for human
 * readers; the predicates are encoded here because they reference form fields
 * that don't belong in canon.
 *
 * @param {object} args
 * @param {object} args.form    — protection-portal wizard form state
 * @param {object} args.product — single plan/product from rates.products[]
 * @returns {string[]} keys that fired (e.g. ['business_use','extended_maintenance'])
 */
export function triggeredPassthroughKeys({ form, rates, product }) {
  const fired = [];
  // ADR 28 — monthly-membership plans do NOT carry add-on passthroughs. Real
  // OMGA GetRates returns no option rows for the M2M/Residual/RAP plans, and a
  // one-time add-on cost can't be layered onto a flat recurring monthly charge.
  // Conditional passthroughs (enhanced_electronics / navigation / business_use)
  // would otherwise leak onto a monthly card because they key off form state +
  // the GLOBAL add_ons[] catalog (populated by the term plans), not the plan's
  // own options. Suppress everything for monthly.
  if (product?.billing_model === 'monthly_subscription') return fired;
  const f = form || {};
  const requiredAddOns = Array.isArray(f.requiredAddOns) ? f.requiredAddOns : [];
  const modifications = Array.isArray(f.modifications) ? f.modifications : [];
  const includedOnPlan = product?.add_ons_included || [];

  for (const [key, def] of Object.entries(PASSTHROUGH)) {
    if (key.startsWith('_')) continue;
    let on = false;
    if (key === 'business_use') {
      on = f.use === 'rideshare' || f.use === 'commercial' || requiredAddOns.includes('business_use');
    } else if (key === 'enhanced_electronics') {
      on = modifications.includes('enhanced_electronics');
    } else if (key === 'navigation') {
      on = modifications.includes('navigation');
    } else if (key === 'extended_maintenance') {
      // Always-on when the plan bundles it.
      on = anyIncludedMatches(includedOnPlan, def.match_names, rates);
    }
    if (on) fired.push(key);
  }
  return fired;
}

/**
 * Build the per-plan passthrough result: total cost delta + badge list.
 *
 * The shape is what RecommendedCoverage / Customize pass to PlanCard:
 *
 *   {
 *     totalDelta: number,                    // dollars added to base price
 *     badges: [{ key, label, deltaCost }]    // chip rows under plan name
 *   }
 *
 * Badges with cost_passthrough=false carry deltaCost=null (informational).
 * Cost passthrough adds rates.add_ons[name].price_delta (NOT marked up).
 *
 * @param {object} args
 * @param {object} args.form    — wizard form
 * @param {object} args.rates   — full GetRates response
 * @param {object} args.product — single product/plan
 * @returns {{ totalDelta: number, badges: Array<{ key: string, label: string, deltaCost: number|null }> }}
 */
export function buildPassthroughForPlan({ form, rates, product }) {
  const keys = triggeredPassthroughKeys({ form, rates, product });
  const badges = [];
  let totalDelta = 0;

  for (const key of keys) {
    const def = PASSTHROUGH[key];
    if (!def) continue;
    if (def.cost_passthrough) {
      const delta = resolveAddOnDelta(def.match_names, rates);
      totalDelta += delta;
      badges.push({ key, label: def.badge, deltaCost: delta });
    } else {
      badges.push({ key, label: def.badge, deltaCost: null });
    }
  }

  return { totalDelta, badges };
}

// Exported for diagnostics + super_admin debug surfaces only.
export { PASSTHROUGH as __passthroughCanon };
