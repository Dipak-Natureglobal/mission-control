# 24 — Protection Progress Timeline (Wave 34)

**Date:** 2026-05-15
**Status:** Active
**Supersedes:** —
**Cross-refs:** ADR 21 D4 (insurance left-rail mini-timeline), ADR 23 (insurance CoPilot post-send layout — the timeline this one mirrors), ADR 08 (cross-sell orchestration)

## Context

Wave 33 (ADR 23) put a compact insurance lead-status timeline in the mc CoPilot left rail. The user asked for the **parallel for Protection**: a compact step-progress timeline in the CoPilot left rail, mounted **above RELATED OPPORTUNITIES**, that checks off each protection wizard step as the agent (or, Phase 2, the customer over a capture link) completes it.

Unlike insurance, protection has **no machine_id status taxonomy** (the long-standing "Canon TODO: VSC status taxonomy has no machine_id"). Protection progress is tracked by **wizard step index** (`protectionStepIdx` in `ActiveWorkflowContext`), and protection writes **no activity rows** today — `protectionStepIdx` is in-memory React state only. So Wave 34 must both build the component AND add a persistence write-through (mirroring the insurance Wave 31b-fu4 pattern) so the timeline survives opp-switch, reopen, and renders for related protection opps.

## Decisions

### D1 — New component `RelatedProtectionProgress.jsx` (mission-control-local)

A compact step timeline mirroring `RelatedInsuranceProgress.jsx`'s visual language: one row per wizard step, emerald check for completed, blue spinner for current, grey for future, timestamp on completed rows, long-form `Month Day, Year` date separators (ADR 23 D3 rules — above the first event, repeated on day change). mc-local, NOT a packages lift (consistent with `RelatedInsuranceProgress`).

### D2 — Step list source

The canonical protection wizard step list comes from `buildProtectionSteps(form)` (the dynamic factory — `protection-portal/src/views/customer/CustomerView.jsx`; mc already imports it in `CoPilotPane.jsx`). Base sequence: `vehicle_add → vehicle_drive → vehicle_use → modifications → [garage_location] → recommended_coverage → [customize] → confirm → billing_payment → [vin_validate] → [rates_changed] → docuseal → thank_you`. The four bracketed steps are conditional on form state.

- **Active opp** — use `buildProtectionSteps(protectionForm)` with the live form, so conditional steps appear exactly as the running wizard has them.
- **Related opp** — no live form. Use the base step list (conditionals omitted), unioned with any conditional steps that appear in the opp's persisted `step_change` activity history, ordered by the canonical sequence.

Step keys need human labels. Prefer an existing protection-portal label source; if none exports cleanly, define an mc-local `STEP_LABEL` map (acceptable duplication, same rationale as `RelatedInsuranceProgress`'s `CAPTURE_AND_QUOTE_PATH` literal — file-header §3).

### D3 — Progress source: live index for active, activities for related

- **Active opp** — the freshest progress pointer is the live `protectionStepIdx` from `ActiveWorkflowContext`. Steps with index `< protectionStepIdx` are `past`; `=== protectionStepIdx` is `current`; `>` is `future`.
- **Related opp** — derive `current` from `opportunity.status` via `stepFromStatus` (`protection-portal/src/lib/status-step-map.js`), and read completed-step timestamps from `blinkerApi.activities.list({ contact_id, opportunity_id })` filtered to `type === 'step_change'`. Persisted `protection_progress` on the opp record (D4) supplies the furthest-step fallback when activity history is sparse.

### D4 — Protection step write-through (mirrors insurance Wave 31b-fu4)

`CoPilotPane.jsx` MUST add an effect, in the `ProtectionEmbed` wrapper, that fires when `protectionStepIdx` advances for the active protection opp. On a forward transition `i → j` (j > i):

1. **Append a `step_change` activity** for each newly-completed step via `blinkerApi.activities.create({ contact_id, opportunity_id, type: 'step_change', source: 'system', payload: { from_step, to_step, completed_step, step_idx }, summary_text })`. Normal single-step advances complete one step; a multi-step jump (force-status, resume) completes the span.
2. **Persist `protection_progress`** on the opp record via `updateOpportunity(opportunity.id, { protection_progress: { furthest_step_idx, furthest_step_key, updated_at } })` — additive field, mirrors fu3's `summary`. Lets a reopened or related-opp timeline show the furthest point without replaying every activity.

Loop-safety + idempotency: use the same ref-guard pattern the insurance write-through uses (`previousStepRef`) so the `updateOpportunity` re-render doesn't re-fire the effect. Do NOT overwrite `opportunity.status` — protection `status` stays the VSC display name; step progress lives in `protection_progress` + activities only.

### D5 — Mount points

In `CoPilotPane.jsx`'s `OpportunityContextPane`, mirror the `RelatedInsuranceProgress` mounts:

- **Active-opp mount** — when the active opp `type === 'protection'` (or `'vsc'`), render `RelatedProtectionProgress` in its own `px-5 py-4 border-b` section with a `<SectionLabel>Workflow progress</SectionLabel>` header, positioned **after the Vehicle section and above RELATED OPPORTUNITIES** (same altitude as the insurance active-opp mount).
- **Related-opp mount** — inside `RelatedOppRow`, when `relatedOpp.type === 'protection' | 'vsc'`, render the compact timeline (no "Open in CoPilot" affordance change beyond what insurance does — clickable when the related opp is navigable).

### D6 — Hover popovers (light)

Each row gets a hover popover using the canonical Tooltip pattern (`feedback_tooltip_pattern.md` — trigger ref + `getBoundingClientRect` + `position: fixed` + opacity-transition; native `title=` forbidden). Protection has no per-step partner detail equivalent to insurance's carrier/premium/policy blocks, so the popover is **light**: step friendly-label + a one-line step description + the completion timestamp. Rich per-step detail (e.g. selected plan on `recommended_coverage`, amount on `billing_payment`) is a deliberate future enhancement, not Wave 34 scope.

## Phase 1 limitation — customer-link back-channel

The user's ask includes "if the agent sent a link to the contact, then as they navigate, the timeline updates for each step the contact completes." In Phase 1 there is **no back-channel** from a customer's self-serve browser session to the agent's mc CoPilot (protection capture links mock SMS/email; customer step changes are local to their session — see `protection-portal/src/views/agent/CaptureLinkForm.jsx`). Wave 34 delivers the timeline fully for the **agent-driven** path (the agent advancing the wizard inside the CoPilot embed updates `protectionStepIdx` → timeline updates live → write-through persists it). The customer-over-link path reflecting back is a **Phase 2 dependency** (webhook or polling, same gap insurance had pre-EI-webhooks). The component is built so it renders correctly for whatever drives `protectionStepIdx` / `step_change` activities — no rework needed when the Phase 2 back-channel lands.

## Telemetry

- `mc.copilot.protection_progress.viewed` — once per mount, `{ context: 'active_opp' | 'related_opp', opp_id }`.
- `mc.copilot.protection_progress.step_persisted` — on each write-through fire, `{ opp_id, from_step, to_step }`.
- `mc.copilot.protection_progress.hover_detail_viewed` — first hover-open per step row per mount, `{ step_key, opp_id }`.

## Out of scope

- VSC machine_id canon taxonomy — still a canon TODO, untouched.
- refi / payments CoPilot left rails.
- Rich per-step detail popovers (D6 — light only).
- Customer-link back-channel (Phase 2).
- Lifting the timeline component to `packages/` — mc-local until a 3rd consumer.
