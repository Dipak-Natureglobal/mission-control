import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  Umbrella,
  UserPlus,
  X,
} from 'lucide-react';
import { AddContactModal } from './AddContactModal.jsx';
import { buildNewOpp } from '../lib/session-data.js';
import { track } from 'blinker-platform/telemetry';

// StartOpportunityFlow — multi-step modal for the AgentHome quick-action
// launcher. Composes existing primitives (OpportunityTypeMenu's type list,
// AddContactModal's form, NewOpportunityFlow's vehicle picker) into a
// single guided flow that smart-routes around missing data.
//
// Steps (state machine `step`):
//   1. 'type'    — pick opportunity type. Card-grid of 4 (refi, insurance×2,
//                  protection). Cards record { type, flowPath } and advance.
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
//                  into CoPilotPane.
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
    label: 'Protection plan',
    sub: 'VSC / GAP / etc.',
    icon: ShieldCheck,
    iconClass: 'bg-indigo-50 text-indigo-600 ring-indigo-200',
    flowPath: undefined,
  },
];

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

export function StartOpportunityFlow({
  open,
  contacts,
  appendContact,
  appendOpportunity,
  appendVehicleToContact,
  appendHouseholdRelationship,
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
    !!(seededContact && (seededContact.vehicles || []).length === 0);
  const initialStep = seededContact && seededType
    ? 'vehicle'
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
    setStep(seededContact && seededType ? 'vehicle' : 'type');
    setContactSearch('');
    setAddContactOpen(false);
    setVehicleMode('pick');
    setVehicleForm(INITIAL_VEHICLE_FORM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Mount-side auto-skip: when seededContact is a zero-vehicle contact
  // and seededType is also set, the modal would have opened on the
  // 'vehicle' step. Per Wave 16 F2, that step is redundant — every
  // workflow's wizard collects the vehicle inline as step 1. Auto-skip
  // through runVehicleSkipFlow before VehicleStep renders.
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

  if (!open) return null;

  function reset() {
    // Re-derive from the seed props so a re-open after a save still
    // honors the caller's intent.
    setStep(initialStep);
    setPicked(initialPicked);
    setContactSearch('');
    setAddContactOpen(false);
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

  function handlePickContact(contact) {
    track('mission_control.home.start_opportunity_contact_picked', {
      opp_type: picked.type,
      contact_id: contact.id,
    });
    setPicked((prev) => ({ ...prev, contact }));
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

  function finalizeOpp(vehicle) {
    if (!picked.contact) return;
    const opp = buildNewOpp({
      type: picked.type,
      contact: picked.contact,
      vehicle,
      flowPath: picked.flowPath,
    });
    if (appendOpportunity) appendOpportunity(opp);
    track('mission_control.home.start_opportunity_created', {
      opp_id: opp.id,
      opp_type: picked.type,
      contact_id: picked.contact.id,
      vehicle_id: vehicle?.id || null,
      flow_path: picked.flowPath,
      vehicle_skipped: !vehicle,
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
          {step === 'type' && <TypeStep onPick={handlePickType} />}
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
        </div>
      </div>

      <AddContactModal
        open={addContactOpen}
        onClose={() => setAddContactOpen(false)}
        onAdd={handleContactSaved}
        contacts={contacts}
        orgId={Object.values(contacts || {})[0]?.org_id ?? 102}
      />
    </div>
  );
}

function typeLabel(type, flowPath) {
  if (type === 'refi') return 'Refi';
  if (type === 'protection') return 'Protection plan';
  if (type === 'insurance') {
    if (flowPath === 'quote_only') return 'Insurance · quote only';
    return 'Insurance · capture + quote';
  }
  return type || '';
}

function TypeStep({ onPick }) {
  return (
    <div className="px-5 py-4">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-2">
        Opportunity type
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {TYPE_OPTIONS.map((opt) => {
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
  // wizard step 1, so skipping here is always safe.
  const wizardLabel =
    oppType === 'refi'
      ? 'refi'
      : oppType === 'insurance'
        ? 'insurance'
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



