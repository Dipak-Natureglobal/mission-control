import { Compass, Bell, User } from 'lucide-react';
import { PersonaSwitcher } from './PersonaSwitcher.jsx';
import { OrgSwitcher } from './OrgSwitcher.jsx';
import { GlobalSearch } from './GlobalSearch.jsx';

// Top chrome — title, persona switcher, light-touch user controls.
// The literal title is "Mission Control" per Phase 1 spec.
//
// Wave 26a Phase 2 — the search input was a placeholder; replaced with
// the wired-up <GlobalSearch> (v.3.0.7 PDF Task 2). Session is threaded
// in from App.jsx so the dropdown stays in sync with the rest of the
// shell. onContactClick fires when a result is clicked — App routes to
// the Contacts view with that contact pre-opened.
export function TopBar({ persona, onPersonaChange, session, onGlobalSearchContactClick }) {
  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center px-4 gap-4 shrink-0">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-md bg-blue-600 text-white flex items-center justify-center">
          <Compass className="w-4 h-4" />
        </div>
        <div className="font-semibold text-slate-900 tracking-tight">Mission Control</div>
      </div>

      <div className="flex-1 max-w-xl ml-6">
        <GlobalSearch
          session={session}
          onContactClick={onGlobalSearchContactClick}
        />
      </div>

      <div className="ml-auto flex items-center gap-3">
        <OrgSwitcher />
        <PersonaSwitcher persona={persona} onChange={onPersonaChange} />
        <button className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-600">
          <Bell className="w-4 h-4" />
        </button>
        <button className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-slate-700">
          <User className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
