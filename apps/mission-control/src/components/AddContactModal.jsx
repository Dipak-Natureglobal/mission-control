import { Suspense, lazy, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, X } from 'lucide-react';
import {
  HOUSEHOLD_RELATIONSHIP_KINDS,
  buildHouseholdRelationship,
  findContactMatch,
  isValidEmail,
  isValidUSPhone10,
  isValidZip5,
  normalizePhoneE164,
  normalizeZip5,
  validateContactForm,
} from '../lib/contact-form.js';

// AddContactModal — centered backdrop modal for the agent's "+ Add contact"
// quick-action launcher (AgentHome) AND the inlined "+ Add new contact"
// branch inside StartOpportunityFlow's contact step.
//
// AddressBlock contract (blinker-platform/packages/components/index.js):
//   - Default field names are flat: form.zip / form.city / form.state /
//     form.address. Our canon contact shape nests these inside
//     addresses[0]. We use the `fieldNames` prop to remap to a one-level
//     dotted path (`address.zip`, etc.) so the AddressBlock writes into
//     a transient `form.address.{zip,city,state,street_address}` slice;
//     buildContactRecord() then re-shapes that slice into the canon
//     `addresses[0]` block on save. AddressBlock already does ZIP-only
//     lookup AND Google-Places-style street autocomplete inside one
//     component, so both modes coexist without further wiring.
//
// Validation:
//   - first/last name required
//   - phone OR email required (block save if both blank)
//   - zip required (5 digits)
//   - phone (when present) → 10 digits; email (when present) → looks valid
//
// Per-org dedupe:
//   - As soon as both phone AND email pass shape validation (or either
//     hits its threshold), we scan the session contacts map for a
//     same-org match on phone OR email. Cross-org matches are never
//     surfaced — see lib/contact-form.js findContactMatch().
//   - Same-name match → render "Existing contact" jump card; agent can
//     still proceed to override (rare) or jump to the existing record.
//   - Different-name match → render the household_relationship picker
//     (spouse / parent / child / sibling / other). On save we mint a
//     session household_relationship record alongside the new contact.
//
// DEV CONTROLS (production-shaped):
//   - The dedup result is what drives the UI branch; DEV CONTROLS only
//     INJECT a synthetic match into the predicate, leaving the real
//     code path intact. Modes:
//       'real'           — use findContactMatch against session contacts
//       'match-same'     — pretend the first contact in `contacts` matches
//                          AND has the same name as the form
//       'match-different'— pretend the first contact matches but with a
//                          different name
//       'no-match'       — force null match
//
// Props:
//   open       — boolean
//   onClose    — fired on X / backdrop click
//   onAdd      — receives ({ contact, householdRelationship? }). The
//                householdRelationship is non-null only when the agent
//                chose the relationship branch.
//   contacts   — session contacts map (id → contact). Used for dedupe.
//                Optional — when absent, dedupe is disabled (legacy
//                callers).
//   orgId      — current agent's org. Required for per-org dedupe; when
//                absent, all session contacts are eligible (least-safe
//                default; today every fixture is org_id=102 so this
//                degrades gracefully).
//   onJumpToContact — fn(contactId). Optional — when set, the same-name
//                "edit instead?" jump is enabled.

const AddressBlock = lazy(() =>
  import('blinker-platform/components').then((m) => ({ default: m.AddressBlock })),
);

const ADDRESS_FIELD_NAMES = {
  zip: 'address.zip',
  city: 'address.city',
  state: 'address.state',
  address: 'address.street_address',
};

const INITIAL_FORM = {
  first_name: '',
  last_name: '',
  phone: '',
  email: '',
  address: {
    zip: '',
    city: '',
    state: '',
    street_address: '',
  },
};

function newContactId() {
  const stamp =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}`;
  return `ct_session_${stamp}`;
}

// Build a canon contact record from the modal's form state. Mirrors the
// minimum fields of contacts.json (canon `contact` shape per
// blinker-domain.json) — id, household_id (null), name, phones[],
// emails[], addresses[], vehicles[], plus consent / attribution stubs
// the AgentInbox + ContactProfile read defensively.
function buildContactRecord(form, orgId) {
  const id = newContactId();
  const now = new Date().toISOString();
  const addr = form.address || {};
  const phoneE164 = normalizePhoneE164(form.phone);
  return {
    id,
    org_id: orgId ?? null,
    external_ids: {
      ghl_contact_id: null,
      posthog_distinct_id: id,
      external_lead_id: null,
    },
    household_id: null,
    name: {
      first: form.first_name.trim(),
      last: form.last_name.trim(),
    },
    // DOB intentionally not collected here — the insurance origination
    // form (insurance-portal LeadOriginationForm) gates on it. Other
    // workflows don't need it. Stays null until insurance touch.
    date_of_birth: null,
    phones: phoneE164
      ? [
          {
            id: `ph_${id}_1`,
            type: 'mobile',
            number: phoneE164,
            is_primary: true,
            sms_consent: true,
            sms_consent_at: now,
            sms_consent_text_id: 'sms_consent_v1',
            do_not_contact: false,
          },
        ]
      : [],
    emails: form.email.trim()
      ? [
          {
            id: `em_${id}_1`,
            type: 'personal',
            address: form.email.trim(),
            is_primary: true,
            opted_out: false,
          },
        ]
      : [],
    addresses:
      addr.zip || addr.street_address || addr.city
        ? [
            {
              id: `ad_${id}_1`,
              type: 'primary',
              line_1: addr.street_address || '',
              city: addr.city || '',
              state: addr.state || '',
              postal_code: normalizeZip5(addr.zip) || '',
              country: 'US',
              ownership: null,
              is_primary: true,
            },
          ]
        : [],
    vehicles: [],
    opportunity_ids: [],
    household_member_ids: [],
    tags: [],
    notes_ref: { collection: 'note', filter: { contact_id: id }, sort: 'created_at desc' },
    activities_ref: {
      collection: 'activity',
      filter: { contact_id: id },
      sort: 'occurred_at desc',
    },
    attribution_data: {
      first_utm_source: 'mission_control_manual',
      first_utm_medium: 'agent',
      first_landing_page: null,
      first_touch_at: now,
    },
    consent: {
      tcpa_consents: [],
      marketing_email: { opted_in: false },
      tos_accepted_at: null,
    },
    created_at: now,
    updated_at: now,
  };
}

// Synthetic match for DEV CONTROLS. Picks the first contact from the
// session map and overrides the name to force same-name vs different-name
// branches. Returns null if no contacts to base it on.
function buildDevMatch(mode, contacts, currentName) {
  if (mode === 'real' || mode === 'no-match') return null;
  const list = contacts ? Object.values(contacts) : [];
  if (!list.length) return null;
  const base = list[0];
  if (mode === 'match-same') {
    // Reshape so name matches the in-flight form.
    return {
      contact: {
        ...base,
        name: { first: currentName.first || base.name?.first, last: currentName.last || base.name?.last },
      },
      matchedOn: 'phone',
      sameName: true,
    };
  }
  if (mode === 'match-different') {
    return {
      contact: base,
      matchedOn: 'phone',
      sameName: false,
    };
  }
  return null;
}

export function AddContactModal({
  open,
  onClose,
  onAdd,
  contacts,
  orgId,
  onJumpToContact,
}) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [submitted, setSubmitted] = useState(false);
  // Relationship picker state — only rendered when a different-name match
  // surfaces. Once chosen, we mint a household_relationship record on save.
  const [relationship, setRelationship] = useState('');
  // DEV CONTROLS — production-shaped: only injects the predicate.
  const [devMatchMode, setDevMatchMode] = useState('real');

  // Shallow-merge update writer matching the useForm contract that
  // AddressBlock expects. Supports one-level dotted patches like
  // { 'address.zip': '78702' } via a tiny path-merge so AddressBlock's
  // `fieldNames` overrides land in the right nested slot. Functional
  // patches (patch(prev)) are also supported for symmetry with refi.
  const update = (patch) => {
    setForm((prev) => {
      const next = { ...prev };
      const fields = typeof patch === 'function' ? patch(prev) : patch;
      for (const key of Object.keys(fields)) {
        if (key.includes('.')) {
          const [head, tail] = key.split('.');
          next[head] = { ...(next[head] || {}), [tail]: fields[key] };
        } else {
          next[key] = fields[key];
        }
      }
      return next;
    });
  };

  // Live dedupe — fires once both name fields have a value AND at least
  // one of phone/email passes its shape check. We don't want to pop a
  // match card while the agent is half-typing a phone, so we gate on
  // shape validity rather than non-empty.
  const dedupeReady =
    !!form.first_name.trim() &&
    !!form.last_name.trim() &&
    ((isValidUSPhone10(form.phone) || form.phone.trim() === '')
      || (isValidEmail(form.email) || form.email.trim() === '')) &&
    (isValidUSPhone10(form.phone) || isValidEmail(form.email));

  const match = useMemo(() => {
    if (!dedupeReady) return null;
    const currentName = {
      first: form.first_name.trim(),
      last: form.last_name.trim(),
    };
    if (devMatchMode !== 'real') {
      return buildDevMatch(devMatchMode, contacts, currentName);
    }
    return findContactMatch(contacts, {
      phone: form.phone,
      email: form.email,
      orgId,
      currentName: `${currentName.first} ${currentName.last}`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dedupeReady,
    contacts,
    orgId,
    form.first_name,
    form.last_name,
    form.phone,
    form.email,
    devMatchMode,
  ]);

  // All hooks above must run unconditionally — early-return only after.
  if (!open) return null;

  const { errors } = validateContactForm(form);
  // Show errors only after the agent has tried to save once (prevents
  // form-load red-state). AddressBlock's own zip-lookup error UI is
  // independent.
  const showErrors = submitted;

  // Save is gated on:
  //   - all validateContactForm() rules pass
  //   - if a different-name match is showing, a relationship is picked
  //     (because that's the WHOLE point of that branch)
  //   - same-name matches don't gate save — agent can override by
  //     proceeding (re-confirming intent), but the dominant action card
  //     points them to the existing record.
  const needsRelationship = !!match && !match.sameName;
  const canSave =
    Object.keys(errors).length === 0 &&
    (!needsRelationship || !!relationship);

  function handleClose() {
    setForm(INITIAL_FORM);
    setSubmitted(false);
    setRelationship('');
    setDevMatchMode('real');
    onClose();
  }

  function handleSave() {
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    if (needsRelationship && !relationship) return;

    const contact = buildContactRecord(form, orgId);
    let householdRelationship = null;
    if (needsRelationship && match) {
      householdRelationship = buildHouseholdRelationship({
        existingContactId: match.contact.id,
        newContactId: contact.id,
        kind: relationship,
      });
    }
    onAdd({ contact, householdRelationship });
    setForm(INITIAL_FORM);
    setSubmitted(false);
    setRelationship('');
  }

  function handleJumpToExisting() {
    if (!match || !onJumpToContact) return;
    onJumpToContact(match.contact.id);
    handleClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="text-sm font-semibold text-slate-900">Add contact</div>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" required error={showErrors ? errors.first_name : null}>
              <input
                type="text"
                value={form.first_name}
                onChange={(e) => update({ first_name: e.target.value })}
                className={inputCls(showErrors && errors.first_name)}
                autoFocus
              />
            </Field>
            <Field label="Last name" required error={showErrors ? errors.last_name : null}>
              <input
                type="text"
                value={form.last_name}
                onChange={(e) => update({ last_name: e.target.value })}
                className={inputCls(showErrors && errors.last_name)}
              />
            </Field>
          </div>
          <Field
            label="Phone"
            error={showErrors ? errors.phone : null}
            hint="One of phone or email is required"
          >
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => update({ phone: e.target.value })}
              placeholder="(555) 555-5555"
              className={inputCls(showErrors && errors.phone)}
            />
          </Field>
          <Field
            label="Email"
            error={showErrors ? errors.email : null}
            hint="One of phone or email is required"
          >
            <input
              type="email"
              value={form.email}
              onChange={(e) => update({ email: e.target.value })}
              placeholder="name@example.com"
              className={inputCls(showErrors && errors.email)}
            />
          </Field>
          {/* Dedupe banner — same-name vs different-name vs no-match. */}
          {match && match.sameName && (
            <SameNameMatchCard
              match={match}
              onJump={onJumpToContact ? handleJumpToExisting : null}
            />
          )}
          {match && !match.sameName && (
            <DifferentNameMatchCard
              match={match}
              relationship={relationship}
              onRelationshipChange={setRelationship}
              showError={showErrors && needsRelationship && !relationship}
            />
          )}

          <div>
            <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
              Address
              <span className="text-rose-500">*</span>
            </div>
            <Suspense
              fallback={
                <div className="text-sm text-slate-400 py-2">Loading address fields…</div>
              }
            >
              {/*
                AddressBlock provides ZIP-only lookup (auto-fills city/state)
                AND Google-Places-style street autocomplete in one component.
                Both modes coexist — agent can type a ZIP first OR start
                typing a street address.
              */}
              <AddressBlock
                form={form}
                update={update}
                fieldNames={ADDRESS_FIELD_NAMES}
                autoFocusZip={false}
              />
            </Suspense>
            {showErrors && errors.zip && (
              <div className="text-[11px] text-rose-600 mt-1">{errors.zip}</div>
            )}
          </div>

          <DevControlsBlock
            mode={devMatchMode}
            onModeChange={setDevMatchMode}
            hasContacts={!!contacts && Object.keys(contacts).length > 0}
          />
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50">
          <button
            onClick={handleClose}
            className="text-sm font-medium px-3 py-1.5 rounded-md text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={submitted && !canSave}
            className={
              'text-sm font-medium px-3 py-1.5 rounded-md ' +
              (submitted && !canSave
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 text-white')
            }
          >
            Save contact
          </button>
        </div>
      </div>
    </div>
  );
}

function inputCls(hasError) {
  return (
    'w-full px-2.5 py-1.5 border rounded-md text-sm focus:outline-none focus:ring-2 ' +
    (hasError
      ? 'border-rose-300 focus:ring-rose-400'
      : 'border-slate-200 focus:ring-blue-500')
  );
}

function Field({ label, required, error, hint, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </span>
      {children}
      {error ? (
        <span className="block text-[11px] text-rose-600 mt-1">{error}</span>
      ) : hint ? (
        <span className="block text-[11px] text-slate-400 mt-1">{hint}</span>
      ) : null}
    </label>
  );
}

function SameNameMatchCard({ match, onJump }) {
  const c = match.contact;
  const display = `${c.name?.first ?? ''} ${c.name?.last ?? ''}`.trim();
  const primaryPhone = (c.phones || [])[0]?.number;
  const primaryEmail = (c.emails || [])[0]?.address;
  return (
    <div className="rounded-md p-3 bg-amber-50 ring-1 ring-amber-200 text-amber-900">
      <div className="flex items-start gap-2 mb-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="text-xs leading-relaxed">
          <div className="font-semibold">Existing contact: {display}</div>
          <div className="text-amber-800 mt-0.5">
            Matched on {match.matchedOn}. Edit the existing record instead of
            creating a duplicate.
          </div>
          <div className="text-amber-700 mt-1 font-mono text-[11px]">
            {[primaryPhone, primaryEmail].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>
      {onJump && (
        <button
          onClick={onJump}
          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white inline-flex items-center gap-1.5"
        >
          Open existing contact <ArrowRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function DifferentNameMatchCard({ match, relationship, onRelationshipChange, showError }) {
  const c = match.contact;
  const display = `${c.name?.first ?? ''} ${c.name?.last ?? ''}`.trim();
  return (
    <div className="rounded-md p-3 bg-sky-50 ring-1 ring-sky-200 text-sky-900">
      <div className="flex items-start gap-2 mb-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="text-xs leading-relaxed">
          <div className="font-semibold">
            {match.matchedOn === 'phone+email' ? 'Phone + email' : match.matchedOn === 'phone' ? 'Phone' : 'Email'}{' '}
            already used by {display}
          </div>
          <div className="text-sky-800 mt-0.5">
            Different name. Likely a household member — pick the relationship
            and we'll link the new contact.
          </div>
        </div>
      </div>
      <div className="text-[11px] uppercase tracking-wider font-semibold text-sky-700 mb-1.5">
        Relationship to {c.name?.first}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {HOUSEHOLD_RELATIONSHIP_KINDS.map((kind) => {
          const active = relationship === kind.value;
          return (
            <button
              key={kind.value}
              onClick={() => onRelationshipChange(kind.value)}
              className={
                'text-left text-xs px-2.5 py-1.5 rounded-md ring-1 transition-colors ' +
                (active
                  ? 'bg-sky-600 text-white ring-sky-700'
                  : 'bg-white text-sky-900 ring-sky-200 hover:ring-sky-400')
              }
            >
              {active && <Check className="inline w-3 h-3 mr-1 -mt-0.5" />}
              {kind.label}
            </button>
          );
        })}
      </div>
      {showError && (
        <div className="text-[11px] text-rose-600 mt-2">
          Pick a relationship to save (or change phone/email so it's not a match).
        </div>
      )}
    </div>
  );
}

function DevControlsBlock({ mode, onModeChange, hasContacts }) {
  return (
    <details className="rounded-md border border-dashed border-amber-300 bg-amber-50/50 p-2">
      <summary className="text-[10px] uppercase tracking-wider font-semibold text-amber-700 cursor-pointer">
        DEV CONTROLS · dedupe match emulation
      </summary>
      <div className="mt-2 space-y-1.5">
        <p className="text-[11px] text-amber-800 leading-relaxed">
          Injects a synthetic predicate result so prototype users can preview
          all branches without crafting a colliding contact. Production code
          path is identical — only the predicate changes.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {[
            { v: 'real', l: 'Real (default)' },
            { v: 'no-match', l: 'Force no-match' },
            { v: 'match-same', l: 'Match · same name' },
            { v: 'match-different', l: 'Match · different name' },
          ].map((opt) => {
            const active = mode === opt.v;
            const disabled =
              !hasContacts && (opt.v === 'match-same' || opt.v === 'match-different');
            return (
              <button
                key={opt.v}
                disabled={disabled}
                onClick={() => onModeChange(opt.v)}
                className={
                  'text-[11px] px-2 py-1 rounded ring-1 transition-colors ' +
                  (active
                    ? 'bg-amber-600 text-white ring-amber-700'
                    : disabled
                      ? 'bg-slate-100 text-slate-400 ring-slate-200 cursor-not-allowed'
                      : 'bg-white text-amber-800 ring-amber-300 hover:ring-amber-500')
                }
              >
                {opt.l}
              </button>
            );
          })}
        </div>
      </div>
    </details>
  );
}
