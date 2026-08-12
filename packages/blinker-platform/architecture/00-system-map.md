# 00 — System Map

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CONSUMER TOUCHPOINTS                                │
│                                                                                  │
│  Partner Site                Direct Campaign URL          SMS / Email Link       │
│       │                              │                          │                │
│       └──────────────┬───────────────┴──────────────────────────┘                │
│                      ▼                                                           │
│            ┌─────────────────┐                                                   │
│            │ customer-portal │  public + partner-embed shell                     │
│            │  /p/:token      │  re-skins workflow customer views                 │
│            └─────────┬───────┘                                                   │
│                      │                                                           │
└──────────────────────┼───────────────────────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┬──────────────────┐
        ▼              ▼              ▼                  ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐
│ protection- │ │ insurance-  │ │ Refinance   │ │ payment-        │
│   portal    │ │   portal    │ │ Application │ │ processing-     │
│             │ │             │ │  Version 2  │ │  platform       │
│ CUSTOMER ── │ │ CUSTOMER ── │ │ CUSTOMER ── │ │ customer-portal │
│ AGENT       │ │ AGENT       │ │ AGENT       │ │ (post-purchase) │
│ PARTNER     │ │ PARTNER     │ │             │ │                 │
└──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └────────┬────────┘
       │               │               │                 │
       └───────────────┴───────┬───────┴─────────────────┘
                               │
                  ┌────────────▼────────────┐
                  │      mission-control     │  internal shell
                  │                          │  agent / manager / admin / super
                  │  AGENT INBOX (queue)     │
                  │  CO-PILOT PANE           │
                  │  CONTACT PROFILE         │
                  │  ORG TREE / CONFIG       │
                  │                          │
                  │  imports each portal's   │
                  │  AGENT VIEW              │
                  └────────────┬─────────────┘
                               │
                  ┌────────────▼─────────────┐
                  │   blinker rewrite API    │  TBD — Phase 3
                  │   (canonical schema)     │
                  └────────────┬─────────────┘
                               │
                  ┌────────────▼─────────────┐
                  │     blinker (Rails)      │  legacy — read/write through Phase 2
                  │     Postgres + Sidekiq   │
                  └────────────┬─────────────┘
                               │
       ┌───────────────────────┼────────────────────────┐
       ▼                       ▼                        ▼
┌─────────────┐        ┌──────────────┐         ┌──────────────┐
│  StoneEagle │        │  FluidPay    │         │   DocuSeal   │
│  Express    │        │  EFS         │         │  (fork)      │
│  Aftermarket│        │  Orchestrator│         │              │
└─────────────┘        └──────────────┘         └──────────────┘

┌─────────────┐        ┌──────────────┐         ┌──────────────┐
│  VinAudit   │        │  Embedded    │         │     GHL      │
│  Google     │        │  Insurance   │         │  (per-org    │
│  MarketCheck│        │              │         │  sub-account)│
└─────────────┘        └──────────────┘         └──────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                        EVENT + AUDIT BUS                          │
│                          PostHog                                  │
│  identify per persona + per consumer; events on every action      │
│  DB writes are source of truth; PostHog augments + reconciles     │
└──────────────────────────────────────────────────────────────────┘
```

## Key relationships

- **`customer-portal/`** is the public/partner-embed front door. It IMPORTS and re-skins the customer views from each `*-portal/`. It owns no workflow logic.
- **`*-portal/`** apps are the canonical full implementations of each opportunity workflow. They have customer + agent + partner sub-views all in one repo.
- **`mission-control/`** is the internal agent shell. It IMPORTS each `*-portal/`'s agent view and frames it in the unified workspace + co-pilot pane.
- **`blinker-platform/`** (this repo) holds shared canon (org registry, GHL maps, personas, plan mappings) and platform-level architecture docs. No app code.

## Existing systems (continue to operate, integrate with, eventually replace)

- **`BlinkerLegacy/`** — the existing Rails + React 17 production at `missioncontrol.blinker-prod.com`. Read-only reference; the new mission-control will eventually replace its agent surface.
- **`refi-portal/`** — refi self-serve prototype, intended to become the canonical refi customer view. Naming inconsistency acknowledged (other portals are `*-portal/`); won't be renamed (existing GitHub repo).
- **`payment-processing-platform/`** — orchestrator (Cloud Run) + EFS admin (Vite/React) + customer-portal stub. The customer-portal stub here gets superseded by the new top-level `customer-portal/payments/` wrapper; the orchestrator stays.

## Phase 1 build order

1. `protection-portal/` (canonical full app for VSC; customer view per the PDF mockup first)
2. `mission-control/` (agent shell; co-pilot composes protection-portal's agent view)
3. `insurance-portal/` (canonical full app for insurance; mirror protection-portal pattern)
4. `customer-portal/` (thin re-skin wrapper; comes last because it imports from the three above + refi + payments)
