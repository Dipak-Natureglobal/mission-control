# RCA: "Something Went Wrong" on Continue as Customer — CRM Trim Lookup Failure

**Date:** 2026-05-20  
**PR:** [#6279 — fix the selected vehicle trim issue for inbound crm service](https://github.com/BlinkerGit/blinker/pull/6279)  
**Severity:** High — "Continue as Customer" button in CallTools CRM blocked for all contacts  
**Error:** "Something Went Wrong" on `/refiapp` page after CallTools webhook redirect  
**Component:** `Crm::Inbound::VehicleImporter#selected_vehicle_trim_for`

---

## Summary

When a CallTools agent clicks "Continue as Customer," it fires a webhook to Blinker which runs `Crm::Inbound::ContactsService`. This syncs the contact, creates a `Vehicle`, and redirects the agent to `/refiapp?packageId=...` in MissionControl. The vehicle's `selected_vehicle_trim` was being set to `nil` every time because:

1. CallTools never sends a `v1_trim` field (it is not in the permitted params whitelist).
2. The pre-fix `selected_vehicle_trim_for` query applied a trim `ILIKE NULL` condition unconditionally — PostgreSQL evaluates any comparison with `NULL` as `NULL` (not `true` or `false`), so the entire query returned no rows.

A vehicle with nil `selected_vehicle_trim` has no delegated spec data (`class_name`, `style`, `series`, etc.). When the refiapp page loaded and called StoneEagle's GetRates to fetch product quotes, the missing vehicle class/spec caused the API call to fail, and MissionControl displayed "Something Went Wrong."

---

## Entry Point — CallTools Webhook Flow

```
CallTools agent clicks "Continue as Customer"
  → POST /api/v3/webhooks/calltools (CalltoolsController#create)
    → Crm::Inbound::ContactsService.new(source: :calltools).process
        → VehicleImporter.new(user, contact).apply
            → selected_vehicle_trim_for(n)   ← bug here
            → upsert_vehicle(vehicle_attrs)   ← saves vehicle with nil trim
        → ProductPackage created
        → returns product_package
    → redirect_to "/refiapp?packageId=#{product_package.id}"
  → Agent browser opens MissionControl /refiapp
    → page calls GetRates API for product quotes
    → vehicle has no trim → StoneEagle request fails
    → MissionControl shows "Something Went Wrong"
```

### Why trim is always nil for CallTools

`CalltoolsController` uses a strict permitted-params whitelist:

```ruby
def calltools_params
  params.permit(*%i[
    ... v1_year v1_make v1_vin v1_model v1_mileage state ...
  ])
end
```

`v1_trim` is **not in this list**. CallTools also does not send a trim field in its webhook payload. Therefore `contact[:"v1_trim"]` and `contact[:"V1 Trim"]` are always `nil` in the CallTools flow.

---

## Root Cause 1: Trim `ILIKE NULL` applied unconditionally — returns zero rows

### Pre-fix code

```ruby
def selected_vehicle_trim_for(nth_vehicle)
  # ... VIN-based early return ...

  year  = contact[:"v#{nth_vehicle}_year"].presence  || ...
  make  = contact[:"v#{nth_vehicle}_make"].presence  || ...
  model = contact[:"v#{nth_vehicle}_model"].presence || ...
  trim  = contact[:"v#{nth_vehicle}_trim"].presence  || ...  # ← always nil for CallTools

  VehicleTrim
    .where(year:)
    .where("make ILIKE ?", make)
    .where("model ILIKE ?", model)
    .where("series ILIKE :t OR trim_name ILIKE :t", t: trim)  # ← t: nil
    .first
end
```

When `trim` is nil, the generated SQL becomes:

```sql
WHERE year = 2021
  AND make ILIKE 'Chevrolet'
  AND model ILIKE 'Silverado 1500'
  AND (series ILIKE NULL OR trim_name ILIKE NULL)
```

In PostgreSQL, any comparison with `NULL` returns `NULL`, not `false`. The expression evaluates as:

```
(NULL OR NULL) = NULL  →  condition is falsy  →  0 rows returned
```

`query.first` returns `nil`. Every CallTools vehicle sync set `selected_vehicle_trim: nil`.

---

## Root Cause 2: No wildcard on trim ILIKE — partial trim names never matched

Even for inbound sources that DO send a trim (e.g., GHL), the pre-fix query used exact case-insensitive matching without `%` wildcards:

```ruby
.where("series ILIKE :t OR trim_name ILIKE :t", t: trim)
```

CRM systems commonly send abbreviated trim labels:
- CRM sends `"LT"` → DB has `series = "1LT"` or `"2LT"` → `"1LT" ILIKE 'LT'` → false (no wildcard)
- CRM sends `"SV"` → DB has `trim_name = "4WD SV"` → `"4WD SV" ILIKE 'SV'` → false

No wildcard means the search is effectively an exact match. Any abbreviated or incomplete trim name silently returned `nil`, even when a matching record existed.

---

## Downstream Consequence: vehicle spec data missing

`Vehicle` delegates ~40 attributes to `selected_vehicle_trim`:

```ruby
DELEGATED_VEHICLE_TRIM_ATTRIBUTES = %i[
  class_name style series make model year mileage_cat
  engine_description cylinders drivetrain ... 
].freeze

DELEGATED_VEHICLE_TRIM_ATTRIBUTES.each do |att|
  delegate att, to: :vehicle_trim, allow_nil: true
end
```

When `selected_vehicle_trim` is `nil`, all of these return `nil`. The `Vehicle#vehicle_type` is also `nil` (set from `selected_vehicle_trim&.class_name` in `default_trim_and_type!`).

`VehicleImporter#upsert_vehicle` saves the vehicle successfully (no crash — the `selected_trim_applies_to_this_vehicle` validation is commented out for MVP). The product package is created and the redirect proceeds to `/refiapp`. However, when the refiapp page calls `get_product_quotes`:

```
StoneEagle::GetRates  requires vehicle class, year, mileage data
  → vehicle.class_name  → nil (no trim)
  → vehicle.style       → nil
  → GetRates request fails or returns no plans
  → MissionControl shows "Something Went Wrong"
```

### Why `default_trim_and_type!` did not recover the trim

`Vehicle` has `before_validation :default_trim_and_type!`:

```ruby
def default_trim_and_type!
  self.selected_vehicle_trim ||= vehicle_trims.order(:uvc).first
end

def vehicle_trims
  vin.present? ? VehicleTrim.matching_vin(vin) : VehicleTrim.none
end
```

This fallback works **only** when the vehicle has a VIN. CallTools does send `v1_vin` in some cases, but many contacts arrive without a VIN (the vehicle is identified by make/model/year only). Without a VIN, `vehicle_trims = VehicleTrim.none`, and the fallback returns nothing. The trim stays nil.

---

## Fix

### `selected_vehicle_trim_for` — post-fix code

```ruby
def selected_vehicle_trim_for(nth_vehicle)
  vin = ...
  if vin.present?
    vehicle = Vehicle.find_by(vin:)
    return vehicle.selected_vehicle_trim if vehicle&.selected_vehicle_trim.present?
  end

  year  = ...
  make  = ...
  model = ...
  trim  = ...

  query = VehicleTrim
          .where(year:)
          .where("LOWER(make) = ?", make.downcase)    # explicit normalization
          .where("LOWER(model) = ?", model.downcase)

  if trim.present?                                    # nil guard — skip trim filter entirely
    query = query.where(
      "series ILIKE :t OR trim_name ILIKE :t",
      t: "%#{trim}%"                                  # wildcard on both sides
    )
  end

  query.first
end
```

**Three changes:**

| Change | Before | After | Effect |
|---|---|---|---|
| Make/model matching | `make ILIKE ?`, `make` | `LOWER(make) = ?`, `make.downcase` | Explicit case normalization on both sides |
| Trim nil guard | Always applied | `if trim.present?` | No trim filter when CRM doesn't send trim |
| Trim wildcard | `ILIKE :t, t: trim` | `ILIKE :t, t: "%#{trim}%"` | Partial name match ("LT" matches "1LT", "2LT") |

### Result

CallTools contact sync (no trim field):
- Pre-fix: `ILIKE NULL` → nil trim → no vehicle spec data → "Something Went Wrong"
- Post-fix: trim filter skipped → matches by year/make/model → first VehicleTrim found → vehicle has full spec data → GetRates succeeds → refiapp loads

GHL/other CRM with abbreviated trim (e.g., `"LT"`):
- Pre-fix: `ILIKE 'LT'` → misses `"1LT"`, `"2LT"` in DB → nil trim
- Post-fix: `ILIKE '%LT%'` → matches `"1LT"`, `"2LT"` → correct trim found

---

## Affected Scenarios

| Scenario | Pre-fix | Post-fix |
|---|---|---|
| CallTools webhook (no trim field) | nil trim → "Something Went Wrong" | Trim found by year/make/model ✓ |
| GHL/CRM with exact trim match | Correct trim found ✓ | Correct trim found ✓ |
| GHL/CRM with abbreviated trim (e.g., "LT" vs "1LT") | nil trim → downstream failure | Partial match finds correct trim ✓ |
| VIN present + existing vehicle with trim | Early return, not affected | Early return, not affected ✓ |
| Vehicle with VIN, no existing DB record | Name-based search (may fail) | Name-based search improved ✓ |

---

## Prevention

1. **Guard NULL before SQL parameters** — any user-supplied field used in a `WHERE` clause should be checked with `.present?` before use. `ILIKE NULL` in PostgreSQL silently returns no rows rather than raising an error, making this class of bug invisible without explicit testing with nil inputs.

2. **Test CRM inbound sync with representative payloads** — the calltools_params whitelist and the GHL payload shape differ. Spec coverage should include both with and without `v1_trim` in the contact payload, asserting the resulting vehicle has a non-nil `selected_vehicle_trim`.

3. **Wildcard searches for human-supplied identifiers** — trim names from CRM systems are user-typed strings. Exact ILIKE (without `%`) is fragile against abbreviations, spacing differences, and prefix variants. `ILIKE '%#{term}%'` is the appropriate default for human-readable lookup fields.

4. **Validate `selected_vehicle_trim` at sync boundary** — `ContactsService` should log a warning (or surface a soft error) when a vehicle is upserted with nil `selected_vehicle_trim` and no VIN-based fallback exists, rather than silently creating an incomplete record that fails downstream.
