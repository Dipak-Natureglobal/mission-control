// Public surface for the `product_admin` integration category.
//
// CHARTER: provider-pluggable VSC / GAP / appearance product catalog +
// rate-quote clients. Apps import the category (`product_admin`); the
// active provider per org is resolved from canon `integrations.json` +
// `org-registry.json::orgs[orgId].integrations`.
//
// Today's providers: StoneEagle (SCS Auto), Express Aftermarket (Omega stub).
//
// Dep direction (per architecture/11-platform-package-layout.md):
//   - MAY read `../../../canon/*.json` directly.
//   - MAY import sibling packages.
//   - MUST NOT import from any child app.
//
// ---------------------------------------------------------------------
//
// Available public exports:
//
//   import { getRates } from 'blinker-platform/integrations/product_admin';
//
//   const result = await getRates(input, { orgId, signal });
//
// `input` shape (today, flat — matches existing protection-portal callers):
//   { year, make, model, trim, mileage, condition, state, vin }
//
// `result` shape: see architecture/13-stoneeagle-integration.md.
//
// Phase-1 fallback (returned when org has no enabled product_admin provider):
//   { status: 'no_provider', reason: 'no_provider_configured', plan_rates: [] }

import integrationsCanon from '../../../canon/integrations.json' with { type: 'json' };
import orgRegistry       from '../../../canon/org-registry.json'  with { type: 'json' };

import stoneeagle          from './stoneeagle.js';
import express_aftermarket from './express_aftermarket.js';

const PROVIDERS = {
  stoneeagle,
  express_aftermarket,
};

const CATEGORY = 'product_admin';

/**
 * Resolve the active product_admin provider for an org.
 *
 * Returns `{ provider, providerId, credentials, testMode }` or `null` when
 * no enabled provider in this category is configured for the org.
 */
export function selectProvider(orgId) {
  const orgs = Array.isArray(orgRegistry.orgs) ? orgRegistry.orgs : [];
  const org = orgs.find((o) => String(o.id) === String(orgId));
  if (!org) return null;

  const orgIntegrations = org.integrations || {};
  const testMode = Boolean(org.test_mode);

  // Canon registry of which provider ids belong to this category.
  const providerIdsInCategory = Object.values(integrationsCanon.providers || {})
    .filter((p) => p.category === CATEGORY)
    .map((p) => p.id);

  for (const id of providerIdsInCategory) {
    const orgBlock = orgIntegrations[id];
    if (!orgBlock || orgBlock.enabled !== true) continue;
    const impl = PROVIDERS[id];
    if (!impl) continue;
    const envBlock = (orgBlock.credentials && orgBlock.credentials[testMode ? 'test' : 'live']) || null;
    return {
      provider: impl,
      providerId: id,
      credentials: envBlock,
      testMode,
    };
  }

  return null;
}

/**
 * Get product rates for a vehicle. Resolves the org's active product_admin
 * provider, dispatches the call, returns the normalized response. Phase 1
 * is fixture-backed; Phase 2 routes through a backend SOAP proxy. Same
 * call surface either way.
 */
export async function getRates(input, { orgId, signal } = {}) {
  const resolved = selectProvider(orgId);
  if (!resolved) {
    return {
      status: 'no_provider',
      reason: 'no_provider_configured',
      plan_rates: [],
      products: [], // back-compat with the existing fixture's flat shape
    };
  }
  return resolved.provider.getRates(input, {
    credentials: resolved.credentials,
    testMode: resolved.testMode,
    orgId,
    signal,
  });
}

export default { getRates, selectProvider };
