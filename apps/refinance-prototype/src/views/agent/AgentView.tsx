// AgentView — the refi-portal agent shell. Composes the customer
// RefiWizard inside agent chrome rather than duplicating any screens.
//
// Layout:
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
//   * persona — UI-only. Passed by the parent (mission-control's
//     CoPilotPane) via prop; fixed for the lifetime of the view now
//     that the top-bar switcher is gone.
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
import { useEffect, useMemo, useState } from 'react';
import type { FC } from 'react';
import { useForm } from '../../hooks/useForm';
import { loadOpportunity, saveOpportunity } from '../../lib/draftStore';
import { RefiWizard } from '../customer/RefiWizard';
import { REFI_STATUS } from './CaptureLinkForm';
import { SaveAndSendFooter } from './AgentChrome';
import { TagPicker } from 'blinker-platform/components';
import { NotesCard } from './NotesCard';
import type { NoteEntry } from '../../lib/blinkerWrite';
import { resolveWriteContext } from '../../lib/blinkerWrite';
import { fetchPackageStatus } from '../../utils/api';
import { getSequence } from '../../lib/refi';
import personasJson from '../../constants/canon/personas.json';
import type { RefiForm, WizardDevOptions, Persona, Opportunity, StepChangeContext } from '../../types';

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
  beforeStepChange?: (ctx: StepChangeContext) => void;
  // Agent notes — real-backend handlers (blinkerWrite) + availability flag.
  // Notes attach to the handed-off ProductPackage and are authored by the
  // agent, so MissionControl shows them on the package page.
  notesEnabled?: boolean;
  onLoadNotes?: () => Promise<NoteEntry[]>;
  onCreateNote?: (body: string) => Promise<NoteEntry | null>;
}

const INITIAL_OPPORTUNITY: Opportunity = {
  status: REFI_STATUS.EMPTY,
};

export const AgentView: FC<AgentViewProps> = ({
  persona: personaProp,
  // personaLocked stays in the props contract (mission-control passes it)
  // but is no longer consumed here — the top-bar persona switcher it gated
  // has been removed.
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
  // Per-section MC write-back hook (from App → ViewSwitcher). Threaded into
  // RefiWizard so advancing past Vehicle/Personal/Address pushes edits back.
  beforeStepChange,
  // Agent notes — real-backend handlers + availability flag (set by App).
  notesEnabled = false,
  onLoadNotes,
  onCreateNote,
}) => {
  // Agent-side opportunity state — distinct from form because the
  // capture link + status are agent-only metadata. Seeded from localStorage
  // so a reload keeps the agent in the wizard instead of the capture gate.
  const [opportunity, updateOpportunity] = useForm(loadOpportunity() ?? INITIAL_OPPORTUNITY);

  // Persist the opportunity on every change so it survives reloads.
  useEffect(() => {
    saveOpportunity(opportunity);
  }, [opportunity]);

  // Persona is fixed for the lifetime of the view now that the top-bar
  // switcher is gone; it still drives tag permissions + persona-scoped UI.
  const [persona] = useState(personaProp || 'agent');

  // ---- Remittance lock ----------------------------------------------------
  // blinker freezes a Vehicle once any ProductPackage attached to it is
  // `remitted` (Vehicle#remittance_locked?) and the RemittanceLock concern
  // raises RemittedRecordError on write. Resolve that state once so the wizard
  // can render the vehicle fields read-only instead of letting the agent edit
  // values whose save is guaranteed to be rejected.
  //
  // FAIL OPEN: any error (404 / network / no user_id in the hand-off) leaves
  // this false. blinker remains the enforcement point, so the cost of a missed
  // lock is a rejected save with a clear message — whereas a false lock would
  // freeze a normal session with no way out.
  const [vehicleLocked, setVehicleLocked] = useState(false);
  useEffect(() => {
    const ctx = resolveWriteContext();
    if (!ctx.enabled || !ctx.userId || !ctx.vehicleId) return;
    let cancelled = false;
    fetchPackageStatus({
      apiBase: ctx.apiBase,
      token: ctx.token,
      userId: ctx.userId,
      vehicleId: ctx.vehicleId,
    }).then((res) => {
      if (cancelled || !res.remitted) return;
      setVehicleLocked(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Sequence preview for SaveAndSendFooter's deep-link step key. We
  // recompute from the live form so co-app branching reflects in the
  // current step name (matches RefiWizard's internal calculation).
  const sequence = useMemo(
    () => getSequence(form || {}, form?.hasCoApplicant === true, { includeCoAppDecision: true }),
    [form]
  );
  const currentStepKey = sequence[Math.min(stepIdx, sequence.length - 1)] || 'vehicle_add';

  // Notes are rendered by the refi-local NotesCard, wired to the real blinker
  // backend (onLoadNotes/onCreateNote from App → ProductPackage notes that MC
  // shows). Tags stay here: parent-owned form-slice + a standalone TagPicker
  // (the shared NotesPanel used to bundle both; we split them so notes can
  // round-trip to the backend while tags keep their session behavior).
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
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div>
          {/* Capture-link gate hidden — agents go straight into the wizard. */}
          <RefiWizard
            form={form}
            update={updateForm}
            stepIdx={stepIdx}
            setStepIdx={setStepIdx}
            dev={dev}
            beforeStepChange={beforeStepChange}
            // Agent flow surfaces the co-applicant decision step so the agent
            // can capture co-app data and pass it to Stage 2.
            includeCoAppDecision
            vehicleLocked={vehicleLocked}
          />
          <SaveAndSendFooter
            opportunity={opportunity}
            currentStepKey={currentStepKey}
            sentSummary={opportunity.sentSummary}
            onSent={(s) => updateOpportunity({ sentSummary: s })}
          />
        </div>
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-100">
              <span className="text-xs uppercase tracking-wide font-semibold text-slate-600">
                Contact tags
              </span>
            </div>
            <div className="p-3">
              <TagPicker
                selectedTagIds={selectedTagIds}
                onAdd={handleTagAdd}
                onRemove={handleTagRemove}
                onCreate={handleTagCreate}
                canAdd={canAddTags}
                canCreate={canCreateTags}
                orgId={tagsOrgId}
                persona={persona}
                sessionCreated={sessionCreatedTags}
                trackingPrefix="refi.agent.tag_picker"
              />
            </div>
          </div>
          <NotesCard
            enabled={notesEnabled && !!onLoadNotes && !!onCreateNote}
            onLoad={onLoadNotes ?? (async () => [])}
            onCreate={onCreateNote ?? (async () => null)}
          />
        </div>
      </div>
    </>
  );
};
