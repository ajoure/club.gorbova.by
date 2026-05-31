## да, согласен, с учетом правок:

## **Дополнения к Sprint 3K**

План в целом правильный. Добавить следующие обязательные уточнения перед выполнением.







### **1. Не использовать**

`template_kind`**, если в проекте SOT —** `template_scope`

В пункте про имя файла указано:

```text
document_templates.template_kind
```

Сначала сделать discovery.

Если в проекте реально используется `document_templates.template_scope`, то использовать только его:

```text
template_scope = 'billing' | 'package'
```

Не добавлять новое поле `template_kind`.

DoD:

- нет новой колонки `template_kind`;
- scope определяется через существующее поле или через связь `document_package_template_items`.

---

### **2. File name preview должен работать одинаково на frontend и backend**

Для `file_name_template` нужно синхронно обновить оба файла:

```text
src/lib/documents/documentFilename.ts
supabase/functions/_shared/document-filename.ts
```

Иначе в UI preview будет работать, а при реальной генерации имя файла может развалиться.

Для package-template валидны:

```text
{{field:FLD-XXXXXX}}
{{field:FLD-XXXXXX|format=...}}
{{field:FLD-XXXXXX|case=...}}

{{package.ul.FLD-XXXXXX}}
{{package.ul.FLD-XXXXXX|format=...}}
{{package.ul.FLD-XXXXXX|case=...}}

{{package.ip.FLD-XXXXXX}}
{{package.fl.FLD-XXXXXX}}

{{ln-XXXXXX}}
{{ln-XXXXXX|format=short}}
{{ln-XXXXXX|format=signature_short}}
{{ln-XXXXXX|case=genitive}}
```

Для billing-template package/ln остаются недопустимыми.

---





### **3. Не делать**

`FLD-000069` **blocker нигде**

Проверить все места через grep:

```bash
rg "FLD-000069|Номер документа|обязателен для уникальности|required.*number|document number" src supabase
```

Убрать blocker во всех местах, где он блокирует:

- сохранение имени файла;
- активацию шаблона;
- validation_status;
- markup dialog;
- strict UI validation.

Допустимо только warning:

```text
Номер документа не найден. Если шаблону нужен регистрационный номер, добавьте {{field:FLD-000069}}.
```

DoD:

- шаблон без `{{field:FLD-000069}}` может быть `valid`;
- кнопка «Сохранить» доступна;
- кнопка «Активировать» доступна, если других ошибок нет.

---

### **4. Исправить именно legacy-подсветку, а не backend validation**

На скриншоте проблема UI-классификации:

```text
{{package.ul.FLD-000014|format=signature_short}}
{{ln-000012|format=signature_short}}
```

они валидные и не должны быть жёлтыми.

Обязательный whitelist modifiers:

```text
format=short
format=signature_short
format=long
format=words
case=nominative
case=genitive
case=dative
case=accusative
case=instrumental
case=prepositional
```

Если modifier неизвестный:

```text
unknown_modifier
```

Если старый role-token:

```text
{{package.role.PKR-XXXXXX}}
{{package.roles.*}}
```

то это error:

```text
invalid_legacy_role_placeholder
```

---

### **5. Удаление дубликатов ФИО — только из UI-каталога**

Удалить визуальные строки:

```text
package.ul.director_short_name
package.ip.short_name
package.fl.full_name_short
```

Но не ломать backend-резолв и существующие токены.

Правильный путь теперь:

```text
{{package.ul.FLD-000014|format=short}}
{{package.ip.FLD-000017|format=short}}
{{package.fl.FLD-000372|format=short}}
```

DoD:

- в UI нет отдельных строк «ФИО кратко»;
- modifier `format=short` доступен в строке полного ФИО;
- старые документы с `format=short` продолжают генерироваться.

---

### **6. Примеры должны учитывать modifiers**

В каталоге package-плейсхолдеров пример должен меняться при выборе modifiers.

Пример:

```text
ФИО полностью → Федорчук Сергей Валерьевич
ФИО кратко → Федорчук С.В.
ФИО для подписи → С.В.Федорчук
Родительный падеж → Федорчука Сергея Валерьевича
ФИО кратко + родительный → Федорчука С.В.
Подпись + родительный → С.В.Федорчука
```

Если значение не person_name, показывать `example_value`.

Если pending/deferred — показывать reason/hint, а не заглушку.

---

### **7. Проверить активный приказ после правок**

Обязательно прогнать активный шаблон «Приказ об организации идеологической работы» v4.

Ожидаемый результат:

```text
validation_status = valid
unsupported = 0
invalid legacy = 0
blockers = 0
```

Проверяемые токены:

```text
{{package.ul.FLD-000039}}
{{field:FLD-000209}}
{{package.ul.FLD-000011}}
{{field:FLD-000211}}
{{package.ul.FLD-000013}}
{{package.ul.FLD-000014|format=signature_short}}
{{ln-000012|format=signature_short}}
```

---

### **8. Proof обязательно со скринами**

В proof добавить скрины:

1. «Пакет: ЮЛ» — колонка «Пример» заполнена.
2. «Пакет: ИП» — колонка «Пример» заполнена.
3. «Пакет: ФЛ» — колонка «Пример» заполнена.
4. «Пакет: Роли» — пример и modifiers.
5. Окно проверки шаблона — package/ln-токены с modifiers не жёлтые.
6. Имя файла с `{{package.ul.FLD-000011}}` сохраняется без ошибки.
7. Активный приказ — valid.

---

### **9. Тесты добавить обязательно**

Минимум:

```text
packagePlaceholderCatalog.test.ts
documentFilename.test.ts
personNameFormat.test.ts
```

Кейсы:

```text
copy_ready package items have example_value
ФИО-дубликаты отсутствуют
{{ln-000012|format=signature_short}}
{{package.ul.FLD-000014|format=signature_short}}
filename accepts {{package.ul.FLD-000011}}
filename accepts {{ln-000012|format=signature_short}}
filename does not require FLD-000069
billing filename rejects package/ln tokens
PKR/package.roles not present in UI output
```

---

### **10. Diff scope**

Разрешённый diff:

```text
src/utils/packagePlaceholderCatalog.ts
src/utils/packagePlaceholderCatalog.test.ts
src/components/ai-documents/PlaceholdersCatalogTab.tsx
src/components/ai-documents/TemplateMarkupDialog.tsx
src/components/ai-documents/StrictDocumentTemplatesManager.tsx
src/components/ai-documents/FileNameTemplateEditor.tsx
src/lib/documents/documentFilename.ts
src/lib/documents/documentFilename.test.ts
supabase/functions/_shared/document-filename.ts
.lovable/proofs/sprint_3k_package_placeholder_ui_validation_cleanup_2026_05.md
.lovable/plan.md
memory file-name-template note
```

Запрещено трогать:

```text
canonical-document-generate-strict
ai-generate-document-package
Gotenberg
migrations
billing resolver
/purchases
billing FLD mapping
```

---

### **11. Финальный статус**

Закрывать Sprint 3K только если:

```text
completed: Sprint 3K;
package placeholder examples are shown;
FIO duplicate rows removed from UI;
package/ln tokens with modifiers are valid in package templates;
file_name_template accepts package/ln tokens in package scope;
FLD-000069 is warning-only, not required;
active ideology order template validates without blockers;
backend generation pipeline untouched.

Sprint 3K — Каталог пакетных плейсхолдеров: примеры, дедуп ФИО + чистка валидации шаблонов
```

### 0. Цель

Довести работу с пакетными шаблонами до рабочего состояния:

- В каталоге **Пакет: ЮЛ / ИП / ФЛ / Роли** показывать реальные примеры значений (как в биллинговых группах).
- Убрать визуальные дубликаты «ФИО / ФИО кратко» — краткая форма теперь выбирается через modifier.
- В окне «Проверка и исправление плейсхолдеров» не подсвечивать валидные `{{package.*.FLD-…|format=…}}` и `{{ln-…|format=…}}` как «устаревшие».
- Разрешить пакетные шаблоны без `{{field:FLD-000069}}` (номер документа не обязателен).
- Разрешить package/ln-токены в шаблоне имени файла, чтобы preview и сохранение не падали.

Что НЕ трогаем: `canonical-document-generate-strict`, `ai-generate-document-package`, Gotenberg, миграции, биллинговый резолвер, `/purchases`. Допустимое исключение по scope — **frontend+backend mirror шаблона имени файла** (`src/lib/documents/documentFilename.ts` + `supabase/functions/_shared/document-filename.ts`), потому что без backend-зеркала имя файла превратится в пустую подстановку.

---

### 1. Примеры значений в каталоге пакетных плейсхолдеров

**Файл:** `src/utils/packagePlaceholderCatalog.ts`

- В `PackagePlaceholderItem` добавить `example_value: string | null`.
- Расширить хелперы `ready(...)`, `readyJson(...)`, `deferred(...)` параметром `example` (для `deferred` — `null`).
- Каждому `copy_ready` item проставить осмысленный пример, согласованный с `src/constants/demoLegalDetails.ts` и `DEMO_PERSON_NAME` ("Федорчук Сергей Валерьевич").

Минимальный набор примеров:

```
Пакет: ЮЛ
  Форма собственности     → ООО
  Название                → Тестовая Компания
  Краткое название        → ООО «Тестовая Компания»
  УНП                     → 987654321
  Юридический адрес       → 220000, г. Минск, ул. Тестовая, д. 1, оф. 1
  Руководитель ФИО        → Федорчук Сергей Валерьевич
  Руководитель должность  → директор
  Действует на основании  → Устава
  Банк                    → ОАО «Беларусбанк»
  БИК / код банка         → AKBBBY2X
  Расчётный счёт / IBAN   → BY00ABCD0000000000000000
  Телефон / Email         → +375 29 7000000 / demo.company@example.com
  Адрес: улица/дом/город… → Тестовая / 1 / Минск / Минская область / 220000 / Беларусь

Пакет: ИП
  ФИО                     → Федорчук Сергей Валерьевич
  УНП                     → 123456789
  Адрес полный            → 220000, г. Минск, ул. Тестовая, д. 1, оф. 1
  Действует на основании  → свидетельства о государственной регистрации
  Банк/БИК/IBAN/телефон   → как у ЮЛ

Пакет: ФЛ
  ФИО                     → Федорчук Сергей Валерьевич
  Дата рождения           → 15.01.1990
  Личный номер            → 1234567A009PB1
  Паспорт серия / номер   → MP / 7654321
  Паспорт серия и номер   → MP 7654321
  Паспорт кем выдан       → Тестовым РУВД г. Минска
  Паспорт дата выдачи     → 05.06.2018
  Паспорт действителен до → 05.06.2028
  Адрес: улица/дом/город… → Тестовая / 1 / Минск / Минская область / 220000
  Телефон / Email         → +375 29 7000000 / demo.user@example.com
```

Для `pending_field` / `deferred` / `missing_source_column` — `example_value = null`.

---

### 2. Отображение примеров в UI

**Файл:** `src/components/ai-documents/PlaceholdersCatalogTab.tsx` (блок «Пример», ~ строки 964–979)

Приоритет рендера:

1. `personNamePreview` — если row kind = person_name и выбран format/case;
2. `item.example_value` (italic, как у биллинговых строк);
3. Подсказка резолвера (`package_resolver_hint`) для `pending/deferred`;
4. Пусто.

Удалить статичную фразу **«Пример появится после заполнения анкеты документа»** — она ничего не объясняла и создавала ощущение, что плейсхолдер не работает.

---

### 3. Удалить визуальные дубликаты «ФИО кратко»

**Файл:** `src/utils/packagePlaceholderCatalog.ts`

Удалить из UI-каталога три строки, дублирующие FLD/колонку родителя:

- `package.ul.director_short_name` (FLD-000014 == director_full_name)
- `package.ip.short_name` (FLD-000017 == name)
- `package.fl.full_name_short` (FLD-000372 == full_name)

Краткая/подписная форма выбирается через контрол «ФИО кратко / для подписи» в строке родителя (`supportsPersonNameFormats`). Word-токены `{{package.ul.FLD-000014|format=short}}` и т.п. продолжают работать — на backend они резолвятся через тот же FLD-источник.

---

### 4. Чистка валидации в «Проверка и исправление плейсхолдеров»

**Проблема:** на скриншоте `{{package.ul.FLD-000014|format=signature_short}}` и `{{ln-000012|format=signature_short}}` подсвечиваются жёлтым как «устаревшие». Причина в `TemplateMarkupDialog.tsx`:

```
const RE_PACKAGE_ENTITY_FLD = /^\{\{package\.(?:ul|ip|fl)\.FLD-\d{6}\}\}$/;
const RE_LN_ROLE            = /^\{\{ln-\d{6}\}\}$/;
```

Регексы не учитывают `|format=…|case=…` → токен с модификатором не матчится «valid» бранчем и падает в `legacy`.

**Файлы:**

- `src/components/ai-documents/TemplateMarkupDialog.tsx`
- `src/components/ai-documents/StrictDocumentTemplatesManager.tsx` (уже корректно для package, проверить парсинг highlighted).

**Сделать:** расширить регексы опциональным modifier-хвостом `(?:\|[a-z_]+=[a-z_]+)*`:

```ts
const RE_PACKAGE_ENTITY_FLD = /^\{\{package\.(?:ul|ip|fl)\.FLD-\d{6}(?:\|[a-z_]+=[a-z_]+)*\}\}$/;
const RE_LN_ROLE            = /^\{\{ln-\d{6}(?:\|[a-z_]+=[a-z_]+)*\}\}$/;
```

Whitelist модификаторов (валидируем имя — иначе `unknown_modifier`):

- `format ∈ {short, signature_short, long, words}`
- `case ∈ {nominative, genitive, dative, accusative, instrumental, prepositional}`

Решения по статусам остаются прежними:

- valid package/ln-токен в package-template → НЕ подсвечивается (обычный текст);
- package/ln-токен в billing-template → `package_in_billing` (scope);
- `package.role.PKR-…`, `package.roles.*` → `invalid_legacy_role_placeholder` (error);
- легаси-namespaces (`customer.*`, `executor.*`, `document.*`, `deal.*`, `cf.*`) → `legacy` (warning).

---

### 5. Снять обязательность `FLD-000069`

**Файл:** `src/components/ai-documents/FileNameTemplateEditor.tsx` (строки ~39, 124, 263).

Текущее поведение блокирует сохранение шаблона без номера документа:

```
Добавьте {{field:FLD-000069}} (Номер документа) — обязателен для уникальности
```

**Сделать:**

- Понизить требование до **информационного warning'а** (не блокирует сохранение/активацию).
- Текст: «Номер документа не найден. Если шаблону нужен регистрационный номер, добавьте `{{field:FLD-000069}}`.»
- В `StrictDocumentTemplatesManager` убрать `FLD-000069` из жёстких blocker'ов (если есть отдельная проверка) — оставить только в списке warning'ов.
- `validation_status='valid'` и активация разрешены без FLD-000069.

Memory `Document File Name Template` (mem://architecture/documents/file-name-template-fld-first) сегодня описывает FLD-000069 как «обязателен». Обновить запись: «обязателен — для шаблонов с регистрационным номером; для прочих — рекомендация».

---

### 6. Разрешить package/ln-токены в имени файла

**Проблема:** на скриншоте имя файла

```
Приказ об организации идеологической работы в {{package.ul.FLD-000011}} от {{field:FLD-000133}}
```

даёт ошибку `file_name_placeholder_invalid_syntax: package.ul.FLD-000011`. Причина — `documentFilename.ts` понимает только `FLD_PLACEHOLDER_RE = /^field:(FLD-\d+)$/`.

**Файлы (frontend + backend mirror):**

- `src/lib/documents/documentFilename.ts`
- `supabase/functions/_shared/document-filename.ts`
- `src/components/ai-documents/FileNameTemplateEditor.tsx` (валидатор)

**Сделать:**

1. Расширить grammar имени файла дополнительными regex'ами (только для package-шаблонов):
  ```
   field:FLD-XXXXXX[|format=…][|case=…]
   package.(ul|ip|fl).FLD-XXXXXX[|format=…][|case=…]
   ln-XXXXXX[|format=…][|case=…]
  ```
2. `renderFileName(...)` — резолвить новые токены через тот же `resolvedTokens` (передаётся с backend orchestrator при формировании имени; orchestrator уже резолвит package/ln-токены через `_shared/resolve-package-tokens.ts` для тела документа — переиспользуем). Если значение пустое → текущая warning-логика `file_name_placeholder_unresolved`.
3. `validateFilenameTemplateSyntax(...)` — пропускает три новых формы как валидные.
4. Для billing-template grammar НЕ расширяется: package/ln-токены остаются `invalid_syntax`. Скоуп определяется по `document_templates.template_kind` (или эквиваленту в вызывающем коде).

**Важно про backend:** меняется ТОЛЬКО `_shared/document-filename.ts` (тонкий helper). Generation orchestrator, Gotenberg, миграции, RLS не трогаем. Это явное и узкое исключение из «не трогать backend» — без него имя файла будет ломаться в production.

---

### 7. Smoke на активном шаблоне «Приказ об организации идеологической работы»

После правок открыть v4 шаблон и проверить:

- В окне валидации: 0 unsupported, 0 invalid legacy, 0 blockers, `validation_status='valid'`.
- `{{package.ul.FLD-000014|format=signature_short}}` и `{{ln-000012|format=signature_short}}` НЕ подсвечены как legacy.
- В «Имя файла при скачивании»:
  ```
  Приказ об организации идеологической работы в {{package.ul.FLD-000011}} от {{field:FLD-000133}}
  ```
  сохраняется, preview рендерится без ошибки.
- Каталог Плейсхолдеры → Пакет: ЮЛ / ИП / ФЛ — все строки с примерами, дубликатов «ФИО кратко» нет.

---

### 8. Тесты

- `src/utils/packagePlaceholderCatalog.test.ts` — для всех `copy_ready` есть `example_value !== null`; нет строк с tech_key `*.short_name`/`*.full_name_short`/`*.director_short_name`; `buildPackagePlaceholderToken` для ln + signature_short → `{{ln-000012|format=signature_short}}`, для UL director_full_name + signature_short → `{{package.ul.FLD-000014|format=signature_short}}`.
- `src/lib/documents/documentFilename.test.ts` (новый или расширение): grammar принимает package/ln + modifiers; `FLD-000069` больше не обязателен.
- При наличии тестов на `TemplateMarkupDialog` / `StrictDocumentTemplatesManager` — добавить кейсы: package/ln + modifier ≠ legacy.

---

### 9. Proof

`.lovable/proofs/sprint_3k_package_placeholder_ui_validation_cleanup_2026_05.md`:

1. Package examples — скриншоты «Пакет: ЮЛ / ИП / ФЛ / Роли» с колонкой «Пример».
2. Duplicate removal — список удалённых UI-строк ФИО-кратко.
3. TemplateMarkupDialog — скриншот, package/ln-токены с модификаторами не подсвечены как legacy.
4. File name validation — пример имени файла с `{{package.ul.FLD-000011}}` сохраняется без ошибки.
5. FLD-000069 — шаблон без номера может быть `valid` + активирован.
6. Активный «Приказ» — `valid`, blockers=0.
7. Vitest output (passing).
8. Untouched scope: `canonical-document-generate-strict`, `ai-generate-document-package`, Gotenberg, миграции, billing, /purchases.

---

### 10. DoD

- Каталог пакетных плейсхолдеров: у всех `copy_ready` строк колонка «Пример» содержит осмысленное значение; нет фразы-заглушки.
- Дубликаты «ФИО кратко» удалены из UI всех трёх групп (UL/IP/FL).
- В «Проверке и исправлении плейсхолдеров» валидные `package.*.FLD-…|format=…|case=…` и `ln-…|format=…|case=…` не подсвечиваются как legacy.
- Имя файла шаблона принимает package/ln-токены с модификаторами в package-шаблонах; в billing — старое поведение.
- `FLD-000069` больше не блокирует сохранение и активацию; только информационный warning.
- Активный «Приказ» проходит валидацию без blockers.
- Backend generation pipeline (orchestrator/Gotenberg/migrations/billing/purchases) не затронут; единственное исключение — узкий filename-mirror в `_shared/document-filename.ts`.
- Memory `Document File Name Template` обновлена: FLD-000069 рекомендуемый, не обязательный; добавлена нота про package/ln токены в file_name_template.
- Тесты зелёные.