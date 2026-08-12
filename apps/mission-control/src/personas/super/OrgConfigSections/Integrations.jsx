// Integrations.jsx — research Section 4.5.
// Phase 1: relocates the W19 read-only JsonPeek view under the new section
// rail. Per-provider edit drawers are tracked in canon/integrations.json
// and remain owned by the admin role (Wave 19 Task 6 spec). When/if a
// per-provider edit surface lifts here, this file is the home.

import { JsonPeek } from 'blinker-platform/components';
import integrationsRegistry from '../../../constants/canon/integrations.json';

export function IntegrationsSection({ form }) {
  const orgIntegrations = form.integrations || {};
  const providers = integrationsRegistry.providers || {};
  const orgProviderIds = Object.keys(orgIntegrations);

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-slate-500">
        Per-org integrations block. Read-only here — credential edits land in
        the admin Integrations console (per-provider drawers); this view
        confirms what was copied / seeded onto the org record.
      </div>

      {orgProviderIds.length === 0 ? (
        <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded p-4 text-center">
          No integrations configured for this org.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {orgProviderIds.map((pid) => {
            const provider = providers[pid] || {};
            const cfg = orgIntegrations[pid] || {};
            const status = cfg.status || (cfg.enabled ? 'configured' : 'missing');
            const tone =
              status === 'configured'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : status === 'errored'
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : 'bg-slate-50 text-slate-600 border-slate-200';
            return (
              <div key={pid} className="border border-slate-200 rounded p-3 bg-white">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="text-xs font-semibold text-slate-900 truncate">
                    {provider.label || pid}
                  </div>
                  <span className={'text-[10px] px-2 py-0.5 rounded-full border font-medium ' + tone}>
                    {status}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 font-mono mb-1">{pid}</div>
                {provider.category && (
                  <div className="text-[10px] text-slate-500">
                    category: <span className="font-medium">{provider.category}</span>
                  </div>
                )}
                <div className="text-[10px] text-slate-500">
                  enabled: {cfg.enabled ? 'yes' : 'no'}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="border border-slate-200 rounded p-3 bg-slate-50">
        <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-2">
          Raw block
        </div>
        <JsonPeek data={orgIntegrations} />
      </div>
    </div>
  );
}
