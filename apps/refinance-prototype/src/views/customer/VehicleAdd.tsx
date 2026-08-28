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
//   - locked (default false): remittance lock. True once the ProductPackage
//     attached to this vehicle is `remitted`, at which point blinker freezes
//     the Vehicle record (Vehicle#remittance_locked?) and rejects writes with
//     RemittedRecordError. Renders VIN + YMMT read-only and suppresses the
//     VIN-clear and VIN-decode effects, which would otherwise overwrite the
//     committed values. Also relaxes the Continue gate to VIN-present: the
//     committed values cannot be edited, so requiring a trim the picker
//     refuses to open would dead-end the screen. Resolved by AgentView; other
//     views leave it false.
export { ScreenVehicleAdd as VehicleAdd } from '../../refinance-v2-prototype';
