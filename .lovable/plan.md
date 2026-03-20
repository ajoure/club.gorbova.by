# План: ERIP bePaid — исправление потери платежей (финальная версия)

---

## 1. Сырые webhook payload для 1060232e (из payment_reconcile_queue)

### Webhook #1 — pending (20:44:24)

Источник: `payment_reconcile_queue.raw_payload` (id=43bc9428, status=materialized)

```json
{
  "transaction": {
    "uid": "1060232e-352c-42e2-93c2-bea7d9ae8fd3",
    "status": "pending",
    "type": "payment",
    "payment_method_type": "erip",
    "message": "Требование на оплату счета создано.",
    "amount": 10000,
    "currency": "BYN",
    "tracking_id": "link:order:bc5a8760-a211-499f-a496-50f361f0f14c",
    "payment": { "status": "pending" },
    "erip": {
      "account_number": "16617775",
      "service_no": "7846",
      "service_no_erip": "5342891"
    },
    "customer": { "email": "ghom1721@gmail.com" },
    "billing_address": { "first_name": "Алеся", "last_name": "Хомич" }
  }
}
```

### Webhook #2 — successful (20:46:23)

Сырой payload **отсутствует** в `payment_reconcile_queue`. Причина: queue insert (строка 1082) делает `SELECT ... WHERE bepaid_uid = uid` и находит existing row (строка 1090) → **reuse, не insert**. Т.е. очередь содержит только первый (pending) payload.

Однако webhook #2 **точно приходил** — доказательство из `webhook_events`:

```
id: c1c65e37-c2dc-49c8-ad43-6458bab3e5e1
created_at: 2026-03-19 20:46:23.702935+00
event_type: payment_link
outcome: already_processed
http_status: 200
transaction_uid: 1060232e-352c-42e2-93c2-bea7d9ae8fd3
```

### Точный flow в коде

1. **Строка 1082**: Queue insert/reuse (ОБА webhook'а проходят). Webhook #2 → reuse existing row.
2. **Строка 2646**: Idempotency guard по `payments_v2` (SELECT id, order_id, origin WHERE provider_payment_id = uid).
   - Webhook #1 (pending): existing payment **не найден** → проходит дальше → строка 2784 `!isLinkSuccessful` → пишет `status: 'failed'`.
   - Webhook #2 (successful): existing payment **найден** (записан webhook #1) → строка 2648: `existingLinkPayment.order_id === parsedOrderId` → **true** → строка 2675: `return already_processed`.

**Факт, а не гипотеза**: successful webhook заблокирован на строке 2675 idempotency guard'ом в `payments_v2`, а НЕ на уровне очереди.

### Поля для детекции ERIP

| Поле | Путь в webhook payload | Значение для ERIP |
|---|---|---|
| **payment_method_type** | `transaction.payment_method_type` | `"erip"` |
| **erip object** | `transaction.erip` | Присутствует (service_no, account_number) |

**Guard-условие (A+B для надёжности)**:
```typescript
const isErip = paymentMethod === 'erip' || !!transaction?.erip;
```

`paymentMethod` уже парсится на строке 1226:
```typescript
const paymentMethod = transaction?.payment_method_type || transaction?.payment_method || null;
```

---

## 2. Матрица статусов bePaid → наша модель

Источник: [docs.bepaid.by/ru/payment_methods/apms/erip/webhooks](https://docs.bepaid.by/ru/payment_methods/apms/erip/webhooks/) — ERIP отправляет уведомления при изменении статуса на `pending`, `expired`, `failed`, `successful`. Статусы `authorized`/`settled` **не применимы** к ERIP (это карточные статусы).

### ERIP (isErip = true)

| bePaid status | payments_v2.status | orders_v2.status | Сделка/доступ | Действие |
|---|---|---|---|---|
| `pending` | **processing** | **НЕ МЕНЯТЬ** | ❌ НЕТ | Сохранить запись, audit log |
| `successful` | **succeeded** | **paid** | ✅ ДА | Финализировать через общий success-path |
| `failed` | **failed** | **failed** | ❌ НЕТ | Как сейчас |
| `expired` | **failed** | **failed** | ❌ НЕТ | Как сейчас |

### Non-ERIP (card, apple_pay, google_pay и т.д.)

| bePaid status | Поведение | Изменения |
|---|---|---|
| `pending` | **failed** (как сейчас) | **НЕ МЕНЯЕТСЯ** |
| `successful`/`settled`/`authorized` | **succeeded** | НЕ МЕНЯЕТСЯ |
| `failed`/`expired` | **failed** | НЕ МЕНЯЕТСЯ |

**STOP-guard**: `pending` → `processing` **ТОЛЬКО** если `isErip === true`. По текущим данным non-ERIP pending = 0 строк в БД, но считаем возможным и защищаемся жёстким guard'ом.

---

## 3. Защита от регрессов

### FIX-A: ERIP pending → processing (строка ~2784)

```typescript
if (!isLinkSuccessful) {
  const isErip = paymentMethod === 'erip' || !!transaction?.erip;
  
  if (isErip && transactionStatus === 'pending') {
    // ERIP pending = нормальное промежуточное состояние
    // СТРОГО: НЕ создавать сделку, НЕ менять order, НЕ вызывать grant-access
    const eripPendingRow = {
      order_id: linkOrderV2.id,
      user_id: linkOrderV2.user_id || null,
      profile_id: linkOrderV2.profile_id || null,
      amount: failedAmount,
      currency: failedCurrency,
      status: 'processing',  // ← НЕ failed
      provider: 'bepaid',
      provider_payment_id: transactionUid,
      error_message: null,  // ← НЕ ошибка
      origin: 'bepaid',
      meta: {
        bepaid_status: transactionStatus,
        last_bepaid_status: transactionStatus,
        last_webhook_at: new Date().toISOString(),
        tracking_id: rawTrackingId,
        payment_method: 'erip',
        erip_pending: true,
      },
    };
    await upsertPaymentV2(supabase, eripPendingRow, '[WEBHOOK-LINK-ERIP-PENDING]');
    
    await supabase.from('audit_logs').insert({
      actor_type: 'system', actor_label: 'bepaid-webhook',
      action: 'bepaid.erip.pending_stored',
      meta: { order_id: linkOrderV2.id, transaction_uid: transactionUid },
    });
    
    await recordWebhookEvent(supabase, { ... outcome: 'erip_pending_stored' ... });
    return 200 "erip_pending_stored";
  }
  
  // else: non-ERIP или non-pending → текущее поведение (failed) — БЕЗ ИЗМЕНЕНИЙ
  // ... существующий код строк 2787-2859 ...
}
```

### STOP-guards (явные):

1. **isErip guard**: `pending` → `processing` **ТОЛЬКО** если `isErip === true`
2. **НЕ создавать сделку/доступ при pending**: ни `grant-access-for-order`, ни update order→paid
3. **НЕ менять order status**: остаётся `pending`
4. **Non-ERIP pending**: попадает в else → `status='failed'` (как сейчас)

---

## 4. Idempotency-upgrade (FIX-B)

### Текущий код (строка 2641):
```typescript
.select('id, order_id, origin')  // ← НЕТ status
```

### Изменение:
```typescript
.select('id, order_id, origin, status')
```

### Правила:

| existing.status | incoming bePaid status | Действие |
|---|---|---|
| `succeeded` | ANY | **DO-NOT-DOWNGRADE** → return `already_processed` |
| `failed` или `processing` | `successful` | **РАЗРЕШИТЬ** → продолжить success-path |
| `failed` или `processing` | `failed`/`expired` | **РАЗРЕШИТЬ** → обновить (idempotent) |
| `processing` | `pending` | return `already_processed` |

```typescript
if (existingLinkPayment) {
  if (existingLinkPayment.order_id === parsedOrderId) {
    // DO-NOT-DOWNGRADE: never overwrite succeeded
    if (existingLinkPayment.status === 'succeeded') {
      return already_processed;
    }
    // UPGRADE: allow failed/processing → succeeded
    if (['failed', 'processing'].includes(existingLinkPayment.status) && isLinkSuccessful) {
      // CONTINUE to success path — не return
      console.log('[WEBHOOK-LINK] UPGRADE:', existingLinkPayment.status, '→ succeeded');
    } else if (['failed', 'processing'].includes(existingLinkPayment.status) && !isLinkSuccessful) {
      // CONTINUE to !isLinkSuccessful branch для обновления
    } else {
      return already_processed;
    }
  }
}
```

### DoD idempotency:
- Повторный successful webhook для уже succeeded → `already_processed`, дублей нет, вторая сделка не создаётся
- Повторный pending для уже processing → `already_processed`

---

## 5. Хранение bePaid status и времени webhook

### Текущее состояние:
`payments_v2.meta->>'bepaid_status'` — записывается (строка 2820), но НЕ обновляется при повторных webhook'ах (idempotency guard блокирует).

### Обязательный патч:
При КАЖДОМ webhook (включая upgrade path) обновлять в meta:
- `last_bepaid_status` — перезаписывать всегда текущим `transactionStatus`
- `last_webhook_at` — ISO timestamp текущего webhook

Это обеспечивает:
1. Reconcile видит актуальный статус
2. Диагностика "застряло" — по разнице `last_webhook_at` и now()
3. История: `bepaid_status` = первый статус, `last_bepaid_status` = последний

---

## 6. Reconcile cron — авторизация и безопасность

### Текущая ситуация:
В проекте **нет** паттерна `X-Cron-Secret`. Все 134 cron job'а ходят с anon key.

### Требование:
`erip-reconcile-pending` должен быть защищён секретом:

1. Создать секрет `CRON_SECRET` через `add_secret`
2. Edge function проверяет header:
```typescript
const cronSecret = Deno.env.get('CRON_SECRET');
const incomingSecret = req.headers.get('x-cron-secret');
if (!cronSecret || incomingSecret !== cronSecret) {
  return new Response('Unauthorized', { status: 401 });
}
```
3. pg_cron job передаёт секрет в headers:
```sql
SELECT cron.schedule('erip-reconcile-pending', '*/5 * * * *', $$
  SELECT net.http_post(
    url := '...functions/v1/erip-reconcile-pending',
    headers := '{"Content-Type":"application/json","x-cron-secret":"<secret_value>"}'::jsonb,
    body := '{"source":"pg_cron"}'::jsonb
  ) AS request_id;
$$);
```

### Параметры reconcile:

| Параметр | Значение |
|---|---|
| Частота | */5 * * * * (каждые 5 мин) |
| Batch | 20 |
| Min age | 5 мин (не трогать свежие) |
| Max age | 48 часов |
| Дедупликация | по `provider_payment_id` |
| Dry-run | `body.execute !== true` |
| verify_jwt | false |
| Auth | X-Cron-Secret header |

---

## 7. Финализация через общий success-path

### Требование:
Финализация successful (и через webhook, и через reconcile) должна идти **тем же путём**, что обычный succeeded платёж — один "source of truth".

### Реализация:
- Webhook success-path (строки 2860-3100+) — уже существует, создаёт payment, обновляет order, вызывает `grant-access-for-order`
- FIX-B (idempotency upgrade) **разрешает** пройти в этот же success-path при `existing.status IN ('failed','processing') AND isLinkSuccessful`
- Reconcile edge function при обнаружении `successful` в bePaid API — обновляет `payments_v2.status` → `succeeded` и вызывает `grant-access-for-order` (тот же endpoint, `{ orderId: order_id }`)

### Guard:
`grant-access-for-order` уже идемпотентен по order_id — повторный вызов не создаёт дублей entitlements/subscriptions.

---

## 8. NEG-1: реальный негативный тест

### Реальные кейсы non-ERIP failed (карточные, не оплачены):

**Кейс NEG-1a**: `274c6d5d-9cae-45b7-9e13-9690b0fdc936`
```
payments_v2: id=e57596cf, status=failed, bepaid_status=failed
  error_message: "Нет разрешения. Обратитесь к провайдеру платежных услуг..."
  provider_payment_id: 75895bc4-0bdf-42c8-9ff2-99ad05a6fcf1
orders_v2: status=pending
entitlements: НЕТ (null)
subscriptions_v2: НЕТ (null)
→ Сделка/доступ НЕ выдан ✓
```

**Кейс NEG-1b**: `0abd4e2b-e9f6-4399-88ef-213b518d8701`
```
payments_v2: id=96e57009, status=failed, bepaid_status=failed
  error_message: "The transaction was declined due to security rules."
  provider_payment_id: 77caa3b4-849f-4a43-8056-a759752351f8
orders_v2: status=failed
entitlements: НЕТ (null)
subscriptions_v2: НЕТ (null)
→ Сделка/доступ НЕ выдан ✓
```

### DoD NEG-1:
После патча оба кейса:
- order status НЕ меняется
- payment status НЕ меняется
- entitlements НЕ создаются
- Потому что `isErip === false` → попадают в else ветку → `status='failed'` (как сейчас)

Дополнительно: в коде FIX-A **жёсткий guard** `if (isErip && transactionStatus === 'pending')` — non-ERIP pending физически не может попасть в processing-ветку.

---

## 9. DoD — конкретные проверяемые критерии

### Для 1060232e-352c-42e2-93c2-bea7d9ae8fd3:

**До фикса (текущее):**
```
payments_v2: status=failed, meta.bepaid_status=pending, error_message="Требование на оплату счета создано."
orders_v2:   status=pending (id=bc5a8760)
entitlements: НЕТ
subscriptions_v2: НЕТ
```

**После фикса:**
```
payments_v2: status=succeeded, paid_at заполнен, meta.last_bepaid_status=successful
orders_v2:   status=paid, paid_amount=100
grant-access-for-order: вызван с orderId=bc5a8760
audit_logs: bepaid.erip.manual_reconcile / bepaid.erip.finalized
```

### Идемпотентность:
- Повторный reconcile для 1060232e → `already_processed` (status уже succeeded, DO-NOT-DOWNGRADE)
- Повторный successful webhook → idempotency guard: `existingLinkPayment.status === 'succeeded'` → `already_processed`
- Вторая сделка/доступ НЕ создаётся (`grant-access-for-order` идемпотентен по order_id)

### NEG-1:
- Кейсы 274c6d5d и 0abd4e2b: order/payment/entitlements НЕ меняются
- non-ERIP pending (если гипотетически придёт) → `isErip === false` → `status='failed'`

---

## 10. Порядок выполнения

### Фаза 1 (блокер): FIX-A + FIX-B + meta fields
| # | Файл | Действие |
|---|---|---|
| 1 | `supabase/functions/bepaid-webhook/index.ts` | Строка 2641: добавить `status` в SELECT |
| 2 | `supabase/functions/bepaid-webhook/index.ts` | Строки 2646-2678: upgrade guard (DO-NOT-DOWNGRADE + allow upgrade) |
| 3 | `supabase/functions/bepaid-webhook/index.ts` | Строка 2784: ERIP pending → processing ветка (FIX-A) |
| 4 | `supabase/functions/bepaid-webhook/index.ts` | Success-path: добавить `last_bepaid_status`, `last_webhook_at` в meta |

### Фаза 2: Reconcile + ручная починка 1060232e
| # | Файл | Действие |
|---|---|---|
| 5 | `supabase/functions/erip-reconcile-pending/index.ts` | Создать: поллинг bePaid API + X-Cron-Secret auth |
| 6 | `supabase/functions.registry.txt` | Добавить erip-reconcile-pending |
| 7 | pg_cron job | Добавить `erip-reconcile-pending` каждые 5 мин с секретом |
| 8 | Ручной вызов reconcile | dry-run → execute для 1060232e |

### Фаза 3 (после DoD-Case): UI-виджет
| # | Файл | Действие |
|---|---|---|
| 9 | `src/components/admin/diagnostics/EripStuckPaymentsWidget.tsx` | Создать: UI мониторинг |
| 10 | `src/components/admin/payments/DiagnosticsTabContent.tsx` | Добавить виджет |

---

## 11. VERIFY checklist

| # | Проверка | Ожидание |
|---|---|---|
| V1 | 1060232e: payments_v2.status | succeeded |
| V2 | 1060232e: orders_v2.status | paid |
| V3 | 1060232e: grant-access вызван | entitlement/subscription создана |
| V4 | ERIP pending webhook → payments_v2.status | processing (не failed) |
| V5 | Non-ERIP pending → payments_v2.status | failed (как сейчас) |
| V6 | Повторный successful webhook → результат | already_processed, дублей нет |
| V7 | Повторный reconcile → результат | already_processed, вторая сделка не создаётся |
| V8 | NEG-1a (274c6d5d): entitlements | НЕТ |
| V9 | NEG-1b (0abd4e2b): entitlements | НЕТ |
| V10 | Reconcile cron: auth | X-Cron-Secret, не anon key |
