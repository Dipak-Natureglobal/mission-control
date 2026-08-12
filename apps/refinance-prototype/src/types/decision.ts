import type { RefiForm } from './form';
import type { CreditBand } from './enums';

export interface DecisionLogEntry {
  step: string;
  ok: boolean;
  detail: string;
}

export type DisqualReason =
    | 'credit_out_of_range'
    | 'income_out_of_range'
    | 'payoff_out_of_range'
    | 'payoff_below_min'
    | 'no_offers'
    | 'partner_rejected'
    | 'no_consent'
    | 'ssn_required_for_partner'
    | 'under_18'
    | 'vehicle_too_old'
    | 'mileage_too_high'
    | 'ownership_ineligible'
    | 'credit_requires_coapp'
    | 'employment_and_credit'
    | 'ltv_too_high'
    | 'income_below_min'
    | 'state_ineligible'
    | 'unknown';

export type DecisionResult = 'offers_returned' | 'qualified' | 'pre_approved' | 'disqualified' | 'pending';

export type Partner = 'gravity' | 'savings_group' | 'none';

export interface Decision {
  partner: Partner;
  partnerName?: string;
  partnerPhone?: string;
  result: DecisionResult;
  reason?: DisqualReason;
  ruleId?: string;
  log: DecisionLogEntry[];
  externalApplicationId?: string;
  valuation: {
    marketcheck_price: number | null;
    retail_price: number | null;
    ltv?: number;
    ltv_pct?: string;
  };
  offers?: RefiOffer[];
}

export interface RefiOffer {
  id?: string;
  lender: string;
  apr: number;
  term: number;
  monthly?: number;
  monthlyPayment?: number;
  savings?: number;
  totalInterest?: number;
  disclaimer?: string;
}

export interface RunDecisionParams {
  form: RefiForm;
  orgConfig?: OrgConfig;
  forcePartner?: string | 'auto';
  forceResult?: string | 'auto';
  includeSsn?: boolean;
  disqualReason?: DisqualReason;
  hasCoApp?: boolean;
}

export interface OrgConfig {
  maxVehicleAgeYears: number;
  maxMileage: number;
  minPayoff: number;
  minAnnualIncome: number;
  eligibleOwnership: string[];
  minCreditBandWithoutCoApp: CreditBand;
  restrictedEmploymentTypes: string[];
  restrictedEmploymentCreditBands: CreditBand[];
  maxLtv: Record<CreditBand, number>;
}
