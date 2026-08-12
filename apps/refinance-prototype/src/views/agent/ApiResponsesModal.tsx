// "View API Responses" modal — super_admin only.
//
// Surfaces the raw payloads behind the prequal so a super admin can
// debug or audit what each integration returned. Phase 1 sources for
// refi-portal:
//   * runDecision()       → `decision` (the full payload, including
//                            the `log` array of evaluation steps).
//   * Lender offers       → MOCK_OFFERS slice when result === 'offers_returned'.
//                            Live partner adapter substitutes when real
//                            Gravity / Savings Group adapters land.
//   * Partner routing     → derived from the same `decision` payload —
//                            partner / partnerName / partnerPhone /
//                            ruleId / externalApplicationId form the
//                            "decision.routing" slice we surface
//                            separately for clarity.
//   * Vehicle valuation   → form.valuationMarketCheckPrice +
//                            form.valuationRetailPrice (MarketCheck
//                            wraps; same shape the decision engine reads
//                            for LTV calc).
//
// Persona gating: caller passes `persona` and we render only when it
// matches 'super_admin' (per canon/personas.json `view_api_responses`
// permission). AgentChrome hides the trigger button for non-super_admin
// personas; we still render-guard here so a stale modal flag can't leak
// the data after a persona switch.
import type { FC } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { JsonPeek } from 'blinker-platform/components';
import { MOCK_OFFERS } from '../../constants/mock-data';
import type { RefiForm, Decision, Persona } from '../../types';

interface ApiResponsesModalProps {
  form?: Partial<RefiForm>;
  decision?: Decision | null;
  persona?: Persona;
  onClose: () => void;
}

export const ApiResponsesModal: FC<ApiResponsesModalProps> = ({ form, decision, persona, onClose }) => {
  if (persona !== 'super_admin') return null;

  // Slice the decision payload into the buckets a super_admin actually
  // cares about so the JSON peeks aren't redundant.
  const decisionFull = decision || null;
  const decisionLog = decision?.log || [];
  const routing = decision
    ? {
        partner: decision.partner,
        partnerName: decision.partnerName,
        partnerPhone: decision.partnerPhone,
        ruleId: decision.ruleId,
        result: decision.result,
        reason: decision.reason,
        externalApplicationId: decision.externalApplicationId,
      }
    : null;
  const offers = decision?.result === 'offers_returned' ? MOCK_OFFERS : null;
  const valuation = form?.valuationMarketCheckPrice
    ? {
        marketcheck_price: form.valuationMarketCheckPrice,
        retail_price: form.valuationRetailPrice,
        ltv: decision?.valuation?.ltv ?? null,
        ltv_pct: decision?.valuation?.ltv_pct ?? null,
      }
    : null;

  return (
    <div className="fixed inset-0 bg-slate-900 bg-opacity-60 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full overflow-hidden flex flex-col" style={{ maxHeight: '90vh' }}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ExternalLink className="w-4 h-4 text-blue-600" />
            <div className="font-semibold">View API responses</div>
            <span className="text-[10px] uppercase tracking-wide font-semibold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
              super admin
            </span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-auto flex-1 space-y-4">
          <JsonPeek label="runDecision · partner routing" data={routing} />
          <JsonPeek label="runDecision · evaluation log" data={decisionLog.length ? decisionLog : null} />
          <JsonPeek label="Lender offers (mock)" data={offers} />
          <JsonPeek label="MarketCheck · valuation + LTV" data={valuation} />
          <JsonPeek label="runDecision · full payload" data={decisionFull} />
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
