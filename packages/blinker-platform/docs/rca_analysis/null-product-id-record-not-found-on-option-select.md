# RCA: "Product Not Found" on Product Selection — Null Key in `params[:options]` Iteration

**Date:** 2026-05-20  
**PR:** [#6274 — hotfix issue for not found product_id](https://github.com/BlinkerGit/blinker/pull/6274)  
**Severity:** High — `ActiveRecord::RecordNotFound` raised mid-flow when agent/customer selects a plan and moves to next step; deal progression blocked  
**Error:** `Couldn't find Product with 'id'=` (nil or blank)  
**Components:** `ProductPackages::Update#call`, `Api::V3::Admin::Products::PackagesController#update`

---

## Summary

When the user selects a vehicle and clicks "Next" to proceed to the monthly payment/product selection step, the frontend sends a PUT request to update the `ProductPackage` with the chosen product options. The `params[:options]` array contains `[productId, productOptionId]` pairs. In certain state conditions — stale Redux store after vehicle re-selection or re-rating — the options array contained one or more null/blank pairs (`[nil, nil]`). The backend iterated over these pairs without any nil guard, calling `package.products.find(nil)` which raised `ActiveRecord::RecordNotFound`. The deal flow was completely blocked.

---

## Entry Point: Option Selection Flow

```
Agent selects product plan → clicks Next
  → MissionControl PUT /api/v3/admin/products/packages/:id
      body: {
        options: [[productId, productOptionId], ...],   ← may contain [nil, nil]
        surcharges: [...],
        ...
      }
  → PackagesController#update
      → ProductPackages::Update.new(package, params, current_user).call
          → params[:options].each do |key, value|
              product = package.products.find(key)       ← find(nil) → RecordNotFound
```

---

## Frontend Options Payload Construction

`productsForm.tsx` builds the options array from the Redux store's `selectedOptions`:

```ts
// productsForm.tsx  line 138
options: selectedCoverageProducts.selectedOptions.map((o: any) => [
  o.productId,
  o.id,
]),
```

`selectedCoverageProducts.selectedOptions` is typed as `{ productId: number; id: number }[]`. It lives in the Redux store and is seeded from the previously loaded product package state. The local component state initializes with:

```ts
const [selectedProductAndOption, setSelectedProductAndOption] = useState({
  productId: null,
  optionId: null,
})
```

### When does `selectedOptions` contain null entries?

Several scenarios produce a null/blank product ID in the options array:

**Scenario A — Vehicle re-selection resets product state before Redux store clears**

When the user navigates back to the vehicle step and selects a new vehicle:
1. `UpdateProductPackage` triggers a new `GetRates` call → old products soft-deleted, new products created
2. The Redux store's `selectedOptions` still holds the stale `{ productId: oldId, id: oldOptionId }` from the previous quote
3. Before the store refreshes (async), user clicks Next
4. `options: [[oldId, oldOptionId]]` is sent
5. `package.products.find(oldId)` → `products` is scoped `-> { existing }` (WHERE deleted_at IS NULL) → soft-deleted product excluded → **RecordNotFound**

**Scenario B — Redux store initialized with null entry**

In certain navigation paths (back/forward in the refi flow), `selectedOptions` in the Redux store may be initialized or reset to an array containing a null/blank entry: `[{ productId: null, id: null }]`.

This serializes to:

```json
{ "options": [[null, null]] }
```

Rails receives `params[:options] = [[nil, nil]]`. Iterating: `key = nil, value = nil`.

**Scenario C — Gap product with no options loaded**

In `membershipAndGapSelection.tsx`:

```ts
const gapOption = gapProduct?.options[0]   // undefined if options array is empty
options: isGapAccepted ? [[gapProduct?.id, gapOption?.id]] : [],
```

If `gapProduct.options` is empty (race condition before products load), `gapOption` is `undefined` and `gapOption?.id` is `undefined`. JavaScript JSON serializes `undefined` as `null`:

```json
{ "options": [[101, null]] }
```

This produces `key = 101, value = nil` — product found, but `find(nil)` on the option line raises RecordNotFound.

---

## Root Cause: No Nil Guard in `params[:options]` Iteration

### Pre-fix `ProductPackages::Update#call`

```ruby
if params[:options]
  package.clear_option_selections

  params[:options].each do |key, value|
    # ← NO nil guard here

    product = package.products.find(key)                          # raises if key is nil
    product.update!(selected_product_option_id: value)

    option = product.product_options.find(value)                  # raises if value is nil
    selected_surcharge_codes = params[:surcharges] & option.surcharges.map { |s| s["SurchargeCode"] }
    option.update!(selected_surcharge_codes:)
  end
end
```

`package.products` uses the `existing` scope (`WHERE deleted_at IS NULL`). `Product.find(nil)` raises `ActiveRecord::RecordNotFound` immediately. In Rails, `ActiveRecord::Base.find(nil)` raises:

```
ActiveRecord::RecordNotFound: Couldn't find Product with 'id'=
```

This propagates up through `PackagesController#update` which has no rescue for `RecordNotFound`, returning 500 to the frontend. MissionControl displays the error.

Note: `package.clear_option_selections` already ran before the error:

```ruby
def clear_option_selections
  products.update_all(selected_product_option_id: nil)
end
```

This unconditionally clears all `selected_product_option_id` values on existing products. When the iteration then fails on the invalid key, the previously selected options are already wiped — so even a retry shows no pre-selected option.

---

## Fix

```ruby
params[:options].each do |key, value|
  next unless key.present? || value.present?    # ← guard added

  product = package.products.find(key)
  product.update!(selected_product_option_id: value)

  option = product.product_options.find(value)
  selected_surcharge_codes = params[:surcharges] & option.surcharges.map { |s| s["SurchargeCode"] }
  option.update!(selected_surcharge_codes:)
end
```

`next unless key.present? || value.present?` — skips the iteration if **both** `key` and `value` are blank/nil. In Ruby, `nil.present? = false`, `"".present? = false`. This guards against the `[nil, nil]` pair case.

### Guard logic table

| key | value | `key.present? \|\| value.present?` | Action |
|---|---|---|---|
| nil | nil | `false \|\| false` = false | `next` — **SKIP** ✓ |
| `""` | `""` | `false \|\| false` = false | `next` — **SKIP** ✓ |
| `101` | `nil` | `true \|\| false` = true | continues (value nil handled downstream) |
| `nil` | `501` | `false \|\| true` = true | continues (key nil → find(nil) still fails) |
| `101` | `501` | `true \|\| true` = true | continues — **NORMAL PATH** ✓ |

---

## Residual Risk After the Fix

The `||` condition skips only when **both** key and value are blank. Two partial-null cases still reach `find`:

### Case: `key = nil, value = 501`
- `nil.present? || 501.present?` → `false || true` → true → does NOT skip
- `package.products.find(nil)` → still raises `RecordNotFound`

### Case: `key = 101, value = nil`
- `101.present? || nil.present?` → `true || false` → true → does NOT skip
- `package.products.find(101)` → succeeds
- `product.update!(selected_product_option_id: nil)` → clears selection
- `product.product_options.find(nil)` → raises `RecordNotFound`

The `&&` operator would be strictly safer:

```ruby
next unless key.present? && value.present?
# = skip if EITHER key OR value is blank
```

This would guard against all three problematic cases. The `||` choice in the hotfix specifically addresses the observed `[nil, nil]` scenario and is a minimal change to unblock production.

---

## Secondary Issue: `clear_option_selections` Before the Guard

```ruby
package.clear_option_selections   # ← runs unconditionally before iteration

params[:options].each do |key, value|
  next unless key.present? || value.present?
  ...
end
```

`clear_option_selections` sets `selected_product_option_id = nil` on ALL existing products before iterating. If the iteration then fails (e.g., partial-null case not caught by the guard), the package ends up with no selected products — a worse state than before the request. This is an atomicity gap: the clear and the re-select should succeed or fail together.

The correct pattern is to clear selections only after verifying all option pairs are valid, or to wrap the entire block in a transaction with rollback on failure:

```ruby
ActiveRecord::Base.transaction do
  package.clear_option_selections
  params[:options].each do |key, value|
    next unless key.present? && value.present?
    product = package.products.find(key)
    ...
  end
end
```

---

## Data Flow Comparison

### Pre-fix

```
Agent selects vehicle → GetRates → new products created, old soft-deleted
Agent clicks Next (stale Redux state: options = [[nil, nil]])
  → PUT /packages/:id  { options: [[null, null]] }
    → clear_option_selections (wipes all selected_product_option_ids)
    → each [nil, nil]:
        product = package.products.find(nil)
        → ActiveRecord::RecordNotFound raised
        → 500 returned to frontend
        → "Product Not Found" shown
    → package left with NO selected options (clear already ran)
```

### Post-fix

```
Agent selects vehicle → GetRates → new products created, old soft-deleted
Agent clicks Next (stale Redux state: options = [[nil, nil]])
  → PUT /packages/:id  { options: [[null, null]] }
    → clear_option_selections
    → each [nil, nil]:
        nil.present? || nil.present? → false → next   ← skipped
    → no RecordNotFound
    → package returns with cleared selections (no product selected)
    → UI re-renders product selection step ✓
```

---

## Prevention

1. **Use `&&` instead of `||` for the nil guard** — `next unless key.present? && value.present?` prevents all null-key and null-value cases, not just when both are simultaneously null. The current `||` leaves `[nil, present]` and `[present, nil]` still reachable.

2. **Wrap option-selection in a transaction** — `clear_option_selections` and the option re-assignment should be atomic. If the re-assignment fails for any reason, the clear should be rolled back to avoid leaving the package with no selected products.

3. **Validate options server-side before clearing** — parse and validate all `[key, value]` pairs before calling `clear_option_selections`. Fail fast with a 422 if any pair is invalid, before mutating state.

4. **Frontend should not send stale/null option pairs** — the Redux store should be cleared or refreshed when the vehicle changes and `GetRates` returns a new product set. Stale product IDs in `selectedOptions` after a re-rating are a source of subtle bugs beyond this specific error.

5. **Test coverage** — add a spec for `ProductPackages::Update` that sends `options: [[nil, nil]]` and verifies the call completes without error and without clearing existing selections. Also add a spec for `options: [[nil, 501]]` (partial null) to document the current behaviour.
