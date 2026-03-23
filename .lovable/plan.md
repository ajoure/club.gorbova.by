# да, согласен, с учетом правок:

1. **Hard delete** принимать только как справочниковое удаление.  
В proof обязательно отдельно показать, что delete затрагивает только:
  - `legal_details_persons` / `client_legal_details`
  - `legal_details_entity_person_links`  
  и **не затрагивает** таблицы документов / historical outputs / snapshots.
2. Для `deletePerson` и `deleteEntity` после успешного удаления обязательно:
  - закрыть открытый sheet, если удаляется текущая открытая запись
  - очистить selected id / target state в `AI.tsx`
  - обновить список без ручного refresh
3. Для `deletePerson` invalidation расширить:
  - `['ai-persons']`
  - `['entity-person-links', ...]` по открытому entity, если релевантно
  - `['person-linked-entities', personId]`
  - при необходимости entity card/query, если удаление произошло из открытого связанного контекста
4. Для `deleteEntity` invalidation расширить:
  - `['ai-entities']`
  - `['entity-person-links', entityId]`
  - `['person-linked-entities', personId]` для связанных лиц, если links удаляются каскадно  
  То есть после delete document-entity read-only блоки у физлиц тоже должны обновиться.
5. В `EntityRecordSheet` кнопку **«удалить навсегда»** показывать:
  - только для `purpose='document'`
  - только в **view mode**
  - для billing entity явно не показывать вообще
6. В `EntityTableView.tsx` и `PersonsTableView.tsx` не вводить новый context menu, если его там сейчас нет.  
Лучше:
  - либо row action button/menu в уже существующем стиле
  - либо оставить удаление только из карточки записи  
  Не раздувать UI лишним новым паттерном без необходимости.
7. Для **reassign link** добавить ещё один guard:
  - если `editingLink` и person не менялся, confirm не показывать
  - если person поменялся, confirm показывать один раз перед submit
  - текущий inactive person в edit path должен оставаться видимым в picker
8. По **positions UX** согласен:  
searchable dropdown + `custom_position_text` оставить как есть, **без автосохранения в каталог**.
9. В proof по PATCH 7.1/7.2 обязательно показать отдельно:
  - reassign link в UI
  - delete person
  - delete entity(document)
  - billing protected
  - documents/history not touched
  - cleanup выполнен
10. Процессно: в финальном отчёте всё ещё держать разделение:

- `PATCH 7.1/7.2 proof`
- `Cleanup выполнен`
- `Не затронуто`
- и отметить, что PATCH 7 остаётся связан с формальным закрытием PATCH 6.
- &nbsp;
- PATCH 7.1/7.2 — Delete + Reassign + Positions UX

## Scope

Три направления в одном патче:

1. **Hard delete** для физлиц и document-entity (с guard-проверками)
2. **Reassign link** — разблокировка PersonPicker в edit mode
3. **Positions UX** — без авто-сохранения в каталог, только searchable dropdown + custom text (уже работает)

---

## 1. Hard Delete

### 1a. Физлица — `useAiPersons.ts`

Добавить mutation `deletePerson`:

- Сначала `DELETE FROM legal_details_entity_person_links WHERE person_id = ?`
- Затем `DELETE FROM legal_details_persons WHERE id = ?`
- Invalidate: `ai-persons`, `entity-person-links`
- Toast: «Физлицо удалено навсегда»

### 1b. Entity (document) — `useAiEntities.ts`

Добавить mutation `deleteEntity`:

- Guard: `purpose !== 'document'` → throw «Можно удалить только документные реквизиты»
- Сначала `DELETE FROM legal_details_entity_person_links WHERE legal_details_id = ?`
- Затем `DELETE FROM client_legal_details WHERE id = ? AND purpose = 'document'`
- Invalidate: `ai-entities`, `entity-person-links`
- Toast: «Реквизиты удалены навсегда»
- billing записи → только archive/edit, delete заблокирован

### 1c. UI — `PersonRecordSheet.tsx`

В view mode добавить badge «удалить навсегда» (красный, с иконкой Trash2) рядом с «деактивировать»:

- AlertDialog с предупреждением: «Запись будет удалена навсегда вместе со всеми связями. Уже созданные документы не изменятся.»
- Кнопка «Удалить навсегда»

### 1d. UI — `EntityRecordSheet.tsx`

В view mode для document-purpose записей добавить badge «удалить навсегда» рядом с «в архив»:

- AlertDialog с аналогичным предупреждением
- Для billing записей badge не показывается (только archive)

### 1e. UI — `EntityTableView.tsx`

В контекстном меню строки добавить пункт «Удалить навсегда» для document-purpose записей.

### 1f. UI — `PersonsTableView.tsx`

Проверить, есть ли контекстное действие — если да, добавить «Удалить навсегда».

---

## 2. Reassign Link

### 2a. `EntityPersonLinkForm.tsx` (строка 145)

Убрать `disabled={!!editingLink}` с PersonPicker. Picker всегда активен.

### 2b. Confirm при смене person

В `handleSubmit` (строка 99): если `editingLink` и `personId !== editingLink.person_id`:

- Показать confirm dialog: «Вы хотите перевесить связь с «{старое ФИО}» на «{новое ФИО}»?»
- Только после подтверждения отправлять update

### 2c. Invalidation (уже готово)

FIX-1 уже реализовал dual invalidation в `useEntityPersonLinks.ts` для old/new person_id.

---

## 3. Positions UX

Текущая реализация уже соответствует требованиям:

- Searchable dropdown из справочника `legal_details_positions_catalog`
- Custom text через `custom_position_text` если справочник не выбран
- Авто-сохранение в каталог **не делаем** — используется `custom_position_text`

Без изменений.

---

## Файлы для изменения


| Файл                                                    | Что меняется                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| `src/hooks/useAiPersons.ts`                             | Добавить `deletePerson` mutation                                      |
| `src/hooks/useAiEntities.ts`                            | Добавить `deleteEntity` mutation (guard: document only)               |
| `src/components/ai-requisites/PersonRecordSheet.tsx`    | Badge «удалить навсегда» + AlertDialog                                |
| `src/components/ai-requisites/EntityRecordSheet.tsx`    | Badge «удалить навсегда» для document + AlertDialog + prop `onDelete` |
| `src/components/ai-requisites/EntityTableView.tsx`      | Пункт «Удалить» в контексте для document                              |
| `src/components/ai-requisites/EntityPersonLinkForm.tsx` | Убрать `disabled` с PersonPicker + confirm при смене person           |
| `src/pages/AI.tsx`                                      | Прокинуть `onDelete` / `deletePerson` / `deleteEntity`                |


## Что НЕ трогаем

- `/settings/legal-details` — без изменений
- documents / generate-from-template — без изменений
- billing/payment flow — без изменений (billing entity защищена от delete)
- PATCH 6 persons module — без изменений
- edge functions / webhooks — без изменений
- Уже созданные документы и snapshots — не затрагиваются

## Принцип удаления

Справочниковое, не историческое:

- Удаление записи из реквизитов не ломает уже созданные документы
- Если документы хранят snapshot данных — он остаётся как есть
- Guard-проверки выполняются до delete (сначала links, потом сама запись)