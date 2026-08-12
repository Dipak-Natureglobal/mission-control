// ContactDedupeCard — shared duplicate / household match card.
//
// Graduated v3.0.15 (ADR 27 D2) from mission-control's AddContactModal
// (SameNameMatchCard + DifferentNameMatchCard). Renders the result of
// `findContactMatch` (packages/utils/contact-identity.js) so any contact-
// capture view can surface the same dedupe / household UX:
//
//   - same-name match     → amber "Existing contact" card with an optional
//                           "Open existing contact" jump button.
//   - different-name match → sky "Phone/email already used by X" card with
//                           the household-relationship picker (spouse /
//                           parent / child / sibling / other).
//
// Pairs with `findContactMatch` + `HOUSEHOLD_RELATIONSHIP_KINDS` from
// packages/utils. Pure presentational — the parent owns the match
// predicate, the picked relationship, and what blocks/allows save.
//
// Consumers: mission-control AddContactModal (tracked follow-up — still on
// its local copies), insurance-portal LeadOriginationForm (v3.0.15).

import { AlertTriangle, ArrowRight, Check } from 'lucide-react';
import { HOUSEHOLD_RELATIONSHIP_KINDS } from '../utils/index.js';

function SameNameMatchCard({ match, onJump, disabled }) {
  const c = match.contact;
  const display = `${c.name?.first ?? ''} ${c.name?.last ?? ''}`.trim();
  const primaryPhone = (c.phones || [])[0]?.number;
  const primaryEmail = (c.emails || [])[0]?.address;
  return (
    <div className="rounded-md p-3 bg-amber-50 ring-1 ring-amber-200 text-amber-900">
      <div className="flex items-start gap-2 mb-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="text-xs leading-relaxed">
          <div className="font-semibold">Existing contact: {display}</div>
          <div className="text-amber-800 mt-0.5">
            Matched on {match.matchedOn}. Edit the existing record instead of
            creating a duplicate.
          </div>
          <div className="text-amber-700 mt-1 font-mono text-[11px]">
            {[primaryPhone, primaryEmail].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>
      {onJump && (
        <button
          type="button"
          onClick={onJump}
          disabled={disabled}
          className={
            'text-xs font-semibold px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 ' +
            (disabled
              ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
              : 'bg-amber-600 hover:bg-amber-700 text-white')
          }
        >
          Open existing contact <ArrowRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function DifferentNameMatchCard({
  match,
  relationship,
  onRelationshipChange,
  showError,
  disabled,
}) {
  const c = match.contact;
  const display = `${c.name?.first ?? ''} ${c.name?.last ?? ''}`.trim();
  return (
    <div className="rounded-md p-3 bg-sky-50 ring-1 ring-sky-200 text-sky-900">
      <div className="flex items-start gap-2 mb-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="text-xs leading-relaxed">
          <div className="font-semibold">
            {match.matchedOn === 'phone+email'
              ? 'Phone + email'
              : match.matchedOn === 'phone'
                ? 'Phone'
                : 'Email'}{' '}
            already used by {display}
          </div>
          <div className="text-sky-800 mt-0.5">
            Different name. Likely a household member — pick the relationship
            and we'll link the new contact.
          </div>
        </div>
      </div>
      <div className="text-[11px] uppercase tracking-wider font-semibold text-sky-700 mb-1.5">
        Relationship to {c.name?.first}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {HOUSEHOLD_RELATIONSHIP_KINDS.map((kind) => {
          const active = relationship === kind.value;
          return (
            <button
              key={kind.value}
              type="button"
              onClick={() => onRelationshipChange?.(kind.value)}
              disabled={disabled}
              className={
                'text-left text-xs px-2.5 py-1.5 rounded-md ring-1 transition-colors ' +
                (active
                  ? 'bg-sky-600 text-white ring-sky-700'
                  : disabled
                    ? 'bg-slate-100 text-slate-400 ring-slate-200 cursor-not-allowed'
                    : 'bg-white text-sky-900 ring-sky-200 hover:ring-sky-400')
              }
            >
              {active && <Check className="inline w-3 h-3 mr-1 -mt-0.5" />}
              {kind.label}
            </button>
          );
        })}
      </div>
      {showError && (
        <div className="text-[11px] text-rose-600 mt-2">
          Pick a relationship to save (or change phone/email so it's not a match).
        </div>
      )}
    </div>
  );
}

/**
 * ContactDedupeCard
 *
 * Drop-in card for the result of `findContactMatch`. Renders nothing when
 * `match` is null. Branches internally on `match.sameName`.
 *
 * @param {object}   props
 * @param {object|null} props.match  findContactMatch result —
 *                                   { contact, matchedOn, sameName } | null.
 * @param {function} [props.onJump]  Same-name only — fired when the agent
 *                                   chooses to open the existing contact.
 *                                   When omitted, no jump button renders.
 * @param {string}   [props.relationship]        Different-name only — the
 *                                   currently picked relationship value.
 * @param {function} [props.onRelationshipChange] Different-name only —
 *                                   fired with the picked relationship value.
 * @param {boolean}  [props.showError=false]  Different-name only — show the
 *                                   "pick a relationship" inline error.
 * @param {boolean}  [props.disabled=false]    Disable all interactive
 *                                   affordances (read-only state).
 * @param {string}   [props.persona='agent']   Persona context (forward-compat).
 * @param {boolean}  [props.personaLocked=false] Persona switcher lock (forward-compat).
 */
export function ContactDedupeCard({
  match,
  onJump,
  relationship,
  onRelationshipChange,
  showError = false,
  disabled = false,
  // eslint-disable-next-line no-unused-vars
  persona = 'agent',
  // eslint-disable-next-line no-unused-vars
  personaLocked = false,
}) {
  if (!match) return null;
  if (match.sameName) {
    return <SameNameMatchCard match={match} onJump={onJump} disabled={disabled} />;
  }
  return (
    <DifferentNameMatchCard
      match={match}
      relationship={relationship}
      onRelationshipChange={onRelationshipChange}
      showError={showError}
      disabled={disabled}
    />
  );
}
