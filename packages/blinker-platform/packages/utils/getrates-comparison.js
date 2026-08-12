// getrates-comparison.js — Pure classifier for post-VIN SE GetRates divergence.
//
// Contract reference: architecture/17-vin-validate-rates-comparison.md
//
// Purpose:
//   Given two SE GetRates responses (YMMT-only baseline vs. VIN-attached), the
//   user's selected plan, vehicle metadata before/after VIN decode, and the org's
//   vin_validate margin config, returns one of 8 classified `kind` strings with
//   a kind-specific `detail` payload. The consumer (VinValidate.jsx) drives UX
//   routing; this function does zero I/O, React, or telemetry.
//
// Purity invariants:
//   - No imports from child apps.
//   - No network, localStorage, or side-effectful ops.
//   - Deterministic: same inputs always yield same output.
//
// Edge-case notes:
//   - vinRates missing / empty products   → plan_disappeared (available_plans=[]).
//   - selectedPlan missing                → no_change (caller shouldn't route here).
//   - vehicleBefore/After missing fields  → YMMT checks skipped; falls through
//     to plan-comparison branch.
//   - marginTolerancePct not a number     → defaults to 5 (matches canon default).
//   - ymmt_price === 0 or undefined       → divide-by-zero guard: no_change for
//     the price-delta branch.

// ---------- File-internal helpers -------------------------------------------

/**
 * Normalise a YMMT field value to a canonical comparison string.
 * @param {*} s
 * @returns {string}
 */
function normalizeYmmtField(s) {
  return String(s ?? '').trim().toLowerCase();
}

/**
 * Find a product in products[] whose (identity, coverage_period_months, mileage)
 * triple matches the supplied values. Identity is checked against EITHER the
 * product `id` OR the product `plan_code` — whichever the caller can supply on
 * the selected-plan side that has a matching non-empty value on the product side.
 *
 * Why both:
 *   - In fixture mode (`packages/integrations/product_admin/_fixtures/*.json`),
 *     products have a stable string `id` (e.g. "AAA_PTPLUS_HIGH_48_48000") and
 *     `plan_code: null`. RecommendedCoverage stores that `id` on the selected
 *     plan, so id-match is the only way to identify the user's pick in fixture
 *     mode.
 *   - In real SE proxy mode, products carry the SCS-XML `plan_code` (e.g.
 *     "AAA_PT_PLUS"), and the selected plan can carry that too. plan_code-match
 *     is preferred when both sides have one.
 *   - Either path needs to also match the (term_months, miles) pair so that
 *     two SKUs of the same plan family (e.g. 48mo/48k vs 60mo/50k) don't
 *     collapse onto each other.
 *
 * Match algorithm:
 *   1. If both sides have a non-empty id and they're equal → identity match.
 *   2. Else, if both sides have a non-empty plan_code and they're equal → identity match.
 *   3. Else, if neither side has any identifier (both empty) → identity match
 *      (legacy fixture-mode safety net; rarely reached in practice).
 *   4. Combine with exact (term_months, miles) match.
 *
 * @param {Array<object>} products
 * @param {string|null}   id          product id from selectedPlan.id
 * @param {string|null}   plan_code   plan_code from selectedPlan.plan_code
 * @param {number}        term_months
 * @param {number}        miles
 * @returns {object|null}
 */
function findProductByTriple(products, id, plan_code, term_months, miles) {
  if (!Array.isArray(products)) return null;
  const pid = id        == null ? '' : String(id);
  const pc  = plan_code == null ? '' : String(plan_code);
  const tm  = Number(term_months);
  const mi  = Number(miles);
  return (
    products.find((p) => {
      const ppid = p.id        == null ? '' : String(p.id);
      const ppc  = p.plan_code == null ? '' : String(p.plan_code);
      const idMatch = pid !== '' && ppid !== '' && ppid === pid;
      const pcMatch = pc  !== '' && ppc  !== '' && ppc  === pc;
      const bothEmpty = pid === '' && pc === '' && ppid === '' && ppc === '';
      const identityMatch = idMatch || pcMatch || bothEmpty;
      return (
        identityMatch &&
        Number(p.coverage_period_months) === tm &&
        Number(p.mileage) === mi
      );
    }) ?? null
  );
}

/**
 * Extract the customer-facing price from a product object.
 * Reads `base_price` (the canonical field in both fixture and proxy-normalised
 * shapes). Falls back to 0 so price math is always numeric.
 *
 * @param {object} product
 * @returns {number}
 */
function productPriceForPlan(product) {
  if (!product) return 0;
  const v = Number(product.base_price);
  return Number.isFinite(v) ? v : 0;
}

// ---------- Public API -------------------------------------------------------

/**
 * Classify how a second SE GetRates call (VIN-attached) diverges from the
 * original YMMT-only call. Returns one of 8 kinds per ADR 17.
 *
 * Pure — no I/O, no React, no telemetry. The consumer (VinValidate.jsx)
 * does the wiring and tracking.
 *
 * @param {object} params
 * @param {object}        params.ymmtRates          SE GetRates response (YMMT, no VIN).
 * @param {object}        params.vinRates            SE GetRates response (VIN).
 * @param {object}        params.selectedPlan        form.selectedPlan { plan_code, term_months, miles, ... }
 * @param {object}        params.vehicleBefore       { year, make, model, trim, vehicle_class }
 * @param {object}        params.vehicleAfter        { year, make, model, trim, vehicle_class }
 * @param {number}        params.marginTolerancePct  canon org.protection_billing.vin_validate.margin_tolerance_pct
 * @returns {{ kind: string, detail: object }}
 */
export function classifyRatesChange({
  ymmtRates,
  vinRates,
  selectedPlan,
  vehicleBefore,
  vehicleAfter,
  marginTolerancePct,
}) {
  // ── Edge: no selectedPlan — nothing to classify.
  if (!selectedPlan) {
    return { kind: 'no_change', detail: {} };
  }

  // ── Coerce tolerancePct (guard against null / NaN / undefined).
  const tolerance =
    typeof marginTolerancePct === 'number' && Number.isFinite(marginTolerancePct)
      ? marginTolerancePct
      : 5;

  // ── YMMT helpers — safe even when before/after are partially missing.
  const haveVehicleFields =
    vehicleBefore != null && vehicleAfter != null;

  function ymmtBefore() {
    return {
      year:  normalizeYmmtField(vehicleBefore?.year),
      make:  normalizeYmmtField(vehicleBefore?.make),
      model: normalizeYmmtField(vehicleBefore?.model),
      trim:  normalizeYmmtField(vehicleBefore?.trim),
    };
  }
  function ymmtAfter() {
    return {
      year:  normalizeYmmtField(vehicleAfter?.year),
      make:  normalizeYmmtField(vehicleAfter?.make),
      model: normalizeYmmtField(vehicleAfter?.model),
      trim:  normalizeYmmtField(vehicleAfter?.trim),
    };
  }

  // ── Precedence 1 + 2 combined: compare YMM and trim independently.
  //
  // ADR 17 definitions:
  //   ymmt_changed — (year, make, model, trim) differ, i.e. trim also drifts.
  //   ymm_changed  — (year, make, model) differ but trim is the SAME on both
  //                  sides (rare in practice — SE VIN decode usually carries
  //                  trim through, but the edge case is documented).
  //
  // We evaluate both SIMULTANEOUSLY so the precedence is: ymmt_changed fires
  // when YMM OR trim differs AND trim specifically drifted; ymm_changed fires
  // when YMM differs AND trim stayed the same.
  if (haveVehicleFields) {
    const b = ymmtBefore();
    const a = ymmtAfter();
    const ymmDiffers  = b.year !== a.year || b.make !== a.make || b.model !== a.model;
    const trimDiffers = b.trim !== a.trim;

    if (trimDiffers) {
      // Trim changed (with or without YMM change) → ymmt_changed (includes
      // the sub-case where ONLY trim drifts, i.e. same YMM, different trim).
      return {
        kind: 'ymmt_changed',
        detail: {
          ymmt_before: { year: vehicleBefore.year, make: vehicleBefore.make, model: vehicleBefore.model, trim: vehicleBefore.trim },
          ymmt_after:  { year: vehicleAfter.year,  make: vehicleAfter.make,  model: vehicleAfter.model,  trim: vehicleAfter.trim  },
        },
      };
    }

    if (ymmDiffers) {
      // YMM changed but trim is the same → ymm_changed.
      return {
        kind: 'ymm_changed',
        detail: {
          ymmt_before: { year: vehicleBefore.year, make: vehicleBefore.make, model: vehicleBefore.model, trim: vehicleBefore.trim },
          ymmt_after:  { year: vehicleAfter.year,  make: vehicleAfter.make,  model: vehicleAfter.model,  trim: vehicleAfter.trim  },
        },
      };
    }
  }

  // ── Precedence 3: vehicle_class_changed — same YMMT, different vehicle_class.
  if (haveVehicleFields) {
    const classBefore = normalizeYmmtField(vehicleBefore?.vehicle_class);
    const classAfter  = normalizeYmmtField(vehicleAfter?.vehicle_class);
    if (
      classBefore !== '' && classAfter !== '' &&
      classBefore !== classAfter
    ) {
      return {
        kind: 'vehicle_class_changed',
        detail: { class_before: vehicleBefore.vehicle_class, class_after: vehicleAfter.vehicle_class },
      };
    }
  }

  // ── Remaining branches require a plan triple and both products[] arrays.
  const vinProducts   = Array.isArray(vinRates?.products)  ? vinRates.products  : [];
  const ymmtProducts  = Array.isArray(ymmtRates?.products) ? ymmtRates.products : [];

  // Read both id and plan_code from selectedPlan; findProductByTriple will
  // prefer whichever identity field both sides actually carry. RecommendedCoverage
  // stores id (the product id) on selectedPlan.id, and plan_code (the SCS PlanCode,
  // null in fixture mode) on selectedPlan.plan_code.
  const { id, plan_code, term_months, miles } = selectedPlan;

  // ── Precedence 4: plan_disappeared — triple absent from vinRates.products[].
  const vinProduct = findProductByTriple(vinProducts, id, plan_code, term_months, miles);
  if (!vinProduct) {
    return {
      kind: 'plan_disappeared',
      detail: {
        selected_id:          id,
        selected_plan_code:   plan_code,
        selected_term_months: term_months,
        selected_miles:       miles,
        // Return raw products array; caller calls selectPlans() to bucket.
        available_plans:      vinProducts,
      },
    };
  }

  // ── Common sub-computation: find the YMMT counterpart for price delta.
  const ymmtProduct = findProductByTriple(ymmtProducts, id, plan_code, term_months, miles);
  const ymmtPrice   = productPriceForPlan(ymmtProduct);
  const vinPrice    = productPriceForPlan(vinProduct);

  // ── Divide-by-zero guard: if ymmt_price is 0/missing, skip price branches.
  if (ymmtPrice === 0) {
    return { kind: 'no_change', detail: {} };
  }

  const deltaPct = ((vinPrice - ymmtPrice) / ymmtPrice) * 100;

  // ── Precedence 5: plan_price_lower — vin_price < ymmt_price (strictly lower).
  if (vinPrice < ymmtPrice) {
    return {
      kind: 'plan_price_lower',
      detail: { selected_id: id, selected_plan_code: plan_code, ymmt_price: ymmtPrice, vin_price: vinPrice, delta_pct: deltaPct },
    };
  }

  // ── Precedence 8 (early exit): exact price match → no_change.
  // ADR 17 says no_change is "identity match on … plan price". delta_pct === 0
  // means prices are equal; there's no higher/lower branch to route to.
  if (deltaPct === 0) {
    return { kind: 'no_change', detail: {} };
  }

  // ── Precedence 6: within tolerance — 0 < delta_pct ≤ tolerance.
  if (deltaPct <= tolerance) {
    return {
      kind: 'plan_price_higher_within_tolerance',
      detail: { selected_id: id, selected_plan_code: plan_code, ymmt_price: ymmtPrice, vin_price: vinPrice, delta_pct: deltaPct },
    };
  }

  // ── Precedence 7: outside tolerance — delta_pct > tolerance.
  return {
    kind: 'plan_price_higher_outside_tolerance',
    detail: { selected_plan_code: plan_code, ymmt_price: ymmtPrice, vin_price: vinPrice, delta_pct: deltaPct },
  };

  // ── Precedence 8: no_change — covered by the early exit above and by the
  // ymmtPrice===0 guard (divide-by-zero returns no_change before reaching here).
}
