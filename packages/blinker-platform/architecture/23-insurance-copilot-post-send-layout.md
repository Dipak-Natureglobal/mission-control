# 23 — Insurance CoPilot Post-Send Layout (v3.0.13)

**Date:** 2026-05-15
**Status:** Active
**Supersedes:** —
**Cross-refs:** ADR 06 (Embedded Insurance Contract), ADR 08 (Cross-Sell Orchestration), ADR 21 (Insurance → Protection Cross-Sell — InsuranceSavingsCard + Find Coverage CTA landed in Wave 31b)

## Context

When an agent uses the Mission Control insurance CoPilot to originate an insurance opportunity, the post-send-link state today renders insurance-portal's `LeadStatusTimeline` (full per-event detail) as the primary right-pane content. The result: the agent stares at a verbose lead-status timeline waiting for the consumer to act on the EI microsite, while the **InsuranceSavingsCard** ("Insurance at a glance") — the one surface that actually changes as the consumer moves through capture → quote → bind, AND the surface that hosts the **Find Coverage** CTA (Wave 31b D3) for spawning a protection cross-sell — is squeezed at the top.

v3.0.13 PDF Task 1 asks to **swap focus**: move the lead-status timeline to the LEFT rail as a compact, hover-revealing list; let the InsuranceSavingsCard occupy the right pane as the agent's primary attention surface.

The compact left-rail timeline already exists as `mission-control/src/components/RelatedInsuranceProgress.jsx` (Wave 31b D4 / ADR 21 D4) — but it currently mounts only under **related** insurance opps in the parent ctx-pane, not under the active-insurance-opp ctx-pane itself. Its file header explicitly defers per-event detail blocks and day separators ("minus: per-node detail blocks (CaptureDetail / QuoteDetail / etc.), day separators"). Wave 33 generalizes this component AND closes both deferred items.

## Decisions

### D1 — Right-pane focus shifts to InsuranceSavingsCard

When the active opp is an insurance opp AND the workflow has progressed past the LeadOriginationForm send action (any state ≥ `capture_link.sent` for capture-and-quote, or ≥ `quote_link.sent` for quote-only), the mc CoPilot right pane MUST suppress insurance-portal's `LeadStatusTimeline` and present `InsuranceSavingsCard` ("Insurance at a glance") as the primary surface.

**Exact post-send right-pane composition (per v3.0.13 mockup, PDF page 2):**

```
┌─ AgentForceStatusBar ─────────────────────────────── (full width) ─┐
├──────────────────────────────────┬─────────────────────────────────┤
│ InsuranceSavingsCard              │ NotesPanel + TagPicker          │
│  ("Insurance at a glance")        │  ("AGENT NOTES")                │
│ ConsumerLinkPanel                 │                                 │
│  ("CONSUMER LINK")                │                                 │
└──────────────────────────────────┴─────────────────────────────────┘
```

The SavingsCard sits **inside the left column, above ConsumerLinkPanel** — NOT as a full-width band above the ForceStatusBar. Because the ForceStatusBar + 2-col grid are owned by insurance-portal's AgentView while `InsuranceSavingsCard` is an mc component, the card is threaded into the grid via the `savingsCardSlot` render-prop (see D5).

**Rationale:** the SavingsCard is the only right-pane surface whose copy + savings figures + Find Coverage CTA changes meaningfully as the consumer moves through EI. The full LeadStatusTimeline is a pre-Wave-31 surface that pre-dates the SavingsCard and is now redundant with the new compact left-rail timeline (D2).

**Pre-send phase (state < `capture_link.sent`):** the right pane MUST continue to render the LeadOriginationForm — D1 only applies once the form has been sent. The InsuranceSavingsCard already handles `phase: 'pre_send'` copy and is harmless to render in this state, but the timeline-suppression branch is post-send-only.

### D2 — Left rail surfaces a compact timeline for the active insurance opp

`RelatedInsuranceProgress` (or a generalized successor) MUST render under the active-opp ctx-pane in `mc/src/lib/CoPilotPane.jsx` when the active opp `type === 'insurance'`. The block sits in the same ctx-pane region the existing pattern occupies for *related* insurance opps, immediately below the VEHICLE summary and above (or merged into) the `RELATED OPPORTUNITIES` section. The 9-row main-path display (Started → Policy Written) is unchanged from Wave 31b. The `Open insurance CoPilot →` button MUST be omitted when the timeline is rendering for the active opp itself (the agent is already on it).

**Naming:** the existing component name `RelatedInsuranceProgress` is workable post-generalization but slightly misleading. The implementation agent MAY rename it to `InsuranceProgressTimeline` (or similar) and re-export the original name as an alias to avoid mc churn. Either path is acceptable — leave the call.

### D3 — Date separators

Above the FIRST event row of the timeline, the component MUST render a **long-form date separator** in the form `Month Day, Year` (e.g. `May 14, 2026`). When two adjacent events fall on different local-days (per the org timezone resolved by `timezoneForOrg(orgId)`, the same helper insurance-portal's `LeadStatusTimeline` already uses), an additional separator MUST appear between them.

The separator styling: small uppercase tracking-wide pill, slate-500 text, indent-aligned with the row content (not the gutter check icon). The first separator renders even when only one event exists.

### D4 — Per-event hover detail (canonical Tooltip pattern)

Each timeline row MUST be wrapped in a hover-revealing popover that surfaces the same per-stage detail blocks insurance-portal's `LeadStatusTimeline` renders inline today:

| Stage machineId | Detail block fields surfaced in popover |
|---|---|
| `capture.completed` | `policyInfo.carrier` + `policyInfo.policyNumber`, `vehicles[0]` YMMT, `media.idCardUrl` (View ID card link), `verificationMethod` (Verified via ID card pill), `verifiedAt` long-form |
| `quote.completed` | `quote.carrier`, premium `$X / 6mo` (cents → dollars), savings `$Y / 6mo (≈ $Z / yr)` when present, `quote.createdAt` |
| `quote.viewed` | `quote.viewedAt` |
| `policy.bound` | `policy.carrier`, `policy.id` (with the existing `policy_number pending — EI does not surface today` caveat) |
| All other rows (started, lead.created, capture_link.created/sent/viewed, quote_link.*) | popover may be omitted OR show only the timestamp; no additional detail lives on the workflow snapshot for these stages |

The popover MUST use the canonical Tooltip pattern (per `feedback_tooltip_pattern.md`): trigger `useRef` + `getBoundingClientRect()` + `position: fixed` + opacity-transition. Native `title=` is forbidden. The pattern reference implementation is `protection-portal/src/components/PlanCard.jsx::MonthlyTooltip`.

**Source-of-detail:** the popover content needs both the activity timestamps (already plumbed via `blinkerApi.activities.list({ contact_id, opportunity_id })`) AND the workflow detail (carrier/premium/policy ref).

The workflow detail has **two sources depending on context** (refined post-Wave-33 by the 33-fu3 fix):

- **Active opp** — the live `insuranceWorkflow` context object is in scope; thread it as a `workflowSnapshot` prop. Freshest.
- **Related opp** — there is NO live workflow for a non-active opp (mc keeps only ONE live `insuranceWorkflow`, for the active CoPilot; it is nulled on opp-switch). The detail must come from a **persisted** source. The opportunity record carries an additive `summary: { capture, quote, policy }` block, written by the Wave 31b-fu4 status write-through effect in `CoPilotPane.jsx` — each time the insurance workflow advances, the effect snapshots `insuranceWorkflow.{capture,quote,policy}` onto the opp record via `updateOpportunity`. By `policy.bound` the opp record carries the full detail. The `summary` sub-objects mirror the live workflow's `capture/quote/policy` shape exactly, so the popover detail blocks read identical paths from either source.

The popover detail source resolves as `workflowSnapshot ?? opportunity.summary` (per-field, or whole-object — both have `.capture/.quote/.policy`). `buildInitial()` (the insurance workflow re-seed) also restores `capture/quote/policy` from `opportunity.summary` so a re-entered active opp shows full detail without re-running the simulator.

**Phase 1 limitation:** fixture insurance opps seeded directly at advanced statuses without a `summary` block will still show label+timestamp-only popovers. Seeding `summary` into such fixtures is an optional follow-up; the live cross-sell demo path is covered by the runtime write-through.

**No cross-repo lift:** per the 3-strikes rule, replicate the 4 detail blocks (`CaptureDetail`, `QuoteDetail`, `QuoteViewedDetail`, `PolicyDetail`) into the mc-local component as inline functions. They have only 2 consumers (insurance-portal AgentView + mc compact). When/if a 3rd consumer arrives, lift to `packages/components/insurance-progress/` then. This is consistent with `RelatedInsuranceProgress`'s existing duplication of `CAPTURE_AND_QUOTE_PATH` (file header §3 — intentional cross-app duplication).

### D5 — insurance-portal AgentView gets `hideLeadStatusTimeline` + `savingsCardSlot` props

To support D1's right-pane redirection without breaking insurance-portal's standalone use, AgentView MUST accept:

- **`hideLeadStatusTimeline`** (default `false`) — when `true`, the post-send composition suppresses `LeadStatusTimeline` and renders the 2-col grid: ForceStatusBar full-width above, ConsumerLinkPanel in the left column, NotesPanel + TagPicker in the right column.
- **`savingsCardSlot`** (default `null`) — an optional React node. When provided AND `hideLeadStatusTimeline` is `true`, AgentView renders it at the **top of the left column, above ConsumerLinkPanel**. This is the slot mc uses to inject its `InsuranceSavingsCard` into a grid AgentView owns. Standalone insurance-portal passes nothing → `null` → no card, layout unaffected.

mc's `<InsuranceAgentView />` embed passes `hideLeadStatusTimeline={true}` + `savingsCardSlot={<InsuranceSavingsCard … />}` whenever D1 conditions hold (active opp insurance + post-send). mc MUST stop rendering `InsuranceSavingsCard` as a separate full-width band at the top of the right pane — the card is now placed by AgentView via the slot. (Pre-send, the SavingsCard self-returns `null`, so no special-casing is needed for the pre-send path.)

Per `feedback_parallel_dev_panels.md` — both standalone-shell + embed-fragment surfaces must be updated together when the contract changes. **Dispatch ordering:** the insurance-portal `savingsCardSlot` consumer should land before (or with) the mc producer — if mc lands first, AgentView ignores the unknown prop and the card vanishes; if insurance-portal lands first, the slot is `null` and mc still renders the card at top → no regression.

## Telemetry

- `mc.copilot.insurance_progress.viewed` — already fires from RelatedInsuranceProgress (Wave 31b). Extend to fire for active-opp mounts too, with `{ context: 'active_opp' | 'related_opp' }`.
- `mc.copilot.insurance_progress.hover_detail_viewed { stage }` — new. Fires on first hover-open per stage row per mount; stage = machineId.
- `mc.copilot.lead_status_timeline_suppressed { reason: 'left_rail_active' }` — fires once per CoPilot session when D1's suppression activates. Diagnostic; lets us measure adoption vs. the legacy right-pane timeline.

## Out of scope

- VSC / refi / payments CoPilot left rails. They have their own progress patterns and are not touched.
- Phase 2 backend persistence of activities — Phase 1 reads remain session-keyed.
- `policy_number pending` caveat resolution — the popover surfaces the existing caveat text; no contract change with EI.
- Lifting timeline detail blocks to `packages/components/`. Deferred per the 3-strikes rule (D4).
