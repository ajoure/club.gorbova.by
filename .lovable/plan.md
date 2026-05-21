## Да, согласен, с учетом правок:

1. **PATCH-1 по CORS — правильно.**  
Нужно добавить:

```ts
"Access-Control-Expose-Headers": "Content-Disposition",
```

Но проверить, что этот header уходит **и в основной ответ**, и в `OPTIONS`/CORS preflight, если там отдельная ветка.

2. **В** `downloadDocumentBlob.ts` **после фикса проверить именно чтение header через JS.**  
Не только `curl -I`, а proof в браузере:

```ts
res.headers.get("Content-Disposition")
```

должен вернуть реальное значение, не `null`.

3. **PATCH-2 по истории — правильно.**  
В `DealPayerDocumentsCard.tsx` добавить `file_name` в select и UI.  
Но отображать лучше так:

```text
номер документа + file_name без расширения + дата
```

Если `file_name` уже содержит номер, не страшно, но визуально может быть дубль:

```text
2205/2  Счет-акт ... № 2205-2 ...
```

Это допустимо для proof, но потом можно улучшить отдельным UX-патчем.

4. **Не считать исправленным вопрос мусорных дефисов от кавычек.**  
Сейчас имя:

```text
ЗАО -АЖУР инкам-
```

Это отдельный баг sanitization в `document-filename.ts` / генерации имени.  
В этом патче можно не трогать, если цель только:

- перестать скачивать `document.pdf`;
- показать `file_name` в истории.

Но в отчёте нужно явно написать:

```text
Проблема document.pdf исправлена через CORS expose-header.
Визуальная нормализация кавычек в имени файла остаётся отдельным PATCH.
```

5. **Не менять** `canonical-document-generate-strict` **в этом патче.**  
Согласен: если `file_name` уже записан в БД, то текущий патч должен быть только:
  - `document-download/index.ts`;
  - `DealPayerDocumentsCard.tsx`.
6. **DoD дополнить проверкой нового документа.**  
Нужно проверить два варианта:
  - скачивание уже существующего документа из истории;
  - скачивание сразу после новой генерации.
7. **Proof-файл добавить.**

```text
.lovable/proofs/patch_document_download_filename_history_2026_05.md
```

В нём:

- curl/header proof;
- browser proof `Content-Disposition` читается;
- скрин/описание истории с `file_name`;
- подтверждение, что backend generation не трогали.

Итоговый блок для Lovable:

```text
План согласован.

Выполнить двумя точечными PATCH:

PATCH-1:
- В document-download/index.ts добавить Access-Control-Expose-Headers: Content-Disposition.
- Проверить, что header есть и в обычном ответе, и не теряется из-за CORS/preflight.
- Verify не только curl, но и browser JS: res.headers.get("Content-Disposition") !== null.

PATCH-2:
- В DealPayerDocumentsCard.tsx добавить file_name в HistoryDoc и select.
- В истории показывать document_number + file_name без .pdf/.docx + date.
- Для старых записей fallback: title или "Документ".

Не трогать:
- canonical-document-generate-strict;
- FileNameTemplateEditor;
- document-filename.ts;
- registry/migrations;
- /purchases.

Отдельно в отчёте указать:
- проблема document.pdf исправляется этим патчем;
- проблема визуального имени "ЗАО -АЖУР инкам-" остаётся отдельным PATCH по sanitization кавычек.

DoD:
- document-download отдаёт Access-Control-Expose-Headers: Content-Disposition;
- downloadDocumentBlob видит Content-Disposition и сохраняет файл не как document.pdf;
- история в админ-карточке показывает file_name;
- новая генерация и скачивание из истории оба используют корректное имя из БД.

Отчёт о диагностике
```

Проверил БД и код. Найдено **два независимых бага**:

### Баг 1 (главный — почему скачивается «document (17).pdf»)

`supabase/functions/document-download/index.ts` корректно ставит `Content-Disposition: ...; filename="..."; filename*=UTF-8''...`, но **CORS-заголовки не отдают `Access-Control-Expose-Headers: Content-Disposition**`. Без этого браузер из CORS-ответа не отдаёт заголовок JS, поэтому в `downloadDocumentBlob.ts`:

```
const cd = res.headers.get("Content-Disposition") || "";  // → пусто
```

падает в fallback `"document.pdf"`. Chrome добавляет суффикс `(17)` из-за дубликатов в Загрузках. Имя в БД при этом правильное — проверено:

```
2205/2  Счет-акт - ЗАО -АЖУР инкам- № 2205-2 от 21.05.2026.pdf  (src=template)
2105/5  Счет-акт- Прайс С. В. - ЗАО -АЖУР инкам- № 2105-5 от 21.05.2026.pdf
```

### Баг 2 (история документов в админ-карточке)

`src/components/admin/DealPayerDocumentsCard.tsx`:

- стр. 169: `select(... document_number)` — `file_name` не запрашивается;
- стр. 650: рендер `{h.document_number || h.title || "Документ"}` — показывает только номер.

Поэтому в списке «История (2)» видно только `2105/5  21.05.2026, 12:17:34`, а не итоговое имя файла.

---

## План правок (только UI + CORS, генерация не трогается)

### PATCH-1 — CORS expose-header в `document-download`

Файл: `supabase/functions/document-download/index.ts`

1. В `corsHeaders` добавить:
  ```
   "Access-Control-Expose-Headers": "Content-Disposition",
  ```
2. Re-deploy `document-download`.

DoD:

- `curl -i` к функции возвращает заголовок `Access-Control-Expose-Headers: Content-Disposition`.
- В Preview скачивание из «Истории» сохраняет файл с настоящим именем (`Счет-акт - ... № 2205-2 от 21.05.2026.pdf`), а не `document.pdf`.

### PATCH-2 — Показать имя файла в истории админ-карточки

Файл: `src/components/admin/DealPayerDocumentsCard.tsx`

1. Тип `HistoryDoc` (стр. 53–55) — добавить `file_name: string | null`.
2. Запрос (стр. 169): добавить `file_name` в `select`.
3. Рендер (стр. 650): показать рядом с номером **отрендеренное имя файла без расширения**, например:
  ```
   <span className="font-medium">{h.document_number || "—"}</span>
   <span className="text-foreground/80 ml-2 truncate">
     {(h.file_name || "").replace(/\.(pdf|docx)$/i, "") || h.title || "Документ"}
   </span>
   <span className="text-muted-foreground ml-2">{date}</span>
  ```
   Уже существующая history-вёрстка (`truncate`) сохраняется.

DoD:

- В истории видны строки вида: `2205/2  Счет-акт - ЗАО -АЖУР инкам- № 2205-2 от 21.05.2026  21.05.2026, 22:12:18`.
- Для старых записей без `file_name` (как `2105/4` — `Шаблон. Счёт-акт на услуги ФЛ - Исполнитель.pdf`) показывается то, что есть в БД — без падений.

### Что НЕ меняем

- `canonical-document-generate-strict` — `file_name` уже пишется корректно (подтверждено по 2205/2).
- `FileNameTemplateEditor`, registry, миграции, скачивание в `/purchases`.
- Аналогичный список «История документов сделки» в `DealDocumentsPanel.tsx` — там уже есть отдельный рендер `document_number`; если нужно — поправим тем же приёмом во второй итерации, но в текущем скрине у пользователя именно админ-карточка `/admin/payments`.

### Verify

1. Deploy edge function → `curl -I` проверка expose-header.
2. В Preview (`/admin/payments` → открыть сделку 2205/2) — нажать иконку скачивания в «История»: файл сохраняется как `Счет-акт - ЗАО -АЖУР инкам- № 2205-2 от 21.05.2026.pdf`.
3. Сгенерировать новый документ — он скачивается с правильным именем сразу.
4. В списке «История» видно полное отрендеренное имя.