// Dark sidebar shell + Section / Segmented chrome shared by every app.
// The view-specific controls (force outcomes, prefill, JsonPeek) live in
// each app's src/shell/DevControls.jsx; this file owns the chrome only.
//
// Wave 15c-fu: lifted to blinker-platform/components/ from
// protection-portal/src/shared/DevPanel.jsx (chosen as median; refi +
// insurance carried byte-identical bodies). mission-control diverged
// — different `DevPanel` prop shape (`{ title, subtitle, children }`)
// plus collapsible `Section` plus `Row` + `JsonBlock` extras. mc keeps
// its local divergent variant at mc/src/shared/DevPanel.jsx for now;
// convergence is a follow-up wave.
import { Settings } from 'lucide-react';

export function DevPanel({ open, children }) {
  if (!open) return null;
  return (
    <div className="w-80 shrink-0 bg-slate-900 text-slate-100 p-5 overflow-auto border-r border-slate-800 min-h-screen">
      <div className="flex items-center gap-2 mb-4">
        <Settings className="w-4 h-4" />
        <div className="font-semibold text-sm tracking-wide uppercase">Dev controls</div>
      </div>
      <p className="text-xs text-slate-400 mb-5 leading-relaxed">
        Force outcomes, prefill state, and jump between screens so we can
        iterate on every branch without re-entering data.
      </p>
      {children}
    </div>
  );
}

// Section — labeled chunk inside the dev panel.
export function Section({ label, children }) {
  return (
    <div className="mb-5">
      <div className="text-xs uppercase tracking-wide text-slate-400 font-semibold mb-2">
        {label}
      </div>
      {children}
    </div>
  );
}

// Segmented control — pill-style choice row.
export function Segmented({ value, onChange, options }) {
  return (
    <div className="flex bg-slate-800 rounded-md p-1 gap-1">
      {options.map((o) => {
        const v = o.v ?? o.value;
        const l = o.l ?? o.label;
        const active = value === v;
        return (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={
              'flex-1 text-xs px-2 py-1 rounded ' +
              (active
                ? 'bg-blue-600 text-white font-semibold'
                : 'text-slate-300 hover:bg-slate-700')
            }
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}
