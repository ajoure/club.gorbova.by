# Sprint 3J-Roles — modifier parity для {{ln-XXXXXX}} и FIO-полей пакета

**Статус:** BACKEND DONE (strict + orchestrator + validator). UI + runtime DOCX proof — следующий шаг.

## 1. Канон ФИО-форматов

| format             | пример (Федорчук Сергей Валерьевич) | падеж genitive |
|--------------------|-------------------------------------|---------------|
| `full` (default)   | `Федорчук Сергей Валерьевич`         | `Федорчука Сергея Валерьевича` |
| `short`            | `Федорчук С.В.` (без пробела между инициалами) | `Федорчука С.В.` |
| `signature_short`  | `С.В.Федорчук` (без пробелов вообще) | `С.В.Федорчука` |

Реализовано в `supabase/functions/_shared/typed-tokens-resolver.ts` → `formatPersonName(fullName, { format, case })`. `fullNameToInitials` — thin wrapper над `formatPersonName(.., 'short')`, что распространяет новый стандарт «без пробела между инициалами» на ВСЕ ФИО (billing director, IP short_name, package, ln).

## 2. strict (`canonical-document-generate-strict/index.ts`)

### `{{ln-XXXXXX[|format=...][|case=...]}}`

- Парсер: `LN_TOKEN_RE` + whitelist `format ∈ {full, short, signature_short}`, `case ∈ ALLOWED_CASES`.
- Резолвер: читает `entry.persons[]` (массив raw ФИО, заполняется orchestrator-ом), форматирует каждого через `formatPersonName(name, { format, case })`, склеивает через `; `.
- `case` без `format` → склонение каждого ФИО как `format=full` + per-person join.

### `{{package.(ul|ip|fl).FLD-XXX[|format=full|short|signature_short][|case=...]}}`

- ФИО-форматы доступны ТОЛЬКО для whitelist bag_keys (`PERSON_NAME_PACKAGE_BAG_KEYS`):
  - `package.ul.FLD-000014` (director_full/short_name)
  - `package.fl.FLD-000372` (full_name / full_name_short)
- Резолвер для FIO: `formatPersonName(entry.raw_full_name, { format, case })`.
- Для не-FIO полей `format=short|signature_short` → `unknown_modifier` (НЕ silent ignore).
- `format=long` сохранён только для `package.*.org_form`.
- `format=words` — для numeric/date (как было).

## 3. orchestrator (`ai-generate-document-package/index.ts`)

- Регексы `FIELD_RE` / `PACKAGE_FLD_RE` / `LN_RE` теперь принимают tail модификаторов
  (раньше токены с `|format=...` падали в `invalid_token_in_package_template`).
- Дедупликация по **base public_id** (без модификаторов): bag-ключ один и тот же для
  `{{ln-000012}}` и `{{ln-000012|format=short|case=genitive}}`.
- Bag-ключи:
  - `preresolved_ln_tokens[lnPublicId]` = `{ value, persons: string[], role_catalog_id, person_id }`
  - `preresolved_package_fields[bagKey]` = `{ value, source, catalog_tech_key, raw_full_name? }`
- `raw_full_name` сохраняется для FIO_PACKAGE_TECH_KEYS (UL director + FL full_name).

## 4. validator (`canonical-template-apply-markup/index.ts`)

- `RX_PACKAGE_ROLE_LN` ужесточён до строгого whitelist:
  ```
  ^ln-\d{6}(?:\|(?:format=(?:full|short|signature_short)|case=(?:6 падежей))){0,2}$
  ```
- Старые `{{package.role.PKR-…}}` и `{{package.roles.*}}` → `invalid_legacy_role_placeholder` (без изменений).

## 5. Тесты (Deno + Vitest) — TODO

Покрытие, которое нужно добавить отдельным мини-шагом:

- `supabase/functions/_shared/personNameFormat_test.ts` — taxонимия Иванов / Федорчук × {full, short, signature_short} × {nominative, genitive}.
- `supabase/functions/_shared/resolve-package-tokens_test.ts` — формат-модификаторы + multi-assignment join.
- `src/utils/personNameFormat.test.ts` + `src/utils/packagePlaceholderCatalog.test.ts` — UI helper и copy examples (`{{ln-000012|format=short|case=genitive}}` и т.д.).

## 6. UI (`PlaceholdersCatalogTab.tsx`, `FieldFormatPicker.tsx`) — TODO

- В группе «Пакет: Роли» (`package_roles`) включить controls «ФИО полностью / кратко / для подписи + падеж».
- Для FIO package items (`package.ul.director_*`, `package.fl.full_name*`) — те же controls.
- `buildPackagePlaceholderToken` уже умеет format (тип `FieldFormat` нужно расширить значениями `short|signature_short` либо ввести параллельный helper).

## 7. Runtime proof — TODO

Сгенерировать пакет с шаблоном, содержащим:
```
{{ln-000012}}
{{ln-000012|format=short}}
{{ln-000012|format=signature_short}}
{{ln-000012|format=short|case=genitive}}
{{package.ul.FLD-000014|format=short}}
{{package.fl.FLD-000372|format=signature_short|case=genitive}}
```
и доказать DOCX excerpt + отсутствие raw `{{…}}`.

## 8. Что НЕ трогали

- `/purchases`, миграции, RLS, edge config, Gotenberg.
- Billing FLD маппинг / customer.* / executor.* токены — без изменений.
- Только что `fullNameToInitials` теперь возвращает `Фамилия И.И.` без пробела между инициалами (раньше был пробел: `Фамилия И. И.`) — это сознательный регрессивный фикс по требованию пользователя, чтобы единый стандарт распространялся на billing и package.

## 9. Финальный статус

OPEN: Sprint 3J-Roles **backend** закрыт (strict умеет рендерить format=short/signature_short для ln и FIO package fields). Не закрываем спринт, пока не покрыты:
1. Frontend modifier controls для группы «Пакет: Роли» + FIO package items.
2. Unit-тесты (Deno + Vitest) по обязательному списку.
3. Runtime DOCX proof.
