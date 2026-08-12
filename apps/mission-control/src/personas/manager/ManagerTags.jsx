import { useEffect, useMemo, useState } from 'react';
import {
  Tag as TagIcon,
  Plus,
  X,
  ChevronRight,
  Pencil,
  Archive as ArchiveIcon,
  GitMerge,
  Filter as FilterIcon,
  Layers,
  Users as UsersIcon,
  Building2,
  ShieldCheck,
} from 'lucide-react';
import { blinkerApi } from 'blinker-platform/api';
import { track } from 'blinker-platform/telemetry';
import { useActiveOrg } from '../../shell/active-org-context.jsx';
import {
  AdvancedFilter,
  applyFilters,
  describeFilterValue,
} from '../../shared/AdvancedFilter.jsx';
import { relativeTime } from '../../lib/canon.js';
import personasCanon from '../../constants/canon/personas.json';
import orgRegistry from '../../constants/canon/org-registry.json';

function orgNameOf(orgId) {
  const orgs = orgRegistry.orgs || [];
  return orgs.find((o) => o.id === orgId)?.name || `Org ${orgId}`;
}

function firstActiveAccessibleOrg(accessibleOrgIds) {
  const orgs = orgRegistry.orgs || [];
  for (const id of accessibleOrgIds || []) {
    const o = orgs.find((x) => x.id === id);
    if (o && o.status === 'active') return id;
  }
  return accessibleOrgIds?.[0] ?? null;
}

// ManagerTags — Wave 29b. Tags namespace management.
//
// Spec: architecture/19-manager-experience.md §5.6.
//
// Two left-rail tabs: Tags (primary CRUD) + Presets (read-only canon
// reference). PRESET = canonical role-permission template tied to a
// persona. TAG = free-form label for grouping / routing / reporting.
//
// Gated by `create_tags` badge in the canon manager preset set —
// `manager_standard` + `manager_lead` see this nav entry;
// `manager_assign_only` does not (filtered out by getNavForManager).

const QUICK_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'in_use', label: 'In use' },
  { value: 'unused', label: 'Unused' },
  { value: 'recent', label: 'Recently added' },
];

const RECENT_WINDOW_MS = 7 * 24 * 3600 * 1000;

const COLOR_SWATCHES = [
  '#dc2626', '#ea580c', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#64748b', '#0f172a',
];

function ColorChip({ color, size = 'sm' }) {
  const dim = size === 'lg' ? 'w-4 h-4' : 'w-3 h-3';
  return (
    <span
      className={`inline-block ${dim} rounded-full ring-1 ring-inset ring-black/10 flex-shrink-0`}
      style={{ backgroundColor: color || '#cbd5e1' }}
    />
  );
}

function SourcePill({ system }) {
  return (
    <span
      className={
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ' +
        (system
          ? 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200'
          : 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200')
      }
    >
      {system ? 'system' : 'org'}
    </span>
  );
}

function CategoryPill({ category }) {
  if (!category) return <span className="text-slate-300 text-xs">—</span>;
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200">
      {category}
    </span>
  );
}

function appliedSummary(count) {
  if (!count || count.total === 0) return 'Unused';
  const parts = [];
  if (count.contacts) parts.push(`${count.contacts} contact${count.contacts === 1 ? '' : 's'}`);
  if (count.users) parts.push(`${count.users} user${count.users === 1 ? '' : 's'}`);
  if (count.opportunities) parts.push(`${count.opportunities} opp${count.opportunities === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

export function ManagerTags() {
  const { orgId, orgName, allOrgs, accessibleOrgIds } = useActiveOrg();
  const scopeLabel = allOrgs ? 'All my orgs' : orgName;

  const [tab, setTab] = useState('tags'); // 'tags' | 'presets'

  useEffect(() => {
    track('mission_control.manager.tags.opened', { tab });
  }, [tab]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50">
      <div className="px-6 pt-5 pb-3 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-2 text-emerald-600 mb-1">
          <TagIcon className="w-4 h-4" />
          <span className="text-xs uppercase tracking-wide font-semibold">Manager · Tags</span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          Tag namespace{scopeLabel ? ` · ${scopeLabel}` : ''}
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Manage the tag library for grouping, routing, and reporting. Presets are canonical role templates
          (separate from tags) — see the Presets tab for reference.
        </p>
      </div>

      <div className="flex-1 flex min-h-0">
        <aside className="w-48 border-r border-slate-200 bg-white py-3 px-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => setTab('tags')}
            className={
              'w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 mb-1 ' +
              (tab === 'tags'
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100'
                : 'text-slate-700 hover:bg-slate-50')
            }
          >
            <TagIcon className="w-4 h-4" />
            Tags
          </button>
          <button
            type="button"
            onClick={() => setTab('presets')}
            className={
              'w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 ' +
              (tab === 'presets'
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100'
                : 'text-slate-700 hover:bg-slate-50')
            }
          >
            <Layers className="w-4 h-4" />
            Presets
          </button>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {tab === 'tags' ? (
            <TagsTab orgId={orgId} allOrgs={allOrgs} accessibleOrgIds={accessibleOrgIds} />
          ) : (
            <PresetsTab />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tags tab ────────────────────────────────────────────────────────

function TagsTab({ orgId, allOrgs, accessibleOrgIds }) {
  // Versioned read — bump to re-read after mutations.
  const [tick, setTick] = useState(0);

  const allTags = useMemo(
    () => {
      const args = { include_system: true, include_archived: false };
      if (allOrgs) {
        args.org_ids = accessibleOrgIds || [];
      } else {
        args.org_id = orgId;
      }
      return blinkerApi.tags.list(args);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orgId, allOrgs, accessibleOrgIds, tick],
  );

  const [search, setSearch] = useState('');
  const [quick, setQuick] = useState('all');
  const [advOpen, setAdvOpen] = useState(false);
  const [advValues, setAdvValues] = useState({});
  const [right, setRight] = useState(null); // null | { kind: 'detail', tagId } | { kind: 'create' } | { kind: 'merge', sourceIds[] }
  const [selected, setSelected] = useState(new Set());

  function refresh() {
    setTick((n) => n + 1);
  }

  const categoryEnum = useMemo(() => {
    const seen = new Set();
    allTags.forEach((t) => { if (t.category) seen.add(t.category); });
    return Array.from(seen).sort().map((v) => ({ value: v, label: v }));
  }, [allTags]);

  const filterSchema = useMemo(() => ([
    {
      key: 'source',
      label: 'Source',
      field: 'tag.source',
      type: 'enum',
      enumValues: [
        { value: 'system', label: 'System' },
        { value: 'org', label: 'Org' },
      ],
      level: 'tag',
    },
    {
      key: 'applied_to',
      label: 'Applied to',
      field: 'tag.applied_to',
      type: 'enum',
      enumValues: [
        { value: 'any', label: 'Any (in use)' },
        { value: 'users', label: 'Users' },
        { value: 'contacts', label: 'Contacts' },
        { value: 'opportunities', label: 'Opportunities' },
      ],
      level: 'tag',
    },
    {
      key: 'category',
      label: 'Category',
      field: 'tag.category',
      type: 'enum',
      enumValues: categoryEnum,
      level: 'tag',
    },
    {
      key: 'last_applied_at',
      label: 'Last applied',
      field: 'tag.last_applied_at',
      type: 'date_range',
      level: 'tag',
    },
  ]), [categoryEnum]);

  function getter(row, field) {
    if (!field) return null;
    if (field === 'tag.source') return row.system ? 'system' : 'org';
    if (field === 'tag.applied_to') {
      // Multi-bucket — return an array so the enum matcher's array-OR
      // semantics naturally let any-of selection pass.
      const out = [];
      if (row.applied_to_count?.total > 0) out.push('any');
      if (row.applied_to_count?.users > 0) out.push('users');
      if (row.applied_to_count?.contacts > 0) out.push('contacts');
      if (row.applied_to_count?.opportunities > 0) out.push('opportunities');
      return out;
    }
    if (field === 'tag.category') return row.category || null;
    if (field === 'tag.last_applied_at') return row.last_applied_at || null;
    return null;
  }

  const filtered = useMemo(() => {
    let rows = allTags;
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((t) => String(t.name || '').toLowerCase().includes(q));
    if (quick === 'in_use') rows = rows.filter((t) => t.applied_to_count?.total > 0);
    if (quick === 'unused') rows = rows.filter((t) => !t.applied_to_count || t.applied_to_count.total === 0);
    if (quick === 'recent') {
      const cutoff = Date.now() - RECENT_WINDOW_MS;
      rows = rows.filter((t) => {
        const ts = Date.parse(t.created_at || '');
        return Number.isFinite(ts) && ts >= cutoff;
      });
    }
    rows = applyFilters(rows, filterSchema, advValues, getter);
    return rows;
  }, [allTags, search, quick, filterSchema, advValues]);

  function toggleSelected(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelected() {
    setSelected(new Set());
  }

  const selectedNonSystem = useMemo(() => {
    const out = [];
    for (const t of allTags) {
      if (selected.has(t.id) && !t.system) out.push(t);
    }
    return out;
  }, [selected, allTags]);

  // Merge is same-org-only in Phase 1 (per ADR). Compute whether the
  // current selection spans multiple orgs to drive the bulk-bar Merge
  // disabled state + tooltip.
  const selectedOrgIds = useMemo(() => {
    const set = new Set();
    for (const t of selectedNonSystem) {
      if (t.org_id != null) set.add(t.org_id);
    }
    return set;
  }, [selectedNonSystem]);
  const mergeBlockedByOrgSpan = selectedOrgIds.size > 1;

  function handleCreate(payload) {
    // In single-org mode the modal locks to the active org; in All-my-orgs
    // mode the modal surfaces an Org dropdown so the user picks. Either
    // way the modal calls back with `{ org_id, ...fields }`.
    const targetOrgId = payload?.org_id ?? orgId;
    if (targetOrgId == null) return;
    const { org_id: _ignored, ...fields } = payload || {};
    blinkerApi.tags.create(targetOrgId, fields);
    track('mission_control.manager.tags.created', {
      org_id: targetOrgId,
      name: fields?.name || null,
    });
    refresh();
    setRight(null);
  }

  function handleArchive(id) {
    blinkerApi.tags.archive(id);
    track('mission_control.manager.tags.archived', { tag_id: id });
    refresh();
    setRight(null);
  }

  function handleUpdate(id, patch) {
    blinkerApi.tags.update(id, patch);
    track('mission_control.manager.tags.updated', { tag_id: id, fields: Object.keys(patch || {}) });
    refresh();
  }

  function handleMergeConfirm(destId) {
    for (const t of selectedNonSystem) {
      if (t.id === destId) continue;
      blinkerApi.tags.merge(t.id, destId);
    }
    track('mission_control.manager.tags.merged', {
      source_ids: selectedNonSystem.map((t) => t.id),
      dest_id: destId,
    });
    clearSelected();
    refresh();
    setRight(null);
  }

  // Filter chips strip
  const chips = filterSchema
    .map((s) => {
      const desc = describeFilterValue(s, advValues[s.key]);
      if (!desc) return null;
      return { key: s.key, label: `${s.label}: ${desc}` };
    })
    .filter(Boolean);

  return (
    <div className="flex-1 flex min-h-0">
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-5 py-3 bg-white border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tag name…"
              className="text-sm border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 w-64"
            />
            <button
              type="button"
              onClick={() => setAdvOpen(true)}
              className="inline-flex items-center gap-1 text-sm text-slate-600 border border-slate-200 rounded-md px-2.5 py-1.5 hover:bg-slate-50"
            >
              <FilterIcon className="w-3.5 h-3.5" />
              Filters
              {chips.length > 0 && (
                <span className="ml-1 text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded ring-1 ring-inset ring-emerald-200">
                  {chips.length}
                </span>
              )}
            </button>
            <div className="flex items-center gap-1 ml-2">
              {QUICK_FILTERS.map((qf) => (
                <button
                  key={qf.value}
                  type="button"
                  onClick={() => setQuick(qf.value)}
                  className={
                    'text-xs px-2 py-1 rounded-md ' +
                    (quick === qf.value
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100')
                  }
                >
                  {qf.label}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setRight({ kind: 'create' })}
            disabled={!allOrgs && orgId == null}
            className="inline-flex items-center gap-1 text-sm bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-md font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            title={!allOrgs && orgId == null ? 'No active org' : 'Create a new tag'}
          >
            <Plus className="w-4 h-4" />
            New tag
          </button>
        </div>

        {chips.length > 0 && (
          <div className="px-5 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2 flex-wrap">
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => setAdvValues((prev) => {
                  const next = { ...prev };
                  delete next[chip.key];
                  return next;
                })}
                className="inline-flex items-center gap-1 text-[11px] bg-white border border-slate-200 rounded-full px-2 py-0.5 hover:bg-slate-100"
              >
                {chip.label}
                <X className="w-3 h-3 text-slate-400" />
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAdvValues({})}
              className="text-[11px] text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline"
            >
              Clear all
            </button>
          </div>
        )}

        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200">
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={selectedNonSystem.length > 0 && selectedNonSystem.length === filtered.filter((t) => !t.system).length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelected(new Set(filtered.filter((t) => !t.system).map((t) => t.id)));
                      } else {
                        clearSelected();
                      }
                    }}
                  />
                </th>
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Category</th>
                <th className="px-2 py-2">Applied to</th>
                <th className="px-2 py-2">Last applied</th>
                <th className="px-2 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400 italic">
                    No tags match the current filters.
                  </td>
                </tr>
              )}
              {filtered.map((t) => {
                const isOpen = right?.kind === 'detail' && right.tagId === t.id;
                return (
                  <tr
                    key={t.id}
                    onClick={() => setRight({ kind: 'detail', tagId: t.id })}
                    className={
                      'border-b border-slate-100 cursor-pointer ' +
                      (isOpen ? 'bg-emerald-50/50' : 'hover:bg-slate-50')
                    }
                  >
                    <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        disabled={t.system}
                        checked={selected.has(t.id)}
                        onChange={() => toggleSelected(t.id)}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <ColorChip color={t.color} />
                        <span className="font-medium text-slate-800 truncate">{t.name}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2"><CategoryPill category={t.category} /></td>
                    <td className="px-2 py-2">
                      <span className={t.applied_to_count?.total === 0 ? 'text-slate-400 italic' : 'text-slate-700'}>
                        {appliedSummary(t.applied_to_count)}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-slate-500 text-[12px]">
                      {t.last_applied_at ? relativeTime(t.last_applied_at) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-2 py-2"><SourcePill system={t.system} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {selectedNonSystem.length > 0 && (
          <div className="border-t border-slate-200 bg-emerald-50 px-5 py-2.5 flex items-center justify-between gap-3">
            <span className="text-sm text-emerald-900">
              {selectedNonSystem.length} tag{selectedNonSystem.length === 1 ? '' : 's'} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRight({ kind: 'merge', sourceIds: selectedNonSystem.map((t) => t.id) })}
                disabled={selectedNonSystem.length < 1 || mergeBlockedByOrgSpan}
                title={mergeBlockedByOrgSpan ? 'Tags must be in the same org to merge' : 'Merge selected tags'}
                className="inline-flex items-center gap-1 text-sm bg-white hover:bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-md text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <GitMerge className="w-3.5 h-3.5" />
                Merge into…
              </button>
              <button
                type="button"
                onClick={clearSelected}
                className="text-sm text-slate-500 hover:text-slate-700 px-2 py-1"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      {right?.kind === 'detail' && (
        <TagDetailPanel
          key={right.tagId}
          tagId={right.tagId}
          onClose={() => setRight(null)}
          onArchive={handleArchive}
          onUpdate={handleUpdate}
        />
      )}
      {right?.kind === 'create' && (
        <CreateTagModal
          orgId={orgId}
          allOrgs={allOrgs}
          accessibleOrgIds={accessibleOrgIds}
          onClose={() => setRight(null)}
          onCreate={handleCreate}
        />
      )}
      {right?.kind === 'merge' && (
        <MergeTagModal
          sources={selectedNonSystem}
          candidates={allTags.filter((t) => {
            if (t.system) return false;
            if (selectedNonSystem.some((s) => s.id === t.id)) return false;
            // Same-org-only — destination must belong to the same org as
            // the (single) source org. selectedOrgIds carries at most one
            // id when mergeBlockedByOrgSpan is false.
            if (selectedOrgIds.size === 1) {
              const [onlyOrg] = Array.from(selectedOrgIds);
              if (t.org_id !== onlyOrg) return false;
            }
            return true;
          })}
          onClose={() => setRight(null)}
          onConfirm={handleMergeConfirm}
        />
      )}

      <AdvancedFilter
        open={advOpen}
        onClose={() => setAdvOpen(false)}
        schema={filterSchema}
        values={advValues}
        onApply={setAdvValues}
        onClear={() => setAdvValues({})}
      />
    </div>
  );
}

// ─── Tag detail side panel ───────────────────────────────────────────

function TagDetailPanel({ tagId, onClose, onArchive, onUpdate }) {
  const [tick, setTick] = useState(0);
  const tag = useMemo(
    () => blinkerApi.tags.get(tagId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tagId, tick],
  );
  const applied = useMemo(
    () => blinkerApi.tags.listAppliedEntities(tagId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tagId, tick],
  );
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [colorDraft, setColorDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');

  useEffect(() => {
    if (tag) {
      setNameDraft(tag.name || '');
      setColorDraft(tag.color || '');
      setDescDraft(tag.description || '');
      setEditing(false);
    }
  }, [tagId, tag?.name, tag?.color, tag?.description]);

  if (!tag) {
    return (
      <aside className="w-[420px] border-l border-slate-200 bg-white flex flex-col flex-shrink-0">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <span className="text-sm text-slate-500">Tag not found</span>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      </aside>
    );
  }

  function save() {
    onUpdate(tag.id, {
      name: nameDraft.trim() || tag.name,
      color: colorDraft || tag.color,
      description: descDraft,
    });
    setTick((n) => n + 1);
    setEditing(false);
  }

  return (
    <aside className="w-[420px] border-l border-slate-200 bg-white flex flex-col flex-shrink-0 min-h-0">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
        <div className="flex items-center gap-2 min-w-0">
          <ColorChip color={tag.color} size="lg" />
          <span className="text-sm font-semibold text-slate-800 truncate">{tag.name}</span>
          <SourcePill system={tag.system} />
        </div>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 ml-2">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4 space-y-5">
        <section>
          <h3 className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-2">Details</h3>
          {editing ? (
            <div className="space-y-3 bg-slate-50 p-3 rounded-md border border-slate-200">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Name</label>
                <input
                  type="text"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Color</label>
                <ColorPicker value={colorDraft} onChange={setColorDraft} />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">Description</label>
                <textarea
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5"
                  rows={2}
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={save}
                  className="text-sm bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-md font-medium"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="text-sm text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-md border border-slate-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <dl className="text-sm grid grid-cols-3 gap-x-3 gap-y-1.5">
              <dt className="text-slate-500">Name</dt>
              <dd className="col-span-2 text-slate-800 font-medium">{tag.name}</dd>
              <dt className="text-slate-500">Color</dt>
              <dd className="col-span-2 flex items-center gap-2">
                <ColorChip color={tag.color} />
                <span className="font-mono text-[12px] text-slate-600">{tag.color || '—'}</span>
              </dd>
              <dt className="text-slate-500">Category</dt>
              <dd className="col-span-2"><CategoryPill category={tag.category} /></dd>
              <dt className="text-slate-500">Description</dt>
              <dd className="col-span-2 text-slate-700">{tag.description || <span className="text-slate-300">—</span>}</dd>
              <dt className="text-slate-500">Created</dt>
              <dd className="col-span-2 text-slate-700">{tag.created_at ? relativeTime(tag.created_at) : '—'}</dd>
              <dt className="text-slate-500">Created by</dt>
              <dd className="col-span-2 font-mono text-[12px] text-slate-600">{tag.created_by || '—'}</dd>
            </dl>
          )}
        </section>

        <section>
          <h3 className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-2">
            Applied to · {tag.applied_to_count?.total ?? 0}
          </h3>
          <AppliedSection title="Users" icon={UsersIcon} rows={applied.users} renderRow={(u) => (
            <span><span className="font-medium">{u.name}</span> <span className="text-slate-400 text-[11px]">{u.preset_id || ''}</span></span>
          )} />
          <AppliedSection title="Contacts" icon={Building2} rows={applied.contacts} renderRow={(c) => (
            <span className="font-medium">{c.name?.first} {c.name?.last}</span>
          )} />
          <AppliedSection title="Opportunities" icon={ShieldCheck} rows={applied.opportunities} renderRow={(o) => (
            <span><span className="font-medium">{o.type}</span> <span className="text-slate-400">·</span> {o.contact_name}</span>
          )} />
        </section>

        {!tag.system && (
          <section className="border-t border-slate-200 pt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing((e) => !e)}
              className="inline-flex items-center gap-1 text-sm border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-md text-slate-700"
            >
              <Pencil className="w-3.5 h-3.5" />
              {editing ? 'Stop editing' : 'Edit'}
            </button>
            <button
              type="button"
              onClick={() => onArchive(tag.id)}
              className="inline-flex items-center gap-1 text-sm border border-slate-200 hover:bg-red-50 hover:border-red-200 hover:text-red-700 px-3 py-1.5 rounded-md text-slate-700"
            >
              <ArchiveIcon className="w-3.5 h-3.5" />
              Archive
            </button>
          </section>
        )}

        {tag.system && (
          <section className="border-t border-slate-200 pt-4 text-[11px] text-slate-500 italic">
            System tags are read-only across all orgs.
          </section>
        )}
      </div>
    </aside>
  );
}

function AppliedSection({ title, icon: Icon, rows, renderRow }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 text-[11px] text-slate-500 uppercase tracking-wide mb-1">
        <Icon className="w-3.5 h-3.5" />
        {title} <span className="font-mono text-slate-400">({rows.length})</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-[12px] text-slate-300 italic pl-5">none</div>
      ) : (
        <ul className="space-y-0.5">
          {rows.slice(0, 12).map((r) => (
            <li key={r.id} className="pl-5 text-[12px] text-slate-700 truncate">
              {renderRow(r)}
            </li>
          ))}
          {rows.length > 12 && (
            <li className="pl-5 text-[11px] text-slate-400 italic">+{rows.length - 12} more</li>
          )}
        </ul>
      )}
    </div>
  );
}

// ─── Create tag modal ────────────────────────────────────────────────

function CreateTagModal({ orgId, allOrgs, accessibleOrgIds, onClose, onCreate }) {
  // In All-my-orgs mode the user picks the target org from a dropdown
  // (defaults to first active accessible org). In single-org mode the
  // active org is shown read-only.
  const initialTargetOrg = allOrgs
    ? firstActiveAccessibleOrg(accessibleOrgIds)
    : orgId;
  const [targetOrgId, setTargetOrgId] = useState(initialTargetOrg);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#10b981');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');

  const orgChoices = useMemo(() => {
    const orgs = orgRegistry.orgs || [];
    const ids = accessibleOrgIds || [];
    return ids
      .map((id) => orgs.find((o) => o.id === id))
      .filter(Boolean);
  }, [accessibleOrgIds]);

  function submit(e) {
    e?.preventDefault?.();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (targetOrgId == null) return;
    onCreate({
      org_id: targetOrgId,
      name: trimmed,
      color,
      category: category.trim() || null,
      description: description.trim() || null,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 backdrop-blur-sm p-4">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-xl w-full max-w-md mt-16 flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">Create tag</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">Org</label>
            {allOrgs ? (
              <select
                value={targetOrgId ?? ''}
                onChange={(e) => setTargetOrgId(Number(e.target.value))}
                className="w-full text-sm border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
              >
                {orgChoices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} {o.status !== 'active' ? `(${o.status})` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className="w-full text-sm border border-slate-200 rounded-md px-2.5 py-1.5 bg-slate-50 text-slate-700">
                {orgNameOf(orgId)}
                <span className="ml-2 text-[11px] text-slate-400">(active org)</span>
              </div>
            )}
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">Name</label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. high-touch, partner-pilot"
              className="w-full text-sm border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">Color</label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">Category</label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="optional (e.g. lifecycle, priority, language)"
              className="w-full text-sm border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="optional"
              className="w-full text-sm border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div className="text-[11px] text-slate-500">
            Tag will be added to <span className="font-mono">{targetOrgId != null ? orgNameOf(targetOrgId) : '—'}</span>. System tags are platform-wide; this tag is org-scoped.
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50 rounded-b-lg">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-md border border-slate-200 bg-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || targetOrgId == null}
            className="text-sm text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-md font-medium disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

function ColorPicker({ value, onChange }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center flex-wrap gap-1.5">
        {COLOR_SWATCHES.map((sw) => (
          <button
            key={sw}
            type="button"
            onClick={() => onChange(sw)}
            className={
              'w-6 h-6 rounded-full ring-1 ring-inset transition ' +
              (value === sw ? 'ring-2 ring-slate-900 scale-110' : 'ring-black/10 hover:scale-105')
            }
            style={{ backgroundColor: sw }}
            title={sw}
          />
        ))}
      </div>
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="#RRGGBB"
        className="w-32 text-[12px] font-mono border border-slate-200 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />
    </div>
  );
}

// ─── Merge modal ─────────────────────────────────────────────────────

function MergeTagModal({ sources, candidates, onClose, onConfirm }) {
  const [destId, setDestId] = useState(null);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((t) => String(t.name || '').toLowerCase().includes(q));
  }, [candidates, search]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mt-16 flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">Merge tags</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="text-sm text-slate-700">
            Repoint <span className="font-medium">{sources.length}</span> tag
            {sources.length === 1 ? '' : 's'} into a single destination. Source tags will be archived; existing
            applications will resolve to the destination on read.
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-1">Sources</div>
            <div className="flex flex-wrap gap-1.5">
              {sources.map((t) => (
                <span key={t.id} className="inline-flex items-center gap-1 text-[12px] bg-slate-100 px-2 py-0.5 rounded">
                  <ColorChip color={t.color} />
                  {t.name}
                </span>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-1">Destination</div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search destination tag…"
              className="w-full text-sm border border-slate-200 rounded-md px-2.5 py-1.5 mb-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <div className="max-h-60 overflow-auto border border-slate-200 rounded-md">
              {filtered.length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-slate-400 italic">No candidates</div>
              )}
              {filtered.map((t) => (
                <label
                  key={t.id}
                  className={
                    'flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer ' +
                    (destId === t.id ? 'bg-emerald-50' : 'hover:bg-slate-50')
                  }
                >
                  <input
                    type="radio"
                    checked={destId === t.id}
                    onChange={() => setDestId(t.id)}
                    className="text-emerald-600 focus:ring-emerald-500"
                  />
                  <ColorChip color={t.color} />
                  <span className="flex-1 truncate">{t.name}</span>
                  <span className="text-[11px] text-slate-500">{appliedSummary(t.applied_to_count)}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50 rounded-b-lg">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-md border border-slate-200 bg-white"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!destId}
            onClick={() => destId && onConfirm(destId)}
            className="text-sm text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-md font-medium disabled:opacity-40"
          >
            Merge
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Presets tab ─────────────────────────────────────────────────────

const PERSONA_ORDER = ['agent', 'manager', 'admin', 'super_admin'];
const PERSONA_LABELS = {
  agent: 'Agent',
  manager: 'Manager',
  admin: 'Admin',
  super_admin: 'Super Admin',
};

function PresetsTab() {
  const [selected, setSelected] = useState(null); // { persona, presetId } | null

  const presetGroups = useMemo(() => {
    const personas = personasCanon.personas || {};
    return PERSONA_ORDER
      .filter((p) => personas[p] && Array.isArray(personas[p].presets))
      .map((p) => ({
        persona: p,
        label: PERSONA_LABELS[p] || p,
        presets: personas[p].presets || [],
      }));
  }, []);

  const selectedRecord = useMemo(() => {
    if (!selected) return null;
    const personas = personasCanon.personas || {};
    const p = personas[selected.persona];
    if (!p) return null;
    const preset = (p.presets || []).find((x) => x.id === selected.presetId);
    if (!preset) return null;
    return { persona: selected.persona, label: PERSONA_LABELS[selected.persona], preset, personaPermissions: p.permissions || [] };
  }, [selected]);

  return (
    <div className="flex-1 flex min-h-0">
      <div className="flex-1 overflow-auto px-6 py-5 space-y-6">
        {presetGroups.map((group) => (
          <section key={group.persona}>
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wide">
                {group.label}
              </h2>
              <span className="text-[11px] text-slate-400 font-mono">({group.presets.length})</span>
            </div>
            <div className="space-y-1.5">
              {group.presets.map((preset) => {
                const isOpen = selected?.persona === group.persona && selected?.presetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setSelected({ persona: group.persona, presetId: preset.id })}
                    className={
                      'w-full text-left px-3 py-2 rounded-md border transition flex items-start gap-3 ' +
                      (isOpen
                        ? 'border-emerald-200 bg-emerald-50/50'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50')
                    }
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-slate-800">{preset.label}</span>
                        {preset.is_default && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200">
                            default
                          </span>
                        )}
                        <span className="font-mono text-[11px] text-slate-400">{preset.id}</span>
                      </div>
                      <p className="text-[12px] text-slate-500 mt-0.5">{preset.description}</p>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {(preset.badges || []).map((b) => (
                          <span
                            key={b}
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200 font-mono"
                          >
                            {b}
                          </span>
                        ))}
                      </div>
                    </div>
                    <ChevronRight className={'w-4 h-4 mt-1 ' + (isOpen ? 'text-emerald-600' : 'text-slate-300')} />
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        <section className="border-t border-slate-200 pt-4 mt-4">
          <p className="text-[12px] text-slate-500 leading-relaxed">
            Preset CRUD lives in the Super Admin canon editor — see{' '}
            <code className="font-mono bg-slate-100 px-1 py-0.5 rounded text-[11px]">canon/personas.json::personas.*.presets[]</code>.
            Edit there to add or remove presets platform-wide. Per-org overrides remain an open question (see canon <span className="font-mono">_TODO</span>).
          </p>
        </section>
      </div>

      {selectedRecord && (
        <aside className="w-[420px] border-l border-slate-200 bg-white flex flex-col flex-shrink-0 min-h-0">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">
                {selectedRecord.label} preset
              </span>
            </div>
            <button type="button" onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-700">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-auto px-4 py-4 space-y-5">
            <section>
              <h3 className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-2">Details</h3>
              <dl className="text-sm grid grid-cols-3 gap-x-3 gap-y-1.5">
                <dt className="text-slate-500">Label</dt>
                <dd className="col-span-2 text-slate-800 font-medium">{selectedRecord.preset.label}</dd>
                <dt className="text-slate-500">Id</dt>
                <dd className="col-span-2 font-mono text-[12px] text-slate-600">{selectedRecord.preset.id}</dd>
                <dt className="text-slate-500">Description</dt>
                <dd className="col-span-2 text-slate-700">{selectedRecord.preset.description || '—'}</dd>
                <dt className="text-slate-500">Default</dt>
                <dd className="col-span-2 text-slate-700">{selectedRecord.preset.is_default ? 'yes' : 'no'}</dd>
              </dl>
            </section>
            <section>
              <h3 className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-2">
                Badges · {(selectedRecord.preset.badges || []).length}
              </h3>
              <div className="flex flex-wrap gap-1">
                {(selectedRecord.preset.badges || []).map((b) => (
                  <span
                    key={b}
                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200 font-mono"
                  >
                    {b}
                  </span>
                ))}
              </div>
            </section>
            <section>
              <h3 className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-2">
                Persona permissions (canonical superset)
              </h3>
              <p className="text-[12px] text-slate-500 mb-1.5">
                This preset's badges are a subset of the persona-level permission list below.
              </p>
              <div className="flex flex-wrap gap-1">
                {selectedRecord.personaPermissions.map((p) => {
                  const inPreset = (selectedRecord.preset.badges || []).includes(p);
                  return (
                    <span
                      key={p}
                      className={
                        'inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono ring-1 ring-inset ' +
                        (inPreset
                          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                          : 'bg-slate-50 text-slate-500 ring-slate-200')
                      }
                    >
                      {p}
                    </span>
                  );
                })}
              </div>
            </section>
            <section className="border-t border-slate-200 pt-4">
              <p className="text-[11px] text-slate-500 italic">
                Read-only. Preset CRUD lives in Super Admin canon editor at <span className="font-mono">canon/personas.json::personas.{selectedRecord.persona}.presets[]</span>.
              </p>
            </section>
          </div>
        </aside>
      )}
    </div>
  );
}
