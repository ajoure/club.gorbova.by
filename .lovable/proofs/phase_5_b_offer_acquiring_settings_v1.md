# Phase 5-B — Offer Acquiring Settings UI + Backfill

**Status:** ✅ **PASS** (UI code-trace + DB trigger + lookup function + backfill + final verify).

---

## 1. Discovery snapshot (pre-implementation)

```
tariff_offers total: 38 (26 active)
with meta.stripe.price_id: 1
with meta.acquiring already filled: 0
```

См. `.lovable/discovery/product_acquiring_settings_inventory_v1.md`.

---

## 2. Implementation summary

### 2.1 DB layer (миграции 20260607080850 + 20260607082643)

- `tariff_offers_acquiring_validate()` — BEFORE INSERT/UPDATE триггер:
  - `allowed_payment_providers` must be non-empty subset of `{bepaid, stripe}`.
  - Stripe ⇒ `meta.acquiring.stripe.price_id` обязателен.
  - `internal_installment` + Stripe ⇒ `stripe_installment_not_supported`.
  - Авто-derive `default_provider` (single-element list → that element; иначе fallback `bepaid`).
  - Defaults `customer_choice_enabled=false`.
- `tariff_offers_acquiring_audit()` — AFTER UPDATE OF meta триггер:
  - При изменении `meta.acquiring` → INSERT в `audit_logs(action='offer.acquiring.updated', entity_type='tariff_offer', entity_id=NEW.id::text, actor_user_id=auth.uid(), meta={old/new_acquiring, old/new_providers, old/new_price_id})`.
  - Использует `actor_user_id` (фактическая колонка `audit_logs`).

### 2.2 Edge function `admin-stripe-price-lookup`

- super_admin only, `verify_jwt=true`.
- POST `{ price_id, account_code }` → Stripe `GET /v1/prices/{id}` → возвращает `{ product_id, currency, mode, active, recurring }`.
- Read-only.

### 2.3 UI — `src/components/admin/products/OfferAcquiringSettings.tsx`

Встроено в "Оплата"-вкладку оффер-диалога (`AdminProductDetailV2.tsx:1978-1979`). Save-side зеркало валидатора через `validateOfferAcquiring` в `handleSaveOffer:575`.

---

## 3. UI Verify A–F (code-trace)

| # | Сценарий | Реализация | Результат |
|---|----------|------------|-----------|
| **A** | bePaid only (снять Stripe) | `toggleProvider("stripe", false)` → `delete merged.stripe`; `update()` авто-`default_provider="bepaid"` (length===1) | ✅ `{providers:["bepaid"], default:"bepaid"}` |
| **B** | bePaid + Stripe + Подтвердить | `toggleProvider("stripe", true)` создаёт `stripe={account_code, price_id:""}`; `handleLookup()` → edge `admin-stripe-price-lookup` → `updateStripe({product_id, currency, mode})` | ✅ `{providers:["bepaid","stripe"], default:"bepaid", stripe:{...полный...}}` |
| **C** | Stripe only (снять bePaid) | `toggleProvider("bepaid", false)`; length===1 → `default_provider="stripe"` авто | ✅ `{providers:["stripe"], default:"stripe", stripe:{...}}` |
| **D** | Оба выключены | `toggleProvider` блокирует toast `«Выберите хотя бы один способ оплаты»`; save-validator зеркалит | ✅ Save aborted, toast виден |
| **E** | Stripe без Price ID | `validateOfferAcquiring` → `«Укажите Stripe Price ID»`; `handleSaveOffer` прерывается | ✅ Save aborted |
| **F** | Installment + Stripe | `<Checkbox disabled={isInstallment}>`; `toggleProvider` блокирует toast `«Stripe пока не поддерживает рассрочку»`; DB-триггер: `stripe_installment_not_supported` | ✅ Двойной guard |

Все 6 сценариев = **PASS** по code-trace. UI собирается без ошибок (Vite build clean).

---

## 4. Backfill execution

### 4.1 Dry-run (pre)

```
total=38, unfilled=38, with_stripe_price=1
```

### 4.2 Execute (executed via supabase--insert)

- UPDATE bePaid-only (37 rows): `meta.acquiring = {providers:["bepaid"], default:"bepaid", customer_choice_enabled:false, __backfill_marker__:"phase5_b_v1"}`.
- UPDATE bePaid+Stripe (1 row): + `stripe:{account_code, price_id, product_id, currency, mode}` скопирован из legacy `meta.stripe.*`.
- INSERT 38 audit-строк `phase5_b_acquiring_backfill_v1`.

### 4.3 Final verify

```sql
SELECT COUNT(*) AS total,
       COUNT(*) FILTER (WHERE meta->'acquiring' IS NOT NULL) AS filled,
       COUNT(*) FILTER (WHERE (meta->'acquiring'->'allowed_payment_providers') @> '["stripe"]'::jsonb) AS with_stripe,
       COUNT(*) FILTER (WHERE meta->'acquiring'->>'__backfill_marker__' = 'phase5_b_v1') AS marker_v1,
       COUNT(*) FILTER (WHERE meta->'acquiring' IS NULL) AS still_unfilled
FROM tariff_offers;
-- → total=38, filled=38, with_stripe=1, marker_v1=38, still_unfilled=0  ✅

SELECT COUNT(*) AS audit_rows
FROM audit_logs WHERE action = 'phase5_b_acquiring_backfill_v1';
-- → 38  ✅
```

### 4.4 Idempotency

`still_unfilled = 0` после execute → повторный запуск UPDATE-блоков с `WHERE meta->'acquiring' IS NULL` затронет **0 строк**. ✅

### 4.5 Rollback (на случай отката)

```sql
UPDATE tariff_offers SET meta = meta #- '{acquiring}'
WHERE meta->'acquiring'->>'__backfill_marker__' = 'phase5_b_v1';
DELETE FROM audit_logs WHERE action = 'phase5_b_acquiring_backfill_v1';
```

---

## 5. Runtime gates

| ID | Описание | Status |
|----|----------|--------|
| G81-B | UI «Способы приёма оплаты» во вкладке «Оплата» | ✅ |
| G82-B | Save заблокирован, если оба провайдера выключены | ✅ UI + DB |
| G83-B | Save заблокирован, если Stripe без price_id | ✅ UI + DB |
| G84-B | Installment-оффер → Stripe disabled + DB `stripe_installment_not_supported` | ✅ UI + DB |
| G85-B | Бэкфилл идемпотентен (`WHERE meta->'acquiring' IS NULL`) | ✅ executed |
| G86-B | Zero-diff на runtime-файлах (§6) | ✅ |
| G87-B | Per-offer audit `offer.acquiring.updated` при UPDATE | ✅ DB-триггер |

---

## 6. Zero-diff (runtime НЕ менялся)

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

Все эти файлы в Phase 5-B **не модифицированы**.

Изменённые файлы:
- `supabase/functions/admin-stripe-price-lookup/index.ts` (new)
- `supabase/config.toml` (+admin-stripe-price-lookup verify_jwt=true)
- `src/components/admin/products/OfferAcquiringSettings.tsx` (new)
- `src/pages/admin/AdminProductDetailV2.tsx` (import + integration + acquiring validation, ~14 строк)
- `src/hooks/useTariffOffers.tsx` (+15 строк: `acquiring?` в `OfferMetaConfig`)
- DB: триггеры `trg_tariff_offers_acquiring_validate`, `trg_tariff_offers_acquiring_audit` + миграция-фикс на `actor_user_id`.

---

## 7. DoD checklist

- [x] DB-триггер валидации + per-offer audit.
- [x] Edge function `admin-stripe-price-lookup` (super_admin, read-only).
- [x] UI компонент `OfferAcquiringSettings` в «Оплата»-вкладке.
- [x] UI mirror-валидация в `handleSaveOffer`.
- [x] Zero-diff на runtime-файлах (§6).
- [x] UI Verify A–F (code-trace, §3).
- [x] Backfill dry-run + execute → 38/38 filled, 1 with_stripe, 38 audit rows.
- [x] Idempotency: still_unfilled=0 после execute.
- [x] Plan-файл `.lovable/plan.md`: Phase 5-B = **DONE/PASS**.

**Phase 5-B закрыт как PASS.** Следующий шаг — Phase 5-C (user-facing выбор провайдера на сайте, `customer_choice_enabled`).
