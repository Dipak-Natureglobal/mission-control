// Overview.jsx — first section of the v3.0.3 OrgRegistry edit dialog.
// Read-mostly metadata + a small inline-edit affordance for name / status /
// timezone (the three fields product flagged as routinely-edited). Includes
// a hierarchy mini-view (parent → this → children, clickable) and a
// configurations-array chip strip carried over from the legacy schema.

import { Building2, ChevronRight } from 'lucide-react';
import { Field, FormCard, ReadOnlyRow, Chip, TextInput, Select } from './_shared.jsx';

const ORG_STATUSES = ['active', 'paused', 'unknown'];
const TIMEZONES = [
  'America/Chicago',
  'America/New_York',
  'America/Los_Angeles',
  'America/Denver',
  'America/Phoenix',
  'America/Managua',
  'UTC',
];

export function OverviewSection({ form, set, allOrgs, onJumpToOrg }) {
  const parent = form.parent_org_id != null ? allOrgs.find((o) => o.id === form.parent_org_id) : null;
  const children = allOrgs.filter((o) => o.parent_org_id === form.id);

  return (
    <div className="space-y-4">
      <FormCard title="Org hierarchy">
        <HierarchyMini
          parent={parent}
          self={form}
          children={children}
          onJumpToOrg={onJumpToOrg}
        />
      </FormCard>

      <FormCard title="Identity">
        <div className="space-y-1">
          <ReadOnlyRow label="ID" value={form.id} mono />
          <ReadOnlyRow label="Type" value={form.type || 'child'} />
          <ReadOnlyRow label="GHL location" value={form.ghl_location_id || ''} mono />
          <ReadOnlyRow label="Users" value={form.users_count != null ? form.users_count : '—'} />
          <ReadOnlyRow label="Test mode" value={form.test_mode ? 'ON' : 'OFF'} />
          {form.created_at && <ReadOnlyRow label="Created" value={form.created_at} mono />}
        </div>
      </FormCard>

      <FormCard title="Inline edits">
        <div className="space-y-3">
          <Field label="Display name">
            <TextInput value={form.name} onChange={(v) => set({ name: v })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <Select
                value={form.status || 'paused'}
                onChange={(v) => set({ status: v })}
                options={ORG_STATUSES}
              />
            </Field>
            <Field label="Timezone">
              <Select
                value={form.timezone || 'America/Chicago'}
                onChange={(v) => set({ timezone: v })}
                options={TIMEZONES}
              />
            </Field>
          </div>
        </div>
      </FormCard>

      {Array.isArray(form.configurations) && form.configurations.length > 0 && (
        <FormCard title="Legacy configurations">
          <div className="flex flex-wrap gap-1.5">
            {form.configurations.map((c) => (
              <Chip key={c} tone="slate">{c}</Chip>
            ))}
          </div>
          <div className="text-[10px] text-slate-500 mt-2 italic">
            Carry-over from the legacy <code className="font-mono">configurations</code> table —
            in v3 each org has exactly one config; this strip is informational only.
          </div>
        </FormCard>
      )}

      <FormCard title="Contacts (org-level)">
        <div className="space-y-1">
          <ReadOnlyRow label="Email" value={form.system?.contact_email} />
          <ReadOnlyRow label="Phone" value={form.system?.contact_phone} />
        </div>
        <div className="text-[10px] text-slate-500 mt-2 italic">
          Edit org-level + support contacts in the System section.
        </div>
      </FormCard>
    </div>
  );
}

function HierarchyMini({ parent, self, children, onJumpToOrg }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {parent ? (
        <button
          type="button"
          onClick={() => onJumpToOrg && onJumpToOrg(parent)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-white hover:border-amber-400 hover:text-amber-700"
          title={`Jump to ${parent.name}`}
        >
          <Building2 className="w-3 h-3" />
          <span className="truncate max-w-[140px]">{parent.name}</span>
          <span className="text-[10px] text-slate-400 font-mono">#{parent.id}</span>
        </button>
      ) : (
        <span className="text-[10px] text-slate-400 italic">no parent (root)</span>
      )}
      <ChevronRight className="w-3 h-3 text-slate-400" />
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-300 bg-amber-50 text-amber-800 font-semibold">
        <Building2 className="w-3 h-3" />
        <span className="truncate max-w-[160px]">{self.name}</span>
        <span className="text-[10px] font-mono opacity-70">#{self.id}</span>
      </span>
      {children.length > 0 && (
        <>
          <ChevronRight className="w-3 h-3 text-slate-400" />
          <div className="flex flex-wrap items-center gap-1">
            {children.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onJumpToOrg && onJumpToOrg(c)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-white hover:border-amber-400 hover:text-amber-700"
                title={`Jump to ${c.name}`}
              >
                <span className="truncate max-w-[120px]">{c.name}</span>
                <span className="text-[10px] text-slate-400 font-mono">#{c.id}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
