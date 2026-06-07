# Discovery: Stripe Public Payment Links Lifecycle v1

Дата: 2026-06-07
Фаза: Phase 4.2 — Public Link Lifecycle Integrity
Тип: read-only discovery (без правок кода / миграций / runtime записи)

## 1.1 Карта lifecycle write-path'ей (колонки `payment_links`)

| Колонка | Writer | Условие |
|---|---|---|
| `current_uses` | `_shared/consume-payment-link.ts` → `consumePaymentLinkForOrder()` | вызывается ТОЛЬКО из `bepaid-webhook/index.ts:2438` (link-order) и `:4170` (link). Idempotency: `orders_v2.meta.payment_link_counted=true`. |
| `current_uses` (Stripe) | **НЕТ writer'а** | `stripe-webhook/index.ts` — 0 упоминаний `consume` / `payment_link_id` (grep подтверждён). Структурный гэп. |
| `status` | `admin-invalidate-payment-link` | super_admin, ставит `invalidated`. |
| `status`, `max_uses`, `expires_at`, `amount`, `description` | `admin-update-payment-link` | super_admin, штатный writer для всех редактируемых полей. |
| `provider`, `account_code`, `currency`, `payment_type`, прочие inserts | `admin-create-public-link` | canonical writer (Phase 4.1). |

**Ключевой gap:** `stripe-webhook` НЕ импортирует `consumePaymentLinkForOrder` и НЕ читает `payment_link_id` из metadata Stripe Session. После успешной Stripe-оплаты по public link `payment_links.current_uses` остаётся прежним.

Подтверждение:
```
$ rg -n "consume|payment_link" supabase/functions/stripe-webhook/index.ts
(empty)
```

## 1.2 Карта read/enforce-путей

### `public-checkout/index.ts`

GET (`public-checkout?token=...`) выполняет ТРИ проверки (lines 49–59):
1. `link.status !== 'active'` → 410 `Payment link is no longer active`.
2. `link.expires_at && new Date(link.expires_at) < new Date()` → 410 `Payment link has expired`.
3. `link.max_uses && link.current_uses >= link.max_uses` → 410 `Payment link usage limit reached`.

POST (`/pay/:token` start checkout) дублирует те же три проверки (lines 114–124) ДО разрешения `userId` и ДО вызова `createPaymentCheckout`.

**Provider-agnostic:** enforcement выполняется ДО `params.provider === 'stripe'` early-dispatch в `_shared/create-payment-checkout.ts`. Структурно G62/G63/G64 одинаково блокируют и bePaid, и Stripe.

### `_shared/create-payment-checkout.ts` — Stripe-ветка
Не выполняет независимых lifecycle-проверок (status/expires/uses). Только провайдерская маршрутизация. Lifecycle-гарды переиспользуются из `public-checkout`.

### `payment_links_enriched_v` (view)
Derived флаги: `is_expired`, `is_exhausted`, `is_invalid` — корректно учитывают `provider` независимо. `paid_orders_count` / `related_orders_count` / `last_order_id` собираются через `LATERAL JOIN orders_v2 WHERE meta->>'payment_link_id' = pl.id::text` (provider-agnostic, без зависимости от колонки).

## 1.3 Metadata linkage

| Direction | bePaid | Stripe |
|---|---|---|
| `payment_links.id → orders_v2.meta.payment_link_id` (create) | ✅ `_shared/create-payment-checkout.ts:135` (`extraMeta.payment_link_id`) | ✅ `_shared/create-stripe-checkout.ts:308, 514` (через тот же `extraMeta`) |
| `payment_links.id → Stripe Session metadata` | n/a | ✅ `create-stripe-checkout.ts:205` (one_time), `stripe-pre-create-subscription.ts:267-268` (subscription, в `metadata` + `subscription_data.metadata`) |
| `payment_links.id → subscriptions_v2.meta` (create) | ✅ pre-create | ✅ `stripe-pre-create-subscription.ts:337` (pending sub) |
| Stripe Session metadata → orders_v2 (webhook materialize) | n/a | ❌ `stripe-webhook` НЕ читает `metadata.payment_link_id` при insert order'а от `invoice.paid` / `checkout.session.completed`. |
| Webhook → `consume-payment-link` (terminal=paid) | ✅ `bepaid-webhook:2438, 4170` | ❌ отсутствует |

`orders_v2.payment_link_id` отдельной колонки НЕТ — linkage хранится только в `meta`.

## 1.4 Baseline / orphan-чек (БД-снимки на 2026-06-07)

### Распределение `payment_links` по провайдеру
```
provider | count
---------+------
bepaid   |   114
stripe   |     5
```

### Stripe `payment_links` — детальное состояние
| id (short) | status | current_uses | related_orders | paid_orders | примечание |
|---|---|---|---|---|---|
| 3ecffb2d | active | 0 | 1 | 0 | smoke 4.1.1, pending order не дошёл до paid |
| 38e2ed4c | active | 0 | 0 | 0 | дубль smoke без POST start |
| b19c1fec | invalidated | 0 | 0 | 0 | админ-инвалидация |
| 73c003be | invalidated | 0 | 0 | 0 | админ-инвалидация |
| b3b9886f | invalidated | 0 | 1 | 0 | smoke 4.1, pending order не дошёл до paid |

Все Stripe-заказы из admin sandbox direct path (`orders_v2 WHERE meta->>'provider'='stripe'` — 5 строк) — БЕЗ `meta.payment_link_id` (как и должно быть для admin sandbox).

Все Stripe-заказы из public-link path (2 строки: 2219d2cc, 9f4979b3) — `meta.payment_link_id` корректно записан, но обе строки `status='pending'` (оплата картой не была завершена в smoke-сценариях 4.1/4.1.1).

### Orphan-запросы
- `payment_links` со `current_uses=0 AND paid_orders_count > 0`: **0** строк по обоим провайдерам сейчас (нет оплаченных public-link заказов через Stripe в истории).
- `payment_links` с `status='active' AND paid_orders_count > current_uses`: **0** (нет данных для проявления гэпа).
- Структурный orphan-предсказание: при первой реальной Stripe-оплате `paid_orders_count` станет 1, а `current_uses` останется 0 → автоматический orphan по факту.

## Выводы для Phase 4.2

| Утверждение | Доказательство |
|---|---|
| Stripe-webhook НЕ инкрементирует `payment_links.current_uses` | `grep "consume\|payment_link" stripe-webhook/index.ts` → empty |
| Pre-checkout гарды (status/expires/max_uses) одинаковы для обоих провайдеров | `public-checkout` GET+POST блоки 49-59 и 114-124, выполняются ДО early-dispatch |
| `payment_link_id` корректно проброшен в Stripe metadata при create | `create-stripe-checkout.ts:205`, `stripe-pre-create-subscription.ts:267-268` |
| `payment_link_id` НЕ потребляется stripe-webhook при terminal paid | то же отсутствие импорта и чтения |
| Admin lifecycle writes (`invalidate`, `update`) — provider-agnostic | оба edge-function пишут только в `payment_links`, без provider-логики |

Backlog для Phase 4.3 (write fix, НЕ в scope 4.2):
1. В `stripe-webhook` на terminal `checkout.session.completed` (one_time) и `invoice.paid` (subscription, первый цикл) — извлечь `metadata.payment_link_id`, найти/создать соответствующий `orders_v2` с этим `meta.payment_link_id`, после материализации заказа вызвать `consumePaymentLinkForOrder(supabase, order.id, 'stripe-webhook[link]')`.
2. Гарантировать, что `orders_v2.meta.payment_link_id` присутствует на материализуемом stripe-webhook заказе (сейчас этого insert-path в webhook'е не существует для public-link заказов; pending order создаётся public-checkout'ом, webhook должен его update'нуть, а не создавать дубль).
