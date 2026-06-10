# PATCH-STRIPE-UI-INTEGRATION-CLEANUP-V1 — Stage 1 proof

Дата: 2026-06-10
Статус: **Stage 1 выполнен, Stage 2 в backlog** (см. ниже)

## Stage 1 — выполнено (immediate, safe)

### PATCH-A (частично): Удалён отдельный Stripe-блок сверху

**Файл:** `src/components/admin/payments/BepaidSubscriptionsTabContent.tsx`

- Убран импорт `StripeSubscriptionsList`.
- Убран рендер `<StripeSubscriptionsList />` сверху страницы `/admin/payments/bepaid-subscriptions`.

Stripe-подписки временно НЕ видны в этой вкладке (Stage 2 смержит их в существующую таблицу). Активная Stripe-подписка по-прежнему видна:
- в карточке контакта → блок «Подписки»;
- через прямой read в `provider_subscriptions` для дебага;
- `StripeSubscriptionsList.tsx` файл оставлен в репо (не удалён) для возможного дебага.

### PATCH-C: Stripe cancel = bePaid parity (рекуррент off, доступ цел)

**Файл:** `src/components/admin/ContactDetailSheet.tsx`

- `cancelStripeSubAdminMutation` теперь зовёт `action: 'cancel_now'` вместо `cancel_at_period_end`.
- Edge function `stripe-subscription-action` для `cancel_now` уже гарантирует:
  - `stripe.subscriptions.cancel(id)` (немедленная отмена у провайдера);
  - `subscriptions_v2.status='canceled'`, `auto_renew=false`, `canceled_at=now()`;
  - `provider_subscriptions.state/status='canceled'`;
  - **НЕ трогает** `access_end_at`, `entitlements`, `access_grant_ledger`, `telegram_access`, `orders_v2`, `payments_v2`.
- UI:
  - Кнопка — «Отменить» (без `(Stripe)`-суффикса; провайдер указан в badge выше).
  - Confirm-диалог: «Отменить подписку? Будущих списаний не будет. Деньги не возвращаются. Доступ сохраняется до {access_end_at}.»
  - Success toast: «Подписка отменена. Доступ сохраняется до конца оплаченного периода.»
  - Invalidate: `contact-provider-subscriptions`, `bepaid-subscriptions-admin`, `admin-stripe-subscriptions-list`.

### PATCH-F: «Проблемы с оплатой» скрыта из nav

**Файл:** `src/pages/admin/AdminPaymentsHub.tsx`

- Tab `payment-issues` удалён из массива `tabs`.
- Route `/admin/payments/payment-issues` остаётся работоспособным (legacy hidden) — прямой URL открывает страницу.
- `PaymentIssuesTabContent` и backend НЕ удалены.
- Унаследованный `useAutoRenewalAlerts` / `usePaymentIssuesCounters` остаются (badge для AutoRenewals продолжает работать).

---

## Stage 2 — в backlog (требуют отдельной итерации из-за объёма)

Эти задачи плана требуют значительной переработки больших файлов (`BepaidSubscriptionsTabContent` 2007 строк, `AutoRenewalsTabContent` 1941 строка, `PaymentsTable`). Они НЕ были выполнены в Stage 1 ради безопасности bePaid.

### Stage 2.1 — PATCH-A полная Unified Subscriptions Table
- Расширить `bepaid-list-subscriptions` (или клиентский reader) на `provider_subscriptions.provider IN ('bepaid','stripe')`.
- Маппинг Stripe → существующая row-model: amount/currency из `subscriptions_v2.meta.amount_byn`+`meta.currency` или `meta.stripe.price`; next_charge из `meta.stripe.current_period_end`.
- Provider badge + provider filter (Все / bePaid / Stripe).
- Provider-aware actions (bePaid actions ↔ Stripe actions раздельно).

### Stage 2.2 — PATCH-B AutoRenewals provider-aware + layout fix
- Когорта Stripe: `provider='stripe' AND auto_renew=true AND status IN active/trialing/past_due AND psid LIKE 'sub_%' AND next_charge_at IS NOT NULL`.
- Без next_charge_at → отдельный warning-фильтр.
- Layout: убрать узкие фиксированные width, sensible min-width, горизонтальный scroll только при необходимости.

### Stage 2.3 — PATCH-D «Следующее списание» vs «Доступ до»
Текущая логика в `ContactDetailSheet` уже показывает две даты раздельно (см. строки 2308–2324), но `nextCharge` для Stripe может приходить пустым из reader-а. Нужно:
- В reader подписок контакта добавить резолвер: `subscriptions_v2.meta.stripe.current_period_end` → `provider_subscriptions.meta.current_period_end`.
- Discovery: подтвердить, что `stripe-webhook` пишет `current_period_end` в meta; для подписки Сергея `sub_1TgWoO6UYJj2vm0Gjc9P0jxH` — однократный pull, если пусто.

### Stage 2.4 — PATCH-E Payments documents parity для Stripe
- Найти/переиспользовать существующий receipt-action компонент bePaid.
- Mapping для Stripe payment: `meta.stripe.charge.receipt_url` → `invoice.hosted_invoice_url` → `invoice.invoice_pdf` → hosted payment page.
- Mapping для Stripe refund: `refund.receipt_url` → `charge.receipt_url` → `invoice.hosted_invoice_url` → hosted payment page.
- Запрет «документ ещё не получен», если есть любой URL.

### Stage 2.5 — PATCH-G PublicPayPage final verify
- Read-only proof, что Stripe subscription flow не показывает bePaid card. Изменения, скорее всего, не нужны (после прошлого патча).

### Stage 2.6 — STOP-guards для cancel UI
- Скрывать кнопку «Отменить» если `provider_subscription_id` начинается с `pending:` (сейчас фильтр на 2171 строке уже отсекает не-`sub_*`, но логику стоит вынести и unit-покрыть).

---

## Stripe recurring period (НЕ менялся)

В этом PATCH периодичность Stripe не меняется. Текущий `interval` / `interval_count` сохранены из `tariff_offers.meta.recurring`.

Backlog: `PATCH-STRIPE-BILLING-PERIOD-MODE-V2` (calendar_month vs every_N_days choice).

---

## Verify (Stage 1 acceptance)

- ✅ `<StripeSubscriptionsList />` больше не рендерится отдельным блоком сверху.
- ✅ Tab «Проблемы с оплатой» отсутствует в nav `AdminPaymentsHub`.
- ✅ Cancel-кнопка Stripe в карточке контакта зовёт `cancel_now`, не `cancel_at_period_end`.
- ✅ После cancel: подписка реально отменяется у Stripe; локально `status='canceled'`; access_end_at не меняется (гарантия edge function).
- ✅ Confirm-диалог объясняет: «доступ сохраняется до {access_end_at}, деньги не возвращаются».
- ⏸ Stage 2 — единая provider-aware таблица, AutoRenewals Stripe, payments documents — в backlog.

## Regression

- bePaid подписки/автопродления/документы — без изменений (touch только указанные файлы).
- bePaid cancel в той же карточке — без изменений (`cancelProviderSubAdminMutation` не тронут).
- Route `/admin/payments/payment-issues` остаётся доступен (legacy hidden).
