# 27 — Insurance Contact-Details Gate + Timeline Actor Attribution (v3.0.15)

**Date:** 2026-05-16
**Status:** Active
**Supersedes:** —
**Cross-refs:** ADR 06 (Embedded Insurance Contract), ADR 23 (Insurance CoPilot post-send layout), ADR 24 (Protection progress timeline), ADR 25 (Refi progress timeline), ADR 26 (Insurance quote-flow)

## Context

v3.0.15 PDF has two tasks.

- **Task 1** — The insurance opportunity workflow can only generate an embedded-insurance (EI) link once the contact has an **email, a phone, AND a full address** (street, city, state, zip). Today `insurance-portal/src/views/agent/LeadOriginationForm.jsx` ("Confirm your contact details") collects name / email / phone / DOB but **no address at all**, and it gates "Generate insurance link" on name+email+phone+DOB only. v3.0.15 adds the address, and asks that the form reuse the **same logic + integrations the mission-control "Add contact" view uses**: per-org duplicate / household matching by phone+email, ZIP→city/state decode, and Google Places street-address autocomplete. The PDF explicitly asks for these to live in **shared components** droppable into any view.
- **Task 2** — Each CoPilot left-rail workflow timeline (insurance / protection / refi) must indicate **who performed each step — Agent, Consumer, or System**. The agent can hand a workflow to the consumer by sending a consumer-workflow link; once that happens, the CoPilot view for the handed-off step becomes a **disabled, read-only view** for the agent (the consumer now drives it), while the timeline still progresses.

## Task 1 Decisions

### D1 — Shared dedup logic graduates to `packages/utils/contact-identity.js`

The contact-match logic in `mission-control/src/lib/contact-form.js` (`findContactMatch`, `buildHouseholdRelationship`, `HOUSEHOLD_RELATIONSHIP_KINDS`) is pure and workflow-agnostic. It graduates to a new `packages/utils/contact-identity.js`, exported via `packages/utils/index.js`. The boolean validators/normalizers it depends on (`normalizePhoneE164`, etc.) already live in `packages/utils/validators.js`.

`mission-control/src/lib/contact-form.js` re-points: it imports those three names from `blinker-platform/utils` and re-exports them, so `AddContactModal`'s existing import surface is unchanged. `validateContactForm` stays mc-local — it is bound to `AddContactModal`'s specific form shape (`form.first_name`, `form.address.zip`) and does not generalize.

This is a deliberate override of the 3-strikes "replicate until the 3rd consumer" rule: the PDF explicitly asks for a shared component, and insurance is the 2nd consumer. Lifting now (not at strike 3) is the user's stated intent.

### D2 — Shared dedup card UI graduates to `packages/components/ContactDedupeCard.jsx`

`AddContactModal`'s two presentational cards — `SameNameMatchCard` ("Existing contact … edit instead of creating a duplicate") and `DifferentNameMatchCard` ("Phone already used by X" + household-relationship picker) — graduate to `packages/components/ContactDedupeCard.jsx`, exported via `packages/components/index.js`. They are pure presentational components keyed on the `findContactMatch` result shape (`{ contact, matchedOn, sameName }`).

`AddContactModal` keeps its current local copies in v3.0.15 (no forced churn — they work). Adopting the shared `ContactDedupeCard` in `AddContactModal` is a tracked follow-up; the logic (D1) is the part where drift would cause correctness bugs, and that IS de-duplicated now.

### D3 — `AddressBlock` added to the insurance LeadOriginationForm

`LeadOriginationForm` gains an address section using the existing shared `AddressBlock` (`packages/components`) — ZIP-first, city/state auto-fill via zippopotam.us, Google Places street autocomplete. Per the PDF: "we would want to confirm the address … in the existing confirm your contact details view" — i.e. **inside `LeadOriginationForm`, not a new gate**.

The form's `useForm` slice gains an `address` sub-object (`{ zip, city, state, street_address }`); `AddressBlock` is wired with the same `fieldNames` dotted-path remap `AddContactModal` uses (`address.zip`, `address.city`, `address.state`, `address.street_address`). The slice is **prefilled from the canonical contact's primary address** (`contact.addresses` — `is_primary` first, else `[0]`), parallel to how email/phone prefill works today. When the contact (or a previous opportunity) already carries a complete address, the agent simply confirms it; when fields are missing, the form prompts.

### D4 — Generate-link gate + dedup wiring

`formIsValid` (the live disabled-state predicate for "Generate insurance link") extends to also require: a 5-digit ZIP, a non-empty city, a 2-letter state, and a non-empty street address. `validate()` (the submit-time check) mirrors this with inline errors.

`LeadOriginationForm` runs `findContactMatch` (from `packages/utils`) against the session contacts, scoped to the active `orgId`, keyed on the form's phone+email — exactly as `AddContactModal` does. The match result drives the shared `ContactDedupeCard`:
- **Same-name match** → `SameNameMatchCard` (informational; does not block link generation — the agent is originating an opportunity for a known contact, which is expected).
- **Different-name match** → `DifferentNameMatchCard` with the household-relationship picker; the chosen relationship is recorded via `buildHouseholdRelationship` on link generation.

The contacts source is `blinkerApi.contacts.list()` (the domain SDK). When embedded in the mc CoPilot, `orgId` and the contact come from the CoPilot context; standalone insurance-portal falls back to its fixtures. Mirror `AddContactModal`'s **DEV CONTROLS · dedupe match emulation** block (modes: `real` / `no-match` / `match-same` / `match-different`) so the prototype can preview every branch — the dev knob injects only the predicate, leaving the real code path intact.

### D5 — Dedup card does not hard-block link generation

Unlike `AddContactModal` (where a different-name match blocks save until a relationship is picked), `LeadOriginationForm` should **not** hard-block link generation on the dedup card — the agent is originating an opportunity on a contact that legitimately already exists. The card is a surfaced warning + an optional household-link affordance. The hard gate (D4) is email + phone + address completeness only.

## Task 2 Decisions

### D6 — Canon `actor` field on insurance statuses

`canon/ghl-status.json` insurance statuses gain an explicit **`actor`** field — distinct from the existing `signal_source` (which system *reported* the transition) and `role` (persona visibility). `actor` answers "who, in Agent/Consumer/System terms, caused this step", which is what the timeline badge needs. The insurance EI flow is deterministic, so a static per-status mapping is correct:

| machine_id | actor | rationale |
|---|---|---|
| `started` | `agent` | agent clicks Generate in the CoPilot |
| `lead.created` | `system` | backend cascade from the generate action |
| `capture_link.created` / `quote_link.created` | `system` | backend link mint |
| `capture_link.sent` / `quote_link.sent` | `agent` | agent clicks Send link |
| `capture_link.viewed` / `quote_link.viewed` | `consumer` | consumer opens the link |
| `capture.completed` | `consumer` | consumer uploads policy on the EI microsite |
| `working` | `agent` | agent working the lead |
| `quote.completed` | `system` | EI computes the quote |
| `quote.viewed` | `consumer` | consumer views the quote |
| `policy.bound` | `consumer` | consumer binds the policy |
| `error.verification` / `error.quote` / `duplicate` | `system` | partner/system error states |

`canon/_version` is bumped and synced into all child apps.

### D7 — Protection / refi actor comes from the `step_change` activity `source`

Protection and refi have no machine_id status taxonomy — progress is wizard-step-driven, tracked by `step_change` activity rows written by the `CoPilotPane.jsx` write-through effects (ADR 24 D4 / ADR 25 D4). Those effects today hard-code `source: 'system'` on the activity. v3.0.15 changes them to stamp the **real actor**: `source: 'agent'` for an agent-driven wizard advance inside the CoPilot embed (the Phase-1 reality — the agent drives the whole wizard). When the Phase-2 customer-link back-channel lands, consumer-driven advances will stamp `source: 'consumer'`; genuine automated transitions stamp `source: 'system'`.

The timeline reads `activity.source` per step. For steps with no activity row (sparse fixtures, related opps), the timeline defaults the actor of a completed protection/refi step to `agent` (Phase-1 agent-driven default) and shows no badge for future steps.

### D8 — Actor badge on all three timelines

`RelatedInsuranceProgress.jsx`, `RelatedProtectionProgress.jsx`, `RelatedRefiProgress.jsx` each render a compact actor chip on every completed/current step row — `Agent` / `Consumer` / `System`. Styling: a small uppercase tracking-wide pill, muted (slate for System, blue for Agent, emerald for Consumer), placed inline after the step label, before the timestamp. Future (grey) rows render no actor chip. The chip is part of the row, not the hover popover (it must be glanceable). Insurance reads the actor from canon `actor` (D6); protection/refi from `activity.source` (D7).

### D9 — Read-only view once the consumer link is sent

When the agent has sent the consumer a link, the CoPilot step that was handed off renders **disabled / read-only** for the agent. In v3.0.15 this is delivered for **insurance**, where the handoff signal already exists:

`LeadOriginationForm` becomes fully read-only once a consumer link exists (`workflow.consumer_link?.url` present — i.e. the EI lead has been created and the link minted). At that point the contact details are locked into the EI lead and editing them client-side does nothing; all inputs (`AddressBlock` included), the FlowPathPicker, and the dedup card's relationship picker render disabled. The "Generate insurance link" button is already gated off when a link exists; the link display + "Send link" controls remain interactive. A small "Link generated — contact details are locked" note explains the read-only state.

### Phase 1 limitation — protection / refi per-step handoff

The PDF describes the agent sending a consumer link "at various steps" of any workflow. Protection and refi have **no per-step consumer-link mechanism** today, and the consumer portal (the destination of such links) is not built (it is the last, deferred item of the Phase-1 build order). A general per-step handoff therefore depends on: (a) the consumer portal, (b) a per-step link-send surface, and (c) the Phase-2 back-channel that reflects consumer progress back to the agent's CoPilot (the same gap ADR 24 §Phase-1 and ADR 25 §Phase-1 already record). v3.0.15 ships D9 for insurance only; protection/refi per-step handoff is explicitly Phase 2. The actor-badge work (D7/D8) lands for all three workflows now and is forward-compatible — when consumer-driven `step_change` rows arrive, their `source: 'consumer'` renders a Consumer badge with no component change.

## Telemetry

- `insurance.lead_origination.address_confirmed` — fires when the agent confirms/completes the address block, `{ prefilled: bool }`.
- `insurance.lead_origination.dedup_match_shown` — fires when a dedup card surfaces, `{ matched_on, same_name }`.
- `mc.copilot.timeline.actor_badge_viewed` — diagnostic, once per timeline mount, `{ workflow, actor_counts }`.

## Out of scope

- Refactoring `AddContactModal` to consume the shared `ContactDedupeCard` (tracked follow-up — D2).
- Protection / refi per-step consumer-link handoff + read-only views (Phase 2 — depends on the consumer portal + back-channel).
- A machine_id status taxonomy for protection / refi (still a standing canon TODO).
- The Google Places API key moving to a secrets pipeline (still hardcoded in `AddressBlock`).
- Lifting the timeline components to `packages/` — they stay mc-local per ADR 24/25.
