да, согласен, с учетом правок:

1. **site-form-upload оставляй как новый узкий edge function — это правильно**, но сервер не должен доверять allowedGroups / maxSizeMB / maxFiles, пришедшим с клиента.  
Добавь в план жёсткое правило:
  - клиент передаёт только submission_token, field_id, файл и идентификатор формы/страницы;
  - сервер сам находит **опубликованную конфигурацию FormBlock** и валидирует файл по настройкам поля;
  - если такую конфигурацию на сервере быстро и надёжно не поднять — тогда честно фиксируй, что в первой итерации сервер применяет только **глобальный безопасный allowlist + hard size limit**, а field-level ограничения работают только в UI и переносятся во 2-й патч.
2. **submission_token нужно формализовать как часть контракта.**  
Добавь отдельный пункт:
  - когда и где генерируется;
  - один токен на одну открытую форму;
  - как он прокидывается в upload и затем в final submit;
  - как по нему потом связываются несколько файлов одной отправки.
3. Нужен **guard на “осиротевшие” загрузки**.  
Сейчас план описывает upload до submit, но не говорит, что делать, если пользователь загрузил файл и не отправил форму.  
Добавь в отчёт/план:  

  - либо это допустимо как временный мусор и чистится отдельным cron/maintenance;
  - либо site-form-submit помечает реально использованные файлы, а orphan cleanup идёт отдельно.  
  Сейчас хотя бы зафиксируй это как **осознанное ограничение первой итерации**, чтобы потом не потерять.
4. Для file и multi-file зафиксируй контракт **однозначно**:
  - maxFiles = 1 → хранится один object;
  - maxFiles > 1 → хранится массив objects;
  - в detail-view и renderer это различается явно, без эвристик.
5. По OptionsEditor:
  - сначала действительно проверь, есть ли уже выделяемый компонент;
  - если нет, новый OptionsEditor допустим;
  - **но не лезь рефакторить quiz-блоки в этом спринте**, если это повышает риск.  
  То есть: можно сделать общий компонент для будущего reuse, но не надо ради этого трогать lesson-editor, если он сейчас стабилен.
6. Для FormsHubTable не перегружай таблицу.  
Правильнее, как ты и написал:
  - compact preview;
  - основное раскрытие — в detail dialog.  
  Это надо прямо зафиксировать как продуктовое решение, чтобы потом не пытались впихнуть все ответы в строки таблицы.
7. Для training-assets-download добавь в план явный security-пункт:
  - form-uploads/ скачиваются **только админом / superadmin**;
  - публичного прямого download по path нет;
  - ссылка в /admin/forms всегда идёт через proxy-download, не в Storage напрямую.
8. По site-form-submit:
  - недостаточно “убедиться, что не ломает unknown types”;  
  добавь проверку, что он **не мутирует** структуру form_data, особенно:
  - не stringify-массивы;
  - не stringify-объекты файла;
  - не превращает boolean/number в строки.  
  Это отдельный proof-пункт.
9. В DoD добавь отдельный пункт:
  - **повторное открытие заявки в /admin/forms показывает те же типы без потери структуры после чтения из БД**, то есть round-trip proof: renderer → submit → jsonb → admin detail.
10. И ещё одна важная граница:

&nbsp;

- FormBlock расширяем как **базовый сайтовый сборщик ответов**;
- QuestionnaireBlockEditor не трогаем и не “выравниваем один в один”.  
Это стоит отдельно повторить в финальном отчёте как архитектурный принцип.

Итог: план хороший и в правильную сторону.  
Главная обязательная правка — **server-side upload validation не должна опираться на клиентские настройки поля**, иначе тип file получится небезопасным.

&nbsp;

## Что нашёл (discovery)

### 1. Upload-механизмы в проекте

Прочитал:

- `src/components/admin/lesson-editor/blocks/uploadToTrainingAssets.ts` — для admin/auth uploads, путь `student-uploads/{user.id}/...`, требует `auth.uid()`.
- `supabase/functions/training-assets-download/index.ts` — безопасный proxy-download, проверяет JWT + admin role, **не подходит для публичной формы** (гость не имеет JWT).
- `src/components/site-renderer/blocks/SiteFormBlock.tsx` (если есть) и `supabase/functions/site-form-submit/` — публичный submit без auth.

**Вывод:** готового signed-upload-helper для гостей **нет**. Есть два пути:

- **Путь A (предпочтительный, безопаснее):** новая edge function `site-form-upload` — принимает файл от гостя (multipart), валидирует MIME/size/extension/submission_token, кладёт через service_role в `training-assets/form-uploads/{submission_token}/...`. Bucket остаётся **закрытым** для anonymous INSERT. Чтение — через существующий `training-assets-download` (расширить allowlist на `form-uploads/` + admin-only check).
- **Путь B:** signed upload URL через service_role edge function (`site-form-upload-token`) → клиент кладёт напрямую в Storage по signed URL. Сложнее, но дешевле для крупных файлов.

**Решение:** Путь A. Меньше кода, контроль на сервере, не открываем RLS на анонимный INSERT.

### 2. Контракт значения «Файл» в `form_data`

Зафиксирую структурированный объект:

```json
{
  "type": "file",
  "path": "form-uploads/{token}/{uuid}-{safeName}",
  "filename": "Original Name.pdf",
  "mime_type": "application/pdf",
  "size": 12345,
  "bucket": "training-assets"
}
```

### 3. site-form-submit сериализация

Проверю, что edge function принимает `boolean / string[] / number / date string / file object` без принудительного `String()`. Скорее всего просто `body.form_data` идёт как есть в jsonb — но подтвержу чтением кода.

### 4. Reuse OptionsEditor

Посмотрю в `QuizSingleBlock` / `QuizMultipleBlock` — есть ли выделяемый OptionsEditor. Если нет — создам **малый общий компонент** `src/components/admin/shared/OptionsEditor.tsx` (input-список с add/remove/reorder), и использую его и в FormBlockEditor, и в quiz-блоках (при низком риске рефакторинга — иначе только в FormBlock).

## План фикса

### A. FormBlockEditor (admin)

`src/components/admin/site-builder/blocks/FormBlockEditor.tsx`:

Расширить `<Select>` типов: `text, textarea, email, phone, boolean, select, multiselect, date, number, file`.

Условные настройки:

- `select / multiselect` → показать `OptionsEditor`.
- `file` → выбор `allowedGroups` (image / document / archive), `maxSizeMB`, `maxFiles` (контракт идентичен `StudentUploadContentData`).
- `number` → `min / max / step`.

Mapping в карточку — скрыть для типов ≠ text/email/phone/textarea (mapping не расширяем по решению пользователя).

### B. Site renderer формы

`src/components/site-renderer/blocks/SiteFormBlock.tsx` (имя уточню):

- `boolean` → `<Switch>` или `RadioGroup` Да/Нет.
- `select` → `<Select>` с options.
- `multiselect` → группа Checkbox.
- `date` → `<input type="date">`, нормализация в ISO `YYYY-MM-DD`.
- `number` → `<input type="number">`, отправка как `Number`, не `String`.
- `file` → file input → upload через **edge function `site-form-upload**` → получаем file-object → кладём в `form_data`.

Validation `required` для каждого типа.

### C. Edge function `site-form-upload` (новая, узкая)

`supabase/functions/site-form-upload/index.ts`:

- POST multipart, без JWT, CORS open.
- Параметры: `submission_token` (UUID, генерируется на клиенте при открытии формы), `field_id`, `file`.
- Server-side validation:
  - MIME-типы по allowlist (соответствует `allowedGroups` из конфига блока — но т.к. конфиг на клиенте, делаем безопасный default-allow: `image/*, application/pdf, application/zip, .docx, .xlsx, .txt`, без `application/x-msdownload` / `*.exe` / `*.sh` / `*.js`).
  - Max size: 20 MB hard limit.
  - Filename sanitize (как в `training-assets-download`).
- Кладёт через service_role в `training-assets/form-uploads/{submission_token}/{uuid}-{safeName}`.
- Возвращает file object для `form_data`.

Bucket RLS **не трогаем** — anonymous INSERT не открываем.

### D. Расширить `training-assets-download`

Добавить `form-uploads/` в `ALLOWED_PREFIXES`. Для `form-uploads/...` требовать `admin / superadmin` через `has_role_v2` (как `student-uploads/`). Контракт остаётся.

### E. site-form-submit — проверить + зафиксировать

Прочитать и убедиться, что `form_data` jsonb сохраняется как есть. Если есть `String()` или валидация типов — расширить (минимально).

### F. /admin/forms — отображение

`FormsDetailOpener.tsx` (`SiteFormDetailDialog`):

- `boolean` → «Да» / «Нет» / «—».
- `string[]` (multiselect) → badges список, или join через `,` .
- date → `format(parseISO(...), 'dd MMMM yyyy', ru)`.
- number → as-is.
- file (object) → ссылка «Скачать {filename}» → клик → `training-assets-download?path=...&name=...` с auth.
- empty / null → «—».

В `FormsHubTable.tsx` preview ячеек анкет уже компактный (контакт + дата). Файл/multiselect — показать иконку/счётчик («📎 1 файл», «3 значения»), без расширения колонок.

### G. QuestionnaireBlockEditor

**Не трогаем.** В отчёте явно зафиксирую: канонический движок анкет сайта = lesson editor; FormBlock получает расширенный набор базовых типов, совместимый по смыслу, без дублирования движка.

## Файлы

**Изменю:**

- `src/components/admin/site-builder/blocks/FormBlockEditor.tsx` — расширение типов + условные редакторы.
- `src/components/site-renderer/blocks/SiteFormBlock.tsx` (имя уточню) — рендер новых типов + file upload.
- `src/components/admin/forms/FormsDetailOpener.tsx` — рендер новых типов в detail.
- `src/components/admin/forms/FormsHubTable.tsx` — компактный preview для file/multiselect.
- `supabase/functions/training-assets-download/index.ts` — `form-uploads/` в allowlist + admin guard.
- `supabase/functions/site-form-submit/index.ts` — только если ломает сериализацию (минимально).

**Создам (минимально):**

- `supabase/functions/site-form-upload/index.ts` — guest file upload через service_role (узкий контракт).
- `src/components/admin/shared/OptionsEditor.tsx` — общий мини-компонент для select/multiselect (если нет готового).

**Миграция:** не нужна (bucket уже существует, RLS не меняем).

**НЕ трогаю:** `QuestionnaireBlockEditor`, `SiteQuestionnaireBlock`, lesson editor, payment writers, RLS на `site_form_submissions`.

## Контракт значения «Файл» в `form_data`

```json
{
  "type": "file",
  "path": "form-uploads/{submission_token}/{uuid}-name.pdf",
  "filename": "name.pdf",
  "mime_type": "application/pdf",
  "size": 12345,
  "bucket": "training-assets"
}
```

## Контракт значений по типам

- `boolean` → `true | false`.
- `select` → `string` (выбранный option).
- `multiselect` → `string[]`.
- `date` → `string` (ISO `YYYY-MM-DD`).
- `number` → `number` (не строка).
- `file` → object выше; для `multi-file` — `array` of objects.

## DoD

1. В FormBlockEditor доступны типы: Строка, Многострочный, Email, Телефон, Да-Нет, Выбор, Множественный выбор, Дата, Число, Файл.
2. Для select/multiselect редактируется список вариантов; для file — allowedGroups + maxSizeMB + maxFiles; для number — min/max/step.
3. Публичная форма корректно рендерит все типы и валидирует required.
4. Гость загружает файл **только** через edge function `site-form-upload` с server-side проверкой MIME/size/extension. Bucket НЕ открыт на anonymous INSERT.
5. Запрещённые MIME (executables, scripts) отклоняются на сервере.
6. Файл сохраняется в `form_data` как структурированный объект (path/filename/mime/size/bucket).
7. В админке (`/admin/forms` detail) файл скачивается через `training-assets-download` (admin-only guard на `form-uploads/`). Прямого чтения чужих файлов нет.
8. В таблице `/admin/forms` — компактный preview для файлов и multiselect.
9. Числа сохраняются как `number`, даты как ISO `YYYY-MM-DD`; админка показывает форматированно.
10. `QuestionnaireBlockEditor` не тронут; в отчёте зафиксирована граница: FormBlock — базовые типы для лендингов, lesson editor — канонический движок анкет.
11. `site-form-submit` корректно принимает boolean/array/number/date/file без приведения к строке.
12. Никакого нового payment-path, дубля Telegram-логики, изменений RLS на `site_form_submissions`.