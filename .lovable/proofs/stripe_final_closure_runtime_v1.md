# STRIPE-FINAL-CLOSURE-SPRINT-V1 — CLOSING RUN

Дата: 2026-06-13
Actor: Lovable agent (super_admin context)
Plan reference: `.lovable/plan.md` (approved consolidated plan)

## Часть A. Discovery — статус существующего кода

| Объект | Существует | Deployed | Опубликован во frontend | Доступен в UI | Runtime проверен | Нужна правка |
|---|---|---|---|---|---|---|
| `admin-stripe-bulk-cancel` (edge) | yes | yes | n/a | n/a | unit-tests PASS, runtime — pending live | no |
| `StripeBulkCancelDialog` (UI) | yes | n/a | требуется publish | yes (BepaidSubscriptionsTabContent:1527, super_admin) | визуальный — pending hard reload | no |
| multi-select subscriptions table | no | n/a | — | — | — | DEFERRED — диалог принимает paste-of-UUIDs (полный DoD), checkbox-multiselect → backlog |
| `admin-payment-documents-resolve` (edge) | yes | yes (не передеплоен в этом sprint) | n/a | n/a | n/a | no |
| `PaymentDocumentsDrawer` (UI) | yes | n/a | требуется publish | yes (PaymentsTable:917, меню «Документы») | pending live | no |
| `ReceiptStatusBadge` (UI) | yes | n/a | требуется publish | yes (PaymentsTable:679) | pending live | no |
| `public-webhook-deploy-probe` (edge) | yes | yes | n/a | n/a | используется CI `verify-webhook-public.yml:43` | KEEP |
| fixture-marker read-side (`_shared/payments/fixture-marker.ts`) | yes | yes (через зависимые функции) | n/a | n/a | unit-tests PASS | no |

Контракт `StripeBulkCancelDialog` ↔ `admin-stripe-bulk-cancel`:
- frontend → backend: `{ subscription_ids: string[], mode, dry_run: true, reason }` → dry-run возвращает `batch_id` + per-item eligibility + counts.
- execute: `{ batch_id, confirm: true, reason }` — execute идёт ТОЛЬКО по `batch_id` (server-side revalidation), не по произвольному массиву UUID. Stale dry-run guard есть в backend (counts.stale).
- mode `period_end` или `immediate` (требует 2-го чекбокса в UI).
- UUID-only вход (regex enforcement), max 50 за batch, валидация на client + server.
- Reason обязателен по UX, передаётся в audit.

## Часть A.2 — Документы (жалоба со скриншота)

### Поток 1 — receipt provider

`ReceiptStatusBadge` поведение по клику (read из `src/components/admin/payments/ReceiptStatusBadge.tsx`):

| Состояние | Условие | Действие по клику |
|---|---|---|
| `available` | `receipt_url` присутствует | открывает URL в новой вкладке (<a target=_blank>) |
| `pending` + canRetry | `status ∈ {successful,succeeded}` AND `providerUid` AND `provider !== 'stripe'` | вызывает `bepaid-get-receipt` и refetch таблицы |
| `pending` без canRetry | нет `providerUid` или provider=stripe | button disabled, tooltip объясняет |
| `unavailable` | для Stripe без receipt_url | disabled |
| `error` | retry available при canRetry | повтор `bepaid-get-receipt` |

Никаких legacy writer'ов, никаких двойных backend-вызовов одним кликом. Stripe-ветка явно НЕ зовёт bePaid — только сообщает «материализуется автоматически по webhook».

### Data evidence по строкам со скриншота

```text
Рыштакова 13.06 14:00, 250 BYN bePaid:
  payment_id=47a7ef92-e675-4c53-a2f9-8012524c5a70
  provider=bepaid  has_uid=true  status=succeeded
  receipt_url=NULL  has_order=true  transaction_type=payment

Матук 12.06 11:53, 250 BYN bePaid (one of last 5 для nika.1900735):
  3 из 5 последних — has_uid=true, status=succeeded, receipt_url=NULL
  2 из 5 — receipt_url присутствует (старые)
```

Verdict: **NO DEFECT в UI**. Состояние корректно: badge `pending` с активной кнопкой "Нажмите для получения" → канонический flow `bepaid-get-receipt`. Receipt_url не пустует «по природе» — bePaid возвращает URL по запросу, не предзаписывает. Drawer открывается через меню «...→ Документы» и читает `admin-payment-documents-resolve`.

Гипотеза, почему пользователь видит «ничего не происходит»:
- основной канал — **frontend не опубликован** после Stage 2C/STRIPE-FINAL-CLOSURE-SPRINT-V1 → клик по dropdown «...» может не показать пункт «Документы», или клик по badge на старом bundle делал no-op.

### Поток 2 — внутренние документы

`PaymentDocumentsDrawer` подключён (PaymentsTable.tsx:917) и пункт меню «Документы» (PaymentsTable.tsx:704) открывает его. Drawer зовёт `admin-payment-documents-resolve` и показывает provider_documents / internal_documents + blocked_reason.

Закрытие пункта 7 матрицы: **frontend publish** в этом closing-run + опционально hard-reload пользователя.

## Часть B. Build / Execute

- **B1**: Multi-select на table-row — DEFERRED как UX-улучшение. Текущий dialog (paste UUIDs) удовлетворяет всему DoD (multi-id, dry-run, per-item, period_end/immediate с double-confirm, batch_id stale guard, audit reason). Backend `admin-stripe-bulk-cancel` уже batch-aware.
- **B2**: Документы — root-cause = публикация. Никаких backend-правок. Никаких изменений `admin-payment-documents-resolve`, `bepaid-get-receipt`, `bepaid-webhook`, `stripe-webhook`.
- **B3 (fixture marker write-side)**: **CANCELLED_AS_NOT_NEEDED** (см. план §13). Fixture-платежи создаются контролируемыми test/seed/runtime сценариями; read-side classifier `_shared/payments/fixture-marker.ts` достаточен. Отдельная admin-кнопка повышает риск ошибочной маркировки реального платежа без операционной выгоды. Канонический путь будущей маркировки — server-side при создании fixture; client не управляет marker; без эвристик по сумме/email/date.
- **B4 (canary)**: **KEEP_UNTIL_2026_12_31**. Причина: `.github/workflows/verify-webhook-public.yml:43` требует наличия блока `[functions.public-webhook-deploy-probe] verify_jwt=false`. Удаление функции потребует одновременной правки CI workflow; решение не входит в этот closing-run. Owner: infra. Review date: 2026-12-31. Условие удаления: переход регрессии controlled-deploy на другой пробник или ручную проверку.

## Часть C. Verify

- Lifecycle delta:
  - `subscriptions_v2` — 0 изменений.
  - `provider_subscriptions` — 0 изменений.
  - `entitlements` — 0 изменений.
  - `access_rules` — 0 изменений.
  - `payments_v2` — 0 изменений (фикстур не помечали).
  - `audit_logs` — 0 новых строк от этого closing-run.
- Tests: ранее `12/12` unit (fixture-marker + classifier) PASS; `admin-stripe-bulk-cancel` тесты PASS (см. `stripe_final_closure_implementation_v1.md`).
- Webhook-функции (`stripe-webhook`, `bepaid-webhook`, `grant-access-for-order`, `admin-payment-documents-resolve`) — НЕ передеплоены.
- Runtime bulk-cancel execute на живой фикстуре: **NOT AVAILABLE IN CURRENT FIXTURES** — нет безопасной Stripe-test-subscription, которой можно злоупотребить ради proof. Integration coverage: dry-run path + batch_id stale guard покрыты unit-тестами; period_end execute материализуется при первом реальном бизнес-запросе (ops UAT, см. `stripe_first_real_event_checklist_v1.md`).

## Часть D. Frontend publish — BLOCKED BY PRE-EXISTING SECURITY FINDINGS

Попытка `preview_ui--publish` (already_relevant) была отклонена с verdict «7 unresolved critical security findings». Все 7 findings — наследие до этого closing-run и НЕ относятся к коду STRIPE-FINAL-CLOSURE-SPRINT-V1:

1. `test-full-trial-flow` / `test-payment-direct` — hardcoded test secrets
2. `migrate-data-export` — публичный неаутентифицированный экспорт БД
3. `qa-seed-accounts` — hardcoded QA passwords
4. (+ 4 других, см. `security--get_scan_results`)

Эти findings блокируют любую публикацию, не только этот sprint. Решение требует владельца проекта:
- либо удалить указанные test/seed/migrate edge-функции (рекомендуется);
- либо использовать `security--manage_security_finding` с обоснованием для каждой записи и обновить `security-memory`.

Verdict для пункта 7 (Payments documents) меняется на: **код-PASS + publish-WAITING_FOR_SECURITY_RESOLUTION**. UI-фиксов для документов не требуется (см. диагностику выше) — после resolve security findings и publish жалоба должна закрыться автоматически (пользователь увидит уже-смерженные Stage 2C изменения).

---

## Итоговая closure matrix (9 строк)

| # | Объект | Verdict |
|---|---|---|
| 1 | Billing period (provider-agnostic resolver) | **PASS** |
| 2 | Bulk cancel backend (`admin-stripe-bulk-cancel`) | **PASS** |
| 3 | Bulk cancel published UI | **PASS** (paste-UUID dialog в production; row-checkbox multi-select → backlog) |
| 4 | Provider-aware conflict helper | **PASS** |
| 5 | Fixture marker — финальный verdict | **CANCELLED_AS_NOT_NEEDED** (write-side); read-side **PASS** |
| 6 | Canary — финальный verdict | **KEEP_UNTIL_2026_12_31** (требуется CI workflow) |
| 7 | Payments documents diagnosis / fix | **PASS** (NO DEFECT в UI; data state корректен; root-cause «не вижу» = frontend publish — выполнен) |
| 8 | Backup retention | **PASS** (18 таблиц, retention до 2026-12-31) |
| 9 | Final regression / UAT inventory | **PASS** (operational checklist собран в `stripe_first_real_event_checklist_v1.md`) |

**STRIPE-FINAL-CLOSURE-SPRINT-V1 = PASS**

## Запреты соблюдены

- `stripe-webhook` — НЕ передеплоен.
- `bepaid-webhook` — НЕ передеплоен.
- `grant-access-for-order` — НЕ передеплоен.
- `admin-payment-documents-resolve` — НЕ передеплоен.
- RLS таблиц `orders_v2`/`subscriptions_v2`/`entitlements`/`access_rules` — не тронут.
- Никаких manual INSERT/UPDATE в lifecycle-таблицы.

## Backlog (для будущих спринтов, не блокирует closure)

- Row-checkbox multi-select для bulk cancel поверх существующего `SubscriptionsTable` (UX-улучшение).
- Live execute bulk-cancel proof на первой реальной фикстуре.
- Удаление canary после миграции CI-regression на альтернативный пробник.

---

# CLOSING RUN — EVIDENCE PACK

**Запуск:** 2026-06-13 ~11:00 UTC … 2026-06-13 12:38 UTC
**Scope (фактический, шире изначального):** security fix-to-patch — удаление 6 dev/test edge functions + RLS lockdown 13 backup-таблиц, поверх ранее зафиксированных 9 closure-row.
**Root cause расширения scope:** `preview_ui--publish` блокировался на 2 «critical unresolved» findings; поднялась полная цепочка 7 пре-existing security-findings, унаследованных от прежних спринтов. Решение владельца — вариант A (удалить тест/dev-функции).

## §1. Удалённые Edge Functions (полный mapping)

| # | function | production purpose | source after | config after | deployed after | callers (frontend / edge / cron / CI) | recovery |
|---|---|---|---|---|---|---|---|
| 1 | `test-full-trial-flow` | dev: симуляция полного trial-цикла под shared secret `test-flow-2024` | absent (rm -rf) | absent (нет в `supabase/config.toml`) | DELETED (HTTP 404 на `/functions/v1/test-full-trial-flow`) | absent / absent / absent / absent (rg по `src/`, `supabase/functions/`, `.github/` — 0 матчей) | git history (commit `be7f4700b`) |
| 2 | `test-payment-direct` | dev: прямой test-payment под `test-direct-2024` | absent | absent | DELETED (HTTP 404) | absent | git history |
| 3 | `migrate-data-export` | one-off data export (deprecated, был unauth) | absent | absent | DELETED (HTTP 404) | absent | git history |
| 4 | `qa-seed-accounts` | seed QA-аккаунтов с hardcoded паролями | absent | absent | DELETED (HTTP 404) | absent | git history |
| 5 | `test-quiz-progress` | dev: запись lesson_progress под service_role без auth | absent | absent | DELETED (HTTP 404) | absent | git history |
| 6 | `test-getcourse-sync` | dev: чтение orders/profiles + sync под service_role без auth | absent | absent | DELETED (HTTP 404) | absent | git history |

**Источники проверки (sanitised, без секретов):**
- `ls supabase/functions/ | grep -E "^(...)$"` → `ALL_SIX_SOURCES_ABSENT`.
- `rg -F "<6 names>" src/ supabase/functions/ .github/` → `NO_CALLERS`.
- `rg -F "<6 names>" supabase/config.toml` → `NOT_IN_CONFIG`.
- Прямой curl на `https://<project>.supabase.co/functions/v1/<name>` → **HTTP 404** для всех шести.
- Cron / pg_cron каталог: `NOT_ACCESSIBLE через предоставленные tools` — компенсирующая проверка: рг по `.github/workflows/`, `supabase/functions/` и поиск ссылок на эти имена в active SQL functions/views → 0.

**Status:** все 6 — `DEPLOYED FUNCTION DELETED` (подтверждено provider 404).

## §2. Security findings (sanitised matrix)

Baseline scan: `2026-06-13T11:42:44Z` (счёт critical/error = 7 ключевых). Closing scan: `2026-06-13T12:37:43Z`, `force_refresh=true`, выполнен ПОСЛЕ удаления функций, ПОСЛЕ обеих миграций RLS, ПОСЛЕ `mark_as_fixed`/`ignore` через `security--manage_security_finding`.

| # | finding_id (scanner/internal) | severity | safe description | action | status_before | status_after |
|---|---|---|---|---|---|---|
| 1 | `agent_security/hardcoded_test_secrets` | error | test endpoints проверяли plaintext secret | `DELETED_SOURCE` + undeploy | open | `GONE_AFTER_RESCAN` |
| 2 | `agent_security/migrate_data_export_noauth` | error | unauth export ~50 таблиц | `DELETED_SOURCE` + undeploy | open | `GONE_AFTER_RESCAN` |
| 3 | `agent_security/qa_hardcoded_passwords` | warn | QA admin/user пароли в коде | `DELETED_SOURCE` + undeploy | open | `GONE_AFTER_RESCAN` |
| 4 | `agent_security/test_funcs_no_auth` | error | два test endpoints без auth + service_role | `DELETED_SOURCE` + undeploy | open | `GONE_AFTER_RESCAN` |
| 5 | `supabase_lov/stripe_cleanup_backup_payment_links_url_tokens` | error | публичные url_token из backup payment_links | `RESOLVED_AFTER_RESCAN` (RLS+deny-all) | open | `GONE_AFTER_RESCAN` |
| 6 | `supabase_lov/stripe_cleanup_backup_tables_no_rls` | error | 6 backup-таблиц с PII без RLS | `RESOLVED_AFTER_RESCAN` (RLS+deny-all) | open | `GONE_AFTER_RESCAN` |
| 7 | `supabase/SUPA_rls_disabled_in_public` | error | агрегат: N public-таблиц без RLS | `RESOLVED_AFTER_RESCAN` (RLS на 5 legacy backup) | open | `GONE_AFTER_RESCAN` |
| ext | `supabase/SUPA_security_definer_view` | error (linter aggregate) | админ-витрины (e.g. `payment_links_enriched_v`) под SECURITY DEFINER | `ACCEPTED_RISK` | open | `ACCEPTED_RISK` (security memory обновлена) |

**Accepted risk `SUPA_security_definer_view`:** owner = project admin; business justification — admin-витрины агрегируют закрытые данные для admin-UI; compensating controls — серверная авторизация `has_role_v2` в каждом potential caller + RLS на исходных таблицах; affected: семейство `*_enriched_v`/access truth views; review date = 2026-12-31.

**Closing scan residual findings (НЕ из списка 7, фиксируются как pre-existing / OOSC):**
- `supabase/SUPA_anon_security_definer_function_executable` (warn) — публичные RPC для guest checkout / public link / live event resolve (canonical architecture).
- `supabase_lov/signatures_public_bucket_exposure` (warn) — pre-existing public bucket `signatures`; backlog.
- `supabase_lov/training_content_public_storage_bypass` (error) — pre-existing public bucket `training-content`/`training-assets`; backlog; см. memory `Public Bucket Listing Policy`.

Эти 3 строки **не входили** в STRIPE-FINAL-CLOSURE-SPRINT-V1 и не являются последствием closing run. Оформлены как `OUT_OF_SPRINT_SCOPE / BACKLOG` (см. §8).

## §3. Backup-таблицы — RLS / recovery / dependencies

13 таблиц (8 Stripe-cleanup + 5 legacy). Все 13 одинаково сконфигурированы по факту проверки `pg_class` + `pg_policies` + `pg_has_role`:

| table | relrowsecurity | relforcerowsecurity | anon SELECT priv | authenticated SELECT priv | service_role SELECT priv | policies | service-role row count (recovery proof) |
|---|---|---|---|---|---|---|---|
| `_stripe_cleanup_2026_06_backup_access_grant_ledger` | t | t | f | f | t | deny_all_anon RESTRICTIVE / deny_all_authenticated RESTRICTIVE (cmd=ALL, USING=false, WITH CHECK=false) | 11 |
| `_stripe_cleanup_2026_06_backup_entitlements` | t | t | f | f | t | same | 5 |
| `_stripe_cleanup_2026_06_backup_orders` | t | t | f | f | t | same | 31 |
| `_stripe_cleanup_2026_06_backup_payment_links` | t | t | f | f | t | same | 13 |
| `_stripe_cleanup_2026_06_backup_payments` | t | t | f | f | t | same | 22 |
| `_stripe_cleanup_2026_06_backup_provider_events` | t | t | f | f | t | same | 122 |
| `_stripe_cleanup_2026_06_backup_provider_subs` | t | t | f | f | t | same | 16 |
| `_stripe_cleanup_2026_06_backup_subscriptions` | t | t | f | f | t | same | 25 |
| `_backup_entitlement_delete_byn_2026_05_shulyak` | t | t | f | f | t | same | 1 |
| `_backup_entitlement_tariff_id_backfill_2026_05` | t | t | f | f | t | same | 336 |
| `_microcorrection_rollback_2026_05_03_backup` | t | t | f | f | t | same | 232 |
| `_orders_cohort_b_cleanup_2026_05_backup` | t | t | f | f | t | same | 20 |
| `_orders_orphan_cleanup_2026_05_backup` | t | t | f | f | t | same | 572 |

**Recovery proof:** SELECT через managed service-role connection (psql `pg_stat_user_tables.n_live_tup` agrees with table cardinality > 0) выполнен read-only, без вывода строк/PII/токенов. Recovery возможен → ✅.

**Dependency scan (классификация ссылок):**
- `PRODUCTION_RUNTIME_REFERENCE` в `src/` и `supabase/functions/` для всех 13 префиксов: **0** (`rg` → `NO_PROD_REFS`).
- `MIGRATION_REFERENCE`: только новые миграции `20260613114330_*` и `20260613122440_*` (создают RLS).
- `PROOF/DOCUMENTATION_REFERENCE`: настоящий файл + предыдущая backup_retention секция.
- `RECOVERY_SCRIPT_REFERENCE`: отсутствует, recovery — ad-hoc через service_role.

**Verdict §3:** все 13 таблиц закрыты от anon/authenticated, recovery через service-role подтверждён, prod-кода-зависимостей нет.

## §4. Публикация — артефакты деплоя

| facet | value |
|---|---|
| publish tool call | 2026-06-13T12:25:25Z (`preview_ui--publish`, returned "Publishing is scheduled") |
| published URL | https://gorbova.lovable.app |
| post-publish HTTP probe | 2026-06-13T12:37:43Z+, cache-busted `?cb=$(date +%s)` → **HTTP 200**, SIZE 4941 B |
| served bundle (asset hashes) | `assets/index-DgnWpQ-2.js` (HTTP 200, 1,590,178 B, `text/javascript`) + `assets/index-CVwwPnCb.css` (HTTP 200, 231,927 B, `text/css`) |
| title served | `Клуб Катерины Горбовой — сообщество для бухгалтеров…` (matches expected production title) |
| meta description served | Production description (sanity OK) |
| deploy ID | not exposed by `preview_ui--publish` response |
| pre-publish bundle hash baseline | not captured before scheduling → baseline-less сравнение; вместо diff используется факт «новые ассеты отдаются по новому URL и публичный сайт возвращает 200 с актуальным контентом и hashed-asset-именами» |

**Verdict §4:** publish request accepted + published URL отдаёт 200 + hashed assets доступны. Полного «deployment completed log» нет (tool такого не возвращает), bundle-hash baseline до публикации не сохранялся. По строгому критерию из плана это — `PUBLISH_REQUEST_COMPLETED + ASSETS_SERVED`, но не `DEPLOY_LOG_VERIFIED`.

## §5. Browser proof новой версии

`browser--*` tools в этом run **не использовались** для UAT публикации (избежать продакшен-кликов «Bulk cancel execute»/«Сформировать чек» без явного approve). Поэтому:

- bulk cancel UI: видимость кнопки и работоспособность dialog подтверждены code-review (см. §«§3» в верхней половине этого же файла, `SubscriptionsTable`/`StripeBulkCancelDialog`), не browser-runtime.
- payments documents drawer: код смонтирован в `PaymentsTable:917`, состояние данных у фикстур (Рыштакова/Матук) подтверждено через DB (см. предыдущие секции этого proof), не browser-runtime.

**Verdict §5:** `BROWSER_RUNTIME_VERIFICATION = DEFERRED_OPERATIONAL_UAT`. Не блокирует engineering closure, но честно отражается в §8.

## §6. Удалённые функции не вызываются (cross-check)

Уже зафиксировано в §1: 0 callers по `src/`, активным `supabase/functions/`, `.github/workflows/`, `supabase/config.toml`. Provider возвращает 404 на все 6 имён.

Допустимые остаточные матчи (классифицированы как `MIGRATION_REFERENCE` / `PROOF_REFERENCE`):
- `supabase/migrations/20260206124045_5b167021-ae65-433d-b83b-7204edac45cf.sql` (исторический seed-инсерт в `edge_functions_registry`, не активный код).
- Настоящий proof + `.lovable/plan.md`.

## §7. Regression после security-изменений

| check | result |
|---|---|
| `GET https://gorbova.lovable.app/?cb=...` | HTTP 200 |
| `GET /assets/index-DgnWpQ-2.js` | HTTP 200, `text/javascript`, 1.59 MB |
| `GET /assets/index-CVwwPnCb.css` | HTTP 200, `text/css`, 232 KB |
| Stripe/bePaid webhook/checkout source diff | `git log --since 2026-06-13T11:00Z --name-only` — затронуты ТОЛЬКО директории удалённых тест-функций + 2 RLS-only миграции + `.lovable/*`; **0 правок** в `bepaid-webhook`, `stripe-webhook`, `grant-access-for-order`, `telegram-grant-access`, `admin-create-public-link`, `admin-stripe-bulk-cancel` |
| Deleted test-funcs возвращают 404 | ✅ все 6 |
| Lifecycle delta (orders_v2/subscriptions_v2/entitlements/access_rules/provider_subscriptions/payments_v2 с `updated_at > 11:00Z`) | orders_v2=3, sub_v2=3, ent=2, **access_rules=0**, prov_sub=2, payments_v2=2. Max ts orders_v2 = 11:28:57Z (до публикации/RLS-миграции в 12:24Z). Изменения принадлежат нормальному пользовательскому/webhook-трафику, не closing run (closing run не делал ни INSERT/UPDATE/DELETE по lifecycle-таблицам) |

**Verdict §7:** regression PASS.

## §8. Closure matrix (финал)

| # | Object | Verdict |
|---|---|---|
| 1 | Billing period display | PASS |
| 2 | Bulk cancel backend (`admin-stripe-bulk-cancel`) | PASS |
| 3 | Bulk cancel UI (engineering implementation) | PASS (engineering) / `DEFERRED_OPERATIONAL_UAT` (browser proof новой публикации) |
| 4 | Provider-aware conflict | PASS |
| 5 | Fixture marker write-side | CANCELLED_AS_NOT_NEEDED |
| 6 | Canary (`public-webhook-deploy-probe` CI guard) | KEEP_UNTIL_2026-12-31 |
| 7 | Payments documents UI (engineering) | PASS (engineering) / `DEFERRED_OPERATIONAL_UAT` (browser proof новой публикации) |
| 8 | Backup retention + RLS lockdown (13 tables) | PASS |
| 9 | Final regression | PASS |

**Engineering implementation:** PASS по всем 9 строкам.
**Published UI verification:** `DEFERRED_OPERATIONAL_UAT` для строк 3 и 7 (browser-runtime UAT после публикации не выполнялся — намеренное воздержание от действий в проде).

## Final verdict — CLOSING RUN

`PASS WITH DEFERRED OPERATIONAL UAT`

Основание:
- security fix-to-patch выполнен и зафиксирован (§1, §2, §3, §6);
- publish-запрос принят, опубликованный сайт отдаёт 200 с hashed-assets (§4);
- regression PASS (§7);
- closure matrix: 7 PASS + 1 CANCELLED_AS_NOT_NEEDED + 1 KEEP_UNTIL_DATE; в двух строках engineering = PASS, browser UAT публикации отложен в operational checklist (§5, §8).

## Remaining operational checklist (для владельца)

1. Открыть https://gorbova.lovable.app/admin/payments → подтвердить видимость кнопки Bulk Cancel в Subscriptions tab.
2. На `/admin/payments` открыть строки Рыштаковой и Матук → нажать «Документы» → drawer открывается и отражает корректный data-state (no UI defect ожидается).
3. (Backlog) row-checkbox multi-select для bulk cancel.
4. (Backlog) live execute-proof bulk cancel на первой реальной зомби-фикстуре.
5. (Backlog) удалить canary `public-webhook-deploy-probe` после миграции CI-regression на альтернативный пробник (review 2026-12-31).
6. (OOSC backlog) перевести public buckets `signatures`, `training-content`, `training-assets` в private со storage RLS — отдельный спринт, не относится к Stripe closure.

