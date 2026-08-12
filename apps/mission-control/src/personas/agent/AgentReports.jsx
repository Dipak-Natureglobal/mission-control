// Renders Looker Studio reports embedded as iframes for the resolved
// agent org. Per ADR 16 (architecture/16-looker-embed.md), reports are
// EMBEDDED in our shell, never linked out. URL construction happens in
// external-links.js#buildLookerEmbedUrl; canon stores ids only.
import { useState } from 'react';
import orgRegistry from '../../constants/canon/org-registry.json';
import { resolveAgentOrg, resolveUserEmail, buildLookerEmbedUrl } from '../../lib/external-links.js';

export function AgentReports({ session }) {
  const org = resolveAgentOrg(orgRegistry);
  const userEmail = resolveUserEmail(session, orgRegistry);
  const ls = org?.reports?.looker_studio;

  const pages = ls?.pages ? Object.entries(ls.pages) : [];
  const [activeTabKey, setActiveTabKey] = useState(pages[0]?.[0] ?? null);

  if (!org) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50">
        <div className="text-center text-slate-500 text-sm">No active org found in registry.</div>
      </div>
    );
  }

  if (!ls?.report_id) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50">
        <div className="max-w-sm text-center space-y-2">
          <p className="text-slate-700 font-medium">Reports not yet configured for {org.name}.</p>
          <p className="text-slate-500 text-sm">Contact your admin to enable Looker Studio reports for this org.</p>
          {/* Ops note: populate org.reports.looker_studio in canon/org-registry.json + sync */}
        </div>
      </div>
    );
  }

  const activePageDef = pages.find(([k]) => k === activeTabKey)?.[1];
  const embedUrl = buildLookerEmbedUrl({
    report_id: ls.report_id,
    page_id: activePageDef?.page_id ?? null,
    params_template: ls.params_template,
    user_email: userEmail,
  });

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Top bar */}
      <div className="flex items-center gap-4 px-4 py-2 bg-white border-b border-slate-200 shrink-0">
        <span className="text-sm font-medium text-slate-700">Reports — {org.name}</span>
        <div className="flex gap-1">
          {pages.map(([key, def]) => (
            <button
              key={key}
              onClick={() => setActiveTabKey(key)}
              className={
                'px-3 py-1 rounded text-sm transition-colors ' +
                (activeTabKey === key
                  ? 'bg-blue-600 text-white font-medium'
                  : 'text-slate-600 hover:bg-slate-100')
              }
            >
              {def.label}
            </button>
          ))}
        </div>
      </div>

      {/* Full-bleed iframe — no referrerPolicy so Looker receives origin for access validation */}
      <iframe
        key={activeTabKey}
        src={embedUrl}
        style={{ width: '100%', height: '100%', border: 0 }}
        allowFullScreen
        title={`Looker Report — ${activePageDef?.label ?? activeTabKey}`}
      />
    </div>
  );
}
