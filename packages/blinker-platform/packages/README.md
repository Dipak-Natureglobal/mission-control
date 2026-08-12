# `packages/` — the shared application layer

This directory holds the code every Blinker child app imports. Canon (`../canon/`) defines the *contracts*; `packages/` implements the *shared building blocks* that consume those contracts.

Each child app declares one dependency:

```jsonc
// child-app/package.json
"dependencies": {
  "blinker-platform": "file:../blinker-platform"
}
```

…and imports via the public subpath aliases declared in the root `package.json` `exports` map:

```js
import { AddressBlock, NotesPanel, TagPicker } from 'blinker-platform/components';
import { blinkerApi }                          from 'blinker-platform/api';
import { verifyEmail }                         from 'blinker-platform/integrations/email_verification';
import { lookupPhoneCarrier }                  from 'blinker-platform/integrations/sms_lookup';
import { can, effectiveBadges }                from 'blinker-platform/personas';
import { track }                               from 'blinker-platform/telemetry';
```

## Per-package charter

| Package | Charter | First population |
|---|---|---|
| `components/` | Workflow-agnostic React UI primitives. AddressBlock, NotesPanel, TagPicker today; PhoneInput + EmailInput coming. | Wave 15c (lift from refi-portal) |
| `api/` | Domain SDK. Phase 1 = fixture-backed client matching canon shape. Phase 2 = real client; one-line swap. | Phase 2 |
| `integrations/` | Provider-pluggable external-system clients organized by category (`email_verification/`, `sms_lookup/`, `payments/`, …). | Wave 15d (NeverBounce + Twilio Lookup) |
| `utils/` | Pure libs (validators, formatters, math). 3-strikes rule — only lift when 2+ apps already duplicate. | When triggered |
| `personas/` | `effectiveBadges` / `can()` / preset resolution. Lift target: `mission-control/src/lib/permissions.js`. | When second consumer arrives |
| `telemetry/` | PostHog `track()` wrapper + event-name registry. | When event-name registry needed |

## Dep direction rules

1. `packages/*` MAY read `../canon/*.json` (sibling JSON imports).
2. `packages/*` MAY import other `packages/*` (intra-platform composition allowed).
3. `packages/*` MUST NOT import from any child app (`mission-control`, `protection-portal`, `insurance-portal`, `refi-portal`, `customer-portal`).
4. Child apps consume via `file:../blinker-platform` only — never deep paths like `blinker-platform/packages/components/AddressBlock.jsx`.
5. Each `packages/<name>/index.js` is the only allowed import target. Internal layout under that file is private.

If you find yourself wanting to violate any of these, file the question against `architecture/11-platform-package-layout.md` instead — the rule exists for a reason.

## Why in-repo, not a separate `blinker-shared/` sibling?

`blinker-platform/` already sits at the bottom of the dependency graph — every app already syncs canon from here. Adding shared code co-locates it with the contracts it implements, removes one repo to track, and lets ADRs live next to the code they govern. See `architecture/11-platform-package-layout.md` for the full rationale.

## What this directory is NOT

- Not a Vite/Node app. There is no entrypoint, no dev server, no build step in 15a. Apps consume source files directly via the `file:` symlink.
- Not synced into child apps' `src/` trees. Unlike `canon/` (which `scripts/sync-canon-into-apps.sh` copies), packages are imported live.
- Not versioned independently per package. One root `package.json`, one version stamp.
