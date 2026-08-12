# Wave 15b — Cross-repo audit report

**Generated:** 2026-05-05
**Scope:** Read-only inventory of shared / duplicate / lift-candidate code across 6 repos.
**Successor:** Wave 15c (lift refi-portal trio); Wave 15e (PhoneInput / EmailInput); long-tail thereafter.

## Executive summary

- **Wave 15c is unblocked.** The shared trio (`AddressBlock`, `NotesPanel`, `TagPicker`) has 6 confirmed consumer sites across protection-portal + insurance-portal + mission-control, all importing through `refi-portal/src/components` (the public surface — no deep-import violations against the trio itself). The component bodies in `refi-portal/src/components/` are clean. Lift-and-rewire is mechanical.
- **Highest-value next category is `telemetry/`, not more components.** Four near-identical PostHog shim files (mission-control / protection-portal / refi-portal / insurance-portal) plus 161 distinct event names with confirmed naming drift in insurance (`insurance_lead_origination_started` legacy snake_case vs `insurance.agent.api_responses_opened` new dotted form). Lifting a `track()` wrapper is trivial; the event registry catches drift at lift time.
- **`shared/` chrome quartet (`DevPanel`, `JsonPeek`, `WizardShell`, `FormFields`) is duplicated 3-4× and meets 3-strikes today.** Each app has a near-identical copy. JsonPeek is a 12-15 line file replicated 4×. WizardShell + DevPanel chrome are virtually byte-identical between protection / insurance / refi. mission-control's DevPanel diverged (added `JsonBlock` + collapsible Section + `JsonBlock`/Copy affordance) — lift the protection/insurance/refi shape first; mc joins after a small refactor.
- **Two pre-existing dead-code issues uncovered.** (a) `refi-portal/src/components/{DevPanel,EmbeddedEntry,FormFields,JsonPeek,Stage2Shell,TopBar,WizardShell}.jsx` are broken file fragments — header imports + an orphan function body — NOT exported, NOT imported anywhere. They should be deleted as part of 15c hygiene. (b) `refi-portal/src/utils/validation.js:180` has an open `function getSequence(form, hasCoApp) {` with no body, dangling above the `export {}` block. Both files compile in refi-portal because nothing imports the broken regions; both will mislead the next reader.
- **Two anti-pattern deep-imports + one hardcoded API key duplicated 3×.** `mission-control/src/components/CoPilotPane.jsx:18` reaches into `protection-portal/src/views/customer/CustomerView.jsx`, and the same file at L122 lazy-imports `refi-portal/src/views/customer/RefiWizard.jsx` — both bypass public surfaces. `VINAUDIT_API_KEY = '2S1SZI7HUF89L6Z'` exists in `refi-portal/src/refinance-v2-prototype.jsx:486`, `refi-portal/src/utils/api.js:149`, and `protection-portal/src/lib/vinDecode.js:11`. Google Places key (already known) lives at `refi-portal/src/components/AddressBlock.jsx:69`. None of these block 15c, but flag them now so they get folded into 15d (integrations/secrets) work.

---

## 1. Already-shared baseline

The current trio (`AddressBlock`, `NotesPanel`, `TagPicker`) is exposed at `refi-portal/src/components/index.js:268-270`. All consumers go through that surface today.

| Consumer file:line | Component(s) | Path |
|---|---|---|
| `mission-control/src/components/AddContactModal.jsx:75` | AddressBlock (lazy) | `import('refi-portal/src/components').then((m) => ({ default: m.AddressBlock }))` |
| `protection-portal/src/views/customer/GarageLocation.jsx:46` | AddressBlock | `import { AddressBlock } from 'refi-portal/src/components'` |
| `protection-portal/src/views/customer/BillingPayment.jsx:42` | AddressBlock | same form |
| `protection-portal/src/views/agent/AgentView.jsx:61` | NotesPanel | `import { NotesPanel } from 'refi-portal/src/components'` |
| `insurance-portal/src/views/agent/AgentView.jsx:57` | NotesPanel | same form |
| (refi-portal itself) | AddressBlock, NotesPanel, TagPicker | re-exports + uses internally in `views/customer/Housing.jsx`, `views/agent/AgentView.jsx` |

**Deep-import contract violations against the trio: NONE.** Every cross-app consumer imports from `refi-portal/src/components` (the index file). The trio lift to `blinker-platform/components` is a pure rename with no contract change.

**TagPicker has zero direct cross-app consumers** — it's used today only as a child of `NotesPanel` at `refi-portal/src/components/NotesPanel.jsx:111`. The public export survives because the `index.js` JSDoc explicitly anticipates a future "tags somewhere other than the notes pane" use case (per `index.js:230-234`). Lift it anyway as part of the 15c trio so the contract stays whole.

---

## 2. Duplicate code (3-strikes triggers)

### 2.1 `JsonPeek` — 4 locations, byte-identical

Tiny dark JSON-snapshot card. Replicated verbatim across the four runnable apps.

| File | Lines | Notes |
|---|---|---|
| `mission-control/src/shared/JsonPeek.jsx` | 13 | identical |
| `protection-portal/src/shared/JsonPeek.jsx` | 14 | identical |
| `insurance-portal/src/shared/JsonPeek.jsx` | 15 | identical (one extra comment line) |
| `refi-portal/src/shared/JsonPeek.jsx` | 12 | identical |

**Plus broken-fragment `refi-portal/src/components/JsonPeek.jsx`** (29 lines, missing function declaration; not exported, not imported — see § 7.3).

**Recommended destination:** `blinker-platform/components/JsonPeek.jsx` (workflow-agnostic UI primitive, 15-line file, zero deps beyond Tailwind).
**Impact × Effort:** **High × S.** Mechanical lift; 4 imports change.

### 2.2 `DevPanel` shell + `Section` + `Segmented` — 3 byte-identical, 1 diverged

The dark dev sidebar wrapper plus its `Section` + `Segmented` chrome.

| File | Lines | Status |
|---|---|---|
| `protection-portal/src/shared/DevPanel.jsx` | 63 | byte-identical (modulo header comment) |
| `insurance-portal/src/shared/DevPanel.jsx` | 62 | byte-identical |
| `refi-portal/src/shared/DevPanel.jsx` | 61 | byte-identical |
| `mission-control/src/shared/DevPanel.jsx` | 189 | **diverged**: extends `Section` to be collapsible; adds `Row` + `JsonBlock` (with copy-to-clipboard); changes `DevPanel` props from `{ open, children }` to `{ title, subtitle, children }` (the open gate now lives in App.jsx). Different intent. |

**Recommended destination:** `blinker-platform/components/DevPanel.jsx`.
**Approach:** Lift the protection/insurance/refi shape first as the v1 contract (`{ open, children }` + Section + Segmented). Add `JsonBlock` + `Row` + `collapsibleSection` as additional named exports in the same file so mc can converge in a follow-up. The mc divergence is purely additive — no consumer of the smaller surface needs to change.
**Impact × Effort:** **High × M.** The shape consolidation is a small refactor; mc-converge is a separate small commit.

### 2.3 `WizardShell` + `ScreenHeader` + `WizardFooter` — 3 byte-identical

Wizard chrome used across consumer-facing flows.

| File | Lines | Status |
|---|---|---|
| `protection-portal/src/shared/WizardShell.jsx` | 73 | byte-identical |
| `insurance-portal/src/shared/WizardShell.jsx` | 73 | byte-identical |
| `refi-portal/src/shared/WizardShell.jsx` | 80 | adds `Footer` alias on top of identical body |
| `mission-control/src/shared/WizardShell.jsx` | 71 | identical-modulo-comment |

**Plus broken-fragment `refi-portal/src/components/WizardShell.jsx`** (92 lines, fragmentary; see § 7.3).

**Recommended destination:** `blinker-platform/components/WizardShell.jsx` with both `WizardFooter` AND its `Footer` alias.
**Impact × Effort:** **High × S.**

### 2.4 `FormFields.jsx` (Field / PhoneField / DateField / SelectField / TextAreaField) — 4 close-but-divergent

The base `<Field>` primitive + variants. All four apps share the visual contract; signatures diverge in subtle ways.

| File | Lines | Surface |
|---|---|---|
| `mission-control/src/shared/FormFields.jsx` | 111 | `Field`, `SelectField`, `TextAreaField` (no `PhoneField` / `DateField`); adds `optional` flag, `type` prop, ChevronDown on Select |
| `protection-portal/src/shared/FormFields.jsx` | 115 | `Field`, `PhoneField`, `DateField`, `SelectField` |
| `insurance-portal/src/shared/FormFields.jsx` | 116 | same as protection |
| `refi-portal/src/shared/FormFields.jsx` | 116 | same as protection |

**Plus broken-fragment `refi-portal/src/components/FormFields.jsx`** (107 lines, fragmentary; see § 7.3).

The mc variant added `TextAreaField` and a `type=` prop and dropped `PhoneField` / `DateField` (mc instead inlines a DOB-input + Calendar-icon-button workaround in `AddContactModal.jsx:432-448` — see § 3 below). protection / insurance / refi are byte-identical.

**Recommended destination:** `blinker-platform/components/FormFields.jsx` exposing `Field`, `SelectField`, `TextAreaField`, `PhoneField`, `DateField` — a strict superset. Each consumer keeps their existing imports working.
**Impact × Effort:** **High × M.** Four import paths change; consumer behavior unchanged.

### 2.5 `TopBar` — 4 near-identical (logo + tagline diverge only)

| File | Lines | Diverging slot |
|---|---|---|
| `mission-control/src/shell/TopBar.jsx` | 38 | "Mission Control" logo + tagline |
| `protection-portal/src/shell/TopBar.jsx` | 33 | "Protection Portal" + ShieldCheck icon |
| `insurance-portal/src/shell/TopBar.jsx` | 33 | "Insurance Portal" + Umbrella icon |
| `refi-portal/src/shell/TopBar.jsx` | 33 | "Refi Portal" + RefreshCcw icon |

**Plus broken-fragment `refi-portal/src/components/TopBar.jsx`** (42 lines; see § 7.3).

**Recommended destination:** `blinker-platform/components/TopBar.jsx` with `{ brand, icon, tagline, panelOpen, togglePanel, view }` props.
**Impact × Effort:** **Medium × S.** Worth doing as part of the 15c chrome sweep; not load-bearing for any other Wave.

### 2.6 `ViewSwitcher` — 3 near-identical (the customer/agent/partner trio)

| File | Lines | Notes |
|---|---|---|
| `protection-portal/src/shell/ViewSwitcher.jsx` | 75 | renders CustomerView / AgentView / placeholder partner |
| `insurance-portal/src/shell/ViewSwitcher.jsx` | 58 | same shape; uses `workflow` prop instead of `form` |
| `refi-portal/src/shell/ViewSwitcher.jsx` | 75 | same shape as protection |

(mission-control has no ViewSwitcher — its shell is persona-driven, not view-driven.)

The prop signatures diverged: protection/refi pass `{ form, updateForm, stepIdx, setStepIdx, devOptions }`; insurance passes `{ workflow, updateWorkflow, dev }`. Each `<CustomerView>` / `<AgentView>` is the per-app implementation.

**Recommended destination:** Defer. Each app's `ViewSwitcher` knows its own view surface — extracting requires rationalizing the prop contract first. Track as a "consider when 15c+f flips an ergonomic seam" follow-up.

### 2.7 Modal-shell pattern — 13+ inline backdrops

The `<div className="fixed inset-0 ... flex items-center justify-center p-4 z-50">` pattern is duplicated 13+ times across:

- `mission-control/src/components/AddVehicleModal.jsx:92`
- `mission-control/src/components/AddContactModal.jsx:365`
- `mission-control/src/components/NewOpportunityFlow.jsx:119`
- `mission-control/src/components/StartOpportunityFlow.jsx:415`
- `mission-control/src/components/TestModeToggleConfirm.jsx:49` (`z-40`)
- `protection-portal/src/shared/YmmtPicker.jsx:66`
- `protection-portal/src/views/agent/ApiResponsesModal.jsx:24`
- `protection-portal/src/views/customer/VehicleAdd.jsx:346`
- `protection-portal/src/views/customer/VinValidate.jsx:232`
- `insurance-portal/src/views/agent/ApiResponsesModal.jsx:146`
- `refi-portal/src/refinance-v2-prototype.jsx:2002, 2768, 3517, 3917`
- `refi-portal/src/results/InsuranceTeaser.jsx:115`
- `refi-portal/src/results/ProtectionPlanTeaser.jsx:173`
- `refi-portal/src/views/agent/ApiResponsesModal.jsx:59`

mc uses `bg-slate-900/50 backdrop-blur-sm`; the others use `bg-slate-900 bg-opacity-50` or `bg-opacity-60`. Same intent, two visual recipes.

**Recommended destination:** `blinker-platform/components/Modal.jsx` exposing `<Modal open onClose>{children}</Modal>` with backdrop-click + Escape-to-close + focus-trap baked in.
**Impact × Effort:** **High × M.** Each consumer is a 5-10 line refactor; no behavior change required if the new shell preserves backdrop-click semantics.

### 2.8 `ApiResponsesModal` — 3 implementations of the same idea

All three workflow apps surface a `view_api_responses`-gated modal listing JSON peeks.

| File | Lines | Persona check |
|---|---|---|
| `protection-portal/src/views/agent/ApiResponsesModal.jsx` | 73 | `if (persona !== 'super_admin') return null` (L21) |
| `refi-portal/src/views/agent/ApiResponsesModal.jsx` | 90 | similar |
| `insurance-portal/src/views/agent/ApiResponsesModal.jsx` | 197 | reads canon directly: `personasJson.personas[persona].permissions.includes('view_api_responses')` (L42-45) — diverged shape, also adds collapsible per-section + PostHog `api_responses_event_expanded` per toggle |

**Recommended destination:** `blinker-platform/components/ApiResponsesModal.jsx` once `blinker-platform/personas` lands. The component takes `{ persona, sections: [{ label, eventType, payload, eventId, eventTime }] }` and the per-app caller declares which sections to surface. Insurance's collapsible variant becomes the default; protection / refi gain the chevron+telemetry for free.
**Impact × Effort:** **Medium × M.** Depends on `personas/` package; sequence after 15d.

### 2.9 Pill / chip / badge JSX — 8+ in-place patterns

Status pills with conditional Tailwind classes are inlined:

- `mission-control/src/personas/admin/AdminHome.jsx:265` (`StatusPill({ status })` — emerald/amber/slate)
- `mission-control/src/personas/admin/UsersIndex.jsx:184` (`StatusPill({ status })`)
- `mission-control/src/personas/admin/Integrations.jsx:142` (`StatusPill({ status })`)
- `mission-control/src/personas/admin/UsersIndex.jsx:163` (`PersonaChip({ persona })`)
- `mission-control/src/personas/admin/OrgTree.jsx:184` (`IntegrationsPill({ configured, total, tone })`)
- `mission-control/src/personas/agent/ContactProfile.jsx:756, 827, 862, 876` (`PersonaPill`, `SourcePill`, `Pill`, `ChannelTypePill`)
- `mission-control/src/lib/canon.js:37` (`statusPillClasses(type, status)` — returns Tailwind class string)
- `protection-portal/src/views/agent/AgentChrome.jsx` (`pillClasses(status)`)
- `refi-portal/src/views/agent/AgentChrome.jsx` (`pillClasses(status)`)
- `protection-portal/src/views/customer/RecommendedCoverage.jsx:429` (`ResultChip`)
- `refi-portal/src/refinance-v2-prototype.jsx:3578` (`InsuranceSavingsBadge`)
- `refi-portal/src/results/InsuranceTeaser.jsx:176` (`InsuranceSavingsBadge` — duplicated in two refi files)

54 separate occurrences of `bg-{color}-100 text-{color}-700` style conditional class strings.

**Recommended destination:** `blinker-platform/components/Pill.jsx` exposing `<Pill tone="emerald|amber|rose|blue|slate|sky|indigo">{label}</Pill>` plus an opinionated `<StatusPill type status />` that wraps `mission-control/src/lib/canon.js::statusPillClasses` — once canon lift happens.
**Impact × Effort:** **Medium × M.** High-volume swap; impact is mostly readability + consistency, not bug-prevention.

### 2.10 Suspense fallback strips — 6+ inline copies

Per-Suspense-boundary inline `<div>Loading X…</div>`:

- `mission-control/src/App.jsx:466,501,521` (`<DevControlsLoading />`)
- `mission-control/src/components/AddVehicleModal.jsx:111` (inline)
- `mission-control/src/components/AddContactModal.jsx:474` (inline `Loading address fields…`)
- `mission-control/src/components/StartOpportunityFlow.jsx:645`
- `mission-control/src/components/NewOpportunityFlow.jsx:165`
- `mission-control/src/components/CoPilotPane.jsx:576,592` (`<EmbedLoading label="Loading refi agent view…" />`)
- `protection-portal/src/views/agent/AgentView.jsx:496` (`<CrossSellLoading />`)
- `protection-portal/src/views/customer/CustomerView.jsx:322,340,444` (`<CrossSellLoading />`)
- `protection-portal/src/views/customer/CrossSellChrome.jsx`

**Recommended destination:** `blinker-platform/components/SuspenseStripe.jsx` taking `{ label }`. Pure cosmetic lift; zero risk.
**Impact × Effort:** **Low × S.** Nice-to-have, not a 15c blocker.

### 2.11 Copy-to-clipboard helper

Same `navigator.clipboard.writeText(...).then(() => setCopied(true))` plus 1.2-second flash pattern duplicated in:

- `mission-control/src/shared/DevPanel.jsx:126-134` (`JsonBlock`'s `handleCopy`)
- `insurance-portal/src/views/agent/ConsumerLinkPanel.jsx:26-32` (the consumer-link "Copy" button)
- `protection-portal/src/views/agent/CaptureLinkForm.jsx` (likely — agreement copy)
- `refi-portal/src/views/agent/CaptureLinkForm.jsx` (likely — same shape)

**Recommended destination:** `blinker-platform/utils/clipboard.js` (`copyToClipboard(text)` returning a Promise) + a `<CopyButton text label />` component.
**Impact × Effort:** **Low × S.**

### 2.12 Field primitive wrappers — local divergent copies

The pattern `<Field label required error hint><input … /></Field>` exists in:

- `mission-control/src/components/AddContactModal.jsx:535` (local `Field`, with `required` + `hint`)
- mc's `src/shared/FormFields.jsx:6` (different `Field` — `optional` flag instead of `required`)

Two `Field` components with overlapping but different surfaces inside the same app. The shared `FormFields.Field` could subsume both with `{ label, optional, required, error, hint }`.
**Recommended destination:** Roll into the `blinker-platform/components/FormFields` lift in 2.4.

### 2.13 DOB-input + calendar-icon-button workaround

Just-shipped at `mission-control/src/components/AddContactModal.jsx:432-448` — `<input type="date">` with the native picker indicator hidden via Tailwind arbitrary variant (`[&::-webkit-calendar-picker-indicator]:hidden`) and a sibling Calendar-icon `<button>` that calls `input.showPicker()`. Single host today.

**Recommended destination:** `blinker-platform/components/DateInput.jsx` once a second consumer asks for it. **Don't lift today** — single-host, 3-strikes not met.
**Impact × Effort:** Track-only. Likely-second-consumer = insurance-portal's CaptureForm DOB collection (per `architecture/06-embedded-insurance-contract.md`).

### 2.14 PostHog shim files — 4 near-identical

Already covered in § 6 (telemetry). `mission-control/src/lib/posthog.js`, `protection-portal/src/lib/posthog.js`, `refi-portal/src/lib/posthog.js`, `insurance-portal/src/lib/posthog.js`. Three export `track(event, props)` with `window.posthog?.capture` fallback to `console.log`. Insurance exports `captureEvent(name, props)` which only `console.log`s — no posthog wiring at all.

**Recommended destination:** `blinker-platform/telemetry/index.js`.
**Impact × Effort:** **High × S.** See § 6 for event-name registry sizing.

### 2.15 Validators — 3 host repos with overlapping rules

| File | Surface | Notes |
|---|---|---|
| `mission-control/src/lib/contact-form.js` | `isValidEmail`, `isValidUSPhone10`, `normalizePhoneE164`, `normalizeZip5`, `isValidZip5`, `findContactMatch`, `buildHouseholdRelationship`, `validateContactForm`, `HOUSEHOLD_RELATIONSHIP_KINDS` | Author admits in header (`L4-7`): "may eventually graduate into a shared `@blinker/forms` surface (Phase 2 ergonomics)" |
| `protection-portal/src/lib/validators.js` | `validators.required`, `validators.vin`, `validators.zip` | Lifted from refi monolith (per file header) |
| `refi-portal/src/utils/validation.js` | `validators.required/email/usPhone/ssn/zip/state2/vin/flexDate/flexDateInPast/positiveCurrency/positiveInt`, `parseFlexDate`, `parseDob`, `ageYears`, `dobAdult`, `formatPhoneDisplay`, `sanitizeNumeric` | **File is broken** at L180 — `getSequence(form, hasCoApp) {` declared with no body; the export block follows immediately without closing. |

3-strikes met: same intent (form validation primitives) in 3 hosts, with refi being the richest superset.

**Recommended destination:** `blinker-platform/utils/validators.js` exposing the refi superset. Phone-display helper goes alongside.
**Impact × Effort:** **High × M.** The `refi-portal/src/utils/validation.js` repair is needed regardless; doing it as part of the lift is the cheap path.

---

## 3. Lift candidates (single-host today, multi-consumer-likely)

| File | Recommended destination | Rationale | Impact × Effort |
|---|---|---|---|
| `mission-control/src/components/AddContactModal.jsx` | mc-internal (keep) | Workflow-bound: dedupe via `findContactMatch`, household-relationship branch, mission-control's contact-canon shape baked in. Address sub-block already lifted via `AddressBlock`. | n/a |
| `mission-control/src/components/AddVehicleModal.jsx` | mc-internal (keep) | Wraps refi-portal's `VehicleAdd` with mc's modal chrome; the chrome belongs to mc until a second app needs the modal-around-VehicleAdd pattern. The `<Modal>` shell from § 2.7 is the actual lift. | n/a |
| `mission-control/src/components/{NewOpportunityFlow,StartOpportunityFlow,OpportunityTypeMenu}.jsx` | mc-internal (keep) | Mission-control-specific orchestration (opportunity-type picker → vehicle-pick → flow handoff). No other app currently starts an opportunity from outside its own workflow. | n/a |
| `mission-control/src/components/CoPilotPane.jsx` | mc-internal (keep) | THE mission-control-specific orchestrator. | n/a — but two anti-patterns inside, see § 7 |
| `mission-control/src/components/{TestModeBanner,TestModeToggleConfirm}.jsx` | `blinker-platform/components/` | Both surface canon `org.test_mode`; the banner is `architecture/10-admin-console.md`-mandated on every screen. Today only mc has admin chrome but `customer-portal` will need the banner when it lands. | Med × S — defer until customer-portal exists |
| `protection-portal/src/components/{PlanCard,planCardCopy}.{jsx,js}` | protection-internal (keep) | Workflow-coupled — imports `../lib/protection-pricing.js::effectiveMonthly`. Plan-card UX is protection-specific. | n/a |
| `protection-portal/src/shared/YmmtPicker.jsx` | protection-internal for now | mission-control consumes refi-portal's `VehicleAdd` (which embeds its own picker). Three apps on the YMMT picker isn't here yet. | n/a — track only |
| `protection-portal/src/shared/FluidPayHostedFields.jsx` | `blinker-platform/integrations/payments/fluidpay` (Phase 2) | Provider-pluggable abstraction matches Wave 15d's `email_verification` + `sms_lookup` pattern. Defer until payments work begins. | Med × L — Phase 2 |
| `refi-portal/src/components/{DevPanel,EmbeddedEntry,FormFields,JsonPeek,Stage2Shell,TopBar,WizardShell}.jsx` | **DELETE** | Broken file fragments (no function declarations; orphan bodies). Not exported from `index.js`, not imported anywhere. Hygiene-cleanup task. | High × S — delete |
| `refi-portal/src/components/AddressBlock.jsx` | `blinker-platform/components/AddressBlock.jsx` | **Wave 15c primary lift.** | High × S |
| `refi-portal/src/components/NotesPanel.jsx` | `blinker-platform/components/NotesPanel.jsx` | **Wave 15c primary lift.** | High × S |
| `refi-portal/src/components/TagPicker.jsx` | `blinker-platform/components/TagPicker.jsx` | **Wave 15c primary lift.** | High × S |
| `insurance-portal/src/views/agent/ConsumerLinkPanel.jsx` | `blinker-platform/components/ConsumerLinkPanel.jsx` (or `CapturedLinkPanel`) | Today: insurance-only. Both protection-portal AND refi-portal already render a "capture-link with copy + sent-at timestamp" affordance — see `protection-portal/src/views/agent/CaptureLinkForm.jsx` and `refi-portal/src/views/agent/CaptureLinkForm.jsx`. Three implementations, same pattern, ready to converge. | High × M |
| `insurance-portal/src/views/agent/AgentForceStatusBar.jsx` | `blinker-platform/components/AgentForceStatusBar.jsx` (after `personas/`) | Replaces protection's `AgentTopBar` (`protection-portal/src/views/agent/AgentChrome.jsx:46`) and refi's matching chrome. All three have the same shape: status pill + force-status select + persona switcher + view-API button. Lifting awaits `personas/` so the persona gate can be derived from canon. | High × M |
| `insurance-portal/src/views/agent/ApiResponsesModal.jsx` | `blinker-platform/components/ApiResponsesModal.jsx` (after `personas/`) | See § 2.8 — three apps, same idea, pick the insurance superset. | Med × M |

---

## 4. utils/ candidates

Inventory of every `src/lib/*.js` and `src/utils/*.js` across the four runnable apps. "Pure" = no React, no fetch, no localStorage.

### `mission-control/src/lib/`

| File | Exports | Purity | Recommended destination |
|---|---|---|---|
| `active-workflow.js` | `ActiveWorkflowContext`, `ActiveWorkflowProvider`, `useActiveWorkflow` | Mostly pure (uses React context only) | mc-internal — no second consumer |
| `canon.js` | `TYPE_LABELS`, `TYPE_BADGE`, `statusPillClasses`, `TODAY`, `ageDays`, `ageLabel`, `relativeTime` | Pure (reads canon JSON) | **`blinker-platform/utils/canon-ui.js`** when a second app needs status colorization. Today mc-only; protection / refi / insurance have their own per-AgentChrome `pillClasses(status)` (see § 2.9) — those are the second/third/fourth consumers. **3-strikes met today.** |
| `contact-form.js` | `isValidEmail`, `isValidUSPhone10`, `normalizePhoneE164`, `normalizeZip5`, `isValidZip5`, `findContactMatch`, `buildHouseholdRelationship`, `validateContactForm`, `HOUSEHOLD_RELATIONSHIP_KINDS` | Pure | Validators → `blinker-platform/utils/validators.js` (see § 2.15). `findContactMatch` → mc-internal (Phase 2 swap to API). `buildHouseholdRelationship` → `blinker-platform/api` once Phase 2 starts. |
| `contact-storage.js` | `loadNotes`, `loadActivities`, `saveNotes`, `saveActivities` | Side-effecting (localStorage) | mc-internal until Phase 2 (then deletes) |
| `permissions.js` | `effectiveBadges`, `can`, `badgesFromPersona`, `allBadges`, `badgesByCategory`, `allPresets` | Pure (reads canon) | **`blinker-platform/personas/index.js`** — the explicit lift target per ADR-11. Wave 15a/15b promised; queue for the next persona-gating consumer. |
| `posthog.js` | `track(event, props)` | Side-effecting (window.posthog) | **`blinker-platform/telemetry/index.js`** — see § 6 |
| `protection-initial-form.js` | `INITIAL_FORM`, `buildPrefillPatch` | Pure | mc-internal (mirrors refi-portal/protection-portal INITIAL_FORM; coupling is intentional) |
| `refi-initial-form.js` | `INITIAL_FORM`, `RELATIONSHIP_OPTIONS`, `buildPrefillPatch` | Pure | mc-internal |
| `session-data.js` | session contact / vehicle map helpers | Side-effecting (localStorage) | mc-internal until Phase 2 |
| `status-mapping.js` | `seedFromCanon`, `loadMapping`, `saveMapping`, etc. | Side-effecting (localStorage) | mc-internal until Phase 2 |

### `protection-portal/src/lib/`

| File | Exports | Purity | Recommended destination |
|---|---|---|---|
| `contact.js` | `seedActiveContact`, `seedActiveAddress`, `mirrorContactEditsToMember`, `mirrorAddressEditsToMember`, `pickActiveMember`, `formatAddressLabel`, `formatMemberLabel`, `buildMockHousehold` | Pure | protection-internal (workflow-bound to BillingPayment's flat-keys-mirror-into-household_members shape) |
| `fluidpay.js` | `loadFluidPayTokenizer`, `tokenizerEnv`, etc. | Side-effecting (DOM script load) | `blinker-platform/integrations/payments/fluidpay` — Phase 2 |
| `marketcheck.js` | `getVehicleValue`, etc. | Pure (deterministic mock; real version would fetch) | Mock stays protection-internal. Real client → `blinker-platform/integrations/vehicle_value/marketcheck` — Phase 2 |
| `plan-selector.js` | `selectPlans`, `listMatchingPlans` | Pure | protection-internal (Plan algorithm port from Rails — workflow-specific) |
| `posthog.js` | `track(event, props)` | Side-effecting | → `blinker-platform/telemetry/` (see § 6) |
| `protection-pricing.js` | `pmt`, `effectiveLifetimeInterestRate`, `protectionPlanMonthlyOnRefi`, `insuranceMonthlySavings`, `effectiveMonthly` | Pure | protection-internal (cross-sell math is workflow-specific by design — see file header L23-26) |
| `stoneeagle.js` | `getRates(...)` | Mock; pure-ish (timer + JSON copy) | protection-internal mock. Real client → `blinker-platform/integrations/protection_rates/stoneeagle` — Phase 2 |
| `validators.js` | `validators.{required, vin, zip}` | Pure | → `blinker-platform/utils/validators.js` (see § 2.15) |
| `vinDecode.js` | `fetchVinDecode`, `_ymmtMatch` | Side-effecting (fetch); **HARDCODED VinAudit API key** | Mock + key → `blinker-platform/integrations/vehicle_decode/vinaudit` — Phase 2. See § 8. |

### `insurance-portal/src/lib/`

| File | Exports | Purity | Recommended destination |
|---|---|---|---|
| `embedded-insurance-mock.js` | `authenticate`, `createLead`, `getLeadLink`, `subscribeWebhooks`, `simulateWebhook` | Side-effecting (timers, in-memory pub/sub) | insurance-internal mock. Real client → `blinker-platform/integrations/insurance_lead/embedded_insurance` — Phase 2 |
| `insurance-webhook-handler.js` | `handleWebhookEvent`, `applyToWorkflow` | Pure | insurance-internal (workflow-shape coupling) |
| `money.js` | `formatCents`, `annualizeFromCents` | Pure | **`blinker-platform/utils/money.js`** — protection-portal already imports it cross-app at `protection-portal/src/views/customer/RecommendedCoverage.jsx:43`. Two consumers today, third = customer-portal once it lands. **Lift candidate.** |
| `posthog.js` | `captureEvent(name, props)` | Side-effecting | → `blinker-platform/telemetry/` (see § 6 — event-naming-drift exhibit A) |

### `refi-portal/src/lib/` + `src/utils/`

| File | Exports | Purity | Recommended destination |
|---|---|---|---|
| `lib/posthog.js` | `track(event, props)` | Side-effecting | → `blinker-platform/telemetry/` |
| `lib/refi.js` | `runDecision({ form, orgConfig, ... })`, `useRefiPrequal`, `getSequence`, `INITIAL_FORM`, etc. | Mostly pure (one React hook) | refi-internal — workflow-specific decision engine; `architecture/02-integration-boundaries.md` already designates `src/lib/<workflow>.js` as the public surface for cross-app consumption (mission-control imports `getSequence` from here at `App.jsx:17`) |
| `utils/api.js` | `lookupZip`, `streetPredictions`, `fetchVinDecode`, etc. | Side-effecting (fetch); **HARDCODED keys** | Split: AddressBlock-related fetches stay inside `blinker-platform/components/AddressBlock.jsx` post-15c (already there). VIN decode → `blinker-platform/integrations/vehicle_decode/vinaudit` — Phase 2 |
| `utils/validation.js` | `validators.*`, `parseFlexDate`, `parseDob`, `ageYears`, `dobAdult`, `formatPhoneDisplay`, `sanitizeNumeric` | Pure | → `blinker-platform/utils/validators.js`. **File is broken at L180** — `getSequence` declaration with no body — repair as part of the lift. |

### Net `utils/` lift list (15c-adjacent, before any Phase 2 work)

| Lift | From | To | Trigger |
|---|---|---|---|
| `validators.js` | refi/utils/validation.js (superset) + protection/lib/validators.js + mc/lib/contact-form.js (subset) | `blinker-platform/utils/validators.js` | 3-strikes met |
| `money.js` | insurance-portal/lib/money.js | `blinker-platform/utils/money.js` | 2 consumers today; 3rd imminent (customer-portal) |
| `clipboard.js` | new file consolidating 4 inline copies | `blinker-platform/utils/clipboard.js` | 4 inline call sites |
| `canon-ui.js` (statusPillClasses + ageLabel + relativeTime) | mc/lib/canon.js | `blinker-platform/utils/canon-ui.js` (or roll into `components/Pill.jsx`) | 3-strikes already met across mc + protection/AgentChrome + refi/AgentChrome |

---

## 5. personas/ consumer sites

Sites that gate on persona today, OUTSIDE `mission-control/src/lib/permissions.js` itself.

| File:line | Pattern | Notes |
|---|---|---|
| `mission-control/src/App.jsx:590` | `if (persona === 'agent')` | top-level persona-route dispatch |
| `mission-control/src/App.jsx:610` | `if (persona === 'manager')` | same |
| `mission-control/src/App.jsx:611` | `if (persona === 'admin')` | same |
| `mission-control/src/App.jsx:612` | `if (persona === 'super_admin')` | same |
| `mission-control/src/personas/admin/AdminHome.jsx:58, 123` | `const isSuper = persona === 'super_admin'` | tile-render gate |
| `mission-control/src/personas/admin/OrgTree.jsx:36, 81, 84` | `if (persona === 'super_admin')` + label switch | scope gate (super sees all orgs vs admin sees own) |
| `protection-portal/src/views/agent/AgentChrome.jsx:62` | `const canViewApi = persona === 'super_admin'` | hides API-responses button |
| `protection-portal/src/views/customer/RecommendedCoverage.jsx:183, 193, 257, 277` | `persona === 'agent'` / `persona === 'consumer'` | renders agent-side vs consumer-side CTA layout |
| `protection-portal/src/views/customer/Confirm.jsx:176, 392, 395` | `persona === 'agent'` | toggles agent contact-card visibility + agent payment controls |
| `protection-portal/src/views/customer/ThankYou.jsx:246` | `_TODO (persona): when persona === 'agent'` | TODO comment — known future gate |
| `protection-portal/src/views/customer/BillingPayment.jsx:106-107` | `const isConsumer = persona === 'consumer'` / `const isAgent = persona === 'agent'` | branches the form layout |
| `insurance-portal/src/views/agent/AgentForceStatusBar.jsx:35-39` | reads canon: `personasJson.personas[persona].permissions.includes('view_api_responses')` | already canon-driven (correct shape — should be the lift template) |
| `insurance-portal/src/views/agent/ApiResponsesModal.jsx:42-45` | same canon-read pattern | same |
| `insurance-portal/src/views/agent/ApiResponsesModal.jsx:156` | `persona === 'super_admin' ? 'super admin' : persona` | display-label switch |
| `refi-portal/src/views/agent/AgentChrome.jsx:68` | `const canViewApi = persona === 'super_admin'` | same as protection |

**`canAddTags` / `canCreateTags` derivation sites** (NotesPanel embedders):

| File:line | Pattern |
|---|---|
| `protection-portal/src/views/agent/AgentView.jsx:317-318` | `const canAddTags = perms.includes('add_tags'); const canCreateTags = perms.includes('create_tags');` |
| `insurance-portal/src/views/agent/AgentView.jsx:126-127` | identical |
| (refi-portal embeds NotesPanel internally; same perms-lookup — verify in 15c) |

**Pattern observed:** Insurance gets it right (canon-driven `perms.includes(...)`); protection + refi short-circuit with `persona === 'super_admin'`. After `personas/` lift, the protection / refi callers should swap to `can(user, 'view_api_responses')`.

**Recommended `personas/` first-cut surface:**

```js
// blinker-platform/personas/index.js
export { effectiveBadges, can, badgesFromPersona, allBadges, badgesByCategory, allPresets }
  from './permissions.js';
// (lifted verbatim from mission-control/src/lib/permissions.js)
```

Trigger: when a second consumer (likely `insurance-portal/src/views/agent/AgentView.jsx`) needs the canon-permission read in shared form. Today insurance does it inline.

---

## 6. PostHog event taxonomy

**161 distinct events across 4 apps.** Bucketed:

### `mission_control.*` (35 events; consistent dotted form)
- `mission_control.admin.{audit_filter_changed, audit_viewed, config_saved, dashboard_tile_clicked, integration_credential_revealed, integration_credentials_updated, integration_opened, org_detail_opened, org_opened, org_tab_switched, test_mode_toggle_opened, test_mode_toggled, user_badges_changed, user_opened, user_persona_changed, user_saved, user_suspended}`
- `mission_control.contact_profile.{add_vehicle_opened, add_vehicle_saved, closed, household_member_clicked, new_opportunity_created, new_opportunity_opened, new_opportunity_vehicle_picked, note_added, opened, start_opportunity_from_vehicle, tag_clicked}`
- `mission_control.copilot.{available_statuses_threaded, copilot_closed, copilot_opened, copilot_persona_propagated, embed_mounted, embed_unavailable}`
- `mission_control.home.{add_contact_opened, add_contact_saved, kpi_clicked, start_opportunity_after_add_contact, start_opportunity_clicked, start_opportunity_contact_picked, start_opportunity_created, start_opportunity_dob_collected, start_opportunity_dob_gate_opened, start_opportunity_opened, start_opportunity_vehicle_picked, start_opportunity_vehicle_skipped, viewed}`
- `mission_control.pane.dismissed`
- `mission_control.status_mapping.{exported, opened, reset_to_canon, row_added, row_deleted, saved, workflow_switched}`
- `mission_control.super.tile_clicked`

### `protection.*` (~50 events; consistent dotted form)
- `protection.agent.{api_responses_viewed, capture_link_created, capture_link_generation_started, capture_link_sent, persona_switched, save_and_send, status_overridden}`
- `protection.billing.contact_switched`
- `protection.cross_sell.{insurance_cleared, insurance_clicked, insurance_completed, insurance_contact_confirmed, refi_cleared, refi_clicked, refi_co_app_chosen, refi_completed, refi_prequal_decision, side_pane_closed, side_pane_opened, subflow_closed, subflow_opened}`
- `protection.customer.{billing_payment.failed, billing_payment.tokenized, billing_payment.viewed, confirm.continued, confirm.viewed, customize.continued, customize.criteria_changed, customize.plan_navigated, customize.reset_to_recommended, customize.viewed, docuseal.completed, docuseal.viewed, flow_completed, garage_location.continued, garage_location.get_rates.failed, garage_location.get_rates.received, garage_location.get_rates.requested, garage_location.viewed, modifications.cleared, modifications.continued, modifications.toggled, modifications.viewed, recommended_coverage.continued, recommended_coverage.customize_requested, recommended_coverage.plan_selected, recommended_coverage.viewed, thank_you.payment_agreement_clicked, thank_you.product_agreement_clicked, thank_you.viewed, vehicle_add.continued, vehicle_add.viewed, vehicle_add.vin_decode_failed, vehicle_add.vin_decode_started, vehicle_add.vin_decoded, vehicle_add.vin_mismatch_confirmed, vehicle_add.vin_mismatch_shown, vehicle_drive.continued, vehicle_drive.market_check_failed, vehicle_drive.market_check_fetched, vehicle_drive.viewed, vehicle_use.continued, vehicle_use.selected, vehicle_use.viewed, vin_validate.completed, vin_validate.matched, vin_validate.mismatch_confirmed, vin_validate.mismatch_shown, vin_validate.viewed}`

### `refi.*` (~12 events; consistent dotted form)
- `refi.agent.{api_responses_viewed, capture_link_created, capture_link_generation_started, capture_link_sent, persona_switched, save_and_send, status_overridden}`
- `refi.prequal.{disclosure_agreed, disclosure_opened, submitted}`
- `refi.subflow.{cancelled, completed, opened}`

### `insurance.*` — **DRIFT** (mixed dotted + snake_case)

Dotted (correct):
- `insurance.agent.api_responses_event_expanded`
- `insurance.agent.api_responses_opened`
- `insurance.agent.status_forced`

Snake_case (legacy / drift):
- `insurance_capture_card_uploaded`
- `insurance_capture_submitted`
- `insurance_consumer_link_created`
- `insurance_consumer_link_sent`
- `insurance_lead_duplicate`
- `insurance_lead_origination_failed`
- `insurance_lead_origination_started`
- `insurance_policy_switch_clicked`
- `insurance_quote_viewed_simulated`
- `insurance_webhook_received`

Call-site evidence:
- `insurance-portal/src/views/agent/LeadOriginationForm.jsx:195, 241, 246, 262, 281, 307` — snake_case
- `insurance-portal/src/views/customer/CaptureForm.jsx:52, 63` — snake_case
- `insurance-portal/src/views/agent/AgentView.jsx:99` — dotted
- `insurance-portal/src/views/agent/AgentForceStatusBar.jsx:83` — dotted

**`dev.*` events (mc-only, low taxonomy):**
- `dev.seed_multi_contact_applied`
- `dev.seed_multi_contact_toggled`

**Other one-offs:**
- `billing.{address_resolved, address_switched, contact_edited, tcpa_displayed}` — protection without prefix? Likely should be `protection.billing.*` (protection.billing.contact_switched already exists). Drift candidate.
- `confirm.{discount_applied, down_payment_changed, first_payment_date_changed, months_to_pay_changed}` — same drift; should be `protection.customer.confirm.*`.

**Recommended `telemetry/` first-cut:**

```js
// blinker-platform/telemetry/index.js
export function track(event, props) { /* lifted from refi/protection/mc shim */ }
export function captureEvent(event, props) { /* alias for insurance back-compat; deprecate */ }

// Optional: a registry helper that warns on unknown events in dev.
export const KNOWN_EVENTS = [/* the 161 listed above */];
```

**Trigger:** Before insurance-portal's snake_case events grow further. The drift cost is real — operator dashboards already have to list both forms.

---

## 7. Anti-patterns

### 7.1 Cross-app deep imports

Per `architecture/02-integration-boundaries.md`, allowed cross-app paths are exactly: `src/views/customer/index.js`, `src/views/agent/index.js`, `src/components/index.js`, `src/lib/<workflow>.js`. Anything else is a violation.

| File:line | Import | Violation | Suggested fix |
|---|---|---|---|
| `mission-control/src/components/CoPilotPane.jsx:18` | `import { INITIAL_FORM as PROTECTION_INITIAL_FORM } from 'protection-portal/src/views/customer/CustomerView.jsx';` | Reaches into a leaf screen. | Re-export `INITIAL_FORM` from `protection-portal/src/views/customer/index.js`. |
| `mission-control/src/components/CoPilotPane.jsx:122` | `import('refi-portal/src/views/customer/RefiWizard.jsx')` (lazy) | Same — RefiWizard is a private leaf. | Re-export `RefiWizard` from `refi-portal/src/views/customer/index.js`. (`AgentView` is already there.) |

These are pre-existing — not introduced by Wave 15. Worth fixing in 15c since the import-path sweep is happening anyway.

### 7.2 mission-control's local `NotesPanel`

`mission-control/src/personas/agent/ContactProfile.jsx:319, 700` declares + renders a **second, divergent** `NotesPanel` component that shadows the shared `NotesPanel` exported from `refi-portal/src/components`. The mc local one has a different shape (`{ notes, draft, setDraft, onAdd }` with author-pill + per-note timestamp + persistence-via-localStorage at `lib/contact-storage.js`). The shared one is a controlled view (`{ notes, onNotesChange, selectedTagIds, onTagAdd, ... }`).

These don't conflict at runtime (mc's local one is hoisted / scope-local), but the name collision is confusing. Two acceptable resolutions:
1. Rename mc's local to `ContactNotesList` (most accurate — it's a list-with-input-card, not a single-pane notes input).
2. Refactor mc's notes UX to consume the shared `NotesPanel` post-15c. Not blocked, but real work.

### 7.3 Broken file fragments in `refi-portal/src/components/`

The following 7 files in `refi-portal/src/components/` are broken artifacts (header imports + orphan function body, no `export` of the half-component, never imported anywhere):

- `refi-portal/src/components/DevPanel.jsx` (310 lines)
- `refi-portal/src/components/EmbeddedEntry.jsx` (174 lines)
- `refi-portal/src/components/FormFields.jsx` (107 lines)
- `refi-portal/src/components/JsonPeek.jsx` (29 lines)
- `refi-portal/src/components/Stage2Shell.jsx` (39 lines)
- `refi-portal/src/components/TopBar.jsx` (42 lines)
- `refi-portal/src/components/WizardShell.jsx` (92 lines)

Each starts with the same boilerplate (imports + `useState`) followed by an immediate `return (` or const declaration with no enclosing function. Compiles only because nothing imports them. Verified with `grep -rn "from .*components/{name}"` returning zero hits across all 6 repos.

`refi-portal/src/components/index.js:268-270` only re-exports `AddressBlock`, `NotesPanel`, `TagPicker` — these 7 are explicitly NOT in the public surface.

**Recommended action:** Delete in Wave 15c hygiene commit (after the trio lift). They look like a half-finished extraction attempt the author abandoned; deleting them removes the misleading carcass.

### 7.4 Broken file: `refi-portal/src/utils/validation.js:180`

`function getSequence(form, hasCoApp) {` declared with no body. The `export {...}` block at L182 follows immediately, exporting `sanitizeNumeric, parseFlexDate, parseDob, ageYears, dobAdult, formatPhoneDisplay` — without `getSequence`. Compiles but the function body is missing. Repair as part of the validators-lift (§ 2.15).

### 7.5 Vite plugin `refiConstantsBarrelShim` (likely no-op now)

`protection-portal/vite.config.js:28-55` carries a plugin to rewrite `refi-portal/src/constants/index.js` imports to `disqual-reasons.js` because the constants-index file was previously broken (uneven brackets). I verified the bracket count is balanced today (8 opens / 8 closes). The shim's heuristic — `if (opens === closes) return null;` — short-circuits for this case, so the shim is a passthrough.

ADR-11 § Open questions / _TODO already flags this for removal post-15c. The shim becomes truly dead once consumers stop transiting through `refi-portal/src/constants/index.js` for AddressBlock-related imports — which is the case once `AddressBlock` lifts to `blinker-platform/components`.

---

## 8. Hardcoded secrets

| File:line | Secret | Used by | Canon migration target |
|---|---|---|---|
| `refi-portal/src/components/AddressBlock.jsx:69` | `PLACES_API_KEY = "AIzaSyDm1wo_5vN-ioDQ3K1gB3zi42c0o0bSPhY"` (Google Places "New" REST autocomplete) | All current AddressBlock consumers (refi, protection, mc) | `canon/integrations.json::providers.google_places.credentials_per_org` (or env-var fallback) — JSDoc at `AddressBlock.jsx:23-28` already anticipates `import.meta.env.VITE_GOOGLE_PLACES_KEY` as the migration path. **Documented; tracked.** |
| `refi-portal/src/refinance-v2-prototype.jsx:486` | `VINAUDIT_API_KEY = "2S1SZI7HUF89L6Z"` | refi monolith (legacy) | Same as below — same key, three sites |
| `refi-portal/src/utils/api.js:149` | `VINAUDIT_API_KEY = import.meta.env.VITE_VINAUDIT_API_KEY \|\| "2S1SZI7HUF89L6Z"` | refi-portal app | Already env-aware; **best canonization model** |
| `protection-portal/src/lib/vinDecode.js:11` | `VINAUDIT_API_KEY = '2S1SZI7HUF89L6Z'` | protection-portal | `canon/integrations.json` — Phase 2 lift via `blinker-platform/integrations/vehicle_decode/vinaudit` |

The Google key sits in the `AddressBlock` body and ships into every consumer transparently. The VinAudit key is duplicated 3× — only the refi-portal `utils/api.js` copy is env-aware.

**Recommended:** When 15d adds NeverBounce + Twilio Lookup providers, fold a `canon/integrations.json` entry for `vinaudit` and `google_places` simultaneously. Each provider's credentials live per-org in `canon/org-registry.json::orgs[*].integrations[<provider>]`.

---

## Ranked Wave 15c+ extraction backlog

| Rank | What | From → To | Wave | Impact | Effort | Notes |
|---|---|---|---|---|---|---|
| 1 | `AddressBlock` + `NotesPanel` + `TagPicker` | `refi-portal/src/components/` → `blinker-platform/components/` | 15c | High | S | Verbatim lift; 6 import paths change; JSDoc ports. **Do this first.** |
| 2 | Delete 7 broken fragments | `refi-portal/src/components/{DevPanel,EmbeddedEntry,FormFields,JsonPeek,Stage2Shell,TopBar,WizardShell}.jsx` | 15c-hygiene | High | S | Dead code; misleading; not imported. Same commit as #1. |
| 3 | Repair + lift `validators` | refi/utils/validation.js + protection/lib/validators.js + mc/lib/contact-form.js (subset) → `blinker-platform/utils/validators.js` | 15c-fu | High | M | Repair `getSequence` first; superset lift; touches 3 apps. |
| 4 | `track()` + event registry | 4× posthog.js → `blinker-platform/telemetry/index.js` | 15c-fu | High | S | Mechanical; converges insurance snake_case at lift time. |
| 5 | `JsonPeek` + `WizardShell` + `DevPanel` chrome | 4× per shell file → `blinker-platform/components/` | 15c-fu | High | M | mc's DevPanel is a superset — lift the protection/insurance/refi shape; mc converges in a follow-up. |
| 6 | `PhoneInput` + `EmailInput` (with NeverBounce + Twilio Lookup hooks) | NEW components + 15d integrations | 15e | High | M | Per ADR-11 phasing. |
| 7 | `personas/` first cut | `mission-control/src/lib/permissions.js` → `blinker-platform/personas/index.js` | post-15e | High | M | Triggered by 2nd consumer. Insurance's canon-driven `perms.includes(...)` becomes the canonical pattern. |
| 8 | `Modal` shell | NEW component to consolidate 13 inline backdrops | post-15e | Med | M | Lifecycle event when 14+ inline backdrops feels expensive — already there. |
| 9 | `money.js` + `clipboard.js` | utils consolidations | post-15e | Med | S | money.js: 2 consumers today, customer-portal makes 3. clipboard: 4 inline copies. |
| 10 | `AgentForceStatusBar` + `ApiResponsesModal` | 3× per-app → `blinker-platform/components/` | post-personas | Med | M | Depends on `personas/`. Replaces protection / refi / insurance per-app implementations. |

**Long tail (file pointers, not ranked):**
- `Pill` / `StatusPill` consolidation (10+ in-place pill helpers) — see § 2.9. Track until a third consumer bumps the priority.
- `TopBar` lift — § 2.5. Cosmetic only; do as part of customer-portal's onboarding.
- `ConsumerLinkPanel` + `CaptureLinkForm` shared shell — § 3 last row. 3 apps, same pattern; queue when capture-link UX changes.
- `protection-portal/src/shared/FluidPayHostedFields.jsx` → `blinker-platform/integrations/payments/fluidpay` — Phase 2.
- `protection-portal/src/lib/{stoneeagle,marketcheck,vinDecode}.js` → `blinker-platform/integrations/*` — Phase 2.
- `insurance-portal/src/lib/embedded-insurance-mock.js` → `blinker-platform/integrations/insurance_lead/embedded_insurance` — Phase 2.
- `mission-control/src/components/{TestModeBanner,TestModeToggleConfirm}.jsx` lift — defer until customer-portal needs them.
- mc's local `NotesPanel` shadowing — rename or converge (see § 7.2).

---

## Open questions / decisions surfaced

1. **mc's `DevPanel` divergence — converge now or in 15c-fu?** mc added `JsonBlock` + `Row` + collapsible `Section` + a different `DevPanel` prop shape. Recommendation: lift the smaller shape first (15c-fu) as the v1 surface; mc gets its existing imports for free; mc converges to the shared shell in a follow-up commit when the team owns the visual diff. **Default if no decision: lift the smaller shape now.**
2. **mc's local `NotesPanel` shadow — rename now or in a converge wave?** mc has its own NotesPanel that doesn't follow the shared contract. Recommendation: **rename to `ContactNotesList` in 15c-hygiene** (cheap; removes confusion; doesn't touch shared NotesPanel). Real convergence is a separate ergonomics decision. **Default: rename in 15c-hygiene.**
3. **`captureEvent(name, props)` vs `track(event, props)` API name** — insurance uses `captureEvent`, the others use `track`. ADR-11 § 6 prefers a single name. Recommendation: `track` matches PostHog's `posthog.capture()` mental model for everyone except insurance. Lift as `track`, alias `captureEvent` for back-compat in `blinker-platform/telemetry/`, mark `captureEvent` `@deprecated` so the next insurance touch swaps it. **Default: alias-and-deprecate.**
4. **`canon-ui.js` (`statusPillClasses` + `relativeTime` + `ageDays`) — `utils/` or `components/Pill.jsx`?** `statusPillClasses` returns Tailwind class strings, not JSX. Recommendation: stays in `utils/` (matches the "pure libs" charter); the `<Pill>` component in `components/` reads from `utils/canon-ui.js`. **Default: utils/.**
5. **`refi-portal/src/utils/validation.js::getSequence` — repair body during the lift, or before it?** The function declaration is open with no body. Recommendation: repair as part of the lift commit — the missing body content lives in `refi-portal/src/lib/refi.js::getSequence` (a different file, complete impl) which is the canonical version. The `utils/validation.js` empty stub looks like it was meant to be deleted, not filled in. **Default: delete `getSequence` from utils/validation.js entirely (it's already exported from lib/refi.js).**
6. **VinAudit `2S1SZI7HUF89L6Z` key — leak risk?** Hardcoded 3× across two repos. Recommendation: noted-and-tracked, no immediate action — this is a pre-existing prototype-era pattern that 15d-onwards will canonize. **Default: track in 15d.**
7. **`protection-portal/vite.config.js::refiConstantsBarrelShim` — drop in 15c?** Confirmed no-op today (constants/index.js bracket-balance check passes). Recommendation: drop as part of the 15c sweep — fewer Vite-config oddities is always a win. **Default: drop in 15c.**

**No decisions block 15c.** Everything above is "ergonomics or hygiene" rather than "missing prerequisite". 15c can ship with just decisions 1, 2, 7 made (defaults are reasonable), and the rest can ride along in follow-up commits or future waves.
