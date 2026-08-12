# 07 — Data Layer

## Source of truth

**Blinker DB is the source of truth** for the platform's domain entities:

- `contact` (User table + related)
- `household`
- `opportunity` (one record per workflow type per contact)
- `vehicle`
- `note`
- `activity`
- `tag`

GoHighLevel is **not** the source of truth. GHL is one of several **downstream sync targets**, alongside PostHog (events), carrier APIs (insurance), funders (refi), EFS (payments), DocuSeal (contracts), and the various lead-feed inbound webhooks (which write INTO Blinker, then sync OUT to GHL).

The only system Blinker reads back from automatically is the partner systems for status events — e.g., Embedded Insurance's webhook stream tells us when a policy is bound, and that update flows INTO Blinker. GHL → Blinker reverse reads are not part of the Phase 2 design; if an agent edits a contact in GHL, that edit lives only in GHL until product decides whether GHL writes are authoritative for any field (currently: nothing). The one exception is **tags**, which are bi-directional by design — see `canon/ghl-fields.json` `_blinker_to_ghl_projection.tags`.

## Why this matters

Earlier in the rewrite the implicit framing was "GHL has the data; Blinker is one of the consumers." That framing is wrong and would lead to:

- Apps building adapters to materialize GHL's flat shape into the rich shapes they need, with each app inventing its own normalization
- Multi-phone, multi-email, household, and per-channel consent collapsed everywhere because GHL can't represent them
- No single shape for cross-app consumers (mission-control reads a different "contact" than insurance-portal does)
- A reverse sync (GHL → Blinker) that tries to be authoritative on fields GHL can't fully represent

The Blinker-as-source-of-truth framing inverts each of those: one canonical shape per entity (`canon/blinker-domain.json`); apps consume it via the API layer; GHL receives a flattened projection (documented in `canon/ghl-fields.json` `_blinker_to_ghl_projection`); GHL never overrides Blinker on a non-tag field without explicit product approval.

## API layer

Apps READ Blinker entities through the **Blinker API layer**. Apps do not read fixtures or external systems directly.

**Phase 1 (now — prototype):**

- Each child app has `src/fixtures/*.json` files containing mock data conforming to the canon shapes.
- Apps import fixtures via plain JSON imports: `import contacts from '../fixtures/contacts.json'`.
- A fixture-validation script (`scripts/validate-fixtures.js`) checks each child app's fixtures against `canon/blinker-domain.json` before commit.
- When a second app needs the same entity (e.g., insurance-portal needs contacts), the fixture is lifted from the consuming app into `blinker-platform/api-mock/{entity}.json` and both apps import via the existing `file:` dep pattern (same as `protection-portal: "file:../protection-portal"` for AgentView). Today only mission-control reads contacts, so per-app fixtures are fine.

**Phase 2 (real backend — TBD):**

- A real Blinker API surface (HTTP/JSON or RPC, decision deferred) exposes `blinkerApi.{entity}.get|list|search`.
- The fixture import becomes an API call: `import { blinkerApi } from '@blinker/api-client'; const contact = await blinkerApi.contacts.get(id);`.
- The shape stays the same — the canon block is the contract that survives the swap.
- The real API is backed by Blinker's existing Rails app (read path) until the rewrite's own DB lands; writes go to Rails for the foreseeable future.

**The Phase 1 → Phase 2 swap is intentionally designed to be a one-line import change in each consumer.** That's the whole point of canonizing the shape now. Get it right in Phase 1 with mocks; the apps don't have to change when the real backend lands.

## Sync targets (downstream from Blinker)

Each downstream system has its own canon file documenting the projection.

| System | Canon file | Direction | Authoritative for |
|---|---|---|---|
| **GHL** | `canon/ghl-fields.json` `_blinker_to_ghl_projection`, `canon/ghl-status.json` | Blinker → GHL writes; tags bi-directional | Tags only (others Blinker-side) |
| **PostHog** | `canon/posthog-events.json` (TBD) | Blinker → PostHog writes | Nothing (PostHog augments, doesn't override) |
| **Embedded Insurance** | `canon/ghl-fields.json` `_insurance_*` shape blocks; `architecture/06-embedded-insurance-contract.md` | Blinker ↔ EI (consumer-facing flow) | EI authoritative for verification, quote, policy events |
| **StoneEagle** | (TBD) | Blinker → StoneEagle for VSC quote/sale | StoneEagle authoritative for product catalog |
| **FluidPay / EFS** | (TBD) | Blinker → EFS for payment plan creation | EFS authoritative for payment plan state once created |
| **DocuSeal** | (TBD) | Blinker → DocuSeal for contract signing | DocuSeal authoritative for signature events |
| **VinAudit / MarketCheck / Google** | inline in protection-portal/insurance-portal | Read-only | Vehicle YMMT / value (Blinker caches) |

The pattern: each downstream gets its own canon file (or section in an existing one) that documents what Blinker writes, what flows back, and which fields each side is authoritative on. Add new downstream systems by adding new canon blocks, not by mutating the domain shape.

## Entity write rules (Phase 2)

These are the rules the Blinker API layer will enforce when real writes start happening. Documented now so the prototype's mocks behave consistently.

- **`contact`:** Blinker authoritative. GHL writes propagate to GHL only (read-back not currently designed). Lead-feed inbound webhooks create or update contacts; existing contact match is by `external_lead_id` first, then by phone OR email.
- **`household`:** Blinker authoritative. Created by an address-clustering heuristic (TBD). Manual reassignment by agents in mission-control.
- **`opportunity`:** Blinker authoritative. Each workflow type creates opportunities through that workflow's API (e.g., insurance-portal capture creates an `insurance` opportunity). Status transitions documented in `canon/ghl-status.json` per workflow.
- **`vehicle`:** Blinker authoritative. Created by VIN decode or manual YMMT entry; `source` field tracks which (per the locked decision). One vehicle can be referenced by multiple opportunities for the same contact.
- **`note`:** Blinker authoritative. Author tracked; immutable after a soft-edit window (TBD).
- **`activity`:** System-generated for status changes and partner events; agent-generated for calls/sms/email logged manually. Append-only.
- **`tag`:** Bi-directional with GHL. Agent-applied tags (`source: 'blinker'` or `source: 'ghl'`) editable; system tags (`source: 'system'`, `system: true`) immutable to agents. Conflict policy: last-writer-wins on add; deletes are explicit per side.

## Tags vs opportunities

This is a real design question, not a pre-decided one. See `canon/blinker-domain.json` `tags._tags_vs_opportunities_open_question` for the working answer and the open edge cases. Short version:

- **Tags** describe the contact (who they are, what they consented to, what segment they're in). They don't have lifecycle / status. They sync with GHL.
- **Opportunities** describe what we're working on with the contact (which deal, in what state). They have status machines. Their projection to GHL is per-workflow.

Edge cases like "warm-lead" (tag, or derived from any opp in 'Quoted' state?) need product input. Default rule: **prefer derived views over redundant tags when the data is computable from opportunity state.** Reserve tags for attributes that are NOT derivable from other entities.

## Phase 1 fixture validation

`scripts/validate-fixtures.js` walks each child app's `src/fixtures/*.json`, matches each file against the corresponding canon entity block, and warns on shape drift. It is intentionally lightweight — JSON-shape only, not a full schema validator. The goal is to catch obvious shape drift before commit; richer validation (types, formats, required vs optional) lands when a real schema (Zod/JSON Schema) is added. Run manually for now: `./scripts/validate-fixtures.js`. Wire into CI later.

## Open work

- Phase 2 API surface decision: HTTP/JSON vs RPC vs GraphQL. Defer until a second consumer of contacts exists.
- `blinker-platform/api-mock/` extraction: defer until a second app needs the same fixture.
- Address-clustering heuristic for household creation: defer until household panel ships in mission-control ContactProfile.
- Reverse-sync policy: today GHL → Blinker is tags-only. Decide if any other GHL-edited field should propagate back (e.g., agent edits a phone number in GHL — does that beat Blinker's record?).
- Write-conflict policy when the same record is edited in two apps simultaneously. Likely last-writer-wins on a per-field basis, but undecided.
- Audit log: every write through the API layer should produce an audit row. Shape TBD when the first write lands.
