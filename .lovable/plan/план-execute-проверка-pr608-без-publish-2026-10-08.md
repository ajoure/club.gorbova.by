План: EXECUTE-проверка PR608 без Publish

Scope: только сверка и read-back точного merged SHA 42312fd657c6ea0104b76584d1ec1072476e3090 (head 0da90773988e859aeb8e0ede640e336a6723bc28). Никаких изменений кода, коммитов, пакетов, lock, .lovable/plan.md, БД, Auth, functions, данных. Publish не вызывается — его нажимает пользователь в UI после отчёта.

Шаги
1. Синхронизация: HEAD рабочей папки = 42312fd…, дерево чистое; родители merge-коммита и head 0da90773 совпадают.
2. Diff: merge-parent diff — ровно 3 заявленных файла (exportRegulation.ts, exportRegulation.test.ts, release doc); runtime delta от опубликованного a2e51db6 — только src/utils/exportRegulation.ts (коммиты .lovable/plan.md не считаются runtime). Любой другой файл — STOP.
3. Холодная сборка во временную папку вне проекта: npm ci по неизменному lock, `tsc -p tsconfig.app.json`, `vite build`; зафиксировать код выхода и имена index-*.js (это локальная сборка, не опубликованная версия).
4. Свежий Preview: штатный перезапуск сервера предпросмотра из того же source, проверка «VITE ready», главная и страница регламентов открываются без runtime-ошибок; запись build-errors.log оценивается честно (без фиктивных правок).
5. Security delta только в scope: свежий запуск сканирования/чтение результатов; новые findings по файлам PR608 — нет/есть; старые findings не исправлять и не игнорировать; dependency follow-up вне scope.
6. Read-back: текущий публичный чанк https://gorbova.by (ожидается index-TELcZs6s.js, fingerprint 2026-10-08T10:37:46.710Z = опубликованный a2e51db6) — для сравнения после UI Publish.

Stop-guards: несовпадение SHA/head, diff вне scope, падение tsc/build, ошибка Preview, новый critical finding в scope — STOP с отчётом.

Отчёт: SHA, diff, build/tsc, Preview, security delta, текущий публичный чанк. Rollback (если понадобится после UI Publish): GitHub revert PR608 + обычный Publish, возврат к a2e51db6.
