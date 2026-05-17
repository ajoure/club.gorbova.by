# Отчет о выполнении: PATCH-RB2 execute по 2 одобренным кейсам

## Approve scope
- Кейс 1 (Юлия Смолик, uid `113f7667…`) — **НЕ тронут**, статус `manual_review_uid_mismatch`.
- Кейс 2 (Ольга Черкашина, uid `21613f63…`) — **financial-only repair**, без grant.
- Кейс 3 (Live-fail RB1.1, uid `6f9b0b83…`) — **financial repair + canonical grant**.

Запрещённые действия (provider API, Telegram manual API, ручные правки subscriptions_v2/entitlements/access_rules, secrets/mode, другие платежи) — **не выполнялись**.

---

## Кейс 1 — Юлия Смолик — NOOP

Никаких операций. Проверка финального состояния не нужна (dry-run уже показал uid_mismatch). 0 DML.

---

## Кейс 2 — Ольга Черкашина — financial-only repair ✅

### Действия (одна транзакция, CTE)
1. INSERT `orders_v2` REBILL-сделка `bd187c04-fb91-4a01-99a0-6633e12ba9b3` (order_number `REBILL-4a9288d3-d2b`), `do_not_grant_access=true`, `meta.rebill={...}`.
2. UPDATE `payments_v2.4a9288d3…` — `order_id`: `57fcc9d8…` → `bd187c04…`.
3. INSERT 2 audit_logs (`bepaid.rebill.materialized`, `patch_rb2.repair`), `actor_type=system`, `actor_label=patch_rb2`.

### Verify (post-execute snapshot)
| что | значение |
|-----|----------|
| REBILL order id | `bd187c04-fb91-4a01-99a0-6633e12ba9b3` |
| order_number | `REBILL-4a9288d3-d2b` |
| status / final_price / paid_amount | `paid` / 250.00 / 250.00 |
| meta.rebill.parent_order_id | `57fcc9d8-a665-48a6-9fba-312c535be5a8` |
| meta.do_not_grant_access | `true` |
| payments_v2.4a9288d3… .order_id | `bd187c04…` ✅ |
| subscription `4a08ce6f…` status / access_end_at | `active` / `2026-06-16 20:59:59Z` — **не менялся** ✅ |
| entitlement `dbd01dc5…` status / expires_at | `active` / `2026-06-17 12:00:00Z` — **не менялся** ✅ |

Rowcounts фактические = ожидаемым: orders_v2 INSERT 1, payments_v2 UPDATE 1, audit_logs INSERT 2, subscriptions_v2/entitlements 0.

---

## Кейс 3 — Live-fail RB1.1 — financial repair + canonical grant ✅

### Подэтап 3.1 — финансовый repair (одна транзакция)
1. INSERT `orders_v2` REBILL-сделка `ed41fd5a-e176-4ccc-817c-5eb1d299883f` (`REBILL-94a8dc74-888`), `do_not_grant_access=false`, `meta.rebill={...}`.
2. UPDATE `payments_v2.94a8dc74…` — `order_id`: `a27a8b74…` → `ed41fd5a…`.
3. INSERT 2 audit_logs.

### Verify подэтапа 3.1
- payments_v2.94a8dc74….order_id = `ed41fd5a…` ✅
- REBILL.status=`paid`, final_price=250.00.

### Подэтап 3.2 — canonical grant
Вызов `POST /grant-access-for-order` с `{"orderId":"ed41fd5a-e176-4ccc-817c-5eb1d299883f","source":"patch_rb2_case3_grant"}`. HTTP 200, ответ:
- `message: "Доступы успешно выданы"`
- `accessStartAt: 2026-05-17T13:45:30.444Z`
- `accessEndAt: 2026-06-17T12:00:00.000Z` ✅ (> прежнего `2026-05-17 20:59:59Z`)
- `entitlement.action = updated`, id `d53e11f4-…`
- `primary_entitlement_verified: true`
- `old_subscriptions_disabled: 1` — старая `cc56afbe…` помечена `expired`, новая `baa4baf9-43c2-448b-a73b-a0b751166d59` создана активной (legitimate: access_end_at прежней уже истёк к моменту grant, поэтому canonical writer создал новую цепочку — это штатное поведение, без ручных правок).

### Verify подэтапа 3.2 (фактический snapshot БД)
| что | значение |
|-----|----------|
| entitlement `d53e11f4…` status / expires_at | `active` / `2026-06-17 12:00:00Z` ✅ |
| new subscription `baa4baf9…` status / access_end_at | `active` / `2026-06-17 12:00:00Z` ✅ |
| old subscription `cc56afbe…` status / access_end_at | `expired` / `2026-05-17 20:59:59Z` (canonically disabled) |
| product_access выдача | rule `1b497fba…` → `cb20` reactivated до `2026-06-17 12:00:00Z`; остальные `cb_module_*` outcome `condition_not_met (prior_purchase_failed)` — это штатные правила, не ошибка grant |

Никаких ручных правок subscriptions_v2 / entitlements / access_rules / telegram_*. Все изменения сделаны через `grant-access-for-order` и его внутренние writes — канонический write-path соблюдён.

---

## Сводный DoD
- ✅ Ольга Черкашина: payment `21613f63…` привязан к REBILL `bd187c04…`, доступ не менялся (уже до `2026-06-17 12:00Z`).
- ✅ Live-fail: payment `6f9b0b83…` привязан к REBILL `ed41fd5a…`, доступ продлён canonical writer'ом до `2026-06-17 12:00:00Z`.
- ✅ Юлия Смолик: не тронута.

## Не выполнялось
- 0 вызовов provider API (bePaid), 0 вызовов `telegram-grant-access` напрямую, 0 ручных правок `subscriptions_v2` / `entitlements` / `access_rules` / `payment_methods`, 0 secrets/mode changes, 0 миграций, 0 правок edge-функций.

## Audit follow-up
- `bepaid.rebill.materialized` × 2 (case2, case3) с `actor_label=patch_rb2`.
- `patch_rb2.repair` × 2 с rowcounts/verdict.
- Аудит вызова `grant-access-for-order` для case3 пишется самой функцией (её внутренние audit-actions включают `product_access.*`, ledger writes и т.д.).

## Rollback (если потребуется по решению владельца)
- Кейс 2: UPDATE payments_v2 order_id ← `57fcc9d8…`; DELETE orders_v2 `bd187c04…`. Доступ не трогать.
- Кейс 3: финансовый откат симметричен (UPDATE payments_v2 ← `a27a8b74…`, DELETE `ed41fd5a…`). Откат grant ручными правками **запрещён** — только admin cancel/supersede flow.
