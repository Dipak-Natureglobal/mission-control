// Bare form-field primitives shared by every screen. Field is the base
// text input; PhoneField, DateField, SelectField, TextAreaField wrap it
// for common shapes.
//
// Wave 15c-fu: lifted to blinker-platform/components/ as a strict
// superset of the four per-app copies:
//   - protection-portal / insurance-portal / refi-portal: 115-116 line
//     copies, byte-identical, exporting Field + PhoneField + DateField
//     + SelectField. Native <select> arrow.
//   - mission-control: 111-line variant — drops PhoneField + DateField,
//     adds TextAreaField, adds `optional` flag + `type` prop on Field,
//     adds ChevronDown chrome on SelectField (appearance-none).
//
// Merge plan (additive — no existing consumer breaks):
//   - Field: protection's surface plus mc's `optional` flag + `type`
//     prop. Adopt mc's `value ?? ''` (handles 0 correctly where the
//     legacy `value || ''` would coerce 0 to ''). Label div renders
//     when `label || optional` is truthy.
//   - SelectField: protection's string-or-object options branch
//     (refi's EMPLOYMENT_TYPES is a string[] — must continue to work)
//     plus mc's appearance-none + ChevronDown chrome.
//   - PhoneField, DateField: refi/protection/insurance shape verbatim.
//   - TextAreaField: mc shape verbatim.
import { AlertCircle, ChevronDown } from 'lucide-react';

function formatPhoneDisplay(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function Field({
  label, value, onChange, placeholder, prefix, error,
  icon: Icon, inputMode, maxLength,
  type = 'text',
  optional,
}) {
  return (
    <div>
      {(label || optional) && (
        <div className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wide">
          {label}
          {optional && <span className="text-slate-400 normal-case font-normal"> (optional)</span>}
        </div>
      )}
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-2.5 text-slate-400 text-sm">{prefix}</span>
        )}
        {Icon && !prefix && (
          <Icon className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
        )}
        <input
          type={type}
          inputMode={inputMode}
          maxLength={maxLength}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={
            'w-full border rounded-md py-2 text-sm focus:outline-none focus:ring-1 ' +
            (error
              ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500'
              : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500') +
            ' ' +
            (prefix ? 'pl-7 pr-3' : Icon ? 'pl-9 pr-3' : 'px-3')
          }
        />
      </div>
      {error && (
        <div className="text-xs text-rose-600 mt-1 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {error}
        </div>
      )}
    </div>
  );
}

// Phone field — stores 10 digits, displays (###) ###-####.
export function PhoneField({ label, value, onChange, error }) {
  return (
    <Field
      label={label}
      value={formatPhoneDisplay(value)}
      onChange={(v) => onChange(String(v).replace(/\D/g, '').slice(0, 10))}
      placeholder="(555) 123-4567"
      inputMode="tel"
      maxLength={14}
      error={error}
    />
  );
}

// Date field — accepts MMDDYYYY or MM/DD/YYYY entry, stores raw.
export function DateField({ label, value, onChange, error, optional }) {
  return (
    <Field
      label={label + (optional ? ' (optional)' : '')}
      value={value}
      onChange={(v) => onChange(String(v).replace(/[^0-9/]/g, '').slice(0, 10))}
      placeholder="MMDDYYYY or MM/DD/YYYY"
      inputMode="numeric"
      maxLength={10}
      error={error}
    />
  );
}

export function SelectField({ label, value, onChange, options, error }) {
  return (
    <div>
      {label && (
        <div className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wide">
          {label}
        </div>
      )}
      <div className="relative">
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={
            'w-full appearance-none border rounded-md py-2 pl-3 pr-9 text-sm focus:outline-none focus:ring-1 bg-white ' +
            (error
              ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500'
              : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500')
          }
        >
          <option value="">Select...</option>
          {options.map((o) =>
            typeof o === 'string'
              ? <option key={o} value={o}>{o}</option>
              : <option key={o.value} value={o.value}>{o.label}</option>
          )}
        </select>
        <ChevronDown className="absolute right-3 top-2.5 w-4 h-4 text-slate-400 pointer-events-none" />
      </div>
      {error && (
        <div className="text-xs text-rose-600 mt-1 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {error}
        </div>
      )}
    </div>
  );
}

// Multiline text input — same chrome as Field, no prefix / icon affordances.
export function TextAreaField({ label, value, onChange, placeholder, rows = 4, error }) {
  return (
    <div>
      {label && (
        <div className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wide">
          {label}
        </div>
      )}
      <textarea
        rows={rows}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={
          'w-full border rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-1 ' +
          (error
            ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500'
            : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500')
        }
      />
      {error && (
        <div className="text-xs text-rose-600 mt-1 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {error}
        </div>
      )}
    </div>
  );
}
