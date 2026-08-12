# blinker-platform

Meta-repo for the Blinker rewrite. **Small on purpose.** Holds platform-level docs, the canonical shared JSON files (org registry, GHL field/status maps, personas, plan mappings), and dev scripts that operate across multiple child apps.

The actual application code lives in sibling repos, each independently deployable, with its own `CLAUDE.md`. AI agents working in any one app load that app's context only — the platform repo exists to preserve cross-cutting decisions and shared canonical data without forcing apps into a monorepo.

## How to use this repo

**This repo is the platform-coordinator role.** Open it in a fresh Cowork or Claude Code session whenever you want to:
- Ask "what should I work on next?" (read [`STATUS.md`](STATUS.md), get a prompt from [`PROMPTS.md`](PROMPTS.md))
- Report "I just finished X in protection-portal" (so [`STATUS.md`](STATUS.md) gets updated and downstream blockers get cleared)
- Update canon files (then run `scripts/sync-canon-into-apps.sh`)
- Resolve cross-app questions (canon, status taxonomy, integration boundaries, persona permissions)

The AI session in this repo will NOT write app code — that lives in child repos. See [`CLAUDE.md`](CLAUDE.md) § "Coordinator role".

**Live state:** [`STATUS.md`](STATUS.md) — what's done, in flight, blocked, next
**Prompts library:** [`PROMPTS.md`](PROMPTS.md) — copy-paste for each child app session
**Working plan:** [`docs/prototype-plan.md`](docs/prototype-plan.md)
**System map:** [`architecture/00-system-map.md`](architecture/00-system-map.md)

## Sibling repos

| Repo | What it is | Status | Path |
|---|---|---|---|
| `BlinkerLegacy/` | Read-only legacy reference (Rails + React 17 MissionControl + DocuSeal fork + IaC) | live in production at `missioncontrol.blinker-prod.com` | `~/Documents/Claude/Projects/BlinkerLegacy` |
| `refi-portal/` | Refi v2 prototype (consumer + agent + partner-embed wizard) | dev `localhost:5173` | `~/Documents/Claude/Projects/refi-portal` |
| `payment-processing-platform/` | Payment orchestrator (Cloud Run) + EFS admin portal + customer-portal stub | dev `localhost:5174` (admin); `payments.blinker-prod.com` (customer) | `~/Documents/Claude/Projects/payment-processing-platform` |
| `customer-portal/` | All consumer-facing flows (protection / refi / insurance / payments) + partner-embed launchpad | scaffolding | `~/Documents/Claude/Projects/customer-portal` |
| `mission-control/` | Internal agent / manager / admin / super shell — opportunity-centric inbox + co-pilot | not yet started | `~/Documents/Claude/Projects/mission-control` |
| `blinker-website/` | D2C marketing site — static HTML on Firebase Hosting (standalone; **not** part of the Vite/React substrate — no canon/personas/file-deps) | **live** `get.blinker.com` (Firebase, GCP `blinker-prod-473719`) | `~/Documents/Claude/Projects/blinker-website` |
| `songbird-website/` | Flock by SongBird dealer marketing site (FlockDealer.com Round 1, dealer-only) — static HTML on Firebase Hosting (standalone; **not** part of the Vite/React substrate — no canon/personas/file-deps) | **live** `flockdealer.web.app` → FlockDealer.com (Firebase, GCP `blinker-prod-473719`, site `flockdealer`) | `~/Documents/Claude/Projects/songbird-website` |

## Shared canonical data — `canon/`

These JSON files are the source of truth for cross-app concepts. They get **copied** into each app's `src/constants/canon/` (no symlinks, no npm dep — explicit copy with version stamp) via `scripts/sync-canon-into-apps.sh`. When canon changes, bump the version, re-run sync, every app gets the update.

| File | What it represents | Source |
|---|---|---|
| `org-registry.json` | The canonical Org ID list (102 = Apex, 104 = AAA Prospects A, etc) | mirrors Blinker Agreements API; matches EFS prototype's `Settings → Organizations` |
| `ghl-fields.json` | GHL contact + opportunity custom-field map → Blinker model+field | from the [GHL Blinker Configuration spreadsheet](https://docs.google.com/spreadsheets/d/1LEa6dqjh0foV8hvs9j6BsSYlepIVcwfrj7HTqjiJcbA/edit) `fields` tab |
| `ghl-status.json` | Platform status → CRM stage → External partner status mapping for VSC, Refi, Insurance | from the spreadsheet's `status` tab |
| `personas.json` | Five personas: super_admin, admin, manager, agent, consumer + their permissions | TBD — drafted from the prototype-plan |
| `plan-mappings.json` | (TpaCode, ProductTypeCode, PlanCode) → PlanLevel (Good/Better/Best) + public copy + URL | per the consumer self-serve PDF mockup notes |

## Architecture docs — `architecture/`

Platform-level ADRs and integration boundary docs that span more than one repo. Most documentation that's specific to one app lives in that app's repo.

- `00-system-map.md` — TBD — high-level picture of all 7 systems
- `01-event-taxonomy.md` — TBD — PostHog + DB write pattern across apps (DB is source of truth, PostHog wins on reconciliation)
- `02-integration-boundaries.md` — TBD — what each app owns vs. consumes
- `03-canon-versioning.md` — TBD — how canon files move between this repo and child apps

## Scripts

- `scripts/sync-canon-into-apps.sh` — copies `canon/*.json` into each child app's `src/constants/canon/`, stamps the canon version into a generated `_version.js`. Apps can read `CANON_VERSION` to detect drift.
- `scripts/start-all.sh` — TBD — convenience to spin up all child apps' dev servers in parallel.

## CLAUDE.md guidance

Each child app has its OWN narrow `CLAUDE.md`. The platform-level `CLAUDE.md` (in this repo) gives Claude orientation across the entire ecosystem when working on cross-cutting changes. AI agents working inside a child app should NOT load this repo unless specifically asked.

## Why polyrepo

- **AI context budget.** Monorepo with 6+ apps = 6× context overhead. Polyrepo means each Cowork/Claude Code session loads exactly the app you're working on.
- **Independent deployability.** Each app already has a real production target (or will): `missioncontrol.blinker-prod.com`, `payments.blinker-prod.com`, partner-embed iframes, etc. Different release cadences, different security boundaries.
- **Partner access.** When AAA or Apex needs the protection-portal embedded in their site, you grant access to one repo, not the entire platform.
- **Shared concerns are small.** Canon files (~5 JSONs), design tokens, status constants. Easy to factor into a shared `canon/` that gets copied.

## Decisions locked

- **DB is source of truth**, PostHog is event audit + identity, both write status changes, PostHog wins on reconciliation if drift.
- **Each opportunity workflow is independent** but always rooted in Contact + Vehicle.
- **Org hierarchy** is Blinker → Parent Partner → Child Partner; **1 config per org** (parent can copy-down to child, no inheritance).
- **Five personas:** super_admin / admin / manager / agent / consumer. Manager + Admin + Super Admin are stubbed in Phase 1.
- **Tech stack matches refi prototype + payment-processing-platform:** Vite + React 19 + JavaScript (no TS) + lucide-react + tailwind-style classes + custom `useForm` + monolithic `App.jsx` per app + DEV CONTROLS sidebar pattern.
- **GHL is less granular** than Blinker DB + PostHog. Blinker has every step; GHL has stages.
- **VIN OR manual YMMT** — both paths supported. Model mismatch (VIN-decode disagrees with manual selection) surfaces as a confirmation step, not silent.
- **`protection-portal` is the orchestrator for cross-sell embeds** (2026-05-03). The protection workflow's RecommendedCoverage step is the agent's selling moment; insurance + refi are pulled in as embeds, not the other way around. `mission-control` consumes from all but exposes nothing; `customer-portal` re-skins. Rationale: avoids fork-then-rot of UI surfaces; the agent's selling moment lives in the protection workflow. Full ADR: `architecture/08-cross-sell-orchestration.md`.
- **`refi-portal` repo at `~/Documents/Claude/Projects/refi-portal/`** (2026-05-03). The previous `Refinance Application Version 2/refi-prototype/` directory was renamed locally to `refi-portal/` (its inner `refi-prototype/` subdirectory remains, pending a flatten in § 1.5b); the GitHub remote is `github.com/BlinkerGit/refinance-prototype` (kept under that name for now — local↔GitHub name asymmetry is acceptable). The prototype carries the refi domain knowledge but was never built with a persona-aware shell or a public component surface; it's being lifted into the protection-portal pattern (substrate → customer view → agent view → public exports) so it can serve as a cross-app embed source. Rationale: cross-app embed needs a persona-aware shell that refi-prototype was never built with; the previous folder name (`Refinance Application Version 2/`) didn't match the `*-portal` convention.
- **Embed-don't-fork rule for cross-app UI components** (2026-05-03). Every embeddable surface accepts `{ persona, personaLocked }` and respects parent context. Public surface = named exports from `src/views/{customer,agent}/index.js` and `src/lib/<workflow>.js` only; deep imports forbidden. Consumers wire via `file:` deps. Rationale: `SavingsCard` precedent (one source of truth per workflow); copy-pasted UI rots when the source moves. Contract: `architecture/02-integration-boundaries.md`.

## See also

- The legacy current-state docs: `BlinkerLegacy/docs/mission-control/current-state/` — 36+ documents covering every legacy screen, integration, status, and data flow we mapped during research.
- The legacy active-only DBML: `BlinkerLegacy/docs/mission-control/current-state/data-model/schema-in-use.dbml` — 65 tables that the rewrite should be designed against (down from 145 in legacy).
- Refi v2 wiki: `refi-portal/documentation/refinance-version-2-wiki.md` — canonical refi workflow spec.
- Payment platform architecture: `payment-processing-platform/PROJECT_ARCHITECTURE.md` — the orchestrator + GCF + customer-portal data flow.
