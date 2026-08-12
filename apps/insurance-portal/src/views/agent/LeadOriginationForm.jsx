// Agent lead-origination form. Wave 16 F8 refactor: shape now mirrors
// protection-portal CrossSellSubFlow's Confirm-contact step (the user-
// confirmed canonical insurance lead-capture UX, "image 7" in the
// feedback). Old "Generate an Embedded Insurance link" header swapped
// for an "INSURANCE · FIND SAVINGS" eyebrow + "Confirm your contact
// details" h2 to match the cross-sell Confirm shape.
//
// Replaces the prior CaptureLinkForm — renamed because both flow paths
// (Capture+Quote vs Quote Only) originate a lead, so the "capture"
// framing was path-specific.
//
// Status transitions on submit:
//
//   capture_and_quote: started → lead.created → capture_link.created
//   quote_only:        started → lead.created → quote_link.created
//
// "Send link" then advances to capture_link.sent or quote_link.sent
// (mirrors the link-* status family for analytics; the same URL field
// is used for both paths per canon `_insurance_flow_paths_consumer_url`).
//
// Standalone-only additions kept from the old shape (cross-sell context
// doesn't need them):
//   * Vehicle-on-file chip — rendered BELOW the form fields, ABOVE the
//     Generate-link button. Always shown — by the time this form renders,
//     a vehicle is guaranteed (AgentView gates on vehicle presence and
//     runs a VehicleAdd pre-step when missing).
//   * Note (optional) — no longer a form textarea. Wave 16 F2-fu4 moved
//     the notes surface to the right-rail NotesPanel (commit 2e3c7a0).
//     partnerData.note in the EI payload now sources from blinkerApi.notes
//     (log-mode, Wave 16 F2-fu13). workflow?.notes is retired.
//
// The mock's flowPath parameter currently lives on createLead. Per
// architecture/06 the real EI selection mechanism is TBD — likely a
// partnerData hint or a get-link flag. Adapter rewrite will move this
// when EI confirms.
//
// ── v3.0.15 (Wave 37 — ADR 27 Task 1 + D9) ───────────────────────────
//   * D3/D4 — Address gate. The form now collects a full address
//     (street/city/state/zip) via the shared `AddressBlock`, wired with
//     the same dotted-path `fieldNames` remap mc's AddContactModal uses.
//     `formIsValid` + `validate()` extend to require a complete address;
//     the EI link cannot be generated until email + phone + address are
//     all present. The address slice prefills from the canonical
//     contact's primary address, parallel to email/phone prefill.
//   * D4/D5 — Dedup / household. The form runs the shared
//     `findContactMatch` against `blinkerApi.contacts.list()` and surfaces
//     the shared `ContactDedupeCard`. Per D5 the card is informational —
//     it does NOT hard-block link generation (the agent legitimately
//     originates opportunities on known contacts); only the address gate
//     hard-blocks. A different-name match + a picked relationship mints a
//     `buildHouseholdRelationship` record at link-generation time.
//   * D9 — Read-only on handoff. Once a consumer link exists
//     (`workflow.consumer_link.url`) the contact details are locked into
//     the EI lead — every input renders non-interactive. Lock technique
//     varies by surface (both choices the ADR allows):
//       - AddressBlock — rendered as a plain read-only text SUMMARY in
//         place of the live block. AddressBlock has no `disabled` prop
//         and lives in another repo (must not modify); a text swap is the
//         cleanest lock — no dead inputs, no a11y ambiguity.
//       - name / email / phone — the shared Field / PhoneField also have
//         no `disabled` prop, so the group is wrapped in a
//         `pointer-events-none opacity-60` + `aria-disabled` <fieldset>.
//       - DOB <input>, FlowPathPicker, ContactDedupeCard — these accept a
//         real `disabled` prop, so it is threaded directly.
//     The link display + "Send link" controls stay interactive.
import { useMemo, useState } from 'react';
import { Cake, Mail, ShieldCheck, Sparkles, User, Car, Send, Copy, MapPin } from 'lucide-react';
import { Field, PhoneField, AddressBlock, ContactDedupeCard } from 'blinker-platform/components';
import { findContactMatch, buildHouseholdRelationship } from 'blinker-platform/utils';
import { useForm } from '../../hooks/useForm.js';
import {
  createLead,
  getLeadLink,
  subscribeWebhooks,
  DuplicateLeadError,
} from '../../lib/embedded-insurance-mock.js';
import { applyWebhookEvent } from '../../lib/insurance-webhook-handler.js';
import { captureEvent } from 'blinker-platform/telemetry';
import { blinkerApi } from 'blinker-platform/api';
import { STATUS } from '../../constants/status-map.js';

const MOCK_CONTACT_PREFILL = {
  email: 'jordan.example@gmail.com',
  phone: '5125550199',
  vehicle: '2021 Toyota RAV4 · ending in 4F2A',
  vehicleApiPayload: { 1: { make: 'Toyota', model: 'RAV4', year: 2021 } },
  applicantFirstName: 'Jordan',
  applicantLastName: 'Sanchez',
  // v3.0.15 — standalone-shell address prefill. Empty by default so the
  // standalone demo exercises the address-collection prompt path; the
  // ZIP is seeded so the agent can confirm rather than start from blank.
  address: {
    zip: '78701',
    city: 'Austin',
    state: 'TX',
    street_address: '',
  },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ZIP5_RE = /^\d{5}$/;
const STATE2_RE = /^[A-Za-z]{2}$/;
const STEP_DELAY_MS = 150;

// AddressBlock fieldNames remap — the form's `address` slice nests the
// fields one level deep, so AddressBlock is pointed at the dotted paths.
// Mirrors mc AddContactModal's ADDRESS_FIELD_NAMES exactly.
const ADDRESS_FIELD_NAMES = {
  zip: 'address.zip',
  city: 'address.city',
  state: 'address.state',
  address: 'address.street_address',
};

// DOB validation — mirrors protection-portal CrossSellSubFlow.dobIsValid
// for shape consistency. ISO YYYY-MM-DD; age ≥ 18; age ≤ 110. Canonical
// per blinker-platform/canon/blinker-domain.json#contact.date_of_birth.
function dobIsValid(s) {
  if (!s || !ISO_DATE_RE.test(s)) return false;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  const minAge = new Date(now.getFullYear() - 110, now.getMonth(), now.getDate());
  const maxAge = new Date(now.getFullYear() - 18, now.getMonth(), now.getDate());
  return d >= minAge && d <= maxAge;
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }
function nowHHMMSS() { return new Date().toTimeString().slice(0, 8); }

// Map flowPath → the link-* status pair used for analytics rendering.
function linkCreatedStatus(flowPath) {
  return flowPath === 'quote_only'
    ? STATUS.QUOTE_LINK_CREATED
    : STATUS.CAPTURE_LINK_CREATED;
}
function linkSentStatus(flowPath) {
  return flowPath === 'quote_only'
    ? STATUS.QUOTE_LINK_SENT
    : STATUS.CAPTURE_LINK_SENT;
}

// Synthetic dedup match for DEV CONTROLS. Mirrors mc AddContactModal's
// buildDevMatch — picks the first session contact and reshapes the name
// to force the same-name vs different-name branch. The dev knob injects
// ONLY this predicate; the real findContactMatch code path is untouched.
// `contacts` is an array here (blinkerApi.contacts.list()).
function buildDevMatch(mode, contacts, currentName) {
  if (mode === 'real' || mode === 'no-match') return null;
  const list = Array.isArray(contacts) ? contacts : [];
  if (!list.length) return null;
  const base = list[0];
  if (mode === 'match-same') {
    return {
      contact: {
        ...base,
        name: {
          first: currentName.first || base.name?.first,
          last: currentName.last || base.name?.last,
        },
      },
      matchedOn: 'phone',
      sameName: true,
    };
  }
  if (mode === 'match-different') {
    return { contact: base, matchedOn: 'phone', sameName: false };
  }
  return null;
}

export function LeadOriginationForm({
  workflow,
  updateWorkflow,
  dev,
  persona = 'agent',
  registerUnsub,
  contact,
  vehicle,
  // opportunity (Wave 36 v3.0.14 — ADR 26 D2b): optional canonical opp
  // record. Today AgentView drives flowPath through the `workflow`
  // snapshot, so this prop is forward-compat scaffolding for a future
  // surface that threads the opp record directly. The flowPath seed
  // precedence reads it second (workflow wins) and the chain falls
  // through harmlessly to `dev` when it's undefined.
  opportunity,
}) {
  // Derive prefill from canonical mission-control contact + vehicle when
  // provided; otherwise fall back to MOCK_CONTACT_PREFILL so the
  // standalone shell renders identically to before. Memoized on the
  // contact / vehicle identity so the useForm seed below is stable
  // across re-renders that don't actually change the prefill source.
  const prefill = useMemo(() => {
    if (!contact && !vehicle) return MOCK_CONTACT_PREFILL;

    const primaryEmail = contact?.emails?.find((e) => e.is_primary) || contact?.emails?.[0];
    const primaryPhone = contact?.phones?.find((p) => p.is_primary) || contact?.phones?.[0];
    // Strip a leading +1 off E.164 so the form's 10-digit input works.
    // Anything else (non-+1, malformed) falls through to the mock.
    const phoneRaw = primaryPhone?.number;
    const phone10 = typeof phoneRaw === 'string' && phoneRaw.startsWith('+1')
      ? phoneRaw.slice(2)
      : null;

    let vehicleLabel = vehicle ? null : MOCK_CONTACT_PREFILL.vehicle;
    let vehicleApiPayload = vehicle ? null : { 1: { make: 'Toyota', model: 'RAV4', year: 2021 } };
    if (vehicle) {
      const last4 = typeof vehicle.vin === 'string' && vehicle.vin.length >= 4
        ? vehicle.vin.slice(-4)
        : null;
      const head = `${vehicle.year ?? ''} ${vehicle.make ?? ''} ${vehicle.model ?? ''}`.trim();
      vehicleLabel = last4 ? `${head} · ending in ${last4}` : head;
      vehicleApiPayload = { 1: { make: vehicle.make, model: vehicle.model, year: vehicle.year } };
    }

    // Address prefill (v3.0.15 — ADR 27 D3). Parallel to email/phone:
    // read the canonical contact's primary address (is_primary first,
    // else [0]) and map the canon `addresses[]` shape onto the form's
    // `address` slice. When the contact carries no address the slice
    // seeds empty strings so the agent is prompted to collect it.
    const primaryAddress =
      contact?.addresses?.find((a) => a.is_primary) || contact?.addresses?.[0];
    const address = primaryAddress
      ? {
          street_address: primaryAddress.line_1 || '',
          city: primaryAddress.city || '',
          state: primaryAddress.state || '',
          zip: primaryAddress.postal_code || '',
        }
      : contact
        ? { street_address: '', city: '', state: '', zip: '' }
        : MOCK_CONTACT_PREFILL.address;

    return {
      email: primaryEmail?.address || MOCK_CONTACT_PREFILL.email,
      phone: phone10 || MOCK_CONTACT_PREFILL.phone,
      // date_of_birth: canonical per blinker-domain.json — ISO YYYY-MM-DD.
      // Null when the contact arrives without one; the form then renders
      // a DOB input and gates Generate-link on it.
      dateOfBirth: contact?.date_of_birth || null,
      applicantFirstName: contact?.name?.first || MOCK_CONTACT_PREFILL.applicantFirstName,
      applicantLastName: contact?.name?.last || MOCK_CONTACT_PREFILL.applicantLastName,
      address,
      vehicle: vehicleLabel,
      vehicleApiPayload,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact?.id, vehicle?.id]);

  const [form, updateForm] = useForm({
    applicantFirstName: prefill.applicantFirstName,
    applicantLastName: prefill.applicantLastName,
    email: prefill.email,
    phone: prefill.phone,
    // dateOfBirth: seeded from canonical contact when present, else
    // empty so the DOB input renders and the agent can collect it.
    dateOfBirth: prefill.dateOfBirth || '',
    // address (v3.0.15 — ADR 27 D3): one-level nested slice
    // { zip, city, state, street_address }. AddressBlock is wired with
    // ADDRESS_FIELD_NAMES (dotted paths) and writes top-level patches
    // shaped { address: {...siblings, zip } } — it reads form.address to
    // preserve siblings. useForm's updateForm is a single-level shallow
    // merge ({ ...prev, ...updates }), so an AddressBlock write of the
    // whole `address` key lands cleanly; no custom dotted-path-aware
    // update wrapper is needed (unlike mc's AddContactModal, whose
    // `update` ALSO has to absorb flat field-name patches).
    address: { ...prefill.address },
    // flowPath seed precedence (Wave 36 v3.0.14 T2b — ADR 26 D2b):
    // the workflow/opportunity wins so an "Insurance Quote" opp (one
    // whose record/workflow carries flowPath: 'quote_only') lands the
    // FlowPathPicker on "Quote Only" by default. The `dev` knob remains
    // the standalone-dev-shell fallback, and 'capture_and_quote' is the
    // hard floor. The picker stays fully functional — switching paths
    // still drives the customer step sequence, generated link type, and
    // post-send timeline path exactly as before (the picker writes
    // form.flowPath, which onGenerate stamps onto the workflow).
    flowPath:
      workflow?.flowPath ??
      opportunity?.flowPath ??
      dev?.flowPath ??
      'capture_and_quote',
  });
  const [errors, setErrors] = useState({});
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentAtDisplay, setSentAtDisplay] = useState(null);
  const [copyFlash, setCopyFlash] = useState(false);
  const [duplicateError, setDuplicateError] = useState(null);
  // Dedup household-relationship pick — only meaningful when a
  // different-name match surfaces (v3.0.15 — ADR 27 D4).
  const [relationship, setRelationship] = useState('');
  // DEV CONTROLS — production-shaped: only injects the predicate.
  const [devMatchMode, setDevMatchMode] = useState('real');

  const link = workflow?.consumer_link;
  const flowPath = workflow?.flowPath || form.flowPath;

  // Read-only gate (v3.0.15 — ADR 27 D9): once a consumer link exists the
  // contact details are locked into the EI lead. Editing them client-side
  // does nothing, so every input renders disabled.
  const readOnly = Boolean(workflow?.consumer_link?.url);

  // Org scope for the per-org dedup scan — contact wins, then opportunity,
  // else undefined (findContactMatch treats undefined as "all orgs").
  const orgId = contact?.org_id ?? opportunity?.org_id ?? undefined;

  // Session contacts for the dedup scan. blinkerApi.contacts.list() is
  // fixture-backed (shared canon fixtures) so it returns a populated array
  // even standalone; scope to orgId when known.
  const sessionContacts = useMemo(
    () =>
      blinkerApi.contacts.list(
        typeof orgId === 'number' ? { org_id: orgId } : undefined,
      ),
    [orgId],
  );

  // Live dedup — only run once phone OR email passes shape validation, so
  // a match card doesn't pop mid-typing (mirrors AddContactModal's
  // dedupeReady gate). The dev knob injects a synthetic predicate.
  const dedupeReady =
    (form.phone?.length === 10) ||
    EMAIL_RE.test(String(form.email || '').trim());

  const match = useMemo(() => {
    if (!dedupeReady) return null;
    const currentName = {
      first: form.applicantFirstName?.trim() || '',
      last: form.applicantLastName?.trim() || '',
    };
    if (devMatchMode !== 'real') {
      return buildDevMatch(devMatchMode, sessionContacts, currentName);
    }
    return findContactMatch(sessionContacts, {
      phone: form.phone,
      email: form.email,
      orgId,
      currentName: `${currentName.first} ${currentName.last}`.trim(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dedupeReady,
    sessionContacts,
    orgId,
    form.applicantFirstName,
    form.applicantLastName,
    form.phone,
    form.email,
    devMatchMode,
  ]);
  const isLinkSent = [
    STATUS.CAPTURE_LINK_SENT,
    STATUS.CAPTURE_LINK_VIEWED,
    STATUS.QUOTE_LINK_SENT,
    STATUS.QUOTE_LINK_VIEWED,
    STATUS.CAPTURE_COMPLETED,
    STATUS.QUOTE_COMPLETED,
    STATUS.QUOTE_VIEWED,
    STATUS.POLICY_BOUND,
    STATUS.ERROR_VERIFICATION,
    STATUS.ERROR_QUOTE,
  ].includes(workflow?.status);

  function validate() {
    const e = {};
    if (!form.applicantFirstName?.trim()) e.applicantFirstName = 'First name required';
    if (!form.applicantLastName?.trim()) e.applicantLastName = 'Last name required';
    if (!form.email?.trim() || !EMAIL_RE.test(form.email.trim())) {
      e.email = 'Enter a valid email';
    }
    if (!form.phone || form.phone.length !== 10) {
      e.phone = 'Enter a 10-digit phone number';
    }
    // DOB required for insurance underwriting per blinker-domain.json.
    if (!form.dateOfBirth) {
      e.dateOfBirth = 'Required for insurance underwriting';
    } else if (!dobIsValid(form.dateOfBirth)) {
      e.dateOfBirth = 'Enter a valid birthdate (18+)';
    }
    // Address required (v3.0.15 — ADR 27 D4). EI needs a full address —
    // a 5-digit ZIP, a 2-letter state, and non-empty city + street.
    const addr = form.address || {};
    if (!ZIP5_RE.test(String(addr.zip || '').trim())) {
      e.addressZip = 'Enter a 5-digit ZIP code';
    }
    if (!String(addr.city || '').trim()) {
      e.addressCity = 'City required';
    }
    if (!STATE2_RE.test(String(addr.state || '').trim())) {
      e.addressState = 'Enter a 2-letter state';
    }
    if (!String(addr.street_address || '').trim()) {
      e.addressStreet = 'Street address required';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  // Live validity for the Generate-link CTA disabled-state. Cheap and
  // re-runs every render, so the button reflects field state without
  // requiring a submit attempt. v3.0.15 (ADR 27 D4): the hard gate now
  // also requires a complete address — ZIP/city/state/street. Per D5 the
  // dedup match does NOT enter this predicate (informational only).
  const addr = form.address || {};
  const addressIsValid =
    ZIP5_RE.test(String(addr.zip || '').trim()) &&
    Boolean(String(addr.city || '').trim()) &&
    STATE2_RE.test(String(addr.state || '').trim()) &&
    Boolean(String(addr.street_address || '').trim());

  const formIsValid =
    Boolean(form.applicantFirstName?.trim()) &&
    Boolean(form.applicantLastName?.trim()) &&
    Boolean(form.email?.trim()) &&
    EMAIL_RE.test(String(form.email || '').trim()) &&
    form.phone?.length === 10 &&
    Boolean(form.dateOfBirth) &&
    dobIsValid(form.dateOfBirth) &&
    addressIsValid;

  async function onGenerate() {
    if (!validate()) return;
    setGenerating(true);
    setDuplicateError(null);

    // Read the latest note from the SDK (log-mode, Wave 16 F2-fu13).
    // contact?.id is the canonical contact keyed in blinkerApi.notes;
    // workflow?.lead?.leadId (or workflow?.id) scopes to this opportunity.
    // Falls back to null gracefully when no note exists or contact is absent.
    const latestNote = (() => {
      const list = blinkerApi.notes.list({
        contact_id: contact?.id,
        opportunity_id: workflow?.lead?.leadId || workflow?.id,
      });
      return list[0]?.body || null;
    })();

    captureEvent('insurance_lead_origination_started', {
      flow_path: form.flowPath,
      has_note: Boolean(latestNote),
      persona,
    });

    // Household-relationship record (v3.0.15 — ADR 27 D4/D5). When a
    // different-name dedup match is showing AND the agent picked a
    // relationship, mint the link record. There is no Phase 1 persistence
    // target for it — Phase 2 writes it via
    // blinkerApi.contacts.linkHousehold() (or the cross-org cascade) — so
    // for now it is logged. Same-name matches never produce one.
    if (match && !match.sameName && relationship) {
      const householdRelationship = buildHouseholdRelationship({
        existingContactId: match.contact.id,
        newContactId: contact?.id,
        kind: relationship,
      });
      // eslint-disable-next-line no-console
      console.log('[insurance] household relationship recorded', householdRelationship);
      captureEvent('insurance_lead_origination_household_linked', {
        matched_on: match.matchedOn,
        kind: relationship,
        persona,
      });
    }

    updateWorkflow({
      flowPath: form.flowPath,
      status: STATUS.STARTED,
    });
    await delay(STEP_DELAY_MS);

    // Vehicle is guaranteed by the time this runs — AgentView gates on
    // vehicle presence and runs a VehicleAdd pre-step when missing, so
    // prefill.vehicleApiPayload is always populated.
    const vehiclesPayload = prefill.vehicleApiPayload;

    // POST /auto/v1/leads (mocked). Real call shape per architecture/06
    // §POST /auto/v1/leads.
    const leadPayload = {
      applicant: {
        firstName: form.applicantFirstName,
        lastName: form.applicantLastName,
        email: form.email,
        phoneNumber: '+1' + form.phone,
        // dateOfBirth: ISO YYYY-MM-DD — required by EI underwriting.
        // Wave 13b agent flagged the gap; this closes it. Field name
        // mirrors the rest of the EI applicant payload (camelCase).
        dateOfBirth: form.dateOfBirth,
        // address (v3.0.15 — ADR 27 D4): EI underwriting needs the full
        // garaging address. Field names mirror the camelCase applicant
        // payload; the adapter rewrite will confirm the exact EI shape.
        address: {
          street: form.address?.street_address || '',
          city: form.address?.city || '',
          state: form.address?.state || '',
          zip: form.address?.zip || '',
        },
      },
      vehicles: vehiclesPayload,
      partnerBrand: 'Blinker',
      partnerData: {
        sourceSystem: 'PartnerPortal',
        note: latestNote,
      },
      isTest: true,
    };

    let lead;
    try {
      lead = await createLead(leadPayload, {
        flowPath: form.flowPath,
        nextVerificationOutcome: dev?.nextVerificationOutcome || 'completed',
        nextQuoteOutcome: dev?.nextQuoteOutcome || 'completed',
        autoChain: false, // agent-driven flow uses Simulate buttons
      });
    } catch (err) {
      setGenerating(false);
      if (err instanceof DuplicateLeadError) {
        setDuplicateError(err.message);
        captureEvent('insurance_lead_duplicate', { flow_path: form.flowPath, persona });
        updateWorkflow({ status: STATUS.DUPLICATE });
      } else {
        // eslint-disable-next-line no-console
        console.error('[insurance] createLead failed', err);
        captureEvent('insurance_lead_origination_failed', { reason: 'unknown', persona });
        updateWorkflow({ status: STATUS.ERROR_VERIFICATION });
      }
      return;
    }

    updateWorkflow({
      lead,
      status: STATUS.LEAD_CREATED,
    });
    await delay(STEP_DELAY_MS);

    // Subscribe before requesting the link so we don't miss any webhook
    // an aggressive partner might fire pre-link-delivery.
    const unsub = subscribeWebhooks(lead.leadId, (envelope) => {
      applyWebhookEvent(envelope, updateWorkflow);
      captureEvent('insurance_webhook_received', {
        lead_id: lead.leadId,
        ei_status: envelope.status,
        view: 'agent',
        persona,
      });
    });
    registerUnsub?.(unsub);

    const linkResp = await getLeadLink(lead.leadId, { partnerBrand: 'Blinker' });
    updateWorkflow({
      consumer_link: {
        url: linkResp.url,
        token: linkResp.token,
        generatedAt: new Date().toISOString(),
        sentAt: null,
      },
      status: linkCreatedStatus(form.flowPath),
    });
    captureEvent('insurance_consumer_link_created', {
      lead_id: lead.leadId,
      flow_path: form.flowPath,
      persona,
    });

    setGenerating(false);
  }

  function onSend() {
    if (!link?.url) return;
    setSending(true);

    const twilioPayload = {
      to: '+1' + form.phone,
      body: `Get your insurance quote: ${link.url}`,
    };
    const mandrillPayload = {
      to: form.email,
      subject: 'Your insurance quote from Blinker',
      bodyHtml: `<a href="${link.url}">Tap here to get started</a>`,
    };
    // eslint-disable-next-line no-console
    console.log('[twilio:mock]', twilioPayload);
    // eslint-disable-next-line no-console
    console.log('[mandrill:mock]', mandrillPayload);
    captureEvent('insurance_consumer_link_sent', {
      lead_id: workflow?.lead?.leadId,
      flow_path: flowPath,
      channels: ['sms', 'email'],
      persona,
    });

    const sentAtIso = new Date().toISOString();
    updateWorkflow({
      consumer_link: { ...link, sentAt: sentAtIso },
      status: linkSentStatus(flowPath),
    });
    setSentAtDisplay(nowHHMMSS());
    setSending(false);
  }

  function onCopy() {
    if (!link?.url || typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(link.url).then(() => {
      setCopyFlash(true);
      setTimeout(() => setCopyFlash(false), 1200);
    });
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      {/* Confirm-contact header — mirrors CrossSellSubFlow.InsuranceMiniFlow's */}
      {/* confirm step (Wave 16 F8). The cross-sell shape is canonical. */}
      <div className="px-6 pt-5 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2 text-emerald-600 mb-2">
          <ShieldCheck className="w-4 h-4" />
          <span className="text-xs uppercase tracking-wide font-semibold">
            Insurance · Find savings
          </span>
        </div>
        <h2 className="text-xl font-semibold tracking-tight">Confirm your contact details</h2>
        <p className="text-sm text-slate-500 mt-1">
          We'll send you a one-time link to a secure insurance quote.
          Pick the flow path, confirm the basics, and we'll do the rest.
        </p>
      </div>

      <div className="px-6 py-5 space-y-4">
        {/* Read-only notice (v3.0.15 — ADR 27 D9). Surfaces once the */}
        {/* consumer link exists — the contact details are locked into */}
        {/* the EI lead and editing them client-side does nothing. */}
        {readOnly && (
          <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
            Link generated — contact details are locked. The consumer now
            drives this workflow from the EI microsite.
          </div>
        )}

        {/* Name / email / phone fields. The shared Field / PhoneField */}
        {/* (blinker-platform/components) do NOT accept a `disabled` prop */}
        {/* and live in another repo, so the read-only (D9) lock is */}
        {/* applied by wrapping the field group in a pointer-events-none */}
        {/* + opacity + aria-disabled container — same technique used for */}
        {/* the FlowPathPicker. The AddressBlock uses the cleaner */}
        {/* read-only-text-summary swap instead (see below) — picked per */}
        {/* surface: a swap reads better for a multi-input block, a */}
        {/* wrapper is fine for these simple inputs. */}
        <FlowPathPicker
          value={form.flowPath}
          onChange={(v) => updateForm({ flowPath: v })}
          disabled={readOnly}
        />

        <fieldset
          className={readOnly ? 'pointer-events-none opacity-60' : undefined}
          aria-disabled={readOnly || undefined}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="First name"
                icon={User}
                value={form.applicantFirstName}
                onChange={(v) => updateForm({ applicantFirstName: v })}
                error={errors.applicantFirstName}
              />
              <Field
                label="Last name"
                icon={User}
                value={form.applicantLastName}
                onChange={(v) => updateForm({ applicantLastName: v })}
                error={errors.applicantLastName}
              />
            </div>

            <Field
              label="Email"
              icon={Mail}
              value={form.email}
              onChange={(v) => updateForm({ email: v })}
              placeholder="name@example.com"
              error={errors.email}
            />

            <PhoneField
              label="Phone"
              value={form.phone}
              onChange={(v) => updateForm({ phone: v })}
              error={errors.phone}
            />
          </div>
        </fieldset>

        {/* Date of birth — required for EI underwriting per blinker-domain.json. */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold flex items-center gap-1">
              <Cake className="w-3 h-3" /> Date of birth
            </label>
            <span className="text-[10px] uppercase tracking-wide text-amber-700 font-semibold">
              Required for insurance
            </span>
          </div>
          <input
            type="date"
            value={form.dateOfBirth}
            onChange={(e) => updateForm({ dateOfBirth: e.target.value })}
            disabled={readOnly}
            className={
              'w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-400 ' +
              (errors.dateOfBirth ? 'border-rose-300 bg-rose-50' : 'border-slate-200')
            }
            max={new Date(new Date().getFullYear() - 18, 0, 1).toISOString().slice(0, 10)}
          />
          <p className="text-[11px] text-slate-500 mt-1 leading-snug">
            Required for insurance underwriting
          </p>
          {errors.dateOfBirth && (
            <div className="text-xs text-rose-700 mt-1">{errors.dateOfBirth}</div>
          )}
        </div>

        {/* Address (v3.0.15 — ADR 27 D3/D4). Required before the EI link */}
        {/* can be generated. When the form is read-only (D9) we render a */}
        {/* plain text summary IN PLACE OF the live AddressBlock — cleaner */}
        {/* than a pointer-events-none overlay (no dead inputs, no a11y */}
        {/* ambiguity). AddressBlock has no `disabled` prop and lives in */}
        {/* another repo, so we do not touch it. */}
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2 flex items-center gap-1">
            <MapPin className="w-3 h-3" /> Address
            <span className="text-rose-500">*</span>
          </div>
          {readOnly ? (
            <AddressSummary address={form.address} />
          ) : (
            <div className="space-y-3">
              <AddressBlock
                form={form}
                update={updateForm}
                fieldNames={ADDRESS_FIELD_NAMES}
                autoFocusZip={false}
              />
              {(errors.addressZip ||
                errors.addressCity ||
                errors.addressState ||
                errors.addressStreet) && (
                <div className="text-xs text-rose-700 space-y-0.5">
                  {errors.addressZip && <div>{errors.addressZip}</div>}
                  {errors.addressCity && <div>{errors.addressCity}</div>}
                  {errors.addressState && <div>{errors.addressState}</div>}
                  {errors.addressStreet && <div>{errors.addressStreet}</div>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Dedup / household card (v3.0.15 — ADR 27 D4/D5). Informational */}
        {/* — does NOT hard-block link generation; the agent legitimately */}
        {/* originates opportunities on known contacts. Renders nothing */}
        {/* when there is no match. */}
        <ContactDedupeCard
          match={match}
          relationship={relationship}
          onRelationshipChange={setRelationship}
          disabled={readOnly}
        />

      </div>

      <div className="px-6 pb-5 pt-4 border-t border-slate-100 space-y-3">
        {/* Vehicle context chip — always rendered. AgentView guarantees a */}
        {/* vehicle is attached before this form runs (VehicleAdd pre-step */}
        {/* when missing), so the form-level inline VIN block was retired. */}
        <div className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-xs text-slate-600">
          <Car className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
          <div>
            Vehicle on file: <span className="font-mono">{prefill.vehicle}</span>.
            Attached to the lead so the consumer doesn't re-enter it on EI's microsite.
          </div>
        </div>

        <button
          onClick={onGenerate}
          disabled={generating || Boolean(link) || !formIsValid}
          className={
            'w-full px-5 py-2 rounded-md font-semibold text-sm flex items-center justify-center gap-2 ' +
            (generating || link || !formIsValid
              ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 text-white')
          }
        >
          <Sparkles className="w-4 h-4" />
          {generating ? 'Generating…' : link ? 'Link generated' : 'Generate insurance link'}
        </button>

        {duplicateError && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
            Duplicate lead — EI returned 4xx on POST /leads. Check existing
            lead state in the CRM before retrying.
          </div>
        )}

        {link?.url && (
          <div>
            <div className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wide">
              Consumer link (EI microsite)
            </div>
            <div className="flex gap-2">
              <input
                readOnly
                value={link.url}
                onFocus={(e) => e.target.select()}
                className="flex-1 border border-slate-200 rounded-md px-3 py-2 text-xs font-mono bg-slate-50 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={onCopy}
                title="Copy to clipboard"
                className="px-3 py-2 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1"
              >
                <Copy className="w-3 h-3" />
                {copyFlash ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {link?.url && (
          <button
            onClick={onSend}
            disabled={sending || isLinkSent}
            className={
              'w-full px-5 py-2 rounded-md font-semibold text-sm flex items-center justify-center gap-2 ' +
              (sending || isLinkSent
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white')
            }
          >
            <Send className="w-4 h-4" />
            {isLinkSent
              ? `Sent${sentAtDisplay ? ' at ' + sentAtDisplay : ''}`
              : sending
                ? 'Sending…'
                : 'Send link via SMS + email'}
          </button>
        )}

        {/* DEV CONTROLS — dedupe match emulation. Mirrors mc */}
        {/* AddContactModal's block: injects only a synthetic predicate, */}
        {/* leaving the real findContactMatch code path intact. */}
        <DevControlsBlock
          mode={devMatchMode}
          onModeChange={setDevMatchMode}
          hasContacts={sessionContacts.length > 0}
        />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// Local presentational helpers — kept in-file because they're used only
// by this form. Mirrors the "tiny presentational helpers" pattern from
// CrossSellSubFlow's confirm-step locals.

function FlowPathPicker({ value, onChange, disabled = false }) {
  const opts = [
    { v: 'capture_and_quote', l: 'Capture + Quote', sub: 'Preferred · partner captures current policy & computes savings' },
    { v: 'quote_only',        l: 'Quote Only',      sub: 'Skip the policy capture — savings comparison may not be available' },
  ];
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-1">
        Flow path
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {opts.map((o) => {
          const active = value === o.v;
          return (
            <button
              key={o.v}
              type="button"
              disabled={disabled}
              onClick={() => onChange(o.v)}
              className={
                'text-left px-3 py-2 rounded-md border transition ' +
                (disabled ? 'cursor-not-allowed opacity-60 ' : '') +
                (active
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-200 hover:border-slate-300 bg-white')
              }
            >
              <div className={'text-xs font-semibold ' + (active ? 'text-blue-700' : 'text-slate-700')}>
                {o.l}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{o.sub}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// AddressSummary — read-only address rendering (v3.0.15 — ADR 27 D9).
// Shown IN PLACE OF the live AddressBlock once a consumer link exists.
// AddressBlock has no `disabled` prop and lives in another repo, so a
// plain-text swap is the clean lock — no dead inputs, no a11y ambiguity.
function AddressSummary({ address }) {
  const a = address || {};
  const line1 = a.street_address || '—';
  const cityStateZip = [a.city, a.state].filter(Boolean).join(', ') +
    (a.zip ? ` ${a.zip}` : '');
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-700">
      <div>{line1}</div>
      <div className="text-slate-500">{cityStateZip || '—'}</div>
    </div>
  );
}

// DEV CONTROLS — dedupe match emulation. Replicated from mc
// AddContactModal's DevControlsBlock (3-strikes rule — acceptable local
// copy; not lifted to packages). Injects only a synthetic predicate so
// the prototype can preview every branch; the real findContactMatch path
// is untouched.
function DevControlsBlock({ mode, onModeChange, hasContacts }) {
  return (
    <details className="rounded-md border border-dashed border-amber-300 bg-amber-50/50 p-2">
      <summary className="text-[10px] uppercase tracking-wider font-semibold text-amber-700 cursor-pointer">
        DEV CONTROLS · dedupe match emulation
      </summary>
      <div className="mt-2 space-y-1.5">
        <p className="text-[11px] text-amber-800 leading-relaxed">
          Injects a synthetic predicate result so prototype users can preview
          all branches without crafting a colliding contact. Production code
          path is identical — only the predicate changes.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {[
            { v: 'real', l: 'Real (default)' },
            { v: 'no-match', l: 'Force no-match' },
            { v: 'match-same', l: 'Match · same name' },
            { v: 'match-different', l: 'Match · different name' },
          ].map((opt) => {
            const active = mode === opt.v;
            const disabled =
              !hasContacts && (opt.v === 'match-same' || opt.v === 'match-different');
            return (
              <button
                key={opt.v}
                type="button"
                disabled={disabled}
                onClick={() => onModeChange(opt.v)}
                className={
                  'text-[11px] px-2 py-1 rounded ring-1 transition-colors ' +
                  (active
                    ? 'bg-amber-600 text-white ring-amber-700'
                    : disabled
                      ? 'bg-slate-100 text-slate-400 ring-slate-200 cursor-not-allowed'
                      : 'bg-white text-amber-800 ring-amber-300 hover:ring-amber-500')
                }
              >
                {opt.l}
              </button>
            );
          })}
        </div>
      </div>
    </details>
  );
}

