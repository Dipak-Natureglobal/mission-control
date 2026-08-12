// Lifted from refi-prototype monolith (refinance-v2-prototype.jsx ~L1962).
// Two pieces:
//   - PickerField: the read-only "tap to pick" tile shown inline on a screen.
//   - YmmtPicker:   the modal that opens when the tile is tapped — search +
//                   grid of options sourced from blinker-platform/utils.
//
// Wave 20: option lists now flow through the year-aware platform helpers
// (`getMakes` / `getModelsForYearMake` / `getTrimsForYearMakeModel`) so
// discontinued models (e.g. Honda Element after 2011) are filtered out
// when a year is selected. Wave 23-fu2: VehicleAdd.jsx + VinValidate.jsx
// now import YMMT_DATA + YMMT_MAKES + fetchVinDecode + ymmtMatch directly
// from blinker-platform/utils — the local constants/ymmt-data.js and
// lib/vinDecode.js have been deleted. See
// `blinker-platform/packages/utils/ymmt-data.js` for YMMT_YEAR_CONSTRAINTS.
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import {
  YEARS,
  getMakes,
  getModelsForYearMake,
  getTrimsForYearMakeModel,
} from 'blinker-platform/utils';

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

export function YmmtPicker({ field, form, update, onClose }) {
  const titles = { year: 'Select Year', make: 'Select Make', model: 'Select Model', trim: 'Select Trim' };

  // Year-aware: when form.year is falsy the helpers fall back to no filter
  // (return all models / trims for the make). When form.year is set, the
  // helpers consult YMMT_YEAR_CONSTRAINTS and exclude out-of-range models.
  let options = [];
  if (field === 'year') options = YEARS;
  else if (field === 'make') options = getMakes();
  else if (field === 'model' && form.make) {
    options = getModelsForYearMake(form.year, form.make);
  }
  else if (field === 'trim' && form.make && form.model) {
    const base = getTrimsForYearMakeModel(form.year, form.make, form.model);
    options = ["I don't know", ...base, 'Other'];
  }

  const [search, setSearch] = useState('');
  const searchRef = useRef(null);
  const filtered = options.filter((o) => String(o).toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    if (searchRef.current) searchRef.current.focus();
  }, []);

  function pick(v) {
    if (field === 'year') update({ year: v });
    else if (field === 'make') update({ make: v, model: '', trim: '' });
    else if (field === 'model') update({ model: v, trim: '' });
    else if (field === 'trim') update({ trim: v });
    onClose();
  }

  const currentValue = form[field];

  return (
    <div className="fixed inset-0 bg-slate-900 bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden flex flex-col" style={{ maxHeight: '85vh' }}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="font-semibold">{titles[field]}</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>
        {options.length > 12 && (
          <div className="px-5 py-3 border-b border-slate-100">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${field}...`}
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        )}
        <div className="px-5 py-4 overflow-auto flex-1">
          <div className="grid grid-cols-3 gap-2">
            {filtered.map((o) => {
              const active = String(currentValue) === String(o);
              return (
                <button
                  key={o}
                  onClick={() => pick(o)}
                  className={
                    'px-3 py-2 text-sm rounded-md border ' +
                    (active
                      ? 'border-blue-600 bg-blue-600 text-white font-semibold'
                      : 'border-blue-200 text-blue-700 hover:bg-blue-50')
                  }
                >
                  {o}
                </button>
              );
            })}
          </div>
          {filtered.length === 0 && (
            <div className="text-center text-sm text-slate-400 py-6">No matches</div>
          )}
        </div>
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
