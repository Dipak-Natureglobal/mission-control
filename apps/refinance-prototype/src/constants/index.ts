import { YMMT_DATA, YMMT_MAKES } from './ymmt-data';
import { LENDERS } from './lenders';
import { MOCK_OFFERS, MOCK_PROTECTION_PLANS, MOCK_INSURANCE_QUOTES, MOCK_INSURANCE_SAVINGS } from './mock-data';
import { PREFILL_PRESETS, VEHICLE_PRESETS } from './prefill-presets';
import type { CreditBand, OwnershipType, EmploymentType, HousingType, RelationshipType } from '../types';


const CREDIT_BANDS = [
  { id: "300_579", label: "300 – 579", desc: "Poor / Very Poor" },
  { id: "580_669", label: "580 – 669", desc: "Fair" },
  { id: "670_739", label: "670 – 739", desc: "Good" },
  { id: "740_799", label: "740 – 799", desc: "Very Good" },
  { id: "800_850", label: "800 – 850", desc: "Exceptional" },
];


const OWNERSHIP_OPTIONS = [
  { id: "financed", label: "Financed — Making payments", eligible: true },
  { id: "leased", label: "Leased — Making payments", eligible: true },
  { id: "owned", label: "Owned — Paid in full", eligible: false },
  { id: "none", label: "No longer own this vehicle", eligible: false },
];


const EMPLOYMENT_TYPES = [
  "At Home",
  "Disability",
  "Employed",
  "Executive",
  "Labourer",
  "Management",
  "Military",
  "Office Staff",
  "Other",
  "Production",
  "Professional",
  "Retired",
  "Retired - Military",
  "Sales",
  "Self-Employed",
  "Semi Professional",
  "Service",
  "Social Security",
  "Student",
  "Trades",
  "Unemployed",
];

const HOUSING_OPTIONS = ["Own", "Rent", "Other"];

const RELATIONSHIP_OPTIONS = [
  "Spouse",
  "Child",
  "Parent",
  "Sibling",
  "Grandparent",
  "Relative",
  "Domestic Partner",
  "Roommate",
  "Other",
];

const DISQUAL_REASONS = {
  no_consent: {
    title: "Consent required",
    msg: "A soft credit pull consent is required before we can submit to any partner.",
  },
  ssn_required_for_partner: {
    title: "SSN required",
    msg: "The matched partner requires an SSN to prequalify. Try a partner that supports no-SSN prequal.",
  },
  state_ineligible: {
    title: "State not eligible",
    msg: "No refinance partner is currently available in the applicant's state.",
  },
  credit_out_of_range: {
    title: "Credit band out of range",
    msg: "The self-reported credit range is outside all configured partner thresholds.",
  },
  income_out_of_range: {
    title: "Income out of range",
    msg: "The stated annual income is outside the configured partner limits.",
  },
  payoff_out_of_range: {
    title: "Payoff out of range",
    msg: "The estimated payoff is outside configured partner limits.",
  },
  no_offers: {
    title: "No offers returned",
    msg: "The partner processed the submission but returned no qualifying offers.",
  },
  partner_rejected: {
    title: "Partner declined",
    msg: "The partner explicitly declined to prequalify this application.",
  },
  under_18: {
    title: "Applicant must be 18 or older",
    msg: "Refinance partners require all applicants to be at least 18 years old. We can't continue with an applicant under the age of majority.",
  },
  vehicle_too_old: {
    title: "Vehicle too old to refinance",
    msg: "The vehicle's model year is outside the configured maximum age for this organization's refinance partners.",
  },
  mileage_too_high: {
    title: "Odometer too high",
    msg: "The reported mileage exceeds the configured maximum for this organization's refinance partners.",
  },
  ownership_ineligible: {
    title: "Ownership status not eligible",
    msg: "Refinancing requires an existing auto loan or lease. Vehicles that are paid in full or no longer owned can't be refinanced.",
  },
  payoff_below_min: {
    title: "Estimated payoff below minimum",
    msg: "The estimated payoff is below the configured minimum for this organization's refinance partners.",
  },
  credit_requires_coapp: {
    title: "Co-applicant required",
    msg: "With a self-reported credit band below 580 and no co-applicant, we can't match any configured refinance partner.",
  },
  employment_and_credit: {
    title: "Employment and credit combination not eligible",
    msg: "Unemployed or self-employed status combined with a fair or poor credit band falls outside all configured partner rules.",
  },
  income_below_min: {
    title: "Annual income below minimum",
    msg: "The stated annual income is below the configured minimum for this organization's refinance partners.",
  },
  ltv_too_high: {
    title: "Loan-to-Value too high",
    msg: "The payoff amount exceeds the maximum allowable loan-to-value ratio for this credit band. The vehicle's market value does not support the remaining balance.",
  },
};

const DEFAULT_ORG_CONFIG = {
  maxVehicleAgeYears: 15,
  maxMileage: 150000,
  minPayoff: 10000,
  minAnnualIncome: 18000,
  eligibleOwnership: ["financed", "leased"],
  minCreditBandWithoutCoApp: "580_669",
  restrictedEmploymentTypes: ["Unemployed", "Self-Employed"],
  restrictedEmploymentCreditBands: ["300_579", "580_669"],
  // Max LTV (Loan-to-Value) per credit band.
  // LTV = payoff / vehicle_market_value.  If LTV >= threshold → disqualified.
  maxLtv: {
    "300_579": 1.0,    // Poor — payoff must not exceed vehicle value
    "580_669": 1.2,    // Fair
    "670_739": 1.25,   // Good
    "740_799": 1.4,    // Very Good
    "800_850": 1.5,    // Exceptional
  },
};

const ZIP_FALLBACK = {
  "30301": { city: "Atlanta", state: "GA" },
  "30305": { city: "Atlanta", state: "GA" },
  "31324": { city: "Richmond Hill", state: "GA" },
  "75001": { city: "Addison", state: "TX" },
  "75201": { city: "Dallas", state: "TX" },
  "78701": { city: "Austin", state: "TX" },
  "85001": { city: "Phoenix", state: "AZ" },
  "90001": { city: "Los Angeles", state: "CA" },
  "90210": { city: "Beverly Hills", state: "CA" },
  "94102": { city: "San Francisco", state: "CA" },
  "10001": { city: "New York", state: "NY" },
  "10011": { city: "New York", state: "NY" },
  "11201": { city: "Brooklyn", state: "NY" },
  "33101": { city: "Miami", state: "FL" },
  "32801": { city: "Orlando", state: "FL" },
  "60601": { city: "Chicago", state: "IL" },
  "80202": { city: "Denver", state: "CO" },
  "98101": { city: "Seattle", state: "WA" },
  "97201": { city: "Portland", state: "OR" },
  "02108": { city: "Boston", state: "MA" },
  "19103": { city: "Philadelphia", state: "PA" },
  "37203": { city: "Nashville", state: "TN" },
  "28202": { city: "Charlotte", state: "NC" },
};

export {
  CREDIT_BANDS,
  OWNERSHIP_OPTIONS,
  EMPLOYMENT_TYPES,
  HOUSING_OPTIONS,
  RELATIONSHIP_OPTIONS,
  DISQUAL_REASONS,
  DEFAULT_ORG_CONFIG,
  ZIP_FALLBACK,
  YMMT_DATA,
  YMMT_MAKES,
  LENDERS,
  MOCK_OFFERS,
  MOCK_PROTECTION_PLANS,
  MOCK_INSURANCE_QUOTES,
  MOCK_INSURANCE_SAVINGS,
  PREFILL_PRESETS,
  VEHICLE_PRESETS,
};
