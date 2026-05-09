# C5-J — DOCX → PDF через Gotenberg на VPS hoster.by

**Статус**: ВЫПОЛНЕНО. Конвертация DOCX→PDF интегрирована в `canonical-document-generate-strict`. Жду ввода кредов в админке + проверки Health/Test convert.

## 1. Модель хранения секретов (DB + ENV fallback)

| Поле | Источник | Канон |
|---|---|---|
| `GOTENBERG_BASE_URL` | DB.gotenberg_url ИЛИ ENV | DB > ENV |
| `GOTENBERG_USERNAME` | DB.gotenberg_basic_user ИЛИ ENV | DB > ENV |
| `GOTENBERG_PASSWORD` | **ТОЛЬКО ENV** (Supabase secrets) | NEVER в DB |
| `gotenberg_enabled` | DB | DB only |

Миграция `20260509205730_*` удалила любой ранее сохранённый `gotenberg_basic_pass` из `integration_instances.config`. `gotenberg_save_config` action больше **не принимает** пароль — он отвергается на уровне UI.

ENV-секреты добавлены: `GOTENBERG_BASE_URL`, `GOTENBERG_USERNAME`, `GOTENBERG_PASSWORD` (см. `secrets--fetch_secrets`).

## 2. SSRF allowlist

`supabase/functions/_shared/gotenberg.ts` → `isUrlAllowed(url)`:
- ✅ `pdf.gorbova.by` (production)
- ✅ `127.0.0.1` / `localhost` — только если `GOTENBERG_ALLOW_LOCAL=true`
- ❌ Всё остальное → `GOTENBERG_URL_NOT_ALLOWED` или `GOTENBERG_SSRF_BLOCKED`

Дублируется в `gotenberg_save_config` action, чтобы нельзя было сохранить «левый» URL.

## 3. Helper API (`_shared/gotenberg.ts`)

| Функция | Назначение |
|---|---|
| `loadGotenbergConfig(client)` | DB > ENV resolution, возвращает `{url, basicUser, basicPass, enabled, source}` |
| `gotenbergHealthCheck(cfg)` | `GET /health`, парсит `status / chromium / libreoffice` |
| `convertDocxToPdf(cfg, docx, name)` | LibreOffice route, 120s timeout, валидация PDF |
| `convertHtmlToPdf(cfg, html)` | Chromium route (`/forms/chromium/convert/html`) |
| `buildTestDocx()` | Тестовый DOCX (кириллица + таблица) |
| `maskGotenbergConfig(cfg)` | Masked status для UI: `password_configured`, `password_last4`, `*_source` |

`fetchWithRetry`: 1 retry на network/timeout/5xx, **никогда** на 4xx.

`GotenbergError` коды: `GOTENBERG_NOT_CONFIGURED | GOTENBERG_DISABLED | GOTENBERG_URL_NOT_ALLOWED | GOTENBERG_SSRF_BLOCKED | GOTENBERG_UNREACHABLE | GOTENBERG_AUTH_FAILED | GOTENBERG_HTTP_ERROR | GOTENBERG_NOT_PDF | GOTENBERG_PDF_TOO_SMALL | GOTENBERG_TIMEOUT`.

## 4. Интеграция в `canonical-document-generate-strict`

`mode='generate'`:
1. C5-G: pre-create row + `allocate_document_number` (как раньше).
2. Render DOCX (Docxtemplater).
3. **`convertDocxToPdf(cfg, docxBuffer)`** — НОВОЕ.
4. Upload PDF → `documents/generated/{order}/{ts}-{tpl}.pdf` как primary.
5. Upload DOCX → `documents/generated/{order}/{ts}-{tpl}.docx` (admin-only через meta).
6. Update `ai_generated_documents`: `file_path=PDF`, `file_mime='application/pdf'`, `meta.docx_storage_path=DOCX`.
7. Audit `document.pdf_converted` + `document.generated`.

**При ошибке Gotenberg:**
- pre-created row НЕ обновляется.
- Номер C5-G **остаётся зарезервированным** на этой строке (через `idempotency_key`).
- Audit `document.pdf_failed` с кодом ошибки.
- Возврат HTTP 502 с `code=GOTENBERG_*`.
- Retry с тем же `idempotency_key` → переиспользует тот же `document_number` → нумератор не теряется и не дублируется.

`mode='preview'` — без изменений, никакой записи в `ai_generated_documents`, никаких вызовов Gotenberg.

## 5. UI

- `GotenbergSettingsCard`: показывает источник URL/user (DB/ENV), статус пароля (`задан в ENV (…last4)` / `не задан`), модули `chromium`/`libreoffice` из health.
- `GotenbergSetupDialog`: убрано поле пароля. Только URL + username + enabled. Форма явно сообщает, что пароль идёт через `GOTENBERG_PASSWORD` Supabase secret.

## 6. Безопасность (DoD)

- ✅ Пароль не хранится в DB (миграция + блокировка save_config).
- ✅ Пароль не отдаётся клиенту (только `password_last4` от ENV).
- ✅ `frontend bundle`: grep `GOTENBERG_PASSWORD` в `src/` → 0 совпадений.
- ✅ Все вызовы Gotenberg идут только из edge functions (`hosterby-api`, `canonical-document-generate-strict`).
- ✅ SSRF allowlist жёсткий (только `pdf.gorbova.by`).
- ✅ Audit без секретов: только `gotenberg_url`, `latency_ms`, `pdf_size`, `code`.
- ✅ Retry policy: 1 retry на network/5xx, без retry на 4xx.
- ✅ C5-G integrity: на ошибке Gotenberg номер не теряется (idempotency reuse).

## 7. Что нужно от пользователя (последний gate)

1. Открыть `/admin/integrations/other` → карточка **Gotenberg**.
2. Должно отобразиться: `URL: https://pdf.gorbova.by (ENV)`, `Пароль: задан в ENV (…last4)`.
3. Нажать **Health-check** → ожидание зелёного: `HTTP 200`, `chromium:up`, `libreoffice:up`.
4. Нажать **Test DOCX→PDF** → ожидание `pdf_size > 10240`.
5. После двух зелёных — реальная генерация документа из карточки сделки сохранит PDF (primary) + DOCX (admin meta).

## 8. Что НЕ менялось

- C5-G нумератор (`allocate_document_number`) — порядок вызова, идемпотентность.
- `mode='preview'` поведение.
- Email/Telegram/batch/auto-generation потоки.
- Legacy `generate-document-pdf` — остаётся deprecated.
