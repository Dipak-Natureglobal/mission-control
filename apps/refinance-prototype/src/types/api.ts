export interface VinDecodeResult {
  year: number | null;
  make: string;
  model: string;
  trim?: string;
  type?: string;
  engine?: string;
  drivetrain?: string;
  raw?: Record<string, unknown>;
  error?: string;
}

// Candidate trim from blinker's GET /api/v3/vehicle_by_vin. `name` is the
// backend's "#{series} #{style}".strip — it can come back blank, which
// MissionControl renders as "Unknown" rather than dropping the option.
export interface VehicleTrimCandidate {
  id: number;
  name: string;
}

export interface VehicleTrimLookupResult {
  year: number | null;
  make: string;
  model: string;
  trims: VehicleTrimCandidate[];
  error?: string;
}

// One row of blinker's GET /api/v3/vehicle_search_options payload — a flat
// list built from VehicleTrim (blinker app/services/vehicle_search_options_
// cache.rb#build). `trim` is the backend's "#{series} #{style}", so it can be
// blank or whitespace-only when both columns are nil.
export interface VehicleSearchOption {
  year: number;
  make: string;
  model: string;
  trim: string;
  trim_id: number;
}

export interface VehicleSearchOptionsResult {
  options: VehicleSearchOption[];
  error?: string;
}

// blinker's ProductPackage status, read for the remittance lock. `code` is the
// raw status column ("selected" / "booked" / "remitted" / ...); `remitted` is
// the only distinction refi acts on. `error` is set on any failure — callers
// FAIL OPEN (treat as unlocked), because blinker itself is the enforcement
// point (RemittanceLock raises RemittedRecordError on write) and a false lock
// would dead-end an agent with no recovery.
export interface PackageStatusResult {
  code: string;
  remitted: boolean;
  error?: string;
}

export interface ValuationResult {
  marketcheck_price: number | null;
  retail_price: number | null;
  error?: string;
}

export interface ZipLookupResult {
  city: string;
  state: string;
}

export interface StreetPredictionPlace {
  placeId: string;
  mainText: string;
  secondaryText?: string;
}

export interface StreetPrediction {
  placeId: string;
  description: string;
  structured?: {
    mainText: string;
    secondaryText?: string;
  };
}

export interface CorsProxyResponse {
  status: {
    url: string;
    status_code: number;
  };
  contents: string;
}

export interface GooglePlacesSuggestion {
  placePrediction?: {
    structuredFormat?: {
      mainText?: { text: string };
      secondaryText?: { text: string };
    };
    text?: { text: string };
    placeId: string;
  };
}
