# CLAUDE.md — refi-portal

You are working on the **canonical Refinance app**. This is the full-feature workflow that every other refi reference imports from (protection-portal cross-sell embed, customer-portal launchpad, mission-control agent co-pilot pane).

## Read first

1. `README.md` (this folder) for app scope and quickstart.
2. `documentation/refinance-version-2-wiki.md` — workflow patterns + screen sequence reference.
3. `documentation/engineering-plan.md` — phase plan.
4. `~/Documents/Claude/Projects/blinker-platform/STATUS.md` — current platform state and what's next.
5. `~/Documents/Claude/Projects/blinker-platform/architecture/02-integration-boundaries.md` — the embed contract every public component must follow.
6. `~/Documents/Claude/Projects/blinker-platform/architecture/08-cross-sell-orchestration.md` — how protection-portal will embed this app's customer view.

## DO

- Match the **protection-portal substrate exactly**: Vite + React 19 + JS (no TS), lucide-react, tailwind-style classes, custom `useForm`, DEV CONTROLS sidebar pattern.
- **Lift, don't reinvent.** Workflow screens for refi already exist in this repo's `src/views/customer/` (lifted from the prototype's monolith). When you need a screen pattern that doesn't exist, lift from the monolith preserved at `src/refinance-v2-prototype.jsx` (this file should remain in tree as the lift source until the lifted screens are fully verified).
- Read canon files from `src/constants/canon/` (sync'd from `blinker-platform/canon/`). Don't hand-edit canon files here.
- VIN OR manual YMMT both supported. When VIN-decode disagrees with manual selection, surface as a confirmation step.
- Mock integrations in Phase 1 with payloads from `src/fixtures/` (or the prototype's existing `src/constants/mock-data.js`).
- Fire PostHog events for every screen entry, key action, and status transition. PostHog is the audit trail.
- Persist session state in localStorage if needed; no real DB writes in Phase 1.
- Every public component (anything exported from `src/views/customer/index.js` or `src/views/agent/index.js`) MUST accept `{ persona, personaLocked }` per the embed contract.

## DO NOT

- Don't add protection-plan, insurance, or payment-management features here. Those live in their own apps.
- Don't add the agent inbox / multi-opportunity workspace. That's `mission-control/`.
- Don't add the public partner-embed launchpad. That's `customer-portal/launchpad/`.
- Don't introduce TypeScript. Match the platform substrate (JavaScript).
- Don't introduce a UI framework (shadcn, Material, etc.). Tailwind-style utility classes, raw components.
- Don't introduce a router library unless the URL structure demands it. Simple URL-driven view switching is fine.
- Don't write to canon files locally. Edit canon in `blinker-platform/`, then run sync.
- Don't render a persona switcher inside any view when `personaLocked={true}`. Parent owns the switcher.
- Don't export from `src/views/customer/index.js` (or `agent/`) anything you don't intend to be a stable public surface. Refusing to add an export is the way to keep an internal component internal.

## Three views in one app

- **Customer view (`src/views/customer/`)** — the consumer self-serve flow. Used directly when a consumer hits a campaign URL, AND when protection-portal embeds it as a sub-flow per `architecture/08-cross-sell-orchestration.md`.
- **Agent view (`src/views/agent/`)** — agent-assisted flow. Includes Save & Send, View API Responses, status overrides. Used by `mission-control/` in co-pilot mode.
- **Partner view (`src/views/partner/`)** — partner-embedded version. Tighter chrome, partner co-branding. Used by `customer-portal/workflows/refi/`.

A `src/shell/ViewSwitcher.jsx` reads `?view=customer|agent|partner` and renders the right view. DEV CONTROLS lets you flip without changing URL.

## Phase 1.5b acceptance (this session)

- `npm run dev` works at port 5179
- DEV CONTROLS sidebar shows on all three views
- Customer view walks end-to-end through the lifted refi screens
- DEV CONTROLS persona dropdown wires through to CustomerView's `{ persona, personaLocked }` props
- JsonPeek of the form slice surfaces in DEV CONTROLS

## Phase 1.5c (next session)

- AgentView composition + public exports (`src/views/customer/index.js`, `src/views/agent/index.js`)
- `src/lib/refi.js` exports for the math/hooks side of the embed contract (per `architecture/02-integration-boundaries.md`)

## Cross-references

- Cross-sell ADR: `~/Documents/Claude/Projects/blinker-platform/architecture/08-cross-sell-orchestration.md`
- Embed contract: `~/Documents/Claude/Projects/blinker-platform/architecture/02-integration-boundaries.md`
- Status / event taxonomy: `~/Documents/Claude/Projects/blinker-platform/architecture/01-event-taxonomy.md`
- Canon source: `~/Documents/Claude/Projects/blinker-platform/canon/`
- Sibling apps: `~/Documents/Claude/Projects/{protection-portal,insurance-portal,mission-control,customer-portal}/`
