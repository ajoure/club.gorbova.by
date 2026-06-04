да, согласен, с учетом правок:

1. Добавить пункт **11. CRM Routing (обязательный)**:
  &nbsp;
  &nbsp;
  - Проверить на одном Stripe sandbox order полный маршрут:  
  `order → contact → deal → CRM linkage`.
  - Подтвердить отсутствие orphan contacts/deals.
  - Это входит в DoD Фазы 2 мастер-спринта.
2. Добавить пункт **12. Telegram Routing (обязательный)**:
  - Проверить:  
  `order → entitlement → telegram access`.
  - Даже если продукт консультации не выдаёт Telegram-доступ, требуется доказательство корректного прохождения маршрутизации или корректного skip по бизнес-правилу.
3. Добавить пункт **13. Document Routing (обязательный)**:
  - Проверить:  
  `order → document pipeline`.
  - Подтвердить отсутствие ошибок маршрутизации документов.
  - Это также входит в DoD Фазы 2 мастер-спринта.
4. В итоговом файле:  
`.lovable/proofs/mp_a2_pilot_readiness_review_v1.md`
  &nbsp;
  изменить итоговый gate:
  - было: **10/10 PASS**
  - должно быть: **13/13 PASS**
5. Дополнительно добавить отдельную секцию:  
**Master Sprint Alignment Check**
  &nbsp;
  Проверить соответствие текущего состояния мастер-спринту:
  - Фаза 0 — статус.
  - Фаза 1 — статус.
  - Фаза 2 — статус.
  - Фаза 3 — статус.
  - Выход за scope.
  - Риск регрессии bePaid.
  - Попытка преждевременного перехода к Фазам 4–10.
  Отдельный итог:
  - Выполнено.
  - Частично выполнено.
  - Не выполнено.
  - Backlog.
  - Blockers.
6. Добавить STOP-GATE:  
До получения **13/13 PASS** запрещено:
  - запускать Stage C Runtime Pilot;
  - создавать Stripe Subscription;
  - создавать Subscription Schedule;
  - расширять subscription-actions;
  - расширять reconcile jobs;
  - выполнять любые работы из Фазы 3 кроме проверки готовности.

&nbsp;

В остальном план соответствует мастер-спринту и не противоречит утвержденной дорожной карте Stripe Integration Master Sprint v1.0.

&nbsp;

План: Pilot Readiness Review (read-only gate 10/10)

## Цель

Read-only проверка готовности к Stage C Runtime Pilot «Платная консультация». Никаких изменений кода, миграций, секретов или live-режима. Только сбор доказательств по 10 пунктам и вынесение вердикта PASS/FAIL.

## Жёсткие ограничения

- Read-only: запрещены любые edits в `supabase/functions/_shared/acquiring/*`, `stripe-*`, `bepaid-*`, миграции, RPC, RLS, secrets, config.toml.
- Запрещено создание временных edge functions (в отличие от MP-A2-2R).
- Запрещено включение live mode / live keys.
- Запрещены любые касания bePaid path.
- При FAIL — НЕ фиксить, а оформить mini-plan отдельным шагом.

## 10 пунктов гейта

### 1. Account resolver

- Проверить `_shared/acquiring/account-resolver.ts` (или эквивалент): SOT = `acquiring_connections`, выбор default через `is_default=true AND status='active'`, fallback запрещён к хардкоду.
- `rg` по репо: отсутствие литералов `'stripe_poland'` / `'stripe_eu'` / `'default'` как account_code вне seed-миграций и proof-файлов.
- Доказательство: список найденных мест + комментарий PASS/FAIL.

### 2. Customer resolver

- Подтвердить, что `_shared/acquiring/stripe-customer-resolver.ts` использует ключ identity `(user_id, account_code)`; email — только last-step fallback с отдельным audit-событием.
- Сослаться на `.lovable/proofs/mp_a2_2_customer_resolver_v1.md` и `mp_a2_2_runtime_completion_v1.md` (S1/S4/S5/S6/S7 = runtime PASS).

### 3. Saved Payment Method

- Проверить, что в `stripe-create-checkout` (mode=payment) выставлен `setup_future_usage='off_session'` и `customer` подставляется из resolver.
- Подтвердить, что нет локального хранения PAN/PM (Stripe = SOT).
- Сослаться на `.lovable/backlog/stripe_saved_pm_followup.md` (картa picker — out of scope пилота).

### 4. Customer Portal readiness

- Проверить наличие/отсутствие edge function для Billing Portal (`stripe-create-portal-session` или аналог).
- Если отсутствует — зафиксировать как ожидаемый gap (пилот = разовая консультация, recurring/portal не требуется) и сослаться на backlog Вариант A.
- Вердикт: PASS = «не требуется для пилота, явно отложено в backlog», либо FAIL с mini-plan.

### 5. Hardcode audit

- `rg` по `supabase/functions/` на: `example.com`, `success_url:`/`cancel_url:` с literal URL, `'default'` business_stream literal, `stripe_poland` вне seed.
- Подтвердить, что URL'ы идут через server URL resolver, business_stream — через `_shared/acquiring/business-stream-resolver.ts`.
- Доказательство: список grep-hits с классификацией allowed/forbidden.

### 6. Phase 2 regression

- Проверочный список из MP-A2-1 runtime smoke: `stripe-admin-sandbox-checkout` (manual + catalog mode), webhook, `payments_v2`, `orders_v2`, `provider_events`, refund smoke.
- Read-only verify через `supabase--read_query` (последние записи в `provider_events`, `payments_v2`, `orders_v2`, `audit_logs` за период после MP-A2-2R).
- Никаких новых тестовых платежей в этом шаге (это уже сделано в MP-A2-1/2R).

### 7. bePaid frozen

- Denylist verifier (как в Phase 2 proof):
  ```
  rg -l "acquiring/index|stripe-adapter|stripe-customer-resolver|vault\.ts" \
     supabase/functions/bepaid-webhook \
     supabase/functions/_shared/create-payment-checkout.ts \
     supabase/functions/_shared/acquiring/bepaid-adapter.ts
  ```
  → exit=1 (no matches).
- `SELECT count(*) FROM payment_links WHERE provider='bepaid'` — без падения.

### 8. Multi-account safety

- Проверить, что нет кода, который перебирает `acquiring_connections` без фильтра `provider='stripe' AND status='active'`.
- Проверить, что `provider_events.account_code` пишется на каждом webhook hit (sample SELECT).
- Подтвердить, что `Customer.id` хранится per-account в `profiles.meta.stripe.customers[account_code]` (схема MP-A2-2).

### 9. E2E metadata trace

- Взять 1 успешный sandbox-заказ из MP-A2-1 runtime smoke (есть в proof).
- Трейс: `orders_v2.id` → `payments_v2.meta` → `provider_events.payload` → Stripe Checkout Session metadata.
- Подтвердить, что в каждом узле есть: `order_id`, `account_code`, `business_stream` (не `'default'`), `user_id`, `product_id`/`tariff_id`.

### 10. No live keys

- `SELECT account_code, test_mode, status FROM acquiring_connections WHERE provider='stripe'` → все строки `test_mode=true`.
- В UI `StripeConnectionDialog` test_mode заблокирован в ON (см. Phase 2 proof).
- Vault: подтвердить, что для активных stripe-аккаунтов нет ключей с префиксом `sk_live_` / `pk_live_` / `whsec_` от live mode (косвенная проверка через `acquiring-test-connection` last run в `capabilities_snapshot` / `last_verified_at`).

## Артефакты (только новые proof-файлы, без кода)

- `.lovable/proofs/mp_a2_pilot_readiness_review_v1.md`
  - 10 секций, по каждой: команды/SQL, выдержки результатов, вердикт PASS/FAIL, ссылки на исходные proof'ы.
  - Итоговый вердикт: 10/10 PASS → green-light Stage C; иначе — список FAIL и предложение mini-plan'ов.

## Out of scope

- Любые исправления найденных FAIL (только фиксация и mini-plan).
- Запуск пилота / live-checkout / реальных платежей.
- Изменения UI кабинета / админки.
- bePaid касания любого рода.

## DoD

1. Создан `.lovable/proofs/mp_a2_pilot_readiness_review_v1.md` с 10 секциями.
2. По каждой секции — реальные read-only артефакты (rg output, SQL rows, ссылки на существующие proof'ы), без «логических утверждений».
3. Итоговый вердикт явный: «10/10 PASS, green-light Stage C» либо «X/10 PASS, см. mini-plan(s) ниже».
4. Никаких изменений вне `.lovable/proofs/`.
5. bePaid не затронут (verifier exit=1).
6. `acquiring_connections.test_mode=true` для всех активных stripe-строк.