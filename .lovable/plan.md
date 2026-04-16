# да, согласен, с учетом правок:

&nbsp;

1. **Не трогать старый PreregistrationsTabContent, если вкладка Предзаписи уже живёт внутри нового /admin/forms.**
  Для нового домена должен быть **один canonical list layer** — через FormsHubTable + useFormsHubData.
  Старую legacy-таблицу из платежей не нужно «реанимировать» или встраивать обратно. Нужен только reuse summary/status chips сверху, если они реально полезны.
2. **Все не является single-source вкладкой.**
  В DoD и в тексте плана исправить формулировку: единый дизайн должен быть у:
  &nbsp;
  - Все — aggregated tab
  - Анкеты сайта
  - Предзаписи
  - Обучение
    Это важно, чтобы подрядчик не начал ломать aggregated mode под вид single-source.
  &nbsp;
3. **В По продуктам не надо делать полный grid DnD/resize для каждой вложенной таблицы независимо.**
  Нужно использовать **общий columns state** и общий visual standard, иначе получится хаос и рассинхрон колонок между группами.
  Правильный вариант:
  &nbsp;
  - один storage key для forms-columns
  - embedded tables читают тот же порядок/ширины
  - toolbar скрыт
  - но header/width/order применяются одинаково ко всем embedded tables
  &nbsp;
4. **Двухуровневую группировку уточнить.**
  Для training не просто module -> lesson, а:
  &nbsp;
  - product
  - внутри продукта секции по source: Анкеты сайта / Предзаписи / Обучение
  - внутри Обучение: module -> lesson
    Иначе смешаются site/preorder/training в одном дереве.
  &nbsp;
5. **Для строк training в grouped mode bulk-select допустим, bulk-delete — нет.**
  Это надо явно зафиксировать в UX:
  &nbsp;
  - training rows можно выделять
  - при mixed selection кнопка удаления либо disabled, либо удаляет только допустимые site_form + preorder после явного предупреждения
    Нельзя делать скрытую частичную операцию без понятного текста.
  &nbsp;
6. **Удаление должно быть только для тестовых/служебных записей, если это реально требование бизнеса.**
  Сейчас в плане написано просто “удаление выделенных”. Это слишком широко.
  Нужно зафиксировать:
  &nbsp;
  - либо delete доступен только admin/super_admin
  - либо delete доступен только для site_form и preorder
  - либо delete доступен только для записей, помеченных как тестовые
    Иначе можно случайно снести реальные заявки.
  &nbsp;
7. **Перед bulk-delete нужен dry-run summary в confirm dialog.**
  Не просто “Будет удалено N записей”, а:
  &nbsp;
  - сколько site_form
  - сколько preorder
  - сколько training пропущено / не может быть удалено
    Это соответствует текущему принципу dry-run→execute.
  &nbsp;
8. **Нужен query invalidation по всем relevant tabs, а не один общий refetch вслепую.**
  После delete нужно явно инвалидировать queries forms-hub для:
  &nbsp;
  - all
  - site
  - preorder
  - by-product
  - export
    Чтобы не получить stale counts/rows.
  &nbsp;
9. **FormsHubFilters не должен знать про ColumnSettings как про бизнес-логику.**
  Лучше держать layout так:
  &nbsp;
  - filters bar
  - справа actions zone (ColumnSettings, при необходимости export button и т.п.)
    То есть визуально в одной строке можно, но архитектурно не смешивать компонент фильтров и компонент управления колонками.
  &nbsp;
10. **Нужен явный zero-regression guard для PATCH 2 перед PATCH 3.**
  Этот PATCH строится поверх PATCH 2 parity-table. Сначала должен быть подтверждён стабильный shared table layer:
  &nbsp;
  - contacts не сломаны
  - forms single tabs работают
  - row click/detail стабилен
    И только потом bulk-delete и grouped embedded enhancements.
  &nbsp;
11. **В По продуктам counts должны считаться на каждом уровне дерева.**
  Не только product count, но и:
  &nbsp;
  - source section count
  - module count
  - lesson count
    Иначе дерево теряет смысл и неудобно читать.
  &nbsp;
12. **Не делать отдельный FormsBulkActionsBar, если существующий BulkActionsBar можно расширить add-only.**
  Сначала проверить reuse existing bar. Новый bar создавать только если текущий компонент реально не подходит по контракту. Не плодить второй action-shell без необходимости.
13. **DoD нужно дополнить доказательством mixed-source сценария.**
  Обязательно отдельно проверить:
  &nbsp;
  - выделены site_form + preorder + training
  - delete correctly explains what will be deleted and what will be skipped
  - training не удаляется
  - selection корректно очищается/обновляется после операции
  &nbsp;

&nbsp;

&nbsp;

Копируемый блок для [lovable.dev](http://lovable.dev):

```
Дополни план следующими правками:

1. Не реанимировать и не встраивать legacy-таблицу `PreregistrationsTabContent` обратно как второй table-engine. В новом `/admin/forms` canonical list-view должен оставаться только через `FormsHubTable` + `useFormsHubData`. Reuse допустим только для summary/status chips сверху.
2. Исправить формулировку: вкладка `Все` — aggregated tab, а не single-source. Не ломать aggregated mode.
3. Для `По продуктам` использовать общий columns state и общий storage key. Embedded tables должны читать те же порядок/ширины колонок, но без отдельного toolbar в каждой группе.
4. Уточнить структуру grouped mode:
   - product
   - внутри продукта source-sections: `Анкеты сайта` / `Предзаписи` / `Обучение`
   - внутри `Обучение`: `module -> lesson`
5. Training rows можно выделять, но bulk-delete для training запрещён. Для mixed selection UX должен явно показывать, что training будет пропущен / не может быть удалён.
6. Bulk-delete нельзя описывать как просто “удаление выделенных”. Зафиксировать scope:
   - только admin/super_admin
   - только `site_form` и `preorder`
   - training никогда не удалять
   - при необходимости ограничить delete тестовыми/служебными записями, если это бизнес-требование
7. Перед execute bulk-delete показать dry-run summary в confirm dialog:
   - сколько `site_form`
   - сколько `preorder`
   - сколько `training` будет пропущено
8. После delete инвалидировать все relevant forms queries, чтобы не было stale counts/rows во вкладках `Все`, `Анкеты сайта`, `Предзаписи`, `По продуктам`, `Экспорт`.
9. `ColumnSettings` визуально можно держать справа в одной строке с фильтрами, но архитектурно не вшивать бизнес-логику управления колонками внутрь `FormsHubFilters`.
10. PATCH 3 выполнять только поверх подтверждённого zero-regression PATCH 2 shared table layer. Не смешивать фиксы PATCH 2 и bulk/grouping PATCH 3 в один рискованный комбайн.
11. В grouped mode показывать counts на каждом уровне дерева:
   - product
   - source section
   - module
   - lesson
12. Не создавать отдельный `FormsBulkActionsBar`, если существующий `BulkActionsBar` можно расширить add-only. Новый компонент только если reuse реально невозможен.
13. В финальный proof добавить mixed-source сценарий:
   - выделение `site_form + preorder + training`
   - delete summary корректно показывает удаляемые и пропускаемые записи
   - training не удаляется
   - selection и список корректно обновляются после операции
```

План хороший. Эти правки нужны, чтобы не получить второй параллельный table-engine, не сломать aggregated mode и не сделать опасное bulk-delete.

&nbsp;

План: PATCH 3 — единый дизайн таблицы и bulk-actions для `/admin/forms`

## Что просит пользователь

1. **Единый дизайн таблицы во всех вкладках** `/admin/forms` — переиспользовать стандарт из `/admin/contacts`. Сейчас каждая вкладка выглядит по-разному.
2. **Дизайн "По продуктам" нравится** — оставить, но добавить туда DnD/resize колонок.
3. **Bulk-actions работают** — сейчас можно выделить, но нельзя ничего сделать. Минимум: **удаление выделенных тестовых записей**.
4. **Двухуровневая группировка в "По продуктам"**: Продукт → Модуль/Урок. Сейчас "Бухгалтерия как бизнес" появляется дважды (два разных урока), должна быть одна группа `Бухгалтерия как бизнес` с раскрывающимися подгруппами по модулям/урокам.

## Диагностика

**Текущее состояние (по скринам и коду):**

- Вкладка "Все" уже использует `FormsHubTable` с canonical pattern (PATCH 2 выполнен) — но в `FormsHubFilters` фильтры визуально оторваны от таблицы, ColumnSettings висит отдельной кнопкой справа.
- Вкладка "Предзаписи" использует **legacy** `PreregistrationsTabContent` с собственной таблицей (статус-фильтры цветные, колонки `Карта/Попытки/Last Attempt/TG/Email`) — НЕ canonical.
- Вкладка "По продуктам" группирует только по `product_id` плоско — для training рядов не учитываются `module_id`/`lesson_id`.
- `BulkActionsBar` уже подключён, но показывает только count + clear — без действий.
- В `useFormsHubData` для training-рядов уже подгружаются `module_title`/`lesson_title` (через `lesson_progress_state` join) — нужно только использовать их для группировки.

## Шаги

### 1. Унификация всех вкладок на FormsHubTable

`PreregistrationsTabContent` не переписывать его внутреннюю логику данных, но **визуально привести к canonical**: использовать `FormsHubTable` для табличной части. Статус-чипсы (Все/Ожидают/Нет карты/Ошибка/Оплаченные) и summary-карточки сверху оставить — это полезный UX. Только **сама таблица** заменяется на `FormsHubTable` с теми же колонками, что в "Все".

Альтернатива (чище): `PreregistrationsTabContent` → проксировать в `FormsHubTable` с `source_type: 'preorder'` фильтром, summary-карточки рендерить сверху отдельным компонентом.

**Решение:** оставить summary-карточки и статус-чипсы как layer над `FormsHubTable`. Внутренняя legacy-таблица удаляется.

### 2. Двухуровневая группировка в "По продуктам"

Переписать `FormsByProductTabContent`:

- Группировка level 1: по `product_id` (как сейчас)
- Группировка level 2 **внутри training-рядов**: по `module_id` → `lesson_id`
- Site_form/preorder ряды внутри продукта остаются плоско в отдельной подсекции "Анкеты сайта" / "Предзаписи" (или все вместе, без подгрупп — site/preorder обычно не имеют lesson)

Структура:

```
▼ Бухгалтерия как бизнес (92)
  ├─ ▼ Анкеты сайта (15)
  │    [embedded FormsHubTable]
  ├─ ▼ Предзаписи (29)
  │    [embedded FormsHubTable]
  └─ ▼ Обучение (48)
       ├─ ▼ Модуль 1: Введение (12)
       │    ├─ ▼ Урок 1: Анализ портфеля (8)
       │    │    [embedded FormsHubTable]
       │    └─ ▼ Урок 2: Диагностика (4)
       └─ ▼ Модуль 2: Работа с клиентами (36)
```

Визуальный стиль — тот же `border-l-4 border-l-indigo-300` + `Layers`/`BookOpen`/`FileText` иконки + `Collapsible` + counts в badge.

### 3. DnD/resize колонок в embedded-режиме (вкладка "По продуктам")

Сейчас `embedded` вариант скрывает toolbar и DnD. Изменить контракт:

- `variant="full"` — toolbar (ColumnSettings) + DnD + resize
- `variant="embedded"` — БЕЗ toolbar, но **с** DnD + resize (как просит пользователь)
- Колонки одного embedded-стола в группе синхронизированы через тот же `localStorage` ключ `admin_forms_columns_v1`, чтобы порядок и ширины применялись ко всем секциям одновременно.

### 4. Bulk-actions: удаление выделенных

Расширить `BulkActionsBar` (или создать `FormsBulkActionsBar`):

- Показ: "Выделено: N" + кнопки `[🗑 Удалить]` `[✕ Снять выделение]`
- Клик "Удалить" → `AlertDialog` с подтверждением + текстом "Будет удалено N записей"
- При подтверждении — групповой delete по таблицам:
  - `site_form_submissions` для `source_type === 'site_form'`
  - `course_preregistrations` для `source_type === 'preorder'`
  - **Training**: НЕ удалять `lesson_progress_state` напрямую (это пользовательский прогресс) — для training показать toast "Записи обучения удалить нельзя, скройте через фильтр"
- После успеха: `toast` + `queryClient.invalidateQueries(['forms-hub'])` + `clearSelection()`
- RLS: операция требует admin/super_admin — guard на клиенте через `useUserRole`, на сервере — RLS `delete` policy на этих таблицах (проверить, что они уже есть).

### 5. UX-полировка фильтров

Объединить filters bar и ColumnSettings в одну строку, как в `/admin/contacts`:

```
[🔍 Поиск] [Тип ▾] [Продукт ▾] [Период от] [Период до] [Сделка ▾] [Аккаунт ▾]    [⚙ Колонки]
```

ColumnSettings справа, как на скрине contacts ("Колонки" в правом верхнем углу).

### 6. Источники названий module/lesson

`useFormsHubData` уже джойнит `lesson_progress_state.module_id, lesson_id` + `training_modules(title)` + `training_lessons(title)` (проверить — если не джойнит, добавить). Эти поля попадают в `FormsHubRow.module_title` / `lesson_title` и используются для level-2 группировки.

## Файлы


| Файл                                                                                                            | Действие                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/admin/forms/FormsHubTable.tsx`                                                                  | `embedded` теперь поддерживает DnD+resize; toolbar по-прежнему скрыт                                                                        |
| `src/components/admin/forms/FormsBulkActionsBar.tsx`                                                            | NEW: bar с кнопкой Удалить + confirm dialog                                                                                                 |
| `src/components/admin/forms/FormsByProductTabContent.tsx`                                                       | Двухуровневая группировка product → module → lesson                                                                                         |
| `src/components/admin/forms/FormsHubFilters.tsx`                                                                | Перенести ColumnSettings в правый край, выровнять как в contacts                                                                            |
| `src/components/admin/payments/PreregistrationsTabContent.tsx`                                                  | Внутреннюю таблицу заменить на `FormsHubTable`, оставить summary + статус-чипсы как layer                                                   |
| `src/hooks/useFormsHubData.ts`                                                                                  | Убедиться, что `module_id/title` и `lesson_id/title` есть в training-рядах (без изменения серверной логики PATCH 1, только проверка select) |
| `src/components/admin/forms/FormsAllTabContent.tsx` / `FormsSiteTabContent.tsx` / `FormsTrainingTabContent.tsx` | Подключить `FormsBulkActionsBar`                                                                                                            |


## Scope guard

- НЕ менять `useFormsHubData` серверные фильтры/пагинацию/exportMode (PATCH 1)
- НЕ менять detail viewers (`StudentProgressModal`, `PreregistrationDetailSheet`, form dialog)
- НЕ создавать второй table engine — всё через `FormsHubTable`
- НЕ удалять `lesson_progress_state` через bulk-delete (только site_form + preorder)
- Zero-regression `/admin/contacts`

## DoD

1. Все 4 single-source вкладки (`Все`, `Анкеты сайта`, `Предзаписи`, `Обучение`) визуально идентичны — единый `FormsHubTable`
2. "Предзаписи" сохраняют summary-карточки и статус-чипсы сверху, но таблица — canonical
3. "По продуктам" имеет двухуровневую группировку: продукт → (анкеты | предзаписи | обучение → модуль → урок)
4. В embedded-таблицах внутри групп работает DnD и resize колонок
5. Bulk-удаление работает для site_form и preorder с подтверждением; для training — toast "недоступно"
6. После удаления список обновляется, выделение сбрасывается
7. ColumnSettings размещён в правом верхнем углу (как в contacts)
8. PATCH 1+2 не сломаны: filters/pagination/export/redirects/detail viewers работают
9. `/admin/contacts` без регрессий