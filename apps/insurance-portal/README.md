# insurance-portal

Full app for the **Insurance** opportunity. Customer + Agent + Partner views all live here. Owns the insurance workflow logic, Embedded Insurance partner integration shape, capture/quote link generation, status webhook ingestion, savings-card display.

This is the **canonical** insurance app. Other apps (e.g. `customer-portal/workflows/insurance/`, `mission-control/` agent co-pilot) **import** components and logic from here and re-skin/re-frame for their context.

## Status

Phase 1C — not yet scaffolded. Will follow `protection-portal/` and `mission-control/` in build order.

## What this app owns

- Capture link generation (Embedded Insurance lead create → unique capture URL via Twilio/Mandrill send)
- Capture form (consumer uploads insurance card → Embedded Insurance OCR/normalize)
- Capture-completed webhook ingestion → status: `capture.completed`
- Quote generation (Embedded Insurance returns premium + savings)
- Quote link delivery (Twilio/Mandrill)
- Quote review screen (consumer sees premium, savings vs current carrier, switch CTA)
- Quote-viewed webhook → status: `quote.viewed`
- Policy bound webhook → status: `policy.bound`
- Savings card (the cross-sell element rendered inside protection-portal's confirm screen showing potential insurance savings)

## What this app does NOT own

- Protection-plan workflow → `protection-portal/`
- Refinance workflow → `Refinance Application Version 2/`
- Payment plan servicing → `payment-processing-platform/`
- Agent inbox / multi-opportunity workspace → `mission-control/`
- Public partner-embed entry → `customer-portal/`

## Tech stack

Same as `protection-portal/`. See platform decisions in `~/Documents/Claude/Projects/blinker-platform/CLAUDE.md`.

## Repo layout

```
insurance-portal/
├── README.md
├── CLAUDE.md
├── package.json
├── vite.config.js
├── index.html
├── .env.example
├── public/
├── src/
│   ├── App.jsx                  # top-level: persona/view switcher
│   ├── main.jsx
│   ├── shell/                   # DevControls, TopBar, ViewSwitcher
│   ├── views/
│   │   ├── customer/            # capture form, quote review, savings card
│   │   ├── agent/               # capture link generation, quote link generation, status monitoring
│   │   └── partner/             # partner-embedded variants
│   ├── shared/                  # WizardShell, FormFields, useForm, JsonPeek, DevPanel — lifted
│   ├── lib/
│   │   ├── embedded-insurance.js   # mock partner API in Phase 1
│   │   ├── twilio.js               # mock SMS link send
│   │   ├── mandrill.js             # mock email link send
│   │   └── posthog.js              # real PostHog client
│   ├── constants/
│   │   ├── canon/               # synced from blinker-platform/canon/
│   │   └── status-map.js        # the ins-specific status map (subset of canon)
│   ├── hooks/
│   ├── fixtures/                # captured Embedded Insurance webhook payloads
│   └── assets/
├── scripts/
└── docs/
    ├── embedded-insurance-contract.md
    ├── savings-card-spec.md
    └── webhook-ingestion.md
```

## Quickstart

```bash
cd ~/Documents/Claude/Projects/insurance-portal
npm install
cp .env.example .env.local        # POSTHOG_KEY, EMBEDDED_INSURANCE_API_KEY (sandbox)
npm run dev                       # localhost:5176 (suggested)
```

## Key references

- Legacy capture: `~/Documents/Claude/Projects/BlinkerLegacy/docs/mission-control/current-state/screens/20-package-action-buttons-financing-and-insurance.md` (insurance section)
- GHL insurance opportunity field map: `~/Documents/Claude/Projects/blinker-platform/canon/ghl-fields.json` (insurance group)
- Status taxonomy (insurance subset): `~/Documents/Claude/Projects/blinker-platform/canon/ghl-status.json`
- Refi prototype substrate: `~/Documents/Claude/Projects/Refinance Application Version 2/refi-prototype/src/`
- Platform meta-repo: `~/Documents/Claude/Projects/blinker-platform/`
