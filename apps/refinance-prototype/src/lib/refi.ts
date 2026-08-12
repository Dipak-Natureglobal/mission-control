// refi-portal public lib surface — pure decision engine + a thin React hook
// wrapper. This is the "logic substrate" for the refi workflow:
//
//   runDecision({ form, orgConfig, forcePartner, forceResult, includeSsn,
//                 disqualReason, hasCoApp })
//     -> { partner, partnerName, partnerPhone, result, reason, ruleId,
//          log, externalApplicationId, valuation }
//
//   useRefiPrequal({ contactId, vehicleId })
//     -> { submitPrequal, prequalState, decision, offers, reset }
//
// The decision engine is a verbatim port of refinance-v2-prototype.tsx's
// runDecision() (around line 955 of the monolith) — we swapped closed-over
// `dev.*` references for explicit parameters and `form.*` for the `form`
// argument. The algorithm itself is unchanged. Public ergonomics:
//   * `forcePartner` / `forceResult` accept "auto" sentinel (drop into
//     rule-based eval) or an explicit value (skip rules and route).
//   * `hasCoApp` is the resolved boolean — caller is expected to apply
//     dev.coAppOverride before passing in (the prototype's
//     `effectiveHasCoApp` derivation).
//   * `includeSsn` defaults to true. SSN absence routes to Savings Group.
//   * `disqualReason` is the fallback reason string when the result is
//     forced to "disqualified" but no rule fires.
//
// Consumed by:
//   - src/views/customer/RefiWizard.tsx (wired in § 1.5e)
//   - src/views/agent/AgentView.tsx (planned § 1.5c)
//   - protection-portal/src/views/customer/RecommendedCoverage.tsx (planned § 1.5d)
//     via the public PrequalForm export, which calls useRefiPrequal internally.

import { useState, useCallback, useMemo } from 'react';
import {
  DISQUAL_REASONS,
  PARTNER_NAMES,
  ROUTING_PHONE,
  ageYears,
} from '../refinance-v2-prototype';
import { DEFAULT_ORG_CONFIG } from '../constants/org-config';
import { MOCK_OFFERS } from '../constants/mock-data';
import type {
  RefiForm,
  Decision,
  RunDecisionParams,
  ScreenKey,
  DecisionLogEntry,
  Partner,
  DecisionResult,
  DisqualReason,
  CreditBand,
  WizardDevOptions,
} from '../types';

// Re-export the canonical disqual reasons + partner metadata so consumers
// (UI, copy variants) can render messaging without reaching into the monolith.
export { DISQUAL_REASONS, DEFAULT_ORG_CONFIG, PARTNER_NAMES, ROUTING_PHONE };

/**
 * getSequence — return the ordered Stage-1 step keys for the refi wizard.
 */
export function getSequence(form: RefiForm, hasCoApp: boolean): ScreenKey[] {
  const isPoor = form.creditBand === '300_579';
  const coAppDetails = hasCoApp ? ['s1_co_app_contact', 's1_co_app_employment'] : [];
  const middle = isPoor
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
  ] as ScreenKey[];
}

/**
 * runDecision — pure synchronous evaluation of refi prequal eligibility.
 */
export function runDecision({
  form = {} as RefiForm,
  orgConfig = DEFAULT_ORG_CONFIG,
  forcePartner = 'auto',
  forceResult = 'auto',
  includeSsn = true,
  disqualReason = 'credit_out_of_range',
  hasCoApp = false,
}: Partial<RunDecisionParams> = {}): Decision {
  const log: DecisionLogEntry[] = [];
  const cfg = orgConfig || DEFAULT_ORG_CONFIG;
  let partner: Partner | 'auto' = forcePartner as Partner | 'auto';
  let result: DecisionResult | 'auto' = forceResult as DecisionResult | 'auto';
  let reason: DisqualReason | null = null;
  let ruleId: string | null = null;

  if (partner === 'auto' && result === 'auto') {
    const age = ageYears(form.dob);
    const ageOk = age === null || age >= 18;
    log.push({
      step: 'Check applicant age',
      ok: ageOk,
      detail: age !== null ? `${age} years old` : 'DOB not entered yet',
    });
    if (!ageOk) {
      partner = 'none';
      result = 'disqualified';
      reason = 'under_18';
    }

    if (partner === 'auto' && form.year) {
      const vehicleAge = new Date().getFullYear() - Number(form.year);
      const vehicleAgeOk = vehicleAge <= cfg.maxVehicleAgeYears;
      log.push({
        step: 'Check vehicle age',
        ok: vehicleAgeOk,
        detail: `${vehicleAge} years old · max ${cfg.maxVehicleAgeYears}`,
      });
      if (!vehicleAgeOk) {
        partner = 'none';
        result = 'disqualified';
        reason = 'vehicle_too_old';
      }
    }

    if (
      partner === 'auto' &&
      form.mileage !== null &&
      form.mileage !== undefined
    ) {
      const mileageNum = Number(form.mileage);
      const mileageOk = mileageNum <= cfg.maxMileage;
      log.push({
        step: 'Check odometer',
        ok: mileageOk,
        detail: `${mileageNum.toLocaleString()} mi · max ${cfg.maxMileage.toLocaleString()}`,
      });
      if (!mileageOk) {
        partner = 'none';
        result = 'disqualified';
        reason = 'mileage_too_high';
      }
    }

    if (partner === 'auto' && form.ownership) {
      const ownershipOk = (cfg.eligibleOwnership || []).includes(form.ownership);
      log.push({
        step: 'Check ownership status',
        ok: ownershipOk,
        detail: `${form.ownership} · eligible ${JSON.stringify(cfg.eligibleOwnership)}`,
      });
      if (!ownershipOk) {
        partner = 'none';
        result = 'disqualified';
        reason = 'ownership_ineligible';
      }
    }

    if (
      partner === 'auto' &&
      form.payoff !== '' &&
      form.payoff !== null &&
      form.payoff !== undefined
    ) {
      const payoffNum = Number(String(form.payoff).replace(/[^0-9.]/g, ''));
      const payoffOk = payoffNum >= cfg.minPayoff;
      log.push({
        step: 'Check estimated payoff',
        ok: payoffOk,
        detail: `$${payoffNum.toLocaleString()} · min $${cfg.minPayoff.toLocaleString()}`,
      });
      if (!payoffOk) {
        partner = 'none';
        result = 'disqualified';
        reason = 'payoff_below_min';
      }
    }

    if (
      partner === 'auto' &&
      form.payoff !== '' && form.payoff != null &&
      form.valuationMarketCheckPrice != null && form.valuationMarketCheckPrice > 0 &&
      form.creditBand
    ) {
      const payoffNum = Number(String(form.payoff).replace(/[^0-9.]/g, ''));
      const vehicleVal = Number(form.valuationMarketCheckPrice);
      const ltv = payoffNum / vehicleVal;
      const maxLtvForBand = (cfg.maxLtv || {})[form.creditBand];
      const ltvOk = maxLtvForBand == null || ltv < maxLtvForBand;
      log.push({
        step: 'Check LTV (Loan-to-Value)',
        ok: ltvOk,
        detail: `LTV ${(ltv * 100).toFixed(1)}% · payoff $${payoffNum.toLocaleString()} / value $${vehicleVal.toLocaleString()} · max ${
          maxLtvForBand != null ? (maxLtvForBand * 100).toFixed(0) + '%' : 'n/a'
        }`,
      });
      if (!ltvOk) {
        partner = 'none';
        result = 'disqualified';
        reason = 'ltv_too_high';
      }
    }

    if (partner === 'auto' && form.creditBand === '300_579' && !hasCoApp) {
      log.push({
        step: 'Check credit + co-applicant',
        ok: false,
        detail: 'Poor credit band (300–579) with no co-applicant',
      });
      partner = 'none';
      result = 'disqualified';
      reason = 'credit_requires_coapp';
    }

    if (
      partner === 'auto' &&
      form.employmentType &&
      (cfg.restrictedEmploymentTypes || []).includes(form.employmentType) &&
      (cfg.restrictedEmploymentCreditBands || []).includes(form.creditBand as CreditBand)
    ) {
      log.push({
        step: 'Check employment + credit',
        ok: false,
        detail: `${form.employmentType} with ${form.creditBand} band`,
      });
      partner = 'none';
      result = 'disqualified';
      reason = 'employment_and_credit';
    }

    if (
      partner === 'auto' &&
      form.income !== '' &&
      form.income !== null &&
      form.income !== undefined
    ) {
      const incomeNum = Number(String(form.income).replace(/[^0-9.]/g, ''));
      const incomeOk = incomeNum >= cfg.minAnnualIncome;
      log.push({
        step: 'Check annual income',
        ok: incomeOk,
        detail: `$${incomeNum.toLocaleString()} · min $${cfg.minAnnualIncome.toLocaleString()}`,
      });
      if (!incomeOk) {
        partner = 'none';
        result = 'disqualified';
        reason = 'income_below_min';
      }
    }

    if (partner === 'auto') {
      log.push({
        step: 'Check primary consent',
        ok: form.consentConfirmed,
        detail: form.consentConfirmed ? 'Primary consent present' : 'Primary consent missing',
      });
      if (!form.consentConfirmed) {
        partner = 'none';
        result = 'disqualified';
        reason = 'no_consent';
      }
    }

    if (partner === 'auto' && hasCoApp) {
      log.push({
        step: 'Check co-applicant consent',
        ok: form.coAppConsent,
        detail: form.coAppConsent
          ? 'Co-applicant consent present'
          : 'Co-applicant consent missing — falling back to single applicant',
      });
    }

    if (partner === 'auto') {
      log.push({
        step: 'Check SSN',
        ok: includeSsn,
        detail: includeSsn ? 'SSN present' : 'SSN absent — Gravity ineligible',
      });
    }

    if (partner === 'auto') {
      log.push({
        step: 'Match routing rules',
        ok: true,
        detail: `State=${form.state}, band=${form.creditBand || 'unset'}`,
      });
      if (form.creditBand === '300_579') {
        partner = 'none';
        result = 'disqualified';
        reason = 'credit_out_of_range';
        log.push({ step: 'Evaluate credit band', ok: false, detail: 'Below all partner minimums' });
      } else if (!includeSsn) {
        partner = 'savings_group';
        result = 'offers_returned';
        ruleId = 'sg_ga_580plus';
        log.push({ step: 'Fallback to Savings Group', ok: true, detail: 'SG supports no-SSN prequal' });
      } else if (form.creditBand === '580_669') {
        partner = 'savings_group';
        result = 'offers_returned';
        ruleId = 'sg_ga_580plus';
        log.push({ step: 'Route to Savings Group', ok: true, detail: '580-669 band → SG priority' });
      } else {
        partner = 'gravity';
        result = 'pre_approved';
        ruleId = 'gravity_general';
        log.push({ step: 'Route to Gravity', ok: true, detail: '670+ band → Gravity priority' });
      }
    }
  } else if (partner !== 'auto' && result === 'auto') {
    if (partner === 'savings_group') result = 'offers_returned';
    else if (partner === 'gravity') result = 'pre_approved';
    else result = 'disqualified';
  }

  if (result === 'disqualified' && !reason) reason = disqualReason;

  const partnerName = (partner === 'none' || partner === 'auto') ? null : PARTNER_NAMES[partner as Exclude<Partner, 'none'>];
  const partnerPhone = (partner === 'none' || partner === 'auto') ? null : ROUTING_PHONE[partner as Exclude<Partner, 'none'>];

  const payoffForLtv = form.payoff
    ? Number(String(form.payoff).replace(/[^0-9.]/g, ''))
    : null;
  const vehicleValueForLtv = form.valuationMarketCheckPrice
    ? Number(form.valuationMarketCheckPrice)
    : null;
  const computedLtv =
    payoffForLtv && vehicleValueForLtv ? payoffForLtv / vehicleValueForLtv : null;

  return {
    partner: partner as Partner,
    partnerName: partnerName ?? undefined,
    partnerPhone: partnerPhone ?? undefined,
    result: result as DecisionResult,
    reason: reason ?? undefined,
    ruleId: ruleId ?? undefined,
    log,
    externalApplicationId:
      partner === 'gravity'
        ? 'GRV-84721'
        : partner === 'savings_group'
          ? 'SG-12345'
          : undefined,
    valuation: {
      marketcheck_price: form.valuationMarketCheckPrice ?? null,
      retail_price: form.valuationRetailPrice ?? null,
      ltv: computedLtv ?? undefined,
      ltv_pct: computedLtv != null ? `${(computedLtv * 100).toFixed(1)}%` : undefined,
    },
  };
}

interface UseRefiPrequalParams {
  contactId?: string | null;
  vehicleId?: string | null;
}

 
export function useRefiPrequal({ contactId, vehicleId }: UseRefiPrequalParams = {}) {
  const [prequalState, setPrequalState] = useState<'idle' | 'submitted'>('idle');
  const [decision, setDecision] = useState<Decision | null>(null);

  const submitPrequal = useCallback((formData: Partial<RefiForm> = {}, devOptions: Partial<WizardDevOptions> = {}) => {
    const next = runDecision({
      form: formData as RefiForm,
      orgConfig: devOptions.orgConfig,
      forcePartner: devOptions.forcePartner ?? 'auto',
      forceResult: devOptions.forceResult ?? 'auto',
      includeSsn: devOptions.includeSsn ?? true,
      disqualReason: devOptions.disqualReason,
      hasCoApp:
        typeof devOptions.hasCoApp === 'boolean'
          ? devOptions.hasCoApp
          : formData.hasCoApplicant === true,
    });
    setDecision(next);
    setPrequalState('submitted');
    return next;
  }, []);

  const reset = useCallback(() => {
    setPrequalState('idle');
    setDecision(null);
  }, []);

  // Offers list — currently a static mock. Memoized so consumers passing
  // this into deps arrays don't churn.
  const offers = useMemo(
    () => (decision?.result === 'offers_returned' ? MOCK_OFFERS : []),
    [decision]
  );

  return { prequalState, decision, offers, submitPrequal, reset };
}
