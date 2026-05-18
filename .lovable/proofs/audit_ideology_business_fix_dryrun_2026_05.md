# PATCH-AUDIT-BUSINESS-IDEOLOGY-FIX-2026-05 — DRY-RUN proof

**Snapshot:** `2026-05-18T12:14:00+00:00`  
**Режим:** READ-ONLY dry-run. Execute не запускался.

## 1. Что выполнено

- Перечитан `docs/ENGINEERING_RULES.md` и утверждённый `.lovable/plan.md`.
- Проверены существующие таблицы/RPC/цепочки: `orders_v2`, `subscriptions_v2`, `entitlements`, `access_rules`, `training_modules`, `module_access`, `telegram_club_members`, `telegram_access_queue`, `telegram_invite_links`, `grant-access-for-order`, `useSidebarModules`, `_shared/access-resolver.ts`.
- Собран dry-run по Blocks A/B/C/D + обязательные F1/F2/F3 + Block E + E.Telegram.
- БД не менялась: выполнялись только SELECT/COPY.

## 2. Артефакты

1. `.lovable/proofs/audit_ideology_business_fix_dryrun_2026_05.md`
2. `.lovable/proofs/business_training_history_access_sweep_dryrun_2026_05.md`
3. `/mnt/documents/audit_business_ideology_fix_dryrun_rows.csv`
4. `/mnt/documents/business_training_history_expected_vs_actual_2026_05.csv`
5. `/mnt/documents/telegram_revoke_reinvite_refresh_sweep_2026_05.csv`

Предыдущие audit artifacts, требуемые DoD:

1. `.lovable/proofs/audit_ideology_business_access_2026_05.md`
2. `/mnt/documents/audit_ideology_business_users.csv`
3. `/mnt/documents/audit_ideology_business_missing_bonus.csv`
4. `/mnt/documents/audit_ideology_business_bonus_full.csv`

## 3. Summary по action rows

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

## 4. Mandatory fixtures F1/F2/F3

### F1

| email | case_status | gap_class | severity | planned_action | notes |
|---|---|---|---|---|---|
| `katrinkap777@rambler.ru` | `confirmed_sql` | `access_end_mismatch` | `medium` | `data_repair_canonical_grant` | mandatory fixture from screenshots; SQL data gap part |
| `katrinkap777@rambler.ru` | `ui_not_verified` | `sql_access_exists_but_ui_missing` | `high` | `ui_resolver_patch_needed` | mandatory fixture: screenshot indicates missing visibility; source_problem=mixed |

### F2

| email | case_status | gap_class | severity | planned_action | notes |
|---|---|---|---|---|---|
| `alena.gudvilovich@bk.ru` | `confirmed_sql` | `access_end_mismatch` | `medium` | `data_repair_canonical_grant` | mandatory fixture from screenshots; SQL data gap part |
| `alena.gudvilovich@bk.ru` | `ui_not_verified` | `sql_access_exists_but_ui_missing` | `high` | `ui_resolver_patch_needed` | mandatory fixture: screenshot indicates missing visibility; source_problem=mixed |

### F3

| email | case_status | gap_class | severity | planned_action | notes |
|---|---|---|---|---|---|
| `tkoffise@gmail.com` | `confirmed_bug` | `telegram_membership_not_revoked_after_access_expired` | `critical` | `telegram_revoke_needed_via_canonical_queue` | platform_access_absent_or_expired_but_member_is_in_chat_or_ok |
| `tkoffise@gmail.com` | `confirmed_bug` | `telegram_membership_not_revoked_after_access_expired` | `critical` | `telegram_revoke_needed_via_canonical_queue` | platform_access_absent_or_expired_but_member_is_in_chat_or_ok |

## 5. Recommended execution order

1. **First:** Telegram revoke queue — только строки `telegram_membership_not_revoked_after_access_expired` через canonical queue, без прямого Telegram API.
2. **Second:** Telegram reinvite queue — только после revoke-wave и dedupe pending/processing за 24 часа.
3. **Third:** `grant-access-for-order` repairs — primary/bonus/data repair, по одному блоку с verify между блоками.
4. **Fourth:** config/access_rules/product_fulfillment patches — только если gap доказан как config gap; `product_fulfillment` table в текущем окружении отсутствует.
5. **Fifth:** UI/resolver patches — только после browser impersonation proof для `sql_access_exists_but_ui_missing`.

## 6. STOP-guards для execute

- Execute сейчас **не запускался**.
- Запрещены ручной DML в `entitlements`/`subscriptions_v2`/`access_rules`/`telegram_club_members`.
- Запрещены прямой Telegram API, provider API, secrets/mode changes.
- Любой future execute только отдельным approve и через canonical paths: `grant-access-for-order` или `telegram_access_queue` с разрешённым `meta.source`.
- Перед grant: tariff match, paid order, refund guard, DNA guard, no duplicate active entitlement.
- Перед Telegram: active/expired platform access re-check, pending queue dedupe, no double-reinvite за 24h.

## 7. Read-only verification

Rowcount после dry-run:

| table | rows |
|---|---:|
| `access_rules` | 47 |
| `entitlements` | 932 |
| `orders_v2` | 3477 |
| `subscriptions_v2` | 1164 |
| `telegram_access_queue` | 800 |
| `telegram_club_members` | 1285 |


## 8. DoD dry-run

| критерий | статус |
|---|:---:|
| F1/F2/F3 попали в итоговый CSV | ✅ |
| F1/F2 имеют gap_class + planned_action | ✅ |
| F3 проверен по `in_chat`, `in_channel`, `access_status`, `last_verified_at`, queue/invite history | ✅ |
| Global BUSINESS/history/training matrix построена | ✅ |
| Telegram revoke/reinvite/refresh sweep построен | ✅ |
| Списки planned_action сформированы | ✅ |
| Все артефакты указаны путями | ✅ |
| 0 DML / 0 Telegram API / 0 provider API | ✅ |
| Execute не запускался | ✅ |
