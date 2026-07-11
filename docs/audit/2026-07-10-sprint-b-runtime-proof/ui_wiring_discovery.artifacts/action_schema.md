# Фактическая schema action `open-bank-installment`

Источник: `src/pages/SitePageBySlug.tsx` (см. `renderers.md`) + `src/components/shared/HtmlIframePreview.tsx` (bridge).

## Как action попадает наружу

HTML внутри iframe:

```html
<a class="tn-atom"
   href="#"
   data-lovable-action="open-bank-installment"
   data-tariff-key="buh">
  ...
</a>
```

`HtmlIframePreview` перехватывает клик, собирает `payload` из всех `data-*` атрибутов (кроме самого `data-lovable-action`), postMessage'ит наверх; `SitePageBySlug` слушает `lovable:site-action`.

## Обязательные поля payload

| Поле | Тип | Обязательно | Источник |
|---|---|---|---|
| `action` | string enum, см. `ALLOWED_ACTIONS` | да | `data-lovable-action` |
| `tariff_key` | string enum `buh|gl_buh|biz-l` | да | `data-tariff-key` |

## Что НЕ является частью schema

- `data-offer-id`, `data-product-id` — не читаются для `open-bank-installment`. UUID в HTML для этого action не требуется.
- `data-amount`, `data-price` — не читаются. Сумма приходит из `tariff_offers.amount` (см. offer_bindings.md).

## Что renderer уже поддерживает

Ветка `open-bank-installment → bank_installment` уже реализована в `SitePageBySlug`. Отдельного patch React-кода для запуска нового заказа РР **не требуется**: цепочка `HTML → CustomEvent → SitePageBySlug → pickOfferForFlow('bank_installment') → PaymentDialog` уже собрана.

Что нужно проверить в Gate B (после Gate A PASS):
1. `PaymentDialog` для `bank_installment` действительно вызывает `public-rr-installment-initiate` (а не устаревший endpoint).
2. Ошибки (`rr_call_in_flight`, `rr_reconciliation_pending`, `local_state_unconfirmed`) корректно отображаются в UI на русском.
3. Данные `email_norm`/`phone_norm`/`user_id` собираются из формы и передаются без утечки в клиентскую консоль.

## Data-only vs React patch

Discovery подтверждает: **renderer уже принимает нужный action**. Значит на этапе Gate B не требуется data-only patch `site_pages.blocks` (все три CTA уже размечены `data-lovable-action="open-bank-installment"`), но требуется проверить wiring `PaymentDialog → public-rr-installment-initiate` в отдельном подшаге Gate B.
