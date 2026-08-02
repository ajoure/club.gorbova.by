# EXECUTE-план: soft-delete двух дублей ручного платежа по ORD-26-02836

Scope строго ограничен: preflight → preview/checksum → recoverable soft-delete ровно `e16c673e…` и `2059c0b0…` через каноническую пару `admin-delete-payment-preview` / `admin-delete-payment-execute` → read-back. Каноническая `80355c88…` не трогается. GitHub guard (прежний раздел 7) в этот EXECUTE не входит и не выполняется.

## Основание (уже подтверждено forensic-ревизией, read-only)

- Три `succeeded` платежа по 3300 BYN на заказе `4ffa5e3d…` (`ORD-26-02836`, `final_price=3300`, `paid_amount=3300`).
- `80355c88…` и `e16c673e…` имеют идентичный `request_hash`; `2059c0b0…` отличается только добавленным комментарием. Одинаковые `paid_at`, банк, плательщик, заказ; отдельных банковских документов/референсов нет.
- Сумма `succeeded` платежей = 9900 BYN против 3300 по заказу → завышение отчётной выручки на 6600 BYN.
- Доступ не задвоен: `entitlements=1`, `subscriptions_v2=1`, `access_grant_ledger=1`, `generated_documents=0`.
- Каноническая `80355c88…` используется как `group_payment_id` дочерних `ORD-26-02836-A1/A2`.

## Шаги EXECUTE

1. **Preflight (read-only).** Подтвердить: по заказу ровно 3 платежа `succeeded`, `is_deleted=false`, с ожидаемыми id и суммой 3300 BYN каждый; `entitlements=1`, `subscriptions_v2=1`, `ledger=1`; `group_payment_id` обоих child = `80355c88…`; заказ `status=paid`, `paid_amount=3300`. STOP при любом расхождении.
2. **Preview.** Вызвать `admin-delete-payment-preview` отдельно для `e16c673e…` и для `2059c0b0…`. Зафиксировать checksum и граф зависимостей. STOP, если preview показывает привязанные entitlement / subscription / ledger / документ, либо помечает платёж как canonical/group payment.
3. **Execute.** Вызвать `admin-delete-payment-execute` ровно по этим двум id, по одному, с checksum из шага 2 и `reason = duplicate_manual_payment_ord_26_02836`. Ожидаемый rowcount = 1 на вызов. Строки сохраняются в БД (`is_deleted=true`, `deleted_at`, `deleted_by`, `deleted_reason`, `deletion_context`) — операция обратима, audit trail сохранён.
4. **Read-back.** По заказу ровно 1 активный `succeeded` платёж `80355c88…` на 3300 BYN; сумма активных платежей = `final_price` = 3300; `entitlements=1`, `subscriptions_v2=1`, `ledger=1` без изменений; дата окончания доступа клиента не изменилась; INV-20 actionable = 0 и четыре child по-прежнему `suppressed`; две удалённые строки присутствуют с `is_deleted=true`.

## Запреты в этом EXECUTE

Не трогать `80355c88…`. Никакого прямого DML по `payments_v2` в обход canonical RPC. Никаких bank/bePaid void/refund/списаний. Не менять access, entitlement, subscription, ledger, order, group, документы, роли, шаблоны, чаты. Без кода, коммитов, миграций, deploy и Publish. Физического удаления строк нет.

## STOP-условия

rowcount ≠ 1; checksum mismatch между preview и execute; preview показывает зависимости; изменение entitlement / subscription / ledger / даты доступа; поломка group-контракта child-заказов; любое расхождение preflight с фактами выше.
