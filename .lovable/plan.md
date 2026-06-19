# да, согласен, с учетом правок:

Дополни план следующими обязательными блоками перед Stage 6 Smoke/E2E.

---

## **Stage 0.1 — Fix: статические DOCX-шаблоны без плейсхолдеров должны быть валидны**

### **Проблема**

Сейчас документ без плейсхолдеров блокирует генерацию пакета:

```text
no_placeholders_in_template
```

Пример: «Инструкция о проведении годового общего собрания участников» — это статический документ, он должен попадать в пакет как есть, даже если в нём нет `{{field:*}}`, `{{pf-*}}`, `{{ln-*}}`, `{{package.*}}` или `{{recipient.*}}`.

### **Требование**

Документ без плейсхолдеров считается валидным статическим шаблоном.

Правильное поведение:

```text
DOCX без плейсхолдеров
→ validation_status = valid
→ warning: no_placeholders_in_template
→ можно активировать
→ можно добавить в пакет
→ при генерации пакет включает этот документ как есть
→ PDF создаётся через Gotenberg как обычный документ
```

### **Что изменить**

1. В backend-валидации шаблона:
  - `no_placeholders_in_template` не должен попадать в `validation_errors`;
  - перенести его в warnings;
  - если других ошибок нет, `validation_status='valid'`.
2. Во frontend-валидации:
  - красную ошибку заменить на жёлтое/информационное предупреждение:
  - кнопка «Активировать шаблон» должна быть доступна.
3. Не ослаблять реальные ошибки:
  - `unknown_field_public_id`;
  - `package_token_outside_package_context`;
  - невалидные `pf-*`;
  - невалидные `ln-*`;
  - сломанные legacy-токены.

### **DoD**

- Шаблон «Инструкция…» без плейсхолдеров активируется.
- Он добавляется в пакет.
- Генерация пакета не падает.
- В output есть этот документ.
- Другие документы с плейсхолдерами продолжают генерироваться с заменами.
- Реальный ошибочный шаблон по-прежнему `invalid`.
- Proof добавить в:

```text
.lovable/proofs/static_template_activation.md
```

---

## **Stage 0.2 — Fix: документ показывает «6/7 полей», но не говорит, какое поле не заполнено**

### **Проблема**

В карточке документа визуально все поля заполнены, но статус показывает:

```text
6/7 полей
```

При этом UI не сообщает, какое именно поле считается незаполненным. Из-за этого документ не становится зелёным/готовым и генерация блокируется непонятной ошибкой.

### **Требование**

Если документ не готов, UI обязан явно показать:

1. какое поле не заполнено;
2. почему оно считается незаполненным;
3. какой токен/поле блокирует генерацию — только в dev/admin proof, не в клиентском UI;
4. что нужно сделать пользователю.

### **Diagnose**

Перед фиксом провести read-only проверку:

1. Получить список detected required fields для текущего item:
2. Сравнить с фактическими значениями:
  - per-item value;
  - session-level fallback;
  - smart-date value;
  - empty string;
  - null;
  - invalid date/datetime;
  - archived field;
  - inactive catalog field.
3. Найти конкретное поле, которое даёт `6/7`.

### **Возможные причины, которые нужно проверить**

- поле есть в active DOCX, но его нет в UI;
- поле архивировано, но всё ещё учитывается в progress;
- поле имеет session-level value, но readiness не видит fallback;
- поле имеет smart-date значение, но readiness считает его пустым;
- дата отображается в UI, но сохранена в неверном формате;
- поле `datetime` разделилось на дату/время, и одна часть считается пустой;
- required считается по старому assignments, а UI рендерит token-driven fields;
- dirty draft заполнен, но baseline ещё не сохранён.

### **Fix**

1. Progress должен считаться тем же источником, что и UI:
2. Архивные поля не должны участвовать в знаменателе.
3. Если поле required и не заполнено:
  - подсветить конкретный `FieldRow`;
  - показать под полем короткий текст:
  - в шапке карточки добавить раскрываемый список:
4. Если поле есть в DOCX, но не отображается в форме — это blocker:
  - показать admin-warning:
  - зафиксировать token/public_id в proof.
5. При попытке генерации заблокированного документа ошибка должна быть предметной:

```text
Документ «Приказ…» не готов: не заполнено поле «Год отчётности».
```

### **DoD**

- На проблемном документе вместо абстрактного `6/7` видно конкретное незаполненное поле.
- Если все видимые поля заполнены, статус становится `7/7`.
- Карточка становится зелёной/ready.
- Генерация больше не блокируется фантомным полем.
- Если поле реально отсутствует в UI, это явно показано как admin-warning.
- Proof:

```text
.lovable/proofs/package_field_readiness_mismatch_fix.md
```

---

## **Stage 0.3 — Repeatable documents must not depend on unfinished readiness bugs**

Перед реализацией `per_role_person` обязательно закрыть:

1. static-template activation;
2. readiness mismatch `6/7`;
3. фактический combined `field+role` одним atomic RPC.

Иначе repeat-генерация будет строиться поверх нестабильной готовности пакета.

---

## **Корректировка PATCH-PACKAGE-REPEATABLE-DOCUMENTS-BY-ROLE-V1**

План в целом правильный, но внести следующие уточнения.





### **1. Не называть**

`document_package_item_role_assignments` **источником template-настроек**

`document_package_item_role_assignments` — это per-session назначения конкретных физлиц на роли.

Настройка repeat-документа должна храниться на уровне template item:

```text
document_package_template_items.generation_mode
document_package_template_items.repeat_role_catalog_id
```

А список получателей при генерации берётся из session assignments:

```text
document_package_item_role_assignments
WHERE package_session_id = current session
AND package_template_item_id = current item
AND role_catalog_id = repeat_role_catalog_id
AND is_active = true
```

### **2. В UI настройка должна быть именно у добавленного шаблона документа**

В карточке добавленного шаблона в пакете:

```text
Режим генерации:
○ Один документ на весь пакет
● Отдельный документ для каждого физлица с ролью

Роль:
[Участник общего собрания]
```

Важно:

- можно сначала добавить шаблон;
- потом добавить роль;
- потом вернуться в настройки шаблона и выбрать эту роль как repeat-source;
- не требовать пересоздания шаблона.

### **3. Recipient namespace добавить как отдельный минимальный namespace**

Для v1 достаточно:

```text
{{recipient.full_name}}
{{recipient.email}}
{{recipient.phone}}
{{recipient.address}}
{{recipient.position}}
```

Не смешивать с `ln-*`.

`ln-*` — это роли/подписанты/ответственные внутри документа.

`recipient.*` — это текущий получатель при множественной генерации.

### **4. Если в repeat-документе нет recipient-токенов**

Это не ошибка.

Документ всё равно может быть множественным: например, если различается только filename или вложение. Но в UI показать warning:

```text
Документ создаётся отдельно для каждого получателя, но в шаблоне нет recipient-плейсхолдеров.
Файлы будут отличаться только названием.
```

### **5. Статический repeat-документ допустим**

Если документ без плейсхолдеров и включён режим `per_role_person`, он должен создать N одинаковых документов с разными именами файлов.

Это важно после фикса static-template activation.

### **6. Output filename в v1 обязателен хотя бы backend-default**

Без UI-конструктора можно использовать:

```text
{sortIndex}. {itemTitle} — {recipient.full_name}.docx
```

Если `recipient.full_name` пустой:

```text
{sortIndex}. {itemTitle} — Получатель {n}.docx
```

### **7. Readiness для repeat-документа**

Документ готов, если:

```text
обычная готовность item = true
AND repeat_role_catalog_id выбран
AND по этой роли назначен минимум 1 active person
```

Если в шаблоне есть `recipient.*` токены, дополнительно проверить, что у каждого получателя есть данные для required recipient-токенов, если такие required-правила будут введены.

В v1 можно не вводить required для recipient.* — только warning по пустым значениям.

### **8. Snapshot каждого generated document**

Для каждого экземпляра repeat-документа в `ai_generated_documents.meta` добавить:

```json
{
  "generation_mode": "per_role_person",
  "source_package_template_item_id": "...",
  "repeat_role_catalog_id": "...",
  "recipient_person_id": "...",
  "recipient_display_name": "...",
  "recipient_index": 1
}
```

И в `tokens_snapshot` должны попасть rendered recipient-токены, если они были в шаблоне.

### **9. Проверка отсутствия смешения**

В E2E обязательно:

- минимум 2 получателя;
- в DOCX первого получателя нет ФИО второго;
- в DOCX второго получателя нет ФИО первого;
- оба файла имеют разные имена;
- оба связаны с одним `source_package_template_item_id`, но разными `recipient_person_id`.

### **10. Не закрывать старый patch этим новым feature-patch**

`PATCH-PACKAGE-REPEATABLE-DOCUMENTS-BY-ROLE-V1` — отдельный патч.

Текущий patch по Stage 5/6/7 и static-template/readiness должен быть либо:

- закрыт отдельно;
- либо явно помечен как dependency.

Не смешивать статусы.

---

## **Обновлённый порядок**

1. Static-template activation fix.
2. Readiness mismatch `6/7` fix.
3. Закрыть Stage 5 combined `field+role` одним RPC.
4. Только после этого начинать `PATCH-PACKAGE-REPEATABLE-DOCUMENTS-BY-ROLE-V1`.
5. В repeatable patch:
  - discovery;
  - schema;
  - UI item settings;
  - recipient resolver;
  - generator loop;
  - E2E proof.
  - &nbsp;
  - План: PATCH-PACKAGE-REPEATABLE-DOCUMENTS-BY-ROLE-V1

## Цель

Дать возможность в пакете документов генерировать один шаблон отдельным файлом на каждое физлицо, назначенное на выбранную роль этого item. Существующие документы и пакеты продолжают работать без изменений (add-only).

## Discovery (read-only)

Существующая модель уже покрывает задачу — параллельную систему ролей создавать не нужно:

- `document_package_role_catalog(package_template_id, role_key, label, min/max_count, allowed_entity_types, output_template, public_id)` — каталог ролей пакета.
- `document_package_item_role_assignments(package_session_id, package_template_item_id, role_catalog_id, person_id, sort_order, metadata)` — per-item, per-session назначения физлиц на роль документа (Sprint 3G SOT, защищён триггером `dpira_assert_package_match`). Это и есть источник списка получателей для repeat-режима.
- `document_package_template_items(package_template_id, template_id, sort_order, is_required, title_override)` — item пакета; здесь храним настройку режима генерации.
- `legal_details_persons(full_name, phone, email, address_structured, ...)` — источник recipient-полей.

Generator pipeline (текущий): итерация по `document_package_template_items` → один вызов `canonical-document-generate-strict` per item → запись в `ai_generated_documents`. Токены ролей: канонический `{{ln-XXXXXX}}` (см. Package Document-Level Questionnaires v1).

Вывод: добавляем 2 поля к `document_package_template_items` + новый namespace `recipient.*`, переиспользуя `document_package_item_role_assignments` как источник получателей.

## Изменения

### Stage 1. Schema (миграция, add-only)

```sql
ALTER TABLE public.document_package_template_items
  ADD COLUMN generation_mode text NOT NULL DEFAULT 'single'
    CHECK (generation_mode IN ('single','per_role_person')),
  ADD COLUMN repeat_role_catalog_id uuid NULL
    REFERENCES public.document_package_role_catalog(id) ON DELETE SET NULL,
  ADD CONSTRAINT dpti_repeat_role_required
    CHECK (generation_mode = 'single' OR repeat_role_catalog_id IS NOT NULL);
```

Триггер `dpti_assert_repeat_role_in_same_package`: если `generation_mode='per_role_person'`, то `repeat_role_catalog_id.package_template_id` обязан совпадать с `dpti.package_template_id`. Иначе RAISE.

Все существующие строки остаются `single` → нулевой regression risk.

### Stage 2. UI — настройка item

`src/components/ai-documents/packages/...` карточка добавленного шаблона: добавить блок «Режим генерации документа».

- Radio: «Один документ на весь пакет» / «Отдельный документ для каждого физлица с ролью».
- При `per_role_person` — Select ролей текущего пакета (из `document_package_role_catalog WHERE package_template_id = ...`).
- Сохранение через update `document_package_template_items` (RLS уже есть).
- Inline-валидация: режим выбран, но роль не выбрана → запрет save.

Доступно к редактированию в любой момент после добавления item (в т.ч. если роль добавлена позже шаблона).

### Stage 3. Recipient context + readiness

Новый namespace токенов (read-only resolver, без новых FLD):

```
{{recipient.full_name}}
{{recipient.short_name}}     -- derived из full_name
{{recipient.email}}
{{recipient.phone}}
{{recipient.address}}        -- из address_structured (canonical join)
{{recipient.position}}       -- из assignment.metadata.position если есть, иначе ''
```

Источник: `legal_details_persons` по `person_id` из текущего assignment. Без `{{ln-XXXXXX}}`-маппинга в v1 — recipient.* живёт параллельно и не конфликтует.

Readiness в `canonical-document-generate-strict` (и preview/dry-run в UI):

- `per_role_person` && `repeat_role_catalog_id IS NULL` → ошибка `repeat_role_not_selected`.
- роль выбрана, но `count(assignments) = 0` для session+item+role → `repeat_role_no_persons` с label роли в тексте.

### Stage 4. Generator

Edge function пакетной генерации (orchestrator над `canonical-document-generate-strict`):

```
for item in items order by sort_order:
  if item.generation_mode = 'single':
      generate once (как сейчас)
  else:
      persons = SELECT person_id FROM document_package_item_role_assignments
                WHERE package_session_id=? AND package_template_item_id=item.id
                  AND role_catalog_id=item.repeat_role_catalog_id
                ORDER BY sort_order, created_at
      for p in persons:
          render with extra context { recipient: resolveRecipient(p) }
          save as ai_generated_documents row with:
            meta.generation_mode='per_role_person'
            meta.recipient_person_id=p.id
            meta.recipient_display_name=p.full_name
            meta.source_package_template_item_id=item.id
```

Имя файла по умолчанию:

```
{NN}. {item title} — {recipient.full_name}
```

где `NN` — порядковый префикс item в пакете (без под-нумерации; recipient идёт в суффиксе). Без UI-конструктора в v1.

Snapshot (`ai_generated_documents.meta`) фиксирует item_id, recipient_person_id, recipient_display_name, generation_mode, rendered recipient tokens. Прочие токены (`package.*`, `pf-*`, `ln-*`) продолжают работать как сейчас — только дополнительный namespace.

### Stage 5. Регрессия / safety

- `single` остаётся default; ни один существующий item не меняет поведение.
- CHECK + триггер гарантируют валидность `per_role_person` на DB-уровне.
- Soft-delete шаблона по-прежнему каскадно чистит item (предыдущие патчи).
- Telegram/billing/canonical write-path / `ai_generated_documents` schema — НЕ трогаем (только `meta`).

### Stage 6. Smoke / E2E

Тест на «Годовое собрание»:

1. Item «Приказ …» — `single`.
2. Item «Извещение участника» — `per_role_person` + роль «Участник общего собрания», 2-3 person assignments.
3. Generate → 4 файла; в каждом «Извещении» свой recipient; plain-text проверка отсутствия cross-contamination.
4. Regression: пакет без repeat-items → byte-equal с baseline.

### Stage 7. Proof

`.lovable/proofs/repeatable_documents_by_role_v1.md`:

- discovery (схемы таблиц, цитата SOT-memo),
- SQL миграции,
- скрины UI (single / per_role_person / выбор роли),
- SELECT с `generation_mode` и `repeat_role_catalog_id` сохранённого item,
- список созданных `ai_generated_documents` + plain-text дифф,
- regression proof,
- changed files.

## Технические детали

**Миграция:** ADD COLUMN + CHECK + FK + trigger; backfill не нужен.

**Edge functions:** правка orchestrator-функции пакетной генерации (обнаружим точное имя в build-режиме через `rg "document_package_template_items"` по `supabase/functions/`) + расширение context-builder в `canonical-document-generate-strict` (новый namespace `recipient`). HARDCODED_ENABLED резолвера остаётся `false`-совместимым.

**UI:** правка карточки item в админке пакетов (`src/components/ai-documents/packages/*`) + загрузчик ролей из `document_package_role_catalog`.

**Не трогаем:** `document_package_session_field_values`, `ai_generated_documents` schema, `{{ln-XXXXXX}}`-resolver, billing/canonical write-path, Telegram, queue.

## Out of scope v1

Несколько repeat-ролей одновременно; фильтры получателей; UI-конструктор filename pattern; группировка; email-рассылка; подпакеты.

## DoD

- В админке item пакета доступен переключатель режима + выбор роли.
- `per_role_person` создаёт N файлов по числу person в выбранной роли item-а; recipient-данные корректны и не смешиваются.
- `single` items не меняют поведение байт-в-байт.
- Понятные ошибки `repeat_role_not_selected` / `repeat_role_no_persons` до генерации.
- Proof-файл с SQL, скринами, plain-text сравнением и regression.