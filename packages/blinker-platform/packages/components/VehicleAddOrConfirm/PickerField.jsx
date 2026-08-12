// PickerField — read-only "tap to pick" tile shown inline on the
// VehicleAddOrConfirm screen. Tapping it opens the YmmtPicker modal.
//
// Wave 17 P1 lift: byte-equivalent across refi-portal monolith
// (refinance-v2-prototype.jsx:2052-2074) and protection-portal
// (src/shared/YmmtPicker.jsx:10-32). Single source of truth here.
import { ChevronDown } from 'lucide-react';

export function PickerField({ label, value, onClick, disabled, disabledHint }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      className={
        'w-full text-left px-4 py-3 rounded-md border flex items-center justify-between ' +
        (disabled
          ? 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed'
          : value
            ? 'border-blue-200 bg-blue-50 hover:border-blue-300'
            : 'border-slate-200 hover:border-slate-300 bg-white')
      }
    >
      <div className="flex flex-col">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <span className={'text-sm ' + (value ? 'font-medium text-slate-900' : 'text-slate-400')}>
          {value || (disabled ? disabledHint : `Select ${label.toLowerCase()}`)}
        </span>
      </div>
      <ChevronDown className="w-4 h-4 text-slate-400" />
    </button>
  );
}
