# PATCH 5 — Entity CRUD в AI-разделе «Реквизиты»

## Что сделано

### Новые файлы

1. **`src/hooks/useAiEntities.ts`** — hook для загрузки и мутации entity-записей
   - profileId разрешается из `useAuth → profiles`
   - Записи разделены: `billingEntities`, `activeDocumentEntities`, `archivedDocumentEntities`
   - Мутации (create/update/archive) только для `purpose='document'`
   - Guard: archive и update проверяют `purpose === 'document'` перед запросом

2. **`src/components/ai-requisites/EntityListScreen.tsx`** — список карточек
   - Billing: read-only, badge «Платёжные», ссылка на `/settings/legal-details`, **без click-to-edit**
   - Active document: click → edit, кнопка «В архив»
   - Archived document: свёрнутый блок (Collapsible), только document-записи
   - Empty state с кнопкой «Добавить»

3. **`src/components/ai-requisites/EntityFormScreen.tsx`** — create/edit обёртка
   - `OrganizationDetailsForm` reused 1:1 (props полностью совместимы)
   - Anti-duplicate: mandatory check перед submit (валидный 9-значный УНП)
   - При edit: self-match игнорируется (не показывает duplicate warning на свою же запись)
   - `purpose='document'` hardcoded в `useAiEntities.createEntity`

### Изменённые файлы

4. **`src/hooks/useLegalDetails.tsx`** — добавлены поля `purpose` и `status` в интерфейс `ClientLegalDetails`
5. **`src/pages/AI.tsx`** — entities placeholder заменён на EntityListScreen/EntityFormScreen

## Proof-блок

- ✅ `useLegalDetails` — изменение минимальное (2 поля в интерфейсе), логика не тронута
- ✅ `OrganizationDetailsForm` — reused as-is, без adapter layer (props контракт совместим: `initialData`, `onSubmit`, `isSubmitting`, `showDemoOnEmpty`)
- ✅ Billing-карточки — read-only визуально И поведенчески (нет onClick → edit)
- ✅ Archive — применяется только к `purpose='document'` (guard в hook + guard в query)
- ✅ Create — всегда `purpose='document'`, пользователь не может переключить
- ✅ Anti-duplicate — mandatory before submit, optional precheck не реализован (blur не дёргает check)
- ✅ GRP lookup/confirm/autofill — встроен в OrganizationDetailsForm, работает as-is

## Не изменялось

- `useLegalDetails` мутации (createDetails, updateDetails, deleteDetails, setDefault)
- `OrganizationDetailsForm` (import as-is)
- `GrpConfirmDialog`
- Edge functions
- Billing flow
- setDefault logic
