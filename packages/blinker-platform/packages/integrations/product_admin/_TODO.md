# product_admin/ — backlog

## StoneEagle (stoneeagle.js)

- **Monthly-membership product filter (Wave 24 Task 5 — placeholder):** Products where `term.miles === 999999` are dropped from `normalizeToFixtureShape`'s `products[]` output because they are per-month billed VSCs (RAP Monthly DA, Omega-J PlanCode 41/42, RAP R6) that cannot be rendered correctly by the wizard's per-term-total card UX. Remove this filter — and the matching `mileages` 999999 exclusion — when the monthly-membership UX ships. See `project_monthly_pay_vsc_products.md` in memory.

- **SE markup fields:** The OMGA UAT GetRates response returns `MarkupMin`/`MarkupMax`/`AdminMarkup`/`BaseMarkup`/`FIMarkup` all 0; Blinker layers markup via `org-registry.json::protection_billing.markup` instead (see `packages/utils/protection-pricing.js`). Per-org toggle to use SE's markup fields directly is a backlog item noted in the `normalizeToFixtureShape` comment.

- **term_semantics RegulatedRuleId mapping (ADR 14 backlog):** `resolveTermBasis` defaults are educated guesses for several `RegulatedRuleId` values (e.g. Omega EXCL Total Miles should be `absolute_from_purchase`, not `additive`). Needs authoritative mapping from real SE contract fields + per-plan-code review. See `architecture/14-term-semantics.md` and `project_monthly_pay_vsc_products.md`.

- **eContracting:** SE eContracting SOAP surface not yet wired; GetRates is the only live call.

- **Wave 25 v3.0.7 dev fixture-variant loading wired (`blinker.dev.vin_validate_scenario`). Production swap to real-VIN-call against SE will replace this in Phase 2.**
