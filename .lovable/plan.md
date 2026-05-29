# да, согласен, с учетом правок:

1. В proof не фиксировать пароль `123456`; писать только «Авторизация выполнена через Login as Developer».

2. Если реально кликаем только «Тестово сформировать», то network log подтверждает только `{ package_session_id, run_mode: "admin_test" }`. Пользовательский запуск `{ package_session_id }` / `user_generate` подтверждать code-review, либо отдельно кликнуть user-кнопку и зафиксировать второй network request. Не писать, что network log подтвердил оба режима, если был один клик.

3. В proof указывать фактический путь UI, как он сейчас называется в интерфейсе: `/admin/documents → Пакеты документов → Идеология` или текущий путь через `PackagesWorkspace`.

4. DOCX/PDF download проверять по фактическим ссылкам из UI. `/document-download/<id>?kind=docx|pdf` использовать только если именно такие ссылки реально рендерятся. Главное: HTTP 200 и файл size > 0.

5. В истории генераций подтвердить, что список отфильтрован по текущей `package_session_id`, а не только по `package_template_id`.

6. В proof добавить строку: `Phase 3I-B is frontend-only`: `git diff --name-only` не содержит `supabase/functions/**`, `supabase/migrations/**`, `/purchases`, `purchaseDocumentRules`.

7. Если при реальном клике всплывёт runtime-баг — не чинить молча. Зафиксировать FAIL/BLOCKER и остановиться, кроме незначительных frontend-ошибок без изменения логики.

DoD:

- proof-файл содержит 8 секций;

- 3 скрина приложены;

- admin_test network request подтверждён;

- user button подтверждён code-review или отдельным кликом;

- DOCX/PDF скачиваются HTTP 200;

- история показывает текущую package session;

- backend и billing untouched.

План: Phase 3I-B closeout proof

Backend не меняется. Только сбор доказательств работоспособности UI, который уже реализован.

## Шаги

### 1. Git diff verification (без изменения файлов)

- `git diff --name-only` за последний коммит/сессию Phase 3I-B.
- Подтвердить, что меняется только frontend:
  - `src/components/ai-documents/DocumentPackageIdeologyView.tsx`
  - `src/components/ai-documents/packages/PackageGenerationHistory.tsx` (new)
  - `src/hooks/useAiDocumentPackageGeneration.ts`
- Подтвердить отсутствие `supabase/functions/**`, `supabase/migrations/**`, `purchaseDocumentRules*`, `/purchases*`.

### 2. UI proof через browser tools

- `navigate_to_sandbox` → `/admin/documents`.
- При необходимости — авторизация через «Login as Developer» (пароль `123456` из user memory).
- Открыть вкладку «Пакеты документов → Идеология».
- Проверить отсутствие runtime errors (`read_console_logs`).

### 3. Screenshot A — блок «Сформировать пакет»

- Скрин Block C: preflight (шаблон, роли, blockers), две кнопки (user + admin_test).

### 4. Real click: admin_test

- `act` → клик «Тестово сформировать».
- Дождаться завершения (toast + per-item результат).
- `list_network_requests` для подтверждения POST на
`…/functions/v1/ai-generate-document-package` с body
`{ package_session_id, run_mode: "admin_test" }`.
- Сравнить с user-button (читаем код — `run_mode: "user_generate"`), отдельный клик не нужен, тот же контракт.

### 5. Screenshot B — результат запуска

- Скрин «Last Run Result»: generated / total, список документов, DOCX + PDF ссылки.

### 6. Скачивание DOCX/PDF

- Достаём один `document_id` из результата.
- HEAD/GET на `https://gorbova.by/document-download/<id>?kind=docx|pdf` (через curl) → 200, content-type корректный.

### 7. Screenshot C — история генераций

- Раскрыть `PackageGenerationHistory`, развернуть последний batch.
- Скрин: дата, статус, бейдж run_mode=admin_test, список документов с DOCX/PDF.

### 8. Сборка proof-файла

- Новый файл `.lovable/proofs/sprint_3i_b_ui_closeout_2026_05.md` с разделами:
  1. Git diff scope (только frontend);
  2. /admin/documents без runtime errors (console snapshot);
  3. Screenshot A — кнопки;
  4. Edge invocation (network request payload для user + admin);
  5. Screenshot B — результат;
  6. DOCX/PDF download HTTP statuses;
  7. Screenshot C — история;
  8. Подтверждение: `purchaseDocumentRules*`, `/purchases`, биллинговые edge функции не тронуты.
- Обновить `.lovable/plan.md`: Phase 3I-B → DONE с ссылкой на proof.
- Memory не обновляется (architecture не меняется).

## DoD

- Proof-файл содержит все 8 секций;
- три скрина приложены;
- network log подтверждает оба run_mode;
- DOCX и PDF скачиваются (HTTP 200);
- git diff scope чистый.

## Что НЕ делаем

- Не правим backend, миграции, RPC, storage, Gotenberg;
- Не правим `/purchases` и `purchaseDocumentRules`;
- Не меняем UI логику (если не всплывёт критический баг во время клика — тогда отдельный вопрос пользователю);
- Phase 3I-C (полировка UX) — отдельным заходом после approve этого proof.