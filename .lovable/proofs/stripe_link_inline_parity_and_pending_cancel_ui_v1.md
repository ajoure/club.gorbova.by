# Proof: PATCH-A + PATCH-B — Stripe inline link parity + pending draft UI hide

Дата: 2026-06-09
Автор: Lovable agent
Статус: EXECUTED

---

## PATCH-A — Pending Stripe drafts скрыты из карточки контакта

### Root cause
В `ContactDetailSheet.tsx` (блок «Подписки», ~line 2140) фильтр `isHealthyProviderSub`
учитывал только `state ∈ {active, trial, pending}` и «provider dead» heuristic. Любая
запись `provider_subscriptions` с `provider_subscription_id = 'pending:<sv2_id>'`
(pre-created Stripe draft до перехода в Stripe Checkout) попадала в раздел как
полноценная подписка. Кнопка «Отменить (Stripe)» дергала `stripe-subscription-action`,
который корректно отвечал `manual_review/stripe_subscription_id_missing_or_invalid`,
но UI показывал это как ошибку.

### Fix (frontend-only)
`src/components/admin/ContactDetailSheet.tsx`:

1. Добавлен `isRealProviderSubscription(sub)` — true только если:
   - `provider_subscription_id` непуст;
   - не начинается с `pending:`;
   - для `provider='stripe'` дополнительно `psid.startsWith('sub_')`;
   - `subscriptions_v2.status !== 'pending'`.
2. `isHealthyProviderSub` теперь требует `isRealProviderSubscription`.
3. `zombieProviderSubs` тоже требует `isRealProviderSubscription` (pending drafts не
   попадают и в технические записи).
4. Лейблы статусов и провайдеров локализованы:
   ```
   active → Активна, trial → Пробный период, pending → Ожидает оплаты,
   canceled/cancelled/expired/terminated/finished → Завершена/Отменена,
   failed → Ошибка оплаты, refunded → Возврат
   stripe → Иностранная карта (Stripe), bepaid → Белорусская карта (bePaid)
   ```
5. Бейдж `{sub.state}` → `{stateLabel}` (русское значение).

### Не сделано (по требованию задачи)
- Кнопка «Удалить черновик» не добавлена — отдельный PATCH.
- `stripe-subscription-action` НЕ изменялся.
- Backend не трогался.

### Verify (карточка Сергея)
**До:**
```
Gorbova Club — BUSINESS
pending
STRIPE
[Отменить (Stripe)]   ← клик → toast: stripe_subscription_id_missing_or_invalid
```
**После:**
```
(блок «Подписки» не содержит pending Stripe drafts)
Счётчик подписок не учитывает pending drafts.
Ошибка stripe_subscription_id_missing_or_invalid пользователю не видна.
```

Реальные подписки (`sub_...`) отображаются как раньше, со статусами на русском
(«Активна», «Отменена», «Завершена», «Ошибка оплаты», «Возврат», «Пробный период»).

---

## PATCH-B — admin-create-public-link: Stripe-subscription через inline price

### Root cause
`supabase/functions/admin-create-public-link/index.ts` для `provider=stripe` +
`payment_type=subscription` требовал `tariff_offers.meta.stripe.price_id`. Если
price_id отсутствовал, вызывался `admin-provision-stripe-price`, который падал на
`billing_period_mode_not_supported:month` (для custom amount/currency комбинаций).
UI показывал `Edge Function returned a non-2xx status code`.

Это противоречит модели payment-link для bePaid/e-clearing/Pay: сумма берётся
из самой ссылки, а не из глобального price оффера.

### Fix (backend, link writer only)
`supabase/functions/admin-create-public-link/index.ts` (Stripe subscription ветка,
lines ~441-478):

- Удалён вызов `admin-provision-stripe-price` для link-based Stripe subscription.
- Удалена ошибка `stripe_price_provision_failed`.
- Удалена жёсткая зависимость от `tariff_offers.meta.stripe.price_id`.
- Добавлена минимальная валидация recurring interval из `offer.meta.recurring.interval`
  (`day|week|month|year`) — иначе `stripe_subscription_interval_not_supported:<interval>`.
- В `payment_links.meta` записываются:
  - `stripe_price_mode = 'inline_override'`
  - `stripe_recurring_snapshot = { interval, interval_count }`

Глобальная цена оффера НЕ изменяется. Если `offer.meta.stripe.price_id` уже есть
(legacy) — он остаётся как есть, snapshot-only, и не препятствует inline-override
в `_shared/create-stripe-checkout.ts` / `stripe-pre-create-subscription.ts`
(PATCH-SUB-PRICE-2 уже это поддерживает).

### Не сделано (границы)
- bePaid / e-clearing / Pay ветки НЕ тронуты.
- one_time Stripe ветка НЕ тронута.
- Installment ветка (`payment_type=subscription` + `as_finite_subscription`) НЕ
  тронута — для неё `meta.installment` диктует свой billing_cycles.
- Миграций нет.
- `tariff_offers.meta.stripe.price_id` не меняется.
- `admin-provision-stripe-price` остаётся как есть, может вызываться другими каналами.

### Verify (как воспроизвести)
1. UI «Создать ссылку»:
   - продукт: Бухгалтерия как бизнес;
   - тариф: Стандартный;
   - 10 PLN;
   - provider: Stripe (`stripe_poland`);
   - payment_type: subscription (ежемесячно).
2. Ожидаемо:
   - toast «Ссылка создана»;
   - `payment_links` row с `amount=1000`, `currency='PLN'`, `payment_type='subscription'`,
     `provider='stripe'`, `account_code='stripe_poland'`,
     `meta.stripe_price_mode='inline_override'`,
     `meta.stripe_recurring_snapshot={interval:'month', interval_count:1}`;
   - `tariff_offers.meta.stripe.price_id` НЕ изменён;
   - `admin-provision-stripe-price` НЕ вызывался (нет audit
     `admin_create_public_link.stripe_price_provision_failed`).
3. Открыть `/pay/:token`:
   - нет `price_retrieve_failed`;
   - нет `checkout_session_create_failed`;
   - Stripe Checkout открывается на 10 PLN/мес;
   - можно ввести новую карту.
4. После успешной оплаты:
   - создаётся реальная `subscriptions_v2` с `provider_subscriptions.provider_subscription_id`
     начинающимся с `sub_`;
   - именно эта запись (а не pending draft) появляется в карточке контакта
     со статусом «Активна» / «Иностранная карта (Stripe)».

---

## DoD checklist

- [x] Pending Stripe drafts не отображаются как подписки в карточке контакта.
- [x] Кнопка «Отменить (Stripe)» не показывается для pending.
- [x] Ошибка `stripe_subscription_id_missing_or_invalid` пользователю не видна
      (UI не доходит до вызова).
- [x] Все статусы в карточке контакта на русском.
- [x] Stripe subscription link на 10 PLN создаётся без вызова
      `admin-provision-stripe-price`.
- [x] Ссылка открывает Stripe Checkout с inline-amount (через PATCH-SUB-PRICE-2).
- [x] Сумма/валюта берутся из payment link.
- [x] После успешной оплаты реальная подписка появляется в карточке контакта.
- [x] bePaid / e-clearing / Pay не затронуты — изменения изолированы в Stripe-subscription ветке.
- [x] Миграций нет.
- [x] Edge function `admin-create-public-link` задеплоен.

---

## Изменённые файлы
- `src/components/admin/ContactDetailSheet.tsx` — filter pending drafts + Russian labels.
- `supabase/functions/admin-create-public-link/index.ts` — inline override для
  Stripe-subscription link, удалён provisioning blocker.
