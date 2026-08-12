# Wiki

## Table of Contents
- [Overview](#overview)
- [Objectives and Scope](#objectives-and-scope)
- [Current-State UX and System Context](#current-state-ux-and-system-context)
  - [Embedded refinance flow](#embedded-refinance-flow)
  - [ApplyForRefinance full workflow](#applyforrefinance-full-workflow)
- [Target Product Model](#target-product-model)
- [End-to-End Workflow](#end-to-end-workflow)
- [Stage 1: Data Capture for Prequalification](#stage-1-data-capture-for-prequalification)
  - [Screen 1: Ownership Eligibility](#screen-1-ownership-eligibility)
  - [Screen 2: Auto Loan Snapshot](#screen-2-auto-loan-snapshot)
  - [Screen 3: Self Reported Credit](#screen-3-self-reported-credit)
  - [Co-Applicant Entry and Flow](#co-applicant-entry-and-flow)
  - [Screen 4: Current Housing](#screen-4-current-housing)
  - [Screen 5: Current Employment](#screen-5-current-employment)
  - [Screen 6: Identity and Consent](#screen-6-identity-and-consent)
- [Decision Engine After Identity and Consent](#decision-engine-after-identity-and-consent)
- [Stage 2: Prequalification Result, Offer Selection, and Handoff](#stage-2-prequalification-result-offer-selection-and-handoff)
  - [Stage 2 state types](#stage-2-state-types)
  - [Savings Group result handling](#savings-group-result-handling)
  - [Gravity result handling](#gravity-result-handling)
  - [Disqualification handling](#disqualification-handling)
  - [Partner handoff requirements](#partner-handoff-requirements)
- [Embedded Quote-Time Experience Requirements](#embedded-quote-time-experience-requirements)
- [Partner Routing and Organization Configuration](#partner-routing-and-organization-configuration)
- [Canonical Data Model](#canonical-data-model)
  - [Primary applicant](#primary-applicant)
  - [Co-applicant](#co-applicant)
  - [Prequal decision and result objects](#prequal-decision-and-result-objects)
- [Status Mapping and CRM Normalization](#status-mapping-and-crm-normalization)
  - [Authoritative mapping source](#authoritative-mapping-source)
  - [Refinance platform statuses](#refinance-platform-statuses)
  - [CRM stages](#crm-stages)
  - [Gravity external statuses](#gravity-external-statuses)
  - [Savings Group external statuses](#savings-group-external-statuses)
- [Persistence, Audit, and Integration Requirements](#persistence-audit-and-integration-requirements)
- [Frontend Requirements](#frontend-requirements)
- [Backend Requirements](#backend-requirements)
- [Acceptance Criteria](#acceptance-criteria)
- [Engineering Workstreams](#engineering-workstreams)
- [Open Decisions](#open-decisions)
- [Appendix](#appendix)
  - [Suggested organization routing config example](#suggested-organization-routing-config-example)
  - [Suggested canonical schema example](#suggested-canonical-schema-example)

## Overview

This document is the consolidated product and engineering specification for enhancing Blinker's refinance workflow to support both Gravity Lending and Savings Group, while restructuring the user journey into a staged prequalification-driven experience.

The goals of this wiki are:
- give engineering a single editable source of truth
- define the current-state and target-state workflows
- document canonical statuses, routing logic, data requirements, and UI behavior
- support collaboration with engineering and AI tooling in markdown form
- preserve compatibility with existing Blinker Mission Control refinance flows

This wiki is based on:
- the current embedded refinance flow in the package/quote experience
- the current ApplyForRefinance workflow from Mission Control consumer/profile
- the refinance status normalization sheet in Google Sheets
- additional product requirements provided in conversation

## Objectives and Scope

Blinker currently supports a refinance application experience integrated with Gravity Lending.

The enhancements in scope are:

1. Add Savings Group as an alternative refinance partner.
2. Normalize partner routing, statuses, and offers into a shared Blinker model.
3. Restructure the refinance workflow into a staged prequalification-based system.
4. Add self-reported credit score capture.
5. Add optional co-applicant support.
6. Route applications to Gravity or Savings Group based on organization configuration rules.
7. Show pre-approval, disqualification, or offer results after prequalification.
8. Surface partner name and click-to-call transfer to loan specialist.
9. Update the embedded quote-time experience to show real refinance result data instead of static placeholders.

Out of scope for this version unless explicitly expanded:
- full downstream funding and servicing workflows beyond current status normalization
- consumer self-service editing after partner handoff
- final Savings Group external status map if not yet finalized

## Current-State UX and System Context

### Embedded refinance flow

Today, Blinker has an embedded refinance entry point within the protection plan quoting flow. The org can show an estimated refinance payment and an Apply for Refinance CTA based on org config. The flow launches the refinance application from the quoted package context. The current design expects the user profile to later show an external loan ID and a static pending status.

### ApplyForRefinance full workflow

Today, Blinker also has a consumer-style refinance workflow launched from the Mission Control consumer/profile page. This flow progressively collects and maps the following:
- ownership status
- current lender
- monthly payment
- estimated payoff
- address and housing information
- move-in date
- employer
- employment type
- annual income
- DOB
- SSN
- disclosure and consent

The existing flow stores confirmed outbound payload data in `api_responses` and associates it with `loan_applicants_external`.

## Target Product Model

The refinance workflow should no longer be treated as Gravity-specific.

Blinker should instead operate as:
- a canonical refinance application model
- a partner orchestration layer
- a partner adapter layer
- a normalized status and CRM mapping layer
- a reusable staged UI flow
- an embedded quote-time status/result surface

In this architecture:
- Gravity becomes one partner adapter
- Savings Group becomes a second partner adapter
- UI and persistence use Blinker-owned canonical models

## End-to-End Workflow

The target workflow is:

1. Agent starts refinance from one of two surfaces:
   - quote/package embedded refinance CTA
   - Mission Control consumer/profile ApplyForRefinance entry
2. User completes Stage 1 data capture.
3. After Identity + Consent, the system runs decision logic.
4. The system checks:
   - consent to soft credit pull
   - whether SSN is present or absent
   - whether co-applicant is present and consented
   - organization routing rules
5. The system routes to:
   - Gravity
   - Savings Group
   - or no partner if disqualified / not eligible
6. Stage 2 shows:
   - pre-approval or disqualification result
   - returned offers if applicable
   - partner name
   - click-to-call partner phone link
   - next best action
7. Embedded quote-time experience displays normalized result state after return.

## Stage 1: Data Capture for Prequalification

Stage 1 is the set of screens completed before the backend performs soft-pull/prequalification routing.

### Screen 1: Ownership Eligibility

Purpose:
- determine whether the vehicle is eligible for refinance workflow entry

Field:
- ownership status

Eligible values:
- Financed - Making Payments
- Leased - Making Payments

If any other value is selected:
- block progression
- show an eligibility message
- do not submit prequalification request

Normalized platform status:
- `Ownership Eligibility`

### Screen 2: Auto Loan Snapshot

Purpose:
- collect current loan context for prequalification

Fields:
- current lender
- monthly payment
- estimated payoff

Rules:
- fields may remain optional if partner routing allows it
- skip behavior may remain if compatible with partner requirements
- values must map to the canonical `current_loan` object

Normalized platform status:
- `Auto Loan Snapshot`

### Screen 3: Self Reported Credit

This is a new required view immediately after Auto Loan Snapshot.

Purpose:
- capture user-friendly credit band
- support routing logic, offer likelihood, and analytics

Field:
- `self_reported_credit_score_range`

Allowed values:
- `300_579` = 300–579: Poor / Very Poor
- `580_669` = 580–669: Fair
- `670_739` = 670–739: Good
- `740_799` = 740–799: Very Good
- `800_850` = 800–850: Exceptional

Rules:
- single-select input
- required unless org config explicitly disables it
- persist both raw label and normalized enum
- include in canonical prequal payload even if a given partner does not consume it directly

Normalized platform status:
- `Self Reported Credit`

### Co-Applicant Entry and Flow

A co-applicant option must be added to Stage 1.

Recommended placement:
- immediately after Self Reported Credit

Entry pattern:
- screen or toggle asking whether the application includes a co-applicant

Recommended prompt:
- Will there be a co-applicant on this refinance application?

Options:
- Yes
- No

If No:
- continue to Current Housing

If Yes:
- insert the co-applicant sub-flow before resuming the main applicant flow

#### Co-Applicant View 1: Contact Info

Fields:
- first name
- last name
- phone
- email

Assumption:
- co-applicant uses the same address as the primary applicant

Rules:
- no separate address screen in this version
- validate phone and email independently
- persist to canonical `co_applicant.contact`

#### Co-Applicant View 2: Identity

Fields:
- DOB
- SSN if required or available

Rules:
- map to canonical `co_applicant.identity`
- partner adapters decide whether both fields are required at prequal or only later

#### Co-Applicant View 3: Employment

Fields:
- employer name
- employment type
- annual income
- start date optional

Rules:
- use same employment enum model as primary applicant
- convert start date into employer years/months if provided
- persist to canonical `co_applicant.employment`

#### Co-Applicant Consent Rule

Consent will be assumed from both applicant and co-applicant when co-applicant is present.

Requirements:
- UI may use a single consent confirmation step
- backend must store explicit separate consent fields for:
  - primary applicant
  - co-applicant
- store a consent capture method such as `rep_attested`
- store timestamp and disclosure version

### Screen 4: Current Housing

Purpose:
- collect residence data used for lender matching and underwriting

Fields:
- address
- city
- state
- zip
- housing ownership status: Own / Rent / Other
- move-in date

Rules:
- address is required
- move-in date should be converted into months at residence
- use same current mapping model as existing Gravity workflow unless canonical schema improves it

Normalized platform status:
- `Current Housing`

### Screen 5: Current Employment

Purpose:
- collect employment and income data needed for prequalification

Fields:
- employer name
- employment type
- annual income
- start date optional

Rules:
- use current employment type enum logic
- convert start date into employer years/months if supplied
- persist into canonical employment model

Normalized platform status:
- `Current Employment`

### Screen 6: Identity and Consent

Purpose:
- collect identity and consent information needed for submission

Primary applicant fields:
- DOB
- SSN
- disclosure confirmation
- soft-pull / privacy / TCPA-related consent fields as required

Rules:
- DOB required unless partner rules allow otherwise
- SSN may be optional if partner supports prequal without SSN
- disclosure acceptance required to proceed
- persist identity and consent to canonical model

Normalized platform status:
- `Identity and Consent`

## Decision Engine After Identity and Consent

After Identity + Consent, the backend executes the decision engine.

This is the transition point between Stage 1 and Stage 2.

The system must evaluate:
- whether the consumer gave consent to soft credit pull
- whether SSN is present or absent
- whether a co-applicant exists
- whether co-applicant consent is present
- whether there is enough data to submit to partner
- which partner matches org-level routing criteria

Possible outcomes:
1. route to Gravity
2. route to Savings Group
3. route to neither and show disqualification
4. optionally dual-route in a future version

### Consent logic

Case A:
- consent present and SSN present
- eligible for full soft-pull submission if partner permits

Case B:
- consent present and SSN absent
- eligible only if selected partner supports no-SSN prequalification
- otherwise show additional info required or disqualification

Case C:
- consent absent
- do not submit to partner
- show cannot proceed state

Case D:
- co-applicant present
- require both primary and co-applicant consent before joint submission
- business rule may allow fallback to single-applicant path if designed later

The decision engine must persist:
- `soft_pull_consent_primary`
- `soft_pull_consent_coapplicant`
- `ssn_present_primary`
- `ssn_present_coapplicant`
- `eligible_for_submission`
- `prequal_submission_eligibility_reason`
- `routed_partner`
- `routing_rule_id`

## Stage 2: Prequalification Result, Offer Selection, and Handoff

Stage 2 begins immediately after the system runs decision logic and attempts prequalification routing.

Stage 2 is the result layer, not another data-capture stage.

This screen family should show:
- pre-approval result or disqualification
- offers if returned
- partner identity
- click-to-call loan specialist handoff
- next action CTA

### Stage 2 state types

Stage 2 should support the following result states:

1. Pre-approved / prequalified
2. Offers returned
3. No offer / disqualified
4. Waiting / pending async response

### Savings Group result handling

If routed to Savings Group and offers are returned, the UI must:
- display normalized offers
- allow the user or agent to select one
- persist selected offer
- display the partner name
- display click-to-call link using `tel:`
- support next action and transfer messaging

Offer card fields should support:
- lender name
- APR
- term
- estimated monthly payment
- estimated monthly savings
- disclaimer text
- select CTA

When an offer is selected:
- normalized platform status becomes `Offer Selected`
- normalized CRM stage should remain consistent with refinance mapping, typically `Working`

### Gravity result handling

If routed to Gravity and the result is more application-state oriented than marketplace-offer oriented, the UI should show:
- Gravity as partner
- pre-approval / working / rejected message
- partner phone number with click-to-call link
- external application ID if available
- next best action

If Gravity external status is present, it must normalize through the mapping table.

### Disqualification handling

If the user cannot be submitted or does not qualify, show:
- partner name if routing attempt occurred
- clear disqualification or no-offer reason
- whether retry or escalation is possible

Possible reasons include:
- no consent to soft credit pull
- SSN required but not provided
- state not eligible
- annual income outside config range
- vehicle value outside config range
- payoff outside config range
- credit score outside config range
- partner returned no offers
- partner rejected request

Persist:
- `prequal_result = disqualified`
- `prequal_disqualification_reason_code`
- `prequal_disqualification_reason_message`

### Partner handoff requirements

Stage 2 must show:
- partner name
- partner phone number
- click-to-call link using `tel:##########`
- handoff messaging such as “Speak with a loan specialist”

This is a hard requirement.

## Embedded Quote-Time Experience Requirements

The embedded quote/package experience must be updated to show live normalized refinance result data instead of only static pending-style placeholders.

After Stage 1 / Stage 2 prequal flow returns, the embedded surface should show:
- normalized platform status
- partner name
- partner phone number with click-to-call link if appropriate
- external application ID
- whether co-applicant was included
- best offer summary if available
- pre-approval or disqualification summary
- continue application CTA if additional steps remain
- view offer CTA if Savings Group offers are present

Suggested embedded fields:
- `status_badge`
- `partner_name`
- `partner_phone`
- `external_application_id`
- `prequal_result_state`
- `best_offer_monthly_payment`
- `best_offer_apr`
- `best_offer_term`
- `estimated_monthly_savings`
- `disqualification_reason_message`
- `continue_application_cta`

## Partner Routing and Organization Configuration

Routing must be driven by org configuration, not hardcoded.

The org configuration may include thresholds and inclusion rules for:
- annual income range
- vehicle value range
- vehicle payoff range
- credit score range
- state of residence

If multiple partners match:
- use configured priority
- or dual-route in a future version

Rule precedence should be explicit:
1. partner enabled for org
2. state eligibility
3. credit score range
4. annual income range
5. vehicle value range
6. vehicle payoff range

Because Stage 1 captures credit score bands, the routing logic may evaluate:
- the enum directly
- or inferred numeric min/max bounds

## Canonical Data Model

### Primary applicant

Minimum canonical applicant fields should support:
- first_name
- last_name
- phone
- email
- address_1
- city
- state
- zip
- own_rent
- months_at_residence
- employer_name
- employment_type
- annual_income
- income_frequency
- employer_years
- employer_months
- dob
- ssn
- self_reported_credit_score_range
- consent booleans
- disclosure version and timestamps

### Co-applicant

Canonical co-applicant should support:
- has_co_applicant
- contact
- identity
- employment
- consent

### Prequal decision and result objects

The application model should also contain:
- decision object
- prequal result object
- partner routing object
- selected offer object
- raw partner state object

## Status Mapping and CRM Normalization

### Authoritative mapping source

The refinance status model is sourced from the Google Sheet:
- spreadsheet title: `GHL Blinker Configuration`
- sheet: `status`

For refinance:
- use rows where `crm_opportunity = REFI - Prospects {1 or 2 or 3}`
- `platform_status` is Blinker normalized status
- `crm_stage` is normalized GHL pipeline stage
- `status_external` maps Gravity statuses
- `status_external_2` is reserved for Savings Group statuses

### Refinance platform statuses

The mapping sheet defines or supports at least these refinance platform statuses:
- `Started`
- `New Lead`
- `Ownership Eligibility`
- `Auto Loan Snapshot`
- `Self Reported Credit`
- `Current Housing`
- `Current Employment`
- `Identity and Consent`
- `Duplicate`
- `Prequalification Submitted`
- `Offers Returned`
- `Offer Selected`
- `Working - Waiting on Customer`
- `Working - Waiting for Data`
- `Working - Rejected`
- `Working - No Contact`
- `Working - Incorrect Info`
- `Working - Approved`
- `Applied`
- `Not Interested`
- `Not Interested - Approved`
- `Not Interested - Applied`
- `Declined`
- `Pending Funding`
- `Funded`

### CRM stages

Normalized refinance CRM stages include:
- `New Lead`
- `Duplicate Lead`
- `Working`
- `Applied`
- `Lost`
- `Won`

Engineering must output both:
- normalized `platform_status`
- normalized `crm_stage`

They are not the same thing.

### Gravity external statuses

Gravity external statuses are mapped from `status_external` in the sheet and include values such as:
- `New Applications`
- `Waiting for Data`
- `Rejected`
- `Cancelled`
- `Lender Approved`
- `Sent to Lender`
- `Underwriting`
- `At Customer`
- `Sent to DMV`
- `Ordering Duplicate Title`
- `Title Rejected`
- `Ready to Book`
- `Pending Payoff`
- `Funded ATD`
- `Perfected`

### Savings Group external statuses

Savings Group external status mapping is not yet finalized.

Requirements:
- support `status_external_2`
- support `status_external_partner_2`
- build normalization engine so Savings Group mapping can be added without major code refactor
- avoid hardcoding all partner normalization logic directly in application code

## Persistence, Audit, and Integration Requirements

Maintain current persistence patterns where possible while moving to a richer canonical model.

Persist at minimum:
- canonical refinance application record
- source entry context:
  - embedded quote flow
  - profile ApplyForRefinance flow
- raw outbound request payload
- raw inbound response payload
- partner name
- external application ID
- selected offer ID
- normalized platform status
- normalized CRM stage
- raw external status
- disqualification reason code
- disqualification reason message
- created_at / updated_at timestamps
- initiating user / agent
- decision engine outputs
- consent metadata
- co-applicant presence and joint-consent metadata

Existing persistence notes:
- `api_responses` remains useful for raw request/response storage
- current association with `loan_applicants_external` can remain if backward compatibility is required
- consider adding a richer refinance application table if the existing structure becomes too limiting

## Frontend Requirements

Frontend must support:
- Stage 1 screen flow
- new Self Reported Credit screen
- co-applicant decision and sub-flow
- primary applicant identity + consent
- dynamic requiredness based on partner and stage
- Stage 2 result states
- Savings Group offer cards and selection
- partner name + click-to-call display
- disqualification messaging
- embedded quote-time result rendering
- save/resume behavior where applicable

Reusable component types should include:
- single-select choice screen
- numeric input screen
- address screen
- date input screen
- consent/disclosure modal
- offer result card
- disqualification result card
- embedded refinance summary card

## Backend Requirements

Backend must support:
- canonical refinance schema
- partner adapters:
  - Gravity adapter
  - Savings Group adapter
- decision engine after Identity + Consent
- config-driven routing
- self-reported credit field support
- co-applicant support
- separate consent storage for applicant and co-applicant
- normalized status mapping engine
- separate `platform_status` and `crm_stage`
- raw external status storage
- partner phone metadata for handoff
- offer normalization and selection persistence
- disqualification reason normalization
- embedded summary API support

## Acceptance Criteria

### Stage 1

- user can complete Ownership Eligibility
- user can complete Auto Loan Snapshot
- user must complete Self Reported Credit unless disabled by config
- user can add a co-applicant
- co-applicant contact, identity, and employment fields are captured when selected
- primary applicant identity and consent are captured
- separate primary and co-applicant consent fields are persisted

### Decision Engine

- system checks consent and SSN logic after Identity + Consent
- system evaluates organization routing rules
- system selects Gravity, Savings Group, or no partner
- decision outputs are persisted

### Stage 2

- if Savings Group returns offers, offers are displayed and selectable
- if Gravity returns state-based result, it displays normalized result and handoff info
- if disqualified, clear reason is shown
- partner name and click-to-call link are shown
- external application ID is shown when available

### Status and CRM

- platform status maps correctly
- CRM stage maps correctly
- Gravity external statuses normalize through the mapping model
- Savings Group mapping can be added through the reserved external status fields

### Embedded Experience

- embedded quote-time card displays real refinance result data
- static pending placeholder is replaced by normalized state
- best offer or disqualification summary is shown
- partner handoff metadata is shown where applicable

## Engineering Workstreams

Workstreams are sequenced by dependency. Some can be parallelized where noted.

### Workstream 1: Canonical data model and persistence (must land first)
Owner: Backend. Blocks: 2, 3, 5.

- Finalize canonical schema per the "Canonical Data Model" and appendix example.
- Create `refinance_applications` table as the primary record.
- Write the `loan_applicants_external` backwards-compat shim (dual-write for v1, read still allowed for legacy consumers).
- Migrate `api_responses` association: keep `subject_type = LoanApplicantsExternal` writes, add parallel writes keyed on `refinance_applications.id` behind a feature flag.
- Add the `self_reported_credit_score_range` column and enum.
- Add co-applicant tables or nested JSONB columns for contact/identity/employment/consent.
- Add consent metadata columns: `soft_pull_consent_primary`, `soft_pull_consent_coapplicant`, `consent_capture_method`, `disclosure_version`, timestamps.

### Workstream 2: Decision engine and routing (depends on 1)
Owner: Backend. Blocks: 3, 4, 5.

- Implement consent + SSN logic per the "Consent logic" section (Cases A–D).
- Implement org-config-driven partner routing with the explicit precedence: partner enabled → state → credit score → income → vehicle value → payoff.
- Implement disqualification reason emission (`prequal_disqualification_reason_code`, `_message`).
- Emit decision engine outputs into `prequal_decision` on the canonical record.
- Unit tests covering: full consent+SSN → Gravity; consent no-SSN → SG fallback; no consent → disqualified; co-applicant fallback → single-applicant path; no routing rule matches → disqualified.

### Workstream 3: Partner adapters (depends on 1, 2; 3a/3b parallelizable)
Owner: Backend.

- **3a Gravity adapter:** adapt existing implementation to read canonical model. Confirm every field in the Gravity API data dictionary still maps. Normalize Gravity external statuses via the mapping sheet (see Status Mapping section).
- **3b Savings Group adapter:** new implementation. Contract for submit, fetch-offers, select-offer. Offer normalization into the canonical `offer` shape (lender_name, apr, term_months, monthly_payment, estimated_monthly_savings, disclaimer).
- **3c Pluggable `PartnerStatusNormalizer`:** loads mappings from `GHL Blinker Configuration` sheet; supports unmapped passthrough with telemetry alert.

### Workstream 4: Frontend (depends on 1; can start mocked in parallel with 2/3)
Owner: Frontend.

- Stage 1 screen flow refactor. Reuse single-select, numeric, address, date, consent primitives.
- New Self Reported Credit screen.
- Co-applicant decision screen + 3-view sub-flow (contact, identity, employment).
- Primary applicant Identity + Consent with single-consent-confirms-both UI when co-applicant present.
- Stage 2 result screens with four states: pre-approved, offers_returned, disqualified, pending.
- Offer cards + selection for Savings Group.
- Embedded quote-time result card update (replace static PENDING placeholder with live canonical state).
- Save/resume behavior on Stage 1.

### Workstream 5: CRM, analytics, and status mapping (depends on 1, 2, 3)
Owner: Backend + Data.

- Push normalized `platform_status` and `crm_stage` to GHL.
- Instrument Stage 1 step-completion and fallout events.
- Instrument routing decision, offers returned count, offer selected, disqualification reason, handoff click-to-call click.
- Build the `status_external_2` loader for Savings Group so new mappings can ship without a deploy.
- Dashboards: Stage 1 funnel, Stage 2 state distribution, partner split, disqualification reason breakdown.

### Workstream 6: QA, rollout, and cleanup (depends on everything)
Owner: QA + Eng.

- Behind an org-level feature flag `refi_v2_enabled`.
- Dogfood with one pilot org before wider rollout.
- Parity check: for every refi submitted in the pilot, confirm the legacy `loan_applicants_external` row matches the new `refinance_applications` row via the shim.
- After one full reporting cycle with parity, remove the shim and close out the legacy write path.

## Risks and Mitigations

- **Savings Group integration unknowns.** Their status taxonomy and offer shape are still moving. Mitigation: pluggable normalizer (W3c), passthrough fallback, and a feature flag per-partner so we can ship with Gravity-only if SG slips.
- **Double soft-pull risk.** If a user retries Stage 1 after partial failure, the decision engine must dedupe submissions within a short TTL window (recommend 10 minutes keyed on `application_id`). Mitigation: idempotency key on partner submit.
- **`loan_applicants_external` drift.** Dual-writing is fragile. Mitigation: parity check job in W6, and strict removal criteria before decommissioning the shim.
- **Consent provenance for co-applicant.** Rep-attested consent for a non-present third party has compliance risk. Mitigation: store the `consent_capture_method` explicitly, require the agent to tick a separate co-applicant consent confirmation in the UI even when the prompt is combined, and log disclosure_version on both applicant and co-applicant records.
- **Embedded card staleness.** If the embedded card reads from a cached prequal_result, a user returning to the quote tab may see stale status. Mitigation: the embedded summary endpoint should read the canonical record live and include `updated_at`, with a short client-side refresh on focus.

## Resolved Decisions for v1

The following items were open during spec drafting and have been resolved for the v1 build. Rationale is included so future-you can re-open them if assumptions change.

1. **Dual-run Gravity and Savings Group in the same prequal attempt?** **No for v1.** Use priority routing from the routing_rules list. Dual-route is deferred to a later version to avoid double soft-pulls, duplicate offers in the UI, and ambiguous CRM state. The decision engine picks exactly one `routed_partner` per submission attempt.

2. **No-SSN prequalification per partner?**
   - **Savings Group: allowed.** SG is treated as a marketplace soft-pull partner that can prequalify without SSN when consent is present. Offers may be thinner.
   - **Gravity: not allowed.** Per the Gravity Application API docs (see `Gravity-Application API.pdf`), `applicant SSN` is on the hard-error list. If SSN is missing and the routing rules point to Gravity, the decision engine must fall through to SG (if eligible) or emit a disqualification with reason `ssn_required_for_partner`.

3. **Co-applicant fallback to single-applicant submission?** **Yes, allowed.** If the primary applicant has full consent + data but the co-applicant is missing consent or required fields, Stage 2 offers a "Submit as single applicant" CTA rather than silently dropping the co-applicant. Backend flags this as `coapplicant_fallback_used = true` so CRM can see it.

4. **Keep `loan_applicants_external` or introduce a new table?** **Introduce a new `refinance_applications` table as the primary canonical record.** Keep `loan_applicants_external` writes via a backwards-compat shim so existing reporting, Gravity adapters, and CRM pipelines keep working. New code reads from `refinance_applications`. The shim is marked for removal after one full reporting cycle confirms parity.

5. **Stage 2 scope in v1?** **Prequal result + partner handoff only.** v1 does not implement a downstream in-app full-application continuation. After offer selection or pre-approval, Stage 2 hands off via click-to-call + partner link. Downstream flows remain on the partner's side. In-app full-application is a v2 candidate.

6. **Savings Group external statuses?** **Ship a pluggable normalizer with a provisional seed map.** Build a `PartnerStatusNormalizer` service that loads mappings from the `GHL Blinker Configuration` sheet (column `status_external_2`). Ship with whatever SG values we have at build time; unmapped SG statuses fall through to raw-passthrough with a telemetry alert so product can fill them in without a deploy.

7. **Embedded experience: best offer or all offers?** **Best offer only on the embedded quote-time card**, with a "View all offers" CTA that opens Stage 2 in a modal (reusing the Stage 2 offer-list component). Keeps the embedded card visually compact and matches the existing embedded design language.

8. **Click-to-call phone: static per partner or per-org/routing-rule?** **Per routing-rule.** The `partner_phone` field lives on each `routing_rule` in the org config (see appendix example). Different orgs can route to the same partner through different phone numbers. The frontend reads `prequal_result.partner_phone` directly — it never hardcodes a partner-level phone.

## Out of scope for v1 (explicitly deferred)

- Dual-partner submission, offer aggregation across partners.
- In-app downstream full application continuation after handoff.
- Consumer self-service editing after Stage 1 submission.
- OCR / doc upload flows for stips / verifications.
- SMS/email drip automation tied to new `platform_status` values (CRM should continue to trigger off `crm_stage`).
- Savings Group external status mapping finalization (seed now, iterate without a deploy).

## Appendix

### Suggested organization routing config example

```json
{
  "refi_services": {
    "default_partner_mode": "priority_routing",
    "routing_rules": [
      {
        "id": "sg_ga_580plus",
        "partner": "savings_group",
        "enabled": true,
        "state_in": ["GA", "FL", "SC"],
        "annual_income_min": 30000,
        "annual_income_max": 250000,
        "vehicle_value_min": 8000,
        "vehicle_value_max": 75000,
        "vehicle_payoff_min": 5000,
        "vehicle_payoff_max": 65000,
        "credit_score_min": 580,
        "credit_score_max": 850,
        "partner_phone": "18005551212",
        "priority": 1
      },
      {
        "id": "gravity_general",
        "partner": "gravity",
        "enabled": true,
        "state_in": ["GA", "FL", "SC", "NC", "TX"],
        "annual_income_min": 25000,
        "annual_income_max": 250000,
        "vehicle_value_min": 5000,
        "vehicle_value_max": 100000,
        "vehicle_payoff_min": 3000,
        "vehicle_payoff_max": 85000,
        "credit_score_min": 500,
        "credit_score_max": 850,
        "partner_phone": "18005559876",
        "priority": 2
      }
    ]
  }
}
```

### Suggested canonical schema example

```json
{
  "application_id": "BLINKER-REFI-123",
  "entry_surface": "embedded_quote",
  "has_co_applicant": true,
  "applicant": {
    "first_name": "",
    "last_name": "",
    "phone": "",
    "email": "",
    "address": {
      "address_1": "",
      "city": "",
      "state": "",
      "zip": ""
    },
    "housing": {
      "own_rent": "",
      "months_at_residence": null
    },
    "employment": {
      "employer_name": "",
      "employment_type": "",
      "annual_income": null,
      "income_frequency": "Annually",
      "employer_years": null,
      "employer_months": null
    },
    "identity": {
      "dob": "",
      "ssn": "",
      "self_reported_credit_score_range": "670_739"
    },
    "consent": {
      "soft_pull_consent": true,
      "tcpa_consent": true,
      "privacy_consent": true,
      "disclosure_version": "v1",
      "consent_capture_method": "rep_attested",
      "consented_at": ""
    }
  },
  "co_applicant": {
    "contact": {
      "first_name": "",
      "last_name": "",
      "phone": "",
      "email": "",
      "same_address_as_applicant": true
    },
    "identity": {
      "dob": "",
      "ssn": ""
    },
    "employment": {
      "employer_name": "",
      "employment_type": "",
      "annual_income": null,
      "employer_years": null,
      "employer_months": null
    },
    "consent": {
      "soft_pull_consent": true,
      "consent_capture_method": "rep_attested",
      "consented_at": ""
    }
  },
  "vehicle": {
    "ownership_status": "",
    "value": null
  },
  "current_loan": {
    "current_lender": "",
    "monthly_payment": null,
    "estimated_payoff": null
  },
  "prequal_decision": {
    "eligible_for_submission": true,
    "prequal_submission_eligibility_reason": "matched_org_config_rule",
    "routed_partner": "savings_group",
    "routing_rule_id": "sg_ga_580plus",
    "ssn_present_primary": true,
    "ssn_present_coapplicant": false
  },
  "prequal_result": {
    "result_type": "offers_returned",
    "partner_name": "Savings Group",
    "partner_phone": "18005551212",
    "external_application_id": "SG-12345",
    "disqualification_reason_code": null,
    "disqualification_reason_message": null
  },
  "selected_offer": {
    "offer_id": "",
    "lender_name": "",
    "apr": null,
    "term_months": null,
    "monthly_payment": null,
    "estimated_monthly_savings": null
  },
  "status": {
    "platform_status": "Offer Selected",
    "crm_stage": "Working",
    "raw_external_status": ""
  }
}
```
