# План: повторная выдача неработающей ссылки на оплату рассрочки после отказа первого платежа

Режим: только план. Код, коммиты, записи в БД, deploy, Publish, обращения к провайдеру и отправки клиентам не выполнялись. Проверка шла на чистом HEAD `db05436a79011631a9dbc0d4365772f0dd29f4a9`. Выпуск счетов идёт отдельно и в этот план не входит.

## Что подтверждено в исходниках
- `bepaid-create-subscription-checkout/index.ts:566`. Если `claimPendingPurchase(..., 'subscription', 'bepaid')` вернул `reusedResult`, сервис сразу отдаёт сохранённый результат: старый `redirect_url` (у checkout `attempts:1`).
- `_shared/pending-purchase.ts`. `claimPendingPurchase` вызывает RPC `crm_claim_pending_purchase`, `finishCheckoutAttempt` вызывает RPC `crm_finish_checkout_attempt`.
- Актуальное тело `crm_claim_pending_purchase` находится в `supabase/migrations/20261026064402_renewal_checkout_cycle_month.sql`, строки 158–167. Попытка `state='ready'` с `expires_at>now()` используется повторно, каждый раз с аудитом `payment_checkout.reused`. Статус заказа и платёжный факт отказа при этом не проверяются. Заказ в статусе `failed` с `paid_amount=0` тоже подходит под reuse (строки 73/90/95).
- `crm_finish_checkout_attempt` (в `20260913112356_crm_pending_purchase_claim.sql`, строки 172–191) меняет состояние только из `creating`. Перевести попытку `ready → failed` штатно нельзя. Отсюда следует вывод: **полное исправление (выдать новую попытку после доказанного отказа) невозможно без изменения SQL-функции.** Только Edge-изменение может лишь отказать в reuse.
- Отказ первого платежа фиксирует `bepaid-webhook`: строки 5171–5197 (`orders_v2.status='failed'` для заказа ссылки) и `upsertPaymentV2(status='failed', provider_payment_id=transaction uid, order_id)` около строки 3163.

## Определение «доказанный терминальный отказ» (строгая корреляция)
Попытку разрешено признать мёртвой, только если выполняются все условия:
1. Попытка `crm_checkout_attempts` найдена, `provider='bepaid'`, `attempt_kind='checkout'`, `state='ready'`, у попытки `order_id` того же заказа.
2. Заказ `orders_v2`: тот же `id`, `paid_amount=0`, `status='failed'`.
3. Есть `payments_v2`: тот же `order_id`, `provider='bepaid'`, `status='failed'`, непустой `provider_payment_id`, создан после `attempt.created_at`. Платежа этого заказа в статусе `succeeded`, `processing` или `pending` нет.
4. Привязка к той же сессии checkout: `orders_v2.meta.tracking_id` (или `checkout_attempt_id` в meta подписки, строка 868) совпадает с попыткой. Если корреляции нет, это не доказательство.

Если любое условие не выполнено (неизвестный исход, успех, нет корреляции, заказ `pending`), поведение остаётся прежним: reuse или `in_progress`.

## Вариант A — минимальный, только Edge, без миграции (рекомендую первым PR)
- Новый чистый helper `_shared/checkout-terminal-failure.ts`: `isProvenTerminalCheckoutFailure(db, {orderId, attemptId, attemptCreatedAt, trackingId})`. Только чтение, правила 1–4.
- `pending-purchase.ts`: `claimPendingPurchase` дополнительно возвращает `attemptCreatedAt`, если RPC его отдаёт. Иначе helper сам читает попытку по `attemptId`, только SELECT через service_role.
- `bepaid-create-subscription-checkout/index.ts:566`: перед возвратом `reusedResult` вызвать helper. Если отказ доказан, вернуть 409 `checkout_previous_attempt_failed` без `redirect_url`, без вставок и без вызова провайдера. Иначе вернуть прежний результат.
- Что получаем: мёртвая ссылка больше не выдаётся. Заказ тот же, второй mandate не создаётся, параллельные вызовы безопасны (только чтение).
- Ограничение: новую попытку для этого заказа не выдать, пока не истечёт `expires_at` (у наблюдаемого случая срок уже истёк). Клиенту нужен понятный ответ в UI оплаты: «Предыдущая оплата отклонена, повторите позже / обратитесь к менеджеру». Тексты UI согласовать отдельно.

## Вариант B — полное исправление, отдельный PR с миграцией (не создаётся сейчас)
- В `crm_claim_pending_purchase` перед блоком reuse (строки 158–167) проверять под `FOR UPDATE` строки заказа те же доказательства 1–4. Если отказ доказан: попытку перевести в `state='failed'` с `result.error='first_payment_terminal_failed'`, записать аудит `payment_checkout.invalidated_after_failure`, вставить новую попытку `claimed` для **того же** заказа. Сериализацию уже обеспечивает существующая блокировка заказа.
- Блок `creating/unknown` (строки 150–157) не трогать: неизвестный исход по-прежнему даёт `in_progress`.
- Ветку с `ready charge` не трогать.
- `bepaid-create-subscription-checkout` после `claimed` создаёт новый checkout. Идемпотентность защищена новым `attempt_id`. Старый mandate провайдера не получил успешной оплаты, поэтому дубля нет. Перед созданием нового checkout проверить, что у старой provider-подписки нет активного состояния: только чтение БД, без вызова провайдера.
- Тот же REVOKE/GRANT (только service_role). Тело функции без изменения сигнатуры.
- Применение только отдельной managed-задачей после review и CI.

## Регрессионные тесты (Deno, `_shared/checkout-terminal-failure_test.ts` и дополнение `create-stripe-checkout-installment_test.ts` по образцу)
1. Доказанный отказ (заказ `failed`, `payments_v2 failed`, tracking совпадает): 409, 0 вставок, 0 вызовов fetch к провайдеру.
2. Платёж `failed`, но есть `succeeded` или `processing`: reuse сохраняется (или блок).
3. Заказ `pending` без платёжного факта: reuse как прежде.
4. Отказ без совпадения tracking или attempt: не доказательство, reuse как прежде.
5. Отказ раньше `attempt.created_at` (от прошлой попытки): не доказательство.
6. Попытка `unknown` или `creating`: остаётся `in_progress`.
7. Ошибка чтения в helper: fail-closed, то есть 409/ошибка без новой попытки и без провайдера (не reuse и не создание).
8. Для варианта B, SQL-тест в CI synthetic DB:
   - два параллельных claim дают ровно одну новую попытку;
   - `order_id` не меняется;
   - повторный вызов возвращает новую `ready` попытку;
   - истории попыток +1 failed, +1 claimed.

## Приёмочные проверки (после отдельного разрешения на deploy)
- Deploy только `bepaid-create-subscription-checkout`. `_shared/pending-purchase.ts` используют ещё 8 функций. Если он меняется, нужно либо не менять его (helper вызывается отдельно), либо отдельно согласовать их re-deploy. **Рекомендация: `pending-purchase.ts` не менять.**
- Read-only проверка проблемного случая: новых `payment_checkout.reused` по той же попытке после deploy 0.
- Платежи, ссылки, отправки клиентам в smoke не используются.
- Цены, eligibility, клиентские записи, правила рассрочки (конечная подписка с mandate) не меняются.

## Нужно решить
- Достаточно ли варианта A (перестать выдавать мёртвую ссылку) или сразу нужен вариант B (автоматически новая попытка того же заказа, нужна миграция)?
