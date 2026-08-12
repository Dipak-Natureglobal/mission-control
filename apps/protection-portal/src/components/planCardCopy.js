// Public-facing per-tier copy for PlanCard. Lives in its own file so
// PlanCard.jsx can be a pure-component-exporting module (Vite Fast
// Refresh requires that — react-refresh/only-export-components).
//
// Wave 27 v3.0.8: `icon` and `label` are still used by the tier-name pill in
// PlanCard. The `tagline` strings below are FALLBACK-ONLY — at consumer-render
// time the tagline is sourced from canon plan_level_defaults[level].tagline_default
// via resolvePlanPresentation() in PlanCard. These strings are only reached
// when canon is missing tagline data, which should not happen in normal operation.
import { ShieldCheck, Star, Crown } from 'lucide-react';

export const PUBLIC_TIER_COPY = {
  good: {
    icon: ShieldCheck,
    label: 'Good',
    // tagline: fallback-only — sourced from canon plan_level_defaults.good.tagline_default via resolver
    tagline: 'Core powertrain coverage for budget-minded peace of mind.',
  },
  better: {
    icon: Star,
    label: 'Better',
    // tagline: fallback-only — sourced from canon plan_level_defaults.better.tagline_default via resolver
    tagline: 'Powertrain Plus — broader component coverage at a balanced price.',
  },
  best: {
    icon: Crown,
    label: 'Best',
    // tagline: fallback-only — sourced from canon plan_level_defaults.best.tagline_default via resolver
    tagline: 'Most comprehensive coverage available — exclusionary, fewest gaps.',
  },
};

export const TIER_ORDER = ['good', 'better', 'best'];
