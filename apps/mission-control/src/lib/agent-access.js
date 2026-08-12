// agent-access — Wave 26a fu3 helpers for scoping filter-list enums to
// the logged-in agent's organizational reach.
//
// Two rules drive these helpers:
//   (1) Static org scope — an advanced filter's Organization option set
//       should only list orgs the logged-in agent has an association
//       with (today, until a real identity exists, that's "all
//       canon-active orgs").
//   (2) Dependent owner/user scope — when one or more orgs are
//       currently staged in the same modal's Organization filter, the
//       Owner / Agent-User enum should list only owners whose
//       opportunities touch a contact in one of those orgs. With zero
//       orgs staged, the enum shows all owners whose opps touch an
//       org from rule (1) (i.e. the accessible-orgs set).
//
// This is a FILTER-LIST VISIBILITY change only. Row-level hiding (e.g.
// refusing to render an opp whose contact is in an inaccessible org)
// is a server-side concern that lands in Phase 2 — DO NOT add row
// filtering on top of this helper.
//
// TODO (Wave 26b): once `src/fixtures/agents.json` exists (canon-aligned
// per the Wave 26a Phase 2 readiness audit gap), replace
// STUB_AGENT_ORG_ASSOCIATIONS with a fixture lookup keyed by the
// logged-in agent's id. Phase 2 will derive this from the user record
// server-side via the Agreements API.

import orgRegistry from '../constants/canon/org-registry.json';

// `null` means "all canon-active orgs" — the Phase-1 default for the
// "Devon" placeholder used by AgentHome / Inbox / Contacts. Override
// entries here when manually exercising the scoping rule during a
// prototype demo (e.g. set 'devon' to [102] to simulate an
// Apex-only agent).
const STUB_AGENT_ORG_ASSOCIATIONS = {
  devon: null,
};

// Return the canonical numeric org IDs the agent has access to. Defaults
// to "all canon-active orgs" — matches today's visible-org set so the
// scoping rule is invisible until a per-agent override is wired.
export function getAccessibleOrgIds(agentKey = 'devon') {
  const all = (orgRegistry.orgs || [])
    .filter((o) => o.status === 'active')
    .map((o) => o.id);
  const cfg = STUB_AGENT_ORG_ASSOCIATIONS[agentKey];
  if (cfg == null) return all;
  return all.filter((id) => cfg.includes(id));
}

// Return the full canon org objects (id + name + …) the agent can see.
// Consumers use this to drive the Organization filter enum directly so
// the option labels match canon names.
export function getAccessibleOrgs(agentKey = 'devon') {
  const ids = new Set(getAccessibleOrgIds(agentKey));
  return (orgRegistry.orgs || []).filter((o) => ids.has(o.id));
}

// Build owner → Set<orgId> from the live opps + contacts. An "owner" is
// the `opportunity.owner` display-name string; their associated orgs are
// the orgs of every contact whose opps they own.
//
// `opportunities`: array of opp records.
// `contacts`: object keyed by contact_id (the session shape), OR an
//             array of contact records (we tolerate both).
//
// Returns: Map<ownerString, Set<orgId>>.
export function deriveOwnerOrgMap(opportunities, contacts) {
  const map = new Map();
  // Normalize contacts → keyed object so the lookup is O(1).
  const byId = Array.isArray(contacts)
    ? Object.fromEntries((contacts || []).map((c) => [c.id, c]))
    : contacts || {};
  for (const o of opportunities || []) {
    if (!o || !o.owner) continue;
    const c = byId[o.contact_id];
    if (!c || c.org_id == null) continue;
    if (!map.has(o.owner)) map.set(o.owner, new Set());
    map.get(o.owner).add(c.org_id);
  }
  return map;
}

// Filter the owner list down to those associated with at least one of
// the selected org IDs. When `selectedOrgIds` is empty (the user hasn't
// touched the Organization filter yet), return every owner from the
// map — which is already implicitly scoped by `deriveOwnerOrgMap`'s
// input (callers pass the opps + contacts the agent can see).
export function ownersForOrgs(ownerOrgMap, selectedOrgIds) {
  if (!selectedOrgIds || selectedOrgIds.length === 0) {
    return [...ownerOrgMap.keys()];
  }
  const set = new Set(selectedOrgIds);
  return [...ownerOrgMap.entries()]
    .filter(([, orgs]) => [...orgs].some((id) => set.has(id)))
    .map(([owner]) => owner);
}
