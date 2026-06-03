# да, согласен, с учетом правок:

# **План: Stripe Phase 2 — Final Runtime Verification (редакция v2)**

## **Дополнение 1. Обязательная проверка webhook registration**

Добавить перед Этапом 2 новый этап:

### **Этап 1.4 — Проверка webhook registration**

До выполнения платежей проверить через Stripe API и через БД:

- существует endpoint для `stripe_poland`;
- endpoint активен (`enabled`);
- URL совпадает с ожидаемым `stripe-webhook`;
- подписан минимум на:
  - checkout.session.completed
  - payment_intent.succeeded
  - charge.refunded
  - charge.refund.updated
- secret читается через текущий UI/Vault-path;
- webhook доставляется именно в используемый account_code.

Proof:

- endpoint_id
- enabled_events
- webhook_status
- account_code

Без этого дальнейшие тесты не считаются валидными.

---

## **Дополнение 2. Проверка нескольких валют в UI и БД**

Для каждой валюты:

- USD
- EUR
- PLN
- BYN
- RUB

Проверить:

### **Stripe Checkout**

Отображается правильная валюта.

### **Stripe API**

payment_intent.currency соответствует ожидаемой валюте.

### **orders_v2**

currency совпадает.

### **payments_v2**

currency совпадает.

### **UI**

сумма отображается без искажений.

Отдельная таблица proof по 5 валютам.

---

## **Дополнение 3. Проверка metadata contract**

Для каждого платежа проверить фактическое содержимое Stripe metadata.

Обязательные поля:

- provider
- account_code
- order_id
- business_stream
- product_id
- tariff_id

Проверить:

- metadata присутствует в Stripe;
- metadata доходит до webhook;
- metadata доходит до provider_events;
- metadata доходит до payments_v2;
- metadata доходит до orders_v2.

Никаких потерь данных между этапами.

---

## **Дополнение 4. Проверка refund → UI**

После partial refund и full refund дополнительно проверить:

### **Payments UI**

- статус строки;
- сумма возврата;
- бейдж возврата;
- фильтры работают.

### **Payment Details**

если есть детальная карточка:

- refund_uid;
- refund_amount;
- refund_date.

---

## **Дополнение 5. Проверка provider isolation**

Дополнить этап 7.

Нужно проверить не только отсутствие cross-routing.

Также проверить:

### **Stripe платеж**

не появляется:

- в bePaid диагностике;
- в bePaid sync;
- в bePaid выписке.

### **bePaid платеж**

не появляется:

- в Stripe events;
- в Stripe reconcile;
- в Stripe diagnostics.

Proof обязателен.

---

## **Дополнение 6. Проверка payment search**

После создания платежей проверить поиск в /admin/payments по:

- order_id
- payment_intent_id
- checkout_session_id
- email
- сумме

Поиск должен находить Stripe-платежи.

Если не находит — оформить отдельный PATCH.

---

## **Дополнение 7. Проверка повторной оплаты**

Создать два подряд платежа одним пользователем:

- одинаковый tariff_id;
- одинаковая валюта.

Проверить:

- создаются разные order_id;
- создаются разные payment_intent;
- нет конфликтов idempotency.

---

## **Дополнение 8. Проверка логов ошибок**

После завершения тестов выгрузить:

- последние ошибки stripe-webhook;
- последние ошибки stripe-reconcile-session;
- последние ошибки stripe-admin-sandbox-checkout.

Проверить отсутствие:

- 500;
- signature errors;
- duplicate key violations;
- enum violations;
- null constraint violations.

---

## **Дополнение 9. Проверка автопродления (Discovery-only)**

Без реализации.

Проверить готовность архитектуры к следующей фазе:

- recurring metadata;
- subscription mapping;
- customer mapping;
- payment profile mapping.

Создать раздел proof:

“Subscriptions Readiness”.

Никаких изменений данных.

---

## **Дополнение 10. Финальный Go / No-Go**

В конце proof добавить таблицу:


| **Проверка**       | **Статус** |
| ------------------ | ---------- |
| Checkout           | PASS/FAIL  |
| Webhook            | PASS/FAIL  |
| Reconcile          | PASS/FAIL  |
| Refund             | PASS/FAIL  |
| UI                 | PASS/FAIL  |
| Metadata           | PASS/FAIL  |
| Provider isolation | PASS/FAIL  |
| bePaid coexistence | PASS/FAIL  |
| Search             | PASS/FAIL  |
| Idempotency        | PASS/FAIL  |


Если хотя бы один FAIL:

- Phase 2 не считается завершённой;
- создаётся отдельный микро-патч;
- выполняется повторная верификация только проваленного блока.

---

## **Дополнение 11. Подготовка к следующей фазе**

После успешного завершения данного спринта сформировать отдельный документ:

`Stripe Phase 3 — Subscriptions Discovery`

Только discovery.

Без реализации.

Содержимое:

- recurring billing architecture;
- customer lifecycle;
- payment profiles;
- retry strategy;
- dunning strategy;
- migration compatibility с bePaid.

Этот набор дополнений закрывает пробелы по webhook, metadata, provider isolation, поиску, логам и готовности к следующей фазе, не выходя за рамки текущего Stripe Phase 2.

&nbsp;

План: Stripe Phase 2 — Final Runtime Verification

Цель — финальная end-to-end проверка Stripe-канала на реальных тестовых платежах с зафиксированным proof по каждому пункту. Этот спринт **не вносит изменений в код**, кроме точечного хотфикса, если runtime-проверка выявит баг (тогда — отдельный микро-патч с дополнительным proof).

## Freeze

- bePaid: `bepaid-*` edge-функции, `_shared/acquiring/bepaid-adapter.ts`, `_shared/create-payment-checkout.ts` — НЕ трогаем.
- Public payment links: `admin-create-public-link`, `/pay/:token`, `buildPublicPaymentUrl.ts` — НЕ трогаем.
- Канонические write-paths: `grant-access-for-order`, `record_refund_atomic` — НЕ трогаем.
- bePaid orphan repair (предыдущий план) идёт отдельным треком; в этом спринте не пересекается.

## Этап 1 — Подготовка

1.1. Через `stripe-admin-sandbox-checkout` создать 4 Checkout Session с метаданными по контракту (`stripe_metadata_contract_v1.md`): `order_id`, `product_id`, `tariff_id`, `business_stream`, `account_code=stripe_poland`, `provider=stripe`. Один реальный `product_id` + `tariff_id` (recurring offer для проверки grant + extend), `final_price` ≥ Stripe-минимума для каждой валюты:


| #   | Currency | Amount  | Назначение                                    |
| --- | -------- | ------- | --------------------------------------------- |
| 1   | USD      | 5.00    | base case                                     |
| 2   | EUR      | 5.00    | base case                                     |
| 3   | BYN      | 100.00  | already verified, повторный проход для extend |
| 4   | RUB      | 1000.00 | минимум выше settlement floor                 |


1.2. Зафиксировать в proof: `cs_*`, `pi_*` (после оплаты), `order_id`, suggested test-card `4242 4242 4242 4242`.

1.3. Один контрольный bePaid-checkout (public link, одноразовый, BYN 10) — для пункта 7 (параллельная работа без конфликтов).

## Этап 2 — Оплата и event chain

Для каждой из 4 сессий оператор оплачивает карту 4242, после чего собираем доказательства:

```text
Stripe                          → webhook (stripe-webhook)
  checkout.session.completed   ───┐
  payment_intent.succeeded     ───┤→ provider_events.processed
                                  ├→ payments_v2.status='succeeded'
                                  ├→ orders_v2.status='paid'
                                  └→ grant-access-for-order
```

SQL-выгрузки (read-only) в proof по каждому платежу:

```sql
-- 1) Stripe API state
GET /v1/checkout/sessions/{cs_id}     → status, payment_status, payment_intent
GET /v1/payment_intents/{pi_id}       → status, latest_charge

-- 2) provider_events
SELECT id, event_type, processing_status, idempotency_key, related_order_id, created_at
FROM provider_events
WHERE provider='stripe' AND related_order_id IN (...);

-- 3) payments_v2
SELECT id, provider, provider_payment_id, status, amount, currency, order_id, profile_id, created_at, meta
FROM payments_v2 WHERE order_id IN (...);

-- 4) orders_v2
SELECT id, order_number, status, paid_amount, currency, provider, provider_payment_id, paid_at
FROM orders_v2 WHERE id IN (...);
```

Pass-критерий каждой строки: `provider_events.processing_status='processed'`, `payments_v2.status='succeeded'`, `orders_v2.status='paid'`, `paid_amount=final_price`.

## Этап 3 — Refund

Для платежа USD 5.00:

- 3.1. Частичный refund 2.00 через `POST /v1/refunds {payment_intent, amount=200}`.
- 3.2. Дождаться webhook `charge.refunded` → проверить вход в `record_refund_atomic` (SOT: `mem://architecture/payments/refund-canonical-write-path`).
- 3.3. SQL: `payments_v2.refunded_amount=2`, `refunds[]` имеет 1 запись с `refund_uid='re_*'`. Бейдж в UI = amber «Частичный возврат» (по `partial-refund-state` memory).

Для платежа EUR 5.00:

- 3.4. Полный refund 5.00. Ожидаемо: `refunded_amount=5`, `status='refunded'`, бейдж red «Возврат».

Pass-критерий: refund_uid уникален, повторный webhook того же `re_*` НЕ создаёт дубль (идемпотентность RPC), нет direct INSERT в `payments_v2.refunds`.

## Этап 4 — Идемпотентность

4.1. Повторный webhook через Stripe Dashboard «Resend event» для одного `checkout.session.completed` и одного `payment_intent.succeeded`.

- Ожидаемо: `provider_events` имеет ровно одну запись (UNIQUE по `idempotency_key=stripe:{account}:{event_id}`), новых строк в `payments_v2` нет, `orders_v2` без изменений.

4.2. Повторный вызов `stripe-reconcile-session` по тому же `order_id` (BYN 100): `action='reprocessed'`, `payment_action='existing'`, тот же `payment_id` и `provider_event_id` (уже подтверждено в предыдущем proof — повторно зафиксируем для четырёх новых ордеров).

4.3. Перекрёстная проверка: запуск reconcile сразу после доставки webhook'a — тоже без дублей.

## Этап 5 — grant-access-for-order

Используем recurring offer (`is_recurring=true`), чтобы покрыть и выдачу, и extend.

5.1. **Выдача** (BYN 100, новый order): после оплаты `entitlements` и `subscriptions_v2` создаются один раз. SQL:

```sql
SELECT user_id, product_id, tariff_id, expires_at, source_order_id
FROM entitlements WHERE source_order_id = '{order1}';
SELECT id, status, access_start_at, access_end_at, tariff_id
FROM subscriptions_v2 WHERE meta->>'source_order_id'='{order1}';
```

5.2. **Продление** (тот же user_id, тот же `tariff_id`, новый order): проверяем `Extend ↔ Tariff Match` core rule. Ожидаемо: `subscriptions_v2.access_end_at` сдвигается ровно на `access_days` от старого end, без создания второй подписки. Audit `subscription.extend_via_tariff_match`.

5.3. **Отсутствие дублей**: пов­торная доставка webhook'a → `grant-access-for-order` идемпотентен (memory `grant-access-idempotency`); проверяем, что entitlement и subscription не получили лишних дней.

5.4. **Negative test**: оплата другим `tariff_id` того же продукта → должна создаваться НОВАЯ подписка от даты оплаты, audit `skip_extend_tariff_mismatch` (memory `extend-tariff-match-required`).

## Этап 6 — UI /admin/payments

Read-only визуальная проверка таблицы платежей и фильтров:

- 6.1. Stripe-платежи отображаются (фильтр provider=`stripe`, бейдж).
- 6.2. Колонки: provider, currency, amount, status, order, profile, refund-бейдж. Скриншот по каждой из 4 валют.
- 6.3. RefundDialog для частичного и полного — корректно отображает доступную сумму, не показывает bePaid-специфичные кнопки для Stripe-row.
- 6.4. Копирование UID (`provider_payment_id=pi_*`) работает (микро-фикс уже применён) — скриншот toast «UID скопирован».

Если найдём frontend-баг с маппингом provider (например, `useUnifiedPayments` или `PaymentsFilters` не пропускает `stripe`) — отдельный микро-патч в frontend, без бэкэнда. Проверить заранее по `discovery/bepaid_hardcodes.csv` (помечено `Phase1/Phase2` для `stripe`).

## Этап 7 — Параллельная работа Stripe + bePaid

7.1. Перед стартом — снимок counters:

```sql
SELECT provider, count(*) FROM payments_v2 WHERE created_at::date = CURRENT_DATE GROUP BY 1;
SELECT provider, count(*) FROM provider_events WHERE created_at::date = CURRENT_DATE GROUP BY 1;
```

7.2. В одном и том же окне оплачиваем: 1 Stripe USD + 1 bePaid BYN (через `/pay/:token`). Оба должны:

- попасть в свою таблицу-canon (`payments_v2`), не пересекаясь по `provider_payment_id`;
- получить корректный provider в UI;
- НЕ создать кросс-route'инга (Stripe webhook не должен трогать bePaid-row и наоборот).

7.3. Edge-логи `stripe-webhook` и `bepaid-webhook` за окно теста — без 5xx и без cross-provider warnings.

## Этап 8 — Proof и DoD

Файл: `.lovable/proofs/stripe_phase_2_final_runtime_verification.md`

Содержимое:

1. Таблица 4 валют × 5 артефактов (Stripe API, provider_events, payments_v2, orders_v2, grant-access).
2. Refund: частичный + полный, refund_uid, идемпотентность.
3. Идемпотентность: 2 resend webhook + 1 повторный reconcile, нет дублей (SQL `count` до/после).
4. grant-access-for-order: выдача / extend / tariff_mismatch / отсутствие дублей.
5. Скриншоты `/admin/payments` (4 row), RefundDialog, copy-UID toast.
6. Параллельная работа: counters до/после, edge-logs без cross-warnings.
7. Freeze-grep: `rg "stripe-" supabase/functions/bepaid-webhook supabase/functions/_shared/create-payment-checkout.ts supabase/functions/_shared/acquiring/bepaid-adapter.ts src/utils/buildPublicPaymentUrl.ts` → пусто.
8. Список найденных багов (если есть) и микро-патчей с отдельными proof-ссылками.

### DoD

- 4/4 валюты прошли весь chain до `orders_v2.paid`.
- Refund: частичный (amber) и полный (red) корректны, refund_uid уникален.
- 0 дублей при resend webhook и повторном reconcile.
- grant-access: выдача + extend по совпадающему tariff_id + tariff_mismatch создаёт новую подписку.
- `/admin/payments` отображает Stripe-row корректно во всех 4 валютах.
- Stripe + bePaid работают параллельно без cross-route багов.
- Proof-файл заполнен по всем 8 секциям; freeze-grep пуст.

## Порядок исполнения

Diagnose (snapshot counters) → Execute (4 платежа + refund + resend + параллельный bePaid) → Verify (SQL/edge-logs/UI) → Proof. Любой найденный баг → отдельный микро-патч + дополнительный proof, не блокирует фиксацию остальных DoD-пунктов.