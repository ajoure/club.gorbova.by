## Phase 4.2 — Public Link Lifecycle Integrity = **FAIL**

- Discovery: `.lovable/discovery/stripe_public_links_lifecycle_v1.md`
- Proof: `.lovable/proofs/stripe_phase_4_2_lifecycle_audit_v1.md`
- Root cause: `stripe-webhook` НЕ вызывает `consume-payment-link` после terminal paid.
- Next: **Phase 4.3 — Stripe consume-payment-link integration** (точка вставки: handlers `checkout.session.completed` + `invoice.paid` в `supabase/functions/stripe-webhook/index.ts`).

Gate-результаты: G61 FAIL · G62 PARTIAL/BLOCKED-BY-G61 · G63 PASS · G64 PASS · G65 FAIL · G66a PASS create / FAIL consume · G66b PENDING (нет subscription stripe-eligible offer) · G67 NO.

---

да, согласен, с учетом правок:

1. **Не выполнять реальные bePaid оплаты в 4.2**

Для bePaid parity достаточно:

- существующая ссылка открывается;
- новая ссылка создаётся;
- GET/POST enforcement работает;
- historical proof по consume-payment-link.

Новые bePaid оплаты не запускать, чтобы не трогать реальный платёжный контур.

2. **Stripe оплаты тоже не делать без необходимости**

Phase 4.2 — lifecycle audit, но не обязательно заново оплачивать картой.

Порядок:

1. Discovery.

2. Если discovery показывает, что stripe-webhook не вызывает consume-payment-link,

   то G61/G65 сразу FAIL по структурной причине.

3. Не создавать лишние тестовые Stripe оплаты ради подтверждения уже найденного gap.

Если структурного gap нет — тогда делать минимальный Stripe test payment.

3. **G62 max_uses зависит от G61**

Если current_uses не инкрементится, то max_uses enforcement после оплаты тоже не может быть доказан.

В таком случае:

G61 = FAIL

G62 = BLOCKED-BY-G61

Не пытаться искусственно накрутить current_uses.

4. **G66 разделить на one-time и subscription**

Формат:

G66a Stripe one-time payment_link_id linkage

G66b Stripe subscription payment_link_id linkage

Если subscription оплаты не было — G66b = PENDING / N/A, а не общий FAIL.

5. **Не использовать admin-update-payment-link для истечения ссылки, если это write**

Для G63 можно проверять только уже существующую expired link или создать ссылку с коротким expires_at через штатный create flow.

Но не делать ручной UPDATE.

6. **Все тестовые ссылки после проверки можно инвалидировать только штатным admin-invalidate-payment-link**

Это допустимо.

Прямые UPDATE запрещены.

7. **Финальный статус Phase 4.2**

Если будет найдено, что stripe-webhook не вызывает consume-payment-link, то итог:

Phase 4.2 = FAIL

Root cause = Stripe webhook does not consume payment link after paid event

Next patch = Phase 4.3 — Stripe consume-payment-link integration

Это нормальный результат discovery.

После этих правок план можно выполнять.

&nbsp;

План: Phase 4.2 — Public Link Lifecycle Integrity

Scope: ТОЛЬКО discovery + runtime audit. Никаких правок кода, миграций, edge functions, схемы. Цель — доказать, что Stripe public links интегрированы в жизненный цикл ссылок так же, как bePaid (current_uses / max_uses / expires_at / status / consume / linkage).

Аккаунт для runtime тестов: [7500084@gmail.com](mailto:7500084@gmail.com).

---

## Этап 1. Discovery (read-only)

### 1.1 Карта lifecycle write-path'ей

Прочитать и зафиксировать, КТО и КОГДА изменяет колонки `payment_links`:

- `supabase/functions/_shared/consume-payment-link.ts` — единственный writer `current_uses`? Подтвердить grep'ом.
- `supabase/functions/bepaid-webhook/index.ts` — где вызывается `consumePaymentLink`, под какими условиями (terminal=paid, idempotency через `orders_v2.meta.payment_link_counted=true`).
- `supabase/functions/stripe-webhook/index.ts` — вызывается ли `consumePaymentLink`? Из Phase 4.1 known gap G-NEXT-1: НЕТ. Подтвердить актуальное состояние после 4.1.2.
- `admin-invalidate-payment-link` / `admin-update-payment-link` — write-paths для `status`/`expires_at`/`max_uses`.

### 1.2 Карта read/enforce-путей

- `public-checkout` (GET info + POST start) — какие проверки делает перед стартом checkout: `status='active'`, `expires_at > now()`, `current_uses < max_uses`. Проверить, что enforcement одинаков для обеих веток (раннее, ДО `params.provider === 'stripe'` early-dispatch).
- `_shared/create-payment-checkout.ts` Stripe-ветка — НЕ дублирует ли свои собственные lifecycle-проверки и не обходит ли их.
- `payment_links_enriched_v` — derived поля `is_expired`, `is_exhausted`, `is_invalid` (используются в админке).

### 1.3 Metadata linkage

- Подтвердить, что `payment_link_id` передаётся в Stripe metadata (one_time: `metadata.payment_link_id`, subscription: `metadata.payment_link_id` + `subscription_data.metadata.payment_link_id` — из proof 4.1).
- Проверить, читает ли `stripe-webhook` это metadata и куда пишет (`orders_v2.payment_link_id` колонка / `meta.payment_link_id`).
- Для bePaid: где `payment_link_id` появляется в `orders_v2` (writer-точка в `public-checkout` POST → `_shared/create-payment-checkout.ts`).

### 1.4 Запросы к БД (baseline + orphan-чек)

- Stripe orders без `payment_link_id` за период с момента 4.1.1 (исключая admin sandbox direct path, у которого `payment_link_id` принципиально NULL): фильтр `meta->>'provider'='stripe' AND meta->>'origin'!='admin_sandbox'`.
- `payment_links` со status='used' но `current_uses=0` (потенциальный orphan).
- `payment_links` с `paid_orders_count > current_uses` (рассинхрон счётчика).
- Для bePaid baseline по тем же запросам — сравнить пропорции.

Артефакт этапа: `.lovable/discovery/stripe_public_links_lifecycle_v1.md` с матрицей write/read paths, найденными гэпами и baseline-цифрами.

---

## Этап 2. Runtime Audit — 7 Gates

Все тесты на тестовых ссылках, минимальные суммы. Каждый gate фиксируется снимком SQL (до/после).

### G61 — current_uses increment

1. Создать новую Stripe one-time public link (offer Gorbova Club / CHAT, единственный Stripe-eligible — из proof 4.1.1), `max_uses=null`.
2. Зафиксировать `current_uses` до оплаты = 0.
3. Оплатить тест-картой Stripe `4242 4242 4242 4242`.
4. Дождаться `provider_events: checkout.session.completed` + `payment_intent.succeeded`.
5. Проверить `current_uses` после: ожидание =1 (PASS) / =0 (FAIL → подтверждение known gap G-NEXT-1).
6. Параллельный bePaid контроль: новая bePaid one-time link, оплата, `current_uses` =1.

### G62 — max_uses enforcement

1. Создать Stripe public link с `max_uses=1`.
2. Оплатить успешно → `current_uses` должен стать 1, статус ссылки derived `is_exhausted=true`.
3. Открыть тот же `/pay/:token` повторно → `public-checkout` GET должен вернуть error `link_exhausted` / `inactive`.
4. POST start → отказ ДО создания Stripe Session.
5. bePaid parity: тот же сценарий через bePaid link с `max_uses=1`.

### G63 — expires_at enforcement

1. Создать Stripe link с `expires_at = now() + 2 минуты`.
2. Подождать истечения (или вручную сдвинуть через `admin-update-payment-link`).
3. GET `/pay/:token` → error `link_expired`.
4. POST start → отказ.
5. bePaid parity.

### G64 — inactive link block

1. Создать Stripe link, оплату НЕ делать.
2. Через `admin-invalidate-payment-link` перевести status в `inactive`.
3. GET/POST `/pay/:token` → отказ для обеих веток.
4. bePaid parity на отдельной ссылке.

### G65 — consume-payment-link path

- Подтвердить grep'ом и edge function логами: для Stripe оплаты `consume-payment-link` вызывается из `stripe-webhook` (если 4.1 patch это добавил) или НЕ вызывается (если known gap G-NEXT-1 ещё открыт).
- Это диагностический gate: его результат напрямую определяет G61.
- Если FAIL — зафиксировать как backlog для Phase 4.3 (write fix), не правим в 4.2.

### G66 — payment_link_id linkage

1. Для каждой успешной Stripe-оплаты из G61/G62 проверить:
  - `orders_v2.payment_link_id` = id ссылки (one_time).
  - `subscriptions_v2.meta.payment_link_id` = id ссылки (subscription).
  - `provider_events.payload.data.object.metadata.payment_link_id` присутствует.
2. Stripe subscription public link: создать (если найдётся offer с `meta.stripe.price_id` и `is_recurring=true`), оплатить, проверить linkage в `subscriptions_v2` + `provider_subscriptions` + первый `invoice.paid` → `orders_v2.payment_link_id`.
3. Orphan-запрос из 1.4 повторить после тестов: дельта = 0 ожидается.

### G67 — bePaid parity

- Свести таблицу: для каждого gate G61-G66 — `bePaid: PASS/FAIL`, `Stripe: PASS/FAIL`, `parity: YES/NO`.
- Parity=NO допустим только для документированных gap'ов (G-NEXT-1 если ещё открыт).

---

## Этап 3. Отчёт

Артефакт: `.lovable/proofs/stripe_phase_4_2_lifecycle_audit_v1.md`

Структура:

- Per-gate: команда/действие, ожидание, факт, PASS/FAIL, SQL-снимок, edge function log refs.
- Итоговая матрица 7 gate × 2 провайдера.
- Если есть FAIL — точка отказа, файл/строка, и предложение для Phase 4.3 (write fix, отдельный sprint, НЕ в 4.2).
- Update `.lovable/plan.md`: Phase 4.2 = PASS / FAIL.

Формат финального ответа пользователю:

```
G61 current_uses increment   = PASS/FAIL  (Stripe: …, bePaid: …)
G62 max_uses enforcement     = PASS/FAIL
G63 expires_at enforcement   = PASS/FAIL
G64 inactive link block      = PASS/FAIL
G65 consume-payment-link     = PASS/FAIL
G66 payment_link_id linkage  = PASS/FAIL
G67 bePaid parity            = PASS/FAIL
```

---

## STOP-guards

- Если discovery (этап 1.3) покажет, что `stripe-webhook` НЕ вызывает `consume-payment-link` — G61/G65 ожидаемо FAIL. НЕ правим в рамках 4.2: фиксируем как Phase 4.3 backlog с точной строкой вставки. Это исследовательский этап.
- Если для Stripe subscription public link нет eligible offer (`meta.stripe.price_id`) — G66 subscription-часть помечается N/A с пояснением (offer mapping = Phase 5 backlog).
- Любая правка кода в рамках 4.2 запрещена. Только админ-действия через существующие edge functions (`admin-invalidate-payment-link`, `admin-update-payment-link`) и runtime checkout.

## DoD

- Discovery файл создан.
- Proof файл создан с 7 gate-результатами и SQL-снимками.
- `.lovable/plan.md` обновлён.
- Финальный отчёт пользователю в указанном формате.
- 0 правок в production-коде, 0 миграций.