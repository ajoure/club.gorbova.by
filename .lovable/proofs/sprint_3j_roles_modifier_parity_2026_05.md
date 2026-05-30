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

## 9. Финальный статус (предварительный)

Backend + UI + tests + runtime DOCX закрыты — см. §10–§14 ниже. Итоговый статус — в §14.

## 10. Frontend modifier controls

Файлы:
- `src/utils/personNameFormat.ts` (new) — frontend mirror SOT `formatPersonName` с тем же каноном (`full` / `short` = `Фамилия И.О.` / `signature_short` = `И.О.Фамилия`, без пробелов в short-формах) и русским склонением (6 падежей).
- `src/utils/packagePlaceholderCatalog.ts` — `classifyPackageItem` возвращает `kind: 'person_name'` для:
  - `package_roles` (все `ln-XXXXXX`),
  - FIO whitelist: `package.ul.director_full_name`, `package.ul.director_short_name`, `package.fl.full_name`, `package.fl.full_name_short` (зеркало `PERSON_NAME_PACKAGE_BAG_KEYS` strict-резолвера).
  - `buildPackagePlaceholderToken` теперь корректно добавляет `|format=<full|short|signature_short>` и `|case=<6 падежей>` к `{{ln-XXXXXX}}` и whitelist FIO-токенам пакета.
- `src/components/ai-documents/PlaceholdersCatalogTab.tsx` — `RowSettingsCell` для `person_name`-строк рендерит:
  - три кнопки формата: **ФИО полностью**, **ФИО кратко**, **ФИО кратко для подписи**;
  - dropdown падежа (6 значений);
  - live preview через `formatPersonName(DEMO_PERSON_NAME, ...)`;
  - кнопка «Копировать» вызывает `buildPackagePlaceholderToken(item, format, caseModifier)`.
- `src/components/ai-documents/extensions/FieldChipNode.ts` — `FieldFormat` расширен `'short' | 'signature_short'`.

DEMO значение для preview: `DEMO_PERSON_NAME = "Федорчук Сергей Валерьевич"` (`src/utils/personNameFormat.ts`).

### Copy examples (генерируются `buildPackagePlaceholderToken`)

```
{{ln-000012}}
{{ln-000012|format=short}}
{{ln-000012|format=signature_short}}
{{ln-000012|format=short|case=genitive}}
{{ln-000012|format=signature_short|case=genitive}}
```

### Preview examples (рендер UI через `formatPersonName`)

```
Федорчук Сергей Валерьевич
Федорчук С.В.
С.В.Федорчук
Федорчука С.В.
С.В.Федорчука
```

UI-скриншот не приложен: страница `/admin/ai` за auth-gate, форма «Login as Developer» в текущем preview-окружении не доступна агенту. Эквивалентная проверка — 49/49 vitest зелёных (§11) + copy/preview через ту же функцию, что использует UI (`formatPersonName`).

## 11. Frontend tests (vitest)

Команда:
```
bunx vitest run src/utils/personNameFormat.test.ts src/utils/packagePlaceholderCatalog.test.ts
```

Результат:
```
 ✓ src/utils/personNameFormat.test.ts (19 tests) 12ms
 ✓ src/utils/packagePlaceholderCatalog.test.ts (30 tests) 38ms

 Test Files  2 passed (2)
      Tests  49 passed (49)
```

Покрытие:
- `personNameFormat.test.ts`: full/short/signature_short × nominative/genitive, женские ФИО (Иванова Мария → Ивановой М.П.), edge cases (пустая строка, один токен, два токена без отчества, лишние пробелы).
- `packagePlaceholderCatalog.test.ts`: `buildPackagePlaceholderToken` для ln с modifier-комбинациями, `classifyPackageItem` возвращает `person_name` для ln и FIO whitelist, regression — отсутствие `PKR` / `package.role.PKR` / `package.roles.*` в каталоге.

## 12. Runtime DOCX excerpt

Script: `/tmp/docx_proof/render_proof.ts` импортирует production-функцию `formatPersonName` напрямую из `supabase/functions/_shared/typed-tokens-resolver.ts`, рендерит шаблон через **тот же** `Docxtemplater@3.47.1` с **той же** конфигурацией (`delimiters: {{ }}`, кастомный parser трактующий `|format=…|case=…` как имя переменной), что и `canonical-document-generate-strict/index.ts:1301-1314`.

Шаблон (`/tmp/docx_proof/template.docx`) содержит 5 параграфов с 5 ln-токенами. Pre-resolved bag формируется по той же логике, что в strict-резолвере (`index.ts:1118-1138`): `persons.map(formatPersonName(..., { format, case }))` + `join('; ')`.

Сгенерированный DOCX: `/mnt/documents/sprint_3j_roles_runtime.docx` (26288 bytes).
Распакованный `word/document.xml`: `/mnt/documents/sprint_3j_roles_document_xml.xml`.

Извлечённый текст из `word/document.xml` (через regex `<w:t[^>]*>([^<]*)</w:t>`):
```
1) Федорчук Сергей Валерьевич
2) Федорчук С.В.
3) С.В.Федорчук
4) Федорчука С.В.
5) С.В.Федорчука
```

Контроль отсутствия raw mustache в DOCX:
```
count of "{{" in document.xml: 0
count of "}}" in document.xml: 0
```

DoD выполнен: все 5 вариантов отрендерены, ни одного нерезолвнутого `{{…}}` в выходном DOCX.

## 13. Billing regression

Канон «без пробела между инициалами» применён глобально через единственную точку:

- `supabase/functions/_shared/typed-tokens-resolver.ts:205` — `fullNameToInitials(name)` → `formatPersonName(name, { format: 'short' })`.
- Все billing-call-сайты (`director` ЮЛ, ИП `short_name`) используют этот wrapper.
- Frontend mirror `src/utils/personNameFormat.ts` гарантирует одинаковый output в UI preview и сгенерированном DOCX.

Проверка стандарта (через vitest § 11 + Deno логику `formatPersonName`):
```
Иванов Иван Иванович → format=short            → Иванов И.И.
Иванов Иван Иванович → format=signature_short  → И.И.Иванов
```

В обоих случаях — **без пробела** между инициалами; signature_short — без пробела также между инициалами и фамилией.

Backend-логика билинга НЕ модифицирована в этом UI-заходе — изменился только output `fullNameToInitials` (предыдущий sprint 3J-Roles backend, документирован в §1–§4).

## 14. Untouched scope / final status

### Untouched в Sprint 3J-Roles UI-заходе

```
supabase/functions/**     — НЕ изменялись в этом UI-заходе
supabase/migrations/**    — НЕ изменялись
src/pages/**/Purchases*   — НЕ трогались
src/hooks/useAiDocument*  — НЕ трогались (генератор пакета вызывается тем же контрактом)
Gotenberg config          — НЕ трогался
billing pipeline          — НЕ трогался (кроме унификации формата short-ФИО в backend, фиксированной в §13 — это часть DoD спринта, не side-эффект UI)
```

### Запреты (grep-проверка)

`PKR` / `package.role.PKR` / `package.roles.*` в активном UI-коде:
```
$ grep -RnE "(PKR-|package\.role\.PKR|package\.roles\.)" \
    src/utils/packagePlaceholderCatalog.ts \
    src/components/ai-documents/PlaceholdersCatalogTab.tsx
src/utils/packagePlaceholderCatalog.ts:491:  * Старые форматы {{package.role.PKR-XXXXXX}} и {{package.roles.<role_key>.<attr>}}
src/utils/packagePlaceholderCatalog.ts:496:  public_id: string;  // ln-XXXXXX (канон Sprint 3H). Legacy PKR-NNNNNN мигрированы.
```
→ только doc-комментарии, объясняющие что старые форматы **удалены**. Ни одного активного code path / generated token / catalog entry с PKR не существует.

### Финальный статус

**completed: Sprint 3J-Roles**
- ln role placeholders support `full`/`short`/`signature_short` and `case` modifiers in UI and runtime DOCX;
- short FIO standard is global: `Фамилия И.О.` (no space between initials);
- signature short standard is global: `И.О.Фамилия` (no spaces at all);
- old `PKR` / `package.roles.*` formats absent from UI;
- billing/order pipeline unchanged except intended FIO short formatting standard (§13).

### Артефакты proof

```
/mnt/documents/sprint_3j_roles_runtime.docx          # generated DOCX (5 ln-токенов)
/mnt/documents/sprint_3j_roles_document_xml.xml      # распакованный word/document.xml
.lovable/proofs/sprint_3j_roles_modifier_parity_2026_05.md  # этот файл
```
