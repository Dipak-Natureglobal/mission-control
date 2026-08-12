# 28 — Monthly-Membership VSC Plans (v3.0.16)

**Date:** 2026-06-01
**Status:** Active
**Supersedes:** —
**Cross-refs:** ADR 13 (StoneEagle integration), ADR 09 (Protection billing config), ADR 14 (Term semantics), ADR 18 (Plan catalog), ADR 17 (VIN-validate rates comparison)

## Context

StoneEagle `GetRates` returns, for the OMEGA TPA, a class of VSC products that are **monthly memberships** rather than fixed-term-total plans (M2M / "Residual" / RAP). OMEGA signals this by returning rate rows whose `RateClassMoneys.RateClassMoney.TermMile.Mileage == 999999` (effectively unlimited miles), with terms enumerated month-by-month (1, 2, 3, …) each carrying its own per-month rate.

Until now these were **silently dropped**: the normalizer detected the `999999` sentinel and filtered the products out (Wave-24 code), and the term/miles optimizer in `protection-portal/src/lib/plan-selector.js` would have dropped them anyway (they classify as "good" by name and have no real term/mileage axis). The wizard "worked by accident" — monthly products never reached the UI. See the backlog note `project_monthly_pay_vsc_products.md`.

This ADR makes monthly memberships a first-class purchase path: rated Good/Better/Best like term plans, surfaced behind a global term/monthly switch in the picker, and charged on the Confirm screen as a recurring monthly amount with **no down-payment and no finite months-to-pay** (the term is unlimited; coverage continues while payments continue).

## Decisions

### D1 — The `999999` mileage sentinel is the AUTHORITATIVE detector

A product is flagged `billing_model: 'monthly_subscription'` when **any** of its rate rows hits the sentinel mileage. Nothing else gates it. The plan-code allowlist (`40/41/42/C1/R6`) and the `"Residual"` description substring are **secondary signals for telemetry/sanity only** — recorded on the product as `monthly_signals` and used to emit a `monthly_signal_mismatch` event when the sentinel fires but neither secondary signal agrees. They never gate detection.

Canon: `canon/plan-mappings.json::monthly_membership` = `{ sentinel_mileage: 999999, secondary_signals: { plan_code_allowlist, residual_description_substring } }`. The allowlist is an **educated guess** pending a real OMGA monthly capture (per `feedback_canon_todo_defaults`); the sentinel, not the list, is what gates.

### D2 — The normalizer GROUPS sentinel rows into one product per (plan_code, deductible)

`packages/integrations/product_admin/stoneeagle.js#normalizeToFixtureShape` flattens the SCS response to **one product per `RateClassMoney` row** for term plans. A monthly plan returns many rows (one per term), all at mileage `999999`. The normalizer now branches per row:

- **sentinel rows** → accumulate into a `monthlyRowsByGroup` Map keyed `${planCode}::${deductAmt}`; they do **not** enter the term/mileage/deductible slider sets (so the sentinel never leaks into the wizard range pickers).
- **other rows** → existing term-plan path, plus a new `billing_model: 'term_total'` field.

After the loop, `buildMonthlyProduct()` materializes **one product per group**, carrying:
`billing_model: 'monthly_subscription'`, a `monthly_terms[]` array (`{term, cost, rate, regulated_rule_id, bounds}` — the per-term rates the org config prices from), `monthly_charge` (the per-month customer charge), `mileage: null` + `unlimited_mileage: true`, `coverage_period_months` = the configured `term_to_use` (never `999999`), and `monthly_signals` / `monthly_pricing` for transparency. `base_price` and `monthly_price` mirror `monthly_charge` so existing fixture-shape consumers don't render `NaN`.

### D3 — Config split: pricing in org-registry, presentation in plan_catalog

Per-plan-code **pricing** lives in a new block `canon/org-registry.json::orgs[].protection_billing.monthly_membership`:

```
{ enabled, default:{ term_to_use, markup_dollars, florida_markup_dollars },
  by_plan_code:{ "<code>": {…same…} },
  discount:{ max_percent, max_dollars, disabled_in_states } }
```

`term_to_use` selects which `TermMile.Term`'s per-term cost is the basis; the per-month charge = `cost_at(term_to_use) + markup` (FL split honored). **`term_to_use` MUST be `1`** — confirmed 2026-06-01 against real OMGA UAT, StoneEagle returns the monthly plan's `<Cost>` as **total-at-term** (cumulative: term 12 ≈ 12× the per-month rate), so only the term-1 cost is the true per-month figure. `by_plan_code[code]` supersedes `default`. The `discount` sub-block is a **separate** monthly cap set (distinct from the term-plan `discount` block). Edited in mission-control admin (`personas/super/OrgConfigSections/Protection.jsx`).

Plan **presentation** (title / coverage HTML / DocuSeal template) is unchanged — it stays on `plan_catalog` / per-org `plan_overrides` keyed `TPA::PTC::PlanCode` and is edited in the PlanCatalog "Plans" tab. No schema change there.

### D4 — Pricing resolver: `resolveMonthlyMembershipPricing`

New export in `packages/utils/protection-pricing.js`: `resolveMonthlyMembershipPricing({ orgId, planCode, monthlyTerms, state })` → `{ monthly_charge, term_used, term_requested, used_term_fallback, markup_applied, markup_regulation: 'monthly_flat', cost_at_term, enabled }`. It reads the new org block, resolves `by_plan_code → default`, picks the `monthly_terms` row at `term_to_use` (nearest-term fallback with a flag if absent), and applies the FL markup split via the existing `FLORIDA_STATES` set. `computePlanPrice` (term plans) is **untouched**, and monthly plans **bypass `getOrgMaxPlanPrice`** (they have their own caps). A `getOrgMonthlyMembershipSnapshot(orgId)` is added for DevPanel/telemetry parity.

### D5 — Selector forks; missing `billing_model` defaults to `term_total`

`protection-portal/src/lib/plan-selector.js` partitions products by `billing_model`. Monthly products build a **parallel** Good/Better/Best set that skips `optimizeByTermAndMileage` and the `max_plan_price` ceiling and classifies tier via the catalog/`resolvePlanPresentation` path (fixing "monthly always = good"). `selectPlans` returns additively: `{ plans:{good,better,best}, monthly:{good,better,best}|null, hasMonthly, debug }`. `listMatchingPlans` gains `mode: 'term' | 'monthly'` (default `'term'`).

> **Important:** fixture-mode products come from the pre-normalized JSON fixture and therefore have **no `billing_model` field** — the selector and Confirm MUST treat a missing `billing_model` as `'term_total'`.

### D6 — Confirm screen branches on `isMonthly`

`protection-portal/src/views/customer/Confirm.jsx`: when `plan.billing_model === 'monthly_subscription'`, `dueToday = monthly_charge` (after the monthly discount), the down-payment and months-to-pay controls are **hidden** (and not seeded), the **monthly** discount caps apply, and the first-payment-date is relabeled "First monthly charge". The term path is unchanged. The `selectedPlan` writers (`RecommendedCoverage`, `Customize`, `RatesChanged`) carry `billing_model`, `monthly_charge`, `term_used`.

### D7 — Step-5 UX: a global term/monthly switch

When `hasMonthly`, RecommendedCoverage renders a single toggle that flips the whole 3-tier picker between term plans and monthly-membership plans (two modes, same layout) — rather than per-tier pills or a separate panel. Customize (browse) gets a matching `mode` filter; term/mile sliders hide in monthly mode.

## Open risks (resolve during implementation, not finalized here)

1. **No real `999999` fixture exists.** The synthetic `_fixtures/stone-eagle-get-rates-monthly.json` (opt-in via DevPanel toggle, localStorage `blinker.dev.monthly_membership_demo`) exists ONLY to build/smoke the UI. Capture a real OMGA/RAP monthly `GetRates` via the `/se-rating` proxy and replace it before finalizing `buildMonthlyProduct` / `monthly_terms` semantics. Include a regression test using the exact real shape (`feedback_fixture_shape_mismatch`).
2. **RESOLVED 2026-06-01:** per-term `Cost` is **total-at-term** (cumulative). Real OMGA UAT returns each monthly plan at Term=1 with the per-month cost (41 $44, 42 $49, R6 $30) and higher terms carrying the multiplied total. Setting `term_to_use: 1` reads the true per-month cost. Tiers confirmed by user: **41 → good, R6 → good, 42 → better** (catalog `plan_level` for OMGA::VSC::{40,41,42,R6}); DocuSeal template IDs for 41/42 still TBD (set in the admin Plans tab; R6 = '3').
3. **Group key** `${planCode}::${deductAmt}` assumes deductible distinguishes variants and PlanCode is stable across rows; may need `RateClassCode` if one PlanCode spans multiple memberships.
4. **`term_to_use` missing** from the returned terms triggers nearest-term fallback; confirm with product vs. dropping the plan.

## Affected surfaces

- **Coordinator:** `canon/plan-mappings.json` (+`monthly_membership`), `canon/org-registry.json` (+`protection_billing.monthly_membership` per org), `canon/_version`; `packages/integrations/product_admin/stoneeagle.js` (group + flag; opt-in synthetic fixture); `packages/utils/protection-pricing.js` (+resolver/snapshot); `_fixtures/stone-eagle-get-rates-monthly.json` (synthetic).
- **protection-portal:** `src/lib/plan-selector.js`, `src/views/customer/RecommendedCoverage.jsx`, `Customize.jsx`, `Confirm.jsx`, `RatesChanged.jsx`; DevPanel toggle for the monthly demo.
- **mission-control:** `src/personas/super/OrgConfigSections/Protection.jsx` (editable monthly config), `src/personas/admin/OrgConfiguration.jsx` (read-only mirror), optional `src/personas/admin/PlanCatalog.jsx` (Monthly badge).
