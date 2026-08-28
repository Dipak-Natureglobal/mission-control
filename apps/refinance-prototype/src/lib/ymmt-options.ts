// ymmt-options — dropdown lists derived from blinker's
// GET /api/v3/vehicle_search_options.
//
// The endpoint returns one flat row per VehicleTrim ({year, make, model,
// trim, trim_id}); every dropdown is a projection of that array. This mirrors
// MissionControl's derivation in
// MissionControl/src/features/refiApp/vehicle/plateVinForm.tsx:386-412 —
// same casing rules, same uniqueness keys, same sort — so the two apps offer
// an operator the same options for the same vehicle.
//
// Falls back to the bundled YMMT fixture (blinker-platform/utils) when there
// is no access token: the endpoint is behind
// Api::V3::ApiController#require_user_credential!, so standalone customer
// sessions can't reach it.

import { useEffect, useState } from 'react';
import {
  YEARS as FIXTURE_YEARS,
  getMakes as fixtureGetMakes,
  getModelsForYearMake as fixtureGetModelsForYearMake,
  getTrimsForYearMakeModel as fixtureGetTrimsForYearMakeModel,
} from 'blinker-platform/utils';
import { fetchVehicleSearchOptions } from '../utils/api';
import { resolveWriteContext } from './blinkerWrite';
import type { VehicleSearchOption } from '../types';

// Trim escape hatches. Kept on every YMMT-derived trim list (not only empty
// ones) so a consumer whose exact trim isn't carried can still move forward,
// and so a model with no trim rows at all still opens a pickable modal
// instead of an empty one.
export const TRIM_UNKNOWN = "I don't know";
export const TRIM_OTHER = 'Other';

// MC's formatLabel: capitalize words >=4 letters and all-alpha; leave
// shorter or non-alpha words ("GT", "4WD", "X5") untouched.
export function formatLabel(label: string): string {
  if (!label) return '';
  return label
    .split(/\s+/)
    .map((word) =>
      word.length < 4 || /[^A-Za-z]/.test(word)
        ? word
        : word[0].toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(' ');
}

function uniqBy<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const k = key(row);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}

const eq = (a: string | number | null | undefined, b: string | number | null | undefined) =>
  String(a ?? '').toUpperCase() === String(b ?? '').toUpperCase();

// ---- projections -----------------------------------------------------------

export function getYears(options: VehicleSearchOption[]): number[] {
  return Array.from(new Set(options.map((o) => o.year))).sort((a, b) => b - a);
}

export function getMakes(options: VehicleSearchOption[], year: number | string | null): string[] {
  const rows = year ? options.filter((o) => eq(o.year, year)) : options;
  return uniqBy(rows, (o) => o.make.toUpperCase())
    .map((o) => formatLabel(o.make))
    .sort((a, b) => a.localeCompare(b));
}

export function getModels(
  options: VehicleSearchOption[],
  year: number | string | null,
  make: string,
): string[] {
  if (!make) return [];
  const rows = options.filter((o) => (!year || eq(o.year, year)) && eq(o.make, make));
  return uniqBy(rows, (o) => o.model.toUpperCase())
    .map((o) => formatLabel(o.model))
    .sort((a, b) => a.localeCompare(b));
}

// Trim labels only — the picker renders strings. The id behind each label is
// recovered at pick time via getTrimId below, so the form can carry `trim_id`
// the way MC's `<Field name="trim_id">` does (plateVinForm.tsx:49-69) without
// the picker having to render option objects.
export function getTrims(
  options: VehicleSearchOption[],
  year: number | string | null,
  make: string,
  model: string,
): string[] {
  if (!make || !model) return [];
  const rows = options.filter(
    (o) => (!year || eq(o.year, year)) && eq(o.make, make) && eq(o.model, model),
  );
  const labels = uniqBy(rows, (o) => String(o.trim_id))
    .map((o) => formatLabel(o.trim).trim())
    // Blank "#{series} #{style}" rows carry no information for a label-keyed
    // form — MC can keep them because it stores trim_id. Drop them here and
    // let the sentinels below cover the "no named trim" case.
    .filter(Boolean);
  return Array.from(new Set(labels)).sort((a, b) => a.localeCompare(b));
}

// Label → trim_id, the inverse of getTrims' label projection.
//
// blinker's VehicleDecodeAndImportCommand resolves the trim from `trim_id`
// when one is sent (vehicle_decode_and_import_command.rb:72-73) and otherwise
// falls back to a case-SENSITIVE year/make/model match (:75-80) that our
// title-cased make ("Audi" vs the stored "AUDI") can never satisfy. Sending
// the id is what keeps that fallback out of the picture — the same reason MC
// submits `trim_id` rather than YMMT strings.
//
// Matching is deliberately loose on case: the label came back through
// formatLabel, so compare formatted-to-formatted rather than trusting the
// caller to have preserved it. Returns null when nothing matches — sentinels
// ("I don't know" / "Other") and decode-injected extras have no id by
// construction.
export function getTrimId(
  options: VehicleSearchOption[],
  year: number | string | null,
  make: string,
  model: string,
  trimLabel: string,
): number | null {
  if (!make || !model || !trimLabel) return null;
  const wanted = formatLabel(trimLabel).trim().toUpperCase();
  if (!wanted) return null;
  const row = options.find(
    (o) =>
      (!year || eq(o.year, year)) &&
      eq(o.make, make) &&
      eq(o.model, model) &&
      formatLabel(o.trim).trim().toUpperCase() === wanted,
  );
  const id = row ? Number(row.trim_id) : NaN;
  return Number.isFinite(id) ? id : null;
}

// Wraps a trim list with the escape hatches. An empty list still yields the
// two sentinels, so the picker is never a dead modal.
export function withTrimSentinels(trims: string[]): string[] {
  return [TRIM_UNKNOWN, ...trims, TRIM_OTHER];
}

export function isTrimSentinel(value: string): boolean {
  return value === TRIM_UNKNOWN || value === TRIM_OTHER;
}

// ---- hook ------------------------------------------------------------------

export interface YmmtOptionsSource {
  /** true once the API list is in hand; false while loading or on fixture. */
  ready: boolean;
  loading: boolean;
  /** Set when the API path was attempted and failed. */
  error: string | null;
  /** true when lists come from blinker, false when they come from the fixture. */
  live: boolean;
  years: number[];
  makesFor: (year: number | string | null) => string[];
  modelsFor: (year: number | string | null, make: string) => string[];
  trimsFor: (year: number | string | null, make: string, model: string) => string[];
  /**
   * trim_id behind a trim label, or null when the label has no id (sentinels,
   * decode-injected extras, or the fixture path — the bundled fixture carries
   * labels only). Callers send the id to blinker so the importer takes its
   * `VehicleTrim.find(trim_id)` branch.
   */
  trimIdFor: (
    year: number | string | null,
    make: string,
    model: string,
    trimLabel: string,
  ) => number | null;
}

// Loads the blinker option list once per session and exposes the four
// projections. With no token (or on failure) the same four projections are
// served from the bundled fixture, so callers need no branch of their own.
export function useYmmtOptions(): YmmtOptionsSource {
  const [options, setOptions] = useState<VehicleSearchOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctx = resolveWriteContext();
    if (!ctx.apiBase || !ctx.token) return; // fixture path — nothing to load
    let cancelled = false;
    setLoading(true);
    fetchVehicleSearchOptions({ apiBase: ctx.apiBase, token: ctx.token }).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.error) {
        setError(res.error);
        return;
      }
      setOptions(res.options);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const live = options.length > 0;

  return {
    ready: live,
    loading,
    error,
    live,
    years: live ? getYears(options) : FIXTURE_YEARS,
    makesFor: (year) => (live ? getMakes(options, year) : fixtureGetMakes()),
    modelsFor: (year, make) =>
      live ? getModels(options, year, make) : fixtureGetModelsForYearMake(year, make),
    trimsFor: (year, make, model) =>
      live
        ? getTrims(options, year, make, model)
        : fixtureGetTrimsForYearMakeModel(year, make, model),
    // Fixture rows carry no trim_id, so the fixture path yields null. That is
    // the no-token case, where blinkerWrite is disabled anyway — nothing is
    // submitted for the missing id to matter to.
    trimIdFor: (year, make, model, trimLabel) =>
      live ? getTrimId(options, year, make, model, trimLabel) : null,
  };
}
