# План: release PR608 — pagination Word-экспорта регламентов (frontend-only)

## Scope

Только frontend Word export регламентов бухгалтерии (PR608, head `b8f96cf29`):
- убрать пустые абзацы из экспорта;
- `keepNext` для заголовков и короткого блока согласования (≤12 абзацев);
- `keepLines` / `widowControl` для абзацев;
- чёрные заголовки;
- unit-тест и release-документ.

Никаких изменений Auth, прав доступа, модели/промптов, истории чатов, данных, миграций, Edge Functions, секретов. Без новых пользователей, сообщений клиентам и платёжных действий.

## Предусловия (read-only сверка перед execute)

1. PR608 merged; зафиксировать exact merged SHA и сверить, что head = `b8f96cf29…`, чужих merge в main нет.
2. Diff merged SHA против предыдущего main — ровно заявленные файлы (export, тест, release doc); любое расхождение → STOP.
3. Все required GitHub checks PASS.
4. Текущее состояние: последний реальный Publish = `a2e51db6…` (PR607), чанк `index-TELcZs6s.js`, fingerprint 2026-10-08T10:37:46.710Z. PR608 не считается опубликованным до реального события Publish.
5. Security findings delta в scope: новых findings по файлам PR608 не ожидается; существующие старые findings (каталог от 2026-09-02, dependency follow-up proxy-addr / vitest-tinypool) не исправлять и не игнорировать — вне scope.

## Execute (только после отдельной команды с exact merged SHA)

1. Синхронизировать exact merged SHA; проверить clean tree и ровно заявленный набор файлов.
2. Managed build / tsc точного SHA — PASS (холодная сборка; не смешивать с состоянием dev Preview).
3. Штатный Publish существующего проекта и домена https://gorbova.by из этой версии; аудитория и права прежние. Publish-инструмент не имитировать: если недоступен — явно сообщить.
4. После Publish: доказательство release/version + observed public chunk/fingerprint; published SHA выводить только из самого события Publish, не из HEAD.

## Проверка по публичному URL

- Обновлённый чанк экспорта (новое имя/fingerprint).
- Codex отдельно: реальный production Word download, render всех страниц, отсутствие orphan headings и подписи на почти пустой странице; ПК 1440×900 и mobile 390×844 скриншоты. Локальный регрессионный render 4 стр. уже проходит, но не заменяет production download.

## Stop-guards

STOP при: несовпадении exact merged SHA, чужих merge в main, diff вне заявленных файлов, падении checks/build/tsc, mismatch опубликованного чанка, новом critical finding, затронутых правах/модели/истории.

## Rollback

GitHub revert PR608 + Publish, возврат к a2e51db6 (чанк `index-TELcZs6s.js`) без изменений БД, функций, данных и истории.

## Технические детали

- Изменения ограничены `src/utils/exportRegulation.ts` (параграфные свойства docx: `keepNext`, `keepLines`, `widowControl`, фильтрация пустых строк, цвет заголовков), `src/utils/exportRegulation.test.ts` и release-документом.
- Никаких backend-артефактов: deploy functions, миграции, данные не входят в execute.
