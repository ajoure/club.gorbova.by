# Phase 3.4 — Stripe Dunning Inventory (v1)

Read-only discovery. Код не менялся на этом этапе.

## 1. Текущая обработка `invoice.payment_failed`
`supabase/functions/_shared/stripe-subscription-resolver.ts` → `onInvoicePaymentFailed` (стр. 963-1025).
Что делает сейчас:
- ищет `ps = findSubByStripeId(stripeSubId)`; если нет → `manual_review`;
- если `subv2.status === 'active'` → `subscriptions_v2.status='past_due'`;
- если `ps.state === 'active'` → `provider_subscriptions.state='past_due'`;
- audit `stripe.invoice.payment_failed.grace` с `invoice_id`, `attempt_count`, `next_payment_attempt`;
- доступ не отзывается, `orders_v2`/`payments_v2` не создаются.

Чего НЕ хватает (Phase 3.4 B/G):
- snapshot причины (`last_failure_reason`, `payment_intent_id`) в `subscriptions_v2.meta.stripe` и `provider_subscriptions.meta.stripe`;
- маркер жизненного цикла `dunning_status`;
- различение первой/повторной неудачи (cooldown для нотификации);
- отдельный audit-action для повторных попыток.

## 2. Текущая обработка `invoice.paid`
`onInvoicePaid` (стр. 571-958). Полностью покрывает activation/renewal:
- idempotency через `meta.stripe.invoice_id` в `orders_v2` (стр. 607-624);
- race-resolver subv2 (стр. 627-723);
- materialize `orders_v2` (`paid`) + `payments_v2` + invoke `grant-access-for-order`;
- promote `ps.state` `pending|past_due → active`, `subv2.status pending → active`.

Чего НЕ хватает (Phase 3.4 F):
- маркер `dunning_status='recovered'` + `recovered_at/recovered_invoice_id`;
- snapshot предыдущей failure (`previous_failure`);
- отдельный audit `stripe.dunning.recovered`.

Идемпотентность recovery уже встроена (existing-order short-circuit) — отдельных guards не требуется.

## 3. `customer.subscription.updated` (для Stage H)
`onSubscriptionUpdated` (стр. 338-494) полностью синхронизирует meta + статус.
Маппинг (стр. 71-83): `unpaid → past_due`, `canceled → canceled` (с `cancel_reason='stripe_subscription_status_canceled'`).
Чего НЕ хватает:
- финальный маркер `dunning_status='final_failure'` (для `unpaid` после grace) и `'canceled_after_dunning'` (для `canceled` после grace);
- отдельные audit `stripe.dunning.final_failure` / `stripe.dunning.canceled_after_dunning`.

Access revoke в Phase 3.4 НЕ добавляем — он вынесен в Phase 3.5.

## 4. Где хранится `past_due`
- `subscriptions_v2.status` (canonical enum), значение `'past_due'`;
- `provider_subscriptions.state` (`'past_due'`);
- `subscriptions_v2.meta.stripe.status` хранит сырое `stripe.status` (`'past_due'` / `'unpaid'`);
- маркера `dunning_status` сейчас НЕТ — будет добавлен в Stage B.

## 5. Текущая форма `subscriptions_v2.meta.stripe`
Поля, которые уже пишутся резолвером:
```
{
  account_code, subscription_id, customer_id,
  current_period_start, current_period_end,
  cancel_at_period_end, cancel_at,
  default_payment_method, collection_method,
  status
}
```
`provider_subscriptions.meta.stripe` — те же поля + `last_invoice_id`, `deleted_at`, `activated_by_invoice_paid`.

Phase 3.4 add-only поля:
```
last_payment_failed_at, last_failed_invoice_id,
last_failed_payment_intent_id, last_failure_reason,
attempt_count, next_payment_attempt,
dunning_status: 'past_due_grace' | 'recovered' | 'final_failure' | 'canceled_after_dunning',
recovered_at, recovered_invoice_id,
previous_failure: { ...snapshot предыдущей failure }
```

## 6. Email/notification инфраструктура
`rg -l "send-transactional-email|enqueue_email" supabase/functions/` → **0 совпадений**.
- Отсутствует функция `send-transactional-email`.
- Отсутствует директория `_shared/transactional-email-templates/`.
- Нет RPC `enqueue_email`, нет таблиц `email_send_log`, `suppressed_emails`, `email_unsubscribe_tokens`.

Имеющееся: `send-email` (custom), `auth-email-hook` (custom). Это НЕ канонический Lovable-стек app emails.

**Вывод для Stage D:** Phase 3.4 пишет audit-only (`stripe.dunning.notification_skipped_no_email`) для всех уведомлений. Включение шаблона `stripe-payment-failed` вынесено в backlog `.lovable/backlog/stripe_dunning_email_template.md` — требует отдельного PATCH с `email_domain--setup_email_infra` + `scaffold_transactional_email`.

## 7. Админ UI Stripe-подписок (Stage E)
`ls src/components/admin/payments/` → есть `BepaidSubscriptionsList`, `BepaidSubscriptionsTabContent`, `AutoRenewalsTabContent`. Отдельной Stripe-вкладки сейчас нет.
`StripeSubscriptionActionsBlock` (admin) — только cancel-кнопки внутри карточки подписки, без листинга.

**Вывод для Stage E:** отдельный листинг «Проблема с оплатой» вынесен в backlog `.lovable/backlog/stripe_dunning_admin_tab.md`. В Phase 3.4 минимум — `dunning_status` пишется в `subv2.meta.stripe`, что позволяет существующим админ-инструментам (`Inv22ResolverPanel`, ручной запрос к `subscriptions_v2`) видеть когорту через JSON-фильтр.

`Создать Portal link для клиента` от лица админа — отдельный PATCH: текущий `stripe-create-customer-portal-session` проверяет ownership (`subscription.user_id = auth.uid()`), и обход guard'а в текущем спринте не делаем.

## 8. CRM stage-механика для failed payment
В Phase 3.4 CRM-stage trigger при failed НЕ создаётся (плановое решение: `crm_stage_failed_skipped: true` уже логируется существующим audit'ом).

## 9. Audit-actions, уже используемые для Stripe portal/subscription
- `stripe.subscription.created.bound|already_bound|no_pre_created_sub|foreign_account|zombie_pending|subv2_missing`
- `stripe.subscription.updated.synced|unknown_sub|subv2_missing|foreign_account`
- `stripe.subscription.deleted.canceled|unknown_sub|foreign_account`
- `stripe.invoice.paid.activated|duplicate|unknown_sub|subv2_missing|foreign_account|no_subscription|order_insert_failed|grant_access_failed|payments_api_lookup_failed|rebound_pre_created_sub|race_resolved_by_concurrent_bind|rebind_pending_miss|rebind_api_lookup_failed`
- `stripe.invoice.payment_failed.grace|no_subscription|unknown_sub`
- `stripe.portal.cancel_at_period_end_enabled|disabled`, `stripe.portal.payment_method_updated`

Новые в Phase 3.4 (add-only):
- `stripe.dunning.payment_failed` (первая неудача по `invoice_id`)
- `stripe.dunning.retry_failed` (повторная попытка по тому же `invoice_id`)
- `stripe.dunning.notification_skipped_no_email`
- `stripe.dunning.recovered`
- `stripe.dunning.final_failure`
- `stripe.dunning.canceled_after_dunning`

## DoD
Discovery зафиксирован. Код не менялся. Backlog-файлы для email и admin tab созданы.
