// Public exports from src/views/customer.
//
// Cross-app consumers (notably protection-portal/src/views/customer/
// Confirm.jsx via a `file:` dep) import from this module path so the
// surface is explicit. Anything not exported here is internal — the
// rest of the customer-view files (CustomerView, CaptureForm,
// GettingQuote, QuoteReview, PolicyBound) are the EI-microsite
// simulator and are not meant to be consumed externally.
//
// Public component contracts live in JSDoc on the source modules.
export { SavingsCard, default as default } from './SavingsCard.jsx';
