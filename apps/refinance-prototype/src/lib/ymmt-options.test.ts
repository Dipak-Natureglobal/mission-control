import { describe, it, expect } from 'vitest';
import {
  formatLabel,
  getYears,
  getMakes,
  getModels,
  getTrims,
  getTrimId,
  withTrimSentinels,
  isTrimSentinel,
  TRIM_UNKNOWN,
  TRIM_OTHER,
} from './ymmt-options';
import type { VehicleSearchOption } from '../types';

const row = (
  year: number,
  make: string,
  model: string,
  trim: string,
  trim_id: number,
): VehicleSearchOption => ({ year, make, model, trim, trim_id });

const OPTIONS: VehicleSearchOption[] = [
  row(2020, 'JEEP', 'CHEROKEE', 'LATITUDE PLUS', 1),
  row(2020, 'JEEP', 'CHEROKEE', 'TRAILHAWK', 2),
  // Same label from two trim_ids — collapses to one option.
  row(2020, 'JEEP', 'CHEROKEE', 'TRAILHAWK', 3),
  row(2020, 'jeep', 'WRANGLER', 'SPORT', 4),
  row(2020, 'HONDA', 'CIVIC', 'EX', 5),
  row(2019, 'HONDA', 'CIVIC', 'LX', 6),
  // Backend "#{series} #{style}" with both columns nil.
  row(2019, 'HONDA', 'ELEMENT', '', 7),
];

describe('formatLabel', () => {
  it('capitalizes alpha words of 4+ characters', () => {
    expect(formatLabel('LATITUDE PLUS')).toBe('Latitude Plus');
  });

  it('leaves short and non-alpha words untouched', () => {
    expect(formatLabel('GT 4WD X5')).toBe('GT 4WD X5');
  });
});

describe('getYears', () => {
  it('returns unique years newest first', () => {
    expect(getYears(OPTIONS)).toEqual([2020, 2019]);
  });
});

describe('getMakes', () => {
  it('filters by year, dedupes case-insensitively, and sorts', () => {
    expect(getMakes(OPTIONS, 2020)).toEqual(['Honda', 'Jeep']);
    expect(getMakes(OPTIONS, 2019)).toEqual(['Honda']);
  });

  it('accepts a string year (form state carries both)', () => {
    expect(getMakes(OPTIONS, '2019')).toEqual(['Honda']);
  });

  it('returns every make when no year is selected', () => {
    expect(getMakes(OPTIONS, null)).toEqual(['Honda', 'Jeep']);
  });
});

describe('getModels', () => {
  it('scopes to year + make', () => {
    expect(getModels(OPTIONS, 2020, 'JEEP')).toEqual(['Cherokee', 'Wrangler']);
    expect(getModels(OPTIONS, 2019, 'Honda')).toEqual(['Civic', 'Element']);
  });

  it('is case-insensitive on make', () => {
    expect(getModels(OPTIONS, 2020, 'jeep')).toEqual(['Cherokee', 'Wrangler']);
  });

  it('returns nothing without a make', () => {
    expect(getModels(OPTIONS, 2020, '')).toEqual([]);
  });
});

describe('getTrims', () => {
  it('dedupes labels that share a name across trim_ids', () => {
    expect(getTrims(OPTIONS, 2020, 'JEEP', 'CHEROKEE')).toEqual([
      'Latitude Plus',
      'Trailhawk',
    ]);
  });

  it('drops blank series+style rows', () => {
    expect(getTrims(OPTIONS, 2019, 'HONDA', 'ELEMENT')).toEqual([]);
  });

  it('returns nothing without make and model', () => {
    expect(getTrims(OPTIONS, 2020, 'JEEP', '')).toEqual([]);
  });
});

describe('getTrimId', () => {
  it('recovers the id behind a label getTrims produced', () => {
    const [label] = getTrims(OPTIONS, 2020, 'JEEP', 'WRANGLER');
    expect(label).toBe('Sport');
    expect(getTrimId(OPTIONS, 2020, 'JEEP', 'WRANGLER', label)).toBe(4);
  });

  // The picker title-cases make ("Audi"), blinker stores source casing
  // ("AUDI") — the mismatch that makes the server's YMMT fallback 404.
  it('resolves despite the picker title-casing make and model', () => {
    expect(getTrimId(OPTIONS, 2020, 'Jeep', 'Cherokee', 'Trailhawk')).toBe(2);
  });

  it('takes the first id when one label spans several trim_ids', () => {
    expect(getTrimId(OPTIONS, 2020, 'JEEP', 'CHEROKEE', 'Trailhawk')).toBe(2);
  });

  it('is year-scoped', () => {
    expect(getTrimId(OPTIONS, 2019, 'HONDA', 'CIVIC', 'LX')).toBe(6);
    expect(getTrimId(OPTIONS, 2020, 'HONDA', 'CIVIC', 'LX')).toBeNull();
  });

  it('returns null for the sentinels and for unknown labels', () => {
    expect(getTrimId(OPTIONS, 2020, 'JEEP', 'CHEROKEE', TRIM_UNKNOWN)).toBeNull();
    expect(getTrimId(OPTIONS, 2020, 'JEEP', 'CHEROKEE', TRIM_OTHER)).toBeNull();
    expect(getTrimId(OPTIONS, 2020, 'JEEP', 'CHEROKEE', 'Rubicon')).toBeNull();
  });

  it('returns null when make, model or label is missing', () => {
    expect(getTrimId(OPTIONS, 2020, '', 'CHEROKEE', 'Trailhawk')).toBeNull();
    expect(getTrimId(OPTIONS, 2020, 'JEEP', '', 'Trailhawk')).toBeNull();
    expect(getTrimId(OPTIONS, 2020, 'JEEP', 'CHEROKEE', '')).toBeNull();
  });
});

describe('withTrimSentinels', () => {
  it('keeps a modal pickable when the trim list is empty', () => {
    expect(withTrimSentinels([])).toEqual([TRIM_UNKNOWN, TRIM_OTHER]);
  });

  it('wraps a populated list', () => {
    expect(withTrimSentinels(['Sport'])).toEqual([TRIM_UNKNOWN, 'Sport', TRIM_OTHER]);
  });
});

describe('isTrimSentinel', () => {
  it('recognizes both escape hatches and nothing else', () => {
    expect(isTrimSentinel(TRIM_UNKNOWN)).toBe(true);
    expect(isTrimSentinel(TRIM_OTHER)).toBe(true);
    expect(isTrimSentinel('Trailhawk')).toBe(false);
    expect(isTrimSentinel('')).toBe(false);
  });
});
