да, согласен, с учетом правок:

1. **Добавить fallback не только на** `offer_id`**, но и на уже готовый backend-provenance**

Сейчас backend уже доказал правильный результат:

```text
meta.document_data._provenance.template_resolution.source = scenario
meta.document_data._provenance.template_resolution.final_template_id = 7caee05d-...
meta.document_data._provenance.executor_resolution.final_executor_id = d0c7fe75-...
meta.document_data._provenance.scenario.scenario_id = 3e10a4f6-...
meta.document_data._provenance.offer_id_source = order_meta
```

Поэтому UI должен иметь fallback:

```ts
const docProv = meta?.document_data?._provenance;

const resolvedTemplateFromSnapshot =
  docProv?.template_resolution?.final_template_id ?? null;

const resolvedExecutorFromSnapshot =
  docProv?.executor_resolution?.final_executor_id ?? null;
```

Если `tariff_offers.meta` не загрузился, но `document_data._provenance` уже содержит финальный template/executor, карточка не должна показывать «Источник не задан». Она должна показать:

```text
Источник: по backend snapshot / scenario
```

Это не заменяет загрузку offer meta, но защищает UI от ложного красного статуса.

2. **Расширить fallback цепочку** `offerId` **полностью**

В `DealPayerDocumentsCard.tsx`:

```ts
const meta = typeof o.meta === "string" ? safeJsonParse(o.meta) : o.meta;

const offerId =
  o.offer_id
  ?? meta?.offer_id
  ?? meta?.tariff_offer_id
  ?? meta?.crm_routing_snapshot?.offer_id
  ?? meta?.checkout?.offer_id
  ?? meta?.payment?.offer_id
  ?? meta?.document_data?._provenance?.offer_id
  ?? null;
```

Важно: `safeJsonParse`, чтобы закрыть вариант, если где-то `meta` пришёл строкой.

3. **Добавить debug-proof прямо в UI, но только через** `console.debug`**, не visible UI**

На время proof:

```ts
console.debug("[DealPayerDocumentsCard] offer resolution", {
  orderId: o.id,
  columnOfferId: o.offer_id,
  metaOfferId: meta?.offer_id,
  crmOfferId: meta?.crm_routing_snapshot?.offer_id,
  provenanceOfferId: meta?.document_data?._provenance?.offer_id,
  finalOfferId: offerId,
});
```

После proof можно оставить как `console.debug`, не `warn`, чтобы не засорять консоль.

4. **Если** `tariff_offers.meta` **не загрузился — не писать “не выбран в кнопке”**

Текущий текст вводит в заблуждение. Разделить:

```text
offerId отсутствует → Не удалось определить оффер сделки.
offerId есть, но meta не загрузился → Не удалось загрузить настройки кнопки.
offerMeta есть, scenario не найден → Для типа плательщика/способа оплаты нет подходящего сценария.
scenario найден, template_id пуст → В сценарии кнопки не выбран шаблон.
scenario найден, executor_id пуст → В сценарии кнопки не выбран исполнитель.
```

5. **Не делать repair и не менять order**

Согласен: это UI-only patch. Никаких обновлений:

```text
orders_v2.offer_id
orders_v2.meta
orders_v2.meta.document_data
tariff_offers
payments_v2
```

6. **Verify должен включать reload без создания нового документа**

Проверка должна быть именно на открытии карточки сделки:

```text
Открыл Sheet → UI сам показал scenario/template/executor → кнопка активна
```

Нельзя считать proof успешным, если он появился только после нажатия «Создать документ» или после backend rebuild.

7. **Добавить отрицательный proof по старой ошибке**

В отчёте явно указать, что на `ORD-TEST-MPF6LTN4` после reload больше нет:

```text
Источник не задан
Автоматически (не задан в кнопке)
не выбран шаблон
не выбран исполнитель
```

8. **DoD добавить сравнение UI с backend provenance**

В proof таблицу:

```text
UI template_id = 7caee05d-...
backend provenance final_template_id = 7caee05d-...

UI executor_id = d0c7fe75-...
backend provenance final_executor_id = d0c7fe75-...

UI source = scenario
backend source = scenario
```

9. **Если** `tariff_offers` **RLS внезапно блокирует meta — не обходить через service_role**

UI должен либо:

- загрузить active offer через public RLS;
- либо использовать `document_data._provenance` fallback.

Не добавлять новую edge-function только ради чтения offer meta.

С этими правками план можно запускать.

&nbsp;

План: PATCH-DEAL-DOC-CARD-OFFER-RESOLUTION-2026-05

## Контекст (full discovery)

Тестовая сделка `#ORD-TEST-MPF6LTN4` (`d9096f1a-…`, lori `7500084@gmail.com` / user `05cd3754-…`). В карточке «Документы / плательщик» оба поля показывают:

- бейдж «Источник не задан»
- селект «Автоматически (не задан в кнопке)»
- статус: «не выбран шаблон» / «не выбран исполнитель» → блокировка генерации.

### Что показала БД (read-only verify)

1. `orders_v2`:
  - `offer_id` (колонка) = **NULL**
  - `tariff_id` = `31f75673-…`, `product_id` = `11c9f1b8-…`
  - `payer_type` = `individual`
  - `meta.offer_id` (top-level) = `6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e` ✅
  - `meta.crm_routing_snapshot.offer_id` = тот же
  - `meta.document_data._provenance` уже резолвлен бэкендом: `template_resolution.source='scenario'`, `final_template_id=7caee05d-…`, `executor_resolution.final_executor_id=d0c7fe75-…`, `scenario.scenario_id=3e10a4f6-…`, `offer_id_source='order_meta'`.
2. `tariff_offers` (`6f306cbc-…`):
  - `is_active=true` (RLS «Public can read active offers» разрешает)
  - `meta.document_scenarios[0]`: `payer_type=individual`, `payment_channels=[card,erip,apple_pay,google_pay]`, `template_id=7caee05d-…`, `executor_id=d0c7fe75-…`, `is_enabled=true`
  - `meta.document_scenarios[1]`: `payer_type=legal_entity`, `payment_channels=[bank_transfer]`, …
  - `meta.document_defaults.executor_id=d0c7fe75-…`, `template_id=NULL`
3. `payments_v2` (по order_id): один `succeeded`, `provider=admin_test`, `meta.payment_method='credit_card'` → frontend `derivePaymentChannel` → `'card'`.
4. `document_templates` `7caee05d-…` / `bcf5e015-…` — оба `template_status='active'`, `current_version_id` непустой. Появятся в селекте.
5. `executors` `d0c7fe75-…` — `is_active=true`.

### Логика фронта (DealPayerDocumentsCard + resolveDocumentScenario)

- `offerId = order.offer_id || order.meta?.offer_id` → должен взять `6f306cbc-…` через fallback;
- запрашивает `tariff_offers.meta` → должен вернуть meta с scenarios;
- `resolveDocumentScenario(meta, 'card', 'individual')` → должен вернуть `source='scenario'`, `template_id=7caee05d`, `executor_id=d0c7fe75`;
- бейдж тогда «По сценарию кнопки», селекты — «Автоматически» с подгруженными ID.

Бэкенд-резолвер (`document-resolver-v2`) тот же расчёт уже сделал, провенанс это подтверждает. Значит контракт по данным целый — расхождение только в визуализации карточки.

### Самая вероятная корневая причина (single point of failure)

`source='none'` появляется **только** если `offerMeta=null`, т.е. фронт не получил meta оффера. Это значит, что либо:

- **A.** `offerId` остался `null` (fallback на `meta.offer_id` не сработал). Возможно из-за приведения типов (`meta` приходит как строка/JSONB-как-есть в части ответов) или because supabase-js при `select("…, meta")` возвращает meta уже распарсенным, но проверки `(o as any)?.meta?.offer_id` не делается, если `meta` пришёл `null`/строкой. Дополнительно: `orders_v2.offer_id` (колонка) у всех админ-тест и public-link заказов **системно NULL** — это написано в `bepaid-create-token` (`skipRedirect` ветка, строки ~528-550, поле `offer_id` не передаётся в INSERT).
- **B.** Запрос `tariff_offers.meta` вернул ошибку/нет строки. Маловероятно (RLS и existence проверены), но возможен race, если `load()` стартовал до того, как `meta.offer_id` появился в орде (например, для одиночной тестовой оплаты момент write meta.offer_id ≠ момент INSERT orders_v2 — UI открыли в окне между ними; повторное открытие сейчас должно работать).
- **C.** «Источник не задан» приходит из live-resolver, потому что **defaults.template_id=NULL и сценарий не выбран** — но defaults.executor_id есть, значит при пустом scenarios всё равно вернётся `source='defaults'`. То есть C в чистом виде невозможен — обязательно A или B.

Без браузерного зондажа однозначно A или B не отделить. Поэтому план — закрыть оба пути одновременно, не трогая backend doc pipeline.

## Anti-goals (что НЕ трогаем)

- ❌ `payment-hook`, `canonical-document-generate-strict`, `document-resolver-v2`, бэкенд-резолверы и pipeline генерации.
- ❌ `tariff_offers.meta` (scenarios/defaults) — данные корректны.
- ❌ `payments_v2`, `orders_v2.payer_type/meta.document_data/_provenance`.
- ❌ Никакого refund / access / Telegram / subscriptions.
- ❌ Никаких новых таблиц, RPC, миграций (если не подтвердится необходимость в шаге 3).
- ❌ Не дублируем resolver — оставляем единственный `src/utils/resolveDocumentScenario.ts` (фронт) + `_shared/document-scenario-resolver.ts` (бэк).

## Шаги

### Шаг 1. Browser-зондаж (read-only, без правок)

1. Открыть превью на `/admin/deals?…`, найти сделку `ORD-TEST-MPF6LTN4`, открыть Sheet.
2. Снять network log: должен быть `GET tariff_offers?id=eq.6f306cbc-…&select=meta`. Если запроса нет → причина A (`offerId` не взялся). Если запрос есть и `data.meta` пустой → причина B. Если meta пришла полностью → проблема не в загрузке, а в маппинге (тогда смотрим, как `offerMeta` уходит в resolver).
3. Снять console (есть ли silent error от RLS/типа).

### Шаг 2. Жёсткое закрытие причины A (frontend only)

В `src/components/admin/DealPayerDocumentsCard.tsx` (`load()`):

- Расширить fallback цепочку и сделать её устойчивой к типам:
  ```ts
  const meta = (o as any)?.meta;
  const offerId =
    (o as any)?.offer_id ||
    meta?.offer_id ||
    meta?.crm_routing_snapshot?.offer_id ||
    meta?.document_data?._provenance?.offer_id ||
    null;
  ```
  Это покрывает админ-тест/public-link заказы, где column NULL, а top-level `meta.offer_id` иногда не успел появиться, но `crm_routing_snapshot.offer_id` всегда есть (его пишет invariant B.0 при INSERT).
- Если `offerId` найден, но первый запрос `tariff_offers.meta` вернул `null`, добавить лог `console.warn('[DealPayerDocumentsCard] offer meta missing', { offerId })` — без падения UI.
- Никаких новых таблиц / RPC / write-операций. Backend остаётся прежним.

### Шаг 3. Уточнение бейджа при «scenario с template_id=NULL»

Текущая логика: если scenario найден, но `template_id=NULL` и `executor_id=NULL`, идём в defaults. Это нормально, но статус-сообщение «не выбран шаблон» оставляется как есть.

Добавить в `statusItems` отдельную человекочитаемую причину, когда:

- offerMeta загружен, scenario матчится, но `template_id` пустой → «В сценарии кнопки не задан шаблон документа».
- offerMeta не загружен → «Не удалось определить оффер сделки (offer_id отсутствует). Свяжите сделку с офером кнопки или выберите шаблон вручную».

Только текст — без логики, влияющей на запись.

### Шаг 4. Verify (без БД-правок)

1. Перезагрузить сделку `ORD-TEST-MPF6LTN4` в Sheet:
  - бейдж шаблона = «По сценарию кнопки», селект auto-показ `7caee05d-…`.
  - бейдж исполнителя = «По сценарию кнопки», селект auto-показ `d0c7fe75-…`.
  - статус — зелёная «Реквизиты заполнены», кнопка «Создать документ» активна.
2. Открыть ещё 2-3 свежие сделки (`ORD-TEST-*`, `SUB-LINK-*`) — то же поведение.
3. Открыть старую сделку с `orders_v2.offer_id` заполненной колонкой — поведение прежнее, ничего не сломано.
4. `Сетевой лог`: `tariff_offers?id=eq.<offerId>` всегда уходит, статус 200, meta непустая.
5. Никакого изменения backend-провенанса (`meta.document_data._provenance`) и payment / refund / access — выборочно проверить, что не было ни одного write со стороны фронта при простом открытии Sheet.

### Шаг 5. Proof

`.lovable/proofs/patch_deal_doc_card_offer_resolution_2026_05.md` с:

- diagnosis (A/B/C) и подтверждением, какая ветка сработала;
- список изменённых файлов (ожидается только `DealPayerDocumentsCard.tsx`);
- verify результаты по 5 пунктам шага 4;
- явное подтверждение anti-goals (ничего не трогали в backend/payments/access).

## DoD

- В сделке `ORD-TEST-MPF6LTN4` бейджи показывают «По сценарию кнопки», селекты подсвечены, статус зелёный.
- Кнопка «Создать документ» активна и не показывает «не выбран шаблон/исполнитель», когда сценарий валиден.
- Никаких изменений в БД, edge functions, миграциях, RPC, payments_v2, orders_v2, tariff_offers, ai_generated_documents.
- Изменения только в одном файле `src/components/admin/DealPayerDocumentsCard.tsx` (плюс, опционально, мелкое расширение текста статуса в том же файле).
- Proof обновлён.

## Что НЕ нужно делать (явные дубли, которых избегаем)

- Не создавать новый resolver — есть `src/utils/resolveDocumentScenario.ts` (frontend) и `_shared/document-scenario-resolver.ts` (backend).
- Не писать backfill `orders_v2.offer_id` колонки массово — backend pipeline уже не зависит от неё, frontend закроется fallback'ом. Если позже захочется чистоты данных — отдельный backlog `BACKFILL-ORDERS-OFFER-ID-COLUMN`, без связи с этим патчем.
- Не править `bepaid-create-token` / `admin-create-public-link`, чтобы они писали колонку `offer_id`: это отдельный риск (схема/инварианты), не входит в скоуп UI-фикса.