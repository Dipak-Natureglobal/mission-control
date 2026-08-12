# ADR 15 — StoneEagle GetRates error handling (per-org config)

**Status:** Accepted (Wave 23 v3.0.5 Task 7, 2026-05-09)
**Extends:** ADR 13 stoneeagle-integration

## Context

The W21-fu real-mode SE GetRates path (proxy + UAT credentials +
ApiResponsesModal) shipped without a structured error model. When
SEFI returns:

- A `<Fault>` envelope with a known SOAP error
- A 200 with `<ErrorResponse>` body (state-not-supported, dealer
  inactive, recipient ID mismatch, etc.)
- A 200 with empty `<PlanRate>` collection (no rates returned for
  this VIN/state combination)
- A timeout / 5xx
- A malformed XML body

… the wizard today either silently shows an empty plan list or surfaces
a developer-grade error string. There is no friendly customer copy and
no per-org configurability for handling regional SE quirks.

The PDF v3.0.5 Task 7 spec'd: "Review and or build the plan for org
config where we determine how to handle known errors that will come
from the SE GetRates calls."

## Decision

1. Canon `org-registry.json` per-org `se_getrates.error_handling` block:
   ```json
   "se_getrates": {
     "error_handling": {
       "default_strategy": "show_friendly_message" | "fallback_fixture" | "block",
       "known_errors": [
         {
           "pattern": "<regex against raw response text>",
           "code": "<symbolic id>",
           "user_message": "<customer-facing copy>",
           "internal_action": "retry" | "log_only" | "page_oncall"
         }
       ]
     }
   }
   ```

2. `packages/integrations/product_admin/stoneeagle.js` adds:
   ```js
   classifySeError(rawResponseText, orgConfig) →
     { kind: 'fault'|'error_response'|'empty'|'transport'|'malformed'|'unknown',
       code,
       displayMessage,    // sourced from known_errors match OR default strategy
       internalAction,
       raw }              // always echo the original payload for DevPanel
   ```
   wired into `parseGetRatesXml`'s error branch (current
   `stoneeagle.js:215-244`).

3. protection-portal consumer:
   - The GetRates call site catches the classified error and renders
     `error.displayMessage` in a friendly callout (replaces today's
     silent failure / empty list).
   - DevPanel `ApiResponsesModal` 4-panel view (W21-fu) gains a 5th
     panel: **Error classification** (kind + code + matched pattern).
   - `error.raw` always available in the existing Raw panel.

4. Strategy semantics:
   - `show_friendly_message` (default) — render the matched
     `user_message` (or generic fallback if no match), do NOT load
     fixture rates.
   - `fallback_fixture` — render `user_message` as a banner AND load
     bundled fixture rates so the wizard can complete (useful for
     demos / staging where SEFI is intermittently down).
   - `block` — render `user_message` as a hard error, hide the
     wizard, suggest agent contact SEFI ops.

5. Apex 102 ships with `default_strategy: 'show_friendly_message'` and
   an empty `known_errors[]` seed. As production-observed errors are
   triaged, entries land here without a code change.

## Consequences

- Customer-facing surfaces no longer show developer error strings or
  silent empty states.
- Per-org tuning lets us mark FL-state-not-supported as benign for
  orgs that don't operate in FL while treating it as a hard error
  for orgs that do.
- DevPanel error classification gives ops a single-click triage view.
- Adding a new known-error becomes a canon edit + sync, not a deploy.

## Backlog

- **Consumer-actionable errors.** Today every SE error funnels into a
  generic friendly callout that tells the consumer to "try again or
  contact your agent." Some error kinds are diagnostically useful and
  the consumer could fix them in-flow:
  - `IMP_CNTR_0068` — "VIN could not be decoded." → render with a
    "Re-enter VIN" CTA that jumps the wizard back to the vehicle
    capture step.
  - state-not-supported (regional filed-rate gap) → render with a
    "Continue without coverage" CTA so the consumer can still complete
    the rest of the workflow.
  - dealer-inactive / recipient-id-mismatch → these are operational,
    not consumer-actionable; keep the generic copy.
  Implementation path: extend `known_errors[]` schema with an optional
  `consumer_action: { cta_label, target_step }` block. Consumer-facing
  surfaces (protection-portal RecommendedCoverage callout) render the
  CTA when present; agent / super_admin surfaces show it AND the raw
  diagnostics.

- **Super-admin diagnostics in error callout.** Currently the raw
  classified error is only visible via DevPanel's 5th ApiResponsesModal
  panel. When the agent / super_admin persona is active, expose the raw
  diagnostics inline in the callout (kind, code, internal_action,
  truncated raw payload) so debugging doesn't require a second view.
  *Status: shipped 2026-05-09 (Wave 23-fu1) for super_admin only.*

## Open questions

- Should `known_errors[]` be inheritable (parent → child)? Locked
  decision says no inheritance, but error patterns are highly likely
  to repeat across child orgs of the same parent — flag for product
  if the duplication burden grows.
- How to handle rate-limit (HTTP 429) — distinct from the SOAP error
  envelope. Suggest a top-level `transport_strategy` block in a
  follow-up wave if SEFI introduces rate limits.
