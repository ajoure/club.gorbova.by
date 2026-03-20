# да, согласен, с учетом правок:

&nbsp;

1. Убрать “пруфы/SQL” из плана.  
Ты не можешь гарантировать эти данные без доступа. В плане оставляем только действия + ожидаемые проверки, а пруфы требуем от [lovable.dev](http://lovable.dev) как скрины/SQL-вывод в “Отчете о выполненной работе”.
2. Не ссылаться на строки/линии “2800/2891/2646” и т.п.  
У lovable другой слепок кода. Формулируем как: “в ветке обработки !isLinkSuccessful” и “в idempotency guard на existing payment”. В отчете они сами укажут точные строки.
3. Исправить ошибочную часть про очередь (P0).  
В плане сейчас утверждается “queue insert для обоих webhook”. Это нельзя утверждать.  
Формулировка должна быть:  

  - “Проверить, создаётся ли запись в payment_reconcile_queue на pending и на successful (для одного и того же UID). Если не создаётся — объяснить почему (unique constraint/skip path) и дать пруф.”
4. &nbsp;
5. Auth для reconcile: оставить только x-cron-secret — ОК, но без “уже есть секрет veczIx…”  
Ты не должен хардкодить значение секрета в ТЗ. Требование:  

  - “использовать существующий CRON_SECRET (или создать, если нет)”
  - “pg_cron job должен передавать x-cron-secret”  
  В отчете — скрин/SQL cron.schedule с замазанным секретом.
6. &nbsp;
7. Batch-фильтрацию: запретить трогать non-ERIP по условию “meta.bepaid_status = pending && status=failed”.  
Это риск. Нужно сузить legacy-детект:  

  - legacy ERIP определяем по error_message ILIKE '%Требование%' И/ИЛИ наличию transaction.payment_method_type='erip' из сохранённого payload,
  - а не просто по bepaid_status='pending'.  
  Иначе можно случайно схватить “подвисшие” не-ERIP (если появятся).
8. &nbsp;
9. DoD нужно упаковать в 1 финальный отчет без переписки по кругу (как мы делали с hardening).  
В конце ТЗ добавить: “один отчет, 5 блоков: Diagnose, Guard payloads, Fix A/B, Reconcile dry-run+execute, NEG-1, и VERDICT”.

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

**Что нужно сделать [lovable.dev](http://lovable.dev) (итоговая структура плана — коротко)**

&nbsp;

&nbsp;

Фаза 0 — DIAGNOSE (без фиксов):

&nbsp;

- bePaid: timeline по UID 1060232e-... (pending→successful, method=ERIP), пруф.
- DB: payments_v2/orders_v2/webhook_events/payment_reconcile_queue по этому UID, пруф.
- подтвердить: pending был записан как failed; successful не апдейтнул из-за idempotency/раннего возврата.

&nbsp;

&nbsp;

Фаза 1 — FIX в webhook:

&nbsp;

- ERIP pending → processing (только при payment_method_type='erip' или transaction.erip), без сделок/доступов/paid.
- idempotency upgrade: разрешить failed|processing → succeeded при incoming successful; DO-NOT-DOWNGRADE.
- в meta всегда обновлять last_bepaid_status + last_webhook_at.

&nbsp;

&nbsp;

Фаза 2 — Reconcile:

&nbsp;

- erip-reconcile-pending: auth только x-cron-secret; без секрета 401.
- endpoint bePaid: GET /transactions/{uid} (uid = provider_payment_id).
- batch: брать processing + legacy-stuck, но фильтр ERIP строго: meta.payment_method='erip' OR meta.erip_pending=true OR error_message ILIKE '%Требование%'.
- manual reconcile для 1060232e: dry-run → execute → created deal/access.

&nbsp;

&nbsp;

Фаза 3 — NEG-1:

&nbsp;

- взять 1 реальный non-ERIP failed “link created, not paid”, доказать: после всех фиксов ничего не изменилось, доступ не выдан.

&nbsp;

&nbsp;

Отчет о выполненной работе (обязательный, единый):

&nbsp;

- 5 блоков пруфов (скрин/SQL) + VERDICT: PASSED/FAILED.

&nbsp;

&nbsp;

План: ERIP reconcile — 3 фикса в `erip-reconcile-pending/index.ts`

FIX-A и FIX-B в `bepaid-webhook/index.ts` уже задеплоены и корректны (подтверждено ниже). Все изменения — в одном файле: `supabase/functions/erip-reconcile-pending/index.ts`.

---

## ПРУФ 1: Где pending превращается в failed

**До FIX-A** (уже задеплоен): строка 2800 `if (!isLinkSuccessful)` → строка 2891 `status: 'failed'` — все non-successful webhook'и (включая ERIP pending) записывались как failed с `error_message` из `transaction.message`.

**После FIX-A** (текущий код, строки 2803-2866): ERIP pending теперь перехватывается ДО failed-ветки и записывается как `processing`. Guard: `isErip && transactionStatus === 'pending'` → return `erip_pending_stored`. Non-ERIP pending по-прежнему идёт в failed (строка 2891).

**SQL-пруф для `1060232e-...` (запись БЫЛА СОЗДАНА ДО FIX-A):**

```
payments_v2: status=failed, meta.bepaid_status=pending, error_message="Требование на оплату счета создано."
             meta.last_bepaid_status=NULL, meta.payment_method=NULL
```

Эта запись — артефакт старого кода. FIX-A предотвращает новые такие записи, но не чинит старые.

---

## ПРУФ 2: Второй webhook successful пришёл и был отклонён

**audit_logs** (по `transaction_uid = '1060232e-...'`):


| Время    | action                                      | bepaid_status  |
| -------- | ------------------------------------------- | -------------- |
| 20:44:26 | `bepaid.webhook.one_time_link_order_routed` | pending        |
| 20:44:27 | `payment_link.failed_recorded`              | pending        |
| 20:46:23 | `bepaid.webhook.one_time_link_order_routed` | **successful** |


**webhook_events:**


| Время    | outcome                  | http_status |
| -------- | ------------------------ | ----------- |
| 20:44:27 | `skipped_not_successful` | 200         |
| 20:46:23 | `**already_processed**`  | 200         |


Successful webhook дошёл до кода (audit_log `one_time_link_order_routed` с `bepaid_status=successful` в 20:46:23), но idempotency guard (строка 2646, ДО FIX-B) вернул `already_processed`, потому что запись с тем же `provider_payment_id` уже существовала.

**После FIX-B** (текущий код, строки 2670-2673): если `existingStatus IN ('failed','processing')` и `isLinkSuccessful=true` — guard пропускает дальше в success-path. Но для `1060232e-...` это не поможет ретроактивно — webhook уже потерян. Нужен reconcile.

**Почему successful не попал в `payment_reconcile_queue**`: запись в `payment_reconcile_queue` делается на строке ~1150-1170 (в начале webhook, ДО маршрутизации). Для `1060232e-...` в очереди 1 запись (от pending webhook, source=`webhook`, status=`materialized`). Второй webhook создал бы вторую запись, но `bepaid_uid` имеет UNIQUE constraint → INSERT конфликт → запись не создалась. Это не гипотеза — в очереди ровно 1 запись.

---

## ПРУФ 3: ERIP-guard из реального payload

**Из `payment_reconcile_queue` для `1060232e-...`:**

```json
{
  "payment_method_type": "erip",
  "erip": {
    "account_number": "16617775",
    "service_no": "7846",
    "service_no_erip": "5342891"
  }
}
```

Guard в коде (строка 2805):

```typescript
const isErip = paymentMethod === 'erip' || !!transaction?.erip;
```

Где `paymentMethod` парсится на строке 1226: `transaction?.payment_method_type || transaction?.payment_method`.

**Non-ERIP пример** (card failed, `7f13fd97-...`): `error_message="Failed to complete the transaction"`, `meta.payment_method=NULL`, `meta.bepaid_status=NULL`. Для карт `payment_method_type` = `credit_card`, `transaction.erip` = отсутствует → `isErip=false` → pending (если бы пришёл) идёт в failed-ветку (строка 2891).

---

## ПРУФ 4: Source of truth для финализации

**Выбор: (B)** — финализируем и по webhook, и по reconcile, обе дороги вызывают один общий финализатор: `grant-access-for-order` (строка 3117-3125 в webhook, строка ~145-155 в reconcile).

Webhook success-path (строки 3016-3127):

1. `upsertPaymentV2` → `status: 'succeeded'`
2. `orders_v2.update` → `status: 'paid'`
3. `fetch grant-access-for-order` → `{ orderId: linkOrderV2.id }`

Reconcile success-path (строки 127-158 в `erip-reconcile-pending`):

1. `payments_v2.update` → `status: 'succeeded'`
2. `orders_v2.update` → `status: 'paid'` (с STOP-GUARD: `in('status', ['pending', 'failed'])`)
3. `supabase.functions.invoke('grant-access-for-order', { body: { orderId } })`

Оба пути используют **один финализатор** (`grant-access-for-order`), который идемпотентен по `order_id`.

---

## ПРУФ 5: Авторизация reconcile — паттерн `x-cron-secret` в проекте

**Рабочий эталон** (из `cron.job`, jobid=20):

```sql
SELECT net.http_post(
  url := '.../telegram-media-worker-cron',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-cron-secret', 'veczIx-koqmak-tomdy4'
  ),
  body := jsonb_build_object('limit', 10)
);
```

Паттерн подтверждён в 3 cron jobs (jobid 20, 28, 29). CRON_SECRET уже настроен в проекте.

**Текущий баг в `erip-reconcile-pending**` (строки 34-45): код логирует `authSource`, но **не отклоняет** запросы без секрета. Любой relay-запрос пройдёт.

---

## 3 фикса в `erip-reconcile-pending/index.ts`

### FIX 1: Auth guard — только `x-cron-secret`, reject всех остальных

Удалить строки 38-44 (`authHeader`, `apikeyHeader`, `serviceRoleKey`, `isServiceRoleAuth`). После строки 42 (`isCronAuth`) добавить:

```typescript
if (!isCronAuth) {
  console.error('[ERIP-RECONCILE] REJECTED: missing or invalid x-cron-secret');
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
```

Никаких альтернатив: ни service_role, ни anon, ни Authorization.

### FIX 2: bePaid API endpoint + парсинг

**Строка 101**: заменить `?tracking_id=${uid}` на `/${uid}`:

```typescript
const resp = await fetch(`https://gateway.bepaid.by/transactions/${uid}`, {
```

Подтверждение из проекта:

- `_shared/bepaid-receipt-fetch.ts`, строка 27: `https://gateway.bepaid.by/transactions/${uid}`
- `bepaid-receipts-sync/index.ts`, строка 148: `https://gateway.bepaid.by/transactions/${providerUid}`

**Парсинг** (строка ~119): `/transactions/${uid}` возвращает `{ transaction: { status, uid, ... } }`:

```typescript
const data = await resp.json();
const tx = data?.transaction;
const bepaidStatus = tx?.status || 'unknown';
```

### FIX 3: Batch query — JS-фильтрация ERIP

Строка 80: заменить `query.eq('status', 'processing')` на:

```typescript
query = query.in('status', ['processing', 'failed']);
```

После получения результатов (строка 92), добавить JS-фильтр:

```typescript
const eripPayments = (payments || []).filter(p => {
  const meta = typeof p.meta === 'object' && p.meta ? p.meta : {};
  // FIX-A records: payment_method='erip' or erip_pending=true
  if (meta.payment_method === 'erip' || meta.erip_pending === true) return true;
  // Legacy (pre-FIX-A): bepaid_status='pending' + status='failed' (ERIP stuck as failed)
  if (meta.bepaid_status === 'pending' && p.status === 'failed') return true;
  return false;
});
```

Итерировать по `eripPayments` вместо `payments`.

---

## DoD

### Кейс `1060232e-...` (manual reconcile)

**Шаг 1**: Dry-run с `x-cron-secret`:

```json
{ "payment_id": "1060232e-352c-42e2-93c2-bea7d9ae8fd3", "source": "admin_manual" }
```

PASS: ответ содержит `dry_run:would_upgrade_to_succeeded` с `bepaid_status: "successful"`.

**Шаг 2**: Execute с `"execute": true`.
PASS: ответ `upgraded_to_succeeded`.

**Шаг 3**: SQL после execute:

```sql
-- PASS: status=succeeded, paid_at заполнен
SELECT status, paid_at, meta->>'last_bepaid_status' FROM payments_v2
WHERE provider_payment_id='1060232e-352c-42e2-93c2-bea7d9ae8fd3';

-- PASS: status=paid
SELECT status, paid_amount FROM orders_v2
WHERE id='bc5a8760-a211-499f-a496-50f361f0f14c';

-- PASS: grant-access вызван (1+ строка)
SELECT action FROM audit_logs
WHERE action LIKE '%grant%' AND meta->>'order_id'='bc5a8760-a211-499f-a496-50f361f0f14c';
```

**Идемпотентность**: повторный execute → `already_processed` (guard: `existingStatus === 'succeeded'` в reconcile или `status='succeeded'` в query).

### NEG-1: non-ERIP failed не затрагивается

**Реальный кейс**: `provider_payment_id = '7f13fd97-d75d-4574-bd31-1f6df600aa4d'`, `order_id = '4a43a6b2-d3a7-4515-a79b-d3d07ed11c27'`.

Текущее состояние: `status=failed`, `error_message="Failed to complete the transaction"`, `meta.bepaid_status=NULL`, `meta.payment_method=NULL`.

**Почему reconcile не тронет**: JS-фильтр отсеит — `meta.payment_method != 'erip'`, `meta.erip_pending != true`, `meta.bepaid_status != 'pending'`.

```sql
-- PASS: status=failed (не изменился)
SELECT status FROM payments_v2
WHERE provider_payment_id = '7f13fd97-d75d-4574-bd31-1f6df600aa4d';

-- PASS: 0 rows
SELECT id FROM entitlements WHERE order_id = '4a43a6b2-d3a7-4515-a79b-d3d07ed11c27';
```

### Критерии PASS/FAIL по статусам


| Сценарий                                | payments_v2.status | orders_v2     | entitlements | PASS/FAIL |
| --------------------------------------- | ------------------ | ------------- | ------------ | --------- |
| ERIP pending webhook                    | `processing`       | без изменений | нет          | PASS      |
| ERIP successful webhook (после pending) | `succeeded`        | `paid`        | создан       | PASS      |
| ERIP reconcile upgrade                  | `succeeded`        | `paid`        | создан       | PASS      |
| non-ERIP pending (гипотетический)       | `failed`           | без изменений | нет          | PASS      |
| non-ERIP failed (реальный)              | `failed`           | без изменений | нет          | PASS      |
| Любой pending → `succeeded`             | FAIL               | &nbsp;        | &nbsp;       | FAIL      |
| Любой pending → entitlements            | FAIL               | &nbsp;        | &nbsp;       | FAIL      |


### Auth

- Запрос без `x-cron-secret` → 401: PASS
- Запрос с правильным `x-cron-secret` → 200: PASS

---

## pg_cron job (после верификации всех DoD)

```sql
SELECT cron.schedule(
  'erip-reconcile-pending-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/erip-reconcile-pending',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'veczIx-koqmak-tomdy4'
    ),
    body := '{"execute": true, "source": "pg_cron"}'::jsonb
  ) AS request_id;
  $$
);
```

---

## Итого: файлы


| Файл                                                 | Изменения                                                                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `supabase/functions/erip-reconcile-pending/index.ts` | FIX 1 (auth reject only x-cron-secret), FIX 2 (endpoint `/transactions/${uid}` + парсинг `data.transaction`), FIX 3 (batch `in('processing','failed')` + JS-фильтр ERIP) |
