// Payments.jsx — research Section 4.4.
// Policy + routing only. Per-provider credentials are in Integrations.

import { useState } from 'react';
import {
  Field,
  FormCard,
  CheckboxLabel,
  NumberInput,
  TextInput,
  Select,
} from './_shared.jsx';

const PROCESSORS = [
  { value: 'fluidpay', label: 'FluidPay' },
  { value: 'authnet', label: 'Authorize.net' },
];

export function PaymentsSection({ form, set }) {
  const p = form.payments || {};
  const [confirmProcessor, setConfirmProcessor] = useState(false);
  const [pendingProcessor, setPendingProcessor] = useState(null);

  function setP(patch) {
    set({ payments: { ...p, ...patch } });
  }

  function changeProcessor(next) {
    if (next === p.primary_processor) return;
    setPendingProcessor(next);
    setConfirmProcessor(true);
  }

  return (
    <div className="space-y-4">
      <FormCard title="Processor selection">
        <Field label="Primary processor" hint="Confirm change — affects every future transaction.">
          <Select
            value={p.primary_processor || 'fluidpay'}
            onChange={changeProcessor}
            options={PROCESSORS}
          />
        </Field>
      </FormCard>

      <FormCard title="Routing">
        <Field label="Default lienholder" hint="Drives EFS paylink routing.">
          <TextInput
            value={p.lienholder_default}
            onChange={(v) => setP({ lienholder_default: v })}
            placeholder="EFS"
          />
        </Field>
      </FormCard>

      <FormCard title="Policy">
        <div className="space-y-3">
          <CheckboxLabel
            checked={p.payment_confirmation_required}
            onChange={(e) => setP({ payment_confirmation_required: e.target.checked })}
          >
            Require explicit agent confirmation step before charge
          </CheckboxLabel>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Processing fee (%)">
              <NumberInput
                value={p.processing_fee_percent}
                onChange={(v) => setP({ processing_fee_percent: v })}
                step="0.01"
              />
            </Field>
            <Field label="Refund window (days)">
              <NumberInput
                value={p.refund_policy_days}
                onChange={(v) => setP({ refund_policy_days: v })}
              />
            </Field>
          </div>
        </div>
      </FormCard>

      {confirmProcessor && pendingProcessor && (
        <ConfirmProcessorModal
          next={pendingProcessor}
          onConfirm={() => {
            setP({ primary_processor: pendingProcessor });
            setPendingProcessor(null);
            setConfirmProcessor(false);
          }}
          onCancel={() => {
            setPendingProcessor(null);
            setConfirmProcessor(false);
          }}
        />
      )}
    </div>
  );
}

function ConfirmProcessorModal({ next, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-md w-full p-5">
        <div className="text-base font-semibold text-slate-900">Switch payment processor?</div>
        <div className="text-xs text-slate-600 mt-2 leading-relaxed">
          Switching primary processor to <strong>{next}</strong> will affect all
          future transactions on this org. Existing recurring schedules remain
          on their original processor until renegotiated.
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
            className="text-xs font-semibold px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white"
          >
            Switch processor
          </button>
        </div>
      </div>
    </div>
  );
}
