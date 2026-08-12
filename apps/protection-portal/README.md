# protection-portal

Full app for the **Vehicle Service Contract / Protection Plan** opportunity. Customer + Agent + Partner views all live here. Owns the protection workflow logic, StoneEagle GetRates integration shape, plan-mapping algorithm (PlanSelectorService), agreement template selection, and per-org payment-plan provider routing.

This is the **canonical** protection app. Other apps (e.g. `customer-portal/workflows/protection/`, `mission-control/` agent co-pilot) **import** components and logic from here and re-skin/re-frame for their context — they don't duplicate workflow logic.

## Status

Phase 1A — scaffolding. Customer view first (per the consumer self-serve PDF mockup at `BlinkerLegacy/docs/mission-control/current-state/uploads/...` and `protection-portal/docs/mockups/`).

## What this app owns

- Vehicle Add (VIN OR manual YMMT, with mismatch confirmation when VIN-decode disagrees)
- Vehicle Drive (mileage slider, age-based annual-miles estimate, new/used flag → SE GetRates `<NewUsed>`)
- Vehicle Use (Personal / Rideshare / Commercial → flips BUSINESS USE add-on)
- Modifications (Lifted / Lowered / Bigger Wheels / Salvage / Engine — flag for agent review, no rate effect today)
- Recommended Coverage (Good / Better / Best per `PlanSelectorService` algorithm — see `docs/plan-selector-algorithm.md`)
- Customize Coverage (term + mileage sliders within org-config bounds)
- Capture Contact (TCPA consent with per-org HTML disclaimer)
- Confirm Coverage & Payment
- Billing & Payment (FluidPay tokenizer + hosted fields, lifted from `payment-processing-platform/efs-prototype/src/lib/fluidpay/`)
- VIN Validate post-payment (only fires if no VIN at quote time)
- Product Agreement signing (DocuSeal embed, Omega templates)
- Payment Agreement signing (DocuSeal embed, EFS templates)
- Thank You

## What this app does NOT own

- Insurance workflow → `insurance-portal/`
- Refinance workflow → `Refinance Application Version 2/`
- Payment plan servicing/management → `payment-processing-platform/`
- Agent inbox / multi-opportunity workspace → `mission-control/`
- Public partner-embed entry / launchpad → `customer-portal/`

## Tech stack (matches refi prototype + payment-processing-platform substrate)

- Vite + React 19 + JavaScript (no TS)
- lucide-react for icons
- Tailwind-style utility classes (no UI framework)
- Custom `useForm` hook (lifted from `Refinance Application Version 2/refi-prototype/src/hooks/useForm.js`)
- DEV CONTROLS sidebar pattern on every screen
- Monolithic `App.jsx` per app
- WizardShell, FormFields, JsonPeek, DevPanel components lifted from refi prototype

## Repo layout

```
protection-portal/
├── README.md
├── CLAUDE.md
├── package.json                 # vite + react 19 + lucide-react
├── vite.config.js
├── index.html
├── .env.example
├── public/
├── src/
│   ├── App.jsx                  # top-level: persona/view switcher
│   ├── main.jsx
│   ├── shell/                   # DevControls, TopBar, ViewSwitcher (customer | agent | partner)
│   ├── views/
│   │   ├── customer/            # ← Phase 1A start: consumer self-serve PDF mockup
│   │   ├── agent/               # agent-assisted view (used by mission-control co-pilot too)
│   │   └── partner/             # partner-embedded view (used by customer-portal too)
│   ├── shared/                  # WizardShell, FormFields, useForm, JsonPeek, DevPanel — lifted
│   ├── lib/
│   │   ├── stoneeagle.js        # mock GetRates + PlanSelector algorithm in Phase 1
│   │   ├── fluidpay.js          # lifted from payment-processing-platform/efs-prototype/src/lib/fluidpay/
│   │   ├── docuseal.js          # placeholder iframe in Phase 1
│   │   └── posthog.js           # real PostHog client
│   ├── constants/
│   │   ├── canon/               # synced from blinker-platform/canon/ via sync-canon-into-apps.sh
│   │   ├── ymmt-data.js         # lifted from refi prototype
│   │   ├── prefill-presets.js   # lifted from refi prototype
│   │   └── screens.js
│   ├── hooks/
│   ├── fixtures/                # captured StoneEagle GetRates + DocuSeal payloads from BlinkerLegacy walkthrough
│   └── assets/
├── scripts/
└── docs/
    ├── plan-selector-algorithm.md   # the Good/Better/Best logic from the PDF mockup
    ├── mockups/                     # consumer self-serve PDF + Mission Control 2.0 PDF
    └── api-contracts.md             # what each integration adapter needs
```

## Quickstart

```bash
cd ~/Documents/Claude/Projects/protection-portal
npm install
cp .env.example .env.local        # fill in POSTHOG_KEY (sandbox), FLUIDPAY_PUBLIC_KEY (sandbox)
npm run dev                       # localhost:5175 (suggested — :5173 = refi, :5174 = EFS)
```

## Key references

- **Customer mockup:** `docs/mockups/Consumer Self Serve - VSC, Refi, Insurance.pdf` (Loom + flow diagram)
- **Plan Selector algorithm:** `docs/plan-selector-algorithm.md` (port from legacy `blinker/app/services/plan_selector_service.rb`)
- **Legacy current-state:** `~/Documents/Claude/Projects/BlinkerLegacy/docs/mission-control/current-state/` (read-only)
- **Refi prototype substrate:** `~/Documents/Claude/Projects/Refinance Application Version 2/refi-prototype/src/`
- **FluidPay integration:** `~/Documents/Claude/Projects/payment-processing-platform/efs-prototype/src/lib/fluidpay/`
- **GHL field/status canon:** `~/Documents/Claude/Projects/blinker-platform/canon/`
- **Platform meta-repo:** `~/Documents/Claude/Projects/blinker-platform/`

## Phase 1 → 2 transition

Phase 1: mocks for StoneEagle GetRates, DocuSeal, EFS payment plan creation. PostHog real. Walk through end-to-end clickable.

Phase 2: replace mocks with real adapters one at a time, behind feature flags. Order: DocuSeal → StoneEagle → FluidPay/EFS → GHL sync.
