// AuthGate.test — the sign-in wall.
//
// Verifies the gate shows <Login> with no session, and renders the protected
// app when EITHER a valid shared cookie exists (SSO) OR the MissionControl
// agent hand-off token is present in the URL.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthGate } from './AuthGate';
import { clearSharedSession, writeSharedSession } from '../lib/session';
import type { SharedSession } from '../types';

const PROTECTED = 'PROTECTED-APP';

function freshSession(): SharedSession {
  return {
    access_token: { access_token: 'tok', expires_in: 7200, created_at: new Date().toISOString() },
    user: { email: 'agent@blinker.com' },
  };
}

beforeEach(() => {
  vi.stubEnv('VITE_BLINKER_API_URL', 'http://api.test');
  vi.stubEnv('VITE_SESSION_COOKIE_DOMAIN', '');
  localStorage.clear();
  clearSharedSession();
  window.history.pushState({}, '', '/');
});

describe('AuthGate', () => {
  it('shows the login wall when there is no session', () => {
    render(
      <AuthGate>
        <div>{PROTECTED}</div>
      </AuthGate>,
    );
    expect(screen.queryByText(PROTECTED)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('renders the app when a valid shared session exists (SSO)', () => {
    writeSharedSession(freshSession());
    render(
      <AuthGate>
        <div>{PROTECTED}</div>
      </AuthGate>,
    );
    expect(screen.getByText(PROTECTED)).toBeInTheDocument();
  });

  it('renders the app for the MissionControl agent hand-off URL', () => {
    window.history.pushState({}, '', '/?external_user=true&access_token=handoff_tok&view=agent');
    render(
      <AuthGate>
        <div>{PROTECTED}</div>
      </AuthGate>,
    );
    expect(screen.getByText(PROTECTED)).toBeInTheDocument();
  });
});
