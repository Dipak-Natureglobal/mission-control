# ADR 17 — Post-payment VIN-validate rates comparison & branching

**Status:** Accepted (Wave 25 v3.0.7, 2026-05-10)
**Supersedes scope of:** the Phase-1 stub in `protection-portal/src/views/customer/VinValidate.jsx` (which only decoded YMMT and surfaced a mismatch modal — no second SE GetRates call, no re-pricing, no refund path).
**Source brief:** `Blinker Platform - v.3.0.6.pdf` Task 2.

## Context

Today, the customer protection wizard accepts an `org_id`, vehicle YMMT, mileage, and (optionally) a VIN before calling StoneEagle GetRates and presenting Good/Better/Best plans. When the customer reaches the wizard via a partner deep-link, the upstream system may not yet have a VIN. We accept the order with `YMMT` only, take the down payment via FluidPay, and ask for the VIN immediately after — `VinValidate` is Step 9b.

What we don't do today: we don't call SE GetRates a *second* time after the VIN is captured. SE's response keys partly off VIN (vehicle_class derivation, applicable plan list, sometimes price), so the YMMT-only quote can drift from the VIN-decoded reality. BlinkerLegacy has many error paths around this drift that aren't handled cleanly; this ADR is the rebuild.

## Decision

After a successful FluidPay tokenize **and** charge, when the original quote was YMMT-only, the customer wizard will:

1. Capture the VIN (existing `VinValidate.jsx` UX — strict 17-char input + VinAudit decode).
2. Re-call `getRates` from `blinker-platform/integrations/product_admin` with the VIN attached. This is in addition to (not a replacement for) the original YMMT call — both responses are retained for comparison.
3. Run `classifyRatesChange(...)` from `blinker-platform/utils` on the two response objects + the user's selected plan + the org's `vin_validate` config block.
4. Branch the wizard based on the returned `kind`. There are 8 distinct kinds (defined below); 5 advance silently with banners, 3 route into a new `RatesChanged` step.

A new opportunity-flag set is introduced: `form.opportunityFlags = { vehicle_revised: bool, rates_changed: bool, refunded: bool }`. The agent inbox in mission-control will surface these (queued for a separate sub-wave).

## Classification contract — `classifyRatesChange()`

Pure function. Lives at `packages/utils/getrates-comparison.js`.

```js
classifyRatesChange({
  ymmtRates,            // Original SE GetRates response (no VIN in the request).
  vinRates,             // Second SE GetRates response (VIN included).
  selectedPlan,         // form.selectedPlan { plan_code, term_months, miles, ... }
  vehicleBefore,        // { year, make, model, trim, vehicle_class }
  vehicleAfter,         // { year, make, model, trim, vehicle_class } from vinRates root
  marginTolerancePct,   // org.protection_billing.vin_validate.margin_tolerance_pct
}) → {
  kind: 'no_change' | 'ymm_changed' | 'ymmt_changed' | 'vehicle_class_changed'
      | 'plan_disappeared' | 'plan_price_lower'
      | 'plan_price_higher_within_tolerance' | 'plan_price_higher_outside_tolerance',
  detail: { … kind-specific payload … },
}
```

### Kind precedence (top-to-bottom; first match wins)

1. `ymmt_changed` — if `(year, make, model, trim)` differ, even if the same `(year, make, model)` is preserved. Implies vehicle_class may also differ; we don't double-classify.
2. `ymm_changed` — if `(year, make, model)` differ but trim is the same on both sides (rare; usually trim drifts too).
3. `vehicle_class_changed` — same YMMT but different `vehicle_class` from SE. (E.g., SE classified the YMMT as Class 2 originally but Class 4 once VIN-decoded.)
4. `plan_disappeared` — selected plan's `(plan_code, term_months, miles)` triple is NOT present in `vinRates.products[]`.
5. `plan_price_lower` — same triple present, `vinRates` price ≤ `ymmtRates` price.
6. `plan_price_higher_within_tolerance` — same triple present, `vinRates` price > `ymmtRates` price, delta ≤ `marginTolerancePct%`.
7. `plan_price_higher_outside_tolerance` — same triple present, `vinRates` price > `ymmtRates` price, delta > `marginTolerancePct%`.
8. `no_change` — identity match on YMMT, vehicle_class, plan list (selected plan present), plan price.

`detail` payload for the most common kinds:
- `plan_disappeared`: `{ selected_plan_code, selected_term_months, selected_miles, available_plans: [...] }` — vinRates products mapped through selectPlans.
- `plan_price_higher_*`: `{ selected_plan_code, ymmt_price, vin_price, delta_pct }`.
- `vehicle_class_changed`: `{ class_before, class_after }`.

## UX routing per kind

| Kind | Wizard action | Form mutations | Telemetry |
|------|---------------|----------------|-----------|
| `no_change` | Silent advance to eSign step | none | `vin_validate.no_change` |
| `ymm_changed` / `ymmt_changed` / `vehicle_class_changed` | Banner + advance to eSign | `vehicle.*` updated, `opportunityFlags.vehicle_revised = true` | `vin_validate.vehicle_revised` |
| `plan_price_lower` | Silent advance; eSign + EFS contract use new (lower) price | `selectedPlan.total_cost = vin_price`, `paymentSchedule` recomputed | `vin_validate.price_lower` |
| `plan_price_higher_within_tolerance` | Banner ("price adjusted within tolerance") + advance | same as price_lower | `vin_validate.price_within_tolerance` |
| `plan_disappeared` | Route to `RatesChanged` step | `opportunityFlags.rates_changed = true` | `vin_validate.rates_changed` (kind=plan_disappeared) |
| `plan_price_higher_outside_tolerance` | Route to `RatesChanged` step | same as plan_disappeared | `vin_validate.rates_changed` (kind=price_outside_tolerance) |

## `RatesChanged` step UX

New customer wizard step, mounted at 9c (after VinValidate). Three CTAs:

1. **Pick a different plan** — re-renders Good/Better/Best from `vinRates` via `selectPlans()`. On selection:
   - Recompute payment schedule against the new plan price.
   - **If org config `allow_down_payment_bypass=true`:** treat the already-collected DP as satisfying the new plan's `min_percent`. The remaining balance amortizes over the chosen term.
   - **If `allow_down_payment_bypass=false`:** if the new plan's `min_percent * total_cost` exceeds the collected DP, surface a top-up CTA (collect the delta via the same FluidPay flow). If equal or less, just amortize the remainder.
2. **Refund and exit** — call `refundCharge({ charge_id, amount, reason: 'vin_validate_<kind>' })` from `packages/integrations/payment`. On success: route to `ThankYou` with a "refund processed" variant. On failure: surface classified error + offer to mark for manual review. **Behavior gated on `auto_refund_on_decline`:** when false, "Refund and exit" instead opens an internal "flagged for manual review" path (no refund call, just opportunity flag).
3. **Continue with original** — only enabled when `kind === plan_price_higher_outside_tolerance` AND org config explicitly allows it (a fourth boolean: `allow_over_tolerance_proceed`, default false). When the customer or agent accepts the higher price as-is, the org eats the margin or passes it through. Default: hidden.

## Canon — `org.protection_billing.vin_validate`

Per-org block under each org's existing `protection_billing`:

```jsonc
"vin_validate": {
  // When a forced plan switch happens, allow the already-collected DP to
  // satisfy the new plan's minimum-down requirement (true) vs. require
  // a fresh min-down calc against the new plan price (false, legacy parity).
  "allow_down_payment_bypass": false,            // _TODO confirm w/ partner ops

  // When the SAME plan re-prices higher on the VIN call, what % delta is
  // acceptable before forcing a re-pick. 5 = 5% margin acceptance.
  "margin_tolerance_pct": 5,                     // _TODO confirm w/ finance

  // When the customer/agent declines the substitute, auto-refund via the
  // EFS package vs. flag for manual review. Default true.
  "auto_refund_on_decline": true,                // _TODO confirm w/ ops

  // When kind = plan_price_higher_outside_tolerance, allow the customer to
  // proceed at the higher price (org or partner eats the margin). Default
  // false; when false, the "Continue with original" CTA is hidden.
  "allow_over_tolerance_proceed": false          // _TODO confirm w/ finance
}
```

Per memory `feedback_canon_todo_defaults.md` — these defaults are educated guesses. Each is marked `_TODO`. Dispatch prompts must surface this uncertainty so the consumer code uses the configured value, not a hardcoded fallback that pretends to be authoritative.

## Package boundaries

- `packages/utils/getrates-comparison.js` (new) — pure classifier. No I/O, no React. Unit-testable in isolation.
- `packages/integrations/payment/efs.js` — `refundCharge()` already stubbed in Wave 24 C1 (`6b28a2c`). Wave 25 hardens it: real proxy path against the cloud-function (`POST /efs-charge/refund` body `{ charge_id, amount, reason }`), full classifyChargeError support, fixture+emulate paths.
- `packages/integrations/product_admin/stoneeagle.js` — already accepts `vin` in the GetRates request shape (Wave 21). No code change needed; the consumer just calls it twice.
- `protection-portal/src/views/customer/VinValidate.jsx` — rebuild: keep the existing decode + YMMT-mismatch modal as pre-flight, then trigger the second SE GetRates call, run the classifier, and route per the table above.
- `protection-portal/src/views/customer/RatesChanged.jsx` (new) — the 3-CTA branch screen.
- `protection-portal/src/views/customer/CustomerView.jsx` — wire `RatesChanged` into the wizard step list as `9c`.
- `protection-portal/src/views/customer/ThankYou.jsx` — handle the `form.opportunityFlags.refunded` variant.

## Test scenarios (smoke checklist)

The fixture under `packages/integrations/product_admin/_fixtures/stone-eagle-get-rates.json` is the YMMT-only baseline. Add a sibling `stone-eagle-get-rates-vin-*.json` per scenario:

1. `stone-eagle-get-rates-vin-class-changed.json` — same YMMT, `vehicle_class` differs.
2. `stone-eagle-get-rates-vin-ymmt-changed.json` — different trim, otherwise close.
3. `stone-eagle-get-rates-vin-plan-disappeared.json` — selected plan code missing from products.
4. `stone-eagle-get-rates-vin-price-lower.json` — same plan, ~10% lower.
5. `stone-eagle-get-rates-vin-price-within-tolerance.json` — same plan, ~3% higher (within 5%).
6. `stone-eagle-get-rates-vin-price-outside-tolerance.json` — same plan, ~12% higher (outside 5%).

The `_PROVIDER_MODE_KEY` toggle gets a third value (or a new sibling key) for selecting the vin-fixture variant during smoke. Suggest a separate localStorage key `blinker.dev.vin_validate_scenario` with values matching the file basenames.

## Dependencies / sequencing

Wave 25 v3.0.7 phases:

- **Phase A** (this ADR + canon edit; coordinator-direct).
- **Phase B** packages — `getrates-comparison.js` + `efs.js#refundCharge` hardening. Parallel-safe (different files).
- **Phase C** protection-portal — VinValidate rebuild + RatesChanged.jsx + CustomerView wiring + fixtures. Sequential after B.
- **Phase D** mission-control inbox `vehicle_revised` / `rates_changed` chips. Defer to a sub-wave; not in v3.0.7 scope.

## Open backlog (out of scope for v3.0.7)

- Real SE GetRates `vehicle_class` parsing — confirm SE returns vehicle_class on every product or only at root level. Adjust comparator if per-product.
- Real refund flow against the FluidPay sandbox/prod — currently stubbed. Requires the cloud-function endpoint to ship.
- Mission-control inbox UX for the new opportunity flags.
- Partner-specific "auto-route to alternate underwriter" logic when a plan disappears (some partners allow re-quoting against a different TPA).
