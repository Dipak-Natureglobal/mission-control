// Home pricing — Node built-in test runner.
// Run: node --test packages/utils/home-pricing.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveHomePlanPrice, resolveHomeAddOnPrice, getAddOnMarkupPercent,
  getHomePaymentTermOptions, computeHomePaymentPlan, computeHomePriceRange,
  getHomeDiscountCaps, applyAddOnDiscount,
} from './home-pricing.js';

const ORG = 102;

test('plan price adds the flat home markup', () => {
  const r = resolveHomePlanPrice({ orgId: ORG, basePrice: 1425, state: 'GA' });
  assert.equal(r.price, 1725);
  assert.equal(r.markup_applied, 300);
});

test('Florida takes the FL markup split', () => {
  assert.equal(resolveHomePlanPrice({ orgId: ORG, basePrice: 1425, state: 'FL' }).price, 1710);
});

test('add-on retail applies the configured percent', () => {
  assert.equal(getAddOnMarkupPercent(ORG), 0.30);
  assert.equal(resolveHomeAddOnPrice({ orgId: ORG, cost: 23 }).price, 29.9);
  assert.equal(resolveHomeAddOnPrice({ orgId: ORG, cost: 210 }).price, 273);
});

test('a whole-percent misconfiguration degrades sanely, not 3000%', () => {
  // guard inside getAddOnMarkupPercent: >1 is read as a whole percent
  assert.equal(resolveHomeAddOnPrice({ orgId: ORG, cost: 100 }).price, 130);
});

test('payment-term options are per coverage term', () => {
  const t12 = getHomePaymentTermOptions({ orgId: ORG, coverageTermMonths: 12 });
  assert.deepEqual(t12.options_months, [1, 6]);
  assert.equal(t12.default_months, 6);
  assert.equal(t12.source, 'by_coverage_term');

  const t48 = getHomePaymentTermOptions({ orgId: ORG, coverageTermMonths: 48 });
  assert.deepEqual(t48.options_months, [1, 6, 12]);
  assert.equal(t48.default_months, 12);
});

test('an unmapped coverage term falls back to the flat list', () => {
  const t = getHomePaymentTermOptions({ orgId: ORG, coverageTermMonths: 60 });
  assert.equal(t.source, 'fallback');
  assert.deepEqual(t.options_months, [1, 6, 12]);
});

test('down payment equals one monthly payment', () => {
  const p = computeHomePaymentPlan({ total: 1300, monthsToPay: 12 });
  assert.equal(p.monthly, 100);          // 1300 / 13
  assert.equal(p.down_payment, 100);
  assert.equal(p.financed, 1200);
  // the identity that makes it work
  assert.equal(p.down_payment + p.monthly * p.months_to_pay, p.total);
});

test('one-payment term collapses to half up front, half after', () => {
  const p = computeHomePaymentPlan({ total: 1000, monthsToPay: 1 });
  assert.equal(p.monthly, 500);
  assert.equal(p.down_payment, 500);
});

test('price range spans plan-only to plan-plus-implied-add-ons', () => {
  const r = computeHomePriceRange({
    orgId: ORG,
    basePrice: 1425,
    coverageTermMonths: 48,
    state: 'GA',
    impliedAddOns: [{ key: 'ice_maker', price: 23 }, { key: 'septic', price: 13 }],
  });
  assert.equal(r.low, 1725);                       // 1425 + 300
  assert.equal(r.addOnTotal, 46.8);                // (23 + 13) x 1.30
  assert.equal(r.high, 1771.8);
  assert.equal(r.hasRange, true);
  assert.equal(r.monthsToPay, 12);                 // org default for 48 mo
  assert.equal(r.lowMonthly, 132.69);              // 1725 / 13
  assert.equal(r.highMonthly, 136.29);
  assert.equal(r.downPaymentLow, r.lowMonthly);
});

test('no implied add-ons means no range', () => {
  const r = computeHomePriceRange({ orgId: ORG, basePrice: 1425, coverageTermMonths: 48, impliedAddOns: [] });
  assert.equal(r.hasRange, false);
  assert.equal(r.low, r.high);
});

// ---------- the cost floor ---------------------------------------------------

test('add-on discount cap is clamped to break-even, not to the markup percent', () => {
  const caps = getHomeDiscountCaps({ orgId: ORG, state: 'GA' });
  // 30% markup -> break-even 23.08%. Configured 15% is under it, so it stands.
  assert.equal(caps.addOn.break_even_percent, 23.08);
  assert.equal(caps.addOn.configured_percent, 15);
  assert.equal(caps.addOn.max_percent, 15);
  assert.equal(caps.addOn.clamped, false);
});

test('a naive discount-equals-markup rule WOULD sell below cost — regression guard', () => {
  // This is why the cap is break-even and not the markup percent.
  const cost = 100;
  const retail = resolveHomeAddOnPrice({ orgId: ORG, cost }).price; // 130
  const naive = retail * (1 - 0.30);                                // 91
  assert.ok(naive < cost, 'the naive rule really does go below cost');

  // The real cap does not.
  const caps = getHomeDiscountCaps({ orgId: ORG });
  const atCap = retail * (1 - caps.addOn.break_even_percent / 100);
  assert.ok(atCap >= cost - 0.01, `break-even discount must not go below cost, got ${atCap}`);
});

test('applyAddOnDiscount floors at cost no matter what percent is passed', () => {
  const r = applyAddOnDiscount({ orgId: ORG, cost: 100, discountPercent: 90 });
  assert.equal(r.price, 100);
  assert.equal(r.floored, true);
});

test('a discount inside the cap is applied normally', () => {
  const r = applyAddOnDiscount({ orgId: ORG, cost: 100, discountPercent: 10 });
  assert.equal(r.retail, 130);
  assert.equal(r.price, 117);
  assert.equal(r.floored, false);
});

test('plan discount is blocked in Florida', () => {
  assert.equal(getHomeDiscountCaps({ orgId: ORG, state: 'FL' }).plan.allowed, false);
  assert.equal(getHomeDiscountCaps({ orgId: ORG, state: 'GA' }).plan.allowed, true);
});

test('an unknown org prices at base with no markup rather than throwing', () => {
  const r = resolveHomePlanPrice({ orgId: 99999, basePrice: 1425 });
  assert.equal(r.price, 1425);
  assert.equal(r.enabled, false);
});
