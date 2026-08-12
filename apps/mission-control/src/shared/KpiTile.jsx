// Shared KPI tile — lifted from AgentHome's inline KpiTile in Wave 28c.
//
// Renders a compact card with a small icon, a label, a value (large)
// optionally followed by a suffix (e.g. "days"), and a sub-line for
// supporting context. Click target wraps the entire card.
//
// API matches AgentHome's pre-lift call-sites exactly:
//
//   <KpiTile
//     icon={Inbox}                       // lucide-react component
//     iconClass="bg-blue-50 ..."         // tailwind classes for the icon chip
//     label="Open opportunities"
//     value={42}
//     suffix="days"                       // optional, rendered after value
//     sub="oldest: 12 days ago"           // optional sub-line
//     onClick={() => ...}                 // optional click handler
//   >
//     {/* optional extra content rendered below sub — e.g. sparkline */}
//   </KpiTile>
//
// New in Wave 28c: optional `children` slot for tile-specific extras
// like a 14-day sparkline. ManagerHome uses it; AgentHome doesn't pass
// children so the existing layout is unchanged.
export function KpiTile({
  icon,
  iconClass,
  label,
  value,
  suffix,
  sub,
  onClick,
  children,
}) {
  const IconCmp = icon;
  return (
    <button
      onClick={onClick}
      className="text-left bg-white rounded-lg ring-1 ring-slate-200 hover:ring-slate-300 hover:shadow-sm transition-all px-4 py-3.5 w-full"
    >
      <div className="flex items-start gap-3">
        <div
          className={
            'w-8 h-8 rounded-md flex items-center justify-center ring-1 ring-inset shrink-0 ' +
            iconClass
          }
        >
          <IconCmp className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
            {label}
          </div>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="text-2xl font-semibold tracking-tight text-slate-900">
              {value}
            </span>
            {suffix && (
              <span className="text-xs text-slate-500 font-medium">{suffix}</span>
            )}
          </div>
          {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
          {children && <div className="mt-2">{children}</div>}
        </div>
      </div>
    </button>
  );
}

export default KpiTile;
