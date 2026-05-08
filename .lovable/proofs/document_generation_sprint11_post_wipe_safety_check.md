# Sprint 11 — Post-Wipe Safety Check (read-only)

Дата: 2026-05-08, после миграции `20260508134126_*` (foundation reset).

## 1. Counts ключевых таблиц

| Таблица | Count |
|---|---|
| orders_v2 | 3 359 |
| payments_v2 | 5 704 |
| subscriptions_v2 | 1 135 |
| entitlements | 923 |
| access_grant_ledger | 88 700 |
| products_v2 | 27 |
| tariffs | 42 |
| tariff_offers | 38 |
| profiles | 11 884 |
| telegram_access | 248 |
| telegram_club_members | 1 285 |
| access_rules | 46 |
| fields_registry | 209 (сохранены) |
| document_token_registry | 157 (сохранены, все с field_id) |
| document_templates | **0** (wipe ok) |
| document_template_versions | **0** (wipe ok) |
| ai_generated_documents | **0** (wipe ok) |
| generated_documents | **0** (wipe ok) |

Все коммерческие/доступные сущности целы. Документный слой пуст, как и ожидалось.

## 2. Audit за 4 часа (revoke/access/entitlement/telegram/expire)

| action | count |
|---|---|
| live_access_granted | 806 |
| telegram.autokick.admin_protected | 9 |
| telegram.cron_sync.batch | 8 |
| live_access_denied | 3 |
| bepaid.sync.access_chain_applied | 2 |
| bepaid.sync.entitlement_extended | 2 |
| grant-access-for-order.skip_blocked_stale_access | 1 |
| entitlement.tariff_id_persisted | 1 |
| telegram.pending_to_active | 1 |

Никаких массовых `revoke`/`expire`/`telegram.kick` всплесков. Это штатный фон.

## 3. Entitlements distribution

| status | count |
|---|---|
| active | 795 |
| expired | 126 |
| revoked | 2 |

Отвалов после wipe нет (revoked=2, исторические).

## 4. Edge functions intact

`ls supabase/functions` подтверждает наличие:
- `grant-access-for-order`
- `bepaid-webhook`
- `subscriptions-reconcile`
- `telegram-grant-access`
- `telegram-revoke-access`

Код этих функций wipe-миграцией не трогался.

## 5. Подтверждение

- ✅ Wipe затронул только document-domain (templates, versions, generated, sessions, drafts, package items, aliases).
- ✅ orders_v2 / payments_v2 / subscriptions_v2 / entitlements / access_rules / access_grant_ledger / products_v2 / tariffs / tariff_offers — intact.
- ✅ Массовых revoke/access incidents после wipe нет.
- ✅ `grant-access-for-order` и `bepaid-webhook` — на месте, не модифицированы.
- ✅ Email/Telegram/auto-generation flags не включались (изменений в `documents_*_enabled` нет).

**Вывод:** STOP-условий нет. Можно продолжать Sprint 11 Stage 3 (upload + preview + manual markup).
