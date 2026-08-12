# CLAUDE.md — blinker-platform

This is the **meta-repo** for the Blinker rewrite. It holds cross-cutting plan, canon files, architecture docs, AND the shared platform package code under `packages/`. **It does not contain runnable application code** (no Vite app, no entrypoint, no dev server). Shared library code lives under `packages/` and is imported by child apps via the `file:../blinker-platform` dep — see `architecture/11-platform-package-layout.md`.

When working in this repo:
- You're updating shared truth (canon JSONs, architecture docs, scripts) AND/OR shared platform code (`packages/`). Canon changes may need to be sync'd into child apps via `scripts/sync-canon-into-apps.sh`. Package changes propagate live via the `file:` symlink — no sync step.
- Don't add runnable app code here. Full Vite apps live in sibling repos (`protection-portal/`, `insurance-portal/`, `customer-portal/`, `mission-control/`, `refi-portal/`). Reusable, workflow-agnostic library code (UI primitives, integration clients, the domain SDK) belongs under `packages/`.
- The legacy Blinker docs are NOT in this repo. They live read-only at `~/Documents/Claude/Projects/BlinkerLegacy/docs/mission-control/current-state/` (36+ files documenting every legacy screen, integration, status, data model). Reference them but don't extend them — that scope is closed.

When working in a child app (`protection-portal/` etc.):
- Read THAT app's CLAUDE.md first. Each app is self-contained.
- Only reach back to this repo for canon files (`canon/*.json`) and high-level cross-app architecture (`architecture/*.md`).
- Don't load multiple child app repos into the same session unless explicitly doing cross-cutting work.

## Coordinator role — what to do when a session is opened in THIS repo

If a user opens `blinker-platform/` in a fresh Cowork or Claude Code session, you are the **platform tech-lead / coordinator**. Your job is NOT to write app code — that lives in child apps. Your job is to:

1. **Read `STATUS.md` first.** That's the live tracker of what's done, what's in flight, what's blocked, and what's next across all child apps.
2. **When the user asks "what should I work on next?"** — read STATUS.md, identify the next unblocked Phase 1 task, generate a copy-pasteable prompt for the right child-app session (use `PROMPTS.md` as the template library), and tell the user which project to open in Cowork.
3. **When the user reports "X is done in protection-portal"** — update STATUS.md with the new state. If the completion unblocks downstream work in another app, surface that in your reply.
4. **When the user asks about cross-cutting decisions** (canon files, status taxonomy, integration boundaries, persona permissions) — answer from `canon/` + `architecture/`. If the question reveals a gap or contradiction, update the canon/architecture file AND note in STATUS.md that downstream apps need to re-sync.
5. **When the user asks to update canon** — edit `canon/*.json`, bump `canon/_version`, run `scripts/sync-canon-into-apps.sh`, and remind the user to commit the canon updates in each child repo.
6. **When something is ambiguous across apps** (e.g., "where does insurance savings card live — protection-portal or insurance-portal?") — propose an answer grounded in the integration-boundaries doc and the existing decisions log; don't guess.
7. **When the user asks about shared platform code** — direct them to `packages/<name>/`. The dep direction rule is one-way: `packages/*` may read `canon/*` and import sibling packages, but never imports from a child app. If a child-app import is proposed, surface the violation. See `architecture/11-platform-package-layout.md`.

You should NOT:
- Write runnable Vite/React app code in this repo. Library code under `packages/` is fine; full apps belong in sibling repos.
- Add files to `architecture/` or `canon/` without versioning notes.
- Tell the user to do something that conflicts with a locked decision in `README.md` without flagging the conflict explicitly.
- Load child app source files into context unless cross-cutting work demands it.

## Repo layout

```
blinker-platform/
├── README.md                  # platform overview, sibling repo index, decisions log
├── CLAUDE.md                  # this file — orientation for AI agents
├── package.json               # declares `blinker-platform` package + subpath exports for packages/
├── architecture/              # platform-level ADRs and integration boundary docs
│   ├── 00-system-map.md       # high-level picture of all 7 systems
│   ├── 01-event-taxonomy.md   # PostHog + DB write pattern
│   ├── 02-integration-boundaries.md       # app-to-app embedding contract
│   ├── 03-canon-versioning.md
│   ├── 04-personas.md
│   ├── 05-status-state-machines.md
│   ├── 06-embedded-insurance-contract.md
│   ├── 07-data-layer.md
│   ├── 08-cross-sell-orchestration.md
│   ├── 09-protection-billing-config.md
│   ├── 10-admin-console.md
│   ├── 11-platform-package-layout.md      # packages/ model + dep direction rules
│   ├── 12-notes-activities-pattern.md
│   ├── 13-stoneeagle-integration.md
│   ├── 14-term-semantics.md
│   ├── 15-se-error-handling.md
│   ├── 16-looker-embed.md
│   ├── 17-vin-validate-rates-comparison.md
│   ├── 18-plan-catalog.md
│   ├── 19-manager-experience.md
│   ├── 20-sales-leaderboard.md
│   ├── 21-insurance-protection-cross-sell.md
│   ├── 22-recommended-coverage-redesign.md
│   ├── 23-insurance-copilot-post-send-layout.md   # Wave 33 — insurance CoPilot left-rail timeline
│   ├── 24-protection-progress-timeline.md         # Wave 34 — protection left-rail step timeline
│   ├── 25-refi-progress-timeline.md               # Wave 35 — refi left-rail step timeline
│   ├── 26-insurance-quote-flow.md                 # Wave 36 — insurance quote-only flow first-class
│   ├── 27-contact-details-gate-and-timeline-actors.md  # Wave 37 — insurance contact-details gate + CoPilot timeline actor attribution
│   ├── 28-monthly-membership-vsc.md               # Wave 38 — monthly-membership VSC plans (999999 sentinel) in protection workflow
│   ├── 29-legacy-2.0-sync-boundary.md             # Legacy ↔ 2.0 data boundary — no two-way sync, one-time cutover migration
│   └── integration-partners/  # per-partner integration notes
├── canon/                     # versioned shared JSON copied into each child app
│   ├── blinker-domain.json    # canonical entity shapes (contact, opportunity, vehicle, ...)
│   ├── badges.json            # admin-console badges + presets (Wave 14)
│   ├── integrations.json      # external-system provider registry (Wave 14)
│   ├── insurance-carriers.json # US auto-insurance carrier registry (Wave 36 — quote-flow autocomplete)
│   ├── org-registry.json      # canonical Org IDs (matches Blinker Agreements API)
│   ├── org-disclaimers.json   # TCPA + e-sign + payment-auth copy
│   ├── ghl-fields.json        # GHL contact + opportunity field map (from spreadsheet)
│   ├── ghl-status.json        # platform status → CRM stage → external partner status
│   ├── personas.json          # super_admin / admin / manager / agent / consumer + permissions
│   ├── plan-mappings.json     # (TpaCode, ProductTypeCode, PlanCode) → PlanLevel + public copy
│   ├── relationships.json     # canonical household/contact relationship types
│   ├── system-tags.json       # canonical system tags + per-org additions
│   └── _version               # stamp file with current canon version (ISO date + tag)
├── packages/                  # NEW (Wave 15a) — shared application layer; imported via file:../blinker-platform
│   ├── README.md              # package model summary + dep rules
│   ├── components/            # workflow-agnostic React UI primitives (AddressBlock, NotesPanel, TagPicker, …)
│   ├── api/                   # blinkerApi domain SDK — Phase 1 fixtures, Phase 2 real
│   ├── integrations/          # provider-pluggable external-system clients by category
│   ├── utils/                 # pure libs (validators, formatters, math) — 3-strikes rule
│   ├── personas/              # effectiveBadges + can() resolver
│   └── telemetry/             # PostHog track() + event-name registry
├── scripts/
│   ├── sync-canon-into-apps.sh   # copies canon/*.json into each child app's src/constants/canon/
│   ├── validate-fixtures.js      # walks each child app's src/fixtures and warns on canon shape drift
│   └── start-all.sh              # parallel `npm run dev` across child apps
└── docs/
    └── prototype-plan.md      # the working plan — phases, asks, decisions
```

## Key decisions (locked, see README)

- Polyrepo, not monorepo
- Vite + React 19 + JS (no TS) + lucide-react substrate, matching refi prototype + payment-processing-platform
- DB source of truth, PostHog augments
- 5 personas, all stubbed in Phase 1
- Org hierarchy: Blinker → Parent Partner → Child Partner; 1 config per org; copy-down (no inheritance)
- Each opportunity workflow stays independent but rooted in Contact + Vehicle
- VIN OR manual YMMT, mismatch surfaces as confirmation
- Status taxonomy from the GHL Blinker Configuration spreadsheet's `status` tab is canonical

## Phase 1 build order

1. `protection-portal/` — first, because the consumer self-serve mockup PDF is the most fully-spec'd UX in the materials.
2. `mission-control/` — second, because once one full opportunity exists, the agent shell can co-pilot it.
3. `insurance-portal/` — third.
4. `customer-portal/` — last, because it's a thin re-skinned wrapper that imports from the others.

## When updating canon

1. Edit `canon/{file}.json`.
2. Bump `canon/_version` (ISO date is fine).
3. Run `scripts/sync-canon-into-apps.sh` to copy into each child app's `src/constants/canon/`.
4. Each child app reads `_version` at boot and warns in DevPanel if it lags.
5. Commit changes to canon/ in this repo. Sibling app commits track their canon copy too — explicit, no magic.

## Cross-references

- Legacy docs: `BlinkerLegacy/docs/mission-control/current-state/` (read-only)
- Slim DBML: `BlinkerLegacy/docs/mission-control/current-state/data-model/schema-in-use.dbml`
- Refi prototype source: `refi-portal/refi-prototype/src/`
- EFS prototype source: `payment-processing-platform/efs-prototype/src/`
- GHL Blinker Configuration: https://docs.google.com/spreadsheets/d/1LEa6dqjh0foV8hvs9j6BsSYlepIVcwfrj7HTqjiJcbA/edit
- Apex GHL location: `crm.blinker.com/v2/location/reWBjJ4bl9eIFdUlpl4w`

## Memory anchor

A summary of this architecture is also saved as a memory file (`blinker_platform_architecture.md`) in the working memory directory so that future Claude sessions starting in any sibling repo can quickly orient.
