// Customer view · Step 3 — Vehicle Use.
//
// Spec gap: refi-prototype has no VehicleUse screen (refi jumps from
// VehicleDrive into ownership/credit). Building from CLAUDE.md +
// README.md spec only:
//   "Vehicle Use (Personal / Rideshare / Commercial → flips BUSINESS USE
//    add-on)"
// The legacy walkthrough screens (BlinkerLegacy/.../screens/05-) confirm
// "BUSINESS USE option" exists on the StoneEagle GetRates add-ons list,
// so picking Rideshare or Commercial here marks that add-on as required
// on form.requiredAddOns. RecommendedCoverage will surface it.
//
// Three options, single-select, big tappable cards. Personal is the
// default — and the most common — so it's pre-selected and noted as such.
import { useEffect, useRef } from 'react';
import { Briefcase, Car, Users } from 'lucide-react';
import { ScreenHeader, WizardFooter } from 'blinker-platform/components';
import { track } from 'blinker-platform/telemetry';

const USE_OPTIONS = [
  {
    id: 'personal',
    label: 'Personal',
    icon: Car,
    description: 'Daily driver, commuting, errands, road trips.',
  },
  {
    id: 'rideshare',
    label: 'Rideshare',
    icon: Users,
    description: 'Uber, Lyft, or other rideshare driving — full or part time.',
    requiresBusinessUse: true,
  },
  {
    id: 'commercial',
    label: 'Commercial',
    icon: Briefcase,
    description: 'Delivery, fleet, contractor, or business-registered use.',
    requiresBusinessUse: true,
  },
];

export function VehicleUse({ form, update, onNext }) {
  const viewedRef = useRef(false);
  const ok = !!form.use;

  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    track('protection.customer.vehicle_use.viewed');
  }, []);

  function pick(option) {
    // Wave 22 Task 1 — also write `requiredAddOns`, the canonical list of
    // canon `add_on_passthrough` keys the wizard has flagged for cost
    // passthrough on the coverage cards. Rideshare/commercial flips
    // 'business_use' on; personal removes it while preserving any other
    // entries Modifications writes (enhanced_electronics / navigation).
    const prevAddOns = Array.isArray(form.requiredAddOns) ? form.requiredAddOns : [];
    let nextAddOns;
    let attached = false;
    if (option.requiresBusinessUse) {
      attached = !prevAddOns.includes('business_use');
      nextAddOns = prevAddOns.includes('business_use') ? prevAddOns : [...prevAddOns, 'business_use'];
    } else {
      nextAddOns = prevAddOns.filter((k) => k !== 'business_use');
    }

    update({
      use: option.id,
      requiresBusinessUse: !!option.requiresBusinessUse,
      requiredAddOns: nextAddOns,
    });
    track('protection.customer.vehicle_use.selected', {
      use: option.id,
      requires_business_use: !!option.requiresBusinessUse,
    });
    if (attached) {
      track('protection.customer.vehicle_use.add_on_attached', {
        add_on_key: 'business_use',
      });
    }
  }

  function handleNext() {
    track('protection.customer.vehicle_use.continued', {
      use: form.use,
      requires_business_use: !!form.requiresBusinessUse,
    });
    onNext();
  }

  return (
    <>
      <ScreenHeader
        icon={Car}
        eyebrow="Vehicle · Use"
        title="How do you use your vehicle?"
        subtitle="Personal use is most common. Rideshare and commercial use require a Business Use add-on, which we'll surface on your coverage options."
      />
      <div className="px-6 space-y-3">
        {USE_OPTIONS.map((option) => {
          const Icon = option.icon;
          const active = form.use === option.id;
          return (
            <button
              key={option.id}
              onClick={() => pick(option)}
              className={
                'w-full text-left px-4 py-3 rounded-md border flex items-start gap-3 ' +
                (active
                  ? 'border-blue-600 bg-blue-50'
                  : 'border-slate-200 hover:border-slate-300 bg-white')
              }
            >
              <Icon className={'w-5 h-5 mt-0.5 ' + (active ? 'text-blue-600' : 'text-slate-400')} />
              <div className="flex-1">
                <div className={'text-sm font-semibold ' + (active ? 'text-blue-700' : 'text-slate-900')}>
                  {option.label}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">{option.description}</div>
                {option.requiresBusinessUse && (
                  <div className="text-[11px] text-amber-700 mt-1">
                    Adds Business Use coverage to your plan.
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <WizardFooter onNext={handleNext} disabled={!ok} nextLabel="Continue" />
    </>
  );
}
