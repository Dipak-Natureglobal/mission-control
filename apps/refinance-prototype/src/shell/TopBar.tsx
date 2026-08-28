import { FC } from 'react';
import { Eye, EyeOff, RefreshCcw, LogOut } from 'lucide-react';
import type { ViewType } from '../types';
import { currentUser, logout } from '../lib/session';

interface TopBarProps {
  panelOpen: boolean;
  togglePanel: () => void;
  view: ViewType;
  // When false, the dev-panel toggle is hidden (DEV CONTROLS disabled).
  showToggle?: boolean;
  // Click the "Refi Portal" logo → jump to the first wizard step (VIN form).
  onHome?: () => void;
}

const TopBar: FC<TopBarProps> = ({ panelOpen, togglePanel, view, showToggle = true, onHome }) => {
  // Real signed-in user (null for the MissionControl agent hand-off, whose
  // token lives only in the URL — nothing to sign out of there).
  const user = currentUser();
  const userLabel =
    user &&
    (user.email ||
      [user.first_name, user.last_name].filter(Boolean).join(' ') ||
      'Signed in');

  const handleLogout = (): void => {
    // Clears the shared cookie too → also signs out of MissionControl.
    logout();
    window.location.reload();
  };

  return (
    <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-slate-200">
      <div className="flex items-center gap-3">
        {showToggle && (
          <button
            onClick={togglePanel}
            className="p-2 rounded-md hover:bg-slate-100 text-slate-600"
            title={panelOpen ? 'Hide dev panel' : 'Show dev panel'}
          >
            {panelOpen ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
        <button
          type="button"
          onClick={onHome}
          disabled={!onHome}
          className="flex items-center gap-2 rounded-md p-1 -m-1 enabled:hover:bg-slate-100 disabled:cursor-default"
          title={onHome ? 'Back to the vehicle VIN form' : undefined}
        >
          <div className="w-7 h-7 bg-blue-600 rounded-md flex items-center justify-center">
            <RefreshCcw className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold tracking-tight">Refi Portal</span>
          {view && (
            <>
              <span className="text-slate-300">/</span>
              <span className="text-sm text-slate-500 capitalize">{view} view</span>
            </>
          )}
        </button>
      </div>
      <div className="flex items-center gap-3">
        {userLabel && (
          <>
            <span className="text-xs text-slate-500 hidden sm:inline">{userLabel}</span>
            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              title="Sign out (also signs out of MissionControl)"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </>
        )}
        <span className="text-xs text-slate-500">Phase 1.5b · scaffolding</span>
      </div>
    </div>
  );
};

export { TopBar };
export default TopBar;
