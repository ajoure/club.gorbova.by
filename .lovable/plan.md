# да, согласен, с учетом правок:

1. В блоке **Belarus Address Formatter** не ограничивайся только кейсом `city === "Минск"`.  
Нужно нормализовать и поддержать варианты:
  - `Минск`
  - `г. Минск`
  - `город Минск`  
  И только после нормализации применять special-case: **без страны, без области, без района**.
2. Для Беларуси не хардкодить всегда `г.` перед населенным пунктом.  
Форматтер должен использовать тип населенного пункта, если он есть в structured data:
  - `г.`
  - `аг.`
  - `д.`
  - `п.`
  - `г.п.`  
  Для Минска — `г. Минск`; для других случаев — по фактическому типу населенного пункта.
3. В плане лучше уточнить, что formatter возвращает **одну готовую display-строку**, а UI уже сам переносит ее по ширине контейнера.  
Не делать отдельный “многострочный бизнес-формат” внутри formatter для Беларуси.  
То есть:
  - formatter → одна нормализованная строка
  - view-card → обычный wrap по ширине  
  Это даст аккуратный и предсказуемый результат.
4. Для адреса Беларуси добавь явные product-rules по сегментам:
  - индекс — в начале
  - населенный пункт
  - улица
  - дом
  - корпус
  - квартира/офис  
  При этом:
  - пустые сегменты пропускаются
  - район не показывается
  - страна не показывается
  - Минская область для Минска не показывается  
  Это нужно зафиксировать в плане не только примером, а как правило formatter.
5. Для **других стран СНГ** в этом PATCH не пытайся сразу вводить “правила СНГ”.  
Правильнее зафиксировать:
  - в этом патче вводится **product-standard для Беларуси**;
  - для остальных стран пока остается generic formatter;
  - отдельная нормализация по странам СНГ — future patch при наличии требований.  
  Иначе scope расползется.
6. В блоке **Unified EntityRecordSheet** добавь явный guard для edit-mode:
  - если запись billing/document уже открыта в `view`,
  - переключение в `edit` не должно терять `recordSheetEntity`,
  - после save нужно либо:
    - обновить текущую сущность в sheet и вернуть `mode="view"`,
    - либо закрыть sheet только по явному решению UX.  
    Это надо закрепить как предсказуемый post-save flow.
7. Для archive action в `view` mode добавь явный confirm-step в план.  
Сейчас в DoD написано “archivable via confirm”, это правильно, но стоит вынести в сам flow:
  - `В архив` → confirm dialog
  - только после подтверждения update `status='archived'`.
8. В DoD добавь явную проверку для address formatter:
  - `220018, г. Минск, ул. Одинцова, д. 19, кв. 306`
  - без `Беларусь`
  - без `Минская область`
  - без района  
  И второй пример:
  - не-Минск адрес Беларуси показывает область, но не страну и не район.
9. В блоке **FLD-ID and GRP — verification only** лучше переименовать секцию, чтобы было понятно:  
это не “ничего не делаем”, а:
  - код уже внедрен ранее,
  - в этом PATCH требуется **regression-proof verification**.  
  Иначе это звучит слишком пассивно.
10. В финальном DoD добавь:

- `view` и `edit` используют один и тот же shell;
- body-content может отличаться;
- shell не прыгает по ширине/overlay/header;
- create-mode использует тот же контейнерный shell-стандарт, даже если контент формы отличается.
- &nbsp;
- PATCH 5R++ fix — Unified Shell + Belarus Address Formatter

## Summary

Three changes: (1) merge EntityViewSheet + EntityEditorSheet into one `EntityRecordSheet` with view/edit/create modes sharing identical shell, (2) rewrite address formatter for Belarus product standard, (3) verify FLD-ID and GRP registry data.

## 1. Unified EntityRecordSheet

**Problem**: View and edit open in two separate sheets with different widths, headers, and styling.

**Solution**: Create `EntityRecordSheet.tsx` that replaces both. Single shell with internal `mode` state (`view | edit | create`).

```text
EntityRecordSheet
  ├─ Shell (always same): SheetContent w-full sm:max-w-[60vw] lg:max-w-3xl ...
  ├─ Header (always same): icon + title + subtitle + separator + action bar
  ├─ Body (switches by mode):
  │   ├─ mode="view" → sectioned Card blocks (current EntityViewSheet content)
  │   ├─ mode="edit" → OrganizationDetailsForm + duplicate check logic
  │   └─ mode="create" → OrganizationDetailsForm (empty) + duplicate check
  └─ Action bar adapts:
      ├─ view: [Редактировать] [В архив?]
      ├─ edit: [Отмена → back to view] (form has its own submit button)
      └─ create: (form has its own submit button)
```

**Key behaviors**:

- Click row in table → opens RecordSheet in `view` mode
- Click "Редактировать" → same sheet switches to `edit` mode (no close/reopen, no shell change)
- Click "Отмена" in edit → back to `view` mode
- "Добавить" button → opens RecordSheet in `create` mode
- `onOpenExisting` from duplicate flow → opens RecordSheet in `view` mode
- After save in edit → switches back to `view` with refreshed data
- After save in create → closes sheet

### Files


| File                                                 | Action                                        |
| ---------------------------------------------------- | --------------------------------------------- |
| `src/components/ai-requisites/EntityRecordSheet.tsx` | **create** — unified component                |
| `src/components/ai-requisites/EntityViewSheet.tsx`   | **delete** — merged into RecordSheet          |
| `src/components/ai-requisites/EntityEditorSheet.tsx` | **delete** — merged into RecordSheet          |
| `src/pages/AI.tsx`                                   | **simplify** — one sheet state instead of two |


### AI.tsx state simplification

Replace:

- `entitySheetOpen` + `entityViewOpen` (two booleans)
- `entitySheetMode` + `entitySheetTarget` + `entityViewTarget`

With:

- `recordSheetOpen: boolean`
- `recordSheetMode: "view" | "edit" | "create"`
- `recordSheetEntity: ClientLegalDetails | null`

`handleOpenEditSheet` no longer closes one sheet and opens another — it just calls `setRecordSheetMode("edit")`.

## 2. Belarus Address Formatter

**Problem**: Current formatter shows "Беларусь, Минская область, Фрунзенский район" for Minsk addresses.

**Solution**: Rewrite `formatStructuredAddressForView` with Belarus-specific rules.

**Rules for Belarus (`country_code === 'BY'` or `country === 'Беларусь'`)**:

- **Minsk** (city matches `Минск`):
  - Skip country, region, district
  - Format: `220018, г. Минск, ул. Одинцова, д. 19, кв. 306`
- **Other Belarus cities**:
  - Skip country, skip district
  - Show region as abbreviated: `Гродненская обл.`
  - Format: `231300, Гродненская обл., г. Лида, ул. ..., д. ...`
- **Non-Belarus**: keep current generic formatting

**Single-line output** for view-mode (one formatted string), with segments in order: postal_code, region (if not Minsk), city, street, house, building, apartment.

### File


| File                                         | Action                                   |
| -------------------------------------------- | ---------------------------------------- |
| `src/lib/address/formatStructuredAddress.ts` | **rewrite** — add Belarus-specific logic |


## 3. FLD-ID and GRP — verification only

Already implemented in previous patch. Verify:

- `FieldLabelWithId` copies `publicId` on click, no visual chip
- `StructuredAddressBlock` labels copy `publicId` on click
- GRP registry section shows in view mode as read-only
- GRP fields saved for both ЮЛ and ИП

No code changes expected here — just DoD confirmation.

## DoD

- Record opens in one sheet — view and edit share identical shell
- "Редактировать" switches mode inside same sheet, no second sheet
- Width/overlay/header/close button don't change between view↔edit
- Create mode uses same shell dimensions
- `onOpenExisting` from duplicate-flow opens view mode in same sheet
- Billing record: editable, not archivable
- Document record: archivable via confirm
- Minsk address: no "Беларусь", no "Минская область", no district
- Other Belarus: region shown, no country, no district
- FLD-ID visually hidden, `publicId` copied on label click
- GRP registry data saved and shown as read-only section
- Settings page not regressed