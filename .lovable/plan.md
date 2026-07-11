да, согласен, с учетом правок:

План в целом правильный, но перед реализацией нужно исправить несколько критичных моментов. Иначе возможна ситуация: заказ уже `paid`, платёж создан, а доступ не выдан и повторный reconciler больше ничего не делает.

## **1. Promotion нельзя реализовывать как транзакцию внутри TypeScript**

`_shared/rr/rr-promote-order.ts` не может удерживать одну транзакцию PostgreSQL между:

- `SELECT ... FOR UPDATE`;
- обновлением `orders_v2`;
- вставкой `payments_v2`;
- записью `provider_events`.

Каждый Supabase-запрос из edge — отдельная транзакция.

Нужно создать один атомарный RPC, например:

```text
rr_promote_authorized_order(...)
```

Внутри одной SQL-транзакции он должен:

1. заблокировать заказ `FOR UPDATE`;
2. проверить provider/flow/state;
3. перевести заказ в `paid`;
4. создать одну строку `payments_v2`;
5. записать promotion-marker;
6. создать событие `rr_promoted`;
7. вернуть typed result:

```json
{
  "state": "promoted | already_promoted | ignored | manual_review | failed",
  "should_grant_access": true
}
```

`rr-promote-order.ts` остаётся orchestration-слоем, но не canonical writer.



## **2. Нельзя прекращать обработку только потому, что заказ уже**

`paid`

Сейчас план говорит:

```text
status='paid' → выйти already:true
```

Но возможен сценарий:

```text
заказ переведён в paid
→ payment создан
→ HTTP grant-access-for-order упал
```

При следующем webhook/reconciler заказ уже `paid`, и доступ больше никогда не будет выдан.

Нужен отдельный fulfillment-state, например:

```json
meta.rr.fulfillment = {
  "status": "pending | processing | completed | failed",
  "attempts": 0,
  "last_error": null,
  "completed_at": null
}
```

Правило:

- `paid + fulfillment != completed` → повторить `grant-access-for-order`;
- `paid + fulfillment=completed` → полный no-op;
- повторный вызов должен быть безопасным благодаря идемпотентности `grant-access-for-order`.

Таким образом, идемпотентность платежа и идемпотентность выдачи доступа проверяются отдельно.

## **3. Зафиксировать retry выдачи доступа**

Ошибка `grant-access-for-order` не должна теряться только в логах.

При ошибке:

- записать `fulfillment.status='failed'`;
- увеличить `attempts`;
- сохранить redacted `last_error`;
- создать `provider_events.event_type='rr_fulfillment_failed'`;
- reconciler должен повторять выдачу доступа для `paid`, но не fulfilled заказов.

При успехе:

```text
fulfillment.status='completed'
rr_fulfillment_completed
```

Webhook при этом всё равно отвечает РР `200`, чтобы провайдер не создавал бесконечные повторы.

## **4. Сверить фактические RR status names**

В текущем адаптере ранее использовались статусы вроде:

```text
authorized
authorized_all
authorized_partially
rejected
canceled
```

В плане указаны:

```text
partial_authorized
declined
error
```

До написания условий нужно взять **фактические значения**, которые реально присылает РР и которые уже используются в `rr-adapter.ts`.

Нельзя создавать второй словарь названий.

Нужна единая функция классификации:

```text
mapRRStatusToPromotionAction(rawStatus)
```

Возвращает:

```text
authorize
manual_review
fail
ignore
```

И применяется одинаково в webhook и reconciler.







## **5. Не помечать заказ**

`failed` **по любому** `error`

Разделить:

- бизнес-отказ провайдера — terminal failed;
- техническая ошибка webhook/status endpoint — состояние заказа не менять;
- неизвестный статус — audit + manual review;
- canceled/rejected — только по подтверждённому контракту РР.

Технический `error` нельзя автоматически превращать в отказ клиента.

## **6. Проверить реальную схему таблиц до миграции**

Перед реализацией подтвердить существование и типы:

```text
orders_v2.status
orders_v2.paid_amount
orders_v2.paid_at
orders_v2.final_price
payments_v2.order_id
payments_v2.provider
payments_v2.provider_payment_id
payments_v2.amount
payments_v2.currency
payments_v2.status
```

Поле `reconcile_source` не добавлять предположительно. Если отдельной колонки нет, сохранять:

```text
meta.rr.promotion.source
```

То же касается `rr_order_id`: нельзя подставлять локальный `orders_v2.id` в поле, которое декларируется как provider ID, если РР не вернул отдельный ID.

## **7. Unique index — сначала discovery существующих данных**

Перед:

```sql
CREATE UNIQUE INDEX ...
```

обязательно проверить, нет ли уже нескольких RR payments на один order.

Если есть — миграция упадёт или потребует отдельного repair.

Также `ON CONFLICT` должен точно соответствовать partial index. Надёжнее использовать:

```text
idempotency_key = 'rr:payment:<order_id>'
```

с существующим уникальным контрактом, либо отдельный RPC с обработкой `unique_violation`.





## **8.**

`grant-access-for-order` **не считать provider-agnostic без проверки**

Перед вызовом подтвердить, что функция:

- принимает RR order;
- не требует `payments_v2.provider='bepaid'` или `stripe`;
- правильно понимает `bank_installment`;
- использует `orders_v2.product_id/tariff_id/offer_id`;
- не требует subscription/payment fields, которых нет у RR;
- не отправляет неправильные чеки или письма;
- корректно работает для разовой покупки и подписки.

Если внутри есть provider-specific guards, нужен минимальный add-only RR branch.

## **9. Подтвердить универсальность для любого продукта**

Это обязательное дополнение пользователя.

В backend запрещены hardcode:

```text
/cb
buh
gl_buh
biz-l
конкретные product_id
конкретные tariff_id
конкретные offer_id
1650 / 1950 / 2650
```

Canonical flow должен получать всё из заказа:

```text
orders_v2.offer_id
→ tariff_offers
→ tariff
→ product
→ amount/final_price/currency
→ grant-access-for-order
```

Критерии универсальности:

1. Для любого продукта можно создать `tariff_offer` с:

```text
offer_type='bank_installment'
meta.bank_installment.rr_runtime.enabled=true
provider='rr'
```

2. В конструкторе кнопки можно выбрать действие «Рассрочка банка» и конкретный оффер либо тариф.
3. Frontend передаёт UUID `tariff_offer_id`.
4. Backend не знает slug страницы, название тарифа и HTML-key.
5. Цена берётся из выбранного оффера/созданного заказа, а не из текста кнопки или Tilda HTML.
6. Выдача доступа определяется продуктом и тарифом заказа, а не страницей `cb`.

Добавить статическую проверку по репозиторию: в новых backend-файлах отсутствуют ID и названия трёх текущих тарифов.

## **10. Добавить generic acceptance test**

Кроме трёх тарифов `cb`, нужен хотя бы один proof универсальности без реальной покупки:

- создать или найти другой тестовый продукт/оффер в безопасной среде;
- сформировать вызов initiation с его `tariff_offer_id`;
- доказать, что backend резолвит его без изменений кода.

Если безопасно создать второй продукт невозможно, достаточно на текущем этапе:

- unit/static test с другим произвольным UUID fixture;
- доказательство отсутствия hardcode;
- проверка общего resolver.

Но перед объявлением всей RR-интеграции универсальной желательно пройти реальный сценарий на другом продукте в будущем.

## **11. Осторожно с шестью выдачами доступа**

План предлагает:

- создать три новые заявки;
- затем backfill трёх старых `ORD-26-00296/297/298`.

Это потенциально выдаст одному пользователю шесть наборов эффектов:

- entitlements;
- subscriptions;
- Telegram;
- email;
- CRM.

Сначала выполнить controlled reconcile **только одного** старого заказа и проверить:

- какой доступ выдан;
- не создана ли лишняя подписка;
- не продлён ли существующий доступ неожиданно;
- какие уведомления отправлены.

После успешного результата отдельно разрешить остальные два backfill.

Три новые реальные заявки также не создавать автоматически. Сначала один тариф, затем остальные после проверки.





## **12. Не включать**

`declined/error` **write-path одновременно с authorized без необходимости**

Sprint C лучше разбить функционально:

### **C1 — authorized promotion**

```text
authorized
→ paid
→ payment
→ grant access
```

### **C2 — manual/negative statuses**

```text
partial/rejected/canceled/unknown
→ manual review или controlled failure
```

Для завершения основного бизнес-сценария критичен C1. Отрицательные статусы не должны задерживать запуск, но должны быть fail-closed и не выдавать доступ.

## **13. Обновлённый минимальный runtime-порядок**

1. Реализовать atomic promotion RPC.
2. Реализовать fulfillment retry state.
3. Подключить webhook и reconciler.
4. Type-check/build.
5. Controlled reconcile одного существующего заказа.
6. Проверить:
  - `orders_v2.status=paid`;
  - ровно один `payments_v2`;
  - нужный entitlement/subscription;
  - корректные Telegram/email/CRM effects;
  - `fulfillment=completed`.
7. Повторить webhook/reconcile и подтвердить отсутствие дублей.
8. После PASS проверить остальные два тарифа.
9. Отдельно принять решение по backfill оставшихся старых заказов.

## **Итог**

План можно запускать после внесения этих изменений.

Ключевые обязательные правки:

- promotion-state сохраняется атомарным SQL RPC;
- выдача доступа имеет отдельный retryable fulfillment-state;
- `paid` не означает автоматически, что доступ уже выдан;
- используются реальные RR status names;
- никаких hardcode страницы `cb` и трёх тарифов;
- вся логика строится через `offer_id → tariff → product`;
- тестирование начинать с одного controlled заказа, а не сразу с шести.

Статус до физической проверки:

```text
Sprint C: IMPLEMENTED, NOT VERIFIED
```

Sprint C получает PASS только после подтверждения и платежа, и фактической выдачи доступа без дублей.

&nbsp;

План: Sprint C — write-path после RR `authorized`

## Цель

Замкнуть цикл заказа РР: `authorized` → `orders_v2.status=paid` → `payments_v2` → `grant-access-for-order` → доступы/подписки/Telegram/email/CRM. Строго идемпотентно.

Границы:

- никаких изменений в UI на `gorbova.by/cb` — работа только в edge + БД;
- никаких изменений в `public-rr-installment-initiate` (Sprint B): контракт создания заявки не трогаем;
- дизайн сайта не ломаем.

## Инварианты (жёсткие)

1. Повторный webhook с тем же `external_id` + `newStatus` + `sign_hash_short` — обрабатывается идемпотентно (уже реализовано в Sprint B, сохраняем).
2. Повторный вход в write-path на уже `paid` заказе:
  - НЕ создаёт вторую строку `payments_v2` (guard по `orders_v2.id` + `provider='rr'`);
  - НЕ вызывает `grant-access-for-order` повторно, если `orders_v2.status='paid'` — используем ту же защиту, что у bepaid-webhook (`orderV2.status !== 'paid'`).
  - Если `grant-access-for-order` всё же вызвана — она сама режет повтор через `skip_already_fulfilled` / `provider_linked_extend` (существующая логика).
3. Продвижение `status → paid` разрешено ТОЛЬКО из терминальных статусов РР (`authorized` для полного, `partial_authorized` — если продукт это допускает; пока считаем только `authorized` как paid, `partial_authorized` кладём в manual_review, `declined/error` → `failed`).
4. Никаких срезов доступа из webhook напрямую — только через `grant-access-for-order` (canonical write-path).

## Архитектура

Общая функция промоушена: `_shared/rr/rr-promote-order.ts` — вызывается из двух точек входа:

- `rr-webhook` — при `newStatus=authorized` перестаёт быть inert и вызывает promote;
- `rr-reconcile-order` — уже read-only; после Sprint C сам решает, звать promote или нет, на основе последнего known РР-статуса.

Обе точки входа сериализуются через SELECT ... FOR UPDATE на `orders_v2.id`, чтобы гонка webhook↔reconciler не создала двойного эффекта.

## Шаги promote (атомарно, в одной транзакции где возможно)

```
INPUT: orderId (uuid), rr_status (authorized|partial_authorized|declined|error), source ('webhook'|'reconciler'), sign_hash_short
```

1. Загрузить `orders_v2` FOR UPDATE + проверить `provider='rr'` и `meta.rr.flow='rr_installment'`.
2. Если `status='paid'` → выйти с `{ ok:true, already:true }` (это и есть anti-duplicate).
3. Если `rr_status` не терминальный → выйти `{ ok:true, ignored:true }`.
4. Для `authorized`:
  - `UPDATE orders_v2 SET status='paid', paid_amount=final_price, paid_at=now(), reconcile_source=source WHERE id=orderId AND status<>'paid'` (RETURNING count → 0 значит гонка проиграна, выходим).
  - `INSERT INTO payments_v2 (order_id, provider='rr', status='succeeded', amount, currency, provider_payment_id=rr_order_id, meta={ sign_hash_short, source }) ON CONFLICT (order_id) WHERE provider='rr' DO NOTHING` — потребует partial-unique-индекс (миграция).
  - Аппенд в `orders_v2.meta.rr.promotion` = `{ at, source, sign_hash_short }`.
5. Для `partial_authorized` — `meta.rr.manual_review=true`, `status` не менять, доступы не выдавать, писать audit-запись; никаких side-effects.
6. Для `declined` / `error` — `orders_v2.status='failed'`, доступы не выдавать.
7. Вызов `grant-access-for-order` через HTTP fetch (service_role):
  - только для `authorized` и только если шаг 4 реально изменил строку;
  - body: `{ orderId, source: 'rr-webhook' | 'rr-reconciler' }`;
  - таймаут 15s, ошибка → non-fatal (лог + запись в `provider_events`), потому что webhook всё равно 200, а reconciler повторит.
8. Записать в `provider_events` (event_type='rr_promoted', payload — redacted).

## Миграция БД (одна)

- Partial unique index: `CREATE UNIQUE INDEX payments_v2_rr_one_per_order ON payments_v2 (order_id) WHERE provider='rr' AND status='succeeded';` — гарантирует один платёж РР на заказ.
- Опционально: CHECK/trigger на `orders_v2` запрещающий переход `paid → любой другой` для `provider='rr'` без manual override (защита от отката).
- GRANT-ы для новых RPC (если появятся); write-path работает под service_role — anon/authenticated к нему не имеют доступа.

## Edge functions — правки

1. `supabase/functions/_shared/rr/rr-promote-order.ts` — новый (единственный writer).
2. `supabase/functions/rr-webhook/index.ts` — снимаем «inert» ограничение только для `authorized/declined/error`, вызываем promote. Docblock переписать.
3. `supabase/functions/rr-reconcile-order/index.ts` — расширить: если последний известный статус РР `authorized`, а `orders_v2.status != 'paid'` — звать promote. Остаётся admin-only.
4. `bepaid-webhook` — не трогаем.
5. `grant-access-for-order` — не трогаем (уже принимает orderId, provider-agnostic).

## Тесты (обязательно перед PASS)

Локально (Deno type-check + unit) + runtime в production под контролем:

- T1: одиночный webhook `authorized` на свежий заказ → `status=paid`, `payments_v2` 1 строка, `entitlements`/`subscriptions_v2` выданы, Telegram invite отправлен если применимо.
- T2: повторный webhook той же подписью → 200 идемпотентный, никаких новых строк, `grant-access-for-order` не звана.
- T3: webhook + reconciler одновременно → ровно один переход `paid`, одна `payments_v2`.
- T4: reconciler на заказе где webhook уже отработал → no-op.
- T5: `partial_authorized` → manual_review, доступы НЕ выданы.
- T6: `declined` → `status=failed`.
- T7: RR request_signature invalid → 401, никаких эффектов (как в Sprint B).

Runtime-проверка теми же 3 тарифами (buh/gl_buh/biz-l) с новым email, чтобы не пересечься с уже выданными в Sprint B заказами. После проверки — короткий отчёт по факту 3-х выданных подписок/доступов + отсутствие дублей.

## Что делаем с уже созданными в Sprint B заказами

`ORD-26-00296 / 00297 / 00298` (Сергей Федорчук, [7500084@gmail.com](mailto:7500084@gmail.com)) — сейчас `pending`, но РР уже `authorized`. После деплоя Sprint C делаем один controlled reconcile-run по этим трём order_id вручную (админ-инструмент `rr-reconcile-order` уже есть). Это единственный backfill в Sprint C и он ограничен списком из 3 конкретных id.

## Deliverables

1. Миграция БД (partial-unique-index + опциональный trigger).
2. `_shared/rr/rr-promote-order.ts`.
3. Правка `rr-webhook` (снятие inert для терминальных статусов).
4. Правка `rr-reconcile-order` (write-режим по флагу).
5. Deno type-check + build проходят.
6. Ручной runtime-тест на 3 новых тарифных заявках + backfill 3 старых.
7. Короткий отчёт (5 пунктов, как в правилах отчётности).

## Порядок работы (стандартный)

1. Discover (уже сделано выше — контракты `bepaid-webhook` и `grant-access-for-order` разобраны).
2. Миграция → approve → apply.
3. Deploy `_shared/rr/rr-promote-order.ts` + правки двух edge.
4. Type-check.
5. Runtime-тест на новых 3 заявках.
6. Controlled backfill 3 существующих.
7. Отчёт.

Sprint C статус до ручной верификации: **IMPLEMENTED, NOT VERIFIED**.
После успешного теста: **VERIFIED, PASS**.