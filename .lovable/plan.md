# да, согласен, с учетом правок:

1. **Не фиксировать** `SECURITY INVOKER` **заранее.**  
В миграции нужно сохранить текущий режим функции как есть. Если сейчас `search_deal_rows` работает как `SECURITY DEFINER`, нельзя менять на `SECURITY INVOKER`, иначе можно сломать видимость сделок/документов из-за RLS.
2. **Перед** `DROP FUNCTION` **обязательно снять текущую сигнатуру и grants.**  
В proof добавить:
  &nbsp;
  ```sql
  SELECT pg_get_functiondef('public.search_deal_rows(...)'::regprocedure);
  ```
  и после миграции подтвердить, что:
  - список аргументов не изменился;
  - return columns не изменились;
  - grants/owner/security mode не потерялись.
3. **Индекс добавить обязательно.**  
Даже если сейчас данных мало:
4. **Нормализация поиска.**  
Проверить, что `p_search='0905 / 1'` не нужен. Если пока поддерживаем только точный ввод `0905/1` и префикс `0905`, это явно зафиксировать в proof. Не добавлять сложную нормализацию в этот патч.
5. **Soft-delete тест должен быть изолированным.**  
Не менять реальные документы. Создать тестовый `ai_generated_documents` с `deleted_at IS NOT NULL`, проверить поиск, затем удалить тестовые данные.
6. **No-duplicates тест обязателен.**  
Сделка с двумя документами `0905/1` и `0905/2` должна вернуться одной строкой при поиске `0905`.
7. **Proof дополнить строкой “C5-G untouched”.**  
Прямо указать:
  - `canonical-document-generate-strict` не менялся;
  - `allocate_document_number` не менялся;
  - immutable trigger не менялся;
  - `document_number_counters` не менялась;
  - UI `AdminDeals` не менялся.

После этих правок план можно выполнять.

&nbsp;

План: C5-H — Поиск сделок по номеру документа

## Цель

Добавить возможность находить сделки в `search_deal_rows` по номеру сгенерированного документа в формате `DDMM/N` (точное совпадение `0905/1`) и по префиксу даты (`0905`), не трогая UI, генерацию и нумерацию документов.

## Discovery (зафиксировано)

- Источник поиска сделок — RPC `public.search_deal_rows`, миграция `20260429211230_*.sql`. Используется в `src/pages/admin/AdminDeals.tsx:467` через `supabase.rpc("search_deal_rows", ...)`.
- Сейчас `search_blob` строится из `orders_v2`, `profiles`, `products_v2`, `tariffs`. `ai_generated_documents.document_number` в blob НЕ участвует.
- Документы привязаны к сделке через `ai_generated_documents.context_type IN ('order','deal') AND context_id = orders_v2.id`. Поле `document_number` есть, soft-delete через `deleted_at`.
- UI `AdminDeals` принимает строку поиска как есть и не требует доработок для базового поиска по номеру (slash `/` валиден внутри term).

## Scope

Только read/search слой. Не меняем:

- генерацию/нумерацию (`canonical-document-generate-strict`, `allocate_document_number`, immutable trigger),
- `ai_generated_documents` схему,
- UI `AdminDeals` (опциональный бейдж — отдельным follow-up).

## Изменения

### 1. Миграция: пересоздать `search_deal_rows`

Сохранить сигнатуру и список возвращаемых колонок 1:1 (TypeScript-типы и `AdminDeals` не должны измениться).

В CTE `base` добавить агрегированный `LEFT JOIN`:

```sql
LEFT JOIN LATERAL (
  SELECT string_agg(DISTINCT ad.document_number, ' ') AS doc_numbers_blob
  FROM ai_generated_documents ad
  WHERE ad.context_type IN ('order','deal')
    AND ad.context_id = o.id
    AND ad.deleted_at IS NULL
    AND ad.document_number IS NOT NULL
) docs ON true
```

`search_blob` дополнить: `... || ' ' || coalesce(docs.doc_numbers_blob, '')`.

Логика matching через `v_terms` + `position(term IN search_blob)` уже поддерживает:

- точный `0905/1` — term содержит `/`, lower не ломает,
- префикс `0905` — `position` найдёт начало `0905/1`.

Агрегация через `string_agg` + `LATERAL` исключает дублирование строк сделок при N>1 документах.

### 2. UI

Без изменений. AdminDeals продолжит передавать `p_search` как есть. Опциональный бейдж «Документ № …» — вынесен в follow-up (не блокирует C5-H).

### 3. Tests (manual proof в QA-runner)

На реальной БД:

1. Выбрать сделку, у которой уже есть `ai_generated_documents.document_number` (или сгенерировать тестовый через canonical generate, чтобы получить `DDMM/N`).
2. Вызвать `search_deal_rows(p_search := '0905/1')` → сделка присутствует, ровно одна строка.
3. Вызвать `search_deal_rows(p_search := '0905')` → сделка присутствует, без дублей.
4. Регрессия: поиск по email / order_number / ФИО клиента возвращает прежний набор (сравнить count до/после на одинаковых параметрах).
5. Soft-deleted документ (`deleted_at IS NOT NULL`) — поиск по его номеру сделку НЕ находит.
6. Сделка с 2+ документами — в результате одна строка (no duplicates).

### 4. Proof

Обновить `.lovable/proofs/document_generation_sprint11_c5g_document_numbering.md`, новый раздел **C5-H — Search by document number**:

- diff `search_blob` (до/после),
- результаты тестов 1–6 с реальными `id`/`order_number`/`document_number`,
- подтверждение, что миграции на `ai_generated_documents`, `document_number_counters`, immutable-триггер и `allocate_document_number` НЕ менялись (`git diff --stat` по соответствующим файлам пуст).

## Технические детали

- Файл миграции: `supabase/migrations/<ts>_search_deal_rows_with_document_number.sql`. Полный `DROP FUNCTION ... CREATE FUNCTION` с идентичной сигнатурой.
- `SECURITY INVOKER` сохраняем — RLS на `ai_generated_documents` остаётся в силе для каждого вызывающего; для admin-страницы это уже работает.
- Производительность: `LATERAL` + индекс. Если на `ai_generated_documents (context_type, context_id) WHERE deleted_at IS NULL` индекса нет — добавить `CREATE INDEX IF NOT EXISTS idx_ai_gen_docs_context_active ON ai_generated_documents (context_type, context_id) WHERE deleted_at IS NULL;` в той же миграции.

## DoD

- Миграция применена, сигнатура RPC не изменилась, `types.ts` без изменений строк/колонок.
- Тесты 1–6 пройдены и зафиксированы в proof.
- AdminDeals работает без правок UI.
- Раздел **C5-H** добавлен в proof-файл.
- Никаких изменений в файлах генерации/нумерации/immutability.