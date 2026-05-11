---
name: Payer Type vs Payment Channel SOT
description: Разделение «способа оплаты» (канал) и «типа плательщика» в документах: derive-источники, override, STOP-guards
type: feature
---

## Канон

В системе документов `payment_channel` (КАК заплатили) и `payer_type` (КТО плательщик) — две независимые сущности.

### A. payment_channel (derived, не хранится колонкой)
Значения: `card | apple_pay | google_pay | erip | bank_transfer | other`.
SOT — `payments_v2`. Маппинг — единственный helper:
`supabase/functions/_shared/document-resolver-v2/payment-channel.ts → derivePaymentChannel(row)`.

Правила (priority):
1. `meta.is_erip=true` ИЛИ `meta.payment_method='erip'` → `erip`
2. `meta.payment_method ∈ {apple_pay, google_pay, bank_transfer, credit_card, card}` → соответствующий канал
3. `card_last4` непустой → `card`
4. `provider ∈ {admin, admin_test}` → `other`
5. иначе → `other`

bePaid сегодня НЕ размечает Apple Pay / Google Pay отдельно — они выглядят как `card`. Это известное ограничение discovery 2026-05-11.

### B. payer_type
Значения: `individual | legal_entity`. SOT — колонка `orders_v2.payer_type`.
**Запрещено дублировать в meta.** Override-источник — отдельное поле:
`orders_v2.meta.documents.payer_type_source ∈ {auto, admin_override}`.

### C. Каноническое место admin override
Только `orders_v2.meta.documents.*`:
- `payer_type_source`
- `payer_entity_override: { kind, id } | null`
- `template_override: uuid | null`
- `executor_override: uuid | null`
- `current_status: { requisites_status, checked_at, last_blocking_reason }`

`orders_v2.payer_type` пишется напрямую в колонку, в meta не дублируется.

### STOP-guards (запрещено)
- Выводить `payer_type` из `payment_channel`. Apple Pay / Google Pay / ЕРИП / bank_transfer ≠ автоматически юрлицо.
- Admin override модифицировать `payments_v2` или фактический способ оплаты.
- Хардкодить `status='succeeded'` россыпью — только helper `isSucceededStatus`.
- Fuzzy matching платежей по email/сумме. Только FK `payments_v2.order_id → orders_v2.id`.
- Авто-смена `individual → legal_entity` без admin override.
- Писать `card_holder/card_last4` в `individual_requisites` как реквизиты клиента.

### Связанное
- `payment.*` plaeholders — техническое описание платежа, не реквизиты плательщика.
- Реквизиты плательщика: `individual.*`, `legal_entity.*`, `executor.*`.
- Apple/Google Pay могут не отдавать `card_holder/card_brand/card_last4` — это не ошибка, токены резолвятся в пустую строку.
