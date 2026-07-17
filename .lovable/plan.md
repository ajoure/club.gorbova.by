## Диагноз — **подтверждён**

Проблема не в канбане. Заказ создаётся без `pipeline_id`, поэтому `useDealsBoard` закономерно его не показывает.

Но текущий план нужно скорректировать в четырёх местах. Иначе появится fallback, но исторические заказы и terminal-routing останутся частично сломанными.

## 1. Нужен один общий resolver, а не одинаковые вставки в трёх функциях

Сейчас `resolveOfferRoutingWithFallback()` при наличии `offer_id` делает следующее:

```ts
const r = await resolveOfferRouting(supabase, offer_id);
return r;

```

То есть при существующем `offer_id`, но отсутствующем `meta.crm_routing`, до tariff fallback он вообще не доходит. Название функции в этом случае вводит в заблуждение.

Нужно добавить в `_shared/crm-routing.ts` единый публичный метод, например:

```ts
resolveOrderRouting(supabase, {
  offer_id,
  tariff_id,
  product_id,
  flow_kind,
})

```

Порядок:

```text
1. Явный crm_routing текущего offer_id
2. Tariff fallback — только когда offer_id отсутствует
3. Product-binding fallback
4. Negative snapshot

```

И уже его использовать в:

- `public-rr-installment-initiate`;
- `_shared/create-payment-checkout.ts`;
- `_shared/create-stripe-checkout.ts`.

Не копировать последовательность resolver-вызовов по разным файлам.

---

## 2. `resolved_via` сейчас не попадёт в положительный snapshot

Текущий `CrmRoutingSnapshot` не содержит `resolved_via`. Это поле есть только в результате resolver, но в `orders_v2.meta.crm_routing_snapshot` записывается непосредственно `routing.snapshot`.

Следовательно, заявленная проверка:

```text
meta.crm_routing_snapshot.resolved_via
= product_binding_fallback

```

не пройдёт без изменения типа snapshot.

Добавить:

```ts
resolved_via:
  | "offer_id"
  | "tariff_fallback"
  | "product_binding_fallback";

resolved_at: string;
product_id: string | null;
binding_id: string | null;

```

В положительном snapshot сохранять фактический `offer_id`, даже когда стадии получены через product binding.

Также расширить union в:

- `ResolvedRouting`;
- `NegativeRoutingSnapshot`;
- `buildNegativeSnapshot`;
- `auditNegativeSnapshot`.

---

## 3. Product fallback не должен произвольно выбирать первую стадию по имени

Правило:

```text
name ~* '^заявка'

```

опасно. В одной воронке могут существовать:

- «Заявка»;
- «Заявка на кредит»;
- «Заявка на консультацию».

Выбор первой по `order_index` снова создаст скрытое поведение.

### Канонический root-fix

Для всех активных `bank_installment`-офферов ЦБ 2.0 нужно явно заполнить:

```json
meta.crm_routing = {
  "enabled": true,
  "pipeline_id": "...",
  "stage_on_pending": "8c8ca380-cc65-4863-8e04-01d9dd357306",
  "stage_on_success": "...",
  "stage_on_failed": "..."
}

```

То есть product-binding fallback остаётся страховочной compatibility-layer, но актуальные продающие офферы после data-fix больше не должны от него зависеть.

Для самого fallback:

1. ровно один активный product binding;
2. pending — `is_default=true` среди открытых стадий;
3. success — единственная `closed_won`;
4. failed — единственная `closed_lost`;
5. при неоднозначности — negative snapshot, а не произвольный выбор.

Для РР нужная стадия **«Заявка на кредит»** должна задаваться явным `crm_routing` оффера.

---

## 4. Backfill должен обновлять не только две колонки

Предложенный UPDATE:

```sql
SET pipeline_id = ...,
    pipeline_stage_id = ...

```

недостаточен.

`applyCrmStageOnTerminal()` использует исключительно:

```text
orders_v2.meta.crm_routing_snapshot

```

Если оставить старый negative snapshot либо отсутствие snapshot, такой заказ впоследствии не перейдёт автоматически в успешную или неуспешную стадию.

Backfill должен атомарно обновлять:

```text
pipeline_id
pipeline_stage_id
meta.crm_routing_snapshot

```

### Стадия зависит от текущего статуса заказа

Нельзя все заказы за 30 дней помещать в pending:


| Текущий заказ            | Целевая стадия     |
| ------------------------ | ------------------ |
| pending / lead / created | `stage_on_pending` |
| paid / completed         | `stage_on_success` |
| failed / canceled        | `stage_on_failed`  |


Для `ORD-26-00341` — стадия **«Заявка на кредит»**.

Guard backfill:

```text
pipeline_id IS NULL
pipeline_stage_id IS NULL
meta.rr существует
product_id имеет ровно один binding
нет признаков ручного перемещения

```

В snapshot отметить:

```json
{
  "resolved_via": "product_binding_fallback",
  "backfilled": true,
  "backfilled_at": "..."
}

```

## Верификация

Не нужно создавать три реальные заявки в боевом API РР только ради проверки CRM-routing. Это создаст три внешних заказа у провайдера.

Достаточно:

1. unit/integration-проверки resolver для трёх офферов без вызова РР;
2. deploy общего resolver и `public-rr-installment-initiate`;
3. одного нового live smoke через проблемный оффер;
4. проверить:
  - `pipeline_id`;
  - `pipeline_stage_id`;
  - положительный snapshot;
  - `resolved_via`;
  - audit;
  - видимость карточки в канбане;
5. backfill `ORD-26-00341` и остальных подходящих NULL-заказов;
6. screenshot канбана.

Синтетические уже созданные заказы нельзя просто помечать `canceled`, не учитывая, что заявка могла сохраниться у РР. Для новых тестов использовать максимум один контролируемый live-вызов.

## Решение

```text
DIAGNOSIS                    : PASS
PRODUCT-BINDING FALLBACK     : APPROVED WITH CHANGES
CENTRAL UNIFIED RESOLVER     : REQUIRED
EXPLICIT ROUTING BACKFILL    : REQUIRED
ORDERS SNAPSHOT BACKFILL     : REQUIRED
BLIND STAGE NAME MATCHING    : REJECTED
3 LIVE RR SIMULATIONS        : REJECTED

```

После этих поправок план закрывает не только видимость сделки на канбане, но и последующий автоматический перевод сделки при успехе или отказе РР.

&nbsp;

Отчёт о диагностике

**Что нашёл в БД (последние 24 ч):**


| Order                          | Кнопка / оффер                                                                                     | pipeline_id                       | Итог                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------- |
| ORD-26-00343 (Сергей Ф.) 12:21 | offer `77dd831a` «Рассрочка от банка» (Бухгалтер, 20 поток) — `meta.crm_routing.enabled=true`      | ✅ проставлен, stage «Счет для ЮЛ» | Виден в CRM                      |
| ORD-26-00341 (Сергей Ф.) 12:06 | offer `58de9fea` «Заявка на рассрочку» (Главный бухгалтер, 20 поток) — `meta.crm_routing` НЕ задан | ❌ `NULL`                          | **Пропала: невидима на канбане** |
| ORD-26-00340 smoke 11:54       | тот же тип оффера                                                                                  | ❌ `NULL`                          | Пропала                          |


**Корень проблемы.** `public-rr-installment-initiate` резолвит стадию через `resolveOfferRoutingWithFallback(offer_id, tariff_id)`. Резолвер положительный ТОЛЬКО когда в `tariff_offers.meta.crm_routing.enabled = true` и заполнены `pipeline_id / stage_on_pending / stage_on_success / stage_on_failed`. Для `offer_type='bank_installment'` эта настройка заполнена всего на 2 офферах из 8:

- ✅ `77dd831a` «Рассрочка от банка» — Бухгалтер (20 поток)
- ✅ `fc127066` «Рассрочка от банка (копия)» — Бухгалтер (20 поток) — is_active=false
- ❌ остальные 6 (все продающие кнопки на актуальном лендинге ЦБ 2.0) — без `crm_routing` → `pipeline_id=NULL`, `pipeline_stage_id=NULL`

`useDealsBoard` фильтрует по `pipeline_id = pipelineId` → сделка не отображается вовсе. Именно это описал пользователь: «человек оставил заявку, я не знаю, в CRM ничего нет».

Дополнительно fallback по `tariff_id` (`resolveOfferRoutingWithFallback`) ищет только `offer_type='pay_now'` с включённым routing — bank_installment туда не попадают, поэтому fallback тоже пустой.

Продукт-→воронка биндинг существует (`crm_pipeline_product_bindings`: `7101ed3c` ЦБ 20 поток → воронка `a0000001-…0002`), но в резолвере он не используется.

---

## План исправления

### 1. Product-binding fallback в CRM routing (add-only)

В `supabase/functions/_shared/crm-routing.ts` добавить экспорт `resolveRoutingByProductFallback(sb, product_id)`:

- ищет `crm_pipeline_product_bindings` по `product_id` (1 запись — 1 воронка);
- берёт стадии воронки: `stage_on_pending` = стадия с `name ~* '^заявка'` (иначе `is_default=true`, иначе минимальный `order_index` с `stage_type='open'`); `stage_on_success` = первая `stage_type='closed_won'`; `stage_on_failed` = первая `stage_type='closed_lost'`;
- если ок → возвращает `ResolvedRouting.ok=true` со `snapshot.resolved_via='product_binding_fallback'`.

Пометить как **compatibility_layer** — этот резолвер отключаем, когда все кнопки получат явный `crm_routing`.

### 2. Подключить fallback в `public-rr-installment-initiate/index.ts`

Порядок резолва при инициации:

```
resolveOfferRoutingWithFallback(offer_id, tariff_id)
   → ok=false → resolveRoutingByProductFallback(product_id)
      → ok=false → buildNegativeSnapshot()
```

`crmRoutingOk = true` уже в fallback-ветке → `_pipeline_id` и `_pipeline_stage_id` попадают в INSERT.

Логировать в `audit_logs` шаг `rr.create_order.routing_fallback_used` c `product_id`, `pipeline_id`, `stage_id`, `stage_name` — для прозрачности.

### 3. Единый резолвер и для чекаут-потоков (согласованность)

Те же две строчки добавить в `_shared/create-payment-checkout.ts` (one-time + subscription) и `_shared/create-stripe-checkout.ts` — чтобы поведение кнопок не расходилось. Это чисто add-only обёртка после существующего `resolveOfferRoutingWithFallback`.

### 4. Backfill потерянных сделок

INSERT-миграцией (data-only) через `insert`-tool:

```sql
UPDATE orders_v2
   SET pipeline_id = <из crm_pipeline_product_bindings по product_id>,
       pipeline_stage_id = <по правилам из п.1>
 WHERE pipeline_id IS NULL
   AND meta ? 'rr'
   AND created_at > now() - interval '30 days';
```

Отдельно для ORD-26-00341 (Сергей Федорчук, `7500084@gmail.com`) — воронка `a0000001-…0002`, стадия «Заявка на кредит» (`8c8ca380-cc65-4863-8e04-01d9dd357306`).

### 5. Верификация (в режиме симуляции)

1. Дёрнуть `public-rr-installment-initiate` для каждой активной bank_installment-кнопки продукта ЦБ 2.0 (3 тарифа × 1 оффер) — синтетическими контактами `sim-…@test.local`.
2. Проверить `orders_v2` за последние 5 минут: `pipeline_id`, `pipeline_stage_id`, `meta.crm_routing_snapshot.resolved_via`. Ожидание: у всех 3-х заказов → воронка «ЦБ | 1 ступень» / стадия «Заявка на кредит».
3. Открыть kanban `AdminDealsBoard` в этой воронке → все 3 карточки видимы в нужной стадии, плюс ORD-26-00341.
4. Cleanup: пометить симуляционные заказы `status='canceled'` (как раньше).

### DoD

- Резолвер routing использует product-binding, когда в оффере не задан `crm_routing`.
- Три активные bank_installment-кнопки продукта ЦБ 2.0 создают сделки со стадией «Заявка на кредит».
- ORD-26-00341 и остальные NULL-заказы за 30 дней с `meta.rr` видны на канбане.
- `audit_logs` содержит запись `rr.create_order.routing_fallback_used` для каждого fallback-случая.
- Скрин канбана с симуляционными заказами приложен в ответе.