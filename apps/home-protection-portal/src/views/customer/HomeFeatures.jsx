// Customer view · Step 2 — Home features.
//
// Twelve yes/no questions: "does this home have a pool / a well / a septic
// system / a second refrigerator…". The answers write booleans into
// `form.homeFeatures`, keyed by the canonical add-on category key.
//
// WHY THIS IS A SEPARATE, EARLIER STEP (ADR 30 D6)
// -----------------------------------------------
// This mirrors how auto works today: Modifications and Vehicle use ask
// higher-level questions that map to add-ons rather than presenting a raw
// priced catalog. Those answers then pre-check the priced picker on
// optional_coverages, which the consumer can still override in either
// direction.
//
// It also has to run before rating, because it costs nothing to ask and
// carries no plan dependency — whereas an add-on's OptionId and price both
// depend on the plan code AND the selected term, neither of which exists
// yet at this point in the wizard.
//
// The list is rendered from canon plan-mappings.json#home_add_ons.categories
// and is NEVER hard-coded — changing the covered categories is a canon edit.
// The visual grouping below is cosmetic; if canon adds a category that is
// not in a named group, it lands in "Other systems" rather than vanishing.
import { useEffect, useMemo, useRef } from 'react';
import { ClipboardList, Check } from 'lucide-react';
import { ScreenHeader, WizardFooter } from 'blinker-platform/components';
import { track } from 'blinker-platform/telemetry';
import planMappings from '../../constants/canon/plan-mappings.json' with { type: 'json' };

const CATEGORIES = planMappings.home_add_ons?.categories || [];

// Presentation-only grouping. Data stays flat — `form.homeFeatures` is a
// single map of key → boolean regardless of how the questions are grouped
// on screen.
const GROUPS = [
  { id: 'kitchen', label: 'Kitchen & appliances', keys: ['ice_maker', 'secondary_refrigerator', 'freestanding_freezer', 'wine_cooler'] },
  { id: 'outdoor', label: 'Outdoor', keys: ['swimming_pool', 'spa', 'well_pump', 'septic'] },
  { id: 'systems', label: 'Systems & mechanical', keys: ['additional_ac', 'internal_plumbing', 'programmable_thermostat', 'garage_door_opener'] },
];

function buildGroups() {
  const claimed = new Set(GROUPS.flatMap((g) => g.keys));
  const byKey = new Map(CATEGORIES.map((c) => [c.key, c]));
  const groups = GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    categories: g.keys.map((k) => byKey.get(k)).filter(Boolean),
  })).filter((g) => g.categories.length > 0);

  const leftovers = CATEGORIES.filter((c) => !claimed.has(c.key));
  if (leftovers.length > 0) {
    groups.push({ id: 'other', label: 'Other systems', categories: leftovers });
  }
  return groups;
}

export function HomeFeatures({ form, update, onNext, persona = 'consumer' }) {
  const features = form.homeFeatures || {};
  const groups = useMemo(() => buildGroups(), []);
  const viewedRef = useRef(false);

  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    track('home_protection.customer.home_features.viewed', {
      category_count: CATEGORIES.length,
      persona,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(key) {
    const next = { ...features, [key]: !features[key] };
    update({ homeFeatures: next });
    track('home_protection.customer.home_features.toggled', {
      key,
      value: !!next[key],
      persona,
    });
  }

  const answeredCount = CATEGORIES.filter((c) => features[c.key] === true).length;

  function handleNext() {
    // Nothing here is required — a consumer who skips the whole screen just
    // starts optional_coverages with nothing pre-checked.
    track('home_protection.customer.home_features.answered', {
      yes_count: answeredCount,
      category_count: CATEGORIES.length,
      persona,
    });
    onNext();
  }

  return (
    <>
      <ScreenHeader
        icon={ClipboardList}
        eyebrow="Home · Features"
        title="What does this home have?"
        subtitle="Tick anything the property has. We'll use it to suggest optional coverages later — nothing here is a purchase, and you can change your mind."
      />

      <div className="px-6 space-y-4">
        {groups.map((group) => (
          <div key={group.id} className="border border-slate-200 rounded-md overflow-hidden">
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-100">
              <span className="text-xs uppercase tracking-wide font-semibold text-slate-600">
                {group.label}
              </span>
            </div>
            <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {group.categories.map((cat) => (
                <FeatureToggle
                  key={cat.key}
                  label={cat.label}
                  checked={features[cat.key] === true}
                  onToggle={() => toggle(cat.key)}
                />
              ))}
            </div>
          </div>
        ))}

        <div className="text-[11px] text-slate-500">
          {answeredCount === 0
            ? 'Nothing selected — that’s fine. You can still add optional coverages later.'
            : `${answeredCount} of ${CATEGORIES.length} selected. These will be pre-checked on the optional coverages step.`}
        </div>
      </div>

      {/* Continue is always enabled — none of these questions are required. */}
      <WizardFooter onNext={handleNext} nextLabel="Continue" />
    </>
  );
}

function FeatureToggle({ label, checked, onToggle }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className={
        'flex items-center gap-2 px-3 py-2 rounded-md border text-left text-sm transition-colors ' +
        (checked
          ? 'border-blue-600 bg-blue-50 text-slate-900 font-medium'
          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300')
      }
    >
      <span
        className={
          'w-4 h-4 rounded border flex items-center justify-center shrink-0 ' +
          (checked ? 'bg-blue-600 border-blue-600' : 'bg-white border-slate-300')
        }
      >
        {checked && <Check className="w-3 h-3 text-white" />}
      </span>
      {label}
    </button>
  );
}
