// QualifiedCard — lifted from refinance-v2-prototype.jsx EmbeddedPost
// (around L1640 of the monolith), pre_approved branch.
//
// The terminal "you're qualified, here's what next" card the embed
// shows after a successful prequal where the partner pre-approves
// without an offer-shopping step (Gravity flow). Includes the
// partner-handoff phone number and an externalApplicationId reference
// the consumer can repeat back when a loan specialist calls.
//
// The full Stage 2 QualifiedHandoff (with warm-transfer banner +
// why-qualified bullets + 3-channel handoff grid) stays internal in
// src/results/QualifiedHandoff.jsx; this is the slim card
// protection-portal embeds inside its RecommendedCoverage upsell strip.
//
// Consumed by: protection-portal/src/views/customer/RecommendedCoverage.jsx (planned § 1.5d)

import type { FC } from 'react';
import { CheckCircle2, Phone } from 'lucide-react';
import type { Persona } from '../../types';

interface QualifiedCardProps {
  partnerName?: string;
  partnerPhone?: string;
  externalApplicationId?: string;
  onContinue?: () => void;
  persona?: Persona;
  personaLocked?: boolean;
}

export const QualifiedCard: FC<QualifiedCardProps> = ({
  partnerName = 'our refinance partner',
  partnerPhone,
  externalApplicationId,
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
          <div className="text-xs text-slate-500 uppercase tracking-wide">Refinance · Pre-Approved</div>
          <div className="font-semibold text-lg">{partnerName}</div>
          {externalApplicationId && (
            <div className="text-xs text-slate-400 font-mono mt-0.5">#{externalApplicationId}</div>
          )}
        </div>
        <span className="text-xs font-semibold px-2 py-1 rounded border bg-emerald-100 text-emerald-700 border-emerald-200">
          Pre-Approved
        </span>
      </div>

      <div className="px-6 py-5">
        <div className="border border-emerald-100 bg-emerald-50 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-2 text-emerald-800 font-semibold">
            <CheckCircle2 className="w-4 h-4" /> You're pre-approved
          </div>
          <p className="text-sm text-emerald-900 mt-1">
            A loan specialist at {partnerName} will finalize the rate, term, and documents
            with you by phone. Reference{' '}
            {externalApplicationId ? (
              <span className="font-mono font-semibold">#{externalApplicationId}</span>
            ) : (
              'your application'
            )}{' '}
            so they pick up where you left off.
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
