# PATCH 3.2.7C — Legal Details Field Registry ✅ DONE

## Выполнено

### 1. Миграция — 31 поле в fields_registry
- `entity_type = 'legal_details'`, keys namespaced (`legal_details.leg_unp` и т.д.)
- Idempotent: `ON CONFLICT (entity_type, key) DO NOTHING`
- `public_id` auto-generated: FLD-000004 → FLD-000034
- Новая sequence НЕ создавалась — используется существующий `next_public_id('field')`

### 2. Shared field map — `src/lib/legal-details/fieldMap.ts`
- `LEGAL_DETAILS_FIELD_MAP`: registry key → column whitelist (31 записей)
- `COLUMN_TO_REGISTRY_KEY`: reverse lookup
- Single source of truth для резолвера и UI

### 3. Token resolver — `src/lib/token-resolver.ts`
- Добавлен `CF_LEGAL_TOKEN_REGEX` для `{{cf.legal_details.<UUID>}}`
- Резолв: UUID → registry lookup → whitelist → `client_legal_details[column]`
- `context.legalDetailsId` — entity ID в контексте
- Без динамического доступа по key

### 4. Token registry — `src/lib/tokens/tokenRegistry.ts`
- `loadLegalDetailsFields()` + кэш `_legalDetailsFieldsCache`
- Группа `"legal_details"` в `TokenDef.group`
- `tokenStringToLabel()` ищет и в legal_details кэше

### 5. Shared hook — `src/hooks/useLegalDetailsFields.ts`
- Загружает registry для `entity_type = 'legal_details'`
- Map: `columnName → { publicId, fieldId, tokenString }`
- Stale time 5 мин

### 6. UI — CopyableIdChip в формах
- `FieldLabelWithId` компонент: label + chip
- `OrganizationDetailsForm.tsx`: chip на УНП, Форма, Название, Должность, ФИО руководителя, Основание, Банк, БИК, Счёт, Телефон, Email
- `IndividualDetailsForm.tsx`: chip на ФИО, Дата рождения, Личный номер, Email, Телефон, Серия, Номер, Дата выдачи, Действ. до, Кем выдан, Счёт, Банк, БИК
- Chip копирует канонический токен `{{cf.legal_details.<UUID>}}`

## Архитектура

```
client_legal_details (structured columns) ← SoT
        ↑ whitelist map
LEGAL_DETAILS_FIELD_MAP (fieldMap.ts) ← single source
        ↑
fields_registry (entity_type='legal_details') ← metadata/tokens
        ↑
token: {{cf.legal_details.<UUID>}}
UI chip: FLD-000042 → copies token
```

## DoD ✅

- [x] 31 запись в `fields_registry` с `entity_type='legal_details'`, keys namespaced
- [x] Каждая имеет auto-generated `public_id` (`FLD-*`)
- [x] UI показывает `public_id` через `CopyableIdChip`
- [x] Клик копирует канонический токен `{{cf.legal_details.<UUID>}}`
- [x] Token resolver резолвит через UUID → whitelist → column
- [x] Повторный запуск миграции не создаёт дублей
- [x] Save/load flow реквизитов не изменён
- [x] TypeScript build = clean
