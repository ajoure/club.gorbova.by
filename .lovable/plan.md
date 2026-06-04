# да, согласен, с учетом правок:

1. **Не создавать новую read-only функцию для verify**
  - Уже существует `stripe-discovery-objects`.
  - GAP-C должен переиспользовать её для retrieve Product/Price.
  - Не плодить дополнительные Stripe discovery endpoints.
2. **Добавить pre-flight drift check**  
Перед любым create:
  &nbsp;
  &nbsp;
  - проверить, что `tariff_prices.final_price`;
  - `tariff_prices.currency`;
  - результат GAP-B resolver;
  - текущий snapshot оффера;  
  неизменны между dry-run и execute.
  Если обнаружен drift:
  - `409 configuration_changed`;
  - provisioning запрещён;
  - требуется новый dry-run.
3. **DB write atomicity**  
Отдельно описать алгоритм:
  - сначала Stripe create;
  - затем DB update;
  - если DB update не прошёл:
    - НЕ создавать второй Product/Price;
    - вернуть `manual_review`;
    - сохранить реальные Stripe IDs в audit;
    - повторный запуск должен идти через idempotent retrieve, а не новый create.
4. **Metadata versioning**  
В `meta.stripe` сразу добавить:
  &nbsp;
  ```json
  {
    "schema_version": 1
  }
  ```
  Чтобы будущие GAP-D / MVP могли безопасно расширять структуру.
5. **Price Snapshot**  
В snapshot дополнительно сохранить:
  - `price_id`;
  - `product_id`;
  - `billing_scheme`;
  - `tax_behavior`;
  - `created_at`.
  Это уменьшит необходимость дополнительных Stripe retrieve в будущем.
6. **Manual review reasons**  
Нормализовать коды:
  - `price_missing`
  - `price_archived`
  - `price_mismatch`
  - `parameter_drift_rotation_required`
  - `stripe_object_without_db_mapping`
  - `db_write_failed_after_stripe_create`
  Чтобы потом не получить десятки разных текстовых вариантов.
7. **STOP-GATE GAP-C**  
GAP-C считается PASS только если дополнительно доказано:
  - Stripe Product существует;
  - Stripe Price существует;
  - оба имеют правильный metadata;
  - `meta.stripe.schema_version=1`;
  - повторный execute не создаёт новые объекты;
  - повторный execute использует retrieve-path;
  - ни одной записи не появилось в:
    - `provider_subscriptions`;
    - `subscriptions_v2`;
    - `payments_v2`;
    - `orders_v2`.

&nbsp;

После PASS GAP-C следующий этап остаётся без изменений:

**GAP-D — Runtime Stripe Subscription Capability Proof**

И только после PASS GAP-D можно открывать **Phase 3.1 Infinite Subscription MVP Execution**.

## Статус GAP-C.2–C.7: **PASS** (2026-06-04)

- Edge function `admin-provision-stripe-price` задеплоена (verify_jwt=true, super_admin only).
- Pilot offer `6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e`: Stripe `prod_UdwjYeet4QFbtW` + `price_1Teeq26UYJj2vm0GPXHSLKlz` (test/`stripe_poland`, BYN 10000, month/1).
- `tariff_offers.meta.stripe.schema_version=1` записан полностью по контракту §6.
- Idempotent re-run → `idempotent_hit`, без новых Stripe объектов и без новых `*_created` audit-событий.
- bePaid/`provider_subscriptions`/`subscriptions_v2`/`orders_v2` не затронуты.
- Proof: `.lovable/proofs/stripe_phase_3_1_2_gap_c_provisioning_v1.md`.

## Следующий этап: **GAP-D — Runtime Stripe Subscription Capability Proof** (NEXT)

MVP Stripe Subscription Execution остаётся ЗАБЛОКИРОВАН до PASS GAP-D.

---

План: GAP-C.2–C.7 — admin-provision-stripe-price

## Цель

Создать admin-only edge function `admin-provision-stripe-price`, которая идемпотентно создаёт Stripe `Product`/`Price` для пилотного `tariff_offer_id=6f306cbc…` и записывает SOT в `tariff_offers.meta.stripe.*`. Без UI, без MVP-execution, без rotation, без касания bePaid.

## Scope

- Только pilot offer (BYN 100.00, month/1, account_code=`stripe_poland`, business_stream=`consultations`, environment=`test`).
- Только provisioning Product + Price.
- Dry-run по умолчанию; execute только при `execute === true`.
- bePaid pipeline не затрагивается.

## Out of scope

- `stripe-create-subscription-checkout`, webhook, `provider_subscriptions` Stripe-записи.
- Rotation/supersede существующего `price_id`.
- Любой admin UI (только curl/edge function).
- Production-mode provisioning.

---

## Шаги

### 1. Diagnose (re-confirm pre-conditions)

- Подтвердить (read-only) что `tariff_offers.meta.stripe` для пилота всё ещё NULL.
- Прочитать активный `tariff_prices` пилота: `final_price=100.00`, `currency=BYN`.
- Подтвердить `account_code=stripe_poland`, `business_stream=consultations`, секрет `STRIPE_SECRET_KEY_STRIPE_POLAND` доступен.

### 2. Plan — контракт edge function

**Path:** `supabase/functions/admin-provision-stripe-price/index.ts`

**Config:** `verify_jwt = true` (`supabase/config.toml`), super_admin guard через `requireSuperAdmin` (как в `stripe-discovery-objects`).

**Request:**

```json
{
  "tariff_offer_id": "6f306cbc-…",
  "account_code": "stripe_poland",
  "business_stream": "consultations",
  "execute": false
}
```

**Validation pipeline (STOP на любом fail → 422, audit `manual_review`):**

1. `tariff_offer_id` exists и activeое.
2. `account_code` валидный + секрет резолвится.
3. Active `tariff_prices` row → SOT для `unit_amount` и `currency`.
4. GAP-A: `currency=BYN` в whitelist.
5. GAP-B: billing interval резолвится (`month/1` для пилота), `interval_count > 1` → 422 `billing_period_not_supported`.
6. `tariff_offers.meta.stripe.price_id` отсутствует ИЛИ retrieve PASS (idempotent hit).
7. Cross-check: нет foreign mapping в `products_v2.meta.stripe`, `bepaid_product_mappings`, `provider_subscriptions.meta.stripe`.

**Idempotency:**

- Если `meta.stripe.price_id` есть → `stripe.prices.retrieve()` + `stripe.products.retrieve()`.
  - PASS (active, livemode=false, currency/amount/interval match) → return `idempotent_hit`, без create, audit `idempotent_existing`.
  - FAIL (archived/404/mismatch) → 409 `manual_review`, без silent recreate.
- Если `meta.stripe.price_id` НЕТ → создать с `Idempotency-Key`:
  - Product: `stripe-product:{tariff_offer_id}`.
  - Price: `stripe-price:{tariff_offer_id}:{currency}:{unit_amount}:{interval}:{interval_count}`.

**Stripe metadata (Product + Price):**

```
product_id, tariff_id, tariff_offer_id,
account_code, business_stream,
environment=test, purpose=stripe_subscription_mvp
```

**DB write (только при `execute === true` и успешном create):**

```json
tariff_offers.meta.stripe = {
  "product_id": "prod_…",
  "price_id": "price_…",
  "account_code": "stripe_poland",
  "business_stream": "consultations",
  "provisioned_at": "<iso>",
  "provisioned_by": "<auth.uid>",
  "price_snapshot": {
    "currency": "byn",
    "unit_amount": 10000,
    "interval": "month",
    "interval_count": 1,
    "livemode": false
  },
  "price_id_history": [],
  "accounts": {
    "stripe_poland": { "product_id": "prod_…", "price_id": "price_…" }
  }
}
```

Запись через update `tariff_offers.meta` (merge), НЕ overwrite.

**Audit events** (`audit_logs`, actor_type=`admin`):

- `stripe_provision_dry_run`
- `stripe_provision_started`
- `stripe_product_created`
- `stripe_price_created`
- `stripe_provision_completed`
- `stripe_provision_idempotent_existing`
- `stripe_provision_manual_review` (с reason)
- `stripe_provision_error`
- `stripe_provision_db_write_failed` (Stripe created, DB failed → manual_review)

**Response shape:**

```json
{
  "mode": "dry_run" | "execute" | "idempotent_hit",
  "status": "ok" | "manual_review" | "error",
  "plan": { … },
  "stripe": { "product_id", "price_id", "retrieve_proof" },
  "db_write": { "applied": bool, "meta_stripe_after": {…} },
  "audit_event_ids": [...]
}
```

### 3. Dry run (mandatory, runs first)

Вызов через `supabase--curl_edge_functions` с `execute=false`:

- Подтвердить: 200, `mode=dry_run`, `plan` корректный, `db_write.applied=false`, нет записей в Stripe, audit `stripe_provision_dry_run` создан.

### 4. Execute (после approval)

Вызов с `execute=true`:

- 200, `mode=execute`, Product + Price созданы, `tariff_offers.meta.stripe` записан, audit events `started/created/completed`.

### 5. Verify

- `stripe.products.retrieve(product_id)` + `stripe.prices.retrieve(price_id)` через `stripe-discovery-objects` → подтвердить metadata, `active=true`, `livemode=false`, `currency=byn`, `unit_amount=10000`, `recurring.interval=month`, `interval_count=1`.
- `tariff_offers.meta.stripe` read via `supabase--read_query`.
- Повторный `execute=true` запуск → `mode=idempotent_hit`, нет новых Stripe объектов, нет новых audit `created` событий.
- `bepaid_product_mappings`, `provider_subscriptions` — read-only check: 0 изменений.

### 6. Proof

`.lovable/proofs/stripe_phase_3_1_2_gap_c_provisioning_v1.md` со всеми артефактами из §9 пользовательского запроса (dry_run output, execute output, Stripe retrieve, meta after, audit_logs, idempotency re-run, bePaid untouched).

### 7. Plan.md update

- GAP-C.2–C.7 → `PASS` (с датой и ссылкой на proof).
- GAP-D → `NEXT`.
- Явная фиксация: MVP Stripe Subscription Execution всё ещё заблокирован до PASS GAP-D.

---

## Технические детали

**Файлы:**

- `supabase/functions/admin-provision-stripe-price/index.ts` (new)
- `supabase/config.toml` — add `[functions.admin-provision-stripe-price] verify_jwt = true`
- `.lovable/proofs/stripe_phase_3_1_2_gap_c_provisioning_v1.md` (new)
- `.lovable/plan.md` (update)

**Reuse (no duplication):**

- `_shared/acquiring/vault.ts` (resolve account secret) — уже используется в `stripe-discovery-objects`.
- `_shared/requireSuperAdmin` (auth guard) — уже используется в `stripe-discovery-objects`.
- `_shared/cors.ts`.
- Stripe SDK через `npm:stripe@…` (как в существующих stripe-функциях, если есть; иначе REST через fetch).

**Stripe API calls:**

- `POST /v1/products` с `Idempotency-Key: stripe-product:{tariff_offer_id}`.
- `POST /v1/prices` с `Idempotency-Key: stripe-price:{tariff_offer_id}:{currency}:{unit_amount}:{interval}:{interval_count}`.
- `GET /v1/products/{id}` и `GET /v1/prices/{id}` для verify/idempotent retrieve.

**Rotation policy (enforced):**
Если `meta.stripe.price_id` уже есть и Stripe retrieve PASS — НЕ создавать новый Price, даже если amount/currency/interval в БД изменились. В этом случае возвращать `manual_review` с reason `parameter_drift_rotation_required` (rotation = отдельный future mini-plan).

**STOP-gates (hard):**

- Active `tariff_prices` отсутствует → 422, никаких Stripe вызовов.
- amount/currency mismatch между `tariff_prices` и existing Stripe Price → `manual_review`.
- Stripe create PASS, DB write FAIL → `stripe_provision_db_write_failed` audit + 500 + proof, НЕ retry молча.
- bePaid таблицы (`bepaid_product_mappings`, `provider_subscriptions`, `subscriptions_v2`) — read-only, никаких writes.

## DoD

- Edge function задеплоена, `verify_jwt=true`, super_admin guard работает (401 без JWT, 403 для non-super_admin).
- Dry-run для пилота возвращает корректный план, БД и Stripe не тронуты.
- Execute создаёт единственный Product + единственный active Price с правильной metadata.
- `tariff_offers.meta.stripe.*` заполнен по контракту §6.
- Повторный execute → `idempotent_hit`, без дубликатов.
- Все 5 audit-сценариев продемонстрированы в proof.
- bePaid pipeline не затронут (доказано read-only check).
- Proof файл создан и заполнен.
- plan.md обновлён.
- GAP-D остаётся blocker для MVP execution.