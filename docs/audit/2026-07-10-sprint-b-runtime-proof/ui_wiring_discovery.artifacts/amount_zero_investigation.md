# Amount = 0 для bank_installment офферов `gl_buh` и `biz-l`

## Наблюдение

Discovery-запрос по `tariff_offers` продукта `7101ed3c-7839-4a74-ad95-aa0660369b22` показал (`offer_bindings.md`):

| tariff_key | bank_installment offer_id | amount (DB) |
|---|---|---|
| `buh`    | `15ce91ec-…` | 1650.00 |
| `gl_buh` | `2a07af43-…` | 0.00 |
| `biz-l`  | `4f64def7-…` | 0.00 |

Для двух из трёх офферов сумма в БД `0.00`.

## Возможные причины

1. **Черновые офферы.** `bank_installment` для `gl_buh` и `biz-l` создавались как placeholder-строки под будущую разметку и не заполнялись `amount`, потому что до Gate B этот flow не использовался в проде.
2. **Расчёт `amount` на стороне edge.** `public-rr-installment-initiate` может брать сумму не из `tariff_offers.amount`, а из другого поля (`tariffs`, `products_v2`, `tariff_offers.meta`, price-lists) или считать динамически. В таком случае `amount=0` — легитимный маркер «сумма извне».
3. **Историческая миграция.** При переносе с legacy-структуры цены могли попасть только в `payment`-офферы, а bank_installment получил `0` по default.
4. **Отдельный `pricing_stages`/график платежей.** Для рассрочки итоговая сумма может собираться из графика, а `amount` оставлен `0` намеренно, чтобы не путать оператора.
5. **Разметка Tilda как источник истины.** Отображаемые `1490`/`1690` — hardcoded внутри Tilda-HTML; возможно, эти же значения должны попадать в `amount` через отдельный sync, который ещё не написан.

## Что именно будет проверено в Gate B (без изменения данных)

- read-only чтение исходников edge `public-rr-installment-initiate` и `_shared/rr/rr-adapter.ts`: как формируется тело запроса к РР, откуда берётся `amount`, есть ли fallback при `amount=0`.
- read-only чтение `tariff_offers.meta`, `tariffs`, `products_v2` для трёх целевых `offer_id`: наличие альтернативных ценовых полей.
- read-only проверка, есть ли отдельная таблица графиков платежей (`pricing_stages`, `installment_schedules` и т. п.) с ненулевыми суммами для этих офферов.
- ретро-запрос в `orders_v2` по этим `offer_id` и `provider='rr'`: какие суммы фактически уходили в РР ранее (если такие заказы вообще были).
- read-only проверка edge-логов: последний успешный `createOrder` для этих `offer_id` и значение `amount` в payload.

Все проверки — только `SELECT`/чтение файлов. Никаких `UPDATE` `tariff_offers`.

## Почему это не блокирует текущий discovery

- Задача текущего шага — доказать, что renderer поддерживает action и что три CTA действительно размечены. Оба пункта подтверждены (см. `event_chain_proof.md`, `offer_bindings.md`).
- `amount=0` не мешает classifier / state machine работать корректно; edge либо примет payload, либо вернёт бизнес-ошибку — что и будет проверено в Gate B suite.
- Исправление `amount` (если оно потребуется) — data-only правка `tariff_offers` или изменение источника цены в edge. В любом случае — за пределами discovery.

## Явный блокер Gate B

Прежде чем можно объявить Gate B RUNTIME PASS, требуется доказательство одного из:
- (a) `amount` для всех трёх офферов формируется корректно (документированный источник и живой пример payload), либо
- (b) `amount=0` — намеренное значение, edge вычисляет сумму иначе, есть тестовый заказ с корректной суммой в РР.

До этого — Gate B остаётся BLOCKED даже при готовой preview environment.
