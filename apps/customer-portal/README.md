# customer-portal

Public, partner-embeddable, **standalone consumer-facing experience** for all Blinker workflows. Acts as the launchpad and re-skinned customer-tuned wrapper for protection / refi / insurance / payments.

This app does NOT own workflow logic. It **imports** components from each `*-portal/` (the canonical full apps) and re-skins them for direct-to-consumer presentation: simpler chrome, no agent affordances, partner co-branding when embedded, deep-linked entry per workflow.

## Status

Phase 1D — last in build order. Comes after `protection-portal/`, `mission-control/`, `insurance-portal/` so it has real workflows to compose.

## What this app owns

- Public landing page / launchpad (consumer arrives via partner site, campaign URL, direct link)
- Partner-embed iframe entry (with token-driven context: which workflow, partner branding, prefill)
- Per-workflow customer-tuned wrappers under `src/workflows/`
- Cross-workflow shared chrome: header, footer, partner branding selector, support contact
- The `/p/:token` token-driven SPA pattern (lifted from `payment-processing-platform/customer-portal/`)
- Public-facing analytics hooks (PostHog identify with consumer-only context)

## What this app does NOT own

- Workflow logic — lives in each `*-portal/`
- Agent surfaces — `mission-control/` + `*-portal/views/agent/`
- Internal admin / configuration — `mission-control/` admin/super shells
- Payment plan servicing logic — `payment-processing-platform/`

## Tech stack

Same as other portals. See `~/Documents/Claude/Projects/blinker-platform/CLAUDE.md`.

## Repo layout

```
customer-portal/
├── README.md
├── CLAUDE.md
├── package.json
├── vite.config.js
├── index.html
├── .env.example
├── public/
├── src/
│   ├── App.jsx                  # top-level: workflow routing
│   ├── main.jsx
│   ├── shell/                   # PublicChrome, PartnerBrandingProvider, TokenContext
│   ├── workflows/
│   │   ├── protection/          # imports protection-portal customer view, re-skins
│   │   ├── refi/                # imports refi prototype customer view, re-skins
│   │   ├── insurance/           # imports insurance-portal customer view, re-skins
│   │   └── payments/            # imports payment-processing-platform customer-portal stub, re-skins
│   ├── launchpad/               # public landing page that picks a workflow
│   ├── shared/                  # WizardShell, FormFields, useForm, JsonPeek — lifted
│   ├── lib/
│   │   ├── token.js             # parse /p/:token from URL (lifted from payment-processing-platform/customer-portal)
│   │   ├── api.js               # call our own backend for portal context
│   │   └── posthog.js           # public/consumer-context PostHog
│   ├── constants/
│   │   ├── canon/               # synced from blinker-platform/canon/
│   │   └── partner-branding.js  # per-org branding config
│   ├── hooks/
│   └── assets/
├── scripts/
└── docs/
    ├── partner-embed-api.md
    └── re-skin-pattern.md
```

## Quickstart

```bash
cd ~/Documents/Claude/Projects/customer-portal
npm install
cp .env.example .env.local        # POSTHOG_KEY, VITE_API_BASE
npm run dev                       # localhost:5178 (suggested)
```

## Key references

- `payment-processing-platform/customer-portal/` — existing token-driven SPA stub. Pattern to lift: `lib/token.js`, `App.jsx` state machine (loading / invalid / loaded / success), components (`AddProfileForm`, `AgreementSummary`, `Header`).
- `protection-portal/src/views/customer/` — what to import + re-skin for the protection wrapper
- Refi prototype at `~/Documents/Claude/Projects/Refinance Application Version 2/refi-prototype/` — what to import + re-skin for the refi wrapper
- Platform meta-repo: `~/Documents/Claude/Projects/blinker-platform/`
