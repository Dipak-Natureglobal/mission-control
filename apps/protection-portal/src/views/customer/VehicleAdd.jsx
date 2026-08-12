// Customer view · Step 1 — Vehicle Add.
// Lifted from refi-prototype/src/refinance-v2-prototype.jsx (~L1815)
// and adapted to the protection-portal context.
//
// Locked decision (STATUS.md decision log, README.md "decisions log"):
// VIN OR manual YMMT, mismatch = confirmation step (never silent).
// Driven by legacy production bug — silent Bronco → Bronco Sport
// substitution. This screen supports both flows symmetrically:
//
//   * VIN-first  : enter a VIN → decoded YMMT auto-fills the picker fields,
//                  user can still tap any field to override.
//   * Manual-first: pick YMMT → user can later enter a VIN; if the decoded
//                  YMMT differs from the selected YMMT, Continue opens a
//                  confirmation modal showing both side-by-side.
//
// On mismatch confirmation, the user picks "Use VIN result" or "Keep my
// selection". Either choice is persisted on form.vehicle.source so
// downstream screens (and the agent view) can see how YMMT was resolved.
import { useEffect, useRef, useState } from 'react';
import { Car, ScanLine, Loader2, CheckCircle2, AlertCircle, AlertTriangle, X, Wand2, Hand } from 'lucide-react';
import { ScreenHeader, WizardFooter } from 'blinker-platform/components';
import { Field } from 'blinker-platform/components';
import { PickerField, YmmtPicker } from '../../shared/YmmtPicker.jsx';
import {
  YMMT_DATA,
  YMMT_MAKES,
  validators,
  fetchVinDecode,
  ymmtMatch,
  mapVinAuditTypeToSeAssetType,
  getAssetTypeForMakeModel,
} from 'blinker-platform/utils';
import { track } from 'blinker-platform/telemetry';


const ymmtFields = ['year', 'make', 'model', 'trim'];

function ymmtEquals(a, b) {
  if (!a || !b) return false;
  return ymmtFields.every((k) => String(a[k] ?? '').trim().toLowerCase() === String(b[k] ?? '').trim().toLowerCase());
}

function ymmtLabel(v) {
  return ymmtFields.map((k) => v?.[k]).filter(Boolean).join(' ') || '—';
}

export function VehicleAdd({ form, update, onNext }) {
  const [picker, setPicker] = useState(null);
  const [mismatch, setMismatch] = useState(null); // { decoded, manual } or null
  const vinDecodeRef = useRef(null);

  const vinError = validators.vin(form.vin);
  const hasVin = form.vin && !vinError;
  const ok = form.year && form.make && form.model && form.trim;

  useEffect(() => {
    track('protection.customer.vehicle_add.viewed');
  }, []);

  // Auto-decode VIN once it's a valid 17-char string. 500ms debounce so
  // we don't fire mid-typing. The decoded result is stashed on
  // form.decodedYmmt; the picker fields auto-fill ONLY when the user
  // hasn't manually selected anything yet — so manual-first selections
  // are preserved and surfaced later as a mismatch on Continue.
  useEffect(() => {
    if (vinDecodeRef.current) clearTimeout(vinDecodeRef.current);
    if (!hasVin) return;
    if (form._lastDecodedVin === form.vin) return;

    update({ vinDecodeLoading: true, vinDecodeError: null });

    vinDecodeRef.current = setTimeout(async () => {
      track('protection.customer.vehicle_add.vin_decode_started', { vin: form.vin });
      const result = await fetchVinDecode(form.vin);
      if (result.error) {
        track('protection.customer.vehicle_add.vin_decode_failed', { error: result.error });
        update({ vinDecodeLoading: false, vinDecodeError: result.error });
        return;
      }

      const matchedMake = ymmtMatch(YMMT_MAKES, result.make);
      const makeModels = matchedMake && YMMT_DATA[matchedMake] ? Object.keys(YMMT_DATA[matchedMake]).sort() : [];
      const matchedModel = ymmtMatch(makeModels, result.model);
      const modelTrims = matchedMake && matchedModel && YMMT_DATA[matchedMake][matchedModel]
        ? YMMT_DATA[matchedMake][matchedModel]
        : [];
      const matchedTrim = ymmtMatch(modelTrims, result.trim);

      const decodedYmmt = {
        year: result.year || null,
        make: matchedMake || result.make || '',
        model: matchedModel || result.model || '',
        trim: matchedTrim || (result.trim && modelTrims.length === 0 ? result.trim : ''),
        // Wave 23-fu2: asset_type derived from VinAudit body-style string
        // (Sedan/SUV/Pickup/etc.) so SE GetRates receives the correct P/T/AL
        // code rather than the former hardcoded 'T'.
        asset_type: mapVinAuditTypeToSeAssetType(result.type),
        // The raw VinAudit values, before YMMT normalization. Surfaced in
        // the mismatch modal so the user can see exactly what the VIN said.
        raw: {
          year: result.year || null,
          make: result.make || '',
          model: result.model || '',
          trim: result.trim || '',
        },
      };

      const patch = {
        vinDecoded: true,
        vinDecodeLoading: false,
        vinDecodeError: null,
        _lastDecodedVin: form.vin,
        decodedYmmt,
      };

      // Auto-fill the picker fields when the user hasn't manually edited
      // them yet. After they manually edit anything, the decoded values
      // stay parked on form.decodedYmmt and surface only via the mismatch
      // modal on Continue.
      if (!form.manuallyEdited) {
        patch.year = decodedYmmt.year ?? form.year;
        patch.make = decodedYmmt.make || form.make;
        patch.model = decodedYmmt.model || form.model;
        if (matchedTrim) {
          patch.trim = matchedTrim;
        } else if (result.trim && modelTrims.length > 0) {
          patch.trim = '';
          patch.vinDecodeError = `Trim "${result.trim}" not in list — please select.`;
        } else if (result.trim) {
          patch.trim = result.trim;
        }
      }

      track('protection.customer.vehicle_add.vin_decoded', {
        vin: form.vin,
        decoded_year: decodedYmmt.year,
        decoded_make: decodedYmmt.make,
        decoded_model: decodedYmmt.model,
        decoded_trim: decodedYmmt.trim,
        applied_to_form: !form.manuallyEdited,
      });
      update(patch);
    }, 500);

    return () => { if (vinDecodeRef.current) clearTimeout(vinDecodeRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.vin]);

  // When the VIN is cleared or made invalid, drop the decoded snapshot.
  // We DON'T wipe the user's selected YMMT — they may have manually
  // picked it before deciding to clear the VIN.
  useEffect(() => {
    if (!hasVin && form.vinDecoded) {
      update({
        vinDecoded: false,
        vinDecodeLoading: false,
        vinDecodeError: null,
        _lastDecodedVin: null,
        decodedYmmt: null,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasVin]);

  // Wrap update so any direct picker change marks the form as
  // manually-edited — used by the auto-fill guard above.
  function pickerUpdate(patch) {
    update({ ...patch, manuallyEdited: true });
  }

  function selectedYmmt() {
    return { year: form.year, make: form.make, model: form.model, trim: form.trim };
  }

  function persistVehicleAndAdvance(source) {
    // Wave 23-fu2: resolve asset_type at submit time. VIN-decoded type
    // takes precedence; YMMT lookup fills in when VIN path is absent or
    // returned no body-style. Null is acceptable — stoneeagle.js defaults to 'P'.
    const resolvedAssetType =
      form.decodedYmmt?.asset_type ||
      getAssetTypeForMakeModel(form.make, form.model) ||
      null;
    update({
      vehicle: {
        year: form.year,
        make: form.make,
        model: form.model,
        trim: form.trim,
        vin: form.vin || null,
        asset_type: resolvedAssetType,
        source, // 'vin' | 'manual' | 'vin_confirmed' | 'manual_confirmed_vs_vin'
      },
    });
    track('protection.customer.vehicle_add.continued', {
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
    const decoded = form.decodedYmmt;
    const manual = selectedYmmt();
    const haveDecoded = decoded && (decoded.year || decoded.make || decoded.model || decoded.trim);

    if (haveDecoded && !ymmtEquals(decoded, manual)) {
      track('protection.customer.vehicle_add.vin_mismatch_shown', {
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
    track('protection.customer.vehicle_add.vin_mismatch_confirmed', {
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
          // Wave 23-fu2: VIN-decode path sets asset_type from decoded snapshot.
          asset_type: decoded.asset_type || getAssetTypeForMakeModel(decoded.make, decoded.model) || null,
          source: 'vin_confirmed',
        },
      });
      track('protection.customer.vehicle_add.continued', {
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
        subtitle="Enter a VIN to decode automatically, or pick year, make, model, and trim manually."
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
            <CheckCircle2 className="w-3 h-3" /> VIN decoded — {ymmtLabel(form.decodedYmmt)}
          </div>
        )}
        {form.vinDecodeError && !form.vinDecodeLoading && (
          <div className="text-xs text-amber-700 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> {form.vinDecodeError}
          </div>
        )}

        <div className="flex items-center gap-3 my-2">
          <div className="flex-1 h-px bg-slate-200" />
          <span className="text-xs text-slate-400 font-semibold">{form.vinDecoded ? 'CONFIRM OR EDIT' : 'OR'}</span>
          <div className="flex-1 h-px bg-slate-200" />
        </div>

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

        {form.year && form.make && form.model && !form.trim && (
          <div className="text-xs text-amber-700 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> Trim is required to continue.
          </div>
        )}
      </div>

      <WizardFooter onNext={handleNext} disabled={!ok} nextLabel="Continue" />

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

// Two side-by-side cards, "Use VIN result" / "Keep my selection". The
// reason copy spells out that these are different vehicles so the user
// can't dismiss the difference as a typo. Per locked decision: never
// silently substitute.
function MismatchModal({ decoded, manual, onChoose, onClose }) {
  const reason = `Your VIN decoded as a ${ymmtLabel(decoded)} but you selected ${ymmtLabel(manual)} — these are different vehicles. Pick which one is correct.`;
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
            heading="Your selection"
            ymmt={manual}
            actionLabel="Keep my selection"
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
