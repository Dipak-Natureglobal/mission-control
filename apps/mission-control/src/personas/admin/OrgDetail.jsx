// OrgDetail — focused view for one org. Tabs: Overview / Users /
// Integrations / Configuration / Audit. Per architecture/10-admin-console.md.
//
// Tab state lives locally — no router, no global state. The parent shell
// (AdminHome) owns the selectedOrgId; this component owns activeTab.
//
// In commit 2 (this file initial), Users / Integrations / Configuration /
// Audit tabs render PlaceholderHint cards. Commits 3-5 swap them out for
// real components.

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  FileText,
  Plug,
  ShieldCheck,
  Sliders,
  TestTube2,
  Users as UsersIcon,
} from 'lucide-react';
import orgRegistry from '../../constants/canon/org-registry.json';
import integrationsCanon from '../../constants/canon/integrations.json';
import { TestModeBanner } from '../../components/TestModeBanner.jsx';
import { TestModeToggleConfirm } from '../../components/TestModeToggleConfirm.jsx';
import { StatusPill } from './AdminHome.jsx';
import { UsersIndex } from './UsersIndex.jsx';
import { Integrations } from './Integrations.jsx';
import { PlanCatalog } from './PlanCatalog.jsx';
import { OrgConfiguration } from './OrgConfiguration.jsx';
import { AuditLog } from './AuditLog.jsx';
import { can } from '../../lib/permissions.js';
import { track } from 'blinker-platform/telemetry';

const TABS = [
  { key: 'overview',      label: 'Overview',           icon: ClipboardList },
  { key: 'users',         label: 'Users',              icon: UsersIcon },
  { key: 'integrations',  label: 'Integrations',       icon: Plug },
  { key: 'plan-catalog',  label: 'Plan presentations', icon: ShieldCheck },
  { key: 'config',        label: 'Configuration',      icon: Sliders },
  { key: 'audit',         label: 'Audit',              icon: FileText },
];

export function OrgDetail({ orgId, onBack, persona = 'admin', initialTab = 'overview' }) {
  const org = useMemo(
    () => (orgRegistry.orgs || []).find((o) => o.id === orgId),
    [orgId],
  );
  const [activeTab, setActiveTab] = useState(initialTab);
  // Local Phase 1 override of test_mode — the canon JSON is not mutated;
  // null means "use canon value", otherwise the boolean here wins.
  const [testModeOverride, setTestModeOverride] = useState(null);
  const [showTestModeConfirm, setShowTestModeConfirm] = useState(false);

  const effectiveTestMode = testModeOverride !== null ? testModeOverride : org?.test_mode;
  const canToggleTestMode = can({ persona }, 'toggle_test_mode');

  useEffect(() => {
    if (org) {
      track('mission_control.admin.org_detail_opened', {
        org_id: org.id,
        persona,
      });
    }
  }, [org, persona]);

  function openTestModeConfirm() {
    track('mission_control.admin.test_mode_toggle_opened', {
      org_id: org?.id,
      from: effectiveTestMode,
    });
    setShowTestModeConfirm(true);
  }

  function onTestModeConfirmed(nextValue) {
    setTestModeOverride(nextValue);
    setShowTestModeConfirm(false);
  }

  if (!org) {
    return (
      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-8">
          <button
            onClick={onBack}
            className="text-xs text-slate-500 hover:text-slate-800 mb-3 flex items-center gap-1"
          >
            <ArrowLeft className="w-3 h-3" /> Back
          </button>
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-sm text-rose-900">
            Org id {orgId} not found in registry.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto flex flex-col">
      {/* Test-mode banner — sticky-top, never dismissible. */}
      {effectiveTestMode && <TestModeBanner orgName={org.name} />}

      <div className="max-w-6xl w-full mx-auto p-8">
        <button
          onClick={onBack}
          className="text-xs text-slate-500 hover:text-slate-800 mb-3 flex items-center gap-1"
        >
          <ArrowLeft className="w-3 h-3" /> Back to org tree
        </button>

        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2 text-violet-600 mb-1">
              <span className="text-xs uppercase tracking-wide font-semibold">
                Admin · Org
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {org.name}
            </h1>
            <div className="flex items-center gap-2 mt-2">
              <StatusPill status={org.status} />
              <span className="text-xs text-slate-500 font-mono">#{org.id}</span>
              {org.ghl_location_id && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  <ExternalLink className="w-2.5 h-2.5" />
                  GHL · {org.ghl_location_id}
                </span>
              )}
              {effectiveTestMode && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                  <TestTube2 className="w-2.5 h-2.5" />
                  test mode
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={openTestModeConfirm}
            disabled={!canToggleTestMode}
            title={canToggleTestMode ? 'Toggle test mode (confirm modal opens)' : 'Requires toggle_test_mode badge'}
            className={
              'inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded border ' +
              (canToggleTestMode
                ? effectiveTestMode
                  ? 'border-emerald-300 text-emerald-700 bg-white hover:bg-emerald-50'
                  : 'border-amber-300 text-amber-700 bg-white hover:bg-amber-50'
                : 'border-slate-200 text-slate-400 bg-slate-50 cursor-not-allowed')
            }
          >
            <TestTube2 className="w-3.5 h-3.5" />
            {effectiveTestMode ? 'Return to live…' : 'Enable test mode…'}
          </button>
        </div>

        <TabsBar tabs={TABS} activeTab={activeTab} onChange={(t) => {
          setActiveTab(t);
          track('mission_control.admin.org_tab_switched', { org_id: org.id, tab: t });
        }} />

        <div className="mt-6">
          {activeTab === 'overview' && <OverviewTab org={{ ...org, test_mode: effectiveTestMode }} />}
          {activeTab === 'users' && <UsersIndex org={org} persona={persona} />}
          {activeTab === 'integrations' && <Integrations org={org} persona={persona} />}
          {activeTab === 'plan-catalog' && <PlanCatalog org={org} persona={persona} />}
          {activeTab === 'config' && (
            <OrgConfiguration
              org={{ ...org, test_mode: effectiveTestMode }}
              persona={persona}
              onOpenTestModeConfirm={openTestModeConfirm}
              canToggleTestMode={canToggleTestMode}
            />
          )}
          {activeTab === 'audit' && <AuditLog org={org} />}
        </div>
      </div>

      {showTestModeConfirm && (
        <TestModeToggleConfirm
          org={org}
          currentValue={effectiveTestMode}
          onConfirm={onTestModeConfirmed}
          onCancel={() => setShowTestModeConfirm(false)}
        />
      )}
    </div>
  );
}

function TabsBar({ tabs, activeTab, onChange }) {
  return (
    <div className="flex items-center border-b border-slate-200">
      {tabs.map((t) => {
        const active = t.key === activeTab;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={
              'inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors ' +
              (active
                ? 'border-violet-600 text-violet-700'
                : 'border-transparent text-slate-500 hover:text-slate-800')
            }
          >
            <Icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function OverviewTab({ org }) {
  const allProviders = Object.keys(integrationsCanon.providers || {});
  const configured = org.integrations
    ? Object.values(org.integrations).filter((v) => v?.status === 'configured').length
    : 0;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <StatCard
        title="Key stats"
        rows={[
          ['Status', <StatusPill key="status" status={org.status} />],
          ['Type', org.type || '—'],
          ['Users', org.users_count ?? '—'],
          ['Integrations', `${configured} of ${allProviders.length} configured`],
          ['Test mode', org.test_mode ? 'ON (sandbox routing)' : 'off'],
          ['GHL location', org.ghl_location_id || '—'],
        ]}
      />
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-slate-900">Org metadata</div>
          <button
            disabled
            title="Phase 2 — edits land server-side"
            className="text-xs text-slate-400 px-2 py-1 rounded border border-slate-200 cursor-not-allowed"
          >
            Edit
          </button>
        </div>
        <div className="text-xs text-slate-500 leading-relaxed">
          Org name + status + type + parent linkage are managed at the canon
          layer in Phase 1 (canon/org-registry.json). Phase 2 edit moves to a
          server-side mutation; this button stays disabled until then.
        </div>
        {org.notes && (
          <div className="mt-3 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded px-3 py-2">
            <span className="font-semibold">Notes:</span> {org.notes}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ title, rows }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
        <div className="text-sm font-semibold text-slate-900">{title}</div>
      </div>
      <dl className="text-xs space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-2">
            <dt className="text-slate-500">{label}</dt>
            <dd className="text-slate-900 font-medium text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
