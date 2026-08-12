# CLAUDE.md — mission-control

You are working on the **rewrite of the legacy Blinker MissionControl shell**. This is the unified internal workspace where agents (and managers/admins/super-admins) work across all opportunity types.

## Read first

1. `README.md` (this folder) for app scope and persona breakdown.
2. `~/Documents/Claude/Projects/BlinkerLegacy/docs/mission-control/current-state/README.md` — the legacy capture is the SPEC for what this rewrites. The 36 docs there describe the existing behavior; this app is the do-it-better version.
3. `~/Documents/Claude/Projects/blinker-platform/CLAUDE.md` for platform-wide decisions.

## DO

- Match `protection-portal/` substrate exactly: Vite + React 19 + JS, lucide, tailwind classes, custom `useForm`, monolithic `App.jsx`, DEV CONTROLS sidebar.
- **Compose, don't reinvent.** Agent views for each opportunity type are imported from the respective portal (e.g., `import ProtectionAgentView from 'protection-portal/src/views/agent'`). This app provides the shell that frames them.
- Use the **opportunity-centric inbox** model — agents work from a queue of opportunities, not a flat customer list. Sortable by status/age/owner/deadline.
- Implement the **co-pilot pane** as side-by-side hybrid (c): agent's controls left, mirror of consumer's screen right. Updates in real-time as the consumer moves through the consumer-portal.
- Reorganize the **contact profile** per the Mission Control 2.0 PDF mockup: household → contact → vehicles → 3 opportunities → notes → activities.
- Role-gate every UI element. Nav config in `src/constants/nav.js` keyed by persona.
- PostHog identify per persona; fire events on every persona switch, opportunity open, status change, co-pilot enter/exit.

## DO NOT

- Don't add opportunity workflow logic here. Import from the respective `*-portal/`.
- Don't add consumer-facing surfaces. Those are in the portals + customer-portal.
- Don't recreate legacy MissionControl's bad patterns: cluttered user profile, silent state transitions, default filters that hide data, the redundant left-rail expansion. The legacy `AUDIT-2026-05-02.md` document lists the production-incident-grade gaps to NOT regress on.
- Don't introduce TypeScript or a UI framework.
- Don't introduce a router library unless the URL/persona structure demands it.

## Five personas

- **agent** — opportunity inbox + co-pilot. Daily-driver. Phase 1A focus.
- **manager** — light analytics on team performance, agent assignment. Phase 1B stub.
- **admin** — org-level configuration. Phase 1B stub.
- **super_admin** — Blinker-internal cross-org views. Phase 1B stub.
- **consumer** — NOT applicable here; consumers use the portals.

In Phase 1, agent persona gets the most work; the other three are stubbed at the look-and-feel level so persona switching feels real even if functionality is shallow.

## Composing portal views

```jsx
// In src/opportunities/ProtectionAgentView.jsx
import { AgentView } from 'protection-portal/src/views/agent';
export default function ProtectionAgentView(props) {
  return <AgentView {...props} embeddedIn="mission-control" />;
}
```

The `embeddedIn` prop tells the portal it's inside mission-control vs standalone — affects chrome, navigation, persona context.

## Phase 1 acceptance

- `npm run dev` works
- Persona switcher flips agent / manager / admin / super shells; each shell looks distinct
- Agent inbox shows mocked opportunities from `src/fixtures/`, sortable + filterable
- Clicking an opportunity opens the co-pilot pane: agent controls left, mocked consumer screen right
- Contact profile renders per the Mission Control 2.0 PDF layout (household → contact → vehicles → 3 opps → notes → activities)
- Notes panel + activity feed both work
- DEV CONTROLS sidebar lets you switch persona, force opportunity status, prefill contact data
- PostHog identifies agent + fires events
- View API Responses modal works (super_admin only)

## Cross-references

- Legacy MissionControl docs (the spec): `~/Documents/Claude/Projects/BlinkerLegacy/docs/mission-control/current-state/`
- Legacy production findings (don't regress): `~/Documents/Claude/Projects/BlinkerLegacy/docs/mission-control/current-state/AUDIT-2026-05-02.md`
- Mission Control 2.0 layout mockup: `docs/mockups/Blinker Mission Control 2.0.pdf`
- EFS admin shell pattern (left nav + KPI dashboard): `~/Documents/Claude/Projects/payment-processing-platform/efs-prototype/src/App.jsx`
- Refi prototype substrate: `~/Documents/Claude/Projects/Refinance Application Version 2/refi-prototype/src/`
- Platform meta-repo: `~/Documents/Claude/Projects/blinker-platform/`
