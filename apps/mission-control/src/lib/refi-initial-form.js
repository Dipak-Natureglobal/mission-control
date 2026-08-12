// Pure helpers for the externally-owned refi wizard form that mission-
// control hosts inside the CoPilot embed. Lives here (mission-control
// side) because refi's wizard form is owned EXTERNALLY by the embedder —
// refi-portal/AgentView reads `form` / `update` props rather than
// seeding internally. So the mapping + prefill logic belongs to
// whichever side owns the form, which is us.
//
// Shared between:
//   * src/components/CoPilotPane.jsx — RefiAgentEmbedInner, seeds on
//                                      mount + registers the reset
//                                      callback for RefiDevControls.
//   * src/App.jsx — wizardNav / formState wiring inside the consolidated
//                   DevPanel: applyPrefill calls buildPrefillPatch to
//                   convert the wrapped {applicant, coApplicant, vehicle}
//                   shape RefiDevControls passes into a flat patch the
//                   wizard form expects.
//
// `INITIAL_FORM` is supplied as the first arg to buildRefiInitialForm
// rather than imported here so this module stays free of the lazy
// refi-portal chunk. CoPilotPane already lazy-loads INITIAL_FORM.

// Mirrors refi-portal/src/refinance-v2-prototype.jsx RELATIONSHIP_OPTIONS
// (line 77). Inlined here to avoid pulling the refi monolith into this
// shared lib module just for one constant. If refi-portal exposes this
// publicly later, swap the inline copy for an import. Phase 2 cleanup.
const REFI_RELATIONSHIP_OPTIONS = [
  'Spouse',
  'Child',
  'Parent',
  'Sibling',
  'Grandparent',
  'Relative',
  'Domestic Partner',
  'Roommate',
  'Other',
];

// buildPrefillPatch — port of refi-portal/src/App.jsx buildPrefillPatch
// (~L73). Accepts a wrapped payload `{ vehicle, applicant, coApplicant }`
// (the shape every PREFILL_PRESETS entry inside RefiDevControls uses)
// AND a flat patch (anything that's not wrapped). Returns the flat patch
// the wizard form expects so consumers can pass it straight to update().
//
// When refi-portal eventually exposes this on its public lib surface,
// remove this copy.
export function buildPrefillPatch(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const isWrapped = payload.vehicle || payload.applicant || payload.coApplicant;
  if (!isWrapped) return payload;
  const vehicle = payload.vehicle || {};
  const applicant = payload.applicant || {};
  const coApplicant = payload.coApplicant || {};
  const patch = {};
  if (vehicle && Object.keys(vehicle).length) {
    if ('vin' in vehicle) patch.vin = String(vehicle.vin || '').toUpperCase();
    if ('year' in vehicle) patch.year = vehicle.year || null;
    if ('make' in vehicle) patch.make = vehicle.make || '';
    if ('model' in vehicle) patch.model = vehicle.model || '';
    if ('trim' in vehicle) patch.trim = vehicle.trim || '';
    if ('mileage' in vehicle) patch.mileage = vehicle.mileage || 0;
    if ('condition' in vehicle) patch.condition = vehicle.condition || 'Used';
  }
  if (applicant && Object.keys(applicant).length) {
    if ('firstName' in applicant) patch.firstName = applicant.firstName || '';
    if ('lastName' in applicant) patch.lastName = applicant.lastName || '';
    if ('phone' in applicant) {
      patch.phone = String(applicant.phone || '').replace(/\D/g, '').slice(0, 10);
    }
    if ('email' in applicant) patch.email = applicant.email || '';
  }
  if (coApplicant && Object.keys(coApplicant).length) {
    if ('firstName' in coApplicant) patch.coAppFirst = coApplicant.firstName || '';
    if ('lastName' in coApplicant) patch.coAppLast = coApplicant.lastName || '';
    if ('phone' in coApplicant) {
      patch.coAppPhone = String(coApplicant.phone || '').replace(/\D/g, '').slice(0, 10);
    }
    if ('email' in coApplicant) patch.coAppEmail = coApplicant.email || '';
    if ('relationship' in coApplicant) {
      const rel = coApplicant.relationship || '';
      if (REFI_RELATIONSHIP_OPTIONS.includes(rel)) {
        patch.coAppRelationship = rel;
        patch.coAppRelationshipOther = '';
      } else if (rel) {
        patch.coAppRelationship = 'Other';
        patch.coAppRelationshipOther = rel;
      }
    }
  }
  return patch;
}

export function buildRefiInitialForm(INITIAL_FORM, orgId, contact, vehicle) {
  const seed = { ...INITIAL_FORM, org_id: orgId };
  if (contact) {
    const primaryEmail =
      (contact.emails || []).find((e) => e.is_primary) || (contact.emails || [])[0];
    const primaryPhone =
      (contact.phones || []).find((p) => p.is_primary) || (contact.phones || [])[0];
    const primaryAddress =
      (contact.addresses || []).find((a) => a.is_primary) || (contact.addresses || [])[0];
    seed.firstName = contact.name?.first || '';
    seed.lastName = contact.name?.last || '';
    seed.email = primaryEmail?.address || '';
    // Strip leading +1 to leave a 10-digit number for the refi wizard's
    // phone field (matches the prototype's expected scalar shape).
    seed.phone = primaryPhone?.number
      ? primaryPhone.number.replace(/^\+1/, '')
      : '';
    seed.address = primaryAddress?.line_1 || '';
    seed.city = primaryAddress?.city || '';
    seed.state = primaryAddress?.state || '';
    seed.zip = primaryAddress?.postal_code || '';
  }
  if (vehicle) {
    seed.vin = vehicle.vin || '';
    seed.year = vehicle.year ?? null;
    seed.make = vehicle.make || '';
    seed.model = vehicle.model || '';
    seed.trim = vehicle.trim || '';
    seed.mileage = vehicle.mileage ?? INITIAL_FORM.mileage;
    seed.vinDecoded = vehicle.source === 'vin_decode';
  }
  return seed;
}
