# План релиза PR #260 (SHA 6e65fca53646990243793d9cda1f7f214c2350b9)

Режим сейчас: PLAN-ONLY. Ничего не синхронизировано, не применено, не развернуто, не опубликовано.

## Предварительная сверка (уже выполнена, read-only)

- Managed HEAD = `6e65fca53646990243793d9cda1f7f214c2350b9`, рабочее дерево чистое.
- Файл `supabase/migrations/20260802143000_require_live_payments_for_inv20.sql` присутствует.
- Каталог `supabase/functions/admin-repair-missing-payments/` присутствует (index.ts, group_child_order.ts + тесты).

## EXECUTE-план (после отдельного одобрения)

### Шаг 1. Preflight
- Подтвердить managed HEAD ровно `6e65fca53646990243793d9cda1f7f214c2350b9` и чистое дерево.
- STOP при любом расхождении SHA или наличии незакоммиченных изменений.

### Шаг 2. Migration
- Применить ровно одну managed migration: `20260802143000_require_live_payments_for_inv20.sql`.
- Никаких других миграций, никакого DML по данным.
- STOP при ошибке применения или расхождении содержимого.

### Шаг 3. Deploy
- Развернуть ровно одну Edge Function: `admin-repair-missing-payments` из этого SHA.
- Другие функции не трогать.

### Шаг 4. Read-back (все проверки обязательны)
1. Контент применённой миграции и задеплоенной функции совпадает с файлами SHA.
2. RPC `inv20_paid_orders_actionable`: actionable = 0.
3. Dry-run `admin-repair-missing-payments`: `repaired = 0`, `no_real_payment = 4`.
4. Четыре addon child заказа подавлены исключительно по активному parent payment (reason `group_child_order_payment_on_parent`).
5. `ORD-26-02836-A1` и `ORD-26-02836-A2`: `meta.group_payment_id = e16c673e-737c-473d-911f-927d06c85a7d`.
6. Parent `4ffa5e3d-f31e-49f5-84e5-e5974a167916`: ровно один активный payment на 3300 BYN.
7. Собственных активных child payments = 0.

Любое расхождение счётчиков — немедленный STOP с отчётом, без компенсирующих действий.

## Вне scope

- Никакого DML по данным сверх уже завершённого CAS.
- Никаких charge / refund / void, GetCourse, AmoCRM, email.
- Никакого UI Publish, новых коммитов и других функций/миграций.

## Проверки Definition of Done

Релиз считается PASS только если: preflight совпал, миграция применена, функция развёрнута, и все 7 пунктов read-back прошли.
