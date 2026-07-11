# Preview / test environment setup — требования

Статус: DRAFT. Пока не выполнено — Gate A.1 v3.1a runtime, Gate A.2, Gate B patch/deploy/E2E BLOCKED.

## Цель

Отдельная Supabase environment, изолированная от production, для:
- применения миграции Gate A.1 v3.1a;
- deploy edge функций `public-rr-installment-initiate` и `rr-reconcile-order`;
- запуска mock RR endpoint;
- активации `RR_TEST_FAULT_MODE`;
- выполнения 18 SQL и 16 edge integration тестов;
- сбора runtime proof.

Production Supabase проект в этих операциях не участвует.

## 1. Отдельный Supabase project

Требования:
- новый Supabase project (не production);
- собственный `project_ref`, service-role key, JWT secret;
- заведён под workspace, где к production доступа нет либо доступ обособлен;
- backup/PITR — не обязателен (данные тестовые);
- никакого шаринга credentials с production.

**Service-role key НЕ передаётся в чат.** Он добавляется напрямую в защищённые Edge Function Secrets preview project и в secret store CI (если тесты запускаются из CI).

Артефакт: `preview_project_info.md` (только не-секретные данные — project_ref, URL, регион, дата создания).

## 2. Схема

- Применить полный набор production-миграций до Gate A.1 v3.1a (историю миграций скопировать).
- Применить `migration_gate_a1_v3_1a.sql`.
- Никаких копий боевых данных. Только фикстурные записи.

## 3. Test fixtures

- Создать изолированный `products_v2`, `tariffs`, `tariff_offers` с префиксом `TEST_` или UUID не совпадающими с боевыми.
- Пользователи — тестовые email `test+*@ex.by`, телефоны `+375000000xxx`.
- Никаких копий персональных данных клиентов.

## 4. Mock RR endpoint

Отдельный сервис (Deno/Node), развёрнутый под preview URL (например, `https://mock-rr.<preview>.local`), реализующий контракт из `mock_rr_ledger_contract.md`.
- Секрет активации сценариев `RR_MOCK_SCENARIO` — только в preview.
- Outbound связь mock ↔ реального РР запрещена (firewall/allowlist).

## 5. Edge functions

Deploy в preview:
- `public-rr-installment-initiate` (с fault-injection hook, `RR_TEST_FAULT_MODE` active);
- `rr-reconcile-order` (Gate A.2, verify_jwt=true).

Секреты preview:
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (preview);
- `RR_BASE_URL` = URL mock RR;
- `RR_TEST_FAULT_MODE` = имя сценария (пусто вне активного теста);
- `RR_LOGIN`, `RR_PASSWORD` (mock) — фикстура, никак не совпадает с боевыми.

## 6. Cleanup после теста

- Удалить `RR_TEST_FAULT_MODE` из preview secrets.
- Экспортировать ledger mock RR → `runtime_proof/mock_rr_ledger.json`.
- Дампнуть все затронутые `orders_v2` и `provider_events` в отчёт.
- Опционально TRUNCATE тестовые таблицы.

## 7. Доказательство отсутствия test hooks в production

CI-check (или разовый ручной аудит):
1. `grep -R "rr-test-fault-hook" <production_bundle>` = пусто → `fault_injection_absent_in_production.txt`.
2. `fetch_secrets` production project не содержит `RR_TEST_FAULT_MODE`, `RR_MOCK_SCENARIO`, `RR_BASE_URL=mock` → скриншот/лог.
3. Reverse-lookup `RR_BASE_URL` production ≠ preview mock URL.
4. `supabase/config.toml` production не содержит preview-specific overrides.

Артефакт: `production_no_test_hooks.md` со всеми четырьмя пунктами.

## 8. Secrets policy

- Service-role key preview — только в защищённых Edge Function Secrets preview и (опционально) CI secret store.
- Никогда не передаётся в чат, не логируется, не записывается в git.
- Ротация — по завершении Sprint B (после утверждения FINAL_REPORT_SPRINT_B) или при подозрении на утечку.

## 9. Условия старта Gate A.1 v3.1a runtime

Все пункты 1–7 выполнены и подтверждены артефактами. До этого:
- миграция v3.1a — только draft;
- SQL suite — не запускать;
- edge suite — не запускать;
- fault injection — не активировать;
- production writes — запрещены.

## 10. Ответственность

Создание preview project и добавление service-role key в защищённые secrets — задача владельца проекта (не агента). После этого агент выполняет: применение миграции v3.1a → SQL suite → edge deploy → edge suite → runtime proof.
