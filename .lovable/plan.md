# да, согласен, с учетом правок:

1. `city` **не удалять и не заводить второй SoT.**  
Правильный вариант: existing backend `city` оставить как storage field, в UI переименовать в **«Населённый пункт»**. Отдельное параллельное поле `settlement` в UI убрать, чтобы не было дубля. Для DOCX оставить семантический computed placeholder `settlement_display`, который формируется отдельно из типа и названия населённого пункта; это уже соответствует ранее зафиксированной логике истории/шаблонов.
2. `settlement_display` **и UI-поле не смешивать.**  
В плане нужно явно разделить:
  - UI / backend storage: existing `city` → «Населённый пункт»;
  - DOCX token: `{{settlement_display}}` как вычисляемое значение для `г. Минск`, `аг. Ратомка`, `п. ...`, `д. ...`.  
  Иначе снова появится риск двойного хранения.
3. **Snapshot-архитектуру не раздувать новой сущностью, если колонки уже есть.**  
Раз в аудите зафиксировано, что snapshot-колонки уже добавлены в `ai_generated_documents`, в PATCH 2.6 не создавать параллельную таблицу/новый контур без отдельного обоснования. Делаем enrichment текущей модели, а не вторую систему истории.
4. **Паспорт: запретить кириллицу на двух уровнях.**  
В плане нужно явно записать:
  - input-level guard: кириллица сразу подсвечивается и блокирует сохранение;
  - paste/save-level guard: пробелы/дефисы можно убрать, но кириллицу не транслитерировать и не сохранять.  
  Никакой silent replacement `МП -> MP` быть не должно.
5. **Адрес: зафиксировать mapping полей без двусмысленности.**  
В плане нужно прямо записать:
  - `city` = населённый пункт с типом (`г. Минск`);
  - `city_district` = район города (`Фрунзенский район`);
  - `district` = район области / региона (`Минский район`).  
  И отдельно потребовать backfill, если `Фрунзенский район` уже ошибочно попал в `settlement/city`.
6. `Доп. строка` **убрать только из UI, не ломая backend compat.**  
В плане стоит уточнить: если поле уже есть в типах/данных, не делать destructive delete без audit; сначала убрать из формы и formatter usage, затем cleanup по proof.
7. **Нормализацию и адресные преобразования держать в сервисах/adapters, не размазывать по UI.**  
Это соответствует общему стандарту: бизнес-логика должна быть в service layer, а интеграционные преобразования — в adapters; изменения проходят diagnose → plan → dry run → execute → verify, без пропуска стадий.
8. **Не потерять уже утверждённые правовые проверки для пакета ГОСУ.**  
В PATCH 2.6 это не главный scope, но в плане нужно явно записать, что existing validation warnings по годовому собранию сохраняются: дата годового собрания — не позднее 31 марта, извещение — не менее чем за 30 дней, документы для ознакомления — не менее чем за 20 дней.
9. **Документы в электронном виде должны сохранять состав реквизитов и оформление аналогично бумажным.**  
Это важно для части snapshot/template generation: при доработке шаблонов и истории не ломать состав реквизитов и внешний формуляр документа.
10. **В финальном отчёте по PATCH 2.6 обязателен отдельный proof-блок по address bug.**  
Не только “поле добавлено”, а конкретно:
  - было: `Фрунзенский район` попадал в населённый пункт;
  - стало: `г. Минск` в населённом пункте, `Фрунзенский район` в `Район города`, `Минский район` в `Район`.
11. **В финальном отчёте по PATCH 2.6 обязателен отдельный proof-блок по passport bug.**  
Проверить минимум 3 сценария:
  - ввод `MP4187696` → сохраняется;
  - paste `MP 4187696` → нормализуется в `MP4187696`;
  - ввод/paste `МП4187696` → красная ошибка, сохранение запрещено.
12. **Не трогать protected flow** `IndividualDetailsForm` **без отдельного патча.**  
Если это другая сущность/другой домен, не смешивать её с person card PATCH 2.6. Сначала закрыть person card flow, потом отдельно решать legal-details form, если понадобится.
13. PATCH 2.6 — Corrected Implementation Plan

## Current State (from audit)

1. **Passport normalizer** (`passportNormalizer.ts`): Currently does **silent Cyrillic→Latin transliteration** (МП→MP). User requires: **reject Cyrillic, no transliteration**.
2. **Address layout** (`StructuredAddressBlock.tsx`): Has both `city` ("Город") and `settlement` ("Населённый пункт") as separate fields + `address_line_2` ("Доп. строка"). User requires: rename `city` to "Населённый пункт", remove `settlement` from UI, remove `address_line_2` from UI.
3. **GooglePlacesAdapter**: Maps `sublocality` → `settlement`. Should map to `city_district` instead.
4. **Snapshot columns**: Already added in migration `20260324180250`. DB work done.
5. `**passport_number_full**`: Already added in same migration. DB work done.
6. **Legacy `passport_series`/`passport_number**`: Still referenced in 14 files. `IndividualDetailsForm.tsx` (separate legal-details form, NOT person card) uses `ind_passport_series`/`ind_passport_number` — this is a different entity type, protected flow, not touched.

## Changes

### 1. Fix passport normalizer — reject Cyrillic (PATCH 2.6B correction)

**File:** `src/lib/persons/passportNormalizer.ts`

- Remove `CYRILLIC_TO_LATIN` map entirely
- Remove transliteration step
- Keep only: trim → uppercase → remove spaces/hyphens → validate `^[A-Z0-9]+$`
- If input contains Cyrillic after cleanup → `success: false`
- Add helper `containsCyrillic(input)` for real-time UI validation

### 2. Fix passport UI validation messages (PATCH 2.6C)

**File:** `src/components/ai-requisites/PersonFieldsForm.tsx`

- Update `handlePassportBlur` error: "Используйте латиницу. Серия и номер паспорта вводятся только английскими буквами и цифрами, без пробелов."
- Add real-time Cyrillic detection on `onChange` — if Cyrillic detected, show red border + inline error immediately (not just on blur)
- On paste: strip spaces/hyphens (normalization), but if Cyrillic remains → error, don't save

### 3. Address layout overhaul (PATCH 2.6D)

**File:** `src/components/shared/StructuredAddressBlock.tsx`

FULL_LAYOUT changes:

- `city` label: "Город" → "Населённый пункт", placeholder: "г. Минск"
- Remove `settlement` row
- Remove `address_line_2` row
- Reorder to match spec:

```text
1. Страна (country_name)
2. Область / Регион (region)          col-span-2
3. Район (district)
4. Населённый пункт (city)            col-span-2
5. Район города (city_district)
6. Индекс (postal_code)
7. Улица (street)                     col-span-2
8. Дом (house)
9. Корпус (building)
10. Квартира (apartment)
```

COMPACT_LAYOUT: rename `city` label to "Населённый пункт".

`handleFieldChange`: Remove `settlement` clearing logic. Keep `city` clearing logic (now semantically = населённый пункт).

### 4. GooglePlacesAdapter — map sublocality to city_district

**File:** `src/lib/address/adapters/GooglePlacesAdapter.ts`

- Change: `sublocality_level_1 / sublocality / neighborhood` → map to `city_district` instead of `settlement`
- This ensures city districts from Google go to the correct field

### 5. Address types cleanup

**File:** `src/lib/address/types.ts`

- Keep `settlement` in the type (backend compat) but remove from `AUTOCOMPLETE_FIELDS`
- Remove `address_line_2` from `MANUAL_ONLY_FIELDS`

**File:** `src/lib/address/utils.ts`

- `emptyAddress()`: keep `settlement` and `address_line_2` as empty strings (backend compat)
- `formatFullAddress()`: skip `settlement` if same as `city`
- `buildAutocompleteQuery()`: remove `settlement` case

### 6. Address normalization service

**File:** `src/lib/address/AddressNormalizationService.ts`

- `payloadToStructuredAddress()`: keep mapping `settlement` but it won't show in UI

### 7. Formatter — no changes needed

`formatStructuredAddress.ts` already handles `city` as locality with prefix detection (`г.`, `д.`, `п.`). The `settlement` field fallback in formatter can stay for backward compat with old data.

### 8. PersonFieldsForm address mapping

**File:** `src/components/ai-requisites/PersonFieldsForm.tsx`

- `parseAddress()`: keep `settlement` mapping for old data compat
- `addressToStructured()`: keep `settlement` in payload

### 9. Snapshot enrichment in edge function (PATCH 2.6A)

**File:** `supabase/functions/ai-generate-document-package/index.ts`

- On document generation, populate `token_manifest_snapshot`, `source_trace`, `warnings_snapshot` into the insert

### 10. Resolver + matrix updates (PATCH 2.6E)

**File:** `src/utils/aiDocumentSnapshotResolver.ts` — already uses `passport_number_full` with fallback. No changes needed.

**File:** `docs/token_matrix.md` — update address semantics note: `city` = населённый пункт

---

## What does NOT change

- Backend `city` column — not deleted
- `settlement` field in TS types — kept for compat
- `IndividualDetailsForm.tsx` (legal-details, separate from person card) — protected flow
- `generate-from-template` edge function — protected billing flow  
- Telegram/email editors
- RLS policies
- Existing `legal_details.*` registry entries

## Mapping proof: city → Населённый пункт


| Before                | After                                    |
| --------------------- | ---------------------------------------- |
| Backend field `city`  | **Not changed** — same DB column         |
| UI label "Город"      | → "Населённый пункт"                     |
| UI field `settlement` | **Removed from UI** — no parallel SoT    |
| Stored value          | `г. Минск`, `п. Ратомка`, `д. Шабановка` |
| Google `sublocality`  | → `city_district` (was `settlement`)     |
