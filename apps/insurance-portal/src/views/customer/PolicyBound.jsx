// Terminal step in the simulator after policy.bound fires. EI's
// summary.policy is thin: { id, carrier, boundAt }. No policyNumber,
// no binderUrl, no documents — see canon `_insurance_policy_shape`
// and architecture/06-embedded-insurance-contract.md (#4).
//
// Real production flow may need a follow-up call to a policy-detail
// endpoint to surface a policy number / binder PDF for downstream
// agent + CRM workflows. For now the simulator just confirms the bind
// landed.
import { CheckCircle2 } from 'lucide-react';
import { ScreenHeader } from 'blinker-platform/components';

function fmtDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function PolicyBound({ workflow }) {
  const policy = workflow?.policy?.payload;
  const carrier = policy?.carrier;
  return (
    <>
      <ScreenHeader
        icon={CheckCircle2}
        eyebrow="All set"
        title={
          carrier
            ? `Your ${carrier} policy is being processed`
            : 'Your new policy is being processed'
        }
        subtitle="Your policy is being processed; details will arrive separately."
      />

      <div className="px-6 pb-8">
        <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-100 rounded-md px-4 py-4 text-sm text-emerald-900">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Policy bound</div>
            <div className="text-xs text-emerald-800/80 mt-0.5">
              {carrier ? `${carrier} ` : ''}will email the binder and policy
              documents within a few minutes. Coverage starts on the date you
              chose during checkout.
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-y-2 text-xs text-slate-500">
          {policy?.id && (
            <>
              <div>Policy ID (EI)</div>
              <div className="font-mono">{policy.id}</div>
            </>
          )}
          {policy?.boundAt && (
            <>
              <div>Bound at</div>
              <div>{fmtDate(policy.boundAt)}</div>
            </>
          )}
        </div>

        <div className="mt-8 text-xs text-slate-500 border-t border-slate-100 pt-4">
          EI's policy.bound webhook payload doesn't include the policy
          number, binder URL, or documents — production may need a
          follow-up call to a policy detail endpoint to populate those
          for the agent + CRM. See architecture/06 (#4).
        </div>
      </div>
    </>
  );
}
