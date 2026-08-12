// Wave 23-fu2 — AssetType resolution for StoneEagle GetRates SOAP envelope.
//
// SE recognizes 3 codes from its YMMT reference: 'P' (passenger), 'T' (truck/
// SUV/van/anything-not-a-car), 'AL' (antique/limited; niche). The previous
// SOAP builder hardcoded 'T' for the YMMT-only path, sending sedans into
// the truck rate set and skewing GetRates output.
//
// Resolution order at the call site (consumers in protection-portal):
//   1. VIN-decode path → mapVinAuditTypeToSeAssetType(vinResult.type)
//   2. YMMT-only path  → getAssetTypeForMakeModel(make, model) from
//                         packages/utils/ymmt-data.js
//   3. Fallback        → 'P' (passenger covers the most common consumer
//                         vehicle; safer than 'T' which collapsed cars
//                         into the truck rate bucket)
//
// VinAudit's `type` field is a free-form body-style string (observed values:
// "Sedan", "Coupe", "Hatchback", "Wagon", "Convertible", "SUV", "Pickup",
// "Truck", "Van", "Minivan", "Crossover"…). The mapping below collapses
// every car-shape into 'P' and everything else into 'T'.

const PASSENGER_TYPES = new Set([
  'sedan',
  'coupe',
  'hatchback',
  'wagon',
  'convertible',
  'roadster',
  'cabriolet',
  'liftback',
  'fastback',
  'sport',
  'sports car',
]);

export function mapVinAuditTypeToSeAssetType(vinAuditType) {
  if (!vinAuditType) return null;
  const norm = String(vinAuditType).toLowerCase().trim();
  if (!norm) return null;
  if (PASSENGER_TYPES.has(norm)) return 'P';
  for (const t of PASSENGER_TYPES) {
    if (norm.includes(t)) return 'P';
  }
  return 'T';
}

export const SE_ASSET_TYPE_DEFAULT = 'P';
