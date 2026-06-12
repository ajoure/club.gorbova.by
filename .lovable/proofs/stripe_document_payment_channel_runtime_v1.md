# PROOF: Runtime Deployment Gate — Stripe → card mapping

**Patch:** PATCH-STRIPE-CONSULTATION-DOCUMENT-SCENARIOS-V1 / Этап I (Runtime gate)
**Status:** PASS
**Date:** 2026-06-12 09:47 UTC
**Source code (already merged in PATCH-STRIPE-DOCUMENT-ACT-CHECK-V1):**
- `supabase/functions/_shared/document-resolver-v2/payment-channel.ts` (line 44: `if (row.provider === 'stripe') return 'card';`)
- `src/utils/derivePaymentChannel.ts` (frontend mirror, идентичная логика)

## 1. Deployed functions (7)

Deploy выполнен через `supabase--deploy_edge_functions`, ответ: `Successfully deployed edge functions: canonical-document-generate-strict, canonical-document-payment-hook, canonical-document-regenerate, canonical-document-generate, canonical-deal-document-overrides, document-field-resolver-v2, document-field-resolver-v2-snapshot`

| Function | Импортирует | Подтверждено |
|----------|-------------|--------------|
| canonical-document-generate-strict | document-data-snapshot, document-resolver-v2/payment-channel | ✅ |
| canonical-document-payment-hook    | document-render, document-data-snapshot                      | ✅ |
| canonical-document-regenerate      | document-render                                              | ✅ |
| canonical-document-generate        | document-render                                              | ✅ |
| canonical-deal-document-overrides  | document-data-snapshot                                       | ✅ |
| document-field-resolver-v2         | resolver→payment-channel (transitive)                        | ✅ |
| document-field-resolver-v2-snapshot| resolver→payment-channel (transitive)                        | ✅ |

Frontend `src/utils/derivePaymentChannel.ts` распространяется через штатный Lovable Publish.

## 2. Runtime call (не grep)

`POST /document-field-resolver-v2 { order_id: '849c68b7-7296-4660-8265-841bc57f7aa5' }` (Stripe USD 2.00 paid order).

Response HTTP 200, `resolver_version=v2-1.0.0`, `mode=preview`, `ok=true`.

Ключевые резолвленные поля:
- `FLD-000161 = "USD"` ← `orders_v2.currency`, **не** `products_v2.currency='BYN'`. Доказывает: валюта документа берётся из заказа.
- `FLD-000160 = 2` ← `orders_v2.final_price`. Сумма динамическая.
- `FLD-000192 = "2 (два) доллара США, 00 центов"` ← amount-in-words по фактической валюте заказа.
- `FLD-000193 = "долларов США"` ← currency-в-словах.
- `FLD-000186 = "Платная консультация"` ← название продукта.
- `FLD-000104 = 'ЗАО "АЖУР инкам"'` ← default executor (будет переопределён pilot scenario на тот же executor для консультаций).

## 3. Frontend ↔ Backend mirror

`src/utils/derivePaymentChannel.ts` (frontend) и `supabase/functions/_shared/document-resolver-v2/payment-channel.ts` (backend) содержат идентичную последовательность проверок (is_erip → apple_pay → google_pay → bank_transfer → credit_card/card → card_last4 → **stripe→card** → admin_test+marker→card → admin→other). Diff пустой.

## 4. Маппинг канон (логический smoke по таблице решений)

| provider | meta.payment_method | meta.is_erip | card_last4 | ожидаемый канал | new | old |
|----------|---------------------|--------------|------------|------------------|-----|-----|
| stripe   | —                   | —            | —          | **card**         | ✅  | other |
| stripe   | —                   | —            | 3587       | card             | ✅  | card  |
| bepaid   | credit_card         | false        | 4242       | card             | ✅  | card  |
| bepaid   | erip                | true         | —          | erip             | ✅  | erip  |
| admin    | —                   | —            | —          | other            | ✅  | other |
| admin_test | — | — | — | (без test marker) → other | ✅  | other |
| admin_test | — | — | — | (с meta.test_payment=true) → card | ✅  | card |

Реальные DB-строки `payments_v2` с `provider='stripe'`:
- `00b39954-…` succeeded USD 2.00 (тестовая операция) → resolver → card ✅
- `2d40bc7e-…` succeeded BYN 5.00 с last4=3587 → card ✅
- `0da381ef-…` refunded BYN −5.00 → card ✅

bePaid regression: маппинг bePaid → card / erip не изменён (исходная логика осталась первой по приоритету).

## 5. Auto-gen guard для консультаций

`canonical-document-payment-hook` имеет **3 независимых блока** перед запуском авто-генерации:
1. `app_settings.documents_canonical_generation_enabled = false` → no-op.
2. `app_settings.documents_service_act_auto_generation_enabled = false` → no-op.
3. Отсутствие активного `document_generation_rules` для (product_id, tariff_id, offer_id) → skip.

Проверка БД:
```sql
SELECT key,value FROM app_settings
 WHERE key IN ('documents_canonical_generation_enabled','documents_service_act_auto_generation_enabled');
-- documents_canonical_generation_enabled        | false
-- documents_service_act_auto_generation_enabled | false

SELECT count(*) FROM document_generation_rules
 WHERE product_id='9d0d6de8-4b0e-477f-b6c4-ab7def8268f6' OR ...
-- 0
```

→ Pilot (Этап II) НЕ запустит авто-генерацию актов для консультаций даже после записи `document_scenarios`. Сценарий используется только ручной кнопкой «Сформировать» в `/purchases`.

## 6. ai_generated_documents — baseline

```sql
SELECT count(*) FROM ai_generated_documents agd
JOIN orders_v2 o ON o.id = agd.context_id::uuid
WHERE agd.context_type='order' AND o.product_id='9d0d6de8-4b0e-477f-b6c4-ab7def8268f6';
-- 0
```

После runtime gate count не изменился (gate не пишет ничего; runtime call — preview-only).

## 7. DoD Runtime Gate

- [x] Build clean (deploy success без ошибок).
- [x] 7 функций задеплоены с runtime version `v2-1.0.0`.
- [x] Runtime-вызов резолвера на реальном Stripe-заказе вернул USD/2.00/корректные FLD.
- [x] Frontend ↔ Backend mirror = идентичны.
- [x] bePaid regression: маппинг card/erip сохранён.
- [x] admin_test+test_marker → card сохранён.
- [x] `ai_generated_documents` count неизменён.
- [x] Auto-gen guard трёхуровневый — pilot scenarios безопасны.

**Этап I = PASS. Продолжаю Этап II (pilot document_scenarios на `f71b5ed3-…`).**
