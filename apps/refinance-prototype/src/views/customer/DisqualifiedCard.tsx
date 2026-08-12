// DisqualifiedCard — lifted from refinance-v2-prototype.jsx EmbeddedPost
// (around L1640 of the monolith), disqualified branch.
//
// Terminal "you don't qualify, here's why" card the embed shows after a
// prequal decision returns result === 'disqualified'. Surfaces the
// human-readable title + message keyed off the partner-agnostic
// DISQUAL_REASONS dictionary in src/constants/disqual-reasons.js.
//
// The full Stage 2 DisqualifiedCard (with retry-with-coapp affordance,
// suggested-action bullets, agent escalation banner) stays internal in
// src/results/DisqualifiedCard.jsx; this is the slim card
// protection-portal embeds inside its RecommendedCoverage upsell strip.
//
// Consumed by: protection-portal/src/views/customer/RecommendedCoverage.jsx (planned § 1.5d)

import type { FC } from 'react';
import { XCircle } from 'lucide-react';
import { DISQUAL_REASONS } from '../../constants';
import type { Persona, DisqualReason } from '../../types';

/**
 * DisqualifiedCard — embed-friendly "you don't qualify" terminal card.
 *
 * @param {object} props
 * @param {string|null} [props.reason]
 *   A key from DISQUAL_REASONS (e.g. 'under_18', 'vehicle_too_old',
 *   'ltv_too_high'). Same shape `runDecision()` from src/lib/refi.js
 *   returns on its `decision.reason` field. When null/undefined or
 *   unknown, falls back to a generic message.
 * @param {string} [props.partnerName]
 *   Optional partner label. Rendered in the card header subtitle when
 *   present (e.g. 'Savings Group attempted match'). When omitted, only
 *   the generic 'Refinance' eyebrow is shown.
 * @param {() => void} [props.onContinue]
 *   Fires when the consumer clicks the secondary CTA. The parent app
 *   decides what "continue" means (return to its own flow, mark the
 *   prequal complete, etc.).
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
interface DisqualifiedCardProps {
  reason?: DisqualReason | string | null;
  partnerName?: string;
  onContinue?: () => void;
  persona?: Persona;
  personaLocked?: boolean;
}

export const DisqualifiedCard: FC<DisqualifiedCardProps> = ({
  reason,
  partnerName,
  onContinue,
  persona = 'consumer',
  personaLocked = false,
}) => {
  // persona / personaLocked accepted for embed-contract consistency;
  // today the card renders identically for every persona.
  void persona;
  void personaLocked;

  const reasonEntry = reason
    ? (DISQUAL_REASONS as Record<string, { title: string; msg: string } | undefined>)[reason] ?? null
    : null;
  const title = reasonEntry ? reasonEntry.title : "Not eligible to refinance";
  const msg = reasonEntry
    ? reasonEntry.msg
    : "We weren't able to match a refinance partner with the information provided.";

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide">Refinance · Not Eligible</div>
          <div className="font-semibold text-lg">{partnerName || 'Refinance partner'}</div>
        </div>
        <span className="text-xs font-semibold px-2 py-1 rounded border bg-rose-100 text-rose-700 border-rose-200">
          Not Eligible
        </span>
      </div>

      <div className="px-6 py-5">
        <div className="border border-rose-100 bg-rose-50 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-2 text-rose-800 font-semibold">
            <XCircle className="w-4 h-4" /> {title}
          </div>
          <p className="text-sm text-rose-900 mt-1">
            {msg}
          </p>
        </div>

        {onContinue && (
          <button
            onClick={onContinue}
            className="w-full px-3 py-2 border border-slate-200 hover:border-blue-500 hover:text-blue-700 text-slate-700 text-sm rounded-md font-semibold"
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
};
