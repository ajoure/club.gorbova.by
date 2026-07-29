
# EXECUTE — SHA 427c3c5b66402b660f87ebb2b9e036498ced68c4 (PR #215)

## Preflight (уже подтверждено read-only)
- `git rev-parse HEAD` = `427c3c5b66402b660f87ebb2b9e036498ced68c4`.
- `git rev-parse origin/main` = `427c3c5b66402b660f87ebb2b9e036498ced68c4`.
- Application tree матчит SHA (worktree чистый на этом коммите).
- Файл миграции `supabase/migrations/20260729180632_manual_payment_fully_paid_guard.sql` присутствует.
- Файл `supabase/functions/_shared/caller-user.ts` присутствует.
- Mismatch отсутствует → продолжаем.

## Шаги (строго read-back-guarded, без создания данных)

1. **Apply migration** `20260729180632_manual_payment_fully_paid_guard.sql` через `supabase--migration`. Read-back: SELECT из `pg_trigger`/`pg_proc` для подтверждения, что guard-триггер существует и `tgenabled != 'D'`.

2. **Deploy exactly 8 Edge Functions** одной операцией `supabase--deploy_edge_functions`:
   - `admin-create-manual-payment`
   - `admin-retry-manual-payment-downstream`
   - `invoice-delivery-status`
   - `invoice-delivery-retry`
   - `invoice-pdf-retry`
   - `canonical-document-send`
   - `canonical-document-generate-strict`
   - `external-document-form`
   
   Read-back: `rg -l "_shared/caller-user" supabase/functions/{list}/index.ts` — все 8 должны импортировать shared helper.

3. **Cloud status**: `supabase--cloud_status` = `ACTIVE_HEALTHY`.

4. **Anonymous 401 probes** (без Authorization) на:
   - `POST /invoice-delivery-status` → ожидание function-level 401 JSON.
   - `POST /invoice-delivery-retry` → 401 JSON.
   - `POST /admin-create-manual-payment` → 401 JSON.

5. **Authenticated read-only status probe** через `supabase--curl_edge_functions` (auto-inject preview session):
   - `POST /invoice-delivery-status` с `{"document_id":"2fc9da4a-00e4-49cf-a326-e2d8f8cca091"}` — тот же документ, что использовался в предыдущем PLAN-ONLY.
   - Ожидание: HTTP 200 JSON с полями `document_id`, `pdf_ready`, `delivery`. НЕ 401 / non-2xx.
   - `retry`/`send`/новые платежи не запускаются.

6. **Log inspection**: `supabase--edge_function_logs` для `invoice-delivery-status` — искать `auth_rejected` для authenticated запроса (не должно быть) и любые HTTP 500 (не должно быть).

7. **Frontend Publish** через `preview_ui--publish` (без slug). SHA публикации ожидается `427c3c5b`.

## Финальный отчёт пользователю
- Опубликованный URL + SHA/deployment id из ответа Publish.
- PASS/FAIL по каждому read-back (1–6).
- Точный список 8 задеплоенных функций и подтверждение импорта shared helper.
- Статус миграции и триггера.
- Cloud status.

## Стоп-правила
- SHA mismatch, migration failure, missing shared helper import, 500 из читающего probe, новый critical finding — STOP, без Publish, без изменений, отчёт о блокере.
- Ни при каких обстоятельствах не создаём платежи/счета, не запускаем retry/send, не трогаем контакты/сделки/подписки/access.
