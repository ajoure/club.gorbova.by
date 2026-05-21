# PATCH: единый канонический пайплайн service_name для всех тарифов

## Diagnose (read-only proof)

- `document_generation_rules`: активных нет → `canonical-document-payment-hook`
  фактически не используется. Все документы создаются вручную через
  `DealDocumentsPanel/DealPayerDocumentsCard → canonical-document-generate-strict`
  с явным `template_id`.
- `tariff_offers.meta.document_defaults.service_name` для CHAT/BUSINESS/FULL/ИДЕОЛОГИЯ
  «Оплатить»-офферов Gorbova Club заполнен корректно.
- Заказ Прайс Светлана (BUSINESS REBILL-9057cff2-6b1):
  `offer_id = NULL`, `meta.offer_id = NULL` →
  `pick('service_name')` возвращал `null` →
  FLD-000186 = `product.name` (а в шаблоне формат соседних ячеек давал
  «Gorbova Club. Тариф «BUSINESS»»).
- В CHAT-тарифе пользователь видел корректный текст, потому что тестовый
  CHAT-заказ был свежий и `order.offer_id` был заполнен.

Корневая причина: `document-data-snapshot.ts` не имел fallback'а offer_id для
REBILL и старых SUB-LINK заказов без явной привязки к офферу.

## Изменения

1. `supabase/functions/_shared/document-data-snapshot.ts`:
   - Добавлен `tariff_pay_now_fallback`: если `order.offer_id` и
     `meta.offer_id` пусты — берём активный `pay_now` оффер тарифа
     с непустым `meta.document_defaults`. Audit:
     `document_data.snapshot_offer_fallback`.
   - В `_provenance` добавлен `service_name_source ∈
     {offer | tariff | product | fallback_product_name | empty}` — позволяет
     в логах быстро найти тарифы, упавшие на fallback по имени продукта.

2. `src/hooks/useGeneratedDocuments.tsx`:
   - `useResendDocument` и `useRegenerateDocument` теперь зовут
     `canonical-document-generate-strict` напрямую (rebuild snapshot +
     генерация). Если `templateId` не передан — подтягивается из последнего
     `generated_documents.template_id` этого заказа.
   - Legacy `document-auto-generate` больше не вызывается из фронта.

3. Деплой: `canonical-document-generate-strict`,
   `canonical-document-payment-hook`, `canonical-deal-document-overrides`
   (все используют изменённый shared `document-data-snapshot.ts`).

## Не меняли

- `document-auto-generate` оставлен без изменений как compatibility layer —
  отдельный cleanup-спринт. Из фронта на него больше не ходим.
- БД-миграций не требуется.
- Регрессия по CHAT: путь и логика идентичны, только теперь BUSINESS/FULL/
  ИДЕОЛОГИЯ и REBILL заказы также подхватят `service_name` из offer.

## DoD

- При следующей перегенерации документа по REBILL/SUB-LINK заказам
  Gorbova Club: FLD-000186 = «Услуга по предоставлению платного доступа
  к ресурсам и материалам Клуба (Подписка) на 30 дней».
- В `audit_logs.document_data.snapshot_rebuilt.meta.provenance.service_name_source`
  для всех 4 тарифов = `offer`.
- Для заказов без `order.offer_id` появляется audit
  `document_data.snapshot_offer_fallback` с `picked_offer_id`.
- Тариф CHAT не регрессирует (тот же путь).

## Follow-up (backlog)

- Превратить `document-auto-generate` в тонкий прокси к canonical и удалить
  legacy `tariffParams.service_title`-логику.
- Решить, что делать с заказами без `order.offer_id` на уровне записи
  (бэкфилл из subscriptions_v2 или принять fallback как нормальное состояние).
