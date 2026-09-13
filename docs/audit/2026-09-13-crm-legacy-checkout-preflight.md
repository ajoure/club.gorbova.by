# Read-only preflight: legacy subscription links and discounts

Source: canonical Lovable message `main:agent#00000012983192#don:WQ23YVZ3`, 13 September 2026. No mutations.

Отчет о выполнении: только SELECT. Записей, изменений кода, миграций, deploy и Publish нет. HEAD `363601dff31bd43a545c2c4846865572b0da3822`, очередь свободна. Персональные данные, ID клиентов/заказов, токены и URL не выводились.

## 1. Реферальные резервации на pending/failed заказах — ноль
Активные pending/failed заказы с `meta->>'referral_customer_credit_reservation_id'` или `meta->>'referral_partner_bonus_reservation_id'` — **0 строк**. Проверены также все ключи meta с «referral»/«reservation» на этом множестве — совпадений нет. Сами таблицы `referral_bonus_reservations` и `referral_customer_credit_entries` **полностью пусты** (0/0 строк, в т.ч. с `applied_order_id`/`source_order_id`). Резервационный механизм сейчас не содержит данных, поэтому строк «с фактическим оплаченным ledger» — 0 по определению.

## 2. provider_subscriptions в состояниях pending/redirecting
Всего 91 строка, все **bePaid**, кроме 3 Stripe. По (provider, state, subscriptions_v2.status, orders_v2.status):

| provider | state | subv2.status | order.status | строк | с order_id | с checkout_url |
|---|---|---|---|---|---|---|
| bepaid | pending | past_due | pending | 16 | 16 | 16 |
| bepaid | redirecting | past_due | pending | 5 | 5 | 5 |
| bepaid | redirecting | past_due | — (нет order) | 1 | 0 | 0 |
| bepaid | redirecting | active | paid | 1 | 1 | 1 |
| bepaid | redirecting | active | — | 2 | 0 | 2 |
| bepaid | redirecting | canceled | — | 2 | 0 | 0 |
| bepaid | redirecting | expired | — | 4 | 0 | 3 |
| bepaid | redirecting | superseded | pending | 8 | 8 | 8 |
| bepaid | redirecting | superseded | — | 11 | 0 | 1 |
| bepaid | redirecting | (нет subv2) | pending | 1 | 1 | 1 |
| bepaid | redirecting | (нет subv2) | failed | 2 | 2 | 2 |
| bepaid | redirecting | (нет subv2) | — | 38 | 0 | 29 |
| stripe | pending | pending | — | 3 | 0 | 0 |

Итоговые флаги: bePaid pending 16/16 с order и checkout_url; bePaid redirecting 72 (из них 24 без order_id и без checkout_url — включая все canceled и 1 из expired; 19 superseded: 8 с order+url, 11 без); Stripe pending 3 — без order_id, без checkout_url, без `cs_`-сессии (provider_subscription_id не checkout-session, хранимый session id в meta отсутствует). Поле checkout URL у bePaid — `meta.checkout_url` (не raw_data).

## 3. Активные payment_links с истечением < created_at+24h
Активных ссылок (`status='active'`, колонки `is_active` нет) — **225**. С `expires_at` — 33, без него — 192 (все с `meta.source` пустым, кроме двух с ручным TTL 7 и 14 дней).

| группа | всего | TTL | expires < created+24h | из них ещё валидны сейчас | созданы <24ч назад и валидны |
|---|---|---|---|---|---|
| saved-card bridge (`payment_dialog_saved_card_bridge`) | 17 | ровно 15 мин (14:59.9) | 17 | **0** | 0 |
| installment (`landing_payment_dialog_installment`) | 16 | ровно 24 ч (23:59:59.9) | 16 | 0 | 0 |
| прочие (`source` пуст) | 192 | 2 с expires (7 и 14 дней — вручную заданные), 190 без expires | 0 | 0 | — |

Ключевой факт: **все 33 ссылки с TTL ≤24ч уже истекли по времени**, хотя `status` остаётся `active` — фонового снятия статуса по expires_at нет. Ни одна активная ссылка сейчас не находится в окне «<24ч от создания и ещё валидна». Разделение по происхождению TTL: 15-минутный TTL — это saved-card bridge (автоматически, не вручную); 24-часовой — installment-диалоги; ручные `expires_at` (7/14 дней) короче 24ч не встречаются.

Факты переданы; ничего не менял.
