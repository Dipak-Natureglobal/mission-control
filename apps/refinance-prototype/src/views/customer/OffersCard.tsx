// OffersCard — lifted from refinance-v2-prototype.jsx EmbeddedPost
// (around L1640 of the monolith), offers_returned branch.
//
// Renders the lender offers returned by Savings Group / partner. Today
// it surfaces the embed-friendly compact card variant: best offer +
// "View all offers" affordance + per-offer (rate / term / monthly).
// The full Stage 2 OffersCard (with insurance savings + selected-state)
// stays internal in src/results/OffersCard.jsx (not exported); this is
// the slim card protection-portal embeds inside its
// RecommendedCoverage upsell strip.
//
// Consumed by: protection-portal/src/views/customer/RecommendedCoverage.jsx (planned § 1.5d)

import type { FC } from 'react';
import { Sparkles, Phone } from 'lucide-react';
import type { RefiOffer, Persona } from '../../types';

/**
 * OffersCard — embed-friendly best-offer card with per-offer rows.
 *
 * @param {object} props
 * @param {Array<{id: string, lender: string, apr: number, term: number, monthly: number, savings?: number, disclaimer?: string}>} props.offers
 *   Array of lender offers. Use `MOCK_OFFERS` from
 *   src/constants/mock-data.js as fixture data when testing.
 * @param {(offer: object) => void} [props.onSelect]
 *   Fires when a row is clicked. Receives the full offer object.
 * @param {string} [props.partnerName]   - Optional partner label
 *   (e.g. 'Savings Group'). Rendered in the card header.
 * @param {string} [props.partnerPhone]  - Optional partner phone (E.164
 *   or display format). When present, rendered as a tel: link.
 * @param {'super_admin'|'admin'|'manager'|'agent'|'consumer'} [props.persona='consumer']
 *   Drives copy variants downstream. Today the card renders identically
 *   for every persona; the prop is accepted to keep the embed contract
 *   forward-compatible.
 * @param {boolean} [props.personaLocked=false]
 *   Whether the parent owns the persona switcher. Informational here.
 *
 * @returns {JSX.Element|null} Returns null when `offers` is empty so
 *   parents can render unconditionally without ternaries.
 *
 * Consumed by: protection-portal/src/views/customer/RecommendedCoverage.jsx (planned § 1.5d)
 */
interface OffersCardProps {
  offers?: RefiOffer[];
  onSelect?: (offer: RefiOffer) => void;
  partnerName?: string;
  partnerPhone?: string;
  persona?: Persona;
  personaLocked?: boolean;
}

export const OffersCard: FC<OffersCardProps> = ({
  offers,
  onSelect,
  partnerName,
  partnerPhone,
  persona = 'consumer',
  personaLocked = false,
}) => {
  // persona / personaLocked accepted for embed-contract consistency;
  // today the card renders identically for every persona.
  void persona;
  void personaLocked;
  if (!offers || offers.length === 0) return null;
  const bestOffer = offers[0];

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide">Refinance · Offers</div>
          <div className="font-semibold text-lg">{partnerName || 'Refinance partner'}</div>
        </div>
        <span className="text-xs font-semibold px-2 py-1 rounded border bg-blue-100 text-blue-700 border-blue-200">
          Offers Returned
        </span>
      </div>
      <div className="px-6 py-5">
        <div className="border border-blue-100 bg-blue-50 rounded-lg p-4 mb-3">
          <div className="text-xs text-blue-700 uppercase tracking-wide font-semibold mb-1">Best offer</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-blue-900">${bestOffer.monthly}</span>
            <span className="text-sm text-blue-700">/mo</span>
          </div>
          <div className="text-sm text-blue-900 mt-1">
            {bestOffer.lender} · {bestOffer.apr}% APR · {bestOffer.term} mo
          </div>
          {(bestOffer.savings ?? 0) > 0 && (
            <div className="text-xs text-emerald-700 mt-1 flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Est. savings ${bestOffer.savings}/mo
            </div>
          )}
        </div>

        <div className="space-y-2">
          {offers.map((o) => (
            <button
              key={o.id}
              onClick={() => onSelect?.(o)}
              className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-blue-500 hover:bg-blue-50 transition flex items-center justify-between"
            >
              <div>
                <div className="font-semibold text-sm">{o.lender}</div>
                <div className="text-xs text-slate-500">{o.apr}% APR · {o.term} months</div>
              </div>
              <div className="text-right">
                <div className="text-base font-bold text-slate-800">${o.monthly}<span className="text-xs text-slate-500">/mo</span></div>
                {(o.savings ?? 0) > 0 && (
                  <div className="text-xs text-emerald-700 flex items-center gap-1 justify-end">
                    <Sparkles className="w-3 h-3" /> save ${o.savings}/mo
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>

        {partnerPhone && (
          <a
            href={'tel:' + String(partnerPhone).replace(/[^0-9]/g, '')}
            className="mt-4 w-full px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-md flex items-center justify-center gap-2 font-semibold"
          >
            <Phone className="w-4 h-4" /> Call {partnerPhone}
          </a>
        )}
      </div>
    </div>
  );
};
