// Unit tests for the home plan selector — Node built-in test runner.
// Run: node --test src/lib/home-plan-selector.test.js   (or `npm test`)
//
// These tests deliberately drive the REAL producer — getRatesForHome in
// fixture mode — rather than a hand-written product array. A synthetic
// fixture whose shape drifts from what the normalizer actually emits will
// let a classifier pass its tests and still land on one branch forever in
// production; that exact failure cost five commits in Wave 25. Whatever
// getRatesForHome returns is what RecommendedCoverage will see.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRatesForHome } from 'blinker-platform/integrations/product_admin';
import {
  selectHomePlans,
  buildSelectedPlan,
  defaultTerm,
  tierOf,
  billingModel,
} from './home-plan-selector.js';

const ORG_ID = 102;
const RATES = await getRatesForHome({ state: 'MI' }, { orgId: ORG_ID });

test('the fixture actually produced products (guards every test below)', () => {
  assert.ok(Array.isArray(RATES.products), 'expected a products array');
  assert.ok(RATES.products.length > 0, 'expected a non-empty product set');
});

test('all three tiers resolve at 24, 36 and 48 months', () => {
  for (const term of [24, 36, 48]) {
    const { plans } = selectHomePlans({ rates: RATES, orgId: ORG_ID, termMonths: term });
    assert.ok(plans.good, `good missing at ${term}mo`);
    assert.ok(plans.better, `better missing at ${term}mo`);
    assert.ok(plans.best, `best missing at ${term}mo`);
    assert.equal(plans.good.plan_code, '35');
    assert.equal(plans.better.plan_code, '36');
    assert.equal(plans.best.plan_code, '37');
    for (const tier of ['good', 'better', 'best']) {
      assert.equal(plans[tier].coverage_period_months, term, `${tier} landed on the wrong term`);
    }
  }
});

test('at 12 months only plan 35 exists — better and best are null, never borrowed', () => {
  const { plans } = selectHomePlans({ rates: RATES, orgId: ORG_ID, termMonths: 12 });
  assert.ok(plans.good, 'good should exist at 12mo');
  assert.equal(plans.good.plan_code, '35');
  assert.equal(plans.good.coverage_period_months, 12);
  // The whole point of not porting the auto selector: no tier borrowing.
  assert.equal(plans.better, null, 'better must be null at 12mo, not borrowed from 24mo');
  assert.equal(plans.best, null, 'best must be null at 12mo, not borrowed from 24mo');
});

test('monthly mode yields all three tiers', () => {
  const { monthly, hasMonthly } = selectHomePlans({ rates: RATES, orgId: ORG_ID, mode: 'monthly' });
  assert.equal(hasMonthly, true);
  assert.ok(monthly, 'monthly set should be present');
  assert.equal(monthly.good.plan_code, '38');
  assert.equal(monthly.better.plan_code, '48');
  assert.equal(monthly.best.plan_code, '49');
  for (const tier of ['good', 'better', 'best']) {
    assert.equal(monthly[tier].billing_model, 'monthly_subscription');
    assert.ok(Number(monthly[tier].monthly_charge) > 0, `${tier} monthly_charge should be > 0`);
  }
});

test('monthly plans never leak into the term set and vice versa', () => {
  for (const term of [12, 24, 36, 48]) {
    const { plans } = selectHomePlans({ rates: RATES, orgId: ORG_ID, termMonths: term });
    for (const p of Object.values(plans)) {
      if (!p) continue;
      assert.equal(p.billing_model, 'term_total', 'a monthly plan leaked into the term set');
    }
  }
  const { monthly } = selectHomePlans({ rates: RATES, orgId: ORG_ID, mode: 'monthly' });
  for (const p of Object.values(monthly)) {
    assert.notEqual(p.plan_code, '35');
    assert.notEqual(p.plan_code, '36');
    assert.notEqual(p.plan_code, '37');
  }
});

test('availableTerms is the sorted distinct union across term plans', () => {
  const { availableTerms } = selectHomePlans({ rates: RATES, orgId: ORG_ID, termMonths: 36 });
  assert.deepEqual(availableTerms, [12, 24, 36, 48]);
});

test('termsByTier records the 12-month gap on better and best', () => {
  const { termsByTier } = selectHomePlans({ rates: RATES, orgId: ORG_ID, termMonths: 36 });
  assert.deepEqual(termsByTier.good, [12, 24, 36, 48]);
  assert.deepEqual(termsByTier.better, [24, 36, 48]);
  assert.deepEqual(termsByTier.best, [24, 36, 48]);
});

test('defaultTerm picks the longest term where all three tiers exist', () => {
  const { availableTerms, termsByTier } = selectHomePlans({ rates: RATES, orgId: ORG_ID, termMonths: 36 });
  assert.equal(defaultTerm({ availableTerms, termsByTier }), 48);
  // Degenerate inputs must not throw.
  assert.equal(defaultTerm({ availableTerms: [], termsByTier: {} }), null);
  assert.equal(defaultTerm({ availableTerms: [12], termsByTier: { good: [12], better: [], best: [] } }), 12);
});

test('a missing term yields an empty set rather than an arbitrary plan', () => {
  const { plans } = selectHomePlans({ rates: RATES, orgId: ORG_ID, termMonths: 60 });
  assert.deepEqual(plans, { good: null, better: null, best: null });
});

test('empty / absent rates degrade to nulls, never throw', () => {
  for (const rates of [null, undefined, {}, { products: [] }]) {
    const r = selectHomePlans({ rates, orgId: ORG_ID, termMonths: 36 });
    assert.deepEqual(r.plans, { good: null, better: null, best: null });
    assert.equal(r.hasMonthly, false);
    assert.equal(r.monthly, null);
    assert.deepEqual(r.availableTerms, []);
  }
});

test('candidates carry raw <Option> rows through unfiltered', () => {
  const { plans } = selectHomePlans({ rates: RATES, orgId: ORG_ID, termMonths: 36 });
  // The selector must NOT filter options — resolveHomeAddOns owns that, and it
  // needs both the standard and P/E rows present to pick the right variant.
  assert.ok(plans.good.options.length > 12, 'expected both variants of every category');
  const descs = plans.good.options.map((o) => o.OptionDesc);
  assert.ok(descs.some((d) => /\(P\/E\)/i.test(d)), 'P/E rows should still be present');
  assert.ok(descs.some((d) => !/\(P\/E\)/i.test(d)), 'standard rows should still be present');
});

test('monthly plans carry no options at all', () => {
  const { monthly } = selectHomePlans({ rates: RATES, orgId: ORG_ID, mode: 'monthly' });
  for (const p of Object.values(monthly)) {
    assert.deepEqual(p.options, []);
  }
});

test('billingModel defaults a missing field to term_total', () => {
  assert.equal(billingModel({}), 'term_total');
  assert.equal(billingModel(null), 'term_total');
  assert.equal(billingModel({ billing_model: 'term_total' }), 'term_total');
  assert.equal(billingModel({ billing_model: 'monthly_subscription' }), 'monthly_subscription');
});

test('tierOf reads the catalog, not the plan name', () => {
  // Catalog says 37 is best even though its name says nothing about a tier.
  assert.equal(
    tierOf({ tpa_code: 'OMGA', product_type_code: 'VSC', plan_code: '37', name: 'zzz' }, ORG_ID),
    'best',
  );
  assert.equal(
    tierOf({ tpa_code: 'OMGA', product_type_code: 'VSC', plan_code: '35', name: 'zzz' }, ORG_ID),
    'good',
  );
  // Unknown plan code with a tier_hint falls back to the hint.
  assert.equal(tierOf({ plan_code: 'ZZ', tier_hint: 'better' }, ORG_ID), 'better');
});

test('buildSelectedPlan carries everything the money path and the agreement need', () => {
  const { plans } = selectHomePlans({ rates: RATES, orgId: ORG_ID, termMonths: 36 });
  const sel = buildSelectedPlan('best', plans.best);
  // Read by packages/integrations/signing/docuseal.js#buildHomeSubmissionFields.
  assert.equal(sel.coverage_period_months, 36);
  assert.equal(typeof sel.total_cost, 'number');
  assert.ok(sel.total_cost > 0);
  assert.equal(sel.tpa_code, 'OMGA');
  assert.equal(sel.product_type_code, 'VSC');
  assert.equal(sel.plan_code, '37');
  // Read by OptionalCoverages.
  assert.ok(Array.isArray(sel.options));
  // Read by Confirm.
  assert.equal(sel.billing_model, 'term_total');
  assert.equal(buildSelectedPlan('good', null), null);
});

// ── retail pricing (Wave 39 follow-up) ──────────────────────────────────────
// The rater's base_price is Omega's remit. Every candidate must leave the
// selector at RETAIL, with the remit preserved beside it — computeHomePriceRange
// re-derives retail from base_price, so losing it silently zeroes the margin.

test('term candidates carry retail total_cost and the Omega remit beside it', () => {
  const { plans } = selectHomePlans({ rates: RATES, orgId: ORG_ID, termMonths: 48, state: 'GA' });
  const good = plans.good;
  const raw = RATES.products.find(
    (p) => p.plan_code === '35' && Number(p.coverage_period_months) === 48,
  );
  assert.equal(good.base_price, raw.base_price, 'base_price must stay the Omega remit');
  assert.equal(good.markup_applied, 300, 'org 102 seeds a $300 flat home markup');
  assert.equal(good.total_cost, raw.base_price + 300);
  assert.ok(good.total_cost > good.base_price, 'retail must exceed cost');
});

test('the Florida markup split is honoured', () => {
  const ga = selectHomePlans({ rates: RATES, orgId: ORG_ID, termMonths: 48, state: 'GA' }).plans.good;
  const fl = selectHomePlans({ rates: RATES, orgId: ORG_ID, termMonths: 48, state: 'FL' }).plans.good;
  assert.equal(ga.markup_applied, 300);
  assert.equal(fl.markup_applied, 285);
  assert.equal(ga.total_cost - fl.total_cost, 15);
});

test('monthly candidates mark up the recurring charge, not the term total', () => {
  const { monthly } = selectHomePlans({ rates: RATES, orgId: ORG_ID, mode: 'monthly', state: 'GA' });
  // Plan 38 remits at $40/mo; org 102 seeds a $10 monthly markup.
  assert.equal(monthly.good.base_monthly_charge, 40);
  assert.equal(monthly.good.monthly_charge, 50);
  assert.equal(monthly.good.total_cost, 50, 'a monthly plan has no term total to inflate');
});

test('an unknown org gets no markup rather than a guessed one', () => {
  const { plans } = selectHomePlans({ rates: RATES, orgId: 999999, termMonths: 48, state: 'GA' });
  assert.equal(plans.good.markup_applied, 0);
  assert.equal(plans.good.total_cost, plans.good.base_price);
});

test('buildSelectedPlan carries base_price through to the money path', () => {
  const { plans } = selectHomePlans({ rates: RATES, orgId: ORG_ID, termMonths: 48, state: 'GA' });
  const sel = buildSelectedPlan('good', plans.good);
  assert.equal(sel.base_price, plans.good.base_price);
  assert.equal(sel.total_cost, plans.good.total_cost);
  assert.equal(sel.markup_applied, 300);
});
