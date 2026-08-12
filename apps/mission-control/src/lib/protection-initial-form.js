// Pure helper for the externally-owned protection wizard form that
// mission-control hosts inside the CoPilot embed. Mirrors
// `src/lib/refi-initial-form.js` for protection-portal's INITIAL_FORM
// shape.
//
// Protection-portal's AgentView ALREADY has its own internal
// `buildInitialFormSeed(contact, vehicle)` (see
// protection-portal/src/views/agent/AgentView.jsx ~L85). We duplicate
// the mapping rules here so mission-control can SEED `protectionForm`
// on context BEFORE AgentView mounts — once seeded, AgentView's
// optional `form`/`update` props (commit f2ba7a5) win and the internal
// fallback is bypassed.
//
// The duplication is intentional and flagged for a Phase 2 cleanup:
// lift `buildInitialFormSeed` to protection-portal's public surface
// (e.g. `protection-portal/src/lib/initial-form.js`) and import it
// here. For now the cost of one mirrored helper is lower than touching
// the portal-side surface from this commit.
//
// `INITIAL_FORM` is supplied as the first arg rather than imported
// here so this module stays free of the protection-portal chunk.
// CoPilotPane already eager-imports INITIAL_FORM alongside AgentView.

// Wave 31 v3.0.11 — accepts an optional `prefill` object (4th arg) that
// overlays additional protection-form fields on top of the
// contact/vehicle seed. Sourced from `opportunity._prefill` on the
// spawned protection opportunity when an insurance CoPilot's Find
// Coverage CTA mints one. Carries the data protection's step-1
// (VehicleAdd) and step-2 (VehicleDrive) would otherwise collect:
//   mileage, condition, purchase_date, annual_miles_estimate,
//   year, make, model, trim, vin
// Pre-existing callers that pass only (INITIAL_FORM, contact, vehicle)
// are unaffected — `prefill` defaults to null and the overlay is a
// no-op. The overlay applies AFTER the contact/vehicle merge so it can
// supersede any stale label-only data.
export function buildProtectionInitialForm(INITIAL_FORM, contact, vehicle, prefill = null) {
  if (!contact && !vehicle && !prefill) return INITIAL_FORM;

  const seed = { ...INITIAL_FORM };

  if (contact) {
    if (contact.org_id !== undefined && contact.org_id !== null) {
      seed.org_id = contact.org_id;
    }

    const emails = Array.isArray(contact.emails) ? contact.emails : [];
    const primaryEmail = emails.find((e) => e?.is_primary) || emails[0] || null;

    const phones = Array.isArray(contact.phones) ? contact.phones : [];
    const primaryPhone = phones.find((p) => p?.is_primary) || phones[0] || null;
    let phoneStr = primaryPhone?.number ? String(primaryPhone.number) : '';
    if (phoneStr.startsWith('+1')) phoneStr = phoneStr.slice(2);

    const addresses = Array.isArray(contact.addresses) ? contact.addresses : [];
    const primaryAddr =
      addresses.find((a) => a?.is_primary) || addresses[0] || null;

    seed.contact = {
      ...INITIAL_FORM.contact, // preserves tags: [], tagsCreated: []
      ...(contact.name?.first ? { first_name: contact.name.first } : null),
      ...(contact.name?.last ? { last_name: contact.name.last } : null),
      ...(primaryEmail?.address ? { email: primaryEmail.address } : null),
      ...(phoneStr ? { phone: phoneStr } : null),
      ...(primaryAddr?.line_1 ? { address1: primaryAddr.line_1 } : null),
      ...(primaryAddr?.city ? { city: primaryAddr.city } : null),
      ...(primaryAddr?.state ? { state: primaryAddr.state } : null),
      ...(primaryAddr?.postal_code ? { zip: primaryAddr.postal_code } : null),
      // Pass through household_members so the cross-sell refi co-applicant
      // prompt can offer them. Resolved by mission-control's CoPilotPane
      // when contact has household_member_ids; absent or [] otherwise.
      ...(Array.isArray(contact.household_members)
        ? { household_members: contact.household_members }
        : null),
    };
  }

  if (vehicle) {
    seed.vin = vehicle.vin || '';
    seed.year = vehicle.year ?? null;
    seed.make = vehicle.make || '';
    seed.model = vehicle.model || '';
    seed.trim = vehicle.trim || '';
    if (vehicle.mileage !== undefined && vehicle.mileage !== null) {
      seed.mileage = vehicle.mileage;
    }
    seed.vehicle = {
      year: vehicle.year ?? null,
      make: vehicle.make || '',
      model: vehicle.model || '',
      trim: vehicle.trim || '',
      vin: vehicle.vin || '',
      source: vehicle.source || 'mission_control_prefill',
    };
    if (vehicle.source === 'vin_decode') {
      seed.vinDecoded = true;
    }
  }

  // Wave 31 — prefill overlay. Each field is applied defensively so a
  // partial prefill (e.g. mileage only) doesn't blow away an existing
  // contact/vehicle-seeded value with undefined. The full set the
  // insurance→protection spawn carries today:
  if (prefill && typeof prefill === 'object') {
    if (prefill.vin) {
      seed.vin = prefill.vin;
      if (seed.vehicle) seed.vehicle.vin = prefill.vin;
    }
    if (prefill.year != null) {
      seed.year = prefill.year;
      if (seed.vehicle) seed.vehicle.year = prefill.year;
    }
    if (prefill.make) {
      seed.make = prefill.make;
      if (seed.vehicle) seed.vehicle.make = prefill.make;
    }
    if (prefill.model) {
      seed.model = prefill.model;
      if (seed.vehicle) seed.vehicle.model = prefill.model;
    }
    if (prefill.trim) {
      seed.trim = prefill.trim;
      if (seed.vehicle) seed.vehicle.trim = prefill.trim;
    }
    if (prefill.mileage != null) {
      seed.mileage = prefill.mileage;
    }
    if (prefill.condition) {
      seed.condition = prefill.condition;
    }
    if (prefill.purchase_date) {
      seed.purchaseDate = prefill.purchase_date;
    }
    if (prefill.annual_miles_estimate != null) {
      seed.annualMileageEstimate = prefill.annual_miles_estimate;
    }
    // Wave 31b-fu5 — overlay insurance savings so RecommendedCoverage
    // (step 5) renders the boost-slot, dual-price strikethrough, and
    // footnote on a spawned protection opp without requiring the user to
    // re-run the cross-sell inside the protection wizard.
    //
    // Only applied when the adapter returned a non-null result
    // (quote.completed fired and produced a measurable outcome —
    // savings_found OR no_savings). null is left as the default
    // (form.insuranceSavings = null per INITIAL_FORM) so opps spawned
    // before quote.completed, or opened via non-insurance paths, stay in
    // the "cross-sell not yet run" state inside RecommendedCoverage.
    if (prefill.insurance_savings != null) {
      seed.insuranceSavings = prefill.insurance_savings;
    }
  }

  return seed;
}
