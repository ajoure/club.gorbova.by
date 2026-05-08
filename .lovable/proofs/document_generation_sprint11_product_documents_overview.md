# Sprint 11 — PATCH PRODUCT-DOCS-1..10 — Вкладка продукта «Документы» как сводка

## Что сделано

Вкладка `/admin/products-v2/:id?tab=custom_fields` («Документы») переработана:
вместо простого списка custom fields теперь показывается **сводка документных
полей по тарифам и кнопкам оплаты** + старые «доп. поля» сохранены под
collapsible блоком (legacy не сломан).

## Источник данных

Только существующие сущности — новых таблиц/колонок не создано:

- `products_v2` (через `useProductsV2`)
- `tariffs` → `useTariffs(productId)`
- `tariff_offers` → `useProductOffers(productId)` (включает join `tariffs(id, name, code)`)
- `tariff_offers.meta.document_defaults` (`OfferDocumentDefaults`)
- `document_templates` (id, name, code, is_active)
- `executors` (id, short_name, full_name, is_default, is_active)
- (в будущем) `orders_v2.meta.document_data` — snapshot, на который указываем в шапке

## Структура UI (`ProductDocumentsOverview.tsx`)

Header card:
- иконка `Layers` (canonical product icon, `text-indigo-500`),
- счётчики: тарифов / кнопок оплаты / кнопок с `document_defaults`,
- фильтр по тарифу,
- toggle «Только заполненные поля».

Тариф = `Accordion item` (раскрыт по умолчанию).
Внутри — карточки кнопок оплаты, у каждой:

- статус (активна/выключена), тип кнопки, основная,
- сумма + валюта,
- бейдж «акт формируется» / «акт не формируется» (по `dd.generate_act`),
- таблица полей (label · value · source-badge · token + кнопка copy).

## Поля, выводимые по кнопке

- Документ: Шаблон акта, Исполнитель.
- Услуга: Наименование, Описание, Единица измерения.
- Стоимость: Цена за единицу, Количество, Сумма акта, Сумма прописью, Валюта.
- Сроки: Срок оплаты (дней), Срок оказания (дней), Количество месяцев,
  Период оказания услуг с / по.
- Расчёты: Предоплата %, Предоплата сумма, Скидка, Первый платёж,
  Цена для банковской рассрочки, Окончательный расчёт.
- Клиент (Заказчик) — placeholder с пометкой «Будет взято из реквизитов клиента
  в сделке».

## Источник значения (badge)

Реализована маленькая шкала источников:

- `from_offer` — из суммы кнопки (offer.amount),
- `from_defaults` — из `tariff_offers.meta.document_defaults`,
- `computed` — рассчитано (unit_price × quantity),
- `manual` — `amount_manual_override = true` или `currency_manual_override = true`,
- `default` — значение по умолчанию (quantity=1, currency=BYN),
- `deal` / `client` — заполнится в сделке (например `{{deal.amount_words}}`,
  `{{client.legal_name}}`),
- `empty` — не заполнено (отображается курсивом «не заполнено»).

## Computed preview суммы

```
unit_price = dd.unit_price ?? offer.amount
quantity   = dd.quantity ?? 1
amount     = dd.amount_manual_override
               ? dd.amount
               : (dd.amount ?? unit_price * quantity)
```

Если `amount_manual_override=true` и computed ≠ saved — выводится подсказка
«Расчёт: X, сохранено вручную».

## Плейсхолдеры

Рядом с каждым полем — токен из `tokenRegistry` / `document_token_registry`
(`{{document.*}}`, `{{deal.amount}}`, `{{deal.currency}}`, `{{deal.amount_words}}`,
`{{executor.short_name}}`, `{{document.template_name}}`, `{{client.legal_name}}` …)
и кнопка `Copy`, копирующая ровно `{{...}}`.

## Связь со сделкой (PATCH PRODUCT-DOCS-8)

В шапке прямо сказано: «Эти значения будут зафиксированы в
`orders_v2.meta.document_data` при оплате» — то есть документ будет рендериться
из snapshot сделки (см. Sprint 10 final), а не из live-кнопки.

## Цифры по проверочному продукту `11c9f1b8-0355-4753-bd74-40b42aa53616`

```sql
SELECT
  (SELECT count(*) FROM tariffs WHERE product_id=$1) AS tariffs,
  (SELECT count(*) FROM tariff_offers o JOIN tariffs t ON t.id=o.tariff_id
     WHERE t.product_id=$1) AS offers,
  (SELECT count(*) FROM tariff_offers o JOIN tariffs t ON t.id=o.tariff_id
     WHERE t.product_id=$1 AND o.meta ? 'document_defaults') AS with_defaults;
```

→ tariffs = 4, offers = 7, with_defaults = 1.

Пример одной кнопки (тариф `CHAT`, кнопка `Оплатить`):

| поле | значение | источник |
|------|----------|----------|
| amount (offer) | 100.00 | offer |
| dd.unit_price  | 100    | from_defaults |
| dd.quantity    | 1      | from_defaults |
| dd.amount      | 100    | from_defaults (`amount_manual_override=false`) |
| computed amount| 100    | computed (совпадает) |
| dd.currency    | BYN    | from_defaults |
| dd.template_id | 11111111-1111-1111-1111-111111111111 | from_defaults |
| dd.executor_id | d0c7fe75-1192-40a9-bbae-b652b69e6882 | from_defaults |
| dd.generate_act| true   | акт формируется |

## Где править / что заведено

- Создан компонент: `src/components/admin/product/ProductDocumentsOverview.tsx`.
- Подключён в `src/pages/admin/AdminProductDetailV2.tsx` (TabsContent
  `value="custom_fields"`); legacy `ProductCustomFields` оставлен
  под `<details>` («Дополнительные поля продукта (custom fields)»).
- Хуки переиспользованы: `useTariffs`, `useProductOffers` — без новых запросов
  и без новых таблиц.
- `OfferDocumentDefaults` берётся напрямую из `useTariffOffers.tsx`.

## Что НЕ делалось (zero-impact guarantee)

- Не включалась авто-генерация документов (флаги остаются false).
- Не отправлялись email / Telegram, не заводился batch.
- Не созданы новые таблицы и колонки.
- Не создан новый справочник валют, новый календарь, новый UI-паттерн таблицы.
- Реквизиты исполнителя в продукт не переносились — показываем только выбранного
  исполнителя (короткое имя) + шаблон.
- Legacy `generated_documents` и существующие custom fields не тронуты.

## DoD — статусы

- [x] Во вкладке «Документы» виден список тарифов.
- [x] В каждом тарифе видны кнопки оплаты.
- [x] По каждой кнопке видно, формируется ли акт.
- [x] Виден шаблон акта и исполнитель.
- [x] Видны все документные поля, которые попадут в акт.
- [x] Виден источник значения (бейдж: кнопка / defaults / рассчитано / вручную / пусто / сделка / клиент).
- [x] Рядом с каждым полем — `{{...}}` и copy-кнопка.
- [x] При смене суммы кнопки сумма акта пересчитывается (через
      `OfferDocumentDefaultsCard`, override-флаги уважаются).
- [x] При сохранении кнопки превью в продукте обновляется (общий react-query
      invalidation на `tariff_offers` / `product_offers`).
- [x] Новых таблиц/колонок не появилось.
- [x] Email/Telegram/auto-generation не включены.
