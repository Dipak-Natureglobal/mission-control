import { Suspense, lazy, useState } from 'react';
import { X } from 'lucide-react';

// AddVehicleModal — centered backdrop modal that mounts refi-portal's
// public VehicleAdd component. The refi screen is a fullscreen-style flow
// (header + fields + Footer with "Continue") so we let it fill the modal
// body; the modal owns the chrome (centered card, X close, backdrop click).
//
// Props:
//   open    — boolean; controls mount
//   onClose — fired on X / backdrop click / Escape
//   onAdd   — receives the new vehicle record (canon `vehicles` shape)
//             and is responsible for closing the modal as needed.
//
// Form state is local to the modal (seeded with the vehicle slice of
// refi-portal's INITIAL_FORM). When refi-portal's VehicleAdd fires
// onNext (its Continue handler), we build a vehicle record from the
// form and hand it to onAdd.
//
// Lazy import: refi-portal/src/views/customer/index.js. HMR caveat per
// architecture/02-integration-boundaries.md — restart `npm run dev` after
// any source-side change in refi-portal.

const VehicleAdd = lazy(() =>
  import('refi-portal/src/views/customer').then((m) => ({ default: m.VehicleAdd })),
);

// Seed local form with the vehicle slice of refi-portal's INITIAL_FORM. We
// don't import INITIAL_FORM directly here — only the vehicle fields the
// VehicleAdd screen reads/writes. Keeps the seam small.
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

// Build a canon vehicle record from VehicleAdd's form state. Source is
// vin_decode if the user entered a VIN that decoded successfully, else
// manual. Mileage/ownership/value are not collected here (VehicleAdd is
// YMMT + VIN only — fuller capture happens later in the workflow).
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

export function AddVehicleModal({ open, onClose, onAdd }) {
  const [form, setForm] = useState(INITIAL_VEHICLE_FORM);

  if (!open) return null;

  const update = (patch) => {
    setForm((prev) => ({
      ...prev,
      ...(typeof patch === 'function' ? patch(prev) : patch),
    }));
  };

  function handleNext() {
    const vehicle = buildVehicleRecord(form);
    onAdd(vehicle);
    // Reset for next open
    setForm(INITIAL_VEHICLE_FORM);
  }

  function handleClose() {
    setForm(INITIAL_VEHICLE_FORM);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="text-sm font-semibold text-slate-900">Add vehicle</div>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto py-4">
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-12 text-sm text-slate-400">
                Loading vehicle form…
              </div>
            }
          >
            <VehicleAdd form={form} update={update} onNext={handleNext} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
