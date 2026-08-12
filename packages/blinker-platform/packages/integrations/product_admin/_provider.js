// Provider interface contract for the `product_admin` integration category.
//
// A product-administrator provider supplies VSC / GAP / appearance product
// catalogs + per-vehicle rate quotes. Real providers in this category are
// SOAP or REST APIs (StoneEagle = SOAP, Express Aftermarket = REST). This
// file documents the shape every provider implementation must export.
//
// See `architecture/13-stoneeagle-integration.md` for the StoneEagle-specific
// derivation. The category facade lives at `index.js`.
//
// ---------------------------------------------------------------------
//
// Provider implementation contract:
//
//   export default {
//     id: 'stoneeagle',                  // matches canon integrations.json provider id
//     supportsTestMode: true,
//
//     async getRates(input, ctx) {
//       // input: flat request shape from the consuming wizard:
//       //   { year, make, model, trim, mileage, condition, state, vin }
//       // ctx:
//       //   credentials: object — resolved per env (test vs live block from canon
//       //                org-registry.json::orgs[orgId].integrations.<id>.credentials)
//       //   testMode:    boolean — true → test creds; false → live
//       //   orgId:       string  — for telemetry / audit
//       //   signal:      AbortSignal | undefined
//       //
//       // Returns the normalized GetRates response shape (see ADR 13). Phase 1
//       // returns fixture content; Phase 2 will route through a Blinker
//       // backend SOAP proxy. The shape does not change between phases.
//     },
//   };
//
// Phase-1 fallback (returned by index.js when no provider is configured):
//
//   { status: 'no_provider', reason: 'no_provider_configured', plan_rates: [] }
//
// Backlog (separate wave): bookContract, voidContract, printContractPDF,
// getTrimsByVIN, getLienholders. Not part of Wave 21.

export default {};
