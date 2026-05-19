# Execute B-97 — Placeholders FLD-ID backfill (отчёт)

Дата: 2026-05-13
Status: **EXECUTED**
Batch: `placeholders_fld_backfill_B97_2026_05_13`
Связанный dry-run: `.lovable/proofs/placeholders_fld_backfill_dryrun_B_97_2026_05_13.md`

## 1. Preflight (выполнен в той же операции, до INSERT)

| Проверка | Ожидание | Факт |
|---|---|---|
| `max(public_id)` | `FLD-000272` | `FLD-000272` ✅ |
| Scope (`document_token_registry.field_id IS NULL` ∧ customer.*/executor.leg.* без `org_form`) | 97 | 97 ✅ |
| Конфликты (`fields_registry.key` пересечения) | 0 | 0 ✅ |
| `executor.leg.org_form` исключён | да | да ✅ |
| `executor.ind.*` / `executor.ent.*` postponed | 50 | 50 ✅ |

## 2. Доп. фикс перед INSERT: дрейф счётчика `public_id_sequences`

При первой попытке INSERT триггер `set_field_registry_public_id` упал по UNIQUE (`FLD-000268 already exists`). Причина: `public_id_sequences(entity_type='field').last_value = 267`, а фактический `max(public_id) = FLD-000272` (исторический дрейф, не связанный с B-97).

Действие — синхронизация счётчика без ручного назначения диапазона:

```sql
UPDATE public.public_id_sequences
SET last_value = GREATEST(last_value, 272)
WHERE entity_type='field';
-- last_value: 267 -> 272
```

После этого триггер штатно выдал `FLD-000273..FLD-000369`. Хардкод диапазона в INSERT не использовался.

## 3. INSERT / UPDATE

Одной транзакцией CTE:

- `INSERT INTO fields_registry(entity_type, key, label, data_type, options)` с `options.batch_id = 'placeholders_fld_backfill_B97_2026_05_13'`, `scope = 'B-97'`, `source = 'typed_customer_executor_backfill'`.
- `UPDATE document_token_registry SET field_id = ins.id WHERE token_key = ins.key AND field_id IS NULL`.
- Анти-конфликт: `NOT EXISTS (SELECT 1 FROM fields_registry WHERE key = dtr.token_key)`.

Возврат:

| Метрика | Значение |
|---|---|
| `inserted` (fields_registry) | **97** |
| `linked` (document_token_registry.field_id) | **97** |
| `min_public_id` | `FLD-000273` |
| `max_public_id` | `FLD-000369` |

## 4. Verify (post-execute)

```sql
SELECT
  (SELECT count(*) FROM fields_registry WHERE options->>'batch_id'='placeholders_fld_backfill_B97_2026_05_13') AS batch_count,
  (SELECT count(*) FROM document_token_registry dtr JOIN fields_registry fr ON fr.id=dtr.field_id
     WHERE fr.options->>'batch_id'='placeholders_fld_backfill_B97_2026_05_13') AS linked_count,
  (SELECT count(*) FROM document_token_registry WHERE field_id IS NULL
     AND (token_key LIKE 'executor.ind.%' OR token_key LIKE 'executor.ent.%' OR token_key='executor.leg.org_form')) AS still_postponed,
  (SELECT field_id FROM document_token_registry WHERE token_key='executor.leg.org_form') AS org_form_field_id;
```

| Метрика | Ожидание | Факт |
|---|---|---|
| `fields_registry inserted` | 97 | **97** ✅ |
| `document_token_registry.field_id linked` | 97 | **97** ✅ |
| `will_create_aliases` | 0 | 0 (DDL не запускался) ✅ |
| `aliases inserted` | 0 | 0 ✅ |
| `remaining runtime/postponed` | 51 | **51** ✅ (26 + 24 + 1) |
| `executor.leg.org_form.field_id` | NULL | **NULL** ✅ |
| Фактический диапазон `public_id` | `FLD-000273..FLD-000369` | **FLD-000273..FLD-000369** ✅ |

Все метрики совпадают с dry-run B-97 → STOP/ROLLBACK не сработал.

## 5. Что НЕ сделано (намеренно)

- Резолвер (`supabase/functions/_shared/document-render.ts`) ещё не расширен под 97 typed-токенов — это отдельный код-патч, после него gating smoke по 3 fixtures.
- UI каталога плейсхолдеров пока показывает 97 токенов в прежнем runtime-режиме (теперь у них есть FLD-ID, но переключение копирования на `{{field:FLD-XXX}}` и снятие лейбла «runtime» — следующий шаг).
- `executor.leg.org_form` остаётся без FLD-ID и без branch в резолвере (никаких пустых веток).
- `executor.ind.*` (26) и `executor.ent.*` (24) — отдельный спринт «Executor requisites schema expansion» после расширения модели данных.

## 6. Rollback (если потребуется)

```sql
BEGIN;
UPDATE public.document_token_registry
SET field_id = NULL
WHERE field_id IN (
  SELECT id FROM public.fields_registry
  WHERE options->>'batch_id' = 'placeholders_fld_backfill_B97_2026_05_13'
);
DELETE FROM public.fields_registry
WHERE options->>'batch_id' = 'placeholders_fld_backfill_B97_2026_05_13';
-- Счётчик public_id_sequences после rollback откатывать НЕ нужно: дрейф был доп. фиксом,
-- следующий INSERT просто получит FLD-000370+.
COMMIT;
```

## 7. Почему 97, а не 148

- 50 `executor.ind/ent` токенов — нет SOT в плоской таблице `executors`. Создание FLD сейчас = мёртвые поля.
- 1 `executor.leg.org_form` — нет SOT-колонки, нет доказанного computed-источника.
- Это **защита от мёртвых FLD**, не ошибка. Каждый FLD в реестре обязан резолвиться.
- Отдельный спринт: «Executor requisites schema expansion» (модель ФЛ/ИП исполнителя + докатка ≤51 токена).
