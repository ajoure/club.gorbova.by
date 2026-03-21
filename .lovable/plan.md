# Да, согласен, с учетом правок:

1. **План в целом уже соответствует новому ТЗ**, потому что:
  - отдельная вкладка/форма ИП убирается;
  - остается `Физлицо` и `Организация / ИП`;
  - `ЮЛ → ИП switch-flow` удаляется;
  - после УНП lookup форма не переключает страницу, а просто выбирает нужную canonical-форму внутри общего блока;
  - адрес после МНС идет через Google normalization.
2. **Нужно ужесточить правило Google validation.**  
Сейчас в плане есть небольшая логическая вилка:
  - в одном месте ты пишешь, что матч должен подтверждаться по `street + house + city`,
  - ниже — что если `house` отличается, то просто сохраняем GRP house, а Google все равно можно применить.  
  Для этого бага выбираю более безопасный вариант:
  - если у GRP уже есть `street`, `house`, `city`,
  - Google candidate можно применять **только если совпадают street + city и не конфликтует house**;
  - если Google возвращает другой дом, такой candidate **не применять автоматически вообще**;
  - `place_id / lat / lng / postal_code` тоже не брать от конфликтующего candidate.
3. **Нужно явно зафиксировать, что unified form использует тот же Google-result pipeline, что и ручной autocomplete.**  
Это важно, потому что твое ТЗ именно про это:  
после УНП адрес должен нормализоваться **так же**, как если бы пользователь руками выбрал тот же адрес в Google Maps.  
Поэтому в плане допиши:
  - использовать тот же adapter/parser Google Places, что и в `StructuredAddressBlock`;
  - не делать второй упрощенный путь нормализации.
4. **Нужно добавить правило по сохранению opposite namespace.**  
Так как в одной строке таблицы живут и `ent_*`, и `leg_*`, в плане надо явно написать:
  - source of truth при reopen = `client_type`;
  - если сохранено как `entrepreneur`, форма и read-path читают только `ent_*`;
  - если сохранено как `legal_entity`, читают только `leg_*`;
  - старые значения из другой ветки не должны визуально или логически подтягиваться обратно.  
  Иначе можно получить старые хвосты вроде `ЗАО` после reopen.
5. **Нужно сохранить existing flow** `Другое` **без регрессии.**  
Сейчас план концентрируется на unified form, но обязательно допиши:
  - `OrgFormCombobox` с `Другое` сохраняется;
  - full/short manual form продолжает работать;
  - after save + reopen эти поля не теряются.  
  Даже если это не основной предмет патча, regress допускать нельзя.
6. **Не просто “EntrepreneurDetailsForm kept in codebase”, а провести usage-check.**  
В плане лучше написать:
  - перед удалением рендера проверить, нет ли других активных поверхностей, где `EntrepreneurDetailsForm` еще используется;
  - если есть — не ломать их в этом патче;
  - если нет — оставить как deprecated, но без удаления логики в этом спринте.
7. **Добавь отдельный DoD на unified flow.**  
Помимо уже написанного, нужен отдельный verify-кейс:
  - пользователь в блоке `Организация / ИП`,
  - вводит УНП ИП,
  - форма автоматически становится `Индивидуальный предприниматель`,
  - имя без префикса и без кавычек,
  - адрес нормализован через Google,
  - after save + reopen остается `entrepreneur`,
  - не появляется старое `ЗАО/ООО`.
8. **Добавь отдельный DoD на manual Google compare.**  
Нужно доказать:
  - после УНП lookup + Google normalization результат не хуже ручного выбора того же адреса из Google autocomplete;
  - `ул. Панфилова`, `дом 2`, `49л`, индекс не теряются;
  - если Google candidate конфликтует, GRP-address остается как canonical base.

Итог:  
**План хороший и почти готов к отправке**, но я бы добавил эти правки обязательно:

- жесткое правило match по `house`,
- reuse того же Google pipeline, что и у ручного autocomplete,
- правило чтения по `client_type`,
- no-regression для `Другое`,
- verify unified ИП-flow after save/reopen.
- &nbsp;
- &nbsp;
- Plan: PATCH 3.2.4 — Unified Организация/ИП form

## DIAGNOSE

### Current state

- `PayerTypeSelector` shows 3 tabs: Физлицо, ИП, Юрлицо
- `LegalEntityDetailsForm` saves `client_type: "legal_entity"`, uses `leg_*` fields
- `EntrepreneurDetailsForm` saves `client_type: "entrepreneur"`, uses `ent_*` fields
- Switch-flow ЮЛ→ИП exists via `pendingGrpPayload` / `onRequestSwitchToEntrepreneur`
- DB: `client_legal_details` has both `ent_*` and `leg_*` columns in same row, `client_type` string discriminator

### What needs to change

1. **PayerTypeSelector**: 3 tabs → 2 tabs (Физлицо, Организация/ИП)
2. **Unified form** replaces both `LegalEntityDetailsForm` and `EntrepreneurDetailsForm` for the "Организация/ИП" case
3. **entity_kind from lookup** determines org form (ИП → `Индивидуальный предприниматель`), no page switch
4. **client_type derivation**: if org form = `Индивидуальный предприниматель` → save as `entrepreneur` with `ent_*` fields; otherwise → save as `legal_entity` with `leg_*` fields
5. **Remove**: switch-flow, `pendingGrpPayload`, `onRequestSwitchToEntrepreneur`, IP switch dialog
6. **Google normalization**: validated match — Google applied only if street+house+city confirm same address

## DRY RUN

### DB impact

- No new tables, migrations, or EF
- Same `client_legal_details` table, same columns
- `client_type` derived from selected org form at save time

### Fields mapping in unified form


| Form field             | ИП save path                    | ЮЛ save path        |
| ---------------------- | ------------------------------- | ------------------- |
| УНП                    | `ent_unp`                       | `leg_unp`           |
| Форма                  | `leg_org_form` (canonical full) | `leg_org_form`      |
| Название               | `ent_name`                      | `leg_name`          |
| Адрес                  | `ent_address*`                  | `leg_address*`      |
| Руководитель           | hidden for ИП                   | `leg_director_*`    |
| Действует на основании | `ent_acts_on_basis`             | `leg_acts_on_basis` |
| client_type            | `entrepreneur`                  | `legal_entity`      |


### Reused components

- `OrgFormCombobox` — already includes ИП in dictionary
- `StructuredAddressBlock` — unchanged
- `GrpAddressEnricher` — safe merge already done
- `GrpAddressParser`, `GrpAutofillService` — entity_kind already exists

### What's removed

- `EntrepreneurDetailsForm.tsx` — no longer rendered from `LegalDetails.tsx` (keep file for now, just unused)
- `pendingGrpPayload` state in `LegalDetails.tsx`
- `handleSwitchToEntrepreneur` callback
- `onRequestSwitchToEntrepreneur` prop
- IP switch AlertDialog in `LegalEntityDetailsForm`

## EXECUTE — files and changes

### 1. `PayerTypeSelector.tsx` — 2 types instead of 3

Replace 3-button grid with 2 options:

- `individual` → Физлицо (паспортные данные)
- `organization` → Организация / ИП (УНП, реквизиты)

Note: internally we still use `ClientType` for DB save, but the selector now maps to a UI-level discriminator. The actual `client_type` (`legal_entity` | `entrepreneur`) is derived at save time from the selected org form.

### 2. `LegalDetails.tsx` — simplified orchestration

- Remove `pendingGrpPayload`, `handleSwitchToEntrepreneur`
- `selectedType` becomes `"individual" | "organization"` for UI
- When `selectedType === "organization"` → render unified `OrganizationDetailsForm`
- When editing existing record: if `client_type` is `entrepreneur` or `legal_entity` → open as `organization`
- Remove `EntrepreneurDetailsForm` import/render
- `getTypeLabel`: `entrepreneur` and `legal_entity` both show as "Организация/ИП"

### 3. New: `OrganizationDetailsForm.tsx` — unified ЮЛ/ИП form

Based on current `LegalEntityDetailsForm` but unified:

**Form schema:**

- `unp` (9 digits, required)
- `org_form` (required, from OrgFormCombobox — includes ИП)
- `name` (required, min 3)
- `director_position` (conditional: hidden if ИП)
- `director_name` (conditional: hidden if ИП)
- `acts_on_basis` (different defaults: "Устава" for ЮЛ, "свидетельства о гос. регистрации" for ИП)
- `bank_*`, `phone`, `email`

**Key behaviors:**

- `isEntrepreneur` derived from `org_form === 'Индивидуальный предприниматель'`
- Director fields hidden when `isEntrepreneur`
- Acts on basis default changes based on form

**GRP lookup handler:**

- If `entity_kind === 'entrepreneur'`: set `org_form = 'Индивидуальный предприниматель'`, `name = clean_name || name`
- If `entity_kind === 'legal_entity'`: set `org_form = org_form_full`, `name = clean_name`
- No switch dialog, no page navigation
- Address: `emptyAddress() + parsed_address` → enrichment with validated Google match

**Save handler:**

```
if isEntrepreneur:
  client_type = 'entrepreneur'
  ent_unp, ent_name, ent_address*, ent_acts_on_basis
else:
  client_type = 'legal_entity'  
  leg_unp, leg_name, leg_org_form, leg_address*, leg_director_*, leg_acts_on_basis
```

**Load handler (editing):**

- If `initialData.client_type === 'entrepreneur'`: populate from `ent_*` fields, set org_form to ИП
- If `initialData.client_type === 'legal_entity'`: populate from `leg_*` fields

**Google validated normalization:**

- After GRP parse, build query → call Google
- Before applying Google result, validate match:
  - Compare normalized street, house, city
  - If match confirmed: take Google's postal_code, region, country, place_id, lat, lng
  - If mismatch: keep GRP-parsed address as-is
- Apartment/office always from GRP parser (Google rarely returns it)

### 4. `GrpAddressEnricher.ts` — add validated match check

Add match validation before merging:

- Extract street/house/city from both preliminary and Google result
- Normalize for comparison (lowercase, trim prefixes like "ул.", "улица")
- If street AND city match (fuzzy): apply Google enrichment
- If mismatch: return preliminary as-is, `enriched: false`
- House comparison: if Google house differs from GRP house, keep GRP house

### 5. Cleanup in `LegalEntityDetailsForm.tsx`

Remove:

- `onRequestSwitchToEntrepreneur` prop
- `ipSwitchDialogOpen` / `pendingIpPayload` state
- `handleIpSwitchConfirm` / `handleIpSwitchCancel`
- IP switch AlertDialog JSX

This file may still be used by admin or other surfaces. If not, mark as deprecated.

## Scope

- No new tables or migrations
- No new edge functions
- No changes to `IndividualDetailsForm`
- `EntrepreneurDetailsForm` kept in codebase but no longer rendered from settings
- Refactoring is UI + form logic only; DB schema unchanged

## DoD

- PayerTypeSelector shows 2 options: Физлицо, Организация/ИП
- UNP lookup for ЮЛ: org form auto-selected, name filled, address parsed + Google-validated
- UNP lookup for ИП: org form = "Индивидуальный предприниматель", name = clean (no prefix, no quotes)
- No switch dialog, no page-level handoff
- Director fields hidden for ИП
- Google normalization: validated match (street+city must confirm); mismatch → no auto-apply
- Панфилова/дом 2/49л preserved after enrichment
- Postal code filled from Google when match confirmed
- After save: `client_type` = `entrepreneur` for ИП, `legal_entity` for others
- After reopen: all fields correctly loaded from appropriate `ent_*` or `leg_*` columns
- Canonical JSONB and legacy string consistent