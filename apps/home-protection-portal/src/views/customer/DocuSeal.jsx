// Customer view · Step 7 — Sign the agreement.
//
// The first REAL signing step on the platform (ADR 30 D8). protection-portal's
// DocuSeal.jsx is still a static placeholder with a button that sets local
// state; this one resolves a template, builds the full 37-field payload, and
// creates a submission through packages/integrations/signing.
//
// TEMPLATE RESOLUTION
// -------------------
// resolveTemplateId delegates to resolvePlanPresentation, whose org_override →
// catalog → org_default precedence has existed since ADR 18 and has never had
// a reader until now. Catalog seeds: 35→182, 36→184, 37→185, 38→186, 48→187,
// 49→188. A null template is a HARD BLOCK — we will not walk a consumer into
// an unsigned completion and tell them they're covered.
//
// FIXTURE MODE
// ------------
// createSubmission short-circuits without a network call and returns a
// submitter with no embed_src. Rather than mounting an empty iframe, we render
// the resolved template id and the exact field payload in an inspector panel,
// so the mapping is checkable end-to-end without a live DocuSeal account.
// That inspector is how you verify Deluxe is ticked, exactly the chosen
// add-ons are true and the other ten false, the right dwelling box is set, and
// ProductPrice includes the add-on dollars.
//
// FIELD NAMES (ADR 30 R5)
// -----------------------
// The payload is written against the CORRECTED template field set. The live
// templates currently carry Address1/City/State/Zip twice under identical
// names for two different addresses, and same-named DocuSeal fields share a
// value — so unfixed, the holder's mailing address and the covered property
// would print the same string. The property block here uses PropertyAddress1 /
// PropertyCity / PropertyState / PropertyZip, and the templates need that
// change before this goes live.
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileSignature, AlertTriangle, Loader2, Check } from 'lucide-react';
import { ScreenHeader, WizardFooter, JsonPeek } from 'blinker-platform/components';
import {
  resolveTemplateId,
  buildHomeSubmissionFields,
  createSubmission,
  resolveSigningMode,
} from 'blinker-platform/integrations/signing';
import { track } from 'blinker-platform/telemetry';
import planMappings from '../../constants/canon/plan-mappings.json' with { type: 'json' };
import orgRegistry from '../../constants/canon/org-registry.json' with { type: 'json' };

const CANON = {
  homeAddOns: planMappings.home_add_ons,
  homeDwellingClasses: planMappings.home_dwelling_classes,
};

function getOrg(orgId) {
  const org = orgRegistry.orgs.find((o) => o.id === orgId) || null;
  if (!org) return null;
  const env = org.test_mode ? 'test' : 'live';
  // The seller block on the agreement. legal_name / address / phone are not on
  // the org record yet, so the builder emits empty strings for whatever is
  // missing rather than inventing a seller identity.
  return {
    ...org,
    seller_code: org.integrations?.stoneeagle?.credentials?.[env]?.dealer_no ?? null,
  };
}

export function DocuSeal({ form, update, onNext, persona = 'consumer' }) {
  const [submitting, setSubmitting] = useState(false);
  const [submission, setSubmission] = useState(null);
  const [error, setError] = useState(null);
  const viewedRef = useRef(false);

  const org = useMemo(() => getOrg(form.org_id), [form.org_id]);
  const mode = resolveSigningMode();

  const templateId = useMemo(() => {
    const plan = form.selectedPlan;
    if (!plan?.plan_code) return null;
    return resolveTemplateId({
      orgId: form.org_id,
      tpaCode: plan.tpa_code,
      productTypeCode: plan.product_type_code,
      planCode: plan.plan_code,
      planName: plan.plan_name,
    });
  }, [form.org_id, form.selectedPlan]);

  // Building the field map can THROW — buildHomeSubmissionFields refuses an
  // ineligible home rather than papering an agreement with no dwelling box
  // ticked. The wizard blocks that at home_add, so reaching here means the
  // home was edited after quoting. Catch it and surface it as a block.
  const { fields, fieldError } = useMemo(() => {
    if (!form.selectedPlan) return { fields: null, fieldError: 'No plan selected.' };
    try {
      return { fields: buildHomeSubmissionFields({ form, org, canon: CANON }), fieldError: null };
    } catch (err) {
      return { fields: null, fieldError: err?.message || 'Could not build the agreement.' };
    }
     
  }, [form, org]);

  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    track('home_protection.customer.docuseal.viewed', {
      plan_code: form.selectedPlan?.plan_code ?? null,
      template_id: templateId,
      mode,
      field_count: fields ? Object.keys(fields).length : 0,
      blocked: !templateId || !!fieldError,
      persona,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const blocked = !templateId || !!fieldError;

  async function handleSign() {
    if (blocked || submitting) return;
    setSubmitting(true);
    setError(null);
    const contact = form.contact || {};
    try {
      const res = await createSubmission(
        {
          templateId,
          fields,
          submitters: [
            {
              role: 'Consumer',
              name: [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Consumer',
              email: contact.email || '',
            },
          ],
        },
        { credentials: org?.integrations?.docuseal?.credentials?.[org?.test_mode ? 'test' : 'live'] },
      );

      if (res.status !== 'ok') {
        track('home_protection.customer.docuseal.submission_failed', {
          template_id: templateId,
          reason: res.reason,
          mode: res.mode,
        });
        setError(`Couldn't create the agreement (${res.reason}). Nothing has been signed.`);
        setSubmitting(false);
        return;
      }

      setSubmission(res);
      update({
        docusealTemplateId: templateId,
        docusealFields: fields,
        submission_id: res.submission_id,
        docusealCompleted: true,
        signedAt: new Date().toISOString(),
        status: 'Product Agreement Signed',
      });
      track('home_protection.customer.docuseal.completed', {
        plan_code: form.selectedPlan?.plan_code ?? null,
        template_id: templateId,
        submission_id: res.submission_id,
        mode: res.mode,
        persona,
      });
      setSubmitting(false);
      onNext();
    } catch (err) {
      const detail = err?.message || 'Could not create the agreement.';
      track('home_protection.customer.docuseal.failed', { error: detail, template_id: templateId });
      setError(detail);
      setSubmitting(false);
    }
  }

  const embedSrc = submission?.submitters?.[0]?.embed_src ?? null;

  return (
    <>
      <ScreenHeader
        icon={FileSignature}
        eyebrow="Agreement · Sign"
        title="Sign your home protection agreement"
        subtitle="Review the agreement and sign electronically. Your coverage activates once it's signed."
      />

      <div className="px-6 space-y-3">
        {blocked && (
          <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-4 py-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold mb-0.5">This agreement can&apos;t be prepared</div>
              {!templateId ? (
                <>
                  No agreement template is configured for plan{' '}
                  <span className="font-mono">{form.selectedPlan?.plan_code ?? '—'}</span>. An agent
                  needs to map it before this can be signed.
                </>
              ) : (
                fieldError
              )}
            </div>
          </div>
        )}

        {!blocked && (
          <div className="border border-slate-200 rounded-md overflow-hidden">
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSignature className="w-4 h-4 text-slate-500" />
                <span className="text-xs uppercase tracking-wide font-semibold text-slate-600">
                  {form.selectedPlan?.plan_name || 'Home Protection Agreement'}
                </span>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">
                template {templateId} · {mode}
              </span>
            </div>

            {embedSrc ? (
              // Live mode: mount the submitter URL and listen for the
              // completed / declined messages DocuSeal posts from the frame.
              <iframe
                title="Home protection agreement"
                src={embedSrc}
                className="w-full min-h-[520px] border-0"
              />
            ) : (
              <FieldInspector fields={fields} mode={mode} form={form} />
            )}

            <div className="px-4 py-3 border-t border-slate-100 bg-white">
              <button
                onClick={handleSign}
                disabled={submitting || form.docusealCompleted}
                className={
                  'w-full px-4 py-2.5 text-sm font-semibold rounded-md flex items-center justify-center gap-2 ' +
                  (submitting || form.docusealCompleted
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white')
                }
              >
                {submitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Preparing agreement…</>
                ) : form.docusealCompleted ? (
                  <><Check className="w-4 h-4" /> Signed</>
                ) : (
                  <><FileSignature className="w-4 h-4" /> Sign now</>
                )}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="text-xs text-rose-700 flex items-start gap-1">
            <AlertTriangle className="w-3 h-3 mt-0.5" /> {error}
          </div>
        )}
      </div>

      {/* No "skip signing" affordance. Signing is the product — an unsigned
          completion would tell a paying consumer they are covered when they
          are not. */}
      <WizardFooter
        onNext={handleSign}
        disabled={blocked || submitting}
        nextLabel={form.docusealCompleted ? 'Continue' : 'Sign and continue'}
      />
    </>
  );
}

// Fixture-mode inspector. Renders the resolved payload so the field mapping is
// verifiable without a live DocuSeal call: the checkbox block shows every one
// of the twelve add-on fields and all five dwelling fields with their explicit
// booleans, which is exactly what "never omit a checkbox" means in practice.
function FieldInspector({ fields, mode, form }) {
  if (!fields) return null;
  const checkboxes = Object.entries(fields).filter(([, v]) => typeof v === 'boolean');
  const values = Object.fromEntries(Object.entries(fields).filter(([, v]) => typeof v !== 'boolean'));

  return (
    <div className="bg-slate-50 px-4 py-4 space-y-3">
      <div className="text-[11px] text-slate-500">
        <span className="font-semibold text-slate-700">Signing mode: {mode}.</span>{' '}
        No live DocuSeal call was made. Below is the exact payload that would be
        submitted — {Object.keys(fields).length} fields.
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-1">
          Checkboxes ({checkboxes.filter(([, v]) => v).length} of {checkboxes.length} ticked)
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
          {checkboxes.map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5 text-[11px] font-mono">
              <span
                className={
                  'w-3 h-3 rounded-sm border flex items-center justify-center shrink-0 ' +
                  (v ? 'bg-emerald-600 border-emerald-600' : 'bg-white border-slate-300')
                }
              >
                {v && <Check className="w-2.5 h-2.5 text-white" />}
              </span>
              <span className={v ? 'text-slate-900' : 'text-slate-400'}>{k}</span>
            </div>
          ))}
        </div>
      </div>

      <JsonPeek label="text fields" data={values} />
      <JsonPeek
        label="money check"
        data={{
          plan_total: form.selectedPlan?.total_cost ?? null,
          add_ons_total: form.paymentSchedule?.add_ons_total ?? null,
          ProductPrice: fields.ProductPrice,
        }}
      />
    </div>
  );
}
