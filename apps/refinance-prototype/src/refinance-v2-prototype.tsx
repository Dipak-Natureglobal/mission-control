// @ts-nocheck
import { useState, useMemo, useEffect, useRef } from "react";
import {
  ArrowLeft, ArrowRight, CheckCircle2, XCircle, Phone, AlertCircle,
  Settings, User, Users, Home, Briefcase, ShieldCheck, FileText,
  Sparkles, Loader2, Car, X, Info, Building2, Check,
  DollarSign, ChevronRight, ChevronDown, RefreshCcw, Eye, EyeOff, Zap,
  Search, Gauge, ScanLine, Plus, ClipboardPaste, Wand2,
  Mail, MessageSquare, Headphones, MapPin, PhoneCall, UserCheck, FileCheck2,
  Shield, Send, ExternalLink, ChevronUp, TrendingDown, BadgeDollarSign
} from "lucide-react";
import { AddressBlock, RelationshipPicker } from "blinker-platform/components";
import {
  estimateMileageFromAge,
  computeAnnualMileageEstimate,
  // Wave 20: year-aware YMMT helpers used by the inline YmmtPicker below.
  // Aliased so they don't collide with this monolith's local YEARS / YMMT_DATA
  // / YMMT_MAKES, which other consumers (constants/index.js, App.jsx,
  // RefiSubFlow.jsx, StageTwoResult.jsx) still import via the constants barrel.
  YEARS as _platformYears,
  getMakes as _platformGetMakes,
  getModelsForYearMake as _platformGetModelsForYearMake,
  getTrimsForYearMakeModel as _platformGetTrimsForYearMakeModel,
} from "blinker-platform/utils";
import { getSequence } from "./lib/refi.js";
import { DEFAULT_ORG_CONFIG } from "./constants/org-config";

/*
  Blinker Refinance v2 — clickable prototype.
  Single-file React component, Tailwind core utilities only.

  Round 2 additions (Apr 11):
   - Vehicle Add + Confirm Drive screens at the front of the workflow
   - YMMT picker (year/make/model/trim) backed by an inlined subset of the
     stoneeagle reference data; will switch to API later
   - Lender autocomplete on the auto-loan screen, backed by an inlined
     subset of the FDIC/NCUA dedupe list
   - Mileage slider with new/used and an estimated annual miles readout
   - Dev panel: vehicle JSON prefill (paste payload + apply, plus presets)
   - Field validation across the wizard with inline error messages
   - Co-applicant decision now reorders by credit band:
       poor band -> ask immediately after self-reported credit
       fair-or-better -> ask after housing + employment
   - Identity + consent merged: when a co-applicant is present, the same
     screen captures DOB / SSN / consent for both, labeled by full name
   - Under-18 DOB triggers a disqualified result with the new under_18 reason
*/

// ---------- Static data ----------

const CREDIT_BANDS = [
  { id: "300_579", label: "300 – 579", desc: "Poor / Very Poor" },
  { id: "580_669", label: "580 – 669", desc: "Fair" },
  { id: "670_739", label: "670 – 739", desc: "Good" },
  { id: "740_799", label: "740 – 799", desc: "Very Good" },
  { id: "800_850", label: "800 – 850", desc: "Exceptional" },
];

const OWNERSHIP_OPTIONS = [
  { id: "financed", label: "Financed — Making payments", eligible: true },
  { id: "leased", label: "Leased — Making payments", eligible: true },
  { id: "owned", label: "Owned — Paid in full", eligible: false },
  { id: "none", label: "No longer own this vehicle", eligible: false },
];

const EMPLOYMENT_TYPES = [
  "At Home",
  "Disability",
  "Employed",
  "Executive",
  "Labourer",
  "Management",
  "Military",
  "Office Staff",
  "Other",
  "Production",
  "Professional",
  "Retired",
  "Retired - Military",
  "Sales",
  "Self-Employed",
  "Semi Professional",
  "Service",
  "Social Security",
  "Student",
  "Trades",
  "Unemployed",
];

const HOUSING_OPTIONS = ["Own", "Rent", "Other"];

const RELATIONSHIP_OPTIONS = [
  "Spouse",
  "Child",
  "Parent",
  "Sibling",
  "Grandparent",
  "Relative",
  "Domestic Partner",
  "Roommate",
  "Other",
];

const DISQUAL_REASONS = {
  no_consent: {
    title: "Consent required",
    msg: "A soft credit pull consent is required before we can submit to any partner.",
  },
  ssn_required_for_partner: {
    title: "SSN required",
    msg: "The matched partner requires an SSN to prequalify. Try a partner that supports no-SSN prequal.",
  },
  state_ineligible: {
    title: "State not eligible",
    msg: "No refinance partner is currently available in the applicant's state.",
  },
  credit_out_of_range: {
    title: "Credit band out of range",
    msg: "The self-reported credit range is outside all configured partner thresholds.",
  },
  income_out_of_range: {
    title: "Income out of range",
    msg: "The stated annual income is outside the configured partner limits.",
  },
  payoff_out_of_range: {
    title: "Payoff out of range",
    msg: "The estimated payoff is outside configured partner limits.",
  },
  no_offers: {
    title: "No offers returned",
    msg: "The partner processed the submission but returned no qualifying offers.",
  },
  partner_rejected: {
    title: "Partner declined",
    msg: "The partner explicitly declined to prequalify this application.",
  },
  under_18: {
    title: "Applicant must be 18 or older",
    msg: "Refinance partners require all applicants to be at least 18 years old. We can't continue with an applicant under the age of majority.",
  },
  vehicle_too_old: {
    title: "Vehicle too old to refinance",
    msg: "The vehicle's model year is outside the configured maximum age for this organization's refinance partners.",
  },
  mileage_too_high: {
    title: "Odometer too high",
    msg: "The reported mileage exceeds the configured maximum for this organization's refinance partners.",
  },
  ownership_ineligible: {
    title: "Ownership status not eligible",
    msg: "Refinancing requires an existing auto loan or lease. Vehicles that are paid in full or no longer owned can't be refinanced.",
  },
  payoff_below_min: {
    title: "Estimated payoff below minimum",
    msg: "The estimated payoff is below the configured minimum for this organization's refinance partners.",
  },
  credit_requires_coapp: {
    title: "Co-applicant required",
    msg: "With a self-reported credit band below 580 and no co-applicant, we can't match any configured refinance partner.",
  },
  employment_and_credit: {
    title: "Employment and credit combination not eligible",
    msg: "Unemployed or self-employed status combined with a fair or poor credit band falls outside all configured partner rules.",
  },
  income_below_min: {
    title: "Annual income below minimum",
    msg: "The stated annual income is below the configured minimum for this organization's refinance partners.",
  },
  ltv_too_high: {
    title: "Loan-to-Value too high",
    msg: "The payoff amount exceeds the maximum allowable loan-to-value ratio for this credit band. The vehicle's market value does not support the remaining balance.",
  },
};

// Default organization configuration now lives in constants/org-config.ts
// (imported in the block at the top of this file and re-exported below for
// straggler consumers). It moved out of this monolith because the old
// re-export direction (org-config re-exporting this const) formed an import
// cycle with lib/refi.js that threw at module-eval time.

const MOCK_OFFERS = [
  {
    id: "sg_a", lender: "Pinnacle Credit Union",
    apr: 6.49, term: 60, monthly: 389, savings: 67,
    disclaimer: "APR based on 720+ FICO, verified income. Subject to final approval.",
  },
  {
    id: "sg_b", lender: "Horizon Bank",
    apr: 6.99, term: 72, monthly: 342, savings: 114,
    disclaimer: "72-month term. Longer terms may increase total interest paid.",
  },
  {
    id: "sg_c", lender: "FirstMark Financial",
    apr: 7.25, term: 48, monthly: 462, savings: 0,
    disclaimer: "48-month term available for qualified borrowers.",
  },
];

// ---------- Protection Plan Data ----------
// Simulates the pre-quoted protection plan options returned by the coverage API.
// Each tier includes the plan name, monthly cost, term, mileage, and covered systems.
// In production these come from the Blinker coverage quoting service.
const MOCK_PROTECTION_PLANS = [
  {
    id: "best",
    tier: "Best",
    name: "Blinker Exclusionary Plan",
    monthlyPrice: 322.43,
    term: "36 months",
    mileage: "40,000 miles",
    tagline: "Most comprehensive coverage available",
    covered: ["Engine", "Transmission", "A/C", "Fuel System", "Electrical", "High-tech Options", "Seals and Gaskets", "Cooling System", "Transfer Case", "Drive Axle"],
  },
  {
    id: "better",
    tier: "Better",
    name: "Blinker Premium Plan",
    monthlyPrice: 222.43,
    term: "36 months",
    mileage: "40,000 miles",
    tagline: "Enhanced powertrain + electrical protection",
    covered: ["Engine", "Transmission", "A/C", "Electrical", "Cooling System", "Drive Axle"],
  },
  {
    id: "good",
    tier: "Good",
    name: "Blinker Powertrain Plan",
    monthlyPrice: 122.43,
    term: "24 months",
    mileage: "30,000 miles",
    tagline: "Essential powertrain protection",
    covered: ["Engine", "Transmission", "Drive Axle", "Transfer Case"],
  },
];

// ---------- Insurance Data ----------
// Simulates the insurance comparison results returned by the Blinker insurance API.
// When insuranceReviewed === true AND insuranceSavings > 0, savings were found.
// When insuranceReviewed === false, the teaser is shown to initiate the process via SMS.

const MOCK_INSURANCE_QUOTES = [
  { carrier: "Progressive", logo: "PROGRESSIVE", monthlyQuoted: 273 },
  { carrier: "Nationwide", logo: "Nationwide", monthlyQuoted: 279 },
  { carrier: "Travelers", logo: "TRAVELERS", monthlyQuoted: 285 },
  { carrier: "Safeco", logo: "Safeco Insurance", monthlyQuoted: 291 },
];

const MOCK_INSURANCE_SAVINGS = {
  bestCarrier: "Progressive",
  currentCarrier: "State Farm",
  currentMonthly: 298,
  bestMonthly: 273,
  monthlySavings: 25,   // 298 - 273
  annualSavings: 300,    // 25 * 12
  coverageChecks: [
    { label: "Exceeds State Minimums", pass: true },
    { label: "Review Deductible", pass: false },
    { label: "Price compared to market", pass: false },
  ],
};

// ---------- Address / ZIP lookup ----------
//
// ZIP → City/State:  Uses zippopotam.us (free, CORS-friendly, no API key).
//   GET https://api.zippopotam.us/us/{zip}  →  { places: [{ "place name", "state abbreviation" }] }
//   Falls back to a static table if the fetch fails (sandbox, offline, etc.)
//
// Street Autocomplete:  Uses Google Maps JS SDK (Places library) when available.
//   The SDK is loaded lazily via <script> tag.  In sandbox/artifact previews where
//   script injection is blocked, the street field is still manually typeable — the
//   autocomplete dropdown simply won't appear.
//
// Google Places API key (for street autocomplete when running on a real domain):
const PLACES_API_KEY = "AIzaSyDm1wo_5vN-ioDQ3K1gB3zi42c0o0bSPhY";
// --------------------------------------------------------------------------

// Fallback static ZIP table — covers major metros for demo/offline use.
const ZIP_FALLBACK = {
  "30301": { city: "Atlanta", state: "GA" },
  "30305": { city: "Atlanta", state: "GA" },
  "31324": { city: "Richmond Hill", state: "GA" },
  "75001": { city: "Addison", state: "TX" },
  "75201": { city: "Dallas", state: "TX" },
  "78701": { city: "Austin", state: "TX" },
  "85001": { city: "Phoenix", state: "AZ" },
  "90001": { city: "Los Angeles", state: "CA" },
  "90210": { city: "Beverly Hills", state: "CA" },
  "94102": { city: "San Francisco", state: "CA" },
  "10001": { city: "New York", state: "NY" },
  "10011": { city: "New York", state: "NY" },
  "11201": { city: "Brooklyn", state: "NY" },
  "33101": { city: "Miami", state: "FL" },
  "32801": { city: "Orlando", state: "FL" },
  "60601": { city: "Chicago", state: "IL" },
  "80202": { city: "Denver", state: "CO" },
  "98101": { city: "Seattle", state: "WA" },
  "97201": { city: "Portland", state: "OR" },
  "02108": { city: "Boston", state: "MA" },
  "19103": { city: "Philadelphia", state: "PA" },
  "37203": { city: "Nashville", state: "TN" },
  "28202": { city: "Charlotte", state: "NC" },
};

// Async ZIP → city/state via zippopotam.us, fallback to static table.
async function lookupZip(zip) {
  if (!zip || zip.length !== 5) return null;
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const place = data?.places?.[0];
    if (place) {
      return {
        city: place["place name"],
        state: place["state abbreviation"],
      };
    }
    return ZIP_FALLBACK[zip] || null;
  } catch (err) {
    console.warn("[ZIP] zippopotam.us failed, using fallback:", err);
    return ZIP_FALLBACK[zip] || null;
  }
}

// ---- Street Autocomplete via Places API (New) REST ----
//
// Uses POST https://places.googleapis.com/v1/places:autocomplete
// Google Places API (New) sends proper CORS headers, so direct fetch works.
//
async function streetPredictionsFor(query, city, state) {
  if (!query || query.length < 3) return [];
  try {
    const res = await fetch(
      "https://places.googleapis.com/v1/places:autocomplete",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": PLACES_API_KEY,
        },
        body: JSON.stringify({
          input: `${query}, ${city}, ${state}`,
          includedPrimaryTypes: ["street_address", "premise", "subpremise"],
          includedRegionCodes: ["us"],
        }),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.suggestions || [])
      .filter((s) => s.placePrediction)
      .map((s) => ({
        text: s.placePrediction.structuredFormat?.mainText?.text || s.placePrediction.text?.text || "",
        fullText: s.placePrediction.text?.text || "",
        placeId: s.placePrediction.placeId,
      }))
      .slice(0, 5);
  } catch (err) {
    console.warn("[Places] Street autocomplete failed:", err);
    return [];
  }
}

// ---------- CORS Proxy Helper ----------
// MarketCheck doesn't send CORS headers.  For the prototype we cascade through
// multiple CORS proxy services.  If ALL proxies are blocked by the sandbox CSP,
// we fall back to a cached VIN lookup so the prototype always shows real data.
// In production, engineering routes through a backend proxy on *.blinker.com.
const CORS_PROXIES = [
  (url) => url, // Attempt 1: direct (works if no CORS issue)
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
];

async function _fetchWithCorsProxy(url) {
  const errors = [];
  for (const buildProxy of CORS_PROXIES) {
    try {
      const proxyUrl = buildProxy(url);
      console.log("[CORS] Trying:", proxyUrl.substring(0, 80));
      const res = await fetch(proxyUrl);
      if (res.ok) {
        // Verify it's real JSON, not an error page
        const text = await res.text();
        try {
          const json = JSON.parse(text);
          // corsproxy.io returns { error: "..." } when it blocks — reject that
          if (json.error && typeof json.error === "string" && Object.keys(json).length <= 2) {
            throw new Error(`Proxy error: ${json.error}`);
          }
          // Return a fake Response with the parsed body
          return new Response(text, { status: 200, headers: { "Content-Type": "application/json" } });
        } catch (parseErr) {
          if (parseErr.message.startsWith("Proxy error")) throw parseErr;
          throw new Error("Non-JSON response");
        }
      }
    } catch (e) {
      console.warn("[CORS] Proxy failed:", e.message);
      errors.push(e.message);
    }
  }
  throw new Error("All fetch methods failed: " + errors.join("; "));
}

// ---------- Vehicle Valuation — MarketCheck API ----------
//
// Fetches the MarketCheck predicted price for a VIN + mileage + ZIP.
// Returns { marketcheck_price, retail_price, error } — error is null on success.
// Both price values are stored on the session for downstream LTV calculation.
// Docs: https://docs.marketcheck.com/docs/api/cars/market-insights/marketcheck_price
//
// NOTE: MarketCheck is a server-to-server API and does not send CORS headers.
// The prototype tries direct fetch then multiple CORS proxies, then falls back
// to a cached VIN table.  In production, engineering routes through a backend
// proxy on *.blinker.com.
//
const MARKETCHECK_API_KEY = "T3ZFAT4Et2ibcKXzkBg48JyBS5EztWqf";
const MARKETCHECK_DEFAULT_ZIP = "31324"; // Default ZIP until applicant enters address

// Cached valuation data for prototype demo VINs.
// These values were fetched from the real MarketCheck API and are used as
// fallback when the sandbox CSP blocks external API calls.
const MARKETCHECK_VIN_CACHE = {
  "4T1B11HK9KU685396": { marketcheck_price: 23246, msrp: 26755 }, // 2019 Toyota Camry SE
  "4T1DAACK3SU125910": { marketcheck_price: 28500, msrp: 32000 }, // test VIN from earlier
  "4T1BF1FK0FU987654": { marketcheck_price: 12450, msrp: 23070 }, // 2015 Toyota Camry LE (Maria — canonical fixture)
};

// ---------- Deterministic Mock Fallback (Dev only) ----------
//
// When both the real API and the CORS proxies fail AND the VIN isn't in the
// hand-curated cache, we still want the prototype to render plausible values
// so dev/demo flows aren't gated on a network call. Mirrors the FNV-1a seeded
// approach in protection-portal/src/lib/marketcheck.js so values stay stable
// across renders for any given VIN+miles+zip.
//
// Only enabled when import.meta.env.DEV is true; production keeps the
// "Valuation unavailable" surfacing so engineering notices a real outage.
function _fnv1aUnit(seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff;
}

function _devMockMarketCheck({ vin, miles, zip }) {
  const seed = `${vin || ""}|${miles || 0}|${zip || ""}`;
  const retailUnit = _fnv1aUnit(seed + ":retail");
  const tradeUnit = _fnv1aUnit(seed + ":trade");
  // Range: $6k to $45k retail (refi-friendly band; tighter than protection's broad
  // $5k-$80k since refi customers tend to be mid-market used).
  const retailRaw = 6000 + retailUnit * 39000;
  // Mileage decay — flatten as miles climb, capped at 55%.
  const decay = Math.min(0.55, ((miles || 0) / 10000) * 0.022);
  let marketcheckPrice = retailRaw * (1 - decay);
  marketcheckPrice = Math.max(4500, Math.round(marketcheckPrice / 50) * 50);
  // Retail (MSRP-equivalent) is 8-22% above marketcheck price, deterministic.
  const retailLift = 1.08 + tradeUnit * 0.14;
  const retailPrice = Math.round((marketcheckPrice * retailLift) / 50) * 50;
  return { marketcheck_price: marketcheckPrice, retail_price: retailPrice };
}

function _buildMarketCheckUrl({ vin, miles, zip }) {
  const params = new URLSearchParams({
    api_key: MARKETCHECK_API_KEY,
    vin,
    miles: String(miles),
    dealer_type: "franchise",
    zip: zip || MARKETCHECK_DEFAULT_ZIP,
    is_certified: "false",
  });
  return `https://mc-api.marketcheck.com/v2/predict/car/us/marketcheck_price?${params}`;
}

async function fetchMarketCheckPrice({ vin, miles, zip }) {
  if (!vin || !miles) return { marketcheck_price: null, retail_price: null, error: "Missing VIN or mileage" };
  const effectiveZip = zip || MARKETCHECK_DEFAULT_ZIP;
  const url = _buildMarketCheckUrl({ vin, miles, zip: effectiveZip });

  try {
    const res = await _fetchWithCorsProxy(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    console.log("[MarketCheck] Valuation fetched via API:", data);
    return {
      marketcheck_price: data?.marketcheck_price ?? null,
      retail_price: data?.msrp ?? data?.retail_price ?? null,
      error: null,
    };
  } catch (err) {
    console.warn("[MarketCheck] API fetch failed, checking VIN cache:", err.message);
    // Fallback 1: cached valuation data for known demo VINs.
    const cached = MARKETCHECK_VIN_CACHE[vin];
    if (cached) {
      console.log("[MarketCheck] Using cached valuation for", vin, cached);
      return {
        marketcheck_price: cached.marketcheck_price,
        retail_price: cached.msrp,
        error: null,
      };
    }
    // Fallback 2 (DEV only): deterministic FNV-1a mock so any VIN renders
    // plausible values when the real API and CORS proxies are unreachable.
    // Hidden from prod so engineering still sees real outages.
    if (import.meta.env.DEV) {
      const mock = _devMockMarketCheck({ vin, miles, zip: effectiveZip });
      console.log("[MarketCheck] Dev mock fallback for", vin, mock);
      return {
        marketcheck_price: mock.marketcheck_price,
        retail_price: mock.retail_price,
        error: null,
      };
    }
    return {
      marketcheck_price: null,
      retail_price: null,
      error: `Valuation unavailable: ${err.message}`,
    };
  }
}

async function fetchMarketCheckPriceYmmt({ year, make, model, trim, miles, zip }) {
  if (!miles || !year || !make || !model) {
    return { marketcheck_price: null, retail_price: null, error: 'Missing miles or YMMT' };
  }
  // Real MarketCheck API requires VIN; for YMMT-only entries we
  // skip the API and use the dev-mock fallback so the prototype
  // demos a plausible value. Production parity will live in the
  // adapter (real EI/MarketCheck has a YMMT-keyed endpoint TBD).
  if (import.meta.env.DEV) {
    const ymmtSeed = [year, make, model, trim || ''].filter(Boolean).join('|').toLowerCase();
    const mock = _devMockMarketCheck({ vin: ymmtSeed, miles, zip: zip || MARKETCHECK_DEFAULT_ZIP });
    console.log('[MarketCheck] Dev mock (YMMT-only) for', ymmtSeed, mock);
    return {
      marketcheck_price: mock.marketcheck_price,
      retail_price: mock.retail_price,
      error: null,
    };
  }
  return {
    marketcheck_price: null,
    retail_price: null,
    error: 'Valuation unavailable (YMMT-only path requires real API support)',
  };
}

// ---------- VIN Decoder — VinAudit Specifications API ----------
//
// Decodes a VIN into year/make/model/trim via VinAudit, then matches the
// result against YMMT_DATA so the prototype's picker fields populate.
// Returns { year, make, model, trim, trimOptions, raw, error }.
//   - trimOptions: array of YMMT trims that match (for the picker dropdown)
//   - raw: the full attributes object from VinAudit
//
const VINAUDIT_API_KEY = "2S1SZI7HUF89L6Z";

async function fetchVinDecode(vin) {
  if (!vin || vin.length !== 17) return { error: "Invalid VIN" };
  const url = `https://specifications.vinaudit.com/v3/specifications?format=json&include=attributes&key=${VINAUDIT_API_KEY}&vin=${encodeURIComponent(vin)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "VIN not found");
    const a = data.attributes || {};
    return {
      year: a.year ? parseInt(a.year, 10) : null,
      make: a.make || "",
      model: a.model || "",
      trim: a.trim || "",
      type: a.type || "",
      engine: a.engine || "",
      drivetrain: a.drivetrain || "",
      raw: a,
      error: null,
    };
  } catch (err) {
    console.warn("[VIN Decode] Failed:", err.message);
    return { error: `VIN decode failed: ${err.message}` };
  }
}

// Case-insensitive best-match helper for YMMT lookups.
// Returns the exact YMMT_DATA key that matches, or null.
function _ymmtMatch(candidates, target) {
  if (!target || !candidates) return null;
  const lower = target.toLowerCase();
  // Exact case match first
  const exact = candidates.find((c) => c === target);
  if (exact) return exact;
  // Case-insensitive match
  const ci = candidates.find((c) => c.toLowerCase() === lower);
  if (ci) return ci;
  // Partial: target starts with candidate or vice-versa
  const partial = candidates.find(
    (c) => c.toLowerCase().startsWith(lower) || lower.startsWith(c.toLowerCase())
  );
  return partial || null;
}

const ROUTING_PHONE = {
  gravity: "1-800-555-9876",
  savings_group: "1-800-555-1212",
};

const PARTNER_NAMES = {
  gravity: "Gravity Lending",
  savings_group: "Savings Group",
};

// Year list — 17 most recent years, descending.
// TODO: retire once all consumers migrate. Wave 20: the inline YmmtPicker
// now reads `YEARS` from blinker-platform/utils (aliased as `_platformYears`
// in the import block at the top of this file). This local const is no
// longer referenced inside this monolith but is preserved for any straggler
// imports we may have missed; safe to delete in a follow-up wave once
// `grep -rn "\\bYEARS\\b" src/` proves zero references outside this file.
const YEARS = (() => {
  const out = [];
  for (let y = 2026; y >= 2010; y--) out.push(y);
  return out;
})();

// Inlined YMMT subset, derived from stoneeagle_ymmt_reference.csv (years 2010-2026).
// Will be replaced with the live Blinker API in production.
const YMMT_RAW = `{"Acura":{"Adx":["A-Spec","A-Spec Advance"],"Csx":["Technology","Type-S"],"Ilx":["20","20 Premium","20 Tech","24 Premium","Base Watch Plus","Dynamic","Hybrid","Hybrid Premium","Hybrid Tech","Premium","Premium A-Spec","Special Edition"],"Ilx Premium Style/Tech St":[],"Ilx Premium/Tech":[],"Ilx Watch Plus":[],"Integra":["A-Spec","A-Spec Tech","Type S"],"Mdx":["A-Spec","A-Spec Advance","Advance","Elite","Navi","Sport Hybrid","Sport Hybrid Advance","Sport Hybrid Technology","Tech Plus","Technology","Type S","Type S Advance"],"Mdx Advance":[],"Mdx Tech":[],"Nsx":["Type-S"],"Rdx":["A-Spec","A-Spec Advance","Advance","Platinum Elite","Technology"],"Rl":[],"Rlx":["Advance","Sport Hybrid","Sport Hybrid Advance","Tech","Tech-Audio","Technology","Watch Plus"],"Tl":["Advance","Se","Sh","Tech"],"Tlx":["A-Spec","Advance","Base","Elite","Platinum Elite","Tech","Tech A","Tech+A","Tech/Tech R","Technology","Type S","Type S Pmc Edition"],"Tsx":["Se","Tech"],"Zdx":["A-Spec","Advance","Technology","Type-S"],"Zdx Tech":[]},"Alfa Romeo":{"4C":["Launch Edition","Spider","Spider Launch Edition"],"Giulia":["Base","Q4","Quadrifoglio","Sport","Sprint","Super","Ti","Ti Q4"],"Stelvio":["Base","Quadrifoglio","Sport","Sprint","Super","Ti","Ti Luxury","Ti Sport","Tributo Italiano","Veloce"],"Tonale":["Base","Speciale","Sprint","Ti","Tributo Italiano","Veloce"]},"Aston Martin":{"Db11":["Amr"],"Db9":["Gt"],"Dbs":["770  Ultimate Volante","770 Ultimate","Gt Zagato","Superleggera","Superleggera Volante"],"Rapide":["Amr","S"],"V12 Vantage":["S"],"Valiant":[],"Valour":[],"Vanquish":["S","Volante","Zagato"],"Vantage":[],"Virage":["Volante"]},"Audi":{"A3":["E-Tron Premium","E-Tron Premium Plus","E-Tron Premium Plus Ultra","E-Tron Premium Ultra","E-Tron Prestige","E-Tron Prestige Ultra","Komfort","Premium","Premium Plus","Premium Plus S-Line","Prestige","Prestige S-Line","Progressiv","S-Line Premium","S-Line Premium Plus","Technik"],"A3 1.8 Premium":[],"A3 1.8 Premium Plus":[],"A3 1.8 Prestige S-Line":[],"A3 2.0 Premium":[],"A3 2.0 Premium Plus":[],"A3 2.0 Prestige S-Line":[],"A3 2.0 Qua Premium":[],"A3 2.0 Quat Prem Plus":[],"A3 2.0 Quattro":[],"A3 Premium":[],"A3 Progressiv":[],"A3 Tdi":[],"A3 Technik":[],"A4":["45","Komfort","Komfort 45","Komfort Plus","Premium","Premium 40","Premium 45","Premium Plus","Premium Plus 40","Premium Plus 45","Premium Plus S-Line","Premium S-Line","Prestige","Prestige 40","Prestige 45","Progressiv","Progressiv Plus","Quattro","Technik","Technik Plus","Ultra Premium","Ultra Premium Plus"],"A4 2.0T Qua Prem Plus":[],"A4 2.0T Qua Premium":[],"A4 2.0T Qua Prestige":[],"A4 Allroad":["Premium","Premium Plus","Prestige","Technik"],"A4 Allroad Premium":[],"A4 Allroad Prestige":[],"A5":["Komfort","Komfort 45","Premium","Premium 40","Premium 45","Premium Plus","Premium Plus 40","Premium Plus 45","Premium Plus S-Line","Premium S Line","Prestige","Prestige 40","Prestige 45","Prestige S-Line","Progressiv","Progressiv 45","Progressiv S-Line","Quattro Technik S-Line","Sport","Technik","Technik 45","Technik S-Line"],"A5 Komfort Quattro":[],"A5 Premium":[],"A5 Premium Plus":[],"A5 Prestige":[],"A5 Progressive":[],"A5 Progressive Quat S-Lin":[],"A5 Quattro Prem Plus":[],"A5 Quattro Premium":[],"A5 Quattro Prestige":[],"A5 Technik":[],"A5 Technik Quattro S-Line":[],"A6":["Competition Prestige","Premium","Premium Plus","Prestige","Progressiv","Progressiv S-Line","Quattro","Quattro Progressiv/Technik S Line","Technik","Technik Quattro","Technik S-Line"],"A6 3.0 Quattro Prem Plus":[],"A6 3.0 Quattro Premium":[],"A6 3.0 Quattro Prestige":[],"A6 3.2 Premium":[],"A6 3.2 Premium Plus":[],"A6 4.2 Quattro Prestige":[],"A6 Allroad":["Premium Plus","Prestige"],"A6 Premium Plus":[],"A7":["Competition Prestige","E Premium Plus","E Prestige","Premium","Premium Plus","Premium Plus S-Line","Premium S-Line","Prestige","Prestige S-Line","Progressiv","Progressiv S-Line","Quattro","Quattro Progressiv/Technik S Line","Technik"],"A7 Technik":[],"A8":["L","L E","L Quattro","L Tdi Quattro","Quattro","Tdi"],"A8 4.2 Quattro Awd":[],"A8 L Quattro Awd":[],"A8 L Tdi Quattro Awd":[],"A8 Quattro":[],"A8 Tdi Quattro":[],"Allroad Premium":[],"Allroad Premium Plus":[],"Allroad Prestige":[],"E-Tron":["Chronos","Premium","Premium Plus","Prestige","Progressiv","Sportback Premium","Sportback Premium Plus","Sportback Prestige"],"E-Tron Gt":["Premium Plus","Prestige"],"E-Tron S":["Premium Plus","Prestige","Sportback","Sportback Premium Plus","Sportback Prestige"],"Q3":["Komfort 45","Premium","Premium 40","Premium Plus","Premium Plus 40","Premium Plus S Line 45","Premium Plus S-Line","Premium S Line","Premium S Line 45","Prestige","Prestige S-Line","Progressiv","Technik","Technik 45"],"Q4 E-Tron":["Komfort","Premium","Premium Plus","Premium Plus S-Line","Premium S Line","Prestige","Prestige S-Line","Progressiv","Sportback","Sportback Prem Plus S Line","Sportback Premium","Sportback Premium Plus","Sportback Premium S Line","Sportback Prestige","Sportback Prestige S Line","Sportback Progressiv","Sportback Technik","Sportback Technology","Technik"],"Q5":["Komfort 45","Premium","Premium 40","Premium 45","Premium Hybrid","Premium Plus","Premium Plus 40","Premium Plus 45","Premium Plus S-Line","Premium S-Line","Prestige","Prestige 40","Prestige 45","Prestige S-Line","Progressiv","Progressiv S-Line","Sportback Premium","Sportback Premium 45","Sportback Premium Plus","Sportback Prestige","Sportback Prestige 45","Sportback Prm Pls 45","Tdi","Tdi  Prestige S-Line","Tdi Premium Plus","Tdi Premium Plus S-Line","Tdi Prestige","Tdi Technik","Tdi Technik S-Line","Technik","Technik S-Line","Titanium Premium Plus","Titanium Prestige"],"Q5 E":["Premium","Premium 55","Premium Plus","Premium Plus 55","Prestige","Prestige 55"],"Q5 Premium Plus":[],"Q6 E-Tron":["Premium","Premium Plus","Prestige","Progressiv","Technik"],"Q7":["4.2","Base","Komfort","Premium","Premium Plus","Prestige","Prestige S-Line","Progressiv","Progressiv S-Line","Sport","Tdi Premium","Tdi Premium Plus","Tdi Prestige","Technik","Technik S-Line"],"Q8":["Premium","Premium Plus","Premium Plus S-Line","Prestige","Prestige S-Line","Progressiv","Progressiv S-Line"],"Q8 E-Tron":["Premium","Premium Plus","Prestige","Sportback Premium","Sportback Premium Plus","Sportback Prestige"],"R8":["4.2 Quattro","5.2 Plus Quattro","5.2 Quattro","5.2 Quattro Carbon Spyder","5.2 Quattro Competition","Gt","Rws","Spyder","Spyder Plus"],"R8 4.2 Quattro":[],"R8 5.2 Plus":[],"R8 5.2 Quattro":[],"Rs E-Tron Gt":[],"Rs Q8":[],"Rs3":[],"Rs5":[],"Rs5 Quattro":[],"Rs6":[],"Rs7":["Performance","Prestige"],"S E-Tron Gt":["Premium Plus","Prestige"],"S3":["Premium","Premium Plus","Prestige","Technik"],"S4":["Premium","Premium Plus","Prestige","Progressiv Plus","Technik Plus"],"S4 Quattro Premium":[],"S4 Quattro Premium Plus":[],"S4 Quattro Prestige":[],"S5":["Dynamic","Premium","Premium Plus","Prestige","Progressiv","Technik"],"S5 Progressive":[],"S5 Quattro Premium Plus":[],"S5 Quattro Prestige":[],"S5 Technik":[],"S6":["Premium","Premium Plus","Prestige"],"S6 Quattro Prestige":[],"S7":["Premium","Premium Plus","Prestige","Quattro","Quattro Progressiv/Technik S Line"],"S8":["Plus","Plus Quattro","Quattro"],"S8 Quattro Awd":[],"Sq5":["Premium","Premium Plus","Prestige","Sportback Premium","Sportback Premium Plus","Sportback Prestige","Technik"],"Sq5 Premium Plus":[],"Sq5 Prestige":[],"Sq6 E-Tron":["Premium","Premium Plus","Prestige"],"Sq7":["Premium Plus","Prestige"],"Sq8":["Premium Plus","Prestige"],"Sq8 E-Tron":["Premium Plus","Prestige","Sportback Premium Plus","Sportback Prestige"],"Tt":["Premium","Premium Plus","Prestige"],"Tt 2.0T Qua Prem Plus":[],"Tt Rs":["Prestige"],"Tts":["Premium","Premium Plus","Prestige"],"Tts Quattro Premium":[]},"BMW":{"128":["I"],"135":["I"],"1M":[],"228":["I","I Sulev","Xi","Xi Sulev"],"228I":[],"228Xi":[],"230I":[],"230Xi":[],"320":["I","I Xdrive","Xi"],"323":["I"],"328":["D","D Xdrive","I","I Sulev","Xi","Xi Sulev","Xigt","Xigt Sulev"],"330":["I","Xi","Xigt"],"330E":[],"330I":[],"330Xe":[],"330Xi":["Gt"],"335":["D","I","I Sulev","Is","Xi","Xigt"],"340":["I","Xi","Xigt"],"340Xi":["Gt"],"428":["I","I Gran Coupe","I Gran Coupe Sulev","I Sulev","Xi","Xi Gran Coupe","Xi Gran Coupe Sulev","Xi Sulev"],"430I":["Gran Coupe"],"430Xi":["Gran Coupe"],"435":["I","I Gran Coupe","Xi","Xi Gran Coupe"],"440I":["Gran Coupe"],"440Xi":["Gran Coupe"],"528":["I","Xi"],"530":["I","Xi"],"530E":[],"530Xe":[],"535":["D","D Xdrive","Gt","I","Igt","Xi","Xigt"],"540":["I","Xi"],"540Xd":[],"550":["Gt","I","Igt","Xe","Xi","Xigt"],"640":["I","I Gran Coupe","Xi","Xi Gran Coupe","Xigt"],"650":["I","I Gran Coupe","Xi","Xi Gran Coupe"],"650I":[],"650I Xi":[],"740":["I","Ld","Ld Xdrive","Li","Li Hybrid","Lxi","Xe","Xi"],"740I":[],"740Li":[],"745Xe":[],"750":["I","I Xdrive","Li","Li Xdrive","Lxi","Xe","Xi"],"760":["Li","Xi"],"840I":[],"840Xi":[],"Active E":[],"Activehybrid 3":[],"Activehybrid 5":[],"Activehybrid 7":[],"Alpina B6":[],"Alpina B7":[],"Alpina B7 Lwb":[],"Alpina B7 Xdrive":[],"Alpina B7 Xdrive Lwb":[],"Alpina B8":[],"I3":["Bev","Rex","S Bev","S Rex"],"I4":["Edrive 35","Edrive 40","M50","Xdrive 40"],"I5":["Edrive 40","M60","Xdrive 40"],"I7":["Edrive50","M70","Xdrive60"],"I8":[],"Ix":["M60","M70","Xdrive40","Xdrive45","Xdrive50","Xdrive60"],"M2":["Competition","Cs"],"M235I":[],"M235Xi":[],"M240I":[],"M240Xi":[],"M3":["Competition","Cs"],"M340I":[],"M340Xi":[],"M4":["Competition","Cs","Csl","Gts"],"M440I":["Gran Coupe"],"M440Xi":["Gran Coupe"],"M5":["Base","Cs","Touring"],"M550Xi":[],"M6":["Gran Coupe"],"M760":["Xi"],"M8":[],"M850Xi":[],"X1":["M35I","Sdrive28I","Xdrive28I","Xdrive35I"],"X2":["M35I","Sdrive28I","Xdrive28I"],"X3":["30 Xdrive","M","M Competition","M40I","M50","Sdrive28I","Sdrive30I","Xdrive28D","Xdrive28I","Xdrive30E","Xdrive30I","Xdrive35I","Xdrivem40I"],"X4":["M","M Competition","M40I","Xdrive28I","Xdrive30I","Xdrive35I","Xdrivem40I"],"X5":["M","M Competition","M50I","M60I","Sdrive 40I","Sdrive35I","Xdr40E","Xdrive30I","Xdrive35D","Xdrive35I","Xdrive40I","Xdrive45E","Xdrive48I","Xdrive50E","Xdrive50I"],"X6":["Hybrid","M","M Competition","M50I","M60I","Sdrive 40I","Sdrive35I","Xdrive35I","Xdrive40I","Xdrive50I"],"X7":["Alpina Xb7","M50I","M60I","Xdrive40I","Xdrive50I"],"Xm":["Label"],"Z4":["M40I","Sdrive28I","Sdrive30I","Sdrive35I","Sdrive35Is"]},"Bentley":{"Bentayga":["Speed"],"Continental":["Flying Spur","Flying Spur Speed","Gt","Gt Speed","Gt Supersports","Gtc","Gtc Speed","Super Sport"],"Flying Spur":[]},"Bugatti Rimac":{"Nevera":[]},"Buick":{"Allure/Lacrosse":["Cx","Cxl","Cxs"],"Cascada":["1Sv","Premium","Sport Touring"],"Enclave":["Avenir","Cx","Cxl","Essence","Preferred","Premium","Sport Touring"],"Encore":["Convenience","Essence","Preferred","Preferred Ii","Premium","Sport Touring"],"Encore Awd":[],"Encore Convenience":[],"Encore Convenience Awd":[],"Encore Gx":["Avenir","Essence","Preferred","Select","Sport Touring"],"Encore Premium":[],"Encore Premium Awd":[],"Envision":["Avenir","Essence","Preferred","Premium","Premium Ii","Sport Touring"],"Envista":["Avenir","Preferred","Sport Touring"],"Lacrosse":["1Sv","Avenir","Convenience","Cx","Cxl","Cxs","Essence","Preferred","Premium","Sport Touring","Touring"],"Lacrosse Awd":[],"Lacrosse Conven W/Eassist":[],"Lacrosse Prem W/Eassist":[],"Lacrosse Premium":[],"Lacrosse Premium Awd":[],"Lacrosse Touring":[],"Lacrosse W/Eassist":[],"Lucerne":["Cx","Cxl","Super Series"],"Regal":["1Sv","Avenir","Convenience","Cxl","Essence","Gs","Preferred","Preferred Ii","Premium","Sport Touring"],"Regal Gs":[],"Regal Premium":[],"Regal Premium W/Eassist":[],"Regal Tourx":["Essence","Preferred"],"Regal W/Eassist":[],"Verano":["1Sv","Convenience","Premium","Sport Touring"]},"Cadillac":{"Ats":["Luxury","Performance","Premium","Premium Luxury","Premium Performance"],"Ats Luxury":[],"Ats Luxury Awd":[],"Ats Performance":[],"Ats Performance Awd":[],"Ats Premium":[],"Ats Premium Awd":[],"Ats-V":[],"Celestiq":["Cadillac Commissioned","Client Commissioned","Tech"],"Ct4":["Luxury","Luxury +","Premium Luxury","Premium Luxury Special Edition","Sport"],"Ct4-V":["Blackwing"],"Ct5":["Luxury","Premium Luxury","Premium Luxury Special Edition","Sport"],"Ct5-V":["Blackwing"],"Ct6":["Luxury","Luxury Csav","Platinum","Platinum Csav","Premium","Premium Luxury","Premium Luxury Csav","Sport","Sport Csav"],"Ct6-V":[],"Cts":["Luxury","Luxury Collection","Performance Collection","Premium Collection","Premium Luxury","Vsport","Vsport Premium","Vsport Premium Luxury"],"Cts Awd":[],"Cts Luxury Collection":[],"Cts Luxury Collection Awd":[],"Cts Performance Coll Awd":[],"Cts Performance Collectio":[],"Cts Premium Collection":[],"Cts Premiumcollection Awd":[],"Cts-V":[],"Dts":["Livery","Luxury Collection","Performance Collection","Platinum","Premium Collection"],"Elr":["Luxury","Sport"],"Elr Luxury":[],"Escalade":["Esv","Esv Luxury","Esv Platinum","Esv Premium","Esv Premium Luxury","Esv Premium Luxury Platinum","Esv Sport","Esv Sport Platinum","Ext","Ext Luxury","Ext Premium","Hybrid","Luxury","Platinum","Platinum Hybrid","Premium","Premium Luxury","Premium Luxury Platinum","Sport","Sport Platinum"],"Escalade Iq":["Lux","Lux-1","Lux-2","Sport","Sport-1","Sport-2"],"Escalade V":["Esv","Esv Sport","Sport"],"Lyriq":["Luxury","Sport","Tech"],"Lyriq-V":[],"Optiq":["Luxury","Sport"],"Professional Chassis":[],"Srx":["Luxury Collection","Performance Collection","Premium Collection"],"Srx Luxury Collection":[],"Srx Performance Collectio":[],"Srx Premium Collection":[],"Sts":["Luxury","Luxury Performance"],"Vistiq":["Luxury","Platinum","Premium Luxury","Sport"],"Xt4":["Luxury","Premium Luxury","Sport"],"Xt5":["Luxury","Platinum","Platinum Premium Luxury","Premium Luxury","Sport"],"Xt6":["Luxury","Platinum Premium Luxury","Premium Luxury","Sport","Sport Platinum"],"Xts":["Armored","Funeral Coach","Limousine","Luxury","Luxury Collection","Platinum","Premium Collection","Premium Luxury","Vsport Platinum","Vsport Premium","Vsport Premium Luxury"],"Xts Delivery":[],"Xts Platinum":[]},"Chevrolet":{"3500":[],"3500Hd":[],"4500":[],"4500Hd":[],"4500Xd":[],"5500Hd":[],"5500Hg":[],"5500Xd":[],"5500Xg":[],"6500Xd":[],"7500Xd":[],"Avalanche":["Ls","Lt","Ltz"],"Aveo":["Ls","Lt"],"Blazer":["1Lt","2Lt","3Lt","L","Lt","Police","Premier","Rs","Ss"],"Bolt Euv":["Lt","Premier"],"Bolt Ev":["1Lt","2Lt","Lt","Premier"],"Brightdrop 400":[],"Brightdrop 600":[],"C1500 Suburban":[],"Camaro":["2Ss","Ls","Lt","Lt1","Lz","Ss","Z28","Zl1"],"Camaro Lt":[],"Camaro Ss":[],"Camaro Zl1":[],"Caprice":["Police"],"Captiva":["Ls","Lt","Ltz","Sport"],"City Express":["Ls","Lt"],"Cobalt":["1Lt","2Lt","Ls","Ss"],"Colorado":["Lt","Trail Boss","Z71","Zr2"],"Corvette":["427","E-Ray 1Lz","E-Ray 2Lz","E-Ray 3Lz","Grand Sport","Grand Sport 1Lt","Grand Sport 2Lt","Grand Sport 3Lt","Stingray","Stingray 1Lt","Stingray 2Lt","Stingray 3Lt","Stingray Z51 1Lt","Stingray Z51 2Lt","Stingray Z51 3Lt","Z06","Z06 1Lz","Z06 2Lz","Z06 3Lz","Zr-1","Zr-1 1Zr","Zr-1 3Zr","Zr1 1Lz","Zr1 3Lz"],"Cruze":["Eco","L","Ls","Lt","Ltz","Premier"],"Cruze Limited":["Eco","L","Ls","Lt","Ltz"],"Cruze Ls":[],"Equinox":["1Lt","2Lt","2Rs","3Lt","3Rs","Activ","L","Ls","Lt","Ltz","Premier","Premiere","Rs"],"Equinox Limited":["Ls","Lt","Premier"],"Equinox Ls Awd":[],"Equinox Lt":[],"Equinox Lt Awd":[],"Equinox Ltz":[],"Express":[],"Express Cutaway":["G4500"],"Express Cutaway G3500":[],"Express Cutaway G4500":[],"Express G1500":["3Lt","4Lt","Ls","Lt"],"Express G1500 Ls":[],"Express G1500 Lt":[],"Express G2500":["3Lt","4Lt","Ls","Lt","Paratransit"],"Express G2500 Ls":[],"Express G2500 Lt":[],"Express G2500 Paratransit":[],"Express G3500":["Ls","Lt","Paratransit"],"Express G3500 Ls":[],"Express G3500 Lt":[],"Express G3500 Paratransit":[],"Express G4500":[],"G1500 3Lt Express Rv":[],"G1500 4Lt Express Rv":[],"G2500 3Lt Express Rv":[],"G2500 4Lt Express Rv":[],"Hhr":["Ls","Lt","Panel Ls","Panel Lt","Ss"],"Impala":["Eco","Ls","Lt","Ltz","Police","Premier"],"Impala Limited":["Ls","Lt","Ltz","Police"],"Impala Ls":[],"Impala Lt":[],"K1500 Suburban":[],"Malibu":["1Lt","2Lt","3Lt","Eco","Hybrid","L","Ls","Lt","Ltz","Premier","Rs"],"Malibu 1Lt":[],"Malibu 2Lt":[],"Malibu Limited":["Ls","Lt","Ltz"],"Malibu Ls":[],"Malibu Ltz":[],"Orlando":["Ls","Lt","Ltz"],"Orlando Ls":[],"Orlando Lt":[],"Orlando Ltz":[],"Silverado":["C1500","C1500 Custom","C1500 High Country","C1500 Hybrid","C1500 Ls","C1500 Lt","C1500 Ltz","C1500 Rst","C2500 Custom","C2500 Heavy Duty","C2500 Heavy Duty Lt","C2500 Heavy Duty Ltz","C2500 High Country","C3500","C3500 High Country","C3500 Lt","C3500 Ltz","Custom","K1500","K1500 Custom","K1500 High Country","K1500 Hybrid","K1500 Ls","K1500 Lt","K1500 Lt Trail Boss","K1500 Lt-L","K1500 Ltz","K1500 Ppv","K1500 Rst","K1500 Trail Boss Custom","K1500 Zr2","K2500 Custom","K2500 Heavy Duty","K2500 Heavy Duty Lt","K2500 Heavy Duty Ltz","K2500 High Country","K2500 Zr2","K3500","K3500 High Country","K3500 Lt","K3500 Ltz","Lt","Rst"],"Silverado C1500":[],"Silverado C1500 Hybrid":[],"Silverado C1500 Ls":[],"Silverado C1500 Lt":[],"Silverado C1500 Ltz":[],"Silverado K1500":[],"Silverado K1500 Hybrid":[],"Silverado K1500 Ls":[],"Silverado K1500 Lt":[],"Silverado K1500 Ltz":[],"Silverado Ld":["C1500","C1500 Custom","C1500 Lt","K1500 Base/Ls","K1500 Custom","K1500 Lt"],"Silverado Ltd":["C1500","C1500 Custom","C1500 High Country","C1500 Lt","C1500 Ltz","C1500 Rst","K1500","K1500 Custom","K1500 High Country","K1500 Lt","K1500 Lt Trail Boss","K1500 Lt-L","K1500 Ltz","K1500 Rst","K1500 Trail Boss Custom"],"Silverado Medium Duty":[],"Sonic":["Ls","Lt","Ltz","Premier","Rs"],"Spark":["1Lt","2Lt","Activ","Ls"],"Spark Ev":["1Lt","2Lt"],"Ss":[],"Suburban":["C1500","C1500  Ls","C1500 High Country","C1500 Ls","C1500 Lt","C1500 Ltz","C1500 Premier","C1500 Rst","C2500","C2500  Ls","C2500  Lt","K1500","K1500 High Country","K1500 Ls","K1500 Lt","K1500 Ltz","K1500 Premier","K1500 Rst","K1500 Z71","K2500","K2500 Ls","K2500 Lt","K3500 Ls","K3500 Lt"],"Suburban Hd":[],"Tahoe":["C1500","C1500  Ls","C1500 Fl","C1500 High Country","C1500 Ls","C1500 Lt","C1500 Ltz","C1500 Ppv","C1500 Premier","C1500 Rst","Hybrid","K1500","K1500 Fl","K1500 High Country","K1500 Ls","K1500 Lt","K1500 Ltz","K1500 Ppv","K1500 Premier","K1500 Rst","K1500 Z71","Police","Special"],"Tahoe C1500":[],"Tahoe C1500 Hybrid":[],"Tahoe C1500 Police":[],"Tahoe K1500":[],"Tahoe K1500 Hybrid":[],"Tilt Master W35042":[],"Tilt Master W4S042":[],"Tilt Master W5S042":[],"Trailblazer":["Activ","L","Ls","Lt","Rs"],"Traverse":["High Country","L","Ls","Lt","Lt Z71","Ltz","Premier","Rs","Z71"],"Traverse Limited":["High Country","Ls","Lt","Premier","Rs"],"Trax":["1Ls","1Lt","1Rs","2Lt","2Rs","Activ","Ls","Ltz","Premier"],"Volt":["Lt","Ltz","Premier"]},"Chrysler":{"200":["C","Limited","Lx","S","Touring"],"200 Limited":[],"200 Lx":[],"200 Touring":[],"300":["Limited","S","Srt-8","Srt8 Core","Touring","Touring L"],"300C":["Luxury","Platinum","Varvatos"],"Grand Caravan":["Sxt"],"Pacifica":["Ehybrid Platinum","Ehybrid Premium","Ehybrid Touring","Hybrid","Hybrid Limited","Hybrid Pinnacle","Hybrid Select","Hybrid Touring","Hybrid Touring L","Hybrid Touring L Plus","Hybrid Touring Plus","L","Limited","Limited Hybrid","Lx","Pinnacle","Select","Touring","Touring L","Touring L Plus","Touring Plus"],"Pt Cruiser":[],"Sebring":["Limited","Lx","Touring"],"Town & Country":["Limited","Limited Platinum","Lx","S","Touring","Touring L","Touring Plus"],"Voyager":["L","Lx","Lxi"]},"Dodge":{"Avenger":["Express","Lux","Mainstreet","R/T","Se","Sxt"],"Caliber":["Express","Heat","Mainstreet","R/T","Rush","Se","Sxt","Uptown"],"Caliber R/T Fwd":[],"Caliber Se":[],"Challenger":["Gt","Mopar Edition R/T","R/T","R/T 392","R/T Scat Pack","Se","Srt 392","Srt Demon","Srt Hellcat","Srt Hellcat Redeye","Srt-8","Srt8 Core","Sxt","Sxt Plus"],"Challenger R/T":[],"Challenger Srt-8":[],"Challenger Srt8 Core":[],"Challenger Sxt":[],"Challenger Sxt Plus":[],"Charger":["Daytona R/T","Daytona Scat Pack","Gt","Police","R/T","R/T 392","R/T Scat Pack","Rallye","Scat Pack","Se","Srt 392","Srt Hellcat","Srt-8","Super Bee","Sxt","Sxt Plus","V6"],"Dakota":["Laramie","Slt","St","Sxt","Trx"],"Dart":["Gt","Gt Sport","Limited","Se","Se Aero","Sxt","Sxt Sport"],"Dart Se":[],"Durango":["Citadel","Crew","Express","Gt","Heat","Limited","Police","Pursuit","R/T","Srt","Srt 392","Srt Hellcat","Ssv","Sxt"],"Grand Caravan":["C/V","Crew","Express","Gt","Hero","Lux","Mainstreet","R/T","Se","Sxt"],"Hornet":["Gt","Gt Plus","R/T","R/T Plus"],"Journey":["Crew","Crossroad","Express","Gt","Heat","Hero","Limited","Lux","Mainstreet","R/T","Se","Sxt"],"Journey Se":[],"Nitro":["Detonator","Heat","Se","Shock","Sxt"],"Ram 1500":["Laramie","Longhorn","Slt","Sport","St"],"Ram 2500":["Laramie","Longhorn","Powerwagon","Slt","St"],"Ram 3500":["Laramie","Longhorn","Slt","St"],"Ram 4500":["St"],"Ram 5500":["St"],"Ram Van":[],"Viper":["Acr","Gtc","Gts","Srt","Srt-10","Srt-10 Acr-X"]},"Ferrari":{"12 Cilindri":[],"12 Cilindri Spider":[],"599":["Gtb Fiorano"],"612":["Scaglietti"],"812 Competizione":[],"812 Competizione A":[],"812 Gts":[],"812 Superfast":[],"Daytona Sp3":[],"F12 Berlinetta":[],"F12Tdf":[],"F60 America":[],"Ff":[],"Gtc4 Lusso":[],"Laferrari":["Aperta"],"Purosangue":[]},"Fiat":{"124 Spider":["Classica"],"500":["Abarth","E La Prima","E Red","Easy","Electric","Lounge","Pop","Sport"],"500 Lounge":[],"500 Pop":[],"500 Sport":[],"500L":["Easy","Lounge","Pop","Trekking"],"500X":["Easy","Lounge","Pop","Sport","Trekking","Trekking Plus"]},"Fisker Inc.":{"Ocean":["Extreme","Ocean One","Sport","Ultra"]},"Ford":{"Bronco":["Badlands","Base","Big Bend","Black Diamond","Everglades","First Edition","Heritage","Heritage Limited","Outer Banks","Raptor","Stroppe Edition","Wildtrak"],"Bronco Sport":["Badlands","Big Bend","First Edition","Free Wheeling","Heritage","Heritage Limited","Outer Banks"],"C-Max":["Premium","Premium Sel","Se","Sel","Titanium"],"Courier":["L","Xl"],"Crown Victoria":["Lx","Police Interceptor","S"],"Econoline":["E150 Van","E150 Wagon","E250 Cutaway Van","E250 Van","E350 Super Duty Cutaway Van","E350 Super Duty Stripped Chassis","E350 Super Duty Van","E350 Super Duty Wagon","E450 Super Duty Commercial Stripped Chassis","E450 Super Duty Cutaway Van"],"Ecosport":["Impulse","S","Se","Ses","Titanium","Trend","Xls","Xlt"],"Edge":["Limited","Se","Sel","Sport","St","Titanium"],"Escape":["Active","Hybrid","Limited","Platinum","S","Se","Se Sport","Sel","St Line","St Line Elite","St Line Select","Titanium","Trend S","Xls","Xlt"],"Expedition":["Active","Eddie Bauer","El Eddie Bauer","El Limited","El Platinum","El Xl","El Xlt","King Ranch","Limited","Max Active","Max King Ranch","Max Limited","Max Platinum","Max Xl","Max Xlt","Platinum","Timberline","Tremor","Xl","Xlt"],"Explorer":["Active","Eddie Bauer","King Ranch","Limited","Platinum","Police Interceptor","Sport","St","St-Line","Timberline","Xlt"],"Explorer Sport Trac":["Limited","Xlt"],"F150":["King Ranch","Lariat","Lightning Lariat","Lightning Platinum","Lightning Pro","Lightning Xlt","Platinum","Police Responder","Raptor","Ssv","Stx","Super Cab","Supercrew","Svt Raptor","Tremor","Xl","Xlt"],"F250":["Super Duty"],"F350":["Super Duty"],"F350 Super Duty":[],"F450":["Super Duty"],"F53":[],"F550":["Super Duty"],"F59":[],"F600":["Super Duty"],"F650":["Super Duty"],"F750":["Super Duty"],"Fiesta":["Ambiente","First","S","Se","Sel","Ses","Sport","St","Titanium","Trend"],"Fiesta S":[],"Fiesta Se":[],"Fiesta Titanium":[],"Figo":["Ambiente","Titanium"],"Flex":["Limited","Se","Sel"],"Flex Sel":[],"Focus":["Ambiente","Atmosphere","Bev","Rs","S","Se","Sel","Ses","Sport","St","Titanium","Trend"],"Fusion":["Hybrid","Police Responder","S","S Hybrid","Se","Se Hybrid","Se Phev","Sel","Special Service","Sport","Taxi","Titanium","Titanium Hev","Titanium Phev","Titanium/Platinum","Titanium/Platinum Hev","Titanium/Platinum Phev"],"Gt":["Carbon Series","Final Edition","Heritage Edition","Liquid Carbon Series","Studio Collection"],"Maverick":["Lariat","Lariat Tremor","Lobo","Lobo-Premium","Tremor","Xl","Xlt","Xlt Tremor"],"Mustang":["50Th Anniversary","Boss 302","Bullitt","Dark Horse","Gt","Mach I","Shelby Gt350","Shelby Gt500"],"Mustang Mach-E":["California Route 1","Gt","Premium","Select"],"Mustang Shelby Gt500":[],"Ranger":["Lariat","Raptor","Super Cab","Xl","Xlt"],"Taurus":["Limited","Police Interceptor","Se","Sel","Sho"],"Territory":[],"Transit":["T-150","T-250","T-350","T-350 Hd"],"Transit Connect":["Titanium","Xl","Xlt","Xlt Premium"],"Transit T-150":[],"Transit T-250":[],"Transit T-350":[],"Transit T-350 Hd":[]},"Genesis":{"G70":["Advanced","Base","Elite","Launch Edition","Prestige","Sport","Sport Advanced","Sport Prestige"],"G80":["Advanced","Base","Prestige","Sport","Sport Advanced","Sport Plus","Sport Prestige","Ultimate"],"G90":["Premium","Prestige Black","Ultimate"],"Gv60":["Advanced","Performance","Standard"],"Gv70":["Advanced","Base","Prestige","Sport","Sport Advanced","Sport Plus","Sport Prestige"],"Gv80":["Advanced","Base","Coupe","Prestige","Select","Standard"]},"Gmc":{"5500":["W55042","W55042-Hd"],"Acadia":["All Terrain","At4","Denali","Elevation","Sl","Sle","Slt","Slt-1","Slt-2","Uplevel"],"Acadia Limited":["Slt-2"],"Canyon":["All Terrain","At4","At4X","Denali","Elevation","Sle","Sle-2","Slt"],"Canyon Sle-2":[],"Canyon Slt":[],"Hummer Pickup":["2","2X","2X Extreme Off Road","3X","3X Extreme Off Road","Edition 1"],"Hummer Suv":["2","2X","2X Extreme Off Road","3X","3X Extreme Off Road"],"Savana":["Cutaway G3500","Cutaway G4500","G1500","G1500 Ls","G1500 Lt","G2500","G2500 Ls","G2500 Lt","G2500 Paratransit","G3500","G3500 Ls","G3500 Lt","G3500 Paratransit","Rv G1500 3Lt","Rv G1500 4Lt","Rv G2500 3Lt","Rv G2500 4Lt"],"Savana G1500":[],"Savana G1500 Ls":[],"Savana G1500 Lt":[],"Savana G2500":[],"Savana G2500 Ls":[],"Savana G2500 Lt":[],"Savana G3500":[],"Savana G3500 Ls":[],"Savana G3500 Lt":[],"Savana Rv G1500 3Lt":[],"Savana Rv G1500 4Lt":[],"Sierra":["C1500","C1500 Denali","C1500 Elevation","C1500 Hybrid","C1500 Sl","C1500 Sle","C1500 Slt","C2500 Denali","C2500 Heavy Duty","C2500 Sle","C2500 Slt","C3500","C3500 Denali","C3500 Sle","C3500 Slt","Denali","K1500","K1500 At4","K1500 At4X","K1500 Denali","K1500 Denali Ultimate","K1500 Elevation","K1500 Elevation-L","K1500 Hybrid","K1500 Sl","K1500 Sle","K1500 Slt","K2500 At4","K2500 At4X","K2500 Denali","K2500 Denali Ultimate","K2500 Heavy Duty","K2500 Sle","K2500 Slt","K3500","K3500 At4","K3500 Denali","K3500 Denali Ultimate","K3500 Sle","K3500 Slt"],"Sierra C1500":[],"Sierra C1500 Denali":[],"Sierra C1500 Hybrid":[],"Sierra C1500 Sl":[],"Sierra C1500 Sle":[],"Sierra C1500 Slt":[],"Sierra C2500 Denali":[],"Sierra C2500 Hd":[],"Sierra C2500 Sle":[],"Sierra C2500 Slt":[],"Sierra C3500":[],"Sierra C3500 Denali":[],"Sierra C3500 Sle":[],"Sierra C3500 Slt":[],"Sierra K1500":[],"Sierra K1500 Denali":[],"Sierra K1500 Hybrid":[],"Sierra K1500 Sl":[],"Sierra K1500 Sle":[],"Sierra K1500 Slt":[],"Sierra K2500 Denali":[],"Sierra K2500 Hd":[],"Sierra K2500 Sle":[],"Sierra K2500 Slt":[],"Sierra K3500":[],"Sierra K3500 Denali":[],"Sierra K3500 Sle":[],"Sierra K3500 Slt":[],"Sierra Limited":["C1500","C1500 Denali","C1500 Elevation","C1500 Sle","C1500 Slt","K1500","K1500 At4","K1500 Denali","K1500 Elevation","K1500 Elevation-L","K1500 Sle","K1500 Slt"],"Terrain":["At4","Denali","Elevation","Sl","Sle","Slt"],"W3500":["W35042"],"W4500":["W45042"],"Yukon":["At4","At4 Ultimate","Denali","Denali Hybrid","Denali Ultimate","Elevation","Hybrid","Sle","Slt"],"Yukon Denali Hybrid":[],"Yukon Denali Xl":[],"Yukon Hybrid":[],"Yukon Xl":["At4","At4 Ultimate","C1500","C1500 Sle","C1500 Slt","C2500","C2500 Sle","C2500 Slt","Denali","Denali Ultimate","Elevation","K1500","K1500 At4","K1500 Sle","K1500 Slt","K2500","K2500 Sle","K2500 Slt"],"Yukon Xl C1500 Sle":[],"Yukon Xl C1500 Slt":[],"Yukon Xl K1500 Sle":[],"Yukon Xl K1500 Slt":[]},"Honda":{"Accord":["Ex","Exl","Hybrid","Hybrid Ex","Hybrid Exl","Hybrid Sport","Hybrid Sport-L","Lx","Lx-S","Lxp","Plug-In Hybrid","Se","Sport","Sport Se","Sport Special Edition","Touring","Touring Hybrid"],"Accord Crosstour":["Ex","Exl"],"Accord Ex":[],"Accord Ex-L":[],"Accord Lx-P":[],"Civic":["Dx","Dx-G","Ex","Exl","Gx","Hf","Hybrid","Hybrid L","Lx","Lx-S","Natural Gas","Se","Si","Sport","Sport Touring","Touring","Type-R","Type-R Limited Edition","Type-R Touring","Vp"],"Civic Ex":[],"Civic Ex-L":[],"Clarity":["Touring"],"Cr-V":["Ex","Exl","Lx","Se","Sport","Sport Touring","Sport-L","Touring","Trailsport"],"Cr-V Ex":[],"Cr-Z":["Ex"],"Crosstour":["Ex","Exl"],"Element":["Ex","Lx","Sc"],"Element Ex":[],"Element Sc":[],"Fcx Clarity":[],"Fit":["Dx","Dx-A","Ex","Exl","Lx","Se","Sport"],"Fit Dx":[],"Fit Ev":[],"Fit Sport":[],"Hr-V":["Ex","Exl","Lx","Sport","Touring"],"Insight":["Ex","Lx","Touring"],"Odyssey":["Black Edition","Dx","Elite","Ex","Exl","Lx","Se","Sport","Sport-L","Touring"],"Passport":["Black Edition","Elite","Exl","Lx","Rtl","Sport","Touring","Trail Sport","Trailsport Elite"],"Pilot":["Black","Elite","Ex","Exl","Exln","Lx","Se","Sport","Touring","Trailsport"],"Prologue":["Eco","Elite","Ex","Ex-L","Tour"],"Ridgeline":["Black Edition","Lx","Rt","Rtl","Rtl-E","Rtl-S","Rts","Special Edition","Sport","Trail Sport"]},"Hummer":{"H3":["Adventure","Alpha","Luxury"],"H3T":["Adventure","Alpha","Luxury"]},"Hyundai":{"Accent":["Blue","Gl","Gls","Gs","Limited","Se","Sport"],"Accent Gls":[],"Accent Gls/Gs/Se":[],"Azera":["Gls","Limited"],"Elantra":["Blue","Eco","Gls","L","Limited","Luxury","N Line","Se","Sel","Sel Sport","Sport"],"Elantra Coupe":["Gs"],"Elantra Gls":[],"Elantra Gls/Se":[],"Elantra Gt":["N Line","Sport"],"Elantra N":[],"Elantra Touring":["Gls"],"Entourage":[],"Equus":["Signature"],"Genesis":["3.8L","4.6L","5.0L"],"Genesis Coupe":["2.0T","3.8 R-Spec","3.8L"],"Genesis Coupe 3.8L":[],"Ioniq":["Blue","Hev","Limited","Preferred","Se","Sel","Ultimate"],"Ioniq 5":["Limited","N","Preferred","Se","Sel","Xrt"],"Ioniq 6":["Limited","Se","Se Standard Range","Sel"],"Ioniq 9":["Calligraphy","Limited","S","Se","Sel"],"Kona":["Essential","Limited","N Line","N Line S","Night","Preferred","Preferred Sport","Se","Sel","Sel Plus","Ultimate"],"Kona N":["Base"],"Nexo":["Blue","Limited"],"Palisade":["Calligraphy","Limited","Se","Sel","Sel Premium","Xrt","Xrt Pro"],"Santa Cruz":["Limited","Night","Preferred","Se","Sel","Sel Premium","Xrt"],"Santa Fe":["Blue","Calligraphy","Gls","Limited","Preferred","Se","Se Ultimate","Sel","Sel Premium","Urban","Xrt"],"Santa Fe Gls":[],"Santa Fe Limited":[],"Santa Fe Se":[],"Santa Fe Sport":[],"Santa Fe Sport Turbo Tech":[],"Santa Fe Sport/Sport Turb":[],"Santa Fe Xl":["Se","Se Ultimate"],"Sonata":["Eco","Eco Turbo","Gl","Gls","Hybrid","Limited","Limited Turbo","Luxury","N Line","Plug-In Hybrid","Preferred-Trend","Se","Sel","Sel Plus","Sel Technology","Sport"],"Sonata Eco/Se":[],"Sonata Gls":[],"Sonata Hybrid":[],"Sonata Se/Hybrid":[],"Sonata Se/Limited":[],"Sonata Sport/Limited":[],"Tucson":["Blue","Fuel Cell","Gl","Gls","Limited","Luxury","N Line","Se","Sel","Sel Convenience","Sport","Ultimate","Value","Xrt"],"Tucson Gl":[],"Veloster":["Base","Turbo"],"Veloster N":[],"Venue":["Se","Sel"],"Veracruz":["Gls"],"Xcient":[]},"Infiniti":{"Ex35":["Base"],"Ex35/Journey":[],"Ex35/Journey Awd":[],"Ex37":["Base"],"Fx35":[],"Fx37":[],"Fx50":[],"G25":["Base"],"G37":["Base","Journey","Sport"],"G37 Awd":[],"G37 Base/Sport":[],"Jx35":[],"M35":["Base"],"M35H":[],"M37":["X"],"M45":["Base"],"M56":["X"],"Q40":[],"Q50":["Base","Hybrid","Hybrid Luxe","Hybrid Premium","Luxe","Premium","Pure","Red Sport 400","Sensory"],"Q60":["Base","Journey","Luxe","Luxe 300","Premium","Pure","Red Sport 400"],"Q70":["3.7","3.7 Luxe","5.6","5.6 Luxe","Hybrid","Hybrid Luxe"],"Q70L":["3.7","3.7 Luxe","5.6","5.6 Luxe"],"Qx30":["Base","Luxe","Pure"],"Qx50":["Autograph","Essential","Luxe","Pure","Sensory","Sport"],"Qx55":["Essential","Luxe","Sensory"],"Qx56":[],"Qx60":["Autograph","Hybrid","Luxe","Pure","Sensory"],"Qx70":[],"Qx80":["Autograph","Base","Luxe","Pure","Sensory"]},"Isuzu":{"Ftr":[],"Fvr":[],"Npr":[],"Npr Hd":[],"Npr Xd":[],"Nqr":[],"Nrr":[]},"Jaguar":{"E-Pace":["Checkered Flag","First Edition","R-Dynamic Hse","R-Dynamic S","R-Dynamic Se","S","Se","Sport","Standard"],"F-Pace":["300 Sport","Base","Checkered Flag","First Edition","Portfolio","Premium","Prestige","R - Sport","R-Dynamic S","S","Svr","Svr 575 Edition"],"F-Type":["400 Sport","75","Checkered Flag","First Edition","Project 7","R","R Dynamic","R75","S","Svr","V8 S"],"F-Type R":[],"F-Type V8 S":[],"I-Pace":["First Edition","Hse","R-Dynamic Hse","S","Se","Waymo"],"Xe":["300 Sport","Base","First Edition","Landmark","Portfolio","Portfolio Le","Premium","Prestige","R - Sport","R-Dynamic S","S","Sv Project 8"],"Xf":["2.0T Premium","3.0 Portfolio","3.0 Portfolio Awd","3.0 Sport","3.0 Sport Awd","300 Sport Le","Checkered Flag","First Edition","Luxury","Portfolio","Portfolio Le","Premium","Prestige","R","R - Sport","R+Speed","R-Dynamic Se","Rs","S","S First Edition","Se","Supercharged"],"Xf 3.0 Portfolio":[],"Xf 3.0 Portfolio Awd":[],"Xf 3.0 Sport":[],"Xf 3.0 Sport Awd":[],"Xf Portfolio":[],"Xf Premium 2.0T":[],"Xf R":[],"Xf Rs":[],"Xf Supercharged":[],"Xfr+Speed":[],"Xj":["Base","Portfolio","Premium Luxury","R - Sport","R575","Sup. Premium","Supercharged","Supersport"],"Xj L Base":[],"Xj L Supercharged":[],"Xj L Supersport":[],"Xj Supercharged":[],"Xj Supersport":[],"Xjl":["Base","Portfolio","Premium Luxury","R","Sup. Premium","Supercharged","Supersport","Ultimate"],"Xjr":["Long Wheel Base"],"Xk":["Portfolio"],"Xkr":["S"]},"Jeep":{"Cherokee":["Altitude Lux","Latitude","Latitude Lux","Latitude Plus","Limited","North","Overland","Sport","Trailhawk"],"Commander":["Limited","Sport"],"Compass":["80Th Edition","Latitude","Latitude Lux","Limited","North","Sport","Trailhawk"],"Gladiator":["Mojave","Overland","Rubicon","Sport","Summit"],"Grand Cherokee":["4Xe","L Laredo","L Limited","L Overland","L Summit","Laredo","Laredo E","Limited","Limited 4Xe","Overland","Overland 4Xe","Srt-8","Summit","Summit 4Xe","Trackhawk","Trailhawk","Trailhawk 4Xe"],"Grand Wagoneer":["L Series I","L Series Ii","L Series Iii","Series I","Series Ii","Series Iii"],"Liberty":["Jet","Limited","Renegade","Sport"],"Liberty Limited":[],"Patriot":["Latitude","Limited","Sport"],"Renegade":["80Th Edition","Altitude","Islander","Latitude","Limited","Sport","Trailhawk"],"Wagoneer":["L Series I","L Series Ii","L Series Iii","Series I","Series Ii","Series Iii"],"Wagoneer S":["Launch Edition","Limited"],"Wrangler":["4Xe","High Altitude","High Altitude 4Xe","Jeep 70Th Anniversary","Rubicon","Rubicon 392","Rubicon 4Xe","Sahara","Sahara 4Xe","Sport","Sport 4Xe"],"Wrangler Sport":[],"Wrangler Unlimited":["4Xe","Jeep 70Th Anniversary","Rubicon","Rubicon 392","Rubicon 4Xe","Sahara","Sahara 4Xe","Sport"],"Wrangler Unlimited Sport":[]},"Kia":{"Amanti":[],"Borrego":["Ex","Lx"],"Cadenza":["Limited","Luxury","Premium","Technology"],"Cadenza Premium":[],"Carnival":["Ex","Lx","Lxs","Sx","Sx Prestige"],"Ev6":["Ex","Ex+","Gl","Gt","Gt Line","Light"],"Ev9":["Gt Line","Land","Light","Wind"],"Forte":["Ex","Fe","Gt","Gt Line","Lx","Sx"],"K4":["Ex","Gt Line","Gt-Line Turbo","Lx"],"K5":["Ex","Gt","Gt Line","Lx","Lxs"],"K900":["Luxury"],"Niro":["Ex","Ex Premium","Ex Touring","Fe","Lx","Lxs","Premium","S","Sx","Sx Touring","Touring","Touring Special Edition","Wave","Wind"],"Optima":["Ex","Hybrid","Hybrid Ex","Hybrid Lx","Lx","Plug In Hybrid Ex","Plug-In Hybrid","Sx","Sxl"],"Optima Ex":[],"Optima Hybrid":[],"Optima Lx":[],"Rio":["Base","Ex","Ex Premium","Lx","S","Sx"],"Rondo":["Ex","Lx"],"Sedona":["Ex","Ex Premium","L","Lx","Sx","Sxl"],"Sedona Ex":[],"Sedona Lx":[],"Seltos":["Ex","Lx","Nightfall","S","Sx","X Line"],"Sorento":["Base","Ex","L","Lx","S","Sx","Sx Prestige","Sxp"],"Sorento Ex":[],"Sorento Lx":[],"Sorento Sx":[],"Sorento Sx/Sx Limited":[],"Soul":["!","+","Ex","Gt Line","Gt-Line Turbo","Lx"],"Soul +/!/Sport":[],"Soul Ev":["+","Base","Designer","Limited","Luxury","Premium"],"Sportage":["Base","Ex","Ex Premium","Lx","S","Sx","Sx Prestige","X Line","X Line Limited","X-Line Prestige","X-Pro","X-Pro Prestige"],"Sportage Ex":[],"Sportage Lx":[],"Stinger":["Gt","Gt Line","Gt1","Gt2","Premium"],"Telluride":["Ex","Lx","S","Sx"]},"Lamborghini":{"Aventador":["50Th Anniversary","Countach","Lp 780-4 Ultimae","S","Sian","Sj","Sv","Svj"],"Gallardo":["Spyder","Superleggera"],"Huracan":["Evo","Performante","Steratto","Sto","Tecnica"],"Murcielago":[],"Revuelto":[],"Veneno":[]},"Land Rover":{"Defender":["110","110 1St Edition","110 75Th Ltd Edition","110 Carpathian Edition","110 Hse","110 S","110 Se","110 Sedona Red","110 X","110 X-Dynamic Hse","110 X-Dynamic Se","110 Xs Edition","130","130 First Edition","130 Outbound","130 S","130 Se","130 X","130 X-Dynamic Se","90","90 1St Edition","90 75Th Ltd Edition","90 Carpathian Edition","90 S","90 Se","90 X","90 X-Dynamic Hse","90 X-Dynamic S","90 X-Dynamic Se","Octa"],"Discovery":["Dynamic Hse","Dynamic Se","First Edition","Hse","Hse Luxury","Hse R-Dynamic","Landmark","Metropolitan Edition","S","S R-Dynamic","Se"],"Discovery Sport":["Dynamic Hse","Dynamic Se","Hse","Hse Dynamic","Hse Luxury","Hse Luxury Dynamic","Hse R-Dynamic","S","S R-Dynamic","Se","Se R-Dynamic"],"Lr2":["Base/Hse","Hse","Hse Luxury","Hse Technology","Se","Se Technology"],"Lr4":["Hse","Hse Luxury","Hse Plus","Se"],"Lr4 Hse":[],"Lr4 Hse Luxury":[],"Range Rover":["Autobiography","Autobiography Black","Autobiography Fifty Edition","First Edition","Hse","Hse Luxury","Hse Westminster Edition","P525 Hse","Se","Supercharged","Sv","Sv Autobiography","Sv Autobiography Dynamic","Westminster","Westminster Edition"],"Range Rover Autobio Black":[],"Range Rover Autobiography":[],"Range Rover Evoque":["Autobiography","Autobiography Dynamic","Bronze Collection","Dynamic","Dynamic Hse","Dynamic Premium","Dynamic Se","First Edition","Hse","Hse Dynamic","Hst","Landmark Edition","Prestige","Prestige Premium","Pure","Pure Plus","Pure Premium","R-Dynamic Hse","R-Dynamic S","R-Dynamic Se","S","Se","Se Dynamic"],"Range Rover Hse":[],"Range Rover Sport":["Autobiography","Autobiography Dynamic","Dynamic Hse","Dynamic S","Dynamic Se","First Edition","Hse","Hse Dynamic","Hse Luxury","Hse Silver Edition","Hst","Lux","P525 Autobiography","P525 Hse","S","Sc","Se","Supercharged Autobiography","Supercharged Dynamic","Sv Edition One","Sv Edition Two","Svr"],"Range Rover Sport Autobio":[],"Range Rover Sport Hse":[],"Range Rover Sport Lux":[],"Range Rover Sport Sc":[],"Range Rover Sport Se":[],"Range Rover Supercharge":[],"Range Rover Velar":["Autobiography","Dynamic Hse","Dynamic Se","Hst","R-Dynamic Hse","R-Dynamic S","R-Dynamic Se","S","Se","Sv Autobiography Dynamic"],"Range Rvr Evoque Prestige":[],"Range Rvr Evoque Pure":[]},"Lexus":{"Ct":["200"],"Es":["250","250 Base","300H","300H Base","300H F Sport","300H F Sport Handling","300H Luxury","300H Ultra Luxury","350","350 Base","350 F Sport","350 F Sport Handling","350 Luxury","350 Ultra Luxury"],"Gs":["200T","200T Base","300 Base","350","350 Base","350 F Sport","450H","450H Base","460"],"Gs-F":[],"Gx":["460","460 Luxury","460 Premium","550 Luxury","550 Premium/Premium+","Base","Premium"],"Hs":["250H"],"Is":["200T","250","300","300 F Sport","300 Premium","350","350 F Sport","350 F Sport Design","350 Premium","500 F Sport","F"],"Lc":["500","500H"],"Lfa":[],"Ls":["460","460L","500","500 Base","500 F Sport","500H","600Hl"],"Lx":["570","600 Base","600 Premium","600 Ultra Luxury","700H Overtrail","700H Ultra Luxury"],"Nx":["200T","200T Base","250","250 Base","250 Luxury","250 Premium","300","300 Base","300 F Sport","300 Luxury","300H","300H Base","300H Luxury","350","350 Base","350 Luxury","350 Premium","350H","350H Base","350H Luxury","350H Premium","450H","450H F Sport","450H Luxury"],"Rc":["200T","300","300 Base","300 F Sport","350","350 Base","350 F Sport"],"Rc-F":["Base","Track Edition"],"Rx":["350","350 Base","350 F Sport","350 L","350 L Luxury","350 Premium","350H Base","450H","450H Base","450H F Sport","450H L","450H L Base","450H L Luxury","450H+ Luxury","500H F Sport"],"Rz":["300E","450E"],"Sc":["430"],"Tx":["350 Base","500H F Sport Premium","550H+ Luxury"],"Ux":["200","200 Base","250H","250H Base","250H Premium","300H Base"]},"Lincoln":{"Aviator":["Black Label","Black Label Grand Touring","Grand Touring","Reserve"],"Continental":["Black Label","Premiere","Reserve","Select"],"Corsair":["Grand Touring","Premiere","Reserve"],"Mark Lt":[],"Mkc":["Black Label","Premiere","Reserve","Select"],"Mkc Black Label":[],"Mks":[],"Mks Awd":[],"Mkt":[],"Mkx":["Black Label","Premiere","Reserve","Select"],"Mkz":["Black Label","Hybrid","Hybrid Black Label","Hybrid Premiere","Hybrid Reserve","Hybrid Select","Premiere","Reserve","Reserve I","Reserve Ii","Select"],"Nautilus":["Black Label","Premiere","Reserve","Select"],"Navigator":["Black Label","L","L Black Label","L Presidential","L Reserve","L Select","Preferred","Premiere","Presidential","Reserve","Select"],"Town Car":["Executive","Executive L","Signature Limited","Signature Long Wheelbase"]},"Lotus":{"Eletre":[]},"Lucid Motors":{"Air":["Dream","Grand Touring","Pure","Sapphire","Touring"],"Gravity":["Grand Touring","Touring"]},"Maserati":{"Ghibli":["334 Ultima","Base","Fragment","Luxury","Mc Edition","Modena","S","Sport","Trofeo"],"Grancabrio":["Folgore","Modena","Trofeo"],"Granturismo":["Folgore","Modena","S","Trofeo"],"Grecale":["Folgore"],"Mc20":["25","Cielo","Folgore","Gt2 Stradale","Gt2S"],"Quattroporte":["Base","Fragment","Gts","Mc Edition","Modena","Modena Q4","S","Trofeo"],"Quattroporte S/Sport Gt-S":[]},"Maybach":{"Maybach":["57","57S","57S Zeppelin","62","62S Zeppelin","62S/Landaulet"]},"Mazda":{"3":["100Th Anniversary","Carbon Turbo","Grand Touring","Gt","Gx","I","Preferred","Preferred Plus","Premium","Premium Plus","Rss Sv","S","Se","Select","Select Sport","Sport","Sv","Touring"],"5":["Grand Touring","Se","Sport","Sv","Touring"],"6":["Grand Touring","Grand Touring Reserve","Gs-L","Gt","I","S","Se","Signature","Sport","Touring","Touring Plus"],"B2300":["Cab Plus"],"B4000":["Cab Plus"],"Cx-3":["Grand Touring","Se","Sport","Sv","Touring"],"Cx-30":["Carbon Turbo","Gt","Gx","Preferred","Premium","Premium Plus","Rss Sv","Select"],"Cx-5":["Carbon Edition","Carbon Turbo","Grand Touring","Grand Touring Reserve","Gt","Gx","Preferred","Premium","Premium Plus","Se","Select","Signature","Sport","Touring"],"Cx-50":["Base","Gs-L","Preferred","Preferred Plus","Premium","Premium Plus","Select"],"Cx-7":[],"Cx-70":["Gs-L","Preferred","Premium","Premium Plus","Sv"],"Cx-9":["Carbon Edition","Grand Touring","Gs","Signature","Sport","Sv","Touring","Touring Plus"],"Cx-9 Awd":[],"Cx-9 Se":[],"Cx-9 Sv":[],"Cx-90":["Gs-L","Preferred","Preferred Plus","Premium","Premium Plus","Premium Sport","Select"],"Mazda2":["Grand Touring","Se","Sport","Sv","Touring"],"Mazda6S":[],"Mx-30":["Gs","Gt","Gx","Premium","Premium Plus","Sv"],"Mx-5 Miata":["100Th Anniversary","100Th Sv","30Th Sv","Club","Grand Touring","Gs","Se","Sport","Sv"],"Rx8":[],"Speed":["3"],"Tribute":["Hybrid","I","S"]},"Mercedes-Benz":{"A":["220","220 4Matic","250","250 4Matic","35 4Matic","35 Amg"],"Amg Gt":["43","53","55","63","63 Amg S E Performance","63 S","Black Series","C","R","S"],"B":["250 4Matic","250E","Electric","F-Cell"],"B200":["T"],"B250":["4Matic"],"C":["250","250 4Matic","250D 4Matic","300","300 4Matic","350","350 4Matic","350E","400 4Matic","43 4Matic Amg","43 Amg","450 4Matic Amg","63 Amg","63 Amg S E Performance","63 Amg-S"],"C250D 4Matic":[],"Cl":["550 4Matic","600","63 Amg","65 Amg"],"Cla":["250","250 4Matic","45 Amg","Amg 35 4Matic","Amg 45S 4Matic"],"Cla 45 Amg":[],"Cle":["300 4Matic","450 4Matic","Amg 53 4Matic"],"Cls":["400","400 4Matic","450","450 4Matic","550","550 4Matic","63 Amg","63 Amg S-Model","Amg 53 4Matic"],"E":["250 Bluetec","300","300 4Matic","350","350 4Matic","350 4Matic Wagon","350 Bluetec","400","400 4Matic","400 Hybrid","400S 4Matic","43 4Matic Amg","450","450 4M All Terrain","450 4Matic","550","550 4Matic","63 Amg","63 Amg-S","63 Amg-S 4Matic","Amg 53","Amg 53 4Matic","Amg 53E 4Matic"],"E350":[],"E3504M Wagon Awd":[],"E550":[],"E550 4Matic Awd":[],"E63 Amg":[],"Eqb":["250+","300 4Matic","350 4Matic"],"Eqe Sedan":["350 4Matic","350+","500 4Matic","53 4Matic+","Amg Eqe 4Matic+"],"Eqe Suv":["350 4Matic","350+","500 4Matic","Amg 4Matic"],"Eqs Sedan":["450 4Matic","450+","53 4Matic+","580 4Matic","Amg Eqs 4Matic+"],"Eqs Suv":["450 4Matic","450+","580 4Matic","680 4Matic Maybach"],"Esprinter":["2500"],"G":["55 Amg","550","550 4X4 Squared","580E","63 Amg","65 Amg"],"G55":[],"G550":[],"Gl":["350 Bluetec","450","450 4Matic","550 4Matic","63 Amg"],"Gla":["250","250 4Matic","35 Amg","45 Amg"],"Gla-Class 250":[],"Gla-Class 250 4Matic":[],"Glb":["250","250 4Matic","Amg 35 4Matic"],"Glc":["300","300 4Matic","350E","43 4Matic Amg","63 4Matic Amg","63 Amg S E Performance","63 S 4Matic Amg"],"Glc Coupe":["300 4Matic","43 4Matic Amg","63 4Matic Amg","63 Amg S E Performance","63 S 4Matic Amg"],"Gle":["300D 4Matic","350","350 4Matic","350D 4Matic","400 4Matic","43 Amg","450 4Matic","450 Amg Sport 4Matic","450E 4Matic","550 4Matic","550E 4Matic","580 4Matic","63 Amg 4Matic","63 Amg-S 4Matic","63 S 4Matic Amg","Amg 53 4Matic"],"Gle 450 Amg Sport 4Matic":[],"Gle Coupe":["43 Amg","450 4Matic","63 Amg-S","63 S 4Matic Amg","Amg 53 4Matic"],"Glk":["250 Bluetec","350","350 4Matic"],"Gls":["350D 4Matic","450 4Matic","550 4Matic","580 4Matic","63 Amg 4Matic","Mercedes-Maybach Gls600 4M"],"Metris":[],"Ml":["250 Bluetec","350","350 4Matic","350 Bluetec","400","400 4Matic","450 Hybrid","550 4Matic","63 Amg"],"R":["350 4Matic","350 Bluetec"],"S":["350 Bluetec","400","400 4Matic","450","450 4Matic","500 4Matic","550","550 4Matic","550E","560","560 4Matic","580 4Matic","600","63 Amg","63 Amg 4Matic","63 E Performance","65 Amg","Mercedes-Maybach S 580 4M","Mercedes-Maybach S550 4Matic","Mercedes-Maybach S560 4Matic","Mercedes-Maybach S600","Mercedes-Maybach S650","Mercedes-Maybach S680 4M","S560E","S580E 4Matic","S600"],"S550":[],"Sl":["400","43 Amg","450","55 Amg","550","600","63 Amg","63 Amg S E Performance","65 Amg"],"Slc":["300","43 Amg"],"Slk":["250","300","350","55 Amg"],"Sls":["Amg","Amg Gt"],"Sls Amg":[],"Sprinter":["1500","1500/2500","2500","2500/3500","3500","3500/4500","4500"]},"Mercury":{"Grand Marquis":["Ls"],"Mariner":["Hybrid","Premier"],"Milan":["Hybrid","Premier"],"Mountaineer":["Luxury","Premier"]},"Mini":{"Cooper":["Base","Clubman","Clubman All4","Clubman Jcw","Countryman","Countryman All4","Countryman Jcw","Jcw Clubman","Jcw Countryman All4","John Cooper Works","John Cooper Works Clubman","John Cooper Works Clubman All4","John Cooper Works Gp","John Cooper Works Gp Kit","Paceman","Paceman Jcw","S","S Clubman","S Clubman All4","S Countryman","S Countryman All4","S E Countryman All4","S Paceman","Se","Sportback Ls Jcw"],"Cooper Clubman Jcw Gp Kit":[],"Cooper Coupe":["John Cooper Works","John Cooper Works Gp Kit","S"],"Cooper Coupe John Cw":[],"Cooper Jcw Gp Kit":[],"Cooper Roadster":["John Cooper Works","S"],"Cooper Roadster John Cw":[],"Cooper S":[],"Countryman":["Jcw All4","S All4","Se All4"]},"Mitsubishi":{"Eclipse":["Gs","Gs Sport","Gt","Spyder Gs","Spyder Gt"],"Eclipse Cross":["Es","Le","Se"],"Endeavor":["Limited","Ls","Se"],"Galant":["Es","Fe"],"I Miev":["Es"],"I Miev Es/Se":[],"Lancer":["De","Es","Es/Es Sport","Evolution","Evolution Gsr","Evolution Mr","Evolution Se","Gt","Gts","Ralliart","Se","Sportback Es","Sportback Se Limited"],"Lancer Gts":[],"Lancer Ralliart & Sport":[],"Mirage":["De","Es","G4 Es","G4 Se","Gt","Le","Se"],"Outlander":["Es","Fe","Gt","Le","Se","Sel","Xls"],"Outlander Sport":["Es","Gt","Le","S","S/Se","Se","Sel"],"Rvr":["Es","Gt","Se","Se Limited"],"Rvr Gt":[]},"Nissan":{"370Z":["Base"],"Altima":["2.5","3.5S","3.5Sl","Base","Edition One","Hybrid","Platinum","S","Sl","Sr","Sv"],"Ariya":["Engage","Evolve+","Platinum +","Venture+"],"Armada":["Platinum","Platinum Reserve","Pro-4X","S","Se","Sl","Sv"],"Cube":["Base","S"],"Frontier":["Crew Cab Se","King Cab Se","S","Sv"],"Gt-R":["Base","Nismo","Nismo Special Edition","Premium","Pure","T-Spec","Track Edition"],"Juke":["Nismo Rs","S"],"Juke S/Sv/Sl":[],"Kicks":["S","Sr","Sv"],"Kicks Play":["S","Sr","Sv"],"Leaf":["S","S Plus","Sl","Sl Plus","Sv","Sv Plus"],"Leaf Sv/Sl":[],"Maxima":["3.5S","Platinum","S","Sl","Sr","Sv"],"Micra":[],"Murano":["Crosscabriolet","Platinum","S","Sl","Sl Hev","Sv"],"Murano Crosscabriolet":[],"Murano S/Sl/Sv/Le":[],"Nv":["1500","1500 S","2500","2500 S","2500 Sv","3500","3500 S"],"Nv200":["2.5S","Taxi"],"Pathfinder":["Le","Platinum","Rock Creek","S","Sl","Sv","Sv Hybrid"],"Qashqai":["S","Sv"],"Quest":["S"],"Rogue":["Platinum","S","Sl","Sv","Sv Hybrid"],"Rogue Select":["S"],"Rogue Sport":["S","Sl","Sv"],"Sentra":["2.0","S","Se-R","Se-R Spec V","Sr","Sr Turbo","Sv"],"Titan":["Platinum Reserve","Pro-4X","S","Sv","Xe"],"Titan S/Sv/Pro-4X":[],"Titan S/Sv/Sl/Pro-4X":[],"Titan Sv":[],"Titan Xd":["S","Sl","Sv"],"Versa":["S","Sr","Sv"],"Versa Note":["S"],"Xterra":["Off Road","X"],"Z":["Nismo","Performance","Sport"]},"Polestar":{"2":[],"3":[],"4":[]},"Pontiac":{"G3":[],"G3 Wave":["Se"],"G5":["Gt","Se"],"G6":["Gt","Gxp"],"Solstice":["Gxp"],"Vibe":["Gt"]},"Porsche":{"911":["Carrera","Carrera 2","Carrera 2 Black","Carrera Gts","Carrera S","Gt2","Gt2 Rs","Gt3","Gt3 Rs","Gt3 Rs 4.0","Speedster","Sport Classic Ii","Targa","Targa 4 Gts","Targa 4S","Targa S","Turbo","Turbo Cabriolet","Turbo S"],"911 Gt2/Gt2 Rs":[],"911 Gt3/Gt3 Rs":[],"918":["Spyder"],"Boxster":["Base","Gts","S","S Black","Spyder","Spyder Rs"],"Cayenne":["Base","Coupe","E Hybrid Coupe","E-Hybrid","Gts","Gts Coupe","S","S Coupe","S Hybrid","Se Hybrid","Se Hybrid Coupe","Se Hybrid Platinum","Turbo","Turbo Coupe","Turbo E-Hybrid","Turbo E-Hybrid Coupe","Turbo Gt","Turbo Gt Coupe","Turbo S E Hybrid Coupe","Turbo S E-Hybrid"],"Cayman":["Base","Gt4","Gt4 Rs","Gts","R","S"],"Macan":["4","4S","Base","Gts","S","Turbo"],"Panamera":["2","4","4 E-Hybrid","4 E-Hybrid Executive","4 E-Hybrid Sport Turismo","4 Executive","4 Hybrid Executive","4 Sport Turismo","4 Sport Turismo E-Hybrid","4S","4S E-Hybrid","4S E-Hybrid Executive","4S E-Hybrid Sport Turismo","4S Executive","4S Sport Turismo","Base","Exclusive","Executive","Gts","Gts Sport Turismo","S","S Hybrid","Se Hybrid","Turbo","Turbo E-Hybrid","Turbo Executive","Turbo S","Turbo S E-Hybrid","Turbo S E-Hybrid Executive","Turbo S E-Hybrid Sport Turismo","Turbo S Executive","Turbo S Sport Turismo","Turbo Sport Turismo"],"Taycan":["4S","Cross Turismo","Cross Turismo 4","Cross Turismo 4S","Cross Turismo Turbo","Gts","Gts Sport Turismo","Turbo","Turbo Gt"]},"RAM":{"1500":["Big Horn/Lone Star","Hfe","Laramie","Limited","Longhorn","Mpg","Rebel","Rho","Slt","Sport","Ssv","St","Tradesman","Trx","Tungsten"],"1500 Classic":["Laramie","Slt","Ssv","Tradesman","Warlock"],"2500":["Big Horn","Big Horn/Lone Star","Laramie","Limited","Longhorn","Powerwagon","Slt","St","Tradesman"],"3500":["Big Horn","Big Horn/Lone Star","Laramie","Limited","Longhorn","Slt","St","Tradesman"],"4500":[],"5500":[],"Promaster 1500":["1500 High","1500 Standard"],"Promaster 2500":["2500 High","2500 Standard"],"Promaster 3500":["3500 High","3500 Standard","3500 Super High"],"Promaster City":["Slt","Tradesman","Tradesman Slt"],"Ram Truck 1500 Rebel":[],"Tradesman":[]},"Rivian":{"Edv":["500","700"],"R1S":["Adventure","Explorer","Launch Edition","Premium"],"R1T":["Adventure","Launch Edition","Premium"],"Rcv":["500","700"]},"Rolls-Royce":{"Cullinan":["Black Badge"],"Dawn":["Base"],"Ghost":["Base","Black Badge"],"Phantom":["Drophead Coupe"],"Spectre":["Black Badge"],"Wraith":[]},"Saab":{"9-3":["2.0T","Aero"],"9-4X":["Aero","Premium"],"9-5":["Aero","Turbo"]},"Saturn":{"Aura":["Hybrid","Xe","Xe Preferred","Xr","Xr Premium"],"Outlook":["Xe","Xr","Xv"],"Sky":["Preferred","Redline"],"Vue":["Hybrid","Xe","Xr"]},"Smart":{"Fortwo":["Cabriolet","Electric","Passion","Pure"]},"Subaru":{"Ascent":["Limited","Onyx Edition","Onyx Touring","Premium","Touring"],"Brz":["2.0 Limited","2.0 Premium","2.0 Ts","Limited","Premium","Ts"],"Crosstrek":["2.0I Hybrid","2.0I Hybrid Touring","Limited","Premium","Sport","Wilderness"],"Forester":["2.0Xt Premium","2.0Xt Touring","2.5I","2.5I Limited","2.5I Premium","2.5I Touring","2.5X","2.5X Limited","2.5X Premium","2.5Xt","2.5Xt Limited","Convenience","Limited","Premier","Premium","Sport","Touring","Wilderness","Xs"],"Forester 2.0Xt Premium":[],"Forester 2.0Xt Touring":[],"Forester 2.5I":[],"Forester 2.5I Limited":[],"Forester 2.5I Premium":[],"Forester 2.5I Touring":[],"Forester 2.5X":[],"Forester 2.5X Limited":[],"Forester 2.5X Premium":[],"Forester 2.5Xs":[],"Forester 2.5Xt":[],"Forester 2.5Xt Ltd":[],"Impreza":["2.5 Gt","2.5I","2.5I Premium","Base","Limited","Outback Sport","Premium","Premium Plus","Rs","Se","Sport","Sport Limited","Sport Premium","Sport Tech","Touring","Wrx","Wrx Limited","Wrx Sti"],"Impreza Limited Awd":[],"Impreza Premium Awd":[],"Impreza Premium Plus":[],"Impreza Sport":[],"Impreza Sport Limited Awd":[],"Legacy":["2.5Gt Limited","2.5Gt Premium","2.5I","2.5I Limited","2.5I Premium","2.5I Sport","3.6R","3.6R Limited","3.6R Premium","Gt","Limited","Limited Gt","Limited Xt","Premier Gt","Premiere","Premium","Sport","Touring","Touring Xt"],"Outback":["2.5I","2.5I Limited","2.5I Premium","3.6R","3.6R Limited","3.6R Premium","Convenience","Limited","Limited Xt","Onyx Edition","Onyx Edition Xt","Outdoor Xt","Premier","Premier Xt","Premium","Touring","Touring Ldl","Wilderness"],"Outback 2.5I":[],"Outback 2.5I Limited":[],"Outback 2.5I Premium":[],"Outback 3.6R":[],"Outback 3.6R Limited":[],"Outback 3.6R Premium":[],"Solterra":["Premium"],"Tribeca":["Limited","Premium"],"Wrx":["Gt","Limited","Premium","Rs","Sport Tech","Sti","Sti Launch Edition","Sti Limited","Sti S209","Tr","Ts"],"Xv Crosstrek":["2.0 Limited","2.0 Premium","2.0I Hybrid","2.0I Hybrid Touring","Sport Limited"],"Xv Crosstrek 2.0I Hy Tour":[],"Xv Crosstrek 2.0I Hybrid":[],"Xv Crosstrek 2.0I Limited":[],"Xv Crosstrek 2.0I Premium":[],"Xv Crosstrek Sport Limite":[]},"Suzuki":{"Equator":["Base","Rmz-4","Sport"],"Equator Rmz-4":[],"Equator Sport":[],"Equator/Sport":[],"Grand Vitara":["Jlx","Jlx-L","Jx","Limited","Premium","Se","Urban","Xsport"],"Grand Vitara Jlx/Ltd":[],"Grand Vitara X-Sport":[],"Kizashi":["Gts","S","Se","Sls","Sport","Sport Gts","Sport Sls","Sx"],"Swift":[],"Sx4":["Ja","Je","Jlx","Jx","Le","Sport","Technology","Touring"],"Xl7":["Jlx","Limited","Luxury","Premium"]},"Tesla":{"Cybertruck":[],"Model 3":[],"Model S":["60","70","70D","85","85D","90","90D","P85","P85D","P90D"],"Model X":[],"Model Y":[],"Roadster":[],"Semi":[]},"Toyota":{"4Runner":["40Th Anniversary Se","Limited","Night Shade","Se","Sr5","Sr5 Premium","Sr5/Sr5 Premium","Trail","Trd Sport","Venture"],"86":["Base","Gt"],"Avalon":["Base","Hybrid","Limited","Night Shade","Touring","Trd","Xl","Xle","Xse"],"Bz4X":["Xle"],"C-Hr":["Xle"],"Camry":["Base","Hybrid","L","Le","Night Shade","Se","Se Night Shade","Trd","Xle","Xse"],"Corolla":["Base","Eco","Fx","L","Le","Le Eco","N","Night Shade","Se","Xle","Xrs","Xse"],"Corolla Cross":["L","Le","Se","Xle"],"Corolla Im":[],"Corolla Matrix":["S","Xrs"],"Crown":["Platinum","Xle"],"Crown Signia":["Xle"],"Fj Cruiser":[],"Gr 86":["10Th Ann Special Edit","Hakone","Premium","Trueno Edition"],"Gr Corolla":["Circuit","Core"],"Grand Highlander":["Le","Limited","Xle"],"Highlander":["Base","Hybrid","Hybrid Bronze Edition","Hybrid Le","Hybrid Limited","Hybrid Platinum","Hybrid Xle","L","Le","Limited","Platinum","Se","Sport","Xle","Xse"],"Land Cruiser":["Base","Vx-R"],"Matrix":["Base","Xrs"],"Matrix S":[],"Matrix S Awd":[],"Matrix Xrs":[],"Mirai":["Le","Xle"],"Prius":["L","Le","Night Shade","Special Edition"],"Prius C":[],"Prius Plug-In":[],"Prius Prime":["Le","Se"],"Prius V":[],"Rav4":["Adventure","Le","Limited","Se","Sport","Trd Off Road","Woodland Edition","Xle","Xle Premium","Xse"],"Rav4 Ev":[],"Rav4 Hv":["Le","Limited","Se","Xle"],"Rav4 Ltd":[],"Rav4 Prime":["Se","Xse"],"Rav4 Sport":[],"Scion":["Xb"],"Scion Fr-S":[],"Scion Ia":[],"Scion Im":[],"Scion Iq":["Electric"],"Scion Tc":[],"Scion Xb":[],"Scion Xd":[],"Sequoia":["Limited","Night Shade","Platinum","Sr5","Trd Sport"],"Sienna":["Base","Ce","L","Le","Le/Xle","Limited","Se","Sport","Xle","Xse"],"Supra":["Base"],"Tacoma":["Access Cab","Double Cab","Double Cab Long Bed","Double Cab Prerunner","Double Cab Prerunner Long Bed","Prerunner","Prerunner Access Cab","X-Runner Access Cab","Xtracab"],"Tacoma Prerunner":[],"Tundra":["Crewmax 1794","Crewmax Capstone","Crewmax Limited","Crewmax Platinum","Crewmax Sr","Crewmax Sr5","Double Cab Limited","Double Cab Sr","Double Cab Sr/Sr5","Double Cab Sr5","Sr"],"Tundra Crewmax Limited":[],"Tundra Double Cab Limited":[],"Tundra Double Cab Sr5":[],"Venza":["Le","Xle"],"Yaris":["Base","L","Le","Se"],"Yaris Ia":[]},"Vinfast Trading And Production Llc":{"Vf 7":["Eco","Plus"],"Vf 8":["Eco","Plus"],"Vf 9":["Eco","Plus"]},"Volkswagen":{"Arteon":["Execline","Se","Se R-Line","Sel","Sel Premium","Sel Premium R-Line","Sel R-Line"],"Atlas":["Comfortline","Execline","Peak Edition Se","Peak Edition Sel","S","Se","Sel","Sel Premium","Sel Premium R-Line","Sel R-Line","Trendline"],"Atlas Cross Sport":["Comfortline","Execline","S","Se","Sel","Sel Premium","Sel Premium R-Line","Sel R-Line","Trendline"],"Beetle":["1.8T","Dune","R-Line","S","S/Se","Se","Tdi","Trendline","Turbo"],"Beetle Turbo":[],"Cc":["Base","Executive","Highline","Luxury","R-Line","Sport","Vr6","Vr6 4Motion","Wolfsburg"],"Cc Luxury":[],"Cc Sport/R-Line":[],"City Golf":[],"E-Golf":["Comfortline","Limited","Se","Sel Premium"],"Eos":["Highline","Komfort","Lux","Turbo"],"Eos Komfort":[],"Eos Lux":[],"Golf":["Base / S","Execline","R","S","S/Se","Tdi","Tdi S","Trendline"],"Golf Alltrack":["S"],"Golf R":["20Th Anniversary","Black Edition"],"Golf Sportwagen":["Execline","Highline","S","Sel","Tdi","Tdi S"],"Golf Tdi":[],"Gti":["40Th Anniversary","Autobahn","Performance","S","S/Se","Se","Sport"],"Id Buzz":["First Edition","Pro S","Pro S Plus"],"Id.4":["First Edition","Limited","Pro","Pro S","Pro S Plus","S","S Limited"],"Jetta":["2.0T","40Th Anniversary","Base","Comfortline","Execline","Gli","Gli Autobahn","Highline","Hybrid","Limited","S","Se","Sel","Sel Premium","Sport","Tdi","Trendline","Wolfsburg"],"Jetta Base/S":[],"Jetta Gli":[],"Jetta Hybrid":[],"Jetta S":[],"Jetta S/Se":[],"Jetta Se":[],"Jetta Sel":[],"Jetta Tdi":[],"New Beetle":[],"Passat":["2.0T","3.6L 4Motion","Execline","Execline W/ R-Line","Gt","Highline","Highline W/ R-Line","Komfort","Limited Edition","R-Line","S","Se","Se R-Line","Sel","Sel Premium","Wolfsburg","Wolfsburg Edition"],"Passat Cc":["Highline"],"Passat S":[],"Passat Se":[],"Passat Sel":[],"Routan":["S","Se","Sel","Sel Premium"],"Taos":["Comfortline","Highline","S","Se","Se Black","Se Iq Drive","Sel","Trendline"],"Tiguan":["Comfortline","Highline","S","Se","Se R-Line Black","Sel","Sel Premium","Sel Premium R-Line","Sel R-Line","Sel R-Line Black","Sport","Trendline","Wolfsburg"],"Tiguan Limited":[],"Touareg":["3.6L","Execline W/ R-Line","Executive","Highline W/ R-Line","Hybrid","Sport","Tdi","V6","V6 Tdi","Wolfsburg"]},"Volvo":{"9700":[],"C30":["2.4I","T5"],"C40":["P8 Recharge Core","P8 Recharge Plus","P8 Recharge Ultimate","Recharge Core","Recharge Plus","Recharge Ultimate"],"C70":["T5"],"Ec40":["Core","Plus","Ultra"],"Ex30":["Core","Plus","Ultra"],"Ex40":["Core","Plus","Ultra"],"Ex90":["Plus","Ultra"],"New Vnl":[],"S40":["2.4I","T5"],"S60":["B5 Inscription","B5 Momentum","B5 R-Design","Core","Dynamic","Inscription","Platinum","Plus","Polestar","Polestar Engineered","Premier","Premier+","R Design","T5","T5 Inscription","T5 Momentum","T5 R-Design","T6","T6 Inscription","T6 Momentum","T6 R-Design","T8 Inscription","T8 Polestar","T8 Polestar Engineered","T8 R-Design","T8 Recharge Inscription","T8 Recharge R-Design","T8 Recharge R-Design Expression","Ultimate","Ultra"],"S60 Cross Country":["T5"],"S60 Polestar":[],"S60 R-Design":[],"S80":["3.2","Platinum","Premier","Premier+","T6","V8"],"S80 3.2 Awd":[],"S80 T6":[],"S80 T6 Awd":[],"S90":["B6 Inscription","B6 Momentum","B6 R-Design","Plus","T5","T5 Inscription","T5 Momentum","T6","T6 Inscription","T6 Momentum","T6 Ocean Race","T6 R-Design","T8 Inscription","T8 Momentum","T8 Ocean Race","T8 Recharge Inscription","T8 Recharge R-Design","Ultimate","Ultra"],"V50":["2.4I","T5"],"V60":["Core","Platinum","Plus","Polestar","Polestar Engineered","Premier","Premier+","R Design","Recharge Plus","T5","T5 Dynamic","T5 Inscription","T5 Momentum","T5 Platinum","T5 Premier","T5 R-Design","T6","T6 Dynamic","T6 Inscription","T6 Momentum","T6 Platinum","T6 Premier","T6 R-Design","T6 R-Design Premier Plus","T8 Inscription","T8 Polestar Engineered","T8 Recharge Inscription","T8 Recharge R-Design","Ultimate"],"V60 Cross Country":["Core","Platinum","Plus","Premier","Premier+","R Design","T5 Momentum","Ultimate","Ultra"],"V60 Platnum":[],"V60 Polestar":[],"V60 Premier":[],"V60 Premier+":[],"V60 R-Design":[],"V70":["3.2"],"V90":["T5 Inscription","T5 R-Design","T6 Inscription","T6 Momentum","T6 R-Design"],"V90 Cross Country":["B6 Inscription","B6 Momentum","B6 R-Design","Ocean Race","Plus","T5 Inscription","T5 Momentum","T6","T6 Inscription","T6 Momentum","T6 Ocean Race","Ultimate","Ultra"],"Vah":[],"Vhd":[],"Vn":["Vnl","Vnm","Vnx"],"Vnr":[],"Vt":[],"Xc40":["Core","P8 Recharge Core","P8 Recharge Plus","P8 Recharge Ultimate","Plus","Recharge","Recharge Core","Recharge Plus","Recharge Ultimate","T4 Inscription","T4 Momentum","T4 R-Design","T5 Inscription","T5 Momentum","T5 R-Design","Ultimate","Ultra"],"Xc60":["3.2","3.2 Platinum","3.2 Premier","3.2 Premier +","B5 Inscription","B5 Momentum","B5 R-Design","B6 Inscription","B6 Momentum","B6 R-Design","Core","Plus","Polestar Engineered","T5","T5 Dynamic","T5 Inscription","T5 Momentum","T5 Platinum","T5 Premier","T5 Premier+","T5 R-Design","T6","T6 Dynamic","T6 Inscription","T6 Momentum","T6 Platinum","T6 Premier","T6 Premier+","T6 R-Design","T6 R-Design Platinum","T6 R-Design Premier","T6 R-Design Premier Plus","T8","T8 Inscription","T8 Momentum","T8 Polestar Engineered","T8 R-Design","T8 Recharge Inscription","T8 Recharge Inscription Express","T8 Recharge R-Design","Ultimate","Ultra"],"Xc70":["3.2","3.2 Platinum","3.2 Premier","3.2 Premier +","T5","T5 Classic Platinum","T5 Classic Premier","T5 Platinum","T5 Premier","T5 Premier+","T6","T6 Platinum","T6 Premier","T6 Premier+"],"Xc90":["3.2","Core","Plus","R Design","T5","T5 Inscription","T5 Momentum","T5 Ocean Race","T5 R-Design","T6","T6 Inscription","T6 Momentum","T6 Ocean Race","T6 R-Design","T8","T8 Excellence","T8 Inscription","T8 Momentum","T8 R-Design","T8 Recharge","T8 Recharge Inscription","T8 Recharge Inscription Express","T8 Recharge Momentum","T8 Recharge R-Design","T8 Uber Edition","Ultimate","Ultra","V8"]}}`;
const YMMT_DATA = JSON.parse(YMMT_RAW);
const YMMT_MAKES = Object.keys(YMMT_DATA).sort();

// Inlined lender subset, derived from the FDIC/NCUA dedupe list plus captive auto financials.
// Will be replaced with the live Blinker lender API in production.
const LENDERS_RAW = `["1NB Bank","1ST ED CREDIT UNION","1st Security Bank of Washington","Academy Bank, National Association","ACB Bank","ACBA FED CREDIT UNION (3226)","ACHIEVA CREDIT UNION","Affinity Bank, National Association","Alliance Bank Central Texas","Alliant Credit Union","Ally Bank","Ally Financial","Altoona First Savings Bank","AMERICA'S CREDIT UNION, A","American Bank of Commerce","American Community Bank of Indiana","American Heritage National Bank","American Plus Bank, N.A.","AmeriFirst Bank","Ameriprise Bank, FSB","Anchor State Bank","ANDREWS FEDERAL CREDIT UNION","Anstaff Bank","Arlington State Bank","Arundel Federal Savings Bank","Associated Bank, National Association","ASSOCIATED CREDIT UNION","ASSOCIATED CREDIT UNION OF TEXAS","AuburnBank","Audi Financial Services","AUGUSTA HEALTH CARE CREDIT UNION","Axiom Bank, National Association","Bank 7","Bank Michigan","Bank of Abbeville & Trust Company","Bank of America, National Association","Bank of Bearden","Bank of Brookfield - Purdin, National Association","Bank of Central Florida","Bank of Coushatta","Bank of Dixon County","Bank of Eufaula","Bank of Greeley","Bank of Hazelton","Bank of Iberia","Bank of Lincoln County","Bank of Mauston","Bank of New Hampshire","Bank of Perry County","Bank of South Texas","Bank of Texas","Bank of the Pacific","Bank of Weston","Bank of York","Bank47","BankNewport","BankUnited, National Association","Bankwell Bank","Barwick Banking Company","BayFirst National Bank","BEACON CREDIT UNION, INCORPORATED","Bedford Loan & Deposit Bank","BELCO COMMUNITY CREDIT UNION","Benchmark Community Bank","BHM Bank","Black Mountain Savings Bank, SSB","Blue Ridge Bank,  National Association","BMO Bank N.A.","BMW Financial Services","Boeing Employees Credit Union (BECU)","Bonduel State Bank","Bravera Bank","Bridgecrest","Bristol County Savings Bank","BTG Pactual Bank, National Association","Buckeye State Bank","Butte State Bank","Cache Valley Bank","Cambridge Savings Bank","Capital Bank, National Association","Capital One Auto Finance","Capital One, National Association","CARDINAL CREDIT UNION, INC.","CarMax Auto Finance","Carolina Bank & Trust Co.","Carvana","Casey State Bank","Cattlemens Bank","CCB Community Bank","Centennial Bank","Central Bank of Kansas City","CENTRAL CREDIT UNION OF ILLINOIS","CENTRAL CREDIT UNION OF MARYLAND,IN","Century Bank and Trust","Chambers State Bank","Chase Auto","Chelsea Groton Bank","Chino Commercial Bank, N.A.","Citibank, N.A.","Citizens Bank & Trust","Citizens Bank and Trust Company of Grainger County","Citizens Bank of Kentucky, Inc.","Citizens Bank, National Association","Citizens Community Bank","Citizens National Bank of Cheboygan","Citizens State Bank and Trust Company","Citizens Tri-County Bank","City National Bank","Clarkson Bank","Cleo State Bank","CNB Bank, Inc.","CO-OP CREDIT UNION OF MONTEVIDEO","Coffee County Bank","Columbus State Bank","Commercial Bank","Commercial National Bank of Texarkana","Community Bank","Community Bank of Easton","Community Bank of Oelwein","Community Bankers' Bank","COMMUNITY CREDIT UNION OF FLORIDA","COMMUNITY CREDIT UNION OF LYNN","Community First Banking Company","COMMUNITY FIRST CREDIT UNION OF FLO","COMMUNITY ONE CREDIT UNION OF OHIO","Community Resource Bank","COMMUNITY SPIRIT CREDIT UNION","Community Unity Bank","CONNECT CREDIT UNION","ConnectOne Bank","Copiah Bank","Cornerstone State Bank","County Bank","CRAYOLA LLC EMPLOYEES CREDIT UNION","Credit Acceptance","Credit One Bank, National Association","CREDIT UNION 1","CREDIT UNION FOR ROBERTSON COUNTY","CREDIT UNION OF AMERICA","CREDIT UNION OF ATLANTA","CREDIT UNION OF COLORADO, A","CREDIT UNION OF DENVER","CREDIT UNION OF DODGE CITY","CREDIT UNION OF EMPORIA","CREDIT UNION OF GEORGIA","CREDIT UNION OF NEW JERSEY, A","CREDIT UNION OF OHIO","CREDIT UNION OF RICHMOND INCORPORAT","CREDIT UNION OF SOUTHERN CALIFORNIA","CREDIT UNION OF TEXAS","CREDIT UNION OF THE ROCKIES","CREDIT UNION OF VERMONT","CREDIT UNION ONE","CREDIT UNION ONE OF OKLAHOMA","CREDIT UNION WEST","Crowell State Bank","Custer Federal State Bank","Defiance State Bank","DeMotte State Bank","DESTINATIONS CREDIT UNION","Dewey Bank","Discover Bank","DOMINION ENERGY CREDIT UNION","Drake Bank","DriveTime","DSRM National Bank","Eagle Bank and Trust Company","Eastbank, National Association","Edmonton State Bank","EDUCATION FIRST CREDIT UNION, INC.","Embassy Bank for the Lehigh Valley","Enterprise Bank of South Carolina","EvaBank","Exchange Bank & Trust","Exeter Finance","F & M Community Bank, National Association","Fairfield County Bank","Farmers & Merchants Bank & Trust","Farmers & Traders Bank of Campton","Farmers and Mechanics Federal Savings Bank","Farmers and Merchants State Bank of Alpha","Farmers Savings Bank","Farmers State Bank of Hoffman","Fayette Savings Bank, SSB","Field & Main Bank","Fifth Third Bank, National Association","First & Peoples Bank and Trust Company","First Bank & Trust Company","First Bank and Trust of Fullerton","First Bank of Pike","First Carolina Bank","First Citizens Bank of Butte","First Community Bank","First Credit Bank","First Farmers & Merchants National Bank","First Federal Bank of Kansas City","First Federal Savings Bank of Angola","First Financial Bank in Winnebago","First Horizon Bank","First Kentucky Bank, Inc.","First Montana Bank, Inc.","First National Bank in DeRidder","First National Bank in Taylorville","First National Bank North","First National Bank of Decatur County","First National Bank of Kansas","FIRST NATIONAL BANK OF KENTUCKY","First National Bank of Pulaski","First National Bank, Cortez","First New Mexico Bank of Silver City","First Pacific Bank","First Resource Bank","First Security Bank - Canby","First Service Bank","First State Bank Nebraska","First State Bank of Ben Wheeler, Texas","First State Bank of Forrest","First State Bank of Odem","First State Bank of Swanville","First Texas National Bank","First United National Bank","First-Citizens Bank & Trust Company","Five Points Bank","Flatwater Bank","FNB Picayune Bank","Focus Bank","Ford Motor Credit","Fortuna Bank","Frandsen Bank & Trust","Freedom Bank of Southern Missouri","Frontier Bank of Texas","Garfield County Bank","Genesis Bank","Gilmer National Bank, Gilmer, Texas","Global Lending Services","GM Financial","GN Bank","Gold Coast Bank","Goppert State Service Bank","Grand Savings Bank","Great Midwest Bank, S.S.B.","Greater State Bank","Greenfield Savings Bank","Guaranty Bank & Trust Company of Delhi, Louisiana","Gulf Coast Bank and Trust Company","Haddon Savings Bank","HAMPTON ROADS EDUC CREDIT UNION INC","Harford Bank","Haverhill Bank","HEALTHCARE FIRST CREDIT UNION","Helm Bank USA","Heritage Bank of Schaumburg","Hiawatha National Bank","Hills Bank and Trust Company","Home Banking Company","Home State Bank, National Association","Homestead Bank","Honda Financial Services","Hoosier Heartland State Bank","Huntington Federal Savings Bank","Huntington National Bank","Hyundai Motor Finance","IMPACT CREDIT UNION, INC.","IncredibleBank","Infinity Bank","Interamerican Bank, A FSB","Investar Bank, National Association","Iowa State Savings Bank","Israel Discount Bank of New York","ITS Bank","Jackson Parish Bank","JEFFERSON CREDIT UNION","John Marshall Bank","JPMorgan Chase Bank, National Association","Junction National Bank","Kendall Bank","KeyBank National Association","Kia Motors Finance","Kleberg  Bank, N.A.","Lake Central Bank","Lakeside Bank","Latimer State Bank","LAUNCH CREDIT UNION","LEADERS CREDIT UNION","Legacy Bank","LendingClub Bank, National Association","Liberty Bank, Inc.","Lincoln Savings Bank","Locality Bank","Longview Bank","LOUDOUN CREDIT UNION","Lusitania Savings Bank","M&T Bank","MACON-BIBB EMPLOYEES CREDIT UNION","Magnolia Bank, Incorporated","Malaga Bank F.S.B.","Marblehead Bank","Marseilles Bank","Maynard Savings Bank","Mazda Financial Services","Mechanics & Farmers Bank","MEMBERS FIRST CREDIT UNION OF FLORI","MEMBERS FIRST CREDIT UNION OF N.H.","Mercedes-Benz Financial Services","Mercer Savings Bank","Merchants State Bank","Method Bank","Miami Savings Bank","MidSouth Bank","Midwest BankCentre","Millennial Bank","Minster Bank","MOBILITY CREDIT UNION","Monson Savings Bank","Morgantown Bank & Trust Company, Incorporated","MountainOne Bank","MRV Banks","MUNICIPAL EMPL.CREDIT UNION OF BALT","MutualOne Bank","Nave Bank","NAVY FEDERAL CREDIT UNION","Navy Federal Credit Union","Nekoosa Port Edwards State Bank","New Horizon Bank, National Association","NEW SOUTH CREDIT UNION","NewFirst National Bank","NEWPORT NEWS MUN. EMP CREDIT UNION","Nissan Motor Acceptance","Normangee State Bank","North Easton Savings Bank","Northeast Bank","NORTHERN STAR CREDIT UNION, INC.","Northfield Bank","Northwestern Bank, National Association","NSB Bank","Oak View National Bank","Ohnward Bank & Trust","Old Second National Bank","ONE CREDIT UNION OF NY","Oostburg State Bank","Origin Bank","OUCU FINANCIAL CREDIT UNION, INC.","Pacific Alliance Bank","PAINESVILLE CREDIT UNION","PALCO FCU","Panhandle First Bank","Parkside Financial Bank & Trust","Patriot Bank","PB&T Bank","Pegasus Bank","PenFed Credit Union","PeopleFirst Bank","Peoples Bank of Deer Lodge","Peoples Bank, Mt. Washington","Peoples Savings Bank of Rhineland","Peoples State Bank, Fairmount, N. D.","PFD FIREFIGHTERS CREDIT UNION INC.","Phenix-Girard Bank","PIEDMONT ADVANTAGE CREDIT UNION","Pilot Grove Savings Bank","Pioneer Bank, National Association","Planters First Bank","PNC Bank, National Association","POLICE CREDIT UNION OF CONNECTICUT","Ponce Bank, National Association","Prairie State Bank and Trust","Prescott State Bank","Primebank","PRIORITYONE CREDIT UNION OF FLORIDA","Produce State Bank","Providence Bank","Quad City Bank and Trust Company","Raymond James Bank","Regent Bank","Regions Bank","Republic Bank & Trust Company","RG Bank, A Savings and Loan Association","Rio Bank","RIO GRANDE VALLEY CREDIT UNION","Riverland Bank","Robertson Banking Company","Root River State Bank","S&T Bank","Sanborn Savings Bank","Santander Consumer USA","SANTEE COOPER CREDIT UNION","Savings Bank of Mendocino County","SchoolsFirst Federal Credit Union","Scribner Bank","Security Bank and Trust Co.","Security Federal Savings Bank","Security State Bank","Security State Bank of Warroad","Shamrock Bank, N.A.","Shoreham Bank","Simmesport State Bank","SoFi Bank, National Association","Sooner State Bank","South Lafourche Bank & Trust Company","Southern Hills Community Bank","SouthTrust Bank, N.A.","Southwest Heritage Bank","SpiritBank","Spur Security Bank","Stafford Savings Bank","State Bank Financial","State Bank of Cold Spring","State Bank of Industry","State Bank of Schaller","State Bank of the Lakes, National Association","State Employees Credit Union","STATE POLICE CREDIT UNION INC.","Stellantis Financial Services","Sterling Federal Bank, F.S.B.","Stone Bank","Sturdy Savings Bank","Subaru Motors Finance","SULLIVAN BANK","Suncoast Credit Union","Sundown State Bank","SUPERIOR CREDIT UNION","SUPERIOR CREDIT UNION, INC","Superior Savings Bank","Synchrony Bank","TARRANT COUNTY'S CREDIT UNION","Taylorsville Savings Bank, SSB","TBK BANK, SSB","TD Bank, N.A.","TELCO COMMUNITY CREDIT UNION","Tesla Financing","Texas Bank","Texas Heritage National Bank","Thayer County Bank","The Baltic State Bank","The Bank of Brodhead","The Bank of Fayette County","The Bank of LaFayette, Georgia","The Bank of New York Mellon Trust Company, National Association","The Bank of Tampa","The Bendena State Bank","The Callaway Bank","The Citizens Bank","The Citizens Bank of Weston","The Citizens National Bank of Park Rapids","The Citizens-Farmers Bank of Cole Camp","The Clay City Banking Co.","The Community Bank","THE CREDIT UNION FOR ALL","The Dart Bank","The Equitable Bank, S.S.B.","The Fairmount State Bank","The Farmers Bank, Frankfort, Indiana","The Farmers State Bank of Bucklin, Kansas","The Fayette County National Bank of Fayetteville","The First Bank of Okarche","The First National Bank at St. James","The First National Bank of Absecon","The First National Bank of Ballinger","The First National Bank of Cokato","The First National Bank of Evant","The First National Bank of Granbury","The First National Bank of Hutchinson","The First National Bank of Louisburg","The First National Bank of Monterey","The First National Bank of Pandora","The First National Bank of Sonora","The First National Bank of Wakefield","The First State Bank of Malta","The Four County Bank","The Granger National Bank","The Harvard State Bank","The Hopeton State Bank","The Juniata Valley Bank","The Libertyville Savings Bank","The Malvern National Bank","The Miners National Bank of Eveleth","The National Bank of Andrews","The Neffs National Bank","The Old Fort Banking Company","The Peoples Bank","The Perryton National Bank","The Port Washington State Bank","The Samson Banking Company, Inc.","The Sherwood State Bank","The State Bank of Geneva","The Stock Exchange Bank, Caldwell, Kansas","The Union Bank","The Wanda State Bank","Third Coast Bank","Time Bank","Tower Community Bank","Toyota Financial Services","TPNB Bank","Traditional Bank, Inc.","Tri-County Bank","Trinity Bank, N.A.","Truist Bank","TrustBank","TVA COMMUNITY CREDIT UNION","Twin River Bank","U.S. Bank National Association","Union Bank & Trust Company","United Bank & Trust","United Citizens Bank & Trust Company","United Mississippi Bank","United Southern Bank","University Bank","US Metro Bank","USAA Federal Savings Bank","USF FEDERAL CREDIT UNION","Valley Bank of Commerce","ValueBank Texas","Vermilion Bank & Trust Company","VERVE, A CREDIT UNION","VIA CREDIT UNION","Village Bank","VIRGINIA EDUCATORS CREDIT UNION","Volkswagen Credit","Vroom","Walpole Co-operative Bank","Washita State Bank","Waukon State Bank","WCU CREDIT UNION","Webster Five Cents Savings Bank","Wells Fargo Auto","Wells Fargo Bank, National Association","WesBanco Bank, Inc.","West Plains Bank","West View Savings Bank","Western Nebraska Bank","Westlake Financial","WHITEFISH CREDIT UNION ASSOCIATION","Williamstown Bank, Inc.","Wintrust Bank, National Association","Woodsboro Bank","WOODTRUST BANK","WRIGHT-PATT CREDIT UNION, INC.","Yoakum Bank","YOUR BEST CREDIT UNION"]`;
const LENDERS = JSON.parse(LENDERS_RAW);

// Vehicle prefill presets — used by the dev tools to skip the manual vehicle entry flow.
const PREFILL_PRESETS = [
  {
    label: "Jamie Rivera · Jeep Wrangler",
    payload: {
      applicant: { firstName: "Jamie", lastName: "Rivera", phone: "5555550142", email: "jamie.rivera@example.com" },
      vehicle: { year: 2025, make: "Jeep", model: "Wrangler", trim: "Rubicon", mileage: 14000, condition: "Used" },
    },
  },
  {
    label: "Sanders couple · Camry (w/ co-app)",
    payload: {
      applicant: { firstName: "Tom", lastName: "Sanders", phone: "5555550187", email: "tom.sanders@example.com" },
      coApplicant: { firstName: "Jill", lastName: "Sanders", phone: "5555550188", email: "jill.sanders@example.com", relationship: "Spouse" },
      vehicle: { year: 2023, make: "Toyota", model: "Camry", trim: "Se", mileage: 32000, condition: "Used" },
    },
  },
  {
    label: "Alex Chen · Tesla (new, VIN)",
    payload: {
      applicant: { firstName: "Alex", lastName: "Chen", phone: "5555550199", email: "alex.chen@example.com" },
      vehicle: { vin: "5YJ3E1EA7KF317000", year: 2026, make: "Tesla", model: "Model 3", trim: "", mileage: 100, condition: "New" },
    },
  },
  {
    label: "Morgan Lee · Ford F-150",
    payload: {
      applicant: { firstName: "Morgan", lastName: "Lee", phone: "5555550170", email: "morgan.lee@example.com" },
      vehicle: { year: 2022, make: "Ford", model: "F-150", trim: "Xlt", mileage: 48000, condition: "Used" },
    },
  },
];
// Legacy alias so existing references keep working.
const VEHICLE_PRESETS = PREFILL_PRESETS;

// ---------- Validators ----------

// Filters user input to numeric-only (with optional decimal).
function sanitizeNumeric(v, { decimal = true } = {}) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  s = decimal ? s.replace(/[^0-9.]/g, "") : s.replace(/[^0-9]/g, "");
  if (decimal) {
    const firstDot = s.indexOf(".");
    if (firstDot !== -1) {
      s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
    }
  }
  return s;
}

// Parses a flexible date string. Accepts digits only (no separator required)
// in formats like MMDDYYYY, MDYYYY, MDDYYYY, MMDDYY, MDYY, as well as slashed
// forms like M/D/YY or MM/DD/YYYY. Returns { month, day, year, date } or null.
function parseFlexDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  let mm, dd, yy;
  if (s.includes("/") || s.includes("-") || s.includes(".")) {
    // eslint-disable-next-line no-useless-escape
    const parts = s.split(/[/.\-]/);
    if (parts.length !== 3) return null;
    [mm, dd, yy] = parts;
    if (!/^\d+$/.test(mm) || !/^\d+$/.test(dd) || !/^\d+$/.test(yy)) return null;
  } else {
    if (!/^\d+$/.test(s)) return null;
    if (s.length === 8) {
      // MMDDYYYY
      mm = s.slice(0, 2); dd = s.slice(2, 4); yy = s.slice(4);
    } else if (s.length === 7) {
      // Assume MDDYYYY (single-digit month, 2-digit day, 4-digit year)
      mm = s.slice(0, 1); dd = s.slice(1, 3); yy = s.slice(3);
    } else if (s.length === 6) {
      // MDYYYY (single-digit month, single-digit day, 4-digit year)
      mm = s.slice(0, 1); dd = s.slice(1, 2); yy = s.slice(2);
    } else if (s.length === 5) {
      // MDDYY or MMDYY — assume MDDYY (single-digit month, 2-digit day, 2-digit year)
      mm = s.slice(0, 1); dd = s.slice(1, 3); yy = s.slice(3);
    } else if (s.length === 4) {
      // MDYY
      mm = s.slice(0, 1); dd = s.slice(1, 2); yy = s.slice(2);
    } else {
      return null;
    }
  }
  const month = parseInt(mm, 10);
  const day = parseInt(dd, 10);
  let year = parseInt(yy, 10);
  if (isNaN(month) || isNaN(day) || isNaN(year)) return null;
  if (yy.length === 2) year = year > 50 ? 1900 + year : 2000 + year;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (year < 1900 || year > 2100) return null;
  const d = new Date(year, month - 1, day);
  if (d.getMonth() + 1 !== month || d.getDate() !== day) return null;
  return { month, day, year, date: d };
}

const validators = {
  required: (v) => (v === null || v === undefined || String(v).trim() === "") ? "Required" : null,
  email: (v) => {
    if (!v) return null;
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? null : "Enter a valid email address";
  },
  usPhone: (v) => {
    if (!v) return null;
    const digits = String(v).replace(/\D/g, "");
    return digits.length === 10 ? null : "Enter a 10-digit US phone number";
  },
  ssn: (v) => {
    if (!v) return null;
    const digits = String(v).replace(/\D/g, "");
    return digits.length === 9 ? null : "SSN must be 9 digits";
  },
  zip: (v) => {
    if (!v) return null;
    return /^\d{5}(-\d{4})?$/.test(v.trim()) ? null : "Enter a 5-digit ZIP code";
  },
  state2: (v) => {
    if (!v) return null;
    return /^[A-Za-z]{2}$/.test(v.trim()) ? null : "Use the 2-letter state abbreviation";
  },
  vin: (v) => {
    if (!v) return null;
    const upper = v.trim().toUpperCase();
    if (upper.length !== 17) return "VIN must be exactly 17 characters";
    if (/[IOQ]/.test(upper)) return "VIN cannot contain I, O, or Q";
    if (!/^[A-HJ-NPR-Z0-9]+$/.test(upper)) return "VIN can only contain letters and digits";
    return null;
  },
  flexDate: (v) => {
    if (!v) return null;
    return parseFlexDate(v) ? null : "Enter a valid date";
  },
  flexDateInPast: (v) => {
    if (!v) return null;
    const parsed = parseFlexDate(v);
    if (!parsed) return "Enter a valid date";
    if (parsed.date > new Date()) return "Date must be in the past";
    return null;
  },
  positiveCurrency: (v) => {
    if (v === "" || v === null || v === undefined) return null;
    const s = String(v);
    if (!/^\d*\.?\d*$/.test(s)) return "Enter a number";
    const n = Number(s);
    if (Number.isNaN(n)) return "Enter a number";
    if (n <= 0) return "Must be greater than 0";
    return null;
  },
  positiveInt: (v) => {
    if (v === "" || v === null || v === undefined) return null;
    const s = String(v);
    if (!/^\d+$/.test(s)) return "Enter a whole number";
    const n = Number(s);
    if (Number.isNaN(n) || n <= 0) return "Must be greater than 0";
    return null;
  },
};

function parseDob(str) {
  const parsed = parseFlexDate(str);
  return parsed ? parsed.date : null;
}

function ageYears(dobStr) {
  const dob = parseDob(dobStr);
  if (!dob || isNaN(dob)) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const md = today.getMonth() - dob.getMonth();
  if (md < 0 || (md === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

function dobAdult(v) {
  const fmt = validators.flexDateInPast(v);
  if (fmt) return fmt;
  const age = ageYears(v);
  if (age === null) return "Enter a valid date";
  if (age < 18) return "Applicant must be 18 or older";
  if (age > 110) return "Enter a valid date of birth";
  return null;
}

// Phone formatter: given any string, keep up to 10 digits and render
// as (###) ###-####. Returns both the digits and display form.
function formatPhoneDisplay(digits) {
  const d = String(digits || "").replace(/\D/g, "").slice(0, 10);
  if (d.length === 0) return "";
  if (d.length < 4) return "(" + d;
  if (d.length < 7) return "(" + d.slice(0, 3) + ") " + d.slice(3);
  return "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6);
}

// ---------- Sequence ----------

const SCREEN_LABELS = {
  embedded_entry: "Embedded quote card",
  vehicle_add: "V1 Add vehicle",
  vehicle_drive: "V2 How much do you drive?",
  s1_ownership: "S1.1 Ownership",
  s1_auto_loan: "S1.2 Auto loan",
  s1_credit: "S1.3 Self-reported credit",
  s1_co_app_decision: "Co-applicant?",
  s1_co_app_contact: "Co-app contact",
  s1_co_app_employment: "Co-app employment",
  s1_applicant: "S1.4 Applicant",
  s1_housing: "S1.5 Housing",
  s1_employment: "S1.6 Employment",
  s1_identity_consent: "S1.7 Identity & consent",
  decision_engine: "Decision engine",
  stage2_result: "Stage 2 result",
};

const STAGE1_TERMINUS = "s1_identity_consent";

// ---------- Main component ----------

export default function RefinanceV2Prototype() {
  const [screen, setScreen] = useState("embedded_entry");
  const [embeddedState, setEmbeddedState] = useState("pre"); // pre | post
  const [panelOpen, setPanelOpen] = useState(true);
  const [showDisclosureModal, setShowDisclosureModal] = useState(false);
  const [selectedOfferId, setSelectedOfferId] = useState(null);
  const [offerConfirmed, setOfferConfirmed] = useState(false);

  const [dev, setDev] = useState({
    forcePartner: "auto",
    forceResult: "auto",
    disqualReason: "credit_out_of_range",
    includeSsn: true,
    coAppOverride: "auto",
    showJson: false,
    prefillJson: JSON.stringify(PREFILL_PRESETS[0].payload, null, 2),
    orgConfig: DEFAULT_ORG_CONFIG,
    orgConfigJson: JSON.stringify(DEFAULT_ORG_CONFIG, null, 2),
    orgConfigError: null,
  });

  const [form, setForm] = useState(emptyForm());

  function emptyForm() {
    return {
      // vehicle
      // protection plan
      planSold: true, // default: plan already sold — set to false to show coverage teaser
      selectedPlanId: null,
      smsSent: false,
      // insurance
      insuranceReviewed: true, // default: insurance already reviewed — set to false to show insurance teaser
      insuranceSavingsFound: false, // true when savings were found after review
      insuranceMonthlySavings: 0, // $/mo savings found
      insuranceSmsSent: false,
      // vehicle
      vin: "",
      vinDecoded: false, vinDecodeLoading: false, vinDecodeError: null,
      year: null, make: "", model: "", trim: "",
      extraMakes: [], extraModels: [], extraTrims: [],
      mileage: 14000,
      condition: "Used",
      purchaseDate: null,
      // applicant primary
      firstName: "", lastName: "", phone: "", email: "",
      // current loan
      ownership: null,
      lender: "", monthlyPayment: "", payoff: "",
      // credit
      creditBand: null,
      // co-applicant
      hasCoApplicant: null,
      coAppFirst: "", coAppLast: "", coAppPhone: "", coAppEmail: "",
      coAppRelationship: "", coAppRelationshipOther: "",
      coAppDob: "", coAppSsn: "",
      coAppEmployer: "", coAppEmploymentType: "", coAppIncome: "",
      coAppConsent: false,
      // housing
      address: "", city: "", state: "", zip: "",
      ownRent: null, moveInDate: "", housingPayment: "",
      // employment
      employer: "", employmentType: "", income: "", startDate: "",
      // identity + consent
      dob: "", ssn: "",
      consentConfirmed: false,
      // vehicle valuation (populated by MarketCheck API)
      valuationMarketCheckPrice: null,
      valuationRetailPrice: null,
      valuationLoading: false,
      valuationError: null,
      // agent-side notes + tags (required by RefiForm)
      notes: "",
      tags: [],
      tagsCreated: [],
    };
  }

  const update = (patch) => setForm((f) => ({ ...f, ...patch }));

  const effectiveHasCoApp = dev.coAppOverride === "auto"
    ? form.hasCoApplicant === true
    : dev.coAppOverride === "yes";

  const sequence = useMemo(() => getSequence(form, effectiveHasCoApp), [form.creditBand, effectiveHasCoApp]);

  const stage1Sequence = sequence.slice(0, sequence.indexOf(STAGE1_TERMINUS) + 1);
  const currentStageIndex = stage1Sequence.indexOf(screen);
  const stageOneProgress = currentStageIndex >= 0
    ? Math.round(((currentStageIndex + 1) / stage1Sequence.length) * 100)
    : 0;

  function next() {
    const idx = sequence.indexOf(screen);
    if (idx === -1) {
      setScreen("vehicle_add");
      return;
    }
    if (idx + 1 < sequence.length) setScreen(sequence[idx + 1]);
  }

  function back() {
    const idx = sequence.indexOf(screen);
    if (idx <= 0) {
      setScreen("embedded_entry");
      return;
    }
    setScreen(sequence[idx - 1]);
  }

  function goTo(s) { setScreen(s); }

  function applyPrefill(payload) {
    if (!payload || typeof payload !== "object") return;
    // Normalize: allow a flat "vehicle-only" payload (legacy) OR a wrapped
    // payload with { vehicle, applicant, coApplicant }.
    const isWrapped = payload.vehicle || payload.applicant || payload.coApplicant;
    const vehicle = isWrapped ? (payload.vehicle || {}) : payload;
    const applicant = isWrapped ? (payload.applicant || {}) : {};
    const coApplicant = isWrapped ? (payload.coApplicant || {}) : {};

    const patch = {};

    if (vehicle && Object.keys(vehicle).length) {
      if ("vin" in vehicle) patch.vin = String(vehicle.vin || "").toUpperCase();
      if ("year" in vehicle) patch.year = vehicle.year || null;
      if ("make" in vehicle) patch.make = vehicle.make || "";
      if ("model" in vehicle) patch.model = vehicle.model || "";
      if ("trim" in vehicle) patch.trim = vehicle.trim || "";
      if ("mileage" in vehicle) patch.mileage = vehicle.mileage || 0;
      if ("condition" in vehicle) patch.condition = vehicle.condition || "Used";
    }

    if (applicant && Object.keys(applicant).length) {
      if ("firstName" in applicant) patch.firstName = applicant.firstName || "";
      if ("lastName" in applicant) patch.lastName = applicant.lastName || "";
      if ("phone" in applicant) patch.phone = String(applicant.phone || "").replace(/\D/g, "").slice(0, 10);
      if ("email" in applicant) patch.email = applicant.email || "";
    }

    if (coApplicant && Object.keys(coApplicant).length) {
      if ("firstName" in coApplicant) patch.coAppFirst = coApplicant.firstName || "";
      if ("lastName" in coApplicant) patch.coAppLast = coApplicant.lastName || "";
      if ("phone" in coApplicant) patch.coAppPhone = String(coApplicant.phone || "").replace(/\D/g, "").slice(0, 10);
      if ("email" in coApplicant) patch.coAppEmail = coApplicant.email || "";
      if ("relationship" in coApplicant) {
        const rel = coApplicant.relationship || "";
        if (RELATIONSHIP_OPTIONS.includes(rel)) {
          patch.coAppRelationship = rel;
          patch.coAppRelationshipOther = "";
        } else if (rel) {
          patch.coAppRelationship = "Other";
          patch.coAppRelationshipOther = rel;
        }
      }
    }

    update(patch);
  }

  // Backwards-compat alias — older dev-panel code calls applyVehiclePrefill.
  const applyVehiclePrefill = applyPrefill;

  // ---------- Decision engine (simulated) ----------

  function runDecision() {
    const log = [];
    const cfg = dev.orgConfig || DEFAULT_ORG_CONFIG;
    let partner = dev.forcePartner;
    let result = dev.forceResult;
    let reason = null;
    let ruleId = null;

    if (partner === "auto" && result === "auto") {
      const age = ageYears(form.dob);
      const ageOk = age === null || age >= 18;
      log.push({ step: "Check applicant age", ok: ageOk, detail: age !== null ? `${age} years old` : "DOB not entered yet" });
      if (!ageOk) {
        partner = "none"; result = "disqualified"; reason = "under_18";
      }

      // --- Org-configured disqualification rules ---

      if (partner === "auto" && form.year) {
        const vehicleAge = new Date().getFullYear() - Number(form.year);
        const vehicleAgeOk = vehicleAge <= cfg.maxVehicleAgeYears;
        log.push({
          step: "Check vehicle age",
          ok: vehicleAgeOk,
          detail: `${vehicleAge} years old · max ${cfg.maxVehicleAgeYears}`,
        });
        if (!vehicleAgeOk) {
          partner = "none"; result = "disqualified"; reason = "vehicle_too_old";
        }
      }

      if (partner === "auto" && form.mileage !== "" && form.mileage !== null && form.mileage !== undefined) {
        const mileageNum = Number(form.mileage);
        const mileageOk = mileageNum <= cfg.maxMileage;
        log.push({
          step: "Check odometer",
          ok: mileageOk,
          detail: `${mileageNum.toLocaleString()} mi · max ${cfg.maxMileage.toLocaleString()}`,
        });
        if (!mileageOk) {
          partner = "none"; result = "disqualified"; reason = "mileage_too_high";
        }
      }

      if (partner === "auto" && form.ownership) {
        const ownershipOk = (cfg.eligibleOwnership || []).includes(form.ownership);
        log.push({
          step: "Check ownership status",
          ok: ownershipOk,
          detail: `${form.ownership} · eligible ${JSON.stringify(cfg.eligibleOwnership)}`,
        });
        if (!ownershipOk) {
          partner = "none"; result = "disqualified"; reason = "ownership_ineligible";
        }
      }

      if (partner === "auto" && form.payoff !== "" && form.payoff !== null && form.payoff !== undefined) {
        const payoffNum = Number(String(form.payoff).replace(/[^0-9.]/g, ""));
        const payoffOk = payoffNum >= cfg.minPayoff;
        log.push({
          step: "Check estimated payoff",
          ok: payoffOk,
          detail: `$${payoffNum.toLocaleString()} · min $${cfg.minPayoff.toLocaleString()}`,
        });
        if (!payoffOk) {
          partner = "none"; result = "disqualified"; reason = "payoff_below_min";
        }
      }

      // --- LTV check (payoff / MarketCheck vehicle value) ---
      if (
        partner === "auto" &&
        form.payoff !== "" && form.payoff != null &&
        form.valuationMarketCheckPrice != null && form.valuationMarketCheckPrice > 0 &&
        form.creditBand
      ) {
        const payoffNum = Number(String(form.payoff).replace(/[^0-9.]/g, ""));
        const vehicleVal = Number(form.valuationMarketCheckPrice);
        const ltv = payoffNum / vehicleVal;
        const maxLtvForBand = (cfg.maxLtv || {})[form.creditBand];
        const ltvOk = maxLtvForBand == null || ltv < maxLtvForBand;
        log.push({
          step: "Check LTV (Loan-to-Value)",
          ok: ltvOk,
          detail: `LTV ${(ltv * 100).toFixed(1)}% · payoff $${payoffNum.toLocaleString()} / value $${vehicleVal.toLocaleString()} · max ${maxLtvForBand != null ? (maxLtvForBand * 100).toFixed(0) + "%" : "n/a"}`,
        });
        if (!ltvOk) {
          partner = "none"; result = "disqualified"; reason = "ltv_too_high";
        }
      }

      if (partner === "auto" && form.creditBand === "300_579" && !effectiveHasCoApp) {
        log.push({
          step: "Check credit + co-applicant",
          ok: false,
          detail: "Poor credit band (300–579) with no co-applicant",
        });
        partner = "none"; result = "disqualified"; reason = "credit_requires_coapp";
      }

      if (
        partner === "auto" &&
        form.employmentType &&
        (cfg.restrictedEmploymentTypes || []).includes(form.employmentType) &&
        (cfg.restrictedEmploymentCreditBands || []).includes(form.creditBand)
      ) {
        log.push({
          step: "Check employment + credit",
          ok: false,
          detail: `${form.employmentType} with ${form.creditBand} band`,
        });
        partner = "none"; result = "disqualified"; reason = "employment_and_credit";
      }

      if (partner === "auto" && form.income !== "" && form.income !== null && form.income !== undefined) {
        const incomeNum = Number(String(form.income).replace(/[^0-9.]/g, ""));
        const incomeOk = incomeNum >= cfg.minAnnualIncome;
        log.push({
          step: "Check annual income",
          ok: incomeOk,
          detail: `$${incomeNum.toLocaleString()} · min $${cfg.minAnnualIncome.toLocaleString()}`,
        });
        if (!incomeOk) {
          partner = "none"; result = "disqualified"; reason = "income_below_min";
        }
      }

      // --- /Org-configured rules ---

      if (partner === "auto") {
        log.push({ step: "Check primary consent", ok: form.consentConfirmed, detail: form.consentConfirmed ? "Primary consent present" : "Primary consent missing" });
        if (!form.consentConfirmed) {
          partner = "none"; result = "disqualified"; reason = "no_consent";
        }
      }

      if (partner === "auto" && effectiveHasCoApp) {
        log.push({ step: "Check co-applicant consent", ok: form.coAppConsent, detail: form.coAppConsent ? "Co-applicant consent present" : "Co-applicant consent missing — falling back to single applicant" });
      }

      if (partner === "auto") {
        log.push({ step: "Check SSN", ok: dev.includeSsn, detail: dev.includeSsn ? "SSN present" : "SSN absent — Gravity ineligible" });
      }

      if (partner === "auto") {
        log.push({ step: "Match routing rules", ok: true, detail: `State=${form.state}, band=${form.creditBand || "unset"}` });
        if (form.creditBand === "300_579") {
          partner = "none"; result = "disqualified"; reason = "credit_out_of_range";
          log.push({ step: "Evaluate credit band", ok: false, detail: "Below all partner minimums" });
        } else if (!dev.includeSsn) {
          partner = "savings_group"; result = "offers_returned"; ruleId = "sg_ga_580plus";
          log.push({ step: "Fallback to Savings Group", ok: true, detail: "SG supports no-SSN prequal" });
        } else if (form.creditBand === "580_669") {
          partner = "savings_group"; result = "offers_returned"; ruleId = "sg_ga_580plus";
          log.push({ step: "Route to Savings Group", ok: true, detail: "580-669 band → SG priority" });
        } else {
          partner = "gravity"; result = "pre_approved"; ruleId = "gravity_general";
          log.push({ step: "Route to Gravity", ok: true, detail: "670+ band → Gravity priority" });
        }
      }
    } else if (partner !== "auto" && result === "auto") {
      if (partner === "savings_group") result = "offers_returned";
      else if (partner === "gravity") result = "pre_approved";
      else result = "disqualified";
    }

    if (result === "disqualified" && !reason) reason = dev.disqualReason;

    const partnerName = partner === "none" ? null : PARTNER_NAMES[partner];
    const partnerPhone = partner === "none" ? null : ROUTING_PHONE[partner];

    // Compute LTV for the decision payload (even if LTV check didn't disqualify)
    const payoffForLtv = form.payoff ? Number(String(form.payoff).replace(/[^0-9.]/g, "")) : null;
    const vehicleValueForLtv = form.valuationMarketCheckPrice ? Number(form.valuationMarketCheckPrice) : null;
    const computedLtv = payoffForLtv && vehicleValueForLtv ? payoffForLtv / vehicleValueForLtv : null;

    return {
      partner, partnerName, partnerPhone, result, reason, ruleId, log,
      externalApplicationId: partner === "gravity" ? "GRV-84721"
        : partner === "savings_group" ? "SG-12345"
          : null,
      // Vehicle valuation + LTV (stored on session)
      valuation: {
        marketcheck_price: form.valuationMarketCheckPrice,
        retail_price: form.valuationRetailPrice,
        ltv: computedLtv,
        ltv_pct: computedLtv != null ? `${(computedLtv * 100).toFixed(1)}%` : null,
      },
    };
  }

  const decision = runDecision();

  function finishDecision() { setScreen("stage2_result"); }
  function returnToEmbedded() {
    setEmbeddedState("post");
    setScreen("embedded_entry");
  }

  function resetAll() {
    setScreen("embedded_entry");
    setEmbeddedState("pre");
    setSelectedOfferId(null);
    setOfferConfirmed(false);
    setShowDisclosureModal(false);
    setForm(emptyForm());
  }

  // ---------- Render ----------

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <DevPanel
        open={panelOpen}
        setOpen={setPanelOpen}
        dev={dev}
        setDev={setDev}
        screen={screen}
        goTo={goTo}
        sequence={sequence}
        embeddedState={embeddedState}
        setEmbeddedState={setEmbeddedState}
        resetAll={resetAll}
        applyVehiclePrefill={applyVehiclePrefill}
        form={form}
        updateForm={update}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          screen={screen}
          panelOpen={panelOpen}
          togglePanel={() => setPanelOpen((v) => !v)}
        />

        <div className="flex-1 p-6 overflow-auto">
          <div className="max-w-2xl mx-auto">
            {screen === "embedded_entry" && (
              embeddedState === "pre"
                ? <EmbeddedPre onApply={() => setScreen("vehicle_add")} />
                : <EmbeddedPost decision={decision} form={form} onReset={resetAll} onViewOffers={() => setScreen("stage2_result")} />
            )}

            {(screen === "vehicle_add" || screen === "vehicle_drive" || screen.startsWith("s1_")) && (
              <WizardShell
                screen={screen}
                progress={stageOneProgress}
                stepIndex={currentStageIndex + 1}
                stepTotal={stage1Sequence.length}
                onBack={back}
              >
                <WizardScreen
                  screen={screen}
                  form={form}
                  update={update}
                  onBack={back}
                  onNext={next}
                  effectiveHasCoApp={effectiveHasCoApp}
                  showDisclosureModal={showDisclosureModal}
                  setShowDisclosureModal={setShowDisclosureModal}
                />
              </WizardShell>
            )}

            {screen === "decision_engine" && (
              <DecisionEngineScreen decision={decision} onDone={finishDecision} />
            )}

            {screen === "stage2_result" && (
              <StageTwoResult
                decision={decision}
                form={form}
                update={update}
                selectedOfferId={selectedOfferId}
                setSelectedOfferId={setSelectedOfferId}
                offerConfirmed={offerConfirmed}
                setOfferConfirmed={setOfferConfirmed}
                onReturn={returnToEmbedded}
                onReset={resetAll}
              />
            )}
          </div>
        </div>

        {dev.showJson && (
          <JsonPeek form={form} decision={decision} screen={screen} />
        )}
      </div>
    </div>
  );
}

// ---------- Top bar ----------

function TopBar({ screen, panelOpen, togglePanel }) {
  return (
    <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-slate-200">
      <div className="flex items-center gap-3">
        <button
          onClick={togglePanel}
          className="p-2 rounded-md hover:bg-slate-100 text-slate-600"
          title={panelOpen ? "Hide dev panel" : "Show dev panel"}
        >
          {panelOpen ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-blue-600 rounded-md flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold tracking-tight">blinker</span>
          <span className="text-slate-300">/</span>
          <span className="text-sm text-slate-500">Refinance v2 prototype</span>
        </div>
      </div>
      <div className="text-xs text-slate-500">
        {SCREEN_LABELS[screen] || screen}
      </div>
    </div>
  );
}

// ---------- Dev control panel ----------

function DevPanel({ open, setOpen, dev, setDev, screen, goTo, sequence, embeddedState, setEmbeddedState, resetAll, applyVehiclePrefill, form, updateForm }) {
  if (!open) return null;
  const set = (patch) => setDev({ ...dev, ...patch });

  function tryPrefill() {
    try {
      const p = JSON.parse(dev.prefillJson);
      applyVehiclePrefill(p);
    } catch (e) {
      alert("Couldn't parse JSON: " + e.message);
    }
  }

  function pickPreset(preset) {
    set({ prefillJson: JSON.stringify(preset.payload, null, 2) });
    applyVehiclePrefill(preset.payload);
  }

  function applyOrgConfig() {
    try {
      const parsed = JSON.parse(dev.orgConfigJson);
      set({ orgConfig: parsed, orgConfigError: null });
    } catch (e) {
      set({ orgConfigError: e.message });
    }
  }

  function resetOrgConfig() {
    set({
      orgConfig: DEFAULT_ORG_CONFIG,
      orgConfigJson: JSON.stringify(DEFAULT_ORG_CONFIG, null, 2),
      orgConfigError: null,
    });
  }

  return (
    <div className="w-80 shrink-0 bg-slate-900 text-slate-100 p-5 overflow-auto border-r border-slate-800">
      <div className="flex items-center gap-2 mb-4">
        <Settings className="w-4 h-4" />
        <div className="font-semibold text-sm tracking-wide uppercase">Dev controls</div>
      </div>
      <p className="text-xs text-slate-400 mb-5 leading-relaxed">
        Force outcomes, prefill applicant / co-applicant / vehicle, and jump between screens so we can iterate on every branch without re-entering data.
      </p>

      <Section label="Prefill payload (JSON)">
        <div className="text-xs text-slate-500 mb-1 leading-snug">
          Keys: <span className="font-mono">applicant</span>, <span className="font-mono">coApplicant</span>, <span className="font-mono">vehicle</span> (vehicle may include <span className="font-mono">vin</span>).
        </div>
        <textarea
          value={dev.prefillJson}
          onChange={(e) => set({ prefillJson: e.target.value })}
          className="w-full text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono h-40"
        />
        <button
          onClick={tryPrefill}
          className="w-full mt-2 flex items-center justify-center gap-1 text-xs px-2 py-1.5 bg-blue-600 hover:bg-blue-500 rounded font-semibold"
        >
          <ClipboardPaste className="w-3 h-3" /> Apply prefill
        </button>
        <div className="text-xs text-slate-500 mt-2 mb-1">Presets:</div>
        <div className="grid grid-cols-2 gap-1">
          {VEHICLE_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => pickPreset(p)}
              className="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-left"
            >
              {p.label}
            </button>
          ))}
        </div>
      </Section>

      <Section label="Org config (disqualification rules)">
        <div className="text-xs text-slate-500 mb-1 leading-snug">
          Emulates per-org / per-partner thresholds. These values drive the decision engine's disqualification checks.
        </div>
        <textarea
          value={dev.orgConfigJson}
          onChange={(e) => set({ orgConfigJson: e.target.value })}
          className="w-full text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-100 font-mono h-56"
        />
        {dev.orgConfigError && (
          <div className="text-xs text-rose-400 mt-1">{dev.orgConfigError}</div>
        )}
        <div className="flex gap-1 mt-2">
          <button
            onClick={applyOrgConfig}
            className="flex-1 text-xs px-2 py-1.5 bg-blue-600 hover:bg-blue-500 rounded font-semibold"
          >
            Apply config
          </button>
          <button
            onClick={resetOrgConfig}
            className="text-xs px-2 py-1.5 bg-slate-800 hover:bg-slate-700 rounded"
          >
            Reset
          </button>
        </div>
      </Section>

      <Section label="Force partner routing">
        <Segmented
          value={dev.forcePartner}
          onChange={(v) => set({ forcePartner: v })}
          options={[
            { v: "auto", l: "Auto" },
            { v: "gravity", l: "Gravity" },
            { v: "savings_group", l: "SG" },
            { v: "none", l: "None" },
          ]}
        />
      </Section>

      <Section label="Force Stage 2 result">
        <div className="flex flex-col gap-1">
          {[
            { v: "auto", l: "Auto (from rules)" },
            { v: "pre_approved", l: "Pre-approved" },
            { v: "offers_returned", l: "Offers returned" },
            { v: "disqualified", l: "Disqualified" },
            { v: "pending", l: "Pending / async" },
          ].map((o) => (
            <button
              key={o.v}
              onClick={() => set({ forceResult: o.v })}
              className={
                "text-left text-xs px-2 py-1 rounded " +
                (dev.forceResult === o.v
                  ? "bg-blue-600 text-white"
                  : "bg-slate-800 hover:bg-slate-700 text-slate-200")
              }
            >
              {o.l}
            </button>
          ))}
        </div>
      </Section>

      {dev.forceResult === "disqualified" && (
        <Section label="Disqualification reason">
          <select
            value={dev.disqualReason}
            onChange={(e) => set({ disqualReason: e.target.value })}
            className="w-full text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-100"
          >
            {Object.entries(DISQUAL_REASONS).map(([k, v]) => (
              <option key={k} value={k}>{v.title}</option>
            ))}
          </select>
        </Section>
      )}

      <Section label="SSN provided">
        <Segmented
          value={dev.includeSsn ? "yes" : "no"}
          onChange={(v) => set({ includeSsn: v === "yes" })}
          options={[{ v: "yes", l: "Yes" }, { v: "no", l: "No" }]}
        />
      </Section>

      <Section label="Co-applicant">
        <Segmented
          value={dev.coAppOverride}
          onChange={(v) => set({ coAppOverride: v })}
          options={[
            { v: "auto", l: "Auto" },
            { v: "yes", l: "Yes" },
            { v: "no", l: "No" },
          ]}
        />
        <div className="text-xs text-slate-500 mt-1">Auto follows the in-flow answer</div>
      </Section>

      <Section label="Protection plan sold">
        <Segmented
          value={form.planSold ? "yes" : "no"}
          onChange={(v) => updateForm({ planSold: v === "yes", smsSent: false, selectedPlanId: null })}
          options={[{ v: "yes", l: "Yes" }, { v: "no", l: "No" }]}
        />
        <div className="text-xs text-slate-500 mt-1">No → shows coverage teaser on result</div>
      </Section>

      <Section label="Insurance reviewed">
        <Segmented
          value={form.insuranceReviewed ? "yes" : "no"}
          onChange={(v) => updateForm({
            insuranceReviewed: v === "yes",
            insuranceSmsSent: false,
            insuranceSavingsFound: v === "yes" ? form.insuranceSavingsFound : false,
            insuranceMonthlySavings: v === "yes" ? form.insuranceMonthlySavings : 0,
          })}
          options={[{ v: "yes", l: "Yes" }, { v: "no", l: "No" }]}
        />
        <div className="text-xs text-slate-500 mt-1">No → shows insurance teaser on result</div>
      </Section>

      {form.insuranceReviewed && (
        <Section label="Insurance savings found">
          <Segmented
            value={form.insuranceSavingsFound ? "yes" : "no"}
            onChange={(v) => updateForm({
              insuranceSavingsFound: v === "yes",
              insuranceMonthlySavings: v === "yes" ? MOCK_INSURANCE_SAVINGS.monthlySavings : 0,
            })}
            options={[{ v: "yes", l: "Yes" }, { v: "no", l: "No" }]}
          />
          {form.insuranceSavingsFound && (
            <div className="text-xs text-orange-400 mt-1">${form.insuranceMonthlySavings}/mo → offsets refi + protection</div>
          )}
        </Section>
      )}

      <Section label="Jump to screen">
        <div className="flex flex-col gap-1 max-h-64 overflow-auto pr-1">
          {["embedded_entry", ...sequence].map((s) => {
            const isActive = screen === s;
            return (
              <button
                key={s}
                onClick={() => goTo(s)}
                className={
                  "text-left text-xs px-2 py-1 rounded flex items-center justify-between " +
                  (isActive ? "bg-blue-600 text-white" : "bg-slate-800 hover:bg-slate-700")
                }
              >
                <span>{SCREEN_LABELS[s]}</span>
                {isActive && <ChevronRight className="w-3 h-3" />}
              </button>
            );
          })}
        </div>
      </Section>

      <Section label="Embedded card state">
        <Segmented
          value={embeddedState}
          onChange={setEmbeddedState}
          options={[
            { v: "pre", l: "Pre-apply" },
            { v: "post", l: "Post-result" },
          ]}
        />
      </Section>

      <Section label="Inspector">
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={dev.showJson}
            onChange={(e) => set({ showJson: e.target.checked })}
          />
          Show JSON peek
        </label>
      </Section>

      <button
        onClick={resetAll}
        className="w-full mt-2 flex items-center justify-center gap-2 text-xs px-3 py-2 bg-red-600 hover:bg-red-500 rounded font-semibold"
      >
        <RefreshCcw className="w-3 h-3" /> Reset prototype
      </button>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div className="mb-5">
      <div className="text-xs text-slate-400 uppercase tracking-wide mb-2 font-semibold">{label}</div>
      {children}
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="flex bg-slate-800 rounded overflow-hidden">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={
            "flex-1 text-xs py-1 px-2 " +
            (value === o.v ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-700")
          }
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

// ---------- Embedded quote-time experience ----------

function EmbeddedPre({ onApply }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide">Mission Control · Quote</div>
          <div className="font-semibold text-lg">American Auto Alliance — Platinum</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">Total</div>
          <div className="font-semibold text-lg">$3,649.00</div>
        </div>
      </div>
      <div className="px-6 py-5 space-y-3 text-sm">
        <Row k="Package" v="Platinum VSC + GAP" />
        <Row k="Term" v="72 months" />
        <Row k="Discount" v="$0.00" />
        <Row k="Down payment (5%)" v="$182.45" />
        <Row k="24-month estimated pay" v="$144.44/mo" />
      </div>
      <div className="mx-6 mb-6 p-4 bg-blue-50 border border-blue-100 rounded-lg">
        <div className="flex items-center gap-2 mb-1">
          <Car className="w-4 h-4 text-blue-600" />
          <span className="font-semibold text-blue-800">Refinance this vehicle</span>
        </div>
        <p className="text-sm text-blue-900 mb-3">
          Estimated <span className="font-semibold">$55 – $87/mo</span> for 48–84 month terms at ~7.0% APR.
          Connect with a loan specialist to see real offers.
        </p>
        <button
          onClick={onApply}
          className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold text-sm flex items-center justify-center gap-2"
        >
          Apply for Refinance <ArrowRight className="w-4 h-4" />
        </button>
      </div>
      <div className="px-6 pb-5 text-xs text-slate-400 border-t border-slate-100 pt-4">
        Entry surface: <span className="font-mono">embedded_quote</span>. Routing rules will evaluate after identity + consent.
      </div>
    </div>
  );
}

function EmbeddedPost({ decision, form, onReset, onViewOffers }) {
  const { result, partnerName, partnerPhone, externalApplicationId } = decision;
  const bestOffer = MOCK_OFFERS[0];
  const statusBadge = {
    pre_approved: { label: "Pre-Approved", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    offers_returned: { label: "Offers Returned", cls: "bg-blue-100 text-blue-700 border-blue-200" },
    disqualified: { label: "Not Eligible", cls: "bg-rose-100 text-rose-700 border-rose-200" },
    pending: { label: "Pending", cls: "bg-amber-100 text-amber-700 border-amber-200" },
  }[result];

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide">Mission Control · Quote</div>
          <div className="font-semibold text-lg">American Auto Alliance — Platinum</div>
        </div>
        <span className={"text-xs font-semibold px-2 py-1 rounded border " + statusBadge.cls}>
          {statusBadge.label}
        </span>
      </div>
      <div className="px-6 py-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-xs text-slate-500">Refinance partner</div>
            <div className="font-semibold">{partnerName || "—"}</div>
            {externalApplicationId && (
              <div className="text-xs text-slate-400 font-mono mt-0.5">#{externalApplicationId}</div>
            )}
          </div>
          {partnerPhone && (
            <a
              href={"tel:" + partnerPhone.replace(/[^0-9]/g, "")}
              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-md flex items-center gap-2 font-semibold"
            >
              <Phone className="w-4 h-4" /> {partnerPhone}
            </a>
          )}
        </div>
        {result === "offers_returned" && (
          <div className="border border-blue-100 bg-blue-50 rounded-lg p-4 mb-3">
            <div className="text-xs text-blue-700 uppercase tracking-wide font-semibold mb-1">Best offer</div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-blue-900">${bestOffer.monthly}</span>
              <span className="text-sm text-blue-700">/mo</span>
            </div>
            <div className="text-sm text-blue-900 mt-1">
              {bestOffer.lender} · {bestOffer.apr}% APR · {bestOffer.term} mo
            </div>
            <div className="text-xs text-emerald-700 mt-1 flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Est. savings ${bestOffer.savings}/mo
            </div>
            <button
              onClick={onViewOffers}
              className="mt-3 text-xs text-blue-700 hover:text-blue-900 font-semibold underline"
            >
              View all offers →
            </button>
          </div>
        )}
        {result === "pre_approved" && (
          <div className="border border-emerald-100 bg-emerald-50 rounded-lg p-4 mb-3">
            <div className="flex items-center gap-2 text-emerald-800 font-semibold">
              <CheckCircle2 className="w-4 h-4" /> You're pre-approved
            </div>
            <p className="text-sm text-emerald-900 mt-1">
              A loan specialist will finalize terms and documents with you by phone.
            </p>
          </div>
        )}
        {result === "disqualified" && decision.reason && (
          <div className="border border-rose-100 bg-rose-50 rounded-lg p-4 mb-3">
            <div className="flex items-center gap-2 text-rose-800 font-semibold">
              <XCircle className="w-4 h-4" /> {DISQUAL_REASONS[decision.reason].title}
            </div>
            <p className="text-sm text-rose-900 mt-1">
              {DISQUAL_REASONS[decision.reason].msg}
            </p>
          </div>
        )}
        {result === "pending" && (
          <div className="border border-amber-100 bg-amber-50 rounded-lg p-4 mb-3">
            <div className="flex items-center gap-2 text-amber-800 font-semibold">
              <Loader2 className="w-4 h-4 animate-spin" /> Awaiting partner response
            </div>
            <p className="text-sm text-amber-900 mt-1">
              We'll update this card automatically once the partner returns a decision.
            </p>
          </div>
        )}
        <div className="flex items-center gap-2 text-xs text-slate-500 mt-3">
          <Info className="w-3 h-3" />
          Co-applicant: <span className="font-semibold">{form.hasCoApplicant ? "Yes" : "No"}</span>
        </div>
      </div>
      <div className="px-6 py-3 border-t border-slate-100 flex gap-2">
        <button
          onClick={onReset}
          className="text-xs text-slate-500 hover:text-slate-700 underline"
        >
          Restart prototype
        </button>
      </div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}

// ---------- Wizard shell + screen routing ----------

function WizardShell({ children, screen, progress, stepIndex, stepTotal, onBack }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 pt-5 pb-3">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={onBack}
            className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
          >
            <ArrowLeft className="w-3 h-3" /> Back
          </button>
          <div className="text-xs text-slate-500">
            Step {stepIndex} of {stepTotal}
          </div>
        </div>
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 transition-all"
            style={{ width: progress + "%" }}
          />
        </div>
      </div>
      {children}
    </div>
  );
}

function WizardScreen(props) {
  const { screen } = props;
  if (screen === "vehicle_add") return <ScreenVehicleAdd {...props} />;
  if (screen === "vehicle_drive") return <ScreenVehicleDrive {...props} />;
  if (screen === "s1_ownership") return <ScreenOwnership {...props} />;
  if (screen === "s1_auto_loan") return <ScreenAutoLoan {...props} />;
  if (screen === "s1_credit") return <ScreenCredit {...props} />;
  if (screen === "s1_co_app_decision") return <ScreenCoAppDecision {...props} />;
  if (screen === "s1_co_app_contact") return <ScreenCoAppContact {...props} />;
  if (screen === "s1_co_app_employment") return <ScreenCoAppEmployment {...props} />;
  if (screen === "s1_applicant") return <ScreenApplicant {...props} />;
  if (screen === "s1_housing") return <ScreenHousing {...props} />;
  if (screen === "s1_employment") return <ScreenEmployment {...props} />;
  if (screen === "s1_identity_consent") return <ScreenIdentityConsent {...props} />;
  return null;
}

function ScreenHeader({ icon: Icon, eyebrow = "Pre Qualification for a Loan", title, subtitle }) {
  return (
    <div className="px-6 pt-2 pb-4">
      <div className="flex items-center gap-2 text-blue-600 mb-2">
        <Icon className="w-4 h-4" />
        <span className="text-xs uppercase tracking-wide font-semibold">{eyebrow}</span>
      </div>
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
    </div>
  );
}

function Footer({ onNext, disabled, nextLabel = "Next", secondary }) {
  return (
    <div className="px-6 pb-5 pt-4 flex items-center justify-between border-t border-slate-100 mt-4">
      {secondary}
      <button
        onClick={onNext}
        disabled={disabled}
        className={
          "px-5 py-2 rounded-md font-semibold text-sm flex items-center gap-2 ml-auto " +
          (disabled
            ? "bg-slate-200 text-slate-400 cursor-not-allowed"
            : "bg-blue-600 hover:bg-blue-700 text-white")
        }
      >
        {nextLabel} <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}

// ---------- Vehicle screens ----------

function ScreenVehicleAdd({ form, update, onNext, requireVin = true }) {
  const [picker, setPicker] = useState(null); // null | 'year' | 'make' | 'model' | 'trim'
  const vinDecodeRef = useRef(null);

  const vinError = validators.vin(form.vin);
  const hasVin = form.vin && !vinError;
  const hasManual = form.year && form.make && form.model && form.trim;
  // Default (refi standalone): YMMT alone is enough to continue.
  // requireVin=true (mission-control / insurance-portal embedders): block
  // until VIN is present (17 chars) AND decoded successfully (or no decode
  // error i.e. user-overridden via manual YMMT after a successful decode).
  // YMMT-only completion is blocked when requireVin is true.
  const vinDecodeOkOrAbsent = !form.vinDecodeError;
  const ok = requireVin
    ? (hasVin && hasManual && vinDecodeOkOrAbsent)
    : hasManual;

  // Auto-decode VIN when it becomes valid (17 chars, no format errors).
  // Debounce 500ms so we don't fire on every keystroke.
  useEffect(() => {
    if (vinDecodeRef.current) clearTimeout(vinDecodeRef.current);
    if (!hasVin) return;
    // Don't re-decode if already decoded for this VIN
    if (form.vinDecoded && form.vin === form._lastDecodedVin) return;

    update({ vinDecodeLoading: true, vinDecodeError: null });

    vinDecodeRef.current = setTimeout(async () => {
      const result = await fetchVinDecode(form.vin);
      if (result.error) {
        update({ vinDecodeLoading: false, vinDecodeError: result.error });
        return;
      }

      // Match decoded make/model/trim to YMMT_DATA (case-insensitive +
      // partial). When a value is NOT in YMMT_DATA, inject it into the
      // corresponding `extra*` array on form so the picker surfaces it,
      // and auto-select it. No error, no friction — Continue stays
      // reachable for legitimate VIN decodes that use values our YMMT
      // fixture happens not to carry.
      const matchedMake = _ymmtMatch(YMMT_MAKES, result.make);
      const finalMake = matchedMake || result.make || form.make;
      const extraMakes = (!matchedMake && result.make) ? [result.make] : [];

      // Use finalMake to look up models — handles the case where the make
      // was injected as an extra (we still want to find any models the
      // VinAudit response provides).
      const makeModels = YMMT_DATA[finalMake] ? Object.keys(YMMT_DATA[finalMake]).sort() : [];
      const matchedModel = _ymmtMatch(makeModels, result.model);
      const finalModel = matchedModel || result.model || form.model;
      const extraModels = (!matchedModel && result.model) ? [result.model] : [];

      const modelTrims = (YMMT_DATA[finalMake] && YMMT_DATA[finalMake][finalModel])
        ? YMMT_DATA[finalMake][finalModel]
        : [];
      const matchedTrim = _ymmtMatch(modelTrims, result.trim);
      const finalTrim = matchedTrim || result.trim || "";
      // Auto-add unmatched trim to extraTrims so YmmtPicker surfaces it
      // AND we auto-select it. Future-friendly: when fetchVinDecode evolves
      // to return multiple candidate trims, push the array here.
      const extraTrims = (!matchedTrim && result.trim) ? [result.trim] : [];

      const patch = {
        vinDecoded: true,
        vinDecodeLoading: false,
        vinDecodeError: null,
        _lastDecodedVin: form.vin,
        year: result.year || form.year,
        make: finalMake,
        model: finalModel,
        trim: finalTrim,
        extraMakes,
        extraModels,
        extraTrims,
      };

      console.log("[VIN Decode] Matched:", patch, "raw:", result.raw);
      update(patch);
    }, 500);

    return () => { if (vinDecodeRef.current) clearTimeout(vinDecodeRef.current); };
  }, [form.vin]);

  // When user clears or changes VIN to invalid, reset decoded state
  useEffect(() => {
    if (!hasVin && form.vinDecoded) {
      update({
        vinDecoded: false, vinDecodeLoading: false, vinDecodeError: null,
        _lastDecodedVin: null,
        year: null, make: "", model: "", trim: "",
        extraMakes: [], extraModels: [], extraTrims: [],
      });
    }
  }, [hasVin]);

  return (
    <>
      <ScreenHeader icon={Car} eyebrow="Vehicle · Add or confirm" title="What's in your garage?" subtitle={requireVin ? "Enter the consumer's VIN — we'll decode the year, make, model, and trim automatically." : "Enter a VIN to decode automatically, or pick year, make, model, and trim manually."} />
      <div className="px-6 space-y-3">
        <Field
          label="VIN (17 characters)"
          value={form.vin}
          onChange={(v) => update({ vin: v.toUpperCase() })}
          placeholder="VIN 1C4PJXAG9SW559532"
          error={form.vin ? vinError : null}
          icon={ScanLine}
        />
        {form.vinDecodeLoading && (
          <div className="text-xs text-blue-600 flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Decoding VIN…
          </div>
        )}
        {form.vinDecoded && !form.vinDecodeLoading && !form.vinDecodeError && (
          <div className="text-xs text-emerald-700 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> VIN decoded — {[form.year, form.make, form.model, form.trim].filter(Boolean).join(" ")}
          </div>
        )}
        {form.vinDecodeError && !form.vinDecodeLoading && (
          <div className="text-xs text-amber-700 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {form.vinDecodeError}
          </div>
        )}

        {!requireVin && (
          <div className="flex items-center gap-3 my-2">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-400 font-semibold">{form.vinDecoded ? "DECODED" : "OR"}</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>
        )}

        {/* Year / Make / Model: always shown under !requireVin; hidden under requireVin */}
        {!requireVin && (
          <>
            <PickerField label="Year" value={form.year || ""} onClick={() => setPicker("year")} disabled={form.vinDecoded} disabledHint="Populated from VIN" />
            <PickerField label="Make" value={form.make} onClick={() => setPicker("make")} disabled={form.vinDecoded} disabledHint="Populated from VIN" />
            <PickerField
              label="Model"
              value={form.model}
              disabled={form.vinDecoded || !form.make}
              disabledHint={form.vinDecoded ? "Populated from VIN" : "Pick a make first"}
              onClick={() => setPicker("model")}
            />
          </>
        )}

        {/* Trim: shown under !requireVin only (requireVin=true: VIN decode auto-selects trim end-to-end) */}
        {!requireVin && (
          <PickerField
            label="Trim"
            value={form.trim}
            disabled={!form.model}
            disabledHint={!form.model ? "Pick a model first" : undefined}
            onClick={() => setPicker("trim")}
          />
        )}

        {/* "Trim is required" amber hint — only relevant in the !requireVin manual-pick path */}
        {!requireVin && form.year && form.make && form.model && !form.trim && (
          <div className="text-xs text-amber-700 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> Trim is required to continue.
          </div>
        )}
      </div>

      <Footer onNext={onNext} disabled={!ok} nextLabel="Continue" />

      {picker && (
        <YmmtPicker
          field={picker}
          form={form}
          update={update}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );
}

function PickerField({ label, value, onClick, disabled, disabledHint }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      className={
        "w-full text-left px-4 py-3 rounded-md border flex items-center justify-between " +
        (disabled
          ? "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed"
          : value
            ? "border-blue-200 bg-blue-50 hover:border-blue-300"
            : "border-slate-200 hover:border-slate-300 bg-white")
      }
    >
      <div className="flex flex-col">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <span className={"text-sm " + (value ? "font-medium text-slate-900" : "text-slate-400")}>
          {value || (disabled ? disabledHint : `Select ${label.toLowerCase()}`)}
        </span>
      </div>
      <ChevronDown className="w-4 h-4 text-slate-400" />
    </button>
  );
}

function YmmtPicker({ field, form, update, onClose }) {
  const titles = { year: "Select Year", make: "Select Make", model: "Select Model", trim: "Select Trim" };

  // Wave 20: source year-aware option lists from blinker-platform/utils so
  // discontinued models (e.g. Honda Element after 2011) are filtered out
  // by year. Local YMMT_DATA / YMMT_MAKES are still consumed by the VIN-
  // decode matching helper above (lines ~1908-1927) — the picker no longer
  // touches them. See blinker-platform/packages/utils/ymmt-data.js for the
  // YMMT_YEAR_CONSTRAINTS map.
  let options = [];
  if (field === "year") options = _platformYears;
  else if (field === "make") {
    // Platform makes + any decode-injected makes not present in fixture.
    const baseMakes = _platformGetMakes();
    const extras = (form.extraMakes || []).filter((m) => !baseMakes.includes(m));
    options = [...baseMakes, ...extras];
  }
  else if (field === "model" && form.make) {
    // Year-aware: when form.year is falsy the helper returns ALL models for
    // the make (no filtering). Decode-injected extras always surface.
    const base = _platformGetModelsForYearMake(form.year, form.make);
    const extras = (form.extraModels || []).filter((m) => !base.includes(m));
    options = [...base, ...extras];
  }
  else if (field === "trim" && form.make && form.model) {
    // Year-aware: returns [] if model is out-of-range for the year.
    const base = _platformGetTrimsForYearMakeModel(form.year, form.make, form.model);
    const extras = (form.extraTrims || []).filter((t) => !base.includes(t));
    options = ["I don't know", ...base, ...extras, "Other"];
  }

  const [search, setSearch] = useState("");
  const searchRef = useRef(null);
  const filtered = options.filter((o) => String(o).toLowerCase().includes(search.toLowerCase()));

  // Auto-focus the search input when the modal opens
  useEffect(() => {
    if (searchRef.current) searchRef.current.focus();
  }, []);

  function pick(v) {
    if (field === "year") update({ year: v });
    else if (field === "make") {
      // User-picked make resets downstream + clears decode-injected
      // extras for the now-stale model/trim hierarchy.
      update({ make: v, model: "", trim: "", extraModels: [], extraTrims: [] });
    }
    else if (field === "model") {
      update({ model: v, trim: "", extraTrims: [] });
    }
    else if (field === "trim") update({ trim: v });
    onClose();
  }

  const currentValue = form[field];

  return (
    <div className="fixed inset-0 bg-slate-900 bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden flex flex-col" style={{ maxHeight: "85vh" }}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="font-semibold">{titles[field]}</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>
        {options.length > 12 && (
          <div className="px-5 py-3 border-b border-slate-100">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${field}...`}
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        )}
        <div className="px-5 py-4 overflow-auto flex-1">
          <div className="grid grid-cols-3 gap-2">
            {filtered.map((o) => {
              const active = String(currentValue) === String(o);
              return (
                <button
                  key={o}
                  onClick={() => pick(o)}
                  className={
                    "px-3 py-2 text-sm rounded-md border " +
                    (active
                      ? "border-blue-600 bg-blue-600 text-white font-semibold"
                      : "border-blue-200 text-blue-700 hover:bg-blue-50")
                  }
                >
                  {o}
                </button>
              );
            })}
          </div>
          {filtered.length === 0 && (
            <div className="text-center text-sm text-slate-400 py-6">No matches</div>
          )}
        </div>
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// Default initial mileage sentinel — matches protection-portal's INITIAL_FORM.mileage.
// Used to detect whether the user has manually changed the slider.
const MILEAGE_INITIAL_DEFAULT = 50000;

function ScreenVehicleDrive({ form, update, onNext, nextLabel = "Add Vehicle", orgVehicleDefaults }) {
  // Org-level annual mileage rate; falls back to US benchmark of 12,000 mi/yr.
  const annualEstimate = orgVehicleDefaults?.annual_mileage_estimate ?? 12000;

  // Seed mileage from org config × vehicle age on first render if the user
  // hasn't touched the slider (value is still the system initial default).
  const mileageSeedAppliedRef = useRef(false);
  useEffect(() => {
    if (mileageSeedAppliedRef.current) return;
    if (!form.year) return;
    // Only seed when mileage is still at the system default (untouched).
    if (form.mileage !== MILEAGE_INITIAL_DEFAULT) {
      mileageSeedAppliedRef.current = true; // user already has a value — skip
      return;
    }
    const seeded = estimateMileageFromAge({ vehicleYear: form.year, annualEstimate });
    mileageSeedAppliedRef.current = true;
    update({ mileage: seeded });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.year]);

  // Annual-miles estimate — delegates to shared helper (single source of truth).
  const annualMiles = computeAnnualMileageEstimate({
    currentMileage: form.mileage,
    vehicleYear: form.year,
    condition: form.condition,
    purchaseDate: form.purchaseDate,
  });

  // Derived purchase-date state for warning / info banners (UI-only).
  const today = new Date();
  const purchase = form.condition === "Used" && form.purchaseDate ? new Date(form.purchaseDate) : null;
  const purchaseValid = purchase && !Number.isNaN(purchase.getTime());
  const purchaseInFuture = purchaseValid && purchase.getTime() > today.getTime();
  const rawOwnershipYears = purchaseValid && !purchaseInFuture
    ? (today.getTime() - purchase.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    : null;
  const ownershipUnderMonth = rawOwnershipYears != null && rawOwnershipYears < 1 / 12;
  const ownershipYears = rawOwnershipYears != null ? Math.max(1 / 12, rawOwnershipYears) : null;
  const usePurchaseMath = form.condition === "Used" && purchaseValid && !purchaseInFuture;
  const ownershipMonths = ownershipYears != null ? Math.max(1, Math.round(ownershipYears * 12)) : null;

  // Persist annual_mileage_estimate on form.vehicle whenever the inputs change
  // so downstream steps (AgentView, PostHog event, DB write) see the same value
  // the user saw on screen.
  useEffect(() => {
    const nextVehicle = {
      ...(form.vehicle || {}),
      annual_mileage_estimate: annualMiles,
    };
    // Avoid infinite re-render: only update when the value actually changed.
    if ((form.vehicle?.annual_mileage_estimate ?? null) !== annualMiles) {
      update({ vehicle: nextVehicle });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annualMiles]);

  const mileageError = form.mileage < 100 ? "Mileage must be at least 100" : form.mileage > 300000 ? "Mileage cannot exceed 300,000" : null;

  const vehicleTitle = [form.year, form.make, form.model, form.trim].filter(Boolean).join(" ");
  const valuationDebounce = useRef(null);

  // Debounced MarketCheck valuation — fires 600ms after mileage slider stops moving.
  // Uses applicant ZIP if available, otherwise defaults to 31324.
  // Re-fires whenever VIN, mileage, or ZIP change (so value updates when address is entered later).
  useEffect(() => {
    if (valuationDebounce.current) clearTimeout(valuationDebounce.current);
    const vin = form.vin;
    const zip = form.zip || MARKETCHECK_DEFAULT_ZIP;
    const miles = form.mileage;
    const haveVin = vin && vin.length === 17;
    const haveYmmt = form.year && form.make && form.model;
    if (!miles) return;
    if (!haveVin && !haveYmmt) return;
    update({ valuationLoading: true, valuationError: null });
    valuationDebounce.current = setTimeout(() => {
      if (haveVin) {
        fetchMarketCheckPrice({ vin, miles, zip }).then((result) => {
          update({
            valuationMarketCheckPrice: result.marketcheck_price,
            valuationRetailPrice: result.retail_price,
            valuationLoading: false,
            valuationError: result.error || null,
          });
        });
      } else {
        // YMMT-only path — skip real API (requires VIN), fall through to
        // cache (no entries match without VIN) → dev-mock fallback chain.
        fetchMarketCheckPriceYmmt({
          year: form.year,
          make: form.make,
          model: form.model,
          trim: form.trim,
          miles,
          zip,
        }).then((result) => {
          update({
            valuationMarketCheckPrice: result.marketcheck_price,
            valuationRetailPrice: result.retail_price,
            valuationLoading: false,
            valuationError: result.error || null,
          });
        });
      }
    }, 600);
    return () => { if (valuationDebounce.current) clearTimeout(valuationDebounce.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.mileage, form.vin, form.zip, form.year, form.make, form.model, form.trim]);

  const fmtCurrency = (v) => v != null ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "—";

  return (
    <>
      <div className="px-6 pt-2 pb-1">
        <div className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Getting to know your</div>
        <div className="text-blue-600 font-semibold">{vehicleTitle || "vehicle"}</div>
      </div>
      <ScreenHeader icon={Gauge} eyebrow="Vehicle · Confirm" title="How much do you drive?" subtitle="We use odometer and vehicle age to estimate driving pattern. This helps recommend term and mileage coverage." />

      <div className="px-6 space-y-5">
        <div>
          <div className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wide text-center">Confirm your current mileage</div>
          <div className="text-center my-2">
            <span className="inline-block px-4 py-2 bg-blue-600 text-white rounded-md font-semibold text-lg">
              {form.mileage.toLocaleString()}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={300000}
            step={1000}
            value={form.mileage}
            onChange={(e) => update({ mileage: parseInt(e.target.value, 10) })}
            className="w-full accent-blue-600"
          />
          <div className="flex items-center justify-between text-xs text-slate-400 mt-1">
            <span>0 mi</span>
            <span>300,000 mi</span>
          </div>
          {mileageError && (
            <div className="text-xs text-rose-600 mt-1">{mileageError}</div>
          )}
        </div>

        <div>
          <div className="text-xs text-slate-500 mb-2 font-semibold uppercase tracking-wide text-center">I purchased this vehicle</div>
          <div className="flex gap-2 max-w-xs mx-auto">
            {["New", "Used"].map((c) => (
              <button
                key={c}
                onClick={() => update(c === "New" ? { condition: c, purchaseDate: null } : { condition: c })}
                className={
                  "flex-1 py-2 rounded-md border text-sm font-medium " +
                  (form.condition === c ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 hover:border-slate-300")
                }
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {form.condition === "Used" && (
          <div className="max-w-xs mx-auto">
            <label className="block text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wide text-center">
              Date you purchased this vehicle
            </label>
            <input
              type="date"
              value={form.purchaseDate || ""}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => update({ purchaseDate: e.target.value || null })}
              className="w-full px-3 py-2 rounded-md border border-slate-200 hover:border-slate-300 text-sm focus:border-blue-600 focus:outline-none"
            />
          </div>
        )}

        <div className="text-center pt-2">
          <div className="text-xs text-slate-500 mb-1">Your estimated annual miles driven is</div>
          <div className="inline-block px-4 py-2 bg-blue-600 text-white rounded-md font-semibold">
            {annualMiles.toLocaleString()}
          </div>
          {form.condition === "Used" && !form.purchaseDate && (
            <div className="text-xs text-amber-600 mt-2 flex items-center justify-center gap-1">
              <Info className="w-3 h-3" /> Used vehicles: estimate is approximate until purchase date is captured.
            </div>
          )}
          {form.condition === "Used" && purchaseValid && purchaseInFuture && (
            <div className="text-xs text-amber-600 mt-2 flex items-center justify-center gap-1">
              <Info className="w-3 h-3" /> Purchase date is in the future — using vehicle age for estimate.
            </div>
          )}
          {form.condition === "Used" && usePurchaseMath && ownershipUnderMonth && (
            <div className="text-xs text-amber-600 mt-2 flex items-center justify-center gap-1">
              <Info className="w-3 h-3" /> Less than a month of ownership — estimate has high variance.
            </div>
          )}
          {form.condition === "Used" && usePurchaseMath && !ownershipUnderMonth && (
            <div className="text-xs text-slate-500 mt-2">
              Estimate based on {ownershipMonths} {ownershipMonths === 1 ? "month" : "months"} of ownership.
            </div>
          )}
        </div>

        {/* Vehicle Valuation Card — MarketCheck */}
        {form.vin && form.vin.length >= 17 && (
          <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="w-4 h-4 text-emerald-600" />
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Estimated Vehicle Value</span>
              {form.valuationLoading && <Loader2 className="w-3 h-3 text-blue-500 animate-spin ml-auto" />}
            </div>
            {form.valuationLoading && !form.valuationMarketCheckPrice && (
              <div className="text-sm text-slate-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" /> Fetching valuation...
              </div>
            )}
            {form.valuationError && !form.valuationMarketCheckPrice && (
              <div className="text-sm text-amber-600 space-y-1">
                <div>{form.valuationError}</div>
              </div>
            )}
            {form.valuationMarketCheckPrice != null && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">MarketCheck Price</span>
                  <span className="text-lg font-bold text-emerald-700">{fmtCurrency(form.valuationMarketCheckPrice)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">Retail Price</span>
                  <span className="text-lg font-bold text-slate-700">{fmtCurrency(form.valuationRetailPrice)}</span>
                </div>
                <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-200">
                  Based on VIN {form.vin} · {form.mileage.toLocaleString()} mi · ZIP {form.zip || MARKETCHECK_DEFAULT_ZIP}
                  {!form.zip && <span className="text-amber-500 ml-1">(default — updates when address entered)</span>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <Footer onNext={onNext} disabled={!!mileageError} nextLabel={nextLabel} />
    </>
  );
}

// ---------- Stage 1 screens ----------

function ScreenOwnership({ form, update, onNext }) {
  const selected = OWNERSHIP_OPTIONS.find((o) => o.id === form.ownership);
  const blocked = selected && !selected.eligible;
  return (
    <>
      <ScreenHeader icon={Car} title="What's your ownership status?" subtitle="We need to confirm the vehicle is eligible for refinance." />
      <div className="px-6 space-y-2">
        {OWNERSHIP_OPTIONS.map((o) => (
          <button
            key={o.id}
            onClick={() => update({ ownership: o.id })}
            className={
              "w-full text-left px-4 py-3 rounded-lg border text-sm transition-colors " +
              (form.ownership === o.id
                ? (o.eligible ? "border-blue-600 bg-blue-50" : "border-rose-500 bg-rose-50")
                : "border-slate-200 hover:border-slate-300 bg-white")
            }
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{o.label}</span>
              {form.ownership === o.id && (
                o.eligible
                  ? <Check className="w-4 h-4 text-blue-600" />
                  : <X className="w-4 h-4 text-rose-600" />
              )}
            </div>
          </button>
        ))}
      </div>
      {blocked && (
        <div className="mx-6 mt-3 p-3 bg-rose-50 border border-rose-200 rounded-md text-sm text-rose-800 flex gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Not eligible for refinance</div>
            <div>Only currently financed or leased vehicles are eligible for the refinance workflow.</div>
          </div>
        </div>
      )}
      <Footer onNext={onNext} disabled={!form.ownership || blocked} />
    </>
  );
}

function ScreenAutoLoan({ form, update, onNext }) {
  const monthlyError = validators.positiveCurrency(form.monthlyPayment);
  const payoffError = validators.positiveCurrency(form.payoff);
  const hasErrors = !!monthlyError || !!payoffError;
  return (
    <>
      <ScreenHeader icon={DollarSign} title="Tell us about your current loan" subtitle="Partners use this to recommend the best refinance fit. All fields are optional." />
      <div className="px-6 space-y-3">
        <LenderAutocomplete
          label="Current lender"
          value={form.lender}
          onChange={(v) => update({ lender: v })}
        />
        <Field label="Monthly payment" value={form.monthlyPayment} onChange={(v) => update({ monthlyPayment: sanitizeNumeric(v) })} placeholder="450" prefix="$" inputMode="decimal" error={monthlyError} />
        <Field label="Estimated payoff" value={form.payoff} onChange={(v) => update({ payoff: sanitizeNumeric(v) })} placeholder="18250" prefix="$" inputMode="decimal" error={payoffError} />
      </div>
      <Footer
        onNext={onNext}
        disabled={hasErrors}
        nextLabel="Next"
        secondary={
          <button onClick={onNext} className="text-sm text-slate-500 hover:text-slate-700 underline">
            Skip
          </button>
        }
      />
    </>
  );
}

function LenderAutocomplete({ label, value, onChange }) {
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    if (!value || value.length < 2) return [];
    const q = value.toLowerCase();
    return LENDERS.filter((n) => n.toLowerCase().includes(q)).slice(0, 8);
  }, [value]);

  return (
    <div className="relative">
      <Field
        label={label}
        value={value}
        onChange={(v) => { onChange(v); setOpen(true); }}
        placeholder="e.g. Ally Financial"
        icon={Search}
      />
      {open && matches.length > 0 && (
        <div className="absolute left-0 right-0 mt-1 border border-slate-200 rounded-md bg-white shadow-lg z-10 max-h-56 overflow-auto">
          {matches.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { onChange(m); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ScreenCredit({ form, update, onNext }) {
  return (
    <>
      <ScreenHeader icon={Sparkles} title="What's your credit score range?" subtitle="We use this to get a rough idea around offers that might be available for you. That way we know now is the right time to apply versus waiting until your situation improves. How would you rate your credit: Exceptional, Very Good, Good, Fair or Poor?" />
      <div className="px-6 space-y-2">
        {CREDIT_BANDS.map((b) => {
          const active = form.creditBand === b.id;
          return (
            <button
              key={b.id}
              onClick={() => update({ creditBand: b.id })}
              className={
                "w-full text-left px-4 py-3 rounded-lg border flex items-center justify-between " +
                (active ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:border-slate-300")
              }
            >
              <div>
                <div className="font-semibold text-sm">{b.label}</div>
                <div className="text-xs text-slate-500">{b.desc}</div>
              </div>
              {active && <Check className="w-4 h-4 text-blue-600" />}
            </button>
          );
        })}
      </div>
      {form.creditBand === "300_579" && (
        <div className="mx-6 mt-3 p-3 bg-blue-50 border border-blue-100 rounded-md text-xs text-blue-900 flex gap-2">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          <span>Because the credit band is below 580, we'll ask about a co-applicant next to improve approval odds.</span>
        </div>
      )}
      <Footer onNext={onNext} disabled={!form.creditBand} />
    </>
  );
}

function ScreenCoAppDecision({ form, update, onNext }) {
  return (
    <>
      <ScreenHeader icon={Users} title="Will there be a co-applicant?" subtitle="A co-applicant can strengthen the application but must also consent to a soft credit pull." />
      <div className="px-6 space-y-2">
        {[
          { v: true, label: "Yes, add a co-applicant", desc: "We'll collect contact and employment details next, then capture identity + consent on the same screen as the primary applicant." },
          { v: false, label: "No, just this applicant", desc: "Continue with the primary applicant only." },
        ].map((o) => (
          <button
            key={String(o.v)}
            onClick={() => update({ hasCoApplicant: o.v })}
            className={
              "w-full text-left px-4 py-3 rounded-lg border " +
              (form.hasCoApplicant === o.v ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:border-slate-300")
            }
          >
            <div className="font-semibold text-sm">{o.label}</div>
            <div className="text-xs text-slate-500 mt-0.5">{o.desc}</div>
          </button>
        ))}
      </div>
      <Footer onNext={onNext} disabled={form.hasCoApplicant === null} />
    </>
  );
}

function ScreenCoAppContact({ form, update, onNext }) {
  const needsOther = form.coAppRelationship === "Other";
  const errs = {
    coAppFirst: validators.required(form.coAppFirst),
    coAppLast: validators.required(form.coAppLast),
    coAppPhone: validators.required(form.coAppPhone) || validators.usPhone(form.coAppPhone),
    coAppEmail: validators.required(form.coAppEmail) || validators.email(form.coAppEmail),
    coAppRelationship: validators.required(form.coAppRelationship),
    coAppRelationshipOther: needsOther ? validators.required(form.coAppRelationshipOther) : null,
  };
  const ok = Object.values(errs).every((e) => !e);
  return (
    <>
      <ScreenHeader
        icon={User}
        title="Co-applicant contact info"
        subtitle="A strong co-applicant can assist better terms and rates with our lenders. Ideally, this person lives in your residence, however some lenders allow a co-applicant like a parent, sibling, good friend or other relative. Who can our lenders work with that would be willing to assist you?"
      />
      <div className="px-6 grid grid-cols-2 gap-3">
        <Field label="First name" value={form.coAppFirst} onChange={(v) => update({ coAppFirst: v })} />
        <Field label="Last name" value={form.coAppLast} onChange={(v) => update({ coAppLast: v })} />
        <PhoneField label="Phone" value={form.coAppPhone} onChange={(v) => update({ coAppPhone: v })} error={form.coAppPhone ? validators.usPhone(form.coAppPhone) : null} />
        <Field label="Email" value={form.coAppEmail} onChange={(v) => update({ coAppEmail: v })} placeholder="name@example.com" inputMode="email" error={form.coAppEmail ? validators.email(form.coAppEmail) : null} />
      </div>
      <div className="px-6 mt-4">
        {/* Wave 20 retrofit: was an inline 2-col button grid driven by the
            RELATIONSHIP_OPTIONS flat-string array. Now consumes the shared
            RelationshipPicker from blinker-platform/components.

            Storage shape note: refi-portal's other consumers (App.jsx +
            RefiSubFlow.jsx) iterate RELATIONSHIP_OPTIONS as labels and read
            `coAppRelationship` as a label too (e.g. "Spouse", "Domestic
            Partner", "Other"). The platform picker's default coercion would
            slugify (label → "spouse"), changing the stored payload and
            breaking those readers. To preserve label-as-id storage we pass
            `options` as records with `id === label`, which the picker then
            emits verbatim through onChange. */}
        <RelationshipPicker
          label="Relationship"
          value={form.coAppRelationship}
          onChange={(v) => update({
            coAppRelationship: v,
            coAppRelationshipOther: v === "Other" ? form.coAppRelationshipOther : "",
          })}
          otherText={form.coAppRelationshipOther || ""}
          onOtherTextChange={(v) => update({ coAppRelationshipOther: v })}
          options={RELATIONSHIP_OPTIONS.map((o) => ({ id: o, label: o }))}
          allowOther
        />
      </div>
      <Footer onNext={onNext} disabled={!ok} />
    </>
  );
}

function ScreenCoAppEmployment({ form, update, onNext }) {
  const errs = {
    coAppEmployer: validators.required(form.coAppEmployer),
    coAppEmploymentType: validators.required(form.coAppEmploymentType),
    coAppIncome: validators.required(form.coAppIncome) || validators.positiveCurrency(form.coAppIncome),
  };
  const ok = Object.values(errs).every((e) => !e);
  return (
    <>
      <ScreenHeader icon={Briefcase} title="Co-applicant employment" subtitle="Same fields as the primary applicant." />
      <div className="px-6 space-y-3">
        <Field label="Current employer" value={form.coAppEmployer} onChange={(v) => update({ coAppEmployer: v })} placeholder="e.g. Walmart" />
        <SelectField label="Employment type" value={form.coAppEmploymentType} onChange={(v) => update({ coAppEmploymentType: v })} options={EMPLOYMENT_TYPES} />
        <Field
          label="Annual income"
          value={form.coAppIncome}
          onChange={(v) => update({ coAppIncome: sanitizeNumeric(v) })}
          placeholder="65000"
          prefix="$"
          inputMode="decimal"
          error={form.coAppIncome ? validators.positiveCurrency(form.coAppIncome) : null}
        />
      </div>
      <Footer onNext={onNext} disabled={!ok} />
    </>
  );
}

function ScreenApplicant({ form, update, onNext }) {
  const errs = {
    firstName: validators.required(form.firstName),
    lastName: validators.required(form.lastName),
    phone: validators.required(form.phone) || validators.usPhone(form.phone),
    email: validators.required(form.email) || validators.email(form.email),
  };
  const ok = Object.values(errs).every((e) => !e);
  return (
    <>
      <ScreenHeader
        icon={User}
        eyebrow="Pre Qualification for a Loan · Primary Applicant"
        title="We need your help confirming your info"
        subtitle="Our lenders use this to verify who's applying. You can confirm these if they're already filled in, or enter them now."
      />
      <div className="px-6 grid grid-cols-2 gap-3">
        <Field label="First name" value={form.firstName} onChange={(v) => update({ firstName: v })} placeholder="Enter first name" />
        <Field label="Last name" value={form.lastName} onChange={(v) => update({ lastName: v })} placeholder="Enter last name" />
        <PhoneField label="Phone" value={form.phone} onChange={(v) => update({ phone: v })} error={form.phone ? validators.usPhone(form.phone) : null} />
        <Field label="Email" value={form.email} onChange={(v) => update({ email: v })} placeholder="name@example.com" inputMode="email" error={form.email ? validators.email(form.email) : null} />
      </div>
      <Footer onNext={onNext} disabled={!ok} />
    </>
  );
}

function ScreenHousing({ form, update, onNext }) {
  const errs = {
    address: validators.required(form.address),
    city: validators.required(form.city),
    state: validators.required(form.state) || validators.state2(form.state),
    zip: validators.required(form.zip) || validators.zip(form.zip),
    ownRent: validators.required(form.ownRent),
    housingPayment: validators.required(form.housingPayment) || validators.positiveCurrency(form.housingPayment),
    moveInDate: validators.required(form.moveInDate) || validators.flexDateInPast(form.moveInDate),
  };
  const ok = Object.values(errs).every((e) => !e);

  return (
    <>
      <ScreenHeader icon={Home} title="Current housing" subtitle="Our lenders use your current housing information to match to the best local options available to you." />
      <div className="px-6 space-y-3">
        {/* Address block — ZIP → city/state autofill + Google Places street
            autocomplete. Lives in blinker-platform/packages/components/
            (Wave 15c) so sibling apps (mission-control co-pilot,
            protection-portal cross-sell) embed the same address-collection
            UX without inheriting the housing-status / payment / move-in
            fields. */}
        <AddressBlock form={form} update={update} />

        <div>
          <div className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wide">Housing status</div>
          <div className="flex gap-2">
            {HOUSING_OPTIONS.map((o) => (
              <button
                key={o}
                onClick={() => update({ ownRent: o })}
                className={
                  "flex-1 py-2 rounded-md border text-sm font-medium " +
                  (form.ownRent === o ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 hover:border-slate-300")
                }
              >
                {o}
              </button>
            ))}
          </div>
        </div>
        <Field
          label="Housing monthly payment"
          value={form.housingPayment}
          onChange={(v) => update({ housingPayment: sanitizeNumeric(v) })}
          placeholder="1,450"
          prefix="$"
          inputMode="decimal"
          error={form.housingPayment ? validators.positiveCurrency(form.housingPayment) : null}
        />
        <DateField
          label="Move-in date"
          value={form.moveInDate}
          onChange={(v) => update({ moveInDate: v })}
          error={form.moveInDate ? validators.flexDateInPast(form.moveInDate) : null}
        />
      </div>
      <Footer onNext={onNext} disabled={!ok} />
    </>
  );
}

function ScreenEmployment({ form, update, onNext }) {
  const errs = {
    employer: validators.required(form.employer),
    employmentType: validators.required(form.employmentType),
    income: validators.required(form.income) || validators.positiveCurrency(form.income),
    startDate: form.startDate ? validators.flexDateInPast(form.startDate) : null,
  };
  const ok = !errs.employer && !errs.employmentType && !errs.income && !errs.startDate;
  return (
    <>
      <ScreenHeader icon={Briefcase} title="What occupies your day?" subtitle="Proven employment and income are often times required to secure the best offers with our lending partners." />
      <div className="px-6 space-y-3">
        <Field label="Current employer" value={form.employer} onChange={(v) => update({ employer: v })} placeholder="e.g. Walmart" />
        <SelectField label="Employment type" value={form.employmentType} onChange={(v) => update({ employmentType: v })} options={EMPLOYMENT_TYPES} />
        <Field
          label="Annual income"
          value={form.income}
          onChange={(v) => update({ income: sanitizeNumeric(v) })}
          placeholder="65250"
          prefix="$"
          inputMode="decimal"
          error={form.income ? validators.positiveCurrency(form.income) : null}
        />
        <DateField
          label="Start date"
          value={form.startDate}
          onChange={(v) => update({ startDate: v })}
          error={form.startDate ? validators.flexDateInPast(form.startDate) : null}
          optional
        />
      </div>
      <Footer onNext={onNext} disabled={!ok} />
    </>
  );
}

function ScreenIdentityConsent({ form, update, onNext, effectiveHasCoApp, showDisclosureModal, setShowDisclosureModal }) {
  const primaryDobError = form.dob ? dobAdult(form.dob) : null;
  const primarySsnError = form.ssn ? validators.ssn(form.ssn) : null;
  const coAppDobError = effectiveHasCoApp && form.coAppDob ? dobAdult(form.coAppDob) : null;
  const coAppSsnError = effectiveHasCoApp && form.coAppSsn ? validators.ssn(form.coAppSsn) : null;

  const primaryReady = form.dob && !primaryDobError && !primarySsnError;
  const coAppReady = !effectiveHasCoApp || (form.coAppDob && !coAppDobError && !coAppSsnError);
  const consentReady = form.consentConfirmed && (!effectiveHasCoApp || form.coAppConsent);
  const ok = primaryReady && coAppReady && consentReady;

  const primaryName = [form.firstName, form.lastName].filter(Boolean).join(" ") || "Primary applicant";
  const coAppName = [form.coAppFirst, form.coAppLast].filter(Boolean).join(" ") || "Co-applicant";

  return (
    <>
      <ScreenHeader icon={ShieldCheck} title="One last step" subtitle="Our lender partners need your consent to apply for financing. For the most accurate response its best to provide both date of birth and social security number. No worries, your credit will not be impacted to see qualified offers. Our lenders will discuss everything with you before applying for a specific loan on your behalf." />

      <div className="px-6 space-y-5">
        <IdentityBlock
          label="Applicant"
          name={primaryName}
          dob={form.dob}
          ssn={form.ssn}
          dobError={primaryDobError}
          ssnError={primarySsnError}
          onDob={(v) => update({ dob: v })}
          onSsn={(v) => update({ ssn: v })}
        />

        {effectiveHasCoApp && (
          <IdentityBlock
            label="Co-Applicant"
            name={coAppName}
            dob={form.coAppDob}
            ssn={form.coAppSsn}
            dobError={coAppDobError}
            ssnError={coAppSsnError}
            onDob={(v) => update({ coAppDob: v })}
            onSsn={(v) => update({ coAppSsn: v })}
          />
        )}

        <button
          onClick={() => setShowDisclosureModal(true)}
          className={
            "w-full text-left px-4 py-3 rounded-lg border flex items-center justify-between " +
            (consentReady ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:border-slate-300")
          }
        >
          <div className="flex items-center gap-2">
            {consentReady
              ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              : <FileText className="w-4 h-4 text-slate-500" />}
            <div>
              <div className="text-sm font-semibold">
                {consentReady ? "Disclosure accepted" : "Read and agree to disclosure"}
              </div>
              {effectiveHasCoApp && (
                <div className="text-xs text-slate-500">Covers {primaryName} and {coAppName}</div>
              )}
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      <Footer onNext={onNext} disabled={!ok} nextLabel="Submit for prequal" />

      {showDisclosureModal && (
        <DisclosureModal
          effectiveHasCoApp={effectiveHasCoApp}
          primaryName={primaryName}
          coAppName={coAppName}
          onClose={() => setShowDisclosureModal(false)}
          onConfirm={(primary, coApp) => {
            update({ consentConfirmed: primary, coAppConsent: coApp });
            setShowDisclosureModal(false);
          }}
        />
      )}
    </>
  );
}

function IdentityBlock({ label, name, dob, ssn, dobError, ssnError, onDob, onSsn }) {
  const formatSsn = (digits) => {
    const d = String(digits || "").replace(/\D/g, "").slice(0, 9);
    if (d.length <= 3) return d;
    if (d.length <= 5) return d.slice(0, 3) + "-" + d.slice(3);
    return d.slice(0, 3) + "-" + d.slice(3, 5) + "-" + d.slice(5);
  };
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</div>
          <div className="text-sm font-semibold text-slate-900">{name}</div>
        </div>
        <User className="w-4 h-4 text-slate-400" />
      </div>
      <div className="p-4 grid grid-cols-2 gap-3">
        <DateField
          label="Date of birth"
          value={dob}
          onChange={onDob}
          error={dobError}
        />
        <Field
          label="SSN (optional)"
          value={formatSsn(ssn)}
          onChange={(v) => onSsn(String(v).replace(/\D/g, "").slice(0, 9))}
          placeholder="123-45-6789"
          inputMode="numeric"
          maxLength={11}
          error={ssnError}
        />
      </div>
    </div>
  );
}

function DisclosureModal({ onClose, onConfirm, effectiveHasCoApp, primaryName, coAppName }) {
  const [primary, setPrimary] = useState(false);
  const [coApp, setCoApp] = useState(false);
  const ready = primary && (!effectiveHasCoApp || coApp);
  return (
    <div className="fixed inset-0 bg-slate-900 bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="font-semibold">Read and Agree</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 text-sm text-slate-700 space-y-3 max-h-80 overflow-auto">
          <p>
            By agreeing to submit this application, you acknowledge that you have read and agree to our
            lender's Terms and Conditions and Privacy Policy that can be found at the partner's website,
            and that all information provided is true, correct, and complete.
          </p>
          <p>
            You grant permission for Blinker and the selected refinance partner to obtain a copy of your
            credit report. This is a soft pull and does not affect your credit score.
          </p>
          <p>
            You consent to receive customer care, 2FA, and 2-way conversational text messages from Blinker
            and its partners at the number provided. Consent is not a condition of purchase. Message and
            data rates may apply. Reply STOP to unsubscribe.
          </p>
        </div>
        <div className="px-5 py-4 border-t border-slate-100 space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} className="mt-0.5" />
            <span><span className="font-semibold">{primaryName}</span> has read and agrees to the disclosure.</span>
          </label>
          {effectiveHasCoApp && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={coApp} onChange={(e) => setCoApp(e.target.checked)} className="mt-0.5" />
              <span><span className="font-semibold">{coAppName}</span> has read and agrees to the disclosure.</span>
            </label>
          )}
        </div>
        <div className="px-5 py-3 bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
          <button
            onClick={() => onConfirm(primary, coApp)}
            disabled={!ready}
            className={
              "px-4 py-2 text-sm rounded-md font-semibold " +
              (ready ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-slate-200 text-slate-400 cursor-not-allowed")
            }
          >
            Confirm consent
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Field primitives ----------

function Field({ label, value, onChange, placeholder, prefix, error, icon: Icon, inputMode, maxLength }) {
  return (
    <div>
      <div className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wide">{label}</div>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-2.5 text-slate-400 text-sm">{prefix}</span>
        )}
        {Icon && !prefix && (
          <Icon className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
        )}
        <input
          type="text"
          inputMode={inputMode}
          maxLength={maxLength}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={
            "w-full border rounded-md py-2 text-sm focus:outline-none focus:ring-1 " +
            (error
              ? "border-rose-300 focus:border-rose-500 focus:ring-rose-500"
              : "border-slate-200 focus:border-blue-500 focus:ring-blue-500") +
            " " +
            (prefix ? "pl-7 pr-3" : Icon ? "pl-9 pr-3" : "px-3")
          }
        />
      </div>
      {error && (
        <div className="text-xs text-rose-600 mt-1 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {error}
        </div>
      )}
    </div>
  );
}

// Phone field: stores just the 10 digits, displays (###) ###-####.
function PhoneField({ label, value, onChange, error }) {
  const display = formatPhoneDisplay(value);
  return (
    <Field
      label={label}
      value={display}
      onChange={(v) => onChange(String(v).replace(/\D/g, "").slice(0, 10))}
      placeholder="(555) 123-4567"
      inputMode="tel"
      maxLength={14}
      error={error}
    />
  );
}

// Date field: accepts digits or slashed input, stores the raw entry.
function DateField({ label, value, onChange, error, optional }) {
  return (
    <Field
      label={label + (optional ? " (optional)" : "")}
      value={value}
      onChange={(v) => onChange(String(v).replace(/[^0-9/]/g, "").slice(0, 10))}
      placeholder="MMDDYYYY or MM/DD/YYYY"
      inputMode="numeric"
      maxLength={10}
      error={error}
    />
  );
}

function SelectField({ label, value, onChange, options, error }) {
  return (
    <div>
      <div className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wide">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={
          "w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 bg-white " +
          (error
            ? "border-rose-300 focus:border-rose-500 focus:ring-rose-500"
            : "border-slate-200 focus:border-blue-500 focus:ring-blue-500")
        }
      >
        <option value="">Select...</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {error && (
        <div className="text-xs text-rose-600 mt-1">{error}</div>
      )}
    </div>
  );
}

// ---------- Decision engine transition ----------

function DecisionEngineScreen({ decision, onDone }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8">
      <div className="flex items-center gap-2 text-blue-600 mb-2">
        <Zap className="w-4 h-4" />
        <span className="text-xs uppercase tracking-wide font-semibold">Transition · Decision engine</span>
      </div>
      <h2 className="text-xl font-semibold tracking-tight mb-1">Running consent, age, SSN, and routing checks</h2>
      <p className="text-sm text-slate-500 mb-5">
        This screen is a debug view of what the backend decision engine will do between Stage 1 and Stage 2.
      </p>
      <div className="space-y-2 mb-6">
        {decision.log.map((entry, i) => (
          <div
            key={i}
            className={
              "flex items-start gap-3 p-3 rounded-md border " +
              (entry.ok ? "border-emerald-100 bg-emerald-50" : "border-rose-100 bg-rose-50")
            }
          >
            {entry.ok
              ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
              : <XCircle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />}
            <div>
              <div className="text-sm font-semibold">{entry.step}</div>
              <div className="text-xs text-slate-600">{entry.detail}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="bg-slate-50 border border-slate-200 rounded-md p-4 mb-5 text-sm">
        <div className="font-semibold text-slate-700 mb-2">Decision output</div>
        <Kv k="routed_partner" v={decision.partner} />
        <Kv k="partnerName" v={decision.partnerName || "—"} />
        <Kv k="partnerPhone" v={decision.partnerPhone || "—"} />
        <Kv k="routing_rule_id" v={decision.ruleId || "—"} />
        <Kv k="result_type" v={decision.result} />
        {decision.reason && <Kv k="disqualification_reason_code" v={decision.reason} />}
      </div>
      <button
        onClick={onDone}
        className="w-full px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold text-sm flex items-center justify-center gap-2"
      >
        Continue to Stage 2 <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}

function Kv({ k, v }) {
  return (
    <div className="flex items-center justify-between text-xs py-0.5">
      <span className="font-mono text-slate-500">{k}</span>
      <span className="font-mono text-slate-800">{String(v)}</span>
    </div>
  );
}

// ---------- Stage 2 result screens ----------

function StageTwoResult({ decision, form, update, selectedOfferId, setSelectedOfferId, offerConfirmed, setOfferConfirmed, onReturn, onReset }) {
  const selectedOffer = selectedOfferId ? MOCK_OFFERS.find((o) => o.id === selectedOfferId) : null;
  const showCoverageTeaser = !form.planSold;
  const showInsuranceTeaser = !form.insuranceReviewed;
  const insuranceSavings = form.insuranceSavingsFound ? form.insuranceMonthlySavings : 0;
  return (
    <div className="space-y-3">
      {decision.result === "pre_approved" && (
        <QualifiedHandoffCard decision={decision} form={form} selectedOffer={null} onReturn={onReturn} insuranceSavings={insuranceSavings} />
      )}
      {decision.result === "offers_returned" && !offerConfirmed && (
        <OffersCard
          decision={decision}
          form={form}
          selectedOfferId={selectedOfferId}
          setSelectedOfferId={setSelectedOfferId}
          onConfirm={() => setOfferConfirmed(true)}
          insuranceSavings={insuranceSavings}
        />
      )}
      {decision.result === "offers_returned" && offerConfirmed && (
        <QualifiedHandoffCard decision={decision} form={form} selectedOffer={selectedOffer} onReturn={onReturn} insuranceSavings={insuranceSavings} />
      )}
      {decision.result === "disqualified" && <DisqualifiedCard decision={decision} onReturn={onReturn} onReset={onReset} />}
      {decision.result === "pending" && <PendingCard decision={decision} onReturn={onReturn} />}

      {/* Insurance teaser — shown when insurance has NOT been reviewed yet */}
      {showInsuranceTeaser && (
        <InsuranceTeaser form={form} update={update} />
      )}

      {/* Insurance savings found — compact banner when review is done and savings exist */}
      {!showInsuranceTeaser && insuranceSavings > 0 && (
        <InsuranceSavingsCard form={form} />
      )}

      {/* Protection plan teaser — shown when no plan was sold prior to this workflow */}
      {showCoverageTeaser && (
        <ProtectionPlanTeaser form={form} update={update} decision={decision} insuranceSavings={insuranceSavings} />
      )}
    </div>
  );
}

function Stage2Shell({ icon: Icon, tone, title, subtitle, children }) {
  const toneCls = {
    emerald: "bg-emerald-100 text-emerald-700 border-emerald-200",
    blue: "bg-blue-100 text-blue-700 border-blue-200",
    rose: "bg-rose-100 text-rose-700 border-rose-200",
    amber: "bg-amber-100 text-amber-700 border-amber-200",
  }[tone];
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 pt-5 pb-4 border-b border-slate-100">
        <div className="flex items-start gap-3">
          <div className={"w-10 h-10 rounded-full flex items-center justify-center border " + toneCls}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wide font-semibold text-slate-500">Stage 2 · Result</div>
            <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
            {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
        </div>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function PartnerHandoff({ decision }) {
  return (
    <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-lg mb-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-blue-100 rounded-md flex items-center justify-center">
          <Building2 className="w-4 h-4 text-blue-700" />
        </div>
        <div>
          <div className="text-xs text-slate-500">Speak with a loan specialist</div>
          <div className="font-semibold text-sm">{decision.partnerName}</div>
          {decision.externalApplicationId && (
            <div className="text-xs text-slate-400 font-mono">#{decision.externalApplicationId}</div>
          )}
        </div>
      </div>
      {decision.partnerPhone && (
        <a
          href={"tel:" + decision.partnerPhone.replace(/[^0-9]/g, "")}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-md flex items-center gap-2 font-semibold"
        >
          <Phone className="w-4 h-4" /> {decision.partnerPhone}
        </a>
      )}
    </div>
  );
}

// ---- Qualified handoff card (used for Gravity pre-approval AND post-offer-selection on Savings Group) ----
function QualifiedHandoffCard({ decision, form, selectedOffer, onReturn, insuranceSavings }) {
  const insSav = insuranceSavings || 0;
  const partnerName = decision.partnerName || "our refi partner";
  const loanId = decision.externalApplicationId || "—";
  const applicantName = [form.firstName, form.lastName].filter(Boolean).join(" ") || "the applicant";
  const vehicleLine = [form.year, form.make, form.model].filter(Boolean).join(" ") || "vehicle on file";
  const creditLabel = form.creditBand ? (CREDIT_BANDS.find((b) => b.id === form.creditBand)?.label || form.creditBand) : "Self-reported credit";
  const payoffDisplay = form.payoff ? Number(form.payoff).toLocaleString(undefined, { maximumFractionDigits: 0 }) : null;
  const incomeDisplay = form.income ? Number(form.income).toLocaleString(undefined, { maximumFractionDigits: 0 }) : null;
  const employmentLine = [form.employmentType, form.employer].filter(Boolean).join(" · ");

  // Why-qualified bullets, computed from captured data.
  const whyBullets = [];
  whyBullets.push({
    icon: ShieldCheck,
    title: "Credit profile looks good",
    body: `Self-reported credit band ${creditLabel} falls inside ${partnerName}'s approved range for an auto refinance.`,
  });
  if (payoffDisplay) {
    whyBullets.push({
      icon: Car,
      title: "Vehicle and payoff are in range",
      body: `${vehicleLine} with an estimated $${payoffDisplay} payoff clears the loan-to-value threshold for refinance.`,
    });
  }
  if (incomeDisplay && employmentLine) {
    whyBullets.push({
      icon: Briefcase,
      title: "Employment and income verified",
      body: `${employmentLine} with ${`$${incomeDisplay}`}/yr supports monthly payment affordability.`,
    });
  } else if (incomeDisplay) {
    whyBullets.push({
      icon: Briefcase,
      title: "Income supports the loan",
      body: `Reported $${incomeDisplay}/yr supports monthly payment affordability for this vehicle.`,
    });
  }
  if (selectedOffer) {
    const combinedSav = selectedOffer.savings + insSav;
    const savParts = [];
    if (selectedOffer.savings > 0) savParts.push(`$${selectedOffer.savings}/mo refi`);
    if (insSav > 0) savParts.push(`$${insSav}/mo insurance`);
    const savText = savParts.length > 0 ? ` — save ${savParts.join(" + ")}${savParts.length > 1 ? ` = $${combinedSav}/mo total` : ""}` : "";
    whyBullets.push({
      icon: Sparkles,
      title: `Offer chosen: ${selectedOffer.lender}`,
      body: `${selectedOffer.apr}% APR · ${selectedOffer.term} months · $${selectedOffer.monthly}/mo${savText}.`,
    });
  }
  if (!selectedOffer && insSav > 0) {
    whyBullets.push({
      icon: ShieldCheck,
      title: `Insurance savings: $${insSav}/mo`,
      body: `Blinker found $${insSav}/mo in auto insurance savings with ${MOCK_INSURANCE_SAVINGS.bestCarrier}. This can offset monthly costs of a protection plan or improve overall affordability.`,
    });
  }

  return (
    <div className="space-y-3">
      {/* Agent-facing warm-transfer banner */}
      <div className="bg-slate-900 text-white rounded-xl p-4 flex items-start gap-3 shadow-sm">
        <div className="w-9 h-9 rounded-md bg-slate-800 flex items-center justify-center shrink-0">
          <Headphones className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="flex-1">
          <div className="text-[11px] uppercase tracking-wide font-semibold text-emerald-400">Agent talk track · Warm transfer</div>
          <div className="text-sm mt-0.5 leading-snug">
            Walk {applicantName.split(" ")[0] || "the customer"} through the cards below, then transfer to {partnerName} at{" "}
            <span className="font-mono text-emerald-300">{decision.partnerPhone || "—"}</span>.
            Reference loan ID <span className="font-mono text-emerald-300">#{loanId}</span> so they pick up where you left off.
          </div>
        </div>
      </div>

      {/* Hero: You're Qualified! */}
      <Stage2Shell
        icon={CheckCircle2}
        tone="emerald"
        title="You're Qualified!"
        subtitle={`${partnerName} has cleared this auto refinance application for next steps.`}
      >
        <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-100 mb-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <Check className="w-4 h-4" />
            </div>
            <div className="text-sm text-emerald-900 leading-snug">
              <p className="font-semibold">Great news — based on the information you shared, your auto refinance pre-qualifies with {partnerName}.</p>
              <p className="mt-1 text-emerald-800">
                A licensed loan specialist will finalize the terms, confirm payoff with your current lender, and get the new loan documents over to you.
              </p>
            </div>
          </div>
        </div>

        {/* Why You're Qualified */}
        <div className="mb-4">
          <div className="text-xs uppercase tracking-wide font-semibold text-slate-500 mb-2">Why you're qualified</div>
          <div className="space-y-2">
            {whyBullets.map((b, i) => {
              const IconC = b.icon;
              return (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-slate-200">
                  <div className="w-7 h-7 rounded-md bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
                    <IconC className="w-3.5 h-3.5 text-emerald-700" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-slate-800">{b.title}</div>
                    <div className="text-xs text-slate-600 leading-snug mt-0.5">{b.body}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Your File Has Been Assigned */}
        <div className="mb-4 p-4 rounded-lg border border-amber-200 bg-amber-50">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center shrink-0">
              <FileCheck2 className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-amber-900">Your file has been assigned</div>
              <div className="text-xs text-amber-800 leading-snug mt-0.5">
                A dedicated refinance specialist at {partnerName} has already been assigned to your file.
                They have everything we collected today and are ready to take your call.
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="flex flex-col items-center gap-1 p-2 rounded-md bg-white border border-amber-100">
                  <PhoneCall className="w-4 h-4 text-amber-700" />
                  <div className="text-[11px] font-semibold text-amber-900">Phone</div>
                  <div className="text-[10px] text-amber-700">Warm transfer</div>
                </div>
                <div className="flex flex-col items-center gap-1 p-2 rounded-md bg-white border border-amber-100">
                  <Mail className="w-4 h-4 text-amber-700" />
                  <div className="text-[11px] font-semibold text-amber-900">Email</div>
                  <div className="text-[10px] text-amber-700">Docs & e-sign</div>
                </div>
                <div className="flex flex-col items-center gap-1 p-2 rounded-md bg-white border border-amber-100">
                  <MessageSquare className="w-4 h-4 text-amber-700" />
                  <div className="text-[11px] font-semibold text-amber-900">SMS</div>
                  <div className="text-[10px] text-amber-700">Status updates</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* What Happens Next */}
        <div className="mb-4">
          <div className="text-xs uppercase tracking-wide font-semibold text-slate-500 mb-2">What happens next</div>
          <div className="space-y-2">
            {[
              { t: "Specialist contacts you", b: `${partnerName} will connect with you on the same call to introduce themselves.` },
              { t: "Review qualification details", b: "They confirm credit, payoff, employment, and vehicle information with you." },
              { t: "Guide you through the application", b: "They walk you through the final application, disclosures, and e-signatures." },
              { t: "Move forward with new loan", b: "Once approved, they pay off your current lender and start you on the new, better loan." },
            ].map((s, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-[11px] font-semibold shrink-0">{i + 1}</div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-slate-800">{s.t}</div>
                  <div className="text-xs text-slate-600 leading-snug">{s.b}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <PartnerHandoff decision={decision} />

        <button
          onClick={onReturn}
          className="w-full px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold text-sm flex items-center justify-center gap-2"
        >
          <UserCheck className="w-4 h-4" /> Mark transfer complete & return to quote card
        </button>

        <div className="text-[11px] text-slate-400 mt-3 font-mono">
          loan_id=#{loanId} · partner={decision.partner} · platform_status=Working - Approved
        </div>
      </Stage2Shell>
    </div>
  );
}

function OffersCard({ decision, form, selectedOfferId, setSelectedOfferId, onConfirm, insuranceSavings }) {
  const insSav = insuranceSavings || 0;
  return (
    <Stage2Shell
      icon={Sparkles}
      tone="blue"
      title={`${MOCK_OFFERS.length} offers returned`}
      subtitle={`${decision.partnerName} matched lenders for this applicant. Select an offer to hand off.`}
    >
      <PartnerHandoff decision={decision} />

      {/* Combined savings banner when insurance savings exist */}
      {insSav > 0 && (
        <div className="mb-4 p-3 bg-gradient-to-r from-emerald-50 to-orange-50 border border-emerald-200 rounded-lg">
          <div className="text-xs uppercase tracking-wide font-semibold text-slate-500 mb-1">Combined Monthly Savings</div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-xs text-emerald-700">Refi savings</span>
            </div>
            <span className="text-slate-300">+</span>
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-orange-600" />
              <span className="text-xs text-orange-700">${insSav}/mo insurance</span>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2 mb-5">
        {MOCK_OFFERS.map((o) => {
          const selected = selectedOfferId === o.id;
          const combinedSavings = o.savings + insSav;
          return (
            <div
              key={o.id}
              className={
                "p-4 rounded-lg border " +
                (selected ? "border-blue-600 bg-blue-50" : "border-slate-200")
              }
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold text-sm">{o.lender}</div>
                  <div className="text-xs text-slate-500">{o.apr}% APR · {o.term} months</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold">${o.monthly}<span className="text-xs text-slate-500">/mo</span></div>
                  {o.savings > 0 && (
                    <div className="text-xs text-emerald-700 flex items-center gap-1 justify-end">
                      <Sparkles className="w-3 h-3" /> save ${o.savings}/mo
                    </div>
                  )}
                  {insSav > 0 && (
                    <div className="text-xs text-orange-600 flex items-center gap-1 justify-end mt-0.5">
                      <ShieldCheck className="w-3 h-3" /> +${insSav}/mo ins.
                    </div>
                  )}
                  {combinedSavings > 0 && insSav > 0 && o.savings > 0 && (
                    <div className="text-xs font-bold text-emerald-800 border-t border-slate-200 mt-1 pt-1 flex items-center gap-1 justify-end">
                      <TrendingDown className="w-3 h-3" /> total ${combinedSavings}/mo
                    </div>
                  )}
                </div>
              </div>
              <div className="text-xs text-slate-400 mt-2">{o.disclaimer}</div>
              <button
                onClick={() => setSelectedOfferId(o.id)}
                className={
                  "mt-3 w-full py-1.5 text-xs font-semibold rounded-md " +
                  (selected
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 hover:bg-slate-200 text-slate-700")
                }
              >
                {selected ? "Selected" : "Select this offer"}
              </button>
            </div>
          );
        })}
      </div>
      <button
        onClick={onConfirm}
        disabled={!selectedOfferId}
        className={
          "w-full px-5 py-2.5 rounded-md font-semibold text-sm " +
          (selectedOfferId ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-slate-200 text-slate-400 cursor-not-allowed")
        }
      >
        {selectedOfferId ? "Confirm selection & continue to handoff" : "Select an offer to continue"}
      </button>
    </Stage2Shell>
  );
}

function DisqualifiedCard({ decision, onReturn, onReset }) {
  const reason = decision.reason ? DISQUAL_REASONS[decision.reason] : null;
  return (
    <Stage2Shell
      icon={XCircle}
      tone="rose"
      title={reason ? reason.title : "Unable to prequalify"}
      subtitle={decision.partnerName ? `Routed to ${decision.partnerName}, but we can't continue.` : "No partner matched this application."}
    >
      {reason && (
        <div className="p-4 rounded-lg border border-rose-100 bg-rose-50 mb-4">
          <div className="text-sm text-rose-900">{reason.msg}</div>
        </div>
      )}
      <div className="text-xs text-slate-500 mb-5 font-mono">
        prequal_result = disqualified · reason_code = {decision.reason || "—"}
      </div>
      <div className="flex gap-2">
        <button onClick={onReset} className="flex-1 px-5 py-2.5 border border-slate-200 hover:bg-slate-50 rounded-md font-semibold text-sm">
          Retry with different info
        </button>
        <button onClick={onReturn} className="flex-1 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold text-sm">
          Return to quote card
        </button>
      </div>
    </Stage2Shell>
  );
}

function PendingCard({ decision, onReturn }) {
  return (
    <Stage2Shell
      icon={Loader2}
      tone="amber"
      title="Awaiting partner response"
      subtitle={decision.partnerName ? `${decision.partnerName} is still reviewing this submission.` : "Waiting on a partner response."}
    >
      {decision.partnerPhone && <PartnerHandoff decision={decision} />}
      <div className="text-sm text-slate-700 mb-5">
        This state is shown when the partner is slow or async. The embedded card will automatically update when the normalized status changes.
      </div>
      <button onClick={onReturn} className="w-full px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold text-sm">
        Return to quote card
      </button>
    </Stage2Shell>
  );
}

// ---------- Insurance Teaser / Savings ----------
// Two modes:
// 1. insuranceReviewed === false → Shows teaser with SMS CTA for consumer to capture insurance
// 2. insuranceReviewed === true && insuranceSavingsFound === true → Shows savings found badge
//    Savings are wired into refi offer cards and protection plan teaser as buying power.

function InsuranceTeaser({ form, update }) {
  const vehicleLine = [form.year, form.make, form.model, form.trim].filter(Boolean).join(" ") || "your vehicle";
  const consumerPhone = form.phone || "(555) 555-0142";
  const [showSmsConfirm, setShowSmsConfirm] = useState(false);

  // Already sent — confirmation view
  if (form.insuranceSmsSent) {
    return (
      <Stage2Shell icon={MessageSquare} tone="emerald" title="Insurance link sent" subtitle={`Sent to ${consumerPhone}`}>
        <div className="p-4 rounded-lg border border-emerald-100 bg-emerald-50 mb-4">
          <div className="text-sm text-emerald-900 font-medium mb-1">What happens next</div>
          <div className="text-sm text-emerald-800">
            The consumer will receive a message with a secure link to connect their insurance via <span className="font-semibold">Canopy Connect</span>.
            Once connected, Blinker will automatically gather their policy details and show updated coverage and rate options — no forms to fill out.
          </div>
        </div>
        <div className="text-xs text-slate-500 font-mono mb-4">
          vehicle = {vehicleLine} · sms_to = {consumerPhone} · provider = canopy_connect
        </div>
        <button
          onClick={() => update({ insuranceSmsSent: false })}
          className="w-full px-5 py-2.5 border border-slate-200 hover:bg-slate-50 rounded-md font-semibold text-sm"
        >
          Back to insurance options
        </button>
      </Stage2Shell>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-slate-100">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center border bg-orange-100 text-orange-700 border-orange-200">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wide font-semibold text-slate-500">Insurance · Savings Finder</div>
            <h2 className="text-xl font-semibold tracking-tight">Insurance Options</h2>
            <p className="text-sm text-slate-500 mt-0.5">for <span className="text-orange-600 font-medium">{vehicleLine}</span></p>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 space-y-4">
        {/* Get proof / compare section */}
        <div className="text-center space-y-2">
          <h3 className="text-lg font-bold text-slate-900">Get proof of insurance</h3>
          <p className="text-sm text-slate-600">
            With just a few clicks the consumer can connect their current insurance company so we can validate, shop, and compare current coverage and pricing.
          </p>
        </div>

        {/* Don't have insurance CTA */}
        <div className="border-t border-orange-200 pt-4">
          <p className="text-sm font-semibold text-center text-slate-800 mb-1">Don't have a current auto insurance policy?</p>
          <p className="text-xs text-center text-slate-500 mb-3">Blinker can help — compare quotes from top insurance companies</p>
        </div>

        {/* Carrier logos + savings preview */}
        <div className="flex items-start gap-4">
          <div className="flex-1 space-y-1.5">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Insurance Quotes</div>
            {MOCK_INSURANCE_QUOTES.map((q) => (
              <div key={q.carrier} className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-md">
                <span className="text-xs font-bold text-slate-700 truncate w-24">{q.logo}</span>
                <span className="text-xs text-slate-400">$$</span>
              </div>
            ))}
          </div>
          <div className="flex-1 flex flex-col items-center justify-center text-center pt-6">
            <div className="text-3xl font-bold text-orange-600">${MOCK_INSURANCE_SAVINGS.monthlySavings}/month</div>
            <div className="text-lg text-orange-500 font-medium">Average Savings</div>
            <div className="mt-3 space-y-1 text-left">
              <div className="text-sm text-slate-700 font-medium flex items-center gap-2"><span className="text-orange-600 font-bold">1.</span> Shop</div>
              <div className="text-sm text-slate-700 font-medium flex items-center gap-2"><span className="text-orange-600 font-bold">2.</span> Monitor</div>
              <div className="text-sm text-slate-700 font-medium flex items-center gap-2"><span className="text-orange-600 font-bold">3.</span> Save</div>
            </div>
          </div>
        </div>

        {/* Agent action area */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide font-semibold text-slate-500 mb-2">Agent Actions</div>
          <p className="text-sm text-slate-600 mb-3">
            Discuss insurance savings with the customer. Send them a text to review and compare insurance on their own device.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowSmsConfirm(true)}
              className="flex-1 px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-md font-semibold text-sm flex items-center justify-center gap-2"
            >
              <Send className="w-4 h-4" /> Find Insurance
            </button>
          </div>
          <div className="text-[10px] text-slate-400 mt-2 text-center">
            By clicking 'Find Insurance', I agree to Blinker's Terms, Consent to be Contacted, and Information Disclosure.
          </div>
        </div>
      </div>

      {/* SMS/Email confirmation modal */}
      {showSmsConfirm && (
        <div className="fixed inset-0 bg-slate-900 bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <div className="font-semibold">Confirm — send insurance link</div>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center">
                  <Mail className="w-4 h-4 text-orange-600" />
                </div>
                <div className="flex-1">
                  <div className="text-xs text-slate-500">Send to consumer</div>
                  <div className="font-semibold text-sm">{form.firstName || "Consumer"} — {consumerPhone}</div>
                  {form.email && <div className="text-xs text-slate-400">{form.email}</div>}
                </div>
              </div>
              {/* Message preview — mirrors actual Canopy Connect template */}
              <div className="p-3 bg-orange-50 rounded-lg border border-orange-100 space-y-2">
                <div className="text-xs text-orange-700 font-medium">Message preview</div>
                <div className="flex items-center gap-2 pb-2 border-b border-orange-200">
                  <span className="text-xs font-bold text-slate-700">blinker</span>
                  <span className="text-[10px] text-slate-400">|</span>
                  <span className="text-[10px] text-slate-500 uppercase tracking-wide">Embedded Insurance</span>
                </div>
                <div className="text-sm text-slate-900">
                  <span className="font-bold">Hi {form.firstName || "{FIRST NAME}"},</span>
                </div>
                <div className="text-xs text-slate-700 leading-relaxed">
                  To help us compare your existing coverage for your <span className="font-semibold">{vehicleLine}</span> with new options, please link your current insurance account securely using the link below.
                </div>
                <div className="text-xs text-slate-700 leading-relaxed">
                  This process uses <span className="font-semibold">Canopy Connect</span>, a trusted and encrypted connection that allows you to log in to your insurance provider directly. Your credentials remain private and are never shared with us.
                </div>
                <div className="text-xs text-orange-600 font-semibold underline">
                  Link My Insurance → s.blinker.com/...
                </div>
              </div>
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex gap-2">
              <button onClick={() => setShowSmsConfirm(false)} className="flex-1 px-4 py-2.5 border border-slate-200 rounded-md font-semibold text-sm hover:bg-white">
                Cancel
              </button>
              <button
                onClick={() => {
                  update({ insuranceSmsSent: true });
                  setShowSmsConfirm(false);
                }}
                className="flex-1 px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-md font-semibold text-sm flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" /> Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// InsuranceSavingsBadge — compact badge shown when savings were found.
// Used inline inside OffersCard and ProtectionPlanTeaser.
function InsuranceSavingsBadge({ monthlySavings, className }) {
  if (!monthlySavings || monthlySavings <= 0) return null;
  return (
    <div className={"flex items-center gap-1.5 px-2 py-1 bg-orange-50 border border-orange-200 rounded-md text-xs " + (className || "")}>
      <ShieldCheck className="w-3.5 h-3.5 text-orange-600" />
      <span className="text-orange-700 font-semibold">+${monthlySavings}/mo insurance savings</span>
    </div>
  );
}

// InsuranceSavingsCard — "Insurance at a Glance" view.
// Shown in StageTwoResult when insurance was reviewed and savings exist.
// Matches the Omega Autocare mockup: current carrier + monthly, coverage checklist, potential savings.
function InsuranceSavingsCard({ form }) {
  const s = MOCK_INSURANCE_SAVINGS;
  const vehicleLine = [form.year, form.make, form.model].filter(Boolean).join(" ") || "your vehicle";
  const firstName = form.firstName || "Customer";
  const lowestPlan = MOCK_PROTECTION_PLANS[MOCK_PROTECTION_PLANS.length - 1]; // Good = cheapest
  const showBuyingPower = !form.planSold; // show protection tie-in when plan not sold
  const [view, setView] = useState("glance"); // "glance" or "buying_power"

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-slate-100">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center border bg-orange-100 text-orange-700 border-orange-200">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wide font-semibold text-slate-500">
              {view === "glance" ? "Insurance · At a Glance" : "Buying Power"}
            </div>
            <h2 className="text-xl font-semibold tracking-tight">
              {view === "glance" ? "Insurance at a Glance" : "Insurance Savings Alert"}
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">for <span className="text-orange-600 font-medium">{vehicleLine}</span></p>
          </div>
          {/* View toggle tabs */}
          {showBuyingPower && (
            <div className="flex rounded-md border border-slate-200 overflow-hidden text-[10px] font-semibold">
              <button
                onClick={() => setView("glance")}
                className={"px-2 py-1 " + (view === "glance" ? "bg-orange-500 text-white" : "bg-white text-slate-500 hover:bg-slate-50")}
              >
                Glance
              </button>
              <button
                onClick={() => setView("buying_power")}
                className={"px-2 py-1 " + (view === "buying_power" ? "bg-orange-500 text-white" : "bg-white text-slate-500 hover:bg-slate-50")}
              >
                Buying Power
              </button>
            </div>
          )}
        </div>
      </div>

      {view === "glance" ? (
        /* ---- Insurance at a Glance view ---- */
        <div className="px-6 py-5 space-y-4">
          {/* Canopy Connect success message */}
          <div className="text-sm text-slate-700 text-center">
            <span className="font-semibold">{firstName}</span>, we were successful at obtaining insurance information from <span className="font-semibold">{s.currentCarrier}</span> to help us validate, shop and compare current coverage and pricing.
          </div>

          {/* Current monthly — large hero */}
          <div className="text-center py-2">
            <div className="text-sm font-medium text-rose-500">You are currently paying</div>
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-5xl font-bold text-rose-500">${s.currentMonthly}</span>
              <div className="text-sm text-rose-400 text-left leading-tight">
                <div>Per</div>
                <div>Month</div>
              </div>
            </div>
          </div>

          {/* Coverage checklist */}
          <div className="space-y-2">
            {s.coverageChecks.map((c) => (
              <div key={c.label} className="flex items-center gap-3 px-2">
                {c.pass ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                ) : (
                  <XCircle className="w-5 h-5 text-rose-500 shrink-0" />
                )}
                <span className="text-sm font-semibold text-slate-800">{c.label}</span>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-200" />

          {/* Savings — large hero */}
          <div className="text-center py-2">
            <div className="text-sm font-medium text-emerald-600">You could save up to</div>
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-5xl font-bold text-emerald-600">${s.monthlySavings}</span>
              <div className="text-sm text-emerald-500 text-left leading-tight">
                <div>Per</div>
                <div>Month</div>
              </div>
            </div>
          </div>

          <div className="text-center text-sm font-semibold text-slate-700">
            Shop · Compare · Monitor
          </div>

          {/* Agent action */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <div className="text-xs uppercase tracking-wide font-semibold text-slate-500 mb-2">Agent Actions</div>
            <p className="text-sm text-slate-600 mb-3">
              Walk the customer through their current coverage and potential savings. Use the insurance savings of <span className="font-semibold text-orange-700">${s.monthlySavings}/mo</span> to help offset protection plan costs or as part of the overall refi value.
            </p>
            <button className="w-full px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-md font-semibold text-sm">
              Find Coverage
            </button>
            <div className="text-[10px] text-slate-400 mt-2 text-center">
              By clicking 'Find Coverage', I agree to Blinker's Terms, Consent to be Contacted, and Information Disclosure.
            </div>
          </div>
        </div>
      ) : (
        /* ---- Buying Power view ---- */
        <div className="px-6 py-5 space-y-4">
          {/* Insurance Savings Alert message */}
          <div className="text-sm text-slate-700 text-center">
            <span className="font-semibold">{firstName}</span>, we were successful at shopping, comparing and finding insurance options. Your savings provides buying power that you can use to afford protecting your vehicle from unexpected repairs.
          </div>

          {/* Protection as low as — large hero */}
          <div className="text-center py-2">
            <div className="text-sm font-medium text-rose-500">Protection as low as</div>
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-5xl font-bold text-rose-500">${Math.round(lowestPlan.monthlyPrice)}</span>
              <div className="text-sm text-rose-400 text-left leading-tight">
                <div>Per</div>
                <div>Month</div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200" />

          {/* Insurance savings found — large hero */}
          <div className="text-center py-2">
            <div className="text-sm font-medium text-emerald-600">We found</div>
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-5xl font-bold text-emerald-600">${s.monthlySavings}</span>
              <div className="text-sm text-emerald-500 text-left leading-tight">
                <div>Per</div>
                <div>Month</div>
              </div>
            </div>
            <div className="text-sm font-medium text-emerald-600 mt-1">in Auto Insurance Savings</div>
          </div>

          {/* Agent action */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <div className="text-xs uppercase tracking-wide font-semibold text-slate-500 mb-2">Agent Actions</div>
            <p className="text-sm text-slate-600 mb-3">
              Use the <span className="font-semibold text-emerald-700">${s.monthlySavings}/mo</span> insurance savings as a selling point for protection coverage. The cheapest plan ({lowestPlan.tier}) is <span className="font-semibold">${Math.round(lowestPlan.monthlyPrice)}/mo</span>, effectively <span className="font-semibold text-emerald-700">${Math.round(lowestPlan.monthlyPrice - s.monthlySavings)}/mo</span> after insurance savings.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Protection Plan Teaser ----------
// Shown at both qualified and disqualified endpoints when planSold === false.
// Allows the sales agent to discuss coverage options with the consumer and send
// the consumer an SMS with a link to review, select, and purchase.

function ProtectionPlanTeaser({ form, update, decision, insuranceSavings }) {
  const insSav = insuranceSavings || 0;
  const vehicleLine = [form.year, form.make, form.model, form.trim].filter(Boolean).join(" ") || "your vehicle";
  const plans = MOCK_PROTECTION_PLANS;
  const selectedPlan = plans.find((p) => p.id === form.selectedPlanId) || plans[0];
  const [expandedPlan, setExpandedPlan] = useState(plans[0].id);
  const [showSmsConfirm, setShowSmsConfirm] = useState(false);
  const consumerPhone = form.phone || "(555) 555-0142";

  function selectPlan(id) {
    update({ selectedPlanId: id });
    setExpandedPlan(id);
  }

  // SMS sent confirmation
  if (form.smsSent) {
    return (
      <Stage2Shell icon={MessageSquare} tone="emerald" title="Coverage link sent" subtitle={`Text message sent to ${consumerPhone}`}>
        <div className="p-4 rounded-lg border border-emerald-100 bg-emerald-50 mb-4">
          <div className="text-sm text-emerald-900 font-medium mb-1">What happens next</div>
          <div className="text-sm text-emerald-800">
            The consumer will receive a text with a link to review the <span className="font-semibold">{selectedPlan.name} ({selectedPlan.tier})</span> plan.
            They can review coverage details, change their selection, and complete the purchase on their own device.
          </div>
        </div>
        <div className="text-xs text-slate-500 font-mono mb-4">
          plan_id = {selectedPlan.id} · vehicle = {vehicleLine} · sms_to = {consumerPhone}
        </div>
        <button
          onClick={() => update({ smsSent: false })}
          className="w-full px-5 py-2.5 border border-slate-200 hover:bg-slate-50 rounded-md font-semibold text-sm"
        >
          Back to coverage options
        </button>
      </Stage2Shell>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-slate-100">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center border bg-blue-100 text-blue-700 border-blue-200">
            <Shield className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wide font-semibold text-slate-500">Protection · Coverage Options</div>
            <h2 className="text-xl font-semibold tracking-tight">Recommended Coverage</h2>
            <p className="text-sm text-slate-500 mt-0.5">Payment options for <span className="text-blue-600 font-medium">{vehicleLine}</span></p>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 space-y-4">
        {/* Subtitle */}
        <p className="text-sm text-slate-500 text-center italic">Here is your personal quote based on your vehicle and info you provided</p>

        {/* Insurance buying power banner */}
        {insSav > 0 && (
          <div className="p-3 bg-gradient-to-r from-orange-50 to-blue-50 border border-orange-200 rounded-lg flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4 text-orange-600" />
            </div>
            <div className="flex-1">
              <div className="text-xs font-semibold text-orange-800">Insurance savings = buying power</div>
              <div className="text-xs text-slate-600">
                The <span className="font-semibold text-orange-700">${insSav}/mo</span> in insurance savings can help offset the cost of a protection plan.
              </div>
            </div>
          </div>
        )}

        {/* Plan tier cards — dual price when insurance savings exist */}
        <div className="grid grid-cols-3 gap-2">
          {plans.map((plan) => {
            const isSelected = (form.selectedPlanId || plans[0].id) === plan.id;
            const adjustedPrice = insSav > 0 ? Math.max(0, plan.monthlyPrice - insSav) : null;
            return (
              <button
                key={plan.id}
                onClick={() => selectPlan(plan.id)}
                className={
                  "relative rounded-lg border-2 p-3 text-center transition-all " +
                  (isSelected
                    ? "border-blue-600 bg-blue-600 text-white shadow-md"
                    : "border-blue-200 bg-white text-blue-700 hover:border-blue-400")
                }
              >
                <div className={"text-xs font-bold uppercase tracking-wide mb-1 " + (isSelected ? "text-blue-100" : "text-blue-500")}>
                  {plan.tier}
                </div>
                {adjustedPrice !== null ? (
                  <>
                    <div className="leading-tight">
                      <span className={"text-lg font-bold " + (isSelected ? "text-emerald-200" : "text-emerald-600")}>
                        ${Math.round(adjustedPrice)}
                      </span>
                      <span className={"text-sm mx-0.5 " + (isSelected ? "text-blue-200" : "text-slate-400")}>/</span>
                      <span className={"text-sm line-through " + (isSelected ? "text-blue-200" : "text-slate-400")}>
                        ${Math.round(plan.monthlyPrice)}
                      </span>
                    </div>
                    <div className={"text-xs " + (isSelected ? "text-blue-100" : "text-slate-500")}>per month</div>
                  </>
                ) : (
                  <>
                    <div className={"text-lg font-bold " + (isSelected ? "text-white" : "text-slate-900")}>
                      ${plan.monthlyPrice.toFixed(2)}
                    </div>
                    <div className={"text-xs " + (isSelected ? "text-blue-100" : "text-slate-500")}>per month</div>
                  </>
                )}
              </button>
            );
          })}
        </div>
        {/* Insurance adjustment note */}
        {insSav > 0 && (
          <div className="text-xs text-slate-500 text-center italic">
            *Adjusted by ${insSav} per month in Auto Insurance Savings
          </div>
        )}

        {/* Selected plan details */}
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <div className="font-semibold text-sm">{selectedPlan.name} ({selectedPlan.tier})</div>
            <div className="text-xs text-blue-600">{selectedPlan.term} or {selectedPlan.mileage}</div>
          </div>
          <div className="px-4 py-3">
            <div className="font-medium text-xs text-slate-700 mb-2">{selectedPlan.tagline}</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {selectedPlan.covered.map((item) => (
                <div key={item} className="text-xs text-slate-600 flex items-center gap-1.5">
                  <Check className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Agent action area */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide font-semibold text-slate-500 mb-2">Agent Actions</div>
          <p className="text-sm text-slate-600 mb-3">
            Discuss these coverage options with the customer. When ready, send them a text to review and purchase on their own device.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowSmsConfirm(true)}
              className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold text-sm flex items-center justify-center gap-2"
            >
              <Send className="w-4 h-4" /> Send to customer
            </button>
          </div>
        </div>
      </div>

      {/* SMS confirmation modal */}
      {showSmsConfirm && (
        <div className="fixed inset-0 bg-slate-900 bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <div className="font-semibold">Confirm — send coverage link</div>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                  <MessageSquare className="w-4 h-4 text-blue-600" />
                </div>
                <div className="flex-1">
                  <div className="text-xs text-slate-500">Send text message to</div>
                  <div className="font-semibold text-sm">{form.firstName || "Consumer"} — {consumerPhone}</div>
                </div>
              </div>
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                <div className="text-xs text-blue-700 font-medium mb-1">Message preview</div>
                <div className="text-sm text-blue-900">
                  Hi {form.firstName || "there"}! Your personalized vehicle protection quote for your {vehicleLine} is ready to review.
                  Tap here to select your coverage: <span className="text-blue-600 underline">blinker.com/coverage/...</span>
                </div>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="text-xs text-slate-500">Selected plan</div>
                <div className="font-semibold text-sm">{selectedPlan.name} ({selectedPlan.tier}) — ${selectedPlan.monthlyPrice.toFixed(2)}/mo</div>
              </div>
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex gap-2">
              <button onClick={() => setShowSmsConfirm(false)} className="flex-1 px-4 py-2.5 border border-slate-200 rounded-md font-semibold text-sm hover:bg-white">
                Cancel
              </button>
              <button
                onClick={() => {
                  update({ smsSent: true, selectedPlanId: selectedPlan.id });
                  setShowSmsConfirm(false);
                }}
                className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md font-semibold text-sm flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" /> Send SMS
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- JSON peek ----------

function JsonPeek({ form, decision, screen }) {
  return (
    <div className="bg-slate-900 text-slate-200 text-xs font-mono p-4 max-h-64 overflow-auto border-t border-slate-800">
      <div className="text-slate-400 mb-2 uppercase tracking-wide text-xs">JSON peek · current state</div>
      <pre className="whitespace-pre-wrap break-words">
{JSON.stringify({ screen, decision: {
  partner: decision.partner,
  partnerName: decision.partnerName,
  result: decision.result,
  reason: decision.reason,
  ruleId: decision.ruleId,
  externalApplicationId: decision.externalApplicationId,
}, form }, null, 2)}
      </pre>
    </div>
  );
}

// ---------- Named exports for the new substrate (added 2026-05-03 § 1.5b) ----------
//
// The monolith remains the single source of truth for the refi screens.
// src/views/customer/RefiWizard.jsx imports the screens + helpers from
// here so we don't have to duplicate ~3000 lines of working code.
//
// When § 1.5c lands (agent view + public exports), the surface that
// protection-portal embeds (PrequalForm, OffersCard, QualifiedCard) will
// be re-exported from src/views/customer/index.js — that's the public
// contract. The exports below are internal-to-this-app: views/ and
// shell/ may import from here, but cross-app consumers may NOT.

export {
  // Static data
  CREDIT_BANDS,
  OWNERSHIP_OPTIONS,
  EMPLOYMENT_TYPES,
  HOUSING_OPTIONS,
  RELATIONSHIP_OPTIONS,
  DISQUAL_REASONS,
  DEFAULT_ORG_CONFIG,
  PARTNER_NAMES,
  ROUTING_PHONE,
  PREFILL_PRESETS,
  VEHICLE_PRESETS,
  // Helpers
  sanitizeNumeric,
  parseFlexDate,
  parseDob,
  ageYears,
  dobAdult,
  formatPhoneDisplay,
  validators,
  STAGE1_TERMINUS,
  // Wizard chrome (refi-prototype's variants — distinct from src/shared/
  // copies because these screens close over them with refi-specific defaults)
  WizardShell as RefiWizardShellLegacy,
  ScreenHeader,
  Footer,
  // Screens
  ScreenVehicleAdd,
  ScreenVehicleDrive,
  ScreenOwnership,
  ScreenAutoLoan,
  ScreenCredit,
  ScreenCoAppDecision,
  ScreenCoAppContact,
  ScreenCoAppEmployment,
  ScreenApplicant,
  ScreenHousing,
  ScreenEmployment,
  ScreenIdentityConsent,
  // Stage 2 result components
  DecisionEngineScreen,
  StageTwoResult,
  // Form-field primitives (refi-prototype variants — kept for screens that
  // pull from here; src/shared/FormFields.jsx is the platform-shared copy)
  Field,
  PhoneField,
  DateField,
  SelectField,
  // Pickers
  PickerField,
  YmmtPicker,
  LenderAutocomplete,
  // Identity helpers
  IdentityBlock,
  DisclosureModal,
};
