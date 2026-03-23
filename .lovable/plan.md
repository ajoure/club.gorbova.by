# да, согласен, с учетом правок:

1. **Не дублировать движок генерации.**  
Новый `ai-generate-document` допустим, но только как отдельный AI-entrypoint поверх **общего shared renderer/helper**, а не копия billing `generate-from-template`.  
Нужно явно выделить общий слой:
  - загрузка шаблона из storage
  - извлечение/подстановка токенов
  - генерация `.docx`
  - загрузка файла в bucket  
  Billing flow не трогать, но и второй независимый engine не создавать.
2. **Snapshot для финальной генерации собирать на сервере, не доверять клиенту.**  
Preview можно считать на клиенте.  
Но при финальном generate edge function должна:
  - сама загрузить entity/person/link по id
  - сама собрать финальный snapshot
  - сама посчитать `missing_tokens`
  - уже этот серверный snapshot сохранить в `ai_generated_documents`  
  Клиент не должен быть источником истины для snapshot.
3. **Нужно развести шаблоны billing и AI.**  
Просто переиспользовать `document_templates` без scope-фильтра нельзя.  
Добавить явный признак области использования, например:
  - `usage_scope` / `template_scope` = `billing | ai | both`  
  И в AI показывать только `ai` / `both`.  
  Иначе billing-шаблоны попадут в AI-список.
4. **Не опираться на предположение, что в** `document_templates` **уже есть placeholders.**  
В плане нужно явно указать источник токенов:
  - либо поле `placeholders jsonb` в `document_templates`
  - либо серверное извлечение токенов из docx-шаблона
  - либо fallback: parse-on-demand + кеширование в таблице  
  Без этого шаг preview/missing tokens недоопределён.
5. `ai_generated_documents` **— добавить техполя для нормальной эксплуатации.**  
В таблицу добавить минимум:
  - `template_source_path text null`
  - `storage_bucket text not null default 'documents'`
  - `file_name text null`
  - `file_mime text null`
  - `generation_error text null`
  - `deleted_at timestamptz null` — если хотите безопасное удаление истории  
  Это упростит download/delete/debug.
6. **Историю лучше делать с мягким удалением записи или явным storage-cleanup.**  
В плане сейчас это не определено. Нужно выбрать одно:
  - либо hard delete строки + remove файла из storage,
  - либо soft delete (`deleted_at`) + скрытие из UI.  
  Выбор прописать явно. Для v1 допустим hard delete, но только вместе с удалением файла.
7. **В AI.tsx не удалять старую структуру вкладок без mapping.**  
По add-only правилу нужно явно указать mapping:
  - `accountant / manager / audit / templates stub` → новый docs module
  - старые stub-id либо заменяются 1:1,
  - либо делается новый docs-router с явным переносом.  
  Нельзя просто “убрать 4 stub-таба” без описанного переноса.
8. **В wizard для подписанта нужен явный приоритет выбора.**  
Прописать логику:
  - сначала links выбранного entity
  - сначала `is_primary=true`
  - затем остальные
  - если links нет — manual fallback на физлицо  
  Это нужно зафиксировать в плане, иначе UX будет плавать.
9. **Для токенов подписанта нужен отдельный namespace.**  
Не просто `signer.*`, а явный mapping в существующий token-engine.  
В плане нужно зафиксировать, что computed tokens добавляются как read-only layer и не лезут в `fields_registry` как новые физические поля без отдельной необходимости.
10. **Скачать документ — только через signed URL / защищённый handler.**  
Не прямой public path.  
И edge/download flow должен проверять владельца через auth.
11. **RLS и auth для** `ai-generate-document`**.**  
Edge function должна работать только для authenticated пользователя и сама резолвить:
  - `auth.user.id`
  - `profile_id`  
  Нельзя принимать `profile_id` от клиента как доверенный параметр.
12. **Формат v1 зафиксировать как DOCX.**  
PDF не обещать в этом патче, если его нет в текущем engine.  
Иначе scope расползётся.
13. **Delete person/entity после генерации — обязательно включить proof.**  
В DoD добавить отдельный runtime proof:
  - сгенерировать документ
  - удалить source person/entity
  - открыть историю
  - скачать файл
  - проверить, что snapshot/preview не развалился
14. **Нужен явный STOP по настройкам и billing-таблицам.**  
Отдельно прописать:
  - `generated_documents` billing-table не менять
  - `generate-from-template` billing-function не менять
  - `/settings/legal-details` не менять
  - `orders_v2` не трогать

Если хотите, следующим сообщением дам уже **готовый финальный блок ТЗ PATCH 8 для вставки в Lovable** с учётом этих правок.

&nbsp;

PATCH 8 — Документы v1 в AI

## Анализ текущего состояния

### Что уже есть

1. `**generated_documents**` — таблица с 115 записями, привязана к billing flow (`order_id NOT NULL`, FK → `orders_v2`). Использовать для AI-документов **нельзя** — `order_id` обязательный, FK жёсткий, billing RLS. Трогать эту таблицу запрещено (protected flow).
2. `**document_templates**` — 1 запись (billing шаблон). Можно использовать как источник шаблонов для AI тоже, добавив фильтрацию.
3. `**generate-from-template**` — edge function для billing (order_id обязателен). Трогать нельзя.
4. **Storage buckets**: `documents` (generated), `documents-templates` (шаблоны) — оба существуют, можно переиспользовать.
5. **Вкладка Документы** — 4 stub-таба (accountant/manager/audit/templates).

### Что нужно создать

Отдельную таблицу `ai_generated_documents` и отдельную edge function `ai-generate-document` — чтобы не трогать billing flow.

---

## План реализации

### 1. Миграция — новая таблица `ai_generated_documents`

Отдельная таблица, не связанная с `orders_v2`:

```text
ai_generated_documents
  id uuid PK
  profile_id uuid NOT NULL FK → profiles
  template_id uuid NULL FK → document_templates
  template_name text NOT NULL
  title text NOT NULL
  status text NOT NULL DEFAULT 'generated'
  legal_details_id uuid NULL  (NO FK — snapshot-based)
  person_id uuid NULL          (NO FK — snapshot-based)
  signer_person_id uuid NULL   (NO FK — snapshot-based)
  signer_link_id uuid NULL     (NO FK — snapshot-based)
  file_path text NULL
  snapshot jsonb NOT NULL
  missing_tokens jsonb NOT NULL DEFAULT '[]'
  meta jsonb NOT NULL DEFAULT '{}'
  created_at timestamptz NOT NULL DEFAULT now()
  updated_at timestamptz NOT NULL DEFAULT now()
```

Ключевое: **без FK на `client_legal_details` / `legal_details_persons` / `legal_details_entity_person_links**` — только id для reference + полный snapshot. После hard delete исходных записей документ остаётся целым.

Индексы: `(profile_id, created_at DESC)`, `(template_id)`.

RLS: владелец видит свои по `profile_id`; admin/superadmin через `has_role_v2`.

Trigger `updated_at`.

### 2. Edge function `ai-generate-document`

Новая функция, не трогающая billing flow:

1. Принимает: `template_id`, `legal_details_id?`, `person_id?`, `signer_link_id?`, `snapshot`
2. Скачивает шаблон из `documents-templates`
3. Рендерит через docxtemplater используя snapshot данные
4. Сохраняет output в `documents` bucket (путь: `ai-generated/{profile_id}/{timestamp}.docx`)
5. Создаёт запись в `ai_generated_documents`
6. Возвращает `document_id` + signed URL

### 3. Snapshot resolver (клиентский)

Утилита `src/utils/aiDocumentSnapshotResolver.ts`:

Собирает snapshot из выбранных entity/person/link:

- `entity`: все поля из `client_legal_details`
- `person`: все поля из `legal_details_persons`
- `signer`: данные физлица-подписанта
- `link`: role_type, position_label, acts_on_basis, share_percent, is_primary

Token resolver: маппит snapshot поля на `{{token}}` placeholders шаблона.

Missing tokens: сравнивает `template.placeholders[]` со snapshot, возвращает список незаполненных.

### 4. UI — замена stubs

Убрать 4 stub-таба (accountant/manager/audit/templates), заменить на 2 рабочих:

```text
DOC_SUB_TABS = [
  { id: "generate", label: "Создать документ", icon: FileText },
  { id: "history",  label: "История",         icon: Clock },
]
```

#### Tab "Создать документ" — `AiDocumentsGenerateView.tsx`

- Список шаблонов из `document_templates` (is_active=true)
- Поиск по названию
- Кнопка "Сформировать" → открывает wizard dialog

#### Tab "История" — `AiDocumentsHistoryView.tsx`

- Таблица `ai_generated_documents` текущего пользователя
- Колонки: дата, название, шаблон, статус
- Действия: скачать (signed URL), удалить запись

### 5. Generate Document Wizard — `GenerateAiDocumentDialog.tsx`

Многошаговый dialog:

**Шаг 1 — Источники данных:**

- Выбор ЮЛ/ИП (dropdown из `ai-entities`)
- Выбор физлица (dropdown из `ai-persons`)
- Выбор подписанта (dropdown из links выбранного entity, показывая ФИО + роль + должность + is_primary badge)

**Шаг 2 — Preview заполнения:**

- Таблица: token → значение → статус (✅ / ⚠️ missing)
- Если есть missing tokens — предупреждение
- Кнопка "Сформировать" (разрешена даже с missing, но с confirm)

**Шаг 3 — Генерация:**

- Вызов edge function
- Toast успеха
- Переключение на вкладку "История"

### 6. Hooks

- `src/hooks/useAiDocuments.ts` — query `ai_generated_documents`, mutation delete, download
- Переиспользовать `useDocumentTemplates` для списка шаблонов (уже есть)

### 7. Routing / AI.tsx

- Изменить `DOC_SUB_TABS` — убрать accountant/manager/audit/templates, добавить generate/history
- Добавить рендер `AiDocumentsGenerateView` и `AiDocumentsHistoryView`
- `DEFAULT_SUB.documents = "generate"`

---

## Файлы


| Файл                                                       | Действие                                         |
| ---------------------------------------------------------- | ------------------------------------------------ |
| SQL миграция                                               | Создать `ai_generated_documents` + RLS + индексы |
| `supabase/functions/ai-generate-document/index.ts`         | Создать — edge function генерации                |
| `src/utils/aiDocumentSnapshotResolver.ts`                  | Создать — snapshot builder + token resolver      |
| `src/hooks/useAiDocuments.ts`                              | Создать — CRUD hook для AI документов            |
| `src/components/ai-documents/AiDocumentsGenerateView.tsx`  | Создать — список шаблонов                        |
| `src/components/ai-documents/AiDocumentsHistoryView.tsx`   | Создать — история генераций                      |
| `src/components/ai-documents/GenerateAiDocumentDialog.tsx` | Создать — wizard генерации                       |
| `src/components/ai-documents/TokenPreviewTable.tsx`        | Создать — preview токенов                        |
| `src/pages/AI.tsx`                                         | Изменить — заменить stubs на рабочие компоненты  |


## Что НЕ трогаем

- `generated_documents` таблица (billing)
- `generate-from-template` edge function (billing)
- `/settings/legal-details`
- billing / payment flow
- public checkout
- PATCH 5/6/7 — persons, entities, links CRUD
- `legal_details_roles_catalog`, `legal_details_positions_catalog` (только чтение)
- GRP / addresses / formatter
- unrelated admin screens