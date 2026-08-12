# RCA: GetRates ERATING_TRIMREQ Failure — Missing Suffix-Match Strategy for SE Class-Prefix Trims

**Date:** 2026-05-20  
**PR:** [#6296 — add suffix-match strategy for trim candidate selection](https://github.com/BlinkerGit/blinker/pull/6296)  
**Severity:** Medium-High — VIN validation blocked for vehicles with SE class-prefix trim notation; agent required to manually select trim, causing deal friction and potential wrong selections  
**Component:** `StoneEagleClient#pick_trim_candidate`

---

## Summary

StoneEagle's `GetRates` API sometimes returns error code `ERATING_TRIMREQ` when a VIN is submitted without a trim specifier. The error response lists valid trim names available for that VIN. Blinker automatically picks the right trim from that list by comparing it to the vehicle's `series` field using `pick_trim_candidate`. The method had three strategies — exact, digit-collapse, and prefix — but none of them handled StoneEagle's class-prefix naming convention (e.g., `"L LAREDO"`, `"4WD SV"`). After normalization these become `"LLAREDO"` and `"4WDSV"`, neither of which matched a vehicle's plain `"LAREDO"` or `"SV"` series via the existing three strategies. The picker returned `nil`, causing `StoneEagleTrimRequired` to be raised and surfacing a trim-selection modal to the agent — even though the correct trim was unambiguously determinable.

---

## System Context: `ERATING_TRIMREQ` Flow

```
call_get_rate_api(subject, context)
  → GetRates.for(vehicle, new_used:, se_trim: nil)   ← no trim on first attempt
  → POST /scsautoservice.asmx  (StoneEagle GetRates SOAP)
  → extract_error_from_xml(xml)
      → code = "ERATING_TRIMREQ"
      → desc = "VIN's available Trims are L LAREDO, L LIMITED, L OVERLAND.Resubmit"
  → handle_trim_retry(...)
      → GetRates.extract_trims_from_error(desc)
            regex: /VIN['']s available Trims are\s+(.+?)\.Resubmit/i
            → ["L LAREDO", "L LIMITED", "L OVERLAND"]
      → pick_trim_candidate(trims, vehicle)   ← bug here pre-fix
      → if nil → raise StoneEagleTrimRequired
      → if chosen_trim → retry GetRates with <Trim>chosen_trim</Trim>
```

When `pick_trim_candidate` returns nil, `StoneEagleTrimRequired` propagates as `GatewayError`:

**In `UpdateVinCommand`:**
```ruby
{ success: false, error_message: "..., Choose among L LAREDO, L LIMITED", trim_selection: true, trims: [...] }
```

**In `PackagesController`:**
```ruby
render json: { error: "SE_TRIM_REQUIRED", trims: e.cause.trims }, status: :conflict
```

MissionControl renders a trim-selection modal asking the agent to manually choose from `["L LAREDO", "L LIMITED", "L OVERLAND"]`. The agent — who knows the vehicle is a `LAREDO` — sees unfamiliar SE class-prefix notation and may select incorrectly or be unable to proceed.

---

## `normalize_trim` — The Root of the Mismatch

```ruby
def normalize_trim(trim_string)
  trim_string.to_s.upcase.gsub(/[^A-Z0-9]/, "")
end
```

Strips every non-alphanumeric character (spaces, hyphens, slashes) and uppercases. Examples:

| Input | Normalized |
|---|---|
| `"LAREDO"` | `"LAREDO"` |
| `"L LAREDO"` | `"LLAREDO"` |
| `"L LIMITED"` | `"LLIMITED"` |
| `"L OVERLAND"` | `"LOVERLAND"` |
| `"4WD SV"` | `"4WDSV"` |
| `"2WD SV"` | `"2WDSV"` |
| `"1LT"` | `"1LT"` |
| `"LT RS"` | `"LTRS"` |

StoneEagle's class-prefix naming convention prepends a vehicle-class letter (or drivetrain prefix like `"4WD"`) separated by a space before the trim name. After normalization, the class prefix is concatenated to the trim: `"L LAREDO"` → `"LLAREDO"`. The vehicle's Blinker-side `series` field (`"LAREDO"`, from VinAudit) contains only the trim name, not the class prefix.

---

## Root Cause: Three Strategies, None Handles Class-Prefix Suffix

### Pre-fix `pick_trim_candidate`

```ruby
def pick_trim_candidate(trims, vehicle)
  return nil if trims.blank?

  offered_norm = trims.map { |t| normalize_trim(t) }  # ["LLAREDO", "LLIMITED", "LOVERLAND"]
  series = vehicle.series                              # "LAREDO"
  norm = normalize_trim(series)                        # "LAREDO"

  # 1) Exact
  if (idx = offered_norm.index(norm))
    return trims[idx]
  end

  # 2) Leading-digits collapse  "1LT" -> "LT"
  if /^\d+[A-Z0-9]+$/.match?(norm)
    base = norm.sub(/^\d+/, "")
    if (idx = offered_norm.index(base))
      return trims[idx]
    end
  end

  # 3) Prefix fallback  "LT RS" -> "LT"
  if (prefix = offered_norm.find { |t| norm.start_with?(t) })
    return trims[offered_norm.index(prefix)]
  end

  nil   # ← reached for "LAREDO" vs ["LLAREDO", "LLIMITED", "LOVERLAND"]
end
```

### Walkthrough — Jeep Grand Cherokee LAREDO

| Strategy | Test | Result |
|---|---|---|
| 1) Exact | `"LAREDO"` ∈ `["LLAREDO","LLIMITED","LOVERLAND"]`? | **Fail** — "LAREDO" ≠ "LLAREDO" |
| 2) Digit-collapse | `/^\d+[A-Z0-9]+$/`.match?(`"LAREDO"`)? | **Skip** — no leading digit |
| 3) Prefix | `"LAREDO".start_with?("LLAREDO"|"LLIMITED"|"LOVERLAND")`? | **Fail** — none is a prefix of "LAREDO" |
| **Return** | | **nil → raises `StoneEagleTrimRequired`** |

The class prefix `"L"` is prepended to `"LAREDO"` in SE's response, forming `"LLAREDO"`. The relationship is that `"LAREDO"` is a **suffix** of `"LLAREDO"`, not a prefix or exact match.

### Walkthrough — Nissan Rogue SV with drivetrain prefix

| Strategy | SE offered normalized | Vehicle norm | Result |
|---|---|---|---|
| 1) Exact | `["4WDSV","2WDSV","4WDSE"]` vs `"SV"` | — | **Fail** |
| 2) Digit-collapse | `"SV"` starts with digit? | — | **Skip** |
| 3) Prefix | `"SV".start_with?("4WDSV"|"2WDSV"|"4WDSE")`? | — | **Fail** |
| **Return** | — | — | **nil** |

Same failure. `"4WDSV"` ends with `"SV"`, making this a suffix-match candidate too.

---

## Fix: Fourth Strategy — Suffix Match

```ruby
# 4) Suffix match — handles SE class-prefix style e.g. "L LAREDO" -> "LLAREDO".end_with?("LAREDO")
if (suffix = offered_norm.find { |t| t.end_with?(norm) })
  return trims[offered_norm.index(suffix)]
end
```

Checks whether any normalized offered trim **ends with** the normalized vehicle series. This exactly models the class-prefix naming pattern: SE prepends a class code to the actual trim name, so the trim name always appears as a suffix.

### Walkthrough — same scenarios, post-fix

**Jeep LAREDO:**
```
offered_norm = ["LLAREDO", "LLIMITED", "LOVERLAND"]
norm         = "LAREDO"

"LLAREDO".end_with?("LAREDO")   → true  ← match found
→ return trims[0] = "L LAREDO"
→ retry GetRates with <Trim>L LAREDO</Trim>  → success
```

**Nissan Rogue SV (4WD variant):**
```
offered_norm = ["4WDSV", "2WDSV", "4WDSE"]
norm         = "SV"

"4WDSV".end_with?("SV")   → true  ← first match wins
→ return "4WD SV"
→ retry GetRates with <Trim>4WD SV</Trim>  → success
```

---

## Full Strategy Hierarchy (Post-Fix)

```
normalize_trim(vehicle.series) → norm

1) Exact match
   offered_norm.index(norm)
   → "LT" vs ["LS","LT","LTZ"] → returns "LT"

2) Leading-digits collapse
   /^\d+[A-Z0-9]+$/.match?(norm) → base = norm.sub(/^\d+/, "")
   → "1LT" → base "LT" → "LT" in offered → returns "1LT"'s match "LT"

3) Prefix fallback
   norm.start_with?(offered_entry)
   → "LT RS" → "LT" offered → "LTRS".start_with?("LT") → returns "LT"

4) Suffix match  ← NEW
   offered_entry.end_with?(norm)
   → "LLAREDO" ends with "LAREDO" → returns "L LAREDO"

5) nil → raises StoneEagleTrimRequired → trim selection modal shown
```

Each strategy is more permissive than the previous, running only after all stricter strategies have failed. This ordering preserves correctness: an exact match is always preferred over a suffix match.

---

## Impact Before and After Fix

| Scenario | Pre-fix | Post-fix |
|---|---|---|
| Vehicle series exactly matches SE trim | Returns correct trim (Strategy 1) | Unchanged ✓ |
| Vehicle series has leading digit: "1LT" | Returns "LT" match (Strategy 2) | Unchanged ✓ |
| Vehicle series is substring of its own offered trim: "LT RS" → "LT" | Returns via prefix (Strategy 3) | Unchanged ✓ |
| SE returns class-prefix format: "L LAREDO" for vehicle "LAREDO" | nil → trim modal shown to agent | Returns "L LAREDO" (Strategy 4) ✓ |
| SE returns drivetrain-prefix: "4WD SV" for vehicle "SV" | nil → trim modal shown | Returns "4WD SV" (Strategy 4) ✓ |
| No strategy matches | nil → trim modal | nil → trim modal (unchanged) |

---

## Edge Cases and Risks in the Fix

### 1. Ambiguous drivetrain variants (first match wins)
If SE returns `["4WD SV", "2WD SV"]` for a vehicle with series `"SV"`, `find` returns `"4WDSV"` (first in list). The vehicle may actually be FWD. StoneEagle returns trims in their canonical order — no secondary signal available to distinguish. Pre-fix: this was a manual modal choice. Post-fix: auto-selects based on list order. Acceptable tradeoff since auto-selection eliminates friction and the GetRates result will still return correct plan rates; manual override remains possible if the first-try GetRates result returns no plans.

### 2. Single-letter series: `"S"`
`"S"` as a suffix would match any offered trim ending in `"S"` (e.g., `"SPORTS"` ends with `"S"`). For vehicles with single-letter `series`, this could over-match. In practice: the suffix check only runs after exact, digit-collapse, and prefix all fail. For a single-letter `series = "S"`, Strategy 1 (exact) would match any trim literally named `"S"` first. Strategy 4 then only fires if no exact `"S"` is in the offered list, at which point picking the first suffix-ending-in-`"S"` is a reasonable best-effort.

### 3. Class prefix collision
SE class letters like `"L"`, `"D"`, `"A"` are short. `"LAREDO"` ends with `"O"`, not `"LAREDO"`. The concern is if a vehicle series is itself a short suffix that legitimately matches multiple offered trims. The normalization (strip non-alphanumeric) means `"L LAREDO"` → `"LLAREDO"` → `.end_with?("LAREDO")` — this correctly requires the full series name, not just one letter, so collision risk is low for meaningful trim names (≥ 3 chars).

---

## Why This Was Not Caught Earlier

1. **ERATING_TRIMREQ is not always triggered** — GetRates only returns this error when a VIN has multiple valid trims registered in SE's database. Many VINs (especially common makes) have a single trim option and never trigger this path.

2. **Auto-retry was introduced later** — before the auto-retry mechanism (`handle_trim_retry`), every ERATING_TRIMREQ showed the trim modal. The three initial strategies were added incrementally to cover observed failure cases (digit-prefix for GM trims, prefix-fallback for "LT RS" patterns). The SE class-prefix pattern ("L LAREDO") is specific to Jeep/Chrysler/Stellantis vehicles from certain model years.

3. **No automated spec coverage** — `pick_trim_candidate` has no unit tests for the class-prefix scenario. The PR's manual testing checklist includes testing against SE class-prefix responses but relies on manual verification.

---

## Prevention

1. **Unit-test `pick_trim_candidate` against all four strategies** — the function is pure logic (no DB or API calls); it should have a spec that exercises each strategy with a concrete example:
   ```ruby
   # strategy 4
   trims   = ["L LAREDO", "L LIMITED", "L OVERLAND"]
   vehicle = instance_double(Vehicle, series: "LAREDO")
   expect(client.send(:pick_trim_candidate, trims, vehicle)).to eq("L LAREDO")
   ```

2. **Log `pick_trim_candidate` strategy used** — when auto-selection succeeds, log which strategy was used and the input/output. This creates a signal for detecting new failure patterns (e.g., a fifth strategy being needed) without requiring manual reproduction.

3. **Capture ERATING_TRIMREQ frequency in metrics** — if the trim modal is still shown after all four strategies fail, that is a signal that a new trim naming convention has appeared. Tracking the modal-shown rate per vehicle make/model surfaces emerging patterns before they become widespread deal blockers.

4. **Consider fuzzy matching as final fallback** — a Levenshtein/Jaro-Winkler distance check as a last resort (strategy 5) would catch cases that aren't exact/digit/prefix/suffix but are still clearly the same trim name (typos, extra characters). This is higher complexity and should only be added if suffix match proves insufficient for new SE naming patterns.
