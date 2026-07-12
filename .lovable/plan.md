# Sprint C2 — CLOSED

## Итоговый статус

```
Sprint C2 Stage B: VERIFIED, PASS
Sprint C2 Stage C: VERIFIED, PASS
Sprint C2 Stage D: VERIFIED, PASS
Sprint C2 Stage E: VERIFIED, PASS
Sprint C2 Stage F: VERIFIED, PASS
Sprint C2 overall: VERIFIED, PASS — CLOSED
```

## Что подтверждено runtime

- атомарное создание RR-заказа со snapshot и CRM-стадией (Stage E.1 v3, 15-arg RPC, service_role only);
- positive и negative crm_routing_snapshot;
- успешная оплата, `payments_v2` строка и независимый `entitlement_source` на каждый заказ;
- повторные заявки с разными applicant-данными без перезаписи профиля владельца;
- commission enrichment из `rr.getOrderStatus`;
- CRM success stage и manual-override guard (`crm_stage_apply_skipped_manual_override`);
- terminal failed через каноническую локальную финализацию (`rr_finalize_order_rejected`);
- реальный browser-flow общей кнопки (public-rr-installment-initiate) на non-CB продукте;
- email и Telegram доставки покупателю;
- повторная обработка webhook без дублей платежей, sources, deliveries;
- отсутствие hardcode продукта, тарифа, цены и срока доступа.

## Оговорка формулировки

```
Terminal failed: canonical runtime proof PASS.
Provider-driven not_created response в RR test-mode не воспроизведён;
reconciler safe-no-op подтверждён, локальная terminal-финализация,
CRM failed stage и повторный no-op подтверждены.
```

Реальный REJECTED/CANCELLED/EXPIRED от РР — неблокирующее production observation, вне рамок Sprint C2.

## Ключевые артефакты

- Миграция `rr_get_or_create_pending_order` (15 arg, атомарный INSERT snapshot+pipeline).
- `supabase/functions/public-rr-installment-initiate` — snapshot вычисляется до INSERT, post-insert CAS удалён.
- `supabase/functions/rr-webhook` и `rr-reconcile-order` — canonical `applyCrmStageOnTerminal` через `resolveOfferRoutingWithFallback`.

---

# Follow-ups (не запускать без отдельного approval)

## FU-1. Cleanup тестовых данных Sprint C2 — блокирован, требуется revised решение

### Блокеры первого dry-run

1. **Test product/tariff/offer нельзя удалять** — ранее зафиксировано «оставить деактивированными». Кроме того, вариант B после cleanup предполагал реактивацию того же offer для smoke, что после DELETE невозможно.
2. **`subscriptions_v2` count = 1 — stop-condition** для one-off `bank_installment`. Ожидалось 0. Требуется diagnose до любого удаления. Полная строка + причина появления зафиксированы в FU-2.
3. **Нельзя удалить `products_v2`, оставив исторический `entitlements`-агрегат** — агрегат ссылается на product_id. Definitions должны остаться.
4. **FK-зависимости `orders_v2`** проверены (см. ниже) — блокирующих NO ACTION без 0 нет; SET NULL на `access_grant_ledger.order_id` и `access_grant_ledger.source_order_id` допустим (audit history сохраняется).

### FK на orders_v2 (проверено)

| Referencing table | Column | Delete rule | Rows на target orders |
|---|---|---|---|
| access_grant_ledger | order_id, source_order_id | SET NULL | 4 (audit, сохранить) |
| crm_tasks | order_id, deal_id | SET NULL | 0 |
| entitlements | order_id | SET NULL | 1 (агрегат, пересчёт) |
| generated_documents | order_id | CASCADE | 0 |
| installment_payments | order_id | CASCADE | 0 |
| order_notification_deliveries | order_id | CASCADE | 8 |
| payment_reconcile_queue | matched_order_id / processed_order_id | SET NULL / NO ACTION | 0 / 0 |
| payments_v2 | order_id | CASCADE | 5 |
| provider_subscriptions | order_id | SET NULL | 0 |
| site_form_submissions | order_id | NO ACTION | 0 |
| statement_lines | order_id | NO ACTION | 0 |
| **subscriptions_v2** | **order_id** | **NO ACTION** | **1 — блокер до diagnose** |

Ни одна NO ACTION-таблица не удерживает удаление, кроме `subscriptions_v2` (1 строка). Пока FU-2 не закрыт, `orders_v2` удалять нельзя.

### Revised allowlist для будущего cleanup

**Удалять (после FU-2):**

```
payments_v2                   (по order_id, CASCADE)
entitlement_sources           (по order_id)
provider_events               (по related_order_id)
order_notification_deliveries (по order_id, CASCADE)
telegram_messages             (по meta.source_order_id / meta.order_id)
subscriptions_v2              — ТОЛЬКО подтверждённая тестовая, только после diagnose
orders_v2                     (последним)
```

Затем `recalculate_entitlement_aggregate(user_id, product_id, tariff_id)` для восстановления агрегата entitlement.

**Не удалять:**

```
products_v2         (тестовый оставить inactive)
tariffs             (тестовый оставить inactive)
tariff_offers       (тестовый оставить inactive)
access_grant_ledger (immutable audit; FK SET NULL сохранит строки без ссылки)
audit_logs
profiles            (новых applicant-профилей не создавалось; проверено)
rr_test_ledger      (external_id ∉ target orders → 0 совпадений; не трогаем)
```

### Ожидаемое состояние после cleanup

```
count(orders_v2 WHERE product_id=test)                = 0
count(payments_v2 WHERE order_id IN target)           = 0
count(entitlement_sources WHERE order_id IN target)   = 0
count(subscriptions_v2 WHERE product_id=test)         = 0  (после FU-2)
count(entitlements WHERE product_id=test)             = 1 (aggregate; recalculated → status='inactive'/expires, детали в FU-3)
access_grant_ledger                                    без изменений; order_id → NULL
products_v2/tariffs/tariff_offers                      без изменений, is_active=false
```

## FU-2. Diagnose: subscription на one-off RR-заказе

### Найденная запись

```
id                    7c3ecca3-9c55-46cc-b51a-d6816cc843d7
user_id               05cd3754-d589-4d90-97d1-89ba2bee610b
order_id              dcef6436-6915-44b5-aba5-55e0e1d9aefc  (первый успешный RR-заказ)
product_id            00000000-c2f0-4e57-0000-100000000001
tariff_id             00000000-c2f0-4e57-0000-200000000001
status                active
billing_type          mit
auto_renew            false
access_start_at       2026-07-12 11:53:20.943+00
access_end_at         2026-11-09 11:53:20.943+00   (продлена на 4 заказа × 30 дней)
next_charge_at        2026-11-09 11:53:20.943+00
payment_method_id     a475823e-a2bf-4d21-bc50-d6fefa315ca4
meta.recurring_amount 50
meta.recurring_currency BYN
meta.recurring_snapshot null
meta.extended_by_orders [75853a0c…, 5d3bd651…, 6c610097…]
meta.granted_by       "grant-access-for-order"
```

### Recurring snapshot offer

Оффер `00000000-c2f0-4e57-0000-300000000001`:

```
is_installment=true, installment_count=null, requires_card_tokenization=false,
payment_method='installment'
meta.recurring          НЕТ (undefined)
meta.bank_installment   { rr_mode:'payment_url', rr_runtime:{...}, installment_provider:'rr' }
```

Resolver `resolveRecurring` корректно вернул `is_recurring=false, snapshot=null` (декoreнт «one_time» / «not_resolved»).

### Причина появления подписки

В `supabase/functions/grant-access-for-order/index.ts` подписка создаётся **всегда**, кроме двух исключений:

- `isNoCardTrial` — 0 BYN demo-trial без карты;
- `products.entitlement_mode = 'order_based_only'`.

Для RR one-off (offer.is_installment=true, meta.recurring отсутствует) ни одно исключение не срабатывает → subscription создаётся с `billing_type='mit'`, `auto_renew=false`, `recurring_snapshot=null`. По коду это **штатный path**, не RR-специфичный defect: любая одноразовая покупка через canonical grant-access-for-order оставляет такую subscription-запись.

### Классификация

- **Не блокер Sprint C2** (relates to canonical grant-access, pre-existing behavior).
- **Открытый вопрос архитектуры:** должен ли RR one-off (без recurring snapshot и без `is_installment` подписочной семантики) вообще создавать `subscriptions_v2`? Возможные варианты:
  - расширить exception: `resolvedRecurring.is_recurring === false && !offer.meta?.recurring` → skip subscription (`reason: 'one_time_purchase'`); entitlement + `access_grant_ledger` уже несут срок доступа;
  - либо создавать subscription только для явных recurring/installment-планов (`payment_method='installment' && installment_count>=1` — не наш случай, count=null).
- Требует отдельного patch-плана (`PATCH-ONE-OFF-NO-SUBSCRIPTION-V1`?) с обзором всех one-off потоков (bepaid card, stripe, RR), inventory последствий (dashboard-подписки, dunning, rebill), и миграционного backfill для существующих исторических «фиктивных» подписок.

### Что делать сейчас

- Cleanup Sprint C2 test-orders приостановлен до отдельного решения по одному из двух путей:
  1. **A.** Признать subscription штатной для one-off и удалять её точечно в guarded cleanup (только эту одну, по её id, без изменения общей логики).
  2. **B.** Сначала пропатчить `grant-access-for-order` (skip subscription for `resolved_recurring=false && !offer.meta?.recurring`), затем повторить runtime Sprint C2 и cleanup.
- Никаких изменений `subscriptions_v2` до явного approval.

## FU-3. Admin/super_admin уведомление в canonical `notify-order-purchased` — PATCH-ADMIN-PURCHASE-NOTIFY-V1

**Статус: IMPLEMENTED (build), SMOKE PENDING (runtime).**

### Discovery (подтверждено runtime)

- Уникальность `order_notification_deliveries` до патча: `UNIQUE (order_id, channel, notification_type)`.
- CHECK на `channel`: `ANY (ARRAY['telegram','email'])` — админ-канал невозможно вставить без миграции.
- Purchase-success вызовы `telegram-notify-admins` в `bepaid-webhook`: строки **1864 (subscription payment), 3627 & 4327 (link_payment), 5066 (checkout payment)**.
- Системные/диагностические вызовы: **886, 937 (misconfig), 4469 (orphan_created), 4529 (orphan_failed)** — не трогаем.
- Внутренний вызов `notify-order-purchased` из `grant-access-for-order` найден (fire-and-forget, service-role JWT, строка 2414).
- Admin recipients: 4 уникальных `telegram_user_id` через `user_roles_v2 → roles.code IN ('admin','super_admin') → profiles.telegram_user_id`.

### Реализовано

1. **Миграция** (примечание: одна транзакция):
   - `channel` CHECK расширен до `('telegram','email','telegram_admin')`.
   - Уникальный constraint `(order_id, channel, notification_type)` заменён на индекс `(order_id, channel, notification_type, COALESCE(recipient,''))` — buyer-каналы остаются идемпотентными, admin получает отдельную строку на каждого telegram_user_id.
   - Партиальный уникальный индекс `uniq_tg_msg_admin_purchase_dm` на `telegram_messages` по `(source_order_id, admin_telegram_user_id) WHERE event='product_purchased_admin_dm'`.
2. **`supabase/config.toml`:** `notify-order-purchased.verify_jwt = true`.
3. **`supabase/functions/notify-order-purchased/index.ts`:**
   - Guard: `Authorization` header обязателен → `getClaims` → `role === 'service_role'` иначе 403.
   - `force` и `force_purchase_dm` доступны только service-role (внешний пользователь не проходит guard).
   - Новый блок `TELEGRAM_ADMIN`:
     - Список admins получается через `roles → user_roles_v2 → profiles`, DISTINCT по `telegram_user_id`.
     - Один primary bot, `Promise.allSettled` по recipients, ошибка одного не влияет на других.
     - HTML escape всех динамических полей (`escapeHtml` применён к продукту, тарифу, сумме, номеру заказа, дате, имени, order_id в ссылке).
     - Каждому админу — отдельная `order_notification_deliveries` строка (`channel='telegram_admin'`, `recipient=<tg_user_id>`).
     - Mirror в `telegram_messages` c `event='product_purchased_admin_dm'`, идемпотентный через партиальный индекс.
   - Buyer-каналы (email/telegram) — поведение не изменено.
4. **`supabase/functions/bepaid-webhook/index.ts`:** удалены 4 purchase-success вызова `telegram-notify-admins` (subscription payment, link_payment ×2, checkout payment). Остались 4 KEEP-сайта (misconfig ×2, orphan_created, orphan_failed).

### Smoke (PENDING runtime)

Требует reactivation Stage F definitions и запуска RR authorized webhook на новом test-order:

```
product 00000000-c2f0-4e57-0000-100000000001
tariff  00000000-c2f0-4e57-0000-200000000001
offer   00000000-c2f0-4e57-0000-300000000001
```

**Checklist:**
- [ ] buyer email delivery: `order_notification_deliveries` row `channel='email', status='sent'`;
- [ ] buyer Telegram delivery: `channel='telegram', status='sent'`;
- [ ] **4 отдельных** `telegram_admin` deliveries (по одной на каждого admin recipient) со `status='sent'`;
- [ ] **4 admin mirror** записи в `telegram_messages` с `meta.event='product_purchased_admin_dm'`;
- [ ] текст сообщения корректный, ссылка `/admin/orders/{order_id}` работает;
- [ ] повтор webhook не увеличивает counts (проверка idempotency);
- [ ] bePaid purchase (если параллельно запустить) не создаёт двойного admin-уведомления — только через canonical path;
- [ ] unauthorized вызов `notify-order-purchased` (anon JWT или authenticated non-service-role) получает 401/403.

**После smoke:** deactivate product/tariff/offer, новый test-order оставить как audit proof до отдельного cleanup approval.


---

# Правила ведения плана

- Каждое инженерное сообщение — «План:» или «Отчёт о выполнении:».
- Diagnose → Plan → Dry run → Execute → Verify. Sprint C2 закрыт по этой цепочке.
- Cleanup, admin-notify и one-off subscription patch — три независимых follow-up, каждый требует отдельного явного approval.

## Отчёт о выполнении: PATCH-ADMIN-PURCHASE-NOTIFY-V1 — CORRECTION applied

Согласно замечаниям пользователя (correction required) выполнены точечные исправления перед runtime smoke:

### 1. Восстановлена разделённая идемпотентность buyer/admin

Миграция (partial unique indexes) заменяет объединённый `order_notification_deliveries_unique_v2`:

```sql
DROP INDEX IF EXISTS public.order_notification_deliveries_unique_v2;

CREATE UNIQUE INDEX order_notification_deliveries_unique_buyer
  ON public.order_notification_deliveries (order_id, channel, notification_type)
  WHERE channel IN ('email', 'telegram');

CREATE UNIQUE INDEX order_notification_deliveries_unique_admin
  ON public.order_notification_deliveries (order_id, channel, notification_type, recipient)
  WHERE channel = 'telegram_admin';
```

`upsertDelivery` приведён в соответствие: для `email`/`telegram` lookup существующей строки идёт без фильтра по `recipient` (смена email или Telegram ID не создаёт вторую buyer-delivery). Для `telegram_admin` lookup обязательно с `recipient` (каждый admin получает свою запись).

### 2. Admin DM: добавлены телефон и провайдер

- SELECT `orders_v2` расширен `customer_phone, provider`;
- Текст admin-DM теперь содержит отдельные строки:
  - 📧 Email
  - 📱 Телефон
  - 💳 Провайдер (rr / bepaid / stripe)
- Сумма перенесена на 💵 (💳 занята провайдером);
- Все значения проходят через `escapeHtml`.

### Deploy

`notify-order-purchased` задеплоена. Миграция применена. Runtime smoke разблокирован.

Статус:
- PATCH-ADMIN-PURCHASE-NOTIFY-V1: CORRECTION APPLIED, READY FOR SMOKE
- Runtime E2E smoke: UNBLOCKED
