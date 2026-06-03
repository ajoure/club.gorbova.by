# да, согласен, с учетом правок:

1. **Этап A2 не должен автоматически применять патчи.**  
Сейчас написано:  
`Любое место категории “должно быть исправлено” — устраняется в этом же этапе через add-only-патч.`  
Нужно заменить на:  
`A2 формирует список hardcode-мест и классификацию. Исправления выполняются только после отдельного mini-plan/dry-run, если изменение может затронуть runtime.`
2. **A1/A2 — сначала только discovery.**  
Не смешивать discovery и execute.  
Иначе подрядчик может начать править Stripe runtime до утверждения карты рисков.
3. **Этап C “Платная консультация” не должен требовать saved PM без подтверждения, что Checkout Session сохраняет карту.**  
Добавить:  
`Перед повторной покупкой проверить, что Checkout Session создаётся с customer и setup_future_usage / payment_method_collection, достаточными для сохранения PaymentMethod. Если Stripe Checkout не сохраняет карту в текущей конфигурации, это фиксируется как gap и закрывается отдельным mini-plan.`
4. **Customer Portal для one-time платежей проверить как capability, а не как обязательный PASS.**  
Portal может показывать разные возможности в зависимости от настроек Stripe Billing Portal.  
Добавить:  
`Если для one-time customer Portal не показывает карту/историю, это не блокирует пилот, но фиксируется в proof как Stripe Portal capability gap.`
5. **Этап E подписок слишком большой.**  
Разделить E на два подэтапа:
  - E1: Infinite subscription MVP.
  - E2: Subscription Schedule / finite installments.
  Не начинать E2, пока E1 не прошёл 10/10.
6. **В E6 renewal нельзя ждать реального месяца.**  
Нужно указать способ тестирования:
  - test clock Stripe, если доступен;
  - либо manual invoice finalization/pay;
  - либо short interval тестового Price, если поддерживается.
  Без этого renewal proof может зависнуть.
7. **Provider migration execute не должен входить в обязательный DoD Phase 3.1.**  
Достаточно:
  - discovery;
  - dry-run;
  - one controlled test migration только если есть безопасная тестовая подписка.
  Массовые/боевые миграции — отдельный спринт.
8. **В F1 фразу “Provider migration — dry-run + execute” заменить на:**  
`Provider migration — dry-run + controlled test execute on sandbox subscription only, если E1 успешно закрыт.`
9. **Не расширять** `grant-access-for-order`**, если не доказано, что он не покрывает Stripe metadata.**  
Сначала discovery: что уже работает через provider/order/tariff.  
Только потом отдельный patch.
10. **Добавить STOP-guard:**  
Если в любом этапе обнаруживается необходимость менять `subscriptions_v2` schema или bePaid recurring path — остановиться и вынести отдельный план.

После этих правок план можно запускать.

&nbsp;

План: Stripe Phase 3.1 — Implementation Plan (v2, с правками)

## Изменения относительно v1

1. Таблица `stripe_accounts` исключена из Phase 3.1 — сначала discovery существующей модели acquiring accounts.
2. Customer Portal проверяется по расширенному чек-листу (5 сценариев), а не только «отмена подписки».
3. Пилот «Платная консультация» расширен: повторная покупка той же картой, переиспользование `PaymentMethod`.
4. Перед этапом C (подписки) добавлен отдельный Discovery-этап совместимости текущих SOT.
5. `provider-migration.ts` — обязательный dry-run + блокировка массовых операций + proof.
6. Multi-account: в каждом runtime proof обязательно показываются `account_code` + `business_stream` + Stripe IDs.
7. Обязательный hardcode-аудит существующего Stripe-кода (Phase 2) с отдельным отчётом.
8. Phase 3.1 закрывается только после финального end-to-end proof (см. Definition of Done).

## Принципы (фиксируются на всю фазу)

1. **Discovery-first.** Перед любой реализацией — discovery существующих сущностей. Дублирование SOT запрещено.
2. **Пилот сначала**, подписки потом. Подписки не стартуют до закрытия пилота «Платная консультация».
3. **bePaid заморожен.** Никаких изменений в `bepaid-*` функциях и таблицах.
4. **Test-mode only.** Live-ключи не подключаются; live webhook endpoint не создаётся.
5. **Stripe = SOT по картам.** Локального хранилища PAN/токенов нет. Карты живут в Stripe (`Customer` + `PaymentMethod`), ссылки — в `meta.stripe.*`.
6. **Customer Portal — MVP self-service** (карты + история + смена карты + отмена подписки).
7. **Multi-account и business_stream сразу.** Резолвинг ключей и customer'ов — per-account. Поля `account_code`, `business_stream` записываются в `meta.stripe.*` во всех новых сущностях.
8. **Add-only.** Никаких rename/drop, никаких изменений семантики существующих полей.
9. **Все proof и отчёты — на русском**, в `.lovable/proofs/` и `.lovable/discovery/`.

---

## Этап A. Discovery + hardcode-аудит существующего Stripe-кода

### A1. Discovery acquiring accounts модели

Проверить фактическое использование существующих сущностей до создания чего-либо нового:

- `acquiring_connections` (16 колонок) — состав, как используется, есть ли `account_code` или эквивалент.
- `payment_settings`, `bepaid_product_mappings`, `business_stream`-маркеры в `tariff_offers.meta`, `products_v2.meta`.
- Где сейчас в коде резолвятся ключи bePaid и какой контракт у этого резолвинга.
- Есть ли в `provider_subscriptions` поле/meta-ключ под account/connection.

Deliverable: `.lovable/discovery/stripe_phase_3_1_acquiring_model_v1.md`:

- Карта существующих сущностей и их полей.
- Вердикт: покрывает ли существующая модель multi-account Stripe.
- Если покрывает → используем её, никакой новой таблицы.
- Если не покрывает → формулируем минимальное add-only расширение (новые колонки в `acquiring_connections` через nullable, или отдельная таблица только если доказано отсутствие альтернативы).

### A2. Hardcode-аудит Phase 2 Stripe-кода

Проверить весь существующий Stripe-код (`stripe-webhook`, `stripe-admin-refund`, `_shared/*` если есть, фронтенд-флоу Phase 2) на:

- Хардкод единственного `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` без проброса `account_code`.
- Допущения «Stripe customer глобально уникален».
- Допущения «один webhook secret».
- Прямые обращения к `Deno.env.get('STRIPE_*')` вне резолвера.
- Несоответствия `meta.stripe.*` контракту (см. discovery D2 из Phase 3.0).
- Места, где `business_stream` теряется при создании заказа/платежа.

Deliverable: `.lovable/proofs/stripe_phase_3_1_hardcode_audit_v1.md`:

- Полный список мест с file:line.
- Категория: «должно быть исправлено в Phase 3.1» / «backlog с явным планом замены до live».
- Любое место категории «должно быть исправлено» — устраняется в этом же этапе через add-only-патч.

DoD A: оба deliverable созданы и приняты. Существующие Phase-2 платежи не сломаны (smoke).

---

## Этап B. Multi-account резолвер и общая инфраструктура

### B1. `_shared/stripe-account-resolver.ts`

- Вход: `account_code?: string | null` (default — из A1, обычно `default`).
- Выход: `{ secretKey, webhookSecret, accountCode, businessStream? }`.
- MVP: один аккаунт. Никакого хардкода вне резолвера. Маппинг `account_code → ENV name` — в одном месте.
- Шаблон будущих секретов: `STRIPE_SECRET_KEY__<ACCOUNT_CODE>`, `STRIPE_WEBHOOK_SECRET__<ACCOUNT_CODE>`. Реально добавляются только при появлении 2-го аккаунта.

### B2. `_shared/stripe-customer-resolver.ts`

- По `(account_code, user_id|email)` ищет/создаёт Stripe `Customer`.
- Хранит `customer_id` в `profiles.meta.stripe.customers[account_code]` (add-only JSON merge).
- Никогда не считает customer глобально уникальным.

### B3. Применение результатов A2

- Все «должно быть исправлено» места из hardcode-аудита переводятся на резолверы B1/B2.
- Никаких прямых `Deno.env.get('STRIPE_*')` в бизнес-логике.

### B4. Add-only расширения метаданных

- В `meta.stripe.*` (orders_v2, payments_v2, provider_subscriptions, subscriptions_v2) стандартизируем поля: `account_code`, `business_stream`, `customer_id`, `checkout_session_id`, `payment_intent_id`, `charge_id`, (для подписок — `subscription_id`, `schedule_id`, `latest_invoice_id`, `current_period_start/end`).
- Структуру таблиц не меняем.

DoD B: резолверы покрыты unit-тестами (где применимо), Phase-2 smoke прошёл, A2-патчи задеплоены.

---

## Этап C. Пилот «Платная консультация» (one-time + reuse карты)

### C1. Выбор пилотного оффера

- Продукт «Платная консультация».
- Один активный one-time `tariff_offer` помечается `meta.stripe_pilot = true`.
- bePaid-оффер остаётся параллельно.

### C2. `stripe-create-checkout` (consultation pilot)

- Если общий helper Phase 2 покрывает — расширяется параметрами `account_code?`, `business_stream?` (default — основной аккаунт).
- Иначе — тонкая обёртка `stripe-create-checkout-consultation` без дублирования бизнес-логики.
- Pre-create `orders_v2 (pending)` с полным `meta.stripe.*` (см. B4) и `tracking_id = stripe:cs_test_...`.

### C3. Webhook расширение (test-mode, add-only)

- `checkout.session.completed (mode=payment)` → confirm `orders_v2`, update `payments_v2`, call `grant-access-for-order`.
- `payment_intent.succeeded`, `charge.refunded` — уже из Phase 2 (после A2-патча).
- Идемпотентность — через `provider_events.event_id`.
- Конфликты (`order_id`/`customer`/`amount` mismatch) → HTTP 200 + `manual_review`, без INSERT.
- `account_code` резолвится только через webhook secret. При unknown secret → HTTP 200 + `provider_webhook_orphans`.

### C4. UI пилота

- В `PaymentDialog` Stripe-провайдер показывается **только при** `tariff_offer.meta.stripe_pilot = true` **И** `app_settings.stripe_pilot_enabled = true` (default OFF).
- Guest-checkout контракт не трогаем.

### C5. Customer Portal (MVP)

- Edge function `stripe-billing-portal-session`:
  - Вход: JWT user_id, `account_code?`.
  - Резолвит customer для аккаунта.
  - Возвращает URL `BillingPortal.Session`.
- В `/cabinet` (раздел «Платежи и подписки») — кнопка «Управление картами и подписками (Stripe)», видна только если у пользователя есть Stripe customer хотя бы в одном аккаунте.
- Свой UI карт/отмены не строим.

### C6. Runtime verification пилота (расширенный чек-лист)

Test-mode. Каждый пункт обязан показать в proof: `account_code`, `business_stream`, Stripe `customer_id`, Stripe `payment_intent_id`/`charge_id`.

**Платежи:**

1. Разовый платёж: Checkout Session создан, `account_code` корректный, `business_stream` присутствует.
2. Карта сохранена в правильном Stripe `Customer` (per-account).
3. `provider_events` без дублей.
4. `payments_v2` обновлён (status, amount, currency, provider_payment_id).
5. `orders_v2` → `paid` через `grant-access-for-order`, без manual INSERT прав.
6. Entitlement выдан, `expires_at` корректен.
7. UI кабинета показывает покупку и доступ.

**Повторное использование карты:**
8. Повторная покупка той же консультации тем же клиентом без повторного ввода карты (Checkout с saved PM).
9. Покупка другой консультации той же картой → тот же `Customer`, новый `PaymentIntent`, корректный entitlement.
10. Stripe `Customer` не задублирован между транзакциями того же пользователя в том же аккаунте.

**Customer Portal (5 сценариев):**
11. Portal открывается из кабинета.
12. Сохранённая карта видна.
13. История платежей видна.
14. Смена карты применилась (новый default PM в Stripe).
15. Обновление данных карты (CVC/exp) применилось.
(Сценарий «отмена подписки» — недоступен на этапе пилота, проверяется в C-этапе подписок.)

**Refund и smoke:**
16. Refund через `stripe-admin-refund` → `record_refund_atomic_multi` → `orders_v2.status = refunded` (или partial); `provider_events` записан.
17. bePaid-флоу на других продуктах в test-mode не сломан (smoke по 1 заказу bePaid).

Proof: `.lovable/proofs/stripe_phase_3_1_pilot_consultation_runtime_v1.md` (русский, с таблицей account_code/business_stream/IDs по каждому пункту).

DoD C: 17/17 PASS, флаг `stripe_pilot_enabled` остаётся OFF до отдельного решения о расширении.

---

## Этап D. Discovery совместимости подписок

Этап D **не начинается**, пока этап C не закрыт.

Проверить фактическое состояние и контракты:

- `subscriptions_v2` — какие поля используются как SOT, где `meta.*` хранит провайдер-специфичное, как ведут себя existing bePaid-подписки.
- `provider_subscriptions` — текущая семантика статусов, `tracking_id`, `meta`.
- `subscription-actions` — какие действия поддерживаются, ветки по провайдеру, контракт ошибок.
- `subscriptions-reconcile` / `nightly-access-reconcile` — точки входа провайдер-специфичной логики, overshoot guard'ы.
- `grant-access-for-order` — контракт extend-vs-create, Extend↔Tariff-Match SOT, провайдер-агностичность.
- `duplicate-subscription-prevention-guard` — текущие гарантии и точки расширения.

Deliverable: `.lovable/discovery/stripe_phase_3_1_subscriptions_compat_map_v1.md`:

- Карта точек расширения (add-only) для Stripe-подписок и Subscription Schedule.
- Список риск-зон (где можно случайно сломать bePaid).
- Чёткие границы: что меняется add-only, что не трогается.

DoD D: карта принята. Только после этого — этап E.

---

## Этап E. Подписки (Stripe Subscriptions + Subscription Schedule)

### E1. Helper'ы

- `_shared/stripe-subscription-resolver.ts` (per-account, маппинг `subscriptions_v2 ↔ Subscription`, finite installment ↔ `Subscription Schedule` через `meta.installment.{cycles_total, cycles_done}`).
- Расширение `duplicate-subscription-prevention-guard` (add-only): cross-provider проверка активной подписки по продукту (Stripe или bePaid).
- `_shared/provider-migration.ts` для контракта `cancel → supersede → create new`:
  - **Обязательный dry-run** — без `execute=true` функция только возвращает план, ничего не пишет.
  - **Блокировка массовых миграций**: жёсткий лимит 1 subscription за вызов; для >1 — отдельная отчётная функция batch-plan, тоже только dry-run.
  - Audit пишется и для dry-run, и для execute.
  - Proof любого execute-вызова — обязательный artifact в `.lovable/proofs/`.

### E2. Edge functions подписок

- `stripe-create-subscription-checkout` — `mode=subscription`, per-account, pre-create `subscriptions_v2` + `provider_subscriptions` в pending-аналоге.
- `stripe-create-subscription-schedule` — finite installment, `iterations=N`, `end_behavior=cancel`.
- `subscription-actions` / `admin-actions` — add-only ветки `provider=stripe`:
  - `cancel` → `cancel_at_period_end: true` (или `cancel_at` по контракту из D).
  - `pause`/`resume` — только если допустимо моделью; иначе — понятная ошибка.
  - `replace` → строго через `provider-migration.ts` (`cancel → supersede → create new`).

### E3. Webhook расширение для подписок

- События: `customer.subscription.{created,updated,deleted}`, `invoice.{created,paid,payment_failed,finalized}`, `customer.subscription.trial_will_end` (если применимо).
- Резолв `account_code` строго по webhook secret.
- Идемпотентность через `provider_events`.
- Конфликт → HTTP 200 + `manual_review`, без INSERT.
- `invoice.paid` → renewal `orders_v2` + `grant-access-for-order`. Extend по `tariff_id` (см. Extend↔Tariff Match SOT), иначе — новая подписка (контракт строго совпадает с bePaid).
- `bepaid-webhook` не трогаем.

### E4. Reconcile

- `nightly-access-reconcile` — add-only Stripe-ветка: pull `subscription.status` для активных `subscriptions_v2` с `meta.stripe.subscription_id`.
- Не перезаписывает `access_end_at`, если Stripe `current_period_end` уезжает дальше SOT (аналог bePaid overshoot guard).
- Reminders 7/3/1 — без изменений.

### E5. UI/Admin

- Кнопка «Управление подпиской» в кабинете → Customer Portal (C5) для Stripe-подписок.
- В `/admin/payments/links` — read-only badge провайдера.
- В `/admin` карточки подписки — провайдер-агностичная отрисовка, действия идут через `subscription-actions`.

### E6. Runtime verification подписок

Test-mode. Каждый пункт — с `account_code`, `business_stream`, Stripe IDs.

1. Infinite create + первый charge.
2. Renewal (`invoice.paid`) — extend по `tariff_id` без задвоения.
3. Failure (`invoice.payment_failed`) — корректный статус, доступ не отозван преждевременно.
4. Cancel-at-period-end через `subscription-actions` (UI кабинета).
5. Cancel-at-period-end через Customer Portal — то же поведение в БД.
6. Replace через `provider-migration.ts` (cancel→supersede→create new) с dry-run + execute, proof приложен.
7. Finite installment (`Subscription Schedule`, `iterations=2`) — оба charge приводят к корректным `orders_v2` и extend подписки.
8. Customer Portal — смена карты на активной подписке, следующий renewal проходит на новой карте.
9. Duplicate guard — попытка второй подписки на тот же продукт (Stripe → Stripe и Stripe → bePaid) блокируется.
10. Reconcile overshoot guard — Stripe ушёл дальше SOT, `access_end_at` не перезаписан, audit записан.

Proof: `.lovable/proofs/stripe_phase_3_1_subscriptions_runtime_v1.md` (русский).

DoD E: 10/10 PASS. Live-режим **не включается**.

---

## Этап F. Финальный end-to-end proof и закрытие Phase 3.1

### F1. Финальный proof

`.lovable/proofs/stripe_phase_3_1_final_v1.md` (русский) — обязательный реальный цикл:

1. Пилот one-time + reuse карты — реальный test-mode цикл по C6.
2. Подписка — реальный test-mode цикл по E6.
3. Customer Portal — все 5 сценариев по C6/E6.
4. Refund — реальный цикл.
5. bePaid smoke — не сломано.
6. Hardcode-аудит (A2) — все «должно быть исправлено» закрыты, backlog зафиксирован.
7. Multi-account — в каждом пункте показаны `account_code`, `business_stream`, Stripe IDs.
8. Provider migration — dry-run + execute с proof.

**Если хотя бы одно звено не подтверждено фактами — Phase 3.1 не закрывается.**

### F2. Memory update

Только после approve пользователя — фиксируем правила:

- Stripe = SOT по картам.
- Multi-account резолвер обязателен (никакого `Deno.env.get('STRIPE_*')` в бизнес-логике).
- Customer Portal = MVP self-service (5 сценариев).
- Cross-provider duplicate guard.
- `provider-migration.ts` с обязательным dry-run.

---

## Что **не** меняется

- `bepaid-*` функции и таблицы.
- `record_refund_atomic_multi`.
- Schema `subscriptions_v2` / `orders_v2` / `provider_subscriptions` (только `meta.*`).
- `src/integrations/supabase/client.ts`, `types.ts`, `.env`.
- Существующие RLS политики.
- Семантика существующих полей.

## Definition of Done всей Phase 3.1

1. Discovery A1 + hardcode-аудит A2 закрыты, патчи применены.
2. Резолверы B1/B2 покрывают весь Stripe-код, прямых `Deno.env.get('STRIPE_*')` в бизнес-логике нет.
3. Пилот C: 17/17 PASS.
4. Discovery D: карта совместимости подписок принята.
5. Подписки E: 10/10 PASS.
6. Финальный end-to-end proof F1 — все 8 звеньев подтверждены реальными test-mode фактами с account_code/business_stream/Stripe IDs.
7. bePaid не сломан.
8. Live-режим **не** включён.
9. Все proof и отчёты — на русском.