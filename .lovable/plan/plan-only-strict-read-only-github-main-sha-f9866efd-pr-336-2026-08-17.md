# PLAN-ONLY / STRICT READ-ONLY — GitHub main SHA f9866efd (PR #336)

Изменений не вносилось: код не редактировался, коммиты не создавались, миграции/RLS/данные/секреты/cron/функции/Publish не затрагивались.

## 1) Managed HEAD и паритет исходников

- Managed HEAD: `f9866efd2b4b8363cf229236392b9364f584e16b` — «Fix CRM token picker label overlap».
- Совпадение с указанным GitHub main SHA — **точное**.
- `git status --porcelain`: пусто. Рабочее дерево чистое, незакоммиченных и незаконченных изменений нет.
- Так как HEAD равен целевому SHA и дерево чистое, паритет всех non-`.lovable` исходных файлов с этим SHA — **полный** (byte-identical по определению состояния дерева).

## 2) Idle window

- Предыдущий scope — завершённый READ-ONLY QA (`/admin/deals` → CRM Automation), без записи данных, фикстур и вызовов очереди.
- Очередь CRM-воркера не запускалась; последний backend-деплой (`crm-pipeline-automation-worker`) уже завершён и верифицирован на предыдущем спринте.
- Незавершённых managed-операций в очереди нет; рабочее окно **idle и безопасно** для frontend-only релиза.

## 3) Узкий EXECUTE-план (frontend-only)

1. **Preflight.** Read-back managed HEAD = `f9866efd2b4b8363cf229236392b9364f584e16b`, дерево чистое. Любое расхождение — стоп.
2. **Sync.** Синхронизировать ровно этот SHA (если HEAD уже равен — sync не требуется).
3. **Gates (read-only).**
   - `tsgo --noEmit` — без ошибок;
   - `npm run build` — успешная сборка;
   - целевой unit-тест токен-пикера/`crmPipelineCanonicalDocumentTokens.test.ts` — PASS.
4. **Security.** `get_scan_results`: отсутствие нерешённых critical findings в scope.
5. **Publish.** Только frontend, ровно на этом SHA. После — отчёт с публичным URL и effective SHA.
6. **Acceptance.** Пользовательская desktop/mobile проверка `/admin/deals` → CRM Automation (пикер плейсхолдеров без наложения текста) выполняется отдельно пользователем.

## 4) Подтверждение отсутствия backend/client-data действий

В этом scope **не выполняются**: миграции, изменения RLS/политик/GRANT, изменения данных, секретов, cron/pg_cron, деплой любых Edge Functions, Storage-операции, создание сессий/пользователей/контактов/задач, платежи, email/Telegram/SMS-сообщения, вызовы очереди и создание фикстур. Только Git-sync, локальные проверки и frontend Publish.

## Hard stop conditions

- HEAD ≠ `f9866efd2…` или дерево грязное (кроме `.lovable` plan-markdown) — стоп.
- Ошибка typecheck/build/тестов — стоп без Publish.
- Новый critical security finding — стоп.
- Любое требование backend-изменения внутри этого scope — стоп и отдельный approve.

## ИТОГ: PLAN PASS — ожидаю «EXECUTE APPROVED».
