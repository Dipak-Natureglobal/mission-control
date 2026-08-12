// AddressBlock — reusable address-collection block.
//
// Lifted from refi-portal/src/components/AddressBlock.jsx in Wave 15c.
// Implementation byte-identical to the lift source; only the file
// header is updated to reflect the new home. The original Wave-6
// extraction history is preserved below.
//
// Renders ZIP → city/state autofill (via zippopotam.us with a static
// fallback table) and a street-address autocomplete input (via Google
// Places API "New" REST autocomplete).
//
// Why this exists: mission-control's co-pilot pane and protection-portal's
// cross-sell flows need to collect a contact address when the upstream
// system didn't provide one — and they want the same UX (ZIP-first,
// city/state auto-fill, Google Places street autocomplete) that lives in
// the canonical refi housing screen. This sub-block is the canonical
// implementation; the refi housing screen embeds it alongside refi-only
// extras (housing-status pills, monthly payment, move-in date).
//
// Public surface: exposed via packages/components/index.js. See that
// file's JSDoc for the embed contract.
//
// External prerequisites for embedders:
//   - Google Places API key — currently hardcoded in this file (mirrors
//     the original monolith). When the platform secrets pipeline lands,
//     this should move to import.meta.env.VITE_GOOGLE_PLACES_KEY with
//     this constant as the fallback. Calls go directly to
//     places.googleapis.com via fetch — no <script> tag, no global
//     window.google init. Component-scoped only.
//   - ZIP_FALLBACK — bundled static lookup table for ~25 demo metros,
//     used when zippopotam.us is offline or the ZIP isn't found there.
//     Embedders inherit this for free; no setup needed.
//
// Form-slice contract (defaults — match the refi-portal Housing screen):
//   form.zip       — 5-digit string
//   form.city      — string (auto-populated from ZIP, still editable)
//   form.state     — 2-letter string (auto-populated, uppercased on edit)
//   form.address   — street address string (NOTE: 'address', not
//                    'street_address' — verbatim original field name)
//   form.apt_suite — string, optional. Only rendered when showAptSuite
//                    is true. The refi monolith does not collect this
//                    today; the prop is forward-compat scaffolding.
//
// `update(patch)` shallow-merges into the form slice (matches useForm's
// contract used elsewhere in the apps).
//
// fieldNames override: embedders whose form is nested (e.g.
// `address.zip`, `address.city`) can pass `fieldNames` to remap reads
// and writes. AddressBlock will read the existing parent object on
// `form` and merge the new field into it before calling `update()`, so
// the embedder's shallow-merge update() doesn't clobber sibling fields
// (name/email/phone, etc.) that already live alongside the address on
// the same parent slice. Embedders no longer need a manual
// `updateContactSafe`-style wrapper for one-level dotted paths.
//   <AddressBlock
//     form={form}
//     update={update}
//     fieldNames={{ zip: 'address.zip', city: 'address.city',
//                   state: 'address.state', address: 'address.line1',
//                   apt_suite: 'address.line2' }}
//   />
// Dotted paths are supported (one level of nesting). Defaults are flat.

import { useEffect, useRef, useState } from "react";
import { Loader2, Check, MapPin } from "lucide-react";

// Google Places API key — mirrors the constant in the original
// monolith. Component-scoped: used only inside streetPredictionsFor().
// No global script tag, no window.google init.
const PLACES_API_KEY = "AIzaSyDm1wo_5vN-ioDQ3K1gB3zi42c0o0bSPhY";

// Static ZIP → city/state fallback table — covers major demo metros for
// offline use and ZIPs not in zippopotam.us. Inlined here so AddressBlock
// is self-contained when imported by sibling apps.
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

async function streetPredictionsFor(query, city, state, zip, locationBias) {
  if (!query || query.length < 3) return [];
  try {
    // Append ZIP to the input string when known so Google narrows
    // suggestions to that locality. City+state alone can match adjacent
    // metros with the same name.
    const localitySuffix = zip ? `${city}, ${state} ${zip}` : `${city}, ${state}`;
    const body = {
      input: `${query}, ${localitySuffix}`,
      includedPrimaryTypes: ["street_address", "premise", "subpremise"],
      includedRegionCodes: ["us"],
    };
    if (locationBias) body.locationBias = locationBias;
    const res = await fetch(
      "https://places.googleapis.com/v1/places:autocomplete",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": PLACES_API_KEY,
        },
        body: JSON.stringify(body),
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

// --- helpers (in-file copies of the validator/sanitizer used by the
// original monolith's address fields, kept local so AddressBlock has no
// monolith-internal imports). ---

function sanitizeNumeric(v) {
  if (v === null || v === undefined) return "";
  return String(v).replace(/[^0-9]/g, "");
}

function validateZip(v) {
  if (!v) return null;
  return /^\d{5}(-\d{4})?$/.test(String(v).trim()) ? null : "Enter a 5-digit ZIP code";
}

function validateState2(v) {
  if (!v) return null;
  return /^[A-Za-z]{2}$/.test(String(v).trim()) ? null : "Use the 2-letter state abbreviation";
}

// Read/write helpers with optional nested-path support (e.g. 'address.zip').
function readField(form, path) {
  if (!path) return undefined;
  if (!path.includes(".")) return form?.[path];
  const [head, tail] = path.split(".");
  return form?.[head]?.[tail];
}

// Build a patch for a single field write. For dotted paths
// (e.g. 'contact.zip') the helper merges the new field into the
// EXISTING parent object on `form` before returning the patch — so the
// embedder's shallow-merge update() doesn't clobber sibling fields
// (name/email/phone, etc.) that already live on form.contact.
//
// Why `form` is required: useForm's update() is a single-level shallow
// merge. Without reading the current parent first, a write of
// { contact: { zip: '30303' } } replaces form.contact wholesale. Pulling
// the existing siblings into the patch keeps the merge safe.
//
// Flat paths (no dot) keep the original behavior — return { path: value }.
// Multi-level paths (>1 dot) are out of scope — the existing contract
// only supports one-level nesting (per the file-header docstring).
function writePatch(form, path, value) {
  if (!path) return {};
  if (!path.includes(".")) return { [path]: value };
  const [head, tail] = path.split(".");
  return { [head]: { ...(form?.[head] || {}), [tail]: value } };
}

// Merge multiple writes for nested-path embedders (so we can update
// city + state in one call without clobbering the other).
function mergeWrites(form, fieldNames, updates) {
  // updates is { logicalKey: value }; produce a single patch.
  const patch = {};
  const nestedAcc = {};
  for (const [logicalKey, value] of Object.entries(updates)) {
    const path = fieldNames[logicalKey];
    if (!path) continue;
    if (!path.includes(".")) {
      patch[path] = value;
    } else {
      const [head, tail] = path.split(".");
      nestedAcc[head] = nestedAcc[head] || { ...(form?.[head] || {}) };
      nestedAcc[head][tail] = value;
    }
  }
  for (const [head, obj] of Object.entries(nestedAcc)) {
    patch[head] = obj;
  }
  return patch;
}

const DEFAULT_FIELD_NAMES = {
  zip: "zip",
  city: "city",
  state: "state",
  address: "address",
  apt_suite: "apt_suite",
};

/**
 * AddressBlock
 *
 * Reusable address sub-block. Render inside any screen that needs to
 * collect a US street address with ZIP-driven city/state autofill and
 * Google Places street autocomplete.
 *
 * @param {object}   props
 * @param {object}   props.form              Form slice (read).
 * @param {function} props.update            Shallow-merge update(patch).
 * @param {object}   [props.fieldNames]      Override default field names
 *                                           (defaults: { zip, city, state,
 *                                           address, apt_suite }). Dotted
 *                                           paths supported one level
 *                                           deep (e.g. 'address.zip').
 * @param {boolean}  [props.showAptSuite=false]  Render apt/suite line.
 *                                           Defaults false to match the
 *                                           refi-portal Housing screen
 *                                           (which doesn't collect it).
 * @param {function} [props.onZipResolved]   Fired with ({zip, city,
 *                                           state}) when a ZIP resolves
 *                                           to a city/state.
 * @param {function} [props.onAddressSelected]  Fired when a Places
 *                                           prediction is picked, with
 *                                           the prediction object.
 * @param {boolean}  [props.autoFocusZip=true]  Auto-focus the ZIP input
 *                                           on mount.
 * @param {object}   [props.locationBias]     Google Places "New" REST
 *                                           autocomplete locationBias
 *                                           (e.g. { circle: { center: {
 *                                           latitude, longitude }, radius
 *                                           }}). When passed, forwarded
 *                                           verbatim to the API call.
 *                                           ZIP is appended to the input
 *                                           string regardless — this is
 *                                           an additional bias on top.
 * @param {string}   [props.persona='consumer']    Persona context (forward-compat).
 * @param {boolean}  [props.personaLocked=false]   Persona switcher lock (forward-compat).
 */
export function AddressBlock({
  form,
  update,
  fieldNames: fieldNamesProp,
  showAptSuite = false,
  onZipResolved,
  onAddressSelected,
  autoFocusZip = true,
  locationBias,
  // Forward-compat scaffolding per the embed contract — accepted but
  // not yet branched on.
  // eslint-disable-next-line no-unused-vars
  persona = "consumer",
  // eslint-disable-next-line no-unused-vars
  personaLocked = false,
}) {
  const fieldNames = { ...DEFAULT_FIELD_NAMES, ...(fieldNamesProp || {}) };

  const zip = readField(form, fieldNames.zip) || "";
  const city = readField(form, fieldNames.city) || "";
  const state = readField(form, fieldNames.state) || "";
  const address = readField(form, fieldNames.address) || "";
  const aptSuite = readField(form, fieldNames.apt_suite) || "";

  const zipRef = useRef(null);
  const [streetQuery, setStreetQuery] = useState(address);
  const [streetOpen, setStreetOpen] = useState(false);
  const [zipNotFound, setZipNotFound] = useState(false);
  const [zipLoading, setZipLoading] = useState(false);
  const [streetPredictions, setStreetPredictions] = useState([]);
  const [streetLoading, setStreetLoading] = useState(false);
  const streetDebounce = useRef(null);

  // Focus ZIP on mount — ZIP drives city/state, city/state then unlock street autocomplete.
  useEffect(() => {
    if (autoFocusZip && zipRef.current) zipRef.current.focus();
  }, [autoFocusZip]);

  // When ZIP reaches 5 digits, look up city/state.
  useEffect(() => {
    let cancelled = false;
    if (zip && zip.length === 5) {
      setZipLoading(true);
      lookupZip(zip).then((hit) => {
        if (cancelled) return;
        setZipLoading(false);
        if (hit) {
          update(mergeWrites(form, fieldNames, { city: hit.city, state: hit.state }));
          setZipNotFound(false);
          if (onZipResolved) onZipResolved({ zip, city: hit.city, state: hit.state });
        } else {
          setZipNotFound(true);
        }
      });
    } else {
      setZipNotFound(false);
      setZipLoading(false);
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zip]);

  const zipReady = zip && zip.length === 5 && !validateZip(zip);
  const cityStateKnown = !!city && !!state;

  // Debounced street autocomplete — fires 300ms after user stops typing.
  useEffect(() => {
    if (streetDebounce.current) clearTimeout(streetDebounce.current);
    if (!zipReady || !cityStateKnown || !streetQuery || streetQuery.length < 3) {
      setStreetPredictions([]);
      return;
    }
    setStreetLoading(true);
    streetDebounce.current = setTimeout(() => {
      streetPredictionsFor(streetQuery, city, state, zip, locationBias).then((results) => {
        setStreetPredictions(results);
        setStreetLoading(false);
      });
    }, 300);
    return () => { if (streetDebounce.current) clearTimeout(streetDebounce.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streetQuery, zipReady, cityStateKnown]);

  function selectStreet(prediction) {
    const street = typeof prediction === "string" ? prediction : prediction.text;
    update(writePatch(form, fieldNames.address, street));
    setStreetQuery(street);
    setStreetOpen(false);
    setStreetPredictions([]);
    if (onAddressSelected) onAddressSelected(prediction);
  }

  const stateError = state ? validateState2(state) : null;
  const zipFormatError = zip ? validateZip(zip) : null;

  return (
    <>
      {/* ZIP first — drives city/state via zippopotam.us + Google Places fallback */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Zip code</label>
        <div className="relative">
          <input
            ref={zipRef}
            value={zip}
            onChange={(e) => update(writePatch(form, fieldNames.zip, sanitizeNumeric(e.target.value)))}
            inputMode="numeric"
            maxLength={5}
            placeholder="30305"
            className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          {zipLoading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-blue-500 text-xs font-semibold">
              <Loader2 className="w-3 h-3 animate-spin" /> Looking up...
            </div>
          )}
          {!zipLoading && zipReady && cityStateKnown && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-emerald-600 text-xs font-semibold">
              <Check className="w-3 h-3" /> Found
            </div>
          )}
        </div>
        {zipFormatError && (
          <div className="text-xs text-rose-600 mt-1">{zipFormatError}</div>
        )}
        {zipNotFound && (
          <div className="text-xs text-amber-600 mt-1">ZIP not in lookup — enter city and state manually below.</div>
        )}
      </div>

      {/* City / State — auto-populated from ZIP lookup, still editable */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wide">City</div>
          <div className="relative">
            <input
              type="text"
              value={city}
              onChange={(e) => update(writePatch(form, fieldNames.city, e.target.value))}
              placeholder="Auto-filled from ZIP"
              className="w-full border rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-1 border-slate-200 focus:border-blue-500 focus:ring-blue-500"
            />
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wide">State</div>
          <div className="relative">
            <input
              type="text"
              value={state}
              onChange={(e) => update(writePatch(form, fieldNames.state, String(e.target.value).toUpperCase()))}
              placeholder="Auto-filled"
              className={
                "w-full border rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-1 " +
                (stateError
                  ? "border-rose-300 focus:border-rose-500 focus:ring-rose-500"
                  : "border-slate-200 focus:border-blue-500 focus:ring-blue-500")
              }
            />
          </div>
          {stateError && (
            <div className="text-xs text-rose-600 mt-1">{stateError}</div>
          )}
        </div>
      </div>

      {/* Street address — autocomplete bound to the selected ZIP's locality */}
      <div className="relative">
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
          Street address
          {!zipReady && <span className="ml-2 normal-case text-slate-400 font-normal">Enter ZIP above first</span>}
        </label>
        <div className="relative">
          <input
            value={streetQuery}
            onChange={(e) => {
              setStreetQuery(e.target.value);
              update(writePatch(form, fieldNames.address, e.target.value));
              setStreetOpen(true);
            }}
            onFocus={() => setStreetOpen(true)}
            onBlur={() => setTimeout(() => setStreetOpen(false), 150)}
            disabled={!zipReady || !cityStateKnown}
            placeholder={zipReady ? "Start typing..." : ""}
            className="w-full px-3 py-2 pr-9 border border-slate-200 rounded-md text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400"
          />
          {streetLoading ? (
            <Loader2 className="w-4 h-4 text-blue-400 absolute right-3 top-1/2 -translate-y-1/2 animate-spin" />
          ) : (
            <MapPin className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
          )}
        </div>
        {streetOpen && zipReady && cityStateKnown && streetPredictions.length > 0 && (
          <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg overflow-hidden">
            {streetPredictions.map((s, idx) => (
              <button
                key={s.placeId || s.text || idx}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectStreet(s)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 border-b border-slate-100 last:border-b-0"
              >
                <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                <span className="flex-1">
                  <span className="font-medium">{s.text}</span>
                  {s.fullText && s.fullText !== s.text && (
                    <span className="text-slate-400 ml-1">{s.fullText.replace(s.text, "").replace(/^,\s*/, ", ")}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="text-[11px] text-slate-400 mt-1">
          Powered by Google Places Autocomplete
        </div>
      </div>

      {/* Apt / Suite — opt-in via showAptSuite. Refi-portal does not
          render this today; included for embedders that need it. */}
      {showAptSuite && (
        <div>
          <div className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wide">Apt / Suite (optional)</div>
          <input
            type="text"
            value={aptSuite}
            onChange={(e) => update(writePatch(form, fieldNames.apt_suite, e.target.value))}
            placeholder="Apt 4B"
            className="w-full border rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-1 border-slate-200 focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
      )}
    </>
  );
}
