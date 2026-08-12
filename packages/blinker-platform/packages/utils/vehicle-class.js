// Vehicle class (New vs Used) classifier — Wave 23 v3.0.5 Task 5.
//
// Drives the New-vs-Used parallel branch in
// packages/integrations/product_admin/stoneeagle.js. When a vehicle
// classifies 'new', the orchestrator fires TWO SE GetRates calls in
// parallel (condition='N' and condition='U') and merges with each plan
// tagged `rate_class:'new'|'used'`. When 'used', a single condition='U'
// call covers it. See ADR 13 + canon/plan-mappings.json#vehicle_class_rule.
//
// Conservative default 'used' on missing/invalid input — getting a 'used'
// quote is always safe (every TPA supports it); a wrong 'new' classification
// would fire a doomed second call.

/**
 * @param {object} vehicle
 * @param {number|string} vehicle.year     four-digit model year
 * @param {number|string} vehicle.mileage  current odometer
 * @param {object} canonRule               { max_age_years, max_miles } from
 *                                          canon/plan-mappings.json#vehicle_class_rule
 * @param {Date} [now]                     injected for testability
 * @returns {'new' | 'used'}  'new' when age ≤ max_age_years AND mileage ≤
 *                            max_miles (bounds INCLUSIVE); otherwise 'used'.
 */
export function classifyVehicle(vehicle, canonRule, now) {
  if (!canonRule || typeof canonRule !== 'object') {
    throw new Error('classifyVehicle: canonRule is required (pass plan-mappings.json#vehicle_class_rule)');
  }

  const year = Number(vehicle?.year);
  const mileage = Number(vehicle?.mileage);
  if (!Number.isFinite(year) || !Number.isFinite(mileage)) return 'used';

  const today = now instanceof Date ? now : new Date();
  // Use full-year delta (calendar year minus model year) — same convention
  // legacy Blinker uses for the new-vs-used gate.
  const ageYears = today.getFullYear() - year;

  const maxAge = Number(canonRule.max_age_years);
  const maxMiles = Number(canonRule.max_miles);
  if (!Number.isFinite(maxAge) || !Number.isFinite(maxMiles)) return 'used';

  // Inclusive bounds: a vehicle qualifies as 'new' when it is max_age_years
  // model years old OR LESS *and* max_miles OR LESS (i.e. "3 model years or
  // less" and "36,000 miles or less"). The boundary value itself qualifies —
  // exactly 36,000 mi on a 3-model-year-old vehicle is still 'new'.
  const ageOk = ageYears <= maxAge;
  const milesOk = mileage <= maxMiles;
  return ageOk && milesOk ? 'new' : 'used';
}

export default classifyVehicle;
