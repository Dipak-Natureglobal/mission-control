// Contact-form helpers for mission-control's AddContactModal.
//
// Wave 15c-fu: pure validators + normalizers (isValidEmail,
// isValidUSPhone10, normalizePhoneE164, normalizeZip5, isValidZip5)
// graduated to `blinker-platform/utils`. This file re-exports them so
// existing AddContactModal imports keep working.
//
// v3.0.15 (ADR 27 D1): the pure, workflow-agnostic dedupe / household
// helpers (`findContactMatch`, `buildHouseholdRelationship`,
// `HOUSEHOLD_RELATIONSHIP_KINDS`) ALSO graduated to
// `blinker-platform/utils` (file `contact-identity.js`) — they are now
// shared with the insurance LeadOriginationForm's contact-details gate.
// This file re-exports them too, so `AddContactModal`'s existing
// `from '../lib/contact-form.js'` import surface is 100% unchanged.
//
// `validateContactForm` stays mc-local — it is bound to
// `AddContactModal`'s specific flat form shape (`form.first_name`,
// `form.address.zip`) and does not generalize.
//
// Public surface (unchanged for callers):
//   isValidEmail(s)              → boolean   [from blinker-platform/utils]
//   isValidUSPhone10(s)          → boolean   [from blinker-platform/utils]
//   normalizePhoneE164(s)        → '+1XXXXXXXXXX' | ''  [from blinker-platform/utils]
//   normalizeZip5(s)             → 'XXXXX' | ''         [from blinker-platform/utils]
//   isValidZip5(s)               → boolean              [from blinker-platform/utils]
//   findContactMatch(contacts, opts) → match | null     [from blinker-platform/utils]
//   buildHouseholdRelationship({ ... })                 [from blinker-platform/utils]
//   HOUSEHOLD_RELATIONSHIP_KINDS                        [from blinker-platform/utils]
//   validateContactForm(form)    → { valid, errors }    (mc-local; uses
//                                                        the lifted
//                                                        validators
//                                                        internally)

// Re-export the lifted boolean validators / normalizers AND the lifted
// dedupe / household helpers so existing AddContactModal imports
// (`from '../lib/contact-form.js'`) keep working. `validateContactForm`
// below references the validators directly.
import {
  isValidEmail,
  isValidUSPhone10,
  isValidZip5,
  normalizePhoneE164,
  normalizeZip5,
} from 'blinker-platform/utils';
import {
  HOUSEHOLD_RELATIONSHIP_KINDS,
  buildHouseholdRelationship,
  findContactMatch,
} from 'blinker-platform/utils';

export {
  isValidEmail,
  isValidUSPhone10,
  normalizePhoneE164,
  normalizeZip5,
  isValidZip5,
  HOUSEHOLD_RELATIONSHIP_KINDS,
  buildHouseholdRelationship,
  findContactMatch,
};

// Aggregate save-time validation. Returns { valid: bool, errors: {field: msg} }.
// Rules:
//   - first/last required
//   - phone OR email required (not both blank)
//   - phone (if present) must be 10 digits
//   - email (if present) must look valid
//   - zip required + 5 digits
export function validateContactForm(form) {
  const errors = {};
  if (!form.first_name?.trim()) errors.first_name = 'First name required';
  if (!form.last_name?.trim()) errors.last_name = 'Last name required';

  const hasPhone = !!form.phone?.trim();
  const hasEmail = !!form.email?.trim();
  if (!hasPhone && !hasEmail) {
    errors.phone = 'Phone or email required';
    errors.email = 'Phone or email required';
  } else {
    if (hasPhone && !isValidUSPhone10(form.phone)) {
      errors.phone = 'Enter a 10-digit US phone';
    }
    if (hasEmail && !isValidEmail(form.email)) {
      errors.email = 'Enter a valid email';
    }
  }

  const zip = form.address?.zip;
  if (!zip?.trim()) {
    errors.zip = 'ZIP required';
  } else if (!isValidZip5(zip)) {
    errors.zip = 'Enter a 5-digit ZIP';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
