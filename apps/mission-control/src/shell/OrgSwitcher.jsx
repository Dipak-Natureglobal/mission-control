import { useEffect, useRef, useState } from 'react';
import { Building2, Check, ChevronDown } from 'lucide-react';
import { useActiveOrg } from './active-org-context.jsx';

// Wave 28a — Top-bar Org switcher. Rendered LEFT of the Persona switcher.
//
// Source of truth = ActiveOrgContext. Defaults to the first accessible
// org; "All my orgs" toggles the rollup mode (ADR 19 §6).
//
// PostHog: `mission_control.org_switched` emits from the context setter,
// not this component — keeps telemetry parity with the DEV CONTROLS
// path in case a future shortcut drives the same setter.
export function OrgSwitcher() {
  const { orgId, orgName, allOrgs, accessibleOrgs, setActiveOrg } = useActiveOrg();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  if (!accessibleOrgs || accessibleOrgs.length === 0) {
    return null;
  }

  const label = allOrgs ? 'All my orgs' : (orgName ?? 'Select org');

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="appearance-none bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-medium rounded-md pl-3 pr-8 py-1.5 border border-slate-200 inline-flex items-center gap-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <Building2 className="w-4 h-4 text-slate-500" />
        <span className="truncate max-w-[10rem]">{label}</span>
        <ChevronDown className="absolute right-2 top-2 w-4 h-4 text-slate-500 pointer-events-none" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-40 w-64 bg-white border border-slate-200 rounded-md shadow-lg py-1">
          {accessibleOrgs.map((o) => {
            const selected = !allOrgs && o.id === orgId;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  setActiveOrg(o.id);
                  setOpen(false);
                }}
                className={
                  'w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm ' +
                  (selected ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700 hover:bg-slate-50')
                }
              >
                <Check className={'w-3.5 h-3.5 ' + (selected ? 'opacity-100' : 'opacity-0')} />
                <span className="truncate">{o.name}</span>
              </button>
            );
          })}
          <div className="my-1 border-t border-slate-200" />
          <button
            type="button"
            onClick={() => {
              setActiveOrg('all');
              setOpen(false);
            }}
            className={
              'w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm ' +
              (allOrgs ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700 hover:bg-slate-50')
            }
          >
            <Check className={'w-3.5 h-3.5 ' + (allOrgs ? 'opacity-100' : 'opacity-0')} />
            <span>All my orgs</span>
          </button>
        </div>
      )}
    </div>
  );
}
