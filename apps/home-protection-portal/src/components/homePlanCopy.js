// Per-tier public copy for the home plan cards.
//
// Lives in its own module so PlanCard.jsx exports only components and Vite
// Fast Refresh stays happy (react-refresh/only-export-components).
//
// WHY THIS ISN'T READ FROM canon plan_level_defaults
// --------------------------------------------------
// resolvePlanPresentation() falls back to canon's plan_level_defaults for
// tagline / coverage copy, and those defaults are written for the AUTO
// product line — "Core powertrain coverage for budget-minded peace of mind",
// "Powertrain Plus", "exclusionary". A home warranty has no powertrain and
// nothing is exclusionary. Rendering that fallback on a home card would be
// wrong-but-believable copy in front of a paying consumer.
//
// So: when the resolver's tagline came from an org_override or a catalog
// entry, someone deliberately authored it and it wins. When it came from the
// auto level_default, we use the strings below instead.
//
// CANON GAP (Wave 39): the six home plan_catalog entries carry
// plan_coverage_html: null and covered_components: null. Filling those in —
// or adding home-specific plan_level_defaults — is a canon task, and once it
// lands the resolver's output will take precedence here automatically.
import { House, HousePlus, Crown } from 'lucide-react';

export const HOME_TIER_COPY = {
  good: {
    icon: House,
    label: 'Good',
    planLabel: 'Deluxe',
    tagline: 'Core home systems and appliances — the essentials, covered.',
    headline: 'Covers the systems and appliances a home leans on every day',
  },
  better: {
    icon: HousePlus,
    label: 'Better',
    planLabel: 'Deluxe Plus',
    tagline: 'Everything in Deluxe, plus broader appliance and system coverage.',
    headline: 'Extends Deluxe across a wider range of systems and appliances',
  },
  best: {
    icon: Crown,
    label: 'Best',
    planLabel: 'Deluxe Enhanced',
    tagline: 'Our most complete home coverage — the fewest gaps.',
    headline: 'The most complete home coverage Omega offers',
  },
};

export const TIER_ORDER = ['good', 'better', 'best'];

// Best-first, matching the upsell emphasis the coverage step uses.
export const PICKER_ORDER = ['best', 'better', 'good'];

/**
 * Prefer authored copy over the auto-product fallback.
 *
 * @param {object|null} presentation  resolvePlanPresentation() output
 * @param {string} tier
 * @returns {string}
 */
export function taglineFor(presentation, tier) {
  const source = presentation?.source?.level ?? null;
  const authored = source === 'org_override' && presentation?.tagline;
  return authored ? presentation.tagline : (HOME_TIER_COPY[tier]?.tagline ?? '');
}
