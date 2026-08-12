# api/ — Phase 2 backlog

First lift landed Wave 16 F2-fu13 (notes/activities). Remaining surface populates in subsequent waves toward Phase 2 (real backend wiring).

## Charter

Single `blinkerApi` object exporting domain methods that match canon shapes:

```js
blinkerApi.contacts.{ list, get, create, update, appendVehicle, updateVehicle }
blinkerApi.opportunities.{ list, get, create, update, append }
blinkerApi.notes.{ list, create }                  // SHIPPED 2026-05-06 (F2-fu13)
blinkerApi.activities.{ list, create }             // SHIPPED 2026-05-06 (F2-fu13)
blinkerApi.addNote(...)                            // SHIPPED 2026-05-06 (F2-fu13) — dual-write helper
blinkerApi.households.{ getRelationships, appendRelationship }
blinkerApi.tags.{ list, create, attachToContact, detachFromContact }
blinkerApi.organizations.{ list, get, update }     // admin-console
blinkerApi.users.{ list, get, update, suspend }    // admin-console
blinkerApi.audit.{ list }                          // admin-console
```

## Lift targets when Phase 2 begins

| From | To | Notes |
|---|---|---|
| `mission-control/src/lib/session-data.js` | `blinkerApi.{contacts,opportunities,households}.*` | Currently in-memory append; swap reducer body |
| `mission-control/src/lib/contact-storage.js` | `blinkerApi.{notes,activities}.*` | Currently localStorage-backed |
| Inline fixture reads (5 child apps) | `blinkerApi.<entity>.list/get` | Wave 15b audit will inventory |

## Phase 1 fallback strategy (if needed before Phase 2 lands)

If a wave needs to introduce the SDK shape before the real backend exists, ship a fixture-backed client:

```js
// packages/api/index.js — fixture-mode skeleton
const isFixtureMode = !import.meta.env?.VITE_BLINKER_API_URL;
export const blinkerApi = isFixtureMode ? createFixtureClient() : createHttpClient();
```

Fixture mode reads from each consuming app's `src/fixtures/` (consumer registers fixtures via a `setFixtures()` boot call). Phase 2 swap is one env-var flip per app.

## Open questions

- REST + WebSocket subscription, or REST only? Real-time activity stream needs subscription support eventually (per architecture/07-data-layer.md `_consumed_by` pattern).
- Where does auth context live? Likely `blinker-platform/personas` injects current-user into `blinkerApi` at boot.
- Optimistic-update story: does the SDK do it, or do consumers? Probably consumer-owned.
