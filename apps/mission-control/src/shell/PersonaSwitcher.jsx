import { ChevronDown } from 'lucide-react';
import { PERSONAS } from '../constants/nav.js';

// Persona switcher in the TopBar. Source of truth for which shell renders.
// In Phase 1 this is also exposed via DEV CONTROLS — same handler.
//
// PostHog: every change should fire `persona_switched`. The handler is owned by
// App.jsx so the analytics call lives there, not in this component.
export function PersonaSwitcher({ persona, onChange }) {
  return (
    <div className="relative">
      <select
        value={persona}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-medium rounded-md pl-3 pr-8 py-1.5 border border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {PERSONAS.map((p) => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-2 w-4 h-4 text-slate-500 pointer-events-none" />
    </div>
  );
}
