import { createContext, useContext } from 'react';

// ActiveWorkflowContext — lifts the "currently open CoPilot" payload up out
// of CoPilotPane so the top-level DevPanel (in App.jsx) can mirror inbound
// payload (opportunity / contact / vehicle) and live outbound state
// (form/workflow) without prop-drilling through AgentInbox.
//
// Shape:
//   active === null               → no CoPilot open
//   active === {                  → CoPilot is open
//     kind:           'protection' | 'refi' | 'insurance' | null,
//     opportunityId:  string,
//     opportunity:    object,
//     contact:        object | null,
//     vehicle:        object | null,
//     embedState:     object | null,   // protection-only live form mirror
//   }
//
// Wave 14 — per-kind dev state slices also live on this context so the
// consolidated DevPanel can mount each portal's chrome-less DevControls
// component AND the embed wrappers (CoPilotPane.jsx) can thread the same
// slice INTO the AgentView. One source of truth per kind:
//
//   protectionDev / setProtectionDev — { showInsuranceCrossSell,
//     crossSellOverrides, seedMultiContactHousehold }
//   refiDev       / setRefiDev       — RefiDevControls' devOptions slice
//     (persona, personaLocked, forcePartner, forceResult, disqualReason,
//      includeSsn, coAppOverride, showJson, prefillJson, orgConfig,
//      orgConfigJson, orgConfigError, embeddedState)
//   insuranceDev  / setInsuranceDev  — { flowPath, nextVerificationOutcome,
//      nextQuoteOutcome }
//
// Each setter accepts either a replacement object `next` OR a functional
// updater `(prev) => next` (matches the useState API) so both
// DevControls components and the App-level "patch via spread" call sites
// can drive it.
//
// Wave 14 follow-up — the refi WIZARD FORM and the insurance WORKFLOW
// also live on this context so:
//   * CoPilotPane's RefiAgentEmbedInner / InsuranceEmbed wrappers no
//     longer own the form/workflow useState locally — they read & write
//     refiForm / insuranceWorkflow directly from context.
//   * The consolidated DevPanel in App.jsx can wire the form-mutating
//     halves of RefiDevControls (`formState`, `wizardNav`) and the
//     workflow-driven `<AgentSimulators>` of InsuranceDevControls to
//     live state. With this lifted, prefill apply, plan toggles,
//     jump-to-screen, reset, and the EI agent simulators take effect
//     when the panel is mounted from mission-control's DevPanel rather
//     than from refi-portal / insurance-portal's standalone shells.
//
// Wave 14 follow-up (protection) — the protection WIZARD FORM is also
// lifted to context (mirrors refi). Protection-portal AgentView accepts
// optional `form` / `update` / `stepIdx` / `setStepIdx` props (commit
// f2ba7a5); when threaded, AgentView reads/writes the parent's state
// instead of its internal useForm fallback. ProtectionDevControls'
// Force-complete + Form-state JsonPeek sections require this lifted
// state to function in embedded mode — without it, those sections
// silently no-op.
//
// Refi form / step:
//   refiForm           : null | object   — refi-portal's flat wizard form
//                                          (INITIAL_FORM-shaped + scalar
//                                          contact + vehicle prefill).
//                                          null until CoPilotPane seeds.
//   setRefiForm        : (next | (prev) => next) => void
//   refiStepIdx        : number          — wizard step index
//   setRefiStepIdx     : (next | (prev) => next) => void
//   resetRefiForm      : () => void | null
//                                        — registered by CoPilotPane on
//                                          mount; closes over the lazy-
//                                          loaded INITIAL_FORM + the
//                                          current orgId/contact/vehicle
//                                          so RefiDevControls' "Reset
//                                          prototype" button can re-seed
//                                          via the same path the embed
//                                          uses on mount. null when no
//                                          CoPilot is open.
//   setResetRefiForm   : ((fn|null) => void)
//
// Protection form / step:
//   protectionForm     : null | object   — protection-portal's wizard
//                                          form (INITIAL_FORM-shaped +
//                                          contact + vehicle prefill via
//                                          buildProtectionInitialForm).
//                                          null until CoPilotPane seeds.
//   setProtectionForm  : (next | (prev) => next) => void
//   protectionStepIdx  : number          — wizard step index
//   setProtectionStepIdx : (next | (prev) => next) => void
//   resetProtectionForm     : () => void | null
//                                        — registered by CoPilotPane on
//                                          mount; mirrors refi for
//                                          symmetry. null when no
//                                          CoPilot is open. Currently
//                                          unused by ProtectionDevControls
//                                          (no reset button) but published
//                                          for future use.
//   setResetProtectionForm  : ((fn|null) => void)
//
// Insurance workflow:
//   insuranceWorkflow         : null | object — insurance-portal's
//                                               workflow record (status,
//                                               flowPath, lead, link,
//                                               notes, tags...). null
//                                               until CoPilotPane seeds.
//   setInsuranceWorkflow      : (next | (prev) => next) => void
//   resetInsuranceWorkflow    : () => void | null
//                                               — registered by
//                                                 CoPilotPane on mount;
//                                                 re-seeds workflow back
//                                                 to its initial shape.
//                                                 null when no CoPilot
//                                                 is open. Currently
//                                                 unused by the
//                                                 consolidated DevPanel
//                                                 (no insurance reset
//                                                 button) but published
//                                                 for symmetry.
//   setResetInsuranceWorkflow : ((fn|null) => void)
//
// Wiring:
//   - App.jsx owns the [active, setActive] useState + the three per-kind
//     useState slices + the new refiForm / refiStepIdx / insuranceWorkflow
//     useStates + the two reset callbacks, and wraps the tree in
//     <ActiveWorkflowContext.Provider>.
//   - CoPilotPane reads refiForm / setRefiForm / refiStepIdx /
//     setRefiStepIdx (refi opps) and insuranceWorkflow /
//     setInsuranceWorkflow (insurance opps) from context. On embed mount,
//     it seeds refiForm via buildRefiInitialForm and registers
//     resetRefiForm; the seed effect keys on `refiForm === null` so a
//     reset (which sets refiForm back to null) re-runs the seed.
//   - DevPanel reads via useActiveWorkflow() to render the payload
//     mirror, drive forceOpen on per-workflow placeholder sections, and
//     wire formState / wizardNav (refi) and workflow / updateWorkflow
//     (insurance) to the lifted state.

export const ActiveWorkflowContext = createContext({
  active: null,
  setActive: () => {},
  protectionDev: {},
  setProtectionDev: () => {},
  refiDev: {},
  setRefiDev: () => {},
  insuranceDev: {},
  setInsuranceDev: () => {},
  protectionForm: null,
  setProtectionForm: () => {},
  protectionStepIdx: 0,
  setProtectionStepIdx: () => {},
  resetProtectionForm: null,
  setResetProtectionForm: () => {},
  refiForm: null,
  setRefiForm: () => {},
  refiStepIdx: 0,
  setRefiStepIdx: () => {},
  resetRefiForm: null,
  setResetRefiForm: () => {},
  insuranceWorkflow: null,
  setInsuranceWorkflow: () => {},
  resetInsuranceWorkflow: null,
  setResetInsuranceWorkflow: () => {},
});

export function useActiveWorkflow() {
  return useContext(ActiveWorkflowContext);
}

// Tiny utility used by App.jsx's RefiDevControls formState.applyPrefill /
// update wiring so call sites don't have to write the
// `(prev) => ({ ...prev, ...patch })` pattern themselves.
export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
