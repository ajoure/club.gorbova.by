да, согласен, с учетом правок:

1. В audit добавить не только `old_tariff_id/new_tariff_id`, но и:
  - `order_id`
  - `product_id`
  - `active_subscription_id`
  - `active_subscription_access_end_at`
  - `new_access_start_at`
2. В коде явно зафиксировать правило:

```ts
canExtendExistingSub =
  activeSub.product_id === order.product_id &&
  activeSub.tariff_id === order.tariff_id
```

3. Если `activeSub.tariff_id IS NULL` — не extend, а safe fallback: создать новую подписку и записать audit `skip_extend_missing_tariff`.
4. В DoD добавить grep/code-proof: поиск active subscription больше не считается только по `product_id`.

Можно выполнять.

&nbsp;

План: исправить ошибочное продление чужого тарифа в `grant-access-for-order`

## Контекст и диагностика

Кейс Гузаревич (`irkaguzarevich@mail.ru`, продукт Gorbova Club):

- 07.04.26 куплен тариф FULL (`b276d8a5…`) → подписка `0bd8a9fc…`, access_end_at = 07.05.26.
- 28.04.26 куплен другой тариф — BUSINESS (`7c748940…`), order `603dd348…`, `payment_flow=renewal_one_time`.
- Webhook вызвал `grant-access-for-order` без `extendFromCurrent: false`.
- В функции (`supabase/functions/grant-access-for-order/index.ts`, строки 273-291) extend-логика ищет активную подписку **только по `product_id**`, без сравнения `tariff_id`. Нашла подписку FULL, продлила её от 07.05 на месяц → 07.06.26 и записала order `603dd348…` в `meta.extended_by_orders`.

Это нарушает текущие memory-правила:

- «Renewal exact match, no 1-month math» (entitlement-renewal-alignment) — продление допустимо только при совпадении тарифа.
- «Replace requires explicit cancel → supersede» (safe-replacement-flow) — смена тарифа должна идти отдельным путём, а не молчаливым extend.
- «Default-Deny» — extend сейчас работает «по умолчанию», что небезопасно.

## Цель

При оплате нового заказа на тот же продукт, но **другой тариф**, чем у уже активной подписки:

- НЕ продлевать существующую подписку,
- НЕ суммировать остаток дней,
- создать новую подписку на 30 дней (или `tariff.access_days`) от даты оплаты,
- старую активную подписку оставить как есть (отдельная запись со своим access_end_at) — её ручное закрытие/supersede остаётся прерогативой администратора.

Если же тариф **совпадает** с активной подпиской — поведение не меняется (это легитимное продление того же тарифа).

## Что меняем в коде

Файл: `supabase/functions/grant-access-for-order/index.ts`

1. В блоке поиска `activeSub` (строки 273-291) дополнительно сравнивать `tariff_id`:
  - если `activeSub.tariff_id` задан и не равен `order.tariff_id` → НЕ использовать его как базу extend, оставить `existingProductSub = null`, `accessStartAt = baseStartDate` (дата оплаты).
  - записать в логи и audit (`actor_type: 'system'`, action `grant-access-for-order.skip_extend_tariff_mismatch`) факт отказа от продления с указанием обоих tariff_id и subscription.id.
2. Логика для club-продукта (calendar month, строки 299-316) и entitlement merge (GREATEST) остаётся, но т.к. `existingProductSub = null`, новая подписка получит свой собственный access-window от даты оплаты.
3. Entitlement-merge (GREATEST) для одного `product_code` сохраняется — это правильно: пользователь не теряет доступ к продукту, пока активна старая подписка.

Вызовы `grant-access-for-order` из webhook и admin-функций НЕ меняем — поведение по `extendFromCurrent=true` по умолчанию остаётся, но теперь оно безопасно ограничено совпадением тарифа.

## Что НЕ трогаем

- `bepaid-webhook`, `admin-manual-charge`, `public-charge-saved-card` и прочие точки вызова.
- Логику calendar-month, entitlement GREATEST, idempotency guard.
- Поведение admin-операций (ручные продления администратора через свои edge functions проходят отдельным путём).
- Существующие подписки в БД (никаких миграций данных по кейсу Гузаревич — администратор поправит руками или отдельной задачей).

## Проверка (DoD)

- Новый заказ с tariff_id ≠ активной подписки → создаётся новая подписка с `access_start_at = order.created_at` (или now), `access_end_at = start + access_days` (или calendar-month), `extended_by_orders` старой подписки НЕ обновляется.
- Новый заказ с тем же tariff_id → продление работает по-старому (extend).
- В audit_logs появляется запись `grant-access-for-order.skip_extend_tariff_mismatch` с обоими tariff_id.
- Idempotency guard продолжает корректно отрабатывать для повторного webhook одного и того же order.

## Что обновим в memory

После выполнения добавить правило в `mem://commercial-logic/access/extend-tariff-match-required` и упомянуть в Core: «Extend существующей подписки в `grant-access-for-order` допустим ТОЛЬКО при совпадении `tariff_id`. Покупка другого тарифа того же продукта = новая подписка от даты оплаты, без суммирования остатка дней. Замена тарифа — только через explicit cancel → supersede администратором.»