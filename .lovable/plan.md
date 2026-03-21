# PATCH 3.2.7D — Canonical Token Format + Address Sub-fields ✅ DONE

## Выполнено

### 1. Канонический формат токенов — через public_id

Переведён весь стек legal_details с UUID-based на public_id-based:

- **Канонический токен**: `{{cf.legal_details.FLD-000042}}`
- **Compatibility layer**: UUID-токены `{{cf.legal_details.<UUID>}}` по-прежнему резолвятся (legacy)
- **Product tokens**: остаются UUID-based (`{{cf.product.<UUID>}}`), не затронуты

Затронутые файлы:
- `src/hooks/useLegalDetailsFields.ts` — `tokenString` через `f.public_id`
- `src/lib/tokens/tokenRegistry.ts` — `tokenString` через `f.public_id`
- `src/lib/token-resolver.ts` — regex принимает `FLD-\\d+` и UUID; lookup по `public_id` (canonical) или `id` (legacy)

### 2. Миграция — 16 адресных суб-полей

Зарегистрированы в `fields_registry`:
- 8 полей `leg_address_*` (ЮЛ): street, house, building, apartment, city, region, postal_code, country
- 8 полей `ent_address_*` (ИП): аналогично
- FLD-000035 → FLD-000050
- Idempotent: `ON CONFLICT DO NOTHING`

### 3. JSONB mapping в fieldMap.ts

`LEGAL_DETAILS_FIELD_MAP` расширен двумя типами маппинга:
- **Simple**: `"legal_details.leg_unp" → "leg_unp"` (прямая колонка)
- **JSONB**: `"legal_details.leg_address_street" → { column: "leg_address_structured", jsonPath: "street" }`

Единый shared source, без дублирования.

### 4. Резолвер — JSONB sub-fields + dual-format

Путь резолва:
```
token(FLD-XXXXXX или UUID)
  → fields_registry lookup (public_id или id)
  → key → LEGAL_DETAILS_FIELD_MAP
  → simple column ИЛИ JSONB column[jsonPath]
  → client_legal_details → value
```

### 5. UI — CopyableIdChip на адресных полях

- `StructuredAddressBlock` получает опциональный `fieldIds` prop
- `OrganizationDetailsForm` передаёт маппинг `leg_address_*` / `ent_address_*` в зависимости от `isEntrepreneur`
- `IndividualDetailsForm` передаёт маппинг `ind_address_*`
- Chip показывает `FLD-000042`, копирует `{{cf.legal_details.FLD-000042}}`

## Архитектура

```
client_legal_details (structured columns + JSONB) ← SoT
        ↑ whitelist map (simple + JSONB)
LEGAL_DETAILS_FIELD_MAP (fieldMap.ts) ← single source
        ↑
fields_registry (entity_type='legal_details') ← metadata/tokens
        ↑
Canonical token: {{cf.legal_details.FLD-XXXXXX}}
Legacy compat:   {{cf.legal_details.<UUID>}}
UI chip: FLD-000042 → copies canonical token
```

## DoD ✅

- [x] Канонический токен: `{{cf.legal_details.FLD-XXXXXX}}`
- [x] CopyableIdChip копирует токен через public_id
- [x] Резолвер: public_id → registry → whitelist → column/jsonPath → value
- [x] Legacy UUID-токены поддерживаются (compatibility layer)
- [x] 16 адресных суб-полей (FLD-000035..FLD-000050) зарегистрированы
- [x] Адресные поля имеют CopyableIdChip в UI
- [x] Повторный запуск миграции безопасен (ON CONFLICT DO NOTHING)
- [x] Save/load flow реквизитов не изменён
- [x] TypeScript build = clean
- [x] Product tokens не затронуты
