// Vehicle label formatter — canonical "{year} {make} {model}[ {trim}]"
// shape used by mc's left-pane CoPilot card, the inbox-row label, and
// the buildNewOpp opp.vehicle field. Lifted to packages/utils per the
// 3-strikes rule (Wave 16 F2-fu11-followup).
//
// Handles null / undefined gracefully — returns null when no
// year/make/model/trim are available, else trims and concatenates
// only the present fields. Trim is appended without a separator
// distinguishing it from model (matching mc's existing pattern in
// CoPilotPane.jsx: "{year} {make} {model}{trim ? ' ' + trim : ''}").

export function formatVehicleLabel(vehicle) {
  if (!vehicle) return null;
  const head = [vehicle.year, vehicle.make, vehicle.model]
    .filter((v) => v != null && String(v).trim() !== '')
    .map((v) => String(v).trim())
    .join(' ');
  const trim = vehicle.trim != null && String(vehicle.trim).trim() !== ''
    ? String(vehicle.trim).trim()
    : null;
  if (!head && !trim) return null;
  return trim ? `${head} ${trim}` : head;
}
