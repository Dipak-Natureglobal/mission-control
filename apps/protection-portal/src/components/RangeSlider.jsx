// Discrete two-thumb range slider. Hand-rolled to match the existing
// Customize "Stepper" pill family — no external dependency.
//
// Each thumb maps to an INDEX into the discrete `options` array, so it
// snaps to whatever values StoneEagle returned (e.g. miles =
// [36000, 48000, 50000, 60000, 75000, 100000]). The visible track is
// continuous; thumbs snap on input change.
//
// Layout: two stacked <input type="range"> elements absolutely
// positioned over a styled track. The lower thumb steers the min, the
// upper steers the max. Crossover is enforced by clamping each thumb
// against the other's index.
//
// Props:
//   label        — short heading (e.g. 'Coverage period')
//   unit         — appended to the displayed value ('months' / 'miles')
//   options      — sorted-asc array of discrete values; the slider snaps
//                  to one of these. Empty array hides the slider.
//   value        — [minValue, maxValue]; auto-snapped to nearest entries.
//   onChange     — (nextRange) => void; fires only when the snapped index
//                  actually changes. Always emits [low, high] with
//                  low <= high.
//   formatValue  — (v) => string; defaults to String(v).
//
// Wave 22 Task 5 — built for protection-portal Customize step.

import { useMemo } from 'react';

function nearestIndex(options, value) {
  if (!options.length) return 0;
  let best = 0;
  let bestDiff = Math.abs(options[0] - value);
  for (let i = 1; i < options.length; i += 1) {
    const d = Math.abs(options[i] - value);
    if (d < bestDiff) {
      best = i;
      bestDiff = d;
    }
  }
  return best;
}

export function RangeSlider({
  label,
  unit = '',
  options,
  value,
  onChange,
  formatValue,
}) {
  const fmt = formatValue || ((v) => String(v));
  const sorted = useMemo(() => [...(options || [])].sort((a, b) => a - b), [options]);

  if (sorted.length === 0) return null;

  // Normalize incoming value pair to a [loIdx, hiIdx] within options.
  const incomingLo = Array.isArray(value) ? value[0] : sorted[0];
  const incomingHi = Array.isArray(value) ? value[1] : sorted[sorted.length - 1];
  let loIdx = nearestIndex(sorted, incomingLo ?? sorted[0]);
  let hiIdx = nearestIndex(sorted, incomingHi ?? sorted[sorted.length - 1]);
  if (loIdx > hiIdx) [loIdx, hiIdx] = [hiIdx, loIdx];

  const loValue = sorted[loIdx];
  const hiValue = sorted[hiIdx];

  function commit(nextLo, nextHi) {
    let l = nextLo;
    let h = nextHi;
    if (l > h) [l, h] = [h, l];
    const lv = sorted[l];
    const hv = sorted[h];
    if (lv === loValue && hv === hiValue) return;
    onChange?.([lv, hv]);
  }

  function setLo(idx) {
    const clamped = Math.min(idx, hiIdx);
    commit(clamped, hiIdx);
  }
  function setHi(idx) {
    const clamped = Math.max(idx, loIdx);
    commit(loIdx, clamped);
  }

  const max = sorted.length - 1;
  // Filled bar between the two thumbs.
  const leftPct = max === 0 ? 0 : (loIdx / max) * 100;
  const rightPct = max === 0 ? 100 : (hiIdx / max) * 100;

  // Single-value edge case — collapse to one slider when only one option exists.
  const singleOption = sorted.length === 1;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <span className="text-sm font-semibold text-slate-900">
          {fmt(loValue)}{loValue !== hiValue ? ` – ${fmt(hiValue)}` : ''}{unit ? ` ${unit}` : ''}
        </span>
      </div>

      {singleOption ? (
        <div className="text-xs text-slate-500 px-1 py-2">
          Only one option available: <span className="font-medium text-slate-700">{fmt(sorted[0])}{unit ? ` ${unit}` : ''}</span>
        </div>
      ) : (
        <div className="relative h-9 select-none">
          {/* Track */}
          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-slate-200" />
          {/* Filled segment */}
          <div
            className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-blue-500"
            style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }}
          />
          {/* Lower thumb input — z-20 when at the right edge so the upper
              thumb stays grabbable; otherwise z-10. */}
          <input
            type="range"
            min={0}
            max={max}
            step={1}
            value={loIdx}
            onChange={(e) => setLo(Number(e.target.value))}
            aria-label={`${label} minimum`}
            className={
              'rs-thumb absolute inset-0 w-full h-full appearance-none bg-transparent pointer-events-none ' +
              (loIdx >= max ? 'z-20' : 'z-10')
            }
          />
          {/* Upper thumb input */}
          <input
            type="range"
            min={0}
            max={max}
            step={1}
            value={hiIdx}
            onChange={(e) => setHi(Number(e.target.value))}
            aria-label={`${label} maximum`}
            className="rs-thumb absolute inset-0 w-full h-full appearance-none bg-transparent pointer-events-none z-20"
          />
          {/* Tick labels (min / max only — keeps it readable) */}
          <div className="absolute left-0 right-0 top-full mt-1 flex justify-between text-[10px] text-slate-400">
            <span>{fmt(sorted[0])}{unit ? ` ${unit}` : ''}</span>
            <span>{fmt(sorted[max])}{unit ? ` ${unit}` : ''}</span>
          </div>
        </div>
      )}

      {/* Native range thumb styling — pointer-events forced on the thumb
          so the surrounding input can stay pointer-events-none (lets us
          stack two inputs on the same track without one stealing all
          drag events). */}
      <style>{`
        .rs-thumb::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 9999px;
          background: #2563eb;
          border: 2px solid #ffffff;
          box-shadow: 0 1px 2px rgba(15,23,42,0.2);
          cursor: pointer;
          pointer-events: auto;
        }
        .rs-thumb::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 9999px;
          background: #2563eb;
          border: 2px solid #ffffff;
          box-shadow: 0 1px 2px rgba(15,23,42,0.2);
          cursor: pointer;
          pointer-events: auto;
        }
        .rs-thumb::-webkit-slider-runnable-track,
        .rs-thumb::-moz-range-track {
          background: transparent;
        }
      `}</style>
    </div>
  );
}
