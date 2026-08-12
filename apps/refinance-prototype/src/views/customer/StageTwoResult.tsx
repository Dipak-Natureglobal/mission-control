// StageTwoResult — composite terminal-state fan-out for refi prequal.
// Renders QualifiedHandoffCard / OffersCard / DisqualifiedCard /
// PendingCard based on decision.result, plus InsuranceTeaser /
// InsuranceSavingsCard gated by form.insuranceReviewed and
// form.insuranceSavingsFound, plus ProtectionPlanTeaser gated by
// !form.planSold. Provides the agent with refi offers, insurance
// savings, and protection plan teaser all in one frame so the bundle
// can be pitched.
//
// Re-export from the monolith — same pattern as DecisionEngine.jsx,
// VehicleAdd.jsx, etc. The monolith remains source of truth until
// these Stage 2 sub-components are independently extracted with their
// dependency graph (mock data, Stage2Shell, icons, etc.).
export { StageTwoResult } from '../../refinance-v2-prototype';
