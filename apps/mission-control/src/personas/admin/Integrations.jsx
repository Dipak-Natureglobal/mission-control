// Integrations — admin-console card grid sourced from canon/integrations.json
// `providers`. Per-card: provider label + category pill + enabled toggle +
// status pill. Click → opens IntegrationDrawer. Per
// architecture/10-admin-console.md.
//
// "enabled" is read from the org's integrations[provider_id]?.enabled (Phase
// 1 fixture); flipping it in Phase 1 is local state + a PostHog emit (the
// canon JSON is not mutated). Phase 2 swap: PATCH org.integrations endpoint.

import { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CircleSlash,
  Plug,
  XCircle,
} from 'lucide-react';
import integrationsCanon from '../../constants/canon/integrations.json';
import { IntegrationDrawer } from './IntegrationDrawer.jsx';
import { track } from 'blinker-platform/telemetry';

export function Integrations({ org, persona = 'admin' }) {
  const providers = integrationsCanon.providers || {};
  const categories = integrationsCanon._categories || {};
  const [opened, setOpened] = useState(null); // provider_id
  // Phase 1 local enable-overrides — keys are provider ids that have been
  // toggled in this session. Saved alongside the org integrations record
  // for visual feedback only (canon not mutated).
  const [localEnabled, setLocalEnabled] = useState({});

  const cards = useMemo(
    () =>
      Object.values(providers).map((p) => {
        const orgBlock = org?.integrations?.[p.id];
        const baseEnabled = !!orgBlock?.enabled;
        const enabled = localEnabled[p.id] !== undefined ? localEnabled[p.id] : baseEnabled;
        const status = orgBlock?.status || 'missing';
        return { provider: p, orgBlock, enabled, status };
      }),
    [providers, org, localEnabled],
  );

  function openDrawer(provider) {
    track('mission_control.admin.integration_opened', {
      org_id: org?.id,
      provider: provider.id,
    });
    setOpened(provider.id);
  }

  function toggleEnabled(providerId, next) {
    setLocalEnabled((prev) => ({ ...prev, [providerId]: next }));
    track(
      next
        ? 'mission_control.admin.integration_enabled'
        : 'mission_control.admin.integration_disabled',
      { org_id: org?.id, provider: providerId },
    );
  }

  const openedCard = cards.find((c) => c.provider.id === opened);

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map(({ provider, enabled, status }) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            enabled={enabled}
            status={status}
            categoryLabel={categories[provider.category]}
            onClick={() => openDrawer(provider)}
            onToggleEnabled={(next) => toggleEnabled(provider.id, next)}
          />
        ))}
      </div>

      {openedCard && (
        <IntegrationDrawer
          provider={openedCard.provider}
          orgBlock={openedCard.orgBlock}
          orgId={org?.id}
          actorPersona={persona}
          onClose={() => setOpened(null)}
        />
      )}
    </div>
  );
}

function ProviderCard({ provider, enabled, status, categoryLabel, onClick, onToggleEnabled }) {
  return (
    <div
      onClick={onClick}
      className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 cursor-pointer hover:border-violet-500 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-900 truncate">
            {provider.label}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mt-0.5 font-semibold">
            {provider.category} · {categoryLabel || ''}
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleEnabled(!enabled);
          }}
          className={
            'relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ' +
            (enabled ? 'bg-violet-600' : 'bg-slate-300')
          }
          title={enabled ? 'Click to disable' : 'Click to enable'}
        >
          <span
            className={
              'inline-block h-4 w-4 rounded-full bg-white transform transition-transform ' +
              (enabled ? 'translate-x-4' : 'translate-x-0.5')
            }
          />
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <StatusPill status={status} />
        {provider.supports_test_mode && (
          <span className="inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded text-amber-700 bg-amber-50 border border-amber-200">
            test/live
          </span>
        )}
      </div>
      <div className="text-[11px] text-slate-500 mt-2 leading-snug line-clamp-2">
        {provider.purpose}
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  if (status === 'configured') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
        <CheckCircle2 className="w-2.5 h-2.5" />
        configured
      </span>
    );
  }
  if (status === 'errored') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
        <XCircle className="w-2.5 h-2.5" />
        errored
      </span>
    );
  }
  if (status === 'missing') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200">
        <CircleSlash className="w-2.5 h-2.5" />
        missing
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
      <AlertCircle className="w-2.5 h-2.5" />
      {status || 'unknown'}
    </span>
  );
}

export { Plug }; // re-export for OrgDetail tab icon (defensive — OrgDetail imports its own).
