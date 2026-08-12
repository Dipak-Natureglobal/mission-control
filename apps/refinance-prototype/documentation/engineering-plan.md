# Refinance v2 — Engineering Plan

One-page action plan for the Refinance v2 build. Read alongside `refinance-version-2-wiki.md`, which remains the canonical spec.

## What we're building, in one paragraph

Blinker's refinance workflow becomes partner-agnostic. A canonical refinance application model feeds a decision engine that routes each submission to either Gravity Lending or Savings Group (or to a disqualification state) based on org-config routing rules. Stage 1 captures data across six screens — adding Self Reported Credit and an optional co-applicant sub-flow — and Stage 2 becomes a pure result/handoff layer showing pre-approval, normalized offers, disqualification reasons, or a pending state, plus partner name and click-to-call. The embedded quote-time card stops showing static placeholders and starts rendering the live canonical result.

## Key decisions locked for v1

| # | Decision | v1 answer |
|---|---|---|
| 1 | Dual-route both partners per attempt | No — priority routing, single partner per attempt |
| 2 | No-SSN prequal | SG yes, Gravity no (hard requirement in their API) |
| 3 | Co-applicant fallback to single-applicant | Yes, with explicit `coapplicant_fallback_used` flag |
| 4 | Primary persistence record | New `refinance_applications` table; shim writes to `loan_applicants_external` for backwards compatibility |
| 5 | Stage 2 scope | Result + handoff only. No in-app full application continuation |
| 6 | SG external status mapping | Pluggable normalizer, seed mapping, passthrough fallback — no-deploy updates via sheet |
| 7 | Embedded card offer display | Best offer only, with "View all" link into Stage 2 modal |
| 8 | Click-to-call phone number | Per routing rule, not per partner |

See the wiki's "Resolved Decisions for v1" section for rationale.

## Workstream sequencing

```
W1 Canonical data model  ──►  W2 Decision engine  ──►  W3 Partner adapters  ──►  W5 CRM + analytics  ──►  W6 QA + rollout
                         └──►  W4 Frontend (mocked in parallel)  ──────────────►
```

W4 can start immediately against mocked decision-engine responses. W3a (Gravity) and W3b (Savings Group) can be parallelized across two engineers. Everything else is strictly sequenced.

## Definition of done (v1)

A submission from either surface (embedded quote card or Mission Control profile) flows end-to-end through a canonical `refinance_applications` record, the decision engine emits a routing decision with audit-able consent state, the routed adapter submits and returns a normalized result, Stage 2 renders one of four states with partner name and click-to-call, the embedded card reflects the same normalized state, and CRM receives both `platform_status` and `crm_stage` mapped through the sheet-backed normalizer. The flow runs behind `refi_v2_enabled` for one pilot org, parity against `loan_applicants_external` is confirmed for every submission during one reporting cycle, and then the shim is removed.

## Immediate next steps

1. Sign off on this plan and the wiki's "Resolved Decisions for v1" section.
2. Backend: open PR for the `refinance_applications` migration and shim scaffolding (W1).
3. Frontend: start the prototype-to-production translation using the React prototype in this folder — Stage 1 screen shells + the Stage 2 result states, wired to mocked decision responses (W4).
4. Product: confirm the routing rules and `partner_phone` values for the pilot org, and nail down which SG status values we ship the seed normalizer with.
5. Data: stand up the Stage 1 funnel dashboard skeleton so instrumentation slots in when W5 lands.

## Open items still blocked on others

- Final Savings Group status taxonomy — product + SG partner. Not blocking build; normalizer accepts unmapped values.
- Final routing rule thresholds per pilot org — product, before W6 rollout.
- Compliance sign-off on rep-attested co-applicant consent copy — legal, before W4 final consent screens.
