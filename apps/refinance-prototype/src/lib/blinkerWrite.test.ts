// blinkerWrite.test — DIRECT-login fresh creation.
//
// Covers the direct-login bootstrap that creates the User / Vehicle / Address /
// ProductPackage when there is no MissionControl hand-off, plus the
// context-resolution helpers that pick hand-off vs. direct mode.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Telemetry is a symlinked workspace dep with side effects — stub it.
vi.mock('blinker-platform/telemetry', () => ({ track: vi.fn() }));

import {
  bootstrapDirectContext,
  ensureDirectEntities,
  directContextFromSession,
  hydrateFromDb,
  resolveWriteContext,
  syncUser,
  syncVehicle,
  type WriteContext,
} from './blinkerWrite';
import { writeSharedSession } from './session';
import { loadBootstrapIds } from './draftStore';
import type { RefiForm } from '../types';

const API = 'http://api.test';

function directCtx(overrides: Partial<WriteContext> = {}): WriteContext {
  return {
    enabled: false,
    direct: true,
    apiBase: API,
    token: 'tok_abc',
    userId: '',
    vehicleId: '',
    addressId: '',
    packageId: '',
    organizationId: '',
    vehicleCondition: '',
    ...overrides,
  };
}

function fullForm(overrides: Partial<RefiForm> = {}): Partial<RefiForm> {
  return {
    firstName: 'Jordan',
    lastName: 'Rivera',
    email: 'jordan@example.com',
    phone: '5125551234',
    dob: '1990-05-01',
    vin: '4T1B11HK9KU685396',
    year: 2019,
    make: 'Toyota',
    model: 'Camry',
    mileage: 42000,
    condition: 'Used',
    address: '123 Main St',
    apt_suite: 'Apt 4',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
    ...overrides,
  };
}

// Mock fetch routed by URL: createUser graphql → vehicle → package.
function mockBootstrapFetch(opts?: { userId?: string; addressId?: string; vehicleId?: string; packageId?: string }) {
  const { userId = '101', addressId = '201', vehicleId = '301', packageId = '401' } = opts || {};
  return vi.fn(async (url: string, _init: { body: string }) => {
    if (url.endsWith('/admin/graphql')) {
      return {
        ok: true,
        json: async () => ({ data: { createUser: { user: { id: userId, currentAddress: { id: addressId } } } } }),
      };
    }
    if (url.endsWith('/api/v3/admin/vehicles')) {
      return { ok: true, json: async () => ({ id: vehicleId }) };
    }
    if (url.endsWith('/api/v3/admin/products/packages')) {
      return { ok: true, json: async () => ({ id: packageId }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

beforeEach(() => {
  vi.stubEnv('VITE_BLINKER_API_URL', API);
  vi.stubEnv('VITE_SESSION_COOKIE_DOMAIN', '');
  localStorage.clear();
  document.cookie = 'blinker_session=; Path=/; Max-Age=0';
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// The vehicle POST resolves the trim from `trim_id` when one is sent and
// otherwise falls back to a case-sensitive year/make/model match that our
// title-cased make cannot satisfy — a 404 "No matching vehicle trim for
// provided year/make/model". These pin the id onto both POST bodies.
describe('vehicle POST trim_id', () => {
  function vehicleBody(fetchMock: ReturnType<typeof vi.fn>) {
    const call = fetchMock.mock.calls.find((c) => c[0] === `${API}/api/v3/admin/vehicles`);
    return JSON.parse(call[1].body);
  }

  it('createVehicleDirect sends the picked trim_id', async () => {
    const fetchMock = mockBootstrapFetch();
    vi.stubGlobal('fetch', fetchMock);

    await bootstrapDirectContext(
      directCtx(),
      fullForm({ trim_id: 30948983 }) as RefiForm
    );

    expect(vehicleBody(fetchMock)).toMatchObject({ trim_id: 30948983 });
  });

  it('syncVehicle sends the picked trim_id', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/v3/admin/vehicles')) {
        return { ok: true, json: async () => ({ id: '301' }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    await syncVehicle(
      directCtx({ enabled: true, vehicleId: '301' }),
      fullForm({ trim_id: 30948983 }) as RefiForm
    );

    expect(vehicleBody(fetchMock)).toMatchObject({ trim_id: 30948983 });
  });

  // Sentinels ("I don't know" / "Other") and decode-injected extras carry no
  // id. The key is dropped rather than sent as null, so the importer sees the
  // same request it saw before this field existed.
  it('omits the key entirely when no trim_id was resolved', async () => {
    const fetchMock = mockBootstrapFetch();
    vi.stubGlobal('fetch', fetchMock);

    await bootstrapDirectContext(directCtx(), fullForm({ trim_id: null }) as RefiForm);

    expect(vehicleBody(fetchMock)).not.toHaveProperty('trim_id');
  });
});

describe('bootstrapDirectContext', () => {
  it('creates User + Vehicle + Address + Package and returns an enabled context', async () => {
    const fetchMock = mockBootstrapFetch();
    vi.stubGlobal('fetch', fetchMock);

    const next = await bootstrapDirectContext(directCtx(), fullForm() as RefiForm);

    expect(next).toMatchObject({
      enabled: true,
      direct: true,
      userId: '101',
      addressId: '201',
      vehicleId: '301',
      packageId: '401',
    });

    // Calls fired in dependency order.
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toEqual([
      `${API}/admin/graphql`,
      `${API}/api/v3/admin/vehicles`,
      `${API}/api/v3/admin/products/packages`,
    ]);

    // ids persisted for re-entry / App.tsx's separate context
    expect(loadBootstrapIds()).toMatchObject({
      userId: '101',
      vehicleId: '301',
      packageId: '401',
    });
  });

  it('createUser payload: customer (no organizationId), address block, real email', async () => {
    const fetchMock = mockBootstrapFetch();
    vi.stubGlobal('fetch', fetchMock);

    await bootstrapDirectContext(directCtx(), fullForm() as RefiForm);

    const graphqlCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/admin/graphql'))!;
    const body = JSON.parse(graphqlCall[1].body);
    const variables = JSON.parse(body.variables); // postAdminGraphql stringifies variables
    expect(variables.user).toMatchObject({
      firstName: 'Jordan',
      lastName: 'Rivera',
      email: 'jordan@example.com',
      generateEmail: false,
      address: { line1: '123 Main St', city: 'Austin', state: 'TX', zip: '78701' },
    });
    // Must NOT send organizationId (would route to the admin-user branch).
    expect(variables.user.organizationId).toBeUndefined();
  });

  it('generates an email and omits the address block when those fields are missing', async () => {
    const fetchMock = mockBootstrapFetch();
    vi.stubGlobal('fetch', fetchMock);

    await bootstrapDirectContext(
      directCtx(),
      fullForm({ email: '', address: '', city: '', state: '', zip: '' }) as RefiForm,
    );

    const graphqlCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/admin/graphql'))!;
    const variables = JSON.parse(JSON.parse(graphqlCall[1].body).variables);
    expect(variables.user.generateEmail).toBe(true);
    expect(variables.user.address).toBeUndefined();
  });

  it('is a no-op for the MissionControl hand-off (direct === false)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const handoff = directCtx({ direct: false });
    const next = await bootstrapDirectContext(handoff, fullForm() as RefiForm);
    expect(next).toBe(handoff);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is a no-op when already bootstrapped (packageId present)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ctx = directCtx({ packageId: '999' });
    const next = await bootstrapDirectContext(ctx, fullForm() as RefiForm);
    expect(next).toBe(ctx);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the original (disabled) context when createUser fails', async () => {
    // createUser returns no id → bootstrap aborts before vehicle/package.
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/admin/graphql')) {
        return { ok: true, json: async () => ({ data: { createUser: { user: {} } } }) };
      }
      throw new Error(`should not reach ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const ctx = directCtx();
    const next = await bootstrapDirectContext(ctx, fullForm() as RefiForm);
    expect(next).toBe(ctx);
    expect(next.enabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1); // never reached vehicle/package
  });
});

// Fetch mock that routes by URL + GraphQL operation so we can assert the
// INCREMENTAL create-or-update passes independently. GraphQL bodies carry the
// query text (postAdminGraphql: { query, variables:<json string> }).
function mockEnsureFetch(opts?: {
  userId?: string;
  addressId?: string;
  vehicleId?: string;
  packageId?: string;
  failVehicle?: string; // when set, /vehicles POST returns this 422 message
}) {
  const { userId = '101', addressId = '201', vehicleId = '301', packageId = '401', failVehicle } =
    opts || {};
  return vi.fn(async (url: string, init: { body: string }) => {
    if (url.endsWith('/admin/graphql')) {
      const query: string = JSON.parse(init.body).query;
      if (query.includes('createUser')) {
        return { ok: true, json: async () => ({ data: { createUser: { user: { id: userId } } } }) };
      }
      if (query.includes('createAddress')) {
        return { ok: true, json: async () => ({ data: { createAddress: { address: { id: addressId } } } }) };
      }
      if (query.includes('updateUser')) {
        return { ok: true, json: async () => ({ data: { updateUser: { user: { id: userId } } } }) };
      }
      if (query.includes('updateAddress')) {
        return { ok: true, json: async () => ({ data: { updateAddress: { address: { id: addressId } } } }) };
      }
      return { ok: true, json: async () => ({ data: {} }) };
    }
    if (url.endsWith('/api/v3/admin/vehicles')) {
      if (failVehicle) {
        return {
          ok: false,
          status: 422,
          clone: () => ({ json: async () => ({ error: 'validation error', message: failVehicle }) }),
        };
      }
      return { ok: true, json: async () => ({ id: vehicleId }) };
    }
    if (url.endsWith('/api/v3/admin/products/packages')) {
      return { ok: true, json: async () => ({ id: packageId }) };
    }
    if (url.includes('/api/v3/admin/vehicles/')) {
      // PUT ownership_status
      return { ok: true, json: async () => ({ id: vehicleId }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

describe('ensureDirectEntities', () => {
  const userOnlyForm = (): Partial<RefiForm> => ({
    firstName: 'Jordan',
    lastName: 'Rivera',
    email: 'jordan@example.com',
    phone: '5125551234',
  });

  it('creates ONLY the user when just the applicant fields are present', async () => {
    const fetchMock = mockEnsureFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { ctx, error } = await ensureDirectEntities(directCtx(), userOnlyForm() as RefiForm);

    expect(error).toBeUndefined();
    expect(ctx).toMatchObject({ userId: '101', addressId: '', vehicleId: '', packageId: '' });
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toEqual([`${API}/admin/graphql`]); // createUser only
    expect(loadBootstrapIds()).toMatchObject({ userId: '101' });
  });

  it('creates address + vehicle + package once the housing fields complete the set', async () => {
    const fetchMock = mockEnsureFetch();
    vi.stubGlobal('fetch', fetchMock);

    // user already exists (created on a prior applicant pass)
    const { ctx, error } = await ensureDirectEntities(
      directCtx({ userId: '101' }),
      fullForm({ ownership: 'financed' }) as RefiForm,
    );

    expect(error).toBeUndefined();
    expect(ctx).toMatchObject({
      enabled: true,
      userId: '101',
      addressId: '201',
      vehicleId: '301',
      packageId: '401',
    });
    // updateUser (existing user re-synced), createAddress, vehicle create,
    // package create, then ownership PUT.
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toEqual([
      `${API}/admin/graphql`, // updateUser (task 5 consistency)
      `${API}/admin/graphql`, // createAddress
      `${API}/api/v3/admin/vehicles`, // vehicle create
      `${API}/api/v3/admin/products/packages`, // package create
      `${API}/api/v3/admin/vehicles/301`, // ownership PUT
    ]);
  });

  it('surfaces the backend validation message and persists the ids minted so far', async () => {
    const fetchMock = mockEnsureFetch({ failVehicle: 'Vehicle mileage is missing' });
    vi.stubGlobal('fetch', fetchMock);

    const { ctx, error } = await ensureDirectEntities(
      directCtx({ userId: '101' }),
      fullForm() as RefiForm,
    );

    expect(error).toBe('Vehicle mileage is missing');
    // address was created before the vehicle failed — id retained + persisted
    expect(ctx.addressId).toBe('201');
    expect(ctx.packageId).toBe('');
    expect(loadBootstrapIds()).toMatchObject({ userId: '101', addressId: '201', packageId: '' });
  });

  it('updates the user in place when it already exists (task 5 consistency)', async () => {
    const fetchMock = mockEnsureFetch();
    vi.stubGlobal('fetch', fetchMock);

    // only the applicant fields present → user exists, nothing else to create
    await ensureDirectEntities(directCtx({ userId: '101' }), userOnlyForm() as RefiForm);

    const graphqlCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/admin/graphql'))!;
    const query = JSON.parse(graphqlCall[1].body).query;
    expect(query).toContain('updateUser');
  });

  it('is a no-op for the MissionControl hand-off (direct === false)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const handoff = directCtx({ direct: false });
    const { ctx } = await ensureDirectEntities(handoff, fullForm() as RefiForm);
    expect(ctx).toBe(handoff);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does NOT call updateAddress on the applicant step when createUser returns a currentAddress but no housing fields are set', async () => {
    // find-or-create hands back an EXISTING user's currentAddress id.
    const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
      if (url.endsWith('/admin/graphql')) {
        const query: string = JSON.parse(init.body).query;
        if (query.includes('createUser')) {
          return {
            ok: true,
            json: async () => ({
              data: { createUser: { user: { id: '101', currentAddress: { id: '201' } } } },
            }),
          };
        }
        throw new Error(`unexpected graphql op: ${query.slice(0, 40)}`);
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { ctx, error } = await ensureDirectEntities(directCtx(), userOnlyForm() as RefiForm);

    expect(error).toBeUndefined();
    // Exactly one call (createUser); NO updateAddress despite the adopted id.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const queries = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).query);
    expect(queries.some((q: string) => q.includes('updateAddress'))).toBe(false);
    expect(ctx.addressId).toBe('201'); // adopted, but left untouched until housing
  });
});

// ---------------------------------------------------------------------------
// syncUser — what reaches the consumer-facing error banner, and what never
// reaches blinker in the first place.
// ---------------------------------------------------------------------------
describe('syncUser', () => {
  function enabledCtx(): WriteContext {
    return directCtx({ enabled: true, direct: false, userId: '101' });
  }

  function graphqlFetch(response: unknown, ok = true) {
    return vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => response }));
  }

  it('surfaces a validation-tagged error verbatim', async () => {
    vi.stubGlobal(
      'fetch',
      graphqlFetch({ errors: [{ message: 'Email is invalid', type: 'validation' }] })
    );

    const res = await syncUser(enabledCtx(), fullForm() as RefiForm);

    expect(res.ok).toBe(false);
    expect(res.error).toBe('Email is invalid');
  });

  it('reads the validation tag off extensions too', async () => {
    vi.stubGlobal(
      'fetch',
      graphqlFetch({
        errors: [{ message: 'Email has already been taken', extensions: { type: 'validation' } }],
      })
    );

    const res = await syncUser(enabledCtx(), fullForm() as RefiForm);

    expect(res.error).toBe('Email has already been taken');
  });

  it('joins several validation errors', async () => {
    vi.stubGlobal(
      'fetch',
      graphqlFetch({
        errors: [
          { message: 'Email is invalid', type: 'validation' },
          { message: 'Phone is invalid', type: 'validation' },
        ],
      })
    );

    const res = await syncUser(enabledCtx(), fullForm() as RefiForm);

    expect(res.error).toBe('Email is invalid; Phone is invalid');
  });

  // Internal wording (CanCan, Doorkeeper, 500s) must not reach the screen; the
  // caller falls back to its own generic copy when error is undefined.
  it('withholds an untagged error from the UI', async () => {
    vi.stubGlobal(
      'fetch',
      graphqlFetch({ errors: [{ message: 'You are not authorized to perform this action' }] })
    );

    const res = await syncUser(enabledCtx(), fullForm() as RefiForm);

    expect(res.ok).toBe(false);
    expect(res.error).toBeUndefined();
  });

  it('withholds a non-2xx failure from the UI', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));

    const res = await syncUser(enabledCtx(), fullForm() as RefiForm);

    expect(res.ok).toBe(false);
    expect(res.error).toBeUndefined();
  });

  it('shows a 422 REST-style body, which blinker only uses for validation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 422,
        clone: () => ({ json: async () => ({ message: 'Dob must be in the past' }) }),
        json: async () => ({ message: 'Dob must be in the past' }),
      }))
    );

    const res = await syncUser(enabledCtx(), fullForm() as RefiForm);

    expect(res.error).toBe('Dob must be in the past');
  });

  // The deep-link-to-s1_identity_consent case: no draft on the consumer's
  // device, so the contact fields are still ''. Sending them would trip the
  // User model's email_format validator on a field nobody edited.
  it('omits blank contact fields instead of blanking the stored ones', async () => {
    const fetchMock = graphqlFetch({ data: { updateUser: { user: { id: '101' } } } });
    vi.stubGlobal('fetch', fetchMock);

    await syncUser(
      enabledCtx(),
      fullForm({ firstName: '', lastName: '', email: '', phone: '' }) as RefiForm
    );

    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    const user = JSON.parse(body.variables).user;

    expect(user).not.toHaveProperty('email');
    expect(user).not.toHaveProperty('phone');
    expect(user).not.toHaveProperty('firstName');
    expect(user).not.toHaveProperty('lastName');
    expect(user.id).toBe('101');
  });

  it('still sends the contact fields when they are populated', async () => {
    const fetchMock = graphqlFetch({ data: { updateUser: { user: { id: '101' } } } });
    vi.stubGlobal('fetch', fetchMock);

    await syncUser(enabledCtx(), fullForm() as RefiForm);

    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    const user = JSON.parse(body.variables).user;

    expect(user.email).toBe('jordan@example.com');
    expect(user.firstName).toBe('Jordan');
    expect(user.birthday).toBe('1990-05-01');
  });
});

describe('directContextFromSession', () => {
  it('is disabled with no session token', () => {
    const ctx = directContextFromSession();
    expect(ctx).toMatchObject({ enabled: false, direct: true });
  });

  it('becomes enabled once ids are bootstrapped and a session token exists', () => {
    writeSharedSession({
      access_token: { access_token: 'live', expires_in: 7200, created_at: new Date().toISOString() },
      user: { email: 'agent@blinker.com' },
    });
    // simulate a prior bootstrap
    localStorage.setItem(
      'refi_ids_default',
      JSON.stringify({ userId: '1', vehicleId: '3', packageId: '4', addressId: '2' }),
    );
    const ctx = directContextFromSession();
    expect(ctx).toMatchObject({ enabled: true, direct: true, packageId: '4', token: 'live' });
  });
});

describe('hydrateFromDb', () => {
  function mockPackageFetch(vehicle: Record<string, unknown>) {
    return vi.fn(async (url: string) => {
      if (url.endsWith('/admin/graphql')) {
        return {
          ok: true,
          json: async () => ({ data: { productPackage: { id: '401', vehicle, user: null } } }),
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
  }

  const handoffCtx = directCtx({ enabled: true, direct: false, packageId: '401' });

  it('restores YMMT from trimSyncMetadata when the vehicle columns are null', async () => {
    vi.stubGlobal(
      'fetch',
      mockPackageFetch({
        vin: null,
        year: null,
        make: null,
        model: null,
        selectedTrim: null,
        trimSyncMetadata: { year: '2019', make: 'Toyota', model: 'Camry', trim: 'SE' },
      }),
    );

    const patch = await hydrateFromDb(handoffCtx);

    expect(patch).toMatchObject({ year: 2019, make: 'Toyota', model: 'Camry', trim: 'SE' });
  });

  it('prefers the vehicle columns and selectedTrim over trimSyncMetadata', async () => {
    vi.stubGlobal(
      'fetch',
      mockPackageFetch({
        year: 2021,
        make: 'Honda',
        model: 'Accord',
        selectedTrim: { name: 'EX-L' },
        trimSyncMetadata: { year: 2019, make: 'Toyota', model: 'Camry', trim: 'SE' },
      }),
    );

    const patch = await hydrateFromDb(handoffCtx);

    expect(patch).toMatchObject({ year: 2021, make: 'Honda', model: 'Accord', trim: 'EX-L' });
  });

  it('omits YMMT entirely when neither source carries it (never blanks the URL prefill)', async () => {
    vi.stubGlobal('fetch', mockPackageFetch({ mileage: 42000, trimSyncMetadata: null, selectedTrim: null }));

    const patch = await hydrateFromDb(handoffCtx);

    expect(patch).toEqual({ mileage: 42000 });
  });
});

describe('resolveWriteContext', () => {
  it('prefers the MissionControl hand-off context from the URL', () => {
    window.history.pushState(
      {},
      '',
      '/?external_user=true&access_token=handoff&user_id=5&package_id=9&vehicle_id=7&address_id=8',
    );
    const ctx = resolveWriteContext();
    expect(ctx).toMatchObject({ enabled: true, packageId: '9', token: 'handoff' });
    expect(ctx.direct).toBeFalsy();
  });

  it('falls back to the direct session context with no hand-off', () => {
    writeSharedSession({
      access_token: { access_token: 'live', expires_in: 7200, created_at: new Date().toISOString() },
      user: { email: 'agent@blinker.com' },
    });
    const ctx = resolveWriteContext();
    expect(ctx.direct).toBe(true);
  });
});
