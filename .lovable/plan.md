# План: финальный managed-ремонт CRM Automation (SHA b66393b5)

Режим сейчас: PLAN-ONLY. Ничего не изменено, не применено, не развёрнуто, не опубликовано.

## 1. Read-only факты (проверено)

| Проверка | Результат |
|---|---|
| Managed HEAD | `b66393b52415299bb824b60a0ab384f8676656b3` — совпадает |
| `git status --porcelain` | пусто (дерево чистое) |
| Diff vs `0b38fa0a0` | ровно 2 файла миграций, +73 строки, кода/UI изменений нет |
| Cron 507 | active, `* * * * *`, Authorization из Vault `email_queue_service_role_key`, заголовка `X-Worker-Secret` нет |

Текущая БД-версия `public._crm_tasks_assert_staff()`:
- `service_role` определяется только по `request.jwt.claim.role` (без `request.jwt.claims`) — это и есть корневая причина отказов воркера;
- контракт стаффа: `has_role_v2(uid,'employee') OR has_admin_section_access(uid,'deals','edit')`;
- ACL: `authenticated`, `service_role` (плюс owner `postgres`), без PUBLIC/anon.

Итог после двух миграций (проверено по тексту файлов):
- `20260817084339` временно сужает контракт до `employee/admin/super_admin` (теряется `has_admin_section_access`), добавляет fallback `request.jwt.claims`;
- `20260817085249` восстанавливает ровно текущий контракт (`employee OR has_admin_section_access(uid,'deals','edit')`) и сохраняет fallback;
- обе миграции завершаются одинаковым `REVOKE ALL ... FROM PUBLIC, anon` + `GRANT EXECUTE TO authenticated, service_role` — ACL не расширяется.

Итоговая функция = текущая функция + только service-role fallback. Требование выполнено.

## 2. Окно доступа между миграциями

Между шагами существует окно, в котором сотрудник с секционным доступом `deals/edit`, но без глобальной роли, получил бы `forbidden_not_staff`.
Требование: применить обе миграции **одной транзакцией** (одна managed-миграция-обёртка, содержащая байт-в-байт SQL обоих файлов подряд, в указанном порядке). `CREATE OR REPLACE FUNCTION` транзакционен в Postgres, поэтому промежуточное определение никогда не становится видимым другим сессиям. Если платформа применяет файлы раздельными транзакциями — считать это STOP-условием и не начинать шаг.

## 3. EXECUTE-план (после отдельного одобрения)

1. **Preflight.** HEAD ровно `b66393b5…`, дерево чистое. Зафиксировать baseline: `crm_pipelines`, `crm_pipeline_stages`, `crm_pipeline_automation_rules`, `crm_tasks`, `crm_pipeline_automation_jobs`, `email_logs`, `telegram_messages`, `crm_task_notifications`; текущую команду cron 507 сохранить дословно.
2. **Migrations (атомарно).** Применить `20260817084339` и `20260817085249` в одной транзакции, в этом порядке, без правки SQL.
3. **Read-back функции.** `pg_get_functiondef` содержит `request.jwt.claims` и `has_admin_section_access(..., 'deals','edit')`; ACL ровно `authenticated, service_role`, без PUBLIC/anon. Несовпадение → STOP.
4. **Secret.** Создать `CRM_AUTOMATION_WORKER_SECRET` (env + Vault `crm_automation_worker_secret`). Значение нигде не выводить.
5. **Cron.** Через `cron.alter_job` добавить в job 507 только заголовок `X-Worker-Secret`, сохранив расписание `* * * * *` и существующий Authorization.
6. **Deploy.** Только `crm-pipeline-automation-worker`. Другие функции не трогать.
7. **Gates.** Анонимный POST → 401. Cron-tick → 200 и `auth_ok` в логах. Иначе — rollback (п.9).
8. **Fixture smoke `ZZ_AUTOMATION_SMOKE_20260817_G`.** Одна изолированная сделка `final_price = 0` без клиента/платежа/продукта/каналов + одно активное правило `deal_created → create_task` с `assignee = null`. Ожидание: ровно 1 job `succeeded`, ровно +1 строка в `crm_tasks`, нулевые дельты в `email_logs`, `telegram_messages`, `crm_task_notifications`. Все счётчики фиксируются точными числами.
9. **Cleanup / Rollback.** В обратном порядке зависимостей удалить фикстуры по маркеру (каждое удаление с проверкой rowcount), вернуть baseline (`marker_deals = 0`, `rules = 0`), восстановить дословную прежнюю команду cron 507, удалить созданный секрет. При провале любого шага 5–8 — немедленно выполнить этот cleanup и STOP. Миграции при этом не откатываются (они и есть целевое состояние); фактическое состояние докладывается.

## 4. Стоп-условия

- HEAD ≠ `b66393b5…` или грязное дерево → STOP до любых действий.
- Раздельные транзакции для двух миграций → STOP.
- Read-back функции/ACL не совпал → STOP.
- Анонимный запрос не отклонён, cron ≠ 200, job ≠ `succeeded`, tasks ≠ +1, любые дельты email/Telegram/notification → cleanup + rollback + STOP.
- Никаких blind `UPDATE`/`DELETE`, никаких реальных писем, сообщений, платежей и Publish.

## 5. Вне scope

Правки исходников, коммиты, другие миграции, изменения RLS, frontend Publish, деплой любых функций кроме `crm-pipeline-automation-worker`.
