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
