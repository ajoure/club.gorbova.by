да, согласен, с учетом правок:

Все пункты плана сохраняются. Ниже — обязательные уточнения перед выполнением F1–F4.

**1. Явно зафиксировать JWT-режим admin-функций**

Не полагаться на неявный default.

Добавить в supabase/config.toml:

[functions.stripe-card-data-fetch]

verify_jwt = true

&nbsp;

[functions.stripe-card-data-fetch-bulk]

verify_jwt = true

Это expected config для admin-only функций.

Перед deploy подтвердить:

public webhook functions → verify_jwt=false

admin card functions → verify_jwt=true

stripe-webhook и другие webhook не деплоить.

&nbsp;

**2. Исправить критерии auth-probes F1**

Для stripe-card-data-fetch запрос без обязательного payment_intent может корректно вернуть 400 validation_error, а не 200. Это не является провалом авторизации.

Проверять отдельно:

**Unauthenticated**

401 platform/auth rejection

**JWT обычного пользователя**

403 RBAC rejection

**Super admin — single function**

Отправить валидный по схеме, но заведомо отсутствующий технический pi_*.

Допустимый результат:

200 с verdict no_data/not_found

или

404/422 application-level response

Главное:

- запрос прошёл JWT и RBAC;
- actor_user_id соответствует JWT администратора;
- payments_v2 не изменена;
- нет Stripe commercial side effects.

**Super admin — bulk function**

Использовать только:

{

  "dry_run": true,

  "account_code": "stripe_poland",

  "limit": 50,

  "force_refresh": false

}

Ожидаемо:

HTTP 200

updated = 0

UI/runtime proofs выполнять из основной admin-учётной записи [7500084@gmail.com](mailto:7500084@gmail.com).

&nbsp;

**3. Inventory должен использовать тот же PI resolver, что и writer**

Нельзя создавать упрощённую SQL-классификацию, расходящуюся с _shared/stripe/card-enrichment.ts.

Для каждой строки PI определяется тем же приоритетом:

meta.stripe.payment_intent_id

provider_payment_id, если ^pi_

meta.stripe.invoice.payment_intent

meta.provider_response.stripe.payment_intent_id

Если источники различаются:

CONFLICTING_PAYMENT_INTENT_IDS

Если одному PI соответствуют несколько положительных Stripe payments:

AMBIGUOUS

Добавить обязательную сверку:

SQL inventory counts

=

bulk dry-run verdict counts

При расхождении:

STOP

F2 = INVENTORY_RESOLVER_MISMATCH

F3 не запускать.

&nbsp;

**4. Исправить ожидаемый результат F3**

ENRICHABLE означает, что строка подходит для попытки enrichment, но не гарантирует, что Stripe API вернёт card data.

Поэтому нельзя требовать:

run #1 updated = N

run #2 skipped_complete = N

Для каждого account_code должно выполняться:

N = updated + no_data + skipped_complete + error

На первом запуске допустимо:

updated = U

no_data = D

skipped_complete = 0

error = 0

U + D = N

На втором запуске:

updated = 0

skipped_complete = U

no_data = D либо skipped_no_data = D

error = 0

Для no_data:

- payment row не обновляется фиктивными значениями;
- сохраняется безопасный audit verdict;
- не создаётся бесконечная серия одинаковых audit-записей;
- допускается cooldown/последний no_data_checked_at, только если он не содержит card data и не меняет бизнес-поля.

Hard STOP:

error > 0

updated > 0 на втором запуске

повторное destructive изменение snapshot

&nbsp;

**5. Уточнить критерий исторического PASS**

HISTORICAL ENRICHMENT = PASS не означает, что у каждой старой операции обязательно найдена карта.

PASS, если каждая строка получила доказанный конечный verdict:

ALREADY_COMPLETE

UPDATED

NO_DATA_FROM_STRIPE

NO_PAYMENT_INTENT

REFUND_INHERITS_PARENT

И одновременно:

AMBIGUOUS = 0

CONFLICTING_PAYMENT_INTENT_IDS = 0

ERROR = 0

Строки NO_DATA_FROM_STRIPE остаются в UI как:

Карта не определена

Без искусственного заполнения brand/last4.

&nbsp;

**6. Audit и SYSTEM ACTOR**

Для F1–F3 admin-операций:

actor_type = user/admin

actor_user_id = фактический JWT sub

Не использовать SYSTEM ACTOR для ручного single/bulk запуска.

SYSTEM ACTOR остаётся только для будущих webhook-triggered enrichment событий.

Proof должен показать:

- audit action;
- actor type;
- actor user ID;
- безопасный verdict;
- отсутствие full Stripe response и card snapshot в audit.

&nbsp;

**7. Lifecycle diff должен охватывать весь execute window**

Кроме fixture-scoped проверки, добавить временной targeted diff:

provider = stripe

account_code = текущий run

updated_at в окне F3

Разрешённые изменения:

payments_v2.card_brand

payments_v2.card_last4

payments_v2.card_holder

payments_v2.meta.stripe card-enrichment поля

audit_logs

Любые изменения в:

amount

currency

status

order_id

subscription_id

orders_v2

subscriptions_v2

provider_subscriptions lifecycle

entitlements

access_rules

payment_links.current_uses

ai_generated_documents

→ F4 = FAIL.

&nbsp;

**8. UI proof**

Зафиксировать минимум:

- одну Stripe-строку после успешного enrichment;
- Stripe refund, наследующий отображение карты parent payment;
- одну NO_DATA_FROM_STRIPE, если такая есть;
- пять контрольных bePaid-строк.

Проверить, что UI не показывает:

undefined

*null

неверную маску

данные карты refund как собственный snapshot

Frontend-код в этом патче не менять. Если UI не читает уже сохранённый canonical shape, зафиксировать отдельный PATCH, но не смешивать его с enrichment execute.

&nbsp;

**9. Финальные статусы**

При успешных F1–F4:

PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2

= IMPLEMENTATION COMPLETE

&nbsp;

HISTORICAL ENRICHMENT

= PASS WITH TERMINAL VERDICTS

&nbsp;

LIVE WEBHOOK UAT

= DEFERRED

&nbsp;

SPRINT

= CLOSED WITH DEFERRED LIVE UAT

Полный webhook runtime PASS не объявлять до реальных событий:

checkout.session.completed

payment_intent.succeeded

invoice.paid

&nbsp;

**10. Разрешённый scope**

Разрешаю последовательно выполнить:

F1 → F2 → F3 → F4 → создать F5 backlog

с остановкой на первом FAIL/BLOCKED.

Deploy-list F1:

stripe-card-data-fetch

stripe-card-data-fetch-bulk

Запрещено:

redeploy stripe-webhook

deploy других webhook

force_refresh=true

historical update refund rows

изменение migrations/RPC/schema/secrets/frontend

изменение payment lifecycle

После завершения вернуть один consolidated отчёт с фактическими verdict F1–F4 и итоговым статусом патча.

&nbsp;

# План: PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2 / Finalization without test-mode fixtures

## Контекст и гейты

Подтверждённые статусы (не пересматриваются):

- Approve A code/tests = PASS
- stripe-webhook controlled deploy = PASS, verify_jwt=false smoke = PASS, PCI = PASS, bePaid regression = PASS
- Webhook source-path live runtime proof = DEFERRED → перенесено в F5 live UAT
- stripe-webhook повторно НЕ деплоится ни на одном из этапов F1–F4

Out of scope на весь патч: migrations, RPC, schema, secrets, frontend-код, изменение amount/currency/status/order/subscription/access, force_refresh=true, full Stripe response persistence, bepaid-webhook, любые webhook-функции.

---

## F1 — deploy admin enrichment functions

Pre-deploy gate:

- tests 20/20 PASS
- dependency scope: оба функции зависят только от `_shared/stripe/*` (writer один — `card-enrichment.ts`), `_shared/cors.ts`, `_shared/acquiring/vault.ts`
- diff vs. предыдущая версия: только enrichment-логика, никакого Stripe-webhook кода
- deploy-list строго `["stripe-card-data-fetch", "stripe-card-data-fetch-bulk"]` — `stripe-webhook` отсутствует
- `supabase/config.toml`: оба admin-функции БЕЗ блока `verify_jwt = false` (default = JWT required)

Post-deploy runtime probes:

1. unauthenticated POST → 401
2. JWT обычного пользователя → 403 (RBAC отказ)
3. JWT super_admin → 200, без модификации payment rows (probe без `payment_id` или с заведомо отсутствующим)
4. audit-row: `actor_user_id` совпадает с JWT `sub` реального админа
5. SQL-snapshot до/после: 0 изменений в `payments_v2`, `audit_logs` содержит только probe-записи

Артефакт: `.lovable/proofs/stripe_card_enrichment_v2_admin_runtime.md` (deploy-list, hash, 5 probe-результатов, SQL-diff).

---

## F2 — final historical inventory (read-only)

Read-only SQL по `payments_v2 WHERE provider='stripe'`:

- столбцы: `payment_id`, `account_code`, sign(amount), `meta.stripe.payment_intent_id` (резолв из `meta.stripe.*` и `meta.provider_response.stripe.*`), текущий card snapshot status, verdict
- verdict ∈ { ENRICHABLE, ALREADY_COMPLETE, NO_PAYMENT_INTENT, REFUND_INHERITS_PARENT, AMBIGUOUS, CONFLICTING_PAYMENT_INTENT_IDS }

Итоги (counts):

- total Stripe rows
- positive payments
- refund rows
- enrichable
- already complete
- without PI
- ambiguous / conflicting

Bulk dry-run вызов:

```json
{ "dry_run": true, "account_code": "stripe_poland", "limit": 50, "force_refresh": false }
```

Обязательный результат: `updated = 0`, ни одна payment row не изменена.

Артефакт: `.lovable/proofs/stripe_card_enrichment_v2_inventory.md` (полный inventory, counts, dry-run response, account_code distribution).

HARD STOP: при наличии ≥1 строки `AMBIGUOUS` или `CONFLICTING_PAYMENT_INTENT_IDS` — остановиться, F3 НЕ запускать, вернуть verdict `INVENTORY_BLOCKED`.

---

## F3 — targeted historical execute

Условие входа: F2 без ambiguous/conflicting.

Скоуп execute:

- только `provider='stripe'`
- только положительные payment rows (refund — пропуск, наследует от parent)
- один `account_code` за запуск (итерация по account_code, отдельный run на каждый)
- `force_refresh=false`
- audit `actor_user_id` = реальный super_admin JWT

Запрещено: менять amount/currency/status, трогать orders_v2/subscriptions_v2/entitlements/access_rules/payment_links/documents; сохранять полный Stripe response (только whitelist `{brand, last4, wallet.type, funding, country}` + service-поля).

Двойной запуск (idempotency proof):

- run #1 expected: `updated = N` (N = enrichable count из F2 для account_code)
- run #2 expected: `updated = 0`, `skipped_complete = N`
- `no_data` rows: только безопасный audit verdict, payment row не изменена

Артефакт: `.lovable/proofs/stripe_card_enrichment_v2_backfill.md` (по account_code: run #1 / run #2, SQL-diff payments_v2, audit-выборка).

---

## F4 — финальная проверка

### Card snapshot (по обновлённым rows)

Поля в `meta.stripe` / DB columns: `card_brand`, `card_last4`, `card_holder` (если есть), canonical `payment_method_details.card`, `payment_method_id`, `charge_id`, `payment_intent_id`, `card_data_source`, `card_data_sources_seen`, `card_data_fetched_at`.

### UI (`/admin/payments`)

- положительный Stripe payment: brand + masked last4
- refund: наследует card display от parent (через `stripeParentIndex`)
- no_data: «Карта не определена» (без маскировки)
- bePaid payment display не изменился (визуальный diff на 5 контрольных bePaid rows)

### PCI scans (SQL по `payments_v2.meta`, `audit_logs.meta`, `provider_subscriptions.meta`)

Запрещённые ключи: `number`, `pan`, `cvc`, `cvv`, `exp_month`, `exp_year`, `fingerprint`. Expected = 0 hits каждый.

### Lifecycle invariants (before/after по фикстурам F3)

Без изменений: `orders_v2`, `subscriptions_v2`, `provider_subscriptions` lifecycle, `entitlements`, `access_rules`, `payment_links.current_uses`, `ai_generated_documents`. Разрешено только: card snapshot в `payments_v2.meta` + соответствующие audit rows.

Артефакт: добавить раздел F4 в `stripe_card_enrichment_v2_backfill.md`.

---

## F5 — deferred live UAT (чек-лист, без выполнения)

Создать `.lovable/backlog/stripe_card_enrichment_live_uat_v1.md` со сценариями:

1. **Первая реальная разовая Stripe-оплата:**
  - `checkout.session.completed` → 2xx
  - `payment_intent.succeeded` → 2xx
  - `payments_v2` создан ровно один раз
  - card snapshot заполнен
  - order/access без дублей
2. **Первая реальная Stripe-подписка:**
  - `invoice.paid` → 2xx
  - payment materialized один раз
  - subscription lifecycle корректен
  - card snapshot заполнен
  - access не выдан повторно
3. **Повторная доставка события (Stripe Dashboard resend):**
  - event-level duplicate guard
  - writer-level `skipped_complete` guard
  - 0 duplicate payments/orders/access

Условие: live UAT не требует нового deploy, если bundle не изменился. При изменении кода — отдельный controlled redeploy по протоколу `.lovable/architecture/public_webhook_controlled_redeploy_protocol_v1.md`.

---

## Финальный статус

При PASS по F1–F4:

- PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2 = **IMPLEMENTATION COMPLETE**
- HISTORICAL ENRICHMENT = **PASS**
- LIVE WEBHOOK UAT = **DEFERRED**
- Спринт закрыт как **CLOSED WITH DEFERRED LIVE UAT**

Полный runtime PASS по трём webhook source-path (`checkout.session.completed` / `payment_intent.succeeded` / `invoice.paid`) НЕ объявляется до первой реальной оплаты.

Следующий патч после закрытия: **PATCH-STRIPE-DOCUMENTS-DRAWER-V2**. Повторный redeploy `stripe-webhook` без новых изменений кода запрещён.

---

## Артефакты (итог)

- `.lovable/proofs/stripe_card_enrichment_v2_admin_runtime.md` (F1)
- `.lovable/proofs/stripe_card_enrichment_v2_inventory.md` (F2)
- `.lovable/proofs/stripe_card_enrichment_v2_backfill.md` (F3 + F4)
- `.lovable/backlog/stripe_card_enrichment_live_uat_v1.md` (F5)

## Verdicts (возможные)

- F1: PASS / FAIL
- F2: PASS / INVENTORY_BLOCKED (ambiguous/conflicting)
- F3: PASS / PARTIAL (часть account_code не отработала) / FAIL
- F4: PASS / FAIL
- Итог: IMPLEMENTATION COMPLETE + HISTORICAL ENRICHMENT PASS + LIVE UAT DEFERRED, либо остановка на первом FAIL/BLOCKED с возвратом фактического verdict.

## Стоп-условия

- F2 ambiguous/conflicting → стоп, без F3
- F3 run #2 `updated ≠ 0` или `skipped_complete ≠ N` → стоп, FAIL
- F4 PCI scan > 0 hits → стоп, FAIL
- F4 lifecycle invariant нарушен → стоп, FAIL
- Любой stripe-webhook deploy в ходе F1–F4 → стоп, протокольное нарушение