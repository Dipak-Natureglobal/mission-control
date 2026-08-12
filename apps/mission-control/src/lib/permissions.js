// permissions.js — effective-badge resolver per architecture/10-admin-console.md.
//
// Algorithm (from canon/badges.json + the architecture doc):
//
//   effective_badges(user) =
//     union(
//       badges_from_persona(user.persona),       // canon/badges.json presets[persona].badges
//       user.added_badges                         // per-user overrides (additive)
//     )
//     − user.removed_badges                       // per-user overrides (subtractive)
//
//   can(user, badge) = badge ∈ effective_badges(user)
//
// Reads from canon/badges.json so persona presets stay the single source of
// truth. Per-user `added_badges` / `removed_badges` arrays live on the user
// fixture (see src/fixtures/users.json — Phase 1 fixture-driven; Phase 2
// served by the API layer with the same shape).
//
// Phase 1: pure functions over the canon JSON. Phase 2: same signatures,
// implementation may add caching / membership testing on a Set.

import badgesCanon from '../constants/canon/badges.json';

/**
 * Resolve the full effective badge set for a user.
 *
 * @param {object} user - { persona, added_badges?: string[], removed_badges?: string[] }
 * @returns {string[]} - sorted, de-duplicated badge ids
 */
export function effectiveBadges(user) {
  if (!user) return [];
  const presetBadges = badgesFromPersona(user.persona);
  const added = Array.isArray(user.added_badges) ? user.added_badges : [];
  const removed = new Set(Array.isArray(user.removed_badges) ? user.removed_badges : []);
  const merged = new Set([...presetBadges, ...added]);
  for (const b of removed) merged.delete(b);
  return [...merged].sort();
}

/**
 * Predicate — does `user` have `badge`?
 *
 * @param {object} user
 * @param {string} badge - canonical badge id (lowercase snake_case)
 * @returns {boolean}
 */
export function can(user, badge) {
  if (!user || !badge) return false;
  // Resolve via effectiveBadges so override semantics stay in one place.
  return effectiveBadges(user).includes(badge);
}

/**
 * Persona → preset badges. Looks up canon/badges.json `presets`. Returns []
 * for unknown personas (defensive — the persona switcher in App.jsx should
 * never send a value not in PERSONAS).
 *
 * @param {string} persona
 * @returns {string[]}
 */
export function badgesFromPersona(persona) {
  const preset = badgesCanon?.presets?.[persona];
  if (!preset || !Array.isArray(preset.badges)) return [];
  return preset.badges;
}

/**
 * All known badges as { id, label, category, scope, description } records.
 * Used by the UserEdit drawer's badge picker for grouping + display.
 *
 * @returns {Array<{ id, label, category, scope, description }>}
 */
export function allBadges() {
  const map = badgesCanon?.badges || {};
  return Object.entries(map).map(([id, def]) => ({ id, ...def }));
}

/**
 * Group badges by category for the UserEdit drawer (page / action / task / product).
 *
 * @returns {Record<string, Array<{ id, label, category, scope, description }>>}
 */
export function badgesByCategory() {
  const grouped = {};
  for (const b of allBadges()) {
    const cat = b.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(b);
  }
  return grouped;
}

/**
 * The canon presets list (id + label + description + badge ids), used by the
 * persona dropdown in UserEdit so labeling stays in canon.
 *
 * @returns {Array<{ id, label, description, badges }>}
 */
export function allPresets() {
  const map = badgesCanon?.presets || {};
  return Object.entries(map)
    .filter(([id]) => id !== '_principle')
    .map(([id, def]) => ({ id, ...def }));
}
