import { Suspense, lazy, useState } from 'react';
import { ChevronLeft, Plus, X } from 'lucide-react';

// NewOpportunityFlow — multi-step modal for the "+ New opportunity"
// workflow when no vehicle is preselected (e.g., from the ContactProfile
// header dropdown). The opportunity type is already chosen by the caller;
// this modal handles vehicle selection (or adds a new vehicle) and hands
// the (vehicle, type, flowPath) tuple back via onPicked.
//
// Steps:
//   1. 'pick'       — card grid of contact.vehicles + a dashed "+ Add new
//                     vehicle" tile. Click a vehicle → onPicked(vehicle).
//                     Click "+ Add new vehicle" → step = 'add'.
//   2. 'add'        — refi-portal VehicleAdd inline (same lazy import as
//                     AddVehicleModal). On Continue, the new vehicle
//                     record is built, persisted via onAddVehicle (the
//                     caller's appendVehicleToContact wrapper), and
//                     auto-advance: onPicked(vehicle) fires immediately.
//
// Props:
//   open          — boolean
//   type          — opportunity type string (informational; rendered in
//                   the header so the agent knows what they picked)
//   typeLabel     — human label for `type`
//   flowPath      — 'capture_and_quote' | 'quote_only' | undefined.
//                   Echoed into the header for insurance flows.
//   contact       — contact record (vehicles[] are the picker source)
//   onAddVehicle  — fn(vehicle) — caller is responsible for persisting
//                   it (typically appendVehicleToContact bound to
//                   contactId).
//   onPicked      — fn(vehicle) — fired when user picks/adds a vehicle.
//                   Caller is responsible for closing the modal as part
//                   of opp creation.
//   onClose       — fn() — backdrop / X / Escape (no opp created).

const VehicleAdd = lazy(() =>
  import('refi-portal/src/views/customer').then((m) => ({ default: m.VehicleAdd })),
);

const INITIAL_VEHICLE_FORM = {
  vin: '',
  vinDecoded: false,
  vinDecodeLoading: false,
  vinDecodeError: null,
  _lastDecodedVin: null,
  year: null,
  make: '',
  model: '',
  trim: '',
};

function buildVehicleRecord(form) {
  const id = `veh_session_${
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now()
  }`;
  const source = form.vinDecoded ? 'vin_decode' : 'manual';
  return {
    id,
    year: form.year,
    make: form.make,
    model: form.model,
    trim: form.trim,
    vin: form.vin || null,
    source,
    source_recorded_at: new Date().toISOString(),
  };
}

export function NewOpportunityFlow({
  open,
  type,
  typeLabel,
  flowPath,
  contact,
  onAddVehicle,
  onPicked,
  onClose,
}) {
  const [step, setStep] = useState('pick');
  const [form, setForm] = useState(INITIAL_VEHICLE_FORM);

  if (!open || !contact) return null;

  const update = (patch) => {
    setForm((prev) => ({
      ...prev,
      ...(typeof patch === 'function' ? patch(prev) : patch),
    }));
  };

  function reset() {
    setStep('pick');
    setForm(INITIAL_VEHICLE_FORM);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleVehicleAdd() {
    const vehicle = buildVehicleRecord(form);
    if (onAddVehicle) onAddVehicle(vehicle);
    onPicked(vehicle);
    reset();
  }

  const subtitle =
    flowPath === 'quote_only'
      ? `${typeLabel} · quote only`
      : flowPath === 'capture_and_quote'
        ? `${typeLabel} · capture + quote`
        : typeLabel;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2 min-w-0">
            {step === 'add' && (
              <button
                onClick={() => {
                  setStep('pick');
                  setForm(INITIAL_VEHICLE_FORM);
                }}
                className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 shrink-0"
                aria-label="Back"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 truncate">
                New opportunity
              </div>
              <div className="text-[11px] text-slate-500 truncate">{subtitle}</div>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {step === 'pick' ? (
            <VehiclePickerStep
              vehicles={contact.vehicles}
              onPick={(v) => onPicked(v)}
              onAddNew={() => setStep('add')}
              type={type}
            />
          ) : (
            <Suspense
              fallback={
                <div className="flex items-center justify-center py-12 text-sm text-slate-400">
                  Loading vehicle form…
                </div>
              }
            >
              <div className="py-4">
                <VehicleAdd form={form} update={update} onNext={handleVehicleAdd} />
              </div>
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}

function VehiclePickerStep({ vehicles, onPick, onAddNew }) {
  return (
    <div className="px-5 py-4">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-2">
        Pick a vehicle
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {vehicles.map((v) => {
          const vinSuffix = v.vin ? v.vin.slice(-6) : null;
          return (
            <button
              key={v.id}
              onClick={() => onPick(v)}
              className="text-left bg-slate-50 ring-1 ring-slate-200 hover:ring-blue-400 hover:bg-blue-50 rounded-md p-3 transition-colors"
            >
              <div className="text-sm font-semibold text-slate-900">
                {v.year} {v.make} {v.model}
                {v.trim && <span className="text-slate-500 font-normal"> {v.trim}</span>}
              </div>
              {vinSuffix && (
                <div className="text-[11px] font-mono text-slate-500 mt-1">
                  VIN · …{vinSuffix}
                </div>
              )}
            </button>
          );
        })}
        <button
          onClick={onAddNew}
          className="text-left rounded-md p-3 border-2 border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50 text-slate-500 hover:text-blue-700 flex items-center gap-2 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span className="text-sm font-medium">Add new vehicle</span>
        </button>
      </div>
    </div>
  );
}
