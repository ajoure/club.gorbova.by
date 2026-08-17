# План: деплой CRM Automation на SHA 1a494d8c (PR #329 + фикс PR #330)

Режим сейчас: PLAN-ONLY / STRICT READ-ONLY. Ничего не изменено, не применено, не развёрнуто, не опубликовано.

## 1. Managed workspace SHA и состояние дерева

| Проверка | Результат |
|---|---|
| Managed HEAD | `1a494d8c768d4ac9a96ec68aad4c6f21033cf83b` — точное совпадение с запрошенным SHA |
| Коммит | «Merge pull request #330 from ajoure/codex/fix-contact-placeholder-es2020», 2026-08-17 12:42:54 +02:00 |
| `git status --porcelain` | пусто (дерево чистое) |
| Diff vs `158c72af` | 2 файла: `src/lib/contactCenterMessagePlaceholders.ts` (−1/+1) и документ `.lovable/plan.md` |
| Миграции в диффе | нет |
| `supabase/config.toml` | не менялся; `[functions.crm-pipeline-automation-worker] verify_jwt = true` сохранён |

## 2. Доказательство, что production build проходит

- Прежний блокер снят: строка 30 `contactCenterMessagePlaceholders.ts` теперь
  `Object.prototype.hasOwnProperty.call(values, key)` вместо ES2022 `Object.hasOwn`.
  Изменение `tsconfig` не потребовалось.
- Выполнен `npm run build` на этом SHA: **exit code 0**, `✓ built in 53.76s`,
  ошибок TS2550 и любых других ошибок нет. Остались только штатные
  предупреждения о размере чанков (>500 kB) — они были и раньше и не блокируют.

## 3. EXECUTE-план (после отдельного одобрения)

1. **Preflight.** Подтвердить HEAD ровно `1a494d8c…`, дерево чистое.
2. **GitHub sync.** Подтверждение parity на точный SHA `1a494d8c…`, без коммитов
   и правок исходников (фактически изменений переносить не нужно).
3. **Deploy.** Развернуть ровно одну функцию: `crm-pipeline-automation-worker`.
   Никаких других функций.
4. **Read-back.** Сверить задеплоенный источник с repo-версией на этом SHA;
   подтвердить `verify_jwt = true`.
5. **Safe no-write verification.** Только неинвазивные проверки:
   - анонимный POST к функции → ожидается 401 (fail-closed);
   - read-only сверка счётчиков `crm_pipeline_automation_jobs`, `crm_tasks`,
     `email_logs`, `telegram_messages`, `crm_task_notifications` до и после
     проверки — дельты обязаны быть нулевыми;
   - чтение логов функции на предмет ошибок инициализации.
   Фикстуры не создаются, воркер на реальной очереди вручную не запускается;
   реальные письма, Telegram-сообщения, платежи, пользователи, сделки и задачи
   не создаются и не изменяются.
6. **Publish.** Опубликовать frontend текущего SHA `1a494d8c…`.
7. **Post-publish UI-проверки.** Два скриншота опубликованного результата —
   desktop и mobile viewport — редактора автоматизаций воронки
   (`PipelineAutomationSheet` с токенизированным полем): элементы читаемы,
   не обрезаны, не перекрываются. Без PII на скриншотах.

## 4. Подтверждение нулевого backend-скоупа

- Миграции: **0** (в диффе PR #329 и PR #330 нет ни одного файла в `supabase/migrations`).
- RLS/политики/гранты: **не затрагиваются**.
- Данные (сделки, задачи, платежи, пользователи, подписки, доступы): **не затрагиваются**.
- Секреты: **не создаются и не меняются**.
- Cron (в т.ч. job 507): **не трогается**.
- Изменение backend ограничено исходником одной функции
  `supabase/functions/crm-pipeline-automation-worker/index.ts`.

## 5. Стоп-условия

- HEAD ≠ `1a494d8c…` или грязное дерево → STOP.
- Появление в scope миграции, секрета, cron- или RLS-изменения → STOP.
- Анонимный запрос не отклонён 401, либо ненулевая дельта по любому из
  контрольных счётчиков → STOP без Publish.
- Новый critical security finding → STOP до Publish.

## 6. Вне scope

Правки исходников и коммиты, любые миграции, изменение секретов/cron/RLS/данных,
деплой любых функций кроме `crm-pipeline-automation-worker`, разбор
ESLint-backlog (`@typescript-eslint/no-explicit-any` в `TokenizedRichInput.tsx`).
