// RelationshipPicker — workflow-agnostic relationship picker.
//
// Lifted from refi-portal/src/refinance-v2-prototype.jsx ScreenCoAppContact
// (the 2-col button grid around line 2596). The original RELATIONSHIP_OPTIONS
// constant lived inline at line 79 as a flat string array. Wave 19 Task 5
// promotes the *pattern* into a clean, embed-friendly component and the
// option list into canon (canon/relationships.json `system_types`).
//
// Wave 15c trio precedent: AddressBlock + NotesPanel + TagPicker — same
// dep direction and same "accept canon-driven inventory as a prop, with a
// canon read as a convenience default" model. See architecture/11.
//
// Public surface: exposed via packages/components/index.js. Importing
// directly from this file path is blocked by the root package.json
// `exports` map.
//
// Consumers (Wave 19 Task 5):
//   - mission-control ContactProfile household-add UI (primary)
//   - (future) insurance-portal co-applicant flow
//   - (future) refi-portal monolith retrofit — separate follow-up wave
//
// Form-slice contract: parent-owned controlled value. The component is
// pure aside from a single useState for the "Other" free-text input
// (only shown when `allowOther` AND the active option is `'other'`).
//
// Canon dependency: when `options` is omitted, the component reads
// `../../canon/relationships.json` directly (`system_types` only — the
// `custom_types_per_org` split is forward-compat, see canon `_TODO`).
// Per ADR 11 packages MAY read canon directly. For embedders that want
// a per-org or curated subset, pass `options` explicitly — that's the
// primary path; the canon default is a convenience for callers that
// don't want to thread anything.
//
// Verified component signature:
//
//   export function RelationshipPicker({
//     value,             // string id (e.g. 'spouse') | null
//     onChange,          // (id: string) => void
//     otherText,         // string — free-text when value === 'other' and
//                        //   allowOther
//     onOtherTextChange, // (next: string) => void   (optional; only used
//                        //   when allowOther + value==='other')
//     options,           // Option[] | string[] | undefined — when omitted
//                        //   the component reads canon/relationships.json
//                        //   `system_types`. Each option may be:
//                        //     { id: string, label: string,
//                        //       category?: string }
//                        //   OR a flat string (Wave 20 backward-compat for
//                        //   refi-portal RELATIONSHIP_OPTIONS). Strings are
//                        //   coerced to records: id = label.lower().replace(
//                        //   /\s+/g, '_'). "Domestic Partner" → id
//                        //   "domestic_partner". Embedders mixing both
//                        //   shapes is supported but discouraged.
//     allowOther = true, // when false, the 'other' option is filtered
//                        //   out and the free-text input never renders
//     label = 'Relationship',
//     persona = 'agent',
//     personaLocked = false,
//   })
//
// Embed contract notes:
//   - The component renders a labeled 2-column button grid identical to
//     the refi monolith's CoAppContact pattern. Active option uses the
//     trio's standard blue-50/blue-700 ring; inactive uses slate-200.
//   - Compact (no surrounding card chrome). Embedders provide their own
//     layout shell (e.g. `<div className="px-6 space-y-3">`).
//   - `value` may be null/undefined initially; the picker just renders
//     no active state. `onChange` fires with the option id (a slug like
//     'spouse', 'domestic_partner') — NOT the label.
//   - "Other" free-text: when `allowOther` (default true) AND value is
//     `'other'` the component shows a small Field-style input below the
//     grid. The text value is parent-owned via `otherText` /
//     `onOtherTextChange` so it can be persisted alongside the slug.
//   - Empty grid (zero options) renders nothing — defensive guard so
//     a bad embedder prop doesn't crash.

import { useMemo } from 'react';
import canonRelationships from '../../canon/relationships.json';

const DEFAULT_OPTIONS = canonRelationships.system_types || [];

// Wave 20: backward-compat shape coercion. Refi-portal's monolith has carried
// RELATIONSHIP_OPTIONS as a flat `string[]` since Wave 6 (e.g.
// `["Spouse", "Child", ..., "Other"]`); other callers use the canonical
// record shape `{ id, label, category? }`. Accept BOTH so the refi retrofit
// can pass its existing const without a shim at the call site, while
// records-callers (mc householding) continue to work unchanged.
//
// Slug derivation for string entries: lowercase, replace whitespace with `_`.
// "Spouse" → "spouse", "Domestic Partner" → "domestic_partner", "Other" →
// "other" — matches canon `system_types` ids exactly for the overlapping
// labels, so an embedder migrating from string[] to records preserves the
// same `value` payload across the cut.
function coerceOption(o) {
  if (typeof o === 'string') {
    const id = o.toLowerCase().replace(/\s+/g, '_');
    return { id, label: o };
  }
  return o;
}

export function RelationshipPicker({
  value,
  onChange,
  otherText = '',
  onOtherTextChange,
  options,
  allowOther = true,
  label = 'Relationship',
  // eslint-disable-next-line no-unused-vars
  persona = 'agent',
  // eslint-disable-next-line no-unused-vars
  personaLocked = false,
}) {
  // Canon-default when no options prop. Defensive copy + coerce string[] to
  // record[] (Wave 20 compat). Filter `other` when allowOther=false.
  const effectiveOptions = useMemo(() => {
    const src = Array.isArray(options) && options.length > 0 ? options : DEFAULT_OPTIONS;
    const coerced = src.map(coerceOption);
    if (allowOther) return coerced;
    return coerced.filter((o) => o.id !== 'other');
  }, [options, allowOther]);

  if (!effectiveOptions.length) return null;

  const showOtherInput = allowOther && value === 'other';

  return (
    <div>
      {label && (
        <div className="text-xs text-slate-500 mb-2 font-semibold uppercase tracking-wide">
          {label}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {effectiveOptions.map((o) => {
          const active = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                if (typeof onChange === 'function') onChange(o.id);
                // Clear any stale "other" free-text when switching away
                // from 'other'. Done via onOtherTextChange so the parent
                // stays the source of truth.
                if (o.id !== 'other' && otherText && typeof onOtherTextChange === 'function') {
                  onOtherTextChange('');
                }
              }}
              className={
                'py-2 px-3 rounded-md border text-sm font-medium transition-colors ' +
                (active
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-slate-200 hover:border-slate-300 text-slate-700')
              }
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {showOtherInput && (
        <div className="mt-3">
          <label className="block text-xs text-slate-500 mb-1">Please specify</label>
          <input
            type="text"
            value={otherText}
            onChange={(e) =>
              typeof onOtherTextChange === 'function'
                ? onOtherTextChange(e.target.value)
                : null
            }
            placeholder="e.g. Friend, Coworker"
            className="w-full text-sm border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}
    </div>
  );
}

export default RelationshipPicker;
