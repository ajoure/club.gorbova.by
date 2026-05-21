да, согласен, с учетом правок:

1. **Сначала подтвердить** `FLD-000069` **и** `FLD-000263` **по registry.**  
Перед фиксом добавить read-only proof:

```sql
SELECT fr.public_id, fr.key, fr.label, fr.data_type,
       dtr.token_key, dtr.ui_label
FROM fields_registry fr
LEFT JOIN document_token_registry dtr ON dtr.field_id = fr.id
WHERE fr.public_id IN ('FLD-000069','FLD-000263','FLD-000314','FLD-000368');
```

Нужно доказать:

- `FLD-000069` — номер документа;
- `FLD-000263` — дата платежа или другая дата, которую реально хотят в имени;
- `FLD-000314` / `FLD-000368` — те поля, которые ожидаются в имени.

2. **Не добавлять** `fileNameTemplate` **вторым SELECT, если он уже загружается ниже.**  
Лучше перенести существующую загрузку `document_templates.file_name_template` выше, чтобы не было двух разных запросов и риска рассинхронизации.
3. `filenameFlds` **должен включать только валидные FLD.**  
Если в шаблоне имени есть невалидный плейсхолдер, например `{{payer_short_name}}`, он не должен попадать в `foundIds`.  
Он должен остаться warning в `renderFileName`.
4. **Расширение** `foundIds` **должно происходить до numbering-check.**  
Это главный пункт. Если `FLD-000069` есть только в имени файла, numbering всё равно должен сработать.
5. **Нельзя брать** `resolved[field:${fld}]` **только если значение непустое.**  
Сейчас в плане:

```ts
if (direct !== undefined && direct !== '') { ... }
```

Нужно аккуратнее. Пустая строка тоже может быть валидным resolved-значением, например поле реально пустое. Лучше:

```ts
if (Object.prototype.hasOwnProperty.call(resolved, `field:${fld}`)) {
  filenameTokenMap[fld] = resolved[`field:${fld}`] ?? '';
  continue;
}
```

Иначе будет непредсказуемый fallback.

6. **Для номера документа использовать итоговое значение после allocator override.**  
Если `FLD-000069` связан с `document.number`, нужно убедиться, что в `filenameTokenMap` попадает уже настоящий номер, например `2105/2`, а не пустое/preview/старое значение.
7. **Дата в имени файла должна рендериться через тот же формат, что и field-resolver.**  
Не добавлять отдельный новый формат даты. Если `applyFormat` без модификатора даёт текущий системный формат — использовать его. Если отдаёт ISO, тогда локальный fallback допустим, но только для имени файла и с proof.
8. `renderFileName` **получает** `FLD-keyed map`**, но в proof нужно явно показать оба слоя.**

В отчёте добавить таблицу:

```text
FLD-000314 → field:FLD-000314 → value
FLD-000368 → field:FLD-000368 → value
FLD-000069 → field:FLD-000069 → value
FLD-000263 → field:FLD-000263 → value
```

9. **Не удалять тестовый документ, если он нужен как proof.**  
Лучше:
  &nbsp;
  - создать новый тестовый документ с новым idempotency_key;
  - либо удалить только явно тестовый документ, если он помечен smoke/test meta.  
  Не удалять пользовательский документ без отдельного подтверждения.
10. **DoD дополнить проверкой скачивания.**  
Недостаточно проверить `ai_generated_documents.file_name`. Нужно ещё проверить:

&nbsp;

- `document-download` отдаёт это имя в `Content-Disposition`;
- PDF скачивается с новым именем;
- нет `file_name_warnings`.

11. **Добавить anti-regression для шаблона без** `file_name_template`**.**  
Проверить один шаблон с `file_name_template IS NULL`: системный дефолт имени файла работает как раньше.
12. **Файл действительно один.**  
Подтвердить, что меняется только:

```text
supabase/functions/canonical-document-generate-strict/index.ts
```

`document-filename.ts`, frontend, миграции, `document-download`, `canonical-document-send` — не трогать.

Готовый блок для Lovable:

```text
План согласован, но выполни с правками:

1. Перед фиксом read-only proof по FLD-000069/263/314/368 через fields_registry + document_token_registry. Подтвердить, что FLD-000069 — номер документа.

2. Не делать второй независимый SELECT file_name_template. Перенести существующую загрузку document_templates.file_name_template выше, до needsNumbering/foundIds.

3. filenameFlds добавлять в foundIds только для валидных {{field:FLD-XXXXXX}}. Невалидные плейсхолдеры остаются warning в renderFileName.

4. Расширить foundIds до блока needsNumbering, чтобы номер документа аллоцировался даже если FLD-000069 есть только в file_name_template.

5. При построении filenameTokenMap проверять наличие ключа в resolved через hasOwnProperty, а не через direct !== ''. Пустая строка может быть валидным resolved value.

6. Для FLD-000069 использовать итоговое значение после allocator override, чтобы в имени файла был реальный номер документа.

7. Дату форматировать тем же способом, что field-resolver. Не вводить новый формат даты.

8. В proof показать таблицу FLD → field:FLD → resolved value → filenameTokenMap value.

9. Не удалять пользовательский документ. Для verify создать новый тестовый generate или удалить только явно smoke/test документ.

10. Verify должен проверить не только ai_generated_documents.file_name, но и скачивание через document-download / Content-Disposition.

11. Добавить anti-regression: шаблон с file_name_template IS NULL продолжает работать через системный дефолт.

12. Изменяемый файл только supabase/functions/canonical-document-generate-strict/index.ts. Без миграций, frontend, document-download, canonical-document-send.
```

После этих уточнений патч можно выполнять.

&nbsp;

План: исправить генерацию имени файла из плейсхолдеров шаблона

## Проблема (verified в БД)

Шаблон `Счет-акт: {{field:FLD-000314}} - {{field:FLD-000368}} № {{field:FLD-000069}} от {{field:FLD-000263}}` сохраняется корректно, но в `ai_generated_documents`:

- `file_name = "Счет-акт - № от.pdf"` (все плейсхолдеры пустые)
- `meta.file_name_warnings = ["file_name_placeholder_unresolved:FLD-000314", "...368", "...069", "...263"]`
- `meta.file_name_template_source = "template"` — шаблон применился, но lookup провалился на всех FLD.

## Root cause

В `canonical-document-generate-strict/index.ts` карта `resolved` для DOCX-рендера keyed по `raw_inside` (строки вида `field:FLD-000069`, `field:FLD-000114:case=gen`).  
А `renderFileName` ожидает map keyed по чистому `FLD-XXXXXX` (см. `_shared/document-filename.ts` строки 114–115: `resolved[fld]` где `fld = "FLD-000069"`).  
→ Любой lookup → undefined → warning + пустая строка.

Дополнительно: FLD, использованные **только** в `file_name_template` (и отсутствующие в DOCX), не попадают в `foundIds`, и для `FLD-000069`/`FLD-000070`:

- `needsNumbering` не сработает → номер/дата не аллоцируются;
- даже если есть в `order.meta.document_data.fields` — для номера это критично, потому что номер выдаётся аллокатором.

## Фикс (один файл, чистый PATCH)

### supabase/functions/canonical-document-generate-strict/index.ts

1. **Сразу после загрузки шаблона** прочитать `document_templates.file_name_template` (перенести существующий select выше — до блока `needsNumbering`). Это даёт `fileNameTemplate` и `filenameFlds = extractFilenamePlaceholders(...)` → Set FLD-ID.
2. **Расширить `foundIds**`: для каждого валидного `FLD-XXXXXX` из `filenameFlds` сделать `foundIds.add(fld)`. Это автоматически:
  - триггерит `needsNumbering`, если в имени файла участвует `FLD-000069` или `FLD-000070`;
  - заставит резолвер посчитать `baseValueByFld[fld]` для FLD из имени.
3. **Построить FLD-keyed map для renderFileName** после общего резолва (`resolved`/`baseValueByFld` уже посчитаны):
  ```ts
   const filenameTokenMap: Record<string, string> = {};
   for (const fld of filenameFlds) {
     // 1) если в DOCX есть точный токен `field:FLD-XXX` без модификаторов — берём готовое из resolved
     const direct = resolved[`field:${fld}`];
     if (direct !== undefined && direct !== '') { filenameTokenMap[fld] = direct; continue; }
     // 2) иначе — базовое значение из docFields через fmtVal + applyFormat по data_type
     const reg: any = regMap.get(fld);
     const dt = ((reg?.data_type as string) || '').toLowerCase();
     const entry = baseEntryByFld[fld];
     const fmt = applyFormat(entry?.value, dt, orderCurrency, null); // без модификаторов
     filenameTokenMap[fld] = fmt.value ?? baseValueByFld[fld] ?? '';
   }
  ```
   Важно: для date-полей (FLD-000263, FLD-000070) `applyFormat` без модификатора должен вернуть отформатированную DD.MM.YYYY (это поведение уже стандартно в текущем `fmtVal`/`applyFormat` для DOCX). Если в текущей реализации без формата возвращается ISO — добавить локальный `formatDateForFileName(value)` для FLD типа `date`, чтобы в имени не было `2026-05-21` с дефисами (последующая санитизация уже превратит `:` в `-`, но ISO-даты допустимы; точную форму подтвердим тестом).
4. **Передать новый map в renderFileName**:
  ```ts
   const r = renderFileName(fileNameTemplate, { resolvedTokens: filenameTokenMap });
  ```
5. **Verify**:
  - удалить тестовый документ → перегенерировать → `file_name = "Счет-акт: <ФИО> - <ЮрЛицо> № 2105-X от 21.05.2026.pdf"`;
  - `meta.file_name_warnings = []`;
  - `meta.file_name_template_source = "template"`.

## Что НЕ меняется

- `_shared/document-filename.ts` — контракт (FLD-keyed map) остаётся, фиксим вызывающую сторону.
- Frontend (`FileNameTemplateEditor`) — без изменений.
- Migration не требуется.
- `document-download` / `canonical-document-send` — без изменений (читают `file_name` из БД).
- Поведение для шаблонов с `file_name_template IS NULL` (5 из 6 production-шаблонов) не меняется — системный дефолт.

## DoD

- Контрольная регенерация документа с шаблоном FLD-314/368/069/263 даёт корректное имя файла без warnings.
- FLD, присутствующие только в `file_name_template` (не в DOCX), резолвятся; номер документа аллоцируется, даже если DOCX его не использует.
- Существующие документы НЕ переименовываются (snapshot в БД иммутабельный).
- proof-блок добавлен в `.lovable/proofs/patch_b_file_name_template.md` (раздел «FIX: FLD-keyed resolver»).