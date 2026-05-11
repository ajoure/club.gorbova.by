## да, согласен, с учетом правок:

1. **Сначала корректная маркировка плана**

План должен начинаться с заголовка:

```text
План: Единый picker плейсхолдеров, форматы даты и очистка legacy tokenRegistry
```

2. **Не трогать платежные сценарии и карточку сделки**

Scope правильно ограничен, но нужно явно добавить STOP-guard:

```text
Запрещено менять:
- payments_v2;
- orders_v2.meta.documents;
- canonical-deal-document-overrides;
- DealPayerDocumentsCard;
- DealDocumentsCard;
- сценарии документов на кнопке оплаты.
```

3. **CONTACT_TOKENS / DATETIME_TOKENS не удалять сразу**

Фраза «мигрировать в БД и удалить из кода» рискованная. Правильно:

```text
Сначала:
1. Засеять токены в fields_registry/document_token_registry.
2. Переключить UI на БД.
3. Оставить legacy fallback в resolver.
4. Proof, что компоненты больше не используют CONTACT_TOKENS / DATETIME_TOKENS.
5. Только после отдельного cleanup-спринта удалять код.

В этом спринте CONTACT_TOKENS / DATETIME_TOKENS только @deprecated, не физически удалять.
```

4. `[[` **keymap должен быть безопасным**

Добавить guards:

```text
Keymap [[ не должен ломать обычный ввод текста.
Открывать picker только если:
- редактор в фокусе;
- ввод идет в обычном текстовом контексте;
- не внутри existing chip;
- не внутри code/pre/plain URL;
- не при composition event / IME input.

Если есть риск — keymap сделать feature-flag или отключаемым.
```

5. **Клик по chip → режим изменения**

Нужно явно указать, что изменение chip не должно создавать новый токен рядом.

```text
При редактировании chip:
- picker открывается с currentFld;
- после выбора новый token заменяет текущий chip;
- не вставляет второй chip рядом;
- сохраняет/обновляет format и caseModifier.
```

6. **Форматы даты должны храниться в token expression, а не плодить отдельные поля**

Добавить:

```text
Один fieldPublicId для даты документа.
Формат хранится как modifier:
{{field:FLD-XXXXXX|format=dd.MM.yyyy}}
{{field:FLD-XXXXXX|format=long_ru}}
{{field:FLD-XXXXXX|format=iso}}
{{field:FLD-XXXXXX|format=words_ru}}

Не создавать отдельный FLD под каждый формат одной и той же даты, если это один и тот же смысловой field.
```

7. **Технические токены скрывать по metadata, не по названию**

```text
Не скрывать токены по суффиксам `_code`, `_normalized` только строковым правилом.
В registry добавить/использовать metadata:
is_technical: true
или visibility: technical

Fallback по названию допустим только временно, если metadata отсутствует.
```

8. **Audit по merge FLD-000071 → FLD-000070**

Добавить safety:

```text
Перед merge сделать dry-run:
- где используется FLD-000071;
- сколько шаблонов/версий/рассылок его содержат;
- какие aliases будут задействованы.

Merge делать только через alias/deprecation:
- FLD-000071 archived_at set;
- alias FLD-000071 → FLD-000070;
- resolver продолжает понимать старый FLD.
Физически не удалять старый FLD.
```

9. `FieldPickerPopover` **должен стать единым UI, но не ломать TemplateMarkupDialog**

Добавить DoD:

```text
TemplateMarkupDialog после изменений:
- открывает тот же picker;
- вставка старых field chips работает;
- формат даты вставляется корректно;
- старые DOCX-разметки не меняются.
```

10. **Добавить proof по рассылкам**

В DoD добавить:

```text
Proof: существующая Telegram/email-рассылка с legacy token генерирует тот же текст, что до изменения.
```

11. **Уточнить** `CATEGORY_LABELS_RU`

```text
CATEGORY_LABELS_RU должен быть единственным frontend SOT для русских названий категорий.
Если в БД уже есть category label — выбрать один источник и не дублировать.
```

12. **tsc недостаточно**

Добавить:

```text
DoD:
- npm run build или текущий production build command;
- tsc --noEmit;
- rg proof по удалению старого picker state;
- smoke UI: DOCX picker, Telegram, Email.
```

После этих правок план можно запускать.

Да, согласен. Уточнение правильное: **логику вызова через квадратную скобку в контакт-центре менять нельзя**, она уже реализована и работает.

Нужно не переписывать поведение `[` / задержки, а заменить/расширить только содержимое выпадающего списка: чтобы везде открывался **единый полноценный picker из генерации документов**.

```text
Дополни план следующей информацией:

## Важное уточнение по вызову picker через квадратную скобку

В контакт-центре уже реализована рабочая логика вызова picker через квадратную скобку.

Текущее поведение:

- пользователь вводит `[`;
- если он продолжает быстро печатать обычный текст — picker не мешает и не открывается;
- если после ввода `[` есть пауза / задержка, открывается picker;
- логика уже учитывает нормальный пользовательский ввод и не должна быть сломана.

Эту механику НЕ менять.

## Что именно нужно сделать

Задача не в том, чтобы заново реализовать keymap `[` или новую debounce-логику.

Задача:

1. Найти существующую реализацию picker-вызова через квадратную скобку в контакт-центре.
2. Сохранить её поведение без изменений.
3. Подменить/расширить источник списка токенов так, чтобы открывался единый полноценный picker плейсхолдеров, как в генерации документов.
4. Переиспользовать существующий `FieldPickerPopover` / документный picker.
5. Распространить единый picker на:
   - контакт-центр;
   - Telegram-рассылки;
   - Email-рассылки;
   - шаблоны рассылок;
   - настройки коммуникаций;
   - AdminEmail;
   - генерацию документов / DOCX-разметку.

## Что запрещено

1. Не переписывать с нуля обработку квадратной скобки.
2. Не менять текущую debounce/timeout-логику открытия picker.
3. Не ломать сценарий, когда пользователь просто печатает текст после `[`.
4. Не вводить новый keymap `[[`, если текущая логика уже работает через одиночную `[` с задержкой.
5. Не создавать второй picker.
6. Не создавать отдельный список токенов для контакт-центра.
7. Не оставлять урезанный старый список в контакт-центре, если уже есть полноценный список в генерации документов.

## Правильная архитектура

Текущая логика открытия picker в контакт-центре остается как trigger layer.

`FieldPickerPopover` становится единым picker UI.

`document_token_registry` / `fields_registry` становятся единым источником списка плейсхолдеров.

Итоговая схема:

trigger в конкретном редакторе
→ существующая логика открытия picker
→ единый FieldPickerPopover
→ единый registry токенов
→ вставка chip / field token в текущий редактор

## Корректировка предыдущего пункта про `[[`

Предыдущий пункт про новый keymap `[[` заменить.

Было:
- добавить keymap `[[`.

Должно быть:
- переиспользовать уже существующий trigger через `[` с задержкой;
- не менять UX открытия picker;
- только подключить к нему единый полноценный список плейсхолдеров.

## DoD дополнить

1. В контакт-центре поведение `[` осталось прежним:
   - если продолжать печатать — picker не мешает;
   - если сделать паузу — picker открывается.
2. При открытии через `[` отображается тот же полноценный список, что и в генерации документов.
3. В контакт-центре больше нет отдельного урезанного списка токенов.
4. В Telegram/Email/шаблонах/настройках коммуникаций используется тот же picker.
5. Старые сообщения и шаблоны с legacy token продолжают работать.
6. Нет нового keymap `[[`, если он не нужен.
7. `TokenizedRichInput` не содержит второго независимого picker-а, а использует общий picker/registry.
```

Моя корректировка к плану: **убрать идею про новый** `[[`, потому что у вас уже есть рабочий UX через одиночную `[` с задержкой. Основная задача — **подключить к этой существующей механике полноценный общий список плейсхолдеров из документного picker-а** и распространить это по системе.

Цель

Сделать плейсхолдеры **одной канонической функцией** во всей системе. Использовать **уже существующий** красивый picker `FieldPickerPopover` из DOCX-разметки (`TemplateMarkupDialog`) во всех местах ввода текста с переменными — broadcast, email, telegram, settings, AdminEmail, каталог. Никаких новых пикеров.

---

## Канонические компоненты (что уже есть и переиспользуем)


| Компонент / модуль            | Файл                                                      | Роль                                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `**FieldPickerPopover**`      | `src/components/ai-documents/FieldPickerPopover.tsx`      | **Тот самый** красивый popover: header контекста, поиск, группы по категориям с русскими лейблами (`CATEGORY_LABELS_RU`), 2 шага (поле → формат/падеж). |
| `**FieldFormatPicker**`       | `src/components/ai-documents/FieldFormatPicker.tsx`       | Шаг 2: выбор формата + падежа. Сюда докладываем новые форматы даты.                                                                                     |
| `**loadRegistryRefs()**`      | `src/utils/templateAutoSuggest.ts`                        | Единственный загрузчик `RegistryFieldRef[]` из `document_token_registry` + `fields_registry`.                                                           |
| `**buildFieldPlaceholder()**` | `src/components/ai-documents/extensions/FieldChipNode.ts` | Сборка строки `{{field:FLD-XXXXXX                                                                                                                       |
| `**document_token_registry**` | DB                                                        | SOT всех плейсхолдеров. Наполняем недостающим (datetime/system) — не плодим параллельных реестров.                                                      |


Всё остальное (внутренний TipTap-picker в `TokenizedRichInput`, `getTokenGroupsForContext`, hardcoded `CONTACT_TOKENS`/`DATETIME_TOKENS` в `tokenRegistry.ts`) — **deprecated**, заменяется `FieldPickerPopover`.

---

## Этап 1 — Каталог плейсхолдеров (вкладка «Плейсхолдеры»)

**Файл:** `src/components/ai-documents/PlaceholdersCatalogTab.tsx` + миграция БД.

1. `GROUP_LABELS` в этом файле удалить → импортировать `CATEGORY_LABELS_RU` из `FieldPickerPopover.tsx` (или вынести в `src/lib/tokens/categoryLabels.ts` — единый SOT).
2. Нормализация `category.toLowerCase()` перед lookup → группа `payment` рендерится как **«Платёж/Платежи»**.
3. Технические токены за тогл «Технические данные»:
  - `UPDATE document_token_registry SET options = options || '{"is_technical":true}'::jsonb WHERE token_key IN (...)` для `*_code`, `*_normalized`.
  - В UI: при `showTechnical=false` фильтровать `is_technical=true`.

---

## Этап 2 — Группа «Документ»: одно поле «Дата документа» с выбором формата

**Файлы:**

- `src/components/ai-documents/extensions/FieldChipNode.ts` — расширение `FieldFormat`.
- `src/components/ai-documents/FieldFormatPicker.tsx` — UI новых вариантов.
- `supabase/functions/canonical-document-generate-strict/index.ts` — `applyFormat()` и `ALLOWED_FORMATS`.
- Миграция БД — слияние `FLD-000071 → FLD-000070` + наполнение datetime в `document_token_registry`.

1. `**FieldFormat**` расширяем:
  ```ts
   "words" | "text"
   | "date_short"        // 11.05.2026 — дефолт для date
   | "date_long_mixed"   // 11 мая 2026 г.
   | "datetime_short"    // 11.05.2026 18:30
   | "datetime_long"     // 11 мая 2026 г., 18:30
  ```
   `FIELD_FORMAT_LABEL` дополнить русскими подписями.
2. `**FieldFormatPicker**` для `data_type ∈ {date, datetime}` показывает радиогруппу из 4 цифровых/смешанных вариантов + чекбокс «Прописью» (взаимоисключим с `date_*` — выбор `words` отключает остальные). Поведение для других типов не меняется.
3. `**PlaceholdersCatalogTab**` — для строки даты столбец «Настройки» = тот же селект формата + чекбокс «Прописью» (через `FieldFormatPicker`-режим inline). Никаких отдельных «Обычный»/«Прописью» кнопок.
4. **Edge `applyFormat**` расширяем:
  - `date_short → dd.MM.yyyy` (Europe/Minsk),
  - `date_long_mixed → d MMMM yyyy 'г.'`,
  - `datetime_short → dd.MM.yyyy HH:mm`,
  - `datetime_long → d MMMM yyyy 'г.', HH:mm`,
  - `words` для date — существующая «прописью»-логика.
   `ALLOWED_FORMATS` дополняем. Legacy токены без `format=` для date → `date_short`.
5. **Миграция БД (reversible):**
  - `archived_at = now()` для `FLD-000071 (Дата документа кратко)`.
  - `UPDATE fields_registry SET label='Дата документа' WHERE public_id='FLD-000070'`.
  - В `fields_registry` создать (если нет) Class B записи `today, tomorrow, yesterday, now, month_name, month, year, day, weekday` с `entity_type='system'`.
  - В `document_token_registry` добавить эти поля с `category='system'` (или `'document'` — обсудимо). Это автоматически появится в `FieldPickerPopover` без правок UI.
  - Audit-запись.

---

## Этап 3 — Подмена `TokenizedRichInput` на `FieldPickerPopover` везде

**Принцип:** `TokenizedRichInput` остаётся как TipTap-редактор с chip-нодами, но **внутренний picker удаляется**. Открытие picker'а делегируется `FieldPickerPopover`.

**Файл редактора:** `src/components/admin/TokenizedRichInput.tsx`.

1. Удалить кастомный dropdown (`pickerOpen`, `dropdownRef`, `searchInputRef`, ветки рендера групп `contextGroups` и `productFields`, useQuery `loadTokensForContext`).
2. Вместо него:
  - Хранить `pickerOpen` + `pickerAnchor: {x,y} | null` + `currentFld: string | null` (для chip click).
  - Загружать `RegistryFieldRef[]` через `**loadRegistryRefs()**` (тот же кэш, что в `TemplateMarkupDialog`).
  - Рендерить `<FieldPickerPopover open anchor refs contextLabel onPick={...} />`.
  - В `onPick({fld, format, caseModifier})`:
    - Получить label из refs.
    - Вставить chip через `editor.commands.insertFieldChip({ fieldPublicId: fld, format, caseModifier, label })`.
3. Триггеры открытия picker'а (все ведут к одному и тому же `FieldPickerPopover`):
  - кнопка-плейсхолдер «{ }» в toolbar (как сейчас);
  - keymap `[` (новый) — при двух подряд `[[` открывает picker и съедает символы (поведение, привычное по Notion/Coda);
  - клик по существующему chip → открывает в режиме «изменить» с `currentFld=chip.fieldPublicId`.
4. Подчистить `tokenRegistry.ts`:
  - `getTokenGroupsForContext`, `loadTokensForContext`, `_*Cache`, `TokenContext`, `extraTokenGroups` — пометить `@deprecated`.
  - `CONTACT_TOKENS` / `DATETIME_TOKENS` мигрировать в БД (`fields_registry` + `document_token_registry`) и удалить из кода. После миграции вся группировка идёт через `category` из БД.

**Места, где `TokenizedRichInput` используется (правок не требует — он продолжит рендерить picker сам):**

- `src/components/admin/communication/BroadcastsTabContent.tsx` (3)
- `src/components/admin/communication/BroadcastTemplateDialog.tsx` (2)
- `src/components/admin/communication/CommunicationSettingsTabContent.tsx` (2)
- `src/components/telegram/MassBroadcastDialog.tsx` (1)
- `src/pages/admin/AdminEmail.tsx` (2)

Удаляем оттуда `extraTokenGroups`/`tokenContext` props (больше не нужны).

---

## Этап 4 — `TemplateMarkupDialog` остаётся как есть

Ничего не трогаем — это эталонная точка использования `FieldPickerPopover`. Обеспечиваем, что после расширений Этапа 2 он начинает показывать новые форматы даты автоматически.

---

## DoD (proof checklist)

1. Группа `payment` в каталоге плейсхолдеров отображается русским лейблом из `CATEGORY_LABELS_RU` (один SOT).
2. Технические токены (`*_code`, `*_normalized`) скрыты по умолчанию; видимы при «Технические данные = on».
3. В группе «Документ» — одно поле **«Дата документа»** с UI выбора формата (4 опции + чекбокс «Прописью») и системные date-плейсхолдеры (Сегодня…День недели), все из `document_token_registry`.
4. Resolver выдаёт корректные строки для всех 5 форматов даты на тестовом заказе. Legacy `{{field:FLD-000070}}` → `dd.MM.yyyy`.
5. В Telegram-рассылках, Email-рассылках, шаблонах рассылок, настройках коммуникаций и `AdminEmail`:
  - кнопка «{ }» открывает **тот же `FieldPickerPopover**`, что и в DOCX-разметке;
  - `[[` тоже открывает его;
  - клик по существующему chip открывает его с подсвеченным текущим полем (режим «изменить»).
6. Внутри chip хранится `{{field:FLD-…|format=…}}`, в UI отображается русский label.
7. `tsc --noEmit` чистый. Миграция reversible (`archived_at`). Существующие шаблоны/рассылки работают (legacy `{{full_name}}`, `{{today}}` — пока остаются live, до завершения миграции токенов в БД оставлены как fallback в resolver'е).
8. Audit-запись о слиянии `FLD-000071 → FLD-000070` и о пополнении `document_token_registry` системными датами в `audit_logs`.
9. Старого внутреннего picker'а в `TokenizedRichInput` больше нет (proof: rg `pickerOpen|dropdownRef` в файле = 0 совпадений).
10. `getTokenGroupsForContext`, `CONTACT_TOKENS`, `DATETIME_TOKENS` помечены `@deprecated` и не используются ни одним компонентом (proof: `rg`).

---

## Что вне scope

- `payments_v2`, `orders_v2.meta.documents.*`, `canonical-deal-document-overrides` — не трогаем.
- Дизайн карточки «Документы / плательщик» — не трогаем.
- `TemplateMarkupDialog` — не трогаем; он уже эталон.