// fetchPackageStatus — the remittance-lock probe.
//
// Contract worth pinning down, because the endpoint is easy to call wrongly:
// Api::V3::Admin::Products::PackagesController#show resolves the package by
// VEHICLE id (`@user.product_packages.find_by(vehicle_id: params[:id])`) with
// the user coming from params[:user_id] via `load_resource :user`. So the path
// segment is the vehicle id, NOT the package id.
//
// Every failure path returns remitted:false — callers fail open, since blinker
// itself rejects writes to a remitted record (RemittanceLock::RemittedRecordError)
// and a false lock would freeze an agent with no way out.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPackageStatus } from './api';

const ctx = {
  apiBase: 'https://api.example.test',
  token: 'tok_123',
  userId: '42',
  vehicleId: '907',
};

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchPackageStatus', () => {
  it('calls the admin packages endpoint with vehicle id in the path and user id in the query', async () => {
    const fetchMock = mockFetch(200, { id: 5, status: { code: 'booked', message: 'ok' } });

    await fetchPackageStatus(ctx);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.test/api/v3/admin/products/packages/907?user_id=42');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok_123');
  });

  it('reports remitted for a remitted package', async () => {
    mockFetch(200, { id: 5, status: { code: 'remitted', message: 'ok' } });

    await expect(fetchPackageStatus(ctx)).resolves.toEqual({ code: 'remitted', remitted: true });
  });

  it('does not report remitted for any other status', async () => {
    mockFetch(200, { id: 5, status: { code: 'selected', message: 'ok' } });

    await expect(fetchPackageStatus(ctx)).resolves.toEqual({ code: 'selected', remitted: false });
  });

  it('fails open on 404 — no package for this vehicle is a normal pre-package state', async () => {
    mockFetch(404, {});

    const res = await fetchPackageStatus(ctx);
    expect(res.remitted).toBe(false);
    expect(res.error).toBe('No package for vehicle');
  });

  it('fails open when the request throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );

    const res = await fetchPackageStatus(ctx);
    expect(res.remitted).toBe(false);
    expect(res.error).toBe('network down');
  });

  it('fails open without making a request when the hand-off carries no user id', async () => {
    const fetchMock = mockFetch(200, {});

    const res = await fetchPackageStatus({ ...ctx, userId: '' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.remitted).toBe(false);
    expect(res.error).toBe('No user/vehicle context');
  });
});
