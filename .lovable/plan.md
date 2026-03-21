# да, согласен, с учетом правок:

1. **ИП-эвристику нужно сделать строже, чем просто** `!orgFormFull && !short_name`**.**  
Иначе можно ошибочно классифицировать редкие ЮЛ без краткого наименования как ИП.  
Добавь правило:
  - `entrepreneur`, если:
    - `orgFormFull` пустой,
    - `short_name` пустой или равен `full_name`,
    - `full_name` похоже на ФИО физлица  
    (2–4 слова, кириллица, слова с заглавной буквы, без кавычек и без признаков оргформы).
  - иначе `unknown`.
2. **Google enrichment должен использовать тот же pipeline, что и ручной autocomplete.**  
Зафиксируй явно:
  - те же place details,
  - тот же `GooglePlacesAdapter`,
  - тот же разбор `addressComponents`,
  - не делать отдельный “упрощенный” путь для УНП-обогащения.
3. **Итерация кандидатов — не просто “первые 3”, а “до первого валидного”.**  
Лучше написать так:
  - пройти по top candidates,
  - для каждого сделать `fetchFields`,
  - применить первый, который проходит validated match,
  - если ни один не проходит — Google не применять.  
  Не привязывайся жестко к числу 3, чтобы не создавать лишнее ограничение.
4. **Проблему stale context нужно чинить жестче.**  
Сейчас в плане недостаточно только сбросить `google_place_id/lat/lng`.  
Добавь:
  - при начале нового ручного поиска по `street` очищать stale-поля, которые тянут старый адрес:
    - `house`
    - `building`
    - `apartment`
    - `postal_code`
    - `google_place_id`
    - `lat/lng`
  - query для `street` не должен автоматически подмешивать старый `city/region`, если адрес до этого был выбран из другого места и пользователь фактически начинает новый поиск.
5. `buildAutocompleteQuery` **лучше описать как иерархический и safe-query builder.**  
Для `street`:
  - либо только `activeValue`,
  - либо `activeValue + country`,
  - но не старые `house/postal_code` и не заведомо stale `city`, если пользователь начинает новый адрес.  
  Иначе снова будет смешение старого и нового адреса.
6. **Добавь отдельный VERIFY-кейс на “второй адрес после первого”.**  
Это было в ТЗ и сейчас это один из главных багов.  
Нужно доказать:
  - сначала выбрать один адрес;
  - потом начать новый поиск по другому адресу;
  - autocomplete не тащит старый контекст;
  - второй адрес заполняется корректно.
7. **DoD нужно расширить.**  
Сейчас не хватает post-save proof. Добавь:
  - ИП: after lookup / after save / after reopen;
  - ЮЛ: after lookup / after enrichment / after save / after reopen;
  - второй ручной адрес: новый поиск после уже заполненного первого адреса.
8. **Для ИП отдельно зафиксируй итог UI-состояние.**  
Не просто “auto-selects ИП”, а:
  - `org_form = Индивидуальный предприниматель`
  - директор скрыт
  - `acts_on_basis = свидетельства о государственной регистрации`
  - имя без префикса и без кавычек
  - after reopen всё это сохраняется.
9. **Оставь явную формулировку fail-safe.**  
Если Google не дал валидного кандидата:
  - берём GRP-parsed address как canonical base;
  - не применяем конфликтующий candidate;
  - не подменяем адрес автоматически.

Итог: план **хороший**, но чтобы он полностью покрывал ТЗ, нужно добавить:

- более надежную эвристику ИП,
- жесткий reset stale context,
- verify на второй адрес,
- post-save / reopen proof по обеим веткам.
- &nbsp;
- Plan: PATCH 3.2.5 — ИП auto-form + Google candidate iteration + stale context reset

## DIAGNOSE

### Bug 1: ИП not auto-selected after lookup

**Root cause** in `GrpAutofillService.ts` lines 161-169:

```
const isEntrepreneur =
  parsed.orgFormFull === 'Индивидуальный предприниматель' ||
  parsed.orgFormShort === 'ИП';
```

MNS returns ИП names as plain "Горбова Екатерина Сергеевна" — no org form prefix. `parseOrgFormAndName` returns `orgFormFull: ''`, so `entity_kind = 'unknown'`.

In `OrganizationDetailsForm.tsx` line 231, `handleGrpConfirm` only sets IP_FORM when `entity_kind === 'entrepreneur'`. For `'unknown'`, neither org_form nor acts_on_basis get set.

**Fix**: Improve ИП detection heuristic in `grpDataToAutofillFields`. MNS ИП entries have distinctive traits:

- `short_name` is empty/null (ЮЛ always has a short_name like "ЗАО «АЖУР инкам»")
- `full_name` has no org form prefix (already detected as `orgFormFull === ''`)
- Name looks like a person name (Cyrillic words, typically 2-3 words starting with uppercase)

Rule: if `orgFormFull` is empty AND `short_name` is empty/null → classify as `entrepreneur`.

### Bug 2: Postal code not filling via Google enrichment

**Root cause** in `GrpAddressEnricher.ts` lines 111-119: Only takes the FIRST suggestion blindly. If Google's first suggestion is a street-level match (without postal code), enrichment misses it. Also, Google doesn't always include postal_code for Belarusian addresses in `addressComponents`.

**Fix**: Iterate through up to 3 suggestions, pick the first one that passes `isValidatedMatch`. This increases chances of finding a candidate with complete data (including postal_code).

### Bug 3: Stale context in autocomplete query

**Root cause** in `buildAutocompleteQuery` (`utils.ts` lines 95-113) and `handleFieldChange` (`StructuredAddressBlock.tsx` line 126): When user starts typing a new street, `buildAutocompleteQuery` assembles query from ALL current fields including old `house`, `city`, `region`, `postal_code`. Google searches for the concatenation of old context + new street, producing irrelevant results.

**Fix**: When user edits `street` or `city` (primary address fields), reset dependent stale fields before building query. Specifically:

- Editing `street` → clear `google_place_id`, `lat`, `lng` from the address
- `buildAutocompleteQuery` should only include fields that come BEFORE the active field in address hierarchy, not after. For `street`: include only `city`, `region`, `country_name` as context — not `house`, `postal_code`.

## Scope

- No new tables / migrations / EF
- No changes to DB schema
- ЮЛ/ИП flow unification already done — only bugfix
- "Другое" flow unchanged — out of scope

## Files and changes

### 1. `GrpAutofillService.ts` — ИП detection fix

Lines 160-169: Add heuristic for `unknown` → `entrepreneur` when no org form found AND `short_name` is empty/null. Pass `short_name` into the classification logic (currently only `parsed` is used, but `data.short_name` is available).

```
const isEntrepreneur =
  parsed.orgFormFull === 'Индивидуальный предприниматель' ||
  parsed.orgFormShort === 'ИП' ||
  (!parsed.orgFormFull && !data.short_name);
```

### 2. `GrpAddressEnricher.ts` — iterate candidates

Lines 111-119: Instead of taking only `suggestions[0]`, iterate through up to 3 suggestions. For each, fetch place details, parse components, run `isValidatedMatch`. Use the first validated candidate. If none validates, return `enriched: false`.

### 3. `src/lib/address/utils.ts` — smarter query building

`buildAutocompleteQuery`: reorder logic so that when the active field is `street`, only higher-level context (`city`, `region`, `country_name`) is included. When active field is `city`, only `region`/`country_name`. This prevents old `house`/`postal_code` from polluting the query.

### 4. `StructuredAddressBlock.tsx` — reset stale meta on edit

In `handleFieldChange`: when user edits `street` or `city`, clear `google_place_id`, `lat`, `lng` from the address value to signal a fresh search context.

## DoD

- ИП lookup auto-selects "Индивидуальный предприниматель", hides director, sets acts_on_basis
- Google enrichment iterates candidates and picks validated match with best data
- Manual address re-entry doesn't carry stale context from previous address
- Existing ЮЛ flow (Панфилова, дом 2, 49л) continues working
- After save + reopen: entrepreneur persists correctly