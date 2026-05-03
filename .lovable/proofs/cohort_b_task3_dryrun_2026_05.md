# Cohort B — Task 3 Dry-Run: 5aa1c624 admin duplicate (2026-05)

Read-only. Никаких мутаций.

## Объект

| Поле | Значение |
| ---- | -------- |
| id | `5aa1c624-b390-4fd5-af0d-0b849d40dd11` |
| order_number | `PAY-26-MLZ4H7DT` |
| status | `canceled` ✅ (уже не `paid`) |
| user_id | `2c8ffa9e-6d40-4dc8-b5aa-30a8fc7afec1` (`volodik_84@mail.ru`) |
| product_id | `11c9f1b8` (Gorbova Club) |
| tariff_id | `7c748940` (BUSINESS) |
| paid_amount | 250.00 BYN |
| created_at | 2026-02-23 06:10:31 |
| meta.source | `admin_from_payment` |
| meta.deal_only | `true` |
| meta.payment_id | `e9e365de-bbb5-41c6-9061-263c83b4c71a` |
| meta.superseded_at | 2026-02-25 19:26 |
| meta.superseded_reason | `remap_cleanup_artifact` |
| meta.created_by | `05cd3754` (admin) |
| pipeline_stage_id | `b0000001-0001-0000-0000-000000000004` |

## Canonical order (куда фактически привязан платёж)

| Поле | Значение |
| ---- | -------- |
| id | `7e47007c-5141-4a3a-b98b-a0808262f553` |
| order_number | `ORD-LINK-1771826452478` |
| status | `paid` |
| user_id | `2c8ffa9e` (тот же volodik_84) |
| product_id | `11c9f1b8` (тот же Club) |
| tariff_id | `7c748940` (тот же BUSINESS) |
| created_at | 2026-02-23 06:00:52 (на 10 минут раньше дубля) |
| meta.type | `system_payment_link` |
| meta.bepaid_checkout_token | `c62ac98d…` |

## Платёж

| Поле | Значение |
| ---- | -------- |
| id | `e9e365de-bbb5-41c6-9061-263c83b4c71a` |
| order_id | **`7e47007c`** ✅ (на canonical, НЕ на дубль) |
| status | `succeeded` |
| amount | 250.00 BYN |
| created_at | 2026-02-23 11:53 |
| meta.bepaid_description | "Продление подписки" |

## Side-effects guard (по 5aa1c624)

| Источник | count | OK |
| -------- | ----- | -- |
| `payments_v2.order_id` = 5aa1c624 | 0 | ✅ |
| `subscriptions_v2.order_id` = 5aa1c624 | 0 | ✅ |
| `access_grant_ledger.order_id` = 5aa1c624 | 0 | ✅ |
| `access_grant_ledger.source_order_id` = 5aa1c624 | 0 | ✅ |
| `entitlements.meta.order_id / source_order_id` = 5aa1c624 | 0 | ✅ |
| `audit_logs.meta.order_id` = 5aa1c624 | 1 (admin.create_deal_from_payment) | ℹ️ остаётся как история, удалять не нужно |

## Природа кейса

1. 2026-02-23 06:00 — система создала `7e47007c` (canonical) под продление подписки.
2. 2026-02-23 11:53 — bePaid вернул успешный платёж `e9e365de`, привязан к `7e47007c`.
3. 2026-02-23 11:57 — админ через UI «Создать сделку из платежа» сделал дубль-сделку `5aa1c624`, не заметив, что платёж уже привязан.
4. 2026-02-25 19:26 — кто-то (или cleanup) пометил дубль `superseded_at` + `superseded_reason='remap_cleanup_artifact'` и status переведён в `canceled`.

Сейчас `5aa1c624` — это пустой админ-артефакт без денег, без подписки, без entitlements, без ledger. На него ссылается только 1 audit-запись о его собственном создании.

## Вердикт

Безопасен для удаления. Все guards = 0. Платёж и подписка живут на canonical `7e47007c`. Удаление ничего не разрывает.

## План Execute (после approve)

Single transaction:

1. `INSERT INTO public._orders_cohort_b_cleanup_2026_05_backup` снапшот строки.
2. `INSERT INTO audit_logs(action='orders.cohort_b_admin_duplicate_delete_2026_05', meta=jsonb_build_object('order_id','5aa1c624-b390-4fd5-af0d-0b849d40dd11','canonical_order_id','7e47007c-5141-4a3a-b98b-a0808262f553','payment_id','e9e365de-bbb5-41c6-9061-263c83b4c71a','snapshot', to_jsonb(o)))`.
3. `DELETE FROM orders_v2 WHERE id='5aa1c624-b390-4fd5-af0d-0b849d40dd11'`.
4. Guard: `backup=1 AND audit=1 AND deleted=1` иначе `RAISE EXCEPTION` → ROLLBACK.

## Post-Execute ожидание

- Cohort B: **43 → 42**, остаётся ровно 42 × `has_subscription_ref`.
- Платёж `e9e365de` остаётся на `7e47007c` (без изменений).
- Подписка пользователя `volodik_84@mail.ru` не затрагивается.

## DoD dry-run

- [x] Полный профиль `5aa1c624` и canonical `7e47007c`.
- [x] Все guards = 0.
- [x] Никаких мутаций.
- [x] Frozen id для Execute: `5aa1c624-b390-4fd5-af0d-0b849d40dd11`.

**Жду approve на Execute.**
