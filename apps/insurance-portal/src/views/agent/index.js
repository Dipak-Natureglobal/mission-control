// Public surface for the insurance-portal agent view.
//
// Mission-control consumes this via a `file:` dependency in its
// package.json — `import { AgentView } from 'insurance-portal/src/views/agent'`.
// Consumers MUST import from this index, never from deeper paths.
// Only AgentView is exported; LeadOriginationForm and LeadStatusTimeline
// are private to the shell.
//
// AgentView accepts:
//   * workflow: object — the insurance workflow state (lead, status,
//                consumer_link, flowPath). Owned by the parent. Wave
//                12c added agent-only slots consumed by the shared
//                NotesPanel; Wave 16 F2-fu13 retired the notes string
//                slot (now log-mode via blinkerApi.notes internally):
//                  - tags:         string[] — tag IDs applied to
//                                  the contact (default [])
//                  - tagsCreated:  Tag[]   — manager+ session-created
//                                  tag objects (default [])
//                Embedders that don't seed these on the workflow get
//                empty defaults via the read sites; the parent must
//                still own the tag slots so persistence survives screen
//                churn. Mission-control's InsuranceEmbed currently
//                seeds only `flowPath`; it will need a follow-up to
//                extend the seed for tags parity with the standalone
//                shell. (notes slot retired Wave 16 F2-fu13 — log-mode.)
//   * updateWorkflow: (patch) => void — partial-update setter for
//                workflow. AgentView mutates lead-origination, webhook,
//                and tag state through this. (notes retired — log-mode.)
//   * dev?: object — DEV CONTROLS knobs (flowPath default,
//                nextVerificationOutcome, nextQuoteOutcome). Optional;
//                defaults are sensible.
//   * persona?: 'super_admin' | 'admin' | 'manager' | 'agent' | 'consumer'
//                (default 'agent'). Threaded into PostHog events as a
//                property. insurance-portal does not currently render a
//                local persona switcher, so persona is informational
//                only — copy/affordance gating can be added later.
//   * personaLocked?: boolean
//                (default false). Reserved for the platform embed
//                contract. insurance-portal has no local persona
//                switcher today, so this prop is accepted for parity
//                with other *-portal AgentView surfaces but currently
//                has no UI to suppress.
//   * contact?: object — canonical mission-control contact record
//                (Phase 2). Optional. Shape:
//                  { id, org_id?, name: { first, last, preferred? },
//                    phones: [{ number, is_primary, ... }],
//                    emails: [{ address, is_primary, ... }],
//                    addresses: [...], vehicles: [...] }
//                When provided, replaces the hardcoded MOCK_CONTACT_PREFILL
//                used by LeadOriginationForm to seed email / phone and
//                to populate the createLead applicant payload
//                (firstName / lastName). Standalone callers (the
//                insurance-portal dev shell) pass nothing and the form
//                falls back to the mock prefill — behavior unchanged.
//   * vehicle?: object — canonical mission-control vehicle record
//                (Phase 2). Optional. Shape:
//                  { id, year, make, model, trim, vin, mileage?,
//                    ownership?, value?, payoff?, source }
//                When provided, replaces the hardcoded vehicle on the
//                LeadOriginationForm "Vehicle on file" line and the
//                createLead vehicles payload. Falls back to the mock
//                prefill's vehicle when omitted.
//   * mode?: 'agent' | 'lean' (default 'agent'). Wave 13-fu-2.
//                AgentView is the only public surface (LeadOriginationForm
//                + LeadStatusTimeline + ConsumerLinkPanel are private),
//                so consumer-facing embedders like protection-portal's
//                CrossSellSubFlow mount AgentView directly. In a consumer
//                context NotesPanel is harmless but cluttered, so lean
//                mode:
//                  - Suppresses NotesPanel pre-send AND post-send.
//                  - Pre-send single-column form-only is unchanged.
//                  - Post-send renders LeadStatusTimeline +
//                    ConsumerLinkPanel single-column (no right rail).
//                  - Suppresses the AgentForceStatusBar production
//                    picker (agent-only override; consumers shouldn't
//                    see it).
//                Default 'agent' keeps every existing call site
//                (mission-control CoPilotPane, standalone insurance-portal
//                AgentView) byte-identical.
//   * availableStatuses?: string[] (default unset). Wave 14-fu.
//                Optional override for the post-send AgentForceStatusBar
//                picker — array of insurance machine_ids
//                (e.g. ['capture.completed', 'quote.completed', ...]).
//                When set + non-empty, replaces the canon-derived list
//                (Object.values(canon.insurance.statuses).map(machine_id)).
//                When unset / empty, falls back to canon — fully
//                backwards compatible with every pre-Wave-14 call site.
//                Mission-control's CoPilotPane populates this from the
//                operator's local status mapping (`mc.status-mapping.v1`,
//                edited via SuperHome StatusMappingEditor) so per-org
//                pickers only offer the statuses that org has actually
//                mapped. Mirrors the parallel
//                protection-portal AgentView `availableStatuses` prop
//                shipped in Wave 13-fu-1.
//
//                Persona gating: the picker is also hidden when persona
//                is consumer (any persona NOT in
//                {agent, manager, admin, super_admin}) and when
//                mode='lean'. Both gates live inside AgentView.
//
// Wave 14-fu also adds a "View API responses" trigger button in the
// post-send AgentForceStatusBar (right side, gated to the canon
// `view_api_responses` permission — super_admin + admin per
// canon/personas.json). Clicking it opens a modal showing raw EI
// webhook payloads landed on the workflow (verification, quote,
// policy). Modal state is owned inside AgentView; embedders don't
// need to thread anything through.
export { AgentView } from './AgentView.jsx';

// InsuranceDevControls — chrome-less DEV CONTROLS body so embedders
// (mission-control's consolidated DevPanel when CoPilot is open on an
// insurance opportunity) can mount the same controls inside their own
// dark sidebar wrapper. Standalone insurance-portal continues to use
// src/shell/DevControls.jsx (full chrome + view switcher + workflow
// reset). Wave 14.
//
// Prop signature (parent owns all state):
//   * dev:            { flowPath, nextVerificationOutcome,
//                       nextQuoteOutcome } — DEV knobs that drive
//                       LeadOriginationForm defaults + EI mock outcomes.
//   * updateDev:      (patch) => void — partial-update setter for `dev`.
//   * workflow:       insurance-portal workflow state (same shape
//                       AgentView consumes — at minimum status, flowPath,
//                       consumer_link, lead).
//   * updateWorkflow: (patch) => void — partial-update setter for
//                       `workflow`. Used by the agent flow simulators
//                       (Blinker-internal link-viewed flip).
//
// What's NOT included (relative to standalone DevControls):
//   * View switcher    — embedded AgentView is always the agent view.
//   * Workflow JSON peek + reset — embedder owns its own debug surface
//                       and reset semantics.
//
// Renders Section / Segmented primitives from src/shared/DevPanel.jsx
// (no <DevPanel> wrapper — embedder supplies the chrome).
export { InsuranceDevControls } from '../../shell/InsuranceDevControls.jsx';
