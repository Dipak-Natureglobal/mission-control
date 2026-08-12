# integrations/ — Wave 15d + beyond backlog

## Wave 15d — first two categories

- [ ] `email_verification/_provider.js` — provider interface contract.
- [ ] `email_verification/index.js` — facade: read canon, resolve provider, dispatch, normalize.
- [ ] `email_verification/neverbounce.js` — NeverBounce v4 `single/check` impl. Lift logic from `BlinkerLegacy/blinker/app/services/external_email_verifier.rb` + `app/validators/email_verification_validator.rb`. Cache via in-memory Map keyed on email (5-min TTL matches legacy `Rails.cache.fetch(cache_key, expires_in: 5.minutes)`).
- [ ] `email_verification/kickbox.js` — stub returning `{ status: 'unverified', reason: 'not_implemented' }` so canon can declare it without breaking.
- [ ] `email_verification/zerobounce.js` — same stub treatment.
- [ ] `sms_lookup/_provider.js` — provider interface contract.
- [ ] `sms_lookup/index.js` — facade.
- [ ] `sms_lookup/twilio.js` — Twilio Lookup v1 carrier-type impl. Lift logic from `BlinkerLegacy/blinker/app/services/phone_type_checker.rb`. ALLOWED_SMS_TYPES list comes from canon `org-registry.json::contact_validation.phone.allowed_types` (new block).
- [ ] Canon bump: `integrations.json` add `email_verification` provider with `provider_id` enum + `api_key` field; extend `twilio` with `lookup_enabled` boolean. `org-registry.json::orgs[*]` add `contact_validation` block (default advisory policy + standard allowed_types). New canon `_version`.
- [ ] ADR: `architecture/11-platform-package-layout.md` already covers the package shape; per-org validation policy may warrant its own ADR if the policy story grows (e.g., Wave 15e adds blocking-mode UX).

## Email format checks (also lift from legacy)

The legacy `EmailFormatValidator` does FORMAT validation pre-network:
- Regex format check
- 30-domain typo dictionary (gmal.com → gmail.com)
- Placeholder prefix pattern (`na@`, `test@`, `noemail@`, etc.)
- Placeholder domain list (mailinator, tempmail, etc.)
- MX lookup (Resolv::DNS in legacy — no equivalent in browser; skip in Phase 1, defer to NeverBounce)
- Testing-domain whitelist

Lift the typo dictionary + placeholder patterns to `packages/utils/email-format.js` (pure, no network). `packages/components/EmailInput.jsx` uses it inline before the async deliverability call. Keeps the typo correction local + cheap.

## Wave 21 — landed (2026-05-09)

- [x] `product_admin/{index.js, _provider.js, stoneeagle.js, express_aftermarket.js}` — StoneEagle GetRates lifted from `protection-portal/src/lib/stoneeagle.js`; Express Aftermarket as a stub. Phase 1 fixture-backed; Phase 2 proxy mode is a one-line cutover at `_PROVIDER_MODE` in `stoneeagle.js`. Canon: `integrations.json::providers.stoneeagle` schema bumped (`web_service_base_url` rename, `enum-array` products_filter with 12 codes, `recipient_id`); `org-registry.json` Apex 102 carries OMGA UAT creds in test block; `plan-mappings.json` extended with `product_type_codes` + `regulated_rule_behavior` + `discountable_flag_behavior`. ADR: `architecture/13-stoneeagle-integration.md`. Spec PDFs: `architecture/integration-partners/stoneeagle/`.

## Future categories

When second consumer of an integration arrives (3-strikes deferred), lift:

- [ ] `payments/tokenizer/fluidpay.js` — currently inline in protection-portal BillingPayment.
- [ ] `payments/plan/ensurety.js` — currently inline in protection-portal.
- [ ] `payments/paylink/flopay.js` — currently inline in protection-portal.
- [ ] `crm/ghl.js` — Phase 2 sync target; no consumer today.
- [ ] `insurance/embedded_insurance.js` — currently inline in insurance-portal.
- [ ] `signing/docuseal.js` — currently mocked.
- [ ] `communications/{twilio_sms,mandrill,zendesk}.js` — Phase 2.
- [ ] `data/{vinaudit,marketcheck,google_places}.js` — currently inline (Google Places hardcoded inside AddressBlock today).
- [ ] `banking/plaid.js` — Phase 2.
- [ ] `storage/s3.js` — Phase 2.

## eContracting follow-up wave (StoneEagle backlog)

- [ ] `product_admin/index.js::bookContract` — POSTs finalized contract (selected plan + term/mileage/deductible + options + customer + lien-holder + Base64 ContractPDF) per v1.37 §GenerateContract.
- [ ] `product_admin/index.js::voidContract` + `printContractPDF` per v1.37 §VoidContract / §PrintContractPDF.
- [ ] `product_admin/index.js::getTrimsByVIN` (v1.31 §Get Trims By VIN) — auxiliary, drives error-code retry on `ERATING_TRIMREQ`.
- [ ] `product_admin/index.js::getLienholders` (v1.31 §Get Lienholders) — drives lien-holder dropdown in BillingPayment.jsx.
- [ ] DocuSeal template alignment with `Sign<Type><Actor><Date>` PDF field naming convention (v1.37 §eSignature).
- [ ] Replace `protection-portal/src/views/customer/ThankYou.jsx` placeholder AMR contract number with real ContractNumber from bookContract response.
