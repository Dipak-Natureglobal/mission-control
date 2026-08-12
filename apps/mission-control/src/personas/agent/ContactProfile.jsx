import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Activity as ActivityIcon,
  Car,
  CheckCircle,
  ChevronLeft,
  Lock,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  RotateCcw,
  Send,
  Share2,
  ShieldCheck,
  ShieldOff,
  StickyNote,
  XCircle,
} from 'lucide-react';
import { TagPicker } from 'blinker-platform/components';
import systemTagsJson from 'blinker-platform/canon/system-tags.json';
import { AddVehicleModal } from '../../components/AddVehicleModal.jsx';
import { OpportunityTypeMenu } from '../../components/OpportunityTypeMenu.jsx';
import { NewOpportunityFlow } from '../../components/NewOpportunityFlow.jsx';
import { buildNewOpp } from '../../lib/session-data.js';
import { listTags, addTag, removeTag } from '../../lib/contact-storage.js';
import { HouseholdSection } from './HouseholdSection.jsx';

const TYPE_LABEL_MAP = {
  refi: 'Refi',
  insurance: 'Insurance',
  protection: 'Protection plan',
  payments: 'Payments',
};
import {
  TYPE_LABELS,
  TYPE_BADGE,
  statusPillClasses,
  ageLabel,
  ageDays,
  relativeTime,
} from '../../lib/canon.js';
import { track } from 'blinker-platform/telemetry';
import { blinkerApi } from 'blinker-platform/api';

// ContactProfile — the Mission Control 2.0 PDF layout for a single contact.
// Sections, top to bottom:
//   1. Household panel
//   2. Contact header (preferred name, phones, emails, primary address)
//   3. Tags
//   4. Vehicles
//   5. Opportunities (with "Open in CoPilot" → AgentInbox parent state)
//   6. Notes (Wave 16 F2-fu13: reads + writes through blinkerApi.notes via
//      the platform SDK; addNote delegates to blinkerApi.addNote for the
//      canon dual-write — note record + paired type:'note' activity.
//      Storage key: blinker.notes.v1.<contact_id> / blinker.activities.v1.<contact_id>.)
//   7. Activity feed (same SDK path; fixture seed is in packages/api/_fixtures/)
//
// Right-pane routing is owned by the parent (AgentInbox). Props:
//   contactId:           the contact to render
//   onClose:             back button → returns to inbox-only view
//   onOpenInCoPilot:     opp row "Open in CoPilot" → parent switches to CoPilotPane
//   onOpenContactProfile: household-member click → parent re-targets ContactProfile

export function ContactProfile({
  contactId,
  contacts,
  opportunities: allOpportunities,
  appendOpportunity,
  appendVehicleToContact,
  patchContact,
  appendContact,
  appendHouseholdRelationship,
  persona = 'agent',
  onClose,
  onOpenInCoPilot,
  onOpenContactProfile,
  testMode = false,
}) {
  const contact = contacts[contactId];

  useEffect(() => {
    if (!contact) return;
    track('mission_control.contact_profile.opened', { contact_id: contactId });
    return () => {
      track('mission_control.contact_profile.closed', { contact_id: contactId });
    };
  }, [contactId, contact]);

  // Notes + activities — read through the platform SDK (Wave 16 F2-fu13).
  // blinkerApi.notes.list / blinkerApi.activities.list are fixture-seeded on
  // first read (packages/api/_fixtures/) and localStorage-backed thereafter
  // (blinker.notes.v1.<contact_id> / blinker.activities.v1.<contact_id>).
  // The parent passes `key={contactId}` so this component remounts on
  // contact swap — the SDK reads run fresh on each mount.
  const [sessionNotes, setSessionNotes] = useState(() =>
    blinkerApi.notes.list({ contact_id: contactId }),
  );
  const [sessionActivities, setSessionActivities] = useState(() =>
    blinkerApi.activities.list({ contact_id: contactId }),
  );

  // ── Tag state ────────────────────────────────────────────────────────
  // Seeded from the contact fixture's tags[] on first mount, then backed
  // by localStorage (blinker.tags.v1.<contact_id>). The contact fixture
  // tags have a { id, name, source, applied_at } shape; listTags()
  // normalizes and adds `system` boolean + null `color` so TagPicker
  // renders them without a crash.
  //
  // We also track session-created tags (minted by manager+ persona via
  // TagPicker's "Create" affordance) separately so TagPicker's inventory
  // builder can include them in the dropdown alongside system + by_org tags.
  const [sessionTags, setSessionTags] = useState(() =>
    listTags({ contact_id: contactId, fixtureTags: contact?.tags }),
  );
  const [sessionCreatedTags, setSessionCreatedTags] = useState([]);

  // Derive selectedTagIds from the stored tag list (which is the source of
  // truth post-seed). TagPicker expects string[] of ids that are "applied".
  const selectedTagIds = useMemo(() => sessionTags.map((t) => t.id), [sessionTags]);

  // Persona permission gates for TagPicker.
  const canAddTags = persona !== 'consumer';
  const canCreateTags = persona === 'manager' || persona === 'admin' || persona === 'super_admin';

  // ─────────────────────────────────────────────────────────────────────
  const [draft, setDraft] = useState('');
  const [addVehicleOpen, setAddVehicleOpen] = useState(false);
  const [newOppFlow, setNewOppFlow] = useState(null); // null | { type, flowPath }

  if (!contact) {
    return (
      <section className="flex-1 flex flex-col bg-white">
        <Header
          title="Contact not found"
          onBack={() => {
            track('mission_control.pane.dismissed', { kind: 'profile', contact_id: contactId });
            onClose();
          }}
        />
        <div className="flex-1 flex items-center justify-center text-sm text-slate-400">
          No contact record for <code className="font-mono mx-1">{contactId}</code>.
        </div>
      </section>
    );
  }

  const opportunities = allOpportunities.filter(
    (o) => o.contact_id === contactId,
  );

  function addNote() {
    const body = draft.trim();
    if (!body) return;
    // Delegate to the platform SDK — enforces the canon dual-write contract
    // (note record + paired type:'note' activity referencing it via
    // payload.note_id). Returns { note, activity } for optimistic prepend.
    const { note: newNote, activity: newActivity } = blinkerApi.addNote({
      contact_id: contactId,
      body,
      author_id: 'agent_session',
      author_persona: 'agent',
    });
    setSessionNotes((prev) => [newNote, ...prev]);
    setSessionActivities((prev) => [newActivity, ...prev]);
    setDraft('');
    track('mission_control.contact_profile.note_added', {
      contact_id: contactId,
      body_length: body.length,
    });
  }

  // ── Tag handlers ─────────────────────────────────────────────────────
  // TagPicker calls onAdd(tagId). We resolve the full tag object from:
  //   1. sessionCreatedTags (just minted this session)
  //   2. system-tags.json inventory (system_tags + by_org)
  //   3. Fallback minimal record using just the tagId
  function _resolveTagById(tagId) {
    // 1. Session-created tags (minted via TagPicker "Create" affordance)
    const fromCreated = sessionCreatedTags.find((t) => t.id === tagId);
    if (fromCreated) return { ...fromCreated, source: 'created', system: false };

    // 2. System-tags.json: system_tags
    const fromSystem = systemTagsJson.system_tags.find((t) => t.id === tagId);
    if (fromSystem) return { ...fromSystem, source: 'system' };

    // 3. System-tags.json: by_org (any org — demo is org 102)
    for (const orgTags of Object.values(systemTagsJson.by_org || {})) {
      const found = (orgTags || []).find((t) => t.id === tagId);
      if (found) return { ...found, source: 'by_org', system: false };
    }

    // 4. Fallback
    return { id: tagId, name: tagId, color: null, source: 'blinker', system: false };
  }

  function handleTagAdd(tagId) {
    if (selectedTagIds.includes(tagId)) return; // already applied

    const fullTag = _resolveTagById(tagId);
    const now = new Date().toISOString();
    const storable = {
      id: fullTag.id,
      name: fullTag.name,
      color: fullTag.color || null,
      source: fullTag.source,
      system: Boolean(fullTag.system),
      applied_at: now,
      applied_by: 'agent_session',
    };

    const nextTags = addTag({ contact_id: contactId, tag: storable });
    setSessionTags(nextTags);
    if (patchContact) patchContact(contactId, { tags: nextTags });

    // Dual-write: activity record (canon contract — tag events write activity)
    const activity = blinkerApi.activities.create({
      contact_id: contactId,
      type: 'agent_action',
      source: 'agent',
      actor_id: 'agent_session',
      payload: { tag_id: tagId, tag_name: fullTag.name, color: fullTag.color },
      summary_text: `Tag added: '${fullTag.name}'`,
    });
    setSessionActivities((prev) => [activity, ...prev]);

    // PostHog
    track('mission_control.contact_profile.tag_added', {
      contact_id: contactId,
      tag_name: fullTag.name,
      system_tag: Boolean(fullTag.system),
    });
  }

  function handleTagRemove(tagId) {
    const target = sessionTags.find((t) => t.id === tagId);
    if (!target || target.system) return; // system tags non-removable

    const nextTags = removeTag({ contact_id: contactId, tag_id: tagId });
    setSessionTags(nextTags);
    if (patchContact) patchContact(contactId, { tags: nextTags });

    // Dual-write activity
    const activity = blinkerApi.activities.create({
      contact_id: contactId,
      type: 'agent_action',
      source: 'agent',
      actor_id: 'agent_session',
      payload: { tag_id: tagId, tag_name: target.name, color: target.color },
      summary_text: `Tag removed: '${target.name}'`,
    });
    setSessionActivities((prev) => [activity, ...prev]);

    // PostHog
    track('mission_control.contact_profile.tag_removed', {
      contact_id: contactId,
      tag_name: target.name,
      system_tag: Boolean(target.system),
    });
  }

  function handleTagCreate(tag) {
    // Manager+ creates a new tag. Add it to sessionCreatedTags so the
    // inventory picks it up, then immediately apply it to the contact.
    setSessionCreatedTags((prev) => [...prev, tag]);
    // Also apply it to the contact's tag list.
    const now = new Date().toISOString();
    const storable = {
      id: tag.id,
      name: tag.name,
      color: tag.color || null,
      source: 'created',
      system: false,
      applied_at: now,
      applied_by: 'agent_session',
    };
    const nextTags = addTag({ contact_id: contactId, tag: storable });
    setSessionTags(nextTags);
    if (patchContact) patchContact(contactId, { tags: nextTags });

    // Dual-write activity
    const activity = blinkerApi.activities.create({
      contact_id: contactId,
      type: 'agent_action',
      source: 'agent',
      actor_id: 'agent_session',
      payload: { tag_id: tag.id, tag_name: tag.name, color: tag.color },
      summary_text: `Tag created and added: '${tag.name}'`,
    });
    setSessionActivities((prev) => [activity, ...prev]);

    track('mission_control.contact_profile.tag_added', {
      contact_id: contactId,
      tag_name: tag.name,
      system_tag: false,
    });
  }

  function onTagClick(tag) {
    track('mission_control.contact_profile.tag_clicked', {
      contact_id: contactId,
      tag_name: tag.name,
    });
  }

  function onMemberClick(memberId) {
    track('mission_control.contact_profile.household_member_clicked', {
      contact_id: contactId,
      member_id: memberId,
    });
    if (onOpenContactProfile) onOpenContactProfile(memberId);
  }

  function openAddVehicle() {
    track('mission_control.contact_profile.add_vehicle_opened', {
      contact_id: contactId,
    });
    setAddVehicleOpen(true);
  }

  function handleVehicleAdded(vehicle) {
    if (appendVehicleToContact) appendVehicleToContact(contactId, vehicle);
    track('mission_control.contact_profile.add_vehicle_saved', {
      contact_id: contactId,
      vehicle: { year: vehicle.year, make: vehicle.make, model: vehicle.model },
    });
    setAddVehicleOpen(false);
  }

  function startOpportunityFromVehicle(vehicle, { type, flowPath }) {
    const opp = buildNewOpp({ type, contact, vehicle, flowPath });
    if (appendOpportunity) appendOpportunity(opp);
    track('mission_control.contact_profile.start_opportunity_from_vehicle', {
      contact_id: contactId,
      vehicle_id: vehicle.id,
      opp_type: type,
      flow_path: flowPath,
    });
    if (onOpenInCoPilot) onOpenInCoPilot(opp.id);
  }

  function openNewOppFlow({ type, flowPath }) {
    track('mission_control.contact_profile.new_opportunity_opened', {
      contact_id: contactId,
      opp_type: type,
      flow_path: flowPath,
    });
    setNewOppFlow({ type, flowPath });
  }

  function handleNewOppVehiclePicked(vehicle) {
    if (!newOppFlow) return;
    const { type, flowPath } = newOppFlow;
    track('mission_control.contact_profile.new_opportunity_vehicle_picked', {
      contact_id: contactId,
      vehicle_id: vehicle.id,
      opp_type: type,
    });
    const opp = buildNewOpp({ type, contact, vehicle, flowPath });
    if (appendOpportunity) appendOpportunity(opp);
    track('mission_control.contact_profile.new_opportunity_created', {
      contact_id: contactId,
      opp_id: opp.id,
      opp_type: type,
      vehicle_id: vehicle.id,
      flow_path: flowPath,
    });
    setNewOppFlow(null);
    if (onOpenInCoPilot) onOpenInCoPilot(opp.id);
  }

  function handleNewOppAddVehicle(vehicle) {
    if (appendVehicleToContact) appendVehicleToContact(contactId, vehicle);
    track('mission_control.contact_profile.add_vehicle_saved', {
      contact_id: contactId,
      vehicle: { year: vehicle.year, make: vehicle.make, model: vehicle.model },
      from: 'new_opportunity_flow',
    });
  }

  const displayName =
    contact.name.preferred || `${contact.name.first} ${contact.name.last}`.trim();

  function handleBack() {
    track('mission_control.pane.dismissed', {
      kind: 'profile',
      contact_id: contactId,
    });
    onClose();
  }

  return (
    <section className="flex-1 flex flex-col bg-white overflow-hidden">
      <Header
        title={displayName}
        subtitle={contact.id}
        onBack={handleBack}
        right={
          <div className="flex items-center gap-2">
            {testMode && contact._test_case && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 whitespace-nowrap">
                test case: {contact._test_case}
              </span>
            )}
            <OpportunityTypeMenu variant="cta" onSelect={openNewOppFlow} />
          </div>
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-6 py-5 space-y-5">
          <HouseholdSection
            contact={contact}
            contacts={contacts}
            persona={persona}
            patchContact={patchContact}
            appendContact={appendContact}
            appendHouseholdRelationship={appendHouseholdRelationship}
            onMemberClick={onMemberClick}
          />

          <ContactHeader contact={contact} displayName={displayName} />

          <TagsSection
            contactId={contactId}
            sessionTags={sessionTags}
            selectedTagIds={selectedTagIds}
            sessionCreatedTags={sessionCreatedTags}
            canAddTags={canAddTags}
            canCreateTags={canCreateTags}
            persona={persona}
            onAdd={handleTagAdd}
            onRemove={handleTagRemove}
            onCreate={handleTagCreate}
          />

          <VehiclesSection
            vehicles={contact.vehicles}
            onAddVehicleClick={openAddVehicle}
            onStartOpportunityFromVehicle={startOpportunityFromVehicle}
          />

          <OpportunitiesSection
            opportunities={opportunities}
            onOpenInCoPilot={onOpenInCoPilot}
          />

          <ContactNotesList
            notes={sessionNotes}
            draft={draft}
            setDraft={setDraft}
            onAdd={addNote}
          />

          <ActivityFeed activities={sessionActivities} />
        </div>
      </div>

      <AddVehicleModal
        open={addVehicleOpen}
        onClose={() => setAddVehicleOpen(false)}
        onAdd={handleVehicleAdded}
      />

      <NewOpportunityFlow
        open={newOppFlow != null}
        type={newOppFlow?.type}
        typeLabel={newOppFlow ? TYPE_LABEL_MAP[newOppFlow.type] : ''}
        flowPath={newOppFlow?.flowPath}
        contact={contact}
        onAddVehicle={handleNewOppAddVehicle}
        onPicked={handleNewOppVehiclePicked}
        onClose={() => setNewOppFlow(null)}
      />
    </section>
  );
}

function Header({ title, subtitle, onBack, right }) {
  return (
    <div className="px-4 py-2 border-b border-slate-200 flex items-center gap-3 bg-white">
      <button
        onClick={onBack}
        className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-100"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        Back to inbox
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-slate-900 truncate">{title}</div>
        {subtitle && (
          <div className="text-[11px] font-mono text-slate-500 truncate">{subtitle}</div>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

// ─── 1. Household panel ─────────────────────────────────────────────────
// Lifted to ./HouseholdSection.jsx in Wave 19 Task 5 (relationship pills,
// "Added X" hints, search-and-add new member, RelationshipPicker, remove
// affordance gated to manager+). The legacy HouseholdPanel is deleted.

// ─── 2. Contact header ──────────────────────────────────────────────────
function ContactHeader({ contact, displayName }) {
  const fullName = `${contact.name.first} ${contact.name.last}`.trim();
  const showsPreferred = contact.name.preferred && contact.name.preferred !== fullName;
  const primaryAddress =
    contact.addresses.find((a) => a.is_primary) || contact.addresses[0];
  return (
    <Section title="Contact">
      <div className="mb-3">
        <div className="text-xl font-semibold text-slate-900">{displayName}</div>
        {showsPreferred && (
          <div className="text-xs text-slate-500">Legal name: {fullName}</div>
        )}
      </div>

      <div className="space-y-1.5">
        {contact.phones.map((p) => (
          <div key={p.id} className="flex items-center gap-2 text-sm">
            <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span
              className={
                'font-mono ' +
                (p.do_not_contact ? 'line-through text-slate-400' : 'text-slate-800')
              }
            >
              {formatPhone(p.number)}
            </span>
            <ChannelTypePill>{p.type}</ChannelTypePill>
            {p.is_primary && <Pill className="bg-blue-50 text-blue-700">primary</Pill>}
            {p.sms_consent ? (
              <Pill
                className="bg-emerald-50 text-emerald-700"
                title="SMS consent on file"
              >
                <ShieldCheck className="w-3 h-3" />
                <span>SMS OK</span>
              </Pill>
            ) : (
              <Pill className="bg-slate-100 text-slate-600" title="No SMS consent">
                <ShieldOff className="w-3 h-3" />
                <span>no SMS</span>
              </Pill>
            )}
            {p.do_not_contact && (
              <Pill className="bg-rose-50 text-rose-700">do-not-contact</Pill>
            )}
          </div>
        ))}
      </div>

      <div className="space-y-1.5 mt-2">
        {contact.emails.map((e) => (
          <div key={e.id} className="flex items-center gap-2 text-sm">
            <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span
              className={
                'truncate ' +
                (e.opted_out ? 'line-through text-slate-400' : 'text-slate-800')
              }
            >
              {e.address}
            </span>
            <ChannelTypePill>{e.type}</ChannelTypePill>
            {e.is_primary && <Pill className="bg-blue-50 text-blue-700">primary</Pill>}
            {e.opted_out ? (
              <Pill className="bg-rose-50 text-rose-700">
                <XCircle className="w-3 h-3" />
                <span>opted out</span>
              </Pill>
            ) : (
              <Pill className="bg-emerald-50 text-emerald-700">
                <CheckCircle className="w-3 h-3" />
                <span>subscribed</span>
              </Pill>
            )}
          </div>
        ))}
      </div>

      {primaryAddress && (
        <div className="flex items-start gap-2 text-sm text-slate-700 mt-3">
          <MapPin className="w-3.5 h-3.5 mt-0.5 text-slate-400 shrink-0" />
          <div>
            <div>{primaryAddress.line_1}</div>
            {primaryAddress.line_2 && <div>{primaryAddress.line_2}</div>}
            <div>
              {primaryAddress.city}, {primaryAddress.state} {primaryAddress.postal_code}
            </div>
            {primaryAddress.ownership && (
              <div className="text-xs text-slate-500 mt-0.5">
                {primaryAddress.ownership}
                {primaryAddress.ownership_type
                  ? ` · ${primaryAddress.ownership_type}`
                  : ''}
              </div>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

// ─── 3. Tags ────────────────────────────────────────────────────────────
// TagsSection — replaces the old read-only TagsRow. Wires the platform
// TagPicker primitive (blinker-platform/components) for add/remove CRUD.
// System tags (tag.system === true) are shown as locked pills above the
// picker; non-system tags are managed by the picker's applied-pill row
// (which already renders remove "x" buttons for canAdd=true personas).
//
// Org-id is hard-coded to 102 (Apex demo org) for Phase 1. Phase 2:
// read from the contact's org_id or the active session org.
const DEMO_ORG_ID = 102;

function TagsSection({
  sessionTags,
  selectedTagIds,
  sessionCreatedTags,
  canAddTags,
  canCreateTags,
  persona,
  onAdd,
  onRemove,
  onCreate,
}) {
  // Separate system tags (non-removable, locked-icon display) from non-system.
  // System tags are shown as a static locked row above the picker.
  const systemTags = sessionTags.filter((t) => t.system);
  // Non-system selectedTagIds are what we pass to TagPicker (it renders them
  // as applied pills with "x" remove affordance).
  const nonSystemSelectedIds = selectedTagIds.filter(
    (id) => !systemTags.some((t) => t.id === id),
  );

  return (
    <Section title="Tags">
      {/* System tags — locked, always visible above picker */}
      {systemTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {systemTags.map((t) => {
            const customColor = t.color
              ? { backgroundColor: t.color + '22', color: t.color, borderColor: t.color + '55' }
              : null;
            return (
              <span
                key={t.id}
                className={
                  'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset ' +
                  (customColor ? '' : 'bg-slate-100 text-slate-600 ring-slate-200')
                }
                style={customColor || undefined}
                title="System tag — managed by Blinker"
              >
                <Lock className="w-3 h-3" />
                <span>{t.name}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* TagPicker — handles non-system tag add/remove/create */}
      <TagPicker
        selectedTagIds={nonSystemSelectedIds}
        onAdd={onAdd}
        onRemove={onRemove}
        onCreate={onCreate}
        canAdd={canAddTags}
        canCreate={canCreateTags}
        orgId={DEMO_ORG_ID}
        persona={persona}
        sessionCreated={sessionCreatedTags}
        trackingPrefix="mission_control.contact_profile.tag_picker"
      />
    </Section>
  );
}

// ─── 4. Vehicles ────────────────────────────────────────────────────────
function VehiclesSection({
  vehicles,
  onAddVehicleClick,
  onStartOpportunityFromVehicle,
}) {
  const addButton = onAddVehicleClick ? (
    <button
      onClick={onAddVehicleClick}
      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-white"
    >
      <Plus className="w-3 h-3" />
      Add vehicle
    </button>
  ) : null;

  if (vehicles.length === 0) {
    return (
      <Section icon={Car} title="Vehicles" right={addButton}>
        <div className="text-xs text-slate-400">No vehicles on file.</div>
      </Section>
    );
  }
  return (
    <Section icon={Car} title={`Vehicles (${vehicles.length})`} right={addButton}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {vehicles.map((v) => (
          <div
            key={v.id}
            className="bg-slate-50 ring-1 ring-slate-200 rounded-md p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-semibold text-slate-900">
                {v.year} {v.make} {v.model}
                {v.trim && <span className="text-slate-500 font-normal"> {v.trim}</span>}
              </div>
              <SourceBadge source={v.source} />
            </div>
            {v.vin && (
              <div className="text-[11px] font-mono text-slate-500 mt-1">{v.vin}</div>
            )}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {v.ownership && <Pill className="bg-white text-slate-700">{v.ownership}</Pill>}
              {v.mileage != null && (
                <Pill className="bg-white text-slate-700">
                  {v.mileage.toLocaleString()} mi
                </Pill>
              )}
              {v.value != null && (
                <Pill className="bg-white text-slate-700">
                  ${v.value.toLocaleString()}
                </Pill>
              )}
            </div>
            {onStartOpportunityFromVehicle && (
              <div className="flex justify-end mt-2">
                <OpportunityTypeMenu
                  variant="compact"
                  onSelect={(payload) => onStartOpportunityFromVehicle(v, payload)}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

function SourceBadge({ source }) {
  const map = {
    vin_decode: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    manual: 'bg-amber-50 text-amber-700 ring-amber-200',
    partner: 'bg-sky-50 text-sky-700 ring-sky-200',
  };
  return (
    <span
      className={
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ring-1 ring-inset ' +
        (map[source] || 'bg-slate-100 text-slate-600 ring-slate-200')
      }
    >
      {source}
    </span>
  );
}

// ─── 5. Opportunities ───────────────────────────────────────────────────

function OpportunitiesSection({ opportunities, onOpenInCoPilot }) {
  if (opportunities.length === 0) {
    return (
      <Section title="Opportunities">
        <div className="text-xs text-slate-400">No opportunities for this contact.</div>
      </Section>
    );
  }
  return (
    <Section title="OPPORTUNITIES">

      <ul className="divide-y divide-slate-100 ring-1 ring-slate-200 rounded-md overflow-hidden">
        {opportunities.map((o) => (
          <li
            key={o.id}
            className="flex items-center gap-3 px-3 py-2.5 bg-white hover:bg-slate-50"
          >
            <span
              className={
                'inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ring-1 ring-inset ' +
                TYPE_BADGE[o.type]
              }
            >
              {TYPE_LABELS[o.type]}
            </span>
            <span
              className={
                'inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ring-1 ring-inset ' +
                statusPillClasses(o.type, o.status)
              }
            >
              {o.status}
            </span>
            <span className="text-xs text-slate-500">{ageLabel(ageDays(o.created_at))}</span>
            <span className="ml-auto text-xs text-slate-400 truncate max-w-[160px]">
              {o.next_action}
            </span>
            <button
              onClick={() => onOpenInCoPilot(o.id)}
              className="text-xs font-medium px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap"
            >
              Open in CoPilot
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ─── 6. Notes ───────────────────────────────────────────────────────────
// Note: this is a contact-notes-list pane (renders persisted notes for a
// contact + an inline composer). It is NOT the workflow-agnostic
// notes-and-tags card from blinker-platform/components/NotesPanel.jsx.
// Renamed in Wave 15c-hygiene to eliminate the namespace shadow.
function ContactNotesList({ notes, draft, setDraft, onAdd }) {
  return (
    <Section icon={StickyNote} title={`Notes (${notes.length})`}>
      <div className="bg-slate-50 ring-1 ring-slate-200 rounded-md p-3 mb-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note…"
          rows={2}
          className="w-full text-sm bg-white border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px] text-slate-400">
            Saved locally for this demo. Phase 2: persists to Blinker API.
          </span>
          <button
            onClick={onAdd}
            disabled={!draft.trim()}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white inline-flex items-center gap-1.5"
          >
            <Send className="w-3 h-3" />
            Add
          </button>
        </div>
      </div>

      {notes.length === 0 ? (
        <div className="text-xs text-slate-400">No notes yet.</div>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li
              key={n.id}
              className="bg-white ring-1 ring-slate-200 rounded-md p-3"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <PersonaPill persona={n.author_persona} />
                <span className="text-[11px] font-mono text-slate-500">
                  {n.author_id}
                </span>
                <span className="ml-auto text-[11px] text-slate-400">
                  {relativeTime(n.created_at)}
                </span>
                {n._session && (
                  <Pill className="bg-blue-50 text-blue-700">session</Pill>
                )}
              </div>
              <div className="text-sm text-slate-800 whitespace-pre-wrap">{n.body}</div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function PersonaPill({ persona }) {
  const map = {
    agent: 'bg-blue-50 text-blue-700',
    manager: 'bg-emerald-50 text-emerald-700',
    admin: 'bg-purple-50 text-purple-700',
    super_admin: 'bg-rose-50 text-rose-700',
    consumer: 'bg-amber-50 text-amber-700',
  };
  return (
    <span
      className={
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ' +
        (map[persona] || 'bg-slate-100 text-slate-600')
      }
    >
      {persona.replace('_', ' ')}
    </span>
  );
}

// ─── 7. Activity feed ───────────────────────────────────────────────────
const ACTIVITY_ICON = {
  call: Phone,
  sms: MessageSquare,
  email: Mail,
  status_change: RotateCcw,
  note: StickyNote,
  agent_action: ArrowRight,
  partner_event: Share2,
};

function ActivityFeed({ activities }) {
  return (
    <Section icon={ActivityIcon} title={`Activity (${activities.length})`}>
      {activities.length === 0 ? (
        <div className="text-xs text-slate-400">No activity.</div>
      ) : (
        <ul className="space-y-1.5">
          {activities.map((a) => {
            const Icon = ACTIVITY_ICON[a.type] || ActivityIcon;
            return (
              <li
                key={a.id}
                className="flex items-start gap-3 px-3 py-2 bg-white ring-1 ring-slate-200 rounded-md"
              >
                <div className="mt-0.5 p-1.5 rounded-md bg-slate-50 text-slate-500">
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-800">{a.summary_text}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <SourcePill source={a.source} />
                    <span className="text-[11px] text-slate-400">
                      {relativeTime(a.occurred_at)}
                    </span>
                    {a.opportunity_id && (
                      <span className="text-[11px] font-mono text-slate-400">
                        {a.opportunity_id}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function SourcePill({ source }) {
  const map = {
    agent: 'bg-blue-50 text-blue-700',
    consumer: 'bg-amber-50 text-amber-700',
    partner: 'bg-indigo-50 text-indigo-700',
    system: 'bg-slate-100 text-slate-600',
  };
  return (
    <span
      className={
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ' +
        (map[source] || 'bg-slate-100 text-slate-600')
      }
    >
      {source}
    </span>
  );
}

// ─── shared primitives ──────────────────────────────────────────────────
function Section({ icon: Icon, title, right, children }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {Icon && <Icon className="w-3.5 h-3.5 text-slate-500" />}
        <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
          {title}
        </div>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {children}
    </div>
  );
}

function Pill({ className = '', children, title }) {
  return (
    <span
      title={title}
      className={
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ' +
        className
      }
    >
      {children}
    </span>
  );
}

function ChannelTypePill({ children }) {
  return (
    <Pill className="bg-slate-100 text-slate-600">{children}</Pill>
  );
}

function formatPhone(e164) {
  // Simple US-only formatter: +1XXXXXXXXXX → (XXX) XXX-XXXX. Anything else
  // returns as-is.
  if (!e164) return '—';
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (m) return `(${m[1]}) ${m[2]}-${m[3]}`;
  return e164;
}
