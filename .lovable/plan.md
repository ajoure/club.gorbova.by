## да, согласен, с учетом правок:

План в целом готов к **Approve A**, но перед кодом нужно исправить два критичных момента: sanitizer не должен падать на обычном Stripe-объекте из-за наличия `exp_month/fingerprint`, а формат `payment_method_details` должен точно совпадать с уже существующими путями чтения в UI.

да, согласен, с учетом правок:

# **Approve A — код и локальные тесты**

Разрешаю выполнить только:

- shared sanitizer;
- единый enrichment writer;
- интеграцию writer в существующие webhook lifecycle;
- refactor single-fetch;
- создание bulk-fetch;
- локальные unit/integration tests;
- proof кода и тестов.

Не разрешаю на этом этапе:

```text
deploy
historical backfill
Stripe live/test runtime events
UPDATE существующих payments_v2
изменение bePaid
миграции/RPC/новые таблицы
```

---

# **1. Исправить sanitizer: raw Stripe input может содержать forbidden fields**

Нельзя делать `pci_violation` только потому, что входной Stripe Charge содержит:

```text
exp_month
exp_year
fingerprint
```

Это штатные поля Stripe API, поэтому такой hard reject заблокирует enrichment практически для каждой карты.

Правильное правило:

1. Raw Stripe object может содержать любые Stripe-поля.
2. Sanitizer читает только whitelist.
3. Forbidden fields полностью игнорируются.
4. После формирования output выполнить post-condition scan.
5. `pci_violation` бросать только если запрещённый ключ оказался:
  - в sanitized output;
  - в DB update payload;
  - в audit payload.

Canonical whitelist:

```text
brand
last4
wallet.type
funding
country
```

Запрещены в выходе:

```text
number
pan
cvc
cvv
exp_month
exp_year
fingerprint
```

Unit test должен доказать:

```text
raw input содержит exp_month/exp_year/fingerprint
→ enrichment не падает
→ sanitized output не содержит эти поля
```

И отдельный negative test:

```text
запрещённый ключ искусственно попал в output payload
→ pci_violation
→ DB update не выполняется
```

---



# **2. Зафиксировать каноническую структуру**

`payment_method_details`

Перед реализацией выполнить code search по всем существующим reader-path:

```text
meta.stripe.payment_method_details
meta.stripe.payment_method_details.card
meta.stripe.card
provider_response.stripe.payment_method_details
```

Writer должен сохранять структуру, которую уже читает `PaymentsTable` и `useUnifiedPayments`.

Ожидаемый канонический формат:

```json
{
  "type": "card",
  "card": {
    "brand": "visa",
    "last4": "4242",
    "wallet": {
      "type": "apple_pay"
    },
    "funding": "credit",
    "country": "PL"
  }
}
```

Не сохранять плоско:

```json
{
  "brand": "visa",
  "last4": "4242"
}
```

если текущий UI читает путь:

```text
payment_method_details.card.brand
payment_method_details.card.last4
```

В proof указать:

- фактический canonical writer path;
- все существующие readers;
- подтверждение совместимости без отдельного UI-патча.

Если readers сейчас поддерживают несколько legacy-форматов, writer всё равно должен писать один канонический формат.

---



# **3.**

`card_holder`

Разрешено сохранять:

```text
payments_v2.card_holder
```

из `billing_details.name`, но:

- не сохранять его в `meta.stripe.payment_method_details`;
- не сохранять в audit;
- не перезаписывать существующее непустое значение пустым/NULL;
- отсутствие card holder не делает snapshot incomplete.

Complete snapshot определяется без обязательного `card_holder`.

---



# **4. Resolver**

`payment_intent_id`

Не ограничивать inventory и enrichment только полем:

```text
provider_payment_id LIKE 'pi_%'
```

Канонический resolver PI должен проверить по приоритету:

```text
meta.stripe.payment_intent_id
provider_payment_id, если соответствует ^pi_
meta.stripe.invoice.payment_intent
meta.provider_response.stripe.payment_intent_id
```

Использовать только однозначный результат.

Если источники содержат разные PI:

```text
STOP
verdict = conflicting_payment_intent_ids
```

Если одному PI соответствуют несколько положительных payment rows:

```text
STOP
verdict = manual_review_duplicate_payment_intent
```

Inventory Approve C должен учитывать все источники PI, а не только `provider_payment_id`.

---

# **5. Webhook должен вызывать enrichment после materialization**

Для каждого события указать точную точку вызова.

## `checkout.session.completed`

```text
existing checkout materialization/resolution
→ однозначный payments_v2.id
→ enrichment
```

## `payment_intent.succeeded`

```text
найден существующий payments_v2.id
→ enrichment
```

Если payment row ещё не создана:

```text
retryable_no_payment_row
```

Не создавать payment row внутри enrichment writer.

## `invoice.paid`

```text
existing onInvoicePaid lifecycle
→ payment materialized/resolved
→ получен payments_v2.id
→ enrichment
```

Если текущий `onInvoicePaid` не возвращает `payment_id`, допускается минимально расширить его result contract, но не создавать второй lifecycle и не менять бизнес-результат обработчика.

Enrichment failure не должен откатывать:

```text
order
payment
subscription
entitlement
access
payment_link usage
```

---

# **6. Один writer и одна Stripe-fetch логика**

Подтверждаю архитектуру:

```text
card-extract.ts
card-enrichment.ts
```

Но `card-enrichment.ts` должен разделять:

1. `resolveStripeCardSource()` — чтение PI/Charge/PaymentMethod;
2. `buildSanitizedCardSnapshot()` — sanitizer;
3. `persistStripeCardSnapshot()` — единственный DB writer;
4. `enrichStripePaymentCardData()` — orchestration.

Webhook, single и bulk используют этот orchestration.

Не оставлять старые inline PATCH-LIVE-CARD update-блоки после refactor.

Proof должен содержать code search:

```text
payments_v2 card_brand/card_last4 update
```

и доказать, что Stripe card enrichment writer остался один.

---

# **7. Idempotency и race guard**

Complete snapshot:

```text
card_brand
card_last4
meta.stripe.payment_method_details.card
meta.stripe.payment_method_id
meta.stripe.charge_id
meta.stripe.payment_intent_id
```

`wallet.type` не обязателен: обычная карта может быть без wallet.

Правила:

- complete + `forceRefresh=false` → `skipped_complete`;
- частичный snapshot → merge недостающих полей;
- не затирать wallet;
- не затирать непустые значения NULL;
- sources_seen — dedup;
- concurrent event не должен создавать destructive last-write-wins.

60-секундный guard использовать только как дополнительную защиту от параллельных fetch.

---

# **8. Исправить SQL PCI scan**

В audit SQL обязательны скобки:

```sql
SELECT id
FROM audit_logs
WHERE
  (
    action LIKE 'stripe.%'
    OR action LIKE 'admin.stripe.%'
  )
  AND meta::text ~* '"(number|pan|cvc|cvv|exp_month|exp_year|fingerprint)"\s*:';
```

Без скобок логика `AND/OR` будет неверной.

Также проверить не только ключи верхнего уровня, а весь вложенный JSON.

---

# **9. Approve A tests**

До возврата отчёта выполнить локально:

## **Sanitizer tests**

- Visa без wallet;
- Apple Pay;
- Google Pay;
- отсутствующий card object;
- raw object с expiry/fingerprint;
- искусственная PCI-утечка в output;
- NULL/partial data.

## **Writer tests**

- Stripe positive payment → update;
- refund → reject/skip;
- bePaid → reject/skip;
- complete snapshot → skip;
- partial snapshot → non-destructive merge;
- conflicting PI → stop;
- duplicate positive rows per PI → ambiguous;
- повторный source event → sources_seen dedup;
- событие без wallet не удаляет Apple Pay wallet.

## **Lifecycle tests**

- `invoice.paid` не вызывает повторную materialization;
- enrichment error не ломает lifecycle result;
- не создаются orders/payments/access/entitlements.

## **Bulk tests**

- `dry_run=true` по умолчанию;
- dry-run выполняет 0 updates;
- limit max 200;
- account isolation;
- concurrency ≤3;
- actor = фактический super_admin JWT;
- повторный execute → skipped_complete.

---

# **10. Proof Approve A**

Создать:

```text
.lovable/proofs/stripe_card_enrichment_v2_code_and_tests.md
```

Proof должен содержать:

1. Before architecture.
2. Final dependency graph.
3. Canonical JSON storage shape.
4. Удалённые inline write-path.
5. Список файлов.
6. Unit/integration test results.
7. Code-level PCI proof.
8. Подтверждение отсутствия deploy.
9. Подтверждение отсутствия исторических UPDATE.
10. Точный proposed deploy scope для Approve B.

---

# **Статусы**

```text
Approve A — APPROVED
Approve B — NOT APPROVED
Approve C — NOT APPROVED
```

После выполнения Approve A остановиться.

Вернуть отчёт с:

- diff-summary;
- тестами;
- canonical storage path;
- единственным write-path;
- dependency graph;
- deploy-list;
- proof.

Deploy и historical backfill не начинать.

&nbsp;

План: PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2 (rev. с правками)

Diagnose → Plan → Dry-run → Execute → Verify. Approve поэтапный (A → B → C). Execute и deploy пока не начинать.

### Цель

1. Новые Stripe-платежи в момент webhook получают единый sanitized card snapshot через **один общий writer**.
2. Исторические Stripe-платежи без card data безопасно обогащаются через тот же writer (targeted, idempotent).
3. Refund-row не дублирует card snapshot, наследование parent остаётся UI-only (`stripeParentIndex`, без изменений).
4. PCI: запрещённые поля никогда не попадают в DB и audit.
5. bePaid не трогаем.
6. Никакого второго конкурирующего write-path.

---

### Архитектурные инварианты

**Один writer, ноль дублей логики:**

```text
_shared/stripe/card-extract.ts     ← pure sanitizer + PCI denylist
_shared/stripe/card-enrichment.ts  ← единственный writer payments_v2 card fields
```

`stripe-webhook`, `stripe-card-data-fetch`, новый `stripe-card-data-fetch-bulk` — **все** идут через `card-enrichment.ts`. Запрещены:

- HTTP-вызов одной edge function из другой;
- импорт `index.ts` чужой edge function;
- параллельный второй Stripe-fetch/update алгоритм.

---

### 1. `_shared/stripe/card-extract.ts` (pure sanitizer)

Whitelist полей в snapshot:

```json
{
  "brand": "visa",
  "last4": "4242",
  "wallet": { "type": "apple_pay" },
  "funding": "credit",
  "country": "PL"
}
```

**Denylist (hard reject → throw `pci_violation`):**
`number, pan, cvc, cvv, exp_month, exp_year, fingerprint`.

`fingerprint` исключён намеренно — устойчивый идентификатор карты не нужен для отображения плательщика.

Также возвращает:

- `card_brand`, `card_last4` (DB-колонки);
- `card_holder` ← `billing_details.name` (только для DB-колонки `card_holder`, **не** в audit и **не** в snapshot);
- `payment_method_id` (`pm_*`), `charge_id` (`ch_*`), `payment_intent_id` (`pi_*`).

Unit test: input с `number/cvc/exp_month` → output без запрещённых ключей и `pci_violation` throw.

---

### 2. `_shared/stripe/card-enrichment.ts` (единственный writer)

```ts
enrichStripePaymentCardData({
  supabase, stripeClient, paymentId,
  paymentIntentId, accountCode,
  source,           // 'checkout.session.completed' | 'payment_intent.succeeded' | 'invoice.paid' | 'targeted_fetch' | 'bulk_fetch'
  actor,            // { type:'system'|'user', user_id?:uuid, label:string }
  forceRefresh: false,
})
```

**Pre-conditions (hard reject):**

- payment существует, `provider='stripe'`, `amount > 0`;
- `provider_payment_id` matches `^pi_[A-Za-z0-9]+$` и равен `paymentIntentId`;
- `account_code` совпадает с meta;
- если по PI больше одной положительной строки → STOP, audit `manual_review_duplicate_payment_intent`, без update.

**Idempotency (main guard):**

«Complete snapshot» = одновременно есть:

- `card_brand`, `card_last4`,
- `meta.stripe.payment_method_details`,
- `meta.stripe.payment_method_id`,
- `meta.stripe.charge_id`.

Если complete и `forceRefresh=false` → skip с verdict `already_complete`. 60-секундный lock остаётся как **anti-concurrency**, не как primary idempotency.

`force_refresh=true` разрешён только super_admin и помечается в audit отдельно.

**Merge правила (non-destructive):**

- никогда не перезаписывать non-null достоверным NULL;
- merge только non-null whitelisted полей;
- не затирать Apple Pay `wallet.type` событием без wallet;
- DB-колонки `card_brand/card_last4/card_holder` обновляются по тому же принципу.

**Unified meta-путь (единый, без вариантов):**

```text
meta.stripe.payment_method_details
meta.stripe.payment_method_id
meta.stripe.charge_id
meta.stripe.payment_intent_id
meta.stripe.card_data_source          ← последний источник
meta.stripe.card_data_sources_seen[]  ← все источники, dedup
meta.stripe.card_data_fetched_at      ← timestamp последней успешной enrichment
```

Запрещено использовать `meta.card_data_fetched_at` / `meta.card_data_source` (legacy).

**Atomic update:** один `UPDATE payments_v2 ... WHERE id=$1 AND provider='stripe' AND amount>0 AND provider_payment_id=$2` с jsonb merge.

---

### 3. Webhook integration (`supabase/functions/stripe-webhook/index.ts`)

Три события сходятся в один writer:

```text
checkout.session.completed → resolved payment_id → enrichStripePaymentCardData(source='checkout.session.completed')
payment_intent.succeeded   → resolved payment_id → enrichStripePaymentCardData(source='payment_intent.succeeded')
invoice.paid               → existing lifecycle → resolved payment_id → enrichStripePaymentCardData(source='invoice.paid')
```

**Критично по `invoice.paid`:**

- Использовать **существующий** lifecycle-обработчик `onInvoicePaid`. Не создавать параллельную ветку.
- Enrichment вызывается **после** того, как существующий handler однозначно вернул/нашёл `payments_v2.id`.
- Enrichment **не имеет права**:
  - создавать новую `payments_v2` row;
  - повторно вызывать `onInvoicePaid` или lifecycle-функции;
  - выдавать доступ;
  - менять subscription lifecycle;
  - инкрементировать `payment_links.current_uses`.

**Invoice → Charge resolver** (до реализации проверить актуальный payload):

```text
invoice.payment_intent → PaymentIntent (expand=latest_charge) → Charge.payment_method_details
```

Не предполагать, что `invoice.latest_charge` всегда заполнен. Если Charge ещё недоступен → `no_data / retryable`, webhook lifecycle не падает, payment не откатывается.

**Existing inline-блоки PATCH-LIVE-CARD** (строки 348-362, 447-461 в `stripe-webhook/index.ts`) **удаляются** и заменяются вызовом единого writer.

**Audit для webhook-source enrichment:**

```text
actor_type = system
actor_user_id = NULL
actor_label = 'Stripe webhook card enrichment'
```

При ошибке fetch/secret — `audit_logs.insert({action:'stripe.webhook.card_enrichment_failed', meta:{ safe error snapshot, см. §5 }})`. Webhook lifecycle не падает.

---

### 4. Refactor `stripe-card-data-fetch`

Вынести внутреннюю логику в `_shared/stripe/card-enrichment.ts`. В `index.ts` остаётся только:

1. CORS / `requireSuperAdmin` auth;
2. body validation (`payment_intent`, опц. `account_code`, опц. `force_refresh`);
3. вызов `enrichStripePaymentCardData(..., actor={type:'user', user_id, label:'admin single fetch'})`;
4. HTTP response.

Никакого собственного Stripe fetch / DB update внутри `index.ts`.

---

### 5. Новая edge function `stripe-card-data-fetch-bulk`

`requireSuperAdmin`. Body:

```json
{
  "dry_run": true,
  "payment_intents": ["pi_..."],
  "account_code": "stripe_poland",
  "limit": 50,
  "force_refresh": false
}
```

- `dry_run=true` по умолчанию, execute требует явного `false`;
- `limit` max 200, рекомендуемо 50;
- concurrency ≤ 3 (последовательно или ограниченно);
- timeout-safe batching;
- exact account isolation (один `account_code` за call);
- без `payment_intents` — подбирает кандидатов через SQL (см. §10).

Per-PI verdict:

```
updated | skipped_complete | no_data | invalid | ambiguous | error
```

Использует **тот же** `enrichStripePaymentCardData`.

**Audit:**

- per-PI: `admin.stripe.card_data_fetch_{ok|empty|error|skipped_complete|ambiguous}` с актором = JWT user_id;
- summary: `admin.stripe.card_data_bulk_run` с inventory before/after, **без** card data, **без** stripe response bodies;
- не записывать bulk admin run как SYSTEM actor.

---

### 6. Safe audit snapshot

**Разрешённые поля в `audit_logs.meta` при error/skip:**

```
payment_id, payment_intent_id, account_code, http_status,
stripe_error_type, stripe_error_code, decline_code,
request_id, source, retryable, verdict
```

**Запрещено:**

```
card_holder, full Stripe response, payment_method_details целиком,
PAN, CVC, CVV, exp_*, fingerprint, authorization data, billing_details
```

---

### 7. Inventory (Stage B.1 dry-run, read-only)

До execute вернуть отдельной таблицей:

```text
total_stripe_rows
positive_payments (amount>0)
refund_rows (amount<0)
positive_with_pi  (provider_payment_id ~ '^pi_')
positive_with_last4
positive_with_complete_snapshot
positive_without_pi
```

Каждому положительному кандидату присвоить verdict:

```
ENRICHABLE             — pi_*, snapshot не complete
ALREADY_COMPLETE       — пропуск
NO_PAYMENT_INTENT      — нет pi_*
REFUND_INHERITS_PARENT — amount<0
AMBIGUOUS              — несколько positive rows на один pi_*
```

Артефакт: `.lovable/proofs/stripe_card_enrichment_v2_inventory.md` (числа пересчитать на момент execute, не фиксировать заранее «3 строки»).

---

### 8. PCI proof

Не ограничиваться grep по dump. Proof включает:

**Code-level:**

- unit test на sanitizer: input с `number/cvc/exp_month/fingerprint` → output без запрещённых ключей + `pci_violation` throw.

**DB-level (read-only):**

```text
SELECT id FROM payments_v2
WHERE provider='stripe'
  AND (meta::text ~* '"(number|pan|cvc|cvv|exp_month|exp_year|fingerprint)"\s*:');
-- expected: 0 rows
```

**Audit-level:**

```text
SELECT id FROM audit_logs
WHERE action LIKE 'stripe.%' OR action LIKE 'admin.stripe.%'
  AND meta::text ~* '"(number|pan|cvc|cvv|exp_month|exp_year|fingerprint)"\s*:';
-- expected: 0 rows
```

Значения чувствительных полей в proof не публикуются.

---

### 9. Verify без загрязнения production

`stripe trigger` НЕ запускать так, чтобы тестовый event касался live-аккаунта или production-rows без изоляции. Допустимо:

1. Stripe **test mode** с отдельным `account_code` (test connection в `acquiring_connections`);
2. изолированный fixture payment с `meta.test_payment=true` и без access-grant;
3. runtime integration-fixture без создания production order/entitlement.

Никаких access/entitlement grants ради card enrichment test.

bePaid regression: выборочные 3 строки `provider='bepaid'`, diff до/после = 0.

---

### 10. Deploy scope (минимальный)

```text
supabase/functions/stripe-webhook/             ← integration call + удаление inline PATCH-LIVE-CARD
supabase/functions/stripe-card-data-fetch/     ← thin refactor
supabase/functions/stripe-card-data-fetch-bulk/ ← new
supabase/functions/_shared/stripe/card-extract.ts      ← new (deploy as part of webhook bundle)
supabase/functions/_shared/stripe/card-enrichment.ts   ← new (deploy as part of webhook bundle)
```

Dependency graph фиксируется в proof. Несвязанные edge functions не деплоить.

---

### 11. Out of scope

- bePaid webhook / sync;
- UI refund-row (наследование через `stripeParentIndex` уже работает);
- любые архивные правки `orders_v2` / access / entitlements;
- backup-таблицы `_stripe_cleanup_2026_06_backup_*` (отдельный discovery-only пункт, retention не исполняется в этом патче).

---

### 12. Обновлённый порядок approve

**Approve A — код и test fixture (без deploy, без execute):**

- `_shared/stripe/card-extract.ts` + unit test;
- `_shared/stripe/card-enrichment.ts`;
- `stripe-webhook` integration (удаление inline PATCH-LIVE-CARD, добавление вызовов в 3 events через resolved `payment_id`);
- refactor `stripe-card-data-fetch` (thin);
- новая `stripe-card-data-fetch-bulk`;
- integration test без historical execute.

**Approve B — deployment + webhook runtime proof:**

- точечный deploy 3 функций + 2 shared модулей;
- изолированный test event (Stripe test mode / fixture);
- runtime proof для всех 3 source-событий;
- bePaid regression;
- PCI proof (code + DB + audit).

**Approve C — historical backfill:**

- финальный inventory с verdicts;
- dry-run;
- отдельный owner approve;
- targeted execute (per-account, ограниченный limit);
- второй запуск даёт `updated=0, skipped_complete=N`;
- UI proof (`/admin/payments` показывает brand/last4/wallet там, где Stripe реально вернул данные; `no_data` — честно «Карта не определена»).

**Stage D backup retention** — discovery-only, не смешивается с card-data execute.

---

### Финальный DoD

PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2 = PASS, если:

1. Один общий enrichment writer используется webhook / single / bulk; второй write-path отсутствует.
2. Новые Stripe payments получают sanitized card snapshot (brand, last4, wallet, funding, country, pm_id, charge_id, pi_id).
3. `invoice.paid` enrichment встроен в существующий lifecycle без повторной материализации payment/order/access.
4. Исторические `ENRICHABLE` rows обработаны.
5. Refund rows не дублируют snapshot, наследуют parent через UI.
6. Повторный backfill даёт 0 updates.
7. `PAN/CVC/expiry/fingerprint` отсутствуют в `payments_v2` и `audit_logs` (3 proof: code + DB + audit).
8. bePaid rows не изменены.
9. Audit actor: webhook = system+NULL, single/bulk admin = JWT user_id.
10. UI показывает brand/last4/wallet там, где Stripe вернул данные; иначе «Карта не определена» + `no_data` audit verdict.
11. Proof содержит runtime, SQL, audit, PCI и UI-факты.

---

### Артефакты на approve-этапах

- `.lovable/plan.md` — этот блок.
- `.lovable/proofs/stripe_card_enrichment_v2_code_and_tests.md` (Approve A).
- `.lovable/proofs/stripe_card_enrichment_v2_webhook_runtime.md` (Approve B).
- `.lovable/proofs/stripe_card_enrichment_v2_pci.md` (Approve B).
- `.lovable/proofs/stripe_card_enrichment_v2_inventory.md` (Approve C dry-run).
- `.lovable/proofs/stripe_card_enrichment_v2_backfill.md` (Approve C execute).
- `.lovable/discovery/stripe_cleanup_backup_tables_retention_v1.md` (Stage D, отдельно).

### После card enrichment — последовательность (без execute сейчас)

1. PATCH-STRIPE-DOCUMENTS-DRAWER-V2
2. PATCH-STRIPE-BILLING-PERIOD-MODE-V2
3. PATCH-STRIPE-BULK-CANCEL-V2
4. Backup tables retention decision

Жду **Approve A** перед началом любых code-изменений. Deploy и execute не начинать.