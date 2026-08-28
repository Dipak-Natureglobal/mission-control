// DocuSeal field-mapping tests — Node built-in test runner.
// Run: node --test packages/integrations/signing/docuseal.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveTemplateId, buildHomeSubmissionFields, addMonthsIso } from './docuseal.js';

const PLAN_MAPPINGS = JSON.parse(
  readFileSync(new URL('../../../canon/plan-mappings.json', import.meta.url), 'utf8'),
);
const CANON = {
  homeAddOns:          PLAN_MAPPINGS.home_add_ons,
  homeDwellingClasses: PLAN_MAPPINGS.home_dwelling_classes,
};

const ORG = {
  id: 102,
  name: 'Apex Auto Solutions',
  legal_name: 'Apex Auto Solutions LLC',
  address: { address1: '1 Apex Way', city: 'Austin', state: 'TX', zip: '78701' },
  phone: '5125550100',
  seller_code: 'AUG2',
};

function makeForm(overrides = {}) {
  return {
    org_id: 102,
    contact: {
      first_name: 'Dana', last_name: 'Reyes', phone: '3135550142',
      address1: '900 Lakeshore Dr', city: 'Detroit', state: 'MI', zip: '48214',
    },
    home: {
      home_type: 'single_family', square_feet: 2400, year_built: 1998,
      address: { address1: '17547 Murray Hill Street', city: 'Detroit', state: 'MI', zip: '48235' },
    },
    selectedPlan: {
      plan_code: '37', tpa_code: 'OMGA', product_type_code: 'VSC',
      coverage_period_months: 36, total_cost: 1425,
    },
    selectedAddOns: [
      { key: 'swimming_pool',     docuseal_field: 'SwimmingPool',     price: 415 },
      { key: 'internal_plumbing', docuseal_field: 'InternalPlumbing', price: 186 },
    ],
    saleDate: '2026-08-25',
    ...overrides,
  };
}

// ---------- template resolution ---------------------------------------------

test('template id resolves from the catalog for each home plan', () => {
  const expected = { 35: '182', 36: '184', 37: '185', 38: '186', 48: '187', 49: '188' };
  for (const [planCode, id] of Object.entries(expected)) {
    const got = resolveTemplateId({ orgId: 102, tpaCode: 'OMGA', productTypeCode: 'VSC', planCode });
    assert.equal(got, id, `plan ${planCode} should map to template ${id}`);
  }
});

test('an unknown plan code resolves no template rather than a wrong one', () => {
  assert.equal(
    resolveTemplateId({ orgId: 102, tpaCode: 'OMGA', productTypeCode: 'VSC', planCode: 'ZZ' }),
    null,
  );
});

// ---------- date math --------------------------------------------------------

test('addMonthsIso advances calendar months in UTC', () => {
  assert.equal(addMonthsIso('2026-08-25', 36), '2029-08-25');
  assert.equal(addMonthsIso('2026-08-25', 12), '2027-08-25');
  assert.equal(addMonthsIso('2026-12-31', 1), '2027-01-31');
});

test('addMonthsIso clamps day overflow to the last day of the target month', () => {
  assert.equal(addMonthsIso('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsIso('2028-01-31', 1), '2028-02-29'); // leap year
});

test('addMonthsIso rejects unusable input', () => {
  assert.equal(addMonthsIso(null, 12), null);
  assert.equal(addMonthsIso('2026-08-25', null), null);
  assert.equal(addMonthsIso('not-a-date', 12), null);
});

// ---------- field mapping ----------------------------------------------------

test('Deluxe is always checked', () => {
  const f = buildHomeSubmissionFields({ form: makeForm(), org: ORG, canon: CANON });
  assert.equal(f.Deluxe, true);
});

test('selected add-on checkboxes are true and unselected ones are false', () => {
  const f = buildHomeSubmissionFields({ form: makeForm(), org: ORG, canon: CANON });
  assert.equal(f.SwimmingPool, true);
  assert.equal(f.InternalPlumbing, true);
  assert.equal(f.WellPump, false);
  assert.equal(f.SepticSystem, false);
  // All twelve checkbox fields must be present, never omitted — an omitted
  // checkbox is indistinguishable from an unchecked one at the API boundary.
  const boxes = CANON.homeAddOns.categories.map((c) => c.docuseal_field);
  assert.equal(boxes.length, 12);
  assert.ok(boxes.every((b) => typeof f[b] === 'boolean'), 'every add-on checkbox must be emitted');
});

test('no add-ons selected still emits twelve false checkboxes', () => {
  const f = buildHomeSubmissionFields({ form: makeForm({ selectedAddOns: [] }), org: ORG, canon: CANON });
  const boxes = CANON.homeAddOns.categories.map((c) => c.docuseal_field);
  assert.ok(boxes.every((b) => f[b] === false));
});

test('ProductPrice includes add-on dollars', () => {
  const f = buildHomeSubmissionFields({ form: makeForm(), org: ORG, canon: CANON });
  assert.equal(f.ProductPrice, '2026.00'); // 1425 + 415 + 186
});

test('ProductPrice is the plan alone when nothing is added', () => {
  const f = buildHomeSubmissionFields({ form: makeForm({ selectedAddOns: [] }), org: ORG, canon: CANON });
  assert.equal(f.ProductPrice, '1425.00');
});

test('expiration is effective date plus term months', () => {
  const f = buildHomeSubmissionFields({ form: makeForm(), org: ORG, canon: CANON });
  assert.equal(f.ProductPurchaseDate, '2026-08-25');
  assert.equal(f.ProductEffectiveDate, '2026-08-25');
  assert.equal(f.ProductExpirationDate, '2029-08-25');
  assert.equal(f.ProductTermMonths, '36');
});

test('a rater-supplied effective date overrides the sale date', () => {
  const f = buildHomeSubmissionFields({
    form: makeForm({ productEffectiveDate: '2026-09-01' }),
    org: ORG,
    canon: CANON,
  });
  assert.equal(f.ProductPurchaseDate, '2026-08-25');
  assert.equal(f.ProductEffectiveDate, '2026-09-01');
  assert.equal(f.ProductExpirationDate, '2029-09-01');
});

test('holder and covered-property addresses do NOT collide', () => {
  // ADR 30 R5 item 4 — the live templates carry Address1/City/State/Zip twice
  // under identical names. These must be distinct field sets.
  const f = buildHomeSubmissionFields({ form: makeForm(), org: ORG, canon: CANON });
  assert.equal(f.Address1, '900 Lakeshore Dr');
  assert.equal(f.City, 'Detroit');
  assert.equal(f.Zip, '48214');
  assert.equal(f.PropertyAddress1, '17547 Murray Hill Street');
  assert.equal(f.PropertyCity, 'Detroit');
  assert.equal(f.PropertyState, 'MI');
  assert.equal(f.PropertyZip, '48235');
  assert.notEqual(f.Address1, f.PropertyAddress1);
});

test('dwelling checkboxes: exactly one true, all five emitted', () => {
  const f = buildHomeSubmissionFields({ form: makeForm(), org: ORG, canon: CANON });
  const boxes = CANON.homeDwellingClasses.buckets.map((b) => b.docuseal_field);
  assert.equal(boxes.length, 5);
  assert.ok(boxes.every((b) => typeof f[b] === 'boolean'));
  assert.equal(boxes.filter((b) => f[b] === true).length, 1);
  assert.equal(f.DwellingSfLt5000, true);
  assert.equal(f.DwellingCondoLt5000, false);
  assert.equal(f.SquareFeet, '2400');
});

test('a larger single family ticks the right dwelling box', () => {
  const f = buildHomeSubmissionFields({
    form: makeForm({ home: { home_type: 'single_family', square_feet: 6200, address: {} } }),
    org: ORG,
    canon: CANON,
  });
  assert.equal(f.DwellingSf5000To8000, true);
  assert.equal(f.DwellingSfLt5000, false);
});

test('second agreement holder is emitted only when present', () => {
  const one = buildHomeSubmissionFields({ form: makeForm(), org: ORG, canon: CANON });
  assert.equal(one.SecondFirstName, '');
  assert.equal(one.SecondLastName, '');
  const two = buildHomeSubmissionFields({
    form: makeForm({ secondaryContact: { first_name: 'Sam', last_name: 'Reyes', phone: '3135550143' } }),
    org: ORG,
    canon: CANON,
  });
  assert.equal(two.SecondFirstName, 'Sam');
  assert.equal(two.SecondLastName, 'Reyes');
  assert.equal(two.SecondPhone, '3135550143');
});

test('seller block comes from the org record', () => {
  const f = buildHomeSubmissionFields({ form: makeForm(), org: ORG, canon: CANON });
  assert.equal(f.SellerNameLegal, 'Apex Auto Solutions LLC');
  assert.equal(f.SellerCity, 'Austin');
  assert.equal(f.SellerCode, 'AUG2');
});

test('ProductAgreementNumber is empty until eContracting exists', () => {
  const f = buildHomeSubmissionFields({ form: makeForm(), org: ORG, canon: CANON });
  assert.equal(f.ProductAgreementNumber, ''); // ADR 30 R4
});

test('signature fields are never emitted — DocuSeal fills them from roles', () => {
  const f = buildHomeSubmissionFields({ form: makeForm(), org: ORG, canon: CANON });
  for (const k of ['SellerSignature', 'SellerSignatureDate', 'ConsumerSignature', 'ConsumerSignatureDate']) {
    assert.equal(k in f, false, `${k} must not be sent`);
  }
});

test('an ineligible home throws rather than papering a blank dwelling box', () => {
  const bad = makeForm({ home: { home_type: 'condominium', square_feet: 9000, address: {} } });
  assert.throws(
    () => buildHomeSubmissionFields({ form: bad, org: ORG, canon: CANON }),
    /ineligible/i,
  );
});

test('canon is required', () => {
  assert.throws(() => buildHomeSubmissionFields({ form: makeForm(), org: ORG, canon: {} }));
});

test('ProductPrice follows the charged total, not list retail', () => {
  // ADR 30 D7 — paymentSchedule is the single source for the charge, and the
  // only place a discount lands. The agreement must not say 2026.00 while the
  // card is charged 1900.00.
  const discounted = buildHomeSubmissionFields({
    form: makeForm({ paymentSchedule: { total_cost: 1900 } }),
    org: ORG,
    canon: CANON,
  });
  assert.equal(discounted.ProductPrice, '1900.00');
});

test('ProductPrice falls back to plan + add-ons before Confirm has run', () => {
  const f = buildHomeSubmissionFields({ form: makeForm(), org: ORG, canon: CANON });
  assert.equal(f.ProductPrice, '2026.00');
});

test('a zero or malformed schedule total does not zero out the agreement', () => {
  for (const bad of [{ total_cost: 0 }, { total_cost: null }, {}]) {
    const f = buildHomeSubmissionFields({ form: makeForm({ paymentSchedule: bad }), org: ORG, canon: CANON });
    assert.equal(f.ProductPrice, '2026.00', JSON.stringify(bad));
  }
});
