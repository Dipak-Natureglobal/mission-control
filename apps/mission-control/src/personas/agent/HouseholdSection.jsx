// HouseholdSection — Wave 19 Task 5.
//
// Hosts the householding UI for ContactProfile: render existing household
// members (with relationship pill + "Added X ago" hint), plus an inline
// "Add household member" affordance that searches the existing contact
// directory OR mints a new minimal contact, asks for the relationship via
// blinker-platform's RelationshipPicker, and persists the link.
//
// Lifted out of ContactProfile.jsx so the per-section logic stays
// readable while ContactProfile.jsx grows. Coexists with Wave 19 Tasks
// 3+4's TagsSection / OpportunitySummary in the same screen.
//
// Persistence: contact-storage.js household helpers (Phase 1 localStorage
// shim) PLUS the session-data appendHouseholdRelationship for the
// in-memory contact map (so household_member_ids cross-link without a
// page reload). Activities are dual-written via blinkerApi.activities.
//
// Permissions: any persona except `consumer` can add. Remove is gated to
// manager+ (matches the brief's "Remove household member affordance —
// gated to manager or above").
//
// Canon: relationship option list comes from canon/relationships.json
// `system_types` merged with the per-org custom list from
// fixtures/relationship-types-custom.json (forward-compat empty file).
// RelationshipPicker reads canon directly when no `options` prop is
// passed; we pass the merged list explicitly so the org-custom row is
// included once Agent D's super-admin shell starts populating it.

import { useMemo, useState } from 'react';
import { Plus, Search, Trash2, Users, X } from 'lucide-react';
import { RelationshipPicker } from 'blinker-platform/components';
import { track } from 'blinker-platform/telemetry';
import { blinkerApi } from 'blinker-platform/api';
import relationshipsCanon from '../../constants/canon/relationships.json';
import customRelationshipsFixture from '../../fixtures/relationship-types-custom.json';
import {
  listHouseholdMembers,
  addHouseholdMember,
  removeHouseholdMember,
  mintHouseholdId,
} from '../../lib/contact-storage.js';
import { relativeTime } from '../../lib/canon.js';

// Build the effective relationship-type list: canon system_types + per-org
// custom additions. Today the custom block is empty (Agent D's Wave 19
// Task 6 super-admin shell will populate it). Keys by id, system wins.
function buildRelationshipOptions(orgId) {
  const sys = Array.isArray(relationshipsCanon.system_types)
    ? relationshipsCanon.system_types
    : [];
  const customByOrg = customRelationshipsFixture.custom_types_by_org || {};
  const custom = (customByOrg[String(orgId)] || []).filter((c) => c && c.id);
  const seen = new Set(sys.map((o) => o.id));
  const out = [...sys];
  for (const c of custom) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

// Resolve a relationship slug → display label (canon + per-org).
function relationshipLabelFor(slug, options) {
  if (!slug) return '';
  const hit = options.find((o) => o.id === slug);
  return hit?.label || slug;
}

// Build a minimal contact record for the "Create new contact" branch.
// Mirrors AddContactModal's buildContactRecord but stripped to the bare
// minimum (no address — agent can flesh out via the contact's profile).
function buildMinimalContactRecord({ first, last, phone, email, orgId }) {
  const stamp =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}`;
  const id = `ct_session_${stamp}`;
  const now = new Date().toISOString();
  const phoneDigits = (phone || '').replace(/\D/g, '');
  const phoneE164 =
    phoneDigits.length === 10 ? `+1${phoneDigits}` : phoneDigits.length === 11 && phoneDigits.startsWith('1') ? `+${phoneDigits}` : '';
  const cleanEmail = (email || '').trim();
  return {
    id,
    org_id: orgId ?? null,
    external_ids: {
      ghl_contact_id: null,
      posthog_distinct_id: id,
      external_lead_id: null,
    },
    household_id: null,
    name: {
      first: (first || '').trim(),
      last: (last || '').trim(),
    },
    date_of_birth: null,
    phones: phoneE164
      ? [
          {
            id: `ph_${id}_1`,
            type: 'mobile',
            number: phoneE164,
            is_primary: true,
            sms_consent: false,
            do_not_contact: false,
          },
        ]
      : [],
    emails: cleanEmail
      ? [
          {
            id: `em_${id}_1`,
            type: 'personal',
            address: cleanEmail,
            is_primary: true,
            opted_out: false,
          },
        ]
      : [],
    addresses: [],
    vehicles: [],
    opportunity_ids: [],
    household_member_ids: [],
    tags: [],
    notes_ref: { collection: 'note', filter: { contact_id: id }, sort: 'created_at desc' },
    activities_ref: {
      collection: 'activity',
      filter: { contact_id: id },
      sort: 'occurred_at desc',
    },
    attribution_data: {
      first_utm_source: 'mission_control_household_add',
      first_utm_medium: 'agent',
      first_landing_page: null,
      first_touch_at: now,
    },
    consent: {
      tcpa_consents: [],
      marketing_email: { opted_in: false },
      tos_accepted_at: null,
    },
    created_at: now,
    updated_at: now,
  };
}

function formatPhone(e164) {
  if (!e164) return '—';
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (m) return `(${m[1]}) ${m[2]}-${m[3]}`;
  return e164;
}

function fullName(c) {
  if (!c?.name) return '';
  return c.name.preferred || `${c.name.first || ''} ${c.name.last || ''}`.trim();
}

// ─────────────────────────────────────────────────────────────────────────

export function HouseholdSection({
  contact,
  contacts,
  persona = 'agent',
  patchContact,
  appendContact,
  appendHouseholdRelationship,
  onMemberClick,
}) {
  const contactId = contact.id;
  const orgId = contact.org_id ?? 102;
  const canManage = persona !== 'consumer';
  const canRemove =
    persona === 'manager' || persona === 'admin' || persona === 'super_admin';

  // Relationship option inventory — canon + per-org custom merge.
  const relationshipOptions = useMemo(
    () => buildRelationshipOptions(orgId),
    [orgId],
  );

  // Member-link state — seeded from the contact's existing
  // household_member_ids on first read, then localStorage-backed.
  const [memberLinks, setMemberLinks] = useState(() =>
    listHouseholdMembers({
      contact_id: contactId,
      fixtureMemberIds: contact.household_member_ids || [],
      fixtureHouseholdId: contact.household_id || null,
    }),
  );

  const [adderOpen, setAdderOpen] = useState(false);

  // Hydrate the link records into full member-row data (joining the
  // contacts map for name/phone). Filter out any links pointing to
  // contacts that aren't in scope (e.g. fixture member id with no
  // matching record).
  const memberRows = useMemo(() => {
    return memberLinks
      .map((link) => {
        const member = contacts[link.member_contact_id];
        if (!member) return null;
        return { link, member };
      })
      .filter(Boolean);
  }, [memberLinks, contacts]);

  function handleAddMember({ memberContact, relationship, relationshipOther }) {
    if (!memberContact || !relationship) return;

    // Mint or reuse the household_id. If this contact is solo today,
    // we mint a fresh hh_<contactId>_<unix> and stamp it on both
    // contacts via patchContact so future reads from the contact map
    // see the household linkage without a reload.
    const householdId =
      contact.household_id || mintHouseholdId(contactId);
    const now = new Date().toISOString();

    // 1. Persist the link on THIS contact's localStorage shim.
    const nextLinks = addHouseholdMember({
      contact_id: contactId,
      member_contact_id: memberContact.id,
      relationship,
      relationship_other: relationshipOther,
      household_id: householdId,
      added_at: now,
    });
    setMemberLinks(nextLinks);

    // 2. Persist the reverse link on the OTHER contact's storage so
    // when the agent navigates to that contact's profile, the
    // relationship is visible from their side too.
    addHouseholdMember({
      contact_id: memberContact.id,
      member_contact_id: contactId,
      relationship,
      relationship_other: relationshipOther,
      household_id: householdId,
      added_at: now,
    });

    // 3. Cross-link via session-data so the in-memory contact map's
    // household_member_ids + household_id reflect the relationship.
    if (typeof appendHouseholdRelationship === 'function') {
      appendHouseholdRelationship({
        id: `hr_${contactId}_${memberContact.id}_${Date.now()}`,
        contact_a_id: contactId,
        contact_b_id: memberContact.id,
        kind: relationship,
        kind_other: relationshipOther || null,
        recorded_at: now,
        source: 'agent_household_section',
      });
    }
    // Stamp the household_id onto both contacts so canon contract holds.
    if (typeof patchContact === 'function') {
      if (!contact.household_id) {
        patchContact(contactId, { household_id: householdId });
      }
      if (!memberContact.household_id) {
        patchContact(memberContact.id, { household_id: householdId });
      }
    }

    // 4. Activity dual-write (canon contract).
    blinkerApi.activities.create({
      contact_id: contactId,
      type: 'household.member_added',
      source: 'agent',
      actor_id: 'agent_session',
      payload: {
        member_contact_id: memberContact.id,
        relationship,
        relationship_other: relationshipOther || null,
        household_id: householdId,
      },
      summary_text: `Household member added: ${fullName(memberContact)} (${relationshipLabelFor(
        relationship,
        relationshipOptions,
      )})`,
    });
    blinkerApi.activities.create({
      contact_id: memberContact.id,
      type: 'household.member_added',
      source: 'agent',
      actor_id: 'agent_session',
      payload: {
        member_contact_id: contactId,
        relationship,
        relationship_other: relationshipOther || null,
        household_id: householdId,
      },
      summary_text: `Household member added: ${fullName(contact)} (${relationshipLabelFor(
        relationship,
        relationshipOptions,
      )})`,
    });

    // 5. PostHog.
    track('mission_control.contact_profile.household_member_added', {
      contact_id: contactId,
      member_contact_id: memberContact.id,
      relationship,
    });

    setAdderOpen(false);
  }

  function handleRemove(memberContactId) {
    const link = memberLinks.find((l) => l.member_contact_id === memberContactId);
    const member = contacts[memberContactId];

    const nextLinks = removeHouseholdMember({
      contact_id: contactId,
      member_contact_id: memberContactId,
    });
    setMemberLinks(nextLinks);
    // Reverse-side mirror.
    removeHouseholdMember({
      contact_id: memberContactId,
      member_contact_id: contactId,
    });

    // Activity dual-write.
    blinkerApi.activities.create({
      contact_id: contactId,
      type: 'household.member_removed',
      source: 'agent',
      actor_id: 'agent_session',
      payload: {
        member_contact_id: memberContactId,
        relationship: link?.relationship || null,
      },
      summary_text: `Household member removed: ${member ? fullName(member) : memberContactId}`,
    });
    if (member) {
      blinkerApi.activities.create({
        contact_id: memberContactId,
        type: 'household.member_removed',
        source: 'agent',
        actor_id: 'agent_session',
        payload: {
          member_contact_id: contactId,
          relationship: link?.relationship || null,
        },
        summary_text: `Household member removed: ${fullName(contact)}`,
      });
    }

    track('mission_control.contact_profile.household_member_removed', {
      contact_id: contactId,
      member_contact_id: memberContactId,
    });
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Users className="w-3.5 h-3.5 text-slate-500" />
        <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
          Household
        </div>
        {canManage && !adderOpen && (
          <button
            onClick={() => setAdderOpen(true)}
            className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-white"
          >
            <Plus className="w-3 h-3" />
            Add household member
          </button>
        )}
      </div>

      {contact.household_id && (
        <div className="text-[11px] font-mono text-slate-500 mb-2">
          {contact.household_id}
        </div>
      )}

      {memberRows.length === 0 && !adderOpen && (
        <div className="text-xs text-slate-400">
          {contact.household_id
            ? 'Clustered, but no other members on file yet.'
            : 'Solo contact — not yet clustered into a household.'}
        </div>
      )}

      {memberRows.length > 0 && (
        <ul className="space-y-1.5">
          {memberRows.map(({ link, member }) => {
            const primaryPhone =
              (member.phones || []).find((p) => p.is_primary) ||
              (member.phones || [])[0];
            const memberName = fullName(member);
            const relLabel = relationshipLabelFor(link.relationship, relationshipOptions);
            const showOther = link.relationship === 'other' && link.relationship_other;
            return (
              <li key={member.id}>
                <div className="group w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-slate-50 hover:bg-slate-100">
                  <button
                    onClick={() => onMemberClick && onMemberClick(member.id)}
                    className="flex-1 min-w-0 flex items-center gap-2 text-left"
                  >
                    <span className="text-sm text-slate-900 font-medium truncate">
                      {memberName}
                    </span>
                    {relLabel && (
                      <span
                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200"
                        title={
                          showOther ? `Other: ${link.relationship_other}` : relLabel
                        }
                      >
                        {showOther ? `Other · ${link.relationship_other}` : relLabel}
                      </span>
                    )}
                  </button>
                  <span className="text-xs text-slate-500 font-mono shrink-0">
                    {primaryPhone ? formatPhone(primaryPhone.number) : '—'}
                  </span>
                  <span className="text-[10px] text-slate-400 shrink-0">
                    Added {relativeTime(link.added_at)}
                  </span>
                  {canRemove && (
                    <button
                      onClick={() => handleRemove(member.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-rose-100 text-rose-500"
                      title="Remove from household"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {adderOpen && (
        <HouseholdAdder
          contact={contact}
          contacts={contacts}
          orgId={orgId}
          relationshipOptions={relationshipOptions}
          appendContact={appendContact}
          existingMemberIds={memberLinks.map((l) => l.member_contact_id)}
          onCancel={() => setAdderOpen(false)}
          onSubmit={handleAddMember}
        />
      )}
    </div>
  );
}

// ─── Inline add affordance ─────────────────────────────────────────────
//
// Dual-mode: search existing contacts OR create a new one. Always asks
// for relationship before save (RelationshipPicker is required).
function HouseholdAdder({
  contact,
  contacts,
  orgId,
  relationshipOptions,
  appendContact,
  existingMemberIds,
  onCancel,
  onSubmit,
}) {
  const [mode, setMode] = useState('search'); // 'search' | 'create'
  const [query, setQuery] = useState('');
  const [selectedMember, setSelectedMember] = useState(null); // contact or null
  const [relationship, setRelationship] = useState(null);
  const [relationshipOther, setRelationshipOther] = useState('');

  // Create-mode form
  const [newFirst, setNewFirst] = useState('');
  const [newLast, setNewLast] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');

  // Live search over the contacts directory. Filters: same-org, NOT this
  // contact, NOT already a household member. Matches against name / phone
  // (digits only) / email substrings. Hidden when query is < 2 chars.
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const qDigits = q.replace(/\D/g, '');
    const blockSet = new Set([contact.id, ...existingMemberIds]);
    return Object.values(contacts)
      .filter((c) => c.org_id === orgId)
      .filter((c) => !blockSet.has(c.id))
      .filter((c) => {
        const nm = fullName(c).toLowerCase();
        if (nm.includes(q)) return true;
        if (
          qDigits.length >= 3 &&
          (c.phones || []).some((p) =>
            (p.number || '').replace(/\D/g, '').includes(qDigits),
          )
        ) {
          return true;
        }
        if ((c.emails || []).some((e) => (e.address || '').toLowerCase().includes(q))) {
          return true;
        }
        return false;
      })
      .slice(0, 8);
  }, [query, contacts, contact.id, orgId, existingMemberIds]);

  // PostHog: fire one event per query-stop (debounce-light: fire when the
  // user has typed and we have a result count to report).
  function handleQueryChange(next) {
    setQuery(next);
    if (next.trim().length >= 2) {
      track('mission_control.contact_profile.household_search_performed', {
        query_length: next.trim().length,
        result_count: searchResults.length,
      });
    }
  }

  function handleSave() {
    if (!relationship) return;
    let memberContact = selectedMember;
    if (mode === 'create') {
      if (!newFirst.trim() || !newLast.trim()) return;
      memberContact = buildMinimalContactRecord({
        first: newFirst,
        last: newLast,
        phone: newPhone,
        email: newEmail,
        orgId,
      });
      if (typeof appendContact === 'function') appendContact(memberContact);
    }
    if (!memberContact) return;
    onSubmit({
      memberContact,
      relationship,
      relationshipOther: relationship === 'other' ? relationshipOther : '',
    });
  }

  const canSave =
    !!relationship &&
    (mode === 'search'
      ? !!selectedMember
      : !!newFirst.trim() && !!newLast.trim()) &&
    (relationship !== 'other' || !!relationshipOther.trim());

  return (
    <div className="bg-white ring-1 ring-slate-200 rounded-md p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide font-semibold text-slate-600">
          Add household member
        </div>
        <button
          onClick={onCancel}
          className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"
          title="Cancel"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex gap-1">
        <button
          onClick={() => {
            setMode('search');
            setSelectedMember(null);
          }}
          className={
            'text-xs font-medium px-2.5 py-1 rounded-md ' +
            (mode === 'search'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
          }
        >
          Search existing
        </button>
        <button
          onClick={() => {
            setMode('create');
            setSelectedMember(null);
          }}
          className={
            'text-xs font-medium px-2.5 py-1 rounded-md ' +
            (mode === 'create'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
          }
        >
          Create new
        </button>
      </div>

      {mode === 'search' && (
        <div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Search by name, phone, or email…"
              className="w-full text-sm border border-slate-200 rounded-md pl-8 pr-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {selectedMember ? (
            <div className="mt-2 flex items-center gap-2 px-2.5 py-2 rounded-md bg-blue-50 ring-1 ring-blue-200">
              <span className="text-sm font-medium text-slate-900">
                {fullName(selectedMember)}
              </span>
              <span className="text-xs font-mono text-slate-500">
                {(selectedMember.phones || [])[0]
                  ? formatPhone(selectedMember.phones[0].number)
                  : '—'}
              </span>
              <button
                onClick={() => setSelectedMember(null)}
                className="ml-auto text-xs text-slate-500 hover:text-slate-700"
              >
                Change
              </button>
            </div>
          ) : query.trim().length >= 2 ? (
            searchResults.length === 0 ? (
              <div className="mt-2 text-xs text-slate-400 px-2.5 py-2">
                No matching contacts. Try “Create new” instead.
              </div>
            ) : (
              <ul className="mt-2 max-h-44 overflow-auto ring-1 ring-slate-200 rounded-md divide-y divide-slate-100">
                {searchResults.map((c) => {
                  const primaryPhone =
                    (c.phones || []).find((p) => p.is_primary) ||
                    (c.phones || [])[0];
                  return (
                    <li key={c.id}>
                      <button
                        onClick={() => setSelectedMember(c)}
                        className="w-full flex items-center justify-between gap-3 px-2.5 py-1.5 hover:bg-slate-50 text-left"
                      >
                        <span className="text-sm text-slate-900 font-medium truncate">
                          {fullName(c)}
                        </span>
                        <span className="text-xs text-slate-500 font-mono shrink-0">
                          {primaryPhone ? formatPhone(primaryPhone.number) : '—'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          ) : (
            <div className="mt-2 text-[11px] text-slate-400 px-1">
              Type 2+ characters to search the contact directory.
            </div>
          )}
        </div>
      )}

      {mode === 'create' && (
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            value={newFirst}
            onChange={(e) => setNewFirst(e.target.value)}
            placeholder="First name"
            className="text-sm border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="text"
            value={newLast}
            onChange={(e) => setNewLast(e.target.value)}
            placeholder="Last name"
            className="text-sm border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="tel"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            placeholder="Phone (optional)"
            className="text-sm border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="Email (optional)"
            className="text-sm border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}

      <RelationshipPicker
        value={relationship}
        onChange={setRelationship}
        otherText={relationshipOther}
        onOtherTextChange={setRelationshipOther}
        options={relationshipOptions}
      />

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          className="text-xs font-medium px-3 py-1.5 rounded-md text-slate-600 hover:bg-slate-100"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="text-xs font-medium px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white"
        >
          Save
        </button>
      </div>
    </div>
  );
}
