// Default org / partner config used by the decision engine. Same shape
// as the prototype's DEFAULT_ORG_CONFIG; re-exported here so DevControls
// can import a stable path and (eventually) so per-partner overrides can
// drop into a sibling file without churning the monolith.
//
// Schema (preserved verbatim from the prototype — DO NOT change keys
// without updating runDecision() in src/lib/refi.js):
//   maxVehicleAgeYears:                 number
//   maxMileage:                         number
//   minPayoff:                          number  (USD)
//   minAnnualIncome:                    number  (USD)
//   eligibleOwnership:                  string[]  (CREDIT_BANDS-style ids)
//   minCreditBandWithoutCoApp:          string  (band id)
//   restrictedEmploymentTypes:          string[]
//   restrictedEmploymentCreditBands:    string[]
//   maxLtv:                             { [creditBand]: number }
// This file is the leaf source of truth for the default org config. The
// monolith (refinance-v2-prototype.tsx) imports DEFAULT_ORG_CONFIG FROM
// here — never the other way around. Re-importing it back from the
// monolith created a cycle (monolith → lib/refi → org-config → monolith)
// that surfaced as "Cannot access '_RAW' before initialization" (TDZ) on
// the agent view's module load order.
import type { OrgConfig } from '../types';

export const DEFAULT_ORG_CONFIG: OrgConfig = {
  maxVehicleAgeYears: 15,
  maxMileage: 150000,
  minPayoff: 10000,
  minAnnualIncome: 18000,
  eligibleOwnership: ['financed', 'leased'],
  minCreditBandWithoutCoApp: '580_669',
  restrictedEmploymentTypes: ['Unemployed', 'Self-Employed'],
  restrictedEmploymentCreditBands: ['300_579', '580_669'],
  // Max LTV (Loan-to-Value) per credit band.
  // LTV = payoff / vehicle_market_value.  If LTV >= threshold → disqualified.
  maxLtv: {
    '300_579': 1.0, // Poor — payoff must not exceed vehicle value
    '580_669': 1.2, // Fair
    '670_739': 1.25, // Good
    '740_799': 1.4, // Very Good
    '800_850': 1.5, // Exceptional
  },
};
