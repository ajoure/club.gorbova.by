# Да, по этому шаблону проблема очевидная: в Word документ содержит нормальную структуру счёт-акта с таблицей, реквизитами, подписями и старыми плейсхолдерами вида `{{ld-...}}`, `{{cn-...}}`  . В Lovable сейчас preview превращает DOCX почти в обычный текст: таблица визуально разваливается, ширины/ячейки/структура не сохраняются. Так **нельзя** использовать как рабочий редактор разметки.

Дай Lovable такие правки:

```text
Продолжай C5-D, но сначала исправь критический UI-блокер DOCX preview/markup.

Проблема:
Загруженный DOCX-шаблон «Шаблон. Счёт-акт на услуги.docx» в Microsoft Word отображается как нормальный документ: есть таблица, выравнивание, структура счёт-акта, реквизиты, подписи. В текущем TemplateMarkupDialog preview отображается как упрощённый текст/каша: таблица и форматирование теряются. Это недопустимо.

Правильная архитектура:
DOCX остаётся source of truth.
Никакого TipTap/WYSIWYG-пересобирания документа для DOCX.
Mammoth/HTML preview используется только для визуального просмотра и выбора текста.
Apply-markup должен менять исходный DOCX XML, а не пересоздавать документ из HTML/текста.

PATCH C5-D-BLOCKER-1 — нормальный DOCX preview

1. Улучшить Word-like preview:
   - preview должен сохранять таблицы как таблицы;
   - ячейки должны иметь видимые borders;
   - отступы, жирный текст, списки, заголовки должны отображаться максимально близко к Word;
   - preview не должен превращать таблицу в плоский текст.

2. Добавить scoped CSS только для preview:
   .docx-preview table {
     border-collapse: collapse;
     width: 100%;
     table-layout: fixed;
   }
   .docx-preview td,
   .docx-preview th {
     border: 1px solid hsl(var(--border));
     padding: 4px 8px;
     vertical-align: top;
     word-break: break-word;
   }
   .docx-preview p {
     margin: 0 0 6px;
   }
   .docx-preview strong,
   .docx-preview b {
     font-weight: 700;
   }
   .docx-preview ul,
   .docx-preview ol {
     margin-left: 20px;
   }

3. Проверить, что mammoth.convertToHtml реально отдаёт table/tr/td.
   Если таблица в HTML есть — проблема только CSS.
   Если mammoth не отдаёт таблицу корректно — зафиксировать это в proof и предложить альтернативу: использовать LibreOffice headless / docx-preview library для read-only preview, но apply-markup всё равно должен работать по DOCX XML.

PATCH C5-D-BLOCKER-2 — не показывать авторазметку по умолчанию

Сейчас справа сразу появляются auto-suggestions и выглядят как будто система уже что-то сама решила. Это мешает.

Нужно:
- при открытии разметки правая панель пустая;
- кнопка «Найти автоматически» отдельно запускает auto-suggest;
- основной сценарий — ручная разметка:
  1) выделил текст в preview;
  2) нажал «Разметить выделенное»;
  3) выбрал FLD-поле;
  4) выбрал формат/падеж при необходимости;
  5) replacement появился справа как active/manual.

PATCH C5-D-BLOCKER-3 — черновик не должен сбрасываться

Если пользователь:
- разметил несколько полей;
- переключился внутри dialog;
- закрыл/открыл dialog;
- нажал preview/auto-suggest,

то replacements не должны пропадать.

Требования:
- использовать document_template_versions.markup_draft;
- autosave каждые 1.5 секунды после изменения replacements;
- при открытии dialog сначала загружать markup_draft;
- если draft есть — не запускать auto-suggest автоматически;
- кнопка «Очистить разметку» должна явно очищать draft.

PATCH C5-D-BLOCKER-4 — apply должен сохранять исходный вид DOCX

После Apply:
- таблица должна остаться таблицей;
- ширины/ячейки/границы не должны исчезать;
- меняется только текст в w:t, где выбранный original_text заменён на {{field:FLD-...}};
- документ не должен пересобираться из HTML/plain text.

Smoke-test:
1. Загрузить реальный файл «Шаблон. Счёт-акт на услуги.docx».
2. Открыть разметку.
3. Убедиться, что preview показывает таблицу как таблицу.
4. Выделить в таблице старый placeholder, например сумму или наименование услуги.
5. Назначить FLD-поле.
6. Apply создать новую версию.
7. Скачать новую версию.
8. Открыть в Word.
9. Подтвердить:
   - таблица сохранена;
   - форматирование сохранено;
   - заменён только выбранный текст;
   - старые {{ld-...}} остаются там, где их ещё не разметили вручную;
   - новые вставки имеют формат {{field:FLD-XXXXXX}}.

PATCH C5-D-BLOCKER-5 — legacy placeholders в загруженном старом шаблоне

Важно:
Старый шаблон содержит много legacy placeholder-ов вида {{ld-...}} и {{cn-...}}.
На этапе ручной разметки это допустимо как исходный материал.
Но активация финальной версии должна быть заблокирована, пока в DOCX остаются любые legacy placeholders.

Правило:
- Draft/markup version может содержать старые {{ld-...}} до полной разметки.
- Apply может создать новую draft-version даже если часть legacy осталась.
- Activate должен быть запрещён, если validation нашёл legacy placeholders.
- UI должен показывать список оставшихся legacy placeholders и прогресс:
  Размечено: X / Всего legacy placeholders: Y.

Proof:
Обновить .lovable/proofs/document_generation_sprint11_c5d_docx_markup.md:
- приложить факт, что реальный шаблон содержит таблицу и legacy placeholders;
- показать, что preview отображает таблицу;
- показать, что manual replacement сохраняется в markup_draft;
- показать, что apply создаёт новую версию;
- показать, что скачанный DOCX после apply сохраняет таблицу;
- показать, что activate блокируется, пока есть legacy placeholders;
- подтвердить: TipTap не используется для DOCX-flow;
- подтвердить: email/Telegram/auto-generation/batch OFF.

Финальная формулировка отчёта:
Backend C5-C green. C5-D UI DOCX markup fixed for real DOCX preview and manual markup, pending final user visual test on real template.
```

Ключевой вывод: **не надо сейчас делать “редактор Word в браузере”**. Нужно сделать нормальный read-only preview документа + ручную замену выбранных фрагментов в исходном DOCX. Это сохранит таблицы и форматирование.

&nbsp;

План: C5-D DOCX Markup — переработка UI + финальная проверка

## Контекст

Текущий `TemplateMarkupDialog` отображает плейсхолдеры в виде «сырых» `{{ld-...}}` токенов внутри preview, таблицы не рендерятся, авторазметка засоряет правую панель десятками карточек. Пользователь хочет:

- preview как настоящий Word-документ (включая таблицы);
- авторазметку **скрыть по умолчанию** (оставить как опциональную кнопку);
- основной флоу — ручной: выделить текст → присвоить FLD-поле;
- TipTap не использовать в DOCX-разметке.

## Что делаем

### 1. Build / runtime sanity

- `npm run build` (через харнес).
- Открыть `/admin/ai → Документы → Шаблоны → Разметить` и убедиться, что dialog открывается без ошибок (console + network).

### 2. Переработка `TemplateMarkupDialog`

- **Preview (mammoth.convertToHtml)**: рендерить полноценный HTML с таблицами/жирным/списками. Не подменять токены `<mark>`-обёртками — оставить чистый Word-like вид.
- **Минимальный CSS** для `.docx-preview`: `table { border-collapse; border }`, `td/th { border; padding }`, `strong/b`, `ul/ol`, заголовки.
- **Auto-suggest по умолчанию OFF**:
  - При открытии dialog `markupState.replacements = []`.
  - Кнопка «Найти автоматически» в toolbar — по клику запускает существующий auto-detect и наполняет правую панель.
  - Кнопка «Очистить разметку» рядом — сбрасывает `replacements = []`.
- **Ручной флоу (главный)**:
  - Пользователь выделяет текст в preview → жмёт «Разметить выделенное» → открывается компактный selector (Popover) с поиском по FLD-полям + format/case.
  - Выбор поля создаёт `replacement` со `status: 'manually_added'`, `original_text`, `occurrence_index` (вычислять по позиции выделения относительно всего текста preview).
- **Правая панель = журнал замен**: компактные карточки (FLD-код, format/case, occurrence, кнопки Skip/Remove). Без массовых «Принять/X» — manual-замены автоматически активны, авто-замены требуют Accept.
- **Occurrence-picker**: оставить, но показывать только если `total_occurrences > 1`.
- **Кнопки apply**:
  - «Применить (создать версию)» — `activate=false`.
  - «Применить и активировать» — `activate=true`, дисейблить если есть `critical` warnings.

### 3. Backend `canonical-template-apply-markup`

Уже поддерживает `activate`, `occurrence_index`, ambiguity guard. Добавить только Deno-тесты (`index_test.ts`):

- 1 occurrence → заменено;
- 2 occurrences без index → warning `ambiguous_replacement_multiple_matches`, замен нет;
- 2 occurrences c `occurrence_index=1` → заменено только второе;
- legacy `{{document.amount}}` в FLD-плейсхолдере → critical;
- `activate=false` → версия создана, не активна;
- `activate=true` + valid → активна.

### 4. TipTap cleanup

- Убедиться, что `TemplateVisualEditor` не импортируется из DOCX-flow.
- Добавить header-комментарий «NOT FOR DOCX TEMPLATES — staging only».

### 5. Proofs

- Переименовать секции в `.lovable/proofs/document_generation_sprint11_c5c_smoke_real_act.md`:
  - `## C5-C Backend Smoke: GREEN`
  - `## C5-D UI DOCX Markup: IN PROGRESS`
  - явно зафиксировать «TipTap-подход признан неправильным для DOCX-шаблонов».
- Создать `.lovable/proofs/document_generation_sprint11_c5d_docx_markup.md`:
  - архитектура (DOCX = SOT, mammoth = preview only, XML replace внутри `<w:t>`);
  - `markup_draft` autosave;
  - `occurrence_index` + ambiguity guard;
  - manual-only по умолчанию, auto-suggest опциональный;
  - `apply` без autoactivate, `apply+activate` отдельная кнопка;
  - список изменённых файлов;
  - DoD.

### 6. Manual smoke (UI пользователем)

- Документ из скрина (`Шаблон. Счёт-акт на услуги.docx`):
  - открыть Разметку → preview показывает таблицу;
  - правая панель пустая;
  - выделить «{{ld-d_opf-706429-upper_first_letter}}» в ячейке → присвоить FLD-поле;
  - Apply → скачать → открыть в Word → таблица сохранена.

## Что НЕ делаем

- Не делаем сложную inline-подсветку `<mark>` (отдельный PATCH).
- Не удаляем `TemplateVisualEditor` (оставляем для будущего).
- Не трогаем backend strict-generate (C5-C принят).

## DoD

- Dialog открывается без ошибок.
- Preview показывает таблицы и форматирование как Word.
- Правая панель пустая до явного «Найти автоматически».
- Ручная разметка через выделение работает.
- `apply-markup` тесты зелёные.
- Оба proof-файла обновлены.
- Финальная формулировка: **Backend C5-C green. C5-D UI DOCX markup implemented, pending user visual test on real DOCX.**

## Технические детали (для разработчика)

- `TemplateMarkupDialog.tsx`: state machine `{ replacements, autoSuggested: boolean }`. Auto-suggest вызывается лениво.
- Selection → `window.getSelection()` → `range.toString()` + `getCharacterOffset` относительно preview контейнера для вычисления `occurrence_index`.
- CSS scope: `.docx-preview table, .docx-preview td, .docx-preview th { border: 1px solid hsl(var(--border)); padding: 4px 8px; }` + `border-collapse: collapse`.
- FLD-picker внутри Popover с `Command` (cmdk) — поиск по `field_code` + label.