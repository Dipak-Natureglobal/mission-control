# personas/ — backlog

## Lift trigger

When a second consumer of `effectiveBadges` / `can()` appears. Today only `mission-control/src/lib/permissions.js` exists (Wave 14 admin console).

## Lift surface

- `effectiveBadges(user)` — union of preset badges + added_badges − removed_badges.
- `can(user, badgeId)` — predicate.
- `badgesByCategory(user)` — grouped (compliance / priority / lifecycle / ...).
- `allPresets()` — all four persona presets for UI dropdowns.

## Likely second-consumer triggers

- protection-portal `view_api_responses` badge gating (today: persona equality check `=== 'super_admin'`).
- insurance-portal `view_api_responses` (Wave 14-fu added; same gate).
- refi-portal `view_api_responses` (already exists; same gate).
- super-admin reveal of integration credentials (`view_integration_credentials`) — currently mission-control only.
- Manager + create_tags badge — currently parent-derived in protection-portal NotesPanel consumer.

## Phase 3

- Server-side enforcement. Today the resolver is purely client-side; Phase 3 backend duplicates the logic for API authorization.
