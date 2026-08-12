# 02 — Integration Boundaries

## Premise

The platform is polyrepo. Each child app owns its workflow end-to-end. Cross-app touchpoints happen at narrow, documented seams — never by reaching into another app's internals. This file is the seam catalog and the public-surface contract.

Three kinds of cross-app integration:

1. **Canonical data sync** — `canon/` files copied into each child app. One direction (this repo → children). See `architecture/03-canon-versioning.md` (placeholder).
2. **Domain entity reads/writes** — apps consume Blinker entities (contact, opportunity, etc.) via the API layer. Today: per-app fixtures conforming to `canon/blinker-domain.json`. See `architecture/07-data-layer.md`.
3. **UI embedding** — one app composes another app's React component into its own tree via a `file:` dep. The orchestration shape and rules are documented in `architecture/08-cross-sell-orchestration.md`. This file documents the **public-surface contract** every embed source must follow.

## What each app owns vs. consumes

| App | Owns (workflow + UI) | Consumes (embedded UI) | Consumes (canon) |
|---|---|---|---|
| `protection-portal` | VSC capture / quote / customize / billing / signing | `insurance-portal` SavingsCard (✅); `refi-portal` PrequalForm + OffersCard + QualifiedCard (✅ 1.5d) | `blinker-domain.json`, `ghl-fields.json`, `ghl-status.json`, `org-registry.json`, `personas.json`, `plan-mappings.json` |
| `insurance-portal` | EI capture link / quote review / policy bound / SavingsCard | none (insurance is leaf) | same |
| `refi-portal` (planned) | Refi prequal / offers / decision / funded | none (refi is leaf) | same |
| `mission-control` | Agent inbox / co-pilot pane / contact profile / persona shell | `protection-portal` AgentView (✅); `refi-portal` AgentView (✅ 2026-05-03); `insurance-portal` AgentView (in flight 2026-05-03) | same |
| `customer-portal` (waiting) | Public launchpad + per-org branding | all four workflow customer views (each portal's `src/views/customer`) | same |

The asymmetry: `protection-portal` is the only orchestrator (per `architecture/08-cross-sell-orchestration.md` decision 1). `mission-control` consumes from all but exposes nothing. `customer-portal` is the second consumer-only app — it re-skins the others.

## Public-surface contract (for embed sources)

Every app that exposes UI to other apps must follow this contract. It exists so consumers can reach in safely without knowing the source app's internals.

### Layout

```
<source-app>/
├── src/
│   ├── views/
│   │   ├── customer/
│   │   │   └── index.js          ← public surface (named exports only)
│   │   └── agent/
│   │       └── index.js          ← public surface (named exports only)
│   ├── lib/
│   │   └── <workflow>.js         ← public hooks + pure logic (named exports)
│   ├── fixtures/
│   │   └── *.json                ← Phase 1 mock data; consumers can read these
│   └── constants/
│       └── canon/                ← synced from this repo; consumers can read these
└── package.json                  ← name + main matches consumer expectations
```

### Public surface = `index.js` re-exports only

Three public-surface index files per source app:
- `src/views/customer/index.js` — full customer-facing screens (PrequalForm, SavingsCard, ProtectionWizard pieces, etc.)
- `src/views/agent/index.js` — full agent-facing shells (AgentView)
- `src/components/index.js` — workflow-agnostic reusable widgets (AddressBlock, NotesPanel, TagPicker, etc.) that compose inside any workflow

Consumers MUST import from one of those three index files. They MUST NOT import from deeper paths like `<source>/src/views/customer/CaptureForm.jsx` directly. The deeper paths are private — names and signatures change without warning.

Today's example (concrete):

```js
// CORRECT — protection-portal's Confirm.jsx
import { SavingsCard } from 'insurance-portal/src/views/customer';

// WRONG — reaching into a private path
import SavingsCard from 'insurance-portal/src/views/customer/SavingsCard.jsx';
```

The `index.js` files are short and explicit. They list every public component / function with a one-line comment on intended use. Refusing to add an export is the way to keep an internal component internal.

### Hooks and pure logic

Cross-app reusable hooks and pure logic (not React components) live at `src/lib/<workflow>.js`:

```js
// insurance-portal/src/lib/money.js — public
export function formatCents(cents, opts) { ... }

// refi-portal/src/lib/refi.js — public (planned 1.5c)
export function useRefiPrequal({ contactId, vehicleId }) { ... }

// protection-portal/src/lib/protection-pricing.js — internal (this app's pricing, not exported)
function pmt(principal, apr, term) { ... }
function protectionPlanMonthlyOnRefi({ planTotal, loanPrincipal, apr, termMonths }) { ... }
```

Public lib modules name themselves by workflow (`money.js`, `refi.js`, `insurance.js`) so consumers can guess the import path. Private lib modules name themselves by what they do.

### Persona props (mandatory)

Every public component accepts `{ persona, personaLocked }` and respects parent context:

- `persona`: `'agent' | 'manager' | 'admin' | 'super_admin' | 'consumer'`. Drives copy variants and affordance gating.
- `personaLocked`: `boolean`. When `true`, the embed must NOT render its own persona switcher. Parent owns the switcher.

The **embed-don't-fork** rule — see `architecture/08-cross-sell-orchestration.md` decision 5 — depends on this convention. Without `personaLocked`, mission-control would have two persona switchers stacked on top of each other.

### Cross-sell embed conventions

Two patterns the cross-sell orchestration shipped in § 1.5d. Both apply to any future cross-sell host (e.g., a future workflow that embeds VSC inside another flow).

**1. Mini-capture pattern (when the host needs a thin slice of the source's capture step).**

When a cross-sell host needs only a small subset of the source workflow's capture step (e.g., protection-portal's `CrossSellSubFlow.jsx` collects an email + ZIP to seed an insurance lead, not the source's full CaptureForm), the host implements an inline mini-capture matched to its own UX. The source app is NOT obligated to expose its full capture form on the public surface for cross-sell consumption.

Why: the source's CaptureForm is shaped for the source's customer journey (full disclosures, partner-specific copy, multi-step internal state). Forcing it into a cross-sell sub-flow either pulls in unwanted UX or splinters the source's CaptureForm into a configurable "embed mode" that adds complexity for both sides. Mini-captures are short, self-contained, and let the host stay in its own visual + state idiom.

When the host wants the source's full first-class capture, it imports it from `src/views/customer/index.js` like any other public component (today: not used; available if needed). When the host wants a thin slice, it owns the form. Either is valid.

**2. Result callbacks include all data the embedder might render.**

When source apps expose a workflow component with a result callback (e.g., refi-portal's `PrequalForm.onComplete(payload)`), the payload includes everything the embedder might want for downstream rendering — not just a status discriminator. Refi's onComplete payload is shaped `{ result, offers, ...result-specific fields }`; `offers` is always present (empty array for non-offers branches) so embedders can pass it straight into `OffersCard` without reaching into internal hooks.

The alternative — making embedders subscribe to `useRefiPrequal()` directly — couples the host's render tree to the source's hook lifecycle and forces hook ordering rules across the seam. Callbacks are looser; they work the same whether the host renders the result inline or hands it back to a parent component.

Both `useRefiPrequal()` and `PrequalForm` remain on the public surface. The convention: prefer the form callback unless you specifically need the streaming/intermediate state the hook exposes.

### Phase 1 fixture pattern

In Phase 1, every public component is fixture-driven. Fixtures conform to `canon/blinker-domain.json` where applicable; partner-payload fixtures (Embedded Insurance webhook bodies, StoneEagle GetRates responses) live alongside but are not domain entities. `scripts/validate-fixtures.js` walks each app's fixtures and warns on shape drift.

When the Phase 2 API layer lands (per `architecture/07-data-layer.md`), each fixture import becomes an `await blinkerApi.{entity}.get(...)` call returning the same shape. The component's prop signature does not change.

### Wiring — `file:` deps

Consumers add the source app as a `file:` dep:

```json
// protection-portal/package.json
{
  "dependencies": {
    "insurance-portal": "file:../insurance-portal",
    "refi-portal":      "file:../refi-portal"
  }
}
```

`npm install` creates a symlink at `node_modules/<name>/`. The consumer's `vite.config.js` should already alias `react` and `react-dom` to its own `node_modules` to dedupe through the symlink — this is how mission-control + protection-portal already work, no special tweaks needed.

**HMR caveat:** Vite HMR doesn't reliably propagate edits inside `file:`-linked deps into the consumer's dev server. Restart `npm run dev` in the consumer after any source-side change. Document the caveat inline in any consumer file that imports across the seam (mission-control's `CoPilotPane.jsx` is the precedent).

## Today's seams (confirmed wiring)

| Consumer | Source | Import | Status |
|---|---|---|---|
| `protection-portal/src/views/customer/Confirm.jsx` | `insurance-portal` | `import { SavingsCard } from 'insurance-portal/src/views/customer'` | ✅ shipped 2026-05-03 |
| `mission-control/src/components/CoPilotPane.jsx` | `protection-portal` | `import { AgentView } from 'protection-portal/src/views/agent'` | ✅ shipped 2026-05-03 |
| `protection-portal/src/views/customer/CrossSellSubFlow.jsx` | `refi-portal` | `import { PrequalForm, OffersCard, QualifiedCard } from 'refi-portal/src/views/customer'` (lazy-loaded via `React.lazy`) | ✅ shipped § 1.5d |
| `mission-control/src/components/CoPilotPane.jsx` | `refi-portal` | `import { AgentView } from 'refi-portal/src/views/agent'` (lazy-loaded via `React.lazy`) | ✅ shipped 2026-05-03 |
| `mission-control/src/components/CoPilotPane.jsx` | `insurance-portal` | `import { AgentView } from 'insurance-portal/src/views/agent'` (lazy-loaded via `React.lazy`) | ✅ shipped 2026-05-03 |
| `mission-control/src/components/AddVehicleModal.jsx` + `NewOpportunityFlow.jsx` + `StartOpportunityFlow.jsx` | `refi-portal` | `import { VehicleAdd } from 'refi-portal/src/views/customer'` (lazy via `React.lazy`) | ✅ shipped 2026-05-03 |
| `mission-control/src/components/AddContactModal.jsx` | `refi-portal` | `import { AddressBlock } from 'refi-portal/src/components'` (with nested `fieldNames` remap) | ✅ shipped 2026-05-03 |
| `protection-portal/src/views/customer/GarageLocation.jsx` + `BillingPayment.jsx` | `refi-portal` | `import { AddressBlock } from 'refi-portal/src/components'` | ✅ shipped 2026-05-04 |
| `protection-portal/src/views/customer/VehicleDrive.jsx` | `refi-portal` | `import { VehicleDrive } from 'refi-portal/src/views/customer'` (Wave 5b adapter) | ✅ shipped 2026-05-04 |
| `protection-portal/src/views/agent/AgentView.jsx` | `refi-portal` | `import { NotesPanel } from 'refi-portal/src/components'` | ✅ shipped 2026-05-04 |
| `insurance-portal/src/views/agent/AgentView.jsx` | `refi-portal` | `import { NotesPanel } from 'refi-portal/src/components'` | ✅ shipped 2026-05-04 |
| `customer-portal/*` | all four portals | various | planned post-1.5 |

## Forbidden seams

These are explicit non-goals; if you find code doing one of them, it's a bug:

- Reaching into another app's deep paths (anything outside `src/views/customer/index.js`, `src/views/agent/index.js`, `src/components/index.js`, `src/lib/<workflow>.js`).
- Mutating another app's state from outside (no shared Redux store, no global event bus). Cross-app state changes flow through props/callbacks at the embed seam.
- Bidirectional `file:` deps (e.g., `protection-portal` depends on `insurance-portal` AND `insurance-portal` depends on `protection-portal`). Creates cyclic build graphs. Today the dependency graph is a DAG with `protection-portal` as the orchestration root, `mission-control` as a separate consumer, and `customer-portal` (eventual) as a leaf consumer.
- Persona switching from inside an embed when `personaLocked={true}`. The parent owns the persona; the embed renders for it.
- Reading from another app's `src/fixtures/*.json` directly (other than the source app reading its own). Fixtures are private to the producing app; cross-app data flow goes through canon (for shape) and props (for instances).

## Open work

- `architecture/03-canon-versioning.md` — how canon versions move between this repo and child apps. Today: explicit copy via `scripts/sync-canon-into-apps.sh`; each child commits its own canon copy. Document the convention formally when a canon-mismatch ever causes a real bug.
- CI hook for cross-seam smoke. A break in an embed source's `index.js` only surfaces when the consumer builds. Today this is a manual smoke after any source-side change; should automate when CI lands.
- Public-surface lint. A regex CI check that flags any import path that crosses an app boundary and doesn't end at `src/views/customer/`, `src/views/agent/`, `src/components/`, or `src/lib/`. As of 2026-05-04 there are 8 confirmed seams across the four child apps; lint is now firmly worth landing.
- **Refi-portal as the de-facto shared-component host** — Wave 6 (AddressBlock) + Wave 12 (NotesPanel + TagPicker) established refi-portal's `src/components/` as the shared surface for cross-workflow widgets. Three of the four other child apps (protection, insurance, mission-control) consume from it via `file:../refi-portal`. The asymmetry is acknowledged but not fixed: refi-portal hosts because it had the richest implementations to start, and a NEW shared package would violate the locked polyrepo + `file:`-deps decision. If refi-portal ever needs to be replaced, the components migrate to whatever takes its slot.
