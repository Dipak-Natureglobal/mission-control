// The pre-wizard gate. An opportunity at status 'Empty' has no quote yet, so
// there is nothing for the wizard to render — the agent's first move is to
// mint the consumer capture link (or start the quote themselves).
//
// Phase 1 synthesizes the link client-side and mocks the send. Phase 2
// replaces `mintLink` with the real opportunity-create call, which is the only
// function in this file that changes.
import { useState } from 'react';
import { Link2, Send, Play, CheckCircle2 } from 'lucide-react';
import { Field, PhoneField } from 'blinker-platform/components';
import { toNationalPhoneDigits } from 'blinker-platform/utils';
import { track } from 'blinker-platform/telemetry';

function mintLink(opportunityId) {
  const token =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  const base = typeof window !== 'undefined' ? window.location.origin : 'https://home.blinker.com';
  return {
    token,
    url: `${base}/?view=customer&t=${token}${opportunityId ? `&opp=${opportunityId}` : ''}`,
    created_at: new Date().toISOString(),
  };
}

export function CaptureLinkForm({ opportunity, updateOpportunity, contact, onStartHere }) {
  const [phone, setPhone] = useState(toNationalPhoneDigits(contact?.phones?.[0]?.number) || '');
  const [email, setEmail] = useState(contact?.emails?.[0]?.address || '');
  const link = opportunity?.captureLink || null;

  function handleGenerate() {
    const captureLink = mintLink(opportunity?.id);
    updateOpportunity({ captureLink });
    track('home_protection.agent.capture_link_generated', { opportunity_id: opportunity?.id });
  }

  function handleSend() {
    if (!link?.url) return;
    // Phase 1 mock — Phase 2 swaps these for the real notification calls.
    console.log('[twilio:mock]', { to: phone || null, body: `Start your home protection quote: ${link.url}` });
    console.log('[mandrill:mock]', { to: email || null, subject: 'Your home protection quote' });
    updateOpportunity({ sentSummary: { at: new Date().toISOString(), step: 'capture_link' } });
    track('home_protection.agent.capture_link_sent', {
      opportunity_id: opportunity?.id,
      has_phone: !!phone,
      has_email: !!email,
    });
  }

  function handleStartHere() {
    // Moving off 'Empty' is what opens the wizard — see AgentView's showWizard
    // gate. The agent quotes on the consumer's behalf from here.
    //
    // AgentView owns stepIdx/setStepIdx and pins the wizard to step 0
    // (home_add) via `onStartHere` — deliberately NOT just setting status
    // and letting the status→step resume map place the agent, which used to
    // land a brand-new opportunity on step 3 (recommended_coverage) with no
    // home ever added. `onStartHere` is optional so this component still
    // degrades sensibly if ever rendered without it.
    if (typeof onStartHere === 'function') {
      onStartHere();
    } else {
      updateOpportunity({ status: 'Quoted' });
    }
    track('home_protection.agent.quote_started_in_shell', { opportunity_id: opportunity?.id });
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
        <Link2 className="w-4 h-4 text-slate-500" />
        <span className="text-xs uppercase tracking-wide font-semibold text-slate-600">
          Start a home protection quote
        </span>
      </div>
      <div className="px-4 py-4 space-y-4">
        <p className="text-sm text-slate-600">
          This opportunity has no quote yet. Send the consumer a link to fill it in
          themselves, or start the quote here and walk them through it.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <PhoneField label="Consumer phone" value={phone} onChange={setPhone} />
          <Field label="Consumer email" value={email} onChange={setEmail} placeholder="you@example.com" inputMode="email" />
        </div>

        {link ? (
          <div className="border border-slate-200 rounded-md px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-1">
              Capture link
            </div>
            <div className="text-xs font-mono text-slate-700 break-all">{link.url}</div>
            {opportunity?.sentSummary && (
              <div className="text-[11px] text-emerald-600 flex items-center gap-1 mt-1">
                <CheckCircle2 className="w-3 h-3" /> Sent at{' '}
                {new Date(opportunity.sentSummary.at).toTimeString().slice(0, 8)}
              </div>
            )}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleGenerate}
            className="text-xs font-semibold px-3 py-2 rounded-md border border-slate-200 text-slate-700 hover:border-blue-500 hover:text-blue-700 flex items-center gap-1.5"
          >
            <Link2 className="w-3 h-3" /> {link ? 'Regenerate link' : 'Generate link'}
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!link}
            className={
              'text-xs font-semibold px-3 py-2 rounded-md flex items-center gap-1.5 ' +
              (link ? 'bg-slate-800 hover:bg-slate-700 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed')
            }
          >
            <Send className="w-3 h-3" /> Send to consumer
          </button>
          <button
            type="button"
            onClick={handleStartHere}
            className="ml-auto text-xs font-semibold px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5"
          >
            <Play className="w-3 h-3" /> Start the quote here
          </button>
        </div>
      </div>
    </div>
  );
}
