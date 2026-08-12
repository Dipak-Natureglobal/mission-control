// Customer view · Step 10 — Product Agreement (DocuSeal placeholder).
//
// Per CLAUDE.md Phase 1 acceptance:
//   "DocuSeal Sign Now button shows a placeholder iframe ('Phase 2 will
//    load real DocuSeal here')"
//
// In legacy (BlinkerLegacy/.../screens/12) the consumer signs TWO
// agreements in sequence: the Product Agreement (Omega VSC template) and
// the Payment Plan Agreement (EFS template). Phase 1 collapses both into
// a single placeholder; the second-agreement screen lands when DocuSeal
// integration goes live in Phase 2.
import { useEffect, useRef } from 'react';
import { FileSignature, ExternalLink } from 'lucide-react';
import { ScreenHeader, WizardFooter } from 'blinker-platform/components';
import { track } from 'blinker-platform/telemetry';

export function DocuSeal({ form, update, onNext }) {
  const viewedRef = useRef(false);
  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    track('protection.customer.docuseal.viewed', {
      plan_code: form.selectedPlan?.plan_code,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSign() {
    update({
      docusealCompleted: true,
      status: 'product_agreement_signed',
      signedAt: new Date().toISOString(),
    });
    track('protection.customer.docuseal.completed', {
      plan_code: form.selectedPlan?.plan_code,
    });
    onNext();
  }

  return (
    <>
      <ScreenHeader
        icon={FileSignature}
        eyebrow="Agreement · Sign"
        title="Sign your protection agreement"
        subtitle="Almost done. Review your agreement and sign electronically — Phase 2 will load this in a real DocuSeal embed."
      />

      <div className="px-6">
        <div className="border border-slate-200 rounded-md overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileSignature className="w-4 h-4 text-slate-500" />
              <span className="text-xs uppercase tracking-wide font-semibold text-slate-600">
                {form.selectedPlan?.plan_name || 'Vehicle Service Agreement'}
              </span>
            </div>
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <ExternalLink className="w-3 h-3" /> Phase 2 placeholder
            </span>
          </div>
          <div className="bg-slate-100 min-h-[280px] flex items-center justify-center text-center px-6 py-10">
            <div className="text-xs text-slate-500 leading-relaxed">
              <div className="font-semibold text-slate-700 mb-1">DocuSeal embed slot</div>
              Phase 2 will load real DocuSeal here. The iframe will mount{' '}
              <code className="text-[10px] bg-slate-200 px-1 py-0.5 rounded">docuseal.&lt;org-domain&gt;/s/&lt;submitter_id&gt;</code>{' '}
              and listen for the <code className="text-[10px] bg-slate-200 px-1 py-0.5 rounded">completed</code> /{' '}
              <code className="text-[10px] bg-slate-200 px-1 py-0.5 rounded">declined</code> events from the iframe.
            </div>
          </div>
          <div className="px-4 py-3 border-t border-slate-100 bg-white">
            <button
              onClick={handleSign}
              className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-md flex items-center justify-center gap-2"
            >
              <FileSignature className="w-4 h-4" /> Sign now
            </button>
          </div>
        </div>
      </div>

      <WizardFooter onNext={handleSign} nextLabel="Continue without signing (skip)" />
    </>
  );
}
