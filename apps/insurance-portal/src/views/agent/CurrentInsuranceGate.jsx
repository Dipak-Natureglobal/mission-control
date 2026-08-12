// Agent-side "Current insurance" gate — Wave 36 v3.0.14 (ADR 26 D3).
// Wave 36-fu3: per-cadence slider bounds from premium_slider.by_cadence.
//
// New pre-LeadOriginationForm step 3, inserted into AgentView's gate
// sequence AFTER the VehicleDrive (mileage) gate and BEFORE the
// LeadOriginationForm ("Confirm your contact details"). Shown ONLY when
// the active opp's flow path is `quote_only` — the quote-only path skips
// EI's policy capture, so EI never returns a savings comparison. This
// step collects the customer's self-reported current carrier + premium
// so the savings math (ADR 26 D4) has a baseline to beat.
//
// Capture+quote keeps its existing two-gate sequence — EI's capture step
// surfaces the current carrier there. Capture+quote adopting this step is
// a deliberate future option, explicitly out of v3.0.14 scope.
//
// Collects:
//   - Current carrier   — searchable autocomplete over
//                         canon/insurance-carriers.json `carriers[]`.
//                         `other` / `not_sure` are valid picks.
//   - Current premium   — slider bounded by canon `premium_slider.by_cadence`
//                         (monthly $50-$1,500 / 6mo $300-$5,000 / 12mo
//                         $600-$5,000; $10 step). Bounds update when the
//                         cadence toggle changes; value is clamped into the
//                         new range. Value is a raw dollar amount (stored as
//                         cents); the cadence toggle tells consumers how to
//                         normalize it.
//   - Cadence toggle    — monthly | 6mo | 12mo.
//
// On continue writes to the workflow root via updateWorkflow:
//   { currentCarrier, currentCarrierId, currentPremiumCents, premiumCadence }
//
// Telemetry:
//   insurance.agent.current_insurance.viewed     — on mount
//   insurance.agent.current_insurance.submitted  — on continue,
//     { carrier_id, premium_cents, cadence }
import { useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, Search, Check, ChevronRight, DollarSign } from 'lucide-react';
import { captureEvent } from 'blinker-platform/telemetry';
import carriersCanon from '../../constants/canon/insurance-carriers.json';

// ----------------------------------------------------------------------
// Canon-derived constants. Read once at module load — the carrier list
// + slider bounds + average premium are static canon.

// Dedupe carriers by `id` — the source workbook seeds a couple of
// catch-all rows twice (`not_sure` notably). First occurrence wins so
// the autocomplete never shows a duplicate option.
const CARRIERS = (() => {
  const seen = new Set();
  const out = [];
  for (const c of carriersCanon.carriers || []) {
    if (!c?.id || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
})();

// Defensive fallback: if by_cadence is missing for a key, use the 6mo entry.
const SLIDER_STEP_CENTS = carriersCanon.premium_slider?.step_cents ?? 1000;
const SLIDER_BY_CADENCE = carriersCanon.premium_slider?.by_cadence ?? {
  monthly: { min_cents: 5000, max_cents: 150000 },
  '6mo': { min_cents: 30000, max_cents: 500000 },
  '12mo': { min_cents: 60000, max_cents: 500000 },
};

// Return the {min_cents, max_cents} for the given cadence key. Falls back
// to the '6mo' entry if the cadence key is somehow absent.
function sliderRangeForCadence(cadence) {
  return SLIDER_BY_CADENCE[cadence] ?? SLIDER_BY_CADENCE['6mo'];
}
// US 6-month average premium — single source. Monthly / annual are
// derived (÷6 / ×2) so all three cadences trace back to one canon value.
const SIX_MO_AVG_CENTS = carriersCanon.average_premium?.six_month_cents ?? 150000;

const CADENCES = [
  { v: 'monthly', l: 'Monthly' },
  { v: '6mo', l: 'Every 6 months' },
  { v: '12mo', l: 'Yearly' },
];

// Cadence-appropriate average, derived from the 6-month canon figure.
function averageForCadence(cadence) {
  if (cadence === 'monthly') return Math.round(SIX_MO_AVG_CENTS / 6);
  if (cadence === '12mo') return SIX_MO_AVG_CENTS * 2;
  return SIX_MO_AVG_CENTS; // 6mo
}

function fmtUSD(cents) {
  return '$' + Math.round((cents || 0) / 100).toLocaleString('en-US');
}

function cadenceSuffix(cadence) {
  return cadence === 'monthly' ? '/mo' : cadence === '12mo' ? '/yr' : '/6mo';
}

export function CurrentInsuranceGate({
  updateWorkflow,
  persona = 'agent',
  onNext,
  // Seed values when the agent navigates back into this step. Optional.
  initialCarrierId = null,
  initialPremiumCents = null,
  initialCadence = '6mo',
}) {
  const [cadence, setCadence] = useState(initialCadence || '6mo');
  // Premium value (cents). Defaults to the cadence-appropriate average so
  // the slider lands on a sensible spot before the agent touches it.
  const [premiumCents, setPremiumCents] = useState(
    initialPremiumCents ?? averageForCadence(initialCadence || '6mo'),
  );
  // Whether the agent has explicitly moved the slider. Until they do, a
  // cadence switch re-snaps the premium to that cadence's average.
  const premiumTouched = useRef(initialPremiumCents != null);

  const [carrierId, setCarrierId] = useState(initialCarrierId);
  const [query, setQuery] = useState(() => {
    if (!initialCarrierId) return '';
    return CARRIERS.find((c) => c.id === initialCarrierId)?.displayName || '';
  });
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  // Telemetry — viewed-once on mount.
  const viewedRef = useRef(false);
  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    captureEvent('insurance.agent.current_insurance.viewed', { persona });
  }, [persona]);

  // Close the autocomplete dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Filtered carrier list — case-insensitive substring over displayName.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CARRIERS;
    return CARRIERS.filter((c) => c.displayName.toLowerCase().includes(q));
  }, [query]);

  const selectedCarrier = carrierId
    ? CARRIERS.find((c) => c.id === carrierId) || null
    : null;

  function pickCarrier(c) {
    setCarrierId(c.id);
    setQuery(c.displayName);
    setOpen(false);
  }

  function onCadenceChange(next) {
    setCadence(next);
    const { min_cents, max_cents } = sliderRangeForCadence(next);
    if (!premiumTouched.current) {
      // Re-snap to the new cadence's average until the agent has explicitly
      // moved the slider — prevents a $250 "monthly" value persisting into
      // "yearly" and reading as nonsense. The average always falls inside the
      // cadence's range, so no clamping is needed here.
      setPremiumCents(averageForCadence(next));
    } else {
      // Agent has touched the slider: keep their value but clamp it into the
      // new cadence's valid range. Example: $80/mo (8000¢) switches to 12mo
      // (min $600 = 60000¢) → clamps up to 60000¢.
      setPremiumCents((prev) => Math.min(Math.max(prev, min_cents), max_cents));
    }
  }

  function onSlide(e) {
    premiumTouched.current = true;
    setPremiumCents(Number(e.target.value));
  }

  const canContinue = Boolean(carrierId);

  function onContinue() {
    if (!canContinue) return;
    captureEvent('insurance.agent.current_insurance.submitted', {
      carrier_id: carrierId,
      premium_cents: premiumCents,
      cadence,
    });
    updateWorkflow({
      currentCarrier: selectedCarrier?.displayName ?? null,
      currentCarrierId: carrierId,
      currentPremiumCents: premiumCents,
      premiumCadence: cadence,
    });
    onNext?.();
  }

  const avgCents = averageForCadence(cadence);
  const { min_cents: sliderMin, max_cents: sliderMax } = sliderRangeForCadence(cadence);

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      {/* Header — mirrors LeadOriginationForm's eyebrow + h2 shape. */}
      <div className="px-6 pt-5 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2 text-emerald-600 mb-2">
          <ShieldCheck className="w-4 h-4" />
          <span className="text-xs uppercase tracking-wide font-semibold">
            Insurance · Find savings
          </span>
        </div>
        <h2 className="text-xl font-semibold tracking-tight">Current insurance</h2>
        <p className="text-sm text-slate-500 mt-1">
          Ask the customer who they're insured with today and roughly what
          they pay. We use this to estimate how much they could save.
        </p>
      </div>

      <div className="px-6 py-5 space-y-5">
        {/* Current carrier — searchable autocomplete. */}
        <div ref={boxRef} className="relative">
          <label className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1 block">
            Current carrier
          </label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              placeholder="Search insurance companies…"
              onChange={(e) => {
                setQuery(e.target.value);
                setCarrierId(null);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
            />
            {selectedCarrier && !open && (
              <Check className="w-4 h-4 text-emerald-500 absolute right-3 top-1/2 -translate-y-1/2" />
            )}
          </div>
          {open && (
            <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-md shadow-lg">
              {matches.length === 0 ? (
                <div className="px-3 py-2 text-xs text-slate-500">
                  No carriers match — pick "Other / Not listed" below.
                </div>
              ) : (
                matches.map((c) => {
                  const active = c.id === carrierId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => pickCarrier(c)}
                      className={
                        'w-full text-left px-3 py-2 text-sm flex items-center justify-between ' +
                        (active
                          ? 'bg-blue-50 text-blue-700'
                          : 'hover:bg-slate-50 text-slate-700')
                      }
                    >
                      <span>{c.displayName}</span>
                      {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          )}
          <p className="text-[11px] text-slate-500 mt-1 leading-snug">
            Not sure? Pick "Not sure" — it still counts.
          </p>
        </div>

        {/* Cadence toggle. */}
        <div>
          <label className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1 block">
            How do they pay?
          </label>
          <div className="grid grid-cols-3 gap-2">
            {CADENCES.map((c) => {
              const active = cadence === c.v;
              return (
                <button
                  key={c.v}
                  type="button"
                  onClick={() => onCadenceChange(c.v)}
                  className={
                    'px-3 py-2 rounded-md border text-xs font-semibold transition ' +
                    (active
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700')
                  }
                >
                  {c.l}
                </button>
              );
            })}
          </div>
        </div>

        {/* Current premium — slider. */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold flex items-center gap-1">
              <DollarSign className="w-3 h-3" /> Current premium
            </label>
            <span className="text-sm font-semibold text-slate-800">
              {fmtUSD(premiumCents)}
              <span className="text-xs font-normal text-slate-500">
                {cadenceSuffix(cadence)}
              </span>
            </span>
          </div>
          <input
            type="range"
            min={sliderMin}
            max={sliderMax}
            step={SLIDER_STEP_CENTS}
            value={premiumCents}
            onChange={onSlide}
            className="w-full accent-blue-600 cursor-pointer"
          />
          <div className="flex items-center justify-between text-[10px] text-slate-400 mt-0.5">
            <span>{fmtUSD(sliderMin)}</span>
            <span>{fmtUSD(sliderMax)}</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">
            Typical driver pays about{' '}
            <span className="font-semibold text-slate-600">
              {fmtUSD(avgCents)}
              {cadenceSuffix(cadence)}
            </span>
            .
          </p>
        </div>
      </div>

      <div className="px-6 pb-5 pt-4 border-t border-slate-100">
        <button
          onClick={onContinue}
          disabled={!canContinue}
          className={
            'w-full px-5 py-2 rounded-md font-semibold text-sm flex items-center justify-center gap-2 ' +
            (canContinue
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed')
          }
        >
          Continue
          <ChevronRight className="w-4 h-4" />
        </button>
        {!canContinue && (
          <p className="text-[11px] text-slate-500 mt-2 text-center">
            Pick the customer's current carrier to continue.
          </p>
        )}
      </div>
    </div>
  );
}

export default CurrentInsuranceGate;
