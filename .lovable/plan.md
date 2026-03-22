

# Fix: "Центральный район" showing for Minsk address

## Root Cause

The `isBelarus()` check likely fails for some records where `country_code` and `country` are not stored in the JSONB payload (older records or data gaps). When `isBelarus()` returns `false`, the generic formatter runs and includes the district field.

Additionally, even when `isBelarus()` passes, the `isCityDistrict()` helper won't catch districts like "Центральный район" because "Центральный" doesn't contain "Минс" (the city root). This matters for non-Minsk cities with city-internal districts.

## Fix (1 file)

**`src/lib/address/formatStructuredAddress.ts`**:

1. **`isBelarus()`** — add fallback: if `isMinsk(structured.city)` is true, return `true` (Minsk = Belarus, always)
2. **`isCityDistrict()`** — for Minsk, always return `true` (all Minsk districts are city-internal). For other cities, keep current conservative heuristic but also match common city-district patterns like "Центральный", "Ленинский", "Октябрьский" etc. that are never oblast-level districts.

These two guards together ensure district is never shown for Minsk regardless of data completeness.

## Proof examples (after fix)

The formatter will produce:
1. Minsk: `ул. Панфилова, д. 2, пом. 49л` / `220035, г. Минск`
2. Non-Minsk BY: `ул. Ленина, д. 3, пом. 12` / `231300, Гродненская обл., Лидский р-н, г. Лида`
3. City district filtered: Minsk + "Центральный район" → district hidden
4. Fallback (only postal + city): single line `220030, г. Минск`

