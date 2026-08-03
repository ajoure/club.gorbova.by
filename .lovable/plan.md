# План: релиз PR #261 (training-assets-delete) на SHA 4b99bc8d

## Что подтверждено read-only проверками (без изменений)

1. **Diff SHA→SHA.** `git diff --stat 4b097377 4b99bc8d` даёт ровно два файла:
   - `supabase/functions/training-assets-delete/index.ts` (+16/−4)
   - `src/lib/trainingAssetsDeleteGuard.test.ts` (+15, только тест)

   Другого production-кода в diff нет. Рабочее дерево чистое, локальный HEAD уже указывает на merge-коммит `4b99bc8dffe3cf62782e97ed684745651a7756b5`.

2. **Содержание фикса.** В `findSharedPaths` больше нет выражения `.or(...ilike...)` по jsonb-колонке `lesson_blocks.content`: используется детерминированная постраничная выборка (`PAGE_SIZE=1000`) с фильтрацией путей в памяти. Ошибка запроса теперь **fail-closed** — `throw new Error("Shared asset lookup failed: ...")` вместо прежнего `break` с пустым `sharedSet`. Оставшиеся `break` в коде — только выходы из пагинации, не fail-open.

3. **RBAC migration `20260731072225_restore_rbac_helper_execute_grants.sql`.** Фактические ACL в production:
   - `public.has_permission(uuid,text)` — EXECUTE у `authenticated`, `service_role` (и owner/sandbox-ролей)
   - `public.has_role(uuid,public.app_role)` — то же
   - `public.has_role_v2(uuid,text)` — то же

   `PUBLIC` и `anon` в ACL отсутствуют. То есть целевое состояние миграции уже действует; повторное применение не требуется. (Таблица `supabase_migrations.schema_migrations` недоступна текущей роли — проверка сделана по фактическим ACL, что и есть источник истины.)

4. **Развёрнутая версия `training-assets-delete`.** По списку Project monitoring активна ошибка `operator does not exist: jsonb ~~* unknown` c прямой ссылкой на `index.ts:171` со старым `.or("content->>url.ilike.%training-assets%,...")`. Это соответствует **старой (до-PR #261)** версии в проде. Значит деплой функции из SHA 4b99bc8d необходим.

5. **Четыре findings** (custom-domain lead buttons, bank-transfer invoice routing, non-bePaid/Stripe cancel, legacy payment button save) — это monitoring-события, зафиксированные на опубликованном 4b097377, то есть до исправлений PR #261; PR #261 их не затрагивает. В текущий scope они не входят.

6. **amoCRM** — полностью вне scope, ничего не читается на запись и не меняется.

## EXECUTE-план (для отдельного одобрения)

Шаг 0 — preflight STOP-гейты
- `git rev-parse HEAD` == `4b99bc8dffe3cf62782e97ed684745651a7756b5`, дерево чистое
- diff к 4b097377 = ровно два файла из п.1
- повторная проверка ACL RBAC-хелперов (authenticated+service_role, без PUBLIC/anon)
- при любом mismatch — STOP, нулевые изменения

Шаг 1 — синхронизация managed SHA
- Синхронизировать Lovable на exact merged SHA `4b99bc8d...`, подтвердить SHA read-back

Шаг 2 — миграция
- Ничего не применять: целевые EXECUTE-гранты уже присутствуют. Миграция запускается **только** если preflight покажет отсутствие гранта или наличие PUBLIC/anon; тогда применяется ровно существующий файл `20260731072225_restore_rbac_helper_execute_grants.sql`, без правок

Шаг 3 — деплой
- Развернуть **ровно одну** Edge Function `training-assets-delete` из SHA 4b99bc8d. Никаких других функций, никакого Publish frontend (в diff нет ни одного изменения UI-кода)

Шаг 4 — безопасные smokes (без удаления реальных файлов)
- `bunx vitest run src/lib/trainingAssetsDeleteGuard.test.ts` — зелёный
- Read-only проверка логов `training-assets-delete` после деплоя: отсутствие новых `jsonb ~~* unknown`
- Синтетический вызов: запрос на несуществующий/пустой `lesson_id` без реальных объектов storage — ожидается корректный ответ без Postgres-ошибки и без единого удаления
- Контрольный SELECT: количество объектов в целевом storage-префиксе до и после smokes не изменилось
- Никаких платежей, создания пользователей, сообщений, provider-вызовов

Шаг 5 — отчёт
- Точный SHA, факт деплоя одной функции, результаты smokes, подтверждение нулевой дельты по данным

## Технические примечания

- UI-изменений в diff нет, поэтому desktop/mobile UI-proof неприменим — доказательство будет API/логовым.
- Fail-closed поведение означает, что при недоступности `lesson_blocks` функция теперь вернёт ошибку вместо удаления; это ожидаемое и желаемое поведение.
