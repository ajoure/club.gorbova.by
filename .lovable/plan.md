# P0 — Единый канонический payment flow + UX

## Статус

| PATCH | Статус |
|-------|--------|
| P0 — hotfix оплаты (все сайты) | DEPLOYED — pending runtime-proof |
| P0.1 — saved card UI | FIXED (misleading UI removed) |
| P2 — клиентские ошибки | FIXED |
| F2 — auth persistence | PARTIAL / NOT CLOSED |

## Что сделано

### 1. `bepaid-create-token` — one-time ветка переведена на canonical owner-flow

- Inline checkout логика (legacy `orders`, ручной payload, double `Basic` header) **удалена**
- Вместо неё — вызов `createPaymentCheckout()` из `_shared/create-payment-checkout.ts`
- Теперь: `orders_v2`, tracking `link:order:{UUID}`, `purchase_snapshot`, dedup, audit — всё через canonical path
- Тот же backend owner-flow, что и ссылка оплаты из карточки контакта

### 2. MIT ветка — fix auth header

- Строка 805: `'Authorization': bepaidAuth` (было `` `Basic ${bepaidAuth}` `` = double prefix)

### 3. PaymentDialog — убран misleading saved card UI

- Блок «Оплата сохранённой картой» убран для **всех** типов продуктов
- Единый текст: «После нажатия кнопки вы будете перенаправлены на защищённую страницу оплаты bePaid»
- Обоснование: client flow всегда идёт через bePaid checkout с 3DS, saved card не используется

## Файлы

| Файл | Изменение |
|------|-----------|
| `supabase/functions/bepaid-create-token/index.ts` | import + one-time → `createPaymentCheckout()`, MIT auth fix |
| `src/components/payment/PaymentDialog.tsx` | Убран misleading saved card block |

## DoD — pending proof

- [ ] Консультация (one-time) — redirect на bePaid работает
- [ ] Клуб (subscription) — не сломан (anti-regression)
- [ ] Заказ создаётся в `orders_v2` (не legacy `orders`)
- [ ] Tracking `link:order:{UUID}` — webhook обрабатывает
- [ ] При ошибке модалка не закрывается
- [ ] Raw ошибки не показываются пользователю

## FROZEN

Auth.tsx, `_shared/create-payment-checkout.ts`, `admin-create-payment-link`, `bepaid-webhook`, `bepaid-create-subscription-checkout` — не изменены.
