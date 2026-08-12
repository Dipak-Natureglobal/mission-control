// AdminHome — admin-persona shell. Wave 14 replaces the Phase 1B stub with
// a real dashboard + sub-page dispatcher.
//
// Routing model: nav config (constants/nav.js admin array) drives `activeKey`,
// which is owned by App.jsx's PersonaShell. We dispatch on it here. We do
// NOT introduce a router library — local React state + activeKey is the
// pattern across mission-control.
//
// "Current admin's org_id" — Phase 1 dev-only seed. Real implementation
// reads from the auth context (Phase 2). Default to Apex (102) because that
// org has the richest fixture data (full integrations block + cross_sell
// + protection_billing). Super-admin viewing the admin shell sees all orgs;
// org-scoped admins see own org + descendants. This default lives ONLY in
// AdminHome — once the real auth ships, replace with `useCurrentUser().org_id`.
//
// Sub-page dispatch (per architecture/10-admin-console.md):
//   - 'dashboard'    → AdminDashboard tile grid
//   - 'org'          → OrgTree → OrgDetail (when an org is selected)
//   - 'users'/'integrations'/'config'/'audit' → auto-open OrgDetail on the
//     admin's own org pre-targeting that tab. This makes the left-nav act
//     like quick-jumps into the most common per-org work without forcing
//     the user through OrgTree first.

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  LayoutDashboard,
  Network,
  Plug,
  Sliders,
  Users as UsersIcon,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import orgRegistry from '../../constants/canon/org-registry.json';
import integrationsCanon from '../../constants/canon/integrations.json';
import { OrgTree } from './OrgTree.jsx';
import { OrgDetail } from './OrgDetail.jsx';
import { track } from 'blinker-platform/telemetry';

// Phase 1 dev seed — see file header comment. Defaults to Apex (102) so the
// dashboard renders against the richest fixture. Replace with auth context
// in Phase 2.
export const DEFAULT_ADMIN_ORG_ID = 102;

// Map nav activeKey → OrgDetail tab key. Used when the user clicks Users /
// Integrations / Configuration / Audit in the left nav — we drop them
// straight into OrgDetail at the matching tab on their own org.
const NAV_TO_TAB = {
  users: 'users',
  integrations: 'integrations',
  'plan-catalog': 'plan-catalog',
  config: 'config',
  audit: 'audit',
};

export function AdminHome({ activeKey, persona = 'admin', currentAdminOrgId = DEFAULT_ADMIN_ORG_ID, onNavigate }) {
  const isSuper = persona === 'super_admin';

  // Resolve the org the admin is acting on. Super_admin viewing admin shell
  // can see all orgs but the dashboard still needs an "active" org to focus.
  const activeOrg = useMemo(() => {
    const orgs = orgRegistry.orgs || [];
    if (isSuper) return orgs.find((o) => o.id === currentAdminOrgId) || orgs[0] || null;
    return orgs.find((o) => o.id === currentAdminOrgId) || null;
  }, [isSuper, currentAdminOrgId]);

  // selectedOrgId drives OrgDetail; null → OrgTree. Owned here so click-out
  // from OrgTree doesn't bubble past the admin shell.
  const [selectedOrgId, setSelectedOrgId] = useState(null);
  const [initialTab, setInitialTab] = useState('overview');

  // When user clicks Users / Integrations / Config / Audit in left nav, drop
  // them into OrgDetail for their own org pre-targeting that tab. Reset back
  // to tree when they go to dashboard / org.
  useEffect(() => {
    const tab = NAV_TO_TAB[activeKey];
    if (tab) {
      if (activeOrg) {
        setSelectedOrgId(activeOrg.id);
        setInitialTab(tab);
      }
    } else if (activeKey === 'org' || activeKey === 'dashboard') {
      // Reset selection — show OrgTree (for 'org') or AdminDashboard.
      setSelectedOrgId(null);
      setInitialTab('overview');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, activeOrg?.id]);

  if (activeKey === 'dashboard' || !activeKey) {
    return <AdminDashboard org={activeOrg} persona={persona} onNavigate={onNavigate} />;
  }

  // Org tree + detail share the 'org' nav key. When an org is selected,
  // render OrgDetail; otherwise OrgTree.
  if (selectedOrgId) {
    return (
      <OrgDetail
        key={selectedOrgId + ':' + initialTab}
        orgId={selectedOrgId}
        initialTab={initialTab}
        persona={persona}
        onBack={() => setSelectedOrgId(null)}
      />
    );
  }
  return (
    <OrgTree
      persona={persona}
      currentAdminOrgId={currentAdminOrgId}
      onSelectOrg={(orgId) => {
        setSelectedOrgId(orgId);
        setInitialTab('overview');
      }}
    />
  );
}

// AdminDashboard — landing tile grid. Click a tile → onNavigate(activeKey),
// mirroring how SuperHome opens StatusMappingEditor in-place.
function AdminDashboard({ org, persona, onNavigate }) {
  const isSuper = persona === 'super_admin';
  const allOrgs = orgRegistry.orgs || [];

  const childOrgs = useMemo(
    () => allOrgs.filter((o) => o.parent_org_id === org?.id),
    [allOrgs, org?.id],
  );

  const allProviders = Object.keys(integrationsCanon.providers || {});
  const configured = useMemo(() => {
    if (!org?.integrations) return [];
    return Object.entries(org.integrations).filter(([, v]) => v?.status === 'configured');
  }, [org]);
  const integrationsTotal = allProviders.length;
  const integrationsConfigured = configured.length;

  function handleTileClick(key) {
    track('mission_control.admin.dashboard_tile_clicked', { tile: key, org_id: org?.id });
    if (onNavigate) onNavigate(key);
  }

  if (!org) {
    return (
      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-8">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm text-amber-900">
            No org selected. {isSuper && 'As super-admin, switch to a specific org from Org tree.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-6xl mx-auto p-8">
        <div className="flex items-center gap-2 text-violet-600 mb-2">
          <LayoutDashboard className="w-4 h-4" />
          <span className="text-xs uppercase tracking-wide font-semibold">
            Admin · Dashboard {isSuper && '· (super-admin view)'}
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 mb-1">
          {org.name}
        </h1>
        <p className="text-sm text-slate-500 mb-6">
          Org-level overview. Click a tile to drill in.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Tile
            label="Org status"
            value={<StatusPill status={org.status} />}
            sub={`${childOrgs.length} child org${childOrgs.length === 1 ? '' : 's'}`}
            icon={Network}
            onClick={() => handleTileClick('org')}
          />
          <Tile
            label="Users"
            value={org.users_count ?? '—'}
            sub="Click to manage"
            icon={UsersIcon}
            onClick={() => handleTileClick('users')}
          />
          <Tile
            label="Integrations"
            value={`${integrationsConfigured} / ${integrationsTotal}`}
            sub={integrationsConfigured === 0 ? 'None configured' : 'configured providers'}
            icon={Plug}
            tone={integrationsConfigured === 0 ? 'amber' : 'emerald'}
            onClick={() => handleTileClick('integrations')}
          />
          <Tile
            label="Test mode"
            value={org.test_mode ? 'ON' : 'off'}
            sub={org.test_mode ? 'Sandbox routing' : 'Production routing'}
            icon={Activity}
            tone={org.test_mode ? 'amber' : 'slate'}
            onClick={() => handleTileClick('config')}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => handleTileClick('config')}
            className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 text-left hover:border-violet-500 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-1">
              <Sliders className="w-4 h-4 text-violet-600" />
              Configuration
            </div>
            <div className="text-xs text-slate-500 leading-relaxed">
              Pricing & markup, down-payment, first-payment-date strategy,
              payment terms, cross-sell, test mode.
            </div>
          </button>
          <button
            onClick={() => handleTileClick('audit')}
            className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 text-left hover:border-violet-500 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-1">
              <Activity className="w-4 h-4 text-violet-600" />
              Audit log
            </div>
            <div className="text-xs text-slate-500 leading-relaxed">
              Every admin-console mutation appended to a per-org timeline:
              users, integrations, config changes, test-mode toggles,
              credential reveals.
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, icon: Icon, tone = 'slate', onClick }) {
  const toneRing = {
    slate:   'border-slate-200 hover:border-violet-500',
    emerald: 'border-emerald-200 hover:border-violet-500',
    amber:   'border-amber-200 hover:border-violet-500',
  }[tone];
  return (
    <button
      onClick={onClick}
      className={
        'bg-white border rounded-xl shadow-sm p-5 text-left hover:shadow-md transition-shadow ' +
        toneRing
      }
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
          {label}
        </div>
        {Icon && <Icon className="w-4 h-4 text-slate-400" />}
      </div>
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </button>
  );
}

export function StatusPill({ status }) {
  const cls =
    status === 'active'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : status === 'paused'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-slate-50 text-slate-700 border-slate-200';
  const Icon =
    status === 'active' ? CheckCircle2 : status === 'paused' ? AlertCircle : XCircle;
  return (
    <span
      className={
        'inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ' +
        cls
      }
    >
      <Icon className="w-3 h-3" />
      {status || 'unknown'}
    </span>
  );
}
