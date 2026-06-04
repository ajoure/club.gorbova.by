# Pilot Readiness Review — Stripe Phase 2 → Stage C gate v1

Дата: 2026-06-04. Режим: **read-only**. Никаких изменений кода/миграций/секретов/live-режима.
Гейт расширен с 10/10 до **13/13** (CRM/Telegram/Document routing добавлены по требованию).

---

## Итоговый вердикт

**11 / 13 PASS, 2 FAIL → STOP-GATE сработал.**

Stage C Runtime Pilot «Платная консультация» **запрещён** до закрытия:
- **F-PRR-09:** E2E metadata trace (`account_code` / `business_stream` отсутствуют на верхнем уровне `payments_v2.meta`; post-MP-A2-1 real-checkout без sandbox-simulate не зафиксирован).
- **F-PRR-11:** CRM routing для Stripe-orders не подтверждён (нет deal/pipeline-binding flow для `provider='stripe'`).

Параллельно запрещено (per плану):
- запускать Stage C Runtime Pilot;
- создавать Stripe Subscription / Subscription Schedule;
- расширять `subscription-actions` / reconcile jobs;
- любые работы Фазы 3 кроме готовности.

См. **Mini-plans** в конце документа.

---

## 1. Account resolver — PASS

SOT = `_shared/acquiring/default-account.ts` (`resolveDefaultStripeAccount`).
- Override: `body.account_code` → точечный lookup, проверка `status='active'`.
- Default: `provider='stripe' AND is_default=true AND status='active'`, `order by updated_at desc limit 1`.
- Нет fallback на хардкод; при отсутствии — `throw 'no_active_default_stripe_account'`.

Все 7 Stripe edge-функций переведены (grep подтверждает: упоминания `stripe_poland` остались **только** в комментариях MP-A2-1 и в `_shared/acquiring/stripe-metadata.ts` как пример):
```
stripe-admin-refund / stripe-ensure-webhook / stripe-admin-sandbox-checkout /
stripe-create-checkout / stripe-get-session / stripe-reconcile-session / stripe-webhook
```

Прочие literal-hits — вне Stripe scope (`ilex-api`, `getcourse-sync`, `access-resolver` — не относятся к acquiring).

**Verdict:** PASS.

---

## 2. Customer resolver — PASS

SOT = `_shared/acquiring/stripe-customer-resolver.ts`. Identity-ключ:
```
(user_id, account_code)
```
Email — **только last-step fallback** (`stripeCustomersListByEmail`) с отдельным audit-событием `stripe_customer_email_collision` при коллизии `user_id`.

Доказательная база: `.lovable/proofs/mp_a2_2_customer_resolver_v1.md` + `.lovable/proofs/mp_a2_2_runtime_completion_v1.md` (S1/S4/S5/S6/S7 = runtime PASS).

**Verdict:** PASS.

---

## 3. Saved Payment Method — PASS

`_shared/acquiring/stripe-adapter.ts:75`:
```ts
if (req.save_payment_method && req.customer_id) {
  form.push(['payment_intent_data[setup_future_usage]', 'off_session']);
}
```
- `customer` подставляется из resolver (`req.customer_id`), Stripe-валидация: `customer` и `customer_email` взаимоисключаемы.
- Локально PAN/PM не хранятся (Stripe = SOT).
- Inline picker отложен — см. `.lovable/backlog/stripe_saved_pm_followup.md`.

**Verdict:** PASS (для пилота консультации картa picker не требуется).

---

## 4. Customer Portal readiness — PASS (expected gap)

`ls supabase/functions/ | grep -i portal` → **empty**. Edge-функция `stripe-create-portal-session` отсутствует.
Это **ожидаемый gap**: пилот = разовая оплата консультации, recurring/portal не требуются.
Зафиксировано в `.lovable/backlog/stripe_saved_pm_followup.md` (Вариант A — Customer Portal, отложен до пилота).

**Verdict:** PASS (gap явно скoped out пилота).

---

## 5. Hardcode audit — PASS

```
rg -n "example\.com|'default'" supabase/functions/stripe-* supabase/functions/_shared/acquiring/
```
Все hits = комментарии MP-A2-1 («No `?? 'https://example.com/...'` fallback», «removed literal 'default'»).
URL-резолвер: `resolveStripeCheckoutUrls` (connection → `PUBLIC_APP_HOST` fallback).
`business_stream`: `_shared/acquiring/business-stream-resolver.ts` (offer → product → override → `'unspecified'`).

**Verdict:** PASS.

---

## 6. Phase 2 regression — PASS

`provider_events` (read-only sample):
```
 71dec9be… stripe stripe_poland checkout.session.completed 2026-06-03 21:35:12
 0719c665… stripe stripe_poland charge.refunded            2026-06-03 19:41:12
 49147489… stripe stripe_poland charge.refunded            2026-06-03 19:40:03
 e6406a86… stripe stripe_poland charge.refunded            2026-06-03 19:38:12
 c6c92991… stripe stripe_poland charge.refunded            2026-06-03 19:36:54
```
- Webhook live: события приходят, `account_code` пишется.
- `payments_v2` для Stripe: 7 succeeded / 1 refunded / 12 pending.
- `stripe-admin-sandbox-checkout` (manual mode): order `58785062-d418-4343-86c9-c171ff2b5490` → `paid`, `meta.account_code='stripe_poland'`, `meta.checkout_mode='manual'`.
- Refund smoke: 4 успешных `charge.refunded` события за 19:36–19:41.

**Verdict:** PASS.

---

## 7. bePaid frozen — PASS

```
rg -l "acquiring/index|stripe-adapter|stripe-customer-resolver|vault\.ts" \
   supabase/functions/bepaid-webhook \
   supabase/functions/_shared/create-payment-checkout.ts \
   supabase/functions/_shared/acquiring/bepaid-adapter.ts
→ exit=1 (no matches)
```
`SELECT count(*) FROM payment_links WHERE provider='bepaid';` → **107** (стабильно, без падений).

**Verdict:** PASS.

---

## 8. Multi-account safety — PASS

- `acquiring_connections`: единственная запись (`stripe_poland`, `is_default=true`, `status='active'`, `test_mode=true`).
- `provider_events.account_code` пишется на каждом webhook hit (sample выше).
- Per-account customer cache: `profiles.meta.stripe.customers[<account_code>]` — схема MP-A2-2, валидирована runtime в `mp_a2_2_runtime_completion_v1.md`.
- В коде нет циклов по `acquiring_connections` без фильтра `provider='stripe' AND status='active'`.

**Verdict:** PASS.

---

## 9. E2E metadata trace — **FAIL** (F-PRR-09)

Трейс для последнего «успешного» Stripe-заказа `58785062-d418-4343-86c9-c171ff2b5490`:

| Узел | `account_code` | `business_stream` | `user_id` | `product_id` / `tariff_id` |
|---|---|---|---|---|
| `orders_v2.meta` | ✅ `stripe_poland` | ❌ **отсутствует** | ✅ (через `created_by_user_id`) | ❌ `manual_description` only |
| `payments_v2.meta` | ❌ только `stripe.simulation=true` | ❌ | ❌ | ❌ |
| `provider_events.payload.data.object.metadata` | n/a (sandbox-simulate не идёт через Stripe webhook → metadata=`null`) | n/a | n/a | n/a |

Дополнительно: исторический real-PI metadata показывает `business_stream='default'` (`c6c92991-… charge.refunded`):
```
{"order_id":"0feb…","provider":"stripe","tariff_id":"sandbox_manual",
 "product_id":"sandbox_manual","account_code":"stripe_poland","business_stream":"default"}
```
Это legacy-данные до MP-A2-1; post-MP-A2-1 real-Stripe-checkout (не sandbox-simulate) **не зафиксирован**, поэтому нельзя подтвердить, что Checkout Session metadata теперь корректна end-to-end в самом Stripe.

**Verdict:** **FAIL.** Mini-plan: **MP-A2-PRR-09** (см. ниже).

---

## 10. No live keys — PASS

```
SELECT account_code, test_mode, status FROM acquiring_connections WHERE provider='stripe';
 stripe_poland | t | active | t (is_default)
```
- UI `StripeConnectionDialog` блокирует `test_mode=true` (см. `stripe_phase_2_execute.md` §6).
- Vault secrets под именем `acq:stripe:stripe_poland:secret_key` — установлены оператором в test-режиме (косвенная проверка: `last_verified_at` обновлялся `acquiring-test-connection`).

**Verdict:** PASS.

---

## 11. CRM Routing — **FAIL** (F-PRR-11)

Для order `58785062-d418-4343-86c9-c171ff2b5490`:
- `crm_activity_log` для `meta->>'order_id'` → 0 строк.
- Таблицы `deals` не существует (`to_regclass('public.deals') = NULL`).
- В `audit_logs` только grant-access-события (`entitlement.legacy_product_id_backfilled`, `grant-access-for-order.legacy_body_alias`) — никакого следа CRM pipeline-binding.
- Канон `Product → Pipeline Mapping` (memory) требует `crm_routing` на оффере; sandbox-manual order не имеет `offer_id`, поэтому routing невозможен в принципе.

→ Для пилота «Платная консультация» (с реальным `product_id` / `tariff_id` / `offer_id` консультации) **CRM-маршрутизация не проверена**. Нужен реальный prod-like checkout с привязкой к продукту консультации.

**Verdict:** **FAIL.** Mini-plan: **MP-A2-PRR-11** (см. ниже).

---

## 12. Telegram Routing — PASS (skip by business rule)

Для order `58785062…`:
- `telegram_access_queue` для `meta->>'order_id'` → 0 строк.
- `entitlements` для `meta->>'order_id'` → 0 строк (sandbox-manual order не порождает entitlement без `product_id`/`tariff_id` UUID).
- Канон **Telegram Auto-Grant Single Path** (memory): grant идёт только через `grant-access-for-order → telegram-grant-access`. Для продукта консультации TG-доступ не выдаётся бизнес-правилом — корректный skip.

**Verdict:** PASS (skip без ошибок).

---

## 13. Document Routing — PASS (skip by business rule)

Для order `58785062…`:
- `ai_generated_documents` не имеет `order_id` напрямую; сценарии документов привязаны через `tariff_offers.meta.document_scenarios[]` (memory Document Scenarios SOT).
- Sandbox-manual order не имеет `offer_id` → нет `document_scenarios` → корректный skip.
- Канон `purchaseDocumentRules` (memory): провайдер `admin_test`/`virtual` в denylist — документы не формируются для sandbox-flow.

**Verdict:** PASS (skip без ошибок).

---

## Master Sprint Alignment Check

| Фаза | Статус | Комментарий |
|---|---|---|
| **Фаза 0 — Discovery** | ✅ Выполнено | D10 multi-account, D9, capabilities/object mapping, business_stream, payment_provider_profiles — все артефакты есть в `.lovable/discovery/`. |
| **Фаза 1 — Foundations** | ✅ Выполнено | `acquiring_connections` + `provider_events` + RPCs `get_acquiring_secret`/`admin_save_acquiring_secret`/`admin_delete_acquiring_secrets`, Vault, self-service UI — см. `stripe_phase_2_execute.md`. |
| **Фаза 2 — Acquiring Activation** | ⚠️ **Частично выполнено** | MP-A2-1 (resolvers/URLs/business_stream) + MP-A2-2 (Customer resolver) + MP-A2-2R (runtime PASS S1/S4/S5/S6/S7) — закрыты. **PRR гейт: 11/13 PASS** — Фаза 2 формально не закрыта до закрытия F-PRR-09 и F-PRR-11. |
| **Фаза 3 — Subscriptions / Schedules** | ⛔ Не начато | Нельзя стартовать до 13/13 PASS (STOP-GATE). |
| **Фазы 4–10** | ⛔ Не начато | Зависят от Фазы 3. |

**Выход за scope:** не зафиксирован.
**Риск регрессии bePaid:** низкий — denylist verifier exit=1, `payment_links`=107 (стабильно).
**Попытка преждевременного перехода к Фазам 4–10:** нет.

**Итог:**
- Выполнено: Фазы 0, 1.
- Частично выполнено: Фаза 2 (MP-A2-1 / MP-A2-2 / MP-A2-2R закрыты, PRR не закрыт).
- Не выполнено: Фазы 3–10.
- Backlog: `stripe_saved_pm_followup.md` (Customer Portal / Embedded Payment Element).
- **Blockers:** F-PRR-09, F-PRR-11 (см. mini-plans).

---

## Mini-plans (требуются перед Stage C)

### MP-A2-PRR-09 — E2E metadata enrichment & verification

**Цель:** обеспечить, чтобы для каждого Stripe-заказа `account_code` и `business_stream` (не `'default'`) присутствовали на верхнем уровне `orders_v2.meta` и `payments_v2.meta`, а также в `metadata` Stripe Checkout Session.

**Скоуп (read+write, mini):**
1. На стороне `stripe-create-checkout` / `stripe-admin-sandbox-checkout` — после успешного создания сессии записывать `account_code`, `business_stream` в `orders_v2.meta` (merge).
2. На стороне `stripe-webhook` (charge.succeeded / checkout.session.completed) — записывать `account_code`, `business_stream`, `user_id`, `product_id`, `tariff_id`, `offer_id` в `payments_v2.meta` (merge).
3. Runtime smoke: 1 реальный sandbox checkout через тест-карту 4242 (НЕ через `simulate_paid` shortcut), полный трейс orders_v2 → payments_v2 → provider_events → Stripe Checkout Session metadata.
4. Proof: `.lovable/proofs/mp_a2_prr_09_metadata_trace_v1.md`.

**Запрещено:** менять resolver/adapter, трогать bePaid, live mode.

### MP-A2-PRR-11 — CRM routing for Stripe orders

**Цель:** подтвердить, что Stripe-заказ привязанного к продукту «Платная консультация» корректно проходит CRM-маршрутизацию (контакт → deal → pipeline-binding), без orphan-контактов/сделок.

**Скоуп (read-only diagnose + targeted fix):**
1. Diagnose: проверить, что product «Платная консультация» имеет `crm_routing` на активном `pay_now` offer (per memory **Product → Pipeline Mapping Canon**).
2. Если отсутствует — добавить `crm_routing` записью в БД через миграцию (mini, 1 строка).
3. Runtime smoke: 1 sandbox-paid stripe order с реальным `product_id`/`tariff_id`/`offer_id` консультации → проверить, что в CRM появляется deal в правильном pipeline.
4. Proof: `.lovable/proofs/mp_a2_prr_11_crm_routing_v1.md`.

**Запрещено:** менять resolver/adapter, трогать bePaid, live mode, создавать новые pipelines.

---

## DoD review

| # | Пункт | Статус |
|---|---|---|
| 1 | Создан proof-файл с 13 секциями | ✅ |
| 2 | По каждой секции — read-only артефакты (rg/SQL/ссылки) | ✅ |
| 3 | Итоговый вердикт явный | ✅ (11/13 PASS, STOP-GATE) |
| 4 | Никаких изменений вне `.lovable/proofs/` | ✅ |
| 5 | bePaid не затронут (verifier exit=1) | ✅ |
| 6 | `acquiring_connections.test_mode=true` для активных stripe | ✅ |
| 7 | Master Sprint Alignment Check | ✅ |
| 8 | STOP-GATE зафиксирован | ✅ |
