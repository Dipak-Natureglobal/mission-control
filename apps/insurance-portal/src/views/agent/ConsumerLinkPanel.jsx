// ConsumerLinkPanel — read-only display of the EI consumer link with a
// copy-to-clipboard affordance + "Sent at" timestamp. Rendered below
// the LeadStatusTimeline post-send (Wave 13c layout swap), where the
// LeadOriginationForm — which previously hosted this same UI inline —
// is no longer mounted.
//
// Pre-send the link UI still lives inside LeadOriginationForm, because
// the form is the affordance for generating + sending. Once the link is
// sent, AgentView swaps the form out for ConsumerLinkPanel + the
// timeline so the agent retains a way to re-share the URL while
// watching webhook progress.
import { useState } from 'react';
import { Copy } from 'lucide-react';

function fmtTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toTimeString().slice(0, 8);
}

export function ConsumerLinkPanel({ link }) {
  const [copyFlash, setCopyFlash] = useState(false);
  const url = link?.url;
  if (!url) return null;

  function onCopy() {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopyFlash(true);
      setTimeout(() => setCopyFlash(false), 1200);
    });
  }

  const sentAt = fmtTime(link?.sentAt);

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-blue-600 font-semibold">
            Consumer link
          </div>
          <h3 className="text-sm font-semibold tracking-tight text-slate-900">
            EI microsite (sent via SMS + email)
          </h3>
        </div>
        {sentAt && (
          <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 font-semibold">
            Sent at {sentAt}
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
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
  );
}
