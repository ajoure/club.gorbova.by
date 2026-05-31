# да, согласен, с учетом правок:

## **Правки к Sprint 3M**

План правильный, но перед выполнением нужно уточнить несколько моментов, чтобы не сломать уже закрытый Sprint 3J-Roles.

---



## **1. Должность не должна всегда префиксоваться для всех**

`ln`

В Sprint 3J было зафиксировано:

```text
{{ln-XXXXXX}} → ФИО человека без названия роли
```

Поэтому нельзя глобально сделать так, чтобы любой `{{ln-XXXXXX}}` всегда добавлял должность.

Правильнее:

### **Для текущего приказа**

Если в шаблоне нужно:

```text
юрисконсульта Федорчука Сергея Валерьевича
```

то токен должен быть явно:

```text
{{ln-000012|include_position=true|case=genitive}}
```

или, если решаем сделать автопрефикс по умолчанию, это нужно ограничить только теми `ln`, у которых в `document_package_item_role_assignments.metadata.position` заполнена должность **и** шаблон/роль ожидает должностное лицо.

Но безопаснее для текущей архитектуры:

```text
include_position=true остаётся явным modifier.
```

---





## **2. Не превращать**

`include_position=true` **в no-op**

В плане написано:

```text
include_position=true|false оставить как принятый no-op
```

Так делать нельзя.

Нужно:

```text
include_position=true  → должность + ФИО
include_position=false → только ФИО
нет modifier          → только ФИО
```

Иначе мы потеряем контроль над тем, где нужна должность, а где нужен только человек.

---

## **3. Текущий баг лучше исправить через шаблон, а не через изменение default**

Причина бага: в шаблоне стоит:

```text
{{ln-000012|case=genitive}}
```

а нужно:

```text
{{ln-000012|include_position=true|case=genitive}}
```

Поэтому в Sprint 3M добавить отдельный шаг:

```text
Проверить активный DOCX-шаблон приказа и заменить токен:
{{ln-000012|case=genitive}}
→
{{ln-000012|include_position=true|case=genitive}}
```

Это не ломает другие места, где роль должна выводиться только как ФИО.

---

## **4. Если всё же делать автопрефикс — только отдельным modifier/default-policy**

Если пользователь позже захочет, чтобы некоторые роли всегда выводились с должностью, это лучше делать через настройку роли:

```text
document_package_role_catalog.metadata.default_include_position = true
```

Но это не в Sprint 3M.

В Sprint 3M не добавлять новую модель поведения роли.

---





## **5.**

`position_gender` **можно учесть без UI**

В resolver добавить чтение:

```text
metadata.position_gender
```

Если есть:

```text
f → женский род
m → мужской род
```

Если нет:

```text
default = m
```

UI сейчас не трогать.

---

## **6. Filename fix — правильно, обязательно оставить**

Фикс по имени файла нужен и правильный.

Нужно сделать оба слоя:

### **A. Orchestrator**

`ai-generate-document-package` должен парсить не только DOCX body, но и:

```text
document_templates.file_name_template
```

и добавлять system-FLD в `preresolved_fields`, если они используются только в имени файла.

Особенно:

```text
FLD-000133
FLD-000134
FLD-000209
FLD-000210
FLD-000211
FLD-000212
```

### **B. Strict backstop**

В `canonical-document-generate-strict` при сборке `filenameTokenMap`:

если `FLD` не найден в `docFields`, но это system-FLD, брать значение из:

```text
buildSystemFieldValues(new Date())
```

Это правильная страховка.

---

## **7. Filename map должен учитывать modifiers**

В `filenameTokenMap` сохранить ключи:

```text
package.ul.FLD-000011
package.ul.FLD-000011|format=short
ln-000012
ln-000012|format=signature_short
field:FLD-000133
FLD-000133
```

Иначе часть токенов в имени файла будет снова резолвиться в пустую строку.

---







## **8.**

`join=newline` **— оставить, но только для** `ln`

Согласен добавить:

```text
{{ln-000012|join=newline}}
```

Но:

- только для `ln`;
- для `field/package.ul/package.ip/package.fl` modifier `join` должен быть `unknown_modifier`;
- default оставить `semicolon`.

---

## **9. Runtime proof должен проверить оба варианта роли**

В proof обязательно проверить:

### **Без должности**

```text
{{ln-000012|case=genitive}}
→
Федорчука Сергея Валерьевича
```

### **С должностью**

```text
{{ln-000012|include_position=true|case=genitive}}
→
юрисконсульта Федорчука Сергея Валерьевича
```

Это защитит от регрессии Sprint 3J.

---

## **10. Обновить DoD**

Заменить текущий DoD по должности на такой:

```text
{{ln-XXXXXX}} по умолчанию выводит только ФИО.
{{ln-XXXXXX|case=genitive}} выводит только ФИО в падеже.
{{ln-XXXXXX|include_position=true|case=genitive}} выводит должность + ФИО в падеже.
Пустая metadata.position → только ФИО, даже если include_position=true.
```

---

## **11. Итоговый финальный статус**

Закрывать Sprint 3M только при таком результате:

```text
completed: Sprint 3M;
package.ul.FLD-000011 resolves to legal short_name with org form and quotes;
ln default remains person-only;
ln include_position=true adds position before person and inflects both;
ln join=semicolon|comma|newline works only for role tokens;
package file_name_template renders package/ln/system field tokens in package context;
ideology order DOCX/PDF and filename verified;
Sprint 3J role modifiers regression passed;
backend billing/order generation untouched.
```

Главная правка: **не делать должность частью** `{{ln-...}}` **по умолчанию**. Для должности нужен явный modifier `include_position=true`, иначе сломаются все места, где роль должна выводить только ФИО.

&nbsp;

План: Sprint 3M — авто-префикс должности + рендер даты в имени файла

## Контекст и диагностика

Два бага после Sprint 3L (видно на скринах):

1. В документе должность «юрисконсульт» не появилась: вместо «юрисконсульта Федорчука Сергея Валерьевича» рендерится только «Федорчука Сергея Валерьевича». Причина: в Sprint 3L `include_position` сделан opt-in через модификатор `|include_position=true`, а в шаблоне используется `{{ln-000012|case=genitive}}` без него — должность игнорируется.
2. Имя файла обрывается на «… от» — дата `{{field:FLD-000133}}` не подставлена. Причина: `ai-generate-document-package` парсит только тело DOCX и заполняет `preresolved_fields` (включая system-FLD через `SYSTEM_FIELD_VALUE_IDS`). `file_name_template` он НЕ парсит, поэтому если system-FLD используется только в имени файла, он не попадает в `preresolved_fields`. В strict `docFields['FLD-000133']` = undefined → `applyFormat(undefined, …)` → пустая строка → имя файла без даты.

## Что меняем

### 1. Должность всегда префиксует ФИО, если задана

`supabase/functions/canonical-document-generate-strict/index.ts`, ветка `pt.kind === 'ln'` (≈1131–1173):

- Убрать условие `if (include) { … }` как gate. Новое поведение:
  - per-person: если `positions[i]` непуст → префиксовать `normalizeMasculinePosition(positions[i])` + (если задан `case`) `inflectRu(case, { forceGender: posGenders[i] === 'f' ? 'f' : 'm' })`, затем пробел + ФИО.
  - если `positions[i]` пуст → выводить только ФИО (как раньше, без regression).
- Модификатор `include_position=true|false` оставить как принятый no-op в парсере (без warning), чтобы старые шаблоны не сломались. Никакой обязательной ручной разметки в Word больше не нужно.

UI каталога `package`-плейсхолдеров (`src/utils/packagePlaceholderCatalog.ts`, при необходимости подсказки): убрать из живых примеров `|include_position=true`; оставить только `|case=…|format=…|join=…`. Backend остаётся обратно-совместим.

### 2. system-FLD в имени файла резолвятся всегда

Двухслойная защита.

A. `supabase/functions/ai-generate-document-package/index.ts` (≈240–300): перед циклом по `flat.matchAll(TOKEN_RE)` добавить ещё один проход по токенам из `file_name_template` соответствующего `document_templates`-item. Прогонять их через тот же `FIELD_RE`-блок, чтобы system-FLD (FLD-000133 и т.п.), используемые только в имени файла, попадали в `preresolved_fields` и `fldIds`. Package/ln в `file_name_template` сейчас идут через тот же кадр и так попадают в preresolved (см. Sprint 3L), их не трогаем.

B. `supabase/functions/canonical-document-generate-strict/index.ts`, билдеры `_filenameTokenMapEarly` (≈1352–1365) и `filenameTokenMap` (≈1470–1490): backstop — если `baseEntryByFld[fld]` пуст и `SYSTEM_FIELD_VALUE_IDS.has(fld)`, взять значение из `buildSystemFieldValues(new Date())`. Импорт из `_shared/system-field-values.ts`. Это страхует случай, когда A по какой-то причине не сработал (старые батчи, чужие пайплайны).

## DoD

- Шаблон «Приказ об организации идеологической работы», роль `In-000012` с должностью «юрисконсульт», падеж genitive → в документе: `Назначить ответственным за координацию идеологической работы: юрисконсульта Федорчука Сергея Валерьевича.`
- Имя сохранённого файла: `Приказ об организации идеологической работы в ЗАО «АЖУР инкам» от 31.05.2026.pdf`. Дата рендерится и в DOCX, и в PDF.
- Шаблон без должности у назначения → только ФИО, без regression. `{{ln-XXXXXX|join=newline|comma|semicolon}}` работает как раньше.
- `bunx tsc --noEmit` зелёный, `bunx vitest run` зелёный.
- Proof: `.lovable/proofs/sprint_3m_position_autoprepend_and_filename_sys_fld_2026_05.md`.

## Не в скоупе

- UI-контролы модификаторов (отдельный sprint).
- Backend generation pipeline для billing, Gotenberg, миграции, RLS, edge runtime.
- Расширение модели данных (новых FLD, persons, roles, scenarios).
- Контракт `ai_generated_documents.file_name`.
- Очистка `include_position=true` из уже сохранённых production-шаблонов (по запросу отдельной задачей).