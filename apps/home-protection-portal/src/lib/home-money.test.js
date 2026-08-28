// Unit tests for the home money adapter + the add-on retail path.
// Run: node --test src/lib/home-money.test.js   (or `npm test`)
//
// Like the selector tests, these drive the REAL producer (getRatesForHome in
// fixture mode) rather than a hand-written option array. The add-on parser
// keys on OptionDesc spellings and the variant markers the normalizer emits;
// a synthetic row that spells them differently would let every assertion here
// pass against data production never produces.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRatesForHome } from 'blinker-platform/integrations/product_admin';
import { getHomeDiscountCaps } from 'blinker-platform/utils';
import { selectHomePlans, buildSelectedPlan } from './home-plan-selector.js';
import { availableAddOns, impliedAddOnCosts } from './addon-sync.js';
import { pricingState, paymentBasis, perMonth, discountAddOns } from './home-money.js';

const ORG_ID = 102;
const RATES = await getRatesForHome({ state: 'MI' }, { orgId: ORG_ID });

const GOOD_48 = buildSelectedPlan(
  'good',
  selectHomePlans({ rates: RATES, orgId: ORG_ID, termMonths: 48, state: 'GA' }).plans.good,
);

// ── pricingState ────────────────────────────────────────────────────────────

test('the covered property wins over the agreement holder mailing address', () => {
  assert.equal(
    pricingState({ home: { address: { state: 'fl' } }, contact: { state: 'GA' } }),
    'FL',
  );
  assert.equal(pricingState({ contact: { state: 'ga' } }), 'GA');
  assert.equal(pricingState({}), null);
  assert.equal(pricingState(null), null);
});

// ── paymentBasis ────────────────────────────────────────────────────────────

test('months-to-pay options AND default are per coverage term', () => {
  const twelve = paymentBasis({ orgId: ORG_ID, coverageTermMonths: 12 });
  assert.deepEqual(twelve.options, [1, 6]);
  assert.equal(twelve.default_months, 6);
  assert.equal(twelve.months, 6);

  for (const term of [24, 36, 48]) {
    const b = paymentBasis({ orgId: ORG_ID, coverageTermMonths: term });
    assert.deepEqual(b.options, [1, 6, 12], `options wrong at ${term}mo coverage`);
    assert.equal(b.months, 12, `default wrong at ${term}mo coverage`);
  }
});

test('an explicit months-to-pay wins, but only while the term still offers it', () => {
  const honored = paymentBasis({ orgId: ORG_ID, coverageTermMonths: 48, chosenMonths: 6 });
  assert.equal(honored.months, 6);
  assert.equal(honored.chosenHonored, true);

  // 12 payments do not exist at 12 months of coverage — fall back, never carry.
  const dropped = paymentBasis({ orgId: ORG_ID, coverageTermMonths: 12, chosenMonths: 12 });
  assert.equal(dropped.months, 6);
  assert.equal(dropped.chosenHonored, false);
});

// ── perMonth ────────────────────────────────────────────────────────────────

test('the down payment is one monthly payment, so the divisor is months + 1', () => {
  assert.equal(perMonth(1300, 12), 100);
  assert.equal(perMonth(1300, 1), 650);
  // Down payment + every scheduled payment must reconstitute the total.
  const monthly = perMonth(1725, 12);
  assert.ok(Math.abs(monthly * 13 - 1725) < 0.05);
});

// ── add-on retail ───────────────────────────────────────────────────────────

test('add-on rows leave availableAddOns at retail, carrying the Omega cost', () => {
  const rows = availableAddOns(GOOD_48, 48, ORG_ID);
  assert.ok(rows.length > 0, 'expected priced options on plan 35 at 48 months');
  for (const r of rows) {
    assert.ok(r.cost > 0, `${r.key} lost its cost basis`);
    // org 102 seeds add_on_percent 0.30
    assert.equal(r.price, Math.round(r.cost * 1.3 * 100) / 100, `${r.key} mispriced`);
    assert.ok(r.price > r.cost);
  }
});

test('a plan with no org context is left at Omega cost, not marked up by guess', () => {
  const rows = availableAddOns(GOOD_48, 48, null);
  for (const r of rows) assert.equal(r.price, r.cost);
});

test('impliedAddOnCosts hands back OMEGA COST, because the range resolver marks up', () => {
  const rows = availableAddOns(GOOD_48, 48, ORG_ID);
  const implied = impliedAddOnCosts(rows, { ice_maker: true, septic: true, spa: false });
  assert.deepEqual(implied.map((i) => i.key).sort(), ['ice_maker', 'septic']);
  for (const i of implied) {
    const source = rows.find((r) => r.key === i.key);
    assert.equal(i.price, source.cost, `${i.key} would be marked up twice`);
  }
});

// ── discountAddOns ──────────────────────────────────────────────────────────

test('an add-on discount never sells below Omega cost', () => {
  const rows = availableAddOns(GOOD_48, 48, ORG_ID);
  // 90% is far past the break-even ceiling; the per-row floor must still hold.
  const res = discountAddOns({ orgId: ORG_ID, addOns: rows, discountPercent: 90 });
  assert.equal(res.floored, true);
  for (const r of res.rows) {
    assert.ok(r.discounted_price >= r.cost - 0.001, `${r.key} sold below cost`);
  }
});

test('at the capped percent nothing is floored and the discount is real', () => {
  const caps = getHomeDiscountCaps({ orgId: ORG_ID, state: 'GA' });
  const rows = availableAddOns(GOOD_48, 48, ORG_ID);
  const res = discountAddOns({ orgId: ORG_ID, addOns: rows, discountPercent: caps.addOn.max_percent });
  assert.equal(res.floored, false, 'the clamped cap should sit at or under break-even');
  assert.ok(res.discount > 0);
  assert.ok(res.total < res.retailTotal);
});

test('a zero percent, or a row with no cost basis, leaves the price untouched', () => {
  const rows = availableAddOns(GOOD_48, 48, ORG_ID);
  const zero = discountAddOns({ orgId: ORG_ID, addOns: rows, discountPercent: 0 });
  assert.equal(zero.discount, 0);
  assert.equal(zero.total, zero.retailTotal);

  const legacy = discountAddOns({
    orgId: ORG_ID,
    addOns: [{ key: 'septic', price: 11.7 }],
    discountPercent: 15,
  });
  assert.equal(legacy.discount, 0, 'no cost basis means no discount, never a guessed one');
  assert.equal(legacy.total, 11.7);
});
