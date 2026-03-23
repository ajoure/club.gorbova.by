# да, согласен, с учетом правок:

1. PATCH 7 запускать **только после формального закрытия PATCH 6**:
  - ручной proof `probable duplicate`
  - ручной proof `keyboard select` адреса
  - cleanup тестовых записей  
  Без этого PATCH 7 не считать разрешённым к execute.
2. Из scope PATCH 7 **убрать inline create нового физлица внутри link-form**.  
В этом патче работать только со **существующими** физлицами через `PersonPicker`.  
Inline create вынести в отдельный следующий patch, чтобы не смешивать person CRUD и links CRUD.
3. В `useEntityPersonLinks.ts` зафиксировать joins и поля явно:
  - для `legal_details_roles_catalog` использовать `label`, не `name`
  - для `legal_details_positions_catalog` использовать `label`
  - не опираться на догадки по schema-полям.
4. В `PersonPicker` по умолчанию показывать **только активных** физлиц владельца, но в edit existing link корректно отображать уже выбранного person даже если он стал inactive. Иначе редактирование старых связей будет ломаться.
5. В `EntityPersonLinkForm` перед submit обязательно делать sanitization по `role_type`:
  - `founder` → очищать position/custom role поля
  - `position` → очищать `share_percent` и enforce XOR `position_catalog_id` / `custom_position_text`
  - `other` → очищать position/share fields и требовать `custom_role_text`  
  Нельзя полагаться только на DB CHECK constraints.
6. Удаление в PATCH 7 — это **только delete link**, не deactivate person и не archive entity. Это нужно явно зафиксировать в плане и proof.
7. В DoD добавить отдельные proof-кейсы:
  - founder + `share_percent`
  - position через `position_catalog_id`
  - position через `custom_position_text`
  - other через `custom_role_text`
  - duplicate link → человекочитаемая ошибка
  - delete link → блок в карточке физлица обновился read-only
  - existing inactive person in edit path не ломает форму
8. В `EntityRecordSheet` новый блок `Связанные лица` добавлять только в **view mode** и не менять shell/edit flow карточки юрлица.
9. `/settings/legal-details`, documents, generate-from-template, AI interview и PATCH 8+ явно оставить вне scope не только текстом, но и в финальном proof-отчёте отдельным разделом `Не затронуто`.
10. &nbsp;
11. PATCH 7 — Связи физлиц в карточке юрлица/ИП

## Что делаем

Добавляем полноценный модуль управления связями (links) внутри `EntityRecordSheet` (view mode): список, создание, редактирование, удаление связей между юрлицом/ИП и физлицами.

## Схема данных (уже существует)

```text
legal_details_entity_person_links
├── person_id → legal_details_persons
├── legal_details_id → client_legal_details
├── role_catalog_id → legal_details_roles_catalog (founder/position/other)
├── role_type (denormalized, validated by trigger)
├── position_catalog_id → legal_details_positions_catalog (только для position)
├── custom_position_text (XOR с position_catalog_id для position)
├── custom_role_text (обязательно для other)
├── share_percent (только для founder)
├── acts_on_basis, is_primary, notes, start_date, end_date
└── profile_id (owner, RLS)
```

Partial unique indexes и CHECK constraints из PATCH 2 уже защищают от дублей и семантических ошибок.

## Файлы

### Создать (4 файла)

**1. `src/hooks/useEntityPersonLinks.ts**`

- Загрузка links по `legal_details_id` с joins на `legal_details_persons`, `legal_details_roles_catalog`, `legal_details_positions_catalog`
- Загрузка catalogs (roles + positions) — отдельные queries
- Mutations: `createLink`, `updateLink`, `deleteLink`
- Query key: `['entity-person-links', legalDetailsId]`
- При ошибке insert/update — парсинг PostgreSQL unique violation → человекочитаемое сообщение

**2. `src/components/ai-requisites/EntityPersonLinksBlock.tsx**`

- Секция «Связанные лица» в view mode карточки юрлица
- Список карточек: ФИО, badge роли, доля (founder), должность (position), is_primary badge
- Кнопка «Добавить связь» → открывает dialog
- На каждой записи: edit / delete actions
- Empty state: «Нет связанных лиц»
- Props: `legalDetailsId`, `profileId`

**3. `src/components/ai-requisites/EntityPersonLinkForm.tsx**`

- Форма внутри Dialog/Sheet для создания/редактирования связи
- PersonPicker (combobox): поиск по ФИО среди активных физлиц владельца
- Select роли из `legal_details_roles_catalog`
- Conditional fields:
  - founder → `share_percent` (number input, optional)
  - position → select из `legal_details_positions_catalog` ИЛИ custom text (exclusive)
  - other → `custom_role_text` (обязательное текстовое поле)
- Optional: `acts_on_basis`, `is_primary`, `notes`
- Validation: person required, role required, role-specific fields validated
- Submit → `createLink` / `updateLink`

**4. `src/components/ai-requisites/PersonPicker.tsx**`

- Combobox для выбора физлица из существующих
- Reuse `useAiPersons` для получения списка
- Фильтрация по ФИО, личному номеру
- Показывает: ФИО + личный номер (если есть)
- Возвращает `person_id`

### Изменить (1 файл)

`**src/components/ai-requisites/EntityRecordSheet.tsx**`

- В `renderViewContent()` после секции «Служебная информация» (строка ~426) вставить `<EntityPersonLinksBlock>`
- Import нового компонента
- Передать `entity.id` и `profileId`

### Не трогать

- `PersonLinkedEntitiesBlock` — остаётся read-only, уже корректно работает
- `PersonRecordSheet` — без изменений
- `PersonFieldsForm` — без изменений
- `/settings/legal-details` — без изменений
- Billing/payment flow — без изменений
- Document generation — без изменений
- Edge functions — без изменений

## Логика ролей (enforcement)


| role_type | share_percent | position_catalog_id | custom_position_text | custom_role_text |
| --------- | ------------- | ------------------- | -------------------- | ---------------- |
| founder   | optional      | —                   | —                    | —                |
| position  | —             | XOR                 | XOR                  | —                |
| other     | —             | —                   | —                    | required         |


Форма динамически показывает/скрывает поля в зависимости от выбранной роли. При сабмите зануляет невалидные поля (CHECK constraints в БД не допустят иначе).

## Обработка ошибок дублей

Partial unique indexes в БД выбросят `23505` (unique_violation). Hook парсит `detail` из ошибки PostgreSQL и показывает toast:

- «Такая связь уже существует» — вместо сырого SQL-сообщения

## UX flow

1. Открыть карточку юрлица → view mode → секция «Связанные лица»
2. Нажать «Добавить связь» → Dialog
3. Выбрать физлицо из combobox
4. Выбрать роль → появляются conditional fields
5. Заполнить → Save → toast → список обновился
6. Edit: клик edit на записи → тот же Dialog с prefill
7. Delete: клик delete → confirm → toast → запись удалена

## Invalidation

- При create/update/delete link → invalidate `['entity-person-links', legalDetailsId]`
- Также invalidate `['person-linked-entities', personId]` чтобы в карточке физлица read-only блок обновился