// session — refi-portal authentication + cross-app SSO.
//
// Mirrors MissionControl's Doorkeeper OAuth2 password-grant login
// (MC src/actions/sessionActions.ts) so the two apps share one login
// pattern AND one live session.
//
// SSO MECHANISM — shared parent-domain cookie `blinker_session`.
//   Cookies are host-scoped, NOT origin/port-scoped, so a cookie set on
//   `localhost` by MissionControl (:3000) is also sent to refi-portal
//   (:5179) — unlike localStorage, which is per-origin. In staging/prod the
//   cookie Domain is widened to the shared parent (.blinker-dev.com /
//   .blinker-prod.com) so both subdomains read it. Result: log in to either
//   app, the other auto-authenticates on next load. Log out of either,
//   both sessions clear.
//
// The cookie payload matches MC's /oauth/login response slice exactly:
//   { access_token: <doorkeeper token object>, user: <user object> }
// MC's createLocalStore writes the same shape; both apps read it here.
//
// localStorage keys (`accessToken`, `userData`) match MC too, so an
// embedded refi-portal hosted under MC's own origin would share state
// directly as well.

import type { BlinkerToken, BlinkerUser, SharedSession } from '../types';
import { clearAllDrafts } from './draftStore';

const COOKIE_NAME = 'blinker_session';
const LS_TOKEN = 'accessToken';
const LS_USER = 'userData';

export function apiBaseUrl(): string {
  return (import.meta.env.VITE_BLINKER_API_URL as string | undefined)?.replace(/\/$/, '') || '';
}

function cookieDomainAttr(): string {
  // Empty in dev (host-only cookie on localhost, shared across ports).
  // Set to the shared parent (e.g. .blinker-prod.com) in staging/prod.
  const domain = (import.meta.env.VITE_SESSION_COOKIE_DOMAIN as string | undefined) || '';
  return domain ? `; Domain=${domain}` : '';
}

// ---- shared cookie ---------------------------------------------------------

export function writeSharedSession(session: SharedSession): void {
  if (typeof document === 'undefined') return;
  const maxAge = session.access_token?.expires_in || 7200;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  const value = encodeURIComponent(JSON.stringify(session));
  document.cookie =
    `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax` +
    cookieDomainAttr() +
    secure;
}

export function readSharedSession(): SharedSession | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match.slice(COOKIE_NAME.length + 1))) as SharedSession;
  } catch {
    return null;
  }
}

export function clearSharedSession(): void {
  if (typeof document === 'undefined') return;
  document.cookie =
    `${COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax` + cookieDomainAttr();
}

// ---- expiry ----------------------------------------------------------------

function tokenValid(token?: BlinkerToken | null): boolean {
  if (!token?.access_token) return false;
  if (!token.created_at || !token.expires_in) return true; // no expiry info → trust it
  // Match MissionControl's checkIsAuth expiry math EXACTLY (it parses
  // created_at via new Date(), so the same token object validates the same
  // way in both apps regardless of whether created_at is ISO or epoch-ms).
  const expiresAt =
    new Date(token.created_at as string | number).getTime() + token.expires_in * 1000;
  return expiresAt > Date.now();
}

// ---- local mirror ----------------------------------------------------------

function writeLocal(session: SharedSession): void {
  try {
    localStorage.setItem(LS_TOKEN, JSON.stringify(session.access_token));
    localStorage.setItem(LS_USER, JSON.stringify(session.user));
  } catch {
    /* localStorage unavailable — cookie is the source of truth anyway */
  }
}

function readLocal(): SharedSession | null {
  try {
    const t = localStorage.getItem(LS_TOKEN);
    if (!t) return null;
    const access_token = JSON.parse(t) as BlinkerToken;
    const u = localStorage.getItem(LS_USER);
    const user = u ? (JSON.parse(u) as BlinkerUser) : null;
    return { access_token, user };
  } catch {
    return null;
  }
}

function clearLocal(): void {
  try {
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_USER);
  } catch {
    /* ignore */
  }
}

// ---- public session API ----------------------------------------------------

// Hydrate the local mirror from the shared cookie when it's the only live
// source (e.g. user logged in via MissionControl, then opened refi). Returns
// the active session, or null if neither source holds a valid token.
export function currentSession(): SharedSession | null {
  const cookie = readSharedSession();
  if (cookie && tokenValid(cookie.access_token)) {
    writeLocal(cookie); // keep the local mirror in step
    return cookie;
  }
  const local = readLocal();
  if (local && tokenValid(local.access_token)) {
    writeSharedSession(local); // re-broadcast to the cookie so MC sees it
    return local;
  }
  return null;
}

export function isAuthed(): boolean {
  return currentSession() !== null;
}

export function currentUser(): BlinkerUser | null {
  return currentSession()?.user ?? null;
}

// Bearer token for authenticated API calls. Prefers the MissionControl
// hand-off token embedded in the URL (?access_token=…&external_user=true,
// see blinkerWrite.writeContextFromUrl) so the existing agent hand-off keeps
// working; otherwise falls back to the logged-in session.
export function sessionToken(): string {
  if (typeof window !== 'undefined') {
    const urlToken = new URLSearchParams(window.location.search).get('access_token');
    if (urlToken) return urlToken;
  }
  return currentSession()?.access_token?.access_token ?? '';
}

export function logout(): void {
  clearLocal();
  clearSharedSession();
  // Purge every in-progress refi draft + bootstrapped entity ids so one user's
  // application never leaks into the next session on the same browser.
  clearAllDrafts();
}

export interface LoginResult {
  ok: boolean;
  // True when the account requires Duo 2FA (sign_request returned). refi
  // does not host the Duo iframe — caller surfaces a "log in via
  // MissionControl" message. (Product decision: skip Duo in refi for now.)
  duoRequired?: boolean;
  user?: BlinkerUser | null;
}

// submitLogin — Doorkeeper password grant, mirrors MC's submitLogin.
// Throws an Error with a user-facing message on failure.
export async function submitLogin(email: string, password: string): Promise<LoginResult> {
  const base = apiBaseUrl();
  if (!base) throw new Error('Login is not configured (missing VITE_BLINKER_API_URL).');

  let res: Response;
  try {
    res = await fetch(`${base}/oauth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: email,
        password,
        grant_type: 'password',
      }),
    });
  } catch {
    throw new Error('Network error — could not reach the login service.');
  }

  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }

  if (!res.ok) {
    const message = (data?.message as string) || 'Invalid email or password.';
    throw new Error(message);
  }

  // Duo 2FA challenge — not hosted in refi.
  if (data.sign_request) {
    return { ok: false, duoRequired: true };
  }

  const access_token = data.access_token as BlinkerToken | undefined;
  const user = (data.user as BlinkerUser | undefined) ?? null;
  if (!access_token?.access_token) {
    throw new Error('Login response did not include an access token.');
  }

  const session: SharedSession = { access_token, user };
  writeLocal(session);
  writeSharedSession(session); // broadcast to MissionControl
  return { ok: true, user };
}
