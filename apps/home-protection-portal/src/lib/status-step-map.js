// status-step-map.js — Phase 1 table mapping a home_protection opportunity
// status to the wizard step at which the agent (or consumer) should resume.
//
// Status strings are display names, verbatim from
// canon/ghl-status.json#home_protection.statuses. All 20 keys are present.
// TODO: when canon adds machine_ids for this block, swap these for codes.
//
// Structural twin of protection-portal/src/lib/status-step-map.js, minus the
// VIN-validation entries — a home has no VIN, so there is no vin_validate or
// rates_changed step to resume at.
//
// Step keys must match the strings in CustomerView.jsx's BASE_STEPS and
// whatever buildSteps() can return.
//
// Future migration target: mission-control's per-org StatusMappingEditor,
// which today maps platform_status → crm_stage. An additional wizard_step
// column there would lift this table into the per-org editor. Until then
// this file is the single source of truth for resume-at-step.

export const STATUS_TO_STEP = {
  // Pre-quote: no wizard yet (handled by AgentView's showWizard gate).
  'Empty': null,

  // A quote exists — resume where the consumer picks a tier.
  'Quoted': 'recommended_coverage',
  // The rater came back empty. Still lands on the coverage step, which
  // renders the no-plans state and the SE error callout.
  'Quoted - No Results': 'recommended_coverage',

  // A plan is chosen. Optional coverages are already behind them, so the
  // resume point is the review screen.
  'Selected': 'confirm',
  'Sent to Consumer': 'confirm',
  'Consumer Reviewed': 'confirm',

  // Booked, awaiting payment.
  'Booked': 'billing_payment',
  'Payment Failed': 'billing_payment',

  // Payment captured, awaiting signature.
  'Payment Success': 'docuseal',
  'Product Agreement Signed': 'docuseal',
  'Payment Agreement Signed': 'docuseal',

  // Fully signed — the deal is done.
  'Agreement Signed': 'thank_you',

  // Remit outcomes. Every variant is a closed state from the wizard's point
  // of view; the errors are an ops concern surfaced in mission-control, not
  // something the consumer can act on here.
  'Remitted - Product Error': 'thank_you',
  'Remitted - Payment Error': 'thank_you',
  'Remitted - Both Error': 'thank_you',
  'Remitted': 'thank_you',

  // Live agreement.
  'Active': 'thank_you',
  'Paid in Full': 'thank_you',

  // Cancellation states.
  'Pending Cancellation': 'thank_you',
  'Cancelled': 'thank_you',
};

/**
 * Returns the wizard step key for a given home_protection status.
 *
 * @param {string|null|undefined} status  display-name status string
 * @param {string} fallback  step key returned when the status is unknown or
 *                           maps to null (typically BASE_STEPS[0])
 * @returns {string} a step key suitable for indexOf() against buildSteps(form)
 */
export function stepFromStatus(status, fallback = 'home_add') {
  if (!status) return fallback;
  const mapped = STATUS_TO_STEP[status];
  // null means "no wizard" (Empty). The caller should gate before calling,
  // but we return the fallback defensively so the wizard cannot crash.
  if (mapped === null || mapped === undefined) return fallback;
  return mapped;
}
