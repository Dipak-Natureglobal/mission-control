# Home Protection Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `home_protection` opportunity workflow that quotes OMEGA home-warranty products through StoneEagle GetRates, prices customer-selected optional coverages, and signs the correct one of six DocuSeal agreements.

**Architecture:** Three phases across three repos. Phase A lands canon contracts and shared platform code in `blinker-platform` (coordinator-direct). Phase B builds a new sibling repo `home-protection-portal/` holding the nine-step consumer wizard. Phase C threads the new opportunity type through `mission-control`. A gates B; B gates C.

**Tech Stack:** Vite + React 19 + JavaScript (no TypeScript) + lucide-react. Node built-in test runner (`node --test`). Canon JSON contracts. StoneEagle SOAP `GetRates`. DocuSeal REST.

**Spec:** `docs/superpowers/specs/2026-08-25-home-protection-plan-design.md` — read it before starting any task. Decisions D1–D9 and risks R1–R6 are binding.

## Global Constraints

- No TypeScript. Plain `.js` / `.jsx` with JSDoc types.
- `packages/*` MAY read `../../canon/*.json` and MAY import sibling packages. `packages/*` MUST NOT import from any child app. Portal→portal `file:` deps are forbidden (spec D4).
- Every canon edit bumps `canon/_version` and runs `scripts/sync-canon-into-apps.sh`.
- Tests use the Node built-in runner: `node --test <path>`. No Jest, no Vitest in `blinker-platform`.
- Never run `npm run dev` or `npm install` between commits inside a dispatched agent — long-running commands trigger a sandbox kill.
- Add-on prices are NEVER hard-coded. They come from the live/fixture GetRates response (spec R6).
- Tier vocabulary is `good` | `better` | `best`. Deluxe→good, Deluxe Plus→better, Deluxe Enhanced→best.
- Plan catalog key format stays three-part: `` `${tpa_code}::${product_type_code}::${plan_code}` ``.
- Telemetry event namespace for the new workflow: `home_protection.<surface>.<step>.<verb>`.
- Any tooltip uses the custom `Tooltip` pattern (trigger ref + `getBoundingClientRect` + `position: fixed`). Native `title=` is banned.

---

# PHASE A — coordinator (blinker-platform), direct

Executed in the `blinker-platform` repo by the coordinator session. Gates Phases B and C.

---

### Task A1: ADR 30

**Files:**
- Create: `architecture/30-home-protection-plan.md`
- Modify: `CLAUDE.md` (architecture index, after the line for `28-monthly-membership-vsc.md`)

**Interfaces:**
- Consumes: nothing.
- Produces: the decision reference every later task cites. Decisions are numbered `D1`–`D9` matching the spec.

- [ ] **Step 1: Write the ADR**

Create `architecture/30-home-protection-plan.md` with this structure, transcribing decisions D1–D9 and risks R1–R6 verbatim from `docs/superpowers/specs/2026-08-25-home-protection-plan-design.md`:

```markdown
# 29 — Home Protection Plan (Omega-J Home 2024)

**Date:** 2026-08-25
**Status:** Active
**Supersedes:** —
**Cross-refs:** ADR 09, ADR 11, ADR 13, ADR 14, ADR 18, ADR 24, ADR 27, ADR 28

## Context

[Two paragraphs: OMEGA sells a home-warranty line through the same StoneEagle
GetRates service, addressed by putting HOME sentinels in the vehicle slots.
Six plans, two structures (fixed term / month-to-month), three tiers each.
The auto protection workflow cannot absorb this because the asset, the
eligibility rules, the add-on model, and the agreement set all differ.]

## Decisions

### D1 — `home` is a first-class canon entity
### D2 — A home attaches to a household and to multiple contacts
### D3 — The wizard lives in a new sibling repo `home-protection-portal/`
### D4 — Workflow-agnostic mechanics lift into `packages/`; screens do not
### D5 — Add-on selection is its own post-plan-selection step
### D6 — The "does the home have X" questions are a separate earlier step
### D7 — Add-on dollars are included in `paymentSchedule` and the charge
### D8 — DocuSeal is built once in `packages/integrations/signing/docuseal.js`
### D9 — `dealer_no` stays a single per-org value; home capability is an
        explicit `opportunities.home_protection.enabled` toggle

## Open risks

[R1–R6 verbatim from the spec.]

## Affected surfaces

[The file lists from spec §5, §6, §7, §8, §9.]
```

Each `###` heading gets 1–3 paragraphs of rationale drawn from the spec section it references. Do not leave any heading bodyless.

- [ ] **Step 2: Register the ADR in the index**

In `CLAUDE.md`, in the ` architecture/` tree block, add directly after the `28-monthly-membership-vsc.md` line:

```
│   ├── 30-home-protection-plan.md                 # Wave 39 — home protection workflow (Omega-J Home 2024)
```

- [ ] **Step 3: Verify no placeholder text remains**

Run: `grep -nE 'TBD|TODO|\[Two paragraphs|\[R1–R6|\[The file lists' architecture/30-home-protection-plan.md`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add architecture/30-home-protection-plan.md CLAUDE.md
git commit -m "docs(adr): 29 — Home Protection Plan (Omega-J Home 2024)"
```

---

### Task A2: canon — plan catalog, dwelling classes, add-ons

**Files:**
- Modify: `canon/plan-mappings.json`

**Interfaces:**
- Consumes: ADR 30 decision numbering.
- Produces: `plan_catalog['OMGA::VSC::{35,36,37,38,48,49}']` each with `asset_kind: 'home'`; `plan_catalog[*].asset_kind` on all existing entries; `home_dwelling_classes`; `home_add_ons`; `monthly_membership.contract_type_allowlist`. Read by Tasks A4, A5, A6, B, C.

- [ ] **Step 1: Backfill `asset_kind` on existing catalog entries**

Every existing `plan_catalog` entry (the 17 auto entries `OMGA::VSC::{51,66,67,68,69,70,71,78,79,80,81,82,83,R6,40,41,42}`) gains two fields:

```json
"asset_kind": "vehicle",
"program_code": null
```

- [ ] **Step 2: Add the six home catalog entries**

```json
"OMGA::VSC::35": { "tpa_code": "OMGA", "product_type_code": "VSC", "plan_code": "35", "asset_kind": "home", "program_code": "OHC-J", "plan_level": "good",   "plan_title": "Home Deluxe",          "plan_coverage_html": null, "covered_components": null, "sample_agreement_url": null, "docuseal_template_id": "182" },
"OMGA::VSC::36": { "tpa_code": "OMGA", "product_type_code": "VSC", "plan_code": "36", "asset_kind": "home", "program_code": "OHC-J", "plan_level": "better", "plan_title": "Home Deluxe Plus",     "plan_coverage_html": null, "covered_components": null, "sample_agreement_url": null, "docuseal_template_id": "184" },
"OMGA::VSC::37": { "tpa_code": "OMGA", "product_type_code": "VSC", "plan_code": "37", "asset_kind": "home", "program_code": "OHC-J", "plan_level": "best",   "plan_title": "Home Deluxe Enhanced", "plan_coverage_html": null, "covered_components": null, "sample_agreement_url": null, "docuseal_template_id": "185" },
"OMGA::VSC::38": { "tpa_code": "OMGA", "product_type_code": "VSC", "plan_code": "38", "asset_kind": "home", "program_code": "OHC-J", "plan_level": "good",   "plan_title": "Home Deluxe Monthly",          "plan_coverage_html": null, "covered_components": null, "sample_agreement_url": null, "docuseal_template_id": "186" },
"OMGA::VSC::48": { "tpa_code": "OMGA", "product_type_code": "VSC", "plan_code": "48", "asset_kind": "home", "program_code": "OHC-J", "plan_level": "better", "plan_title": "Home Deluxe Plus Monthly",     "plan_coverage_html": null, "covered_components": null, "sample_agreement_url": null, "docuseal_template_id": "187" },
"OMGA::VSC::49": { "tpa_code": "OMGA", "product_type_code": "VSC", "plan_code": "49", "asset_kind": "home", "program_code": "OHC-J", "plan_level": "best",   "plan_title": "Home Deluxe Enhanced Monthly", "plan_coverage_html": null, "covered_components": null, "sample_agreement_url": null, "docuseal_template_id": "188" }
```

Update the `plan_catalog._comment` to document the two new fields and to state that the three-part key is retained because the auto and home code sets are disjoint, with a fourth segment reserved as the escape hatch.

- [ ] **Step 3: Add `home_dwelling_classes`**

New top-level block in `canon/plan-mappings.json`:

```json
"home_dwelling_classes": {
  "_comment": "Five-way bucket over (home_type × square_feet) driving the dwelling-type checkbox on the Omega home agreement PDF. Read by packages/utils/dwelling-class.js#classifyDwelling. A home matching NO bucket is INELIGIBLE — the wizard stops at home_add rather than quoting.",
  "_TODO": "The ineligibility rule is INFERRED from the PDF's printed bucket list, not stated by Omega. Confirm with product before treating as authoritative (ADR 30 R2). Prefer blocking over a wrong-but-believable bucket.",
  "buckets": [
    { "id": "sf_lt_5000",       "home_type": "single_family", "min_sqft": 0,    "max_sqft": 4999,  "label": "Single-Family home less than 5,000 sq. ft.",   "docuseal_field": "DwellingSfLt5000" },
    { "id": "sf_5000_8000",     "home_type": "single_family", "min_sqft": 5000, "max_sqft": 8000,  "label": "Single-Family home from 5,000 to 8,000 sq. ft.", "docuseal_field": "DwellingSf5000To8000" },
    { "id": "sf_8001_12000",    "home_type": "single_family", "min_sqft": 8001, "max_sqft": 12000, "label": "Single-Family home from 8,001 to 12,000 sq. ft.", "docuseal_field": "DwellingSf8001To12000" },
    { "id": "townhome_lt_5000", "home_type": "townhome",      "min_sqft": 0,    "max_sqft": 4999,  "label": "Townhome less than 5,000 sq. ft.",             "docuseal_field": "DwellingTownhomeLt5000" },
    { "id": "condo_lt_5000",    "home_type": "condominium",   "min_sqft": 0,    "max_sqft": 4999,  "label": "Condominium less than 5,000 sq. ft.",          "docuseal_field": "DwellingCondoLt5000" }
  ],
  "home_types": [
    { "id": "single_family", "label": "Single Family" },
    { "id": "townhome",      "label": "Townhome" },
    { "id": "condominium",   "label": "Condominium" }
  ]
}
```

Bounds are INCLUSIVE on both ends (`min_sqft <= sqft <= max_sqft`), matching the `<=` convention locked in Wave 38 for `vehicle_class_rule`.

- [ ] **Step 4: Add `home_add_ons`**

```json
"home_add_ons": {
  "_comment": "The twelve optional-coverage categories OMEGA returns as <Option> rows on home TERM plans. Read by packages/utils/home-addons.js. OptionDesc encodes BOTH the category and the term ('Plumbing system 3yr (P/E)'), and the same category appears under multiple spellings, so matching normalizes aggressively.",
  "_principle": "Resolution is (canonical_key, term_months, variant). term_suffix maps 1yr→12 … 4yr→48; only options whose term equals the SELECTED plan term are offered. variant is 'pe' when the description carries a P/E marker, else 'standard'. plan_variant_rule decides which variant a plan code may use. Plans 38/48/49 return no options at all.",
  "term_suffix_months": { "1yr": 12, "2yr": 24, "3yr": 36, "4yr": 48 },
  "pe_markers": ["(p/e)", "(plus/enhanced)"],
  "plan_variant_rule": {
    "35": "standard",
    "36": "pe",
    "37": "pe",
    "38": null,
    "48": null,
    "49": null
  },
  "categories": [
    { "key": "additional_ac",           "label": "Additional AC Unit",       "docuseal_field": "AdditionalAC",           "match_aliases": ["additionalacunit", "addlacunit", "additional ac unit", "addl ac unit"] },
    { "key": "freestanding_freezer",    "label": "Free-Standing Freezer",    "docuseal_field": "FreestandingFreezer",    "match_aliases": ["freestandingfreezer", "free-standing freezer", "free standing freezer"] },
    { "key": "garage_door_opener",      "label": "Garage Door Opener",       "docuseal_field": "GarageDoor",             "match_aliases": ["garagedooropener", "garage door opener"] },
    { "key": "ice_maker",               "label": "Ice Maker",                "docuseal_field": "IceMaker",               "match_aliases": ["icemaker", "ice maker"] },
    { "key": "internal_plumbing",       "label": "Internal Plumbing System", "docuseal_field": "InternalPlumbing",       "match_aliases": ["plumbingsystem", "plumbing system", "internal plumbing system", "internal plumbing"] },
    { "key": "programmable_thermostat", "label": "Programmable Thermostat",  "docuseal_field": "ProgramableThermostat",  "match_aliases": ["programmablethermostat", "programmable thermostat"] },
    { "key": "secondary_refrigerator",  "label": "Secondary Refrigerator",   "docuseal_field": "SecondaryRefrigerator",  "match_aliases": ["secondaryrefrigerator", "secondrefrigerator", "secondary refrigerator", "second refrigerator"] },
    { "key": "septic",                  "label": "Septic System",            "docuseal_field": "SepticSystem",           "match_aliases": ["septic", "septic system"] },
    { "key": "spa",                     "label": "Spa",                      "docuseal_field": "Spa",                    "match_aliases": ["spa"] },
    { "key": "swimming_pool",           "label": "Swimming Pool",            "docuseal_field": "SwimmingPool",           "match_aliases": ["swimmingpool", "swimming pool"] },
    { "key": "well_pump",               "label": "Well Pump",                "docuseal_field": "WellPump",               "match_aliases": ["wellpump", "well pump"] },
    { "key": "wine_cooler",             "label": "Wine Cooler",              "docuseal_field": "WineCooler",             "match_aliases": ["winecooler", "wine cooler"] }
  ]
}
```

Note `"spa"` must be matched **last** among aliases when scanning, because it is a substring of nothing here but is the shortest token — the resolver in Task A4 sorts aliases by descending length before matching to prevent a short alias winning over a longer, more specific one.

- [ ] **Step 5: Extend `monthly_membership` with the contract-type detector**

In the existing `monthly_membership` block add:

```json
"contract_type_allowlist": [40],
"_contract_type_note": "ADR 30 R1 — home month-to-month plans (38/48/49) are ContractType 40. It is UNVERIFIED whether they also carry the 999999 mileage sentinel, because a home request sends VehicleOdometer 0 and has no mileage axis. Until a real AUG2 GetRates capture lands, ContractType 40 and sentinel_mileage are CO-AUTHORITATIVE: either firing flags billing_model 'monthly_subscription'."
```

- [ ] **Step 6: Verify the JSON parses and the entries resolve**

Run:

```bash
node -e "
const d = JSON.parse(require('fs').readFileSync('canon/plan-mappings.json','utf8'));
const homes = ['35','36','37','38','48','49'].map(c => d.plan_catalog['OMGA::VSC::'+c]);
console.assert(homes.every(e => e && e.asset_kind === 'home'), 'home entries missing');
console.assert(Object.values(d.plan_catalog).filter(e => e && e.tpa_code).every(e => e.asset_kind), 'asset_kind not backfilled');
console.assert(d.home_dwelling_classes.buckets.length === 5, 'wrong bucket count');
console.assert(d.home_add_ons.categories.length === 12, 'wrong category count');
console.assert(d.monthly_membership.contract_type_allowlist[0] === 40, 'contract type missing');
console.log('OK');
"
```

Expected: `OK` with no assertion output.

- [ ] **Step 7: Commit**

```bash
git add canon/plan-mappings.json
git commit -m "feat(canon): home plan catalog, dwelling classes, add-on rules (ADR 30)"
```

---

### Task A3: canon — entity, statuses, org config, version bump

**Files:**
- Modify: `canon/blinker-domain.json`
- Modify: `canon/ghl-status.json`
- Modify: `canon/org-registry.json`
- Modify: `canon/_version`

**Interfaces:**
- Consumes: Task A2's canon conventions.
- Produces: the `home` entity block; `ghl-status.json#home_protection.statuses` (18 keys, listed below); `org.home_protection_billing`; `org.opportunities.home_protection.enabled`. Read by Tasks A7, B, C.

- [ ] **Step 1: Add the `home` entity to `blinker-domain.json`**

New top-level key `home`, placed directly after `vehicle`:

```json
"home": {
  "_principle": "Canonical Blinker home shape. First-class entity, sibling to `vehicle` (ADR 30 D1). Unlike a vehicle — which hangs off a single contact's vehicles[] — a home attaches to a HOUSEHOLD and to MULTIPLE contacts, because the Omega home agreement has two agreement-holder slots (ADR 30 D2).",
  "_consumers": [
    "home-protection-portal/src/views/customer/HomeAdd.jsx",
    "mission-control ContactProfile Homes section",
    "mission-control CoPilotPane left-rail Home card"
  ],
  "shape": {
    "id":                 "string — 'home_' prefixed.",
    "org_id":             "number — canonical Org ID per org-registry.json.",
    "household_id":       "string? — household this home belongs to.",
    "contact_ids":        "Array<string> — one or more contacts on the agreement. Order is NOT significant; primary_contact_id names the first holder.",
    "primary_contact_id": "string — must appear in contact_ids.",
    "home_type":          "'single_family' | 'townhome' | 'condominium' — see plan-mappings.json#home_dwelling_classes.home_types.",
    "address":            "{ address1, address2, city, state, zip, zip4, country } — the COVERED PROPERTY address. Distinct from the agreement holder's mailing address, which lives on the contact.",
    "year_built":         "integer — four-digit year.",
    "square_feet":        "integer — heated/finished square footage.",
    "purchase_price":     "number? — dollars. Captured for parity with the legacy Add Home screen; not an input to rating.",
    "disposition":        "string? — free-form, carried from the legacy screen.",
    "source":             "'manual' — Phase 1 only path.",
    "created_at":         "string — ISO 8601.",
    "updated_at":         "string — ISO 8601."
  },
  "_derived": {
    "dwelling_class": "string|null — computed by packages/utils/dwelling-class.js#classifyDwelling from (home_type, square_feet). null means INELIGIBLE."
  }
}
```

Then, in the existing `opportunity` block's `_TODO` text, append: `Wave 39 adds workflow_type 'home_protection' and a home_id reference (ADR 30 D1).` And in `activity.status_change`, extend the `workflow_type` union to `'protection'|'refi'|'insurance'|'payments'|'home_protection'`.

- [ ] **Step 2: Add the `home_protection` status block to `ghl-status.json`**

Clone the `vsc` block, then remove nothing (the `vsc` list has no VIN-specific statuses — the VIN steps are wizard-internal, not statuses), and add an `actor` field to every status per ADR 27. The 20 status keys are identical to `vsc`:

`Empty, Quoted, Quoted - No Results, Selected, Sent to Consumer, Consumer Reviewed, Booked, Payment Failed, Payment Success, Product Agreement Signed, Payment Agreement Signed, Agreement Signed, Remitted - Product Error, Remitted - Payment Error, Remitted - Both Error, Remitted, Active, Paid in Full, Pending Cancellation, Cancelled`

`_label` becomes `"Home Protection Plan"`. `_pipelines` becomes `["Home - Prospects", "Home - Onboarding", "Home - Clients"]`. `crm_stage`, `pipeline`, `role`, and `description` are copied from `vsc` with "vehicle" replaced by "home" in the description prose.

`actor` assignment: `agent` for `Empty`, `Quoted`, `Quoted - No Results`, `Selected`, `Sent to Consumer`; `consumer` for `Consumer Reviewed`, `Booked`, `Payment Failed`, `Payment Success`, `Product Agreement Signed`, `Payment Agreement Signed`, `Agreement Signed`; `system` for all six `Remitted*` plus `Active`, `Paid in Full`, `Pending Cancellation`, `Cancelled`.

- [ ] **Step 3: Add `home_protection_billing` and the enable toggle to every org**

For each entry in `canon/org-registry.json#orgs[]`, add alongside the existing `protection_billing`:

```json
"home_protection_billing": {
  "_comment": "ADR 30 — Omega-J Home 2024 margins and EFS terms. SEPARATE from protection_billing: different product line, different margins. Seed values below are PLACEHOLDERS pending product confirmation.",
  "_TODO": "markup and EFS values are educated guesses. Confirm with product before Phase 2. Per feedback_canon_todo_defaults, do not let these propagate as authoritative.",
  "enabled": false,
  "markup": {
    "fixed_term_dollars": 300.0,
    "florida_fixed_term_dollars": 285.0,
    "monthly_dollars": 10.0,
    "florida_monthly_dollars": 9.0
  },
  "discount": {
    "max_percent": 15,
    "max_dollars": 150.0,
    "disabled_in_states": ["FL"]
  },
  "down_payment": {
    "default_percent": 10,
    "min_percent": 10,
    "max_percent_of_total": 75
  },
  "payment_term": {
    "options_months": [1, 6, 12],
    "default_months": 12
  },
  "first_payment_date": {
    "default_strategy": "first_of_next_month",
    "min_days_from_today": 31,
    "max_days_from_today": 45
  }
}
```

And add the capability toggle, creating the `opportunities` key if the org lacks it:

```json
"opportunities": { "home_protection": { "enabled": false } }
```

Set `enabled: true` on both blocks **only** for org `102` (Apex Auto Solutions), which is the org carrying the OMGA UAT credentials.

- [ ] **Step 4: Bump the canon version**

Write to `canon/_version`:

```
2026-08-25-v3017-home-protection
```

- [ ] **Step 5: Verify and sync**

Run:

```bash
node -e "
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('canon/blinker-domain.json','utf8'));
console.assert(d.home && d.home.shape.contact_ids, 'home entity missing');
const s = JSON.parse(fs.readFileSync('canon/ghl-status.json','utf8'));
const hp = s.home_protection.statuses;
console.assert(Object.keys(hp).length === 20, 'expected 20 statuses, got ' + Object.keys(hp).length);
console.assert(Object.values(hp).every(v => ['agent','consumer','system'].includes(v.actor)), 'actor missing');
const o = JSON.parse(fs.readFileSync('canon/org-registry.json','utf8'));
console.assert(o.orgs.every(x => x.home_protection_billing), 'billing block missing on some org');
const apex = o.orgs.find(x => String(x.id) === '102');
console.assert(apex.opportunities.home_protection.enabled === true, 'apex not enabled');
console.log('OK');
"
bash scripts/sync-canon-into-apps.sh
```

Expected: `OK`, then the sync script listing each child app it copied into.

- [ ] **Step 6: Commit**

```bash
git add canon/
git commit -m "feat(canon): home entity, home_protection statuses, home billing config (ADR 30)"
```

---

### Task A4: `packages/utils/dwelling-class.js`

**Files:**
- Create: `packages/utils/dwelling-class.js`
- Create: `packages/utils/dwelling-class.test.js`
- Modify: `packages/utils/index.js`

**Interfaces:**
- Consumes: `canon/plan-mappings.json#home_dwelling_classes` (passed in by the caller — the util stays pure, matching `classifyVehicle`'s contract).
- Produces:
  - `classifyDwelling(home, canonBlock) -> { id, label, docuseal_field } | null`
  - `isHomeEligible(home, canonBlock) -> boolean`
  - `listHomeTypes(canonBlock) -> Array<{ id, label }>`

- [ ] **Step 1: Write the failing test**

Create `packages/utils/dwelling-class.test.js`:

```js
// Unit tests for classifyDwelling — uses Node built-in test runner.
// Run: node --test packages/utils/dwelling-class.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyDwelling, isHomeEligible, listHomeTypes } from './dwelling-class.js';

const CANON = JSON.parse(
  readFileSync(new URL('../../canon/plan-mappings.json', import.meta.url), 'utf8'),
).home_dwelling_classes;

test('single family under 5000 lands in sf_lt_5000', () => {
  const r = classifyDwelling({ home_type: 'single_family', square_feet: 2400 }, CANON);
  assert.equal(r.id, 'sf_lt_5000');
  assert.equal(r.docuseal_field, 'DwellingSfLt5000');
});

test('bucket bounds are inclusive at both ends', () => {
  assert.equal(classifyDwelling({ home_type: 'single_family', square_feet: 4999 }, CANON).id, 'sf_lt_5000');
  assert.equal(classifyDwelling({ home_type: 'single_family', square_feet: 5000 }, CANON).id, 'sf_5000_8000');
  assert.equal(classifyDwelling({ home_type: 'single_family', square_feet: 8000 }, CANON).id, 'sf_5000_8000');
  assert.equal(classifyDwelling({ home_type: 'single_family', square_feet: 8001 }, CANON).id, 'sf_8001_12000');
  assert.equal(classifyDwelling({ home_type: 'single_family', square_feet: 12000 }, CANON).id, 'sf_8001_12000');
});

test('single family over 12000 is ineligible', () => {
  assert.equal(classifyDwelling({ home_type: 'single_family', square_feet: 12001 }, CANON), null);
  assert.equal(isHomeEligible({ home_type: 'single_family', square_feet: 12001 }, CANON), false);
});

test('townhome and condo cap at 5000', () => {
  assert.equal(classifyDwelling({ home_type: 'townhome', square_feet: 4999 }, CANON).id, 'townhome_lt_5000');
  assert.equal(classifyDwelling({ home_type: 'townhome', square_feet: 5000 }, CANON), null);
  assert.equal(classifyDwelling({ home_type: 'condominium', square_feet: 4999 }, CANON).id, 'condo_lt_5000');
  assert.equal(classifyDwelling({ home_type: 'condominium', square_feet: 5000 }, CANON), null);
});

test('missing or invalid input is ineligible, never a guess', () => {
  assert.equal(classifyDwelling({ home_type: 'single_family' }, CANON), null);
  assert.equal(classifyDwelling({ square_feet: 2000 }, CANON), null);
  assert.equal(classifyDwelling({ home_type: 'houseboat', square_feet: 900 }, CANON), null);
  assert.equal(classifyDwelling(null, CANON), null);
  assert.equal(classifyDwelling({ home_type: 'single_family', square_feet: 0 }, CANON), null);
  assert.equal(classifyDwelling({ home_type: 'single_family', square_feet: -5 }, CANON), null);
});

test('canon block is required', () => {
  assert.throws(() => classifyDwelling({ home_type: 'single_family', square_feet: 2000 }, null));
});

test('listHomeTypes returns the three canon types in order', () => {
  assert.deepEqual(listHomeTypes(CANON).map((t) => t.id), ['single_family', 'townhome', 'condominium']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test packages/utils/dwelling-class.test.js`
Expected: FAIL — `Cannot find module './dwelling-class.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/utils/dwelling-class.js`:

```js
// Dwelling class (home type × square footage) classifier — ADR 30 D1.
//
// The Omega home agreement PDF prints a five-way dwelling checkbox. This
// resolves (home_type, square_feet) to exactly one of those buckets, or to
// null when the home falls outside every bucket.
//
// null means INELIGIBLE, not "unknown". A home over its type's square-foot
// ceiling has no checkbox to tick on the agreement, so the wizard must stop
// at home_add rather than quote a plan it cannot paper. The conservative
// default mirrors classifyVehicle's 'used' fallback: never guess a bucket.
//
// NOTE (ADR 30 R2): the ineligibility rule is INFERRED from the PDF's printed
// bucket list, not stated by Omega. Confirm with product.

/**
 * @param {object|null} home
 * @param {string} home.home_type      'single_family' | 'townhome' | 'condominium'
 * @param {number|string} home.square_feet
 * @param {object} canonBlock          canon/plan-mappings.json#home_dwelling_classes
 * @returns {{ id: string, label: string, docuseal_field: string } | null}
 */
export function classifyDwelling(home, canonBlock) {
  if (!canonBlock || !Array.isArray(canonBlock.buckets)) {
    throw new Error('classifyDwelling: canonBlock is required (pass plan-mappings.json#home_dwelling_classes)');
  }

  const homeType = home?.home_type;
  const sqft = Number(home?.square_feet);
  if (!homeType || !Number.isFinite(sqft) || sqft <= 0) return null;

  const match = canonBlock.buckets.find(
    (b) => b.home_type === homeType && sqft >= Number(b.min_sqft) && sqft <= Number(b.max_sqft),
  );
  if (!match) return null;

  return { id: match.id, label: match.label, docuseal_field: match.docuseal_field };
}

/**
 * @param {object|null} home
 * @param {object} canonBlock
 * @returns {boolean}
 */
export function isHomeEligible(home, canonBlock) {
  return classifyDwelling(home, canonBlock) !== null;
}

/**
 * @param {object} canonBlock
 * @returns {Array<{ id: string, label: string }>}
 */
export function listHomeTypes(canonBlock) {
  if (!canonBlock || !Array.isArray(canonBlock.home_types)) return [];
  return canonBlock.home_types.map((t) => ({ id: t.id, label: t.label }));
}

export default classifyDwelling;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test packages/utils/dwelling-class.test.js`
Expected: PASS — 7 tests, 0 failures.

- [ ] **Step 5: Export from the package index**

In `packages/utils/index.js`, after the `classifyVehicle` export block, add:

```js
// Wave 39 (ADR 30 D1) — home dwelling-class classifier. Structural twin of
// vehicle-class.js. Reads canon/plan-mappings.json#home_dwelling_classes via
// the caller (canonBlock is passed in so this util stays pure). A null result
// means the home is INELIGIBLE — no dwelling checkbox exists on the agreement.
export { classifyDwelling, isHomeEligible, listHomeTypes } from './dwelling-class.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/utils/dwelling-class.js packages/utils/dwelling-class.test.js packages/utils/index.js
git commit -m "feat(utils): dwelling-class classifier for home protection (ADR 30)"
```

---

### Task A5: `packages/utils/home-addons.js`

**Files:**
- Create: `packages/utils/home-addons.js`
- Create: `packages/utils/home-addons.test.js`
- Modify: `packages/utils/index.js`

**Interfaces:**
- Consumes: `canon/plan-mappings.json#home_add_ons` (passed in), `classifyDwelling` not used here.
- Produces:
  - `parseOptionDesc(desc, canonBlock) -> { canonical_key, term_months, variant, raw } | null`
  - `resolveHomeAddOns({ options, planCode, termMonths, canonBlock }) -> Array<{ key, label, option_id, price, docuseal_field, variant }>`
  - `sumAddOnPrices(selected) -> number`
  - `revalidateSelections({ selected, available }) -> { kept, dropped }`

  These four are consumed by Phase B's `OptionalCoverages.jsx` and `Confirm.jsx`, and by Task A7's DocuSeal field builder.

- [ ] **Step 1: Write the failing test**

Create `packages/utils/home-addons.test.js`:

```js
// Unit tests for the home add-on parser/resolver — Node built-in test runner.
// Run: node --test packages/utils/home-addons.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseOptionDesc,
  resolveHomeAddOns,
  sumAddOnPrices,
  revalidateSelections,
} from './home-addons.js';

const CANON = JSON.parse(
  readFileSync(new URL('../../canon/plan-mappings.json', import.meta.url), 'utf8'),
).home_add_ons;

test('parses category, term and standard variant', () => {
  const r = parseOptionDesc('Plumbing system 3yr', CANON);
  assert.equal(r.canonical_key, 'internal_plumbing');
  assert.equal(r.term_months, 36);
  assert.equal(r.variant, 'standard');
});

test('parses both P/E marker spellings', () => {
  assert.equal(parseOptionDesc('Additional AC unit 4yr (P/E)', CANON).variant, 'pe');
  assert.equal(parseOptionDesc('Wellpump2yr(plus/enhanced)', CANON).variant, 'pe');
});

test('tolerates the unspaced raw spellings from the rater', () => {
  assert.equal(parseOptionDesc('AddlACunit2yr(plus/enhanced)', CANON).canonical_key, 'additional_ac');
  assert.equal(parseOptionDesc('Secondrefrigerator2yr', CANON).canonical_key, 'secondary_refrigerator');
  assert.equal(parseOptionDesc('SEPTIC1yr', CANON).canonical_key, 'septic');
  assert.equal(parseOptionDesc('SPA3yr(plus/enhanced)', CANON).canonical_key, 'spa');
});

test('longest alias wins so a short alias cannot shadow a specific one', () => {
  // 'plumbing system' and 'internal plumbing system' both map to the same key,
  // but the longer alias must be the one that matched.
  assert.equal(parseOptionDesc('Internal plumbing system 1yr', CANON).canonical_key, 'internal_plumbing');
});

test('unrecognised descriptions return null rather than guessing', () => {
  assert.equal(parseOptionDesc('Roof replacement 2yr', CANON), null);
  assert.equal(parseOptionDesc('', CANON), null);
  assert.equal(parseOptionDesc(null, CANON), null);
  assert.equal(parseOptionDesc('Spa', CANON), null); // no term suffix
});

const OPTIONS = [
  { OptionId: 'o1', OptionDesc: 'Plumbing system 3yr',          RetailRate: 152 },
  { OptionId: 'o2', OptionDesc: 'Plumbing system 3yr (P/E)',    RetailRate: 186 },
  { OptionId: 'o3', OptionDesc: 'Plumbing system 1yr',          RetailRate: 57  },
  { OptionId: 'o4', OptionDesc: 'Swimming pool 3yr',            RetailRate: 360 },
  { OptionId: 'o5', OptionDesc: 'Swimming pool 3yr (P/E)',      RetailRate: 415 },
];

test('plan 35 gets standard variants at the selected term only', () => {
  const r = resolveHomeAddOns({ options: OPTIONS, planCode: '35', termMonths: 36, canonBlock: CANON });
  assert.deepEqual(r.map((x) => x.option_id).sort(), ['o1', 'o4']);
  assert.equal(r.find((x) => x.key === 'internal_plumbing').price, 152);
  assert.equal(r.find((x) => x.key === 'internal_plumbing').docuseal_field, 'InternalPlumbing');
});

test('plans 36 and 37 get P/E variants only', () => {
  for (const planCode of ['36', '37']) {
    const r = resolveHomeAddOns({ options: OPTIONS, planCode, termMonths: 36, canonBlock: CANON });
    assert.deepEqual(r.map((x) => x.option_id).sort(), ['o2', 'o5']);
    assert.equal(r.find((x) => x.key === 'internal_plumbing').price, 186);
  }
});

test('monthly plans get no add-ons at all', () => {
  for (const planCode of ['38', '48', '49']) {
    assert.deepEqual(resolveHomeAddOns({ options: OPTIONS, planCode, termMonths: 1, canonBlock: CANON }), []);
  }
});

test('term filter excludes other-term rows', () => {
  const r = resolveHomeAddOns({ options: OPTIONS, planCode: '35', termMonths: 12, canonBlock: CANON });
  assert.deepEqual(r.map((x) => x.option_id), ['o3']);
});

test('unknown plan code yields no add-ons rather than defaulting a variant', () => {
  assert.deepEqual(resolveHomeAddOns({ options: OPTIONS, planCode: '99', termMonths: 36, canonBlock: CANON }), []);
});

test('sumAddOnPrices totals selections', () => {
  assert.equal(sumAddOnPrices([{ price: 152 }, { price: 360 }]), 512);
  assert.equal(sumAddOnPrices([]), 0);
  assert.equal(sumAddOnPrices(null), 0);
});

test('revalidateSelections re-prices by key and drops what is gone', () => {
  const selected = [
    { key: 'internal_plumbing', option_id: 'o3', price: 57 },   // was 1yr
    { key: 'well_pump',         option_id: 'oX', price: 88 },   // not offered at this plan/term
  ];
  const available = resolveHomeAddOns({ options: OPTIONS, planCode: '36', termMonths: 36, canonBlock: CANON });
  const { kept, dropped } = revalidateSelections({ selected, available });
  assert.deepEqual(kept.map((x) => x.key), ['internal_plumbing']);
  assert.equal(kept[0].option_id, 'o2');   // re-resolved to the P/E row
  assert.equal(kept[0].price, 186);        // re-priced
  assert.deepEqual(dropped.map((x) => x.key), ['well_pump']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test packages/utils/home-addons.test.js`
Expected: FAIL — `Cannot find module './home-addons.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/utils/home-addons.js`:

```js
// Home optional-coverage (add-on) parser + resolver — ADR 30 D5.
//
// OMEGA returns home add-ons as <Option> rows whose OptionDesc encodes BOTH
// the coverage category and the term, in inconsistent spellings:
//
//   "Plumbing system 3yr"              → internal_plumbing, 36mo, standard
//   "AddlACunit2yr(plus/enhanced)"     → additional_ac,     24mo, pe
//   "SEPTIC1yr"                        → septic,             12mo, standard
//
// Two filters then decide what a customer may actually buy:
//   1. TERM — only options whose term equals the selected plan term.
//   2. VARIANT — plan 35 takes standard rows; plans 36/37 take P/E rows.
//      Plans 38/48/49 (month-to-month) carry no options at all.
//
// The response returns BOTH variants under the same term-plan rate records,
// so rendering every <Option> returned would offer the customer the wrong
// price. Selection is by (canonical_key, term, variant), never by position.
//
// Unrecognised descriptions return null. Never guess a category: a wrong
// guess paper-trails the wrong checkbox onto a signed agreement.

const PE_FALLBACK_MARKERS = ['(p/e)', '(plus/enhanced)'];

function normalize(s) {
  return String(s ?? '').toLowerCase().replace(/[\s_-]+/g, '');
}

function requireCanon(canonBlock) {
  if (!canonBlock || !Array.isArray(canonBlock.categories)) {
    throw new Error('home-addons: canonBlock is required (pass plan-mappings.json#home_add_ons)');
  }
}

// Aliases are matched longest-first so a short alias ('spa') can never shadow
// a longer, more specific one that also matches the same description.
function aliasIndex(canonBlock) {
  const rows = [];
  for (const cat of canonBlock.categories) {
    for (const alias of cat.match_aliases || []) {
      rows.push({ norm: normalize(alias), cat });
    }
  }
  return rows.sort((a, b) => b.norm.length - a.norm.length);
}

/**
 * @param {string} desc            raw OptionDesc from the rater
 * @param {object} canonBlock      canon/plan-mappings.json#home_add_ons
 * @returns {{ canonical_key: string, term_months: number, variant: 'standard'|'pe', raw: string } | null}
 */
export function parseOptionDesc(desc, canonBlock) {
  requireCanon(canonBlock);
  const raw = String(desc ?? '');
  if (!raw.trim()) return null;

  const lower = raw.toLowerCase();
  const norm = normalize(raw);

  // Term — the suffix map is canon-driven ('1yr' → 12 … '4yr' → 48).
  const suffixMap = canonBlock.term_suffix_months || {};
  let termMonths = null;
  for (const [suffix, months] of Object.entries(suffixMap)) {
    if (norm.includes(normalize(suffix))) { termMonths = Number(months); break; }
  }
  if (!Number.isFinite(termMonths)) return null;

  // Variant.
  const markers = Array.isArray(canonBlock.pe_markers) && canonBlock.pe_markers.length
    ? canonBlock.pe_markers
    : PE_FALLBACK_MARKERS;
  const variant = markers.some((m) => lower.includes(String(m).toLowerCase()) || norm.includes(normalize(m)))
    ? 'pe'
    : 'standard';

  // Category — longest alias wins.
  const hit = aliasIndex(canonBlock).find((row) => norm.includes(row.norm));
  if (!hit) return null;

  return { canonical_key: hit.cat.key, term_months: termMonths, variant, raw };
}

/**
 * @param {object}  args
 * @param {Array}   args.options      normalized <Option> rows: { OptionId, OptionDesc, RetailRate }
 * @param {string}  args.planCode
 * @param {number}  args.termMonths   the SELECTED plan term
 * @param {object}  args.canonBlock
 * @returns {Array<{ key, label, option_id, price, docuseal_field, variant }>}
 */
export function resolveHomeAddOns({ options, planCode, termMonths, canonBlock }) {
  requireCanon(canonBlock);
  if (!Array.isArray(options) || options.length === 0) return [];

  const rule = canonBlock.plan_variant_rule || {};
  const allowedVariant = rule[String(planCode)];
  // null → month-to-month plan, no options. undefined → unknown plan code;
  // refuse rather than defaulting to a variant that may be mispriced.
  if (!allowedVariant) return [];

  const term = Number(termMonths);
  if (!Number.isFinite(term)) return [];

  const byKey = new Map(canonBlock.categories.map((c) => [c.key, c]));
  const out = [];
  const seen = new Set();

  for (const opt of options) {
    const parsed = parseOptionDesc(opt?.OptionDesc ?? opt?.name, canonBlock);
    if (!parsed) continue;
    if (parsed.term_months !== term) continue;
    if (parsed.variant !== allowedVariant) continue;
    if (seen.has(parsed.canonical_key)) continue;

    const price = Number(opt?.RetailRate ?? opt?.price ?? opt?.price_delta);
    if (!Number.isFinite(price)) continue;

    const cat = byKey.get(parsed.canonical_key);
    seen.add(parsed.canonical_key);
    out.push({
      key:            parsed.canonical_key,
      label:          cat?.label ?? parsed.canonical_key,
      option_id:      opt?.OptionId ?? opt?.id ?? null,
      price,
      docuseal_field: cat?.docuseal_field ?? null,
      variant:        parsed.variant,
    });
  }

  return out;
}

/**
 * @param {Array<{ price: number }>|null} selected
 * @returns {number} dollars
 */
export function sumAddOnPrices(selected) {
  if (!Array.isArray(selected)) return 0;
  return selected.reduce((sum, a) => sum + (Number(a?.price) || 0), 0);
}

/**
 * Re-resolve prior selections against a freshly computed available set.
 *
 * Changing plan or term changes BOTH the OptionId and the price, so a stale
 * selection carried forward would charge the wrong amount. Selections are
 * matched by canonical key and rewritten from the available row; anything
 * no longer offered is dropped and reported.
 *
 * @param {object} args
 * @param {Array}  args.selected   prior selections (need only carry `key`)
 * @param {Array}  args.available  output of resolveHomeAddOns for the NEW plan/term
 * @returns {{ kept: Array, dropped: Array }}
 */
export function revalidateSelections({ selected, available }) {
  const avail = new Map((available || []).map((a) => [a.key, a]));
  const kept = [];
  const dropped = [];
  for (const sel of selected || []) {
    const fresh = avail.get(sel?.key);
    if (fresh) kept.push({ ...fresh });
    else dropped.push(sel);
  }
  return { kept, dropped };
}

export default resolveHomeAddOns;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test packages/utils/home-addons.test.js`
Expected: PASS — 12 tests, 0 failures.

- [ ] **Step 5: Export from the package index**

In `packages/utils/index.js`, after the `dwelling-class` export block, add:

```js
// Wave 39 (ADR 30 D5) — home optional-coverage parser + resolver. Reads
// canon/plan-mappings.json#home_add_ons via the caller. Handles the rater's
// inconsistent OptionDesc spellings, the term suffix, and the standard/P-E
// variant split (plan 35 → standard, 36/37 → P/E, 38/48/49 → none).
// revalidateSelections MUST be called on any plan-or-term change: both the
// OptionId and the price move, so a carried-forward selection mischarges.
export {
  parseOptionDesc,
  resolveHomeAddOns,
  sumAddOnPrices,
  revalidateSelections,
} from './home-addons.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/utils/home-addons.js packages/utils/home-addons.test.js packages/utils/index.js
git commit -m "feat(utils): home add-on OptionDesc parser + plan/term resolver (ADR 30)"
```

---

### Task A6: StoneEagle home rating path

**Files:**
- Modify: `packages/integrations/product_admin/stoneeagle.js` (`buildSoapEnvelope` ~`:231-297`; `normalizeToFixtureShape` ~`:614`; new export beside `getRatesWithVehicleClass` ~`:1024`; default-export block ~`:1045`)
- Modify: `packages/integrations/product_admin/index.js` (category facade, ~`:86`)
- Create: `packages/integrations/product_admin/_fixtures/stone-eagle-get-rates-home.json`
- Create: `packages/integrations/product_admin/stoneeagle-home.test.js`

**Interfaces:**
- Consumes: `resolveHomeAddOns` is NOT called here — the normalizer attaches raw option rows and Phase B resolves them.
- Produces:
  - `getRatesForHome(input, ctx) -> Promise<NormalizedRates>` where `input` is `{ state }` only (no vehicle fields) and `ctx` is `{ orgId, signal }`.
  - Normalized products carry `asset_kind: 'home'`, `plan_code`, `tpa_code`, `product_type_code`, `coverage_period_months`, `deductible`, `base_price`, `mileage: null`, `billing_model`, and for term plans an `options: []` array of raw `{ OptionId, OptionDesc, RetailRate }` rows.

- [ ] **Step 1: Write the failing test**

Create `packages/integrations/product_admin/stoneeagle-home.test.js`:

```js
// Home rating path tests — Node built-in test runner.
// Run: node --test packages/integrations/product_admin/stoneeagle-home.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __buildSoapEnvelope } from './stoneeagle.js';

const CREDS = { tpa_code: 'OMGA', user_id: 'BLINKER', password: 'x', dealer_no: 'AUG2' };

test('home envelope emits the HOME sentinels verbatim', () => {
  const xml = __buildSoapEnvelope({ asset_kind: 'home', state: 'MI' }, CREDS);
  assert.match(xml, /<NewUsed>\*<\/NewUsed>/);
  assert.match(xml, /<VehicleYear>2025<\/VehicleYear>/);
  assert.match(xml, /<VehicleMake>HOME<\/VehicleMake>/);
  assert.match(xml, /<VehicleModel>HOME<\/VehicleModel>/);
  assert.match(xml, /<Trim><\/Trim>/);
  assert.match(xml, /<AssetType><\/AssetType>/);
  assert.match(xml, /<VehicleOdometer>0<\/VehicleOdometer>/);
  assert.match(xml, /<State>MI<\/State>/);
  assert.match(xml, /<DealerNo>AUG2<\/DealerNo>/);
});

test('home envelope never emits a VIN block', () => {
  const xml = __buildSoapEnvelope({ asset_kind: 'home', state: 'MI', vin: 'IGNOREDVIN123456' }, CREDS);
  assert.doesNotMatch(xml, /<VIN>/);
});

test('vehicle envelope is unchanged by the home branch', () => {
  const xml = __buildSoapEnvelope(
    { year: 2022, make: 'Toyota', model: 'RAV4', trim: 'XLE', mileage: 30000, condition: 'N', asset_type: 'T', state: 'TX' },
    { ...CREDS, dealer_no: 'AMR2' },
  );
  assert.match(xml, /<NewUsed>N<\/NewUsed>/);
  assert.match(xml, /<VehicleMake>TOYOTA<\/VehicleMake>/);
  assert.match(xml, /<AssetType>T<\/AssetType>/);
  assert.match(xml, /<VehicleOdometer>30000<\/VehicleOdometer>/);
});

test('home envelope omits State entirely when absent', () => {
  const xml = __buildSoapEnvelope({ asset_kind: 'home' }, CREDS);
  assert.doesNotMatch(xml, /<State>/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test packages/integrations/product_admin/stoneeagle-home.test.js`
Expected: FAIL — `__buildSoapEnvelope` is not exported, and the home branch does not exist.

- [ ] **Step 3: Add the home branch to `buildSoapEnvelope`**

In `packages/integrations/product_admin/stoneeagle.js`, at the top of `buildSoapEnvelope`, before the existing `newUsed` computation, insert the home branch. The existing vehicle logic stays exactly as-is below it.

```js
  // ADR 30 — Home Protection. OMEGA addresses its home-warranty line through
  // the same GetRates operation, with HOME sentinels in the vehicle slots.
  // NewUsed is '*' (a home has no new/used axis), Trim and AssetType are
  // emitted EMPTY, and the odometer is 0. Note the vehicle path defaults
  // AssetType to 'P' and coerces NewUsed to N|U — neither is expressible
  // for a home, which is why this is a branch rather than a parameter.
  const isHome = input?.asset_kind === 'home';
  if (isHome) {
    const homeStateTag = input.state
      ? `<State>${escapeXml(String(input.state).toUpperCase())}</State>`
      : '';
    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetRates xmlns="http://www.natinc.com/SCSAutoService/">
      <objGetRatesRequest>
        <TpaCode>${escapeXml(creds?.tpa_code)}</TpaCode>
        <UserId>${escapeXml(creds?.user_id)}</UserId>
        <Password>${escapeXml(creds?.password)}</Password>
        <DealerNo>${escapeXml(creds?.dealer_no)}</DealerNo>
        <SaleDate>${today}</SaleDate>
        <NewUsed>*</NewUsed>
        ${homeStateTag}
        <VehicleYear>2025</VehicleYear>
        <VehicleMake>HOME</VehicleMake>
        <VehicleModel>HOME</VehicleModel>
        <Trim></Trim>
        <AssetType></AssetType>
        <VehicleOdometer>0</VehicleOdometer>
        <ProductCollection>
          <Product>
            <Code>VSC</Code>
          </Product>
        </ProductCollection>
      </objGetRatesRequest>
    </GetRates>
  </soap:Body>
</soap:Envelope>`;
  }
```

`today` is already computed on the first line of the function; keep that line above this block.

- [ ] **Step 4: Export the envelope builder for testing**

At the bottom of `stoneeagle.js`, beside the existing `export { resolveProviderMode as __resolveProviderMode };`, add:

```js
export { buildSoapEnvelope as __buildSoapEnvelope };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test packages/integrations/product_admin/stoneeagle-home.test.js`
Expected: PASS — 4 tests, 0 failures.

- [ ] **Step 6: Verify the vehicle path did not regress**

Run: `node --test packages/utils/getrates-comparison.test.js`
Expected: PASS, same count as before the change.

- [ ] **Step 7: Commit the envelope branch**

```bash
git add packages/integrations/product_admin/stoneeagle.js packages/integrations/product_admin/stoneeagle-home.test.js
git commit -m "feat(integrations): home GetRates SOAP branch (ADR 30)"
```

- [ ] **Step 8: Add the home normalizer branch**

In `normalizeToFixtureShape`, add a home path selected by `input?.asset_kind === 'home'`. Per rate row:

- Read `ContractType`. Treat `40` (or a `999999` sentinel mileage, whichever fires first) as `billing_model: 'monthly_subscription'`; everything else as `'term_total'`. Emit a `home_monthly_signal` field recording which detector fired, so R1 can be closed from telemetry once real data lands.
- Term products: one product per `(PlanCode, TermMile.Term)`. Set `mileage: null`, `unlimited_mileage: false`, `deductible` from `<DeductAmt>`, `coverage_period_months` from `TermMile.Term`, `asset_kind: 'home'`, and `options: []` populated from the row's `<Option>` children as raw `{ OptionId, OptionDesc, RetailRate }` objects. Do NOT filter options here — Phase B's `resolveHomeAddOns` owns that, because filtering depends on the customer's selected term.
- Monthly products: reuse the existing `buildMonthlyProduct` grouping, with `asset_kind: 'home'` and `options: []`.
- Pricing: call the existing `computePlanPrice` with the org's `home_protection_billing.markup` values rather than `protection_billing.markup`. Add a `billingBlockKey` parameter to the pricing call site defaulting to `'protection_billing'`.

- [ ] **Step 9: Add `getRatesForHome` and wire the facade**

Beside `getRatesWithVehicleClass` in `stoneeagle.js`:

```js
/**
 * Home rating entry point — ADR 30.
 *
 * Deliberately does NOT go through getRatesWithVehicleClass: a home has no
 * new/used axis, so there is no classifyVehicle call and no parallel N+U
 * fan-out. One call, NewUsed '*'.
 *
 * @param {object} input  { state }
 * @param {object} ctx    { orgId, signal }
 */
export async function getRatesForHome(input, ctx) {
  return getRatesSingle({ ...input, asset_kind: 'home', condition: '*', mileage: 0 }, ctx);
}
```

Add `getRatesForHome` to the module's default-export object, and in `packages/integrations/product_admin/index.js` add a sibling facade `getRatesForHome(input, { orgId, signal })` that resolves the provider exactly as `getRates` does and returns `{ status: 'no_provider' }` when unconfigured.

- [ ] **Step 10: Create the home fixture**

Create `packages/integrations/product_admin/_fixtures/stone-eagle-get-rates-home.json` in the **normalized** shape (matching `stone-eagle-get-rates.json`'s structure), containing all six plans:

- 35 at terms 12/24/36/48 with base prices 525/970/1175/1425, each carrying the twelve standard-variant options at that term.
- 36 at terms 24/36/48 with base prices 990/1325/1570, each carrying the twelve P/E options at that term.
- 37 at terms 24/36/48 with base prices 1040/1425/1670, each carrying the twelve P/E options at that term.
- 38/48/49 as `billing_model: 'monthly_subscription'` with `monthly_charge` 40/44/48, `options: []`.

Every product carries `deductible: 75`, `tpa_code: 'OMGA'`, `product_type_code: 'VSC'`, `asset_kind: 'home'`, `mileage: null`.

Add a header comment field:

```json
"_comment": "SYNTHETIC fixture built from the Basecamp AUG2 screenshots — NOT a captured response (ADR 30 R1). Prices are illustrative. Replace with a real /se-rating proxy capture and add a regression test in that exact shape before Phase 2."
```

- [ ] **Step 11: Verify the fixture resolves add-ons correctly end-to-end**

Append to `stoneeagle-home.test.js`:

```js
import { readFileSync } from 'node:fs';
import { resolveHomeAddOns } from '../../utils/home-addons.js';

const HOME_FIXTURE = JSON.parse(
  readFileSync(new URL('./_fixtures/stone-eagle-get-rates-home.json', import.meta.url), 'utf8'),
);
const ADDON_CANON = JSON.parse(
  readFileSync(new URL('../../../canon/plan-mappings.json', import.meta.url), 'utf8'),
).home_add_ons;

test('fixture: plan 35 at 36mo offers twelve standard add-ons', () => {
  const p = HOME_FIXTURE.products.find((x) => x.plan_code === '35' && x.coverage_period_months === 36);
  const r = resolveHomeAddOns({ options: p.options, planCode: '35', termMonths: 36, canonBlock: ADDON_CANON });
  assert.equal(r.length, 12);
  assert.ok(r.every((x) => x.variant === 'standard'));
  assert.ok(r.every((x) => x.docuseal_field));
});

test('fixture: plan 37 at 48mo offers twelve P/E add-ons', () => {
  const p = HOME_FIXTURE.products.find((x) => x.plan_code === '37' && x.coverage_period_months === 48);
  const r = resolveHomeAddOns({ options: p.options, planCode: '37', termMonths: 48, canonBlock: ADDON_CANON });
  assert.equal(r.length, 12);
  assert.ok(r.every((x) => x.variant === 'pe'));
});

test('fixture: monthly plans carry no options', () => {
  for (const code of ['38', '48', '49']) {
    const p = HOME_FIXTURE.products.find((x) => x.plan_code === code);
    assert.equal(p.billing_model, 'monthly_subscription');
    assert.deepEqual(p.options, []);
  }
});

test('fixture: plan 36 has no 12-month term', () => {
  const twelve = HOME_FIXTURE.products.filter((x) => x.plan_code === '36' && x.coverage_period_months === 12);
  assert.equal(twelve.length, 0);
});
```

Run: `node --test packages/integrations/product_admin/stoneeagle-home.test.js`
Expected: PASS — 8 tests, 0 failures.

- [ ] **Step 12: Commit**

```bash
git add packages/integrations/product_admin/
git commit -m "feat(integrations): home rate normalization, getRatesForHome, synthetic fixture (ADR 30)"
```

---

### Task A7: `packages/integrations/signing/docuseal.js`

**Files:**
- Create: `packages/integrations/signing/index.js`
- Create: `packages/integrations/signing/docuseal.js`
- Create: `packages/integrations/signing/docuseal.test.js`
- Modify: `packages/integrations/index.js` (move `signing` from planned to implemented)
- Modify: `package.json` if the `./integrations/*` subpath export does not already resolve `signing`

**Interfaces:**
- Consumes: `resolvePlanPresentation` from `packages/utils/plan-presentation.js`; `sumAddOnPrices` from `packages/utils/home-addons.js`; `classifyDwelling` from `packages/utils/dwelling-class.js`.
- Produces:
  - `resolveTemplateId({ orgId, tpaCode, productTypeCode, planCode, planName }) -> string | null`
  - `buildHomeSubmissionFields({ form, org, canon }) -> Record<string, string|boolean>`
  - `createSubmission({ templateId, fields, submitters }, ctx) -> Promise<{ status, submission_id, submitters }>`

- [ ] **Step 1: Write the failing test**

Create `packages/integrations/signing/docuseal.test.js`:

```js
// DocuSeal field-mapping tests — Node built-in test runner.
// Run: node --test packages/integrations/signing/docuseal.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveTemplateId, buildHomeSubmissionFields } from './docuseal.js';

const PLAN_MAPPINGS = JSON.parse(
  readFileSync(new URL('../../../canon/plan-mappings.json', import.meta.url), 'utf8'),
);
const CANON = {
  homeAddOns:         PLAN_MAPPINGS.home_add_ons,
  homeDwellingClasses: PLAN_MAPPINGS.home_dwelling_classes,
};

const ORG = {
  id: 102,
  name: 'Apex Auto Solutions',
  legal_name: 'Apex Auto Solutions LLC',
  address: { address1: '1 Apex Way', city: 'Austin', state: 'TX', zip: '78701' },
  phone: '5125550100',
  seller_code: 'AUG2',
};

function makeForm(overrides = {}) {
  return {
    org_id: 102,
    contact: {
      first_name: 'Dana', last_name: 'Reyes', phone: '3135550142',
      address1: '17547 Murray Hill Street', city: 'Detroit', state: 'MI', zip: '48235',
    },
    home: {
      home_type: 'single_family', square_feet: 2400, year_built: 1998,
      address: { address1: '17547 Murray Hill Street', city: 'Detroit', state: 'MI', zip: '48235' },
    },
    selectedPlan: {
      plan_code: '37', tpa_code: 'OMGA', product_type_code: 'VSC',
      coverage_period_months: 36, total_cost: 1425,
    },
    selectedAddOns: [
      { key: 'swimming_pool',   docuseal_field: 'SwimmingPool',   price: 415 },
      { key: 'internal_plumbing', docuseal_field: 'InternalPlumbing', price: 186 },
    ],
    saleDate: '2026-08-25',
    ...overrides,
  };
}

test('template id resolves from the catalog for each home plan', () => {
  const expected = { 35: '182', 36: '184', 37: '185', 38: '186', 48: '187', 49: '188' };
  for (const [planCode, id] of Object.entries(expected)) {
    const got = resolveTemplateId({ orgId: 102, tpaCode: 'OMGA', productTypeCode: 'VSC', planCode });
    assert.equal(got, id, `plan ${planCode} should map to template ${id}`);
  }
});

test('Deluxe is always checked', () => {
  const f = buildHomeSubmissionFields({ form: makeForm(), org: ORG, canon: CANON });
  assert.equal(f.Deluxe, true);
});

test('selected add-on checkboxes are true and unselected ones are false', () => {
  const f = buildHomeSubmissionFields({ form: makeForm(), org: ORG, canon: CANON });
  assert.equal(f.SwimmingPool, true);
  assert.equal(f.InternalPlumbing, true);
  assert.equal(f.WellPump, false);
  assert.equal(f.SepticSystem, false);
  // All twelve checkbox fields must be present, never omitted.
  const boxes = CANON.homeAddOns.categories.map((c) => c.docuseal_field);
  assert.ok(boxes.every((b) => typeof f[b] === 'boolean'), 'every add-on checkbox must be emitted');
});

test('ProductPrice includes add-on dollars', () => {
  const f = buildHomeSubmissionFields({ form: makeForm(), org: ORG, canon: CANON });
  assert.equal(f.ProductPrice, '2026.00'); // 1425 + 415 + 186
});

test('expiration is effective date plus term months', () => {
  const f = buildHomeSubmissionFields({ form: makeForm(), org: ORG, canon: CANON });
  assert.equal(f.ProductPurchaseDate, '2026-08-25');
  assert.equal(f.ProductEffectiveDate, '2026-08-25');
  assert.equal(f.ProductExpirationDate, '2029-08-25');
  assert.equal(f.ProductTermMonths, '36');
});

test('covered property address is emitted under Property* names, not Address1', () => {
  const f = buildHomeSubmissionFields({ form: makeForm(), org: ORG, canon: CANON });
  assert.equal(f.Address1, '17547 Murray Hill Street');  // holder mailing
  assert.equal(f.PropertyAddress1, '17547 Murray Hill Street');
  assert.equal(f.PropertyCity, 'Detroit');
  assert.equal(f.PropertyState, 'MI');
  assert.equal(f.PropertyZip, '48235');
});

test('dwelling checkbox reflects the computed bucket', () => {
  const f = buildHomeSubmissionFields({ form: makeForm(), org: ORG, canon: CANON });
  assert.equal(f.DwellingSfLt5000, true);
  assert.equal(f.DwellingCondoLt5000, false);
  assert.equal(f.SquareFeet, '2400');
});

test('second agreement holder is emitted only when present', () => {
  const one = buildHomeSubmissionFields({ form: makeForm(), org: ORG, canon: CANON });
  assert.equal(one.SecondFirstName, '');
  const two = buildHomeSubmissionFields({
    form: makeForm({ secondaryContact: { first_name: 'Sam', last_name: 'Reyes', phone: '3135550143' } }),
    org: ORG,
    canon: CANON,
  });
  assert.equal(two.SecondFirstName, 'Sam');
  assert.equal(two.SecondLastName, 'Reyes');
});

test('an ineligible home throws rather than papering a blank dwelling box', () => {
  const bad = makeForm({ home: { home_type: 'condominium', square_feet: 9000, address: {} } });
  assert.throws(() => buildHomeSubmissionFields({ form: bad, org: ORG, canon: CANON }), /ineligible/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test packages/integrations/signing/docuseal.test.js`
Expected: FAIL — `Cannot find module './docuseal.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/integrations/signing/docuseal.js`. It must:

- `resolveTemplateId(...)` — delegate to `resolvePlanPresentation` from `packages/utils/plan-presentation.js` and return its `docusealTemplateId`. No new resolution logic; the org-override → catalog → org-default precedence already exists there.
- `buildHomeSubmissionFields({ form, org, canon })`:
  - Call `classifyDwelling(form.home, canon.homeDwellingClasses)`. If it returns `null`, `throw new Error('buildHomeSubmissionFields: home is ineligible — no dwelling bucket matches (ADR 30 R2)')`.
  - Emit **every** one of the twelve add-on checkbox fields as an explicit boolean — `true` when the category key appears in `form.selectedAddOns`, `false` otherwise. Never omit a checkbox.
  - Emit **every** one of the five dwelling checkbox fields as an explicit boolean, exactly one `true`.
  - `Deluxe: true` unconditionally.
  - `ProductPrice` = `(form.selectedPlan.total_cost + sumAddOnPrices(form.selectedAddOns)).toFixed(2)`.
  - `ProductPurchaseDate` = `form.saleDate`. `ProductEffectiveDate` = `form.productEffectiveDate ?? form.saleDate`. `ProductExpirationDate` = effective date advanced by `coverage_period_months` calendar months, formatted `YYYY-MM-DD`. Use UTC date arithmetic so the result does not shift across timezones.
  - Holder fields (`FirstName`, `LastName`, `Phone`, `Address1`, `City`, `State`, `Zip`) come from `form.contact`. Covered-property fields (`PropertyAddress1`, `PropertyCity`, `PropertyState`, `PropertyZip`) come from `form.home.address`.
  - `SquareFeet` = `String(form.home.square_feet)`.
  - Second holder: `SecondFirstName`, `SecondLastName`, `SecondPhone` from `form.secondaryContact`, defaulting to `''`.
  - Seller block from `org`: `SellerNameLegal`, `SellerAddress1`, `SellerCity`, `SellerState`, `SellerZip`, `SellerPhone`, `SellerCode`.
  - `ProductAgreementNumber` = `form.agreement_number ?? ''` (eContracting is unbuilt — spec R4).
  - Signature fields are NOT emitted; DocuSeal fills them from submitter roles.
- `createSubmission({ templateId, fields, submitters }, ctx)` — a fixture/live fork mirroring `stoneeagle.js#resolveProviderMode`: in fixture mode return `{ status: 'ok', submission_id: 'sub_fixture_<templateId>', submitters: [...] }` without a network call; in live mode POST to `${credentials.api_url}/api/submissions` with an `X-Auth-Token` header.

Add a file header documenting that the six home templates share an identical field set, that `Deluxe` is always checked, and that the `Property*` field names depend on template changes tracked as spec R5.

Create `packages/integrations/signing/index.js` exporting `resolveTemplateId`, `buildHomeSubmissionFields`, and `createSubmission`, matching the shape of `packages/integrations/product_admin/index.js`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test packages/integrations/signing/docuseal.test.js`
Expected: PASS — 9 tests, 0 failures.

- [ ] **Step 5: Register the category**

In `packages/integrations/index.js`, move `signing` out of the planned-categories comment and into the implemented exports, following the `product_admin` pattern exactly.

- [ ] **Step 6: Run the whole platform test suite**

Run: `node --test packages/utils/*.test.js packages/integrations/**/*.test.js`
Expected: PASS across all files.

- [ ] **Step 7: Commit**

```bash
git add packages/integrations/signing/ packages/integrations/index.js package.json
git commit -m "feat(integrations): DocuSeal signing client + home field mapping (ADR 30 D8)"
```

---

### Task A8: fixtures and STATUS

**Files:**
- Create: `packages/api/_fixtures/homes.json`
- Modify: `packages/api/_fixtures/opportunities.json`
- Modify: `packages/api/_fixtures/contacts.json`
- Create: `packages/api/homes.js`
- Modify: `packages/api/index.js`
- Modify: `STATUS.md`
- Modify: `PROMPTS.md`

**Interfaces:**
- Produces: `homesApi.list({ contact_id, household_id })`, `homesApi.get(id)`, `homesApi.asMap()`, `homesApi.create(home)` — signatures mirroring `packages/api/contacts.js`. Consumed by Phase B and Phase C.

- [ ] **Step 1: Create three home fixtures**

`packages/api/_fixtures/homes.json`, keyed map (`home_reyes_murray`, `home_alvarez_oak`, `home_chen_condo`), each matching the canon `home` shape from Task A3 Step 1. Cover the interesting cases:

- `home_reyes_murray` — `single_family`, 2,400 sq ft, built 1998, Detroit MI, two `contact_ids`.
- `home_alvarez_oak` — `single_family`, 6,200 sq ft (exercises `sf_5000_8000`), one contact.
- `home_chen_condo` — `condominium`, 1,150 sq ft, one contact.

Each carries `org_id: 102` and a `household_id` matching an existing household in `contacts.json`.

- [ ] **Step 2: Add `homes[]` to the matching contacts**

In `packages/api/_fixtures/contacts.json`, add a `homes: ["home_…"]` array to the three contacts referenced above, mirroring how `vehicles[]` is carried.

- [ ] **Step 3: Add three home_protection opportunities**

In `packages/api/_fixtures/opportunities.json`, add `opp_home_001`, `opp_home_002`, `opp_home_003` with `type: 'home_protection'`, `home_id`, a `home` label string (`"2,400 sq ft Single Family · Detroit, MI"`), a `status` drawn from the new canon block, and a `home_protection_progress: { furthest_step_idx, furthest_step_key, updated_at }` block mirroring `protection_progress`.

Spread them across the funnel: one at `Quoted`, one at `Booked`, one at `Agreement Signed`.

- [ ] **Step 4: Create the homes API module**

`packages/api/homes.js`, a direct structural copy of `packages/api/contacts.js`'s read surface plus a `create` writer following the `opportunities.create` writer-registration model. Export from `packages/api/index.js` as `homes`.

- [ ] **Step 5: Verify fixtures load and cross-reference**

Run:

```bash
node -e "
const fs = require('fs');
const homes = JSON.parse(fs.readFileSync('packages/api/_fixtures/homes.json','utf8'));
const contacts = JSON.parse(fs.readFileSync('packages/api/_fixtures/contacts.json','utf8'));
const opps = JSON.parse(fs.readFileSync('packages/api/_fixtures/opportunities.json','utf8'));
const ids = new Set(Object.keys(homes));
console.assert(ids.size === 3, 'expected 3 homes');
for (const h of Object.values(homes)) {
  console.assert(h.contact_ids.every(c => contacts[c]), 'home references a missing contact: ' + h.id);
  console.assert(h.contact_ids.includes(h.primary_contact_id), 'primary not in contact_ids: ' + h.id);
}
const homeOpps = (opps.opportunities || opps).filter(o => o.type === 'home_protection');
console.assert(homeOpps.length === 3, 'expected 3 home opportunities');
console.assert(homeOpps.every(o => ids.has(o.home_id)), 'opportunity references a missing home');
console.log('OK');
"
```

Expected: `OK`.

- [ ] **Step 6: Verify dwelling classification across the fixture set**

Run:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { classifyDwelling } from './packages/utils/dwelling-class.js';
const canon = JSON.parse(readFileSync('canon/plan-mappings.json','utf8')).home_dwelling_classes;
const homes = JSON.parse(readFileSync('packages/api/_fixtures/homes.json','utf8'));
for (const h of Object.values(homes)) {
  const c = classifyDwelling(h, canon);
  console.log(h.id, '→', c ? c.id : 'INELIGIBLE');
  if (!c) throw new Error('fixture home is ineligible: ' + h.id);
}
"
```

Expected: three lines, `sf_lt_5000`, `sf_5000_8000`, `condo_lt_5000`. No throw.

- [ ] **Step 7: Update STATUS.md and PROMPTS.md**

Add a `## Wave 39 — Home Protection Plan (ADR 30, 2026-08-25)` section at the top of `STATUS.md` following the existing wave format: Trigger, Locked decisions, Phase A (landed), Phases B and C (dispatched/pending), Open loose ends. Carry spec risks R1–R6 into the loose-ends list verbatim.

Add a `§ 39` entry to `PROMPTS.md` holding the Phase B and Phase C dispatch briefs.

- [ ] **Step 8: Commit**

```bash
git add packages/api/ STATUS.md PROMPTS.md
git commit -m "feat(api): home fixtures, homes API surface; STATUS/PROMPTS for Wave 39"
```

---

# PHASE B — `home-protection-portal/` (dispatched)

**Dispatch target:** a fresh agent with the new repo as its working directory. Phase A must be committed first — this repo's `file:../blinker-platform` dep resolves the canon and packages code Phase A creates.

**Model:** Opus. This is greenfield architecture across ~20 files with a novel add-on pricing path; it is not mechanical.

---

### Task B1: repo scaffold

**Files:**
- Create: `home-protection-portal/` — `package.json`, `vite.config.js`, `index.html`, `.gitignore`, `CLAUDE.md`, `src/main.jsx`, `src/App.jsx`, `src/shell/ViewSwitcher.jsx`, `src/shell/HomeProtectionDevControls.jsx`, `src/hooks/useForm.js`, `src/constants/canon/` (populated by the sync script)

**Interfaces:**
- Consumes: `blinker-platform` via `"blinker-platform": "file:../blinker-platform"`.
- Produces: a running dev server and the `?view=customer|agent|partner` switch.

- [ ] **Step 1: Copy the scaffold from `protection-portal`**

Mirror `protection-portal`'s `package.json` (name `home-protection-portal`, same dependency set and versions), `vite.config.js` (including the `/se-rating` proxy to `https://staging.fiadmin.com/scs.webservice` — the home GetRates call goes through the same proxy), `index.html`, and `.gitignore`.

- [ ] **Step 2: Set the git identity and initialize**

```bash
cd home-protection-portal
git init
git config user.name "dealercrm"
git config user.email "chad@carcarepeople.com"
```

- [ ] **Step 3: Write the repo CLAUDE.md**

Modeled on `protection-portal/CLAUDE.md`, stating: this is the Home Protection Plan consumer wizard; canon comes from `blinker-platform` and is synced, never edited here; ADR 30 is the governing decision record; the nine steps and their ids; and that add-on dollars are included in `paymentSchedule` (unlike auto).

- [ ] **Step 4: Sync canon in**

From `blinker-platform`, add the new repo to `scripts/sync-canon-into-apps.sh`'s app list, then run it.

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: clean build, no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold home-protection-portal (ADR 30 D3)"
```

---

### Task B2: form shape and step registry

**Files:**
- Create: `src/views/customer/CustomerView.jsx`
- Create: `src/lib/status-step-map.js`

**Interfaces:**
- Produces: `INITIAL_FORM`, `BASE_STEPS`, `buildSteps(form)`, `HomeWizard`, `CustomerView`, and `stepFromStatus(status)`. **Phase C imports `INITIAL_FORM`, `buildSteps`, and `stepFromStatus` by these exact names** — they are the mission-control embed contract, mirroring how `CoPilotPane.jsx` deep-imports the same three from `protection-portal`.

- [ ] **Step 1: Define `INITIAL_FORM`**

Exactly the shape in spec §6.2. Workflow-agnostic keys copied verbatim from `protection-portal/src/views/customer/CustomerView.jsx:85-206`; vehicle keys replaced by `home`, `homeFeatures`, `coverageTerm`, `selectedAddOns`.

- [ ] **Step 2: Define `BASE_STEPS` and `buildSteps`**

```js
const BASE_STEPS = [
  'home_add',
  'home_features',
  'recommended_coverage',
  'optional_coverages',
  'confirm',
  'billing_payment',
  'docuseal',
  'thank_you',
];
```

`buildSteps(form)` splices in `customize` before `confirm` when `form.customizeRequested`, and **removes** `optional_coverages` when the selected plan's `billing_model === 'monthly_subscription'` (plans 38/48/49 carry no options). Follow `protection-portal`'s splice-by-`indexOf` idiom so `stepIdx` semantics match what Phase C's timeline expects.

- [ ] **Step 3: Write `status-step-map.js`**

`STATUS_TO_STEP` mapping each of the 20 canon `home_protection` status display names to a step key, plus `stepFromStatus(status)`. Model on `protection-portal/src/lib/status-step-map.js`, dropping the VIN-validation entries.

- [ ] **Step 4: Verify the step list**

Run a scratch node check asserting `buildSteps(INITIAL_FORM)` has length 8, that a monthly `selectedPlan` yields 7 without `optional_coverages`, and that `customizeRequested` yields 9.

- [ ] **Step 5: Commit**

```bash
git add src/views/customer/CustomerView.jsx src/lib/status-step-map.js
git commit -m "feat: home wizard form shape + step registry"
```

---

### Task B3: `HomeAdd.jsx`

**Files:**
- Create: `src/views/customer/HomeAdd.jsx`

**Interfaces:**
- Consumes: `classifyDwelling`, `isHomeEligible`, `listHomeTypes` from `blinker-platform/utils`; `AddressBlock`, `Field`, `ScreenHeader`, `WizardFooter` from `blinker-platform/components`; `getRatesForHome` from `blinker-platform/integrations/product_admin`.
- Produces: writes `form.home.*`, `form.home.dwelling_class`, `form.rates`, and `form.status = 'Quoted'`.

- [ ] **Step 1: Build the form**

Fields, mirroring the legacy Add Home screen (spec §2.5): Home Type select (from `listHomeTypes`), an existing-address picker sourced from `contact.addresses` plus the shared `AddressBlock`, Year Built, Square Feet, Purchase Price (optional).

- [ ] **Step 2: Gate on eligibility**

On every change to `home_type` or `square_feet`, recompute `classifyDwelling`. When it returns `null` **and** both inputs are filled, disable Continue and show an inline block: the home type's square-foot ceiling and a line stating this home cannot be covered. Fire `home_protection.customer.home_add.ineligible` with `{ home_type, square_feet }`.

- [ ] **Step 3: Fire GetRates on Continue**

Call `getRatesForHome({ state: form.home.address.state }, { orgId: form.org_id })`. Write the result to `form.rates`, set `form.status = 'Quoted'` (or `'Quoted - No Results'` on an empty product list), and advance. Telemetry: `home_protection.customer.home_add.get_rates.requested` / `.received` / `.failed`.

- [ ] **Step 4: Verify manually**

Run the dev server, enter a 2,400 sq ft single family, confirm rates arrive and the step advances. Enter a 9,000 sq ft condominium, confirm Continue is blocked.

- [ ] **Step 5: Commit**

```bash
git add src/views/customer/HomeAdd.jsx
git commit -m "feat: Add home step with eligibility gate + GetRates dispatch"
```

---

### Task B4: `HomeFeatures.jsx`

**Files:**
- Create: `src/views/customer/HomeFeatures.jsx`

**Interfaces:**
- Consumes: `canon/plan-mappings.json#home_add_ons.categories` for labels and keys.
- Produces: writes `form.homeFeatures` — a boolean per category key.

- [ ] **Step 1: Render twelve questions from canon**

Do not hard-code the list. Map `home_add_ons.categories` to a yes/no control per category, using each category's `label`. Group visually (Kitchen / Outdoor / Systems) but keep the data flat.

- [ ] **Step 2: Default all to false and allow skipping**

None are required. Continue is always enabled. Fire `home_protection.customer.home_features.answered` with the count of `true` values.

- [ ] **Step 3: Commit**

```bash
git add src/views/customer/HomeFeatures.jsx
git commit -m "feat: Home features step (canon-driven add-on prequalifier)"
```

---

### Task B5: `RecommendedCoverage.jsx` and `Customize.jsx`

**Files:**
- Create: `src/views/customer/RecommendedCoverage.jsx`
- Create: `src/views/customer/Customize.jsx`
- Create: `src/components/PlanCard.jsx`
- Create: `src/lib/home-plan-selector.js`
- Create: `src/lib/home-plan-selector.test.js`

**Interfaces:**
- Consumes: `resolvePlanPresentation` from `blinker-platform/utils`.
- Produces: `selectHomePlans({ rates, orgId, mode, termMonths }) -> { plans: { good, better, best }, monthly: {…}|null, hasMonthly, availableTerms }`; writes `form.selectedPlan` and `form.coverageTerm`.

- [ ] **Step 1: Write `home-plan-selector.js`**

Deliberately **not** a copy of `protection-portal/src/lib/plan-selector.js`. Home has no term/mileage optimizer, no new/used preference, no deductible filter, and no tier borrowing (spec §7.3). The algorithm is:

1. Partition products by `billing_model`.
2. Term mode: filter to `coverage_period_months === termMonths`, then bucket by `resolvePlanPresentation(...).planLevel`.
3. Monthly mode: bucket the three monthly products by `planLevel`.
4. `availableTerms` is the sorted distinct set of `coverage_period_months` across term products — used to build the term selector, and it correctly yields `[12,24,36,48]` overall but excludes 12 for plans 36/37.

Write tests covering: the three tiers resolve for each term; selecting 12 months yields only plan 35 (so `better` and `best` are null and the UI must say so); monthly mode yields all three.

- [ ] **Step 2: Build the term selector and the term↔monthly switch**

Reuse ADR 28's global switch pattern. Term mode shows a coverage-term control driven by `availableTerms`. Flipping either the term or the mode **must** clear `form.selectedAddOns` through `revalidateSelections` (Task B6 owns the re-resolution; here just ensure the flip triggers it and never carries stale selections into `paymentSchedule`).

- [ ] **Step 3: Handle the 12-month gap explicitly**

At 12 months only plan 35 exists. Render the Better and Best cards as an explicit "not available at 12 months — choose 24 months or longer" state. Do not silently borrow a different term.

- [ ] **Step 4: Run the selector tests**

Run: `npm test -- src/lib/home-plan-selector.test.js` (or `node --test src/lib/home-plan-selector.test.js` if the repo uses the Node runner)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/customer/RecommendedCoverage.jsx src/views/customer/Customize.jsx src/components/PlanCard.jsx src/lib/home-plan-selector.js src/lib/home-plan-selector.test.js
git commit -m "feat: home plan selection, tier cards, term/monthly switch"
```

---

### Task B6: `OptionalCoverages.jsx`

**Files:**
- Create: `src/views/customer/OptionalCoverages.jsx`

**Interfaces:**
- Consumes: `resolveHomeAddOns`, `sumAddOnPrices`, `revalidateSelections` from `blinker-platform/utils`.
- Produces: writes `form.selectedAddOns` as `[{ key, label, option_id, price, docuseal_field, variant }]`.

- [ ] **Step 1: Resolve the available set**

```js
const available = resolveHomeAddOns({
  options:    form.selectedPlan.options,
  planCode:   form.selectedPlan.plan_code,
  termMonths: form.coverageTerm,
  canonBlock: planMappings.home_add_ons,
});
```

- [ ] **Step 2: Pre-check from `homeFeatures`**

On first mount, pre-select every available add-on whose `key` is `true` in `form.homeFeatures`. The customer can toggle any of them off, and can add ones they did not pre-answer.

- [ ] **Step 3: Render with live pricing and a running total**

One row per available add-on: label, price, checkbox. A sticky footer shows `Plan $X + Options $Y = $Z`. Prices come from the resolved rows — never from a constant.

- [ ] **Step 4: Re-validate on any upstream change**

If `form.selectedPlan.plan_code` or `form.coverageTerm` changed since the selections were written, run `revalidateSelections({ selected, available })`, keep the re-priced rows, and surface a notice naming anything dropped. Fire `home_protection.customer.optional_coverages.revalidated` with `{ kept, dropped }`.

- [ ] **Step 5: Verify the re-pricing path manually**

Pick plan 35 at 36 months, select Plumbing ($152) and Pool ($360). Go back, switch to plan 37. Confirm both re-price to the P/E figures ($186 / $415) and that the Confirm total moves accordingly.

- [ ] **Step 6: Commit**

```bash
git add src/views/customer/OptionalCoverages.jsx
git commit -m "feat: Optional coverages step with plan/term-aware pricing"
```

---

### Task B7: `Confirm.jsx` and `BillingPayment.jsx`

**Files:**
- Create: `src/views/customer/Confirm.jsx`
- Create: `src/views/customer/BillingPayment.jsx`

**Interfaces:**
- Consumes: `sumAddOnPrices`; org `home_protection_billing` from canon.
- Produces: writes `form.payment.*` and `form.paymentSchedule` with an added `add_ons_total` field.

- [ ] **Step 1: Port the payment math with add-ons folded in**

Copy the schedule math from `protection-portal/src/views/customer/Confirm.jsx:255-316`, changing exactly two things: read caps and markup from `org.home_protection_billing` rather than `org.protection_billing`, and compute

```js
const addOnsTotal = sumAddOnPrices(form.selectedAddOns);
const totalCost   = Number(form.selectedPlan.total_cost) + addOnsTotal;
```

`paymentSchedule` gains `add_ons_total`. Every downstream figure — discount ceiling, down payment, monthly payment, due today — derives from `totalCost`, not from `plan.total_cost`.

- [ ] **Step 2: Branch on monthly**

When `form.selectedPlan.billing_model === 'monthly_subscription'`: due today is the monthly charge, the down-payment and months-to-pay controls are hidden and not seeded, and the monthly discount caps apply. Identical to ADR 28 D6.

- [ ] **Step 3: Itemize on screen**

The review panel lists the plan, then each selected add-on with its price, then the total. This is the customer's last look before signing, and the agreement will show the same checkboxes.

- [ ] **Step 4: Port BillingPayment**

Copy `protection-portal/src/views/customer/BillingPayment.jsx` essentially unchanged — FluidPay hosted fields and contact capture are workflow-agnostic. Keep the `updateContactSafe` merge wrapper; `useForm` is a shallow merge and dropping it corrupts `contact`.

- [ ] **Step 5: Verify totals**

Plan 37 at 36 months ($1,425) with Pool ($415) and Plumbing ($186) must show a total of $2,026 on Confirm and charge that amount.

- [ ] **Step 6: Commit**

```bash
git add src/views/customer/Confirm.jsx src/views/customer/BillingPayment.jsx
git commit -m "feat: Confirm with add-on-inclusive totals + billing capture"
```

---

### Task B8: `DocuSeal.jsx` — real integration

**Files:**
- Create: `src/views/customer/DocuSeal.jsx`
- Create: `src/views/customer/ThankYou.jsx`

**Interfaces:**
- Consumes: `resolveTemplateId`, `buildHomeSubmissionFields`, `createSubmission` from `blinker-platform/integrations/signing`.
- Produces: writes `form.docusealCompleted`, `form.status = 'Product Agreement Signed'`, `form.signedAt`, `form.submission_id`.

- [ ] **Step 1: Resolve the template and build the payload**

```js
const templateId = resolveTemplateId({
  orgId:            form.org_id,
  tpaCode:          form.selectedPlan.tpa_code,
  productTypeCode:  form.selectedPlan.product_type_code,
  planCode:         form.selectedPlan.plan_code,
});
const fields = buildHomeSubmissionFields({ form, org, canon });
```

If `templateId` is null, render a blocking error naming the plan code — do not proceed to an unsigned completion.

- [ ] **Step 2: Mount the signing iframe**

`createSubmission` returns a submitter URL; mount it in an iframe and listen for the `completed` and `declined` messages. In fixture mode render the resolved template id and the full field payload in a dev-only panel instead of an iframe, so the mapping is inspectable without a live DocuSeal call.

- [ ] **Step 3: Port ThankYou**

Copy `protection-portal/src/views/customer/ThankYou.jsx`, replacing vehicle labels with the home label.

- [ ] **Step 4: Verify the field payload**

In fixture mode, complete a plan-37 purchase with two add-ons and confirm the dev panel shows `Deluxe: true`, exactly the two selected checkboxes true and the other ten false, `DwellingSfLt5000: true`, and `ProductPrice: "2026.00"`.

- [ ] **Step 5: Commit**

```bash
git add src/views/customer/DocuSeal.jsx src/views/customer/ThankYou.jsx
git commit -m "feat: real DocuSeal signing step + completion"
```

---

### Task B9: agent view and export surface

**Files:**
- Create: `src/views/agent/AgentView.jsx`
- Create: `src/views/agent/index.js`
- Create: `src/views/customer/index.js`

**Interfaces:**
- Produces: **the mission-control embed contract.** `src/views/agent/index.js` exports `AgentView`. `src/views/customer/index.js` re-exports every step component plus `INITIAL_FORM` and `buildSteps`. Phase C imports exactly these.

`AgentView` props, mirroring `protection-portal`'s so `CoPilotPane`'s embed wrapper stays structurally identical: `persona`, `opportunity`, `contact`, `home`, `form`, `update`, `stepIdx`, `setStepIdx`, `onFormChange`, `onHomeCommitted`, `availableStatuses`.

- [ ] **Step 1: Build AgentView**

Model on `protection-portal/src/views/agent/AgentView.jsx`. **Destructure every prop you accept** — React silently discards props that are never named, and this exact bug hid an unused `opportunity` prop in protection-portal's AgentView for many waves.

- [ ] **Step 2: Write the index files**

- [ ] **Step 3: Verify the build and the exports**

Run: `npm run build`
Then verify each named export resolves:

```bash
node --input-type=module -e "
import { AgentView } from './src/views/agent/index.js';
import { INITIAL_FORM, buildSteps } from './src/views/customer/CustomerView.jsx';
console.assert(AgentView && INITIAL_FORM && buildSteps, 'missing export');
console.log('OK');
"
```

Expected: clean build, then `OK`.

- [ ] **Step 4: Commit and report the export surface**

```bash
git add src/views/agent/ src/views/customer/index.js
git commit -m "feat: agent view + mission-control embed export surface"
```

Report back the exact export names and `AgentView` prop list — Phase C's brief depends on them.

---

# PHASE C — mission-control (dispatched)

**Dispatch target:** a fresh agent with `mission-control` as its working directory. Phase B must be committed first.

**Model:** Sonnet. This is threading a new enum value through ~20 known call sites plus two new components cloned from documented siblings. The file:line map is already known and included in the brief.

---

### Task C1: dependency and embed

**Files:**
- Modify: `package.json`, `vite.config.js`
- Modify: `src/components/CoPilotPane.jsx` (`:117-128` type registry; `:1166-1246` EmbedSlot; new `HomeProtectionEmbed` beside `ProtectionEmbed` at `:1250`)

- [ ] **Step 1: Add the dep**

`"home-protection-portal": "file:../home-protection-portal"` in `package.json`. Confirm `vite.config.js`'s react/react-dom dedupe aliases cover it.

- [ ] **Step 2: Extend the type registry**

At `CoPilotPane.jsx:117-128`, add `const HOME_PROTECTION_TYPES = ['home_protection'];` and extend `resolveEmbedKind` to return `'home_protection'` for it.

- [ ] **Step 3: Build `HomeProtectionEmbed`**

Clone `ProtectionEmbed` (`:1250`–`~1563`). Import `AgentView as HomeProtectionAgentView` **lazily** via `React.lazy`, matching refi/insurance rather than protection's eager import. Reuse the step-persistence write-through (`:1415-1518`) verbatim except for the `workflow_type` string (`'home_protection'`) and the opportunity field it updates (`home_protection_progress`).

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

---

### Task C2: registries and labels

**Files (all Modify):** `src/lib/canon.js:14-26,31-36`; `src/lib/status-mapping.js:45-52`; `src/lib/session-data.js:66-108`; `src/personas/agent/AgentInbox.jsx:268-316,644-655`; `src/shell/GlobalSearch.jsx:46-63,184-224`; `src/personas/agent/AgentContacts.jsx:99-116,181-183,245-294`; `src/personas/agent/ContactProfile.jsx:31-36`; `src/shared/AgentMetricsGrid.jsx:61-66,119,148,171,220`; `src/personas/manager/ManagerHome.jsx:288,305,617-627`; `src/personas/manager/AgentProfile.jsx:48`; `src/components/OpportunityTypeMenu.jsx:20-52`; `src/components/StartOpportunityFlow.jsx:64-99,544-552,670-677`; `src/lib/active-workflow.js:11,139-165`; `src/App.jsx:60-70,397-405,565-598`; `src/shared/AdvancedFilter.jsx:18,48`

- [ ] **Step 1: Add the type everywhere it is enumerated**

`TYPE_LABELS.home_protection = 'Home protection'`; `TYPE_BADGE.home_protection` in a distinct color (teal — indigo is protection, and the two must be distinguishable at a glance in the inbox); `TYPE_TILE_ICON.home_protection = House`; `lookupStage` routes `'home_protection'` → `ghlStatus.home_protection`; `WORKFLOW_KEYS` gains `'home_protection'`; `buildNewOpp` seeds initial status `'Empty'`; `AdvancedFilter` gains a `'home'` level with a `home.square_feet` field.

Work through the list above file by file. Every one of these is a known call site — none require searching.

- [ ] **Step 2: Verify no registry was missed**

Run:

```bash
grep -rn "'protection'" src/ --include=*.js --include=*.jsx | grep -v home_protection | wc -l
```

Compare against the same grep for `home_protection`. Investigate any site that handles `'protection'` but not `'home_protection'`, and either add it or note why it is protection-specific.

- [ ] **Step 3: Commit**

---

### Task C3: home asset surfaces

**Files:**
- Create: `src/components/AddHomeModal.jsx`
- Modify: `src/components/CoPilotPane.jsx:2400-2444` (left-rail asset block)
- Modify: `src/personas/agent/ContactProfile.jsx:685-770` (Vehicles section area)
- Modify: `src/lib/session-data.js:160-245` (`appendHomeToContact`)
- Modify: `src/components/StartOpportunityFlow.jsx:60-129,385-410,656-700` (vehicle step → home step for this type)

- [ ] **Step 1: Add the CoPilot Home card**

Beside the Vehicle card, gated on `opportunity.type === 'home_protection'`. Shows address, year built, square feet, and the dwelling-class label from `classifyDwelling`. Use the `House` icon.

- [ ] **Step 2: Add the ContactProfile Homes section**

Directly after the Vehicles section, same card idiom. Each card offers "Start home protection" the way vehicle cards offer their opportunity types.

- [ ] **Step 3: Build AddHomeModal**

Model on `AddVehicleModal.jsx`, but render `HomeAdd`'s field set locally rather than importing the portal's step — the portal step fires GetRates, which the modal must not.

- [ ] **Step 4: Branch StartOpportunityFlow**

When the chosen type is `home_protection`, the asset step picks an existing home or adds one, rather than a vehicle.

- [ ] **Step 5: Commit**

---

### Task C4: progress timeline

**Files:**
- Create: `src/components/RelatedHomeProtectionProgress.jsx`
- Modify: `src/components/CoPilotPane.jsx:1586-1610` (the duplicate step-label map), `:2473-2483` (active mount), `:2605-2661` (related mount)

- [ ] **Step 1: Clone the protection timeline**

Copy `RelatedProtectionProgress.jsx` wholesale. Replace `CANONICAL_STEP_ORDER`, `BASE_STEP_KEYS`, `CONDITIONAL_STEP_KEYS`, `STEP_LABEL`, and `STEP_DESCRIPTION` with the home step set:

```js
const STEP_LABEL = {
  home_add:             'Add home',
  home_features:        'Home features',
  recommended_coverage: 'Recommended coverage',
  customize:            'Customize',
  optional_coverages:   'Optional coverages',
  confirm:              'Review & confirm',
  billing_payment:      'Billing & payment',
  docuseal:             'Sign agreements',
  thank_you:            'Complete',
};
```

`CONDITIONAL_STEP_KEYS` is `['customize', 'optional_coverages']` — `optional_coverages` is conditional because monthly plans drop it.

Keep `resolveActorLabel` / `ActorBadge` from `src/lib/timeline-actor.jsx` unchanged.

- [ ] **Step 2: Add the second copy of the map**

`CoPilotPane.jsx:1586-1610` keeps its own `PROTECTION_STEP_LABEL` duplicate. Add `HOME_PROTECTION_STEP_LABEL` beside it with identical contents, and a comment on both noting they must stay in sync with the timeline component.

- [ ] **Step 3: Mount at both sites**

Active-opp mount beside the protection mount at `:2473-2483` gated on `isActiveHomeProtection`; related-opp mount at `:2605-2661`.

- [ ] **Step 4: Verify**

Run: `npm run build`. Then in the dev server, open each of the three fixture home opportunities and confirm the left rail renders the nine steps with correct past/current/future state and actor badges.

- [ ] **Step 5: Commit**

---

### Task C5: admin surfaces

**Files:**
- Modify: `src/personas/admin/PlanCatalog.jsx:346-353,516-518,531,798`
- Create: `src/personas/super/OrgConfigSections/HomeProtection.jsx`
- Modify: `src/personas/super/OrgConfigSections/` index/registry
- Modify: `src/personas/admin/OrgConfiguration.jsx`
- Modify: `src/lib/super-admin-storage.js` (add `DEFAULT_HOME_PROTECTION`)

- [ ] **Step 1: Add the asset-kind column to PlanCatalog**

A read-only `asset_kind` column plus a Vehicle/Home/All filter on the Plans sub-tab. `AddPlanModal` gains an asset-kind select defaulting to `vehicle`.

- [ ] **Step 2: Build HomeProtection.jsx**

Model on `OrgConfigSections/Protection.jsx`. Edits `opportunities.home_protection.enabled` plus the `home_protection_billing` block from Task A3: markup (fixed-term and monthly, each with a Florida split), discount caps with state chips, down payment, payment term, first payment date.

Surface the canon `_TODO` on the block as a visible warning banner — the seeded markup and EFS figures are placeholders, and an admin must not read them as confirmed.

- [ ] **Step 3: Mirror read-only in admin OrgConfiguration**

- [ ] **Step 4: Verify and commit**

Run: `npm run build`
Expected: clean.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §3 D1 home entity | A3 |
| §3 D2 household + multi-contact | A3, A8 |
| §3 D3 new repo | B1 |
| §3 D4 packages lift | A4, A5, A7 |
| §3 D5 add-on step | B6 |
| §3 D6 features step | B4 |
| §3 D7 add-ons in paymentSchedule | B7 |
| §3 D8 DocuSeal once | A7, B8 |
| §3 D9 org toggle | A3, C5 |
| §4.1 entity shape | A3 |
| §4.2 dwelling_class | A2, A4 |
| §5 canon | A2, A3 |
| §6.1 steps | B2 |
| §6.2 form shape | B2 |
| §7.1 request | A6 |
| §7.2 normalization | A6 |
| §7.3 plan selection | B5 |
| §8.1–8.3 add-ons | A5, B4, B6, B7 |
| §8.4 DocuSeal | A7, B8 |
| §9 mission-control | C1–C5 |
| §11 R1 co-authoritative detector | A2 step 5, A6 step 8 |
| §11 R2 eligibility inferred | A2 step 3 `_TODO`, A4 header |
| §11 R5 template changes | A7 tests assert `Property*` names |
| §11 R6 no hard-coded prices | A5, A6 fixture comment, B6 step 3 |

No spec section is unmapped.

**Placeholder scan:** Task A1 contains bracketed prose markers inside the ADR template; Step 3 of that task greps for them and fails the task if any survive. No other bracketed placeholders remain.

**Type consistency:** `classifyDwelling` returns `{ id, label, docuseal_field } | null` in A4 and is consumed with `.id` / `.docuseal_field` in A7 and C3. `resolveHomeAddOns` returns rows with `{ key, label, option_id, price, docuseal_field, variant }` in A5 and is consumed with those exact names in A7, B6, and B7. `revalidateSelections` returns `{ kept, dropped }` in A5 and is destructured as such in B6. `getRatesForHome(input, ctx)` is defined in A6 and called with that arity in B3. `INITIAL_FORM` / `buildSteps` / `stepFromStatus` are produced in B2 and imported by those names in C1.
