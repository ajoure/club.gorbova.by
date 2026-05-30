Да, план правильный. Утверждать можно, но добавь эти правки, чтобы Sprint 3J-Roles не закрыли формально без настоящего parity.

да, согласен, с учетом правок:

**1. UI preview по падежам не должен быть фиктивным**

В плане написано:

UI preview не делает inflection — отдаёт пометку «в нужном падеже после генерации».

Это допустимо только как временный fallback, но не как финальный DoD.

Нужно сделать так:

- если во frontend уже есть helper склонения ФИО — использовать его в preview;
- если frontend helper отсутствует — добавить минимальный frontend mirror для preview;
- fallback «в выбранном падеже после генерации» допустим только если склонение невозможно технически, и тогда Sprint 3J-Roles нельзя закрывать как полный UI parity.

Финальный DoD должен быть:

Preview показывает фактический результат:

Федорчук Сергей Валерьевич

Федорчук С.В.

С.В.Федорчук

Федорчука С.В.

С.В.Федорчука

а не только текстовую пометку.

&nbsp;

**2.**

**format=full**

**в UI не писать в токен**

UI должен показывать опцию «ФИО полностью», но copy должен быть:

{{ln-000012}}

а не:

{{ln-000012|format=full}}

Backend может принимать format=full, но UI по умолчанию его не добавляет.

&nbsp;

**3. Порядок modifiers зафиксировать**

Copy-token всегда строить в таком порядке:

{{ln-000012|format=short|case=genitive}}

{{ln-000012|format=signature_short|case=genitive}}

Backend должен читать оба порядка, но UI всегда пишет один стандартный порядок:

format → case

&nbsp;

**4. Проверить не только роли, но и все ФИО-поля**

В тесты и proof добавить не только {{ln-...}}, но и ФИО-поля из package/billing:

- руководитель ЮЛ;
- ИП ФИО / ФИО кратко;
- ФЛ ФИО / ФИО кратко;
- package role ln.

Цель: доказать, что новый стандарт Федорчук С.В. применился по всей системе, а не только в ролях.

&nbsp;

**5. Runtime DOCX proof обязателен**

Sprint 3J-Roles нельзя закрывать только по vitest.

Нужно реально сгенерировать DOCX и проверить word/document.xml.

Обязательные строки в proof:

Федорчук Сергей Валерьевич

Федорчук С.В.

С.В.Федорчук

Федорчука С.В.

С.В.Федорчука

Также проверить:

{{

}}

не встречаются в generated DOCX.

&nbsp;

**6. Старые форматы удалить из UI полностью**

В UI и copy-output не должно быть:

PKR

package.role.PKR

package.roles.*

full_name

short_name

position

Для роли — только:

{{ln-XXXXXX}}

{{ln-XXXXXX|format=short}}

{{ln-XXXXXX|format=signature_short}}

{{ln-XXXXXX|format=short|case=genitive}}

&nbsp;

**7. Billing regression доказать отдельно**

Так как fullNameToInitials глобально изменён, proof должен показать, что billing не сломан, а просто перешёл на новый стандарт.

Добавить в proof:

fullNameToInitials("Иванов Иван Иванович") → Иванов И.И.

formatPersonName("Иванов Иван Иванович", {format:"signature_short"}) → И.И.Иванов

И указать, что это сознательное изменение по всей системе.

&nbsp;

**8. Diff scope**

Ожидаемый diff действительно frontend + tests + proof, но если runtime proof требует только использования уже готового backend, backend не трогать.

Подтвердить в proof:

supabase/functions/** не изменялись в UI-заходе

supabase/migrations/** не изменялись

/purchases не трогался

Gotenberg не трогался

&nbsp;

**9. Финальный статус Sprint 3J-Roles**

Закрывать только если выполнены все пункты:

completed: Sprint 3J-Roles;

ln role placeholders support full/short/signature_short and case modifiers in UI and runtime DOCX;

short FIO standard is global: Фамилия И.О.;

signature short standard is global: И.О.Фамилия;

old PKR/package.roles formats absent from UI;

billing/order pipeline unchanged except intended FIO short formatting standard.

Ключевая правка: **preview по падежу должен показывать реальный результат**, иначе это не parity с обычными ФИО-плейсхолдерами.

&nbsp;

# План: Sprint 3J-Roles — UI controls + frontend tests + runtime DOCX proof

## Контекст

Backend (`canonical-document-generate-strict` + `ai-generate-package` orchestrator + `canonical-template-apply-markup`) уже умеет:

- `{{ln-XXXXXX}}` → ФИО полностью (per-person, join `;` )
- `|format=short` → `Фамилия И.И.` (без пробела между инициалами)
- `|format=signature_short` → `И.И.Фамилия` (без пробелов)
- `|case=<6 падежей>`
- те же `format=short|signature_short` для whitelist FIO package fields (`package.ul.FLD-000014`, `package.fl.FLD-000372`)
- `fullNameToInitials` глобально перешёл в новый стандарт (без пробела между инициалами) — это распространяется и на billing director / IP short_name.

UI пока выдаёт «роль: модификаторы недоступны» (PlaceholdersCatalogTab.tsx:937–940). Закрыть спринт нужно по DoD пользователя.

## Объём работ (только presentation + тесты + proof; backend/billing/migrations/Gotenberg НЕ трогаем)

### 1. Frontend helper `src/utils/personNameFormat.ts`

- Чистая функция `formatPersonName(fullName, { format })`:
  - `full` → как есть (trim, нормализация пробелов)
  - `short` → `Фамилия И.И.` (без пробела между инициалами, без пробела после)
  - `signature_short` → `И.И.Фамилия` (без пробелов)
- Без склонения (UI preview не делает inflection — отдаёт пометку «в нужном падеже после генерации»). Падеж в UI отображается только как выбранный модификатор и попадает в copy-token; рантайм склоняет backend.
- Экспорт типа `PersonNameFormat = 'full'|'short'|'signature_short'`.

### 2. Расширить `FieldFormat` / catalog helpers (только UI-слой)

- В `src/components/ai-documents/extensions/FieldChipNode.ts` добавить значения `'short' | 'signature_short'` в тип `FieldFormat` (backend whitelist уже их понимает; это согласовано с типизированной шиной UI).
- В `src/utils/packagePlaceholderCatalog.ts`:
  - `classifyPackageItem`: для `package_roles` и для FIO-полей (`package.ul.director_full_name`, `package.ul.director_short_name`, `package.fl.full_name`, `package.fl.full_name_short`) возвращать новый kind `"person_name"`.
  - Новый helper `supportsPersonNameFormats(item): boolean` — true для тех же ключей.
  - `buildPackagePlaceholderToken`: для `package_roles` теперь добавлять `|format=...|case=...` (раньше игнорировалось — это и был блокер).
- Unit-тесты `src/utils/packagePlaceholderCatalog.test.ts`: токены ролей и FIO с модификаторами; гарантия отсутствия `PKR`, `package.role.PKR`, `package.roles.*` в выходе.

### 3. UI `PlaceholdersCatalogTab.tsx`

- В `RowSettingsCell` добавить ветку `kind === "person_name"`: три кнопки формата (ФИО полностью / ФИО кратко / ФИО для подписи) + dropdown падежа. Использовать тот же ToggleGroup/Select-каркас, что и у billing — никакого нового formatter.
- В рендере пакетных строк (PlaceholdersCatalogTab.tsx ~860–944):
  - Заменить `pkgKind === ... ? "text" : "date" → "numeric"` логику: добавить `pkgKind === "person_name"` (новый rowKind).
  - Снять блок `isRolesGroup` → больше не показывать «модификаторы недоступны»; включить `showModifiers = isReady && (pkgKind !== "other")`.
  - Preview-колонка для `person_name` items: рендерить выпадающий список 5 примеров через `formatPersonName` (demo-ФИО `Федорчук Сергей Валерьевич`), для падежа — суффикс «(в выбранном падеже после генерации)». Если ФИО действительно недоступно → fallback «Пример появится после заполнения анкеты документа» (как сейчас).
  - Copy-кнопка использует уже обновлённый `buildPackagePlaceholderToken`.

### 4. Тесты

- `src/utils/personNameFormat.test.ts` (vitest):
  - `Иванов Иван Иванович` → `Иванов И.И.`, `И.И.Иванов`
  - `Федорчук Сергей Валерьевич` → `Федорчук С.В.`, `С.В.Федорчук`
  - Edge: один токен (`Cher`) → возвращает как есть; двойная фамилия — берётся первое слово как фамилия.
- `src/utils/packagePlaceholderCatalog.test.ts` дополнить:
  - `{{ln-000012}}`, `{{ln-000012|format=short}}`, `{{ln-000012|format=signature_short|case=genitive}}`
  - FIO package field `{{package.ul.FLD-000014|format=short}}`
  - Регрессия: `PACKAGE_PLACEHOLDER_CATALOG` и `buildPackageRoleItems` не возвращают `PKR`, `package.role.`, `package.roles.`.

### 5. Runtime DOCX proof

- Через Deno-edge или существующий тестовый orchestrator (повторить путь из Sprint 3J backend proof): подготовить минимальный DOCX-шаблон с 5 токенами:
  ```
  {{ln-XXXXXX}}
  {{ln-XXXXXX|format=short}}
  {{ln-XXXXXX|format=signature_short}}
  {{ln-XXXXXX|format=short|case=genitive}}
  {{ln-XXXXXX|format=signature_short|case=genitive}}
  ```
- Сгенерировать пакет, скачать DOCX, распаковать `word/document.xml`, в proof положить excerpt:
  - `Федорчук Сергей Валерьевич`
  - `Федорчук С.В.`
  - `С.В.Федорчук`
  - `Федорчука С.В.`
  - `С.В.Федорчука`
  - подтверждение отсутствия `{{` / `}}` в excerpt.
- Если нет реального шаблона с ролью — использовать `super_admin` тестовый flow, фикстура с одной ролью + одним person.

### 6. Proof файл

Обновить `.lovable/proofs/sprint_3j_roles_modifier_parity_2026_05.md`, добавить разделы:

- §10 Frontend modifier controls (скриншот таблицы «Пакет: Роли» с тремя format-кнопками + падежом; copy examples; preview examples)
- §11 Frontend tests (список тест-кейсов + результат vitest run)
- §12 Runtime DOCX excerpt (5 строк)
- §13 Billing regression: проверка, что `fullNameToInitials("Иванов Иван Иванович")` → `Иванов И.И.` (новый стандарт без пробела); ссылка на места в коде, где это используется (director short, IP short).
- §14 Подтверждение: `/purchases`, миграции, Gotenberg, billing pipeline не тронуты — diff содержит только `src/utils/personNameFormat*`, `src/utils/packagePlaceholderCatalog*`, `src/components/ai-documents/PlaceholdersCatalogTab.tsx`, `src/components/ai-documents/extensions/FieldChipNode.ts`, proof.
- Финальный статус: `completed`.

## Жёсткие ограничения

- НЕ менять backend (`supabase/functions/**`), миграции, RLS, edge config.
- НЕ менять billing FLD маппинг, customer/executor токены, `/purchases`.
- НЕ создавать отдельных токенов `full_name` / `short_name` / `position` — остаётся один `{{ln-XXXXXX}}` + модификаторы.
- Старые `{{package.role.PKR-...}}` / `{{package.roles.*}}` не должны появляться в выходе каталога (покрыто тестом).

## Diff scope (ожидаемый)

```
src/utils/personNameFormat.ts                          (new)
src/utils/personNameFormat.test.ts                     (new)
src/utils/packagePlaceholderCatalog.ts                 (edit: classifyPackageItem, buildPackagePlaceholderToken, supportsPersonNameFormats)
src/utils/packagePlaceholderCatalog.test.ts            (edit: new cases)
src/components/ai-documents/extensions/FieldChipNode.ts (edit: FieldFormat union)
src/components/ai-documents/PlaceholdersCatalogTab.tsx (edit: rowKind person_name, preview, role row)
.lovable/proofs/sprint_3j_roles_modifier_parity_2026_05.md (append §10–§14, статус completed)
```

## DoD (зеркало пользовательского)

1. `{{ln-XXXXXX}}` в UI имеет controls: ФИО полностью / кратко / для подписи + падеж.
2. Copy формирует все 5 вариантов токена корректно.
3. Preview показывает demo-ФИО в нужном формате (падеж — постфикс-пометка).
4. Vitest зелёный по `personNameFormat.test.ts` и `packagePlaceholderCatalog.test.ts`.
5. Runtime DOCX excerpt подтверждает все 5 рендеров без raw `{{…}}`.
6. Billing short-ФИО регрессия подтверждена (без пробела между инициалами).
7. `PKR` / `package.role.PKR` / `package.roles.*` отсутствуют в каталоге.
8. Proof заполнен, спринт переведён в `completed`.