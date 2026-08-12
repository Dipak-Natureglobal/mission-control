# 06 — Embedded Insurance Contract

> The authoritative integration boundary between Blinker and Embedded Insurance (EI). Source of truth for what EI actually does, what we do, and where the seam lives. Reference EI partner docs at `insurance-portal/docs/embedded-insurance/` (the zip from EI: `EI_Blinker_API_docs_v1.zip`).
>
> **Status:** v1 captured 2026-05-03 from EI partner docs (`Blinker_Verify_Webhook_Response_v1.md` + Postman collection). Sandbox creds + webhook secret pending partner onboarding.

## TL;DR

EI hosts the entire consumer-facing flow on their microsite. Blinker's role is server-side: create leads, request consumer links, listen to webhooks, and surface state back through the agent dashboard and CRM. We do NOT host capture forms, quote review screens, or bind UIs in production. The customer-view screens in `insurance-portal/src/views/customer/` are demoware that simulate what EI's microsite would show; they are not the production architecture.

## Architecture flip (corrects prior assumption)

Earlier prototype iterations assumed Blinker hosted the consumer flow (CaptureForm + QuoteReview + PolicyBound on our surface, with EI as a backend-only quote engine). The real EI contract inverts this:

```
Blinker server                      Consumer's browser                EI
─────────────                       ─────────────────                  ──
POST /auto/v1/leads      ──────────────────────────────────────→
  ←── { leadId, ... }    ←──────────────────────────────────────

POST /leads/:id/get-link ──────────────────────────────────────→
  ←── { url: <one-time> }←──────────────────────────────────────

(Blinker SMS/email)      ──────────→
                                      navigates to one-time URL ─→
                                      <consumer flows through
                                       capture → quote → bind on
                                       EI's hosted microsite>

  ←── webhook: lead_summary { status: verification.completed, summary: { insuranceVerification } }
  ←── webhook: lead_summary { status: quote.completed, summary: { quote, insuranceVerification } }
  ←── webhook: lead_summary { status: quote.viewed, summary: { quote } }
  ←── webhook: lead_summary { status: policy.bound, summary: { policy } }
```

The consumer never lands on a Blinker URL during the insurance flow. Blinker is a webhook subscriber and an agent dashboard.

## API endpoints

Base URL: `https://api.embeddedinsurance.com`
Auth URL: `https://auth.embeddedinsurance.com/oauth2/token`

### POST /auto/v1/leads — Create a lead

Auth: `Authorization: Bearer <access_token>` (OAuth2 client credentials).

Required body fields:
- `applicant` — primary applicant: `firstName`, `lastName`, `dateOfBirth` (`YYYY-MM-DD`), `address` (`address1`, `city`, `state` (2-letter), `zip` (5-digit)), `phoneNumber` (`+1` + 10 digits), `email`.
- `vehicles` — keyed map `1..9`. First vehicle required: `make`, `model`, `year`. VIN, trim, mileage, lien details optional.

Optional body fields:
- `applicant.priorAddress`, `monthsAtAddress`, `gender`, `licenseNumber`, `licenseState`, `yearsLicensed`, `educationLevel`, `residenceOwnershipType`, `maritalStatus`, `income[]`, `creditIndicator`.
- `coapplicants` — keyed map `1..9` with `firstName`, `lastName`, `dateOfBirth`, optional `relationshipToApplicant`, etc.
- `partnerBrand` — string used to brand EI's microsite ("Blinker" passed in our case).
- `partnerData` — free-form object for our analytics: e.g. `{ "sourceSystem": "PartnerPortal", "campaignId": "..." }`.
- `isTest` — boolean. `true` for sandbox.

Returns: `{ leadId, ... }` (full shape pending real call; see Postman collection).

Error path: 4xx — duplicate lead, missing data, validation errors. Per EI: "duplicate lead received" returns synchronously, NOT as a webhook. Adapter must handle the 4xx-on-create path before any webhook subscription is set up.

### POST /auto/v1/leads/:id/get-link — Get one-time consumer link

Auth: same.
Body: `{ "partnerBrand": "Blinker" }` — optional brand override per request.
Returns: `{ url: "https://..." }` — a one-time URL. Send this to the consumer via SMS/email; the consumer follows it to EI's microsite.

### GET /auto/v1/health — health check

For ops monitoring.

## Webhook contract

Single endpoint on Blinker side (we register it with EI during onboarding). All events flow through `lead_summary` event type.

### Headers

- `X-Webhook-Signature: <hex>` — HMAC SHA256 of the request body, with the shared secret EI provides during onboarding. Adapter MUST verify.

### Verification (TypeScript reference, paraphrased from EI docs)

```ts
const expected = crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
const valid = crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
```

### Event envelope

Every webhook is shaped as:

```ts
{
  id: string,                    // event ID
  leadId: string,                // EI's lead ID
  partnerExternalId: string,     // our reference, set on POST /leads via partnerData
  eventType: "lead_summary",     // always this value (v1)
  eventTime: string,             // ISO 8601
  status: "verification.completed" | "quote.completed" | "quote.viewed" | "policy.bound" | "error",
  summary: {
    insuranceVerification?: {...},
    quote?: {...},
    policy?: {...}
  }
}
```

### Status discriminators

| `status`                  | summary contains                                | Blinker machine_id (canon) |
|---------------------------|-------------------------------------------------|----------------------------|
| `verification.completed`  | `insuranceVerification` (required)              | `capture.completed`        |
| `quote.completed`         | `quote` (required), maybe `insuranceVerification` | `quote.completed`        |
| `quote.viewed`            | `quote` (required)                              | `quote.viewed`             |
| `policy.bound`            | `policy` (required)                             | `policy.bound`             |
| `error`                   | partial data depending on phase                 | `error.verification` or `error.quote` (see below) |

### Error disambiguation

EI fires a single `error` status for any failure. The summary block discriminates which phase failed:

| summary contents                                    | Blinker machine_id  |
|-----------------------------------------------------|---------------------|
| `{}` (empty)                                        | `error.verification`|
| `{ insuranceVerification }` only                    | `error.verification`|
| `{ insuranceVerification, quote }` or `{ quote }`   | `error.quote`       |

Blinker keeps the split as our internal taxonomy because verification-stage and quote-stage failures have different agent recovery actions (retry verification vs. retry quote vs. drop the lead).

### Sub-payload shapes

See `canon/ghl-fields.json` blocks: `_insurance_verification_shape`, `_insurance_quote_shape`, `_insurance_policy_shape`. Those are the authoritative shapes for `summary.insuranceVerification`, `summary.quote`, `summary.policy`.

## Flow paths

EI supports two paths, both kicked off via the same POST /leads + /get-link endpoints:

### Capture + Quote (preferred)

Webhook sequence: `verification.completed` → `quote.completed` → `quote.viewed` → `policy.bound`.

Why preferred: EI computes savings against the captured current policy, returns `savingsAmountCents` on the quote. That's the headline number Blinker uses to convert the consumer.

### Quote Only (escape hatch)

Webhook sequence: `quote.completed` → `quote.viewed` → `policy.bound` (no verification.completed).

When to use: consumer doesn't have their insurance card handy / won't tolerate the OCR step / agent has already collected enough data to skip capture.

`savingsAmountCents` may be absent or `null` since there's no baseline. Agent UI must handle the no-savings case.

### Path selection — TBD

How Blinker tells EI to use Quote Only is not specified in the v1 docs. Candidates:
- A `partnerData.flowPath: "quote_only"` hint on POST /leads
- A flag on POST /leads/:id/get-link
- A separate endpoint
- EI infers from the consumer's choices on the microsite (least likely; would mean both flows go through the same wire and we discriminate by which webhooks land)

**Action item:** confirm with EI partner contact and document the answer here. Until then, the agent UI surfaces the toggle but the adapter has no real route.

## Money + locale conventions

- All currency in **cents** (integer). `totalPremiumCents`, `savingsAmountCents`.
- No currency field documented; assume USD.
- No premium period field. Assume **6 months** for auto policies. Verify with EI; until confirmed, all UI labels say "/ 6mo" not "/ year".

## Annualization helper

UI often wants annualized savings ("$X/year"). Helper convention:

```js
function annualizeFromCents(cents, period = '6mo') {
  if (period === '6mo')    return (cents * 2) / 100;
  if (period === '12mo')   return cents / 100;
  if (period === 'monthly')return (cents * 12) / 100;
  return cents / 100;
}
```

Until period is confirmed by EI, default `'6mo'` everywhere and centralize the helper in `insurance-portal/src/lib/money.js`.

## What this means for our prototype

The customer-view in `insurance-portal/src/views/customer/` (`CaptureForm`, `QuoteReview`, `PolicyBound`, `SavingsCard`, `GettingQuote`) doesn't reflect production architecture. Two ways forward:

1. **Reframe as EI-microsite simulator** — keep the screens, label them as "what the consumer sees on EI's microsite (Phase 1 demoware)". The flow becomes: agent generates link → DEV CONTROLS opens that URL → simulator screens approximate EI's flow → in production this runs on EI's domain.
2. **Drop customer-view entirely** — `?view=customer` becomes a DEV CONTROLS-only path that triggers webhooks for the agent view to consume.

Recommended: option 1 for demo coherence, with prominent labeling that says "EI microsite simulator (production this is hosted by EI)". The simulator screens become the answer to "what does the consumer experience" without misleading anyone about who hosts what.

The agent view in `insurance-portal/src/views/agent/` is the production-shaped surface and stays as built (with the canon-adaptation cleanups already queued). It POSTs (mocked) to EI, gets a link, sends it, watches webhooks land.

## SavingsCard + protection-portal cross-sell

`SavingsCard` was extracted as `src/views/customer/SavingsCard.jsx` for protection-portal's Confirm screen to import. Its `quote` prop shape needs to match our `_insurance_quote_shape` in canon — i.e. consume `totalPremiumCents` + `savingsAmountCents`, not the legacy `{ amount, currency, period }` shape. Update the prop interface during the public-export pass.

## Open questions to chase with EI

1. Quote Only path-selection mechanism (see above).
2. Premium period — is `totalPremiumCents` always 6mo or does it vary?
3. Coverage limits + deductibles — does EI surface them anywhere, or are they not part of the partner data product?
4. Policy summary thinness — `summary.policy` has only `id`, `carrier`, `boundAt`. No policy number, no binder URL. Where does that data go for downstream CRM or document workflows?
5. `media[]` URLs from verification — `expiresAt` is documented (~7d). Does Blinker need to mirror these to its own storage for long-term reference?
6. Duplicate handling — confirmed it's a 4xx on POST, not a webhook. Anything else that's synchronous (validation errors, decline reasons)?
7. Webhook retry semantics — does EI retry on Blinker 5xx? Backoff schedule? Idempotency keys?
8. Sandbox creds + webhook secret rotation — onboarding process and operational rotation cadence.
