Да, план правильный.

Важное уточнение к апруву:

- **one-time не трогать вообще**: без суммы, без CTA, без amount-resolver.
- Amount-resolver только для recurring/installment.
- Fallback на primary tariff_offer обязателен.
- Если сумма не найдена — это **не блокирует отправку**, но пишется reminders.amount_unresolved_critical.

Можно выполнять точечный патч только в subscription-renewal-reminders/index.ts.

&nbsp;

План: Исправить «Сумма списания» в напоминаниях о подписке (v4 — final)

## Что делает функция сегодня (перепроверено по коду)

`supabase/functions/subscription-renewal-reminders/index.ts` — единая cron-функция, шлёт напоминания за 7/3/1 день до конца доступа.

Она УЖЕ умеет различать тип продукта через `isOneTimeProduct(supabase, tariff_id, userId, productId)` (line 139), который под капотом ходит в SOT `resolveProductRenewability` поверх `tariff_offers` и возвращает флаги `is_recurring` / `has_installment` / `is_one_time`. Этот классификатор — общий, переиспользуем, ничего нового не создаём.

Существующие ветки шаблонов:

- `sendTelegramReminder` / `sendEmailReminder` принимают параметр `isOneTime: boolean`.
- Если `isOneTime=true` (line 482, 564, 742, 777) — отправляется info-only текст: «срок доступа истекает», БЕЗ строки «💳 Сумма списания» и БЕЗ CTA на оплату/продление. Это уже корректное поведение для разовых продуктов.
- Если `isOneTime=false` (recurring или installment) — отправляется renewal-текст со строкой «💳 Сумма списания: `{amount} {currency}`» (lines 814/830/846 в email; аналогично в TG).

## Где именно баг (узкий)

Lines 1207–1223: для recurring/installment-веток `amount` читается ТОЛЬКО из легаси `tariff_prices` → для большинства тарифов (вкл. `c5981337-…`, Татьяна Образова) → 0 → «💳 Сумма списания: 0.00 BYN».

Бизнес-инвариант пользователя: цена существует всегда, потому что у тарифа всегда есть «основная кнопка» (`tariff_offers.is_primary=true`). Состояние «не нашли цену» для recurring/installment продукта быть не может.

## Решение — точечный патч ОДНОЙ функции, без новых файлов/таблиц/edge functions

### 1) Добавить локальный inline-резолвер `resolveReminderAmount(sub, tariffId)` внутри `index.ts` (не отдельный модуль)

Вызывается ТОЛЬКО когда классификатор уже сказал, что продукт recurring или installment (`productIsOneTime === false`). Для one-time резолвер вообще не дёргается — оставляем `amount=0` и шаблон-info, как сейчас.

Приоритет источников (первый ненулевой выигрывает):

1. **bePaid live snapshot** — `subscriptions_v2.meta.bepaid.next_charge_amount` (или эквивалент, что уже кладёт `bepaid-sync` / `bepaid-get-subscription-details`). Используется когда фактическая сумма у провайдера отличается от тарифа (промо/индивидуальная цена). На execute-этапе один read_query подтвердит точный путь в meta. Audit: `amount_source='bepaid_snapshot'`.
2. **Order/Subscription snapshot** — `subscriptions_v2.meta.amount_byn` или `final_price` последнего `paid` ордера данной подписки. Audit: `amount_source='order_snapshot'`.
3. **Recurring tariff_offer** — активный offer с `meta.recurring.is_recurring=true`, выбор `is_primary DESC NULLS LAST, sort_order ASC NULLS LAST` (по SOT recurring-snapshot-resolver). Audit: `amount_source='tariff_recurring_offer'`.
4. **Primary tariff_offer (НОВОЕ — гарантированный fallback)** — `is_primary=true AND is_active=true`, при отсутствии — первый `is_active=true ORDER BY sort_order ASC LIMIT 1`. Это «основная кнопка оплаты» из карточки тарифа. Audit: `amount_source='tariff_primary_offer'` + warning `reminders.amount_fallback_to_primary_offer` (recurring offer/snapshot не нашлись, но primary спас).
5. **Legacy `tariff_prices**` — последний fallback для совместимости. Audit: `amount_source='legacy_tariff_prices'`.

Валюта: `subscriptions_v2.meta.currency` → дефолт `BYN` (в `tariff_offers` колонки currency нет, подтверждено схемой).

### 2) Гарантия отправки

- Если все 5 источников вернули 0 для recurring/installment подписки — это data-defect (тариф без единой кнопки). Reminder ВСЁ РАВНО уходит, но строка «💳 Сумма списания» опускается, пишется audit `reminders.amount_unresolved_critical` с `subscription_id`/`tariff_id` для алерта. Это аварийный путь, не штатный.

### 3) One-time — без изменений

Для `productIsOneTime===true` поведение остаётся ровно как сейчас: info-only шаблон, без суммы, без CTA. Резолвер не вызывается. Никаких новых полей, никаких новых веток.

## Что НЕ создаём и не трогаем

- Никаких новых edge functions, таблиц, RPC, cron jobs, миграций.
- Не трогаем `bepaid-sync` / `bepaid-get-subscription-details` — только читаем `subscriptions_v2.meta`.
- Не трогаем `isOneTimeProduct` / `resolveProductRenewability` — это уже SOT, переиспользуем.
- Не трогаем `tariff_prices` (оставляем как fallback).
- Не трогаем cron-расписание, формат даты/времени по Минску, CTA-генерацию, ветку one-time, no_card_warning.
- Шаблоны email/TG: меняется только то, что строка суммы корректно подставляется или (в аварийном режиме) опускается.

## Verify (DoD)

1. Татьяна Образова (tariff `c5981337-…`, recurring): сейчас amount=0 → ожидаем `amount > 0` с источником `bepaid_snapshot` или `order_snapshot` или `tariff_recurring_offer` или `tariff_primary_offer`. Подтверждается одним dry-run прогоном с логом `amount_source`.
2. Прогон по всем `auto_renew=true` подпискам в окнах 7/3/1: сводка `audit_logs` по `event_subtype LIKE 'reminders.amount_%'`. Ожидание: `amount_unresolved_critical = 0`.
3. One-time продукт (например, разовый курс): убедиться, что reminder уходит без строки суммы и без CTA, резолвер не вызван (нет audit `reminders.amount_*`).
4. Installment-подписка: reminder уходит с суммой очередного транша.
5. Регрессия легаси: тариф из `tariff_prices` без `tariff_offers` → источник `legacy_tariff_prices`, сумма прежняя.

## Memory update (после execute)

Дополнить `architecture/communications/renewal-offer-resolver-sot`:

> Reminder amount-резолвер вызывается ТОЛЬКО для recurring/installment продуктов (классификация — `isOneTimeProduct` поверх `resolveProductRenewability`). Для one-time продуктов сумма не резолвится и в шаблон не попадает. Цепочка для recurring/installment: bePaid snapshot → order snapshot → recurring offer → **primary tariff_offer (fallback)** → legacy `tariff_prices`. «Цена не найдена» — инвариант-нарушение, логируется как `reminders.amount_unresolved_critical`, но reminder всё равно отправляется без строки суммы.

После апрува — переключаюсь в default mode, делаю один read_query по фактической форме `subscriptions_v2.meta.bepaid` (точный путь к next_charge_amount), затем точечный патч в `subscription-renewal-reminders/index.ts` (lines 1207–1223 + добавление inline-резолвера). Других файлов не трогаю.