// Form validation + formatting + parsing utilities.
//
// Wave 15c-fu: lifted as a strict superset of three pre-existing validator
// hosts:
//   - refi-portal/src/utils/validation.js — the richest set; the
//     `validators` object plus parseFlexDate / parseDob / ageYears /
//     dobAdult / formatPhoneDisplay / sanitizeNumeric. Every `validators[k]`
//     returns `string | null` (null = valid; string = displayable error
//     message; pairs with `<Field error={...} />`).
//   - protection-portal/src/lib/validators.js — a subset of refi's
//     `validators` (required, vin, zip), same string|null contract.
//   - mission-control/src/lib/contact-form.js — pure validators
//     (isValidEmail, isValidUSPhone10, normalizePhoneE164, normalizeZip5,
//     isValidZip5) returning `boolean`. The other contact-form helpers
//     (findContactMatch, buildHouseholdRelationship, validateContactForm,
//     HOUSEHOLD_RELATIONSHIP_KINDS) are workflow-bound to mission-control's
//     AddContactModal and are NOT lifted. mc's contact-form.js re-exports
//     the lifted boolean validators for back-compat plus keeps its local
//     workflow helpers.
//
// Two coexisting families — they don't collide because the names don't
// overlap, and they serve different consumer needs:
//
//   1. boolean / normalizer family (from mc) — convenient for form-level
//      validateAndCommit() helpers that just want a yes/no answer.
//
//   2. `validators` string|null family (from refi/protection) — wires
//      directly into the <Field error={...} /> render branch in the
//      lifted FormFields component.
//
// Each app picks the family that matches its UX. New code that wants both
// can compose: `validators.email(v) === null` is the boolean form.
//
// Dep direction (per architecture/11): pure functions; no React, no
// network, no canon, no localStorage.

// =====================================================================
// boolean / normalizer family — lifted from
// mission-control/src/lib/contact-form.js.
// =====================================================================

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True iff `s` looks like a valid email address. */
export function isValidEmail(s) {
  if (!s || typeof s !== 'string') return false;
  return EMAIL_RE.test(s.trim());
}

/**
 * True iff `s` (after stripping non-digits) is exactly 10 digits, OR 11
 * digits starting with `1` (US country code prefix). US-only check.
 */
export function isValidUSPhone10(s) {
  if (!s || typeof s !== 'string') return false;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return true;
  return digits.length === 10;
}

/**
 * Returns `'+1XXXXXXXXXX'` for any 10-or-11-digit US phone, or `''` if
 * the input doesn't normalize cleanly.
 */
export function normalizePhoneE164(s) {
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return '';
}

/** Returns the leading 5 digits, or `''` if none. */
export function normalizeZip5(s) {
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  return digits.slice(0, 5);
}

/** True iff `normalizeZip5(s)` produces exactly 5 digits. */
export function isValidZip5(s) {
  return /^\d{5}$/.test(normalizeZip5(s));
}

// =====================================================================
// string | null family — lifted from refi-portal/src/utils/validation.js.
// Each member returns `null` for valid input and a displayable string for
// invalid input. Empty input is treated as valid (no error) for every
// member except `required` — pair with `validators.required` for
// not-blank checks.
// =====================================================================

export const validators = {
  required: (v) =>
    (v === null || v === undefined || String(v).trim() === '') ? 'Required' : null,

  email: (v) => {
    if (!v) return null;
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? null : 'Enter a valid email address';
  },

  usPhone: (v) => {
    if (!v) return null;
    const digits = String(v).replace(/\D/g, '');
    return digits.length === 10 ? null : 'Enter a 10-digit US phone number';
  },

  ssn: (v) => {
    if (!v) return null;
    const digits = String(v).replace(/\D/g, '');
    return digits.length === 9 ? null : 'SSN must be 9 digits';
  },

  zip: (v) => {
    if (!v) return null;
    return /^\d{5}(-\d{4})?$/.test(String(v).trim()) ? null : 'Enter a 5-digit ZIP code';
  },

  state2: (v) => {
    if (!v) return null;
    return /^[A-Za-z]{2}$/.test(v.trim()) ? null : 'Use the 2-letter state abbreviation';
  },

  vin: (v) => {
    if (!v) return null;
    const upper = String(v).trim().toUpperCase();
    if (upper.length !== 17) return 'VIN must be exactly 17 characters';
    if (/[IOQ]/.test(upper)) return 'VIN cannot contain I, O, or Q';
    if (!/^[A-HJ-NPR-Z0-9]+$/.test(upper)) return 'VIN can only contain letters and digits';
    return null;
  },

  flexDate: (v) => {
    if (!v) return null;
    return parseFlexDate(v) ? null : 'Enter a valid date';
  },

  flexDateInPast: (v) => {
    if (!v) return null;
    const parsed = parseFlexDate(v);
    if (!parsed) return 'Enter a valid date';
    if (parsed.date > new Date()) return 'Date must be in the past';
    return null;
  },

  positiveCurrency: (v) => {
    if (v === '' || v === null || v === undefined) return null;
    const s = String(v);
    if (!/^\d*\.?\d*$/.test(s)) return 'Enter a number';
    const n = Number(s);
    if (Number.isNaN(n)) return 'Enter a number';
    if (n <= 0) return 'Must be greater than 0';
    return null;
  },

  positiveInt: (v) => {
    if (v === '' || v === null || v === undefined) return null;
    const s = String(v);
    if (!/^\d+$/.test(s)) return 'Enter a whole number';
    const n = Number(s);
    if (Number.isNaN(n) || n <= 0) return 'Must be greater than 0';
    return null;
  },
};

// =====================================================================
// Formatters / parsers — lifted from refi-portal/src/utils/validation.js.
// =====================================================================

/**
 * Strip non-numeric characters. With `decimal: true` (default), permits a
 * single `.` separator (subsequent dots are dropped).
 */
export function sanitizeNumeric(v, { decimal = true } = {}) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  s = decimal ? s.replace(/[^0-9.]/g, '') : s.replace(/[^0-9]/g, '');
  if (decimal) {
    const firstDot = s.indexOf('.');
    if (firstDot !== -1) {
      s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
    }
  }
  return s;
}

/**
 * Parse a flexible date string. Accepts digits-only forms (MMDDYYYY,
 * MDYYYY, MDDYYYY, MMDDYY, MDYY) AND slashed/hyphenated/dotted forms
 * (M/D/YY, MM/DD/YYYY, etc.). Returns `{ month, day, year, date }` or
 * `null` for invalid input.
 *
 * 2-digit years: yy > 50 → 19yy, otherwise → 20yy.
 */
export function parseFlexDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  let mm, dd, yy;
  if (s.includes('/') || s.includes('-') || s.includes('.')) {
    const parts = s.split(/[/.\-]/);
    if (parts.length !== 3) return null;
    [mm, dd, yy] = parts;
    if (!/^\d+$/.test(mm) || !/^\d+$/.test(dd) || !/^\d+$/.test(yy)) return null;
  } else {
    if (!/^\d+$/.test(s)) return null;
    if (s.length === 8) {
      mm = s.slice(0, 2); dd = s.slice(2, 4); yy = s.slice(4);
    } else if (s.length === 7) {
      mm = s.slice(0, 1); dd = s.slice(1, 3); yy = s.slice(3);
    } else if (s.length === 6) {
      mm = s.slice(0, 1); dd = s.slice(1, 2); yy = s.slice(2);
    } else if (s.length === 5) {
      mm = s.slice(0, 1); dd = s.slice(1, 3); yy = s.slice(3);
    } else if (s.length === 4) {
      mm = s.slice(0, 1); dd = s.slice(1, 2); yy = s.slice(2);
    } else {
      return null;
    }
  }
  const month = parseInt(mm, 10);
  const day = parseInt(dd, 10);
  let year = parseInt(yy, 10);
  if (isNaN(month) || isNaN(day) || isNaN(year)) return null;
  if (yy.length === 2) year = year > 50 ? 1900 + year : 2000 + year;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (year < 1900 || year > 2100) return null;
  const d = new Date(year, month - 1, day);
  if (d.getMonth() + 1 !== month || d.getDate() !== day) return null;
  return { month, day, year, date: d };
}

/** Returns the JS Date if `str` parses cleanly, else `null`. */
export function parseDob(str) {
  const parsed = parseFlexDate(str);
  return parsed ? parsed.date : null;
}

/** Returns integer years between today and `dobStr`, or `null` if unparseable. */
export function ageYears(dobStr) {
  const dob = parseDob(dobStr);
  if (!dob || isNaN(dob)) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const md = today.getMonth() - dob.getMonth();
  if (md < 0 || (md === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

/**
 * Returns `null` if `v` parses as a past date and the resulting age is
 * 18..110, otherwise returns a displayable error string. (string|null
 * family.)
 */
export function dobAdult(v) {
  const fmt = validators.flexDateInPast(v);
  if (fmt) return fmt;
  const age = ageYears(v);
  if (age === null) return 'Enter a valid date';
  if (age < 18) return 'Applicant must be 18 or older';
  if (age > 110) return 'Enter a valid date of birth';
  return null;
}

/**
 * Format a phone string for display: keep up to 10 digits, render as
 * `(###) ###-####`. Returns `''` for empty input.
 */
export function formatPhoneDisplay(digits) {
  const d = String(digits || '').replace(/\D/g, '').slice(0, 10);
  if (d.length === 0) return '';
  if (d.length < 4) return '(' + d;
  if (d.length < 7) return '(' + d.slice(0, 3) + ') ' + d.slice(3);
  return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
}
