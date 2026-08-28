// AddressBlock — reusable address-collection block (local to refinance-portal).
//
// Copied from blinker-platform/packages/components/AddressBlock.jsx so this
// app owns its address UX independently of blinker-platform. Trimmed to what
// the refi Housing screen actually uses (YAGNI): the platform copy's nested
// fieldNames / dotted-path remapping, locationBias, persona scaffolding, and
// onZipResolved/onAddressSelected callbacks are dropped here.
//
// ZIP/Google lookup logic is NOT re-inlined — it lives once in utils/api.ts
// (lookupZip → zippopotam.us → static table → Google geocode; and
// streetPredictionsFor → Google Places autocomplete). DRY: this component is
// pure UI over those functions.
//
// Form-slice contract:
//   form.zip       — 5-digit string
//   form.city      — auto-populated from ZIP, editable
//   form.state     — 2-letter, auto-populated, uppercased on edit
//   form.address   — street address string
//   form.apt_suite — optional, rendered only when showAptSuite

import { useEffect, useRef, useState } from 'react'
import { Loader2, Check, MapPin } from 'lucide-react'
import { lookupZip, streetPredictionsFor } from '../utils/api'
import type { StreetPrediction } from '../types'

interface AddressForm {
  zip: string
  city: string
  state: string
  address: string
  apt_suite: string
}

interface AddressBlockProps {
  form: AddressForm
  update: (patch: Partial<AddressForm>) => void
  showAptSuite?: boolean
  labels?: { address?: string; apt_suite?: string }
  autoFocusZip?: boolean
}

// --- local helpers (format checks only; ZIP/street resolution lives in
// utils/api.ts). Kept in-file so the component is self-contained. ---

function sanitizeNumeric(v: string): string {
  if (v === null || v === undefined) return ''
  return String(v).replace(/[^0-9]/g, '')
}

function validateZip(v: string): string | null {
  if (!v) return null
  return /^\d{5}(-\d{4})?$/.test(String(v).trim()) ? null : 'Enter a 5-digit ZIP code'
}

function validateState2(v: string): string | null {
  if (!v) return null
  return /^[A-Za-z]{2}$/.test(String(v).trim()) ? null : 'Use the 2-letter state abbreviation'
}

export function AddressBlock({
  form,
  update,
  showAptSuite = false,
  labels,
  autoFocusZip = true,
}: AddressBlockProps) {
  const zip = form.zip || ''
  const city = form.city || ''
  const state = form.state || ''
  const address = form.address || ''
  const aptSuite = form.apt_suite || ''

  const zipRef = useRef<HTMLInputElement>(null)
  const [streetQuery, setStreetQuery] = useState(address)
  const [streetOpen, setStreetOpen] = useState(false)
  const [zipNotFound, setZipNotFound] = useState(false)
  const [zipLoading, setZipLoading] = useState(false)
  const [streetPredictions, setStreetPredictions] = useState<StreetPrediction[]>([])
  const [streetLoading, setStreetLoading] = useState(false)
  const streetDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Focus ZIP on mount — ZIP drives city/state, which then unlock street autocomplete.
  useEffect(() => {
    if (autoFocusZip && zipRef.current) zipRef.current.focus()
  }, [autoFocusZip])

  // When ZIP reaches 5 digits, resolve city/state (zippopotam → static → Google).
  useEffect(() => {
    let cancelled = false
    if (zip && zip.length === 5) {
      setZipLoading(true)
      lookupZip(zip).then((hit) => {
        if (cancelled) return
        setZipLoading(false)
        if (hit) {
          update({ city: hit.city, state: hit.state })
          setZipNotFound(false)
        } else {
          // No source (zippopotam → static → Google) could resolve a
          // well-formed 5-digit ZIP → it's not a real US ZIP (e.g. 90000).
          // Clear any stale city/state from a prior valid ZIP so the Housing
          // gate (city+state required) blocks Next while the error shows.
          update({ city: '', state: '' })
          setZipNotFound(true)
        }
      })
    } else {
      setZipNotFound(false)
      setZipLoading(false)
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zip])

  const zipReady = !!zip && zip.length === 5 && !validateZip(zip)
  const cityStateKnown = !!city && !!state

  // Debounced street autocomplete — fires 300ms after the user stops typing.
  useEffect(() => {
    if (streetDebounce.current) clearTimeout(streetDebounce.current)
    if (!zipReady || !cityStateKnown || !streetQuery || streetQuery.length < 3) {
      setStreetPredictions([])
      return
    }
    setStreetLoading(true)
    streetDebounce.current = setTimeout(() => {
      streetPredictionsFor(streetQuery, city, state).then((results) => {
        setStreetPredictions(results)
        setStreetLoading(false)
      })
    }, 300)
    return () => {
      if (streetDebounce.current) clearTimeout(streetDebounce.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streetQuery, zipReady, cityStateKnown])

  function selectStreet(prediction: StreetPrediction) {
    const street = prediction.structured?.mainText || prediction.description
    update({ address: street })
    setStreetQuery(street)
    setStreetOpen(false)
    setStreetPredictions([])
  }

  const stateError = state ? validateState2(state) : null
  const zipFormatError = zip ? validateZip(zip) : null

  return (
    <>
      {/* ZIP first — drives city/state via zippopotam.us → static → Google */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
          Zip code
        </label>
        <div className="relative">
          <input
            ref={zipRef}
            value={zip}
            onChange={(e) => update({ zip: sanitizeNumeric(e.target.value) })}
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
        {zipFormatError && <div className="text-xs text-rose-600 mt-1">{zipFormatError}</div>}
        {zipNotFound && !cityStateKnown && (
          <div className="text-xs text-rose-600 mt-1">
            Not a valid US ZIP code.
          </div>
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
              onChange={(e) => update({ city: e.target.value })}
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
              onChange={(e) => update({ state: String(e.target.value).toUpperCase() })}
              placeholder="Auto-filled"
              className={
                'w-full border rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-1 ' +
                (stateError
                  ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500'
                  : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500')
              }
            />
          </div>
          {stateError && <div className="text-xs text-rose-600 mt-1">{stateError}</div>}
        </div>
      </div>

      {/* Street address — autocomplete bound to the selected ZIP's locality */}
      <div className="relative">
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
          {labels?.address || 'Street address'}
          {!zipReady && (
            <span className="ml-2 normal-case text-slate-400 font-normal">Enter ZIP above first</span>
          )}
        </label>
        <div className="relative">
          <input
            value={streetQuery}
            onChange={(e) => {
              setStreetQuery(e.target.value)
              update({ address: e.target.value })
              setStreetOpen(true)
            }}
            onFocus={() => setStreetOpen(true)}
            onBlur={() => setTimeout(() => setStreetOpen(false), 150)}
            // Unlocked once the ZIP is a valid 5 digits — NOT gated on a
            // successful city/state lookup. When the ZIP isn't in any lookup
            // source, the user fills city/state manually; the street field
            // must stay typeable so they can finish the address and Next can
            // enable. Autocomplete still only fires when city/state are known
            // (see the debounce effect); manual typing always works.
            disabled={!zipReady}
            placeholder={zipReady ? 'Start typing...' : ''}
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
            {streetPredictions.map((s, idx) => {
              const mainText = s.structured?.mainText || s.description
              const secondaryText = s.structured?.secondaryText
              return (
                <button
                  key={s.placeId || mainText || idx}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectStreet(s)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 border-b border-slate-100 last:border-b-0"
                >
                  <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className="flex-1">
                    <span className="font-medium">{mainText}</span>
                    {secondaryText && <span className="text-slate-400 ml-1">{secondaryText}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        )}
        <div className="text-[11px] text-slate-400 mt-1">Powered by Google Places Autocomplete</div>
      </div>

      {/* Apt / Suite — opt-in via showAptSuite */}
      {showAptSuite && (
        <div>
          <div className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wide">
            {labels?.apt_suite || 'Apt / Suite (optional)'}
          </div>
          <input
            type="text"
            value={aptSuite}
            onChange={(e) => update({ apt_suite: e.target.value })}
            placeholder="Apt 4B"
            className="w-full border rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-1 border-slate-200 focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
      )}
    </>
  )
}
