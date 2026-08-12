// Public surface for blinker-platform's persona + permissions resolver.
//
// CHARTER: a single source of truth for "what can this user do?" Read
// canon `personas.json` + `badges.json`, apply per-user overrides
// (added_badges / removed_badges), return effective badge set + can()
// predicate.
//
// Lift target: `mission-control/src/lib/permissions.js` (currently the
// only implementation; lifting when a second consumer needs it). Today
// permission gating in protection-portal / insurance-portal / refi-portal
// is implicit (persona prop drives UI variants); when those apps need
// real per-badge gates (e.g. `view_api_responses`), the same resolver
// applies.
//
// API surface (planned):
//   effectiveBadges(user) → string[]
//   can(user, badgeId) → boolean
//   badgesByCategory(user) → { compliance: [...], priority: [...], ... }
//   allPresets() → { agent: [...], manager: [...], admin: [...], super_admin: [...] }
//
// Dep direction (per architecture/11):
//   - MAY read `../../canon/{personas,badges}.json`.
//   - MAY import sibling packages (none expected).
//   - MUST NOT import from any child app.
//
// Consumers MUST import from this file ONLY.
//
// ---------------------------------------------------------------------
//
// Available public exports:
//
//   (none yet — Wave 15a is scaffold-only.)
//
//   First population: when a second consumer arrives. Most likely
//   trigger: super-admin features in protection-portal AgentView need
//   `view_api_responses` badge gating (currently uses persona equality).

// No exports yet — Wave 15a is scaffold-only.
