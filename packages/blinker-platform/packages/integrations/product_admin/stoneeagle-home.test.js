// Home rating path tests — Node built-in test runner.
// Run: node --test packages/integrations/product_admin/stoneeagle-home.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSoapEnvelope as __buildSoapEnvelope } from './soap-envelope.js';
import { resolveHomeAddOns } from '../../utils/home-addons.js';

const CREDS = { tpa_code: 'OMGA', user_id: 'BLINKER', password: 'x', dealer_no: 'AUG2' };

// ---------- SOAP envelope ----------------------------------------------------

test('home envelope emits the HOME sentinels verbatim', () => {
  const xml = __buildSoapEnvelope({ asset_kind: 'home', state: 'MI' }, CREDS);
  assert.match(xml, /<NewUsed>\*<\/NewUsed>/);
  assert.match(xml, /<VehicleYear>2025<\/VehicleYear>/);
  assert.match(xml, /<VehicleMake>HOME<\/VehicleMake>/);
  assert.match(xml, /<VehicleModel>HOME<\/VehicleModel>/);
  assert.match(xml, /<Trim><\/Trim>/);
  assert.match(xml, /<AssetType><\/AssetType>/);
  assert.match(xml, /<VehicleOdometer>0<\/VehicleOdometer>/);
  assert.match(xml, /<State>MI<\/State>/);
  assert.match(xml, /<DealerNo>AUG2<\/DealerNo>/);
});

test('home envelope never emits a VIN block even if one is passed', () => {
  const xml = __buildSoapEnvelope({ asset_kind: 'home', state: 'MI', vin: 'IGNOREDVIN1234567' }, CREDS);
  assert.doesNotMatch(xml, /<VIN>/);
});

test('home envelope omits State entirely when absent', () => {
  const xml = __buildSoapEnvelope({ asset_kind: 'home' }, CREDS);
  assert.doesNotMatch(xml, /<State>/);
});

test('home envelope never defaults AssetType to P', () => {
  // The vehicle path defaults AssetType to 'P'; routing a home through it
  // would silently rate the home as a passenger vehicle.
  const xml = __buildSoapEnvelope({ asset_kind: 'home' }, CREDS);
  assert.doesNotMatch(xml, /<AssetType>P<\/AssetType>/);
});

test('vehicle envelope is unchanged by the home branch', () => {
  const xml = __buildSoapEnvelope(
    { year: 2022, make: 'Toyota', model: 'RAV4', trim: 'XLE', mileage: 30000, condition: 'N', asset_type: 'T', state: 'TX' },
    { ...CREDS, dealer_no: 'AMR2' },
  );
  assert.match(xml, /<NewUsed>N<\/NewUsed>/);
  assert.match(xml, /<VehicleMake>TOYOTA<\/VehicleMake>/);
  assert.match(xml, /<AssetType>T<\/AssetType>/);
  assert.match(xml, /<VehicleOdometer>30000<\/VehicleOdometer>/);
  assert.match(xml, /<DealerNo>AMR2<\/DealerNo>/);
});

test('vehicle VIN path is unchanged by the home branch', () => {
  const xml = __buildSoapEnvelope({ vin: '2HGFE2F54SH551994', condition: 'U', mileage: 41000 }, CREDS);
  assert.match(xml, /<VIN>2HGFE2F54SH551994<\/VIN>/);
  assert.doesNotMatch(xml, /<VehicleMake>/);
});

// ---------- fixture ----------------------------------------------------------

const HOME_FIXTURE = JSON.parse(
  readFileSync(new URL('./_fixtures/stone-eagle-get-rates-home.json', import.meta.url), 'utf8'),
);
const ADDON_CANON = JSON.parse(
  readFileSync(new URL('../../../canon/plan-mappings.json', import.meta.url), 'utf8'),
).home_add_ons;

test('fixture: six plan codes, all OMGA VSC home', () => {
  const codes = [...new Set(HOME_FIXTURE.products.map((p) => p.plan_code))].sort();
  assert.deepEqual(codes, ['35', '36', '37', '38', '48', '49']);
  assert.ok(HOME_FIXTURE.products.every((p) => p.asset_kind === 'home'));
  assert.ok(HOME_FIXTURE.products.every((p) => p.tpa_code === 'OMGA' && p.product_type_code === 'VSC'));
  assert.ok(HOME_FIXTURE.products.every((p) => p.deductible === 75));
  assert.ok(HOME_FIXTURE.products.every((p) => p.mileage === null));
});

test('fixture: plan 35 at 36mo offers twelve standard add-ons', () => {
  const p = HOME_FIXTURE.products.find((x) => x.plan_code === '35' && x.coverage_period_months === 36);
  const r = resolveHomeAddOns({ options: p.options, planCode: '35', termMonths: 36, canonBlock: ADDON_CANON });
  assert.equal(r.length, 12);
  assert.ok(r.every((x) => x.variant === 'standard'));
  assert.ok(r.every((x) => x.docuseal_field));
});

test('fixture: plan 37 at 48mo offers twelve P/E add-ons', () => {
  const p = HOME_FIXTURE.products.find((x) => x.plan_code === '37' && x.coverage_period_months === 48);
  const r = resolveHomeAddOns({ options: p.options, planCode: '37', termMonths: 48, canonBlock: ADDON_CANON });
  assert.equal(r.length, 12);
  assert.ok(r.every((x) => x.variant === 'pe'));
});

test('fixture: monthly plans carry no options and are flagged monthly', () => {
  for (const code of ['38', '48', '49']) {
    const p = HOME_FIXTURE.products.find((x) => x.plan_code === code);
    assert.equal(p.billing_model, 'monthly_subscription', `plan ${code}`);
    assert.deepEqual(p.options, [], `plan ${code}`);
    assert.equal(p.unlimited_mileage, true, `plan ${code}`);
  }
});

test('fixture: term plans are flagged term_total', () => {
  for (const code of ['35', '36', '37']) {
    const rows = HOME_FIXTURE.products.filter((x) => x.plan_code === code);
    assert.ok(rows.length > 0);
    assert.ok(rows.every((p) => p.billing_model === 'term_total'), `plan ${code}`);
  }
});

test('fixture: plan 35 has four terms; 36 and 37 have three and no 12-month', () => {
  const terms = (code) => HOME_FIXTURE.products
    .filter((x) => x.plan_code === code)
    .map((x) => x.coverage_period_months)
    .sort((a, b) => a - b);
  assert.deepEqual(terms('35'), [12, 24, 36, 48]);
  assert.deepEqual(terms('36'), [24, 36, 48]);
  assert.deepEqual(terms('37'), [24, 36, 48]);
});

test('fixture: base prices match the published Omega-J Home 2024 table', () => {
  const price = (code, term) => HOME_FIXTURE.products
    .find((x) => x.plan_code === code && x.coverage_period_months === term).base_price;
  assert.deepEqual([12, 24, 36, 48].map((t) => price('35', t)), [525, 970, 1175, 1425]);
  assert.deepEqual([24, 36, 48].map((t) => price('36', t)), [990, 1325, 1570]);
  assert.deepEqual([24, 36, 48].map((t) => price('37', t)), [1040, 1425, 1670]);
});

test('fixture: every term product resolves a full twelve-item add-on set', () => {
  for (const p of HOME_FIXTURE.products.filter((x) => x.billing_model === 'term_total')) {
    const r = resolveHomeAddOns({
      options: p.options,
      planCode: p.plan_code,
      termMonths: p.coverage_period_months,
      canonBlock: ADDON_CANON,
    });
    assert.equal(r.length, 12, `plan ${p.plan_code} @ ${p.coverage_period_months}mo resolved ${r.length}`);
    assert.ok(r.every((x) => x.price > 0), `plan ${p.plan_code} has a zero-priced add-on`);
  }
});
