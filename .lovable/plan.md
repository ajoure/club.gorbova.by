да, согласен, с учетом правок:

## **Правки к Sprint 3L**

План в целом правильный. Перед выполнением добавить и учесть следующие уточнения.

---





## **1.**

`FLD-000011` **— не просто поменять порядок, а убрать неоднозначность FLD lookup**

Проблема с `{{package.ul.FLD-000011}}` из-за двух записей на один FLD:

- `package.ul.name`
- `package.ul.short_name`

Просто поменять порядок — рабочий быстрый фикс, но нужно дополнительно зафиксировать invariant:

```text
Для одного package_token / reused_fld в одной группе не должно быть двух copy_ready строк, если lookup идёт через FLD.
```

Нужно сделать так:

- `{{package.ul.FLD-000011}}` всегда резолвится как `package.ul.short_name`;
- `package.ul.name` не должен перехватывать FLD lookup;
- если `package.ul.name` нужен как отдельное значение, у него должен быть отдельный FLD / отдельный token, но не сейчас.

DoD:

- тест на `findByPackageToken("package.ul.FLD-000011")` возвращает именно `package.ul.short_name`;
- runtime DOCX содержит `ЗАО «Ажур инкам»`, а не `Ажур инкам`.

---

## **2. Проверить frontend-зеркало и edge-зеркало каталога на одинаковость**

Правка должна быть в двух местах:

```text
src/utils/packagePlaceholderCatalog.ts
supabase/functions/_shared/packagePlaceholderCatalog.ts
```

Добавить тест/grep-proof, что `FLD-000011` в обоих каталогах первым резолвится как `package.ul.short_name`.

---

## **3. Должность роли: не всегда мужской род без исключений**

В плане указано всегда делать:

```text
normalizeMasculinePosition(position)
forceGender: 'm'
```

Это подходит для большинства должностей в документах, но может ломать случаи, где должность реально женская или нейтральная.

Для Sprint 3L можно оставить мужской род как default, но добавить safety:

- если `metadata.position_gender` есть — использовать его;
- если нет — default `m`;
- если такого поля в UI пока нет — не добавлять UI, просто предусмотреть чтение из metadata.

Пример:

```ts
const gender = metadata.position_gender === 'f' ? 'f' : 'm';
```

DoD:

- текущий кейс `юрисконсульт + genitive` → `юрисконсульта`;
- пустая должность → только ФИО, как раньше;
- если в будущем появится `position_gender='f'`, resolver не придётся переписывать.

Если не готовы добавлять gender сейчас — явно записать в proof: `position gender support deferred`.

---





## **4. Для**

`ln` **нужен формат без должности**

Сейчас пользовательский кейс требует должность перед ФИО:

```text
юрисконсульта Федорчука Сергея Валерьевича
```

Но в других местах нужен только человек:

```text
Федорчук Сергей Валерьевич
Федорчук С.В.
С.В.Федорчук
```

Поэтому нельзя сделать должность всегда обязательной частью `{{ln-...}}`.

Добавить modifier:

```text
role=person          default, только ФИО
role=with_position   должность + ФИО
```

Или более понятно:

```text
include_position=true
```

Рекомендованный вариант:

```text
{{ln-000012}}                                      → Федорчук Сергей Валерьевич
{{ln-000012|format=short}}                         → Федорчук С.В.
{{ln-000012|format=signature_short}}               → С.В.Федорчук
{{ln-000012|include_position=true}}                → юрисконсульт Федорчук Сергей Валерьевич
{{ln-000012|include_position=true|case=genitive}}  → юрисконсульта Федорчука Сергея Валерьевича
```

Иначе мы сломаем уже закрытый Sprint 3J-Roles, где было зафиксировано:

```text
{{ln-XXXXXX}} без модификаторов → ФИО полностью без названия роли и без должности.
```

Это критичная правка.

---





## **5.**

`join=newline` **должен работать только для role-token**

`join=newline|comma|semicolon` разрешить только для:

```text
{{ln-XXXXXX}}
```

Не разрешать для:

```text
{{package.ul.FLD-...}}
{{package.ip.FLD-...}}
{{package.fl.FLD-...}}
{{field:FLD-...}}
```

Для остальных токенов `join` должен давать `unknown_modifier`.

---

## **6. Порядок modifiers зафиксировать**

UI и copy examples должны всегда писать modifiers в одном порядке:

```text
format → case → include_position → join
```

Пример:

```text
{{ln-000012|format=short|case=genitive|include_position=true|join=newline}}
```

Backend может принимать любой порядок, но UI должен генерировать один канон.

---

## **7. Filename render: проверить оба места и оба ключа**

В `canonical-document-generate-strict` действительно нужно исправить оба места:

- early core props;
- final `ai_generated_documents.file_name`.

Но важно: в `filenameTokenMap` добавить ключи:

```text
package.ul.FLD-000011
package.ul.FLD-000011|format=short
ln-000012
ln-000012|format=signature_short
FLD-000133
field:FLD-000133
```

То есть сохранить совместимость с тем, как `renderFileName` нормализует ключи.

DoD:

- `{{package.ul.FLD-000011}}` резолвится;
- `{{package.ul.FLD-000011|format=short}}` резолвится;
- `{{ln-000012|format=signature_short}}` резолвится;
- `{{field:FLD-000133}}` продолжает резолвиться.

---

## **8. Для имени файла нужен тест с package + ln одновременно**

Добавить тест:

```text
Приказ в {{package.ul.FLD-000011}} от {{field:FLD-000133}} — {{ln-000012|format=signature_short}}
```

Ожидаемо:

```text
Приказ в ЗАО «Ажур инкам» от 31.05.2026 — С.В.Федорчук
```

Если символы `«»` проходят sanitizer — оставить.  
Если sanitizer их меняет — зафиксировать ожидаемое поведение в тесте.

---

## **9. UI каталога ролей: не просто пример строки, а copy-control**

В плане написано добавить «второй пример строки с `|join=newline`». Лучше сделать не отдельную строку, а modifier-control в группе «Пакет: Роли»:

- Разделитель:
  - через `;`
  - через `,`
  - с новой строки

Copy должен давать:

```text
{{ln-000012|join=newline}}
```

Если не успеваем — можно временно показать подсказку/пример, но тогда в proof указать:

```text
join=newline backend ready; full UI control deferred
```

---

## **10. Runtime proof обязателен именно на реальном приказе**

Проверить не только unit tests, а реальную генерацию активного приказа.

Обязательные excerpts из generated DOCX:

```text
ЗАО «Ажур инкам»
юрисконсульта Федорчука Сергея Валерьевича
```

И для filename:

```text
Приказ об организации идеологической работы в ЗАО «Ажур инкам» от 31.05.2026
```

Проверить:

```text
raw {{...}} отсутствуют
PDF создан
ai_generated_documents.file_name заполнен корректно
```

---

## **11. Не закрывать Sprint 3L без проверки, что Sprint 3J не сломан**

Регрессия Sprint 3J-Roles:

```text
{{ln-000012}} → Федорчук Сергей Валерьевич
{{ln-000012|format=short}} → Федорчук С.В.
{{ln-000012|format=signature_short}} → С.В.Федорчук
```

Если после добавления должности эти токены начали выводить должность — это FAIL.

---

## **12. Обновить DoD**

Добавить в DoD:

```text
{{ln-XXXXXX}} по умолчанию остаётся только ФИО, без должности.
Должность добавляется только через include_position=true.
include_position=true + case=genitive даёт: юрисконсульта Федорчука Сергея Валерьевича.
join=newline работает только для ln-токенов.
file_name_template резолвит package/ln tokens в package context.
Sprint 3J-Roles regression пройден.
```

---

## **13. Финальный статус**

Закрывать только при таком результате:

```text
completed: Sprint 3L;
package.ul.FLD-000011 resolves to legal short_name with org form and quotes;
ln roles keep default person-only output;
ln roles support include_position=true with case-aware position inflection;
ln roles support join=semicolon|comma|newline;
package file_name_template renders package/ln tokens in package context;
real ideology order DOCX/PDF and filename verified;
Sprint 3J role modifiers regression passed;
backend billing/order generation untouched.

План: Sprint 3L — Package short_name + role position(case) + filename render fix + ln multiline
```

## 0. Контекст (diagnose)

Четыре связанных проблемы в реальной генерации Word‑документов пакета (orchestrator `ai-generate-document-package` + `canonical-document-generate-strict`):

### Проблема 1. `{{package.ul.FLD-000011}}` рендерится без формы собственности и без кавычек.

- В UI каталога «Плейсхолдеры» строка «Краткое название» показывает пример `ООО «Тестовая Компания»` (короткая форма + кавычки).
- В реальном документе подставляется `Ажур инкам` — без `ЗАО` и без `«…»`.
- Причина: в `supabase/functions/_shared/packagePlaceholderCatalog.ts` для `FLD-000011` зарегистрированы ДВА tech_key подряд (первый — `package.ul.name`, второй — `package.ul.short_name`). `findByPackageToken` берёт первый → `package.ul.name` → «голое» имя.
- `package.ul.short_name` через `canonicalizeLegalEntity` уже отдаёт корректное `ЗАО «Ажур инкам»` (покрыто Sprint 3J). ИП (FLD-000017) и ФЛ (FLD-000372) — поведение уже желаемое, не трогаем.

### Проблема 2. Должность роли не подставляется перед ФИО и не склоняется.

- В «Анкеты документов» к каждой роли можно ввести должность (`юрисконсульт`), она пишется в `document_package_item_role_assignments.metadata.position` (см. `resolve-package-tokens.ts:24`).
- `resolveLnRoleToken` сейчас читает только ФИО и склоняет его через `formatPersonName` (`format=full|short|signature_short` + `case=…`). Поле `metadata.position` НЕ используется.
- В живом приказе: `Назначить ответственным ... Федорчука Сергея Валерьевича` — должно быть `... юрисконсульта Федорчука Сергея Валерьевича` (Р.п., согласовано с ФИО).

### Проблема 3. Имя файла шаблона (file_name_template) не рендерится для package‑шаблонов.

- На скрине пользователя сохранённый файл называется `Приказ об организации идеологической работы в от` — обрыв на «в от» и пустой хвост.
- Причина: Sprint 3K разрешил `{{package.…}}` и `{{ln-…}}` в `validateFilenameTemplateSyntax` для `scope='package'`, НО в `canonical-document-generate-strict/index.ts` (1424–1468) `filenameTokenMap` строится ТОЛЬКО по `filenameFlds` (билинговые FLD). Package/ln токены не попадают в `resolvedTokens`, а `renderFileName` зовётся БЕЗ `scope` → дефолт `'billing'` → package/ln вообще запрещены → каждый такой токен `→ ''` + warning `file_name_placeholder_unresolved`.
- Тот же баг в раннем рендере для core props (1326–1354) — `_filenameTokenMapEarly`.

### Проблема 4. `{{ln-XXXXXX}}` с несколькими назначениями склеивается через `;`  — нет переноса строки.

- Сейчас в `resolveLnRoleToken` (`resolve-package-tokens.ts:275`): `value = renderedParts.join('; ')`. При перечислении 10 участников всё в одной строке.
- Пользователь хочет модификатор, чтобы каждый участник шёл с новой строки (новый абзац Word). Базовый docxtemplater уже настроен с `linebreaks: true` (`canonical-document-generate-strict/index.ts:1304`), поэтому `\n` в значении превращается в Word‑перенос строки.

## 1. Что меняем

### 1.1 `supabase/functions/_shared/packagePlaceholderCatalog.ts`

Поменять порядок двух строк для UL `FLD-000011`: сначала `package.ul.short_name`, потом `package.ul.name`. Зеркалим в `src/utils/packagePlaceholderCatalog.ts` для парности (визуально UI не меняется — дубликат уже скрыт после Sprint 3K).

Результат: `{{package.ul.FLD-000011}}` → `ЗАО «Ажур инкам»`. ИП и ФЛ не трогаем.

### 1.2 `supabase/functions/_shared/resolve-package-tokens.ts` (`resolveLnRoleToken`)

- В select assignments оставить `metadata` (уже выбирается).
- Из `metadata.position` строкой ≥1 символа собрать `position` для каждого `person_id`.
- Новая чистая функция `renderRoleEntry(name, position, format, case)`:
  - `namePart = formatPersonName(name, { format, case })`.
  - Если `position` пуст → вернуть `namePart`.
  - Иначе:
    - `posNorm = normalizeMasculinePosition(position)` (м.р., как у `customer.leg.director_position`).
    - Если `case` задан → `posInflected = inflectRu(posNorm, case, { forceGender: 'm' }).value || posNorm`; иначе `posInflected = posNorm`.
    - Вернуть `${posInflected} ${namePart}`.
- Multi‑assignment: каждый участник рендерится независимо (свои name+position), затем склеиваются согласно `join` (см. 1.4).

### 1.3 `supabase/functions/canonical-document-generate-strict/index.ts` (filename render fix)

В двух местах (раннем для core props и финальном для `ai_generated_documents.file_name`) — заменить логику построения `filenameTokenMap` так, чтобы:

1. Сохранить текущее заполнение по `filenameFlds` → ключи `FLD-XXXXXX` (билинговые).
2. Дополнительно: для каждого `raw_inside ∈ resolved`, который матчит `^package\.(ul|ip|fl)\.FLD-\d{6}(\|.*)?$` или `^ln-\d{6}(\|.*)?$` — записать в карту по обоим ключам (полный `raw_inside` и базовый без модификаторов), значение = `resolved[raw_inside]`.
3. Передать `scope: 'package'` в `renderFileName(...)` если `generationContext === 'package_session'` (есть `packageContext`); иначе оставить дефолт `'billing'`.
4. То же зеркалить в `_filenameTokenMapEarly` для core props.

После фикса:
`Приказ об организации идеологической работы в {{package.ul.FLD-000011}} от {{field:FLD-000133}}` →
`Приказ об организации идеологической работы в ЗАО «Ажур инкам» от 31.05.2026` (с санитизацией: `«»` остаются, `:` и др. forbidden → `-`).

### 1.4 Новый модификатор `|join=newline` для `{{ln-XXXXXX}}`

- В `LN_TOKEN_RE` (`canonical-document-generate-strict/index.ts:258`) синтаксис уже допускает `|key=val` — менять не нужно.
- В `resolve-package-tokens.ts` `resolveLnRoleToken` принимает дополнительный модификатор `joinMod ∈ { 'comma' (default), 'semicolon', 'newline' }`.
  - default behaviour: текущее `'; '` (backward‑compat для уже выпущенных шаблонов) → переименовать в `semicolon`; делаем default `semicolon` чтобы не сломать существующее поведение.
  - `join=newline` → `'\n'` между участниками; docxtemplater с `linebreaks: true` рендерит каждый с новой строки.
  - `join=comma` → `', '`.
  - Прочее → warning `ln_unknown_join_modifier:<val>` и fallback к default.
- Парсер в `canonical-document-generate-strict/index.ts` уже расщепляет модификаторы по `|` и пробрасывает в resolver — добавить пробрасывание `join` так же, как `case` и `format`.
- В UI каталога ролей (`PlaceholdersCatalogTab.tsx` секция «Роли пакета») добавить второй пример строки с модификатором `|join=newline` рядом с базовой ролью — чисто визуально (как «Кратко/Развёрнуто» для ФИО), без новых FLD. Минимальное изменение, чтобы пользователь видел опцию.

### 1.5 Системный «\n» placeholder — НЕ вводим

Пользователь предложил два варианта: (а) системный `{{newline}}`, (б) формат `join=newline` на ролевом токене. Идём по (б) — он точнее, явно ограничен ролевым токеном и не плодит alias‑плейсхолдеры (нарушение FLD‑first канона). Если позже понадобится «голый» line‑break — добавим отдельным sprint.

## 2. Что НЕ трогаем (явный non‑goal)

- Frontend UI каталога (`PlaceholdersCatalogTab.tsx`) — только +1 пример строки для `|join=newline`, никаких структурных изменений.
- `package.ul.name` как tech_key — остаётся доступен для прямого вызова, в FLD‑lookup не выбирается по умолчанию.
- `package.ip.*`, `package.fl.*` маппинги — без изменений.
- Биллинговый резолвер `typed-tokens-resolver.ts` и `customer.leg.*` — без изменений.
- Миграции, RLS, edge runtime, Gotenberg, `/purchases`, billing, `subscriptions_v2` — без изменений.
- `document_templates.file_name_template` строки в БД (production) — НЕ переписываем.
- Контракт `ai_generated_documents.file_name` (без расширения для PDF, `.pdf`/`.docx` добавляются на скачивании) — без изменений.

## 3. Тесты

### Backend (Deno)

- `supabase/functions/_shared/packageFieldFormatter_test.ts` — основной кейс `package.ul.short_name` уже покрыт Sprint 3J; дополнить только если упадёт regression.
- `supabase/functions/_shared/resolve-package-tokens_test.ts` (новый или дополнить):
  - assignment без `metadata.position` → результат = только ФИО (backward‑compat).
  - assignment c `metadata.position = "юрисконсульт"` + `case=genitive` + `format=full` → `юрисконсульта Федорчука Сергея Валерьевича`.
  - assignment с position в женском роде → `normalizeMasculinePosition` + inflect.
  - 2 assignments, один с position, другой без → `юрисконсульта Иванова Ивана Ивановича; Петрова Петра Петровича`.
  - 3 assignments + `|join=newline` → склейка через `\n`, без position.
  - `|join=comma` → `,` ; `|join=unknown` → fallback + warning.

### Frontend

- `src/lib/documents/documentFilename.test.ts` — добавить кейс `renderFileName` с `scope='package'` и `resolvedTokens = { 'package.ul.FLD-000011': 'ЗАО «Ажур инкам»', 'FLD-000133': '31.05.2026' }` для шаблона `Приказ ... в {{package.ul.FLD-000011}} от {{field:FLD-000133}}` → ожидаемое имя `Приказ ... в ЗАО «Ажур инкам» от 31.05.2026`.
- `src/utils/packagePlaceholderCatalog.test.ts` — обновить ожидание порядка FLD-000011 если тест проверяет порядок.

## 4. Verify

1. `bunx tsc --noEmit` — 0 errors.
2. `bunx vitest run` — все pass.
3. Deno tests `resolve-package-tokens_test.ts` — pass.
4. Manual: перегенерировать «Приказ об организации идеологической работы» с пакетом «Идеология» + назначение `Федорчук С. В.`, должность `юрисконсульт`. Ожидаемые подстроки в PDF/DOCX:
  - Заголовок: `об организации идеологической работы в ЗАО «Ажур инкам»` (вместо `АЖУР инкам`).
  - 2.1: `Назначить ответственным за координацию идеологической работы: юрисконсульта Федорчука Сергея Валерьевича.`
  - Имя файла (вкладка браузера + storage `ai_generated_documents.file_name`): `Приказ об организации идеологической работы в ЗАО «Ажур инкам» от 31.05.2026.pdf`.
  - Если в шаблоне `{{ln-XXXXXX|join=newline}}` с 3 назначениями — три ФИО, каждая с новой строки.

## 5. Proof

`.lovable/proofs/sprint_3l_short_name_role_position_filename_render_newline_2026_05.md` — diff‑резюме, тестовые фикстуры, before/after по 4 пунктам, явный список НЕ‑тронутого scope.

## 6. Memory

- `mem://architecture/documents/package-billing-parity-v1` — добавить: `{{package.ul.FLD-000011}}` по умолчанию = `short_name` (с формой + «…»); `package.ul.name` достаётся только прямым tech_key, не через FLD‑lookup.
- Новая `mem://architecture/documents/ln-role-modifiers-v1`: канон ролевого токена `{{ln-XXXXXX[|format=…][|case=…][|join=semicolon|comma|newline]}}`. Position из `metadata.position` подставляется ПЕРЕД ФИО, склоняется тем же `case`, нормализуется к м.р. через `normalizeMasculinePosition`. Default `join=semicolon` (backward‑compat).
- `mem://architecture/documents/file-name-template-fld-first` — добавить заметку: для `scope='package'` orchestrator передаёт в `renderFileName` карту с `package.<g>.FLD-…` и `ln-…` ключами из `resolved`; ранее (до Sprint 3L) эти токены резолвились в пустую строку — баг устранён.

## 7. DoD

- FLD-000011 (UL) → `short_name` первым в backend+frontend каталогах.
- `resolveLnRoleToken` подставляет должность перед ФИО, склоняет по `case`, нормализует к м.р. Пустая должность → backward‑compat.
- Multi‑assignment работает с `|join=newline|comma|semicolon`, default = `semicolon`.
- `canonical-document-generate-strict` строит `filenameTokenMap` с package/ln ключами и зовёт `renderFileName(..., { scope: 'package' })` для package‑контекста (оба места: early core‑props + final).
- UI каталога «Роли пакета» показывает пример `|join=newline` (визуально), без новых FLD.
- `bunx tsc --noEmit` зелёный, `bunx vitest run` зелёный, Deno tests pass.
- Proof создан, memory обновлена.
- Backend generation pipeline за пределами указанных правок, миграции, billing resolver, `/purchases`, Gotenberg, contracts `ai_generated_documents.file_name` — НЕ тронуты.