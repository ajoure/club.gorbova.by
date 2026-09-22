# План: инцидент оплаты 22.09.2026, публичная ссылка Gorbova Club BUSINESS 250 BYN

Режим: READ-ONLY. Ничего не изменено, не задеплоено, не опубликовано; checkout/платёж не создавались, сообщения не отправлялись.
Источник истины: origin/main = HEAD = `3bd612bd2056496122412a61ce15355df7e2e2ab`, дерево чистое.

## 1. Доказательства (confirmed)

Время инцидента — **16:11–16:13 UTC (19:11–19:13 Минск)**, а не 15:12 UTC: в этом окне логи сохранились, и в них ровно два обращения по публичной ссылке, оба упали.

| Время UTC | Минск | Событие |
|---|---|---|
| 16:11:44.7 | 19:11:44 | `[public-checkout] target_user_resolved` user `def0faba…`, link `ba2a0536…` |
| 16:11:45.1 | 19:11:45 | `[public-checkout] Unexpected error: orphan_provider_subscription_requires_reconciliation` |
| 16:12:28.3 | 19:12:28 | тот же user, link `7e4b1a17…` |
| 16:12:28.8 | 19:12:28 | та же ошибка |

- `stage` = `pending_checkout_lookup` (внутри `createPaymentCheckout` → `reusePendingSubscriptionCheckout`), stack: `_shared/pending-subscription-checkout.ts:36` → `_shared/create-payment-checkout.ts:494` → `public-checkout/index.ts:304`.
- `error_name` = `Error`, `error_message` = `orphan_provider_subscription_requires_reconciliation`.
- Отдельного `incident_id` нет: structured-логирование с `incident_id` реализовано только в `bepaid-create-subscription-checkout` (PR #515), публичный путь `public-checkout` его не имеет — **UNKNOWN by design**.
- Коммерческие дельты: новых orders/payments/subscriptions/provider rows не создано, provider checkout не возникал.

## 2. Состояние данных пользователя (confirmed, masked)

Блокирующая строка — **orphan provider subscription**:

| Поле | Значение |
|---|---|
| provider row | `4ca476af…` (`sbs_024463…`) |
| state | `redirecting` (входит в `BLOCKING_PROVIDER_STATES`) |
| subscription_v2_id | NULL |
| order_id (колонка) | NULL, в meta — `00a8fd02…` |
| orders_v2 по этому id | **строки не существует** |
| created_at / updated_at | 2026-03-18 06:00 UTC / 2026-05-03 11:34 UTC |

То есть это протухший checkout полугодовой давности по уже несуществующему заказу.

Локальные подписки на Club (`11c9f1b8…`) у пользователя: только `past_due`, `expired`, `superseded`; ни одной `active`/`trial`; активного доступа к Club сейчас нет. Вторая orphan-строка `60212e84…` в состоянии `expired` не блокирует.

## 3. Root cause (confirmed)

`supabase/functions/_shared/pending-subscription-checkout.ts`, строки 44–54:

```
orderId = orphan.order_id || orphan.meta?.order_id      // 00a8fd02…
linked  = orders_v2 by orderId                          // не найдено
if (error || !linked || linked.product_id === proposed.product_id) throw
```

Отсутствие заказа трактуется как «требуется ручная сверка», хотя строка объективно мёртвая. Итог: любая попытка оплатить Club этим пользователем гарантированно падает.

Второй дефект — **маскировка**: контролируемый маппинг reconciliation-ошибок в HTTP 409 `CHECKOUT_RECONCILIATION_REQUIRED` реализован только в `bepaid-create-subscription-checkout/index.ts` (строки 368–385). Публичный путь `public-checkout` → `create-payment-checkout` его не имеет, поэтому throw уходит в общий catch и пользователь видит «Не удалось открыть страницу оплаты».

## 4. Подтверждение правила (confirmed по коду и данным)

- Terminal provider states (`canceled`, `cancelled`, `expired`, `terminated`) **не входят** в `BLOCKING_PROVIDER_STATES` и уже не блокируют. Проблема только в stale-строках с нетерминальным `redirecting`/`pending`, потерявших заказ и подписку.
- Локальные `canceled`/`expired`/`superseded` подписки блокирующими не считаются: reuse требует `pending`/`past_due` (строка 60), конфликт активной — только для `active`/`trial`.
- Новый период не суммируется: `planned_access_start_at = now` (`create-payment-checkout.ts`, строки 788, 922), длительность = `tariff.access_days` (30). После успешной оплаты доступ стартует датой оплаты на 30 дней.

Вывод: stale pending/redirecting orphan-строка отменённой или утраченной покупки **должна исключаться** и из blocking, и из reuse.

## 5. Минимальный GitHub-first патч

Файлы:
- `supabase/functions/_shared/pending-subscription-checkout.ts` — orphan-ветка: блокировать только если заказ **существует**, не удалён, `paid_amount=0`, статус `pending`/`failed` и product совпадает. Отсутствующий/чужой/оплаченный/терминальный заказ — не блокирует (`continue`). Отсутствие `orderId` также не блокирует. Бросать типизированную ошибку с полем `code`.
- `supabase/functions/_shared/create-payment-checkout.ts` — вернуть reconciliation-класс как контролируемый ответ, а не throw.
- `supabase/functions/public-checkout/index.ts` — маппинг в HTTP 409 `{ ok:false, code:'CHECKOUT_RECONCILIATION_REQUIRED', stage }`, переиспользовать хелпер из `bepaid-create-subscription-checkout`; добавить structured `request_started`/`unexpected_error` с `incident_id` (без PII/URL).
- `src/utils/normalizeEdgeFunctionError.ts` — сообщение для `CHECKOUT_RECONCILIATION_REQUIRED` уже есть, проверить покрытие публичного пути.

Тесты:
- `tests/edge/pendingSubscriptionCheckout.test.ts` — новые кейсы: orphan без заказа, orphan с несуществующим заказом, orphan с оплаченным заказом → **не блокируют**; orphan с реальным неоплаченным заказом того же продукта → по-прежнему reconciliation.
- `src/test/paymentCheckoutIncidentContract.test.ts` — публичный путь отдаёт 409 с кодом, а не «Internal server error».

Миграции: **не нужны**. Ручные правки данных: не нужны (патч делает мёртвую строку безвредной). Deploy: только `public-checkout`. Publish: фронтенд, если менялся текст ошибки.

## 6. Безопасный acceptance именно по этой ссылке

1. OPTIONS → 200; неавторизованный/пустой body → контролируемый JSON.
2. Baseline: счётчики orders_v2 / payments_v2 / subscriptions_v2 / provider_subscriptions / crm_checkout_attempts.
3. Один запрос по той же публичной ссылке: ожидается **HTTP 200 и новый checkout** (reuse невозможен — валидных pending-строк с заказом нет), либо, если что-то ещё не сверено, контролируемый 409 с кодом — но не «Internal server error».
4. Оплату не проводить. Если возник новый provider checkout — он остаётся неоплаченным; фиксируем ровно одну новую строку заказа/подписки и отсутствие payments. Если создание нового checkout нежелательно, acceptance ограничивается пунктами 1–2 плюс unit-тестами.
5. Read-back: payments = 0 дельты; после реальной оплаты клиентом — `access_start_at` = дата оплаты, `access_end_at` = +30 дней, без суммирования с прошлым периодом.

## 7. Отдельно

Вторая orphan-строка `60212e84…` (`expired`) и историческая `past_due`-подписка `835a5f58…` другого пользователя к этому инциденту отношения не имеют; чистка stale-строк — отдельный follow-up, для разблокировки оплаты не требуется.
