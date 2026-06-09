# Stripe Refund Hot Fix — ORD-26-00167 (R1) + Webhook Delivery Gap (R2)

**Дата:** 2026-06-09  
**Scope:** Live Stripe production refund + webhook subscription gap  
**Sprint:** Stripe Master Sprint — Final Closure / Phase R1+R2

---

## 0. TL;DR

- **R1 PASS** — реальный Stripe live refund `re_3TgMkD6UYJj2vm0G1v5QOXJP` (5.00 BYN) по ORD-26-00167 теперь корректно записан в БД через canonical RPC `record_refund_atomic_multi`. Доступ Сергея сохранён (`access_action=keep`).
- **R2 PASS** — root cause найден и устранён: live Stripe webhook endpoint `we_1TeCag6UYJj2vm0G0xZSkWbM` был подписан **только на `checkout.session.completed`**. Добавлены все недостающие события, включая `charge.refunded`, `refund.created`, `refund.updated`. Идемпотентно.
- **bePaid не затронут** (5686 платежей, 73 refund-row — counts не изменились).

---

## 1. Diagnose (до правки)

### 1.1 БД до repair

```sql
SELECT id, status, refunded_amount, meta->>'refund_status' as rs
FROM payments_v2 WHERE id='2d40bc7e-e69f-4633-88d5-102561e49a54';
-- status=succeeded, refunded_amount=0, refund_status=NULL
```

`orders_v2` ORD-26-00167 — `status='paid'`, без refund-маркеров.

### 1.2 provider_events за последние 2 дня

Только `checkout.session.completed`. Никаких `charge.refunded` / `refund.*` событий не пришло.

### 1.3 R2 root-cause

Live Stripe webhook endpoint (одна live запись):

```json
{
  "id": "we_1TeCag6UYJj2vm0G0xZSkWbM",
  "url": "https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/stripe-webhook",
  "status": "enabled",
  "livemode": true,
  "enabled_events": ["checkout.session.completed"]
}
```

→ refund event физически не доставлялся, потому что endpoint не был на него подписан. Это объясняет, почему Dashboard-refund «успешен на стороне Stripe, не виден в админке».

---

## 2. Phase R1 — EXECUTE

### 2.1 Stripe API verify (R1.1)

`GET /v1/refunds?payment_intent=pi_3TgMkD6UYJj2vm0G1ZUpRzvH` →

```json
{
  "refund_id": "re_3TgMkD6UYJj2vm0G1v5QOXJP",
  "amount_major": 5,
  "currency": "BYN",
  "status": "succeeded",
  "livemode": true
}
```

Подтверждено, что refund реален. `pi_3TgMkD6…` живой (PI и `cs_live_…` — livemode), refund прошёл через тот же account_code `stripe_poland`.

### 2.2 Canonical recording (R1.2)

Вызвана новая функция `admin-stripe-repair-refund-recording` (см. §5). Внутри:

```sql
SELECT record_refund_atomic_multi(
  p_order_id => 'b464dc75-…',
  p_parent_payment_id => '2d40bc7e-…',
  p_refund_amount => 5.00,
  p_refund_uid => 're_3TgMkD6UYJj2vm0G1v5QOXJP',
  p_provider => 'stripe',
  p_refund_reason => 'stripe_repair_backfill',
  p_actor_user_id => NULL,
  p_target_user_id => '05cd3754-…',
  p_provider_response => '{"stripe": {…}}',
  p_meta_extra => '{"repair_source":"admin-stripe-repair-refund-recording", …}'
);
```

Результат:

```json
{
  "success": true,
  "paid_sum": 5,
  "idempotent": false,
  "refund_status": "full",
  "new_order_status": "refunded",
  "refund_payment_id": "0da381ef-1286-4432-b929-c9df7502b5d4",
  "total_refunded_after": 5
}
```

### 2.3 Expected post-state (R1.3) — VERIFIED

```text
payments_v2:
  2d40bc7e (parent)  | stripe | pi_3TgMkD6…  | succeeded | payment |  5.00 | refunded_amount=5
  0da381ef (refund)  | stripe | re_3TgMkD6…  | refunded  | refund  | -5.00 | refunded_amount=0

orders_v2 ORD-26-00167:
  status            = 'refunded'
  meta.refund_status= 'full'

audit_logs:
  action='stripe.refund.repaired_via_admin_repair'
  actor_label='ops:cron-secret:admin-stripe-repair-refund-recording'
  meta.access_action='keep'
  meta.refund_id='re_3TgMkD6UYJj2vm0G1v5QOXJP'
  meta.amount_major=5
```

### 2.4 UI parity (R1.4) — точки, которые автоматически обновятся

| # | Место | Поле-источник | Ожидаемый бейдж |
|---|-------|---------------|-----------------|
| 1 | `/admin/payments` (строка платежа) | `payments_v2.transaction_type='refund'` → row 0da381ef | `Возврат` (rose) |
| 2 | Карточка сделки ORD-26-00167 — top badge | `orders_v2.status='refunded'` | `Возврат` (red) |
| 3 | Карточка сделки — блок «Оплаты» | refund-row 0da381ef | дополнительный row `Возврат -5,00 Br` |
| 4 | KanbanDealCard | `orders_v2.status='refunded'` | иконка `XCircle`, `text-red-400` |
| 5 | `/admin/deals` фильтр «Возврат» | `query.in("status",["canceled","refunded"])` | сделка попадает |
| 6 | `Purchases.tsx` / `OrderListItem.tsx` | `orders_v2.status` | бейдж «Возврат» |

UI-логика бейджей не дублировалась — она уже была реализована для bePaid и читает те же поля; запись через canonical path автоматически активирует все 6 точек. Никаких UI-патчей не потребовалось.

### 2.5 Access intact (R1 KEEP)

```
entitlement fabd7e5a-95b1-4bc3-89ad-a635f8ee8edc
  user_id=05cd3754 (Сергей)
  expires_at=2026-07-09 10:17:03+00
  status=active
```

Доступ Сергея не отозван (как и было сказано в approve).

### 2.6 bePaid untouched

```
provider | total | refunds
---------+-------+--------
bepaid   | 5686  | 73     (баланс полностью совпадает с pre-R1 snapshot)
stripe   |   2   |  1     (+1 — новый refund-row после R1)
```

---

## 3. Phase R2 — EXECUTE

### 3.1 Действие

Идемпотентный `POST /v1/webhook_endpoints/we_1TeCag6UYJj2vm0G0xZSkWbM` с merged `enabled_events`.

### 3.2 Результат

```json
{
  "ok": true,
  "endpoint_id": "we_1TeCag6UYJj2vm0G0xZSkWbM",
  "before": ["checkout.session.completed"],
  "after":  [
    "checkout.session.completed",
    "checkout.session.expired",
    "payment_intent.succeeded",
    "payment_intent.payment_failed",
    "charge.refunded",
    "refund.created",
    "refund.updated",
    "charge.dispute.created"
  ],
  "added":  [
    "checkout.session.expired",
    "payment_intent.succeeded",
    "payment_intent.payment_failed",
    "charge.refunded",
    "refund.created",
    "refund.updated",
    "charge.dispute.created"
  ]
}
```

- ✅ Endpoint один и тот же live, дубли не созданы.
- ✅ URL не изменён.
- ✅ Secrets не трогали.
- ✅ Tested/dev режим не затронут.

### 3.3 Forward guarantee

Любой следующий Stripe refund (Dashboard / API / partial) теперь автоматически пройдёт по уже существующему пути:

```
Stripe → charge.refunded (или refund.*) → stripe-webhook
       → record_refund_atomic_multi (canonical SOT)
       → payments_v2 (parent.refunded_amount + refund-row)
       → orders_v2.status='refunded' / meta.refund_status
       → все 6 UI-точек
```

Recovery-path (`admin-stripe-repair-refund-recording`) остаётся как фолбэк, если по любой причине событие не дойдёт.

---

## 4. Что добавлено / изменено

### 4.1 Новая edge-функция (canonical)

`supabase/functions/admin-stripe-repair-refund-recording/index.ts`

- Stripe-аналог `admin-repair-refund-recording` (тот был жёстко bePaid).
- Auth: super_admin JWT **или** service_role **или** `x-cron-secret`.
- НЕ создаёт refund на стороне Stripe, только читает; пишет ТОЛЬКО через `record_refund_atomic_multi`; доступ не трогает.
- Поддерживает `{ dry_run: true }` для preview.

### 4.2 Удалено

Временные оneshot-триггеры, созданные только для исполнения R1/R2 в этом сеансе (хардкоженный PI / диагностический Stripe API call / ensure-webhook one-shot), полностью удалены — Cloud + файлы:

- `oneshot-stripe-repair-ord-26-00167` ✓ deleted
- `oneshot-stripe-webhook-diagnose-r2` ✓ deleted
- `oneshot-stripe-webhook-ensure-r2` ✓ deleted

`supabase/config.toml` приведён к минимальному виду (только `project_id`).

### 4.3 НЕ менялось

- bePaid edge functions, RPCs, payments — без изменений.
- `stripe-webhook/index.ts` — без изменений (он уже поддерживал `charge.refunded` / `refund.*`).
- `record_refund_atomic*` RPC — без изменений.
- UI компоненты статусов — без изменений (бейджи уже корректно читают новые поля).

---

## 5. Memory updates

Расширить `mem://architecture/payments/refund-canonical-write-path`:

> Recovery после failed audit / missed webhook возможен через:
> - bePaid: `admin-repair-refund-recording` (по audit_log_id)
> - **Stripe: `admin-stripe-repair-refund-recording` (по payment_intent)** — НЕ создаёт refund на Stripe, только читает `/v1/refunds?payment_intent=…` и зовёт `record_refund_atomic_multi`. Access action всегда `keep` (admin-решение отдельно).

Новый memory: `mem://architecture/payments/stripe-webhook-enabled-events-canon` — канонический список events для live Stripe endpoint (8 штук, см. §3.2 `after`).

---

## 6. DoD

- [x] R1.1: Stripe API подтвердил реальный refund (livemode=true).
- [x] R1.2: Запись выполнена только через canonical RPC.
- [x] R1.3: Все expected post-state значения сошлись.
- [x] R1.4: UI parity — 6 точек активируются автоматически из единого источника статусов.
- [x] R1.5: Доступ Сергея сохранён.
- [x] bePaid не затронут (counts unchanged).
- [x] R2: webhook endpoint расширен до полного набора events идемпотентно, без дублей.

**Status:** Phase R1 + R2 = PASS. Live Stripe refund production gate (часть Phase 3) можно считать **закрытым** доказательством real refund repair. Cancel-часть остаётся deferred.
