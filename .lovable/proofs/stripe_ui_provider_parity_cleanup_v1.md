# PATCH-STRIPE-UI-INTEGRATION-CLEANUP-V1 — proof

Дата: 2026-06-10
Статус: Stage 1 ✅ PASS · Stage 2A ✅ PASS · Stage 2B/2C/2D — backlog

## Stage 2A — Unified Subscriptions Table (выполнено)

**Решение:** вариант B (local merge без новых edge functions).

**Источники строк:**
- bePaid — существующий `bepaid-list-subscriptions` (не изменён).
- Stripe — новый read-only hook `src/hooks/admin/useStripeSubscriptionsList.ts`:
  - `provider_subscriptions` (`provider='stripe'`) → JOIN `subscriptions_v2 → tariffs/products/orders_v2`;
  - вторым запросом `profiles` по `user_id IN (...)` (FK на auth.users, не на profiles.id).
  - Никаких новых edge functions, никаких записей в БД.

**Mapping Stripe → BepaidSubscription-совместимая row model:**
| UI поле | Источник |
|---|---|
| `provider` | константа `'stripe'` |
| `id` | `provider_subscription_id` (`sub_*`); для `pending:*` — `subv2.id` |
| `status` | `subv2.status` → нормализация: `trialing→trialing`, `incomplete*→pending`, `unpaid→past_due`, `canceled/cancelled→canceled` |
| `plan_title` | `tariffs.name → products.name → "—"` |
| `plan_amount` | `orders_v2.final_price → subv2.meta.amount → stripe.inline_price.amount_major → amount_minor/100 → 0` |
| `plan_currency` | `orders_v2.currency → subv2.meta.currency → inline_price.currency → "USD"` |
| `customer_email/name` | `profiles` JOIN по `subv2.user_id` |
| `created_at` | `provider_subscriptions.created_at` |
| `next_billing_at` | `subv2.meta.stripe.current_period_end → ps.meta.stripe.current_period_end → ""` (показывается «—» если пусто; full resolver — Stage 2D) |
| `last_payment_at` | `provider_subscriptions.last_charge_at` |
| `is_linked_full` / `linked_*` | всегда `true` (Stripe строки приходят из локального `subscriptions_v2`) |

**UI изменения в `BepaidSubscriptionsTabContent.tsx`:**
- Интерфейс `BepaidSubscription` расширен: `provider?: 'bepaid' | 'stripe'`, `last_payment_at?: string`.
- `DEFAULT_COLUMNS`: добавлены `provider` (после checkbox) и `last_payment` (после `next_billing`); `COLUMNS_STORAGE_KEY` поднят до `v4` (полный reset раскладки).
- `subscriptions` теперь — `useMemo` merge bePaid (tagged `provider:'bepaid'`) + Stripe rows.
- Новый стейт `providerFilter: 'all' | 'bepaid' | 'stripe'` + Select в toolbar.
- `STATUS_LABELS` обновлён: `pending → "Ожидает оплаты"`, добавлен `trialing → "Пробный период"`.
- `renderCell` для Stripe строк:
  - `checkbox` → disabled + Tooltip «Stripe: используйте карточку контакта для отмены подписки.»;
  - `provider` → violet badge `Stripe` / sky badge `bePaid`;
  - `last_payment` → дата `last_charge_at` или «—»;
  - actions dropdown: скрыты «Открыть в bePaid» / «Отменить в bePaid»; добавлен disabled-info «Stripe: отмена — в карточке контакта».
- `handleSelectAll` теперь выбирает только bePaid строки.
- bulk cancel дёргает только `bepaid-cancel-subscriptions` (Stripe строки в `selectedIds` попасть не могут — checkbox disabled).

**DoD Stage 2A — проверено по фикстуре `sub_1TgWoO6UYJj2vm0Gjc9P0jxH` (Сергей Федорчук, 2.00 USD, активная Stripe-подписка):**
- ✅ отдельного Stripe-блока сверху нет;
- ✅ одна таблица «Подписки»;
- ✅ bePaid + Stripe строки в одной таблице;
- ✅ для Stripe строки в БД-резолвере видны: клиент `Сергей Федорчук`, тариф `Несрочная консультация`, сумма `2.00 USD`, provider badge `Stripe`, статус `Активна`, last_payment `2026-06-10`;
- ✅ next_billing честно «—» (Stripe webhook ещё не пишет `current_period_end` в `subv2.meta.stripe` — фикс в Stage 2D);
- ✅ фильтр provider работает (`Все / bePaid / Stripe`);
- ✅ bePaid строки идентичны прежним (rendering логика не тронута, кроме новых колонок);
- ✅ bePaid bulk cancel работает только для bePaid;
- ✅ Stripe checkbox disabled с tooltip-объяснением;
- ✅ Stripe action menu — без bePaid-only пунктов.

**Временные ограничения (зафиксированы как backlog):**
- card_brand/card_last4 для Stripe пусты — `default_payment_method` снапшот пишется в Stage 2D.
- next_billing_at для Stripe чаще всего «—» до полного резолвера (Stage 2D).
- Provider-aware bulk cancel UX — Stage 2 follow-up (сейчас Stripe-отмена только через карточку контакта; это явно показано tooltip-ом).

---

## Stage 1 — выполнено (immediate, safe)


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
