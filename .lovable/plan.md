# План: слияние duplicate active subscription у user 09f6350e… (каноническая — A)

PLAN-ONLY. Ничего не выполнено. Внешняя bePaid-подписка `sbs_f571136fb88d9dbe` не отменяется и не изменяется; charge/refund/void нет.

## 1. Выбранная модель

- Каноническая: **A** `subscriptions_v2` `6afe0bbf-7383-4f9d-8f23-2293a711a435` (единственная с живой provider-привязкой, auto_renew=true, next charge 2026-08-18).
- Сливается: **B** `d6e8229d-3c90-490a-b15e-e132877d9f31` → статус `superseded` (допустимый терминальный статус enum `subscription_status`), provider link B `23b6212b…` (`sbs_ae48bd1a879ba170`, state=canceled) остаётся исторически как есть.
- Effective access сохраняется ровно до текущего entitlement **2026-08-20 12:00**; entitlement `7a5143f0-8124-44de-ada0-6fc6e663e499` не пересоздаётся, срок не сокращается, `order_id=bc22b0a3…` (provenance последнего оплаченного ордера) **не меняется**.

## 2. Preflight (STOP при любом расхождении)

1. A: `id=6afe0bbf…`, `user_id=09f6350e-12da-4478-96d2-d67e247296f3`, `product_id=11c9f1b8-0355-4753-bd74-40b42aa53616`, `tariff_id=b276d8a5-8e5f-4876-9f99-36f818722d6c`, `status='active'`, `auto_renew=true`, `access_end_at=2026-08-18 20:59:59+00`, `next_charge_at=2026-08-18 20:59:59+00`, `order_id=018cda34-1aa6-460a-beb7-4d30d18d895f`.
2. B: `id=d6e8229d…`, тот же user/product/tariff, `status='active'`, `auto_renew=false`, `access_end_at=2026-08-19 20:59:59+00`, `next_charge_at IS NULL`, `order_id=bc22b0a3-d39d-4fc5-b644-f3c1c9de1fcf`.
3. Provider links: `2cead8e4-b680-4a69-9f34-20956618d340` → `subscription_v2_id=6afe0bbf…`, `provider_subscription_id='sbs_f571136fb88d9dbe'`, `state='active'`, `next_charge_at=2026-08-18 16:45+00`; `23b6212b-743f-4727-af0a-18adf2350735` → `subscription_v2_id=d6e8229d…`, `state='canceled'`. Другого `state in ('active','pending')` линка у пользователя по этому продукту нет.
4. Entitlement: ровно 1 active club-entitlement `7a5143f0…`, `expires_at=2026-08-20 12:00+00`, `order_id=bc22b0a3…`.
5. Активных подписок (user, product) ровно 2 — A и B; иных `active/trial/past_due` нет.
6. Живые платежи не трогаются: по `018cda34…` 1 succeeded + 4 failed, по `bc22b0a3…` 1 succeeded `57975365…`; ни один не изменяется.

Любое несовпадение → STOP без изменений.

## 3. CAS-шаги (2 UPDATE, каждый expected rowcount = 1)

**Шаг 3.1 — B → superseded**
```
UPDATE subscriptions_v2
SET status='superseded',
    auto_renew=false,
    next_charge_at=NULL,
    meta = meta
      || jsonb_build_object(
           'superseded_at', now(),
           'superseded_by_subscription_id','6afe0bbf-7383-4f9d-8f23-2293a711a435',
           'merge_reason','duplicate_active_same_product_provider_canonical_A',
           'merge_prev_status','active',
           'merge_prev_access_end_at', access_end_at,
           'preserved_paid_order_id','bc22b0a3-d39d-4fc5-b644-f3c1c9de1fcf'),
    updated_at=now()
WHERE id='d6e8229d-3c90-490a-b15e-e132877d9f31'
  AND user_id='09f6350e-12da-4478-96d2-d67e247296f3'
  AND product_id='11c9f1b8-0355-4753-bd74-40b42aa53616'
  AND tariff_id='b276d8a5-8e5f-4876-9f99-36f818722d6c'
  AND status='active'
  AND auto_renew=false
  AND next_charge_at IS NULL
  AND access_end_at='2026-08-19 20:59:59+00'
  AND order_id='bc22b0a3-d39d-4fc5-b644-f3c1c9de1fcf';
```
`access_start_at`, `access_end_at`, `order_id`, `product_id`, `tariff_id` B не изменяются (provenance сохраняется).

**Шаг 3.2 — A принимает объединённое окно доступа**
```
UPDATE subscriptions_v2
SET access_end_at='2026-08-20 12:00:00+00',
    meta = meta
      || jsonb_build_object(
           'merged_from_subscription_id','d6e8229d-3c90-490a-b15e-e132877d9f31',
           'merged_from_order_id','bc22b0a3-d39d-4fc5-b644-f3c1c9de1fcf',
           'merged_at', now(),
           'merge_prev_access_end_at', access_end_at,
           'merge_reason','duplicate_active_same_product_provider_canonical_A'),
    updated_at=now()
WHERE id='6afe0bbf-7383-4f9d-8f23-2293a711a435'
  AND user_id='09f6350e-12da-4478-96d2-d67e247296f3'
  AND product_id='11c9f1b8-0355-4753-bd74-40b42aa53616'
  AND status='active'
  AND auto_renew=true
  AND access_end_at='2026-08-18 20:59:59+00'
  AND next_charge_at='2026-08-18 20:59:59+00';
```
`status`, `auto_renew=true`, `next_charge_at=2026-08-18 20:59:59`, `order_id` A не меняются. Окно только выравнивается до текущего entitlement (2026-08-20 12:00) — сокращения доступа нет.
Ключ `meta.replaced_by_order` у A трогать не нужно для функционирования; он остаётся как исторический след и дополняется полем `merged_from_order_id`. Если пункт 3.2 даст rowcount ≠ 1 — STOP и откат 3.1.

**Шаг 3.3 — audit**
Одна запись в `audit_logs` (действие merge_duplicate_subscription) с before/after обоих subscription-строк, обоими provider-link ID и их неизменёнными state, entitlement ID/expires_at, списком «не изменено»: payments, orders, entitlements, provider links, revenue.

## 4. Обратный CAS (rollback)

```
UPDATE subscriptions_v2 SET access_end_at='2026-08-18 20:59:59+00'
 WHERE id='6afe0bbf…' AND access_end_at='2026-08-20 12:00:00+00';   -- rowcount 1
UPDATE subscriptions_v2 SET status='active'
 WHERE id='d6e8229d…' AND status='superseded';                       -- rowcount 1
```
Плюс удаление добавленных merge-ключей из `meta` и запись отката в `audit_logs`. Строки не удаляются, ничего не пересоздаётся.

## 5. Read-back (все PASS обязательны)

1. active subscriptions (user `09f6350e…`, product `11c9f1b8…`) = **1**, и это A `6afe0bbf…`.
2. B `d6e8229d…` = `superseded`, `order_id` и окно исторические, не NULL.
3. Provider links unchanged: `2cead8e4…` state=`active`, next_charge 2026-08-18 16:45, `subscription_v2_id=6afe0bbf…`; `23b6212b…` state=`canceled`.
4. Entitlement: ровно 1 active, `7a5143f0…`, `expires_at=2026-08-20 12:00`, `order_id=bc22b0a3…` — без изменений.
5. A: `auto_renew=true`, `next_charge_at=2026-08-18 20:59:59`, `access_end_at=2026-08-20 12:00`.
6. Payments/orders/revenue пользователя unchanged (счётчики и суммы до/после совпадают), entitlement/subscription/payment/order новых строк не создано.
7. missing active contractual access = 0; INV-20 actionable = 0; INV-25 processing > 2ч = 0.
8. Сообщений (Telegram/email/GetCourse/AmoCRM) не отправлено; code/commit/migration/deploy/Publish не выполнялись.

## 6. Отдельный read-only тест renewal contract (после merge, без мутаций)

- Проверить, что для `provider_subscription_id='sbs_f571136fb88d9dbe'` существует ровно один линк и он ведёт в подписку со статусом `active` того же user/product → guard PR #257 разрешает обработку.
- Проверить по логике `decideProviderSubscriptionLinkRepair`: цель линка не в `superseded/canceled/expired`, значит следующий реальный rebill-webhook 18.08 не даст `provider_linkage_conflict` и `bepaid_subscription_mismatch`.
- Проверить отсутствие второго `active/pending` provider-линка у пользователя по продукту → риск двойного будущего списания = 0 (B у провайдера canceled).
- Результат оформляется как таблица PASS/FAIL; при FAIL — STOP и диагноз, без исправлений.

## 7. Вне scope

Отмена/изменение bePaid-подписки, charge/refund/void, создание subscriptions/payments/orders/entitlements, изменение entitlement.order_id и срока, сообщения пользователю, код, миграции, деплой, Publish, любые другие пользователи и задачи.
