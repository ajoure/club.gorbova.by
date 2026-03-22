# да, согласен, с учетом правок:

1. В задаче 2 зафиксируй однозначно: по клику на label копируется `public_id` **поля (**`FLD-...`**)**, а не `tokenString`/`{{cf...}}`. Визуально FLD-ID не показывается, но копируется именно ID поля.
2. В задаче 2 отдельно укажи, что патч делается **только для FLD-контекста**:
  - `FieldLabelWithId`
  - inline FLD у УНП
  - FLD в `StructuredAddressBlock`  
  `CopyableIdChip` для PRD-/T-/прочих не-FLD сущностей не трогаем.
3. В задаче 4 добавь явный add-only guard для новых `grp_*` колонок:
  - без изменения существующих колонок и логики,
  - без backfill в этом патче,
  - новые поля nullable,
  - существующие записи остаются валидными без миграции данных.
4. В задаче 5 зафиксируй, что сохранение `grp_*` полей должно происходить **и для ЮЛ, и для ИП** через существующий `handleGrpConfirm`, без расхождения flow.
5. В задаче 5 уточни: секция **«Данные реестра»** в `EntityViewSheet` должна быть **read-only**, а в edit-mode эти поля показываются как read-only info/summary, не как ручные editable inputs.
6. Для address formatter закрепи reusable-назначение:
  - сначала для `EntityViewSheet`,
  - затем тот же helper переиспользуется в PATCH 6 для физлиц,
  - адрес не собирать строкой прямо в JSX.
7. В совокупный DoD добавь отдельные проверки:
  - `onOpenExisting` из duplicate-flow по-прежнему открывает **view-sheet**;
  - billing-record в view-sheet редактируется, но не архивируется;
  - document-record архивируется только через confirm-flow;
  - settings page визуально/функционально не регресснул после сохранения новых `grp_*` полей.
8. В порядок реализации добавь явный checkpoint после задачи 4:
  - сначала proof applied schema по `grp_*` колонкам,
  - только потом UI-патч на сохранение и показ этих полей.
9. В плане лучше явно переименовать задачу 2 в **отдельный cross-platform UI PATCH**, чтобы не потерять, что это не локальная правка только для реквизитов, а единый стандарт по всей платформе.
10. &nbsp;
11. PATCH 5R++ — Сводный план: 6 задач

## Задача 1: Verify view-edit flow (no code changes)

Подтвердить что `EntityViewSheet` → кнопка «Редактировать» → `EntityEditorSheet` → сохранение работает корректно. Никаких файлов не меняем.

---

## Задача 2: Cross-Platform UI PATCH — скрытие FLD-ID, copy-by-label

**Scope**: только FLD-контекст. `CopyableIdChip` для PRD-/T-/прочих сущностей не трогаем.

**Что копируется**: по клику на label копируется `publicId` (FLD-000042), а НЕ `tokenString` ({{cf.legal_details.FLD-000042}}).

### Затрагиваемые файлы


| Файл                                                       | Что меняем                                                                                                                                                            |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/legal-details/FieldLabelWithId.tsx`        | Убрать `CopyableIdChip`, сделать label кликабельным: `onClick → copyToClipboard(fieldEntry.publicId, "ID скопирован")`, добавить `cursor-pointer`, `title` с publicId |
| `src/components/legal-details/OrganizationDetailsForm.tsx` | Строки 400-408: убрать inline `CopyableIdChip` для УНП, сделать FormLabel кликабельным по тому же паттерну                                                            |
| `src/components/shared/StructuredAddressBlock.tsx`         | Строки 293-297: убрать `CopyableIdChip` из address labels, сделать Label кликабельным                                                                                 |


### Новый паттерн FieldLabelWithId

```tsx
export function FieldLabelWithId({ label, fieldEntry, required, children }) {
  const handleCopy = fieldEntry?.publicId
    ? (e) => { e.preventDefault(); copyToClipboard(fieldEntry.publicId, "ID скопирован"); }
    : undefined;

  return (
    <FormLabel
      className={cn("flex items-center gap-1.5 flex-wrap", handleCopy && "cursor-pointer hover:text-primary")}
      onClick={handleCopy}
      title={fieldEntry?.publicId ? `${fieldEntry.publicId} — клик для копирования` : undefined}
    >
      <span>{label}{required ? " *" : ""}</span>
      {children}
    </FormLabel>
  );
}
```

---

## Задача 3: Аудит полноты данных из API МНС/ГРП (уже выполнен)

Данные проходят через `GrpAutofillService` → `GrpConfirmDialog` → `handleGrpConfirm`. Поля `registration_date`, `tax_office_code/name`, `status_code/name`, `short_name`, `liquidation_date/reason` доступны в типах, но **не сохраняются в БД** — нет колонок.

---

## Задача 4: Schema PATCH — добавить grp_* колонки

**Guard**: add-only, без изменения существующих колонок, без backfill, все nullable, существующие записи валидны без миграции данных.

```sql
ALTER TABLE client_legal_details
  ADD COLUMN IF NOT EXISTS grp_registration_date text,
  ADD COLUMN IF NOT EXISTS grp_tax_office_code text,
  ADD COLUMN IF NOT EXISTS grp_tax_office_name text,
  ADD COLUMN IF NOT EXISTS grp_status_code text,
  ADD COLUMN IF NOT EXISTS grp_status_name text,
  ADD COLUMN IF NOT EXISTS grp_short_name text,
  ADD COLUMN IF NOT EXISTS grp_liquidation_date text,
  ADD COLUMN IF NOT EXISTS grp_liquidation_reason text,
  ADD COLUMN IF NOT EXISTS grp_last_fetched_at timestamptz;
```

**Checkpoint**: после применения миграции — proof что колонки существуют, прежде чем переходить к задаче 5.

---

## Задача 5: UI PATCH — сохранение GRP-полей + address formatter + секция «Данные реестра»

### Сохранение grp_* полей

В `OrganizationDetailsForm.tsx` → `handleGrpConfirm`: добавить в submit data маппинг GRP-полей в `grp_*` колонки. Работает одинаково и для ЮЛ, и для ИП — через единый `handleGrpConfirm`.

### Address formatter (reusable)

Создать `src/lib/address/formatStructuredAddress.ts`:

```typescript
export function formatStructuredAddressForView(
  structured: CanonicalAddressPayload | null,
  fallback?: string | null
): string[] {
  // Returns array of lines, skipping empty segments
  // Reusable: EntityViewSheet сейчас, PersonViewSheet в PATCH 6
}
```

### Секция «Данные реестра» в EntityViewSheet

- Read-only Card block, показывается только если хотя бы одно `grp_*` поле заполнено
- Поля: дата регистрации, статус, ИМНС, краткое название, ликвидация (если есть), дата обновления
- В edit-mode (EntityEditorSheet): эти поля показываются как read-only info/summary, не как editable inputs

### Адрес в EntityViewSheet

Заменить текущий `<InfoRow label="Юридический адрес" value={address} />` на многострочный вывод через `formatStructuredAddressForView`.

### Файлы


| Файл                                                       | Действие                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `src/lib/address/formatStructuredAddress.ts`               | **создать** — reusable formatter                                    |
| `src/components/legal-details/OrganizationDetailsForm.tsx` | **изменить** — в handleGrpConfirm сохранять grp_* поля              |
| `src/components/ai-requisites/EntityViewSheet.tsx`         | **изменить** — добавить секцию «Данные реестра» + address formatter |


---

## Задача 6: Проверка и закрытие

### Совокупный DoD

- Клик по label копирует `publicId` (FLD-...), визуально FLD-ID нигде не показывается (для FLD-контекста)
- `CopyableIdChip` для PRD-/T- не затронут
- Адрес в view-mode читаемый, многострочный (через reusable formatter)
- 9 колонок `grp_*` добавлены в БД (add-only, nullable, без backfill)
- GRP-поля сохраняются и для ЮЛ, и для ИП через единый handleGrpConfirm
- Секция «Данные реестра» read-only в view и в edit
- `onOpenExisting` из duplicate-flow открывает view-sheet
- Billing-record в view-sheet редактируется, но не архивируется
- Document-record архивируется только через confirm-flow
- Settings page визуально/функционально не регресснула после grp_* полей
- Текущий GRP lookup/autofill/confirm flow не сломан

### Порядок реализации

1. Задача 1 — verify view-edit flow
2. Задача 2 — cross-platform FLD-ID hide + copy-by-label
3. Задача 3 — audit (done)
4. Задача 4 — DB migration → **checkpoint: proof schema applied**
5. Задача 5 — save GRP fields + address formatter + view card section
6. Задача 6 — verification

После закрытия всех 6 задач → PATCH 6 (физлица) на готовом стандарте shell + labels + address formatting.