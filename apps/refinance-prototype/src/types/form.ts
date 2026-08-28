import type { CreditBand, OwnershipType, EmploymentType, HousingType, RelationshipType } from './enums';

export interface OpportunityContact {
  email?: string;
  phone?: string;
  note?: string;
}

export interface CaptureLink {
  token: string;
  url: string;
  generatedAt: string;
  sentAt: string | null;
}

export interface SentSummary {
  at: string;
  step: string;
}

export interface Opportunity {
  id?: string;
  contact?: OpportunityContact;
  captureLink?: CaptureLink;
  status: string;
  sentSummary?: SentSummary;
}

export interface RefiForm {
  // Protection plan teaser
  planSold: boolean;
  selectedPlanId?: string;
  smsSent: boolean;
  // Insurance teaser
  insuranceReviewed: boolean;
  insuranceSavingsFound: boolean;
  insuranceMonthlySavings: number;
  insuranceSmsSent: boolean;
  // Vehicle
  vin: string;
  vinDecoded: boolean;
  vinDecodeLoading: boolean;
  vinDecodeError?: string;
  year: number | null;
  make: string;
  model: string;
  trim: string;
  // blinker VehicleTrim id behind `trim`. Submitted with the vehicle so the
  // importer resolves the trim by id instead of by year/make/model string
  // match. null whenever the label has no id: the "I don't know" / "Other"
  // sentinels, decode-injected extras, and the no-token fixture path.
  trim_id?: number | null;
  mileage: number;
  condition: string;
  // Internal UI state — YMMT picker + VIN decode tracking (not submitted)
  purchaseDate?: string;
  extraMakes: string[];
  extraModels: string[];
  extraTrims: string[];
  // Candidate trim labels from blinker's vehicle_by_vin. Non-empty restricts
  // the trim picker to exactly these; empty means no restriction.
  trimCandidates: string[];
  // trim_id for each label in trimCandidates. vehicle_by_vin returns ids
  // (utils/api.ts fetchVehicleTrimsByVin) but the picker is label-keyed, so
  // the mapping is kept alongside rather than folded into the label list —
  // MC keeps the same pairing as `allowedTrimIds` + its options cache
  // (plateVinForm.tsx:270-306).
  trimCandidateIds?: Record<string, number>;
  trimLookupLoading: boolean;
  _lastDecodedVin?: string;
  vehicle?: Record<string, unknown>;
  // Applicant primary
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  // Current loan
  ownership: OwnershipType | null;
  lender: string;
  monthlyPayment: string;
  payoff: string;
  // Credit
  creditBand: CreditBand | null;
  // Co-applicant
  hasCoApplicant: boolean | null;
  coAppFirst: string;
  coAppLast: string;
  coAppPhone: string;
  coAppEmail: string;
  coAppRelationship: RelationshipType | string;
  coAppRelationshipOther: string;
  coAppDob: string;
  coAppSsn: string;
  coAppEmployer: string;
  coAppEmploymentType: EmploymentType | string;
  coAppIncome: string;
  coAppConsent: boolean;
  // Housing
  address: string;
  apt_suite: string;
  city: string;
  state: string;
  zip: string;
  ownRent: HousingType | null;
  moveInDate: string;
  housingPayment: string;
  // Employment
  employer: string;
  employmentType: EmploymentType | string;
  income: string;
  startDate: string;
  // Identity + consent
  dob: string;
  ssn: string;
  consentConfirmed: boolean;
  // Vehicle valuation
  valuationMarketCheckPrice: number | null;
  valuationRetailPrice: number | null;
  valuationLoading: boolean;
  valuationError?: string;
  // Agent-side notes + tags
  notes: string;
  tags: string[];
  tagsCreated: Array<{ id: string; label: string; color?: string }>;
  // CoPilot org scope — seeded by mission-control, undefined in standalone
  org_id?: string;
}
