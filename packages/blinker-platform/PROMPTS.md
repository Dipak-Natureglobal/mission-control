# PROMPTS — Copy-Paste for Each Child App Session

> The coordinator (this repo) generates these. The user opens a fresh Cowork or Claude Code session in the relevant child app and pastes the prompt. Each prompt assumes the AI in that session will read its own CLAUDE.md + README.md before doing anything.

## protection-portal

### § substrate (first prompt — Phase 1A start)

Open `protection-portal` in a fresh session and paste:

> Read CLAUDE.md and README.md to orient. Then scaffold the Phase 1 minimum substrate: package.json (mirror the refi prototype's at `~/Documents/Claude/Projects/refi-portal/refi-prototype/package.json`), vite.config.js (with `server.port = 5175`), index.html, src/main.jsx, src/App.jsx with a DEV CONTROLS sidebar + ViewSwitcher (customer / agent / partner), src/hooks/useForm.js (lifted from `~/Documents/Claude/Projects/refi-portal/refi-prototype/src/hooks/useForm.js`), src/shared/{WizardShell, FormFields, JsonPeek, DevPanel}.jsx (lifted from `~/Documents/Claude/Projects/refi-portal/refi-prototype/src/components/`), src/shell/{TopBar, ViewSwitcher}.jsx, and a TopBar that says "Protection Portal". Run `npm install && npm run dev` and verify it renders Hello + DEV CONTROLS at localhost:5175. Don't add the workflow content yet — substrate only. Once it's running, report back to me what's working.

### § customer view (next, after substrate is running)

> Substrate works. Now lift VehicleAdd and VehicleDrive from the refi prototype (`~/Documents/Claude/Projects/refi-portal/refi-prototype/src/screens/VehicleAdd.jsx` and `VehicleDrive.jsx`) into `src/views/customer/`. Adapt them to the consumer self-serve PDF mockup at `docs/mockups/Consumer Self Serve - VSC, Refi, Insurance.pdf`. Wire them as the first two steps of the customer wizard. Use mocked StoneEagle GetRates response from `src/fixtures/stone-eagle-get-rates.json` (capture from the legacy walkthrough — see `~/Documents/Claude/Projects/BlinkerLegacy/docs/mission-control/current-state/screens/05-new-applicant-coverage-details.md` for the response shape).

### § coverage details + plan selector (after VehicleAdd/Drive)

> Read protection-portal/CLAUDE.md and protection-portal/README.md to orient. Then read STATUS.md in `~/Documents/Claude/Projects/blinker-platform/` to confirm current state — VehicleAdd + VehicleDrive shipped, CustomerView wizard scaffold uses vehicle_add → vehicle_drive → coverage_preview placeholder, StoneEagle GetRates fixture wired and stashed on `form.rates`.
>
> Three things to land in this session:
>
> **1) VIN-mismatch confirmation pass on VehicleAdd (locked decision; currently un-implemented).** Today the picker fields disable when VIN decode succeeds — that's the gap. Required: support both VIN-first (decode populates picker but leaves fields editable) and manual-first (user picks YMMT, then optionally enters VIN). On Continue, if decoded YMMT ≠ selected YMMT, show a confirmation modal with both candidates side-by-side, a brief reason ("Your VIN decoded as a 2022 Ford Bronco Sport but you selected Ford Bronco — these are different vehicles."), and two buttons: "Use VIN result" / "Keep my selection". Never silently substitute. Persist the choice on `form.vehicle` and emit `vehicle_add.vin_mismatch_shown` + `vehicle_add.vin_mismatch_confirmed` with the chosen direction. Match → proceed silently. Why: legacy production bug (silent Bronco → Bronco Sport substitution); locked decision in README.md.
>
> **2) Lift VehicleUse + Modifications from refi.** ⚠️ CORRECTION (2026-05-02 post-session): refi-prototype has **no** VehicleUse / Modifications screens — refi jumps from VehicleDrive to ownership/credit. Legacy walkthrough screens 06-/07- in `~/Documents/Claude/Projects/BlinkerLegacy/docs/mission-control/current-state/screens/` are **payment-options** screens, not use/modifications. So neither refi nor legacy walkthrough is a lift source for these. Build both screens from CLAUDE.md/README spec only. Note in each file header that copy is placeholder pending canon. Watch for refi-prototype paste artifacts when lifting **other** screens (truncated function signatures, triple-declared constants — see STATUS.md risks).
>
> **3) Build RecommendedCoverage (new screen).** Three plan cards (Good/Better/Best) rendered from `form.rates.products` (populated by the StoneEagle GetRates fixture at `src/fixtures/stone-eagle-get-rates.json`). Map products → quality tier using `src/constants/canon/plan-mappings.json`. Best selected by default. Port PlanSelectorService from `~/Documents/Claude/Projects/BlinkerLegacy/blinker/app/services/plan_selector_service.rb` into `src/lib/plan-selector.js` (single function in/out, no Rails-isms). PostHog: `recommended_coverage.viewed`, `plan_selected` with `{ tier, plan_code, term_months, miles }`.
>
> Wire the four screens into CustomerView so the wizard becomes: vehicle_add → vehicle_drive → vehicle_use → modifications → recommended_coverage. Drop the coverage_preview JsonPeek placeholder. When done, report back: file list, PostHog event names, spec gaps (especially modifications copy).

### § billing + signing (after plan selector)

> Now build Customize, CaptureContact, Confirm, BillingPayment, VinValidate, DocuSeal placeholder, ThankYou. For Billing, lift FluidPay tokenizer + hosted fields from `~/Documents/Claude/Projects/payment-processing-platform/efs-prototype/src/lib/fluidpay/` and `src/components/FluidPayHostedFields.jsx`. DocuSeal is a placeholder iframe in Phase 1 ("Phase 2 will load real DocuSeal here"). VinValidate is the post-payment screen that fires only when no VIN was entered at quote time — see `~/Documents/Claude/Projects/BlinkerLegacy/docs/mission-control/current-state/AUDIT-2026-05-02.md` § "Consumer /vin_check route" for the logic.

### § agent view + status export (final piece for protection-portal Phase 1)

> Read protection-portal/CLAUDE.md and protection-portal/README.md to orient. Then read STATUS.md in `~/Documents/Claude/Projects/blinker-platform/` to confirm current state — customer view is feature-complete (11/11) pending real-browser smoke; FluidPay creds unwired (dev-fallback active); this is the final piece for protection-portal Phase 1.
>
> Build `src/views/agent/`. Same workflow as the customer view, with agent affordances layered on. **Compose** the existing customer screens inside an `AgentShell` wrapper rather than duplicating them. AgentShell adds:
>
> **1) CaptureLinkForm** at entry — email + phone, Generate synthesizes `?view=customer&token=CAPTURE_<24-hex>` and locks; Send mocks Twilio/Mandrill (console log) and emits `protection.agent.capture_link_sent`. Status flow: created → `capture_link.created` → `capture_link.sent`. Don't replicate insurance-portal's webhook subscription — protection status moves via consumer actions on customer view, not partner webhooks. Status taxonomy from `canon/ghl-status.json` `vsc` block (display names only — no `machine_id` yet; note canon TODO inline).
>
> **2) "Save and Send" handoff** at the bottom of every wizard step — saves in-flight opportunity, re-sends consumer link with deep-link to current step. Emits `protection.agent.save_and_send`.
>
> **3) "View API Responses" modal** — super_admin only. Persona via prop or DEV CONTROLS toggle (the real PersonaSwitcher lives in mission-control). Shows raw StoneEagle GetRates payload (`form.rates`), raw VinAudit decode if present, FluidPay tokenize response. Gate: `persona === 'super_admin'` from `canon/personas.json`. Emits `protection.agent.api_responses_viewed`.
>
> **4) Status override DEV CONTROLS** — select labeled "Force opportunity status" populated from `canon/ghl-status.json` `vsc` block. Emits `protection.agent.status_overridden { from, to }`. Stub for what mission-control will eventually drive remotely.
>
> **5) Agent notes panel** — textarea persisted to component state. Emits `protection.agent.note_added` on blur. Don't build activity log; mission-control owns that.
>
> **6) Public export** — `src/views/agent/index.js` re-exports `AgentView` as a named export so mission-control can `import { AgentView } from 'protection-portal/src/views/agent'` via a `file:` dependency. Only AgentView is public.
>
> When done, update STATUS.md: flip the agent-view acceptance to ✅; protection-portal section moves to "✅ Phase 1 complete pending real-browser smoke". Mission-control section: CoPilotPane right pane fully unblocked. Report file list, public API surface, PostHog events, and any spec gaps (especially around VSC status machine_ids — that's a canon update not in this session's scope).

## mission-control

### § substrate (first prompt — Phase 1B start, parallel to protection-portal substrate)

Open `mission-control` in a fresh session and paste:

> Read CLAUDE.md and README.md to orient. Then scaffold the Phase 1 minimum substrate: package.json (mirror the refi prototype's at `~/Documents/Claude/Projects/refi-portal/refi-prototype/package.json`), vite.config.js (with `server.port = 5177` to avoid conflict with refi :5173, EFS :5174, protection-portal :5175, insurance-portal :5176), index.html, src/main.jsx, src/App.jsx with a DEV CONTROLS sidebar + PersonaSwitcher (agent / manager / admin / super), src/hooks/useForm.js (lifted from refi prototype), src/shared/{WizardShell, FormFields, JsonPeek, DevPanel}.jsx (lifted from refi prototype), src/shell/{TopBar, PersonaSwitcher, Nav}.jsx, and a TopBar that says "Mission Control". Each persona shell stub (AgentInbox, ManagerHome, AdminHome, SuperHome) should render a placeholder card so persona switching feels real. The agent persona is the priority for Phase 1; others are stubs. Run `npm install && npm run dev` and verify it renders the persona switcher at localhost:5177. Don't add opportunity composition yet (no protection-portal imports yet) — substrate + persona switching only.

### § agent inbox (after substrate)

> Substrate works. Now build AgentInbox: an opportunity-centric queue (replaces the legacy flat Products Dashboard). Use the Payment Plans table layout from `~/Documents/Claude/Projects/payment-processing-platform/efs-prototype/src/App.jsx` as the visual pattern. Mock 8-12 opportunities in `src/fixtures/opportunities.json` covering all 4 workflow types (protection / refi / insurance / payments) and several statuses. Sortable by status / age / owner. Status pills come from `src/constants/canon/ghl-status.json`. Clicking an opportunity opens a placeholder right-pane (CoPilotPane is next prompt).

### § co-pilot pane (after AgentInbox; requires protection-portal § AgentView exported — ✅ as of 2026-05-03)

> Read mission-control/CLAUDE.md and mission-control/README.md to orient. Then read STATUS.md in `~/Documents/Claude/Projects/blinker-platform/` to confirm current state — protection-portal Phase 1 is ✅; `AgentView` is exported as a named export from `protection-portal/src/views/agent`; AgentView ships baked-in status pill, force-status select, capture-link gate, sticky Save and Send, NotesPanel, ApiResponsesModal. **Don't duplicate those in mission-control's left pane.**
>
> **1) Wire the file: dep.** Add `"protection-portal": "file:../protection-portal"` to mission-control's `package.json`. Run `npm install`. Verify `import { AgentView } from 'protection-portal/src/views/agent'` resolves. React versions match (both 19) so no manual dedupe.
>
> **2) Build CoPilotPane** as two regions. **Left pane** = mission-control-specific opportunity context (opportunity header — ID + workflow + age — slim contact summary, "Related opportunities" stub for ContactProfile to expand later). **Right pane** = `<AgentView persona={currentPersona} personaLocked={true} />`.
>
> **3) Plumb persona** from mission-control's PersonaSwitcher into AgentView. `personaLocked: true` hides AgentView's local switcher. Persona changes re-render AgentView with the new View-API-Responses gate. Event: `mission_control.copilot.persona_propagated`.
>
> **4) Replace CoPilotPlaceholder** in the AgentInbox row-click drawer with CoPilotPane. Pass the selected opportunity row down. Drawer stays closed when no row selected.
>
> **5) PostHog events** — `mission_control.copilot.*` namespace: `copilot_opened`, `copilot_closed`, `copilot_persona_propagated`. Don't shadow `protection.agent.*` which AgentView emits for its own actions.
>
> **6) Known gotchas:**
> - AgentView's status-pill helper and AgentInbox's row-pill helper are duplicated; accept it (STATUS.md tracks the consolidation TODO when a 3rd consumer arrives).
> - AgentView NotesPanel is session-only by design (mission-control owns activity log).
> - VSC canon `machine_id` gap means status names are display strings; don't fix here.
> - Vite HMR may not propagate `file:`-linked changes — restart dev server if AgentView changes don't appear.
>
> When done, update STATUS.md: flip CoPilotPane + View-API-Responses-modal acceptance items to ✅; mission-control § Next becomes ContactProfile. Surface any spec gaps (especially around opportunity → contact resolution since fixtures may not include full contact fields).

### § contact profile (after CoPilotPane — flips meta-Phase-1 to ✅)

> Read mission-control/CLAUDE.md and mission-control/README.md to orient. Read STATUS.md in `~/Documents/Claude/Projects/blinker-platform/` — protection-portal ✅, insurance-portal ✅, mission-control AgentInbox + CoPilotPane done, ContactProfile is the only remaining Phase 1 build. Also read `architecture/07-data-layer.md` and `canon/blinker-domain.json` — Blinker DB is source of truth; canonical contact shape is in `blinker-domain.json` (plural phones/emails/addresses, vehicles as array), NOT the GHL V1/V2/V3 projection.
>
> Build ContactProfile per Mission Control 2.0 PDF at `mission-control/docs/mockups/Blinker Mission Control 2.0.pdf`. If PDF missing, proceed from layout below and flag.
>
> **Layout:**
> 1. **Household band** — name, members, primary indicator.
> 2. **Contact card** — name, plural phones/emails/addresses, tags (canonical shape, arrays not singletons).
> 3. **Vehicles** — array per `blinker-domain.json` (year/make/model/trim/vin/mileage/ownership). Not V1/V2/V3.
> 4. **Opportunities** — rows with workflow type / status pill / age / next action. Click → opens CoPilotPane with opp loaded.
> 5. **Notes panel** — persisted (distinct from AgentView's session-only opp-scoped NotesPanel). Author + timestamp + body. Phase 1 = local fixture state.
> 6. **Activity feed** — mixed timeline (calls / emails / status changes / payment events / signatures / partner webhooks).
>
> **Data work:** expand `src/fixtures/contacts.json` to canonical shape; run `scripts/validate-fixtures.js` (in blinker-platform) — current version flags shape drift, new version must pass. New fixtures: `households.json`, `notes.json` (keyed by contact_id), `activities.json` (~10–15 mixed events per contact).
>
> **Route:** `?view=contact-profile&contact_id=<id>` or via click on contact name in CoPilotPane left pane. Replace CoPilotPane's "Related opportunities" stub with a real list filtered from opportunities.json.
>
> **PostHog:** `mission_control.contact_profile.{viewed, opportunity_clicked, note_added, activity_filter_changed}`.
>
> **Gotchas:** PDF may not be on disk; canon `household`/`vehicle`/`note`/`activity` blocks are stubbed (infer + note canon TODO inline); don't fix protection-portal AgentView's two pending one-line touch-ups in this session; persona-routing limitation is out of scope.
>
> When done, flip ContactProfile + Notes/activity acceptance to ✅; mission-control section header → ✅ Phase 1 complete; update Phase 1 build order so customer-portal becomes the next active target. Report file list, fixture sample rows, PostHog events, validate-fixtures.js outcome, canonical-shape gaps hit.

## insurance-portal

### § substrate (first prompt — parallel with protection-portal substrate)

Open `insurance-portal` in a fresh session and paste:

> Read CLAUDE.md and README.md to orient. Then scaffold the Phase 1 minimum substrate: package.json (mirror the refi prototype's), vite.config.js (with `server.port = 5176`), index.html, src/main.jsx, src/App.jsx with DEV CONTROLS + ViewSwitcher (customer / agent / partner), src/hooks/useForm.js (lifted), src/shared/{WizardShell, FormFields, JsonPeek, DevPanel}.jsx (lifted from refi prototype), src/shell/{TopBar, ViewSwitcher}.jsx, TopBar says "Insurance Portal". Run `npm install && npm run dev` at localhost:5176. Substrate only.

### § agent view first (after substrate — capture link generation)

> Now build the agent view first. It's where insurance flow originates: agent generates a capture link → SMS/email sent to consumer → consumer fills capture form → webhook back. Build `src/views/agent/CaptureLinkForm.jsx` that takes consumer email/phone, generates a fake capture URL `/p/CAPTURE_<token>` and "sends" it (mock Twilio/Mandrill calls, just log to PostHog). Use `src/constants/canon/ghl-status.json` (insurance subset) for status names.

### § customer capture + quote (after agent view)

> Now build the customer view. Capture form: upload insurance card photo / enter details, submit → mock Embedded Insurance webhook fires → status: capture.completed. Then quote review screen with mocked premium + savings (use `src/fixtures/embedded-insurance-quote.json`). Switch CTA at the bottom.

### § savings card export (after quote view)

> Build SavingsCard as a public exported component. Takes premium + savings + carrier props and renders a small card. Export it so protection-portal can `import { SavingsCard } from 'insurance-portal/src/views/customer'`. Update STATUS.md: insurance-portal § SavingsCard is exposed. This unblocks protection-portal Confirm screen optionally rendering the cross-sell.

## Phase 1.5 — cross-sell orchestration

These prompts implement the architecture/08-cross-sell-orchestration.md decisions: protection-portal becomes the orchestrator for cross-sell embeds; refi-portal joins as a second embed source. Run in order — § 1.5d depends on § 1.5b + § 1.5c.

### § 1.5b refi-portal substrate + customer view

**Prerequisite state (verified 2026-05-03):** local directory at `~/Documents/Claude/Projects/refi-portal/`, GitHub remote at `github.com/BlinkerGit/refinance-prototype`. App source is currently nested one level deep at `refi-portal/refi-prototype/` — this prompt's substrate work will flatten it to root (`git mv refi-prototype/* .` style) as the first commit, so the result matches the `*-portal/` flat-layout convention. If `~/Documents/Claude/Projects/refi-portal/refi-prototype/package.json` doesn't exist, stop and tell me — the rename or remote got moved.

Open `refi-portal/` in a fresh session and paste:

> Read CLAUDE.md and README.md (write fresh ones if absent — mirror `~/Documents/Claude/Projects/protection-portal/CLAUDE.md` + `README.md` shape). Then read STATUS.md in `~/Documents/Claude/Projects/blinker-platform/` and `architecture/02-integration-boundaries.md` + `architecture/08-cross-sell-orchestration.md` to understand the orchestration target this work feeds.
>
> The repo today is the lifted refi-prototype. Reshape it into the platform pattern matching protection-portal + insurance-portal:
>
> 1. **Substrate.** package.json with name `"refi-portal"`, vite.config.js with `server.port = 5179`, src/main.jsx + src/App.jsx with the standard DEV CONTROLS sidebar + ViewSwitcher (customer / agent / partner). useForm hook, shared/{WizardShell, FormFields, JsonPeek, DevPanel}.jsx — lift from protection-portal's substrate, NOT the prototype's older copy. Sync canon into `src/constants/canon/` (run `~/Documents/Claude/Projects/blinker-platform/scripts/sync-canon-into-apps.sh` after the canon `_version` is whatever's current — likely `2026-05-03-cross-sell-orchestration` or later).
> 2. **Customer view at `?view=customer`.** Lift screens from the existing prototype source under `src/screens/` (the rename preserved them) and arrange into `src/views/customer/`. Mirror protection-portal's `ProtectionWizard` composition pattern — extract the screen sequence into a `RefiWizard` component so the agent view can compose the same screens later without duplication. Use the prototype's existing fixtures where they exist; supplement with new ones in `src/fixtures/` only as needed. Document the embed contract surface in a comment block on `src/views/customer/index.js` even though no exports are public yet — § 1.5c lands those.
> 3. **Persona prop convention.** Customer view component reads `persona` + `personaLocked` from props (default `'consumer'` / `false`). No persona switcher inside customer view — that's the agent view's job. This is the embed-don't-fork rule per `architecture/02-integration-boundaries.md`.
> 4. **DEV CONTROLS.** Persona, force-status (stub), prefill applicant (stub), JsonPeek of `form` and `dev` slices. Match protection-portal's pattern.
>
> Do NOT touch the agent view this session — § 1.5c is a separate prompt. Do NOT export anything from `src/views/customer/index.js` yet — public exports also land in § 1.5c after the agent shell wraps them.
>
> When done, update STATUS.md: refi-portal Phase 1.5b ✅; report file list, fixture inventory, and any spec gaps (especially around the prototype's older substrate vs the protection-portal pattern — refi-prototype paste artifacts are a known risk, see STATUS.md). The expected port-up is :5179.

### § 1.5c refi-portal agent view + hybrid mode + public exports + rich DEV CONTROLS port-forward

> Read refi-portal/CLAUDE.md and refi-portal/README.md to orient. Then read STATUS.md in `~/Documents/Claude/Projects/blinker-platform/` and `architecture/08-cross-sell-orchestration.md` to confirm the orchestration target. Customer view shipped (Phase 1.5b ✅); this session adds the agent shell + the public surface protection-portal will consume in § 1.5d, AND ports the prototype's rich DEV CONTROLS forward (Phase 1.5b only landed the substrate stub).
>
> **Push policy:** DO NOT push to GitHub during this session. The user wants refi-portal local-only until Phase 1.5 is complete.
>
> **Five concrete chunks.** Aim for one logical commit per chunk.
>
> ### Chunk A — Port `runDecision()` into `src/lib/refi.js` as a pure function
>
> The prototype's decision engine is closed over `dev.orgConfig` + `DEFAULT_ORG_CONFIG` + `dev.forcePartner` + `dev.forceResult` + `dev.includeSsn` + `dev.disqualReason` inside `src/refinance-v2-prototype.jsx` around line 955. Extract it into a pure function in `src/lib/refi.js`:
>
> ```js
> export function runDecision({ form, orgConfig, forcePartner, forceResult, includeSsn, disqualReason }) {
>   // returns { result, partner, partnerName, partnerPhone, externalApplicationId, log, reason? }
> }
> ```
>
> Plus a thin React wrapper:
>
> ```js
> export function useRefiPrequal({ contactId, vehicleId }) {
>   // returns { submitPrequal, prequalState, offers, decision }
> }
> ```
>
> Both customer-view (PrequalForm sub-flow embedded in protection-portal § 1.5d) and agent-view consume these. Don't refactor the algorithm — port it as-is. The 13 screen-wrappers in `src/views/customer/` should swap from importing the inlined `runDecision()` to importing this pure function.
>
> ### Chunk B — Rich DEV CONTROLS port-forward
>
> The current `src/shell/DevControls.jsx` has only a stub (persona + persona-locked + force-status + prefill-applicant + form/dev JsonPeeks). The prototype had ~15 sections that need to come back. Port forward each section from `src/refinance-v2-prototype.jsx` lines 1278–1548 (the `DevPanel` function and its `Section` / `Segmented` helpers):
>
> 1. **Prefill payload (JSON)** — textarea + Apply button + presets grid. Source: `src/constants/prefill-presets.js` (already in repo). Keys: applicant, coApplicant, vehicle (vehicle may include vin).
> 2. **Org config (disqualification rules)** — JSON textarea + Apply / Reset buttons + parse-error display. Source: `DEFAULT_ORG_CONFIG` in the monolith. The decision engine reads this. Schema includes APR floors/ceilings, term floors/ceilings, partner network thresholds, etc. — preserve verbatim.
> 3. **Force partner routing** — Segmented: Auto / Gravity / SG / None.
> 4. **Force Stage 2 result** — Segmented (vertical): Auto (from rules) / Pre-approved / Offers returned / Disqualified / Pending / async.
> 5. **Disqualification reason** — conditional dropdown when force-result === "disqualified". Source: `DISQUAL_REASONS` constant.
> 6. **SSN provided** — Segmented: Yes / No. (Drives `dev.includeSsn` which Gravity Lending checks.)
> 7. **Co-applicant** — Segmented: Auto / Yes / No.
> 8. **Protection plan sold** — Segmented Yes/No on `form.planSold` (drives the cross-sell teaser on Stage 2 result).
> 9. **Insurance reviewed** — Segmented Yes/No on `form.insuranceReviewed` (drives the insurance teaser).
> 10. **Insurance savings found** — conditional Segmented Yes/No when insuranceReviewed (drives the savings figure).
> 11. **Jump to screen** — vertical button list of every screen in the wizard sequence (including `embedded_entry`). Active screen shows a chevron.
> 12. **Embedded card state** — Segmented: Pre-apply / Post-result. (For the partner-embed quote-time view.)
> 13. **Inspector → Show JSON peek** — checkbox toggling the form/dev JsonPeek visibility.
> 14. **Reset prototype** — red button at the bottom that clears all dev state + resets form.
>
> Plus the `Section` and `Segmented` helper components — lift them too, they're tight and well-shaped. Adapt only the styling if the new substrate uses different Tailwind utilities (the prototype uses dark sidebar; protection-portal already uses similar; check both).
>
> The DEV CONTROLS sit in the substrate (visible across customer / agent / partner views) — they are NOT agent-view-specific, so they live in `src/shell/DevControls.jsx`, not `src/views/agent/`. The agent shell will compose AgentView and DEV CONTROLS in parallel (same as protection-portal).
>
> ### Chunk C — Build `src/views/agent/`
>
> Same workflow as the customer view, with agent affordances layered on. **Compose** the existing customer screens inside an `AgentView` wrapper rather than duplicating them (mirror protection-portal's `AgentView` + `ProtectionWizard` pattern). AgentView accepts `{ persona, personaLocked }` props (the embed-don't-fork rule). Layer on:
>
> - **CaptureLinkForm** at entry — email + phone, Generate synthesizes `?view=customer&token=PREQUAL_<24-hex>` and locks; Send mocks Twilio/Mandrill (console log) and emits `refi.agent.capture_link_sent`. Status flow uses `canon/ghl-status.json` `refi` block. Note: refi status block currently has `** TBD **` rows in canon (per STATUS.md "Pending canon work"); use display strings + an inline canon-TODO note, same as protection-portal did with VSC.
> - **"Save and Send" handoff** at the bottom of every wizard step — mocks consumer link with deep-link to current step. Emits `refi.agent.save_and_send`.
> - **"View API Responses" modal** — super_admin only (gate on `persona === 'super_admin'` from `canon/personas.json`). Shows raw decision-engine response (the `log` array from `runDecision`), raw lender-offer payloads, raw partner-routing decision. Drives off `useRefiPrequal`'s state.
> - **Force opportunity status select** — already part of substrate DEV CONTROLS (Chunk B section 4 above is force-result; this is a different concept — actual opportunity status from canon, not Stage-2 outcome). Render in the agent's TopBar like protection-portal's AgentChrome does.
> - **Agent notes panel** — textarea persisted to component state. Emits `refi.agent.note_added` on blur.
>
> ### Chunk D — Public exports
>
> Add named exports to `src/views/customer/index.js`:
>
> - `PrequalForm` — collects applicant + employment + housing for prequal; calls `useRefiPrequal` internally. **This is a NEW slim form, NOT a re-export of an existing screen.** It's a single page (or short pager) consumed by protection-portal § 1.5d's RecommendedCoverage embed; the full multi-screen wizard is overkill for the cross-sell context. Use the prototype's existing field shapes from Applicant.jsx + Employment.jsx + Housing.jsx — same data, condensed UI.
> - `OffersCard` — renders returned lender offers (rate / term / monthly). Lift from the prototype's `EmbeddedPost` component (around line 1640).
> - `QualifiedCard` — terminal "you're qualified, here's what next" card. Lift from the prototype's qualified-state branch in `EmbeddedPost`.
>
> Add `src/views/agent/index.js` exporting `AgentView` so mission-control can compose it via `file:` dep later (matches protection-portal's surface).
>
> Document the embed contract on each export with a JSDoc comment listing accepted props + a one-line "consumed by" note.
>
> ### Chunk E — Wire DEV CONTROLS state through to the wizard
>
> Currently `RefiWizard` owns its form state locally; the prototype's monolith owned everything in `App` so `dev.*` and `form.*` were both available to every screen. Lift the form state up to `App` (or to `CustomerView`) so:
>
> - DEV CONTROLS toggles (force-result, prefill, etc.) actually mutate something the wizard reads.
> - `prefillApplicant` toggle wires to `src/constants/prefill-presets.js` and applies on click (no longer a stub).
> - The decision engine in `src/lib/refi.js` reads from form state passed as a prop, not from a global.
>
> ### Hard rules
>
> - **No push.** GitHub remote exists for refi-portal at `BlinkerGit/refinance-prototype`; do not push. The user wants local-only commits until Phase 1.5 is complete.
> - **No new features.** Port forward what the prototype had + add the agent shell pieces. Don't redesign UX.
> - **Halt and report rather than guess.** Halt if: chunk B can't fit a section without inventing UI; chunk D's new PrequalForm needs a layout decision (prototype didn't have a single-page version); chunk E's lift-state-up requires bigger surgery than expected.
>
> When done, update STATUS.md: refi-portal Phase 1.5c ✅; protection-portal § 1.5d unblocked. Report file list, public surface (named exports + JSDoc), `runDecision` extraction (line count moved out of monolith), DEV CONTROLS section count + parity with prototype, PostHog events, and any spec gaps for § 1.5d.

### § 1.5d protection-portal embed wiring

> Read protection-portal/CLAUDE.md and protection-portal/README.md to orient. Then read STATUS.md + `architecture/08-cross-sell-orchestration.md` + `architecture/02-integration-boundaries.md` in `~/Documents/Claude/Projects/blinker-platform/`. refi-portal Phase 1.5b + 1.5c are ✅; this is the wiring session that turns protection-portal into the cross-sell orchestrator.
>
> Five things land in this session:
>
> **1) Wire `file:../refi-portal` dep.** package.json gets `"refi-portal": "file:../refi-portal"`. `npm install` creates the symlink. vite.config.js's existing `react`/`react-dom` aliases dedupe through it (same pattern as `file:../insurance-portal`); no `optimizeDeps` tweaks needed. Header comment in `RecommendedCoverage.jsx` documenting the HMR caveat (restart dev server after upstream changes) — same wording as mission-control's `CoPilotPane.jsx`.
>
> **2) `src/lib/protection-pricing.js` — both math models, kept SEPARATE.** Implement:
>
> - `pmt(principal, annualRate, termMonths)` — standard fixed-payment amortization.
> - `effectiveLifetimeInterestRate(principal, annualRate, termMonths)` — total finance charge / principal, derived from PMT.
> - `protectionPlanMonthlyOnRefi({ planTotal, loanPrincipal, apr, termMonths })` — translates `BlinkerLegacy/blinker/lib/blinker/amortization/fixed_term.rb#products_payment` exactly. Returns the per-month addition to a refi payment for rolling the protection plan into the loan. Affordability framing.
> - `insuranceMonthlySavings({ currentPremiumCents, newPremiumCents, termMonths })` — `(current - new) / termMonths` in cents, clamped to >= 0. Savings framing.
> - `effectiveMonthly({ baseProtectionMonthly, insuranceSavings, refiAddition })` — pure derivation; no state.
>
> Two functions, two framings, no unification. Worked example for `protectionPlanMonthlyOnRefi`: $3,692 / 60mo / 8.99% APR → ~$77/mo (see ADR § Math models).
>
> **3) RecommendedCoverage gets two agent CTAs + buying-power UI.** Two buttons rendered above the plan cards (agent persona) or below them (consumer persona): "Find insurance savings" and "Lower your monthly with refinance". Per-org gated via `orgRegistry.orgs.find(o => o.id === orgId)?.cross_sell.{insurance_enabled,refi_enabled}` — disabled CTAs render a tooltip "Not enabled for this org". When `form.insuranceSavings` is set, the plan card's monthly shows a strikethrough on the original price + the discounted price (buying-power UI from the refi-prototype screenshots). When `form.refiOffer` is set, a "+$X/mo on your refi" line appears below the plan card. Both: a clear-button pattern to remove the cross-sell offer.
>
> **4) Customer-view sub-flow with breadcrumb-style "Back to coverage".** When the consumer clicks a CTA, navigate to a sub-step (`?view=customer&substep=insurance-savings` or `?substep=refi-prequal`). The sub-flow renders the embed's customer flow inline (NOT a modal). A persistent breadcrumb at the top: `Coverage › Find insurance savings` (or `› Lower your monthly with refinance`); the first crumb is a back-link that returns to RecommendedCoverage with form state preserved. Sub-flow termination (success or back) writes to `form.insuranceSavings` / `form.refiOffer` and returns to RecommendedCoverage.
>
> **5) DEV CONTROLS toggles.** "Insurance cross-sell enabled" and "Refi cross-sell enabled" — both default-on for org 102, both DEV-CONTROLS-overrideable. JsonPeek shows `form.insuranceSavings` and `form.refiOffer` slices. PostHog: `protection.cross_sell.insurance_clicked|completed|cleared` and `protection.cross_sell.refi_clicked|completed|cleared`.
>
> **Critical: agent surface.** When `persona === 'agent'`, the cross-sell renders as a side pane (CoPilotPane-style), NOT a sub-flow. Two columns: RecommendedCoverage on the left, the embed on the right. Agent stays in protection context. Customer view sub-flow ONLY for consumer persona.
>
> Use `import { CaptureForm, SavingsCard } from 'insurance-portal/src/views/customer'` and `import { PrequalForm, OffersCard, QualifiedCard } from 'refi-portal/src/views/customer'`. Per `architecture/02-integration-boundaries.md`, NEVER import from deeper paths.
>
> When done, update STATUS.md: Phase 1.5d ✅; customer-portal unblocked. Report bundle-size before/after, PostHog event names, integration smoke results, and any embed-contract drift you found in refi-portal's public surface (file an issue against refi-portal if so — don't fix it from this session).

## customer-portal — WAIT

Don't start until protection-portal, mission-control, and insurance-portal all check ✅ in STATUS.md.

### § substrate (when unblocked)

Open `customer-portal` in a fresh session and paste:

> Read CLAUDE.md and README.md to orient. Verify in `~/Documents/Claude/Projects/blinker-platform/STATUS.md` that protection-portal, mission-control, and insurance-portal are all at Phase 1 ✅. If not, stop and tell me which are blocked. If all green, scaffold the substrate by lifting the token-driven SPA pattern from `~/Documents/Claude/Projects/payment-processing-platform/customer-portal/`: lib/token.js, App.jsx state machine (loading/invalid/loaded/success), Header/InvalidLink/LoadingState/SuccessState components. vite.config.js port 5178. Substrate only.

## blinker-platform (this repo) — coordinator session

### § canon update workflow

When the user wants to update canon:

> The user wants to change canon. Edit the relevant file in `canon/`. Bump `canon/_version` to today's ISO date with a short tag (e.g., `2026-05-15-refi-status-fix`). Run `./scripts/sync-canon-into-apps.sh`. Update STATUS.md to note: "canon bumped to vYYYY-MM-DD-tag; child apps need to commit their `src/constants/canon/` updates." Tell the user to do `git add` + commit in each child repo.

### § "what's next?" workflow

When the user asks "what should I work on next?":

> Read STATUS.md. Identify the next unblocked acceptance item across all child apps in build order (protection-portal → mission-control → insurance-portal → customer-portal). Pull the matching prompt from PROMPTS.md, paste it back to the user, tell them which Cowork project to open, and ask them to come back to this repo when done so STATUS.md can be updated.

### § "X is done" workflow

When the user reports a chunk is done:

> Update STATUS.md: check off the acceptance item, update the **Status:** line if a major milestone (⏳ → 🟡 → ✅). If the completion unblocks a downstream Blockers: line, surface that explicitly. Bump **Last updated:** at top. Suggest the next prompt.

## Wave 13 follow-ups (filed 2026-05-05; dispatchable individually or as a Wave 14 batch)

### § 13-fu-1 — `availableStatuses` prop on portal AgentViews

Dispatch protection-portal + insurance-portal agents in parallel. Paste:

> Wave 13 follow-up. Mission-control `SuperHome` ships a status-mapping editor (commit `5f46e4c`) that persists per-org status mappings to localStorage `mc.status-mapping.v1`. Wiring CoPilotPane to pass that mapping down to the portal's FORCE STATUS picker is blocked because:
> - `protection-portal/src/views/agent/AgentChrome.jsx:30` reads `Object.keys(vscCanon?.vsc?.statuses || {})` directly — no override prop.
> - insurance-portal `AgentView` doesn't render a force-status picker today (only the timeline). Locate it (likely in dev controls) and apply the same prop pattern.
>
> Add an `availableStatuses` prop (Array<string>) to each portal's public AgentView surface. When set, override the canon-derived list. When unset/null, fall back to canon (today's behavior — backwards compatible). Thread the prop down to the picker. Don't touch mission-control — coordinator wires the consumer side after this lands. Halt-and-report on ambiguity. Each portal = one commit. Do NOT push.

### § 13-fu-2 — insurance-portal `AgentView` lean mode for consumer embeds

Dispatch one insurance-portal agent (which also commits a tiny protection-portal change). Paste:

> Wave 13 follow-up. `AgentView` is the only public surface (LeadOriginationForm + LeadStatusTimeline + ConsumerLinkPanel are private). Wave 13b protection-portal cross-sell mounts `AgentView` for the consumer-facing cross-sell, which surfaces NotesPanel in a consumer context — harmless but cluttered.
>
> Add a `mode` prop (`'agent' | 'lean'`, default `'agent'`). When `mode === 'lean'`: suppress NotesPanel in BOTH pre-send and post-send. Pre-send single-column form-only is unchanged. Post-send in lean mode renders LeadStatusTimeline + ConsumerLinkPanel single-column (no right rail). Make sure the prop is plumbed via `src/views/agent/index.js` public surface. Then update protection-portal CrossSellSubFlow to pass `mode="lean"` when mounting (small upstream-coupled change in protection-portal — make this its own commit).
>
> Two commits total: insurance-portal `feat(public):` + protection-portal `feat(cross-sell):`. Do NOT push. Halt-and-report on ambiguity.

### § 13-fu-3 — refi-portal `CaptureLinkForm` defensive contact reseed

Dispatch one refi-portal agent. Paste:

> Wave 13 follow-up. Defensive hardening only — not a today-bug. `CaptureLinkForm` derives prefill via `useMemo([contactProp?.id])`. Today the parent `key={…}` remount in CoPilotPane handles contact-id changes correctly, but the form will not reseed if `contactProp` ever updates without an opp/key change (e.g., a household-member jump in CoPilot's right pane).
>
> Add a `useEffect([contactProp?.id])` that resets `useForm` state when the id changes — guard with `if (contactProp?.id && contactProp.id !== lastSeenIdRef.current)` to prevent loops. Standalone usage (contactProp undefined) is byte-identical. Single commit, `fix(captureLinkForm):` prefix. Do NOT push.

## blinker-platform (coordinator-driven)

### § 21-fu — StoneEagle eContracting follow-up wave (backlog)

Wave 21 landed eRating (`GetRates`) only. eContracting (`GenerateContract` / `VoidContract` / `PrintContractPDF` / eSignature) is a separate wave.

Coordinator session in `blinker-platform/`:

> Read STATUS.md, then ADR `architecture/13-stoneeagle-integration.md`, then the v1.37 spec at `architecture/integration-partners/stoneeagle/SEFI-SCS-eContracting-Integration-Guide-v1.37.pdf` (use `osascript -l JavaScript -e 'ObjC.import("PDFKit"); ...'` for text extraction — see Wave 21 chat history for the exact pattern).
>
> Land the eContracting surface at `packages/integrations/product_admin/`:
>
> 1) **`bookContract(input, ctx)`** in `index.js` — POSTs the finalized contract per v1.37 §GenerateContract (selected plan + term/mileage/deductible + options + customer + lien-holder + Base64-encoded signed `ContractPDF`). Returns `{ status, contract_number, effective_date, effective_odometer, expiration_date, expiration_odometer, contract_document, total_warranty_terms, taxes, messages }`. Phase 1 returns a deterministic mock contract number; Phase 2 routes through the same backend SOAP proxy as GetRates. Same `_PROVIDER_MODE` constant as `stoneeagle.js`.
>
> 2) **`voidContract(contract_number, ctx)`** + **`printContractPDF(contract_number, ctx)`** per v1.37 §VoidContract / §PrintContractPDF. Phase 1 stubs return `{ status: 'ok' }` / a fixture PDF blob respectively.
>
> 3) **`getTrimsByVIN(vin, ctx)`** (v1.31 §Get Trims By VIN) — auxiliary call. Drives the `ERATING_TRIMREQ` retry path inside `getRates` itself: when GetRates returns that error code, the facade automatically calls `getTrimsByVIN`, surfaces the trim list to the consumer, and re-fires GetRates with the chosen trim. Mirror legacy `error_code_handler.rb` retry logic.
>
> 4) **`getLienholders(query, ctx)`** (v1.31 §Get Lienholders) — auxiliary, drives lien-holder dropdown in protection-portal's `BillingPayment.jsx`.
>
> 5) **DocuSeal template alignment** — DocuSeal templates must render PDF form fields named per the SCS `Sign<SignatureType><Actor><Date>` convention (`SignFullBuyer`, `SignFullBuyerDate`, `SignFullCoBuyer1`, `SignFullCoBuyer1Date`, `SignFullSeller`, `SignFullSellerDate`, `SignInitBuyer`, `SignInitCoBuyer1`). Update `canon/integrations.json::providers.docuseal.fields.template_overrides` documentation.
>
> 6) **protection-portal `ThankYou.jsx`** — replace the placeholder `AMR` + 13-digit fake contract number with the real `ContractNumber` from `bookContract`. Dispatch a sonnet agent for the swap (file scope: just `ThankYou.jsx` + the bookContract call site, likely in `Confirm.jsx` or a post-DocuSeal callback in `DocuSeal.jsx`).
>
> Update ADR 13's "Backlog — eContracting" section to reflect what landed. Bump `canon/_version`. Update `STATUS.md` with the wave entry. Sync canon into child apps.

### § 22-v304 — protection-portal v3.0.4 wizard polish (single agent, opus)

Wave 22 Phase 1 (canon + packages) already landed in coordinator (canon `_version` `2026-05-09-v304-wizard-polish`). This is the protection-portal Phase 2 dispatch — 6 PDF tasks that all touch protection-portal.

Open `protection-portal` in a fresh session and paste:

> Read protection-portal/CLAUDE.md and protection-portal/README.md to orient. Read STATUS.md in `~/Documents/Claude/Projects/blinker-platform/` (top section — Wave 22 Phase 1 just landed in coordinator: canon `add_on_passthrough` block, org-level `coverage_term_defaults` + `coverage_miles_defaults`, per-payment-plan-provider down-payment fields on Apex 102's Ensurety, new `packages/utils/protection-addons.js` helper). Run `npm install` ONCE up front to refresh the `file:../blinker-platform` symlink against the new canon + packages exports — DO NOT run `npm run dev`, `npm run build`, or `npm install` again between commits (sandbox-kill risk per platform memory).
>
> Implement the 6 v3.0.4 PDF tasks in a SINGLE commit (or two if a clean cut between Tasks 5+6 vs Tasks 1-4 helps reviewability):
>
> **Task 1 — VehicleUse + coverage card add-on (BUSINESS USE).** When user picks Rideshare or Commercial on `src/views/customer/VehicleUse.jsx`, write `form.requiredAddOns: ['business_use']` (extend `INITIAL_FORM` in `src/views/customer/CustomerView.jsx` to seed `requiredAddOns: []`). On RecommendedCoverage + Customize, every plan card surfaces the add-on cost via the new helper.
>
> **Task 2 — Maintenance Feature included badge.** When a plan's `add_ons_included[]` contains an add-on whose `name` matches "Extended Maintenance - Annual" or "Extended Maintenance - monthly" (deref by ID via `rates.add_ons[]` for fixture-shape data), badge the card with "Maintenance Feature included" (no price change — `cost_passthrough: false` in canon).
>
> **Task 3 — VinValidate prior-YMMT echo.** In `src/views/customer/VinValidate.jsx`, ABOVE the VIN input, render a prominent reminder of the YMMT the user entered earlier ("You told us: 2022 Honda Element Ex"). Today the file already shows it BELOW the input in muted text (line 201-204) — move it above and bump prominence (slate-100 panel + label "You told us:" + bold YMMT). The existing `MismatchModal` (line 213-220) already shows before/after side-by-side after decode — leave it. Emit `protection.customer.vin_validate.prior_ymmt_shown { ymmt }`.
>
> **Task 4 — Modifications add-on (Enhanced Electronics + Navigation).** Extend `MODIFICATION_OPTIONS` in `src/views/customer/Modifications.jsx` with two new options: `{id:'enhanced_electronics', label:'Enhanced Electronics'}` and `{id:'navigation', label:'Navigation'}`. These are NORMAL toggleable mods — they write to `form.modifications[]` like the others. The cost passthrough + badge surfacing happens automatically via the helper because canon `add_on_passthrough.{enhanced_electronics,navigation}` has `trigger: form.modifications.includes(...)`.
>
> **Task 5 — Customize range sliders.** Replace the existing `<Stepper>` for "Coverage period" and "Mileage cap" in `src/views/customer/Customize.jsx` with a new `<RangeSlider>` (two thumbs, discrete-snap to the values in `form.rates.filters.coverage_periods_months[]` / `mileages[]`). Bounds = filters min/max. Initial thumb positions = the org's `protection_billing.coverage_term_defaults.{min,max}` and `coverage_miles_defaults.{min,max}` (read via `import orgRegistry from '../constants/canon/org-registry.json'` then `orgRegistry.orgs.find(o=>o.id===form.org_id)?.protection_billing?.coverage_term_defaults`). Snap to nearest discrete option on drop. Carry both thumbs in `form.customizeCriteria.termRange: [min,max]` + `milesRange: [min,max]` (extend INITIAL_FORM). Pass to a new range-aware overload of `listMatchingPlans` in `src/lib/plan-selector.js` — extend signature to accept `termRange` + `milesRange` (back-compat: when `term`/`miles` exact passed, today's behavior; when range passed, filter plans whose `coverage_months` AND `coverage_miles` fall within range). Carousel shows all matching plans within range. Build new `src/components/RangeSlider.jsx` (hand-rolled, no dep — match the existing Stepper's lightweight pattern). Keep deductible as the existing single-value pill stepper (the spec only mentions term + miles). Emit `protection.customer.customize.range_changed { field, min, max }`.
>
> **Task 6 — $X/mo tooltip on PlanCard.** In `src/components/PlanCard.jsx`, attach a hover/click tooltip on the `~$XX/mo` line. Tooltip text: `"$XX/mo for N months with $YYY down"`. Resolve N + YYY via this precedence:
>   1. Look up the org's primary payment-plan provider — for Apex 102, that's Ensurety. Read `orgRegistry.orgs[id].integrations.ensurety.credentials.test` (when `org.test_mode`) or `.live` (else). Fields: `default_term_months` + `down_payment_mode` ∈ {`same_as_monthly`, `percent_of_price`, `fixed_dollars`} + `down_payment_value`.
>   2. Fall back to org `protection_billing.payment_term.default_months` and `down_payment.default_percent` (treat as `percent_of_price`) when provider fields absent.
> Compute `down_payment_amount`:
>   - `same_as_monthly` → equals the monthly amount (the demo seed for Apex+Ensurety).
>   - `percent_of_price` → `plan.total_cost * down_payment_value / 100`.
>   - `fixed_dollars` → `down_payment_value` directly.
> Tooltip pattern: small absolute-positioned `<div>` shown on `onMouseEnter` + click-toggle for keyboard/touch. Render under the existing `~$XX/mo` `<div>`. Don't break the existing cross-sell strike-through path (`hasCrossSellAdjustment`). Emit `protection.customer.recommended_coverage.monthly_tooltip_shown { tier, term, down_mode }` on hover/click.
>
> **Cross-cutting wiring (Tasks 1, 2, 4):** In `src/views/customer/RecommendedCoverage.jsx`, import `buildPassthroughForPlan` from `blinker-platform/utils`. For each plan card, compute `const { totalDelta, badges } = buildPassthroughForPlan({ form, rates: form.rates, product: <the underlying product matching the plan> })`. Pass `passthrough={{ totalDelta, badges }}` down to `<PlanCard>` as a new prop. PlanCard renders:
>   - Each badge as a small chip row UNDER the plan name (lucide icon optional; use `Sparkles` for cost_passthrough+price>0, `Check` for cost_passthrough+price=0 or informational).
>   - A new line in the right-side total block: `+ $XX add-ons` when `totalDelta > 0`, no markup applied.
> Same wiring in `src/views/customer/Customize.jsx` for the carousel card.
>
> **Important — silent prop-drop guard.** When you add the `passthrough` prop to PlanCard's destructured signature, double-check both call sites (RecommendedCoverage line ~324 + Customize line ~344) pass it. Memory `feedback_silent_prop_drop.md` documents past bugs from this exact class.
>
> **PostHog events to register:**
>   - `protection.customer.vehicle_use.add_on_attached { add_on_key }` (Task 1, fires on rideshare/commercial pick)
>   - `protection.customer.modifications.add_on_attached { add_on_key }` (Task 4, fires when enhanced_electronics or navigation toggled on)
>   - `protection.customer.recommended_coverage.passthrough_cost_applied { keys, total_delta, plan_code }` (Tasks 1, 2, 4 — fired once per render of cards from RecommendedCoverage; gate via ref to fire-once-per-mount per tier)
>   - `protection.customer.recommended_coverage.monthly_tooltip_shown { tier, term, down_mode }` (Task 6)
>   - `protection.customer.customize.range_changed { field, min, max }` (Task 5)
>   - `protection.customer.vin_validate.prior_ymmt_shown { ymmt }` (Task 3)
>
> When done, report: file list (with line ranges), full PostHog event names list, any spec gaps (especially around what "Navigation" should look like in the Modifications copy — the spec doesn't specify), and confirm `npm run build` was NOT attempted (sandbox kill).



### § 28 — Manager MVP (5 dispatches, Phase 1B)

ADR is `architecture/19-manager-experience.md`. Fixture is `packages/api/_fixtures/agents.json`. Wave 28a is sequential and must land before 28b–28e can fan out in parallel.

#### § 28a — Manager foundation (sequential, opus or sonnet)

Open `mission-control` in a fresh session and paste:

> Read mission-control/CLAUDE.md and mission-control/README.md. Read ADR `~/Documents/Claude/Projects/blinker-platform/architecture/19-manager-experience.md` end-to-end — that's the spec for Wave 28. Read STATUS.md top section for current state. Then read `~/Documents/Claude/Projects/blinker-platform/packages/api/_fixtures/agents.json` so you know the fixture shape.
>
> **DO NOT run `npm run dev`, `npm run build`, or `npm install` at all in this session.** Hard rule (sandbox kill). The `file:../blinker-platform` symlink already points at fresh canon + fixtures.
>
> Land Wave 28a — Manager foundation. Single commit (or two if a clean cut between shell + scaffolds helps reviewability):
>
> **1) OrgSwitcher shell control.** Build `src/shell/OrgSwitcher.jsx`. Top-bar dropdown control rendered LEFT of the existing PersonaSwitcher. Source: union of `agents.json[my_id].org_ids` (assume `my_id = 'mgr_taylor_brooks'` for now — wire to the persona's identity in a follow-up wave). For Phase 1, hard-code my_id as a constant so the switcher renders something real. Single-org-selected by default; persisted in `localStorage.blinker.activeOrgId`. Render `{ orgId, orgName }` chips for each accessible org plus an "All my orgs" toggle row at the bottom of the dropdown. Expose the active org via a new shell context `useActiveOrg()` returning `{ orgId | null, allOrgs: boolean, accessibleOrgIds: number[] }`. `null` orgId means "All my orgs" mode is on. Emits PostHog event `mission_control.org_switched { from_org_id, to_org_id, all_orgs }`.
>
> **2) `NAV_BY_PERSONA.manager` fleshed out** in `src/constants/nav.js`. Replace the existing 3-item stub with 5 items: `home`, `team`, `inbox`, `assignment`, `metrics`. Reuse existing icon names. Keep the `manager_assign_only` preset gating in mind for a follow-up (this wave does not need to implement preset-based nav filtering — leave a TODO comment near the export).
>
> **3) Manager screen scaffolds** at `src/personas/manager/`:
>   - `ManagerHome.jsx` — REPLACE the existing stub (3 "Not wired yet" cards). New stub: a header reading `MANAGER · HOME`, a one-paragraph placeholder, and an empty grid where KPI tiles will land in 28c. Don't build KPIs yet — just an empty shell. Wire to the `home` nav key.
>   - `ManagerTeam.jsx` — new. Two-pane layout shell: left pane "Agents roster" with a placeholder table (id, name, preset, org), right pane "Select an agent to view details" empty state. Reads from the new `packages/api/agents.js` SDK (built in this wave).
>   - `ManagerInbox.jsx` — new. Renders the SAME `AgentInbox` component the Agent persona uses, but wrapped with a manager-only header strip ("Team Inbox — N agents"). Group-by-agent and bulk-reassign land in 28d; this wave just gets the rendering wired.
>   - `Assignment.jsx` — new. Empty shell with two columns: left "Queues" with placeholder rows (Unassigned, Stuck), right "Select a queue" empty state. Land in 28e.
>   - `ManagerMetrics.jsx` — new. Empty shell with placeholder iframe slot. Land in 28f.
>   - Wire them all into the App.jsx `PersonaShell` dispatch.
>
> **4) `packages/api/agents.js` SDK module.** Create in `~/Documents/Claude/Projects/blinker-platform/packages/api/agents.js` (coordinator scope — you ARE the authorized writer for that path via the `file:` symlink; commit there too). Methods for THIS wave:
>   - `agents.list({ org_id?, preset_id?, has_tag? })` → returns array enriched with derived workload `{ open_count, stale_count, conversion, avg_handle_days, last_active_at }`. Stale threshold = 7 days for Phase 1 (TODO comment that this should come from org SLA config).
>   - `agents.get(id)` → enriched
>   - `agents.computeWorkload(id)` → just the workload object
>   - Coaching notes methods are NOT in this wave — defer to 28b.
>
>   Read derivation: open opps via `opportunities.json` filtered by `owner === agent.name && status NOT IN losing-statuses`. Conversion = won / (won + lost) over all time (lens window comes in 28c). Stale = `opp.updated_at` older than `Date.now() - 7d`. Avg handle days = median(`won_opp.updated_at - created_at`).
>
>   Add the module to `~/Documents/Claude/Projects/blinker-platform/package.json` subpath exports (next to existing api/contacts, api/opportunities, etc.). Verify the existing pattern with a `grep '"./api/' ~/Documents/Claude/Projects/blinker-platform/package.json`. Match it.
>
> **5) Verify imports** by opening any one of the new manager screens and confirming `import { agents } from 'blinker-platform/api'` resolves. If the existing pattern is `import { agentsApi } from 'blinker-platform/api'` (matching contactsApi / opportunitiesApi), follow that convention instead.
>
> Commit format: two commits — one in blinker-platform (the agents SDK + package.json export), one in mission-control (everything else). Conventional. Mission-control subject: `feat(manager): wave 28a foundation — org switcher + nav scaffolds + agent SDK consumer`. blinker-platform subject: `feat(packages/api): add agents module + workload derivation`. Body 3-4 bullets each. Co-author trailer:
>
> ```
> Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
> ```
>
> Git identity for each repo: `user.name=dealercrm`, `user.email=chad@carcarepeople.com` per-repo. Do NOT push.
>
> Report back (under 250 words):
> 1. Files created (mc + platform) with one-line description each.
> 2. The subpath export pattern used for the agents module.
> 3. Confirmation that `OrgSwitcher` renders accessible-org chips for Taylor Brooks (102 only) and Morgan Diaz (multiple).
> 4. Two commit SHAs.
> 5. Anything you noticed worth flagging for 28b–28e.

#### § 28b — Team page (parallel after 28a, sonnet)

Open `mission-control`:

> Read `~/Documents/Claude/Projects/blinker-platform/architecture/19-manager-experience.md` §5.2 (Team page) end-to-end. Wave 28a foundation is already landed.
>
> **NO npm run dev / build / install. Hard rule.**
>
> Build out `src/personas/manager/ManagerTeam.jsx`. Two-pane.
>
> **Left pane — `AgentRosterTable.jsx`:**
> - Columns per ADR §5.2: Agent (initials + name), Open, Stale, Conversion, Avg handle time, Last active, Preset/tags.
> - Reuse `AdvancedFilter` from `src/shared/AdvancedFilter.jsx`. Add a manager-specific filter spec (preset_id enum, tag enum, last-active range, open-count range).
> - Default sort: stale-count desc. Sort by column header click.
> - Quick filter pills: All / Active today / Stale work / Below conversion threshold.
> - Header KPI strip: `total agents`, `agents with stale work`, `agents with no open opps`.
> - Reuse `useInfiniteScroll` and `BackToTop` from `src/shared/`.
>
> **Right pane — `AgentProfile.jsx`** (URL state `right={kind:'agent_profile', agentId}`):
> - Mirror the structure of `ContactProfile.jsx` (header → content blocks → activity feed).
> - Sections per ADR §5.2 #1–#7.
> - Section 6 "Coaching notes" — extend `packages/api/agents.js` with `listCoachingNotes(agentId)` / `addCoachingNote(agentId, body)`. Storage key `blinker.notes.v1.agent.<id>`. Same shape as contact notes. Manager-only — render the section only when persona === 'manager'.
> - Section 7 "Reassign workload" — button that opens Assignment screen pre-filtered to this agent's opps. Don't implement the actual reassignment in this wave (28e owns it); just wire the navigation.
>
> Two commits: one in blinker-platform (coaching notes API methods), one in mission-control (the two screens + table + integration). Conventional commit messages, co-author trailer, do NOT push.
>
> Report back: files, commit SHAs, anything that diverged from the ADR.

#### § 28c — Manager Home (parallel after 28a, sonnet)

Open `mission-control`:

> Read ADR `19-manager-experience.md` §5.1 (Home / Team). Wave 28a is landed; do NOT modify the OrgSwitcher.
>
> **NO npm run dev / build / install. Hard rule.**
>
> Build out `src/personas/manager/ManagerHome.jsx` (replace the 28a scaffold). Follow `AgentHome.jsx` as the structural template — KPI tiles, by-rollup strip, funnel header, recent activity feed.
>
> Specifics from ADR §5.1:
> - 4 KPI tiles (lens-scoped): Open opportunities, Conversion rate, Avg handle time, Stale count. Reuse the existing KPI tile component from `AgentHome.jsx` (extract it to `src/shared/KpiTile.jsx` if it's currently inline — that lift is OK).
> - By-agent strip (new): horizontal scroll of agent chips. Sorted by workload desc. Click → ManagerTeam with that agent's drill-in.
> - By-type rollup (reuse Agent's existing component).
> - Funnel header (all-time, NOT lens-scoped): Open / Won / Lost / Abandoned. Reuse Agent's funnel component.
> - Recent team activity: new component `TeamActivityFeed.jsx` that calls `blinkerApi.activities.listAll()` (extend the contacts→opps→activities chain to read across all of the active org's contacts). Reuse `useInfiniteScroll`. Filter dropdowns: by agent, by activity type.
> - Date lens selector (reuse Agent's).
> - All data scoped to `useActiveOrg()` orgId from the OrgSwitcher. When `allOrgs === true`, sum across `accessibleOrgIds`.
>
> Single commit. Conventional. Don't push.
>
> Report back: files, KPI computation correctness (spot-check), commit SHA.

#### § 28d — Manager Inbox (parallel after 28a, sonnet or opus)

Open `mission-control`:

> Read ADR `19-manager-experience.md` §5.3 (Inbox). Wave 28a is landed; ManagerInbox.jsx currently just wraps AgentInbox.
>
> **NO npm run dev / build / install. Hard rule.**
>
> Layer manager-only features onto the existing AgentInbox without forking it:
>
> 1) **Default group-by-agent rendering.** Add a `groupBy` prop to `AgentInbox` accepting `'agent' | 'none'` (default `'none'` so Agent persona is unchanged). ManagerInbox passes `groupBy='agent'`. Implementation: collapsible group headers per agent showing `name + open + stale + conversion`. Reuse roster data from `agentsApi.list({ org_id })`.
>
> 2) **Bulk select.** Add `bulkActions` prop to AgentInbox (array of `{ id, label, onClick(selectedOppIds) }`). Default `[]` for Agent. ManagerInbox passes:
>   - `Reassign` → opens `BulkReassignBar.jsx` (new component) with workload-aware suggestion (use `packages/utils/assignment-scoring.js` — create it; algorithm per ADR §7).
>   - `Add tag` → opens tag picker, applies via `opportunitiesApi.addTag(oppId, tag)`.
>   - `Mark stuck` → adds tag `stuck` (Phase 1; Phase 2 has dedicated status).
>
> 3) **Filter additions.** Extend the AdvancedFilter Owner enum to include a first-class `Unassigned` option (null owner). Add a `Stuck (no movement in N days)` derived filter (default N=7). Add a `Has API failure` filter, **gated behind `view_api_responses` badge** — only renders when the manager's preset includes that badge.
>
> 4) **Manager-overlay CoPilot affordances.** When persona === 'manager' and CoPilot is open from ManagerInbox, the left rail (`OpportunityContextPane`) gets:
>   - "Assigned to <agent>" with an inline re-assign dropdown above the existing contact card.
>   - "Note for agent" button below VEHICLE — opens a small inline composer that writes to `agentsApi.addCoachingNote(opportunity.owner_id, body)`.
>
> Two commits or one — your call. Conventional. Don't push.
>
> Report back: files, the new prop surface on AgentInbox (so we can spot regressions in the Agent path), commit SHA(s).

#### § 28e — Assignment screen (parallel after 28a, sonnet)

Open `mission-control`:

> Read ADR `19-manager-experience.md` §5.4 (Assignment) and §7 (suggestion algorithm). Wave 28a is landed; Assignment.jsx is a stub.
>
> **NO npm run dev / build / install. Hard rule.**
>
> Build the two-column screen at `src/personas/manager/Assignment.jsx`:
>
> Left — queues:
> - Unassigned (count) — opps where owner is null/empty
> - Stuck > 7d (count) — opps where `updated_at` is > 7d old
> - API failure (count) — gated by `view_api_responses` badge. Derived from a TODO source for Phase 1 (no API response log exists yet); render a "Coming soon" placeholder under the count.
>
> Right — queue contents:
> - Rows: Type, Contact, Vehicle, Age, Status.
> - Inline `AssignmentDropdown.jsx` per row. Workload + tag-match scoring per ADR §7. Top 3 agents get a "Suggested" pill. Algorithm lives at `packages/utils/assignment-scoring.js` (build if 28d didn't).
> - Bulk select + `BulkReassignBar.jsx` (shared with 28d).
> - Telemetry: `mission_control.assignment.suggestion_shown` + `mission_control.assignment.assigned` per ADR §7.
>
> Cross-org assignment is **allowed** when the manager's accessible-orgs includes the destination agent's org. UI: when the active OrgSwitcher mode is "All my orgs", the dropdown surfaces agents from any accessible org with an org chip on each option. When single-org-selected, the dropdown filters to that org's agents only.
>
> Wire the `manager_assign_only` preset gating: when the manager's preset is `manager_assign_only`, redirect the shell's default landing page to `/assign` and hide Home / Team / Metrics from the nav. Implement this in `src/shell/PersonaShell.jsx` or wherever nav resolution happens.
>
> Two commits (utils + screen) or one. Conventional. Don't push.
>
> Report back: files, the scoring weights you used, commit SHA(s), anything that needs an ADR addendum.


### § 29 — v3.0.10 PDF (Manager polish + cross-org + tags, 3 dispatches, 2026-05-13)

Coordinator landed canon `org-registry.json::cross_org_assignment` + ADR 19 addendums. Three parallel mc dispatches — no file-scope overlap.

#### § 29a — Cross-org policy + shared AgentPicker (Task 1)

Open `mission-control`:

> Read mission-control/CLAUDE.md + README.md. Read `~/Documents/Claude/Projects/blinker-platform/architecture/19-manager-experience.md` §6 (Cross-org policy + per-org table) end-to-end. Read STATUS.md Wave 29 section. Read `~/Documents/Claude/Projects/blinker-platform/canon/org-registry.json::cross_org_assignment` shape for the fields you'll read.
>
> **NO `npm run dev` / `build` / `install`.** Hard rule.
>
> **File scope (parallel-safe with 29b + 29c):**
> - mc: new `src/personas/manager/AgentPicker.jsx` (shared), modify `BulkReassignBar.jsx`, `AssignmentDropdown.jsx`, `Assignment.jsx` (just wiring), `CoPilotPane.jsx` manager-overlay reassign block, `ManagerInbox.jsx` (just wiring). NO touching `AgentRosterTable.jsx`, `AgentProfile.jsx`, `ManagerTags.jsx`, `ManagerHome.jsx`, `AgentHome.jsx`, `AgentInbox.jsx` core (the bulk-action / personaOverlay props are touchable but core rendering must stay byte-identical).
> - platform: `packages/api/contacts.js` (extend `crossOrgMove` and ADD `crossOrgCopy` with readonly flags). `packages/utils/assignment-scoring.js` unchanged.
>
> **Tasks:**
>
> 1) **Build `src/personas/manager/AgentPicker.jsx`** — shared dropdown component used by both single-opp and bulk picker surfaces.
>    Props: `selectedOpps[]` (1+), `eligibleAgents[]`, `sourceOrgPolicy` (the cross_org_assignment block of the source opps' org — when multiple source orgs in selectedOpps, reduce to the strictest enabled=AND-of-all), `onAssign(agentId, { wasSuggested, isCrossOrg, sourceOrgId, destOrgId, mode })`, `onCancel`, `placement` ('inline' | 'bulk-bar').
>    Behavior:
>    - Render agents grouped by org (org header row: org name + agent count). Order: source-org-first, then other accessible orgs alphabetical.
>    - Within each org group, top 3 agents by `scoreAgents()` carry "Suggested" pill at the top of THAT org's group.
>    - When `sourceOrgPolicy.enabled === false`, hide all destination-org groups; render only same-org agents. Show a small footnote: "Cross-org assignment disabled for this org."
>    - When `sourceOrgPolicy.enabled === true`, all accessible-org groups render; cross-org rows carry a small "→ <orgName>" chip indicator.
>    - Keyboard nav: up/down across rows (across group boundaries), enter to select, esc to close.
>    - Telemetry: `mission_control.assignment.picker_opened { surface, source_org_id, accessible_org_count, eligible_agent_count }`; `mission_control.assignment.suggestion_shown { ... }` once per open; `mission_control.assignment.assigned { ..., is_cross_org, source_org_id, dest_org_id, mode, was_suggested }` on confirm.
>
> 2) **Wire `BulkReassignBar.jsx`** to use AgentPicker:
>    - The current empty "Assign to agent..." dropdown on the Assignment screen bulk bar (user-reported bug) — root cause check + fix. Pass `selectedOpps`, derive `eligibleAgents` via `agentsApi.list({ org_id })` for all accessible orgs (or all when allOrgs), reduce `sourceOrgPolicy` across selectedOpps.
>    - Keep the existing onAssign signature backwards-compat with current callers.
>
> 3) **Wire `AssignmentDropdown.jsx`** (inline single-opp picker) to use AgentPicker:
>    - Replace its internal scored list rendering with `<AgentPicker placement="inline" selectedOpps={[opp]} ... />`.
>
> 4) **Wire CoPilot manager-overlay reassign control** in `CoPilotPane.jsx`:
>    - Same swap. The manager-overlay reassign dropdown above the Contact block becomes `<AgentPicker placement="inline" selectedOpps={[opportunity]} eligibleAgents={...} sourceOrgPolicy={...} onAssign={managerOverlay.onReassign} />`.
>
> 5) **Per-org policy reads + cascade behavior** in `packages/api/contacts.js`:
>    - `crossOrgMove(contactId, fromOrgId, toOrgId, { session?, policy? })` — existing; extend signature to accept policy (default `{ contact_mode: 'move', opportunity_mode: 'move' }` for back-compat with W28e callers).
>    - **NEW** `crossOrgCopy(contactId, fromOrgId, toOrgId, { session?, policy? })` — duplicates the contact + flags both source (readonly per `mark_contact_readonly_on_copy`) and creates new destination record. Returns `{ source_contact_id, dest_contact_id, copied_opps, copied_activities, readonly_applied }`.
>    - Both write a `blinker.contacts.cross_org.v1` localStorage trail with mode info.
>    - Policy resolution at caller: read `orgRegistry.orgs.find(o => o.id === fromOrgId).cross_org_assignment` and pass it through.
>
> 6) **Cross-org confirmation modal** in `Assignment.jsx` (already exists from W28e):
>    - Update copy to vary by mode: "**Copy** to <orgName>" / "**Move** to <orgName>".
>    - Show readonly preview when copy mode + `mark_*_readonly_on_copy: true`.
>    - On confirm, call `crossOrgCopy` or `crossOrgMove` per `opportunity_mode`. Surface `readonly_applied` count in success toast.
>
> **Commits (2):**
> - platform: `feat(packages/api): contacts.crossOrgCopy + crossOrgMove policy-aware`. Body 3 bullets.
> - mc: `feat(manager): shared AgentPicker grouped by org + per-org cross-org policy`. Body 5 bullets.
>
> Co-author trailer:
> ```
> Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
> ```
> Git identity per-repo: `dealercrm` / `chad@carcarepeople.com`. Do NOT push.
>
> **Report back (under 300 words):**
> 1. Files created/modified per repo.
> 2. Root cause of the empty "Assign to agent..." bug on Assignment bulk bar.
> 3. How `sourceOrgPolicy` is reduced when bulk-selection spans multiple source orgs.
> 4. The telemetry payload shape for `assignment.assigned` post-29a.
> 5. Commit SHAs.
> 6. Anything that needs an ADR addendum.

#### § 29b — Tags namespace mgmt (Task 2)

Open `mission-control`:

> Read `~/Documents/Claude/Projects/blinker-platform/architecture/19-manager-experience.md` §5.6 (Tags namespace management) end-to-end. Read `~/Documents/Claude/Projects/blinker-platform/canon/system-tags.json` to understand the existing tag dictionary shape (system_tags + by_org).
>
> **NO `npm run dev` / `build` / `install`.**
>
> **File scope (parallel-safe with 29a + 29c):**
> - mc: new `src/personas/manager/ManagerTags.jsx`, `src/constants/nav.js` (add 'tags' entry for manager only). NO touching other manager screens, AgentInbox/AgentHome, OrgSwitcher.
> - platform: new `packages/api/tags.js`, `packages/api/index.js` (re-export), `package.json` subpath. NO touching agents.js, contacts.js, opportunities.js.
>
> **Tasks:**
>
> 1) **`packages/api/tags.js`** — new SDK module backed by `canon/system-tags.json`:
>    - `list({ org_id?, include_system = true, include_archived = false })` — union of `system_tags` + `by_org[org_id]`. Each tag enriched with `applied_to_count: { users, contacts, opportunities }` computed from `agents.json`, `contacts.json`, `opportunities.json` (read each, count tag-name occurrences).
>    - `get(id)`
>    - `create(org_id, { name, color, category, description })` — writes to `localStorage.blinker.tags.v1.org.<org_id>` overlay (Phase 1; Phase 2 = real backend). Returns the new tag with `created_by: 'manager_<org_id>_<ts>'`.
>    - `update(id, patch)` — system tags rejected with thrown error.
>    - `archive(id)` — soft-delete via overlay; system tags rejected.
>    - `merge(sourceId, destId)` — repoint applications across `agents.json`/`contacts.json`/`opportunities.json` (Phase 1 via localStorage overlay, since fixtures are read-only), then archive source.
>    - `listAppliedEntities(id)` — returns `{ users: Agent[], contacts: Contact[], opportunities: Opportunity[] }`.
>    - Add `archived_at?` field handling — filter from `list()` when `include_archived=false`.
>    - Add subpath export `"./api/tags": "./packages/api/tags.js"` in package.json. Add named re-export in `packages/api/index.js`.
>
> 2) **`src/personas/manager/ManagerTags.jsx`** — new screen.
>    Layout: left-rail tab switcher (Tags / Presets), right pane content. Header: `MANAGER · TAGS` eyebrow + H1 "Tag namespace".
>    **Tags tab:**
>    - Table columns: name (chip with color swatch), category, applied-to summary (e.g. "12 contacts · 3 users"), last-applied timestamp (read from latest activity referencing the tag, or fall back to created_at), source pill (system / org).
>    - Reuse `AdvancedFilter` (additive spec): source enum (system/org), applied-to enum (any/users/contacts/opps), last-applied date range.
>    - Quick filters: All / In use / Unused (applied_to_count.total === 0) / Recently added (created_at within 7d).
>    - Row click → side panel slide-in showing `listAppliedEntities` result + tag detail. Side panel has rename / change color / archive actions (`create_tags` gated).
>    - Top-bar `+ New tag` button (gated). Modal: name, color picker, category (enum), description. On submit calls `tags.create()`.
>    - Bulk select via row checkboxes + bulk bar at bottom: Merge action opens a "Merge into..." picker; on confirm calls `tags.merge()` for each selected source tag.
>    - System tags are read-only in the table (no archive/rename actions surface for them).
>    **Presets tab:**
>    - Read-only reference. Reads `canon/personas.json::personas.*.presets[]`.
>    - Group by persona (Agent / Manager / Admin / Super Admin). Each preset row: id, label, description, badges chips list.
>    - Row click → side panel showing full preset detail.
>    - Footer note: "Preset CRUD lives in Super Admin canon editor."
>
> 3) **Nav wiring** in `src/constants/nav.js`:
>    - Add `{ key: 'tags', label: 'Tags', icon: 'Tag' }` to `NAV_BY_PERSONA.manager` after 'metrics'.
>    - Extend `getNavForManager(presetId)` (from 28e) to filter 'tags' out for `manager_assign_only` (no `create_tags` badge).
>
> 4) **App.jsx dispatch** — add the new screen to the manager persona screen-dispatch table.
>
> **Commits (2):**
> - platform: `feat(packages/api): tags SDK module + localStorage overlay`. Body 3 bullets.
> - mc: `feat(manager): wave 29b tags namespace mgmt screen`. Body 4 bullets.
>
> Co-author trailer. Git identity per-repo. Do NOT push.
>
> **Report back (under 250 words):** files, applied_to_count computation correctness for at least one canonical tag (e.g. `vsc-specialist`), how the Phase 1 overlay merges with canon reads, commit SHAs, anything noticed.

#### § 29c — Team member view polish (Tasks 3–6)

Open `mission-control`:

> Read `~/Documents/Claude/Projects/blinker-platform/architecture/19-manager-experience.md` §5.2 (Team page, including AgentProfile drill-in section). Read the v3.0.10 PDF text — Tasks 3, 4, 5, 6 — from this dispatch brief (re-stated below). Read `src/personas/agent/AgentHome.jsx` end-to-end (you'll extract its KPI grid + by-type rollup).
>
> **NO `npm run dev` / `build` / `install`.**
>
> **File scope (parallel-safe with 29a + 29b):**
> - mc: `src/personas/manager/AgentProfile.jsx` (full replacement), `src/personas/agent/AgentHome.jsx` (refactor to consume new shared component), new `src/shared/AgentMetricsGrid.jsx`, new `src/shared/DateLensSelect.jsx` if not already a shared file (check first — Agent Home may already have one inline). NO touching ManagerInbox, ManagerHome, ManagerTags, AgentInbox, AgentPicker, Assignment, BulkReassignBar.
> - platform: `packages/api/agents.js` (extend `computeWorkload({ lens })` to accept additional lens names — see Task 3). No other platform touches.
>
> **Tasks:**
>
> **Task 3 — Date lens on AgentProfile:**
> - Add a date-lens dropdown at the top of AgentProfile (right of the header section, before the workload tiles). Default `recent_30d` (per spec: "Default will be 30 days").
> - Lens vocabulary (extend `computeWorkload({ lens })`): `recent_30d` (default), `last_month`, `this_month`, `ytd`, `last_week`, `this_week`, `yesterday`. The existing `'7d' | '30d' | '90d' | 'qtd' | 'all'` vocab stays for backwards-compat (alias `30d` → `recent_30d` for the Agent Home preset).
> - Lens drives: workload metrics (`computeWorkload(id, { lens })`), Conversion by Type bars, Recent Activity feed (filter by activity `created_at` in lens window).
> - Inbox Snapshot is NOT lens-filtered (always shows 10 oldest open opps — same as today).
> - If the Agent Home lens selector is inline JSX, extract it to `src/shared/DateLensSelect.jsx` and consume from both Agent Home + AgentProfile.
>
> **Task 4 — Replace workload section with shared AgentMetricsGrid:**
> - Today's AgentProfile WORKLOAD section is 4 small tiles (Open / Stale / Won / Lost). Replace with the same grid Agent Home renders: top row of 4 KPI tiles (OPEN OPPORTUNITIES, AVG OPEN AGE, LOST OPPORTUNITIES, CONVERSIONS IN LAST 30 DAYS), bottom row of 4 by-type cards (PROTECTION/REFI/INSURANCE/PAYMENTS with status pills).
> - Extract Agent Home's grid into `src/shared/AgentMetricsGrid.jsx` with props: `agentId?` (null = aggregate across orgIds), `lens`, `orgIds[]`, `onPillClick?` (status-pill click handler — passes `{ type, status }`).
> - Compute logic stays the same as Agent Home's but ALSO filters by `agentId` when present (opportunities owned by that agent's name).
> - Update Agent Home to consume `<AgentMetricsGrid lens={lens} orgIds={[orgId]} onPillClick={...} />` (no agentId — aggregate). Visually byte-identical to today.
> - AgentProfile consumes `<AgentMetricsGrid agentId={agent.id} lens={lens} orgIds={[agent.org_ids[0] /* or active org */]} onPillClick={...} />`.
> - The current AgentProfile "Conversion by type" bar-chart section is SEPARATE — keep it (or remove if the new grid's by-type cards make it redundant — your call; lean toward keep with smaller styling, but if it's now visually duplicative remove and note in report).
>
> **Task 5 — Inbox Snapshot rows clickable → CoPilot:**
> - The Inbox Snapshot section in AgentProfile lists 10 oldest open opps for the agent.
> - Each row should be clickable. onClick → open CoPilot for that opp/contact via the existing CoPilot routing pattern (look at how `AgentInbox` rows route — same handler).
> - Match the click target to the entire row, not just the type pill or contact name.
>
> **Task 6 — Visual chevron on Inbox Snapshot rows:**
> - Add a right-arrow chevron (`ChevronRight` from lucide) on the right edge of each row.
> - Hover state: bg slate-50, chevron slate-700 (was slate-400).
> - Days-since label sits left of the chevron in slate-500 with `text-xs`. (Match the screenshot layout from the v3.0.10 PDF.)
>
> **Commits (1 or 2):**
> - Optionally split: platform commit `feat(packages/api): agents.computeWorkload accepts extended lens vocabulary`. Body 1 bullet.
> - mc: `feat(manager): wave 29c team member view — date lens + shared metrics grid + clickable inbox snapshot`. Body 5 bullets.
>
> Co-author trailer. Git identity per-repo. Do NOT push.
>
> **Report back (under 300 words):** files, whether you kept or removed the existing AgentProfile Conversion-by-type section, lens extension verbatim list, commit SHAs, anything flagged.


### § 30 — Agent Compete + Manager leaderboard cascade (single dispatch, 2026-05-13)

Coordinator landed canon `sales_goals` + ADR 20. One mc dispatch.

#### § 30 — Build (single agent, opus or sonnet)

Open `mission-control`:

> Read mission-control/CLAUDE.md + README.md. Read `~/Documents/Claude/Projects/blinker-platform/architecture/20-sales-leaderboard.md` end-to-end — that's the spec. Read STATUS.md Wave 30 section. Read `~/Documents/Claude/Projects/blinker-platform/canon/org-registry.json::sales_goals` shape on Apex 102 / Kings DR 103 / Rewardsco 106.
>
> **NO `npm run dev` / `build` / `install`.** Hard rule.
>
> **File scope:**
> - mc: new `src/personas/agent/AgentCompete.jsx` + sub-components under `src/personas/agent/components/` (or `src/shared/` for those that genuinely cross persona boundaries — Leaderboard, GoalCard, AchievementChip are reusable). Modify `src/constants/nav.js` (add `compete` to agent nav AFTER `home`), `src/App.jsx` (agent screen dispatch). Modify `src/personas/manager/ManagerHome.jsx` (Leaderboard widget swap), `src/personas/manager/AgentRosterTable.jsx` (Rank + Trend columns + Top/Coaching quick filter pills), `src/personas/manager/AgentProfile.jsx` (goal-pacing card insert).
> - platform: new `packages/api/leaderboard.js` + `packages/api/index.js` re-export + `package.json` subpath. NO other platform changes.
> - DO NOT touch: AgentHome, AgentInbox, AgentContacts, AgentReports, ManagerInbox, ManagerTags, Assignment, OrgSwitcher, CoPilotPane, AgentPicker, BulkReassignBar, agents.js workload signatures.
>
> **Tasks:**
>
> 1) **`packages/api/leaderboard.js`** — new SDK module backed by canon + opportunities + activities reads. Methods (per ADR 20 §6):
>    - `getRankings({ org_ids, lens, metric })` — sorted desc by metric (asc for `speed`). Each entry: `{ rank, agent, value, trend }`.
>    - `getAgentGoalProgress(agent_id, { period: 'week' | 'month' })` — `{ wins, goal, percent, pace_status: 'behind'|'on_pace'|'ahead' }`.
>    - `getAchievements(agent_id, { lens })` — array of `Achievement` records: streak, fast_close, fast_start, first_of_week, beat_team_avg_weeks, streak_milestone.
>    - `getTeamMedians({ org_ids, lens })` — `{ conversion, avg_handle_days, stale_count }`.
>    - `snapshotRanksForToday({ org_ids })` — idempotent localStorage write to `blinker.leaderboard.history.v1`.
>    - `getRankTrend(agent_id, org_id, metric, { days_ago = 7 })` — `+N | -N | 0 | null`.
>    Achievement detection follows the formulas in ADR §5.2. Win-status set: read from existing `agents.js::WINNING_STATUSES` constant (don't duplicate the list). Same for losing statuses.
>
>    Add subpath export `"./api/leaderboard"` + named re-export in `packages/api/index.js`.
>
> 2) **`src/personas/agent/AgentCompete.jsx`** — new screen. Per ADR §3:
>    - **Hero block**: rank chip + headline ("You're #2 of 8 in Apex this week"), big-number wins-to-goal, pacing bar colored by status, streak chip + fast-close count chip. Lens-scoped (DateLensSelect, default `recent_30d`, reuse from W29c).
>    - **Goal cards row (3 cards)**: this week, this month, monthly revenue. Each: progress bar + percent + "On pace / Ahead by N / Behind by N" sub-line + 7/30-day sparkline.
>    - **Leaderboard section**: metric toggle pills (Wins/Conversion/Revenue/Speed), table with Rank/Agent/Value/Trend columns. Current user row highlighted with `←You` chip + slate-50 bg. 🏆 emoji on #1.
>    - **You vs Team block**: three rows (Conversion / Avg handle time / Stale opps), each showing agent value · team median · delta with color coding.
>    - **Achievements strip**: horizontal chip row of earned achievements per period.
>
>    Wire to `blinkerApi.leaderboard.*` methods. Org scoping via `useActiveOrg()` (single org for Agent persona — leaderboard scopes to that agent's primary org).
>
> 3) **Reusable components**:
>    - `src/shared/Leaderboard.jsx` — takes `{ rankings, currentAgentId, metric, onMetricChange }` props. Used by AgentCompete AND ManagerHome.
>    - `src/shared/GoalCard.jsx` — takes `{ label, current, goal, sparklineData, paceStatus }`. Reusable.
>    - `src/shared/AchievementChip.jsx` — takes `{ achievement }`, renders icon + label.
>    - `src/personas/agent/components/HeroRank.jsx` — Compete-specific.
>    - `src/personas/agent/components/OutPaceRow.jsx` — Compete-specific.
>
> 4) **Nav + dispatch**:
>    - `src/constants/nav.js`: add `{ key: 'compete', label: 'Compete', icon: 'Trophy' }` to `NAV_BY_PERSONA.agent` after `home`.
>    - `src/App.jsx`: agent persona dispatch for `compete` key.
>
> 5) **Manager cascade**:
>    - **`src/personas/manager/ManagerHome.jsx`** — add a Leaderboard widget. Either replace the existing by-agent strip OR add a toggle "Strip / Leaderboard" (your call; recommended: replace, since the leaderboard is a superset). Reuse `src/shared/Leaderboard.jsx`. Use `getRankings` scoped to the manager's active orgs (or accessibleOrgIds in All-my-orgs).
>    - **`src/personas/manager/AgentRosterTable.jsx`** — add a **Rank** column (this week's rank by Wins) and **Trend** arrow column. Add quick filter pills: `Top performers` (top quartile) and `Coaching candidates` (bottom quartile).
>    - **`src/personas/manager/AgentProfile.jsx`** — insert a **Goal pacing** card between the header section and the workload section (the AgentMetricsGrid). Mirror Agent Compete's goal-cards row (3 cards: weekly/monthly/revenue). Below: AchievementChip strip (read-only mirror). Manager-only — gate on `persona === 'manager'`.
>
> 6) **Trend snapshots**: on AgentCompete mount AND on ManagerHome mount, call `leaderboard.snapshotRanksForToday({ org_ids })` (idempotent — only writes once per day per org). This populates the history that `getRankTrend` reads.
>
> 7) **Telemetry** per ADR §7. Emit `compete.viewed` on screen mount, `compete.metric_toggled` on Leaderboard pill change, `manager.leaderboard_viewed` on ManagerHome mount.
>
> **Commits (2):**
> - platform: `feat(packages/api): leaderboard SDK (rankings, goals, achievements, trend snapshots)`. Body 3 bullets.
> - mc: `feat(agent+manager): wave 30 leaderboard — agent compete screen + manager cascade`. Body 5 bullets.
>
> Co-author trailer:
> ```
> Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
> ```
> Git identity per-repo: `dealercrm` / `chad@carcarepeople.com`. Do NOT push.
>
> **Report back (under 300 words):**
> 1. Files created / modified per repo.
> 2. Which goal target each active org is using (verify canon read).
> 3. The rank-trend storage format used in localStorage (one line).
> 4. Whether Leaderboard.jsx ended up under shared/ or personas/agent/components/ — your call, just state which.
> 5. Confirmation that Agent persona's existing screens (Home, Inbox, Contacts, Reports) render byte-identically.
> 6. Confirmation that Manager Home's prior by-agent strip is gone OR toggle-able (whichever you chose).
> 7. Commit SHAs.
> 8. Anything you noticed worth flagging for follow-up.

## Wave 31 — v3.0.11 Insurance → Protection cross-sell (2026-05-14)

Cross-refs: `architecture/21-insurance-protection-cross-sell.md`. STATUS.md "Wave 31" entry is the human-facing summary; this section holds the dispatch templates for the two child-app sessions. Run 31a + 31b in parallel — disjoint repos.

### § 31a — insurance-portal: VehicleDrive step (B1)

Open `insurance-portal` in a fresh session and paste:

> Read `insurance-portal/CLAUDE.md` and `insurance-portal/README.md` first to orient, then read `~/Documents/Claude/Projects/blinker-platform/architecture/21-insurance-protection-cross-sell.md` (Decisions D1 + D2) and `~/Documents/Claude/Projects/blinker-platform/STATUS.md` (Wave 31 entry). This is a single-dispatch ship for v3.0.11 Task 1 — adding the "How much do you drive?" step to the insurance customer simulator.
>
> **Context.** The insurance customer simulator today runs `capture → getting_quote → quote_review → policy_bound` (capture+quote path) or `getting_quote → quote_review → policy_bound` (quote-only path). The PDF (Task 1) requires the **shared VehicleDrive step** ("Step 2 — How much do you drive?") to land between `capture` and `getting_quote` (and at the head of the quote-only path). Mileage + estimated annual mileage are real EI underwriting inputs — quotes can't fire without them.
>
> **Reference implementation.** `protection-portal/src/views/customer/VehicleDrive.jsx` is the wrapper precedent. It wraps `refi-portal/src/views/customer/VehicleDrive` (the body) and layers in MarketCheck side-effects + persists to `form.vehicle.{mileage, condition, purchase_date, market_value, annual_miles_estimate}`. The body is what renders the slider + new/used segmented + purchase-date picker.
>
> **Build:**
>
> 1) **New `src/views/customer/VehicleDrive.jsx`** — wrapper around `refi-portal/src/views/customer` VehicleDrive (named import, mirror protection-portal's import pattern). Persist these fields on the insurance workflow's vehicle slot:
>    - `mileage` (odometer)
>    - `condition` ('new' | 'used')
>    - `purchase_date` (null when new)
>    - `annual_miles_estimate` (compute via `computeAnnualMileageEstimate()` from `blinker-platform/utils`)
>    - `year/make/model/trim/vin` (already pre-attached from lead — pass through for the screen header)
>
>    The insurance workflow shape is `{ flowPath, lead, status, vehicle?, … }` — if there's no `vehicle` slot yet, add one and route writes through `updateWorkflow({ vehicle: { ... } })`. Don't reach into `workflow.lead.summary` for these fields — they're agent/consumer-collected, not partner-returned.
>
>    Skip the MarketCheck side-effect from protection's wrapper — insurance doesn't currently use `vehicle.market_value`. Telemetry: emit `insurance.customer.vehicle_drive.viewed` on mount, `insurance.customer.vehicle_drive.continued` on next with `{ mileage, condition, purchase_date, annual_miles_estimate }`.
>
> 2) **`src/views/customer/CustomerView.jsx`** — extend the step sequence:
>    - `CAPTURE_AND_QUOTE_STEPS = ['capture', 'vehicle_drive', 'getting_quote', 'quote_review', 'policy_bound']`
>    - `QUOTE_ONLY_STEPS = ['vehicle_drive', 'getting_quote', 'quote_review', 'policy_bound']`
>    - Extend `stepFor(status, flowPath)` so that after the user submits the capture form (verification.completed webhook fired → status transitions to `capture.completed` / `LEAD_CREATED`) the wizard lands on `vehicle_drive`, not directly on `getting_quote`. Once VehicleDrive's onNext fires, advance to `getting_quote`. **Gate the EI quote-fire** behind mileage being set so the simulator can't slip past the step.
>    - Add `<VehicleDrive workflow={workflow} updateWorkflow={updateWorkflow} onNext={...} />` to the step body.
>
> 3) **Agent-side surface** — the insurance AgentView's left rail (or wherever vehicle context is rendered) should display the new fields:
>    - `Mileage: 28,100 mi`
>    - `Est. annual mileage: 14,100 mi/yr`
>    - `Condition: Used`
>
>    Read these from the same workflow.vehicle slot the customer-side writes to. If today's left rail reads vehicle data from a different source, add the fields where AgentView's own observed-workflow state is rendered — match the PDF's contact-card layout (page 5 screenshot). Do NOT add a parallel "vehicle context" panel — extend whatever is there.
>
> 4) **Fixtures + DEV CONTROLS** — if your DEV CONTROLS panel has "skip to step X" or seed-workflow buttons, add a `vehicle_drive` option. Update any seed-workflow fixtures so they include sensible mileage/condition defaults (e.g. mileage: 28100, condition: 'used', purchase_date: '2025-01-15') so QA can jump past the step.
>
> 5) **Status map / canon** — read `src/constants/status-map.js` to confirm the existing `STATUS.*` keys are sufficient (`STATUS.CAPTURE_COMPLETED` + `STATUS.LEAD_CREATED` should be enough — vehicle_drive is a wizard-only step, no new ghl-status row needed; the partner-facing status doesn't change between capture.completed and the moment we fire the quote). If you add a transient client-side step indicator, keep it OFF the canon status enum.
>
> **What NOT to do:** do not lift VehicleDrive to `blinker-platform/packages/components` — ADR 21 D1 explicitly defers the lift (two wrappers are cheaper than a parameterized shared component today). Do not add MarketCheck. Do not change protection-portal or refi-portal source.
>
> **Verify:** start dev server, run the customer simulator end-to-end via the agent → consumer link path with `capture_and_quote` flow. Check the new step renders identically to the PDF Task 1 screenshot (slider, segmented control, purchase date, estimated annual mileage). Mileage gets persisted across reloads (workflow state). AgentView's vehicle card shows the new fields once they're set. Test the no-savings (quote outcome) path too — page through to verify nothing downstream breaks.
>
> **Commit (1):** `feat(customer): vehicle_drive step between capture and quote (Wave 31 / v3.0.11 Task 1)`. Body 2–3 bullets covering the step + persistence + agent left-rail update.
>
> Co-author trailer:
> ```
> Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>
> ```
> Git identity per-repo: `dealercrm` / `chad@carcarepeople.com`. Do NOT push.
>
> **Report back (under 250 words):**
> 1. Files created / modified.
> 2. The exact workflow-state shape under `workflow.vehicle` after VehicleDrive's onNext fires (one JSON sample).
> 3. Where in AgentView you surfaced the new mileage/annual-mileage rows (file + section).
> 4. Whether the quote-only flow path's first step is now visibly different (it should be — VehicleDrive instead of jumping to GettingQuote).
> 5. Commit SHA.
> 6. Anything worth flagging for follow-up.

### § 31b — mission-control: insurance → protection cross-sell bundle (B2)

Open `mission-control` in a fresh session and paste:

> Read `mission-control/CLAUDE.md` and `mission-control/README.md` first to orient, then read `~/Documents/Claude/Projects/blinker-platform/architecture/21-insurance-protection-cross-sell.md` (Decisions D3 / D3a / D3b / D3c / D4 / D5 / D6 — the whole ADR — this dispatch covers everything except D1+D2 which is the insurance-portal session). Then read `~/Documents/Claude/Projects/blinker-platform/STATUS.md` (Wave 31 entry).
>
> **This is a bundled single-PR ship** because all three features in the v3.0.11 PDF (Task 2, Task 3) touch `mission-control/src/components/CoPilotPane.jsx` and share state (insurance workflow snapshot, related-opps lookup, the spawn mechanism). Bundle is correct per the established pattern for refactors in this area.
>
> **Context.** ADR 08 set the cross-sell direction as protection→insurance (protection's RecommendedCoverage launches into insurance). v3.0.11 adds the reverse arrow: the insurance opportunity CoPilot launches into protection (or back-reference an existing protection opp). The two arrows together close a cycle.
>
> ---
>
> ## What you're building
>
> **Surface 1 — InsuranceSavingsCard + Find Coverage CTA in the insurance CoPilot (D3).** When the current opp is `type='insurance'`, render an "Insurance at a Glance" card (the refi-portal precedent at `refi-portal/src/results/InsuranceSavingsCard.jsx` is the visual reference — lift its UI or paraphrase, mc-side). Card state per the ADR D3 table:
> | Workflow state | Card content |
> |---|---|
> | pre-send / started | hidden (origination form shows first) |
> | capture_link.sent → viewed | "Customer is reviewing — savings TBD" + Find Coverage CTA **disabled** |
> | capture.completed | "Currently paying $X/mo" hero + "Could save up to $—/mo (quote pending)" + CTA **active** |
> | quote.completed (savings>0) | Full card: current + savings + checklist + CTA active |
> | quote.completed (savings=0) | Muted "We will continue to monitor savings" + CTA still active |
> | policy.bound | Compact "Bound with {carrier} — saving $Y/mo" + CTA active |
> | error.* | Error reason inline + CTA active |
>
> Read carrier + premium from `workflow.lead.summary.insuranceVerification.policyInfo`; read savings + new-carrier from `workflow.lead.summary.quote`. Render in the right pane above the existing insurance LeadStatusTimeline (or wherever fits cleanly given the embed layout — flag your choice in report-back).
>
> **Surface 2 — Find Coverage spawn flow (D3a, D3b, D3c).** Clicking Find Coverage:
> 1. Spawns a new protection opportunity for the same contact + vehicle. **Phase 1 mechanics**: extend `packages/api/opportunities.js` with a `create(opp)` thin wrapper that delegates to a registered writer (provided by mc on app boot — `session-data.js::appendOpportunity` becomes the registered writer). Standalone callers (no registered writer) get a single dev-console warning and a fixture-mode echo. **Spawn payload**: `{ type: 'protection', contact_id, vehicle_id, status: 'vehicle_use', owner: insuranceOpp.owner, _prefill: { mileage, annual_miles_estimate, condition, purchase_date, year, make, model, trim, vin } }`.
> 2. Switches the active workflow to the new protection opp (use the existing `ActiveWorkflowContext` plumbing — see how the manager-overlay reassign flow handles opp switching).
> 3. Lands the protection embed at step 3 (vehicle_use). Extend `mission-control/src/lib/protection-initial-form.js::buildProtectionInitialForm()` to consume an `_prefill` object on the spawned opp if present (overlay onto the contact/vehicle seed; existing path stays as fallback). Step index seeding logic in `CoPilotPane.jsx::ProtectionEmbed` already drives off `stepFromStatus(opportunity.status, …)` — since the spawned opp's status is `'vehicle_use'`, that should land at the right step. Verify, don't assume.
>
> Telemetry: `insurance.copilot.savings_card.viewed`, `insurance.copilot.find_coverage.clicked`, `insurance.copilot.find_coverage.opp_spawned` with the IDs + premium/savings cents.
>
> **Surface 3 — RelatedInsuranceProgress (D4).** New component `mission-control/src/components/RelatedInsuranceProgress.jsx`. A compact (no force-status controls, no error-row affordances, denser layout) variant of `insurance-portal/src/views/agent/LeadStatusTimeline.jsx`. Reads the SAME canon `ghl-status.json#insurance.statuses` subsets (CAPTURE_AND_QUOTE_PATH / QUOTE_ONLY_PATH — duplicate the constant arrays from LeadStatusTimeline since this is a mc-local component). Reads timestamps from `blinkerApi.activities.list({ opportunity_id })` (Phase 1 fixtures already have these populated for `opp_ins_*` opportunities; the activity types are `status_change` with `to_status` matching the timeline path machine_ids).
>
> Mount under "RELATED OPPORTUNITIES" in the left ctx pane of `CoPilotPane.jsx` (`relatedOpps.map(...)`) — for any related opp with `type === 'insurance'`, after the existing row, append the compact timeline. Click on a row → switch CoPilot to the insurance opp (existing pattern — reuse the same handler that powers row-clicks elsewhere).
>
> **Surface 4 — Coverage cross-component (D5).** When current opp is `type === 'insurance'` AND there's a related opp with `type ∈ ['protection', 'vsc']` AND that related opp's status is one of `['vehicle_add', 'vehicle_drive', 'vehicle_use', 'coverage_preview', 'coverage_recommendation']` (i.e. not past step 5), render protection's `RecommendedCoverage` inline in the insurance CoPilot right pane. Import: `import { RecommendedCoverage } from 'protection-portal/src/views/customer'` (check `protection-portal/src/views/customer/index.js` exports — if RecommendedCoverage isn't currently exported there, add it as part of this dispatch; this is the one allowed cross-repo expansion).
>
> Build a `mapInsuranceWorkflowToSavings(workflow): { monthlySavingsCents, captureCarrier, newCarrier, status }` helper in `mission-control/src/lib/`. `status` is one of `'pending' | 'savings_found' | 'no_savings'`:
> - Pre-quote → `null` (not present)
> - quote.completed with savingsAmountCents > 0 → `'savings_found'`
> - quote.completed with savingsAmountCents === 0 (or absent) → `'no_savings'`
>
> Pass the result into RecommendedCoverage's `insuranceSavings` prop. The protection form for the related opp must be seeded the same way ProtectionEmbed seeds it (buildProtectionInitialForm with the related opp's data) — share that scaffold.
>
> **Surface 5 — No-savings discriminator (D6).** This is a coordinated edit to `protection-portal/src/views/customer/RecommendedCoverage.jsx`. The component currently treats `form.insuranceSavings == null` as "no result yet." Add handling for `form.insuranceSavings?.status === 'no_savings'`:
> - The boost-slot Result Chip renders "We will continue to monitor savings" instead of "Insurance savings: -$X/mo · {carrier} → {carrier}".
> - The PlanCard's monthly column **suppresses** the `-$X/mo (insurance vs {carrier})` line.
> - `Find insurance savings` CTA renders **completed** (DONE) — the cross-sell ran, just returned no savings.
>
> This contract change is the ONE intentional cross-repo edit in this dispatch. Protection-portal-local tests + smokes need to verify both the existing positive-savings path and the new no-savings path still render correctly when launched FROM protection's own cross-sell (not just from insurance CoPilot).
>
> ---
>
> ## Commits (2)
>
> - **platform**: `feat(packages/api+protection): opportunities.create() wrapper + recommended_coverage no_savings status (Wave 31)`. Body covers the api.create wrapper + protection-portal RecommendedCoverage no-savings handling.
> - **mc**: `feat(mc): wave 31 insurance→protection cross-sell — SavingsCard + Find Coverage spawn + RelatedInsuranceProgress + coverage cross-component (v3.0.11)`. Body 5 bullets, one per surface.
>
> Co-author trailer:
> ```
> Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
> ```
> Git identity per-repo: `dealercrm` / `chad@carcarepeople.com`. Do NOT push.
>
> ---
>
> ## Cross-cutting constraints (read carefully)
>
> - **HMR caveat** (architecture/02-integration-boundaries.md): Vite HMR doesn't reliably propagate edits inside `file:`-linked deps. Once you edit protection-portal's RecommendedCoverage, restart mc's dev server.
> - **Silent-prop-drop class** (memory feedback_silent_prop_drop.md): when wiring new props into RecommendedCoverage or the new spawn path, verify the destructured signature first. If you're adding `insuranceSavings.status` reads to RecommendedCoverage, check that the prop arrives where you think it does.
> - **Don't break the protection→insurance arrow.** Protection's RecommendedCoverage already does its OWN cross-sell into insurance via CrossSellSubFlow. The no-savings handling must work for BOTH directions: launched from protection's own CrossSell completion AND from mc's coverage cross-component. The component shouldn't care which caller drove it.
> - **Phase 1 mutation is OK** for opportunity creation — the spawned opp is session-scoped via session-data.appendOpportunity. The thin `packages/api/opportunities.create()` wrapper exists to give downstream consumers (Phase 2 SDK) a stable contract.
> - **Read-only protection-portal otherwise.** The ONLY cross-repo edit is RecommendedCoverage's no-savings handling. Anything else (status-step-map, AgentView, CrossSellSubFlow) is OFF-LIMITS.
>
> ---
>
> ## Report back (under 400 words):
> 1. Files created / modified per repo (platform + mc + protection-portal).
> 2. Sample shape of `mapInsuranceWorkflowToSavings()` output for each of the four states (pending capture / capture-only / quote-with-savings / quote-no-savings) — one-line JSON each.
> 3. Where in the insurance CoPilot right pane the InsuranceSavingsCard mounts (above timeline / band / sidebar — your call).
> 4. How `opportunities.create()`'s session-data registration works (one paragraph).
> 5. Confirmation that protection's RecommendedCoverage still renders correctly when launched FROM protection's own CrossSellSubFlow with both savings-found and no-savings outcomes.
> 6. Commit SHAs (2).
> 7. Anything worth flagging for follow-up — especially gaps you spotted in the ADR.

## Wave 32 — v3.0.12 RecommendedCoverage redesign (2026-05-14)

Cross-refs: `architecture/22-recommended-coverage-redesign.md`. STATUS Wave 32 entry is the human-facing summary; this section holds the single dispatch template. **Runs after Wave 31b (LANDED — protection-portal `8bc5223`).**

### § 32a — protection-portal: RecommendedCoverage redesign

Open `protection-portal` in a fresh session and paste:

> Read `protection-portal/CLAUDE.md` and `protection-portal/README.md` first to orient. Then read these coordinator-owned files (READ-ONLY — do not edit them):
> - `~/Documents/Claude/Projects/blinker-platform/architecture/22-recommended-coverage-redesign.md` — the full ADR; this dispatch implements Phase B.
> - `~/Documents/Claude/Projects/blinker-platform/STATUS.md` Wave 32 + Wave 31 entries.
> - `~/Documents/Claude/Projects/blinker-platform/canon/plan-mappings.json` — note the new `covered_components_default` (per tier) + `covered_components` (per plan, currently null) fields.
> - `~/Documents/Claude/Projects/blinker-platform/packages/utils/plan-presentation.js` — `resolvePlanPresentation()` now returns `coveredComponents` (string array).
> - `~/Documents/Claude/Projects/refi-portal/src/refinance-v2-prototype.jsx` lines ~4008-4095 — the **visual reference**. Paraphrase the layout (don't import — refi-prototype is a monolith that this work intentionally doesn't depend on).
>
> This is a **single-dispatch redesign** of `src/views/customer/RecommendedCoverage.jsx`. Wave 31b just landed in the same file (commit `8bc5223`) and added handling for `form.insuranceSavings.status === 'no_savings'`. Pull from main first; rebase off 31b if needed. The 31b contract MUST be preserved (see § Regression below).
>
> ## What to build
>
> Replace the current stacked PlanCard layout with this layout (paraphrased from refi-portal):
>
> 1. **Header** — keep existing `ScreenHeader` / breadcrumb. Add the small italic subtitle `Here is your personal quote based on your vehicle and info you provided` immediately below the header (matches refi precedent).
>
> 2. **Optional insurance buying-power info box** — render ONLY when `form.insuranceSavings?.monthlySavingsCents > 0`. Orange + blue gradient background, ShieldCheck icon, two-line copy:
>    - Title: `Insurance savings = buying power`
>    - Body: `The $${monthlySavings}/mo in insurance savings can help offset the cost of a protection plan.`
>    - If `form.insuranceSavings.captureCarrier` is known, change body to: `... when compared to {captureCarrier}, which can help offset the cost of a protection plan.`
>
> 3. **Tier picker (3-up segmented)** — Best / Better / Good buttons, left-to-right. Each button is a `<button>` that calls `selectPlan(plan.id)` and shows `selected` styling when `form.selectedPlanId === plan.id`. Content per button:
>    - Tier label in uppercase
>    - Monthly price as a large `${monthly}` (rounded to nearest dollar OR `.toFixed(2)` — match refi's `Math.round` when savings exist, `.toFixed(2)` when not — your call, just be consistent)
>    - When `monthlySavings > 0`: render `$${adjusted}` in emerald + `$${original}` strikethrough (small, slate-400). When no savings: render only the original monthly.
>    - `per month` subtitle below
>
> 4. **Adjustment footnote** — render below the picker ONLY when `monthlySavings > 0`: `*Adjusted by $${monthlySavings} per month in Auto Insurance Savings`. Centered italic slate-500.
>
> 5. **Selected plan details card** — single card showing the currently selected tier's data:
>    - Header band (slate-50 background):
>      - Plan title (bold). Pull from `resolvePlanPresentation(...).planTitle`. If the plan carries a "New rate" flag (existing `<NewRatePill>` or equivalent in current PlanCard), render that pill inline next to the title.
>      - Subtitle: `{term} months or {miles} miles` (small, slate-500). Read term + miles from the selected `product` (the existing PlanCard reads these from `product.term_months` + `product.miles`).
>    - Body:
>      - **Features + add-ons pills row** — moved ABOVE the coverage components grid (per ADR D3 + PDF instruction). Existing pills like `Enhanced Electronics +$250` and `Maintenance Feature included` move here. Use the existing pill components — don't re-style.
>      - **Coverage heading** (small, e.g. `Most comprehensive coverage available`) — pull from `resolvePlanPresentation(...).coverageHtml`'s `<h2>` text, OR hardcode by tier (good: "Affordable coverage designed for older vehicles" / better: "Extensive coverage that protects a wide range of components" / best: "Most comprehensive coverage available"). Your call — if HTML parsing is fragile, hardcode. Flag the choice in report-back.
>      - **Covered components grid** — read from `resolvePlanPresentation(...).coveredComponents` (string array). Render as a 2-column grid of `✓ {component}` rows. Use Check icon (emerald) like refi does. Empty array → render nothing.
>
> 6. **Total price, add-ons, monthly breakdown** — HIDDEN at this stage per ADR D2. The next step (Customize / Confirm / Billing) shows these. Remove the PlanCard's `~$317/mo` / `+ $250 add-ons` / `Total $3,800` block from this surface.
>
> ## Where existing code lives
>
> - `src/views/customer/RecommendedCoverage.jsx` (~566 lines today) — the file to redesign.
> - `CrossSellCtas` component (inside RecommendedCoverage.jsx ~line 471) — **keep as-is**. The boost-slot Result Chip + Find-insurance-savings CTA + the Wave 31b no_savings handling at ~line 510-520 stay intact. The tier picker mounts BELOW the CrossSellCtas block, where the stacked PlanCards used to be.
> - `PlanCard` component — currently the primary rendering surface inside RecommendedCoverage. After redesign, PlanCard is no longer mounted inside RecommendedCoverage. Keep it exported (mc's Wave 31b cross-show may consume it — verify; if no consumers remain, removal is fine but flag in report-back).
> - Tier ordering / plan selection logic (`form.selectedPlanId`, `selectPlan(id)`, default-selected-best) — unchanged.
>
> ## Resolver consumption
>
> `resolvePlanPresentation({ orgId, tpaCode, productTypeCode, planCode, planName })` returns `{ planLevel, planTitle, tagline, coverageHtml, coveredComponents, sampleAgreementUrl, docusealTemplateId, source }`. The new `coveredComponents` is an array of strings — fallback chain documented in canon's `_comment`. Use it directly for the grid.
>
> ## Regression — Wave 31b protection
>
> Wave 31b added these behaviors in this same file:
> - `CrossSellCtas` Result Chip flips to "We will continue to monitor savings" when `status === 'no_savings'`. → Untouched.
> - `Find insurance savings` CTA shows DONE when `hasInsuranceResult` is truthy (`insuranceSavings != null`). → Untouched.
> - `PlanCard` monthly column suppresses `-$/mo (insurance vs {carrier})` when `status === 'no_savings'`. → After redesign, PlanCard no longer mounts here, so this is functionally replaced by: when `status === 'no_savings'`, the TierPickerButton renders only original monthly (no strikethrough, no info box). Verify the same outcome holds.
>
> Walk the code paths for these states to confirm:
> 1. `form.insuranceSavings == null` → no info box, no strikethrough, no footnote. Tier buttons show `$${monthly} per month` only.
> 2. `form.insuranceSavings = { monthlySavingsCents: 5000, captureCarrier: 'Progressive', newCarrier: 'Geico' }` → info box (with carrier name) renders, strikethrough renders, footnote renders.
> 3. `form.insuranceSavings = { monthlySavingsCents: 0, status: 'no_savings', captureCarrier: 'Progressive' }` → no info box, no strikethrough, no footnote. CrossSellCtas Result Chip says "monitor savings" (unchanged from Wave 31b). CTA marked DONE.
>
> ## Telemetry
>
> - Keep existing `plan_selected` event firing on TierPickerButton click. Payload unchanged.
> - Add `protection.customer.recommended_coverage.tier_toggled` with `{ from_tier, to_tier, has_insurance_savings, monthly_savings_cents }`.
>
> ## What NOT to do
>
> - Do not edit `CrossSellCtas`, `CtaButton`, `ResultChip`, or anything Wave 31b touched (let those stay intact).
> - Do not edit other repos (no mc, no insurance, no refi).
> - Do not run `npm run dev` / `npm install` between commits — sandbox-kill risk. Use `npm run build` or your project's lint/typecheck to verify.
> - Do not lift the new TierPicker to `packages/components` — single-app for now. Lift candidate noted for future if a second app needs it.
>
> ## Commit (1)
>
> `feat(customer): wave 32 v3.0.12 RecommendedCoverage redesign — segmented tier picker + canon-driven covered components`. Body 3-4 bullets covering (a) new tier-picker layout, (b) `resolvePlanPresentation().coveredComponents` consumption, (c) buying-power info box + dual-price + footnote when savings exist, (d) Wave 31b no_savings handling preserved.
>
> Co-author trailer:
> ```
> Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>
> ```
> Git identity per-repo: `dealercrm` / `chad@carcarepeople.com`. **Do NOT push.**
>
> ## Report back (under 300 words)
>
> 1. Files modified.
> 2. How the "Coverage heading" content above the components grid is sourced (canon HTML parsing / hardcoded tier strings / something else).
> 3. Confirmation that the three regression cases above render correctly (walk the code path — no UI smoke required).
> 4. Whether `PlanCard` is still mounted anywhere in protection-portal after the redesign (if not, is it OK to remove its export?).
> 5. Commit SHA.
> 6. Anything worth flagging for follow-up.

## Wave 33 — v3.0.13 Insurance CoPilot post-send layout swap (2026-05-15)

Cross-refs: `architecture/23-insurance-copilot-post-send-layout.md`. STATUS Wave 33 entry is the human-facing summary; this section holds the two dispatch templates. **33a + 33b can run in parallel — file scope disjoint, prop addition is forward-compatible.**

### § 33a — insurance-portal: AgentView `hideLeadStatusTimeline` prop

Open `insurance-portal` in a fresh session and paste:

> Read `insurance-portal/CLAUDE.md` and `insurance-portal/README.md` first to orient. Then read these coordinator-owned files (READ-ONLY — do not edit):
> - `~/Documents/Claude/Projects/blinker-platform/architecture/23-insurance-copilot-post-send-layout.md` — the full ADR. Your work implements **D5 only**.
> - `~/Documents/Claude/Projects/blinker-platform/STATUS.md` Wave 33 entry — context.
>
> This is a **single small dispatch** scoped to `src/views/agent/AgentView.jsx` only.
>
> ## What to build
>
> Add a new prop `hideLeadStatusTimeline` (default `false`) to AgentView. When the prop is `true`:
>
> 1. **Suppress the LeadStatusTimeline render** in the post-send composition (around lines 566 and 591 per coordinator's exploration — verify the actual line numbers; the post-send branch is where the 2-col grid renders LeadStatusTimeline + ConsumerLinkPanel on the left and NotesPanel + TagPicker on the right).
> 2. **Restructure the layout cleanly** so the right pane reads well without the timeline. Pick the cleanest of these (your call — pick whatever looks best in the standalone shell when you eyeball it):
>    - (a) Collapse the 2-col grid to a single column with ConsumerLinkPanel on top, NotesPanel + TagPicker below.
>    - (b) Keep 2-col but rebalance — ConsumerLinkPanel + NotesPanel on left, TagPicker on right.
>    - (c) Promote ConsumerLinkPanel to full-width above a 2-col NotesPanel + TagPicker row.
>    - Whatever you pick, make sure the spacing matches the rest of AgentView (no orphan single-column elements with awkward whitespace).
> 3. **All other post-send affordances unchanged** — ConsumerLinkPanel, NotesPanel, TagPicker, status header, persona controls, force-status select all stay exactly as they are.
> 4. **Pre-send (LeadOriginationForm) unchanged** — the prop has no effect on the pre-send branch.
>
> ## What NOT to do
>
> - Do not edit any other file. The whole change is local to `AgentView.jsx`.
> - Do not edit other repos.
> - Do not modify `LeadStatusTimeline.jsx` itself — it stays usable for any standalone or future caller.
> - Do not run `npm run dev` between commits — sandbox-kill risk. Smoke test by reading `npm run build` output if your repo has it, or just verify the prop default keeps standalone behavior identical.
> - Do not import the prop from anywhere — it's a new caller-supplied flag with default `false`.
>
> ## Why this matters (context for your edits)
>
> Mission Control's CoPilotPane renders this AgentView via `<InsuranceAgentView />`. Wave 33 D1 says: when the active opp in mc is insurance + post-send, mc shifts focus to its own InsuranceSavingsCard ("Insurance at a glance") in the right pane and surfaces a compact lead-status timeline in mc's LEFT rail (with hover-revealing per-event detail). The full LeadStatusTimeline becomes redundant — but only inside the mc embed. Standalone insurance-portal still wants the full timeline. So mc passes `hideLeadStatusTimeline={true}` and your AgentView honors it.
>
> Wave 33b (mission-control side, dispatched in parallel) will add the prop pass + build the left-rail timeline. Your work is the standalone-shell half of the parallel-dev-panels pattern (per `feedback_parallel_dev_panels.md`).
>
> ## Commit (1)
>
> `feat(agent-view): wave 33 v3.0.13 hideLeadStatusTimeline prop for mc embed (D5)`. Body 2 bullets covering (a) prop default false / standalone unchanged, (b) post-send layout restructure when true.
>
> Co-author trailer:
> ```
> Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>
> ```
> Git identity per-repo: `dealercrm` / `chad@carcarepeople.com`. **Do NOT push.**
>
> ## Report back (under 200 words)
>
> 1. File modified + new prop signature.
> 2. Which layout option you picked (a/b/c above) and why.
> 3. Confirmation that pre-send branch is untouched.
> 4. Confirmation that the prop default (`false`) preserves standalone behavior bit-for-bit.
> 5. Commit SHA.

### § 33b — mission-control: left-rail timeline enhancement + right-pane redirect

Open `mission-control` in a fresh session and paste:

> Read `mission-control/CLAUDE.md` and `mission-control/README.md` first to orient. Then read these coordinator-owned files (READ-ONLY — do not edit):
> - `~/Documents/Claude/Projects/blinker-platform/architecture/23-insurance-copilot-post-send-layout.md` — the full ADR. Your work implements **D1, D2, D3, D4** (D5 is being landed in parallel by 33a in `insurance-portal`).
> - `~/Documents/Claude/Projects/blinker-platform/architecture/21-insurance-protection-cross-sell.md` — Wave 31b context. Your changes generalize a component shipped in 31b D4.
> - `~/Documents/Claude/Projects/blinker-platform/STATUS.md` Wave 33 + Wave 31 entries.
> - `~/Documents/Claude/Projects/insurance-portal/src/views/agent/LeadStatusTimeline.jsx` — read for the **per-stage detail blocks** you'll replicate (CaptureDetail / QuoteDetail / QuoteViewedDetail / PolicyDetail) and the date-grouping helpers (`timezoneForOrg`, `makeFormatters`). Don't import — replicate.
> - `~/Documents/Claude/Projects/protection-portal/src/components/PlanCard.jsx::MonthlyTooltip` — the canonical Tooltip pattern reference (per `feedback_tooltip_pattern.md`). Replicate the trigger-ref + getBoundingClientRect + position:fixed + opacity-transition pattern. Native `title=` is forbidden.
>
> This is a **single Opus dispatch** spanning two mc files:
> - `src/components/RelatedInsuranceProgress.jsx` — generalize + add date separators + add hover popovers.
> - `src/lib/CoPilotPane.jsx` — mount the timeline under active-opp ctx-pane when current opp is insurance; pass `hideLeadStatusTimeline={true}` to `<InsuranceAgentView />` post-send.
>
> ## What to build — A) RelatedInsuranceProgress generalization
>
> 1. **Mount under active opp.** Today the component renders only inside related-opp rows in `OpportunityContextPane` (~line 2113-2130 in CoPilotPane.jsx). Add a second mount point: when the active opp itself has `type === 'insurance'`, render the timeline at the same visual altitude as the existing related-opp pattern (after VEHICLE summary, before/merging-with RELATED OPPORTUNITIES). Pick whatever placement reads cleanly — the visual goal is screenshot 2 of the v3.0.13 PDF (left rail showing the 9-row CAPTURE+QUOTE PROGRESS block under the vehicle card).
>
> 2. **Rename optional.** `RelatedInsuranceProgress` is slightly misleading post-generalization. You MAY rename to `InsuranceProgressTimeline` and re-export the original name as an alias to avoid touching every importer. OR keep the name and just update the file header comment to reflect the dual-purpose. Either is fine — pick whichever generates less churn.
>
> 3. **Omit "Open insurance CoPilot →" affordance** when rendering for the active opp itself (the agent is already on it). Today the affordance is gated on `onOpenInCoPilot` being passed — for the active-opp mount, simply don't pass the callback.
>
> 4. **New prop: `workflowSnapshot`.** The popover content (D4 below) needs the workflow snapshot for carrier/premium/policy ref — those fields don't live on activities. Read the workflow snapshot from `useSessionData()` (or whatever the existing CoPilotPane access pattern is — check how other left-rail elements like the vehicle card already read it) and thread it through. The snapshot shape mirrors what insurance-portal AgentView passes to `<LeadStatusTimeline workflow={...} />` — same field structure: `policyInfo`, `quote`, `policy`, `vehicles`, `media`, etc.
>
> ## What to build — B) Date separators (D3)
>
> 1. **Long-form `Month Day, Year` separators** rendered above the FIRST event row always, and inserted between adjacent events when their local-day differs.
>
> 2. **Org timezone resolution.** Use `timezoneForOrg(orgId)` (the helper insurance-portal's `LeadStatusTimeline.jsx` already uses — replicate it as an mc-local function or pass as a prop, your call). Group key uses `Intl.DateTimeFormat('sv-SE', { timeZone: orgTz })` (sv-SE locale gives `YYYY-MM-DD` which sorts cleanly). Display string uses `Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: orgTz })`.
>
> 3. **Styling.** Small uppercase tracking-wide pill in slate-500 text, indent-aligned with the row content (not the gutter check icon). Match the visual weight of the existing `Capture+quote progress` section header — secondary, not heavy.
>
> 4. **Always show first separator.** Even when there's only one event, the separator above it renders. (The PDF says "at the very least above 'Started'".)
>
> 5. **Future-event rows** (no timestamp yet) don't need separators — they're below the last-known-day separator implicitly.
>
> ## What to build — C) Per-event hover popovers (D4)
>
> 1. **Wrap each timeline row in a Tooltip popover** using the canonical pattern from `protection-portal/src/components/PlanCard.jsx::MonthlyTooltip`:
>    - `useRef` on the row trigger
>    - `useState` for `open`
>    - `onMouseEnter` / `onMouseLeave` / `onFocus` / `onBlur` to drive `open`
>    - When open: compute `getBoundingClientRect()`, render a `position: fixed` div with placement that opens to the RIGHT of the row (the rail itself is on the left edge of the viewport — opening right avoids viewport clipping; verify with anti-clip math if the rail is ever rendered closer to viewport center).
>    - opacity-transition class on open/close
>    - `pointer-events-none` when closed
>    - `stopPropagation` on toggle if the row has its own click handler
>
> 2. **Replicate the 4 detail blocks** from `insurance-portal/src/views/agent/LeadStatusTimeline.jsx` as inline functions inside `RelatedInsuranceProgress.jsx`:
>    - `CaptureDetail({ snapshot })` — renders carrier + policyNumber, vehicle YMMT, "View ID card" link, "Verified via ID card" pill, verifiedAt long-form.
>    - `QuoteDetail({ snapshot })` — renders carrier, premium `$X / 6mo`, savings `$Y / 6mo (≈ $Z / yr)` when present, createdAt formatted time.
>    - `QuoteViewedDetail({ snapshot })` — renders viewedAt formatted time.
>    - `PolicyDetail({ snapshot })` — renders carrier, policy.id with the existing `policy_number pending — EI does not surface today` orange caveat copy.
>    - For other rows (started / lead.created / capture_link.* / quote_link.*) — popover content is just the timestamp (`formatTime(at)`). Or omit the popover entirely for those rows — your call. Document in the report-back which you picked.
>
> 3. **DO NOT cross-app import** the detail blocks from insurance-portal. DO NOT lift to `packages/`. Replication is intentional per ADR D4 + 3-strikes rule + existing duplication of `CAPTURE_AND_QUOTE_PATH` in this same file (file header §3 spells out the rationale).
>
> 4. **Tooltip render styling** — match the visual weight of PlanCard's MonthlyTooltip: small (text-[11px] / text-xs), white background, slate-200 border, rounded-md, shadow-lg, p-2 / p-3 padding. Width ~240-300px to fit the detail blocks readably.
>
> ## What to build — D) Right-pane prop pass (D1)
>
> 1. In `mc/src/lib/CoPilotPane.jsx`, find the `<InsuranceAgentView />` mount (~line 1765-1771 area per coordinator's exploration; verify). Pass `hideLeadStatusTimeline={true}` when:
>    - active opp `type === 'insurance'`, AND
>    - workflow state is post-send: `flowPath === 'capture_and_quote'` AND status ≥ `capture_link.sent` (i.e. status is one of `capture_link.sent`, `capture_link.viewed`, `capture.completed`, `quote.completed`, `quote.viewed`, `policy.bound`); OR `flowPath === 'quote_only'` AND status ≥ `quote_link.sent`.
>    - Pre-send (status `started`, `lead.created`, `capture_link.created`, `quote_link.created`) → pass `false` (or omit the prop). The LeadOriginationForm path stays.
>
> 2. The 33a parallel dispatch may not have landed yet when you commit. That's OK — passing the prop before AgentView consumes it is harmless (React tolerates unknown props on custom components). Document the dependency in the commit body.
>
> ## Telemetry
>
> - **Extend** existing `mc.copilot.related_insurance_progress.viewed` (or whatever you rename it to) with a new field `context: 'active_opp' | 'related_opp'`.
> - **New** `mc.copilot.insurance_progress.hover_detail_viewed` with `{ stage, opp_id, context }`. Fire on first hover-open per stage row per mount (use a `Set` ref to gate).
> - **New** `mc.copilot.lead_status_timeline_suppressed` with `{ reason: 'left_rail_active', opp_id }`. Fire once per CoPilot session when D1 suppression activates.
>
> ## What NOT to do
>
> - Do not edit insurance-portal, protection-portal, refi-portal — your work is mc-only.
> - Do not lift the timeline detail blocks to `packages/components/` — 2 consumers, 3-strikes rule.
> - Do not edit `LeadStatusTimeline.jsx` in insurance-portal — it stays as standalone-shell surface.
> - Do not use native `title=` for the hover popovers — use the canonical Tooltip pattern.
> - Do not run `npm run dev` between commits — sandbox-kill risk. Use `npm run build` to verify (or whatever lint/typecheck the repo has).
> - Do not change the timestamps source for the timeline rows themselves — the 9-row main path stays sourced from `blinkerApi.activities.list({ contact_id, opportunity_id })`. Workflow snapshot is ONLY for popover detail content.
>
> ## Commit (1)
>
> `feat(copilot): wave 33 v3.0.13 insurance left-rail timeline + right-pane focus shift (D1-D4)`. Body 4-5 bullets covering (a) RelatedInsuranceProgress generalized to active-opp mount + workflow snapshot prop, (b) date separators, (c) per-event hover popovers using canonical Tooltip pattern + 4 detail blocks replicated, (d) `hideLeadStatusTimeline={true}` passed to InsuranceAgentView when active+post-send, (e) telemetry extensions. Note in body: depends on insurance-portal Wave 33a (parallel dispatch) consuming the new prop — forward-compatible until then.
>
> Co-author trailer:
> ```
> Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
> ```
> Git identity per-repo: `dealercrm` / `chad@carcarepeople.com`. **Do NOT push.**
>
> ## Report back (under 400 words)
>
> 1. Files modified + (if you renamed RelatedInsuranceProgress) the new component name + alias.
> 2. Where exactly the active-opp timeline mounts in OpportunityContextPane (line range or section).
> 3. Whether you opted to render popovers for ALL rows or only the 4 detail-rich rows.
> 4. Confirmation that the 9-row main path render is byte-identical between active-opp + related-opp contexts (only the detail-popover content changes).
> 5. Whether you renamed `mc.copilot.related_insurance_progress.viewed` (with back-compat aliasing) or just extended it with the `context` field.
> 6. Tooltip placement strategy — direction (right of row vs below row) and your chosen anti-clip behavior near the rail's right edge.
> 7. Commit SHA.
> 8. Anything worth flagging for follow-up (especially: spec gaps where workflow snapshot fields aren't populated for fixture insurance opps, since popover detail will appear empty in those cases).


## Wave 34 — Protection progress timeline (2026-05-15)

Cross-refs: `architecture/24-protection-progress-timeline.md`. STATUS Wave 34 entry is the human-facing summary. Single mc dispatch.

### § 34a — mission-control: protection progress timeline + step write-through

Open `mission-control` in a fresh session and paste:

> Read `mission-control/CLAUDE.md` and `mission-control/README.md` first to orient. Then read these coordinator-owned files (READ-ONLY — do not edit):
> - `~/Documents/Claude/Projects/blinker-platform/architecture/24-protection-progress-timeline.md` — the full ADR. Your work implements all 6 decisions (D1-D6).
> - `~/Documents/Claude/Projects/blinker-platform/architecture/23-insurance-copilot-post-send-layout.md` — D3 (date-separator rules) + D4 (the insurance timeline this one mirrors).
> - `~/Documents/Claude/Projects/blinker-platform/STATUS.md` Wave 34 + Wave 33 entries.
> - `mission-control/src/components/RelatedInsuranceProgress.jsx` — the visual + structural template. Your new component is its protection twin.
> - `protection-portal/src/views/customer/CustomerView.jsx` — find `buildSteps` / `BASE_STEPS` (the wizard step factory + base list). Read for the step-key sequence + any exported step labels.
> - `protection-portal/src/lib/status-step-map.js` — `stepFromStatus` (VSC display name → step key) + `STATUS_TO_STEP`.
> - `protection-portal/src/components/PlanCard.jsx` — `MonthlyTooltip`, the canonical Tooltip pattern (per `feedback_tooltip_pattern.md`). Native `title=` is forbidden.
>
> This is a **single Opus dispatch** spanning two mc files:
> - NEW `src/components/RelatedProtectionProgress.jsx`.
> - `src/components/CoPilotPane.jsx` — protection step write-through + two mount points.
>
> ## What to build — A) RelatedProtectionProgress.jsx (D1, D2, D3, D6)
>
> A compact protection wizard step timeline, the structural twin of `RelatedInsuranceProgress.jsx`. Copy that component's layout language: one row per step, emerald check icon for `past`, blue spinner for `current`, grey dot for `future`, timestamp (mono, slate-400) on completed rows, long-form `Month Day, Year` date separators (above the first event always; repeated between adjacent events when the local day changes — same rules as ADR 23 D3 / RelatedInsuranceProgress).
>
> **Step list (D2):**
> - Import `buildProtectionSteps` (the `buildSteps` factory — already imported in CoPilotPane.jsx; check the existing import path) — call it with the live `protectionForm` for the **active-opp** render.
> - For the **related-opp** render there is no live form: use the base step list (conditional steps `garage_location` / `customize` / `vin_validate` / `rates_changed` omitted), unioned with any conditional steps that appear in the opp's `step_change` activity history, re-sorted into canonical order.
> - Step keys (`vehicle_add`, `vehicle_drive`, …) need human labels. If protection-portal exports a step-label map, import it. If not, define an mc-local `STEP_LABEL` constant (acceptable duplication — same rationale as `RelatedInsuranceProgress`'s in-file `CAPTURE_AND_QUOTE_PATH` literal; document it in the file header).
>
> **Progress state (D3):**
> - `context === 'active_opp'`: accept a `currentStepIdx` prop (the live `protectionStepIdx`). Steps with index `< currentStepIdx` → `past`; `=== currentStepIdx` → `current`; `>` → `future`.
> - `context === 'related_opp'`: derive the current step from `opportunity.status` via `stepFromStatus`; read completed-step timestamps from `blinkerApi.activities.list({ contact_id, opportunity_id })` filtered to `type === 'step_change'`. Accept an optional `protectionProgress` prop (the persisted `opportunity.protection_progress`) as the furthest-step fallback when activity history is sparse.
>
> **Hover popovers (D6 — light):** wrap each row in a Tooltip popover using the canonical PlanCard `MonthlyTooltip` pattern (trigger `useRef` + `getBoundingClientRect` + `position: fixed` + opacity-transition). Content is LIGHT — step friendly-label + a one-line step description + the completion timestamp. Do NOT build rich per-step detail blocks (no plan/amount lookups) — that's deliberately deferred. Define a short `STEP_DESCRIPTION` map for the one-liners.
>
> **Props:** mirror RelatedInsuranceProgress's shape — `{ opportunity, context, currentStepIdx, protectionForm, protectionProgress, orgId, onOpenInCoPilot }`. `onOpenInCoPilot` omitted for the active-opp mount (agent is already on it).
>
> ## What to build — B) Protection step write-through in CoPilotPane.jsx (D4)
>
> Protection writes NO activity rows today — `protectionStepIdx` is in-memory only. Add a write-through, modeled on the insurance Wave 31b-fu4 effect (search `CoPilotPane.jsx` for the insurance write-through `useEffect` that fires on `insuranceWorkflow.status` and calls `activitiesApi.create({ type: 'status_change', … })` — use it as the template).
>
> In the `ProtectionEmbed` wrapper component, add a `useEffect` watching `protectionStepIdx`. On a **forward** transition `i → j` (j > i) for the active protection opp:
> 1. **Append `step_change` activity rows** — one per newly-completed step in the span `[i, j)` — via `blinkerApi.activities.create({ contact_id, opportunity_id, type: 'step_change', source: 'system', payload: { from_step, to_step, completed_step, step_idx }, summary_text: 'Protection step: <label>' })`. (A normal Continue advances one step; a force-status/resume jump completes a span.)
> 2. **Persist `protection_progress`** on the opp record — `updateOpportunity(opportunity.id, { protection_progress: { furthest_step_idx, furthest_step_key, updated_at } })`. Additive field; mirrors the insurance `summary` fu3 pattern. Do NOT touch `opportunity.status` (protection status stays the VSC display name).
> 3. **Loop-safety:** use a `previousStepRef` ref guard exactly like the insurance write-through's `previousStatusRef` — after `updateOpportunity` re-renders, the effect must not re-fire. Guard on the ref, not just the dep array.
>
> Resolve the step KEYS for the payload from `buildProtectionSteps(protectionForm)` indexed by `i` / `j`.
>
> ## What to build — C) Mounts in OpportunityContextPane (D5)
>
> Mirror the `RelatedInsuranceProgress` mount points (the Wave 33b active-opp mount + the related-opp mount inside `RelatedOppRow`):
> - **Active-opp mount:** when the active opp `type === 'protection'` OR `'vsc'`, render `<RelatedProtectionProgress context="active_opp" … />` in its own `px-5 py-4 border-b border-slate-200` section with a `<SectionLabel>Workflow progress</SectionLabel>` header, positioned **after the Vehicle section and immediately above the RELATED OPPORTUNITIES section** — the same altitude the insurance active-opp timeline mounts at. Pass `currentStepIdx={protectionStepIdx}` + `protectionForm`.
> - **Related-opp mount:** inside `RelatedOppRow`, when `relatedOpp.type === 'protection' || relatedOpp.type === 'vsc'`, render `<RelatedProtectionProgress context="related_opp" opportunity={relatedOpp} … />` — mirror how the insurance related-opp mount passes `onOpenInCoPilot` (clickable when navigable).
>
> ## Telemetry
>
> - `mc.copilot.protection_progress.viewed` — once per mount (ref-gated), `{ context, opp_id }`.
> - `mc.copilot.protection_progress.step_persisted` — on each write-through fire, `{ opp_id, from_step, to_step }`.
> - `mc.copilot.protection_progress.hover_detail_viewed` — first hover-open per step row per mount (Set ref), `{ step_key, opp_id }`.
>
> ## What NOT to do
>
> - Do not edit protection-portal, insurance-portal, refi-portal, or blinker-platform — your work is mc-only (new component + CoPilotPane).
> - Do not lift the component to `packages/` — mc-local until a 3rd consumer (3-strikes rule).
> - Do not build rich per-step detail popovers — light only (D6).
> - Do not write `opportunity.status` from the write-through — protection status stays the VSC display name; step progress lives in `protection_progress` + `step_change` activities.
> - Do not run `npm run dev` between commits — sandbox-kill risk. Use `npm run build` to verify.
>
> ## Phase 1 note
>
> Per ADR 24 §Phase-1: there is no back-channel from a customer's self-serve capture-link session to the agent's mc CoPilot. Wave 34 fully delivers the **agent-driven** path (agent advances the wizard in the CoPilot embed → `protectionStepIdx` changes → timeline updates live → write-through persists it). Don't try to build a customer back-channel — that's Phase 2. Just make the component render correctly for whatever drives `protectionStepIdx` / `step_change` activities.
>
> ## Commit (1)
>
> `feat(copilot): wave 34 protection progress timeline + step write-through`. Body 4-5 bullets: (a) new RelatedProtectionProgress component (compact step timeline, date separators, light popovers); (b) protection step write-through — first protection activity-write path, appends step_change rows + persists protection_progress; (c) active-opp + related-opp mounts above RELATED OPPORTUNITIES; (d) telemetry; (e) Phase-1 limitation — customer-link back-channel deferred to Phase 2.
>
> Co-author trailer:
> ```
> Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
> ```
> Git identity per-repo: `dealercrm` / `chad@carcarepeople.com`. **Do NOT push.**
>
> ## Report back (under 400 words)
>
> 1. Files created/modified.
> 2. Step-label source — imported from protection-portal or mc-local map? List the step keys + labels you used.
> 3. How the related-opp step list is derived when there's no live form.
> 4. Write-through: confirm the `previousStepRef` loop-guard and that `opportunity.status` is never written.
> 5. Confirm the active-opp mount sits directly above RELATED OPPORTUNITIES.
> 6. `npm run build` result + commit SHA.
> 7. Follow-up flags — especially any fixture protection opps that would show an empty/odd timeline (no step_change history, no protection_progress), and whether the related-opp timeline degrades gracefully for them.

## Wave 35 — Refi progress timeline (2026-05-15)

Cross-refs: `architecture/25-refi-progress-timeline.md` + `architecture/24-protection-progress-timeline.md` (the template). Single mc dispatch.

### § 35a — mission-control: refi progress timeline + step write-through

Open `mission-control` in a fresh session and paste:

> Read `mission-control/CLAUDE.md` and `mission-control/README.md` first to orient. Then read these coordinator-owned files (READ-ONLY — do not edit):
> - `~/Documents/Claude/Projects/blinker-platform/architecture/25-refi-progress-timeline.md` — the full ADR. Your work implements all 6 decisions.
> - `~/Documents/Claude/Projects/blinker-platform/architecture/24-protection-progress-timeline.md` — the template ADR; Wave 34 built the protection twin of this exact feature.
> - `~/Documents/Claude/Projects/blinker-platform/STATUS.md` Wave 35 + Wave 34 entries.
> - `mission-control/src/components/RelatedProtectionProgress.jsx` — your DIRECT structural template. `RelatedRefiProgress` is its refi twin — copy its shape, swap protection specifics for refi.
> - `mission-control/src/components/CoPilotPane.jsx` — study the Wave 34 protection write-through (the `step_change` `useEffect` in `ProtectionEmbed`, ~lines 1310-1374) + the protection mounts (active-opp ~lines 2277-2288; related-opp in `RelatedOppRow` ~lines 2417-2427). You will mirror all three for refi.
> - `refi-portal/src/lib/refi.js` — `getSequence(form, hasCoApp)`, the refi wizard step factory.
> - `refi-portal/src/lib/status-step-map.js` — `stepFromStatus(status, fallback='vehicle_add')` + `STATUS_TO_STEP`.
> - `protection-portal/src/components/PlanCard.jsx` — `MonthlyTooltip`, the canonical Tooltip pattern (`feedback_tooltip_pattern.md`). Native `title=` forbidden.
>
> This is a **single Opus dispatch** spanning two mc files:
> - NEW `src/components/RelatedRefiProgress.jsx`.
> - `src/components/CoPilotPane.jsx` — refi step write-through + two mount points.
>
> ## A) RelatedRefiProgress.jsx (D1, D2, D3, D6)
>
> Build it as the refi twin of `RelatedProtectionProgress.jsx` — same layout language (one row per step, emerald check `past` / blue spinner `current` / grey `future`, completed-row timestamps, long-form `Month Day, Year` date separators above first event + on day-change, light Tooltip popovers).
>
> **Step list (D2):** import `getSequence` from `refi-portal/src/lib/refi.js`. Active-opp render: call `getSequence(refiForm, hasCoApp)` with the live form (derive `hasCoApp` from the form the way refi does — check how `refi.js` itself determines it). Related-opp render: no live form — use the standard-order no-co-app base sequence as `CANONICAL_STEP_ORDER`, unioned with any co-app/reordered steps observed in the opp's `step_change` activity history, re-sorted to canonical order. Canonical order: `vehicle_add, vehicle_drive, s1_ownership, s1_auto_loan, s1_credit, s1_applicant, s1_housing, s1_employment, s1_co_app_decision, s1_co_app_contact, s1_co_app_employment, s1_identity_consent, decision_engine, stage2_result`.
>
> Step labels — define an mc-local `REFI_STEP_LABEL` map (refi-portal exports none; document the duplication in the file header, same as RelatedProtectionProgress's STEP_LABEL). Labels: vehicle_add=Add vehicle, vehicle_drive=Driving habits, s1_ownership=Ownership, s1_auto_loan=Auto loan, s1_credit=Credit, s1_applicant=Applicant, s1_housing=Housing, s1_employment=Employment, s1_co_app_decision=Co-applicant, s1_co_app_contact=Co-applicant contact, s1_co_app_employment=Co-applicant employment, s1_identity_consent=Identity & consent, decision_engine=Prequalification, stage2_result=Offers. Plus a short `REFI_STEP_DESCRIPTION` map for popover one-liners.
>
> **Progress (D3):** active-opp — `currentStepIdx` prop (live `refiStepIdx`). related-opp — `stepFromStatus(opportunity.status, 'vehicle_add')` for the current step; completed-step timestamps from `blinkerApi.activities.list({ contact_id, opportunity_id })` filtered to `type === 'step_change'` AND `payload.workflow_type === 'refi'`; accept a `refiProgress` prop (the persisted `opportunity.refi_progress`) as the furthest-step fallback.
>
> **Props:** `{ opportunity, context, currentStepIdx, refiForm, refiProgress, orgId, onOpenInCoPilot }` — mirror RelatedProtectionProgress.
>
> ## B) Refi step write-through in CoPilotPane.jsx (D4)
>
> Refi writes NO activity rows today. Add a write-through in the `RefiAgentEmbedInner` wrapper (~line 167), modeled exactly on the Wave 34 protection write-through `useEffect` in `ProtectionEmbed`. On a forward `refiStepIdx` transition `i → j` (j > i):
> 1. Append one `step_change` activity per newly-completed step in `[i, j)` — `blinkerApi.activities.create({ contact_id, opportunity_id, type: 'step_change', source: 'system', payload: { from_step, to_step, completed_step, step_idx, workflow_type: 'refi' }, summary_text: 'Refi step: <label>' })`. Resolve step keys from `getSequence(refiForm, hasCoApp)`.
> 2. Persist `refi_progress` on the opp record — `updateOpportunity(opportunity.id, { refi_progress: { furthest_step_idx, furthest_step_key, updated_at } })`. Additive; do NOT touch `opportunity.status`.
> 3. `previousStepRef` loop-guard, exactly like the protection write-through.
>
> Confirm `RefiAgentEmbedInner` has `updateOpportunity` available — if not, thread it through the same way `ProtectionEmbed` / `InsuranceEmbed` receive it (check those for the prop-threading pattern).
>
> ## C) Mounts in OpportunityContextPane (D5)
>
> - **Active-opp:** when active opp `type === 'refi'`, render `<RelatedRefiProgress context="active_opp" currentStepIdx={refiStepIdx} refiForm={refiForm} orgId={contact?.org_id ?? null} … />` in its own `px-5 py-4 border-b border-slate-200` block with `<SectionLabel>Workflow progress</SectionLabel>`, after Vehicle + immediately above RELATED OPPORTUNITIES — same altitude as the protection active-opp mount.
> - **Related-opp:** inside `RelatedOppRow`, when `relatedOpp.type === 'refi'`, render `<RelatedRefiProgress context="related_opp" opportunity={relatedOpp} refiProgress={relatedOpp.refi_progress || null} orgId={orgId ?? null} onOpenInCoPilot={clickable ? (oppId) => handleProgressClick(oppId) : undefined} />`. `RelatedOppRow` already receives `orgId` (Wave 34-fu3) — reuse it.
>
> ## Telemetry
>
> `mc.copilot.refi_progress.viewed` `{ context, opp_id }` (once per mount, ref-gated); `mc.copilot.refi_progress.step_persisted` `{ opp_id, from_step, to_step }`; `mc.copilot.refi_progress.hover_detail_viewed` `{ step_key, opp_id }` (first hover-open per step per mount).
>
> ## What NOT to do
>
> - Do not edit refi-portal, protection-portal, insurance-portal, or blinker-platform — mc-only (new component + CoPilotPane).
> - Do not lift to `packages/` — mc-local.
> - Do not build rich per-step popovers — light only.
> - Do not write `opportunity.status` from the write-through.
> - Do not run `npm run dev` — sandbox-kill risk. Verify with `npm run build`.
>
> ## Phase 1 note
>
> No customer-link back-channel (ADR 25 §Phase-1). Deliver the agent-driven path; don't build a back-channel. The component must render correctly for whatever drives `refiStepIdx` / `step_change` activities.
>
> ## Commit (1)
>
> `feat(copilot): wave 35 refi progress timeline + step write-through`. Body 4-5 bullets paralleling the Wave 34 commit. Co-author trailer:
> ```
> Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
> ```
> Git identity per-repo: `dealercrm` / `chad@carcarepeople.com`. **Do NOT push.**
>
> ## Report back (under 350 words)
>
> 1. Files created/modified.
> 2. How `hasCoApp` is derived for `getSequence`.
> 3. How the related-opp step list is built without a live form.
> 4. Write-through: confirm `previousStepRef` guard + `opportunity.status` never written + `RefiAgentEmbedInner` had/got `updateOpportunity`.
> 5. Confirm active-opp mount sits directly above RELATED OPPORTUNITIES.
> 6. `npm run build` result + commit SHA.
> 7. Follow-up flags.

## Wave 36 — v3.0.14 Insurance quote-flow refinements (2026-05-15)

Cross-refs: `architecture/26-insurance-quote-flow.md`. STATUS Wave 36 entry is the human-facing summary. Two dispatches — disjoint repos, run in parallel.

### § 36a — mission-control: SavingsCard flow-path copy + timeline header + savings math

Open `mission-control` in a fresh session and paste:

> Read `mission-control/CLAUDE.md` and `README.md` first. Then read these coordinator-owned files (READ-ONLY — do not edit):
> - `~/Documents/Claude/Projects/blinker-platform/architecture/26-insurance-quote-flow.md` — the full ADR. You implement D1, D2a, D4.
> - `~/Documents/Claude/Projects/blinker-platform/STATUS.md` Wave 36 entry.
>
> Three changes, all mission-control, one commit:
>
> **D1 — `src/components/InsuranceSavingsCard.jsx` flow-path-aware (v3.0.14 Task 1).** The card must read the flow path from `workflow.flowPath` (`'quote_only'` | `'capture_and_quote'`; the workflow snapshot already carries it). Today the `sent` phase (~lines 190-202) renders the literal **"Capture link sent. The hero updates once the customer shares their current carrier"** — wrong for quote-only. Change:
> - `sent`-phase body copy: `flowPath === 'quote_only'` → quote language, e.g. **"Quote link sent. The hero updates once the customer's quote is returned."** (no "Capture", no "shares their current carrier"). `capture_and_quote` → keep the existing capture copy.
> - Find Coverage CTA gate (today `const ctaDisabled = phase === 'sent';` ~line 173): for `quote_only`, the CTA must be **enabled** in the `sent` phase (`ctaDisabled = phase === 'sent' && flowPath !== 'quote_only'`). For `capture_and_quote`, unchanged. Rationale: on quote-only there's no capture event to wait for — the agent should be able to spawn a protection opp while the quote is pending.
> - Audit the file for any other stray "capture"/"Capture" wording that would show on a quote-only opp; the `capture_only` phase is unreachable for quote-only (no capture event) so its copy needn't change. Report what you find.
> - Emit `mc.copilot.savings_card.find_coverage.enabled_in_sent` (diagnostic) when D1 enables the CTA early on a quote-only opp.
>
> **D2a — `src/components/RelatedInsuranceProgress.jsx` header (Task 2).** The component already derives `const flowPath = opportunity?.flowPath || 'capture_and_quote'`. The hardcoded section-header literal **"Capture+quote progress"** (~line 776) must become conditional: `flowPath === 'quote_only'` → **"Quote progress"**, else **"Capture + quote progress"**.
>
> **D4 — `src/lib/insurance-savings-adapter.js` (Task 3 savings math).** `mapInsuranceWorkflowToSavings(workflow)` today derives savings purely from EI's `quote.payload.savingsAmountCents` (absent on the quote-only path). Add a self-reported-premium path:
> - When `workflow.currentPremiumCents` is present AND a quote exists: normalize the self-reported premium to a 6-month basis using `workflow.premiumCadence` (`'monthly'` → ×6, `'6mo'` → ×1, `'12mo'` → ÷2), then `savings6moCents = normalizedCurrent6mo − workflow.quote.payload.totalPremiumCents`; `monthlySavingsCents = Math.round(savings6moCents / 6)`. If `savings6moCents <= 0`, resolve to the `no_savings` discriminator (the existing `status: 'no_savings'` shape per ADR 21 D6).
> - When `workflow.currentPremiumCents` is absent: fall back to the existing EI `savingsAmountCents` path, unchanged.
> - `workflow.currentCarrier` (display name) should populate the `captureCarrier`-equivalent field in the returned shape so the SavingsCard / cross-shown RecommendedCoverage can name the carrier on the quote-only path. Check the existing return shape and slot it in cleanly.
>
> Do NOT edit other repos. Do NOT run `npm run dev` (sandbox-kill risk) — verify with `npm run build`.
>
> Commit: `feat(copilot): wave 36 v3.0.14 insurance quote-flow — SavingsCard copy, timeline header, self-reported savings`. Co-author trailer `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`. Git identity per-repo `dealercrm` / `chad@carcarepeople.com`. **Do NOT push.**
>
> Report back (under 300 words): files changed; the exact `sent`-phase copy strings (both paths); the `ctaDisabled` expression; any other "capture" wording found; the D4 normalization + no_savings branch; `npm run build` result + commit SHA; follow-up flags.

### § 36b — insurance-portal: FLOW PATH default + new Current-insurance step

Open `insurance-portal` in a fresh session and paste:

> Read `insurance-portal/CLAUDE.md` and `README.md` first. Then read these coordinator-owned files (READ-ONLY — do not edit):
> - `~/Documents/Claude/Projects/blinker-platform/architecture/26-insurance-quote-flow.md` — the full ADR. You implement D2b + D3.
> - `~/Documents/Claude/Projects/blinker-platform/STATUS.md` Wave 36 entry.
> - `~/Documents/Claude/Projects/blinker-platform/canon/insurance-carriers.json` — the carrier list + average-premium + slider bounds your new step consumes. It is synced into `insurance-portal/src/constants/canon/insurance-carriers.json` — import the SYNCED copy, not the platform path.
>
> Two changes, all insurance-portal, one commit:
>
> **D2b — `src/views/agent/LeadOriginationForm.jsx` FLOW PATH default (v3.0.14 Task 2).** Today `useForm` seeds `flowPath: dev?.flowPath || 'capture_and_quote'`. Change the seed precedence to `workflow?.flowPath ?? opportunity?.flowPath ?? dev?.flowPath ?? 'capture_and_quote'` so an Insurance Quote opp (one whose record/workflow carries `flowPath: 'quote_only'`) lands the `FlowPathPicker` on "Quote Only" by default. The picker stays fully functional — switching to "Capture + Quote" must still drive the customer step sequence + generated link type + post-send timeline exactly as today (verify this still works after your change). There is NO new opportunity type — quote-only vs capture+quote is purely the `flowPath` discriminator.
> - Investigate where an insurance opp's `flowPath` is established before `LeadOriginationForm` renders (the opp record, `buildInitial`, a creation surface). Ensure an "Insurance Quote" opp carries `flowPath: 'quote_only'`. If Phase-1 insurance opps are fixture/spawn-only with no creation picker, make `buildInitial` honor `opportunity.flowPath` and confirm the form's new seed precedence picks it up. Report exactly what you found + wired.
>
> **D3 — new agent-side "Current insurance" step (Task 3).** Add a new gate to the agent-side pre-`LeadOriginationForm` gate sequence (where VehicleAdd is "step 1" / gate 1 and VehicleDrive/mileage is "step 2" / gate 2 — see `src/views/agent/AgentView.jsx`). The new gate is **step 3**, AFTER the VehicleDrive/mileage gate and BEFORE `LeadOriginationForm` ("Confirm your contact details"), shown when the opp's flow path is `quote_only`. (Capture+quote keeps its existing two-gate sequence — out of scope.)
> - New component (e.g. `src/views/agent/CurrentInsuranceGate.jsx`). It collects:
>   - **Current carrier** — a searchable autocomplete over `canon/insurance-carriers.json` `carriers[]` (displayName rendered; `other`/`not_sure` are valid picks). Use the canonical Tooltip/dropdown patterns already in the repo; no native `<datalist>` if the repo has a nicer select.
>   - **Current premium** — a slider bounded by `premium_slider` (`min_cents` 20000 / `max_cents` 500000 / `step_cents` 1000 = $200–$5,000, $10 step). Default the value to the cadence-appropriate average derived from `average_premium.six_month_cents` (150000).
>   - **Cadence toggle** — `monthly` | `6mo` | `12mo`.
>   - **Helper text** — shows the typical/average premium for the selected cadence (monthly ≈ `six_month_cents/6`, 6mo ≈ `six_month_cents`, 12mo ≈ `six_month_cents*2`), e.g. "Typical driver pays about $250/mo".
> - On continue, write to the workflow root via `updateWorkflow`: `{ currentCarrier: <displayName>, currentCarrierId: <slug>, currentPremiumCents: <number>, premiumCadence: <'monthly'|'6mo'|'12mo'> }`.
> - Telemetry: `insurance.agent.current_insurance.viewed` on mount, `insurance.agent.current_insurance.submitted` `{ carrier_id, premium_cents, cadence }` on continue.
> - Note: mc's `buildInitial` (in `mission-control/src/components/CoPilotPane.jsx`) should seed these fields null/default — that is a mission-control change and OUT of your scope; just flag in your report that buildInitial needs the null seed so downstream reads are safe.
>
> Do NOT edit other repos. Do NOT run `npm run dev` — verify with `npm run build`.
>
> Commit: `feat(agent): wave 36 v3.0.14 insurance quote-flow — flow-path default + current-insurance step`. Co-author trailer `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`. Git identity per-repo `dealercrm` / `chad@carcarepeople.com`. **Do NOT push.**
>
> Report back (under 350 words): files created/modified; where insurance `flowPath` is established + what you wired for the Quote default; the new gate's placement in the sequence + how it reads the quote_only condition; how the carrier autocomplete + slider + cadence consume canon; workflow fields written; `npm run build` result + commit SHA; follow-up flags (especially the mc `buildInitial` null-seed dependency).

## Wave 37 — v3.0.15 Contact-details gate + timeline actor attribution (2026-05-16)

Cross-refs: `architecture/27-contact-details-gate-and-timeline-actors.md`. STATUS Wave 37 entry is the human-facing summary. Coordinator-direct Phase A landed first: ADR 27, canon `actor` field on all 16 insurance statuses (`ghl-status.json`) + `_version` bump + sync, two new shared files `packages/utils/contact-identity.js` + `packages/components/ContactDedupeCard.jsx`. Then two dispatches — disjoint repos, run in parallel.

### § 37a — insurance-portal: contact-details gate (address + dedup) + read-only-on-link

Open `insurance-portal` in a fresh session and paste:

> Read `insurance-portal/CLAUDE.md` first. Then read `~/Documents/Claude/Projects/blinker-platform/architecture/27-contact-details-gate-and-timeline-actors.md` fully — you implement D1–D5 and D9. Primary file: `src/views/agent/LeadOriginationForm.jsx`.
>
> **Address (D3) + gate (D4).** Add an `address` slice (`{ zip, city, state, street_address }`) to `useForm`, prefilled from `contact.addresses` (primary first). Render the shared `AddressBlock` (`blinker-platform/components`) with the dotted-path `fieldNames` remap `{ zip:'address.zip', city:'address.city', state:'address.state', address:'address.street_address' }`, `autoFocusZip={false}`. Verify `src/hooks/useForm.js` shallow-merges so `AddressBlock`'s nested-object patch lands; pass a custom `update` wrapper only if it doesn't. Extend `formIsValid` + `validate()` to require a 5-digit zip, non-empty city, 2-letter state, non-empty street.
>
> **Dedup (D4, D5).** Import `findContactMatch` + `buildHouseholdRelationship` from `blinker-platform/utils` and `ContactDedupeCard` from `blinker-platform/components`. Run `findContactMatch` against `blinkerApi.contacts.list()` scoped to `orgId` (`contact?.org_id`), keyed on form phone+email, gated so it doesn't pop mid-typing. Render `ContactDedupeCard`. The card does NOT hard-block link generation (informational only). Replicate `AddContactModal`'s inline DEV CONTROLS dedupe-match emulation (`real`/`no-match`/`match-same`/`match-different`).
>
> **Read-only (D9).** When `workflow?.consumer_link?.url` exists, render the form read-only — disable name/email/phone/DOB/FlowPathPicker/AddressBlock/ContactDedupeCard; add a "contact details are locked" note. Do NOT modify the shared `AddressBlock` (another repo) — swap it for a read-only text summary, or wrap with `pointer-events-none opacity-60`.
>
> Do NOT edit other repos or the `blinker-platform/packages/*` files. Verify props are destructured by receiving components. No `npm run dev`/`install`; one-shot `npm run build` OK. One commit (`feat(insurance): v3.0.15 …`), git identity `dealercrm`/`chad@carcarepeople.com`, do NOT push, do NOT commit the synced `src/constants/canon/` changes.

### § 37b — mission-control: CoPilot timeline actor attribution

Open `mission-control` in a fresh session and paste:

> Read `mission-control/CLAUDE.md` first. Then read `~/Documents/Claude/Projects/blinker-platform/architecture/27-contact-details-gate-and-timeline-actors.md` — you implement D6, D7, D8 and the D1 contact-form re-point.
>
> **Actor badge (D6/D8).** Add an Agent/Consumer/System pill per completed/current step row to `RelatedInsuranceProgress.jsx`, `RelatedProtectionProgress.jsx`, `RelatedRefiProgress.jsx`. Define the badge + label logic ONCE in a small mc-local helper (`src/lib/timeline-actor.jsx` — `resolveActorLabel` + `<ActorBadge>`). Insurance: build a `machine_id → actor` map from `src/constants/canon/ghl-status.json` `insurance.statuses[].actor` (the new canon field). Protection/refi: actor from the matching `step_change` activity's `source`, folding `system`/missing → `agent` for completed/current steps (Phase-1 default; only a real `consumer` differs). Future rows: no badge. Pill placed inline after the label, before the timestamp; slate/blue/emerald.
>
> **Write-through (D7).** In `src/components/CoPilotPane.jsx`, change the protection + refi `step_change` write-throughs from `source: 'system'` to `source: 'agent'`. Do NOT touch the insurance `status_change` write-through.
>
> **Contact-form re-point (D1).** `src/lib/contact-form.js` — import `findContactMatch`/`buildHouseholdRelationship`/`HOUSEHOLD_RELATIONSHIP_KINDS` from `blinker-platform/utils`, re-export them, delete the local definitions. Keep `validateContactForm` local. Verify `AddContactModal` still imports cleanly.
>
> High blast radius (`CoPilotPane.jsx`) — verify identifier scope before referencing. No `npm run dev`/`install`; one-shot `npm run build` OK. One commit (`feat(copilot): v3.0.15 …`), git identity `dealercrm`/`chad@carcarepeople.com`, do NOT push, do NOT commit synced `src/constants/canon/` changes.
