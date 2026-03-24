# да, согласен, с учетом правок:

1. **Apartment parser применять только к ручному вводу / fallback после Google, но не к UNP/GRP enrichment path.**  
Это у тебя уже фактически соблюдается, но в плане пропиши явно:
  - parser работает только в `StructuredAddressBlock.handleSelect` и/или при ручном вводе;
  - `enrichAddressViaGoogle()` / GRP auto-fill не трогаем.
2. **Soft normalization для** `city` **делать максимально узко и безопасно.**  
Оставить:
  - только on blur;
  - только для BY;
  - только если значение без существующего префикса;
  - только если это одиночное название города.  
  Но не делать агрессивный глобальный whitelist/guessing, если нет уверенности. Если значение спорное — ничего не менять автоматически.
3. **В compact layout переупорядочивание поддерживаю, но нужен отдельный proof по юрлицам.**  
Так как `OrganizationDetailsForm`, `LegalEntityDetailsForm`, `EntrepreneurDetailsForm` наследуют `StructuredAddressBlock`, в DoD добавь:
  - UNP auto-fill не сломан;
  - compact forms юрлиц после reorder работают корректно;
  - адрес после GRP + Google enrichment отображается в правильном порядке.
4. **Postal code пункт оформить как explicit verify, а не как предположение.**  
В отчёте потом показать:
  - Google select с индексом;
  - индекс сохранился;
  - apartment parser не затёр `postal_code`.
5. **DoD дополнить отдельным кейсом по compact layout.**  
Сейчас есть общий DoD, но добавь явно:
  - compact layout у юрлиц и исполнителей тоже перестроен;
  - existing autocomplete/enrichment flow не сломан.
6. **Что не меняется — оставить, но добавить ещё один пункт:**
  - без изменений `enrichAddressViaGoogle` / GRP flow, кроме того, что они продолжают использовать уже исправленный `GooglePlacesAdapter` и общий `StructuredAddressBlock`.

После этих уточнений mini-PATCH выглядит [правильно.](http://правильно.Mini)

&nbsp;

[Mini](http://правильно.Mini)-PATCH: Address UX Polish + Legal Entity Address Normalization

## What changes

### 1. Reorder FULL_LAYOUT in `StructuredAddressBlock.tsx`

New order — street/house first, administrative context below:

```text
1. Улица (street)              col-span-2
2. Дом (house)
3. Корпус (building)
4. Квартира/Помещение (apartment)
5. Страна (country_name)
6. Область / Регион (region)   col-span-2
7. Район (district)
8. Населённый пункт (city)     col-span-2
9. Район города (city_district)
10. Индекс (postal_code)
```

COMPACT_LAYOUT: same reorder — street/house/building/apartment first, then city/region/postal/country.

### 2. Apartment parser as fallback — new `src/lib/address/parseStreetInput.ts`

Conservative parser, only fires when Google did NOT return `subpremise`:

- Pattern `19-306` — only when dash is in the tail after house number, NOT inside street name
- Pattern `19 кв 306`, `19 кв. 306`, `19, кв 306`
- Regex anchored to end of string to avoid corrupting street names with dashes
- Returns `{ street, house, apartment }` or unchanged input if no confident match

Applied in `StructuredAddressBlock.handleSelect`: after Google merge, if `apartment` is empty and `street` or `house` contain apartment-like patterns, parse and distribute.

### 3. Soft normalization for city on blur

In `StructuredAddressBlock`, add `onBlur` handler for `city` field only:

- Only if `country_code === 'BY'` or `country_name` contains "Беларус"
- Only if value is a single word without existing prefix (`г.`, `д.`, `п.`, `аг.`)
- Only for known large cities (Минск, Брест, Гомель, Гродно, Витебск, Могилёв)
- Prepend `г.`  — e.g., "Минск" → "г. Минск"
- Never during typing, only on blur

### 4. Postal code guard

Verify that `handleFieldChange` hierarchical clearing for `street` does NOT affect postal code set by Google select. The `handleSelect` path sets all fields atomically via `onChange(merged)`, bypassing `handleFieldChange`. No code change needed — document as verified.

### 5. Legal entity forms — already covered

All legal entity forms (`OrganizationDetailsForm`, `LegalEntityDetailsForm`, `EntrepreneurDetailsForm`) already use `StructuredAddressBlock` with the same component. Changes to layout, parser, and normalization apply automatically.

UNP auto-fill flow: UNP → GRP lookup → `enrichAddressViaGoogle()` → `GooglePlacesAdapter.parseComponents()` → address set via `setAddress()`. The enricher already uses `GooglePlacesAdapter` which maps sublocality → `city_district`. The apartment parser in `handleSelect` won't affect enricher flow (enricher sets address directly, not through `handleSelect`). This is correct — GRP addresses don't contain apartments.

## Files


| File                                               | What                                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/components/shared/StructuredAddressBlock.tsx` | Reorder both layouts, add city blur normalization, integrate apartment parser in handleSelect |
| `src/lib/address/parseStreetInput.ts`              | New: conservative apartment extraction parser                                                 |


## What does NOT change

- No DB migrations
- No backend column changes
- No formatter changes
- No GooglePlacesAdapter mapping changes
- No GrpAddressEnricher changes
- No changes to legal entity form components (they inherit StructuredAddressBlock changes)

## DoD

- Field order changed in both full and compact layouts
- `Одинцова 19-306` → street=Одинцова, house=19, apartment=306 (only if Google didn't provide apartment)
- Street names with dashes preserved (e.g., "Карла Маркса" not broken)
- `postal_code` not lost during Google select or apartment parsing
- City soft normalization: "Минск" → "г. Минск" on blur for BY only
- Existing Google/autocomplete flow not broken
- All legal entity forms get same improvements automatically