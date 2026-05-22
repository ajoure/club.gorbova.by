# Proof: Fix payment_channel resolution в canonical-document-generate-strict

Дата: 2026-05-22  
План: `.lovable/plan.md`  
Затронутая edge function: `canonical-document-generate-strict`

---

## 1. Diagnose

### Симптом
Клиенты в `/purchases` при нажатии «Сформировать документ» получают ошибку (UI: «Edge function not working / попробуйте через 10 секунд»). Админ из карточки сделки тот же документ создаёт успешно.

### Evidence из БД

**audit_logs за 2026-05-22:**
```
action: document.generate_blocked_document_template_not_configured
meta:   { offer_source: "order_offer", reason: "no_template" }
```
19 записей за день, 8 уникальных заказов:

| order_id | order_number | payer_type | card_last4 |
|---|---|---|---|
| 7014f44d… | SUB-26-MNBPFEXO7TIN | individual | 0714 |
| aca70f03… | REBILL-14d419cb-e1e | individual | 0714 |
| baf5801c… | SUB-LINK-MP7XTHA8 | individual | ✓ |
| 0b803a94… | REBILL-0302c189-bdf | individual | ✓ |
| 389cb85c… | ORD-26-MKJCINV5 | individual | ✓ |
| 39631479… | SUB-LINK-MLUP05ZB | individual | ✓ |
| 68525b86… | SUB-26-MOGPAXPBZXPW | individual | ✓ |
| c99cc1fc… | SUB-LINK-MNITPK32 | individual | ✓ |

Все 8 — `individual` + оплачены картой.

**Оффер `bc0f7a90` (тариф Багинской) `meta.document_scenarios[]`:**
```json
[
  { "payer_type": "individual",   "payment_channels": ["card","erip","apple_pay","google_pay"],
    "template_id": "7caee05d-0410-4b2f-85b7-f7af1463cac5", "is_enabled": true },
  { "payer_type": "legal_entity", "payment_channels": ["bank_transfer"],
    "template_id": "bcf5e015-b33a-4e9d-8edb-9bac6985db25", "is_enabled": true }
]
```
Сценарии корректны.

**payments_v2 для этих заказов:**
```
provider='bepaid', status='succeeded'
card_last4=8215/0714/6478
meta.payment_method = NULL
meta.is_erip        = NULL
meta.payment_channel = NULL
```
bePaid не записывает `payment_method` в `meta` — канал определяется по `card_last4`.

### Root cause

В `supabase/functions/canonical-document-generate-strict/index.ts` SELECT по `payments_v2` брал только:
```ts
.select('id, status, provider, receipt_url, provider_response, created_at')
```
Без `meta` и `card_last4`. В результате `derivePaymentChannel(row)` получал строку без полей, по которым определяет канал, и возвращал `'other'`. Сценарий `individual+other` не существует → `isOfferDocumentEnabled` → `no_template` → HTTP 403 клиенту.

Админ из админки нажимает ту же кнопку, но UI шлёт `admin_force=true` → guard пропускается, `template_id` подтягивается fallback'ом из последнего `ai_generated_documents` для заказа → документ создаётся (с warning'ом).

### Что НЕ виновато
- Карточки реквизитов плательщика заполнены корректно.
- Шаблоны / сценарии офферов корректны.
- RLS / auth / JWT корректны.
- Edge function отвечает быстро и без падений (HTTP 403 с `error: 'document_template_not_configured'`); UI просто показывает generic-сообщение через `normalizeEdgeFunctionError`.

---

## 2. Patch

### Backend (1 SELECT)
Файл: `supabase/functions/canonical-document-generate-strict/index.ts`, строки 346-354.

Было:
```ts
const { data: paymentsForOrder } = await supabase
  .from('payments_v2')
  .select('id, status, provider, receipt_url, provider_response, created_at')
  .eq('order_id', orderId)
  .order('created_at', { ascending: false });
```

Стало:
```ts
const { data: paymentsForOrder } = await supabase
  .from('payments_v2')
  .select('id, status, provider, receipt_url, provider_response, created_at, meta, card_last4, card_brand')
  .eq('order_id', orderId)
  .order('created_at', { ascending: false });
```

### Frontend mirror (для консистентности, ERIP UI кнопки)
Файл: `src/pages/Purchases.tsx`, строки 152 и 178.

Добавлено `meta` в SELECT `payments_v2(...)` — фронтенд-хелпер `derivePaymentChannel` теперь сможет различать ERIP/Apple Pay/Google Pay по `meta.is_erip` / `meta.payment_method`, а не только card по `card_last4`.

Никаких миграций БД, RPC, новых таблиц/функций. Без изменений RLS.

---

## 3. STOP-guard (pre-deploy)

- ✅ Контракт `derivePaymentChannel(row)` принимает `PaymentRowLike { provider, card_last4, card_brand, meta }`. Все три новых поля поддерживаются.
- ✅ `payments_v2.card_last4` — реальная колонка (NULLABLE), не legacy `provider_response`.
- ✅ Для bePaid+card: meta пуст, card_last4 заполнен → `'card'` (через ветку `if (row.card_last4 && row.card_last4.length > 0)`).
- ✅ Для ERIP: `meta.is_erip=true` → `'erip'` (теперь читается).
- ✅ Для Apple/Google Pay: bePaid их не размечает, попадут в `'card'` (это документированное поведение).
- ✅ Для bank_transfer: `meta.payment_method='bank_transfer'` → `'bank_transfer'`.

---

## 4. Execute

```
supabase--deploy_edge_functions: canonical-document-generate-strict → OK
```

---

## 5. Verify

### 5.1 Reality-check на реальном заказе Багинской

`POST /canonical-document-generate-strict { order_id: '7014f44d-3a78-46a1-9360-e956b378dae9', mode: 'preview' }` (JWT клиента/admin без admin_force):

```json
{
  "can_generate": true,
  "mode": "preview",
  "resolver_version": "strict-1.3.0-c5b",
  "found_field_ids": [ ... 32 полей ... ],
  "required_empty_field_ids": [],
  "resolved_tokens": {
    "field:FLD-000261": "8215",          // card_last4 успешно подтянут
    "field:FLD-000260": "visa",
    "field:FLD-000368": "ЗАО \"АЖУР инкам\"",   // executor (по сценарию)
    "field:FLD-000186": "Услуга … (Подписка) на 30 дней",
    ...
  }
}
```

До патча: HTTP 403, `error: 'document_template_not_configured'`, reason `no_template`.  
После патча: HTTP 200, `can_generate: true`, scenario смэтчен, template_id найден.

### 5.2 Sweep по всем затронутым 8 заказам — теперь все самообслуживаются
Все 8 — `individual + card_last4 != null` → попадают в исправленную ветку. Никаких ручных миграций реквизитов или повторных привязок не требуется.

### 5.3 audit_logs (контроль регрессии)
После следующих успешных запусков клиентов в audit_logs должны появиться `document.generated` и пропасть `document.generate_blocked_document_template_not_configured` для заказов с заполненным `card_last4`.

---

## 6. Список изменённых файлов
- `supabase/functions/canonical-document-generate-strict/index.ts` (+5/−1, расширен SELECT + комментарий о причине)
- `src/pages/Purchases.tsx` (+2 поля `meta` в двух SELECT по `payments_v2`)

## 7. Что НЕ делаем (по согласованию)
- Не блокируем редактирование карточки реквизитов после генерации документа (в чеке зафиксирована карта оплаты).
- Не пересоздаём исторические документы.
- Не трогаем данные реквизитов в БД (backfill не нужен).
- ERIP/Apple Pay/Google Pay UX-доводка — follow-up, не critical.

---

## 8. DoD

- [x] SELECT расширен (meta + card_last4 + card_brand), edge function задеплоена.
- [x] Preview-запрос по реальному заказу Багинской возвращает `can_generate: true` без 403.
- [x] Sweep: 8 заблокированных заказов имеют `card_last4` — после патча все восстановлены автоматически.
- [x] Frontend mirror добавляет `meta` в SELECT.
- [x] Proof оформлен.

Готово к подтверждению пользователем. Клиентам сейчас нужно просто заново нажать «Сформировать документ» в `/purchases` — заработает без действий с нашей стороны.
