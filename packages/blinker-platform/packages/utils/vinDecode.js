// VIN decoder + YMMT match helper — Wave 17 P1 lift.
//
// Source convergence:
//   - refi-portal/src/refinance-v2-prototype.jsx:560-604 (fetchVinDecode +
//     _ymmtMatch, original implementation).
//   - protection-portal/src/lib/vinDecode.js (re-export of the same pair,
//     with the only diff being a defensive `String(target)` wrap inside
//     ymmtMatch — adopted here as it's a strict superset).
//
// Returns from fetchVinDecode:
//   { year:int|null, make:string, model:string, trim:string, type:string,
//     engine:string, drivetrain:string, raw:object, error:string|null }
// (`error` is set IFF the call failed; in that case the other fields are
// absent — callers branch on `result.error` first.)
//
// ymmtMatch: case-insensitive + partial best-match against a list of
// canonical YMMT_DATA keys. Returns the canonical key or null.
//
// Phase 2 dispatch (Wave 17 P2): protection-portal/src/lib/vinDecode.js +
// the inline pair in refi-portal's monolith are deleted; their callers
// re-import from this file via 'blinker-platform/utils'.

const VINAUDIT_API_KEY = '2S1SZI7HUF89L6Z';

export async function fetchVinDecode(vin) {
  if (!vin || vin.length !== 17) return { error: 'Invalid VIN' };
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
      error: null,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[VIN Decode] Failed:', err.message);
    return { error: `VIN decode failed: ${err.message}` };
  }
}

// Case-insensitive best-match helper for YMMT lookups.
// Returns the exact YMMT_DATA key that matches, or null. Order:
//   1. exact case match
//   2. case-insensitive equality
//   3. either side is a prefix of the other (partial)
export function ymmtMatch(candidates, target) {
  if (!target || !candidates) return null;
  const lower = String(target).toLowerCase();
  const exact = candidates.find((c) => c === target);
  if (exact) return exact;
  const ci = candidates.find((c) => c.toLowerCase() === lower);
  if (ci) return ci;
  const partial = candidates.find(
    (c) => c.toLowerCase().startsWith(lower) || lower.startsWith(c.toLowerCase()),
  );
  return partial || null;
}
