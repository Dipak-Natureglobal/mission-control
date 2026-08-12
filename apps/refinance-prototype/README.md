# refi-portal

Full app for the **Refinance** opportunity. Customer + Agent + Partner views all live here. Owns the refi workflow logic (vehicle capture, applicant intake, credit-soft-pull consent, decision engine), Stage 1 / Stage 2 progression, and the Stage 2 result fan-out (qualified handoff, offers, disqualified, pending).

This is the **canonical** refi app. Other apps (`protection-portal/` for the cross-sell embed, `mission-control/` for the agent co-pilot pane, `customer-portal/` for the public launchpad) **import** components from here and re-skin/re-frame for their context — they don't duplicate workflow logic.

## Status

Phase 1.5b — substrate scaffolding + customer view lift from `refi-prototype/`. Agent view + public exports (the embed surface protection-portal will consume) land in § 1.5c per `~/Documents/Claude/Projects/blinker-platform/PROMPTS.md`.

The Vite app was previously nested at `refi-portal/refi-prototype/`; the flatten landed in commit 1 of this session so the layout matches `protection-portal/`, `insurance-portal/`, `mission-control/`, `customer-portal/`.

## What this app owns

- Vehicle Add (VIN OR manual YMMT)
- Vehicle Drive (mileage, condition, state)
- Ownership (current loan info)
- Auto Loan (current lender, balance, APR, term, payment)
- Credit (credit band: 300–579 / 580–669 / 670–739 / 740+)
- Applicant cluster (Applicant → Housing → Employment) — order flips before/after co-app cluster based on credit band per the prototype's `getSequence()`
- Co-applicant cluster (decision → contact → employment when present)
- Identity & Consent (DOB + last-4 SSN, soft-pull TCPA disclosure)
- Decision Engine (mock decision in Phase 1 — qualified / disqualified / pending)
- Stage 2 Result fan-out (offers card, qualified handoff, disqualified card, pending card; insurance savings + protection plan upsell teasers)

## What this app does NOT own

- Protection plan workflow → `protection-portal/`
- Insurance workflow → `insurance-portal/`
- Payment plan servicing/management → `payment-processing-platform/`
- Agent inbox / multi-opportunity workspace → `mission-control/`
- Public partner-embed entry / launchpad → `customer-portal/`

## Tech stack (matches platform substrate)

- Vite 8 + React 19 + JavaScript (no TS)
- lucide-react for icons
- Tailwind-style utility classes via the Tailwind CDN (no UI framework)
- Custom `useForm` hook (lifted to `src/hooks/useForm.js`)
- DEV CONTROLS sidebar pattern on every screen
- Top-level `App.jsx` per app
- WizardShell, FormFields, JsonPeek, DevPanel components in `src/shared/`

## Repo layout

```
refi-portal/
├── README.md
├── CLAUDE.md
├── package.json                 # vite + react 19 + lucide-react
├── vite.config.js               # port 5179
├── eslint.config.js
├── index.html
├── .env.example
├── public/
├── src/
│   ├── App.jsx                  # top-level: dev sidebar + view switcher
│   ├── main.jsx
│   ├── index.css
│   ├── shell/                   # TopBar, DevControls, ViewSwitcher (customer | agent | partner)
│   ├── views/
│   │   ├── customer/            # consumer self-serve flow + RefiWizard composition
│   │   ├── agent/               # § 1.5c
│   │   └── partner/             # later, when customer-portal wires its public chrome
│   ├── shared/                  # WizardShell, FormFields, JsonPeek, DevPanel — lifted from protection-portal
│   ├── hooks/                   # useForm
│   ├── lib/                     # refi-specific helpers (api stub, validators, posthog)
│   ├── constants/
│   │   ├── canon/               # synced from blinker-platform/canon/ via sync-canon-into-apps.sh
│   │   ├── ymmt-data.js
│   │   ├── prefill-presets.js
│   │   ├── screens.js
│   │   ├── lenders.js
│   │   └── mock-data.js
│   ├── fixtures/                # Phase 1 mock payloads (Stage 2 decision shapes etc.)
│   ├── results/                 # Stage 2 result cards (Offers, QualifiedHandoff, etc.)
│   ├── utils/                   # validation, api stub
│   └── assets/
├── backup/                      # local-only, gitignored
└── documentation/               # spec PDFs, engineering plan, refi v2 wiki
```

## Quickstart

```bash
cd ~/Documents/Claude/Projects/refi-portal
npm install
cp .env.example .env.local        # POSTHOG_KEY etc. — optional in Phase 1
npm run dev                       # localhost:5179
```

Port map across the platform: `:5173` = legacy refi, `:5174` = EFS, `:5175` = protection-portal, `:5176` = insurance-portal, `:5177` = mission-control, `:5178` = customer-portal, `:5179` = refi-portal.

## Key references

- Engineering plan + refi v2 wiki: `documentation/engineering-plan.md`, `documentation/refinance-version-2-wiki.md`
- Spec PDFs: `documentation/{ApplyForRefinance,EmbeddedRefinance,VehicleAddConfirm,AddDriverUIUX}.pdf`
- Prototype README (legacy quickstart): `documentation/refi-prototype-README.md`
- Cross-sell ADR: `~/Documents/Claude/Projects/blinker-platform/architecture/08-cross-sell-orchestration.md`
- Embed contract: `~/Documents/Claude/Projects/blinker-platform/architecture/02-integration-boundaries.md`
- Platform meta-repo: `~/Documents/Claude/Projects/blinker-platform/`

## Phase 1 → 2 transition

Phase 1: mocked decision engine, mocked credit pull, mocked offers list. PostHog real. Walk through end-to-end clickable.

Phase 2: replace mocks with real adapters behind feature flags. Decision-engine + lender-marketplace integration order TBD with product.
