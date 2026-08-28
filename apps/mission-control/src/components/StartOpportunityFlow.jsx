import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  House,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  Umbrella,
  UserPlus,
  X,
} from 'lucide-react';
import { AddContactModal } from './AddContactModal.jsx';
import { AddHomeModal } from './AddHomeModal.jsx';
import { buildNewOpp } from '../lib/session-data.js';
import { getActiveOrgId, isHomeProtectionEnabledForOrg } from '../lib/canon.js';
import { listHomeTypes } from 'blinker-platform/utils';
import planMappings from '../constants/canon/plan-mappings.json' with { type: 'json' };
import { track } from 'blinker-platform/telemetry';

// StartOpportunityFlow — multi-step modal for the AgentHome quick-action
// launcher. Composes existing primitives (OpportunityTypeMenu's type list,
// AddContactModal's form, NewOpportunityFlow's vehicle picker) into a
// single guided flow that smart-routes around missing data.
//
// Steps (state machine `step`):
//   1. 'type'    — pick opportunity type. Card-grid of 4 (refi, insurance×2,
//                  protection) plus, org-gated, a 5th "Home protection" card
//                  (ADR 30 R8). Cards record { type, flowPath } and advance.
//   2. 'contact' — searchable list of existing session contacts + a dashed
//                  "+ Add new contact" tile. Pick → contact selected; tile →
//                  swap to AddContactModal (inline-mounted), then on save
//                  auto-select the new contact and advance.
//   3. 'vehicle' — reuse-shape of NewOpportunityFlow's VehiclePickerStep:
//                  responsive 2-col grid + dashed "+ Add new vehicle" tile.
//                  If the chosen contact has 0 vehicles, we jump straight
//                  to the inline VehicleAdd path (skip the picker UI).
//                  After picking/adding, build the opp, persist it, fire
//                  onCreated(opp.id) which the parent uses to deep-link
//                  into CoPilotPane. Only reached for non-home types.
//   3'. 'home'   — ADR 30 R8 asset step for type === 'home_protection'.
//                  Home is durable and belongs to the contact (D2), so this
//                  mirrors 'vehicle' — a picker grid of the contact's
//                  existing homes plus a dashed "+ Add new home" tile that
//                  opens AddHomeModal (a real modal, stacked over this one —
//                  NOT inlined like VehicleAdd, because AddHomeModal already
//                  owns its own chrome). A skip footer is always offered.
//                  Wave 39-fu — the step only actually RENDERS when there's
//                  something to ask: routeToHomeStep skips it entirely when
//                  the contact has zero homes on file but a usable mailing
//                  address, seeding that address forward as `_prefill.home`
//                  (see buildHomePrefill) instead of re-asking for it.
//                  home-protection-portal's own `home_add` wizard step
//                  still collects home type / square footage / year built,
//                  which an address alone can't supply, and consumes the
//                  prefill as a starting point.
//
// Note: there is no 'dob' step. DOB collection for insurance is handled
// downstream by insurance-portal's LeadOriginationForm ("Confirm your
// contact details"). The former MC-level DOB gate was removed in Wave 16
// F2-fu2 to eliminate duplicate friction.
//
// Smart-routing: a single launcher cleanly handles all 4 cases (contact
// known + vehicle known / contact known + vehicle missing / contact
// missing + vehicle missing / etc). The contact step's "+ Add new
// contact" branch sets `mode = 'add_contact'` which inlines the contact
// modal; on save, the new contact has zero vehicles, so we proceed to
// the inline VehicleAdd path automatically.
//
// Props:
//   open                  — boolean
//   contacts              — session contacts map (id → contact)
//   appendContact         — fn(contact) → id (from useSessionData)
//   appendOpportunity     — fn(opp)
//   appendVehicleToContact — fn(contactId, vehicle)
//   homes                 — session homes map, id → home (from useSessionData;
//                           ADR 30 — optional, defaults to {}. Filtered by
//                           contact_ids membership for the 'home' step picker.
//   appendHomeToContact    — fn(contactId, home) → id (from useSessionData;
//                           ADR 30 — optional)
//   onClose               — backdrop / X / Cancel
//   onCreated             — fn(oppId) — fires on final opp creation; parent
//                           closes the modal + opens CoPilot.
// Note: patchContact is NOT a prop. DOB collection is owned by the
// downstream insurance-portal LeadOriginationForm.

const VehicleAdd = lazy(() =>
  import('refi-portal/src/views/customer').then((m) => ({ default: m.VehicleAdd })),
);

const TYPE_OPTIONS = [
  {
    key: 'refi',
    type: 'refi',
    label: 'Refi',
    sub: 'Refinance an auto loan',
    icon: RefreshCcw,
    iconClass: 'bg-emerald-50 text-emerald-600 ring-emerald-200',
    flowPath: undefined,
  },
  {
    key: 'insurance_capture_and_quote',
    type: 'insurance',
    label: 'Insurance — capture + quote',
    sub: 'Full intake + quote',
    icon: Umbrella,
    iconClass: 'bg-sky-50 text-sky-600 ring-sky-200',
    flowPath: 'capture_and_quote',
  },
  {
    key: 'insurance_quote_only',
    type: 'insurance',
    label: 'Insurance — quote only',
    sub: 'Skip intake, jump to quote',
    icon: Umbrella,
    iconClass: 'bg-sky-50 text-sky-500 ring-sky-200',
    flowPath: 'quote_only',
  },
  {
    key: 'protection',
    type: 'protection',
    label: 'Vehicle protection plan',
    sub: 'VSC / GAP / etc.',
    icon: ShieldCheck,
    iconClass: 'bg-indigo-50 text-indigo-600 ring-indigo-200',
    flowPath: undefined,
  },
  // ADR 30 R8 — teal, deliberately distinct from protection's indigo (the
  // two appear side by side in this same grid). Org-gated below at render
  // time via isHomeProtectionEnabledForOrg — omitted entirely, not shown
  // disabled, for orgs that don't carry the OMGA home rate set.
  //
  // Wave 39-fu — `sub` dropped "· Omega-J Home": that's the OMEGA program
  // name, not customer-facing copy.
  {
    key: 'home_protection',
    type: 'home_protection',
    label: 'Home protection',
    sub: 'Home warranty',
    icon: House,
    iconClass: 'bg-teal-50 text-teal-600 ring-teal-200',
    flowPath: undefined,
  },
];

// ADR 30 — home_type id → display label, matching AddHomeModal's own
// select options (canon-driven, not hard-coded) and the label prose
// buildNewOpp uses for the inbox row.
const HOME_TYPE_LABELS = Object.fromEntries(
  listHomeTypes(planMappings.home_dwelling_classes).map((t) => [t.id, t.label]),
);
function homeTypeLabel(homeType) {
  return HOME_TYPE_LABELS[homeType] || homeType || '';
}

const INITIAL_VEHICLE_FORM = {
  vin: '',
  vinDecoded: false,
  vinDecodeLoading: false,
  vinDecodeError: null,
  _lastDecodedVin: null,
  year: null,
  make: '',
  model: '',
  trim: '',
};

function buildVehicleRecord(form) {
  const id = `veh_session_${
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now()
  }`;
  const source = form.vinDecoded ? 'vin_decode' : 'manual';
  return {
    id,
    year: form.year,
    make: form.make,
    model: form.model,
    trim: form.trim,
    vin: form.vin || null,
    source,
    source_recorded_at: new Date().toISOString(),
  };
}

// ADR 30 — stamps a session id onto AddHomeModal's onAdd payload BEFORE
// persisting, mirroring buildVehicleRecord above. The id is generated here
// (not read back from appendHomeToContact's return value) so the same
// id-bearing record can be handed to both appendHomeToContact (persistence)
// and finalizeOpp/buildNewOpp (the opp's home summary) in the same tick.
function buildHomeRecord(home) {
  const id = `home_session_${
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now()
  }`;
  return { ...home, id };
}

// Wave 39-fu — home-step auto-skip helpers (smoke-test follow-up to ADR 30
// R8). Mirrors the shape of the existing vehicle skip flow: the 'home'
// step should only ever be RENDERED when there's actually something to
// ask (a picker with 2+ homes, or a genuinely blank contact). When the
// contact already typed a usable mailing address (most commonly via "Add
// new contact" in this same flow) and has no homes on file, that address
// becomes the covered-property seed instead of re-asking for it.

// Homes this contact already holds, filtered by contact_ids membership —
// mirrors HomeStep's own `contactHomes` computation and ContactProfile's
// (a home is NOT stored on contact.homes[]; ADR 30 D2, a home can carry a
// second agreement holder).
function contactHomesFor(contact, homes) {
  if (!contact || !homes) return [];
  return Object.values(homes).filter(
    (h) => Array.isArray(h.contact_ids) && h.contact_ids.includes(contact.id),
  );
}

// "Usable address" means at minimum a street line plus city/state/zip — a
// ZIP alone is not enough to seed a covered property. Reads the contact's
// primary address (falling back to the first) from the canon `contact`
// shape's addresses[] (see AddContactModal's buildContactRecord — `line_1`
// / `postal_code`, NOT the home entity's `address1` / `zip` field names).
function usableContactAddress(contact) {
  const addresses = contact?.addresses || [];
  const addr = addresses.find((a) => a.is_primary) || addresses[0];
  if (!addr) return null;
  const hasStreet = !!(addr.line_1 && addr.line_1.trim());
  const hasCityStateZip = !!(addr.city && addr.state && addr.postal_code);
  if (!hasStreet || !hasCityStateZip) return null;
  return {
    address1: addr.line_1 || '',
    address2: addr.line_2 || '',
    city: addr.city || '',
    state: addr.state || '',
    zip: addr.postal_code || '',
    country: addr.country || 'US',
  };
}

// Builds the Wave 31 `_prefill` convention block for a home_protection opp
// created with no real home record. Returns null when the contact has no
// usable address — callers must NOT stamp an empty prefill. Deliberately
// does NOT mint a `home` entity: a home with an address but no type/square
// footage can't be classified by classifyDwelling (ADR 30 R2 — null means
// ineligible), so a half-formed record would pollute the contact graph and
// the Homes section. The real `home` record is created when the wizard's
// `home_add` step completes and fires `onHomeCommitted`.
function buildHomePrefill(contact) {
  const address = usableContactAddress(contact);
  if (!address) return null;
  return { home: { address, source: 'contact_address' } };
}

export function StartOpportunityFlow({
  open,
  contacts,
  appendContact,
  appendOpportunity,
  appendVehicleToContact,
  appendHouseholdRelationship,
  // ADR 30 — optional; the dashboard launcher (AgentHome) threads these
  // from useSessionData the same way it threads contacts/vehicles. Default
  // to a safe no-op shape so any other caller that hasn't been updated
  // doesn't crash — the 'home' step just renders an empty picker.
  homes,
  appendHomeToContact,
  // Optional: when present, the type step is skipped (because the user
  // already picked the type via the enclosing UI) AND the contact step is
  // skipped (because we have a seed contact). Used by AgentHome's "Save
  // contact → Start opportunity" routing in Commit 2.
  seededContact,
  seededType,
  seededFlowPath,
  onClose,
  onCreated,
}) {
  // step: 'type' | 'contact' | 'vehicle'
  // When a seededContact + seededType are passed (the "Save contact → Start
  // opportunity" route from AgentHome), we'd previously open straight to
  // the vehicle step with the contact pre-selected. As of Wave 16 F2, if
  // the seeded contact has zero vehicles we route to 'vehicle' on mount
  // and a useEffect immediately auto-skips through runVehicleSkipFlow —
  // every workflow's wizard collects the vehicle inline as step 1, so
  // forcing vehicle entry here is redundant friction. seededType alone
  // (with no contact) jumps to the contact step. seededContact alone
  // jumps to the type step.
  const seededZeroVehicle =
    !!(seededContact && seededType !== 'home_protection' && (seededContact.vehicles || []).length === 0);
  // ADR 30 — home_protection has its own asset step ('home'), never
  // 'vehicle'. seededType is never actually passed by today's caller
  // (AgentHome only seeds a contact), so this branch is defensive/
  // forward-compatible rather than exercised in the current build.
  //
  // Wave 39-fu — the home_protection analog of seededZeroVehicle: the
  // seeded contact has no homes on file but a usable mailing address, so
  // the 'home' step would have nothing to ask. Mirrors routeToHomeStep's
  // branching below (has homes → picker / no homes + address → auto-skip
  // / neither → picker with Add + Skip).
  const seededHomeAutoSkip =
    !!(
      seededContact &&
      seededType === 'home_protection' &&
      contactHomesFor(seededContact, homes).length === 0 &&
      usableContactAddress(seededContact)
    );
  const initialStep = seededContact && seededType
    ? (seededType === 'home_protection' ? 'home' : 'vehicle')
    : seededContact
      ? 'type'
      : 'type';
  const initialPicked = {
    type: seededType || null,
    flowPath: seededFlowPath || null,
    contact: seededContact || null,
  };
  // When the seeded contact has zero vehicles, the mount effect below
  // auto-skips before the VehicleStep renders, so the mode here only
  // matters for the >0 vehicles path → 'pick'.
  const initialVehicleMode = 'pick';
  const [step, setStep] = useState(initialStep);
  const [picked, setPicked] = useState(initialPicked);
  const [contactSearch, setContactSearch] = useState('');
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [addHomeOpen, setAddHomeOpen] = useState(false);
  const [vehicleMode, setVehicleMode] = useState(initialVehicleMode); // 'pick' | 'add'
  const [vehicleForm, setVehicleForm] = useState(INITIAL_VEHICLE_FORM);

  const contactList = useMemo(() => {
    const list = Object.values(contacts || {});
    list.sort((a, b) => {
      const an = (a.name?.last || '') + ' ' + (a.name?.first || '');
      const bn = (b.name?.last || '') + ' ' + (b.name?.first || '');
      return an.localeCompare(bn);
    });
    if (!contactSearch.trim()) return list;
    const q = contactSearch.toLowerCase();
    return list.filter((c) => {
      const display = `${c.name?.first ?? ''} ${c.name?.last ?? ''} ${c.name?.preferred ?? ''}`.toLowerCase();
      const phones = (c.phones || []).map((p) => p.number).join(' ');
      const emails = (c.emails || []).map((e) => e.address).join(' ').toLowerCase();
      return display.includes(q) || phones.includes(q) || emails.includes(q);
    });
  }, [contacts, contactSearch]);

  // The component stays mounted in AgentHome's tree across opens (returns
  // null while !open), so useState's mount-time `initialPicked` snapshot
  // is the seed-prop values from when the parent first rendered — usually
  // nulls. When the parent later flips `open` to true with fresh seeds
  // (the "Save contact → Start opportunity" route), picked.contact would
  // remain null without this hydration, breaking Wave 16 F1.
  useEffect(() => {
    if (!open) return;
    setPicked({
      type: seededType || null,
      flowPath: seededFlowPath || null,
      contact: seededContact || null,
    });
    setStep(
      seededContact && seededType
        ? (seededType === 'home_protection' ? 'home' : 'vehicle')
        : 'type',
    );
    setContactSearch('');
    setAddContactOpen(false);
    setAddHomeOpen(false);
    setVehicleMode('pick');
    setVehicleForm(INITIAL_VEHICLE_FORM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Mount-side auto-skip: when seededContact is a zero-vehicle contact
  // and seededType is also set, the modal would have opened on the
  // 'vehicle' step. Per Wave 16 F2, that step is redundant — every
  // workflow's wizard collects the vehicle inline as step 1. Auto-skip
  // through runVehicleSkipFlow before VehicleStep renders. Never fires
  // for home_protection — seededZeroVehicle is false in that case (ADR
  // 29), and the 'home' step's own skip footer covers the equivalent
  // gap deliberately rather than auto-skipping.
  useEffect(() => {
    if (!open) return;
    if (!seededZeroVehicle) return;
    if (!seededType || !seededContact) return;
    // step starts as 'vehicle' in this branch — fire once on first
    // open. The effect has no other dependencies so it will not loop.
    runVehicleSkipFlow({
      type: seededType,
      flowPath: seededFlowPath,
      contact: seededContact,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Wave 39-fu — home_protection analog of the effect above. Defensive/
  // forward-compatible only (see seededHomeAutoSkip comment) — today's
  // only caller of the seeded route never seeds seededType.
  useEffect(() => {
    if (!open) return;
    if (!seededHomeAutoSkip) return;
    if (!seededType || !seededContact) return;
    runHomeSkipFlow({
      type: seededType,
      flowPath: seededFlowPath,
      contact: seededContact,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  function reset() {
    // Re-derive from the seed props so a re-open after a save still
    // honors the caller's intent.
    setStep(initialStep);
    setPicked(initialPicked);
    setContactSearch('');
    setAddContactOpen(false);
    setAddHomeOpen(false);
    setVehicleMode(initialVehicleMode);
    setVehicleForm(INITIAL_VEHICLE_FORM);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handlePickType(opt) {
    track('mission_control.home.start_opportunity_opened', {
      opp_type: opt.type,
      flow_path: opt.flowPath,
    });
    setPicked((prev) => ({ ...prev, type: opt.type, flowPath: opt.flowPath }));
    // If a contact is already selected (seeded path from AgentHome's
    // "Save contact → Start opportunity" route, or any other re-entry
    // where picked.contact survives across renders), skip the contact
    // picker. picked.contact is read from the previous render's state,
    // which is correct here because handlePickType only fires on user
    // click after setPicked has settled.
    if (picked.contact) {
      // ADR 30 — home_protection is asset-first with its own 'home' step
      // (or an auto-skip past it — Wave 39-fu routeToHomeStep); it never
      // routes through the vehicle picker or its zero-vehicle auto-skip.
      if (opt.type === 'home_protection') {
        routeToHomeStep({ type: opt.type, flowPath: opt.flowPath, contact: picked.contact });
        return;
      }
      // Zero-vehicle contacts skip the vehicle step entirely — every
      // workflow's wizard collects the vehicle inline as step 1
      // (insurance-portal LeadOriginationForm is being updated in
      // parallel to do the same). For >0 vehicles, render the picker.
      if ((picked.contact.vehicles || []).length === 0) {
        // Skip directly to gating/finalize. We pass the just-picked
        // type/flowPath through synchronously because setPicked above
        // hasn't committed yet — closure-reading variants would see
        // stale state.
        runVehicleSkipFlow({
          type: opt.type,
          flowPath: opt.flowPath,
          contact: picked.contact,
        });
        return;
      }
      setStep('vehicle');
      return;
    }
    setStep('contact');
  }

  // Direct entry point for the auto-skip path. The closure-reading
  // maybeGateOnDob/finalizeOpp can't be used cleanly when type is
  // freshly-set in the same tick, so this duplicates the gating logic
  // with explicit args. Kept narrow — only handlePickType uses it
  // today, but handlePickContact / handleContactSaved could too once
  // their flows are exercised in this branch.
  function runVehicleSkipFlow({ type, flowPath, contact }) {
    track('mission_control.home.start_opportunity_vehicle_skipped', {
      opp_type: type,
      contact_id: contact?.id,
      auto: true,
    });
    const opp = buildNewOpp({ type, contact, vehicle: null, flowPath });
    if (appendOpportunity) appendOpportunity(opp);
    track('mission_control.home.start_opportunity_created', {
      opp_id: opp.id,
      opp_type: type,
      contact_id: contact.id,
      vehicle_id: null,
      flow_path: flowPath,
      vehicle_skipped: true,
    });
    reset();
    if (onCreated) onCreated(opp.id);
  }

  // Wave 39-fu — the home_protection analog of runVehicleSkipFlow. Fires
  // when the contact has zero homes on file but a usable mailing address:
  // there's nothing left to ask, so no picker renders at all — the
  // address becomes the covered-property seed (`_prefill.home`, see
  // buildHomePrefill) and the opportunity is created directly.
  function runHomeSkipFlow({ type, flowPath, contact }) {
    const prefill = buildHomePrefill(contact);
    track('mission_control.home.start_opportunity_home_skipped', {
      opp_type: type,
      contact_id: contact?.id,
      auto: true,
      prefill_from_address: !!prefill,
    });
    const opp = buildNewOpp({ type, contact, vehicle: null, home: null, flowPath, prefill });
    if (appendOpportunity) appendOpportunity(opp);
    track('mission_control.home.start_opportunity_created', {
      opp_id: opp.id,
      opp_type: type,
      contact_id: contact.id,
      home_id: null,
      flow_path: flowPath,
      home_skipped: true,
      home_prefill_source: prefill ? prefill.home.source : null,
    });
    reset();
    if (onCreated) onCreated(opp.id);
  }

  // Wave 39-fu — decides what the 'home' step should do for a given
  // (type, contact) pair, replacing the unconditional `setStep('home')`
  // that used to run at every home_protection routing point:
  //   - contact already holds 1+ homes → render the picker (unchanged).
  //   - no homes, but a usable mailing address → nothing to ask; auto-skip
  //     via runHomeSkipFlow, carrying the address forward as `_prefill`.
  //   - no homes and no usable address → render the step (Add new home /
  //     Skip), same as before.
  function routeToHomeStep({ type, flowPath, contact }) {
    if (contactHomesFor(contact, homes).length > 0) {
      setStep('home');
      return;
    }
    if (usableContactAddress(contact)) {
      runHomeSkipFlow({ type, flowPath, contact });
      return;
    }
    setStep('home');
  }

  function handlePickContact(contact) {
    track('mission_control.home.start_opportunity_contact_picked', {
      opp_type: picked.type,
      contact_id: contact.id,
    });
    setPicked((prev) => ({ ...prev, contact }));
    // ADR 30 — home_protection routes to the 'home' step (or auto-skips
    // it — Wave 39-fu routeToHomeStep), never 'vehicle'.
    if (picked.type === 'home_protection') {
      routeToHomeStep({ type: picked.type, flowPath: picked.flowPath, contact });
      return;
    }
    // Zero-vehicle contacts skip the vehicle step entirely — the
    // workflow's wizard step 1 collects the vehicle inline.
    if ((contact.vehicles || []).length === 0) {
      runVehicleSkipFlow({
        type: picked.type,
        flowPath: picked.flowPath,
        contact,
      });
      return;
    }
    // Contact has vehicles → show the picker.
    setVehicleMode('pick');
    setStep('vehicle');
  }

  function handleContactSaved({ contact, householdRelationship }) {
    if (appendContact) appendContact(contact);
    if (householdRelationship && appendHouseholdRelationship) {
      appendHouseholdRelationship(householdRelationship);
    }
    track('mission_control.home.start_opportunity_contact_picked', {
      opp_type: picked.type,
      contact_id: contact.id,
      from: 'add_new',
      with_household_relationship: !!householdRelationship,
    });
    setAddContactOpen(false);
    setPicked((prev) => ({ ...prev, contact }));
    // ADR 30 / Wave 39-fu — a newly-added contact has no homes on file
    // (the modal never seeds one), but it very often DOES carry a full
    // mailing address the agent just typed — the observed smoke-test bug
    // was exactly this: re-asking for an address entered seconds earlier.
    // routeToHomeStep only renders the 'home' step's "Add new home" tile +
    // skip footer when there's genuinely nothing to seed from; otherwise
    // it auto-skips and carries the typed address forward as `_prefill`.
    if (picked.type === 'home_protection') {
      routeToHomeStep({ type: picked.type, flowPath: picked.flowPath, contact });
      return;
    }
    // Newly-added contacts always have 0 vehicles → skip the vehicle
    // step entirely. The workflow's wizard step 1 collects the
    // vehicle inline (refi/protection have always done this; insurance
    // is being updated in parallel).
    runVehicleSkipFlow({
      type: picked.type,
      flowPath: picked.flowPath,
      contact,
    });
  }

  // ADR 30 — `home` is an optional second asset param, only meaningful
  // when picked.type === 'home_protection'; buildNewOpp branches on type
  // to decide whether to read `vehicle` or `home`. Non-home call sites
  // (handleSkipVehicle/handlePickVehicle/handleVehicleAdded) never pass a
  // third arg, so `home` is undefined there and this stays a no-op change
  // for the four existing types.
  //
  // Wave 39-fu — when home_protection reaches here with no real home
  // (handleSkipHome — the agent explicitly clicked Skip on a step that
  // DID render, i.e. the contact had homes-and-no-address-match or
  // neither), still carry the contact's address forward as `_prefill` if
  // one exists. buildHomePrefill returns null when there's nothing usable,
  // so this is a no-op for a genuinely blank contact.
  function finalizeOpp(vehicle, home) {
    if (!picked.contact) return;
    const prefill =
      picked.type === 'home_protection' && !home
        ? buildHomePrefill(picked.contact)
        : null;
    const opp = buildNewOpp({
      type: picked.type,
      contact: picked.contact,
      vehicle,
      home,
      flowPath: picked.flowPath,
      prefill,
    });
    if (appendOpportunity) appendOpportunity(opp);
    track('mission_control.home.start_opportunity_created', {
      opp_id: opp.id,
      opp_type: picked.type,
      contact_id: picked.contact.id,
      vehicle_id: vehicle?.id || null,
      home_id: home?.id || null,
      flow_path: picked.flowPath,
      vehicle_skipped: !vehicle,
      home_skipped: picked.type === 'home_protection' ? !home : undefined,
      home_prefill_source: prefill ? prefill.home.source : null,
    });
    reset();
    if (onCreated) onCreated(opp.id);
  }

  // Skip the vehicle step entirely. Allowed for ALL workflow types now
  // — every workflow's wizard step 1 collects the vehicle inline.
  // Insurance previously gated here because EI lead-origination
  // required a vehicle in the lead payload, but insurance-portal's
  // LeadOriginationForm is being updated in parallel (Wave 16) to
  // collect vehicle inline as well, removing the gate.
  function handleSkipVehicle() {
    track('mission_control.home.start_opportunity_vehicle_skipped', {
      opp_type: picked.type,
      contact_id: picked.contact?.id,
    });
    finalizeOpp(null);
  }

  function handlePickVehicle(vehicle) {
    track('mission_control.home.start_opportunity_vehicle_picked', {
      opp_type: picked.type,
      contact_id: picked.contact.id,
      vehicle_id: vehicle.id,
    });
    finalizeOpp(vehicle);
  }

  function handleVehicleAdded() {
    if (!picked.contact) return;
    const vehicle = buildVehicleRecord(vehicleForm);
    if (appendVehicleToContact)
      appendVehicleToContact(picked.contact.id, vehicle);
    track('mission_control.home.start_opportunity_vehicle_picked', {
      opp_type: picked.type,
      contact_id: picked.contact.id,
      vehicle_id: vehicle.id,
      from: 'add_new',
    });
    finalizeOpp(vehicle);
  }

  // ADR 30 — home analogs of handleSkipVehicle / handlePickVehicle /
  // handleVehicleAdded. Skip is legitimate here (unlike the four other
  // types it's the only path that reaches finalize with no asset) because
  // home-protection-portal's `home_add` wizard step can capture the
  // property later.
  function handleSkipHome() {
    track('mission_control.home.start_opportunity_home_skipped', {
      opp_type: picked.type,
      contact_id: picked.contact?.id,
    });
    finalizeOpp(null, null);
  }

  function handlePickHome(home) {
    track('mission_control.home.start_opportunity_home_picked', {
      opp_type: picked.type,
      contact_id: picked.contact.id,
      home_id: home.id,
    });
    finalizeOpp(null, home);
  }

  // Fired by AddHomeModal's onAdd. `home` here is the raw field-set
  // AddHomeModal builds (no id yet — see its own header comment). Stamp a
  // session id via buildHomeRecord FIRST so the same id-bearing record can
  // be persisted (appendHomeToContact) and used to finalize the
  // opportunity (buildNewOpp reads home.id/home.square_feet/home.home_type
  // /home.address for the inbox row label) without waiting on a re-render.
  function handleHomeAddedFromModal(home) {
    if (!picked.contact) return;
    const record = buildHomeRecord(home);
    if (appendHomeToContact) appendHomeToContact(picked.contact.id, record);
    track('mission_control.home.start_opportunity_home_picked', {
      opp_type: picked.type,
      contact_id: picked.contact.id,
      home_id: record.id,
      from: 'add_new',
    });
    setAddHomeOpen(false);
    finalizeOpp(null, record);
  }

  const updateVehicleForm = (patch) => {
    setVehicleForm((prev) => ({
      ...prev,
      ...(typeof patch === 'function' ? patch(prev) : patch),
    }));
  };

  function handleBack() {
    if (step === 'contact') {
      setStep('type');
    } else if (step === 'vehicle') {
      if (vehicleMode === 'add' && (picked.contact?.vehicles?.length || 0) > 0) {
        // Came in via "+ Add new vehicle" — back returns to picker.
        setVehicleMode('pick');
        setVehicleForm(INITIAL_VEHICLE_FORM);
      } else if (seededContact) {
        // Contact was seeded by the upstream caller — skip the contact
        // step entirely on back, fall back to type if it wasn't also
        // seeded.
        setStep(seededType ? 'vehicle' : 'type');
        setVehicleForm(INITIAL_VEHICLE_FORM);
        setVehicleMode('pick');
      } else {
        setStep('contact');
        setVehicleForm(INITIAL_VEHICLE_FORM);
        setVehicleMode('pick');
      }
    } else if (step === 'home') {
      if (seededContact) {
        // Mirrors the 'vehicle' seeded-back branch above.
        setStep(seededType ? 'home' : 'type');
      } else {
        setStep('contact');
      }
    }
  }

  const subtitle =
    picked.type === null
      ? 'Pick a type to start'
      : `${typeLabel(picked.type, picked.flowPath)}${
          picked.contact
            ? ' · ' +
              (picked.contact.name?.preferred ||
                `${picked.contact.name?.first ?? ''} ${picked.contact.name?.last ?? ''}`.trim())
            : ''
        }`;

  // ADR 30 D9 — home protection is a DECLARED per-org capability, gated on
  // canon opportunities.home_protection.enabled, never inferred. Prefer
  // the already-selected contact's org (covers the seeded-contact route)
  // and fall back to the resolved active org for the general dashboard
  // launcher, where the type is picked before any contact is in scope.
  const gatingOrgId = picked.contact?.org_id ?? getActiveOrgId();
  const visibleTypeOptions = TYPE_OPTIONS.filter(
    (opt) => opt.type !== 'home_protection' || isHomeProtectionEnabledForOrg(gatingOrgId),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2 min-w-0">
            {step !== 'type' && (
              <button
                onClick={handleBack}
                className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 shrink-0"
                aria-label="Back"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 truncate">
                Start opportunity
              </div>
              <div className="text-[11px] text-slate-500 truncate">{subtitle}</div>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {step === 'type' && (
            <TypeStep onPick={handlePickType} options={visibleTypeOptions} />
          )}
          {step === 'contact' && (
            <ContactStep
              contactList={contactList}
              search={contactSearch}
              onSearch={setContactSearch}
              onPick={handlePickContact}
              onAddNew={() => setAddContactOpen(true)}
            />
          )}
          {step === 'vehicle' && picked.contact && (
            <VehicleStep
              contact={picked.contact}
              mode={vehicleMode}
              onPick={handlePickVehicle}
              onAddNew={() => setVehicleMode('add')}
              form={vehicleForm}
              update={updateVehicleForm}
              onAdded={handleVehicleAdded}
              // All workflow types allow skipping the vehicle modal —
              // each workflow's wizard step 1 collects the vehicle
              // inline. Insurance previously gated here, but
              // insurance-portal's LeadOriginationForm is being
              // updated in parallel (Wave 16) to collect vehicle
              // inline too.
              canSkip={true}
              onSkip={handleSkipVehicle}
              oppType={picked.type}
            />
          )}
          {step === 'home' && picked.contact && (
            <HomeStep
              contact={picked.contact}
              homes={homes}
              onPick={handlePickHome}
              onAddNew={() => setAddHomeOpen(true)}
              canSkip={true}
              onSkip={handleSkipHome}
            />
          )}
        </div>
      </div>

      <AddContactModal
        open={addContactOpen}
        onClose={() => setAddContactOpen(false)}
        onAdd={handleContactSaved}
        contacts={contacts}
        orgId={Object.values(contacts || {})[0]?.org_id ?? 102}
      />

      <AddHomeModal
        open={addHomeOpen}
        onClose={() => setAddHomeOpen(false)}
        onAdd={handleHomeAddedFromModal}
      />
    </div>
  );
}

function typeLabel(type, flowPath) {
  if (type === 'refi') return 'Refi';
  if (type === 'protection') return 'Vehicle protection plan';
  if (type === 'home_protection') return 'Home protection';
  if (type === 'insurance') {
    if (flowPath === 'quote_only') return 'Insurance · quote only';
    return 'Insurance · capture + quote';
  }
  return type || '';
}

function TypeStep({ onPick, options }) {
  const list = options || TYPE_OPTIONS;
  return (
    <div className="px-5 py-4">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-2">
        Opportunity type
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {list.map((opt) => {
          const Icon = opt.icon;
          return (
            <button
              key={opt.key}
              onClick={() => onPick(opt)}
              className="text-left bg-slate-50 ring-1 ring-slate-200 hover:ring-blue-400 hover:bg-blue-50 rounded-md p-3 transition-colors flex items-start gap-3"
            >
              <span
                className={
                  'inline-flex w-8 h-8 rounded-md items-center justify-center ring-1 ring-inset shrink-0 ' +
                  opt.iconClass
                }
              >
                <Icon className="w-4 h-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-900">{opt.label}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{opt.sub}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ContactStep({ contactList, search, onSearch, onPick, onAddNew }) {
  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
          Contact
        </div>
        <div className="text-[11px] text-slate-400">{contactList.length} match{contactList.length === 1 ? '' : 'es'}</div>
      </div>
      <div className="relative mb-3">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search by name, phone, or email…"
          className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
        />
      </div>
      <button
        onClick={onAddNew}
        className="w-full text-left rounded-md p-3 mb-2 border-2 border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50 text-slate-500 hover:text-blue-700 flex items-center gap-2 transition-colors"
      >
        <UserPlus className="w-4 h-4" />
        <span className="text-sm font-medium">Add new contact</span>
      </button>
      <div className="space-y-1.5 max-h-[50vh] overflow-auto">
        {contactList.map((c) => {
          const display =
            c.name?.preferred ||
            `${c.name?.first ?? ''} ${c.name?.last ?? ''}`.trim();
          const primaryPhone = (c.phones || []).find((p) => p.is_primary) || c.phones?.[0];
          const primaryEmail = (c.emails || []).find((e) => e.is_primary) || c.emails?.[0];
          const vCount = (c.vehicles || []).length;
          return (
            <button
              key={c.id}
              onClick={() => onPick(c)}
              className="w-full text-left bg-white ring-1 ring-slate-200 hover:ring-blue-400 hover:bg-blue-50 rounded-md px-3 py-2 transition-colors flex items-center gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-900 truncate">
                  {display}
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  {[primaryPhone?.number, primaryEmail?.address].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <div className="text-[11px] text-slate-400 whitespace-nowrap shrink-0">
                {vCount === 0
                  ? 'no vehicles'
                  : `${vCount} vehicle${vCount === 1 ? '' : 's'}`}
              </div>
            </button>
          );
        })}
        {contactList.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-slate-400">
            No contacts match. Use "Add new contact" above.
          </div>
        )}
      </div>
    </div>
  );
}

function VehicleStep({
  contact,
  mode,
  onPick,
  onAddNew,
  form,
  update,
  onAdded,
  canSkip,
  onSkip,
  oppType,
}) {
  // Skip footer is identical for both modes (add + pick) so the agent
  // can bail out of vehicle entry at any time. All workflow types
  // (refi / protection / insurance) collect the vehicle inline as
  // wizard step 1, so skipping here is always safe. home_protection never
  // reaches this component (it routes to HomeStep below) — the branch
  // here is defensive only.
  const wizardLabel =
    oppType === 'refi'
      ? 'refi'
      : oppType === 'insurance'
        ? 'insurance'
        : oppType === 'home_protection'
          ? 'home protection'
          : 'protection';
  const SkipFooter = canSkip ? (
    <div className="px-5 pt-3 pb-4 border-t border-slate-100 mt-2">
      <button
        onClick={onSkip}
        className="w-full text-sm font-medium px-3 py-2 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 inline-flex items-center justify-center gap-2"
      >
        Skip — collect vehicle inside the {wizardLabel} wizard
      </button>
      <p className="text-[11px] text-slate-400 mt-1.5 text-center">
        The {wizardLabel} CoPilot already collects the vehicle in its
        first wizard step.
      </p>
    </div>
  ) : null;

  if (mode === 'add') {
    return (
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12 text-sm text-slate-400">
            Loading vehicle form…
          </div>
        }
      >
        <div className="py-4">
          <VehicleAdd form={form} update={update} onNext={onAdded} />
        </div>
        {SkipFooter}
      </Suspense>
    );
  }
  const vehicles = contact.vehicles || [];
  return (
    <>
      <div className="px-5 py-4">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-2">
          Vehicle
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {vehicles.map((v) => {
            const vinSuffix = v.vin ? v.vin.slice(-6) : null;
            return (
              <button
                key={v.id}
                onClick={() => onPick(v)}
                className="text-left bg-slate-50 ring-1 ring-slate-200 hover:ring-blue-400 hover:bg-blue-50 rounded-md p-3 transition-colors"
              >
                <div className="text-sm font-semibold text-slate-900">
                  {v.year} {v.make} {v.model}
                  {v.trim && <span className="text-slate-500 font-normal"> {v.trim}</span>}
                </div>
                {vinSuffix && (
                  <div className="text-[11px] font-mono text-slate-500 mt-1">
                    VIN · …{vinSuffix}
                  </div>
                )}
              </button>
            );
          })}
          <button
            onClick={onAddNew}
            className="text-left rounded-md p-3 border-2 border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50 text-slate-500 hover:text-blue-700 flex items-center gap-2 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span className="text-sm font-medium">Add new vehicle</span>
          </button>
        </div>
      </div>
      {SkipFooter}
    </>
  );
}

// ADR 30 R8 — asset-step picker for home_protection. Structural twin of
// VehicleStep's "pick" render (grid + dashed add tile + skip footer), but
// with no inline "add" mode: AddHomeModal is a full modal (own backdrop +
// header + close button, not a bare form component like VehicleAdd), so
// "Add new home" opens it as a sibling modal stacked over this one instead
// of swapping this step's own content — see the StartOpportunityFlow
// header comment on step 3'.
function HomeStep({ contact, homes, onPick, onAddNew, canSkip, onSkip }) {
  // Mirrors ContactProfile's `contactHomes` computation — membership is
  // via contact_ids inclusion, NOT a stored contact.homes[] (ADR 30 D2, a
  // home can carry a second agreement holder).
  const contactHomes = homes
    ? Object.values(homes).filter(
        (h) => Array.isArray(h.contact_ids) && h.contact_ids.includes(contact.id),
      )
    : [];
  const SkipFooter = canSkip ? (
    <div className="px-5 pt-3 pb-4 border-t border-slate-100 mt-2">
      <button
        onClick={onSkip}
        className="w-full text-sm font-medium px-3 py-2 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 inline-flex items-center justify-center gap-2"
      >
        Skip — collect the home inside the Home protection wizard
      </button>
      <p className="text-[11px] text-slate-400 mt-1.5 text-center">
        The Home protection CoPilot's home_add step can capture the
        property later.
      </p>
    </div>
  ) : null;

  return (
    <>
      <div className="px-5 py-4">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-2">
          Home
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {contactHomes.map((h) => {
            const addr = h.address || {};
            const cityState = [addr.city, addr.state].filter(Boolean).join(', ');
            return (
              <button
                key={h.id}
                onClick={() => onPick(h)}
                className="text-left bg-slate-50 ring-1 ring-slate-200 hover:ring-blue-400 hover:bg-blue-50 rounded-md p-3 transition-colors"
              >
                <div className="text-sm font-semibold text-slate-900">
                  {h.square_feet != null
                    ? `${Number(h.square_feet).toLocaleString()} sq ft `
                    : ''}
                  {homeTypeLabel(h.home_type)}
                </div>
                {(addr.address1 || cityState) && (
                  <div className="text-[11px] text-slate-500 mt-1">
                    {[addr.address1, cityState].filter(Boolean).join(' · ')}
                  </div>
                )}
              </button>
            );
          })}
          <button
            onClick={onAddNew}
            className="text-left rounded-md p-3 border-2 border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50 text-slate-500 hover:text-blue-700 flex items-center gap-2 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span className="text-sm font-medium">Add new home</span>
          </button>
        </div>
        {contactHomes.length === 0 && (
          <p className="text-[11px] text-slate-400 mt-2">
            No homes on file for this contact yet.
          </p>
        )}
      </div>
      {SkipFooter}
    </>
  );
}

