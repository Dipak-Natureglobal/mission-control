# ADR 14 — Term semantics: additive vs absolute

**Status:** Accepted (Wave 23 v3.0.5 Task 6, 2026-05-09)
**Supersedes:** none — extends ADR 13 stoneeagle-integration

## Context

StoneEagle GetRates returns `TermMonths` and `TermMileage` per Rate
inside each Plan. These two integers can mean two different things
depending on the plan / regulator regime:

- **Additive** — the value extends the *current* odometer/age. A 24/50000
  plan on a vehicle with 30,000 miles covers up to a 30 + 24 = 54-month
  service age and 30,000 + 50,000 = 80,000-mile odometer. This is how
  most non-regulated VSCs and EWT plans work.
- **Absolute** — the value is the cap from purchase / contract start.
  A 36/100000 plan caps at 36 months of contract duration AND 100,000
  total odometer regardless of the vehicle's current state. Filed-rate
  plans (FL VSC, TX GAP) and finance-capped plans are typically absolute.

The PDF v3.0.5 Task 6 surfaced this: "term miles and term months mean
two different things. One adds mileage and term versus the other is up
to miles/term. ... We will then need to adjust the filters in coverage
details and possibly the UI that normalizes the miles and term."

Today protection-portal treats every plan as if the value were a single
basis (effectively additive — `+24 mo`). This silently misrepresents
filed-rate plans by inflating the perceived coverage window.

## Decision

1. Canon `plan-mappings.json` introduces a `term_semantics` block keyed
   by `RegulatedRuleId` with optional override layer keyed by
   `ProductTypeCode`. Default basis when neither matches: `additive`.

2. `packages/integrations/product_admin/stoneeagle.js#normalizeToFixtureShape`
   surfaces `plan.term_basis: 'additive' | 'absolute'` per plan,
   resolved by:
   - if `term_semantics.by_product_type_code[code].basis` set → use it
   - else if `term_semantics.by_regulated_rule_id[id].basis` set → use it
   - else → `term_semantics._default_basis`

3. protection-portal consumers branch on `plan.term_basis`:
   - **PlanCard / RecommendedCoverage** display:
     - `additive` → `+{months} mo · +{miles} mi`
     - `absolute` → `Up to {months} mo · Up to {miles} mi`
   - **Coverage Details / Customize browser filter math**:
     - `additive` → compare against `(currentTerm + plan.term)`
     - `absolute` → compare against raw `plan.term`

4. The four canonical RegulatedRuleId defaults (subject to SE-doc/UAT
   verification, all flagged `_TODO` in canon):
   - `0` (free_markup) → additive
   - `3` (fixed_retail / filed) → absolute
   - `5` (capped_markup) → additive
   - `6` (finance_capped) → absolute

## Consequences

- Plan cards now visually distinguish coverage windows that previously
  looked identical, reducing customer confusion and agent
  follow-up questions.
- Coverage Details filter logic gets an explicit branch — testing must
  cover both bases per RegulatedRuleId.
- SE-doc / UAT verification is required to firm up the four defaults.
  Each entry carries a `_TODO` so the gap is visible.
- Future regulator regimes (new RegulatedRuleId values, custom
  ProductTypeCodes) extend canon without code changes.

## Findings (2026-05-10) — current `by_regulated_rule_id` defaults are wrong

User smoke against real OMGA UAT data observed an **"Omega EXCL Total
Miles"** plan rendering as `+72 mo / +100,000 mi` (additive on both
axes). User confirmed:

> "this is an example of a plan that covers to the term miles and the
> term months is from the new vehicle purchase date."

That makes the correct semantic for this plan **absolute on both axes,
measured from the original vehicle purchase date** — not additive.
Current canon resolves it via `RegulatedRuleId 0` (non-regulated free
markup) → `additive`, which is wrong.

When asked how the `by_regulated_rule_id` defaults were chosen, the
honest answer is: educated guesses. Every entry in canon
`plan-mappings.json#term_semantics.by_regulated_rule_id` carries
`_TODO: "confirm with SE doc..."` and the outer `_TODO` list also
flags them as "educated defaults pending SE-doc/UAT verification."

Two specific gaps the Omega EXCL Total Miles case exposed:

1. **`RegulatedRuleId` is NOT the right discriminator.** The basis is a
   property of the plan + contract, not the regulator regime. A single
   RegulatedRuleId value spans plans with different basis (a non-regulated
   "Add-On Miles" plan and a non-regulated "Total Miles" plan both have
   `regulated_rule_id = 0` but differ in basis).

2. **The two-state model (`additive | absolute`) is too coarse.** Real
   plans split into at least three semantics:
   - `additive` — value extends from contract start (display: `+24 mo`)
   - `absolute_from_contract` — cap from contract sale date (display: `Up to 36 mo from contract`)
   - `absolute_from_purchase` — cap from original vehicle purchase / in-service date (display: `Up to 72 mo from purchase`)

   Total Miles / Stated Coverage plans are `absolute_from_purchase` —
   different math from `absolute_from_contract` because filter logic
   needs to subtract the vehicle's in-service age, not just compare
   against contract elapsed time.

Plan-name pattern matching (`"Total Miles"`, `"Stated Coverage"`,
`"Add-On"`) is the natural reflex but **also wrong as a primary signal**
— plan names are inconsistent across TPAs and orgs. The authoritative
data lives in the **contract document** for each (TpaCode, ProductTypeCode,
PlanCode) triple.

## Backlog — authoritative term-semantics mapping

**Goal:** replace the current `_TODO`-flagged guesses with a
canon-driven mapping derived from real SE data + contract documents.
Do NOT make estimates based on product name.

**Planning step (when this wave is picked up):**

1. **Audit what SE GetRates actually surfaces.** Inspect a real
   GetRates response (real OMGA UAT — already wired via W21-fu) for
   every field that could carry term-basis signal:
   - PlanRate / Rate object fields (`TermType`, `MileageBasis`,
     `CoverageType`, anything we may have ignored when building
     `normalizeToFixtureShape`)
   - Plan / ProductType metadata
   - RuleType variants we haven't seen in fixtures
   - Any free-text `Description` / `CoverageDescription` field that
     contains "from purchase" / "additional" / "stated" hints
   Goal: find a structured signal we can read at runtime instead of
   guessing.

2. **Enumerate unique (TpaCode, ProductTypeCode, PlanCode) triples
   returned by SE for our active orgs.** Hit the proxy in dev mode
   across a representative VIN sweep (sedan, truck, SUV, FL contact,
   non-FL contact, varying ages) and collect the distinct plan codes.
   Expect on the order of dozens, not thousands — the canon
   `plan_overrides` block already shows the (TpaCode, ProductTypeCode,
   PlanCode) shape.

3. **For each unique plan code, pull the actual contract document.**
   Source paths: SEFI dealer portal, TPA contract templates kept in
   the integration-partners folder, or request directly from SEFI
   ops. Read the contract's coverage-period clause to determine:
   - Term basis: additive on contract / absolute from contract sale /
     absolute from vehicle purchase
   - Mileage basis: additive on current odometer / absolute total
     odometer
   - Where the "from" date lives (contract effective date vs vehicle
     in-service date)

4. **Build the authoritative mapping** keyed by (TpaCode,
   ProductTypeCode, PlanCode) — NOT by name pattern. Land it in
   canon `plan-mappings.json` either as a new top-level
   `term_semantics_by_plan_code` block or by extending the existing
   `plan_overrides` shape with `term_basis` + `miles_basis` fields.

5. **If step 1 finds a structured runtime signal**, prefer that over
   the per-plan-code mapping (smaller blast radius when SEFI adds new
   plans). If not, the per-plan-code mapping is the source of truth
   and a procedure for adding new codes (capture from prod, audit
   contract, append to canon) becomes the operational handoff.

6. **Schema migration:** extend the basis enum to three values
   (`additive | absolute_from_contract | absolute_from_purchase`)
   and split per-axis (`term_basis` and `miles_basis` independently).
   Update `stoneeagle.js#normalizeToFixtureShape`,
   `protection-portal/PlanCard` display copy, and Coverage Details
   filter math to handle the new basis. Display copy for the new
   value: "Up to {N} mo from purchase" (term) — miles unchanged from
   absolute display.

**Until that wave lands:** the current canon defaults are kept
intentionally — UI shows `+N mo / +N mi` for everything. That
mislabels filed-rate and Total Miles plans, but it's documented (here
and in canon `_TODO`s), it doesn't break wizard math (filter logic
has the same defect, so plans still appear in the list at the right
slider positions even if the labels are misleading), and we'd rather
ship a known guess than a wrong-but-believable name-pattern fake.

## Open questions

- Does any plan return BOTH additive and absolute rates within a
  single PlanRate.RateClass set? If so we need rate-class-level basis,
  not plan-level. (Initial assumption: no — basis is plan-wide.)
- Some plans return `999999` mileage as a sentinel for "monthly
  membership" (per Wave 22 backlog). That UX is its own track and
  should not be conflated with absolute basis.
