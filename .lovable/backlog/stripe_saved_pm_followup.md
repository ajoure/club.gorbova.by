# Backlog: Stripe Saved PM — follow-up

**Контекст:** MP-A2-2 ввёл сохранение карты на `Customer` через `setup_future_usage='off_session'` в Stripe Checkout `mode=payment`. Карта сохраняется, но Stripe Checkout **не показывает picker сохранённых карт** при следующей покупке — пользователь снова вводит карту.

## Опции follow-up

### Вариант A — Customer Portal
- Кнопка «Управлять способами оплаты» в кабинете → редирект в Stripe-hosted Customer Portal.
- Pro: минимум кода, fully Stripe-hosted, PCI-compliant.
- Contra: отдельная страница, нет inline-выбора при checkout.

### Вариант B — Payment Element (Embedded)
- Заменить Stripe Checkout Session на Embedded Payment Element с `customer` + `payment_method_types=['card']` + `setup_future_usage`.
- Pro: inline picker сохранённых карт, лучший UX.
- Contra: требует UI-работу (React component), CSS, обработку `confirmCardPayment` в клиенте.

## Решение
Откладывается до пилота (Stage C). Зависит от UX-валидации: если в пилоте «Платная консультация» доля повторных покупок > X% — приоритет на Вариант B. Иначе — Вариант A.

## Out of scope MP-A2-2
Ни один из вариантов не реализуется в рамках MP-A2-2.
