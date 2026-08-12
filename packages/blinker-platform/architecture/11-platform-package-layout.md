# 11 — Platform Package Layout (Wave 15a)

## Premise

The Blinker platform is polyrepo (per the locked decisions in `README.md`). Each child app owns its workflow end-to-end, and cross-app touchpoints happen at narrow seams documented in `architecture/02-integration-boundaries.md`. That seam catalog covers app-to-app embedding (mission-control consumes protection-portal's `AgentView`, protection-portal consumes refi-portal's `PrequalForm`, etc.) — the case where one app pulls in another app's full screen or feature.

Wave 6 (2026-05-04) introduced a different shape: **workflow-agnostic UI primitives shared across apps**. `AddressBlock`, `NotesPanel`, and `TagPicker` are tiny composable widgets with no workflow opinion — every consumer needs an address picker, a tag picker, a notes pane. They were placed under `refi-portal/src/components/` because refi-portal already had the most polished implementations, and other apps consumed via `file:../refi-portal`.

That decision was expedient. It produced a real asymmetry:

- **refi-portal wears two hats** — it's a consumer app AND a component library. The same repo's `src/components/` directory mixes app-internal components (DevPanel, EmbeddedEntry, FormFields, JsonPeek, Stage2Shell, TopBar, WizardShell) with cross-app exports (AddressBlock, NotesPanel, TagPicker). Drift between the two categories is a constant judgment call.
- **The dep direction is inverted** — orchestrators (mission-control) consume primitives from a leaf consumer app (refi-portal). Primitives should sit at the *bottom* of the dep graph, not in a peer app.
- **`protection-portal/vite.config.js`** carries a `refiConstantsBarrelShim` plugin specifically because protection-portal's components import path crosses through refi-portal's broken `src/constants/index.js`. The shim becomes irrelevant once primitives stop traveling through refi.

Three new needs crystallized this asymmetry into a forcing function:

1. **Wave 15** adds NeverBounce email verification + Twilio Lookup phone verification with a provider-pluggable abstraction. New `PhoneInput` + `EmailInput` shared components. Where do they live? Adding them to `refi-portal/src/components/` extends the wrong pattern.
2. **Phase 2** introduces a real API client (`blinkerApi.contacts.create()`, etc.) replacing fixtures. The same hosting question applies — and the answer can't be "in refi-portal" because the SDK is workflow-agnostic.
3. **Future integrations** beyond email/phone (FluidPay, Plaid, GHL sync, etc.) need a unified abstraction with category interfaces. Same problem.

A separate `blinker-components/` sibling repo solves the UI-only case but kicks the can on the API and integrations questions. A separate sibling repo per shared concern (`blinker-api/`, `blinker-integrations/`, `blinker-utils/`, `blinker-telemetry/`) is repo proliferation by accident.

## Decisions

**1. Promote `blinker-platform/` from "docs + canon" to "platform package + canon + architecture".**

This repo already sits at the bottom of the dependency graph — every app already syncs canon from here. Adding shared application code co-locates it with the contracts it implements, removes a sibling repo from the operational footprint, and lets ADRs live next to the code they govern. The "no application code" rule in the prior `CLAUDE.md` was correct for the meta-repo's original charter; library code is a distinct category from runnable apps and warrants the rule update.

**2. New top-level directory: `packages/`.**

```
blinker-platform/
├── README.md                  # platform overview (existing)
├── CLAUDE.md                  # AI agent orientation (existing; updated 15a)
├── architecture/              # platform-level ADRs (existing)
├── canon/                     # versioned shared JSON (existing)
├── scripts/                   # canon sync, fixture validators (existing)
├── docs/                      # planning docs (existing)
├── PROMPTS.md / STATUS.md     # coordinator state (existing)
├── package.json               # NEW — declares `blinker-platform` package + exports
└── packages/                  # NEW — shared application layer
    ├── README.md
    ├── components/            # workflow-agnostic React UI primitives
    ├── api/                   # blinkerApi domain SDK (Phase 2 swap point)
    ├── integrations/          # provider-pluggable external-system clients
    ├── utils/                 # pure libs (validators, formatters, math)
    ├── personas/              # effectiveBadges + can() resolver
    └── telemetry/             # PostHog track() + event-name registry
```

Per-package charter:

- **`components/`** — Workflow-agnostic React UI primitives. Wave 15c lifts AddressBlock + NotesPanel + TagPicker from refi-portal verbatim. Wave 15e adds PhoneInput + EmailInput. Beyond Wave 15: candidates surface from the 15b audit.
- **`api/`** — Domain SDK matching canon `blinker-domain.json` shapes. Phase 1 = fixture-backed client; Phase 2 = real client; identical call surface so consuming apps don't change. Empty in 15a; populates when Phase 2 work begins.
- **`integrations/`** — Provider-pluggable external-system clients organized by category. Apps import categories (`email_verification`, `sms_lookup`, `payments/tokenizer`, …); the active provider per org is resolved from canon `integrations.json` + `org-registry.json::integrations`. NeverBounce + Twilio Lookup land in 15d; rest follow 3-strikes.
- **`utils/`** — Pure functions consumed by 2+ apps. 3-strikes rule. Empty in 15a.
- **`personas/`** — Single source of truth for effective-badge resolution + `can()` predicate. Lift target: `mission-control/src/lib/permissions.js`. Empty in 15a; populates when a second consumer arrives.
- **`telemetry/`** — Thin `track()` wrapper around PostHog plus event-name registry. Empty in 15a; populates when event-name drift becomes painful.

**3. Subpath imports via root `package.json` `exports` field.**

Single root `package.json` declares `name: "blinker-platform"` and an `exports` map that aliases public subpaths:

```jsonc
"exports": {
  "./components":           "./packages/components/index.js",
  "./api":                  "./packages/api/index.js",
  "./integrations":         "./packages/integrations/index.js",
  "./integrations/*":       "./packages/integrations/*/index.js",
  "./utils":                "./packages/utils/index.js",
  "./personas":             "./packages/personas/index.js",
  "./telemetry":            "./packages/telemetry/index.js",
  "./canon/*":              "./canon/*"
}
```

Apps add one dep — `"blinker-platform": "file:../blinker-platform"` — and import:

```js
import { AddressBlock } from 'blinker-platform/components';
import { verifyEmail }  from 'blinker-platform/integrations/email_verification';
```

The `packages/` prefix is hidden behind the alias on purpose — consumers think in terms of "blinker-platform's components" rather than the on-disk layout. Internal package layout under `packages/<name>/` is private.

**4. Dep direction rules.**

1. `packages/*` MAY read `../canon/*.json` directly (sibling JSON imports).
2. `packages/*` MAY import other `packages/*` (intra-platform composition allowed).
3. `packages/*` MUST NOT import from any child app (`mission-control`, `protection-portal`, `insurance-portal`, `refi-portal`, `customer-portal`).
4. Child apps consume via `file:../blinker-platform` and the public subpath aliases. Deep imports like `'blinker-platform/packages/components/AddressBlock.jsx'` are NOT permitted by the `exports` map and will fail at resolve time.
5. Each `packages/<name>/index.js` is the only allowed import target. The on-disk layout under that file is private.
6. The legacy `'refi-portal/src/components'` import path is grandfathered until Wave 15c lifts the trio. After 15c it goes away.

**Anti-pattern (do NOT do this):**

```js
// In packages/components/AddressBlock.jsx — VIOLATES rule 3
import { useSessionData } from 'mission-control/src/lib/session-data';
```

If a package needs domain entities, route through `packages/api/` (which is itself canon-shape, not app-shape). If a package needs persona gating, route through `packages/personas/`. If neither exists yet, file the question — don't reach into a child app.

**5. No `packages/` sync mechanism.**

Unlike `canon/` (which `scripts/sync-canon-into-apps.sh` copies into each child app's `src/constants/canon/` directory at sync time), packages are imported live via the `file:` symlink. Editing `packages/components/AddressBlock.jsx` is immediately visible in every consuming app's dev server. No copy step, no version drift. Vite HMR works through the symlink (same as today's `file:../refi-portal` pattern).

The canon sync script is unchanged. Canon is data; packages are code; the two propagate differently for good reason.

**6. Single CI, single version.**

All packages share one root `package.json` and one version stamp. Independent versioning per package would require multiple `package.json` files (one per package) plus tooling to publish/consume them — premature complexity. The 5-app polyrepo model already accepts that the platform moves as one; sharing a version inside the platform is consistent with that.

This is flagged for Phase 3 reconsideration in the Open Questions section.

**7. CLAUDE.md (this repo) updated to permit shared library code.**

The prior rule "It does not contain application code" applied to the meta-repo's original charter (canon + architecture only). Wave 15a updates it to: "It does not contain runnable application code (no Vite app, no entrypoint). Shared library code lives under `packages/`." The coordinator role gains a bullet for handling `packages/` work and enforcing the dep direction rules.

## Layout

See decision 2 above for the directory map and per-package charter.

## Public-surface contract

Every `packages/<name>/index.js` is the only allowed import target — same rule that already governs each child app's public surface (per `architecture/02-integration-boundaries.md`). The JSDoc skeleton at the top of each `index.js` documents:

1. Package charter (one paragraph).
2. Embed-contract reminders (`{ persona, personaLocked }`, `form` + `update(patch)`, `fieldNames` overrides — same conventions inherited from refi-portal's existing pattern at `refi-portal/src/components/index.js:1-50`).
3. Dep direction (per rules above).
4. External prerequisites (e.g., AddressBlock's hardcoded Google Places API key — carried forward from refi-portal).
5. Available public exports — listed with full JSDoc per export.

When 15c lifts AddressBlock + NotesPanel + TagPicker, the per-component JSDoc blocks at `refi-portal/src/components/index.js:46-266` port verbatim into `packages/components/index.js`. The contract doesn't change with the move.

## Test mode + per-org gating

Integrations packages MUST honor the `org.test_mode` broad-switch principle declared in `canon/integrations.json::_test_mode_principle` and elaborated in `architecture/10-admin-console.md`. When an org has `test_mode: true`, every integration that declares `supports_test_mode: true` reads its sandbox endpoint + credential set instead of live.

A new per-org canon block — `org-registry.json::orgs[*].contact_validation` — lands in Wave 15d. It governs validation policy (advisory vs blocking) per category:

```jsonc
"contact_validation": {
  "email": { "policy": "advisory", "skip_for_existing": true },
  "phone": { "policy": "advisory", "allowed_types": ["mobile", "nonFixedVoip", "tollFree", "voip"] }
}
```

Policy is enforced at the consuming UI (`packages/components/PhoneInput`, `EmailInput`), not at the integration layer. The integration just reports the verification result; the UI decides whether to gate the save. This matches the legacy NeverBounce pattern (`BlinkerLegacy/blinker/app/validators/email_verification_validator.rb` — the blocking branch is explicitly commented out).

## Phasing

| Wave | Scope | Status |
|---|---|---|
| **15a** | Scaffold `packages/` tree (empty), root `package.json`, ADR (this file), CLAUDE.md update. | this commit |
| **15b** | Read-only audit pass across all 6 repos. Output: ranked extraction inventory (impact × effort). | next |
| **15c** | Lift AddressBlock + NotesPanel + TagPicker from refi-portal → `packages/components/`. Sweep 5 child-app imports. | after 15b |
| **15d** | Implement `packages/integrations/email_verification/{neverbounce,kickbox,zerobounce}` + `packages/integrations/sms_lookup/twilio`. Canon bump: `integrations.json` adds `email_verification` provider; `twilio` extended with `lookup_enabled`. New `org-registry.json::orgs[*].contact_validation` block. | after 15c |
| **15e** | New `packages/components/PhoneInput` + `EmailInput` consuming the 15d integrations. | after 15d |
| **15f** | Sweep consumers — replace inline phone/email inputs at 5 capture sites across 4 apps. Admin-console drawer surfaces new providers automatically (canon-driven, no UI work). | after 15e |
| **21**  | First `packages/integrations/product_admin/` lift — StoneEagle GetRates (eRating v1.31) promoted from `protection-portal/src/lib/stoneeagle.js` into `packages/integrations/product_admin/{index,_provider,stoneeagle,express_aftermarket}.js`. Phase 1 fixture-backed; Phase 2 proxy-mode anchor in place. Canon bumped (`integrations.json` schema; `org-registry.json` Apex OMGA UAT creds; `plan-mappings.json` product-type codes + regulated-rule + discountable blocks). ADR `architecture/13-stoneeagle-integration.md`. Reference PDFs at `architecture/integration-partners/stoneeagle/`. **3-strikes rule deliberately broken** — single consumer (protection-portal) today; lift justified by integration high-stakes + grep-anchored TODO. | landed 2026-05-09 |
| Beyond | Audit-driven extractions for other categories (utils, personas, telemetry, payments, …). 3-strikes rule. | as triggered |

## Open questions / _TODO

- **Independent versioning at scale.** Single root `package.json` is right for now. If `packages/api/` ships a published partner-facing client in Phase 3, that subset may need its own version stamp. Reconsider when concrete.
- **REST + WebSocket subscription, or REST only, for `packages/api/`?** Real-time activity stream needs subscription support eventually (per `architecture/07-data-layer.md` `_consumed_by` pattern). Decide when Phase 2 starts.
- **Auth context location.** `packages/api/` will need current-user context to scope reads; likely `packages/personas/` injects it at boot. Codify when the second package needs it.
- **Server-side enforcement of `packages/personas/`.** Today the resolver is purely client-side; Phase 3 backend will duplicate the logic for API authorization. Out of scope for Wave 15.
- **Telemetry registry canonization.** Should event names live in canon (e.g. `canon/events.json`) or stay declared per-package via `registerEvents([...])`? Defer to telemetry's first population.
- **Drop `protection-portal/vite.config.js` `refiConstantsBarrelShim`** once 15c flips the components import path off refi-portal — the shim's only job was to dodge a refi-portal/src/constants barrel breakage that consumers no longer transit through.

## Cross-references

- `architecture/02-integration-boundaries.md` — App-to-app embed contract. ADR 11 is the *intra-platform* analog (apps consuming primitives from `blinker-platform/packages/*`).
- `architecture/07-data-layer.md` — Phase 1 fixture → Phase 2 API swap pattern. `packages/api/` is the swap point.
- `architecture/10-admin-console.md` — `canon/integrations.json` shape + test_mode principle. `packages/integrations/` consumes that canon.
- `canon/integrations.json` — Provider registry; `packages/integrations/` resolves providers from this.
- `refi-portal/src/components/index.js` — Original public-surface JSDoc pattern; `packages/components/index.js` lifts the convention.
- `BlinkerLegacy/blinker/app/services/{external_email_verifier,phone_type_checker}.rb` — Lift sources for Wave 15d NeverBounce + Twilio Lookup.
