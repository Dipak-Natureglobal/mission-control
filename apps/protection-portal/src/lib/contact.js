// Contact + household helpers for the BillingPayment switcher UX
// (UX feedback 2026-05-04 — agent-mode contact card with multi-contact
// + multi-address selection).
//
// Form-shape decision (Phase 1, intentionally narrow):
//   - form.contact stays a flat object: { first_name, last_name, email,
//     phone, address1, address2, city, state, zip, ... }. Confirm.jsx
//     and ThankYou.jsx already read those flat keys; we don't refactor
//     them in Phase 1.
//   - form.contact.household_members is the new array of alternates:
//       { id, first_name, last_name, email, phone,
//         addresses: [{ id, line_1, line_2, city, state, zip, is_primary }],
//         is_primary }
//   - "Active contact" = form.contact.* flat keys. Switching to a
//     different household member means re-seeding those flat keys from
//     the member's record. Editing those flat keys in agent mode means
//     mirroring the change back to the matching member entry so a
//     round-trip switch lands on the edited values.
//
// Real wiring deferred — Phase 1 ships a DEV CONTROLS toggle that seeds
// a mock household so the switcher UX is testable end-to-end.

// Build a flat-key patch for form.contact.* from a household member.
// Picks the member's primary address (or addresses[0] if no primary
// flag) and returns a single patch covering name/email/phone + the
// flat address keys. Caller is expected to feed this through
// updateContactSafe so the merge into form.contact is preserved.
export function seedActiveContact(member) {
  if (!member) return {};
  const addr = pickPrimaryAddress(member.addresses) || {};
  return {
    contact: {
      first_name: member.first_name || '',
      last_name: member.last_name || '',
      email: member.email || '',
      phone: member.phone || '',
      address1: addr.line_1 || '',
      address2: addr.line_2 || '',
      city: addr.city || '',
      state: addr.state || '',
      zip: addr.zip || '',
      active_member_id: member.id || null,
      active_address_id: addr.id || null,
    },
  };
}

// Build a flat-key patch for the address slice only — used when the
// agent picks a different address from the active contact's
// addresses[]. Leaves name/email/phone untouched.
export function seedActiveAddress(addr) {
  if (!addr) return {};
  return {
    contact: {
      address1: addr.line_1 || '',
      address2: addr.line_2 || '',
      city: addr.city || '',
      state: addr.state || '',
      zip: addr.zip || '',
      active_address_id: addr.id || null,
    },
  };
}

// Mirror an active-contact edit (name/email/phone) back into the
// matching household member so switching to a different member and
// back lands on the edited values. Returns a new household_members
// array; caller writes it back as part of an update() call.
export function mirrorContactEditsToMember(members, activeMemberId, edits) {
  if (!Array.isArray(members) || !activeMemberId) return members;
  return members.map((m) => {
    if (m.id !== activeMemberId) return m;
    return { ...m, ...edits };
  });
}

// Mirror an address edit (the agent edited the AddressBlock) back into
// the active member's matching address record so switching is round-
// trip-safe. If activeAddressId isn't set yet (we just promoted the
// member's first address), update the first address in place.
export function mirrorAddressEditsToMember(members, activeMemberId, activeAddressId, addrEdits) {
  if (!Array.isArray(members) || !activeMemberId) return members;
  return members.map((m) => {
    if (m.id !== activeMemberId) return m;
    const addresses = Array.isArray(m.addresses) ? m.addresses : [];
    if (addresses.length === 0) return m;
    let targetIdx = activeAddressId
      ? addresses.findIndex((a) => a.id === activeAddressId)
      : -1;
    if (targetIdx < 0) {
      const primaryIdx = addresses.findIndex((a) => a.is_primary);
      targetIdx = primaryIdx >= 0 ? primaryIdx : 0;
    }
    const next = addresses.slice();
    next[targetIdx] = { ...addresses[targetIdx], ...addrEdits };
    return { ...m, addresses: next };
  });
}

// Find a member's primary address, falling back to the first entry.
function pickPrimaryAddress(addresses) {
  if (!Array.isArray(addresses) || addresses.length === 0) return null;
  return addresses.find((a) => a.is_primary) || addresses[0];
}

// Find the active member by id (or fall back to the primary, then to
// the first member). Returns null when household_members is empty.
export function pickActiveMember(members, activeMemberId) {
  if (!Array.isArray(members) || members.length === 0) return null;
  if (activeMemberId) {
    const hit = members.find((m) => m.id === activeMemberId);
    if (hit) return hit;
  }
  return members.find((m) => m.is_primary) || members[0];
}

// Display label for an address dropdown row.
export function formatAddressLabel(addr) {
  if (!addr) return '';
  const line1 = addr.line_1 || '';
  const cityState = [addr.city, addr.state].filter(Boolean).join(', ');
  const tail = [cityState, addr.zip].filter(Boolean).join(' ');
  return [line1, tail].filter(Boolean).join(', ');
}

// Display label for a household-member dropdown row.
export function formatMemberLabel(member) {
  if (!member) return '';
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ').trim();
  return name || member.email || member.id || 'Unnamed';
}

// Build a Phase 1 mock household from the currently-active flat
// contact. Used by the DEV CONTROLS "Seed multi-contact household"
// toggle. Three members (primary copied from current contact, spouse,
// adult child); the child has an alternate address so the address
// switcher is exercisable.
export function buildMockHousehold(contact) {
  const c = contact || {};
  const lastName = c.last_name || 'Sample';
  const lastSlug = String(lastName).toLowerCase().replace(/[^a-z]/g, '') || 'sample';
  const primaryAddress = {
    id: 'addr_primary',
    line_1: c.address1 || '123 Main St',
    line_2: c.address2 || '',
    city: c.city || 'Austin',
    state: c.state || 'TX',
    zip: c.zip || '78701',
    is_primary: true,
  };
  const altAddress = {
    id: 'addr_college',
    line_1: '40 College Way',
    line_2: '',
    city: c.city || 'Austin',
    state: c.state || 'TX',
    zip: c.zip || '78705',
    is_primary: false,
  };
  return [
    {
      id: 'mem_primary',
      first_name: c.first_name || 'Alex',
      last_name: lastName,
      email: c.email || `alex.${lastSlug}@example.com`,
      phone: c.phone || '5551234567',
      addresses: [primaryAddress],
      is_primary: true,
    },
    {
      id: 'mem_spouse',
      first_name: 'Sam',
      last_name: lastName,
      email: `sam.${lastSlug}@example.com`,
      phone: '5552345678',
      addresses: [{ ...primaryAddress, id: 'addr_spouse_primary' }],
      is_primary: false,
    },
    {
      id: 'mem_child',
      first_name: 'Riley',
      last_name: lastName,
      email: `riley.${lastSlug}@example.com`,
      phone: '5553456789',
      addresses: [
        { ...primaryAddress, id: 'addr_child_home' },
        altAddress,
      ],
      is_primary: false,
    },
  ];
}
