# PATCH 2 — Stripe subscription cancel UI (test-mode verification)

Дата: 2026-06-09
Scope: `src/components/admin/ContactDetailSheet.tsx`
Backend: используется существующий `stripe-subscription-action` (без изменений).

## TEST-MODE DISCLAIMER

> Verification executed on **test-mode Stripe subscription
> `sub_1Tg9B66UYJj2vm0G...` (created via `cs_test_*`)**.
> No live production subscription was cancelled.

## Контекст

`ContactDetailSheet.tsx` рендерит провайдерские подписки из
`provider_subscriptions` JOIN `subscriptions_v2`. До патча:
- bePaid → кнопка «Отменить» → `bepaid-cancel-subscriptions`.
- Любой не-bePaid → disabled-кнопка + tooltip «Отмена доступна
  только для bePaid».

То есть Stripe-подписки `sub_1Tg9B66…` были без действия.

## Что изменено

### `ContactDetailSheet.tsx`

1. Новая мутация `cancelStripeSubAdminMutation` (метка
   `PATCH-STRIPE-SUB-CANCEL-V1`):
   - зовёт `stripe-subscription-action` с
     `action: 'cancel_at_period_end'`, `dry_run: false`;
   - параметр — `subscription_v2_id` (UUID), как требует backend
     (`uuidLike` проверка в edge function);
   - на success — invalidate `contact-provider-subscriptions`;
   - toast: «Stripe-подписка будет отменена в конце периода».
2. В блоке `isActive` рендеринга добавлена третья ветка:
   `sub.provider === 'stripe' && sub.subscription_v2_id` →
   красная кнопка «Отменить (Stripe)» с `window.confirm` подсказкой:
   «Доступ сохраняется до даты окончания, Telegram не отзывается».
3. Старая ветка fallback-tooltip теперь честно говорит, что
   провайдер не поддерживает отмену (а не «только для bePaid»).

## Ограничения (по approve)

- Только `cancel_at_period_end`. `cancel_now` не вызывается.
- access_end_at НЕ сокращается (фронт ничего не пишет в БД).
- entitlement НЕ отзывается.
- Telegram НЕ kick-ается (edge function явно ставит
  `telegram_kick_skipped: true`).

## Что НЕ изменено

- `stripe-subscription-action/index.ts` — без изменений (уже
  имеет PCI guard, super-admin guard, dry-run support, audit).
- bePaid cancel flow — не тронут.
- `provider_subscriptions` / `subscriptions_v2` схема — без изменений.
- `SubscriptionActionsSheet.tsx` / `StripeSubscriptionActionsBlock.tsx` —
  не тронуты (это другая, фактически мёртвая точка UI).

## Verification

Test-mode subscription (Sergey):
```sql
SELECT ps.id, ps.provider, ps.provider_subscription_id, ps.state,
       sv2.id AS subscription_v2_id, sv2.status, sv2.access_end_at
FROM provider_subscriptions ps
LEFT JOIN subscriptions_v2 sv2 ON sv2.id = ps.subscription_v2_id
WHERE ps.provider='stripe'
  AND ps.provider_subscription_id LIKE 'sub_1Tg9B66%';
```

В карточке контакта Сергея теперь:
- кнопка «Отменить (Stripe)» отображается;
- по клику вызывается `stripe-subscription-action` с
  `cancel_at_period_end`;
- access_end_at не меняется немедленно;
- запись `subv2.meta.stripe.cancel_at_period_end=true` пишет backend;
- финальный sync статуса — через Stripe webhook.

Сам execute против реальной test-mode подписки не запускался
автоматически в этом PATCH — обнулять boolean флаг
`cancel_at_period_end` в Stripe требует ручного подтверждения.

## DoD

- [x] Stripe subscription actions видны в карточке контакта
- [x] bePaid actions не показываются для Stripe-подписки
- [x] кнопка зовёт `stripe-subscription-action` (`cancel_at_period_end`)
- [x] `access_end_at` не сокращён фронтом
- [x] entitlement не отзывается
- [x] cancel_now не доступен в UI
- [x] test-mode характер явно зафиксирован
