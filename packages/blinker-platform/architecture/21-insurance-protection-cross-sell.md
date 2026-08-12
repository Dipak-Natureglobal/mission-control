# 21 — Insurance → Protection Cross-Sell (v3.0.11)

**Date:** 2026-05-14
**Status:** Active
**Supersedes:** —
**Cross-refs:** ADR 06 (Embedded Insurance Contract), ADR 08 (Cross-Sell Orchestration — _protection→insurance_, _protection→refi_), ADR 18 (Plan Catalog)

## Context

ADR 08 (2026-05-03) established the cross-sell direction as **protection-portal as orchestrator** — protection's `RecommendedCoverage` step is the agent's selling moment, with "Find insurance savings" and "Lower your monthly with refinance" CTAs that embed insurance / refi sub-flows. Cross-sell is asymmetric in that ADR: protection pulls in from refi + insurance; neither reaches back.

v3.0.11 (2026-05-14) reverses one of those arrows. The insurance opportunity workflow now becomes a launch point for protection. Three load-bearing changes:

1. **Insurance customer flow** must collect mileage + estimated annual mileage (required for the insurance quote AND to seed a protection workflow at step 3). The shared **`VehicleDrive`** ("How much do you drive?") step from protection's customer wizard becomes the second step of the insurance customer flow as well.

2. **Mission Control CoPilot for an insurance opportunity** gains a **protection teaser** + **Find Coverage** CTA. As capture/quote returns from EI, the teaser populates with "currently paying $X/mo" and "could save up to $Y/mo." Clicking Find Coverage spawns a new protection opportunity prefilled with vehicle YMMT/VIN/mileage and lands the agent on protection step 3 (vehicle_use).

3. **Capture/quote progress** for a related insurance opportunity surfaces under **RELATED OPPORTUNITIES** in the left rail of the protection CoPilot (or any non-insurance opp with a related insurance opp), so the agent sees insurance state without leaving the active opp. Equally, when the agent is on the insurance CoPilot AND a related protection opp ≤ step 5 (coverage_recommendation) already exists, the protection plan cards render inline with live insurance-savings deduction.

This is the inverse of ADR 08's protection→insurance arrow. The two arrows now form a closed cycle: protection's RecommendedCoverage can spawn insurance; insurance's CoPilot can spawn protection. Customer-portal remains the re-skinned wrapper — not part of the orchestration cycle.

## Decisions

### D1 — VehicleDrive is a shared customer-flow step across protection + insurance

The protection-portal wrapper at `protection-portal/src/views/customer/VehicleDrive.jsx` (which wraps `refi-portal/src/views/customer/VehicleDrive.jsx` and layers in MarketCheck + canonical `form.vehicle.market_value`) is the canonical implementation. **insurance-portal adds a parallel wrapper** with the same body (`refi-portal`'s VehicleDrive). Both wrappers persist the same canonical fields on `form.vehicle` (or, in insurance, on `workflow.vehicle`):

```js
vehicle: {
  vin,
  year, make, model, trim,
  mileage,                  // odometer at capture
  condition,                // 'new' | 'used'
  purchase_date,            // null when condition='new'
  annual_miles_estimate,    // computed by computeAnnualMileageEstimate()
  market_value: { retail, trade_in, fetched_at, source },
}
```

**Why duplicate the wrapper rather than lift to `packages/components`:** the wrappers diverge on side-effects (protection writes `form.vehicle.market_value`, insurance only needs the field for display; future telemetry namespaces differ). The body — refi-portal's `VehicleDrive` — is the shared part and already lives at one location. The wrappers are ~150 lines each; duplication cost is lower than designing a parameterized packages/components surface today. **Lift candidate**: if a third app adopts the step, lift then.

**Why insurance needs this:** annual_miles_estimate is a real underwriting input for the quote. Today insurance-portal's simulator skips it because the simulator was modeled before mileage-driven rate variance was exercised. Real EI integration will require it.

### D2 — Insurance step order

The capture_and_quote and quote_only paths now include `vehicle_drive` between the existing `capture` (carrier OCR) step and the `getting_quote` waitstate:

```
capture_and_quote:
  capture → vehicle_drive → getting_quote → quote_review → policy_bound

quote_only:
  vehicle_drive → getting_quote → quote_review → policy_bound
```

`vehicle_drive` precedes the EI quote request because mileage and annual_miles_estimate are quote inputs. **VIN/YMMT pre-known**: arrives in the lead payload from the agent's origination form; the step header shows "GETTING TO KNOW YOUR {year make model trim}" just like protection's flow.

### D3 — Find Coverage CTA + protection-opp spawn

The InsuranceSavingsCard (existing shape lives at `refi-portal/src/results/InsuranceSavingsCard.jsx`) is the visual precedent. The same card surfaces in **mc CoPilot for an insurance opportunity** in the right-pane main area, with state-driven copy:

| Insurance workflow state                    | Card content                                                                 |
|---------------------------------------------|------------------------------------------------------------------------------|
| `pre_send` / `started`                      | (card hidden — show LeadOriginationForm + protection teaser placeholder)     |
| `capture_link.sent` → `capture_link.viewed` | Teaser: "Customer is reviewing — savings TBD" + Find Coverage CTA disabled   |
| `capture.completed`                         | "Currently paying $X/mo" hero (carrier from `lead.summary.insuranceVerification.policyInfo`). Find Coverage CTA **active** — savings still TBD; copy reads "Could save up to $—/mo (quote pending)" |
| `quote.completed` (savings > 0)             | Full card: current $X/mo, "Could save up to $Y/mo", coverage checklist, Find Coverage CTA active. Reads `summary.quote.savingsAmountCents` |
| `quote.completed` (savings = 0)             | "We will continue to monitor savings" muted card. Find-Coverage CTA **still active** (agent can still cross-sell protection). |
| `policy.bound`                              | Card folds to a compact "Bound with {carrier} — saving $Y/mo" summary; CTA active |
| `error.verification` / `error.quote`        | Show error reason inline; CTA active (agent can still spawn protection) |

**Find Coverage spawn flow** (D3a):

```
on click:
  1. blinkerApi.opportunities.create({
       type: 'protection',
       contact_id: insuranceOpp.contact_id,
       vehicle_id: insuranceOpp.vehicle_id,
       status: 'vehicle_use',  // step 3
       owner: insuranceOpp.owner,
       _prefill: {
         mileage, annual_miles_estimate, condition, purchase_date,
         year, make, model, trim, vin,
       },
     })  // Phase 1 → session-data.appendOpportunity; Phase 2 → API write
  2. track('insurance.copilot.find_coverage.clicked', {
       insurance_opp_id, current_premium_cents, savings_amount_cents,
     })
  3. CoPilot switches to the new protection opp (active-workflow + URL).
  4. ProtectionEmbed seeds protectionForm from the spawned opp's _prefill
     (extend buildProtectionInitialForm to consume _prefill if present;
     falls back to the existing contact/vehicle seed when absent).
  5. Step index lands at protection step 3 (vehicle_use). The two earlier
     steps (vehicle_add, vehicle_drive) are skipped because their data
     is already on the form.
```

**Phase 1 mechanics:** `blinkerApi.opportunities` is read-only today (`packages/api/opportunities.js:104-110`). This wave is **read-only enough** — the spawn writes to mission-control's session-scoped `session-data.appendOpportunity()`, with a thin wrapper in `packages/api/opportunities.js::create()` that delegates to the existing session-data writer when running inside mc. Other consumers get a fixture-mode warning until Phase 2 lifts the mutation into the SDK proper.

### D4 — Capture+quote progress under RELATED OPPORTUNITIES

The mc CoPilot left rail (`CoPilotPane.jsx:1457-1489`) currently renders related opportunities as simple `[type badge] · [status] · [next_action]` rows. v3.0.11 extends the row body for `type='insurance'` related opps:

```
┌─ Related Opportunities ──────────┐
│ [Insurance] capture_link.viewed  │
│ ─ Capture pending                │
│                                  │
│  Capture+quote progress          │
│  ●  Started               2:33   │
│  ●  Capture Link Sent     2:33   │
│  ●  Capture Link Viewed   2:34   │
│  ○  Capture Completed     —      │
│  ○  Quoted                —      │
│  ○  Policy Written        —      │
│  [Open insurance CoPilot →]      │
└──────────────────────────────────┘
```

Implementation: extract a **compact** variant of `insurance-portal/src/views/agent/LeadStatusTimeline.jsx` — same canon-driven status list (CAPTURE_AND_QUOTE_PATH / QUOTE_ONLY_PATH), denser layout, no force-status controls, no error-row affordances. New component `mission-control/src/components/RelatedInsuranceProgress.jsx`. Reads insurance opp's webhook-derived activity feed via `blinkerApi.activities.list({ opportunity_id })` to derive timestamps (Phase 1 fixtures already populate these for `opp_ins_*` rows).

The same component surfaces in the **insurance CoPilot itself** when there's a related protection opp ≤ step 5 — see D5.

### D5 — Coverage Recommendation cross-component

When the current CoPilot opp is `type='insurance'` AND a related protection opp exists at `status ∈ {vehicle_add, vehicle_drive, vehicle_use, coverage_preview, coverage_recommendation}` (i.e., not yet past step 5), the **right pane** of the insurance CoPilot renders the protection Good/Better/Best plan cards inline alongside the existing insurance LeadStatusTimeline.

Composition is the existing protection `RecommendedCoverage` component, with `insuranceSavings` prop driven LIVE by the insurance workflow's `lead.summary.quote.savingsAmountCents` rather than by protection's CrossSellSubFlow completion. As capture/quote events fire, the `-$Y/mo (insurance vs {carrier})` line on each Good/Better/Best card updates without unmount.

- **Pre-`capture.completed`**: cards render with Find-insurance-savings boost slot active (pending); plan monthly column shows full `~$X/mo` with no -$Y/mo line; the boost-slot Result Chip is absent.
- **`capture.completed` (no quote yet)**: boost-slot Result Chip shows "Insurance savings: TBD (quote pending)"; plan cards still show full `~$X/mo`.
- **`quote.completed` (savings > 0)**: boost-slot Result Chip shows "Insurance savings: -$50/mo · Progressive → Geico"; plan cards add `-$50/mo (insurance vs Progressive)` muted line; the `Find insurance savings` CTA is marked DONE.
- **`quote.completed` (savings = 0 — no-savings branch)**: `Find insurance savings` CTA marked DONE; boost-slot Result Chip shows "We will continue to monitor savings"; plan cards **do not** add a `-$/mo` line. Plan monthly stays at full `~$X/mo`.

**Lift mechanics:** `RecommendedCoverage` already accepts `insuranceSavings` as a prop (file:protection-portal/src/views/customer/RecommendedCoverage.jsx:421, 479, 510-521). Mission-control imports `RecommendedCoverage` from `protection-portal/src/views/customer` (similar to how `CoPilotPane` already imports `INITIAL_FORM` + `buildSteps` from protection-portal's CustomerView). The `form` prop is constructed in mc from the related protection opp's seeded form; `insuranceSavings` is mapped from the current insurance opp's workflow state via a small adapter (`mapInsuranceWorkflowToSavings(workflow): { monthlySavingsCents, captureCarrier, newCarrier, status }`).

The `status: 'no_savings'` discriminator is new — protection's RecommendedCoverage currently relies on `insuranceSavings == null` for the "no result yet" state. Extend the component to treat `{ monthlySavingsCents: 0, status: 'no_savings' }` as "DONE — monitoring" (changes copy + suppresses the `-$/mo` line), while `null` continues to mean "not run yet."

### D6 — No-savings branch (cross-cutting)

`status: 'no_savings'` propagates through three surfaces:

- **InsuranceSavingsCard (mc insurance CoPilot)** — muted variant, "We will continue to monitor savings" hero copy
- **Protection plan cards (when cross-shown via D5)** — no `-$/mo (insurance vs {carrier})` line; the boost-slot Result Chip reads "We will continue to monitor savings" instead of "-$X/mo"
- **Protection's own RecommendedCoverage (when protection→insurance cross-sell runs and returns no savings)** — same component behavior, no separate code path

This means the "monitoring" copy lives in `protection-portal/src/views/customer/RecommendedCoverage.jsx` and is reused by mc. No mc-local fork.

## Telemetry

New events (registered in `packages/telemetry`):

- `insurance.customer.vehicle_drive.viewed` `{ workflow_id, vin, year, make, model, trim }`
- `insurance.customer.vehicle_drive.continued` `{ workflow_id, mileage, condition, purchase_date, annual_miles_estimate }`
- `insurance.copilot.savings_card.viewed` `{ insurance_opp_id, has_capture, has_quote, savings_amount_cents }`
- `insurance.copilot.find_coverage.clicked` `{ insurance_opp_id, contact_id, vehicle_id, current_premium_cents, savings_amount_cents }`
- `insurance.copilot.find_coverage.opp_spawned` `{ insurance_opp_id, protection_opp_id, prefilled_step: 'vehicle_use' }`
- `mc.copilot.related_insurance_progress.viewed` `{ source_opp_id, source_type, related_insurance_opp_id, latest_status }`
- `mc.copilot.related_insurance_progress.clicked` `{ source_opp_id, related_insurance_opp_id }`
- `protection.recommended_coverage.insurance_savings_status` `{ status: 'pending' | 'savings_found' | 'no_savings', monthly_savings_cents }`

## Canon impact

- `canon/blinker-domain.json` — `vehicle.{mileage, annual_miles_estimate, condition, purchase_date}` fields documented as part of the canonical vehicle shape (no schema change; already consumed in protection). Adds insurance as a writer.
- `canon/ghl-status.json` — no new statuses needed. Existing `insurance.statuses` (capture_link.*, quote_link.*, capture.completed, quote.completed, quote.viewed, policy.bound, error.*) already cover the timeline.
- `canon/org-registry.json` — no new fields; this cross-sell direction is org-agnostic in Phase 1 (vs protection→insurance which is gated by `insurance_enabled` per org). Re-evaluate gating in Phase 2.

## Phasing

**Phase A (coordinator-direct in blinker-platform):** this ADR + STATUS.md Wave 31 entry + PROMPTS.md templates + canon `_version` bump + sync.

**Phase B1 (insurance-portal dispatch):** D1 + D2 — VehicleDrive step in insurance customer flow + agent left-rail shows new mileage/annual fields.

**Phase B2 (mission-control dispatch — bundled):** D3 + D4 + D5 + D6 — InsuranceSavingsCard + Find Coverage spawn + RelatedInsuranceProgress component + Coverage cross-component when both opps exist + no-savings discriminator. Includes the `packages/api/opportunities.js::create()` thin wrapper that delegates to session-data writer.

**Phase B2 is bundled** because all three features touch `CoPilotPane.jsx` and share state (insurance workflow snapshot, related-opps list, spawn-mechanism). Per the bundled-PR preference for refactors in this area, one dispatch is correct.

## Open items

- **D5 cross-show under refi CoPilot?** PDF spec only calls out insurance→protection. Refi already has its own InsuranceSavingsCard in `refi-portal/src/results/`. Leave refi-side cross-show out of v3.0.11; revisit if user asks.
- **Spawning protection opp from CONSUMER side of insurance?** Out of scope for v3.0.11; the consumer microsite is EI-hosted in production (per ADR 06) and our simulator's role is to show the agent flow. Agent triggers Find Coverage in the CoPilot; consumer is not asked to choose protection.
- **Mileage required vs optional in `quote_only` path?** Treat as required — same as `capture_and_quote`. The PDF says "Both are required for an insurance capture or insurance quote workflow."
