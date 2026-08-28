// Unit tests for classifyDwelling — uses Node built-in test runner.
// Run: node --test packages/utils/dwelling-class.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyDwelling, isHomeEligible, listHomeTypes } from './dwelling-class.js';

const CANON = JSON.parse(
  readFileSync(new URL('../../canon/plan-mappings.json', import.meta.url), 'utf8'),
).home_dwelling_classes;

test('single family under 5000 lands in sf_lt_5000', () => {
  const r = classifyDwelling({ home_type: 'single_family', square_feet: 2400 }, CANON);
  assert.equal(r.id, 'sf_lt_5000');
  assert.equal(r.docuseal_field, 'DwellingSfLt5000');
});

test('bucket bounds are inclusive at both ends', () => {
  assert.equal(classifyDwelling({ home_type: 'single_family', square_feet: 4999 }, CANON).id, 'sf_lt_5000');
  assert.equal(classifyDwelling({ home_type: 'single_family', square_feet: 5000 }, CANON).id, 'sf_5000_8000');
  assert.equal(classifyDwelling({ home_type: 'single_family', square_feet: 8000 }, CANON).id, 'sf_5000_8000');
  assert.equal(classifyDwelling({ home_type: 'single_family', square_feet: 8001 }, CANON).id, 'sf_8001_12000');
  assert.equal(classifyDwelling({ home_type: 'single_family', square_feet: 12000 }, CANON).id, 'sf_8001_12000');
});

test('single family over 12000 is ineligible', () => {
  assert.equal(classifyDwelling({ home_type: 'single_family', square_feet: 12001 }, CANON), null);
  assert.equal(isHomeEligible({ home_type: 'single_family', square_feet: 12001 }, CANON), false);
});

test('townhome and condo cap at 5000', () => {
  assert.equal(classifyDwelling({ home_type: 'townhome', square_feet: 4999 }, CANON).id, 'townhome_lt_5000');
  assert.equal(classifyDwelling({ home_type: 'townhome', square_feet: 5000 }, CANON), null);
  assert.equal(classifyDwelling({ home_type: 'condominium', square_feet: 4999 }, CANON).id, 'condo_lt_5000');
  assert.equal(classifyDwelling({ home_type: 'condominium', square_feet: 5000 }, CANON), null);
});

test('missing or invalid input is ineligible, never a guess', () => {
  assert.equal(classifyDwelling({ home_type: 'single_family' }, CANON), null);
  assert.equal(classifyDwelling({ square_feet: 2000 }, CANON), null);
  assert.equal(classifyDwelling({ home_type: 'houseboat', square_feet: 900 }, CANON), null);
  assert.equal(classifyDwelling(null, CANON), null);
  assert.equal(classifyDwelling({ home_type: 'single_family', square_feet: 0 }, CANON), null);
  assert.equal(classifyDwelling({ home_type: 'single_family', square_feet: -5 }, CANON), null);
  assert.equal(classifyDwelling({ home_type: 'single_family', square_feet: 'not a number' }, CANON), null);
});

test('numeric strings are accepted — form inputs arrive as strings', () => {
  assert.equal(classifyDwelling({ home_type: 'single_family', square_feet: '2400' }, CANON).id, 'sf_lt_5000');
});

test('canon block is required', () => {
  assert.throws(() => classifyDwelling({ home_type: 'single_family', square_feet: 2000 }, null));
});

test('listHomeTypes returns the three canon types in order', () => {
  assert.deepEqual(listHomeTypes(CANON).map((t) => t.id), ['single_family', 'townhome', 'condominium']);
});

test('every canon bucket is reachable', () => {
  const probes = [
    ['single_family', 2400, 'sf_lt_5000'],
    ['single_family', 6200, 'sf_5000_8000'],
    ['single_family', 9500, 'sf_8001_12000'],
    ['townhome', 1800, 'townhome_lt_5000'],
    ['condominium', 1150, 'condo_lt_5000'],
  ];
  for (const [home_type, square_feet, expected] of probes) {
    assert.equal(classifyDwelling({ home_type, square_feet }, CANON).id, expected);
  }
  assert.equal(probes.length, CANON.buckets.length, 'a canon bucket has no probe');
});
