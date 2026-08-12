// Unit tests for classifyRatesChange — uses Node built-in test runner.
// Run: node --test packages/utils/getrates-comparison.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRatesChange } from './getrates-comparison.js';

// ---------- Shared lightweight fixtures -------------------------------------

const VEHICLE_BASE = { year: 2025, make: 'Honda', model: 'Civic', trim: 'Sport', vehicle_class: 'used' };

const PLAN_A = { plan_code: 'OMEGA_EXCL', term_months: 48, miles: 50000 };

function makeProduct(overrides = {}) {
  return {
    id:                    'OMEGA_EXCL_48_50000',
    plan_code:             'OMEGA_EXCL',
    coverage_period_months: 48,
    mileage:               50000,
    base_price:            3293,
    monthly_price:         353,
    ...overrides,
  };
}

function makeRates(productOverrides = {}) {
  return {
    status: 'ok',
    request: { year: 2025, make: 'Honda', model: 'Civic', trim: 'Sport', mileage: 1500 },
    products: [makeProduct(productOverrides)],
  };
}

// ---------- Kind 8: no_change -----------------------------------------------

test('returns no_change when YMMT, class, plan list, and price all match', () => {
  const rates = makeRates();
  const result = classifyRatesChange({
    ymmtRates:        rates,
    vinRates:         rates,
    selectedPlan:     PLAN_A,
    vehicleBefore:    VEHICLE_BASE,
    vehicleAfter:     VEHICLE_BASE,
    marginTolerancePct: 5,
  });
  assert.equal(result.kind, 'no_change');
});

// ---------- Kind 1: ymmt_changed --------------------------------------------

test('returns ymmt_changed when trim differs', () => {
  const result = classifyRatesChange({
    ymmtRates:        makeRates(),
    vinRates:         makeRates(),
    selectedPlan:     PLAN_A,
    vehicleBefore:    { ...VEHICLE_BASE, trim: 'Sport' },
    vehicleAfter:     { ...VEHICLE_BASE, trim: 'Touring' },
    marginTolerancePct: 5,
  });
  assert.equal(result.kind, 'ymmt_changed');
  assert.deepEqual(result.detail.ymmt_before, { year: 2025, make: 'Honda', model: 'Civic', trim: 'Sport' });
  assert.deepEqual(result.detail.ymmt_after,  { year: 2025, make: 'Honda', model: 'Civic', trim: 'Touring' });
});

test('returns ymmt_changed when make AND trim differ', () => {
  const result = classifyRatesChange({
    ymmtRates:        makeRates(),
    vinRates:         makeRates(),
    selectedPlan:     PLAN_A,
    vehicleBefore:    { ...VEHICLE_BASE, make: 'Honda', trim: 'Sport' },
    vehicleAfter:     { ...VEHICLE_BASE, make: 'Toyota', trim: 'LE' },
    marginTolerancePct: 5,
  });
  assert.equal(result.kind, 'ymmt_changed');
});

// ---------- Kind 2: ymm_changed ---------------------------------------------

test('returns ymm_changed when model differs but trim is the same', () => {
  const result = classifyRatesChange({
    ymmtRates:        makeRates(),
    vinRates:         makeRates(),
    selectedPlan:     PLAN_A,
    vehicleBefore:    { ...VEHICLE_BASE, model: 'Civic',  trim: 'Sport' },
    vehicleAfter:     { ...VEHICLE_BASE, model: 'Accord', trim: 'Sport' },
    marginTolerancePct: 5,
  });
  assert.equal(result.kind, 'ymm_changed');
});

// ---------- Kind 3: vehicle_class_changed -----------------------------------

test('returns vehicle_class_changed when vehicle_class differs, YMMT same', () => {
  const result = classifyRatesChange({
    ymmtRates:        makeRates(),
    vinRates:         makeRates(),
    selectedPlan:     PLAN_A,
    vehicleBefore:    { ...VEHICLE_BASE, vehicle_class: 'used' },
    vehicleAfter:     { ...VEHICLE_BASE, vehicle_class: 'new' },
    marginTolerancePct: 5,
  });
  assert.equal(result.kind, 'vehicle_class_changed');
  assert.equal(result.detail.class_before, 'used');
  assert.equal(result.detail.class_after,  'new');
});

// ---------- Kind 4: plan_disappeared ----------------------------------------

test('returns plan_disappeared when selected plan triple absent from vinRates', () => {
  const vinRates = {
    status:   'ok',
    request:  {},
    products: [makeProduct({ plan_code: 'OTHER_PLAN', coverage_period_months: 60, mileage: 60000 })],
  };
  const result = classifyRatesChange({
    ymmtRates:        makeRates(),
    vinRates,
    selectedPlan:     PLAN_A,
    vehicleBefore:    VEHICLE_BASE,
    vehicleAfter:     VEHICLE_BASE,
    marginTolerancePct: 5,
  });
  assert.equal(result.kind, 'plan_disappeared');
  assert.equal(result.detail.selected_plan_code,   'OMEGA_EXCL');
  assert.equal(result.detail.selected_term_months, 48);
  assert.equal(result.detail.selected_miles,       50000);
  assert.ok(Array.isArray(result.detail.available_plans));
});

test('returns plan_disappeared when vinRates.products is empty', () => {
  const result = classifyRatesChange({
    ymmtRates:        makeRates(),
    vinRates:         { status: 'ok', products: [] },
    selectedPlan:     PLAN_A,
    vehicleBefore:    VEHICLE_BASE,
    vehicleAfter:     VEHICLE_BASE,
    marginTolerancePct: 5,
  });
  assert.equal(result.kind, 'plan_disappeared');
  assert.deepEqual(result.detail.available_plans, []);
});

// ---------- Kind 5: plan_price_lower ----------------------------------------

test('returns plan_price_lower when vin price is lower', () => {
  const result = classifyRatesChange({
    ymmtRates:        makeRates({ base_price: 3293 }),
    vinRates:         makeRates({ base_price: 2963 }),  // ~10% lower
    selectedPlan:     PLAN_A,
    vehicleBefore:    VEHICLE_BASE,
    vehicleAfter:     VEHICLE_BASE,
    marginTolerancePct: 5,
  });
  assert.equal(result.kind, 'plan_price_lower');
  assert.equal(result.detail.ymmt_price, 3293);
  assert.equal(result.detail.vin_price,  2963);
  assert.ok(result.detail.delta_pct < 0, `expected negative delta_pct, got ${result.detail.delta_pct}`);
});

test('returns no_change when vin price exactly equals ymmt price (identity match)', () => {
  const result = classifyRatesChange({
    ymmtRates:        makeRates({ base_price: 3293 }),
    vinRates:         makeRates({ base_price: 3293 }),
    selectedPlan:     PLAN_A,
    vehicleBefore:    VEHICLE_BASE,
    vehicleAfter:     VEHICLE_BASE,
    marginTolerancePct: 5,
  });
  // ADR 17 precedence 8: "identity match on … plan price" — exact equality is no_change.
  assert.equal(result.kind, 'no_change');
});

// ---------- Kind 6: plan_price_higher_within_tolerance ----------------------

test('returns plan_price_higher_within_tolerance for ~3% increase', () => {
  const ymmtPrice = 3293;
  const vinPrice  = Math.round(ymmtPrice * 1.03); // ~3%
  const result = classifyRatesChange({
    ymmtRates:        makeRates({ base_price: ymmtPrice }),
    vinRates:         makeRates({ base_price: vinPrice }),
    selectedPlan:     PLAN_A,
    vehicleBefore:    VEHICLE_BASE,
    vehicleAfter:     VEHICLE_BASE,
    marginTolerancePct: 5,
  });
  assert.equal(result.kind, 'plan_price_higher_within_tolerance');
  assert.ok(result.detail.delta_pct > 0 && result.detail.delta_pct <= 5);
});

// ---------- Kind 7: plan_price_higher_outside_tolerance ---------------------

test('returns plan_price_higher_outside_tolerance for ~12% increase', () => {
  const ymmtPrice = 3293;
  const vinPrice  = Math.round(ymmtPrice * 1.12); // ~12%
  const result = classifyRatesChange({
    ymmtRates:        makeRates({ base_price: ymmtPrice }),
    vinRates:         makeRates({ base_price: vinPrice }),
    selectedPlan:     PLAN_A,
    vehicleBefore:    VEHICLE_BASE,
    vehicleAfter:     VEHICLE_BASE,
    marginTolerancePct: 5,
  });
  assert.equal(result.kind, 'plan_price_higher_outside_tolerance');
  assert.ok(result.detail.delta_pct > 5);
});

// ---------- Edge cases -------------------------------------------------------

test('returns no_change when selectedPlan is missing', () => {
  const result = classifyRatesChange({
    ymmtRates:        makeRates(),
    vinRates:         makeRates(),
    selectedPlan:     null,
    vehicleBefore:    VEHICLE_BASE,
    vehicleAfter:     VEHICLE_BASE,
    marginTolerancePct: 5,
  });
  assert.equal(result.kind, 'no_change');
});

test('returns no_change when selectedPlan is undefined', () => {
  const result = classifyRatesChange({
    ymmtRates:        makeRates(),
    vinRates:         makeRates(),
    vehicleBefore:    VEHICLE_BASE,
    vehicleAfter:     VEHICLE_BASE,
    marginTolerancePct: 5,
  });
  assert.equal(result.kind, 'no_change');
});

test('divide-by-zero guard: returns no_change when ymmt_price is 0', () => {
  const result = classifyRatesChange({
    ymmtRates:        makeRates({ base_price: 0 }),
    vinRates:         makeRates({ base_price: 3293 }),
    selectedPlan:     PLAN_A,
    vehicleBefore:    VEHICLE_BASE,
    vehicleAfter:     VEHICLE_BASE,
    marginTolerancePct: 5,
  });
  assert.equal(result.kind, 'no_change');
});

test('uses default tolerance of 5 when marginTolerancePct is not a number', () => {
  const ymmtPrice = 3293;
  const vinPrice  = Math.round(ymmtPrice * 1.04); // 4% — within default 5%
  const result = classifyRatesChange({
    ymmtRates:        makeRates({ base_price: ymmtPrice }),
    vinRates:         makeRates({ base_price: vinPrice }),
    selectedPlan:     PLAN_A,
    vehicleBefore:    VEHICLE_BASE,
    vehicleAfter:     VEHICLE_BASE,
    marginTolerancePct: null,   // not a number → should default to 5
  });
  assert.equal(result.kind, 'plan_price_higher_within_tolerance');
});

test('returns plan_disappeared when vinRates is null', () => {
  const result = classifyRatesChange({
    ymmtRates:        makeRates(),
    vinRates:         null,
    selectedPlan:     PLAN_A,
    vehicleBefore:    VEHICLE_BASE,
    vehicleAfter:     VEHICLE_BASE,
    marginTolerancePct: 5,
  });
  assert.equal(result.kind, 'plan_disappeared');
  assert.deepEqual(result.detail.available_plans, []);
});

test('skips YMMT check and falls through to plan-comparison when vehicleBefore is null', () => {
  // With no vehicleBefore/vehicleAfter, ymmt/class checks are skipped.
  // vin price is lower → plan_price_lower
  const result = classifyRatesChange({
    ymmtRates:        makeRates({ base_price: 3293 }),
    vinRates:         makeRates({ base_price: 2963 }),
    selectedPlan:     PLAN_A,
    vehicleBefore:    null,
    vehicleAfter:     null,
    marginTolerancePct: 5,
  });
  assert.equal(result.kind, 'plan_price_lower');
});

// ---------- Identity match: id-only path (fixture mode) --------------------
//
// Regression: production fixtures (packages/integrations/product_admin/_fixtures/
// stone-eagle-get-rates*.json) carry a stable `id` per product but `plan_code: null`,
// because they predate real SCS PlanCode capture. RecommendedCoverage.jsx stores
// `plan.id` on selectedPlan as the product identifier. Pre-fix, classifier compared
// only on plan_code → fixture-mode always returned plan_disappeared regardless of
// what the user picked. These tests pin down the id-match path that fixes that.

test('matches by id when both sides have id and plan_code is null (fixture-mode shape)', () => {
  // Mirror the actual fixture shape: id present, plan_code null on both sides.
  const ymmtProduct = makeProduct({ id: 'AAA_PT_PLUS_HIGH_48_48000', plan_code: null, coverage_period_months: 48, mileage: 48000, base_price: 2895 });
  const vinProduct  = makeProduct({ id: 'AAA_PT_PLUS_HIGH_48_48000', plan_code: null, coverage_period_months: 48, mileage: 48000, base_price: 2895 });
  const selectedPlan = { id: 'AAA_PT_PLUS_HIGH_48_48000', plan_code: null, term_months: 48, miles: 48000 };
  const result = classifyRatesChange({
    ymmtRates:        { products: [ymmtProduct] },
    vinRates:         { products: [vinProduct] },
    selectedPlan,
    vehicleBefore:    VEHICLE_BASE,
    vehicleAfter:     VEHICLE_BASE,
    marginTolerancePct: 5,
  });
  assert.equal(result.kind, 'no_change',
    'should find the product by id when plan_code is null on both sides');
});

test('plan_disappeared fires only when id is genuinely absent from vinRates (fixture-mode)', () => {
  // Two products in YMMT; remove the user's pick from vinRates by id.
  const goodProduct = makeProduct({ id: 'AAA_PT_PLUS_HIGH_48_48000', plan_code: null, coverage_period_months: 48, mileage: 48000, base_price: 2895 });
  const bestProduct = makeProduct({ id: 'OMEGA_USED_STATED_48_50000', plan_code: null, coverage_period_months: 48, mileage: 50000, base_price: 3527 });
  const selectedPlan = { id: 'OMEGA_USED_STATED_48_50000', plan_code: null, term_months: 48, miles: 50000 };
  const result = classifyRatesChange({
    ymmtRates:        { products: [goodProduct, bestProduct] },
    vinRates:         { products: [goodProduct] }, // bestProduct removed
    selectedPlan,
    vehicleBefore:    VEHICLE_BASE,
    vehicleAfter:     VEHICLE_BASE,
    marginTolerancePct: 5,
  });
  assert.equal(result.kind, 'plan_disappeared');
  assert.equal(result.detail.selected_id, 'OMEGA_USED_STATED_48_50000');
});

test('does NOT fire plan_disappeared when user-picked id is still present (fixture-mode regression)', () => {
  // The actual reported bug: user picked GOOD = AAA_PT_PLUS_HIGH; plan_disappeared
  // fixture removes a different id. Pre-fix, classifier returned plan_disappeared
  // because plan_code-comparison ('' vs 'AAA_PT_PLUS_HIGH_48_48000') failed.
  const goodProduct = makeProduct({ id: 'AAA_PT_PLUS_HIGH_48_48000', plan_code: null, coverage_period_months: 48, mileage: 48000, base_price: 2895 });
  const selectedPlan = { id: 'AAA_PT_PLUS_HIGH_48_48000', plan_code: null, term_months: 48, miles: 48000 };
  const result = classifyRatesChange({
    ymmtRates:        { products: [goodProduct] },
    vinRates:         { products: [goodProduct] }, // user's pick still here
    selectedPlan,
    vehicleBefore:    VEHICLE_BASE,
    vehicleAfter:     VEHICLE_BASE,
    marginTolerancePct: 5,
  });
  assert.equal(result.kind, 'no_change',
    'classifier must NOT report plan_disappeared when the user-picked id is still in vinRates');
});

test('id wins when both id and plan_code are present and disagree (id is the more reliable identity)', () => {
  // Theoretical edge: real-mode product carries both id and a plan_code that may
  // differ between calls. id is the stable per-product identifier from our normalizer,
  // so id-match should win.
  const product = makeProduct({ id: 'STABLE_ID_X', plan_code: 'NEW_CODE', coverage_period_months: 48, mileage: 50000, base_price: 3293 });
  const selectedPlan = { id: 'STABLE_ID_X', plan_code: 'OLD_CODE', term_months: 48, miles: 50000 };
  const result = classifyRatesChange({
    ymmtRates:        { products: [product] },
    vinRates:         { products: [product] },
    selectedPlan,
    vehicleBefore:    VEHICLE_BASE,
    vehicleAfter:     VEHICLE_BASE,
    marginTolerancePct: 5,
  });
  assert.equal(result.kind, 'no_change');
});

test('falls back to plan_code match when id is missing on one side', () => {
  // Mixed: selectedPlan has plan_code only (no id), product has both. plan_code wins.
  const product = makeProduct({ id: 'PRODUCT_ID', plan_code: 'OMEGA_EXCL', coverage_period_months: 48, mileage: 50000, base_price: 3293 });
  const selectedPlan = { id: null, plan_code: 'OMEGA_EXCL', term_months: 48, miles: 50000 };
  const result = classifyRatesChange({
    ymmtRates:        { products: [product] },
    vinRates:         { products: [product] },
    selectedPlan,
    vehicleBefore:    VEHICLE_BASE,
    vehicleAfter:     VEHICLE_BASE,
    marginTolerancePct: 5,
  });
  assert.equal(result.kind, 'no_change');
});
