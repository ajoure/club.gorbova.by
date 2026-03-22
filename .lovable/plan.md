# да, согласен, с учетом правок:

1. `getEntityShortName(entity)` для ЮЛ нельзя делать просто `return leg_name`. Нужно явно убирать оргформу из начала названия, если она уже входит в `leg_name`, с fallback на исходное значение. Иначе в таблице снова будут длинные юридические названия вместо короткого имени.
2. В `EntityEditorSheet` duplicate-check для edit-сценария должен исключать текущую запись:
  - либо через `excludeEntityId`,
  - либо через проверку “все найденные кандидаты = текущая запись”.  
  Иначе редактирование существующей записи будет ложно блокироваться как дубль.
3. В `useAiEntities.updateEntity` можно снять guard `purpose === 'document'`, но нужно оставить guard по владельцу и явно запретить из AI-формы менять служебные поля:
  - `purpose`
  - `status`
  - `is_default`  
  если это не является отдельным утвержденным действием. Иначе AI-экран сможет случайно ломать billing-семантику.
4. `archiveEntity` должен оставаться строго:
  - только для `purpose = 'document'`
  - только для записей владельца  
  и это нужно явно закрепить в query и в DoD.
5. Удаление `EntityListScreen.tsx` и `EntityFormScreen.tsx` оформить с add-only mapping:
  - `EntityListScreen` → `EntityTableView`
  - `EntityFormScreen` → `EntityEditorSheet`  
  И отдельно подтвердить, что функциональность 1:1 не потеряна, ссылки/импорты обновлены, build чистый. Без этого удаление файлов выглядит как потеря уже сделанного PATCH 5.
6. В DoD добавить явную проверку:
  - billing-запись открывается и редактируется в AI,
  - но archive для нее недоступен,
  - settings page при этом не тронута и продолжает работать как раньше.
  - &nbsp;
  - PATCH 5R — Рефакторинг «Юрлица / ИП» в AI-разделе

## Что меняем

Заменяем текущий `EntityListScreen` (2-колоночные карточки, ссылка «в настройки») на табличный список на всю ширину с фильтрами, а `EntityFormScreen` переделываем на drawer/sheet для редактирования прямо в AI.

## Решение зафиксировано

- **Billing-записи редактируются в AI** — ссылка «Редактировать в настройках» убирается
- `useAiEntities` расширяется: `updateEntity` снимает guard `purpose === 'document'`, чтобы billing тоже можно было редактировать
- Archive остается только для `purpose === 'document'`

## Файлы


| Файл                                                 | Действие                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/lib/legal-entities/entityDisplayUtils.ts`       | **создать** — `getEntityShortName(entity)` без оргформы, `getEntityTypeBadge(entity)`         |
| `src/components/ai-requisites/EntityTableView.tsx`   | **создать** — табличный список с поиском и фильтрами                                          |
| `src/components/ai-requisites/EntityEditorSheet.tsx` | **создать** — Sheet (side panel) с формой внутри                                              |
| `src/components/ai-requisites/EntityFormScreen.tsx`  | **удалить** — заменён на EntityEditorSheet                                                    |
| `src/components/ai-requisites/EntityListScreen.tsx`  | **удалить** — заменён на EntityTableView                                                      |
| `src/hooks/useAiEntities.ts`                         | **изменить** — снять guard на purpose для update; добавить возврат allEntities для фильтрации |
| `src/pages/AI.tsx`                                   | **изменить** — заменить entity flow на EntityTableView + EntityEditorSheet                    |


## Архитектура

```text
AI.tsx (activeSubTab === 'entities')
  └─ <EntityTableView>
       ├─ search input + filter pills (все / ЮЛ / ИП / активные / архив)
       ├─ table rows: shortName | badge (ЮЛ/ИП) | УНП | status | actions
       ├─ onClick row → open <EntityEditorSheet>
       └─ «Добавить» button → open <EntityEditorSheet mode="create">

<EntityEditorSheet>  (Sheet from shadcn, side="right", size ~lg)
  ├─ PayerTypeSelector (create only, org types only)
  ├─ OrganizationDetailsForm (reuse 1:1)
  ├─ useEntityDuplicateCheck (mandatory before submit)
  └─ DuplicateWarningDialog (on match → onOpenExisting closes create, opens found record)
```

## Display name logic (`entityDisplayUtils.ts`)

```typescript
/** Short name without org form — for list display */
export function getEntityShortName(entity: ClientLegalDetails): string {
  if (entity.client_type === "entrepreneur") {
    return entity.ent_name || "ИП без названия";
  }
  // For legal_entity: return leg_name only (without leg_org_form)
  return entity.leg_name || "Организация без названия";
}

export function getEntityTypeBadge(entity: ClientLegalDetails): string {
  return entity.client_type === "entrepreneur" ? "ИП" : "ЮЛ";
}
```

## EntityTableView

- Полная ширина, не карточки
- Поиск: фильтрует по `getEntityShortName` (case-insensitive)
- Filter pills: Все | ЮЛ | ИП | Активные | Архив
- Столбцы: Название | Тип (badge) | УНП | Статус | Действия (Открыть, Архивировать)
- Архивировать показывается только для `purpose === 'document'` и `status === 'active'`
- Billing записи — без кнопки архивирования, но с возможностью открыть для редактирования

## EntityEditorSheet

- Использует `Sheet` из shadcn (side="right")
- Props: `open`, `onOpenChange`, `mode: 'create' | 'edit'`, `entity?`, `profileId`, `onSubmit`, `isSubmitting`
- Внутри: `OrganizationDetailsForm` (reuse 1:1, тот же props contract: `initialData`, `onSubmit`, `isSubmitting`, `showDemoOnEmpty`)
- Anti-duplicate: `useEntityDuplicateCheck.checkDuplicate(unp, profileId)` mandatory before submit
- `onOpenExisting(id)`: закрывает sheet, находит entity по id в allEntities, открывает его в edit mode

## useAiEntities изменения

- `updateEntity`: убрать guard `purpose !== 'document'` — разрешить редактирование billing
- Добавить `allEntities` в return для фильтрации в таблице
- `archiveEntity`: guard `purpose === 'document'` остаётся

## AI.tsx изменения

- Убрать `entityMode` state machine (list/create/edit)
- Добавить `entitySheetOpen`, `entitySheetMode`, `entitySheetTarget` state
- Заменить блок entities на `<EntityTableView>` + `<EntityEditorSheet>`

## DoD

- Нет ссылки «Редактировать в настройках»
- Единый табличный список на всю ширину
- Название без формы собственности
- Badge только ЮЛ / ИП
- Поиск и фильтры работают
- Редактирование в Sheet прямо в AI (billing и document)
- Archive только для document
- Anti-duplicate из PATCH 3 встроен
- `onOpenExisting` реально открывает найденную запись
- `OrganizationDetailsForm` reused 1:1
- `useLegalDetails` не изменён
- Settings page не тронута