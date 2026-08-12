// Public surface for protection-portal's customer views.
//
// Established 2026-05-14 (Wave 31 v3.0.11) to give mission-control a stable
// import path for the cross-shown `RecommendedCoverage` component when an
// insurance opportunity has a related protection opp ≤ step 5 (ADR 21 D5).
//
// Pattern matches insurance-portal/src/views/customer/index.js and
// refi-portal/src/views/customer/index.js — child apps reach in via these
// barrel files only; deep paths (e.g. `RecommendedCoverage.jsx`) are
// considered internal even though they resolve.
//
// Keep additions to this file MINIMAL — every new named export tightens
// the cross-app coupling surface. Today only RecommendedCoverage is
// public; CustomerView's INITIAL_FORM / buildSteps are still imported
// from the deep path because they predate this file.

export { RecommendedCoverage } from './RecommendedCoverage.jsx';
