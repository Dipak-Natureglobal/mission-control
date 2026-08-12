// Cross-sell math models for the protection-portal RecommendedCoverage
// step. Two distinct framings — kept as separate functions with
// separate signatures and copy — per the locked decision in
// architecture/08-cross-sell-orchestration.md § Risks
// (Math-model conflation risk):
//
//   1. Insurance — SAVINGS framing.
//      Reduces the consumer's effective monthly outlay by the
//      per-month delta between their current and new premium.
//      `insuranceMonthlySavings({ currentPremiumCents, newPremiumCents,
//                                  termMonths }) -> cents (clamped >= 0)`
//
//   2. Refi — AFFORDABILITY framing.
//      Computes how much the protection plan adds to the consumer's
//      monthly when financed inside the refi loan. Verbatim port of
//      the legacy `products_payment` formula from
//      BlinkerLegacy/blinker/lib/blinker/amortization/fixed_term.rb:49-54:
//        (plan_total / term_months) * (1 + effective_lifetime_interest_rate)
//      where ELIR comes from PMT amortization.
//      `protectionPlanMonthlyOnRefi({ planTotal, loanPrincipal, apr,
//                                      termMonths }) -> dollars`
//
// DO NOT unify these two functions into a single `crossSellResult`
// shape. Their inputs, outputs, and consumer copy differ — fusing
// them would couple unrelated forecasts and make the buying-power
// UI on RecommendedCoverage harder to reason about.

/**
 * pmt — standard monthly amortization payment.
 *
 * @param {number} principal     - Loan principal in dollars.
 * @param {number} annualRate    - APR as a decimal (0.0899 = 8.99%).
 * @param {number} termMonths    - Loan term in months.
 * @returns {number} Monthly payment in dollars.
 */
export function pmt(principal, annualRate, termMonths) {
  const r = annualRate / 12;
  if (r === 0) return principal / termMonths;
  return (principal * (r * Math.pow(1 + r, termMonths))) / (Math.pow(1 + r, termMonths) - 1);
}

/**
 * effectiveLifetimeInterestRate — total finance charge / principal.
 *
 * The legacy `products_payment` formula multiplies (planTotal/term) by
 * (1 + ELIR) — this is the ELIR factor. Computed via standard PMT
 * amortization so it composes with any APR + term combo.
 *
 * @param {number} principal     - Loan principal in dollars.
 * @param {number} annualRate    - APR as a decimal.
 * @param {number} termMonths    - Loan term in months.
 * @returns {number} ELIR as a decimal (0.245 = 24.5% lifetime cost).
 */
export function effectiveLifetimeInterestRate(principal, annualRate, termMonths) {
  const monthly = pmt(principal, annualRate, termMonths);
  const totalPayments = monthly * termMonths;
  const totalFinanceCharge = totalPayments - principal;
  return totalFinanceCharge / principal;
}

/**
 * protectionPlanMonthlyOnRefi — affordability framing for the
 * protection plan when financed inside the refi loan.
 *
 * Verbatim port of the legacy `products_payment` formula from
 * BlinkerLegacy/blinker/lib/blinker/amortization/fixed_term.rb:49-54:
 *   (plan_total / term_months) * (1 + ELIR)
 *
 * Worked example (per ADR § Math models):
 *   protectionPlanMonthlyOnRefi({
 *     planTotal:     3692,
 *     loanPrincipal: 3692,
 *     apr:           0.0899,
 *     termMonths:    60,
 *   })
 *   -> ~77 (dollars/mo)
 *
 * Result is rounded up to the nearest cent — matches the legacy
 * Ruby code's `.ceil(2)` so the consumer never sees an under-quoted
 * monthly. Returned in DOLLARS, not cents (the refi side of the
 * cross-sell deals in dollars; only insurance is cents-based).
 *
 * @param {object} args
 * @param {number} args.planTotal     - Protection plan total cost in dollars.
 * @param {number} args.loanPrincipal - Refi loan principal in dollars (often
 *                                       equals planTotal when financing the
 *                                       plan alone, or the full payoff when
 *                                       rolled into a vehicle refi).
 * @param {number} args.apr           - Refi APR as a decimal (0.0899 = 8.99%).
 * @param {number} args.termMonths    - Refi term in months.
 * @returns {number} Monthly addition in dollars.
 */
export function protectionPlanMonthlyOnRefi({ planTotal, loanPrincipal, apr, termMonths }) {
  const elir = effectiveLifetimeInterestRate(loanPrincipal, apr, termMonths);
  return Math.ceil(((planTotal / termMonths) * (1 + elir)) * 100) / 100;
}

/**
 * insuranceMonthlySavings — savings framing.
 *
 * Per-month savings from switching to the new carrier's premium.
 * Premiums are in CENTS (matches insurance-portal's
 * _insurance_quote_shape contract). Result is also in CENTS so it
 * pipes straight into formatCents().
 *
 * Clamped at >=0 so a negative delta (new premium higher than
 * current) doesn't render as "savings". When clamped to zero, the
 * caller should suppress the savings annotation entirely.
 *
 * @param {object} args
 * @param {number|null} args.currentPremiumCents - Current carrier per-period premium, cents.
 * @param {number|null} args.newPremiumCents     - Quoted new premium, cents.
 * @param {number}      args.termMonths          - Period length the premium covers
 *                                                  (e.g., 6 for a 6mo period).
 * @returns {number} Per-month savings in cents (>= 0).
 */
export function insuranceMonthlySavings({ currentPremiumCents, newPremiumCents, termMonths }) {
  if (currentPremiumCents == null || newPremiumCents == null) return 0;
  return Math.max(0, Math.round((currentPremiumCents - newPremiumCents) / termMonths));
}

/**
 * effectiveMonthly — pure derivation of the consumer's effective
 * monthly outlay after both cross-sell forecasts apply.
 *
 * Insurance savings can offset protection monthly up to its full
 * value (we won't show a negative monthly even if the savings
 * exceed the plan price; offset is clamped). Refi addition is
 * additive — financing the plan inside the refi loan adds to the
 * monthly directly.
 *
 * All inputs in DOLLARS. Caller is responsible for converting
 * insurance savings (which native is cents) before passing in.
 *
 * @param {object} args
 * @param {number} args.baseProtectionMonthly - Plan monthly without cross-sell, dollars.
 * @param {number} [args.insuranceSavings=0]  - Per-month savings, dollars.
 * @param {number} [args.refiAddition=0]      - Refi-financed plan addition, dollars.
 * @returns {number} Effective monthly in dollars.
 */
export function effectiveMonthly({ baseProtectionMonthly, insuranceSavings = 0, refiAddition = 0 }) {
  const offsetCapped = Math.min(insuranceSavings, baseProtectionMonthly);
  return baseProtectionMonthly - offsetCapped + refiAddition;
}

// Dev-time smoke. Runs once at module-load in dev builds; no-op in
// production. Confirms the worked example from the ADR matches the
// implementation so a future "tidy the formula" refactor can't drift.
if (import.meta.env?.DEV) {
  const result = protectionPlanMonthlyOnRefi({
    planTotal: 3692,
    loanPrincipal: 3692,
    apr: 0.0899,
    termMonths: 60,
  });
  if (result < 75 || result > 80) {
    // eslint-disable-next-line no-console
    console.warn(
      `[protection-pricing] worked example drifted: expected ~$77/mo, got $${result}/mo. Re-check the formula port.`
    );
  }
}
