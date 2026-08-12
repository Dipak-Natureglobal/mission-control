// contact-identity — shared per-org duplicate / household matching.
//
// Graduated v3.0.15 (ADR 27 D1) from mission-control/src/lib/contact-form.js.
// The logic is pure and workflow-agnostic; it powers the dedupe / household
// branch in mission-control's AddContactModal AND (v3.0.15) the insurance
// LeadOriginationForm's "Confirm your contact details" gate. The PDF Task 1
// asked for these to be shared so any view that captures a contact can drop
// in the same check.
//
// What stayed mc-local: `validateContactForm` — it is bound to
// AddContactModal's specific flat form shape (form.first_name,
// form.address.zip) and does not generalize. Each consumer writes its own
// field-shape validation.
//
// Public surface (re-exported via packages/utils/index.js):
//   findContactMatch(contacts, opts)        → match | null
//   buildHouseholdRelationship({ ... })     → household_relationship record
//   HOUSEHOLD_RELATIONSHIP_KINDS            → enum for the relationship picker

import { normalizePhoneE164 } from './validators.js';

// Relationship kinds for the different-name-match household picker.
export const HOUSEHOLD_RELATIONSHIP_KINDS = [
  { value: 'spouse', label: 'Spouse / Domestic partner' },
  { value: 'parent', label: 'Parent' },
  { value: 'child', label: 'Child' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'other', label: 'Other (housemate / relative)' },
];

// Per-org contact-match scan. Phase 1 reads against an in-memory contacts
// map or array; Phase 2 swap point is
// `await blinkerApi.contacts.search({ org_id, phone, email })`. Cross-org
// matches are NEVER returned — orgs are tenants and a phone collision across
// tenants is not the same person.
//
// `contacts` may be a map (id → contact) or an array of contact records.
//
// Returns the FIRST match by phone or email (in that order) within the
// supplied org. `currentName` is unused for matching but threaded through
// the result so the caller can decide same-name vs different-name without
// re-deriving it.
export function findContactMatch(contacts, { phone, email, orgId, currentName } = {}) {
  if (!contacts) return null;
  const normalizedPhoneE164 = normalizePhoneE164(phone || '');
  const normalizedEmail = (email || '').trim().toLowerCase();
  if (!normalizedPhoneE164 && !normalizedEmail) return null;

  const list = Array.isArray(contacts) ? contacts : Object.values(contacts);
  for (const c of list) {
    if (!c) continue;
    // Per-org guard: skip contacts in a different tenant.
    if (orgId !== undefined && c.org_id !== undefined && c.org_id !== orgId) continue;

    const phones = Array.isArray(c.phones) ? c.phones : [];
    const emails = Array.isArray(c.emails) ? c.emails : [];

    const phoneHit =
      normalizedPhoneE164 &&
      phones.some((p) => p?.number && p.number === normalizedPhoneE164);
    const emailHit =
      normalizedEmail &&
      emails.some(
        (e) => e?.address && e.address.toLowerCase() === normalizedEmail,
      );

    if (phoneHit || emailHit) {
      const nameStr = `${c.name?.first ?? ''} ${c.name?.last ?? ''}`.trim().toLowerCase();
      const sameName = currentName
        ? nameStr === String(currentName).trim().toLowerCase()
        : false;
      return {
        contact: c,
        matchedOn: phoneHit && emailHit ? 'phone+email' : phoneHit ? 'phone' : 'email',
        sameName,
      };
    }
  }
  return null;
}

// Session-only household_relationship record. Canon stub today (see
// canon/blinker-domain.json `household._TODO`). For the Phase 1 prototype
// we mint: { id, contact_a_id, contact_b_id, kind, recorded_at, source }.
// The prototype does NOT cluster into a Household entity yet — the
// relationship record alone is enough to render a "Related to: <name>
// (Spouse)" chip later.
export function buildHouseholdRelationship({ existingContactId, newContactId, kind }) {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? `hr_${crypto.randomUUID()}`
      : `hr_${Date.now()}`;
  return {
    id,
    contact_a_id: existingContactId,
    contact_b_id: newContactId,
    kind,
    recorded_at: new Date().toISOString(),
    source: 'agent_manual',
  };
}
