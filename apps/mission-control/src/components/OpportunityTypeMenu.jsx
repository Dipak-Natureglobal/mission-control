import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, ShieldCheck, Banknote, Umbrella, RefreshCcw } from 'lucide-react';

// OpportunityTypeMenu — a button + dropdown listing the four startable
// opportunity types. Click outside closes; click an item fires
// onSelect({ type, flowPath }) and closes.
//
// Two visual variants:
//   - 'compact' (default): used inside vehicle cards.
//                          Button label "Start opportunity ▼".
//   - 'cta':               used in the ContactProfile header.
//                          Button label "+ New opportunity ▼".
//
// flowPath only applies to insurance:
//   * Insurance — capture + quote → flowPath = 'capture_and_quote'
//   * Insurance — quote only      → flowPath = 'quote_only'
// Other types omit flowPath in the payload.

const ITEMS = [
  {
    key: 'refi',
    type: 'refi',
    label: 'Refi',
    icon: RefreshCcw,
    iconClass: 'text-emerald-600',
    flowPath: undefined,
  },
  {
    key: 'insurance_capture_and_quote',
    type: 'insurance',
    label: 'Insurance — capture + quote',
    icon: Umbrella,
    iconClass: 'text-sky-600',
    flowPath: 'capture_and_quote',
  },
  {
    key: 'insurance_quote_only',
    type: 'insurance',
    label: 'Insurance — quote only',
    icon: Umbrella,
    iconClass: 'text-sky-500',
    flowPath: 'quote_only',
  },
  {
    key: 'protection',
    type: 'protection',
    label: 'Protection plan',
    icon: ShieldCheck,
    iconClass: 'text-indigo-600',
    flowPath: undefined,
  },
];

export function OpportunityTypeMenu({ variant = 'compact', onSelect, label }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleDocClick(e) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    }
    function handleEsc(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleDocClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleDocClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  function pick(item) {
    setOpen(false);
    onSelect({ type: item.type, flowPath: item.flowPath });
  }

  const buttonClass =
    variant === 'cta'
      ? 'inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white'
      : 'inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-white ring-1 ring-slate-300 hover:bg-slate-50 text-slate-700';

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button onClick={() => setOpen((v) => !v)} className={buttonClass}>
        {variant === 'cta' ? (
          <Plus className="w-3.5 h-3.5" />
        ) : (
          <Banknote className="w-3 h-3" />
        )}
        {label || (variant === 'cta' ? 'New opportunity' : 'Start opportunity')}
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div
          className="absolute z-30 right-0 mt-1 w-64 rounded-md bg-white ring-1 ring-slate-200 shadow-lg overflow-hidden"
          role="menu"
        >
          {ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                onClick={() => pick(item)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 text-slate-800"
                role="menuitem"
              >
                <Icon className={'w-3.5 h-3.5 shrink-0 ' + item.iconClass} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
