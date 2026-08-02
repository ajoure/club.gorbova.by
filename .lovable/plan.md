# Forensic: три ручных платежа по ORD-26-02836 (order `4ffa5e3d…`)

## 1. Точные данные трёх строк `payments_v2`

Общее для всех трёх: `order_id=4ffa5e3d…`, `user_id=f32ff3d9…`, `provider=bank`, `provider_payment_id=NULL`, `status=succeeded`, `amount=3300.00`, `currency=BYN`, `paid_at=2026-07-27 22:00:00+00` (идентичен), `meta.source=admin_manual`, `meta.created_by=05cd3754…` (один и тот же администратор), `meta.manual_details.receiving_bank_name=Паритетбанк`, `related_order_id=4ffa5e3d…`, `order_number_snapshot=ORD-26-02836`. `receipt_url` и банковский референс отсутствуют, `is_deleted=false`.

| payment id | created_at | updated_at | idempotency_key | request_hash | comment |
|---|---|---|---|---|---|
| `80355c88…` | 29.07 14:08:56 | 29.07 17:31:08 | `manual-payment:v3:a2b55b09…` | `533d6a2f…48cd` | нет |
| `e16c673e…` | 29.07 15:46:36 | 29.07 15:46:36 | `manual-payment:v3:10d94f59…` | `533d6a2f…48cd` | нет |
| `2059c0b0…` | 29.07 17:29:47 | 29.07 17:31:01 | `manual-payment:v3:ea50a3c8…` | `25eb1671…c654` | «платеж банка» |

Order: `ORD-26-02836`, `status=paid`, `final_price=3300.00`, `paid_amount=3300.00`, `currency=BYN`, source `invoice_checkout`, группа `bbcac816…` (3 позиции: parent + 2 addon child).

## 2. Кто и как создал каждую

Все три созданы одним админом через `admin-create-manual-payment` → RPC `admin_create_manual_payment_v1`. В `audit_logs` для каждой есть пара событий:
`admin_manual_payment_created` (entity_type `payments_v2`) и сразу за ней `admin_manual_payment_fulfillment_failed` с `detail=access_grant_failed:4ffa5e3d…:Edge Function returned a non-2xx status code`. По `e16c673e…` дополнительно два idempotent-replay события (15:46:54 и 15:47:17) — повторные вызовы с тем же ключом корректно вернули ту же строку, новых платежей не создали.

Recalc в аудите фиксирует нарастание: при первом платеже `net_paid=3300`, при втором `net_paid=6600` при `final_price=3300`.

## 3. Один банковский документ или разные транзакции

Доказательства дубликата одной и той же оплаты:
- идентичные `paid_at`, сумма, валюта, банк, плательщик, заказ;
- `80355c88…` и `e16c673e…` имеют **побайтово одинаковый `request_hash`** — сервер посчитал их одинаковыми запросами, разделил только клиентский `idempotency_key`;
- `2059c0b0…` отличается от них только добавленным комментарием «платеж банка», прочие поля совпадают;
- ни у одной строки нет отдельного банковского референса/`provider_payment_id`/`receipt_url`, то есть отдельных банковских документов нет;
- заказ выставлен на 3300 BYN (`final_price=3300`), рассрочки нет: `installment_number` не заполнен, `installment_payments` по заказу отсутствуют;
- каждая запись создавалась сразу после сообщения об ошибке выдачи доступа — типичный ручной retry.

Вывод: это **три записи одной банковской оплаты 3300 BYN**, не отдельные платежи и не installments. Каноническая — самая ранняя `80355c88…` (именно она в group-контракте INV-20 и в дочерних заказах `meta.group_payment_id`). Дубли — `e16c673e…` и `2059c0b0…`.

## 4. Влияние каждой записи

- **Revenue:** сумма `succeeded` платежей по заказу = **9900 BYN** против `final_price/paid_amount = 3300`. Любой отчёт, суммирующий `payments_v2` (админ-страница платежей, статистика), завышен на **6600 BYN**. Заказ сам по себе корректен.
- **Access / subscription / entitlement:** по 1 записи (`entitlements=1`, `subscriptions_v2=1`) — дубли доступ не удваивали и не влияют на срок.
- **Ledger:** `access_grant_ledger` по заказу ровно 1 строка — не задвоен.
- **Invoice/документы:** `generated_documents` по заказу 0 — влияния нет.
- **INV-20 / group-контракт:** дочерние `ORD-26-02836-A1/A2` ссылаются на `group_payment_id=80355c88…`; удаление дублей контракт не ломает, удаление канонической — сломает.

## 5. Root cause

1. На 29.07 в 14:08–17:29 UTC в БД **ещё не было guard'а `order_already_fully_paid`** — миграция `20260729180632_manual_payment_fully_paid_guard.sql` появилась в 18:06 UTC, то есть после всех трёх вставок. Повторное создание платежа на полностью оплаченный заказ не блокировалось.
2. Идемпотентность строится **только на клиентском `idempotency_key`**, который `ManualPaymentDialog` генерирует заново (`crypto.randomUUID()`) при каждом открытии диалога/сабмите; `request_hash` считается и сохраняется, но не используется как ключ дедупликации. Поэтому два запроса с одинаковым hash дали две строки.
3. Триггер повторов — падение downstream `grant-access-for-order` (non-2xx): UI показывал ошибку, админ повторял операцию целиком вместо retry уже созданного платежа.

## 6. Предлагаемый CAS-план коррекции (не выполнять до отдельного APPROVE)

Дубли доказаны, поэтому план возможен. Он не отзывает доступ и сохраняет audit trail — используется каноническая soft-delete-цепочка, а не физическое удаление.

1. Preflight (read-only, STOP при любом расхождении): подтвердить, что по заказу по-прежнему ровно 3 succeeded платежа с указанными id, `is_deleted=false`, `entitlements=1`, `subscriptions_v2=1`, `ledger=1`, и что `group_payment_id` дочерних заказов = `80355c88…`.
2. `admin-delete-payment-preview` (`admin_payment_delete_preview_v1`) отдельно для `e16c673e…` и `2059c0b0…`: зафиксировать checksum и граф зависимостей; STOP, если preview показывает привязанные entitlement/ledger/subscription/документ.
3. `admin-delete-payment-execute` (`admin_payment_delete_execute_v1`) ровно по двум id, по одному, с тем же checksum и `reason` вида `duplicate_manual_payment_ord_26_02836`. Ожидаемый rowcount = 1 на вызов. Строки остаются в БД с `is_deleted=true`, `deleted_at`, `deleted_by`, `deleted_reason`, `deletion_context` — audit trail сохранён.
4. Каноническую `80355c88…` не трогать. Никакого прямого DML по `payments_v2`, никаких void/refund в банке или у провайдера, никаких обращений к bePaid.
5. Read-back: по заказу ровно 1 активный succeeded платёж 3300 BYN; сумма платежей = `final_price` = 3300; `entitlements=1`, `subscriptions_v2=1`, `ledger=1` без изменений; доступ клиента активен и дата окончания не изменилась; INV-20 actionable = 0 и четыре child по-прежнему `suppressed` (их `group_payment_id` указывает на живую `80355c88…`).
6. STOP-условия: rowcount ≠ 1, preview-checksum mismatch, изменение entitlement/subscription/ledger, изменение даты доступа, поломка group-контракта.

## 7. Минимальный GitHub guard против повторения

Одна ветка `codex/manual-payment-duplicate-guard`, отдельный PR, минимальный диф:

- **Миграция:** частичный уникальный индекс на активные ручные платежи, например
  `CREATE UNIQUE INDEX CONCURRENTLY ... ON payments_v2 ((meta->>'request_hash')) WHERE meta->>'source'='admin_manual' AND is_deleted = false AND status = 'succeeded'` — либо, если хеш не всегда есть, уникальность по `(order_id, provider, amount, currency, paid_at)` при тех же условиях. Перед применением обязателен dry-run на существующие конфликты (текущие дубли должны быть сначала soft-deleted шагом 6).
- **RPC `admin_create_manual_payment_v1`:** дедупликация по `p_request_hash` в дополнение к `p_idempotency_key` — при совпадении hash в пределах заказа возвращать существующий платёж как idempotent replay, а не создавать новый.
- **UI `ManualPaymentDialog`:** не перегенерировать `idempotency_key` при повторном сабмите той же неизменённой формы; после `fulfillment_failed` предлагать retry уже созданного платежа, а не новое создание.
- **Тест:** расширить `src/test/manualPaymentCompositeIntegrity.test.ts` кейсом «повтор с тем же request_hash не создаёт вторую строку».

## Вне scope

Ничего не изменялось: без void/refund/delete/update, без кода, миграций, deploy и Publish. Персональные данные и payload в отчёт не выносились.
