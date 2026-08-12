# StoneEagle (SCS Auto / SEFI) — integration partner reference

The two PDFs in this directory are the vendor-supplied API specs that the platform's StoneEagle integration is built to. They are **reference material**, not authored docs — do not edit them. Architectural decisions derived from these specs live in [`../../13-stoneeagle-integration.md`](../../13-stoneeagle-integration.md).

## Files

| File | Version | Pages | Scope |
|---|---|---|---|
| [`SEFI-SCS-eRating-Integration-Guide-v1.31.pdf`](./SEFI-SCS-eRating-Integration-Guide-v1.31.pdf) | v1.31 (2021-05-25) | 30 | `GetRates`, `GetTrimsByVIN`, `GetLienholders` — the rate-quote surface |
| [`SEFI-SCS-eContracting-Integration-Guide-v1.37.pdf`](./SEFI-SCS-eContracting-Integration-Guide-v1.37.pdf) | v1.37 (2021-05-25) | 57 | `GenerateContract`, `VoidContract`, `PrintContractPDF`, eSignature field naming — the contract-booking surface |

## Endpoints (SOAP / ASMX)

Two ASMX endpoints, derived from one base URL per environment:

| Service | Path | Methods |
|---|---|---|
| Rating | `scsautoservice.asmx` | `GetRates`, `GetTrimsByVIN`, `GetLienholders` |
| Contracting | `Contractservice.asmx` | `GenerateContract`, `VoidContract`, `PrintContractPDF` |

The base URL differs between production, UAT, and development environments. The **TPA Code + UserId/Password credentials determine the provider and environment** the request routes to.

## Per-org credential set

Each org carries its own credential block in `canon/org-registry.json::orgs[<id>].integrations.stoneeagle.credentials.{test|live}`:

- `web_service_base_url` — base URL (e.g., `http://www.natinc.com/SCSAutoService/`).
- `tpa_code` — 3-4 char TPA identifier (e.g., `OMGA` for Omega Auto Care, `APEX` for Apex). THE primary per-org identifier.
- `user_id` — partner login.
- `password` — partner password (sensitive, masked in admin UI).
- `dealer_no` — unique dealer identifier within the TPA.
- `recipient_id` — optional integration-partner identifier (per spec v1.30+).
- `products_filter` — array of Product Type Codes to expose (empty = all 12 codes).

Per `canon/integrations.json::_test_mode_principle`, when an org has `test_mode: true` the integration reads the `credentials.test` block; otherwise `credentials.live`. **All** StoneEagle credentials flip together — no partial overrides.

## UAT environment context (non-sensitive)

The UAT dealer admin portal (DAP) for the **OMGA** (Omega Auto Care) TPA is reachable at:

- **Portal**: `https://staging.fiadmin.com/scs.dap.OMGA/`

Note that this is the human-facing DAP UI, **not** the SOAP web service URL. The SOAP endpoint is a different URL on the SCS side (something like `https://staging.scsautoservice.com/SCSAutoService/scsautoservice.asmx` — confirm with SEFI when wiring the backend proxy in Phase 2). User credentials for the DAP and for the SOAP API are managed separately by SEFI.

**Per the credential storage policy in [`../../10-admin-console.md`](../../10-admin-console.md), real passwords NEVER enter canon or any committed file.** Phase 1 canon uses placeholder strings (e.g., `<se-test-pw>`); Phase 2 stores credentials encrypted-at-rest server-side and exposes a reveal endpoint gated on `view_integration_credentials`.

## Product Type Codes (from v1.31 spec §ProductCollection / §Plan Object)

The 12 canonical codes returned by GetRates and recognized by GenerateContract:

| Code | Product |
|---|---|
| `VSC` | Vehicle Service Contract |
| `GAP` | Guaranteed Asset Protection |
| `MNT` | Prepaid Maintenance |
| `AP` | Appearance Protection |
| `PDR` | Paintless Dent Repair |
| `LTW` | Limited Warranty |
| `RHT` | Tire & Wheel |
| `THP` | Theft Protection |
| `EWT` | Extended Wear & Tear |
| `ETCH` | Etch (anti-theft VIN etching) |
| `KEY` | Key Replacement |
| `OTH` | Other Aftermarket Product |

Providers can extend with custom codes; canon lists the 12 above as the default whitelist for the admin UI's `products_filter` chip multiselect.

## RegulatedRuleId (from v1.31 spec §Rate Object / §Rating Rules)

Returned per `Rate` to govern markup behavior:

| Value | Meaning | UI behavior |
|---|---|---|
| `0` | Non-regulated — seller free to add any markup. | Retail editable; markup unrestricted. |
| `3` | Filed rate — must sell at `RetailRate` (e.g., FL VSC, TX GAP). | Retail locked, NOT editable. Markup field hidden. |
| `5` | Capped markup — between `MarkupMin` and `MarkupMax`. | Retail editable within the inclusive range. |
| `6` | Finance-capped — `MaxRetailRate ≤ FinancedAmount − %MSRP/NADA`. | Retail editable up to the computed cap. |

The `Discountable` flag on the Plan further controls whether retail can drop **below** the response retail (down to net rate) — see ADR 13 for the full UX matrix.

## eSignature field naming (from v1.37 spec §eSignature)

Signature form fields on the contract PDF follow the pattern `Sign<SignatureType><Actor><Date>`:

- `SignFullBuyer`, `SignFullBuyerDate`
- `SignFullCoBuyer1`, `SignFullCoBuyer1Date`
- `SignFullSeller`, `SignFullSellerDate`
- `SignInitBuyer`
- `SignInitCoBuyer1`

This naming is the contract that DocuSeal templates must adhere to when StoneEagle eContracting integration lands (see backlog in ADR 13).

## Cross-references

- ADR: [`architecture/13-stoneeagle-integration.md`](../../13-stoneeagle-integration.md)
- Canon: [`canon/integrations.json::providers.stoneeagle`](../../../canon/integrations.json), [`canon/plan-mappings.json`](../../../canon/plan-mappings.json), [`canon/org-registry.json::orgs.102.integrations.stoneeagle`](../../../canon/org-registry.json)
- Platform code: `packages/integrations/product_admin/{index,_provider,stoneeagle,express_aftermarket}.js`
- Legacy SOAP client (read-only reference): `BlinkerLegacy/blinker/lib/blinker/gateway/product_services/stone_eagle_client.rb`, `stone_eagle/{get_rates,book_products,create_contract,error_code_handler,get_trims_by_vin}.rb`
- Admin UX rules: [`architecture/10-admin-console.md`](../../10-admin-console.md) (test_mode fan-out + credential storage policy)
- Package layout rules: [`architecture/11-platform-package-layout.md`](../../11-platform-package-layout.md) (dep direction; `packages/integrations/` charter)
