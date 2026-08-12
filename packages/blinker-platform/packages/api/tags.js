// Phase 1 tags API — canon-backed reads + localStorage-overlay writes.
//
// Wave 29b — Tags namespace management (v3.0.10 Task 2). Backs the
// manager-persona Tags screen in mission-control. See
// architecture/19-manager-experience.md §5.6 for spec.
//
// Canon source: canon/system-tags.json
//   - `system_tags[]`  Blinker-managed, read-only across all orgs.
//   - `by_org[<id>][]` Per-org user-created tags (key is org_id as string).
//
// Phase 1 mutation strategy — localStorage overlays:
//   blinker.tags.v1.org.<org_id>   user-created tag rows for that org
//   blinker.tags.v1.archives       { [tag_id]: iso_archived_at }
//   blinker.tags.v1.merges         { [source_id]: dest_id } repoint map
//
// Read flow (list()):
//   1) Union canon `system_tags` + canon `by_org[<id>]` + overlay `org.<id>`.
//   2) Apply archive overlay — drop archived rows unless include_archived.
//   3) Apply merge overlay — when a tag's id appears as a merge source,
//      it's treated as archived (and its applications would have been
//      repointed by the merge writer to the destination tag).
//   4) Enrich each row with `applied_to_count: { users, contacts,
//      opportunities, total }` derived live from agents.json + contacts.json
//      + opportunities.json (cross-checked against the merge overlay so a
//      merged source returns 0 and the destination absorbs the count).
//   5) Enrich each row with `last_applied_at` (max of applied_at timestamps
//      across the three entity types) when discoverable.
//
// Phase 2 swap — `tagsApi.*` route to a real backend; same call surface.
//
// Dep direction (per architecture/11):
//   - MAY read `../../canon/*.json` directly.
//   - MAY import sibling packages.
//   - MUST NOT import from any child app.

import canonTags from '../../canon/system-tags.json';
import agentsFixture from './_fixtures/agents.json';
import contactsFixture from './_fixtures/contacts.json';
import opportunitiesFixture from './_fixtures/opportunities.json';

const OVERLAY_ORG_PREFIX = 'blinker.tags.v1.org.';
const OVERLAY_ARCHIVES_KEY = 'blinker.tags.v1.archives';
const OVERLAY_MERGES_KEY = 'blinker.tags.v1.merges';

// ── Overlay helpers ──────────────────────────────────────────────────

function _readOverlay(key, fallback) {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[blinker-platform/api] tags overlay read failed:', key, err);
    return fallback;
  }
}

function _writeOverlay(key, value) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[blinker-platform/api] tags overlay write failed:', key, err);
  }
}

function _orgOverlayKey(orgId) {
  return `${OVERLAY_ORG_PREFIX}${String(orgId)}`;
}

function _readOrgOverlay(orgId) {
  if (orgId == null) return [];
  const arr = _readOverlay(_orgOverlayKey(orgId), []);
  return Array.isArray(arr) ? arr : [];
}

function _writeOrgOverlay(orgId, arr) {
  _writeOverlay(_orgOverlayKey(orgId), arr);
}

function _readArchives() {
  const v = _readOverlay(OVERLAY_ARCHIVES_KEY, {});
  return v && typeof v === 'object' ? v : {};
}

function _writeArchives(map) {
  _writeOverlay(OVERLAY_ARCHIVES_KEY, map);
}

function _readMerges() {
  const v = _readOverlay(OVERLAY_MERGES_KEY, {});
  return v && typeof v === 'object' ? v : {};
}

function _writeMerges(map) {
  _writeOverlay(OVERLAY_MERGES_KEY, map);
}

// ── Canon helpers ─────────────────────────────────────────────────────

function _systemTags() {
  const arr = canonTags.system_tags;
  return Array.isArray(arr) ? arr : [];
}

function _canonOrgTags(orgId) {
  if (orgId == null) return [];
  const block = canonTags.by_org || {};
  const arr = block[String(orgId)];
  return Array.isArray(arr) ? arr : [];
}

// Locate the org id a non-system tag belongs to by scanning the canon
// `by_org` block + any overlay `blinker.tags.v1.org.<id>` keys we can
// see. Used by `get(id)` + `update(id)` / `archive(id)` etc. since the
// SDK API takes a bare tag id without org context. Returns null when
// the id only exists in `system_tags` (canon) or doesn't exist at all.
function _resolveTagOrgId(id) {
  if (!id) return null;
  const canonByOrg = canonTags.by_org || {};
  for (const [orgKey, arr] of Object.entries(canonByOrg)) {
    if (Array.isArray(arr) && arr.some((t) => t.id === id)) return orgKey;
  }
  if (typeof localStorage === 'undefined') return null;
  // Iterate overlay keys for org rows we wrote in this session.
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(OVERLAY_ORG_PREFIX)) continue;
      const orgKey = k.slice(OVERLAY_ORG_PREFIX.length);
      const arr = _readOrgOverlay(orgKey);
      if (arr.some((t) => t.id === id)) return orgKey;
    }
  } catch {
    // ignore
  }
  return null;
}

function _isSystemTagId(id) {
  return _systemTags().some((t) => t.id === id);
}

function _findTagRecord(id) {
  if (!id) return null;
  const sys = _systemTags().find((t) => t.id === id);
  if (sys) return { ...sys, system: true };
  const orgKey = _resolveTagOrgId(id);
  if (!orgKey) return null;
  // Canon org tag merged with overlay patch (if any).
  const canonRow = _canonOrgTags(orgKey).find((t) => t.id === id);
  const overlayRows = _readOrgOverlay(orgKey);
  const overlayRow = overlayRows.find((t) => t.id === id);
  // Overlay rows can be either: (a) a fresh user-created tag (no canon
  // peer), or (b) a patch over a canon row (rename/recolor). We tag
  // overlay rows that are patches with `_patch: true` at write time so
  // we know to merge. For now, if a canon row exists, layer the overlay
  // fields over it.
  if (canonRow && overlayRow) {
    return { ...canonRow, ...overlayRow, system: false };
  }
  if (canonRow) return { ...canonRow, system: false };
  if (overlayRow) return { ...overlayRow, system: false };
  return null;
}

// ── Applied-to-count derivation ──────────────────────────────────────

function _agents() {
  const arr = agentsFixture.agents;
  return Array.isArray(arr) ? arr : [];
}

function _contacts() {
  const block = contactsFixture.contacts;
  if (!block || typeof block !== 'object') return [];
  return Object.values(block);
}

function _opps() {
  const arr = opportunitiesFixture.opportunities;
  return Array.isArray(arr) ? arr : [];
}

// Apply merge redirects on read — if `name` appears in the merges map
// (as a source), return the destination tag's name. Used so a tag that
// was merged into another in Phase 1 transfers its applied-to counts
// without rewriting the underlying fixture rows. Merges map keys are
// tag ids, but applications across fixtures key on tag NAME (string
// arrays on agents; { id, name } objects on contacts) so we have to
// resolve name → dest_name via the merges map. Keep both lookups:
//   bySourceId, bySourceName.
function _buildMergeIndex() {
  const merges = _readMerges();
  const bySourceId = {};
  const bySourceName = {};
  for (const [sourceId, destId] of Object.entries(merges)) {
    if (!destId) continue;
    const source = _findTagRecord(sourceId);
    const dest = _findTagRecord(destId);
    if (!source || !dest) continue;
    bySourceId[sourceId] = dest;
    bySourceName[String(source.name).toLowerCase()] = dest;
  }
  return { bySourceId, bySourceName };
}

// _resolveTagName — given an application string ("vsc-specialist") or
// applied-tag object ({id, name, applied_at}) returns the canonical
// (post-merge) tag name + the applied_at timestamp when available.
function _resolveTagApplication(raw, mergeIndex) {
  if (raw == null) return null;
  let id = null;
  let name = null;
  let applied_at = null;
  if (typeof raw === 'string') {
    name = raw;
  } else if (typeof raw === 'object') {
    id = raw.id || null;
    name = raw.name || null;
    applied_at = raw.applied_at || null;
  }
  // Apply merge redirect — id-match wins over name-match.
  if (id && mergeIndex.bySourceId[id]) {
    const dest = mergeIndex.bySourceId[id];
    return { id: dest.id, name: dest.name, applied_at };
  }
  if (name && mergeIndex.bySourceName[String(name).toLowerCase()]) {
    const dest = mergeIndex.bySourceName[String(name).toLowerCase()];
    return { id: dest.id, name: dest.name, applied_at };
  }
  return { id, name, applied_at };
}

// Compute applied_to_count + last_applied_at for a tag. Counts cases
// where the tag matches by NAME (the legacy fixture convention — system
// tags carry a slug-form `id` but apps store the human `name`) OR by
// `id` (when the application carries one).
//
// _TODO(opportunities): opportunities.json doesn't carry per-row `tags`
// today (tag-the-contact principle from canon/system-tags.json). We
// keep the parameter shape forward-compatible by reading
// `opp.tags || []` defensively — when opps gain a tags column the
// count surfaces automatically.
function _appliedToCount(tag, mergeIndex) {
  if (!tag) {
    return { users: 0, contacts: 0, opportunities: 0, total: 0, last_applied_at: null };
  }
  const targetName = String(tag.name || '').toLowerCase();
  const targetId = tag.id || null;
  let lastApplied = null;
  function recordTs(ts) {
    if (!ts) return;
    if (lastApplied == null || String(ts).localeCompare(lastApplied) > 0) {
      lastApplied = ts;
    }
  }

  function matches(application) {
    const resolved = _resolveTagApplication(application, mergeIndex);
    if (!resolved) return false;
    if (resolved.id && targetId && resolved.id === targetId) return true;
    if (resolved.name && resolved.name.toLowerCase() === targetName) return true;
    return false;
  }

  // Users (agents.json) — tags are string[].
  let users = 0;
  for (const a of _agents()) {
    const apps = Array.isArray(a.tags) ? a.tags : [];
    if (apps.some(matches)) {
      users += 1;
      for (const app of apps) {
        const r = _resolveTagApplication(app, mergeIndex);
        if (r && matches(app)) recordTs(r.applied_at);
      }
    }
  }
  // Contacts — tags are { id, name, applied_at, ... }[].
  let contacts = 0;
  for (const c of _contacts()) {
    const apps = Array.isArray(c.tags) ? c.tags : [];
    if (apps.some(matches)) {
      contacts += 1;
      for (const app of apps) {
        if (matches(app)) recordTs(app && app.applied_at);
      }
    }
  }
  // Opportunities — defensive read; field may not exist yet.
  // _TODO: when opportunities.json grows a `tags` column, this picks up
  // automatically. For now opportunities almost always returns 0.
  let opportunities = 0;
  for (const o of _opps()) {
    const apps = Array.isArray(o.tags) ? o.tags : [];
    if (apps.some(matches)) {
      opportunities += 1;
      for (const app of apps) {
        if (matches(app)) recordTs(app && app.applied_at);
      }
    }
  }
  const total = users + contacts + opportunities;
  return { users, contacts, opportunities, total, last_applied_at: lastApplied };
}

// ── Enrichment ───────────────────────────────────────────────────────

function _normalizeRow(raw, { isSystem, orgId }) {
  if (!raw) return null;
  return {
    id: raw.id,
    name: raw.name,
    color: raw.color || null,
    category: raw.category || null,
    description: raw.description || null,
    system: !!isSystem,
    // org_id is null for system tags (platform-wide) and numeric for
    // org-scoped tags. Surfaced so consumers (manager Tags screen) can
    // gate same-org-only operations like merge.
    org_id: isSystem ? null : (orgId != null ? Number(orgId) : null),
    created_by: raw.created_by || null,
    created_at: raw.created_at || null,
    archived_at: raw.archived_at || null,
  };
}

function _enrich(row, mergeIndex) {
  if (!row) return null;
  const stats = _appliedToCount(row, mergeIndex);
  return {
    ...row,
    applied_to_count: {
      users: stats.users,
      contacts: stats.contacts,
      opportunities: stats.opportunities,
      total: stats.total,
    },
    last_applied_at: stats.last_applied_at,
  };
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * List tags visible to a given org.
 *
 * Returns the union of:
 *   - canon `system_tags` (always; unless `include_system: false`)
 *   - canon `by_org[<org_id>]`
 *   - localStorage overlay `blinker.tags.v1.org.<org_id>` (this session's
 *     user-created + patches)
 *
 * When `org_ids: number[]` is passed instead of (or in addition to)
 * `org_id`, the per-org canon + overlay rows are UNIONED across every
 * id in the array. Used by the manager Tags screen in "All my orgs"
 * rollup mode so the rollup view shows every accessible org's tags
 * (W29b fu — bug A1). Duplicate ids across orgs are unlikely in practice
 * (id is `tag_<org_id>_<slug>_<ts>`) but a seen-set still de-dupes.
 *
 * Each row is enriched with `applied_to_count` (derived live from
 * agents.json + contacts.json + opportunities.json) + `last_applied_at`.
 *
 * Archived tags are filtered out unless `include_archived: true`. Merged
 * sources are treated as archived (their applied_to_count rolls up into
 * the destination).
 *
 * Idempotent — calling twice returns equivalent data.
 */
export function list({ org_id, org_ids, include_system = true, include_archived = false } = {}) {
  const archives = _readArchives();
  const merges = _readMerges();
  const mergeIndex = _buildMergeIndex();

  const out = [];

  if (include_system) {
    for (const t of _systemTags()) {
      const archivedAt = archives[t.id] || t.archived_at || null;
      if (archivedAt && !include_archived) continue;
      // System tags are not mergeable in Phase 1 (rejected at merge()),
      // so we don't apply the merge filter to them.
      const row = _normalizeRow({ ...t, archived_at: archivedAt }, { isSystem: true, orgId: null });
      out.push(_enrich(row, mergeIndex));
    }
  }

  // Resolve the effective org id list — explicit `org_ids` wins over
  // `org_id`. Both filter out null/undefined entries.
  let effectiveOrgIds = [];
  if (Array.isArray(org_ids) && org_ids.length > 0) {
    effectiveOrgIds = org_ids.filter((id) => id != null);
  } else if (org_id != null) {
    effectiveOrgIds = [org_id];
  }

  if (effectiveOrgIds.length > 0) {
    const seen = new Set();
    for (const oid of effectiveOrgIds) {
      const canonRows = _canonOrgTags(oid);
      const overlayRows = _readOrgOverlay(oid);

      for (const t of canonRows) {
        if (seen.has(t.id)) continue;
        const patch = overlayRows.find((o) => o.id === t.id);
        const merged = patch ? { ...t, ...patch } : t;
        const archivedAt = archives[merged.id] || merged.archived_at || null;
        const isMergedSource = !!merges[merged.id];
        if ((archivedAt || isMergedSource) && !include_archived) continue;
        const row = _normalizeRow(
          { ...merged, archived_at: archivedAt || (isMergedSource ? new Date().toISOString() : null) },
          { isSystem: false, orgId: oid },
        );
        out.push(_enrich(row, mergeIndex));
        seen.add(merged.id);
      }
      for (const t of overlayRows) {
        if (seen.has(t.id)) continue;
        const archivedAt = archives[t.id] || t.archived_at || null;
        const isMergedSource = !!merges[t.id];
        if ((archivedAt || isMergedSource) && !include_archived) continue;
        const row = _normalizeRow(
          { ...t, archived_at: archivedAt || (isMergedSource ? new Date().toISOString() : null) },
          { isSystem: false, orgId: oid },
        );
        out.push(_enrich(row, mergeIndex));
        seen.add(t.id);
      }
    }
  }

  // Stable order: system tags first (alpha by name), then org tags (alpha).
  return out.sort((a, b) => {
    if (!!b.system - !!a.system !== 0) return (!!b.system) - (!!a.system);
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

/**
 * Look up a single tag (by id) with enrichment applied. Returns null
 * when the id is unknown.
 */
export function get(id) {
  const rec = _findTagRecord(id);
  if (!rec) return null;
  const archives = _readArchives();
  const merges = _readMerges();
  const mergeIndex = _buildMergeIndex();
  const archivedAt =
    archives[id] || rec.archived_at || (merges[id] ? new Date().toISOString() : null);
  const isSys = _isSystemTagId(id);
  const orgKey = isSys ? null : _resolveTagOrgId(id);
  const row = _normalizeRow(
    { ...rec, archived_at: archivedAt },
    { isSystem: isSys, orgId: orgKey },
  );
  return _enrich(row, mergeIndex);
}

function _slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Create a new user tag scoped to an org. Writes to the org overlay.
 * `create_tags` permission gating is the caller's responsibility — this
 * SDK does not gate. Returns the new tag (enriched).
 */
export function create(org_id, { name, color, category, description } = {}) {
  if (org_id == null) throw new Error('tags.create: org_id required');
  const orgIdNum = Number(org_id);
  if (!Number.isFinite(orgIdNum)) {
    throw new Error(`tags.create: org_id must be numeric (got ${org_id})`);
  }
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('tags.create: name required');
  const ts = Date.now();
  const id = `tag_${String(orgIdNum)}_${_slugify(trimmed)}_${ts}`;
  const row = {
    id,
    name: trimmed,
    color: color || null,
    category: category || null,
    description: description || null,
    system: false,
    created_by: `manager_${String(orgIdNum)}_${ts}`,
    created_at: new Date(ts).toISOString(),
  };
  const overlay = _readOrgOverlay(orgIdNum);
  overlay.push(row);
  _writeOrgOverlay(orgIdNum, overlay);
  return get(id);
}

/**
 * Patch a tag (name / color / category / description). System tags are
 * rejected. For canon-org tags, the patch is layered over the canon row
 * in the org overlay (write-through); for overlay-only tags, the row
 * itself is updated.
 */
export function update(id, patch = {}) {
  if (!id) throw new Error('tags.update: id required');
  if (_isSystemTagId(id)) {
    throw new Error('system tags are read-only');
  }
  const orgKey = _resolveTagOrgId(id);
  if (!orgKey) throw new Error(`tags.update: unknown tag id ${id}`);
  const overlay = _readOrgOverlay(orgKey);
  const idx = overlay.findIndex((t) => t.id === id);
  const writable = {};
  for (const k of ['name', 'color', 'category', 'description']) {
    if (patch[k] !== undefined) writable[k] = patch[k];
  }
  if (idx >= 0) {
    overlay[idx] = { ...overlay[idx], ...writable };
  } else {
    // Layer a patch row over a canon row. The id matches canon; we
    // identify it as a patch by carrying only the id + the changed
    // fields. _findTagRecord merges {...canon, ...overlay} so the
    // canon row's untouched fields stay intact.
    overlay.push({ id, ...writable });
  }
  _writeOrgOverlay(orgKey, overlay);
  return get(id);
}

/**
 * Soft-delete a tag — sets `archived_at` in the archives overlay.
 * Existing applications across agents / contacts / opportunities are
 * retained; the tag is hidden from `list()` unless `include_archived:
 * true`. System tags are rejected.
 */
export function archive(id) {
  if (!id) throw new Error('tags.archive: id required');
  if (_isSystemTagId(id)) {
    throw new Error('system tags are read-only');
  }
  const archives = _readArchives();
  archives[id] = new Date().toISOString();
  _writeArchives(archives);
  return get(id);
}

/**
 * Convenience inverse of `archive` — drops the archive entry, surfacing
 * the tag in `list()` again. System tags are rejected.
 */
export function unarchive(id) {
  if (!id) throw new Error('tags.unarchive: id required');
  if (_isSystemTagId(id)) {
    throw new Error('system tags are read-only');
  }
  const archives = _readArchives();
  delete archives[id];
  _writeArchives(archives);
  return get(id);
}

/**
 * Merge `sourceId` into `destId`. In Phase 1 this is a logical merge
 * recorded in the merges overlay — applications across agents.json /
 * contacts.json / opportunities.json are NOT rewritten (those are
 * checked-in canon JSON). On read, `list()` + `listAppliedEntities()`
 * resolve source→dest via the merges overlay so the destination tag
 * absorbs the count + appears in usage reports.
 *
 * _TODO(Phase 2): real backend write — repoint applications across
 * entity tables and emit an audit record. Source is then archived
 * server-side. The Phase 1 overlay exists so a recoverable trail of
 * merges performed in demo carries forward.
 *
 * System tags are rejected as either source or destination.
 */
export function merge(sourceId, destId) {
  if (!sourceId || !destId) throw new Error('tags.merge: sourceId + destId required');
  if (sourceId === destId) throw new Error('tags.merge: sourceId === destId');
  if (_isSystemTagId(sourceId) || _isSystemTagId(destId)) {
    throw new Error('system tags are read-only');
  }
  const source = _findTagRecord(sourceId);
  const dest = _findTagRecord(destId);
  if (!source) throw new Error(`tags.merge: unknown source ${sourceId}`);
  if (!dest) throw new Error(`tags.merge: unknown dest ${destId}`);
  const merges = _readMerges();
  merges[sourceId] = destId;
  _writeMerges(merges);
  // Source is implicitly archived on read; also stamp it so unarchive()
  // doesn't accidentally re-surface a merged tag.
  const archives = _readArchives();
  archives[sourceId] = new Date().toISOString();
  _writeArchives(archives);
  return { source: get(sourceId), dest: get(destId) };
}

/**
 * Return the entities currently tagged with `id`, split by entity type.
 * Used by the side-panel usage report. Merge redirects are honored —
 * when `id` is a merge destination, callers also see the entities that
 * carried the source tag.
 */
export function listAppliedEntities(id) {
  const tag = _findTagRecord(id);
  if (!tag) return { users: [], contacts: [], opportunities: [] };
  const mergeIndex = _buildMergeIndex();
  const targetName = String(tag.name || '').toLowerCase();
  const targetId = tag.id || null;

  function matches(application) {
    const resolved = _resolveTagApplication(application, mergeIndex);
    if (!resolved) return false;
    if (resolved.id && targetId && resolved.id === targetId) return true;
    if (resolved.name && resolved.name.toLowerCase() === targetName) return true;
    return false;
  }

  const users = _agents().filter((a) => (a.tags || []).some(matches));
  const contacts = _contacts().filter((c) => (c.tags || []).some(matches));
  const opportunities = _opps().filter((o) => (o.tags || []).some(matches));
  return { users, contacts, opportunities };
}

export default {
  list,
  get,
  create,
  update,
  archive,
  unarchive,
  merge,
  listAppliedEntities,
};
