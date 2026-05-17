# Отчет о выполнении: PATCH-RB2 dry-run по 3 historical REBILL-кейсам (read-only)

## Контекст

PATCH-RB1.1 закрыт условно успешно (`BEPAID_REBILL_MATERIALIZATION=on`, base_price bug fixed, webhook redeployed). Этот патч — строго read-only dry-run для 3 платежей, которые либо приклеились к parent-order, либо требуют уточнения ID. Никакого DML, никаких записей в `audit_logs`, никаких вызовов `grant-access-for-order` / Telegram / provider API / secrets.

Все три кейса — продукт Gorbova Club (`11c9f1b8-0355-4753-bd74-40b42aa53616`), `payment_flow=provider_managed_checkout`, `payments_v2.is_recurring=true`.

---

## Кейс 1 — Юлия Смолик (uid `113f7667…`) — manual_review_uid_mismatch

### 1. Identification (фактическое состояние БД)
- profile_id: `00339a5f-d24d-4621-8ae6-a990a5e0bdcb`, user_id: `523168b2-bada-48a1-aeae-5d032d632918`, email: `sm_ulik@mail.ru`, name: «Юлия Смолик».
- product_id: `11c9f1b8-…` (Gorbova Club), tariff_id: `31f75673-a7ae-420a-b5ab-5906e34cbf84`.
- Поиск uid `113f7667-…` в `payments_v2.id`, `payments_v2.provider_payment_id`, `orders_v2.id`, `orders_v2.provider_payment_id` — **0 совпадений**. ID, заявленный в RB2 scope, в БД отсутствует.

### 2. Subscription chain
- `subscriptions_v2.eaeb666b-11d3-4204-bef8-bb72fca78743`: order_id `ec268cfd-…` (SUB-26-MMTCP96J752X, paid 2026-03-16), tariff `31f75673`, billing_type=`provider_managed`, auto_renew=true, status=active, access_start `2026-03-16 15:42:58Z`, access_end `2026-05-17 20:59:59Z`, next_charge `2026-05-17 20:59:59Z`, meta sbs `sbs_24a63b26faa60b63`.
- `provider_subscriptions` (sbs_24a63b26faa60b63): **state=`canceled`**, next_charge_at `2026-04-15 15:42:17Z` (в прошлом), last_charge_at `NULL`, amount_cents 10000.
- На orders_v2 `ec268cfd` — ровно 1 успешный платёж (`2faec8a6…`, uid `d6a21281…`, 2026-03-16 15:43, installment_number=1). Никаких repeat-платежей провайдер так и не списал.
- Прочие платежи Юлии (`9dfdd0ac`/2026-04-26, `9fefd5e4`/2026-03-19) привязаны к отдельным разовым ордерам PAY-26-… — это не REBILL, а самостоятельные one-shot покупки.

### 3. Idempotency
- В `orders_v2` нет ни одной записи с `order_number ILIKE 'REBILL-%'`, ссылающейся на этот profile, subscription или sbs. Никакого REBILL не материализовано (ни ручным h5_historical_repair, ни canonical-flow, ни старым `rebill_orders_materialization_2026`).
- already_materialized = **false** (но это не имеет значения — самого REBILL-платежа нет).

### 4. Access already extended legacy-путём?
- `entitlements.672cc97c-…` (product 11c9f1b8): status=active, expires_at `2026-05-17 20:59:59Z`, updated_at `2026-05-06 11:52:09Z` (давнее обновление, не связано с rebill).
- `subscriptions_v2.access_end_at`: `2026-05-17 20:59:59Z` — не продлевалось после 03-16.
- access_extended_legacy = **N/A** — нечего продлевать, repeat charge не происходил.

### 5/6. Decision
- Кандидатов на REBILL у Юлии за апрель–май 2026 со статусом succeeded и привязкой к recurring-парент-сделке нет.
- needs_rebill_insert: **false**.
- needs_payment_rebind: **false**.
- needs_grant_access_call: **false**.
- financial_only_repair: **false**.
- Verdict: **`manual_review_uid_mismatch`**.

### 7. Expected rowcounts execute-фазы
- orders_v2 INSERT: 0; payments_v2 UPDATE: 0; audit_logs INSERT: 0; subscriptions_v2/entitlements: 0.

### 8. Risk flags
- Provider subscription у Юлии в state=`canceled`, follow-up автосписания ожидать не следует. Сегодня (2026-05-17 20:59:59Z) её доступ истекает по графику.
- Дальнейшая судьба uid `113f7667…` требует уточнения от пользователя: возможно, это id из переписки/CRM/манычата, а не payments/orders id.

### 9. Rollback plan
- Не применимо (никаких операций не предлагается).

---

## Кейс 2 — Ольга Черкашина (uid `21613f63…`) — ready_for_execute_financial_only

### 1. Identification
- profile_id: `6112b4d0-d125-4ad3-9d43-594c04001992`, user_id: `69e504d3-703d-4562-b200-8ed20c52e7ab`.
- payment_id: `4a9288d3-d2b1-4bc0-984a-8900d1664da3`, provider_payment_id: `21613f63-dc85-406f-a8dd-34a936bc0784`, amount 250.00 BYN, status=succeeded, created_at `2026-05-17 14:01:10.514Z`, installment_number=1, is_recurring=true, refunded_amount=0.
- `payments_v2.meta`: `provider_managed=true`, `bepaid_description="Gorbova Club — BUSINESS"`, `bepaid_subscription_id=sbs_eb2fab715e72546b`.
- Текущий `payments_v2.order_id` = `57fcc9d8-a665-48a6-9fba-312c535be5a8` (**это аномалия — приклейка к parent**).
- Parent `orders_v2.57fcc9d8`: SUB-26-MO2YQLGECQ2J, profile_id `6112b4d0`, product 11c9f1b8, tariff `7c748940-dcad-4c7c-a92e-76a2344622d3`, final_price 250, paid_amount 250 (не суммировано — bug viz., webhook не пересчитал), status=paid, created_at `2026-04-17 13:47:46Z`, meta.payment_flow=`provider_managed_checkout`, meta.order_kind=null, meta.rebill=null.
- На этом ордере 2 succeeded-платежа: первичный цикл `5af47870…` (uid `cefe8e8a…`, 2026-04-17 13:52, is_recurring=true) и спорный второй `4a9288d3…` (наш кейс).

### 2. Subscription chain
- `subscriptions_v2.4a08ce6f-9327-498f-84e1-0c34e06d56c3`: order_id `57fcc9d8` (= parent), billing_type=`provider_managed`, auto_renew=true, status=active. До 14:01 платежа: access_start=`2026-04-17 13:52:55Z`, access_end=`2026-05-17 20:59:59Z`. **После** платежа (через canonical writer): access_end=`2026-06-16 20:59:59Z`, next_charge=`2026-06-16 20:59:59Z`.
- `provider_subscriptions` (sbs_eb2fab715e72546b): state=`active`, next_charge_at `2026-06-16 13:52:54Z`, amount_cents 25000. **SBS совпадает** с `payments_v2.meta.bepaid_subscription_id`.
- paid_billing_cycles на момент 14:01-платежа = 2 (первичный + наш). Это правомерный REBILL.

### 3. Idempotency (по всем форматам)
- `order_number ILIKE 'REBILL-%' AND meta.rebill.source_payment_id = 4a9288d3…` → 0.
- `meta.rebill.provider_payment_id = 21613f63…` → 0.
- `meta.materialized_from_payment_id = 4a9288d3…` → 0.
- `meta.materialized_from_payment_uid = 21613f63…` → 0.
- `orders_v2.provider_payment_id = 21613f63…` → 0.
- `meta.source IN ('h5_historical_repair','rebill_materialization')` для нашего payment_id/uid → 0.
- already_materialized = **false**.

### 4. Access already extended legacy-путём?
- `entitlements.dbd01dc5-cab7-42c6-936a-9eb0a71e053a`: status=active, expires_at `2026-06-17 12:00:00Z`, updated_at `2026-05-17 14:01:00.312Z`, order_id `57fcc9d8`. **Продлено в момент платежа.**
- subscription.access_end_at стало `2026-06-16 20:59:59Z`; provider next_charge `2026-06-16 13:52:54Z` (затем `billing.charge_date_auto_corrected` → `2026-06-17 12:00:00Z` в 15:11:55).
- Аудит-цепочка (фиксируется как факт прошлого, не пишется новый): `grant-access-for-order.skip_blocked_stale_access` (14:01:00, patch-12.2-skip-stale-guard) → `bepaid.subscription.processed` (14:01:12) → дважды `billing.charge_date_auto_corrected` → entitlement обновлён через canonical writer бэкенда.
- access_extended_legacy = **true**.

### 5. Planned REBILL-order (shape only, БЕЗ insert)
- order_number: `REBILL-4a9288d3-d2b` (first-12 от payment_id).
- profile_id `6112b4d0`, user_id `69e504d3`, product 11c9f1b8, tariff `7c748940`, base_price/final_price/paid_amount=250.00, currency BYN, status='paid', provider='bepaid', provider_payment_id `21613f63…`.
- meta: `{ payment_flow:'provider_managed_checkout', rebill:{ source_payment_id:'4a9288d3…', provider_payment_id:'21613f63…', parent_order_id:'57fcc9d8…', materialized_by:'patch_rb2', cycle_index:2, sbs:'sbs_eb2fab715e72546b' }, do_not_grant_access:true }`.
- payments_v2 rebind: `4a9288d3…` order_id `57fcc9d8…` → `<новый REBILL.id>`.

### 6. Decision
- needs_rebill_insert: **true**.
- needs_payment_rebind: **true**.
- needs_grant_access_call: **false** (доступ уже продлён до `2026-06-17 12:00Z`, что ≥ ожидаемого окна).
- financial_only_repair: **true**.
- Verdict: **`ready_for_execute_financial_only`**.

### 7. Expected rowcounts execute-фазы
- orders_v2 INSERT: 1
- payments_v2 UPDATE: 1 (только колонка `order_id`)
- audit_logs INSERT: 2 (`bepaid.rebill.materialized` + `patch_rb2.repair`)
- subscriptions_v2 UPDATE: 0
- entitlements INSERT/UPDATE: 0
- Расхождение с этими цифрами в реальном execute = немедленный rollback.

### 8. Risk flags
- SBS mismatch: **none** (sbs_eb2fab715e72546b совпадает у payment.meta и subscription/provider).
- Дубль REBILL: **нет**.
- Parent в финальном «refunded/cancelled»: **нет** (status=paid).
- paid_billing_cycles < 2: **нет** (=2).
- Дополнительно: `gc_sync_failed` (14:01:12) — посторонний для Get Course offer, не блокирует financial repair.

### 9. Rollback plan (только финансовый repair)
1) `UPDATE payments_v2 SET order_id='57fcc9d8…' WHERE id='4a9288d3…' AND order_id='<новый REBILL.id>'`.
2) `DELETE FROM orders_v2 WHERE id='<новый REBILL.id>' AND order_number='REBILL-4a9288d3-d2b' AND meta->>'materialized_by'='patch_rb2'`.
3) Никаких изменений в subscriptions_v2 / entitlements / Telegram / provider — доступ уже корректно продлён legacy-путём, его не трогаем ни при execute, ни при rollback.

---

## Кейс 3 — Live-fail RB1.1 (uid `6f9b0b83…`) — ready_for_execute_with_grant_proposal

### 1. Identification
- profile_id: `2a4b26b1-07af-48a1-beb5-5055f8183080`, user_id: `83bc38bc-2498-4760-b6fd-f0494055106c`.
- payment_id: `94a8dc74-888d-4352-b769-7a9c0e35a4ab`, provider_payment_id: `6f9b0b83-aa67-416e-9461-72b84b68a3cb`, amount 250.00, status=succeeded, created_at `2026-05-17 13:45:30.444Z`, installment_number=1, is_recurring=true.
- `payments_v2.meta`: `source=link_order_subscription_webhook`, `bepaid_subscription_id=sbs_8ef1ed6aa8b63783`.
- Текущий `payments_v2.order_id` = `a27a8b74-89cf-44c6-b7df-9cf4aeb1384b` (**приклейка к parent** — известный baseline RB1.1).
- Parent `orders_v2.a27a8b74`: SUB-LINK-MLP7MKV3, profile_id `2a4b26b1`, product 11c9f1b8, tariff `7c748940`, final_price 250, paid_amount 250, status=paid, created_at `2026-02-16 13:28:24Z`, meta.payment_flow=`provider_managed_checkout`, meta.rebill=null.
- На a27a8b74: 2 succeeded (`ab0ffa83…`/2026-03-18 первый repeat, `94a8dc74…`/2026-05-17 наш кейс), 2 failed retries в апреле.

### 2. Subscription chain
- `subscriptions_v2.cc56afbe-a677-4988-8673-00d500f279d1`: order_id `a27a8b74`, billing_type=`provider_managed`, auto_renew=true, status=active, access_start `2026-02-16 13:28:24Z`, access_end `2026-05-17 20:59:59Z`, next_charge `2026-05-17 20:59:59Z`. **Окно НЕ продлено.**
- `provider_subscriptions` (sbs_8ef1ed6aa8b63783): state=`active`, next_charge_at `2026-05-17 13:32:25Z`, last_charge_at `2026-05-17 13:45:30.633Z` (точно наш платёж), amount_cents 25000. **SBS совпадает.**
- paid_billing_cycles на момент 13:45 платежа: ≥3 (первичный 2026-02-16 + repeat 2026-03-18 + наш 2026-05-17). Правомерный REBILL.

### 3. Idempotency (по всем форматам)
- Все 6 проверок (source_payment_id, provider_payment_id, materialized_from_payment_id, materialized_from_payment_uid, REBILL-orders с этим provider_payment_id, h5/rebill_materialization source) → 0 совпадений.
- already_materialized = **false** (это и есть тот платёж, на котором rebill engine упал по base_price NOT NULL и short-circuit оставил парент-сделку с приклейкой).

### 4. Access already extended legacy-путём?
- `entitlements.d53e11f4-e4c3-4fee-a224-2e0e6eee0020`: status=active, expires_at `2026-05-17 20:59:59Z`, updated_at `2026-05-06 11:52:09Z` (давнее, не относится к 17.05 платежу).
- subscription.access_end_at: `2026-05-17 20:59:59Z` — не продлевалось после 05-17 платежа.
- Аудит-факты (фиксируем как прошлое):
  - 13:45:30.931 `bepaid.rebill.materialized_partial` (mode=on, base_price NOT NULL).
  - 13:45:30.975 `bepaid.rebill.decision_audit` (mode=on).
  - 13:45:31.346 `bepaid.webhook.canonical_writer_only` — `grant_decision=materialized_partial`, `grant_outcome=short_circuit`, note: «Access dates / entitlements / telegram_access NOT written from webhook (canonical-only).».
  - 13:45:33.497 `bepaid.webhook.link_order_processed` — webhook завершил с приклейкой.
- access_extended_legacy = **false** (доступ сегодня вечером истечёт, провайдер уже списал деньги, окно не продлено).

### 5. Planned REBILL-order (shape only, БЕЗ insert)
- order_number: `REBILL-94a8dc74-888`.
- profile_id `2a4b26b1`, user_id `83bc38bc`, product 11c9f1b8, tariff `7c748940`, base_price/final_price/paid_amount=250.00, currency BYN, status='paid', provider='bepaid', provider_payment_id `6f9b0b83…`.
- meta: `{ payment_flow:'provider_managed_checkout', rebill:{ source_payment_id:'94a8dc74…', provider_payment_id:'6f9b0b83…', parent_order_id:'a27a8b74…', materialized_by:'patch_rb2', cycle_index:'>=3', sbs:'sbs_8ef1ed6aa8b63783' }, do_not_grant_access:false }`.
- payments_v2 rebind: order_id `a27a8b74…` → `<новый REBILL.id>`.

### 6. Decision
- needs_rebill_insert: **true**.
- needs_payment_rebind: **true**.
- needs_grant_access_call: **true** — но **только как отдельный подэтап с отдельным approve**, не в общем financial-execute. Сам grant идёт строго через canonical write-path (`grant-access-for-order` с idempotency-guard), никакого ручного UPDATE entitlements / subscriptions_v2.
- financial_only_repair: **false**.
- Verdict: **`ready_for_execute_with_grant_proposal`**.

### 7. Expected rowcounts execute-фазы

Финансовый подэтап (без grant):
- orders_v2 INSERT: 1; payments_v2 UPDATE: 1; audit_logs INSERT: 2 (`materialized` + `repair`); subscriptions_v2/entitlements: 0.

Опциональный grant-подэтап (отдельный approve):
- delegated to `grant-access-for-order` для нового REBILL.id; expected: 1 subscriptions_v2 UPDATE (access_end_at, next_charge_at), 1 entitlements UPDATE (expires_at), audit от grant-функции. **Idempotency guard обязателен** — если access_end_at уже ≥ expected, no-op.

### 8. Risk flags
- SBS mismatch: **none**.
- Дубль REBILL: **нет**.
- Parent в финальном «refunded/cancelled»: **нет**.
- paid_billing_cycles < 2: **нет**.
- Истечение доступа сегодня вечером (`2026-05-17 20:59:59Z`) — если grant не вызвать, пользователь потеряет доступ к Telegram-каналу и кабинету несмотря на оплату. Это аргумент за scheduled execute grant-подэтапа сегодня, но строго после отдельного approve.

### 9. Rollback plan (только финансовый repair)
1) `UPDATE payments_v2 SET order_id='a27a8b74…' WHERE id='94a8dc74…' AND order_id='<новый REBILL.id>'`.
2) `DELETE FROM orders_v2 WHERE id='<новый REBILL.id>' AND order_number='REBILL-94a8dc74-888' AND meta->>'materialized_by'='patch_rb2'`.
3) Grant-подэтап не откатывается ручными правками доступа — это запрещено политикой. Если grant уже был вызван и его последствия требуют отмены, это отдельный admin-flow (cancel/supersede), не входящий в RB2.

---

## Сводная таблица

| # | Клиент | payment_id | uid | parent | already_materialized | access_extended_legacy | financial_only | needs_grant | Verdict |
|---|--------|-----------|-----|--------|---------------------|------------------------|----------------|-------------|---------|
| 1 | Юлия Смолик | — (uid 113f7667… не найден) | 113f7667… | — | false | n/a | false | false | manual_review_uid_mismatch |
| 2 | Ольга Черкашина | 4a9288d3… | 21613f63… | 57fcc9d8 (SUB-26-MO2YQLGECQ2J) | false | **true** | **true** | false | ready_for_execute_financial_only |
| 3 | Live-fail RB1.1 | 94a8dc74… | 6f9b0b83… | a27a8b74 (SUB-LINK-MLP7MKV3) | false | **false** | false | **true** | ready_for_execute_with_grant_proposal |

## Что НЕ сделано (по условию плана)

- 0 DML; 0 INSERT в `audit_logs` (expected execute audit rows = 2 на кейс, actual dry-run audit rows = **0**).
- Не вызывался `grant-access-for-order`, `telegram-grant-access`, `subscription-actions`, никакие `bepaid-*`.
- Не трогались `subscriptions_v2`, `entitlements`, `access_rules`, `telegram_*`, `payment_methods`, `orders_v2`, `payments_v2`.
- Не менялись secrets, mode, cron, edge-функции, schema.
- Не вызывался bePaid API.

## Что требует отдельного approve до execute

1. **Approve PATCH-RB2 execute финансового repair (кейсы 2 и 3 одновременно)**:
   - Создать 2 REBILL-orders по shape из секций 5;
   - Сделать 2 rebind в `payments_v2`;
   - Записать 4 audit-строки (`materialized` + `repair` по каждому);
   - Никакого grant. Никакого Telegram. Никакого provider API.

2. **Approve опционального grant-подэтапа по кейсу 3** (отдельно от пункта 1):
   - Вызвать `grant-access-for-order` для нового REBILL.id кейса 3 с idempotency-guard;
   - Если идempotency-guard возвращает no-op — оставить как есть и зафиксировать в audit; если grant продлевает доступ — это canonical путь и допустимо.
   - **Только** при условии, что пункт 1 завершён успешно и rebind/insert по кейсу 3 подтверждены.

3. **Уточнение по кейсу 1 (Юлия)**:
   - Пользователю нужно уточнить происхождение uid `113f7667…`. Если это не payments/orders id, RB2 кейс 1 закрывается как «no repair required, provider subscription canceled». Если это запись из CRM/ManyChat/переписки — указать, какой именно `payment_id` или `provider_payment_id` искать.
   - Самостоятельно догадываться и подменять uid запрещено.
