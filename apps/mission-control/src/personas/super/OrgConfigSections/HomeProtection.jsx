// HomeProtection.jsx — Wave 39 (ADR 30 C5). Structural twin of
// Protection.jsx, editing `form.opportunities.home_protection` (which
// super-admin-storage.js's withConfigDefaults merges from canon's
// home_protection_billing + opportunities.home_protection blocks).
//
// Two deliberate differences from Protection.jsx:
//   - No monthly_membership by_plan_code table. Home's fixed-term-vs-
//     monthly split is two flat markup numbers (markup.fixed_term_dollars /
//     markup.monthly_dollars, each with a Florida variant), not a per-
//     plan-code override map — canon's home_protection_billing carries no
//     such table.
//   - The "Unconfirmed" warning banner. Canon's home_protection_billing
//     block ships an explicit `_TODO` string flagging every number below
//     as an educated guess pending product confirmation (per
//     feedback_canon_todo_defaults — don't let a canon _TODO guess
//     propagate silently). withConfigDefaults spreads that `_TODO` (and
//     `_comment`) verbatim into the merged form, so its presence here is
//     read directly off `hp._TODO` — no separate "is this confirmed" flag
//     to keep in sync.

import { AlertTriangle } from 'lucide-react';
import {
  Field,
  FormCard,
  CheckboxLabel,
  NumberInput,
  Select,
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

const PAYMENT_TERM_OPTIONS = [1, 6, 12];

// Coverage terms that carry a per-coverage-term payment-term row. Fixed set,
// not user-addable — mirrors canon's home_protection_billing.payment_term
// .by_coverage_term keys (ADR 30, 2026-08-26).
const COVERAGE_TERMS = [12, 24, 36, 48];

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function HomeProtectionSection({ form, set }) {
  const hp = form.opportunities?.home_protection || {};

  function setHp(patch) {
    set({
      opportunities: {
        ...(form.opportunities || {}),
        home_protection: { ...hp, ...patch },
      },
    });
  }

  function setSubBlock(key, patch) {
    setHp({ [key]: { ...(hp[key] || {}), ...patch } });
  }

  function toggleState(state) {
    const cur = Array.isArray(hp.discount?.disabled_in_states) ? hp.discount.disabled_in_states : [];
    const next = cur.includes(state) ? cur.filter((s) => s !== state) : [...cur, state];
    setSubBlock('discount', { disabled_in_states: next });
  }

  function togglePaymentTerm(opt) {
    const cur = Array.isArray(hp.payment_term?.options_months) ? hp.payment_term.options_months : [];
    const next = cur.includes(opt)
      ? cur.filter((x) => x !== opt)
      : [...cur, opt].sort((a, b) => a - b);
    setSubBlock('payment_term', { options_months: next });
  }

  // ── payment_term.by_coverage_term row helpers ──────────────────────────
  // Authoritative per-coverage-term options; options_months/default_months
  // above remain the fallback for any coverage term with no row here.
  function byCoverageTermRow(term) {
    return hp.payment_term?.by_coverage_term?.[String(term)] || {};
  }

  function toggleByCoverageTermOption(term, opt) {
    const key = String(term);
    const cur = hp.payment_term?.by_coverage_term || {};
    const row = cur[key] || {};
    const opts = Array.isArray(row.options_months) ? row.options_months : [];
    const nextOpts = opts.includes(opt)
      ? opts.filter((o) => o !== opt)
      : [...opts, opt].sort((a, b) => a - b);
    setSubBlock('payment_term', {
      by_coverage_term: { ...cur, [key]: { ...row, options_months: nextOpts } },
    });
  }

  function setByCoverageTermDefault(term, months) {
    const key = String(term);
    const cur = hp.payment_term?.by_coverage_term || {};
    const row = cur[key] || {};
    setSubBlock('payment_term', {
      by_coverage_term: { ...cur, [key]: { ...row, default_months: Number(months) } },
    });
  }

  // ── Add-on markup % / add-on discount break-even (live, computed from
  // the in-flight form value rather than the canon-reading
  // getHomeDiscountCaps helper, so it tracks unsaved edits too) ──────────
  // Break-even: retail x (1 - d) >= cost  =>  d <= markup / (1 + markup).
  const addOnMarkupFraction = (() => {
    const raw = Number(hp.markup?.add_on_percent);
    if (!Number.isFinite(raw) || raw < 0) return 0;
    return raw > 1 ? raw / 100 : raw;
  })();
  const addOnMarkupPercentDisplay = round2(addOnMarkupFraction * 100);
  const addOnBreakEvenPercent = addOnMarkupFraction > 0
    ? round2((addOnMarkupFraction / (1 + addOnMarkupFraction)) * 100)
    : 0;
  const addOnDiscountMaxPercent = Number(hp.discount?.add_on?.max_percent);
  const addOnDiscountExceedsBreakEven =
    addOnMarkupFraction > 0 &&
    Number.isFinite(addOnDiscountMaxPercent) &&
    addOnDiscountMaxPercent > addOnBreakEvenPercent;

  // Validation hints — mirrors Protection.jsx's.
  const errs = [];
  const dp = hp.down_payment || {};
  if (dp.min_percent != null && dp.default_percent != null && Number(dp.default_percent) < Number(dp.min_percent)) {
    errs.push('down_payment.default_percent must be >= min_percent');
  }
  if (dp.max_percent_of_total != null && dp.default_percent != null && Number(dp.default_percent) > Number(dp.max_percent_of_total)) {
    errs.push('down_payment.default_percent must be <= max_percent_of_total');
  }
  const fpd = hp.first_payment_date || {};
  if (fpd.min_days_from_today != null && fpd.max_days_from_today != null && Number(fpd.min_days_from_today) > Number(fpd.max_days_from_today)) {
    errs.push('first_payment_date.min_days_from_today must be <= max_days_from_today');
  }

  return (
    <div className="space-y-4">
      {hp._TODO && (
        <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 ring-1 ring-amber-300 rounded-md p-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
          <div>
            <div className="font-semibold">Unconfirmed — placeholder values</div>
            <div className="mt-0.5 leading-relaxed">{hp._TODO}</div>
          </div>
        </div>
      )}

      <FormCard title="Workflow toggle">
        <CheckboxLabel
          checked={hp.enabled}
          onChange={(e) => setHp({ enabled: e.target.checked })}
        >
          Home protection enabled — Omega-J Home 2024 (ADR 30). Only orgs
          carrying OMGA UAT credentials should enable this today.
        </CheckboxLabel>
      </FormCard>

      <FormCard title="Discount caps">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Max %" hint="Agent's hard cap as percentage.">
            <NumberInput
              value={hp.discount?.max_percent}
              onChange={(v) => setSubBlock('discount', { max_percent: v })}
            />
          </Field>
          <Field label="Max $" hint="Agent's hard cap as dollars; both caps enforced — first reached wins.">
            <NumberInput
              value={hp.discount?.max_dollars}
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
              const cur = Array.isArray(hp.discount?.disabled_in_states) ? hp.discount.disabled_in_states : [];
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

        <div className="mt-3 border-t border-slate-200 pt-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">
            Add-on discount cap (separate from the plan discount above)
          </div>
          <div className="text-[10px] text-slate-500 mb-2">
            Applies only to optional add-on coverages, never the base plan.
            Add-on discounts must never sell below Omega&rsquo;s cost — a naive
            &ldquo;discount % ≤ markup %&rdquo; rule doesn&rsquo;t achieve that
            because the two percentages apply to different bases. Break-even
            is <code className="font-mono bg-slate-100 px-1 rounded">markup / (1 + markup)</code>.
          </div>
          <Field
            label="Add-on max %"
            hint={`Agent's hard cap for add-on discounts. Current add-on markup is ${addOnMarkupPercentDisplay}%, so break-even is ${addOnBreakEvenPercent}%.`}
          >
            <NumberInput
              value={hp.discount?.add_on?.max_percent}
              onChange={(v) =>
                setSubBlock('discount', {
                  add_on: { ...(hp.discount?.add_on || {}), max_percent: v },
                })
              }
            />
          </Field>
          {addOnDiscountExceedsBreakEven && (
            <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-800 bg-amber-50 ring-1 ring-amber-300 rounded px-2 py-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-600" />
              <div>
                <strong>{addOnDiscountMaxPercent}%</strong> exceeds the break-even
                cap of <strong>{addOnBreakEvenPercent}%</strong> (at a{' '}
                {addOnMarkupPercentDisplay}% add-on markup). Saving is safe —
                the resolver (<code className="font-mono bg-amber-100/60 px-1 rounded">getHomeDiscountCaps</code>)
                clamps the effective cap down to {addOnBreakEvenPercent}% at
                read time — but it will not take effect as typed.
              </div>
            </div>
          )}
        </div>
      </FormCard>

      <FormCard title="Down payment">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Default %">
            <NumberInput
              value={hp.down_payment?.default_percent}
              onChange={(v) => setSubBlock('down_payment', { default_percent: v })}
            />
          </Field>
          <Field label="Min %">
            <NumberInput
              value={hp.down_payment?.min_percent}
              onChange={(v) => setSubBlock('down_payment', { min_percent: v })}
            />
          </Field>
          <Field label="Max % of total">
            <NumberInput
              value={hp.down_payment?.max_percent_of_total}
              onChange={(v) => setSubBlock('down_payment', { max_percent_of_total: v })}
            />
          </Field>
        </div>
      </FormCard>

      <FormCard title="First payment date">
        <Field label="Default strategy" hint="Clamps to min_days_from_today when first_of_next_month falls below the floor.">
          <Select
            value={hp.first_payment_date?.default_strategy || 'first_of_next_month'}
            onChange={(v) => setSubBlock('first_payment_date', { default_strategy: v })}
            options={FIRST_PAYMENT_STRATEGIES}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="Min days from today">
            <NumberInput
              value={hp.first_payment_date?.min_days_from_today}
              onChange={(v) => setSubBlock('first_payment_date', { min_days_from_today: v })}
            />
          </Field>
          <Field label="Max days from today">
            <NumberInput
              value={hp.first_payment_date?.max_days_from_today}
              onChange={(v) => setSubBlock('first_payment_date', { max_days_from_today: v })}
            />
          </Field>
        </div>
      </FormCard>

      <FormCard title="Payment term — fallback">
        <div className="text-[10px] text-slate-500 mb-2">
          Used only for a coverage term with no row in the &ldquo;Payment
          term by coverage term&rdquo; table below.
        </div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">
          Available term options (months)
        </div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {PAYMENT_TERM_OPTIONS.map((opt) => {
            const cur = Array.isArray(hp.payment_term?.options_months) ? hp.payment_term.options_months : [];
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
            value={hp.payment_term?.default_months ?? 12}
            onChange={(v) => setSubBlock('payment_term', { default_months: Number(v) })}
            options={(hp.payment_term?.options_months || PAYMENT_TERM_OPTIONS).map((o) => ({
              value: o,
              label: o === 1 ? 'Pay in full (1)' : `${o} months`,
            }))}
          />
        </Field>
      </FormCard>

      <FormCard title="Payment term by coverage term">
        <div className="text-[10px] text-slate-500 mb-3">
          Authoritative. Some payment terms don&rsquo;t qualify for a given
          coverage term (e.g. a 12-month plan can&rsquo;t offer 12 months to
          pay) — this table is per coverage term rather than one flat list.
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {['Coverage term', 'Options (months)', 'Default (months)'].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-[9px] uppercase tracking-wide font-semibold text-slate-500 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COVERAGE_TERMS.map((term) => {
                const row = byCoverageTermRow(term);
                const opts = Array.isArray(row.options_months) ? row.options_months : [];
                const def = row.default_months;
                const defMismatch = def != null && opts.length > 0 && !opts.includes(Number(def));
                return (
                  <tr key={term} className="border-b border-slate-100 last:border-b-0 align-top">
                    <td className="px-2 py-2 text-xs font-mono text-slate-700 whitespace-nowrap">{term} mo</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        {PAYMENT_TERM_OPTIONS.map((opt) => {
                          const on = opts.includes(opt);
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => toggleByCoverageTermOption(term, opt)}
                              className={
                                'text-[10px] px-2 py-0.5 rounded-full border ' +
                                (on
                                  ? 'bg-amber-50 text-amber-800 border-amber-300'
                                  : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300')
                              }
                            >
                              {opt === 1 ? 'Pay in full (1)' : `${opt} mo`}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-2 py-2 min-w-[140px]">
                      <Select
                        value={def ?? (opts[0] ?? '')}
                        onChange={(v) => setByCoverageTermDefault(term, v)}
                        options={(opts.length > 0 ? opts : PAYMENT_TERM_OPTIONS).map((o) => ({
                          value: o,
                          label: o === 1 ? 'Pay in full (1)' : `${o} mo`,
                        }))}
                      />
                      {defMismatch && (
                        <div className="mt-1 flex items-start gap-1 text-[10px] text-rose-700">
                          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                          <span>Default ({def} mo) isn&rsquo;t one of this row&rsquo;s options.</span>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </FormCard>

      <FormCard title="Markup (dealer)">
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
          Fixed-term plans (35 / 36 / 37)
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <Field label="Default $ (non-FL)">
            <NumberInput
              value={hp.markup?.fixed_term_dollars}
              onChange={(v) => setSubBlock('markup', { fixed_term_dollars: v })}
              step="0.01"
            />
          </Field>
          <Field label="Florida $">
            <NumberInput
              value={hp.markup?.florida_fixed_term_dollars}
              onChange={(v) => setSubBlock('markup', { florida_fixed_term_dollars: v })}
              step="0.01"
            />
          </Field>
        </div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
          Monthly-membership plans (38 / 48 / 49)
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Default $/mo (non-FL)">
            <NumberInput
              value={hp.markup?.monthly_dollars}
              onChange={(v) => setSubBlock('markup', { monthly_dollars: v })}
              step="0.01"
            />
          </Field>
          <Field label="Florida $/mo">
            <NumberInput
              value={hp.markup?.florida_monthly_dollars}
              onChange={(v) => setSubBlock('markup', { florida_monthly_dollars: v })}
              step="0.01"
            />
          </Field>
        </div>

        <div className="mt-3 border-t border-slate-200 pt-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
            Add-on markup
          </div>
          <Field
            label="Add-on markup %"
            hint="One percent applied to any chosen add-on's Omega cost (resolveHomeAddOnPrice). Stored as a fraction in canon — 30% here saves as 0.30."
          >
            <NumberInput
              value={hp.markup?.add_on_percent == null ? null : round2(Number(hp.markup.add_on_percent) * 100)}
              onChange={(v) =>
                setSubBlock('markup', { add_on_percent: v == null ? null : round2(v) / 100 })
              }
              step="0.01"
              placeholder="30"
            />
          </Field>
        </div>
      </FormCard>

      {errs.length > 0 && (
        <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 space-y-0.5">
          {errs.map((e, i) => (
            <div key={i}>• {e}</div>
          ))}
        </div>
      )}
    </div>
  );
}
