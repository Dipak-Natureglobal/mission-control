// mileageEstimator.js — pure vehicle mileage helpers.
//
// No React, no network, no side effects. Safe to import anywhere in the
// platform tree.
//
// Dep direction: MAY read canon/*.json constants; MUST NOT import from
// any child app (architecture/11-platform-package-layout.md).
//
// -----------------------------------------------------------------
// estimateMileageFromAge({ vehicleYear, annualEstimate, currentDate? })
//   Returns the default mileage for a vehicle of the given year, based
//   on org config × vehicle age. Used to seed the mileage slider when
//   the user first lands on ScreenVehicleDrive and hasn't entered
//   a mileage yet.
//
//   vehicleAge is clamped to [1, 20] so very new or very old vehicles
//   produce sensible defaults rather than 0 or unbounded values.
//
//   Example — 2024 vehicle, annual 12000, currentDate 2026-01-01:
//     vehicleAge = max(1, min(20, 2026 - 2024 + 1)) = 3
//     → 3 × 12000 = 36000
//
// -----------------------------------------------------------------
// computeAnnualMileageEstimate({ currentMileage, vehicleYear, condition,
//                                 purchaseDate, currentDate? })
//   Returns the estimated annual miles driven, rounded to nearest 100.
//   Mirrors (and replaces) the inline math in ScreenVehicleDrive
//   lines 2184–2202 of refinance-v2-prototype.jsx so there is a single
//   source of truth.
//
//   Decision tree (matches existing UI logic exactly):
//     1. If condition === 'Used' AND purchaseDate is a valid past date:
//          ownershipYears = max(1/12, elapsedYears)
//          annual = round(currentMileage / ownershipYears / 100) * 100
//     2. Otherwise (New, or no valid past purchaseDate):
//          vehicleAge = max(1, currentYear - vehicleYear + 1)
//          annual = round(currentMileage / vehicleAge / 100) * 100
//
//   Examples (comments serve as inline test cases):
//     {vehicleYear:2020, condition:'Used', purchaseDate:'2022-01-01',
//      currentMileage:30000, currentDate:new Date('2026-01-01')}
//       ownershipYears ≈ 4.00   → annual = round(30000/4/100)*100 = 7500
//
//     {vehicleYear:2024, condition:'New', currentMileage:24000,
//      currentDate:new Date('2026-01-01')}
//       vehicleAge = max(1, 2026-2024+1) = 3  → annual = round(24000/3/100)*100 = 8000
//       (Note: the *default seeded mileage* for a 2024 New at 12000/yr
//        would be 3×12000=36000 from estimateMileageFromAge; this fn
//        computes the annual *from* whatever currentMileage the slider
//        currently shows — those are two distinct operations.)
//
// -----------------------------------------------------------------

const MIN_VEHICLE_AGE = 1;
const MAX_VEHICLE_AGE = 20;
const MIN_OWNERSHIP_YEARS = 1 / 12; // one month floor

/**
 * estimateMileageFromAge
 * @param {object} opts
 * @param {number} opts.vehicleYear  — model year (e.g. 2024)
 * @param {number} opts.annualEstimate — miles/year from org config (e.g. 12000)
 * @param {Date}   [opts.currentDate]  — override for testing; defaults to new Date()
 * @returns {number} estimated total mileage
 */
export function estimateMileageFromAge({ vehicleYear, annualEstimate, currentDate }) {
  const today = currentDate || new Date();
  const currentYear = today.getFullYear();
  const rawAge = currentYear - vehicleYear + 1;
  const vehicleAge = Math.max(MIN_VEHICLE_AGE, Math.min(MAX_VEHICLE_AGE, rawAge));
  return vehicleAge * annualEstimate;
}

/**
 * computeAnnualMileageEstimate
 * @param {object} opts
 * @param {number} opts.currentMileage  — odometer reading the user confirmed
 * @param {number} opts.vehicleYear     — model year (e.g. 2020)
 * @param {string} [opts.condition]     — 'New' | 'Used'
 * @param {string} [opts.purchaseDate]  — ISO date string 'YYYY-MM-DD'; only used when condition === 'Used'
 * @param {Date}   [opts.currentDate]   — override for testing; defaults to new Date()
 * @returns {number} annual miles estimate, rounded to nearest 100
 */
export function computeAnnualMileageEstimate({
  currentMileage,
  vehicleYear,
  condition,
  purchaseDate,
  currentDate,
}) {
  const today = currentDate || new Date();
  const currentYear = today.getFullYear();

  // Purchase-date path (Used + valid past date).
  if (condition === 'Used' && purchaseDate) {
    const purchase = new Date(purchaseDate);
    const purchaseValid = !Number.isNaN(purchase.getTime());
    const purchaseInFuture = purchaseValid && purchase.getTime() > today.getTime();

    if (purchaseValid && !purchaseInFuture) {
      const rawOwnershipYears =
        (today.getTime() - purchase.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      const ownershipYears = Math.max(MIN_OWNERSHIP_YEARS, rawOwnershipYears);
      return Math.round(currentMileage / ownershipYears / 100) * 100;
    }
  }

  // Fallback: mileage / vehicle age.
  const vehicleAge = vehicleYear
    ? Math.max(MIN_VEHICLE_AGE, currentYear - vehicleYear + 1)
    : MIN_VEHICLE_AGE;
  return Math.round(currentMileage / vehicleAge / 100) * 100;
}
