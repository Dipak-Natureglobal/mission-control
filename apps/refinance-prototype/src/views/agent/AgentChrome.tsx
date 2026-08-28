// Agent chrome — sticky Save and Send footer.
//
// The sticky Save and Send footer mocks Twilio + Mandrill payloads with
// a deep-link to the current refi step (?step=<stepKey>) and emits
// refi.agent.save_and_send.
import type { FC } from 'react';
import { Save, Send, CheckCircle2 } from 'lucide-react';
import { track } from 'blinker-platform/telemetry';
import type { Opportunity, SentSummary } from '../../types';

// Sticky Save and Send footer — visible on every wizard step (caller
// controls visibility — AgentView only mounts this once the capture link
// exists). Synthesizes a deep-link URL with ?step=<currentStepKey> so the
// agent can hand off mid-flow; mocks Twilio + Mandrill console payloads.
interface SaveAndSendFooterProps {
  opportunity: Opportunity | null;
  currentStepKey: string;
  sentSummary?: SentSummary | null;
  onSent?: (summary: SentSummary) => void;
}

export const SaveAndSendFooter: FC<SaveAndSendFooterProps> = ({ opportunity, currentStepKey, sentSummary, onSent }) => {
  function onClick(): void {
    if (!opportunity?.captureLink?.url) return;
    const deepLink = `${opportunity.captureLink.url}&step=${currentStepKey}`;
    const twilioPayload = {
      to: opportunity?.contact?.phone || null,
      body: `Pick up where we left off on your refi: ${deepLink}`,
    };
    const mandrillPayload = {
      to: opportunity?.contact?.email || null,
      subject: 'Continue your auto refinance application',
      bodyHtml: `<a href="${deepLink}">Tap here to continue</a>`,
    };
     
    console.log('[twilio:mock]', twilioPayload);
     
    console.log('[mandrill:mock]', mandrillPayload);
    track('refi.agent.save_and_send', {
      opportunity_id: opportunity?.id,
      from_step: currentStepKey,
      deep_link: deepLink,
    });
    onSent?.({ at: new Date().toISOString(), step: currentStepKey });
  }

  const disabled = !opportunity?.captureLink?.url;

  return (
    <div className="mt-4 bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Save className="w-4 h-4 text-slate-400" />
        <span>
          Save the in-flight opportunity and re-send the consumer link with a deep-link to{' '}
          <span className="font-semibold text-slate-700">{currentStepKey}</span>.
        </span>
        {sentSummary && (
          <span className="ml-2 text-emerald-600 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Sent at {new Date(sentSummary.at).toTimeString().slice(0, 8)}
          </span>
        )}
      </div>
      <button
        onClick={onClick}
        disabled={disabled}
        title={disabled ? 'Generate and send the capture link first.' : undefined}
        className={
          'text-xs font-semibold px-4 py-2 rounded-md flex items-center gap-1.5 ' +
          (disabled
            ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-700 text-white')
        }
      >
        <Send className="w-3 h-3" />
        Save and Send
      </button>
    </div>
  );
};
