// AuthGate — sign-in wall for refi-portal.
//
// Renders <Login> until there is a valid session, then renders the app.
// Auto-authenticates (no login shown) when EITHER:
//   * a valid shared `blinker_session` cookie exists — i.e. the user already
//     logged in to MissionControl or another Blinker subdomain (SSO), or
//   * the page was opened via the MissionControl agent hand-off URL
//     (?external_user=true&access_token=…) — the existing co-pilot entry
//     point, which carries its own token and must not be blocked.
import { useState } from 'react';
import type { FC, ReactNode } from 'react';
import { isAuthed } from '../lib/session';
import { Login } from '../components/Login';

function hasHandoffToken(): boolean {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(window.location.search);
  return q.get('external_user') === 'true' && !!q.get('access_token');
}

interface AuthGateProps {
  children: ReactNode;
}

const AuthGate: FC<AuthGateProps> = ({ children }) => {
  const [authed, setAuthed] = useState(() => isAuthed() || hasHandoffToken());

  if (!authed) {
    return <Login onAuthed={() => setAuthed(true)} />;
  }
  return <>{children}</>;
};

export { AuthGate };
export default AuthGate;
