import { TrendingDown, BadgeDollarSign } from 'lucide-react';
import { formatCents, annualizeFromCents } from '../../lib/money.js';

/**
 * SavingsCard — public component for cross-app rendering of insurance
 * savings. Imported by protection-portal/src/views/customer/Confirm.jsx
 * (file: dep) so the protection-plan confirm screen can dangle the
 * insurance cross-sell at the moment of highest commitment.
 *
 * Consumes the real EI quote summary shape (see canon
 * `_insurance_quote_shape`). Money is in cents and a 6mo period is
 * assumed per architecture/06-embedded-insurance-contract.md until EI
 * confirms.
 *
 * @param {Object} props
 * @param {Object} props.quote — matches canon `_insurance_quote_shape`.
 *   Required: { carrier, totalPremiumCents }. Optional:
 *   { savingsAmountCents } — when absent or null, renders the no-savings
 *   variant (Quote Only path; no captured baseline to compare against).
 * @param {string} [props.captureCarrier] — current carrier from the
 *   verification.completed webhook (Capture+Quote only). Used for "vs.
 *   Geico" copy. Omit for Quote Only.
 * @param {Object} [props.copyOverrides] — { title?, subtitle?, ctaLabel? }
 *   for hosts that want the visual without our copy.
 * @param {Function} [props.onCtaClick] — if absent, no CTA renders
 *   (the host provides its own).
 */
export function SavingsCard({ quote, captureCarrier, copyOverrides, onCtaClick }) {
  if (!quote) return null;
  const { savingsAmountCents } = quote;
  const hasSavings = savingsAmountCents != null && savingsAmountCents > 0;

  if (!hasSavings) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
        <div className="flex items-center gap-2 text-slate-700 mb-1">
          <BadgeDollarSign className="w-4 h-4" />
          <div className="text-xs uppercase tracking-wide font-semibold">
            {copyOverrides?.title || 'Quote returned'}
          </div>
        </div>
        <div className="text-sm text-slate-600 leading-relaxed">
          {copyOverrides?.subtitle || (
            captureCarrier
              ? `No savings to surface against your current ${captureCarrier} policy.`
              : `${quote.carrier || 'Quote'} ${formatCents(quote.totalPremiumCents)} / 6mo. No baseline to compare against (Quote Only path).`
          )}
        </div>
        {onCtaClick && (
          <button
            onClick={onCtaClick}
            className="mt-3 px-3 py-1.5 text-xs rounded-md bg-slate-900 hover:bg-slate-800 text-white font-semibold"
          >
            {copyOverrides?.ctaLabel || 'See the quote'}
          </button>
        )}
      </div>
    );
  }

  const annualized = annualizeFromCents(savingsAmountCents, '6mo');
  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
      <div className="flex items-center gap-2 text-emerald-700 mb-1">
        <TrendingDown className="w-4 h-4" />
        <div className="text-xs uppercase tracking-wide font-semibold">
          {copyOverrides?.title || 'Estimated savings'}
        </div>
      </div>
      <div className="text-3xl font-semibold tracking-tight text-emerald-900">
        {formatCents(annualized, { whole: true })}
        <span className="text-base font-medium text-emerald-700">/year</span>
      </div>
      <div className="text-xs text-emerald-800/80 mt-1">
        {formatCents(savingsAmountCents, { whole: true })} per 6mo
        {captureCarrier && <> vs. your current {captureCarrier} policy</>}.
      </div>
      {onCtaClick && (
        <button
          onClick={onCtaClick}
          className="mt-3 px-3 py-1.5 text-xs rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-semibold"
        >
          {copyOverrides?.ctaLabel || `Switch to ${quote.carrier || 'this carrier'}`}
        </button>
      )}
    </div>
  );
}

// Default export so consumers can `import SavingsCard from ...` per the
// JSDoc-driven habit, and named export keeps existing internal call
// sites working.
export default SavingsCard;
