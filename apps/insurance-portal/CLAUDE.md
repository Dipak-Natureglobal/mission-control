# CLAUDE.md — insurance-portal

You are working on the **canonical Insurance app**. Embedded Insurance (the partner) does the actual quote generation; this app owns the consumer-facing surface, agent tooling, link generation, status webhook handling, and the savings-card display that gets embedded into protection-portal's confirm screen.

## Read first

1. `README.md` (this folder) for app scope.
2. `~/Documents/Claude/Projects/blinker-platform/CLAUDE.md` for platform-wide decisions.
3. `~/Documents/Claude/Projects/BlinkerLegacy/docs/mission-control/current-state/screens/20-package-action-buttons-financing-and-insurance.md` for the legacy insurance flow.

## DO

- Match `protection-portal/` conventions exactly. Same Vite/React/lucide stack. DEV CONTROLS sidebar pattern.
- **Lift, don't reinvent.** WizardShell, FormFields, useForm — copy from refi prototype.
- Mock Embedded Insurance webhooks in Phase 1 with payloads from `src/fixtures/`.
- Status names must match `blinker-platform/canon/ghl-status.json` (insurance subset).
- The savings-card component is a public exported component — protection-portal will import it. Keep its API stable and minimal.

## DO NOT

- Don't add protection or refi flows here.
- Don't add agent inbox features. Those are in `mission-control/`.
- Don't deepen coupling to legacy Rails models. Talk to the Embedded Insurance adapter only.
- Don't introduce TypeScript or a UI framework.

## Three views in one app

- **Customer view** — capture form (upload insurance card photo / enter details), quote review, switch CTA.
- **Agent view** — generate capture link, generate quote link, monitor status, view returned premium/savings.
- **Partner view** — partner-embedded capture form (tighter chrome, partner co-branding).

## Phase 1 acceptance

- `npm run dev` works
- DEV CONTROLS sidebar shows on all three views
- Capture link generation in agent view produces a fake URL → opens customer view
- Customer view capture form submits → mock webhook fires → status: `capture.completed`
- Quote returns mock premium + savings → quote review screen renders
- Savings card component exports cleanly so protection-portal can import it
- PostHog wired with insurance-specific event names per canon

## Cross-references

- Legacy insurance flow capture: `~/Documents/Claude/Projects/BlinkerLegacy/docs/mission-control/current-state/screens/20-...`
- GHL insurance fields/statuses: `blinker-platform/canon/ghl-fields.json` and `ghl-status.json` (insurance group)
- Refi prototype substrate: `~/Documents/Claude/Projects/Refinance Application Version 2/refi-prototype/src/`
- Platform meta-repo: `~/Documents/Claude/Projects/blinker-platform/`
