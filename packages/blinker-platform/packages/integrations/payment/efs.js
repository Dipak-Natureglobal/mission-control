// EFS (FluidPay-via-cloud-function) provider impl for the `payment` category.
//
// Two modes, selected at call-time:
//
//   'fixture'  — Returns a synthetic-success result without any network call.
//                Useful for local dev when the EFS cloud-function isn't running.
//                Sleeps ~400ms to simulate realistic latency.
//
//   'proxy'    — POSTs { token, amount, currency, contact, org_id } to the
//                same-origin relative path `/efs-charge`. The Vite dev-server
//                proxy (added in protection-portal + mission-control vite.config.js
//                in Wave 24 Task C2) forwards to the EFS cloud-function. Production
//                builds force 'fixture' until the backend proxy lands.
//
// Additionally, an EMULATE key controls deterministic outcome injection:
//
//   'auto'            — Normal mode; fixture or proxy as above.
//   'success'         — Pre-canned approved result; no network call. dev: true.
//   'declined'        — Pre-canned declined_card result; no network call. dev: true.
//   'gateway_timeout' — Pre-canned gateway_timeout result; no network call. dev: true.
//
// Mode resolution (per call):
//   - If `import.meta.env.DEV` is false → mode = 'fixture', emulate = 'auto' (always).
//   - Else read both localStorage keys with sensible defaults.
//
// References:
//   - architecture/09-protection-billing-config.md
//   - canon/org-registry.json::orgs[].integrations.efs (TBD Wave 25)
//   - payment-processing-platform/orchestrator/fluidpay/client.js (scaffold)
//   - packages/integrations/payment/_TODO.md

import responseCodes from './responseCodes.js';
import orgRegistry   from '../../../canon/org-registry.json' with { type: 'json' };
import { track }     from '../../telemetry/index.js';

// ---------- Mode resolution ------------------------------------------------

const PROVIDER_MODE_KEY    = 'blinker.dev.payment_mode';
const PROVIDER_EMULATE_KEY = 'blinker.dev.payment_emulate';

// Re-exported so DevPanel can write the mode key directly.
export const _PROVIDER_MODE_KEY = PROVIDER_MODE_KEY;

function resolveProviderMode() {
  let inDev = false;
  try { inDev = !!(import.meta && import.meta.env && import.meta.env.DEV); }
  catch { inDev = false; }
  if (!inDev) return 'fixture';
  try {
    const stored = (typeof localStorage !== 'undefined' && localStorage.getItem(PROVIDER_MODE_KEY)) || null;
    if (stored === 'proxy' || stored === 'fixture') return stored;
  } catch { /* localStorage unavailable */ }
  return 'fixture';
}

function resolveEmulateMode() {
  let inDev = false;
  try { inDev = !!(import.meta && import.meta.env && import.meta.env.DEV); }
  catch { inDev = false; }
  if (!inDev) return 'auto';
  try {
    const stored = (typeof localStorage !== 'undefined' && localStorage.getItem(PROVIDER_EMULATE_KEY)) || null;
    const valid = ['auto', 'success', 'declined', 'gateway_timeout'];
    if (stored && valid.includes(stored)) return stored;
  } catch { /* localStorage unavailable */ }
  return 'auto';
}

// ---------- Constants -------------------------------------------------------

const NETWORK_DELAY_MS = 400;
// Same-origin path; vite dev-server proxy forwards `/efs-charge` → EFS
// cloud-function. Production builds never reach this path — resolveProviderMode()
// forces 'fixture'. The proxy configuration lands in protection-portal +
// mission-control vite.config.js in Wave 24 Task C2.
const PROXIED_PATH = '/efs-charge';

// ---------- Emulate path canned results ------------------------------------

// makeEmulateResult — charge outcomes (used by chargeOneTimeToken).
function makeEmulateResult(emulate) {
  const ts = Date.now();
  if (emulate === 'success') {
    return {
      outcome:    'approved',
      charge_id:  `dev_charge_success_${ts}`,
      classified: {
        kind:           'approved',
        code:           '100',
        displayMessage: 'Approved',
        internalAction: 'proceed',
      },
      raw: { simulated: true, outcome: 'approved' },
      dev: true,
    };
  }
  if (emulate === 'declined') {
    return {
      outcome:    'declined',
      charge_id:  null,
      classified: {
        kind:           'declined_card',
        code:           '200',
        displayMessage: 'Card declined. Try a different payment method.',
        internalAction: 'retry_with_new_card',
      },
      raw: { simulated: true, outcome: 'declined' },
      dev: true,
    };
  }
  if (emulate === 'gateway_timeout') {
    return {
      outcome:    'network_error',
      charge_id:  null,
      classified: {
        kind:           'gateway_timeout',
        code:           'TIMEOUT',
        displayMessage: 'Payment processor did not respond. Please try again in a moment.',
        internalAction: 'retry',
      },
      raw: { simulated: true, outcome: 'gateway_timeout' },
      dev: true,
    };
  }
  return null;
}

// makeRefundEmulateResult — refund outcomes for each emulate mode.
// The same localStorage key (blinker.dev.payment_emulate) controls both charge
// and refund — a single DevPanel toggle drives both call types.
// Divergence from charge outcomes:
//   - 'declined' uses kind 'refund_declined' (not 'declined_card') since there
//     is no card being charged; the gateway is rejecting a credit-back request.
//   - refund_id is null on any non-approved outcome (no refund transaction was created).
function makeRefundEmulateResult(emulate) {
  const ts = Date.now();
  if (emulate === 'success') {
    return {
      outcome:   'approved',
      refund_id: `dev_refund_success_${ts}`,
      classified: {
        kind:           'approved',
        code:           '100',
        displayMessage: 'Refund approved',
        internalAction: 'proceed',
      },
      raw: { simulated: true, outcome: 'approved' },
      dev: true,
    };
  }
  if (emulate === 'declined') {
    return {
      outcome:   'declined',
      refund_id: null,
      classified: {
        kind:           'refund_declined',
        code:           '300',
        displayMessage: 'Refund could not be processed by the gateway. Try again or flag for manual review.',
        internalAction: 'retry_or_manual_review',
      },
      raw: { simulated: true, outcome: 'declined' },
      dev: true,
    };
  }
  if (emulate === 'gateway_timeout') {
    return {
      outcome:   'network_error',
      refund_id: null,
      classified: {
        kind:           'gateway_timeout',
        code:           'TIMEOUT',
        displayMessage: 'Payment processor did not respond. Please try again in a moment.',
        internalAction: 'retry',
      },
      raw: { simulated: true, outcome: 'gateway_timeout' },
      dev: true,
    };
  }
  return null;
}

// ---------- Fixture path (auto+fixture mode, no network) -------------------

async function chargeFixture() {
  await new Promise((resolve) => setTimeout(resolve, NETWORK_DELAY_MS));
  const ts = Date.now();
  return {
    outcome:    'approved',
    charge_id:  `dev_charge_fixture_${ts}`,
    classified: {
      kind:           'approved',
      code:           '100',
      displayMessage: 'Approved',
      internalAction: 'proceed',
    },
    raw: { simulated: true, outcome: 'approved', mode: 'fixture' },
    dev: true,
  };
}

async function refundFixture() {
  await new Promise((resolve) => setTimeout(resolve, NETWORK_DELAY_MS));
  const ts = Date.now();
  return {
    outcome:    'approved',
    refund_id:  `dev_refund_fixture_${ts}`,
    classified: {
      kind:           'approved',
      code:           '100',
      displayMessage: 'Refund approved',
      internalAction: 'proceed',
    },
    raw: { simulated: true, outcome: 'approved', mode: 'fixture' },
    dev: true,
  };
}

// ---------- classifyChargeError --------------------------------------------

/**
 * Classify a raw FluidPay charge response (or a thrown Error) into a
 * structured error payload. Maps FluidPay gateway bucket → platform kind.
 *
 * kind ∈ 'approved' | 'declined_card' | 'declined_funds' |
 *         'gateway_declined' | 'gateway_timeout' | 'transport' |
 *         'malformed' | 'unknown'
 *
 * @param {object|Error|string|null} raw  The raw gateway response object,
 *   a thrown Error, or a raw response body string.
 * @returns {{ kind, code, displayMessage, internalAction }}
 */
export function classifyChargeError(raw) {
  // Thrown Error / network failure
  if (raw instanceof Error) {
    const msg = raw.message || '';
    if (/timeout|timed out|ETIMEDOUT/i.test(msg)) {
      return {
        kind:           'gateway_timeout',
        code:           'TIMEOUT',
        displayMessage: 'Payment processor did not respond. Please try again in a moment.',
        internalAction: 'retry',
      };
    }
    return {
      kind:           'transport',
      code:           'NETWORK_ERROR',
      displayMessage: 'Could not reach the payment processor. Please check your connection and try again.',
      internalAction: 'retry',
    };
  }

  // String body — unlikely but defensive
  if (typeof raw === 'string') {
    return {
      kind:           'malformed',
      code:           'MALFORMED_RESPONSE',
      displayMessage: 'Could not process payment. Please try again.',
      internalAction: 'retry',
    };
  }

  if (!raw || typeof raw !== 'object') {
    return {
      kind:           'unknown',
      code:           raw?.code ?? '?',
      displayMessage: 'Could not process payment. Please try again.',
      internalAction: 'retry',
    };
  }

  // FluidPay response_code → gateway bucket
  const responseCode = raw.response_code ?? raw.status_code ?? null;
  if (responseCode != null) {
    const bucket = responseCodes.gatewayBucketForCode(responseCode);

    if (bucket === responseCodes.GATEWAY_BUCKET.APPROVAL) {
      return {
        kind:           'approved',
        code:           String(responseCode),
        displayMessage: 'Approved',
        internalAction: 'proceed',
      };
    }

    if (bucket === responseCodes.GATEWAY_BUCKET.ISSUER_DECLINE) {
      // Distinguish insufficient-funds from card-level declines via processor code
      const processorCode = raw?.response_body?.card?.processor_response_code ?? null;
      const taxon = processorCode ? responseCodes.classifyProcessorCode(processorCode) : null;
      const isFunds = taxon?.category === 'account' && processorCode === '51';
      return {
        kind:           isFunds ? 'declined_funds' : 'declined_card',
        code:           String(responseCode),
        displayMessage: isFunds
          ? 'Insufficient funds. Please use a different payment method.'
          : 'Card declined. Try a different payment method.',
        internalAction: 'retry_with_new_card',
      };
    }

    if (bucket === responseCodes.GATEWAY_BUCKET.GATEWAY_DECLINE) {
      return {
        kind:           'gateway_declined',
        code:           String(responseCode),
        displayMessage: 'Payment was declined by the processor. Please try a different card or contact your bank.',
        internalAction: 'retry_with_new_card',
      };
    }

    if (bucket === responseCodes.GATEWAY_BUCKET.ERROR) {
      return {
        kind:           'gateway_timeout',
        code:           String(responseCode),
        displayMessage: 'Payment processor error. Please try again in a moment.',
        internalAction: 'retry',
      };
    }

    if (bucket === responseCodes.GATEWAY_BUCKET.PENDING) {
      return {
        kind:           'unknown',
        code:           String(responseCode),
        displayMessage: 'Payment is pending. Please wait a moment and check your status.',
        internalAction: 'wait',
      };
    }
  }

  // Fallback
  return {
    kind:           'unknown',
    code:           raw?.code ?? raw?.response_code ?? '?',
    displayMessage: 'Could not process payment. Please try again.',
    internalAction: 'retry',
  };
}

// ---------- classifyRefundError --------------------------------------------
//
// Separate classifier for refund responses. Most gateway-level error taxonomy
// is the same as charges (timeout, transport, malformed, unknown) but refunds
// have a distinct set of semantic decline reasons that don't map cleanly to the
// charge kind set:
//
//   kind ∈ 'approved' | 'refund_declined' | 'refund_too_old' |
//           'refund_already_processed' | 'gateway_declined' |
//           'gateway_timeout' | 'transport' | 'malformed' | 'unknown'
//
// Divergence from classifyChargeError:
//   - 'declined_card' and 'declined_funds' don't apply to refunds.
//   - 'refund_declined'           — generic gateway rejection of the credit-back.
//   - 'refund_too_old'            — processor rejects refunds past N days (varies
//                                   by processor; FluidPay typically 120 days).
//   - 'refund_already_processed'  — idempotency guard; the charge was already
//                                   fully refunded.
//
// FluidPay indicates these via the `response_code` + optional `message` field.
// Until the live refund endpoint is validated, the mapping is best-effort.
// Update this classifier when the cloud-function contract is confirmed.

export function classifyRefundError(raw) {
  // Thrown Error / network failure
  if (raw instanceof Error) {
    const msg = raw.message || '';
    if (/timeout|timed out|ETIMEDOUT/i.test(msg)) {
      return {
        kind:           'gateway_timeout',
        code:           'TIMEOUT',
        displayMessage: 'Payment processor did not respond. Please try again in a moment.',
        internalAction: 'retry',
      };
    }
    return {
      kind:           'transport',
      code:           'NETWORK_ERROR',
      displayMessage: 'Could not reach the payment processor. Please check your connection and try again.',
      internalAction: 'retry',
    };
  }

  // String body — unlikely but defensive
  if (typeof raw === 'string') {
    return {
      kind:           'malformed',
      code:           'MALFORMED_RESPONSE',
      displayMessage: 'Could not process refund. Please try again.',
      internalAction: 'retry',
    };
  }

  if (!raw || typeof raw !== 'object') {
    return {
      kind:           'unknown',
      code:           raw?.code ?? '?',
      displayMessage: 'Could not process refund. Please try again.',
      internalAction: 'retry',
    };
  }

  // Check message field for refund-specific semantic errors before falling
  // through to the generic gateway-bucket mapping.
  const msg = (raw.message ?? raw.error_message ?? '').toLowerCase();
  if (/too old|past.*refund|refund.*window|exceed.*day/i.test(msg)) {
    return {
      kind:           'refund_too_old',
      code:           raw.response_code ? String(raw.response_code) : 'REFUND_TOO_OLD',
      displayMessage: 'This charge is past the refund window and cannot be refunded automatically. Please flag for manual review.',
      internalAction: 'manual_review',
    };
  }
  if (/already.*refund|refund.*already|duplicate.*refund/i.test(msg)) {
    return {
      kind:           'refund_already_processed',
      code:           raw.response_code ? String(raw.response_code) : 'REFUND_DUPLICATE',
      displayMessage: 'This charge has already been refunded.',
      internalAction: 'no_action',
    };
  }

  // FluidPay response_code → gateway bucket
  const responseCode = raw.response_code ?? raw.status_code ?? null;
  if (responseCode != null) {
    const bucket = responseCodes.gatewayBucketForCode(responseCode);

    if (bucket === responseCodes.GATEWAY_BUCKET.APPROVAL) {
      return {
        kind:           'approved',
        code:           String(responseCode),
        displayMessage: 'Refund approved',
        internalAction: 'proceed',
      };
    }

    // Issuer and gateway declines on a refund both map to refund_declined —
    // the card-level distinction (funds vs. card) is not meaningful for credits.
    if (
      bucket === responseCodes.GATEWAY_BUCKET.ISSUER_DECLINE ||
      bucket === responseCodes.GATEWAY_BUCKET.GATEWAY_DECLINE
    ) {
      return {
        kind:           'refund_declined',
        code:           String(responseCode),
        displayMessage: 'Refund could not be processed by the gateway. Try again or flag for manual review.',
        internalAction: 'retry_or_manual_review',
      };
    }

    if (bucket === responseCodes.GATEWAY_BUCKET.ERROR) {
      return {
        kind:           'gateway_timeout',
        code:           String(responseCode),
        displayMessage: 'Payment processor error during refund. Please try again in a moment.',
        internalAction: 'retry',
      };
    }

    if (bucket === responseCodes.GATEWAY_BUCKET.PENDING) {
      return {
        kind:           'unknown',
        code:           String(responseCode),
        displayMessage: 'Refund is pending. Please wait a moment and check your status.',
        internalAction: 'wait',
      };
    }
  }

  // Fallback
  return {
    kind:           'unknown',
    code:           raw?.code ?? raw?.response_code ?? '?',
    displayMessage: 'Could not process refund. Please try again.',
    internalAction: 'retry',
  };
}

// ---------- Proxy path (Wave 24+ dev mode + production Phase 2) -----------

function resolveOrgId(orgId) {
  if (orgId == null) return null;
  const orgs = Array.isArray(orgRegistry.orgs) ? orgRegistry.orgs : [];
  const org = orgs.find((o) => String(o.id) === String(orgId));
  return org ? String(org.id) : String(orgId);
}

async function chargeProxy({ token, amount, contact, currency, orgId }) {
  // PCI safety: only log last4 if the contact payload happens to carry it.
  // Never log the token itself.
  let rawBody = null;
  let networkError = null;
  try {
    const res = await fetch(PROXIED_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        amount,
        currency,
        contact: contact ? {
          // Only forward safe fields; never forward raw card data
          id:         contact.id        ?? undefined,
          first_name: contact.first_name ?? contact.firstName ?? undefined,
          last_name:  contact.last_name  ?? contact.lastName  ?? undefined,
          email:      contact.email      ?? undefined,
          phone:      contact.phone      ?? undefined,
        } : undefined,
        org_id: orgId,
      }),
    });
    rawBody = await res.json().catch(() => null);
    if (!res.ok) {
      // Non-2xx response — try to extract a structured error
      const classified = classifyChargeError(rawBody || { response_code: res.status });
      return {
        outcome:    classified.kind === 'approved' ? 'approved' : (classified.kind.startsWith('declined') ? 'declined' : 'error'),
        charge_id:  null,
        classified,
        raw:        rawBody || { http_status: res.status },
        dev:        false,
      };
    }
  } catch (err) {
    networkError = err;
  }

  if (networkError) {
    const classified = classifyChargeError(networkError);
    return {
      outcome:    'network_error',
      charge_id:  null,
      classified,
      raw:        { error: networkError?.message || String(networkError) },
      dev:        false,
    };
  }

  const classified = classifyChargeError(rawBody);
  const outcome = classified.kind === 'approved'
    ? 'approved'
    : classified.kind.startsWith('declined') || classified.kind === 'gateway_declined'
      ? 'declined'
      : classified.kind === 'gateway_timeout' || classified.kind === 'transport'
        ? 'network_error'
        : 'error';

  return {
    outcome,
    // EFS cloud-function returns transaction_id on approved
    charge_id: outcome === 'approved' ? (rawBody?.transaction_id ?? rawBody?.id ?? null) : null,
    classified,
    raw:  rawBody,
    dev:  false,
  };
}

async function refundProxy({ charge_id, amount, reason, orgId }) {
  let rawBody = null;
  let networkError = null;
  try {
    const res = await fetch(`${PROXIED_PATH}/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ charge_id, amount, reason, org_id: orgId }),
    });
    rawBody = await res.json().catch(() => null);
    if (!res.ok) {
      const classified = classifyRefundError(rawBody || { response_code: res.status });
      return {
        outcome:   classified.kind === 'approved' ? 'approved'
                 : classified.kind === 'refund_declined' || classified.kind === 'gateway_declined' ? 'declined'
                 : classified.kind === 'gateway_timeout' || classified.kind === 'transport' ? 'network_error'
                 : 'error',
        refund_id: null,
        classified,
        raw:       rawBody || { http_status: res.status },
        dev:       false,
      };
    }
  } catch (err) {
    networkError = err;
  }

  if (networkError) {
    const classified = classifyRefundError(networkError);
    return {
      outcome:   'network_error',
      refund_id: null,
      classified,
      raw:       { error: networkError?.message || String(networkError) },
      dev:       false,
    };
  }

  const classified = classifyRefundError(rawBody);
  const outcome = classified.kind === 'approved'
    ? 'approved'
    : classified.kind === 'refund_declined' || classified.kind === 'refund_too_old' || classified.kind === 'refund_already_processed' || classified.kind === 'gateway_declined'
      ? 'declined'
      : classified.kind === 'gateway_timeout' || classified.kind === 'transport'
        ? 'network_error'
        : 'error';
  return {
    outcome,
    // EFS cloud-function returns refund_id on approved
    refund_id: outcome === 'approved' ? (rawBody?.refund_id ?? rawBody?.id ?? null) : null,
    classified,
    raw:  rawBody,
    dev:  false,
  };
}

// ---------- Public surface --------------------------------------------------

/**
 * Charge a tokenized payment method (FluidPay one_time_token) via EFS.
 *
 * @param {{ token: string, amount: number, contact?: object, currency?: string }} params
 *   - token    — short-lived FluidPay one_time_token from the Hosted Fields
 *                iframe (produced by protection-portal's FluidPayHostedFields.jsx).
 *   - amount   — charge amount in dollars (e.g. 299.00). The EFS cloud-function
 *                converts to cents before forwarding to FluidPay.
 *   - contact  — optional; safe fields only (id, first_name, last_name, email,
 *                phone). Never pass raw card data.
 *   - currency — ISO 4217 (default 'USD').
 * @param {{ orgId?: string|number }} ctx
 * @returns {Promise<{
 *   outcome:    'approved'|'declined'|'gateway_declined'|'error'|'network_error',
 *   charge_id:  string|null,
 *   classified: { kind, code, displayMessage, internalAction },
 *   raw:        object,
 *   dev:        boolean,
 * }>}
 */
export async function chargeOneTimeToken(
  { token, amount, contact, currency = 'USD' },
  { orgId } = {},
) {
  const mode    = resolveProviderMode();
  const emulate = resolveEmulateMode();
  const resolvedOrgId = resolveOrgId(orgId);

  // Telemetry — NEVER log the token itself
  track('protection.efs.charge.attempted', {
    org_id:  resolvedOrgId,
    amount,
    mode,
    emulate,
  });

  let result;

  // 1. Emulate path — deterministic outcome regardless of mode
  if (emulate !== 'auto') {
    await new Promise((resolve) => setTimeout(resolve, NETWORK_DELAY_MS));
    result = makeEmulateResult(emulate);
  }
  // 2. Fixture path — synthetic success, no fetch
  else if (mode === 'fixture') {
    result = await chargeFixture();
  }
  // 3. Proxy path — real /efs-charge call
  else {
    result = await chargeProxy({ token, amount, contact, currency, orgId: resolvedOrgId });
  }

  track('protection.efs.charge.completed', {
    org_id:  resolvedOrgId,
    outcome: result.outcome,
    kind:    result.classified?.kind,
    dev:     result.dev,
  });

  return result;
}

/**
 * Refund a previously-approved charge by charge_id.
 *
 * Hardened in Wave 25 v3.0.7 to match chargeOneTimeToken's shape end-to-end.
 * Consumed by protection-portal RatesChanged.jsx "Refund and exit" CTA.
 *
 * Mode + emulate resolution mirrors chargeOneTimeToken:
 *   - The same two localStorage keys control both charge and refund calls.
 *   - emulate ≠ 'auto' short-circuits to a pre-canned refund outcome (success /
 *     declined / gateway_timeout) regardless of mode.
 *   - mode='fixture' + emulate='auto' → synthetic approved (no network).
 *   - mode='proxy'   + emulate='auto' → POST /efs-charge/refund (Vite proxy
 *     added in Wave 24 Task C2 to protection-portal + mission-control).
 *
 * Proxy backend (/efs-charge/refund) is not yet wired in the cloud-function;
 * see packages/integrations/payment/_TODO.md.
 *
 * @param {{ charge_id: string, amount?: number, reason?: string }} params
 *   - charge_id — the gateway transaction id returned by chargeOneTimeToken.
 *   - amount    — refund amount in dollars. Omit to refund the full charge amount.
 *   - reason    — short slug for audit trail (e.g. 'vin_validate_plan_disappeared').
 * @param {{ orgId?: string|number }} ctx
 * @returns {Promise<{
 *   outcome:    'approved'|'declined'|'gateway_declined'|'error'|'network_error',
 *   refund_id:  string|null,
 *   classified: { kind, code, displayMessage, internalAction },
 *   raw:        object,
 *   dev:        boolean,
 * }>}
 */
export async function refundCharge(
  { charge_id, amount, reason },
  { orgId } = {},
) {
  const mode    = resolveProviderMode();
  const emulate = resolveEmulateMode();
  const resolvedOrgId = resolveOrgId(orgId);

  // Telemetry — charge_id and amount are safe; never log token/PAN/CVV
  track('protection.efs.refund.attempted', {
    org_id:    resolvedOrgId,
    charge_id,
    amount,
    reason,
    mode,
    emulate,
  });

  let result;

  // 1. Emulate path — deterministic refund outcome regardless of mode
  if (emulate !== 'auto') {
    await new Promise((resolve) => setTimeout(resolve, NETWORK_DELAY_MS));
    result = makeRefundEmulateResult(emulate);
  }
  // 2. Fixture path — synthetic approved, no fetch
  else if (mode === 'fixture') {
    result = await refundFixture();
  }
  // 3. Proxy path — real /efs-charge/refund call
  else {
    result = await refundProxy({ charge_id, amount, reason, orgId: resolvedOrgId });
  }

  track('protection.efs.refund.completed', {
    org_id:    resolvedOrgId,
    charge_id,
    outcome:   result.outcome,
    kind:      result.classified?.kind,
    dev:       result.dev,
  });

  return result;
}

// Exposed for diagnostics — DO NOT depend on this from app code.
export { resolveProviderMode as __resolveProviderMode, resolveEmulateMode as __resolveEmulateMode };
