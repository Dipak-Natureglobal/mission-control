// Public surface for home-protection-portal's customer views.
//
// Mission-control and customer-portal reach in through this barrel only;
// deeper paths are considered internal even though they resolve. Matches the
// convention in protection-portal, insurance-portal and refi-portal.
//
// Two of these exports carry a cross-repo contract and must not be renamed:
//
//   INITIAL_FORM  — the wizard's form shape. mission-control seeds a
//                   home_protection CoPilot session from it.
//   buildSteps    — the live step list for a form. mission-control's progress
//                   timeline indexes into it, so `stepIdx` semantics on both
//                   sides depend on it returning the same array.
//
// The step components are exported so an embedder can cross-show a single
// screen (the way mission-control cross-shows protection's
// RecommendedCoverage on a related insurance opportunity) without mounting
// the whole wizard.

export {
  INITIAL_FORM,
  BASE_STEPS,
  buildSteps,
  shouldRunCustomize,
  shouldRunOptionalCoverages,
  HomeWizard,
  CustomerView,
} from './CustomerView.jsx';

export { HomeAdd } from './HomeAdd.jsx';
export { HomeFeatures } from './HomeFeatures.jsx';
export { RecommendedCoverage } from './RecommendedCoverage.jsx';
export { Customize } from './Customize.jsx';
export { OptionalCoverages } from './OptionalCoverages.jsx';
export { Confirm } from './Confirm.jsx';
export { BillingPayment } from './BillingPayment.jsx';
export { DocuSeal } from './DocuSeal.jsx';
export { ThankYou } from './ThankYou.jsx';
