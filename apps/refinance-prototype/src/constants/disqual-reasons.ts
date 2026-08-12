// Disqualification reason metadata — title + msg pairs surfaced by both
// the decision engine result card (StageTwoResult) and the DEV CONTROLS
// "Disqualification reason" override dropdown.
//
// Source of truth lives in src/refinance-v2-prototype.jsx. Re-exporting
// here so consumers (DevControls, lib/refi.js, future copy-variant work)
// can import from a stable, lightweight constants path without pulling
// the full monolith into their dep graph just to render a dropdown.
export { DISQUAL_REASONS } from '../refinance-v2-prototype';
