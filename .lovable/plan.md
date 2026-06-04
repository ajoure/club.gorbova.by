да, согласен, с учетом правок:

```text
План Stage C Runtime Pilot можно approve.

Правки перед execute:

1. Не использовать слово “production-like” без уточнения.
   Это test-mode pilot. Формулировать:
   test-mode production-path proof.

2. S2 Refund:
   Если refund инициируется через Stripe Dashboard, обязательно проверить, что webhook refund-ветка сработала сама.
   Нельзя закрывать refund через backfill/reconcile вместо webhook.
   Reconcile допустим только как диагностика, но не как PASS.

3. S2 Refund:
   Не писать `record_refund_atomic`, если фактически используется `record_refund_atomic_multi`.
   В proof указать точное имя RPC/функции.

4. S3/S4:
   Если Stripe Checkout не показывает saved card picker, это не FAIL Stage C.
   Тогда Stage C должен зафиксировать:
   - Customer reuse PASS;
   - PaymentMethod saved PASS;
   - Saved card picker GAP, already backlog.
   Нельзя блокировать Stage C из-за known Stripe Checkout limitation.

5. S3/S4:
   Не требовать от пользователя ручной оплаты, если browser automation доступен.
   Подрядчик уже доказал, что browser automation работает.
   Он должен сам открывать Hosted Page и платить картой 4242.
   STOP “ждём пользователя” допустим только если browser automation реально недоступен и это подтверждено в proof.

6. S5 UI:
   Обязательно проверить не только `/admin/payments`, но и:
   - CRM pipeline карточку сделки;
   - карточку заказа/оплаты, если есть detail drawer;
   - кабинет пользователя.
   Если какого-то UI нет — фиксировать как GAP, а не silently skip.

7. S6 Freeze:
   `bepaid_sync_logs=0` за окно — не универсальный критерий.
   Если в период теста пришёл органический bePaid webhook, это не FAIL.
   Правильный критерий:
   - Stripe pilot не создал/не изменил bePaid rows;
   - bePaid code diff пустой;
   - cross-provider contamination = 0.

8. Acceptance gates:
   C7 переписать:
   - PaymentMethod saved = PASS;
   - Customer reuse = PASS;
   - saved card picker = PASS или GAP, но не блокер.

9. Добавить отдельный раздел:
   Phase 3 Master Sprint Alignment
   - Stage C закрывает one-time pilot.
   - Subscriptions/Schedule всё ещё запрещены до отдельного approve.
   - Phase 4 Public Links не начинались.
   - Phase 5 Product Settings не начинались.

После этих правок можно запускать Stage C Runtime Pilot.

План: Stage C Runtime Pilot — «Платная консультация»
```

## Цель

Подтвердить полный production-like жизненный цикл Stripe one-time платежа на пилотном продукте «Платная консультация» (test-mode), включая refund, повторную покупку и saved PaymentMethod. Результат — единый proof-документ на русском.

## Scope (жёсткие границы)

- Только продукт «Платная консультация» (`product_id = 9d0d6de8-...`).
- Только Stripe test-mode (`acquiring_connections.account_code = stripe_poland`, `test_mode = true`).
- Только реальные Stripe test-объекты (карта `4242 4242 4242 4242`).
- Freeze: bePaid, Subscriptions, Schedule, provider migration, live mode — не трогаем.
- STOP-GATE: запрещены `sandbox-simulate`, `manual-sandbox-order`, `*_sim_*`, синтетические `provider_events`.

## Структура пилота — 6 сценариев

### S1. Baseline one-time flow (re-confirmation на ORD-26-00150)

Реальный заказ `ORD-26-00150` уже прошёл E2E в PRR-FIX-02. В Stage C — пере-верифицируем его как baseline без новой оплаты:

- 8-узловой trace: Checkout Session → PaymentIntent → Charge → `provider_events` → `payments_v2` → `orders_v2` → CRM (`crm_pipelines`/`crm_pipeline_stages`) → `entitlements`.
- UI-проверка: `/admin/payments` показывает заказ как paid с правильным `business_stream=consultations`; кабинет клиента показывает активный entitlement.
- Anti-orphan 6/6.

### S2. Refund (partial → full)

1. Через Stripe Dashboard (test-mode) сделать **частичный** refund на `pi_3TeYOs6UYJj2vm0G1KvZgN9E` (например, 200 из 800).
2. Дождаться `charge.refunded` webhook → проверить:
  - запись в `provider_events` (idempotent по `event_id`);
  - вызов `record_refund_atomic` (canonical write-path);
  - `payments_v2.refunded_amount = 200`, refund-row создан с `meta.parent_payment_id`;
  - `orders_v2` — amber «Частичный возврат» (per partial-refund classifier v2, без double-count);
  - entitlement **не отзывается** (partial refund);
  - audit `record_refund_atomic` с `refund_uid`.
3. Далее — **дорефанд** остатка (600 из 800) → full refund:
  - `payments_v2.refunded_amount = 800`;
  - `orders_v2` — red «Возврат»;
  - решение по entitlement — зафиксировать фактическое поведение (по текущей политике entitlement остаётся, revoke не автоматичен — это документируем как наблюдаемое поведение, не как баг).

### S3. Repeat purchase тем же Customer

1. Создать новый Stripe Checkout Session через `stripe-create-checkout` для того же super_admin-профиля и того же тарифа «Срочная консультация — 800».
2. Проверить: `stripe-create-checkout` переиспользует существующий `Customer.id` (`cus_UdpLfSk1drCfJ3`) из `profiles.meta.stripe.customers[stripe_poland].customer_id`, **не создаёт** дубль `Customer`.
3. Оплатить картой `4242 4242 4242 4242`. Получить `ORD-26-00151`.
4. Verify: новый отдельный `orders_v2` + `payments_v2` + новый `entitlement` (или extend — по политике `extend_tariff_match` для consultation тарифа). Зафиксировать фактический режим (extend vs new) и сверить с `extend-tariff-match-required` memory rule.
5. CRM: новая сделка в pipeline `a0000001-...-013`, стадия «Успешно».

### S4. Saved PaymentMethod

1. На третьей покупке проверить, что Stripe Checkout показывает сохранённую карту (`Customer` уже имеет PaymentMethod после S1/S3 — Stripe-side SOT).
2. Оплатить выбором saved card (без ввода номера).
3. Verify: оплата проходит, `payment_method` в `PaymentIntent` соответствует ранее сохранённому `pm_*`. Локально дополнительной таблицы PM не ведём (per saved-card-client-policy + stripe-saved-pm-followup backlog).
4. Получить `ORD-26-00152`. Полный 8-node trace.

### S5. UI-верификация (admin + cabinet)

По всем заказам S1–S4:

- `/admin/payments` — корректные суммы, статусы, refund badge, sticky Stripe meta видна в детальном просмотре.
- `/admin/payments/links` — не появилось мусорных записей (Stage C идёт через `stripe-create-checkout`, не через payment_links).
- Cabinet клиента — entitlements активны/refund-состояния отражены корректно.
- CRM kanban (Pipeline «Платная консультация») — сделки в правильных стадиях.
- Никаких raw edge-function errors в UI (normalizeEdgeFunctionError соблюдён).

### S6. Freeze-инварианты + STOP-GATE

За окно пилота (час+):

- `subscriptions_v2` — 0 новых записей;
- `provider_subscriptions` — 0 новых;
- `bepaid_sync_logs` — 0 новых;
- `provider_events` — все с реальными Stripe `evt_*` id, ни одного `evt_sim_*`;
- никаких вызовов `sandbox-simulate` / `manual-sandbox-order` в логах edge functions.

## Acceptance gates (Stage C)


| #   | Gate                                                                                  | Источник доказательства                                                |
| --- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| C1  | S1 baseline 8-node trace consistent                                                   | DB-query + memory `unified-resolver-sot`                               |
| C2  | S2 partial refund → amber, без double-count                                           | `payments_v2`, `orders_v2.meta`, partial-refund-classifier-v2 proof    |
| C3  | S2 full refund → red                                                                  | `payments_v2.refunded_amount = paid_amount`                            |
| C4  | S2 refund идёт через `record_refund_atomic` (idempotent by `refund_uid`)              | `audit_logs` + memory `refund-canonical-write-path`                    |
| C5  | S3 repeat — переиспользован `Customer.id`, новый order/payment корректно создан       | Stripe + DB                                                            |
| C6  | S3 решение extend-vs-new зафиксировано и соответствует `extend-tariff-match-required` | `subscriptions_v2`? (для one-time consultation — N/A) + `entitlements` |
| C7  | S4 saved PM работает, локального PM-хранилища не создано                              | Stripe Checkout UI + DB (no new table)                                 |
| C8  | S5 UI — admin + cabinet + CRM согласованы                                             | визуальная проверка + DB cross-check                                   |
| C9  | S6 freeze — bePaid/subscriptions/schedule нетронуты                                   | DB-query за временное окно                                             |
| C10 | STOP-GATE — нет sim/sandbox артефактов                                                | `provider_events` фильтр + edge logs                                   |


**Green-light на завершение Stage C:** C1–C10 = PASS (10/10).

## Deliverable

`.lovable/proofs/stripe_phase_3_1_pilot_consultation_runtime_v1.md` (на русском):

- Все 6 сценариев с реальными ID (cs_test_*, pi_*, ch_*, evt_*, ORD-*, refund-uid).
- 8-node trace для каждого заказа.
- Refund-таблица (partial → full) с суммами и таймстемпами.
- Customer reuse доказательство (`cus_*` тот же).
- Saved PM доказательство.
- Freeze-блок и STOP-GATE-блок.
- Итоговая таблица C1–C10.

## Технические детали

- Запуск checkout: вызов `stripe-create-checkout` (frontend через PaymentDialog либо direct curl с super_admin JWT). **Не** `sandbox-simulate`.
- Refund: инициируется из Stripe Dashboard (test-mode) → принимается через уже задеплоенный `stripe-webhook` (имеет refund-ветку с `record_refund_atomic`).
- Все DB-проверки — через `supabase--read_query` (read-only).
- Если по ходу обнаружится дефект → останавливаемся, фиксируем как `PILOT-FIX-NN` в proof, не маскируем.

## Что НЕ делаем

- Не пишем код (если только не выявлен блокер — тогда отдельный mini-plan PILOT-FIX).
- Не трогаем bePaid / Subscriptions / Schedule / live mode / provider migration.
- Не создаём новых таблиц (saved PM остаётся Stripe-side per memory).
- Не модифицируем `record_refund_atomic`, `grant-access-for-order`.

## Очерёдность выполнения

1. S1 re-verification (read-only DB) → ~5 мин.
2. **STOP — ждём пользователя**: запросить выполнение partial refund в Stripe Dashboard на `pi_3TeYOs…` (S2 шаг 1).
3. S2 partial verify → запросить full refund → S2 full verify.
4. **STOP — ждём пользователя**: запросить оплату нового Checkout (S3) — выдадим URL.
5. S3 verify.
6. **STOP — ждём пользователя**: запросить оплату ещё одного Checkout с saved card (S4) — выдадим URL.
7. S4 verify.
8. S5 UI cross-check, S6 freeze + STOP-GATE.
9. Сборка proof-документа → итоговый отчёт.

После approve этого плана — переходим к S1 (read-only baseline).