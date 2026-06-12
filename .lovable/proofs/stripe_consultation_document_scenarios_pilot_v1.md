# PROOF: Pilot — document_scenarios на `f71b5ed3-…` (Несрочная консультация)

**Patch:** PATCH-STRIPE-CONSULTATION-DOCUMENT-SCENARIOS-V1 / Этап II (Pilot)
**Status:** PASS
**Date:** 2026-06-12 09:48 UTC
**Offer:** `f71b5ed3-27dd-419d-b922-ad529192b58a` («Несрочная консультация», amount=500, product=`9d0d6de8-4b0e-477f-b6c4-ab7def8268f6`)

## 1. Before snapshot

```json
{
  "stripe": {"mode":"live","price_id":"","account_code":"stripe_poland"},
  "default_provider": "stripe",
  "__backfill_marker__": "phase5_b_v1",
  "customer_choice_enabled": false,
  "allowed_payment_providers": ["stripe"]
}
```
`meta ? 'document_scenarios' = false`, `meta ? 'document_defaults' = false`.

## 2. STOP-guards (все PASS)

В одном атомарном `WITH upd AS (UPDATE ... WHERE ... RETURNING ...) INSERT INTO audit_logs ... FROM upd`:

- `o.id = 'f71b5ed3-…'` ✅
- `o.is_active = true` ✅
- `NOT (o.meta ? 'document_scenarios')` (идемпотентность) ✅
- template ФЛ `7caee05d-…` exists & active & deleted_at IS NULL & document_type='act' ✅
- template ЮЛ `4fa3160f-…` exists & active & deleted_at IS NULL & document_type='act' ✅
- executor `d0c7fe75-…` exists & active ✅

UPDATE: 1 row, audit INSERT: 1 row.

## 3. After snapshot

```json
"document_scenarios": [
  {
    "id": "e28a9ea1-9be5-4b94-be3f-8839b83af644",
    "is_enabled": true,
    "payer_type": "individual",
    "payment_channels": ["card"],
    "template_id": "7caee05d-0410-4b2f-85b7-f7af1463cac5",
    "executor_id": "d0c7fe75-1192-40a9-bbae-b652b69e6882",
    "requires_required_requisites": true
  },
  {
    "id": "2a40d36a-6f8f-455a-8ac1-12221e0c1d80",
    "is_enabled": true,
    "payer_type": "legal_entity",
    "payment_channels": ["card"],
    "template_id": "4fa3160f-f979-4dbe-b069-5b0cb2c7bb05",
    "executor_id": "d0c7fe75-1192-40a9-bbae-b652b69e6882",
    "requires_required_requisites": true
  }
],
"stripe_consultation_scenarios_v1": {
  "pilot": true,
  "patch": "PATCH-STRIPE-CONSULTATION-DOCUMENT-SCENARIOS-V1",
  "applied_at": "2026-06-12T09:48:12.77507+00",
  "rollout_offer_ids": ["f71b5ed3-27dd-419d-b922-ad529192b58a"]
}
```

`meta.acquiring` (где живут `stripe`/`__backfill_marker__`/`default_provider`/`allowed_payment_providers`/`customer_choice_enabled`) **сохранён байт-в-байт**.

## 4. Audit

```
id        : d4be3bba-80a1-45ea-8cd9-e3bc58af941e
actor_type: system
action    : offer_document_scenarios_configured
entity    : tariff_offer / f71b5ed3-…
meta      : { patch, stage='pilot', offer_id, product_id, tariff_id,
              templates_used, executor_id, scenarios_after,
              preserved_meta_keys, proof_file }
created_at: 2026-06-12 09:48:12.77507+00
```

## 5. Идемпотентность

Повторный запрос с тем же `WHERE NOT (o.meta ? 'document_scenarios')` → 0 rows. Идемпотентность гарантирована.

## 6. Изоляция: 4 других консультационных оффера НЕ затронуты

```sql
SELECT id, meta ? 'document_scenarios' as has_scn FROM tariff_offers
WHERE id IN ('25880f13-…','c244bbd4-…','7a333f66-…','369c911a-…');
-- все 4: has_scn=false
```

## 7. Resolver proof (на реальном Stripe-заказе)

Stripe order `849c68b7-…` уже привязан к `offer_id=f71b5ed3-…` (Step A backfill, PASS). Runtime resolver (`document-field-resolver-v2`) на этом заказе после Этапа I вернул:
- `FLD-000161='USD'` (валюта из заказа, не products_v2.currency='BYN');
- `FLD-000160=2`, `FLD-000192='2 (два) доллара США, 00 центов'`;
- executor ФЛ `'ЗАО "АЖУР инкам"'` (FLD-000104).

Логический матч сценария (по контракту `resolveDocumentScenario`):
- `payer_type='individual'` + `payment_channel='card'` (Stripe→card после Этапа I) → matches scenario `e28a9ea1` → `template_id=7caee05d`, `executor_id=d0c7fe75`. ✅
- `payer_type='legal_entity'` + `payment_channel='card'` → matches scenario `2a40d36a` → `template_id=4fa3160f`, `executor_id=d0c7fe75`. ✅

`source='scenario'`, `enabled=true`.

## 8. Production document на 2 USD — НЕ создан

- `ai_generated_documents` для product=`9d0d6de8-…`: count=0 до и count=0 после pilot ✅;
- авто-генерация заблокирована тремя guards (см. proof Этапа I §5);
- ручная кнопка «Сформировать» по тестовой 2 USD операции **не нажималась**.

## 9. bePaid regression

Офферы FULL (`c5781abf-…`) и BUSINESS (`bc0f7a90-…`) не изменялись; их `document_scenarios` остались с прежними каналами `["card","erip","apple_pay","google_pay"]` / `["bank_transfer"]` и теми же шаблонами/executor. ✅

## 10. DoD Pilot

- [x] STOP-guards пройдены, 1 row updated.
- [x] Сценарии (individual/card, legal_entity/card) сохранены через канонический контракт.
- [x] Использованы существующие шаблоны/исполнитель — никаких новых сущностей.
- [x] `requires_required_requisites=true` для обоих сценариев (соответствует BPiZ).
- [x] `meta.acquiring`/`meta.stripe`/`__backfill_marker__` сохранены.
- [x] SYSTEM actor audit создан.
- [x] Идемпотентность подтверждена.
- [x] 4 других оффера не затронуты.
- [x] Auto-gen для консультаций остаётся выключенной (3 guards).
- [x] Production-документ по 2 USD не создан, номер не присвоен.

## Rollback (на случай отката)

```sql
UPDATE public.tariff_offers
SET meta = meta - 'document_scenarios' - 'stripe_consultation_scenarios_v1',
    updated_at = now()
WHERE id = 'f71b5ed3-27dd-419d-b922-ad529192b58a'
  AND meta ? 'stripe_consultation_scenarios_v1';
```

**Этап II = PASS. Этап III (rollout на 25880f13 / c244bbd4 / 7a333f66 / 369c911a) = NOT APPROVED — ждёт отдельного approve владельца проекта после ревью этого pilot proof.**
