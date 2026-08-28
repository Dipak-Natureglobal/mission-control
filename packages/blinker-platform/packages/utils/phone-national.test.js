// toNationalPhoneDigits — Node built-in test runner.
// Run: node --test packages/utils/phone-national.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toNationalPhoneDigits, formatPhoneDisplay, normalizePhoneE164 } from './validators.js';

test('strips the US country code from a stored E.164 value', () => {
  assert.equal(toNationalPhoneDigits('+19124146274'), '9124146274');
  assert.equal(toNationalPhoneDigits('19124146274'), '9124146274');
});

test('passes through a bare 10-digit number and a formatted one', () => {
  assert.equal(toNationalPhoneDigits('9124146274'), '9124146274');
  assert.equal(toNationalPhoneDigits('(912) 414-6274'), '9124146274');
});

test('round-trips E.164 back to the number the agent typed', () => {
  // The Wave 39 regression: contact record showed (912) 414-6274 while the
  // consumer-phone input beside it showed (191) 241-4627.
  const typed = '9124146274';
  const stored = normalizePhoneE164(typed);
  assert.equal(stored, '+19124146274');
  assert.equal(formatPhoneDisplay(toNationalPhoneDigits(stored)), '(912) 414-6274');
});

test('seeding formatPhoneDisplay WITHOUT this helper is wrong — regression guard', () => {
  assert.equal(formatPhoneDisplay('+19124146274'), '(191) 241-4627');
  assert.notEqual(
    formatPhoneDisplay('+19124146274'),
    formatPhoneDisplay(toNationalPhoneDigits('+19124146274')),
  );
});

test('partials pass through so as-you-type entry still works', () => {
  assert.equal(toNationalPhoneDigits('912'), '912');
  assert.equal(toNationalPhoneDigits('912414'), '912414');
  assert.equal(formatPhoneDisplay(toNationalPhoneDigits('912414')), '(912) 414');
});

test('empty and junk input yield an empty string', () => {
  assert.equal(toNationalPhoneDigits(''), '');
  assert.equal(toNationalPhoneDigits(null), '');
  assert.equal(toNationalPhoneDigits(undefined), '');
  assert.equal(toNationalPhoneDigits('abc'), '');
});
