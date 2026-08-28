// AgentView — the home-protection agent shell. Composes the SAME customer
// wizard inside agent chrome rather than duplicating any screens.
//
//   ┌─ Top bar ───────────────────────────────────────────┐
//   │ Status pill · Force status · Persona · API responses│
//   └─────────────────────────────────────────────────────┘
//   ┌─ Main column ───────────┐   ┌─ Side column ────────┐
//   │ CaptureLinkForm (gate)  │   │ Agent notes panel    │
//   │   then HomeWizard       │   │                      │
//   │   + Save and Send       │   │                      │
//   └─────────────────────────┘   └──────────────────────┘
//
// PROP DESTRUCTURING IS LOAD-BEARING
// ----------------------------------
// Every prop this component accepts is named in the destructure below, even
// the ones it only passes through. React silently discards a prop that is
// never named — no warning, no error, just a feature that quietly does
// nothing. That exact bug hid an unused `opportunity` prop in
// protection-portal's AgentView for many waves before anyone noticed. If you
// add a prop to the mission-control embed contract, add it here too.
//
// State ownership:
//   * form / stepIdx — the same shape CustomerView uses, lifted so the shell
//     can read everything (status pill, API responses, Save and Send).
//     When the parent threads form + update + stepIdx + setStepIdx, those win;
//     otherwise AgentView falls back to its own internal state seeded from the
//     contact and home props.
//   * opportunity — agent-only metadata (id, captureLink, contact, status,
//     sentSummary). Distinct from form because the wizard neither knows nor
//     cares about the capture link.
import { useEffect, useMemo, useRef, useState } from 'react';
import { NotesPanel, JsonPeek } from 'blinker-platform/components';
import { toNationalPhoneDigits } from 'blinker-platform/utils';
import { track } from 'blinker-platform/telemetry';
import { useForm } from '../../hooks/useForm.js';
import { HomeWizard, INITIAL_FORM, buildSteps } from '../customer/CustomerView.jsx';
import { stepFromStatus } from '../../lib/status-step-map.js';
import { AgentTopBar, SaveAndSendFooter, HP_STATUS } from './AgentChrome.jsx';
import { CaptureLinkForm } from './CaptureLinkForm.jsx';
import { buildMockHousehold } from '../../lib/contact.js';
import personasJson from '../../constants/canon/personas.json' with { type: 'json' };

function permissionsFor(persona) {
  return personasJson.personas?.[persona]?.permissions ?? [];
}

const INITIAL_OPPORTUNITY = {
  id: null,
  contact: null,
  captureLink: null,
  status: HP_STATUS.EMPTY,
  sentSummary: null,
};

/**
 * Merge a canonical mission-control contact and home into INITIAL_FORM.
 *
 * All three arguments are optional — a standalone caller passes none and
 * gets INITIAL_FORM unchanged. Only fields that are actually present are
 * written; INITIAL_FORM's defaults survive everywhere else.
 *
 * Home mapping note: `home.address` is the COVERED PROPERTY. The contact's
 * primary address seeds `contact.address1/city/state/zip`, which is the
 * agreement holder's MAILING address. They are deliberately separate — the
 * agreement has distinct fields for each, and conflating them was the live
 * template defect ADR 30 R5 documents.
 *
 * `prefill` is `opportunity._prefill` (ADR 30 R8 follow-up): mission-control
 * carries the contact's mailing address forward onto a freshly-created
 * home_protection opportunity when the contact has no home on file yet. It
 * is only consulted when `home` is absent — a real home record always wins.
 * `prefill.home.source === 'contact_address'` means the address is an
 * ASSUMPTION (the mailing address, not a confirmed covered property), and
 * `home.address_source` carries that through so HomeAdd can show a
 * confirm-this note. Every field it seeds stays fully editable.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function buildInitialFormSeed(contact, home, prefill) {
  if (!contact && !home && !prefill?.home?.address) return INITIAL_FORM;
  const seed = { ...INITIAL_FORM };

  if (contact) {
    if (contact.org_id !== undefined && contact.org_id !== null) seed.org_id = contact.org_id;

    const emails = Array.isArray(contact.emails) ? contact.emails : [];
    const primaryEmail = emails.find((e) => e?.is_primary) || emails[0] || null;

    const phones = Array.isArray(contact.phones) ? contact.phones : [];
    const primaryPhone = phones.find((p) => p?.is_primary) || phones[0] || null;
    const phoneStr = toNationalPhoneDigits(primaryPhone?.number);

    const addresses = Array.isArray(contact.addresses) ? contact.addresses : [];
    const primaryAddr = addresses.find((a) => a?.is_primary) || addresses[0] || null;

    seed.contact = {
      ...INITIAL_FORM.contact,
      ...(contact.name?.first ? { first_name: contact.name.first } : null),
      ...(contact.name?.last ? { last_name: contact.name.last } : null),
      ...(primaryEmail?.address ? { email: primaryEmail.address } : null),
      ...(phoneStr ? { phone: phoneStr } : null),
      ...(primaryAddr?.line_1 ? { address1: primaryAddr.line_1 } : null),
      ...(primaryAddr?.city ? { city: primaryAddr.city } : null),
      ...(primaryAddr?.state ? { state: primaryAddr.state } : null),
      ...(primaryAddr?.postal_code ? { zip: primaryAddr.postal_code } : null),
      ...(Array.isArray(contact.addresses) ? { addresses: contact.addresses } : null),
      ...(Array.isArray(contact.household_members)
        ? { household_members: contact.household_members }
        : null),
    };
  }

  if (home) {
    seed.home = {
      ...INITIAL_FORM.home,
      id: home.id ?? null,
      home_type: home.home_type || '',
      address: { ...INITIAL_FORM.home.address, ...(home.address || {}) },
      year_built: home.year_built ?? null,
      square_feet: home.square_feet ?? null,
      purchase_price: home.purchase_price ?? null,
      disposition: home.disposition ?? null,
      // dwelling_class stays DERIVED — HomeAdd recomputes it from
      // (home_type, square_feet) on mount, so a canon bucket change takes
      // effect without rewriting stored records.
      dwelling_class: null,
      address_source: null,
    };
  } else if (prefill?.home?.address) {
    // No home on file yet — carry the assumed address forward, but leave
    // home_type / year_built / square_feet unset. Those still gate
    // classifyDwelling (and therefore eligibility), and an address can't
    // supply them.
    seed.home = {
      ...INITIAL_FORM.home,
      address: { ...INITIAL_FORM.home.address, ...prefill.home.address },
      address_source: prefill.home.source ?? null,
    };
  }

  return seed;
}

export function AgentView({
  // ---- the mission-control embed contract (ADR 30) ----
  persona: personaProp,
  opportunity: opportunityProp,
  contact: contactProp,
  home: homeProp,
  form: formProp,
  update: updateProp,
  stepIdx: stepIdxProp,
  setStepIdx: setStepIdxProp,
  onFormChange,
  onHomeCommitted,
  availableStatuses,
  // ---- standalone / shell extras ----
  personaLocked = false,
  seedMultiContactHousehold = false,
}) {
  const initialOpportunity = opportunityProp
    ? {
        ...INITIAL_OPPORTUNITY,
        id: opportunityProp.id ?? null,
        status: opportunityProp.status ?? HP_STATUS.EMPTY,
        captureLink: opportunityProp.captureLink ?? null,
        sentSummary: opportunityProp.sentSummary ?? null,
        contact: opportunityProp.contact ?? null,
      }
    : INITIAL_OPPORTUNITY;
  const [opportunity, updateOpportunity] = useForm(initialOpportunity);

  // The parent remounts via `key` when the underlying opportunity changes, so
  // the seed is computed once per mount. The memo is for stability, not
  // reactivity — useForm reads its argument exactly once.
  const initialFormSeed = useMemo(
    () => buildInitialFormSeed(contactProp, homeProp, opportunityProp?._prefill),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contactProp?.id, homeProp?.id, opportunityProp?._prefill],
  );

  // Hooks always run (Rules of Hooks); the const swap below decides which
  // slot is authoritative.
  const [internalForm, internalUpdate] = useForm(initialFormSeed);
  const [internalStepIdx, setInternalStepIdx] = useState(0);
  const form = formProp ?? internalForm;
  const updateForm = updateProp || internalUpdate;
  const stepIdx = stepIdxProp ?? internalStepIdx;
  const setStepIdx = setStepIdxProp || setInternalStepIdx;

  const [persona, setPersonaInner] = useState(personaProp || 'agent');
  const [apiModalOpen, setApiModalOpen] = useState(false);

  // See the resume-at-step effect below for what this guards.
  const skipNextResumeRef = useRef(false);

  useEffect(() => {
    if (personaProp && personaProp !== persona) setPersonaInner(personaProp);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only personaProp drives this
  }, [personaProp]);

  // Keep local opportunity.status in sync with the prop, so mission-control's
  // force-status picker and status_change activities move the pill, the
  // showWizard gate and the resume point together.
  useEffect(() => {
    const next = opportunityProp?.status;
    if (!next) return;
    if (next === opportunity.status) return;
    updateOpportunity({ status: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- status is the destination, not the trigger
  }, [opportunityProp?.status]);

  // Resume-at-step. Only fires while the wizard is still at step 0: once the
  // agent has navigated manually, their position wins and we never teleport
  // them.
  //
  // `skipNextResumeRef` is the escape hatch for `handleStartWizardHere`
  // below: moving off HP_STATUS.EMPTY via "Start the quote here" ALSO
  // changes `opportunity.status`, which would otherwise re-trigger this same
  // effect and teleport the agent to the status→step mapping's target
  // (e.g. 'Quoted' → recommended_coverage) — even though stepIdx was just
  // explicitly pinned to 0. The ref lets that one status transition skip the
  // status→step lookup entirely, without weakening the guard for every other
  // status change (force-status picker, real progression, mount-time resume
  // for an already-progressed opportunity).
  useEffect(() => {
    const status = opportunity?.status;
    if (!status || status === HP_STATUS.EMPTY) return;
    if (skipNextResumeRef.current) {
      skipNextResumeRef.current = false;
      return;
    }
    if (stepIdx !== 0) return;
    const targetKey = stepFromStatus(status, 'home_add');
    if (targetKey === 'home_add') return;
    const dynamicSteps = buildSteps(form);
    const targetIdx = dynamicSteps.indexOf(targetKey);
    if (targetIdx > 0) {
      setStepIdx(targetIdx);
      track('home_protection.agent.wizard_resumed_at_step', {
        status,
        step: targetKey,
        step_idx: targetIdx,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- status change drives this
  }, [opportunity?.status]);

  // Mirror live form state up to an embedder (mission-control's CoPilot debug
  // pane). Fires on mount with the seeded form and on every change. The parent
  // should memoize the callback if reference stability matters — an unstable
  // one re-fires on every form change with no new information.
  useEffect(() => {
    if (typeof onFormChange === 'function') onFormChange(form);
  }, [form, onFormChange]);

  // Push a canonical home record up to the embedder whenever the wizard learns
  // something new about it. Mirrors protection-portal's onVehicleCommitted
  // contract: mission-control dedupes by id and patches in place, so firing
  // freely is safe and repeat fires with the same payload are no-ops.
  //
  // Only fires once the record is actually useful — a home needs at least a
  // type and a street address to be worth showing on a contact profile.
  useEffect(() => {
    if (typeof onHomeCommitted !== 'function') return;
    const h = form?.home;
    if (!h?.home_type) return;
    if (!h.address?.address1 || !h.address?.city || !h.address?.state) return;
    const id =
      h.id
      || `xs_home_${[h.address.address1, h.address.city, h.address.state, h.address.zip]
        .filter(Boolean)
        .join('_')
        .replace(/\s+/g, '_')
        .toLowerCase()}`;
    onHomeCommitted({
      id,
      org_id: form.org_id ?? null,
      household_id: contactProp?.household_id ?? null,
      primary_contact_id: contactProp?.id ?? null,
      contact_ids: [contactProp?.id].filter(Boolean),
      home_type: h.home_type,
      address: h.address,
      year_built: h.year_built ?? null,
      square_feet: h.square_feet ?? null,
      purchase_price: h.purchase_price ?? null,
      disposition: h.disposition ?? null,
      // Derived — sent so the embedder's card can render it without importing
      // the classifier, but never treated as stored truth.
      dwelling_class: h.dwelling_class ?? null,
      source: 'manual',
    });
    // The individual home fields below ARE the dependency set. Listing
    // `form.home` as well would refire on every unrelated patch to that object
    // and defeat the field-level granularity this effect depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    form?.home?.home_type,
    form?.home?.address?.address1,
    form?.home?.address?.city,
    form?.home?.address?.state,
    form?.home?.address?.zip,
    form?.home?.square_feet,
    form?.home?.year_built,
    form?.home?.dwelling_class,
    form?.org_id,
    contactProp?.id,
    contactProp?.household_id,
    onHomeCommitted,
  ]);

  // DEV CONTROLS · seed a mock multi-contact household. In agent mode this is
  // the primary surface for the BillingPayment switcher and the second-holder
  // slot, so the toggle's main path is here.
  useEffect(() => {
    if (!seedMultiContactHousehold) return;
    const existing = form.contact?.household_members;
    if (Array.isArray(existing) && existing.length > 0) return;
    const members = buildMockHousehold(form.contact || {});
    const primary = members.find((m) => m.is_primary) || members[0];
    updateForm({
      contact: {
        ...(form.contact || {}),
        first_name: form.contact?.first_name || primary.first_name,
        last_name: form.contact?.last_name || primary.last_name,
        email: form.contact?.email || primary.email,
        phone: form.contact?.phone || primary.phone,
        household_members: members,
        active_member_id: primary.id,
        active_address_id: primary.addresses?.[0]?.id || null,
      },
    });
    track('dev.seed_multi_contact_applied', { view: 'agent', member_count: members.length });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedMultiContactHousehold]);

  const perms = permissionsFor(persona);
  const canAddTags = perms.includes('add_tags');
  const canCreateTags = perms.includes('create_tags');

  const contact = form?.contact || {};
  const selectedTagIds = Array.isArray(contact.tags) ? contact.tags : [];
  const sessionCreatedTags = Array.isArray(contact.tagsCreated) ? contact.tagsCreated : [];

  function writeContact(patch) {
    updateForm({ contact: { ...(form?.contact || {}), ...patch } });
  }

  function setPersona(p) {
    if (personaLocked) return;
    setPersonaInner(p);
    track('home_protection.agent.persona_switched', { persona: p });
  }

  // CaptureLinkForm's "Start the quote here" action. Opens the wizard by
  // moving the opportunity off HP_STATUS.EMPTY — but ALWAYS at step 0
  // (home_add), so the agent (and consumer, if the address was only
  // prefilled from the create-opportunity dialogue) confirms or completes
  // the covered-property address before anything else, rather than landing
  // on whatever step the status→step resume map would otherwise pick for
  // 'Quoted'. `skipNextResumeRef` stops the resume-at-step effect above from
  // immediately re-deriving a step from the new status and stomping this.
  function handleStartWizardHere() {
    skipNextResumeRef.current = true;
    setStepIdx(0);
    updateOpportunity({ status: 'Quoted' });
  }

  // An 'Empty' opportunity has no quote, so there is nothing for the wizard to
  // render — the capture-link gate stands in. Any other status implies a quote
  // exists (or the agent forced one), and the wizard resumes at the mapped
  // step. Deliberately NOT gated on captureLink presence: that is a session
  // artifact, and gating on it left CoPilot stuck on the gate for pre-quoted
  // fixture opportunities in protection-portal.
  const showWizard = opportunity.status !== HP_STATUS.EMPTY;
  const steps = buildSteps(form);
  const currentStepKey = steps[Math.min(stepIdx, steps.length - 1)] || 'home_add';

  return (
    <>
      <AgentTopBar
        opportunity={opportunity}
        setOpportunityStatus={(next) => updateOpportunity({ status: next })}
        persona={persona}
        setPersona={setPersona}
        personaLocked={personaLocked}
        onOpenApiResponses={() => {
          track('home_protection.agent.api_responses_viewed', {
            opportunity_id: opportunity.id,
            from_step: currentStepKey,
          });
          setApiModalOpen(true);
        }}
        availableStatuses={availableStatuses}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <div>
          {!showWizard && (
            <CaptureLinkForm
              opportunity={opportunity}
              updateOpportunity={updateOpportunity}
              contact={contactProp}
              onStartHere={handleStartWizardHere}
            />
          )}
          {showWizard && (
            <>
              <HomeWizard
                form={form}
                update={updateForm}
                stepIdx={stepIdx}
                setStepIdx={setStepIdx}
                persona="agent"
                trackPrefix="home_protection.agent"
              />
              <SaveAndSendFooter
                opportunity={opportunity}
                currentStepKey={currentStepKey}
                sentSummary={opportunity.sentSummary}
                onSent={(s) => updateOpportunity({ sentSummary: s })}
              />
            </>
          )}
        </div>
        <div className="space-y-4">
          <NotesPanel
            contactId={contactProp?.id}
            opportunityId={opportunity.id}
            authorId="agent_session"
            showTags={true}
            selectedTagIds={selectedTagIds}
            onTagAdd={(tagId) => {
              if (selectedTagIds.includes(tagId)) return;
              writeContact({ tags: [...selectedTagIds, tagId] });
            }}
            onTagRemove={(tagId) => writeContact({ tags: selectedTagIds.filter((id) => id !== tagId) })}
            onTagCreate={(tag) =>
              writeContact({
                tagsCreated: [...sessionCreatedTags, tag],
                tags: [...selectedTagIds, tag.id],
              })
            }
            canAddTags={canAddTags}
            canCreateTags={canCreateTags}
            sessionCreatedTags={sessionCreatedTags}
            orgId={form.org_id}
            persona={persona}
            trackingPrefix="home_protection.agent"
          />
        </div>
      </div>

      {apiModalOpen && (
        <ApiResponsesModal form={form} onClose={() => setApiModalOpen(false)} />
      )}
    </>
  );
}

// Super-admin-only raw payload inspector. Deliberately minimal: the four
// payloads an agent actually needs to reason about a home quote — the rater's
// response, the plan the selector landed on, the add-on rows resolved for that
// plan and term, and the agreement payload.
function ApiResponsesModal({ form, onClose }) {
  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-900/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-900">API responses</span>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-800"
          >
            Close
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <JsonPeek label="GetRates · normalized response" data={form.rates} />
          <JsonPeek label="selectedPlan" data={form.selectedPlan} />
          <JsonPeek label="selectedAddOns" data={form.selectedAddOns} />
          <JsonPeek label="paymentSchedule" data={form.paymentSchedule} />
          <JsonPeek
            label="DocuSeal submission"
            data={{
              template_id: form.docusealTemplateId,
              submission_id: form.submission_id,
              fields: form.docusealFields,
            }}
          />
        </div>
      </div>
    </div>
  );
}
