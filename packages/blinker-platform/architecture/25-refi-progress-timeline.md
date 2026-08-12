# 25 — Refi Progress Timeline (Wave 35)

**Date:** 2026-05-15
**Status:** Active
**Supersedes:** —
**Cross-refs:** ADR 24 (Protection Progress Timeline — the direct template for this one), ADR 21 D4 / ADR 23 (insurance left-rail timeline), ADR 08 (cross-sell orchestration)

## Context

Waves 33–34 put compact left-rail progress timelines in the mc CoPilot for **insurance** (`RelatedInsuranceProgress`) and **protection** (`RelatedProtectionProgress`). The user asked for the **refi** equivalent — the same "Workflow progress" timeline above RELATED OPPORTUNITIES, checking off each refi wizard step as the agent/customer completes it.

Wave 35 is a near-exact parallel of Wave 34 (ADR 24). The same architecture applies: refi has **display-name statuses only** (no machine_ids), refi progress is tracked by a wizard **step index** (`refiStepIdx` in `ActiveWorkflowContext`), and refi writes **no activity rows** today (`refiStepIdx` is in-memory React state only). So Wave 35 builds the component AND adds a refi step write-through, exactly mirroring ADR 24 D4.

## Decisions

### D1 — New component `RelatedRefiProgress.jsx` (mission-control-local)

A compact step timeline, structural twin of `RelatedProtectionProgress.jsx` / `RelatedInsuranceProgress.jsx`: one row per wizard step, emerald check for `past`, blue spinner for `current`, grey for `future`, timestamp on completed rows, long-form `Month Day, Year` date separators (ADR 23 D3 rules), light hover popovers (step label + one-line description + timestamp). mc-local, NOT a packages lift.

### D2 — Step list source

The canonical refi wizard step list comes from `getSequence(form, hasCoApp)` in `refi-portal/src/lib/refi.js`. Sequence:

```
vehicle_add → vehicle_drive → s1_ownership → s1_auto_loan → s1_credit
→ [middle block] → s1_identity_consent → decision_engine → stage2_result
```

The **middle block** is `s1_applicant, s1_housing, s1_employment, s1_co_app_decision, [s1_co_app_contact, s1_co_app_employment]` — with two form-dependent variations: (a) poor-credit (creditBand 300–579) moves `s1_co_app_decision` BEFORE the primary-applicant screens; (b) the two `s1_co_app_*` screens append only when `hasCoApp === true`.

- **Active opp** — call `getSequence(refiForm, hasCoApp)` with the live form so conditional ordering + co-app screens match the running wizard.
- **Related opp** — no live form. Use the standard-order, no-co-app base sequence as `CANONICAL_STEP_ORDER`; union in any co-app / reordered steps observed in the opp's `step_change` activity history, re-sorted to canonical order (same approach as `RelatedProtectionProgress` D2).

Step keys need human labels — define an mc-local `REFI_STEP_LABEL` map (refi-portal exports none; same accepted-duplication rationale as `RelatedProtectionProgress`'s `STEP_LABEL`). Suggested labels: `vehicle_add`=Add vehicle, `vehicle_drive`=Driving habits, `s1_ownership`=Ownership, `s1_auto_loan`=Auto loan, `s1_credit`=Credit, `s1_applicant`=Applicant, `s1_housing`=Housing, `s1_employment`=Employment, `s1_co_app_decision`=Co-applicant, `s1_co_app_contact`=Co-applicant contact, `s1_co_app_employment`=Co-applicant employment, `s1_identity_consent`=Identity & consent, `decision_engine`=Prequalification, `stage2_result`=Offers.

### D3 — Progress source: live index for active, activities for related

- **Active opp** — live `refiStepIdx` from `ActiveWorkflowContext`. idx `<` it → `past`; `===` → `current`; `>` → `future`.
- **Related opp** — derive `current` from `opportunity.status` via `stepFromStatus` (`refi-portal/src/lib/status-step-map.js`, fallback `vehicle_add`); read completed-step timestamps from `blinkerApi.activities.list({ contact_id, opportunity_id })` filtered to `type === 'step_change'` + `payload.workflow_type === 'refi'`; `refi_progress.furthest_step_key` as the furthest-step fallback.

Note: refi `STATUS_TO_STEP` maps ALL post-submit statuses (`Offers Returned`, `Funded`, `Declined`, the `Working - *` set, etc.) to `stage2_result`, and `Prequalification Submitted` to `decision_engine`. So a related-opp timeline for a funded/declined refi shows the full pre-submit funnel complete + `decision_engine` + `stage2_result` as the current/last step.

### D4 — Refi step write-through (mirrors ADR 24 D4 / insurance Wave 31b-fu4)

`CoPilotPane.jsx` MUST add an effect in the `RefiAgentEmbedInner` wrapper that fires when `refiStepIdx` advances forward (`i → j`, j > i) for the active refi opp:

1. **Append a `step_change` activity per newly-completed step** in span `[i, j)` via `blinkerApi.activities.create({ contact_id, opportunity_id, type: 'step_change', source: 'system', payload: { from_step, to_step, completed_step, step_idx, workflow_type: 'refi' }, summary_text: 'Refi step: <label>' })`. Step keys resolved from `getSequence(refiForm, hasCoApp)` indexed by `i`/`j`.
2. **Persist `refi_progress`** on the opp record via `updateOpportunity(opportunity.id, { refi_progress: { furthest_step_idx, furthest_step_key, updated_at } })` — additive field, mirrors `protection_progress`.
3. **Loop-safety** — `previousStepRef` guard, exactly like the protection/insurance write-throughs. Do NOT write `opportunity.status` (refi status stays the display name).

### D5 — Mount points

In `CoPilotPane.jsx`'s `OpportunityContextPane`, mirror the `RelatedProtectionProgress` mounts:

- **Active-opp mount** — when the active opp `type === 'refi'`, render `RelatedRefiProgress context="active_opp"` in its own `px-5 py-4 border-b border-slate-200` section with a `<SectionLabel>Workflow progress</SectionLabel>` header, positioned after the Vehicle section and immediately above RELATED OPPORTUNITIES (same altitude as the protection + insurance active-opp mounts). Pass `currentStepIdx={refiStepIdx}` + `refiForm` + `orgId`.
- **Related-opp mount** — inside `RelatedOppRow`, when `relatedOpp.type === 'refi'`, render `RelatedRefiProgress context="related_opp"` with `refiProgress={relatedOpp.refi_progress || null}` + `orgId` + the `onOpenInCoPilot` routing (mirror the protection related-opp mount, including the W34-fu3 `orgId` plumbing).

### D6 — Hover popovers (light)

Same as ADR 24 D6 — light popovers only (step friendly-label + one-line description + completion timestamp), canonical Tooltip pattern (`feedback_tooltip_pattern.md`, native `title=` forbidden). No rich per-step detail blocks.

## Phase 1 limitation — customer-link back-channel

Same as ADR 24 §Phase-1. Wave 35 fully delivers the agent-driven path (agent advances the refi wizard in the CoPilot embed → `refiStepIdx` changes → timeline updates live → write-through persists it). The customer-over-link path reflecting back is a Phase 2 dependency. The component renders correctly for whatever drives `refiStepIdx` / `step_change` activities.

## Fixture seeding (Wave 35-fu1)

The 19 fixture refi opps (`opp_refi_001`–`opp_refi_114`) carry no `refi_progress` / `step_change` history. A post-build fixture-seeding pass (parallel to Wave 34-fu1) seeds `step_change` rows + `refi_progress` so related-opp refi timelines show real timestamps. Done after the build lands so row shapes match the component exactly.

## Telemetry

- `mc.copilot.refi_progress.viewed` — once per mount, `{ context, opp_id }`.
- `mc.copilot.refi_progress.step_persisted` — per write-through fire, `{ opp_id, from_step, to_step }`.
- `mc.copilot.refi_progress.hover_detail_viewed` — first hover-open per step row per mount, `{ step_key, opp_id }`.

## Out of scope

- Machine_id status taxonomy for refi (refi uses display-name statuses; not changing that).
- payments CoPilot left rail.
- Rich per-step detail popovers (D6 — light only).
- Customer-link back-channel (Phase 2).
- Lifting the timeline component to `packages/` — mc-local until a 3rd consumer (insurance + protection + refi would be the 3rd, but the three are intentionally separate per-workflow components; a shared `packages/components` extraction is a separate future decision, not Wave 35).
