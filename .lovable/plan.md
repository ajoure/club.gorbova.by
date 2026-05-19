да, согласен, с учетом правок:

1. **Не называть frontend route “proxy” в смысле безопасности.**  
Безопасный источник файла — только edge function `document-download`. Frontend route `/document-download/:documentId` должен быть только UI-обёрткой, которая вызывает edge function и получает blob. Никакой `file_path`, `bucket`, `signedUrl` на frontend не передавать.
2. **Ввести helper для canonical URL, без хардкода** `gorbova.by` **в разных местах.**
  &nbsp;
  Добавить единый helper, например:
  ```ts
  getPublicAppBaseUrl()
  getDocumentDownloadUrl(documentId, kind?)
  ```
  Источник:
  - env `PUBLIC_SITE_URL` / `VITE_PUBLIC_SITE_URL`;
  - fallback в preview — текущий origin;
  - production — `https://gorbova.by`.
  Иначе потом снова появятся разные домены в разных местах.
3. `document-download` **должен поддерживать оба режима: browser route и direct API.**
  Минимум:
  - `GET /functions/v1/document-download?id=<id>&kind=pdf|docx`
  - `POST` с `{ document_id, kind }`
  Но в обоих случаях источник истины — только DB row.
4. **Проверку доступа описать точнее.**
  Для `ai_generated_documents`:
  - обычный пользователь: `document.profile_id` должен принадлежать его `auth.uid()` через `profiles.user_id`;
  - admin/super_admin: доступ через существующие role/permission helpers;
  - если `context_type='order'`, можно дополнительно сверить `orders_v2.profile_id`.
  Если ownership нельзя доказать — `403`, а не fallback.
5. **Не возвращать storage path в публичный response.**
  В `canonical-document-generate-strict` можно оставить `file_path` только для internal/admin/debug, но лучше:
  - в обычном response вернуть `document_id`, `download_url`, `file_name`, `file_mime`;
  - `file_path/storage_bucket` не отдавать клиентскому UI, если не включён debug/admin mode.
6. **Добавить запрет на** `*.supabase.co` **не только в UI-коде, но и в response-proof.**
  &nbsp;
  В Verify:
  ```bash
  rg -n "createSignedUrl|storage/v1/object/sign|supabase.co|download_url" src supabase/functions
  ```
  И отдельно проверить JSON-response генерации:
7. **Legacy-функции не переписывать вслепую.**
  &nbsp;
  Для `document-auto-generate`, `generate-from-template`, `ai-generate-document` сначала discovery:
  - это клиентские ссылки или внутренние storage paths;
  - используются ли они сейчас;
  - кому отправляются.
  Если это legacy и не участвует в текущем flow — зафиксировать backlog, но не ломать.
8. **Добавить** `Content-Disposition` **по** `kind`**.**
  &nbsp;
  Для PDF:
  - можно `inline; filename="..."`, чтобы браузер открывал PDF;
  Для DOCX:
  - лучше `attachment; filename="..."`.
  Filename брать из DB и очищать от опасных символов.
9. **Route** `/document-download/:documentId` **должен уметь показать ошибку без технических деталей.**
  &nbsp;
  Например:
  - `Документ не найден`;
  - `Нет доступа к документу`;
  - `Файл ещё не готов`;
  - `Не удалось скачать документ`.
  Не показывать `bucket`, `file_path`, `Supabase`, stack trace.
10. **Добавить audit log на скачивание.**

В edge function:

- `document.downloaded`
- `document_id`
- `profile_id`
- `actor_user_id`
- `actor_type`
- `kind`
- `source=canonical_document_download`

Это важно, потому что документ юридически значимый.

11. **DoD дополнить проверкой опубликованного домена.**

Не только preview:

- `/document-download/<id>` на preview работает;
- `/document-download/<id>` на `https://gorbova.by` работает;
- адресная строка не меняется на `supabase.co`;
- network может обращаться к edge function, но пользователь не видит storage signed URL.

12. **Public-token ссылки вынести строго в backlog.**

В текущем патче только auth-only.  
Если нужен доступ без логина — отдельный спринт:

```text
document_public_links:
token_hash, document_id, expires_at, max_downloads, revoked_at, audit_logs
```

С этими правками план можно запускать.

&nbsp;

мы уже скрывали ранее адрес супабейс. Проверь также, чтобы не сделать дубли функции. 

План:

1. **Проблема**
  - Сейчас часть document-flow всё ещё создаёт или открывает прямые signed URL вида `*.supabase.co/storage/v1/object/sign/...`.
  - В preview это блокируется браузером/расширениями (`ERR_BLOCKED_BY_CLIENT`).
  - На опубликованном сайте файл открывается, но пользователь/клиент видит технический домен backend-провайдера, что недопустимо.
  - Требование: ссылки на документы не должны вести на `*.supabase.co` и не должны показывать слово/домен Supabase. Внешняя ссылка должна быть на наш домен: `https://gorbova.by/...`.
2. **Диагностика**
  - `src/components/ai-documents/DealDocumentsPanel.tsx` уже частично переведён на blob-download через SDK, но:
    - edge function `canonical-document-generate-strict` всё равно возвращает `download_url` как прямой signed URL;
    - существующие/другие UI-места продолжают создавать signed URL и открывать их через `window.open`.
  - Найдены прямые signed URL в:
    - `supabase/functions/canonical-document-generate-strict/index.ts` — `createSignedUrl(...)` и `download_url` в ответе;
    - `src/hooks/useGeneratedDocuments.tsx` — `createSignedUrl(...)` + `window.open(url)`;
    - `src/components/purchases/OrderDocuments.tsx` — `createSignedUrl(...)` + `window.open(...)`;
    - `src/components/purchases/OrderListItem.tsx` — `createSignedUrl(...)` + `window.open(...)`;
    - legacy-функции `document-auto-generate`, `generate-from-template`, `ai-generate-document` также сохраняют/возвращают signed URL для старого document-flow.
  - Существующего публичного proxy/download route для `ai_generated_documents` по домену сайта не найдено.
  - `ai_generated_documents` уже содержит достаточно данных для ID-first выдачи: `id`, `profile_id`, `context_id`, `file_path`, `storage_bucket`, `file_name`, `file_mime`, `deleted_at`, `status`.
3. **Предлагаемое решение**
  - Ввести единый canonical download endpoint через backend function, например:
    - `GET/POST /functions/v1/document-download?id=<document_id>&kind=pdf|docx`
  - Клиентские публичные/админские URL строить только как:
    - `https://gorbova.by/document-download/<document_id>` или `https://gorbova.by/document-download/<document_id>?kind=docx`
  - На frontend добавить страницу-прокси `DocumentDownloadPage` по маршруту `/document-download/:documentId`, которая:
    - вызывает backend function `document-download`;
    - получает файл как blob;
    - запускает скачивание/открытие через `blob:` URL;
    - не показывает и не открывает `*.supabase.co`.
  - Для админского UI оставить удобное скачивание из карточки сделки, но источник файла должен идти через тот же backend endpoint, а не напрямую через `supabase.storage.createSignedUrl`.
  - В `canonical-document-generate-strict` убрать возврат прямого `download_url` на backend-провайдера; вернуть только:
    - `document_id`,
    - `file_path` для внутреннего аудита/совместимости,
    - `download_url: https://gorbova.by/document-download/<document_id>`.
  - Для email/клиентских ссылок в legacy document-flow заменить прямые signed URL на URL нашего домена там, где это относится к документам.
4. **Изменяемые компоненты**
  - Edge functions:
    - создать `supabase/functions/document-download/index.ts`;
    - изменить `supabase/functions/canonical-document-generate-strict/index.ts`;
    - точечно проверить/обновить legacy document functions, где клиентам отправляются document download links:
      - `supabase/functions/document-auto-generate/index.ts`,
      - `supabase/functions/generate-from-template/index.ts`,
      - `supabase/functions/ai-generate-document/index.ts`.
  - Frontend:
    - добавить route `/document-download/:documentId` в `src/App.tsx`;
    - добавить страницу `src/pages/DocumentDownloadPage.tsx`;
    - обновить скачивание документов в:
      - `src/components/ai-documents/DealDocumentsPanel.tsx`,
      - `src/hooks/useGeneratedDocuments.tsx`,
      - `src/components/purchases/OrderDocuments.tsx`,
      - `src/components/purchases/OrderListItem.tsx`.
  - Shared helper:
    - при необходимости добавить небольшой helper для canonical document URL, чтобы не дублировать домен.
  - База данных:
    - новых таблиц не требуется;
    - migrations не планируются, если endpoint будет читать существующие `ai_generated_documents` / `generated_documents` и проверять доступ через текущую auth-сессию.
5. **Что не будет изменено**
  - Не меняю генерацию PDF/DOCX и Gotenberg.
  - Не меняю document numbering.
  - Не меняю FLD/token mapping.
  - Не меняю auto-fill шаблона/исполнителя из кнопки.
  - Не делаю документы публичными без авторизации, если нет отдельного утверждённого требования на публичный token-link.
  - Не раскрываю клиенту storage path/backend signed URL.
6. **Dry-run**
  - До правок проверить текущие места `createSignedUrl`, `download_url`, `file_url`, `window.open` по document-flow.
  - Подтвердить, что `ai_generated_documents` и legacy `generated_documents` имеют `file_path` и связаны с `profile_id`/`context_id`.
  - Проверить, что новый endpoint может работать ID-first: вход только `document_id` + `kind`, без передачи `file_path` от клиента.
7. **Execute**
  - Создать backend function `document-download`:
    - принимает `document_id` и `kind`;
    - ищет документ по ID в `ai_generated_documents`, fallback — `generated_documents`;
    - проверяет, что документ не удалён/не error;
    - для обычного пользователя разрешает только свой `profile_id`;
    - для admin/super_admin разрешает доступ к документам сделок;
    - выбирает `file_path` только из DB, не из client body;
    - скачивает файл из private bucket через service role внутри function;
    - возвращает бинарный файл с `Content-Type`, `Content-Disposition` и без редиректа на storage URL.
  - Добавить frontend route `/document-download/:documentId`:
    - вызывает `document-download`;
    - создаёт `blob:` URL;
    - открывает/скачивает файл;
    - показывает понятный статус/ошибку без технических backend-доменов.
  - Обновить UI-кнопки скачивания на вызов canonical route/helper.
  - Обновить `canonical-document-generate-strict`, чтобы `download_url` был на `https://gorbova.by/document-download/<document_id>`, а не signed storage URL.
  - Точечно убрать прямые signed URL из клиентских document download paths.
8. **STOP-guards**
  - Остановиться, если найдено, что документ может скачиваться без auth/token и это используется клиентскими email-ссылками как публичный сценарий — тогда нужен отдельный signed business-token, а не auth-only endpoint.
  - Остановиться, если row/document ownership нельзя проверить через `profile_id` или role-check без риска раскрыть чужой документ.
  - Остановиться, если legacy `generated_documents.file_url` используется как внешний SOT и его массовое изменение потребует отдельной миграции/repair.
  - Не принимать `bucket`/`file_path` от клиента как источник истины.
  - Не возвращать `Location` redirect на `*.supabase.co`.
9. **DoD**
  - В новом strict-flow ответ `canonical-document-generate-strict` больше не содержит `*.supabase.co` в `download_url`.
  - Кнопки PDF/DOCX в карточке сделки не открывают storage signed URL.
  - Клиентские документы в покупках не открывают `*.supabase.co`.
  - Route `/document-download/:documentId` работает на published domain и preview без `ERR_BLOCKED_BY_CLIENT`.
  - Поиск по коду для document-flow не показывает прямых `createSignedUrl + window.open` в затронутых местах.
  - Backend function возвращает файл напрямую, с корректным MIME и filename.
  - Нет раскрытия `Supabase`/backend storage domain в адресной строке и в клиентской ссылке.
10. **Риски и зависимости**
  - Если клиентам нужны ссылки без входа в аккаунт, потребуется отдельная tokenized public-download модель с истечением срока и audit; это отдельный безопасный PATCH.
  - Старые уже отправленные email-ссылки с `*.supabase.co` невозможно «переименовать» без повторной отправки/repair.
  - Внутренний SDK всё равно технически ходит к backend endpoint, но пользователь и клиент не должны видеть storage signed URL или переходить на него.
11. **Требуется дополнительная информация**
  - Не требуется для auth-only админского/кабинетного скачивания.
  - Если нужны публичные ссылки клиентам без логина — нужно отдельное подтверждение срока жизни ссылки и правил доступа.