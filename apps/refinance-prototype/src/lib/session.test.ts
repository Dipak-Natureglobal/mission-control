// session.test — refi-portal auth + cross-app SSO.
//
// Exercises the full login/SSO flow at the unit level (jsdom gives us real
// document.cookie + localStorage): the shared-cookie contract, expiry math,
// the Doorkeeper password-grant call (fetch mocked), Duo handling, the
// URL-token hand-off precedence, and logout.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiBaseUrl,
  clearSharedSession,
  currentSession,
  currentUser,
  isAuthed,
  logout,
  readSharedSession,
  sessionToken,
  submitLogin,
  writeSharedSession,
} from './session';
import type { SharedSession } from '../types';

const API = 'http://api.test';

// A token minted "now" — valid for 2h.
function freshSession(overrides: Partial<SharedSession> = {}): SharedSession {
  return {
    access_token: {
      access_token: 'tok_abc',
      token_type: 'bearer',
      expires_in: 7200,
      created_at: new Date().toISOString(),
    },
    user: { id: 1, email: 'agent@blinker.com' },
    ...overrides,
  };
}

function setUrl(search: string): void {
  window.history.pushState({}, '', `/${search}`);
}

beforeEach(() => {
  vi.stubEnv('VITE_BLINKER_API_URL', API);
  vi.stubEnv('VITE_SESSION_COOKIE_DOMAIN', '');
  localStorage.clear();
  clearSharedSession();
  setUrl('');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('shared cookie', () => {
  it('round-trips a session through the cookie', () => {
    const session = freshSession();
    writeSharedSession(session);
    expect(readSharedSession()).toEqual(session);
  });

  it('clearSharedSession removes the cookie', () => {
    writeSharedSession(freshSession());
    clearSharedSession();
    expect(readSharedSession()).toBeNull();
  });

  it('readSharedSession returns null on a malformed cookie', () => {
    document.cookie = 'blinker_session=not%20json; Path=/';
    expect(readSharedSession()).toBeNull();
  });
});

describe('currentSession / isAuthed', () => {
  it('is null with no session anywhere', () => {
    expect(currentSession()).toBeNull();
    expect(isAuthed()).toBe(false);
    expect(currentUser()).toBeNull();
  });

  it('authenticates from a valid cookie and mirrors it to localStorage', () => {
    writeSharedSession(freshSession());
    expect(isAuthed()).toBe(true);
    expect(currentUser()).toMatchObject({ email: 'agent@blinker.com' });
    // mirrored down to the same localStorage keys MissionControl uses
    expect(JSON.parse(localStorage.getItem('accessToken')!).access_token).toBe('tok_abc');
    expect(JSON.parse(localStorage.getItem('userData')!).email).toBe('agent@blinker.com');
  });

  it('re-broadcasts a localStorage-only session to the shared cookie', () => {
    const session = freshSession();
    localStorage.setItem('accessToken', JSON.stringify(session.access_token));
    localStorage.setItem('userData', JSON.stringify(session.user));
    expect(readSharedSession()).toBeNull(); // nothing in the cookie yet
    expect(isAuthed()).toBe(true);
    expect(readSharedSession()).toEqual(session); // now broadcast for MC
  });

  it('rejects an expired token', () => {
    writeSharedSession({
      access_token: {
        access_token: 'old',
        expires_in: 60,
        created_at: new Date(Date.now() - 3600 * 1000).toISOString(),
      },
      user: { email: 'x@y.com' },
    });
    expect(isAuthed()).toBe(false);
  });
});

describe('sessionToken', () => {
  it('prefers the MissionControl hand-off token in the URL', () => {
    writeSharedSession(freshSession()); // logged-in token is tok_abc
    setUrl('?access_token=handoff_tok&external_user=true');
    expect(sessionToken()).toBe('handoff_tok');
  });

  it('falls back to the logged-in session token', () => {
    writeSharedSession(freshSession());
    expect(sessionToken()).toBe('tok_abc');
  });

  it('is empty with neither', () => {
    expect(sessionToken()).toBe('');
  });
});

describe('submitLogin', () => {
  it('persists session + broadcasts cookie on success', async () => {
    const body = {
      access_token: { access_token: 'live_tok', expires_in: 7200, created_at: new Date().toISOString() },
      user: { id: 7, email: 'me@blinker.com' },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => body,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitLogin('me@blinker.com', 'pw');

    expect(result.ok).toBe(true);
    expect(result.user).toMatchObject({ email: 'me@blinker.com' });
    // hit the Doorkeeper password-grant endpoint, MC-style payload
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API}/oauth/login`);
    expect(JSON.parse(init.body)).toEqual({
      username: 'me@blinker.com',
      password: 'pw',
      grant_type: 'password',
    });
    // session now live for the whole platform
    expect(readSharedSession()).toEqual(body);
    expect(isAuthed()).toBe(true);
  });

  it('flags Duo 2FA without persisting a session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sign_request: 'sig:xyz' }) }),
    );
    const result = await submitLogin('duo@blinker.com', 'pw');
    expect(result).toEqual({ ok: false, duoRequired: true });
    expect(isAuthed()).toBe(false);
  });

  it('throws the server message on bad credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: 'Invalid email or password' }) }),
    );
    await expect(submitLogin('me@blinker.com', 'wrong')).rejects.toThrow('Invalid email or password');
    expect(isAuthed()).toBe(false);
  });

  it('throws when the API base URL is not configured', async () => {
    vi.stubEnv('VITE_BLINKER_API_URL', '');
    await expect(submitLogin('me@blinker.com', 'pw')).rejects.toThrow(/not configured/i);
  });

  it('throws a friendly message on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    await expect(submitLogin('me@blinker.com', 'pw')).rejects.toThrow(/network error/i);
  });
});

describe('logout', () => {
  it('clears both the cookie and the local mirror', () => {
    writeSharedSession(freshSession());
    expect(isAuthed()).toBe(true);
    logout();
    expect(readSharedSession()).toBeNull();
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(isAuthed()).toBe(false);
  });
});

describe('apiBaseUrl', () => {
  it('strips a trailing slash', () => {
    vi.stubEnv('VITE_BLINKER_API_URL', 'http://api.test/');
    expect(apiBaseUrl()).toBe('http://api.test');
  });
});
