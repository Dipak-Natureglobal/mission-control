// Public surface for blinker-platform's reusable cross-app COMPONENTS.
//
// This is the canonical home for workflow-agnostic UI primitives consumed
// by every child app (mission-control, protection-portal, insurance-portal,
// refi-portal, customer-portal). Apps depend on `file:../blinker-platform`
// and import from `'blinker-platform/components'` (the alias is declared
// in the repo root package.json `exports` map).
//
// History: AddressBlock, NotesPanel, and TagPicker were originally hosted
// in refi-portal/src/components/ (Wave 6, 2026-05-04). The dual-hat
// awkwardness — refi-portal being both a consumer app AND a component
// library — drove the Wave 15a decision to lift the shared surface here.
// Wave 15c (this commit) executes the lift. See
// `architecture/11-platform-package-layout.md` for the full rationale.
//
// Consumers MUST import from this file ONLY. Importing from any deeper
// path (e.g. `blinker-platform/packages/components/AddressBlock.jsx`) is
// blocked by the root package.json `exports` map and will fail at
// resolve time. The on-disk layout under this file is private and may
// shift across waves.
//
// Embed-contract reminders (carried verbatim from refi-portal's original
// surface — these rules apply to every component exported from here):
//   - Every public component accepts { persona, personaLocked }. Today
//     the props are forward-compat scaffolding (most components don't
//     yet branch on them); accept them anyway so the contract doesn't
//     change when copy variants land.
//   - personaLocked=true means DON'T render a persona switcher; parent
//     owns the switch. Components that have no internal switcher accept
//     the flag as informational.
//   - Components accept a flat-or-nested form-slice via `form` + an
//     `update(patch)` shallow-merge writer (matches useForm's contract
//     in refi-portal / protection-portal / insurance-portal).
//   - Field-name overrides via the `fieldNames` prop let an embedder
//     remap to its own form shape (e.g. `address.zip` instead of `zip`)
//     without forking the component. Each value may be a flat key or a
//     one-level dotted path.
//
// Dep direction (per architecture/11):
//   - This package MAY read `../../canon/*.json` directly. TagPicker
//     reads `../../canon/system-tags.json` for its inventory.
//   - This package MAY import sibling packages. NotesPanel + TagPicker
//     import `track` from `../telemetry/index.js`.
//   - This package MUST NOT import from any child app.
//
// External prerequisites for embedders (carried forward from refi-portal):
//   - AddressBlock makes direct fetch() calls to api.zippopotam.us (ZIP
//     lookup) and places.googleapis.com (street autocomplete). The
//     Google Places API key is currently HARDCODED inside the component
//     (mirrors the legacy monolith). When the platform secrets pipeline
//     lands, embedders should be able to override via VITE_GOOGLE_PLACES_KEY.
//   - ZIP_FALLBACK is bundled into AddressBlock — covers ~25 demo metros
//     for offline use. No setup required.
//   - NotesPanel + TagPicker read canon/personas.json + canon/system-tags.json.
//     Embedders MUST keep their canon copy synced
//     (`scripts/sync-canon-into-apps.sh` from blinker-platform/) — the
//     parent reads personas.json to derive canAddTags / canCreateTags;
//     TagPicker reads system-tags.json directly.
//
// ---------------------------------------------------------------------
//
// Available public exports (all accept `persona` + `personaLocked`):
//
//   AddressBlock — ZIP-first address-collection sub-block. Renders ZIP →
//                  city/state auto-fill (via zippopotam.us with a static
//                  fallback table) and a street-address input with
//                  Google Places "New" REST autocomplete. Excludes
//                  housing-status pills, monthly payment, move-in date,
//                  and any other refi-flow-specific extras. Used by:
//                  refi-portal's own ScreenHousing (composed inline
//                  alongside the housing extras), mission-control's
//                  AddContactModal (when an inbound contact lacks an
//                  address), and protection-portal cross-sell screens
//                  that need to capture a billing address.
//
//                  Verified component signature:
//
//                    export function AddressBlock({
//                      form,
//                      update,
//                      fieldNames,         // optional override:
//                                          //   { zip, city, state,
//                                          //     address, apt_suite }
//                      showAptSuite = false,
//                      onZipResolved,      // ({ zip, city, state }) => void
//                      onAddressSelected,  // (prediction) => void
//                      autoFocusZip = true,
//                      persona = 'consumer',
//                      personaLocked = false,
//                    })
//
//                  Form-slice contract (defaults — match the refi-portal
//                  Housing screen's field names verbatim):
//                    form.zip       — 5-digit string (read + written on
//                                     ZIP input change)
//                    form.city      — string (auto-populated from ZIP
//                                     lookup; also read + written on
//                                     manual edit)
//                    form.state     — 2-letter string (auto-populated
//                                     from ZIP lookup; uppercased on
//                                     manual edit)
//                    form.address   — street address string (NOTE:
//                                     'address', NOT 'street_address' —
//                                     this is verbatim the original
//                                     field name; embedders MUST match
//                                     this OR pass a `fieldNames` override)
//                    form.apt_suite — string, only read/written when
//                                     showAptSuite={true}. Refi-portal's
//                                     housing screen does not collect
//                                     this today; the prop is forward-
//                                     compat scaffolding for embedders
//                                     that need a separate apt/suite
//                                     line.
//
//                  fieldNames override — for embedders whose form is
//                  nested (one level deep, e.g.
//                  `contact.address.zip`):
//                    <AddressBlock
//                      form={contact}
//                      update={updateContact}
//                      fieldNames={{
//                        zip:       'address.zip',
//                        city:      'address.city',
//                        state:     'address.state',
//                        address:   'address.line1',
//                        apt_suite: 'address.line2',
//                      }}
//                    />
//                  Each value may be a flat key (e.g. `'zip'`) or a
//                  one-level dotted path (e.g. `'address.zip'`). Patches
//                  to nested keys are merged into a single update() call
//                  so city + state don't clobber each other on a ZIP
//                  resolve.
//
//                  Google Places integration: component-scoped, no
//                  globals. Each keystroke debounces 300ms then POSTs
//                  to `places.googleapis.com/v1/places:autocomplete`
//                  with the API key in `X-Goog-Api-Key`. If the network
//                  call fails, the autocomplete dropdown silently
//                  doesn't appear — the street field remains manually
//                  typeable. ZIP lookup uses `api.zippopotam.us/us/{zip}`
//                  with the bundled ZIP_FALLBACK table as offline
//                  fallback. No script tag, no SDK init.
//
//                  Anomalies / things embedders should know:
//                    - The PLACES_API_KEY is hardcoded in the component
//                      file. Embedders can't override it today.
//                    - autoFocusZip defaults to true — embedders that
//                      render AddressBlock alongside other inputs (e.g.
//                      mission-control's contact panel) should pass
//                      `autoFocusZip={false}` to avoid stealing focus
//                      from the parent screen on mount.
//                    - The component renders a sequence of stacked
//                      `<div>` blocks (no surrounding container).
//                      Embedders provide their own layout shell
//                      (e.g. `<div className="px-6 space-y-3">`).
//
//   NotesPanel —   Right-pane card hosting a contact-tags row (via
//                  TagPicker) above a notes textarea. Both workflows
//                  (protection + refi + insurance) compose this in
//                  their AgentView's right column so notes + tags
//                  share one source of truth. State is parent-owned;
//                  the component is pure aside from a one-cell
//                  ephemeral guard ('persisted') used to dedupe the
//                  blur-fire of `notes.changed`.
//
//                  Verified component signature:
//
//                    export function NotesPanel({
//                      // Notes (parent-owned).
//                      notes = '',
//                      onNotesChange,        // (next: string) => void
//                      notesPlaceholder,     // string? — default
//                                            //   "Quick notes on this contact …"
//
//                      // Tags (parent-owned). Pass showTags={false}
//                      // to hide the tag section entirely.
//                      showTags = true,
//                      selectedTagIds = [],
//                      onTagAdd,             // (tagId) => void
//                      onTagRemove,          // (tagId) => void
//                      onTagCreate,          // (tag) => void  (manager+)
//                      canAddTags = false,
//                      canCreateTags = false,
//                      sessionCreatedTags = [],
//                      orgId,
//
//                      // Both.
//                      persona = 'agent',
//                      trackingPrefix = 'agent', // 'protection.agent' |
//                                                //  'refi.agent' |
//                                                //  'insurance.agent'
//                      headingLabel = 'Agent notes',
//                      sessionPersistenceHint, // string? — default
//                                              //   "Phase 1: notes live …"
//
//                      // Optional correlation id for the events.
//                      opportunityId,
//                    })
//
//                  PostHog events (with `trackingPrefix='refi.agent'`):
//                    refi.agent.notes.changed       { opportunity_id,
//                                                     has_text,
//                                                     text_length } — fires
//                                                     on blur ONLY when
//                                                     the persisted value
//                                                     actually changed.
//                    refi.agent.tag_picker.opened   { persona, org_id }
//                    refi.agent.tag_picker.tag_added { tag_id, tag_name,
//                                                     tag_source, persona }
//                    refi.agent.tag_picker.tag_removed { tag_id, tag_name,
//                                                     persona }
//                    refi.agent.tag_picker.tag_created { tag_id, tag_name,
//                                                     persona } (manager+)
//
//                  Persistence contract:
//                    - Parent owns `notes`, `selectedTagIds`,
//                      `sessionCreatedTags`. The component never writes
//                      to canon, never calls a network, never stores in
//                      localStorage. It is a controlled view.
//                    - Phase 1: tags + notes live wherever the parent
//                      stores them (typically a useForm slice). Phase 2
//                      (per architecture/07-data-layer.md) swaps the
//                      parent's onTagAdd/onTagRemove/onTagCreate +
//                      onNotesChange handlers for
//                      `await blinkerApi.{tags,notes}.{create,update,
//                      delete}` calls — the component contract is
//                      unchanged.
//
//                  Canon dependencies:
//                    - personas.json — embedder reads
//                      `personas.<persona>.permissions` to derive
//                      `canAddTags` (`add_tags`) + `canCreateTags`
//                      (`create_tags`). The component does NOT read
//                      personas itself; it expects the parent to have
//                      gated the booleans.
//                    - system-tags.json — TagPicker reads directly via
//                      `../../canon/system-tags.json`. The active
//                      inventory is `system_tags + by_org[orgId] +
//                      sessionCreatedTags` with case-insensitive name
//                      dedupe; system_tags win. Embedders MUST keep
//                      their canon copy synced
//                      (`scripts/sync-canon-into-apps.sh` from
//                      blinker-platform/).
//
//   TagPicker —    Role-gated tag picker with applied-pill row, search
//                  input, grouped dropdown (by category), and inline
//                  "Create new" affordance for manager+ personas.
//                  Typically embedded inside NotesPanel; exposed
//                  directly so an embedder can compose tags somewhere
//                  other than the notes pane (e.g. a contact summary
//                  card) without dragging the textarea along.
//
//                  Verified component signature:
//
//                    export function TagPicker({
//                      selectedTagIds = [],
//                      onAdd,                // (tagId) => void
//                      onRemove,             // (tagId) => void
//                      onCreate,             // (tag)   => void
//                      canAdd = false,
//                      canCreate = false,
//                      orgId,
//                      persona,
//                      sessionCreated = [],
//                      trackingPrefix = 'agent.tag_picker',
//                                            // e.g. 'protection.agent.tag_picker'
//                                            //      'refi.agent.tag_picker'
//                                            //      'insurance.agent.tag_picker'
//                    })
//
//                  Permission gating (parent computes from canon
//                  `personas.json`):
//                    agent:        canAdd=true,  canCreate=false
//                    manager+:     canAdd=true,  canCreate=true
//                    consumer:     canAdd=false, canCreate=false
//
//                  Persistence contract: parent owns `selectedTagIds`
//                  (string[]) and `sessionCreated` (Tag[]). The
//                  component is pure aside from UI ephemera (query
//                  text, dropdown-open flag). Phase 2 swap is the
//                  parent's responsibility (same as NotesPanel).
//
//                  Canon dependencies: same as the NotesPanel entry
//                  above (personas.json read by parent; system-tags.json
//                  read directly via `../../canon/system-tags.json`).
//
//   JsonPeek —     Tiny dark "current state" pane so embedders can
//                  sanity-check the form / package shape from inside
//                  their DEV CONTROLS sidebar. Lifted Wave 15c-fu from
//                  protection-portal/src/shared/JsonPeek.jsx. Refi /
//                  insurance / mission-control had near-identical
//                  copies; chrome converged on the rounded-card form.
//
//                  Verified component signature:
//
//                    export function JsonPeek({
//                      label = 'JSON peek · current state',
//                      data,
//                    })
//
//                  Renders a fixed-max-height (16rem) overflow-scroll
//                  card with `JSON.stringify(data ?? {}, null, 2)`. No
//                  state, no callbacks, no canon access. Pure leaf.
//
//   WizardShell —  Generic wizard chrome: back arrow + step counter +
//                  progress bar, then renders whatever screen <children/>
//                  are passed in. Lifted Wave 15c-fu from refi-portal's
//                  copy (chosen for its strict-superset shape — `Footer`
//                  alias + eyebrow default). Workflow content lives in
//                  the views; this file owns chrome only.
//
//                  Verified component signatures:
//
//                    export function WizardShell({
//                      children,
//                      progress = 0,           // 0..100 (caller-computed)
//                      stepIndex = 1,
//                      stepTotal = 1,
//                      onBack,                 // () => void; falsy
//                                              //   → button disabled
//                    })
//
//                    export function ScreenHeader({
//                      icon: Icon,
//                      eyebrow = 'Pre Qualification for a Loan',
//                      title,
//                      subtitle,
//                    })
//
//                    export function WizardFooter({
//                      onNext,
//                      disabled,
//                      nextLabel = 'Next',
//                      secondary,              // ReactNode — left slot
//                    })
//
//                  Also exports `Footer` as an alias for `WizardFooter`
//                  (refi-prototype screens import the bare name).

//
//   DevPanel —     Dark sidebar shell ({ open, children } gate) plus the
//                  Section + Segmented chrome the per-app DevControls
//                  rely on. Lifted Wave 15c-fu from protection-portal's
//                  copy — refi + insurance carried byte-identical bodies.
//                  mission-control's larger variant (different prop
//                  shape, collapsible Section, Row + JsonBlock extras)
//                  stays local at mc/src/shared/DevPanel.jsx until a
//                  later convergence wave.
//
//                  Verified component signatures:
//
//                    export function DevPanel({ open, children })
//                      — returns null when !open; otherwise renders the
//                        80-rem-wide dark sidebar with default heading.
//
//                    export function Section({ label, children })
//                      — labeled chunk; non-collapsible.
//
//                    export function Segmented({ value, onChange, options })
//                      — pill-style choice row; each `options[i]` is
//                        either { v, l } or { value, label }.

//
//   FormFields —   Bare form-field primitives shared by every screen.
//                  Lifted Wave 15c-fu as a strict superset of the four
//                  per-app copies (protection / insurance / refi
//                  byte-identical with Field + PhoneField + DateField +
//                  SelectField; mc had a divergent Field+SelectField+
//                  TextAreaField with `optional` / `type` / ChevronDown
//                  additions). Merge is additive — no existing consumer
//                  breaks.
//
//                  Verified component signatures:
//
//                    export function Field({
//                      label,
//                      value,
//                      onChange,                // (next: string) => void
//                      placeholder,
//                      prefix,                  // string — e.g. '$'
//                      error,                   // string | null
//                      icon: Icon,              // lucide-react icon
//                      inputMode,
//                      maxLength,
//                      type = 'text',           // (mc addition)
//                      optional,                // (mc addition) renders
//                                               //   '(optional)' suffix
//                                               //   in the label row
//                    })
//
//                    export function PhoneField({ label, value, onChange,
//                      error })
//                      — wraps Field; stores 10 digits, displays
//                        (###) ###-####.
//
//                    export function DateField({ label, value, onChange,
//                      error, optional })
//                      — wraps Field; accepts MMDDYYYY or MM/DD/YYYY.
//
//                    export function SelectField({ label, value, onChange,
//                      options, error })
//                      — `options` may be string[] OR {value, label}[].
//                        Uses appearance-none + ChevronDown chrome
//                        (mc upgrade); empty default is selectable
//                        ("Select...").
//
//                    export function TextAreaField({ label, value,
//                      onChange, placeholder, rows = 4, error })
//                      — multiline text input. (mc-only today.)
//
//                  Internal helper (not exported): formatPhoneDisplay.
//
//   RelationshipPicker —
//                  Wave 19 Task 5 lift. Workflow-agnostic relationship
//                  picker for householding + co-applicant flows. Lifted
//                  from refi-portal/src/refinance-v2-prototype.jsx
//                  ScreenCoAppContact (the 2-col button grid pattern).
//                  Canonical option list lives in canon/relationships.json
//                  `system_types`; the component reads it as a default
//                  when no `options` prop is passed.
//
//                  Verified component signature:
//
//                    export function RelationshipPicker({
//                      value,             // string id ('spouse', etc) | null
//                      onChange,          // (id: string) => void
//                      otherText = '',    // string — when value==='other'
//                      onOtherTextChange, // (next: string) => void
//                      options,           // Option[] | string[] | undefined;
//                                         //   falls back to canon/relationships
//                                         //   .json `system_types`. Each option
//                                         //   may be a record:
//                                         //     { id, label, category? }
//                                         //   OR a flat string (Wave 20 compat
//                                         //   for refi-portal's RELATIONSHIP_OPTIONS:
//                                         //   coerced to id = label.lower()
//                                         //   .replace(/\s+/g, '_')).
//                      allowOther = true, // when false, 'other' is filtered
//                                         //   out + free-text is not rendered
//                      label = 'Relationship',
//                      persona = 'agent',
//                      personaLocked = false,
//                    })
//
//                  Form-slice contract: parent-owned controlled value.
//                  No internal state aside from layout — `value` and
//                  `otherText` are both controlled. onChange fires with
//                  the option id slug, NOT the label.
//
//                  Canon dependency: canon/relationships.json `system_types`
//                  (read directly per ADR 11). The custom_types_per_org
//                  split is forward-compat (Wave 19 Task 6 super-admin
//                  shell will add per-org additions).
//
//                  Embed contract notes:
//                    - Compact (no surrounding card chrome). Embedders
//                      provide their own layout shell.
//                    - Empty options list → renders nothing (defensive).
//                    - "Other" branch shows a text input below the grid
//                      when allowOther + value==='other'; the text is
//                      parent-owned via otherText / onOtherTextChange.
//
//                  Wave 20 retrofit: refi-portal's ScreenCoAppContact now
//                  consumes this picker via the string[]-compat path. Refi's
//                  inline `RELATIONSHIP_OPTIONS` const stays in the monolith
//                  (other consumers in App.jsx + RefiSubFlow.jsx still read
//                  the flat-string list); the picker accepts it directly.
//
//   VehicleAddOrConfirm —
//                  Wave 17 P1 lift. Single canonical "VIN-or-YMMT entry"
//                  surface for the platform. Replaces refi-portal's
//                  ScreenVehicleAdd (refinance-v2-prototype.jsx:1873-2050)
//                  and protection-portal's local copy
//                  (src/views/customer/VehicleAdd.jsx). Merges
//                  extras-injection (refi) with the manuallyEdited guard +
//                  MismatchModal + 7-event telemetry spine (protection).
//
//                  Verified component signature:
//
//                    export function VehicleAddOrConfirm({
//                      form,                  // controlled state slice
//                      update,                // (patch) => void
//                      onNext,                // () => void
//                      requireVin = true,     // hide pickers, VIN+YMMT
//                                             //   both required when true
//                      telemetryPrefix = 'vehicle_add',
//                                             // namespace for the 7 events
//                      Footer = WizardFooter, // chrome override
//                    })
//
//                  Form-slice contract (extras ignored; missing default to
//                  undefined):
//                    form.vin               — string (uppercased on input)
//                    form.year              — number | null
//                    form.make              — string
//                    form.model             — string
//                    form.trim              — string
//                    form.vinDecoded        — boolean
//                    form.vinDecodeLoading  — boolean
//                    form.vinDecodeError    — string | null
//                    form._lastDecodedVin   — string | null
//                    form.decodedYmmt       — { year, make, model, trim,
//                                               raw } | null
//                    form.manuallyEdited    — boolean (set by pickerUpdate)
//                    form.extraMakes        — string[]  (decode-injected)
//                    form.extraModels       — string[]  (decode-injected)
//                    form.extraTrims        — string[]  (decode-injected)
//                    form.vehicle           — committed snapshot (set by
//                                               handleNext / mismatch
//                                               resolution)
//
//                  Telemetry events (with `telemetryPrefix='refi.customer.vehicle_add'`):
//                    refi.customer.vehicle_add.viewed
//                    refi.customer.vehicle_add.vin_decode_started
//                                             { vin }
//                    refi.customer.vehicle_add.vin_decode_failed
//                                             { error }
//                    refi.customer.vehicle_add.vin_decoded
//                                             { vin, decoded_year/make/model/trim,
//                                               applied_to_form }
//                    refi.customer.vehicle_add.continued
//                                             { via, year, make, model, trim,
//                                               vin_present }
//                    refi.customer.vehicle_add.vin_mismatch_shown
//                                             { vin, decoded, manual }
//                                             — only fires when requireVin=false
//                    refi.customer.vehicle_add.vin_mismatch_confirmed
//                                             { vin, direction, decoded,
//                                               manual }
//                                             — only fires when requireVin=false
//
//                  External prerequisites:
//                    - fetchVinDecode (from blinker-platform/utils) calls the
//                      VinAudit Specifications API. Embedders need outbound
//                      HTTPS reachability OR will see vinDecodeError surfaces.
//                    - YMMT_DATA fixture is bundled (~62 KB JSON literal in
//                      blinker-platform/utils/ymmt-data.js); replaced with
//                      live Blinker API per architecture/07-data-layer.md
//                      Phase 2 swap.
//
//                  Embedded sub-components (also exported as a deep import
//                  for embedders that need to compose part of the surface
//                  without the full screen — most callers should NOT reach
//                  for these):
//                    - PickerField
//                    - YmmtPicker
//                    - MismatchModal + ymmtEquals + ymmtLabel

export { AddressBlock } from './AddressBlock.jsx';
export { NotesPanel } from './NotesPanel.jsx';
export { TagPicker } from './TagPicker.jsx';
export { JsonPeek } from './JsonPeek.jsx';
export { WizardShell, ScreenHeader, WizardFooter, Footer } from './WizardShell.jsx';
export { DevPanel, Section, Segmented } from './DevPanel.jsx';
export { Field, PhoneField, DateField, SelectField, TextAreaField } from './FormFields.jsx';
export { RelationshipPicker } from './RelationshipPicker.jsx';
// v3.0.15 (ADR 27 D2) — duplicate / household match card. Renders a
// findContactMatch result (packages/utils/contact-identity.js).
export { ContactDedupeCard } from './ContactDedupeCard.jsx';
export { VehicleAddOrConfirm } from './VehicleAddOrConfirm/index.jsx';
export { PickerField } from './VehicleAddOrConfirm/PickerField.jsx';
export { YmmtPicker } from './VehicleAddOrConfirm/YmmtPicker.jsx';
export {
  MismatchModal,
  ymmtEquals,
  ymmtLabel,
} from './VehicleAddOrConfirm/MismatchModal.jsx';
