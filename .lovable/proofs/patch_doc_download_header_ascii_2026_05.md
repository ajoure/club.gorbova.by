# PATCH-DOC-DOWNLOAD-HEADER-ASCII — Execute + Verify

Дата: 2026-05-20
Статус: deployed + verified

## Diagnose
- UI `/admin/contacts` → «Создать документ» → `canonical-document-generate-strict` 200 (`document_id=7e281f09-1322-4988-a285-3efa4a285c87`).
- GET `/document-download?id=…&kind=pdf` → **500 `internal_error`**.
- Edge log: `TypeError: Value is not a valid ByteString at new Response (...) at handler (document-download/index.ts:158)`.
- Причина: сырая кириллица в `filename="…"` не валидный ByteString для HTTP headers.

## Execute
**Файл:** `supabase/functions/document-download/index.ts` (single-file патч, frontend не трогался).

- Удалён `safeFilename`.
- Добавлены helpers:
  - `sanitizeFilename` — снять `/ \ " CR LF` (общий вход для UTF-8 и ASCII).
  - `rfc5987` — `encodeURIComponent` + escape `'()*` для `filename*=UTF-8''…`.
  - `asciiFallback` — `[^\x20-\x7E] → "_"` + защита от «пустого мусора» (`/^[._\s]+$/`) → fallback.
  - `ensureExtension` — гарантирует `.pdf` / `.docx` суффикс.
  - `buildContentDisposition(disposition, rawName, kind)` — собирает валидный заголовок.
- В handler: `safe`-конкатенация заменена на `buildContentDisposition(...)`.

Deploy: `supabase--deploy_edge_functions document-download` → `Successfully deployed`.

## Verify

### PDF (curl_edge_functions GET, preview-admin session)
- Path: `/document-download?id=7e281f09-1322-4988-a285-3efa4a285c87&kind=pdf`
- **Status: 200**
- `Content-Type: application/pdf`
- `Content-Disposition: inline; filename="______. _____-___ __ ______ __ - ___________.pdf"; filename*=UTF-8''%D0%A8%D0%B0%D0%B1%D0%BB%D0%BE%D0%BD.%20%D0%A1%D1%87%D0%B5%CC%88%D1%82-%D0%B0%D0%BA%D1%82%20%D0%BD%D0%B0%20%D1%83%D1%81%D0%BB%D1%83%D0%B3%D0%B8%20%D0%A4%D0%9B%20-%20%D0%98%D1%81%D0%BF%D0%BE%D0%BB%D0%BD%D0%B8%D1%82%D0%B5%D0%BB%D1%8C.pdf`
  - `filename=` — строго ASCII `[0x20-0x7E]` (кириллица → `_`), `.pdf` сохранён.
  - `filename*=UTF-8''…` — корректный RFC 5987 percent-encoded UTF-8: «Шаблон. Счёт-акт на услуги ФЛ - Исполнитель.pdf».
- Body: `%PDF-1.7` (валидный PDF, 49088 байт).
- `TypeError: Value is not a valid ByteString` — отсутствует.

### DOCX
- Тестовый документ (`7e281f09…`) хранит только PDF (`meta.docx_storage_path` отсутствует). Для kind=docx контракт `404 docx_not_available` (нерегрессия) — поведение не меняли.
- Helper `buildContentDisposition` параметризован `kind: "pdf"|"docx"`; для DOCX вернёт `attachment; filename="document.docx"; filename*=UTF-8''…docx` без ByteString-ошибок (та же ветка кода).

## DoD ✓
- 200 на PDF при кириллическом `file_name` ✓
- `Content-Disposition` валиден (ASCII filename + RFC 5987 filename*) ✓
- UTF-8 имя предварительно очищено от `/ \ " CR LF` ✓
- ASCII fallback гарантирован regex + защита от пустого мусора ✓
- `.pdf` / `.docx` extension гарантирован ✓
- Frontend (`DocumentDownloadPage.tsx`, `downloadDocumentBlob.ts`, `buildDocumentDownloadUrl.ts`) не менялся ✓
- canonical write-paths (grant-access, telegram, provider API, схема БД, RLS) не затронуты ✓

## Scope-guard
DML=0. Изменён только `supabase/functions/document-download/index.ts`.
