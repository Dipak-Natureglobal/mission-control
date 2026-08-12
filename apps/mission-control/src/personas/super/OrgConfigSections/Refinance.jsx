// Refinance.jsx — research Section 4.3.1.
// Largest single section: 12+ legacy refi columns. Cross-cutting validation:
// min_term <= max_term, min_monthly_payment <= max_monthly_payment,
// estimated_payment_term in [min_term, max_term], refi_min_pmt_diff > 0.

import { useState } from 'react';
import {
  Field,
  FormCard,
  CheckboxLabel,
  NumberInput,
} from './_shared.jsx';

export function RefinanceSection({ form, set }) {
  const refi = form.opportunities?.refinance || {};
  const [confirmDisable, setConfirmDisable] = useState(false);

  function setRefi(patch) {
    set({
      opportunities: {
        ...(form.opportunities || {}),
        refinance: { ...refi, ...patch },
      },
    });
  }

  function setFinancing(patch) {
    setRefi({
      protection_plan_financing: {
        ...(refi.protection_plan_financing || {}),
        ...patch,
      },
    });
  }

  function toggleEnabled(next) {
    if (next === !!refi.enabled) return;
    if (next === false && refi.enabled) {
      setConfirmDisable(true);
    } else {
      setRefi({ enabled: true });
    }
  }

  // Validation hints surfaced inline.
  const errs = [];
  if (refi.min_term != null && refi.max_term != null && Number(refi.min_term) > Number(refi.max_term)) {
    errs.push('min_term must be <= max_term');
  }
  if (
    refi.min_monthly_payment != null &&
    refi.max_monthly_payment != null &&
    Number(refi.min_monthly_payment) > Number(refi.max_monthly_payment)
  ) {
    errs.push('min_monthly_payment must be <= max_monthly_payment');
  }
  if (
    refi.estimated_payment_term != null &&
    refi.min_term != null &&
    refi.max_term != null &&
    (refi.estimated_payment_term < refi.min_term || refi.estimated_payment_term > refi.max_term)
  ) {
    errs.push('estimated_payment_term must fall within [min_term, max_term]');
  }
  const fin = refi.protection_plan_financing;
  if (
    fin &&
    fin.min_apr != null &&
    fin.max_apr != null &&
    Number(fin.min_apr) > Number(fin.max_apr)
  ) {
    errs.push('financing min_apr must be <= max_apr');
  }

  return (
    <div className="space-y-4">
      <FormCard title="Workflow toggle">
        <CheckboxLabel
          checked={refi.enabled}
          onChange={(e) => toggleEnabled(e.target.checked)}
        >
          Refinance enabled — shows the &ldquo;Lower your monthly with refinance&rdquo; CTA
        </CheckboxLabel>
      </FormCard>

      {refi.enabled && (
        <>
          <FormCard title="Loan parameters">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Min term (months)">
                <NumberInput value={refi.min_term} onChange={(v) => setRefi({ min_term: v })} />
              </Field>
              <Field label="Max term (months)">
                <NumberInput value={refi.max_term} onChange={(v) => setRefi({ max_term: v })} />
              </Field>
              <Field label="Estimated payment term">
                <NumberInput
                  value={refi.estimated_payment_term}
                  onChange={(v) => setRefi({ estimated_payment_term: v })}
                />
              </Field>
              <Field label="Estimated payment down %">
                <NumberInput
                  value={refi.estimated_payment_down_pct}
                  onChange={(v) => setRefi({ estimated_payment_down_pct: v })}
                />
              </Field>
              <Field label="Min monthly payment ($)">
                <NumberInput
                  value={refi.min_monthly_payment}
                  onChange={(v) => setRefi({ min_monthly_payment: v })}
                  step="0.01"
                />
              </Field>
              <Field label="Max monthly payment ($)">
                <NumberInput
                  value={refi.max_monthly_payment}
                  onChange={(v) => setRefi({ max_monthly_payment: v })}
                  step="0.01"
                />
              </Field>
              <Field label="Max-of-min amount financed ($)">
                <NumberInput
                  value={refi.max_min_amount_financed}
                  onChange={(v) => setRefi({ max_min_amount_financed: v })}
                  step="0.01"
                />
              </Field>
            </div>
          </FormCard>

          <FormCard title="Vehicle eligibility">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Max vehicle age (years)">
                <NumberInput
                  value={refi.max_vehicle_age}
                  onChange={(v) => setRefi({ max_vehicle_age: v })}
                />
              </Field>
              <Field label="Max vehicle mileage">
                <NumberInput
                  value={refi.max_vehicle_mileage}
                  onChange={(v) => setRefi({ max_vehicle_mileage: v })}
                />
              </Field>
            </div>
          </FormCard>

          <FormCard title="Display thresholds">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Min payment savings ($) to surface refi">
                <NumberInput
                  value={refi.refi_min_pmt_diff}
                  onChange={(v) => setRefi({ refi_min_pmt_diff: v })}
                  step="0.01"
                />
              </Field>
              <Field label="Min cash-back ($) to surface as benefit">
                <NumberInput
                  value={refi.refi_min_cash_back}
                  onChange={(v) => setRefi({ refi_min_cash_back: v })}
                  step="0.01"
                />
              </Field>
            </div>
          </FormCard>

          <FormCard title="Protection-plan financing (cross-sell)">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Min APR (decimal, e.g. 0.0499)">
                <NumberInput
                  value={fin?.min_apr}
                  onChange={(v) => setFinancing({ min_apr: v })}
                  step="0.0001"
                />
              </Field>
              <Field label="Default APR">
                <NumberInput
                  value={fin?.default_apr}
                  onChange={(v) => setFinancing({ default_apr: v })}
                  step="0.0001"
                />
              </Field>
              <Field label="Max APR">
                <NumberInput
                  value={fin?.max_apr}
                  onChange={(v) => setFinancing({ max_apr: v })}
                  step="0.0001"
                />
              </Field>
              <Field label="Min term (months)">
                <NumberInput
                  value={fin?.min_term_months}
                  onChange={(v) => setFinancing({ min_term_months: v })}
                />
              </Field>
              <Field label="Default term">
                <NumberInput
                  value={fin?.default_term_months}
                  onChange={(v) => setFinancing({ default_term_months: v })}
                />
              </Field>
              <Field label="Max term">
                <NumberInput
                  value={fin?.max_term_months}
                  onChange={(v) => setFinancing({ max_term_months: v })}
                />
              </Field>
            </div>
          </FormCard>

          <FormCard title="Cross-sells in refi flow">
            <div className="space-y-1.5">
              <CheckboxLabel
                checked={refi.cross_sell_protection_enabled}
                onChange={(e) => setRefi({ cross_sell_protection_enabled: e.target.checked })}
              >
                Cross-sell protection plan inside the refi flow
              </CheckboxLabel>
              <CheckboxLabel
                checked={refi.cross_sell_insurance_enabled}
                onChange={(e) => setRefi({ cross_sell_insurance_enabled: e.target.checked })}
              >
                Cross-sell insurance inside the refi flow
              </CheckboxLabel>
            </div>
          </FormCard>
        </>
      )}

      {errs.length > 0 && (
        <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 space-y-0.5">
          {errs.map((e, i) => (
            <div key={i}>• {e}</div>
          ))}
        </div>
      )}

      {confirmDisable && (
        <ConfirmDisableModal
          onConfirm={() => {
            setRefi({ enabled: false });
            setConfirmDisable(false);
          }}
          onCancel={() => setConfirmDisable(false)}
        />
      )}
    </div>
  );
}

function ConfirmDisableModal({ onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-md w-full p-5">
        <div className="text-base font-semibold text-slate-900">Disable refinance?</div>
        <div className="text-xs text-slate-600 mt-2 leading-relaxed">
          Disabling refi will hide the refi CTA from all agents at this org.
          Any in-flight refi opportunities will not be affected.
        </div>
        <div className="flex items-center gap-2 justify-end mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs font-medium px-3 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="text-xs font-semibold px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-700 text-white"
          >
            Disable refi
          </button>
        </div>
      </div>
    </div>
  );
}
