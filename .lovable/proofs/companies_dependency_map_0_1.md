# Proofs: Dependency map (RPC/edge/UI ↔ таблицы)

Дата: 2026-07-07. Собрано `rg` по `supabase/functions/**`, `supabase/migrations/**`, `src/**`.

## 1. Карта RPC / edge functions по целевым сущностям

### 1.1 `client_legal_details`

| Функция / RPC | Тип | Чтение | Запись | Вызывается | Риск при вводе `companies` | Действие |
|---|---|---|---|---|---|---|
| `canonical-document-generate-strict` | edge | да (реквизиты для документа) | нет | admin-payment-documents-resolve, UI «Сформировать документ» | документ должен продолжать работать с `client_legal_details` как SOT в compat-периоде | не трогать в Phase 1–5, feature-flag `documents.use_companies` в Phase 10 |
| `invoice-checkout-issue` | edge | да | нет | публичный чекаут | тот же compat-путь | не трогать |
| `document-auto-generate` | edge | да | нет | cron/hook | — | не трогать |
| `ai-generate-document`, `ai-generate-document-package`, `ai-generate-corporate-package` | edge | да | нет | admin UI | — | не трогать |
| `generate-invoice-act`, `generate-from-template`, `generate-document-pdf` | edge (legacy) | да | нет | deprecated | удаляются в отдельном backlog | вне скоупа |
| `_shared/typed-tokens-resolver`, `_shared/document-data-snapshot`, `_shared/packagePlaceholderCatalog`, `_shared/standard-fields`, `_shared/document-render` | shared | да | нет | все document-edge | добавить резолверы для `companies.*` — Phase 10 |
| UI: `useLegalDetails`, `useAiEntities`, `useEntityDuplicateCheck`, `LegalDetailsPickerDialog`, `PersonLinkedEntitiesBlock`, `lib/legal-details/fieldMap`, `lib/requisites-v2/fieldMap` | react hooks/components | да | **да (INSERT/UPDATE через ЛК)** | /profile/requisites | это основной writer client_legal_details | Phase 4: после INSERT/UPDATE звать `crm_company_upsert_from_legal_details` |
| миграции: `20260108223929`, `20260702132206`, `20260320171948`, `20260322141540`, `20260510154330`, `20260526210730` | SQL | — | schema | — | новые колонки `company_id nullable` в Phase 1 | — |

### 1.2 `legal_entities_requisites`

| Функция | Тип | Чтение | Запись | Риск |
|---|---|---|---|---|
| `document-field-resolver-v2`, `document-field-resolver-v2-snapshot`, `_shared/document-resolver-v2/{sources,resolver}` | edge / shared | да | нет | shadow-резолвер, ещё не боевой; в Phase 10 добавить companies-источник |
| `_shared/typed-tokens-resolver` | shared | да | нет | тот же путь |
| миграции: `20260510162228`, `20260511102941`, `20260510170316`, `20260510164919` | SQL | — | schema | — |

Writer в код-базе не найден для нового `legal_entities_requisites` — используется как view-layer поверх `client_legal_details` (`source_legacy_id`). Backfill в companies идёт через `client_legal_details` (см. §1.1).

### 1.3 `legal_details_persons` + `legal_details_entity_person_links`

| Функция | Чтение | Запись | Роль |
|---|---|---|---|
| `ai-generate-document`, `ai-generate-document-package`, `ai-generate-corporate-package` | да | нет | резолв «директор/подписант» для документов |
| `_shared/resolve-per-role-recipients`, `_shared/resolve-package-tokens`, `_shared/packagePlaceholderCatalog`, `_shared/docx-table-repeat-expand`, `_shared/ln-subfield-spec`, `_shared/packageFieldFormatter` | да | нет | per-role резолв |
| UI: `PersonLinkedEntitiesBlock`, `useAiEntities`, corporate драфт-сессии | да | **да** | Writer LDP/LEPL — из UI карточки реквизитов |

**Важно (см. `companies_discovery_0_1_sql.md` §2):** `LDP.profile_id` = владелец ЛК, а не сам подписант. При backfill в `company_contacts` — только `LDP.id → company_contacts.person_ref` + `company_id` из LEPL; `profile_id` резолвится отдельно matcher-ом или NULL.

### 1.4 `orders_v2`

Writer/reader-ов ≈ 60+ edge-функций (admin-*, bepaid-*, getcourse-*, canonical-document-*, direct-charge, subscription-*, split-multi-module-orders и т.д.). Список полный в migrations/functions выдаче.

| Кластер | Действие в Phase 1+ |
|---|---|
| `admin-*` reconcile/backfill | не трогать; после Phase 5 добавить фильтр по `company_id` только в UI-запросах |
| `bepaid-*`, `stripe-*`, `direct-charge`, `subscription-charge`, `subscription-actions`, `bepaid-webhook`, `payment-methods-webhook` | НЕ трогать; `orders_v2.company_id` заполняется backfill-ом и upsert-хуком из ЛК (Phase 5) |
| `canonical-document-*` | резолвит документ по `orders_v2.id`; в Phase 10 может брать `company_id` из заказа как fallback |
| `getcourse-grant-access`, `grant-access-for-order`, `telegram-grant-access` | **entitlements/access — НЕ трогать никогда**; company_id к access не привязывается |
| `create_preorder_deal_atomic` RPC | добавить necessary hook в Phase 5, но с feature-flag |

Правило: `orders_v2.company_id nullable`, никогда не является `NOT NULL`, никогда не блокирует создание/оплату/access.

### 1.5 `generated_documents` (legacy) и `ai_generated_documents` (canonical SOT)

| Функция | Тип | Действие |
|---|---|---|
| `canonical-document-generate-strict/generate/regenerate/send/payment-hook` | edge | Phase 10: добавить `context_type='company'` (сейчас `order/deal/profile`) |
| `admin-payment-documents-resolve` | edge | не трогать; работает через `order` context |
| `document-download` | edge | не трогать |
| `generate-invoice-act`, `send-invoice`, `generate-document-pdf` | legacy | вне скоупа (deprecated) |
| миграции: `20260626111224` (rls/columns) и др. | SQL | — |

### 1.6 `entitlements` / `access_grant_ledger` / `telegram_access*`

**НЕ ТРОГАТЬ никогда** — эти таблицы остаются на `profile_id`. Никаких `company_id` колонок, никаких RLS-изменений, никаких хуков. Правило зафиксировано во всех Phase 1–11.

Writer-ы (для аудита, что мы их не задеваем): `grant-access-for-order`, `access-rules-nightly-reconcile`, `telegram-grant-access/revoke-access/process-access-queue`, `subscriptions-reconcile`, `repair-module-entitlements`.

### 1.7 `crm_tasks` / `crm_activity_log`

| Функция | Действие |
|---|---|
| `crm-task-notify-worker`, `crm_task_apply_automation` RPC | не трогать; Phase 6 добавит `crm_tasks.company_id nullable` |
| `create_preorder_deal_atomic` → эмит `crm.task.*` events | не трогать |

`crm_activity_log` — только append; в Phase 6 добавляем новые типы событий `company.created/merged/linked`.

### 1.8 `calls` / `call_events` / `call_sync_queue`

| Функция | Действие |
|---|---|
| `vochi-call-initiate` edge | Phase 6: принимать `company_id` опционально |
| `calls`/`call_events` уже с `workspace_id` | Phase 6: добавить `company_id nullable` |
| UI: `src/components/admin/calls/CallButton.tsx` | Phase 6: пробрасывать `companyId` наравне с `contactId/dealId` |

### 1.9 Invoice / document flows (сводно)

Все document-flows перечислены в §1.1 и §1.5. Ключ: **compat-layer через `client_legal_details` остаётся SOT документов до Phase 10**. Никаких breaking-изменений в резолвере токенов до Phase 10.

## 2. Полная карта `profile_id` (семантика)

Легенда: **owner** = владелец ЛК-аккаунта; **contact** = CRM-контакт (физлицо); **subject** = субъект операции (клиент заказа/подписки/доступа); **holder** = держатель артефакта (карта, документ, тикет).

| Таблица | Семантика `profile_id` | `company_id` рядом? | Нельзя трогать |
|---|---|---|---|
| `access_grant_ledger` | subject доступа | **нет** — доступ только за физлицом | RLS, writer-ы |
| `ai_document_generation_batches` | owner инициатора | опционально да (Phase 10) | schema RLS |
| `ai_generated_documents` | subject/holder (кому документ) | да (Phase 10, context_type='company') | context_id/context_type invariants |
| `ban_cases` | subject | нет | — |
| `card_profile_links` | holder карты | нет | payment schema |
| `client_duplicates` | subject candidate | нет | dedup logic |
| `client_legal_details` | owner ЛК-карточки | да (Phase 4, `company_id nullable` + upsert-hook) | никогда не менять schema без compat-layer |
| `corporate_draft_sessions` | owner драфта | да (Phase 4) | — |
| `document_package_sessions` | owner сессии | да (Phase 10) | — |
| `document_package_templates` | owner шаблона | нет | — |
| `email_logs` | subject получателя | опц. (Phase 6+) | — |
| `email_threads` | contact | опц. | — |
| `entitlements` | **subject** доступа | **НЕТ, НИКОГДА** | всё |
| `generated_documents` (legacy) | subject | нет (legacy) | — |
| `instagram_contacts` | contact (после mapping) | нет | mapping logic |
| `legal_details_entity_person_links` | **owner** ЛК-карточки (не персона!) | да (Phase 2 backfill в company_contacts) | не путать с person_id |
| `legal_details_persons` | **owner** ЛК-карточки (не сам подписант!) — доказано SQL | да, но `company_contacts.profile_id` заполнять только через matcher | автоматический перенос запрещён |
| `marketing_insights` | subject/contact | опц. | — |
| `orders_v2` | subject покупателя | да (Phase 5, `company_id nullable`) | writer-ы платежей, access-hooks |
| `payments_v2` | subject плательщика | опц. (Phase 5+) | webhook writer-ы |
| `provider_subscriptions` | subject | нет | provider webhook |
| `site_form_submissions` | subject/contact (после dedupe) | опц. | — |
| `subscriptions_v2` | subject | нет (Phase 5+ обсуждаемо) | биллинг |
| `support_tickets` | subject/contact | опц. (Phase 7 UI) | ticket logic |
| `telegram_club_members` | subject доступа | **нет, никогда** | telegram access |
| `telegram_invite_links` | subject | **нет, никогда** | — |
| `trial_blocks` | subject доступа | нет | — |

**Ключевой invariant:** `company_id` НИКОГДА не добавляется в таблицы `entitlements`, `access_grant_ledger`, `telegram_*`, `trial_blocks`. Доступ = только за `profile_id`.

## 3. Safety-net sync — принятое решение

- **Основной путь:** RPC `crm_company_upsert_from_legal_details(p_legal_details_id uuid)` (Phase 2) вызывается синхронно из UI/edge после INSERT/UPDATE `client_legal_details`.
- **Safety-net:** новая таблица `company_sync_queue (id, legal_details_id, attempts, next_attempt_at, status, error)` обрабатывается воркером `company-sync-worker` по cron-tick. Alt: переиспользовать `notification_outbox` — решение фиксируется в Phase 1 плане с сравнением.
- **Запрещено (без отдельного technical spike):** trigger → `pg_net` → RPC. Записано как deferred (Master Plan Open Questions §11).

## 4. Список «нельзя трогать» (Freeze list)

1. `entitlements`, `access_grant_ledger` — schema, RLS, writer-ы.
2. `telegram_access`, `telegram_access_grants`, `telegram_access_queue`, `telegram_club_members`, `telegram_invite_links` — всё.
3. `payments_v2` writer-ы (bepaid/stripe webhooks) — schema и logic.
4. `orders_v2` writer-ы (кроме добавления nullable `company_id` в Phase 5 через ALTER + backfill).
5. `client_legal_details` schema до Phase 4 (добавление `company_id` — только в Phase 4, nullable, без backfill в Phase 1).
6. `profiles` — никаких `company_id`, никаких switch-полей.
7. `canonical-document-*` резолвер токенов до Phase 10.
8. `has_role_v2`, `user_roles_v2` — не переделываем под workspace до отдельного multi-workspace спринта.
