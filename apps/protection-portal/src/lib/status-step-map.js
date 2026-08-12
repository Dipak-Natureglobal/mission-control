// status-step-map.js — Phase 1 hardcoded table mapping VSC opportunity
// status → the protection wizard step at which the agent (or consumer)
// should resume.
//
// Status strings are VSC display names, verbatim from
// canon/ghl-status.json `vsc` block. TODO: when canon adds machine_ids
// for VSC statuses, swap these for codes.
//
// Future migration target: the super-admin StatusMappingEditor
// (mission-control StatusMappingEditor.jsx, currently maps
// `platform_status → crm_stage`). An additional `wizard_step` column
// on that table would lift this hardcoded list into the per-org editor,
// allowing orgs with non-standard workflows to customize resume points.
// Until then this file is the single source of truth for resume-at-step.
//
// Step keys must match the string constants used in CustomerView.jsx's
// BASE_STEPS array and buildSteps() return values.

export const STATUS_TO_STEP = {
  // Pre-quote: no wizard yet (handled by AgentView showWizard gate)
  'Empty': null,

  // Quote generated but not yet tailored/selected
  'Quoted': 'recommended_coverage',

  // Agent or consumer selected a plan
  'Selected': 'confirm',

  // Package sent to consumer — agent view shows consumer's review state
  'Sent to Consumer': 'confirm',

  // Consumer has reviewed but not yet booked
  'Consumer Reviewed': 'confirm',

  // Plan booked, awaiting payment ← primary test case (opp_vsc_007)
  'Booked': 'billing_payment',

  // Payment attempted but failed — recovery path
  'Payment Failed': 'billing_payment',

  // Payment captured, awaiting signature
  'Payment Success': 'docuseal',

  // Intermediate agreement states — still in DocuSeal flow
  'Product Agreement Signed': 'docuseal',
  'Payment Agreement Signed': 'docuseal',

  // Fully signed — deal is done
  'Agreement Signed': 'thank_you',

  // Post-sale / remitted — show closed state
  'Remitted': 'thank_you',
  'Remitted (VSC)': 'thank_you',
  'Remitted (GAP)': 'thank_you',

  // Active policy
  'Active': 'thank_you',
  'Paid in Full': 'thank_you',

  // Cancellation states — show closed/thank-you screen
  'Pending Cancellation': 'thank_you',
  'Cancelled': 'thank_you',
};

/**
 * Returns the wizard step key for a given VSC opportunity status.
 *
 * @param {string|null|undefined} status  - VSC display-name status string
 * @param {string} fallback               - step key to return when status
 *                                          is unknown or maps to null
 *                                          (typically BASE_STEPS[0])
 * @returns {string} step key suitable for use as the initial stepIdx
 *                   source via indexOf() against buildSteps(form)
 */
export function stepFromStatus(status, fallback = 'vehicle_add') {
  if (!status) return fallback;
  const mapped = STATUS_TO_STEP[status];
  // null means "no wizard" (Empty) — caller should gate before calling,
  // but we return the fallback defensively so the wizard doesn't crash.
  if (mapped === null || mapped === undefined) return fallback;
  return mapped;
}
