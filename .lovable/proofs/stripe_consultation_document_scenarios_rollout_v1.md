# PATCH-STRIPE-CONSULTATION-DOCUMENT-SCENARIOS-V1 — Этап III (Rollout)

Дата: 2026-06-12
Pilot-оффер (reference): `f71b5ed3-27dd-419d-b922-ad529192b58a`
Канонический исполнитель: `d0c7fe75-1192-40a9-bbae-b652b69e6882` (АО «АЖУР инкам»)
Шаблоны:
- individual → `7caee05d-0410-4b2f-85b7-f7af1463cac5` (active, `document_type=act`)
- legal_entity → `4fa3160f-f979-4dbe-b069-5b0cb2c7bb05` (active, `document_type=act`)

## 1. Pre-flight (все 4 оффера)

Все 4 оффера прошли проверку:
- `is_active = true`
- `meta.document_scenarios` отсутствует
- `meta.document_defaults` отсутствует
- `meta.acquiring.allowed_payment_providers = ["stripe"]`
- `meta.acquiring.default_provider = "stripe"`
- `meta.acquiring.stripe.account_code = "stripe_poland"`
- оба шаблона `is_active=true, document_type=act`
- executor `is_active=true`

## 2. Execute — первый запуск = 4 rows

Один атомарный CTE: pre-flight (`src`) → guarded `UPDATE … RETURNING` → `INSERT` в `audit_logs` зависимый от `RETURNING`.

`RETURNING entity_id`:
```
25880f13-5633-4d9b-9118-babb68d08851
c244bbd4-b820-4de3-ad9a-c026aed9f3dd
7a333f66-9bd1-48ae-b668-551e4b096eba
369c911a-3c52-4b6f-bd21-cf55d03e48cc
```
Updated rows = **4**.

## 3. Идемпотентность — повторный запуск = 0 rows

```
rows_updated: 0
```

## 4. Восемь уникальных scenario UUID

| offer_id | individual scenario.id | legal_entity scenario.id |
|---|---|---|
| 25880f13-5633-4d9b-9118-babb68d08851 | d895e898-6f6a-4e7a-8171-e8a9783fd5b6 | 4d74ad99-f882-483a-856c-3b2ba723e4f0 |
| c244bbd4-b820-4de3-ad9a-c026aed9f3dd | a0827002-4389-418e-b347-6340ee1acb20 | d9fffd32-626e-477e-a9d9-4a3597fe29a1 |
| 7a333f66-9bd1-48ae-b668-551e4b096eba | 1f826302-cefc-4660-bf6b-898e92be8633 | 483cd78a-4520-49fa-83e7-2f666afb5481 |
| 369c911a-3c52-4b6f-bd21-cf55d03e48cc | 21a3802a-8858-4d8f-964c-d6c15d4991b1 | 4a815505-d288-4f4d-b81b-a5fa84b4f992 |

Проверка: `count(DISTINCT s->>'id') = 8`, `count(*) = 8`. UUID pilot-оффера не использован.

## 5. Audit (SYSTEM ACTOR)

4 записи в `audit_logs` (created_at = 2026-06-12 09:55:19.918358+00):
- `actor_type=system`, `actor_user_id=NULL`
- `actor_label='Stripe consultation document scenarios rollout'`
- `action='offer_document_scenarios_configured'`
- `entity_type='tariff_offers'`, `entity_id=<offer_id>`
- `meta` содержит `offer_id`, `before`, `after`, `patch`, `template_ids`, `executor_id`, `proof_file`, `pilot_offer_id`

## 6. Сохранность acquiring metadata (после rollout)

Для всех 4 офферов `meta.acquiring` побайтно идентичен pre-flight:
```json
{
  "__backfill_marker__": "phase5_b_v1",
  "allowed_payment_providers": ["stripe"],
  "customer_choice_enabled": false,
  "default_provider": "stripe",
  "stripe": {"account_code": "stripe_poland", "mode": "live", "price_id": ""}
}
```
Добавлен отдельный `meta.__rollout_marker__ = {name: stripe_consultation_document_scenarios_rollout_v1, pilot_offer_id, applied_at}` — не перезаписывает существующий `__backfill_marker__` (находится внутри `acquiring`).

## 7. Resolver matrix (5 офферов)

Для каждого из 5 консультационных офферов (`f71b5ed3` + 4 новых):
- provider=`stripe` → `derivePaymentChannel` → `card` (подтверждено runtime-gate, Этап I)
- payer_type ∈ {individual, legal_entity} → source=`scenario`
- template_id для individual → `7caee05d-…`, для legal_entity → `4fa3160f-…`
- executor_id = `d0c7fe75-…`
- can_generate = true (template active, executor active, scenario enabled, payment_channels содержит `card`)

## 8. ai_generated_documents — без изменений

Записей с `template_id ∈ {7caee05d…, 4fa3160f…}` за последний час: **0**. Документы не создавались.

## 9. bePaid regression

Конфигурация FULL/BUSINESS (`c5781abf-…`/`bc0f7a90-…`) не затрагивалась. Rollout SQL фильтрует строго по `meta.acquiring.stripe.account_code='stripe_poland'` и явному списку 4 offer_id — bePaid-офферы исключены.

Runtime mapping не менялся: `bepaid→card`, `bepaid→erip`, `admin→other`, `admin_test+test_payment→card` — подтверждено в Этап I.

## 10. Auto-generation остаётся выключенной

- Глобальные флаги auto-gen без изменений.
- `document_generation_rules` для консультационного продукта `9d0d6de8-…` не создавались.
- Запись `document_scenarios` сама по себе не триггерит генерацию.

## 11. Rollback SQL (отдельно для каждого оффера)

```sql
-- 25880f13
UPDATE tariff_offers SET meta = meta - 'document_scenarios' - '__rollout_marker__'
WHERE id='25880f13-5633-4d9b-9118-babb68d08851';

-- c244bbd4
UPDATE tariff_offers SET meta = meta - 'document_scenarios' - '__rollout_marker__'
WHERE id='c244bbd4-b820-4de3-ad9a-c026aed9f3dd';

-- 7a333f66
UPDATE tariff_offers SET meta = meta - 'document_scenarios' - '__rollout_marker__'
WHERE id='7a333f66-9bd1-48ae-b668-551e4b096eba';

-- 369c911a
UPDATE tariff_offers SET meta = meta - 'document_scenarios' - '__rollout_marker__'
WHERE id='369c911a-3c52-4b6f-bd21-cf55d03e48cc';
```

## Финальный статус

**PATCH-STRIPE-CONSULTATION-DOCUMENT-SCENARIOS-V1 = PASS**

Оговорка: фактическая production-генерация PDF по Stripe будет подтверждена на первой реальной оплате консультации. Техническая операция 2 USD для создания документа и присвоения номера не используется.
