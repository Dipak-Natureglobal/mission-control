// ProtectionDevControls — chrome-less, embed-friendly variant of
// DevControls.jsx for mission-control's consolidated DevPanel (Wave 14).
//
// Standalone (App.jsx) keeps using `DevControls` from DevControls.jsx —
// that one wraps everything in <DevPanel open={...}/> (dark sidebar
// chrome) and a View Section + Package state JsonPeek. Both variants
// now share this body so the Section list stays in sync.
//
// Sections shipped (always):
//   1. Confirm · Insurance card        → devOptions.showInsuranceCrossSell
//   2. RecommendedCoverage · Insurance → devOptions.crossSellOverrides.insurance_enabled
//   3. RecommendedCoverage · Refi      → devOptions.crossSellOverrides.refi_enabled
//   4. BillingPayment · Household seed → devOptions.seedMultiContactHousehold
//
// Sections shipped only when `form` + `updateForm` are provided
// (standalone via App.jsx threads them; mission-control's CoPilotPane
// will once it lifts AgentView form state too):
//   5. Force-complete (skip embed)    → drives form.insuranceSavings / form.refiOffer
//   6. Form state                     → JsonPeek of insuranceSavings, refiOffer, contact tags
//
// Contract: parent owns devOptions state. The component is purely
// controlled — `setDevOptions` is the canonical updater (functional
// form supported, mirrors DevControls.jsx). Drop into any dark panel:
// the inner <Section> + <Segmented> primitives match the slate-900 /
// slate-100 / slate-400 / blue-600 palette mission-control's DevPanel
// already uses.
import { useState } from 'react';
import { Section, Segmented } from 'blinker-platform/components';
import { protectionPlanMonthlyOnRefi } from '../lib/protection-pricing.js';
import { track } from 'blinker-platform/telemetry';

const __DEV__ = import.meta.env.DEV;

const SE_MODE_OPTIONS = [
  { v: 'fixture', l: 'Fixture' },
  { v: 'proxy', l: 'Real (UAT)' },
];

const CROSS_SELL_TRISTATE = [
  { v: 'canon', l: 'Canon' },
  { v: 'on', l: 'On' },
  { v: 'off', l: 'Off' },
];

function readGateState(overrides, key) {
  if (overrides?.[key] === true) return 'on';
  if (overrides?.[key] === false) return 'off';
  return 'canon';
}

export function ProtectionDevControls({
  devOptions,
  setDevOptions,
  // Optional — when both are provided, the Force-complete + Form state
  // sections render. When absent (e.g. mission-control's CoPilotPane
  // hasn't lifted AgentView form state yet), we silently skip those
  // sections — light-touch fallback, no banner needed.
  form,
  updateForm,
  persona = 'agent',
}) {
  const showCrossSell = devOptions?.showInsuranceCrossSell ?? true;
  const crossSellOverrides = devOptions?.crossSellOverrides;
  const seedHousehold = devOptions?.seedMultiContactHousehold ?? false;

  function setCrossSell(next) {
    setDevOptions?.((prev) => ({ ...(prev || {}), showInsuranceCrossSell: next }));
  }

  function setSeedHousehold(next) {
    setDevOptions?.((prev) => ({ ...(prev || {}), seedMultiContactHousehold: next }));
    track('dev.seed_multi_contact_toggled', { enabled: next });
  }

  function setGate(key, tristate) {
    setDevOptions?.((prev) => {
      const prevOvr = prev?.crossSellOverrides || {};
      const nextOvr = { ...prevOvr };
      if (tristate === 'canon') delete nextOvr[key];
      else nextOvr[key] = tristate === 'on';
      const cleared = Object.keys(nextOvr).length === 0;
      return {
        ...(prev || {}),
        crossSellOverrides: cleared ? undefined : nextOvr,
      };
    });
  }

  const insuranceGate = readGateState(crossSellOverrides, 'insurance_enabled');
  const refiGate = readGateState(crossSellOverrides, 'refi_enabled');

  const formWired = !!(form && typeof updateForm === 'function');

  const [seMode, setSeMode] = useState(
    () => localStorage.getItem('blinker.dev.product_admin_mode') || 'fixture'
  );

  function handleSeModeChange(next) {
    const prev = seMode;
    localStorage.setItem('blinker.dev.product_admin_mode', next);
    setSeMode(next);
    track('protection.dev.stoneeagle_mode_changed', { from: prev, to: next });
  }

  const [paymentEmulate, setPaymentEmulate] = useState(
    () => localStorage.getItem('blinker.dev.payment_emulate') || 'auto',
  );
  function changePaymentEmulate(next) {
    localStorage.setItem('blinker.dev.payment_emulate', next);
    setPaymentEmulate(next);
  }

  const [vinValidateScenario, setVinValidateScenario] = useState(
    () => localStorage.getItem('blinker.dev.vin_validate_scenario') || '',
  );
  function changeVinValidateScenario(next) {
    if (next) {
      localStorage.setItem('blinker.dev.vin_validate_scenario', next);
    } else {
      localStorage.removeItem('blinker.dev.vin_validate_scenario');
    }
    setVinValidateScenario(next);
  }

  // Wave 38: monthly-membership demo. When set, the platform getRates fixture
  // appends 3 synthetic monthly products (plan_code 40/41/42, $59/$74/$92).
  // Mirrors the VIN-validate scenario localStorage wiring. Re-run GetRates
  // (back out of step 5 + re-enter, or restart) after toggling.
  const [monthlyDemo, setMonthlyDemo] = useState(
    () => !!localStorage.getItem('blinker.dev.monthly_membership_demo'),
  );
  function changeMonthlyDemo(next) {
    if (next) {
      localStorage.setItem('blinker.dev.monthly_membership_demo', '1');
    } else {
      localStorage.removeItem('blinker.dev.monthly_membership_demo');
    }
    setMonthlyDemo(next);
    track('protection.dev.monthly_membership_demo_toggled', { enabled: next });
  }

  function forceCompleteInsurance() {
    if (!formWired) return;
    updateForm({
      insuranceSavings: {
        monthlySavingsCents: 5000, // $50/mo synthetic
        captureCarrier: 'Progressive',
        newCarrier: 'Geico',
        currentPremiumCents: 90000,
        newPremiumCents: 60000,
        quoteId: 'quote_xs_force_complete',
        source: 'dev_force',
      },
    });
    track('protection.cross_sell.insurance_completed', {
      persona,
      surface: 'dev_force',
      monthly_savings_cents: 5000,
    });
  }

  function forceCompleteRefi() {
    if (!formWired) return;
    const planTotal = form.selectedPlan?.total_cost || 3692;
    const apr = 0.0899;
    const termMonths = 60;
    // Use the same math model the embed uses so DEV-forced state
    // matches what a real prequal completion would produce.
    const monthlyDollars = protectionPlanMonthlyOnRefi({
      planTotal,
      loanPrincipal: planTotal,
      apr,
      termMonths,
    });
    updateForm({
      refiOffer: {
        apr,
        termMonths,
        loanPrincipalCents: Math.round(planTotal * 100),
        protectionPlanPortionCents: Math.round(monthlyDollars * 100),
        partner: 'gravity',
        partnerName: 'Gravity Lending',
        externalApplicationId: 'GRV-DEV-FORCE',
        offerId: null,
        prequalApprovedAt: new Date().toISOString(),
        source: 'dev_force',
      },
    });
    track('protection.cross_sell.refi_completed', {
      persona,
      surface: 'dev_force',
      apr,
      term_months: termMonths,
      protection_plan_portion_cents: Math.round(monthlyDollars * 100),
    });
  }

  return (
    <>
      <Section label="Confirm · Insurance card">
        <Segmented
          value={showCrossSell ? 'on' : 'off'}
          onChange={(v) => setCrossSell(v === 'on')}
          options={[{ v: 'on', l: 'On' }, { v: 'off', l: 'Off' }]}
        />
        <p className="text-xs text-slate-500 mt-2 leading-snug">
          Confirm-step <span className="font-mono">SavingsCard</span> visibility.
          Independent of the RecommendedCoverage-step CTAs below.
        </p>
      </Section>

      <Section label="RecommendedCoverage · Insurance gate">
        <Segmented
          value={insuranceGate}
          onChange={(v) => setGate('insurance_enabled', v)}
          options={CROSS_SELL_TRISTATE}
        />
        <p className="text-xs text-slate-500 mt-2 leading-snug">
          "Find insurance savings" CTA gating. Canon reads the org's
          <span className="font-mono"> cross_sell.insurance_enabled</span> from
          org-registry.json (Apex 102 = on; others = off).
        </p>
      </Section>

      <Section label="RecommendedCoverage · Refi gate">
        <Segmented
          value={refiGate}
          onChange={(v) => setGate('refi_enabled', v)}
          options={CROSS_SELL_TRISTATE}
        />
        <p className="text-xs text-slate-500 mt-2 leading-snug">
          "Lower your monthly with refinance" CTA gating. Canon reads
          <span className="font-mono"> cross_sell.refi_enabled</span>. Force-
          complete + JsonPeek of the result lives below when form state is
          wired.
        </p>
      </Section>

      <Section label="BillingPayment · Household seed">
        <Segmented
          value={seedHousehold ? 'on' : 'off'}
          onChange={(v) => setSeedHousehold(v === 'on')}
          options={[{ v: 'on', l: 'On' }, { v: 'off', l: 'Off' }]}
        />
        <p className="text-xs text-slate-500 mt-2 leading-snug">
          Adds 3 mock household members + 2 alternate addresses for
          testing the BillingPayment switcher UX. Agent view only —
          customer mode shows a single self-served contact form.
        </p>
      </Section>

      {__DEV__ && (
        <Section label="Integrations (dev-only)">
          <div className="text-[11px] text-slate-400 mb-1.5 font-semibold uppercase tracking-wide">
            StoneEagle GetRates
          </div>
          <Segmented
            value={seMode}
            onChange={handleSeModeChange}
            options={SE_MODE_OPTIONS}
          />
          <p className="text-xs text-slate-500 mt-2 leading-snug">
            Real mode hits OMGA UAT via the vite dev proxy. Restart dev server
            after toggling if rates don&apos;t change. Production builds always
            use fixture.
          </p>
          <div className="text-[11px] text-slate-400 mt-3 mb-1.5 font-semibold uppercase tracking-wide">
            Payment emulation
          </div>
          <select
            value={paymentEmulate}
            onChange={(e) => changePaymentEmulate(e.target.value)}
            className="w-full text-sm border border-slate-600 bg-slate-800 text-slate-100 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
          >
            <option value="auto">auto</option>
            <option value="success">success</option>
            <option value="declined">declined</option>
            <option value="gateway_timeout">gateway_timeout</option>
          </select>
          <p className="text-xs text-slate-500 mt-2 leading-snug">
            Short-circuits charge step. &apos;auto&apos; = real fixture/proxy.
          </p>

          <div className="text-[11px] text-slate-400 mt-3 mb-1.5 font-semibold uppercase tracking-wide">
            VIN validate scenario
          </div>
          <select
            value={vinValidateScenario}
            onChange={(e) => changeVinValidateScenario(e.target.value)}
            className="w-full text-sm border border-slate-600 bg-slate-800 text-slate-100 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
          >
            <option value="">none (default)</option>
            <option value="class-changed">class-changed</option>
            <option value="ymmt-changed">ymmt-changed</option>
            <option value="plan-disappeared">plan-disappeared</option>
            <option value="price-lower">price-lower</option>
            <option value="price-within-tolerance">price-within-tolerance</option>
            <option value="price-outside-tolerance">price-outside-tolerance</option>
          </select>
          <p className="text-xs text-slate-500 mt-2 leading-snug">
            When set + dev fixture mode + VIN call, stoneeagle.js loads the matching
            vin-fixture variant (stone-eagle-get-rates-vin-*.json). Used to smoke-test
            each ADR 17 kind. localStorage key:{' '}
            <span className="font-mono">blinker.dev.vin_validate_scenario</span>.
          </p>

          <div className="text-[11px] text-slate-400 mt-3 mb-1.5 font-semibold uppercase tracking-wide">
            Monthly membership demo
          </div>
          <Segmented
            value={monthlyDemo ? 'on' : 'off'}
            onChange={(v) => changeMonthlyDemo(v === 'on')}
            options={[{ v: 'on', l: 'On' }, { v: 'off', l: 'Off' }]}
          />
          <p className="text-xs text-slate-500 mt-2 leading-snug">
            Appends 3 synthetic monthly-membership VSC products (plan_code
            40/41/42 · $59/$74/$92) to the fixture GetRates response so the
            term↔monthly switch surfaces in step 5/6. Re-run GetRates after
            toggling (back out of step 5 and re-enter). localStorage key:{' '}
            <span className="font-mono">blinker.dev.monthly_membership_demo</span>.
          </p>
        </Section>
      )}

      {formWired && (
        <>
          <Section label="VIN validate diagnostic">
            {!form.selectedPlan && !form.ratesChangeKind && !form.vinRates && (
              <p className="text-[11px] text-slate-500">
                Pick a plan in step 5 + run VIN validate in step 9 to see comparison.
              </p>
            )}

            {form.selectedPlan && (
              <div className="mb-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1">
                  Selected plan
                </div>
                <div className="space-y-0.5 font-mono text-[11px] text-slate-300">
                  <div><span className="text-slate-500">tier:</span> {form.selectedPlan.tier ?? '—'}</div>
                  <div><span className="text-slate-500">name:</span> {form.selectedPlan.plan_name ?? '—'}</div>
                  <div><span className="text-slate-500">id:</span> {form.selectedPlan.id ?? '—'}</div>
                  <div><span className="text-slate-500">plan_code:</span> {form.selectedPlan.plan_code != null ? String(form.selectedPlan.plan_code) : 'null'}</div>
                  <div><span className="text-slate-500">term:</span> {form.selectedPlan.term_months ?? '—'} mo</div>
                  <div><span className="text-slate-500">miles:</span> {form.selectedPlan.miles != null ? Number(form.selectedPlan.miles).toLocaleString() : '—'}</div>
                  <div><span className="text-slate-500">total_cost:</span> {form.selectedPlan.total_cost != null ? `$${Number(form.selectedPlan.total_cost).toLocaleString()}` : '—'}</div>
                  <div><span className="text-slate-500">vehicle_class:</span> {form.rates?.vehicle_class ?? '—'}</div>
                </div>
              </div>
            )}

            {form.ratesChangeKind && (
              <div className="mb-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1">
                  Classifier outcome
                </div>
                <div className="font-mono text-[11px] text-slate-300 mb-1">
                  <span className="text-slate-500">kind:</span> {form.ratesChangeKind}
                </div>
                <div className="font-mono text-[11px] text-slate-300 mb-1">
                  {form.ratesChangeKind === 'plan_disappeared' && (
                    <span>
                      Selected plan triple absent from vinRates
                      {form.ratesChangeDetail?.available_plans?.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-[10px] text-slate-400">
                          {(form.ratesChangeDetail.available_plans).slice(0, 6).map((p, i) => (
                            <li key={i}>
                              {p.id} — {p.plan_code ?? '—'} — {p.coverage_period_months}mo / {Number(p.mileage).toLocaleString()} mi — ${Number(p.base_price).toLocaleString()}
                            </li>
                          ))}
                        </ul>
                      )}
                    </span>
                  )}
                  {(form.ratesChangeKind === 'plan_price_lower' ||
                    form.ratesChangeKind === 'plan_price_higher_within_tolerance' ||
                    form.ratesChangeKind === 'plan_price_higher_outside_tolerance') &&
                    form.ratesChangeDetail && (
                    <span>
                      ${form.ratesChangeDetail.ymmt_price} → ${form.ratesChangeDetail.vin_price}{' '}
                      ({form.ratesChangeDetail.delta_pct != null ? `${Number(form.ratesChangeDetail.delta_pct).toFixed(1)}%` : '—'})
                    </span>
                  )}
                  {form.ratesChangeKind === 'vehicle_class_changed' && form.ratesChangeDetail && (
                    <span>
                      {form.ratesChangeDetail.class_before} → {form.ratesChangeDetail.class_after}
                    </span>
                  )}
                  {(form.ratesChangeKind === 'ymm_changed' || form.ratesChangeKind === 'ymmt_changed') && form.ratesChangeDetail && (
                    <span>
                      {form.ratesChangeDetail.ymmt_before
                        ? [form.ratesChangeDetail.ymmt_before.year, form.ratesChangeDetail.ymmt_before.make, form.ratesChangeDetail.ymmt_before.model, form.ratesChangeDetail.ymmt_before.trim].filter(Boolean).join(' ')
                        : '—'}
                      {' → '}
                      {form.ratesChangeDetail.ymmt_after
                        ? [form.ratesChangeDetail.ymmt_after.year, form.ratesChangeDetail.ymmt_after.make, form.ratesChangeDetail.ymmt_after.model, form.ratesChangeDetail.ymmt_after.trim].filter(Boolean).join(' ')
                        : '—'}
                    </span>
                  )}
                  {form.ratesChangeKind === 'no_change' && (
                    <span className="text-slate-500">(no divergence)</span>
                  )}
                </div>
                <DevJsonPeek label="form.ratesChangeDetail" data={form.ratesChangeDetail ?? null} />
              </div>
            )}

            {form.vinRates && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1">
                  VIN-attached vinRates
                </div>
                <div className="font-mono text-[11px] text-slate-300 mb-1 space-y-0.5">
                  <div><span className="text-slate-500">vehicle_class:</span> {form.vinRates?.vehicle_class ?? '—'}</div>
                  <div><span className="text-slate-500">product count:</span> {(form.vinRates?.products || []).length}</div>
                </div>
                <DevJsonPeek
                  label="vinRates.products[0..2]"
                  data={(form.vinRates?.products || []).slice(0, 3).map((p) => ({
                    id: p.id,
                    plan_code: p.plan_code,
                    coverage_period_months: p.coverage_period_months,
                    mileage: p.mileage,
                    base_price: p.base_price,
                  }))}
                />
              </div>
            )}
          </Section>

          <Section label="Force-complete (skip embed)">
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={forceCompleteInsurance}
                className="text-[11px] px-2 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
              >
                Insurance ↑
              </button>
              <button
                onClick={forceCompleteRefi}
                className="text-[11px] px-2 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold"
              >
                Refi ↑
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5 mt-1.5">
              <button
                onClick={() => updateForm({ insuranceSavings: null })}
                disabled={!form.insuranceSavings}
                className="text-[11px] px-2 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium disabled:opacity-40"
              >
                Clear ins.
              </button>
              <button
                onClick={() => updateForm({ refiOffer: null })}
                disabled={!form.refiOffer}
                className="text-[11px] px-2 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium disabled:opacity-40"
              >
                Clear refi
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-2 leading-snug">
              Skips the cross-sell embed and writes a synthetic completion
              payload directly to <span className="font-mono">form</span> so the
              buying-power UI on the plan cards lights up.
            </p>
          </Section>

          <Section label="Form state">
            <div className="space-y-2">
              <DevJsonPeek label="form.insuranceSavings" data={form.insuranceSavings} />
              <DevJsonPeek label="form.refiOffer" data={form.refiOffer} />
              <DevJsonPeek
                label="form.contact.tags"
                data={form.contact?.tags ?? null}
              />
              <DevJsonPeek
                label="form.contact.tagsCreated"
                data={form.contact?.tagsCreated ?? null}
              />
            </div>
          </Section>
        </>
      )}
    </>
  );
}

// Lifted from AgentView's right-pane DEV CONTROLS panel. Tiny dark
// JsonPeek block sized for a side panel — distinct from the larger
// shared/JsonPeek.jsx used for the package state mirror.
function DevJsonPeek({ label, data }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1">
        {label}
      </div>
      <pre className="text-[10px] bg-slate-950 text-emerald-300 px-2 py-1.5 rounded overflow-auto max-h-32 leading-snug">
        {data ? JSON.stringify(data, null, 2) : 'null'}
      </pre>
    </div>
  );
}
