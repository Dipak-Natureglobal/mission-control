# Engagement Platform Protection API Integration — Requirements

**Status:** Planning. Incoming requirements from the engagement-platform sibling repo.
**Date opened:** 2026-05-18
**Owner:** TBD — blinker-platform team
**Consumer:** engagement-platform (`~/Documents/Claude/Projects/engagement-platform`)
**Related ADRs:** 13 (StoneEagle), 02 (integration boundaries), 09 (protection-billing-config), 18 (plan-catalog), 22 (recommended-coverage-redesign)

## Context

The engagement-platform AI-dialer MVP needs to invoke Blinker domain services during a live call. Specifically: pre-call contact context, in-call vehicle confirmation, plan quotes, financing options, send-link, callback scheduling, disposition writes, objection logging.

These endpoints don't exist yet in a form that engagement-platform can consume directly. They DO exist in some form inside `blinker-legacy` — most notably the **existing CallTools→Blinker integration**: when a human agent clicks a button in CallTools, blinker-legacy is called, searches the contact by phone, and starts a new protection application. The AI-dialer wants to make the same call.

**The requested deliverable: a "legacy wrapper" API service (or package) that exposes a clean, contract-stable API over blinker-legacy's protection workflow.** When blinker-platform's native protection backend lands later, the wrapper's implementation swaps under the hood without breaking engagement-platform.

## Important conflict to resolve before this work starts

`docs/wave-20-org-config-research.md` currently says:

> `calltools_api_key` — **likely dead** (CallTools not in integrations.json registry)
> `configurations.calltools_api_key` — **likely dead** (CallTools not in integrations.json registry); confirm with product

**This is wrong as of 2026-05-18.** Chad confirmed the CallTools integration is ACTIVE in blinker-legacy and is the primary CRM the human agents use today. The button-click-to-start-application flow is live in production. wave-20-org-config-research.md needs an update:
- Remove the "likely dead" annotation on `calltools_api_key`
- Add CallTools to `canon/integrations.json` as an active provider
- Document the existing legacy CallTools integration so this engagement-platform work has a starting point

This conflict is the first thing to fix.

## Scope (Phase 1)

**In scope:**
- Protection opportunity workflow only (mechanical breakdown coverage, the StoneEagle-backed flow)
- Backwards-compatible wrapper over blinker-legacy
- Service-to-service auth (engagement-platform → wrapper → legacy)
- ~9 endpoints (full list below)

**Out of scope for Phase 1:**
- Refinance workflow (Phase 2 of engagement-platform; refi-portal already exists for human flow)
- Insurance workflow (Phase 3)
- Cross-sell orchestration (already covered by ADR 08 / Wave 31)
- A new native protection backend in blinker-platform (deferred — wrapper hides whether it's legacy or native)
- Operator UI for managing AI-agent prompts (separate concern, lives in engagement-platform or its own tool)

## Endpoints required by engagement-platform

The full contract is captured in `engagement-platform/docs/blinker-platform-api-dependencies.md`. Summary:

| # | Endpoint | Purpose | Likely legacy source |
|---|---|---|---|
| 1 | `GET /v1/contacts/by-phone/:e164/agent-context` | Pre-call hydration: contact + vehicle + history | The existing button-click endpoint's GET-side |
| 2 | `POST /v1/contacts/:id/start-protection-application` | Begin protection app from AI agent | The button-click endpoint's POST-side |
| 3 | `PATCH /v1/contacts/:id/vehicle-facts` | Update VIN/odometer/YMMT after agent confirms | New (small extension of legacy contact update) |
| 4 | `POST /v1/quotes` | Get Good/Better/Best plan tiers | Existing StoneEagle GetRates (ADR 13) |
| 5 | `POST /v1/quotes/:id/financing-options` | Monthly-payment / deductible options for a chosen tier | Existing financing-options logic |
| 6 | `POST /v1/contacts/:id/send-link` | Send tokenized SMS/email to complete sale | New — but composed of existing send-SMS, send-email, generate-token primitives |
| 7 | `POST /v1/contacts/:id/callbacks` | Schedule a follow-up | New or thin wrapper on existing scheduling |
| 8 | `POST /v1/contacts/:id/dispositions` | Set disposition (may overlap with engagement-platform's direct CallTools write) | Existing CallTools disposition write |
| 9 | `POST /v1/call-events/objections` | Log objections raised in-call for analytics | New (analytics table) |

The bulk of the work is endpoints #1 and #2 — those compose the existing CallTools-button integration into a clean contract. The rest are smaller.

## Architectural choices to make

### Where does the wrapper run?

Three reasonable shapes:

| Option | Pros | Cons |
|---|---|---|
| **A. New service in a sibling repo** (e.g., `blinker-legacy-bridge`) | Clean boundary; standalone deploy; no impact on existing blinker-platform packages | Adds another repo; CI/CD setup; observability stack |
| **B. New service inside blinker-platform** (`apps/legacy-bridge/` or `services/`) | One repo; conflicts with current "blinker-platform has no runnable code" rule | Forces a small architecture deviation |
| **C. Stay in `packages/api/` SDK** — extend the existing Phase-1-fixtures `blinkerApi` to hit legacy directly | No new service; uses the existing platform-package pattern | The SDK would need to make HTTP calls to legacy, which means each consumer (mc, engagement-platform) authenticates separately; harder to centrally rate-limit or observe |

**Initial recommendation: Option A** — a small standalone service. It mirrors how mission-control and protection-portal embed AgentView from each other (clean inter-app contracts), but for backend instead of frontend. Once blinker-platform grows native backend services, the wrapper can migrate into that fold.

### Auth model

- Engagement-platform sends a service JWT or shared-secret bearer token
- Wrapper validates, then uses its own legacy credentials to call blinker-legacy
- This means engagement-platform never holds blinker-legacy credentials — good security separation

### Idempotency

POSTs that create state (start-application, send-link, scheduling) must accept `Idempotency-Key`. Telnyx tool calls can retry on transient failure; we cannot start two applications for the same call.

### Latency budget

Engagement-platform's AI agent calls these synchronously during a live conversation. **p95 budget: 400 ms per call.** Slower causes dead air on the customer's end. The agent can fill briefly ("let me check that for you...") but only for a couple of seconds.

This implies the wrapper should not introduce more than ~50 ms over legacy's response time. If a legacy endpoint is slow, that's a legacy problem to fix or a wrapper-side caching problem to solve.

### Disposition write overlap

Engagement-platform's `disposition-writer` service (per its plan) writes dispositions directly to CallTools. If endpoint #8 here also writes through, we double-write. Three choices:

1. Engagement-platform stops writing directly; everything goes through wrapper #8
2. Wrapper #8 doesn't exist; engagement-platform writes directly; legacy reads from CallTools as it does today
3. Both exist; wrapper #8 is a thin pass-through that just calls CallTools the same way (idempotent if both arrive)

**Initial recommendation: option 2** — keep dispositions flowing directly engagement-platform → CallTools, since CallTools is already the system of record. Drop endpoint #8 from the wrapper scope unless legacy needs to react to the disposition itself.

## Legacy code review — required first step

Before writing the wrapper, someone needs to read blinker-legacy and document:

1. The exact endpoint(s) called when a human agent clicks the "start application" button in CallTools
2. The request/response shape of those endpoints
3. The contact-lookup-by-phone logic
4. The protection-application creation flow
5. The StoneEagle GetRates integration touchpoints
6. The send-SMS and send-email primitives
7. The CallTools API key location and use in legacy

Output: a doc at `docs/legacy-protection-api-survey.md` in blinker-platform with the above. Then the wrapper design proceeds against documented reality, not guesses.

Legacy code is at `~/Documents/Claude/Projects/BlinkerLegacy/` (read-only per the CLAUDE.md convention).

## Phased delivery

### Phase 1a — Legacy review + canon update
- Update `wave-20-org-config-research.md`: remove "calltools_api_key likely dead" claim; replace with confirmed-active status
- Add CallTools to `canon/integrations.json` as an active provider
- Survey blinker-legacy: write `docs/legacy-protection-api-survey.md`
- Pick wrapper architectural option (A/B/C above)

### Phase 1b — Wrapper Phase 1 endpoints (`#1`, `#2`)
- The minimum to ship engagement-platform's Wave 1 ("hello world" AI agent call → discovery)
- These are the most reused-of-existing-legacy endpoints
- Auth, idempotency, observability scaffolding

### Phase 1c — Wrapper Phase 2 endpoints (`#3`, `#4`, `#5`, `#6`)
- Unlocks engagement-platform's full sales flow (quote → financing → send-link)
- Heaviest legacy review needed here for StoneEagle quote shape

### Phase 1d — Wrapper Phase 3 endpoints (`#7`, `#9`)
- Callbacks + objection analytics
- Smaller, less business-critical

## Acceptance criteria for "this is done"

- Engagement-platform can place a call to a CallTools contact, fetch agent context, start an application, get a quote, send a personalized SMS link, and the customer can complete purchase on the existing legacy protection-portal flow — **without engagement-platform ever calling blinker-legacy directly**.
- p95 latency for synchronous in-call endpoints meets the 400 ms budget.
- Wrapper is deployed somewhere with monitoring + logging
- Auth + idempotency + rate limits are real, not stubbed

## Open questions

1. **Wrapper deploy target?** GCP Cloud Run? GKE Autopilot (alongside engagement-platform)? Heroku (where legacy runs)? Decision affects ops handoff.
2. **Will protection-portal eventually have its own backend that supersedes the legacy wrapper?** Probably yes per ADR 11 + the platform plan. The wrapper's contract should be portable to that future world.
3. **Who pays for the wrapper's runtime cost?** Not a huge number, but worth a budget line.
4. **Does legacy expose a way to fetch contacts by E.164 phone, or only by Blinker contact_id?** The agent-context endpoint needs phone-first lookup since CallTools dialer-side has the phone.
5. **Authentication between wrapper and legacy** — what does legacy accept today? Some shared API key? OAuth? Affects wrapper credential management.

## Cross-references

- engagement-platform consumer spec: `~/Documents/Claude/Projects/engagement-platform/docs/blinker-platform-api-dependencies.md`
- engagement-platform's Scenario B build plan: `~/Documents/Claude/Projects/engagement-platform/docs/scenario-b-telnyx-conv-ai-buildout.md`
- existing protection-portal AgentView: `~/Documents/Claude/Projects/protection-portal/src/views/agent` (reference for what data the workflow needs)
- StoneEagle integration: `architecture/13-stoneeagle-integration.md`
- Plan catalog: `architecture/18-plan-catalog.md`
- Integration boundaries: `architecture/02-integration-boundaries.md`
