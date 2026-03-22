# да, согласен, с учетом правок:

1. В формулировке DoD и scope убери слово **CRUD** для document-записей, если фактически реализуется **create/read/edit/archive**, а не delete.  
Иначе это будет расхождение между планом и реализацией.  
Лучше везде писать:
  - **полный рабочий цикл: create / read / edit / archive**
  - delete в PATCH 5 не делать.
2. `OrganizationDetailsForm` нельзя считать совместимой “по умолчанию” без proof по props-контракту.  
В плане нужно явно зафиксировать:
  - какие props у нее уже есть,
  - что именно переиспользуется 1:1,
  - нужна ли тонкая adapter-обертка в `EntityFormScreen`.  
  Если прямой контракт не совпадает, не править саму форму без крайней необходимости — лучше добавить adapter layer.
3. `useAiEntities` должен явно описывать, **откуда берется** `profileId`:
  - из текущего пользователя через `profiles`,
  - или из уже существующего profile context/hook, если он есть.  
  Нельзя оставлять это неявным, потому что все запросы и мутации завязаны на `profile_id`.
4. В `EntityListScreen` archived block должен показывать **только archived document-записи**, а не любые `status='archived'` без учета `purpose`.  
Иначе можно случайно смешать billing/archive сценарии.  
Зафиксируй явно:
  - `billingEntities`
  - `activeDocumentEntities`
  - `archivedDocumentEntities`
5. Для billing-карточек, кроме badge и ссылки, лучше явно указать:
  - **без кнопки открытия в edit-mode AI-раздела**
  - click по карточке не должен вести в `EntityFormScreen`  
  Это надо закрепить прямо в плане, чтобы read-only был не только визуальным, но и поведенческим.
6. Anti-duplicate по УНП лучше не запускать “просто по blur” без guard-условий.  
Зафиксируй:
  - запускать только если УНП валиден после нормализации,
  - не дергать duplicate check на пустом/невалидном значении,
  - финальная блокировка все равно должна быть перед submit.  
  То есть:
  - optional precheck on blur
  - mandatory check before create/update.
7. В create flow нужно явно запретить создание billing-record из AI-раздела.  
Зафиксируй:
  - из `EntityFormScreen` новая запись всегда создается как document-entity,
  - пользователь не может переключить это в UI.
8. Для edit flow document-записи нужно явно описать, какие поля разрешено менять, а какие нет, если запись уже создана из GRP lookup.  
Особенно важно не потерять логику:
  - refresh из API,
  - confirm/update flow через existing GRP components.  
  Иначе можно случайно обойти reuse-сценарий.
9. В `useAiEntities` архивирование должно делать update не только `status='archived'`, но и иметь guard:
  - только для `purpose='document'`
  - только для записей владельца  
  Даже если RLS защитит, это лучше зафиксировать и на уровне query intent.
10. В отчете по PATCH 5 нужен отдельный proof-блок:

- `useLegalDetails` не менялся,
- `OrganizationDetailsForm` reused as-is или через adapter,
- billing-карточка не открывается в edit-flow,
- archive применяется только к document-записям.

После этих правок PATCH 5 можно считать готовым к реализации.

&nbsp;

PATCH 5 — CRUD Юрлица/ИП в AI-разделе «Реквизиты»

## Scope

Заменить placeholder «Юрлица / ИП» в `/ai` на полноценный список + create/edit flow. Billing-записи read-only. Document-записи — полный CRUD. Anti-duplicate через PATCH 3.

## Файлы

### Новые

1. `**src/hooks/useAiEntities.ts**` — hook для загрузки entity-записей текущего пользователя из `client_legal_details`, разделенных по `purpose`. Возвращает `{ billingEntities, documentEntities, isLoading, profileId, createEntity, updateEntity, archiveEntity }`. Billing-записи загружаются но мутации для них недоступны. Archive = `UPDATE status='archived'` (не DELETE).
2. `**src/components/ai-requisites/EntityListScreen.tsx**` — список карточек юрлиц/ИП. Содержит:
  - Секция billing-записей с badge «Платёжные» и ссылкой «Редактировать в настройках» (`/settings/legal-details`)
  - Секция document-записей с кнопками «Открыть» / «Архивировать»
  - Кнопка «Добавить» → переход к create flow
  - Archived записи показаны отдельным блоком (свёрнуто по умолчанию)
3. `**src/components/ai-requisites/EntityFormScreen.tsx**` — обёртка create/edit экрана. Содержит:
  - `PayerTypeSelector` (только при создании)
  - `OrganizationDetailsForm` (reuse 1:1 из `src/components/legal-details/`)
  - Anti-duplicate check: при вводе УНП → `useEntityDuplicateCheck` → при match → `DuplicateWarningDialog`
  - При создании: `purpose='document'` hardcoded
  - Кнопка «Назад» → возврат к списку

### Изменяемые

4. `**src/pages/AI.tsx**` — заменить requisites stub (entities) на `EntityListScreen` / `EntityFormScreen` с локальным state `entityMode: 'list' | 'create' | 'edit'`

### Не менять

- `useLegalDetails.tsx` — не трогаем, создаём отдельный hook
- `OrganizationDetailsForm.tsx` — импорт as-is
- `GrpConfirmDialog.tsx` — уже встроен в OrganizationDetailsForm
- Edge functions, billing, setDefault

## Архитектура

```text
AI.tsx (activeSubTab === 'entities')
  ├─ entityMode === 'list'  → <EntityListScreen>
  │     ├─ billing cards (read-only, badge, link to /settings)
  │     ├─ document cards (click → edit)
  │     └─ archived cards (collapsed)
  └─ entityMode === 'create'|'edit' → <EntityFormScreen>
        ├─ PayerTypeSelector (create only)
        ├─ useEntityDuplicateCheck (on UNP blur)
        ├─ DuplicateWarningDialog (on match)
        └─ OrganizationDetailsForm (reuse)
```

## Ключевые решения

1. **useAiEntities** отделен от `useLegalDetails` чтобы не ломать billing flow. Запрос тот же (`client_legal_details WHERE profile_id`), но результат разделен по `purpose`.
2. **Billing read-only**: карточки billing-записей не имеют кнопок edit/archive. Только badge + link.
3. **Anti-duplicate**: `useEntityDuplicateCheck.checkDuplicate(unp, profileId)` вызывается в `EntityFormScreen` перед первым сабмитом или по blur с поля УНП. При match — `DuplicateWarningDialog` с кандидатами.
4. **Archive vs Delete**: document-записи архивируются (`status='archived'`), не удаляются. Это согласуется с PATCH 2 CHECK constraint.
5. **OrganizationDetailsForm reuse**: форма принимает `initialData` и `onSubmit` — интерфейс совместим. Для create передаём `null`, для edit — существующую запись.

## Технические детали

- `useAiEntities` использует `useQuery` с ключом `["ai-entities", profileId]`, загружает все записи owner'а включая archived
- Для create: `supabase.from('client_legal_details').insert({ ...data, profile_id, purpose: 'document', status: 'active' })`
- Для archive: `supabase.from('client_legal_details').update({ status: 'archived' }).eq('id', id)`
- `EntityListScreen` группирует записи: `billing = purpose === 'billing'`, `activeDoc = purpose === 'document' && status === 'active'`, `archivedDoc = status === 'archived'`

## DoD

- Billing-записи видны с badge «Платёжные», read-only, ссылка на настройки
- Document-записи: полный CRUD (create/read/edit/archive)
- Anti-duplicate по УНП через PATCH 3 hook
- OrganizationDetailsForm, GrpConfirmDialog, address flow reused 1:1
- setDefault и billing logic не тронуты
- useLegalDetails не изменён