# RCA: Duplicate VIN Package Causing product_and_payment_remitted_error

**Date:** 2026-05-20  
**PR:** [#6298 — Add check for VIN only with multi tenancy](https://github.com/BlinkerGit/blinker/pull/6298)  
**Severity:** High — legitimate deals blocked by false-positive duplicate VIN check; incorrect contract remittance errors surfaced to users  
**Error:** `product_and_payment_remitted_error` — duplicate contract detected at remittance  
**Components:** `Api::V3::Admin::VehiclesController#create`, `PackagesController#update_vin`, `ProductPackage` scopes

---

## Summary

A VIN duplicate check ran across **all organizations** in the system instead of being scoped to the current organization. This meant that if any org in any tenant had a `ProductPackage` for the same VIN in the current calendar month, a new deal in a different org was blocked — even though the two deals are completely independent contracts. Additionally, the old check matched on `created_at` with no `remitted_at` requirement, so even non-remitted (draft/incomplete) packages triggered the block. Both conditions together caused the remittance pipeline to encounter legitimately distinct packages it treated as duplicates, resulting in `product_and_payment_remitted_error`.

---

## System Context

### Multi-tenancy model

`ProductPackage` belongs to a `User`, who belongs to an `Organization` via `OrganizationUser`. An admin operates within one organization. Multiple organizations are independent tenants — a VIN can legitimately be covered under separate contracts by separate orgs in the same month (e.g., a national dealer group with regional subsidiaries, or two unrelated dealers both processing the same vehicle).

```
Organization A  →  AdminA  →  ProductPackage PA  →  Vehicle (VIN: XYZ)
Organization B  →  AdminB  →  ProductPackage PB  →  Vehicle (VIN: XYZ)
```

Both PA and PB are valid. They remit to StoneEagle under different dealer numbers with different contract numbers.

### Remittance constraint

StoneEagle rejects a `GenerateContract` call if the same `ContractNumber` is submitted twice. The `contract_number` is generated as `#{dealer_number}#{plan_code}#{last_6_vin}#{mmyy}` (see `ProductPackages::Finalize#generate_contract_id`). Different orgs have different `dealer_number`s, so their contract numbers are distinct. However, if the VIN check incorrectly blocked one deal or allowed both to proceed in a confused state, downstream remittance could attempt submission of a conflicting record.

---

## Root Cause 1: VIN check not scoped to current organization

### Affected endpoints

- `Api::V3::Admin::VehiclesController#create` — called when VIN is submitted on deal creation
- `PackagesController#update_vin` — called when VIN is updated on an existing package

### Pre-fix code — `VehiclesController#create`

```ruby
vehicle_ids_to_check = [vehicle.id]
if (trim = vehicle.selected_vehicle_trim).present?
  matching_trim_ids = VehicleTrim.where(
    year:      trim.year,
    make:      trim.make,
    model:     trim.model,
    trim_name: trim.trim_name
  ).pluck(:id)
  vehicle_ids_to_check |= Vehicle.where(selected_vehicle_trim_id: matching_trim_ids).pluck(:id)
end

same_month_deals = ProductPackage.where(vehicle_id: vehicle_ids_to_check)
                                 .where(cancelled_at: nil)
                                 .created_current_month
same_month_deals = same_month_deals.where.not(id: @product_package.id) if @product_package.present?

if same_month_deals.exists?
  render json: { error: "validation error", message: "Already a deal present with this VIN in this Month" }, status: :unprocessable_entity
  return
end
```

**Problems:**

1. **No org filter** — `ProductPackage.where(vehicle_id: ...)` queries across every organization. Any deal in any tenant with the same VIN in the current month blocks the new deal.

2. **Trim-based expansion** — the query expanded `vehicle_ids_to_check` to ALL vehicles sharing the same `(year, make, model, trim_name)`. This is overly broad: two different physical cars that happen to share a trim spec (common for mass-market vehicles) would trigger the block even if the VINs are different.

3. **`cancelled_at: nil` only** — the check includes packages in any state as long as they weren't cancelled: drafts, quoted-but-unpaid, and fully remitted packages all counted equally. A draft in Org B should not block a real deal in Org A.

4. **`created_current_month` scope (old)** — defined as:
   ```ruby
   scope :created_current_month, -> { where(created_at: Time.current.beginning_of_month..Time.current.end_of_month) }
   ```
   No `remitted_at` constraint — matched packages regardless of whether they were ever actually paid/remitted.

### Pre-fix code — `PackagesController#update_vin`

```ruby
same_month_deals = ProductPackage.where(vehicle_id: existing_vehicle.id)
                                 .where(cancelled_at: nil)
                                 .created_current_month
                                 .where.not(id: @package.id)
```

Same problems: global scope, no org filter, no `remitted_at` requirement.

---

## Root Cause 2: `created_current_month` scope matched non-remitted packages

The intent of the VIN duplicate check is to prevent remitting two contracts for the same VIN in the same billing month — a StoneEagle-level constraint. But the old scope matched packages that were merely **created** this month regardless of whether they were paid or remitted. A package that was started, abandoned, or still in draft counted the same as a completed remittance. This caused false positives: a new legitimate deal was blocked because a prior customer had started (but not completed) a package for the same VIN with a different org.

---

## Fix

### `ProductPackage` — new `remitted_current_month` scope

```ruby
# Replaces: created_current_month
scope :remitted_current_month, ->(org_ids) {
  for_organizations(org_ids)
    .where.not(remitted_at: nil)
    .where(created_at: Time.current.beginning_of_month..Time.current.end_of_month)
}
```

Two additions:
- **`for_organizations(org_ids)`** — joins `organization_users` and filters to the specified org(s); cross-tenant packages are invisible
- **`.where.not(remitted_at: nil)`** — only packages that have actually been remitted count; drafts, unpaid, and abandoned deals are excluded

`for_organizations` is defined as:
```ruby
scope :for_organizations, ->(org_ids) {
  left_joins(user: :organization_users)
    .where(organization_users: { organization_id: org_ids })
    .distinct
}
```

### `VehiclesController#create` — after fix

```ruby
org_ids = [current_user.organization.id]

vin_block = vehicle.product_packages.remitted_current_month(org_ids)
vin_block = vin_block.where.not(id: @product_package.id) if @product_package.present?

if vin_block.exists?
  render json: { error: "validation error", message: "Already a deal present with this VIN in this Month" }, status: :unprocessable_entity
  return
end
```

Changes:
- Query starts from `vehicle.product_packages` — scoped to the specific VIN's vehicle, no trim-based expansion
- Org scope passed explicitly (`current_user.organization.id`) — only this org's packages checked
- Uses `remitted_current_month` — only remitted deals block the new one

### `PackagesController#update_vin` — after fix

```ruby
vin_block = existing_vehicle.product_packages
                            .remitted_current_month([@package.organization.id])
                            .where.not(id: @package.id)

if vin_block.exists?
  flash.now[:alert] = "Already a deal present with this VIN in this Month"
  return render :vin_check, status: :unprocessable_entity
end
```

Same treatment: org-scoped, remitted-only, no trim expansion.

---

## Before / After Comparison

| Behavior | Pre-fix | Post-fix |
|---|---|---|
| Org scope | All orgs (global) | Current org only |
| VIN match | Exact VIN + same trim expansion | Exact VIN only |
| Package state filter | `cancelled_at: nil` (any non-cancelled) | `remitted_at IS NOT NULL` (only remitted) |
| Same-org same-VIN same-month remitted | Blocked ✓ | Blocked ✓ |
| Different-org same-VIN same-month | Blocked ✗ (false positive) | Allowed ✓ |
| Same-org same-VIN draft/unpaid package | Blocked ✗ (false positive) | Allowed ✓ |
| Same-org same-trim different-VIN | Blocked ✗ (false positive) | Allowed ✓ |

---

## Impact

- **Legitimate deals blocked** — any org attempting to create/update a deal for a VIN that existed in another org's packages (even as a draft) received the VIN duplicate error and could not proceed
- **Downstream remittance error** — in cases where the check was bypassed or the packages ended up in an inconsistent state, `GenerateContract` failed with `product_and_payment_remitted_error` because the remittance pipeline saw what it interpreted as a duplicate contract
- **Trim false positives** — high-volume vehicles (Toyota Camry LE, Honda Civic EX, etc.) have many cars sharing the same `(year, make, model, trim_name)`; the trim expansion made the check fire for any VIN on a popular model if any org in the system had touched it this month

---

## Prevention

1. **Any cross-org query needs explicit org scoping** — `ProductPackage` queries should always start from `for_organizations(org_ids)` or from a scoped association (`user.product_packages`, `vehicle.product_packages` where vehicle is org-owned). A bare `ProductPackage.where(...)` without an org filter is almost always a multi-tenancy bug.

2. **Duplicate checks must match the actual business constraint** — the constraint is "same VIN, same org, same billing month, already remitted." If the check is looser than the constraint it models, it produces false positives. Map scope conditions 1:1 to the rule being enforced.

3. **`remitted_at` is the source of truth for billing month deduplication** — `created_at` is when the user started the flow; `paid_at` is payment; `remitted_at` is when the contract was actually submitted to StoneEagle. Only `remitted_at` matters for the StoneEagle duplicate-contract rule.

4. **Remove trim-based expansion from VIN checks** — VINs are globally unique per vehicle. A trim match is not a VIN match. Structural similarity (same year/make/model/trim) does not imply the same physical car or the same contract.
