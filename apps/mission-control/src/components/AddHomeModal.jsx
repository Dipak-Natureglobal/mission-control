import { useState } from 'react';
import { X, House, AlertTriangle } from 'lucide-react';
import { classifyDwelling, listHomeTypes } from 'blinker-platform/utils';
import planMappings from '../constants/canon/plan-mappings.json' with { type: 'json' };

// AddHomeModal — Wave 39 (ADR 30 C3). Centered backdrop modal, same chrome
// idiom as AddVehicleModal.jsx.
//
// Deliberately does NOT import home-protection-portal's HomeAdd step. That
// step fires the home GetRates call on Continue (see its own header
// comment: "WHY GETRATES FIRES FROM THIS STEP" — the covered-property
// address is the one rating input a home quote needs, so HomeAdd rates as
// soon as it has one). A modal that just wants to capture-or-edit a home
// record for a contact profile must NOT trigger a rate call as a side
// effect of a plain "Add home" click — that's a metered external SOAP call
// with no quote UI to show the result. So this renders the SAME field set
// (Home Type, address, Year Built, Square Feet, Purchase Price,
// Disposition — spec §2.5 / the legacy Mission Control "Add New Home"
// screen) as a LOCAL, standalone form and hands the built record to
// `onAdd`. Rating happens later, inside the wizard, when the agent
// actually starts a home protection opportunity for this home.
//
// Props:
//   open    — boolean; controls mount
//   onClose — fired on X / backdrop click
//   onAdd   — receives the new home record (canon `home` shape, minus
//             id/org_id/household_id/contact_ids/primary_contact_id/
//             source/created_at/updated_at — the caller's
//             appendHomeToContact stamps those) and is responsible for
//             closing the modal as needed.

const DWELLING_CANON = planMappings.home_dwelling_classes;

const INITIAL_FORM = {
  home_type: '',
  address1: '',
  address2: '',
  city: '',
  state: '',
  zip: '',
  year_built: '',
  square_feet: '',
  purchase_price: '',
  disposition: '',
};

function inputClass(error) {
  return (
    'w-full border rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-1 bg-white ' +
    (error
      ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500'
      : 'border-slate-300 focus:border-blue-500 focus:ring-blue-500')
  );
}

function LocalField({ label, value, onChange, placeholder, type = 'text', optional = false }) {
  return (
    <div>
      <div className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wide">
        {label}
        {optional && <span className="text-slate-400 normal-case font-normal"> (optional)</span>}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={inputClass(false)}
      />
    </div>
  );
}

export function AddHomeModal({ open, onClose, onAdd }) {
  const [form, setForm] = useState(INITIAL_FORM);

  if (!open) return null;

  const update = (patch) => {
    setForm((prev) => ({
      ...prev,
      ...(typeof patch === 'function' ? patch(prev) : patch),
    }));
  };

  const squareFeetNum = form.square_feet === '' ? null : Number(form.square_feet);
  const dwelling =
    form.home_type && squareFeetNum != null
      ? classifyDwelling({ home_type: form.home_type, square_feet: squareFeetNum }, DWELLING_CANON)
      : null;
  const showIneligibleWarning = form.home_type && squareFeetNum != null && !dwelling;

  const canSubmit =
    form.home_type &&
    form.address1.trim() &&
    form.city.trim() &&
    form.state.trim() &&
    squareFeetNum != null &&
    squareFeetNum > 0;

  function handleClose() {
    setForm(INITIAL_FORM);
    onClose();
  }

  function handleSubmit() {
    if (!canSubmit) return;
    const home = {
      home_type: form.home_type,
      address: {
        address1: form.address1.trim(),
        address2: form.address2.trim(),
        city: form.city.trim(),
        state: form.state.trim().toUpperCase(),
        zip: form.zip.trim(),
        zip4: '',
        country: 'US',
      },
      year_built: form.year_built === '' ? null : Number(form.year_built),
      square_feet: squareFeetNum,
      purchase_price: form.purchase_price === '' ? null : Number(form.purchase_price),
      disposition: form.disposition.trim() || null,
    };
    onAdd(home);
    setForm(INITIAL_FORM);
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
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <House className="w-4 h-4 text-slate-400" />
            Add home
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto px-4 py-4 space-y-3">
          <div>
            <div className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wide">
              Home type
            </div>
            <select
              value={form.home_type}
              onChange={(e) => update({ home_type: e.target.value })}
              className={inputClass(false) + ' appearance-none'}
            >
              <option value="">Select…</option>
              {listHomeTypes(DWELLING_CANON).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <LocalField
            label="Address"
            value={form.address1}
            onChange={(v) => update({ address1: v })}
            placeholder="123 Main St"
          />
          <LocalField
            label="Address line 2"
            value={form.address2}
            onChange={(v) => update({ address2: v })}
            placeholder="Unit / Apt"
            optional
          />
          <div className="grid grid-cols-3 gap-2.5">
            <LocalField label="City" value={form.city} onChange={(v) => update({ city: v })} />
            <LocalField label="State" value={form.state} onChange={(v) => update({ state: v })} placeholder="TX" />
            <LocalField label="Zip" value={form.zip} onChange={(v) => update({ zip: v })} />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <LocalField
              label="Year built"
              value={form.year_built}
              onChange={(v) => update({ year_built: v })}
              type="number"
            />
            <LocalField
              label="Square feet"
              value={form.square_feet}
              onChange={(v) => update({ square_feet: v })}
              type="number"
            />
          </div>
          <LocalField
            label="Purchase price"
            value={form.purchase_price}
            onChange={(v) => update({ purchase_price: v })}
            type="number"
            optional
          />
          <LocalField
            label="Disposition"
            value={form.disposition}
            onChange={(v) => update({ disposition: v })}
            optional
          />

          {/* ADR 30 R2 — the dwelling-class ceiling is INFERRED, not
              stated by Omega. Surfacing the ineligibility here (rather
              than silently allowing the add and only discovering it
              inside the wizard) lets the agent correct the square
              footage before it's saved to the contact profile. */}
          {showIneligibleWarning && (
            <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 ring-1 ring-amber-200 rounded-md p-2.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                This {form.home_type.replace('_', ' ')} at {Number(form.square_feet).toLocaleString()} sq ft
                is over the size ceiling for any Omega dwelling-class bucket — home protection
                cannot be quoted for it as entered.
              </span>
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-slate-100">
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full text-sm font-medium px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white"
          >
            Save home
          </button>
        </div>
      </div>
    </div>
  );
}
