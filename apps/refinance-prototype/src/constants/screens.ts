import type { RefiForm, ScreenKey } from '../types';

export const SCREEN_LABELS: Record<string, string> = {
    embedded_entry: 'Embedded quote card',
    vehicle_add: 'V1 Add vehicle',
    vehicle_drive: 'V2 How much do you drive?',
    s1_ownership: 'S1.1 Ownership',
    s1_auto_loan: 'S1.2 Auto loan',
    s1_credit: 'S1.3 Self-reported credit',
    s1_co_app_decision: 'Co-applicant?',
    s1_co_app_contact: 'Co-app contact',
    s1_co_app_employment: 'Co-app employment',
    s1_applicant: 'S1.4 Applicant',
    s1_housing: 'S1.5 Housing',
    s1_employment: 'S1.6 Employment',
    s1_identity_consent: 'S1.7 Identity & consent',
    decision_engine: 'Decision engine',
    stage2_result: 'Stage 2 result',
};

export const STAGE1_TERMINUS: ScreenKey = 's1_identity_consent';

export function getSequence(form: RefiForm, hasCoApp: boolean): ScreenKey[] {
    const isPoor = form.creditBand === '300_579';
    const coAppDetails: ScreenKey[] = hasCoApp
        ? ['s1_co_app_contact', 's1_co_app_employment']
        : [];
    const middle: ScreenKey[] = isPoor
        ? ['s1_co_app_decision', ...coAppDetails, 's1_applicant', 's1_housing', 's1_employment']
        : ['s1_applicant', 's1_housing', 's1_employment', 's1_co_app_decision', ...coAppDetails];
    return [
        'vehicle_add',
        'vehicle_drive',
        's1_ownership',
        's1_auto_loan',
        's1_credit',
        ...middle,
        's1_identity_consent',
        'decision_engine',
        'stage2_result',
    ];
}
