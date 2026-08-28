// "See what's covered" modal.
//
// Deliberately renders NO raw HTML. protection-portal's equivalent pipes
// `plan_coverage_html` through DOMPurify because the auto catalog carries
// authored HTML per plan. The home catalog does not — all six entries have
// `plan_coverage_html: null` — so there is nothing to sanitize and no reason
// to take on the dependency or the injection surface. If a future canon pass
// authors home coverage HTML, add DOMPurify at that point and render it here.
//
// What we CAN show honestly today: the plan title, the tier headline, the
// flat deductible, the preprinted service call fee, and the covered-component
// list when one was actually authored. When the resolver fell back to the
// AUTO product line's level defaults, we say so rather than presenting
// powertrain copy as if it described a house.
import { X, Check, Info } from 'lucide-react';
import { HOME_TIER_COPY } from './homePlanCopy.js';

export function PlanCoverageModal({
  open,
  onClose,
  tier,
  presentation,
  plan,
}) {
  if (!open) return null;

  const copy = HOME_TIER_COPY[tier] || {};
  const componentsSource = presentation?.source?.coveredComponents ?? null;
  const authoredComponents =
    (componentsSource === 'org_override' || componentsSource === 'catalog') &&
    Array.isArray(presentation?.coveredComponents)
      ? presentation.coveredComponents
      : null;

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-900/40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">
              {copy.label} · {copy.planLabel}
            </div>
            <div className="text-base font-semibold text-slate-900 truncate">
              {presentation?.planTitle || plan?.name || 'Coverage'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded hover:bg-slate-100 text-slate-500 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto text-sm">
          {copy.headline && <p className="text-slate-700">{copy.headline}</p>}

          <div className="grid grid-cols-2 gap-3">
            <Fact k="Deductible" v={plan?.deductible != null ? `$${Math.round(plan.deductible)}` : '—'} />
            <Fact k="Service call fee" v="$75" />
            <Fact
              k="Term"
              v={
                plan?.billing_model === 'monthly_subscription'
                  ? 'Month to month'
                  : plan?.coverage_period_months
                    ? `${plan.coverage_period_months} months`
                    : '—'
              }
            />
            <Fact k="Plan code" v={plan?.plan_code || '—'} />
          </div>

          {authoredComponents ? (
            <div>
              <div className="text-xs uppercase tracking-wide font-semibold text-slate-500 mb-2">
                Covered components
              </div>
              <ul className="space-y-1">
                {authoredComponents.map((c) => (
                  <li key={c} className="flex items-start gap-2 text-slate-700">
                    <Check className="w-3.5 h-3.5 mt-0.5 text-emerald-600 shrink-0" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 flex items-start gap-2">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />
              <div>
                The itemized covered-component list for this plan lives on the
                Omega agreement. Canon does not yet carry a home-specific list,
                and we will not show the auto product line&apos;s wording here —
                ask your agent for the sample agreement.
              </div>
            </div>
          )}

          {presentation?.sampleAgreementUrl && (
            <a
              href={presentation.sampleAgreementUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-blue-600 underline hover:text-blue-800"
            >
              View a sample agreement
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({ k, v }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{k}</div>
      <div className="text-slate-900 font-medium">{v}</div>
    </div>
  );
}
