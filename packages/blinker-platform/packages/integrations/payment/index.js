// Public surface for the `payment` integration category.
//
// CHARTER: provider-pluggable down-payment charge clients for the protection
// workflow. Apps import this category; the active provider per org will
// eventually be resolved from canon `integrations.json` + `org-registry.json`.
// For now, EFS (FluidPay-via-cloud-function) is the only provider.
//
// Dep direction (per architecture/11-platform-package-layout.md):
//   - MAY read `../../../canon/*.json` directly.
//   - MAY import sibling packages.
//   - MUST NOT import from any child app.
//
// ---------------------------------------------------------------------
//
// Available public exports:
//
//   import { chargeOneTimeToken } from 'blinker-platform/integrations/payment';
//
//   const result = await chargeOneTimeToken(
//     { token, amount, contact, currency },
//     { orgId }
//   );
//
// Input shape:
//   {
//     token:    string,   // FluidPay one_time_token from Hosted Fields
//                         // (produced by protection-portal FluidPayHostedFields.jsx)
//     amount:   number,   // charge amount in dollars (e.g. 299.00)
//     contact?: object,   // safe fields only: { id, first_name, last_name, email, phone }
//                         //   — NEVER pass raw card data through this function
//     currency: string,   // ISO 4217 (default 'USD')
//   }
//
// Result shape (Promise):
//   {
//     outcome:    'approved' | 'declined' | 'gateway_declined' | 'error' | 'network_error',
//     charge_id:  string | null,         // gateway transaction id when approved
//     classified: {
//       kind:           string,           // 'approved' | 'declined_card' | 'declined_funds' |
//                                         //   'gateway_declined' | 'gateway_timeout' |
//                                         //   'transport' | 'malformed' | 'unknown'
//       code:           string,           // gateway response_code or sentinel
//       displayMessage: string,           // consumer-facing message (safe to render)
//       internalAction: string,           // 'proceed' | 'retry_with_new_card' | 'retry' | 'wait'
//     },
//     raw: object,                        // raw gateway response (or fixture/emulate object)
//     dev: boolean,                       // true when result came from emulation or fixture path
//   }
//
// Dev/test modes (controlled via localStorage, read by efs.js):
//   blinker.dev.payment_mode    → 'fixture' | 'proxy'  (default: 'fixture' in dev; always 'fixture' in prod)
//   blinker.dev.payment_emulate → 'auto' | 'success' | 'declined' | 'gateway_timeout'
//                                  (default: 'auto' — when non-auto, short-circuits proxy with
//                                   a pre-canned deterministic outcome regardless of mode)
//
// Provider selection — EFS (Wave 24):
//   EFS = FluidPay tokenized-charge via a Blinker cloud-function proxy.
//   The cloud-function endpoint is `/efs-charge` (same-origin Vite proxy in
//   protection-portal + mission-control, configured in Wave 24 Task C2).
//
// Refund is stubbed for Wave 25 v3.0.7 (post-payment VIN-validate refund path).
//
// See also:
//   - architecture/09-protection-billing-config.md
//   - packages/integrations/payment/_TODO.md
//   - protection-portal/src/lib/fluidpay.js  (tokenize → one_time_token)
//   - protection-portal/src/shared/FluidPayHostedFields.jsx

export {
  chargeOneTimeToken,
  refundCharge,
  classifyChargeError,
  classifyRefundError,
  _PROVIDER_MODE_KEY,
} from './efs.js';
