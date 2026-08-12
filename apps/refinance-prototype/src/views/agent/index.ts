// Public surface for the refi-portal agent view.
//
// Mission-control will consume this via a `file:` dependency in its
// package.json — `import { AgentView } from 'refi-portal/src/views/agent'`.
// Only AgentView is exported; CaptureLinkForm, AgentChrome, NotesPanel,
// and ApiResponsesModal are private to the shell.
//
// AgentView accepts:
//   * persona?: 'super_admin' | 'admin' | 'manager' | 'agent'
//                (default 'agent'). When mission-control wires its
//                cross-app PersonaSwitcher in, pass it here so the
//                "View API Responses" button gates correctly.
//   * personaLocked?: boolean
//                (default false). Hides AgentView's local persona
//                switcher — mission-control's switcher is the source
//                of truth in CoPilotPane.
//   * contact?: canonical Contact (blinker-domain shape — see
//                src/constants/canon/blinker-domain.json `contact`).
//                When passed by mission-control's RefiAgentEmbed (in
//                mission-control/src/components/CoPilotPane.jsx), it's
//                threaded into CaptureLinkForm so the capture-link gate
//                seeds with the real consumer's primary email + phone
//                instead of the Jordan/512 mock. Standalone callers
//                (App.jsx, dev shell) omit it; the mock applies and
//                behavior is byte-identical to pre-Phase-2.
//
//                Note: refi's form is externally owned by the embedder
//                (RefiAgentEmbed mirrors live form state at the wrapper
//                boundary), so unlike protection-portal, refi's
//                AgentView only needs `contact` for the CaptureLinkForm
//                gate prefill — the wizard form itself is seeded by the
//                embedder, not by AgentView.
//   * onVehicleCommitted?: ({ id, year, make, model, trim, vin?,
//                source, mileage?, ownership?, purchase_date?,
//                market_value? }) => void
//                (Wave 16 F2-fu12-refi). Optional. When passed by
//                mission-control's RefiAgentEmbed, fired by a useEffect
//                observer inside AgentView whenever wizard form fields
//                (year/make/model/trim/vin/vinDecoded/mileage/condition/
//                purchaseDate/valuation*) change. Payload matches the
//                protection-portal cross-app vehicle contract (750bb02)
//                so mc's CoPilotPane handler reuses verbatim. id is
//                deterministic (xs_vin_<VIN> or xs_ymmt_<Y_M_M_T>) for
//                idempotent append-or-patch. Standalone callers (dev
//                shell, ViewSwitcher ?view=agent) leave this undefined
//                and the observer early-returns — no behavior change.
export { AgentView } from './AgentView';

/**
 * RefiDevControls — chrome-less, embed-friendly variant of the refi-portal
 * DEV CONTROLS sidebar. Renders all 15 Sections (Persona + 14 prototype
 * sections) plus the Reset button, WITHOUT the outer dark <DevPanel>
 * wrapper. Drops the standalone "View" switcher Section since refi only
 * surfaces the agent view inside mission-control's CoPilot.
 *
 * Mission-control mounts this inside its consolidated DevPanel when
 * CoPilot is open on a refi opportunity, so the same dev knobs that drive
 * the standalone shell drive the embedded agent view too.
 *
 * Props (parent owns all state — component is purely controlled):
 *   * devOptions: {
 *       persona, personaLocked,
 *       forcePartner, forceResult, disqualReason,
 *       includeSsn, coAppOverride,
 *       showJson, prefillJson,
 *       orgConfig, orgConfigJson, orgConfigError,
 *       embeddedState,
 *     }
 *   * setDevOptions: (updater | patch) => void — same updater shape
 *       App.jsx uses (`(prev) => ({ ...prev, ...patch })`).
 *   * formState: {
 *       form,                             // current refi form slice
 *       update: (patch) => void,          // form updater
 *       applyPrefill: (payload) => void,  // prefill helper (Section 1)
 *       resetAll: () => void,             // reset prototype (Section 14)
 *     }
 *   * wizardNav: {
 *       screen,                           // active step key
 *       goToScreen: (stepKey) => void,    // jump-to-screen handler
 *       sequence,                         // ordered step keys
 *     }
 *
 * No "view" prop — the embedded variant doesn't render a view switcher.
 * Style assumes a dark slate background (mission-control's DevPanel
 * provides one), matching refi's standalone DEV CONTROLS chrome.
 */
export { RefiDevControls } from '../../shell/RefiDevControls';
