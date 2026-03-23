# да, согласен, с учетом правок:

1. **Не делать** `INSERT for authenticated` **в общий справочник напрямую.**  
Это слишком широкое право для общей таблицы. Лучше:
  - либо secure RPC / edge / server-side action для `createPosition`
  - либо отдельная SQL function с проверкой, нормализацией, anti-duplicate и audit  
  Прямую RLS policy `INSERT to authenticated` на общий каталог не добавлять.
2. **Для** `ON CONFLICT (code)` **нужен гарантированный unique index / unique constraint на** `code`**.**  
Это нужно явно включить в миграцию, если его ещё нет.  
Без этого seed/upsert план неполный.
3. **Сортировку в UI делать по** `label`**, а не надеяться на** `sort_order=999` **у новых записей.**  
Иначе новые добавленные должности будут визуально жить отдельно.  
Правильно:
  - seed может проставить `sort_order`
  - но `PositionPicker` для списка и поиска сортирует по `label asc`
4. **Кнопку** `Добавить "..." в справочник` **показывать только если нет точного нормализованного совпадения.**  
Не по правилу “нет exact match, даже если есть partial match”, а именно:
  - partial match можно показывать списком
  - add-new показывать только когда после нормализации точного совпадения нет  
  Это уменьшит мусор и дубли.
5. **Нормализацию нужно зафиксировать одинаковой в seed и в UI mutation.**  
Не только для `label`, но и для `code`.  
То есть один и тот же алгоритм:
  - trim
  - collapse spaces
  - lowercase
  - для `code`: пробелы в `_`, убрать лишние спецсимволы  
  Иначе seed и UI начнут создавать расхождения.
6. **Для старых links с** `custom_position_text` **нужен мягкий edit-flow.**  
При edit такого link:
  - не терять текущее значение молча
  - либо показывать его в picker search/input
  - либо отдельным текстом: “Текущая должность: …”  
  Чтобы пользователь понимал, что было сохранено раньше.
7. `custom_position_text` **пока не убирать из payload полностью.**  
Оставить совместимость:
  - старые записи читаются как раньше
  - новые записи по основному UX должны идти через `position_catalog_id`
  - fallback оставить только для legacy-совместимости
8. **Для createPosition нужен proof anti-duplicate на двух кейсах:**
  - точный дубль: `директор`
  - нормализованный дубль: `Директор` / `ДИРЕКТОР`  
  В обоих случаях новая запись не должна создаваться.
9. **Добавить audit proof.**  
При создании новой должности из UI нужно логировать факт создания новой записи в audit_logs или эквивалентный журнал.  
Это особенно важно, раз справочник общий.
10. **В** `Что НЕ трогаем` **добавить ещё:**

- `legal_details_roles_catalog`
- links founder/other semantics
- delete/reassign UX, кроме совместимости с новым picker

В остальном план правильный и можно отдавать в исполнение.

&nbsp;

PATCH 7.3 — Справочник должностей: поиск + выбор + добавление новых

## Scope

3 задачи:

1. Seed-миграция ~230 должностей в `legal_details_positions_catalog`
2. Новый компонент `PositionPicker` — searchable combobox с возможностью добавления
3. Mutation для создания новой должности из UI + интеграция в форму

## Что меняется

### 1. Миграция — seed/upsert должностей

SQL-миграция с `INSERT ... ON CONFLICT (code) DO UPDATE SET is_active = true`.

Генерация `code` — детерминированная: `lower(trim(label))`, пробелы → `_`, дефисы сохраняются, удаление спецсимволов. Например: `"заведующий архивом"` → `"заведующий_архивом"`.

`sort_order` — по алфавитному порядку (порядковый номер в отсортированном списке).

Существующие 5 записей (директор, главный бухгалтер, зам. директора, бухгалтер, секретарь) не удаляются — `ON CONFLICT` их не тронет если активны, реактивирует если нет.

~230 новых записей из переданного списка.

### 2. Компонент `PositionPicker.tsx`

Новый файл `src/components/ai-requisites/PositionPicker.tsx`.

Архитектура — копия паттерна `PersonPicker`:

- `Popover` + `Input` (поиск) + список кнопок
- Props: `positions: PositionCatalogEntry[]`, `value: string | null`, `onChange: (id: string | null) => void`, `onCreateNew: (label: string) => Promise<string | null>`
- При пустом поиске — полный список (max 50, прокрутка)
- При вводе — фильтрация по подстроке (case-insensitive)
- Если совпадений нет или точного совпадения нет — показать кнопку `+ Добавить "..." в справочник`
- Клик по кнопке → вызов `onCreateNew(label)` → получение id → `onChange(id)` → закрытие

### 3. Hook — mutation `createPosition` в `useEntityPersonLinks.ts`

Новая функция нормализации:

```text
normalizePositionLabel(raw: string): string
  → trim → collapse spaces → lowercase
```

Mutation `createPosition`:

1. Нормализовать label
2. Проверить: `select id from legal_details_positions_catalog where lower(trim(label)) = normalizedLabel and is_active = true`
3. Если найдено → toast «Такая должность уже есть в справочнике» → вернуть существующий id
4. Если не найдено → `insert` с `code` = normalized label с `_` вместо пробелов, `sort_order = 999`
5. Invalidate `["positions-catalog"]`
6. Вернуть новый id

### 4. Интеграция в `EntityPersonLinkForm.tsx`

Заменить блок `roleType === "position"` (строки 224–256):

- Вместо `<Select>` + fallback `<Input>` → единый `<PositionPicker>`
- `onCreateNew` → вызывает `createPosition` из hook → устанавливает `positionCatalogId`
- `custom_position_text` input убирается из основного flow, но `buildPayload` сохраняет обратную совместимость для старых записей с `custom_position_text`
- `canSubmit` для `position`: достаточно `positionCatalogId` (custom text path больше не нужен для новых записей)

### 5. Обратная совместимость

- Старые links с `custom_position_text` и без `position_catalog_id` продолжают отображаться в `EntityPersonLinksBlock` как раньше (badge берётся из `position_label || custom_position_text`)
- При edit такого link — `positionCatalogId` будет пустым, picker покажет placeholder, пользователь выберет из каталога

## Файлы


| Файл                                                    | Действие                                          |
| ------------------------------------------------------- | ------------------------------------------------- |
| Миграция SQL                                            | Создать — seed ~230 должностей                    |
| `src/components/ai-requisites/PositionPicker.tsx`       | Создать — searchable combobox                     |
| `src/hooks/useEntityPersonLinks.ts`                     | Добавить `createPosition` mutation + нормализацию |
| `src/components/ai-requisites/EntityPersonLinkForm.tsx` | Заменить Select на PositionPicker                 |


## Что НЕ трогаем

- delete / reassign logic
- `/settings/legal-details`
- documents / generate-from-template
- billing / payment flow
- PATCH 6 persons module
- edge functions / webhooks
- GRP / адреса / formatter
- founder / other role types

## Технические детали

RLS для insert в `legal_details_positions_catalog`:

- Текущая политика `positions_catalog_admin_manage` разрешает ALL только admin/superadmin
- Нужно добавить политику INSERT для authenticated пользователей, или использовать edge function / RPC
- Рекомендация: добавить RLS policy `positions_catalog_insert_authenticated` для INSERT to authenticated — это справочник, добавление новой должности не представляет угрозы безопасности