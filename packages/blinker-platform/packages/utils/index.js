// Public surface for blinker-platform's pure-utility library.
//
// CHARTER: pure functions consumed by 2+ child apps. No React, no
// network, no canon side-effects (canon JSON imports allowed for
// constants). 3-strikes rule: only lift when 2+ apps already duplicate.
//
// Lift targets currently ranked by duplicate count (audit lands Wave 15b):
//   - validators (isValidEmail / isValidUSPhone10 / isValidZip5 /
//     normalizePhoneE164 / normalizeZip5) — currently inlined in
//     mission-control/src/lib/contact-form.js; will be needed by
//     packages/components/PhoneInput + EmailInput in 15e.
//   - protection-pricing math (PMT, ELIR, protectionPlanMonthlyOnRefi,
//     insuranceMonthlySavings, effectiveMonthly) — currently
//     protection-portal/src/lib/protection-pricing.js; cross-sell embeds
//     read these.
//   - status-mapping helpers (`availableStatusesForWorkflow`) — currently
//     mission-control/src/lib/status-mapping.js; threaded into both
//     protection-portal + insurance-portal AgentView via CoPilotPane.
//   - plan-selector (`selectPlans`, `listMatchingPlans`) — currently
//     protection-portal/src/lib/plan-selector.js.
//
// Dep direction (per architecture/11):
//   - MAY read `../../canon/*.json` (constants only).
//   - MAY import sibling packages (none expected today).
//   - MUST NOT import from any child app.
//
// Consumers MUST import from this file ONLY.
//
// ---------------------------------------------------------------------
//
// Available public exports:
//
//   validators (object, string|null contract):
//     - required(v)         → 'Required' | null
//     - email(v)            → 'Enter a valid email address' | null
//     - usPhone(v)          → 'Enter a 10-digit US phone number' | null
//     - ssn(v)              → 'SSN must be 9 digits' | null
//     - zip(v)              → 'Enter a 5-digit ZIP code' | null
//     - state2(v)           → 'Use the 2-letter state abbreviation' | null
//     - vin(v)              → 'VIN must be …' | null
//     - flexDate(v)         → 'Enter a valid date' | null
//     - flexDateInPast(v)   → above + 'Date must be in the past' | null
//     - positiveCurrency(v) → 'Must be greater than 0' | null
//     - positiveInt(v)      → 'Must be greater than 0' | null
//
//   Boolean validators (mc-family):
//     - isValidEmail(s)
//     - isValidUSPhone10(s)
//     - isValidZip5(s)
//
//   Normalizers:
//     - normalizePhoneE164(s)  → '+1XXXXXXXXXX' | ''
//     - normalizeZip5(s)       → 'XXXXX' | ''
//     - sanitizeNumeric(v, opts)
//
//   Date helpers (string|null family):
//     - parseFlexDate(v)   → { month, day, year, date } | null
//     - parseDob(v)        → Date | null
//     - ageYears(v)        → integer | null
//     - dobAdult(v)        → string | null  (composes flexDateInPast +
//                                            18 ≤ age ≤ 110)
//
//   Display helper:
//     - formatPhoneDisplay(s)  → '(###) ###-####' (or partial)
//
//   Vehicle helpers (string|null family):
//     - formatVehicleLabel(v)  → '{year} {make} {model}[ {trim}]' | null
//
//   Mileage estimator helpers (Wave 19):
//     - estimateMileageFromAge({ vehicleYear, annualEstimate, currentDate? })
//                              → vehicleAge × annualEstimate (clamped 1–20 yrs)
//     - computeAnnualMileageEstimate({ currentMileage, vehicleYear, condition,
//                                       purchaseDate, currentDate? })
//                              → annual miles rounded to nearest 100
//
//   VIN decode (Wave 17 P1):
//     - fetchVinDecode(vin)    → { year, make, model, trim, raw, error }
//                                 — VinAudit Specifications API call.
//     - ymmtMatch(list, val)   → canonical YMMT_DATA key | null
//                                 (case-insensitive + partial match).
//
//   YMMT reference data (Wave 17 P1 / Wave 19 Task 2 year-aware layer):
//     - YEARS                  → number[] (descending, 2010..2026)
//     - YMMT_RAW               → string (JSON literal — used by callers
//                                 that need to defer parse, e.g. tree-
//                                 shake guards). Most callers should
//                                 import YMMT_DATA directly.
//     - YMMT_DATA              → { make: { model: string[trims] } }
//     - YMMT_MAKES             → string[] (sorted Object.keys of YMMT_DATA)
//     - YMMT_YEAR_CONSTRAINTS  → { make: { model: [firstYear, lastYear] | null } }
//                                 known year ranges for discontinued models.
//     - getMakes()             → string[] (alias of YMMT_MAKES)
//     - getModelsForYearMake(year, make)           → string[] year-filtered
//     - getTrimsForYearMakeModel(year, make, model) → string[] year-filtered

export { formatVehicleLabel } from './vehicle.js';

export { estimateMileageFromAge, computeAnnualMileageEstimate } from './mileageEstimator.js';

export { fetchVinDecode, ymmtMatch } from './vinDecode.js';

export {
  YEARS,
  YMMT_RAW,
  YMMT_DATA,
  YMMT_MAKES,
  YMMT_YEAR_CONSTRAINTS,
  YMMT_ASSET_TYPE,
  getMakes,
  getModelsForYearMake,
  getTrimsForYearMakeModel,
  getAssetTypeForMakeModel,
} from './ymmt-data.js';

export {
  mapVinAuditTypeToSeAssetType,
  SE_ASSET_TYPE_DEFAULT,
} from './asset-type.js';

export {
  // boolean / normalizer family (mc)
  isValidEmail,
  isValidUSPhone10,
  normalizePhoneE164,
  normalizeZip5,
  isValidZip5,
  // string|null family (refi/protection)
  validators,
  // formatters / parsers
  sanitizeNumeric,
  parseFlexDate,
  parseDob,
  ageYears,
  dobAdult,
  formatPhoneDisplay,
} from './validators.js';

// Wave 22 — protection-portal v3.0.4 add-on passthrough (PDF tasks 1, 2, 4).
// Single source of truth for matching StoneEagle response options against
// canonical add-on names, computing per-plan cost passthrough, and surfacing
// badges. Reads canon/plan-mappings.json#add_on_passthrough.
export {
  matchAddOnByName,
  resolveAddOnDelta,
  triggeredPassthroughKeys,
  buildPassthroughForPlan,
} from './protection-addons.js';

// Wave 22-fu — TPA cost → customer-facing price math. Org-level markup from
// canon/org-registry.json layered on top of SCS `<Cost>` per RegulatedRuleId.
// Used by packages/integrations/product_admin/stoneeagle.js (proxy mode).
// W22-fu5 also exposes `getOrgMaxPlanPrice` for the plan-selector cost-cap
// filter ($4000 default; org-overridable via
// org-registry.protection_billing.max_plan_price).
export {
  computePlanPrice,
  getOrgMarkupSnapshot,
  getOrgMaxPlanPrice,
  MAX_PLAN_PRICE_DEFAULT,
} from './protection-pricing.js';

// Wave 23 v3.0.5 Task 5 — New-vs-Used classifier. Drives parallel branching
// in packages/integrations/product_admin/stoneeagle.js getRatesWithVehicleClass.
// Reads canon/plan-mappings.json#vehicle_class_rule via the caller (canonRule
// is passed in so this util stays pure).
export { classifyVehicle } from './vehicle-class.js';

// Wave 25 v3.0.7 Phase B1 — Post-VIN SE GetRates divergence classifier.
// Pure function; 8 kinds per ADR 17. Consumed by protection-portal VinValidate.jsx.
export { classifyRatesChange } from './getrates-comparison.js';

// Wave 27 v3.0.8 Tasks 1 + 2 — plan presentation + DocuSeal template resolver.
// Reads canon plan-mappings.json::plan_catalog + plan_level_defaults and
// org-registry.json::orgs[].plan_overrides + integrations.docuseal.template_id_by_plan.
// Resolution precedence (most specific first):
//   org_override → catalog → name_match → fallback
// Consumed by protection-portal PlanCard / RecommendedCoverage (consumer surface)
// and mission-control PlanCatalog admin (admin surface). See architecture/18-plan-catalog.md.
export {
  resolvePlanPresentation,
  getPlanLevelDefaults,
  listPlanCatalog,
} from './plan-presentation.js';

// Wave 28d/28e — workload + tag-match composite scoring for the manager
// Assignment dropdown + BulkReassignBar. Per ADR 19 §7:
//   score = workload_factor * 0.6 + tag_match_factor * 0.4
// Consumed by mission-control/src/personas/manager/BulkReassignBar.jsx +
// (incoming 28e) AssignmentDropdown. Pure — takes pre-enriched agents +
// opp(s), returns ranked { agent, score, suggested, breakdown } rows.
export {
  scoreAgents,
  scoreAgentsForOpps,
  neededTagsForOpp,
  WEIGHT_WORKLOAD,
  WEIGHT_TAG_MATCH,
} from './assignment-scoring.js';

// v3.0.15 (ADR 27 D1) — shared per-org duplicate / household matching.
// Graduated from mission-control/src/lib/contact-form.js so the insurance
// LeadOriginationForm contact-details gate reuses the exact AddContactModal
// dedupe logic. Pure — no UI. Pairs with the ContactDedupeCard component
// (packages/components) which renders the match result.
export {
  findContactMatch,
  buildHouseholdRelationship,
  HOUSEHOLD_RELATIONSHIP_KINDS,
} from './contact-identity.js';
