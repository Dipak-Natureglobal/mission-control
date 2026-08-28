// Home optional-coverage (add-on) parser + resolver — ADR 30 D5 / D7.
//
// OMEGA returns home add-ons as <Option> rows whose OptionDesc encodes BOTH
// the coverage category and the term, in inconsistent spellings:
//
//   "Plumbing system 3yr"            → internal_plumbing,       36mo, standard
//   "AddlACunit2yr(plus/enhanced)"   → additional_ac,           24mo, pe
//   "SEPTIC1yr"                      → septic,                  12mo, standard
//   "Secondrefrigerator2yr"          → secondary_refrigerator,  24mo, standard
//
// Two filters then decide what a customer may actually buy:
//
//   1. TERM    — only options whose term equals the SELECTED plan term.
//                Internal plumbing is $57 at 12mo but $152 at 36mo.
//   2. VARIANT — plan 35 (Deluxe) takes standard rows; plans 36/37 (Deluxe
//                Plus / Enhanced) take the Plus/Enhanced rows. Plans 38/48/49
//                (month-to-month) carry no options at all.
//
// The rater returns BOTH variants under the same term-plan rate records, so
// rendering every <Option> returned would offer the customer the wrong price.
// Selection is by (canonical_key, term, variant) — never by position.
//
// Unrecognised descriptions return null. Never guess a category: a wrong guess
// ticks the wrong coverage checkbox on a SIGNED agreement.
//
// Prices are never stored in canon (ADR 30 R6) — they come from the response.

const PE_FALLBACK_MARKERS = ['(p/e)', '(plus/enhanced)'];

function normalize(s) {
  return String(s ?? '').toLowerCase().replace(/[\s_-]+/g, '');
}

function requireCanon(canonBlock) {
  if (!canonBlock || !Array.isArray(canonBlock.categories)) {
    throw new Error('home-addons: canonBlock is required (pass plan-mappings.json#home_add_ons)');
  }
}

// Aliases are matched LONGEST-FIRST so a short alias ('spa') can never shadow a
// longer, more specific one that also matches the same description. Built once
// per canon object rather than per call.
const aliasCache = new WeakMap();
function aliasIndex(canonBlock) {
  const cached = aliasCache.get(canonBlock);
  if (cached) return cached;
  const rows = [];
  for (const cat of canonBlock.categories) {
    for (const alias of cat.match_aliases || []) {
      rows.push({ norm: normalize(alias), cat });
    }
  }
  rows.sort((a, b) => b.norm.length - a.norm.length);
  aliasCache.set(canonBlock, rows);
  return rows;
}

/**
 * @param {string} desc        raw OptionDesc from the rater
 * @param {object} canonBlock  canon/plan-mappings.json#home_add_ons
 * @returns {{ canonical_key: string, term_months: number, variant: 'standard'|'pe', raw: string } | null}
 */
export function parseOptionDesc(desc, canonBlock) {
  requireCanon(canonBlock);
  const raw = String(desc ?? '');
  if (!raw.trim()) return null;

  const lower = raw.toLowerCase();
  const norm = normalize(raw);

  // Term — the suffix map is canon-driven ('1yr' → 12 … '4yr' → 48).
  const suffixMap = canonBlock.term_suffix_months || {};
  let termMonths = null;
  for (const [suffix, months] of Object.entries(suffixMap)) {
    if (norm.includes(normalize(suffix))) { termMonths = Number(months); break; }
  }
  if (!Number.isFinite(termMonths)) return null;

  // Variant.
  const markers = Array.isArray(canonBlock.pe_markers) && canonBlock.pe_markers.length
    ? canonBlock.pe_markers
    : PE_FALLBACK_MARKERS;
  const variant = markers.some(
    (m) => lower.includes(String(m).toLowerCase()) || norm.includes(normalize(m)),
  ) ? 'pe' : 'standard';

  // Category — longest alias wins.
  const hit = aliasIndex(canonBlock).find((row) => norm.includes(row.norm));
  if (!hit) return null;

  return { canonical_key: hit.cat.key, term_months: termMonths, variant, raw };
}

/**
 * Resolve the add-ons a customer may buy for one plan at one term.
 *
 * @param {object} args
 * @param {Array}  args.options      normalized <Option> rows: { OptionId, OptionDesc, RetailRate }
 * @param {string|number} args.planCode
 * @param {number} args.termMonths   the SELECTED plan term
 * @param {object} args.canonBlock
 * @returns {Array<{ key, label, option_id, price, docuseal_field, variant }>}
 */
export function resolveHomeAddOns({ options, planCode, termMonths, canonBlock }) {
  requireCanon(canonBlock);
  if (!Array.isArray(options) || options.length === 0) return [];

  const rule = canonBlock.plan_variant_rule || {};
  const allowedVariant = rule[String(planCode)];
  // null  → month-to-month plan, no options.
  // undefined → unknown plan code; refuse rather than defaulting to a variant
  //             that may be mispriced for this coverage level.
  if (!allowedVariant || typeof allowedVariant !== 'string') return [];

  const term = Number(termMonths);
  if (!Number.isFinite(term)) return [];

  const byKey = new Map(canonBlock.categories.map((c) => [c.key, c]));
  const out = [];
  const seen = new Set();

  for (const opt of options) {
    const parsed = parseOptionDesc(opt?.OptionDesc ?? opt?.name, canonBlock);
    if (!parsed) continue;
    if (parsed.term_months !== term) continue;
    if (parsed.variant !== allowedVariant) continue;
    if (seen.has(parsed.canonical_key)) continue;

    const price = Number(opt?.RetailRate ?? opt?.price ?? opt?.price_delta);
    // A row we cannot price is dropped, never surfaced at $0 — a free add-on
    // the customer did not actually get for free is a chargeback.
    if (!Number.isFinite(price)) continue;

    const cat = byKey.get(parsed.canonical_key);
    seen.add(parsed.canonical_key);
    out.push({
      key:            parsed.canonical_key,
      label:          cat?.label ?? parsed.canonical_key,
      option_id:      opt?.OptionId ?? opt?.id ?? null,
      price,
      docuseal_field: cat?.docuseal_field ?? null,
      variant:        parsed.variant,
    });
  }

  return out;
}

/**
 * @param {Array<{ price: number }>|null} selected
 * @returns {number} dollars
 */
export function sumAddOnPrices(selected) {
  if (!Array.isArray(selected)) return 0;
  return selected.reduce((sum, a) => sum + (Number(a?.price) || 0), 0);
}

/**
 * Re-resolve prior selections against a freshly computed available set.
 *
 * ADR 30 D7: changing plan or term changes BOTH the OptionId and the price, so
 * a stale selection carried forward would charge the wrong amount against a
 * signed agreement. Selections are matched by canonical key and rewritten
 * wholesale from the available row; anything no longer offered is dropped and
 * reported so the UI can say what it removed.
 *
 * @param {object} args
 * @param {Array}  args.selected   prior selections (need only carry `key`)
 * @param {Array}  args.available  resolveHomeAddOns output for the NEW plan/term
 * @returns {{ kept: Array, dropped: Array }}
 */
export function revalidateSelections({ selected, available }) {
  const avail = new Map((available || []).map((a) => [a.key, a]));
  const kept = [];
  const dropped = [];
  for (const sel of selected || []) {
    const fresh = avail.get(sel?.key);
    if (fresh) kept.push({ ...fresh });
    else dropped.push(sel);
  }
  return { kept, dropped };
}

export default resolveHomeAddOns;
