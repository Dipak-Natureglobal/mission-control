// Customer view · Step 4 — Modifications.
//
// Spec gap: refi-prototype has no Modifications screen, and the legacy
// walkthrough doesn't cover this either. Building from CLAUDE.md +
// README.md spec:
//   "Modifications (Lifted / Lowered / Bigger Wheels / Salvage / Engine
//    — flag for agent review, no rate effect today)"
// So this is a multi-select. Selections do not change StoneEagle pricing
// today — they are surfaced on form.modifications and form.flagAgentReview
// for the agent view to triage.
//
// Canon copy is not yet defined for this screen — when it lands in
// blinker-platform/canon/, the option list and the help text should
// move there. Current option list and copy are placeholder.
import { useEffect, useRef } from 'react';
import { Wrench, Check } from 'lucide-react';
import { ScreenHeader, WizardFooter } from 'blinker-platform/components';
import { track } from 'blinker-platform/telemetry';

// Wave 22 Task 4 — first two are "feature" mods that map to canonical
// add_on_passthrough keys (`enhanced_electronics`, `navigation`); when
// toggled ON, packages/utils/protection-addons.js matches them against the
// StoneEagle response add-ons (EEP-Enhanced Electronics Package /
// NAV - EXL option / NAV -Used option) and adds the cost without markup
// to coverage-card pricing. The remaining options are alteration flags
// for agent review only — no rate effect today.
const MODIFICATION_OPTIONS = [
  { id: 'enhanced_electronics', label: 'Enhanced Electronics' },
  { id: 'navigation',           label: 'Navigation' },
  { id: 'lifted',               label: 'Lifted suspension' },
  { id: 'lowered',              label: 'Lowered suspension' },
  { id: 'bigger_wheels',        label: 'Bigger wheels or oversized tires' },
  { id: 'salvage',              label: 'Salvage or rebuilt title' },
  { id: 'engine',               label: 'Engine modifications (tune, turbo, etc.)' },
];

const PASSTHROUGH_OPTION_IDS = new Set(['enhanced_electronics', 'navigation']);

export function Modifications({ form, update, onNext }) {
  const viewedRef = useRef(false);
  const selected = form.modifications || [];

  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    track('protection.customer.modifications.viewed');
  }, []);

  function toggle(id) {
    const wasOn = selected.includes(id);
    const next = wasOn
      ? selected.filter((x) => x !== id)
      : [...selected, id];
    // flagAgentReview is now driven by alteration mods only — the two
    // passthrough features (Enhanced Electronics / Navigation) are
    // priced as add-ons, not flagged for review.
    const reviewableSelected = next.filter((x) => !PASSTHROUGH_OPTION_IDS.has(x));
    update({
      modifications: next,
      flagAgentReview: reviewableSelected.length > 0,
    });
    track('protection.customer.modifications.toggled', {
      id,
      added: !wasOn,
      count: next.length,
    });
    if (!wasOn && PASSTHROUGH_OPTION_IDS.has(id)) {
      track('protection.customer.modifications.add_on_attached', {
        add_on_key: id,
      });
    }
  }

  function handleNext() {
    track('protection.customer.modifications.continued', {
      modifications: selected,
      flag_agent_review: selected.length > 0,
    });
    onNext();
  }

  return (
    <>
      <ScreenHeader
        icon={Wrench}
        eyebrow="Vehicle · Modifications"
        title="Anything modified or non-standard?"
        subtitle="Pick anything that applies. Some features (like Enhanced Electronics or Navigation) may add to your coverage cost; the rest help us flag your package for an agent review so coverage stays valid."
      />
      <div className="px-6 space-y-2">
        {MODIFICATION_OPTIONS.map((option) => {
          const active = selected.includes(option.id);
          return (
            <button
              key={option.id}
              onClick={() => toggle(option.id)}
              className={
                'w-full text-left px-4 py-3 rounded-md border flex items-center justify-between ' +
                (active
                  ? 'border-blue-600 bg-blue-50'
                  : 'border-slate-200 hover:border-slate-300 bg-white')
              }
            >
              <span className={'text-sm ' + (active ? 'text-blue-700 font-semibold' : 'text-slate-900')}>
                {option.label}
              </span>
              <span
                className={
                  'w-5 h-5 rounded border flex items-center justify-center ' +
                  (active ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 text-transparent')
                }
              >
                <Check className="w-3 h-3" />
              </span>
            </button>
          );
        })}

        <button
          onClick={() => {
            update({ modifications: [], flagAgentReview: false });
            track('protection.customer.modifications.cleared');
          }}
          className="text-xs text-slate-500 hover:text-slate-700 mt-2"
        >
          None of these apply
        </button>
      </div>

      <WizardFooter onNext={handleNext} nextLabel="Continue" />
    </>
  );
}
