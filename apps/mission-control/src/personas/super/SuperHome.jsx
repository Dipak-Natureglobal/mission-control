// SuperHome — Blinker-internal cross-org views.
//
// Wave 19 Task 6 — converted from a tile-grid landing into a router that
// dispatches on left-nav `activeKey`. The original Phase 1B / Wave 14 tile
// grid moves to the Dashboard view (activeKey === 'dashboard'); each other
// nav item now drives its own pane:
//
//   dashboard      → SuperDashboard (the original cross-org tile content;
//                    spec said "We already have the content for it but it
//                    says we are on cross-org analytics" — promote to
//                    Dashboard).
//   status_mapping → StatusMappingEditor (existing; Wave 13)
//   user_directory → UserDirectory   (NEW; Wave 19 Task 6)
//   org_registry   → OrgRegistry     (NEW; Wave 19 Task 6 — replaces the
//                    legacy tile-handoff to the admin OrgTree)
//   audit_trail    → AuditLog superMode
//   canon_drift    → CanonDrift
//
// Integration catalog removed per Wave 19 Task 6 spec ("redundant with admin
// role view"). Super_admin reaches it via persona-switch when needed.
//
// Routing model: activeKey lives on App.jsx; we just dispatch on it.

import {
  Activity,
  CheckCircle2,
  ChevronRight,
  FileText,
  GitBranch,
  Globe,
  Network,
  Users as UsersIcon,
} from 'lucide-react';
import canonVersion from '../../constants/canon/_version?raw';
import orgRegistry from '../../constants/canon/org-registry.json';
import { StatusMappingEditor } from './StatusMappingEditor.jsx';
import { UserDirectory } from './UserDirectory.jsx';
import { OrgRegistry } from './OrgRegistry.jsx';
import { AuditLog } from '../admin/AuditLog.jsx';
import { track } from 'blinker-platform/telemetry';

// canon/_version is shipped as a tiny text file. Vite ?raw import returns
// the string. The version string is the only thing this file needs.
const CANON_VERSION = (canonVersion || '').trim() || 'unknown';
const EXPECTED_VERSION = '2026-05-05-wave14-admin-console-init';

export function SuperHome({ activeKey, onNavigate }) {
  // Default landing — when App boots in super persona, NAV_BY_PERSONA picks
  // 'dashboard' (the new first item) so this branch is what the user sees.
  const key = activeKey || 'dashboard';

  if (key === 'status_mapping') {
    return <StatusMappingEditor />;
  }
  if (key === 'user_directory') {
    return (
      <SuperPaneShell title="User directory" subtitle="Cross-org user search + persona presets">
        <UserDirectory persona="super_admin" />
      </SuperPaneShell>
    );
  }
  if (key === 'org_registry') {
    return (
      <SuperPaneShell title="Org registry" subtitle="CRUD orgs + edit hierarchy + copy/edit configs">
        <OrgRegistry persona="super_admin" />
      </SuperPaneShell>
    );
  }
  if (key === 'audit_trail') {
    return (
      <SuperPaneShell title="Cross-org audit trail" subtitle="Every admin-console mutation across every org">
        <AuditLog org={null} superMode={true} />
      </SuperPaneShell>
    );
  }
  if (key === 'canon_drift') {
    return (
      <SuperPaneShell title="Canon drift" subtitle="Live canon version vs. expected">
        <CanonDrift />
      </SuperPaneShell>
    );
  }

  // Default: dashboard tile grid.
  return <SuperDashboard onNavigate={onNavigate} />;
}

// SuperDashboard — original cross-org analytics landing content. Tile grid
// kept for the dashboard view; tiles are now clickable and navigate to the
// matching activeKey (mirroring the left nav).
function SuperDashboard({ onNavigate }) {
  const orgCount = (orgRegistry.orgs || []).length;

  function handleTileClick(tileId, activeKey) {
    track('mission_control.super_admin.dashboard_tile_clicked', { tile_id: tileId });
    if (onNavigate) onNavigate(activeKey);
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl mx-auto p-8">
        <div className="flex items-center gap-2 text-amber-600 mb-2">
          <Globe className="w-4 h-4" />
          <span className="text-xs uppercase tracking-wide font-semibold">Super Admin · Dashboard</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 mb-1">Hello, Super Admin</h1>
        <p className="text-sm text-slate-500 mb-6">
          Cross-org analytics, audit trail, system health, canon drift.
        </p>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <StatTile label="Orgs in registry" value={orgCount} />
          <StatTile
            label="Canon"
            value={CANON_VERSION === EXPECTED_VERSION ? 'in sync' : 'drift'}
            tone={CANON_VERSION === EXPECTED_VERSION ? 'emerald' : 'amber'}
            sub={CANON_VERSION}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Tile
            icon={GitBranch}
            label="Status mapping editor"
            blurb="Map GHL pipelines + stages onto platform statuses per workflow (VSC / Refi / Insurance / Payments)."
            onClick={() => handleTileClick('status_mapping_editor', 'status_mapping')}
          />
          <Tile
            icon={Network}
            label="Org registry"
            blurb={`CRUD orgs + edit hierarchy + copy/edit configs (${orgCount} orgs).`}
            onClick={() => handleTileClick('org_registry', 'org_registry')}
          />
          <Tile
            icon={UsersIcon}
            label="User directory"
            blurb="Cross-org user search + persona presets. Add to any org, edit profile, reset password."
            onClick={() => handleTileClick('user_directory', 'user_directory')}
          />
          <Tile
            icon={FileText}
            label="Cross-org audit trail"
            blurb="Every admin-console mutation across every org. Filter chips + day grouping."
            onClick={() => handleTileClick('cross_org_audit_trail', 'audit_trail')}
          />
          <Tile
            icon={Activity}
            label="Canon drift"
            blurb="Compares the bundled canon _version to the expected platform stamp."
            onClick={() => handleTileClick('canon_drift', 'canon_drift')}
          />
        </div>
      </div>
    </div>
  );
}

function SuperPaneShell({ title, subtitle, children }) {
  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center gap-2 text-amber-600 mb-1">
          <span className="text-xs uppercase tracking-wide font-semibold">Super Admin · {title}</span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 mb-1">{title}</h1>
        {subtitle && <p className="text-xs text-slate-500 mb-5">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

function Tile({ icon: Icon, label, blurb, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full bg-white border border-slate-200 rounded-xl shadow-sm p-5 text-left cursor-pointer hover:ring-2 hover:ring-amber-300 hover:border-amber-200 transition-all"
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-900">{label}</div>
            <ChevronRight className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-xs text-slate-500 mt-1 leading-relaxed">{blurb}</div>
        </div>
      </div>
    </button>
  );
}

function StatTile({ label, value, sub, tone = 'slate' }) {
  const cls = {
    slate:   'border-slate-200',
    emerald: 'border-emerald-200',
    amber:   'border-amber-200',
  }[tone];
  return (
    <div className={'bg-white border rounded-xl shadow-sm p-5 ' + cls}>
      <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">{label}</div>
      <div className="text-2xl font-semibold text-slate-900 mt-2">{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-1 font-mono">{sub}</div>}
    </div>
  );
}

function CanonDrift() {
  const inSync = CANON_VERSION === EXPECTED_VERSION;
  // Side-effect: log the canon-drift open for telemetry parity with the
  // status-mapping pane.
  if (typeof window !== 'undefined' && !window.__superCanonDriftLogged) {
    window.__superCanonDriftLogged = true;
    track('mission_control.super.canon_drift_opened', {
      canon_version: CANON_VERSION,
      expected: EXPECTED_VERSION,
      in_sync: inSync,
    });
  }
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
      <div className="flex items-center gap-2">
        {inSync ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
        ) : (
          <Activity className="w-5 h-5 text-amber-600" />
        )}
        <div className="text-sm font-semibold text-slate-900">
          {inSync ? `Canon in sync · ${CANON_VERSION}` : 'Canon drift detected'}
        </div>
      </div>
      <div className="text-xs text-slate-600 leading-relaxed">
        Compares the canon copy bundled with this app to the platform's
        expected stamp. When out of sync, run{' '}
        <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">
          scripts/sync-canon-into-apps.sh
        </code>{' '}
        from the platform repo.
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="border border-slate-200 rounded p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">
            App's canon copy
          </div>
          <div className="font-mono text-slate-900">{CANON_VERSION}</div>
        </div>
        <div className="border border-slate-200 rounded p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">
            Expected
          </div>
          <div className="font-mono text-slate-900">{EXPECTED_VERSION}</div>
        </div>
      </div>
    </div>
  );
}
