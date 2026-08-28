# blinker-prototype

A pnpm + Turborepo monorepo that vendors the Blinker portal prototypes (plus the shared platform
library they all depend on) from their upstream **BlinkerGit** repositories.

The apps stay independent. Nothing is merged, rewritten, or combined.

```
blinker-prototype/
├── apps/
│   ├── customer-portal/        ← BlinkerGit/customer-portal          (spec only — see note below)
│   ├── home-protection-portal/ ← BlinkerGit/home-protection-portal   package: home-protection-portal :30006
│   ├── insurance-portal/       ← BlinkerGit/insurance-portal         package: insurance-portal       :30002
│   ├── mission-control/        ← BlinkerGit/mission-control          package: mission-control        :30003
│   ├── protection-portal/      ← BlinkerGit/protection-portal        package: protection-portal      :30001
│   └── refinance-prototype/    ← BlinkerGit/refinance-prototype      package: refi-portal            :30005
├── packages/
│   └── blinker-platform/       ← BlinkerGit/blinker-platform         the reference — see below
│       ├── canon/              12 shared JSON files + a `_version` stamp
│       ├── architecture/       numbered ADRs (00–30) + integration-partners/stoneeagle/
│       ├── docs/               prototype plan, phase-2 readiness, rca_analysis/
│       ├── packages/           components · api · integrations · utils · personas · telemetry
│       ├── scripts/            sync-canon-into-apps.sh · validate-fixtures.js · regenerate-ymmt-data.cjs
│       ├── STATUS.md           live Phase 1 tracker
│       └── CLAUDE.md           agent orientation + repo layout
├── scripts/
│   ├── sync-portals.mjs        pnpm sync
│   └── apply-monorepo-patches.mjs
├── sync.config.json            upstream remote → folder mapping
├── sync-state.json             last-synced commit per upstream
├── vercel.json                 repo-root install command + corepack flag
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

Folder names follow the upstream repository names. Package names come from each app's own
`package.json` and may differ — `apps/refinance-prototype/` publishes the name **`refi-portal`**,
which is what sibling apps import.

## Requirements

- Node **>= 22.12** (Vite 8 requirement; `.nvmrc` pins 22)
- pnpm 10.34.4 (`corepack enable`)

## Getting started

```bash
pnpm install
pnpm dev                       # all apps via turbo
pnpm --filter mission-control dev
pnpm --filter refi-portal dev  # note: package name, not folder name
pnpm build                     # all apps
```

## Workspace layout

`pnpm-workspace.yaml` declares three globs, not two:

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "packages/blinker-platform/packages/*"
```

The third one matters. `blinker-platform` is itself a small meta-repo whose shared application layer
lives in a nested `packages/` directory. Those nested packages have to be workspace members for
`workspace:*` resolution and for `scripts/apply-monorepo-patches.mjs`, which scans all three globs.

Two other settings are load-bearing:

- `onlyBuiltDependencies: ["@swc/core"]` in `pnpm-workspace.yaml` — `@swc/core` ships a native binary
  and needs its postinstall to run.
- `shamefully-hoist=true` in `.npmrc` — apps import each other by bare package name (e.g.
  `refi-portal/src/views/customer`) and rely on transitive peers being reachable. Hoisting reproduces
  what the upstream `file:../x` npm layout gave them for free.

`pnpm install` warns that `esbuild`'s build script was ignored. That is expected and harmless —
builds pass without it.

## Git remotes

| Remote       | URL                                                    | Direction      |
| ------------ | ------------------------------------------------------ | -------------- |
| `origin`     | https://github.com/Dipak-Natureglobal/mission-control   | push + pull    |
| `customer`   | https://github.com/BlinkerGit/customer-portal          | **fetch only** |
| `home`       | https://github.com/BlinkerGit/home-protection-portal   | **fetch only** |
| `insurance`  | https://github.com/BlinkerGit/insurance-portal         | **fetch only** |
| `mission`    | https://github.com/BlinkerGit/mission-control          | **fetch only** |
| `protection` | https://github.com/BlinkerGit/protection-portal        | **fetch only** |
| `refinance`  | https://github.com/BlinkerGit/refinance-prototype      | **fetch only** |
| `platform`   | https://github.com/BlinkerGit/blinker-platform         | **fetch only** |

`origin` is this monorepo and is the only remote that accepts pushes. Its repository name collides
with the `mission` upstream, but they are different repositories.

Every upstream remote has `pushurl = DISABLED-read-only-upstream` in `.git/config`, which is not a
valid URL, so `git push customer …` fails immediately instead of reaching BlinkerGit.

## Syncing from upstream

```bash
pnpm sync:check      # fetch + report what changed. Read-only — touches no files.
pnpm sync            # fetch + report + update the app folders
pnpm sync -- --force # also overwrite folders that have local uncommitted edits
pnpm sync -- mission refinance   # limit to specific upstreams (remote names)
```

What `pnpm sync` does:

1. `git fetch` each upstream remote. Read-only — **never pushes**.
2. Compares each upstream `main` against the SHA recorded in `sync-state.json` and prints the
   new commits.
3. For each changed upstream: creates a throwaway git worktree at the new commit and mirrors it
   onto the app folder — new files added, changed files overwritten, files deleted upstream
   removed. `vercel.json`, `node_modules/`, `dist/`, `.turbo/`, and `.env*` are never touched.
4. Re-applies the monorepo dependency rewrites (below). Skipped under `--check`.
5. Records the new SHA in `sync-state.json`.

If an app folder has uncommitted changes, that app is **skipped** with a warning rather than
overwritten. Commit or stash your work first, or pass `--force` to take upstream anyway.

Then review and publish yourself:

```bash
git status
git diff
pnpm install                # only needed if a package.json changed
git add .
git commit -m "sync: update portals"
git push origin main
```

### When upstream adds a new sibling repo

`apply-monorepo-patches.mjs` warns when an app declares a `file:` dependency that no workspace
package publishes:

```
! mission-control: "home-protection-portal": "file:../home-protection-portal" — no workspace package publishes that name; left as-is
```

That means a new BlinkerGit repo appeared and has to be vendored before `pnpm install` can resolve.
The steps, using `home-protection-portal` as the worked example:

```bash
git remote add home https://github.com/BlinkerGit/home-protection-portal.git
git config remote.home.pushurl DISABLED-read-only-upstream
# add a { remote, branch, dir, repo } entry to sync.config.json
# add the folder → port entry to PORTS in scripts/apply-monorepo-patches.mjs
pnpm sync -- home
pnpm install
```

Then give it a `vercel.json` (copied from the closest sibling) and a Vercel project.

### The only edits made to vendored source

`scripts/apply-monorepo-patches.mjs` rewrites sibling dependencies from the polyrepo form to the
workspace form:

```diff
- "refi-portal": "file:../refi-portal"
+ "refi-portal": "workspace:*"
```

`workspace:*` resolves by package name, so the differing folder name is fine.

The same script also pins each app to the Blinker platform port map, in both its `dev`/`preview`
scripts and its `vite.config`:

| App                           | Port    | Upstream port              |
| ----------------------------- | ------- | -------------------------- |
| `apps/protection-portal`      | `30001` | 5175                       |
| `apps/insurance-portal`       | `30002` | 5176                       |
| `apps/mission-control`        | `30003` | 5177                       |
| `apps/customer-portal`        | `30004` | *(reserved — no app yet)*  |
| `apps/refinance-prototype`    | `30005` | 5179                       |
| `apps/home-protection-portal` | `30006` | 5178 dev, 5177 preview     |

Upstream each repo picks its own `517x` port independently, and they collide once all of them run
side by side — `home-protection-portal` previews on 5177, which is `mission-control`'s dev port.
Only the port numbers change — `strictPort`, dev proxies, and the `http://localhost:8080` payment
target are untouched. Some upstream comments still describe the old `517x` map; those are left as
written rather than rewriting upstream prose.

Build scripts, source files, and dependency versions are left exactly as upstream. The script is
idempotent and runs automatically at the end of every sync, so both rewrites survive `pnpm sync`.

## The reference: `packages/blinker-platform`

`packages/blinker-platform` is the source of truth for everything cross-cutting. Read it before
changing anything that spans more than one app:

- [`STATUS.md`](packages/blinker-platform/STATUS.md) — the live Phase 1 tracker: what's done, in
  flight, blocked, and next, wave by wave.
- [`CLAUDE.md`](packages/blinker-platform/CLAUDE.md) — repo layout, the ADR index, and the
  coordinator-role rules.
- [`architecture/`](packages/blinker-platform/architecture/) — numbered ADRs `00`–`30`, plus
  `integration-partners/stoneeagle/` (the SCS eRating and eContracting integration guides).
- [`canon/`](packages/blinker-platform/canon/) — the 12 shared JSON contracts (org registry, GHL
  field/status maps, personas, plan mappings, …) and a `_version` stamp.

Each app carries its **own copy** of canon under `src/constants/canon/`, refreshed upstream by
`packages/blinker-platform/scripts/sync-canon-into-apps.sh`. `pnpm sync` does not run that script —
it only mirrors whatever each upstream repo already committed. If an app's canon `_version` lags the
platform's, that drift came from upstream and has to be fixed upstream.

**Read the platform's own `README.md`/`CLAUDE.md` with one correction in mind.** They describe the
original **polyrepo** setup: sibling repos at `~/Documents/Claude/Projects/…`, dependencies wired as
`file:../x`, and dev servers on `5173`–`5179`. That is accurate for upstream and is deliberately left
as written. Inside this monorepo those three things are superseded by `apps/*` + `packages/*`,
`workspace:*`, and the 30001–30006 port map above. Everything else in those documents — the locked
decisions, the canon rules, the dependency-direction rule (`packages/*` may read `canon/*` and import
sibling packages, never a child app) — applies unchanged.

## Vercel

Create **one Vercel project per app**, all pointing at this repository, each with a different
**Root Directory**:

| Vercel project         | Root Directory                |
| ---------------------- | ----------------------------- |
| home-protection-portal | `apps/home-protection-portal` |
| insurance-portal       | `apps/insurance-portal`       |
| mission-control        | `apps/mission-control`        |
| protection-portal      | `apps/protection-portal`      |
| refinance-prototype    | `apps/refinance-prototype`    |

Install and build are **not** left to Vercel's defaults. Both the repo-root `vercel.json` and every
app's `vercel.json` set:

```json
{
  "installCommand": "npx --yes pnpm@10.34.4 install --frozen-lockfile",
  "build": { "env": { "ENABLE_EXPERIMENTAL_COREPACK": "1" } }
}
```

`npx --yes pnpm@10.34.4` pins the exact pnpm that produced `pnpm-lock.yaml`, and `--frozen-lockfile`
makes a stale lockfile a build failure instead of a silent resolution drift — so **commit
`pnpm-lock.yaml` whenever a sync changes any `package.json`**. Each app's `vercel.json` also sets the
framework (`vite`), the output directory (`dist`), and an SPA catch-all rewrite so deep links don't
404.

Keep **"Include source files outside of the Root Directory"** enabled (it is on by default) — the
install runs from the repo root and needs the whole workspace.

Set the Node version to 22.x in each project's settings.

### Environment variables

Set per Vercel project. Vite only exposes variables prefixed `VITE_`.

- `apps/mission-control/.env.example` → `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`
- `apps/refinance-prototype/.env.example` → see that file

Real `.env` files are gitignored; only `.env.example` is tracked.

### Known deployment caveats

- **`/se-rating`** — upstream `mission-control`, `protection-portal`, and `home-protection-portal`
  proxy this to `staging.fiadmin.com/scs.webservice` through the Vite **dev server**, which does not
  exist in a production build. Their `vercel.json` reproduces it as a Vercel rewrite. Note the dev
  proxy also strips the `Origin` and `Referer` headers before forwarding; a Vercel rewrite does not,
  so if StoneEagle rejects the request, that is why.
- **`/efs-charge`** — the dev proxy points at `http://localhost:8080`, a local service. It cannot
  be rewritten in production and is deliberately left out of `vercel.json`. Point it at a real
  host before relying on that feature in a deployment.

## Note on `apps/customer-portal`

Upstream `BlinkerGit/customer-portal` currently contains **no application code** — only the 12 canon
JSON files and their `_version` stamp under `src/constants/canon/`, plus `README.md`, `CLAUDE.md`,
and `.gitignore`. Its own CLAUDE.md places it last in the Phase 1 build order ("wait until
protection-portal, mission-control, and insurance-portal are at Phase 1 acceptance").

It is vendored here verbatim so that `pnpm sync` picks the app up automatically the moment
BlinkerGit builds it. Until then it has no `package.json`, so pnpm and turbo skip it, and it has
no Vercel project. Port `30004` is reserved for it.

## Upstream language note

`home-protection-portal`, `insurance-portal`, `mission-control`, and `protection-portal` are
JavaScript (JSX) upstream. `refinance-prototype` is TypeScript. This repo vendors each exactly as
published — no migration is applied here.
