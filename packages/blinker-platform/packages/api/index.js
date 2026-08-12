// Public surface for blinker-platform's domain API SDK.
//
// CHARTER: a single client object — `blinkerApi` — that every child app
// reads/writes Blinker domain entities through. Mirrors the canon shapes
// declared in `../../canon/blinker-domain.json`.
//
// Phasing:
//   Phase 1 (today, fixture-backed + localStorage):
//     blinkerApi.notes.list({ contact_id, opportunity_id? })
//     blinkerApi.notes.create({ contact_id, opportunity_id?, body, ... })
//     blinkerApi.activities.list({ contact_id, opportunity_id? })
//     blinkerApi.activities.listAll({ contact_ids?, limit? })
//     blinkerApi.activities.create({ contact_id, type, source, payload, ... })
//     blinkerApi.addNote({ contact_id, opportunity_id?, body, ... })
//       └─ atomic dual-write helper: note record + paired
//          `type: 'note'` activity (canon contract from
//          blinker-domain.json activity._produced_by)
//
//   Phase 2 (real backend, planned):
//     Same call surface; one-line provider swap routes calls to the live
//     Blinker API. No child-app changes required.
//
//   Phase 3:
//     Public partner-facing API surface.
//
// Dep direction (per architecture/11):
//   - MAY read `../../canon/*.json` directly.
//   - MAY import sibling packages (utils, integrations, telemetry).
//   - MUST NOT import from any child app.
//
// Consumers MUST import from this file ONLY.
//
// ---------------------------------------------------------------------
//
// Available public exports:
//
//   import { blinkerApi } from 'blinker-platform/api';
//   blinkerApi.notes.list({ contact_id })
//   blinkerApi.notes.create({ contact_id, body, author_id, author_persona })
//   blinkerApi.activities.list({ contact_id })
//   blinkerApi.activities.listAll({ contact_ids?, limit? })
//   blinkerApi.activities.create({ contact_id, type, source, payload, summary_text })
//   blinkerApi.contacts.list({ org_id?, has_opportunity? })
//   blinkerApi.contacts.get(id)
//   blinkerApi.contacts.asMap()
//   blinkerApi.opportunities.list({ type?, contact_id?, status? })
//   blinkerApi.opportunities.get(id)
//   blinkerApi.opportunities.create({ type, contact_id, vehicle_id?, status?, owner?, _prefill?, ... })
//   blinkerApi.opportunities.registerOpportunityWriter(fn)  // host-app boot wiring
//   blinkerApi.addNote({ contact_id, opportunity_id, body, author_id, author_persona })
//
//   // Or named imports for tree-shake friendliness:
//   import { notes, activities, contacts, opportunities, addNote } from 'blinker-platform/api';
//
// Lifts complete:
//   - Wave 16 F2-fu13: notes + activities + addNote
//   - Wave 18: contacts + opportunities (read surface only — list/get/asMap)
//   - Wave 28a: agents (read + derived workload + coaching notes)
//   - Wave 29b: tags (canon-backed reads + localStorage overlay writes;
//     create / update / archive / unarchive / merge / listAppliedEntities)
//
// Future lift targets when work begins:
//   - mutations: `mission-control/src/lib/session-data.js` →
//     `blinkerApi.opportunities.{create,append,update}`
//     + `blinkerApi.contacts.{create,append,update,appendVehicle,updateVehicle}`
//     + `blinkerApi.households.appendRelationship`
//   - inline fixture reads scattered across protection-portal /
//     insurance-portal / refi-portal — promote to read from this SDK.
//   - `mission-control/src/lib/contact-storage.js` — retire in favor of
//     this SDK (mc currently uses its own localStorage prefix
//     `mc.notes.v1.*` / `mc.activities.v1.*`; this SDK uses
//     `blinker.notes.v1.*` / `blinker.activities.v1.*`. Phase E migrates
//     mc; the prefix change means demo data resets but production-side
//     this is moot).

import * as notes from './notes.js';
import * as activities from './activities.js';
import * as contacts from './contacts.js';
import * as opportunities from './opportunities.js';
import * as agents from './agents.js';
import * as tags from './tags.js';
import * as leaderboard from './leaderboard.js';

/**
 * Atomic dual-write: create a note record AND a `type: 'note'` activity
 * record pointing at it via `payload.note_id`. Matches the contract in
 * `canon/blinker-domain.json activity._produced_by` (note → activity is
 * the only required dual-write today).
 *
 * Returns `{ note, activity }` so callers can optimistically render
 * either side without re-reading the storage.
 */
export function addNote({
  contact_id,
  opportunity_id = null,
  body,
  author_id = null,
  author_persona = null,
} = {}) {
  const note = notes.create({
    contact_id,
    opportunity_id,
    body,
    author_id,
    author_persona,
  });
  const previewBody = note.body.length > 60 ? `${note.body.slice(0, 60)}…` : note.body;
  const activity = activities.create({
    contact_id,
    opportunity_id,
    type: 'note',
    source: 'agent',
    actor_id: author_id || null,
    payload: { note_id: note.id },
    summary_text: `Note added: '${previewBody}'`,
  });
  return { note, activity };
}

export { notes, activities, contacts, opportunities, agents, tags, leaderboard };

// Wave 31 — host-app boot wiring for opportunity mutations. Re-exported
// at the top level so mission-control can call it once at mount without
// reaching into `opportunities.registerOpportunityWriter`.
export { registerOpportunityWriter } from './opportunities.js';

export const blinkerApi = {
  notes,
  activities,
  contacts,
  opportunities,
  agents,
  tags,
  leaderboard,
  addNote,
};
