export interface VehicleData {
  vin: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  mileage: number;
  condition: 'New' | 'Used';
}

export interface ValuationData {
  marketCheckPrice: number | null;
  retailPrice: number | null;
}

export interface YMMTData {
  year: number;
  make: string;
  model: string;
  trim?: string;
}
