# 29 — Home Protection Plan (Omega-J Home 2024)

**Date:** 2026-08-25
**Status:** Active
**Supersedes:** —
**Cross-refs:** ADR 09 (protection billing config), ADR 11 (platform package layout), ADR 13 (StoneEagle integration), ADR 14 (term semantics), ADR 18 (plan catalog), ADR 24 (protection progress timeline), ADR 27 (contact-details gate + timeline actors), ADR 28 (monthly-membership VSC)

**Spec:** `docs/superpowers/specs/2026-08-25-home-protection-plan-design.md`
**Plan:** `docs/superpowers/plans/2026-08-25-home-protection-plan.md`

## Context

OMEGA sells a home-warranty product line — the **Omega-J Home 2024** program — through the same StoneEagle `GetRates` SOAP operation that already serves the auto protection workflow. A home quote is addressed by putting HOME sentinel values in the vehicle slots of an otherwise ordinary request: `VehicleMake` and `VehicleModel` are the literal string `HOME`, `VehicleYear` is `2025`, `Trim` and `AssetType` are empty, `VehicleOdometer` is `0`, and `NewUsed` is `*` rather than `N` or `U`. The seller code decides whether home rates are available at all: `AUG2` carries both auto and home rates, `AMR2` carries auto only. This is a property of the seller organization, not a per-product credential switch.

Six plans come back, all under `TpaCode=OMGA` and `ProductTypeCode=VSC`, in two structures. Plans **35 / 36 / 37** are fixed-term (`ContractType 39`) at 12/24/36/48 months — though 36 and 37 have no 12-month option. Plans **38 / 48 / 49** are month-to-month (`ContractType 40`) over 1–23 months at $40 / $44 / $48 per month. Both structures carry the same three-rung ladder: Deluxe → Deluxe Plus → Deluxe Enhanced, which maps onto the platform's existing good / better / best vocabulary. Every plan carries a flat $75 deductible and a preprinted $75 service call fee.

The auto protection workflow cannot absorb this. Four things differ at the root. The **asset** is a home, not a vehicle — no VIN, no mileage, no new/used axis, and therefore no VIN-validation or rates-changed path. **Eligibility** is a dwelling-type × square-footage matrix rather than an age/mileage gate. The **add-on model** inverts: auto add-ons are passthroughs triggered by wizard answers and rendered as display-only badges, whereas home optional coverages are customer-selected priced line items whose identity and price both depend on the chosen plan code and term. And the **agreement set** is six distinct DocuSeal templates with a field set the auto workflow has never needed — twelve coverage checkboxes, a dwelling-type checkbox, and two agreement-holder slots.

## Decisions

### D1 — `home` is a first-class canon entity

A home is modeled as a canon entity sibling to `vehicle`, not as a workflow-local payload on the opportunity and not as a generalized polymorphic `asset`.

A home is durable and re-quotable. It survives the opportunity that first captured it, it can be re-rated at renewal, and it can carry more than one agreement over its life — exactly the properties that made `vehicle` an entity rather than a form blob. Burying it in `opportunity.home` would make a second home-protection opportunity for the same property re-capture everything, and would leave mission-control with nothing to render on a contact profile.

Generalizing `vehicle` and `home` into a single `asset { asset_kind }` was considered and rejected as premature. It would touch every vehicle call site in three repos — `ContactProfile`'s Vehicles section, `AdvancedFilter`'s `'vehicle'` level, `CoPilotPane`'s vehicle resolution and left-rail card, `session-data`'s append/merge helpers — for no benefit the two-entity model does not already deliver. A fourth asset kind is the point at which that trade flips.

Contacts gain a `homes[]` array alongside `vehicles[]`. Opportunities gain `home_id`. The full shape lives in `canon/blinker-domain.json#home`.

### D2 — A home attaches to a household and to multiple contacts

Unlike `vehicle`, which hangs off a single contact's `vehicles[]`, a home carries `household_id` and a `contact_ids[]` array with a `primary_contact_id` naming the first holder.

This is driven by the product, not by taste: the Omega home agreement has **two** agreement-holder slots. A married couple, or a parent and adult child on the same deed, are both holders of one agreement on one property. A single-owner model would force the second holder to be dropped or faked.

`primary_contact_id` must appear in `contact_ids`. Order within the array is not significant.

Phase 1 has no persistence target for the second-holder relationship, the same gap `buildHouseholdRelationship` carries from ADR 27 — it is captured and rendered but not written to a relationship store until the Phase 2 data layer lands.

### D3 — The wizard lives in a new sibling repo `home-protection-portal/`

The consumer wizard is a new sibling repo on the locked substrate, whose `AgentView` mission-control imports the way it imports `protection-portal`, `insurance-portal`, and `refi-portal`.

This follows the standing convention in `mission-control/CLAUDE.md` — "compose, don't reinvent": a new opportunity type arrives as a new `*-portal`, not as a second workflow bolted into an existing one. The alternative considered was a `src/views/customer/home/` fork inside `protection-portal`, which would have shared more code in-repo but would have made a single repo the home of two independent opportunity types, diverging from every other workflow on the platform and complicating the embed contract mission-control depends on.

The import is **lazy** (`React.lazy`), matching refi and insurance. Only protection is imported eagerly, because it is the dominant workflow.

### D4 — Workflow-agnostic mechanics lift into `packages/`; screens do not

D3 isolates the wizard but leaves the shared product mechanics — payment scheduling, tokenization, signing — needing a home. They lift into `blinker-platform/packages/` as they are built. Screens stay per-repo.

Portal→portal `file:` dependencies are forbidden. A dep from `home-protection-portal` to `protection-portal` would be cheaper than a lift, but it would make `protection-portal` a de-facto library with no export contract and invert the dependency direction ADR 11 exists to protect.

Concretely, what lifts is `packages/utils/dwelling-class.js`, `packages/utils/home-addons.js`, and `packages/integrations/signing/docuseal.js`. What does **not** lift is `plan-selector.js`: home tiering has no term/mileage optimizer, no `classifyAsNew`, no new/used preference, no deductible filter, and no tier borrowing, so the five-phase auto engine has almost no surface in common with what home needs. Home reads `plan_catalog.plan_level` directly.

### D5 — Add-on selection is its own post-plan-selection step

Optional coverages get a dedicated wizard step, `optional_coverages`, inserted after `recommended_coverage` (and after `customize` when that conditional runs) and before `confirm`.

It cannot come earlier. An add-on's `OptionId` and its price both depend on the selected plan code **and** the selected term: internal plumbing is $57 at 12 months, $152 at 36 months on plan 35, and $186 at 36 months on plans 36/37. Neither is known before a plan and term are chosen.

The step is dropped entirely for plans 38 / 48 / 49, which return no options at all — so `optional_coverages` is a conditional step in `buildSteps`, not a base one.

### D6 — The "does the home have X" questions are a separate earlier step

A `home_features` step runs before rating and asks the twelve higher-level questions — does the home have a pool, a well, a septic system, a second refrigerator — writing booleans into `form.homeFeatures`.

This mirrors how auto works today: Modifications and Vehicle use ask higher-level questions that map to add-ons, rather than presenting a raw add-on catalog. Those answers then pre-check the priced picker in D5, which the customer can still override in either direction.

The questions are rendered from `canon/plan-mappings.json#home_add_ons.categories`, never hard-coded, so a change to the covered categories is a canon edit.

### D7 — Add-on dollars are included in `paymentSchedule` and the charge

`total_cost = plan.total_cost + Σ selectedAddOns.price`, and every downstream figure — the discount ceiling, the down payment, the monthly payment, the amount due today, the amount charged — derives from that total.

This is a real divergence from auto, where `buildPassthroughForPlan`'s `totalDelta` reaches `PlanCard` for display and never reaches `paymentSchedule`, FluidPay, or the completion record. Home optional coverages are things the customer chose and will be billed for, so they must be in the money path.

The consequence is an invalidation rule. Because both `option_id` and price move when the plan or term changes, prior selections must be re-resolved by canonical key and re-priced on any flip — never carried forward. Carrying a stale selection forward would charge the wrong amount against a signed agreement. `revalidateSelections` in `packages/utils/home-addons.js` owns this.

### D8 — DocuSeal is built once in `packages/integrations/signing/docuseal.js`

Signing is implemented as a shared platform integration, not inside either portal.

Today `protection-portal/src/views/customer/DocuSeal.jsx` is a placeholder: a static box, a button that sets local state, no template resolution and no payload. `resolvePlanPresentation()` has returned a `docusealTemplateId` since ADR 18 and nothing has ever read it. Home is the first workflow that genuinely needs signing, so building it inside `home-protection-portal` would put the platform's only real signing client somewhere auto can never reach it — and auto would then need it built a second time.

All six home templates share an **identical 37-field set**, so there is one field-mapping contract and the template id is selected purely by plan code: 35→182, 36→184, 37→185, 38→186, 48→187, 49→188. Template id resolution reuses the existing `resolvePlanPresentation` precedence (org override → catalog → org default) with no new resolution logic.

### D9 — `dealer_no` stays a single per-org value; home capability is an explicit toggle

Because `AUG2` and `AMR2` are seller codes for different OMEGA seller organizations rather than per-product programs, `dealer_no` remains a single value at `org.integrations.stoneeagle.credentials.{test,live}.dealer_no`. No credentials schema change.

Home capability is therefore **declared, not inferred**: a per-org `opportunities.home_protection.enabled` toggle gates whether mission-control offers the workflow. Inferring it from whether a rate set comes back would mean discovering an org cannot sell home protection only after an agent has started an opportunity and received an empty quote.

Home margins live in a separate `home_protection_billing` block rather than extending `protection_billing` — a different product line with different margins, different EFS terms, and different discount caps.

## Open risks

**R1 — No real AUG2 `GetRates` capture exists.** Four things are unverified: whether the month-to-month plans carry ADR 28's `999999` mileage sentinel (a home request sends `VehicleOdometer 0` and has no mileage axis, so they may not), the actual `<Option>` payload shape, where `ContractType` sits in the response, and whether `ProductEffectiveDate` is returned by StoneEagle at all. One live call through the `/se-rating` proxy closes all four. Until then `contract_type_allowlist: [40]` and `sentinel_mileage` are **co-authoritative** — either firing flags `billing_model: 'monthly_subscription'`. The synthetic fixture exists only to build and smoke the UI; per the fixture-shape lesson, the regression fixture must eventually be that exact captured response.

**R2 — Dwelling eligibility is inferred, not stated.** The five-bucket matrix and the resulting "over the ceiling means ineligible" rule are read off the printed bucket list on the agreement PDF. Omega has not stated it. Confirm with product. Until then `classifyDwelling` returns `null` rather than guessing a bucket, and a `null` blocks the quote — preferring a blocked flow over a wrong-but-believable checkbox on a signed agreement.

**R3 — Two-holder persistence has no Phase-1 target.** `contact_ids[]` is captured and rendered but not written to a relationship store, the same gap ADR 27 left for `buildHouseholdRelationship`.

**R4 — `ProductAgreementNumber` comes from eContracting**, which is not built. Phase 1 emits an empty string.

**R5 — The DocuSeal templates need changes, and one is a live defect.** *(ACCEPTED AS-IS 2026-08-25 — deferred to engineering at prototype handoff. The payload is written against the corrected names, so this is inert until live mode is enabled; it MUST be fixed before any live submission.)* Four gaps: the dwelling-type checkbox and square footage are printed but not mapped fields; there is no second-agreement-holder field set; and — the defect — the field list contains `Address1`, `City`, `State`, and `Zip` **twice each under identical names**, while the form has two distinct addresses (Agreement Holder mailing vs. Covered Property). Same-named DocuSeal fields share a value, so unfixed, both addresses receive the same string. The property set needs distinct names (`PropertyAddress1`, `PropertyCity`, `PropertyState`, `PropertyZip`). The field mapping in `packages/integrations/signing/docuseal.js` is written against the corrected names and its tests assert them.

**R7 — Home rating requires a seller code that carries home rates.** *(RESOLVED 2026-08-25.)* `AUG2` returns both auto and home rate sets; Apex 102's `AMR2` returns auto only, so a real home `GetRates` from Apex comes back empty and reads as a broken rating path rather than a config gap. Canon adds org **200 "AutoGuard"** with `dealer_no: AUG2` and `home_protection.enabled: true` — that is the org to run live or proxy-mode home captures from. Apex keeps home enabled so the seeded fixture opportunities still demo, and its `home_protection_billing` carries a `_dealer_no_warning`. Note `getRatesProxy` reads `credentials.test` unconditionally (`resolveTestCredentialsForOrg` is not gated on `test_mode`), so the test block is what a proxy call sends.

**R8 — RESOLVED 2026-08-25 (user decision): Home protection is now the fifth card in the Start-opportunity dialog.** `StartOpportunityFlow.jsx` gains an org-gated `home_protection` card (shown only where `opportunities.home_protection.enabled`) and a **home asset step** parallel to `VehicleStep`: pick one of the contact's existing homes, add one via the existing `AddHomeModal` (which never fires GetRates), or skip and let the portal's `home_add` step capture it. The created opportunity carries `home_id`, never `vehicle_id`. Verified end-to-end in the browser: picking Maria Alvarez's 412 Cypress Ln produced `{ type: 'home_protection', home_id: 'home_alvarez_cypress', status: 'Empty', vehicle: null }`, the CoPilot left rail rendered the Home card with its dwelling class, and the lazy portal embed mounted.

`OpportunityTypeMenu` deliberately does **NOT** list home protection. Its two consumers — ContactProfile's header CTA and the per-vehicle dropdown — route through `NewOpportunityFlow`, which has zero `home_protection` / `home_id` handling, so an entry there would produce a malformed vehicle-shaped opportunity. Making that menu asset-aware means rebuilding `NewOpportunityFlow`; until then ContactProfile's Homes section ("Add home" → home card → "Start home protection") is its supported path.

**R6 — Published add-on prices are illustrative.** The price matrix transcribed from the Basecamp screenshots documents shape, not truth. Prices are always read from the live or fixture response, never hard-coded.

## Affected surfaces

**Coordinator (`blinker-platform`):**
`canon/blinker-domain.json` (+`home` entity, `home_protection` workflow type, `home_id`), `canon/ghl-status.json` (+`home_protection` status block with `actor`), `canon/plan-mappings.json` (+six home `plan_catalog` entries, `asset_kind`/`program_code` on all entries, `home_dwelling_classes`, `home_add_ons`, `monthly_membership.contract_type_allowlist`), `canon/org-registry.json` (+`home_protection_billing`, `opportunities.home_protection.enabled`), `canon/_version`; `packages/utils/dwelling-class.js`, `packages/utils/home-addons.js`; `packages/integrations/product_admin/stoneeagle.js` (home SOAP branch, home normalizer path, `getRatesForHome`), `packages/integrations/product_admin/_fixtures/stone-eagle-get-rates-home.json`; `packages/integrations/signing/` (new category); `packages/api/homes.js` + `_fixtures/homes.json`; `scripts/sync-canon-into-apps.sh`.

**`home-protection-portal` (new):**
`src/views/customer/` — `CustomerView.jsx`, `HomeAdd.jsx`, `HomeFeatures.jsx`, `RecommendedCoverage.jsx`, `Customize.jsx`, `OptionalCoverages.jsx`, `Confirm.jsx`, `BillingPayment.jsx`, `DocuSeal.jsx`, `ThankYou.jsx`; `src/views/agent/AgentView.jsx`; `src/lib/home-plan-selector.js`, `src/lib/status-step-map.js`; `src/components/PlanCard.jsx`; `src/shell/`.

**`mission-control`:**
`src/components/CoPilotPane.jsx` (type registry, `HomeProtectionEmbed`, left-rail Home card, both step-label maps, both timeline mounts), `src/components/RelatedHomeProtectionProgress.jsx` (new), `src/components/AddHomeModal.jsx` (new), `src/lib/canon.js`, `src/lib/status-mapping.js`, `src/lib/session-data.js`, `src/lib/active-workflow.js`, `src/shared/AdvancedFilter.jsx`, `src/shared/AgentMetricsGrid.jsx`, `src/personas/agent/{AgentInbox,AgentContacts,ContactProfile}.jsx`, `src/personas/manager/{ManagerHome,AgentProfile}.jsx`, `src/personas/admin/{PlanCatalog,OrgConfiguration}.jsx`, `src/personas/super/OrgConfigSections/HomeProtection.jsx` (new), `src/components/{OpportunityTypeMenu,StartOpportunityFlow}.jsx`, `src/shell/GlobalSearch.jsx`, `src/App.jsx`.
