---
name: Auto-Renewals Cohort SOT
description: SOT for recurring-product cohort, auto-renewals dashboard membership, and one-time exclusion
type: feature
---
SOT когорты автопродлений = `tariff_offers.meta.recurring.is_recurring=true` на активном offer тарифа продукта.

- Recurring-продукты попадают в таблицу автопродлений независимо от наличия карты/локального токена.
- One-time продукты не попадают в таблицу автопродлений; для них допустимы только уведомления об окончании доступа.
- `requires_card_tokenization`, наличие payment_method/payment_token, `auto_renew` и текстовые категории продукта не являются классификаторами типа продукта.
- Метрика «К списанию сегодня» должна включать весь сегодняшний план: уже успешно списанные сегодня + оставшиеся к списанию сегодня.
- Давно просроченные неchargeable записи без provider-managed подписки, карты и токена не должны отображаться как актуальные автосписания.
- Лейбл «MIT» в UI запрещён; использовать «Локальная карта» или «Без карты».