// System.jsx — top-level org system configuration.
// Maps research-doc Section 4.1: identity (code, name_legal, name_dba, type,
// status, parent_org_id, timezone, test_mode, contact_email/phone) + support
// (support_email/phone, info/feedback emails, FAQ url, hours) + branding
// (call_center_*).
//
// Permission gates per research 5.1: name_legal, code, type, parent_org_id
// are super_admin-only — we don't currently distinguish persona inside the
// dialog (super_admin reaches it from the super shell), so all fields render
// editable. Add gating once the admin role gets its own entry point.

import { useState } from 'react';
import {
  Field,
  FormCard,
  TextInput,
  Select,
  CheckboxLabel,
  NumberInput,
} from './_shared.jsx';

const ORG_TYPES = ['internal', 'parent', 'child'];
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

export function SystemSection({ form, set, eligibleParentList }) {
  const sys = form.system || {};
  const [confirmTestMode, setConfirmTestMode] = useState(false);

  function setSys(patch) {
    set({ system: { ...sys, ...patch } });
  }

  function toggleTestMode(next) {
    if (next === !!form.test_mode) return;
    if (next === true) {
      setConfirmTestMode(true);
    } else {
      set({ test_mode: false });
    }
  }

  return (
    <div className="space-y-4">
      <FormCard title="Identity">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code" hint="Short org code (e.g. APEX). Unique.">
              <TextInput value={sys.code} onChange={(v) => setSys({ code: v })} mono />
            </Field>
            <Field label="Display name (DBA)">
              <TextInput value={form.name} onChange={(v) => set({ name: v })} />
            </Field>
          </div>
          <Field label="Legal name">
            <TextInput value={sys.name_legal} onChange={(v) => setSys({ name_legal: v })} />
          </Field>
          <Field label="DBA (formal)">
            <TextInput value={sys.name_dba} onChange={(v) => setSys({ name_dba: v })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <Select
                value={form.type || 'child'}
                onChange={(v) => set({ type: v })}
                options={ORG_TYPES}
              />
            </Field>
            <Field label="Status">
              <Select
                value={form.status || 'paused'}
                onChange={(v) => set({ status: v })}
                options={ORG_STATUSES}
              />
            </Field>
          </div>
          <Field
            label="Parent org"
            hint="Self + descendants are excluded from the dropdown to prevent cycles."
          >
            <select
              value={form.parent_org_id ?? ''}
              onChange={(e) =>
                set({
                  parent_org_id: e.target.value === '' ? null : Number(e.target.value),
                })
              }
              className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:border-amber-500"
            >
              <option value="">— none (root) —</option>
              {eligibleParentList.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} (#{o.id})
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Timezone">
              <Select
                value={form.timezone || 'America/Chicago'}
                onChange={(v) => set({ timezone: v })}
                options={TIMEZONES}
              />
            </Field>
            <Field label="GHL location id">
              <TextInput
                value={form.ghl_location_id}
                onChange={(v) => set({ ghl_location_id: v || null })}
                placeholder="(optional)"
                mono
              />
            </Field>
          </div>
          <Field label="Test mode">
            <CheckboxLabel
              checked={form.test_mode}
              onChange={(e) => toggleTestMode(e.target.checked)}
            >
              Sandbox routing for all integrations (confirm required to enable)
            </CheckboxLabel>
            {form.test_mode && (
              <div className="mt-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                Test mode is ON — every supporting integration will route to
                its sandbox endpoint. Disable here when promoting to live.
              </div>
            )}
          </Field>
        </div>
      </FormCard>

      <FormCard title="Org-level contact">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <TextInput
              value={sys.contact_email}
              onChange={(v) => setSys({ contact_email: v })}
            />
          </Field>
          <Field label="Phone">
            <TextInput
              value={sys.contact_phone}
              onChange={(v) => setSys({ contact_phone: v })}
            />
          </Field>
        </div>
      </FormCard>

      <FormCard title="Support / consumer-facing">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Support email">
              <TextInput
                value={sys.support_email}
                onChange={(v) => setSys({ support_email: v })}
              />
            </Field>
            <Field label="Support phone" hint="Required in legacy.">
              <TextInput
                value={sys.support_phone}
                onChange={(v) => setSys({ support_phone: v })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Info email">
              <TextInput
                value={sys.info_email}
                onChange={(v) => setSys({ info_email: v })}
              />
            </Field>
            <Field label="Feedback email">
              <TextInput
                value={sys.feedback_email}
                onChange={(v) => setSys({ feedback_email: v })}
              />
            </Field>
          </div>
          <Field label="FAQ url">
            <TextInput
              value={sys.faq_url}
              onChange={(v) => setSys({ faq_url: v })}
              placeholder="https://…"
            />
          </Field>
          <Field label="Support hours (display copy)">
            <textarea
              value={sys.support_hours_text || ''}
              onChange={(e) => setSys({ support_hours_text: e.target.value })}
              rows={2}
              className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:border-amber-500"
              placeholder="Mon–Fri 9am–6pm CT"
            />
          </Field>
          <Field label="Default lead-owner user id" hint="Auto-assigns inbound leads to this user.">
            <NumberInput
              value={sys.default_owner_id}
              onChange={(v) => setSys({ default_owner_id: v })}
              placeholder="(none)"
            />
          </Field>
        </div>
      </FormCard>

      <FormCard title="Call-center branding">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Display name">
              <TextInput
                value={sys.call_center_name}
                onChange={(v) => setSys({ call_center_name: v })}
              />
            </Field>
            <Field label="Code" hint="Short code; drives EFS routing.">
              <TextInput
                value={sys.call_center_code}
                onChange={(v) => setSys({ call_center_code: v })}
                mono
              />
            </Field>
          </div>
          <Field label="Logo path (S3)">
            <TextInput
              value={sys.call_center_logo_path}
              onChange={(v) => setSys({ call_center_logo_path: v })}
              placeholder="orgs/apex/logo.png"
              mono
            />
          </Field>
          <Field label="Portal link">
            <TextInput
              value={sys.call_center_link}
              onChange={(v) => setSys({ call_center_link: v })}
              placeholder="https://…"
            />
          </Field>
        </div>
      </FormCard>

      {confirmTestMode && (
        <ConfirmTestModeModal
          onConfirm={() => {
            set({ test_mode: true });
            setConfirmTestMode(false);
          }}
          onCancel={() => setConfirmTestMode(false)}
        />
      )}
    </div>
  );
}

function ConfirmTestModeModal({ onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-md w-full p-5">
        <div className="text-base font-semibold text-slate-900">Enable test mode?</div>
        <div className="text-xs text-slate-600 mt-2 leading-relaxed">
          Every supporting integration (FluidPay, Ensurety, FloPay, Twilio,
          Embedded Insurance, GHL, Mandrill, etc.) will route to its sandbox
          endpoint when this flag is on. Live transactions will not occur.
          You can flip it back off at any time.
        </div>
        <div className="flex items-center gap-2 justify-end mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs font-medium px-3 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="text-xs font-semibold px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white"
          >
            Enable test mode
          </button>
        </div>
      </div>
    </div>
  );
}
