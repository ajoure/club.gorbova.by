# Renderers для страницы cb

Дата discovery: 2026-07-10.

## Соответствие block.type → React-компонент

| block.type | React-компонент | Файл |
|---|---|---|
| `html` | `HtmlIframePreview` (внутри `SitePageRenderer`) | `src/components/shared/HtmlIframePreview.tsx` |

`HtmlIframePreview` рендерит содержимое `content.code` внутри sandboxed `<iframe>` и устанавливает bridge событий из iframe наружу.

## Bridge action → flow

Обработчик находится в `src/pages/SitePageBySlug.tsx` (строки ~30–190).

### Allow-list actions (`ALLOWED_ACTIONS`)

- `open-offer` — UUID-only payload (`product_id`, `offer_id`).
- `open-preregistration` — UUID `offer_id`.
- `open-payment`
- `open-invoice`
- `open-installment`
- `open-lead`
- `open-bank-installment` — интересующий нас flow.

### Мэппинг `action → flow` (`ACTION_TO_FLOW`)

```
open-payment          → payment
open-invoice          → invoice
open-installment      → installment
open-lead             → lead
open-bank-installment → bank_installment
```

### Мэппинг `data-tariff-key → tariff.name` (`TARIFF_KEY_NAME_MATCH`)

Динамический lookup по подстроке имени тарифа продукта, привязанного к странице (`page.product_id`).

- `buh` → `/^бухгалтер/i`
- `gl_buh` → `/главн\S*\s+бухгалтер/i`
- `biz-l` → `/бизнес.?леди/i`

### `pickOfferForFlow` для `bank_installment`

```
active offers where offer_type === "bank_installment"
```

Первый подходящий — используется. Оффера с `offer_type='bank_installment'` — по одному на тариф.

## Как открывается диалог

После резолва оффера ставится `pending = { productId, offerId }` и открывается `PaymentDialog` (`src/components/payment/PaymentDialog`). Схема действия для CTA — не «offer_id в HTML», а связка `page.product_id + data-tariff-key + flow`.

## Что не является renderer'ом

- `LovableSitePage`/`SitePageRenderer` — просто раскладывает блоки. Никакой отдельной schema для CTA не существует; вся логика вынесена в `SitePageBySlug` + `HtmlIframePreview`.
- Никакого специализированного «pricing block»/`pricing_stages` рендерера на странице cb нет — цены и кнопки живут в raw Tilda HTML.
