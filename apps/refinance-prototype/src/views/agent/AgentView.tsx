// AgentView — the refi-portal agent shell. Composes the customer
// RefiWizard inside agent chrome rather than duplicating any screens.
//
// Layout:
//   ┌─ Top bar ───────────────────────────────────────────┐
//   │ Status pill · Force status · Persona · API responses│
//   └─────────────────────────────────────────────────────┘
//   ┌─ Main column ───────────┐   ┌─ Side column ────────┐
//   │ CaptureLinkForm (gate)  │   │ Agent notes panel    │
//   │   then RefiWizard       │   │                      │
//   │   + Save and Send       │   │                      │
//   └─────────────────────────┘   └──────────────────────┘
//
// State ownership (Phase 1.5e):
//   * form / stepIdx — owned by App.jsx and threaded through props
//     (was: owned here in Chunk C). Both customer and agent views
//     read + write the same form so DEV CONTROLS prefill applies
//     uniformly. AgentView still layers its own opportunity slice
//     on top because the capture link + status are agent-only.
//   * opportunity — agent-only metadata (id, captureLink, contact,
//     status, sentSummary). Distinct from form because the customer
//     wizard doesn't know or care about the capture link.
//   * persona / apiModalOpen — UI-only.
//
// Persona note: the persona switcher in the top bar is local to this
// view because mission-control owns the cross-app PersonaSwitcher.
// When AgentView is mounted inside mission-control's CoPilotPane via
// the `file:` import, the parent passes `persona` as a prop and the
// local switcher hides via `personaLocked`.
//
// Props (Phase 2 contact prefill):
//   * contact?: canonical Contact (blinker-domain shape) — when passed
//     by mission-control's RefiAgentEmbed, threaded into CaptureLinkForm
//     so the capture-link gate seeds with the real consumer's email +
//     primary phone instead of the Jordan/512 mock. Standalone callers
//     omit it and the mock applies — pre-Phase-2 behavior is unchanged.
//     Refi's wizard form is externally owned by the embedder (mission-
//     control's RefiAgentEmbed mirrors live form state at the wrapper
//     boundary), so AgentView only needs `contact` for the gate; no
//     `vehicle` or `onFormChange` props are exposed here.
//
// Decision wiring: useRefiPrequal() is held here so that
// ApiResponsesModal can render the full decision payload + log + offers
// even if the wizard hasn't yet hit its terminal step. The hook stays
// in `idle` until something in the wizard actually triggers
// submitPrequal — for now the standalone agent view never auto-fires
// it, so super_admin only sees the decision payload after the wizard
// completes (§ 1.5e wires submitPrequal to the wizard's terminal
// transition).
import { useEffect, useMemo, useState } from 'react';
import type { FC } from 'react';
import { useForm } from '../../hooks/useForm';
import { RefiWizard } from '../customer/RefiWizard';
import { CaptureLinkForm, REFI_STATUS } from './CaptureLinkForm';
import { AgentTopBar, SaveAndSendFooter, CanonNotice } from './AgentChrome';
import { NotesPanel } from 'blinker-platform/components';
import { ApiResponsesModal } from './ApiResponsesModal';
import { useRefiPrequal, getSequence } from '../../lib/refi';
import { track } from 'blinker-platform/telemetry';
import personasJson from '../../constants/canon/personas.json';
import type { RefiForm, WizardDevOptions, Persona, Opportunity } from '../../types';

// Derive tag permissions from canon/personas.json.
function permissionsFor(persona: Persona): string[] {
  return (personasJson.personas as Record<string, { permissions?: string[] }>)?.[persona]?.permissions ?? [];
}

interface AgentViewProps {
  persona?: Persona;
  personaLocked?: boolean;
  form: RefiForm;
  update: (updates: Partial<RefiForm>) => void;
  stepIdx: number;
  setStepIdx: (idx: number) => void;
  dev?: Partial<WizardDevOptions>;
  contact?: Record<string, unknown> | null;
  onVehicleCommitted?: (vehicle: Record<string, unknown>) => void;
}

const INITIAL_OPPORTUNITY: Opportunity = {
  status: REFI_STATUS.EMPTY,
};

export const AgentView: FC<AgentViewProps> = ({
  persona: personaProp,
  personaLocked = false,
  // Shared refi form state — owned by App.jsx in Phase 1.5e. When
  // AgentView is mounted standalone (e.g., a future test harness), the
  // caller should still pass these props; we don't fall back to local
  // state to keep ownership unambiguous.
  form,
  update: updateForm,
  stepIdx,
  setStepIdx,
  // DEV CONTROLS slice — threaded through to RefiWizard so force-
  // outcomes drive the decision engine.
  dev,
  // Phase 2: canonical Contact for prefilling the capture-link gate.
  // Passed by mission-control's RefiAgentEmbed; standalone omits.
  contact,
  // Wave 16 F2-fu12-refi — optional callback fired whenever the wizard's
  // tracked vehicle/drive fields change. Mirrors protection-portal commit
  // 750bb02 (F2-fu11-hotfix). Cross-repo contract: mission-control's
  // CoPilotPane consumes this to push the vehicle into its session
  // contacts so the left-pane Vehicle card reflects the wizard's real
  // state. Standalone callers (ViewSwitcher, dev shell) leave this
  // undefined and the observer below is a no-op.
  onVehicleCommitted,
}) => {
  // Agent-side opportunity state — distinct from form because the
  // capture link + status are agent-only metadata.
  const [opportunity, updateOpportunity] = useForm(INITIAL_OPPORTUNITY);

  // Decision payload for the API responses modal. Stays idle until the
  // wizard completes; the modal handles a null decision gracefully.
  const { decision } = useRefiPrequal({
    contactId: opportunity.id,
    vehicleId: form?.vin || undefined,
  });

  // UI state.
  const [persona, setPersonaInner] = useState(personaProp || 'agent');
  const [apiModalOpen, setApiModalOpen] = useState(false);

  function setPersona(p: Persona): void {
    if (personaLocked) return;
    setPersonaInner(p);
    track('refi.agent.persona_switched', { persona: p });
  }
  function setOpportunityStatus(next: string): void {
    updateOpportunity({ status: next });
  }

  const showWizard =
    opportunity.status !== REFI_STATUS.EMPTY && !!opportunity.captureLink;

  // Sequence preview for SaveAndSendFooter's deep-link step key. We
  // recompute from the live form so co-app branching reflects in the
  // current step name (matches RefiWizard's internal calculation).
  const sequence = useMemo(
    () => getSequence(form || {}, form?.hasCoApplicant === true),
    [form]
  );
  const currentStepKey = sequence[Math.min(stepIdx, sequence.length - 1)] || 'vehicle_add';

  function onApiResponsesOpen() {
    track('refi.agent.api_responses_viewed', {
      opportunity_id: opportunity.id,
      from_step: currentStepKey,
    });
    setApiModalOpen(true);
  }

  // NotesPanel wiring — log-mode (Wave 16 F2-fu13). NotesPanel reads +
  // writes through blinkerApi.notes internally; AgentView no longer owns
  // a notes string or passes onNotesChange. Tag state remains parent-
  // owned (form-slice on the shared refi form — flat by convention).
  const notesPerms = permissionsFor(persona);
  const canAddTags = notesPerms.includes('add_tags');
  const canCreateTags = notesPerms.includes('create_tags');
  const selectedTagIds = Array.isArray(form?.tags) ? form.tags : [];
  const sessionCreatedTags = Array.isArray(form?.tagsCreated) ? form.tagsCreated : [];
  // Sourced from form.org_id; mission-control seeds this in CoPilot, undefined in standalone refi until DEV CONTROLS exposes it.
  const tagsOrgId = form?.org_id;

  function handleTagAdd(tagId: string): void {
    if (!updateForm) return;
    if (selectedTagIds.includes(tagId)) return;
    updateForm({ tags: [...selectedTagIds, tagId] });
  }
  function handleTagRemove(tagId: string): void {
    if (!updateForm) return;
    updateForm({ tags: selectedTagIds.filter((id) => id !== tagId) });
  }
  function handleTagCreate(tag: { id: string; label: string; color?: string }): void {
    if (!updateForm) return;
    updateForm({
      tagsCreated: [...sessionCreatedTags, tag],
      tags: [...selectedTagIds, tag.id],
    });
  }

  // Wave 16 F2-fu12-refi — observe wizard form fields and fire
  // onVehicleCommitted whenever any tracked slot changes. Mirrors
  // protection-portal commit 750bb02 (F2-fu11-hotfix) in shape.
  //
  // Vehicle payload combines flat form fields (mileage, ownership) with nested form.vehicle.* fields (annual_mileage_estimate, condition, purchase_date).
  //   year/make/model/trim/vin  → form.{year,make,model,trim,vin}
  //   source                    → form.vinDecoded ? 'vin_decode'
  //                               : (form.vin ? 'manual_vin' : 'manual')
  //   mileage                   → form.mileage
  //   ownership                 → form.condition.toLowerCase()
  //   purchase_date             → form.purchaseDate
  //   market_value              → { retail: form.valuationRetailPrice,
  //                                 marketcheck: form.valuationMarketCheckPrice }
  //
  // id is deterministic: xs_vin_<VIN> or xs_ymmt_<Y_M_M_T> — same
  // scheme as protection so mc's handler dedupes / patches by id first.
  //
  // Idempotency: delegated to mc (same as protection's hotfix). The
  // handler patches an existing match in place rather than appending.
  //
  // Standalone callers (ViewSwitcher with view='agent', dev shell) leave
  // onVehicleCommitted undefined → early-return → no behavior change.
  useEffect(() => {
    if (typeof onVehicleCommitted !== 'function') return;
    const year = form?.year;
    const make = form?.make || '';
    const model = form?.model || '';
    const trim = form?.trim || '';
    const vin = form?.vin || undefined;
    const hasYmmt = year && make && model && trim;
    if (!hasYmmt && !vin) return;
    const source = form?.vinDecoded
      ? 'vin_decode'
      : (vin ? 'manual_vin' : 'manual');
    const id = vin
      ? `xs_vin_${vin}`
      : `xs_ymmt_${year}_${make.replace(/\s+/g, '_')}_${model.replace(/\s+/g, '_')}_${trim.replace(/\s+/g, '_')}`;
    const ownership =
      typeof form?.condition === 'string' && form.condition.length > 0
        ? form.condition.toLowerCase()
        : null;
    const marketcheck = form?.valuationMarketCheckPrice ?? null;
    const retail = form?.valuationRetailPrice ?? null;
    const market_value =
      marketcheck != null || retail != null
        ? { retail, marketcheck }
        : null;
    onVehicleCommitted({
      id,
      year: year ?? null,
      make,
      model,
      trim,
      vin,
      source,
      mileage: form?.mileage ?? null,
      ownership,
      condition: form?.vehicle?.condition ?? form?.condition ?? null,
      purchase_date: form?.vehicle?.purchase_date ?? form?.purchaseDate ?? null,
      annual_mileage_estimate: form?.vehicle?.annual_mileage_estimate ?? null,
      market_value,
    });
  }, [
    form?.year,
    form?.make,
    form?.model,
    form?.trim,
    form?.vin,
    form?.vinDecoded,
    form?.mileage,
    form?.condition,
    form?.purchaseDate,
    form?.vehicle?.annual_mileage_estimate,
    form?.vehicle?.condition,
    form?.vehicle?.purchase_date,
    form?.valuationMarketCheckPrice,
    form?.valuationRetailPrice,
    onVehicleCommitted,
  ]);

  return (
    <>
      <AgentTopBar
        opportunity={opportunity}
        setOpportunityStatus={setOpportunityStatus}
        persona={persona}
        setPersona={setPersona}
        personaLocked={personaLocked}
        onOpenApiResponses={onApiResponsesOpen}
      />
      <CanonNotice />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div>
          {!showWizard && (
            <CaptureLinkForm
              opportunity={opportunity}
              updateOpportunity={updateOpportunity}
              contact={contact}
            />
          )}
          {showWizard && (
            <>
              <RefiWizard
                form={form}
                update={updateForm}
                stepIdx={stepIdx}
                setStepIdx={setStepIdx}
                dev={dev}
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
        <div className="space-y-4">
          <NotesPanel
            contactId={typeof contact?.id === 'string' ? contact.id : null}
            opportunityId={opportunity.id}
            authorId="agent_session"
            showTags
            selectedTagIds={selectedTagIds}
            onTagAdd={handleTagAdd}
            onTagRemove={handleTagRemove}
            onTagCreate={handleTagCreate}
            canAddTags={canAddTags}
            canCreateTags={canCreateTags}
            sessionCreatedTags={sessionCreatedTags}
            orgId={tagsOrgId}
            persona={persona}
            trackingPrefix="refi.agent"
          />
        </div>
      </div>

      {apiModalOpen && (
        <ApiResponsesModal
          form={form}
          decision={decision}
          persona={persona}
          onClose={() => setApiModalOpen(false)}
        />
      )}
    </>
  );
};
