# RCA: GenerateContract Net Cost Mismatch After VIN Update

**Date:** 2026-05-20  
**Severity:** High — contract generation blocked, deal cannot finalize  
**Error:** `Submitted Total Contract cost($994.00) is different from Rated Total Contract($1040.00)`  
**Components:** `Packages::UpdateVinCommand`, `StoneEagle::CreateProducts`, `StoneEagle::BookProducts`

---

## Summary

When a deal is created without a VIN and the VIN is added later, StoneEagle re-rates the vehicle using its actual specs. The fresh `GetRates` response returns updated pricing (e.g., $1040.00), but `GenerateContract` submits the stale `net_cost` from the original quote (e.g., $994.00). StoneEagle validates that the submitted cost matches their latest rated cost and rejects the contract. 

---

## System Context

### Pricing Flow (normal path)

```
GetRates (StoneEagle XML) 
  → CreateProducts#perform (parse + persist ProductOption records)
  → ProductOption.base_cost persisted in DB
  → BookProducts#for builds SOAP XML: <NetCost>#{product_option.net_cost}</NetCost>
  → GenerateContract (StoneEagle validates NetCost == their rated cost)
```

`ProductOption#net_cost` is computed at call time:
```ruby
def net_cost
  (base_cost || 0) + surcharge_total
end
```

StoneEagle's validation: the `NetCost` submitted in `GenerateContract` must match the cost from the most recent `GetRates` response for that `QuoteId`.

### VIN-update path (broken)

```
Deal created (no VIN)
  → GetRates called → base_cost = $994.00 stored in ProductOption
  → VIN added later → UpdateVinCommand#perform called
      → get_product_quotes(autocreate: false)  ← does NOT persist to DB
      → vin_matches_product? detects price change ($994 → $1040)
      → sync_price_change called with price_confirmed: false
          → sets @needs_price_confirmation = true, does NOT update DB
  → Response: { success: false, needs_price_confirmation: true, new_base_cost: 1040.0 }
  → UI prompts user to confirm price change
  → If user confirms → UpdateVinCommand called again with price_confirmed: true
      → sync_price_change updates base_cost + monthly_payment in DB
      → BUT: remit NOT updated (pre-fix: extra_attrs was empty for matching_option path)
  → GenerateContract triggered
      → set_latest_quote_for_product re-calls GetRates, updates quote_id only
      → BookProducts sends <NetCost>#{product_option.net_cost}</NetCost>
          = base_cost ($994.00 stale) + surcharge_total
      → StoneEagle compares against rated remit-based cost ($1040.00) → MISMATCH
```

---

## Root Cause 1: `UpdateVinCommand` — remit not synced alongside base_cost

**File:** `app/commands/packages/update_vin_command.rb`

### Pre-fix code (lines 93–98)

```ruby
if matching_option.present?
  new_base_cost = matching_option.base_cost.to_f
  new_remit     = matching_option.remit.to_f

  sync_price_change(selected_option, package, new_base_cost, price_confirmed:) if new_base_cost != old_base_cost || new_remit != old_remit
  # ^^^ extra_attrs NOT passed — remit change silently ignored
end
```

When `price_confirmed: true`, `sync_price_change` executed:
```ruby
selected_option.update!({ base_cost: new_base_cost, monthly_payment: new_monthly })
# remit stayed at old value in DB
```

StoneEagle's `GenerateContract` validates `NetCost` against their `remit`-based rated total. Even when `base_cost` was updated, a stale `remit` on the `ProductOption` meant the contract PDF's cost calculation used one figure while `NetCost` used another, causing the mismatch error.

Additionally: if `price_confirmed` was never set to `true` (e.g., the confirmation step was skipped or the client didn't handle `needs_price_confirmation` correctly), `base_cost` was never updated at all, amplifying the problem.

### Fix

```ruby
sync_price_change(
  selected_option, package, new_base_cost,
  price_confirmed:,
  extra_attrs: { remit: matching_option.remit }   # ← added
) if new_base_cost != old_base_cost || new_remit != old_remit
```

`sync_price_change` with `price_confirmed: true` now executes:
```ruby
selected_option.update!({
  base_cost:       new_base_cost,
  monthly_payment: new_monthly,
  remit:           matching_option.remit   # ← synced
})
```

`final_price` is also correctly recalculated and exposed in the confirmation payload:
```ruby
@final_price = (@new_monthly_payment * package.payment_count.to_i + package.down_payment.to_f).ceil(2)
```

---

## Root Cause 2: `CreateProducts` — ProductOption upsert used wrong unique key

**File:** `lib/blinker/gateway/product_services/stone_eagle/create_products.rb`

### Pre-fix code (lines 186–197)

```ruby
option_upserts.each do |attrs|
  ProductOption.upsert(attrs, unique_by: %i[product_id provider_id])
end
```

`provider_id` is the StoneEagle `RateId`, which is tied to a rate class — not to a specific term/deductible combination. A single product can have many options sharing the same `provider_id` but with different `term_id` / `deductible_id`. Using `(product_id, provider_id)` as the uniqueness key meant:

- When VIN is updated and `GetRates` returns fresh rates, `upsert` may match the wrong `ProductOption` row (one with a different term or deductible).
- The matched row gets its `base_cost` overwritten with data intended for a different option.
- The originally selected option (the one sent to `GenerateContract`) retains its stale `base_cost` and `remit`.

This compounds Root Cause 1: even if `UpdateVinCommand` tries to sync pricing, the DB may contain contaminated data from a prior mis-upsert.

### Fix

```ruby
option_upserts.each do |attrs|
  existing = ProductOption.find_by(
    product_id:    attrs[:product_id],
    term_id:       attrs[:term_id],
    deductible_id: attrs[:deductible_id]
  )
  if existing
    existing.update_columns(attrs.except(:product_id, :provider_id, :created_at))
  else
    ProductOption.upsert(attrs, unique_by: %i[product_id provider_id])
  end
end
```

Now each option is located by its structural identity `(product_id, term_id, deductible_id)` — the fields that uniquely identify what coverage is being purchased. When found, `update_columns` refreshes `base_cost`, `remit`, `retail`, `monthly_payment`, and all other rate fields atomically. Only genuinely new options fall through to `upsert`.

---

## Data Flow After Fix

```
VIN added → UpdateVinCommand#perform(price_confirmed: false)
  → GetRates (autocreate: false) → detects $994 → $1040 change
  → returns { needs_price_confirmation: true, new_base_cost: 1040.0,
               new_monthly_payment: X, final_price: Y }

User confirms → UpdateVinCommand#perform(price_confirmed: true)
  → sync_price_change updates ProductOption:
      base_cost       = 1040.00
      remit           = <new remit from GetRates>
      monthly_payment = recalculated

GenerateContract → BookProducts#for
  → <NetCost>#{product_option.net_cost}</NetCost>
      = 1040.00 + surcharge_total   ← now matches StoneEagle's rated cost
  → StoneEagle validates → SUCCESS
```

Separately, `CreateProducts#perform` with `autocreate: true` (called outside the VIN update flow, e.g., during initial product fetch) now upserts options by correct unique key, preventing cross-option price contamination.

---

## Affected Code Paths

| Scenario | Impact |
|---|---|
| Deal created with VIN from the start | Not affected — no VIN update flow |
| VIN added, price unchanged | Not affected — `sync_price_change` not triggered |
| VIN added, price changed, user confirms | **Affected** — `remit` not updated (RC1), may also have DB contamination (RC2) |
| VIN added, price changed, user skips confirmation | **Affected** — `base_cost` never updated, contract fails |
| Re-rating via `autocreate: true` with option overlap | **Affected** — wrong option rows overwritten (RC2) |
| Vehicle dashboard repeated GetRates with changing provider_id | **Affected** — duplicate ProductOption rows (RC3) |

---

## Root Cause 3: Duplicate ProductOptions on Repeated GetRates — Vehicle Dashboard

**File:** `lib/blinker/gateway/product_services/stone_eagle/create_products.rb`  
**Trigger:** Vehicle dashboard page calls `get_product_quotes(autocreate: true)` on load; if called multiple times (re-render, page refresh, polling) and StoneEagle returns a different `provider_id` (RateId) between calls for structurally the same option, duplicate rows are created.

### Database constraint

```sql
-- schema.rb line 1300
UNIQUE INDEX index_product_options_on_product_id_and_provider_id
  ON product_options (product_id, provider_id)
```

The uniqueness constraint is on `(product_id, provider_id)` — **not** on `(product_id, term_id, deductible_id)`. There is no DB-level guard against two options with the same term/deductible but different `provider_id` values.

### Pre-fix upsert path

```ruby
# Only path — no find_by first
ProductOption.upsert(attrs, unique_by: %i[product_id provider_id])
```

**Call 1** — `provider_id = "R1"`, `term_id = 170`, `deductible_id = 25`:
- Unique constraint satisfied → inserts `option.id = 200`

**Call 2** — `provider_id = "R2"` (StoneEagle rotated RateId), same `term_id`/`deductible_id`:
- `(product_id, "R2")` not in DB → inserts `option.id = 201`
- `option.id = 200` still exists — **duplicate**

Both rows represent the same coverage (same term, mileage, deductible) but with different `provider_id`s. Neither is removed. The dashboard renders both, confusing agents and allowing the wrong option to be selected for `GenerateContract`.

### No cascade delete on Product → ProductOption

```ruby
# product.rb
has_many :product_options   # no dependent: :destroy
```

When `old_products.destroy_all` runs at the end of `CreateProducts#perform`, the old product record is deleted but its `ProductOption` rows are **not** cascade-deleted (no `dependent: :destroy`, no FK cascade in the DB). These orphaned options — `product_id` pointing to a deleted `products` row — remain queryable via raw SQL or if cached in memory, and can surface in the dashboard.

### Post-fix path

```ruby
option_upserts.each do |attrs|
  existing = ProductOption.find_by(
    product_id:    attrs[:product_id],
    term_id:       attrs[:term_id],
    deductible_id: attrs[:deductible_id]
  )
  if existing
    existing.update_columns(attrs.except(:product_id, :provider_id, :created_at))
  else
    ProductOption.upsert(attrs, unique_by: %i[product_id provider_id])
  end
end
```

When `provider_id` changes but `term_id` + `deductible_id` match: `find_by` locates the existing option → `update_columns` refreshes pricing in-place, `provider_id` preserved as-is → **no duplicate**.

### Remaining gap

The fix handles the common case (product `plan_id` stable, option `RateId` rotates). If the product-level `provider_id` (StoneEagle `PlanId`) also changes between calls:

1. `Product.upsert_all` with `unique_by: [subject_id, subject_type, provider_id]` → new Product row inserted (new `product_id`)
2. `find_by(new_product_id, term_id, deductible_id)` → nil (old options belong to old `product_id`)
3. New options inserted for new `product_id`
4. `old_products.destroy_all` → old product deleted, **old ProductOptions orphaned** (no cascade)

This edge case still produces orphaned rows. A future hardening: add `dependent: :destroy` to `Product has_many :product_options`.

---

## Prevention

1. **Treat `remit` as part of pricing** — any time `base_cost` changes from a new GetRates response, `remit` must change atomically with it. They come from the same `RateDetails` node in the StoneEagle XML and must stay in sync.

2. **Identify ProductOptions by structural key, not provider rate ID** — `(product_id, term_id, deductible_id)` uniquely identifies a coverage option; `provider_id` identifies a rate class which may serve multiple options.

3. **Validate pre-contract pricing** — before calling `GenerateContract`, assert `product_option.net_cost` matches the latest `GetRates` response for the current VIN. Surface the mismatch to the agent rather than letting StoneEagle reject it.

4. **Add `dependent: :destroy` to `Product has_many :product_options`** — prevents orphaned `ProductOption` rows when old products are cleaned up after re-rating.

5. **Add DB unique index on `(product_id, term_id, deductible_id)`** — enforces at the DB level that no two options for the same product share the same structural identity, regardless of `provider_id` drift.

6. **Test coverage** — add specs for `UpdateVinCommand` where `price_confirmed: true` and the GetRates remit differs from the stored value; assert `ProductOption.remit` is updated. Add specs for `CreateProducts` where `provider_id` rotates between calls; assert no duplicate options.
