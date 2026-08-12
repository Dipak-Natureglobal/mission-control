# Prototype Plan — Blinker Rewrite Phase 1

This is the working plan for the prototype phase. Updated as decisions land. Architecture decisions are in `architecture/`; canonical data is in `canon/`; this doc is the *what we're doing and in what order* doc.

## Where we came from

- Built a comprehensive 36-doc current-state capture of legacy MissionControl + blinker (Rails) + DocuSeal fork at `BlinkerLegacy/docs/mission-control/current-state/`.
- Walked legacy production end-to-end with two test records: `User#25313` (Honda Civic, no payment) and `User#25325` (Ford Bronco Sport, full payment + signed agreements).
- Captured 48 PNG screenshots of the legacy flows.
- Produced a slim active-only DBML extract: 65 tables (52 blinker + 13 docuseal) down from 145.
- Documented findings: 4 production-incident-grade gaps; 4 NEW screens that were undocumented (Validate Pricing modal, vin_check, second EFS DocuSeal embed, Personal Details accordion); confirmed Show-rates-for options + SE GetRates mapping; clarified VIN-decode (API) vs YMMT lookup (file).
- Reviewed the refi prototype source (`refi-portal/refi-prototype/`) + walked it live: VehicleAdd, VehicleDrive screens with DEV CONTROLS sidebar pattern, Stage 1 → Decision → Stage 2 division, Org Config disqualification rules.
- Reviewed the payment-processing-platform: EFS admin prototype (Dashboard/Payment Plans/Decline Management/Scheduled Processing/Retry Queue/Organizations) + customer-portal stub + Cloud Run orchestrator + FluidPay tokenizer/hosted fields.
- Reviewed GHL Apex sub-account (location `reWBjJ4bl9eIFdUlpl4w`): confirmed contact custom-field structure (Vehicle V1/V2/V3 slots) matches the spreadsheet, two opportunities per contact pattern, owner = MC agent name, `blinker-contact` tag identifies sync source.
- Cross-referenced Apex packages in MC against GHL — sync is operational, same names appear in both with consistent stages.

## Architecture decisions (locked)

**Polyrepo** under `~/Documents/Claude/Projects/`, with a small `blinker-platform/` meta-repo holding shared canon + docs. Each app is independently deployable, has its own CLAUDE.md, narrowly scoped for AI context.

**Tech stack** matches the refi prototype + payment-processing-platform substrate exactly:
- Vite + React 19 + JavaScript (no TS)
- lucide-react for icons; recharts where charts needed
- Tailwind-style utility classes (no UI framework like shadcn/Material)
- Custom `useForm` hook (lifted from refi)
- DEV CONTROLS sidebar pattern (Prefill JSON + Presets + Org Config) on every prototype
- Monolithic `App.jsx` per app (refi pattern)
- WizardShell, FormFields, JsonPeek, DevPanel components lifted from refi

**Data model decisions:**
- DB source of truth (Postgres), PostHog augments with granular events + identity. Both write status changes; PostHog wins on reconciliation if drift.
- Three opportunity workflows (protection/refi/insurance) stay independent but every one starts with Contact + Vehicle.
- VIN OR manual YMMT — both paths supported. Mismatch surfaces as confirmation, never silent.
- Org hierarchy: Blinker → Parent Partner → Child Partner. 1 config per org. Parent can copy-down to child; no inheritance.
- 5 personas: super_admin / admin / manager / agent / consumer.
- Org IDs are canonical across all systems (Apex=102, AAA Prospects A=104, etc), mirrored from Blinker's Agreements API.
- Status taxonomy from GHL Blinker Configuration spreadsheet's `status` tab is canonical.

## Repo layout

```
~/Documents/Claude/Projects/
├── blinker-platform/              # meta-repo (this repo)
├── BlinkerLegacy/                 # existing — read-only legacy reference
├── refi-portal/  # existing — refi self-serve prototype
├── payment-processing-platform/   # existing — EFS admin + customer-portal stub + Cloud Run orchestrator
├── customer-portal/               # NEW — public/partner-embed standalone consumer experience
├── protection-portal/             # NEW — FULL protection app (customer + agent + partner views)
├── insurance-portal/              # NEW — FULL insurance app (customer + agent + partner views)
└── mission-control/               # NEW — internal agent/manager/admin/super shell
```

The `*-portal/` apps are the canonical full apps. `customer-portal/` is a thin re-skinned wrapper that **imports** from each `*-portal/` to present a customer-tuned standalone/embed surface.

## Phase 1 build order

1. **`protection-portal/`** — first. Customer view per the consumer self-serve PDF mockup. Lifts heavily from refi prototype (VehicleAdd, VehicleDrive, useForm, DEV CONTROLS, WizardShell). Mocks StoneEagle GetRates; real PostHog. Stubs DocuSeal as iframe placeholder.
2. **`mission-control/`** — second. Agent shell with persona switcher, opportunity-centric inbox, co-pilot pane. Once protection-portal exists, mission-control opens its agent view in the co-pilot pane.
3. **`insurance-portal/`** — third. Capture link generation, capture form, quote review, savings card.
4. **`customer-portal/`** — last. Thin launchpad + customer-tuned re-skins importing from protection/refi/insurance/payments portals.

## What "Phase 1 done" means

- Each app stands up independently with `npm run dev`.
- Persona switcher lets you toggle role without re-login.
- The protection workflow runs end-to-end clickable with mocked integrations.
- Mission Control's agent inbox shows mocked opportunities, opens protection-portal's agent view in co-pilot.
- PostHog is wired (real, not mock) and identifies sessions per persona.
- DEV CONTROLS sidebar is present on every prototype with prefill + presets + org config knobs.
- Each app has a `CLAUDE.md` and a working `npm run dev` command.

## Phase 2

Replace mock adapters with real ones one at a time, behind feature flags:
PostHog (already real) → DocuSeal (most stable contract) → StoneEagle/Express → FluidPay/EFS → VinAudit → Google Places/MarketCheck → Embedded Insurance → Gravity/Savings Group → GHL sync with org sub-account creation.

## Phase 3

Data layer: canonical Postgres schema based on the slim DBML. Decide whether Rails stays or is replaced. Stitch → BigQuery preserved.

## Phase 4

Hosting: Vercel/Fly/Railway for prototypes, defer EKS until traffic justifies.
