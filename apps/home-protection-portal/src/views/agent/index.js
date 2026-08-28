// Public surface for the home-protection-portal agent view.
//
// Mission-control consumes this through a `file:` dependency:
//   import { AgentView } from 'home-protection-portal/src/views/agent'
// and mounts it LAZILY (React.lazy), matching refi and insurance — only
// protection is imported eagerly, because it is the dominant workflow.
//
// Everything else under views/agent/ is private to the shell.
//
// ─────────────────────────────────────────────────────────────────────────
// AgentView prop contract (ADR 30). Every one of these is destructured in
// AgentView — React silently discards props that are never named, so an
// addition here that is not mirrored there does nothing at all and reports
// no error.
//
//   persona?: 'super_admin' | 'admin' | 'manager' | 'agent'   (default 'agent')
//       Gates the "View API responses" button (super_admin only). When
//       mission-control's cross-app PersonaSwitcher owns the choice, pass it
//       here and set personaLocked.
//
//   opportunity?: the canonical opportunity record from the mc session.
//       Reads { id, status, captureLink, sentSummary, contact, _prefill }.
//       `status` drives three things at once: the pill, the showWizard gate,
//       and the resume-at-step jump. A status of 'Empty' shows the
//       capture-link gate instead of the wizard.
//       `_prefill?.home`: { address, source: 'contact_address' | 'picked_home'
//       | null }. Only consulted when `home` (below) is absent — mission-
//       control sends this when the contact has an address but no home on
//       file yet, so the covered-property AddressBlock is prefilled instead
//       of asking twice. 'contact_address' means the address is ASSUMED from
//       the contact's mailing address and not yet confirmed; HomeAdd shows a
//       quiet inline note in that case. Every seeded field stays editable,
//       and home_type / square_feet / year_built are never supplied by this
//       — the eligibility gate is unaffected.
//
//   contact?: the canonical mission-control contact record.
//       { id, org_id, household_id, name: { first, last },
//         phones: [{ number, is_primary }], emails: [{ address, is_primary }],
//         addresses: [{ line_1, city, state, postal_code, is_primary }],
//         household_members: [...] }
//       Seeds the AGREEMENT HOLDER's identity and mailing address. Read once
//       on mount — the parent remounts via `key` when the contact changes.
//
//   home?: the canonical home record (canon/blinker-domain.json#home).
//       { id, home_type, address, year_built, square_feet, purchase_price,
//         disposition }
//       Seeds the COVERED PROPERTY. Distinct from the contact's mailing
//       address on purpose: the agreement has separate fields for each, and
//       collapsing them is the live template defect ADR 30 R5 documents.
//       `dwelling_class` is NOT read from here — it is re-derived from
//       (home_type, square_feet) so a canon bucket change takes effect
//       without rewriting stored records.
//
//   form? / update? / stepIdx? / setStepIdx?
//       Shared wizard-state ownership. Thread ALL FOUR or none. When present,
//       AgentView reads and writes the parent's state so an embedder's
//       DevPanel can drive the same wizard; when absent it falls back to
//       internal state seeded from contact + home.
//
//   onFormChange?: (form) => void
//       Fired on mount with the seeded form and on every subsequent change.
//       Memoize it if reference stability matters — it is wired into an
//       effect with [form, onFormChange] deps, so an unstable callback
//       re-fires on every form change carrying no new information.
//
//   onHomeCommitted?: (home) => void
//       Fired whenever the wizard learns something new about the property,
//       once it has at least a type and a street address. The payload is a
//       canonical home record, id-stable so the embedder can dedupe and
//       patch in place. The home analog of protection-portal's
//       onVehicleCommitted; repeat fires with the same payload are no-ops.
//
//   availableStatuses?: string[]
//       Replaces the canon-derived status list in the Force-status picker.
//       Mission-control publishes a per-org mapped subset; unset or empty
//       falls back to all 20 canon home_protection display names.
//
//   personaLocked?: boolean   (default false)
//       Hides AgentView's local persona switcher — the embedder's switcher
//       is the source of truth.
//
//   seedMultiContactHousehold?: boolean   (default false)
//       DEV CONTROLS only. Seeds a mock household so the billing contact /
//       address switchers and the second-agreement-holder slot are testable.
// ─────────────────────────────────────────────────────────────────────────

export { AgentView, buildInitialFormSeed } from './AgentView.jsx';
export { HomeProtectionDevControls } from '../../shell/HomeProtectionDevControls.jsx';
