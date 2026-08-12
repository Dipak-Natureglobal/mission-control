// RelationshipTypes.jsx — W20 super-admin sub-form for managing per-org
// custom relationship types. System types are locked; custom types render
// with a remove × and an Add form.
//
// Persistence is direct (not part of the dialog dirty/save flow) since each
// type is an independent CRUD record on its own localStorage key. Save +
// Cancel for the dialog do NOT affect changes made here. The dialog's
// dirty banner does not include this sub-form for the same reason.

import { useState } from 'react';
import { Lock, Plus, Trash2 } from 'lucide-react';
import {
  Field,
  FormCard,
  TextInput,
  Select,
  Chip,
} from './_shared.jsx';
import {
  addRelationshipTypeOverride,
  getRelationshipCategories,
  getSystemRelationshipTypes,
  listRelationshipTypeOverrides,
  removeRelationshipTypeOverride,
} from '../../../lib/super-admin-storage.js';
import { track } from 'blinker-platform/telemetry';

export function RelationshipTypesSection({ orgId }) {
  const [systemTypes] = useState(() => getSystemRelationshipTypes());
  // Re-mount when orgId changes (parent should `key` on org id when jumping
  // between orgs in the dialog; OrgRegistry already does that on the dialog
  // itself, so the state initializer reseats correctly).
  const [customTypes, setCustomTypes] = useState(() =>
    listRelationshipTypeOverrides(orgId),
  );
  const [draft, setDraft] = useState({ id: '', label: '', category: 'household' });
  const [err, setErr] = useState(null);
  const [flash, setFlash] = useState(null);

  function refresh() {
    setCustomTypes(listRelationshipTypeOverrides(orgId));
  }

  function handleAdd() {
    setErr(null);
    const result = addRelationshipTypeOverride(orgId, draft);
    if (!result.ok) {
      setErr(result.error);
      return;
    }
    track('mission_control.super_admin.relationship_type_added', {
      org_id: orgId,
      type_id: result.entry.id,
    });
    setFlash(`Added "${result.entry.label}"`);
    setTimeout(() => setFlash(null), 1800);
    setDraft({ id: '', label: '', category: 'household' });
    refresh();
  }

  function handleRemove(entry) {
    const result = removeRelationshipTypeOverride(orgId, entry.id);
    if (result.ok) {
      track('mission_control.super_admin.relationship_type_removed', {
        org_id: orgId,
        type_id: entry.id,
      });
      setFlash(`Removed "${entry.label}"`);
      setTimeout(() => setFlash(null), 1800);
      refresh();
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-slate-500">
        Per-org custom relationship types. System types are locked (canon-shipped);
        custom additions live in <code className="font-mono">localStorage</code>
        {' '}and merge into the RelationshipPicker for this org.
      </div>

      <FormCard title="System types (locked)">
        <div className="flex flex-wrap gap-1.5">
          {systemTypes.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border bg-slate-100 text-slate-700 border-slate-300 font-medium"
              title={`${t.id} · ${t.category}`}
            >
              <Lock className="w-2.5 h-2.5" />
              {t.label}
            </span>
          ))}
        </div>
      </FormCard>

      <FormCard title={`Custom types for org #${orgId} (${customTypes.length})`}>
        {customTypes.length === 0 ? (
          <div className="text-[11px] text-slate-500 italic">
            No custom relationship types for this org yet.
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {customTypes.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border bg-amber-50 text-amber-800 border-amber-300 font-medium"
                title={`${t.id} · ${t.category}`}
              >
                {t.label}
                <button
                  type="button"
                  onClick={() => handleRemove(t)}
                  className="ml-1 text-amber-700 hover:text-rose-700"
                  title={`Remove ${t.label}`}
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </FormCard>

      <FormCard title="Add custom relationship type">
        <div className="grid grid-cols-3 gap-3">
          <Field label="ID" hint="snake_case, must not collide with system ids.">
            <TextInput
              value={draft.id}
              onChange={(v) => setDraft((d) => ({ ...d, id: v }))}
              placeholder="caregiver"
              mono
            />
          </Field>
          <Field label="Label">
            <TextInput
              value={draft.label}
              onChange={(v) => setDraft((d) => ({ ...d, label: v }))}
              placeholder="Caregiver"
            />
          </Field>
          <Field label="Category">
            <Select
              value={draft.category}
              onChange={(v) => setDraft((d) => ({ ...d, category: v }))}
              options={getRelationshipCategories()}
            />
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={handleAdd}
            disabled={!draft.id || !draft.label}
            className="text-xs font-semibold px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:hover:bg-amber-600 text-white inline-flex items-center gap-1.5"
          >
            <Plus className="w-3 h-3" />
            Add type
          </button>
          {err && (
            <span className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">
              {err}
            </span>
          )}
          {flash && (
            <Chip tone="emerald">{flash}</Chip>
          )}
        </div>
      </FormCard>

      <div className="text-[10px] text-slate-500 italic">
        Changes here persist immediately and are not affected by the dialog's
        Save / Cancel buttons.
      </div>
    </div>
  );
}
