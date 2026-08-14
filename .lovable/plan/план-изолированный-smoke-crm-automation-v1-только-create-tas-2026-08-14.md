# План: изолированный smoke CRM Automation v1 (только create_task)

Статус: PLAN-ONLY. Ничего не изменено. Ниже — только read-only факты и точный EXECUTE-план, ожидающий отдельного approval.

## 1. Read-only discovery (факты)

- Сделки = `orders_v2`. Триггер `trg_crm_pipeline_automation_deal_created` (AFTER INSERT) ставит job только если: feature flag `feature_crm_pipeline_automation_v1 = true` (подтверждено), `is_deleted = false`, заданы `pipeline_id` и `pipeline_stage_id`, и есть правило `status='active' AND trigger_type='deal_created'` ровно на этой паре pipeline+stage.
- На той же вставке срабатывает `trg_crm_pipeline_automation_stage_entry`, но он подбирает только правила `deal_entered_stage`; таких правил в базе нет → лишних job не будет.
- Уведомления: `crm_tasks` AFTER INSERT → `crm_tasks_enqueue_assigned_notification()` создаёт строку Telegram-уведомления **только если `assignee_user_id IS NOT NULL`**. Поэтому фикстура обязана дать задачу без исполнителя.
- Воркер (`crm-pipeline-automation-worker`) при `assignee_strategy='deal_owner'` берёт `deal.responsible_user_id`. Служебная сделка создаётся с `responsible_user_id = NULL` → задача без исполнителя → 0 уведомлений, 0 Telegram, 0 email.
- FK: `crm_pipeline_automation_jobs.deal_id → orders_v2 (ON DELETE RESTRICT)`, `jobs.rule_id → rules (RESTRICT)`. Значит порядок удаления строго: задача → job → сделка → правило → стадия → пайплайн.
- Cron 507 (`crm-pipeline-automation-tick`) активен, раз в минуту. Отдельный ручной вызов воркера не нужен и не планируется: тик выполнит ровно один pickup job'а (уникальность `logical_id+rule_version+deal_id+event_key` защищает от дублей).

## 2. Preflight counts (снять непосредственно перед EXECUTE, зафиксировать в отчёте)

| Объект | Ожидаемое значение сейчас |
|---|---|
| `crm_pipeline_automation_rules` | 0 |
| `crm_pipeline_automation_jobs` | 0 |
| `crm_tasks` | 69 |
| `crm_task_notifications` | 180 |
| `crm_pipelines` | 11 |
| `crm_pipeline_stages` | 50 |
| `email_logs` | текущее значение фиксируется как база |

Любое расхождение preflight с этими значениями (кроме `email_logs`) — BLOCKER, STOP.

## 3. Маркеры изоляции

- Pipeline: `ZZ_SMOKE_AUTOMATION_20260814` (не показывается в рабочих воронках по имени-маркеру, удаляется в этом же прогоне).
- Stage: `ZZ_SMOKE_STAGE`.
- Rule: `ZZ_SMOKE_RULE_create_task`, `metadata = {"smoke":"crm_automation_v1_20260814"}`.
- Deal (`orders_v2`): `order_number = 'ZZ-SMOKE-AUTOMATION-20260814'`, `status='draft'`, `base_price=0`, `final_price=0`, `profile_id=NULL`, `company_id=NULL`, `customer_email=NULL`, `responsible_user_id=NULL`, `user_id=NULL`, `meta = {"smoke":"crm_automation_v1_20260814"}`.
- Правило: `trigger_type='deal_created'`, `action_type='create_task'`, `status='active'`, `task_type_id` = `other` (`ce9bdc6f-c3d0-499a-a24f-182b48bf6e36`), `title_template='ZZ_SMOKE_TASK'`, `assignee_strategy='deal_owner'`, `delay_minutes=0`, без quiet hours, все поля fallback / no_branch / error_branch / email / telegram = NULL.

## 4. EXECUTE-шаги и row-count gates

Каждый шаг — отдельная операция с проверкой rowcount; несоответствие = немедленный STOP и переход к cleanup.

1. Sync SHA `21d601b759a1f2a50d2f41f0c1d39eebb962b0dc` (без deploy, без миграций, без Publish).
2. INSERT pipeline → rowcount = 1.
3. INSERT stage → rowcount = 1.
4. INSERT rule (сразу `status='active'`, `published_at=now()`) → rowcount = 1. Read-back: ровно 1 активное правило во всей таблице.
5. INSERT deal в `orders_v2` с pipeline_id/stage_id фикстуры → rowcount = 1.
6. Немедленный read-back очереди: `crm_pipeline_automation_jobs` = ровно 1 строка, `status='pending'`, `rule_id` = фикстурное правило, `deal_id` = фикстурная сделка. Если 0 или >1 — STOP.
7. Один тик воркера: ждать до 120 секунд ближайший cron-tick, опрашивая статус job (без ручных повторных вызовов). Ожидание: `status='succeeded'`, `attempt_count=1`, `finished_at IS NOT NULL`.
8. Read-back задач: `crm_tasks` = 70 (ровно +1), новая задача с `title='ZZ_SMOKE_TASK'`, `source='auto'`, `deal_id` = фикстурная сделка, `assignee_user_id IS NULL`.
9. Read-back побочных эффектов: `crm_task_notifications` = 180 (без изменений), `email_logs` = база (без изменений), отсутствуют записи Telegram-отправки по этой задаче. Любой прирост — BLOCKER.

## 5. Cleanup (обязателен в том же прогоне) и proof повторяемости

Порядок и gates:

1. DELETE задачи фикстуры → rowcount = 1.
2. DELETE job'ов фикстуры → rowcount = 1.
3. DELETE сделки (hard delete по `order_number` маркеру) → rowcount = 1.
4. DELETE правила → rowcount = 1.
5. DELETE стадии → rowcount = 1.
6. DELETE пайплайна → rowcount = 1.

Финальный read-back должен вернуть ровно исходные значения: rules 0, jobs 0, tasks 69, notifications 180, pipelines 11, stages 50, `email_logs` = база; поиск по всем маркерам `ZZ_SMOKE`/`crm_automation_v1_20260814` даёт 0 строк во всех перечисленных таблицах. Именно этот нулевой остаток и является доказательством повторяемости прогона (маркеры уникальны по дате, при повторе используется новая дата в маркере).

## 6. Rollback

Отдельный rollback не нужен: любая остановка на любом шаге ведёт к тому же cleanup-скрипту в порядке 1→6; так как ни одна production-строка не изменяется, обратимость полная. Feature flag, cron 507, настройки и Edge Functions не трогаются, Publish не выполняется.

## 7. Явные запреты, подтверждённые в плане

Без email, Telegram, платежей, создания пользователей/контактов, без fallback/no_branch/error_branch, без реальных клиентских данных, без изменения feature flag, cron и production-настроек, без deploy и Publish.
