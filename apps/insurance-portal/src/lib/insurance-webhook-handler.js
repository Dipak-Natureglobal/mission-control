// Shared webhook-event handler. Both customer simulator and agent view
// subscribe to the same EI event stream and turn each delivered
// `lead_summary` envelope into a workflow patch + status flip.
//
// Status mapping per architecture/06-embedded-insurance-contract.md:
//
//   EI status                 Blinker machine_id (canon)
//   ────────────────────────  ──────────────────────────
//   verification.completed    capture.completed
//   quote.completed           quote.completed
//   quote.viewed              quote.viewed
//   policy.bound              policy.bound
//   error                     error.verification | error.quote
//                             (disambiguated by summary contents)
//
// Error disambiguation: EI fires a single `error` event regardless of
// phase. The summary block tells us which phase failed:
//   {} (empty)                              → error.verification
//   { insuranceVerification }               → error.verification (verification ran but failed)
//   { quote } or { insuranceVerification, quote } → error.quote
import { STATUS } from '../constants/status-map.js';

function statusForErrorEnvelope(envelope) {
  const summary = envelope?.summary || {};
  const hasQuote = summary.quote != null;
  return hasQuote ? STATUS.ERROR_QUOTE : STATUS.ERROR_VERIFICATION;
}

export function applyWebhookEvent(envelope, updateWorkflow) {
  const status = envelope?.status;
  const summary = envelope?.summary || {};
  const patch = {};

  switch (status) {
    case 'verification.completed': {
      patch.status = STATUS.CAPTURE_COMPLETED;
      patch.capture = {
        eventId: envelope.id,
        eventTime: envelope.eventTime,
        verification: summary.insuranceVerification || null,
      };
      break;
    }
    case 'quote.completed': {
      patch.status = STATUS.QUOTE_COMPLETED;
      patch.quote = {
        eventId: envelope.id,
        eventTime: envelope.eventTime,
        payload: summary.quote || null,
      };
      // EI may include the verification block on quote.completed
      // (Capture+Quote path). Carry it forward if absent.
      if (summary.insuranceVerification) {
        patch.capture = {
          eventId: envelope.id,
          eventTime: envelope.eventTime,
          verification: summary.insuranceVerification,
        };
      }
      break;
    }
    case 'quote.viewed': {
      patch.status = STATUS.QUOTE_VIEWED;
      // Update the quote payload's view timestamp without clobbering
      // the prior quote.completed details.
      if (summary.quote) {
        patch.quote = {
          eventId: envelope.id,
          eventTime: envelope.eventTime,
          payload: summary.quote,
        };
      }
      break;
    }
    case 'policy.bound': {
      patch.status = STATUS.POLICY_BOUND;
      patch.policy = {
        eventId: envelope.id,
        eventTime: envelope.eventTime,
        payload: summary.policy || null,
      };
      break;
    }
    case 'error': {
      patch.status = statusForErrorEnvelope(envelope);
      // Carry whichever summary blocks the partner included so the UI
      // can render context (e.g. show the captured carrier on a
      // quote-phase error).
      if (summary.insuranceVerification) {
        patch.capture = {
          eventId: envelope.id,
          eventTime: envelope.eventTime,
          verification: summary.insuranceVerification,
        };
      }
      if (summary.quote) {
        patch.quote = {
          eventId: envelope.id,
          eventTime: envelope.eventTime,
          payload: summary.quote,
        };
      }
      break;
    }
    default: {
      // Unknown status — defensive: don't update anything. Log via
      // console so we notice in dev.
      // eslint-disable-next-line no-console
      console.warn('[insurance-webhook] unknown status', status, envelope);
      return;
    }
  }
  updateWorkflow(patch);
}
