// Agent view: lead-origination form pre-send → LEAD STATUS + Notes/Tags
// post-send (Wave 13c layout swap, mirrors protection-portal AgentView's
// two-column shell).
//
// Layout:
//   Pre-send (workflow.consumer_link.sentAt is null):
//     ┌─ Single column ─────────────────────────────┐
//     │ LeadOriginationForm                         │
//     └─────────────────────────────────────────────┘
//
//   Post-send (workflow.consumer_link.sentAt is set):
//     ┌─ LEFT 1fr ──────────────┐  ┌─ RIGHT 360px ──────┐
//     │ LeadStatusTimeline      │  │ NotesPanel + tags  │
//     │ ConsumerLinkPanel       │  │                    │
//     └─────────────────────────┘  └────────────────────┘
//
// Two-sided demo: this view originates leads against EI (mocked), then
// listens for partner webhooks to drive the timeline. The customer
// simulator (?view=customer) stands in for EI's microsite — opening
// the consumer link in the same tab via "Open as consumer" lets you
// drive the flow end-to-end. Cross-tab won't propagate because each
// tab has its own in-memory subscriber map in the mock.
//
// Status transition timestamps are tracked locally so the timeline
// can render "past" times without bloating the workflow shape with
// agent-only state.
//
// Persona note: insurance-portal does not currently render a persona
// switcher of its own (unlike protection-portal). The `persona` /
// `personaLocked` props exist to satisfy the platform embed contract
// (architecture/02-integration-boundaries.md) so mission-control can
// embed AgentView in CoPilotPane. Today `persona` is threaded into
// PostHog events as a property; `personaLocked` is accepted but has
// no UI to suppress yet — wire it through if/when a local switcher
// is added.
//
// `mode` prop (Wave 13-fu-2): 'agent' (default) | 'lean'. AgentView is
// the only public surface (LeadOriginationForm + LeadStatusTimeline +
// ConsumerLinkPanel are private), so consumer-facing embedders like
// protection-portal's CrossSellSubFlow mount AgentView directly. In
// that consumer context NotesPanel is harmless but cluttered, so lean
// mode suppresses it pre-send AND post-send, and collapses the post-
// send layout to single-column (LeadStatusTimeline + ConsumerLinkPanel,
// no right rail). Default 'agent' keeps every existing call site
// (mission-control CoPilotPane, standalone insurance-portal AgentView)
// byte-identical.
//
// `availableStatuses` prop (Wave 14-fu): optional array of insurance
// machine_ids (e.g. ['capture.completed', 'quote.completed', ...])
// that overrides the canon-derived list inside the AgentForceStatusBar
// post-send picker. When unset / empty, the picker falls back to canon
// (today's behavior, fully backwards compatible). Mission-control's
// CoPilotPane populates this from the operator's local status mapping
// (`mc.status-mapping.v1`) — see also Wave 13-fu-1 of protection-portal
// AgentTopBar for the parallel pattern.
//
// `showOriginationForm` prop (Wave 16 F6): defaults `true` for back-compat
// with every existing call site (standalone insurance-portal AgentView,
// mission-control CoPilotPane). When passed `false`, AgentView suppresses
// LeadOriginationForm rendering entirely — the embedder owns its own
// Confirm-contact UX (e.g. protection-portal's CrossSellSubFlow renders
// its own form before mounting AgentView). The post-send timeline +
// ConsumerLinkPanel + quote.completed watcher remain mounted so the
// embedder still gets cross-sell completion signal when the consumer
// finishes the EI microsite. Cross-repo contract: prop name is fixed
// — protection-portal passes `showOriginationForm={false}` literally.
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { NotesPanel, WizardShell } from 'blinker-platform/components';
import { LeadOriginationForm } from './LeadOriginationForm.jsx';
import { LeadStatusTimeline } from './LeadStatusTimeline.jsx';
import { ConsumerLinkPanel } from './ConsumerLinkPanel.jsx';
import { AgentForceStatusBar } from './AgentForceStatusBar.jsx';
import { ApiResponsesModal } from './ApiResponsesModal.jsx';
import { STATUS } from '../../constants/status-map.js';
import { captureEvent } from 'blinker-platform/telemetry';
import personasJson from '../../constants/canon/personas.json';

// Vehicle pre-step (Wave 16 F2-fu): when an embedded opp arrives without
// a vehicle attached (or with a YMMT-only vehicle that has no VIN), the
// agent collects VIN + YMMT here BEFORE the LeadOriginationForm renders.
// Using refi-portal's public ScreenVehicleAdd (the same UI that
// refi/protection consumer flows use) so the agent and consumer flows
// match. The gate also fires when the incoming vehicle prop is partial
// (vin is null or shorter than 17 chars) — e.g. protection-portal's
// YMMT-only vehicle step hands us year/make/model/trim but no VIN, and
// EI requires a full VIN to originate a lead.
//
// TODO(packages-lift): hoist this surface to packages/components/
// VehicleAddOrConfirm once a 3rd consumer appears OR once we're ready
// to also lift fetchVinDecode + YMMT_DATA + YmmtPicker (the upstream
// component's transitive deps). Re-adding refi-portal as a `file:` dep
// is the tactical step; the strategic step is the full lift.
const VehicleAdd = lazy(() =>
  import('refi-portal/src/views/customer').then((m) => ({ default: m.VehicleAdd }))
);

// VehicleDrive pre-step (Wave 31a-fu): collect mileage / condition /
// purchase_date before generating the EI lead-origination link. Reuses the
// customer-simulator VehicleDrive wrapper in mode='local' so there is one
// shared component for both paths. Fired when effectiveVehicle has a VIN
// but no mileage — covers the cross-sell case (protection hands us YMMT+VIN
// without drive data) as well as the no-vehicle-at-all flow (VehicleAdd runs
// first, then this step fires because collectedVehicle won't have mileage).
import { VehicleDrive as VehicleDriveStep } from '../customer/VehicleDrive.jsx';

// CurrentInsuranceGate pre-step (Wave 36 v3.0.14 — ADR 26 D3): the new
// step 3, inserted AFTER the VehicleDrive (mileage) gate and BEFORE the
// LeadOriginationForm. Shown ONLY when the active opp's flow path is
// `quote_only` — the quote-only path skips EI's policy capture, so EI
// never returns a savings comparison; this step collects the customer's
// self-reported current carrier + premium so the savings math has a
// baseline. Capture+quote keeps its existing two-gate sequence.
import { CurrentInsuranceGate } from './CurrentInsuranceGate.jsx';

// buildInitialVehicleForm: pre-fills year/make/model/trim from the
// upstream vehicle prop (e.g. protection-portal cross-sell passes YMMT
// without a VIN). The consumer / agent only needs to enter the VIN —
// VIN decode then confirms / corrects the YMMT.
function buildInitialVehicleForm(vehicle) {
  return {
    vin: vehicle?.vin || '',
    year: vehicle?.year || null,
    make: vehicle?.make || '',
    model: vehicle?.model || '',
    trim: vehicle?.trim || '',
    vinDecoded: false,
    vinDecodeLoading: false,
    vinDecodeError: null,
    _lastDecodedVin: null,
  };
}

// Personas that get the production force-status picker. Consumer never
// sees it; lean mode (consumer-context embedders) suppresses it
// independently. Order doesn't matter — used as a Set membership check.
const FORCE_STATUS_PERSONAS = new Set([
  'agent',
  'manager',
  'admin',
  'super_admin',
]);

export function AgentView({
  workflow,
  updateWorkflow,
  dev,
  persona = 'agent',
  // eslint-disable-next-line no-unused-vars
  personaLocked = false,
  contact,
  vehicle,
  mode = 'agent',
  availableStatuses,
  showOriginationForm = true,
  // Wave 33 D5 — when true, suppresses LeadStatusTimeline in the post-send
  // composition and restructures the right-pane layout. Default false keeps
  // standalone insurance-portal behavior bit-for-bit identical.
  // mc CoPilotPane passes true whenever the active opp is insurance + post-send
  // (D1 of ADR 23) so the compact left-rail timeline (D2) can take focus
  // without doubling the full timeline in the right pane.
  hideLeadStatusTimeline = false,
  // Wave 33 v3.0.13 — optional React node injected by mc CoPilotPane into
  // the hideLeadStatusTimeline branch's left column, above ConsumerLinkPanel.
  // mc passes <InsuranceSavingsCard …/> ("Insurance at a glance") here per the
  // v3.0.13 mockup (PDF page 2). Defaults to null so standalone insurance-portal
  // layout is byte-identical to pre-Wave-33 behavior.
  savingsCardSlot = null,
  // Wave 16 F2-fu12-insurance — fired when the VehicleAdd pre-step
  // commits a vehicle locally. Optional; standalone callers (App.jsx,
  // mc CoPilotPane pre-fix, protection-portal CrossSellSubFlow) leave
  // undefined and the observer below becomes a no-op. Cross-repo
  // contract: mission-control's CoPilotPane consumes this to push the
  // vehicle up to its session contacts so the left "Vehicle" pane
  // reflects the real state once the pre-step settles.
  onVehicleCommitted,
}) {
  const isLean = mode === 'lean';
  const [history, setHistory] = useState([]);
  const lastSeenStatus = useRef(null);

  // Wave 31a-fu3 — stepTotal pinned at mount via lazy initializer.
  // mc's onVehicleCommitted handler patches the upstream `vehicle` prop
  // with a VIN after Gate 1 (VehicleAdd) commits — without pinning, the
  // inline computation would see the updated prop and recompute to 2
  // while Gate 2 (VehicleDrive) is still on-screen (shows "1/2" not "2/3").
  // Lazy initializer runs once at first render; React strict-mode double-
  // invoke of the updater is safe because lazy initializers still only
  // run once. If parent supplies a new `key`, the component remounts and
  // stepTotal is recomputed against the new upstream state — correct.
  //
  // Wave 36 v3.0.14 — the quote-only path adds a CurrentInsuranceGate
  // step after the mileage gate (+1) when the workflow doesn't already
  // carry self-reported current-insurance data. capture+quote is unchanged.
  const [stepTotal] = useState(() => {
    const upstreamHasVinAtMount = Boolean(vehicle?.vin && vehicle.vin.length === 17);
    const upstreamHasMileageAtMount = Boolean(upstreamHasVinAtMount && vehicle?.mileage);
    const base = (!!contact && !upstreamHasVinAtMount) ? 3
               : (!upstreamHasMileageAtMount && upstreamHasVinAtMount) ? 2
               : 1;
    const isQuoteOnly = workflow?.flowPath === 'quote_only';
    const currentInsuranceAlreadyKnown = Boolean(workflow?.currentCarrierId);
    return base + (isQuoteOnly && !currentInsuranceAlreadyKnown ? 1 : 0);
  });
  // API Responses modal open/close — owned here so the modal mount
  // lives next to AgentView's other top-level state (history,
  // notesPanel) and survives layout flips between pre/post-send.
  const [apiResponsesOpen, setApiResponsesOpen] = useState(false);

  // Vehicle pre-step state (Wave 16 F2-fu / Wave 31a-fu).
  //
  // `vehicleForm` — in-flight VIN/YMMT entry (VehicleAdd step), seeded from
  //   the incoming vehicle prop so upstream YMMT is pre-filled.
  // `collectedVehicle` — the committed object carrying VIN+YMMT and, after
  //   the VehicleDrive step, also mileage/condition/purchase_date/
  //   annual_miles_estimate. Prefer collectedVehicle over the upstream vehicle
  //   prop so once-committed values don't trip the gate on re-render.
  //
  // Two-step commit:
  //   commitVehicle()       — writes VIN+YMMT; called by VehicleAdd onNext.
  //   commitDriveStep(data) — merges drive fields onto collectedVehicle;
  //                           called by VehicleDrive onCommit.
  //
  // effectiveVehicle = collectedVehicle || vehicle (resolved below near gates).
  const [vehicleForm, setVehicleForm] = useState(() => buildInitialVehicleForm(vehicle));
  const [collectedVehicle, setCollectedVehicle] = useState(null);

  // Current-insurance pre-step (Wave 36 v3.0.14 — ADR 26 D3). Tracks
  // whether the agent has committed the CurrentInsuranceGate this session.
  // Seeded true when the workflow already carries the data (e.g. the agent
  // navigated forward then back, or an upstream surface pre-filled it) so
  // the gate doesn't re-prompt. CurrentInsuranceGate writes the four
  // currentCarrier* / premium* fields to the workflow root on continue.
  const [currentInsuranceDone, setCurrentInsuranceDone] = useState(
    Boolean(workflow?.currentCarrierId),
  );
  const updateVehicleForm = (patch) =>
    setVehicleForm((prev) => ({ ...prev, ...patch }));
  function commitVehicle() {
    // Merge locally entered VIN/decoded YMMT with upstream prop YMMT so
    // a YMMT-only cross-sell vehicle (year/make/model/trim from protection-
    // portal) survives even if the VIN decode doesn't override those fields.
    // Note: mileage fields intentionally absent here — VehicleDrive step
    // writes them via commitDriveStep below.
    const v = {
      vin: vehicleForm.vin || null,
      year: vehicleForm.year || vehicle?.year || null,
      make: vehicleForm.make || vehicle?.make || null,
      model: vehicleForm.model || vehicle?.model || null,
      trim: vehicleForm.trim || vehicle?.trim || null,
    };
    setCollectedVehicle(v);
    captureEvent('insurance.agent.vehicle_pre_step_completed', {
      persona,
      has_vin: Boolean(v.vin),
      prefilled_ymmt: Boolean(vehicle?.year && vehicle?.make && vehicle?.model),
    });
  }
  function commitDriveStep(driveData) {
    // Merge drive fields onto the existing collectedVehicle (which carries
    // the VIN+YMMT from commitVehicle, or the upstream vehicle prop when
    // VehicleAdd was skipped). driveData shape (Wave 31a-fu3):
    //   { mileage, condition, purchase_date, annual_miles_estimate, market_value }
    // market_value is null when MarketCheck didn't resolve; the observer's
    // onVehicleCommitted payload forwards it as-is — mc ignores null values.
    setCollectedVehicle((prev) => ({
      ...(prev || vehicle || {}),
      ...driveData,
    }));
  }

  // Wave 16 F2-fu12-insurance — observe collectedVehicle and fire
  // onVehicleCommitted whenever the pre-step VehicleAdd commits a
  // vehicle locally. Insurance's pre-step collects VIN + YMMT only
  // (no mileage / ownership / market_value — those fields aren't part
  // of the EI origination flow). Observer fires once when
  // collectedVehicle becomes truthy; mc's handler dedupes by id so
  // repeat renders are no-op patches.
  //
  // Deterministic id: xs_vin_<VIN> if VIN is present (17 chars),
  // else xs_ymmt_<Y_M_M_T> — mirrors protection-portal's pattern so
  // mc's dedupe logic works identically for both portals.
  //
  // Backward compat: standalone insurance-portal dev shell, mc
  // CoPilotPane (pre-fix), and protection-portal CrossSellSubFlow all
  // mount AgentView without onVehicleCommitted. Observer early-returns.
  useEffect(() => {
    if (typeof onVehicleCommitted !== 'function') return;
    if (!collectedVehicle) return;
    const v = collectedVehicle;
    const hasYmmt = v.year && v.make && v.model && v.trim;
    if (!hasYmmt && !v.vin) return;
    const id = v.vin
      ? `xs_vin_${v.vin}`
      : `xs_ymmt_${v.year}_${(v.make || '').replace(/\s+/g, '_')}_${(v.model || '').replace(/\s+/g, '_')}_${(v.trim || '').replace(/\s+/g, '_')}`;
    // Wave 31a-fu3 — extend payload with drive-step fields so mc's left
    // rail VEHICLE card shows mileage, condition, annual_mileage_estimate,
    // and MarketCheck value after VehicleDrive commits.
    //
    // Key translation: collectedVehicle uses `annual_miles_estimate`
    // (insurance/protection wrapper convention) but mc's CoPilotPane
    // extendable list uses `annual_mileage_estimate` (with `_mileage_` infix).
    // Translate at this boundary so mc's patch logic sees the right key.
    //
    // market_value is null when MarketCheck didn't resolve (acceptable;
    // mc's left rail only renders the row when value is non-null).
    onVehicleCommitted({
      id,
      year:  v.year  ?? null,
      make:  v.make  || '',
      model: v.model || '',
      trim:  v.trim  || '',
      vin:   v.vin   || null,
      source: v.vin ? 'vin' : 'manual',
      // drive-step fields (populated after VehicleDrive commits; null before)
      mileage:                  v.mileage                  ?? null,
      condition:                v.condition                || null,
      purchase_date:            v.purchase_date            || null,
      annual_mileage_estimate:  v.annual_miles_estimate    ?? null,
      market_value:             v.market_value             ?? null,
    });
  }, [
    onVehicleCommitted,
    collectedVehicle,
    collectedVehicle?.vin,
    collectedVehicle?.year,
    collectedVehicle?.make,
    collectedVehicle?.model,
    collectedVehicle?.trim,
    collectedVehicle?.mileage,
    collectedVehicle?.condition,
    collectedVehicle?.purchase_date,
    collectedVehicle?.annual_miles_estimate,
    collectedVehicle?.market_value,
  ]);

  function onOpenApiResponses() {
    setApiResponsesOpen(true);
    captureEvent('insurance.agent.api_responses_opened', {
      persona,
      lead_id: workflow?.lead?.leadId || null,
      status: workflow?.status || null,
    });
  }

  useEffect(() => {
    const status = workflow?.status;
    if (status === lastSeenStatus.current) return;
    lastSeenStatus.current = status;
    setHistory((prev) => {
      if (status === STATUS.NOT_STARTED) return [];
      if (prev.some((h) => h.machineId === status)) return prev;
      return [...prev, { machineId: status, at: new Date().toISOString() }];
    });
  }, [workflow?.status]);

  const unsubRef = useRef(null);
  useEffect(() => () => { unsubRef.current?.(); }, []);
  function registerUnsub(unsub) {
    unsubRef.current?.();
    unsubRef.current = unsub;
  }

  // Persona-derived tag permissions (canon source of truth).
  const perms = personasJson?.personas?.[persona]?.permissions ?? [];
  const canAddTags = perms.includes('add_tags');
  const canCreateTags = perms.includes('create_tags');

  const selectedTagIds = workflow?.tags ?? [];
  const sessionCreatedTags = workflow?.tagsCreated ?? [];

  // Wave 13c: hide the LEAD STATUS timeline until the agent clicks "Send
  // link". Signal source = workflow.consumer_link.sentAt being non-null
  // (set explicitly in LeadOriginationForm.onSend on the same render
  // as the link-sent status transition). Cleaner than checking the
  // status enum because the form mutates both atomically and sentAt is
  // a single boolean read; status would require an `includes()` against
  // the post-send list that already lives inside LeadOriginationForm.
  // Standalone (insurance-portal dev shell) and embedded (mission-control
  // / protection-portal cross-sell) both drive the workflow shape via
  // updateWorkflow, so both modes flip this signal correctly.
  const isLinkSent = Boolean(workflow?.consumer_link?.sentAt);

  // Shared NotesPanel mount — identical pre/post-send so notes + tags
  // entered before the link is sent survive the layout flip. (Notes
  // live on workflow, which the parent owns.) Lifted to a const so
  // the pre-send single-column and post-send two-column branches both
  // render the exact same component.
  //
  // In lean mode (consumer-facing embedders like protection-portal's
  // CrossSellSubFlow), NotesPanel is suppressed entirely — agent-only
  // surface that would clutter a consumer context.
  const notesPanel = isLean ? null : (
    <NotesPanel
      contactId={contact?.id}
      opportunityId={workflow?.lead?.leadId || workflow?.id}
      authorId="agent_session"
      showTags
      selectedTagIds={selectedTagIds}
      onTagAdd={(id) => updateWorkflow({ tags: [...selectedTagIds, id] })}
      onTagRemove={(id) => updateWorkflow({ tags: selectedTagIds.filter((t) => t !== id) })}
      onTagCreate={(tag) => updateWorkflow({
        tagsCreated: [...sessionCreatedTags, tag],
        tags: [...selectedTagIds, tag.id],
      })}
      canAddTags={canAddTags}
      canCreateTags={canCreateTags}
      sessionCreatedTags={sessionCreatedTags}
      orgId={workflow?.orgId ?? undefined}
      persona={persona}
      trackingPrefix="insurance.agent"
    />
  );

  // Pre-send: two-column shell (form/pre-step on the left, NotesPanel on
  // the right) so notes/tags entered during contact-confirmation survive
  // the layout flip into post-send. Lean mode (cross-sell embedders) keeps
  // single-column — NotesPanel is agent-only chrome.
  //
  // showOriginationForm={false} (Wave 16 F6): suppress LeadOriginationForm
  // entirely — the embedder (e.g. protection-portal CrossSellSubFlow)
  // owns its own Confirm-contact UX and drives updateWorkflow itself.
  // The status-history watcher useEffect above keeps running regardless
  // (it's outside this conditional), so the post-send branches still
  // light up correctly when the embedder flips consumer_link.sentAt.
  if (!isLinkSent) {
    if (!showOriginationForm) {
      // Render-nothing branch: embedder is driving its own form. The
      // top-level useEffect still tracks workflow.status into history,
      // and unsubRef cleanup still runs on unmount — so once the
      // embedder triggers a link-sent transition, the post-send layout
      // takes over with full timeline state intact.
      return null;
    }
    // Vehicle pre-step gates (Wave 16 F2-fu / Wave 16 F2-fu10 / Wave 31a-fu):
    //
    // Gate 1 — VehicleAdd: fires when the embedder hands us a contact but
    //   either (a) no vehicle at all, or (b) a partial vehicle with no VIN
    //   (e.g. protection-portal YMMT-only cross-sell). EI requires a 17-char
    //   VIN to originate a lead. The standalone dev shell (no contact + no
    //   vehicle) keeps its legacy behavior of dropping straight into
    //   LeadOriginationForm with mock prefill.
    //
    // Gate 2 — VehicleDrive: fires after Gate 1 clears (VIN present) but
    //   mileage is still unknown. mileage + annual_miles_estimate are real
    //   EI underwriting inputs (ADR 21 D2); the agent must collect them
    //   before generating the lead-origination link.
    //
    // Step counter math (dynamic, 1–3 steps):
    //   needsVehicleStep=true  → steps: VehicleAdd (1/3), VehicleDrive (2/3),
    //                            LeadOriginationForm (3/3)
    //   needsVehicleStep=false, needsDriveStep=true
    //                          → steps: VehicleDrive (1/2),
    //                            LeadOriginationForm (2/2)
    //   both false             → LeadOriginationForm (1/1) — fully prefilled
    //
    // Prefer collectedVehicle (locally committed pre-step) over the upstream
    // vehicle prop so once-committed values don't trip the gate on re-render.
    const effectiveVehicle = collectedVehicle || vehicle;
    const vehicleHasVin = Boolean(effectiveVehicle?.vin && effectiveVehicle.vin.length === 17);
    const needsVehicleStep = !!contact && !vehicleHasVin;
    const needsDriveStep   = vehicleHasVin && !effectiveVehicle?.mileage;

    // Gate 3 — CurrentInsuranceGate (Wave 36 v3.0.14 — ADR 26 D3):
    // fires after the vehicle gates clear, when the active opp's flow
    // path is `quote_only` and the current-insurance data hasn't been
    // collected yet (this session or pre-seeded on the workflow).
    // capture+quote never enters this gate — EI's capture step surfaces
    // the current carrier there.
    const isQuoteOnly = workflow?.flowPath === 'quote_only';
    const needsCurrentInsuranceStep =
      !needsVehicleStep &&
      !needsDriveStep &&
      isQuoteOnly &&
      !currentInsuranceDone;

    // Compute total step count from `stepTotal` — pinned at mount via a
    // lazy useState initializer (see declaration near component top).
    // Using the pinned value here (not recomputing inline) prevents the
    // counter from jumping when mc's onVehicleCommitted handler patches
    // the upstream `vehicle` prop with a VIN after Gate 1 commits — which
    // would otherwise recompute stepTotal to 2 while Gate 2 is still on-screen.

    if (needsVehicleStep) {
      const stepIndex = 1;
      const progress = Math.round((stepIndex / stepTotal) * 100);
      if (isLean) {
        return (
          <div className="space-y-6">
            <WizardShell stepIndex={stepIndex} stepTotal={stepTotal} progress={progress}>
              <Suspense
                fallback={
                  <div className="px-6 py-8 text-sm text-slate-500">Loading…</div>
                }
              >
                <VehicleAdd
                  form={vehicleForm}
                  update={updateVehicleForm}
                  onNext={commitVehicle}
                  requireVin
                />
              </Suspense>
            </WizardShell>
          </div>
        );
      }
      return (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          <div className="space-y-6">
            <WizardShell stepIndex={stepIndex} stepTotal={stepTotal} progress={progress}>
              <Suspense
                fallback={
                  <div className="px-6 py-8 text-sm text-slate-500">Loading…</div>
                }
              >
                <VehicleAdd
                  form={vehicleForm}
                  update={updateVehicleForm}
                  onNext={commitVehicle}
                  requireVin
                />
              </Suspense>
            </WizardShell>
          </div>
          <div className="space-y-4">{notesPanel}</div>
        </div>
      );
    }

    // Gate 2 — VehicleDrive: collect mileage / condition / purchase_date.
    // Uses mode='local' so it doesn't touch the workflow (not created yet
    // pre-send). commitDriveStep merges drive fields onto collectedVehicle.
    if (needsDriveStep) {
      // stepIndex in the overall sequence: 2 if stepTotal=3 (came after VehicleAdd),
      // else 1 if stepTotal=2 (VIN was already known, only drive was missing).
      const stepIndex = stepTotal === 3 ? 2 : 1;
      const progress = Math.round((stepIndex / stepTotal) * 100);
      if (isLean) {
        return (
          <div className="space-y-6">
            <WizardShell stepIndex={stepIndex} stepTotal={stepTotal} progress={progress}>
              <VehicleDriveStep
                vehicle={effectiveVehicle}
                onCommit={commitDriveStep}
                onNext={() => {}}
                mode="local"
                analyticsContext="agent"
                persona={persona}
              />
            </WizardShell>
          </div>
        );
      }
      return (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          <div className="space-y-6">
            <WizardShell stepIndex={stepIndex} stepTotal={stepTotal} progress={progress}>
              <VehicleDriveStep
                vehicle={effectiveVehicle}
                onCommit={commitDriveStep}
                onNext={() => {}}
                mode="local"
                analyticsContext="agent"
                persona={persona}
              />
            </WizardShell>
          </div>
          <div className="space-y-4">{notesPanel}</div>
        </div>
      );
    }
    // Gate 3 — CurrentInsuranceGate. The last pre-step before
    // LeadOriginationForm, so its stepIndex is stepTotal - 1 (the form
    // itself is stepTotal). Only reached on the quote_only path.
    if (needsCurrentInsuranceStep) {
      const stepIndex = stepTotal - 1;
      const progress = Math.round((stepIndex / stepTotal) * 100);
      const gate = (
        <WizardShell stepIndex={stepIndex} stepTotal={stepTotal} progress={progress}>
          <CurrentInsuranceGate
            updateWorkflow={updateWorkflow}
            persona={persona}
            onNext={() => setCurrentInsuranceDone(true)}
            initialCarrierId={workflow?.currentCarrierId ?? null}
            initialPremiumCents={workflow?.currentPremiumCents ?? null}
            initialCadence={workflow?.premiumCadence ?? '6mo'}
          />
        </WizardShell>
      );
      if (isLean) {
        return <div className="space-y-6">{gate}</div>;
      }
      return (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          <div className="space-y-6">{gate}</div>
          <div className="space-y-4">{notesPanel}</div>
        </div>
      );
    }

    if (isLean) {
      return (
        <div className="space-y-6">
          <LeadOriginationForm
            workflow={workflow}
            updateWorkflow={updateWorkflow}
            dev={dev}
            persona={persona}
            registerUnsub={registerUnsub}
            contact={contact}
            vehicle={effectiveVehicle}
          />
        </div>
      );
    }
    return (
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <div className="space-y-6">
          <LeadOriginationForm
            workflow={workflow}
            updateWorkflow={updateWorkflow}
            dev={dev}
            persona={persona}
            registerUnsub={registerUnsub}
            contact={contact}
            vehicle={effectiveVehicle}
          />
        </div>
        <div className="space-y-4">{notesPanel}</div>
      </div>
    );
  }

  // Post-send: two-column layout. LEFT = LeadStatusTimeline +
  // ConsumerLinkPanel (link + copy stays under the timeline per the
  // user's explicit request). RIGHT = NotesPanel + TagPicker (TagPicker
  // is embedded inside NotesPanel via showTags, mirroring the protection-
  // portal AgentView contract).
  //
  // Lean mode collapses the post-send shell to single-column (timeline +
  // link only). The right rail and NotesPanel are dropped entirely so
  // consumer-facing embedders get a clean status surface without agent
  // chrome. The force-status picker is also hidden in lean — it's an
  // agent-only override; consumers shouldn't see it.
  if (isLean) {
    return (
      <div className="space-y-4">
        <LeadStatusTimeline workflow={workflow} history={history} orgId={workflow?.orgId} />
        <ConsumerLinkPanel link={workflow?.consumer_link} />
      </div>
    );
  }

  // Force-status picker (Wave 14-fu) — production override that
  // replaces a subset of the dev-only "Simulate X" buttons. Rendered
  // above the timeline so the agent can see the current step + flip it
  // in the same eyeline. Persona-gated: agent / manager / admin /
  // super_admin only.
  const showForceStatusBar = FORCE_STATUS_PERSONAS.has(persona);

  // Wave 33 D5 — when hideLeadStatusTimeline is true (mc embed, active-
  // insurance-opp post-send), ForceStatusBar stays full-width above a
  // 2-column grid (left | NotesPanel+TagPicker right). Left column renders
  // savingsCardSlot (mc's InsuranceSavingsCard per v3.0.13 mockup page 2)
  // ABOVE ConsumerLinkPanel; slot is null in standalone insurance-portal so
  // the left column collapses back to ConsumerLinkPanel-only, byte-identical.
  // The timeline is omitted; mc's compact left-rail timeline (D2) takes its place.
  if (hideLeadStatusTimeline) {
    return (
      <div className="space-y-4">
        {showForceStatusBar && (
          <AgentForceStatusBar
            workflow={workflow}
            updateWorkflow={updateWorkflow}
            persona={persona}
            availableStatuses={availableStatuses}
            onOpenApiResponses={onOpenApiResponses}
          />
        )}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          <div className="space-y-4">
            {savingsCardSlot}
            <ConsumerLinkPanel link={workflow?.consumer_link} />
          </div>
          <div className="space-y-4">{notesPanel}</div>
        </div>
        {apiResponsesOpen && (
          <ApiResponsesModal
            workflow={workflow}
            persona={persona}
            onClose={() => setApiResponsesOpen(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
      <div className="space-y-4">
        {showForceStatusBar && (
          <AgentForceStatusBar
            workflow={workflow}
            updateWorkflow={updateWorkflow}
            persona={persona}
            availableStatuses={availableStatuses}
            onOpenApiResponses={onOpenApiResponses}
          />
        )}
        <LeadStatusTimeline workflow={workflow} history={history} orgId={workflow?.orgId} />
        <ConsumerLinkPanel link={workflow?.consumer_link} />
      </div>
      <div className="space-y-4">{notesPanel}</div>
      {apiResponsesOpen && (
        <ApiResponsesModal
          workflow={workflow}
          persona={persona}
          onClose={() => setApiResponsesOpen(false)}
        />
      )}
    </div>
  );
}
