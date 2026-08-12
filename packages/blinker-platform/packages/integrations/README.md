# `integrations/` — provider-pluggable external-system clients

Canon (`../../canon/integrations.json`) declares the *shape* of every external system Blinker talks to. This package implements the *clients* — one provider file per impl, behind a category-level facade.

## Why categories instead of one provider per file at root?

Apps care about *what they need* (verify an email, look up a carrier, tokenize a card), not *which vendor we picked* (NeverBounce vs Kickbox, Twilio vs Plivo, FluidPay vs Stripe). A category-level facade lets an admin swap providers per-org without app changes.

```js
// What apps write:
import { verifyEmail } from 'blinker-platform/integrations/email_verification';
const result = await verifyEmail('jane@example.com', { orgId: 102 });

// What the facade does:
//   1. Reads canon org-registry.json::orgs[102].integrations.email_verification
//   2. Resolves active provider (e.g. 'neverbounce') + credentials
//   3. Honors org.test_mode if the provider supports it
//   4. Calls the provider impl
//   5. Returns a normalized result the app can branch on
```

## Provider interface contract

Every category exposes a `_provider.js` declaring the result shape and the per-provider implementation contract. Providers conform to that contract.

Example — `email_verification/_provider.js`:

```js
// Provider implementations must export this shape:
//   export default {
//     id: 'neverbounce',                         // matches canon integrations.json provider id
//     async verify(email, { credentials, testMode, signal }) {
//       // ...vendor-specific HTTP call...
//       return {
//         status: 'valid' | 'invalid' | 'unverified' | 'risky',
//         reason: string | null,                 // 'no_mx' / 'mailbox_full' / 'placeholder' / etc.
//         provider_response_id: string | null,   // for audit log + reproducibility
//         raw: object | null,                    // full vendor response, super-admin only
//       };
//     },
//   };
```

The category index (`email_verification/index.js`) loads the right provider per org and adapts its response.

## Phase 1 fallback

When no provider is enabled for an org, the category function returns:

```js
{ status: 'unverified', reason: 'no_provider', provider_response_id: null, raw: null }
```

Apps treat `'unverified'` as advisory — render a neutral pill, allow the save. This matches the legacy NeverBounce behavior (per `BlinkerLegacy/blinker/app/validators/email_verification_validator.rb` — the blocking line is explicitly commented out).

## Per-org policy

`canon/org-registry.json::orgs[<id>].contact_validation` (NEW block, lands Wave 15d) declares per-org policy:

```jsonc
"contact_validation": {
  "email": {
    "policy": "advisory",         // 'advisory' | 'blocking'
    "skip_for_existing": true     // re-verify on email change only
  },
  "phone": {
    "policy": "advisory",
    "allowed_types": ["mobile", "nonFixedVoip", "tollFree", "voip"]
  }
}
```

Policy is enforced at the consuming UI (PhoneInput / EmailInput in `packages/components/`), not at the integration layer. The integration just reports the verification result; the UI decides whether to gate the save.

## Wave 15d scope

- `email_verification/{index.js, _provider.js, neverbounce.js}` — facade + NeverBounce impl. Stubs for kickbox + zerobounce so future providers drop in cleanly.
- `sms_lookup/{index.js, _provider.js, twilio.js}` — facade + Twilio Lookup v1 impl.
- Canon bump: `integrations.json` adds `email_verification` provider entry; `twilio` provider gets a `lookup_enabled` field (no separate provider for lookup — same creds). New `org-registry.json::orgs[*].contact_validation` block.
