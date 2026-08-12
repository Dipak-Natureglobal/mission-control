# telemetry/ — backlog

## Lift trigger

When event-name drift becomes painful enough to warrant a registry. Today PostHog event names are hand-typed in every `posthog.capture(...)` call site. STATUS.md already shows several drift instances:
- `mission_control.admin.*` (Wave 14) — 18 events with consistent prefix.
- `protection.cross_sell.*` (Wave 1.5d) — 12 events.
- `refi.agent.*` (Wave 1.5c) — multiple events.
- `insurance.agent.*` — same.
- Some events use `_` as separator, some use `.` after the verb.

## Lift surface

- `track(eventName, payload)` — wraps posthog.capture; validates `eventName` against registry; logs warning on unknown name.
- `registerEvents([...])` — each app registers its events at boot.
- `getEventCatalog()` — surface for super-admin "events I can see" views.

## Phase 3

- Server-side ingestion (Blinker DB) of the same event payloads via a webhook from PostHog or direct dual-write. Per `architecture/01-event-taxonomy.md`.
