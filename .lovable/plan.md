## да, согласен, с учетом правок:

&nbsp;

1. **Сanitizer делать централизованно и переиспользуемо.**
  Поддерживаю stripTechnicalSuffix(label) + getFieldDisplayLabel(), но зафиксируй правило:
  &nbsp;
  - stripTechnicalSuffix() применяется **только для display**;
  - исходный label в state/JSON/БД не меняется;
  - detail в /admin/forms тоже использует тот же helper, а не свою отдельную логику.
  &nbsp;
2. **Список вырезаемых суффиксов расширь и нормализуй.**
  Удалять не только (boolean|select|multiselect|date|number|file|file single|file multi|text|email|phone|password), но и:
  &nbsp;
  - пробелы перед скобками;
  - регистр любой;
  - варианты с дефисом/underscore: file-single, multi-select, multi_select;
  - повторные хвосты в конце, если их по ошибке несколько.
  &nbsp;
  Но вырезать **только хвост в конце строки**, чтобы не ломать нормальные названия.
3. **По DoD формулировку про “нативные input не остаются” поправить.**
  Это слишком жёстко и может быть технически неверно, потому что:
  &nbsp;
  - shadcn Checkbox/RadioGroup/Select внутри всё равно могут использовать native input;
  - file upload почти всегда держится на скрытом native <input type="file">.
  &nbsp;
  Правильная формулировка:
  &nbsp;
  - в FormSection.tsx не должно остаться **голых, нестилизованных** нативных контролов в визуальном UI;
  - скрытый native file input допустим как техническая реализация, если визуально используется shadcn-кнопка.
  &nbsp;
4. **Date picker не должен ломать submit-контракт.**
  При замене input type="date" на Calendar + Popover обязательно сохранить:
  &nbsp;
  - значение в submit как YYYY-MM-DD;
  - ту же валидацию required;
  - отсутствие timezone-сдвига.
  &nbsp;
  Это отдельный stop-guard: не хранить Date.toISOString() вместо локальной даты поля.
5. **Boolean-рендер зафиксируй явно.**
  Для boolean оставляем два варианта **Да / Нет** через RadioGroup, а не Switch.
  Это лучше для анкет и однозначно в данных даёт true/false, без двусмысленного “включено/выключено”.
6. **Multiselect — без нового сложного компонента.**
  Правильно использовать Checkbox + label в группе. Не делать кастомный dropdown multiselect, чтобы не раздувать скоуп и не плодить новый UI-паттерн.
7. **Preview и публичная форма должны остаться на одном компоненте.**
  Подчеркни это в плане:
  &nbsp;
  - FormSection.tsx — единый источник UI для preview и public;
  - никаких отдельных preview-компонентов.
  &nbsp;
8. **В редакторе FormBlockEditor убрать технические хвосты не только у auth-полей.**
  Проверить все места, где label поля показывается:
  &nbsp;
  - список полей;
  - summary;
  - preview внутри редактора;
  - auth-поля;
  - возможные helper-labels.
  &nbsp;
  Не ограничиваться только одним местом.
9. **Шапку редактора чинить только layout-ом, без изменения структуры страницы.**
  То есть:
  &nbsp;
  - не переносить бизнес-кнопки в новые панели;
  - не менять маршруты/табы;
  - только корректный responsive layout header-блока.
  &nbsp;
10. **Proof-скрины дополни ещё одной проверкой.**
  Помимо 4 скринов, в финальном отчёте отдельно перечислить:
  &nbsp;
  - какой legacy label был до sanitizer;
  - как он отображается после sanitizer;
  - пример минимум для boolean, select, multiselect, file multi.
  &nbsp;

&nbsp;

&nbsp;

Итог: план хороший, можно запускать.

Главное — не менять данные, не трогать submit/upload, и поправить DoD про “без нативных input” на более точную формулировку про отсутствие **голых** контролов.

&nbsp;

Дополнение к плану: визуальный апгрейд preview формы под стиль CRM «Сделки»

### Контекст

На скрине 1 — эталон стиля (CRM /admin/deals?view=board): мягкие нейтральные тона, скруглённые карточки, тонкие границы `border-border/60`, аккуратные badge'и, иконки с приглушённым акцентом. На скрине 2 — текущий preview формы: голые HTML `<input type="date">`, нативные `<select>`, нативные `<input type="checkbox">` и `<input type="radio">` без shadcn-обёрток. Плюс к label полей дописан технический type — `(boolean)`, `(select)`, `(multiselect)`, `(date)`, `(number)`, `(file single)`, `(file multi)`. Это и есть «английские хвосты», но они приходят не из кода рендера, а **из самого `field.label` в JSON-блоке** (тестовая страница так заведена).

### Что добавляется к ранее одобренному плану

**A. Решение по «английским хвостам» — двухслойное:**

1. Display formatter `getFieldDisplayLabel` (как и было) — гарантирует, что в UI выводится только `field.label`, без подмеса `field.type`.
2. **Новое:** sanitizer `stripTechnicalSuffix(label)` — на этапе рендера label вырезает в конце скобочные суффиксы `(boolean|select|multiselect|date|number|file|file single|file multi|text|email|phone|password)`, регистронезависимо. Это закрывает кейс, когда в legacy-данных type уже зашит в сам label. Не мутирует данные, работает только на отображении.
3. Применяется в публичной форме (`FormSection.tsx`), preview редактора, detail-диалоге `/admin/forms` (там label идёт как `key` — добавить sanitizer в отображаемый ключ, не трогая лежащие в БД ключи).

**B. Визуальный апгрейд `FormSection.tsx` — preview и публичная форма (один компонент):**
Заменить нативные HTML-контролы на shadcn-аналоги, использующиеся в CRM:


| Текущее                                                                                      | Заменить на                                                                                                                                |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `<select>` (single choice)                                                                   | `<Select>` из `@/components/ui/select` (как в фильтрах /admin/deals)                                                                       |
| `<input type="checkbox">` (multiselect, group of options)                                    | `<Checkbox>` из `@/components/ui/checkbox` + `<Label>`                                                                                     |
| `<input type="checkbox">` (single boolean) → сейчас рендерится как radio Да/Нет              | `<RadioGroup>` + `<RadioGroupItem>` из `@/components/ui/radio-group` (визуально аккуратные точки)                                          |
| `<input type="radio">` (radio choice)                                                        | `<RadioGroup>` + `<RadioGroupItem>`                                                                                                        |
| `<input type="date">` (нативный календарь браузера)                                          | shadcn `<Popover>` + `<Calendar>` (date-picker как в фильтре «Все периоды» CRM)                                                            |
| `<input type="number">`, `<input type="text">`, `<input type="email">`, `<input type="tel">` | `<Input>` из `@/components/ui/input` (уже частично, проверить везде)                                                                       |
| `<textarea>`                                                                                 | `<Textarea>` из `@/components/ui/textarea`                                                                                                 |
| File-кнопка                                                                                  | `<Button variant="outline">` с иконкой `<Upload>` lucide, под ней список загруженных файлов — `<Badge variant="secondary">` с filename + ✕ |
| Submit-кнопка                                                                                | `<Button>` основной (default), full-width на mobile                                                                                        |


**C. Контейнер формы — карточный стиль CRM:**

- Внешняя обёртка: `rounded-xl border border-border/60 bg-card p-4 sm:p-6 shadow-sm` (как карточка сделки на скрине 1).
- Spacing между полями: `space-y-5` (вместо текущего сжатого).
- Label поля: `text-sm font-medium text-foreground` + `*` для required `text-destructive`.
- Helper-text/описание поля: `text-xs text-muted-foreground mt-1`.
- Ошибки валидации: `text-xs text-destructive mt-1` (не alert-баннер сверху).
- Required-звёздочка `*` рендерится через формат, не подмешивается в label.

**D. Цветовая палитра (semantic tokens, не raw):**

- Фон карточки: `bg-card`.
- Границы: `border-border/60`.
- Акценты (выбранный radio/checkbox/select item): primary tokens из `index.css` (тот же дорогой синий-индиго, что в Sidebar и в CRM-бейджах).
- Hover на интерактивных элементах: `hover:bg-accent/50`.
- Никаких `bg-blue-500`, `text-red-600` — только токены.

**E. Адаптив preview:**

- На <640px: все контролы full-width, padding контейнера `p-4`.
- Submit-кнопка: `w-full sm:w-auto`.
- Date-picker popover: `w-auto` с авто-позиционированием.

### Что НЕ трогаем (повтор для ясности)

- Логика submit/upload/validation/file-uploader контракт.
- `FormBlockEditor` (редактор настроек блока) — только убрать `{sf.type}` у auth-полей (как в исходном плане).
- Структура `field.type` во внутреннем state.
- БД-ключи в `form_data`.

### Обновлённый список файлов


| Файл                                                                                  | Действие                                                                              |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/pages/admin/AdminSiteEditor.tsx`                                                 | edit — адаптивная шапка                                                               |
| `src/components/admin/site-builder/blocks/FormBlockEditor.tsx`                        | edit — убрать `{sf.type}` у auth-полей                                                |
| `src/lib/formFieldLabel.ts`                                                           | create — `getFieldDisplayLabel` + `stripTechnicalSuffix`                              |
| `src/components/site-renderer/blocks/FormSection.tsx`                                 | edit (крупно) — замена нативных контролов на shadcn, карточный стиль, sanitizer label |
| `src/components/admin/forms/FormsDetailOpener.tsx` (или где рендерится detail-диалог) | edit — sanitizer на отображаемые ключи `form_data`                                    |


### DoD (обновлённый)

- Шапка `/admin/sites/:id` адаптивна на 375 / 768 / 1280 px.
- В UI нигде не видно `(boolean)/(select)/(multiselect)/(date)/(number)/(file)/(text)/(email)/(phone)/(password)` — ни как подмес type, ни как legacy-хвост в label.
- Preview формы и публичная форма визуально соответствуют стилю CRM /admin/deals: shadcn Select / Checkbox / RadioGroup / Calendar, карточный контейнер, semantic tokens, мягкие границы.
- Нативных `<select>`, `<input type="date">`, `<input type="checkbox">`, `<input type="radio">` в `FormSection.tsx` не остаётся.
- 4 proof-скрина: editor desktop, editor mobile, preview desktop (`/form-proof`), preview mobile (`/form-proof`).
- Логика submit/upload/payment/validation/auth не изменена.