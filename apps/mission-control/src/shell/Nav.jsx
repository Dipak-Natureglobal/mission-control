import * as Icons from 'lucide-react';
import { NAV_BY_PERSONA } from '../constants/nav.js';
import orgRegistry from '../constants/canon/org-registry.json';
import { resolveAgentOrg, buildGhlUrl } from '../lib/external-links.js';

// Left rail navigation, role-gated. The legacy MissionControl shell had a
// redundant left-rail expansion behavior — we deliberately do NOT replicate
// that. Items are always visible at icon+label level.
export function Nav({ persona, activeKey, onSelect, items: itemsProp }) {
  // Wave 28e — callers can override the persona's full nav list via `items`
  // (e.g. App.jsx filters the manager nav by preset_id). When not provided,
  // fall back to the persona's canonical list.
  const items = itemsProp || NAV_BY_PERSONA[persona] || [];
  // Resolved once per render; only relevant for agent persona GHL links.
  const agentOrg = resolveAgentOrg(orgRegistry);

  let prevGroup = null;

  return (
    <nav className="w-56 shrink-0 bg-white border-r border-slate-200 py-4 px-2 flex flex-col gap-0.5">
      <div className="px-3 pb-2 text-[10px] uppercase tracking-wider font-semibold text-slate-400">
        {persona.replace('_', ' ')}
      </div>
      {items.map((item) => {
        const Icon = Icons[item.icon] || Icons.Square;
        const isActive = activeKey === item.key;

        const showGroupHeader = item.group && item.group !== prevGroup;
        prevGroup = item.group ?? prevGroup;

        if (item.external) {
          const url = buildGhlUrl(item.external.url_template, agentOrg);
          const header = showGroupHeader ? (
            <div key={`group-${item.group}`} className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider font-semibold text-slate-400">
              {item.group}
            </div>
          ) : null;

          if (!url) {
            // Org doesn't have a GHL location id — render disabled row
            return (
              <div key={item.key}>
                {header}
                <div className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-slate-400 cursor-not-allowed select-none">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  <span className="text-[10px]">(no GHL location)</span>
                </div>
              </div>
            );
          }

          return (
            <div key={item.key}>
              {header}
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors text-left text-slate-700 hover:bg-slate-50 no-underline"
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1">{item.label}</span>
                <Icons.ExternalLink className="w-3 h-3 shrink-0 text-slate-400" />
              </a>
            </div>
          );
        }

        // Internal item
        return (
          <div key={item.key}>
            {showGroupHeader && (
              <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider font-semibold text-slate-400">
                {item.group}
              </div>
            )}
            <button
              onClick={() => onSelect(item.key)}
              className={
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors text-left w-full ' +
                (isActive
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-slate-700 hover:bg-slate-50')
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.label}</span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}
