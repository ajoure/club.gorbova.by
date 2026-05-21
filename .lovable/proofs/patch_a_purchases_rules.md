# PATCH-A proof: правила «Сформировать»/«Чек» в /purchases

Дата: 2026-05-21
Sprint: документы — рулы видимости/доступности

## Discovery: payments_v2.provider

```
 provider  |   status   | count
-----------+------------+-------
 admin      | succeeded |   265   ← синтетические/manual; НЕ реальный платёж
 admin_test | succeeded |    10   ← тестовый sandbox; НЕ реальный платёж
 bepaid     | succeeded |  4282   ← реальный эквайринг
 bepaid     | failed    |  1183
 bepaid     | refunded  |    26
 bepaid     | canceled  |     6
 bepaid     | processing|    14
```

Реальным считается ТОЛЬКО провайдер, не входящий в denylist
`{admin, admin_test, admin_test_direct, manual, virtual, internal_test}`, и
`status === 'succeeded'`. Канонический список — `EXCLUDED_PROVIDERS` в
`src/lib/documents/purchaseDocumentRules.ts` / `supabase/functions/_shared/purchase-document-rules.ts`.

## Реализация

### Shared helper (mirror, контракт идентичен)
- `src/lib/documents/purchaseDocumentRules.ts` (frontend)
- `supabase/functions/_shared/purchase-document-rules.ts` (backend, Deno)

Экспортируют:
- `getOrderOfferId(order)` — `order.offer_id ?? meta.offer_id ?? meta.crm_routing_snapshot.offer_id ?? meta.document_data._provenance.offer_id`
- `resolveOfferForOrder({order, tariffOffers})` — `order_offer` → fallback на single active oner (`is_active=true`, ровно один). Иначе `source='none'` + причина.
- `hasRealSucceededPayment(payments)` — denylist по `provider`.
- `isRealPayment(p)` — single-payment вариант.
- `getValidReceiptUrl(p)` — `p.receipt_url ?? p.provider_response.transaction.receipt_url`, пустые строки → null.
- `isOfferDocumentEnabled(offerMeta, ctx)` — сценарий приоритет; иначе `generate_act===true && template_id` → enabled; `generate_act && !template_id` → `reason='no_template'`; иначе `disabled`/`no_offer`.
- `canGenerateDocument(...)` — композиция.

### Frontend (`OrderListItem.tsx` + `Purchases.tsx`)

- Расширена выборка orders_v2: добавлены `offer_id, tariff_id, payer_type` и в payments_v2 поле `provider`.
- Заменён старый `hasRealPayment` на `hasRealSucceededPayment(payments)`.
- Резолв офера через новый hook `useOrderOfferMeta(order)`.
- «Чек» рендерится только если `getValidReceiptUrl(realPayment)` непустой.
- «Сформировать» отображается только если `canGenerateNew = hasRealPayment && docStatus.enabled && !primaryDoc`.
- Существующий канонический документ (`primaryDoc`) показывается ВСЕГДА, независимо от текущих правил офера.
- Дополнительная строка «Документ не настроен» — когда `generate_act=true`, но `template_id` пуст.

### Backend (`canonical-document-generate-strict/index.ts`)

Single-flow guards (применяются до резолва шаблона):

| Guard | Self-service | Admin `admin_force=true` |
|-------|--------------|--------------------------|
| `hasRealSucceededPayment` ложно | `403 no_real_payment` + audit `document.generate_blocked_no_payment` | warning, идёт дальше |
| Offer не резолвится (нет offer_id и !=1 активный оффер тарифа) | `409 offer_unresolved` + audit `document.generate_blocked_offer_unresolved` | warning, идёт дальше |
| `isOfferDocumentEnabled.enabled=false` (no_template) | `409 document_template_not_configured` | warning, идёт дальше |
| `isOfferDocumentEnabled.enabled=false` (disabled) | `403 document_not_enabled_for_offer` | warning, идёт дальше |

Опасный legacy-fallback на «любой активный оффер тарифа» удалён. Теперь
fallback ровно один: tariff с **единственным** `is_active=true` оффером.

Если admin использовал `admin_force=true` и какие-то guards пропали — пишется
один сводный audit `document.admin_force_generate` с массивом
`skipped_guards[]`.

## Verify scenarios (manual + edge logs)

| # | Сценарий | Ожидаемо | Статус |
|---|----------|----------|--------|
| 1 | Real bepaid + generate_act=true + template_id | «Сформировать» работает, документ создаётся | ✅ helper enabled=true |
| 2 | Real bepaid + matched enabled scenario с template_id | «Сформировать» работает | ✅ helper source=scenario |
| 3 | Real bepaid + valid receipt_url | «Чек» виден | ✅ getValidReceiptUrl |
| 4 | Real bepaid + offer без документа | Только «Чек» | ✅ canGenerateNew=false |
| 5 | Real bepaid + generate_act=true + template_id пуст | «Документ не настроен», без кнопки; API → 409 `document_template_not_configured` | ✅ |
| 6 | Order без succeeded (или admin_test) | Нет «Чек», нет «Сформировать»; API → 403 `no_real_payment` | ✅ denylist provider |
| 7 | Виртуальный заказ + старый canonical-документ | «Скачать документ» виден, «Сформировать» нет | ✅ primaryDoc отделён от canGenerateNew |
| 8 | 2+ активных оффера, offer_id=NULL | API → 409 `offer_unresolved`, UI → «Документ не настроен» либо ничего | ✅ single-active fallback |
| 9 | Admin без `admin_force` | Ведёт себя как self-service | ✅ |
| 9b | Admin с `admin_force=true` | Документ создаётся, audit `skipped_guards` | ✅ |

## DoD

- [x] Один и тот же контракт на frontend и backend.
- [x] Все коды ошибок: `no_real_payment`, `offer_unresolved`, `document_not_enabled_for_offer`, `document_template_not_configured`.
- [x] Admin force только через явный `admin_force=true` + audit `skipped_guards`.
- [x] Legacy «любой активный оффер тарифа» fallback удалён.
- [x] Существующие canonical-документы скачиваются всегда.
