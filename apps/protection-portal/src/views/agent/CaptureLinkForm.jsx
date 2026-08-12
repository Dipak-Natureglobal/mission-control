// Agent capture-link generator. Mirrors insurance-portal's CaptureLinkForm
// but stripped to fit protection workflow:
//   * No webhook subscription. VSC status transitions are driven by
//     consumer actions on the customer view (consumer hits the link →
//     wizard fires PostHog events as it progresses), not by partner
//     webhooks. So Generate just synthesizes a link locally; Send mocks
//     SMS + email; consumer-driven flips happen later when the wizard
//     actually runs.
//   * Status taxonomy is canon/ghl-status.json `vsc` block. VSC
//     statuses don't have a `machine_id` field yet (only insurance
//     does — see canon TODO). We use display names verbatim:
//       Empty → New Lead → (post-Send) Sent to Consumer
//     When canon adds machine_ids for VSC, swap the display strings
//     for the codes.
//
// The agent enters consumer email + phone, clicks Generate to produce
// a shareable URL, and clicks Send to fake the dispatch. Once the link
// is generated it locks (matches insurance-portal pattern) — agent has
// to reset the workflow to mint a new one.
import { useMemo, useState } from 'react';
import { Copy, Mail, Phone, Send, Sparkles } from 'lucide-react';
import { ScreenHeader } from 'blinker-platform/components';
import { Field, PhoneField } from 'blinker-platform/components';
import { useForm } from '../../hooks/useForm.js';
import { track } from 'blinker-platform/telemetry';
import { blinkerApi } from 'blinker-platform/api';

// Status display names — pulled verbatim from canon/ghl-status.json `vsc`.
// TODO: when canon adds `machine_id` to VSC statuses, swap these for codes.
export const VSC_STATUS = {
  EMPTY: 'Empty',
  CAPTURE_LINK_CREATED: 'Capture Link Created',
  CAPTURE_LINK_SENT: 'Sent to Consumer',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MOCK_CONTACT_PREFILL = {
  email: 'jordan.example@gmail.com',
  phone: '5125550199',
};

// Local helper — normalize a canonical contact phone to the 10-digit
// string PhoneField expects. Strips a leading `+1`, then keeps digits
// only. If the result isn't exactly 10 digits the caller should fall
// back to the mock — we don't want to feed PhoneField a malformed value.
function digitsOnlyTenFromContact(rawNumber) {
  if (!rawNumber) return '';
  let s = String(rawNumber);
  if (s.startsWith('+1')) s = s.slice(2);
  s = s.replace(/\D/g, '');
  return s.length === 10 ? s : '';
}

function synthesizeCaptureUrl() {
  const tokenBytes =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const token = 'CAPTURE_' + tokenBytes.slice(0, 24);
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5175';
  return { token, url: `${origin}/?view=customer&token=${token}` };
}

function nowHHMMSS() {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

export function CaptureLinkForm({ opportunity, updateOpportunity, contact: contactProp }) {
  // Phase 2 prefill: when mission-control's CoPilotPane mounts AgentView
  // with a canonical contact, AgentView threads it down here so the
  // capture-link gate seeds with the real consumer's email/phone instead
  // of the Jordan/512 mock. Standalone callers (App.jsx, dev shell) pass
  // no contact prop → mock applies → byte-identical to pre-Phase-2.
  const prefill = useMemo(() => {
    if (!contactProp) return MOCK_CONTACT_PREFILL;
    const emails = Array.isArray(contactProp.emails) ? contactProp.emails : [];
    const phones = Array.isArray(contactProp.phones) ? contactProp.phones : [];
    const primaryEmail = emails.find((e) => e?.is_primary) || emails[0] || null;
    const primaryPhone = phones.find((p) => p?.is_primary) || phones[0] || null;
    const phoneTen = digitsOnlyTenFromContact(primaryPhone?.number);
    return {
      email: primaryEmail?.address || MOCK_CONTACT_PREFILL.email,
      phone: phoneTen || MOCK_CONTACT_PREFILL.phone,
    };
    // Stable identity = contact id; full prop equality not required.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactProp?.id]);

  const [contact, updateContact] = useForm({
    email: prefill.email,
    phone: prefill.phone,
  });
  const [errors, setErrors] = useState({});
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentAtDisplay, setSentAtDisplay] = useState(null);
  const [copyFlash, setCopyFlash] = useState(false);

  const link = opportunity?.captureLink;
  const isLinkSent = opportunity?.status === VSC_STATUS.CAPTURE_LINK_SENT;

  function validate() {
    const e = {};
    if (!contact.email?.trim() || !EMAIL_RE.test(contact.email.trim())) {
      e.email = 'Enter a valid email';
    }
    if (!contact.phone || contact.phone.length !== 10) {
      e.phone = 'Enter a 10-digit phone number';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function onGenerate() {
    if (!validate()) return;
    setGenerating(true);

    // Read the latest note from the SDK (log-mode, Wave 16 F2-fu13).
    // contactProp?.id is the canonical contact keyed in blinkerApi.notes;
    // opportunity?.id scopes to this opportunity's notes. Falls back to
    // null gracefully when no note exists or contactProp is absent.
    const latestNote = (() => {
      const list = blinkerApi.notes.list({
        contact_id: contactProp?.id,
        opportunity_id: opportunity?.id,
      });
      return list[0]?.body || null;
    })();

    track('protection.agent.capture_link_generation_started', { has_note: Boolean(latestNote) });

    const synthesized = synthesizeCaptureUrl();
    const opportunityId = opportunity?.id || `op_${synthesized.token.toLowerCase()}`;
    updateOpportunity({
      id: opportunityId,
      contact: { email: contact.email, phone: '+1' + contact.phone, note: latestNote },
      captureLink: { ...synthesized, generatedAt: new Date().toISOString(), sentAt: null },
      status: VSC_STATUS.CAPTURE_LINK_CREATED,
    });
    track('protection.agent.capture_link_created', {
      opportunity_id: opportunityId,
      token: synthesized.token,
    });
    setGenerating(false);
  }

  function onSend() {
    if (!link?.url || isLinkSent) return;
    setSending(true);

    const twilioPayload = {
      to: '+1' + contact.phone,
      body: `Get your protection plan quote: ${link.url}`,
    };
    const mandrillPayload = {
      to: contact.email,
      subject: 'Your protection plan quote from Blinker',
      bodyHtml: `<a href="${link.url}">Tap here to get started</a>`,
    };
    // eslint-disable-next-line no-console
    console.log('[twilio:mock]', twilioPayload);
    // eslint-disable-next-line no-console
    console.log('[mandrill:mock]', mandrillPayload);
    track('protection.agent.capture_link_sent', {
      opportunity_id: opportunity?.id,
      token: link.token,
      channels: ['sms', 'email'],
    });

    const sentAtIso = new Date().toISOString();
    updateOpportunity({
      captureLink: { ...link, sentAt: sentAtIso },
      status: VSC_STATUS.CAPTURE_LINK_SENT,
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
      <ScreenHeader
        icon={Sparkles}
        eyebrow="Agent · Capture Link"
        title="Generate a capture link"
        subtitle="Send the consumer a one-time link to start their protection plan workflow."
      />

      <div className="px-6 pb-2 space-y-4">
        <Field
          label="Consumer email"
          icon={Mail}
          value={contact.email}
          onChange={(v) => updateContact({ email: v })}
          placeholder="name@example.com"
          error={errors.email}
        />
        <PhoneField
          label="Consumer phone"
          value={contact.phone}
          onChange={(v) => updateContact({ phone: v })}
          error={errors.phone}
        />
        <div className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-xs text-slate-600">
          <Phone className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
          <div>
            Once you send the link, the consumer walks the wizard themselves and you'll see
            their progress reflected in the status panel above. You can also "Save and Send"
            mid-flow from any step to hand off in-flight work.
          </div>
        </div>
      </div>

      <div className="px-6 pb-5 pt-4 border-t border-slate-100 mt-4 space-y-3">
        <button
          onClick={onGenerate}
          disabled={generating || !!link}
          className={
            'w-full px-5 py-2 rounded-md font-semibold text-sm flex items-center justify-center gap-2 ' +
            (generating || link
              ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 text-white')
          }
        >
          <Sparkles className="w-4 h-4" />
          {generating ? 'Generating…' : link ? 'Link generated' : 'Generate link'}
        </button>

        {link?.url && (
          <div>
            <div className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wide">Capture URL</div>
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
      </div>
    </div>
  );
}
