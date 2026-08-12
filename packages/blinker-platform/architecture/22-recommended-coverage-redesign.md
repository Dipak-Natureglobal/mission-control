# 22 — RecommendedCoverage Redesign (v3.0.12)

**Date:** 2026-05-14
**Status:** Active
**Supersedes:** —
**Cross-refs:** ADR 08 (Cross-Sell Orchestration), ADR 18 (Plan Catalog), ADR 21 (Insurance → Protection Cross-Sell — `status: 'no_savings'` discriminator landed in Wave 31b)

## Context

The current `RecommendedCoverage` step in protection-portal (`protection-portal/src/views/customer/RecommendedCoverage.jsx`) renders three stacked plan cards (Good / Better / Best), each carrying its full subtitle, term/miles/deductible, total price + add-ons + monthly + insurance-savings line, and a "See what's covered" anchor. The information density is high — the customer sees the full plan price (e.g. `$3,800 + $250 add-ons → ~$317/mo → ~$267/mo`) plus the marketing copy plus a covered-components hint, all on a long-scroll page. v3.0.12 PDF Task 1 asks to **compress** this into a refi-style **segmented tier-picker** (3 horizontal buttons showing only monthly price) with a **single details card** below for the currently selected tier.

The reference implementation already exists in `refi-portal/src/refinance-v2-prototype.jsx` (around lines 4008-4095) — the prototype's ProtectionPlanTeaser surfaces this exact layout. The redesign lifts the pattern into protection-portal as the canonical RecommendedCoverage UI.

## Decisions

### D1 — UI structure

Single-screen layout:

```
┌─ Header ────────────────────────────────────────────────┐
│ Here is your personal quote based on your vehicle...    │
├─ (optional) Insurance buying-power info box ───────────┤
│ ◯ Insurance savings = buying power                      │
│   The $25/mo in insurance savings can help offset...    │
├─ Tier picker (3-up segmented) ─────────────────────────┤
│ ┌──BEST──┐ ┌─BETTER─┐ ┌──GOOD──┐                       │
│ │$297    │ │ $197   │ │ $97    │                       │
│ │/$322   │ │ /$222  │ │ /$122  │  ← strikethrough only │
│ │per mo  │ │per mo  │ │per mo  │     if savings exist  │
│ └────────┘ └────────┘ └────────┘                       │
│ *Adjusted by $25 per month in Auto Insurance Savings   │
├─ Selected plan details ────────────────────────────────┤
│ {planTitle} ({tier})                                    │
│ {term} months or {miles} miles                          │
│                                                         │
│ Features:  [Enhanced Electronics +$250] [Maintenance]  │
│ Add-ons:   [Business Use] (if applicable)              │
│                                                         │
│ {planLevelHeading or planSpecificHeading}              │
│ ✓ Engine        ✓ Transmission                         │
│ ✓ A/C           ✓ Fuel System                          │
│ ✓ Electrical    ✓ High-tech Options                    │
│ (etc — 2-column grid from canon coveredComponents)     │
└─────────────────────────────────────────────────────────┘
```

**Tier order:** Best, Better, Good (left to right) — matches the refi precedent and emphasizes the upsell.

**Default selected:** the existing `plan_level_defaults[level].default_selected: true` value continues to be honored (currently "best"). The agent's last selection persists on `form.selectedPlanId` (unchanged).

### D2 — Total price hidden at this stage

The redesigned tier-picker shows **only the monthly price** ($297/mo etc.). The total price ($3,800), add-ons total ($250), and total monthly breakdown disappear from this view. They reappear at the next step (Customize / Confirm / Billing) where the agent / consumer is actively configuring and committing.

This is a **deliberate UX simplification** — the v3.0.12 PDF explicitly asks for it. Implementation: the redesigned `RecommendedCoverage` does not render the total/add-ons summary block. The PlanCard component currently renders all of these; the redesign replaces PlanCard's role entirely with a smaller TierPickerButton + a SelectedPlanDetails block. Keep PlanCard exported (in case other consumers exist — e.g. the Wave 31b cross-show in mc) but it is no longer the primary surface inside RecommendedCoverage.

### D3 — Pills and features above coverage content

The "New rate" pill (when present) renders **next to the plan title** in the SelectedPlanDetails card.

Features + add-ons pills (`Enhanced Electronics +$250`, `Maintenance Feature included`, `Business Use`, etc.) render **above** the coverage components list — clearly separated as their own row of chips, not embedded inline with the components.

### D4 — Coverage content sourced from canon

The covered-components list comes from canon, resolved via the existing `packages/utils/plan-presentation.js::resolvePlanPresentation()` resolver — extended in Phase A of this wave to return `coveredComponents` (a string array) alongside the existing `coverageHtml`.

Resolution order (mirrors `coverageHtml`):
1. `orgs[].plan_overrides[planKey].covered_components` (per-org per-plan override — Phase 1 placeholder; admin tool wires this in Phase 2)
2. `plan_catalog[planKey].covered_components` (global per-plan override — currently null for all 14 seeded OMGA entries)
3. `plan_level_defaults[level].covered_components_default` (tier default — seeded in Phase A of this wave)
4. `[]` (empty array)

The level-default arrays seeded in Phase A:

| Tier   | Components                                                                                                |
|--------|-----------------------------------------------------------------------------------------------------------|
| good   | Engine, Transmission, A/C                                                                                 |
| better | Engine, Transmission, A/C, Fuel system, Electrical, High-tech options                                     |
| best   | Engine, Transmission, A/C, Fuel system, Electrical, High-tech options, Seals & Gaskets, Cooling system, Transfer case, Drive axle |

These match the existing `plan_coverage_default_html` content for each tier (the HTML stays unchanged; the structured array is its projection without the "And more!" tail row).

The existing "See what's covered" modal continues to consume `coverageHtml` — no change to that surface.

### D5 — Insurance savings integration

When `form.insuranceSavings.monthlySavingsCents > 0` (savings found):

- **Buying-power info box** renders above the tier picker:
  > Insurance savings = buying power
  > The $25/mo in insurance savings can help offset the cost of a protection plan.
- **Per-tier price** shows `$ADJUSTED/$ORIGINAL` where adjusted = `Math.max(0, monthlyPrice - monthlySavingsCents/100)` and `$ORIGINAL` is rendered strikethrough.
- **Adjustment note** renders below the picker: `*Adjusted by $25 per month in Auto Insurance Savings`
- v3.0.12 PDF copy refinement: when current insurance carrier is known, the buying-power info box copy reads `"... in insurance savings when compared to {currentInsuranceCarrierName}, which can help offset the cost of a protection plan."` — read carrier from `form.insuranceSavings.captureCarrier`.

When `form.insuranceSavings.status === 'no_savings'` (Wave 31b D6):

- Info box does NOT render.
- Per-tier price shows only the original monthly (no strikethrough, no adjustment).
- The existing boost-slot Result Chip continues to say "We will continue to monitor savings" (per Wave 31b — unchanged in this wave).

When `form.insuranceSavings == null` (cross-sell not run yet): same as no_savings — original monthly only, no info box, no strikethrough.

### D6 — Preserve Wave 31b no-savings discriminator

Wave 31b just landed (commit `8bc5223` in protection-portal) and added handling for `insuranceSavings.status === 'no_savings'`:
- `CrossSellCtas` boost-slot Result Chip flips to "We will continue to monitor savings".
- `PlanCard` monthly column suppresses the `-$/mo (insurance vs {carrier})` line when `status === 'no_savings'`.
- `Find insurance savings` CTA marks DONE.

The redesigned RecommendedCoverage in Wave 32 **must preserve all three behaviors** as it replaces the PlanCard-centric layout with the segmented tier picker. The Result Chip + CTA-DONE behaviors live in the `CrossSellCtas` component (kept intact — it sits above the tier picker). The PlanCard `-$/mo` suppression effectively disappears because the new TierPickerButton doesn't render an inline insurance-line (savings show as strikethrough on the adjusted price instead, conditionally per D5). Net: the Wave 31b contract is honored; the surface is just different.

Regression test: launching the cross-sell to insurance from protection's own CrossSellSubFlow, receiving either savings-found OR no-savings outcome, must continue to render correctly. The dispatch brief covers this explicitly.

### D7 — Cross-show in mc insurance CoPilot (D5 from ADR 21)

Wave 31b mounts protection's `RecommendedCoverage` inline in the mc insurance CoPilot when both opps coexist ≤ step 5. The cross-show consumes the EXACT same component — so the redesign automatically applies there too. Verify the cross-show still renders correctly after the redesign (no separate code path required).

Memory note: mc's "live insurance savings drive the boost slot" coupling (Wave 31b D5) continues to work because the new TierPickerButton reads from the same `form.insuranceSavings` slot — the redesign doesn't change WHICH state powers the display, only HOW it's rendered.

## Canon impact

- `canon/plan-mappings.json::plan_level_defaults[level].covered_components_default` — new field, seeded for good/better/best. Schema-additive; existing consumers continue to read `plan_coverage_default_html` unchanged.
- `canon/plan-mappings.json::plan_catalog[planKey].covered_components` — new optional override, defaulting to `null` for all 14 OMGA entries (defers to tier default). Admin tool can populate per-plan overrides later.
- `_comment` strings on both blocks updated to document the new field.
- `_version` → `2026-05-14-v3012-recommended-coverage-redesign` (replacing `2026-05-14-v3011-insurance-protection-cross-sell` from Wave 31 Phase A).

## Resolver impact

`packages/utils/plan-presentation.js::resolvePlanPresentation()` extended to return `coveredComponents` (string array, empty-array fallback) + `source.coveredComponents` (one of `'org_override' | 'catalog' | 'level_default' | 'empty'`). Existing return fields unchanged.

## Telemetry

Existing `plan_selected` event continues to fire on tier-button click; payload unchanged (`{ tier, plan_code, term_months, miles }`). New event:

- `protection.customer.recommended_coverage.tier_toggled` `{ from_tier, to_tier, has_insurance_savings, monthly_savings_cents }`

## Out-of-scope (Wave 31 follow-ups noted by 31b agent)

These are not part of this wave but should be tracked:

1. **CrossSellSubFlow doesn't fire `onComplete` for savings=0** (`CrossSellSubFlow.jsx:617` gates on `savings > 0`). The Wave 31b D6 `status: 'no_savings'` discriminator is currently producer-wired only from mc's insurance CoPilot path; protection's own cross-sell still falls back to "agent hits Skip insurance" on a zero-savings quote. → Wave 31-fu: extend CrossSellSubFlow to write `{ monthlySavingsCents: 0, status: 'no_savings', captureCarrier, ... }` on `savings === 0`.

2. **ADR 21 D3 "Currently paying $X/mo" copy is unrealizable from EI verification data.** `summary.insuranceVerification.policyInfo` does NOT include the customer's current premium. The 31b mc-side InsuranceSavingsCard currently shows carrier-only in the capture-only phase. → Either update ADR 21 to reflect this constraint, or thread the consumer-supplied premium through the workflow before the EI handoff.

3. **D5 cross-shown RecommendedCoverage is read-mostly** in mc — plan selection isn't persisted to the related protection opp's own session. Agent must switch CoPilot to commit. → Acceptable for v3.0.12 ship; revisit if user complains.

## Phasing

**Phase A (coordinator-direct in blinker-platform):** this ADR + canon extension + resolver extension + STATUS.md Wave 32 entry + PROMPTS § 32 + canon `_version` bump + sync canon to child apps.

**Phase B (protection-portal dispatch, blocked on Wave 31b — now unblocked since 31b landed):** redesign `RecommendedCoverage.jsx` to the tier-picker + single details card layout. Single commit in protection-portal.
