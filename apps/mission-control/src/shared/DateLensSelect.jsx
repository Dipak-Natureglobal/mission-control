import { Calendar as CalendarIcon } from 'lucide-react';
import { DATE_LENS_OPTIONS } from '../lib/canon.js';

// DateLensSelect — Wave 29c. Shared "Recent (30d) / Last Month / …"
// dropdown extracted from AgentHome's inline JSX. Consumed by AgentHome
// (Agent persona) and AgentProfile (Manager persona, team member view).
//
// Props:
//   value      — current lens token ('recent' | 'last_month' | …)
//   onChange   — (next) => void
//   options    — optional override list; defaults to DATE_LENS_OPTIONS
//   ariaLabel  — optional override; defaults to "Date filter"
export function DateLensSelect({
  value,
  onChange,
  options = DATE_LENS_OPTIONS,
  ariaLabel = 'Date filter',
}) {
  return (
    <div className="flex items-center gap-2">
      <CalendarIcon className="w-3.5 h-3.5 text-slate-400" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-sm border border-slate-200 rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label={ariaLabel}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
