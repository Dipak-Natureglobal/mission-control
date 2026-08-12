// Mock for the Embedded Insurance partner contract. Models the real
// EI surface (POST /auto/v1/leads, POST /auto/v1/leads/:id/get-link,
// webhook stream of `lead_summary` envelopes) so the prototype can
// iterate without sandbox creds. Authoritative reference:
// architecture/06-embedded-insurance-contract.md.
//
// What lives here:
//   authenticate(...)            — fake OAuth2 client_credentials response
//   createLead(payload, opts)    — fake POST /auto/v1/leads (4xx → DuplicateLeadError)
//   getLeadLink(leadId, opts)    — fake POST /auto/v1/leads/:id/get-link
//   subscribeWebhooks(...)       — listen for delivered lead_summary events
//   simulateWebhook(...)         — synthesize a lead_summary envelope and deliver
//
// Webhook chain (driven by createLead's `flowPath` opt; see also session
// state stashed at create time):
//
//   capture_and_quote (preferred):
//     verification.completed → ~1200ms → quote.completed
//     (further events — quote.viewed, policy.bound — driven by the
//     simulator UI or DEV CONTROLS buttons; not auto-chained because
//     EI fires them in response to consumer actions on the microsite,
//     which are themselves user-driven on our side too)
//
//   quote_only (escape hatch):
//     quote.completed (no verification step; savingsAmountCents may be null)
//
// `flowPath` design note: per canon
// `_insurance_flow_paths.selection_mechanism_TODO`, the real EI
// mechanism for selecting Quote Only is unspecified. We attach
// `flowPath` to createLead as a placeholder; it likely lives on either
// `partnerData` on POST /leads or as a flag on get-link. Adapter swap
// will pick whichever EI exposes.

import verificationFixture from '../fixtures/embedded-insurance-verification.json';
import quoteFixture from '../fixtures/embedded-insurance-quote.json';
import policyFixture from '../fixtures/embedded-insurance-policy.json';

const AUTH_LATENCY_MS = 30;
const CREATE_LEAD_LATENCY_MS = 60;
const GET_LINK_LATENCY_MS = 80;
const DEFAULT_VERIFICATION_DELAY_MS = 1500;
const DEFAULT_QUOTE_DELAY_MS = 1200;

// leadId → Set<onEvent>
const subscribers = new Map();
// leadId → timeoutId for the next pending auto-fired webhook (we only
// ever have one pending at a time per lead in the chain)
const pendingTimers = new Map();
// leadId → { flowPath, nextVerificationOutcome, nextQuoteOutcome,
//            partnerExternalId, payload }
const sessions = new Map();
// Optional: configure createLead to throw DuplicateLeadError on the
// next call. Mock-only knob (real EI returns 4xx synchronously).
let _forceDuplicateOnNextCreate = false;

export class DuplicateLeadError extends Error {
  constructor(message = 'Duplicate lead') {
    super(message);
    this.name = 'DuplicateLeadError';
    this.status = 409;
  }
}

// Mock-only: tells the next createLead call to throw DuplicateLeadError.
// DEV CONTROLS uses this to exercise the duplicate path without a
// dedicated 'duplicate' webhook (canon notes: real EI emits 4xx, not a
// webhook, for duplicates).
export function setForceDuplicateOnNextCreate(v = true) {
  _forceDuplicateOnNextCreate = Boolean(v);
}

function newId(prefix) {
  const uuid =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${uuid}`;
}

function deliver(leadId, payload) {
  const set = subscribers.get(leadId);
  if (!set) return;
  for (const cb of set) {
    try {
      cb(payload);
    } catch {
      // swallow subscriber errors — one bad subscriber shouldn't stop others
    }
  }
}

function clearPending(leadId) {
  const t = pendingTimers.get(leadId);
  if (t != null) {
    clearTimeout(t);
    pendingTimers.delete(leadId);
  }
}

// ----- API surface -----

// Fake OAuth2 client_credentials token response. Real path:
// POST https://auth.embeddedinsurance.com/oauth2/token. Does not check
// inputs — the mock accepts anything and returns a synthetic token.
export function authenticate({ clientId, clientSecret } = {}) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        accessToken: newId('mockaccess'),
        tokenType: 'Bearer',
        expiresIn: 3600,
        _mock: { clientId: clientId || null, clientSecret: clientSecret ? '***' : null },
      });
    }, AUTH_LATENCY_MS);
  });
}

// Fake POST /auto/v1/leads. Returns { leadId, partnerExternalId } in
// <100ms. Throws DuplicateLeadError when configured. Stashes session
// state (flowPath + outcome selectors + the original payload) for the
// chained webhooks to read.
//
// opts.flowPath: 'capture_and_quote' (default) | 'quote_only'
// opts.nextVerificationOutcome: 'completed' (default) | 'error'
// opts.nextQuoteOutcome: 'completed' (default) | 'error'
// opts.autoChain: boolean — if false, suppress auto-firing webhooks
//                 (agent view passes false; customer simulator passes true).
// opts.isTest: boolean — passed through to webhook event metadata.
export function createLead(payload, opts = {}) {
  const {
    flowPath = 'capture_and_quote',
    nextVerificationOutcome = 'completed',
    nextQuoteOutcome = 'completed',
    autoChain = true,
    isTest = true,
  } = opts;

  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (_forceDuplicateOnNextCreate) {
        _forceDuplicateOnNextCreate = false;
        reject(new DuplicateLeadError('Duplicate lead received'));
        return;
      }

      const leadId = newId('lead');
      const partnerExternalId =
        payload?.partnerData?.partnerExternalId || newId('blinkerExt');
      sessions.set(leadId, {
        flowPath,
        nextVerificationOutcome,
        nextQuoteOutcome,
        partnerExternalId,
        payload,
        isTest,
      });

      resolve({ leadId, partnerExternalId });

      if (autoChain) {
        scheduleNextWebhook(leadId);
      }
    }, CREATE_LEAD_LATENCY_MS);
  });
}

// Fake POST /auto/v1/leads/:id/get-link. Returns the one-time consumer
// URL pointing at the EI microsite (mocked here as a same-tab simulator
// URL so DEV CONTROLS' "Open as consumer" stays demoable).
//
// Real shape per canon `_insurance_microsite_url_shape`: just { url }
// (with TODOs to confirm whether EI returns an expiry or the token
// separately). The mock returns { url, token, leadId, partnerBrand,
// _mock_microsite } — extras are mock-only conveniences; the adapter
// will reduce to canon shape.
export function getLeadLink(leadId, { partnerBrand = 'Blinker' } = {}) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const token = newId('miclink').replace('miclink_', '');
      const origin =
        typeof window !== 'undefined'
          ? window.location.origin
          : 'http://localhost:5176';
      // Note the host: would be https://embeddedinsurance.test/microsite
      // in a real partner integration. We point at our customer
      // simulator so the demo's two-sided story works in one app.
      const url = `${origin}/?view=customer&token=${token}&leadId=${leadId}`;
      resolve({
        url,
        token,
        leadId,
        partnerBrand,
        // Mark: consumer-following-this-link IS landing on EI's
        // microsite. The simulator stands in for that microsite.
        _mock_microsite: true,
      });
    }, GET_LINK_LATENCY_MS);
  });
}

// Subscribe to webhook events for a given leadId. Returns an
// unsubscribe fn. Multi-subscriber per lead.
export function subscribeWebhooks(leadId, onEvent) {
  if (!subscribers.has(leadId)) subscribers.set(leadId, new Set());
  subscribers.get(leadId).add(onEvent);
  return () => {
    const set = subscribers.get(leadId);
    if (!set) return;
    set.delete(onEvent);
    if (set.size === 0) subscribers.delete(leadId);
  };
}

// Synthesize and deliver a lead_summary envelope.
//
// `status` is the EI status literal:
//   'verification.completed' | 'quote.completed' | 'quote.viewed' |
//   'policy.bound' | 'error'
//
// opts.errorPhase: 'verification' | 'quote' — used for status='error'
//                  to control which summary contents go out, which the
//                  webhook handler uses to discriminate
//                  error.verification vs error.quote.
// opts.chain: boolean — preserved for back-compat; no longer drives
//             auto-chaining (see Wave 31b-fu note below). Pass
//             chain: false (or omit) — behavior is identical either way.
// opts.savingsOutcome: 'savings' | 'no_savings' — for status='quote.completed'.
//             'no_savings' forces savingsAmountCents = 0 so the agent
//             can demo the InsuranceSavingsCard no-savings state.
//             Defaults to undefined → fixture value used as-is (positive).
//
// Wave 31b-fu: Auto-chain after verification.completed has been REMOVED.
// The discrete DEV CONTROLS buttons ("Simulate capture completed",
// "Simulate quote completed") replace the auto-chain semantics. Each
// transition is now triggered manually so the agent can observe every
// InsuranceSavingsCard state in isolation.
export function simulateWebhook(leadId, status, opts = {}) {
  clearPending(leadId);
  const session = sessions.get(leadId);
  const envelope = buildEnvelope(leadId, status, session, opts);
  deliver(leadId, envelope);
  // Auto-chain intentionally removed (Wave 31b-fu). Each webhook step
  // is now triggered by a discrete DEV CONTROLS button so intermediate
  // card states (capture_link.viewed, capture.completed) are observable.
  // The opts.chain flag is retained in the signature for back-compat
  // but no longer causes any side effects.
}

// Internal: schedule the *first* webhook in the chain after a lead is
// created. Capture+Quote schedules verification.completed (or error if
// the verification outcome is forced); Quote Only schedules
// quote.completed directly.
function scheduleNextWebhook(leadId) {
  const session = sessions.get(leadId);
  if (!session) return;
  const delayMs =
    session.flowPath === 'quote_only'
      ? DEFAULT_QUOTE_DELAY_MS
      : DEFAULT_VERIFICATION_DELAY_MS;
  const t = setTimeout(() => {
    pendingTimers.delete(leadId);
    if (session.flowPath === 'quote_only') {
      const quoteOutcome = session.nextQuoteOutcome || 'completed';
      simulateWebhook(
        leadId,
        quoteOutcome === 'error' ? 'error' : 'quote.completed',
        quoteOutcome === 'error' ? { errorPhase: 'quote' } : {}
      );
    } else {
      const verificationOutcome = session.nextVerificationOutcome || 'completed';
      simulateWebhook(
        leadId,
        verificationOutcome === 'error' ? 'error' : 'verification.completed',
        verificationOutcome === 'error' ? { errorPhase: 'verification' } : {}
      );
    }
  }, delayMs);
  pendingTimers.set(leadId, t);
}

function buildEnvelope(leadId, status, session, opts) {
  const base = {
    id: newId('evt'),
    leadId,
    partnerExternalId: session?.partnerExternalId || null,
    eventType: 'lead_summary',
    eventTime: new Date().toISOString(),
    status,
    summary: {},
  };

  if (status === 'verification.completed') {
    base.summary.insuranceVerification = { ...verificationFixture };
    return base;
  }

  if (status === 'quote.completed') {
    const quote = { ...quoteFixture };
    if (session?.flowPath === 'quote_only') {
      // No baseline → no savings number.
      quote.savingsAmountCents = null;
    }
    // Wave 31b-fu: honor opts.savingsOutcome to drive the no_savings demo.
    // 'no_savings' → savingsAmountCents = 0 so InsuranceSavingsCard renders
    // the "We added a task to monitor for savings." state in isolation.
    if (opts.savingsOutcome === 'no_savings') {
      quote.savingsAmountCents = 0;
    }
    base.summary.quote = quote;
    if (session?.flowPath === 'capture_and_quote') {
      // Per EI docs: quote.completed events MAY also include
      // insuranceVerification when verification ran first.
      base.summary.insuranceVerification = { ...verificationFixture };
    }
    return base;
  }

  if (status === 'quote.viewed') {
    base.summary.quote = { ...quoteFixture, status: 'viewed', viewedAt: base.eventTime };
    return base;
  }

  if (status === 'policy.bound') {
    base.summary.policy = { ...policyFixture, boundAt: base.eventTime };
    return base;
  }

  if (status === 'error') {
    // Error disambiguation per architecture/06: handler reads which
    // summary blocks are present.
    //   verification phase: empty summary OR insuranceVerification only
    //   quote phase:        insuranceVerification + quote, OR quote only
    const phase = opts.errorPhase || 'verification';
    if (phase === 'verification') {
      // Empty summary by default (the more common verification-failure shape).
      // Set opts.includeVerification: true to test the alternate shape.
      if (opts.includeVerification) {
        base.summary.insuranceVerification = { ...verificationFixture, status: 'failed' };
      }
    } else if (phase === 'quote') {
      base.summary.insuranceVerification = { ...verificationFixture };
      base.summary.quote = { ...quoteFixture, status: 'failed' };
    }
    return base;
  }

  return base;
}
