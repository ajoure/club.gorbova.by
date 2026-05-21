# PATCH-INV20-REBILL-SUPERSEDED-2026-05

## Diagnose (read-only, до code edit)

INV-20 алерт: 2 paid заказа за 30д без `payments_v2`:
- `REBILL-2071054f-906` (id `c82ad679-12e4-4d37-a263-16c91657a07b`)
- `REBILL-97fb20f7-f7c` (id `ecd989f1-1245-45b8-9774-67808799bb58`)

### Доказательство классификации (SQL)

```sql
SELECT order_number, provider, provider_payment_id,
       meta->>'transaction_uid' AS tu,
       meta->>'bepaid_payment_uid' AS bpu,
       meta->>'provider_payment_id' AS ppi,
       meta->>'source' AS src
FROM orders_v2
WHERE order_number IN ('REBILL-2071054f-906','REBILL-97fb20f7-f7c');
```

Результат:

| order_number | provider | provider_payment_id (col) | meta.tu | meta.bpu | meta.ppi | meta.source |
|---|---|---|---|---|---|---|
| REBILL-2071054f-906 | bepaid | 2071054f-906d-406a-9c20-f0dc08e5c737 | null | null | null | bepaid_rebill |
| REBILL-97fb20f7-f7c | bepaid | 97fb20f7-f7cc-4c04-bc1b-a8b0c384ab98 | null | null | null | bepaid_rebill |

→ meta пустой по UID; UID есть ТОЛЬКО в колонке `provider_payment_id`.

### Доказательство collision (payments_v2 уже содержит этот UID на другом order)

```sql
SELECT id, order_id, status, provider_payment_id
FROM payments_v2
WHERE provider_payment_id IN (
  '2071054f-906d-406a-9c20-f0dc08e5c737',
  '97fb20f7-f7cc-4c04-bc1b-a8b0c384ab98'
);
```

| payment_id | order_id (canonical SUB-*) | status | UID |
|---|---|---|---|
| e1238eac-e3fc-4ba2-a332-a167775a3707 | c11a518d-53d1-4c02-a304-12dc600cbade (SUB-26-MLQD06YA6MGY) | succeeded | 2071054f… |
| c5c7dcd0-1a3c-4c95-bdad-cebf879ccdfc | ea774d6c-e2ec-4d46-b47a-c556d0be0b4f (SUB-26-MO5IUQ6K1UHL) | succeeded | 97fb20f7… |

→ оба UID уже привязаны к каноническим SUB-* заказам, REBILL-* — дубликаты.

**Expected classification после патча:** `uid_collision_via_column.provider_payment_id` → `superseded`.

## Изменения

**Файл:** `supabase/functions/admin-repair-missing-payments/index.ts`

1. Добавлен helper `extractOrderUid(order)`:
   - сначала `extractUidFromMeta(order.meta)` (без изменений);
   - fallback: `order.provider_payment_id` если задано И `order.provider === 'bepaid'`;
   - source маркируется как `column.provider_payment_id` (для аудита в `superseded_reason`).
2. В SELECT добавлены колонки `provider`, `provider_payment_id`.
3. Step 2c заменён: теперь использует `extractOrderUid(order)` вместо `extractUidFromMeta(order.meta)`.
4. **Step 5 перестроен**: теперь обрабатывает ВСЕ orders с extractable UID (не только те, что без `uidByOrderId`). Если UID уже привязан к другому `order_id` в `payments_v2` — порядок помечается superseded. Это критично, потому что после Step 2c column-UID orders уже имеют запись в `uidByOrderId`, и без перестройки Step 5 они бы упали в "normal repair" с попыткой INSERT-collision.
5. `extractUidFromMeta` не тронут.

## Scope-guard

- `bepaid-webhook` — НЕ тронут.
- `grant-access-for-order` — НЕ тронут.
- `payments_v2` schema — НЕ тронут.
- write-path заказов — НЕ тронут.
- UI System Health — НЕ тронут (используется существующая кнопка).
- RLS / RPC / cron / миграции — НЕ тронуты.
- Column fallback ограничен `provider='bepaid'` → не схлопывает stripe/paddle/прочих.

## Regression tests (PASS)

`supabase/functions/admin-repair-missing-payments/extract-uid_test.ts` — 6 тестов:

| # | Тест | Результат |
|---|---|---|
| 1 | REBILL-2071054f-906 fixture: meta пустой, column заполнен → resolves via column | ✅ ok |
| 2 | REBILL-97fb20f7-f7c fixture: same pattern | ✅ ok |
| 3 | meta UID имеет приоритет над column | ✅ ok |
| 4 | provider='stripe' → column fallback DISALLOWED → null | ✅ ok |
| 5 | UID нет нигде → null | ✅ ok |
| 6 | короткая/мусорная column UID → null | ✅ ok |

```
ok | 6 passed | 0 failed (4ms)
```

## Deploy

✅ `admin-repair-missing-payments` deployed.

## Execute (ожидается от пользователя)

Edge-функция требует JWT с ролью admin/super_admin. У агента нет admin-сессии в превью.

**Действие пользователя:**
1. Открыть UI System Health.
2. Найти карточку INV-20 / «admin-repair-missing-payments».
3. Запустить в режиме `execute`, `since_days=30`.

## Verify (DoD) — выполнить после Execute

```sql
SELECT order_number,
       meta->>'superseded_by_repair' AS sup,
       meta->>'superseded_by_order' AS by_order,
       meta->>'superseded_reason' AS reason,
       meta->>'superseded_at' AS at
FROM orders_v2
WHERE order_number IN ('REBILL-2071054f-906','REBILL-97fb20f7-f7c');
```

Ожидание:
- обе строки `sup=true`;
- `by_order` = `c11a518d-53d1-4c02-a304-12dc600cbade` и `ea774d6c-e2ec-4d46-b47a-c556d0be0b4f` соответственно;
- `reason = 'uid_collision_via_column.provider_payment_id'`.

Дополнительно:
- ответ функции: `superseded ≥ 2`, `errors: []`;
- новых строк в `payments_v2` НЕ создано (репарация меняет только `orders_v2.meta`);
- повтор INV-20 sweep за 30д → 0 алертов;
- orphan bucket уменьшен ≥ на 2.

## STOP-guards (соблюдены)

- ✅ column fallback применяется только при `provider='bepaid'`;
- ✅ при совпадении UID с meta — приоритет у meta (тест #3);
- ✅ если matching payment принадлежит тому же `order_id` — collision не срабатывает (проверка `existP[0].order_id !== order.id`);
- ✅ если matching payment не найден — order идёт в обычный repair-path, не в orphan.
