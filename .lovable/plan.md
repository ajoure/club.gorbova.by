# План: managed-transfer PR #306 (send-email auth guard)

Режим текущего сообщения — PLAN-ONLY / STRICT READ-ONLY. Изменений не производилось: без правок кода, коммитов, миграций, DDL/DML, deploy, sync, cron, флагов, секретов, Publish, писем, Telegram, платежей и создания пользователей/контактов/сделок. SMTP не вызывался, синтетические запросы к `send-email` не отправлялись.

## 1. Соответствие SHA

- Рабочее дерево Lovable: `21d601b759a1f2a50d2f41f0c1d39eebb962b0dc` — «Merge pull request #306 from ajoure/codex/crm-email-auth-guard», 2026-08-14 11:53 +0200.
- Рабочее дерево чистое (нет незакоммиченных изменений).
- Вывод: дерево уже на точном merged SHA. Отдельный sync-prerequisite не требуется; в EXECUTE выполняется только managed-подтверждение того же SHA перед деплоем.

## 2. Состояние send-email в исходниках (read-only)

- `supabase/config.toml`: `[functions.send-email] verify_jwt = true` — платформенный JWT-барьер включён.
- Handler `supabase/functions/send-email/index.ts`:
  - строки 469–470: отсутствие Bearer → отказ до любой работы;
  - строка 477: `bearer !== supabaseKey` → проверка пользователя через `/auth/v1/user`;
  - строки 501–502: `has_role_v2(admin)` / `has_role_v2(super_admin)`;
  - строка 513: `req.json()` разбирается только после прохождения авторизации, то есть до SMTP запрос не доходит.
- Внутренние администраторские вызовы (`roles-admin`, `users-admin-actions`) используют service-role ключ (подтверждено тестом `src/test/sendEmailAuthentication.test.ts`).
- Ограничение честно: фактическое поведение задеплоенной сейчас версии функции нельзя проверить read-only без отправки запроса, а запрос к текущей (ещё не обновлённой) версии способен дойти до SMTP. Поэтому статус production-функции — UNKNOWN до деплоя; проверка «no-auth = 401» выполняется только после деплоя нового кода, где отказ гарантированно происходит до SMTP.

## 3. CRM: worker, cron, правила

- `cron.job` 507 `crm-pipeline-automation-tick`, `* * * * *`, `active = true` — присутствует (дополнительно активен 79 `crm-tasks-notify-tick`).
- Worker `crm-pipeline-automation-worker` в исходниках сохраняет строгое сравнение `Authorization === Bearer <service role>` (строка 124) поверх `verify_jwt = true`.
- Данные: `crm_pipeline_automation_rules = 0`, `crm_pipeline_automation_jobs = 0`. Система «холостая». (`crm_task_automation_rules = 6` — отдельный, уже существовавший ранее слой задач, вне этого scope.)

## 4. EXECUTE-план (узкий, только security-transfer)

Объём строго ограничен: managed sync SHA `21d601b759a1f2a50d2f41f0c1d39eebb962b0dc` + deploy одной функции `send-email`.

1. Managed sync ровно этого SHA; стоп при любом расхождении SHA.
2. Deploy ровно одной функции: `send-email`. Никаких других функций, миграций, cron, флагов и секретов.
3. Read-back после деплоя:
   - `OPTIONS /functions/v1/send-email` → 200, CORS-заголовки с `x-supabase-client-*`;
   - `POST` без `Authorization` → ожидание 401; тело запроса намеренно невалидное/пустое, авторизация отклоняет его до `req.json()` и до SMTP;
   - `POST` с невалидным JWT → 401.
4. Контроль отсутствия побочных эффектов: `email_logs` — count и max(created_at) до и после совпадают; никаких уведомлений, Telegram-сообщений и изменений записей.
5. Стоп-гейты: любой ответ, отличный от 401 на неаутентифицированный POST; любое приращение `email_logs`; любое расхождение SHA.
6. Rollback: повторный deploy `send-email` из предыдущего known-good SHA. Данные не затрагиваются, DDL нет, Publish не выполняется (frontend не меняется).

## 5. Отдельный, НЕ объединяемый план: CRM create_task smoke

Выполняется позже, отдельной задачей и отдельным разрешением; в текущий transfer не входит и в нём не готовится.

- Предусловие: `send-email` уже закрыт и подтверждён 401.
- Fixture: одно временное правило с единственным действием `create_task`, привязанное к изолированной тестовой воронке/сделке-фикстуре; без email-, Telegram- и платёжных действий.
- Прогон: один tick worker'а с service-role авторизацией; ожидание ровно 1 job и ровно 1 созданная задача.
- Read-back: `crm_pipeline_automation_jobs` +1 в статусе success; `crm_tasks` +1; `email_logs` и Telegram-логи без изменений.
- Стоп-гейты: rowcount != 1, любое действие кроме `create_task`, любой внешний исходящий вызов.
- Rollback: удаление созданной задачи, job'а и временного правила; возврат к 0 правил / 0 job'ов.

## Блокеры

Явных блокеров для узкого transfer'а нет. Единственное честное UNKNOWN — фактическое поведение текущей задеплоенной версии `send-email`, которое нельзя доказать read-only без риска дойти до SMTP; оно снимается read-back'ом сразу после деплоя.
