---
name: Document Scenarios SOT (Sprint 12)
description: tariff_offers.meta.document_scenarios[] — массив сценариев документа по (payer_type, payment_channel); приоритет override → scenario → defaults; payment_channels канон, payment_methods legacy read-only
type: feature
---

## Канон

Сценарии документа хранятся **только** в `tariff_offers.meta.document_scenarios[]`.
Новых таблиц/колонок нет.

### Формат записи (canonical)

```json
{
  "id": "uuid",
  "payer_type": "individual" | "legal_entity",
  "payment_channels": ["card","apple_pay","google_pay","erip","bank_transfer"],
  "template_id": "uuid|null",
  "executor_id": "uuid|null",
  "requires_required_requisites": true|false,
  "is_enabled": true|false
}
```

- `payment_channels: []` = «любой канал того же payer_type».
- `is_enabled !== false` → активен. Legacy-записи без флага считаются активными.
- `payment_methods` — legacy read-only. UI читает `payment_channels ?? payment_methods`,
  пишет всегда только `payment_channels`. Глобальной миграции нет — нормализация
  происходит при сохранении конкретного оффера (one-shot read-merge-write).

### Приоритет резолвинга template_id / executor_id

```
1. orders_v2.meta.documents.template_override / executor_override   (manual)
2. matched tariff_offers.meta.document_scenarios[]                  (live)
3. tariff_offers.meta.document_defaults                             (fallback)
4. block / warning, если значения нет
```

При создании snapshot заказа шаг 1 обычно пуст (override может быть задан позже
вручную в карточке сделки). Snapshot фиксирует matched scenario в
`document_data._provenance.scenario`. В карточке сделки сценарий вычисляется
**live** из order/payment/offer + overrides; если сценарий оффера изменён после
оплаты — старый `ai_generated_documents` snapshot не переписывается.

### Карточка сделки

- `DealPayerDocumentsCard` — «Документы / плательщик»: live matched scenario;
  бейдж «Изменено вручную администратором» показывается только при фактическом
  override; иначе «По сценарию кнопки» / «По умолчанию» / «Источник не задан».
- `DealDocumentsCard` — «Сформированные документы»: список DOCX (история).
  Дублирование заголовка «Документы» запрещено.

### Резолвер

- Frontend: `src/utils/resolveDocumentScenario.ts` (+ `derivePaymentChannel.ts`).
- Backend mirror: `supabase/functions/_shared/document-scenario-resolver.ts`.
- Алгоритм одинаковый. При расхождении — backend = SOT.

### STOP-guards

- Запрещено выводить `payer_type` из `payment_channel` (см.
  `payer-vs-payment-channel-sot`).
- Apple Pay / Google Pay у bePaid могут приходить как `card` — это известное
  ограничение; UI в карточке сценариев показывает предупреждение.
- Override никогда не модифицирует `payments_v2`. Только
  `orders_v2.meta.documents.*` через `canonical-deal-document-overrides`
  (JWT actor + audit).
- Глобальная миграция legacy `payment_methods` запрещена; только one-shot
  при сохранении конкретного оффера.
