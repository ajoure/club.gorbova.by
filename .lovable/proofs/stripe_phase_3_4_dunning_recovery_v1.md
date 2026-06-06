# Phase 3.4 — Stripe Dunning + Recovery (proof v1)

Дата: 2026-06-06. Окружение: Stripe test mode (`stripe_poland`). Базируется на discovery `.lovable/discovery/stripe_dunning_inventory_v1.md`.

## Сводка по гейтам

| Гейт | Что | Статус |
|---|---|---|
| B  | Failure snapshot в meta.stripe + audit | **PASS (код)** |
| F  | Recovery snapshot при invoice.paid | **PASS (код)** |
| G  | Repeated failure cooldown (по invoice_id) | **PASS (код)** |
| H  | Final-failure marker в onSubscriptionUpdated | **PASS (код)** |
| Stage C (Cabinet CTA) | Recovery CTA «Обновить карту для оплаты» в `SubscriptionDetailSheet` | **PASS** |
| Stage D (Email) | Шаблон НЕ создан (нет email-инфры) → audit-only fallback | **DEFERRED → backlog** |
| Stage E (Admin tab) | Отдельная вкладка past_due → backlog (нет существующей Stripe-вкладки) | **DEFERRED → backlog** |
| G33 | runtime invoice.payment_failed на тест-подписке | **PENDING runtime** |
| G34 | уведомление / audit fallback | **PASS (audit)**, email runtime → backlog |
| G35 | recovery link создаётся | **PASS (код Phase 3.3)** |
| G36 | admin past_due UI | **DEFERRED → backlog** |
| G37 | invoice.paid после failed | **PENDING runtime** |
| G38 | replay-идемпотентность | **PENDING runtime** |
| G39 | access freeze во время grace | **PENDING runtime** |
| G40 | bePaid freeze | **PENDING runtime** |

## Изменения кода

### B/G — `_shared/stripe-subscription-resolver.ts` :: `onInvoicePaymentFailed`
Add-only расширение:
- Извлекаем `attempt_count`, `next_payment_attempt` (ISO), `payment_intent_id`, `last_failure_reason` из invoice.
- Merge в `subscriptions_v2.meta.stripe` и `provider_subscriptions.meta.stripe`:
  ```
  last_payment_failed_at, last_failed_invoice_id, last_failed_payment_intent_id,
  last_failure_reason, attempt_count, next_payment_attempt,
  dunning_status: 'past_due_grace'
  ```
- `isFirstFailureForInvoice = prev.last_failed_invoice_id !== invoice_id`:
  - первая → audit `stripe.dunning.payment_failed` + audit `stripe.dunning.notification_skipped_no_email` (с `idempotency_key=stripe-dunning-<invoice_id>`, `backlog_ref`);
  - повторная → audit `stripe.dunning.retry_failed`, нотификация НЕ дублируется (cooldown по invoice_id).
- Legacy audit `stripe.invoice.payment_failed.grace` оставлен для read-side инструментов.
- Access НЕ отзывается; `orders_v2`/`payments_v2` НЕ создаются.

### F — `onInvoicePaid` recovery
Add-only блок прямо перед финальным audit `stripe.invoice.paid.activated`:
- читаем `prev.dunning_status` из локально загруженного `subv2.meta.stripe` (до обновлений);
- если `wasInDunning = (prev === 'past_due_grace')`:
  - re-read `subscriptions_v2.meta` и `provider_subscriptions.meta` (чтобы не затереть activation-обновления);
  - merge recovery patch: `dunning_status='recovered'`, `recovered_at`, `recovered_invoice_id`; активные failure-поля очищены; snapshot уезжает в `previous_failure`;
  - audit `stripe.dunning.recovered`.
- Финальный audit `stripe.invoice.paid.activated` теперь содержит `recovered_from_dunning`.

### H — `onSubscriptionUpdated` final marker
Add-only после Portal-deltas:
- если `prev.dunning_status === 'past_due_grace'` И новый `stripe.status` ∈ {`unpaid`, `canceled`}:
  - merge `dunning_status='final_failure'` или `'canceled_after_dunning'`, `dunning_final_at`;
  - audit `stripe.dunning.final_failure` / `stripe.dunning.canceled_after_dunning` с `manual_review=true`, `access_revoke_deferred_to_phase_3_5=true`;
  - access НЕ отзывается.

### Cabinet UI
- `src/components/purchases/StripePortalButton.tsx`: prop `mode?: 'manage' | 'recovery'`. Лейблы: «Управлять подпиской» (default) / «Обновить карту для оплаты» (recovery, иконка CreditCard, variant=default).
- `src/components/purchases/SubscriptionDetailSheet.tsx`:
  - дополнительный fetch `subscriptions_v2.meta` для `dunning_status / next_payment_attempt / attempt_count`;
  - баннер «Платёж не прошёл / Доступ пока сохранён / Следующая попытка оплаты: <дата>» при `dunning_status === 'past_due_grace'`;
  - `StripePortalButton` переключается на `mode="recovery"` в grace.

## UI Language Sweep

Проверены и приведены к русским формулировкам:

| Файл | Было | Стало |
|---|---|---|
| `StripePortalButton.tsx` | (новый prop) | «Управлять подпиской» / «Обновить карту для оплаты» |
| `SubscriptionDetailSheet.tsx` | (новый блок) | «Платёж не прошёл», «Доступ пока сохранён», «Следующая попытка оплаты» |
| `StripeSubscriptionActionsBlock.tsx` | «Stripe: отмена в конце периода поставлена» | «Подписка отменяется в конце периода» |
| `StripeSubscriptionActionsBlock.tsx` | «Stripe: подписка отменена» | «Подписка отменена» |
| `StripeSubscriptionActionsBlock.tsx` | «Stripe: управление подпиской» | «Управление подпиской» |
| `StripeSubscriptionActionsBlock.tsx` | «Действие будет отражено в Stripe.» / «cancel_at_period_end=true» / «status=canceled» | «у платёжного провайдера» / понятные RU формулировки |

Поиск `rg "Customer Portal|Dunning|Past Due|Retry Payment|Failed Payment|Recovery|Portal Link"` по `src/`:
- В видимом UI не осталось этих англоязычных терминов (срабатывания в `src/pages/Auth.tsx` относятся к auth password-recovery flow и не имеют отношения к Stripe).

Лейблы статусов подписок (`src/lib/subscriptionStatusLabels.ts`) — уже на русском (`past_due → «Ожидает оплаты»`, `unpaid → «Не оплачена»` и т.д.), правок не требуется.

Email-шаблоны и admin past_due-вкладка не созданы (см. backlog) — sweep к ним применится при PATCH.

## Stop-gates: соблюдены
- bePaid не редактировался;
- `grant-access-for-order` не менялся;
- `stripe-webhook/index.ts` не переписывался (только `_shared/stripe-subscription-resolver.ts` add-only);
- access (`entitlements`, `access_rules`, `telegram_access`) не трогаем;
- raw card data / собственные формы карты — нет;
- helper edge functions для триггера событий — нет;
- новых таблиц — нет.

## Backlog
- `.lovable/backlog/stripe_dunning_email_template.md` — Stage D полный (setup email infra + scaffold + шаблон + integration).
- `.lovable/backlog/stripe_dunning_admin_tab.md` — Stage E (фильтр past_due + admin-portal-link).

## Что осталось для FULL PASS
1. Runtime в Stripe test mode на реальной тестовой подписке:
   - симулировать `invoice.payment_failed` (failed retry через Stripe Dashboard `Retry payment` с картой `4000000000000341` или test clock fallback);
   - проверить SQL: `subv2.meta.stripe.dunning_status='past_due_grace'`, `provider_subscriptions.state='past_due'`, новые поля заполнены;
   - audit: `stripe.dunning.payment_failed` + `stripe.dunning.notification_skipped_no_email`;
   - Δ=0 по `entitlements`, `access_rules`, `telegram_access`, `bepaid_*`.
2. Replay того же `evt_*` через Stripe Dashboard → проверить, что `provider_events` reuse (idem unique), нет дублей audit (cooldown по invoice_id → второй прогон должен дать `stripe.dunning.retry_failed`, нотификации нет).
3. Сменить тестовую карту в Customer Portal на `4242`, нажать `Retry payment` → `invoice.paid` → проверить `dunning_status='recovered'`, `previous_failure` snapshot, audit `stripe.dunning.recovered`, единый `orders_v2`/`payments_v2`, entitlements продлены через канонический grant.
4. Replay `invoice.paid` → второй вызов короткозамыкает на `stripe.invoice.paid.duplicate` (существующий guard).
5. Smoke webhook: `OPTIONS=200`, `POST` без подписи = `400 signature_verification_failed` (не 401).
6. Зафиксировать в этом proof: SQL before/after, `event_id`, `invoice_id`, `subscription_v2_id`, ссылки на audit-rows; перевести Phase 3.4 в FULL PASS в `.lovable/plan.md`.
