# План: деплой merged PR #329 (SHA 158c72af)

Режим сейчас: PLAN-ONLY / STRICT READ-ONLY. Ничего не изменено, не применено, не развёрнуто, не опубликовано.

## 1. Read-only факты (проверено)

| Проверка | Результат |
|---|---|
| Managed workspace SHA | `158c72afd34e3f7df8ce4d15e2bb5484df2099bb` — уже равен целевому |
| `git status --porcelain` | пусто (дерево чистое) |
| Состав PR #329 vs предыдущий main | 8 файлов, +395/−105 |
| Миграции в диффе | нет |
| `supabase/config.toml` в диффе | нет изменений; `[functions.crm-pipeline-automation-worker] verify_jwt = true` сохранён |
| Backend в диффе | только `supabase/functions/crm-pipeline-automation-worker/index.ts` |
| Frontend в диффе | `PipelineAutomationSheet.tsx`, `TokenizedRichInput.tsx`, `ContactTelegramChat.tsx`, `ui/sheet.tsx`, `tokenRegistry.ts`, `contactCenterMessagePlaceholders.ts` + тест |
| Тест `contactCenterMessagePlaceholders.test.ts` | PASS |

### 2. Возможна ли безопасная синхронизация на 158c72af

Да. Workspace уже байт-в-байт на этом SHA и чист, поэтому шаг sync — это подтверждение
parity, а не перенос изменений. Риск потери локальных правок отсутствует (их нет).

### 3. Почему GitHub build помечен как unsuccessful / out of date

- Опубликованный frontend соответствует прошлому релизу (`616bf9ed…`), а не `158c72af`.
  Метка «out of date» отражает именно отсутствие Publish для нового SHA.
- Изменённые файлы содержат ранее существовавший ESLint-backlog
  (`@typescript-eslint/no-explicit-any`, 10 ошибок в `TokenizedRichInput.tsx`), из-за чего
  общий lint-прогон на репозитории красный. Release-gate CI линтит только
  `e2e/release-safety-gate.spec.ts`, unit-контракты и production build, поэтому это
  фон, а не новый дефект PR #329. Правки этого backlog вне scope.

## 4. EXECUTE-план (после отдельного одобрения)

1. **Preflight.** Подтвердить HEAD ровно `158c72af…`, дерево чистое; зафиксировать
   baseline-счётчики `crm_pipeline_automation_jobs`, `crm_tasks`, `email_logs`,
   `telegram_messages`, `crm_task_notifications`.
2. **GitHub sync.** Синхронизировать managed-репозиторий на точный SHA `158c72af…`,
   без коммитов и правок исходников.
3. **Deploy.** Развернуть ровно одну функцию: `crm-pipeline-automation-worker`.
   Никаких других функций, миграций, секретов, cron, RLS.
4. **Read-back.** Убедиться, что задеплоенный источник соответствует repo-версии
   на этом SHA и что `verify_jwt = true` сохранён.
5. **Safe smoke.** Анонимный POST к воркеру → ожидается 401. Затем прогон воркера
   на изолированной фикстуре-маркере (сделка `final_price = 0`, без клиента,
   платежа, продукта и каналов; одно правило `deal_created → create_task`,
   `assignee = null`). Ожидание: 1 job `succeeded`, ровно +1 строка в `crm_tasks`,
   нулевые дельты в `email_logs`, `telegram_messages`, `crm_task_notifications`.
   Реальные письма, Telegram-сообщения, платежи и создание пользователей исключены.
6. **Cleanup.** Удалить фикстуры по маркеру в обратном порядке зависимостей с
   проверкой rowcount и вернуть baseline-счётчики.
7. **Publish.** Опубликовать frontend текущего SHA `158c72af…`.
8. **Post-publish UI-проверки.** Два скриншота опубликованного результата —
   desktop и mobile viewport — редактора автоматизаций воронки (шторка
   `PipelineAutomationSheet` с токенизированным полем): элементы читаемы, не
   обрезаны, не перекрываются; без PII на скриншотах.

## 5. Стоп-условия

- HEAD ≠ `158c72af…` или грязное дерево → STOP.
- Появление в scope миграции, секрета, cron- или RLS-изменения → STOP.
- Анонимный запрос не отклонён, job ≠ `succeeded`, tasks ≠ +1, любая ненулевая
  дельта email/Telegram/notification → cleanup + STOP без Publish.
- Новый critical security finding → STOP до Publish.

## 6. Вне scope

Правки исходников и коммиты, любые миграции, изменение секретов/cron/RLS/данных,
деплой любых функций кроме `crm-pipeline-automation-worker`, разбор ESLint-backlog.
