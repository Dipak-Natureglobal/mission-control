# Home Protection Plan — design spec

**Date:** 2026-08-25
**Status:** Approved (design); implementation plan not yet written
**Author:** coordinator session (blinker-platform)
**Cross-refs:** ADR 09 (protection billing config), ADR 11 (platform package layout), ADR 13 (StoneEagle integration), ADR 14 (term semantics), ADR 18 (plan catalog), ADR 24 (protection progress timeline), ADR 27 (contact-details gate + timeline actors), ADR 28 (monthly-membership VSC)
**Sources:** Basecamp TODO "Home Warranty support - AutoGuard - OMEGA" (`https://3.basecamp.com/4898365/buckets/41487717/todos/10224643560`); DocuSeal templates 182/184/185/186/187/188 at `https://docuseal.blinker-prod.com`

---

## 1. Summary

Add a **Home Protection Plan** as a new opportunity workflow type (`home_protection`), parallel to the existing auto protection workflow. It quotes OMEGA home-warranty products through the same StoneEagle `GetRates` service, using a home as the covered asset instead of a vehicle.

The consumer wizard lives in a **new sibling repo, `home-protection-portal/`**. Genuinely workflow-agnostic mechanics (payment schedule math, FluidPay tokenization, DocuSeal signing) are lifted into `blinker-platform/packages/` and shared with `protection-portal`; the screens themselves are not shared.

---

## 2. Product facts (verified 2026-08-25)

### 2.1 The GetRates call

Per the Basecamp TODO, a home quote is a normal `GetRates` SOAP call with home sentinel values in the vehicle slots:

```xml
<DealerNo>AUG2</DealerNo>
<NewUsed>*</NewUsed>
<VehicleYear>2025</VehicleYear>
<VehicleMake>HOME</VehicleMake>
<VehicleModel>HOME</VehicleModel>
<Trim></Trim>
<AssetType></AssetType>
<VehicleOdometer>0</VehicleOdometer>
```

`AMR2` and `AUG2` are seller codes for two different OMEGA seller organizations. `AUG2` carries **both** auto and home rates; `AMR2` carries auto only. This is **not** a per-product credential switch — `dealer_no` remains a single per-org value at `org.integrations.stoneeagle.credentials.{test,live}.dealer_no`. What distinguishes a home quote from an auto quote is the *request*, not the credentials.

**Square footage and year built are NOT inputs to GetRates.** They are captured for the agreement PDF and for eligibility only.

### 2.2 The six plans (Omega-J Home 2024, all `TpaCode=OMGA`, `ProductTypeCode=VSC`)

| PlanCode | PlanDescription | Structure | ContractType | Deductible | Terms | Cost/Remit | DocuSeal |
|---|---|---|---|---|---|---|---|
| 35 | OHC-J Term Deluxe | fixed term | 39 | $75 | 12 / 24 / 36 / 48 mo | $525 / $970 / $1,175 / $1,425 | 182 |
| 36 | OHC-J Term Deluxe Plus | fixed term | 39 | $75 | 24 / 36 / 48 mo | $990 / $1,325 / $1,570 | 184 |
| 37 | OHC-J Term Deluxe Enhanced | fixed term | 39 | $75 | 24 / 36 / 48 mo | $1,040 / $1,425 / $1,670 | 185 |
| 38 | OHC-J M2M Deluxe | month-to-month | 40 | $75 | 1–23 mo | $40/mo | 186 |
| 48 | OHC-J M2M Deluxe Plus | month-to-month | 40 | $75 | 1–23 mo | $44/mo | 187 |
| 49 | OHC-J M2M Deluxe Enhanced | month-to-month | 40 | $75 | 1–23 mo | $48/mo | 188 |

Tier ladder in both structures: **Deluxe → Deluxe Plus → Deluxe Enhanced** = good → better → best.
Note 36 and 37 have **no 12-month term**.
Service call fee is preprinted $75 on the agreement.

### 2.3 Add-ons (optional coverages)

Twelve canonical categories, returned as `<Option>` rows on term plans only:

Additional AC unit · Free-standing freezer · Garage door opener · Ice maker · Internal plumbing system · Programmable thermostat · Secondary refrigerator · Septic system · Spa · Swimming pool · Well pump · Wine cooler

Business rules from the Basecamp TODO:

- `OptionDesc` encodes both the category and the term: `"Plumbing system 3yr"`, `"Additional AC unit 4yr (P/E)"`.
- Term suffix maps to `ProductTerm`: `1yr`→12, `2yr`→24, `3yr`→36, `4yr`→48. **Only return add-ons whose term matches the selected plan term.**
- `(P/E)` and `(plus/enhanced)` mark the Plus/Enhanced variant. **Plan 35 takes the standard variants; plans 36 and 37 take the P/E variants only.**
- Plans **38 / 48 / 49 return no add-ons at all.**
- **No $0 / included add-ons exist** on any of the six plans.
- The raw `OptionDesc` list contains spelling and spacing variants for the same category (`AddlACunit` / `AdditionalACunit`, `Secondrefrigerator` / `Secondaryrefrigerator`, `SPA` / `Spa`). Matching must normalize.
- The response returns both Deluxe and Plus/Enhanced variants under the same term-plan rate records, so the application must select by `OptionId` + coverage level rather than rendering every `<Option>` returned.

Observed price matrix (standard / P-E), for sanity-checking the parser:

| Add-on | 12 mo Deluxe | 24 mo | 36 mo | 48 mo |
|---|---|---|---|---|
| Additional AC unit | $62 | $134 P/E | $168 / $192 P/E | $185 / $210 P/E |
| Free-standing freezer | $36 | $62 / $77 P/E | $93 / $112 P/E | $102 / $122 P/E |
| Garage door opener | $13 | $19 / $28 P/E | $26 / $32 P/E | $29 / $35 P/E |
| Ice maker | $10 | $13 / $16 P/E | $17 / $21 P/E | $19 / $23 P/E |
| Plumbing system | $57 | $101 / $122 P/E | $152 / $186 P/E | $167 / $203 P/E |
| Programmable thermostat | $32 | $54 / $68 P/E | $80 / $99 P/E | $88 / $108 P/E |
| Secondary refrigerator | $23 | $39 / $42 P/E | $56 / $66 P/E | $62 / $72 P/E |
| Septic | $6 | $7 / $10 P/E | $8 / $12 P/E | $9 / $13 P/E |
| Spa | $127 | $235 / $276 P/E | $360 / $415 P/E | $395 / $454 P/E |
| Swimming pool | $127 | $235 / $276 P/E | $360 / $415 P/E | $395 / $454 P/E |
| Well pump | $88 | $159 / $193 P/E | $245 / $287 P/E | $269 / $315 P/E |
| Wine cooler | $13 | $19 / $24 P/E | $27 / $33 P/E | $30 / $36 P/E |

These figures are illustrative of shape, not a pricing source of truth — prices come from the live response.

### 2.4 DocuSeal templates

All six templates share an **identical 37-field set**, so there is one field-mapping contract and the template id is selected by plan code.

```
ProductAgreementNumber, FirstName, LastName, Address1, City, State, Zip, Phone,
ProductTermMonths, ProductPurchaseDate, ProductEffectiveDate, ProductExpirationDate,
ProductPrice,
Deluxe(cb),
FreestandingFreezer(cb), ProgramableThermostat(cb), WellPump(cb), Spa(cb),
SwimmingPool(cb), InternalPlumbing(cb), GarageDoor(cb), AdditionalAC(cb),
IceMaker(cb), WineCooler(cb), SecondaryRefrigerator(cb), SepticSystem(cb),
SellerNameLegal, SellerAddress1, SellerCity, SellerState, SellerZip, SellerPhone, SellerCode,
SellerSignature, SellerSignatureDate, ConsumerSignature, ConsumerSignatureDate
```

`Deluxe` is always checked. The twelve add-on checkboxes map 1:1 to the twelve add-on categories.

### 2.5 The legacy "Add New Home" screen

For reference, the legacy Mission Control screen captured: Home Type (Single Family), Status, Existing Address picker, Address 1/2, City, State, Zip, Zip 4, Country, Purchase Price, Year Built (rendered as `2026 - 0 yrs old`), Square Feet, Disposition.

---

## 3. Locked decisions

| # | Decision |
|---|---|
| **D1** | `home` is a **first-class canon entity**, sibling to `vehicle` — not a workflow-local opportunity payload, and not a generalized polymorphic `asset`. |
| **D2** | A home attaches to a **household** and to **multiple contacts** (the agreement PDF has two holder slots). |
| **D3** | The wizard lives in a **new sibling repo `home-protection-portal/`**, per the mission-control "compose, don't reinvent" convention. |
| **D4** | Workflow-agnostic mechanics lift into `packages/` as they are built; screens stay per-repo. Portal→portal `file:` deps are forbidden. |
| **D5** | Add-on selection is **its own wizard step after plan selection** (`optional_coverages`), because add-on identity and price depend on both plan code and term. |
| **D6** | The higher-level "does the home have X" questions are a **separate, earlier step** (`home_features`), mirroring how auto's Modifications + Vehicle use feed add-on resolution. |
| **D7** | Add-on dollars **are included** in `paymentSchedule` and the charge — unlike auto, where passthrough totals are display-only. |
| **D8** | DocuSeal is built **once**, in `packages/integrations/signing/docuseal.js`, and serves both auto and home. |
| **D9** | `dealer_no` remains a single per-org value. Home capability is expressed by an explicit per-org `opportunities.home_protection.enabled` toggle, not inferred from the rate set. |

---

## 4. Data model

### 4.1 The `home` entity

```js
home {
  id, org_id,
  household_id,                  // household attachment
  contact_ids: [ … ],            // multiple — two agreement-holder slots on the PDF
  primary_contact_id,
  home_type: 'single_family' | 'townhome' | 'condominium',
  address: { address1, address2, city, state, zip, zip4, country },
  year_built:     integer,
  square_feet:    integer,
  purchase_price: number | null,
  disposition:    string | null,
  source:         'manual',
  created_at, updated_at
}
```

Contacts gain a parallel `homes[]` array alongside `vehicles[]`. Opportunities gain `home_id`.

`contact_ids` as an array is the one place `home` genuinely diverges from `vehicle`, which hangs off a single contact's `vehicles[]`.

### 4.2 Derived `dwelling_class`

The agreement PDF's dwelling checkbox is a five-way bucket over `(home_type × square_feet)`:

| bucket | rule |
|---|---|
| `sf_lt_5000` | single_family, < 5,000 sq ft |
| `sf_5000_8000` | single_family, 5,000–8,000 sq ft |
| `sf_8001_12000` | single_family, 8,001–12,000 sq ft |
| `townhome_lt_5000` | townhome, < 5,000 sq ft |
| `condo_lt_5000` | condominium, < 5,000 sq ft |

Computed by a new `packages/utils/dwelling-class.js`, canon-driven — the structural twin of `vehicle-class.js`.

**Eligibility consequence:** a townhome or condominium over 5,000 sq ft, or a single-family over 12,000 sq ft, falls into no bucket. Treat as **ineligible** and stop at `home_add` rather than quoting.

> This eligibility rule is **inferred from the form's bucket list**, not stated by Omega. Confirm with product before treating it as authoritative. Per the canon-`_TODO` convention, prefer a null/blocked outcome over a wrong-but-believable bucket.

---

## 5. Canon changes

### `blinker-domain.json`
- New `home` entity block (§4.1).
- `opportunity.workflow_type` gains `'home_protection'`.
- `opportunity` gains `home_id`.

### `ghl-status.json`
- New top-level `home_protection` block, cloned from `vsc` **minus** the VIN-validation and rates-changed statuses.
- Each status carries an `actor` value (`agent` | `consumer` | `system`) per ADR 27.

### `plan-mappings.json`
- `plan_catalog` gains six home entries (`OMGA::VSC::35/36/37/38/48/49`) with `plan_level`, `plan_title`, and `docuseal_template_id` per §2.2/§2.4.
- **Two new catalog fields:** `asset_kind: 'vehicle' | 'home'` and `program_code` (e.g. `'OHC-J'`). Existing auto entries are backfilled `asset_kind: 'vehicle'`.
- `resolvePlanPresentation()` accepts an optional `assetKind` filter.
- The three-part key `${tpa}::${ptc}::${plan_code}` is retained — the auto (40/41/42/51/66–83/R6) and home (35/36/37/38/48/49) code sets are disjoint today. A **fourth key segment is the documented escape hatch** if a real collision ever appears.
- New `home_dwelling_classes` block — the §4.2 bucket table.
- New `home_add_ons` block — the twelve canonical categories, their `OptionDesc` match aliases, the term-suffix map (`1yr`→12 … `4yr`→48), the `(P/E)` / `(plus/enhanced)` variant markers, the per-plan variant rule (35 → standard, 36/37 → P/E, 38/48/49 → none), and the DocuSeal checkbox field name per category.
- `monthly_membership` gains a co-authoritative `contract_type_allowlist: [40]` alongside `sentinel_mileage` — see §11 R1.

### `org-registry.json`
- New `home_protection_billing` block, separate from `protection_billing` (different product, different margins). Per the Basecamp TODO:
  - `markup.fixed_term_dollars` / `markup.florida_fixed_term_dollars`
  - `markup.monthly_dollars` / `markup.florida_monthly_dollars`
  - EFS allowable payment terms (`payment_term.options_months`, `default_months`)
  - EFS down-payment requirements (`down_payment.*`)
  - `discount` cap set
- New `opportunities.home_protection.enabled` toggle (D9).
- **No credentials change.**

### `_version`
Bumped; `scripts/sync-canon-into-apps.sh` run across all child apps plus the new portal.

---

## 6. `home-protection-portal/`

New sibling repo on the locked substrate (Vite + React 19 + JS, no TS, lucide-react), mirroring `protection-portal`'s shell: `ViewSwitcher` reading `?view=customer|agent|partner`, a `HomeWizard` owning `stepIdx` as a plain integer with `buildSteps(form)` splicing conditionals, `useForm`, and a `HomeProtectionDevControls`. Takes `file:../blinker-platform`.

Mission-control adds `file:../home-protection-portal` and imports `HomeAgentView` **lazily** (matching refi/insurance, not protection's eager import).

### 6.1 Steps

```
home_add              Add home             — type, address, year built, sq ft, purchase price;
                                             eligibility gate; fires GetRates
home_features         Home features        — the twelve "does the home have X" questions
recommended_coverage  Recommended coverage — good/better/best; global term ↔ monthly switch
[customize]           Customize            — conditional, as in auto
optional_coverages    Optional coverages   — priced add-ons, filtered by plan code + term;
                                             skipped for 38/48/49
confirm               Review & confirm     — totals include add-ons
billing_payment       Billing & payment
docuseal              Sign agreements      — real integration
thank_you             Complete
```

Dropped from the auto sequence: `vehicle_add`, `vehicle_drive`, `vehicle_use`, `vin_validate`, `rates_changed` (no VIN divergence path exists for a home), and `garage_location` — the address is collected on `home_add`, and `<State>` is the only location input `GetRates` takes, so rates can fire there.

### 6.2 Form shape

Workflow-agnostic keys carry over unchanged from `protection-portal`'s `INITIAL_FORM`: `org_id`, `contact`, `rates`, `selectedPlan`, `payment`, `paymentSchedule`, `status`, `opportunityId`, `completedAt`, `docusealCompleted`.

Vehicle-shaped keys are replaced by:

```js
home:           { id, home_type, address:{…}, year_built, square_feet,
                  purchase_price, dwelling_class },
homeFeatures:   { pool, spa, well_pump, septic, garage_door_opener,
                  secondary_refrigerator, wine_cooler, freestanding_freezer,
                  ice_maker, additional_ac, programmable_thermostat,
                  internal_plumbing },
coverageTerm:   12 | 24 | 36 | 48 | null,      // null in monthly mode
selectedAddOns: [ { key, option_id, name, price } ],
```

Step ids are home nouns; telemetry is namespaced `home_protection.customer.<step>.<verb>`.

---

## 7. Rating

### 7.1 Request

New export `getRatesForHome(input, ctx)` in `packages/integrations/product_admin/stoneeagle.js`, beside `getRatesWithVehicleClass`. It calls `getRatesSingle` **once** — the new/used fan-out and `classifyVehicle` are bypassed entirely, since a home has no new/used axis.

`buildSoapEnvelope` gains an asset-kind branch emitting the §2.1 values verbatim. Two existing behaviors block this and must be made expressible:

- `AssetType` currently **defaults to `'P'`** when absent (`stoneeagle.js:248-250`). Home requires it emitted **empty**.
- `NewUsed` is currently coerced to `N` or `U` with no `*` path (`stoneeagle.js:235-237`).

`<State>` is still sent, sourced from the home address, since filed rates are state-driven.

### 7.2 Normalization

`normalizeToFixtureShape` gains a home branch:

- **Term plans (35/36/37, ContractType 39)** — one product per `(plan_code, term)`, `mileage: null`, flat $75 deductible, `billing_model: 'term_total'`. No mileage axis.
- **M2M plans (38/48/49, ContractType 40)** — ADR 28's `billing_model: 'monthly_subscription'` path.
- `<Option>` rows are parsed into the home add-on catalog per the canon `home_add_ons` rules and attached to their term product.

### 7.3 Plan selection

Home tiering is substantially simpler than auto, and this is why D4's lift is small. There is **no** term/mileage optimizer, **no** `classifyAsNew`, **no** new/used preference, **no** deductible filter, and **no** tier borrowing. Tier comes straight from `plan_catalog.plan_level`.

So home needs term selection plus a catalog lookup — not the five-phase engine in `protection-portal/src/lib/plan-selector.js`. What actually lifts into `packages/` is the Confirm payment-schedule math, FluidPay tokenization, and DocuSeal.

`recommended_coverage` reuses ADR 28's global term ↔ monthly switch: term mode shows 35/36/37 at the chosen coverage term; monthly mode shows 38/48/49.

---

## 8. Add-ons and signing

### 8.1 `home_features`

Twelve yes/no questions writing booleans into `form.homeFeatures`. No prices, no plan dependency — runs before rating, exactly as Modifications and Vehicle use do in auto.

### 8.2 `optional_coverages`

Resolves those answers against the actual `<Option>` rows for the chosen plan:

1. Parse each `OptionDesc` into `{ canonical_key, term_years, variant }` via the canon `home_add_ons` rules — `"Plumbing system 3yr (P/E)"` → `{ internal_plumbing, 3, 'pe' }`.
2. Keep rows where `term_years * 12 === selected ProductTermMonths`.
3. Keep the variant the plan allows — 35 → standard, 36/37 → P/E only.
4. Pre-check whatever `homeFeatures` answered yes; the customer may toggle anything on or off.
5. Running total; selections write `selectedAddOns[]` with the resolved `option_id` and price.

Skipped entirely for 38/48/49.

Implemented as `packages/utils/home-addons.js` (parser + resolver), the home analog of `protection-addons.js`.

### 8.3 Confirm

`total_cost = plan.total_cost + Σ selectedAddOns.price`, flowing into the discount math, down payment, EFS schedule, and the charge. **This differs from auto**, where `buildPassthroughForPlan` totals are display-only and never reach `paymentSchedule`.

Monthly mode branches on `isMonthly` exactly as ADR 28 D6 specifies: due-today is the monthly charge, no down payment, no months-to-pay.

**Invalidation rule.** Changing plan or term invalidates every add-on selection, because both `option_id` and price change (plumbing is $57 at 1yr but $152/$186 at 3yr). Selections must be re-resolved by `canonical_key` and re-priced on any flip — never carried forward. This is the same stale-state shape Wave 38 hit when flipping term ↔ monthly.

### 8.4 DocuSeal

New `packages/integrations/signing/docuseal.js` — the first real signing integration, consumed by both portals.

Template id resolves through the existing `resolvePlanPresentation().docusealTemplateId` (org override → catalog → org default), which is implemented today but read by nothing. Catalog seeds: 35→182, 36→184, 37→185, 38→186, 48→187, 49→188.

`buildSubmissionFields(form)` produces the 37-field map:

| Field(s) | Source |
|---|---|
| `FirstName`, `LastName`, `Phone` | primary contact |
| holder address block | contact mailing address |
| covered-property address block | `home.address` |
| `ProductTermMonths` | `coverageTerm` (or elected M2M months) |
| `ProductPurchaseDate` | sale date |
| `ProductEffectiveDate` | from GetRates if returned, else sale date |
| `ProductExpirationDate` | effective date + term months |
| `ProductPrice` | plan total + add-ons |
| `Deluxe` | always `true` |
| twelve add-on checkboxes | `selectedAddOns` |
| `Seller*` | org record |
| `ProductAgreementNumber` | eContracting (not built — Phase 1 placeholder) |
| signatures | DocuSeal roles |

**Required template changes** (assumed in hand per the approved design):

1. **Dwelling-type checkbox** — the five-way bucket is printed on the form but is not a mapped field.
2. **Square feet** — printed, not mapped.
3. **Second agreement holder** name and phone — the entity supports two contacts, the field set has one.
4. **Address disambiguation.** The field list contains `Address1`, `City`, `State`, `Zip` **twice each under the same names**, but the form has two distinct addresses (Agreement Holder mailing vs. Covered Property). Same-named DocuSeal fields share a value, so the two addresses collide. The property set needs distinct names (`PropertyAddress1`, `PropertyCity`, `PropertyState`, `PropertyZip`). **This is a live defect, not merely a gap.**
5. `AgreementRenewalDate` — printed, unmapped; may be intentionally N/A for fixed term.

---

## 9. Mission-control

One more entry in each existing registry:

- `resolveEmbedKind` + a `HomeProtectionEmbed` wrapper
- `TYPE_LABELS`, `TYPE_BADGE`, `TYPE_TILE_ICON` (House)
- `OpportunityTypeMenu`, `StartOpportunityFlow` — its vehicle step becomes a home step (pick existing home, or add one)
- `lookupStage` → the new canon `home_protection` block
- `AgentInbox`, `GlobalSearch`, `AgentContacts` type enums and status groups
- `buildNewOpp` home branch; `appendHomeToContact` in `session-data.js`
- `AdvancedFilter` gains a `'home'` level
- `PlanCatalog` gains an `asset_kind` column / filter
- new `OrgConfigSections/HomeProtection.jsx` (super) + read-only mirror in `admin/OrgConfiguration.jsx`

Structurally new surfaces:

- **Home card** in the CoPilot left rail beside the Vehicle card (address, year built, sq ft, dwelling class)
- **Homes section** on `ContactProfile` beside Vehicles
- `RelatedHomeProtectionProgress.jsx` with its own `STEP_LABEL` map — which must be added in **both** places mc keeps that map: `RelatedProtectionProgress.jsx:133` and `CoPilotPane.jsx:1586`

---

## 10. Phasing

**Phase A — coordinator, direct.**
ADR 30; all canon changes (§5); `packages/utils/dwelling-class.js`; `packages/utils/home-addons.js`; `getRatesForHome` + the `buildSoapEnvelope` asset branch + the normalizer home path; `packages/integrations/signing/docuseal.js`; canon sync.

**Phase B — `home-protection-portal/`, dispatched.**
New repo; the nine steps; add-on picker; Confirm with add-on-inclusive totals; DocuSeal wired to the real integration.

**Phase C — mission-control, dispatched.**
Everything in §9.

A gates both. B and C touch disjoint repos, but C imports B's export surface, so they run sequentially, not in parallel.

---

## 11. Open risks

| # | Risk | Resolution path |
|---|---|---|
| **R1** | **No real AUG2 `GetRates` capture exists.** Unverified: whether M2M plans carry ADR 28's `999999` mileage sentinel, the actual `<Option>` payload shape, where `ContractType` sits in the response, and whether `ProductEffectiveDate` is returned by SE. | One live call through the `/se-rating` proxy closes all four. Per the fixture-shape lesson, the regression fixture must be **that exact response**, not a synthetic one. Until then, treat `contract_type_allowlist: [40]` as co-authoritative with the sentinel. |
| **R2** | **Dwelling eligibility (§4.2) is inferred** from the PDF's bucket list, not stated by Omega. | Confirm with product. Prefer blocking over a wrong bucket. |
| **R3** | **Two-holder persistence has no Phase-1 target** — same gap as `buildHouseholdRelationship` in Wave 37 (console + telemetry only). | Deferred to Phase 2 data layer. |
| **R4** | **`ProductAgreementNumber` comes from eContracting**, which is not built. | Phase 1 placeholder. |
| **R5** | **DocuSeal template changes (§8.4) are assumed done.** Item 4 is a live defect that will silently write one address into both slots if unfixed. | Verify field names against the live templates before Phase B's DocuSeal wiring is considered complete. |
| **R6** | **Add-on prices in §2.3 are illustrative**, transcribed from a screenshot. | Never hard-code; always read from the live response. |
