// Step that the simulator parks on while waiting for a webhook. Three
// terminal states route here:
//
//   LEAD_CREATED        → loading copy ("sending to our partner")
//   CAPTURE_COMPLETED   → "policy details captured, generating a quote"
//   ERROR_VERIFICATION  → recoverable failure copy (verification failed)
//
// Quote-stage failure (ERROR_QUOTE) is rendered by QuoteReview's
// QuoteFailed branch, not here, because it implies the wizard already
// has a captured-policy context to surface.
import { AlertTriangle, Loader2, Sparkles } from 'lucide-react';
import { ScreenHeader } from 'blinker-platform/components';
import { STATUS } from '../../constants/status-map.js';

export function GettingQuote({ workflow }) {
  const status = workflow?.status;
  const leadId = workflow?.lead?.leadId;

  if (status === STATUS.ERROR_VERIFICATION) {
    return (
      <>
        <ScreenHeader
          icon={AlertTriangle}
          eyebrow="Verification failed"
          title="Something went wrong on our partner's side"
          subtitle="Your information is safe — we just couldn't verify your current policy this time."
        />
        <div className="px-6 pb-8">
          <div className="flex items-start gap-3 bg-rose-50 border border-rose-100 rounded-md px-4 py-4 text-sm text-rose-900">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Verification didn't complete</div>
              <div className="text-xs text-rose-800/80 mt-0.5">
                A Blinker agent will reach out to finish this manually. No
                action needed from you right now.
              </div>
            </div>
          </div>
          {leadId && (
            <div className="mt-4 text-xs text-slate-500 font-mono">
              ref: {leadId}
            </div>
          )}
        </div>
      </>
    );
  }

  const captureLanded = status === STATUS.CAPTURE_COMPLETED;
  return (
    <>
      <ScreenHeader
        icon={Sparkles}
        eyebrow={captureLanded ? 'Capture received' : 'Working on it'}
        title="We're getting your quote"
        subtitle="Comparing rates with our partner carriers. This usually takes 30–60 seconds."
      />

      <div className="px-6 pb-8">
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-md px-4 py-4 text-sm text-blue-900">
          <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
          <div>
            <div className="font-semibold">
              {captureLanded ? 'Policy details captured' : 'Sending to our partner…'}
            </div>
            <div className="text-xs text-blue-800/80 mt-0.5">
              We'll text you the moment your quote is ready.
            </div>
          </div>
        </div>

        {leadId && (
          <div className="mt-4 text-xs text-slate-500 font-mono">
            lead: {leadId}
          </div>
        )}
      </div>
    </>
  );
}
