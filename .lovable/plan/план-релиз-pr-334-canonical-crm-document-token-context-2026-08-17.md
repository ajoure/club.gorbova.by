# План: релиз PR #334 (canonical CRM document-token context)

## 1. Фактическое состояние managed-среды (read-only)

- Managed HEAD: `8a7590efd8e7944a3bf612031efd6ee6143033b5` — «Merge pull request #334 from ajoure/codex/unify-document-token-context».
- Совпадает с указанным GitHub main SHA: ДА, посимвольно.
- Рабочее дерево: чистое (`git status --porcelain` = 0 строк). Незакоммиченных изменений, в том числе в `.lovable/`, нет.
- Паритет исходников: полный. Все non-`.lovable` файлы соответствуют дереву этого SHA — расхождений нет, поскольку рабочее дерево чистое ровно на этом коммите.
- Предыдущие коммиты в цепочке: `a00bd1106` (Unify CRM automation document tokens), `483a671a3` (Improve tablet CRM automation layout).

## 2. Статус «Build unsuccessful / Preview is out of date»

Проверка воспроизводимости выполнена локально на этом же SHA:

- `tsgo --noEmit -p tsconfig.app.json` — без ошибок (пустой вывод, exit 0).
- `npm run build` — PASS, `✓ built in 56.95s`, артефакты собраны полностью.
- `vitest run src/test/crmPipelineCanonicalDocumentTokens.test.ts` — PASS (2/2).

Вывод: ошибок компиляции/типизации/тестов в исходниках этого SHA нет. Единственные предупреждения сборки — размер чанков (`Some chunks are larger than 500 kB`), это не ошибка и не блокирует сборку.

Root cause статуса GitHub-sync: это не дефект кода, а устаревший результат предыдущего preview-билда в конвейере синхронизации — статус относится к прошлой неуспешной/прерванной сборке, а текущий SHA собирается чисто. Конкретный лог-фрагмент неуспешного билда в managed-среде недоступен: локальный прогон на этом SHA даёт PASS, а сохранённого stderr прошлой сборки в рабочем дереве нет. Соответственно, «verified build fault» на этом SHA не подтверждён — исправлять в исходниках нечего, требуется только повторный успешный билд/Publish, который снимет статус «Preview is out of date».

## 3. Узкий EXECUTE-план (только после «EXECUTE APPROVED»)

1. Preflight: подтвердить HEAD = `8a7590efd8e7944a3bf612031efd6ee6143033b5`, дерево чистое. Любое расхождение — блокер, стоп.
2. Gates (read-only): `tsgo --noEmit`, `npm run build`, `vitest run src/test/crmPipelineCanonicalDocumentTokens.test.ts`. Все три должны быть PASS. Никаких правок исходников: паритет уже есть, verified build fault отсутствует.
3. Before-снимок (только чтение, без создания фикстур и без вызова очереди):
   - количество строк `crm_pipeline_automation_jobs` по статусам;
   - количество `crm_tasks`;
   - последние записи логов email и Telegram (только счётчики, без содержимого и без PII).
4. Deploy: ровно одна Edge Function — `crm-pipeline-automation-worker` с текущего SHA, `verify_jwt = true` (уже зафиксировано в `supabase/config.toml`). Никакие другие функции не деплоятся.
5. Verification:
   - анонимный POST на функцию → ожидаемо `401 Unauthorized`;
   - after-снимок тех же счётчиков → дельта строго 0 (jobs, tasks, email, Telegram);
   - логи функции без ошибок.
6. Publish: только frontend, только после PASS всех гейтов выше. Отчёт: публичный URL + эффективный SHA.
7. Acceptance-проверки: post-publish desktop и mobile проверка `/admin/deals`, выполняется пользователем в собственной авторизованной сессии, без PII на скриншотах.

Блокеры и немедленный стоп: расхождение исходников с SHA, падение build/тестов, отсутствующая зависимость, ненулевая дельта данных, новый critical finding.

## 4. Подтверждение границ

В плане нет и не будет:

- миграций, изменений схемы, RLS или GRANT;
- изменений данных (никаких INSERT/UPDATE/DELETE в production);
- изменений секретов, Vault, cron-заданий;
- создания/имперсонации сессий, пользователей, контактов, ролей, доступов;
- платёжных операций, возвратов, начислений;
- отправки email, Telegram, SMS или любых сообщений клиентам;
- деплоя любых Edge Functions, кроме `crm-pipeline-automation-worker`;
- создания фикстур и ручного запуска очереди воркера.
