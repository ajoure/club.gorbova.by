# Фактические bindings трёх офферов bank_installment страницы cb

Discovery-запрос: `SELECT t.id, t.name, o.id, o.offer_type, o.payment_method, o.amount, o.is_active FROM tariffs t LEFT JOIN tariff_offers o ON o.tariff_id = t.id WHERE t.product_id = '7101ed3c-7839-4a74-ad95-aa0660369b22'`.

Product: `7101ed3c-7839-4a74-ad95-aa0660369b22` (страница `cb`, `page.product_id`).

## Тарифы и bank_installment офферы

| tariff_key (в HTML) | tariff.name | tariff_id | bank_installment offer_id | is_active | amount (DB) |
|---|---|---|---|---|---|
| `buh` | Бухгалтер | `adbe94e8-171d-4b49-8338-66c554bb1f0b` | `15ce91ec-5dc1-4abf-9fab-9c97dc1e6b74` | true | 1650.00 |
| `gl_buh` | Главный бухгалтер | `543940b1-99da-47f3-accc-671ad5b11afe` | `2a07af43-710a-4f8c-8211-0eea6ae2cf27` | true | 0.00 |
| `biz-l` | Бизнес-леди | `9bc81736-e7e5-48db-9925-b866427a98e1` | `4f64def7-d465-47ef-b747-594a8829b0df` | true | 0.00 |

## Разметка в HTML страницы (grep)

Каждый из трёх CTA `Заявка на рассрочку` фактически размечен:

```html
<a class="tn-atom" href="#" data-lovable-action="open-bank-installment" data-tariff-key="buh">...</a>
<a class="tn-atom" href="#" data-lovable-action="open-bank-installment" data-tariff-key="gl_buh">...</a>
<a class="tn-atom" href="#" data-lovable-action="open-bank-installment" data-tariff-key="biz-l">...</a>
```

Дополнительно каждый тариф имеет CTA `Оплата в два платежа` (`data-lovable-action="open-installment"`) — вне scope Sprint B, трогать не будем.

## Discovery-flag: несоответствие сумм

- Цена, показываемая в Tilda-разметке: строка `1490` встречается 95 раз, `1690` — 1 раз.
- Цена в БД (`tariff_offers.amount` для `bank_installment`): `1650.00` (buh), `0.00` (gl_buh), `0.00` (biz-l).

Наблюдения:
1. `amount=0.00` для двух bank_installment офферов означает, что сумма заявки в РР не рассчитывается из `tariff_offers.amount` для gl_buh/biz-l. Требуется отдельно проверить, откуда edge берёт `amount` для `public-rr-installment-initiate` (провал этой проверки — блокер Gate B).
2. Отображаемые цены `1490/1690` не совпадают ни с одним `tariff_offers.amount` продукта — это hardcoded значения внутри Tilda HTML, не связанные с БД. Отдельная задача копирайта, вне Sprint B.

## Что не делаем в discovery-шаге

- Не изменяем `site_pages.blocks`.
- Не изменяем `tariff_offers`.
- Не изменяем React-компоненты.
- Не публикуем страницу.

## Вывод

Все три оффера страницы cb фактически привязаны через `data-tariff-key`. React-renderer уже поддерживает нужный action. Data-only patch блоков не требуется. Единственный открытый вопрос перед Gate B — источник `amount` для bank_installment и корректность подстановки в тело запроса РР (проверяется после Gate A PASS).
