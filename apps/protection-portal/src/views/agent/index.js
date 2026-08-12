// Public surface for the protection-portal agent view.
//
// Mission-control consumes this via a `file:` dependency in its
// package.json — `import { AgentView } from 'protection-portal/src/views/agent'`.
// Only AgentView is exported; CaptureLinkForm, AgentChrome, and
// ApiResponsesModal are private to the shell. NotesPanel + TagPicker
// are no longer local — AgentView consumes them from refi-portal's
// shared `src/components` surface (Wave 12a lift).
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
//   * contact?: mission-control canonical contact record (Phase 2
//                prefill). Shape:
//                  { id, org_id, name: { first, last, preferred? },
//                    phones:    [{ number, is_primary, ... }],
//                    emails:    [{ address, is_primary, ... }],
//                    addresses: [{ line_1, city, state, postal_code,
//                                  is_primary, ... }],
//                    vehicles:  [...] }
//                When provided, AgentView seeds the wizard's form with
//                the primary email/phone/address and contact.org_id
//                (when defined). Phone is normalized to 10-digit by
//                stripping a leading +1. Optional — standalone callers
//                (App.jsx) leave it undefined and INITIAL_FORM applies.
//   * vehicle?: mission-control canonical vehicle record (Phase 2
//                prefill). Shape:
//                  { id, year, make, model, trim, vin, mileage?,
//                    ownership?, value?, payoff?, source }
//                When provided, AgentView seeds form.{vin,year,make,
//                model,trim,mileage,vehicle}. form.vinDecoded is set
//                true when vehicle.source === 'vin_decode'. Optional.
//   * onFormChange?: (form) => void
//                Optional callback fired on mount with the seeded form
//                and again on every subsequent form change. Useful for
//                embedders that want to mirror live wizard state in a
//                side panel (e.g. mission-control's CoPilotPane debug
//                view). The parent should memoize this callback if
//                reference stability matters — AgentView wires it into
//                a useEffect with `[form, onFormChange]` deps, so an
//                unstable callback re-fires on every form change with
//                no new information. Optional.
//
// Both contact and vehicle are read once on mount (the parent remounts
// AgentView via `key` whenever the underlying opportunity/contact
// changes), so updating these props on a mounted instance has no effect.
//
// Wave 14 — embed-friendly DEV CONTROLS props (all optional):
//   * crossSellOverrides?: { insurance_enabled?: boolean, refi_enabled?: boolean } | undefined
//                When provided, AgentView reads this as the source of
//                truth for the RecommendedCoverage gate overrides.
//                Standalone (App.jsx) and mission-control's CoPilotPane
//                both thread it through from the consolidated DevPanel
//                (`devOptions.crossSellOverrides` written by the lifted
//                ProtectionDevControls — see below). Standalone callers
//                that don't render any DEV CONTROLS at all may leave it
//                undefined; AgentView reads it as undefined and the
//                canon org-registry gating applies.
//   * setCrossSellOverrides?: (next | (prev) => next) => void
//                Retained on the public prop signature for backward
//                compat. After the post-1.5 dev-controls lift, AgentView
//                no longer writes the gate state internally (the local
//                toggle panel relocated to the left DevPanel), so this
//                slot is effectively a no-op — the embedder writes via
//                its own setDevOptions instead.
//   * showInsuranceCrossSell?: boolean (default true)
//                Confirm-step SavingsCard visibility. Mirrors the
//                CustomerView prop of the same name; threaded straight
//                through to ProtectionWizard.
//
// Post-1.5 dev-controls lift — shared form/stepIdx ownership (all
// optional, but expected to come together):
//   * form?: object
//   * update?: (patch) => void
//   * stepIdx?: number
//   * setStepIdx?: (next) => void
//                When the parent threads all four, AgentView reads +
//                writes the parent's wizard state instead of its own
//                internal useForm + useState. Mirrors the refi-portal
//                AgentView contract. Standalone callers that don't pass
//                them keep working unchanged — AgentView falls back to
//                internal state seeded from buildInitialFormSeed(contact,
//                vehicle). When mission-control's CoPilotPane (or any
//                embedder) lifts state to drive the left DevPanel's
//                Force-complete + Form-state JsonPeek sections, it
//                must thread all four so the wizard stays in sync.
//
// Wave 13-fu-1 — optional override for the FORCE STATUS picker:
//   * availableStatuses?: string[]
//                When provided and non-empty, AgentView threads this list
//                straight to AgentTopBar's "Force status" <select> in
//                place of the canon-derived VSC display-name list. Unset
//                or empty → falls back to the existing canon read
//                (`Object.keys(canon/ghl-status.json.vsc.statuses)`),
//                which preserves today's behavior for every standalone
//                caller (App.jsx) and any embedder that hasn't wired
//                per-org mappings yet.
//
//                Mission-control's SuperHome StatusMappingEditor publishes
//                a per-org subset to localStorage (`mc.status-mapping.v1`);
//                CoPilotPane reads the active org's list and threads it
//                here so the picker only offers statuses that org has
//                actually mapped. Backwards compatible.
//
// Wave 14 also exports `ProtectionDevControls` — the chrome-less variant
// of the standalone DEV CONTROLS sidebar. Mission-control mounts this
// inside its consolidated DevPanel when CoPilot is open on a protection
// opportunity, so the same toggles drive AgentView in both standalone
// and embedded modes.
//
// ProtectionDevControls contract (`{ devOptions, setDevOptions, form?,
// updateForm?, persona? }`):
//   * devOptions: parent-owned object. Reads:
//       - showInsuranceCrossSell?: boolean
//       - crossSellOverrides?: { insurance_enabled?, refi_enabled? }
//       - seedMultiContactHousehold?: boolean
//   * setDevOptions: functional updater (prev) => next. The component is
//                purely controlled — it never reads or writes any state
//                of its own. Drop into any dark surface; it ships only
//                the inner Section/Segmented blocks (no <DevPanel> dark
//                sidebar wrapper) so the embedder owns the chrome.
//   * form?: AgentView's wizard form (the same one threaded into
//                AgentView via its `form` prop). When present alongside
//                `updateForm`, ProtectionDevControls renders two extra
//                Sections at the bottom of the panel: "Force-complete
//                (skip embed)" (Insurance↑ / Refi↑ / Clear ins. / Clear
//                refi) and "Form state" (JsonPeek of insuranceSavings,
//                refiOffer, contact.tags, contact.tagsCreated). When
//                absent — e.g. an embedder hasn't lifted AgentView form
//                state yet — those sections are silently skipped.
//   * updateForm?: (patch) => void. Same partial-update setter shape as
//                the rest of the substrate's useForm hooks. Required
//                alongside `form` for the bottom sections to render.
//   * persona?: 'agent' | 'manager' | 'admin' | 'super_admin' | 'consumer'
//                (default 'agent'). Tagged onto the
//                `protection.cross_sell.{insurance,refi}_completed`
//                PostHog events fired by the Force-complete buttons.
export { AgentView } from './AgentView.jsx';
export { ProtectionDevControls } from '../../shell/ProtectionDevControls.jsx';
