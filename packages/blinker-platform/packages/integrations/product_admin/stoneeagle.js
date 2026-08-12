// StoneEagle (SCS Auto / SEFI) provider impl for the `product_admin` category.
//
// Two modes, selected at call-time:
//
//   'fixture'  — Returns the captured GetRates fixture with a deterministic
//                FNV-1a price perturbation seeded by VIN (or YMMT+mileage
//                fallback). Canonical fixture VIN '2HGFE2F54SH551994' anchors
//                at 1.00x; other inputs scale in [0.85, 1.15].
//
//   'proxy'    — Wave 21-fu dev mode: builds a real SCS Auto SOAP envelope
//                in the browser and POSTs it to a SAME-ORIGIN relative path
//                (`/se-rating/scsautoservice.asmx`). Vite's dev-server proxy
//                forwards to the org's UAT host. The fixture is ALSO
//                computed in parallel and stashed on the result as
//                `_fixture_comparison` so ApiResponsesModal can render
//                fixture vs. real side by side. Production builds force
//                'fixture' until the backend SOAP proxy lands.
//
// Mode resolution (per call):
//   - If `import.meta.env.DEV` is false  → 'fixture' (always).
//   - Else read `localStorage['blinker.dev.product_admin_mode']`
//     (default 'fixture'). Toggle lives in protection-portal DevPanel.
//
// References:
//   - architecture/13-stoneeagle-integration.md
//   - architecture/integration-partners/stoneeagle/SEFI-SCS-eRating-Integration-Guide-v1.31.pdf
//   - canon/integrations.json::providers.stoneeagle
//   - canon/plan-mappings.json (Good/Better/Best, RegulatedRuleId, Discountable)
//   - BlinkerLegacy stone_eagle/get_rates.rb (envelope template) +
//     stone_eagle/get_rates.xml (captured response shape)

import fixture      from './_fixtures/stone-eagle-get-rates.json' with { type: 'json' };
// Wave 25 v3.0.7 Phase C-bridge — VIN-validate dev fixture variants.
// All 6 are imported statically (bundle-size impact is dev-only; ~30 KB total).
import fixtureClassChanged    from './_fixtures/stone-eagle-get-rates-vin-class-changed.json'        with { type: 'json' };
import fixtureYmmtChanged     from './_fixtures/stone-eagle-get-rates-vin-ymmt-changed.json'         with { type: 'json' };
import fixturePlanDisappeared from './_fixtures/stone-eagle-get-rates-vin-plan-disappeared.json'     with { type: 'json' };
import fixturePriceLower      from './_fixtures/stone-eagle-get-rates-vin-price-lower.json'          with { type: 'json' };
import fixturePriceWithinTol  from './_fixtures/stone-eagle-get-rates-vin-price-within-tolerance.json' with { type: 'json' };
import fixturePriceOutsideTol from './_fixtures/stone-eagle-get-rates-vin-price-outside-tolerance.json' with { type: 'json' };
import fixtureMonthly         from './_fixtures/stone-eagle-get-rates-monthly.json'                   with { type: 'json' };
import orgRegistry  from '../../../canon/org-registry.json'        with { type: 'json' };
import planMappings from '../../../canon/plan-mappings.json'       with { type: 'json' };
import { computePlanPrice, getOrgMarkupSnapshot, resolveMonthlyMembershipPricing } from '../../utils/protection-pricing.js';
import { classifyVehicle } from '../../utils/vehicle-class.js';
import { track } from '../../telemetry/index.js';

// ---------- Mode resolution ------------------------------------------------

const PROVIDER_MODE_KEY = 'blinker.dev.product_admin_mode';

function resolveProviderMode() {
  let inDev = false;
  try { inDev = !!(import.meta && import.meta.env && import.meta.env.DEV); }
  catch { inDev = false; }
  if (!inDev) return 'fixture';
  try {
    const stored = (typeof localStorage !== 'undefined' && localStorage.getItem(PROVIDER_MODE_KEY)) || null;
    if (stored === 'proxy' || stored === 'fixture') return stored;
  } catch { /* localStorage unavailable */ }
  return 'fixture';
}

// ---------- Wave 25 v3.0.7: VIN-fixture variant resolution -----------------
//
// When running in dev + fixture mode and a VIN is attached to the request,
// the caller may opt into one of 6 scenario fixtures via a localStorage key.
// This lets Phase C VinValidate.jsx smoke the full classifyRatesChange()
// branch table without hitting a real SE proxy.
//
// Activation conditions (ALL must be true):
//   1. import.meta.env.DEV is truthy
//   2. resolveProviderMode() === 'fixture'
//   3. input.vin is non-empty
//   4. localStorage['blinker.dev.vin_validate_scenario'] is one of the 6 keys

const VIN_VALIDATE_SCENARIO_KEY = 'blinker.dev.vin_validate_scenario';

const VIN_FIXTURE_VARIANTS = {
  'class-changed':           fixtureClassChanged,
  'ymmt-changed':            fixtureYmmtChanged,
  'plan-disappeared':        fixturePlanDisappeared,
  'price-lower':             fixturePriceLower,
  'price-within-tolerance':  fixturePriceWithinTol,
  'price-outside-tolerance': fixturePriceOutsideTol,
};

/**
 * Returns { fixture, scenario } when all 4 activation conditions hold,
 * or null to fall back to the baseline fixture.
 * @param {{ vin?: string }} input
 * @returns {{ fixture: object, scenario: string } | null}
 */
function resolveVinFixtureVariant(input) {
  let inDev = false;
  try { inDev = !!(import.meta && import.meta.env && import.meta.env.DEV); } catch { inDev = false; }
  if (!inDev) return null;
  if (resolveProviderMode() !== 'fixture') return null;
  if (!input || !input.vin) return null;
  let scenario = null;
  try { scenario = (typeof localStorage !== 'undefined' && localStorage.getItem(VIN_VALIDATE_SCENARIO_KEY)) || null; } catch { /* localStorage unavailable */ }
  if (!scenario || !VIN_FIXTURE_VARIANTS[scenario]) return null;
  return { fixture: VIN_FIXTURE_VARIANTS[scenario], scenario };
}

// ADR 28 — opt-in monthly-membership demo. When the DevPanel toggle sets this
// localStorage key, getRatesFixture appends the SYNTHETIC monthly products
// (stone-eagle-get-rates-monthly.json) onto the base fixture so the term/monthly
// switch UX is testable in fixture mode. Off by default; never affects proxy mode.
const MONTHLY_DEMO_KEY = 'blinker.dev.monthly_membership_demo';
function monthlyDemoEnabled() {
  if (resolveProviderMode() !== 'fixture') return false;
  try {
    return typeof localStorage !== 'undefined' && !!localStorage.getItem(MONTHLY_DEMO_KEY);
  } catch { return false; }
}

// ---------- Fixture impl (Phase 1) -----------------------------------------

const NETWORK_DELAY_MS = 400;
const PRICE_PERTURB_FLOOR = 0.85;
const PRICE_PERTURB_CEILING = 1.15;
const FIXTURE_VIN = '2HGFE2F54SH551994';

function hashToUnit(seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff;
}

function buildSeed({ vin, year, make, model, trim, mileage }) {
  const vinTail = vin && vin.length >= 8 ? vin.slice(-8) : '';
  return [
    vinTail,
    year ?? '',
    String(make ?? '').toLowerCase().trim(),
    String(model ?? '').toLowerCase().trim(),
    String(trim ?? '').toLowerCase().trim(),
    mileage ?? '',
  ].join('|');
}

function roundDollars(n) { return Math.round(n); }
function roundCents(n) { return Math.round(n * 100) / 100; }

function computeFixture(input, fixtureData) {
  const { year, make, model, trim, mileage, condition, state, vin } = input;
  // Wave 25 v3.0.7: allow callers to supply an alternate fixture (VIN variant).
  const response = JSON.parse(JSON.stringify(fixtureData || fixture));
  response.request = {
    ...response.request,
    year:      year      ?? response.request.year,
    make:      make      ?? response.request.make,
    model:     model     ?? response.request.model,
    trim:      trim      ?? response.request.trim,
    mileage:   mileage   ?? response.request.mileage,
    condition: condition ?? response.request.condition,
    state:     state     ?? response.request.state,
    vin:       vin       ?? response.request.vin,
  };
  response.status = 'ok';

  const isFixtureVin = vin && vin.toUpperCase() === FIXTURE_VIN;
  if (isFixtureVin) return response;

  const haveEnough = (vin && vin.length >= 8) || (year && make && model);
  if (!haveEnough) return response;

  const baseSeed = buildSeed({ vin, year, make, model, trim, mileage });
  response.products = response.products.map((p) => {
    const factorUnit = hashToUnit(baseSeed + ':' + p.id);
    const factor = PRICE_PERTURB_FLOOR + factorUnit * (PRICE_PERTURB_CEILING - PRICE_PERTURB_FLOOR);
    // ADR 28 — monthly-subscription products price as a recurring monthly
    // charge; keep base_price/monthly_price/monthly_charge in lockstep so the
    // selector + Confirm read a single perturbed value.
    if (p.billing_model === 'monthly_subscription') {
      const charge = roundCents((p.monthly_charge ?? p.monthly_price ?? p.base_price) * factor);
      return { ...p, base_price: charge, monthly_price: charge, monthly_charge: charge };
    }
    return {
      ...p,
      base_price: roundDollars(p.base_price * factor),
      monthly_price: roundCents(p.monthly_price * factor),
    };
  });

  return response;
}

async function getRatesFixture(input) {
  await new Promise((resolve) => setTimeout(resolve, NETWORK_DELAY_MS));
  // Wave 25 v3.0.7: when a VIN-validate scenario is active, swap in the
  // matching variant fixture so the second SE call returns scenario-specific
  // data for classifyRatesChange() smoke testing.
  const variant = resolveVinFixtureVariant(input);
  if (variant) {
    track('protection.stoneeagle.fixture.vin_variant_loaded', {
      scenario: variant.scenario,
      vin: input.vin ? input.vin.slice(-4) : null,
    });
    return computeFixture(input, variant.fixture);
  }
  const resp = computeFixture(input);
  // ADR 28 — append synthetic monthly-membership products when the demo toggle
  // is on. Deep-cloned so the imported fixture isn't mutated across calls.
  if (monthlyDemoEnabled()) {
    const monthly = JSON.parse(JSON.stringify(fixtureMonthly.products || []));
    track('protection.stoneeagle.fixture.monthly_demo_loaded', { count: monthly.length });
    resp.products = [...(resp.products || []), ...monthly];
  }
  return resp;
}

// ---------- Proxy impl (Wave 21-fu dev mode) -------------------------------

const SOAP_ACTION_GET_RATES = 'http://www.natinc.com/SCSAutoService/GetRates';
// Same-origin path; vite dev-server proxy forwards `/se-rating` → upstream
// SCS host (configured in protection-portal/vite.config.js). Production
// builds never reach this path because resolveProviderMode() forces fixture.
const PROXIED_PATH = '/se-rating/scsautoservice.asmx';

function escapeXml(s) {
  return String(s ?? '').replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  })[c]);
}

function buildSoapEnvelope(input, creds) {
  const today = new Date().toISOString().slice(0, 10);
  // input.condition can be 'N'/'U' directly (from the parallel orchestrator)
  // or a free-form 'new'/'used' string (from legacy callers).
  const newUsed = input.condition === 'N' || input.condition === 'U'
    ? input.condition
    : (input.condition && /new/i.test(input.condition)) ? 'N' : 'U';
  const mileage = input.mileage ?? 0;

  // Wave 23-fu2 — AssetType resolution (PDF v3.0.5 follow-up).
  // SE recognizes 'P' (passenger), 'T' (truck/SUV/van/etc.), 'AL' (antique).
  // Caller resolves from VinAudit `type` (VIN path) or YMMT lookup
  // (make/model path) via packages/utils/asset-type.js + ymmt-data.js, then
  // passes input.asset_type. Default 'P' covers the common consumer-vehicle
  // case; the previous hardcoded 'T' miscategorized every sedan as a truck
  // and skewed GetRates output (surfaced 2026-05-09 OMGA UAT — Maxima SR
  // returned wrong rate set).
  const assetType = input.asset_type && /^(P|T|AL)$/i.test(input.asset_type)
    ? input.asset_type.toUpperCase()
    : 'P';

  let vehicleIdentifier;
  if (input.vin) {
    const trimTag = input.trim ? `<Trim>${escapeXml(String(input.trim).toUpperCase())}</Trim>` : '';
    vehicleIdentifier = `<VIN>${escapeXml(input.vin)}</VIN>${trimTag}`;
  } else {
    vehicleIdentifier = `<VehicleYear>${escapeXml(input.year)}</VehicleYear>
        <VehicleMake>${escapeXml(String(input.make ?? '').toUpperCase())}</VehicleMake>
        <VehicleModel>${escapeXml(String(input.model ?? '').toUpperCase())}</VehicleModel>
        <Trim>${escapeXml(String(input.trim ?? '').toUpperCase())}</Trim>
        <AssetType>${assetType}</AssetType>`;
  }

  // Wave 23 v3.0.5 Task 4: surface buyer state to SE so filed-rate plans
  // (FL VSC, TX GAP) return the right rate set. OMIT entirely when missing
  // — sending an empty <State/> is worse than no element (some SE handlers
  // treat empty as 'unknown' and short-circuit).
  // TODO(SE-doc): confirm element name with SEFI — `<State>` is a reasonable
  // default; SE eRating Integration Guide v1.31 should pin the exact field.
  const stateTag = input.state ? `<State>${escapeXml(String(input.state).toUpperCase())}</State>` : '';

  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetRates xmlns="http://www.natinc.com/SCSAutoService/">
      <objGetRatesRequest>
        <TpaCode>${escapeXml(creds?.tpa_code)}</TpaCode>
        <UserId>${escapeXml(creds?.user_id)}</UserId>
        <Password>${escapeXml(creds?.password)}</Password>
        <DealerNo>${escapeXml(creds?.dealer_no)}</DealerNo>
        <SaleDate>${today}</SaleDate>
        <NewUsed>${newUsed}</NewUsed>
        ${stateTag}
        ${vehicleIdentifier}
        <VehicleOdometer>${escapeXml(mileage)}</VehicleOdometer>
        <ProductCollection>
          <Product>
            <Code>VSC</Code>
          </Product>
        </ProductCollection>
      </objGetRatesRequest>
    </GetRates>
  </soap:Body>
</soap:Envelope>`;
}

// XML helpers — namespace-agnostic local-name walks via the wildcard NS API.
function findAll(node, tag) {
  if (!node) return [];
  if (node.getElementsByTagNameNS) {
    const list = node.getElementsByTagNameNS('*', tag);
    const out = [];
    for (let i = 0; i < list.length; i += 1) out.push(list[i]);
    return out;
  }
  const out = [];
  (function walk(n) {
    if (n.nodeType === 1 && n.localName === tag) out.push(n);
    for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
  })(node);
  return out;
}

function findFirst(node, tag) {
  const m = findAll(node, tag);
  return m[0] || null;
}

function textOf(node, tag) {
  const el = findFirst(node, tag);
  return el ? (el.textContent ?? '').trim() : '';
}

function numOf(node, tag) {
  const t = textOf(node, tag);
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseGetRatesXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const errors = [];

  // Catch XML-parse failures explicitly.
  const parserError = doc.getElementsByTagName('parsererror')[0];
  if (parserError) {
    errors.push({
      error_number: null,
      error_code: 'XML_PARSE_ERROR',
      error_description: (parserError.textContent || '').trim() || 'Failed to parse SOAP response as XML',
    });
  }

  for (const errEl of findAll(doc, 'ErrorResponse')) {
    errors.push({
      error_number:      numOf(errEl, 'ErrorNumber'),
      error_code:        textOf(errEl, 'ErrorCode'),
      error_description: textOf(errEl, 'ErrorDescription'),
    });
  }
  for (const faultEl of findAll(doc, 'Fault')) {
    errors.push({
      error_number:      null,
      error_code:        textOf(faultEl, 'faultcode') || 'soap:Fault',
      error_description: textOf(faultEl, 'faultstring'),
    });
  }
  return { doc, errors };
}

// ---------- Wave 23 v3.0.5 Task 7: structured error classification ---------

const FRIENDLY_DEFAULTS = {
  show_friendly_message: "We couldn't get coverage rates right now. Please try again in a moment, or contact your agent.",
  fallback_fixture:      'Coverage rates are temporarily unavailable. Showing example pricing — actual rates may differ.',
  block:                 'Coverage rates are unavailable for this vehicle. Please contact your agent.',
};

function detectErrorKind(rawResponseText) {
  if (rawResponseText == null || rawResponseText === '') return 'empty';
  const s = String(rawResponseText);
  // Cheap substring sniffs first — DOMParser is heavy and the common error
  // shapes are recognizable from raw text alone.
  if (/<\s*[a-zA-Z0-9:]*Fault\b/i.test(s)) return 'fault';
  if (/<\s*ErrorResponse\b/i.test(s))      return 'error_response';
  if (/<parsererror\b/i.test(s))           return 'malformed';
  // Fall through: parse + look for a populated PlanRate set. No PlanRate
  // == empty. Any structural surprise == malformed.
  try {
    const doc = new DOMParser().parseFromString(s, 'text/xml');
    if (doc.getElementsByTagName('parsererror')[0]) return 'malformed';
    const planRates = findAll(doc, 'PlanRate');
    if (planRates.length === 0) return 'empty';
    return 'unknown';
  } catch {
    return 'malformed';
  }
}

function defaultInternalActionFor(kind) {
  if (kind === 'empty') return 'log_only';
  if (kind === 'malformed' || kind === 'transport') return 'page_oncall';
  if (kind === 'fault' || kind === 'error_response') return 'retry';
  return 'log_only';
}

/**
 * Classify a raw SE GetRates response into a structured error payload that
 * protection-portal can render directly. Per ADR 15.
 *
 * @param {string} rawResponseText  body returned by the SE proxy (may be '')
 * @param {object} [orgConfig]      org block from canon/org-registry.json —
 *                                  the function reads `se_getrates.error_handling`.
 * @returns {{ kind: string, code: string, displayMessage: string,
 *             internalAction: 'retry'|'log_only'|'page_oncall', raw: string }}
 */
export function classifySeError(rawResponseText, orgConfig) {
  const raw = rawResponseText == null ? '' : String(rawResponseText);
  const kind = detectErrorKind(raw);

  // Stub when org config absent — protection-portal still gets a friendly
  // string + DevPanel raw view.
  if (!orgConfig || !orgConfig.se_getrates || !orgConfig.se_getrates.error_handling) {
    return {
      kind,
      code: 'no_org_config',
      displayMessage: FRIENDLY_DEFAULTS.show_friendly_message,
      internalAction: defaultInternalActionFor(kind),
      raw,
    };
  }

  const eh = orgConfig.se_getrates.error_handling;
  const knownErrors = Array.isArray(eh.known_errors) ? eh.known_errors : [];

  // First match wins. Treat each `pattern` as a case-insensitive RegExp
  // string. Skip silently on malformed regex — bad canon must not throw at
  // the customer.
  for (const ke of knownErrors) {
    if (!ke || !ke.pattern) continue;
    let re;
    try { re = new RegExp(ke.pattern, 'i'); }
    catch { continue; }
    if (re.test(raw)) {
      return {
        kind,
        code: ke.code || 'matched_known_error',
        displayMessage: ke.user_message || FRIENDLY_DEFAULTS.show_friendly_message,
        internalAction: ke.internal_action || defaultInternalActionFor(kind),
        raw,
      };
    }
  }

  const strategy = eh.default_strategy || 'show_friendly_message';
  const displayMessage = FRIENDLY_DEFAULTS[strategy] || FRIENDLY_DEFAULTS.show_friendly_message;
  return {
    kind,
    code: `unmatched_${kind}`,
    displayMessage,
    internalAction: defaultInternalActionFor(kind),
    raw,
  };
}

// Wave 23 v3.0.5 Task 6: resolve a plan's term_basis ('additive' | 'absolute')
// from canon. ProductTypeCode override > RegulatedRuleId default > registry
// default. Branch order matches ADR 14.
function resolveTermBasis({ product_type_code, regulated_rule_id }) {
  const ts = planMappings.term_semantics || {};
  const byPtc = ts.by_product_type_code || {};
  const byRid = ts.by_regulated_rule_id || {};
  const ptcEntry = product_type_code ? byPtc[product_type_code] : null;
  if (ptcEntry && ptcEntry.basis) return ptcEntry.basis;
  const ridEntry = regulated_rule_id != null ? byRid[String(regulated_rule_id)] : null;
  if (ridEntry && ridEntry.basis) return ridEntry.basis;
  return ts._default_basis || 'additive';
}

function emptyNormalized(input) {
  return {
    status: 'error',
    request: {
      year:      input.year      ?? null,
      make:      input.make      ?? null,
      model:     input.model     ?? null,
      trim:      input.trim      ?? null,
      mileage:   input.mileage   ?? null,
      condition: input.condition ?? null,
      state:     input.state     ?? null,
      vin:       input.vin       ?? null,
    },
    filters: {
      deductibles: [],
      coverage_periods_months: [],
      default_coverage_periods_months: [],
      mileages: [],
      default_mileages: [],
    },
    add_ons: [],
    products: [],
  };
}

// Monthly-membership detection (ADR 28). The 999999 mileage sentinel is the
// AUTHORITATIVE signal that a product is a recurring monthly-subscription VSC
// (M2M / Residual / RAP). Sourced from canon so a future sentinel change is a
// config edit; defaults to 999999 if canon omits it.
const MONTHLY_SENTINEL_MILEAGE =
  (planMappings.monthly_membership && Number(planMappings.monthly_membership.sentinel_mileage)) || 999999;

// Secondary signals are TELEMETRY/SANITY ONLY — they never gate detection (the
// sentinel does). Records whether the plan code is in the canon allowlist and
// whether the description carries the residual substring.
function computeMonthlySignals(planCode, planDescription) {
  const sig = (planMappings.monthly_membership && planMappings.monthly_membership.secondary_signals) || {};
  const allow = Array.isArray(sig.plan_code_allowlist) ? sig.plan_code_allowlist.map(String) : [];
  const residualSub = String(sig.residual_description_substring || '').toLowerCase();
  return {
    sentinel_999999: true,
    plan_code_allowlisted: planCode != null && allow.includes(String(planCode)),
    residual_in_description: residualSub
      ? String(planDescription || '').toLowerCase().includes(residualSub)
      : false,
  };
}

// Materialize ONE monthly-subscription product from a group of 999999 rows
// (one per term). Prices the per-month charge via the org's monthly_membership
// config (which TermMile.Term to read + flat markup). See ADR 28.
function buildMonthlyProduct(group, ctx) {
  const { orgId, state, tpaCodeUsed } = ctx;
  const monthlyTerms = (group.rows || [])
    .map((r) => ({
      term: r.term,
      cost: r.cost,
      rate: r.retail,
      regulated_rule_id: r.regulated_rule_id,
      bounds: r.bounds,
    }))
    .filter((r) => Number.isFinite(Number(r.term)))
    .sort((a, b) => Number(a.term) - Number(b.term));

  const priced = resolveMonthlyMembershipPricing({
    orgId,
    planCode: group.plan_code,
    monthlyTerms,
    state,
  });
  const termUsed = priced.term_used;
  const atUsedTerm = monthlyTerms.find((t) => Number(t.term) === termUsed) || null;
  const signals = computeMonthlySignals(group.plan_code, group.plan_description);

  // Sentinel fired but neither secondary signal agrees — surface for review.
  if (!signals.plan_code_allowlisted && !signals.residual_in_description) {
    track('protection.stoneeagle.normalizer.monthly_signal_mismatch', {
      plan_code: group.plan_code || null,
      plan_description: group.plan_description || null,
    });
  }

  const idSafe = `${String(group.name).replace(/[^A-Z0-9]+/gi, '_').toUpperCase()}_MONTHLY_${group.deduct_amt ?? 0}`;

  return {
    id: idSafe,
    name: group.name,
    provider: group.product_type_code || group.name,
    // Discriminator consumed by plan-selector.js + Confirm.jsx. Term plans
    // carry billing_model:'term_total'.
    billing_model: 'monthly_subscription',
    deductible: group.deduct_amt ?? 0,
    // Never 999999 — reflects the configured term basis so sliders/labels are sane.
    coverage_period_months: termUsed ?? (monthlyTerms[0]?.term ?? 0),
    mileage: null,
    unlimited_mileage: true,
    // base_price/monthly_price mirror monthly_charge so existing fixture-shape
    // consumers don't render NaN; monthly_charge is the explicit field Confirm reads.
    base_price: priced.monthly_charge,
    monthly_price: priced.monthly_charge,
    monthly_charge: priced.monthly_charge,
    monthly_terms: monthlyTerms,
    cost: priced.cost_at_term,
    markup_applied: priced.markup_applied,
    markup_regulation: priced.markup_regulation,
    retail_rate_response: atUsedTerm ? (atUsedTerm.rate ?? null) : null,
    add_ons_included: group.included_names || [],
    plan_code: group.plan_code || null,
    plan_description: group.plan_description || null,
    plan_id: group.plan_id || null,
    product_type_code: group.product_type_code || null,
    tpa_code: tpaCodeUsed,
    regulated_rule_id: atUsedTerm ? (atUsedTerm.regulated_rule_id ?? null) : null,
    term_basis: group.term_basis,
    discountable: group.discountable,
    monthly_signals: signals,
    monthly_pricing: {
      term_requested: priced.term_requested,
      term_used: priced.term_used,
      used_term_fallback: priced.used_term_fallback,
      enabled: priced.enabled,
    },
  };
}

// Normalize the parsed SCS response into protection-portal's existing
// fixture shape (strategy (a) per W21-fu plan — minimal blast radius;
// preserves existing form.rates.products consumers).
//
// Wave 22-fu: also layers org-level markup on top of the SCS `<Cost>` to
// derive `base_price` (the customer-facing total). The OMGA UAT tenant
// returns `MarkupMin`/`MarkupMax`/`AdminMarkup`/`BaseMarkup`/`FIMarkup` all
// 0, so the response's `RetailRate` equals dealer cost — Blinker layers
// markup at the platform level, sourced from
// canon/org-registry.json::orgs[].protection_billing.markup. See
// packages/utils/protection-pricing.js for the regulation matrix.
//
// BACKLOG (per 2026-05-09 user direction): per-org toggle to use the SE
// response's MarkupMin/MarkupMax/AdminMarkup/BaseMarkup/FIMarkup fields
// directly instead of org-config markup. Today these are ignored; only
// org_registry.protection_billing.markup is honored.
function normalizeToFixtureShape(doc, input, ctx) {
  const planRates = findAll(doc, 'PlanRate');
  const orgId = ctx?.orgId ?? null;
  const state = input?.state ?? null;
  // Wave 27 v3.0.8 — TpaCode used for this proxy call; tagged onto each
  // product for the plan-presentation resolver. Null in fixture-mode (the
  // per-product `tpa_code` field on the fixture JSON is the source there).
  const tpaCodeUsed = ctx?.tpa_code ?? null;

  const products = [];
  const addOnsMap = new Map();
  const deductibleSet = new Set();
  const termSet = new Set();
  const mileageSet = new Set();
  // ADR 28 — 999999-sentinel rows accumulate here (keyed plan_code::deductible),
  // grouped back into one monthly-subscription product per group after the loop.
  const monthlyRowsByGroup = new Map();

  for (const pr of planRates) {
    const planEl     = findFirst(pr, 'Plan');
    const planCode   = planEl ? textOf(planEl, 'PlanCode') : '';
    const planDesc   = planEl ? textOf(planEl, 'PlanDescription') : '';
    const contractPlan    = planEl ? textOf(planEl, 'ContractPlanName') : '';
    const productTypeCode = planEl ? textOf(planEl, 'ProductTypeCode') : '';
    const programDesc     = planEl ? textOf(planEl, 'ProgramDescription') : '';
    const planId          = planEl ? textOf(planEl, 'PlanId') : '';
    const tpaName = contractPlan || planDesc || programDesc || planCode || 'Plan';

    for (const rcm of findAll(pr, 'RateClassMoney')) {
      const tm        = findFirst(rcm, 'TermMile');
      const term      = tm  ? numOf(tm, 'Term')        : null;
      const mileage   = tm  ? numOf(tm, 'Mileage')     : null;
      const ded       = findFirst(rcm, 'Deductible');
      const deductAmt = ded ? numOf(ded, 'DeductAmt')  : null;
      const rate      = findFirst(rcm, 'Rate');
      const retail    = rate ? numOf(rate, 'RetailRate') : null;
      // Wave 22-fu: SCS `<Cost>` lives inside `<RateDetails>` (sibling of
      // `<RetailRate>`). `findAll` is a namespace-agnostic descendant walk,
      // so reading from `rate` reaches it. Fall back to `<NetRate>` (rare
      // in practice — kept defensive) and finally to `RetailRate` so we
      // never compute from null.
      const costRaw   = rate ? (numOf(rate, 'Cost') ?? numOf(rate, 'NetRate')) : null;
      const cost      = costRaw != null ? costRaw : (retail != null ? retail : 0);
      const ruleId    = rate ? numOf(rate, 'RegulatedRuleId') : null;
      const markupMin = rate ? numOf(rate, 'MarkupMin')      : null;
      const markupMax = rate ? numOf(rate, 'MarkupMax')      : null;
      const maxRetail = rate ? numOf(rate, 'MaxRetailRate')  : null;

      // v3.0.4 Task 2 (W22 fix): walk this rate-class's options FIRST — before
      // the term-vs-monthly branch — so the global add_ons[] catalog + the
      // per-product add_ons_included[] are populated for monthly rows too.
      // (a) push complimentary option NAMES (RetailRate=0) into the parent
      // product's add_ons_included[] so canon `add_on_passthrough` matchers
      // (e.g. extended_maintenance) fire on real OMGA data. (b) Aggregate ALL
      // options into the global add_ons[] catalog (selectable surcharges +
      // complimentary alike) so cost lookups for user-triggered passthroughs
      // (BUSINESS USE / EEP / NAV) still work.
      const includedNames = [];
      for (const opt of findAll(rcm, 'Option')) {
        const optId    = textOf(opt, 'OptionId');
        const optDesc  = textOf(opt, 'OptionDesc');
        const optPrice = numOf(opt, 'RetailRate') ?? 0;
        const optName  = optDesc || optId;
        if (optName && optPrice === 0) includedNames.push(optName);
        if (optId && !addOnsMap.has(optId)) {
          addOnsMap.set(optId, {
            id: optId,
            name: optName,
            price_delta: optPrice,
            default_selected: false,
            is_surcharge: textOf(opt, 'IsSurcharge') === 'true',
          });
        }
      }

      const termBasis = resolveTermBasis({
        product_type_code: productTypeCode || null,
        regulated_rule_id: ruleId,
      });

      // ─── Monthly-membership branch (ADR 28) ────────────────────────────────
      // The 999999 mileage sentinel is AUTHORITATIVE: OMEGA returns monthly
      // products across many month-by-month terms, every row at this mileage.
      // Group those rows under one product (keyed plan_code::deductible) so the
      // org config can pick which TermMile.Term to price the monthly charge
      // from. These rows do NOT enter the term/mileage/deductible slider sets,
      // so the sentinel never leaks into the wizard's range pickers.
      if (mileage === MONTHLY_SENTINEL_MILEAGE) {
        const groupKey = `${planCode || planId || tpaName}::${deductAmt ?? 0}`;
        let group = monthlyRowsByGroup.get(groupKey);
        if (!group) {
          group = {
            name: tpaName,
            plan_code: planCode || null,
            plan_description: planDesc || null,
            plan_id: planId || null,
            product_type_code: productTypeCode || null,
            deduct_amt: deductAmt ?? 0,
            term_basis: termBasis,
            discountable: planEl ? numOf(planEl, 'Discountable') : null,
            included_names: includedNames,
            rows: [],
          };
          monthlyRowsByGroup.set(groupKey, group);
        }
        if ((!group.included_names || group.included_names.length === 0) && includedNames.length) {
          group.included_names = includedNames;
        }
        group.rows.push({
          term,
          cost,
          retail,
          regulated_rule_id: ruleId,
          bounds: { markup_min: markupMin, markup_max: markupMax, max_retail_rate: maxRetail },
        });
        continue;
      }

      // ─── Term-total branch (existing behavior) ─────────────────────────────
      if (term      != null) termSet.add(term);
      if (mileage   != null) mileageSet.add(mileage);
      if (deductAmt != null) deductibleSet.add(deductAmt);

      const priced = computePlanPrice(
        {
          cost,
          retail_rate: retail,
          regulated_rule_id: ruleId,
          bounds: { markup_min: markupMin, markup_max: markupMax, max_retail_rate: maxRetail },
        },
        { orgId, state },
      );
      const basePrice = roundDollars(priced.price);
      // Placeholder monthly — the legacy formula uses per-org billing config
      // (paymentOptions.tsx). Until the wizard rewrites monthly downstream
      // from base_price, we surface a stable 12-mo division so the existing
      // fixture-shape consumers don't render NaN.
      const monthly = basePrice > 0 ? Math.round((basePrice / 12) * 100) / 100 : 0;

      const idSafe = `${tpaName.replace(/[^A-Z0-9]+/gi, '_').toUpperCase()}_${term ?? 0}_${mileage ?? 0}_${deductAmt ?? 0}`;
      products.push({
        id: idSafe,
        name: tpaName,
        provider: productTypeCode || tpaName,
        // ADR 28 — discriminator; monthly products carry 'monthly_subscription'.
        billing_model: 'term_total',
        deductible: deductAmt ?? 0,
        coverage_period_months: term ?? 0,
        mileage: mileage ?? 0,
        base_price: basePrice,
        monthly_price: monthly,
        // Wave 22-fu: surface the breakdown for ApiResponsesModal +
        // downstream tooling. `base_price` IS the customer-facing total
        // (cost + markup); these fields trace how we got there.
        cost,
        markup_applied: priced.markup_applied,
        markup_regulation: priced.regulation,
        retail_rate_response: retail,
        add_ons_included: includedNames,
        plan_code:        planCode || null,
        plan_description: planDesc || null,
        plan_id:          planId   || null,
        product_type_code: productTypeCode || null,
        // Wave 27 v3.0.8 — Tagged onto each product so PlanCard can pass
        // `plan.raw?.tpa_code` directly into resolvePlanPresentation().
        // Lifted from the SE creds used for the call (test creds in
        // proxy/UAT mode → 'OMGA' for Apex; live creds → 'APEX').
        tpa_code:         tpaCodeUsed,
        regulated_rule_id: ruleId,
        // Wave 23 Task 6: surfaces 'additive' (display: '+24 mo') vs 'absolute'
        // (display: 'Up to 36 mo') so PlanCard / CoverageDetails branch UX
        // and filter math without re-reading canon at each call site.
        term_basis: termBasis,
        discountable:      planEl  ? numOf(planEl, 'Discountable')    : null,
      });
    }
  }

  // ADR 28 — materialize one monthly-subscription product per group of
  // 999999-sentinel rows and append to `products`. Replaces the Wave-24 drop
  // (these used to be silently filtered out). Each product carries
  // billing_model:'monthly_subscription' + a monthly_terms[] array so the
  // selector can fork and Confirm can charge a recurring monthly amount with
  // no down-payment/months-to-pay. See project_monthly_pay_vsc_products.md.
  const monthlyProducts = [];
  for (const group of monthlyRowsByGroup.values()) {
    monthlyProducts.push(buildMonthlyProduct(group, { orgId, state, tpaCodeUsed }));
  }
  if (monthlyProducts.length > 0) {
    track('protection.stoneeagle.normalizer.monthly_membership_surfaced', {
      count: monthlyProducts.length,
      plan_codes: monthlyProducts.map((p) => p.plan_code).filter(Boolean),
    });
    products.push(...monthlyProducts);
  }

  const deductibles     = [...deductibleSet].sort((a, b) => a - b);
  const coveragePeriods = [...termSet].sort((a, b) => a - b);
  // v3.0.4 Task 5: exclude 999999 from the mileages list. That mileage code
  // signals monthly-membership product types (M2M / RAP), which need a
  // separate "Unlimited" UX (per project_monthly_pay_vsc_products.md backlog).
  // Until that lands, surfacing 999999 in the term/mile slider would let the
  // user pick a plan family the wizard can't price.
  const mileages        = [...mileageSet].filter((m) => m !== 999999).sort((a, b) => a - b);

  return {
    status: products.length > 0 ? 'ok' : 'error',
    request: {
      year:      input.year      ?? null,
      make:      input.make      ?? null,
      model:     input.model     ?? null,
      trim:      input.trim      ?? null,
      mileage:   input.mileage   ?? null,
      condition: input.condition ?? null,
      state:     input.state     ?? null,
      vin:       input.vin       ?? null,
    },
    filters: {
      deductibles,
      coverage_periods_months: coveragePeriods,
      // v3.0.4 Task 5 / Wave 22: defaults are sourced from canon org config
      // (`protection_billing.coverage_term_defaults` + `coverage_miles_defaults`)
      // by the consuming wizard (Customize.jsx) — NOT from the response. We
      // surface empty arrays here so a stale consumer that reads `default_*`
      // gets nothing rather than a misleading slice.
      default_coverage_periods_months: [],
      mileages,
      default_mileages: [],
    },
    add_ons: [...addOnsMap.values()],
    products,
  };
}

// Dev/UAT-mode override: 'proxy' is dev-only and ALWAYS targets the org's
// test credential block, regardless of `org.test_mode`. The facade resolves
// credentials based on `org.test_mode` (correct for Phase-2 production), but
// in this dev-UAT mode we must hit UAT even when the org is flagged
// production. The package re-imports canon to do its own pick — same dep
// direction the facade uses.
function resolveTestCredentialsForOrg(orgId) {
  if (orgId == null) return null;
  const org = (orgRegistry.orgs || []).find((o) => String(o.id) === String(orgId));
  return org?.integrations?.stoneeagle?.credentials?.test || null;
}

function resolveOrgConfig(orgId) {
  if (orgId == null) return null;
  return (orgRegistry.orgs || []).find((o) => String(o.id) === String(orgId)) || null;
}

async function getRatesProxy(input, ctx) {
  const testCreds = resolveTestCredentialsForOrg(ctx?.orgId);
  const creds = testCreds || ctx?.credentials || {};
  const requestBody = buildSoapEnvelope(input, creds);
  const orgConfig = resolveOrgConfig(ctx?.orgId);

  const realPromise = (async () => {
    let responseXml = '';
    let networkError = null;
    try {
      const res = await fetch(PROXIED_PATH, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction':   SOAP_ACTION_GET_RATES,
        },
        body: requestBody,
        signal: ctx?.signal,
      });
      responseXml = await res.text();
      if (!res.ok && !responseXml) {
        networkError = `HTTP ${res.status} ${res.statusText}`;
      }
    } catch (e) {
      networkError = (e && e.message) || String(e);
    }

    if (networkError) {
      const empty = emptyNormalized(input);
      const transportClassified = {
        kind: 'transport',
        code: 'NETWORK_ERROR',
        displayMessage: orgConfig
          ? (FRIENDLY_DEFAULTS[orgConfig?.se_getrates?.error_handling?.default_strategy] || FRIENDLY_DEFAULTS.show_friendly_message)
          : FRIENDLY_DEFAULTS.show_friendly_message,
        internalAction: 'page_oncall',
        raw: networkError,
      };
      return {
        responseXml,
        normalized: empty,
        errors: [{ error_number: null, error_code: 'NETWORK_ERROR', error_description: networkError }],
        classified: transportClassified,
      };
    }
    const parsed = parseGetRatesXml(responseXml);
    // Wave 27 v3.0.8 — plumb the TpaCode used for this call into the
    // normalizer so each product carries `tpa_code`. Lets the
    // `resolvePlanPresentation()` resolver build the catalog key
    // `${tpa}::${ptc}::${plan_code}` without re-resolving per-org creds.
    const normalized = normalizeToFixtureShape(parsed.doc, input, { ...ctx, tpa_code: creds?.tpa_code ?? null });
    let classified = null;
    if (parsed.errors.length > 0) {
      normalized.status = 'error';
      classified = classifySeError(responseXml, orgConfig);
    } else if (normalized.products.length === 0) {
      // Empty PlanRate set — surface as classified 'empty' so the wizard
      // can render a friendly message instead of a silent void.
      classified = classifySeError(responseXml, orgConfig);
    }
    return { responseXml, normalized, errors: parsed.errors, classified };
  })();

  // Run the fixture in parallel so the modal can render fixture vs. real
  // side-by-side without lengthening the user's wait.
  const fixturePromise = Promise.resolve().then(() => computeFixture(input)).catch(() => null);

  const [real, fixtureComparison] = await Promise.all([realPromise, fixturePromise]);

  return {
    ...real.normalized,
    errors: real.errors,
    _provider: 'stoneeagle',
    _provider_mode: 'proxy',
    _raw_request: requestBody,
    _raw_response_xml: real.responseXml,
    _fixture_comparison: fixtureComparison,
    // Wave 22-fu: snapshot the org markup config that was layered onto each
    // product's `cost` to derive `base_price`. Helpful for ApiResponsesModal
    // + DevPanel transparency. Null if the orgId isn't in canon.
    _org_markup: getOrgMarkupSnapshot(ctx?.orgId ?? null),
    // Wave 23 Task 7: structured error classification for protection-portal
    // friendly callouts + DevPanel 5th panel. Null on the happy path.
    _error_classified: real.classified,
  };
}

// ---------- Wave 23 v3.0.5 Task 5: New/Used parallel orchestration ---------

// Single-call entry kept for back-compat with fixture-mode callers + the
// orchestrator below. Mirrors the original public-surface shape.
async function getRatesSingle(input, ctx) {
  const mode = resolveProviderMode();
  if (mode === 'fixture') return getRatesFixture(input);
  if (mode === 'proxy')   return getRatesProxy(input, ctx);
  throw new Error(`Unknown StoneEagle provider mode: ${mode}`);
}

// Tag every product in a normalized response with rate_class — protection-portal
// reads `plan.rate_class` to render a 'New' badge + filter chips and to
// prefer new-rate candidates over used in each Good/Better/Best tier.
function tagRateClass(response, rateClass) {
  if (!response || !Array.isArray(response.products)) return response;
  response.products = response.products.map((p) => ({ ...p, rate_class: rateClass }));
  return response;
}

// Concatenate two normalized responses (new+used) into one. The 'new' branch
// is structurally a superset, so we keep its top-level metadata and merge
// products + filter buckets.
function mergeNewUsed(newResp, usedResp) {
  if (!newResp) return usedResp;
  if (!usedResp) return newResp;
  const merged = { ...newResp };
  // Term plans legitimately appear in both branches (different rate_class); keep
  // both. Monthly-subscription products are rate-class-agnostic (unlimited
  // mileage, no new/used split — ADR 28), so dedupe them by id to avoid showing
  // each monthly plan twice for a 'new' vehicle.
  const seenMonthly = new Set();
  merged.products = [...(newResp.products || []), ...(usedResp.products || [])].filter((p) => {
    if (p.billing_model !== 'monthly_subscription') return true;
    if (seenMonthly.has(p.id)) return false;
    seenMonthly.add(p.id);
    return true;
  });
  merged.add_ons = (() => {
    const map = new Map();
    for (const a of (newResp.add_ons || [])) map.set(a.id, a);
    for (const a of (usedResp.add_ons || [])) if (!map.has(a.id)) map.set(a.id, a);
    return [...map.values()];
  })();
  // Filter buckets: union the discrete option sets. Sort numerically for the
  // wizard's slider snap-points.
  const uniqSorted = (a = [], b = []) => [...new Set([...a, ...b])].sort((x, y) => x - y);
  merged.filters = {
    deductibles:                     uniqSorted(newResp.filters?.deductibles,             usedResp.filters?.deductibles),
    coverage_periods_months:         uniqSorted(newResp.filters?.coverage_periods_months, usedResp.filters?.coverage_periods_months),
    default_coverage_periods_months: newResp.filters?.default_coverage_periods_months || [],
    mileages:                        uniqSorted(newResp.filters?.mileages,                usedResp.filters?.mileages),
    default_mileages:                newResp.filters?.default_mileages || [],
  };
  // Status: ok if either branch produced products.
  merged.status = merged.products.length > 0 ? 'ok' : (newResp.status || usedResp.status || 'error');
  // Preserve the new-branch raw request/response for DevPanel; tuck the
  // used-branch under a sibling key so the UAT modal can show both.
  merged._used_branch_raw_request    = usedResp._raw_request    || null;
  merged._used_branch_raw_response   = usedResp._raw_response_xml || null;
  merged._used_branch_classified     = usedResp._error_classified || null;
  return merged;
}

/**
 * High-level orchestration: classify the vehicle (canon vehicle_class_rule);
 * for 'new', fan out TWO parallel SE calls (condition='N' + condition='U')
 * and merge with rate_class tagging; for 'used', a single 'U' call.
 *
 * The merged response shape is a SUPERSET of the single-call shape — every
 * existing consumer keeps working; new consumers branch on `plan.rate_class`.
 */
export async function getRatesWithVehicleClass(input, ctx) {
  const cls = classifyVehicle(
    { year: input?.year, mileage: input?.mileage },
    planMappings.vehicle_class_rule,
  );

  if (cls === 'used') {
    const resp = await getRatesSingle({ ...input, condition: 'U' }, ctx);
    return tagRateClass(resp, 'used');
  }

  // 'new' — fire both, merge.
  const [newResp, usedResp] = await Promise.all([
    getRatesSingle({ ...input, condition: 'N' }, ctx).then((r) => tagRateClass(r, 'new')),
    getRatesSingle({ ...input, condition: 'U' }, ctx).then((r) => tagRateClass(r, 'used')),
  ]);
  return mergeNewUsed(newResp, usedResp);
}

// ---------- Public surface -------------------------------------------------

export default {
  id: 'stoneeagle',
  supportsTestMode: true,
  // Wave 23 Task 5: the public entry point now goes through the
  // vehicle-class orchestrator. Fixture-mode callers still hit the same
  // single-call path internally — the only behavior change for fixture mode
  // is that returned products carry a `rate_class` tag.
  async getRates(input, ctx) {
    return getRatesWithVehicleClass(input, ctx);
  },
};

// Exposed for diagnostics only — DO NOT depend on this from app code.
// (The mode is resolved per call; this is a snapshot for DevPanel display.)
export { resolveProviderMode as __resolveProviderMode };
