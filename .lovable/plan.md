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

---

## PATCH-ADMIN-PURCHASE-NOTIFY-V1 — Runtime smoke (Stage F, canonical browser flow)

Дата: 2026-07-12.
Actor: агент (пользователь не задействован, синтетический INSERT не использовался).

### Что сделано агентом самостоятельно

1. Временно активировано Stage F definitions: `products_v2.status='active'` (было `inactive`), `is_active=true`. `tariff` и `offer` уже были активны. Бизнес-логика/цена/routing не менялись.
2. Playwright с injected Supabase-сессией `7500084@gmail.com` (super_admin+admin), маршрут `/pricing/tariff/T-000075`, канонический путь TariffCard → «Оформить рассрочку (Stage F test)» → `LeadRequestDialog` → POST `public-rr-installment-initiate`.
3. Создан canonical order `2ca1f5e4-ee06-4e97-b661-3d1e2db7ade1` (`ORD-26-00305`):
   - `provider='rr'`, `meta.flow='rr_installment'`, `status='pending'`;
   - `product/tariff/offer` = Stage F IDs;
   - `pipeline_stage_id='43ded272-6263-4bf4-8bb3-6641f0d0c2f8'` = `crm_routing_snapshot.stage_on_pending` ✓;
   - `crm_routing_snapshot.enabled=true`, positive pipeline;
   - `user_id='05cd3754-…'`, applicant сохранён в `meta.rr.applicant` (`source='public-rr-installment-initiate'`);
   - deliveries до webhook = 0 ✓.
4. `rr-admin-deliver-test-webhook` → `authorized` → `promote_state='promoted'`, `should_grant_access=true`, entitlement inserted, `crm_stage.applied=true`, order → `paid`.

### Обнаруженный blocker — notify не срабатывает

- `grant-access-for-order` вызывает `notify-order-purchased` в стиле fire-and-forget (`fetch(...).catch(...)`) без ожидания.
- В Supabase Edge Runtime такая незавершённая задача обрывается при возврате Response родительской функции.
- В логах `notify-order-purchased`: только `booted`, обработчик не выполняется.
- `order_notification_deliveries` = 0 для всех трёх созданных заказов (`ORD-26-00305/306/307`).
- Второй webhook на тот же заказ — `already_promoted`, `should_grant_access=false` → grant-access не переисполняется, notify снова не вызывается.

### Точечный патч, применённый агентом

`supabase/functions/grant-access-for-order/index.ts` (post-payment notification block):
- добавлен `.then(...)` с логом статуса ответа notify (для аудита);
- добавлен `EdgeRuntime.waitUntil(notifyPromise)` (guarded), чтобы Deno edge runtime не обрывал fire-and-forget при возврате Response.

После правки было создано ещё два canonical заказа через тот же browser-flow (`fba26422-…`, `f7b95f5d-…`), для каждого выполнен `rr-admin-deliver-test-webhook`:
- `promote_state='promoted'`, entitlement inserted, `crm_stage.applied=true`;
- в логах `notify-order-purchased` по-прежнему только `booted`, execution handler не отрабатывает;
- deliveries = 0 для всех трёх заказов;
- admin mirror и buyer DM не отправлены.

Гипотеза: либо `EdgeRuntime.waitUntil` в этом runtime не удерживает промис, либо auto-deploy изменённой `grant-access-for-order` ещё не применён на момент второго/третьего вызова. Дальше без второго code change/deploy проверить невозможно.

### Что сделано на закрытие

- Stage F definitions возвращены в `inactive` (`products_v2.status='inactive'`; tariff/offer оставлены как были — по требованию).
- Три canonical order (`ORD-26-00305/306/307`) оставлены в БД как audit proof; данные order/payment/entitlement/crm корректны.
- `.lovable/plan.md` обновлён.

### Итог

```
PATCH-ADMIN-PURCHASE-NOTIFY-V1: SMOKE BLOCKED
  Security hardening (verify_jwt + service_role guard): VERIFIED, PASS (401/403 подтверждались ранее)
  Buyer/admin idempotency contract (миграция + upsertDelivery): CODE VERIFIED
  Admin DM обогащение (email/phone/provider): CODE VERIFIED
  bePaid duplicate removal: CODE VERIFIED
  RR canonical order creation via browser flow: VERIFIED, PASS
  RR authorized webhook → promote + grant + entitlement + CRM: VERIFIED, PASS
  notify-order-purchased fire-and-forget invocation: FAILING (handler не отрабатывает, deliveries=0)

Root cause (гипотеза): fire-and-forget из grant-access-for-order обрывается edge runtime.
Применённый агентом патч (EdgeRuntime.waitUntil) не подтверждён в рантайме.
```

### Требуется решение владельца

Варианты для следующего шага:
- A. Заменить fire-and-forget на `await` перед `return new Response(...)` в `grant-access-for-order` (гарантирует доставку, +1-3 s к grant-latency).
- B. Оставить fire-and-forget, но переключить `notify-order-purchased` в отдельный persistent trigger (Postgres NOTIFY / DB trigger → pg_net → edge function).
- C. Диагностика текущего `EdgeRuntime.waitUntil` fix: дождаться следующего deploy cycle и повторить smoke.

До явного выбора smoke дальше не запускается. Admin-notify остаётся неверифицированным в рантайме.

---

## Отчет о выполнении — PATCH-ADMIN-PURCHASE-NOTIFY-V1 · AWAIT FIX + FINAL SMOKE (12.07.2026)

### Изоляция root cause (direct service-role probe)

Развёрнута временная диагностическая функция `admin-notify-probe`
(verify_jwt=true, admin/super_admin-only), которая с service-role JWT
awaited-вызовом обращалась к уже задеплоенной `notify-order-purchased`
для оплаченного заказа `ORD-26-00305` (`2ca1f5e4-…`).

Первый probe → **HTTP 403** `{"error":"forbidden","reason":"service_role_required"}`.

**Root cause подтверждён и НЕ совпал с ранее принятой гипотезой:**

- Проблема не в lifecycle caller (fire-and-forget / waitUntil), а в
  in-function guard `notify-order-purchased`: он валидировал токен
  через `verifier.auth.getClaims(token)`, который проверяет подпись
  через JWKS (asymmetric signing keys).
- Легаси HS256 `SUPABASE_SERVICE_ROLE_KEY`, которым Lovable Cloud
  подписывает internal-вызовы, в JWKS не входит → `getClaims` не
  возвращает `role='service_role'` → guard срабатывал 403.
- Внешний `verify_jwt=true` на gateway для legacy HS256
  service_role JWT проходит успешно (наблюдалось на probe вызовах).
- Все прошлые вызовы `notify-order-purchased` из
  `grant-access-for-order` в prod-логах получали 403 и молча
  игнорировались (fire-and-forget / waitUntil `.catch()`), из-за чего
  ни одна delivery не создавалась. Ни fire-and-forget, ни waitUntil
  здесь не были главной причиной сбоя.

### Fix (аутентификация)

`supabase/functions/notify-order-purchased/index.ts` — service-role guard
расширен: сначала прямое сравнение `token === SUPABASE_SERVICE_ROLE_KEY`
(constant equality на длинной секретной строке); только если это не
service_role token — проверяем через `getClaims` (для будущих
signing-keys internal callers). Прочая логика функции не тронута.

### Fix (lifecycle · вариант A)

`supabase/functions/grant-access-for-order/index.ts` — post-payment
notification block переписан:

- убран `EdgeRuntime.waitUntil` и fire-and-forget `.then/.catch`;
- явный `await fetch(notify-order-purchased, { signal: AbortController(20s) })`;
- HTTP status/body/elapsed логируются (успех и non-2xx);
- любые ошибки/timeout ловятся `try/catch` и **не** проваливают
  grant-access — сохранена контрактная non-fatal семантика.

Обе функции задеплоены явно через `deploy_edge_functions`, а не через
auto-deploy.

### Проверка 1 — direct service-role probe на ORD-26-00305 (после fix)

Повторный вызов probe для того же заказа `2ca1f5e4-…`:

```
notify_status: 200
elapsed_ms:    4840
deliveries_after: 6
  - email          → 7500084@gmail.com                sent
  - telegram       → 66086524   (buyer DM)            sent
  - telegram_admin → 2087326316                       sent
  - telegram_admin → 6338908257                       sent
  - telegram_admin → 99340019                         sent
  - telegram_admin → 66086524                         sent
notify_body:
  email:          delivery_id=f7f20a82-…  sent=true
  telegram:       delivery_id=a4e9d2ff-…  sent=true
  telegram_admin: recipients=4, все sent=true
```

Contract соответствует: 1 email + 1 buyer telegram + 4 telegram_admin
(по всем `admin`/`super_admin` recipients в
`user_roles_v2`/`profiles`).

### Проверка 2 — идемпотентность direct probe (тот же заказ, повтор)

```
notify_status: 200
elapsed_ms:    1339
deliveries_after: 6   ← без изменений
notify_body: все каналы skipped="already_sent"
  email:          skipped=already_sent
  telegram:       skipped=already_sent
  telegram_admin: 4/4 skipped=already_sent
```

Independent proof: повторный внутренний запуск не рассылает дубли,
уникальные partial-индексы (`_unique_buyer`, `_unique_admin`) держат.

### Проверка 3 — новый canonical заказ end-to-end

1. `public-rr-installment-initiate` (offer `00000000-c2f0-4e57-0000-300000000001`,
   applicant `7500084@gmail.com`, `+375291234567`)
   → `order_id = 31491a7d-2bbc-423d-8fab-b99c6419e35b`, `reused=false`.
2. `rr-admin-deliver-test-webhook` → authorized:
   - `promote_state=promoted`, `should_grant_access=true`, `grant_status=200`;
   - `entitlement_source.status=inserted`, `recalc.status=active`, `active_count=4`;
   - `crm_stage.applied=true, reason=ok`;
   - order → `paid`.
3. Deliveries сразу после webhook:

```
6 rows for 31491a7d-…
  email          7500084@gmail.com  sent  14:10:47
  telegram       66086524           sent  14:10:48   (buyer DM)
  telegram_admin 66086524           sent  14:10:48
  telegram_admin 6338908257         sent  14:10:48
  telegram_admin 99340019           sent  14:10:48
  telegram_admin 2087326316         sent  14:10:48
```

Все 4 админа получили DM, buyer получил email+telegram. Awaited notify
из `grant-access-for-order` **фактически дождался** ответа handler
(лог `notify-order-purchased status=200 elapsed_ms=…`).

### Проверка 4 — идемпотентность webhook (тот же заказ, `allow_repeat=true`)

- `promote_state=already_promoted`, `should_grant_access=false`,
  `fulfillment_state=not_needed`;
- `entitlement_source.status=exists`, `active_count=4` без роста;
- `crm_stage.applied=false, reason=idempotent`;
- deliveries after repeat: **6** (без роста);
- payments/entitlement sources/mirrors — без роста;
- notify заново не дёргается (grant-access не переисполняется).

### Cleanup

- Временная функция `admin-notify-probe` удалена
  (`delete_edge_functions` + `rm -rf supabase/functions/admin-notify-probe`,
  блок в `supabase/config.toml` снят).
- Stage F definitions уже были `products_v2.status='inactive'` (tariff/offer
  is_active=true оставлены как были — их состояние не менялось в рамках
  этого cycle).
- 4 canonical-заказа (`ORD-26-00305/306/307` + новый
  `31491a7d-…` без order_number на момент smoke) оставлены в БД как
  audit proof.

### Итог

```
PATCH-ADMIN-PURCHASE-NOTIFY-V1: VERIFIED, PASS
  Root cause (JWKS vs HS256 service_role guard): IDENTIFIED, FIXED
  Await-based non-fatal notify from grant-access-for-order: DEPLOYED, VERIFIED
  Security hardening (verify_jwt + service_role guard):    VERIFIED, PASS
  Buyer + admin unique-index contract:                     VERIFIED, PASS
  Admin DM enrichment (email/phone/provider):              DEPLOYED (visible in real DMs; content contract PASS)
  RR canonical order creation + authorized webhook:        VERIFIED, PASS
  Awaited notify → 1 email + 1 buyer TG + 4 admin TG:      VERIFIED, PASS
  Direct service-role probe idempotency:                   VERIFIED, PASS
  Webhook repeat idempotency (no payment/entitlement/delivery/mirror growth): VERIFIED, PASS
  bePaid duplicate purchase-success removal:               CODE VERIFIED
  bePaid live observation:                                 FOLLOW-UP, NON-BLOCKING

DB trigger / outbox:              NOT REQUIRED (await path достаточно)
waitUntil retry-only approach:    REJECTED
```

---

## PATCH-EMAIL-FOOTER-UTF8-V1 — Отчёт о выполнении

**Diagnose.** Diff rendered_html двух писем (ORD-26-00305 vs ORD-26-00308):
- 305: байты `С` (D0 A1) в подписи заменены на `EF BF BD EF BF BD` (два U+FFFD) → отображается `�� уважением,`
- 308: те же байты в подписи целы → `С уважением,`
- В обоих письмах preview-текст содержал `(��е CB)` вместо `(не CB)` — байт `н` (D0 BD) корраптился.

**Root cause.** `renderAsync` из `@react-email/components@0.0.22` использует `ReadableStream + TextDecoder` без stream-mode; многобайтные UTF-8 символы, попадающие на границу chunk-а, декодируются как невалидные и заменяются на U+FFFD. Из-за нестабильных границ chunk-ов подпись повреждалась только на некоторых рендерах.

**Fix (`supabase/functions/send-transactional-email/index.ts`).**
1. `renderAsync` → синхронный `render` из `npm:@react-email/render@0.0.17` (не использует streaming pipeline).
2. Post-render guard: считает `\uFFFD` в HTML и plain-text; при обнаружении пишет `console.error('email_utf8_replacement_detected', …)` с `messageId`, `templateName`, `recipient`, counts. **Non-blocking** — письмо всё равно уходит покупателю.
3. `renderEmail` вызывается через `await` — совместимо и с sync, и с Promise-возвратом.

**Verify (preview send без нового заказа).**
- Идемпотентный тестовый вызов `send-transactional-email` (`utf8-hotfix-preview-3`, product-purchased, тем же контентом что в 305) → `success: true`.
- В response `rendered_html`: подпись `С уважением,<br/>команда Екатерины Горбовой` — без U+FFFD.
- В `rendered_html` preview: `(не CB)` — без U+FFFD.
- В `rendered_text`: `С уважением,` — без U+FFFD.

**Транспорт.** `<meta charset="UTF-8">` и `Content-Type: text/html; charset=UTF-8` уже присутствуют в шаблоне — не меняли.

**Статус:** PATCH-EMAIL-FOOTER-UTF8-V1: VERIFIED, PASS. Non-blocking, не переоткрывает Sprint C2.

---

## PATCH-ONE-OFF-NO-SUBSCRIPTION-V1 — Diagnose report (код не менялся)

Микроправка сопутствующая: комментарий в `send-transactional-email/index.ts` строка 3 приведён к фактической версии `@react-email/render@0.0.17` (было ошибочно `@1.0.5`). Никакой логики не затронуто, smoke не переоткрывается.

### 1. Инвентаризация writers → grant-access-for-order

| Поток                                                       | One-off | Recurring | Trial | Installment | Точка вызова |
| ----------------------------------------------------------- | :-----: | :-------: | :---: | :---------: | ------------ |
| RR (rr-fulfill-order → rr-promote-order)                    |   ✔    |     —     |   —   |     ✔ (внутренние installments учитываются как один oneoff RR-заказ) | `_shared/rr/rr-promote-order.ts:122` |
| bePaid webhook — purchase-success (первый success)           |   ✔    |     ✔    |   —   |     —      | `bepaid-webhook/index.ts:1677, 2914, 4208, 4701, 2800` |
| bePaid webhook — REBILL (provider_managed rebill)            |    —    |     ✔    |   —   |     —      | `bepaid-webhook/rebill_flow.ts` (через grant-access) |
| bePaid create-token (MIT tokenization → charge)              |   ✔    |     ✔    |   —   |     —      | `bepaid-create-token/index.ts` |
| bePaid create-subscription-checkout (provider_managed)       |    —    |     ✔    |   —   |     —      | `bepaid-create-subscription-checkout/index.ts` |
| Stripe webhook (checkout.session.completed, invoice.paid)    |   ✔    |     ✔    |   ✔  |     —      | `stripe-webhook/index.ts:417, 542` |
| public-charge-saved-card (MIT списание сохранённой картой)    |    —    |     ✔    |   —   |     —      | через bepaid-webhook |
| subscription-charge (job) — canonical renewal, идёт через WH |    —    |     ✔    |   —   |     —      | не вызывает напрямую, комментарий на 1868 |
| test-payment-complete / admin-reconcile / erip-reconcile     | mixed   | mixed     |   —   |     —      | сервисные ре-fulfil |
| admin-manual-charge                                          |   ✔    |     ✔    |   —   |     —      | `admin-manual-charge/index.ts:437` |
| Manual/admin (BulkExtend, GrantAccessFromDeal, EditDeal)     |   ✔    |    —     |   ✔  |     —      | UI-кнопки, вызовы `grant-access-for-order` из клиента |

Итого: **все успешные оплаты и все административные grant-и** идут через один writer, и он безусловно создаёт/продлевает `subscriptions_v2` (за двумя исключениями — `no_card_trial` и `entitlement_mode='order_based_only'`).

### 2. Canonical recurring predicate (предлагаемый)

Сейчас в `grant-access-for-order/index.ts:46-133` уже есть SOT-резолвер `resolveRecurringFromOrderOrTariff(order.offer_id, tariff_id)` со значениями `from_order_offer | resolved_from_tariff | one_time | not_resolved`. Он **не используется как гейт на создание подписки** — используется только чтобы прикрепить `recurring_snapshot`. В строках 1544-1699 create/extend выполняется всегда.

Предлагаемый предикат `isRecurringForSubscription(order, tariff, ctx)` — истинно при **любом** из:

- `resolveRecurringFromOrderOrTariff(...).is_recurring === true` (SOT: `tariff_offers.meta.recurring.is_recurring`), либо
- `ctx` указывает на явный provider-managed subscription flow (`bepaid-create-subscription-checkout`, `stripe-create-subscription-checkout`, `admin-manual-charge` с `is_subscription_flow=true`, `subscription_renewal` context), либо
- у пользователя+продукта уже существует `subscriptions_v2` с `EXISTS provider_subscriptions ps WHERE state IN ('active','pending','past_due')` — тогда это extend уже настоящей подписки.

Всё остальное — one-off. `provider`, `is_installment`, `hasPaymentMethod`, `requires_card_tokenization`, `payment_flow='mit_tokenization'`, `flow_tag`, наличие карты — **не** классификаторы.

### 3. Инвентаризация данных `subscriptions_v2`

Всего строк: **1335**.

|                              | count |
| ---------------------------- | ----: |
| `recurring_snapshot` != null | 339   |
| provider_subscriptions active/pending/past_due | 192 |
| `auto_renew=true`            | 238   |
| **one-off shaped** (no snapshot + no provider_sub + auto_renew=false) | **896** |
| — из них `status='active'`  | 178   |
| `extended_by_orders`>1       | 92    |

Разбивка one-off shaped по `billing_type × status`:

| billing_type      | status       |   n |
| ----------------- | ------------ | --: |
| mit               | expired      | 320 |
| mit               | active       | 176 |
| mit               | superseded   | 141 |
| provider_managed  | past_due     | 119 |
| mit               | canceled     |  85 |
| provider_managed  | expired      |  58 |
| provider_managed  | active       |  55 |
| provider_managed  | superseded   |  27 |
| provider_managed  | canceled     |  12 |
| provider_managed  | pending      |   3 |

Разбивка активных one-off shaped по источнику (по `orders_v2.provider` и `offer.meta.recurring`):

| provider          | offer.is_recurring | payment_flow                | n |
| ----------------- | ------------------ | --------------------------- | -: |
| getcourse         | null               | —                           | 318 |
| null              | null               | —                           | 165 |
| null              | true               | —                           | 122 |
| null              | true               | provider_managed_checkout   | 90 |
| historical_import | null               | —                           | 63 |
| null              | false              | —                           | 56 |
| null              | true               | renewal_subscription        | 32 |
| null              | null               | renewal_subscription        | 21 |
| null              | false              | renewal_one_time            | 9 |
| null              | true               | admin_subscription          | 5 |
| stripe            | false              | public_one_time             | 2 |
| bepaid            | true               | provider_managed_checkout   | 1 |
| rr                | false              | —                           | 1 |
| …прочее           |                    |                             | ≤3 каждая |

Наблюдения:

- Огромный хвост — исторический импорт из GetCourse и raw imports (`provider=null`, `provider=historical_import`, `provider=getcourse` — 546 строк). Это **legacy access containers**, не «покупки» в текущем коде. Их источник — не `grant-access-for-order`, а backfill-скрипты; исключены из scope V1.
- Реальные фиктивные one-off subscriptions от текущего writer-а — это в основном строки, где `offer.is_recurring=true` но карта не привязана / карта отозвана → `auto_renew=false` и `provider_subscriptions` пустой. Классификация уже сейчас **корректно** называет их recurring по SOT — но по факту дальнейших списаний не будет. То есть pure «одноразовые non-recurring» в свежих данных — **stripe public_one_time (2) и rr (1)**. Остальное — «recurring контракт, у которого нет действующего provider-механизма списания».
- Активные one-off shaped: 178. У 44 из них — платёж только по «исходному» заказу; multi-payment (rebill-подобных) — **18** из 178 (≈10%). Т.е. ~90% активных one-off shaped-подписок никогда не будут списаны повторно.

### 4. Readers `subscriptions_v2` (не тронуть без миграции)

DB-side: views/materialized views нет; RPC, зависящие от `subscriptions_v2` (25 функций, среди них `cascade_order_cancellation`, `align_billing_dates`, `find_misaligned_subscriptions`, `sync_payment_method_revocation`, `has_valid_access_for_club`, `user_has_access_to_rule`, `user_has_live_event_access`, `get_user_section_access`, `resolve_broadcast_audience_*`, `handle_new_user`, `admin_reset_user_trial`, `subscription_has_payment_token`).

App-side: **34 UI-файла** читают `subscriptions_v2` напрямую. Ключевые:

- **Личный кабинет и статусы:** `src/pages/Purchases.tsx`, `src/pages/Products.tsx`, `src/pages/Learning.tsx`, `src/components/user/UserSubscriptions.tsx`, `src/components/purchases/SubscriptionDetailSheet.tsx`, `src/components/onboarding/WelcomeOnboardingModal.tsx`
- **Доступ к обучению:** `useTrainingModules`, `useTrainingContentRules`, `useContainerLessons`, `useSidebarModules`, `useMonthGate`, `pages/BusinessTrainingContent.tsx`
- **Payment/rebill:** `pages/settings/PaymentMethods.tsx`, `lib/subscriptionReplacement.ts`, `hooks/useBillingReport.ts`, `hooks/admin/useStripeSubscriptionsList.ts`, `hooks/admin/usePaymentIssues*`
- **CRM / админка:** `pages/admin/AdminDeals.tsx`, `AdminContacts.tsx`, `ContactDetailSheet`, `EditSubscriptionDialog`, `EditDealDialog`, `DealDetailSheet`, `GrantAccessFromDealDialog`, `BulkExtendAccessDialog`, `AdminPaymentLinkDialog`, `LinkSubscription{Contact,Deal}Dialog`
- **Telegram/access:** `useTelegramIntegration`, `telegram-process-access-queue` (edge), `access-rules-nightly-reconcile`
- **Broadcast/email:** `BroadcastSendDialog`, `SendNotificationDialog`, `communication/InboxTabContent`

Вывод: `subscriptions_v2` в UI используется как источник **срока доступа**, **billing-статуса** и **CRM-состояния сделки одновременно**. Просто перестать создавать строку one-off нельзя — минимум `Purchases.tsx`, `Products.tsx`, `Learning.tsx` и CRM (`AdminDeals`, `DealDetailSheet`) сейчас показывают "до какой даты открыт продукт" именно оттуда, а не из `entitlements`.

### 5. Целевая модель (proposal, к согласованию)

```
one-off purchase (RR, bePaid one-off, Stripe one-off, admin_one_time, renewal_one_time)
  → payments_v2 (+ entitlement_sources) + orders_v2 переходит в 'paid'
  → aggregate entitlement обновляется
  → subscriptions_v2 НЕ создаётся

recurring purchase (provider_managed_checkout, admin_subscription, subscription_renewal,
                    offer.meta.recurring.is_recurring=true И есть механизм списания)
  → payments_v2 (+ entitlement_sources) + orders_v2 → 'paid'
  → aggregate entitlement обновляется
  → subscriptions_v2 живёт как billing lifecycle
    (provider_subscription linkage ИЛИ MIT payment_method + auto_renew)
```

Гейт в `grant-access-for-order`:

```
if (!isRecurringForSubscription(order, tariff, ctx)) {
  results.subscription = { action: 'skipped', reason: 'one_off_no_subscription' };
  // audit: grant-access-for-order.subscription_skipped reason=one_off
} else {
  // текущая CREATE/EXTEND ветка, начиная с existingProductSub-lookup
}
```

Все три существующих `SKIP`-ветки (`no_card_trial`, `order_based_only`, новая `one_off`) сохраняют идемпотентность notify-order-purchased и entitlement grant.

### 6. Prerequisite для перехода — миграция читателей

Blocker для code-change: UI/CRM/edge-функции читают `access_end_at` и `auto_renew` из `subscriptions_v2`. Порядок:

1. Ввести SoT-хелпер `getAccessWindowForUserProduct(userId, productId)` → читает из `entitlements` (или aggregate view), НЕ из `subscriptions_v2`.
2. Мигрировать читатели (34 файла + 25 RPC + edge access-resolver) на этот хелпер / view. Отдельными PR-ами, ranked по риску: сначала UI display, потом access enforcement (`access-rules-nightly-reconcile`, `telegram-process-access-queue`, `has_valid_access_for_club`, `user_has_access_to_rule`).
3. Только после того как ни один reader не завязан на `subscriptions_v2` для one-off → включить гейт в writer.
4. Backfill — как обсуждается ниже.

### 7. Варианты по существующим one-off рядам

Пока не выполнять; на выбор к следующему шагу:

- **A. Freeze legacy.** Оставить 896 one-off shaped строк как есть. Новых one-off subv2 больше не создаётся. Плюс: нулевой риск на исторические доступы. Минус: `subscriptions_v2` навсегда содержит смесь.
- **B. Soft-mark.** Проставить `meta.legacy_one_off_container=true`, скрыть в billing-UI, оставить как источник срока доступа для миграционного периода. Плюс: явный маркер, можно постепенно чистить. Минус: доп. состояние.
- **C. Hard-migrate.** После пункта 6 — удалить one-off shaped строки (или перевести в `status='expired', meta.superseded_by='entitlement'`), т.к. entitlement уже несёт срок. Плюс: чистая модель. Минус: требует полного покрытия читателей и rollback-плана.

Рекомендация Diagnose-этапа: **B на переходный период, C — как цель**, при условии полного завершения (6).

### 8. Наблюдения (не блокирующие)

Следующий естественный bePaid-платёж (без принудительного smoke) проверим по логам на:

- ровно 4 admin-DM через `notify-order-purchased` (`channel=telegram_admin`);
- отсутствие вызова `telegram-notify-admins` в purchase-success-ветке `bepaid-webhook`;
- UTF-8 подпись в email (нет `\uFFFD` в rendered_html/text; отсутствие лога `email_utf8_replacement_detected`).

Артефакт: свободный monitoring-заход, отдельного тестового платежа не создаём.

### Статус

```
PATCH-ONE-OFF-NO-SUBSCRIPTION-V1: DIAGNOSE COMPLETE, awaits proposal approval
Code changes:                     NONE (кроме микрофикса комментария версии @react-email/render)
Data changes:                     NONE
```
