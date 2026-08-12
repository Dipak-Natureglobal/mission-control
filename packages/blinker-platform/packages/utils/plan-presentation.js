// Wave 27 v3.0.8 Task 1 + Task 2 — plan presentation resolver.
//
// Resolves the customer-facing presentation of a single plan from a rates
// response (post-StoneEagle GetRates normalization). Inputs identify the plan
// by (TpaCode, ProductTypeCode, PlanCode); outputs are the strings the
// PlanCard / coverage modal / DocuSeal flow should render.
//
// Resolution order, most-specific-first:
//   1. Per-org override   — orgRegistry.orgs[].plan_overrides[key]
//   2. Global catalog     — planMappings.plan_catalog[key]
//   3. Name-match fallback — planMappings.default_quality_mapping
//                            (case-insensitive substring on planName)
//   4. Hard-coded fallback — `good` level, planName as title
//
// `key` format: `${tpa}::${ptc}::${plan_code}`. TpaCode for the org is
// resolved from org-registry integrations.stoneeagle (test env wins when
// org.test_mode = true; live otherwise) so callers only need to pass orgId.
//
// HTML resolution: per-plan plan_coverage_html (override-or-catalog) wins;
// otherwise plan_level_defaults[level].plan_coverage_default_html. The
// `{{SAMPLE_AGREEMENT_URL}}` placeholder in default HTMLs is replaced with
// the resolved sample_agreement_url (or `#` if absent — the modal renders
// the link as disabled-looking in that case).
//
// DocuSeal template resolution: plan-level docuseal_template_id (override-
// or-catalog) wins; otherwise per-org integrations.docuseal.credentials
// .template_id_by_plan[key]; otherwise null (caller falls back to the
// integration's default behavior).
//
// Pure function. No React, no fetch, no canon side-effects beyond the
// JSON imports below.

import planMappings from '../../canon/plan-mappings.json' with { type: 'json' };
import orgRegistry  from '../../canon/org-registry.json'  with { type: 'json' };

const QUALITY_KEYS_ORDERED = [
  ['EXCLUSIONARY', 'best'],
  ['EXCL',         'best'],
  ['POWERTRAIN PLUS',     'better'],
  ['POWERTRAIN ENHANCED', 'better'],
  ['POWERTRAIN',          'good'],
  ['USED STATED',         'good'],
  ['ADD-ON',              'good'],
];

function nameMatchLevel(planName) {
  if (!planName) return 'good';
  const upper = String(planName).toUpperCase();
  for (const [needle, level] of QUALITY_KEYS_ORDERED) {
    if (upper.includes(needle)) return level;
  }
  return 'good';
}

function planKey(tpaCode, productTypeCode, planCode) {
  if (!tpaCode || !planCode) return null;
  return `${tpaCode}::${productTypeCode || 'UNKNOWN'}::${planCode}`;
}

function resolveOrgTpaCode(org) {
  const se = org?.integrations?.stoneeagle?.credentials || null;
  if (!se) return null;
  const env = org?.test_mode ? 'test' : 'live';
  return se[env]?.tpa_code || se.live?.tpa_code || se.test?.tpa_code || null;
}

function interpolateUrl(html, sampleAgreementUrl) {
  if (!html) return html;
  const url = sampleAgreementUrl || '#';
  return html.replaceAll('{{SAMPLE_AGREEMENT_URL}}', url);
}

/**
 * Resolve presentation strings for a single plan.
 *
 * @param {object} args
 * @param {number|string|null} args.orgId           — org-registry id (for per-org overrides + TpaCode resolution)
 * @param {string|null} args.tpaCode                — explicit TpaCode override; falls back to org's StoneEagle creds
 * @param {string|null} args.productTypeCode        — SE Plan Object ProductTypeCode (VSC/GAP/MNT/…)
 * @param {string|null} args.planCode               — SE Plan Object PlanCode
 * @param {string|null} args.planName               — raw PlanDescription/name from the rater (fallback for title + level name-match)
 * @returns {{
 *   planLevel:           'good'|'better'|'best',
 *   planTitle:           string,
 *   tagline:             string,
 *   coverageHtml:        string,
 *   sampleAgreementUrl:  string|null,
 *   docusealTemplateId:  string|null,
 *   source: {
 *     level:      'org_override'|'catalog'|'name_match'|'fallback',
 *     title:      'org_override'|'catalog'|'plan_name',
 *     coverage:   'org_override'|'catalog'|'level_default',
 *     docuseal:   'org_override_plan'|'catalog'|'org_default_by_plan'|null,
 *   },
 * }}
 */
export function resolvePlanPresentation({
  orgId = null,
  tpaCode = null,
  productTypeCode = null,
  planCode = null,
  planName = null,
} = {}) {
  const org = orgId != null
    ? (orgRegistry.orgs || []).find((o) => o.id === orgId) || null
    : null;

  const resolvedTpa = tpaCode || resolveOrgTpaCode(org);
  const key = planKey(resolvedTpa, productTypeCode, planCode);

  const orgOverride = key ? (org?.plan_overrides?.[key] || null) : null;
  const catalog     = key ? (planMappings.plan_catalog?.[key] || null) : null;

  // 1) PlanLevel
  let planLevel = null;
  let levelSource = null;
  if (orgOverride?.plan_level) { planLevel = orgOverride.plan_level; levelSource = 'org_override'; }
  else if (catalog?.plan_level) { planLevel = catalog.plan_level; levelSource = 'catalog'; }
  else { planLevel = nameMatchLevel(planName); levelSource = planName ? 'name_match' : 'fallback'; }
  if (!['good', 'better', 'best'].includes(planLevel)) planLevel = 'good';

  // 2) PlanTitle
  let planTitle = null;
  let titleSource = null;
  if (orgOverride?.plan_title) { planTitle = orgOverride.plan_title; titleSource = 'org_override'; }
  else if (catalog?.plan_title) { planTitle = catalog.plan_title; titleSource = 'catalog'; }
  else { planTitle = planName || 'Plan'; titleSource = 'plan_name'; }

  // 3) Coverage HTML
  const levelDefault = planMappings.plan_level_defaults?.[planLevel] || {};
  const sampleAgreementUrl =
    orgOverride?.sample_agreement_url ?? catalog?.sample_agreement_url ?? null;

  let coverageHtmlRaw = null;
  let coverageSource = null;
  if (orgOverride?.plan_coverage_html) { coverageHtmlRaw = orgOverride.plan_coverage_html; coverageSource = 'org_override'; }
  else if (catalog?.plan_coverage_html) { coverageHtmlRaw = catalog.plan_coverage_html; coverageSource = 'catalog'; }
  else { coverageHtmlRaw = levelDefault.plan_coverage_default_html || ''; coverageSource = 'level_default'; }
  const coverageHtml = interpolateUrl(coverageHtmlRaw, sampleAgreementUrl);

  // 4) Tagline (inline card subtitle — falls back to level default)
  const tagline =
    orgOverride?.tagline ??
    catalog?.tagline ??
    levelDefault.tagline_default ??
    '';

  // 4b) Covered components — structured array for the v3.0.12 redesigned
  // RecommendedCoverage tier-selector UI. Resolution order mirrors
  // coverageHtml: org_override → catalog → level_default. Falls back to []
  // so consumers can render an empty grid without null-checks.
  let coveredComponents = null;
  let coveredComponentsSource = null;
  if (Array.isArray(orgOverride?.covered_components)) {
    coveredComponents = orgOverride.covered_components;
    coveredComponentsSource = 'org_override';
  } else if (Array.isArray(catalog?.covered_components)) {
    coveredComponents = catalog.covered_components;
    coveredComponentsSource = 'catalog';
  } else if (Array.isArray(levelDefault.covered_components_default)) {
    coveredComponents = levelDefault.covered_components_default;
    coveredComponentsSource = 'level_default';
  } else {
    coveredComponents = [];
    coveredComponentsSource = 'empty';
  }

  // 5) DocuSeal template id (per v3.0.8 Task 2)
  let docusealTemplateId = null;
  let docusealSource = null;
  if (orgOverride?.docuseal_template_id) {
    docusealTemplateId = orgOverride.docuseal_template_id;
    docusealSource = 'org_override_plan';
  } else if (catalog?.docuseal_template_id) {
    docusealTemplateId = catalog.docuseal_template_id;
    docusealSource = 'catalog';
  } else {
    const orgByPlan = org?.integrations?.docuseal?.credentials?.template_id_by_plan || null;
    if (orgByPlan && key && orgByPlan[key]) {
      docusealTemplateId = orgByPlan[key];
      docusealSource = 'org_default_by_plan';
    }
  }

  return {
    planLevel,
    planTitle,
    tagline,
    coverageHtml,
    coveredComponents,
    sampleAgreementUrl,
    docusealTemplateId,
    source: {
      level: levelSource,
      title: titleSource,
      coverage: coverageSource,
      coveredComponents: coveredComponentsSource,
      docuseal: docusealSource,
    },
  };
}

/**
 * Read the default PlanLevel presentation block from canon. Used by the
 * mission-control admin "Defaults" sub-tab when seeding the rich-text editor.
 */
export function getPlanLevelDefaults(level) {
  return planMappings.plan_level_defaults?.[level] || null;
}

/**
 * Enumerate every catalog entry. Used by the mission-control admin
 * "Plans" sub-tab to list all known (TpaCode, ProductTypeCode, PlanCode)
 * combinations. Filters out the _comment / _seed_pending_admin_population
 * meta keys.
 */
export function listPlanCatalog() {
  const cat = planMappings.plan_catalog || {};
  return Object.entries(cat)
    .filter(([k]) => !k.startsWith('_'))
    .map(([key, entry]) => ({ key, ...entry }));
}
