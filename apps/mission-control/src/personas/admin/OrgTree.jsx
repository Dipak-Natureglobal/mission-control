// OrgTree — hierarchical org view sourced from canon/org-registry.json.
// Groups by parent_org_id (null = root). Per architecture/10-admin-console.md
// § Build phases — the "Org tree" tab in the admin console.
//
// Persona scope:
//   - admin       → sees own org + descendants only
//   - super_admin → sees the full registry
//
// "Current admin's org_id" is the dev-only seed lifted in AdminHome
// (DEFAULT_ADMIN_ORG_ID = 102 / Apex). Phase 2 swap point: read from auth
// context instead of the hardcoded prop. See AdminHome.jsx file header.
//
// Click an org row → opens OrgDetail in the parent shell (selectedOrgId
// state lives in OrgTree's parent — passed via onSelectOrg callback). No
// router; matches the in-place opening pattern SuperHome uses for
// StatusMappingEditor.

import { useMemo } from 'react';
import {
  ChevronRight,
  Plug,
  TestTube2,
  Users as UsersIcon,
  ExternalLink,
} from 'lucide-react';
import orgRegistry from '../../constants/canon/org-registry.json';
import integrationsCanon from '../../constants/canon/integrations.json';
import { StatusPill } from './AdminHome.jsx';
import { track } from 'blinker-platform/telemetry';

// Filter the registry per the admin's scope.
//   - admin       → own + descendants of `currentAdminOrgId`
//   - super_admin → all
export function scopedOrgs(registry, persona, currentAdminOrgId) {
  const all = registry.orgs || [];
  if (persona === 'super_admin') return all;
  if (!currentAdminOrgId) return [];
  // Walk descendants. Phase 1 fixture has 1-level hierarchy (parent → child)
  // so a single pass is sufficient; widen to BFS if hierarchy deepens.
  const own = all.find((o) => o.id === currentAdminOrgId);
  if (!own) return [];
  const descendants = all.filter((o) => o.parent_org_id === currentAdminOrgId);
  return [own, ...descendants];
}

export function OrgTree({ persona = 'admin', currentAdminOrgId, onSelectOrg }) {
  const visibleOrgs = useMemo(
    () => scopedOrgs(orgRegistry, persona, currentAdminOrgId),
    [persona, currentAdminOrgId],
  );

  // Group visible orgs into roots (parent_org_id null OR parent not in scope)
  // and children-by-parent. Avoids orphans when the admin's parent isn't
  // visible.
  const visibleIds = new Set(visibleOrgs.map((o) => o.id));
  const roots = visibleOrgs.filter(
    (o) => o.parent_org_id == null || !visibleIds.has(o.parent_org_id),
  );
  const childrenByParent = visibleOrgs.reduce((acc, o) => {
    if (o.parent_org_id != null && visibleIds.has(o.parent_org_id)) {
      if (!acc[o.parent_org_id]) acc[o.parent_org_id] = [];
      acc[o.parent_org_id].push(o);
    }
    return acc;
  }, {});

  function handleRowClick(org) {
    track('mission_control.admin.org_opened', { org_id: org.id, persona });
    if (onSelectOrg) onSelectOrg(org.id);
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-6xl mx-auto p-8">
        <div className="flex items-center gap-2 text-violet-600 mb-2">
          <span className="text-xs uppercase tracking-wide font-semibold">
            Admin · Org tree
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 mb-1">
          {persona === 'super_admin' ? 'All organizations' : 'Your organization'}
        </h1>
        <p className="text-sm text-slate-500 mb-6">
          {persona === 'super_admin'
            ? `${visibleOrgs.length} orgs across the registry. Click a row to open.`
            : 'You and your child orgs. Click a row to open.'}
        </p>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          {roots.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-slate-500">
              No orgs in scope.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {roots.map((root) => (
                <OrgGroup
                  key={root.id}
                  org={root}
                  children={childrenByParent[root.id] || []}
                  onClick={handleRowClick}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OrgGroup({ org, children, onClick }) {
  return (
    <div>
      <OrgRow org={org} depth={0} onClick={onClick} />
      {children.map((c) => (
        <OrgRow key={c.id} org={c} depth={1} onClick={onClick} />
      ))}
    </div>
  );
}

function OrgRow({ org, depth = 0, onClick }) {
  const allProviders = Object.keys(integrationsCanon.providers || {});
  const configured = org.integrations
    ? Object.values(org.integrations).filter((v) => v?.status === 'configured').length
    : 0;
  const total = allProviders.length;
  const integrationTone =
    configured === 0 ? 'slate' : configured === total ? 'emerald' : 'blue';

  return (
    <button
      onClick={() => onClick && onClick(org)}
      className={
        'w-full text-left flex items-center gap-3 px-5 py-4 hover:bg-slate-50 transition-colors ' +
        (depth > 0 ? 'pl-12' : '')
      }
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-sm font-semibold text-slate-900 truncate">
            {org.name}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-slate-400 font-mono">
            #{org.id}
          </span>
          {org.type && (
            <span className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">
              {org.type}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={org.status} />
          {org.ghl_location_id && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              <ExternalLink className="w-2.5 h-2.5" />
              GHL · {org.ghl_location_id.slice(0, 8)}…
            </span>
          )}
          <IntegrationsPill
            configured={configured}
            total={total}
            tone={integrationTone}
          />
          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-50 text-slate-700 border border-slate-200">
            <UsersIcon className="w-2.5 h-2.5" />
            {org.users_count ?? '—'} users
          </span>
          {org.test_mode && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
              <TestTube2 className="w-2.5 h-2.5" />
              TEST MODE
            </span>
          )}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
    </button>
  );
}

function IntegrationsPill({ configured, total, tone = 'slate' }) {
  const cls = {
    slate:   'bg-slate-50 text-slate-700 border-slate-200',
    blue:    'bg-blue-50 text-blue-700 border-blue-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  }[tone];
  return (
    <span
      className={
        'inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ' +
        cls
      }
    >
      <Plug className="w-2.5 h-2.5" />
      {configured} / {total} integrations
    </span>
  );
}
