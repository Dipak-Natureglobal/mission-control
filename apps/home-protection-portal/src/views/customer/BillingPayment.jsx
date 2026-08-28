// Customer view · Step 6 — Billing & payment.
//
// Ported essentially unchanged from protection-portal — the Due Today banner,
// contact capture, AddressBlock, FluidPay hosted fields, TCPA disclaimer and
// tokenize→charge sequence are workflow-agnostic. Three home-specific
// differences:
//
//   1. The address collected here is the AGREEMENT HOLDER'S MAILING address.
//      It is a different thing from the covered property captured on
//      home_add, and the two are allowed to differ (a landlord, a second
//      home, a recent move). They land on distinct DocuSeal fields —
//      Address1/City/State/Zip for the holder, PropertyAddress1/… for the
//      property. Same-named DocuSeal fields share a value, so collapsing
//      them would print the wrong address on one of the two blocks
//      (ADR 30 R5 item 4).
//   2. A SECOND AGREEMENT HOLDER can be added (ADR 30 D2) — the Omega home
//      agreement has two holder slots, and a married couple or a parent and
//      adult child on one deed are both holders of one agreement. Phase 1
//      captures and renders it; there is no relationship store to write it
//      to yet (ADR 30 R3).
//   3. Due today includes the optional coverages, because Confirm folded
//      them into the schedule (ADR 30 D7).
//
// updateContactSafe is load-bearing and must not be simplified away: useForm
// is a single-level shallow merge, so a patch of { contact: { zip } } would
// otherwise replace form.contact wholesale and drop the name, email, phone
// and every other address field.
import { useEffect, useRef, useState } from 'react';
import {
  CreditCard, Loader2, AlertCircle, Lock, UserCheck, Pencil, Users, MapPin, UserPlus, X,
} from 'lucide-react';
import {
  ScreenHeader, WizardFooter, Field, PhoneField, AddressBlock,
} from 'blinker-platform/components';
import { formatPhoneDisplay } from 'blinker-platform/utils';
import { track } from 'blinker-platform/telemetry';
import { chargeOneTimeToken } from 'blinker-platform/integrations/payment';
import { FluidPayHostedFields } from '../../shared/FluidPayHostedFields.jsx';
import orgRegistry from '../../constants/canon/org-registry.json' with { type: 'json' };
import orgDisclaimers from '../../constants/canon/org-disclaimers.json' with { type: 'json' };
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

// Canon TCPA copy — by_org override, else the defaults block, with
// {{ORG_NAME}} interpolated at render.
function loadTcpa(orgId, locale = 'en') {
  const orgName = orgRegistry.orgs.find((o) => o.id === orgId)?.name || 'Blinker';
  const template =
    orgDisclaimers.by_org?.[orgId]?.tcpa_consent?.[locale]
    ?? orgDisclaimers.defaults?.tcpa_consent?.[locale]
    ?? '';
  return template.replace(/\{\{ORG_NAME\}\}/g, orgName);
}

// AddressBlock writes flat by default; remap into the contact slice so the
// holder's mailing address never collides with form.home.address.
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

  const householdMembers = Array.isArray(contact.household_members) ? contact.household_members : [];
  const activeMember = pickActiveMember(householdMembers, contact.active_member_id);
  const activeAddresses = activeMember?.addresses || [];
  const showMemberSwitcher = isAgent && householdMembers.length > 1;
  const showAddressSwitcher = isAgent && activeAddresses.length > 1;

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

  // Local buffer for name/email/phone (consumer mode). Address fields write
  // straight through so ZIP autofill is visible with no save step.
  const [nameFields, setNameFields] = useState({
    first_name: contact.first_name || '',
    last_name: contact.last_name || '',
    email: contact.email || '',
    phone: contact.phone || '',
  });
  function setNameField(key, value) {
    setNameFields((b) => ({ ...b, [key]: value }));
  }

  // Agent-mode contact card edit buffer.
  const [agentEditing, setAgentEditing] = useState(false);
  const [agentBuffer, setAgentBuffer] = useState({
    first_name: '', last_name: '', email: '', phone: '',
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
    const edits = { ...agentBuffer };
    const changedFields = Object.keys(edits).filter((k) => (contact[k] || '') !== edits[k]);
    const nextContact = { ...contact, ...edits };
    if (activeMember && householdMembers.length > 0) {
      nextContact.household_members = mirrorContactEditsToMember(
        householdMembers, activeMember.id, edits,
      );
    }
    update({ contact: nextContact });
    track('home_protection.customer.billing_payment.contact_edited', {
      changed_fields: changedFields,
      active_member_id: activeMember?.id || null,
    });
    setAgentEditing(false);
  }

  function handleSwitchMember(nextMemberId) {
    if (!nextMemberId || nextMemberId === contact.active_member_id) return;
    const nextMember = householdMembers.find((m) => m.id === nextMemberId);
    if (!nextMember) return;
    const seedPatch = seedActiveContact(nextMember).contact || {};
    update({ contact: { ...contact, ...seedPatch } });
    track('home_protection.customer.billing_payment.contact_switched', {
      from_member_id: contact.active_member_id || null,
      to_member_id: nextMember.id,
    });
    if (agentEditing) setAgentEditing(false);
  }

  function handleSwitchAddress(nextAddressId) {
    if (!nextAddressId || nextAddressId === contact.active_address_id) return;
    const nextAddr = activeAddresses.find((a) => a.id === nextAddressId);
    if (!nextAddr) return;
    const seedPatch = seedActiveAddress(nextAddr).contact || {};
    update({ contact: { ...contact, ...seedPatch } });
    track('home_protection.customer.billing_payment.address_switched', {
      from_address_id: contact.active_address_id || null,
      to_address_id: nextAddr.id,
    });
  }

  // Pin the active member / address when household data arrived without them.
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
    track('home_protection.customer.billing_payment.viewed', {
      due_today: dueToday,
      add_ons_total: form.paymentSchedule?.add_ons_total ?? 0,
      persona,
      tokenizer_mode: fluidpayRef.current?.mode || null,
    });
    if (!tcpaTrackedRef.current) {
      tcpaTrackedRef.current = true;
      track('home_protection.customer.billing_payment.tcpa_displayed', { org_id: form.org_id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── second agreement holder (ADR 30 D2) ─────────────────────────────────
  const second = form.secondaryContact;
  function setSecondField(key, value) {
    update({ secondaryContact: { ...(form.secondaryContact || {}), [key]: value } });
  }
  function addSecondHolder() {
    update({ secondaryContact: { first_name: '', last_name: '', phone: '' } });
    track('home_protection.customer.billing_payment.second_holder_added', { persona });
  }
  function removeSecondHolder() {
    update({ secondaryContact: null });
    track('home_protection.customer.billing_payment.second_holder_removed', { persona });
  }

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
      track('home_protection.customer.billing_payment.tokenized', {
        last4: result.card_last_four,
        brand: result.card_brand,
        dev: !!result.dev,
      });
      const charge = await chargeOneTimeToken(
        {
          token: result.one_time_token,
          amount: dueToday,
          contact: { ...contact, ...(isConsumer ? nameFields : {}) },
        },
        { orgId: form.org_id },
      );
      track('home_protection.customer.billing_payment.charge_completed', {
        outcome: charge.outcome,
        kind: charge.classified?.kind,
        dev: !!charge.dev,
      });
      const tokenSlice = {
        one_time_token: result.one_time_token,
        card_last_four: result.card_last_four,
        card_brand: result.card_brand,
        exp_month: result.exp_month,
        exp_year: result.exp_year,
        dev: !!result.dev,
        tokenized_at: new Date().toISOString(),
      };
      if (charge.outcome !== 'approved') {
        // Classified failure — stash it so the agent's API-responses view can
        // read it, surface the copy, and stay on this step. Do NOT advance and
        // do NOT move the status forward.
        update({
          payment: { ...(form.payment || {}), ...tokenSlice, amount_attempted: dueToday, charge },
          status: 'Payment Failed',
        });
        setError(charge.classified?.displayMessage || 'Could not process payment.');
        setSubmitting(false);
        return;
      }
      const nextContact = isConsumer ? { ...contact, ...nameFields } : contact;
      update({
        contact: nextContact,
        payment: {
          ...(form.payment || {}),
          ...tokenSlice,
          amount_charged: dueToday,
          charge_id: charge.charge_id,
          charged_at: new Date().toISOString(),
          charge,
        },
        status: 'Payment Success',
      });
      onNext();
    } catch (err) {
      const detail = err?.detail || err?.message || 'Could not process payment.';
      track('home_protection.customer.billing_payment.failed', { error: detail });
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

        {isConsumer && (
          <div className="border border-slate-200 rounded-md overflow-hidden">
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-slate-500" />
              <span className="text-xs uppercase tracking-wide font-semibold text-slate-600">
                Agreement holder
              </span>
            </div>
            <div className="px-4 py-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="First name" value={nameFields.first_name} onChange={(v) => setNameField('first_name', v)} />
                <Field label="Last name" value={nameFields.last_name} onChange={(v) => setNameField('last_name', v)} />
              </div>
              <Field
                label="Email"
                value={nameFields.email}
                onChange={(v) => setNameField('email', v)}
                placeholder="you@example.com"
                inputMode="email"
              />
              <PhoneField label="Phone" value={nameFields.phone} onChange={(v) => setNameField('phone', v)} />
            </div>
          </div>
        )}

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
                    Agreement holder
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
                {!agentEditing ? (
                  <>
                    <div className="text-sm font-semibold text-slate-800">
                      {[contact.first_name, contact.last_name].filter(Boolean).join(' ') || (
                        <span className="text-slate-400 font-normal italic">No name on file</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-600">
                      {contact.email || <span className="text-slate-400 italic">No email on file</span>}
                    </div>
                    <div className="text-xs text-slate-600">
                      {contact.phone
                        ? formatPhoneDisplay(contact.phone)
                        : <span className="text-slate-400 italic">No phone on file</span>}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="First name" value={agentBuffer.first_name} onChange={(v) => setAgentBufferField('first_name', v)} />
                      <Field label="Last name" value={agentBuffer.last_name} onChange={(v) => setAgentBufferField('last_name', v)} />
                    </div>
                    <Field
                      label="Email"
                      value={agentBuffer.email}
                      onChange={(v) => setAgentBufferField('email', v)}
                      placeholder="you@example.com"
                      inputMode="email"
                    />
                    <PhoneField label="Phone" value={agentBuffer.phone} onChange={(v) => setAgentBufferField('phone', v)} />
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
                        onClick={() => setAgentEditing(false)}
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

        {/* Second agreement holder — the Omega home agreement has two slots. */}
        <div className="border border-slate-200 rounded-md overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-slate-500" />
              <span className="text-xs uppercase tracking-wide font-semibold text-slate-600">
                Second agreement holder
              </span>
              <span className="text-[10px] text-slate-400 normal-case">optional</span>
            </div>
            {second && (
              <button
                type="button"
                onClick={removeSecondHolder}
                aria-label="Remove second holder"
                className="p-1 rounded hover:bg-slate-200 text-slate-500"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="px-4 py-3">
            {second ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="First name" value={second.first_name || ''} onChange={(v) => setSecondField('first_name', v)} />
                  <Field label="Last name" value={second.last_name || ''} onChange={(v) => setSecondField('last_name', v)} />
                </div>
                <PhoneField label="Phone" value={second.phone || ''} onChange={(v) => setSecondField('phone', v)} />
              </div>
            ) : (
              <button
                type="button"
                onClick={addSecondHolder}
                className="text-xs text-blue-600 hover:text-blue-700 font-semibold inline-flex items-center gap-1"
              >
                <UserPlus className="w-3 h-3" /> Add a second person to this agreement
              </button>
            )}
          </div>
        </div>

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
              onZipResolved={({ zip, state }) =>
                track('home_protection.customer.billing_payment.address_resolved', { zip, state })
              }
            />
            <p className="text-[11px] text-slate-500 leading-snug">
              Where we send your paperwork. It can be different from the property
              being covered.
            </p>
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
