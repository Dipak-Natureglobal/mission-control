// "View API Responses" modal — super_admin only.
//
// Surfaces the raw payloads behind the wizard so a super admin can debug
// or audit what each integration returned. Phase 1 sources:
//   * StoneEagle GetRates  → form.rates
//   * VinAudit decode      → form.decodedYmmt (raw + matched) and
//                            form.vinValidate.decodedYmmt (post-payment)
//   * FluidPay tokenize    → form.payment
//   * MarketCheck value    → form.marketCheck (raw mock response) +
//                            form.vehicle.market_value (canonical slot)
//
// Persona gating: caller passes `persona` and we render only when it
// matches 'super_admin' (per canon/personas.json `view_api_responses`
// permission). This component doesn't enforce — AgentChrome hides the
// trigger button for non-super_admin personas. We still render-guard here
// so a stale modal flag can't leak the data after a persona switch.
import { ExternalLink, X } from 'lucide-react';
import { JsonPeek } from 'blinker-platform/components';

export function ApiResponsesModal({ form, persona, onClose }) {
  if (persona !== 'super_admin') return null;

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
          {form.rates?._provider_mode === 'proxy' ? (
            <>
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                  StoneEagle · GetRates request (SOAP XML)
                </div>
                <pre className="text-[11px] bg-slate-50 p-3 rounded border border-slate-200 overflow-auto max-h-64 whitespace-pre-wrap break-all">
                  {(form.rates._raw_request || '').replace(
                    /<Password>[^<]*<\/Password>/g,
                    '<Password>***</Password>'
                  )}
                </pre>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                  StoneEagle · GetRates response (raw XML)
                </div>
                <pre className="text-[11px] bg-slate-50 p-3 rounded border border-slate-200 overflow-auto max-h-64 whitespace-pre-wrap break-all">
                  {form.rates._raw_response_xml || ''}
                </pre>
              </div>
              <JsonPeek
                label="StoneEagle · GetRates response (parsed)"
                data={(() => {
                  const clone = { ...form.rates };
                  delete clone._raw_request;
                  delete clone._raw_response_xml;
                  delete clone._fixture_comparison;
                  return clone;
                })()}
              />
              <JsonPeek
                label="StoneEagle · Fixture comparison (parsed)"
                data={form.rates._fixture_comparison || null}
              />
              {/* Wave 23 Task 7: 5th panel — structured error classification.
                  Null on the happy path; non-null signals the kind/code/action. */}
              <JsonPeek
                label="StoneEagle · Error classification"
                data={form.rates._error_classified ?? 'no error'}
              />
            </>
          ) : (
            <JsonPeek label="StoneEagle · GetRates response" data={form.rates} />
          )}
          <JsonPeek
            label="VinAudit · decode (quote-time)"
            data={form.decodedYmmt ? { decoded: form.decodedYmmt, manuallyEdited: form.manuallyEdited } : null}
          />
          <JsonPeek
            label="VinAudit · decode (post-payment)"
            data={form.vinValidate || null}
          />
          <JsonPeek
            label="MarketCheck · vehicle value (mocked)"
            data={
              form.marketCheck || form.vehicle?.market_value
                ? {
                    raw: form.marketCheck || null,
                    canonical: form.vehicle?.market_value || null,
                    loading: form.marketCheckLoading || false,
                    error: form.marketCheckError || null,
                  }
                : null
            }
          />
          <JsonPeek label="FluidPay · tokenize response" data={form.payment} />
          <JsonPeek label="EFS · charge response" data={form.payment?.charge} />
          <JsonPeek label="EFS · charge classified" data={form.payment?.charge?.classified} />
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
