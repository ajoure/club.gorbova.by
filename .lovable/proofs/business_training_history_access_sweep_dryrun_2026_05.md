# BUSINESS training/history access sweep — DRY-RUN proof

**Snapshot:** `2026-05-18T12:14:00+00:00`  
**Режим:** READ-ONLY. 0 DML.

## 1. Scope

Когорта построена из:

- `orders_v2.status='paid'` по тарифам BUSINESS / ИДЕОЛОГИЯ / Бизнес-леди / Gorbova Club FULL;
- `subscriptions_v2` по тем же тарифам;
- `entitlements.meta.tariff_id` по тем же тарифам.

Scope tariff ids:

- `4fa8f5d3-e98a-4b26-bd70-9f79129b22dd` — Ценный бухгалтер | 1 ступень 2.0 | Модуль: ПВТ / Вид деятельности: ПВТ для тарифа Бизнес-леди
- `7c748940-dcad-4c7c-a92e-76a2344622d3` — Gorbova Club / BUSINESS
- `9bc81736-e7e5-48db-9925-b866427a98e1` — Ценный бухгалтер | 1 ступень 2.0 / Бизнес-леди
- `b018e9be-53ce-4840-8034-e09f8e319080` — Gorbova Club / ИДЕОЛОГИЯ
- `b276d8a5-8e5f-4876-9f99-36f818722d6c` — Gorbova Club / FULL


## 2. Matrix output

CSV: `/mnt/documents/business_training_history_expected_vs_actual_2026_05.csv`

Rows: **7066**  
Distinct users: **186**

| gap_class | count |
|---|---:|
| `ok_sql_history_present_ui_not_verified` | 2862 |
| `ok` | 2794 |
| `by_design_prior_purchase_not_met` | 831 |
| `ok_month_gate` | 476 |
| `sql_access_exists_but_ui_missing` | 63 |
| `access_end_mismatch` | 18 |
| `tariff_id_mismatch` | 8 |
| `missing_business_training_history_access` | 8 |
| `missing_primary_entitlement` | 4 |
| `module_entitlements_instead_of_full_access` | 2 |

## 3. Telegram sweep output

CSV: `/mnt/documents/telegram_revoke_reinvite_refresh_sweep_2026_05.csv`

Rows: **423**  
Distinct users: **212**

| gap_class | count |
|---|---:|
| `ok` | 229 |
| `telegram_membership_not_revoked_after_access_expired` | 185 |
| `invite_stale_awaiting_user_or_expired` | 4 |
| `telegram_link_missing` | 4 |
| `missing_telegram_access` | 1 |

## 4. Источники проблемы для F1/F2

- `data gap`: см. строки `missing_primary_entitlement`, `missing_business_training_history_access`, `module_entitlements_instead_of_full_access`.
- `access_rules gap`: см. `access_rules_missing_training_module_target`.
- `product_fulfillment gap`: таблица `product_fulfillment` в текущем окружении отсутствует; отдельный config patch возможен только после архитектурного approve.
- `resolver/UI gap`: строки `sql_access_exists_but_ui_missing` помечены `ui_not_verified`; перед UI patch нужен browser impersonation proof.
- `mixed`: если у пользователя одновременно есть SQL data gap и UI gap, приоритет execute: сначала data repair, потом UI verify.

## 5. Конкретные списки действий

Action CSV: `/mnt/documents/audit_business_ideology_fix_dryrun_rows.csv`

| gap_class | count |
|---|---:|
| `telegram_membership_not_revoked_after_access_expired` | 185 |
| `sql_access_exists_but_ui_missing` | 65 |
| `access_end_mismatch` | 20 |
| `tariff_id_mismatch` | 8 |
| `missing_business_training_history_access` | 8 |
| `missing_primary_entitlement` | 4 |
| `invite_stale_awaiting_user_or_expired` | 4 |
| `telegram_link_missing` | 4 |
| `module_entitlements_instead_of_full_access` | 2 |
| `missing_telegram_access` | 1 |

## 6. DoD

| критерий | статус |
|---|:---:|
| expected_access_matrix построена | ✅ |
| actual_access_matrix по entitlements/subscriptions/rules/useSidebarModules logic построена | ✅ |
| F1/F2 mandatory spot-check присутствуют | ✅ |
| F3 Telegram mandatory spot-check присутствует | ✅ |
| Global counts по BUSINESS/training/history и TG есть | ✅ |
| Execute не запускался | ✅ |
