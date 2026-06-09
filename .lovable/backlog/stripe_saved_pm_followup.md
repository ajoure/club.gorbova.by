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

## PATCH-LIVE-1 follow-up (Saved Cards × Stripe Live, 2026-06-09)

После снятия live-guard `stripe_account_not_test_mode` оплата новой картой через live Stripe должна проходить. Отдельно остаётся вопрос совместимости сохранённых карт на `/pay/:token`:

- определить источник saved card (Stripe `payment_method` vs legacy bePaid token / `card_profile_links`);
- если карта не Stripe-compatible — не показывать её как доступную для Stripe live, либо рендерить disabled с пояснением «Сохранённая карта недоступна для оплаты через Stripe, используйте новую карту»;
- если карта Stripe-compatible — разрешить оплату и корректно отрабатывать 3DS/SCA;
- добавить provider badge у сохранённой карты в UI оплаты;
- никогда не передавать bePaid token в Stripe checkout и наоборот.

Это **не блокирует** L-4 PASS: первый live-платёж проводится новой картой.

