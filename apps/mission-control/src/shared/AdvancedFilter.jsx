import { useMemo, useState } from 'react';
import { X, Filter as FilterIcon } from 'lucide-react';

// AdvancedFilter — reusable filter modal + pure `applyFilters` helper.
// Lifted in Wave 26a (Phase 1 of v.3.0.7 PDF) to back the new
// AgentInbox advanced filter affordance. Designed for reuse by Global
// Search and Contacts in later phases.
//
// API (component):
//   <AdvancedFilter
//     open={bool}
//     onClose={fn}
//     schema={[
//       {
//         key,                // stable identifier; values keyed by this
//         label,              // visible field label
//         field,              // dotted path used by the consumer's getter
//                             //   (e.g. 'contact.name.first', 'vehicle.vin',
//                             //   'opportunity.status'). AdvancedFilter
//                             //   itself is path-agnostic; the path is
//                             //   handed back to the consumer via the
//                             //   getter callback at filter time.
//         type,               // 'text' | 'date_range' | 'number_range' | 'enum'
//         enumValues,         // for type=enum: [{ value, label }] OR string[]
//         enumGroups,         // for type=enum: optional grouped form
//                             //   [{ groupLabel, values: [{value,label}|string] }]
//                             //   Each group renders a non-clickable subheader
//                             //   above its values. Selected values still flatten
//                             //   into a single string[] in values[key] — grouping
//                             //   is purely a render concern.
//                             //   When BOTH enumGroups and enumValues are present,
//                             //   enumGroups wins.
//         dynamicEnumValues,  // for type=enum: optional (stagedValues) => string[]
//                             //   (or [{value,label}][]). When present, the modal
//                             //   re-derives the enum on every render from the
//                             //   in-flight draft. Used for dependent filters
//                             //   (e.g. Owner restricted to whichever orgs are
//                             //   currently selected in the Organization filter).
//                             //   Wins over static enumValues when both present.
//         dynamicEnumGroups,  // for type=enum: same idea for grouped enums —
//                             //   (stagedValues) => [{groupLabel, values}]. Wins
//                             //   over dynamicEnumValues + static enumGroups.
//                             //   When the dynamic enum re-derives and previously-
//                             //   selected values are no longer in the option set,
//                             //   they are pruned automatically on next render.
//                             //   (Pure UI prune — `applyFilters` already filters
//                             //   by whatever the user committed, no change there.)
//         level,              // 'contact' | 'vehicle' | 'opportunity'
//                             //   (informational; consumer may group by it)
//         allowNull,          // for type=enum: when true, the rendered
//                             //   checklist gets a top-of-list option whose
//                             //   value is the literal NULL_VALUE sentinel
//                             //   (and label = `nullLabel` || 'Unassigned').
//                             //   When selected, applyFilters matches rows
//                             //   whose getter returns null/undefined/''.
//         nullLabel,          //   companion to allowNull. Default 'Unassigned'.
//       },
//       // Derived filter — runs a consumer-supplied computer over the row.
//       // Cheap "is the row stale?" predicates that don't fit the field-path
//       // model. Rendered as a small checkbox row in the modal.
//       {
//         key,
//         label,
//         type: 'derived',
//         computer: (row, stagedValues) => boolean,
//         defaultOn,          // optional: seeds draft[key] = true on first open
//       },
//       ...
//     ]}
//     values={currentValues}  // object keyed by schema[].key; component
//                             //   maintains a local draft, commits on Apply.
//     onApply={(values) => …}
//     onClear={() => …}
//   />
//
// API (pure helper):
//   applyFilters(rows, schema, values, getter)
//     - rows: any[]
//     - schema: same shape as above
//     - values: same shape as the component's `values` prop
//     - getter: (row, field) => value at that path — consumer-supplied so
//                 AdvancedFilter doesn't need to know the row shape (opps,
//                 contacts, merged contact-centric rows, …).
//   Returns: filtered rows.
//
// Value shapes by type:
//   text          : '' | 'partial substring (case-insensitive)'
//   date_range    : { min?: 'YYYY-MM-DD', max?: 'YYYY-MM-DD' }
//   number_range  : { min?: number, max?: number }
//   enum          : string[] (selected values; empty = no constraint).
//                   For `allowNull` fields, the NULL_VALUE sentinel can
//                   appear alongside real values.
//   derived       : boolean (true = active)
//
// Match semantics:
//   text          : case-insensitive substring; row passes if the
//                   getter-returned value (coerced to string) contains
//                   the query. Empty query = no constraint.
//   date_range    : parses min/max as YYYY-MM-DD local; row passes if
//                   the field value parsed as a Date falls in [min, max]
//                   (inclusive). Either bound may be omitted.
//   number_range  : numeric compare with inclusive bounds. Either bound
//                   may be omitted. Coerces strings via Number().
//   enum          : multi-select; row passes if the field value is in
//                   the selected set. Array fields (e.g. tags) pass if
//                   ANY element matches.
//
// Chips rendering is the consumer's responsibility — AdvancedFilter
// owns the modal only. The consumer reads `values`, decides which
// chips to render (typically one per non-empty key), and clears them
// individually by dispatching a new `values` object minus that key.

// Sentinel value for the "unassigned / null" option in allowNull enums.
// Picked to be deliberately ugly so it never collides with a real id.
export const NULL_VALUE = '__null__';

function isEmptyValue(type, v) {
  if (v == null) return true;
  if (type === 'text') return String(v).trim() === '';
  if (type === 'enum') return !Array.isArray(v) || v.length === 0;
  if (type === 'date_range' || type === 'number_range') {
    if (typeof v !== 'object') return true;
    const minEmpty = v.min === undefined || v.min === null || v.min === '';
    const maxEmpty = v.max === undefined || v.max === null || v.max === '';
    return minEmpty && maxEmpty;
  }
  if (type === 'derived') return v !== true;
  return false;
}

function matchText(rowVal, query) {
  if (rowVal == null) return false;
  if (Array.isArray(rowVal)) {
    return rowVal.some((x) => matchText(x, query));
  }
  if (typeof rowVal === 'object') {
    // Object scalar — try common shapes (string-like values), fall back
    // to JSON. Keeps the helper from quietly dropping object-shaped
    // fields like phones (array of objects, each with .number).
    return Object.values(rowVal).some((x) => matchText(x, query));
  }
  return String(rowVal).toLowerCase().includes(query);
}

function matchDateRange(rowVal, { min, max }) {
  if (rowVal == null) return false;
  const t = new Date(rowVal).getTime();
  if (Number.isNaN(t)) return false;
  if (min) {
    const tMin = new Date(min).getTime();
    if (!Number.isNaN(tMin) && t < tMin) return false;
  }
  if (max) {
    // Inclusive end-of-day for the max bound (a user picking "max =
    // 2026-05-10" intends to include all of that day).
    const tMax = new Date(max).getTime();
    if (!Number.isNaN(tMax)) {
      const tMaxEnd = tMax + 24 * 60 * 60 * 1000 - 1;
      if (t > tMaxEnd) return false;
    }
  }
  return true;
}

function matchNumberRange(rowVal, { min, max }) {
  const n = Number(rowVal);
  if (Number.isNaN(n)) return false;
  if (min !== undefined && min !== null && min !== '') {
    const nMin = Number(min);
    if (!Number.isNaN(nMin) && n < nMin) return false;
  }
  if (max !== undefined && max !== null && max !== '') {
    const nMax = Number(max);
    if (!Number.isNaN(nMax) && n > nMax) return false;
  }
  return true;
}

function matchEnum(rowVal, selected) {
  // Null-row support — when NULL_VALUE is in the selected set, rows whose
  // getter returns null/undefined/'' pass. Real-value rows are matched
  // against the rest of the selection.
  const wantsNull = selected.includes(NULL_VALUE);
  const isNullish = rowVal == null || rowVal === '';
  if (wantsNull && isNullish) return true;
  if (rowVal == null) return false;
  if (Array.isArray(rowVal)) {
    return rowVal.some((x) => selected.includes(x));
  }
  return selected.includes(rowVal);
}

export function applyFilters(rows, schema, values, getter) {
  if (!Array.isArray(rows) || !values || Object.keys(values).length === 0) {
    return rows;
  }
  const active = schema.filter((s) => !isEmptyValue(s.type, values[s.key]));
  if (active.length === 0) return rows;
  return rows.filter((row) =>
    active.every((s) => {
      const raw = values[s.key];
      if (s.type === 'derived') {
        if (typeof s.computer !== 'function') return true;
        try {
          return !!s.computer(row, values);
        } catch {
          return true;
        }
      }
      const v = getter(row, s.field);
      if (s.type === 'text') {
        const q = String(raw).trim().toLowerCase();
        if (!q) return true;
        return matchText(v, q);
      }
      if (s.type === 'date_range') return matchDateRange(v, raw);
      if (s.type === 'number_range') return matchNumberRange(v, raw);
      if (s.type === 'enum') return matchEnum(v, raw);
      return true;
    }),
  );
}

function normalizeEnumValues(enumValues) {
  if (!Array.isArray(enumValues)) return [];
  return enumValues.map((e) =>
    typeof e === 'string' ? { value: e, label: e } : e,
  );
}

// Normalize a field's enum config to a list of groups. Flat enumValues
// becomes a single group with groupLabel=null so the render layer can
// skip the subheader. Precedence (high → low):
//   dynamicEnumGroups(staged) → dynamicEnumValues(staged) → enumGroups → enumValues
// `stagedValues` is the modal's in-flight values object (uncommitted).
//
// Mental test cases:
//   (a) static schema: only enumValues / enumGroups present → returns the
//       same groups every call (no recomputation).
//   (b) dynamic enum: dynamicEnumValues(staged) returns a fresh list whose
//       contents depend on `staged` → groups recompute each render.
//   (c) prune: when (b) drops some values that were previously selected
//       in `values[key]`, the EnumChecklist render still shows the
//       remaining valid selection; the modal's auto-prune effect (in
//       AdvancedFilter) drops the stale ones from `draft[key]`.
function normalizeEnumGroups(field, stagedValues) {
  let groups;
  if (typeof field.dynamicEnumGroups === 'function') {
    const raw = field.dynamicEnumGroups(stagedValues || {});
    if (Array.isArray(raw)) {
      groups = raw
        .map((g) => ({
          groupLabel: g.groupLabel,
          opts: normalizeEnumValues(g.values),
        }))
        .filter((g) => g.opts.length > 0);
    }
  }
  if (!groups && typeof field.dynamicEnumValues === 'function') {
    const opts = normalizeEnumValues(field.dynamicEnumValues(stagedValues || {}));
    groups = opts.length === 0 ? [] : [{ groupLabel: null, opts }];
  }
  if (!groups && Array.isArray(field.enumGroups) && field.enumGroups.length > 0) {
    groups = field.enumGroups
      .map((g) => ({
        groupLabel: g.groupLabel,
        opts: normalizeEnumValues(g.values),
      }))
      .filter((g) => g.opts.length > 0);
  }
  if (!groups) {
    const opts = normalizeEnumValues(field.enumValues);
    groups = opts.length === 0 ? [] : [{ groupLabel: null, opts }];
  }
  // allowNull: prepend a sentinel null option to the first group. Lives
  // above any real value so it reads naturally in the checklist.
  if (field.allowNull) {
    const nullOpt = { value: NULL_VALUE, label: field.nullLabel || 'Unassigned' };
    if (groups.length === 0) {
      groups = [{ groupLabel: null, opts: [nullOpt] }];
    } else {
      groups = [
        { groupLabel: groups[0].groupLabel, opts: [nullOpt, ...groups[0].opts] },
        ...groups.slice(1),
      ];
    }
  }
  return groups;
}

// True when a field's enum option set depends on the staged draft (i.e.
// it uses dynamicEnumValues / dynamicEnumGroups). Used by the modal to
// decide whether to run the auto-prune check on each render.
function isDynamicEnum(field) {
  return (
    typeof field.dynamicEnumGroups === 'function' ||
    typeof field.dynamicEnumValues === 'function'
  );
}

function EnumOption({ opt, selected, onToggle, onOnly }) {
  return (
    <label
      key={opt.value}
      className="group flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-50 cursor-pointer text-sm"
    >
      <input
        type="checkbox"
        checked={selected.includes(opt.value)}
        onChange={() => onToggle(opt.value)}
        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
      />
      <span className="flex-1 text-slate-700 truncate">{opt.label}</span>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          onOnly(opt.value);
        }}
        className="opacity-0 group-hover:opacity-100 text-[11px] text-blue-600 hover:underline px-1"
        title="Only this"
      >
        Only
      </button>
    </label>
  );
}

function EnumChecklist({ field, draftValue, onChange, stagedValues }) {
  const groups = normalizeEnumGroups(field, stagedValues);
  const allOpts = groups.flatMap((g) => g.opts);
  const selected = Array.isArray(draftValue) ? draftValue : [];
  const allValues = allOpts.map((o) => o.value);
  const allSelected = selected.length === allValues.length && allValues.length > 0;
  const hasMultipleGroups = groups.length > 1;

  function toggle(value) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }
  function selectAll() {
    onChange(allValues);
  }
  function selectNone() {
    onChange([]);
  }
  function only(value) {
    onChange([value]);
  }
  // Per-group affordances — only meaningful when there are multiple
  // groups; for a single (flat) group these would duplicate the top-bar
  // Select-all / Select-none.
  function selectGroupOnly(group) {
    onChange(group.opts.map((o) => o.value));
  }
  function clearGroup(group) {
    const groupValues = new Set(group.opts.map((o) => o.value));
    onChange(selected.filter((v) => !groupValues.has(v)));
  }

  return (
    <div className="border border-slate-200 rounded-md bg-white">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-slate-200 bg-slate-50 text-[11px]">
        <span className="text-slate-500 uppercase tracking-wide font-semibold">
          {selected.length} of {allValues.length}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={selectAll}
            disabled={allSelected}
            className="px-1.5 py-0.5 rounded text-blue-600 hover:bg-blue-50 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Select all
          </button>
          <span className="text-slate-300">·</span>
          <button
            type="button"
            onClick={selectNone}
            disabled={selected.length === 0}
            className="px-1.5 py-0.5 rounded text-blue-600 hover:bg-blue-50 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Select none
          </button>
        </div>
      </div>
      <div className="max-h-60 overflow-auto px-1 py-1">
        {allOpts.length === 0 && (
          <div className="px-2 py-1 text-xs text-slate-400 italic">No values</div>
        )}
        {groups.map((group, gi) => {
          const groupValuesSet = new Set(group.opts.map((o) => o.value));
          const groupSelectedCount = selected.filter((v) => groupValuesSet.has(v)).length;
          return (
            <div key={group.groupLabel ?? `__flat__${gi}`} className={gi > 0 ? 'mt-1' : undefined}>
              {hasMultipleGroups && group.groupLabel && (
                <div className="group flex items-center justify-between px-2 py-1 text-[10px] uppercase tracking-wide font-semibold text-slate-400 bg-slate-50/60 border-y border-slate-100">
                  <span>
                    {group.groupLabel}
                    <span className="ml-1 normal-case tracking-normal font-normal text-slate-400">
                      ({groupSelectedCount}/{group.opts.length})
                    </span>
                  </span>
                  <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => selectGroupOnly(group)}
                      className="text-[10px] text-blue-600 hover:underline px-1"
                    >
                      Only
                    </button>
                    <span className="text-slate-300">·</span>
                    <button
                      type="button"
                      onClick={() => clearGroup(group)}
                      disabled={groupSelectedCount === 0}
                      className="text-[10px] text-blue-600 hover:underline px-1 disabled:opacity-40 disabled:hover:no-underline"
                    >
                      Clear
                    </button>
                  </span>
                </div>
              )}
              {group.opts.map((opt) => (
                <EnumOption
                  key={opt.value}
                  opt={opt}
                  selected={selected}
                  onToggle={toggle}
                  onOnly={only}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AdvancedFilter({
  open,
  onClose,
  schema,
  values,
  onApply,
  onClear,
}) {
  // Draft local state so typing in a text field doesn't fire onApply per
  // keystroke. Reset whenever the modal flips from closed to open — done
  // via state-during-render with a tracked `lastOpen` flag (the "store
  // information from previous renders" pattern, see
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders).
  // Avoids react-hooks/set-state-in-effect.
  const [draft, setDraft] = useState(values || {});
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      // Seed defaults from `values`, then layer any derived `defaultOn`
      // fields that the caller hasn't already set. This lets a consumer
      // declare "stuck is on by default" at the schema level while still
      // respecting an explicit `values[key] === false` override.
      const seeded = { ...(values || {}) };
      for (const s of schema) {
        if (s.type === 'derived' && s.defaultOn && seeded[s.key] === undefined) {
          seeded[s.key] = true;
        }
      }
      setDraft(seeded);
    }
  }

  // Auto-prune: any dynamic-enum field whose option set no longer
  // includes a previously-selected value gets pruned in `draft` so the
  // staged selection always reflects what's actually selectable. Run
  // during render via state-during-render (same pattern as `lastOpen`
  // above) so we don't trip react-hooks/set-state-in-effect.
  if (open) {
    const dynamicEnumFields = schema.filter(
      (s) => s.type === 'enum' && isDynamicEnum(s),
    );
    if (dynamicEnumFields.length > 0) {
      let patch = null;
      for (const s of dynamicEnumFields) {
        const current = Array.isArray(draft[s.key]) ? draft[s.key] : null;
        if (!current || current.length === 0) continue;
        const groups = normalizeEnumGroups(s, draft);
        const allowed = new Set(groups.flatMap((g) => g.opts).map((o) => o.value));
        const next = current.filter((v) => allowed.has(v));
        if (next.length !== current.length) {
          patch = patch || {};
          patch[s.key] = next;
        }
      }
      if (patch) {
        // Coalesce all dropped keys into a single setDraft to keep the
        // render scheduler happy. React de-dupes within a render pass.
        setDraft((prev) => ({ ...prev, ...patch }));
      }
    }
  }

  const activeCount = useMemo(() => {
    return schema.reduce(
      (acc, s) => (isEmptyValue(s.type, draft[s.key]) ? acc : acc + 1),
      0,
    );
  }, [draft, schema]);

  if (!open) return null;

  function setKey(key, v) {
    setDraft((prev) => ({ ...prev, [key]: v }));
  }

  function apply() {
    onApply(draft);
    onClose();
  }
  function clear() {
    setDraft({});
    if (onClear) onClear();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 backdrop-blur-sm p-4 overflow-auto">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mt-12 mb-6 flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <FilterIcon className="w-4 h-4 text-blue-500" />
            <h2 className="text-base font-semibold text-slate-900">Advanced filter</h2>
            {activeCount > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200">
                {activeCount} active
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1 rounded"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 px-5 py-4 grid grid-cols-2 gap-x-4 gap-y-3">
          {schema.map((field) => {
            const v = draft[field.key];
            if (field.type === 'text') {
              return (
                <div key={field.key} className="col-span-1">
                  <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    {field.label}
                  </label>
                  <input
                    type="text"
                    value={v ?? ''}
                    onChange={(e) => setKey(field.key, e.target.value)}
                    placeholder="partial match…"
                    className="w-full text-sm border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              );
            }
            if (field.type === 'date_range') {
              const r = (typeof v === 'object' && v) || {};
              return (
                <div key={field.key} className="col-span-1">
                  <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    {field.label}
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="date"
                      value={r.min ?? ''}
                      onChange={(e) => setKey(field.key, { ...r, min: e.target.value })}
                      className="flex-1 min-w-0 text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-slate-400 text-xs">→</span>
                    <input
                      type="date"
                      value={r.max ?? ''}
                      onChange={(e) => setKey(field.key, { ...r, max: e.target.value })}
                      className="flex-1 min-w-0 text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              );
            }
            if (field.type === 'number_range') {
              const r = (typeof v === 'object' && v) || {};
              return (
                <div key={field.key} className="col-span-1">
                  <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    {field.label}
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={r.min ?? ''}
                      placeholder="min"
                      onChange={(e) => setKey(field.key, { ...r, min: e.target.value })}
                      className="flex-1 min-w-0 text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-slate-400 text-xs">→</span>
                    <input
                      type="number"
                      value={r.max ?? ''}
                      placeholder="max"
                      onChange={(e) => setKey(field.key, { ...r, max: e.target.value })}
                      className="flex-1 min-w-0 text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              );
            }
            if (field.type === 'enum') {
              return (
                <div key={field.key} className="col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    {field.label}
                  </label>
                  <EnumChecklist
                    field={field}
                    draftValue={v}
                    onChange={(next) => setKey(field.key, next)}
                    stagedValues={draft}
                  />
                </div>
              );
            }
            if (field.type === 'derived') {
              return (
                <div key={field.key} className="col-span-1">
                  <label className="flex items-start gap-2 text-sm cursor-pointer select-none px-2 py-1.5 rounded-md hover:bg-slate-50 border border-slate-200 bg-white">
                    <input
                      type="checkbox"
                      checked={v === true}
                      onChange={(e) => setKey(field.key, e.target.checked)}
                      className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="flex-1">
                      <span className="block text-slate-800 font-medium">
                        {field.label}
                      </span>
                      {field.description && (
                        <span className="block text-[11px] text-slate-500 mt-0.5">
                          {field.description}
                        </span>
                      )}
                    </span>
                  </label>
                </div>
              );
            }
            return null;
          })}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between bg-slate-50 rounded-b-lg">
          <button
            type="button"
            onClick={clear}
            className="text-sm text-slate-500 hover:text-slate-800 px-2 py-1 rounded"
          >
            Clear all
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-md border border-slate-200 bg-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={apply}
              className="text-sm text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-md font-medium"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Convenience helper for chip rendering — turns a filter value into a
// short string description suitable for a chip. Consumers can opt to
// use it or build their own.
export function describeFilterValue(field, value) {
  if (isEmptyValue(field.type, value)) return null;
  if (field.type === 'text') return String(value);
  if (field.type === 'date_range') {
    const { min, max } = value;
    if (min && max) return `${min} → ${max}`;
    if (min) return `≥ ${min}`;
    if (max) return `≤ ${max}`;
    return null;
  }
  if (field.type === 'number_range') {
    const { min, max } = value;
    if (min !== undefined && min !== '' && max !== undefined && max !== '') {
      return `${min} → ${max}`;
    }
    if (min !== undefined && min !== '') return `≥ ${min}`;
    if (max !== undefined && max !== '') return `≤ ${max}`;
    return null;
  }
  if (field.type === 'enum') {
    const arr = Array.isArray(value) ? value : [];
    // Render the NULL sentinel as the field's nullLabel so chips read
    // naturally ("Owner: Unassigned" not "Owner: __null__").
    const labelFor = (v) =>
      v === NULL_VALUE ? field.nullLabel || 'Unassigned' : v;
    if (arr.length <= 2) return arr.map(labelFor).join(', ');
    return `${arr.slice(0, 2).map(labelFor).join(', ')} +${arr.length - 2}`;
  }
  if (field.type === 'derived') {
    return value === true ? 'on' : null;
  }
  return null;
}
