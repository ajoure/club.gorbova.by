# План: точечный возврат конкретного платежа + сведение дубля рассрочки (20 поток)

PLAN-ONLY / READ-ONLY. Код, SQL, provider-writes, deploy и Publish не выполнялись.
Опубликованный source: `b08aa42bfba39ccbafa2ffd9d296ee895e2eeffd`.

## 1. Актуальные факты (read-only, без ПД)

Продукт: `3e43fb28-8322-41bc-bfee-714731bdc630` (20 поток). Всего у клиента по этому продукту — ровно 2 заказа.

Заказ A (исходный) `e17b35b2-d908-48e1-b98f-ca5f86cdf579`
- `SUB-LINK-MS69W0DD`, статус `paid`, final_price 663.00 BYN, paid_amount 663.00, tariff `98539e5d-…`, offer NULL, создан 29.07.2026, is_deleted=false
- подписка `c6633a7b-216f-41e5-b32a-cb771add4ad6`: provider_managed, `sbs_9a86268a608fca3f`, отменена 11.08.2026 (`bepaid_terminal_state=canceled`), access_end 28.08.2026
- платёж 1: `40f01f87-79c1-44cf-9148-64c71d0d871f`, 663.00, `succeeded`, provider uid `e1908f33-…`, оплачен 29.07.2026, refunded_amount 0
- entitlement по этому заказу: 0

Заказ B (дубль/перевыпуск) `9673e359-e98e-4e7e-8196-f31f60b4e16d`
- `SUB-LINK-MSOFLH7I`, статус `paid`, final_price 663.00, paid_amount 663.00, tariff `767bb895-…`, offer `c7f5221e-…`, создан 11.08.2026
- подписка `d16b01e5-efdd-43c8-a98c-c7d15daacfa7`: `sbs_bd6975629dfe2c83`, billing_cycles 2, paid_billing_cycles 2, installment_status `completed`, статус `expired`, access_end 07.06.2027
- платёж 2: `8401bbfb-1d90-4b3f-8738-7ce581a9bc51`, 663.00, `succeeded`, uid `44c6af6c-…`, 11.08.2026, refunded_amount 0
- платёж 3: `1ad28122-537a-4272-8cc4-7df4cf4bd6ac`, 663.00, `succeeded`, uid `6e1edf0b-1fb4-47a5-a048-6f937cce7d52`, 10.09.2026, refunded_amount 0
- entitlement `17285a9f-…`: active, product_code `prd_7222cb3152c3`, expires 07.06.2027

Итого: 3 подтверждённых списания × 663 = 1989 BYN при обязательстве 1326/1325 по одной подписке; refund-строк нет (0), `installment_payments` строк нет (0 — provider-managed finite не материализует график).

Целевое состояние по требованию: одна сделка 1325 BYN, первые два 663+663 остаются, третий (`1ad28122-…` / uid `6e1edf0b-…`) должен быть возвращаемым, доступ сохраняется.

## 2. Provider GET
Свежая read-only сверка транзакций/возвратов/подписок у провайдера не выполнена: canonical credentials теперь owner-restricted (этап PR433/434), у среды нет доступа к ним, ранее прямой read-only auth возвращал 401. Фиксирую как ограничение — provider-side подтверждение нужно снять до apply (см. preconditions).

## 3. Корневая причина точечного возврата
`supabase/functions/subscription-admin-actions/index.ts` (refund):
- строки 336–341: `payments?.find(p => p.status==='succeeded' && p.provider_payment_id && p.transaction_type!=='refund')` — берётся **первый** подходящий платёж заказа. Для заказа B это платёж 2 (11.08), а не третий.
- `actualRefundAmount = refund_amount || order.final_price` — сумма не проверяется против выбранного платежа.
`src/components/admin/RefundDialog.tsx` работает на уровне `orderId`, конкретный `payment_id` не передаётся; кнопка возврата не привязана к строке платежа.

## 4. Минимальный GitHub-first патч (одним PR)
1. Edge `subscription-admin-actions`, action `refund`:
   - принимать необязательный `payment_id`; если передан — выбирать именно эту строку `payments_v2` с проверками: `order_id` совпадает, `status='succeeded'`, `transaction_type!=='refund'`, `is_deleted` не true, есть `provider_payment_id`; иначе `payment_not_refundable`.
   - валидация суммы: `refund_amount <= payment.amount - payment.refunded_amount`, иначе `refund_exceeds_payment_balance`. Без `payment_id` — прежнее поведение (обратная совместимость).
   - идемпотентность: `refund_request_key` обязателен при переданном `payment_id`; фактическая защита остаётся в `record_refund_atomic` (dedup по `provider_payment_id` refund-uid). Ничего нового в БД не создаётся.
   - `access_action` по умолчанию `keep` — доступ и entitlement не трогаются.
2. UI: в списке платежей сделки/рассрочки (DealDetailSheet и вкладка рассрочек) кнопка «Возврат» на каждой строке платежа; `RefundDialog` получает `paymentId`, `maxAmount = amount - refunded_amount`, показывает дату/сумму конкретного списания и передаёт `payment_id` + `refund_request_key`.
3. Тесты: unit на выбор платежа (третий, не первый), на превышение суммы, на повторный вызов с тем же ключом; UI-тест наличия кнопки на каждой строке.
4. Никаких изменений схемы, RLS, grants, RPC.

## 5. Сведение дубля (отдельный apply, не в этом PR)
Без удаления платежей, orders и доступа:
- заказ A `e17b35b2-…`: пометить в `meta` как `superseded_by = 9673e359-…`, статус и платёж не менять, is_deleted не ставить.
- заказ B `9673e359-…`: сделать носителем обязательства 1325/1326 (`meta.installment.effective_total_byn`), связать платёж 1 как учтённый по этому обязательству через `meta`, без переноса строк платежей.
- подписки, entitlement `17285a9f-…` (expires 07.06.2027) и access_rules не менять.
- после возврата третьего платежа: `orders_v2.status` остаётся `paid` (частичный возврат), классификатор UI покажет «Частичный возврат» по paidSum/refundedSum.

## 6. Ожидаемые rowcounts при apply
Возврат 663 по `1ad28122-…`:
- +1 строка `payments_v2` (`transaction_type='refund'`, amount −663.00, provider uid возврата), всего 4
- `payments_v2.refunded_amount` у `1ad28122-…`: 0 → 663.00 (1 UPDATE)
- `orders_v2` `9673e359-…`: 1 UPDATE meta, status остаётся `paid`
- `entitlements`: 0 изменений; `subscriptions_v2`: 0 изменений; `installment_payments`: 0
- audit: 1 запись `admin.subscription.refund_recorded`
Сведение дубля: 2 UPDATE в `orders_v2` (только meta / пометка), 0 DELETE.

## 7. Preconditions для apply
- PR смержен, checks PASS, exact SHA сообщён; функция `subscription-admin-actions` задеплоена из approved source.
- Свежий provider read-only GET по uid `6e1edf0b-…`: транзакция `successful`, возвратов по ней 0; подписка `sbs_bd6975629dfe2c83` в terminal/completed состоянии; `sbs_9a86268a608fca3f` — canceled.
- Повторная сверка: refunded_amount по всем трём платежам = 0, refund-строк 0.
- Возврат запускается ровно один раз с `payment_id=1ad28122-…`, `refund_amount=663.00`, `access_action='keep'`, уникальным `refund_request_key`.
- Read-back по п.6; при любом расхождении, provider-ошибке или новом critical — STOP.

Реальный возврат не запускался.
