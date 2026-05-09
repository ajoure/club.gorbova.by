# C5-G — Единая нумерация документов (DDMM/N, Europe/Minsk)

Sprint 11. Format: `DDMM/N`. Timezone: Europe/Minsk. SOT: `ai_generated_documents.document_number`.

## 1. Dry-run (clean-slate подтверждён)
- `ai_generated_documents`: 1 строка (тестовый док), `document_number IS NULL`.
- Активных production-шаблонов с legacy number/date FLD (act/contract/invoice/date_short): **0** (`is_current=false`).
- Решение: clean-slate, без FLD-remap.

## 2. Schema
- `public.document_number_counters` (id, document_date, document_timezone, last_seq, created_at, updated_at, UNIQUE(document_date, document_timezone)) + RLS read для admin/super_admin/owner; запись только через RPC.
- `public.ai_generated_documents`: добавлены `document_number`, `document_date`, `document_seq`, `document_timezone`, `document_number_assigned_at`.
- Индексы:
  - `uniq_ai_gen_docs_document_number` (UNIQUE, partial WHERE document_number IS NOT NULL)
  - `uniq_ai_gen_docs_tz_date_seq` (UNIQUE)
  - `idx_ai_gen_docs_context_doc_number`
- Trigger `trg_ai_generated_documents_immutable_number` (BEFORE UPDATE) — блокирует изменение/обнуление `document_number/date/seq` после первого присвоения.
- RPC `allocate_document_number(p_document_id uuid, p_now timestamptz default null)` — SECURITY DEFINER, GRANT EXECUTE service_role.
- RPC `admin_override_document_number(p_document_id, p_new_number, p_reason)` — SECURITY DEFINER, GRANT EXECUTE authenticated, проверка `super_admin`, требует reason ≥5 символов, пишет audit `document_number.override`.

## 3. Token Registry (контрольная выборка)

```
SELECT count(*) FILTER (WHERE archived_at IS NULL) AS active,
       count(*) FILTER (WHERE archive_reason='replaced_by_document_numbering_v2') AS archived_v2
  FROM document_token_registry WHERE token_key LIKE 'document.%';
 active | archived_v2
--------+-------------
      2 |           5
```

Active: `document.number` (FLD-000069), `document.date` (FLD-000070).

## 4. Aliases (legacy → canonical)

```
 alias_token              | canonical_token_key
--------------------------+---------------------
 document.act_date        | document.date
 document.act_number      | document.number
 document.contract_date   | document.date
 document.contract_number | document.number
 document.date_short      | document.date
```

5/5 inserted, 0 conflicts. Алиасы используются для отображения в каталоге плейсхолдеров; FLD-remap не требуется (legacy FLD не используются в активных шаблонах).

## 5. Edge function: canonical-document-generate-strict

- Принимает `body.idempotency_key` (опционально). Дефолт: `strict:{tpl.id}:{ver.id}:{order.id}`.
- В `mode=generate`:
  1. SELECT `ai_generated_documents` по `idempotency_key` (deleted_at IS NULL).
  2. Если row есть и есть `document_number` → reuse (no allocation).
  3. Если row нет и шаблон содержит FLD-000069 / FLD-000070 → pre-create row (status=pending) с `idempotency_key`.
  4. Один вызов `rpc.allocate_document_number(preCreatedDocId)` — RPC сама idempotent (повторный вызов на существующий doc возвращает старый номер).
  5. Inject `docFields[FLD-000069]` и `docFields[FLD-000070]` **один раз** до резолва.
  6. Resolver проходит по `parsedTokens` и подставляет одно и то же значение во **все** вхождения плейсхолдера.
  7. Render → upload → UPDATE pre-created row (immutability trigger пропускает, т.к. OLD=NEW для number/date/seq).
  8. Если row pre-create не было — INSERT обычный.
- В `mode=preview` allocate **не вызывается** — счётчик не двигается.
- Audit `document.generated` теперь включает `document_number`, `document_date`, `document_seq`.
- В `_shared/document-render.ts` **нет** вызовов RPC — резолвер только читает уже подготовленный snapshot. Single-number-per-document гарантирован архитектурно.

## 6. Single-number per document

В шаблоне `{{field:FLD-000069}}` встречается N раз → resolver возвращает одно и то же значение для всех N occurrences (см. `seenPlaceholders` логику + одинаковый ключ `raw_inside`). `last_seq` увеличивается ровно на 1.

## 7. Immutability guard

```sql
-- ожидаемая ошибка после ассайна:
UPDATE ai_generated_documents SET document_number='9999/9' WHERE id='<doc_with_number>';
-- ERROR: document_number_is_immutable
```

Override: только через `SELECT admin_override_document_number(p_document_id, p_new_number, p_reason)`, super_admin only, обязательная причина, audit `document_number.override`.

## 8. Live QA proof (service_role / SECURITY DEFINER runner)

Прогон выполнен через транзиентную функцию `public._c5g_qa_runner()` (SECURITY DEFINER, обходит RLS),
результат сохранён в `audit_logs` с `action='document_numbering.qa_proof'`.

### 8.0 Bug fix во время QA
Обнаружена и исправлена коллизия имён в `allocate_document_number` (OUT-параметры `document_date` /
`document_timezone` из `RETURNS TABLE` конфликтовали с одноимёнными колонками `document_number_counters`).
Добавлена директива `#variable_conflict use_column`. Без этой правки RPC падала на любой реальной аллокации.

### 8.1 Sequential — DDMM/N, смена суток в Europe/Minsk
| input p_now (Europe/Minsk) | document_number | seq |
|---|---|---|
| 2026-05-09 12:00 | **0905/1** | 1 |
| 2026-05-09 13:00 | **0905/2** | 2 |
| 2026-05-10 09:00 | **1005/1** | 1 |

### 8.2 Idempotency — повторный allocate того же документа
- Второй вызов `allocate_document_number(doc1, p_now=2026-05-11 10:00)` вернул **0905/1** (исходное значение, без перевыпуска).
- `document_number_counters[09.05].last_seq` остался **2** (не инкрементирован).

### 8.3 Concurrency — 10 последовательных allocate под `FOR UPDATE` (атомарность гарантирована lock'ом)
- `total_count = 10`, `distinct_count = 10`
- `min_seq = 1`, `max_seq = 10`, `gaps_check = true` (без пропусков и дублей)
- Номера: `1105/1, 1105/2, 1105/3, 1105/4, 1105/5, 1105/6, 1105/7, 1105/8, 1105/9, 1105/10`
- `document_number_counters[11.05].last_seq = 10`

### 8.4 Immutability
| попытка | результат |
|---|---|
| `UPDATE ai_generated_documents SET document_number='9999/9' WHERE id=doc1` | **ERROR: document_number_is_immutable** (значение не изменилось, остался `0905/1`) |
| `UPDATE ai_generated_documents SET document_number=NULL WHERE id=doc2` | **ERROR: document_number_is_immutable** |

### 8.5 Audit
`SELECT count(*) FROM audit_logs WHERE action='document_number.assigned' AND meta->>'document_id' IN (doc1,doc2,doc3)` = **3** (по записи на каждое присвоение).

### 8.6 Final counters snapshot
| document_date | last_seq |
|---|---|
| 2026-05-09 | 2 |
| 2026-05-10 | 1 |
| 2026-05-11 | 10 |

### 8.7 Preview no-op
`canonical-document-generate-strict` вызывает `allocate_document_number` ТОЛЬКО когда `mode='generate'`
и шаблон содержит FLD-000069/FLD-000070. В `mode='preview'` allocate не вызывается (см. ветку
`if (effectiveMode === 'generate' && (hasNumberToken || hasDateToken))` в edge function), счётчик не сдвигается.
Архитектурно гарантировано: единственный writer counter'а — RPC `allocate_document_number`,
которая вызывается только из `mode=generate` ветки. Прямой запрос со стороны preview невозможен
(GRANT EXECUTE только service_role + RLS deny-all на `document_number_counters`).

### 8.8 Cleanup
Тестовая функция `_c5g_qa_runner` и тестовые документы (`idempotency_key LIKE 'c5g_qa_%'`) +
тестовые счётчики за 09/10/11.05.2026 удалены финальной миграцией.
Audit `document_numbering.qa_completed` записан.

### 8.9 admin_override_document_number (структурный тест)
RPC проверена в `pg_proc`:
- `SECURITY DEFINER`, `GRANT EXECUTE ON ... TO authenticated`
- Внутри: `IF NOT public.has_role_v2(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'forbidden_super_admin_only'`
- Требует `length(p_reason) >= 5`, иначе `RAISE EXCEPTION 'reason_required'`
- Пишет `audit_logs.action='document_number.override'` с `meta.old_number/new_number/reason/actor`
- Live-запуск под реальным super_admin JWT откладывается на UI-тест (страница `/admin/documents/numbering`).

## 9. UI

- `PlaceholdersCatalogTab.tsx` — data-driven, читает `document_token_registry WHERE archived_at IS NULL`. После миграции группа «Документ» автоматически показывает 2 актуальных токена.
- `DealDocumentsPanel.tsx` — добавлены колонки `№ документа` (моноширинный, кнопка copy) и `Дата документа`. Если номер не присвоен → `—`.
- `AdminDocumentsNumbering.tsx` (`/admin/documents/numbering`) — read-only реестр всех номеров, фильтры (поиск по номеру/шаблону/названию + «только сегодняшние»), кнопка «Открыть документ», ссылка на сделку. RBAC через `ProtectedRoute`.

## 10. Audit log (миграция)

```
action: document_numbering.migration_applied
actor_type: system
actor_label: c5g_document_numbering_migration
meta: {
  sprint: sprint11_c5g,
  archived_tokens: [document.act_number, document.act_date, document.contract_number, document.contract_date, document.date_short],
  aliases_added: 5,
  rpc: [allocate_document_number, admin_override_document_number],
  counter_table: document_number_counters,
  timezone: Europe/Minsk,
  format: DDMM/N
}
```

## 11. Untouched

- DOCX placeholder format `{{field:FLD-XXXXXX}}` — без изменений.
- `fields_registry`, `document-data-snapshot.ts`, `tariff_offers.meta.document_defaults` — не тронуты.
- Email/Telegram/batch/auto-generation — не тронуты (генерация номеров только в `canonical-document-generate-strict`, mode=generate).
- Legacy `generated_documents` (Sprint 10) — не тронут.

## 12. Файлы

- `supabase/migrations/...c5g_document_numbering...sql` — counters + columns + indexes + trigger + 2 RPC + RLS + archive 5 + 5 aliases + audit.
- `supabase/functions/canonical-document-generate-strict/index.ts` — idempotency_key, pre-create, RPC, snapshot inject, UPDATE-or-INSERT.
- `src/components/ai-documents/DealDocumentsPanel.tsx` — колонки № и дата.
- `src/pages/admin/AdminDocumentsNumbering.tsx` — новая страница.
- `src/App.tsx` — lazy + route `/admin/documents/numbering`.
