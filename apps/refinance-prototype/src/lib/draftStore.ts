// draftStore — localStorage persistence for the in-progress refi form.
//
// Mirrors MissionControl's refiApplication localStorage draft
// (saveRefiApplicationToStorage / loadRefiApplicationFromStorage). Forms like
// "Tell us about your current loan" (lender / monthly payment / payoff) have
// no per-field backend endpoint — MC keeps them in a localStorage-backed Redux
// draft and only ships them to the backend at the final refi_applications
// submit. We do the same: save the draft when the agent clicks Next, restore
// it on revisit/reload so the form is pre-filled.
//
// Scoped per package_id (falling back to customer_token) so two applications
// don't bleed into each other. Sensitive + transient fields are stripped
// before writing.

import type { RefiForm, Opportunity } from '../types';

const KEY_PREFIX = 'refi_draft_';
const STEP_PREFIX = 'refi_step_';
const OPP_PREFIX = 'refi_opp_';
const UUID_PREFIX = 'refi_external_uuid_';
const IDS_PREFIX = 'refi_ids_';

function scopeId(): string {
  if (typeof window === 'undefined') return 'default';
  const q = new URLSearchParams(window.location.search);
  return q.get('package_id') || q.get('customer_token') || 'default';
}

// Never persist these: SSNs (sensitive) + transient UI/loading flags.
const STRIP = new Set<string>([
  'ssn',
  'coAppSsn',
  'vinDecodeLoading',
  'vinDecodeError',
  'valuationLoading',
  'valuationError',
  '_lastDecodedVin',
]);

function storageKey(): string {
  return KEY_PREFIX + scopeId();
}

// Load the saved draft (or {} if none / unavailable).
export function loadDraft(): Partial<RefiForm> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(storageKey());
    return raw ? (JSON.parse(raw) as Partial<RefiForm>) : {};
  } catch {
    return {};
  }
}

// Persist the current form (minus stripped fields).
export function saveDraft(form: RefiForm): void {
  if (typeof window === 'undefined') return;
  try {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(form)) {
      if (!STRIP.has(k)) out[k] = v;
    }
    window.localStorage.setItem(storageKey(), JSON.stringify(out));
  } catch {
    /* quota / disabled storage — non-fatal */
  }
}

export function clearDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey());
    window.localStorage.removeItem(STEP_PREFIX + scopeId());
    window.localStorage.removeItem(OPP_PREFIX + scopeId());
    window.localStorage.removeItem(UUID_PREFIX + scopeId());
    window.localStorage.removeItem(IDS_PREFIX + scopeId());
  } catch {
    /* ignore */
  }
}

// Every prefix draftStore owns. Used by clearAllDrafts to purge on logout.
const ALL_PREFIXES = [KEY_PREFIX, STEP_PREFIX, OPP_PREFIX, UUID_PREFIX, IDS_PREFIX];

// Wipe ALL refi drafts across EVERY scope (not just the current package_id).
// Called on logout so one user's in-progress application — including the
// bootstrapped User / Vehicle / Address / Package ids — never leaks into the
// next session on the same browser.
export function clearAllDrafts(): void {
  if (typeof window === 'undefined') return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && ALL_PREFIXES.some((p) => key.startsWith(p))) doomed.push(key);
    }
    doomed.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

// LoanApplicantsExternal uuid returned by the prequal upsert
// (POST /api/v3/refi_prequals). Persisted per-scope so later steps reference
// the same record and re-entry doesn't duplicate.
export function savePrequalUuid(uuid: string): void {
  if (typeof window === 'undefined' || !uuid) return;
  try {
    window.localStorage.setItem(UUID_PREFIX + scopeId(), uuid);
  } catch {
    /* ignore */
  }
}

export function loadPrequalUuid(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(UUID_PREFIX + scopeId());
  } catch {
    return null;
  }
}

// Entity ids minted by the DIRECT-login bootstrap (createUser / createVehicle /
// createPackage — see blinkerWrite.bootstrapDirectContext). Persisted per-scope
// so a reload re-enters the SAME records (idempotent re-entry → updates, not
// duplicates) and App.tsx's separate write-context picks them up on next mount.
export interface BootstrapIds {
  userId?: string;
  addressId?: string;
  vehicleId?: string;
  packageId?: string;
  organizationId?: string;
}

export function saveBootstrapIds(ids: BootstrapIds): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(IDS_PREFIX + scopeId(), JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

export function loadBootstrapIds(): BootstrapIds {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(IDS_PREFIX + scopeId());
    return raw ? (JSON.parse(raw) as BootstrapIds) : {};
  } catch {
    return {};
  }
}

// Current wizard step index — so a reload lands on the same page instead of
// resetting to step 0.
export function saveStep(idx: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STEP_PREFIX + scopeId(), String(idx));
  } catch {
    /* ignore */
  }
}

export function loadStep(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.localStorage.getItem(STEP_PREFIX + scopeId());
    const n = raw == null ? 0 : parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

// Agent-only opportunity slice (capture link + status) — persisted so an
// agent who has entered the wizard stays in it after reload instead of being
// dropped back to the capture-link gate.
export function saveOpportunity(opp: Opportunity): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OPP_PREFIX + scopeId(), JSON.stringify(opp));
  } catch {
    /* ignore */
  }
}

export function loadOpportunity(): Opportunity | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(OPP_PREFIX + scopeId());
    return raw ? (JSON.parse(raw) as Opportunity) : null;
  } catch {
    return null;
  }
}
