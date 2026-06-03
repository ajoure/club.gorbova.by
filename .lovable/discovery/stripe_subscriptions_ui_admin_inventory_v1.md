# D6. UI / Admin Inventory (v1)

## Admin (read-only инвентаризация, без модификаций в discovery)
- `PaymentDialog` — добавится ветка `provider=stripe` для подписочного flow (Stripe Elements или Checkout Session с `mode=subscription`).
- `/admin/payments/links` — поддержка `provider=stripe` + `account_code` в фильтрах и колонках.
- `/admin/integrations/acquiring` — карточки Stripe-аккаунтов (по `account_code`).
- `subscription-actions` (user-side) — ветка provider=stripe: cancel = `cancel_at_period_end=true` (или сразу через Portal).
- `subscription-admin-actions` — admin cancel/supersede через Stripe API + provider migration helper.
- `subscriptions-reconcile` — расширение Stripe-ветками (см. D5).
- `subscription-renewal-reminders` / `subscription-grace-reminders` — переиспользуются без изменений (читают `subscriptions_v2` SOT).
- Аналитика подписок/выручки — фильтры по `provider / account_code / business_stream / product / tariff` (см. D10).

## Customer Portal (MVP — нативный Stripe)
Через Portal доступно:
- Замена карты.
- История платежей.
- Скачивание инвойсов/чеков Stripe.
- Self-cancel (`cancel_at_period_end=true`).

Реализация (план, без кода): edge `stripe-create-portal-session` → возвращает `url` → редирект из кабинета пользователя.

**Свой UI управления картами в MVP не делаем.** Путь миграции на собственный кабинет:
1. Заменить кнопку Portal на собственные экраны.
2. Использовать `SetupIntent` для привязки новых карт.
3. Использовать `paymentMethods.list / attach / detach` + `subscriptions.update({default_payment_method})`.
4. Документы — `invoices.list({customer}) + invoice.hosted_invoice_url`.
5. История — `charges.list({customer})` + `refunds.list`.

## Будущие пользовательские экраны (инвентаризация, не реализуем в MVP)
- **Мои подписки** (`/cabinet/subscriptions`) — список с провайдером, статусом, next_charge_at, кнопкой «Управлять» (Portal в MVP).
- **Способ оплаты** (`/cabinet/payment-method`) — карточка default PM (read-only snapshot) + кнопка «Открыть Portal».
- **Управление картой** (Portal в MVP; собственный экран — Phase 4+).
- **Customer Portal** — кнопка-ссылка из кабинета и из писем (renewal reminders).
- **История списаний** (`/cabinet/payments`) — list of `orders_v2`/`payments_v2` уже частично существует; расширить badges (refunded/partial) и фильтр по подписке.

Эти экраны должны быть учтены в Phase 3.1 implementation plan даже если реализация в MVP сводится к ссылке на Portal.

## SOT
- UI = view layer поверх `subscriptions_v2`/`orders_v2`/`payments_v2`. Никаких новых SOT-таблиц.

## Что хранится локально
- Только snapshot `default_payment_method` (last4/brand) для UI-подсказки, опционально.

## Что хранится в Stripe
- Полные данные карт, истории, инвойсов.

## Recovery
- При расхождении UI ↔ Stripe — кнопка «Sync from Stripe» в admin (per subscription), которая дёргает `subscriptions-reconcile` для конкретного `sub_id`.

## Multi-account
- Все списки в UI имеют фильтр по `account_code`. Portal-сессия создаётся под правильным Stripe-аккаунтом подписки.
