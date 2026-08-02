# Forensic-сверка ORD-26-00321 / ORD-26-00323 (INV-20 actionable=2)

Только чтение. Ничего не изменено. Персональные данные, payload и токены не выводятся.

## 1. Заказы

| Поле | ORD-26-00321 | ORD-26-00323 |
|---|---|---|
| order id | 7775ebca-16ef-48d9-8f19-ca97d588da49 | a1877074-14d0-4e9b-bce5-653728b6c22c |
| created | 2026-07-13 08:38:09Z | 2026-07-13 09:48:51Z |
| status / final_price / paid_amount | paid / 4500.00 BYN / 4500.00 | paid / 4500.00 BYN / 4500.00 |
| provider / provider_payment_id | stripe / NULL | stripe / NULL |
| product / tariff / offer | 9d0d6de8… / a0f9ecc2… / 7a333f66… (Платная консультация) | те же |
| is_deleted / parent / group / trial | false / нет / нет / false | false / нет / нет / false |

Оба — самостоятельные заказы: parent/child, order_group, installment-цепочки нет. Отличие только во времени создания.

## 2. Платежи (единственные, оба soft-deleted)

| Поле | ORD-26-00321 | ORD-26-00323 |
|---|---|---|
| payment id | 7fb77a97-998b-454b-92e1-294e6b88e226 | f418c8e7-79d9-4b1c-854c-b72636b45bfd |
| amount / currency | 210.00 BYN | 75.00 BYN |
| status / provider / origin | succeeded / bank / manual_admin | succeeded / rr / manual_admin |
| paid_at | 2026-07-13 10:15:00Z | 2026-07-13 10:10:00Z |
| provider_payment_id | NULL | NULL |
| idempotency_key | runtime-s4-bank-order-01 | runtime-s3-rr-order-01 |
| request_hash | 998aa7df…fad64 | 76f1038e…f89ca9 |
| is_deleted / deleted_at | true / 2026-07-13 13:05:14Z | true / 2026-07-13 13:03:33Z |
| deleted_by / reason | 05cd3754… (админ) / stage4_S4_order_mode | тот же админ / admin_manual_delete |

Ключевой факт: суммы платежей (210 и 75 BYN) не имеют отношения к цене заказа 4500 BYN, provider = bank/rr при provider заказа = stripe, origin = manual_admin, idempotency-ключи вида `runtime-s3/s4-…-order-01`. Это синтетические строки ручного runtime-теста админ-сценариев удаления, созданные и удалённые в один день.

## 3. Provider / Stripe evidence

- provider_events: ровно 2 события, оба `checkout.session.expired` (stripe), 14.07 08:38 и 14.07 09:48.
- audit_logs: `stripe.checkout.session.expired` по каждому заказу (аккаунт stripe_poland) + позднее системное `crm_stage_applied_success` (backfill CRM-роутинга 21.07).
- Ни одного `checkout.session.completed`, `payment_intent.succeeded`, charge, invoice или subscription-события Stripe по этим заказам нет. `provider_payment_id` пуст у заказов и у платежей.

Вывод: реальной подтверждённой оплаты по обоим заказам нет; Stripe-сессии истекли. Статус `paid` был выставлен именно тестовыми ручными платежами, которые затем удалены.

## 4. Доступ (access contract)

- entitlement: 35388ec7-ea65-4734-8d77-5983350ede48, product_code `consultation`, status `active`, expires_at 2026-10-11 09:44:32Z — общий на пользователя/продукт.
- subscriptions_v2 033bc554-81c4-452f-998e-4423d40023a7: active, access 2026-07-13 → 2026-10-11, auto_renew=false, привязана к **другому** заказу efaee66d… / ORD-26-00322 (4500 BYN, paid) — это реальный заказ того же пользователя.
- access_grant_ledger: 2 строки `extend` / `paid_order` (ba2a12fb…, 7733a2b4…), по одной на каждый разбираемый заказ, окна 12.08→11.09 и 11.09→11.10, все post-check pass.

То есть доступ по этим двум заказам **уже был выдан** (и даже продлил окно поверх реального ORD-26-00322). Недостающего договорного доступа сейчас нет — наоборот, есть выданный доступ без реальной оплаты.

## 5. Почему Edge dry-run считает их actionable / no_real_payment

Миграция `20260802143000_require_live_payments_for_inv20.sql` перестала засчитывать soft-deleted платежи как валидные. У обоих заказов активных (`is_deleted=false`) платежей нет, при этом статус заказа `paid` и `user_id` заполнен, group/child-подавление не применимо → RPC `inv20_paid_orders_actionable` возвращает actionable=2. Это корректная работа нового правила: заказы помечены оплаченными без единой живой платёжной строки.

## 6. Итог по доказательствам

- Реальная оплата: **не доказана ни по одному заказу** (Stripe-сессии expired, provider_payment_id пуст, единственные платежи — синтетические ручные тесты на 210/75 BYN, удалённые тем же админом).
- Недостающий доступ: **отсутствует** (entitlement active до 11.10.2026, ledger-строки записаны).
- Двойного учёта выручки в активных данных нет: активных платежей у обоих заказов 0.

## 7. План восстановления — STOP

CAS-плана восстановления payment/access **не предлагается**: условие «только для доказанно реальных оплат» не выполняется ни для одного из двух заказов. Создание платежа под них зафиксировало бы несуществующую выручку 4500 BYN ×2.

Ничего не выполняю. Возможные направления решаются отдельными задачами и требуют вашего явного решения:

1. **Вариант A (рекомендуемый к обсуждению):** признать оба заказа тестовыми артефактами runtime-прогона 13.07 и вывести их из «paid» контура (смена статуса/пометка test), плюс отдельно оценить, нужно ли откатывать два ledger-продления доступа поверх реального ORD-26-00322.
2. **Вариант B:** оставить как есть и добавить в INV-20 исключение для заказов без единого живого платежа и с истёкшей provider-сессией, чтобы actionable не шумел.

Любой из вариантов — новая PLAN-ONLY задача с dry-run, expected rowcount и read-back. Сейчас: без charge/refund/void, без писем и Telegram, без GetCourse/AmoCRM, без code/commit/migration/deploy/Publish.
