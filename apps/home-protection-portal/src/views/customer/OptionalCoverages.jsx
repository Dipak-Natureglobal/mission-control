// Customer view · Step 4 — Optional coverages.
//
// The priced add-on picker. This is the step that turns the yes/no answers
// from home_features into line items with real dollars attached.
//
// WHY IT CAN'T RUN EARLIER (ADR 30 D5)
// ------------------------------------
// An optional coverage's OptionId AND its price both depend on the selected
// plan code and the selected term. Internal plumbing is $57 at 12 months,
// $152 at 36 months on plan 35, and $186 at 36 months on plans 36/37 — same
// coverage, three different rows. Neither the id nor the price exists until a
// plan and a term are chosen, which is why this step sits after
// recommended_coverage (and after customize, when that runs).
//
// WHY THE STEP CAN VANISH
// -----------------------
// Plans 38 / 48 / 49 (month-to-month) return no <Option> rows at all, so
// buildSteps drops this step entirely rather than rendering an empty picker.
// If it somehow renders for a monthly plan anyway, the empty state below says
// so honestly instead of implying the consumer chose to buy nothing.
//
// WHAT A ROW COSTS (Wave 39 follow-up)
// ------------------------------------
// Two things changed here. The price on a row is now RETAIL — the rater's
// "RetailRate" is Omega's cost to the org, and availableAddOns() runs it
// through the org's add-on markup before it ever reaches this screen. And the
// dominant figure on a row is that retail price expressed PER MONTH, on the
// same divisor the plan uses (months + 1, because the down payment is one
// monthly payment), so adding a coverage moves a number the consumer is
// already thinking in. The full term price is one hover away.
//
// THE RE-VALIDATION GATE
// ----------------------
// RecommendedCoverage and Customize already re-resolve selections on every
// plan/term flip. This mount-time pass is the backstop: it re-runs the same
// syncAddOns helper and reports anything that got dropped, so a consumer who
// reached Confirm through an unusual path can still never be charged a stale
// price. Add-on dollars are in the money path here (ADR 30 D7) — that is what
// makes a stale row a mischarge rather than a cosmetic bug.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ListChecks, Check, Info, AlertTriangle } from 'lucide-react';
import { ScreenHeader, WizardFooter } from 'blinker-platform/components';
import { sumAddOnPrices } from 'blinker-platform/utils';
import { track } from 'blinker-platform/telemetry';
import { Tooltip } from '../../components/Tooltip.jsx';
import { syncAddOns, availableAddOns, addOnScopeKey } from '../../lib/addon-sync.js';
import { paymentBasis, perMonth } from '../../lib/home-money.js';

function fmtCurrency(v) {
  return `$${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function OptionalCoverages({ form, update, onNext, persona = 'consumer' }) {
  const plan = form.selectedPlan || null;
  const termMonths = form.coverageTerm ?? plan?.coverage_period_months ?? null;

  // The re-validation is computed ONCE, lazily, during the first render — it
  // is a pure function of (selections, plan, term), so there is nothing to
  // synchronize and no reason to drive it from an effect. Keeping it out of
  // an effect also means `dropped` needs no local setState, and the notice
  // below can never render a frame out of step with the list.
  const [mountSync] = useState(() =>
    syncAddOns({ selected: form.selectedAddOns, plan, termMonths, orgId: form.org_id }),
  );
  const dropped = mountSync.dropped;

  const syncedRef = useRef(false);
  const prefilledRef = useRef(false);
  const viewedRef = useRef(false);

  const available = useMemo(
    () => availableAddOns(plan, termMonths, form.org_id),
    [plan, termMonths, form.org_id],
  );

  // The divisor under every "per month" figure on this screen. Per COVERAGE
  // term, and honouring an agent's explicit months-to-pay if they set one on
  // Confirm and walked back.
  const basis = paymentBasis({
    orgId: form.org_id,
    coverageTermMonths: termMonths,
    chosenMonths: form.payment?.months_to_pay ?? null,
  });
  const monthsToPay = basis.months;

  const scopeKey = addOnScopeKey(plan, termMonths);
  const selected = useMemo(
    () => (Array.isArray(form.selectedAddOns) ? form.selectedAddOns : []),
    [form.selectedAddOns],
  );
  const selectedKeys = useMemo(() => new Set(selected.map((s) => s.key)), [selected]);

  // ── mount pass: re-validate, then pre-check from homeFeatures ───────────
  // Both happen in one effect and one update so no render can observe a
  // half-applied state (revalidated but not pre-checked, or vice versa).
  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;

    const sync = mountSync;

    // Pre-check anything the consumer already told us the home has, but only
    // on the FIRST visit to this step ever (tracked by addOnsPrecheckedFor,
    // NOT addOnsRevalidatedFor — that flag is shared with RecommendedCoverage
    // and Customize, which re-validate on every plan/term flip and would
    // otherwise make this look like a return visit before the consumer ever
    // saw the picker). On a real return visit their explicit toggles win —
    // re-applying homeFeatures would silently undo a deliberate "no thanks".
    let next = sync.selectedAddOns;
    const firstVisit = !form.addOnsPrecheckedFor;
    let precheckedFor = form.addOnsPrecheckedFor;
    if (firstVisit && !prefilledRef.current) {
      prefilledRef.current = true;
      precheckedFor = sync.scopeKey;
      const features = form.homeFeatures || {};
      const have = new Set(next.map((a) => a.key));
      const prechecked = sync.available.filter((a) => features[a.key] === true && !have.has(a.key));
      if (prechecked.length > 0) {
        next = [...next, ...prechecked];
        track('home_protection.customer.optional_coverages.prechecked', {
          count: prechecked.length,
          keys: prechecked.map((a) => a.key),
          persona,
        });
      }
    }

    if (
      sync.changed ||
      sync.dropped.length > 0 ||
      next !== sync.selectedAddOns ||
      form.addOnsRevalidatedFor !== sync.scopeKey ||
      form.addOnsPrecheckedFor !== precheckedFor
    ) {
      update({ selectedAddOns: next, addOnsRevalidatedFor: sync.scopeKey, addOnsPrecheckedFor: precheckedFor });
    }

    if (sync.changed || sync.dropped.length > 0) {
      track('home_protection.customer.optional_coverages.revalidated', {
        kept: sync.selectedAddOns.length,
        dropped: sync.dropped.length,
        dropped_keys: sync.dropped.map((d) => d.key),
        scope: sync.scopeKey,
        persona,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    track('home_protection.customer.optional_coverages.viewed', {
      plan_code: plan?.plan_code ?? null,
      term_months: termMonths,
      available_count: available.length,
      persona,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(addOn) {
    const on = selectedKeys.has(addOn.key);
    const next = on
      ? selected.filter((s) => s.key !== addOn.key)
      // Always store the FRESH resolved row, never a remembered one — the
      // option_id and price must come from the current plan/term scope.
      : [...selected, { ...addOn }];
    update({ selectedAddOns: next, addOnsRevalidatedFor: scopeKey });
    track('home_protection.customer.optional_coverages.toggled', {
      key: addOn.key,
      selected: !on,
      price: addOn.price,
      option_id: addOn.option_id,
      plan_code: plan?.plan_code ?? null,
      term_months: termMonths,
      persona,
    });
  }

  const planTotal = Number(plan?.total_cost ?? 0);
  const addOnsTotal = sumAddOnPrices(selected);
  const grandTotal = planTotal + addOnsTotal;
  // Same divisor as every row, so the parts visibly add up to the whole.
  const grandMonthly = perMonth(grandTotal, monthsToPay);
  const addOnsMonthly = perMonth(addOnsTotal, monthsToPay);

  function handleNext() {
    track('home_protection.customer.optional_coverages.continued', {
      selected_count: selected.length,
      selected_keys: selected.map((s) => s.key),
      add_ons_total: addOnsTotal,
      plan_total: planTotal,
      grand_total: grandTotal,
      grand_monthly: grandMonthly,
      months_to_pay: monthsToPay,
      persona,
    });
    onNext();
  }

  const isMonthly = plan?.billing_model === 'monthly_subscription';

  return (
    <>
      <ScreenHeader
        icon={ListChecks}
        eyebrow="Coverage · Optional"
        title="Add optional coverages"
        subtitle="These are priced for the plan and term you picked. Add or remove any of them — your total updates as you go."
      />

      <div className="px-6 space-y-4">
        {dropped.length > 0 && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold mb-0.5">Some coverages changed</div>
              {dropped.map((d) => d.label || d.key).join(', ')}{' '}
              {dropped.length === 1 ? "isn't" : "aren't"} offered on the plan and term you
              chose, so {dropped.length === 1 ? 'it was' : 'they were'} removed. Everything
              still listed below has been re-priced for this plan.
            </div>
          </div>
        )}

        {available.length === 0 ? (
          <div className="text-sm text-slate-600 border border-dashed border-slate-300 rounded-md px-4 py-8 text-center">
            {isMonthly
              ? 'Month-to-month coverage doesn’t offer optional add-ons.'
              : 'No optional coverages are offered for this plan and term.'}
          </div>
        ) : (
          <div className="border border-slate-200 rounded-md overflow-hidden">
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide font-semibold text-slate-600">
                Available for {plan?.plan_name || 'this plan'}
              </span>
              <span className="text-[11px] text-slate-500">
                {termMonths} months · {monthsToPay} payments
              </span>
            </div>
            <div className="divide-y divide-slate-100">
              {available.map((a) => {
                const on = selectedKeys.has(a.key);
                const suggested = form.homeFeatures?.[a.key] === true;
                const rowMonthly = perMonth(a.price, monthsToPay);
                return (
                  // role="checkbox" on a div, not a <button> — the price
                  // carries a Tooltip, and a Tooltip's trigger is itself
                  // interactive. Nesting it inside a button would be invalid
                  // markup and would swallow the toggle.
                  <div
                    key={a.key}
                    role="checkbox"
                    tabIndex={0}
                    aria-checked={on}
                    onClick={() => toggle(a)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggle(a);
                      }
                    }}
                    className={
                      'w-full px-4 py-3 flex items-center gap-3 text-left cursor-pointer ' +
                      (on ? 'bg-blue-50' : 'bg-white hover:bg-slate-50')
                    }
                  >
                    <span
                      className={
                        'w-4 h-4 rounded border flex items-center justify-center shrink-0 ' +
                        (on ? 'bg-blue-600 border-blue-600' : 'bg-white border-slate-300')
                      }
                    >
                      {on && <Check className="w-3 h-3 text-white" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-slate-900 font-medium truncate">{a.label}</div>
                      {suggested && (
                        <div className="text-[11px] text-slate-500">
                          You told us the home has this
                        </div>
                      )}
                    </div>
                    <div className="text-sm font-semibold text-slate-900 shrink-0">
                      <Tooltip
                        align="right"
                        content={`${fmtCurrency(a.price)} for the full ${termMonths}-month term — ${fmtCurrency(rowMonthly)} of each of your ${monthsToPay} payments, and of the down payment.`}
                        onFirstShow={() =>
                          track('home_protection.customer.optional_coverages.price_tooltip_shown', {
                            key: a.key,
                            price: a.price,
                            monthly: rowMonthly,
                            months_to_pay: monthsToPay,
                          })
                        }
                      >
                        + {fmtCurrency(rowMonthly)}
                        <span className="text-[11px] font-medium text-slate-500"> per month</span>
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="text-[11px] text-slate-500 flex items-start gap-1.5">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          Optional coverage prices come from Omega for the exact plan and term you
          picked. Changing either one re-prices them. Per-month figures spread each
          price across {monthsToPay} payments plus a down payment equal to one
          payment — hover a price for the full term amount.
        </div>
      </div>

      {/* Running total, in BOTH dimensions. The monthly figure is what the
          consumer is deciding against; the total is what they are signing
          for. Both move as rows are toggled, and both flow into the payment
          schedule and the charge — neither is display-only. */}
      <div className="px-6 pt-3 mt-2 border-t border-slate-100">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">
                Your monthly payment
              </div>
              <div className="text-2xl font-bold text-slate-900 leading-none mt-0.5">
                {fmtCurrency(grandMonthly)}
                <span className="text-xs font-semibold text-slate-500 ml-0.5">/mo</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {monthsToPay} payments + 1 down · {fmtCurrency(grandTotal)} total
              </div>
            </div>
            <div className="text-right text-[11px] text-slate-500 shrink-0 space-y-0.5">
              <div>
                {plan?.plan_name || 'Plan'}{' '}
                <span className="text-slate-700 font-semibold">{fmtCurrency(planTotal)}</span>
              </div>
              <div>
                Optional ({selected.length}){' '}
                <span className="text-slate-700 font-semibold">
                  {addOnsTotal > 0 ? `+ ${fmtCurrency(addOnsTotal)}` : fmtCurrency(0)}
                </span>
              </div>
              {addOnsTotal > 0 && (
                <div className="text-slate-400">
                  + {fmtCurrency(addOnsMonthly)}/mo from coverages
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <WizardFooter onNext={handleNext} nextLabel="Continue" />
    </>
  );
}
