# План: EXECUTE-релиз PR #321 (send-email Bearer parser fix)

Текущее сообщение — PLAN-ONLY / STRICT READ-ONLY. Ничего не изменялось: нет правок кода, коммитов, SQL, миграций, данных, секретов, cron, deploy, Publish и отправки писем.

## 1. Проверка SHA и дерева

- HEAD рабочего дерева Lovable = `3fffcdb8a20461fb0b41b5b63da06bd1670f2f57` — «Merge pull request #321 from ajoure/codex/broadcast-email-bearer-parse», 2026-08-15 17:06:33 +0200. Совпадает с заявленным merged main SHA.
- `git status --porcelain` пуст — дерево чистое.

## 2. Точный diff vs `ad8ee908a` (предыдущий опубликованный SHA)

Ровно 2 файла, 3 строки:

```
src/test/sendEmailAuthentication.test.ts | 2 ++
supabase/functions/send-email/index.ts   | 2 +-
```

- `supabase/functions/send-email/index.ts:470` — `match(/^Bearer\\s+(.+)$/i)` заменён на `match(/^Bearer\s+(.+)$/i)`. Это и есть корень 401: двойное экранирование делало regex несопоставимым с реальным заголовком, и любой валидный Bearer читался как `missing`.
- Тест добавляет два контрактных утверждения: требуется корректный `\s` и запрещён двойной вариант.

Отсутствуют: SQL, миграции, изменения данных, секреты, cron, `supabase/config.toml`, другие Edge Functions, frontend-код (изменён только тестовый файл, в бандл не входит).

## 3. Конфигурация и проверки

- `supabase/config.toml`: `[functions.send-email] verify_jwt = true` — не менялся, платформенный JWT-барьер сохраняется.
- Production build (`npm run build`): PASS, `built in 36.04s`.
- Целевые тесты: `sendEmailAuthentication.test.ts` (3) + `broadcastTestAndLayoutContract.test.ts` (3) = **6 tests PASS**.

## 4. EXECUTE-план (узкий)

1. Managed sync ровно SHA `3fffcdb8a20461fb0b41b5b63da06bd1670f2f57`, без единой правки. Стоп при любом расхождении.
2. Deploy ровно одной существующей Edge Function `send-email` (`verify_jwt = true`). Никаких других функций, миграций, cron, секретов.
3. Frontend Publish НЕ выполняется (frontend-бандл не изменён).
4. Read-back: подтвердить факт деплоя и новую версию функции.
5. Безопасный runtime-smoke: анонимный `POST /functions/v1/send-email` без тела и без `Authorization` → ожидание **401**. Тело намеренно пустое, отказ происходит до `req.json()` и до SMTP. Письмо не отправляется.
6. Контроль побочных эффектов: `email_logs` count и `max(created_at)` до и после совпадают.

## 5. Hard stop

Остановка и отчёт при: дрейфе SHA, scope mismatch, падении теста или build, ответе ≠ 401 на анонимный POST, приросте `email_logs`, критическом security finding, а также при любой потребности в SQL / secret / cron.

## 6. Rollback

Повторный deploy `send-email` из предыдущего known-good SHA `ad8ee908a624d3058dd3cc81d5dbd1fa245a28ca`. Данных и DDL операция не затрагивает.

## Вердикт

**PLAN PASS**
