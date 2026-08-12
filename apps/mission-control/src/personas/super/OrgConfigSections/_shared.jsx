// _shared.jsx — primitives reused across the OrgConfigSections family.
// Extracted from OrgRegistry.jsx in W20 so each section file stays tight.
// Visual language matches the W19-era OrgRegistry dialog (amber super-admin
// accent, slate neutrals, terse labels).

export const inputCls =
  'w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white focus:outline-none focus:border-amber-500';

export function Field({ label, hint, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">
        {label}
      </div>
      {children}
      {hint && <div className="text-[10px] text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}

export function FormCard({ title, children }) {
  return (
    <div className="border border-slate-200 rounded p-3 bg-slate-50">
      {title && (
        <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-2">
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

export function CheckboxLabel({ checked, onChange, children }) {
  return (
    <label className="text-xs text-slate-700 inline-flex items-center gap-2">
      <input type="checkbox" checked={!!checked} onChange={onChange} />
      {children}
    </label>
  );
}

export function ReadOnlyRow({ label, value, mono }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-baseline gap-3 py-1.5 border-b border-slate-100 last:border-b-0">
      <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
        {label}
      </div>
      <div
        className={
          'text-xs text-slate-900 break-all ' + (mono ? 'font-mono' : '')
        }
      >
        {value == null || value === '' ? <span className="text-slate-400">—</span> : value}
      </div>
    </div>
  );
}

export function Chip({ children, tone = 'slate', icon }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700 border-slate-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
  };
  return (
    <span
      className={
        'inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium ' +
        (tones[tone] || tones.slate)
      }
    >
      {icon}
      {children}
    </span>
  );
}

// Number input that emits null when blank instead of NaN.
export function NumberInput({ value, onChange, step, placeholder, min, max }) {
  return (
    <input
      type="number"
      value={value ?? ''}
      step={step}
      min={min}
      max={max}
      placeholder={placeholder}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === '' ? null : Number(v));
      }}
      className={inputCls}
    />
  );
}

export function TextInput({ value, onChange, placeholder, mono }) {
  return (
    <input
      type="text"
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={inputCls + (mono ? ' font-mono' : '')}
    />
  );
}

export function Select({ value, onChange, options }) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className={inputCls}
    >
      {options.map((o) => (
        <option key={o.value ?? o} value={o.value ?? o}>
          {o.label ?? o}
        </option>
      ))}
    </select>
  );
}
