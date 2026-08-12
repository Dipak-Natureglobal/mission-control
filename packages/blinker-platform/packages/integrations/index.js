// Public surface for blinker-platform's external-system integration layer.
//
// CHARTER: provider-pluggable clients for every external system the
// platform talks to, organized by category. Apps import the category
// (e.g. `email_verification`) rather than a specific provider; the
// active provider per org is resolved from canon `integrations.json` +
// `org-registry.json::integrations`.
//
// Layout:
//   integrations/
//   ├── index.js                          ← this file (category index)
//   ├── email_verification/
//   │   ├── index.js                      ← exports verifyEmail(email, { orgId })
//   │   ├── _provider.js                  ← provider interface contract
//   │   ├── neverbounce.js                ← provider impl (Wave 15d)
//   │   ├── kickbox.js                    ← provider impl (future)
//   │   └── zerobounce.js                 ← provider impl (future)
//   ├── sms_lookup/
//   │   ├── index.js                      ← exports lookupPhoneCarrier(phone, { orgId })
//   │   └── twilio.js                     ← provider impl (Wave 15d)
//   ├── payments/
//   │   ├── tokenizer/{fluidpay,...}.js
//   │   ├── plan/{ensurety,...}.js
//   │   └── paylink/{flopay,...}.js
//   ├── crm/{ghl,salesforce,...}.js
//   ├── product_admin/{stoneeagle,express_aftermarket,...}.js
//   ├── insurance/{embedded_insurance,...}.js
//   ├── signing/{docuseal,...}.js
//   ├── communications/{twilio_sms,mandrill,zendesk,...}.js
//   ├── data/{vinaudit,marketcheck,google_places,...}.js
//   ├── banking/{plaid,...}.js
//   └── storage/{s3,...}.js
//
// Provider interface (all integrations follow this shape):
//   - Each category exposes a single function (verifyEmail, lookupPhoneCarrier, ...).
//   - The function reads `org.integrations.<category>` from canon to
//     resolve the active provider + credentials, honoring `org.test_mode`
//     per `canon/integrations.json::_test_mode_principle`.
//   - Returns a normalized result shape — providers translate their
//     wire-level responses into the category's canonical result.
//   - Phase 1: returns { status: 'unverified', reason: 'no_provider' }
//     when no provider configured. Apps treat this as advisory/skip.
//   - Phase 2: real network calls; same result shape.
//
// Dep direction (per architecture/11):
//   - MAY read `../../canon/*.json` (integrations.json, org-registry.json).
//   - MAY import sibling packages (utils, telemetry).
//   - MUST NOT import from any child app.
//
// Per-org policy:
//   `org.contact_validation` (NEW canon block, lands Wave 15d) governs
//   whether validation results are advisory (default — save anyway,
//   surface warning) or blocking (must pass to save). Each integration
//   category surfaces its own policy hook.
//
// Consumers MUST import from category subpaths (per root package.json
// exports field): `'blinker-platform/integrations/email_verification'`,
// not deeper.
//
// ---------------------------------------------------------------------
//
// Available public exports:
//
//   import { getRates } from 'blinker-platform/integrations/product_admin';
//     ↳ StoneEagle / Express Aftermarket VSC + GAP rate quotes (Wave 21).
//       See packages/integrations/product_admin/README.md +
//       architecture/13-stoneeagle-integration.md.
//
//   import { chargeOneTimeToken } from 'blinker-platform/integrations/payment';
//     ↳ FluidPay-via-EFS down-payment charge with fixture + emulate paths
//       for sandbox testing (Wave 24). See packages/integrations/payment/_TODO.md
//       and architecture/09-protection-billing-config.md.
//
//   (email_verification + sms_lookup land separately in Wave 15d when
//   NeverBounce + Twilio Lookup ship.)

// No root-level exports — apps import from category subpaths via the root
// package.json `exports` map (e.g. 'blinker-platform/integrations/product_admin').
