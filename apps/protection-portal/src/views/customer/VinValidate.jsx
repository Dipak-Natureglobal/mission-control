// Customer view · Step 9b — Post-payment VIN validation.
//
// Lifted shape from BlinkerLegacy/.../AUDIT-2026-05-02.md § "Consumer
// /vin_check route". Required post-payment IF the package was created
// without a VIN (see CustomerView.shouldRunVinValidate). Single field:
// strict 17-char VIN. On submit:
//   1. Decode via VinAudit (live API; may fail in sandbox CORS — handled).
//   2. If decode succeeds AND decoded YMMT ≠ quoted YMMT → mismatch modal,
//      same locked-decision pattern as VehicleAdd. User picks "Use VIN
//      result" (re-quote risk in production; Phase 1 just records it) or
//      "Keep my selection" (proceed silently with original quote).
//   3. If decode fails or returns no error → just stash form.vehicle.vin
//      and proceed. The agent re-quote step is Phase 2.
//   4. After mismatch resolution (or no mismatch), fire a SECOND SE
//      GetRates call with the VIN attached. Classify the divergence via
//      classifyRatesChange (ADR 17). Branch on kind:
//      - no_change / plan_price_lower / plan_price_higher_within_tolerance
//        → silent advance (no/optional banner), updating price if needed.
//      - ymm_changed / ymmt_changed / vehicle_class_changed
//        → opportunityFlags.vehicle_revised=true, banner, advance.
//      - plan_disappeared / plan_price_higher_outside_tolerance
//        → opportunityFlags.rates_changed=true, stash vinRates +
//          ratesChangeKind + ratesChangeDetail, route to RatesChanged step (Step 9c).
//
// Locked decision still applies: never silently substitute. Same
// MismatchModal copy as VehicleAdd.
import { useEffect, useRef, useState } from 'react';
import { ScanLine, ShieldCheck, Loader2, AlertCircle, AlertTriangle, X, Wand2, Hand, Info } from 'lucide-react';
import { ScreenHeader, WizardFooter } from 'blinker-platform/components';
import { Field } from 'blinker-platform/components';
import { validators, fetchVinDecode, ymmtMatch, YMMT_DATA, YMMT_MAKES, classifyRatesChange } from 'blinker-platform/utils';
import { getRates } from 'blinker-platform/integrations/product_admin';
import { track } from 'blinker-platform/telemetry';
import orgRegistry from '../../constants/canon/org-registry.json';

const ymmtFields = ['year', 'make', 'model', 'trim'];

function ymmtEquals(a, b) {
  if (!a || !b) return false;
  return ymmtFields.every((k) => String(a[k] ?? '').trim().toLowerCase() === String(b[k] ?? '').trim().toLowerCase());
}

function ymmtLabel(v) {
  return ymmtFields.map((k) => v?.[k]).filter(Boolean).join(' ') || '—';
}

function decodeToYmmt(result) {
  const matchedMake = ymmtMatch(YMMT_MAKES, result.make);
  const makeModels = matchedMake && YMMT_DATA[matchedMake] ? Object.keys(YMMT_DATA[matchedMake]).sort() : [];
  const matchedModel = ymmtMatch(makeModels, result.model);
  const modelTrims = matchedMake && matchedModel && YMMT_DATA[matchedMake][matchedModel]
    ? YMMT_DATA[matchedMake][matchedModel]
    : [];
  const matchedTrim = ymmtMatch(modelTrims, result.trim);
  return {
    year: result.year || null,
    make: matchedMake || result.make || '',
    model: matchedModel || result.model || '',
    trim: matchedTrim || (result.trim && modelTrims.length === 0 ? result.trim : ''),
  };
}

// Resolve per-org VIN-validate config from canon. All fields are
// _TODO-defaulted per canon; consume as-configured, not as hardcoded.
function readVinValidateConfig(orgId) {
  const org = orgRegistry.orgs.find((o) => o.id === orgId);
  const cfg = org?.protection_billing?.vin_validate ?? {};
  return {
    marginTolerancePct:        cfg.margin_tolerance_pct        ?? 5,
    allowDownPaymentBypass:    cfg.allow_down_payment_bypass   ?? false,
    autoRefundOnDecline:       cfg.auto_refund_on_decline      ?? true,
    allowOverToleranceProceed: cfg.allow_over_tolerance_proceed ?? false,
  };
}

export function VinValidate({ form, update, onNext }) {
  const [vin, setVin] = useState(form.vehicle?.vin || form.vin || '');
  const [decoding, setDecoding] = useState(false);
  const [decodeError, setDecodeError] = useState(null);
  const [mismatch, setMismatch] = useState(null);
  // Second SE GetRates call state (post-mismatch-resolution).
  const [verifyingRates, setVerifyingRates] = useState(false);
  const [revisionBanner, setRevisionBanner] = useState(null); // { kind, message } | null

  const vinError = validators.vin(vin);
  const ok = vin && !vinError;

  const viewedRef = useRef(false);
  const priorEchoRef = useRef(false);
  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    track('protection.customer.vin_validate.viewed', {
      had_vin_at_quote: !!form.vehicle?.vin,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const quotedYmmt = {
    year: form.vehicle?.year ?? form.year,
    make: form.vehicle?.make || form.make,
    model: form.vehicle?.model || form.model,
    trim: form.vehicle?.trim || form.trim,
  };
  const priorYmmtLabel = ymmtLabel(quotedYmmt);
  const hasPriorYmmt = priorYmmtLabel !== '—';

  // Wave 22 Task 3 — fire once on mount when we actually have a prior
  // YMMT to surface above the input.
  useEffect(() => {
    if (priorEchoRef.current) return;
    if (!hasPriorYmmt) return;
    priorEchoRef.current = true;
    track('protection.customer.vin_validate.prior_ymmt_shown', {
      ymmt: priorYmmtLabel,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPriorYmmt]);

  // Phase 1 pre-flight commit. Called before the second SE GetRates call to
  // persist the VIN + decoded YMMT (if applicable) into form state. Returns
  // the vehicleBefore snapshot so the classifier has both sides.
  function commitVinToForm(source, decodedYmmt = null) {
    const nextVehicle = {
      ...(form.vehicle || {}),
      year: form.vehicle?.year ?? form.year,
      make: form.vehicle?.make || form.make,
      model: form.vehicle?.model || form.model,
      trim: form.vehicle?.trim || form.trim,
      vin,
      source,
    };
    update({
      vin,
      vehicle: nextVehicle,
      vinValidate: { vin, source, decodedYmmt, validatedAt: new Date().toISOString() },
    });
    track('protection.customer.vin_validate.completed', { source, vin });
    return { vehicle: nextVehicle };
  }

  // Core second-SE-GetRates flow. Called after VinAudit pre-flight resolves.
  // vehicleForRates is the committed vehicle (may have been updated to decoded
  // YMMT if user picked "Use VIN result").
  async function runRatesVerification(vehicleForRates) {
    setVerifyingRates(true);

    const { marginTolerancePct } = readVinValidateConfig(form.org_id);
    const stateForRates = form.contact?.state ?? form.state ?? null;

    let vinRates;
    try {
      vinRates = await getRates({
        year:       vehicleForRates.year  ?? form.year,
        make:       vehicleForRates.make  || form.make,
        model:      vehicleForRates.model || form.model,
        trim:       vehicleForRates.trim  || form.trim,
        mileage:    form.mileage,
        condition:  form.condition,
        vin,
        state:      stateForRates,
        asset_type: vehicleForRates.asset_type ?? form.vehicle?.asset_type ?? null,
      }, { orgId: form.org_id });
    } catch (err) {
      // If the VIN-GetRates call itself fails, we gracefully advance as if
      // no_change. Agent inbox will surface for manual review.
      setVerifyingRates(false);
      track('protection.customer.vin_validate.rates_call_failed', {
        vin,
        error: err?.message || 'unknown',
      });
      onNext();
      return;
    }

    setVerifyingRates(false);

    // Build vehicleBefore/vehicleAfter for the classifier.
    const vehicleBefore = {
      year:          vehicleForRates.year  ?? form.year,
      make:          vehicleForRates.make  || form.make,
      model:         vehicleForRates.model || form.model,
      trim:          vehicleForRates.trim  || form.trim,
      vehicle_class: form.rates?.vehicle_class ?? null,
    };
    const vehicleAfter = {
      year:          vehicleForRates.year  ?? form.year,
      make:          vehicleForRates.make  || form.make,
      model:         vehicleForRates.model || form.model,
      trim:          vehicleForRates.trim  || form.trim,
      vehicle_class: vinRates?.vehicle_class ?? null,
    };

    const { kind, detail } = classifyRatesChange({
      ymmtRates:        form.rates,
      vinRates,
      selectedPlan:     form.selectedPlan,
      vehicleBefore,
      vehicleAfter,
      marginTolerancePct,
    });

    track('protection.customer.vin_validate.classified', {
      kind,
      delta_pct: detail?.delta_pct ?? null,
    });

    if (kind === 'no_change') {
      // Silent advance — no banner.
      onNext();
      return;
    }

    if (kind === 'plan_price_lower') {
      // Silently update price + advance.
      const newPlan = { ...(form.selectedPlan || {}), total_cost: detail.vin_price };
      const newSchedule = recomputeSchedule(form.paymentSchedule, detail.vin_price);
      update({ selectedPlan: newPlan, paymentSchedule: newSchedule });
      onNext();
      return;
    }

    if (kind === 'plan_price_higher_within_tolerance') {
      // Show brief banner, update price, advance.
      const newPlan = { ...(form.selectedPlan || {}), total_cost: detail.vin_price };
      const newSchedule = recomputeSchedule(form.paymentSchedule, detail.vin_price);
      update({ selectedPlan: newPlan, paymentSchedule: newSchedule });
      setRevisionBanner({
        kind,
        message: `Your plan price adjusted slightly within our accepted range (+${detail.delta_pct?.toFixed(1) ?? ''}%). Your schedule has been updated.`,
      });
      // Brief banner then advance — let the user see it for a moment then proceed.
      await new Promise((resolve) => setTimeout(resolve, 2000));
      onNext();
      return;
    }

    if (kind === 'ymm_changed' || kind === 'ymmt_changed' || kind === 'vehicle_class_changed') {
      // Update vehicle to vehicleAfter if applicable, set vehicle_revised flag, banner, advance.
      const vehiclePatch = {
        ...(form.vehicle || {}),
        ...vehicleAfter,
        vin,
      };
      update({
        vehicle: vehiclePatch,
        opportunityFlags: { ...(form.opportunityFlags || {}), vehicle_revised: true },
      });
      track('protection.customer.vin_validate.vehicle_revised', { kind });
      setRevisionBanner({
        kind,
        message:
          kind === 'vehicle_class_changed'
            ? `Your vehicle's coverage class was updated based on the VIN. Your plan remains the same.`
            : `Your vehicle details were updated based on the VIN (${
                detail?.ymmt_after
                  ? [detail.ymmt_after.year, detail.ymmt_after.make, detail.ymmt_after.model, detail.ymmt_after.trim].filter(Boolean).join(' ')
                  : 'see below'
              }).`,
      });
      await new Promise((resolve) => setTimeout(resolve, 2200));
      onNext();
      return;
    }

    if (kind === 'plan_disappeared' || kind === 'plan_price_higher_outside_tolerance') {
      // Forced-rebranch: route to RatesChanged step.
      update({
        vinRates,
        ratesChangeKind: kind,
        ratesChangeDetail: detail,
        opportunityFlags: { ...(form.opportunityFlags || {}), rates_changed: true },
      });
      track('protection.customer.vin_validate.rates_changed', { kind });
      onNext(); // buildSteps will now insert 'rates_changed' next (rates_changed flag is true).
      return;
    }

    // Defensive fallback for any future kinds.
    onNext();
  }

  // Shallow recompute of paymentSchedule when the plan price drops/adjusts.
  // Full amortization lives in Confirm's billing logic; this is a proportional
  // scale so the numbers stay coherent until the agent/user reaches Confirm
  // again (or Phase 2 re-runs the server-side compute).
  function recomputeSchedule(schedule, newTotalCost) {
    if (!schedule || !newTotalCost) return schedule;
    const oldTotal = schedule.total_cost ?? schedule.monthly_payment * (schedule.months_to_pay ?? 1);
    if (!oldTotal) return schedule;
    const ratio = newTotalCost / oldTotal;
    return {
      ...schedule,
      total_cost:     newTotalCost,
      monthly_payment: schedule.monthly_payment != null ? Math.round(schedule.monthly_payment * ratio * 100) / 100 : schedule.monthly_payment,
      down_payment:    schedule.down_payment    != null ? Math.round(schedule.down_payment    * ratio * 100) / 100 : schedule.down_payment,
      due_today:       schedule.due_today       != null ? Math.round(schedule.due_today       * ratio * 100) / 100 : schedule.due_today,
    };
  }

  function persistAndAdvance(source, decodedYmmt = null) {
    const { vehicle } = commitVinToForm(source, decodedYmmt);
    // Now fire the second SE GetRates call.
    runRatesVerification(vehicle);
  }

  async function handleSubmit() {
    if (!ok) return;
    setDecoding(true);
    setDecodeError(null);
    let result;
    try {
      result = await fetchVinDecode(vin);
    } catch (err) {
      result = { error: err?.message || 'decode_failed' };
    }
    setDecoding(false);

    if (result?.error) {
      // Graceful failure: VinAudit unavailable (sandbox CORS or otherwise).
      // Per locked-decision spec we don't silently substitute, but if we
      // can't decode at all, we trust the typed VIN and let the user
      // proceed. Agent review picks it up in Phase 2.
      track('protection.customer.vin_validate.matched', {
        decode_unavailable: true,
        reason: result.error,
      });
      setDecodeError(result.error);
      persistAndAdvance('vin_typed_no_decode');
      return;
    }

    const decoded = decodeToYmmt(result);
    if (ymmtEquals(decoded, quotedYmmt)) {
      track('protection.customer.vin_validate.matched', { vin });
      persistAndAdvance('vin_validated', decoded);
      return;
    }

    track('protection.customer.vin_validate.mismatch_shown', {
      vin,
      decoded,
      quoted: quotedYmmt,
    });
    setMismatch({ decoded, quoted: quotedYmmt });
  }

  function chooseMismatchResolution(direction) {
    const decoded = mismatch.decoded;
    const quoted = mismatch.quoted;
    track('protection.customer.vin_validate.mismatch_confirmed', {
      vin,
      direction,
      decoded,
      quoted,
    });
    setMismatch(null);
    if (direction === 'vin') {
      // User opts to use the VIN-decoded vehicle. In production this
      // would re-quote via StoneEagle GetRates and possibly re-charge.
      // Phase 1 just records the choice and proceeds; agent review
      // handles the financial reconciliation.
      update({
        year: decoded.year,
        make: decoded.make,
        model: decoded.model,
        trim: decoded.trim,
      });
      persistAndAdvance('vin_validate_used_decoded', decoded);
    } else {
      // Keep the original quote. Vehicle stays as-quoted. Per audit
      // doc this is what legacy did silently — we make it explicit.
      persistAndAdvance('vin_validate_kept_quoted', decoded);
    }
  }

  return (
    <>
      <ScreenHeader
        icon={ShieldCheck}
        eyebrow="Vehicle · VIN check"
        title="One last step — verify your VIN"
        subtitle="Your payment processed successfully. To finalize coverage, please enter the 17-character VIN from your vehicle's dashboard or driver-side door jamb."
      />

      <div className="px-6 space-y-3">
        {hasPriorYmmt && (
          <div className="border border-slate-200 bg-slate-50 rounded-md px-4 py-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
              You told us:
            </div>
            <div className="text-base font-bold text-slate-900 mt-0.5">
              {priorYmmtLabel}
            </div>
            <div className="text-[11px] text-slate-500 mt-1 leading-relaxed">
              We'll check this against your VIN. If they don't match, we'll ask you to confirm before finalizing the contract.
            </div>
          </div>
        )}

        <Field
          label="VIN (17 characters)"
          value={vin}
          onChange={(v) => setVin(String(v).toUpperCase())}
          placeholder="VIN 1C4PJXAG9SW559532"
          icon={ScanLine}
          error={vin ? vinError : null}
        />

        {decoding && (
          <div className="text-xs text-blue-600 flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Decoding VIN…
          </div>
        )}
        {decodeError && !decoding && (
          <div className="text-xs text-amber-700 flex items-start gap-1">
            <AlertCircle className="w-3 h-3 mt-0.5" />
            VIN decode unavailable — proceeding with the VIN you entered. An agent will verify before coverage activates.
          </div>
        )}

        {/* Second SE GetRates in-flight loading banner. */}
        {verifyingRates && (
          <div className="text-sm text-blue-800 flex items-start gap-2 border border-blue-200 bg-blue-50 rounded-md p-3">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              Verifying your coverage with the VIN. Hang tight — this only takes a moment.
            </div>
          </div>
        )}

        {/* Revision banner for silent-advance kinds (vehicle_revised, within-tolerance). */}
        {revisionBanner && !verifyingRates && (
          <div className="text-sm text-amber-800 flex items-start gap-2 border border-amber-200 bg-amber-50 rounded-md p-3">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>{revisionBanner.message}</div>
          </div>
        )}
      </div>

      <WizardFooter
        onNext={handleSubmit}
        disabled={!ok || decoding || verifyingRates}
        nextLabel={decoding ? 'Verifying…' : verifyingRates ? 'Checking coverage…' : 'Verify VIN'}
      />

      {mismatch && (
        <MismatchModal
          decoded={mismatch.decoded}
          quoted={mismatch.quoted}
          onChoose={chooseMismatchResolution}
          onClose={() => setMismatch(null)}
        />
      )}
    </>
  );
}

// Same shape as VehicleAdd's MismatchModal — duplicated rather than
// extracted because the surrounding language is different ("VIN result"
// vs "your selection" vs "what we quoted"). Could consolidate later if
// the copy converges.
function MismatchModal({ decoded, quoted, onChoose, onClose }) {
  const reason = `Your VIN decoded as a ${ymmtLabel(decoded)} but we quoted a ${ymmtLabel(quoted)} — these are different vehicles. Pick which one is correct so we don't ship the wrong contract.`;
  return (
    <div className="fixed inset-0 bg-slate-900 bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full overflow-hidden flex flex-col" style={{ maxHeight: '90vh' }}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <div className="font-semibold">Confirm your vehicle</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-slate-600 leading-relaxed">{reason}</p>
        </div>
        <div className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <MismatchCard
            heading="From your VIN"
            ymmt={decoded}
            actionLabel="Use VIN result"
            actionIcon={Wand2}
            onClick={() => onChoose('vin')}
          />
          <MismatchCard
            heading="What we quoted"
            ymmt={quoted}
            actionLabel="Keep what we quoted"
            actionIcon={Hand}
            onClick={() => onChoose('manual')}
          />
        </div>
      </div>
    </div>
  );
}

function MismatchCard({ heading, ymmt, actionLabel, actionIcon: Icon, onClick }) {
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden flex flex-col">
      <div className="px-4 py-2 bg-slate-50 border-b border-slate-100">
        <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">{heading}</div>
      </div>
      <div className="px-4 py-3 space-y-1 flex-1">
        <Row k="Year" v={ymmt.year ?? '—'} />
        <Row k="Make" v={ymmt.make || '—'} />
        <Row k="Model" v={ymmt.model || '—'} />
        <Row k="Trim" v={ymmt.trim || '—'} />
      </div>
      <button
        onClick={onClick}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center justify-center gap-2"
      >
        <Icon className="w-4 h-4" /> {actionLabel}
      </button>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-xs uppercase tracking-wide text-slate-500 font-semibold">{k}</span>
      <span className="font-medium text-slate-900">{String(v)}</span>
    </div>
  );
}
