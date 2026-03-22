# Now let me look at the ContactDetailSheet's shell — the SheetContent, header layout, and sections structure:

Now I have the key shell patterns. Let me check the profile tab content to see the section/card structure:

I now have all the information needed. Let me look at the current `OrganizationDetailsForm` props contract briefly to understand the view-mode challenge:

Now I have the full picture. The key shell pattern from `ContactDetailSheet`:

- `SheetContent` class: `w-full sm:max-w-[60vw] lg:max-w-3xl p-0 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] flex flex-col h-[100dvh] max-h-[100dvh] overflow-hidden`

- Header: `SheetHeader` with `p-4 sm:p-6 pb-3 sm:pb-4 pr-14 sm:pr-16 flex-shrink-0`, name + badges/actions row, `Separator`

- Scrollable content: `flex-1 overflow-y-auto` → `px-4 sm:px-6 py-4 pb-24`

- Sections as `Card` with `CardHeader` (small title) + `CardContent` (key-value rows with `Separator` dividers)

# PATCH 5R+ — View-карточка реквизитов в стиле ContactDetailSheet

## Что делаем

Добавляем **view-mode** для записей реквизитов в AI-разделе. По клику на строку таблицы открывается **карточка просмотра** (не голая форма), визуально идентичная `ContactDetailSheet`. Из карточки можно перейти в edit-mode.

## Решение зафиксировано

- **create mode** — остаётся как есть: `EntityEditorSheet` с голой формой в sheet

- **view mode (open existing)** — новый `EntityViewSheet`, shell 1:1 как `ContactDetailSheet`

- **edit mode** — запускается из view-карточки кнопкой «Редактировать», открывает `EntityEditorSheet`

- Единый UX-стандарт "record sheet" — тот же shell будет переиспользован для физлиц в PATCH 6

## Эталонный shell (из ContactDetailSheet)

```text

SheetContent:

  className="w-full sm:max-w-[60vw] lg:max-w-3xl p-0

    pt-[env(safe-area-inset-top,0px)]

    pb-[env(safe-area-inset-bottom,0px)]

    flex flex-col h-[100dvh] max-h-[100dvh] overflow-hidden"

SheetHeader:

  className="p-4 sm:p-6 pb-3 sm:pb-4 pr-14 sm:pr-16 flex-shrink-0"

  → Row 1: Icon/avatar + Title (short name) + subtitle (оргформа + УНП)

  → Separator

  → Row 2: Badge pills + action buttons

Scrollable body:

  className="flex-1 overflow-y-auto"

  → inner: className="px-4 sm:px-6 py-4 pb-24"

  → sections as  with /

  → key-value rows with  dividers

```

## EntityViewSheet — структура карточки

### Header

- **Иконка**: `Building2` (ЮЛ) или `User` (ИП) вместо аватара

- **Название**: `getEntityShortName(entity)` — крупный заголовок

- **Подзаголовок**: полная оргформа + УНП

- **Separator**

- **Action bar** (badge pills, как в ContactDetailSheet):

  - Badge «ЮЛ» или «ИП»

  - Badge статуса (Активный / Архив)

  - Badge «Платёжные» (если `purpose === 'billing'`)

  - Кнопка «Редактировать» → открывает `EntityEditorSheet`

  - Кнопка «В архив» → только для `purpose === 'document'` && `status === 'active'`

### Секции контента (Card blocks)

1. **Основная информация**

   - Полное наименование / ФИО (для ИП)

   - Организационно-правовая форма

   - УНП

   - Свидетельство о гос. регистрации

2. **Адрес**

   - Юридический адрес (все сегменты в одну строку)

   - Почтовый адрес (если отличается)

3. **Руководитель / Основание** (только для ЮЛ)

   - Должность руководителя

   - ФИО руководителя

   - Действует на основании

4. **Банковские реквизиты**

   - Расчётный счёт

   - Банк

   - Код банка

5. **Служебная информация**

   - purpose (Платёжные / Документы)

   - Дата создания

   - ID записи

## Файлы

| Файл | Действие |

|------|----------|

| `src/components/ai-requisites/EntityViewSheet.tsx` | **создать** — view-карточка в shell ContactDetailSheet |

| `src/components/ai-requisites/EntityEditorSheet.tsx` | без изменений (create + edit form) |

| `src/components/ai-requisites/EntityTableView.tsx` | **изменить** — `onClick` row → `onView(entity)` вместо `onEdit(entity)` |

| `src/pages/AI.tsx` | **изменить** — добавить state для view-sheet, связать view → edit flow |

## Архитектура

```text

AI.tsx (activeSubTab === 'entities')

  └─ 

       ├─ onClick row → onView(entity)    ← ИЗМЕНЕНО: было onEdit

       └─ «Добавить» → onCreateNew

  └─                      ← НОВЫЙ

       ├─ shell 1:1 ContactDetailSheet

       ├─ секции Card: основные, адрес, руководитель, банк, служебные

       ├─ action bar: badge + «Редактировать» + «В архив»

       └─ «Редактировать» → закрывает view, открывает EntityEditorSheet

  └─                    ← БЕЗ ИЗМЕНЕНИЙ

       ├─ create mode: новая запись

       └─ edit mode: редактирование существующей

```

## Flow

1. Пользователь кликает строку таблицы → открывается `EntityViewSheet` (view mode)

2. В карточке нажимает «Редактировать» → `EntityViewSheet` закрывается, открывается `EntityEditorSheet` (edit mode)

3. После сохранения в edit → sheet закрывается, `EntityViewSheet` может переоткрыться с обновлёнными данными (или просто закрыть оба)

4. Кнопка «Добавить» в таблице → сразу `EntityEditorSheet` (create mode), без view

## PATCH 6 — фиксация стандарта

- Для физлиц в PATCH 6 используется **тот же shell** `EntityViewSheet` параметризуется, или создаётся `PersonViewSheet` с идентичным shell)

- Shell-layout выносится как паттерн, а не копируется заново

- Секции контента будут другие (ФИО, паспорт, адрес), но container, header, action bar, scroll behavior — 1:1

## DoD

- Клик по записи в таблице открывает **карточку просмотра**, а не сразу форму

- Карточка открывается в shell-дизайне, идентичном ContactDetailSheet (ширина, overlay, header layout, close button, отступы, радиусы, scroll)

- Контент карточки структурирован секциями (Card blocks), не длинной плоской формой

- Из карточки работает переход в edit-mode через кнопку «Редактировать»

- Billing-record открывается в этом же shell, но **без** archive action

- Document-record открывается в этом же shell **с** archive action

- Create-flow не копирует contact card — используется существующий `EntityEditorSheet`

- Action bar содержит: badge типа, badge статуса, кнопку редактирования, кнопку архивирования (для document)

- `EntityEditorSheet` не изменён

- Settings page не тронута

- Source of truth `client_legal_details`) не меняется

- Стандарт shell зафиксирован для переиспользования в PATCH 6

&nbsp;

PATCH 5R+ — View-карточка реквизитов в стиле ContactDetailSheet

## Что делаем

Добавляем **view-mode** для записей реквизитов в AI-разделе. По клику на строку таблицы открывается **карточка просмотра** (не голая форма), визуально идентичная `ContactDetailSheet`. Из карточки можно перейти в edit-mode.

## Решение зафиксировано

- **create mode** — остаётся как есть: `EntityEditorSheet` с голой формой в sheet
- **view mode (open existing)** — новый `EntityViewSheet`, shell 1:1 как `ContactDetailSheet`
- **edit mode** — запускается из view-карточки кнопкой «Редактировать», открывает `EntityEditorSheet`
- Единый UX-стандарт "record sheet" — тот же shell будет переиспользован для физлиц в PATCH 6

## Эталонный shell (из ContactDetailSheet)

```text
SheetContent:
  className="w-full sm:max-w-[60vw] lg:max-w-3xl p-0
    pt-[env(safe-area-inset-top,0px)]
    pb-[env(safe-area-inset-bottom,0px)]
    flex flex-col h-[100dvh] max-h-[100dvh] overflow-hidden"

SheetHeader:
  className="p-4 sm:p-6 pb-3 sm:pb-4 pr-14 sm:pr-16 flex-shrink-0"
  → Row 1: Icon/avatar + Title (short name) + subtitle (оргформа + УНП)
  → Separator
  → Row 2: Badge pills + action buttons

Scrollable body:
  className="flex-1 overflow-y-auto"
  → inner: className="px-4 sm:px-6 py-4 pb-24"
  → sections as <Card> with <CardHeader>/<CardContent>
  → key-value rows with <Separator> dividers
```

## EntityViewSheet — структура карточки

### Header

- **Иконка**: `Building2` (ЮЛ) или `User` (ИП) вместо аватара
- **Название**: `getEntityShortName(entity)` — крупный заголовок
- **Подзаголовок**: полная оргформа + УНП
- **Separator**
- **Action bar** (badge pills, как в ContactDetailSheet):
  - Badge «ЮЛ» или «ИП»
  - Badge статуса (Активный / Архив)
  - Badge «Платёжные» (если `purpose === 'billing'`)
  - Кнопка «Редактировать» → открывает `EntityEditorSheet`
  - Кнопка «В архив» → только для `purpose === 'document'` && `status === 'active'`

### Секции контента (Card blocks)

1. **Основная информация**
  - Полное наименование / ФИО (для ИП)
  - Организационно-правовая форма
  - УНП
  - Свидетельство о гос. регистрации
2. **Адрес**
  - Юридический адрес (все сегменты в одну строку)
  - Почтовый адрес (если отличается)
3. **Руководитель / Основание** (только для ЮЛ)
  - Должность руководителя
  - ФИО руководителя
  - Действует на основании
4. **Банковские реквизиты**
  - Расчётный счёт
  - Банк
  - Код банка
5. **Служебная информация**
  - purpose (Платёжные / Документы)
  - Дата создания
  - ID записи

## Файлы


| Файл                                                 | Действие                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `src/components/ai-requisites/EntityViewSheet.tsx`   | **создать** — view-карточка в shell ContactDetailSheet                  |
| `src/components/ai-requisites/EntityEditorSheet.tsx` | без изменений (create + edit form)                                      |
| `src/components/ai-requisites/EntityTableView.tsx`   | **изменить** — `onClick` row → `onView(entity)` вместо `onEdit(entity)` |
| `src/pages/AI.tsx`                                   | **изменить** — добавить state для view-sheet, связать view → edit flow  |


## Архитектура

```text
AI.tsx (activeSubTab === 'entities')
  └─ <EntityTableView>
       ├─ onClick row → onView(entity)    ← ИЗМЕНЕНО: было onEdit
       └─ «Добавить» → onCreateNew

  └─ <EntityViewSheet>                     ← НОВЫЙ
       ├─ shell 1:1 ContactDetailSheet
       ├─ секции Card: основные, адрес, руководитель, банк, служебные
       ├─ action bar: badge + «Редактировать» + «В архив»
       └─ «Редактировать» → закрывает view, открывает EntityEditorSheet

  └─ <EntityEditorSheet>                   ← БЕЗ ИЗМЕНЕНИЙ
       ├─ create mode: новая запись
       └─ edit mode: редактирование существующей
```

## Flow

1. Пользователь кликает строку таблицы → открывается `EntityViewSheet` (view mode)
2. В карточке нажимает «Редактировать» → `EntityViewSheet` закрывается, открывается `EntityEditorSheet` (edit mode)
3. После сохранения в edit → sheet закрывается, `EntityViewSheet` может переоткрыться с обновлёнными данными (или просто закрыть оба)
4. Кнопка «Добавить» в таблице → сразу `EntityEditorSheet` (create mode), без view

## PATCH 6 — фиксация стандарта

- Для физлиц в PATCH 6 используется **тот же shell** (`EntityViewSheet` параметризуется, или создаётся `PersonViewSheet` с идентичным shell)
- Shell-layout выносится как паттерн, а не копируется заново
- Секции контента будут другие (ФИО, паспорт, адрес), но container, header, action bar, scroll behavior — 1:1

## DoD

- Клик по записи в таблице открывает **карточку просмотра**, а не сразу форму
- Карточка открывается в shell-дизайне, идентичном ContactDetailSheet (ширина, overlay, header layout, close button, отступы, радиусы, scroll)
- Контент карточки структурирован секциями (Card blocks), не длинной плоской формой
- Из карточки работает переход в edit-mode через кнопку «Редактировать»
- Billing-record открывается в этом же shell, но **без** archive action
- Document-record открывается в этом же shell **с** archive action
- Create-flow не копирует contact card — используется существующий `EntityEditorSheet`
- Action bar содержит: badge типа, badge статуса, кнопку редактирования, кнопку архивирования (для document)
- `EntityEditorSheet` не изменён
- Settings page не тронута
- Source of truth (`client_legal_details`) не меняется
- Стандарт shell зафиксирован для переиспользования в PATCH 6