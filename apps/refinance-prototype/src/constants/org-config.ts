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
import { DEFAULT_ORG_CONFIG as _RAW } from '../refinance-v2-prototype';
import type { OrgConfig } from '../types';
export const DEFAULT_ORG_CONFIG: OrgConfig = _RAW as OrgConfig;
