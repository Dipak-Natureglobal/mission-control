# blinker-prototype

A pnpm + Turborepo monorepo that vendors the five Blinker portal prototypes (plus the shared
platform library they all depend on) from their upstream **BlinkerGit** repositories.

The apps stay independent. Nothing is merged, rewritten, or combined.

```
blinker-prototype/
├── apps/
│   ├── customer-portal/        ← BlinkerGit/customer-portal      (spec only — see note below)
│   ├── insurance-portal/       ← BlinkerGit/insurance-portal     package: insurance-portal   :5176
│   ├── mission-control/        ← BlinkerGit/mission-control      package: mission-control    :5173
│   ├── protection-portal/      ← BlinkerGit/protection-portal    package: protection-portal  :5175
│   └── refinance-prototype/    ← BlinkerGit/refinance-prototype  package: refi-portal        :5179
├── packages/
│   └── blinker-platform/       ← BlinkerGit/blinker-platform     shared canon + api + components
├── scripts/
│   ├── sync-portals.mjs        pnpm sync
│   └── apply-monorepo-patches.mjs
├── sync.config.json            upstream remote → folder mapping
├── sync-state.json             last-synced commit per upstream
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

## Git remotes

| Remote       | URL                                                | Direction |
| ------------ | -------------------------------------------------- | --------- |
| `origin`     | https://github.com/Dipak-Natureglobal/mission-control | push + pull |
| `customer`   | https://github.com/BlinkerGit/customer-portal      | **fetch only** |
| `insurance`  | https://github.com/BlinkerGit/insurance-portal     | **fetch only** |
| `mission`    | https://github.com/BlinkerGit/mission-control      | **fetch only** |
| `protection` | https://github.com/BlinkerGit/protection-portal    | **fetch only** |
| `refinance`  | https://github.com/BlinkerGit/refinance-prototype  | **fetch only** |
| `platform`   | https://github.com/BlinkerGit/blinker-platform     | **fetch only** |

Every upstream remote has its `pushurl` set to a non-existent host in `.git/config`, so
`git push customer …` fails immediately instead of reaching BlinkerGit. `origin` is the only
remote that accepts pushes.

## Syncing from upstream

```bash
pnpm sync:check      # fetch + report what changed. Touches no files.
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
4. Re-applies the monorepo dependency rewrites (below).
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

### The only edits made to vendored source

`scripts/apply-monorepo-patches.mjs` rewrites sibling dependencies from the polyrepo form to the
workspace form:

```diff
- "refi-portal": "file:../refi-portal"
+ "refi-portal": "workspace:*"
```

`workspace:*` resolves by package name, so the differing folder name is fine. Ports, scripts,
source files, and dependency versions are left exactly as upstream. The script is idempotent and
runs automatically at the end of every sync.

## Vercel

Create **one Vercel project per app**, all pointing at this repository, each with a different
**Root Directory**:

| Vercel project      | Root Directory              |
| ------------------- | --------------------------- |
| insurance-portal    | `apps/insurance-portal`     |
| mission-control     | `apps/mission-control`      |
| protection-portal   | `apps/protection-portal`    |
| refinance-prototype | `apps/refinance-prototype`  |

Each of those folders has a `vercel.json` setting the framework (`vite`), output directory
(`dist`), and an SPA catch-all rewrite so deep links don't 404. Install and build commands are
left to Vercel's defaults, which detect the pnpm workspace and install from the repo root — keep
**"Include source files outside of the Root Directory"** enabled (it is on by default).

Set the Node version to 22.x in each project's settings.

### Environment variables

Set per Vercel project. Vite only exposes variables prefixed `VITE_`.

- `apps/mission-control/.env.example` → `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`
- `apps/refinance-prototype/.env.example` → see that file

Real `.env` files are gitignored; only `.env.example` is tracked.

### Known deployment caveats

- **`/se-rating`** — upstream `mission-control` and `protection-portal` proxy this to
  `staging.fiadmin.com/scs.webservice` through the Vite **dev server**, which does not exist in a
  production build. Their `vercel.json` reproduces it as a Vercel rewrite. Note the dev proxy also
  strips the `Origin` and `Referer` headers before forwarding; a Vercel rewrite does not, so if
  StoneEagle rejects the request, that is why.
- **`/efs-charge`** — the dev proxy points at `http://localhost:8080`, a local service. It cannot
  be rewritten in production and is deliberately left out of `vercel.json`. Point it at a real
  host before relying on that feature in a deployment.

## Note on `apps/customer-portal`

Upstream `BlinkerGit/customer-portal` currently contains **no application code** — only 13 canon
JSON files under `src/constants/canon/`, plus `README.md` and `CLAUDE.md`. Its own CLAUDE.md places
it last in the Phase 1 build order ("wait until protection-portal, mission-control, and
insurance-portal are at Phase 1 acceptance").

It is vendored here verbatim so that `pnpm sync` picks the app up automatically the moment
BlinkerGit builds it. Until then it has no `package.json`, so pnpm and turbo skip it, and it has
no Vercel project.

## Upstream language note

`insurance-portal`, `mission-control`, and `protection-portal` are JavaScript (JSX) upstream.
`refinance-prototype` is TypeScript. This repo vendors each exactly as published — no migration is
applied here.
