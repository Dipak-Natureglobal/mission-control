// Money helpers for the EI partner contract. EI returns currency in
// cents (totalPremiumCents, savingsAmountCents) and does not
// document a premium period — we assume 6 months for auto policies
// per architecture/06-embedded-insurance-contract.md until EI confirms.
// All UI labels say "/ 6mo", not "/ year", until that confirmation
// lands.

const CENTS_PER_DOLLAR = 100;

// formatCents(120000)            → '$1,200.00'
// formatCents(120000, { whole }) → '$1,200'
// formatCents(null)              → '—'
export function formatCents(cents, opts = {}) {
  if (cents == null) return '—';
  const dollars = cents / CENTS_PER_DOLLAR;
  const fractionDigits = opts.whole ? 0 : 2;
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

// annualizeFromCents(120000, '6mo') → 240000  (cents)
// Stays in cents so the caller pipes straight into formatCents.
export function annualizeFromCents(cents, period = '6mo') {
  if (cents == null) return null;
  switch (period) {
    case '6mo':     return cents * 2;
    case 'monthly': return cents * 12;
    case '12mo':
    case 'annual':
    default:        return cents;
  }
}
