# 29 — Legacy ↔ Blinker 2.0 Data Boundary (No Two-Way Sync)

**Date:** 2026-07-30
**Status:** Active
**Supersedes:** —
**Cross-refs:** ADR 02 (Integration boundaries), ADR 07 (Data layer), ADR 16 (Looker embed)

## Context

During the 2026-07-30 migration/planning session a disconnect surfaced between
what the team was building and what the business intended for how the **legacy
Blinker product** (the Rails/GraphQL backend + MissionControl, see
`blinker-legacy/`) and **Blinker 2.0** (this platform's polyrepo apps on the new
database) share data.

The team had been building toward **bidirectional synchronization**: on an action
like "apply for financing," a record would be written to Legacy **and** synced
into the 2.0 database, keeping both databases mirrored for a client, with 2.0 →
Legacy backward-compatibility writes.

That is **not** the intended design. Chad directed that Legacy and 2.0 do **not**
cross-sync. A client lives on **one side at a time**. This ADR records that
decision so downstream apps stop building the mirror.

## Decisions

### D1 — No two-way sync, and no 2.0 → Legacy backward compatibility

There is **no ongoing synchronization** between the Legacy database and the 2.0
database in either direction. Specifically, 2.0 does **not** write back into
Legacy to keep it current, and no feature is built to make Legacy
backwards-compatible with data created in 2.0. A client is served from exactly
one system at any given time.

### D2 — A client is anchored to exactly one side

Two operating modes, mutually exclusive per client/organization:

- **Legacy-anchored** — the client keeps using Legacy (MissionControl + legacy
  DB). They may additionally use the new 2.0 **refi** and/or **insurance**
  workflows, but only as wrappers (see D3). All persisted data lives in the
  **Legacy DB only**. These users do **not** log into 2.0.
- **2.0-anchored** — the client has been migrated (see D4). They log into 2.0,
  all new work is persisted to the **2.0 DB only**, and they are **locked out of
  Legacy**. "We can't look back."

### D3 — Legacy-anchored refi/insurance = a wrapper around Legacy (Relentix-style)

For a Legacy-anchored client using the new refi or insurance workflow, the 2.0
workflow behaves like an external integration around Legacy — the client needs
the **workflow**, not the 2.0 interface/admin/standalone login (the same posture
as the Relentix integration):

1. Read the seed data **from Legacy** (contact, vehicle, customer profile).
2. Run the new 2.0 refi/insurance workflow.
3. Write the resulting **stub data back into Legacy** so Legacy stays intact.

Nothing is written to the 2.0 DB in this mode. This matches how the refi
prototype is coded today, and is the confirmed-correct approach: keep the two
databases separate until (and unless) the client is migrated. Minimize Legacy
changes — wrap around it; do not rewrite it.

**VSC has no wrapper mode.** VSC is the core of 2.0, so there is no
"stay-on-Legacy but use the new VSC workflow" path. VSC always runs on 2.0.

### D4 — Migration is a one-time, one-directional, whole-org cutover

Moving a client to 2.0 is a **single migration event**, not a continuous sync:

- Copy **all** of the client's Legacy data (contacts, vehicles, opportunities,
  product packages, documents/DocuSeal, rate calls, history) **into the 2.0 data
  structure**, once.
- After migration the client logs into 2.0 and sees their full history, then
  creates **new** opportunities (VSC / refi / insurance) that are persisted to
  the **2.0 DB only** — never pushed back to Legacy.
- Legacy is **locked** for that client; it receives no further data and they do
  not return to it.
- The cutover happens for the **whole organization at once** (e.g. all of an
  org's call centers together), not per-deal or per-user.

### D5 — Reporting follows the anchor

- **Legacy-anchored** clients keep **Looker Studio** reporting, fed by the Legacy
  DB / ETL (see ADR 16).
- **2.0-anchored** clients get **new reporting built on the 2.0 DB** (opportunity,
  remit, down-payment, etc.).
- The 2.0 reporting rewrite is **not yet specified** — tracked as an open item.

## Consequences

- **Stop building the mirror.** Any 2.0 → Legacy write-back intended to keep the
  databases in sync is out of scope and should be removed from the plan. The only
  Legacy writes that remain are the D3 wrapper stub-writes for Legacy-anchored
  refi/insurance clients.
- The refi prototype's current behavior (writes to Legacy only on apply-for-
  financing) is **correct** and should ship as-is on that axis.
- Migration tooling must be a **one-shot ETL** into the 2.0 schema, not an
  incremental sync service.
- 2.0 reporting is a prerequisite for fully cutting an org over — a migrated org
  can no longer rely on Looker.

## Open items

- Specify the 2.0 reporting surface (opportunity / remit / down-payment reports)
  that replaces Looker for migrated orgs.
- Define the one-time Legacy → 2.0 migration ETL (entity mapping, ID strategy,
  document/rate-call carryover).
