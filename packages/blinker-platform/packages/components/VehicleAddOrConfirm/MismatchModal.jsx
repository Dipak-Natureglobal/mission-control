// MismatchModal — two side-by-side cards comparing the VinAudit-decoded
// YMMT against the user's manual selection. User picks "Use VIN result" or
// "Keep my selection". Per the protection-portal locked decision (driven
// by the legacy production Bronco→Bronco-Sport silent substitution bug):
// never silently substitute. The reason copy spells out that these are
// different vehicles so the user can't dismiss the difference as a typo.
//
// Wave 17 P1 lift: source =
//   protection-portal/src/views/customer/VehicleAdd.jsx:343-410
// (MismatchModal + MismatchCard + Row sub-components, byte-equivalent).
//
// Only used when the merged VehicleAddOrConfirm runs with `requireVin=false`
// (i.e. the manual-pick path is reachable). Under `requireVin=true` the
// pickers are hidden and decoded YMMT auto-fills, so a user-vs-decode
// mismatch can't arise.
import { AlertTriangle, X, Wand2, Hand } from 'lucide-react';

const ymmtFields = ['year', 'make', 'model', 'trim'];

export function ymmtEquals(a, b) {
  if (!a || !b) return false;
  return ymmtFields.every(
    (k) =>
      String(a[k] ?? '').trim().toLowerCase() ===
      String(b[k] ?? '').trim().toLowerCase(),
  );
}

export function ymmtLabel(v) {
  return ymmtFields.map((k) => v?.[k]).filter(Boolean).join(' ') || '—';
}

export function MismatchModal({ decoded, manual, onChoose, onClose }) {
  const reason = `Your VIN decoded as a ${ymmtLabel(decoded)} but you selected ${ymmtLabel(manual)} — these are different vehicles. Pick which one is correct.`;
  return (
    <div className="fixed inset-0 bg-slate-900 bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div
        className="bg-white rounded-xl shadow-xl max-w-2xl w-full overflow-hidden flex flex-col"
        style={{ maxHeight: '90vh' }}
      >
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
        <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
          {heading}
        </div>
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
      <span className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
        {k}
      </span>
      <span className="font-medium text-slate-900">{String(v)}</span>
    </div>
  );
}
