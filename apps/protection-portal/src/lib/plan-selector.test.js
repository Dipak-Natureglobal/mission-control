// Unit tests for plan-selector.js — uses Node built-in test runner.
// Run: node --test src/lib/plan-selector.test.js
//
// Coverage focus (Wave 38 — monthly-membership):
//   (a) TERM plans with NO billing_model field still tier EXACTLY as before
//       (missing billing_model ⇒ term_total; tiering + counts unchanged).
//   (b) MONTHLY products (synthetic shape) are NOT dropped and classify
//       good/better/best by tier_hint/catalog — not always "good".
//   (c) listMatchingPlans mode='monthly' returns ONLY monthly products,
//       sorted by monthly_charge ascending.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPlans, listMatchingPlans, billingModel } from './plan-selector.js';

const VEHICLE = { year: 2022, mileage: 40000 };

// --- Term-plan fixtures: NO billing_model field (fixture-mode shape) --------
// Names chosen so quality() lands one product cleanly per tier:
//   "POWERTRAIN"  → good
//   "POWERTRAIN PLUS" → better
//   "EXCLUSIONARY" → best
function termProduct(overrides = {}) {
  return {
    id: 'term_1',
    name: 'POWERTRAIN',
    provider: 'OMGA',
    coverage_period_months: 36,
    mileage: 50000,
    deductible: 100,
    base_price: 2000,
    monthly_price: 60,
    // NOTE: intentionally NO billing_model field.
    ...overrides,
  };
}

function termRates() {
  return {
    products: [
      termProduct({ id: 'good_1', name: 'POWERTRAIN', base_price: 1800 }),
      termProduct({ id: 'better_1', name: 'POWERTRAIN PLUS', base_price: 2400 }),
      termProduct({ id: 'best_1', name: 'EXCLUSIONARY COVERAGE', base_price: 3000 }),
    ],
  };
}

// --- Monthly fixtures: synthetic monthly-membership shape -------------------
function monthlyProduct(overrides = {}) {
  return {
    id: 'monthly_x',
    name: 'AAA Monthly',
    provider: 'OMGA',
    tpa_code: 'OMGA',
    product_type_code: 'VSC',
    billing_model: 'monthly_subscription',
    monthly_charge: 59,
    coverage_period_months: 12,
    mileage: null,
    unlimited_mileage: true,
    deductible: 100,
    base_price: 59,
    monthly_price: 59,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// (a) Term plans with no billing_model field — tiering + counts unchanged
// ---------------------------------------------------------------------------

test('billingModel() defaults missing/undefined field to term_total', () => {
  assert.equal(billingModel({}), 'term_total');
  assert.equal(billingModel({ billing_model: undefined }), 'term_total');
  assert.equal(billingModel({ billing_model: null }), 'term_total');
  assert.equal(billingModel({ billing_model: 'term_total' }), 'term_total');
  assert.equal(billingModel({ billing_model: 'monthly_subscription' }), 'monthly_subscription');
});

test('term plans with no billing_model field still classify good/better/best', () => {
  const { plans, monthly, hasMonthly } = selectPlans({ rates: termRates(), vehicle: VEHICLE });
  assert.equal(plans.good.id, 'good_1');
  assert.equal(plans.better.id, 'better_1');
  assert.equal(plans.best.id, 'best_1');
  // No monthly products present.
  assert.equal(hasMonthly, false);
  assert.equal(monthly, null);
});

test('term candidates carry billing_model term_total + null monthly fields', () => {
  const { plans } = selectPlans({ rates: termRates(), vehicle: VEHICLE });
  for (const tier of ['good', 'better', 'best']) {
    assert.equal(plans[tier].billing_model, 'term_total');
    assert.equal(plans[tier].monthly_charge, null);
  }
});

// ---------------------------------------------------------------------------
// (b) Monthly products are not dropped and classify by tier_hint/catalog
// ---------------------------------------------------------------------------

test('monthly products are surfaced (hasMonthly=true) and not dropped', () => {
  const rates = {
    products: [
      monthlyProduct({ id: 'm_good', plan_code: '901', tier_hint: 'good', monthly_charge: 59, name: 'AAA Powertrain Monthly' }),
      monthlyProduct({ id: 'm_better', plan_code: '902', tier_hint: 'better', monthly_charge: 74, name: 'AAA Used Stated Monthly' }),
      monthlyProduct({ id: 'm_best', plan_code: '903', tier_hint: 'best', monthly_charge: 92, name: 'AAA Enhanced Monthly' }),
    ],
  };
  const { monthly, hasMonthly } = selectPlans({ rates, vehicle: VEHICLE });
  assert.equal(hasMonthly, true);
  assert.ok(monthly);
  // Classified by tier_hint — NOT collapsed to all-good.
  assert.equal(monthly.good.id, 'm_good');
  assert.equal(monthly.better.id, 'm_better');
  assert.equal(monthly.best.id, 'm_best');
});

test('monthly classification uses tier_hint even when names all name-match to good', () => {
  // All three names map to "good" via quality() substring match, but tier_hint
  // differs — the classifier must NOT collapse them to all-good.
  // Uses synthetic plan codes NOT in the catalog so tier_hint is the decisive factor.
  const rates = {
    products: [
      monthlyProduct({ id: 'a', plan_code: '901', tier_hint: 'good', name: 'POWERTRAIN monthly', monthly_charge: 50 }),
      monthlyProduct({ id: 'b', plan_code: '902', tier_hint: 'better', name: 'POWERTRAIN monthly', monthly_charge: 70 }),
      monthlyProduct({ id: 'c', plan_code: '903', tier_hint: 'best', name: 'POWERTRAIN monthly', monthly_charge: 90 }),
    ],
  };
  const { monthly } = selectPlans({ rates, vehicle: VEHICLE });
  assert.equal(monthly.good.id, 'a');
  assert.equal(monthly.better.id, 'b');
  assert.equal(monthly.best.id, 'c');
});

test('monthly candidates carry monthly_charge + billing_model monthly_subscription', () => {
  const rates = { products: [monthlyProduct({ id: 'm', plan_code: '40', tier_hint: 'good', monthly_charge: 59 })] };
  const { monthly } = selectPlans({ rates, vehicle: VEHICLE });
  assert.equal(monthly.good.billing_model, 'monthly_subscription');
  assert.equal(monthly.good.monthly_charge, 59);
});

test('term + monthly mixed rates: term path unaffected, monthly path parallel', () => {
  const rates = {
    products: [
      ...termRates().products,
      monthlyProduct({ id: 'm_good', plan_code: '901', tier_hint: 'good', monthly_charge: 59 }),
      monthlyProduct({ id: 'm_best', plan_code: '903', tier_hint: 'best', monthly_charge: 92 }),
    ],
  };
  const { plans, monthly, hasMonthly } = selectPlans({ rates, vehicle: VEHICLE });
  // Term picks unchanged (monthly products excluded from term path).
  assert.equal(plans.good.id, 'good_1');
  assert.equal(plans.better.id, 'better_1');
  assert.equal(plans.best.id, 'best_1');
  // Monthly parallel set.
  assert.equal(hasMonthly, true);
  assert.equal(monthly.good.id, 'm_good');
  assert.equal(monthly.best.id, 'm_best');
  assert.equal(monthly.better, null); // no better-tier monthly product supplied
});

// ---------------------------------------------------------------------------
// (c) listMatchingPlans mode='monthly'
// ---------------------------------------------------------------------------

test("listMatchingPlans mode='monthly' returns only monthly, sorted by monthly_charge asc", () => {
  const rates = {
    products: [
      ...termRates().products, // term plans must be excluded
      monthlyProduct({ id: 'm_92', plan_code: '903', tier_hint: 'good', monthly_charge: 92, deductible: 100 }),
      monthlyProduct({ id: 'm_59', plan_code: '901', tier_hint: 'good', monthly_charge: 59, deductible: 100 }),
      monthlyProduct({ id: 'm_74', plan_code: '902', tier_hint: 'good', monthly_charge: 74, deductible: 100 }),
    ],
  };
  const list = listMatchingPlans({
    rates,
    vehicle: VEHICLE,
    tier: 'good',
    deductible: 100,
    mode: 'monthly',
  });
  // Only monthly products, sorted ascending by monthly_charge.
  assert.deepEqual(list.map((p) => p.id), ['m_59', 'm_74', 'm_92']);
  assert.ok(list.every((p) => p.billing_model === 'monthly_subscription'));
});

test("listMatchingPlans mode='monthly' keeps the deductible filter", () => {
  const rates = {
    products: [
      monthlyProduct({ id: 'd100', plan_code: '40', tier_hint: 'good', monthly_charge: 59, deductible: 100 }),
      monthlyProduct({ id: 'd0', plan_code: '40', tier_hint: 'good', monthly_charge: 50, deductible: 0 }),
    ],
  };
  const list = listMatchingPlans({ rates, vehicle: VEHICLE, tier: 'good', deductible: 100, mode: 'monthly' });
  assert.deepEqual(list.map((p) => p.id), ['d100']);
});

test("listMatchingPlans default mode='term' excludes monthly products", () => {
  const rates = {
    products: [
      termProduct({ id: 'good_1', name: 'POWERTRAIN', coverage_period_months: 36, mileage: 50000, deductible: 100 }),
      monthlyProduct({ id: 'm', plan_code: '40', tier_hint: 'good', monthly_charge: 59, deductible: 100 }),
    ],
  };
  const list = listMatchingPlans({ rates, vehicle: VEHICLE, tier: 'good', deductible: 100 });
  assert.deepEqual(list.map((p) => p.id), ['good_1']);
});

// ---------------------------------------------------------------------------
// (d) Catalog-wins: real OMGA::VSC codes 41/42/R6 with conflicting tier_hint
// ---------------------------------------------------------------------------

test('monthly classification: canon plan_catalog level WINS over tier_hint for real codes (41/R6 good, 42 better)', () => {
  // Real OMGA::VSC codes: 41=good, 42=better, R6=good in the catalog.
  // tier_hint intentionally set to a DIFFERENT value to prove catalog wins.
  const rates = {
    products: [
      // tier_hint says 'best', catalog says 'good' → should land in good
      monthlyProduct({ id: 'p_41', plan_code: '41', tpa_code: 'OMGA', product_type_code: 'VSC', tier_hint: 'best',   monthly_charge: 59 }),
      // tier_hint says 'best', catalog says 'better' → should land in better
      monthlyProduct({ id: 'p_42', plan_code: '42', tpa_code: 'OMGA', product_type_code: 'VSC', tier_hint: 'best',   monthly_charge: 74 }),
      // tier_hint says 'better', catalog says 'good' → should land in good (lowest charge wins slot)
      monthlyProduct({ id: 'p_r6', plan_code: 'R6', tpa_code: 'OMGA', product_type_code: 'VSC', tier_hint: 'better', monthly_charge: 49 }),
    ],
  };
  const { monthly, hasMonthly } = selectPlans({ rates, vehicle: VEHICLE });
  assert.equal(hasMonthly, true);
  assert.ok(monthly);
  // good slot: two candidates (41 @ $59, R6 @ $49) — selectMonthlyForTier sorts by
  // monthly_charge asc, so R6 ($49) wins the good slot.
  assert.equal(monthly.good.id, 'p_r6');
  // better slot: only p_42 classified here by catalog.
  assert.equal(monthly.better.id, 'p_42');
  // best slot: no product lands here after catalog override, so it stays null.
  assert.equal(monthly.best, null);
});
