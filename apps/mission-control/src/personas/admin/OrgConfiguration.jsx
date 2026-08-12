// OrgConfiguration — grouped accordions over the org's protection_billing
// + cross_sell + test_mode. Per architecture/10-admin-console.md.
//
// Sections:
//   - Pricing & markup     → discount + markup
//   - Down payment         → down_payment
//   - First payment date   → first_payment_date
//   - Payment terms        → payment_term
//   - Cross-sell           → insurance_enabled / refi_enabled +
//                            protection_plan_financing if set
//   - Test mode            → toggle that opens TestModeToggleConfirm
//
// Save is a Phase 1 stub (logs + emits PostHog; canon JSON not mutated).
// Phase 2 swap: blinkerApi.orgs.update() with the same shape.

import { useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Save,
  Sliders as SlidersIcon,
  TestTube2,
  Wallet,
  CalendarDays,
  Layers,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { track } from 'blinker-platform/telemetry';

export function OrgConfiguration({
  org,
  persona = 'admin',
  onOpenTestModeConfirm,
  canToggleTestMode = true,
}) {
  const [openSection, setOpenSection] = useState('pricing');
  const billing = org?.protection_billing || {};
  const crossSell = org?.cross_sell || {};

  function toggleSection(key) {
    setOpenSection((prev) => (prev === key ? null : key));
  }

  function onSaveStub(section) {
    track('mission_control.admin.config_saved', {
      org_id: org?.id,
      section,
    });
    if (typeof console !== 'undefined') {
      console.log('[OrgConfiguration] save (Phase 1 stub):', { org_id: org?.id, section });
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <Accordion
        sectionKey="pricing"
        openSection={openSection}
        onToggle={toggleSection}
        icon={DollarSign}
        label="Pricing & markup"
        sub={`max ${billing.discount?.max_percent ?? '?'}% / $${billing.discount?.max_dollars ?? '?'} discount · $${billing.markup?.default_dollars ?? '?'} markup`}
      >
        <FieldGrid>
          <Field label="Max discount %" value={billing.discount?.max_percent} />
          <Field label="Max discount $" value={billing.discount?.max_dollars} />
          <Field
            label="Discount disabled in"
            value={(billing.discount?.disabled_in_states || []).join(', ') || '—'}
          />
          <Field label="Default markup $" value={billing.markup?.default_dollars} />
          <Field label="Florida markup $" value={billing.markup?.florida_dollars} />
        </FieldGrid>
        <SaveBar onSave={() => onSaveStub('pricing')} />
      </Accordion>

      <Accordion
        sectionKey="down_payment"
        openSection={openSection}
        onToggle={toggleSection}
        icon={Wallet}
        label="Down payment"
        sub={`default ${billing.down_payment?.default_percent ?? '?'}% · floor ${billing.down_payment?.min_percent ?? '?'}% · ceiling ${billing.down_payment?.max_percent_of_total ?? '?'}%`}
      >
        <FieldGrid>
          <Field label="Default %" value={billing.down_payment?.default_percent} />
          <Field label="Minimum %" value={billing.down_payment?.min_percent} />
          <Field label="Max % of total" value={billing.down_payment?.max_percent_of_total} />
        </FieldGrid>
        <SaveBar onSave={() => onSaveStub('down_payment')} />
      </Accordion>

      <Accordion
        sectionKey="first_payment_date"
        openSection={openSection}
        onToggle={toggleSection}
        icon={CalendarDays}
        label="First payment date"
        sub={`${billing.first_payment_date?.default_strategy || '?'} · ${billing.first_payment_date?.min_days_from_today ?? '?'}–${billing.first_payment_date?.max_days_from_today ?? '?'} days out`}
      >
        <FieldGrid>
          <Field label="Strategy" value={billing.first_payment_date?.default_strategy} />
          <Field label="Min days from today" value={billing.first_payment_date?.min_days_from_today} />
          <Field label="Max days from today" value={billing.first_payment_date?.max_days_from_today} />
        </FieldGrid>
        <SaveBar onSave={() => onSaveStub('first_payment_date')} />
      </Accordion>

      <Accordion
        sectionKey="payment_term"
        openSection={openSection}
        onToggle={toggleSection}
        icon={Layers}
        label="Payment terms"
        sub={`default ${billing.payment_term?.default_months ?? '?'} mo · options ${(billing.payment_term?.options_months || []).join(', ')}`}
      >
        <FieldGrid>
          <Field label="Default months" value={billing.payment_term?.default_months} />
          <Field
            label="Options (months)"
            value={(billing.payment_term?.options_months || []).join(', ')}
          />
        </FieldGrid>
        <SaveBar onSave={() => onSaveStub('payment_term')} />
      </Accordion>

      <Accordion
        sectionKey="monthly_membership"
        openSection={openSection}
        onToggle={toggleSection}
        icon={RefreshCw}
        label="Monthly membership"
        sub={billing.monthly_membership?.enabled
          ? `enabled · term ${billing.monthly_membership?.default?.term_to_use ?? '?'} mo · $${billing.monthly_membership?.default?.markup_dollars ?? '?'} markup · FL $${billing.monthly_membership?.default?.florida_markup_dollars ?? '?'}`
          : 'disabled'}
      >
        <FieldGrid>
          <Field
            label="Enabled"
            value={billing.monthly_membership?.enabled ? 'yes' : 'no'}
          />
          <Field
            label="Default term to use (mo)"
            value={billing.monthly_membership?.default?.term_to_use}
          />
          <Field
            label="Default markup $"
            value={billing.monthly_membership?.default?.markup_dollars}
          />
          <Field
            label="Default FL markup $"
            value={billing.monthly_membership?.default?.florida_markup_dollars}
          />
        </FieldGrid>

        {/* by_plan_code rows */}
        {(() => {
          const bpc = billing.monthly_membership?.by_plan_code || {};
          const entries = Object.entries(bpc).filter(([k]) => !k.startsWith('_'));
          return entries.length > 0 ? (
            <>
              <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mt-3 mb-1.5">
                Per-plan-code overrides ({entries.length})
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      {['Plan Code', 'Term to use', 'Markup $', 'FL markup $'].map((h) => (
                        <th key={h} className="px-2 py-1 text-[9px] uppercase tracking-wide font-semibold text-slate-500 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(([code, v]) => (
                      <tr key={code} className="border-b border-slate-100 last:border-b-0">
                        <td className="px-2 py-1 text-xs font-mono text-slate-700">{code}</td>
                        <td className="px-2 py-1 text-xs font-mono text-slate-900">{v?.term_to_use ?? '—'}</td>
                        <td className="px-2 py-1 text-xs font-mono text-slate-900">{v?.markup_dollars ?? '—'}</td>
                        <td className="px-2 py-1 text-xs font-mono text-slate-900">{v?.florida_markup_dollars ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="text-[11px] text-slate-400 italic mt-2">No per-plan-code overrides — default pricing applies to all monthly plans.</div>
          );
        })()}

        <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mt-3 mb-1.5">
          Monthly discount caps
        </div>
        <FieldGrid>
          <Field label="Max discount %" value={billing.monthly_membership?.discount?.max_percent} />
          <Field label="Max discount $" value={billing.monthly_membership?.discount?.max_dollars} />
          <Field
            label="Discount disabled in"
            value={(billing.monthly_membership?.discount?.disabled_in_states || []).join(', ') || '—'}
          />
        </FieldGrid>
        <SaveBar onSave={() => onSaveStub('monthly_membership')} />
      </Accordion>

      <Accordion
        sectionKey="cross_sell"
        openSection={openSection}
        onToggle={toggleSection}
        icon={Sparkles}
        label="Cross-sell"
        sub={`insurance ${crossSell.insurance_enabled ? 'on' : 'off'} · refi ${crossSell.refi_enabled ? 'on' : 'off'}`}
      >
        <FieldGrid>
          <Field
            label="Insurance enabled"
            value={crossSell.insurance_enabled ? 'yes' : 'no'}
          />
          <Field label="Refi enabled" value={crossSell.refi_enabled ? 'yes' : 'no'} />
        </FieldGrid>
        {crossSell.protection_plan_financing && (
          <>
            <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mt-3 mb-1.5">
              Protection-plan financing (refi only)
            </div>
            <FieldGrid>
              <Field
                label="Min APR"
                value={formatPercent(crossSell.protection_plan_financing.min_apr)}
              />
              <Field
                label="Default APR"
                value={formatPercent(crossSell.protection_plan_financing.default_apr)}
              />
              <Field
                label="Max APR"
                value={formatPercent(crossSell.protection_plan_financing.max_apr)}
              />
              <Field
                label="Min term (mo)"
                value={crossSell.protection_plan_financing.min_term_months}
              />
              <Field
                label="Default term (mo)"
                value={crossSell.protection_plan_financing.default_term_months}
              />
              <Field
                label="Max term (mo)"
                value={crossSell.protection_plan_financing.max_term_months}
              />
            </FieldGrid>
          </>
        )}
        <SaveBar onSave={() => onSaveStub('cross_sell')} />
      </Accordion>

      <Accordion
        sectionKey="test_mode"
        openSection={openSection}
        onToggle={toggleSection}
        icon={TestTube2}
        label="Test mode"
        sub={org?.test_mode ? 'ON — sandbox routing' : 'off — production routing'}
        accent={org?.test_mode ? 'amber' : null}
      >
        <div className="text-xs text-slate-700 leading-relaxed mb-3">
          When enabled, every integration on this org that supports a sandbox
          environment routes there instead of production. No real money will
          move. Toggling opens a confirm modal that lists every provider that
          will flip with a side-by-side credential preview.
        </div>
        {org?.test_mode && (
          <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mb-3 flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              Test mode is currently <span className="font-semibold">ON</span>. Return to live
              before any real consumer-facing flow on this org.
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={onOpenTestModeConfirm}
          disabled={!canToggleTestMode || !onOpenTestModeConfirm}
          title={canToggleTestMode ? 'Open confirm modal' : 'Requires toggle_test_mode badge'}
          className={
            'inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded border ' +
            (canToggleTestMode
              ? org?.test_mode
                ? 'border-emerald-300 text-emerald-700 bg-white hover:bg-emerald-50'
                : 'border-amber-300 text-amber-700 bg-white hover:bg-amber-50'
              : 'border-slate-200 text-slate-400 bg-slate-50 cursor-not-allowed')
          }
        >
          <TestTube2 className="w-3.5 h-3.5" />
          {org?.test_mode ? 'Return to live…' : 'Enable test mode…'}
        </button>
      </Accordion>
    </div>
  );
}

function Accordion({ sectionKey, openSection, onToggle, icon: Icon, label, sub, accent, children }) {
  const open = openSection === sectionKey;
  const accentRing = accent === 'amber' ? 'border-l-4 border-l-amber-400' : '';
  return (
    <div className={'border-b border-slate-100 last:border-b-0 ' + accentRing}>
      <button
        type="button"
        onClick={() => onToggle(sectionKey)}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-slate-50"
      >
        {open ? (
          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
        )}
        <Icon className="w-4 h-4 text-violet-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-900">{label}</div>
          {sub && <div className="text-[11px] text-slate-500 truncate">{sub}</div>}
        </div>
      </button>
      {open && (
        <div className="px-5 pb-4 pt-1">
          {children}
        </div>
      )}
    </div>
  );
}

function FieldGrid({ children }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-2">{children}</div>;
}

function Field({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs py-1 border-b border-slate-100 last:border-b-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-900 font-medium font-mono">{value ?? '—'}</span>
    </div>
  );
}

function SaveBar({ onSave }) {
  return (
    <div className="mt-3 flex items-center justify-end">
      <button
        type="button"
        onClick={onSave}
        className="text-xs font-semibold px-3 py-1.5 rounded bg-violet-600 hover:bg-violet-700 text-white inline-flex items-center gap-1.5"
        title="Phase 1 stub — logs + emits PostHog; fixture not mutated"
      >
        <Save className="w-3 h-3" />
        Save section
      </button>
    </div>
  );
}

function formatPercent(decimal) {
  if (decimal == null) return '—';
  return (decimal * 100).toFixed(2) + '%';
}

export { SlidersIcon };
