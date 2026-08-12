// TagPicker — reusable role-gated tag picker.
//
// Lifted from refi-portal/src/components/TagPicker.jsx in Wave 15c.
// Implementation byte-identical to the lift source; only two imports
// changed:
//   - `track` is now imported from blinker-platform's telemetry package
//     (../telemetry/index.js) instead of refi's local lib/posthog.js.
//   - `system-tags.json` is now read directly from canon
//     (../../canon/system-tags.json) instead of refi's synced
//     src/constants/canon/ copy.
// Both imports follow ADR 11's dep direction rules: packages/* MAY
// import sibling packages and MAY read ../canon/*.json directly.
//
// Reads the effective tag inventory from canon (system-tags.json):
//   inventory = [...system_tags, ...by_org[org_id], ...sessionCreated]
// Dedup rule from canon `_TODO`: case-insensitive name dedupe; system_tags
// wins (by_org / session-created with the same name are filtered).
//
// Permissions are gated by the parent (which reads canon/personas.json)
// and threaded through `canAdd` / `canCreate`:
//   - agent persona       → canAdd=true,  canCreate=false (search-existing only)
//   - manager / admin / sa → canAdd=true,  canCreate=true
//   - consumer            → canAdd=false, canCreate=false (read-only / hint)
//
// PostHog events (with `trackingPrefix='protection.agent.tag_picker'`):
//   - protection.agent.tag_picker.opened          (on dropdown first-open)
//   - protection.agent.tag_picker.tag_added       { tag_id, tag_name, tag_source }
//   - protection.agent.tag_picker.tag_removed     { tag_id, tag_name }
//   - protection.agent.tag_picker.tag_created     { tag_id, tag_name, persona } (manager+ only)
//
// Tag-source resolution:
//   'system'  → tag.system === true (canon system_tags)
//   'by_org'  → tag.system === false && existed in canon by_org[org_id]
//   'created' → tag.system === false && originated from this session
import { useEffect, useMemo, useRef, useState } from 'react';
import { Tag as TagIcon, X, Plus, Search } from 'lucide-react';
import systemTagsJson from '../../canon/system-tags.json';
import { track } from '../telemetry/index.js';

// Curated palette for newly-created tags. Avoids collision with system-tag
// hues so the visual taxonomy stays readable in the picker.
const CREATE_PALETTE = [
  '#14b8a6', // teal
  '#ec4899', // pink
  '#f43f5e', // rose
  '#6366f1', // indigo
  '#22c55e', // green
  '#eab308', // yellow
  '#0d9488', // dark teal
  '#d946ef', // fuchsia
];

function pickColor() {
  return CREATE_PALETTE[Math.floor(Math.random() * CREATE_PALETTE.length)];
}

function genTagId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `tag_${crypto.randomUUID()}`;
  }
  return `tag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Build the effective inventory: system + per-org + session-created. Dedup
// case-insensitively by name; system_tags win.
function buildInventory({ orgId, sessionCreated }) {
  const orgKey = String(orgId);
  const orgTags = systemTagsJson.by_org?.[orgKey] ?? [];
  const sysNames = new Set(
    systemTagsJson.system_tags.map((t) => t.name.toLowerCase()),
  );
  const seen = new Set(sysNames);
  const out = [...systemTagsJson.system_tags];
  for (const t of orgTags) {
    const k = t.name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  for (const t of sessionCreated || []) {
    const k = t.name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

// Group inventory by category, with un-categorized rolled into 'Other'.
const CATEGORY_ORDER = ['compliance', 'priority', 'lifecycle', 'language', 'followup', 'Other'];
function groupByCategory(tags) {
  const groups = new Map();
  for (const t of tags) {
    const k = t.category || 'Other';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  // Stable order: known categories first, then any extra alpha-sorted.
  const ordered = [];
  for (const k of CATEGORY_ORDER) {
    if (groups.has(k)) ordered.push([k, groups.get(k)]);
  }
  for (const [k, v] of groups) {
    if (!CATEGORY_ORDER.includes(k)) ordered.push([k, v]);
  }
  return ordered;
}

function tagSourceFor(tag, orgId, sessionCreated) {
  if (tag.system) return 'system';
  const created = (sessionCreated || []).some((t) => t.id === tag.id);
  if (created) return 'created';
  const orgTags = systemTagsJson.by_org?.[String(orgId)] ?? [];
  if (orgTags.some((t) => t.id === tag.id)) return 'by_org';
  return 'created';
}

export function TagPicker({
  selectedTagIds = [],
  onAdd,
  onRemove,
  onCreate,
  canAdd = false,
  canCreate = false,
  orgId,
  persona,
  sessionCreated = [],
  // Cross-app PostHog event-prefix knob. Default mirrors a generic
  // 'agent.tag_picker' namespace; embedders should pass their workflow-
  // scoped prefix (e.g. 'protection.agent.tag_picker').
  trackingPrefix = 'agent.tag_picker',
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [openedOnce, setOpenedOnce] = useState(false);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  const inventory = useMemo(
    () => buildInventory({ orgId, sessionCreated }),
    [orgId, sessionCreated],
  );

  // O(1) lookup by id for the applied-pill row.
  const byId = useMemo(() => {
    const m = new Map();
    for (const t of inventory) m.set(t.id, t);
    return m;
  }, [inventory]);

  const appliedTags = useMemo(
    () => selectedTagIds.map((id) => byId.get(id)).filter(Boolean),
    [selectedTagIds, byId],
  );

  // Filter inventory by query (substring, case-insensitive).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return inventory;
    return inventory.filter((t) => t.name.toLowerCase().includes(q));
  }, [query, inventory]);

  const grouped = useMemo(() => groupByCategory(filtered), [filtered]);

  // Whether the search text exactly matches an existing tag (ci).
  const exactMatch = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return true; // empty = nothing to "create"
    return inventory.some((t) => t.name.toLowerCase() === q);
  }, [query, inventory]);

  // Dropdown open/close: outside-click + Escape close handlers.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function openDropdown() {
    if (!canAdd) return;
    if (!openedOnce) {
      track(`${trackingPrefix}.opened`, { persona, org_id: orgId });
      setOpenedOnce(true);
    }
    setOpen(true);
  }

  function handleAdd(tag) {
    if (!canAdd) return;
    if (selectedTagIds.includes(tag.id)) return;
    onAdd?.(tag.id);
    track(`${trackingPrefix}.tag_added`, {
      tag_id: tag.id,
      tag_name: tag.name,
      tag_source: tagSourceFor(tag, orgId, sessionCreated),
      persona,
    });
    setQuery('');
    inputRef.current?.focus();
  }

  function handleRemove(tag) {
    if (!canAdd) return;
    onRemove?.(tag.id);
    track(`${trackingPrefix}.tag_removed`, {
      tag_id: tag.id,
      tag_name: tag.name,
      persona,
    });
  }

  function handleCreate() {
    if (!canCreate) return;
    const name = query.trim();
    if (!name) return;
    const tag = {
      id: genTagId(),
      name,
      color: pickColor(),
      category: undefined,
      system: false,
      created_by: persona,
      created_at: new Date().toISOString(),
    };
    onCreate?.(tag);
    track(`${trackingPrefix}.tag_created`, {
      tag_id: tag.id,
      tag_name: tag.name,
      persona,
    });
    setQuery('');
    inputRef.current?.focus();
  }

  const disabledMsg = !canAdd
    ? 'Tags are managed by your agent.'
    : null;

  return (
    <div ref={wrapperRef} className="space-y-2">
      {/* Applied tags pill row */}
      <div className="flex flex-wrap gap-1.5 min-h-[28px]">
        {appliedTags.length === 0 && (
          <span className="text-[11px] text-slate-500 italic py-1">No tags yet</span>
        )}
        {appliedTags.map((t) => (
          <span
            key={t.id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border"
            style={{
              backgroundColor: t.color + '20',
              color: t.color,
              borderColor: t.color + '40',
            }}
          >
            {t.name}
            {canAdd && (
              <button
                type="button"
                onClick={() => handleRemove(t)}
                className="ml-0.5 -mr-1 rounded-full hover:bg-black/10 p-0.5"
                aria-label={`Remove tag ${t.name}`}
                style={{ color: t.color }}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}
      </div>

      {/* Search input + dropdown */}
      <div className="relative">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            disabled={!canAdd}
            onChange={(e) => {
              setQuery(e.target.value);
              if (canAdd) setOpen(true);
            }}
            onFocus={openDropdown}
            placeholder={canAdd ? 'Search tags…' : disabledMsg}
            className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </div>

        {open && canAdd && (
          <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-72 overflow-auto">
            {grouped.length === 0 && !canCreate && (
              <div className="px-3 py-3 text-[11px] text-slate-500">
                {query.trim()
                  ? `No tags match "${query.trim()}". Ask a manager to create new tags.`
                  : 'No tags available.'}
              </div>
            )}
            {grouped.length === 0 && canCreate && !query.trim() && (
              <div className="px-3 py-3 text-[11px] text-slate-500">
                No tags available. Type to create a new tag.
              </div>
            )}
            {grouped.map(([cat, tags]) => (
              <div key={cat}>
                <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-slate-500 font-semibold bg-slate-50 sticky top-0">
                  {cat}
                </div>
                {tags.map((t) => {
                  const applied = selectedTagIds.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      disabled={applied}
                      onClick={() => handleAdd(t)}
                      className={
                        'w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50 ' +
                        (applied ? 'opacity-50 cursor-not-allowed' : '')
                      }
                    >
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <span
                          className="inline-block w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: t.color }}
                        />
                        <span className="truncate">{t.name}</span>
                      </span>
                      {applied && (
                        <span className="text-[10px] text-slate-400">Applied</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
            {canCreate && query.trim() && !exactMatch && (
              <button
                type="button"
                onClick={handleCreate}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs border-t border-slate-100 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                Create &ldquo;{query.trim()}&rdquo; tag
              </button>
            )}
          </div>
        )}
      </div>

      {/* Hint row */}
      {!canAdd && (
        <div className="text-[10px] text-slate-500 flex items-center gap-1">
          <TagIcon className="w-3 h-3" />
          {disabledMsg}
        </div>
      )}
      {canAdd && !canCreate && (
        <div className="text-[10px] text-slate-400">
          Search existing tags. Managers and admins can create new ones.
        </div>
      )}
    </div>
  );
}
