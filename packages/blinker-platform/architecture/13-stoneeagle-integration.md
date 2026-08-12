# 13 — StoneEagle (SCS Auto) eRating integration (Wave 21)

## Premise

StoneEagle / SEFI is the **lead VSC product administrator** for the rewrite. Their SCS Auto platform (also branded "SEFI Seller Portal" / "DAP") fronts dozens of warranty providers (AAA, Omega Auto Care, MC, etc.); every customer-facing protection-package decision in protection-portal — what plans surface, what term/mileage/deductible options exist, what add-ons + surcharges apply, what the retail+net rates are, what the regulated markup rules are — flows from a `GetRates` SOAP call to StoneEagle.

The legacy Rails app already implements this end-to-end (`BlinkerLegacy/blinker/lib/blinker/gateway/product_services/stone_eagle_client.rb` + sibling files for `get_rates`, `book_products`, `create_contract`, `error_code_handler`, `get_trims_by_vin`). The rewrite has carried a **mock** of GetRates inline in protection-portal since Wave 16 F4/F5: `protection-portal/src/lib/stoneeagle.js` returns a deterministic FNV-1a-perturbed slice of `protection-portal/src/fixtures/stone-eagle-get-rates.json`, and `protection-portal/src/lib/plan-selector.js` collapses the response into a Best/Better/Good triple via partial-name match against `canon/plan-mappings.json::default_quality_mapping` (lifted from legacy `PlanSelectorService.PLAN_QUALITY_MAPPING`). Both files were grep-anchored as `TODO(W15d-rating-engine)` to mark the lift point.

Wave 21 promotes that mock into a real, canon-driven, provider-pluggable client at `packages/integrations/product_admin/`. **Scope this wave: eRating (`GetRates`) only.** eContracting (`GenerateContract` / `VoidContract` / `PrintContractPDF` / eSignature) is a separately-tracked backlog item — see §Backlog.

The integration partner reference docs (`SEFI-SCS-eRating-Integration-Guide-v1.31.pdf`, `SEFI-SCS-eContracting-Integration-Guide-v1.37.pdf`) live at `architecture/integration-partners/stoneeagle/`. This ADR is derived from those specs; cross-check the PDFs whenever spec ambiguity arises.

## Locked decisions (2026-05-09)

1. **Lift to `packages/integrations/product_admin/` now**, even with one consumer (protection-portal) today. Breaks the 3-strikes rule deliberately because StoneEagle is high-stakes, the lift point is already grep-anchored, and the second consumer (Express Aftermarket / Omega) is in canon and will arrive when GAP for refi-portal lands.
2. **Phase 1 stays fixture-backed** at the new home. Phase 2 will route through a Blinker backend proxy — out of frontend scope (StoneEagle is SOAP + per-org credentials; the browser must NEVER call the SOAP endpoint directly).
3. **Plan-tier mapping (Good/Better/Best) stays in the consumer** (protection-portal `lib/plan-selector.js`). The integration package returns the *normalized GetRates response*; tier collapse is workflow-specific (insurance-portal won't need it; mission-control's cross-org rate analysis won't need it). Canon `plan-mappings.json` is the shared lookup.
4. **`canon/integrations.json::providers.stoneeagle` schema change**: rename `endpoint_url` → `web_service_base_url` (one base URL; both ASMX paths derive from it). Tighten `products_filter` to `enum-array` with the 12 canonical Product Type Codes from spec §ProductCollection. Add optional `recipient_id`.
5. **Fixture lives at `packages/integrations/product_admin/_fixtures/stone-eagle-get-rates.json`** post-lift. The protection-portal copy is deleted (per `architecture/11-platform-package-layout.md` dep-direction rule 3 — `packages/*` cannot import from a child app).

## Public API surface

```js
import { getRates } from 'blinker-platform/integrations/product_admin';

const result = await getRates(input, { orgId, signal });
```

### `input` (normalized request shape)

```jsonc
{
  "vehicle": {
    "vin": "2HGFE2F54SH551994",        // optional if YMMT provided
    "year": 2025, "make": "Honda",
    "model": "Civic", "trim": "Sport",  // trim required if VIN has multiple
    "odometer": 1500,
    "purchase_price": 28500.00,
    "purchase_date": "2026-05-09",
    "inservice_date": "2025-08-01",
    "ownership": "P",                   // 'N' new | 'P' pre-owned | blank
    "msrp": 31000.00,                   // required for GAP/EWT
    "nada": 27500.00,                   // required for GAP/EWT (pre-owned)
    "asset_type": "T",                  // Polk codes (see spec appendix)
    "body_style": "...", "tonnage": "...", /* etc. */
  },
  "sale": {
    "date": "2026-05-09",
    "new_used": "U",                    // 'N' | 'U' | '*'
    "state": "GA"
  },
  "finance": {
    "amount": 27000.00,
    "term_months": 60,
    "type": "LOAN",                     // 'BALL' | 'LEAS' | 'LOAN' | 'CASH'
    "apr": 6.99
  },
  "product_collection": ["VSC", "GAP"], // optional whitelist; empty = all
  "filter": {                           // optional term/mileage range filter
    "term_min": 24, "term_max": 60,
    "mileage_min": 36000, "mileage_max": 100000
  }
}
```

### Result (normalized GetRates response)

```jsonc
{
  "status": "ok" | "no_provider" | "error",
  "quote_id": "12345678",
  "quote_expiration": "2026-06-08",
  "plan_rates": [
    {
      "plan": {
        "product_type_code": "VSC",
        "product_type_description": "Vehicle Service Contract",
        "plan_code": "51",
        "plan_description": "EXCLUSIONARY",
        "plan_id": "12345",
        "rate_book": "RB001",
        "ownership_type_code": "F",     // B|L|F|A|C
        "contract_plan_name": "Omega EXCL Add-On",
        "program_id": "999",
        "discountable": 1,
        "pdf_form_no": "OMGA-VSC-051"
      },
      "rate_class_moneys": [
        {
          "term_mile": { "term_id": "1", "term": 48, "mileage": 50000 },
          "deductible": { "deduct_id": "1", "deduct_amt": 100, "deduct_type": "Standard" },
          "rate": {
            "rate_id": "...",
            "retail_rate": 3293.00,
            "net_rate": 1850.00,
            "max_retail_rate": 3293.00,
            "min_retail_rate": 2200.00,
            "regulated_rule_id": 0,
            "expiration_date": "2030-05-09",
            "expiration_mileage": 51500,
            "markup_min": 0, "markup_max": 1500,
            "rate_details": {
              "remit": 1850, "cost": 2300, "retail": 3293,
              "admin_markup": 450, "base_markup": 200, "fi_markup": 743
            },
            "tax": { /* per-state tax fields if configured */ }
          },
          "options": [
            {
              "option_id": "EEP",
              "option_desc": "EEP-Enhanced Electronics Package",
              "retail_rate": 95, "net_rate": 50,
              "is_surcharge": false,
              "option_name": "EEP",
              "pdf_form_no": "..."
            }
          ]
        }
      ],
      "additional_contract_infos": [
        { "field_order": 1, "field_label": "Co-Borrower SSN",
          "field_type": "Alphanumeric", "length": 9, "required": true }
      ]
    }
  ],
  "manufacture_warranties": [
    { /* base + powertrain + emissions term/mileage */ }
  ],
  "errors": [
    { "error_number": 0, "error_code": "...", "error_description": "..." }
  ]
}
```

### Phase-1 fallback shapes

When the org has no provider configured for `product_admin` category (or the provider is the `not_implemented` Express Aftermarket stub), the facade returns:

```js
{ status: "no_provider", reason: "no_provider_configured", plan_rates: [] }
```

Consumers treat this as "no rates available — render an empty state, advance through the wizard with a marker note." Matches the legacy soft-fail pattern.

## RegulatedRuleId behavior (UI matrix)

Returned per `rate.regulated_rule_id`. Powers retail-vs-markup editability in protection-portal `Customize.jsx` + `Confirm.jsx`:

| `regulated_rule_id` | Spec name | Retail editable? | Markup behavior |
|---|---|---|---|
| `0` | Non-regulated | Yes | Free — seller adds any markup. Retail = NetRate + Markup + (admin markup if present). |
| `3` | Filed rate | NO | Locked at `retail_rate`. Markup field HIDDEN. Florida VSC + Texas GAP typically. |
| `5` | Capped markup | Yes (within range) | Markup must be in `[markup_min, markup_max]` inclusive. UI clamps + warns. |
| `6` | Finance-capped | Yes (≤ cap) | `retail ≤ financed_amount − (%msrp_or_nada × value)`. UI computes the cap and clamps. |

Per spec §Rating Rules: "When displaying rates for plans with RegulatedRuleId = 3, the Retail Rate from the rating response XML should be displayed without any markups applied **and the rate should not be editable**." This is an enforced UX rule, not a guideline.

## Discountable flag

Per spec §Plan Object: `discountable: 1` permits the seller to discount retail BELOW the response retail (down to net rate, not below); `0` forbids any discount. Independent of `regulated_rule_id` (a `regulated_rule_id=3` plan with `discountable=0` is fully locked; a `regulated_rule_id=3` plan with `discountable=1` allows discount but no markup).

The `discount.disabled_in_states` block in `canon/org-registry.json::orgs.<id>.protection_billing` (see ADR 09) layers ON TOP — even a discountable plan cannot be discounted in FL.

## Plan-tier mapping (Good/Better/Best)

Lives in protection-portal `lib/plan-selector.js`, NOT in the integration package. The integration returns raw plan rates; the consumer collapses them into Best/Better/Good for the customer-facing `RecommendedCoverage.jsx` triple.

Mapping rule (lifted from legacy `PlanSelectorService.PLAN_QUALITY_MAPPING`):
- Partial-match against `plan.contract_plan_name` (or `plan.plan_description`):
  - `EXCL` / `EXCLUSIONARY` → **best**
  - `POWERTRAIN PLUS` / `POWERTRAIN ENHANCED` → **better**
  - `POWERTRAIN` / `USED STATED` / `ADD-ON` → **good**
- See `canon/plan-mappings.json::default_quality_mapping` for the full table.
- Per-(TpaCode, ProductTypeCode, PlanCode) overrides live in `canon/plan-mappings.json::plan_overrides` (populated as plans are mapped in the future admin tool).

## New-vs-Used eligibility

Per legacy `PlanSelectorService` precedence rule, mirrored in `lib/plan-selector.js`:

```
new = (vehicle_age_years < 3) && (odometer < 36000)
sale.new_used = new ? "N" : "U"
```

When set to `"*"`, StoneEagle returns ALL eligible plans (both new and used). The wizard always passes `"N"` or `"U"`, never `"*"`.

## Test-mode fan-out

Per `canon/integrations.json::_test_mode_principle` (and ADR 10), when `org.test_mode === true` the integration reads the entire `credentials.test` block:
- `web_service_base_url.test` (e.g., UAT staging URL)
- `tpa_code.test` (e.g., `APEX_TEST`)
- `user_id.test`, `password.test`, `dealer_no.test`

Otherwise it reads `credentials.live`. **All credentials flip together** — no partial overrides. Matches legacy `stone_eagle_client.rb:17`. The mission-control admin Integrations confirm-modal (per ADR 10) lists StoneEagle in the providers-that-flip list when an admin toggles `test_mode` on an org.

## Fixture vs real seam (Phase 1 / Phase 2)

`packages/integrations/product_admin/stoneeagle.js` carries a single internal constant:

```js
const _PROVIDER_MODE = 'fixture'; // 'fixture' | 'proxy'
```

- **`fixture`** (Phase 1, today): returns `_fixtures/stone-eagle-get-rates.json` with FNV-1a-seeded price perturbation by VIN. Canonical VIN `2HGFE2F54SH551994` anchored at 1.00x; other VINs scaled in `[0.85, 1.15]` deterministically. Same logic lifted from `protection-portal/src/lib/stoneeagle.js`.
- **`proxy`** (Phase 2, future): POSTs JSON to a Blinker backend proxy that fronts the StoneEagle SOAP endpoint. Proxy is responsible for: SOAP envelope construction, credential injection (server-side, never browser), per-org `test_mode` URL+credential selection, response normalization back into the JSON shape above, error-code retry logic (legacy `error_code_handler.rb` retries on `ERATING_TRIMREQ` after fetching trims via `GetTrimsByVIN`).

The mode flip is **one-line** when Phase 2 lands; the public surface (`getRates(input, ctx)`) does NOT change.

## Why this can't run from the browser directly

1. **SOAP/XML over HTTPS** — browsers can technically POST XML, but every payload includes the per-org `Password` field. CORS aside, that's a credential-leak risk.
2. **Per-org credentials** — Phase 2 stores credentials encrypted-at-rest server-side per ADR 10. The browser must request rates by `orgId`, not by credentials. The proxy reads creds from the encrypted store, builds the SOAP envelope, and returns normalized JSON.
3. **CORS** — the SCS endpoints are not browser-CORS-friendly. SOAP services typically aren't.
4. **Audit log** — every GetRates call should log to `api_responses` (legacy pattern); a backend proxy is the right place to write that log.

This is why Phase 1 stays fixture-backed and Phase 2 needs a backend. **No Phase 1 work depends on backend availability.**

## Backlog — eContracting (separate wave)

The v1.37 spec covers `GenerateContract`, `VoidContract`, `PrintContractPDF`, and the `Sign<Type><Actor><Date>` PDF signature-field naming convention. None land in Wave 21. The follow-up wave needs:

1. **`bookContract(input, ctx)`** in `packages/integrations/product_admin/index.js` — POSTs the finalized contract (selected plan + term/mileage/deductible + options + customer + address + lien-holder + Base64-encoded signed `ContractPDF`) to the proxy, receives `ContractNumber` + `EffectiveDate` + `EffectiveOdometer` + `ExpirationDate`.
2. **`voidContract(contractNumber, ctx)`** — for cancellation flows.
3. **`printContractPDF(contractNumber, ctx)`** — for re-prints.
4. **DocuSeal template alignment** — DocuSeal templates must render PDF form fields named per the SCS convention (`SignFullBuyer`, `SignFullBuyerDate`, `SignFullCoBuyer1`, `SignFullCoBuyer1Date`, `SignFullSeller`, `SignFullSellerDate`, `SignInitBuyer`, `SignInitCoBuyer1`). When a state-specific template overrides DocuSeal, the override (per `canon/integrations.json::providers.docuseal.fields.template_overrides`) must preserve the signature-field naming.
5. **ThankYou.jsx** today renders a placeholder `AMR` + 13-digit fake contract number; replace with the real `ContractNumber` from `bookContract` once it lands.
6. **Error-code retry** — legacy `error_code_handler.rb` catches `ERATING_TRIMREQ`, fires `GetTrimsByVIN`, prompts the user to disambiguate trim, then retries `GetRates`. The proxy implements this; the frontend exposes a "select trim" UI when the retry returns the trim list.

## Backlog — auxiliary calls

- **`GetTrimsByVIN`** (v1.31 spec §Get Trims By VIN) — needed when a VIN has multiple trims and the user must disambiguate. Triggered automatically by the error-handler retry described above. Surface a chip-list of trims in `RecommendedCoverage.jsx` when the retry surfaces options.
- **`GetLienholders`** (v1.31 spec §Get Lienholders) — needed for lien-holder dropdown in BillingPayment.jsx (when the consumer is financing through a known lender). Today the consumer types lien-holder details by hand.

## Cross-references

- Reference PDFs: `architecture/integration-partners/stoneeagle/`
- Canon: `canon/integrations.json::providers.stoneeagle`, `canon/org-registry.json::orgs.<id>.integrations.stoneeagle`, `canon/plan-mappings.json`
- Platform code: `packages/integrations/product_admin/{index,_provider,stoneeagle,express_aftermarket}.js`
- Consumer (today): `protection-portal/src/views/customer/{CustomerView,RecommendedCoverage}.jsx` + `src/lib/plan-selector.js`
- Admin UX rules: `architecture/10-admin-console.md` (test_mode + credential storage)
- Package boundary rules: `architecture/11-platform-package-layout.md` (dep direction; `packages/integrations/` charter)
- Legacy SOAP client (read-only reference): `BlinkerLegacy/blinker/lib/blinker/gateway/product_services/stone_eagle_client.rb`, `stone_eagle/{get_rates,book_products,create_contract,error_code_handler,get_trims_by_vin}.rb`
- Legacy Rails ADR: `BlinkerLegacy/docs/blinker/current-state/architecture/06-product-services-providers.md`
