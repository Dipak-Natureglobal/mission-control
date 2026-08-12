// AgentView — the protection-portal agent shell. Composes the customer
// wizard inside agent chrome rather than duplicating any screens.
//
// Layout:
//   ┌─ Top bar ───────────────────────────────────────────┐
//   │ Status pill · Force status · Persona · API responses│
//   └─────────────────────────────────────────────────────┘
//   ┌─ Main column ───────────┐   ┌─ Side column ────────┐
//   │ CaptureLinkForm (gate)  │   │ Agent notes panel    │
//   │   then ProtectionWizard │   │  (or cross-sell pane │
//   │   + Save and Send       │   │   when active)       │
//   └─────────────────────────┘   └──────────────────────┘
//
// Cross-sell side pane (§ 1.5d):
//   When the agent clicks one of the RecommendedCoverage CTAs, the
//   right column flips from NotesPanel to a CrossSellSubFlow embed.
//   The wizard stays mounted on the left so form state survives. Close
//   button on the panel returns the right column to NotesPanel; the
//   form.insuranceSavings / form.refiOffer slots populated by the
//   embed light up the buying-power UI on the still-visible plan
//   cards on the left.
//
// State ownership:
//   * form / stepIdx — the same shape CustomerView uses, lifted here so
//     the agent shell can read everything (status pill, View API
//     Responses, Save and Send deep-link).
//   * opportunity — agent-only metadata (id, captureLink, contact,
//     status, sentSummary). Distinct from form because the customer
//     wizard doesn't know or care about the capture link or the agent's
//     overrides.
//   * crossSell — { workflow: 'insurance' | 'refi' | null }. Drives the
//     right-pane composition.
//   * persona / apiModalOpen — UI-only.
//
// Persona note: the persona switcher in the top bar is local to this
// view because mission-control owns the cross-app PersonaSwitcher. When
// AgentView is mounted inside mission-control's CoPilotPane via the
// `file:` import, the parent should pass `persona` as a prop and the
// local switcher can be hidden via the `personaLocked` flag.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useForm } from '../../hooks/useForm.js';
import {
  ProtectionWizard,
  INITIAL_FORM,
  buildSteps,
} from '../customer/CustomerView.jsx';
import { buildMockHousehold } from '../../lib/contact.js';
import {
  WORKFLOW_ICONS,
  CrossSellLoading,
} from '../customer/CrossSellChrome.jsx';

// Lazy-load the cross-sell embed body — drags in the refi-portal
// monolith via PrequalForm, so we keep it off the agent shell's initial
// bundle. The agent only sees it when they flip a workflow toggle in
// DEV CONTROLS or trigger an opportunity-side cross-sell.
const CrossSellSubFlow = lazy(() => import('../customer/CrossSellSubFlow.jsx'));
import { CaptureLinkForm, VSC_STATUS } from './CaptureLinkForm.jsx';
import { stepFromStatus } from '../../lib/status-step-map.js';
import { AgentTopBar, SaveAndSendFooter, CanonNotice } from './AgentChrome.jsx';
import { NotesPanel } from 'blinker-platform/components';
import { ApiResponsesModal } from './ApiResponsesModal.jsx';
import { track } from 'blinker-platform/telemetry';
import personasJson from '../../constants/canon/personas.json';

function permissionsFor(persona) {
  return personasJson.personas?.[persona]?.permissions ?? [];
}

// Phase 2 prefill helper: merge a canonical mission-control contact +
// vehicle (both optional) into INITIAL_FORM. Standalone callers — App.jsx
// and any other public-surface consumer that doesn't pass these props —
// receive INITIAL_FORM unchanged because both args are null/undefined.
//
// Mapping rules (write only fields where input is present; INITIAL_FORM
// defaults remain otherwise):
//   contact.org_id → form.org_id (only when defined)
//   contact.name.{first,last} → form.contact.{first_name,last_name}
//   primary email.address → form.contact.email
//   primary phone.number → form.contact.phone (strip leading +1)
//   primary address.{line_1,city,state,postal_code} → form.contact.{address1,city,state,zip}
//   vehicle.{vin,year,make,model,trim,mileage} → flat form fields
//   vehicle → form.vehicle = { year, make, model, trim, vin, source }
//   vehicle.source === 'vin_decode' → form.vinDecoded = true
function buildInitialFormSeed(contact, vehicle) {
  if (!contact && !vehicle) return INITIAL_FORM;

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
    const primaryAddr = addresses.find((a) => a?.is_primary) || addresses[0] || null;

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
      // prompt (CrossSellSubFlow / RefiMiniFlow) can offer them as a co-app
      // option. Resolved by mission-control's contact-prefill (commit
      // 9b7fefe) when contact has household_member_ids; absent or [] for
      // contacts without household links.
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

  return seed;
}

const WORKFLOW_TITLES = {
  insurance: 'Find insurance savings',
  refi: 'Lower your monthly with refinance',
};

const INITIAL_OPPORTUNITY = {
  id: null,
  contact: null,
  captureLink: null,
  status: VSC_STATUS.EMPTY, // canon vsc display name (no machine_id yet)
  sentSummary: null,
};

export function AgentView({
  persona: personaProp,
  personaLocked = false,
  seedMultiContactHousehold = false,
  contact: contactProp,
  vehicle: vehicleProp,
  onFormChange,
  // Wave 16 F2-fu11 — fired when the wizard's Step 1 (VehicleAdd)
  // commits a canonical vehicle record to form.vehicle. Optional;
  // standalone callers (App.jsx) leave undefined and the observer
  // below becomes a no-op. Cross-repo contract: mission-control's
  // CoPilotPane consumes this to push the vehicle up to its session
  // contacts so the left "Vehicle" pane reflects the wizard's real
  // state instead of "No vehicle yet" once Step 1 settles.
  onVehicleCommitted,
  // Wave 14 — embed-friendly props for mission-control's consolidated
  // DevPanel. When mission-control mounts <ProtectionDevControls> beside
  // AgentView, it owns devOptions state and threads the cross-sell
  // overrides + the Confirm-card toggle through here so the lifted
  // controls drive the same behavior the standalone DEV CONTROLS sidebar
  // does. All optional — standalone callers (App.jsx) leave these
  // undefined and AgentView's internal useState + true defaults apply.
  //
  // Post-1.5 dev-controls lift: AgentView no longer writes the gate
  // state internally (the inner DEV CONTROLS panel was relocated to the
  // left DevPanel), so `setCrossSellOverrides` is retained on the public
  // prop signature as a no-op slot — destructured with the eslint-
  // ignore pattern below — but never invoked from inside AgentView.
  crossSellOverrides: crossSellOverridesProp,
  // The leading underscore matches the eslint config's argsIgnorePattern
  // so this destructure-and-discard pattern doesn't trip no-unused-vars.
  setCrossSellOverrides: _setCrossSellOverridesProp,
  showInsuranceCrossSell = true,
  // Wave (post-1.5 dev-controls lift) — optional shared form / stepIdx
  // ownership. When provided, AgentView reads + writes the parent's
  // state; when absent it falls back to its own internal useForm +
  // useState. Standalone callers (App.jsx pre-lift) and pre-Phase-2
  // embedders keep working unchanged because both pairs are optional
  // and detected together.
  form: formProp,
  update: updateProp,
  stepIdx: stepIdxProp,
  setStepIdx: setStepIdxProp,
  // Wave 13-fu-1 — optional override for the FORCE STATUS picker list.
  // Threaded straight through to AgentTopBar. When set and non-empty, it
  // replaces the canon-derived VSC display-name list; unset or empty
  // falls back to canon (today's behavior). Mission-control's CoPilotPane
  // will populate this from its SuperHome StatusMappingEditor output
  // (localStorage `mc.status-mapping.v1`) per active org.
  availableStatuses,
  // Wave 18-fu6 — embed-mode opportunity sync. mission-control's CoPilotPane
  // passes opportunity={...} carrying the canonical opportunity record from
  // the mc session (status, captureLink, sentSummary, etc.). When provided,
  // AgentView mirrors the relevant fields into its local opportunity state
  // on mount and when the prop's status changes. Standalone callers
  // (App.jsx) leave this undefined and the internal INITIAL_OPPORTUNITY
  // default applies (preserving today's behavior).
  opportunity: opportunityProp,
}) {
  // Agent-side opportunity state. Seeded from opportunityProp when provided
  // (embed mode) or INITIAL_OPPORTUNITY when absent (standalone mode).
  const initialOpportunity = opportunityProp
    ? {
        ...INITIAL_OPPORTUNITY,
        id: opportunityProp.id ?? null,
        status: opportunityProp.status ?? VSC_STATUS.EMPTY,
        captureLink: opportunityProp.captureLink ?? null,
        sentSummary: opportunityProp.sentSummary ?? null,
        contact: opportunityProp.contact ?? null,
      }
    : INITIAL_OPPORTUNITY;
  const [opportunity, updateOpportunity] = useForm(initialOpportunity);

  // Phase 2 prefill: when mission-control's CoPilotPane mounts AgentView,
  // it passes a canonical contact (and optional vehicle) prop. Merge those
  // into INITIAL_FORM to seed the wizard's form state on first render.
  // The parent remounts via `key` whenever opportunity/contact changes, so
  // the seed only needs to be computed once per mount; useMemo here is for
  // stability, not reactivity (useForm reads its argument once). We key
  // the memo on the canonical prop ids — that's the stable identity we
  // care about, not full referential equality of the prop objects.
  const initialFormSeed = useMemo(
    () => buildInitialFormSeed(contactProp, vehicleProp),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contactProp?.id, vehicleProp?.id],
  );

  // Customer-side wizard state — owned by AgentView when no parent props
  // are passed (standalone fallback). When the parent threads form +
  // update + stepIdx + setStepIdx, those win and the internal state goes
  // unused. Hooks always run (preserves Rules of Hooks); the const swap
  // below picks which slot to read.
  const [internalForm, internalUpdate] = useForm(initialFormSeed);
  const [internalStepIdx, setInternalStepIdx] = useState(0);
  const form = formProp ?? internalForm;
  const updateForm = updateProp || internalUpdate;
  const stepIdx = stepIdxProp ?? internalStepIdx;
  const setStepIdx = setStepIdxProp || setInternalStepIdx;

  // Wave 18-fu2 — status-to-step seeding. When opportunity.status changes
  // to a post-Empty value (either at mount via a pre-set fixture, or when
  // the agent uses Force Status in the top bar), advance stepIdx to the
  // canonical resume point for that status.
  //
  // Design notes:
  //   * Only fires when stepIdx is currently 0. If the agent has already
  //     advanced past step 0 manually, we don't teleport them backward or
  //     forward — the manual position wins.
  //   * When the parent owns stepIdx (stepIdxProp is set), we still call
  //     setStepIdx (which resolves to setStepIdxProp) so the parent's
  //     state also reflects the resume point. This handles the mc embed
  //     path if/when mc passes an opportunity status (Phase 2).
  //   * stepFromStatus returns 'vehicle_add' (index 0) for Empty and
  //     unknown statuses, so the effect is a no-op for those.
  //   * buildSteps(form) is the dynamic step list — indexOf the mapped
  //     step key gives the correct index even when optional steps (e.g.
  //     garage_location, customize) are inserted. Clamped to 0 on miss
  //     so an unrecognised step key doesn't produce a negative index.
  useEffect(() => {
    const status = opportunity?.status;
    if (!status || status === VSC_STATUS.EMPTY) return;
    // Only auto-jump when the wizard hasn't been navigated yet.
    if (stepIdx !== 0) return;
    const targetKey = stepFromStatus(status, 'vehicle_add');
    if (targetKey === 'vehicle_add') return; // no-op for fallback
    const dynamicSteps = buildSteps(form);
    const targetIdx = dynamicSteps.indexOf(targetKey);
    if (targetIdx > 0) {
      setStepIdx(targetIdx);
      track('protection.agent.wizard_resumed_at_step', {
        status,
        step: targetKey,
        step_idx: targetIdx,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Deps: status change drives the effect. form/stepIdx/setStepIdx are
    // stable refs — form only changes identity on useForm updates (which
    // don't happen here), setStepIdx is a stable setState ref, and we
    // guard on stepIdx === 0 inside the body rather than listing it as
    // a dep to avoid infinite loops when stepIdx updates from 0 to n.
  }, [opportunity?.status]);

  // Phase 2: optional `onFormChange` callback lets embedders (e.g.
  // mission-control's CoPilotPane debug panel) mirror live form state.
  // Fires on mount with the seeded form and on every subsequent change.
  // Parent should memoize the callback if reference stability matters.
  useEffect(() => {
    if (typeof onFormChange === 'function') onFormChange(form);
  }, [form, onFormChange]);

  // Wave 16 F2-fu11 — observe canonical vehicle data and fire
  // onVehicleCommitted whenever any tracked slot changes. VehicleAdd's
  // persistVehicleAndAdvance writes form.vehicle on Continue (and on
  // the mismatch modal's Confirm); VehicleDrive's data-write effect
  // adds mileage / ownership (form.condition) / purchaseDate /
  // form.vehicle.market_value. The observer fires for both steps so mc
  // can keep its left-pane Vehicle card current with whatever the
  // wizard knows.
  //
  // Idempotency: handed off to mc. The handler dedupes the underlying
  // contact.vehicles entry by id (deterministic from VIN-or-YMMT) and
  // patches an existing match in place rather than appending. So this
  // effect can fire freely — repeat fires with the same payload are
  // no-op patches. Removing the local lastFiredKey ref also fixes a
  // class of under-dedupe that the Step 2 fields would have caused
  // (the old ref keyed on YMMT+VIN only, so mileage/ownership changes
  // wouldn't refire).
  //
  // Standalone (no embedder) leaves onVehicleCommitted undefined and
  // this effect is a no-op.
  //
  // Wave 16 F2-fu11 — Bug 1 root cause was a separate effect in
  // mc/CoPilotPane that nulled protectionForm + reset stepIdx whenever
  // its `vehicle` dep ref changed. The fix lives over there (a single-
  // dep cleanup-only effect keyed on opportunity.id). This observer
  // continues firing on Step 2 mutations as designed; the wire-back no
  // longer kicks the wizard back to Step 0.
  useEffect(() => {
    if (typeof onVehicleCommitted !== 'function') return;
    const v = form?.vehicle;
    if (!v) return;
    const hasYmmt = v.year && v.make && v.model && v.trim;
    if (!hasYmmt && !v.vin) return;
    const id = v.vin
      ? `xs_vin_${v.vin}`
      : `xs_ymmt_${v.year}_${(v.make || '').replace(/\s+/g, '_')}_${(v.model || '').replace(/\s+/g, '_')}_${(v.trim || '').replace(/\s+/g, '_')}`;
    // form.condition ('New' | 'Used') maps to canonical vehicle.ownership
    // ('new' | 'used'). VehicleDrive populates form.mileage and
    // form.purchaseDate as scalars; market_value lives on the canonical
    // form.vehicle.market_value slot (post-Wave-16-F3, refi's MarketCheck
    // card writes there via VehicleDrive's data-write effect).
    const ownership =
      typeof form?.condition === 'string' && form.condition.length > 0
        ? form.condition.toLowerCase()
        : null;
    onVehicleCommitted({
      id,
      year: v.year ?? null,
      make: v.make || '',
      model: v.model || '',
      trim: v.trim || '',
      vin: v.vin || null,
      source: v.source || (v.vin ? 'vin' : 'manual'),
      // Wave 16 F2-fu11 Step 2 extension. mc's handler patches these
      // onto the existing vehicle when present and skips them when
      // null/undefined (so a Step 1 fire before Step 2 doesn't blank
      // out a previously-patched value).
      mileage: form?.mileage ?? null,
      ownership,
      purchase_date: form?.purchaseDate ?? null,
      market_value: v.market_value ?? null,
    });
  }, [
    form?.vehicle?.year,
    form?.vehicle?.make,
    form?.vehicle?.model,
    form?.vehicle?.trim,
    form?.vehicle?.vin,
    form?.vehicle?.source,
    form?.vehicle?.market_value,
    form?.mileage,
    form?.condition,
    form?.purchaseDate,
    onVehicleCommitted,
  ]);

  // DEV CONTROLS · seed mock multi-contact household. Mirrors the same
  // effect on CustomerView; in agent mode this is the primary surface
  // for the BillingPayment switcher UX so the toggle's main path is
  // here. Only seeds when household_members is empty so toggling off →
  // on after a manual edit is non-destructive.
  useEffect(() => {
    if (!seedMultiContactHousehold) return;
    const existing = form.contact?.household_members;
    if (Array.isArray(existing) && existing.length > 0) return;
    const members = buildMockHousehold(form.contact || {});
    const primary = members.find((m) => m.is_primary) || members[0];
    updateForm({
      contact: {
        ...(form.contact || {}),
        first_name: form.contact?.first_name || primary.first_name,
        last_name: form.contact?.last_name || primary.last_name,
        email: form.contact?.email || primary.email,
        phone: form.contact?.phone || primary.phone,
        household_members: members,
        active_member_id: primary.id,
        active_address_id: primary.addresses?.[0]?.id || null,
      },
    });
    track('dev.seed_multi_contact_applied', {
      view: 'agent',
      member_count: members.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedMultiContactHousehold]);

  // Cross-sell side-pane state. workflow === null means the right pane
  // shows NotesPanel (default); set to 'insurance' or 'refi' to flip
  // it to the CrossSellSubFlow embed.
  const [crossSell, setCrossSell] = useState({ workflow: null });

  // DEV CONTROLS overrides for cross-sell gating. When undefined, the
  // canon org-registry value passes through.
  //
  // Source of truth (post dev-controls lift): the standalone DevControls
  // sidebar (App.jsx) and mission-control's consolidated DevPanel both
  // own this state via setDevOptions and thread the read value through
  // here as `crossSellOverrides`. AgentView no longer hosts a local
  // toggle UI for it (the inner cross-sell DEV CONTROLS panel that used
  // to live below NotesPanel moved into the left DevPanel), so writes
  // happen entirely outside AgentView.
  const crossSellOverrides = crossSellOverridesProp;

  // UI state.
  const [persona, setPersonaInner] = useState(personaProp || 'agent');
  // Sync embed-mode prop changes into local state. When mission-control's
  // CoPilotPane flips personaProp, the local state follows so the parent
  // can drop its `key={`persona:${opportunity.id}`}` remount workaround.
  // Standalone mode leaves personaProp undefined, so the guard makes this
  // a no-op there and the local switcher's setPersonaInner stays
  // authoritative.
  useEffect(() => {
    if (personaProp && personaProp !== persona) {
      setPersonaInner(personaProp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only personaProp drives this; including `persona` would cause a re-sync loop
  }, [personaProp]);
  const [apiModalOpen, setApiModalOpen] = useState(false);

  // Notes — log-mode (Wave 16 F2-fu13). NotesPanel reads + writes through
  // blinkerApi.notes internally; AgentView no longer owns a notes string.
  // Tag state lives on form.contact.{tags, tagsCreated} — seeded in
  // INITIAL_FORM so reads are null-safe.

  // Tag permissions derived from canon/personas.json. Agent applies-only;
  // manager+ also creates; consumer is locked out.
  const perms = permissionsFor(persona);
  const canAddTags = perms.includes('add_tags');
  const canCreateTags = perms.includes('create_tags');

  const contact = form?.contact || {};
  const selectedTagIds = Array.isArray(contact.tags) ? contact.tags : [];
  const sessionCreatedTags = Array.isArray(contact.tagsCreated) ? contact.tagsCreated : [];

  function writeContact(patch) {
    updateForm({ contact: { ...(form?.contact || {}), ...patch } });
  }
  function onTagAdd(tagId) {
    if (selectedTagIds.includes(tagId)) return;
    writeContact({ tags: [...selectedTagIds, tagId] });
  }
  function onTagRemove(tagId) {
    writeContact({ tags: selectedTagIds.filter((id) => id !== tagId) });
  }
  function onTagCreate(tag) {
    writeContact({
      tagsCreated: [...sessionCreatedTags, tag],
      tags: [...selectedTagIds, tag.id],
    });
  }

  function setPersona(p) {
    if (personaLocked) return;
    setPersonaInner(p);
    track('protection.agent.persona_switched', { persona: p });
  }
  function setOpportunityStatus(next) {
    updateOpportunity({ status: next });
  }

  // Wave 18-fu6 — keep local opportunity.status in sync with the prop.
  // When mc's CoPilotPane updates opportunity.status (force-status picker,
  // status_change activity), this effect mirrors it into local state so
  // the FORCE STATUS dropdown + status pill + showWizard gate all reflect
  // the current status. Depends only on the primitive status string to
  // avoid churning ref-stability invariants from Wave 17 P1-fu3b.
  useEffect(() => {
    const next = opportunityProp?.status;
    if (!next) return;
    if (next === opportunity.status) return;
    setOpportunityStatus(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Deps: only the primitive status string drives this sync. `opportunity.status`
    // is intentionally excluded — it's the destination, not the trigger, and
    // including it would risk a sync loop when setOpportunityStatus updates it.
  }, [opportunityProp?.status]);

  // Wave 18-fu2: relaxed gate — captureLink presence no longer blocks
  // wizard visibility for already-quoted opps. The captureLink field is a
  // session-runtime artifact (generated by CaptureLinkForm on first use);
  // it isn't a domain requirement for opps that arrive pre-quoted from a
  // fixture or from the Phase 2 API. Gating behind it left CoPilot
  // permanently on CaptureLinkForm for Booked/Quoted/etc fixture opps
  // that naturally have no captureLink in their record.
  //
  // Trade-off: Empty-status opps still show CaptureLinkForm because
  // status === EMPTY is the gate. Any non-Empty opp with status implying
  // a quote was generated shows the wizard, which is the correct UX.
  // If a post-Empty opp genuinely has no quote data, the wizard starts at
  // vehicle_add (via stepFromStatus fallback) and the agent can proceed
  // normally — no functional regression vs. the old path.
  const showWizard = opportunity.status !== VSC_STATUS.EMPTY;
  const steps = buildSteps(form);
  const currentStepKey = steps[Math.min(stepIdx, steps.length - 1)] || 'vehicle_add';

  function onApiResponsesOpen() {
    track('protection.agent.api_responses_viewed', {
      opportunity_id: opportunity.id,
      from_step: currentStepKey,
    });
    setApiModalOpen(true);
  }

  function openCrossSell(workflow) {
    setCrossSell({ workflow });
    track('protection.cross_sell.side_pane_opened', { workflow, persona });
  }

  function closeCrossSell() {
    track('protection.cross_sell.side_pane_closed', {
      workflow: crossSell.workflow,
      persona,
    });
    setCrossSell({ workflow: null });
  }

  function handleCrossSellComplete(patch) {
    // Embed components fire their own granular completion events; this
    // handler just lifts the result into form state.
    if (patch?.insuranceSavings) updateForm({ insuranceSavings: patch.insuranceSavings });
    if (patch?.refiOffer) updateForm({ refiOffer: patch.refiOffer });
    closeCrossSell();
  }

  // Right pane composes the cross-sell embed when active, else the
  // notes panel. Cross-sell DEV CONTROLS (force-complete + JsonPeeks)
  // live in the LEFT DevPanel now (ProtectionDevControls); this pane
  // is intentionally NotesPanel-only so the agent's note-taking surface
  // stays clean.
  const rightPane = crossSell.workflow ? (
    <CrossSellPane
      workflow={crossSell.workflow}
      form={form}
      onComplete={handleCrossSellComplete}
      onClose={closeCrossSell}
      persona={persona}
      // Wave 17 P1-fu — when the cross-sell's VIN-collection pre-step
      // commits a vehicle (protection's wizard allows YMMT-only entry,
      // so cross-sell may need to collect a VIN), forward the canonical
      // vehicle up to mc via the same wire-back contract the wizard uses
      // (Wave 16 F2-fu11). mc's CoPilotPane dedupes by id and patches
      // the existing contact.vehicles entry in place.
      onVehicleCommitted={onVehicleCommitted}
    />
  ) : (
    <NotesPanel
      contactId={contactProp?.id}
      opportunityId={opportunity.id}
      authorId="agent_session"
      showTags={true}
      selectedTagIds={selectedTagIds}
      onTagAdd={onTagAdd}
      onTagRemove={onTagRemove}
      onTagCreate={onTagCreate}
      canAddTags={canAddTags}
      canCreateTags={canCreateTags}
      sessionCreatedTags={sessionCreatedTags}
      orgId={form.org_id}
      persona={persona}
      trackingPrefix="protection.agent"
    />
  );

  return (
    <>
      <AgentTopBar
        opportunity={opportunity}
        setOpportunityStatus={setOpportunityStatus}
        persona={persona}
        setPersona={setPersona}
        personaLocked={personaLocked}
        onOpenApiResponses={onApiResponsesOpen}
        availableStatuses={availableStatuses}
      />
      <CanonNotice />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <div>
          {!showWizard && (
            <CaptureLinkForm
              opportunity={opportunity}
              updateOpportunity={updateOpportunity}
              contact={contactProp}
            />
          )}
          {showWizard && (
            <>
              <ProtectionWizard
                form={form}
                update={updateForm}
                stepIdx={stepIdx}
                setStepIdx={setStepIdx}
                persona="agent"
                onOpenCrossSell={openCrossSell}
                crossSellOverrides={crossSellOverrides}
                showInsuranceCrossSell={showInsuranceCrossSell}
              />
              <SaveAndSendFooter
                opportunity={opportunity}
                currentStepKey={currentStepKey}
                sentSummary={opportunity.sentSummary}
                onSent={(s) => updateOpportunity({ sentSummary: s })}
              />
            </>
          )}
        </div>
        <div className="space-y-4">{rightPane}</div>
      </div>

      {apiModalOpen && (
        <ApiResponsesModal
          form={form}
          persona={persona}
          onClose={() => setApiModalOpen(false)}
        />
      )}
    </>
  );
}

// Side-pane wrapper for the cross-sell embed. Mirrors mission-control's
// CoPilotPane visual pattern: title bar with workflow name + close
// button, then the embed body.
function CrossSellPane({ workflow, form, onComplete, onClose, persona, onVehicleCommitted }) {
  const Icon = WORKFLOW_ICONS[workflow];
  const title = WORKFLOW_TITLES[workflow] || workflow;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {Icon && <Icon className="w-4 h-4 text-slate-600 shrink-0" />}
          <div className="text-xs uppercase tracking-wide font-semibold text-slate-700 truncate">
            {title}
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-slate-200 text-slate-500"
          aria-label="Close cross-sell pane"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-3">
        <Suspense fallback={<CrossSellLoading />}>
          <CrossSellSubFlow
            workflow={workflow}
            form={form}
            onComplete={onComplete}
            onCancel={onClose}
            persona={persona}
            personaLocked={true}
            onVehicleCommitted={onVehicleCommitted}
          />
        </Suspense>
      </div>
    </div>
  );
}

