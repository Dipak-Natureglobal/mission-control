import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  Phone,
  Mail,
  MapPin,
  Link2,
  AlertTriangle,
  ExternalLink,
  Car,
  MessageSquare,
  UserCog,
} from 'lucide-react';
import { blinkerApi, opportunities as opportunitiesApi, activities as activitiesApi } from 'blinker-platform/api';
import { AgentPicker, reduceSourceOrgPolicy } from '../personas/manager/AgentPicker.jsx';
import { AgentView as ProtectionAgentView } from 'protection-portal/src/views/agent';
// Wave 31 v3.0.11 (ADR 21 D5) — cross-show protection's RecommendedCoverage
// in the insurance CoPilot right pane when a related protection opp ≤ step 5
// exists. The named export lives in protection-portal's customer barrel
// (`src/views/customer/index.js`, added by the companion protection-portal
// commit). Import from the barrel rather than the deep file path to keep the
// public surface explicit per ADR 08 § Embed contract.
import { RecommendedCoverage as ProtectionRecommendedCoverage } from 'protection-portal/src/views/customer';
// INITIAL_FORM is exported from protection-portal's CustomerView. Deep-
// import is the same pattern the refi embed uses (lazy import of
// refi-portal/src/views/customer/RefiWizard.jsx). Eager here because
// ProtectionAgentView is already eager — the chunk is in the base
// bundle either way.
import {
  INITIAL_FORM as PROTECTION_INITIAL_FORM,
  buildSteps as buildProtectionSteps,
} from 'protection-portal/src/views/customer/CustomerView.jsx';
import { stepFromStatus } from 'protection-portal/src/lib/status-step-map.js';
import { stepFromStatus as refiStepFromStatus } from 'refi-portal/src/lib/status-step-map.js';
import { stepFromStatus as insuranceStepFromStatus, stepFromMachineId as insuranceStepFromMachineId } from 'insurance-portal/src/lib/status-step-map.js';
import { getSequence } from 'refi-portal/src/lib/refi';
import { track } from 'blinker-platform/telemetry';
import { formatVehicleLabel } from 'blinker-platform/utils';
import { TYPE_LABELS, TYPE_BADGE, ageDays, ageLabel } from '../lib/canon.js';
import { useActiveWorkflow } from '../lib/active-workflow.js';
import { buildRefiInitialForm } from '../lib/refi-initial-form.js';
import { buildProtectionInitialForm } from '../lib/protection-initial-form.js';
import { mapInsuranceWorkflowToSavings } from '../lib/insurance-savings-adapter.js';
import { InsuranceSavingsCard } from './InsuranceSavingsCard.jsx';
import { RelatedInsuranceProgress } from './RelatedInsuranceProgress.jsx';
import { RelatedProtectionProgress } from './RelatedProtectionProgress.jsx';
import { RelatedRefiProgress } from './RelatedRefiProgress.jsx';
import {
  availableStatusesForWorkflow,
  loadMapping,
} from '../lib/status-mapping.js';

// CoPilotPane — full-bleed pane that takes over the main content area when
// open. Layout: opportunity context (left ~320px) + the source-app
// AgentView (right, fills remaining width).
//
//   ┌─ CoPilotPane (full content area) ─────────────────────────┐
//   │ ┌─ ChevronLeft "Back to inbox" ──────────────────────────┐│
//   │ ├─ ctx (left) ────┐  ┌─ AgentView (right) ──────────────┐││
//   │ │ Opp header      │  │ Status pill · Force status ·     │││
//   │ │ Contact summary │  │ Persona · API responses          │││
//   │ │ Related opps    │  │                                  │││
//   │ └─────────────────┘  │ Source-app AgentView per type    │││
//   │                      └──────────────────────────────────┘││
//   └───────────────────────────────────────────────────────────┘
//
// Left ctx pane: mission-control-specific opportunity context that source
// AgentViews don't know about (opp ID, workflow type, age, contact,
// related opps, "view full profile" jump). Reads the canon contact subset
// documented in blinker-domain.json `contact._minimal_subset_for_copilotpane`.
// Right pane: the source-app's AgentView, branched by opportunity.type:
//   * protection / vsc → protection-portal AgentView (eager import — already
//     in the base bundle today; protection is the dominant workflow)
//   * refi             → refi-portal AgentView (React.lazy)
//   * insurance        → insurance-portal AgentView (React.lazy)
//   * anything else    → fallback "no agent view available"
//
// Each AgentView already ships its own status pill, force-status select,
// capture/origination gate, notes, and modals — do NOT duplicate any of
// those in the left ctx pane.
//
// Persona propagation: protection-portal + refi-portal AgentViews both
// initialize a local persona state from the prop once on mount. We remount
// each via `key={persona}` whenever the parent's persona changes. This
// resets in-memory state on persona flip — acceptable for a debug control;
// flagged in STATUS.md for a future patch in each portal (sync persona
// prop in a useEffect inside AgentView).
//
// Insurance-portal AgentView is wired via lazy(() => import(
// 'insurance-portal/src/views/agent')) below. Its public surface
// (insurance-portal commit 1eba115) exposes `{ workflow, updateWorkflow,
// dev, persona, personaLocked }` — workflow + updateWorkflow are owned
// by the InsuranceEmbed wrapper below as session-only state for Phase 1
// (Phase 2 fetches the workflow record from blinkerApi.insurance.get).
//
// HMR caveat (per architecture/02-integration-boundaries.md): Vite HMR
// doesn't reliably propagate edits inside `file:`-linked deps. Restart
// `npm run dev` after any source-side change in protection-portal,
// refi-portal, or insurance-portal.
//
// Contact + vehicle prefill: CoPilotPane resolves the canonical
// mission-control contact via `opportunity.contact_id` and the chosen
// vehicle via `opportunity.vehicle_id` (with a label-match fallback for
// legacy fixture opps that only carry a `vehicle` string). Both are
// threaded into each embed; protection + insurance accept them directly
// on their AgentView public surface, while refi seeds the externally-
// owned form via the RefiAgentEmbed wrapper below.
//
// DEV: Payload mirror (Phase 2 prep): the consolidated DevPanel in App.jsx
// surfaces BOTH the inbound payload that mission-control passes INTO the
// embed (opportunity / contact / vehicle) AND the live outbound state
// observed FROM the embed as the agent fills it in (form for protection
// + refi, workflow for insurance). Each embed reports its current state
// back via `onFormChange`, which writes through to ActiveWorkflowContext;
// the DevPanel reads from that context. This gives the user a live
// preview of the data object that will be routed to the Phase 2
// `blinkerApi.*` writes (refi.put, protection.put, insurance.put).

const PROTECTION_TYPES = ['protection', 'vsc'];
const REFI_TYPES = ['refi'];
const INSURANCE_TYPES = ['insurance'];

function resolveEmbedKind(type) {
  if (PROTECTION_TYPES.includes(type)) return 'protection';
  if (REFI_TYPES.includes(type)) return 'refi';
  if (INSURANCE_TYPES.includes(type)) return 'insurance';
  return null;
}

// Lazy-load source AgentViews so mission-control's initial bundle doesn't
// pull all four portals up front. Mirrors protection-portal's
// CrossSellSubFlow lazy pattern (CustomerView.jsx ~line 42).
//
// Refi: bundle AgentView + INITIAL_FORM into a single lazy chunk and
// expose them as a combined wrapper. We need INITIAL_FORM to seed
// RefiEmbed's form state with the shape refi-portal's own App.jsx
// uses (mileage: 14000, condition: 'Used', planSold: true,
// insuranceReviewed: true, vin: '', etc). Without it, downstream
// screens that destructure scalar fields throw on the first transition
// past VehicleAdd — e.g. VehicleDrive's `form.mileage.toLocaleString()`
// at refinance-v2-prototype.jsx:2124 crashes when mileage is undefined
// → blank page on Continue.
const RefiAgentEmbed = lazy(() =>
  Promise.all([
    import('refi-portal/src/views/agent'),
    import('refi-portal/src/views/customer/RefiWizard.jsx'),
  ]).then(([agentMod, wizardMod]) => ({
    default: makeRefiAgentEmbed(agentMod.AgentView, wizardMod.INITIAL_FORM),
  })),
);

// Wave 35 v3.0.15 (ADR 25 D4) — refi wizard step-key → human label, used
// for the `summary_text` on `step_change` activities emitted by the refi
// step write-through. Kept in sync with the REFI_STEP_LABEL map in
// RelatedRefiProgress.jsx (intentional cross-file duplication — the step
// KEYS are the contract, the LABELS are display-only; refi-portal exports
// no step-label map). Update both when a wizard step is added.
const REFI_STEP_LABEL = {
  vehicle_add: 'Add vehicle',
  vehicle_drive: 'Driving habits',
  s1_ownership: 'Ownership',
  s1_auto_loan: 'Auto loan',
  s1_credit: 'Credit',
  s1_applicant: 'Applicant',
  s1_housing: 'Housing',
  s1_employment: 'Employment',
  s1_co_app_decision: 'Co-applicant',
  s1_co_app_contact: 'Co-applicant contact',
  s1_co_app_employment: 'Co-applicant employment',
  s1_identity_consent: 'Identity & consent',
  decision_engine: 'Prequalification',
  stage2_result: 'Offers',
};

function makeRefiAgentEmbed(AgentView, INITIAL_FORM) {
  // Wave 18-fu5 — helper to derive the refi step index from
  // opportunity.status. The screen-key string from refiStepFromStatus is
  // converted to a numeric index via getSequence().indexOf(). getSequence
  // depends on form.creditBand + hasCoApplicant; for the status-resume
  // path both are read from the seeded form (or default to false/unknown
  // for the fallback). Falls back to 0 (vehicle_add) when the key is not
  // found in the sequence.
  function refiIndexFromStatus(status, form) {
    if (!status) return 0;
    const screenKey = refiStepFromStatus(status, 'vehicle_add');
    const seq = getSequence(form || {}, (form || {}).hasCoApplicant === true);
    const idx = seq.indexOf(screenKey);
    return idx >= 0 ? idx : 0;
  }

  return function RefiAgentEmbedInner({ persona, orgId, contact, vehicle, dev, onVehicleCommitted, opportunity, updateOpportunity }) {
    // Wave 14 follow-up: the refi wizard form + step index are LIFTED to
    // ActiveWorkflowContext. Refi's AgentView is purely controlled — it
    // reads `form` / `update` / `stepIdx` / `setStepIdx` from props — so
    // moving the source of truth to context lets RefiDevControls
    // (mounted in mission-control's consolidated DevPanel via App.jsx)
    // also drive the same form via formState / wizardNav. The DevPanel's
    // "DEV · Payload → live form" block reads directly from refiForm
    // (Option (b) — the embedder's own embedState mirror is no longer
    // populated by the refi path).
    //
    // Seed flow:
    //   1. App.jsx owns useState(refiForm = null).
    //   2. This effect runs whenever refiForm becomes null (on mount, or
    //      after a Reset). It computes the seed via buildRefiInitialForm
    //      and writes it to context, AND registers resetRefiForm so the
    //      DevControls "Reset prototype" button can re-seed via the same
    //      code path. The reset closes over the lazy-loaded INITIAL_FORM
    //      that App.jsx doesn't have direct access to.
    //   3. Until refiForm is non-null, AgentView gets a {} placeholder
    //      to avoid throwing on `form.mileage.toLocaleString()`-style
    //      reads in downstream screens. The seed effect runs synchronously
    //      after the first commit so the placeholder is only visible for
    //      one render.
    //
    // Per-mount key: the parent EmbedSlot supplies
    // `key={`${persona}:${opportunity.id}`}`, so this wrapper remounts on
    // opportunity change. The seed effect re-fires because refiForm got
    // reset to null in setActive(null)'s cleanup at the previous opp's
    // unmount (App.jsx wires that).
    //
    // Phase 2: replace this seed flow with a real workflow record fetch
    // (`await blinkerApi.refi.get(opportunity_id)`) so the form persists
    // across pane reopens.
    const {
      refiForm,
      setRefiForm,
      refiStepIdx,
      setRefiStepIdx,
      setResetRefiForm,
    } = useActiveWorkflow();

    // Hold the latest form in a ref so the status re-seed effect below
    // can read it without listing refiForm as a dep (which would cause
    // it to fire on every keystroke, not just status changes). Mirrors
    // the Wave 17 P1-fu3b ref pattern used for vehicle wire-backs.
    const refiFormRef = useRef(refiForm);
    useEffect(() => {
      refiFormRef.current = refiForm;
    });

    useEffect(() => {
      if (refiForm === null) {
        const seededForm = buildRefiInitialForm(INITIAL_FORM, orgId, contact, vehicle);
        setRefiForm(seededForm);
        // Wave 18-fu5 — seed the step index from opportunity.status so
        // CoPilot opens at the resume point (e.g. 'Self Reported Credit'
        // → s1_credit). refiStepFromStatus returns a screen-key string;
        // refiIndexFromStatus converts it to a numeric index via
        // getSequence(). Falls back to 0 (vehicle_add) for unmapped statuses.
        setRefiStepIdx(refiIndexFromStatus(opportunity?.status, seededForm));
      }
      // We deliberately depend on refiForm so a "Reset prototype" click
      // (which sets refiForm to null) re-fires this effect and re-seeds.
      // orgId / contact / vehicle are captured in the closure; they're
      // stable for the lifetime of this wrapper instance because the
      // parent supplies a per-opportunity key.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refiForm]);

    // Wave 18-fu5 — re-seed refiStepIdx when opportunity.status changes
    // after initial mount (e.g. agent uses force-status picker or a
    // status_change activity arrives). Mirrors ProtectionEmbed's
    // [opportunity?.status] effect. Guarded by refiForm non-null so we
    // don't race with the seed effect above on mount (that effect handles
    // the initial step; this is only for post-mount status changes).
    //
    // Dep is the primitive string opportunity?.status — intentionally
    // does NOT depend on the full opportunity object so the Wave 17
    // P1-fu3b ref-stability invariants (no churning deps that re-fire
    // wire-back observer chains) are preserved.
    useEffect(() => {
      if (!refiFormRef.current) return;
      setRefiStepIdx(refiIndexFromStatus(opportunity?.status, refiFormRef.current));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [opportunity?.status]);

    // Register resetRefiForm with closure over the lazy-loaded
    // INITIAL_FORM + the current orgId/contact/vehicle. App.jsx's
    // resetAll inside the RefiDevControls formState calls this.
    useEffect(() => {
      const fn = () => {
        setRefiForm(buildRefiInitialForm(INITIAL_FORM, orgId, contact, vehicle));
        setRefiStepIdx(0);
      };
      setResetRefiForm(() => fn);
      return () => setResetRefiForm(() => null);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orgId, contact?.id, vehicle?.id]);

    // Wave 35 v3.0.15 (ADR 25 D4) — refi step write-through.
    //
    // Refi wrote NO activity rows until this effect — `refiStepIdx` was
    // in-memory React state only, evaporating on opp-switch / reopen and
    // invisible to RelatedRefiProgress's related-opp mount. This is the
    // FIRST refi activity-write path. Modeled exactly on the Wave 34
    // protection step write-through in ProtectionEmbed.
    //
    // On a FORWARD step transition i → j (j > i) for the active refi opp:
    //   1. Append one `step_change` activity per newly-completed step in
    //      the span [i, j) — a normal Continue completes one step; a
    //      force-status / resume jump completes the whole span. Step keys
    //      are resolved from `getSequence(refiForm, hasCoApp)` so the
    //      conditional co-app ordering matches the running wizard.
    //   2. Persist `refi_progress` on the opp record (additive field;
    //      mirrors `protection_progress`) so a reopened or related-opp
    //      timeline shows the furthest point without replaying every
    //      activity.
    // It does NOT touch `opportunity.status` — refi status stays the
    // display name; step progress lives in `refi_progress` +
    // `step_change` activities only.
    //
    // Loop-safety: `previousStepRef` guards exactly like the protection
    // write-through. After updateOpportunity writes `refi_progress` and
    // CoPilotPane re-renders, this effect would re-fire — the
    // `if (j === previousStepRef.current) return;` guard breaks the loop
    // on the second fire. We also ignore BACKWARD moves (j <= i) so a
    // re-seed / resume-to-earlier-step doesn't emit rows.
    const previousStepRef = useRef(
      typeof refiStepIdx === 'number' ? refiStepIdx : 0,
    );
    useEffect(() => {
      const j = typeof refiStepIdx === 'number' ? refiStepIdx : 0;
      const i = previousStepRef.current;
      // Ref guard — breaks the re-fire loop after updateOpportunity propagates.
      if (j === i) return;
      previousStepRef.current = j;
      // Only forward transitions complete steps. Backward moves (resume to
      // an earlier step, re-seed) update the ref but emit nothing.
      if (j <= i) return;
      if (!opportunity?.id || !opportunity?.contact_id) return;

      // Resolve step KEYS from the live form's getSequence so the
      // conditional co-app screens are indexed exactly as the running
      // wizard has them. `hasCoApp` is derived from `form.hasCoApplicant`,
      // mirroring refiIndexFromStatus + refi-portal's AgentView.
      let stepList;
      try {
        const f = refiFormRef.current || {};
        stepList = getSequence(f, f.hasCoApplicant === true);
      } catch {
        stepList = [];
      }

      // One step_change activity per newly-completed step in span [i, j).
      for (let k = i; k < j; k++) {
        const completedKey = stepList[k] || null;
        const toKey = stepList[k + 1] || null;
        const label = REFI_STEP_LABEL[completedKey] || completedKey || `step ${k}`;
        try {
          activitiesApi.create({
            contact_id: opportunity.contact_id,
            opportunity_id: opportunity.id,
            type: 'step_change',
            // v3.0.15 (ADR 27 D7) — the actor is `agent`: in Phase 1 the
            // agent drives the entire refi wizard inside the CoPilot
            // embed. The timeline's actor badge reads this `source`. A
            // genuine consumer-driven advance (Phase-2 back-channel)
            // will stamp `source: 'consumer'`.
            source: 'agent',
            payload: {
              from_step: completedKey,
              to_step: toKey,
              completed_step: completedKey,
              step_idx: k,
              workflow_type: 'refi',
            },
            summary_text: `Refi step: ${label}`,
          });
        } catch (err) {
          console.warn('[mc] activities.create(step_change) failed:', err);
        }
      }

      // Persist refi_progress on the opp record (additive — does NOT
      // touch opportunity.status). Lets reopen + related-opp timelines
      // show the furthest point without replaying every activity.
      if (typeof updateOpportunity === 'function') {
        const furthestKey = stepList[j] || stepList[stepList.length - 1] || null;
        updateOpportunity(opportunity.id, {
          refi_progress: {
            furthest_step_idx: j,
            furthest_step_key: furthestKey,
            updated_at: new Date().toISOString(),
          },
        });
      }

      const fromKeyTele = stepList[i] || null;
      const toKeyTele = stepList[j] || null;
      track('mc.copilot.refi_progress.step_persisted', {
        opp_id: opportunity.id,
        from_step: fromKeyTele,
        to_step: toKeyTele,
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refiStepIdx, opportunity?.id, opportunity?.contact_id]);

    const update = (patch) =>
      setRefiForm((prev) => ({
        ...(prev || {}),
        ...(typeof patch === 'function' ? patch(prev || {}) : patch),
      }));

    // Wave 14: `dev` is now the lifted refi dev slice from
    // ActiveWorkflowContext, threaded in by the parent EmbedSlot. When
    // RefiDevControls (mounted in mission-control's consolidated DevPanel)
    // mutates devOptions, that flows here and into refi-portal's AgentView,
    // where RefiWizard reads forcePartner / forceResult / coAppOverride
    // off the prop. Defaults to {} when no DevControls have been mounted.
    const devSafe = dev || {};
    // Render with an empty form for the one tick before the seed effect
    // commits so AgentView's controlled inputs have something to read.
    const safeForm = refiForm || {};
    // Thread the canonical mission-control contact through to AgentView
    // so its CaptureLinkForm seeds with the real consumer's email +
    // phone (per refi-portal/AgentView Phase 2 prefill contract). Prior
    // to this, refi was silently falling back to the Jordan/512 mock
    // because the wrapper only forwarded form/update/stepIdx — even
    // though the buildRefiInitialForm helper had populated firstName /
    // lastName / phone / email correctly on the wizard form, those
    // never reached the gate before the wizard mounts.
    return (
      <AgentView
        persona={persona}
        personaLocked={false}
        form={safeForm}
        update={update}
        stepIdx={refiStepIdx}
        setStepIdx={setRefiStepIdx}
        dev={devSafe}
        contact={contact}
        onVehicleCommitted={onVehicleCommitted}
      />
    );
  };
}

const InsuranceAgentView = lazy(() =>
  import('insurance-portal/src/views/agent').then((m) => ({ default: m.AgentView })),
);

export function CoPilotPane({
  opportunity,
  persona,
  contacts,
  opportunities,
  // Wave 16 F2-fu11 — session-data appenders/patchers used to wire vehicle
  // commits from the embedded protection wizard back into mc state. All
  // optional so legacy callers that don't thread them in fall back to a
  // no-op (the embed still works, the left pane just doesn't update).
  // updateContactVehicle is the Step 2 (VehicleDrive) follow-up: when
  // the wizard re-fires onVehicleCommitted with mileage/ownership/
  // purchase_date/market_value attached, the handler patches the
  // already-appended vehicle in place rather than appending a duplicate.
  //
  // Wave 17 P1-fu3 — `dedupAndUpsertVehicle` is the new unified helper
  // that owns the full id/VIN/YMMT match-or-append decision tree.
  // Preferred over the lower-level appendVehicleToContact +
  // updateContactVehicle pair when handling a wire-back commit, because
  // it dedups across all three identity dimensions (a wire-back can
  // arrive with a different stand-in id than the existing record but
  // still represent the same physical vehicle — see helper comment in
  // session-data.js for the cross-sell race that motivated this).
  // Lower-level appender/patcher are still threaded for legacy callers
  // and for explicit-id-targeted patches elsewhere in the shell.
  appendVehicleToContact,
  updateContactVehicle,
  dedupAndUpsertVehicle,
  updateOpportunity,
  onClose,
  onOpenContactProfile,
  // Wave 31 v3.0.11 (ADR 21 D3a / D4) — opening a different opportunity
  // in CoPilot. Two callers today:
  //   - Find Coverage CTA on InsuranceSavingsCard → spawns a protection
  //     opp + switches to it.
  //   - "Open insurance CoPilot →" link inside RelatedInsuranceProgress
  //     in the left rail → switches to the related insurance opp.
  // Wired by the host (AgentInbox) to its `openCoPilot(oppId)` helper.
  // When absent the new affordances no-op gracefully so older callers
  // that don't thread the prop still work.
  onOpenOpportunity,
  // Wave 28d — manager-overlay handlers. Optional; when absent, the
  // left rail renders identically to the agent-persona path. When
  // present AND persona === 'manager', the rail gains a reassign
  // dropdown above the Contact block and a "+ Note for agent" button
  // below the Vehicle block.
  //   { onReassign(oppId, agentId), onNoteForAgent(oppId, agentId, body) }
  managerOverlay,
}) {
  const contact = (contacts && contacts[opportunity.contact_id]) || null;
  const embedKind = resolveEmbedKind(opportunity.type);
  const orgId = contact?.org_id;
  const {
    setActive,
    setProtectionForm,
    setProtectionStepIdx,
    setRefiForm,
    setRefiStepIdx,
    setInsuranceWorkflow,
    // Wave 31b-fu5 — read the live insurance workflow so handleFindCoverageSpawn
    // can capture the savings snapshot at spawn time. We hold it in a ref
    // (insuranceWorkflowRef) so the useCallback identity stays stable — the
    // handler reads ref.current inside the callback body rather than closing
    // over the value, which would require adding insuranceWorkflow to the
    // callback deps and cause unnecessary re-binding on every workflow update.
    insuranceWorkflow: insuranceWorkflowForRef,
  } = useActiveWorkflow();

  // Keep the ref in sync with the latest context value so the callback below
  // always reads the current workflow without being listed as a dep.
  const insuranceWorkflowRef = useRef(insuranceWorkflowForRef);
  useEffect(() => {
    insuranceWorkflowRef.current = insuranceWorkflowForRef;
  });

  // Resolve household members from contact.household_member_ids against the
  // session contacts map so each embed sees full {ct_*} records on
  // `contact.household_members` rather than bare ID strings. Solo contacts
  // (empty/missing household_member_ids) pass through unchanged — no
  // `household_members: []` key — to keep the common-case payload identical
  // to pre-resolution. Broken refs are filtered out with `.filter(Boolean)`.
  // Unblocks protection-portal's co-applicant confirmation prompt during
  // the refi cross-sell.
  const contactWithMembers = useMemo(() => {
    if (!contact) return null;
    const memberIds = contact.household_member_ids;
    if (!memberIds || memberIds.length === 0) return contact;
    return {
      ...contact,
      household_members: memberIds.map((id) => contacts[id]).filter(Boolean),
    };
  }, [contact, contacts]);

  // Resolve the chosen vehicle from the contact's vehicles array.
  // Priority: vehicle_id exact match → vehicle-label match via canonical
  // formatVehicleLabel → sole vehicle on the contact (unambiguous) → null.
  // The sole-vehicle fallback only fires when exactly one vehicle is on
  // file; multi-vehicle contacts without an opp.vehicle_id stay null so
  // we don't silently render the wrong one.
  const vehicle = useMemo(() => {
    const vehicles = contactWithMembers?.vehicles;
    if (!Array.isArray(vehicles) || vehicles.length === 0) return null;
    if (opportunity.vehicle_id) {
      const hit = vehicles.find((v) => v.id === opportunity.vehicle_id);
      if (hit) return hit;
    }
    if (opportunity.vehicle) {
      const hit = vehicles.find((v) => formatVehicleLabel(v) === opportunity.vehicle);
      if (hit) return hit;
    }
    if (vehicles.length === 1) return vehicles[0];
    return null;
  }, [contactWithMembers, opportunity.vehicle_id, opportunity.vehicle]);

  const relatedOpps = useMemo(
    () =>
      (opportunities || []).filter(
        (o) => o.contact_id === opportunity.contact_id && o.id !== opportunity.id,
      ),
    [opportunities, opportunity.contact_id, opportunity.id],
  );

  // Wave 31 v3.0.11 (ADR 21 D3a) — Find Coverage spawn handler.
  //
  // Mints a new protection opportunity for the same contact + vehicle,
  // prefilled with vehicle YMMT/VIN/mileage + driving data so the
  // protection embed can resume at step 3 (vehicle_use) without re-asking
  // the customer to repeat themselves. The spawn writes through
  // `blinkerApi.opportunities.create()` which delegates to the writer
  // mc registered at boot (`session-data.appendOpportunity`). After the
  // record persists, we switch the active CoPilot to the new opp via
  // the host's `onOpenOpportunity` callback.
  //
  // Only fires for insurance opps — guarded at the InsuranceEmbed call
  // site, but the handler itself is type-agnostic so future cross-sell
  // arrows can reuse it.
  //
  // The `_prefill` block on the spawned opp is the canonical hook the
  // protection embed reads (see protection-initial-form.js's 4th-arg
  // prefill overlay). Stored on the opp record itself (not just passed
  // through React props) so reopening the CoPilot later re-seeds
  // identically.
  const handleFindCoverageSpawn = useCallback(() => {
    if (opportunity.type !== 'insurance') return;
    if (!opportunity.contact_id) return;
    const v = vehicle || {};
    // Wave 31b-fu5 — read the latest insurance workflow from the ref (not
    // from a closure over a state value) so we don't need to list
    // insuranceWorkflow as a useCallback dep. At spawn time the insurance
    // opp is still the active opp, so the ref holds the live workflow.
    const insuranceSavings = mapInsuranceWorkflowToSavings(insuranceWorkflowRef.current);
    const prefill = {
      mileage: v.mileage ?? null,
      annual_miles_estimate: v.annual_mileage_estimate ?? v.annual_miles_estimate ?? null,
      condition: v.condition ?? null,
      purchase_date: v.purchase_date ?? null,
      year: v.year ?? null,
      make: v.make ?? null,
      model: v.model ?? null,
      trim: v.trim ?? null,
      vin: v.vin ?? null,
      // null when quote hasn't run yet (adapter returns null pre-quote);
      // { monthlySavingsCents, captureCarrier, newCarrier, status } otherwise.
      insurance_savings: insuranceSavings,
    };
    // Build the spawn payload. status 'vehicle_use' is the protection
    // step key we want the embed to land at — ProtectionEmbed's step
    // seeding logic falls back to step-key matching for spawned opps
    // (see the seed effect inside ProtectionEmbed below).
    const persisted = opportunitiesApi.create({
      type: 'protection',
      contact_id: opportunity.contact_id,
      contact_name: opportunity.contact_name,
      household: opportunity.household,
      vehicle_id: opportunity.vehicle_id || v.id || null,
      vehicle: opportunity.vehicle, // human label, mirrors the existing opp
      status: 'vehicle_use',
      owner: opportunity.owner,
      owner_id: opportunity.owner_id,
      next_action: 'Cross-sell from insurance — resume at vehicle use',
      _prefill: prefill,
      _spawned_from: {
        opportunity_id: opportunity.id,
        reason: 'insurance.find_coverage',
      },
    });
    track('insurance.copilot.find_coverage.opp_spawned', {
      insurance_opp_id: opportunity.id,
      protection_opp_id: persisted.id,
      prefilled_step: 'vehicle_use',
    });
    // Switch CoPilot to the new opp. AgentInbox's openCoPilot owns the
    // active-workflow context lifecycle (the existing per-opp key on
    // EmbedSlot will remount the wrappers with the new opp record).
    if (onOpenOpportunity) {
      onOpenOpportunity(persisted.id);
    }
  }, [opportunity, vehicle, onOpenOpportunity]);

  // Wave 14-fu — derive `availableStatuses` per workflow from the
  // operator's local status mapping (`mc.status-mapping.v1` via
  // loadMapping()) and pass into both protection-portal AgentView and
  // insurance-portal AgentView. Each portal accepts the prop on its
  // public surface (protection: Wave 13-fu-1; insurance: Wave 14-fu)
  // and threads it through to the FORCE STATUS picker. Empty
  // platform_status rows are filtered upstream by
  // availableStatusesForWorkflow; an empty result OR a missing mapping
  // becomes `undefined`, which the AgentViews interpret as "fall back
  // to canon" (today's behavior, fully backwards compatible).
  //
  // Memoized once per pane mount — the mapping lives in localStorage
  // and only changes via the SuperHome StatusMappingEditor; the editor
  // sits behind a separate top-level route, so the operator can't
  // simultaneously edit the mapping and watch a CoPilot pane. If the
  // pane reopens after an edit, the new mapping is read on the next
  // mount.
  const mapping = useMemo(() => loadMapping(), []);
  const protectionAvailableStatuses = useMemo(
    () => availableStatusesForWorkflow(mapping, 'vsc'),
    [mapping],
  );
  const insuranceAvailableStatuses = useMemo(
    () => availableStatusesForWorkflow(mapping, 'insurance'),
    [mapping],
  );

  // Publish inbound payload (kind / opportunity / contact / vehicle) to
  // ActiveWorkflowContext on mount + whenever any of those change. The
  // DevPanel in App.jsx reads from this context to render the payload
  // mirror + drive forceOpen on per-workflow placeholder sections.
  // embedState mirrors the protection-portal's onFormChange callback
  // ONLY (refi + insurance now publish their live state via dedicated
  // refiForm / insuranceWorkflow context fields per the Wave 14 follow-
  // up — the DEV · Payload "live form/workflow" block reads those
  // directly).
  //
  // Wave 16 F2-fu11 — split out from the per-kind lifted-state cleanup
  // (see effect immediately below). Previously this effect's cleanup
  // also nulled protectionForm/refiForm/insuranceWorkflow + reset
  // stepIdx → because the deps include `vehicle` (and `opportunity`),
  // any in-pane mutation that changes either prop ref (e.g.
  // appendVehicleToContact mid-wizard, or updateOpportunity binding
  // vehicle_id) ran the cleanup as a dep-change cleanup, which kicked
  // protection's wizard back to Step 0. Splitting the cleanup off so
  // it only fires on actual unmount fixes that without losing the
  // payload-mirror sync the comment above describes.
  useEffect(() => {
    setActive({
      kind: embedKind,
      opportunityId: opportunity.id,
      opportunity,
      contact: contactWithMembers,
      vehicle,
      embedState: null,
    });
    // setActive is a stable setState updater. We intentionally re-fire on
    // any inbound payload field change so the DevPanel mirror stays in
    // sync (e.g. when contact.vehicles is mutated by appendVehicle and
    // the resolved vehicle re-keys).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedKind, opportunity, contactWithMembers, vehicle]);

  // Wave 16 F2-fu11 — separate cleanup-only effect for the per-kind
  // lifted state. Keyed on opportunity.id (so switching to a different
  // opp resets cleanly) AND fires on unmount (so closing the pane
  // resets too). Critically, this does NOT depend on `vehicle` or the
  // full `opportunity` object ref — both change as the wizard mutates
  // session state from inside the embed, and re-running the form/step
  // reset on those changes was the Bug 1 root cause: protection's seed
  // effect would re-seed protectionForm and reset protectionStepIdx to
  // 0 every time the wizard committed a vehicle, kicking the user
  // back to Step 1.
  //
  // Also publish active=null on unmount so the DevPanel collapses to
  // its idle state — kept here rather than in the payload effect so
  // the same lifecycle gate (real unmount + opp.id swap) governs both.
  useEffect(() => {
    return () => {
      setActive(null);
      setProtectionForm(null);
      setProtectionStepIdx(0);
      setRefiForm(null);
      setRefiStepIdx(0);
      setInsuranceWorkflow(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunity.id]);

  // Embed reports its current form/workflow on every change. Wave 14
  // follow-up: protection now also lifts its form to context
  // (protectionForm), so this callback is redundant for all three
  // kinds. Kept as a no-op for backward compat with AgentView's prop
  // signature — AgentView's useEffect on `[form, onFormChange]` would
  // re-fire on every form mutation, and writing through to embedState
  // here would just duplicate what protectionForm already mirrors.
  // Threading a stable noop avoids that re-fire churn while leaving
  // the prop wired in case a future embedder needs it.
  const onEmbedFormChange = useCallback(() => {}, []);

  // Wave 16 F2-fu11 / Wave 17 P1-fu3 / Wave 17 P1-fu3b — when an
  // embedded wizard commits a canonical vehicle record, push it back up
  // to mc's session contacts so the left "Vehicle" pane reflects the
  // real workflow state.
  //
  // Match-or-append decision tree is owned by the
  // `dedupAndUpsertVehicle` session-data helper. Match priority:
  // id → VIN → YMMT → append. Existing record's id is preserved on
  // match so downstream `opportunity.vehicle_id` refs stay stable.
  // Inbound non-empty fields are merged onto the existing record.
  //
  // Wave 17 P1-fu3b — STABLE HANDLER VIA REFS.
  //
  // Prior implementation listed `[opportunity, contacts, appendVehicleToContact,
  // updateContactVehicle, dedupAndUpsertVehicle, updateOpportunity]` as
  // useCallback deps. That's the loop closer: every successful wire-back
  // call mutates either `opportunity` (via updateOpportunity bumping
  // updated_at) or `contacts` (via dedupAndUpsertVehicle's setContacts),
  // BOTH of which churn the handler ref. The handler ref churn cascades
  // through EmbedSlot's useCallback'd shims (their deps include
  // onEmbedVehicleCommitted) → the `onVehicleCommitted` prop on
  // protection-portal's AgentView gets a new ref → AgentView's wizard
  // observer (`useEffect([..., onVehicleCommitted])`) re-fires with the
  // SAME `form.vehicle` payload → handler runs again → cycle.
  //
  // The previous P1-fu3a no-op short-circuit attempted to break the
  // cycle at the SESSION-STATE layer (refusing to write when nothing
  // changed). That fails when the helper's match logic misses
  // (matchedBy=null, oppWouldChange=true) — which is exactly the runtime
  // failure mode the user observed (19,257 events with deduped=false /
  // matched_by=null): every fire wrote through updateOpportunity, which
  // re-bumped opportunity.updated_at, which re-churned the handler ref,
  // which re-fired the observer.
  //
  // The fix: hold latest opportunity / contacts / helpers in refs that
  // are updated on each render via a layout-free useEffect. The handler
  // is built ONCE with empty deps (`useCallback(..., [])`), reads from
  // refs at call time, and therefore has a STABLE ref for the lifetime
  // of CoPilotPane. EmbedSlot's shims become stable, the
  // `onVehicleCommitted` prop becomes stable, and the wizard observer's
  // useEffect deps don't churn on parent re-render. The observer can
  // still fire freely on real `form.vehicle` changes — the only path
  // out of the cycle was making it NOT fire on parent-induced re-renders
  // that don't actually represent new wizard state.
  //
  // The helper's no-op short-circuit (P1-fu3a) is retained as defense
  // in depth: if the observer fires twice for one form change (e.g.
  // React 19 strict-mode double-invoke or any future dep churn we miss),
  // the second fire produces zero state writes.
  //
  // Phase 2: replace the helper's local mutations with
  // `await blinkerApi.contacts.upsertVehicle(...)` +
  // `blinkerApi.opportunities.patch(...)`. Ref pattern stays.
  const opportunityRef = useRef(opportunity);
  const contactsRef = useRef(contacts);
  const dedupAndUpsertVehicleRef = useRef(dedupAndUpsertVehicle);
  const appendVehicleToContactRef = useRef(appendVehicleToContact);
  const updateContactVehicleRef = useRef(updateContactVehicle);
  const updateOpportunityRef = useRef(updateOpportunity);
  useEffect(() => {
    opportunityRef.current = opportunity;
    contactsRef.current = contacts;
    dedupAndUpsertVehicleRef.current = dedupAndUpsertVehicle;
    appendVehicleToContactRef.current = appendVehicleToContact;
    updateContactVehicleRef.current = updateContactVehicle;
    updateOpportunityRef.current = updateOpportunity;
  });

  const handleEmbedVehicleCommitted = useCallback((vehicle, workflowType) => {
    const opp = opportunityRef.current;
    if (!vehicle || !opp) return;
    const contactId = opp.contact_id;
    const dedupAndUpsert = dedupAndUpsertVehicleRef.current;
    const appendVehicle = appendVehicleToContactRef.current;
    const patchVehicle = updateContactVehicleRef.current;
    const patchOpportunity = updateOpportunityRef.current;
    const contactsSnapshot = contactsRef.current;

    let vehicleId = vehicle.id || null;
    let matched = false;
    let matchedBy = null;
    let helperNoop = false;

    if (typeof dedupAndUpsert === 'function') {
      const result = dedupAndUpsert(contactId, vehicle);
      vehicleId = result.vehicleId || vehicle.id || null;
      matched = result.matched;
      matchedBy = result.matchedBy;
      helperNoop = !!result.noop;
    } else {
      // Backwards-compat fallback: legacy id-only dedup via the
      // lower-level helpers. Mirrors F2-fu11a's branch logic.
      const existingContact =
        (contactsSnapshot && contactsSnapshot[contactId]) || null;
      const existingVehicles = existingContact?.vehicles || [];
      const existing = existingVehicles.find((v) => v.id === vehicle.id);
      vehicleId = existing?.id || vehicle.id;
      matched = !!existing;
      matchedBy = existing ? 'id' : null;
      if (!existing && typeof appendVehicle === 'function') {
        appendVehicle(contactId, vehicle);
      } else if (existing && typeof patchVehicle === 'function') {
        const patch = {};
        const extendable = [
          'mileage',
          'ownership',
          'purchase_date',
          'market_value',
          'annual_mileage_estimate',
          'condition',
        ];
        for (const k of extendable) {
          if (vehicle[k] !== undefined && vehicle[k] !== null) {
            patch[k] = vehicle[k];
          }
        }
        if (Object.keys(patch).length > 0) {
          patchVehicle(contactId, vehicleId, patch);
        }
      }
    }

    // Compute would-be opp patch up front so the noop short-circuit can
    // also gate telemetry + updateOpportunity when the merged vehicle is
    // field-equal AND the opp is already correctly bound. With the
    // ref-based handler the cycle is closed at the prop-stability
    // layer; this short-circuit is defense in depth for any residual
    // observer re-fire we miss.
    const label = formatVehicleLabel(vehicle);
    const oppPatch = {};
    if (opp.vehicle_id !== vehicleId) {
      oppPatch.vehicle_id = vehicleId;
    }
    if (label && label !== opp.vehicle) {
      oppPatch.vehicle = label;
    }
    const oppWouldChange = Object.keys(oppPatch).length > 0;

    if (helperNoop && !oppWouldChange) {
      // Idempotent re-fire — nothing to do. Skip telemetry too so
      // PostHog doesn't get spammed with N copies of the same commit
      // event when an upstream observer's deps churn.
      return;
    }

    if (typeof patchOpportunity === 'function' && oppWouldChange) {
      patchOpportunity(opp.id, oppPatch);
    }

    track('mission_control.copilot.vehicle_committed_from_embed', {
      opp_id: opp.id,
      contact_id: contactId,
      // Wave 16 F2-fu12 — which embed fired (protection / refi /
      // insurance). Passed by each mount site's typed shim below.
      workflow_type: workflowType || opp.type || null,
      deduped: matched,
      // Wave 17 P1-fu3 — surface which dimension matched (id / vin /
      // ymmt) so PostHog can split out the cross-sell VIN-merge path
      // from the wizard step 1/2 same-id re-fire path.
      matched_by: matchedBy,
      // Wave 17 P1-fu3a — noop=true means the merged record was
      // field-equal to the existing one (re-fire idempotency).
      noop: helperNoop,
      had_vin: !!vehicle.vin,
      source: vehicle.source || null,
      // Wave 16 F2-fu11 extension — surface which Step 2 fields
      // arrived in the payload so we can see in PostHog whether the
      // Step 2 wire-back is firing as expected per opp.
      had_mileage: vehicle.mileage != null,
      had_ownership: vehicle.ownership != null,
      had_purchase_date: vehicle.purchase_date != null,
      had_market_value: vehicle.market_value != null,
    });
    // Empty deps — handler is intentionally stable for the lifetime of
    // the pane. Latest opportunity / contacts / helpers are read from
    // refs above. See the long-form comment for why.
  }, []);

  // Fire copilot_opened on each new opportunity selection; copilot_closed on unmount.
  useEffect(() => {
    track('mission_control.copilot.copilot_opened', {
      opp_id: opportunity.id,
      workflow_type: opportunity.type,
    });
    return () => {
      track('mission_control.copilot.copilot_closed', {
        opp_id: opportunity.id,
        workflow_type: opportunity.type,
      });
    };
  }, [opportunity.id, opportunity.type]);

  // Re-fire on every persona change so the audit trail captures the propagation.
  useEffect(() => {
    track('mission_control.copilot.copilot_persona_propagated', {
      opp_id: opportunity.id,
      persona,
    });
  }, [persona, opportunity.id]);

  // embed_mounted fires once per opportunity-mount of an actual AgentView.
  // embed_unavailable fires when the type has no wired source yet
  // (e.g. payments, null, or any unhandled future type).
  useEffect(() => {
    if (embedKind) {
      track('mission_control.copilot.embed_mounted', {
        embed_kind: embedKind,
        opportunity_type: opportunity.type,
        opportunity_id: opportunity.id,
      });
    } else {
      track('mission_control.copilot.embed_unavailable', {
        opportunity_type: opportunity.type,
        opportunity_id: opportunity.id,
      });
    }
  }, [embedKind, opportunity.id, opportunity.type]);

  // Wave 14-fu — emit one event per CoPilot mount documenting where
  // the embed's FORCE STATUS picker list came from (operator mapping
  // vs canon fallback). Lets us see in PostHog whether organizations
  // are actually using the StatusMappingEditor or sticking with the
  // canon-default list. Per-kind so the analytics rollup can split
  // protection vs insurance adoption. Keyed off opportunity.id so
  // re-mounts on opp switch refire — that's intentional, the mapping
  // is operator-global but the pairing with a specific embed is what
  // we care about counting.
  useEffect(() => {
    if (embedKind === 'protection') {
      track('mission_control.copilot.available_statuses_threaded', {
        workflow: 'vsc',
        source:
          Array.isArray(protectionAvailableStatuses) &&
          protectionAvailableStatuses.length > 0
            ? 'mapping'
            : 'canon',
        count: protectionAvailableStatuses?.length ?? null,
        opportunity_id: opportunity.id,
      });
    }
    if (embedKind === 'insurance') {
      track('mission_control.copilot.available_statuses_threaded', {
        workflow: 'insurance',
        source:
          Array.isArray(insuranceAvailableStatuses) &&
          insuranceAvailableStatuses.length > 0
            ? 'mapping'
            : 'canon',
        count: insuranceAvailableStatuses?.length ?? null,
        opportunity_id: opportunity.id,
      });
    }
    // protectionAvailableStatuses + insuranceAvailableStatuses are
    // memoized on `mapping` (which is itself memoized once per mount),
    // so they're stable for the lifetime of this pane — depending on
    // them is a no-op but keeps the lint rule happy.
  }, [
    embedKind,
    opportunity.id,
    protectionAvailableStatuses,
    insuranceAvailableStatuses,
  ]);

  function handleBack() {
    track('mission_control.pane.dismissed', {
      kind: 'copilot',
      opportunity_id: opportunity.id,
    });
    onClose();
  }

  return (
    <section className="flex-1 flex flex-col min-w-0 bg-white">
      <BackToInboxBar onBack={handleBack} />
      <div className="flex-1 flex min-h-0 min-w-0">
        <OpportunityContextPane
          opportunity={opportunity}
          contact={contactWithMembers}
          contacts={contacts}
          vehicle={vehicle}
          relatedOpps={relatedOpps}
          onOpenContactProfile={onOpenContactProfile}
          onOpenOpportunity={onOpenOpportunity}
          persona={persona}
          managerOverlay={managerOverlay}
        />
        <div className="flex-1 min-w-0 overflow-auto bg-slate-50 p-4">
          <EmbedSlot
            opportunity={opportunity}
            embedKind={embedKind}
            persona={persona}
            orgId={orgId}
            contact={contactWithMembers}
            contacts={contacts}
            relatedOpps={relatedOpps}
            vehicle={vehicle}
            onFormChange={onEmbedFormChange}
            onEmbedVehicleCommitted={handleEmbedVehicleCommitted}
            protectionAvailableStatuses={protectionAvailableStatuses}
            insuranceAvailableStatuses={insuranceAvailableStatuses}
            onFindCoverageSpawn={handleFindCoverageSpawn}
            updateOpportunity={updateOpportunity}
          />
        </div>
      </div>
    </section>
  );
}

function BackToInboxBar({ onBack }) {
  return (
    <div className="px-4 py-2 border-b border-slate-200 bg-white flex items-center">
      <button
        onClick={onBack}
        className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-100"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        Back to inbox
      </button>
    </div>
  );
}

function EmbedSlot({
  opportunity,
  embedKind,
  persona,
  orgId,
  contact,
  // Wave 31 v3.0.11 — contacts map (for resolving the related
  // protection opp's contact context when D5 cross-show fires) +
  // relatedOpps (memoized in CoPilotPane).
  contacts,
  relatedOpps,
  vehicle,
  onFormChange,
  // Wave 16 F2-fu11/fu12 — workflow-agnostic callback, fired by any
  // embedded wizard when it commits a canonical vehicle record (Step 1
  // VehicleAdd / equivalent). CoPilotPane builds the handler with
  // closure over session-data appenders; EmbedSlot routes typed shims
  // to each embed so the telemetry event carries workflow_type.
  onEmbedVehicleCommitted,
  // Wave 14-fu — per-workflow availableStatuses overrides derived
  // upstream in CoPilotPane from the operator's local status mapping.
  // `undefined` here means the AgentView falls back to canon (today's
  // behavior); a populated array overrides the canon-derived list.
  protectionAvailableStatuses,
  insuranceAvailableStatuses,
  // Wave 31 v3.0.11 — Find Coverage spawn handler. Closure over
  // CoPilotPane's spawn helper. Passed only to InsuranceEmbed; other
  // embed kinds receive `undefined` and ignore it.
  onFindCoverageSpawn,
  // Wave 31b-fu4 — session-data opportunity patcher. Passed through to
  // InsuranceEmbed so it can write workflow status transitions to the opp
  // record and activity log. The same ref-stable `updateOpportunity` that
  // ProtectionEmbed and the vehicle wire-back handler use.
  updateOpportunity,
}) {
  // Wave 14 — pull per-kind DEV CONTROLS slices off ActiveWorkflowContext
  // so the same source of truth drives both the consolidated DevPanel's
  // mounted DevControls (in mission-control App.jsx) and the AgentView
  // embed prop. Each slice is initialized to a sensible default in
  // App.jsx's useState seeds; setters are partialSetter-wrapped to
  // accept both bare patch objects and functional updaters.
  const {
    protectionDev,
    setProtectionDev,
    refiDev,
    insuranceDev,
  } = useActiveWorkflow();

  // Wave 16 F2-fu12 / Wave 17 P1-fu3a — typed shims so
  // handleEmbedVehicleCommitted's telemetry event carries the right
  // workflow_type regardless of which embed fires.
  //
  // P1-fu3a — these MUST be useCallback'd. Inline arrows recreated each
  // render were the residual loop closer after P1-fu3 fixed the asymmetric
  // dedup gap: even when dedupAndUpsertVehicle correctly matched + the
  // existing id was preserved, the merged vehicle object itself was a
  // fresh reference inside `contact.vehicles`, which flipped the array's
  // ref → CoPilotPane re-rendered → these inline arrows were rebuilt →
  // protection wizard's `useEffect([form.vehicle, onVehicleCommitted])`
  // saw a new `onVehicleCommitted` ref and re-fired with the stale
  // `xs_ymmt_<YMMT>` payload. New ref shim → new fire → new merged
  // object → repeat. Stabilizing the shim refs cuts that propagation
  // path so the wizard observer's deps don't churn on parent re-render.
  // Combined with Fix B (no-op short-circuit in dedupAndUpsertVehicle)
  // this is defense in depth: A reduces churn, B makes any residual
  // re-fire idempotent at the session-state layer.
  const handleProtectionCommitted = useCallback(
    (v) => {
      if (!onEmbedVehicleCommitted) return;
      onEmbedVehicleCommitted(v, 'protection');
    },
    [onEmbedVehicleCommitted],
  );
  const handleRefiCommitted = useCallback(
    (v) => {
      if (!onEmbedVehicleCommitted) return;
      onEmbedVehicleCommitted(v, 'refi');
    },
    [onEmbedVehicleCommitted],
  );
  const handleInsuranceCommitted = useCallback(
    (v) => {
      if (!onEmbedVehicleCommitted) return;
      onEmbedVehicleCommitted(v, 'insurance');
    },
    [onEmbedVehicleCommitted],
  );

  // Pass-through guard so embeds that read `typeof onVehicleCommitted ===
  // 'function'` for opt-in observers still see `undefined` when the
  // parent handler isn't wired (legacy/standalone callers). The shims
  // above are stable refs regardless.
  const protectionCommittedProp = onEmbedVehicleCommitted
    ? handleProtectionCommitted
    : undefined;
  const refiCommittedProp = onEmbedVehicleCommitted
    ? handleRefiCommitted
    : undefined;
  const insuranceCommittedProp = onEmbedVehicleCommitted
    ? handleInsuranceCommitted
    : undefined;

  if (embedKind === 'protection') {
    // Wave 14 follow-up — protection now lifts its wizard form +
    // stepIdx to ActiveWorkflowContext, mirroring refi. The
    // ProtectionEmbed wrapper owns the seed effect (mounts
    // protectionForm via buildProtectionInitialForm before AgentView
    // mounts) so by the time AgentView reads its `form`/`update`/
    // `stepIdx`/`setStepIdx` props, they're populated. Without this,
    // AgentView's optional-prop fallback would fire and the lifted
    // state would never get populated → ProtectionDevControls'
    // Force-complete + Form state sections would render against `{}`.
    return (
      <ProtectionEmbed
        key={`${persona}:${opportunity.id}`}
        persona={persona}
        opportunity={opportunity}
        contact={contact}
        vehicle={vehicle}
        dev={protectionDev}
        setProtectionDev={setProtectionDev}
        onFormChange={onFormChange}
        onVehicleCommitted={protectionCommittedProp}
        availableStatuses={protectionAvailableStatuses}
        // Wave 34 v3.0.14 (ADR 24 D4) — protection step write-through
        // needs the session-data opportunity patcher to persist
        // `protection_progress` onto the opp record.
        updateOpportunity={updateOpportunity}
      />
    );
  }
  if (embedKind === 'refi') {
    // No onFormChange — refi writes its form directly to refiForm on
    // context (Wave 14 follow-up). DEV · Payload reads from there.
    // Wave 18-fu5 — opportunity forwarded so RefiAgentEmbedInner can
    // seed + re-seed refiStepIdx from opportunity.status (mirrors
    // ProtectionEmbed's opportunity prop, added in Wave 18-fu3).
    return (
      <Suspense fallback={<EmbedLoading label="Loading refi agent view…" />}>
        <RefiAgentEmbed
          key={`${persona}:${opportunity.id}`}
          persona={persona}
          orgId={orgId}
          contact={contact}
          vehicle={vehicle}
          dev={refiDev}
          onVehicleCommitted={refiCommittedProp}
          opportunity={opportunity}
          // Wave 35 v3.0.15 (ADR 25 D4) — refi step write-through needs
          // the session-data opportunity patcher to persist
          // `refi_progress` onto the opp record (mirrors ProtectionEmbed).
          updateOpportunity={updateOpportunity}
        />
      </Suspense>
    );
  }
  if (embedKind === 'insurance') {
    // No onFormChange — insurance writes its workflow directly to
    // insuranceWorkflow on context (Wave 14 follow-up).
    // Wave 31 v3.0.11 — pass contacts + relatedOpps + spawn handler so
    // InsuranceEmbed can render the InsuranceSavingsCard hero AND the
    // D5 cross-component (protection's RecommendedCoverage inline) when
    // a related protection/vsc opp ≤ step 5 exists.
    // Wave 31b-fu4 — updateOpportunity threaded so InsuranceEmbed can
    // persist workflow status transitions to the opp record.
    return (
      <Suspense fallback={<EmbedLoading label="Loading insurance agent view…" />}>
        <InsuranceEmbed
          key={`${persona}:${opportunity.id}`}
          persona={persona}
          opportunity={opportunity}
          orgId={orgId}
          contact={contact}
          contacts={contacts}
          relatedOpps={relatedOpps}
          vehicle={vehicle}
          dev={insuranceDev}
          onVehicleCommitted={insuranceCommittedProp}
          availableStatuses={insuranceAvailableStatuses}
          onFindCoverageSpawn={onFindCoverageSpawn}
          updateOpportunity={updateOpportunity}
        />
      </Suspense>
    );
  }
  // Anything else (payments, null, future types) lands here.
  return <EmbedUnavailable type={opportunity.type} />;
}

function ProtectionEmbed({
  persona,
  // Wave 18-fu3 — opportunity is now forwarded into ProtectionEmbed so
  // that (a) AgentView's own stepFromStatus resume effect can fire and
  // (b) mc can re-seed protectionStepIdx when opportunity.status changes
  // (e.g. force-status picker in the DevPanel top bar).
  opportunity,
  contact,
  vehicle,
  dev,
  setProtectionDev,
  onFormChange,
  // Wave 16 F2-fu11 — passed through to ProtectionAgentView so its
  // Step 1 commit observer (form.vehicle change → callback) reaches
  // mc's handler. Optional; standalone protection app callers leave
  // it undefined and the AgentView observer becomes a no-op.
  onVehicleCommitted,
  availableStatuses,
  // Wave 34 v3.0.14 (ADR 24 D4) — session-data opportunity patcher,
  // threaded from EmbedSlot. The protection step write-through uses it to
  // persist `protection_progress` onto the opp record on each forward
  // step transition.
  updateOpportunity,
}) {
  // Wave 14 follow-up — protection wizard form + stepIdx lifted to
  // ActiveWorkflowContext. Mirrors RefiAgentEmbedInner's seed flow:
  //   1. App.jsx owns useState(protectionForm = null).
  //   2. This effect runs whenever protectionForm becomes null (on
  //      mount, or after a future Reset). It seeds via
  //      buildProtectionInitialForm (mirroring protection-portal's
  //      internal buildInitialFormSeed) and registers
  //      resetProtectionForm for parity with refi.
  //   3. Until protectionForm is non-null, AgentView gets a {}
  //      placeholder so controlled inputs have something to read for
  //      the one tick before the effect commits.
  //
  // The parent EmbedSlot supplies key={`${persona}:${opportunity.id}`}
  // so this wrapper remounts on opportunity change. The seed effect
  // re-fires because protectionForm got reset to null in setActive's
  // cleanup at the previous opp's unmount (CoPilotPane wires that).
  //
  // Phase 2: replace this seed flow with a real workflow record fetch
  // (`await blinkerApi.protection.get(opportunity_id)`) so the form
  // persists across pane reopens.
  const {
    protectionForm,
    setProtectionForm,
    protectionStepIdx,
    setProtectionStepIdx,
    setResetProtectionForm,
  } = useActiveWorkflow();

  useEffect(() => {
    if (protectionForm === null) {
      // Wave 31 v3.0.11 (ADR 21 D3b) — when the opp was spawned by the
      // insurance Find Coverage CTA, opportunity._prefill carries mileage
      // / driving info / YMMT/VIN that protection's step-1 + step-2
      // would otherwise collect. buildProtectionInitialForm overlays the
      // prefill on top of the contact/vehicle seed (4th-arg overlay,
      // no-op when prefill is null for non-spawned opps).
      const seededForm = buildProtectionInitialForm(
        PROTECTION_INITIAL_FORM,
        contact,
        vehicle,
        opportunity?._prefill || null,
      );
      setProtectionForm(seededForm);
      // Step-index seeding has TWO paths now:
      //   1. Standard (existing opp with VSC display-name status) —
      //      stepFromStatus maps Booked → BillingPayment, Quoted →
      //      RecommendedCoverage, etc., then indexOf into buildSteps.
      //   2. Wave 31 spawn (opportunity.status is itself a wizard step
      //      key like 'vehicle_use') — stepFromStatus has no entry for
      //      step keys so it falls back to 'vehicle_add' (index 0).
      //      We detect that by checking if opportunity.status is a
      //      literal step key and use it directly when so.
      //
      // The dual-path approach keeps the existing resume-from-status
      // contract intact (status-step-map is off-limits to edit per the
      // Wave 31 dispatch brief — protection-portal is read-only) while
      // letting spawn opportunities land at vehicle_use without
      // round-tripping through a new VSC status enum entry.
      const stepList = buildProtectionSteps(seededForm);
      const directStepIdx =
        opportunity?.status && stepList.includes(opportunity.status)
          ? stepList.indexOf(opportunity.status)
          : -1;
      let targetIdx;
      if (directStepIdx >= 0) {
        // Spawn path — opportunity.status IS a wizard step key.
        targetIdx = directStepIdx;
      } else {
        // Standard path — VSC display name → step key → numeric idx.
        const stepKey = stepFromStatus(opportunity?.status, 'vehicle_add');
        targetIdx = Math.max(0, stepList.indexOf(stepKey));
      }
      setProtectionStepIdx(targetIdx);
    }
    // We deliberately depend on protectionForm so a future Reset (which
    // sets protectionForm to null) re-fires this effect and re-seeds.
    // contact/vehicle are captured in the closure; they're stable for
    // the lifetime of this wrapper instance because the parent supplies
    // a per-opportunity key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [protectionForm]);

  // Wave 18-fu3 — re-seed protectionStepIdx when opportunity.status
  // changes after initial mount (e.g. agent uses force-status picker in
  // the DevPanel top bar, or a status_change activity arrives). Keeps
  // mc's lifted step index in sync with AgentView's own resume logic.
  // Guarded by protectionForm non-null so we don't race with the seed
  // effect above on mount (protectionForm is null → seed effect handles
  // the initial step; this effect is only for post-mount status changes).
  //
  // TODO(Wave 18-fu): refi + insurance equivalents when their portals
  // expose stepFromStatus helpers.
  useEffect(() => {
    if (!protectionForm) return;
    // Wave 31 v3.0.11 — same dual-path resolution as the seed effect
    // (see the seed effect above for rationale). When opportunity.status
    // is itself a wizard step key, land at that step directly without
    // routing through STATUS_TO_STEP (which doesn't know about step
    // keys).
    const stepList = buildProtectionSteps(protectionForm);
    const directStepIdx =
      opportunity?.status && stepList.includes(opportunity.status)
        ? stepList.indexOf(opportunity.status)
        : -1;
    let targetIdx;
    if (directStepIdx >= 0) {
      targetIdx = directStepIdx;
    } else {
      const stepKey = stepFromStatus(opportunity?.status, 'vehicle_add');
      targetIdx = Math.max(0, stepList.indexOf(stepKey));
    }
    setProtectionStepIdx(targetIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunity?.status]);

  // Register resetProtectionForm with closure over the current
  // contact/vehicle. Currently unused by ProtectionDevControls (no
  // reset button) but published for symmetry with refi.
  //
  // Wave 31 v3.0.11 — reset also carries `opportunity._prefill` through
  // the overlay so a spawned opp's prefilled vehicle/driving data
  // doesn't evaporate on Reset.
  useEffect(() => {
    const fn = () => {
      setProtectionForm(
        buildProtectionInitialForm(
          PROTECTION_INITIAL_FORM,
          contact,
          vehicle,
          opportunity?._prefill || null,
        ),
      );
      setProtectionStepIdx(0);
    };
    setResetProtectionForm(() => fn);
    return () => setResetProtectionForm(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact?.id, vehicle?.id, opportunity?.id]);

  // Wave 34 v3.0.14 (ADR 24 D4) — protection step write-through.
  //
  // Protection wrote NO activity rows until this effect — `protectionStepIdx`
  // was in-memory React state only, evaporating on opp-switch / reopen and
  // invisible to RelatedProtectionProgress's related-opp mount. This is the
  // FIRST protection activity-write path. Modeled on the insurance Wave
  // 31b-fu4 status write-through in InsuranceEmbed below.
  //
  // On a FORWARD step transition i → j (j > i) for the active protection
  // opp:
  //   1. Append one `step_change` activity per newly-completed step in the
  //      span [i, j) — a normal Continue completes one step; a force-status
  //      / resume jump completes the whole span.
  //   2. Persist `protection_progress` on the opp record (additive field;
  //      mirrors the insurance `summary` fu3 pattern) so a reopened or
  //      related-opp timeline shows the furthest point without replaying
  //      every activity.
  // It does NOT touch `opportunity.status` — protection status stays the
  // VSC display name; step progress lives in `protection_progress` +
  // `step_change` activities only.
  //
  // Loop-safety: `previousStepRef` guards exactly like the insurance
  // write-through's `previousStatusRef`. After updateOpportunity writes
  // `protection_progress` and CoPilotPane re-renders, this effect would
  // re-fire — the `if (j === previousStepRef.current) return;` guard
  // breaks the loop on the second fire. We also ignore BACKWARD moves
  // (j <= i) so a re-seed / resume-to-earlier-step doesn't emit rows.
  const previousStepRef = useRef(
    typeof protectionStepIdx === 'number' ? protectionStepIdx : 0,
  );
  useEffect(() => {
    const j = typeof protectionStepIdx === 'number' ? protectionStepIdx : 0;
    const i = previousStepRef.current;
    // Ref guard — breaks the re-fire loop after updateOpportunity propagates.
    if (j === i) return;
    previousStepRef.current = j;
    // Only forward transitions complete steps. Backward moves (resume to an
    // earlier step, re-seed) update the ref but emit nothing.
    if (j <= i) return;
    if (!opportunity?.id || !opportunity?.contact_id) return;

    // Resolve step KEYS from the live form's buildSteps so conditional
    // steps are indexed exactly as the running wizard has them.
    let stepList;
    try {
      stepList = buildProtectionSteps(protectionForm || {});
    } catch {
      stepList = [];
    }

    // One step_change activity per newly-completed step in span [i, j).
    for (let k = i; k < j; k++) {
      const completedKey = stepList[k] || null;
      const toKey = stepList[k + 1] || null;
      const label = PROTECTION_STEP_LABEL[completedKey] || completedKey || `step ${k}`;
      try {
        activitiesApi.create({
          contact_id: opportunity.contact_id,
          opportunity_id: opportunity.id,
          type: 'step_change',
          // v3.0.15 (ADR 27 D7) — the actor is `agent`: in Phase 1 the
          // agent drives the entire protection wizard inside the CoPilot
          // embed. The timeline's actor badge reads this `source`. A
          // genuine consumer-driven advance (Phase-2 back-channel) will
          // stamp `source: 'consumer'`.
          source: 'agent',
          payload: {
            from_step: completedKey,
            to_step: toKey,
            completed_step: completedKey,
            step_idx: k,
            workflow_type: 'protection',
          },
          summary_text: `Protection step: ${label}`,
        });
      } catch (err) {
        console.warn('[mc] activities.create(step_change) failed:', err);
      }
    }

    // Persist protection_progress on the opp record (additive — does NOT
    // touch opportunity.status). Lets reopen + related-opp timelines show
    // the furthest point without replaying every activity.
    if (typeof updateOpportunity === 'function') {
      const furthestKey = stepList[j] || stepList[stepList.length - 1] || null;
      updateOpportunity(opportunity.id, {
        protection_progress: {
          furthest_step_idx: j,
          furthest_step_key: furthestKey,
          updated_at: new Date().toISOString(),
        },
      });
    }

    const fromKeyTele = stepList[i] || null;
    const toKeyTele = stepList[j] || null;
    track('mc.copilot.protection_progress.step_persisted', {
      opp_id: opportunity.id,
      from_step: fromKeyTele,
      to_step: toKeyTele,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [protectionStepIdx, opportunity?.id, opportunity?.contact_id]);

  const update = (patch) =>
    setProtectionForm((prev) => ({
      ...(prev || {}),
      ...(typeof patch === 'function' ? patch(prev || {}) : patch),
    }));

  // Render with an empty form for the one tick before the seed effect
  // commits so AgentView's controlled inputs have something to read.
  const safeForm = protectionForm || {};
  // `dev` is the lifted protection dev slice from context. AgentView
  // reads showInsuranceCrossSell + crossSellOverrides +
  // seedMultiContactHousehold off it. The setCrossSellOverrides
  // adapter bridges AgentView's API (operates on the inner overrides
  // object) back to the slice setter (operates on the full dev slice).
  return (
    <ProtectionAgentView
      persona={persona}
      personaLocked={false}
      // Wave 18-fu3 — forward opportunity so AgentView's internal
      // stepFromStatus resume effect can also fire (dual-path: both mc's
      // seed effect above AND AgentView's own effect will converge on the
      // same target index, which is safe — they agree by construction).
      opportunity={opportunity}
      contact={contact}
      vehicle={vehicle}
      onFormChange={onFormChange}
      onVehicleCommitted={onVehicleCommitted}
      form={safeForm}
      update={update}
      stepIdx={protectionStepIdx}
      setStepIdx={setProtectionStepIdx}
      seedMultiContactHousehold={dev?.seedMultiContactHousehold}
      crossSellOverrides={dev?.crossSellOverrides}
      setCrossSellOverrides={(next) =>
        setProtectionDev((prev) => ({
          ...(prev || {}),
          crossSellOverrides:
            typeof next === 'function' ? next(prev?.crossSellOverrides) : next,
        }))
      }
      showInsuranceCrossSell={dev?.showInsuranceCrossSell ?? true}
      availableStatuses={availableStatuses}
    />
  );
}

// Wave 31 v3.0.11 (ADR 21 D5) — protection statuses ≤ step 5
// (coverage_recommendation). When a related protection/vsc opp sits at
// one of these statuses, the insurance CoPilot right pane cross-shows
// protection's `RecommendedCoverage` inline. Past step 5 the workflow
// has progressed to confirm/billing/docuseal where the protection
// CoPilot is the better home for the agent — cross-show would clutter.
const PROTECTION_STATUSES_FOR_CROSS_SHOW = new Set([
  // Wizard step keys (when the related opp was spawned by THIS cross-sell
  // and hasn't been moved off the seeded status yet).
  'vehicle_add',
  'vehicle_drive',
  'vehicle_use',
  'modifications',
  'recommended_coverage',
  'coverage_preview', // ADR alias — kept for forward-compat
  'coverage_recommendation', // ADR alias — kept for forward-compat
  // VSC display-name equivalents (when the related opp has been worked
  // and stepFromStatus would route to the same wizard region).
  'Empty',
  'Quoted',
]);

// Wave 34 v3.0.14 (ADR 24 D4) — protection wizard step-key → human label,
// used for the `summary_text` on `step_change` activities emitted by the
// protection step write-through. Kept in sync with the STEP_LABEL map in
// RelatedProtectionProgress.jsx (intentional cross-file duplication — the
// step KEYS are the contract, the LABELS are display-only; protection-
// portal exports no step-label map). Update both when a wizard step is
// added.
const PROTECTION_STEP_LABEL = {
  vehicle_add: 'Add vehicle',
  vehicle_drive: 'Driving habits',
  vehicle_use: 'Vehicle use',
  modifications: 'Modifications',
  garage_location: 'Garage location',
  recommended_coverage: 'Recommended coverage',
  customize: 'Customize coverage',
  confirm: 'Review & confirm',
  billing_payment: 'Billing & payment',
  vin_validate: 'VIN validation',
  rates_changed: 'Rates changed',
  docuseal: 'Sign agreements',
  thank_you: 'Complete',
};

// Wave 31b-fu4 — map canonical insurance machine_ids to their display
// labels for the `payload.to` field on status_change activities.
// Mirrors the ghl-status.json canon that RelatedInsuranceProgress imports
// via its own static import. Hardcoded here (rather than re-importing the
// JSON) to avoid adding a module-level static import for a single-use
// lookup table in a 2000-line file; update when canon adds new statuses.
// Source: src/constants/canon/ghl-status.json insurance.statuses as of
// canon _version 2026-05-13.
const INSURANCE_STATUS_LABEL = {
  started: 'Started',
  'lead.created': 'New Lead',
  'capture_link.created': 'Capture Link Created',
  'capture_link.sent': 'Capture Link Sent',
  'capture_link.viewed': 'Capture Link Viewed',
  'capture.completed': 'Capture Completed',
  'quote.completed': 'Quoted',
  'quote.viewed': 'Quote Viewed',
  'policy.bound': 'Policy Written',
  'quote_link.created': 'Quote Link Created',
  'quote_link.sent': 'Quote Link Sent',
  'quote_link.viewed': 'Quote Link Viewed',
  'error.verification': 'Error - Verification',
  'error.quote': 'Error - Quote',
  duplicate: 'Duplicate',
  working: 'Working',
};

// Wave 31b-fu4 — derive a human-readable next_action from an insurance
// machine_id status. Wording aligned to existing fixture next_action strings
// (see packages/api/_fixtures/opportunities.json). Used when writing
// through to the opp record on each workflow status transition.
function deriveInsuranceNextAction(machineStatus) {
  switch (machineStatus) {
    case 'started':
      return 'Send capture link';
    case 'lead.created':
      return 'Send capture link';
    case 'capture_link.created':
      return 'Send capture link to consumer';
    case 'capture_link.sent':
      return 'Wait for link engagement';
    case 'capture_link.viewed':
      return 'Awaiting consumer capture completion';
    case 'capture.completed':
      return 'Capture done — advance to quote';
    case 'quote.completed':
      return 'Review quote with customer';
    case 'quote.viewed':
      return 'Follow up — consumer viewed quote, ask if ready to bind';
    case 'policy.bound':
      return 'Closed — review for cross-sell (VSC)';
    case 'quote_link.created':
      return 'Send quote link to consumer';
    case 'quote_link.sent':
      return 'Wait for consumer click';
    case 'quote_link.viewed':
      return 'Awaiting consumer quote completion';
    case 'error.verification':
      return 'Verification failed — review';
    case 'error.quote':
      return 'Quote failed — review';
    case 'duplicate':
      return 'Duplicate lead — review';
    default:
      return null;
  }
}

function InsuranceEmbed({
  persona,
  opportunity,
  orgId,
  contact,
  // Wave 31 v3.0.11 — contacts map so the D5 cross-component lookup
  // can resolve the related protection opp's contact / vehicle. The
  // full opportunities list isn't needed here — relatedOpps (memoized
  // by CoPilotPane) is the slice we actually consume.
  contacts,
  relatedOpps,
  vehicle,
  dev,
  // Wave 16 F2-fu12 — threaded in parallel with protection/refi so
  // insurance's wizard fires the same append-or-patch handler when a
  // vehicle is committed from its pre-step or wizard flow.
  onVehicleCommitted,
  availableStatuses,
  // Wave 31 v3.0.11 (ADR 21 D3) — Find Coverage CTA on the
  // InsuranceSavingsCard hero spawns a protection opp + switches to it.
  onFindCoverageSpawn,
  // Wave 31b-fu4 — write-through: persist insurance workflow status
  // transitions to the opp record + activities so RelatedInsuranceProgress
  // shows the correct state when CoPilot switches to a different opp.
  updateOpportunity,
}) {
  // Wave 14 follow-up: insurance workflow state lifted to
  // ActiveWorkflowContext for the same reason refi's form was — so
  // InsuranceDevControls' workflow-driven simulators (consumer-link
  // viewed flip, etc.) work when the panel is mounted from
  // mission-control's consolidated DevPanel. The DevPanel's
  // "DEV · Payload → live workflow" block reads insuranceWorkflow
  // directly from context (Option (b)).
  //
  // Seed flow mirrors RefiAgentEmbedInner above: when insuranceWorkflow
  // is null, build the initial shape and write it to context. The
  // resetInsuranceWorkflow callback is registered for symmetry with
  // refi (currently unused — there's no insurance reset button in the
  // consolidated DevPanel today, but downstream wiring may want it).
  const {
    insuranceWorkflow,
    setInsuranceWorkflow,
    setResetInsuranceWorkflow,
  } = useActiveWorkflow();

  // Wave 18-fu5 — build the initial insurance workflow shape, optionally
  // pre-seeding consumer_link when opportunity.status maps to 'post_send'
  // so AgentView.isLinkSent evaluates true and LeadStatusTimeline mounts
  // immediately rather than showing the origination form.
  //
  // When `forStatus` is provided (initial seed + re-seed paths), the
  // posture is derived from insuranceStepFromStatus. The Reset path passes
  // no status so it always goes back to the origination form (pre_send).
  //
  // consumer_link.sentAt is seeded from opportunity.updated_at (most
  // likely timestamp for a real send event on an existing opp) with a
  // fallback to now(). lead.leadId uses a 'synthetic_resume_' prefix so
  // it's distinguishable from real EI leadIds in PostHog telemetry.
  // LeadStatusTimeline is gated on workflow.lead.leadId (per
  // architecture/06-embedded-insurance-contract.md + Wave 17 P1-fu2 fix
  // in protection-portal CrossSellSubFlow) so we must supply it.
  // Wave 33-fu3 — `summary` (the persisted detail snapshot written by the
  // status write-through effect below) is overlaid onto the re-seeded
  // workflow when present. WHY: re-entering an insurance opp re-seeds a
  // fresh workflow and the prior capture/quote/policy detail is otherwise
  // lost — the active-opp popovers (and the right-pane LeadStatusTimeline
  // when not hidden) would go thin until the simulator re-runs. Overlay
  // only: `summary` absent → behavior unchanged.
  const buildInitial = (forStatus, summary) => {
    const posture = forStatus
      ? insuranceStepFromStatus(forStatus, 'pre_send')
      : 'pre_send';
    const isPostSend = posture === 'post_send';
    return {
      flowPath: opportunity?.flowPath || 'capture_and_quote',
      orgId,
      notes: '',
      tags: [],
      tagsCreated: [],
      // Wave 36-fu4 (ADR 26 D4-fu4) — seed the self-reported current-insurance
      // fields from `opportunity.current_insurance` when present. Fixture /
      // force-statused quote-only opps carry this additive block on the opp
      // record (the live CurrentInsuranceGate writes the same workflow-root
      // fields directly via updateWorkflow). Seeding here lets the savings
      // adapter + the timeline QuoteDetail popover compute estimated savings
      // without the agent re-running the gate.
      currentCarrier: opportunity?.current_insurance?.carrier ?? null,
      currentCarrierId: opportunity?.current_insurance?.carrierId ?? null,
      currentPremiumCents: opportunity?.current_insurance?.premiumCents ?? null,
      premiumCadence: opportunity?.current_insurance?.cadence ?? '6mo',
      ...(isPostSend
        ? {
            consumer_link: {
              sentAt: opportunity?.updated_at || new Date().toISOString(),
            },
            lead: {
              leadId: `synthetic_resume_${opportunity?.id || 'unknown'}`,
              partnerExternalId: null,
            },
            status: forStatus,
          }
        : {}),
      ...(summary
        ? {
            capture: summary.capture || null,
            quote: summary.quote || null,
            policy: summary.policy || null,
          }
        : {}),
    };
  };

  useEffect(() => {
    if (insuranceWorkflow === null) {
      setInsuranceWorkflow(buildInitial(opportunity?.status, opportunity?.summary));
    }
    // Same reset-via-null-key pattern as refi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insuranceWorkflow]);

  // Wave 18-fu5 — re-seed insuranceWorkflow when opportunity.status
  // changes after initial mount (e.g. agent uses force-status picker).
  // Guarded by insuranceWorkflow non-null so we don't race with the seed
  // effect above on mount. Dep is the primitive string
  // opportunity?.status — does NOT depend on the full workflow object so
  // the Wave 17 P1-fu3b ref-stability invariants are preserved.
  useEffect(() => {
    if (!insuranceWorkflow) return;
    const posture = insuranceStepFromStatus(opportunity?.status, 'pre_send');
    const isPostSend = posture === 'post_send';
    if (isPostSend && !insuranceWorkflow.consumer_link?.sentAt) {
      // Status has moved to post_send but consumer_link isn't seeded yet
      // (e.g. agent used force-status to jump forward). Patch in the
      // consumer_link + lead so the timeline renders immediately.
      setInsuranceWorkflow((prev) => ({
        ...(prev || {}),
        consumer_link: {
          sentAt: opportunity?.updated_at || new Date().toISOString(),
        },
        lead: {
          leadId: `synthetic_resume_${opportunity?.id || 'unknown'}`,
          partnerExternalId: null,
        },
        status: opportunity?.status,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunity?.status]);

  useEffect(() => {
    const fn = () => setInsuranceWorkflow(buildInitial());
    setResetInsuranceWorkflow(() => fn);
    return () => setResetInsuranceWorkflow(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunity?.flowPath, orgId]);

  // Wave 31b-fu4 — write-through: when the EI simulator advances
  // insuranceWorkflow.status, persist it to the opp record AND append a
  // status_change activity so RelatedInsuranceProgress's
  // blinkerApi.activities.list({ opportunity_id }) query picks up the
  // transitions and renders the correct checkmarks on the timeline.
  //
  // Without this, insuranceWorkflow is session-only React state. When
  // CoPilot switches to the spawned protection opp, the state evaporates
  // and the related-opp row on the left rail reads the stale opp record
  // (still at the initial status, no activity history).
  //
  // Wave 33-fu3 — the patch ALSO snapshots the workflow's rich detail
  // (capture / quote / policy) onto the opp record as an additive
  // `summary` block. WHY: the per-event hover popovers in
  // RelatedInsuranceProgress (carrier / premium / policy ref / savings)
  // read detail from the LIVE `insuranceWorkflow`, but mc keeps exactly
  // ONE live workflow — the active CoPilot's — and nulls it on
  // opp-switch. A RELATED insurance opp therefore has no live workflow,
  // so its popovers render empty. Persisting `summary` gives the
  // related-opp timeline a durable detail source. The webhook handler
  // patches `status` + the relevant detail object into the workflow in
  // the SAME patch, so when `next` (the new status) is observed here the
  // matching detail is already present; each fire snapshots whatever
  // exists, and by `policy.bound` `summary` carries all three. `summary`
  // is purely additive on the opp record — other consumers ignore it.
  //
  // Wave 36-fu5 — the patch ALSO snapshots `current_insurance` (the
  // customer's self-reported current carrier + premium) onto the opp
  // record. WHY: the quote-only estimated-savings figure on the timeline
  // QuoteDetail popover is computed from these self-reported fields, but
  // they live ONLY at the live `insuranceWorkflow` root (seeded by
  // buildInitial, written by CurrentInsuranceGate) — same active-opp-only
  // problem `summary` solved in Wave 33-fu3. When a quote-only insurance
  // opp is shown as a RELATED opp under a different active opp (or
  // reopened later), there is no live workflow, so the related-opp
  // QuoteDetail popover degrades to "No savings comparison" even though
  // the data exists. Persisting `current_insurance` gives those popovers
  // a durable self-reported source. Only written when the live workflow
  // actually carries self-reported data — never stamp an all-null block.
  //
  // Loop-safety: the effect dep includes opportunity?.status. After
  // updateOpportunity writes the new status, CoPilotPane re-renders with
  // the updated opp — which would change the dep and re-fire this effect.
  // The `if (next === previousStatusRef.current) return;` guard breaks
  // the loop on the second fire because the ref was already advanced by
  // the first fire.
  //
  // Additional guard: `if (next === opportunity?.status)` short-circuits
  // the write when the opp record already matches (e.g. after a force-
  // status picker jump which writes directly to the opp).
  const previousStatusRef = useRef(opportunity?.status || null);
  useEffect(() => {
    const next = insuranceWorkflow?.status;
    if (!next) return;
    // Ref guard — breaks re-fire loop after updateOpportunity propagates.
    if (next === previousStatusRef.current) return;
    const prev = previousStatusRef.current;
    previousStatusRef.current = next;

    // Persist to opp record so reopening the CoPilot resumes correctly
    // and the related-opp timeline can render the checkmarks via
    // opportunity.status directly (RelatedInsuranceProgress line:
    // `const currentMachineId = opportunity?.status || null;`).
    if (typeof updateOpportunity === 'function' && next !== opportunity?.status) {
      updateOpportunity(opportunity.id, {
        status: next,
        next_action: deriveInsuranceNextAction(next),
        // Wave 33-fu3 — persisted detail snapshot for related-opp popovers
        // (see effect comment block above). Mirrors the live workflow's
        // capture/quote/policy sub-shape exactly.
        summary: {
          capture: insuranceWorkflow?.capture || null,
          quote: insuranceWorkflow?.quote || null,
          policy: insuranceWorkflow?.policy || null,
        },
        // Wave 36-fu5 — persisted self-reported current-insurance block
        // for related-opp / reopened quote-only savings popovers (see
        // effect comment block above). Only written when the live
        // workflow actually carries self-reported data — guarded so an
        // all-null block is never stamped onto a non-quote-only opp.
        ...((insuranceWorkflow?.currentCarrier ||
          insuranceWorkflow?.currentPremiumCents != null)
          ? {
              current_insurance: {
                carrierId: insuranceWorkflow.currentCarrierId ?? null,
                carrier: insuranceWorkflow.currentCarrier ?? null,
                premiumCents: insuranceWorkflow.currentPremiumCents ?? null,
                cadence: insuranceWorkflow.premiumCadence ?? '6mo',
              },
            }
          : {}),
      });
    }

    // Append a status_change activity so RelatedInsuranceProgress's
    // deriveTimestamps picks it up. The `payload.to` field must be the
    // display label (e.g. 'Quoted') matching the MACHINE_ID_BY_LABEL
    // lookup in deriveTimestamps — not the machine_id itself.
    if (opportunity?.contact_id) {
      const displayLabel = INSURANCE_STATUS_LABEL[next] || null;
      try {
        activitiesApi.create({
          contact_id: opportunity.contact_id,
          opportunity_id: opportunity.id,
          type: 'status_change',
          source: 'system',
          payload: {
            from: prev ? (INSURANCE_STATUS_LABEL[prev] || prev) : null,
            to: displayLabel || next,
            from_machine_id: prev || null,
            to_machine_id: next,
            workflow_type: 'insurance',
          },
          summary_text: `Insurance status: ${displayLabel || next}`,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[mc] activities.create(status_change) failed:', err);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insuranceWorkflow?.status, opportunity?.id, opportunity?.contact_id, opportunity?.status, updateOpportunity]);

  const updateWorkflow = (patch) =>
    setInsuranceWorkflow((prev) => ({
      ...(prev || {}),
      ...(typeof patch === 'function' ? patch(prev || {}) : patch),
    }));

  // Wave 14: `dev` is now the lifted insurance dev slice from
  // ActiveWorkflowContext. AgentView's LeadOriginationForm reads
  // `dev.flowPath` for its default toggle and the EI mock reads
  // `dev.nextVerificationOutcome` / `dev.nextQuoteOutcome` at simulator
  // click-time. Defaults to `{}` when no DevControls have run yet.
  const devSafe = dev || {};
  // Empty workflow placeholder for the one tick before the seed effect
  // commits. Memoized so the {} fallback doesn't churn the
  // mapInsuranceWorkflowToSavings useMemo below on every render.
  const safeWorkflow = useMemo(
    () => insuranceWorkflow || {},
    [insuranceWorkflow],
  );

  // Wave 31 v3.0.11 (ADR 21 D5) — find a related protection/vsc opp at
  // status ≤ step 5. When present, the right pane cross-shows
  // protection's RecommendedCoverage inline so the agent can sell
  // protection alongside the insurance flow without leaving CoPilot.
  // The first eligible related opp wins (most contacts have at most one
  // protection opp; ties are rare and the chronologically-newer one
  // sorts first via opportunities.list ordering).
  const crossShowProtectionOpp = useMemo(() => {
    const rel = relatedOpps || [];
    return (
      rel.find(
        (o) =>
          (o.type === 'protection' || o.type === 'vsc') &&
          PROTECTION_STATUSES_FOR_CROSS_SHOW.has(o.status),
      ) || null
    );
  }, [relatedOpps]);

  // Resolve the contact + vehicle the cross-shown RecommendedCoverage
  // needs for its plan-card render. The protection opp shares the
  // contact with the insurance opp (same contact_id by construction),
  // and the vehicle resolves via the same contact→vehicles lookup the
  // protection embed itself uses.
  //
  // crossShowFormBase is the initial buildProtectionInitialForm output.
  // crossShowFormPatch holds in-component mutations (RecommendedCoverage's
  // GetRates fallback writes `rates` + `status` via the `update` prop on
  // mount; user plan-card clicks write `selectedPlan`). The full form
  // passed to RecommendedCoverage = base + patch.
  //
  // This split avoids the "setState in effect" cascading-render warning
  // that a single useState + reset-on-change effect would trigger, while
  // still letting the inner component mutate form fields.
  const crossShowFormBase = useMemo(() => {
    if (!crossShowProtectionOpp) return null;
    const relContact =
      (contacts && contacts[crossShowProtectionOpp.contact_id]) ||
      contact ||
      null;
    let relVehicle = null;
    const rv = relContact?.vehicles;
    if (Array.isArray(rv) && rv.length > 0) {
      if (crossShowProtectionOpp.vehicle_id) {
        relVehicle =
          rv.find((v) => v.id === crossShowProtectionOpp.vehicle_id) || null;
      }
      if (!relVehicle && rv.length === 1) {
        relVehicle = rv[0];
      }
    }
    return buildProtectionInitialForm(
      PROTECTION_INITIAL_FORM,
      relContact,
      relVehicle,
      crossShowProtectionOpp._prefill || null,
    );
  }, [crossShowProtectionOpp, contacts, contact]);

  const [crossShowFormPatch, setCrossShowFormPatch] = useState({});

  // Reset the patch when the related opp identity changes (avoids stale
  // rates / selected plan from a different protection opp leaking
  // through). The patch is plain data so identity-comparison on opp id
  // is sufficient.
  const lastCrossShowOppIdRef = useRef(null);
  if (crossShowProtectionOpp?.id !== lastCrossShowOppIdRef.current) {
    lastCrossShowOppIdRef.current = crossShowProtectionOpp?.id;
    // Setting state during render is OK when it's a derived-from-props
    // reset (React docs: "Adjusting state when a prop changes"). The
    // next render observes the cleared patch immediately.
    if (Object.keys(crossShowFormPatch).length > 0) {
      setCrossShowFormPatch({});
    }
  }

  const updateCrossShowForm = useCallback((patch) => {
    setCrossShowFormPatch((prev) => ({
      ...(prev || {}),
      ...(typeof patch === 'function' ? patch(prev || {}) : patch),
    }));
  }, []);

  const crossShowForm = useMemo(
    () =>
      crossShowFormBase
        ? { ...crossShowFormBase, ...crossShowFormPatch }
        : null,
    [crossShowFormBase, crossShowFormPatch],
  );

  // Live-derived insuranceSavings prop for the cross-shown
  // RecommendedCoverage. As capture/quote webhooks fire, the adapter
  // re-derives the shape — null pre-quote, {status:'savings_found',…}
  // for positive savings, {status:'no_savings', monthlySavingsCents:0,…}
  // for the D6 muted branch. RecommendedCoverage handles all three.
  const liveInsuranceSavings = useMemo(
    () => mapInsuranceWorkflowToSavings(safeWorkflow),
    [safeWorkflow],
  );

  // Telemetry for the live status the cross-shown plan cards are seeing.
  // Fires once per status transition so downstream dashboards can join
  // "saw plan cards with status X" cohorts.
  const lastSavingsStatusRef = useRef(null);
  useEffect(() => {
    if (!crossShowProtectionOpp) return;
    const s = liveInsuranceSavings?.status || 'pending';
    if (lastSavingsStatusRef.current === s) return;
    lastSavingsStatusRef.current = s;
    track('protection.recommended_coverage.insurance_savings_status', {
      status: s,
      monthly_savings_cents: liveInsuranceSavings?.monthlySavingsCents ?? 0,
      surface: 'mc_insurance_copilot_cross_show',
      insurance_opp_id: opportunity?.id,
      protection_opp_id: crossShowProtectionOpp?.id,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveInsuranceSavings?.status, crossShowProtectionOpp?.id]);

  // Wave 33 v3.0.13 (ADR 23 D1) — when the workflow is post-send the
  // InsuranceAgentView's full LeadStatusTimeline is REDUNDANT with the
  // new compact left-rail timeline (mounted by OpportunityContextPane).
  // Suppress the right-pane timeline via the `hideLeadStatusTimeline`
  // prop (companion 33a in insurance-portal consumes it). Pre-send is
  // unchanged — the LeadOriginationForm path still owns the right pane.
  //
  // Forward-compatibility: if 33a hasn't landed yet, AgentView will
  // silently ignore the prop and render normally (React tolerates
  // unknown props on custom components). Behavior degrades to the
  // pre-Wave-33 layout — which is correct for that interim window.
  //
  // IMPORTANT — two status fields, two resolver functions (Wave 33-fu):
  //   safeWorkflow.status  → machine_id (e.g. "capture_link.sent")
  //                          → must use insuranceStepFromMachineId
  //   opportunity.status   → human label (e.g. "Capture Link Sent")
  //                          → must use insuranceStepFromStatus
  // Passing a machine_id to insuranceStepFromStatus misses the map and
  // always falls through to the 'pre_send' default, which is exactly the
  // bug that kept hideLeadStatusTimeline from ever firing post-send.
  // The short-circuit `safeWorkflow?.status ||` made it so the correct
  // human-label opportunity.status fallback was effectively never reached.
  const insurancePosture = safeWorkflow?.status
    ? insuranceStepFromMachineId(safeWorkflow.status, 'pre_send')
    : insuranceStepFromStatus(opportunity?.status, 'pre_send');
  const hideLeadStatusTimeline = insurancePosture === 'post_send';

  // Diagnostic telemetry — fires once per CoPilot session when the D1
  // suppression activates. Lets us measure adoption vs. the legacy
  // right-pane timeline. The session-scope is enforced via a ref on
  // `opportunity?.id` so re-mounts on opp switch fire fresh events.
  const suppressionFiredRef = useRef(null);
  useEffect(() => {
    if (!hideLeadStatusTimeline) return;
    if (suppressionFiredRef.current === opportunity?.id) return;
    suppressionFiredRef.current = opportunity?.id;
    track('mc.copilot.lead_status_timeline_suppressed', {
      reason: 'left_rail_active',
      opp_id: opportunity?.id,
    });
  }, [hideLeadStatusTimeline, opportunity?.id]);

  // ---- Render layout ----
  //
  // Mount order in the insurance CoPilot right pane (Wave 33 v3.0.13,
  // ADR 23 D1 + D5):
  //   1. (conditional) Cross-shown protection RecommendedCoverage — only
  //      when D5 conditions are met (related protection/vsc opp at
  //      status ≤ step 5). Rendered ABOVE InsuranceAgentView so the
  //      agent sees: plan options, then workflow progress.
  //   2. InsuranceAgentView (always) — the existing capture/quote
  //      workflow UI. When post-send, `hideLeadStatusTimeline={true}`
  //      suppresses the verbose timeline in favour of the 2-col grid
  //      (ADR 23 D1). The `savingsCardSlot` prop injects
  //      InsuranceSavingsCard ("Insurance at a glance") into the TOP
  //      of AgentView's left column, above ConsumerLinkPanel — matching
  //      the v3.0.13 mockup exactly. AgentView only renders the slot
  //      inside its `hideLeadStatusTimeline` branch, so pre-send the
  //      card is harmlessly ignored. The SavingsCard also self-returns
  //      null pre-send, so no double-guard is needed.
  return (
    <div className="space-y-4">
      {/* Cross-show — protection RecommendedCoverage (D5). Form prop is
          seeded with the same buildProtectionInitialForm scaffold the
          standalone ProtectionEmbed uses, so the plan cards render
          against a real protection-form shape (state / contact /
          vehicle / etc). `insuranceSavings` is driven LIVE by the
          insurance workflow snapshot via mapInsuranceWorkflowToSavings;
          quote.completed events propagate to the -$/mo line on the
          plan cards without unmount. */}
      {crossShowProtectionOpp && crossShowForm && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
            <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">
              Cross-sell · Protection coverage
            </div>
            <div className="text-sm text-slate-700">
              Existing protection opp{' '}
              <span className="font-mono text-xs text-slate-500">
                {crossShowProtectionOpp.id}
              </span>{' '}
              · {crossShowProtectionOpp.status}
            </div>
          </div>
          <div className="py-3">
            <ProtectionRecommendedCoverage
              form={{ ...crossShowForm, insuranceSavings: liveInsuranceSavings }}
              update={updateCrossShowForm}
              onNext={() => {
                // Cross-show doesn't advance the wizard inline. The
                // agent should switch to the protection CoPilot for the
                // related opp to commit a plan selection.
              }}
              persona="agent"
              crossSellOverrides={null}
            />
          </div>
        </div>
      )}

      <InsuranceAgentView
        persona={persona}
        personaLocked={false}
        workflow={safeWorkflow}
        updateWorkflow={updateWorkflow}
        dev={devSafe}
        contact={contact}
        vehicle={vehicle}
        onVehicleCommitted={onVehicleCommitted}
        availableStatuses={availableStatuses}
        // Wave 33 v3.0.13 (ADR 23 D1) — see the post-send derivation
        // above. Forward-compatible with insurance-portal companion
        // commit d87add1 which added savingsCardSlot support.
        hideLeadStatusTimeline={hideLeadStatusTimeline}
        savingsCardSlot={
          <InsuranceSavingsCard
            workflow={safeWorkflow}
            opportunity={opportunity}
            onFindCoverage={onFindCoverageSpawn}
            // Wave 36-fu6 (ADR 26 D6) — the card hosts an inline
            // current-insurance editor for quote-only post-send opps with
            // no self-reported premium. Submit writes the workflow root
            // (updateWorkflow) AND persists `current_insurance` to the opp
            // record (updateOpportunity). Both already exist in scope.
            updateWorkflow={updateWorkflow}
            updateOpportunity={updateOpportunity}
          />
        }
      />
    </div>
  );
}

function EmbedLoading({ label }) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-sm text-slate-400">{label}</div>
    </div>
  );
}

function EmbedUnavailable({ type }) {
  const label = TYPE_LABELS[type] || type;
  return (
    <div className="h-full flex items-center justify-center">
      <div className="max-w-md text-center bg-white border border-slate-200 rounded-xl shadow-sm p-8">
        <div className="text-xs uppercase tracking-wider font-semibold text-slate-400 mb-2">
          {label} workflow
        </div>
        <div className="text-sm text-slate-700 leading-relaxed">
          No agent view available for this opportunity type yet.
        </div>
        <div className="text-[11px] text-slate-400 mt-3">
          Tracked in blinker-platform STATUS.md per-app sections.
        </div>
      </div>
    </div>
  );
}

function OpportunityContextPane({
  opportunity,
  contact,
  contacts,
  vehicle,
  relatedOpps,
  onOpenContactProfile,
  // Wave 31 v3.0.11 (ADR 21 D4) — row click on a related opp switches
  // the active CoPilot to that opp. AND the new RelatedInsuranceProgress
  // mini-timeline (mounted for insurance related opps) exposes an
  // "Open insurance CoPilot →" button that routes through here.
  onOpenOpportunity,
  persona,
  managerOverlay,
}) {
  // Wave 28d — manager-overlay rail items render only when both the
  // persona is 'manager' AND an overlay handler bag is threaded through.
  // Props-driven; no hard-coded persona check in the embed layer.
  const isManagerOverlay = persona === 'manager' && managerOverlay != null;

  // Wave 33 v3.0.13 (ADR 23 D2) — when the ACTIVE opp is insurance,
  // surface the compact left-rail timeline directly inside the ctx pane
  // (between Vehicle and Related opportunities). Reads insuranceWorkflow
  // from ActiveWorkflowContext so the per-stage hover popovers can
  // surface the carrier / premium / savings / policy detail blocks.
  // The workflow is owned + seeded by InsuranceEmbed (sibling of this
  // pane); it's null on first-render before the seed effect commits and
  // the timeline degrades to timestamp-only popovers in that case
  // (handled defensively in StageRowPopover).
  const isActiveInsurance = opportunity?.type === 'insurance';
  // Wave 34 v3.0.14 (ADR 24 D5) — when the ACTIVE opp is protection (or
  // the 'vsc' alias), surface the compact step-progress timeline directly
  // in the ctx pane (between Vehicle and Related opportunities — same
  // altitude as the insurance active-opp timeline). Driven by the live
  // `protectionStepIdx` + `protectionForm` from ActiveWorkflowContext
  // (owned + seeded by the sibling ProtectionEmbed).
  const isActiveProtection =
    opportunity?.type === 'protection' || opportunity?.type === 'vsc';
  // Wave 35 v3.0.15 (ADR 25 D5) — when the ACTIVE opp is refi, surface
  // the compact step-progress timeline directly in the ctx pane (between
  // Vehicle and Related opportunities — same altitude as the protection +
  // insurance active-opp timelines). Driven by the live `refiStepIdx` +
  // `refiForm` from ActiveWorkflowContext (owned + seeded by the sibling
  // RefiAgentEmbedInner).
  const isActiveRefi = opportunity?.type === 'refi';
  const { insuranceWorkflow, protectionForm, protectionStepIdx, refiForm, refiStepIdx } =
    useActiveWorkflow();
  const primaryPhone = contact?.phones.find((p) => p.is_primary) || contact?.phones[0];
  const primaryEmail = contact?.emails.find((e) => e.is_primary) || contact?.emails[0];
  const primaryAddress =
    contact?.addresses.find((a) => a.is_primary) || contact?.addresses[0];
  const displayName = contact
    ? contact.name.preferred || `${contact.name.first} ${contact.name.last}`.trim()
    : opportunity.contact_name;

  return (
    <aside className="w-[320px] shrink-0 border-r border-slate-200 flex flex-col overflow-auto">
      <div className="px-5 py-4 border-b border-slate-200">
        <div className="flex items-center gap-2 mb-1.5">
          <span
            className={
              'inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ring-1 ring-inset ' +
              TYPE_BADGE[opportunity.type]
            }
          >
            {TYPE_LABELS[opportunity.type]}
          </span>
          <span className="text-[11px] font-mono text-slate-500 truncate">
            {opportunity.id}
          </span>
        </div>
        <div className="text-base font-semibold text-slate-900 truncate">
          {displayName}
        </div>
        <div className="text-xs text-slate-500 truncate">
          {formatVehicleLabel(vehicle) || opportunity.vehicle}
        </div>
        <div className="text-[11px] text-slate-400 mt-1">
          Open {ageLabel(ageDays(opportunity.created_at))} · owner {opportunity.owner}
        </div>
      </div>

      {isManagerOverlay && managerOverlay.onReassign && (
        <div className="px-5 py-4 border-b border-slate-200 bg-amber-50/40">
          <SectionLabel>Assignment</SectionLabel>
          <ManagerReassignControl
            opportunity={opportunity}
            onReassign={managerOverlay.onReassign}
            contacts={contacts}
          />
        </div>
      )}

      <div className="px-5 py-4 border-b border-slate-200">
        <SectionLabel>Contact</SectionLabel>
        {contact ? (
          <>
            <div className="space-y-1.5 text-sm">
              <div className="text-slate-900 font-medium">{displayName}</div>
              {primaryPhone && (
                <div className="flex items-start gap-2 text-xs text-slate-700">
                  <Phone className="w-3.5 h-3.5 mt-0.5 text-slate-400 shrink-0" />
                  <span className="font-mono truncate">
                    {formatPhone(primaryPhone.number)}
                  </span>
                </div>
              )}
              {primaryEmail && (
                <div className="flex items-start gap-2 text-xs text-slate-700">
                  <Mail className="w-3.5 h-3.5 mt-0.5 text-slate-400 shrink-0" />
                  <span className="truncate">{primaryEmail.address}</span>
                </div>
              )}
              {primaryAddress && (
                <div className="flex items-start gap-2 text-xs text-slate-700">
                  <MapPin className="w-3.5 h-3.5 mt-0.5 text-slate-400 shrink-0" />
                  <span className="leading-relaxed">
                    {primaryAddress.line_1}, {primaryAddress.city}, {primaryAddress.state}{' '}
                    {primaryAddress.postal_code}
                  </span>
                </div>
              )}
            </div>
            {onOpenContactProfile && (
              <button
                onClick={onOpenContactProfile}
                className="mt-3 w-full text-xs font-medium px-2.5 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white inline-flex items-center justify-center gap-1.5"
              >
                <ExternalLink className="w-3 h-3" />
                View full contact profile
              </button>
            )}
          </>
        ) : (
          <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 ring-1 ring-amber-200 rounded-md p-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              No contact record for <code className="font-mono">{opportunity.contact_id}</code>.
            </span>
          </div>
        )}
      </div>

      <div className="px-5 py-4 border-b border-slate-200">
        <SectionLabel>Vehicle</SectionLabel>
        {vehicle ? (
          <div className="space-y-1.5 text-sm">
            <div className="flex items-start gap-2">
              <Car className="w-3.5 h-3.5 mt-0.5 text-slate-400 shrink-0" />
              <div className="text-slate-900 font-medium truncate">
                {formatVehicleLabel(vehicle) || '—'}
              </div>
            </div>
            <VehicleStat label="Mileage" value={
              vehicle.mileage != null
                ? `${Number(vehicle.mileage).toLocaleString()} mi`
                : null
            } />
            <VehicleStat label="VIN" value={vehicle.vin || null} mono />
            <VehicleStat label="Est. annual mileage" value={
              vehicle.annual_mileage_estimate != null
                ? `${Number(vehicle.annual_mileage_estimate).toLocaleString()} mi/yr`
                : null
            } />
            <VehicleStat label="Est. value" value={
              vehicle.value != null
                ? `$${Number(vehicle.value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : null
            } />
            <VehicleStat label="Condition" value={
              vehicle.condition
                ? String(vehicle.condition).charAt(0).toUpperCase() +
                  String(vehicle.condition).slice(1).toLowerCase()
                : null
            } />
          </div>
        ) : (
          <div className="text-xs text-slate-400">
            No vehicle yet — collected in the workflow's first step.
          </div>
        )}
        {isManagerOverlay && managerOverlay.onNoteForAgent && (
          <ManagerNoteForAgentControl
            opportunity={opportunity}
            onNoteForAgent={managerOverlay.onNoteForAgent}
          />
        )}
      </div>

      {/* Wave 33 v3.0.13 (ADR 23 D2) — active-opp insurance timeline.
          Mounts between Vehicle and Related opportunities so the agent's
          eye reads: contact → vehicle → progress → related context.
          Same component the related-opp rows use; for the active mount
          we OMIT `onOpenInCoPilot` (agent is already on the opp) and
          THREAD `workflowSnapshot` + `orgId` + `context` so popovers
          surface per-stage detail and date separators use the org TZ. */}
      {isActiveInsurance && (
        <div className="px-5 py-4 border-b border-slate-200">
          <SectionLabel>Capture+quote progress</SectionLabel>
          <RelatedInsuranceProgress
            opportunity={opportunity}
            workflowSnapshot={insuranceWorkflow}
            orgId={contact?.org_id ?? null}
            context="active_opp"
          />
        </div>
      )}

      {/* Wave 34 v3.0.14 (ADR 24 D5) — active-opp protection step
          timeline. Mounts between Vehicle and Related opportunities so
          the agent's eye reads: contact → vehicle → progress → related.
          Same component the related-opp rows use; for the active mount
          we OMIT `onOpenInCoPilot` (agent is already on the opp) and
          THREAD `currentStepIdx` (the live protectionStepIdx) +
          `protectionForm` (so buildProtectionSteps reflects conditional
          steps) + `orgId` (date-separator TZ). */}
      {isActiveProtection && (
        <div className="px-5 py-4 border-b border-slate-200">
          <SectionLabel>Workflow progress</SectionLabel>
          <RelatedProtectionProgress
            opportunity={opportunity}
            context="active_opp"
            currentStepIdx={protectionStepIdx}
            protectionForm={protectionForm}
            orgId={contact?.org_id ?? null}
          />
        </div>
      )}

      {/* Wave 35 v3.0.15 (ADR 25 D5) — active-opp refi step timeline.
          Mounts between Vehicle and Related opportunities — same altitude
          as the protection + insurance active-opp timelines. For the
          active mount we OMIT `onOpenInCoPilot` (agent is already on the
          opp) and THREAD `currentStepIdx` (the live refiStepIdx) +
          `refiForm` (so getSequence reflects conditional co-app steps) +
          `orgId` (date-separator TZ). */}
      {isActiveRefi && (
        <div className="px-5 py-4 border-b border-slate-200">
          <SectionLabel>Workflow progress</SectionLabel>
          <RelatedRefiProgress
            opportunity={opportunity}
            context="active_opp"
            currentStepIdx={refiStepIdx}
            refiForm={refiForm}
            orgId={contact?.org_id ?? null}
          />
        </div>
      )}

      <div className="px-5 py-4 border-b border-slate-200">
        <SectionLabel>Related opportunities</SectionLabel>
        {relatedOpps.length === 0 ? (
          <div className="text-xs text-slate-400">
            No other opportunities for this contact.
          </div>
        ) : (
          <ul className="space-y-2">
            {relatedOpps.map((o) => (
              <RelatedOppRow
                key={o.id}
                relatedOpp={o}
                onOpenOpportunity={onOpenOpportunity}
                orgId={contact?.org_id ?? null}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="mt-auto px-5 py-3 bg-slate-50 border-t border-slate-200 text-[10px] text-slate-500 leading-relaxed">
        Right pane embeds the source-app{' '}
        <code className="font-mono">AgentView</code> for this opportunity
        type (capture/origination, status overrides, notes, API responses).
      </div>
    </aside>
  );
}

// Wave 31 v3.0.11 (ADR 21 D4) — related-opp row.
//
// Each row renders:
//   - Type badge + status + next_action (existing layout, lifted from
//     the inline mapper that lived in OpportunityContextPane).
//   - The whole row is clickable when `onOpenOpportunity` is wired,
//     switching the active CoPilot to the related opp.
//   - When the related opp is `type === 'insurance'`, a compact
//     RelatedInsuranceProgress mini-timeline renders inline below the
//     row body. Reads capture/quote activity timestamps from
//     blinkerApi.activities.list({ opportunity_id }). The component
//     itself owns the "Open insurance CoPilot →" affordance, routed
//     through onOpenOpportunity for symmetry with the row click.
//
// Clickable styling mirrors the inbox-row hover treatment (slight
// background bump + cursor-pointer). Non-clickable rows keep the
// original flat slate-50 look so the affordance only appears when the
// host can actually act on it.
function RelatedOppRow({ relatedOpp, onOpenOpportunity, orgId }) {
  const clickable = typeof onOpenOpportunity === 'function';
  function handleRowClick(e) {
    if (!clickable) return;
    // Guard against double-fire when the click originated on the inline
    // "Open insurance CoPilot →" button inside RelatedInsuranceProgress
    // (the button has its own handler; bubbling reaches us here too).
    if (e?.target && typeof e.target.closest === 'function') {
      if (e.target.closest('button')) return;
    }
    track('mc.copilot.related_opp.clicked', {
      related_opp_id: relatedOpp.id,
      related_opp_type: relatedOpp.type,
      related_opp_status: relatedOpp.status,
    });
    onOpenOpportunity(relatedOpp.id);
  }
  function handleProgressClick(oppId) {
    if (!clickable) return;
    track('mc.copilot.related_insurance_progress.clicked', {
      related_insurance_opp_id: oppId,
    });
    onOpenOpportunity(oppId);
  }
  return (
    <li
      className={
        'text-xs rounded-md p-2 ' +
        (clickable
          ? 'bg-slate-50 hover:bg-slate-100 cursor-pointer'
          : 'bg-slate-50')
      }
      onClick={handleRowClick}
    >
      <div className="flex items-start gap-2">
        <Link2 className="w-3.5 h-3.5 mt-0.5 text-slate-400 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={
                'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ring-1 ring-inset ' +
                TYPE_BADGE[relatedOpp.type]
              }
            >
              {TYPE_LABELS[relatedOpp.type]}
            </span>
            <span className="text-slate-500 truncate">{relatedOpp.status}</span>
          </div>
          <div className="text-slate-600 truncate mt-0.5">
            {relatedOpp.next_action}
          </div>
        </div>
      </div>
      {relatedOpp.type === 'insurance' && (
        <RelatedInsuranceProgress
          opportunity={relatedOpp}
          orgId={orgId ?? null}
          onOpenInCoPilot={
            clickable
              ? (oppId) => {
                  // Stop the wrapping row's click handler from also
                  // firing (it would double-emit telemetry). We can't
                  // attach a stopPropagation here directly since the
                  // child component is canonical; instead we route the
                  // event through a distinct handler that knows it
                  // came from the inline progress link.
                  handleProgressClick(oppId);
                }
              : undefined
          }
        />
      )}
      {/* Wave 34 v3.0.14 (ADR 24 D5) — related-opp protection step
          timeline. Mirrors the insurance related-opp mount above. No
          live form/index — RelatedProtectionProgress derives the current
          step from `relatedOpp.status` via stepFromStatus and reads
          step_change activity timestamps, with `protection_progress` as
          the furthest-step fallback. `onOpenInCoPilot` routes through the
          same distinct handler so the wrapping row's click doesn't
          double-emit. The 'vsc' type alias is handled too. */}
      {(relatedOpp.type === 'protection' || relatedOpp.type === 'vsc') && (
        <RelatedProtectionProgress
          opportunity={relatedOpp}
          context="related_opp"
          protectionProgress={relatedOpp.protection_progress || null}
          orgId={orgId ?? null}
          onOpenInCoPilot={
            clickable ? (oppId) => handleProgressClick(oppId) : undefined
          }
        />
      )}
      {/* Wave 35 v3.0.15 (ADR 25 D5) — related-opp refi step timeline.
          Mirrors the protection related-opp mount above. No live
          form/index — RelatedRefiProgress derives the current step from
          `relatedOpp.status` via stepFromStatus and reads `step_change`
          activity timestamps (filtered to workflow_type === 'refi'), with
          `refi_progress` as the furthest-step fallback. `onOpenInCoPilot`
          routes through the same distinct handler so the wrapping row's
          click doesn't double-emit. */}
      {relatedOpp.type === 'refi' && (
        <RelatedRefiProgress
          opportunity={relatedOpp}
          context="related_opp"
          refiProgress={relatedOpp.refi_progress || null}
          orgId={orgId ?? null}
          onOpenInCoPilot={
            clickable ? (oppId) => handleProgressClick(oppId) : undefined
          }
        />
      )}
    </li>
  );
}

function SectionLabel({ children }) {
  return (
    <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-2">
      {children}
    </div>
  );
}

function VehicleStat({ label, value, mono = false }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className={'text-slate-900 truncate text-right ' + (mono ? 'font-mono' : '')}>
        {value}
      </span>
    </div>
  );
}

// Wave 28d / Wave 29a — manager overlay: scored reassign dropdown.
// Renders AgentPicker (inline) under an "Assigned to <owner>" label.
// The contact map for source-org resolution is read from props (threaded
// down from AgentInbox); when absent, the picker treats the opp as having
// no source org and falls back to flat (no-grouping) rendering.
function ManagerReassignControl({ opportunity, onReassign, contacts }) {
  const eligibleAgents = useMemo(
    () => blinkerApi.agents.list().filter((a) => a.persona === 'agent'),
    [],
  );
  const sourceOrgPolicy = useMemo(
    () => reduceSourceOrgPolicy([opportunity], contacts || {}),
    [opportunity, contacts],
  );
  function handleAssign(agentId, info) {
    onReassign(opportunity.id, agentId, info);
  }
  return (
    <div className="space-y-2">
      <div className="text-sm text-slate-700 flex items-center gap-1.5">
        <UserCog className="w-3.5 h-3.5 text-slate-400" />
        <span>Assigned to</span>
        <span className="font-medium text-slate-900">
          {opportunity.owner || 'Unassigned'}
        </span>
      </div>
      <AgentPicker
        placement="inline"
        surface="copilot"
        selectedOpps={[opportunity]}
        eligibleAgents={eligibleAgents}
        sourceOrgPolicy={sourceOrgPolicy}
        contacts={contacts || {}}
        onAssign={handleAssign}
        triggerLabel="Reassign…"
      />
    </div>
  );
}

// Wave 28d — manager overlay: inline composer for a coaching note tied
// to the agent who owns this opportunity. Routes through to
// blinkerApi.agents.addCoachingNote via the caller's overlay bag.
function ManagerNoteForAgentControl({ opportunity, onNoteForAgent }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const ownerId = opportunity.owner_id || _resolveOwnerIdByName(opportunity.owner);
  const canSave = body.trim().length > 0 && ownerId;
  function save() {
    if (!canSave) return;
    onNoteForAgent(opportunity.id, ownerId, body.trim());
    setBody('');
    setOpen(false);
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 w-full text-xs font-medium px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 inline-flex items-center justify-center gap-1.5"
      >
        <MessageSquare className="w-3 h-3" />
        + Note for agent
      </button>
    );
  }
  return (
    <div className="mt-3 space-y-1.5">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder={`Coaching note for ${opportunity.owner || 'agent'}…`}
        className="w-full text-xs border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        autoFocus
      />
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() => {
            setBody('');
            setOpen(false);
          }}
          className="text-xs text-slate-600 hover:text-slate-900 px-2 py-1 rounded-md border border-slate-200 bg-white"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="text-xs text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600 px-2 py-1 rounded-md font-medium"
        >
          Save note
        </button>
      </div>
    </div>
  );
}

// Owner-name → agent-id fallback. fixtures don't carry `owner_id` on the
// opportunity yet (queued for the Phase 2 mutation lift), so we resolve
// by name against the agents SDK. Cheap; the agents list is tiny.
function _resolveOwnerIdByName(name) {
  if (!name) return null;
  const hit = blinkerApi.agents.list().find((a) => a.name === name);
  return hit ? hit.id : null;
}

function formatPhone(e164) {
  if (!e164) return '—';
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (m) return `(${m[1]}) ${m[2]}-${m[3]}`;
  return e164;
}
