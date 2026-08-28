// Auth / SSO session shapes. Mirror the slice of MissionControl's
// /oauth/login response that both apps persist (see src/lib/session.ts).

// Doorkeeper OAuth2 token object (as returned under `access_token`).
export interface BlinkerToken {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  // When the token was minted. MissionControl parses this via new Date(),
  // so it may be an ISO string or epoch-ms — kept loose to match.
  created_at?: string | number;
  refresh_token?: string;
  scope?: string;
  [key: string]: unknown;
}

// Authenticated user. Loosely typed — refi only reads id/email/name for
// display + telemetry; the rest round-trips opaquely.
export interface BlinkerUser {
  id?: string | number;
  email?: string;
  first_name?: string;
  last_name?: string;
  roles?: string[];
  [key: string]: unknown;
}

// The cross-app shared-cookie payload.
export interface SharedSession {
  access_token: BlinkerToken;
  user: BlinkerUser | null;
}
