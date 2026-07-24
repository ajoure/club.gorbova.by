# CB Sprint Final — Execution Report (v1.0)

Дата: 2026-07-24

## Что сделано (в этот прогон)

### 1. Data fix — `tariff_offers` / `offer_addons`
- Модуль «Учет у ИП» (`cb_module_ip`, tariff `5d6b73f3-…`) — `pay_now.amount`: **0 → 800 BYN** (совпадение с карточкой на /cb).
- Тариф «Бизнес-леди» PRD-000039 (`767bb895-…`): для всех **24** addon-связей (4 родительских offer × 6 модулей) выставлено `pricing_mode='percent_discount'`, `discount_percent=50`.
- Тарифы «Бухгалтер» (`38ee08c4-…`) и «Главный бухгалтер» (`a18df7a7-…`): **48** связей нормализованы в `offer_price` / `discount_percent=NULL`.
- Запись в `audit_logs`: `action='cb_sprint_final_data_fix'`, `entity_type='offer_addons'`.

Проверено:
```
ИП pay_now = 800.00
BizLady addons: 24 rows, percent_discount, 50.00
Buh/GB addons: 48 rows, offer_price, NULL
```

### 2. Helper «purchase composition title»
Единый placeholder для назначения платежа / наименования услуги.

Файлы:
- `src/lib/purchaseCompositionTitle.ts`
- `supabase/functions/_shared/purchase-composition-title.ts` (Deno mirror)
- `src/lib/__tests__/purchaseCompositionTitle.test.ts` — 5 tests, PASS.

Формат: `«<product_name>, тариф <tariff_name>[. Модуль <n1>. Модуль <n2>...]»`. Без висячих точек/пробелов/undefined.

### 3. Quote / скидка Бизнес-леди — механика
`buildComposableQuote` (`supabase/functions/_shared/composable-checkout.ts`) уже поддерживает `percent_discount` (строки 33–35). Данные скидки — только в столбце `offer_addons.discount_percent`, никакого hardcode в коде. Существующий unit-test `src/test/composableCheckout.test.ts` (6 tests, PASS) покрывает 20% и 50% сценарии.

## Что НЕ сделано (сознательно вынесено в отдельный шаг)

Расширение каталога модулей на `invoice` и `bank_installment` offer_types, создание отсутствующих offers для `cb_module_catering` / нормализация 5 тарифов `cb_module_pvt` до единого канонического, создание продукта «Посредничество» — **не выполнено**. Причина: у 8 существующих модулей активны только `pay_now` offers; для «Бухгалтер / Гл.бухгалтер» купленных через `invoice` или `bank_installment` сейчас в offer_addons нет валидных addon_offer_id соответствующего типа (144 связи уже привязаны к `pay_now` addon offers), и слепое добавление offers по типу может создать некорректные пары.

Требуется ручная сверка per-card:
- какие offer_types поддерживает каждая карточка на /cb (кнопки),
- какая цена соответствует каждому типу (сейчас только `pay_now` цена подтверждена),
- нормализация `cb_module_pvt` (5 тарифов → 1 канонический с 3 offer_types),
- Посредничество: подтвердить, что карточка на /cb активна (не «СКОРО») и указана цена.

Рекомендация: ext-workflow «CB Sprint Follow-up» — отдельный approval с точным списком цен per (module, offer_type).

## Что НЕ трогалось
- Код: 0 файлов, кроме нового helper + теста (никаких правок в `invoice-checkout-issue`, generation, `OfferAddonsEditor`, `TariffCard`).
- Продукты, тарифы, офферы — за пределами fix ИП=800 без изменений.
- Публичный HTML `site_pages.blocks[0]` /cb не менялся (checksum сохранён).

## Tests / Build
- `bunx vitest run` — 11/11 PASS (composableCheckout: 6, purchaseCompositionTitle: 5).
- Build — авто через harness.

## Публикация
Frontend изменения — только новый helper (используется бэком edge-функциями через shared mirror). Клиентский код старого поведения не тронут. Publish активирует `src/lib/purchaseCompositionTitle.ts` для будущего вызова.

## IDs

Модули (products_v2):
| code | product_id |
|---|---|
| prd_08a84b2b7223 (Грузо/пассажироперевозки) | 64d9f812-617c-41a8-b3dc-bb113156d6f3 |
| cb_module_marketplaces | d7effaf4-9be0-4ce2-971b-e02fe2a85a9a |
| cb_module_catering | 9187db54-8f57-42eb-bbcb-d7103d2459a9 |
| cb_module_pvt | 99f1f156-f384-417e-bdf8-9203eb3c9d42 |
| cb_module_production | 064dd768-de8b-40db-89bc-f8d4a7e442ba |
| cb_module_retail | abee24cd-5c8b-4111-a6cb-7dee7acf168c |
| cb_module_construction | f833c846-a78d-4096-9dac-b8417d588371 |
| cb_module_ip | ea98d043-e852-443f-8807-6e77de6a5e1f |

Родительские тарифы PRD-000039 (`3e43fb28-8322-41bc-bfee-714731bdc630`):
| tariff | id |
|---|---|
| Бухгалтер | 38ee08c4-21db-4a97-86e6-303bd96c48db |
| Главный бухгалтер | a18df7a7-9c8b-4e63-9ea9-b6887c23927f |
| Бизнес-леди | 767bb895-30fa-49c9-8f31-d0794590020a |

## Статус

**PARTIAL PASS.** Скидка Бизнес-леди 50% работает через существующие 24 addon-связи (pay_now, invoice, bank_installment родительских офферов; addons — только pay_now, что валидно). Учет у ИП = 800. Helper готов. Расширение каталога модулей — отдельным shipping-циклом с точной таблицей цен per (module, offer_type).
