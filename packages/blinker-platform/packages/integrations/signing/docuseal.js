// DocuSeal signing client — ADR 30 D8.
//
// The platform's FIRST real signing integration. Built here, in packages/,
// rather than inside a portal, because both the auto and home protection
// workflows need it: protection-portal's DocuSeal.jsx has been a placeholder
// since Phase 1 (a static box and a button that sets local state), and
// resolvePlanPresentation() has returned a docusealTemplateId since ADR 18
// that nothing has ever read.
//
// ---------------------------------------------------------------------------
// Home agreement field contract (ADR 30 §8.4)
//
// All SIX home templates — 182/184/185/186/187/188 — share an IDENTICAL field
// set, verified against the live templates 2026-08-25. So there is one mapping
// and the template id is selected purely by plan code:
//
//   35 → 182   36 → 184   37 → 185   38 → 186   48 → 187   49 → 188
//
// `Deluxe` is ALWAYS checked: every home plan includes the Deluxe base
// coverage, and the tier is expressed by which template is used, not by the
// checkbox.
//
// ADR 30 R5 — this mapping is written against the CORRECTED template field
// names. Four template changes are assumed:
//   1. DwellingSf*/DwellingTownhome*/DwellingCondo* checkboxes (printed on the
//      form today, not mapped fields).
//   2. SquareFeet (printed, not mapped).
//   3. SecondFirstName / SecondLastName / SecondPhone (the entity supports two
//      agreement holders; the field set has one).
//   4. PropertyAddress1 / PropertyCity / PropertyState / PropertyZip. This is a
//      DEFECT, not a gap: the live templates carry Address1/City/State/Zip
//      TWICE under identical names, once for the holder's mailing address and
//      once for the covered property. Same-named DocuSeal fields share a value,
//      so unfixed, both addresses receive the same string.
// Verify the live field names before treating a submission as correct.
// ---------------------------------------------------------------------------

import { resolvePlanPresentation } from '../../utils/plan-presentation.js';
import { classifyDwelling } from '../../utils/dwelling-class.js';
import { sumAddOnPrices } from '../../utils/home-addons.js';
import { track } from '../../telemetry/index.js';

const DEFAULT_PROVIDER_MODE = 'fixture';

/**
 * Fixture vs live, resolved per call — mirrors
 * stoneeagle.js#resolveProviderMode. Production builds NEVER reach the network
 * path; only a dev session that has explicitly opted in does.
 */
export function resolveSigningMode() {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV === false) {
      return 'fixture';
    }
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem('blinker.dev.signing_mode');
      if (v === 'live' || v === 'fixture') return v;
    }
  } catch {
    // localStorage can throw in sandboxed contexts; fall through to the default.
  }
  return DEFAULT_PROVIDER_MODE;
}

/**
 * Resolve the DocuSeal template for a plan.
 *
 * Delegates entirely to resolvePlanPresentation — the org-override → catalog →
 * org-default precedence already lives there (ADR 18) and must not be
 * reimplemented.
 *
 * @param {object} args
 * @param {number|string} args.orgId
 * @param {string} args.tpaCode
 * @param {string} args.productTypeCode
 * @param {string} args.planCode
 * @param {string} [args.planName]
 * @returns {string|null} template id, or null when no template is configured
 */
export function resolveTemplateId({ orgId, tpaCode, productTypeCode, planCode, planName }) {
  const presentation = resolvePlanPresentation({
    orgId, tpaCode, productTypeCode, planCode, planName,
  });
  return presentation?.docusealTemplateId ?? null;
}

// ---------- date helpers -----------------------------------------------------

function toIsoDate(value) {
  if (!value) return null;
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * Advance an ISO date by N calendar months, in UTC.
 *
 * UTC deliberately: a local-time Date would shift the agreement's expiration
 * across a day boundary for anyone west of GMT, and this date is printed on a
 * signed contract.
 *
 * Day-overflow clamps to the last day of the target month (Jan 31 + 1 month =
 * Feb 28/29) rather than rolling into the following month.
 */
export function addMonthsIso(isoDate, months) {
  const base = toIsoDate(isoDate);
  // Number(null) and Number('') are both 0, which would silently produce an
  // expiration date equal to the effective date on a signed agreement. Reject
  // a missing term outright.
  if (months == null || months === '') return null;
  const n = Number(months);
  if (!base || !Number.isFinite(n)) return null;

  const [y, m, d] = base.split('-').map(Number);
  const targetMonthIndex = (m - 1) + n;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);

  const dt = new Date(Date.UTC(targetYear, targetMonth, day));
  return dt.toISOString().slice(0, 10);
}

// ---------- field mapping ----------------------------------------------------

function str(v) {
  return v == null ? '' : String(v);
}

/**
 * Build the DocuSeal submission field map for a home protection agreement.
 *
 * Every checkbox is emitted EXPLICITLY as a boolean — the twelve add-ons and
 * the five dwelling buckets — never omitted. An omitted checkbox is
 * indistinguishable from an unchecked one at the API boundary, and "we sent
 * nothing" is not a defensible answer about a signed agreement.
 *
 * @param {object} args
 * @param {object} args.form   the home-protection wizard form
 * @param {object} args.org    the org record (seller block)
 * @param {object} args.canon  { homeAddOns, homeDwellingClasses } from plan-mappings.json
 * @returns {Record<string, string|boolean>}
 * @throws when the home is ineligible (no dwelling bucket matches)
 */
export function buildHomeSubmissionFields({ form, org, canon }) {
  if (!canon?.homeAddOns || !canon?.homeDwellingClasses) {
    throw new Error('buildHomeSubmissionFields: canon.homeAddOns and canon.homeDwellingClasses are required');
  }

  const dwelling = classifyDwelling(form?.home, canon.homeDwellingClasses);
  if (!dwelling) {
    // ADR 30 R2 — refuse rather than papering an agreement with no dwelling
    // box ticked. The wizard blocks this at home_add; reaching here means a
    // home was edited after quoting.
    throw new Error(
      'buildHomeSubmissionFields: home is ineligible — no dwelling bucket matches '
      + `(home_type=${form?.home?.home_type}, square_feet=${form?.home?.square_feet}). See ADR 30 R2.`,
    );
  }

  const plan       = form?.selectedPlan ?? {};
  const contact    = form?.contact ?? {};
  const home       = form?.home ?? {};
  const property   = home.address ?? {};
  const second     = form?.secondaryContact ?? null;
  const selected   = Array.isArray(form?.selectedAddOns) ? form.selectedAddOns : [];

  const termMonths     = Number(plan.coverage_period_months) || null;
  const purchaseDate   = toIsoDate(form?.saleDate) ?? toIsoDate(new Date().toISOString());
  const effectiveDate  = toIsoDate(form?.productEffectiveDate) ?? purchaseDate;
  const expirationDate = termMonths ? addMonthsIso(effectiveDate, termMonths) : null;

  // ProductPrice must be what the customer is actually CHARGED, not list
  // retail. paymentSchedule is the single source for the charge (ADR 30 D7)
  // and is the only place discounts land, so prefer it. The plan+add-ons sum
  // is the fallback for a submission built before Confirm has run.
  //
  // Getting this wrong puts one number on the signed agreement and a different
  // one on the card — surfaced 2026-08-26 when agent-side discounting landed.
  const schedule = form?.paymentSchedule || null;
  const scheduledTotal = Number(schedule?.total_cost);
  const productPrice = Number.isFinite(scheduledTotal) && scheduledTotal > 0
    ? scheduledTotal
    : Number(plan.total_cost ?? plan.base_price ?? 0) + sumAddOnPrices(selected);

  const fields = {
    // ---- agreement ----
    ProductAgreementNumber: str(form?.agreement_number),   // ADR 30 R4 — eContracting is unbuilt
    ProductTermMonths:      termMonths == null ? '' : String(termMonths),
    ProductPurchaseDate:    str(purchaseDate),
    ProductEffectiveDate:   str(effectiveDate),
    ProductExpirationDate:  str(expirationDate),
    ProductPrice:           productPrice.toFixed(2),

    // ---- agreement holder ----
    FirstName: str(contact.first_name),
    LastName:  str(contact.last_name),
    Phone:     str(contact.phone),
    Address1:  str(contact.address1),
    City:      str(contact.city),
    State:     str(contact.state),
    Zip:       str(contact.zip),

    // ---- second agreement holder (ADR 30 R5 item 3) ----
    SecondFirstName: str(second?.first_name),
    SecondLastName:  str(second?.last_name),
    SecondPhone:     str(second?.phone),

    // ---- covered property (ADR 30 R5 item 4 — distinct names, NOT Address1) ----
    PropertyAddress1: str(property.address1),
    PropertyCity:     str(property.city),
    PropertyState:    str(property.state),
    PropertyZip:      str(property.zip),
    SquareFeet:       str(home.square_feet),

    // ---- coverage ----
    Deluxe: true,

    // ---- seller ----
    SellerNameLegal: str(org?.legal_name ?? org?.name),
    SellerAddress1:  str(org?.address?.address1),
    SellerCity:      str(org?.address?.city),
    SellerState:     str(org?.address?.state),
    SellerZip:       str(org?.address?.zip),
    SellerPhone:     str(org?.phone),
    SellerCode:      str(org?.seller_code),
  };

  // Twelve add-on checkboxes, every one emitted.
  const selectedKeys = new Set(selected.map((a) => a?.key).filter(Boolean));
  for (const cat of canon.homeAddOns.categories) {
    fields[cat.docuseal_field] = selectedKeys.has(cat.key);
  }

  // Five dwelling checkboxes, exactly one true.
  for (const bucket of canon.homeDwellingClasses.buckets) {
    fields[bucket.docuseal_field] = bucket.docuseal_field === dwelling.docuseal_field;
  }

  // Signature fields are NOT emitted — DocuSeal fills them from submitter roles.

  return fields;
}

// ---------- submission -------------------------------------------------------

/**
 * Create a DocuSeal submission.
 *
 * @param {object} args
 * @param {string} args.templateId
 * @param {Record<string, string|boolean>} args.fields
 * @param {Array<{ email, name, role }>} args.submitters
 * @param {object} ctx  { credentials: { api_url, api_token }, signal }
 * @returns {Promise<{ status, submission_id, submitters, mode }>}
 */
export async function createSubmission({ templateId, fields, submitters }, ctx = {}) {
  if (!templateId) {
    return { status: 'error', reason: 'no_template_id', submission_id: null, submitters: [], mode: null };
  }

  const mode = resolveSigningMode();

  if (mode === 'fixture') {
    track('signing.docuseal.fixture.submission_created', {
      template_id: templateId,
      field_count: Object.keys(fields || {}).length,
    });
    return {
      status: 'ok',
      mode: 'fixture',
      submission_id: `sub_fixture_${templateId}`,
      submitters: (submitters || []).map((s, i) => ({
        ...s,
        id: `sbm_fixture_${templateId}_${i}`,
        // The wizard mounts this in an iframe. In fixture mode it is inert on
        // purpose: the dev panel renders the resolved fields instead, so the
        // mapping is inspectable without a live DocuSeal call.
        embed_src: null,
      })),
      fields,
    };
  }

  const apiUrl = ctx?.credentials?.api_url;
  const apiToken = ctx?.credentials?.api_token;
  if (!apiUrl || !apiToken) {
    return { status: 'error', reason: 'missing_credentials', submission_id: null, submitters: [], mode };
  }

  const res = await fetch(`${String(apiUrl).replace(/\/+$/, '')}/api/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': apiToken },
    body: JSON.stringify({
      template_id: templateId,
      send_email: false,
      submitters: (submitters || []).map((s) => ({ ...s, fields: toDocusealFieldArray(fields) })),
    }),
    signal: ctx?.signal,
  });

  if (!res.ok) {
    track('signing.docuseal.submission_failed', { template_id: templateId, status: res.status });
    return { status: 'error', reason: `http_${res.status}`, submission_id: null, submitters: [], mode };
  }

  const body = await res.json();
  const first = Array.isArray(body) ? body[0] : body;
  track('signing.docuseal.submission_created', { template_id: templateId });
  return {
    status: 'ok',
    mode,
    submission_id: first?.submission_id ?? first?.id ?? null,
    submitters: Array.isArray(body) ? body : [body],
  };
}

/** DocuSeal wants `[{ name, default_value }]`, not a plain object. */
function toDocusealFieldArray(fields) {
  return Object.entries(fields || {}).map(([name, value]) => ({ name, default_value: value }));
}

export default { resolveTemplateId, buildHomeSubmissionFields, createSubmission, resolveSigningMode };
