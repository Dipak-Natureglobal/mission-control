// Tiny dark "current state" pane so embedders can sanity-check the
// form / package shape from inside their DEV CONTROLS sidebar. Per
// the legacy CLAUDE.md acceptance lineage: status transitions surface
// here as a JsonPeek of the package state.
//
// Wave 15c-fu: lifted to blinker-platform/components/ from
// protection-portal/src/shared/JsonPeek.jsx (chosen as median; refi +
// insurance carried byte-identical copies; mission-control had a
// near-identical variant differing only in panel chrome — `border-t`
// vs `rounded-md`. The rounded-card form is the platform default).
export function JsonPeek({ label = 'JSON peek · current state', data }) {
  return (
    <div className="bg-slate-900 text-slate-200 text-xs font-mono p-4 max-h-64 overflow-auto rounded-md border border-slate-800">
      <div className="text-slate-400 mb-2 uppercase tracking-wide text-xs">{label}</div>
      <pre className="whitespace-pre-wrap break-words">
{JSON.stringify(data ?? {}, null, 2)}
      </pre>
    </div>
  );
}
