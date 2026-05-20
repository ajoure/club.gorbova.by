# да, согласен.

План корректный: причина диагностирована точно, scope узкий, правка только в `document-download/index.ts`, frontend не трогается, verify покрывает PDF/DOCX и edge logs.

Единственное уточнение для Execute:

```ts
const fallback = kind === "docx" ? "document.docx" : "document.pdf";
```

проверь, чтобы `fileName` не приходил без расширения. Если имя есть, но без `.pdf/.docx`, лучше добавить расширение по `kind`, иначе у пользователя может скачаться файл без расширения.

Добавь в `sanitizeFilename` или отдельный helper:

```ts
function ensureExtension(name: string, kind: "pdf" | "docx"): string {
  const ext = `.${kind}`;
  return name.toLowerCase().endsWith(ext) ? name : `${name}${ext}`;
}
```

И использовать после sanitation:

```ts
const utf8Name = ensureExtension(sanitizeFilename(rawName, fallback), kind);
const asciiName = ensureExtension(asciiFallback(utf8Name, fallback), kind);
```

С этой правкой можно выполнять.

&nbsp;

PATCH-DOC-DOWNLOAD-HEADER-ASCII

## Diagnose (зафиксировано)

- UI `/admin/contacts` → «Создать документ» → `canonical-document-generate-strict` **200** (`document_id=7e281f09…`, `document_number=1905/3`).
- Сразу после: GET `https://hdjgkjceownmmnrqqtuz.functions.supabase.co/document-download?id=…&kind=pdf` → **500** `{"error":"internal_error"}`.
- Лог `document-download`:
  ```
  TypeError: Value is not a valid ByteString
    at new Response (...23_response.js:326:12)
    at handler (file:///.../document-download/index.ts:158:12)
  ```
- Причина: при `new Response(arrayBuf, { headers: { ..., "Content-Disposition":` ${disposition}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)} `} })` переменная `safe` содержит кириллицу («Счёт-акт … 1905/3»). HTTP headers — ByteString (ASCII-only), сырая кириллица в `filename="…"` валит `Response`.
- Frontend (`downloadDocumentBlob.ts`, `DocumentDownloadPage.tsx`) корректно ходит через edge function — ошибка строго на стороне формирования заголовка.

## Scope (что меняем / что НЕ трогаем)

- **Меняем только**: `supabase/functions/document-download/index.ts`.
- **НЕ трогаем**: `DocumentDownloadPage.tsx`, `downloadDocumentBlob.ts`, `buildDocumentDownloadUrl.ts`, `canonical-document-generate-strict`, схему БД, storage, RLS, документ-генерацию, Telegram, provider API.

## Execute — патч edge function `document-download/index.ts`

1. Заменить функцию `safeFilename` тремя helper'ами + builder:
  ```ts
   // Снять path/quote/CRLF — общая база и для UTF-8, и для ASCII имени.
   function sanitizeFilename(name: string, fallback: string): string {
     const cleaned = (name || "").replace(/[\r\n"\\\/]/g, "_").trim();
     return cleaned || fallback;
   }

   // RFC 5987 percent-encoding для filename*.
   function rfc5987(utf8Name: string): string {
     return encodeURIComponent(utf8Name)
       .replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
   }

   // Строго ASCII fallback для filename="...".
   function asciiFallback(utf8Name: string, fallback: string): string {
     const stripped = utf8Name.replace(/[^\x20-\x7E]/g, "_").trim();
     if (!stripped || /^[._\s]+$/.test(stripped)) return fallback;
     return stripped;
   }

   function buildContentDisposition(
     disposition: "inline" | "attachment",
     rawName: string,
     fallback: string,
   ): string {
     const utf8Name = sanitizeFilename(rawName, fallback);     // безопасный UTF-8 (без / \ " CR LF)
     const asciiName = asciiFallback(utf8Name, fallback);      // строго ASCII [0x20-0x7E]
     return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${rfc5987(utf8Name)}`;
   }
  ```
2. В обработчике (строки ~209-220) заменить:
  ```ts
   const safe = safeFilename(fileName || "document", kind === "docx" ? "document.docx" : "document.pdf");
   const disposition = kind === "docx" ? "attachment" : "inline";

   return new Response(arrayBuf, {
     status: 200,
     headers: {
       ...corsHeaders,
       "Content-Type": fileMime || "application/octet-stream",
       "Content-Disposition": `${disposition}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
       "Cache-Control": "private, no-store",
     },
   });
  ```
   на:
3. Деплой `document-download`.

## Verify

1. **Edge-level (curl_edge_functions от админа, preview-сессия `7500084@gmail.com`)**:
  - `GET /document-download?id=7e281f09-1322-4988-a285-3efa4a285c87&kind=pdf` →
    - status `200`
    - `Content-Type: application/pdf`
    - `Content-Disposition: inline; filename="..."; filename*=UTF-8''...` (значение `filename=` — только символы `[0x20-0x7E]`, `filename*=UTF-8''…` — корректный percent-encoded кириллический заголовок)
    - тело — PDF (магия `%PDF`).
  - `GET …&kind=docx` (на документе с `meta.docx_storage_path`) →
    - status `200`,
    - `Content-Disposition: attachment; filename="..."; filename*=UTF-8''...`,
    - без `ByteString` ошибок. Если у документа нет DOCX — допустимо `404 docx_not_available` (контракт не ломаем).
2. **UI**: в `/admin/contacts` → «Создать документ» — toast «Документ создан», файл скачивается, тост `Внутренняя ошибка` исчезает.
3. **Логи**: `edge_function_logs document-download` после прогона — нет `TypeError: Value is not a valid ByteString`.

## DoD

- `document-download` отдаёт 200 для PDF и DOCX даже при кириллических `file_name`.
- `Content-Disposition` валиден: ASCII `filename=` + percent-encoded `filename*=UTF-8''…`.
- UTF-8 имя предварительно очищено от `/ \ " CR LF` (`sanitizeFilename`).
- ASCII fallback гарантирован regex `[^\x20-\x7E] → "_"` + защита от «пустого мусора» → fallback `document.pdf`/`document.docx`.
- Frontend не менялся; canonical URL (`gorbova.by/document-download/...`) + blob-only поведение сохранены.
- Создан proof `.lovable/proofs/patch_doc_download_header_ascii_2026_05.md` с curl-выводом заголовков (PDF + DOCX) и записью лога «нет ByteString после деплоя».

## Artifacts

- `supabase/functions/document-download/index.ts` (правка)
- `.lovable/proofs/patch_doc_download_header_ascii_2026_05.md` (proof)