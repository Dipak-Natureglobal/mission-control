// DEV CONTROLS seed data for QA. Not used in production paths.
// Extracted to a non-component module to satisfy react-refresh's
// "only export components from component files" constraint.

// Vehicle seed: sensible mileage + condition so QA can jump past the
// vehicle_drive step without manually entering mileage.
// CustomerView treats mileage-present as vehicle_drive already completed.
export const DEV_SEED_VEHICLE = {
  vin:                   '1HGCM82633A004352',
  year:                  2021,
  make:                  'Toyota',
  model:                 'RAV4',
  trim:                  'XLE',
  mileage:               28100,
  condition:             'used',
  purchase_date:         '2025-01-15',
  annual_miles_estimate: 14100,
};
