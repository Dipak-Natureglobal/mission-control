/// <reference types="vite/client" />
import { ZIP_FALLBACK } from '../constants/index';
import type { VinDecodeResult, VehicleTrimLookupResult, VehicleSearchOptionsResult, PackageStatusResult, ValuationResult, ZipLookupResult, StreetPrediction, GooglePlacesSuggestion } from '../types';

const PLACES_API_KEY = import.meta.env.VITE_PLACES_API_KEY || 'AIzaSyDm1wo_5vN-ioDQ3K1gB3zi42c0o0bSPhY';

const CORS_PROXIES = [
    (url: string) => url,
    (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url: string) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
];

async function _fetchWithCorsProxy(url: string): Promise<Response> {
    const errors: string[] = [];
    for (const buildProxy of CORS_PROXIES) {
        try {
            const proxyUrl = buildProxy(url);
            console.log('[CORS] Trying:', proxyUrl.substring(0, 80));
            const res = await fetch(proxyUrl);
            if (res.ok) {
                const text = await res.text();
                try {
                    const json = JSON.parse(text);
                    if (json.error && typeof json.error === 'string' && Object.keys(json).length <= 2) {
                        throw new Error(`Proxy error: ${json.error}`);
                    }
                    return new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } });
                } catch (parseErr) {
                    if (parseErr instanceof Error && parseErr.message.startsWith('Proxy error')) throw parseErr;
                    throw new Error('Non-JSON response');
                }
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn('[CORS] Proxy failed:', msg);
            errors.push(msg);
        }
    }
    throw new Error('All fetch methods failed: ' + errors.join('; '));
}

// Google Geocoding fallback — resolves ZIP → city/state when zippopotam.us
// AND the static ZIP_FALLBACK table both miss. Without it, any valid ZIP
// outside the demo table dead-ends: city/state stay empty, the street input
// stays locked, and the Housing screen's Next button never enables. The
// classic Geocoding web service returns CORS headers for browser calls
// (same key as the Places "New" autocomplete used by streetPredictionsFor).
async function lookupZipGoogle(zip: string): Promise<ZipLookupResult | null> {
    try {
        const res = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?components=postal_code:${zip}|country:US&key=${PLACES_API_KEY}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const result = data?.results?.[0];
        if (!result) return null;
        const comps: Array<{ types: string[]; long_name: string; short_name: string }> =
            result.address_components || [];
        const find = (type: string) => comps.find((c) => (c.types || []).includes(type));
        const city =
            find('locality')?.long_name ||
            find('postal_town')?.long_name ||
            find('sublocality')?.long_name ||
            find('administrative_area_level_2')?.long_name ||
            '';
        const state = find('administrative_area_level_1')?.short_name || '';
        if (city && state) return { city, state };
        return null;
    } catch (err) {
        console.warn('[ZIP] Google geocode fallback failed:', err);
        return null;
    }
}

export async function lookupZip(zip: string): Promise<ZipLookupResult | null> {
    if (!zip || zip.length !== 5) return null;
    try {
        const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const place = data?.places?.[0];
        if (place) {
            return {
                city: place['place name'],
                state: place['state abbreviation'],
            };
        }
    } catch (err) {
        console.warn('[ZIP] zippopotam.us failed, trying fallbacks:', err);
    }
    // Fallback chain: static demo table → Google geocoding. Google covers
    // every real US ZIP, so manual entry is now a last resort, not the only
    // escape from an unknown ZIP.
    return (
        (ZIP_FALLBACK as Record<string, ZipLookupResult>)[zip] || (await lookupZipGoogle(zip))
    );
}

export async function streetPredictionsFor(
    query: string,
    city: string,
    state: string,
): Promise<StreetPrediction[]> {
    if (!query || query.length < 3) return [];
    try {
        const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': PLACES_API_KEY,
            },
            body: JSON.stringify({
                input: `${query}, ${city}, ${state}`,
                // `route` added: while the user types a partial street, the
                // best matches come back as `route`, which the old
                // ['street_address','premise','subpremise'] filter excluded —
                // so the API returned 200 with an empty body until a full
                // address was typed. All four are valid New-Autocomplete
                // primary types (no 400). Region-restricted to US.
                includedPrimaryTypes: ['street_address', 'route', 'premise', 'subpremise'],
                includedRegionCodes: ['us'],
            }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return ((data.suggestions as GooglePlacesSuggestion[]) || [])
            .filter((s): s is GooglePlacesSuggestion & { placePrediction: NonNullable<GooglePlacesSuggestion['placePrediction']> } =>
                s.placePrediction !== undefined)
            .map((s): StreetPrediction => ({
                placeId: s.placePrediction.placeId,
                description: s.placePrediction.text?.text ?? '',
                structured: {
                    mainText: s.placePrediction.structuredFormat?.mainText?.text ?? '',
                    secondaryText: s.placePrediction.structuredFormat?.secondaryText?.text,
                },
            }))
            .slice(0, 5);
    } catch (err) {
        console.warn('[Places] Street autocomplete failed:', err);
        return [];
    }
}

const MARKETCHECK_API_KEY = import.meta.env.VITE_MARKETCHECK_API_KEY || 'T3ZFAT4Et2ibcKXzkBg48JyBS5EztWqf';
const MARKETCHECK_DEFAULT_ZIP = '31324';

const MARKETCHECK_VIN_CACHE: Record<string, { marketcheck_price: number; msrp: number }> = {
    '4T1B11HK9KU685396': { marketcheck_price: 23246, msrp: 26755 },
    '4T1DAACK3SU125910': { marketcheck_price: 28500, msrp: 32000 },
};

function _buildMarketCheckUrl({ vin, miles, zip }: { vin: string; miles: number; zip: string }): string {
    const params = new URLSearchParams({
        api_key: MARKETCHECK_API_KEY,
        vin,
        miles: String(miles),
        dealer_type: 'franchise',
        zip: zip || MARKETCHECK_DEFAULT_ZIP,
        is_certified: 'false',
    });
    return `https://mc-api.marketcheck.com/v2/predict/car/us/marketcheck_price?${params}`;
}

export async function fetchMarketCheckPrice({
    vin,
    miles,
    zip,
}: {
    vin: string;
    miles: number;
    zip?: string;
}): Promise<ValuationResult> {
    if (!vin || !miles) return { marketcheck_price: null, retail_price: null, error: 'Missing VIN or mileage' };
    const effectiveZip = zip || MARKETCHECK_DEFAULT_ZIP;
    const url = _buildMarketCheckUrl({ vin, miles, zip: effectiveZip });

    try {
        const res = await _fetchWithCorsProxy(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        console.log('[MarketCheck] Valuation fetched via API:', data);
        return {
            marketcheck_price: data?.marketcheck_price ?? null,
            retail_price: data?.msrp ?? data?.retail_price ?? null,
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[MarketCheck] API fetch failed, checking VIN cache:', msg);
        const cached = MARKETCHECK_VIN_CACHE[vin];
        if (cached) {
            console.log('[MarketCheck] Using cached valuation for', vin, cached);
            return {
                marketcheck_price: cached.marketcheck_price,
                retail_price: cached.msrp,
            };
        }
        return {
            marketcheck_price: null,
            retail_price: null,
            error: `Valuation unavailable: ${msg}`,
        };
    }
}

const VINAUDIT_API_KEY = import.meta.env.VITE_VINAUDIT_API_KEY || '2S1SZI7HUF89L6Z';

export async function fetchVinDecode(vin: string): Promise<VinDecodeResult> {
    if (!vin || vin.length !== 17) return { year: null, make: '', model: '', error: 'Invalid VIN' };
    const url = `https://specifications.vinaudit.com/v3/specifications?format=json&include=attributes&key=${VINAUDIT_API_KEY}&vin=${encodeURIComponent(vin)}`;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'VIN not found');
        const a = data.attributes || {};
        return {
            year: a.year ? parseInt(a.year, 10) : null,
            make: a.make || '',
            model: a.model || '',
            trim: a.trim || '',
            type: a.type || '',
            engine: a.engine || '',
            drivetrain: a.drivetrain || '',
            raw: a,
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[VIN Decode] Failed:', msg);
        return { year: null, make: '', model: '', error: `VIN decode failed: ${msg}` };
    }
}

// Candidate-trim lookup against blinker, mirroring MissionControl's
// plateVinForm VIN handler (MissionControl/src/features/refiApp/vehicle/
// plateVinForm.tsx). VinAudit hands back at most ONE free-text trim string
// and frequently returns it blank; blinker's vehicle_by_vin returns the real
// VehicleTrim rows for the VIN, which is what MC populates its Trim dropdown
// from. Requires an access token, so this only runs in the MC hand-off /
// direct-login modes — standalone customer sessions stay on the VinAudit +
// YMMT-fixture path.
//
// NOTE: the backend calls Vehicle.find_or_import(vin) — this is not a
// read-only lookup, it materializes a Vehicle row.
export async function fetchVehicleTrimsByVin({
    vin,
    apiBase,
    token,
}: {
    vin: string;
    apiBase: string;
    token: string;
}): Promise<VehicleTrimLookupResult> {
    const empty: VehicleTrimLookupResult = { year: null, make: '', model: '', trims: [] };
    if (!vin || vin.length !== 17) return { ...empty, error: 'Invalid VIN' };
    if (!apiBase || !token) return { ...empty, error: 'No backend context' };

    const base = apiBase.replace(/\/$/, '');
    const url = `${base}/api/v3/vehicle_by_vin?vin=${encodeURIComponent(vin)}`;
    try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json().catch(() => ({}));
        // VehicleLookupController rescues every failure into a 422 carrying the
        // raw exception message, which is not consumer-readable. MC reports the
        // whole status as "Invalid VIN" (plateVinForm.tsx:322-323); match it.
        if (res.status === 422) throw new Error('Invalid VIN');
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        const trims = Array.isArray(data?.trims)
            ? data.trims
                  .map((t) => ({ id: Number(t?.id ?? t?.trim_id), name: String(t?.name ?? '').trim() }))
                  .filter((t) => Number.isFinite(t.id))
            : [];
        console.log('[Trim Lookup] vehicle_by_vin returned', trims.length, 'trims for', vin);
        return {
            year: data?.year ? parseInt(String(data.year), 10) : null,
            make: data?.make || '',
            model: data?.model || '',
            trims,
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[Trim Lookup] vehicle_by_vin failed:', msg);
        return { ...empty, error: msg };
    }
}

// ProductPackage status lookup — the source of the remittance lock.
//
// blinker freezes a Vehicle once any ProductPackage attached to it is
// `remitted` (Vehicle#remittance_locked?, app/models/vehicle.rb:264), and the
// RemittanceLock concern raises RemittedRecordError on any write to a locked
// record. This call lets refi SHOW that state instead of letting an agent edit
// fields whose save is guaranteed to be rejected.
//
// Endpoint quirk worth knowing: Api::V3::Admin::Products::PackagesController
// #show looks the package up by VEHICLE id, not package id --
//   @user.product_packages.find_by(vehicle_id: params[:id])
// -- and `load_resource :user` sources @user from params[:user_id]. So this is
// {vehicleId} in the path and {userId} in the query, NOT ctx.packageId.
// A 404 means "this user has no package for that vehicle", which is a normal
// pre-package state, not an error worth surfacing.
//
// ActiveModel::Serializer.root is false globally (blinker config/initializers/
// active_model_serializers.rb:3), so the body is flat: { id, status: { code } }.
export async function fetchPackageStatus({
    apiBase,
    token,
    userId,
    vehicleId,
}: {
    apiBase: string;
    token: string;
    userId: string;
    vehicleId: string;
}): Promise<PackageStatusResult> {
    const empty: PackageStatusResult = { code: '', remitted: false };
    if (!apiBase || !token) return { ...empty, error: 'No backend context' };
    if (!userId || !vehicleId) return { ...empty, error: 'No user/vehicle context' };

    const base = apiBase.replace(/\/$/, '');
    const url = `${base}/api/v3/admin/products/packages/${encodeURIComponent(vehicleId)}?user_id=${encodeURIComponent(userId)}`;
    try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (res.status === 404) return { ...empty, error: 'No package for vehicle' };
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error((data && (data.message || data.error)) || `HTTP ${res.status}`);
        const code = String(data?.status?.code ?? '').trim();
        return { code, remitted: code.toLowerCase() === 'remitted' };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[Package Status] lookup failed:', msg);
        return { ...empty, error: msg };
    }
}

// Full YMMT option list from blinker, mirroring MissionControl's
// vehicleOptionsActions.fetchVehicleOptions (MissionControl/src/actions/
// vehicleOptionsActions.ts). One flat array of {year, make, model, trim,
// trim_id} rows built straight off VehicleTrim; MC derives all four dropdowns
// from it (plateVinForm.tsx:386-412) and so do we.
//
// Requires an access token — Api::V3::ApiController#require_user_credential!
// rejects anonymous callers — so standalone customer sessions with no token
// stay on the local YMMT fixture.
//
// The payload is ~4.5MB, so it is memoized per session. The endpoint sends
// Cache-Control: max-age=21600 + ETag, so a page reload is served from the
// browser HTTP cache rather than the wire. Deliberately NOT put in
// localStorage/sessionStorage — 4.5MB exceeds the ~5MB origin quota.
let _searchOptionsPromise: Promise<VehicleSearchOptionsResult> | null = null;

export async function fetchVehicleSearchOptions({
    apiBase,
    token,
}: {
    apiBase: string;
    token: string;
}): Promise<VehicleSearchOptionsResult> {
    if (!apiBase || !token) return { options: [], error: 'No backend context' };
    if (_searchOptionsPromise) return _searchOptionsPromise;

    const base = apiBase.replace(/\/$/, '');
    const url = `${base}/api/v3/vehicle_search_options`;

    _searchOptionsPromise = (async () => {
        try {
            const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
            const data = await res.json().catch(() => null);
            if (!res.ok) throw new Error((data && data.message) || `HTTP ${res.status}`);
            if (!Array.isArray(data)) throw new Error('Unexpected payload shape');

            const options = data
                .map((o) => ({
                    year: Number(o?.year),
                    make: String(o?.make ?? '').trim(),
                    model: String(o?.model ?? '').trim(),
                    // "#{series} #{style}" with both columns nil arrives as " ".
                    trim: String(o?.trim ?? '').trim(),
                    trim_id: Number(o?.trim_id),
                }))
                .filter((o) => Number.isFinite(o.year) && o.make && o.model);

            console.log('[YMMT Options] vehicle_search_options returned', options.length, 'rows');
            return { options };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn('[YMMT Options] vehicle_search_options failed:', msg);
            // Drop the memo so a later mount can retry rather than caching the
            // failure for the whole session.
            _searchOptionsPromise = null;
            return { options: [], error: msg };
        }
    })();

    return _searchOptionsPromise;
}

// Test seam only — clears the session memo above.
export function _resetVehicleSearchOptionsCache(): void {
    _searchOptionsPromise = null;
}

function _ymmtMatch(candidates: string[], target: string): string | null {
    if (!target || !candidates) return null;
    const lower = target.toLowerCase();
    const exact = candidates.find((c) => c === target);
    if (exact) return exact;
    const ci = candidates.find((c) => c.toLowerCase() === lower);
    if (ci) return ci;
    const partial = candidates.find(
        (c) => c.toLowerCase().startsWith(lower) || lower.startsWith(c.toLowerCase()),
    );
    return partial || null;
}

export { _fetchWithCorsProxy, _ymmtMatch };
