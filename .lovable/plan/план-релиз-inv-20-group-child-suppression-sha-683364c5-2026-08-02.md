# План: релиз INV-20 group-child suppression (SHA 683364c5)

## Preflight (выполнен, read-only)

- Managed HEAD = `683364c586d66b11a45eb336b45139e975f6ae26` («fix(payments): harden group child verification (#259)»), дерево чистое — совпадает с заявленным SHA.
- Scope в наличии: `supabase/migrations/20260802133000_exclude_group_child_orders_from_inv20.sql` (98 строк) и `supabase/functions/admin-repair-missing-payments/index.ts`.
- Зависимости схемы существуют: `order_groups(id, primary_order_id, user_id, status)`, `order_group_items(order_group_id, order_id, role)`, `payments_v2(id, order_id, user_id, status)`.
- Четыре child-заказа `a6c4a129…`, `2ed72842…`, `c7e73d97…`, `603b779a…` (ORD-26-02908-A1/A2, ORD-26-02836-A1/A2): status=paid, собственных `payments_v2` = 0, meta содержит все четыре ключа (`group_child_order=true`, `group_payment_id`, `group_primary_order_id`, `order_group_id`), у каждого ровно 1 membership-строка с `role='addon'`.
- Родительские платежи `80355c88…` и `a09169c1…` — `succeeded`, их группы `bbcac816…` и `b130b53b…` — `paid`, `primary_order_id` совпадает с `order_id` платежа, user совпадает. Итого родительских платежей ровно 2.

Вывод: SHA/scope/зависимости сходятся, блокирующих finding нет.

## EXECUTE-план (минимальный, только по запросу)

1. Preflight-повтор: подтвердить managed HEAD ровно `683364c586d66b11a45eb336b45139e975f6ae26` и чистое дерево. STOP при mismatch.
2. Применить ровно одну managed migration `20260802133000_exclude_group_child_orders_from_inv20.sql` в её финальном содержимом из этого SHA (CREATE OR REPLACE `public.inv20_paid_orders_actionable`, REVOKE от PUBLIC/anon/authenticated, GRANT только `service_role`). Других миграций не применять.
3. Развернуть ровно одну Edge Function `admin-repair-missing-payments` из этого SHA. Других функций не деплоить.

## Read-back / dry-run (после шагов 2-3)

1. `admin_find_orders_without_payments` (INV-20): `actionable_count = 0`; четыре child-заказа попадают в `suppressed`, и ни один не в `actionable`.
2. Проверка каноничности подавления: для каждого child подтверждается совпадение parent payment + primary order + `order_groups.status='paid'` + один и тот же user + membership `role='addon'` — подавление только по этому пути, не по «мягким» признакам.
3. `admin-repair-missing-payments` с `dry_run=true`: ни одного планируемого создания `payments_v2` для четырёх child-заказов, `repaired=0`.
4. Пост-проверка данных: собственных `payments_v2` у child по-прежнему 0; родительских платежей ровно 2; сумма выручки по группам не изменилась.
5. INV-20 не показывает новых critical finding.

## STOP-условия

Любое расхождение SHA/scope/зависимостей, ненулевой `actionable` по четырём child, попытка dry-run создать платёж, изменение количества платежей или новый critical finding — немедленный STOP и отчёт без исправлений.

## Вне scope

Никаких других migrations/functions, никакого DML, UI Publish, изменений кода, коммитов, ролей, биллинга, шаблонов и сообщений.
