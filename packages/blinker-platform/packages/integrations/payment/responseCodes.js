// FluidPay response-code taxonomy.
//
// SOURCE: payment-processing-platform/orchestrator/fluidpay/responseCodes.js
// Lifted unchanged (Wave 24 v3.0.6). If the source file changes, keep this
// copy in sync. Original header and all comments preserved below.
//
// ─────────────────────────────────────────────────────────────────────────────

// FluidPay response-code taxonomy.
//
// FluidPay exposes TWO code layers in every transaction response:
//
//   1. `response_code` — gateway-level (100–199 approval, 200–299 issuer decline,
//      300–399 gateway decline, 400–499 error). This is FluidPay's bucket.
//   2. `response_body.card.processor_response_code` — the raw ISO 8583 code from
//      Visa/MC/Amex (e.g. "00", "05", "51", "59"). This is the code your rule
//      engine actually keys off of.
//
// FluidPay explicitly does NOT label declines as "soft" or "hard" — that's up to
// the orchestrator. This module is that mapping. Keep it in sync with the
// decline taxonomy editor in Settings → Retry Rules → Decline Config so the rule
// author and the live runner see the same categorization.
//
// See: fluidpay/API_REFERENCE.md §3 and §8.11.

// ─── Gateway buckets ─────────────────────────────────────────────────────────

export const GATEWAY_BUCKET = {
  APPROVAL: "approval",
  ISSUER_DECLINE: "issuer_decline",
  GATEWAY_DECLINE: "gateway_decline",
  ERROR: "error",
  PENDING: "pending",
  UNKNOWN: "unknown",
};

export function gatewayBucketForCode(code) {
  const n = Number(code);
  if (!Number.isFinite(n)) return GATEWAY_BUCKET.UNKNOWN;
  if (n === 99) return GATEWAY_BUCKET.PENDING;
  if (n === 0) return GATEWAY_BUCKET.UNKNOWN;
  if (n >= 100 && n < 200) return GATEWAY_BUCKET.APPROVAL;
  if (n >= 200 && n < 300) return GATEWAY_BUCKET.ISSUER_DECLINE;
  if (n >= 300 && n < 400) return GATEWAY_BUCKET.GATEWAY_DECLINE;
  if (n >= 400 && n < 500) return GATEWAY_BUCKET.ERROR;
  return GATEWAY_BUCKET.UNKNOWN;
}

// ─── Processor-code taxonomy (ISO 8583) ──────────────────────────────────────
//
// category:  issuer / fraud / account / validation / gateway / other
// severity:  soft | hard | ambiguous
//   soft      → safe to retry (possibly on a different processor or later)
//   hard      → do not retry; requires customer action or card update
//   ambiguous → retryable under some rules, stop under others (let rule engine
//               decide based on attempt count + history)
// retriable: whether the orchestrator's DEFAULT rule may retry this code when
//            no user-authored rule matches. Rule-engine decisions always win.

export const PROCESSOR_CODE_TAXONOMY = {
  "00": { label: "Approved",                        category: "approval",  severity: null,        retriable: false },
  "01": { label: "Refer to card issuer",            category: "issuer",    severity: "soft",      retriable: true  },
  "04": { label: "Pick up card",                    category: "fraud",     severity: "hard",      retriable: false },
  "05": { label: "Do not honor",                    category: "issuer",    severity: "soft",      retriable: true  },
  "06": { label: "General error",                   category: "gateway",   severity: "soft",      retriable: true  },
  "12": { label: "Invalid transaction",             category: "validation",severity: "hard",      retriable: false },
  "13": { label: "Invalid amount",                  category: "validation",severity: "hard",      retriable: false },
  "14": { label: "Invalid card number",             category: "validation",severity: "hard",      retriable: false },
  "15": { label: "No such issuer",                  category: "validation",severity: "hard",      retriable: false },
  "19": { label: "Re-enter transaction",            category: "gateway",   severity: "soft",      retriable: true  },
  "41": { label: "Lost card",                       category: "fraud",     severity: "hard",      retriable: false },
  "43": { label: "Stolen card",                     category: "fraud",     severity: "hard",      retriable: false },
  "51": { label: "Insufficient funds",              category: "account",   severity: "soft",      retriable: true  },
  "54": { label: "Expired card",                    category: "account",   severity: "hard",      retriable: false },
  "57": { label: "Transaction not permitted to cardholder", category: "account", severity: "hard", retriable: false },
  "58": { label: "Transaction not permitted to terminal",   category: "gateway", severity: "hard", retriable: false },
  "59": { label: "Suspected fraud",                 category: "fraud",     severity: "ambiguous", retriable: true  },
  "61": { label: "Exceeds withdrawal amount limit", category: "account",   severity: "soft",      retriable: true  },
  "62": { label: "Restricted card",                 category: "account",   severity: "hard",      retriable: false },
  "63": { label: "Security violation",              category: "fraud",     severity: "hard",      retriable: false },
  "65": { label: "Exceeds withdrawal frequency",    category: "account",   severity: "soft",      retriable: true  },
  "69": { label: "Account expired",                 category: "account",   severity: "hard",      retriable: false },
  "75": { label: "PIN tries exceeded",              category: "account",   severity: "soft",      retriable: true  },
  "78": { label: "Blocked, first-time use",         category: "account",   severity: "soft",      retriable: true  },
  "82": { label: "Invalid CVV",                     category: "validation",severity: "hard",      retriable: false },
  "91": { label: "Issuer unavailable",              category: "issuer",    severity: "soft",      retriable: true  },
  "92": { label: "Financial institution unavailable", category: "issuer",  severity: "soft",      retriable: true  },
  "93": { label: "Cannot complete transaction (legal violation)", category: "validation", severity: "hard", retriable: false },
  "96": { label: "System malfunction",              category: "gateway",   severity: "soft",      retriable: true  },
};

export function classifyProcessorCode(code) {
  if (!code) {
    return { label: "(no processor code)", category: "unknown", severity: null, retriable: false };
  }
  const entry = PROCESSOR_CODE_TAXONOMY[String(code)];
  if (entry) return entry;
  return { label: `Unknown processor code ${code}`, category: "other", severity: "ambiguous", retriable: false };
}

// ─── AVS / CVV helpers ───────────────────────────────────────────────────────

export const AVS_CODE_MEANINGS = {
  M: "Match",
  N: "No match",
  U: "Unavailable",
  I: "Not provided",
  S: "Not supported",
};

export const CVV_CODE_MEANINGS = {
  M: "Match",
  N: "No match",
  U: "Unavailable",
  I: "Not provided",
  S: "Not supported",
};

// Default export for use by efs.js classifier
export default {
  GATEWAY_BUCKET,
  gatewayBucketForCode,
  PROCESSOR_CODE_TAXONOMY,
  classifyProcessorCode,
  AVS_CODE_MEANINGS,
  CVV_CODE_MEANINGS,
};
