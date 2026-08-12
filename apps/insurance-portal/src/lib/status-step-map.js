// Wave 18-fu4 — insurance wizard resume map.
//
// Insurance is the ONLY workflow with both human labels and machine_ids
// (lowercase dotted) per canon/ghl-status.json#insurance.statuses.
// We export both lookup shapes so consumers can use whichever they hold:
//
//   stepFromStatus(humanLabel, fallback)
//     Used by mission-control's CoPilotPane — opportunity.status carries
//     the human label (e.g. "Quote Viewed", "Policy Written").
//
//   stepFromMachineId(machineId, fallback)
//     Used by insurance-portal internals that operate on workflow.status
//     (machine_id, e.g. "quote.viewed", "policy.bound").
//
// Unlike protection-portal's multi-step wizard, insurance-portal has a
// two-state view split on workflow.consumer_link.sentAt:
//
//   pre_send  — LeadOriginationForm visible; link not yet sent
//   post_send — LeadStatusTimeline + ConsumerLinkPanel visible
//
// Statuses that exist only before a link is sent map to "pre_send".
// Statuses that are only reachable after a link is sent map to "post_send".
// Error + terminal states also map to "post_send" (the timeline renders
// those branches inline).
//
// mc's InsuranceEmbed (Wave 18-fu5) will consume stepFromStatus to decide
// whether to pre-seed consumer_link.sentAt when resuming an existing opp,
// so the CoPilotPane opens at the correct view immediately rather than
// always showing the origination form.
//
// Phase-1 hardcoded. Future migration target: super-admin StatusMappingEditor
// (mission-control StatusMappingEditor.jsx) with an additional wizard_step
// column that lifts this table into per-org config.

// Source-of-truth rows — one entry per canon insurance status.
// Columns: [humanLabel, machineId, resumeStep]
// resumeStep is one of: 'pre_send' | 'post_send'
const STATUS_ROWS = [
  // ── Pre-send states (workflow.consumer_link.sentAt is null) ───────────
  // "Started" and "New Lead" are set during origination but before the
  // consumer link is sent. If CoPilot opens on one of these, the agent
  // is still in the origination form — show LeadOriginationForm.
  ['Started',               'started',               'pre_send'],
  ['New Lead',              'lead.created',           'pre_send'],
  // Link "Created" means the EI link was generated but the agent has NOT
  // yet clicked "Send" — still in origination/confirm view.
  ['Capture Link Created',  'capture_link.created',  'pre_send'],
  ['Quote Link Created',    'quote_link.created',    'pre_send'],

  // ── Post-send states (workflow.consumer_link.sentAt is truthy) ────────
  // "Sent" means the agent clicked the send button; timeline is live.
  ['Capture Link Sent',     'capture_link.sent',     'post_send'],
  ['Quote Link Sent',       'quote_link.sent',       'post_send'],
  // "Viewed" — consumer opened the link; timeline shows engagement.
  ['Capture Link Viewed',   'capture_link.viewed',   'post_send'],
  ['Quote Link Viewed',     'quote_link.viewed',     'post_send'],
  // Capture/quote progression — all post-send partner webhook states.
  ['Capture Completed',     'capture.completed',     'post_send'],
  ['Working',               'working',               'post_send'],
  ['Quoted',                'quote.completed',       'post_send'],
  ['Quote Viewed',          'quote.viewed',          'post_send'],
  ['Policy Written',        'policy.bound',          'post_send'],
  // Error states are post-send (EI fires error webhooks after lead
  // origination; timeline renders error branch inline).
  ['Error - Verification',  'error.verification',    'post_send'],
  ['Error - Quote',         'error.quote',           'post_send'],
  // Duplicate is set synchronously when EI returns a 4xx on POST /leads —
  // the form itself sets this, so by the time a CoPilot opens on it the
  // flow is past the origination step. Map to post_send so timeline shows.
  ['Duplicate',             'duplicate',             'post_send'],
];

// Build both maps from the single source-of-truth row list to prevent drift.
export const STATUS_TO_STEP = Object.fromEntries(
  STATUS_ROWS.map(([label, , step]) => [label, step]),
);

export const MACHINE_ID_TO_STEP = Object.fromEntries(
  STATUS_ROWS.map(([, machineId, step]) => [machineId, step]),
);

/**
 * Returns the insurance view step for a given human-label status.
 *
 * @param {string|null|undefined} status  - Human-label status string
 *                                          (what mc's opportunity.status carries,
 *                                          e.g. "Quote Viewed", "Policy Written")
 * @param {string} fallback               - Step to return when status is unknown
 *                                          (typically 'pre_send')
 * @returns {'pre_send'|'post_send'|string} step key for the InsuranceEmbed consumer
 */
export function stepFromStatus(status, fallback = 'pre_send') {
  if (!status) return fallback;
  const mapped = STATUS_TO_STEP[status];
  return mapped !== undefined ? mapped : fallback;
}

/**
 * Returns the insurance view step for a given machine_id status.
 *
 * @param {string|null|undefined} machineId - Insurance machine_id (dotted lowercase,
 *                                            e.g. "quote.viewed", "policy.bound")
 * @param {string} fallback                 - Step to return when machine_id is unknown
 *                                            (typically 'pre_send')
 * @returns {'pre_send'|'post_send'|string} step key
 */
export function stepFromMachineId(machineId, fallback = 'pre_send') {
  if (!machineId) return fallback;
  const mapped = MACHINE_ID_TO_STEP[machineId];
  return mapped !== undefined ? mapped : fallback;
}
