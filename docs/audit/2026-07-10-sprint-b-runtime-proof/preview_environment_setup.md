# Preview / test environment — требования и статус

Статус: **NOT AVAILABLE**. Инфраструктурный блокер на стороне Lovable Cloud.

## Ответственность

Отдельный preview/test Supabase-проект — часть инфраструктуры Lovable Cloud (lovable.dev). У инженера-подрядчика, работающего внутри Lovable-агента:

- нет доступа к внутреннему Supabase management API Lovable;
- нет возможности создать новый Supabase-проект;
- нет возможности создать test environment для существующего проекта;
- нет возможности выпустить отдельный service-role key или JWT-секрет для preview;
- нет возможности добавить Edge Function Secrets в отдельную preview environment;
- нет возможности выдать URL preview-проекта.

Следовательно: **создание preview/test окружения — задача платформы Lovable либо владельца проекта, у которого есть административный доступ вне Lovable Cloud UI**. В отчётах агента этот пункт фиксируется как внешний блокер (R2 в `known_unresolved_risks.md`), а не как «ожидание действия заказчика».

Пока это окружение отсутствует:
- миграция v3.1a — только draft;
- SQL suite — не запускается;
- edge suite — не запускается;
- fault injection — не активируется;
- production writes — запрещены.

## Требования к окружению (когда оно будет доступно)

### 1. Изоляция проекта

- Отдельный Supabase project (не production), собственный `project_ref`, service-role key, JWT secret.
- Полная изоляция от боевых данных: никаких копий персональных данных, оплат, заказов.
- Никакого шаринга credentials с production.
- Service-role key preview **никогда** не передаётся в чат, не логируется, не пишется в git. Хранится только в защищённых Edge Function Secrets preview и (опционально) в secret store CI.
- Артефакт после создания: `preview_project_info.md` с не-секретными данными (project_ref, URL, регион, дата создания).

### 2. Версии платформы

Preview обязан быть совместим с production по мажорным версиям, иначе runtime-выводы неприменимы. До создания окружения фактические значения фиксируются в `preview_project_info.md`; сейчас они не собираются, чтобы не выполнять production-запросы вне необходимости.

Минимально требуется зафиксировать:

- **PostgreSQL major**: должна совпадать с production (например, `15.x` = `15.x`). Проверка: `SHOW server_version;` в обоих окружениях; вывод — в `preview_project_info.md` и `production_snapshot_before.txt`. При расхождении мажорной версии runtime-тесты не запускать.
- **Supabase platform / postgres image**: совпадение release-канала (stable / beta). Проверка: `select extversion from pg_extension where extname='supabase_vault';` + сравнение `pgsodium`, `pgjwt`, `pgcrypto`, `pg_net`, `pg_cron` (если используется), `pg_graphql`.
- **PostgREST / GoTrue / Storage / Realtime**: major-версии по возможности совпадают. При разных minor — допустимо, при разных major — только с явным анализом влияния.
- **Deno runtime edge**: одинаковая major-версия. Проверка: `Deno.version` в тестовой функции.

Все значения фиксируются в `preview_project_info.md` в момент создания окружения и повторно снимаются перед каждым запуском runtime suite (`runtime_proof/versions_snapshot.txt`).

### 3. Способ синхронизации схем production и preview

Единственный допустимый способ: **воспроизведение полной истории миграций через `supabase/migrations/`**.

Порядок:

1. На momenta создания preview: выполнить `supabase db push` / applied-history replay всех миграций из `supabase/migrations/`, отсортированных по timestamp'у в имени файла.
2. Проверить, что итоговый набор `pg_proc`, `pg_class`, `pg_policy` совпадает с production по всем `public.*` объектам, релевантным Sprint B (RR-функции, `orders_v2`, `provider_events`). Скрипт сравнения — `preview_vs_prod_schema_diff.sql` (собирается непосредственно перед запуском).
3. Только после совпадения — применить `migration_gate_a1_v3_1a.sql`.
4. Никаких «прямых» правок схемы preview руками. Всё через миграции в git.
5. Никакого копирования production данных. Только фикстуры (см. §4).

### 4. Test fixtures

- Изолированные строки в `products_v2`, `tariffs`, `tariff_offers`, `orders_v2` с префиксом `TEST_` в человекочитаемых полях либо с UUID, заведомо не совпадающими с боевыми.
- Пользователи — только тестовые email `test+*@ex.by`, телефоны `+375000000xxx`.
- Никаких копий персональных данных клиентов.

### 5. Mock RR endpoint

- Отдельный сервис (Deno/Node), реализующий контракт из `gate_a1_v3_1a/draft/mock_rr_ledger_contract.md`.
- Секрет активации сценариев `RR_MOCK_SCENARIO` — только в preview.
- Исходящая связь mock ↔ реального РР запрещена (firewall/allowlist).

### 6. Edge functions в preview

Deploy в preview:
- `public-rr-installment-initiate` с fault-injection hook (`RR_TEST_FAULT_MODE` активен только здесь);
- `rr-reconcile-order` (Gate A.2, `verify_jwt=true`).

Секреты preview:
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (preview) — только в защищённых Edge Function Secrets, не в чате;
- `RR_BASE_URL` = URL mock RR;
- `RR_TEST_FAULT_MODE` = имя активного сценария (пусто вне теста);
- `RR_LOGIN`, `RR_PASSWORD` (mock) — фикстура, не совпадает с боевыми.

### 7. Cleanup после теста

- Снять `RR_TEST_FAULT_MODE` из preview secrets.
- Экспортировать ledger mock RR → `runtime_proof/mock_rr_ledger.json`.
- Дамп затронутых `orders_v2` и `provider_events` в отчёт.
- Опционально `TRUNCATE` тестовых таблиц.

### 8. Доказательство отсутствия test hooks в production

Проверки для файла `production_no_test_hooks.md`:

1. `grep -R "rr-test-fault-hook" <production_bundle>` → пусто → `fault_injection_absent_in_production.txt`.
2. Список production Edge Function Secrets не содержит `RR_TEST_FAULT_MODE`, `RR_MOCK_SCENARIO`, `RR_BASE_URL=<mock URL>`.
3. Reverse-lookup: `RR_BASE_URL` production ≠ preview mock URL.
4. `supabase/config.toml` production не содержит preview-specific overrides.

### 9. Secrets policy

- Service-role key preview — только защищённые Edge Function Secrets preview и (опционально) CI secret store.
- Никогда не передаётся в чат, не логируется, не пишется в git.
- Ротация — по завершении Sprint B (после утверждения `FINAL_REPORT_SPRINT_B.md`) или при подозрении на утечку.

### 10. Условия старта Gate A.1 v3.1a runtime

Все пункты 1–8 выполнены и подтверждены артефактами (`preview_project_info.md`, `versions_snapshot.txt`, `preview_vs_prod_schema_diff.sql` output, `production_no_test_hooks.md`). До этого — только draft.

## Кто что делает при появлении окружения

- Платформа Lovable / владелец инфраструктуры: создаёт preview project, добавляет service-role key в защищённые Edge Function Secrets, подтверждает версии PostgreSQL / Supabase.
- Агент: применяет миграцию v3.1a → SQL suite → deploy edge → edge suite → собирает runtime proof по списку из `gate_a1_v3_1a/draft/runtime_proof_templates.md` (20 файлов).
