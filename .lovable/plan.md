# да, согласен, с учетом правок:

&nbsp;

1. Owner / RLS модель
  &nbsp;
  - В ai_document_generation_batches.profile_id хранить только [profiles.id](http://profiles.id), не [auth.users.id](http://auth.users.id).
  - created_by — отдельно [auth.users.id](http://auth.users.id).
  - RLS для batches делать только по проектному паттерну:
    profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    &nbsp;
    - admin/super_admin через has_role_v2.
    &nbsp;
  &nbsp;
2. Batch-связь в истории
  &nbsp;
  - В AiDocumentsHistoryView показывать не только badge Пакет, но и читаемое имя batch/пакета.
  - Минимум: при наличии generation_batch_id подтягивать batch.title.
  - Flat list оставить можно, но без “безымянного пакета”.
  &nbsp;
3. Meta batch для повторного заполнения
  &nbsp;
  - При создании batch обязательно сохранять в ai_document_generation_batches.meta:
    &nbsp;
    - selected_entity_id
    - selected_person_id
    - selected_signer_link_id
    - package_template_name
    &nbsp;
  - Это нужно, чтобы prefill для пакетного wizard работал стабильно и не зависел от отдельных документов.
  &nbsp;
4. Имена файлов внутри пакета
  &nbsp;
  - При генерации нескольких DOCX в одном batch не использовать одинаковые имена.
  - В file_name/file_path включить:
    &nbsp;
    - номер batch
    - порядковый номер item
    - безопасное имя шаблона/item
    &nbsp;
  - Иначе возможны коллизии файлов внутри одного запуска.
  &nbsp;
5. Preview пакета
  &nbsp;
  - На шаге preview считать заполненность по каждому шаблону отдельно, используя его собственные placeholders.
  - Не делать общий summary вместо покомпонентного preview.
  - Если у шаблона placeholders пустые — явно показывать предупреждение на карточке этого документа.
  &nbsp;
6. Статусы batch
  &nbsp;
  - Поддержать минимум 4 статуса:
    &nbsp;
    - pending
    - generated
    - partial
    - error
    &nbsp;
  - Если часть документов создалась, а часть нет — batch не должен становиться generated.
  &nbsp;
7. Записи документов пакета
  &nbsp;
  - В ai_generated_documents при пакетной генерации обязательно заполнять:
    &nbsp;
    - generation_batch_id
    - package_template_id
    - package_item_id
    &nbsp;
  - Для одиночной генерации эти поля остаются NULL.
  &nbsp;
8. Shared helper
  &nbsp;
  - Не дублировать бесконтрольно серверную логику snapshot/token/render/upload.
  - Если выносите в _shared, делать add-only и без изменения API существующего ai-generate-document.
  - Если вынос общего helper рискованный — допустимо временно продублировать код, но без регресса текущей одиночной генерации.
  &nbsp;
9. Wizard пакета — prefill
  &nbsp;
  - Для пакетного wizard реализовать тот же reversible flow, что уже исправлен в одиночном:
    &nbsp;
    - initial choice
    - history
    - fresh
    - возврат к прошлым данным без закрытия окна
    &nbsp;
  &nbsp;
10. Карточки пакетов в Create view
  &nbsp;
  - Кнопку Заполнить пакет сделать рабочей.
  - Badge Пакет • N документов должен брать реальное количество items, а не заглушку.
  &nbsp;
11. DoD дополнить
  &nbsp;
  - Отдельно проверить:
    &nbsp;
    - одиночный wizard не сломан;
    - пакетная генерация создаёт несколько записей;
    - у всех документов один generation_batch_id;
    - история показывает пакетные документы с именем пакета;
    - повторное открытие пакетного wizard предлагает прошлые данные;
    - нет ошибок в консоли и overlay.
    &nbsp;
  &nbsp;
12. Что пока не делать
  &nbsp;
  - Не внедрять сейчас “анкеты пакета”, branching, zip, pdf, visual builder.
  - Только foundation v1: один wizard пакета, много DOCX, общая batch-связь.
  &nbsp;

&nbsp;

&nbsp;

PATCH 10 — Пакеты документов v1: реальная генерация

## Обзор

Пакет документов — бизнес-сценарий, генерирующий несколько DOCX за один запуск wizard. Текущая одиночная генерация остается без изменений.

## Архитектура

```text
┌─────────────────────────────────────────────┐
│  AiDocumentsGenerateView                    │
│  ┌──────────┐  ┌─────────────────────────┐  │
│  │ Одиночный │  │ Пакет (кнопка           │  │
│  │ шаблон    │  │ "Заполнить пакет")      │  │
│  └────┬──────┘  └────────┬────────────────┘  │
│       │                  │                   │
│       ▼                  ▼                   │
│  GenerateAi         GenerateAiDocument       │
│  DocumentDialog     PackageDialog (NEW)      │
│  (без изменений)    Шаг1: данные            │
│                     Шаг2: preview пакета    │
│                     Шаг3: генерация         │
│                          │                   │
│                          ▼                   │
│              Edge: ai-generate-document      │
│              -package (NEW)                  │
│              Цикл по items пакета           │
│              → N записей ai_generated_docs  │
│              → все с generation_batch_id    │
└─────────────────────────────────────────────┘
```

## Изменения

### 1. Миграция БД

Новая таблица `ai_document_generation_batches`:

- `id` uuid PK
- `profile_id` uuid NOT NULL (→ profiles.id)
- `package_template_id` uuid NULL (→ document_package_templates.id)
- `title` text NOT NULL
- `status` text NOT NULL DEFAULT 'pending' (pending/generated/partial/error)
- `meta` jsonb DEFAULT '{}'
- `created_by` uuid NULL
- `created_at` / `updated_at` timestamptz

Новое поле в `ai_generated_documents`:

- `generation_batch_id` uuid NULL (→ ai_document_generation_batches.id)

RLS для batches: owner через `profile_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())` + admin/super_admin.

Trigger `updated_at` для batches.

### 2. Edge function `ai-generate-document-package`

Принимает: `package_template_id`, `legal_details_id?`, `person_id?`, `signer_link_id?`

Логика:

1. Auth + resolve profileId (тот же паттерн что в ai-generate-document)
2. Загрузить пакет + его items (с join на document_templates)
3. Создать batch запись (status='pending')
4. Для каждого item:
  - Загрузить template файл
  - Собрать snapshot + tokenData (та же логика что в ai-generate-document — дублирование кода, но изолированно, без ломания существующей функции)
  - Рендер docxtemplater
  - Upload в documents bucket
  - Создать запись в ai_generated_documents с `generation_batch_id`, `package_template_id`, `package_item_id`
5. Обновить batch status на 'generated' (или 'partial'/'error')
6. Вернуть массив результатов + download URLs

Используем `_shared/cors.ts` для CORS. Snapshot/token-building логика копируется из ai-generate-document (не импортируем из него, чтобы не создавать зависимость и не ломать существующее).

### 3. Новый компонент `GenerateAiDocumentPackageDialog.tsx`

Sheet с `SHEET_SHELL_CLASS`. Три шага:

**Шаг 1** — Выбор данных (ЮЛ/ИП, физлицо, подписант). Точная копия UX из одиночного wizard, включая prefill banner (history/fresh) на основе последней пакетной генерации.

**Шаг 2** — Preview пакета. Список всех шаблонов в пакете, для каждого:

- Название (или title_override)
- Кол-во заполненных / пустых токенов
- Статус: все заполнены / есть пустые

**Шаг 3** — Генерация. Кнопка "Сформировать пакет" → вызов edge function → toast → переход в историю.

### 4. Hook `useAiDocumentPackageGeneration.ts`

- Вызов `supabase.functions.invoke("ai-generate-document-package", { body })`
- Loading / error / success
- Invalidate `ai-generated-documents` после успеха
- Без изменений в `useAiDocuments`

### 5. Изменения в `AiDocumentsGenerateView.tsx`

- Заменить disabled кнопку "Скоро" на рабочую "Заполнить пакет"
- Открывать `GenerateAiDocumentPackageDialog` при клике
- Импорт нового диалога

### 6. Изменения в `AiDocumentsHistoryView.tsx`

- В `useAiDocuments` interface добавить `generation_batch_id`
- В таблице: если у документа есть `package_template_id` — показать badge "Пакет"
- Flat list (без группировки), но с визуальной меткой пакета

### 7. Изменения в `useAiDocuments.ts`

- Добавить `generation_batch_id` в интерфейс `AiGeneratedDocument`

## Файлы


| Действие | Файл                                                              |
| -------- | ----------------------------------------------------------------- |
| Create   | `supabase/migrations/xxx_batch_table.sql`                         |
| Create   | `supabase/functions/ai-generate-document-package/index.ts`        |
| Create   | `src/components/ai-documents/GenerateAiDocumentPackageDialog.tsx` |
| Create   | `src/hooks/useAiDocumentPackageGeneration.ts`                     |
| Edit     | `src/components/ai-documents/AiDocumentsGenerateView.tsx`         |
| Edit     | `src/components/ai-documents/AiDocumentsHistoryView.tsx`          |
| Edit     | `src/hooks/useAiDocuments.ts` (add field to interface)            |


## Что НЕ меняется

- `ai-generate-document/index.ts` — без изменений
- `generate-from-template` — без изменений
- Billing flow — без изменений
- `GenerateAiDocumentDialog.tsx` — без изменений
- `AiDocumentTemplatesManager.tsx` — без изменений
- `AiDocumentPackagesManager.tsx` — без изменений
- Shell/layout — без изменений

## Ограничения v1

- Нет кастомных анкет под пакет
- Нет drag-and-drop
- Нет ZIP-архива пакета
- Нет PDF
- Нет branching logic
- Группировка в истории flat (badge, без collapsible groups)