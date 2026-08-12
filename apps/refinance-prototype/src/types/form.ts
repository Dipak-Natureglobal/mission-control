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
  mileage: number;
  condition: string;
  // Internal UI state — YMMT picker + VIN decode tracking (not submitted)
  purchaseDate?: string;
  extraMakes: string[];
  extraModels: string[];
  extraTrims: string[];
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
