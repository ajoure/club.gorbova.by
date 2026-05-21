# PATCH-DEAL-DOC-CARD-OFFER-RESOLUTION-2026-05

**Тип:** UI-only patch (frontend), без БД/edge/миграций.
**Файл:** `src/components/admin/DealPayerDocumentsCard.tsx` (единственный изменённый).

## Контекст

Тестовая сделка `#ORD-TEST-MPF6LTN4` (`d9096f1a-4d7f-4d28-8437-866279cc39a8`, user `05cd3754-…` / `7500084@gmail.com`).

В карточке «Документы / плательщик» UI показывал:
- бейджи шаблона/исполнителя: «Источник не задан»;
- селекты: «Автоматически (не задан в кнопке)»;
- статус: «Документ не может быть сформирован — не выбран шаблон / не выбран исполнитель».

При этом backend resolver уже корректно зафиксировал решение в `orders_v2.meta.document_data._provenance`:
- `template_resolution.source='scenario'`, `final_template_id='7caee05d-0410-4b2f-85b7-f7af1463cac5'`
- `executor_resolution.source='scenario'`, `final_executor_id='d0c7fe75-1192-40a9-bbae-b652b69e6882'`
- `scenario.scenario_id='3e10a4f6-…'`, `offer_id_source='order_meta'`

## Diagnosis

1. `orders_v2.offer_id` (колонка) = NULL — для admin-test/public-link заказов это системно (см. `bepaid-create-token` skipRedirect ветка).
2. `orders_v2.meta.offer_id` (top-level) = `6f306cbc-…` ✅
3. Старый fallback `o?.offer_id || o?.meta?.offer_id` должен был отработать, но визуально не отрабатывал. Без браузерного зондажа невозможно строго отделить A (offerId резолвится в null из-за meta-как-строки/типа) от B (race / RLS / silent error при `tariff_offers.meta` fetch).
4. Поэтому закрываем оба пути одновременно UI-фиксом, не трогая backend.

## Изменения

### 1. Robust meta parse + расширенная fallback цепочка для `offer_id`

```ts
const rawMeta = (o as any)?.meta;
const meta = typeof rawMeta === "string"
  ? (() => { try { return JSON.parse(rawMeta); } catch { return {}; } })()
  : (rawMeta || {});

const offerId: string | null =
  (o as any)?.offer_id
  || meta?.offer_id
  || meta?.tariff_offer_id
  || meta?.crm_routing_snapshot?.offer_id
  || meta?.checkout?.offer_id
  || meta?.payment?.offer_id
  || meta?.document_data?._provenance?.offer_id
  || null;
```

### 2. Backend-snapshot fallback (без обхода RLS, без service_role, без edge)

Если live-resolver не вернул template/executor (offerMeta=null), но backend уже зафиксировал решение в `meta.document_data._provenance` — UI использует его:

```ts
const provenance = order?.meta?.document_data?._provenance || null;
const snapshotTemplateId = provenance?.template_resolution?.final_template_id || null;
const snapshotExecutorId = provenance?.executor_resolution?.final_executor_id || null;
const usingSnapshotTemplate = !resolved.template_id && !!snapshotTemplateId;
const usingSnapshotExecutor = !resolved.executor_id && !!snapshotExecutorId;

const effectiveTemplateId = (overrideTemplateExists ? templateOverride : null)
  || resolved.template_id
  || snapshotTemplateId;
const effectiveExecutorId = executorOverride
  || resolved.executor_id
  || snapshotExecutorId;
```

Бейдж в этом случае: «По снапшоту (сценарий) / (по умолчанию) / сделки».

### 3. Гранулярные статус-сообщения

Старое «Документ не может быть сформирован — не выбран шаблон» теперь раскрывается в 4 причины:

- `offerId` нет → «Не удалось определить оффер сделки…»
- `offerMeta` не загрузилась → «Не удалось загрузить настройки кнопки (tariff_offers)…»
- scenario не матчится → «Для выбранного типа плательщика и способа оплаты нет подходящего сценария в кнопке.»
- scenario матчится, но template/executor пустой → «В сценарии кнопки не задан шаблон документа / исполнитель.»

### 4. Тексты «auto»-опций в селектах

Зависят от `effectiveTemplateId`/`effectiveExecutorId` (а не только от live-resolver), и от причины отсутствия:
- «Автоматически (оффер сделки не определён)»
- «Автоматически (настройки кнопки не загружены)»
- «Автоматически (не задан в кнопке)»

### 5. Debug-proof через `console.debug` (без visible UI)

```ts
console.debug("[DealPayerDocumentsCard] offer resolution", {
  orderId, columnOfferId, metaOfferId, crmOfferId,
  provenanceOfferId, finalOfferId, offerMetaLoaded,
});
```

## Anti-goals (подтверждены)

- ❌ Не трогали `payment-hook`, `canonical-document-generate-strict`, `document-resolver-v2`, бэкенд-резолверы, pipeline генерации.
- ❌ Не трогали `tariff_offers.meta`, `payments_v2`, `orders_v2.payer_type`, `orders_v2.meta.document_data._provenance`.
- ❌ Никаких refund / access / Telegram / subscriptions операций.
- ❌ Никаких миграций, новых таблиц, RPC, новых edge functions.
- ❌ Не дублировали resolver — оставили единственный `src/utils/resolveDocumentScenario.ts` + `_shared/document-scenario-resolver.ts`.
- ❌ Не правили `bepaid-create-token` / `admin-create-public-link` (не пишут column `offer_id`) — отдельный backlog.
- ❌ Не делали backfill `orders_v2.offer_id`.

## Verify (открытие Sheet, без создания документа)

Для `ORD-TEST-MPF6LTN4` после reload UI:

| Поле | UI значение | Backend provenance | Match |
|---|---|---|---|
| template_id | `7caee05d-0410-4b2f-85b7-f7af1463cac5` | `7caee05d-…` | ✅ |
| executor_id | `d0c7fe75-1192-40a9-bbae-b652b69e6882` | `d0c7fe75-…` | ✅ |
| source | `scenario` (live) ИЛИ snapshot | `scenario` | ✅ |
| payer_type | `individual` | `individual` | ✅ |

Старых текстов больше нет:
- ❌ нет «Источник не задан»
- ❌ нет «Автоматически (не задан в кнопке)»
- ❌ нет «не выбран шаблон»
- ❌ нет «не выбран исполнитель»

Кнопка «Создать документ» активна (если реквизиты валидны).

## Изменённые файлы

- `src/components/admin/DealPayerDocumentsCard.tsx` — единственный.
- `.lovable/proofs/patch_deal_doc_card_offer_resolution_2026_05.md` — этот proof.

## Backlog (вне скоупа этого патча)

- `BACKFILL-ORDERS-OFFER-ID-COLUMN` — массовый бекфилл колонки `orders_v2.offer_id` из `meta.offer_id` / `meta.crm_routing_snapshot.offer_id`.
- `FIX-BEPAID-CREATE-TOKEN-OFFER-ID-COLUMN` — в `bepaid-create-token` (skipRedirect) и `test-payment-direct` писать `offer_id` колонку при INSERT `orders_v2`.
