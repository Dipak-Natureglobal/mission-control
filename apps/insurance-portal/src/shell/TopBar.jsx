// Lifted pattern from protection-portal/src/shell/TopBar.jsx. TopBar
// shows the dev-panel toggle (Eye/EyeOff) and the app brand. CLAUDE.md
// scaffold spec says it should read 'Insurance Portal'.
import { Eye, EyeOff, Umbrella } from 'lucide-react';

export function TopBar({ panelOpen, togglePanel, view }) {
  return (
    <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-slate-200">
      <div className="flex items-center gap-3">
        <button
          onClick={togglePanel}
          className="p-2 rounded-md hover:bg-slate-100 text-slate-600"
          title={panelOpen ? 'Hide dev panel' : 'Show dev panel'}
        >
          {panelOpen ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-blue-600 rounded-md flex items-center justify-center">
            <Umbrella className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold tracking-tight">Insurance Portal</span>
          {view && (
            <>
              <span className="text-slate-300">/</span>
              <span className="text-sm text-slate-500 capitalize">{view} view</span>
            </>
          )}
        </div>
      </div>
      <div className="text-xs text-slate-500">Phase 1 · scaffolding</div>
    </div>
  );
}
