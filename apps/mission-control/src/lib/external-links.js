// URL-building helpers for GHL external links and Looker Studio embed URLs.
// Per architecture/16-looker-embed.md: canon stores ids only; URL construction
// lives here so the user's email is substituted at render time and the iframe
// src is the only place the full URL exists.

/**
 * Returns the first active org in the registry that has a ghl_location_id.
 * Phase 1 resolves to Apex (102). Returns null if none found.
 * @param {object} orgRegistry - parsed org-registry.json
 */
export function resolveAgentOrg(orgRegistry) {
  if (!orgRegistry?.orgs) return null;
  return orgRegistry.orgs.find(
    (o) => o.status === 'active' && o.ghl_location_id
  ) ?? null;
}

/**
 * Resolves the user's email for Looker param substitution.
 * Session shape is not yet defined for agent persona — be defensive.
 * Falls back to the canon-stamped _demo_user_email (jimmy@aautoalliance.com).
 * @param {object|null} session
 * @param {object} orgRegistry - parsed org-registry.json
 */
export function resolveUserEmail(session, orgRegistry) {
  return session?.user?.email || orgRegistry?._demo_user_email || '';
}

/**
 * Substitutes {ghl_location_id} in template using org.ghl_location_id.
 * Returns null if org is missing or has no location id.
 * @param {string} template
 * @param {object|null} org
 */
export function buildGhlUrl(template, org) {
  if (!org?.ghl_location_id) return null;
  return template.replace('{ghl_location_id}', org.ghl_location_id);
}

/**
 * Builds a Looker Studio embed URL.
 * - Substitutes {user_email} in each value of params_template (shallow clone).
 * - Appends /page/{page_id} only when page_id is truthy.
 * - Returns null if report_id is missing.
 *
 * Shape:
 *   https://lookerstudio.google.com/embed/reporting/{report_id}[/page/{page_id}]
 *     ?params={encodeURIComponent(JSON.stringify(filledTemplate))}
 *
 * @param {{ report_id: string, page_id?: string|null, params_template?: object, user_email?: string }}
 */
export function buildLookerEmbedUrl({ report_id, page_id, params_template, user_email }) {
  if (!report_id) return null;

  const email = user_email || '';
  const filled = {};
  for (const [k, v] of Object.entries(params_template || {})) {
    filled[k] = typeof v === 'string' ? v.replace('{user_email}', email) : v;
  }

  const pageSeg = page_id ? `/page/${page_id}` : '';
  const params = encodeURIComponent(JSON.stringify(filled));
  return `https://lookerstudio.google.com/embed/reporting/${report_id}${pageSeg}?params=${params}`;
}
