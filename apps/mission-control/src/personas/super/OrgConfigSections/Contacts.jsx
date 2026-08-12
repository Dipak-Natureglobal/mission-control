// Contacts.jsx — research Section 4.2.
// Per-org contact policy: TCPA copy, DNC policy, dedup match fields, tag
// presets, vehicle-defaults annual_mileage_estimate (lives on the org root,
// surfaced here because it's a contact-creation default).

import { Field, FormCard, TextInput, Select, NumberInput } from './_shared.jsx';
import systemTagsCanon from '../../../constants/canon/system-tags.json';

const DNC_POLICIES = [
  { value: 'honor', label: 'Honor — block all outbound on DNC contacts' },
  { value: 'prompt', label: 'Prompt — warn agent before sending' },
  { value: 'ignore', label: 'Ignore — no consumer-facing effect (audit only)' },
];

const DEDUP_FIELDS = [
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
  { id: 'name_dob', label: 'Name + DOB' },
];

function getCanonTagOptions() {
  // system-tags.json shape varies by canon revision; pull common surfaces.
  const tags = [];
  if (Array.isArray(systemTagsCanon.tags)) tags.push(...systemTagsCanon.tags);
  if (Array.isArray(systemTagsCanon.system_tags)) tags.push(...systemTagsCanon.system_tags);
  // De-dupe by id/value.
  const seen = new Set();
  const out = [];
  for (const t of tags) {
    const id = typeof t === 'string' ? t : t.id || t.value || t.label;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: typeof t === 'string' ? t : t.label || t.id });
  }
  return out;
}

export function ContactsSection({ form, set }) {
  const c = form.contacts || {};
  const tagOptions = getCanonTagOptions();

  function setC(patch) {
    set({ contacts: { ...c, ...patch } });
  }

  function toggleDedup(id) {
    const cur = Array.isArray(c.dedup_match_fields) ? c.dedup_match_fields : [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    setC({ dedup_match_fields: next });
  }

  function toggleTagPreset(id) {
    const cur = Array.isArray(c.tag_presets) ? c.tag_presets : [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    setC({ tag_presets: next });
  }

  return (
    <div className="space-y-4">
      <FormCard title="Vehicle defaults">
        <Field
          label="Annual mileage estimate"
          hint="Drives the mileage slider seed on ScreenVehicleDrive (vehicleAge × this value)."
        >
          <NumberInput
            value={form.vehicle_defaults?.annual_mileage_estimate}
            onChange={(v) =>
              set({
                vehicle_defaults: {
                  ...(form.vehicle_defaults || {}),
                  annual_mileage_estimate: v,
                },
              })
            }
            placeholder="12000"
          />
        </Field>
      </FormCard>

      <FormCard title="Do-not-contact policy">
        <Field label="Policy">
          <Select
            value={c.do_not_contact_policy || 'honor'}
            onChange={(v) => setC({ do_not_contact_policy: v })}
            options={DNC_POLICIES}
          />
        </Field>
      </FormCard>

      <FormCard title="Deduplication match fields">
        <div className="space-y-1.5">
          {DEDUP_FIELDS.map((f) => {
            const cur = Array.isArray(c.dedup_match_fields) ? c.dedup_match_fields : [];
            return (
              <label key={f.id} className="text-xs text-slate-700 inline-flex items-center gap-2 mr-4">
                <input
                  type="checkbox"
                  checked={cur.includes(f.id)}
                  onChange={() => toggleDedup(f.id)}
                />
                {f.label}
              </label>
            );
          })}
        </div>
        {Array.isArray(c.dedup_match_fields) && c.dedup_match_fields.length === 0 && (
          <div className="mt-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            No dedup fields selected — every inbound contact will be treated as new.
          </div>
        )}
      </FormCard>

      <FormCard title="Tag presets">
        {tagOptions.length === 0 ? (
          <div className="text-[11px] text-slate-500 italic">
            No system tags in canon yet — add them to <code className="font-mono">canon/system-tags.json</code>.
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {tagOptions.map((t) => {
              const cur = Array.isArray(c.tag_presets) ? c.tag_presets : [];
              const on = cur.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTagPreset(t.id)}
                  className={
                    'text-[10px] px-2 py-0.5 rounded-full border transition ' +
                    (on
                      ? 'bg-amber-50 text-amber-800 border-amber-300'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300')
                  }
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        )}
      </FormCard>

      <FormCard title="TCPA consent copy">
        <Field
          label="Consent text"
          hint="Use {{ORG_NAME}} for live interpolation. Falls back to canon/org-disclaimers.json default when blank."
        >
          <textarea
            value={c.tcpa_consent_copy || ''}
            onChange={(e) => setC({ tcpa_consent_copy: e.target.value })}
            rows={5}
            className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:border-amber-500"
            placeholder="By providing my contact information…"
          />
        </Field>
        {c.tcpa_consent_copy && (
          <div className="mt-2 border border-slate-200 rounded p-2 bg-white">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">
              Preview
            </div>
            <div className="text-[11px] text-slate-700 leading-relaxed">
              {(c.tcpa_consent_copy || '').replace(/\{\{ORG_NAME\}\}/g, form.name || '<org>')}
            </div>
          </div>
        )}
      </FormCard>

      <div className="text-[10px] text-slate-500 italic">
        Household-clustering rules and contact-creation automation are
        Phase-2 concerns — not yet exposed here.
      </div>
    </div>
  );
}

// keep TextInput import resolvable in case future fields need it
export { TextInput };
