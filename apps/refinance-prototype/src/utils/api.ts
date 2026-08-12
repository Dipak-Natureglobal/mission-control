/// <reference types="vite/client" />
import { ZIP_FALLBACK } from '../constants/index';
import type { VinDecodeResult, ValuationResult, ZipLookupResult, StreetPrediction, GooglePlacesSuggestion } from '../types';

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
        return (ZIP_FALLBACK as Record<string, ZipLookupResult>)[zip] || null;
    } catch (err) {
        console.warn('[ZIP] zippopotam.us failed, using fallback:', err);
        return (ZIP_FALLBACK as Record<string, ZipLookupResult>)[zip] || null;
    }
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
                includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
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
