# Backlog: webinar product bypass в live-resolve (server-side)

## Контекст
PATCH-WEBINAR-PRODUCT-VISIBILITY-BYPASS-V1 закрыл UI-видимость
training_content для отдельно купленных webinar-продуктов
(Наира: 2 вебинара, бывшие модули Club с `match_purchase_month=true`).

Server-side discovery показала, что `_shared/check-month-purchase.ts`
вызывается ТОЛЬКО в `supabase/functions/live-resolve/index.ts`
(playback живых событий, таблица `live_event_access_rules` + 
`event.metadata.content_month`). Доступ к lesson/training_content
через month-gate сервером не контролируется.

## Почему не сделано в основном патче
- Domain отдельный: live event playback ≠ training_content visibility.
- `live_event_access_rules` имеет своё `product_id/tariff_id/conditions`
  и не пересекается с `access_rules` для training_content.
- Риск регрессии для Club live-стримов > пользы (нет открытой жалобы
  на блокировку отдельно купленных webinar-стримов через live-resolve).

## TODO (если/когда понадобится)
1. Проверить, есть ли продукты-вебинары с live_event ссылками,
   где `live_event_access_rules` содержит Club product_id с
   `match_purchase_month=true`, перекрывая отдельный webinar product.
2. При подтверждении — добавить зеркальный bypass в `live-resolve`:
   если у user есть active entitlement на product_id из
   `live_event_access_rules` БЕЗ match_purchase_month — пропускать
   month-gate Club rule.
3. Покрыть unit-тестом fixture Наиры.

## Ссылки
- Proof: `.lovable/proofs/webinar_product_visibility_bypass_v1.md`
- Resolver: `supabase/functions/live-resolve/index.ts:200-261`
