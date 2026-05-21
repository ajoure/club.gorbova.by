да, согласен, с учетом правок:

1. **Сначала проверить API** `FieldPickerPopover` **по фактической сигнатуре.**  
Не писать props наугад. Перед правкой сделать `rg` по всем использованиям:

```bash
rg -n "FieldPickerPopover" src
rg -n "onPick|simple=|refs=|contextLabel" src/components src/pages
```

Если у `FieldPickerPopover` другой контракт — использовать фактический, а не придумывать новый.

2. **Не делать открытие picker по** `[` **в этом патче, если это усложнит правку.**  
Основной must-have:

```text
кнопка «+ Вставить плейсхолдер» → общий picker → вставка в позицию курсора
```

Открытие по `[` можно добавить только если уже есть готовый reusable-паттерн из `TemplateMarkupDialog`. Если требует отдельной логики координат/selection — вынести в backlog.

3. **Preview должен использовать тот же** `renderFileName`**, что backend-контракт.**  
Не делать отдельный «примерный» preview, который расходится с backend.  
В preview map можно подставлять labels, но сама функция валидации/санитизации должна быть та же frontend mirror helper.
4. **FLD-000069 не хардкодить без проверки registry.**  
В плане написано, что это номер документа. Перед фиксом подтвердить:

```sql
SELECT fr.public_id, fr.key, fr.label, dtr.token_key, dtr.ui_label
FROM fields_registry fr
LEFT JOIN document_token_registry dtr ON dtr.field_id = fr.id
WHERE fr.public_id = 'FLD-000069';
```

Если это действительно номер документа — оставить. Если нет — найти правильный FLD номера и использовать его.

5. **Легенду делать только по FLD, которые реально есть в текущем шаблоне.**  
Не выводить весь список выбранных refs. Формат:

```text
FLD-000069 — Номер документа
FLD-000313 — Заказчик ФЛ: ФИО полностью
```

Если FLD не найден в refs:

```text
FLD-000999 — неизвестный плейсхолдер
```

и validation warning/error.

6. **Сохранение** `NULL` **при сбросе — правильно, но с confirm не нужно.**  
Кнопка «Сбросить к системному дефолту» должна:
  - сразу записать `file_name_template = null`;
  - обновить local/original state из ответа БД;
  - показать toast.
7. **После save обязательно invalidate/refetch списка шаблонов.**  
Иначе правая панель может сохранить, но список/карточка останутся со старым значением.
8. **Не менять backend и миграции.**  
Подтвердить в STOP:

```text
Меняется только FileNameTemplateEditor.tsx.
renderFileName, document-filename.ts, DB schema, canonical-document-generate-strict, document-download не трогаем.
```

9. **Добавить proof по реальному сохранению.**  
В отчёте нужен не только “кнопка работает”, а SQL/select proof:

```sql
SELECT id, file_name_template
FROM document_templates
WHERE id = '<template_id>';
```

10. **DoD дополнить проверкой ошибок.**

Проверить 4 состояния:

```text
валидный шаблон с FLD-000069 → Save активен, сохраняет
без FLD-000069 → Save disabled + причина
{{payer_short_name}} → Save disabled + ошибка FLD-only
с .pdf/.docx → Save disabled + ошибка расширения
```

11. **Исправить обрыв в списке файлов.**  
В конце плана строка обрезана:

```text
Файлы, затронутые патчем: только src/components/ai-documents/FileNameTemplateEdi...
```

Должно быть:

```text
Файлы, затронутые патчем: только src/components/ai-documents/FileNameTemplateEditor.tsx
```

Можно отправить Lovable так:

```text
План согласован, но выполни с правками:

1. Перед правкой проверь фактический API FieldPickerPopover через rg, не придумывай props.
2. Основной must-have — кнопка «+ Вставить плейсхолдер» с общим picker и вставкой в позицию курсора. Открытие по `[` делать только если можно переиспользовать готовый паттерн без усложнения; иначе backlog.
3. FLD-000069 сначала подтвердить через fields_registry/document_token_registry как номер документа. Если это не номер — найти правильный FLD номера и использовать его.
4. Preview использует тот же frontend mirror renderFileName/helper, что и backend-контракт. Не делать отдельную расходящуюся логику.
5. Легенда под textarea показывает только FLD, реально найденные в текущем шаблоне.
6. После save и reset обязательно перечитать `file_name_template` из БД и обновить original state; также invalidate/refetch списка шаблонов.
7. Reset пишет `file_name_template=null` в БД и показывает toast.
8. Меняется только `src/components/ai-documents/FileNameTemplateEditor.tsx`. Никаких миграций, backend, renderFileName, document-download.
9. Verify: валидный шаблон сохраняется; без номера документа — ошибка; alias `{{payer_short_name}}` — ошибка; `.pdf/.docx` — ошибка.
10. В proof приложить SQL/select подтверждение сохранённого `file_name_template`.
```

После этих правок план можно выполнять.

&nbsp;

План: фикс редактора шаблона имени файла (FileNameTemplateEditor)

Контекст

- Файл: `src/components/ai-documents/FileNameTemplateEditor.tsx`.
- Проблемы у пользователя на `/admin/ai` → Документы → Шаблоны документов:
  1. Чипы плейсхолдеров показывают только `FLD-000069` — непонятно, что это.
  2. Кнопка «Сохранить» не работает / диалог сохранения не подтверждает запись.
  3. Нет общего picker'а плейсхолдеров — нужно переиспользовать существующий `FieldPickerPopover` (с группами «Заказчик / Исполнитель / Документ / …», поиском и человекочитаемыми лейблами), а не локальный жёсткий список из 6 FLD.

Что уже есть в проекте (используем как есть)

- `src/components/ai-documents/FieldPickerPopover.tsx` — стабильный 2-этажный picker с группировкой по категориям, поиском, virtual anchor. Уже умеет `simple` режим (без шага формат/падеж) — идеально для filename, где нужен только `field:FLD-XXXXXX`.
- `src/utils/templateAutoSuggest.ts → loadRegistryRefs()` — отдаёт массив `RegistryFieldRef { field_public_id, token_key, ui_label, category, data_type }` из `document_token_registry`. Это канон проекта и единственный источник лейблов плейсхолдеров.

PATCH-1: переписать FileNameTemplateEditor.tsx

A. Загрузка справочника

- При маунте вызывать `loadRegistryRefs()` и держать `refs: RegistryFieldRef[]` в state.
- Удалить локальный массив `FIELD_CHIPS` и `PREVIEW_TOKENS` как «магические» 6 полей.

B. UI выбора плейсхолдера (вместо текущих 6 чипов)

- Кнопка «+ Вставить плейсхолдер» (variant outline, иконка `SquareBrackets`/`Braces` из lucide).
- По клику открывается `FieldPickerPopover` с:
  - `simple={true}` (нам не нужны format/case — filename использует «как есть»);
  - `refs={refs}`;
  - `contextLabel="Имя файла: {templateName}"`;
  - якорь — координаты кнопки (тот же приём, что в `TemplateMarkupDialog`: считать `getBoundingClientRect()` кнопки).
- `onPick({ fld })` → вставить `{{field:FLD-XXXXXX}}` в textarea в позиции курсора (через `selectionStart`/`selectionEnd` ref на Textarea), а не просто конкатенировать в конец.
- Дополнительный «горячий триггер»: при наборе символа `[` в textarea — открывать picker в позиции курсора (по аналогии с TemplateMarkupDialog/TemplateVisualEditor). Опционально, делаем сразу.

C. Превью с человекочитаемыми токенами

- Сборка `previewTokens: Record<string, string>` динамически:
  - `FLD-000069` → `PREVIEW-0001` (хардкод как пример номера, т.к. это всегда документ-номер).
  - Для всех остальных FLD из `refs` — подставляем `«${ui_label}»` (например, `«Заказчик: ФИО кратко»`). Это даёт корректное визуальное представление, что встанет в имя файла, без необходимости знать конкретное значение.
- `renderFileName(template, previewTokens)` остаётся, валидация синтаксиса/наличия FLD-000069 остаётся.

D. Под textarea — компактная подсказка-легенда

- Для каждого FLD, реально встретившегося в текущем шаблоне, рендерим строку: `FLD-000069 — Номер документа (обязателен)`, лейбл берём из `refs` (`ui_label`), для 069 — фиксированная подпись «Номер документа (обязателен)».
- Это решает «непонятно что значит» прямо в контексте текущего шаблона.

E. Починка кнопки «Сохранить»
Текущая логика блокирует Save в нескольких неочевидных случаях; распутываем:

1. `disabled={!canSave || saving || template === original}` — оставить, но добавить понятный hint:
  - Если `canSave === false`, под кнопкой жирно подписать первую причину из списка (нет 069 / есть расширение / синтаксис invalid / пусто).
2. Гарантировать, что после успешного `update` мы:
  - обновляем `original` строго к нормализованному значению (`template.trim()`), которое лежит в БД (а не к сырому `template`);
  - повторно вычитываем поле `file_name_template` из БД сразу после update (`.select("file_name_template").single()`), чтобы UI отображал реальный persisted state и кнопка корректно дезактивировалась.
3. Логируем ошибку в консоль (`console.error("[file_name_template] save failed", error)`) + показываем `toast.error` с реальным `error.message`. Это снимет «молчаливый» отказ, если он есть.
4. На случай, если пользователь видит «не сохраняется» из-за placeholder-эффекта (HTML-атрибут `placeholder` в Textarea показывает пример и его легко перепутать с реальным значением): убрать длинный пример из `placeholder` Textarea, заменить на короткий нейтральный: «Введите шаблон имени файла или нажмите „+ Вставить плейсхолдер“».

F. Сохранение поведения «системный дефолт»

- Кнопка «Сбросить к системному дефолту»: очищает textarea и сразу сохраняет `null` в БД (а не только локально), чтобы поведение было предсказуемым; toast «Сброшено к системному дефолту».

DoD

- В UI Шаблоны документов → редактор имени файла:
  - Видна кнопка «+ Вставить плейсхолдер»; нажатие открывает общий FieldPickerPopover со всеми FLD-полями, сгруппированными по категориям, с поиском и человекочитаемыми названиями.
  - Можно вставить плейсхолдер в позицию курсора.
  - Под шаблоном выводится живая легенда «FLD-XXX — название», а в Preview лейблы подставляются вместо магических значений.
  - Кнопка «Сохранить» успешно записывает `file_name_template` в `document_templates` (проверяется select после update); при любой ошибке toast показывает реальный текст ошибки.
  - Кнопка «Сбросить к системному дефолту» записывает `NULL` в БД.
- Никаких новых таблиц/edge functions/миграций. Логика `renderFileName`, FLD-first контракт, требование FLD-000069 — не меняем.
- Файлы, затронутые патчем: только `src/components/ai-documents/FileNameTemplateEditor.tsx`.