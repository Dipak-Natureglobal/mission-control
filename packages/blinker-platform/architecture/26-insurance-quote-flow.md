# 26 — Insurance Quote-Flow Refinements (v3.0.14)

**Date:** 2026-05-15
**Status:** Active
**Supersedes:** —
**Cross-refs:** ADR 06 (Embedded Insurance Contract), ADR 21 (Insurance → Protection Cross-Sell), ADR 23 (Insurance CoPilot post-send layout)

## Context

The insurance workflow has two flow paths: `capture_and_quote` (EI captures the customer's current policy via ID-card/data, then quotes) and `quote_only` (skip the capture, just quote). The platform's UI was built capture-first — several surfaces hardcode "Capture" language and capture-flow assumptions even when the active opp is `quote_only`. v3.0.14 PDF has three tasks to make the **quote-only** path first-class:

- **T1** — the mc `InsuranceSavingsCard` ("Insurance at a glance") shows "Capture link sent. The hero updates once the customer shares their current carrier" in its `sent` phase — wrong for quote-only. And its Find Coverage CTA is disabled in the `sent` phase; for quote-only the agent should be able to spawn a protection opp while the customer waits for the quote.
- **T2** — the mc left-rail timeline header reads "CAPTURE+QUOTE PROGRESS" regardless of flow path; quote-only must read "QUOTE PROGRESS". The LeadOriginationForm FLOW PATH selector should default to "Quote Only" for an Insurance Quote opportunity (the agent can still switch to Capture + Quote, which switches the whole workflow).
- **T3** — add a new agent-side step (step 3) after the mileage gate and before "Confirm your contact details": collect the customer's **current insurance carrier** (autocomplete) + **current premium** (slider + monthly/6mo/12mo cadence toggle). This self-reported premium drives estimated-savings math — which quote-only otherwise lacks (EI does not return a savings comparison on the quote-only path).

## Decisions

### D1 — InsuranceSavingsCard becomes flow-path-aware (T1)

`mission-control/src/components/InsuranceSavingsCard.jsx` must read the flow path from `workflow.flowPath` (the workflow snapshot already carries it — `buildInitial` seeds it) and vary two things:

1. **`sent`-phase body copy** (today ~lines 190-202, the literal "Capture link sent. The hero updates once the customer shares their current carrier"):
   - `flowPath === 'quote_only'` → quote language, e.g. **"Quote link sent. The hero updates once the customer's quote is returned."** No "Capture", no "shares their current carrier".
   - `flowPath === 'capture_and_quote'` → unchanged capture copy.
2. **Find Coverage CTA gate** (today `ctaDisabled = phase === 'sent'`, ~line 173):
   - `flowPath === 'quote_only'` → the CTA is **enabled** in the `sent` phase (the agent can spawn protection while the quote is pending — there is no carrier-capture to wait for).
   - `flowPath === 'capture_and_quote'` → unchanged (disabled in `sent`; the capture event is what unlocks meaningful savings context).

Only the `sent` phase needs flow-path branching — quote-only never enters the `capture_only` phase (no capture event fires), so that phase's "Current carrier captured" copy is naturally unreachable on the quote-only path. Audit the other phases for stray "capture" wording while in the file, but expect no other changes.

### D2 — Timeline header + FLOW PATH default follow `flowPath` (T2)

**T2a — mc timeline header.** `RelatedInsuranceProgress.jsx` already receives `flowPath` (`opportunity?.flowPath || 'capture_and_quote'`) and switches `pickMainPath`. The hardcoded section header literal "Capture+quote progress" must become conditional on the same `flowPath`: `quote_only` → **"Quote progress"**, `capture_and_quote` → "Capture + quote progress".

**T2b — insurance-portal FLOW PATH default.** `LeadOriginationForm.jsx`'s `useForm` seeds `flowPath: dev?.flowPath || 'capture_and_quote'`. It must instead seed from the opportunity/workflow first: `workflow?.flowPath ?? opportunity?.flowPath ?? dev?.flowPath ?? 'capture_and_quote'`. So an Insurance Quote opportunity (one created/seeded with `flowPath: 'quote_only'`) lands the FlowPathPicker on "Quote Only" by default. The picker stays fully functional — switching to "Capture + Quote" still drives the customer step sequence, the generated link type (`linkCreatedStatus`), and the post-send timeline path, exactly as it does today. **No new opportunity type** — quote-only vs capture+quote remains a `flowPath` discriminator on the one `insurance` type.

The 36b dispatch must determine where an insurance opp's `flowPath` is established before the LeadOriginationForm renders (opp record field, `buildInitial`, a creation surface) and ensure an "Insurance Quote" opp carries `flowPath: 'quote_only'`. If Phase-1 insurance opps are fixture/spawn-only with no creation picker, ensure `buildInitial` + the fixture insurance "quote" opps carry `flowPath` and the form honors it; surface any gap in the report.

### D3 — New agent-side "Current insurance" step 3 (T3)

A new agent-side gate, inserted in `insurance-portal/src/views/agent/AgentView.jsx`'s pre-LeadOriginationForm gate sequence, **after the VehicleDrive (mileage) gate and before the LeadOriginationForm ("Confirm your contact details")**, shown when the opp's flow path is `quote_only`. (Capture+quote keeps its existing two-gate sequence; the EI capture step already surfaces the current carrier there. Capture+quote adopting this step is a deliberate future option, not v3.0.14 scope.)

The gate (new component, e.g. `CurrentInsuranceGate.jsx`) collects:
- **Current carrier** — autocomplete/searchable select sourced from `canon/insurance-carriers.json` `carriers[]`. `other` is the catch-all.
- **Current premium** — a slider whose min/max come from `canon/insurance-carriers.json` `premium_slider.by_cadence[cadence]` ($10 step): monthly $50–$1,500; 6mo $300–$5,000; 12mo $600–$5,000. The slider re-bounds when the cadence toggle changes (clamp the current value into the new range); the value defaults to the cadence-appropriate average.
- **Cadence toggle** — `monthly` | `6mo` | `12mo`. Lets the agent ask "how much do you pay monthly / every 6 months / per year?".
- **Helper text** — shows the typical/average premium for the selected cadence, derived from `canon/insurance-carriers.json` `average_premium.six_month_cents` (150000 → ~$250/mo, ~$1,500/6mo, ~$3,000/yr).

On continue, the gate writes to the workflow root via `updateWorkflow`: `{ currentCarrier, currentCarrierId, currentPremiumCents, premiumCadence }`. `buildInitial` (in mc `CoPilotPane.jsx`) seeds these as `null` / default cadence so downstream reads are safe. `currentPremiumCents` stores the raw entered amount; `premiumCadence` tells consumers how to normalize it.

### D4 — Savings calculation consumes the self-reported premium (T3 cont.)

`mission-control/src/lib/insurance-savings-adapter.js::mapInsuranceWorkflowToSavings(workflow)` today derives savings purely from EI's `quote.payload.savingsAmountCents` — which is absent on the quote-only path. It must:

1. Normalize the self-reported premium to a 6-month basis: `monthly → ×6`, `6mo → ×1`, `12mo → ÷2`.
2. When `workflow.currentPremiumCents` is present AND a quote exists: `savings6moCents = normalizedCurrent6mo − quote.payload.totalPremiumCents`; `monthlySavingsCents = savings6moCents / 6`. If `savings6moCents <= 0`, resolve to the `no_savings` discriminator (ADR 21 D6) — the quote did not beat what they pay today.
3. When `currentPremiumCents` is absent, fall back to the existing EI `savingsAmountCents` path (unchanged for capture+quote).

This makes the quote-only path produce a real savings figure for the InsuranceSavingsCard, the cross-shown protection RecommendedCoverage (ADR 21 D5), and the buying-power info box (ADR 22 D5).

### D4-fu4 — Estimated savings on the timeline `QuoteDetail` popover + fixture/buildInitial plumbing (Wave 36-fu4)

Smoke testing surfaced two gaps:

1. **The timeline `QuoteDetail` popover** (the per-event hover detail for the `Quoted` row — replicated in BOTH `insurance-portal/src/views/agent/LeadStatusTimeline.jsx` and `mission-control/src/components/RelatedInsuranceProgress.jsx`) hardcodes **"No savings comparison (quote-only path)"** when `quote.savingsAmountCents` is null. On the quote-only path it must instead, when a self-reported premium exists on the workflow, compute the estimated 6-month savings (`normalize(currentPremiumCents, premiumCadence) − quote.totalPremiumCents`) and render it — e.g. "Est. savings $X / 6mo vs {currentCarrier}". If no self-reported premium, keep the existing "No savings comparison" line. `QuoteDetail` must be passed the self-reported fields (thread `workflow`/`detailSource` through `EventDetail`).

2. **Force-status / fixture opps carry no self-reported data.** The agent-side `CurrentInsuranceGate` only runs in the pre-send view; force-statusing an opp to a post-send status skips it, and fixture opps never ran it. So: (a) insurance opp records may carry an additive `current_insurance: { carrierId, carrier, premiumCents, cadence }` block; (b) mc `buildInitial` seeds `currentCarrier / currentCarrierId / currentPremiumCents / premiumCadence` on the workflow root from `opportunity.current_insurance` when present (parallel to how it seeds `flowPath` + `summary`); (c) the fixture quote-only insurance opps are seeded with a `current_insurance` block so the demo shows real savings end to end. The live gate path is unchanged — it still writes the same workflow-root fields directly.

**fu5 — `current_insurance` is the persisted home for related-opp/reopened popovers.** The self-reported fields live on the live `insuranceWorkflow` only, so a quote-only opp shown as a *related* opp (or reopened) loses them — same class of problem Wave 33-fu3 solved for `summary`. Resolution: the Wave 31b-fu4 insurance status write-through (`CoPilotPane.jsx`) snapshots `current_insurance` onto the opp record alongside `summary` whenever the workflow carries self-reported data. `RelatedInsuranceProgress`'s `QuoteDetail` resolves the self-reported fields as `workflowSnapshot ?? opportunity.summary ?? opportunity.current_insurance` — so related-opp quote-only popovers compute estimated savings too. `current_insurance` is thus the single canonical persisted home (fixtures seed it; the write-through writes it; `buildInitial` reads it).

### D6 — Inline current-insurance entry on the InsuranceSavingsCard (Wave 36-fu6)

**Problem.** The `CurrentInsuranceGate` (D3) is an agent-side **pre-send** step gated on `flowPath === 'quote_only'`. But the FLOW PATH is chosen in the `LeadOriginationForm`, which runs *after* the gate sequence — so for a brand-new insurance opp (default `flowPath: 'capture_and_quote'`, no creation picker) the gate is never reached even if the agent later picks Quote Only in the form. And FORCE STATUS skips all pre-send gates outright. Net effect: a freshly-created quote-only opp advanced to `quote.completed` has **no self-reported premium anywhere**, so `InsuranceSavingsCard` is permanently stuck at "No carrier comparison available." The gate only ever pre-fills for fixture opps that carry `current_insurance` up front.

**Decision.** `InsuranceSavingsCard` becomes the **primary, always-reachable** surface for the self-reported current-insurance inputs. When the active opp is `flowPath === 'quote_only'`, the workflow is **post-send**, and `workflow.currentPremiumCents` is absent, the card renders a compact inline editor in place of the "No carrier comparison" / no-savings block:

- **Carrier** — compact searchable select over `canon/insurance-carriers.json` `carriers[]` (same source as the gate; canon is synced into mc).
- **Premium** — slider using `premium_slider.by_cadence[cadence]` bounds (monthly $50–$1,500 / 6mo $300–$5,000 / 12mo $600–$5,000), default = the cadence average.
- **Cadence** — `monthly` | `6mo` | `12mo` toggle; the slider re-bounds + clamps on change (mirror the gate).

On submit the card writes the four fields (`currentCarrier`, `currentCarrierId`, `currentPremiumCents`, `premiumCadence`) to the workflow via `updateWorkflow`, AND persists the `current_insurance` block to the opp record via `updateOpportunity` (so it survives opp-switch/reopen without depending on a later status change). The savings adapter then recomputes and the card flips to the savings view automatically.

When `currentPremiumCents` IS present, the card shows the computed savings as today, with a small "Edit current insurance" affordance to reopen the editor. The `CurrentInsuranceGate` (D3) stays — it still pre-fills for opps that are quote-only up front — but the card editor is the catch-all that makes the feature work for force-statused and form-chosen-quote opps. Capture+quote is unaffected (the editor is quote-only).

**D6-fu7 — the card's phase logic must consume the savings adapter.** Smoke testing exposed that `InsuranceSavingsCard` classifies its `quoted_with_savings` vs `quoted_no_savings` phase purely from `quote.payload.savingsAmountCents` (the EI field — null on the quote-only path) and reads the "currently with {carrier}" line from `verification.policyInfo.carrier` (also null for quote-only). It NEVER consults `workflow.currentPremiumCents` / `currentCarrier`, and it does NOT call `mapInsuranceWorkflowToSavings` — so D4's self-reported math (which lives in the adapter) never reached the card. The left-rail `QuoteDetail` popover (fu4, computes inline) and the card thus diverged: the popover shows real savings, the card stays at "No carrier comparison available". Fix: `InsuranceSavingsCard` computes `savings = mapInsuranceWorkflowToSavings(workflow)` once and uses it as the single source — the `quote.completed`/`quote.viewed` phase split keys on `savings?.status === 'savings_found'`; the `quoted_with_savings` body renders `savings.monthlySavingsCents` + `savings.captureCarrier` (which the adapter populates with `currentCarrier` on the self-reported path) + `savings.newCarrier`; the `quoted_no_savings` body's "currently with X" line reads `savings.captureCarrier`. Capture+quote is behavior-identical (for EI savings the adapter's `savings_found` ⟺ the old `savingsAmountCents > 0`).

### D5 — New canon file `insurance-carriers.json`

New `canon/insurance-carriers.json` (created in Phase A): `{ average_premium, premium_slider, carriers[] }`. `carriers[]` is sourced verbatim from the user-supplied `auto_insurance_company_customer_dropdown.xlsx` "Customer Dropdown" sheet — 92 entries total: 88 customer-facing US auto-insurance brands plus 4 catch-all rows tagged `category: "Form option"` (`other`, `not_sure`, `self_insured`, `no_insurance`). Carrier shape: `{ id, displayName, parentGroup, website, category }` — `id` is a stable slug derived from `displayName` (the 4 Form-option rows use fixed slugs); `category` is the NAIC-style segment (National / Regional / Nonstandard / Digital / Specialty / etc., or "Form option"). The autocomplete renders `displayName`; the agent stores `currentCarrierId` (slug) + `currentCarrier` (displayName). `canon/_version` bumped + synced into all child apps (the sync script globs `canon/*.json`, so the new file propagates automatically).

## Telemetry

- `insurance.agent.current_insurance.{viewed,submitted}` — the new gate, `{ carrier_id, premium_cents, cadence }` on submit.
- `mc.copilot.savings_card.find_coverage.enabled_in_sent` — diagnostic, fires when D1 enables the CTA early on a quote-only opp.
- Existing `insurance.copilot.find_coverage.{clicked,opp_spawned}` (Wave 31b) unchanged.

## Out of scope

- Capture+quote adopting the current-insurance step (D3 is quote-only).
- Carrier logos / financial-strength ratings (canon fields stubbed null).
- A real opportunity-creation picker if none exists — D2 wires `flowPath` honoring; building a creation UI is separate.
- Phase 2 EI integration changes.
