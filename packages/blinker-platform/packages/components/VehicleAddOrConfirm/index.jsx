// VehicleAddOrConfirm — Wave 17 P1 lift.
//
// Single canonical "VIN-or-YMMT entry" surface for the platform. Replaces
// two divergent copies:
//   - refi-portal/src/refinance-v2-prototype.jsx:1873-2050 (ScreenVehicleAdd,
//     re-exported via refi-portal/src/views/customer/VehicleAdd.jsx and
//     consumed by mc + insurance via the lazy import). Contributes:
//       * `requireVin` UI gating + ok-predicate.
//       * extras-injection (form.extraMakes / extraModels / extraTrims) for
//         VinAudit decode results not present in the YMMT_DATA fixture.
//       * two-mode subtitle copy (VIN-first vs OR-divider).
//   - protection-portal/src/views/customer/VehicleAdd.jsx (full file).
//     Contributes:
//       * `manuallyEdited` flag that gates auto-fill (if user touched any
//         picker, decoded YMMT lands on `form.decodedYmmt` only).
//       * MismatchModal on Continue when decoded vs manual disagree (only
//         active under `requireVin=false` — the requireVin=true path hides
//         the pickers so a manual-vs-decode disagreement can't arise).
//       * `vehicle.source` field on commit ('vin' | 'manual' | 'vin_confirmed'
//         | 'manual_confirmed_vs_vin').
//       * 7-event telemetry spine, namespaced via the `telemetryPrefix` prop.
//
// Both behaviors are strict additions that do not regress the other side:
//   - refi's extras-injection can run alongside the manuallyEdited guard
//     because extras are only patched when the auto-fill path runs (i.e.
//     when manuallyEdited=false).
//   - protection's mismatch modal only fires under !requireVin. Under
//     requireVin=true the auto-fill path still runs unconditionally
//     (manuallyEdited can never be set, because pickers are hidden).
//
// Phase 1 = code lifted, no consumers migrated.
// Phase 2 = consumers swap their lazy imports / local copy for this file
// (refi standalone, refi shim, mc StartOpportunityFlow + NewOpportunityFlow
// + AddVehicleModal, insurance AgentView pre-step, protection wizard).
import { useEffect, useRef, useState } from 'react';
import {
  Car,
  ScanLine,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  ScreenHeader,
  WizardFooter,
  Field,
} from 'blinker-platform/components';
import {
  validators,
  fetchVinDecode,
  ymmtMatch,
  YMMT_DATA,
  YMMT_MAKES,
} from 'blinker-platform/utils';
import { track } from 'blinker-platform/telemetry';
import { PickerField } from './PickerField.jsx';
import { YmmtPicker } from './YmmtPicker.jsx';
import { MismatchModal, ymmtEquals, ymmtLabel } from './MismatchModal.jsx';

/**
 * VehicleAddOrConfirm — VIN OR manual YMMT entry with optional mismatch
 * confirmation. Controlled component; parent owns the form slice.
 *
 * @param {object}   props
 * @param {object}   props.form           Required. Controlled state slice.
 *   Recognized fields (extras ignored):
 *     vin, year, make, model, trim,
 *     vinDecoded, vinDecodeLoading, vinDecodeError, _lastDecodedVin,
 *     decodedYmmt, manuallyEdited,
 *     extraMakes, extraModels, extraTrims,
 *     vehicle.
 *   Missing fields are treated as undefined; parents only need to provide
 *   the subset their wizard touches.
 * @param {Function} props.update         Required. (patch) => void.
 *   Shallow-merge writer (matches useForm's contract across the polyrepo).
 * @param {Function} props.onNext         Required. () => void. Wizard advance.
 * @param {boolean}  [props.requireVin]   Default true. When true: VIN+YMMT
 *   both required, OR-divider + Year/Make/Model pickers hidden, subtitle
 *   uses VIN-first copy, mismatch modal disabled. When false: VIN optional,
 *   manual YMMT path always visible, mismatch modal active.
 * @param {string}   [props.telemetryPrefix] Default 'vehicle_add'. Namespace
 *   for the 7 track() events emitted by this component.
 *   Examples:
 *     'refi.customer.vehicle_add'
 *     'protection.customer.vehicle_add'
 *     'mission_control.start_opp.vehicle_add'
 *     'insurance.agent.vehicle_pre_step'
 * @param {Component} [props.Footer]      Default WizardFooter from
 *   blinker-platform/components. Override to swap chrome (refi monolith
 *   uses the `Footer` alias; this prop preserves that compat).
 */
export function VehicleAddOrConfirm({
  form,
  update,
  onNext,
  requireVin = true,
  telemetryPrefix = 'vehicle_add',
  Footer = WizardFooter,
}) {
  const [picker, setPicker] = useState(null); // null | 'year' | 'make' | 'model' | 'trim'
  const [mismatch, setMismatch] = useState(null); // { decoded, manual } or null
  const vinDecodeRef = useRef(null);

  const vinError = validators.vin(form.vin);
  const hasVin = form.vin && !vinError;
  const hasManual = Boolean(form.year && form.make && form.model && form.trim);

  // ok predicate (preserves refi's two-mode contract).
  const vinDecodeOkOrAbsent = !form.vinDecodeError;
  const ok = requireVin
    ? hasVin && hasManual && vinDecodeOkOrAbsent
    : hasManual;

  // Telemetry — `viewed` once on mount.
  useEffect(() => {
    track(`${telemetryPrefix}.viewed`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-decode VIN once it's a valid 17-char string. 500ms debounce so
  // we don't fire mid-typing. The decoded result is stashed on
  // form.decodedYmmt; the picker fields auto-fill ONLY when:
  //   - requireVin=true (no manual override path is reachable), OR
  //   - !form.manuallyEdited (the user hasn't touched a picker).
  // Otherwise the decoded values stay parked on form.decodedYmmt and
  // surface only via the MismatchModal on Continue.
  useEffect(() => {
    if (vinDecodeRef.current) clearTimeout(vinDecodeRef.current);
    if (!hasVin) return;
    if (form.vinDecoded && form.vin === form._lastDecodedVin) return;

    update({ vinDecodeLoading: true, vinDecodeError: null });

    vinDecodeRef.current = setTimeout(async () => {
      track(`${telemetryPrefix}.vin_decode_started`, { vin: form.vin });
      const result = await fetchVinDecode(form.vin);
      if (result.error) {
        track(`${telemetryPrefix}.vin_decode_failed`, { error: result.error });
        update({ vinDecodeLoading: false, vinDecodeError: result.error });
        return;
      }

      // Match decoded make/model/trim to YMMT_DATA (case-insensitive +
      // partial). When a value is NOT in YMMT_DATA, inject it into the
      // corresponding `extra*` array on form so the picker surfaces it,
      // and auto-select it. No error, no friction — Continue stays
      // reachable for legitimate VIN decodes that use values our YMMT
      // fixture happens not to carry.
      const matchedMake = ymmtMatch(YMMT_MAKES, result.make);
      const finalMake = matchedMake || result.make || form.make;
      const extraMakes = !matchedMake && result.make ? [result.make] : [];

      const makeModels = YMMT_DATA[finalMake]
        ? Object.keys(YMMT_DATA[finalMake]).sort()
        : [];
      const matchedModel = ymmtMatch(makeModels, result.model);
      const finalModel = matchedModel || result.model || form.model;
      const extraModels = !matchedModel && result.model ? [result.model] : [];

      const modelTrims =
        YMMT_DATA[finalMake] && YMMT_DATA[finalMake][finalModel]
          ? YMMT_DATA[finalMake][finalModel]
          : [];
      const matchedTrim = ymmtMatch(modelTrims, result.trim);
      const finalTrim = matchedTrim || result.trim || '';
      const extraTrims = !matchedTrim && result.trim ? [result.trim] : [];

      // decodedYmmt — kept always (used by the mismatch modal under
      // !requireVin even when auto-fill was suppressed).
      const decodedYmmt = {
        year: result.year || null,
        make: finalMake || result.make || '',
        model: finalModel || result.model || '',
        trim: finalTrim || '',
        // Raw VinAudit values pre-normalization. Surfaced in the mismatch
        // modal so the user sees exactly what the VIN said.
        raw: {
          year: result.year || null,
          make: result.make || '',
          model: result.model || '',
          trim: result.trim || '',
        },
      };

      const baseline = {
        vinDecoded: true,
        vinDecodeLoading: false,
        vinDecodeError: null,
        _lastDecodedVin: form.vin,
        decodedYmmt,
      };

      // Auto-fill gate — under requireVin=true, fill always. Under
      // !requireVin, fill only when manuallyEdited is falsy.
      const shouldAutoFill = requireVin || !form.manuallyEdited;

      let patch = baseline;
      if (shouldAutoFill) {
        patch = {
          ...baseline,
          year: result.year || form.year,
          make: finalMake,
          model: finalModel,
          trim: finalTrim,
          extraMakes,
          extraModels,
          extraTrims,
        };
      }

      track(`${telemetryPrefix}.vin_decoded`, {
        vin: form.vin,
        decoded_year: decodedYmmt.year,
        decoded_make: decodedYmmt.make,
        decoded_model: decodedYmmt.model,
        decoded_trim: decodedYmmt.trim,
        applied_to_form: shouldAutoFill,
      });
      update(patch);
    }, 500);

    return () => {
      if (vinDecodeRef.current) clearTimeout(vinDecodeRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.vin]);

  // When the VIN is cleared or made invalid, drop the decoded snapshot.
  // Under requireVin=true (refi behavior): also clear the auto-filled
  // YMMT + extras (the user only got those because the VIN decoded).
  // Under !requireVin (protection behavior): preserve the YMMT — the user
  // may have manually picked it before deciding to clear the VIN.
  useEffect(() => {
    if (!hasVin && form.vinDecoded) {
      const reset = {
        vinDecoded: false,
        vinDecodeLoading: false,
        vinDecodeError: null,
        _lastDecodedVin: null,
        decodedYmmt: null,
      };
      if (requireVin) {
        reset.year = null;
        reset.make = '';
        reset.model = '';
        reset.trim = '';
        reset.extraMakes = [];
        reset.extraModels = [];
        reset.extraTrims = [];
      }
      update(reset);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasVin]);

  // Wrap update so any direct picker change marks the form as
  // manually-edited — used by the auto-fill guard above (only meaningful
  // under !requireVin since pickers are hidden under requireVin=true).
  function pickerUpdate(patch) {
    update({ ...patch, manuallyEdited: true });
  }

  function selectedYmmt() {
    return {
      year: form.year,
      make: form.make,
      model: form.model,
      trim: form.trim,
    };
  }

  function persistVehicleAndAdvance(source) {
    update({
      vehicle: {
        year: form.year,
        make: form.make,
        model: form.model,
        trim: form.trim,
        vin: form.vin || null,
        source, // 'vin' | 'manual' | 'vin_confirmed' | 'manual_confirmed_vs_vin'
      },
    });
    track(`${telemetryPrefix}.continued`, {
      via: source,
      year: form.year,
      make: form.make,
      model: form.model,
      trim: form.trim,
      vin_present: !!form.vin,
    });
    onNext();
  }

  function handleNext() {
    // Mismatch modal only fires under !requireVin. Under requireVin=true
    // pickers are hidden so manual selection can't differ from decode.
    const decoded = form.decodedYmmt;
    const manual = selectedYmmt();
    const haveDecoded =
      decoded && (decoded.year || decoded.make || decoded.model || decoded.trim);

    if (
      !requireVin &&
      haveDecoded &&
      form.manuallyEdited &&
      !ymmtEquals(decoded, manual)
    ) {
      track(`${telemetryPrefix}.vin_mismatch_shown`, {
        vin: form.vin,
        decoded,
        manual,
      });
      setMismatch({ decoded, manual });
      return;
    }

    persistVehicleAndAdvance(haveDecoded ? 'vin' : 'manual');
  }

  function chooseMismatchResolution(direction) {
    // direction: 'vin' (use decoded) | 'manual' (keep selection)
    const decoded = mismatch?.decoded;
    const manual = mismatch?.manual;
    track(`${telemetryPrefix}.vin_mismatch_confirmed`, {
      vin: form.vin,
      direction,
      decoded,
      manual,
    });
    setMismatch(null);
    if (direction === 'vin') {
      update({
        year: decoded.year,
        make: decoded.make,
        model: decoded.model,
        trim: decoded.trim,
        manuallyEdited: false,
        vehicle: {
          year: decoded.year,
          make: decoded.make,
          model: decoded.model,
          trim: decoded.trim,
          vin: form.vin || null,
          source: 'vin_confirmed',
        },
      });
      track(`${telemetryPrefix}.continued`, {
        via: 'vin_confirmed',
        year: decoded.year,
        make: decoded.make,
        model: decoded.model,
        trim: decoded.trim,
        vin_present: !!form.vin,
      });
      onNext();
    } else {
      persistVehicleAndAdvance('manual_confirmed_vs_vin');
    }
  }

  return (
    <>
      <ScreenHeader
        icon={Car}
        eyebrow="Vehicle · Add or confirm"
        title="What's in your garage?"
        subtitle={
          requireVin
            ? "Enter the consumer's VIN — we'll decode the year, make, model, and trim automatically."
            : 'Enter a VIN to decode automatically, or pick year, make, model, and trim manually.'
        }
      />
      <div className="px-6 space-y-3">
        <Field
          label="VIN (17 characters)"
          value={form.vin}
          onChange={(v) => update({ vin: v.toUpperCase() })}
          placeholder="VIN 1C4PJXAG9SW559532"
          error={form.vin ? vinError : null}
          icon={ScanLine}
        />
        {form.vinDecodeLoading && (
          <div className="text-xs text-blue-600 flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Decoding VIN…
          </div>
        )}
        {form.vinDecoded && !form.vinDecodeLoading && !form.vinDecodeError && (
          <div className="text-xs text-emerald-700 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> VIN decoded —{' '}
            {requireVin
              ? [form.year, form.make, form.model, form.trim].filter(Boolean).join(' ')
              : ymmtLabel(form.decodedYmmt)}
          </div>
        )}
        {form.vinDecodeError && !form.vinDecodeLoading && (
          <div className="text-xs text-amber-700 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {form.vinDecodeError}
          </div>
        )}

        {!requireVin && (
          <div className="flex items-center gap-3 my-2">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-400 font-semibold">
              {form.vinDecoded ? 'CONFIRM OR EDIT' : 'OR'}
            </span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>
        )}

        {/* Year / Make / Model / Trim pickers only under !requireVin. */}
        {!requireVin && (
          <>
            <PickerField
              label="Year"
              value={form.year || ''}
              onClick={() => setPicker('year')}
            />
            <PickerField
              label="Make"
              value={form.make}
              onClick={() => setPicker('make')}
            />
            <PickerField
              label="Model"
              value={form.model}
              disabled={!form.make}
              disabledHint="Pick a make first"
              onClick={() => setPicker('model')}
            />
            <PickerField
              label="Trim"
              value={form.trim}
              disabled={!form.model}
              disabledHint={!form.model ? 'Pick a model first' : undefined}
              onClick={() => setPicker('trim')}
            />
            {form._yearChangedInvalidatedModel && (
              <div className="text-xs text-amber-700 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {form._yearChangedInvalidatedModel} not available for {form.year} — please
                reselect model.
              </div>
            )}
            {form.year && form.make && form.model && !form.trim && !form._yearChangedInvalidatedModel && (
              <div className="text-xs text-amber-700 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Trim is required to continue.
              </div>
            )}
          </>
        )}
      </div>

      <Footer onNext={handleNext} disabled={!ok} nextLabel="Continue" />

      {picker && (
        <YmmtPicker
          field={picker}
          form={form}
          update={pickerUpdate}
          onClose={() => setPicker(null)}
        />
      )}

      {mismatch && (
        <MismatchModal
          decoded={mismatch.decoded}
          manual={mismatch.manual}
          onChoose={chooseMismatchResolution}
          onClose={() => setMismatch(null)}
        />
      )}
    </>
  );
}
