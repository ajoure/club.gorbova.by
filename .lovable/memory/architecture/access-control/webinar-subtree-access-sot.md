---
name: Webinar Subtree Access SOT
description: Webinar subtree (8c7fd507 under База знаний 8b1fb03e) доступ только через TC rule с tariff_id=BUSINESS Gorbova Club + match_purchase_month=true + allowed_module_ids
type: feature
---
# Webinar Subtree Access SOT

**Subtree root:** `8c7fd507-bb76-4308-9ac2-1e4ffea62d61` (Вебинары), parent `8b1fb03e-…` (База знаний).
**Product:** Gorbova Club `11c9f1b8-0355-4753-bd74-40b42aa53616`.
**BUSINESS tariff:** `7c748940-dcad-4c7c-a92e-76a2344622d3`.

## Правила доступа (SOT)
Доступ к любому webinar-модулю даёт ТОЛЬКО:
- `access_rules.grant_target_type='training_content'`
- `target_ref='8b1fb03e-…'` (root «База знаний»)
- `tariff_id='7c748940-…'` (BUSINESS)
- `conditions.match_purchase_month=true`
- `conditions.allowed_module_ids` содержит конкретный webinar module_id
- + RPC `has_month_purchase_bulk` подтверждает paid order с `meta.deal_month = content_month`

## Запреты
- FULL/CHAT/ИДЕОЛОГИЯ — НЕ должны видеть webinar subtree (rule allowed-list исключает webinar модули; CHAT/ИДЕОЛОГИЯ вообще без TC rule).
- standalone-продукты (ghost или активные) — НЕ должны открывать webinar subtree через TC rule на root «База знаний». Любая такая rule — leak.
- Hardcoded UUID-проверки `8c7fd507` в коде запрещены — нарушает ID-First. Защита через `access_rules` SOT.

## RPC contract
`has_month_purchase_bulk(_user_id, _items)` обязан резолвить заказы и через `user_id`, и через `profile_id` (legacy импорт). См. migration 20260501173639.

## Auto-fill
Триггер `orders_v2_autofill_deal_month_trg` (BEFORE INSERT/UPDATE) гарантирует `meta.deal_month` для всех новых paid orders в TZ Europe/Minsk. Не перезаписывает существующий.

## Cleanup precedent (2026-05-01)
Деактивированы 3 leak rules: `417e5071`, `a377fb0b`, `ecf3e655`. Любое будущее правило с `target_ref='8b1fb03e-…'` БЕЗ `tariff_id=BUSINESS + match_purchase_month=true` → leak, требует deactivate.
