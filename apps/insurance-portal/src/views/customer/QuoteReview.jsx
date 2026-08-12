// Quote review — what the consumer sees on EI's microsite (simulated
// here). EI's webhook contract returns a thin quote summary: carrier,
// totalPremiumCents, optional savingsAmountCents. No coverage limits,
// no deductibles — those don't come back from the EI contract, so we
// don't render a "compare your current coverage" matrix. The headline
// numbers + the SavingsCard (which is the cross-sell export) are what
// stays.
//
// Status flow:
//   QUOTE_COMPLETED → render quote
//   QUOTE_VIEWED    → still render (just a status flip on EI's side)
//   ERROR_QUOTE     → render quote-failed copy
//
// Note vs. prior iteration: the 200ms intent-filter for quote.viewed is
// gone. EI fires quote.viewed itself when the consumer lands on the
// microsite quote screen; we don't synthesize it. The simulator does
// fire it via simulateWebhook on mount as a stand-in for "consumer
// landed on EI's quote page."
import { useEffect, useRef } from 'react';
import { ArrowRight, RefreshCcw, Sparkles, XCircle } from 'lucide-react';
import { ScreenHeader } from 'blinker-platform/components';
import { SavingsCard } from './SavingsCard.jsx';
import { simulateWebhook } from '../../lib/embedded-insurance-mock.js';
import { captureEvent } from 'blinker-platform/telemetry';
import { formatCents, annualizeFromCents } from '../../lib/money.js';
import { STATUS } from '../../constants/status-map.js';

function QuoteSuccess({ workflow, onSwitch }) {
  const quote = workflow?.quote?.payload;
  const captureCarrier = workflow?.capture?.verification?.policyInfo?.carrier;
  const hasSavings =
    quote?.savingsAmountCents != null && quote.savingsAmountCents > 0;
  const annualSavings = annualizeFromCents(quote?.savingsAmountCents, '6mo');

  return (
    <>
      <ScreenHeader
        icon={Sparkles}
        eyebrow={hasSavings ? 'You could save' : 'Quote ready'}
        title={
          hasSavings
            ? `Switch to ${quote.carrier} and save ${formatCents(annualSavings, { whole: true })}/year`
            : `${quote?.carrier || 'Your quote'} · ${formatCents(quote?.totalPremiumCents)} / 6mo`
        }
        subtitle={
          hasSavings
            ? `Quote from ${quote.carrier}. Total premium ${formatCents(quote.totalPremiumCents)} / 6mo.`
            : (captureCarrier
                ? `No savings to surface against your current ${captureCarrier} policy today.`
                : `Quoted without a current-policy baseline (Quote Only flow). Savings comparison unavailable.`)
        }
      />

      <div className="px-6 pb-6 space-y-5">
        <SavingsCard quote={quote} captureCarrier={captureCarrier} />

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-2">
            Quote details
          </div>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-500">Carrier</dt>
            <dd className="text-slate-900 font-semibold">{quote?.carrier || '—'}</dd>
            <dt className="text-slate-500">Premium</dt>
            <dd className="text-slate-900">{formatCents(quote?.totalPremiumCents)} <span className="text-slate-400">/ 6mo</span></dd>
            {hasSavings && (
              <>
                <dt className="text-slate-500">Savings vs current</dt>
                <dd className="text-emerald-700 font-semibold">{formatCents(quote.savingsAmountCents)} / 6mo</dd>
              </>
            )}
            {quote?.id && (
              <>
                <dt className="text-slate-500">Quote ID</dt>
                <dd className="text-slate-700 font-mono text-xs self-center">{quote.id}</dd>
              </>
            )}
          </dl>
        </div>
      </div>

      <div className="px-6 pb-5 pt-4 border-t border-slate-100 flex items-center justify-end">
        <button
          onClick={onSwitch}
          className="px-5 py-2 rounded-md font-semibold text-sm flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white"
        >
          {hasSavings
            ? `Switch and save ${formatCents(annualSavings, { whole: true })}/year`
            : `Buy this ${quote?.carrier || ''} policy`}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </>
  );
}

function QuoteFailed({ workflow }) {
  const captureCarrier = workflow?.capture?.verification?.policyInfo?.carrier;
  return (
    <>
      <ScreenHeader
        icon={XCircle}
        eyebrow="Quote unavailable"
        title="We couldn't generate a quote right now"
        subtitle={
          captureCarrier
            ? `Verification of your ${captureCarrier} policy succeeded, but our partner carriers couldn't return a price.`
            : "Our partner carriers couldn't return a price for this vehicle."
        }
      />
      <div className="px-6 pb-8">
        <div className="flex items-start gap-3 bg-rose-50 border border-rose-100 rounded-md px-4 py-4 text-sm text-rose-900">
          <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">No quote returned</div>
            <div className="text-xs text-rose-800/80 mt-0.5">
              You don't need to do anything right now. We'll text you if we can pull a quote later.
            </div>
          </div>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 w-full flex items-center justify-center gap-2 text-xs px-3 py-2 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
        >
          <RefreshCcw className="w-3 h-3" /> Try again
        </button>
      </div>
    </>
  );
}

export function QuoteReview({ workflow }) {
  const status = workflow?.status;
  const leadId = workflow?.lead?.leadId;

  // Simulator stand-in for "consumer landed on EI's quote screen": fire
  // quote.viewed via the partner mock once. EI fires this themselves
  // in production (consumer never touches Blinker), so this is purely
  // a demo behavior. Guard with a ref so React 18 StrictMode's double
  // effect invoke doesn't double-fire.
  const fired = useRef(false);
  useEffect(() => {
    if (status !== STATUS.QUOTE_COMPLETED) return;
    if (!leadId) return;
    if (fired.current) return;
    fired.current = true;
    simulateWebhook(leadId, 'quote.viewed');
    captureEvent('insurance_quote_viewed_simulated', { lead_id: leadId });
  }, [status, leadId]);

  function onSwitch() {
    captureEvent('insurance_policy_switch_clicked', {
      lead_id: leadId,
      quote_id: workflow?.quote?.payload?.id,
    });
    // In production the consumer clicks "buy" on EI's microsite and EI
    // fires policy.bound back to us. The simulator stands in for that
    // by firing the same webhook from this side.
    if (leadId) {
      simulateWebhook(leadId, 'policy.bound');
    }
  }

  if (status === STATUS.ERROR_QUOTE) {
    return <QuoteFailed workflow={workflow} />;
  }
  return <QuoteSuccess workflow={workflow} onSwitch={onSwitch} />;
}
