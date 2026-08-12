// MarketCheck — mocked client for the prototype.
//
// Real API: https://apidocs.marketcheck.com (server-to-server, no CORS;
// requires API key + entitlement). Refi-portal's monolith already
// integrates the real endpoint when running standalone, but for the
// protection-portal prototype we want a deterministic stand-in that
// works in any sandbox without keys or network access.
//
// Contract:
//   getVehicleValue({ vin?, year, make, model, trim?, mileage? })
//     → Promise<{
//         retail_value: number,
//         trade_in_value: number,
//         fetched_at: string (ISO 8601),
//         source: 'MarketCheck (mocked)',
//       }>
//
// Determinism: a stable string seed is built from the inputs and hashed
// to a number in [0, 1). That maps into the $5k–$80k range for retail.
// Trade-in is retail discounted by a deterministic 18–28% factor (also
// keyed off the seed). Same inputs → same numbers, every render.
//
// Why year + make + model (not just VIN) drive the seed: the consumer
// flow may be VIN-first or manual-first (per VehicleAdd's locked rule).
// Either path needs to produce a value card. When VIN is present the
// VIN's last 8 chars dominate the seed (VINs are unique-per-vehicle, so
// the value should be effectively unique). When VIN is absent we hash
// year+make+model+trim+mileage so manually-picked vehicles still get
// stable values across renders.

const PRICE_FLOOR = 5000;
const PRICE_CEILING = 80000;
const MILEAGE_DECAY_PER_10K_MILES = 0.025; // 2.5% off retail per 10k miles
const TRADE_IN_DISCOUNT_FLOOR = 0.18;
const TRADE_IN_DISCOUNT_CEILING = 0.28;

function buildSeed({ vin, year, make, model, trim, mileage }) {
  const vinTail = vin && vin.length >= 8 ? vin.slice(-8) : '';
  return [
    vinTail,
    year ?? '',
    String(make ?? '').toLowerCase().trim(),
    String(model ?? '').toLowerCase().trim(),
    String(trim ?? '').toLowerCase().trim(),
    mileage ?? '',
  ].join('|');
}

// FNV-1a 32-bit hash, normalized to [0, 1). Deterministic and dependency-
// free — good enough for a deterministic mock value across the supported
// input shapes.
function hashToUnit(seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Force unsigned, then normalize.
  return (h >>> 0) / 0xffffffff;
}

// Two independent unit values from the same seed (for retail vs
// trade-in discount). Pulled deterministically by suffixing the seed.
function unitPair(seed) {
  return [hashToUnit(seed + ':retail'), hashToUnit(seed + ':trade')];
}

// Newer vehicles bias higher in the range; older bias lower. Adds a
// tiny realism touch without breaking determinism — same inputs still
// produce the same number.
function vehicleAgeBias(year) {
  if (!year) return 0;
  const age = Math.max(0, new Date().getFullYear() - Number(year));
  // 0-year-old → +0.20; 20+ year-old → -0.20.
  const span = Math.max(-1, Math.min(1, (10 - age) / 10));
  return span * 0.2;
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Fetch a vehicle value (mocked).
 *
 * @param {Object} input
 * @param {string} [input.vin]
 * @param {number} [input.year]
 * @param {string} [input.make]
 * @param {string} [input.model]
 * @param {string} [input.trim]
 * @param {number} [input.mileage]
 * @returns {Promise<{
 *   retail_value: number,
 *   trade_in_value: number,
 *   fetched_at: string,
 *   source: 'MarketCheck (mocked)',
 * } | null>}
 *   Returns null when there is not enough information to build a seed
 *   (e.g., no VIN AND no make/model). Callers should treat null as
 *   "not enough info yet — try again when YMMT is filled in."
 */
export async function getVehicleValue(input = {}) {
  const { vin, year, make, model, trim, mileage } = input;

  const haveEnough = (vin && vin.length >= 8) || (year && make && model);
  if (!haveEnough) return null;

  const seed = buildSeed({ vin, year, make, model, trim, mileage });
  const [retailUnit, tradeDiscountUnit] = unitPair(seed);

  // Bias retail toward the year (newer = higher).
  const biased = clamp01(retailUnit + vehicleAgeBias(year));
  let retail = PRICE_FLOOR + biased * (PRICE_CEILING - PRICE_FLOOR);

  // Mileage decay — flatten the price as mileage climbs. Capped at 60%
  // off retail so very-high-mileage vehicles still produce a sensible
  // value rather than collapsing to zero.
  if (Number.isFinite(mileage) && mileage > 0) {
    const decay = Math.min(0.6, (mileage / 10000) * MILEAGE_DECAY_PER_10K_MILES);
    retail = retail * (1 - decay);
  }

  retail = Math.max(PRICE_FLOOR, Math.round(retail / 50) * 50); // round to $50

  const tradeDiscount =
    TRADE_IN_DISCOUNT_FLOOR +
    tradeDiscountUnit * (TRADE_IN_DISCOUNT_CEILING - TRADE_IN_DISCOUNT_FLOOR);
  const tradeIn = Math.max(
    Math.round((PRICE_FLOOR * 0.6) / 50) * 50,
    Math.round((retail * (1 - tradeDiscount)) / 50) * 50,
  );

  // Tiny artificial latency so loading states have a chance to render.
  // Phase 2: drop this once we wire to the real (server-relayed)
  // MarketCheck adapter.
  await new Promise((r) => setTimeout(r, 350));

  return {
    retail_value: retail,
    trade_in_value: tradeIn,
    fetched_at: new Date().toISOString(),
    source: 'MarketCheck (mocked)',
  };
}
