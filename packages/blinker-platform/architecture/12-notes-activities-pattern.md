# 12 — Notes & Activities Pattern

> Canonical shape and persistence pattern for agent-authored notes across all opportunity workflows. Locked 2026-05-06 in response to a user directive: "agent notes stored at the contact level, related to the opportunity, rendered in the activity log as an event. This should be the pattern for all of the opportunity workflows."

## Problem

Each child app evolved its own ad-hoc notes mechanism:

| App | Slot | Persistence |
|---|---|---|
| protection-portal | `useState('')` in `AgentView` | None (ephemeral) |
| insurance-portal | `workflow.notes` (single string per workflow) | In-memory workflow object |
| refi-portal | `opportunity.notes` (single string per opp) | In-memory opportunity object |
| mission-control | `notes` array per contact in `lib/contact-storage.js` | localStorage `mc.notes.v1.<contact_id>` |

mission-control is the only one that matches the canon shape (`canon/blinker-domain.json#note` declares notes as a separate collection with `contact_id` + optional `opportunity_id` + body + author + timestamps). Everyone else flattens to a single string field, losing per-note authorship, per-note opportunity binding, and the activity-log dual-write contract.

## Decision

Adopt mission-control's pattern as the platform-wide standard. Lift it to `packages/api/{notes,activities}` so every child app calls a single SDK. Replace per-workflow note string fields with `blinkerApi.notes.list({ contact_id, opportunity_id })` reads + `blinkerApi.addNote(...)` writes.

### Note record shape

```js
{
  id,                 // 'n_session_<uuid>' for runtime; fixture-specific otherwise
  contact_id,         // FK — primary key for storage
  opportunity_id?,    // FK or null (null = contact-level note)
  body,
  author_id,          // 'agent_session' for runtime; 'agent_jordan' etc. for fixtures
  author_persona,     // 'agent' | 'manager' | 'admin' | 'super_admin'
  created_at,         // ISO
  updated_at,         // ISO
  _session?: true,    // runtime-created marker
}
```

### Activity record shape

```js
{
  id,                 // 'a_session_<uuid>' for runtime
  contact_id,         // FK
  opportunity_id?,    // FK or null
  type,               // 'note' | 'agent_action' | 'status_change' |
                      // 'call' | 'sms' | 'partner_event'
  occurred_at,        // ISO
  source,             // 'agent' | 'system' | 'consumer' | 'partner'
  actor_id?,          // who/what produced this activity
  payload,            // type-specific structured data
  summary_text,       // human-readable timeline line
  _session?: true,
}
```

For `type: 'note'`, `payload` is `{ note_id }` referencing the paired note record.

### Dual-write contract

`canon/blinker-domain.json activity._produced_by` mandates: each note creates exactly one paired activity record with `type: 'note'`, `payload: { note_id }`, and a `summary_text` summary. The platform SDK enforces this via `blinkerApi.addNote(...)` — callers should prefer the helper over manual `notes.create + activities.create`.

### Storage (Phase 1)

localStorage, keyed per contact:
- `blinker.notes.v1.<contact_id>`
- `blinker.activities.v1.<contact_id>`

First read for a contact with no localStorage entry returns the fixture-filtered seed (`packages/api/_fixtures/{notes,activities}.json`). After any write, localStorage holds the authoritative array. Append-only by design — notes are activity-log primitives; "editing" produces a new note record.

### Storage (Phase 2)

Replace function bodies in `packages/api/{notes,activities}.js` with API calls. Public signatures stable. One-line provider swap. Consumer code unchanged.

### NotesPanel — log mode

`packages/components/NotesPanel.jsx` adds a log mode triggered by `contactId` (+ optional `opportunityId`) props. In log mode:
- Reads `blinkerApi.notes.list({ contact_id, opportunity_id })` at mount + on key changes.
- Renders the past notes (newest-first) with author + timestamp + body.
- Submit textarea calls `blinkerApi.addNote(...)` and optimistically prepends.
- Tag picker (existing) sits above the log.

Legacy mode (`notes` + `onNotesChange` props) preserved for back-compat during migration.

### Agent-side adoption

| App | Migration phase | Status |
|---|---|---|
| protection-portal | C — pilot | Pending dispatch |
| refi-portal | D | Queued |
| insurance-portal | D | Queued |
| mission-control ContactProfile | E | Queued (retire `lib/contact-storage.js`) |

## Why

1. **Contact-first.** Notes and activities outlive any single opportunity. A contact has a refi opportunity that closes, then six months later opens an insurance opportunity — the notes from the refi flow remain visible. Per-workflow string slots can't represent this.
2. **Activity-log first-class.** Mission-control's ContactProfile already renders an activity log. Without the dual-write contract, notes from refi/insurance/protection workflows never appear there. The user explicitly called this out: "rendered in the activity log as an event."
3. **Phase 2 alignment.** The shape matches `canon/blinker-domain.json` exactly. When the real backend ships, only the SDK function bodies change — every consumer keeps working.
4. **Author attribution.** Per-note author + persona enables "manager flagged" entries (e.g., fixture `n_oka_4` is `author_persona: 'manager'`), which a single string field can't represent.

## Migration costs

- Per-workflow note state in protection / insurance / refi gets retired in their respective AgentView migrations (Phase D). The right-rail NotesPanel is the canonical surface; per-workflow `partnerData.note` payload fields source from the latest log entry (or the latest one for the current opp).
- Mission-control's `lib/contact-storage.js` retires in Phase E. localStorage prefix changes from `mc.notes.v1.*` to `blinker.notes.v1.*` — demo data resets one-time.
- Fixtures live in `packages/api/_fixtures/`. mission-control's `src/fixtures/{notes,activities}.json` retires in Phase E (replaced by reads through the SDK).

## Open questions for Phase 2

- Real-time updates: when another agent adds a note to the same contact, do all viewers see it live? The SDK's read-on-mount model would need polling or WebSocket subscription.
- Who can edit / delete notes? Phase 1 is append-only by design; Phase 2 may surface edit/delete with audit-log retention.
- Cross-contact activity feeds (e.g., "all activity I touched this week") need a different storage model than per-contact keys. Not relevant for Phase 1.
