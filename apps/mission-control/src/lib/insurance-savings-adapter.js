// insurance-savings-adapter.js — Wave 31 v3.0.11 (ADR 21 D5/D6).
//
// Maps the live insurance workflow snapshot (the same shape that
// insurance-portal's AgentView reads — workflow.capture.verification +
// workflow.quote.payload) into the `insuranceSavings` prop shape that
// protection-portal's RecommendedCoverage expects on `form.insuranceSavings`.
//
// The adapter is consumed by `mission-control/src/components/CoPilotPane.jsx`
// when the current opportunity is `type === 'insurance'` AND there's a
// related protection/vsc opp at status ≤ step 5 (coverage_recommendation).
// In that arrangement mc renders protection's `RecommendedCoverage`
// component INLINE in the insurance CoPilot right pane, with the
// insuranceSavings prop driven live from the active insurance workflow
// (rather than from the consumer's own cross-sell completion).
//
// Output contract — what RecommendedCoverage actually reads:
//
//   null
//     → "Cross-sell not run yet". RecommendedCoverage shows the "Find
//        insurance savings" CTA as enabled (when org allows), and no
//        boost-slot ResultChip / no -$/mo line on the plan cards.
//
//   { monthlySavingsCents: number > 0, captureCarrier, newCarrier,
//     status: 'savings_found' }
//     → "Quote returned with savings". CTA shows ✓ done. Boost-slot chip
//        reads "Insurance savings: -$X/mo · Carrier → Carrier". Plan
//        cards render the strike-through monthly with the -$/mo
//        deduction line.
//
//   { monthlySavingsCents: 0, captureCarrier, newCarrier: null,
//     status: 'no_savings' }
//     → "Quote ran, returned zero savings". CTA still ✓ done. Boost-slot
//        chip reads "We will continue to monitor savings" (D6). Plan
//        cards stay at full ~$X/mo (insuranceMonthlyDollars === 0 →
//        existing > 0 gate suppresses the -$/mo line).
//
// Pre-quote (verification only) and pre-capture states return null —
// there's no quote.payload to draw savings from yet, and we don't want
// to mislead RecommendedCoverage into thinking the cross-sell completed.
// The InsuranceSavingsCard surface (also new in Wave 31) handles the
// pre-quote teaser UI separately.
//
// `monthlySavingsCents` is derived by dividing the EI 6-month savings
// figure by 6. Matches the per-month framing the rest of the platform
// uses (see protection-portal/src/views/customer/CrossSellSubFlow.jsx
// and architecture/06-embedded-insurance-contract.md § Math).

/**
 * Map an insurance workflow snapshot to the protection
 * RecommendedCoverage `insuranceSavings` prop shape (or null when the
 * cross-sell hasn't produced a result yet).
 *
 * @param {Object|null} workflow
 *   Insurance workflow record as owned by insurance-portal's
 *   InsuranceEmbed / AgentView. Expected shape (relevant fields):
 *     {
 *       status,                       // 'capture.completed' | 'quote.completed' | …
 *       capture: { verification: { policyInfo: { carrier } } },
 *       quote:   { payload: { carrier, totalPremiumCents,
 *                              savingsAmountCents } },
 *     }
 *
 * @returns {null | {
 *   monthlySavingsCents: number,
 *   captureCarrier: string | null,
 *   newCarrier: string | null,
 *   status: 'pending' | 'savings_found' | 'no_savings'
 * }}
 *
 *   `pending` is reserved for future use — callers that want to show
 *   "quote pending after capture" in protection's RecommendedCoverage
 *   should pass `null` for now (which keeps the CTA enabled but
 *   un-checked). The InsuranceSavingsCard surface uses the workflow
 *   directly for its richer state machine; this adapter is intentionally
 *   coarse-grained for the RecommendedCoverage cross-show.
 */
/**
 * Normalize a self-reported premium to a 6-month basis.
 *   monthly → ×6 · 6mo → ×1 · 12mo → ÷2
 * Unknown/absent cadence falls back to 6mo (×1) so a bare amount is
 * treated as the platform-canonical 6-month figure.
 *
 * @param {number} amountCents
 * @param {'monthly'|'6mo'|'12mo'} cadence
 * @returns {number} 6-month-basis cents
 */
function normalizeTo6moCents(amountCents, cadence) {
  if (cadence === 'monthly') return amountCents * 6;
  if (cadence === '12mo') return Math.round(amountCents / 2);
  // '6mo' (and any unknown cadence) — already a 6-month figure.
  return amountCents;
}

export function mapInsuranceWorkflowToSavings(workflow) {
  if (!workflow) return null;

  const quotePayload = workflow.quote?.payload;
  // No quote yet → cross-sell hasn't produced a measurable result yet.
  // RecommendedCoverage stays in its "not run" state.
  if (!quotePayload) return null;

  const captureCarrier =
    workflow.capture?.verification?.policyInfo?.carrier || null;
  const newCarrier = quotePayload.carrier || null;

  // ADR 26 D4 — self-reported-premium path. On the quote-only flow EI
  // does NOT return a savings comparison (`savingsAmountCents` is absent),
  // so the D3 "Current insurance" gate collects the customer's current
  // premium + cadence. When that self-reported figure is present we
  // compute savings directly: normalize current premium to a 6-month
  // basis, subtract the quoted 6-month total premium.
  //
  // `currentCarrier` (the self-reported display name) populates the
  // `captureCarrier`-equivalent slot in the returned shape so the
  // SavingsCard / cross-shown RecommendedCoverage can name the carrier
  // on the quote-only path (where there's no EI verification carrier).
  const currentPremiumCents = workflow.currentPremiumCents;
  if (currentPremiumCents != null) {
    const normalizedCurrent6mo = normalizeTo6moCents(
      currentPremiumCents,
      workflow.premiumCadence,
    );
    const quotedTotal6moCents = quotePayload.totalPremiumCents ?? null;
    const selfReportedCarrier = workflow.currentCarrier || captureCarrier;

    // Quote missing a total premium → can't compute a delta. Fall through
    // to the EI path below (which will land on no_savings if that's also
    // absent) rather than emit a bogus figure.
    if (quotedTotal6moCents != null) {
      const savings6moCents = normalizedCurrent6mo - quotedTotal6moCents;
      // Quote did not beat what they pay today → no_savings (ADR 21 D6).
      if (savings6moCents <= 0) {
        return {
          monthlySavingsCents: 0,
          captureCarrier: selfReportedCarrier,
          newCarrier: null,
          status: 'no_savings',
        };
      }
      return {
        monthlySavingsCents: Math.round(savings6moCents / 6),
        captureCarrier: selfReportedCarrier,
        newCarrier,
        status: 'savings_found',
      };
    }
  }

  // EI savingsAmountCents path — capture+quote (unchanged), or quote-only
  // with no self-reported premium captured.
  const sixMonthSavingsCents = quotePayload.savingsAmountCents;

  // Quote returned but savings figure is missing or zero → no_savings
  // branch. captureCarrier still surfaces for "Current carrier: X" detail
  // line on the muted ResultChip; newCarrier is intentionally nulled so
  // the chip's old "X → Y" copy can't accidentally render.
  if (sixMonthSavingsCents == null || sixMonthSavingsCents <= 0) {
    return {
      monthlySavingsCents: 0,
      captureCarrier: workflow.currentCarrier || captureCarrier,
      newCarrier: null,
      status: 'no_savings',
    };
  }

  // Positive savings branch. EI returns 6-month savings; divide to
  // produce the per-month figure the rest of the platform uses.
  const monthlySavingsCents = Math.round(sixMonthSavingsCents / 6);
  return {
    monthlySavingsCents,
    captureCarrier,
    newCarrier,
    status: 'savings_found',
  };
}
