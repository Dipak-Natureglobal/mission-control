# mission-control

Internal **agent / manager / admin / super-admin shell**. The unified workspace where Blinker employees and partner staff work across all opportunity types. The rewrite of legacy MissionControl (`~/Documents/Claude/Projects/BlinkerLegacy/MissionControl/`).

This app **doesn't own opportunity workflows** — it composes them. It pulls in agent views from `protection-portal/`, `insurance-portal/`, `Refinance Application Version 2/`, and `payment-processing-platform/` as needed. It owns: the agent inbox, persona switching, the contact/household profile (reorganized per the Mission Control 2.0 PDF), notes/activities, the co-pilot pane that shows what a consumer is doing in real-time, and the admin/manager/super surfaces.

## Status

Phase 1B — not yet scaffolded. Will follow `protection-portal/` in build order, since it needs at least one full opportunity workflow to compose.

## Five personas (all in this app)

- **agent** — call-center sales agent. Daily-driver. Opportunity inbox + co-pilot.
- **manager** — manages agents within an org. Light analytics + user management.
- **admin** — org-level configuration (Configuration table, gateway routing, user roles).
- **super_admin** — Blinker-internal. All orgs, audit logs, sensitive ops.
- **consumer** — NOT used in mission-control directly; consumers use the customer-facing portals.

A persona switcher (`?as=agent|manager|admin|super`) drives which shell renders. DEV CONTROLS lets you flip without re-login.

## What this app owns

- Opportunity-centric **inbox** (queue of opportunities sortable by status/age/owner — replaces legacy's flat Products Dashboard table).
- **Co-pilot pane** (side-by-side hybrid (c) — agent's controls left, mirror of consumer's screen right).
- Contact / Household profile with the reorganized layout per the Mission Control 2.0 PDF: household → contact → vehicle(s) → 3 opportunities → notes → activities.
- Persona switching + role-gated UI.
- Notes / activities / call disposition.
- View API Responses audit trail (super_admin only — same data shape as legacy modal).
- Admin views: Org tree (Blinker → Parent Partner → Child Partner), Configuration editor, Gateway routing, User management.
- Manager views: light analytics on team performance, agent assignment.
- Super-admin views: cross-org analytics, system health, canon version drift indicator.

## What this app does NOT own

- Protection workflow logic → `protection-portal/`
- Insurance workflow logic → `insurance-portal/`
- Refinance workflow logic → `Refinance Application Version 2/`
- Payment plan servicing → `payment-processing-platform/`
- Public consumer surfaces → `customer-portal/`

## Tech stack

Same as `protection-portal/` and `insurance-portal/`. See `~/Documents/Claude/Projects/blinker-platform/CLAUDE.md`.

## Repo layout

```
mission-control/
├── README.md
├── CLAUDE.md
├── package.json
├── vite.config.js
├── index.html
├── .env.example
├── public/
├── src/
│   ├── App.jsx                  # top-level: persona switcher + nav
│   ├── main.jsx
│   ├── shell/                   # DevControls, TopBar, PersonaSwitcher, Nav, CoPilotPane
│   ├── personas/
│   │   ├── agent/               # AgentInbox, OpportunityList, CoPilotEntry
│   │   ├── manager/             # AgentRoster, TeamMetrics
│   │   ├── admin/               # OrgTree, ConfigEditor, GatewayRouting, UserManagement
│   │   └── super/               # CrossOrgAnalytics, SystemHealth, AuditTrail
│   ├── opportunities/
│   │   ├── ProtectionAgentView.jsx   # imports from protection-portal/src/views/agent/
│   │   ├── InsuranceAgentView.jsx    # imports from insurance-portal/src/views/agent/
│   │   ├── RefiAgentView.jsx         # imports from Refinance Application Version 2/refi-prototype/src/
│   │   └── PaymentsAgentView.jsx     # imports from payment-processing-platform/efs-prototype/src/
│   ├── contact/
│   │   ├── ContactProfile.jsx        # the reorganized Mission Control 2.0 layout
│   │   ├── HouseholdPanel.jsx
│   │   ├── VehiclesPanel.jsx
│   │   ├── OpportunitiesPanel.jsx
│   │   ├── NotesPanel.jsx
│   │   └── ActivityFeed.jsx
│   ├── shared/                  # WizardShell, FormFields, useForm, JsonPeek, DevPanel — lifted
│   ├── lib/
│   │   ├── api.js               # talks to blinker-platform-api (TBD) — mock in Phase 1
│   │   └── posthog.js           # real PostHog client
│   ├── constants/
│   │   ├── canon/               # synced from blinker-platform/canon/
│   │   └── nav.js               # role-gated nav config
│   ├── hooks/
│   ├── fixtures/                # mocked opportunities + contacts in Phase 1
│   └── assets/
├── scripts/
└── docs/
    ├── persona-permissions.md
    ├── inbox-design.md
    └── co-pilot-pattern.md
```

## Quickstart

```bash
cd ~/Documents/Claude/Projects/mission-control
npm install
cp .env.example .env.local        # POSTHOG_KEY (sandbox)
npm run dev                       # localhost:5177 (suggested)
```

## Key references

- Legacy MissionControl current-state docs (the entire 36-doc capture is the spec for what this rewrites): `~/Documents/Claude/Projects/BlinkerLegacy/docs/mission-control/current-state/`
- Mission Control 2.0 mockup PDF: `docs/mockups/Blinker Mission Control 2.0.pdf`
- Refi prototype substrate: `~/Documents/Claude/Projects/Refinance Application Version 2/refi-prototype/src/`
- EFS admin shell pattern (left nav + KPI dashboard): `~/Documents/Claude/Projects/payment-processing-platform/efs-prototype/src/`
- Platform meta-repo: `~/Documents/Claude/Projects/blinker-platform/`
