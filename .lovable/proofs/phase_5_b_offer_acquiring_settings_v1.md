# Phase 5-B — Offer Acquiring Settings UI + Backfill

**Status:** UI + DB-trigger + lookup function = DONE. Backfill = PENDING (await UI verification).

## 1. Discovery snapshot (pre-implementation)

```
tariff_offers total: 38 (26 active)
with meta.stripe.price_id: 1
with meta.acquiring already filled: 0
```

(See `.lovable/discovery/product_acquiring_settings_inventory_v1.md` for full breakdown.)

## 2. Implementation summary

### 2.1 DB layer (migration)

`tariff_offers_acquiring_validate()` — BEFORE INSERT/UPDATE trigger:

- `allowed_payment_providers` must be non-empty subset of `{bepaid, stripe}`.
- Stripe ⇒ `meta.acquiring.stripe.price_id` required.
- `internal_installment` + Stripe ⇒ `stripe_installment_not_supported`.
- Auto-derives `default_provider` (single-element list → that element; else falls back to `bepaid` if missing/invalid).
- Defaults `customer_choice_enabled=false`.

`tariff_offers_acquiring_audit()` — AFTER UPDATE OF meta trigger:

- If `meta.acquiring` changed → INSERT `audit_logs(action='offer.acquiring.updated', entity_type='tariff_offer', entity_id, actor_id=auth.uid(), meta={old_acquiring,new_acquiring,old/new_providers,old/new_price_id})`.

### 2.2 Edge function `admin-stripe-price-lookup`

- super_admin only (`verify_jwt=true`, role check via `has_role_v2`).
- POST `{ price_id, account_code }` → Stripe `GET /v1/prices/{id}` → returns `{ product_id, currency, mode, active, recurring }`.
- Read-only. Никаких записей в БД, никаких мутаций в Stripe.
- Validates account in `acquiring_connections` (must exist, provider='stripe', status='active').

### 2.3 UI — `src/components/admin/products/OfferAcquiringSettings.tsx`

Inserted into "Оплата"-tab of the Offer dialog (`AdminProductDetailV2.tsx`).

- Два чекбокса: «bePaid — карты банков Беларуси», «Stripe — карты иностранных банков».
- Stripe-блок появляется только если Stripe включён.
- Поля: Stripe аккаунт (из `acquiring_connections`), Price ID, кнопка **«Подтвердить»** → дёргает `admin-stripe-price-lookup` → подтягивает **Product ID / Валюту / Режим** в read-only поля.
- Installment guard: при `payment_method='internal_installment'` Stripe чекбокс disabled + подпись.
- Валидация на сохранение зеркалит DB-триггер (`validateOfferAcquiring`).
- `default_provider` авто-резолвится; `customer_choice_enabled=false` (Phase 5-C).

### 2.4 Что НЕ менялось (zero-diff, см. §6)

`bepaid-webhook`, `stripe-webhook`, `grant-access-for-order`, `_shared/stripe-subscription-resolver.ts`, `public-checkout`, `create-stripe-checkout.ts`, `stripe-pre-create-subscription.ts`, `admin-create-public-link`, `create-payment-checkout.ts`.

## 3. Backfill — PENDING (выполняется после UI verification)

### 3.1 Dry-run SQL

```sql
SELECT id, name,
  CASE WHEN meta->'stripe'->>'price_id' IS NOT NULL
       THEN 'bepaid+stripe' ELSE 'bepaid_only' END AS would_set
FROM tariff_offers
WHERE meta->'acquiring' IS NULL;
```

### 3.2 Execute (idempotent, single transaction)

```sql
-- bePaid-only offers
UPDATE tariff_offers
SET meta = jsonb_set(
  COALESCE(meta, '{}'::jsonb),
  '{acquiring}',
  jsonb_build_object(
    'allowed_payment_providers', jsonb_build_array('bepaid'),
    'default_provider', 'bepaid',
    'customer_choice_enabled', false,
    '__backfill_marker__', 'phase5_b_v1'
  ),
  true
)
WHERE meta->'acquiring' IS NULL
  AND (meta->'stripe'->>'price_id') IS NULL;

-- bePaid + Stripe offers (where meta.stripe.price_id exists)
UPDATE tariff_offers
SET meta = jsonb_set(
  COALESCE(meta, '{}'::jsonb),
  '{acquiring}',
  jsonb_build_object(
    'allowed_payment_providers', jsonb_build_array('bepaid','stripe'),
    'default_provider', 'bepaid',
    'customer_choice_enabled', false,
    'stripe', jsonb_build_object(
      'account_code', COALESCE(meta->'stripe'->>'account_code', 'stripe_poland'),
      'price_id', meta->'stripe'->>'price_id',
      'product_id', meta->'stripe'->>'product_id',
      'currency', UPPER(COALESCE(meta->'stripe'->>'currency', 'EUR')),
      'mode', COALESCE(meta->'stripe'->>'mode', 'test')
    ),
    '__backfill_marker__', 'phase5_b_v1'
  ),
  true
)
WHERE meta->'acquiring' IS NULL
  AND (meta->'stripe'->>'price_id') IS NOT NULL;

-- Audit
INSERT INTO audit_logs (action, entity_type, entity_id, meta)
SELECT 'phase5_b_acquiring_backfill_v1', 'tariff_offer', id,
       jsonb_build_object('acquiring', meta->'acquiring')
FROM tariff_offers
WHERE meta->'acquiring'->>'__backfill_marker__' = 'phase5_b_v1';
```

### 3.3 Verify SQL

```sql
SELECT COUNT(*) FILTER (WHERE meta->'acquiring' IS NOT NULL) AS filled,
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE (meta->'acquiring'->'allowed_payment_providers') @> '["stripe"]'::jsonb) AS with_stripe
FROM tariff_offers;
-- expected: filled=38, total=38, with_stripe=1
```

### 3.4 Rollback

```sql
UPDATE tariff_offers
SET meta = meta #- '{acquiring}'
WHERE meta->'acquiring'->>'__backfill_marker__' = 'phase5_b_v1';
```

## 4. UI verification scenarios (PENDING — оператор/агент)

| # | Сценарий | Ожидаемый JSON `meta.acquiring` |
|---|----------|---------------------------------|
| A | bePaid only | `{providers:["bepaid"], default:"bepaid"}` |
| B | bePaid + Stripe (price подтверждён) | `{providers:["bepaid","stripe"], default:"bepaid", stripe:{...}}` |
| C | Stripe only | `{providers:["stripe"], default:"stripe", stripe:{...}}` |
| D | оба выключены | save заблокирован toast «Выберите хотя бы один способ оплаты» |
| E | Stripe без price_id | save заблокирован toast «Укажите Stripe Price ID» |
| F | Installment + попытка Stripe | checkbox disabled + DB trigger: `stripe_installment_not_supported` |

## 5. Runtime gates

| ID | Описание | Status |
|----|----------|--------|
| G81-B | UI «Способы приёма оплаты» отображается во вкладке «Оплата» | DONE (structural) |
| G82-B | Save заблокирован, если оба провайдера выключены | DONE (UI + DB) |
| G83-B | Save заблокирован, если Stripe включён без price_id | DONE (UI + DB) |
| G84-B | Installment-оффер → Stripe disabled + сервер: `stripe_installment_not_supported` | DONE (UI + DB) |
| G85-B | Бэкфилл идемпотентен (`WHERE meta->'acquiring' IS NULL`) | DONE (SQL) — execute pending |
| G86-B | Zero-diff на runtime-файлах (§6) | DONE |
| G87-B | Per-offer audit `offer.acquiring.updated` пишется при каждом изменении | DONE (DB trigger) |

## 6. Zero-diff grep (runtime-файлы НЕ менялись)

Файлы, которые в Phase 5-B **не должны быть изменены**:

```
supabase/functions/bepaid-webhook
supabase/functions/stripe-webhook
supabase/functions/grant-access-for-order
supabase/functions/_shared/stripe-subscription-resolver.ts
supabase/functions/_shared/consume-payment-link.ts
supabase/functions/public-checkout
supabase/functions/create-stripe-checkout.ts
supabase/functions/stripe-pre-create-subscription.ts
supabase/functions/stripe-create-subscription-checkout
supabase/functions/admin-create-public-link
supabase/functions/create-payment-checkout.ts
```

Изменённые файлы в Phase 5-B:

- `supabase/functions/admin-stripe-price-lookup/index.ts` (new)
- `supabase/config.toml` (+2 строки конфига для admin-stripe-price-lookup)
- `src/components/admin/products/OfferAcquiringSettings.tsx` (new)
- `src/pages/admin/AdminProductDetailV2.tsx` (import + integration + acquiring validation, ~14 lines)
- `src/hooks/useTariffOffers.tsx` (+15 lines: `acquiring?` в OfferMetaConfig)
- DB: триггеры `trg_tariff_offers_acquiring_validate`, `trg_tariff_offers_acquiring_audit`

## 7. DoD checklist

- [x] DB-триггер валидации `meta.acquiring` + per-offer audit.
- [x] Edge function `admin-stripe-price-lookup` (super_admin, read-only).
- [x] UI компонент `OfferAcquiringSettings` в «Оплата»-вкладке оффера.
- [x] UI mirror-валидация в `handleSaveOffer`.
- [x] Zero-diff на runtime-файлах (§6).
- [ ] **Операторский Verify UI** (сценарии A..F §4).
- [ ] Backfill dry-run + execute → 38/38 filled.
- [ ] Plan-файл `.lovable/plan.md` обновить: Phase 5-B = DONE.
