# Stage D.1 — UI grouping + read-only stale/missing indicators

## Статус: PASS (frontend-only)

Реализовано строго в рамках утверждённого плана Stage D.1. Backend не менялся.

## Изменённые файлы

- `src/hooks/useRepeatableDocumentStaleness.ts` — новый read-only hook.
- `src/components/ai-documents/packages/PackageGenerationHistory.tsx` — group per-recipient внутри batch, batch-границы явные.
- `src/components/ai-documents/packages/PackageDocumentCard.tsx` — бейдж «N/M получ.» в шапке + read-only секция «Получатели документа».

Подтверждение, что backend не тронут:

```bash
$ rg -n "ai-generate-document-package|canonical-document-generate-strict|gotenberg|only_missing|target_assignment_ids" src/hooks/useRepeatableDocumentStaleness.ts src/components/ai-documents/packages/PackageGenerationHistory.tsx
# нет совпадений в новых/изменённых файлах
```

Никаких update/insert/delete по `ai_generated_documents` / `document_package_item_role_assignments` со стороны UI не добавлено. Edge functions registry, схема БД, idempotency-ключ не менялись.

## Discovery: реальное поле item_id в `ai_generated_documents`

SQL (тестовый batch Stage C):

```sql
SELECT id, package_item_id, meta->>'package_item_id' AS meta_pii,
       meta->>'generation_mode' AS gm,
       meta->>'repeat_assignment_id' AS ra
FROM ai_generated_documents
WHERE generation_batch_id = '758080c9-b86c-44c8-bccb-472755964db7';
```

Результат:

| id | package_item_id (column) | meta.package_item_id |
| --- | --- | --- |
| 5a281439… | NULL | `63bb4030-f3bc-41b8-8cbd-fcadfdfd3531` |
| 128fda50… | NULL | `f9962f6b-b3a5-411d-ad2c-fa651aa8b6e9` |
| 18205281… | NULL | `febd1821-fba8-4290-babf-99c59c27f2f4` |
| df6252a3… | NULL | `febd1821-fba8-4290-babf-99c59c27f2f4` |
| d75e2903… | NULL | `febd1821-fba8-4290-babf-99c59c27f2f4` |

Вывод: для группировки используется `meta.package_item_id` с fallback на колонку `package_item_id`. Поля `source_package_template_item_id` нет.

## Canonical meta-поля (зафиксированы в hook и UI)

- `meta.generation_mode` (`single` | `per_role_person`)
- `meta.repeat_role_catalog_id`
- `meta.repeat_assignment_id`
- `meta.recipient_person_id`
- `meta.recipient_display_name`
- `meta.recipient_index`
- `meta.recipient_snapshot.full_name` — fallback ФИО
- `meta.package_item_id`, `meta.package_session_id` (последнее — только в batch.meta)

Fallback ФИО: `recipient_display_name` → `recipient_snapshot.full_name` → `«Получатель {person_id.slice(0,8)}»` → `«Получатель #{index}»`.

## SQL по batch boundary (latest успешный batch Stage C)

```sql
SELECT generation_batch_id,
       meta->>'package_item_id'        AS package_item_id,
       meta->>'generation_mode'        AS generation_mode,
       meta->>'repeat_assignment_id'   AS repeat_assignment_id,
       meta->>'recipient_display_name' AS recipient_display_name,
       (meta->>'recipient_index')::int AS recipient_index,
       status
FROM ai_generated_documents
WHERE generation_batch_id = '758080c9-b86c-44c8-bccb-472755964db7'
ORDER BY package_item_id,
         (meta->>'recipient_index')::int NULLS LAST,
         created_at;
```

Результат (5 строк): 2 single (Инструкция, Приказ) + 3 per_role_person (Петров #1 / Иванов #2 / Федорчук #3), все `status=generated`. Соответствует ожидаемому UI отображению:

- Latest batch (`758080c9…`) показывает 3 группы:
  - single: «0. Инструкция о проведении…»
  - single: «1. Приказ о проведении…»
  - **per_role_person группа**: «2. Извещение о проведении… — 3 получателей», раскрытие → Петров → Иванов → Федорчук в порядке `recipient_index`.

## Active assignments для item

```sql
SELECT id, person_id, sort_order
FROM document_package_item_role_assignments
WHERE package_session_id = '6a61a7e3-04b5-4e3c-aacb-8af1dbef6d53'
  AND package_template_item_id = 'febd1821-fba8-4290-babf-99c59c27f2f4'
  AND role_catalog_id = 'c8fc4200-75c0-4c24-8eea-112c4e468aeb'
  AND is_active = true
  AND person_id IS NOT NULL
ORDER BY sort_order;
```

Сравнение `meta.repeat_assignment_id` (latest batch) ↔ active assignments:
- 77540e62 (Петров) ∈ active → ok
- 0c458f06 (Иванов) ∈ active → ok
- 44d5ce98 (Федорчук) ∈ active → ok

→ stale = 0, missing = 0. Бейдж в шапке: «3/3 получ.» (emerald).

## DoD D.1.1 — UI grouping

- [x] Latest batch показывает «Извещение — 3 получателей», порядок 1→2→3 по `recipient_index`, дальше `created_at` → `id`.
- [x] У каждого получателя своя кнопка «PDF» и «DOCX»; failed без файла — disabled с tooltip «Файл не создан».
- [x] Single-доки (`generation_mode != 'per_role_person'`) рендерятся отдельной строкой и НИКОГДА не сворачиваются.
- [x] Разные batch не смешиваются: каждый `BatchRowItem` — отдельная collapsible-карточка, заголовок: `Batch <short id> · дата · статус`.
- [x] Failed-получатель внутри группы: заголовок группы показывает `X ошибка` бейдж.
- [x] Технические поля (`document_number`, `document_date`) сохранены.
- [x] `DocumentHistoryView` не менялся — регрессии нет.

## DoD D.1.2 — read-only stale / missing / mode_changed

- [x] Hook `useRepeatableDocumentStaleness` строго read-only. Подтверждение:

  ```bash
  $ rg -n "\.update|\.insert|\.delete|\.upsert|invoke|rpc\(" src/hooks/useRepeatableDocumentStaleness.ts
  # нет совпадений
  ```

- [x] Sравнение stale/missing — только в пределах latest batch и текущего `repeat_role_catalog_id` для item.
- [x] Старые batch не помечаются stale/missing (логика смотрит только `latestBatchId`).
- [x] Карточка показывает «X устаревших» + «Y не сгенерировано» как read-only списки с ФИО.
- [x] Подсказка: «сформируйте пакет заново через панель — будет создан новый batch». Кнопка «Перегенерировать только недостающих» **не добавлена**.
- [x] mode_changed не блокирует скачивание; в истории нейтральные batch-группы — старый per_role_person batch отрисуется как обычная группа без бейджей ошибок.
- [x] Никаких UI-операций DELETE/UPDATE по `ai_generated_documents` / `document_package_item_role_assignments`.

## DoD D.1.3 — индикатор «N/M получателей» на карточке

- [x] Только для `generation_mode='per_role_person'` + `repeat_role_catalog_id IS NOT NULL`.
- [x] Считается по latest **successful** batch (среди docs item'а есть хотя бы один `status='generated'`).
- [x] При failed/blocked последнего запуска и наличии более раннего успешного batch — секция показывает 2 строки: «Последний успешный batch: N/M» + «Последний запуск: <status>».
- [x] Если успешного batch ни разу не было — бейдж скрыт.

## Stop-guards — проверены

- [x] Backend не менялся: edge function `ai-generate-document-package` и любые другие не вызывались и не дополнялись.
- [x] Никаких миграций / новых RPC / новых meta-полей.
- [x] Никаких ручных DELETE/UPDATE в proof-сценариях (используются read-only SQL).

## Итоговый статус

```
Stage A   — PASS
Stage B   — PASS
Stage C   — PASS
Stage D.1 — PASS  (UI grouping + read-only stale/missing indicators)
Stage E   — NOT STARTED  (selective regeneration / cleanup actions, backend + UI)
```

Selective regeneration / cleanup НЕ закрыты. Stage E оформляется отдельным планом.
