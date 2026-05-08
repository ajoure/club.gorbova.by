## Да, согласен, с учетом правок:

1. **Строго зафиксировать:** `token_key` нельзя использовать даже как вспомогательный ключ в новой pipeline. Только `fields_registry.public_id`.
2. **Уточнить snapshot:** `orders_v2.meta.document_data.fields` должен быть основным SOT для генерации. Формат:

```json
{
  "fields": {
    "FLD-000123": {
      "value": 250,
      "source": "offer.document_defaults.amount",
      "label": "Сумма акта",
      "data_type": "money",
      "updated_at": "2026-05-08T..."
    }
  }
}
```

3. **Уточнить fallback resolver:** fallback допустим только через `fields_registry.public_id`, не через `token_key`. Если fallback нашёл значение — он должен записать его в `source_trace` как `computed_field` или `system_generated`, но не как alias/token_key.
4. **Добавить hard-stop:** если в DOCX найден любой `{{...}}`, который не соответствует regex:

```regex
^\{\{field:FLD-[A-Z0-9]+}}$
```

шаблон нельзя активировать.

5. **Каталог плейсхолдеров:** показывать только строки, где есть валидный `fields_registry.public_id`. Всё без `public_id` — не показывать в каталоге и отправить в discovery/backlog.
6. **Разметка DOCX:** auto-suggest должен предлагать только `{{field:FLD-...}}`. Старый формат не должен появляться даже в подсказках.
7. **Редактирование сделки:** при ручном изменении поля в сделке менять только `orders_v2.meta.document_data.fields[FLD...]`, не менять продукт, тариф или кнопку.

Готовый текст для Lovable:

```text
План Sprint 11 утверждён с обязательными уточнениями.

Главное правило:
В новой document generation pipeline используется только fields_registry.public_id.

Единственный допустимый placeholder в DOCX:

{{field:FLD-XXXXXX}}

Полностью запрещено использовать, показывать, копировать, резолвить или хранить в runtime новой pipeline старые форматы:
- {{document.amount}}
- {{executor.name}}
- {{customer.name}}
- {{deal.amount}}
- {{cf.*}}
- любые token_key / alias / fallback по текстовому ключу

token_key нельзя использовать даже как вспомогательный слой новой системы.

Обязательные правки к плану:

1. document_token_registry
- Использовать только строки с field_id → fields_registry.id → fields_registry.public_id.
- Строки без field_id/public_id не показывать в каталоге и не использовать в генерации.
- Старые token_key не выводить в UI и не копировать.

2. Каталог плейсхолдеров
Показывать только:
- Группа
- Название поля
- Field public ID
- Placeholder {{field:FLD-XXXXXX}}
- Тип
- Источник
- Обязательное
- Пример
- Копировать

Копировать только {{field:FLD-XXXXXX}}.

3. DOCX validation
canonical-template-validate должен блокировать любой placeholder, который не соответствует формату:

{{field:FLD-XXXXXX}}

Любой старый placeholder должен давать critical error:

legacy_placeholder_format_detected

UI-текст:
В шаблоне найден старый формат плейсхолдера. Используйте только {{field:FLD-XXXXXX}}.

4. Snapshot сделки
orders_v2.meta.document_data должен хранить значения только по public_id:

{
  "fields": {
    "FLD-000123": {
      "value": 250,
      "source": "offer.document_defaults.amount",
      "label": "Сумма акта",
      "data_type": "money",
      "updated_at": "..."
    }
  }
}

5. Resolver
Единственный runtime resolver:
{{field:FLD-XXXXXX}} → fields_registry.public_id → orders_v2.meta.document_data.fields[FLD-XXXXXX].value

Fallback допустим только через fields_registry.public_id.
Запрещены fallback/alias/token_key/cf resolver.

6. source_trace
Допустимые значения:
- field_public_id
- manual_override
- computed_field
- system_generated

Запрещены:
- token_key
- alias_token_key
- legacy_cf
- document.amount
- executor.name
- customer.name
- deal.amount
- cf.*

7. DealDocumentsCard
Редактирование полей сделки должно менять только:
orders_v2.meta.document_data.fields[FLD-XXXXXX]

Не менять продукт, тариф, кнопку оплаты.

8. Auto-suggest DOCX
Auto-suggest предлагает только {{field:FLD-XXXXXX}}.
Старые token_key не должны появляться даже в предложениях.

9. DoD
- Все новые DOCX используют только {{field:FLD-XXXXXX}}.
- Каталог копирует только {{field:FLD-XXXXXX}}.
- Validation блокирует все старые форматы.
- Resolver не умеет резолвить старые token_key.
- document_template_versions.token_manifest хранит только field_public_id.
- orders_v2.meta.document_data.fields хранит значения только по public_id.
- source_trace не содержит token_key/alias/cf.
- generated_documents legacy не трогаем.
- email/Telegram/auto-generation не включаем.
```

Это правильная логика: **одно поле = один** `FLD-ID`**, документ работает только через** `FLD-ID`.

&nbsp;

План: Sprint 11 — ID-first DOCX цикл (strict, без alias-слоя)

### Ключевое решение

В новой системе документов единственный допустимый идентификатор поля — `fields_registry.public_id` (`FLD-XXXXXX`). Единственный допустимый формат плейсхолдера в DOCX:

```
{{field:FLD-XXXXXX}}
```

Никаких alias / backward-compat / fallback на текстовые `token_key` (`document.amount`, `executor.name`, `customer.name`, `deal.amount`, `cf.*`) в новой pipeline. Старые форматы — hard error на этапе validation.

Legacy-слой (`generated_documents`, существующие старые шаблоны вне новой pipeline) не трогаем и не используем.

---

### Discovery findings (для контекста)

- `fields_registry`: есть `id` (uuid), `public_id` (`FLD-XXXXXX`), `entity_type`, `key`, `label`, `data_type`. Это SOT для полей.
- `document_token_registry` (157 строк): `field_id` — UUID на `fields_registry.id`, заполнено только в 47 строках. Остальные 110 — текстовые `token_key`/`resolver_key` без привязки.
- `document_template_versions`: уже есть `token_manifest`, `detected_tokens`, `validation_status`, `validation_errors`.
- `orders_v2.meta.document_data` — место для snapshot (Sprint 10).
- Резолверы: `_shared/document-render.ts`, `src/lib/token-resolver.ts`, `tokenRegistry.ts`, `TokenizedRichInput`, `PlaceholdersCatalogTab`, `canonical-document-generate`, `canonical-template-validate`, `DealDocumentsCard`.

**Внутри БД храним UUID `fields_registry.id`. В DOCX, manifest, snapshot, UI — только `public_id` (`FLD-XXXXXX`).**

---

### Этап 1 — FIELD-ID-1: Discovery proof

Файл `.lovable/proofs/document_generation_sprint11_field_id_discovery.md`. Таблица всех 157 токенов с колонками: `token_key`, `ui_label`, `category`, `source_type`, `current field_id`, `matched fields_registry.id`, `matched public_id`, **action** ∈ { `link_existing`, `create_real`, `create_computed`, `needs_manual_review` }.

Никакого `leave_alias_only` — alias-слоя в новой системе нет. Если поле нельзя классифицировать → `needs_manual_review` и оно пока не попадает в новый каталог.

---

### Этап 2 — FIELD-ID-2: безопасный backfill `fields_registry`

Разделить токены на классы и обработать по-разному (NOT слепой массовый INSERT):

- **A. Real fields** (контакт, клиент, реквизиты, продукт, кнопка оплаты, сделка) → создать в `fields_registry` с правильным `entity_type`/`key` если ещё нет; `source_type='real'`.
- **B. Computed** (сумма прописью, дата документа, номер документа, валюта, период) → создать в `fields_registry` с `source_type='computed'`, в `document_token_registry` указать `resolver_key`.
- **C. Custom/legacy** → попытаться смэтчить с существующим `fields_registry`; иначе `needs_manual_review`, в новый каталог не включается.

После backfill: для каждой строки `document_token_registry`, попавшей в каталог, гарантированно есть `field_id` → `fields_registry.id` → `public_id`.

Миграция идемпотентная, без `DELETE` старых строк.

---

### Этап 3 — FIELD-ID-CLEANUP-1: удалить runtime использование старых token_key

В новой document pipeline **полностью исключить** резолв через текстовые ключи `document.amount`, `executor.name`, `customer.name`, `deal.amount`, `cf.*`. Затронутые точки:

- `document_token_registry` (UI/каталог) — выводим только строки с `field_id`.
- `tokenRegistry.ts`, `TokenizedRichInput`, `PlaceholdersCatalogTab` — основной формат `{{field:FLD-...}}`, alias-выдача и копирование текстовых ключей удаляются.
- `_shared/document-render.ts` — единственная ветка резолва: `{{field:FLD-XXXXXX}}` → `fields_registry` lookup → значение.
- `canonical-document-generate`, `canonical-template-validate`, `DealDocumentsCard` — только ID-формат.
- `orders_v2.meta.document_data` — храним по `public_id`.
- `document_template_versions.token_manifest` — храним `field_public_id`.
- `source_trace` — допустимы только `field_public_id`, `manual_override`, `computed_field`, `system_generated`. Запрещены `alias_token_key`, `legacy_cf`, `token_key`.

Колонку `token_key` в `document_token_registry` физически не удаляем (legacy constraints), но помечаем deprecated и **не используем** ни в одной точке новой pipeline.

---

### Этап 4 — FIELD-ID-3: каталог плейсхолдеров (strict)

`PlaceholdersCatalogTab` (каноническая таблица). Колонки:

- Группа (category)
- Название поля (ui_label)
- Field public ID (`FLD-XXXXXX`)
- Placeholder `{{field:FLD-XXXXXX}}`
- Тип (data_type)
- Источник (source_type: real / computed / system)
- Обязательное
- Пример
- Копировать → копирует только `{{field:FLD-XXXXXX}}`

Убрать колонки/кнопки: alias placeholder, token_key, readable alias, `document.amount`, `executor.name`, `cf.*`. Скрывать строки без `field_id`/`public_id` (они в backlog).

---

### Этап 5 — DOCX-MARKUP-1: загрузка DOCX и preview

- Используем существующие `document_templates` + `document_template_versions` + bucket.
- Upload → новая версия (draft).
- `extractDocxPlaceholders` для извлечения `{{...}}`, `mammoth.convertToHtml` для read-only HTML preview.
- Никакого встроенного Word-редактора, OnlyOffice, PDF-конвертера.

### Этап 6 — DOCX-MARKUP-2: auto-suggest (только предложения)

- Анализируем извлечённый текст: числа, даты, ключевые фразы («Сумма», «Исполнитель», ФИО, «Заказчик», «Период»).
- Матчим к `document_token_registry` (только строки с `field_id`/`public_id`) по словарю синонимов на `ui_label`/`category`/`data_type`.
- Confidence (точное / substring / regex суммы-даты).
- UI-таблица: «Найденный текст | Предложенное поле | Field public ID | Placeholder `{{field:FLD-...}}` | Confidence | Статус».
- Статусы suggestion: `suggested`, `accepted`, `changed`, `skipped`. **DOCX не меняется до явного «Применить разметку»**.

### Этап 7 — DOCX-MARKUP-3: ручная правка через существующий picker

- Используем существующий `TokenizedRichInput` / placeholder-picker (тот же, что и в каталоге), переведённый на `public_id`.
- Picker показывает `ui_label` + категорию + `FLD-XXXXXX`. Вставка → `{{field:FLD-XXXXXX}}`.

### Этап 8 — DOCX-MARKUP-4: сохранение размеченной версии

- Backend применяет подтверждённые замены к `.docx` (XML/python-docx через edge-функцию).
- В `document_template_versions`:
  - `storage_path` (marked DOCX, оригинал — предыдущей версией / отдельным полем);
  - `token_manifest`: массив `{ field_id, field_public_id, placeholder, ui_label, category, location, required }` — **только `field_public_id`, никаких `token_key**`;
  - `validation_status='pending'`.

### Этап 9 — DOCX-MARKUP-5 / FIELD-ID-CLEANUP-3: validation

`canonical-template-validate`:

- разбирает все `{{...}}` в DOCX;
- допустим **только** формат `{{field:FLD-XXXXXX}}`;
- любой другой формат (`{{document.amount}}`, `{{executor.name}}`, `{{customer.name}}`, `{{deal.amount}}`, `{{cf.*}}`, `{{anything.else}}`) → critical error `legacy_placeholder_format_detected`, UI-текст: «В шаблоне найден старый формат плейсхолдера. Используйте только `{{field:FLD-XXXXXX}}`.»;
- проверяет существование каждого `FLD-XXXXXX` в `fields_registry`;
- проверяет наличие обязательных полей категории шаблона.

**Critical** (блокирует активацию/генерацию):

- неизвестный `{{field:FLD-...}}`,
- `field_public_id` не найден,
- обязательное поле отсутствует в шаблоне,
- обязательное поле пустое при генерации,
- DOCX не читается,
- legacy_placeholder_format_detected.

**Warning** (не блокирует):

- необязательное поле пустое,
- snapshot устарел относительно product/offer settings.

`is_current=true` ставится только при отсутствии critical.

---

### Этап 10 — DOCX-GENERATION-1: генерация только из snapshot по public_id

`canonical-document-generate` + `_shared/document-render.ts`:

- единственная ветка резолва: `{{field:FLD-XXXXXX}}` → `orders_v2.meta.document_data.fields[FLD-XXXXXX].value`;
- если значение отсутствует — fallback resolver по `fields_registry` (real-time), результат пишется в `source_trace` как `field_public_id`/`computed_field`/`system_generated`;
- если обязательное поле пустое → блок генерации;
- никакого fallback на `token_key`/alias/`cf.*`.

Snapshot формат:

```json
{
  "fields": {
    "FLD-000123": {
      "value": 250,
      "source": "offer.document_defaults.amount",
      "label": "Сумма акта",
      "updated_at": "..."
    }
  }
}
```

(Удобная проекция `document.amount` допускается **только** как read-only convenience для UI; SOT — `fields[FLD-...]`.)

---

### Этап 11 — DEAL-DOCS-1: редактирование snapshot сделки

`DealDocumentsCard`, вкладка «Документы → Поля»:

- редактируем **только** `orders_v2.meta.document_data.fields`;
- продукт / тариф / кнопка оплаты не меняются;
- изменения = `manual override`, `source` поля становится `manual`;
- audit: action `document_data.field_updated`, meta `{ order_id, field_public_id, ui_label, old_value, new_value, source_before, source_after='manual', actor_user_id }`;
- server-side audit (JWT actor).

### Этап 12 — DEAL-DOCS-2: preview перед генерацией

Таблица: «Поле | Field public ID | Значение | Источник (snapshot/manual/computed/system) | Статус (filled/empty/required-empty/not-found)». Кнопка генерации блокируется при наличии required-empty.

### Этап 13 — DEAL-DOCS-3: история документов сделки

- Использовать `**ai_generated_documents**` (canonical для нового генератора).
- Колонки: документ, шаблон + version, snapshot version, статус validation, скачать, preview, перегенерировать.
- `generated_documents` (legacy) — **не трогаем, не смешиваем, не показываем в новой вкладке**.

### Этап 14 — AUDIT-1

В существующий `audit_logs` (server-side) пишем:

- `document_template.uploaded`
- `document_template.markup_suggested`
- `document_template.markup_applied`
- `document_template.version_saved`
- `document_template.version_activated`
- `document_data.field_updated`
- `document.generate_preview`
- `document.generated`
- `document.regenerated`

---

### Что НЕ делаем

- Не вводим alias-слой / backward-compat для новой pipeline.
- Не используем `token_key`, `document.amount`, `executor.name`, `customer.name`, `deal.amount`, `cf.*` в новой pipeline.
- Не включаем `documents_canonical_generation_enabled` и `documents_service_act_auto_generation_enabled`.
- Не подключаем email / Telegram / batch.
- Не трогаем legacy `generated_documents`.
- Не делаем встроенный Word-редактор / OnlyOffice / PDF-конвертер.
- Не создаём второй placeholder picker.

---

### Технический раздел

```
fields_registry (id uuid, public_id FLD-XXXXXX)  ← SOT
        ▲ lookup by public_id
        │
DOCX template:  {{field:FLD-XXXXXX}}   ← ЕДИНСТВЕННЫЙ формат
        │
        ▼
canonical-template-validate (block legacy formats hard)
        │
        ▼
document_template_versions.token_manifest [{field_id, field_public_id, placeholder, location, required}]
        │
        ▼
orders_v2.meta.document_data.fields[FLD-XXXXXX] = { value, source, label, updated_at }
        │
        ▼
canonical-document-generate → _shared/document-render.ts (single resolver: public_id only)
        │
        ▼
ai_generated_documents (canonical; legacy generated_documents untouched)
```

Файлы (presentation + glue, без новых сущностей):

- `src/components/ai-documents/PlaceholdersCatalogTab.tsx` — strict ID-only каталог.
- `src/components/ai-documents/CanonicalTemplateVersionsPanel.tsx` + dialog «Разметка» (upload → preview → suggest → confirm → save version).
- `src/components/ai-documents/TokenizedRichInput.tsx` / picker — переключить на `public_id`, удалить alias-выдачу.
- `src/components/admin/DealDocumentsCard.tsx` — редактирование snapshot по `public_id`, preview, история через `ai_generated_documents`.
- `supabase/functions/_shared/document-render.ts` — single resolver `{{field:FLD-...}}`.
- `supabase/functions/canonical-template-validate/index.ts` — strict regex, блок legacy-форматов.
- `supabase/functions/canonical-document-generate/index.ts` — резолв из snapshot по `public_id`.
- 1 миграция: `fields_registry` backfill (классы A/B/C) + бэкфилл `document_token_registry.field_id`. Без `DELETE`.

### DoD

1. В новой документной pipeline нет runtime-использования старых `token_key` / `document.amount` / `executor.name` / `customer.name` / `deal.amount` / `cf.*`.
2. В DOCX допустим **только** `{{field:FLD-XXXXXX}}`.
3. Каталог копирует только `{{field:FLD-XXXXXX}}`.
4. Validation блокирует все старые формы как critical (`legacy_placeholder_format_detected`).
5. Resolver не умеет резолвить старые форматы.
6. `orders_v2.meta.document_data.fields` хранит значения по `public_id`.
7. `document_template_versions.token_manifest` хранит `field_public_id` (без `token_key`).
8. `source_trace` содержит только `field_public_id` / `manual_override` / `computed_field` / `system_generated`.
9. Поля сделки можно редактировать → `manual override`, продукт/тариф/кнопка не меняются, audit пишется.
10. Генерация берёт manual value из snapshot.
11. История документов сделки идёт через `ai_generated_documents`; `generated_documents` legacy не трогается.
12. Email / Telegram / auto-gen не включены.
13. Тестовый шаблон акта собран только из `{{field:FLD-...}}`.
14. `rg`/grep проверка показывает: в новой pipeline (новые компоненты + новые edge-функции) нет старых форматов.

### Proof

`.lovable/proofs/document_generation_sprint11_docx_markup_field_id.md` содержит:

1. SQL count: токены всего / с `field_id` до и после backfill.
2. Discovery таблица 157 токенов с action.
3. Пример строки `fields_registry` (с `public_id`).
4. Пример строки `document_token_registry` (с `field_id`/`field_public_id`).
5. Пример primary placeholder `{{field:FLD-...}}`.
6. Пример загруженного DOCX + извлечённый text/HTML preview.
7. Пример auto-suggestion (taблица + статусы).
8. Пример ручной правки через picker.
9. Сохранённая `document_template_versions` с `token_manifest` (`field_public_id`).
10. Validation result, в т.ч. демо: загрузка шаблона с `{{document.amount}}` → critical `legacy_placeholder_format_detected`.
11. Пример `orders_v2.meta.document_data.fields[FLD-...]`.
12. Пример редактирования поля сделки → manual override + audit `document_data.field_updated`.
13. Пример preview перед генерацией (источник, статус).
14. Generated DOCX через `ai_generated_documents` + `docx_check`.
15. `rg`-проверка: в новой pipeline нет `token_key`/`document.amount`/`executor.name`/`customer.name`/`deal.amount`/`cf.*`.
16. Подтверждение: `generated_documents` legacy untouched (count до/после).
17. Подтверждение: `documents_canonical_generation_enabled=false`, `documents_service_act_auto_generation_enabled=false`, email/Telegram не подключены.