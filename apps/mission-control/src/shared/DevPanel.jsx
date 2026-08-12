import { useMemo, useState } from 'react';
import { Settings, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';

// Generic DEV CONTROLS sidebar substrate — Section + Segmented + JsonBlock
// primitives only. The actual controls (persona switch, force opportunity
// status, prefill contact, payload mirror, per-workflow placeholders) live
// in App.jsx and are composed using these primitives.
// Pattern lifted from refi-prototype.

export function DevPanel({ title = 'Dev controls', subtitle, children }) {
  return (
    <div className="w-80 shrink-0 bg-slate-900 text-slate-100 p-5 overflow-auto border-r border-slate-800">
      <div className="flex items-center gap-2 mb-4">
        <Settings className="w-4 h-4" />
        <div className="font-semibold text-sm tracking-wide uppercase">{title}</div>
      </div>
      {subtitle && (
        <p className="text-xs text-slate-400 mb-5 leading-relaxed">{subtitle}</p>
      )}
      {children}
    </div>
  );
}

// Section — plain by default, collapsible when `collapsible` is set.
//
// Props:
//   label        : string (heading)
//   collapsible  : boolean (adds chevron + click-to-toggle)
//   defaultOpen  : boolean = true (initial open state when collapsible)
//   forceOpen    : boolean (when true, section is open and chevron click
//                  is a no-op; when it drops back to false, the section
//                  returns to its locally-toggled state)
//   children     : section body (hidden when collapsed)
export function Section({
  label,
  collapsible = false,
  defaultOpen = true,
  forceOpen = false,
  children,
}) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const open = collapsible ? forceOpen || localOpen : true;

  if (!collapsible) {
    return (
      <div className="mb-5">
        <div className="text-xs text-slate-400 uppercase tracking-wide mb-2 font-semibold">
          {label}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="mb-5">
      <button
        type="button"
        onClick={() => {
          if (forceOpen) return; // no-op while parent is forcing open
          setLocalOpen((o) => !o);
        }}
        className={
          'w-full flex items-center gap-1.5 mb-2 text-xs uppercase tracking-wide font-semibold ' +
          (forceOpen
            ? 'text-blue-300 cursor-default'
            : 'text-slate-400 hover:text-slate-200')
        }
      >
        {open ? (
          <ChevronDown className="w-3 h-3 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 shrink-0" />
        )}
        <span>{label}</span>
      </button>
      {open && children}
    </div>
  );
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="flex bg-slate-800 rounded overflow-hidden">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={
            'flex-1 text-xs py-1 px-2 ' +
            (value === o.v ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700')
          }
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

export function Row({ children }) {
  return <div className="flex items-center justify-between py-1 text-xs">{children}</div>;
}

// JsonBlock — collapsible JSON peek with chevron, label, byte-size, and
// Copy button. Designed to live inside the DevPanel substrate (dark bg).
// Mirrors the look of CoPilotPane's old PayloadBlock so the move from
// the left-pane DEV section to App.jsx's DevPanel doesn't change visual
// affordance — just relocates ownership.
export function JsonBlock({ label, value, defaultOpen = false, hint = null }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [copied, setCopied] = useState(false);
  const json = useMemo(() => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '/* unserializable */';
    }
  }, [value]);
  const sizeBytes = json ? json.length : 0;
  const sizeLabel =
    sizeBytes >= 1024 ? `${(sizeBytes / 1024).toFixed(1)}kb` : `${sizeBytes}b`;
  const empty = value === null || value === undefined;

  function handleCopy(e) {
    e.stopPropagation();
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(json).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      });
    }
  }

  return (
    <div className="rounded-md ring-1 ring-slate-700 bg-slate-800 mb-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-slate-200 hover:bg-slate-700/60 rounded-md"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
        )}
        <span className="font-mono truncate">{label}</span>
        <span className="text-[10px] text-slate-400 ml-auto shrink-0">
          {empty ? 'null' : sizeLabel}
        </span>
        {!empty && (
          <span
            role="button"
            tabIndex={0}
            onClick={handleCopy}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') handleCopy(e);
            }}
            className="inline-flex items-center gap-0.5 text-[10px] text-slate-300 hover:text-white px-1 py-0.5 rounded hover:bg-slate-600 shrink-0"
            title="Copy JSON"
          >
            {copied ? (
              <>
                <Check className="w-2.5 h-2.5" />
                <span>Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-2.5 h-2.5" />
                <span>Copy</span>
              </>
            )}
          </span>
        )}
      </button>
      {open && (
        <div className="px-2 pb-2">
          {hint && (
            <div className="text-[10px] text-amber-300 mb-1.5 leading-snug">{hint}</div>
          )}
          <pre className="text-[10px] font-mono max-h-64 overflow-auto bg-slate-950 text-emerald-300 px-2 py-1.5 rounded leading-snug">
            {empty ? 'null' : json}
          </pre>
        </div>
      )}
    </div>
  );
}
