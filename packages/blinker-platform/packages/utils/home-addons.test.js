// Unit tests for the home add-on parser/resolver — Node built-in test runner.
// Run: node --test packages/utils/home-addons.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseOptionDesc,
  resolveHomeAddOns,
  sumAddOnPrices,
  revalidateSelections,
} from './home-addons.js';

const CANON = JSON.parse(
  readFileSync(new URL('../../canon/plan-mappings.json', import.meta.url), 'utf8'),
).home_add_ons;

// ---------- parseOptionDesc --------------------------------------------------

test('parses category, term and standard variant', () => {
  const r = parseOptionDesc('Plumbing system 3yr', CANON);
  assert.equal(r.canonical_key, 'internal_plumbing');
  assert.equal(r.term_months, 36);
  assert.equal(r.variant, 'standard');
});

test('parses both P/E marker spellings', () => {
  assert.equal(parseOptionDesc('Additional AC unit 4yr (P/E)', CANON).variant, 'pe');
  assert.equal(parseOptionDesc('Wellpump2yr(plus/enhanced)', CANON).variant, 'pe');
});

test('tolerates the unspaced raw spellings the rater actually returns', () => {
  // Every one of these appears verbatim in the Basecamp OptionDesc dump.
  const cases = [
    ['AdditionalACunit1yr', 'additional_ac', 12],
    ['AddlACunit2yr(plus/enhanced)', 'additional_ac', 24],
    ['Freestandingfreezer3yr', 'freestanding_freezer', 36],
    ['Garagedooropener4yr', 'garage_door_opener', 48],
    ['Icemaker2yr', 'ice_maker', 24],
    ['Plumbingsystem1yr', 'internal_plumbing', 12],
    ['Programmablethermostat3yr', 'programmable_thermostat', 36],
    ['Secondrefrigerator2yr', 'secondary_refrigerator', 24],
    ['Secondaryrefrigerator4yr(P/E)', 'secondary_refrigerator', 48],
    ['SEPTIC1yr', 'septic', 12],
    ['SPA3yr(plus/enhanced)', 'spa', 36],
    ['Swimmingpool2yr', 'swimming_pool', 24],
    ['Wellpump4yr(plus/enhanced)', 'well_pump', 48],
    ['Winecooler4yr(P/E)', 'wine_cooler', 48],
  ];
  for (const [desc, key, months] of cases) {
    const r = parseOptionDesc(desc, CANON);
    assert.ok(r, `failed to parse: ${desc}`);
    assert.equal(r.canonical_key, key, desc);
    assert.equal(r.term_months, months, desc);
  }
});

test('every canon category is reachable from at least one alias', () => {
  const seen = new Set();
  for (const cat of CANON.categories) {
    for (const alias of cat.match_aliases) {
      const r = parseOptionDesc(`${alias} 2yr`, CANON);
      if (r) seen.add(r.canonical_key);
    }
  }
  assert.equal(seen.size, CANON.categories.length, 'some category is unreachable');
});

test('longest alias wins so a short alias cannot shadow a specific one', () => {
  assert.equal(parseOptionDesc('Internal plumbing system 1yr', CANON).canonical_key, 'internal_plumbing');
});

test('unrecognised descriptions return null rather than guessing', () => {
  assert.equal(parseOptionDesc('Roof replacement 2yr', CANON), null);
  assert.equal(parseOptionDesc('', CANON), null);
  assert.equal(parseOptionDesc(null, CANON), null);
  assert.equal(parseOptionDesc('Spa', CANON), null); // no term suffix
});

// ---------- resolveHomeAddOns ------------------------------------------------

const OPTIONS = [
  { OptionId: 'o1', OptionDesc: 'Plumbing system 3yr',       RetailRate: 152 },
  { OptionId: 'o2', OptionDesc: 'Plumbing system 3yr (P/E)', RetailRate: 186 },
  { OptionId: 'o3', OptionDesc: 'Plumbing system 1yr',       RetailRate: 57 },
  { OptionId: 'o4', OptionDesc: 'Swimming pool 3yr',         RetailRate: 360 },
  { OptionId: 'o5', OptionDesc: 'Swimming pool 3yr (P/E)',   RetailRate: 415 },
];

test('plan 35 gets standard variants at the selected term only', () => {
  const r = resolveHomeAddOns({ options: OPTIONS, planCode: '35', termMonths: 36, canonBlock: CANON });
  assert.deepEqual(r.map((x) => x.option_id).sort(), ['o1', 'o4']);
  const plumbing = r.find((x) => x.key === 'internal_plumbing');
  assert.equal(plumbing.price, 152);
  assert.equal(plumbing.docuseal_field, 'InternalPlumbing');
  assert.equal(plumbing.label, 'Internal Plumbing System');
});

test('plans 36 and 37 get P/E variants only', () => {
  for (const planCode of ['36', '37']) {
    const r = resolveHomeAddOns({ options: OPTIONS, planCode, termMonths: 36, canonBlock: CANON });
    assert.deepEqual(r.map((x) => x.option_id).sort(), ['o2', 'o5'], `plan ${planCode}`);
    assert.equal(r.find((x) => x.key === 'internal_plumbing').price, 186);
  }
});

test('monthly plans get no add-ons at all', () => {
  for (const planCode of ['38', '48', '49']) {
    assert.deepEqual(
      resolveHomeAddOns({ options: OPTIONS, planCode, termMonths: 1, canonBlock: CANON }),
      [],
      `plan ${planCode}`,
    );
  }
});

test('term filter excludes other-term rows', () => {
  const r = resolveHomeAddOns({ options: OPTIONS, planCode: '35', termMonths: 12, canonBlock: CANON });
  assert.deepEqual(r.map((x) => x.option_id), ['o3']);
});

test('unknown plan code yields no add-ons rather than defaulting a variant', () => {
  assert.deepEqual(
    resolveHomeAddOns({ options: OPTIONS, planCode: '99', termMonths: 36, canonBlock: CANON }),
    [],
  );
});

test('numeric plan codes are accepted — rate rows may carry numbers not strings', () => {
  const r = resolveHomeAddOns({ options: OPTIONS, planCode: 35, termMonths: 36, canonBlock: CANON });
  assert.equal(r.length, 2);
});

test('empty or missing option list is safe', () => {
  assert.deepEqual(resolveHomeAddOns({ options: [], planCode: '35', termMonths: 36, canonBlock: CANON }), []);
  assert.deepEqual(resolveHomeAddOns({ options: null, planCode: '35', termMonths: 36, canonBlock: CANON }), []);
});

test('rows with an unusable price are skipped, not priced at zero', () => {
  const bad = [{ OptionId: 'x', OptionDesc: 'Spa 3yr', RetailRate: null }];
  assert.deepEqual(resolveHomeAddOns({ options: bad, planCode: '35', termMonths: 36, canonBlock: CANON }), []);
});

// ---------- totals + revalidation -------------------------------------------

test('sumAddOnPrices totals selections', () => {
  assert.equal(sumAddOnPrices([{ price: 152 }, { price: 360 }]), 512);
  assert.equal(sumAddOnPrices([]), 0);
  assert.equal(sumAddOnPrices(null), 0);
});

test('revalidateSelections re-prices by key and drops what is gone', () => {
  const selected = [
    { key: 'internal_plumbing', option_id: 'o3', price: 57 }, // was the 1yr row
    { key: 'well_pump', option_id: 'oX', price: 88 },         // not offered here
  ];
  const available = resolveHomeAddOns({ options: OPTIONS, planCode: '36', termMonths: 36, canonBlock: CANON });
  const { kept, dropped } = revalidateSelections({ selected, available });
  assert.deepEqual(kept.map((x) => x.key), ['internal_plumbing']);
  assert.equal(kept[0].option_id, 'o2', 're-resolved to the P/E row');
  assert.equal(kept[0].price, 186, 're-priced');
  assert.deepEqual(dropped.map((x) => x.key), ['well_pump']);
});

test('revalidateSelections handles empty inputs', () => {
  assert.deepEqual(revalidateSelections({ selected: [], available: [] }), { kept: [], dropped: [] });
  assert.deepEqual(revalidateSelections({ selected: null, available: null }), { kept: [], dropped: [] });
});

test('a term flip re-prices every surviving selection', () => {
  // ADR 30 D7: carrying a stale price forward would mischarge a signed agreement.
  const at36 = resolveHomeAddOns({ options: OPTIONS, planCode: '35', termMonths: 36, canonBlock: CANON });
  const at12 = resolveHomeAddOns({ options: OPTIONS, planCode: '35', termMonths: 12, canonBlock: CANON });
  const { kept, dropped } = revalidateSelections({ selected: at36, available: at12 });
  assert.deepEqual(kept.map((x) => x.key), ['internal_plumbing']);
  assert.equal(kept[0].price, 57);
  assert.deepEqual(dropped.map((x) => x.key), ['swimming_pool']);
});
