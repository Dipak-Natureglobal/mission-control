// VehicleAdd screen — VIN OR manual YMMT entry with mismatch confirmation.
// Re-export from the monolith. § 1.5b mechanical lift; the monolith
// remains the source of truth until each screen is independently
// extracted with its dependency graph.
//
// Props (forwarded to ScreenVehicleAdd in refinance-v2-prototype.jsx):
//   - form, update, onNext: standard wizard plumbing.
//   - requireVin (default false): when true, Continue stays disabled until
//     VIN is present (17 chars) AND decoded without error. YMMT-only
//     completion is blocked. Used by mission-control's StartOpportunityFlow
//     "Add new vehicle" path and insurance-portal's LeadOriginationForm
//     inline vehicle collection. Refi-portal standalone leaves it as false
//     so VIN-or-YMMT remains valid (per platform locked decision).
export { ScreenVehicleAdd as VehicleAdd } from '../../refinance-v2-prototype';
