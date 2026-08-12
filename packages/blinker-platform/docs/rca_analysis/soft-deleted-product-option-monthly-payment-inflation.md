# RCA: Monthly Payment Inflation from Soft-Deleted Product Options

**Date:** 2026-05-20  
**PR:** [#6281 — fix the amount fluctuation issue for product options](https://github.com/BlinkerGit/blinker/pull/6281)  
**Severity:** High — incorrect monthly payment amounts displayed to agents and customers; pricing discrepancy between quote and contract  
**Issue:** Selecting a plan and moving to monthly payment showed inflated/fluctuating values  
**Component:** `Api::V3::Admin::Products::PackagesController#payment_options`, `Products` concern  

---

## Summary

When a user selects a product plan and navigates to the monthly payment step, the displayed payment options included soft-deleted `Product` records in their calculation. Soft-deleted products are those replaced when a VIN update or re-rating runs — they have `deleted_at` set but their `selected_product_option_id` remains non-nil. The `selected_products` association has no soft-delete guard, so `package.selected_products` returned both the stale deleted product (old pricing) and the current active product (new pricing). Summing monthly payments across both inflated the displayed total, causing a discrepancy between what the agent showed the customer and what the contract actually cost.

---

## Soft-Delete Architecture

`Product` includes the `HideDeleted` concern:

```ruby
# app/models/concerns/hide_deleted.rb
module HideDeleted
  def hide_deleted
    scope :existing,    -> { where(deleted_at: nil) }
    scope :existing_at, ->(timestamp) { where("deleted_at IS NULL OR deleted_at >= ?", timestamp) }
    scope :deleted,     -> { where("deleted_at IS NOT NULL") }

    define_method :destroy do
      run_callbacks(:destroy) do
        update_attribute(:deleted_at, Time.zone.now)
        @destroyed = true
      end
    end
  end
end
```

`Product` model includes `hide_deleted`:

```ruby
class Product < ApplicationRecord
  hide_deleted
  # ...
  has_many :product_options   # no dependent: :destroy
end
```

`destroy` on a `Product` does NOT issue a `DELETE` SQL statement. It sets `deleted_at = Time.zone.now`. The row — and all its associations including `selected_product_option_id` — remain in the database.

### When products are soft-deleted

`StoneEagle::CreateProducts#perform` (`lib/blinker/gateway/product_services/stone_eagle/create_products.rb`) ends every re-rating call with:

```ruby
old_products = subject.products.where.not(quote_id:)
old_products.destroy_all
```

`subject.products` is defined with the `existing` scope:

```ruby
has_many :products,
         -> { existing },       # WHERE deleted_at IS NULL
         as: :subject,
         class_name: Product.name
```

So `old_products` is all non-deleted products that do not belong to the new `quote_id`. `destroy_all` soft-deletes each of them by setting `deleted_at`. The old product's `selected_product_option_id` stays untouched.

**Trigger sequence:**

```
User selects product plan → Product A created, selected_product_option_id = 101
User updates VIN          → UpdateVinCommand → get_product_quotes (autocreate: true)
                             → CreateProducts#perform
                             → Product B created (new quote_id, new pricing)
                             → old_products.destroy_all → Product A: deleted_at = now
                                                           Product A: selected_product_option_id = 101 ← still set
User navigates to payment → payment_options API called
                             → package.selected_products returns [Product A, Product B]
```

---

## Root Cause: `selected_products` association lacks `existing` scope

### Association definition (pre-fix and post-fix — association itself unchanged)

```ruby
# app/models/concerns/products.rb
has_many :selected_products,
         -> { where.not(selected_product_option_id: nil) },
         class_name: "Product",
         as:         :subject
```

The condition is only `selected_product_option_id IS NOT NULL`. There is **no** `deleted_at IS NULL` guard. Compare with `products`:

```ruby
has_many :products,
         -> { existing },                               # WHERE deleted_at IS NULL
         as: :subject,
         class_name: Product.name
```

`products` filters out soft-deleted records. `selected_products` does not.

After a VIN-triggered re-rating:

| Product | deleted_at | selected_product_option_id | Included in `products` | Included in `selected_products` |
|---|---|---|---|---|
| Product A (old) | set (soft-deleted) | 101 (still set) | **No** | **Yes** (pre-fix) |
| Product B (new) | nil | 202 (new option) | Yes | Yes |

---

## Bug: `payment_options` summed stale deleted options

### Pre-fix controller code

```ruby
def payment_options
  package = @user.product_packages.find(params[:id])
  ...
  if %w[selected booked].include?(package.status) || !package.vin_matches_product
    selected_products = package.selected_products            # ← returns Product A + Product B

    payment_options = POSSIBLE_PAYMENT_COUNTS.map do |payment_count|
      monthly_payment_value = selected_products.sum do |product|
        product.selected_product_option.calculated_monthly_payment(
          payment_count,
          BigDecimal(params.require(:down_payment)),
          package.discount
        )
      end

      {
        payment_count:,
        value:         monthly_payment_value.ceil(2),
        total:         (monthly_payment_value * payment_count + BigDecimal(params[:down_payment])).ceil(2)
      }
    end

    render json: payment_options
  end
end
```

`POSSIBLE_PAYMENT_COUNTS = [6, 12, 18, 24]`

`calculated_monthly_payment` is:

```ruby
def calculated_monthly_payment(payment_count, down_payment, discount)
  return unless payment_count.present?
  ((total_price(discount) + surcharge_total - down_payment) / payment_count).ceil(2)
end

def total_price(discount = nil)
  price = base_cost + (fees || 0) + (margin || 0)
  # ... apply discount ...
end
```

### Concrete example of inflated payment

| | Product A (soft-deleted, old quote) | Product B (active, new quote) |
|---|---|---|
| base_cost | $500.00 | $550.00 |
| fees | $0 | $0 |
| margin | $200.00 | $200.00 |
| total_price | $700.00 | $750.00 |

**Pre-fix** (6-month plan, $0 down):
```
monthly_payment_value = $700/6 + $750/6 = $116.67 + $125.00 = $241.67
```

**Post-fix** (6-month plan, $0 down):
```
monthly_payment_value = $750/6 = $125.00
```

Agent quotes customer `$241.67/month` instead of the correct `$125.00/month`. When the contract is generated using only the active product at `$750.00`, the contract monthly payment is `$125.00`. The agent told the customer `$241.67`.

---

## Fix

### Single-character change — add `.existing`

```ruby
# Before
selected_products = package.selected_products

# After
selected_products = package.selected_products.existing
```

`.existing` is the scope defined by `HideDeleted`: `WHERE deleted_at IS NULL`. This filters Product A (soft-deleted) out of the calculation, leaving only Product B (active, current pricing).

---

## Prior Art: `.existing` was already applied in `selected_product_ids`

The inconsistency is visible in `ProductPackage`:

```ruby
# app/models/product_package.rb  line 296
def selected_product_ids
  selected_products.existing.map(&:id)     # ← .existing applied here
end
```

`selected_product_ids` explicitly called `.existing` on `selected_products` — this was a known workaround for the same issue in the ID-lookup path. The `payment_options` action was a later addition that did not replicate this guard.

---

## Full Data Flow — Before and After Fix

### Pre-fix

```
VIN updated → CreateProducts re-rates → Product A soft-deleted, Product B created
                                                  ↓
User clicks "Monthly Payment"
  → GET /api/v3/admin/products/packages/:id/payment_options
    → package.selected_products
        → SQL: SELECT * FROM products
               WHERE subject_id = X AND subject_type = 'ProductPackage'
               AND selected_product_option_id IS NOT NULL
        → returns [Product A (deleted_at = T), Product B (deleted_at = nil)]
    → sum of calculated_monthly_payment across BOTH products
    → inflated value returned to MissionControl
    → agent sees wrong monthly payment options
```

### Post-fix

```
VIN updated → CreateProducts re-rates → Product A soft-deleted, Product B created
                                                  ↓
User clicks "Monthly Payment"
  → GET /api/v3/admin/products/packages/:id/payment_options
    → package.selected_products.existing
        → SQL: SELECT * FROM products
               WHERE subject_id = X AND subject_type = 'ProductPackage'
               AND selected_product_option_id IS NOT NULL
               AND deleted_at IS NULL                           ← added by .existing
        → returns [Product B only]
    → sum of calculated_monthly_payment for active product only
    → correct value returned
    → agent sees correct monthly payment options
```

---

## All Paths Using `selected_products` — Audit

| Location | `.existing` applied? | Risk |
|---|---|---|
| `payment_options` controller (pre-fix) | No | **Inflated payments — this bug** |
| `payment_options` controller (post-fix) | Yes ✓ | Fixed |
| `ProductPackage#selected_product_ids` (line 296) | Yes ✓ | Safe |
| `ProductPackage#matching_drive_america_quotes` (line 304) | No | Potential stale data risk |
| `Products#products_selected?` | No | Over-reports as selected if deleted products exist |
| `Products#has_unbooked_selected_products?` | No | May block deal progression |

---

## Prevention

1. **`selected_products` association should include `existing` by default** — the association is defined without soft-delete guard, requiring every call site to remember to add `.existing`. The safer fix is to embed it in the association scope:
   ```ruby
   has_many :selected_products,
            -> { existing.where.not(selected_product_option_id: nil) },
            class_name: "Product",
            as:         :subject
   ```
   This would fix all call sites at once. The current fix is minimal (one `.existing` added at one call site), leaving other usages still at risk.

2. **Soft-delete contract: `selected_product_option_id` should be cleared on soft-delete** — when a product is soft-deleted via `old_products.destroy_all`, setting `selected_product_option_id = nil` at that point would make the `selected_products` association's existing condition (`where.not(selected_product_option_id: nil)`) naturally exclude soft-deleted records, without needing an `existing` guard at all.

3. **Financial calculations must always operate on active records only** — any sum over prices, base_costs, or monthly payments should start from `products.existing` or `selected_products.existing`. A stale deleted product included in a pricing calculation is a billing discrepancy, not just a display bug.

4. **Test coverage** — add a spec for `payment_options` that explicitly soft-deletes a product (simulating re-rating), then calls the endpoint and asserts the returned monthly payment excludes the deleted product's amount.
