# да, согласен, с учетом правок:

&nbsp;

1. В useAiDocuments.ts для join на batch используй явный relation alias по FK, а не неявный join. Формат вида:
  batch:ai_document_generation_batches!ai_generated_documents_generation_batch_id_fkey(title)
  Это безопаснее и не зависит от неоднозначного auto-relations.
2. В useLastPackageBatch обязательно фильтруй по profile_id владельца через уже используемый project pattern ([profiles.id](http://profiles.id)), а не по [auth.users.id](http://auth.users.id).
3. Для prefill бери последний batch только по статусам generated / partial, чтобы не подтягивать невалидный запуск с error как основной источник данных.
4. В GenerateAiDocumentPackageDialog.tsx оставь graceful fallback:
  если batch не найден или в batch.meta нет selected_entity_id / selected_person_id / selected_signer_link_id, banner prefill не показывать и wizard открывать в чистом состоянии.
5. В AiDocumentsHistoryView.tsx batch title показывай рядом с badge Пакет как отдельный текстовый label, но не вместо template_name. Должно остаться видно:
  &nbsp;
  - название конкретного документа,
  - badge Пакет,
  - имя batch/package.
  &nbsp;
6. Ничего из текущего PATCH 10 не удалять:
  &nbsp;
  - badge Пакет сохранить,
  - flat history сохранить,
  - одиночную генерацию не трогать,
  - edge function пакета не менять.
  &nbsp;

&nbsp;

&nbsp;

PATCH 10.1 — Batch title in history + prefill from batch

## Проблемы

1. **История**: badge "Пакет" есть, но нет имени пакета/batch. Документы пакета визуально неотличимы.
2. **Prefill**: wizard ищет `lastBatchDoc` через `documents.find(d => d.package_template_id === ...)` — это берёт первый попавшийся документ, а не последний batch. Нужно читать из `ai_document_generation_batches`.

## Изменения

### 1. `AiDocumentsHistoryView.tsx` — показать batch title

- Изменить запрос в `useAiDocuments` (или добавить отдельный lookup): для документов с `generation_batch_id` подтянуть `batch.title` через join или отдельный запрос.
- Вариант реализации: в `useAiDocuments` query добавить select с join на `ai_document_generation_batches`:
  ```
  .select("*, batch:ai_document_generation_batches(title)")
  ```
- В `AiDocumentsHistoryView` рядом с badge "Пакет" показать `doc.batch?.title` как текст (например, "Годовое собрание — PKG-260323-042").

### 2. `GenerateAiDocumentPackageDialog.tsx` — prefill из batch, а не из документа

Текущий код (строки 72-83): ищет `lastBatchDoc` в `documents` по `package_template_id` — ненадёжно.

Исправление:

- Добавить в `useDocumentPackages` (или отдельный hook) запрос последнего batch для данного `package_template_id`:
  ```sql
  SELECT * FROM ai_document_generation_batches 
  WHERE package_template_id = ? AND profile_id = ?
  ORDER BY created_at DESC LIMIT 1
  ```
- В `applyPrefill` читать `batch.meta` (где уже сохранены `selected_entity_id`, `selected_person_id`, `selected_signer_link_id`).
- Убрать зависимость prefill от `documents` массива.

### 3. `useAiDocuments.ts` — добавить join на batch

- В query добавить join: `*, batch:ai_document_generation_batches(title)`
- В interface `AiGeneratedDocument` добавить optional `batch?: { title: string } | null`

## Файлы


| Действие | Файл                                                                                   |
| -------- | -------------------------------------------------------------------------------------- |
| Edit     | `src/hooks/useAiDocuments.ts` — join batch title                                       |
| Edit     | `src/components/ai-documents/AiDocumentsHistoryView.tsx` — render batch title          |
| Edit     | `src/components/ai-documents/GenerateAiDocumentPackageDialog.tsx` — prefill from batch |
| Edit     | `src/hooks/useDocumentPackages.ts` — add `useLastPackageBatch` query                   |


## Что НЕ меняется

- Edge function — без изменений
- Одиночная генерация — без изменений
- Billing, shell, templates manager — без изменений