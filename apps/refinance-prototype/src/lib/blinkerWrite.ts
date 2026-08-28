// blinkerWrite — write-back client for the MissionControl → refi-portal
// hand-off. When an agent is redirected from MissionControl
// (ApplyForFinancingBtn), the URL carries an access_token plus the entity
// ids needed to update the source-of-truth records. As the agent edits
// vehicle / personal / address details and advances through the wizard, we
// push those edits back to the blinker admin API the SAME way MissionControl
// does:
//   * personal + address → POST {apiBase}/admin/graphql  (updateUser /
//     updateAddress mutations — mirrors MC's helpers/apiHelper.request)
//   * vehicle mileage     → PUT  {apiBase}/api/v3/admin/vehicles/{id}
//     (mirrors MC's refiActions.updateVehicle REST call)
//
// Writes are best-effort + non-blocking: a failure logs + reports telemetry
// but never blocks the wizard. Standalone refi (no redirect context) is a
// no-op — `fromUrl()` returns { enabled: false }.

import { track } from 'blinker-platform/telemetry';
import type { RefiForm } from '../types';
import { savePrequalUuid, saveBootstrapIds, loadBootstrapIds } from './draftStore';
import { sessionToken, apiBaseUrl, currentUser } from './session';

export interface WriteContext {
  enabled: boolean;
  apiBase: string;
  token: string;
  userId: string;
  vehicleId: string;
  addressId: string;
  packageId: string;
  organizationId: string;
  // True for the DIRECT-login path (no MissionControl hand-off in the URL).
  // In this mode the User / Vehicle / Address / ProductPackage do NOT exist
  // yet — bootstrapDirectContext() creates them on first submit. MC hand-off
  // contexts leave this false (entities already exist).
  direct?: boolean;
  // wear-grade condition snapshot from the MC handoff (e.g. "Clean"/"Average").
  // refi never edits it; we round-trip it on the decode-and-import POST so the
  // re-imported vehicle keeps its original grade.
  vehicleCondition: string;
}

// Parse the write-back context out of the redirect URL. Mirrors the param
// names MissionControl emits in ApplyForFinancingBtn.tsx.
export function writeContextFromUrl(): WriteContext {
  const empty: WriteContext = {
    enabled: false,
    apiBase: '',
    token: '',
    userId: '',
    vehicleId: '',
    addressId: '',
    packageId: '',
    organizationId: '',
    vehicleCondition: '',
  };
  if (typeof window === 'undefined') return empty;
  const q = new URLSearchParams(window.location.search);
  const get = (k: string): string => (q.get(k) ?? '').trim();

  const token = get('access_token');
  // api_base lets MC pin refi to the same backend its token was minted
  // against; falls back to a build-time env for direct/dev use.
  const apiBase =
    get('api_base') ||
    (import.meta.env.VITE_BLINKER_API_URL as string | undefined) ||
    '';

  // Write-back only makes sense for the external-agent hand-off, and only
  // when we actually have a token + somewhere to send it.
  const enabled = get('external_user') === 'true' && !!token && !!apiBase;

  return {
    enabled,
    apiBase: apiBase.replace(/\/$/, ''),
    token,
    userId: get('user_id'),
    vehicleId: get('vehicle_id'),
    addressId: get('address_id'),
    packageId: get('package_id'),
    organizationId: get('organization_id'),
    // MC's ApplyForFinancingBtn sends the vehicle's wear-grade `condition`.
    vehicleCondition: get('condition'),
  };
}

// DIRECT-login write context. No MissionControl hand-off in the URL, so the
// token comes from the logged-in session (cookie/localStorage, see session.ts)
// and the entity ids come from a prior bootstrap cached in localStorage. Until
// the package is bootstrapped, `enabled` is false (so per-step writes no-op).
export function directContextFromSession(): WriteContext {
  const disabled: WriteContext = {
    enabled: false,
    direct: true,
    apiBase: '',
    token: '',
    userId: '',
    vehicleId: '',
    addressId: '',
    packageId: '',
    organizationId: '',
    vehicleCondition: '',
  };
  const token = sessionToken();
  const apiBase = apiBaseUrl();
  if (!token || !apiBase) return disabled;

  const ids = loadBootstrapIds();
  const userOrg = (currentUser() as { organization_id?: string | number } | null)?.organization_id;
  return {
    enabled: !!ids.packageId, // becomes a full write context once bootstrapped
    direct: true,
    apiBase: apiBase.replace(/\/$/, ''),
    token,
    userId: ids.userId || '',
    vehicleId: ids.vehicleId || '',
    addressId: ids.addressId || '',
    packageId: ids.packageId || '',
    organizationId: ids.organizationId || (userOrg != null ? String(userOrg) : ''),
    vehicleCondition: '',
  };
}

// The single entry point both App.tsx and RefiWizard use. Prefers the
// MissionControl hand-off context (token + entity ids in the URL); falls back
// to the direct-login session context when there's no hand-off.
export function resolveWriteContext(): WriteContext {
  const url = writeContextFromUrl();
  if (url.enabled) return url;
  return directContextFromSession();
}

function authHeaders(ctx: WriteContext): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ctx.token}`,
  };
}

// ---------------------------------------------------------------------------
// Backend error extraction (task 7 — surface data-validation / missing-field
// errors as a form breadcrumb). blinker's REST v3 controllers answer a 4xx
// with { message: "..." } and/or { error: "..." } (e.g. the vehicle importer
// returns { error: "validation error", message: <full_messages joined> }; the
// packages controller returns { error: <message> }). GraphQL mutations answer
// with an `errors: [{ message }]` array. pickMessage() distills any of those
// into a single human-readable string; restErrorMessage() reads it off a
// failed fetch Response.
// ---------------------------------------------------------------------------
function pickMessage(body: unknown): string {
  if (!body) return '';
  if (typeof body === 'string') return body;
  if (typeof body !== 'object') return '';
  const b = body as Record<string, unknown>;
  if (typeof b.message === 'string' && b.message.trim()) return b.message.trim();
  // Skip the generic "validation error" label; the real text is in `message`.
  if (typeof b.error === 'string' && b.error.trim() && b.error !== 'validation error') {
    return b.error.trim();
  }
  const errs = b.errors;
  if (Array.isArray(errs)) {
    const parts = errs
      .map((e) =>
        typeof e === 'string'
          ? e
          : (e as Record<string, unknown>)?.message || (e as Record<string, unknown>)?.detail || ''
      )
      .filter(Boolean) as string[];
    if (parts.length) return parts.join('; ');
  } else if (errs && typeof errs === 'object') {
    // Rails-style { field: ["msg", ...] }.
    const parts = Object.entries(errs as Record<string, unknown>).map(
      ([k, v]) => `${k} ${Array.isArray(v) ? v.join(', ') : String(v)}`
    );
    if (parts.length) return parts.join('; ');
  }
  return '';
}

// Read a validation message off a failed REST Response (best-effort; falls back
// to the status code when the body isn't JSON or carries no message).
async function restErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.clone().json();
    return pickMessage(body) || `Request failed (HTTP ${res.status})`;
  } catch {
    return `Request failed (HTTP ${res.status})`;
  }
}

// ---------------------------------------------------------------------------
// Which backend messages may reach the screen. The wizard renders submitError
// on a consumer-facing step, so only DATA-VALIDATION text ("Email is invalid",
// "Vin has already been taken") is safe to show verbatim; auth denials, CanCan
// refusals and 500s carry internal wording and must stay generic.
//
// blinker tags validation failures explicitly: UpdateUser#resolve rescues
// ActiveRecord::RecordInvalid and rebuilds each full_message as a
// GraphQL::ExecutionError with `options: { type: "validation" }`
// (lib/api/admin/mutations/update_user.rb). graphql-ruby (2.0.27) merges those
// options onto the error object, so the tag arrives as a top-level `type` key —
// `extensions.type` is checked too, since that's where newer versions put it.
// REST has no such tag, so 422 (the only status blinker answers a validation
// failure with) stands in for it.
//
// Every failure is console.warn'd with its full text regardless, so the real
// cause is one devtools glance away even when the UI stays generic.
// ---------------------------------------------------------------------------
class WriteError extends Error {
  readonly userSafe: boolean;

  constructor(message: string, userSafe = false) {
    super(message);
    this.name = 'WriteError';
    this.userSafe = userSafe;
  }
}

// The message to hand the UI, or undefined when the caller should fall back to
// its own generic copy.
function userSafeMessage(err: unknown): string | undefined {
  return err instanceof WriteError && err.userSafe ? err.message : undefined;
}

function isValidationGraphqlError(e: unknown): boolean {
  const err = e as { type?: unknown; extensions?: { type?: unknown } } | null;
  return err?.type === 'validation' || err?.extensions?.type === 'validation';
}

// Build a WriteError off a failed REST Response, marking 422 bodies as safe.
async function restWriteError(res: Response): Promise<WriteError> {
  return new WriteError(await restErrorMessage(res), res.status === 422);
}

// POST a GraphQL mutation to /admin/graphql. MissionControl's apiHelper
// sends `variables` as a JSON STRING (not an object); we mirror that exactly
// so the blinker controller parses it identically.
async function postAdminGraphql(
  ctx: WriteContext,
  query: string,
  variables: Record<string, unknown>
): Promise<unknown> {
  const res = await fetch(`${ctx.apiBase}/admin/graphql`, {
    method: 'POST',
    headers: authHeaders(ctx),
    body: JSON.stringify({ query, variables: JSON.stringify(variables) }),
  });
  if (!res.ok) throw await restWriteError(res);
  const json = await res.json();
  const errors: unknown[] = Array.isArray(json?.errors) ? json.errors : [];
  if (errors.length) {
    // Prefer the validation-tagged errors when the response mixes kinds: those
    // are both the actionable ones and the only ones we may show verbatim.
    const validation = errors.filter(isValidationGraphqlError);
    const shown = validation.length ? validation : errors;
    const message = shown
      .map((e) => (e as { message?: string })?.message)
      .filter(Boolean)
      .join('; ');
    throw new WriteError(message || 'GraphQL error', validation.length > 0);
  }
  return json?.data;
}

// Normalize a refi date field to ISO YYYY-MM-DD for blinker's DateType.
// Accepts already-ISO (calendar fields) or MM/DD/YYYY / MMDDYYYY (DateField).
function toIsoDate(v?: string): string | undefined {
  if (!v) return undefined;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let mm: string | undefined, dd: string | undefined, yyyy: string | undefined;
  if (s.includes('/') || s.includes('-')) {
    const parts = s.split(/[/-]/);
    if (parts.length === 3) [mm, dd, yyyy] = parts;
  } else {
    const d = s.replace(/\D/g, '');
    if (d.length === 8) { mm = d.slice(0, 2); dd = d.slice(2, 4); yyyy = d.slice(4); }
  }
  if (!mm || !dd || !yyyy) return undefined;
  const pad = (x: string, n: number) => x.padStart(n, '0');
  return `${pad(yyyy, 4)}-${pad(mm, 2)}-${pad(dd, 2)}`;
}

// ---------------------------------------------------------------------------
// DIRECT-login fresh creation — when the agent opens refi-portal WITHOUT a
// MissionControl hand-off, the User / Vehicle / Address / ProductPackage don't
// exist yet. bootstrapDirectContext() creates them (in dependency order) the
// first time the agent submits, then everything downstream (per-section
// updates, prequal/LoanApplicantsExternal, the refi_application) runs through
// the EXACT same code paths as the MissionControl hand-off.
//
// Creation mirrors the proven server recipes:
//   * User (+ Address) → POST /admin/graphql createUser(input: CreateUserInput!)
//     find-or-create-by email / name+phone; the `address` block creates the
//     current address inline (Api::Admin::Mutations::CreateUser). NOTE: we do
//     NOT send organizationId — that routes createUser to its admin-user
//     branch; omitting it creates an unclaimed CUSTOMER contact in the agent's
//     org (current_user.organization.contacts), which is what we want.
//   * Vehicle  → POST /api/v3/admin/vehicles (VehicleDecodeAndImportCommand),
//     same payload as syncVehicle but with no product_package_id yet.
//   * Package  → POST /api/v3/admin/products/packages { user_id, vehicle_id }
//     (ProductPackages::Create).
// ---------------------------------------------------------------------------

const CREATE_USER = `mutation createUser($user: CreateUserInput!) {
  createUser(input: $user) {
    user { id currentAddress { id } }
  }
}`;

// Create (find-or-create) the customer User and, when address fields are
// present, the current Address. Returns the new ids.
async function createUserAndAddress(
  ctx: WriteContext,
  form: RefiForm
): Promise<{ userId: string; addressId: string }> {
  const email = String(form.email || '').trim();
  const userInput: Record<string, unknown> = {
    firstName: form.firstName || 'Prospect',
    lastName: form.lastName || 'User',
    email: email || '',
    phone: String(form.phone || '').replace(/\D/g, ''),
    // Backend generates a placeholder email when none is supplied.
    generateEmail: email === '',
    birthday: toIsoDate(form.dob),
  };
  // Address requires a state server-side (StateEnum). Only send the block when
  // we have the core fields, else createUser skips address creation.
  if (form.address && form.city && form.state && form.zip) {
    userInput.address = {
      line1: form.address,
      line2: form.apt_suite || '',
      city: form.city,
      state: form.state,
      zip: form.zip,
    };
  }
  const data = (await postAdminGraphql(ctx, CREATE_USER, { user: userInput })) as
    | { createUser?: { user?: { id?: string | number; currentAddress?: { id?: string | number } } } }
    | undefined;
  const u = data?.createUser?.user;
  return {
    userId: u?.id != null ? String(u.id) : '',
    addressId: u?.currentAddress?.id != null ? String(u.currentAddress.id) : '',
  };
}

// Create the Vehicle off the VIN (or YMMT) for the just-created user. Mirrors
// syncVehicle's step-1 payload, minus the package link (none exists yet).
// blinker's importer resolves the trim from `trim_id` when one is sent
// (VehicleDecodeAndImportCommand#decode_year_make_model_and_trim:72-73) and
// otherwise falls back to a case-SENSITIVE year/make/model match (:75-80).
// Our make comes off a title-casing picker ("Audi") while VehicleTrim stores
// the source casing ("AUDI"), so that fallback matches nothing and the POST
// 404s with "No matching vehicle trim for provided year/make/model". Sending
// the id keeps the fallback out of the picture, which is what MC does
// (vehicleDetailSection.tsx:159-171).
//
// Undefined when the form carries no id — the "I don't know" / "Other"
// sentinels and decode-injected extras have none — so JSON.stringify drops
// the key rather than sending a null the importer would treat as present.
function trimIdParam(form: RefiForm): number | undefined {
  const id = Number(form.trim_id);
  return Number.isFinite(id) && id > 0 ? id : undefined;
}

async function createVehicleDirect(ctx: WriteContext, form: RefiForm): Promise<string> {
  const rawVin = String(form.vin || '').trim().toUpperCase();
  const vin = rawVin.length === 17 ? rawVin : null;
  const usedNewRaw = String(form.condition || '').toLowerCase();
  const usedNew = usedNewRaw === 'new' || usedNewRaw === 'used' ? usedNewRaw : undefined;
  const payload: Record<string, unknown> = {
    user_id: ctx.userId || undefined,
    plate: '',
    state: form.state || undefined,
    vin,
    year: form.year ?? undefined,
    make: form.make || undefined,
    model: form.model || undefined,
    trim_id: trimIdParam(form),
    mileage: form.mileage,
    transmission: '',
    used_new: usedNew,
  };
  const res = await fetch(`${ctx.apiBase}/api/v3/admin/vehicles`, {
    method: 'POST',
    headers: authHeaders(ctx),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await restWriteError(res);
  const created = (await res.json()) as { id?: string | number };
  return created?.id != null ? String(created.id) : '';
}

// Create the ProductPackage linking the user + vehicle.
async function createPackageDirect(ctx: WriteContext, vehicleId: string): Promise<string> {
  const res = await fetch(`${ctx.apiBase}/api/v3/admin/products/packages`, {
    method: 'POST',
    headers: authHeaders(ctx),
    body: JSON.stringify({ user_id: ctx.userId, vehicle_id: Number(vehicleId) }),
  });
  if (!res.ok) throw await restWriteError(res);
  const created = (await res.json()) as { id?: string | number };
  return created?.id != null ? String(created.id) : '';
}

// Create the current Address for an already-created user. Mirrors blinker's
// Api::Admin::Mutations::CreateAddress (createAddress(input: CreateAddressInput!)
// — RelayClassic style, so args ride in `input`). Used by the direct flow when
// the address is captured on the housing step, AFTER the user was already
// created on the applicant step (so it couldn't ride inline on createUser).
const CREATE_ADDRESS = `mutation createAddress($input: CreateAddressInput!) {
  createAddress(input: $input) { address { id } }
}`;

async function createAddressDirect(ctx: WriteContext, form: RefiForm): Promise<string> {
  const data = (await postAdminGraphql(ctx, CREATE_ADDRESS, {
    input: {
      userId: ctx.userId,
      line1: form.address,
      line2: form.apt_suite || '',
      city: form.city,
      state: form.state,
      zip: form.zip,
    },
  })) as { createAddress?: { address?: { id?: string | number } } } | undefined;
  const id = data?.createAddress?.address?.id;
  return id != null ? String(id) : '';
}

// ---------------------------------------------------------------------------
// Per-entity completeness gates (tasks 1-4 — "once we have all details of X,
// create X"). Creation is dependency-ordered: User → Address / Vehicle →
// ProductPackage. NOTE the vehicle importer REQUIRES a `state`
// (VehicleDecodeAndImportCommand#validate_state_plate_or_vin_or_ymmt), and refi
// only captures state on the housing step — so vehicleReady can't be satisfied
// until the housing screen is filled, which is why the vehicle + package are
// created on the housing Next, not the vehicle Next.
// ---------------------------------------------------------------------------
function userReady(f: RefiForm): boolean {
  return !!(
    f.firstName &&
    f.lastName &&
    f.email &&
    String(f.phone || '').replace(/\D/g, '').length >= 10
  );
}
function addressReady(f: RefiForm): boolean {
  return !!(f.address && f.city && f.state && f.zip);
}
function vehicleReady(f: RefiForm): boolean {
  const hasVin = String(f.vin || '').trim().length === 17;
  const hasYmmt = !!(f.year && f.make && f.model);
  return (hasVin || hasYmmt) && f.mileage != null && !!f.state;
}

// Ensure the User / Vehicle / Address / ProductPackage exist for the direct
// flow, returning a fully-populated + enabled WriteContext. No-op (returns the
// context unchanged) for the MissionControl hand-off (entities already exist)
// or when already bootstrapped. On any failure returns the original context
// (still disabled) so the caller can surface a retry.
export async function bootstrapDirectContext(
  ctx: WriteContext,
  form: RefiForm
): Promise<WriteContext> {
  if (!ctx.direct) return ctx; // MissionControl hand-off — nothing to create
  if (ctx.packageId) return ctx; // already bootstrapped this scope
  if (!ctx.apiBase || !ctx.token) return ctx;

  try {
    const { userId, addressId } = await createUserAndAddress(ctx, form);
    if (!userId) throw new Error('createUser returned no id');

    const withUser: WriteContext = { ...ctx, userId };
    const vehicleId = await createVehicleDirect(withUser, form);
    if (!vehicleId) throw new Error('createVehicle returned no id');

    const packageId = await createPackageDirect(withUser, vehicleId);
    if (!packageId) throw new Error('createPackage returned no id');

    const next: WriteContext = {
      ...ctx,
      enabled: true,
      userId,
      addressId,
      vehicleId,
      packageId,
    };
    saveBootstrapIds({
      userId,
      addressId,
      vehicleId,
      packageId,
      organizationId: ctx.organizationId,
    });
    track('refi.direct.bootstrap_created', {
      user_id: userId,
      vehicle_id: vehicleId,
      package_id: packageId,
    });
    return next;
  } catch (err) {
    console.warn('[direct] bootstrap failed:', err);
    track('refi.direct.bootstrap_failed', {});
    return ctx;
  }
}

// ---------------------------------------------------------------------------
// ensureDirectEntities — the INCREMENTAL create-or-update pass for the direct
// (fresh) flow. Called on the Next of each entity-bearing step (tasks 1-5):
//   * User      created once name/email/phone are in (applicant step)
//   * Address   created once street/city/state/zip are in (housing step)
//   * Vehicle   created once VIN|YMMT + mileage + state are in (needs the
//               housing state, so it lands on the housing pass)
//   * Package   created once BOTH user + vehicle exist
// Anything already created is UPDATED instead (task 5 — keep the DB consistent
// as the agent edits). Dependency-ordered (User → Address/Vehicle → Package)
// and idempotent: ids are cached (draftStore) after every mutation so a retry
// or reload resumes the SAME records instead of duplicating.
//
// Returns the updated context (with any freshly-minted ids) plus the FIRST
// backend error encountered, which RefiWizard surfaces as a form breadcrumb
// (task 7) and uses to hold the agent on the current step. A no-op for the
// MissionControl hand-off (ctx.direct is false — those updates flow through
// syncForStep instead).
export async function ensureDirectEntities(
  ctx: WriteContext,
  form: RefiForm
): Promise<{ ctx: WriteContext; error?: string }> {
  if (!ctx.direct) return { ctx };
  if (!ctx.apiBase || !ctx.token) return { ctx };

  // Merge ids already minted this session OR cached from a prior reload.
  const ids = loadBootstrapIds();
  const next: WriteContext = {
    ...ctx,
    userId: ctx.userId || ids.userId || '',
    addressId: ctx.addressId || ids.addressId || '',
    vehicleId: ctx.vehicleId || ids.vehicleId || '',
    packageId: ctx.packageId || ids.packageId || '',
    organizationId: ctx.organizationId || ids.organizationId || '',
  };
  // Update helpers gate on ctx.enabled; force it on so edits push even before
  // the package (which normally flips `enabled`) exists.
  const forceEnabled = (c: WriteContext): WriteContext => ({ ...c, enabled: true });

  const persist = (): void =>
    saveBootstrapIds({
      userId: next.userId,
      addressId: next.addressId,
      vehicleId: next.vehicleId,
      packageId: next.packageId,
      organizationId: next.organizationId,
    });

  try {
    // 1. USER
    if (!next.userId) {
      if (userReady(form)) {
        const { userId, addressId } = await createUserAndAddress(next, form);
        if (!userId) throw new Error('We couldn’t create the applicant record.');
        next.userId = userId;
        if (addressId) next.addressId = addressId;
        track('refi.direct.user_created', { user_id: userId });
      }
    } else {
      const r = await syncUser(forceEnabled(next), form);
      if (!r.ok && r.error) throw new Error(r.error);
    }

    // 2. ADDRESS (requires the user). Only touch it once the housing fields
    // exist. createUser's find-or-create can return an EXISTING user's
    // currentAddress id (adopted as next.addressId), so without this gate the
    // update branch would fire updateAddress with empty street/city/state/zip on
    // the applicant step — the phantom updateAddressMutation error seen when
    // there's no address yet.
    if (next.userId && addressReady(form)) {
      if (!next.addressId) {
        const addressId = await createAddressDirect(next, form);
        if (addressId) {
          next.addressId = addressId;
          track('refi.direct.address_created', { address_id: addressId });
        }
      } else {
        const r = await syncAddress(forceEnabled(next), form);
        if (!r.ok && r.error) throw new Error(r.error);
      }
    }

    // 3. VEHICLE (needs state → same pass as address)
    if (!next.vehicleId) {
      if (vehicleReady(form)) {
        const vehicleId = await createVehicleDirect(next, form);
        if (!vehicleId) throw new Error('We couldn’t create the vehicle record.');
        next.vehicleId = vehicleId;
        track('refi.direct.vehicle_created', { vehicle_id: vehicleId });
      }
    } else {
      const r = await syncVehicle(forceEnabled(next), form);
      if (!r.ok && r.error) throw new Error(r.error);
      if (r.vehicleId) next.vehicleId = r.vehicleId; // re-decode may swap the id
    }

    // 4. PACKAGE (needs both user + vehicle) + ownership once bound
    if (!next.packageId && next.userId && next.vehicleId) {
      const packageId = await createPackageDirect(next, next.vehicleId);
      if (!packageId) throw new Error('We couldn’t start the application package.');
      next.packageId = packageId;
      track('refi.direct.package_created', { package_id: packageId });
    }
    if (next.packageId) {
      next.enabled = true;
      const r = await syncOwnership(next, form);
      if (!r.ok && r.error) throw new Error(r.error);
    }

    persist();
    return { ctx: next };
  } catch (err) {
    persist(); // keep whatever ids we minted before the failure (idempotent retry)
    return { ctx: next, error: userSafeMessage(err) };
  }
}

const UPDATE_USER = `mutation userUpdateInput($user: UpdateUserInput!) {
  updateUser(input: $user) { user { id firstName lastName email phone } warning }
}`;

const UPDATE_ADDRESS = `mutation updateAddressMutation($address: UpdateAddressInput!) {
  updateAddress(input: $address) { address { id line1 line2 city state zip ownership } }
}`;

// refi housing option → blinker Address.ownership inclusion set
// (["Own","Rent","Live with Others","Other"]). refi offers Own/Rent/Other.
const ADDRESS_OWNERSHIP_MAP: Record<string, string> = {
  own: 'Own',
  rent: 'Rent',
  other: 'Other',
};

// Push primary-applicant personal details. Mirrors MC's updateUser
// (helpers/apiHelper → /admin/graphql, UpdateUserInput).
// Returns { ok } so blocking callers (Submit-for-prequal) can gate on it; the
// best-effort fire-and-forget callers (syncForStep) just ignore the result.
export async function syncUser(
  ctx: WriteContext,
  form: RefiForm
): Promise<{ ok: boolean; error?: string }> {
  if (!ctx.enabled || !ctx.userId) return { ok: true };
  try {
    await postAdminGraphql(ctx, UPDATE_USER, {
      user: {
        id: ctx.userId,
        // Blank-guarded, same as `birthday` below. A deep-link straight to
        // s1_identity_consent skips s1_applicant (the only screen that requires
        // name/phone/email), and on the consumer's device there's no draft to
        // restore, so these can all still be ''. Sending email: '' flips
        // will_save_change_to_email? and trips the email_format validator on the
        // User model, which blinker returns as "Email is invalid" — a write
        // failure caused entirely by a field the agent never touched. Omitting
        // an empty value leaves the stored one alone instead.
        firstName: form.firstName || undefined,
        lastName: form.lastName || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        // DOB → blinker `birthday` (mapped to dob server-side). Mirrors MC's
        // consentForm updateUser({ birthday }). Omitted when empty since
        // JSON.stringify drops undefined keys. (SSN has no updateUser arg in
        // blinker's UpdateUserInput — it flows via the refi application
        // payload's applicant_ssn instead, see submitRefiApplication.)
        birthday: toIsoDate(form.dob),
      },
    });
    track('refi.agent.writeback_user', { user_id: ctx.userId });
    return { ok: true };
  } catch (err) {
    console.warn('[writeback] updateUser failed:', err);
    track('refi.agent.writeback_user_failed', { user_id: ctx.userId });
    return { ok: false, error: userSafeMessage(err) };
  }
}

// Push current address. Mirrors MC's updateAddress (UpdateAddressInput). refi
// stores line 1 as `address` and line 2 as `apt_suite`.
export async function syncAddress(
  ctx: WriteContext,
  form: RefiForm
): Promise<{ ok: boolean; error?: string }> {
  if (!ctx.enabled || !ctx.addressId) return { ok: true };
  try {
    await postAdminGraphql(ctx, UPDATE_ADDRESS, {
      address: {
        id: ctx.addressId,
        line1: form.address,
        line2: form.apt_suite,
        city: form.city,
        state: form.state,
        zip: form.zip,
        // residence ownership (Own/Rent/Other) — mirrors MC residence-details
        ownership: ADDRESS_OWNERSHIP_MAP[String(form.ownRent || '').toLowerCase()],
      },
    });
    track('refi.agent.writeback_address', { address_id: ctx.addressId });
    return { ok: true };
  } catch (err) {
    console.warn('[writeback] updateAddress failed:', err);
    track('refi.agent.writeback_address_failed', { address_id: ctx.addressId });
    return { ok: false, error: userSafeMessage(err) };
  }
}

// Persist vehicle edits the SAME way MissionControl does — a TWO-step flow
// (creditApplicationChoice.tsx): findOrCreateVehicle then updateProductPackage.
//
//  1. POST /api/v3/admin/vehicles (findOrCreateVehicle) — NOT a PUT to
//     /vehicles/{id}. The PUT path can't change `vin` (whitelisted for create
//     only) and never re-decodes; the POST runs VehicleDecodeAndImportCommand,
//     which re-imports off the VIN, re-links the trim, round-trips `used_new`,
//     and RETURNS A POSSIBLY-DIFFERENT vehicle id (the decoded record).
//  2. PUT /api/v3/admin/products/packages/{packageId} (updateProductPackage)
//     with { id, user_id, vehicle_id: <id from step 1>, products: [],
//     selected_products: [] } — re-points the package at the vehicle the POST
//     returned. WITHOUT this the package keeps its old vehicle_id, so the
//     agent's edits land on an orphaned record.
//
// Step-1 payload mirrors MC exactly:
//   { id, product_package_id, user_id, plate, state, vin|null, year, make,
//     model, trim_id, mileage, condition (wear grade), transmission, used_new }
//
// - `vin` is sent when the agent supplies a complete 17-char VIN, else null.
// - `trim_id` is the picked trim's VehicleTrim id, and is what actually
//   resolves the trim on the VIN-less path — see trimIdParam above for why
//   year/make/model alone cannot.
// - `state` is required by the importer's validation. The handoff carries no
//   plate state, so we fall back to the residence state.
// - `condition` is the wear grade carried from the MC handoff; refi never edits
//   it, we just round-trip it so the re-import keeps the original grade.
// - `used_new` is refi's New/Used purchase toggle, lowercased.
// Best-effort + non-blocking: a failure logs + reports telemetry, never blocks.
export async function syncVehicle(
  ctx: WriteContext,
  form: RefiForm
): Promise<{ ok: boolean; error?: string; vehicleId?: string }> {
  if (!ctx.enabled || !ctx.vehicleId) return { ok: true };
  const rawVin = String(form.vin || '').trim().toUpperCase();
  const vin = rawVin.length === 17 ? rawVin : null;
  const usedNewRaw = String(form.condition || '').toLowerCase();
  const usedNew = usedNewRaw === 'new' || usedNewRaw === 'used' ? usedNewRaw : undefined;
  // JSON.stringify drops undefined keys, so optional fields fall out cleanly.
  const payload: Record<string, unknown> = {
    id: ctx.vehicleId,
    product_package_id: ctx.packageId ? Number(ctx.packageId) : undefined,
    user_id: ctx.userId || undefined,
    plate: '',
    state: form.state || undefined,
    vin,
    year: form.year ?? undefined,
    make: form.make || undefined,
    model: form.model || undefined,
    trim_id: trimIdParam(form),
    mileage: form.mileage,
    condition: ctx.vehicleCondition || undefined,
    transmission: '',
    used_new: usedNew,
  };
  try {
    // Step 1 — findOrCreateVehicle.
    const res = await fetch(`${ctx.apiBase}/api/v3/admin/vehicles`, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw await restWriteError(res);
    const created = (await res.json()) as { id?: string | number };
    const newVehicleId = created?.id != null ? String(created.id) : '';

    // Step 2 — re-point the package at the (possibly new) vehicle id.
    if (newVehicleId && ctx.packageId) {
      await relinkPackageVehicle(ctx, newVehicleId);
    }

    track('refi.agent.writeback_vehicle', {
      vehicle_id: newVehicleId || ctx.vehicleId,
      vin,
      used_new: usedNew,
    });
    return { ok: true, vehicleId: newVehicleId || ctx.vehicleId };
  } catch (err) {
    console.warn('[writeback] updateVehicle failed:', err);
    track('refi.agent.writeback_vehicle_failed', { vehicle_id: ctx.vehicleId });
    return { ok: false, error: userSafeMessage(err) };
  }
}

// Re-point the product package at a vehicle id. Mirrors MC's updateProductPackage
// (PUT /api/v3/admin/products/packages/{id} with the empty products arrays that
// MC sends so the package's product selection is untouched).
async function relinkPackageVehicle(ctx: WriteContext, vehicleId: string): Promise<void> {
  const res = await fetch(`${ctx.apiBase}/api/v3/admin/products/packages/${ctx.packageId}`, {
    method: 'PUT',
    headers: authHeaders(ctx),
    body: JSON.stringify({
      id: ctx.packageId ? Number(ctx.packageId) : ctx.packageId,
      user_id: ctx.userId,
      vehicle_id: Number(vehicleId),
      products: [],
      selected_products: [],
    }),
  });
  if (!res.ok) throw await restWriteError(res);
  track('refi.agent.writeback_package_vehicle', {
    package_id: ctx.packageId,
    vehicle_id: vehicleId,
  });
}

// refi ownership option ids → blinker vehicle ownership_status values
// (mirrors MissionControl's ownershipComponent statuses: Owned / Financed /
// Leased / Sold). refi only offers financed / leased / owned.
const OWNERSHIP_MAP: Record<string, string> = {
  financed: 'Financed',
  leased: 'Leased',
  owned: 'Owned',
};

// Push ownership status to the vehicle. Mirrors MC's ownershipComponent →
// updateVehicle({ ownership_status }) → PUT /api/v3/admin/vehicles/{id}.
export async function syncOwnership(
  ctx: WriteContext,
  form: RefiForm
): Promise<{ ok: boolean; error?: string }> {
  if (!ctx.enabled || !ctx.vehicleId) return { ok: true };
  const status = OWNERSHIP_MAP[String(form.ownership || '').toLowerCase()];
  if (!status) return { ok: true };
  try {
    const res = await fetch(`${ctx.apiBase}/api/v3/admin/vehicles/${ctx.vehicleId}`, {
      method: 'PUT',
      headers: authHeaders(ctx),
      body: JSON.stringify({ ownership_status: status }),
    });
    if (!res.ok) throw await restWriteError(res);
    track('refi.agent.writeback_ownership', { vehicle_id: ctx.vehicleId, ownership_status: status });
    return { ok: true };
  } catch (err) {
    console.warn('[writeback] ownership update failed:', err);
    track('refi.agent.writeback_ownership_failed', { vehicle_id: ctx.vehicleId });
    return { ok: false, error: userSafeMessage(err) };
  }
}

// Whole-months between a date and today (matches MC's
// calculateMonthsFromStart for residence + employer tenure).
function monthsSince(v?: string): number {
  const iso = toIsoDate(v);
  if (!iso) return 0;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return 0;
  const now = new Date();
  return Math.max(0, (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()));
}

// Create the refinance application — byte-for-byte the same call MissionControl
// makes from its disclosure-agreement step: a single flat POST to
// /api/v3/admin/refi_applications (forwarded server-side to Gravity). Fires on
// "Continue to Stage 2" (RefiWizard.goToStageTwo), by which point every field
// in the payload has been collected AND the local decision said qualified.
//
// Returns { ok } so the caller can branch — on failure RefiWizard surfaces an
// error banner and redirects the agent back to MissionControl. A disabled ctx
// (standalone refi, no MC hand-off) is a no-op and reports { ok: true }.
// Upsert the LoanApplicantsExternal on "Submit for prequal" (RefiWizard leaving
// s1_identity_consent). POSTs the flat payload
//   { product_package_id, organization_id, status, credit_score }
// to POST /api/v3/refi_prequals. The endpoint is idempotent (find_or_create_by
// on product_package): 201 when it created the record, 200 when it found +
// updated one — so re-entry updates in place instead of duplicating. The
// returned uuid is persisted (draftStore). Best-effort + non-blocking; a no-op
// for standalone refi (writeCtx.enabled === false), which returns { ok: true }.
export async function createRefiPrequal(
  ctx: WriteContext,
  form: RefiForm
): Promise<{ ok: boolean; uuid?: string; created?: boolean; error?: string }> {
  if (!ctx.enabled || !ctx.packageId) return { ok: true };

  try {
    const res = await fetch(`${ctx.apiBase}/api/v3/refi_prequals`, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify({
        product_package_id: ctx.packageId,
        organization_id: ctx.organizationId || undefined,
        status: 'Started',
        // Self-reported credit band (e.g. "300_579") → credit_score column.
        credit_score: form.creditBand || undefined,
      }),
    });
    if (!res.ok) throw await restWriteError(res);
    const created = res.status === 201;
    const data = (await res.json()) as { uuid?: string };
    const uuid = data?.uuid ? String(data.uuid) : '';
    if (uuid) savePrequalUuid(uuid);
    track(
      created
        ? 'refi.prequal.external_applicant_created'
        : 'refi.prequal.external_applicant_updated',
      { package_id: ctx.packageId, uuid }
    );
    return { ok: true, uuid, created };
  } catch (err) {
    console.warn('[writeback] upsert refi_prequal failed:', err);
    track('refi.prequal.external_applicant_failed', { package_id: ctx.packageId });
    return { ok: false, error: userSafeMessage(err) };
  }
}

// Flip the LoanApplicantsExternal to "Disqualified" when the prequal decision
// resolves to disqualified (StageTwoResult → DisqualifiedCard). Reuses the same
// idempotent find_or_create_by-on-product_package endpoint, so this updates the
// record created on Submit-for-prequal in place. The optional reason (a
// DisqualReason code) rides along on attribution_data for the audit trail.
// Best-effort + non-blocking; a no-op for standalone refi (ctx.enabled === false).
export async function disqualifyRefiPrequal(
  ctx: WriteContext,
  reason?: string
): Promise<{ ok: boolean; error?: string }> {
  if (!ctx.enabled || !ctx.packageId) return { ok: true };

  try {
    const res = await fetch(`${ctx.apiBase}/api/v3/refi_prequals`, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify({
        product_package_id: ctx.packageId,
        organization_id: ctx.organizationId || undefined,
        status: 'Disqualified',
        attribution_data: reason ? { disqual_reason: reason } : undefined,
      }),
    });
    if (!res.ok) throw await restWriteError(res);
    track('refi.prequal.external_applicant_disqualified', {
      package_id: ctx.packageId,
      reason: reason || '',
    });
    return { ok: true };
  } catch (err) {
    console.warn('[writeback] disqualify refi_prequal failed:', err);
    track('refi.prequal.external_applicant_disqualify_failed', { package_id: ctx.packageId });
    return { ok: false, error: userSafeMessage(err) };
  }
}

export async function submitRefiApplication(
  ctx: WriteContext,
  form: RefiForm
): Promise<{ ok: boolean; error?: string }> {
  if (!ctx.enabled || !ctx.packageId) return { ok: true };
  const empMonths = monthsSince(form.startDate);
  // Co-applicant block — only sent when the agent answered "yes" on the
  // s1_co_app_decision step. The backend (GravityClient → CreateRefiApplication)
  // maps these coapplicant_* keys onto Gravity's joint-applicant fields, and
  // skips the whole block when has_coapplicant is false. Relationship collapses
  // the "Other" free-text into the single coapplicant_relationship value.
  const hasCoApp = form.hasCoApplicant === true;
  const coAppRelationship =
    form.coAppRelationship === 'Other'
      ? form.coAppRelationshipOther || 'Other'
      : form.coAppRelationship || '';
  const coApplicant = hasCoApp
    ? {
        has_coapplicant: true,
        coapplicant_first_name: form.coAppFirst || '',
        coapplicant_last_name: form.coAppLast || '',
        coapplicant_email: form.coAppEmail || '',
        coapplicant_primary_phone: form.coAppPhone || '',
        coapplicant_relationship: coAppRelationship,
        coapplicant_dob: toIsoDate(form.coAppDob),
        coapplicant_ssn: String(form.coAppSsn || '').replace(/\D/g, ''),
        coapplicant_employer_employer: form.coAppEmployer || '',
        coapplicant_employer_employment_type: form.coAppEmploymentType || '',
        coapplicant_employer_income: form.coAppIncome || '',
        coapplicant_employer_income_frequency: 'Annually',
        coapplicant_pp: form.coAppConsent ? 1 : 0,
        coapplicant_tcpa: form.coAppConsent ? 1 : 0,
      }
    : { has_coapplicant: false };
  const payload = {
    product_package_id: ctx.packageId,
    organization_id: ctx.organizationId,
    // Current loan
    current_lienholder: form.lender || '',
    quotes_customer_reported_payoff: form.payoff || '',
    quotes_customer_reported_payment: form.monthlyPayment || '',
    // Residence
    applicant_payment: form.housingPayment || '',
    applicant_months: monthsSince(form.moveInDate),
    applicant_own_rent: String(form.ownRent || '').toUpperCase() || 'RENT',
    // Employment / income
    applicant_employer_employer: form.employer || '',
    applicant_employer_employment_type: form.employmentType || '',
    applicant_employer_income: form.income || '',
    applicant_employer_income_frequency: 'Annually',
    applicant_employer_years: Math.floor(empMonths / 12),
    applicant_employer_months: empMonths % 12,
    // Personal
    applicant_dob: toIsoDate(form.dob),
    applicant_ssn: String(form.ssn || '').replace(/\D/g, ''),
    // Self-reported credit band (e.g. "300_579"); persisted on the
    // LoanApplicantsExternal.credit_score column server-side.
    credit_score: form.creditBand || '',
    // Consent
    applicant_pp: form.consentConfirmed ? 1 : 0,
    applicant_tcpa: form.consentConfirmed ? 1 : 0,
    // Vehicle ownership context
    ownership_status: OWNERSHIP_MAP[String(form.ownership || '').toLowerCase()] || '',
    // Co-applicant (joint) block — has_coapplicant gates the rest server-side.
    ...coApplicant,
  };
  try {
    const res = await fetch(`${ctx.apiBase}/api/v3/admin/refi_applications`, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw await restWriteError(res);
    const data = (await res.json()) as { loan_application_no?: string };
    track('refi.agent.refi_application_created', {
      package_id: ctx.packageId,
      loan_application_no: data?.loan_application_no,
    });
    return { ok: true };
  } catch (err) {
    console.warn('[writeback] create refi_application failed:', err);
    track('refi.agent.refi_application_failed', { package_id: ctx.packageId });
    return { ok: false, error: userSafeMessage(err) };
  }
}

// Map a wizard step the agent just left → the section write-back to fire.
// Called from RefiWizard's beforeStepChange (direction 'next' only).
export function syncForStep(ctx: WriteContext, fromStep: string, form: RefiForm): void {
  if (!ctx.enabled) return;
  if (fromStep === 'vehicle_drive') void syncVehicle(ctx, form);
  else if (fromStep === 's1_ownership') void syncOwnership(ctx, form);
  else if (fromStep === 's1_applicant') void syncUser(ctx, form);
  else if (fromStep === 's1_housing') void syncAddress(ctx, form);
  // NOTE: s1_identity_consent ("Submit for prequal") is handled separately and
  // synchronously in RefiWizard.submitPrequalCreate — it awaits syncUser
  // (/admin/graphql) THEN createRefiPrequal (/api/v3/refi_prequals) and only
  // advances if both succeed. It is intentionally NOT fired here to avoid a
  // duplicate updateUser POST on the same step change.
}

// ---------------------------------------------------------------------------
// Agent notes — persisted to blinker the same way MissionControl does
// (REST /api/v3/admin/notes, polymorphic notable). Notes attach to the
// USER the agent was handed off with (notable_type 'User', notable_id =
// user_id) so MissionControl shows them on that user's detail page. The
// backend stamps the author from the access_token's current_user — i.e.
// the same agent — so no author_id is sent from here.
// ---------------------------------------------------------------------------

// Notes round-trip needs a backend target (token + api_base) AND the user
// to attach to. Independent of the broader write-back gate (`ctx.enabled`,
// which also requires external_user); notes work as long as the hand-off
// carried a user_id + token.
export function notesEnabled(ctx: WriteContext): boolean {
  return !!ctx.apiBase && !!ctx.token && !!ctx.userId;
}

// Shape NotesPanel renders.
export interface NoteEntry {
  id: string;
  body: string;
  created_at: string;
  author_id: string;
  author_persona?: string;
}

interface RawNote {
  id?: string | number;
  text?: string;
  created_at?: string;
  author_full_name?: string;
  author_id?: string | number;
}

function mapNote(n: RawNote): NoteEntry {
  return {
    id: String(n.id ?? ''),
    body: n.text ?? '',
    created_at: n.created_at ?? new Date().toISOString(),
    author_id: n.author_full_name || (n.author_id != null ? String(n.author_id) : 'agent'),
  };
}

// GET /api/v3/admin/notes?notable_id=<user>&notable_type=User —
// newest first.
export async function notesList(ctx: WriteContext): Promise<NoteEntry[]> {
  if (!notesEnabled(ctx)) return [];
  try {
    const params = new URLSearchParams({
      notable_id: ctx.userId,
      notable_type: 'User',
      limit: '50',
      offset: '0',
      sort: 'created_at',
      direction: 'DESC',
    });
    const res = await fetch(`${ctx.apiBase}/api/v3/admin/notes?${params.toString()}`, {
      method: 'GET',
      headers: authHeaders(ctx),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { notes?: RawNote[] };
    return Array.isArray(data?.notes) ? data.notes.map(mapNote) : [];
  } catch (err) {
    console.warn('[notes] list failed:', err);
    return [];
  }
}

// POST /api/v3/admin/notes — mirrors MC's handleAddNote payload, but attaches
// to the User. author_id is omitted on purpose: the controller sets it from
// the access_token's current_user (the agent).
export async function notesCreate(ctx: WriteContext, body: string): Promise<NoteEntry | null> {
  if (!notesEnabled(ctx)) return null;
  try {
    const res = await fetch(`${ctx.apiBase}/api/v3/admin/notes`, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify({
        text: body,
        is_flag: false,
        notable_id: ctx.userId,
        notable_type: 'User',
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as RawNote;
    track('refi.agent.note_added', { user_id: ctx.userId });
    return mapNote(data);
  } catch (err) {
    console.warn('[notes] create failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hydration — autopopulate the form from the DB on (re)entry.
//
// Per-section writes above persist the agent's edits to the user / vehicle /
// address records. On a fresh mount or page reload we re-fetch the package
// from blinker so the form shows the SAVED values (which override the URL
// prefill = the original MissionControl snapshot). Current-loan + employment
// live only on the Gravity refi_application after final submit and aren't
// re-fetchable here, so those fields hydrate only from the URL/local form.
// ---------------------------------------------------------------------------

const PACKAGE_QUERY = `query refiHydrate($id: ID) {
  productPackage(id: $id) {
    id
    vehicle {
      mileage condition usedNew ownershipStatus vin year make model
      trimSyncMetadata
      selectedTrim { name }
    }
    user {
      firstName lastName email phone birthday
      currentAddress { line1 line2 city state zip ownership }
    }
  }
}`;

// blinker → refi reverse maps (inverse of the write-side maps above).
const VEHICLE_OWNERSHIP_REVERSE: Record<string, string> = {
  financed: 'financed',
  leased: 'leased',
  owned: 'owned',
};
const ADDRESS_OWNERSHIP_REVERSE: Record<string, string> = {
  own: 'Own',
  rent: 'Rent',
  other: 'Other',
  'live with others': 'Other',
};

interface PkgVehicle {
  mileage?: number; condition?: string; usedNew?: string; ownershipStatus?: string;
  vin?: string; year?: number; make?: string; model?: string;
  // Trim sync blob — some vehicle records carry YMMT only here, with the
  // year/make/model columns still null (MissionControl reads it the same way
  // for its vehicle label; see VehicleWithProductPackageListItem).
  trimSyncMetadata?: { year?: number | string; make?: string; model?: string; trim?: string } | null;
  selectedTrim?: { name?: string } | null;
}
interface PkgAddress {
  line1?: string; line2?: string; city?: string; state?: string; zip?: string; ownership?: string;
}
interface PkgUser {
  firstName?: string; lastName?: string; email?: string; phone?: string;
  birthday?: string; currentAddress?: PkgAddress;
}

export async function hydrateFromDb(ctx: WriteContext): Promise<Partial<RefiForm>> {
  if (!ctx.enabled || !ctx.packageId) return {};
  try {
    const data = (await postAdminGraphql(ctx, PACKAGE_QUERY, { id: ctx.packageId })) as
      | { productPackage?: { vehicle?: PkgVehicle; user?: PkgUser } }
      | undefined;
    const pkg = data?.productPackage;
    if (!pkg) return {};
    const v: PkgVehicle = pkg.vehicle ?? {};
    const u: PkgUser = pkg.user ?? {};
    const a: PkgAddress = u.currentAddress ?? {};
    const patch: Partial<RefiForm> = {};

    // Vehicle
    if (v.mileage != null) patch.mileage = Number(v.mileage);
    if (v.vin) patch.vin = String(v.vin).toUpperCase();
    // YMMT: the vehicle columns first, then trimSyncMetadata — the same
    // resolution MissionControl uses for its vehicle label, so a record whose
    // trim sync populated only the blob still hydrates instead of coming back
    // blank. Trim has no column at all: selectedTrim is the record's chosen
    // trim, trimSyncMetadata.trim the sync's raw label.
    const tsm = v.trimSyncMetadata ?? {};
    const year = v.year ?? tsm.year;
    if (year != null && year !== '') patch.year = Number(year);
    const make = v.make || tsm.make;
    if (make) patch.make = make;
    const model = v.model || tsm.model;
    if (model) patch.model = model;
    const trim = v.selectedTrim?.name || tsm.trim;
    if (trim) patch.trim = trim;
    if (v.ownershipStatus) {
      const o = VEHICLE_OWNERSHIP_REVERSE[v.ownershipStatus.toLowerCase()];
      if (o) patch.ownership = o as RefiForm['ownership'];
    }
    // Prefer the dedicated used_new field (the New/Used purchase toggle refi
    // owns). Fall back to deriving from the wear grade only when used_new is
    // absent on older vehicle records.
    if (v.usedNew) {
      patch.condition = v.usedNew.toLowerCase() === 'new' ? 'New' : 'Used';
    } else if (v.condition) {
      const c = v.condition.toLowerCase();
      patch.condition = c === 'xclean' || c === 'new' || c === 'excellent' ? 'New' : 'Used';
    }

    // User
    if (u.firstName) patch.firstName = u.firstName;
    if (u.lastName) patch.lastName = u.lastName;
    if (u.email) patch.email = u.email;
    if (u.phone) patch.phone = String(u.phone).replace(/\D/g, '').slice(0, 10);
    // birthday is ISO YYYY-MM-DD — feeds the native DOB CalendarField as-is.
    if (u.birthday) patch.dob = u.birthday;

    // Address
    if (a.line1) patch.address = a.line1;
    if (a.line2) patch.apt_suite = a.line2;
    if (a.city) patch.city = a.city;
    if (a.state) patch.state = a.state;
    if (a.zip) patch.zip = a.zip;
    if (a.ownership) {
      const r = ADDRESS_OWNERSHIP_REVERSE[a.ownership.toLowerCase()];
      if (r) patch.ownRent = r as RefiForm['ownRent'];
    }

    track('refi.agent.hydrated_from_db', { package_id: ctx.packageId });
    return patch;
  } catch (err) {
    console.warn('[hydrate] package fetch failed:', err);
    return {};
  }
}
