// Lifted pattern from refi-prototype/src/refinance-v2-prototype.jsx ~L1249.
// TopBar shows the dev-panel toggle (Eye/EyeOff) and the app brand. The
// CLAUDE.md scaffold spec says it should read 'Protection Portal'.
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';

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
            <ShieldCheck className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold tracking-tight">Protection Portal</span>
          {view && (
            <>
              <span className="text-slate-300">/</span>
              <span className="text-sm text-slate-500 capitalize">{view} view</span>
            </>
          )}
        </div>
      </div>
      <div className="text-xs text-slate-500">Phase 1A · scaffolding</div>
    </div>
  );
}
