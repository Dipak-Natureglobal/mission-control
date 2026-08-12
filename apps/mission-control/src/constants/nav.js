// Role-gated navigation config. Every UI surface in mission-control must consult
// this file (or a derivative) — never inline persona checks in components.
//
// Phase 1 ships agent in real shape; manager / admin / super_admin are stubs
// so the persona switcher feels real.
//
// Item shape:
//   { key, label, icon,
//     group?: string,          // section header label; emitted above first item in each new group
//     external?: {
//       url_template: string,  // token {ghl_location_id} substituted at render time
//       requires: string,      // org field that must be truthy; renders disabled row if missing
//     }
//   }
// Internal items (no external) are routed via onSelect(key) inside the shell.

export const NAV_BY_PERSONA = {
  agent: [
    { key: 'home',      label: 'Home',      icon: 'LayoutDashboard' },
    { key: 'compete',   label: 'Compete',   icon: 'Trophy' },
    { key: 'inbox',     label: 'Inbox',     icon: 'Inbox' },
    { key: 'contacts',  label: 'Contacts',  icon: 'Users' },
    // GHL external links — open CRM in a new tab; url_template resolved at render time
    { key: 'ghl_contacts',      label: 'Contacts',      icon: 'Users',           group: 'CRM', external: { url_template: 'https://crm.blinker.com/v2/location/{ghl_location_id}/contacts/smart_list/All',                                          requires: 'ghl_location_id' } },
    { key: 'ghl_opportunities', label: 'Opportunities', icon: 'TrendingUp',                    external: { url_template: 'https://crm.blinker.com/v2/location/{ghl_location_id}/opportunities',                                                     requires: 'ghl_location_id' } },
    { key: 'ghl_calendar',      label: 'Calendar',      icon: 'Calendar',                      external: { url_template: 'https://crm.blinker.com/v2/location/{ghl_location_id}/calendars/view',                                                   requires: 'ghl_location_id' } },
    { key: 'ghl_conversations', label: 'Conversations', icon: 'MessageSquare',                 external: { url_template: 'https://crm.blinker.com/v2/location/{ghl_location_id}/conversations/conversations/?category=team-inbox&tab=unread',      requires: 'ghl_location_id' } },
    { key: 'ghl_dashboard',     label: 'Dashboard',     icon: 'LayoutDashboard',               external: { url_template: 'https://crm.blinker.com/v2/location/{ghl_location_id}/dashboard',                                                        requires: 'ghl_location_id' } },
    // Reports — internal route to AgentReports iframe embed (ADR 16)
    { key: 'reports', label: 'Reports', icon: 'BarChart3', group: 'Reports' },
  ],
  manager: [
    { key: 'home',       label: 'Home',       icon: 'LayoutDashboard' },
    { key: 'team',       label: 'Team',       icon: 'Users' },
    { key: 'inbox',      label: 'Inbox',      icon: 'Inbox' },
    { key: 'assignment', label: 'Assignment', icon: 'UserCheck' },
    { key: 'metrics',    label: 'Metrics',    icon: 'BarChart3' },
    { key: 'tags',       label: 'Tags',       icon: 'Tag' },
  ],
  admin: [
    { key: 'dashboard',    label: 'Dashboard',     icon: 'LayoutDashboard' },
    { key: 'org',          label: 'Org tree',      icon: 'Network' },
    { key: 'users',        label: 'Users',         icon: 'Users' },
    { key: 'integrations',  label: 'Integrations',       icon: 'Plug' },
    { key: 'plan-catalog', label: 'Plan presentations', icon: 'ShieldCheck' },
    { key: 'config',       label: 'Configuration',      icon: 'Sliders' },
    { key: 'audit',        label: 'Audit log',     icon: 'FileText' },
  ],
  super_admin: [
    // Wave 19 Task 6 — Dashboard becomes default landing (Cross-org analytics
    // content lives inside SuperHome; the rest dispatch via activeKey).
    // Integration catalog intentionally removed — admin role view owns it
    // and super_admin reaches it via persona switch (per Wave 19 Task 6 spec).
    { key: 'dashboard',      label: 'Dashboard',          icon: 'LayoutDashboard' },
    { key: 'status_mapping', label: 'Status mapping',     icon: 'GitBranch' },
    { key: 'user_directory', label: 'User directory',     icon: 'Users' },
    { key: 'org_registry',   label: 'Org registry',       icon: 'Network' },
    { key: 'audit_trail',    label: 'Audit trail',        icon: 'FileText' },
    { key: 'canon_drift',    label: 'Canon drift',        icon: 'Activity' },
  ],
};

export const PERSONAS = [
  { value: 'agent',       label: 'Agent' },
  { value: 'manager',     label: 'Manager' },
  { value: 'admin',       label: 'Admin' },
  { value: 'super_admin', label: 'Super Admin' },
];

// Wave 28e — manager preset-aware nav filter. The `manager_assign_only`
// preset (canon/personas.json) hides Home / Team / Metrics so the
// coordinator-only role lands directly on Assignment with no distracting
// surfaces. Other manager presets see the full nav unchanged.
//
// Wave 29b — Tags screen is gated by the `create_tags` badge.
// `manager_standard` + `manager_lead` carry it; `manager_assign_only`
// does NOT (it carries only `add_tags`). The assign-only filter below
// drops 'tags' implicitly because it already drops everything except
// assignment/inbox; we still keep the badge-driven exclusion explicit
// in case a future preset carries assignment + something else without
// create_tags.
const MANAGER_ASSIGN_ONLY_NAV_KEYS = new Set(['assignment', 'inbox']);
const MANAGER_TAGS_GATED_PRESETS = new Set(['manager_assign_only']);

export function getNavForManager(presetId) {
  const base = NAV_BY_PERSONA.manager;
  if (presetId === 'manager_assign_only') {
    return base.filter((item) => MANAGER_ASSIGN_ONLY_NAV_KEYS.has(item.key));
  }
  if (MANAGER_TAGS_GATED_PRESETS.has(presetId)) {
    return base.filter((item) => item.key !== 'tags');
  }
  return base;
}
