// Insurance status taxonomy — thin reader over the synced canon block.
// Canon (`canon/ghl-status.json#insurance.statuses`) is the source of
// truth: each entry has a `machine_id` (lowercase dotted, used in app
// code + PostHog event names) and an optional `external_event` (the
// Embedded Insurance webhook event name). The human label is the JSON
// key.
//
// `STATUS` is generated from canon so adding a new status upstream
// (re-sync, no code change) makes it available here. NOT_STARTED is the
// only sentinel that lives outside canon — it represents "no workflow
// yet" before anything has happened.
import canon from './canon/ghl-status.json';

const insuranceStatuses = canon.insurance?.statuses ?? {};

const generated = Object.fromEntries(
  Object.values(insuranceStatuses).map((s) => [
    s.machine_id.toUpperCase().replace(/\./g, '_'),
    s.machine_id,
  ])
);

export const STATUS = { NOT_STARTED: 'not_started', ...generated };

// Look up the full canon entry (label, crm_stage, external_event,
// description, role) by machine_id. Returns `undefined` for unknown IDs
// or for NOT_STARTED.
export function getInsuranceStatus(machineId) {
  for (const [label, entry] of Object.entries(insuranceStatuses)) {
    if (entry.machine_id === machineId) return { label, ...entry };
  }
  return undefined;
}

// Reverse lookup for Embedded Insurance webhook events
// (e.g. 'status.verification.completed' → 'capture.completed').
export function machineIdForExternalEvent(eventName) {
  for (const entry of Object.values(insuranceStatuses)) {
    if (entry.external_event === eventName) return entry.machine_id;
  }
  return undefined;
}
