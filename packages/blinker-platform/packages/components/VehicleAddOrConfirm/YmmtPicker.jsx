// YmmtPicker — modal that opens from a PickerField tap. Search input over
// a grid of YMMT_DATA options for the requested field (year/make/model/trim).
//
// Wave 17 P1 lift: merge of
//   - refi-portal monolith (refinance-v2-prototype.jsx:2076-2180) — adds
//     `form.extra*` extras-injection paths so VinAudit-decoded values
//     outside the YMMT_DATA fixture surface in the picker AND get cleared
//     when the user picks a different upstream value (cascade reset).
//   - protection-portal/src/shared/YmmtPicker.jsx:34-120 — same modal
//     chrome, cascade reset on make/model picks, no extras awareness.
//
// Refi's extras-aware version is a strict superset; we pick that and add
// protection's cascade-clear for `extraModels`/`extraTrims` to keep the
// picker honest when the user manually overrides a decode-injected branch.
//
// Wave 19 Task 2: model + trim lists are now filtered through year-aware
// helpers (getModelsForYearMake / getTrimsForYearMakeModel). Year selection
// cascade-clears model + trim when the currently-selected model is no longer
// valid for the new year, and surfaces a brief inline notice.
import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
  YEARS,
  YMMT_MAKES,
  getModelsForYearMake,
  getTrimsForYearMakeModel,
} from 'blinker-platform/utils';

export function YmmtPicker({ field, form, update, onClose }) {
  const titles = {
    year: 'Select Year',
    make: 'Select Make',
    model: 'Select Model',
    trim: 'Select Trim',
  };

  let options = [];
  if (field === 'year') {
    options = YEARS;
  } else if (field === 'make') {
    // YMMT_MAKES + any decode-injected makes not present in YMMT_DATA.
    // Dedup defensively in case extraMakes overlaps (shouldn't, but cheap).
    const extras = (form.extraMakes || []).filter((m) => !YMMT_MAKES.includes(m));
    options = [...YMMT_MAKES, ...extras];
  } else if (field === 'model' && form.make) {
    // Year-aware: only show models produced in the selected year (if known).
    // When form.year is falsy (not yet selected), helper returns all models.
    // Extras (VinAudit-decoded) are always surfaced regardless of year constraint
    // because the decode already knows what year it is.
    const base = getModelsForYearMake(form.year, form.make);
    const extras = (form.extraModels || []).filter((m) => !base.includes(m));
    options = [...base, ...extras];
  } else if (field === 'trim' && form.make && form.model) {
    // Year-aware: returns [] if model is out-of-range for the year.
    // When form.year is falsy, helper returns all trims.
    const base = getTrimsForYearMakeModel(form.year, form.make, form.model);
    const extras = (form.extraTrims || []).filter((t) => !base.includes(t));
    options = ["I don't know", ...base, ...extras, 'Other'];
  }

  const [search, setSearch] = useState('');
  const searchRef = useRef(null);
  const filtered = options.filter((o) =>
    String(o).toLowerCase().includes(search.toLowerCase()),
  );

  useEffect(() => {
    if (searchRef.current) searchRef.current.focus();
  }, []);

  function pick(v) {
    if (field === 'year') {
      // Year change: check whether the currently-selected model is still valid
      // for the new year. If not, cascade-clear model + trim and signal notice.
      const newYear = v;
      const currentModel = form.model;
      const currentMake = form.make;
      let modelStillValid = true;
      if (currentMake && currentModel) {
        const validModels = getModelsForYearMake(newYear, currentMake);
        // Also allow extras through (VinAudit-decoded models have no year constraint).
        const extras = form.extraModels || [];
        modelStillValid = validModels.includes(currentModel) || extras.includes(currentModel);
      }
      if (!modelStillValid) {
        update({
          year: newYear,
          model: '',
          trim: '',
          extraModels: [],
          extraTrims: [],
          _yearChangedInvalidatedModel: currentModel,
        });
      } else {
        update({ year: newYear, _yearChangedInvalidatedModel: null });
      }
    } else if (field === 'make') {
      // User-picked make resets downstream + clears decode-injected
      // extras for the now-stale model/trim hierarchy.
      update({ make: v, model: '', trim: '', extraModels: [], extraTrims: [] });
    } else if (field === 'model') {
      update({ model: v, trim: '', extraTrims: [], _yearChangedInvalidatedModel: null });
    } else if (field === 'trim') {
      update({ trim: v });
    }
    onClose();
  }

  const currentValue = form[field];

  return (
    <div className="fixed inset-0 bg-slate-900 bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div
        className="bg-white rounded-xl shadow-xl max-w-lg w-full overflow-hidden flex flex-col"
        style={{ maxHeight: '85vh' }}
      >
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
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
