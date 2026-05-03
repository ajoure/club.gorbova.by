да, согласен, с учетом правок:

Добавь в dry-run обязательные STOP-checks:

&nbsp;

1. Не удалять `failed/canceled/pending`, если есть хоть одна запись в:

   - payments_v2 по order_id;

   - subscriptions_v2.order_id;

   - subscriptions_v2.meta.extended_by_orders;

   - entitlements.meta с order_id/source_order_id;

   - access_grant_ledger;

   - audit_logs с order_id.

&nbsp;

2. Перед DELETE сохранить snapshot удаляемых строк в отдельную backup-таблицу:

   `_orders_orphan_cleanup_2026_05_backup`.

&nbsp;

3. Execute делать только по exact id-list из approved dry-run snapshot, не пересчитывать cohort заново внутри execute.

&nbsp;

4. В Cohort B отдельно вывести причину сохранения:

   `paid_without_payment`, `refunded`, `has_payment`, `has_subscription_ref`, `has_entitlement_ref`, `has_audit_ref`.

&nbsp;

5. Verify:

   - удалено ровно approved_count;

   - backup_count = deleted_count;

   - повторный execute = 0;

   - доступы/подписки/entitlements не изменились.

&nbsp;

План: Аудит сделок без платежей (Gorbova Club + Бухгалтерия как бизнес)

## Контекст

Правило: «есть платёж — есть сделка; нет платежа — сделки быть не должно». Удаляем только висячие `orders_v2` без единой строки `payments_v2`. Доступы пользователей живут в `subscriptions_v2` / `access_rules` / `entitlements` и от удаления `orders_v2` не зависят.

## Скоуп (только два продукта)

- `11c9f1b8-0355-4753-bd74-40b42aa53616` — Gorbova Club
- `85046734-2282-4ded-b0d3-8c66c8f5bc2b` — Бухгалтерия как бизнес

## Текущая картина (live)


| Продукт | Всего | С оплаченным платежом | Только неуспешный платёж | Без платежей | Из них status=paid |
| ------- | ----- | --------------------- | ------------------------ | ------------ | ------------------ |
| Club    | 2263  | 1536                  | 101                      | 626          | 3                  |
| БкБ     | 142   | 110                   | 22                       | 10           | 0                  |


«Без платежей» по статусу:

- Club: pending=609, failed=12, canceled=2, paid=3
- БкБ: pending=10

## Когорты

- **Cohort A — кандидаты на удаление**: orders_v2 без `payments_v2` И status ∈ (`pending`, `failed`, `canceled`). Ожидаемо ~633 строки.
- **Cohort B — STOP, ручной разбор**: orders_v2 без платежей со status=`paid` (3 Club).
- **Cohort C — не трогаем**: всё с любыми payments_v2 (включая failed) и `refunded`.

## Pre-delete safety check (для каждой строки Cohort A)

Если найдено ЛЮБОЕ — строка уходит в Cohort B (manual review):

1. Нет `subscriptions_v2` через `meta->>'origin_order_id'` или `order_id`.
2. Нет `access_rules.source_order_id = order.id`.
3. Нет `entitlements.meta->>'order_id'`.
4. Нет `crm_activity_log.order_id` (либо архивируем активность отдельно).

## Этапы

1. **Dry-run (read-only)**
  - Полный SQL по двум продуктам, фильтрация Cohort A с safety-checks.
  - CSV в `/mnt/documents/cohort_a_club.csv`, `cohort_a_buh.csv`, `cohort_b.csv`.
  - Колонки: `id, order_number, product, status, final_price, profile_id, email, created_at`.
  - Возврат точного числа строк к удалению + список Cohort B.
2. **Approve gate** — жду подтверждения по точному количеству.
3. **Execute (миграция)**
  - `INSERT INTO audit_logs(action='orders.cohort_a_orphan_delete_2026_05', meta=jsonb_строки)` ПЕРЕД delete.
  - `DELETE FROM orders_v2 WHERE id = ANY($cohort_a_ids)`.
  - Идемпотентность: повторный запуск = 0.
4. **Verify**
  - Повторный аудит: `no_payment AND status IN ('pending','failed','canceled')` для двух продуктов = 0.
  - Snapshot `subscriptions_v2/access_rules/entitlements` count по затронутым `profile_id` до/после = diff 0.
  - Proof: `.lovable/proofs/orders_v2_orphan_cleanup_2026_05.md`.

## DoD

- Cohort A удалён, Cohort B сохранён и передан тебе списком.
- Audit-лог на каждую удалённую строку.
- Доступы не изменились (verify diff = 0).
- Повторный dry-run = 0.

## Что НЕ трогаем

- `refunded`, `paid`-без-платежа (Cohort B), любые orders с payments (включая failed).
- Другие продукты.
- `subscriptions_v2` / `access_rules` / `entitlements`.

Подтверди план — переключусь в build, сгенерю dry-run CSV и покажу полные списки до любых удалений.