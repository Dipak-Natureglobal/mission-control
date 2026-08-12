# CLAUDE.md — protection-portal

You are working on the **canonical Vehicle Service Contract / Protection Plan app**. This is the full-feature workflow that every other "protection" reference imports from.

## Read first

1. `README.md` (this folder) for app scope and quickstart.
2. `docs/mockups/` — consumer self-serve PDF mockup is the spec for the customer view.
3. `~/Documents/Claude/Projects/blinker-platform/CLAUDE.md` — platform-wide decisions (only when doing cross-cutting changes).

## DO

- Match the **refi prototype substrate exactly**: Vite + React 19 + JS (no TS), lucide-react, tailwind-style classes, custom `useForm`, monolithic `App.jsx`, DEV CONTROLS sidebar pattern.
- **Lift, don't reinvent.** When you need a screen pattern: VehicleAdd, VehicleDrive, WizardShell, FormFields, useForm — copy from `~/Documents/Claude/Projects/Refinance Application Version 2/refi-prototype/src/` and adapt.
- **Lift FluidPay** from `~/Documents/Claude/Projects/payment-processing-platform/efs-prototype/src/lib/fluidpay/` — it's production-shaped (tokenizer, hosted fields, response codes, test cards).
- Read canon files from `src/constants/canon/` (sync'd from `blinker-platform/canon/`). Don't hand-edit canon files here.
- **VIN OR manual YMMT** both supported. When VIN-decode disagrees with manual selection, surface as a confirmation step — never silent. (This was a real production bug in legacy.)
- Mock integrations in Phase 1 with payloads from `src/fixtures/` (captured from the legacy walkthrough).
- Fire PostHog events for every screen entry, key action, and status transition. PostHog is the audit trail.
- Persist session state in localStorage (or fixture-driven mock backend). No real DB writes in Phase 1.

## DO NOT

- Don't add insurance, refi, or payment-management features here. Those live in their own apps.
- Don't add the agent inbox / multi-opportunity workspace. That's `mission-control/`.
- Don't add the public partner-embed launchpad. That's `customer-portal/launchpad/`.
- Don't introduce TypeScript. Match the refi/EFS substrate (JavaScript).
- Don't introduce a UI framework (shadcn, Material, etc.). Tailwind-style utility classes, raw components.
- Don't introduce a router library unless the URL structure demands it. Simple URL-driven view switching is fine.
- Don't write to canon files locally. Edit canon in `blinker-platform/`, then run sync.
- Don't deepen coupling to legacy Rails models. Talk to the StoneEagle/FluidPay/DocuSeal adapter interfaces only.

## Three views in one app

- **Customer view (`src/views/customer/`)** — the consumer self-serve flow per the PDF mockup. No agent affordances, no admin panels. Used directly when consumer hits a campaign URL.
- **Agent view (`src/views/agent/`)** — the agent-assisted flow. Includes "Save and Send" handoff, View API Responses, status overrides. Used by `mission-control/` in co-pilot mode (mission-control imports the agent view as a sub-component).
- **Partner view (`src/views/partner/`)** — partner-embedded version. Tighter chrome, partner co-branding, may pre-fill from partner-supplied lead data. Used by `customer-portal/workflows/protection/` to compose the public-facing surface.

A `src/shell/ViewSwitcher.jsx` reads `?view=customer|agent|partner` and renders the right view. DEV CONTROLS lets you flip without changing URL.

## Phase 1 acceptance

- `npm run dev` works
- DEV CONTROLS sidebar shows on all three views
- Customer view walks end-to-end with mocked StoneEagle GetRates response (from fixture)
- Three plan cards render (Good/Better/Best) per PlanSelectorService algorithm
- FluidPay hosted fields render in Billing & Payment screen (sandbox)
- DocuSeal Sign Now button shows a placeholder iframe ("Phase 2 will load real DocuSeal here")
- PostHog identifies sessions per persona and fires events on screen transitions
- Status transitions surface in the DEV CONTROLS panel (JsonPeek of current package state)

## Cross-references

- Legacy capture of the existing protection-plan flow: `~/Documents/Claude/Projects/BlinkerLegacy/docs/mission-control/current-state/screens/01-hub.md` through `screens/14-consumer-thank-you.md`.
- Legacy production findings (must not regress): `~/Documents/Claude/Projects/BlinkerLegacy/docs/mission-control/current-state/AUDIT-2026-05-02.md`.
- Slim DBML for backend reference: `~/Documents/Claude/Projects/BlinkerLegacy/docs/mission-control/current-state/data-model/schema-in-use.dbml`.
- Refi v2 wiki for canonical workflow patterns: `~/Documents/Claude/Projects/Refinance Application Version 2/documentation/refinance-version-2-wiki.md`.
