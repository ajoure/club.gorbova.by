да, согласен, с учетом правок:

1. **Не путать два уровня URL**
  - Адресная строка пользователя: только `gorbova.by`.
  - Network-запрос к Edge Function может идти на Supabase Functions host, если это внутренний XHR/fetch и он не показывается пользователю.
  - Запрещено именно: `window.open(signedUrl)`, `<a href=signedUrl>`, `download_url` со `supabase.co`, редирект на storage.
2. `DocumentDownloadPage` **оставить обязательным, но не полагаться на него после генерации**
  - После `Создать документ` — сразу `downloadDocumentBlob(document_id, "pdf")`.
  - `/document-download/:documentId` — fallback для ручного открытия ссылки, истории, email/auth-only кабинета.
  - Если published bundle старый и route даёт 404 — это решается публикацией, но админский flow уже не должен зависеть от route.
3. **В** `canonical-document-generate-strict` **не возвращать storage signed URL вообще**  
Даже если UI его больше не использует, response не должен содержать `supabase.co`.
  &nbsp;
  Возвращать:

```ts
{
  document_id,
  download_url: getDocumentDownloadUrl(document_id, "pdf"),
  docx_download_url: getDocumentDownloadUrl(document_id, "docx")
}
```

4. `useAiDocuments.getDownloadUrl()` **не заменять на “URL”, а переименовать по смыслу**  
Если функция теперь скачивает blob, не оставлять название `getDownloadUrl`, чтобы следующий разработчик снова не начал открывать URL.
  &nbsp;
  Лучше:
  - `downloadAiDocument(documentId, kind)`
  - `openAiDocumentBlob(documentId, kind)`
5. **В** `DocumentLogTab` **и** `AdminDocumentsNumbering` **не выбирать kind вслепую**  
Если в row есть `file_mime` / `file_name`:
  - PDF → `"pdf"`;
  - DOCX → `"docx"`;
  - иначе fallback по расширению `file_path`.
6. **В** `document-download` **проверить, что kind реально соответствует файлу**  
Не позволять запросить `kind=pdf`, если у документа есть только DOCX, если только в БД нет отдельного PDF-path.
  &nbsp;
  Если PDF ещё не готов:

```text
409: document_pdf_not_ready
```

6. UI показывает: «PDF ещё не готов. Попробуйте скачать DOCX или повторите позже.»
7. **Добавить защиту от старого** `download_url`  
В местах, где response генерации всё ещё содержит `download_url`, не использовать его напрямую. Использовать только `document_id`.
  &nbsp;
  Пример:

```ts
if (!result.document_id) throw new Error("document_id_missing");
await downloadDocumentBlob(result.document_id, "pdf");
```

8. **Dry-run должен показать не просто** `rg`**, а таблицу мест**
  &nbsp;
  В proof:


| **файл**               | **старое поведение**      | **новое поведение**      | **статус** |
| ---------------------- | ------------------------- | ------------------------ | ---------- |
| DealPayerDocumentsCard | window.open(download_url) | downloadDocumentBlob(id) | fixed      |
| DocumentLogTab         | createSignedUrl           | downloadDocumentBlob(id) | fixed      |
| …                      | …                         | …                        | …          |


9. **DoD добавить проверку “нет supabase.co в user-facing strings”**
  &nbsp;
  Проверить:
  - `download_url` response;
  - rendered links/buttons;
  - toast/error text;
  - `href` в DOM;
  - `window.open(...)`.
10. **Если Edge Function** `document-download` **не задеплоена — не чинить UI “вслепую”**  
Перед UI-заменами сделать test call:

- существующий `document_id`;
- admin session;
- получить `200` + blob;
- проверить `Content-Type`.

11. **Финальный proof должен быть на published domain**  
Не только preview. Минимум:

- создать/открыть документ на `gorbova.by`;
- скачать из карточки сделки;
- открыть из истории;
- убедиться, что нет 404 и нет перехода на `supabase.co`.

С этими правками план можно запускать.

&nbsp;

План:

1. **Проблема**
  - После создания документа открывается `https://gorbova.by/document-download/<uuid>`, но пользователь видит 404 «Страница не найдена».
  - Дополнительно в коде ещё остались старые точки, которые открывают signed URL напрямую через storage, что нарушает требование «не показывать backend/storage-домен».
2. **Диагностика**
  - В `src/App.tsx` маршрут `/document-download/:documentId` уже объявлен.
  - На опубликованном домене SPA fallback должен работать автоматически; документация Lovable подтверждает, что отдельные `_redirects`/rewrites не нужны.
  - Поэтому текущий 404 с большой вероятностью означает одно из двух:
  1. опубликованная версия ещё не содержит нового маршрута;
  2. ссылка открывается через компонент/ветку, где всё ещё используется старый `window.open(download_url)` или signed URL.
    йдены оставшиеся проблемные места:
    `src/components/admin/DealPayerDocumentsCard.tsx`: после генерации открывает `download_url`, история создаёт `createSignedUrl` и `window.open`.
    `src/components/admin/DocumentLogTab.tsx`: создаёт signed URL из bucket/path.
    `src/pages/admin/AdminDocumentsNumbering.tsx`: создаёт signed URL из bucket/path.
    `src/hooks/useAiDocuments.ts`: helper `getDownloadUrl()` возвращает signed URL.
    ocumentDownloadPage`и`downloadDocumentBlob`сейчас внутри страницы вызывают backend function напрямую через`*.functions.supabase.co`; это не видно в адресной строке, но технически request всё ещё идёт на backend host.
3. **Предлагаемое решение**
  - Сделать пользовательский путь `/document-download/:documentId` безопасным fallback-маршрутом: если React-страница загружена, она скачивает файл blob-ом и не показывает storage/backend URL.
  - Перевести оставшиеся UI-точки документов на `downloadDocumentBlob(documentId, kind)` вместо `window.open(download_url)` и `createSignedUrl`.
  - Для `DealPayerDocumentsCard` после генерации не открывать новую вкладку с `/document-download/...`, а сразу скачивать blob по `document_id`, как уже сделано в `DealDocumentsPanel`. Это убирает 404 даже если опубликованный SPA bundle/кэш ещё не обновился.
  - Обновить историю документов в той же карточке: скачивать по `h.id`, не по `file_path/storage_bucket`.
  - Убрать/заменить helper `getDownloadUrl()` в `useAiDocuments`, чтобы новые UI не могли получить storage signed URL.
4. **Изменяемые компоненты**
  - UI:
    - `src/components/admin/DealPayerDocumentsCard.tsx`
    - `src/components/admin/DocumentLogTab.tsx`
    - `src/pages/admin/AdminDocumentsNumbering.tsx`
    - `src/hooks/useAiDocuments.ts`
  - Возможная минимальная правка:
    - `src/pages/DocumentDownloadPage.tsx` — оставить как fallback-страницу, но не полагаться на неё в админской кнопке создания.
  - Таблицы/RPC/cron/jobs:
    - не меняются.
  - Edge functions:
    - не меняются, если после проверки не обнаружится, что `document-download` не задеплоен.
5. **Что не будет изменено**
  - Генерация PDF/DOCX.
  - Нумерация документов.
  - Заполнение шаблонов/плательщика/исполнителя.
  - Публичные клиентские ссылки без логина — это отдельный токенизированный сценарий, не смешиваю с текущим auth-only скачиванием.
  - Старые email-ссылки, уже отправленные ранее, не переписываются этим патчем.
6. **Dry-run**
  - До правок проверить, что все оставшиеся `createSignedUrl` в документном UI действительно относятся к скачиванию сгенерированных документов.
  - После правок выполнить поиск по:
    - `createSignedUrl(`
    - `window.open(data.signedUrl`
    - `window.open(url, "_blank")` рядом с document generation
    - `download_url` в document UI
  - STOP, если найденная точка относится не к документам, а к другому модулю/вложениям/медиа.
7. **Execute**
  - Добавить импорт `downloadDocumentBlob` в оставшиеся документные UI.
  - В `DealPayerDocumentsCard.generate()` заменить `window.open(download_url)` на скачивание по `document_id`.
  - В `DealPayerDocumentsCard.downloadHistoryItem()` заменить signed URL на скачивание по `h.id`.
  - В `DocumentLogTab.handleDownload()` заменить signed URL на `downloadDocumentBlob(doc.id, "pdf")`; счётчик скачиваний оставить только если он относится к legacy `generated_documents` и не конфликтует с backend audit.
  - В `AdminDocumentsNumbering.openDoc()` заменить signed URL на `downloadDocumentBlob(r.id, "pdf")`.
  - В `useAiDocuments.getDownloadUrl()` либо удалить экспорт/использование, либо заменить на безопасный canonical flow без возврата backend/storage URL.
8. **STOP-guards**
  - Не трогать `src/integrations/supabase/client.ts` и generated types.
  - Не добавлять новые таблицы/RPC/functions без доказанной необходимости.
  - Не возвращать bucket/path/signed URL в UI.
  - Не менять auth/RLS/права доступа в этом патче.
  - Не делать массовые UPDATE/DELETE.
9. **DoD**
  - Кнопка «Создать документ» в карточке сделки после генерации скачивает PDF без перехода на 404.
  - История документов скачивает файл через blob, не открывая storage/backend URL.
  - В документном UI не осталось прямых `createSignedUrl + window.open` для generated documents.
  - Адресная строка пользователя остаётся на `gorbova.by`/текущей админской странице либо на `/document-download/<uuid>`, без `*.supabase.co`.
  - Ошибки показываются нейтральным текстом, без bucket/file_path/backend host.
10. **Риски и зависимости**
  - Если опубликованный сайт не содержит свежий bundle, прямой вход на `/document-download/<uuid>` будет 404 до публикации новой версии; обход через blob в кнопке создания решает текущий рабочий сценарий.
  - Для ссылок клиентам без авторизации понадобится отдельный безопасный token-flow; текущий `document-download` требует JWT.
  - Старые уже отправленные storage signed URL останутся старыми до отдельного repair/discovery.