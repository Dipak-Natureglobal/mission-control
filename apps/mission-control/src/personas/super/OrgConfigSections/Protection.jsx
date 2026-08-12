// Protection.jsx — research Section 4.3.3.
// Maps directly to canon's existing protection_billing block (discount caps,
// down-payment, first-payment-date, payment-term, markup) plus the new
// validation_discount_max field, and the Wave 28 monthly_membership block.

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  Field,
  FormCard,
  CheckboxLabel,
  NumberInput,
  Select,
  TextInput,
} from './_shared.jsx';

const FIRST_PAYMENT_STRATEGIES = [
  { value: 'first_of_next_month', label: 'First of next month (clamped to min/max window)' },
  { value: 'min_date', label: 'Min date (today + min_days_from_today)' },
];

const STATE_OPTIONS = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

const PAYMENT_TERM_OPTIONS = [1, 6, 12, 18, 24];

export function ProtectionSection({ form, set }) {
  const prot = form.opportunities?.protection || {};
  const [confirmMarkup, setConfirmMarkup] = useState(false);
  const [pendingMarkup, setPendingMarkup] = useState(null);

  function setProt(patch) {
    set({
      opportunities: {
        ...(form.opportunities || {}),
        protection: { ...prot, ...patch },
      },
    });
  }

  function setSubBlock(key, patch) {
    setProt({ [key]: { ...(prot[key] || {}), ...patch } });
  }

  function toggleState(state) {
    const cur = Array.isArray(prot.discount?.disabled_in_states) ? prot.discount.disabled_in_states : [];
    const next = cur.includes(state) ? cur.filter((s) => s !== state) : [...cur, state];
    setSubBlock('discount', { disabled_in_states: next });
  }

  function togglePaymentTerm(opt) {
    const cur = Array.isArray(prot.payment_term?.options_months) ? prot.payment_term.options_months : [];
    const next = cur.includes(opt)
      ? cur.filter((x) => x !== opt)
      : [...cur, opt].sort((a, b) => a - b);
    setSubBlock('payment_term', { options_months: next });
  }

  function commitMarkup(field, value) {
    setPendingMarkup({ field, value });
    setConfirmMarkup(true);
  }

  // ── Monthly Membership helpers ─────────────────────────────────────────────
  const mm = prot.monthly_membership || {};

  function setMm(patch) {
    setSubBlock('monthly_membership', patch);
  }

  function setMmSubBlock(key, patch) {
    setMm({ [key]: { ...(mm[key] || {}), ...patch } });
  }

  function toggleMonthlyState(state) {
    const cur = Array.isArray(mm.discount?.disabled_in_states) ? mm.discount.disabled_in_states : [];
    const next = cur.includes(state) ? cur.filter((s) => s !== state) : [...cur, state];
    setMmSubBlock('discount', { disabled_in_states: next });
  }

  // by_plan_code row helpers
  // We maintain an ordered array of { code, term_to_use, markup_dollars, florida_markup_dollars }
  // for the editable table; on every change we repack into the map and call setMm.
  function byPlanCodeRows() {
    const map = mm.by_plan_code || {};
    return Object.entries(map).map(([code, v]) => ({ code, ...(v || {}) }));
  }

  function commitByPlanCode(rows) {
    const map = {};
    rows.forEach(({ code, term_to_use, markup_dollars, florida_markup_dollars }) => {
      if (code && code.trim()) {
        map[code.trim()] = {
          term_to_use: term_to_use != null ? Number(term_to_use) : null,
          markup_dollars: markup_dollars != null ? Number(markup_dollars) : null,
          florida_markup_dollars: florida_markup_dollars != null ? Number(florida_markup_dollars) : null,
        };
      }
    });
    setMm({ by_plan_code: map });
  }

  const [bpcRows, setBpcRows] = useState(() => byPlanCodeRows());

  function updateBpcRow(idx, field, value) {
    const next = bpcRows.map((r, i) => (i === idx ? { ...r, [field]: value } : r));
    setBpcRows(next);
    commitByPlanCode(next);
  }

  function addBpcRow() {
    const next = [...bpcRows, { code: '', term_to_use: null, markup_dollars: null, florida_markup_dollars: null }];
    setBpcRows(next);
  }

  function removeBpcRow(idx) {
    const next = bpcRows.filter((_, i) => i !== idx);
    setBpcRows(next);
    commitByPlanCode(next);
  }

  // Validation hints.
  const errs = [];
  const dp = prot.down_payment || {};
  if (dp.min_percent != null && dp.default_percent != null && Number(dp.default_percent) < Number(dp.min_percent)) {
    errs.push('down_payment.default_percent must be >= min_percent');
  }
  if (dp.max_percent_of_total != null && dp.default_percent != null && Number(dp.default_percent) > Number(dp.max_percent_of_total)) {
    errs.push('down_payment.default_percent must be <= max_percent_of_total');
  }
  const fpd = prot.first_payment_date || {};
  if (fpd.min_days_from_today != null && fpd.max_days_from_today != null && Number(fpd.min_days_from_today) > Number(fpd.max_days_from_today)) {
    errs.push('first_payment_date.min_days_from_today must be <= max_days_from_today');
  }
  // Cross-cutting validation called out in research: min_apr <= max_apr in protection_plan_financing.
  // (That's actually in Refinance section now, but keep parallel pattern.)

  return (
    <div className="space-y-4">
      <FormCard title="Workflow toggle">
        <CheckboxLabel
          checked={prot.enabled}
          onChange={(e) => setProt({ enabled: e.target.checked })}
        >
          Protection enabled — primary workflow; rare to disable
        </CheckboxLabel>
      </FormCard>

      <FormCard title="Discount caps">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Max %" hint="Agent's hard cap as percentage.">
            <NumberInput
              value={prot.discount?.max_percent}
              onChange={(v) => setSubBlock('discount', { max_percent: v })}
            />
          </Field>
          <Field label="Max $" hint="Agent's hard cap as dollars; both caps enforced — first reached wins.">
            <NumberInput
              value={prot.discount?.max_dollars}
              onChange={(v) => setSubBlock('discount', { max_dollars: v })}
              step="0.01"
            />
          </Field>
        </div>
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">
            Disabled in states
          </div>
          <div className="flex flex-wrap gap-1">
            {STATE_OPTIONS.map((s) => {
              const cur = Array.isArray(prot.discount?.disabled_in_states) ? prot.discount.disabled_in_states : [];
              const on = cur.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleState(s)}
                  className={
                    'text-[10px] px-1.5 py-0.5 rounded border ' +
                    (on
                      ? 'bg-rose-50 text-rose-700 border-rose-300'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-rose-300')
                  }
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>
      </FormCard>

      <FormCard title="Down payment">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Default %">
            <NumberInput
              value={prot.down_payment?.default_percent}
              onChange={(v) => setSubBlock('down_payment', { default_percent: v })}
            />
          </Field>
          <Field label="Min %">
            <NumberInput
              value={prot.down_payment?.min_percent}
              onChange={(v) => setSubBlock('down_payment', { min_percent: v })}
            />
          </Field>
          <Field label="Max % of total">
            <NumberInput
              value={prot.down_payment?.max_percent_of_total}
              onChange={(v) => setSubBlock('down_payment', { max_percent_of_total: v })}
            />
          </Field>
        </div>
      </FormCard>

      <FormCard title="First payment date">
        <Field label="Default strategy" hint="Clamps to min_days_from_today when first_of_next_month falls below the floor.">
          <Select
            value={prot.first_payment_date?.default_strategy || 'first_of_next_month'}
            onChange={(v) => setSubBlock('first_payment_date', { default_strategy: v })}
            options={FIRST_PAYMENT_STRATEGIES}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="Min days from today">
            <NumberInput
              value={prot.first_payment_date?.min_days_from_today}
              onChange={(v) => setSubBlock('first_payment_date', { min_days_from_today: v })}
            />
          </Field>
          <Field label="Max days from today">
            <NumberInput
              value={prot.first_payment_date?.max_days_from_today}
              onChange={(v) => setSubBlock('first_payment_date', { max_days_from_today: v })}
            />
          </Field>
        </div>
      </FormCard>

      <FormCard title="Payment term">
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">
          Available term options (months)
        </div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {PAYMENT_TERM_OPTIONS.map((opt) => {
            const cur = Array.isArray(prot.payment_term?.options_months) ? prot.payment_term.options_months : [];
            const on = cur.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => togglePaymentTerm(opt)}
                className={
                  'text-[10px] px-2 py-0.5 rounded-full border ' +
                  (on
                    ? 'bg-amber-50 text-amber-800 border-amber-300'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300')
                }
              >
                {opt === 1 ? 'Pay in full (1)' : `${opt} months`}
              </button>
            );
          })}
        </div>
        <Field label="Default term (months)">
          <Select
            value={prot.payment_term?.default_months ?? 12}
            onChange={(v) => setSubBlock('payment_term', { default_months: Number(v) })}
            options={(prot.payment_term?.options_months || PAYMENT_TERM_OPTIONS).map((o) => ({
              value: o,
              label: o === 1 ? 'Pay in full (1)' : `${o} months`,
            }))}
          />
        </Field>
      </FormCard>

      <FormCard title="Markup (dealer)">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Default $ (non-FL)" hint="Confirm change — affects every future transaction.">
            <NumberInput
              value={prot.markup?.default_dollars}
              onChange={(v) => commitMarkup('default_dollars', v)}
              step="0.01"
            />
          </Field>
          <Field label="Florida $" hint="FL-specific markup.">
            <NumberInput
              value={prot.markup?.florida_dollars}
              onChange={(v) => commitMarkup('florida_dollars', v)}
              step="0.01"
            />
          </Field>
        </div>
      </FormCard>

      <FormCard title="Other">
        <Field label="Validation discount max ($)" hint="Secondary cap; purpose under product review (research §6.2).">
          <NumberInput
            value={prot.validation_discount_max}
            onChange={(v) => setProt({ validation_discount_max: v })}
            step="0.01"
          />
        </Field>
      </FormCard>

      {/* ── Monthly Membership ─────────────────────────────────────────────── */}
      <FormCard title="Monthly membership">
        <CheckboxLabel
          checked={mm.enabled}
          onChange={(e) => setMm({ enabled: e.target.checked })}
        >
          Monthly membership enabled — allows recurring-monthly VSC plans (999999-sentinel class)
        </CheckboxLabel>

        <div className="mt-3 border-t border-slate-200 pt-3">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-2">
            Default pricing (fallback for any monthly plan code without an override)
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Term to use (months)" hint="SE TermMile.Term whose cost is used as the base.">
              <NumberInput
                value={mm.default?.term_to_use}
                onChange={(v) => setMmSubBlock('default', { term_to_use: v })}
                min={1}
              />
            </Field>
            <Field label="Markup $" hint="Flat markup added to the term cost (non-FL).">
              <NumberInput
                value={mm.default?.markup_dollars}
                onChange={(v) => setMmSubBlock('default', { markup_dollars: v })}
                step="0.01"
              />
            </Field>
            <Field label="Florida markup $" hint="FL-specific flat markup.">
              <NumberInput
                value={mm.default?.florida_markup_dollars}
                onChange={(v) => setMmSubBlock('default', { florida_markup_dollars: v })}
                step="0.01"
              />
            </Field>
          </div>
        </div>

        <div className="mt-3 border-t border-slate-200 pt-3">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-2">
            Per-plan-code overrides
          </div>
          <div className="text-[10px] text-slate-500 mb-2">
            An entry here supersedes the Default for that PlanCode. Key = bare plan code string (e.g. <code className="font-mono bg-slate-100 px-1 rounded">41</code>).
          </div>
          {bpcRows.length === 0 && (
            <div className="text-[11px] text-slate-400 italic mb-2">No plan-code overrides. Click "Add row" to add one.</div>
          )}
          {bpcRows.length > 0 && (
            <div className="mb-2 overflow-x-auto">
              <table className="min-w-full text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    {['Plan Code', 'Term to use', 'Markup $', 'FL markup $', ''].map((h) => (
                      <th key={h} className="px-2 py-1.5 text-[9px] uppercase tracking-wide font-semibold text-slate-500 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bpcRows.map((row, idx) => (
                    <tr key={idx} className="border-b border-slate-100 last:border-b-0">
                      <td className="px-2 py-1.5">
                        <TextInput
                          value={row.code}
                          onChange={(v) => updateBpcRow(idx, 'code', v)}
                          placeholder="e.g. 41"
                          mono
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <NumberInput
                          value={row.term_to_use}
                          onChange={(v) => updateBpcRow(idx, 'term_to_use', v)}
                          min={1}
                          placeholder="12"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <NumberInput
                          value={row.markup_dollars}
                          onChange={(v) => updateBpcRow(idx, 'markup_dollars', v)}
                          step="0.01"
                          placeholder="25.00"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <NumberInput
                          value={row.florida_markup_dollars}
                          onChange={(v) => updateBpcRow(idx, 'florida_markup_dollars', v)}
                          step="0.01"
                          placeholder="22.00"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => removeBpcRow(idx)}
                          className="p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600"
                          title="Remove this plan-code override"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button
            type="button"
            onClick={addBpcRow}
            className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-900"
          >
            <Plus className="w-3.5 h-3.5" />
            Add row
          </button>
        </div>

        <div className="mt-3 border-t border-slate-200 pt-3">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-2">
            Monthly discount caps (separate from term-plan discount)
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Field label="Max %" hint="Agent's hard cap for monthly plan discounts as percentage.">
              <NumberInput
                value={mm.discount?.max_percent}
                onChange={(v) => setMmSubBlock('discount', { max_percent: v })}
              />
            </Field>
            <Field label="Max $" hint="Agent's hard cap for monthly plan discounts as dollars; first reached wins.">
              <NumberInput
                value={mm.discount?.max_dollars}
                onChange={(v) => setMmSubBlock('discount', { max_dollars: v })}
                step="0.01"
              />
            </Field>
          </div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">
            Discount disabled in states
          </div>
          <div className="flex flex-wrap gap-1">
            {STATE_OPTIONS.map((s) => {
              const cur = Array.isArray(mm.discount?.disabled_in_states) ? mm.discount.disabled_in_states : [];
              const on = cur.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleMonthlyState(s)}
                  className={
                    'text-[10px] px-1.5 py-0.5 rounded border ' +
                    (on
                      ? 'bg-rose-50 text-rose-700 border-rose-300'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-rose-300')
                  }
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>
      </FormCard>

      {errs.length > 0 && (
        <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 space-y-0.5">
          {errs.map((e, i) => (
            <div key={i}>• {e}</div>
          ))}
        </div>
      )}

      {confirmMarkup && pendingMarkup && (
        <ConfirmMarkupModal
          field={pendingMarkup.field}
          value={pendingMarkup.value}
          onConfirm={() => {
            setSubBlock('markup', { [pendingMarkup.field]: pendingMarkup.value });
            setPendingMarkup(null);
            setConfirmMarkup(false);
          }}
          onCancel={() => {
            setPendingMarkup(null);
            setConfirmMarkup(false);
          }}
        />
      )}
    </div>
  );
}

function ConfirmMarkupModal({ field, value, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-md w-full p-5">
        <div className="text-base font-semibold text-slate-900">Confirm markup change</div>
        <div className="text-xs text-slate-600 mt-2 leading-relaxed">
          You are about to set <code className="font-mono bg-slate-100 px-1 rounded">markup.{field}</code> to{' '}
          <strong>${value}</strong>. This affects billing on every future transaction at this org.
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
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
