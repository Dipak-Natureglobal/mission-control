# ADR 19 — Manager Experience

**Status:** Accepted 2026-05-12. Phase 1B (Wave 28).
**Owner:** Coordinator (`blinker-platform/`).
**Related:** [`04-personas.md`](04-personas.md) (placeholder), [`10-admin-console.md`](10-admin-console.md), [`canon/personas.json`](../canon/personas.json), [`16-looker-embed.md`](16-looker-embed.md).

## 1. Problem

The Agent persona has a feature-complete UI surface in mission-control (Home / Inbox / Contacts / CoPilot / Global Search / Reports). The Manager persona ships as a 3-card "Not wired yet" stub. We need to define what a Manager actually does, what screens they need, and how those screens reuse the Agent substrate without re-implementing it.

## 2. Decision summary

A Manager is **an Agent whose unit of work is agents, not opportunities**. Manager IA mirrors Agent IA, lifted one level:

| Agent screen | Manager screen | Unit of work |
|---|---|---|
| Home | Home (Team) | Team rollup |
| Inbox | Inbox (Team) | Opportunities grouped by agent |
| Contacts | — *(folds into Inbox + Team)* | — |
| CoPilot (opportunity) | Agent Drill-in *(plus same CoPilot, with manager overlay)* | One agent OR one opp |
| Reports | Metrics | Looker boards, manager-scoped |
| — | **Team** *(new, primary workbench)* | Agents roster |
| — | **Assignment** *(new)* | Routing queues |
| — | **Tags** *(optional, preset-gated)* | Tag namespace mgmt |

The Manager scope is `org` (canon `personas.manager.scope: "org"`). Multi-org access is supported via accessible-orgs intersection; single-org-at-a-time is the default operating mode.

## 3. Canon alignment

From `canon/personas.json`:

```json
"manager": {
  "permissions": ["view_own_org", "manage_agents", "assign_opportunities",
                  "view_team_analytics", "add_tags", "create_tags"],
  "presets": ["manager_standard" (default), "manager_lead" (+view_api_responses),
              "manager_assign_only" (routing only)]
}
```

Every screen in this ADR maps to one or more of those badges. The `manager_assign_only` preset gates the Manager nav to **just** the Assignment screen, hiding Home / Team / Metrics. The `manager_lead` preset additionally exposes "API failure" derived filter (because it carries `view_api_responses`).

Resolves canon `_TODO[0]` ("Verify whether Manager should also see analytics across child orgs"): **yes, via opt-in "All my orgs" rollup mode** — not the default. See §6.

## 4. Information architecture

```
Manager shell
├── Home                  Org-scoped team KPIs + by-agent strip + recent team activity
├── Team                  PRIMARY: agents roster + Agent drill-in right pane
├── Inbox                 All-team opportunities; default group-by-agent; bulk reassign
├── Assignment            Unassigned + Stuck queues; inline assign dropdown
├── Metrics               Looker iframes, manager-scoped boards
└── (Tags)                Tag CRUD; gated by `create_tags` badge (not in MVP)
```

Top-bar additions: **Org switcher** (left of Persona switcher). Badge count for the union of Unassigned + Stuck on the Assignment nav item.

## 5. Screen specifications

### 5.1 Home (Team)

Layout mirrors `AgentHome.jsx`. Replacements:

- **KPI tiles (lens-scoped, 4):** Open opportunities (with 14-day sparkline), Conversion rate (won / won+lost), Avg. handle time (created→won median), Stale count (opps where age > org SLA).
- **By-agent strip (new):** Horizontal scroll of agent chips, sorted by current workload desc. Each chip: initials/avatar, name, open count, conversion %, age dot (green/amber/red on oldest opp). Click → Team page with that agent's drill-in pane open.
- **By-type rollup (reused from Agent Home):** Per-type cards with nested by-status pills. Click → Manager Inbox pre-filtered.
- **Funnel header (reused, all-time, not lens-scoped):** Open / Won / Lost / Abandoned. Click → Manager Inbox at that stage.
- **Recent team activity (new):** Same `useInfiniteScroll` paginator as Agent Home's per-contact activity, but reads activities across all the org's contacts. Each row shows actor (agent name + persona pill), action type, contact link, timestamp. Filter: by agent, by activity type.

### 5.2 Team (PRIMARY workbench)

Two-pane layout. Replaces the existing `ManagerHome.jsx` stub.

**Left pane — agents roster:**

| Column | Notes |
|---|---|
| Agent | Name, initials, presence dot (Phase 2; PostHog presence) |
| Open | Count of opps owned |
| Stale | Count where age > org SLA (visual emphasis when > 0) |
| Conversion | Won / (won+lost) over lens window |
| Avg handle time | Median days created → won |
| Last active | Most recent activity timestamp (org-tz aware) |
| Preset/tags | Preset badge (`agent_lead`, `agent_admin_assistant`) + custom tags |

- Reuses **AdvancedFilter** with manager-specific filters: preset, tag, last-active range, open-count range.
- Default sort: stale-count desc. Sort by any column.
- Quick filters: All / Active today / Stale work / Below conversion threshold.
- Header KPI strip: total agents, agents-with-stale-work, agents-with-no-open-opps.

**Right pane — Agent drill-in** (URL: `right={kind:'agent_profile', agentId}`):

Sections, top to bottom:

1. Header — name, preset badge, org chip, last-active timestamp, "Message agent" action (Phase 2).
2. Workload — Open / Stale / Won this period / Lost this period (mini KPI strip).
3. Inbox snapshot — embedded mini-Inbox showing this agent's 10 oldest opps. Click-through opens full Manager Inbox filtered to this agent.
4. Conversion by type — small bar chart, this agent vs. org median.
5. Recent activity — same feed as Home, filtered to this agent.
6. **Coaching notes** — per-agent notes surface (storage key `blinker.notes.v1.agent.<agent_id>`). **Manager-only visibility — agents never see their own coaching notes.**
7. Reassign workload — bulk action: pick N opps to redistribute; opens Assignment screen pre-filtered.

### 5.3 Inbox (Team)

Identical to `AgentInbox.jsx` structurally — same columns, same `AdvancedFilter`, same CoPilot drill — with two differences:

1. **Default grouping = Agent.** Collapsible group header per agent shows: agent name + open count + stale count + conversion. Within: standard Inbox rows.
2. **Bulk select.** Row checkboxes; bulk actions: Reassign, Add tag, Mark stuck.

Filter additions on top of Agent's AdvancedFilter schema:

- **Owner = Unassigned** (first-class null option on Owner enum).
- **Stuck (no movement in N days)** — derived filter on `updated_at`.
- **Has API failure** — derived from API-response log; gated to `manager_lead` preset (requires `view_api_responses` badge).

The opportunity drill (CoPilot) is the **same** pane the Agent uses, with manager affordances added to the left rail:

- "Assigned to <agent>" line with inline re-assign dropdown.
- "Note for agent" button → writes a coaching note (Team §5.2.6).
- Status-change history (read-only) is shown to manager including system-actor entries.

### 5.4 Assignment

Routing-focused. Two columns.

**Left — queues** (each is a saved AdvancedFilter projection):

- Unassigned (count)
- Stuck > N days (count)
- API failure (count, `manager_lead` only)

**Right — queue contents:**

- Rows: Type, Contact, Vehicle, Age, Status.
- **Inline Assign dropdown** with workload-aware suggestion (see §7).
- Bulk select + bulk-assign.

Does **not** open CoPilot. Assignment is a different mental mode than working an opp; keep keystrokes minimal.

The `manager_assign_only` preset opens the Manager shell directly to this screen and hides Home / Team / Metrics in the nav.

### 5.5 Metrics

Phase 1B: Looker iframe embeds, manager-scoped boards. Follows the `architecture/16-looker-embed.md` pattern — `report_id + page_id` in canon, iframe path `/embed/reporting/...`, user email via `params` JSON for row-level filtering.

Manager-scoped boards: team conversion funnel, agent leaderboard, by-type SLA, by-org breakdown.

Phase 2: native (non-Looker) widgets for sub-second filtering.

### 5.6 Tags namespace management (v3.0.10 Task 2)

Surfaced under the Manager nav as **Tags**. Gated by `create_tags` badge — `manager_standard` and `manager_lead` see it; `manager_assign_only` does not (nav item hidden).

**PRESET vs TAG semantics:**

| | **Preset** | **Tag** |
|---|---|---|
| Role | Canonical role-like permission template tied to a persona | Free-form label for grouping / specialization / routing |
| Cardinality | One per user (admin picks at assignment) | Many per user, many per contact, potentially many per opportunity |
| Source | `canon/personas.json::personas.<persona>.presets[]` (platform-wide) | `canon/system-tags.json` + per-org additions |
| Determines | Which **badges** (permissions) the user gets | Nothing permission-related — pure metadata for filtering / routing / reporting |
| Who can create | Super Admin only (canon edit) | Manager+ via `create_tags` badge; Agent can only apply existing via `add_tags` |
| Examples | `agent_standard`, `agent_lead`, `manager_lead`, `manager_assign_only` | `vsc-specialist`, `west-coast`, `escalations`, `onboarding` |
| Syncs to GHL | No (internal permission model) | Yes (bidirectional per ADR 07) |

**Layout** — left rail with tabs (Tags / Presets), right pane with content.

**Tags tab** (primary):
- Table columns: name, color chip, applied-to count (users + contacts + opps), last-applied timestamp, source (`system` / `org`).
- AdvancedFilter: source (system/org), applied-to (users only / contacts only / opps only / any), last-applied range.
- Quick filters: All / In use / Unused / Recently added.
- Row click → side panel showing the entities currently tagged.
- Actions per row: rename, change color, archive (soft-delete; existing applications retained but tag hidden from picker).
- Top-bar action: **+ New tag** (gated on `create_tags`). Modal: name, color, scope (user / contact / opp / any), description.
- Bulk select: merge (pick destination tag; source applications repointed and source archived).

**Presets tab** (read-only reference):
- Reads from `canon/personas.json::personas.*.presets[]`.
- Groups by persona (Agent / Manager / Admin / Super Admin).
- Each preset row: id, label, description, badges list. Click → side panel detail.
- "Preset CRUD lives in Super Admin canon editor" footer note.

**Data model:**

`canon/system-tags.json` already exists with this shape:

```json
{
  "system_tags": [
    { "id": "do-not-contact", "name": "Do Not Contact", "color": "#dc2626",
      "category": "compliance", "system": true, "created_by": "system",
      "created_at": "..." }
  ],
  "by_org": {
    "102": [
      { "id": "tag_apex_demo_referral", "name": "Demo Referral", "color": "#10b981",
        "category": "lifecycle", "system": false,
        "created_by": "manager_102_seed", "created_at": "..." }
    ]
  }
}
```

- **`system_tags`** are Blinker-managed, read-only across all orgs.
- **`by_org`** are user-created tags, scoped to a single org (key = org_id as string).
- No `scope` field today — tags currently apply primarily to **contacts** (per canon's `_principle`: "tag the contact instead" of the opportunity). Future: extend to user-tags via the same registry, distinguished by which entity table holds the FK.

`packages/api/tags.js` SDK methods (new in Wave 29b):
- `list({ org_id?, include_system?, include_archived? })` → union of `system_tags` + `by_org[org_id]`, enriched with `applied_to_count` per entity type (users / contacts / opportunities). Default `include_system=true`, `include_archived=false`.
- `get(id)`
- `create(org_id, { name, color, category, description })` → adds to `by_org[org_id]`; `create_tags` gated; returns the new tag.
- `update(id, patch)` → name/color/category; system tags rejected; `create_tags` gated.
- `archive(id)` → soft-delete (set `archived_at`); existing applications retained; tag hidden from picker. System tags rejected.
- `merge(sourceId, destId)` → repoint applications across all entity tables, then archive source. `create_tags` gated. Same-org only in Phase 1.
- `listAppliedEntities(id)` → `{ users: [], contacts: [], opportunities: [] }` — usage report for the side panel.

Tag-create writes a `tag_created` activity record per canon `_TODO`. Persona-aware `created_by` = `<persona_slug>_<org_id>_<ts>`.

## 6. Multi-org scoping

### Org switcher

Top-bar control left of the Persona switcher. Source: union of `agents.json[my_id].org_ids` and explicit org assignments in canon. Single-org-selected by default, persisted per session.

### "All my orgs" rollup mode

Opt-in toggle inside the Org switcher. When on:

- KPIs sum across selected orgs.
- Agents roster gains an Org chip column.
- Inbox gains an Org filter.
- Org pills appear on opp rows.

### Cross-org assignment

**Allowed when the manager has access to both source and destination orgs** (whether via direct assignment to both, or via parent-partner manager scope over child orgs). A parent-partner manager **can** move opportunities/contacts between Apex and Velocity if both are within the parent's accessible-orgs set. The Assignment dropdown and bulk-reassign action surface eligible destination orgs accordingly.

This is the resolution to canon `_TODO[0]`. When a contact moves to a different org, the move propagates to all related opportunities, vehicles, notes, activities, and tags. Implementation owns the cascade — caller passes a contact id and target org id.

#### Per-org cross-org policy (v3.0.10 Task 1)

Each org carries a `cross_org_assignment` block in `canon/org-registry.json` that gates and shapes the action. The **SOURCE org's policy** is what's read (the org losing the opp/contact). The destination org accepts the inbound record per the source's policy.

| Field | Type | Default | Effect |
|---|---|---|---|
| `enabled` | bool | `false` | Master gate. When `false`, the AgentPicker hides cross-org agents entirely. When `true`, the picker lists agents grouped by org, including orgs the manager has access to that are NOT the source. |
| `contact_mode` | `'copy' \| 'move'` | `'copy'` | On copy: source retains the contact; destination receives a duplicate keyed via `source_contact_id`. On move: source unlinks the contact and the destination becomes the new owner. |
| `opportunity_mode` | `'copy' \| 'move'` | `'copy'` | Same semantics on the opportunity record. Copy is safer (audit trail preserved). |
| `mark_opportunity_readonly_on_copy` | bool | `true` | Source mirror is flagged readonly so agents can't continue working it. Ignored on move. |
| `mark_contact_readonly_on_copy` | bool | `true` | Same for the contact mirror. Ignored on move. |

UX consequences:
- AgentPicker behavior depends on source org's `enabled`:
  - `enabled: false` → agents in destination orgs are not surfaced; only same-org agents render.
  - `enabled: true` → agents grouped by org, cross-org picks trigger a confirmation modal.
- Confirmation modal copy varies by mode: "**Copy** to <Org>" preserves source mirror; "**Move** to <Org>" hard-cuts.
- Readonly state propagates to the source mirror's CoPilot, Inbox row pill ("Mirror · readonly"), and any write-paths (status edits, notes, assignment).
- Admin Console will surface this block under each org's settings page (Wave 30+).

#### Phase 1 cascade depth

`crossOrgMove` / `crossOrgCopy` in `packages/api/contacts.js` re-stamps `contact.org_id` (move) or creates a duplicate contact (copy). Opportunities/activities lack denormalized `org_id` in fixtures so the cascade is shallow. Phase 2 adds audit-log entries + opp/activity org_id stamping.

## 7. Assignment suggestion algorithm

The Assignment dropdown ranks agents using a composite score:

```
score(agent, opp) =
  workload_factor(agent) * 0.6  +
  tag_match_factor(agent, opp) * 0.4
```

Where:

- `workload_factor` = 1 − (agent.open_count / org.max_observed_open_count). Lower load = higher score.
- `tag_match_factor` = intersection size between agent's tags/preset badges and the opp's type-required badges (e.g. agents with `agent_lead` preset rank higher for opps flagged needing escalation handling).

Top 3 agents render at the top of the dropdown with a "Suggested" pill. Full alphabetized list follows. The manager can always override.

Telemetry: `mission_control.assignment.suggestion_shown { opp_id, top_agent_id, top_score, override }` and `mission_control.assignment.assigned { opp_id, agent_id, was_suggested }`.

## 8. Reuse map

| Component / pattern | Reuse |
|---|---|
| `AdvancedFilter` | Direct; extend with Owner=Unassigned + Stuck filter |
| `useInfiniteScroll` + `BackToTop` | Direct on Team list, Inbox, Activity feed |
| KPI tile component | Direct on Manager Home + Agent drill-in |
| CoPilot pane (`OpportunityContextPane`) | Direct; manager-overlay rail items |
| `ContactProfile` pattern | Mirror as `AgentProfile` (same shape, different data) |
| Notes pattern (`blinker.notes.v1.*`) | Mirror as per-agent coaching notes (`blinker.notes.v1.agent.<id>`) |
| Persona switcher / `NAV_BY_PERSONA` | Add manager screens to existing config |
| Looker embed (`/embed/reporting/`) | Direct on Metrics |

Net-new components:

- `OrgSwitcher.jsx` (shell-level dropdown)
- `AgentRosterTable.jsx`
- `AgentProfile.jsx`
- `AssignmentDropdown.jsx` (workload + tag-match scoring)
- `BulkReassignBar.jsx`

## 9. Data model

### `agents.json` fixture (new)

Located at `packages/api/_fixtures/agents.json`. Shape:

```json
{
  "agents": [
    {
      "id": "agent_jordan_reese",
      "name": "Jordan Reese",
      "email": "jordan.reese@apex.example",
      "persona": "agent",
      "preset_id": "agent_standard",
      "org_ids": ["102"],
      "tags": ["west-coast", "vsc-specialist"],
      "last_active_at": "2026-05-12T18:42:00Z",
      "created_at": "2025-11-01T00:00:00Z"
    }
  ]
}
```

Workload / conversion / stale counts are **derived**, not stored — `packages/api/agents.js` computes them from `opportunities.json` and `activities.json` at read time.

### `packages/api/agents.js` (new)

Domain SDK module mirroring `packages/api/contacts.js`. Methods:

- `agents.list({ org_id?, preset_id?, has_tag? })` → enriched with workload metrics
- `agents.get(id)` → enriched
- `agents.computeWorkload(id, { lens? })` → KPIs
- `agents.listCoachingNotes(id)` / `addCoachingNote(id, body)` — manager-only; `localStorage` in Phase 1, mirrors the contact notes pattern

### Coaching notes storage

Storage key: `blinker.notes.v1.agent.<agent_id>`. Same shape as contact notes (`id, body, author_id, created_at, edited_at?`). **Read access gated by `manage_agents` badge.** Phase 2 backs into DB with the same gate.

## 10. Phasing

### Wave 28a — Foundation (sequential, must land first)

- `OrgSwitcher.jsx` in shell (top-bar control)
- `NAV_BY_PERSONA.manager` fleshed out: `home`, `team`, `inbox`, `assignment`, `metrics`
- Scaffold pages for each (placeholder content, proper routing)
- `agents.json` fixture seeded
- `packages/api/agents.js` SDK module (read methods only)

### Wave 28b — Team page (parallelizable after 28a)

- `AgentRosterTable.jsx`
- `AgentProfile.jsx` right-pane drill-in
- Coaching notes surface
- Wire `right` URL state machine for `agent_profile` kind

### Wave 28c — Manager Home (parallelizable after 28a)

- Team KPI tiles, by-agent strip, by-type rollup, funnel header
- Team activity feed (cross-contact `useInfiniteScroll`)
- Date lens selector

### Wave 28d — Manager Inbox (parallelizable after 28a)

- Default group-by-agent rendering
- Bulk select + bulk reassign + bulk tag
- Owner=Unassigned filter, Stuck filter
- Manager-overlay CoPilot affordances (re-assign dropdown, note-for-agent)

### Wave 28e — Assignment (parallelizable after 28a)

- Queues (Unassigned, Stuck, API failure)
- `AssignmentDropdown` with workload + tag-match scoring
- `BulkReassignBar`
- `manager_assign_only` preset gating (Home/Team/Metrics hidden when active)

### Wave 28f — Metrics (Phase 1B+1)

- Looker iframes, manager-scoped boards
- Canon entries for manager Looker boards (extend `canon/integrations.json` Looker section per ADR 16)

### Wave 29+ — Tags namespace, "All my orgs" rollup, presence indicators, native analytics

## 11. Open questions deferred to implementation

- Suggested-agent score weights (60/40 workload/tag) are a starting heuristic; calibrate from real assignment data once any exists.
- Stuck threshold default is org SLA; orgs without an SLA fall back to 7 days. Worth surfacing as a per-org canon setting alongside `coverage_term_defaults`.
- Coaching notes are localStorage in Phase 1; coordinator should decide whether to keep them client-only (preserves manager-only privacy trivially) or move to DB-with-acl in Phase 2.

## 12. Out of scope

- Admin-console functions (user provisioning, integration credentials, org config) live in the **Admin** persona — see ADR 10.
- Super-admin cross-org views — see ADR 04 and SuperHome.
- Consumer-facing surfaces — unchanged.
