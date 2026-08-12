# 10 — Admin Console (Wave 14)

## Premise

The admin role in the rewrite owns four jobs:

1. **Manage users** in the org (and its child orgs) — invite, edit, suspend, assign personas + badges.
2. **Manage organizations** — view the org tree, create/archive child orgs, edit per-org metadata.
3. **Manage integrations** — wire up + maintain credentials for every external system the org uses (GHL, payment processors, plan providers, product administrators, signing, comms, data, banking, storage).
4. **Manage configuration** — per-org pricing, markup, discount caps, packages defaults, active states, branding, the `test_mode` broad-switch.

The legacy MissionControl admin surfaces (`/organizations`, `/configuration`, `/admins`) deliver this today but with significant friction (per legacy `screens/24-superadmin-restricted-sections.md` + `architecture/04-organization-configuration.md` + `screens/18-user-profile-edit-and-permissions.md`):

- Organizations index is a flat name list with zero metadata.
- Configuration is a single 50+-field form; integration credentials are buried in a `payment_services` JSONB blob with test/live splits scattered across env vars and per-org JSON.
- Admins are managed via a flat 60-checkbox badge UI; presets exist but are awkward.
- `test_mode` is a global broad-switch with massive blast radius and zero in-UI signaling.
- Configurations are NOT 1:1 with orgs (American Auto Alliance has RCO/BUSA/PA/NIC variants), so editing one config affects multiple orgs in non-obvious ways.

This admin console is the do-it-better. Lives in `mission-control` because it's an internal-staff surface that already shares persona-switching + nav + auth with the agent shell.

## Where it lives

`mission-control/src/personas/admin/` — the `admin` persona shell. Already scaffolded as a stub (`AdminHome.jsx`); Wave 14 replaces the stub with a real implementation.

`mission-control/src/personas/super/` — `super_admin` persona. Already has `SuperHome.jsx` + `StatusMappingEditor.jsx` (Wave 13). Wave 14 extends with cross-org views (org registry, user directory, integration catalog, audit trail).

Nav config: `mission-control/src/constants/nav.js` — admin nav becomes `Dashboard / Org tree / Users / Integrations / Configuration / Audit log`.

## Personas + permissions

Per `canon/personas.json` (extended 2026-05-05) + `canon/badges.json` (new 2026-05-05):

| Persona | Sees admin console? | Sees super console? | Can reveal credentials? | Can edit canon? |
|---|---|---|---|---|
| `agent` | no | no | no | no |
| `manager` | no | no | no | no |
| `admin` | yes (own + child orgs) | no | no | no |
| `super_admin` | yes (all orgs) | yes | yes | yes |

`admin` scope is bounded to `view_own_org + view_child_orgs`. The org tree filters accordingly. `super_admin` is unbounded.

## Canon contracts

Three canon files anchor the admin console:

- **`canon/badges.json`** — replaces the legacy 60-string flat array with structured `{ badges: { <id>: { label, category, scope, description } }, presets: { <persona>: { badges: [...] } } }`. All badge ids lowercase snake_case (fixes legacy case drift). Drops `LEGACY_ROLES` (admin/fraud/funding/posting/support/send_funds_to_lienholder) which were already TODO-remove in legacy code.

- **`canon/integrations.json`** — first-class registry of every external provider + the per-provider field schema. Each provider declares `supports_test_mode: bool`, `category`, `fields: [{ key, label, type, sensitive, required, env: ['test','live']? }]`. Drives the Integrations card grid + Edit drawer. **Replaces** the legacy `payment_services` JSONB shape — credentials are now per-provider, per-environment, with explicit sensitive-field marking for masking.

- **`canon/org-registry.json`** (extended) — adds `parent_org_id` (explicit hierarchy), `users_count`, `test_mode` (lifted from configuration to org level), and `integrations` block (per-org enabled providers + credential ref). Apex (102) ships with a populated example; AAA Prospect A (104) and Nicaragua (110) carry parent linkage to American Auto Alliance (2).

## Effective-permission resolution

```
effective_badges(user) =
  union(
    badges_from_persona(user.persona),       // canon/badges.json presets[user.persona].badges
    user.added_badges                         // per-user overrides (additive)
  )
  − user.removed_badges                       // per-user overrides (subtractive)

can(user, badge) = badge ∈ effective_badges(user)
```

The admin-console UserEdit drawer surfaces this as: **pick a persona** (preset dropdown) → optionally toggle 1-2 badges. Replaces the legacy 60-checkbox dump.

## test_mode preservation rules

`test_mode` is the most powerful per-org switch in the system. Per legacy `architecture/04-organization-configuration.md`, flipping it routes EVERY integration that supports it to its sandbox endpoint and credential set:

| Integration | Live mode reads | Test mode reads |
|---|---|---|
| Ensurety | `app_id` (live) + `account_code.live` + `processor.live` + `efs_token.live` | `app_id: BLINKERTESTAPP` + `account_code.test` + `processor.test` + `efs_token.test`; URL appends `?testMode=true` |
| FluidPay | `ENV[FLUIDPAY_URL]` + `fluidpay_live_api_key` | `ENV[FLUIDPAY_TEST_URL]` (sandbox.fluidpay.com) + `fluidpay_test_api_key` |
| FloPay | `ENV[FLOPAY_*]` | `ENV[FLOPAY_TEST_*]` |
| StoneEagle | `ENV[STONE_EAGLE_*]` (URL + tpa + user + pw + dealer) | `ENV[STONE_EAGLE_TEST_*]` (entire credential set) |
| Embedded Insurance | live env split | test env split |
| Twilio | live routing + from-number | test routing + from-number |
| DocuSeal, Mandrill, Zendesk, S3 | env-agnostic | env-agnostic |

**The admin console MUST:**

1. Render a persistent banner across every screen of an org with `test_mode: true`: *"⚠️ TEST MODE — every integration on this org is routing to sandbox. No real money moves and no real contracts get booked."*
2. On the test-mode toggle, open a confirm modal listing every provider that will flip with the new credential preview side-by-side. Require explicit confirm. Audit-log the toggle.
3. The toggle requires `toggle_test_mode` badge. `admin` and `super_admin` get it by default.
4. Never silently toggle. Never hide the banner.

This preserves the legacy capability (running real workflows against an org without affecting books) while removing the legacy footgun (silent broad-switch with no UI signaling).

## Configuration is 1:1 with orgs

Locked decision (per `README.md` and `CLAUDE.md`): **one configuration per org**, copy-down from parent on child-org creation, no inheritance after.

This explicitly rejects the legacy multi-config-per-org pattern (American Auto Alliance + AAA-RCO/BUSA/PA/NIC as separate Configuration rows). In our model:

- A new child org is created under a parent. At create-time, the parent's `protection_billing` + `cross_sell` + `integrations` defaults are copied into the new org.
- Subsequent edits to either org are independent. Editing the parent does NOT cascade to children.
- An admin can trigger a "re-copy from parent" operation explicitly, which is audit-logged and overwrites the child's overrides.
- "Configuration templates" (a separate, non-org canon block — out of Wave 14 scope) are an option for repeatable patterns; document if added.

This means the admin-console `Configuration` tab edits one org's config at a time. No sub-tabs for "RCO vs BUSA". If a partner needs multiple configurations, they get multiple child orgs.

## Credential storage policy

**Phase 1 (now):** Credential values live in `canon/org-registry.json`'s `integrations.<provider>.credentials.{test|live}` block as **fixture values, not real secrets**. Apex 102's block contains placeholder strings (`<ghl-api-key-fixture>`, `pk_test_apex`, etc.). The admin-console renders these against `canon/integrations.json` field schema.

**Phase 2 (real backend):** Credentials are encrypted-at-rest server-side. The admin-console NEVER receives raw credential values for `sensitive: true` fields except via a dedicated reveal endpoint:

```
POST /api/v3/orgs/:id/integrations/:provider/reveal
  body:    { field: 'api_key', env: 'live' }
  guards:  user has view_integration_credentials badge
  returns: { value: '...', revealed_at: ISO, audit_id: '...' }
  side-effect: append audit_event { type: 'credential_revealed', user, org, provider, field, env, ip, user_agent }
```

`view_integration_credentials` is in the `super_admin` preset by default. `admin` does NOT get reveal capability — admins can EDIT (write-only — they replace values without seeing the prior secret) but cannot REVEAL.

The Edit drawer in Phase 1 shows masked values (`••••••••`) by default with a Reveal button. In Phase 1 the reveal is local (the fixture value is in the same JSON); in Phase 2 the button calls the reveal endpoint.

## Audit log

Every admin-console mutation appends a row to the per-org `audit_events` collection:

- `org.created` / `org.updated` / `org.archived` / `org.recopy_from_parent`
- `user.invited` / `user.updated` / `user.suspended` / `user.persona_changed` / `user.badges_changed`
- `integration.enabled` / `integration.disabled` / `integration.credentials_updated` / `integration.tested`
- `credential.revealed` (super-admin only)
- `config.updated` (with field-level diff)
- `test_mode.toggled` (with from/to)

Phase 1: fixture-driven (`mission-control/src/fixtures/audit-events.json`).
Phase 2: server-side append-only log; super-admin gets cross-org view.

## Build phases

**Phase A — canon (this repo, complete 2026-05-05):**
- `canon/integrations.json` (new)
- `canon/badges.json` (new)
- `canon/personas.json` (extend with admin/super perms)
- `canon/org-registry.json` (add parent_org_id, integrations, users_count, test_mode)
- `canon/_version` bump
- `architecture/10-admin-console.md` (this file)

**Phase B — mission-control admin shell (dispatched agent):**
- Replace `personas/admin/AdminHome.jsx` stub with admin dashboard
- Update `constants/nav.js` admin nav to `Dashboard / Org tree / Users / Integrations / Configuration / Audit log`
- Build `OrgTree.jsx` (hierarchical view with health pills + counts)
- Build `OrgDetail.jsx` (tabs: Overview / Users / Integrations / Configuration / Audit)
- Build `UsersIndex.jsx` + `UserEdit.jsx` (badge picker + preset dropdown — replaces legacy 60-checkbox UI)
- Build `Integrations.jsx` (card grid sourced from canon/integrations.json) + per-provider Edit drawer (test/live tabs, sensitive-field masking, reveal-on-click)
- Build `OrgConfiguration.jsx` (grouped accordions over org's protection_billing + cross_sell)
- Build `AuditLog.jsx` (timeline from fixtures)
- Persistent test-mode banner on any screen of an org with `test_mode: true`
- Confirm modal on test_mode toggle
- New fixtures: `users.json`, `audit-events.json`
- PostHog: `mission_control.admin.{user,integration,config,audit,test_mode}_*`

**Phase C — super-admin extensions:**
- Extend `SuperHome.jsx` (already has status-mapping editor) with tiles for: Org registry (CRUD orgs + hierarchy), User directory (cross-org search), Integration catalog (canon-driven; add new provider types), Cross-org audit trail, Canon drift dashboard
- `view_integration_credentials` reveal handler

**Phase D — manager extensions (later):**
- Out of Wave 14 scope. Manager persona stays a stub until product confirms scope.

## Open questions

1. Whether `view_integration_credentials` is reveal-once (fetch + cache + auto-mask after N seconds) or reveal-and-stays. Lean reveal-once for security; confirm with product.
2. Whether the audit log is org-scoped or global. Phase 1 = org-scoped per the structure above; super-admin can pivot to cross-org. Phase 2 may want a unified store with org filter.
3. Whether `test_mode` ever gets per-integration override (e.g., "this org is in test mode but DocuSeal stays live"). Legacy is all-or-nothing; we preserve that simplicity unless product asks for granularity.
4. Configuration-template support — useful for new orgs that want to clone an existing successful org's setup without reverse-engineering its config. Out of Wave 14 scope; revisit if more than 3 orgs need the same setup.
5. How do we handle credential rotation? Phase 2 should support "rotate now" with overlap window for in-flight requests.

## Cross-references

- `canon/integrations.json` — provider field schema
- `canon/badges.json` — badge taxonomy + persona presets
- `canon/personas.json` — persona definitions (in-sync with badges.json presets)
- `canon/org-registry.json` — org hierarchy + per-org integrations + test_mode
- `architecture/02-integration-boundaries.md` — public surface contract for embedded UI
- `architecture/07-data-layer.md` — Phase 1 fixture → Phase 2 API swap
- `BlinkerLegacy/docs/mission-control/current-state/architecture/04-organization-configuration.md` — legacy Configuration model + test_mode fan-out (the reference doc this rewrites)
- `BlinkerLegacy/docs/mission-control/current-state/screens/18-user-profile-edit-and-permissions.md` — legacy badge system + the case-drift bug we fix here
- `BlinkerLegacy/docs/mission-control/current-state/screens/24-superadmin-restricted-sections.md` — legacy admin-surface inventory
- `BlinkerLegacy/MissionControl/src/features/admin/badges.ts` — legacy 60-string array (the source for what we slim down)
- `BlinkerLegacy/MissionControl/src/features/admin/adminProfilePresetsConfig.js` — legacy presets (the source for our `presets` block)
- `BlinkerLegacy/MissionControl/src/features/configuration/configurationForm.tsx` — legacy mega-form (the source for what we group into accordions)
