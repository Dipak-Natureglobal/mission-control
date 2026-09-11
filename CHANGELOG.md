# Changelog

Everything that has changed in this project, newest first — what changed, when it
changed, and what it actually means.

**How to read this page**

1. Entries are newest first. Each one opens with a plain-English summary. You do
   not need to be a developer to read it.
2. **What this means** is the part that matters to most people: what is different
   now, app by app.
3. Only if you want commit-level detail, open **Technical detail** at the bottom
   of an entry. Everything above it is written to be understood on its own.

There is a companion page for what is still *coming*: [ROADMAP.md](ROADMAP.md).
The same information is browsable, with filters, in the Changelog Portal app
(`pnpm --filter changelog-portal dev`).

<details>
<summary>Glossary — the six words that show up below</summary>

- **Portal / app** — one of the websites in this project (Mission Control, Home
  Protection Portal, and so on). Each one runs on its own.
- **Upstream** — the original repository a portal's code is written in, owned by
  the Blinker teams. This project copies from it and never writes back.
- **Sync** — the act of copying the newest upstream code into this project.
- **Commit** — one saved change, with a short message describing it.
- **SHA** — the short code identifying a commit, like `1a2b3c4d`. Think of it as
  a version number that is never reused.
- **Canon** — the shared settings files (plans, statuses, field names) every
  portal reads, so they all agree on the same values.

</details>

> **This file is generated.** The source of truth is
> `apps/changelog-portal/src/data/changelog.json`. Edit that, then run
> `pnpm changelog --render` to rebuild this page. Hand-edits here are overwritten.

<!-- changelog:insert -->

## 10 September 2026 — Where we start: the Blinker apps brought together in one place, with this record added

**What this means**

- **Nothing changed inside the apps themselves today.** This is the first record — a picture of where things already stood, so that everything after it has something to be compared against.
- **All the apps now live in one place.** Each one used to be set up and run on its own. They are now kept side by side, each still separate, each taken from the Blinker teams exactly as they wrote it. Nothing was merged or rewritten.
- **They can all run at the same time.** Each app has its own fixed address, so two of them no longer fight over the same one.
- **They all get published the same way now**, so an app cannot quietly work on one computer and fail on another.
- **This record was added.** From now on, every time new work comes in from the Blinker teams, it gets written down here in plain words.

**Does this need anything from us?** No. There is nothing to install or set up.

**Still open after this:** Three things. The Customer Portal has no website yet — the Blinker team has not built it. The card-payment step only works on a developer's own computer, so it will not work on the live site. And the pricing service may turn away requests coming from the live site. All three are being tracked.

<details>
<summary>Technical detail — commits, versions, file counts</summary>

**Unchanged this round**

- Customer Portal — still at `45cdbb08`
- Home Protection Portal — still at `f9434af6`
- Insurance Portal — still at `a4abfd86`
- Mission Control — still at `003af186`
- Protection Portal — still at `0d08c1be`
- Refinance Portal — still at `de7736c2`
- Blinker Platform (shared library) — still at `932356ce`

**Changes made in this monorepo itself**

*Internal cleanup (nothing visible changed)*

- 2026-09-10 13:00 · `0ccb37c` · Remove AuthGate wrapper from main rendering
- 2026-08-12 07:57 · `18e8d03` · Reorganize DEFAULT_ORG_CONFIG to avoid import cycle and improve clarity

*Documentation*

- 2026-08-28 03:21 · `0d2d112` · Remove known state section regarding linting issues from README
- 2026-08-28 03:12 · `cb3aba8` · Sync README with real repo state; make sync:check read-only

*Upstream syncs*

- 2026-08-28 03:12 · `d860c92` · Update vendored portals to upstream main; vendor home-protection-portal

*Housekeeping*

- 2026-08-12 08:38 · `0e3ea87` · Add installCommand and build environment to vercel.json for consistency
- 2026-08-12 08:07 · `f838666` · Update installCommand in vercel.json for consistent package installation
- 2026-08-12 07:59 · `e2c293f` · Add installCommand to vercel.json for consistent package installation
- 2026-08-12 07:26 · `91e81dc` · Pin apps to the 30001-30005 platform port map
- 2026-08-12 07:15 · `23345c8` · Guard ANSI colors behind TTY and record upstream SHAs
- 2026-08-12 07:11 · `c406497` · Vendor five Blinker portals into a pnpm/Turborepo monorepo

</details>
