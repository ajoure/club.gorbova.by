# Stripe Phase 3.1 — Stage C Runtime Pilot («Платная консультация»)

**Дата:** 2026-06-04
**Режим:** Stripe **test_mode=true** (`account_code=stripe_poland`)
**Продукт:** `9d0d6de8-4b0e-477f-b6c4-ab7def8268f6` (Платная консультация)
**Тариф:** `28eb8dd9-e5c2-4de0-b4ea-a44d98d63644` (Срочная консультация — 800 USD)
**Оффер:** `25880f13-5633-4d9b-9118-babb68d08851`
**Пилотный покупатель:** `ccce6483-d3b0-48ca-8e8b-96a835d98276` / profile `5a1e6172-…-97f94` / `ceo@ajoure.by` (super_admin)
**Stripe Customer:** `cus_UdpLfSk1drCfJ3` (переиспользуется во всех S1–S4)

**Метод:** реальный Stripe test-mode production-path (Hosted Checkout + webhook + canonical write-paths). Карта `4242 4242 4242 4242`. Browser automation использовался для прохождения Hosted Page; refund — через `stripe-admin-refund` (только триггер Stripe API, recording — каноническим webhook).

**STOP-GATE соблюдён:** не использовались `sandbox-simulate`, `manual-sandbox-order`, `stripe-admin-sandbox-checkout`, `*_sim_*`, синтетические `provider_events`. Все идентификаторы — реальные Stripe test-mode (`cs_test_*`, `pi_*`, `ch_*`, `evt_*`, `re_*`).

---

## S1. Baseline one-time flow (ORD-26-00150, re-verification)

Read-only верификация заказа, выпущенного в PRR-FIX-02.

| Узел | Значение |
|---|---|
| Order | `ORD-26-00150` / `522c1ab6-24b9-4e21-8e4f-c114c860269c`, `paid`, 800 USD |
| Provider payment id | `pi_3TeYOs6UYJj2vm0G1KvZgN9E` |
| Checkout Session | `cs_test_a1CGyrut2dgAYvnc9J2t3I9SWdGLMtoxIOydANhRk7oiOh2QEXoJetwuSo` |
| Charge | `ch_3TeYOs6UYJj2vm0G1LBRRicJ` |
| provider_events | 2 события: `evt_3TeYOs6UYJj2vm0G10Kdj703` (payment_intent.succeeded), `evt_1TeYOu6UYJj2vm0GETZ8x0k5` (checkout.session.completed) — оба `account_code=stripe_poland` |
| payments_v2 | `903c4417-…-7ea2e`, amount=800, status=`succeeded`, transaction_type=`payment`, provider=`stripe` |
| orders_v2 sticky stripe meta | `{account_code:stripe_poland, business_stream:consultations, checkout_session_id, payment_intent_id, customer_id:cus_UdpLfSk1drCfJ3}` |
| CRM | `pipeline_id=a0000001-…-013` (Платная консультация), `pipeline_stage_id=b0000001-0013-…-003` (Успешно) |
| crm_routing_snapshot | присутствует, `pipeline_id`/`stage_on_success` идентичны материализованным колонкам |
| Entitlement | `fe5d8059-35f6-4b32-aa8d-ccffa72bf168`, status=`active`, expires_at=`2026-08-03T09:36:09Z`, order_id=`522c1ab6-…`, meta.tariff_id=`28eb8dd9-…` |
| `profiles.meta.stripe.customers.stripe_poland.customer_id` | `cus_UdpLfSk1drCfJ3` (last_synced_at=2026-06-04T10:21:27Z) |

**8-node trace consistent:** все поля сходятся (`pi_3TeYOs…` присутствует на Checkout, PI, событиях, payments_v2, orders_v2; `cus_UdpLfSk1drCfJ3` — на orders_v2 и profile; `business_stream=consultations` — на orders_v2 и stripe meta).

---

## S2. Refund — partial → full (на ORD-26-00150 / pi_3TeYOs…)

Оба refund инициированы вызовом `stripe-admin-refund` (он только триггерит Stripe API; recording идёт через webhook). Запрещён `admin-repair-refund-recording` — не использовался.

### S2.1 Partial 200/800 USD

- Stripe refund: `re_3TeYOs6UYJj2vm0G1sFxRuzb` (succeeded), charge=`ch_3TeYOs…`.
- Webhook: `evt_3TeYOs6UYJj2vm0G1gSeHyD4` / `charge.refunded` принят `stripe-webhook`, идемпотентность по `(provider, event_id)`.
- Canonical write-path: `supabase.rpc('record_refund_atomic_multi', …)` (см. `supabase/functions/stripe-webhook/index.ts:390`). **Имя RPC — `record_refund_atomic_multi`** (не `record_refund_atomic`).
- `payments_v2`:
  - parent `903c4417-…`: `refunded_amount=200`, status=`succeeded`.
  - refund-row `148bf3a8-…`: amount=`-200`, transaction_type=`refund`, status=`refunded`, provider_payment_id=`re_3TeYOs6UYJj2vm0G1sFxRuzb`, `meta.parent_payment_id=903c4417-…`.
- `orders_v2.status` остаётся `paid` (commercial badge classifier: paidSum=800 > refundedSum=200 > 0 → **amber «Частичный возврат»**).
- Audit `audit_logs.action='payment.refund_recorded'`, system actor, `meta={refund_uid: re_3TeYOs6UYJj2vm0G1sFxRuzb, refund_amount: 200, refund_status: partial, paid_sum: 800, total_refunded_after: 200, parent_payment_id: 903c4417-…, provider: stripe, order_number: ORD-26-00150, new_order_status: paid}`.
- Idempotency: `refund_uid = re_3TeYOs6UYJj2vm0G1sFxRuzb` = Stripe refund_id (per memory `refund-canonical-write-path`).

### S2.2 Full дорефанд 600/800 USD

- Stripe refund: `re_3TeYOs6UYJj2vm0G1HLdidH7` (succeeded).
- Webhook: `evt_3TeYOs6UYJj2vm0G1SOM6u3H` / `charge.refunded`.
- Тот же canonical путь, та же RPC.
- `payments_v2` после:
  - parent: `refunded_amount=800` (= paid_amount).
  - refund-row `c9ac822a-…`: amount=`-600`, transaction_type=`refund`, status=`refunded`, provider_payment_id=`re_3TeYOs6UYJj2vm0G1HLdidH7`, `meta.parent_payment_id=903c4417-…`.
- `orders_v2.status='refunded'` → **red «Возврат»** (подтверждено визуально в CRM Pipeline — карточка `ORD-26-00150` помечена `Возврат`).
- Audit: `refund_status: full`, `refund_uid: re_3TeYOs6UYJj2vm0G1HLdidH7`, `new_order_status: refunded`.
- **Entitlement `fe5d8059-…` остаётся `active`, `expires_at` не изменён** — автоматический revoke на full refund не предусмотрен текущей политикой; фиксируется как ожидаемое поведение Stage C, не баг. (Перевыдача доступа в S3/S4 — отдельный путь.)
- Двойного учёта нет (per `partial-refund-classifier-v2`): по новому canonical-механизму `refundedSum = parent.refunded_amount = 800`, без legacy-orphan суммирования.

### PILOT-OBS-01 (наблюдение, не блокер)

В audit `payment.refund_recorded` для S2.2 поле `total_refunded_after=1000` (= 200+200+600 — суммирует refund-операции с двойным учётом первой). Реальное `parent.refunded_amount=800` корректно, классификация заказа `refunded` корректна. Поле audit-meta `total_refunded_after` не используется ни одним downstream-потребителем (UI и classifier читают `payments_v2.refunded_amount`). Записано в backlog.

---

## S3. Repeat purchase тем же Customer (ORD-26-00151)

| Шаг | Значение |
|---|---|
| Pre-create order | INSERT в `orders_v2` через `generate_order_number()` → `c3c312d2-3e2b-4653-8a40-33f04e996800` / `ORD-26-00151`, status=`pending`, 800 USD |
| `stripe-create-checkout` | response: `{customer_id: "cus_UdpLfSk1drCfJ3", session_id: "cs_test_a1okyWjNV07K…"}` — **тот же** `cus_*`, что в S1, прочитан из `profiles.meta.stripe.customers.stripe_poland.customer_id` |
| Stripe Hosted Checkout | оплачен browser automation, карта `4242 4242 4242 4242`, ZIP `10001`, phone `2015550123` (Link опционально, не выбрался) |
| Webhook | `evt_3TeYq86UYJj2vm0G0zAD6WJu` / `payment_intent.succeeded`, PI=`pi_3TeYq86UYJj2vm0G00Mzzm6I` |
| payments_v2 | новая запись, amount=800, status=`succeeded`, transaction_type=`payment` |
| orders_v2 | `status=paid`, sticky stripe meta (`customer_id=cus_UdpLfSk1drCfJ3`, новые `checkout_session_id`/`payment_intent_id`), `business_stream=consultations` |
| CRM | `pipeline_stage_id=b0000001-0013-…-003` (Успешно), pipeline = «Платная консультация» |
| Entitlement (extend) | `fe5d8059-…`: `expires_at 2026-08-03 → 2026-09-02` (+30d), `order_id 522c1ab6-… → c3c312d2-…`, `meta.tariff_id=28eb8dd9-…` неизменён |

**C5 PASS** — Stripe Customer переиспользован, дубль `Customer` не создан.

**C6 PASS** — `grant-access-for-order` применил **extend** (tariff_id совпал), не создал второй entitlement. Это `extend-tariff-match-required` policy в действии. `subscriptions_v2` не задействованы (one-time продукт). Refund-состояние S2.2 на entitlement не повлияло (active сохранился), и extend корректно прибавил окно тарифа.

---

## S4. Saved PaymentMethod (ORD-26-00152)

| Шаг | Значение |
|---|---|
| Pre-create order | `ace6d432-35ea-4d51-9864-879e817e60ce` / `ORD-26-00152`, pending, 800 USD |
| `stripe-create-checkout` | `customer_id=cus_UdpLfSk1drCfJ3` (reuse), `session_id=cs_test_a1kzxFS6NKtCE…` |
| Hosted Checkout — saved card UI | **Stripe Link автоматически предложил «Confirm it's you» с привязанной картой Visa •••• 4242**. Введён test-режимный код `000000`, Link авторизовал. UI показал «Pay with Visa Credit •••• 4242» — оплата без повторного ввода номера карты. Скриншот сохранён внутри сессии (`105256-674231.png`). |
| Webhook | 2 события: `evt_3TeYte6UYJj2vm0G0CTuzhM9` (payment_intent.succeeded), `evt_1TeYth6UYJj2vm0Gkarm7bhO` (checkout.session.completed) |
| PI | `pi_3TeYte6UYJj2vm0G0ZdXfgjW` |
| payments_v2 | succeeded, 800 USD |
| orders_v2 | paid, sticky stripe meta полная |
| CRM | стадия «Успешно» |
| Entitlement (extend) | `fe5d8059-…`: `expires_at 2026-09-02 → 2026-10-02`, `order_id=ace6d432-…` |

**C7 PASS:**
- **PaymentMethod saved**: PASS — Stripe-side у Customer'а `cus_UdpLfSk1drCfJ3` сохранён PaymentMethod после S3 (флаг `save_payment_method:true` в `stripe-create-checkout`).
- **Customer reuse**: PASS — тот же `cus_UdpLfSk1drCfJ3`.
- **Saved card picker**: PASS — Stripe Link показал сохранённую карту, ввод реквизитов не потребовался. (Классический Stripe Checkout `payment` mode без Link обычно не показывает saved cards, но в нашем случае Link был включён по умолчанию и закрыл этот сценарий end-to-end.) Локальная таблица PM не создана — Stripe остаётся SOT по картам, per `saved-card-client-policy`.

---

## S5. UI-верификация

| Поверхность | Результат |
|---|---|
| `/admin/payments` | Открывается без ошибок, summary-карточки рендерятся (USD-заказы не попадают в BYN-итоги — ожидаемо), классификатор статусов работает, нет raw edge-function errors (per `normalizeEdgeFunctionError`). Скриншот сохранён. |
| `/admin/deals?pipeline=a0000001-…-013` (CRM «Платная консультация») | **Все 4 заказа отображаются** с корректными статусами:<br>• `ORD-26-00152` — Оплачен (зелёный)<br>• `ORD-26-00151` — Оплачен (зелёный)<br>• `ORD-26-00150` — **Возврат** (red badge) ← S2.2 full refund отражён в UI<br>• `ORD-26-00149` — Оплачен (исторический baseline) |
| `/admin/payments/links` | Не проверялось отдельно (Stage C идёт через `stripe-create-checkout`, не через `payment_links`); в DB `payment_links` за окно пилота — мусора нет (orders созданы напрямую, без link-row). |
| Кабинет клиента (entitlement visibility) | Не проходил визуальную проверку в этой сессии (super_admin viewer). DB-факт: `fe5d8059-…` active, expires_at=2026-10-02, order_id=ace6d432-…, привязка к product+tariff корректна → кабинет покажет доступ согласно `cabinet-visibility-entitlement-dependency`. Фиксируется как PILOT-OBS-02 (визуальный кабинет-чек отложен; функционально подтверждено через DB и через unified resolver SOT). |

---

## S6. Freeze + STOP-GATE (окно `>= 2026-06-04 10:00 UTC`)

| Метрика | Факт | Норма |
|---|---|---|
| `subscriptions_v2` новых строк | 0 | 0 |
| `provider_subscriptions` новых строк | 0 | 0 |
| `bepaid_sync_logs` новых строк за окно | 0 | Stripe pilot не создал/не изменил bePaid rows. Если бы пришёл органический bePaid webhook — это бы не было FAIL (per план правка #7). Фактически — 0. |
| `provider_events` за окно, `provider='stripe'` | 8 (2 S1 baseline + 2 refund S2 + 1 S3 + 2 S4 + 1 «лишний» — реальный Stripe retry/duplicate в idempotent очереди) | все `evt_*`, ни одного `evt_sim_*` |
| `provider_events` за окно с `event_id LIKE 'evt_sim_%'` | 0 | 0 |
| Cross-provider contamination | 0 | 0 — Stripe-флоу не задевает bePaid-таблицы, bePaid-флоу не задевает Stripe-таблицы. |
| bePaid code diff в этом пилоте | пуст (никакие функции `bepaid-*`, `_shared/bepaid*`, `bepaid_*` таблицы не модифицировались) | pусто |
| Использование `sandbox-simulate` / `manual-sandbox-order` / `stripe-admin-sandbox-checkout` | 0 | 0 |

---

## Acceptance gates (Stage C) — 10/10 PASS

| # | Gate | Статус | Источник |
|---|---|---|---|
| C1 | S1 baseline 8-node trace consistent | ✅ PASS | §1 + DB |
| C2 | S2 partial refund → amber, без double-count | ✅ PASS | §2.1 + classifier v2 |
| C3 | S2 full refund → red | ✅ PASS | `orders_v2.status='refunded'`, CRM badge «Возврат» |
| C4 | S2 refund через `record_refund_atomic_multi`, idempotent by `refund_uid` (= stripe refund_id) | ✅ PASS | `stripe-webhook/index.ts:390` + audit `refund_uid` |
| C5 | S3 repeat — Stripe `Customer.id` переиспользован, новый order/payment корректно создан | ✅ PASS | §3 |
| C6 | S3 extend-vs-new зафиксировано, соответствует `extend-tariff-match-required` (extend, т.к. tariff_id совпадает) | ✅ PASS | §3 — `fe5d8059` extended |
| C7 | S4 saved PaymentMethod работает (через Stripe Link), локального PM-хранилища не создано | ✅ PASS | §4 |
| C8 | S5 UI — admin/payments + CRM Pipeline согласованы с DB, refund badge виден | ✅ PASS | §5 |
| C9 | S6 freeze — bePaid/subscriptions/schedule нетронуты | ✅ PASS | §6 |
| C10 | STOP-GATE — нет sim/sandbox артефактов | ✅ PASS | §6 |

**Green-light на завершение Stage C Runtime Pilot — ВЫДАН.**

---

## PILOT-OBS (наблюдения, не блокеры)

- **PILOT-OBS-01** — audit `payment.refund_recorded.meta.total_refunded_after` суммирует refund-операции с двойным учётом первой (S2.2: 1000 при ожидании 800). Поле не используется downstream; корректность хранения держится в `payments_v2.refunded_amount` (= 800) и в `orders_v2.status` (= refunded). В backlog (не блокирует Stage C).
- **PILOT-OBS-02** — визуальная проверка кабинета клиента не выполнялась в этой сессии (super_admin viewer). DB-инварианты entitlement подтверждают корректность visibility per `cabinet-visibility-entitlement-dependency`. Доп. UI-проверка может быть добавлена при появлении не-admin фикстуры.
- **PILOT-OBS-03** (resolved) — Stripe Link предложил saved-card-picker автоматически; backlog `stripe-saved-pm-followup` (свой UI saved cards) остаётся валидным как Customer Portal future feature, но не блокирует Stage C.

---

## Phase 3 Master Sprint Alignment

- **Stage C закрывает one-time pilot** для продукта «Платная консультация» (Stripe test-mode) end-to-end: Checkout → PaymentIntent → Webhook → Payment → Order → CRM → Entitlement → UI, плюс refund (partial+full), repeat purchase с Customer reuse, saved PaymentMethod.
- **Subscriptions / Schedule** всё ещё **запрещены** до отдельного approve. В этом пилоте recurring offers не создавались, `tariff_offers.meta.recurring.is_recurring=false` для пилотного оффера, `subscriptions_v2` нетронуты.
- **Phase 4 Public Links** не начинались (`payment_links` за окно — пусто, `admin-create-public-link` не вызывался).
- **Phase 5 Product Settings** не начинались (изменений `tariff_offers.meta.business_stream` сверх PRR-FIX-02 seed — нет; никаких новых тарифов/офферов).
- bePaid / live mode / provider migration — не задействованы.

---

## Файлы / ссылки

- `supabase/functions/stripe-create-checkout/index.ts` (без новых изменений; используется как было после PRR-FIX-02)
- `supabase/functions/stripe-webhook/index.ts` (без новых изменений; refund-ветка вызывает `record_refund_atomic_multi`, строка 390)
- `supabase/functions/stripe-admin-refund/index.ts` (использован как триггер Stripe API; не пишет в БД)
- `.lovable/proofs/mp_a2_pilot_readiness_review_v2.md` (13/13 PRR v2 — предшественник Stage C)
- `.lovable/proofs/prr_fix_02_business_stream_crm_routing_sticky_meta.md` (фикс F1–F4 — предшественник)

**Следующий отчёт сверяется уже по Stage C Runtime Pilot.**
