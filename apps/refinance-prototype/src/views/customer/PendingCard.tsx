// PendingCard — lifted from refinance-v2-prototype.jsx EmbeddedPost
// (around L1640 of the monolith), pending branch.
//
// "We're still processing your application" card shown when the prequal
// decision returns result === 'pending' — typically because the matched
// partner runs an async submit (Gravity warm transfer, manual review)
// rather than returning offers synchronously.
//
// The full Stage 2 PendingCard (with polling indicator, ETA copy,
// SMS-on-ready opt-in) stays internal; this is the slim card
// protection-portal embeds inside its RecommendedCoverage upsell strip.
//
// Consumed by: protection-portal/src/views/customer/RecommendedCoverage.jsx (planned § 1.5d)

import type { FC } from 'react';
import { Loader2, Phone } from 'lucide-react';
import type { Persona } from '../../types';

/**
 * PendingCard — embed-friendly "awaiting partner response" card.
 *
 * @param {object} props
 * @param {string} [props.partnerName='our refinance partner']
 *   Display name of the matched partner (e.g. 'Gravity Lending').
 * @param {string} [props.partnerPhone]
 *   Partner phone in E.164 or display format. When present, rendered
 *   as a tel: link with the digits stripped for dialing — gives the
 *   consumer an escape hatch while the async submit churns.
 * @param {() => void} [props.onContinue]
 *   Fires when the consumer clicks the secondary CTA. The parent app
 *   decides what "continue" means (return to its own flow, dismiss
 *   the card, etc.).
 * @param {'super_admin'|'admin'|'manager'|'agent'|'consumer'} [props.persona='consumer']
 *   Drives copy variants downstream. Today the card renders identically
 *   for every persona; the prop is accepted to keep the embed contract
 *   forward-compatible.
 * @param {boolean} [props.personaLocked=false]
 *   Whether the parent owns the persona switcher. Informational here.
 *
 * @returns {JSX.Element}
 *
 * Consumed by: protection-portal/src/views/customer/RecommendedCoverage.jsx (planned § 1.5d)
 */
interface PendingCardProps {
  partnerName?: string;
  partnerPhone?: string;
  onContinue?: () => void;
  persona?: Persona;
  personaLocked?: boolean;
}

export const PendingCard: FC<PendingCardProps> = ({
  partnerName = 'our refinance partner',
  partnerPhone,
  onContinue,
  persona = 'consumer',
  personaLocked = false,
}) => {
  // persona / personaLocked accepted for embed-contract consistency;
  // today the card renders identically for every persona.
  void persona;
  void personaLocked;

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide">Refinance · Pending</div>
          <div className="font-semibold text-lg">{partnerName}</div>
        </div>
        <span className="text-xs font-semibold px-2 py-1 rounded border bg-amber-100 text-amber-700 border-amber-200">
          Pending
        </span>
      </div>

      <div className="px-6 py-5">
        <div className="border border-amber-100 bg-amber-50 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-2 text-amber-800 font-semibold">
            <Loader2 className="w-4 h-4 animate-spin" /> Awaiting partner response
          </div>
          <p className="text-sm text-amber-900 mt-1">
            We'll update this card automatically once {partnerName} returns a decision.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          {partnerPhone && (
            <a
              href={'tel:' + String(partnerPhone).replace(/[^0-9]/g, '')}
              className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-md flex items-center justify-center gap-2 font-semibold"
            >
              <Phone className="w-4 h-4" /> Call {partnerPhone}
            </a>
          )}
          {onContinue && (
            <button
              onClick={onContinue}
              className="flex-1 px-3 py-2 border border-slate-200 hover:border-blue-500 hover:text-blue-700 text-slate-700 text-sm rounded-md font-semibold"
            >
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
