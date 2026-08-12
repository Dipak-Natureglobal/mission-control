// status-step-map.js — Phase 1 hardcoded table mapping refi opportunity
// status → the refi wizard screen key at which the CoPilotPane (mission-control)
// should resume when opening an existing refi opportunity.
//
// Status strings are refi display names, verbatim from
// canon/ghl-status.json `refi.statuses_summary` array.
//
// Screen keys must match the string constants used in refi.js's getSequence()
// return values and SCREEN_LABELS in refinance-v2-prototype.jsx:
//   'vehicle_add'        — V1 Add vehicle
//   'vehicle_drive'      — V2 How much do you drive?
//   's1_ownership'       — S1.1 Ownership eligibility
//   's1_auto_loan'       — S1.2 Auto loan snapshot
//   's1_credit'          — S1.3 Self-reported credit
//   's1_applicant'       — S1.4 Applicant info (in standard credit-band sequence)
//   's1_housing'         — S1.5 Current housing
//   's1_employment'      — S1.6 Current employment
//   's1_identity_consent'— S1.7 Identity & consent (STAGE1_TERMINUS)
//   'decision_engine'    — Processing / submission state
//   'stage2_result'      — Stage 2 result: offers, pre-approval, or rejection
//
// Co-app screens (s1_co_app_decision, s1_co_app_contact, s1_co_app_employment)
// are dynamically ordered by getSequence(); map returns the stable anchor screen
// before that branch — mc's CoPilotPane uses indexOf() so dynamic ordering is
// resolved at runtime.
//
// Edge cases documented below:
//   - "Duplicate": terminal — no further wizard progress expected. Maps to
//     's1_identity_consent' (last pre-submit step) so the agent sees the most
//     recent data, not the start. Caller should surface a "Duplicate lead"
//     badge in the CoPilot header rather than resume the wizard.
//   - "Working - No Contact": no matching wizard step. Falls back to
//     'stage2_result' — the opp is past submission, agent is chasing the contact.
//   - "Working - Incorrect Info": data-correction state. Maps to 'vehicle_add'
//     (start) so the agent can re-enter from the top with corrected info. A
//     future pass could map to the specific incorrect field's step if the status
//     gains sub-type metadata.
//   - "Not Interested" variants: closed/declined terminal — maps to 'stage2_result'
//     (agent sees final state, not an editable form).
//   - "Applied" / "Pending Funding" / "Funded": post-submit terminal states.
//     All map to 'stage2_result' — wizard is done; CoPilot should show a
//     read-only summary, not a resumable form.
//
// Future migration target: super-admin StatusMappingEditor (mission-control
// StatusMappingEditor.jsx, currently maps platform_status → crm_stage). An
// additional `wizard_step` column on that table would lift this hardcoded
// list into the per-org editor, allowing orgs with non-standard workflows to
// customize resume points. Until then this file is the single source of truth
// for refi resume-at-step.
//
// Mirrors the protection-portal pattern landed in Wave 18-fu2
// (protection-portal/src/lib/status-step-map.js).

import type { ScreenKey } from '../types';

export const STATUS_TO_STEP: Record<string, ScreenKey> = {
  // ── Intake: wizard not yet started / just opened ──────────────────────────
  'Started':                     'vehicle_add',
  'New Lead':                    'vehicle_add',

  // ── Stage 1 data collection ───────────────────────────────────────────────
  'Ownership Eligibility':       's1_ownership',
  'Auto Loan Snapshot':          's1_auto_loan',
  'Self Reported Credit':        's1_credit',

  // 's1_applicant' is the stable anchor; co-app ordering is dynamic (getSequence)
  'Current Housing':             's1_housing',
  'Current Employment':          's1_employment',
  'Identity and Consent':        's1_identity_consent',

  // ── Terminal pre-submit (duplicate detected) ───────────────────────────────
  // Edge case: maps to last pre-submit step so agent sees collected data.
  // Caller should display a "Duplicate lead" banner — wizard isn't resumable.
  'Duplicate':                   's1_identity_consent',

  // ── Submission / processing ────────────────────────────────────────────────
  'Prequalification Submitted':  'decision_engine',

  // ── Post-submit: offers + selection ───────────────────────────────────────
  'Offers Returned':             'stage2_result',
  'Offer Selected':              'stage2_result',

  // ── Working states: awaiting action after submission ──────────────────────
  // "Waiting on Customer" and "Waiting for Data" both sit in post-offer doc
  // collection — stage2_result is the closest resumable screen.
  'Working - Waiting on Customer': 'stage2_result',
  'Working - Waiting for Data':    'stage2_result',

  // "Rejected" / closed negative — show final state, not an editable form.
  'Working - Rejected':          'stage2_result',

  // "No Contact" — opp is past submission; agent is re-engaging the contact.
  // Edge case: no dedicated followup screen exists; stage2_result is closest.
  'Working - No Contact':        'stage2_result',

  // "Incorrect Info" — re-enter from top so agent can correct fields.
  // Edge case: no field-specific step available; caller should annotate header.
  'Working - Incorrect Info':    'vehicle_add',

  // "Approved" — post-partner-approval waiting state; wizard is done.
  'Working - Approved':          'stage2_result',

  // ── Post-submission terminal states ───────────────────────────────────────
  'Applied':                     'stage2_result',

  // "Not Interested" variants — closed/declined; show final state read-only.
  'Not Interested':              'stage2_result',
  'Not Interested - Approved':   'stage2_result',
  'Not Interested - Applied':    'stage2_result',

  'Declined':                    'stage2_result',
  'Pending Funding':             'stage2_result',
  'Funded':                      'stage2_result',
};

/**
 * Returns the refi wizard screen key for a given refi opportunity status.
 *
 * @param {string|null|undefined} status  - refi display-name status string
 *                                          (canon refi.statuses_summary value)
 * @param {string} fallback               - screen key to return when status is
 *                                          unknown or unmapped (typically
 *                                          'vehicle_add', the first wizard step)
 * @returns {string} screen key suitable for use as the initial screen in
 *                   mc's CoPilotPane via indexOf() against getSequence(form, hasCoApp)
 */
export function stepFromStatus(status: string | null | undefined, fallback: ScreenKey = 'vehicle_add'): ScreenKey {
  if (!status) return fallback;
  return STATUS_TO_STEP[status] ?? fallback;
}
