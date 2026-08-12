// Default org / partner config used by the decision engine. Same shape
// as the prototype's DEFAULT_ORG_CONFIG; this file OWNS the values so
// DevControls can import a stable path and (eventually) so per-partner
// overrides can drop into a sibling file without churning the monolith.
//
// Ownership note: this used to re-export the monolith's local const, which
// created an import cycle (org-config -> refinance-v2-prototype -> lib/refi
// -> org-config) and blew up at module-eval time with
// "Cannot access '_RAW' before initialization". The monolith now imports
// from here instead, making this module a leaf with no runtime imports.
//
// Schema (preserved verbatim from the prototype — DO NOT change keys
// without updating runDecision() in src/lib/refi.ts):
//   maxVehicleAgeYears:                 number
//   maxMileage:                         number
//   minPayoff:                          number  (USD)
//   minAnnualIncome:                    number  (USD)
//   eligibleOwnership:                  string[]  (CREDIT_BANDS-style ids)
//   minCreditBandWithoutCoApp:          string  (band id)
//   restrictedEmploymentTypes:          string[]
//   restrictedEmploymentCreditBands:    string[]
//   maxLtv:                             { [creditBand]: number }
import type { OrgConfig } from '../types';

// Default organization configuration. Each refinance partner can override
// these at runtime; the dev panel lets us edit them live without a code change.
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
    '300_579': 1.0,    // Poor — payoff must not exceed vehicle value
    '580_669': 1.2,    // Fair
    '670_739': 1.25,   // Good
    '740_799': 1.4,    // Very Good
    '800_850': 1.5,    // Exceptional
  },
};
