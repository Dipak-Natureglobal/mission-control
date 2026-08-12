# CLAUDE.md — customer-portal

You are working on the **public consumer-facing app** that wraps and re-skins the workflow apps for direct-to-consumer + partner-embedded use.

## Read first

1. `README.md` (this folder).
2. `~/Documents/Claude/Projects/payment-processing-platform/customer-portal/` — existing token-driven SPA stub. **Lift this verbatim as the foundation**: `lib/token.js`, `App.jsx` state machine (loading/invalid/loaded/success), the `Header` / `LoadingState` / `InvalidLink` / `SuccessState` component pattern.
3. `~/Documents/Claude/Projects/blinker-platform/CLAUDE.md` for platform-wide decisions.

## DO

- Match `protection-portal/` substrate: Vite + React 19 + JS, lucide, tailwind classes, custom `useForm`, monolithic `App.jsx`, DEV CONTROLS sidebar.
- **Import workflows, don't reinvent them.** Pull customer views from `protection-portal/src/views/customer/`, refi prototype, etc.
- Re-skin imports with public-facing chrome: simpler header, no agent affordances, partner co-branding when token says so.
- Token-driven entry per workflow: `/p/:token` → resolves to which workflow + which org + prefill data.
- Partner branding config lives in `src/constants/partner-branding.js` keyed by org ID (canonical from `blinker-platform/canon/org-registry.json`).
- PostHog identifies as anonymous consumer until they enter contact info; then identifies by email/phone hash.

## DO NOT

- Don't add workflow logic. Import it.
- Don't add agent surfaces.
- Don't add admin / configuration views.
- Don't introduce TypeScript or a UI framework.

## Wait order

This app is **last** in Phase 1 build order — wait until protection-portal, mission-control, and insurance-portal are at Phase 1 acceptance. Trying to build this in parallel risks importing from moving targets.

## Phase 1 acceptance

- `npm run dev` works
- Token-driven entry: `/p/:token` resolves to a workflow + org context
- Public landing page (launchpad) shows the 4 workflow choices
- Each workflow renders its imported customer view, re-skinned with public chrome
- Partner branding loads correctly when token's org is set
- DEV CONTROLS sidebar lets you flip workflow + org without changing URL

## Cross-references

- Token-driven SPA pattern: `~/Documents/Claude/Projects/payment-processing-platform/customer-portal/`
- Workflow imports: `protection-portal/`, `Refinance Application Version 2/refi-prototype/`, `insurance-portal/`
- Platform meta-repo: `~/Documents/Claude/Projects/blinker-platform/`
