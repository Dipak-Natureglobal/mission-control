// Customer view · Step (post-confirm) — Billing & Payment.
//
// Lifted shape from BlinkerLegacy/.../screens/11-consumer-billing-payment.md
// — Due Today banner, contact + address fields (customer mode only),
// FluidPay hosted-fields card row, TCPA disclaimer above the Pay button.
//
// Per UX feedback 2026-05-04 (CONTACT·CAPTURE removal):
//   - Contact info (name/email/phone) is collected here when
//     persona === 'consumer'. Agent mode skips the contact form because
//     the agent shell prefills form.contact.* from mission-control's
//     CoPilot session before the wizard mounts (Phase 2 prop thread).
//   - Address fields rendered via refi-portal's <AddressBlock />
//     (zip-first → city/state autofill via zippopotam.us + Google Places
//     street autocomplete). Apt/Suite enabled.
//   - AddressBlock writes directly into form.contact.* via the fieldNames
//     remap so Confirm's contact card stays consistent on back nav and
//     ThankYou's downstream reads keep working without translation.
//   - TCPA disclaimer copy reads from canon org-disclaimers.json with
//     {{ORG_NAME}} interpolation per the read pattern in
//     architecture/09-protection-billing-config.md.
//
// On Pay we:
//   1. Tokenize the card via FluidPay (or dev fallback in sandbox).
//   2. Stash the result on form.payment.tokenized — preserves the agent
//      payment-control values already on form.payment from Confirm.
//   3. Mark form.status = 'payment_succeeded'.
//   4. Advance the wizard.
//
// We do NOT call a real charge API in Phase 1 — Blinker's backend is the
// proxy that exchanges the token for an EFS-vault customer + first-payment
// charge. The FluidPay one_time_token is enough audit trail for the
// prototype walk.
//
// Tokenize errors surface inline; user can retry. Decline scenarios from
// SANDBOX_TEST_CARDS (e.g. 4000000000000002) tokenize successfully here —
// the actual decline would happen at the backend charge step in Phase 2.
import { useEffect, useRef, useState } from 'react';
import { CreditCard, Loader2, AlertCircle, Lock, UserCheck, Pencil, Users, MapPin } from 'lucide-react';
import { ScreenHeader, WizardFooter } from 'blinker-platform/components';
import { Field, PhoneField } from 'blinker-platform/components';
import { FluidPayHostedFields } from '../../shared/FluidPayHostedFields.jsx';
import { AddressBlock } from 'blinker-platform/components';
import orgRegistry from '../../constants/canon/org-registry.json';
import orgDisclaimers from '../../constants/canon/org-disclaimers.json';
import { track } from 'blinker-platform/telemetry';
import { chargeOneTimeToken } from 'blinker-platform/integrations/payment';
import {
  seedActiveContact,
  seedActiveAddress,
  mirrorContactEditsToMember,
  mirrorAddressEditsToMember,
  pickActiveMember,
  formatMemberLabel,
  formatAddressLabel,
} from '../../lib/contact.js';

function fmtCurrency(v) {
  if (v == null) return '—';
  return `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Local phone display (mirrors PhoneField's internal helper). Used in
// the agent contact card display row where we render a string, not an
// editable input. Lifting it out of FormFields.jsx as a public export
// would inflate that file's surface area for one read-only call site.
function formatPhoneDisplay(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length === 0) return '';
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// Canon TCPA copy — orgDisclaimers.by_org[orgId]?.tcpa_consent?.[locale]
// ?? orgDisclaimers.defaults.tcpa_consent[locale]. Currently no per-org
// overrides exist (architecture/09 _TODO), so the defaults block is the
// hot path. {{ORG_NAME}} interpolated at render.
function loadTcpa(orgId, locale = 'en') {
  const orgName = orgRegistry.orgs.find((o) => o.id === orgId)?.name || 'Blinker';
  const template =
    orgDisclaimers.by_org?.[orgId]?.tcpa_consent?.[locale]
    ?? orgDisclaimers.defaults?.tcpa_consent?.[locale]
    ?? '';
  return template.replace(/\{\{ORG_NAME\}\}/g, orgName);
}

// AddressBlock remap — its default fieldNames write flat (form.zip,
// form.city, etc.). protection-portal's contact slice nests: contact
// has flat children (contact.address1, contact.city, ...). Mapping
// address → contact.address1, apt_suite → contact.address2 keeps Confirm's
// existing reads of contact.address1/2 unchanged.
const ADDRESS_FIELD_NAMES = {
  zip: 'contact.zip',
  city: 'contact.city',
  state: 'contact.state',
  address: 'contact.address1',
  apt_suite: 'contact.address2',
};

export function BillingPayment({ form, update, onNext, persona = 'consumer' }) {
  const fluidpayRef = useRef(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const contact = form.contact || {};
  const dueToday = form.paymentSchedule?.due_today ?? 0;
  const isConsumer = persona === 'consumer';
  const isAgent = persona === 'agent';

  // Household / active-member derivations (agent mode multi-contact UX,
  // UX feedback 2026-05-04). Phase 1 keeps the wider form.contact shape
  // flat; household_members is a sibling slice on contact and the active
  // member's id/address are mirrored onto contact.active_member_id /
  // active_address_id so a switch is fully replayable from form state.
  const householdMembers = Array.isArray(contact.household_members)
    ? contact.household_members
    : [];
  const activeMember = pickActiveMember(householdMembers, contact.active_member_id);
  const activeAddresses = activeMember?.addresses || [];
  const showMemberSwitcher = isAgent && householdMembers.length > 1;
  const showAddressSwitcher = isAgent && activeAddresses.length > 1;

  // AddressBlock writes via writePatch which returns { contact: {key:v} }
  // for nested paths. useForm's shallow merge would clobber the rest of
  // form.contact (name/email/phone from agent prefill, plus other address
  // fields) because shallow merge replaces nested objects wholesale.
  // Wrap update so any patch touching `contact` merges into existing
  // form.contact rather than replacing it. mergeWrites in AddressBlock
  // already pre-merges multi-field updates against form.contact, so
  // double-merging here is safe.
  //
  // Also: when the agent has an active household member, mirror any
  // address-key writes back into that member's matching address record
  // so a round-trip switch (member → other → original) lands on the
  // edited values. Name/email/phone edits go through their own Save
  // path below so they aren't intercepted here.
  function updateContactSafe(patch) {
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, 'contact')) {
      update(patch);
      return;
    }
    const incoming = patch.contact || {};
    const merged = { ...(form.contact || {}), ...incoming };
    if (isAgent && activeMember && householdMembers.length > 0) {
      const addrEdits = {};
      if ('address1' in incoming) addrEdits.line_1 = incoming.address1;
      if ('address2' in incoming) addrEdits.line_2 = incoming.address2;
      if ('city' in incoming) addrEdits.city = incoming.city;
      if ('state' in incoming) addrEdits.state = incoming.state;
      if ('zip' in incoming) addrEdits.zip = incoming.zip;
      if (Object.keys(addrEdits).length > 0) {
        merged.household_members = mirrorAddressEditsToMember(
          householdMembers,
          activeMember.id,
          contact.active_address_id,
          addrEdits,
        );
      }
    }
    update({ ...patch, contact: merged });
  }

  const tcpa = loadTcpa(form.org_id);

  // Local edit-buffer for the four NAME/EMAIL/PHONE fields (consumer only).
  // Address fields write through AddressBlock straight into form.contact.*
  // — they're considered live state immediately so ZIP autofill is
  // visible without any "save" step. Name/email/phone use a local buffer
  // so the agent prefill flow (form.contact.first_name set externally)
  // still works without us clobbering it on every render.
  const [nameFields, setNameFields] = useState({
    first_name: contact.first_name || '',
    last_name: contact.last_name || '',
    email: contact.email || '',
    phone: contact.phone || '',
  });

  function setNameField(key, value) {
    setNameFields((b) => ({ ...b, [key]: value }));
  }

  // Agent-mode contact card edit state. Card defaults to display mode;
  // "Edit" flips to inputs over a local buffer so abandoned edits
  // don't pollute form state. "Save" commits the buffer to form.contact
  // AND mirrors into the active household_members entry so the change
  // survives a contact switch. "Cancel" reverts the buffer.
  const [agentEditing, setAgentEditing] = useState(false);
  const [agentBuffer, setAgentBuffer] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
  });

  function openAgentEdit() {
    setAgentBuffer({
      first_name: contact.first_name || '',
      last_name: contact.last_name || '',
      email: contact.email || '',
      phone: contact.phone || '',
    });
    setAgentEditing(true);
  }

  function setAgentBufferField(key, value) {
    setAgentBuffer((b) => ({ ...b, [key]: value }));
  }

  function saveAgentEdit() {
    const edits = {
      first_name: agentBuffer.first_name,
      last_name: agentBuffer.last_name,
      email: agentBuffer.email,
      phone: agentBuffer.phone,
    };
    const changedFields = Object.keys(edits).filter(
      (k) => (contact[k] || '') !== edits[k],
    );
    const nextContact = { ...contact, ...edits };
    if (activeMember && householdMembers.length > 0) {
      nextContact.household_members = mirrorContactEditsToMember(
        householdMembers,
        activeMember.id,
        edits,
      );
    }
    update({ contact: nextContact });
    track('billing.contact_edited', {
      changed_fields: changedFields,
      active_member_id: activeMember?.id || null,
    });
    setAgentEditing(false);
  }

  function cancelAgentEdit() {
    setAgentEditing(false);
  }

  // Handler — agent picked a different household member from the
  // switcher. Re-seed flat contact keys + active address from that
  // member's record. Edits the agent already saved on the previous
  // active member persisted via mirrorContactEditsToMember above, so
  // they survive a switch back.
  function handleSwitchMember(nextMemberId) {
    if (!nextMemberId || nextMemberId === contact.active_member_id) return;
    const nextMember = householdMembers.find((m) => m.id === nextMemberId);
    if (!nextMember) return;
    const seedPatch = seedActiveContact(nextMember).contact || {};
    const merged = { ...contact, ...seedPatch };
    update({ contact: merged });
    track('protection.billing.contact_switched', {
      from_member_id: contact.active_member_id || null,
      to_member_id: nextMember.id,
    });
    if (agentEditing) setAgentEditing(false);
  }

  // Handler — agent picked a different address for the active member.
  // Copies the address fields into the flat contact slice; AddressBlock
  // re-reads from form.contact so its inputs reflect the new selection.
  function handleSwitchAddress(nextAddressId) {
    if (!nextAddressId || nextAddressId === contact.active_address_id) return;
    const nextAddr = activeAddresses.find((a) => a.id === nextAddressId);
    if (!nextAddr) return;
    const seedPatch = seedActiveAddress(nextAddr).contact || {};
    const merged = { ...contact, ...seedPatch };
    update({ contact: merged });
    track('billing.address_switched', {
      from_address_id: contact.active_address_id || null,
      to_address_id: nextAddr.id,
    });
  }

  // First-paint reconciliation: when household_members is present but
  // active_member_id / active_address_id aren't pinned yet (the DEV
  // CONTROLS toggle just seeded the data, or upstream prefill arrived
  // without the active markers), pin them to the primary member /
  // primary address so the switchers + AddressBlock have a stable
  // anchor. Runs once per change of household_members identity.
  useEffect(() => {
    if (!isAgent) return;
    if (householdMembers.length === 0) return;
    if (contact.active_member_id && contact.active_address_id) return;
    const primary = pickActiveMember(householdMembers, contact.active_member_id);
    if (!primary) return;
    const seedPatch = seedActiveContact(primary).contact || {};
    update({ contact: { ...contact, ...seedPatch } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAgent, householdMembers]);

  const viewedRef = useRef(false);
  const tcpaTrackedRef = useRef(false);
  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    track('protection.customer.billing_payment.viewed', {
      due_today: dueToday,
      persona,
      tokenizer_mode: fluidpayRef.current?.mode || null,
    });
    if (!tcpaTrackedRef.current) {
      tcpaTrackedRef.current = true;
      track('billing.tcpa_displayed', { org_id: form.org_id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleZipResolved({ zip, state }) {
    track('billing.address_resolved', { zip, state });
  }

  // Validate — consumer mode requires the contact buffer; agent mode
  // trusts the prefilled contact. Address must be filled in both modes
  // (agent prefill should populate it; if not, agent will see the
  // blank fields and complete them).
  const consumerOk = !isConsumer || (
    nameFields.first_name &&
    nameFields.last_name &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(nameFields.email).trim()) &&
    String(nameFields.phone).replace(/\D/g, '').length === 10
  );
  const addressOk = !!(contact.zip && contact.city && contact.state && contact.address1);
  const formOk = consumerOk && addressOk;

  async function handlePay() {
    if (submitting) return;
    if (!formOk) {
      setError('Fill in all required fields above.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await fluidpayRef.current.tokenize();
      track('protection.customer.billing_payment.tokenized', {
        last4: result.card_last_four,
        brand: result.card_brand,
        dev: !!result.dev,
      });
      // Wave 24 Task 1 — charge the tokenized payment via the EFS package.
      // Outcome 'approved' advances; anything else surfaces classified copy
      // and stays at this step so the user can retry.
      const charge = await chargeOneTimeToken(
        {
          token: result.one_time_token,
          amount: dueToday,
          contact: { ...contact, ...(isConsumer ? nameFields : {}) },
        },
        { orgId: form.org_id },
      );
      track('protection.customer.billing_payment.charge_completed', {
        outcome: charge.outcome,
        kind: charge.classified?.kind,
        dev: !!charge.dev,
      });
      if (charge.outcome !== 'approved') {
        // Classified failure — show the displayMessage; user can retry.
        // Stash the failure on form.payment so ApiResponsesModal can read it,
        // but DO NOT advance and DO NOT set status: 'payment_succeeded'.
        update({
          payment: {
            ...(form.payment || {}),
            one_time_token: result.one_time_token,
            card_last_four: result.card_last_four,
            card_brand: result.card_brand,
            exp_month: result.exp_month,
            exp_year: result.exp_year,
            dev: !!result.dev,
            tokenized_at: new Date().toISOString(),
            amount_attempted: dueToday,
            charge: charge,
          },
        });
        setError(charge.classified?.displayMessage || 'Could not process payment.');
        setSubmitting(false);
        return;
      }
      // Sync name buffer back into contact (consumer mode only — agent
      // mode reads form.contact verbatim from prefill). Address fields
      // already live on form.contact.* via AddressBlock.
      const nextContact = isConsumer
        ? { ...contact, ...nameFields }
        : contact;
      update({
        contact: nextContact,
        payment: {
          ...(form.payment || {}),
          one_time_token: result.one_time_token,
          card_last_four: result.card_last_four,
          card_brand: result.card_brand,
          exp_month: result.exp_month,
          exp_year: result.exp_year,
          dev: !!result.dev,
          tokenized_at: new Date().toISOString(),
          amount_charged: dueToday,
          charge_id: charge.charge_id,
          charged_at: new Date().toISOString(),
          charge: charge,
        },
        status: 'payment_succeeded',
      });
      onNext();
    } catch (err) {
      const detail = err?.detail || err?.message || 'Could not process payment.';
      track('protection.customer.billing_payment.failed', { error: detail });
      setError(detail);
    } finally {
      setSubmitting(false);
    }
  }

  const greetingName = isConsumer ? (nameFields.first_name || 'Hi') : (contact.first_name || 'Hi');

  return (
    <>
      <ScreenHeader
        icon={CreditCard}
        eyebrow="Billing · Payment"
        title="Enter your payment information"
        subtitle={`${greetingName}, enter the credit card you'll be using today to make your payment.`}
      />

      <div className="px-6 space-y-3">
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-rose-700">Due today</span>
          <span className="text-lg font-bold text-rose-700">{fmtCurrency(dueToday)}</span>
        </div>

        {/* Contact info — consumer mode only. Agent mode trusts the
            prefilled form.contact and shows a small "Billing for: X"
            confirmation strip instead. */}
        {isConsumer && (
          <div className="border border-slate-200 rounded-md overflow-hidden">
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-slate-500" />
              <span className="text-xs uppercase tracking-wide font-semibold text-slate-600">
                Your contact info
              </span>
            </div>
            <div className="px-4 py-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="First name"
                  value={nameFields.first_name}
                  onChange={(v) => setNameField('first_name', v)}
                />
                <Field
                  label="Last name"
                  value={nameFields.last_name}
                  onChange={(v) => setNameField('last_name', v)}
                />
              </div>
              <Field
                label="Email"
                value={nameFields.email}
                onChange={(v) => setNameField('email', v)}
                placeholder="you@example.com"
                inputMode="email"
              />
              <PhoneField
                label="Phone"
                value={nameFields.phone}
                onChange={(v) => setNameField('phone', v)}
              />
            </div>
          </div>
        )}

        {/* Agent-mode contact card — UX feedback 2026-05-04. Display
            mode by default; "Edit" flips to inputs. Switcher dropdowns
            appear above when household_members has > 1 entry / the
            active member has > 1 address. */}
        {isAgent && (
          <>
            {showMemberSwitcher && (
              <div className="border border-slate-200 rounded-md px-3 py-2 flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-500 shrink-0" />
                <label className="text-[11px] uppercase tracking-wide font-semibold text-slate-600 shrink-0">
                  Active contact
                </label>
                <select
                  value={contact.active_member_id || activeMember?.id || ''}
                  onChange={(e) => handleSwitchMember(e.target.value)}
                  className="flex-1 text-sm border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
                >
                  {householdMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {formatMemberLabel(m)}{m.is_primary ? ' (primary)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="border border-slate-200 rounded-md overflow-hidden">
              <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-slate-500" />
                  <span className="text-xs uppercase tracking-wide font-semibold text-slate-600">
                    Contact
                  </span>
                </div>
                {!agentEditing && (
                  <button
                    type="button"
                    onClick={openAgentEdit}
                    className="text-[11px] inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 font-semibold"
                  >
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                )}
              </div>
              <div className="px-4 py-3 space-y-2">
                {!agentEditing && (
                  <>
                    <div className="text-sm font-semibold text-slate-800">
                      {[contact.first_name, contact.last_name].filter(Boolean).join(' ') || (
                        <span className="text-slate-400 font-normal italic">No name on file</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-600">
                      {contact.email || (
                        <span className="text-slate-400 italic">No email on file</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-600">
                      {contact.phone ? formatPhoneDisplay(contact.phone) : (
                        <span className="text-slate-400 italic">No phone on file</span>
                      )}
                    </div>
                  </>
                )}
                {agentEditing && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <Field
                        label="First name"
                        value={agentBuffer.first_name}
                        onChange={(v) => setAgentBufferField('first_name', v)}
                      />
                      <Field
                        label="Last name"
                        value={agentBuffer.last_name}
                        onChange={(v) => setAgentBufferField('last_name', v)}
                      />
                    </div>
                    <Field
                      label="Email"
                      value={agentBuffer.email}
                      onChange={(v) => setAgentBufferField('email', v)}
                      placeholder="you@example.com"
                      inputMode="email"
                    />
                    <PhoneField
                      label="Phone"
                      value={agentBuffer.phone}
                      onChange={(v) => setAgentBufferField('phone', v)}
                    />
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={saveAgentEdit}
                        className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={cancelAgentEdit}
                        className="text-xs px-3 py-1.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        )}

        {/* Agent-mode address switcher — appears above the AddressBlock
            when the active member has > 1 address on file. Picking an
            entry copies its fields into form.contact.address* via
            seedActiveAddress; AddressBlock re-reads form values so its
            inputs reflect the new selection without a remount. */}
        {showAddressSwitcher && (
          <div className="border border-slate-200 rounded-md px-3 py-2 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-slate-500 shrink-0" />
            <label className="text-[11px] uppercase tracking-wide font-semibold text-slate-600 shrink-0">
              Address
            </label>
            <select
              value={contact.active_address_id || activeAddresses[0]?.id || ''}
              onChange={(e) => handleSwitchAddress(e.target.value)}
              className="flex-1 text-sm border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
            >
              {activeAddresses.map((a) => (
                <option key={a.id} value={a.id}>
                  {formatAddressLabel(a)}{a.is_primary ? ' (primary)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Address — shared AddressBlock from refi-portal. Fieldnames
            remap to contact.* so Confirm's read of contact.address1/etc.
            stays consistent on back nav. ZIP-first; city/state autofill
            via zippopotam.us; street autocomplete via Google Places. */}
        <div className="border border-slate-200 rounded-md overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-slate-500" />
            <span className="text-xs uppercase tracking-wide font-semibold text-slate-600">
              Billing address
            </span>
          </div>
          <div className="px-4 py-3 space-y-3">
            <AddressBlock
              form={form}
              update={updateContactSafe}
              fieldNames={ADDRESS_FIELD_NAMES}
              showAptSuite={true}
              autoFocusZip={isConsumer}
              onZipResolved={handleZipResolved}
            />
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-1">
            <Lock className="w-3 h-3" /> Card details
          </div>
          <FluidPayHostedFields ref={fluidpayRef} amount={dueToday} />
        </div>

        {tcpa && (
          <div className="text-[11px] text-slate-500 leading-relaxed border-t border-slate-100 pt-3">
            {tcpa}
          </div>
        )}

        {error && (
          <div className="text-xs text-rose-700 flex items-start gap-1">
            <AlertCircle className="w-3 h-3 mt-0.5" /> {error}
          </div>
        )}
        {submitting && (
          <div className="text-xs text-blue-600 flex items-center justify-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Processing payment…
          </div>
        )}
      </div>

      <WizardFooter
        onNext={handlePay}
        disabled={submitting || !formOk}
        nextLabel={submitting ? 'Processing…' : `Pay ${fmtCurrency(dueToday)}`}
      />
    </>
  );
}
