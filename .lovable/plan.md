## да, согласен, с учетом правок:

1. PATCH 6 не запускать в execute до формального закрытия незавершённого hotfix по address mouse-path в `/ai`. План PATCH 6 можно готовить, но implementation gate обязателен: сначала доказуемо закрыть общий address interaction bug в AI-shell, потом выполнять PATCH 6.
2. В PATCH 6 для физлиц не использовать термин `archive`. Для `legal_details_persons` фиксируем только модель `is_active`:
  - active / inactive
  - `deactivatePerson` = `is_active=false`
  - optional restore = `is_active=true`
  - без архивных секций, без `status`, без смешения с логикой юрлиц.
3. `PersonLinkedEntitiesBlock` делать строго tolerant/read-only:
  - если связей ещё нет — показывать пустое состояние без ошибок
  - если role join недоступен/нестабилен — сначала показывать только компанию + badge типа, а роль добавлять только при доказуемо корректном join
  - никакого редактирования, никаких CTA на создание связи.
4. В `PersonRecordSheet` shell делать 1:1 по уже принятому паттерну record sheet, но не копировать заново address-fix логику по месту. Все address interaction fixes должны оставаться в shared-layer. В sheet только минимально необходимый guard для portal dropdown, без новой отдельной ветки address behavior.
5. `StructuredAddressBlock` параметризовать add-only:
  - `apartmentLabel?: string`
  - при необходимости отдельно `apartmentPrefix?: string`
  - default для текущих consumers сохранить без изменений (`Помещение` / `пом.`)
  - для физлиц передавать явно `Квартира` / `кв.`
  - не менять существующий contract так, чтобы ломались текущие формы.
6. `formatStructuredAddressForView` менять только add-only параметром prefix. Беларусь-правила Минска/области/района не пересматривать в PATCH 6 и не смешивать с person-логикой.
7. `PersonFieldsForm` делать как новый самостоятельный form-component, а не как копию `IndividualDetailsForm`. Разрешён только controlled reuse мелких shared blocks/validators, но без перетаскивания billing-специфики и без скрытых зависимостей на `client_legal_details`.
8. В `useAiPersons` state и мутации должны быть полностью отделены от entity module:
  - отдельный query key
  - отдельные toasts
  - отдельные loading flags
  - не использовать `useLegalDetails`
  - не использовать `purpose/status`
9. Поиск в `PersonsTableView` дополнить нормализацией:
  - trim
  - case-insensitive
  - для телефона — поиск по цифрам без пробелов/символов
  - для паспорта — по номеру и по серии+номеру.
10. В anti-duplicate proof для edit mode обязательно отдельно показать, что текущая запись не ловится как дубль самой себя:
  - `excludePersonId` реально передан
  - edit save проходит без ложного exact/probable match.
11. В view карточке физлица секции зафиксировать так:
  - Основная информация
  - Паспортные данные
  - Адрес
  - Контакты
  - Служебная информация
  - Связанные компании  
  Никаких банковских реквизитов и никаких billing-блоков.
12. В DoD добавить обязательный proof, что после save у физлица корректны обе вещи:
  - `address_structured`
  - человекочитаемый preview/view с `кв.`  
  и отдельно proof, что юрлица в том же `/ai` продолжают показывать `пом.`.
13. В DoD добавить regression-check по entity module:
  - `EntityRecordSheet` не сломан
  - `Persons` и `Entities` не мешают друг другу по state в `AI.tsx`
  - переключение между подвкладками не сбрасывает данные некорректно.
14. Финальный отчёт по PATCH 6 обязателен с proof не только по create/edit/view, но и по empty state, inactive state и linked entities read-only state.
15. &nbsp;
16. PATCH 6 — Физлица в AI-разделе «Реквизиты»

### Scope summary

Add full persons module to `/ai` → Реквизиты → Физлица: list, view, create, edit, anti-duplicate, address (with "Квартира/кв." for persons), read-only linked entities.

### Files to create

**1. `src/hooks/useAiPersons.ts**`

- Pattern: mirror `useAiEntities.ts` structure
- `profileId` from `useAuth` → `profiles`
- Query `legal_details_persons` where `profile_id = profileId`, order by `is_active desc, full_name asc`
- Mutations: `createPerson`, `updatePerson`, `deactivatePerson` (set `is_active=false`)
- Query key: `["ai-persons", profileId]`
- Return: `{ profileId, allPersons, isLoading, createPerson, updatePerson, deactivatePerson, isCreating, isUpdating, isDeactivating }`

**2. `src/lib/persons/personDisplayUtils.ts**`

- `getPersonDisplayName(person)` → `full_name` or "Без имени"
- `getPersonDocumentSummary(person)` → personal_number or passport series+number or "—"
- `getPersonAddressLines(person)` → reuse `formatStructuredAddressForView` with new `apartmentPrefix: 'кв.'` param

**3. `src/components/ai-requisites/PersonsTableView.tsx**`

- Pattern: mirror `EntityTableView.tsx`
- Columns: ФИО, Документ/личный номер, Телефон, Email, Статус, Действия
- Filters: Все / Активные / Неактивные
- Search: full_name, personal_number, passport_number, email, phone
- Sort: active first, then alphabetical by full_name
- Button: "Добавить"
- Row click → open PersonRecordSheet in view mode

**4. `src/components/ai-requisites/PersonFieldsForm.tsx**`

- Standalone form for person fields only (no billing, no leg_/ent_ fields)
- Fields: full_name, birth_date, personal_number, passport_series, passport_number, passport_issued_by, passport_issued_date, passport_valid_until, phone, email, address (StructuredAddressBlock with `apartmentLabel="Квартира"`), notes, is_active
- `onSubmit` callback, `initialData`, `isSubmitting` props
- Address block uses new `apartmentLabel` prop

**5. `src/components/ai-requisites/PersonRecordSheet.tsx**`

- Pattern: mirror `EntityRecordSheet.tsx` shell exactly (same width, overlay, header layout, scrollable body, card blocks)
- Modes: view | edit | create
- Same `onPointerDownOutside`/`onInteractOutside` guards as EntityRecordSheet (for address dropdown)
- Same `data-address-shell` + `data-address-portal-root` pattern
- View mode sections: Основная информация, Паспортные данные, Адрес, Контакты, Служебная информация, Связанные компании (PersonLinkedEntitiesBlock)
- Edit/create: renders PersonFieldsForm
- Anti-duplicate: call `usePersonDuplicateCheck.checkDuplicate()` before submit, show `DuplicateWarningDialog` with `type="person"`
- In edit mode: pass `excludePersonId` to avoid self-match

**6. `src/components/ai-requisites/PersonLinkedEntitiesBlock.tsx**`

- Query `legal_details_entity_person_links` where `person_id = personId`, join with `client_legal_details` (via `legal_details_id`) to get entity short name + type
- Join with `legal_details_roles_catalog` (via `role_catalog_id`) to get role name
- Display: list of cards/rows with entity short name, ЮЛ/ИП badge, role name
- Strictly read-only, no add/edit/remove buttons

### Files to modify

**7. `src/components/shared/StructuredAddressBlock.tsx**`

- Add `apartmentLabel?: string` to `StructuredAddressBlockProps`
- In `FULL_LAYOUT` usage, override apartment field label when `apartmentLabel` is provided
- Default remains "Помещение" (no change to existing consumers)

**8. `src/lib/address/formatStructuredAddress.ts**`

- Add optional `apartmentPrefix` param to `formatStructuredAddressForView` (default `'пом.'`)
- Pass through to `formatBelarusAddress` and `formatGenericAddress`
- Person consumers pass `'кв.'`

**9. `src/pages/AI.tsx**`

- Import `PersonsTableView`, `PersonRecordSheet`, `useAiPersons`
- Add state: `personSheetOpen`, `personSheetMode`, `personSheetPersonId`
- Derive `personSheetPerson` via `useMemo` from `allPersons`
- Add handlers: `handleOpenCreatePersonSheet`, `handleOpenViewPersonSheet`, `handleOpenExistingPerson`
- Replace persons stub (lines 641-655) with `PersonsTableView` + `PersonRecordSheet`

### What is NOT touched

- `/settings/legal-details`, `useLegalDetails`, billing flow
- `client_legal_details` table/schema
- Entity module (EntityRecordSheet, EntityTableView, useAiEntities)
- Formatter Minsk/region/district rules
- GRP lookup, document generation, executors
- Link editing (read-only only in PATCH 6)

### Execution order

1. Create `useAiPersons.ts` + `personDisplayUtils.ts` (data layer)
2. Create `PersonFieldsForm.tsx` (form component)
3. Modify `StructuredAddressBlock.tsx` — add `apartmentLabel` prop
4. Modify `formatStructuredAddress.ts` — add `apartmentPrefix` param
5. Create `PersonLinkedEntitiesBlock.tsx` (read-only linked entities)
6. Create `PersonsTableView.tsx` (list view)
7. Create `PersonRecordSheet.tsx` (unified shell)
8. Modify `AI.tsx` — wire everything together

### DoD

1. `/ai` → Физлица: list visible, search works, filters work, row click opens sheet
2. Create: form opens, fields save, anti-duplicate exact blocks, probable warns, record appears in list
3. Edit: view→edit in same shell, save updates, no second sheet
4. Address: mouse + keyboard select work, saves to `address_structured`, view shows "кв." for persons
5. ЮЛ/ИП address not regressed (still shows "пом.")
6. Read-only linked entities block displays in person card
7. `/settings/legal-details` not affected
8. Entity module in `/ai` not broken
9. PATCH 7 not started