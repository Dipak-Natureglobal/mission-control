import type { Persona } from './enums';
import type { DisqualReason, Partner, OrgConfig } from './decision';
import type { RefiForm } from './form';
import type { PrefillPayload } from '../constants/prefill-presets';

export type ScreenKey =
    | 'embedded_entry'
    | 'vehicle_add'
    | 'vehicle_drive'
    | 's1_ownership'
    | 's1_auto_loan'
    | 's1_credit'
    | 's1_co_app_decision'
    | 's1_co_app_contact'
    | 's1_co_app_employment'
    | 's1_applicant'
    | 's1_housing'
    | 's1_employment'
    | 's1_identity_consent'
    | 'decision_engine'
    | 'stage2_result';

export interface WizardDevOptions {
  // UI settings
  persona: Persona;
  personaLocked: boolean;
  showJson: boolean;
  prefillJson: string;
  // Force outcomes
  forcePartner: Partner | 'auto';
  forceResult: string;
  disqualReason: DisqualReason;
  includeSsn: boolean;
  coAppOverride: 'auto' | 'yes' | 'no';
  // Org config
  orgConfig: OrgConfig;
  orgConfigJson: string;
  orgConfigError?: string;
  // Cross-sell
  hasCoApp?: boolean;
  embeddedState?: string | Record<string, unknown>;
}

export interface FormState {
  form: RefiForm;
  update: (updates: Partial<RefiForm>) => void;
  applyPrefill: (payload: PrefillPayload) => void;
  resetAll: () => void;
}

export interface WizardNav {
  screen: ScreenKey;
  goToScreen: (key: ScreenKey) => void;
  sequence: ScreenKey[];
}

export interface StepChangeContext {
  direction: 'next' | 'back';
  from: ScreenKey;
}

export interface ScreenProps {
  form: RefiForm;
  update: (updates: Partial<RefiForm>) => void;
  onNext: () => void;
  onBack?: () => void;
  dev?: Partial<WizardDevOptions>;
}
