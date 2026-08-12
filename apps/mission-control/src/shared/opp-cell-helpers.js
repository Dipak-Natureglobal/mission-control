// Shared helpers for rendering a contact's per-type opportunity cell
// (Refi / Ins / VSC). Lifted in Wave 26a Phase 3 — used by AgentInbox
// (contact-centric pivot) and AgentContacts (also contact-centric after
// Phase 3's column-replacement). Kept tiny: just the small pure
// helpers that would otherwise be copied verbatim. The OppCell JSX
// itself is short enough to live inline at each call site because the
// dim-cell semantics differ between surfaces (AgentInbox needs to dim
// non-matching cells when an inboxFilter is active; AgentContacts has
// no inbox-filter concept).

// "'YY Model" short label for an opportunity's `vehicle` string field
// (e.g. "2022 Toyota RAV4" → "'22 RAV4"). Falls through to the input
// when it can't parse a year. Returns null only for nullish input.
export function vehicleShortLabel(vehicle) {
  if (!vehicle) return null;
  const parts = String(vehicle).trim().split(/\s+/);
  if (parts.length < 2) return vehicle;
  const yearMatch = /^(\d{4})$/.exec(parts[0]);
  if (!yearMatch) return vehicle;
  const yy = yearMatch[1].slice(2);
  // Skip make; prefer model token. "2022 Toyota RAV4" → "RAV4",
  // "2019 Honda Pilot" → "Pilot". Year+make only → fall back to make.
  const model = parts.slice(2).join(' ') || parts[1];
  return `'${yy} ${model}`;
}

// Pick the most-recently-updated opportunity of a given `type` from a
// list. Returns null when none exist. Sort order: updated_at desc, then
// created_at desc as fallback.
export function latestOppOfType(opps, type) {
  const filtered = (opps || []).filter((o) => o.type === type);
  if (filtered.length === 0) return null;
  return [...filtered].sort((a, b) => {
    const ta = new Date(a.updated_at || a.created_at || 0).getTime();
    const tb = new Date(b.updated_at || b.created_at || 0).getTime();
    return tb - ta;
  })[0];
}
