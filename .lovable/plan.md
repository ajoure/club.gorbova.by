# План: CRM Automation smoke recovery (PLAN-ONLY, SHA dfa36d35)

Статус: READ-ONLY отчёт выполнен. Ничего не изменено: ни файлов, ни коммитов, ни миграций, ни строк БД, ни функций, ни cron, ни флагов, ни sync/Publish.

## 1. Managed HEAD и дерево

| Проверка | Результат |
|---|---|
| `git rev-parse HEAD` | `dfa36d352abd95e002f1cb2921e2431d24a0222a` — совпадает с указанным SHA |
| `git status --porcelain` | пусто — дерево чистое |

## 2. Остатки ZZ_SMOKE фикстур (CRM-объекты)

| Объект | Совпадений с маркером |
|---|---|
| `crm_pipelines` (name ilike `%ZZ_SMOKE%`) | 0 |
| `crm_pipeline_stages` (name) | 0 |
| `crm_pipeline_automation_rules` (name) | 0 |
| `crm_tasks` (title) | 0 |
| `orders_v2` (order_number ilike `ZZ-SMOKE%`) | 0 |

Итого остатков: **0**. Предыдущий прогон не оставил мусора.

## 3. Текущие baseline-значения

| Счётчик | Значение |
|---|---|
| `crm_pipeline_automation_rules` (всего / active) | 0 / 0 |
| `crm_pipeline_automation_jobs` | 0 |
| `crm_tasks` | 69 |
| `crm_pipelines` | 11 |
| `crm_pipeline_stages` | 50 |
| `crm_task_notifications` | 180 |
| `email_logs` | 4793 |
| `email_send_log` | 826 |
| `telegram_messages` | 18215 |
| `crm_activity_log` | 113 |

## 4. Воркер, cron, авторизация, feature flags

- `cron.job 507` `crm-pipeline-automation-tick`: `active = true`, расписание `* * * * *`, Authorization из Vault (`email_queue_service_role_key`), тело `{}`.
- `supabase/config.toml`: `[functions.crm-pipeline-automation-worker] verify_jwt = true`; воркер дополнительно сверяет bearer с service-role секретом.
- Анонимный `POST` на `/functions/v1/crm-pipeline-automation-worker` → **HTTP 401** (проверено, тело не отправлялось в обработчик).
- Feature flags: `feature_crm_pipeline_automation_v1 = true`, `feature_crm_tasks_enabled = true`.
- Тип задачи `other` = `ce9bdc6f-c3d0-499a-a24f-182b48bf6e36`.

## 5. Единый обратимый EXECUTE-план (ожидает отдельного approval)

Маркер прогона: `ZZ_SMOKE_AUTOMATION_20260816T20` (уникален по дате/часу).

Фикстура:
- Pipeline `ZZ_SMOKE_AUTOMATION_20260816T20`, Stage `ZZ_SMOKE_STAGE`.
- Rule `ZZ_SMOKE_RULE_create_task`: `trigger_type='deal_created'`, `action_type='create_task'`, `status='active'`, `task_type_id=ce9bdc6f-…`, `title_template='ZZ_SMOKE_TASK_20260816T20'`, `assignee_strategy='deal_owner'`, `delay_minutes=0`, без quiet hours, без fallback/no_branch/error_branch, без email/Telegram-полей, `metadata={"smoke":"crm_automation_v1_20260816T20"}`.
- Deal `orders_v2`: `order_number='ZZ-SMOKE-AUTOMATION-20260816T20'`, `status='draft'`, `base_price=0`, `final_price=0`, `profile_id/company_id/customer_email/responsible_user_id/user_id = NULL` (без ответственного → задача без исполнителя → 0 уведомлений).

Шаги и ожидаемые rowcount:

| # | Действие | Ожидание |
|---|---|---|
| 0 | Preflight: значения из раздела 3 совпадают | иначе STOP |
| 1 | INSERT pipeline | rowcount 1 |
| 2 | INSERT stage | rowcount 1 |
| 3 | INSERT rule (active, published_at=now()) | rowcount 1; всего активных правил = 1 |
| 4 | INSERT deal с pipeline_id/stage_id фикстуры | rowcount 1 |
| 5 | Read-back очереди сразу | `crm_pipeline_automation_jobs` = 1, `status='pending'`, rule/deal = фикстурные |
| 6 | Ровно один тик cron 507: опрос статуса job до 120 сек, без ручного вызова воркера | `status='succeeded'`, `attempt_count=1`, `finished_at` не NULL |
| 7 | Read-back задач | `crm_tasks` = 70, новая задача `title='ZZ_SMOKE_TASK_20260816T20'`, `source='auto'`, `assignee_user_id IS NULL` |
| 8 | Read-back побочных эффектов | `crm_task_notifications` = 180, `email_logs` = 4793, `email_send_log` = 826, `telegram_messages` = 18215 (прирост по фикстуре = 0) |

Cleanup (обязателен в том же прогоне, порядок по FK: `jobs.deal_id → orders_v2` RESTRICT, `jobs.rule_id → rules` RESTRICT):

1. DELETE задачи фикстуры → 1
2. DELETE job'ов фикстуры → 1
3. DELETE сделки по маркеру → 1
4. DELETE правила → 1
5. DELETE стадии → 1
6. DELETE пайплайна → 1

Финальный read-back = ровно baseline раздела 3, поиск по маркерам `ZZ_SMOKE`/`crm_automation_v1_20260816T20` даёт 0 строк во всех перечисленных таблицах.

Stop-условия (любое → немедленный STOP и переход к cleanup): расхождение preflight; rowcount ≠ 1 на любом шаге; jobs = 0 или > 1; job не `succeeded` за 120 сек или `attempt_count > 1`; прирост `crm_task_notifications`/`email_logs`/`email_send_log`/`telegram_messages`; задача с непустым `assignee_user_id`; появление любого второго активного правила.

Rollback: отдельный не нужен — остановка на любом шаге ведёт к тому же cleanup 1→6; production-строки не изменяются.

Явно вне scope EXECUTE: код, коммиты, миграции, deploy Edge Functions, изменение cron/флагов/секретов, sync, Publish, реальные email/Telegram/платежи, любые другие модули.
