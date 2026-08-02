# План: выдача отсутствующих entitlements для addon child orders ORD-26-02908-A1 / A2

PLAN-ONLY. Ничего не изменялось. Ниже — доказанные факты (read-only) и EXECUTE-план.

## 1. Доказанные факты

Группа и участники (`order_groups` / `order_group_items`):
- order_group `b130b53b-deae-4949-9761-419e60e2eb1c`, status = `paid`, total_amount = 1925.00
- primary_order_id = `68ed9a89-24d0-4fb3-a223-2a85c0b80035` (ORD-26-02908)
- membership обоих child: role = `addon`

Заказы (все три — один user `94dd8f18-fd9b-4f06-ab57-c759f1c59a3e`, созданы 2026-07-31 10:26 UTC):

| Заказ | id | product | tariff | status | final_price | paid_amount | live payments | ledger | entitlement |
|---|---|---|---|---|---|---|---|---|---|
| ORD-26-02908 (parent) | `68ed9a89…0035` | `3e43fb28…` prd_7222cb3152c3 | `767bb895…` | paid | 1925.00 | 1925.00 | 1 | 1 | 1 (до 2027-05-27) |
| ORD-26-02908-A1 | `a6c4a129-d145-48e9-9445-eca5caf66194` | `abee24cd…f168c` cb_module_retail | `0f5183d8…` | paid | 250.00 | 148.08 | 0 | 0 | 0 |
| ORD-26-02908-A2 | `2ed72842-2414-4c26-887e-940f76c5fde4` | `064dd768…442ba` cb_module_production | `c12acda3…` | paid | 350.00 | 207.30 | 0 | 0 | 0 |

Платёж: единственный live succeeded платёж во всей группе — `a09169c1-b885-4577-9e61-1a6f075f5da4`, 1925.00 BYN, provider bepaid, is_deleted = false, привязан к parent. Оба child содержат `meta.group_payment_id = a09169c1…`, `group_child_order = true` — то есть отсутствие собственного платежа у child является каноническим групповым контрактом (это же правило уже используется INV-20 suppression).

Действующие entitlements пользователя: только parent-курс (`prd_7222cb3152c3`, до 2027-05-27) и club (до 2026-08-10). По продуктам обоих модулей entitlement отсутствует полностью (ent_any = 0), ledger по child = 0.

Ожидаемая длительность из тарифов: `access_days = 30` у обоих addon-тарифов (`0f5183d8…` T-000049, `c12acda3…` T-000047).

Совместимость функции: канонический `grant-access-for-order` в текущем production не требует наличия платежа на самом заказе — ранние guard-и проверяют только существование заказа и `user_id`; окно считается из tariff.access_days и правил доступа. Формальной несовместимости с group child нет.

## 2. Открытый вопрос перед EXECUTE (влияет на окно доступа)

По тарифу оба модуля дадут 30 дней, тогда как parent-курс открыт до 2027-05-27. Если по договору модули курса должны действовать столько же, сколько сам поток, 30 дней будет неверным окном. Развилка в плане ниже.

## 3. EXECUTE-план (после отдельного одобрения)

1. Preflight (read-only, повтор): подтвердить для каждого child — status `paid`, live payments = 0, ledger = 0, entitlement = 0, role `addon`, group `b130b53b…` = paid, единственный live payment `a09169c1…` на parent. Любое расхождение → STOP.
2. Grant A1: один вызов `grant-access-for-order` для `a6c4a129…` с идемпотентным ключом = order_id, `grantTelegram = false`, `grantGetcourse = false`.
3. Grant A2: один вызов `grant-access-for-order` для `2ed72842…`, те же параметры.
4. Развилка по окну: если ответ даёт 30 дней и утверждён вариант «как у потока», выполнить тот же вызов с `customAccessEndAt = 2027-05-27T10:26:00Z` вместо дефолтного (без ручного DML). Если вариант «30 дней по тарифу» — шаги 2–3 финальны.
5. Ожидаемые счётчики: по каждому child ledger rows = 1 (плюс возможные bonus-строки правил), entitlements по каждому продукту = ровно 1 active. Повторный вызов — no-op по idempotency guard.
6. Read-back:
   - entitlements по `abee24cd…` и `064dd768…` = по 1 active с ожидаемым окном;
   - missing active contractual access за период = 0;
   - INV-20 actionable = 0, INV-25 processing > 2ч = 0;
   - payments: у parent по-прежнему 1 live succeeded 1925.00 BYN, у child — 0; revenue группы 1925.00 без изменений; заказы/подписки не создавались.
7. STOP-условия: любой отказ функции с group-child диагностикой, создание нового payment/order/subscription, изменение revenue, ledger ≠ ожидаемому, расхождение окна без утверждённого варианта. Ручной обход (прямой INSERT entitlements) запрещён.

Вне scope: Telegram/email/GetCourse/AmoCRM, charge/refund/void, code/commit/migration/deploy/Publish, любые другие заказы и пользователь `09f6350e…`.
