# да, согласен, с учетом правок:

1. **Для** `legal_details` **нужен compatibility layer, а не hard switch.**  
Новый канонический формат — через `public_id`:  
`{{cf.legal_details.FLD-000042}}`  
Но если UUID-токены уже успели попасть в шаблоны, резолвер должен временно поддерживать **оба** формата:
  - new: `public_id`
  - legacy: `uuid`  
  При этом каноническим считать только `public_id`. Это соответствует правилу постепенной миграции legacy → compatibility layer → canonical architecture.
2. **Внутренняя логика должна остаться ID-driven.**  
Правильно так:
  - UI копирует токен через `public_id`
  - резолвер делает lookup в `fields_registry`
  - дальше работает через внутренний `id uuid` и whitelist mapping  
  Не резолвить по label, slug, имени поля или тексту. Внутренняя логика работает по UUID, UI — по `public_id`.
3. `fieldMap` **сделать единым source of truth для обоих типов маппинга.**  
Один shared mapping:
  - simple column
  - jsonb column + jsonPath  
  Без дублирования логики в hook, resolver и UI. Система должна переиспользовать существующие решения и не плодить параллельные маппинги.
4. **Адресные sub-fields добавлять только если они реально резолвятся из SoT, а не из UI-сборки строки.**  
Для ЮЛ/ИП source of truth должен быть JSONB `*_address_structured`; нельзя собирать адрес из текстового display-field или из фронтового состояния.
5. `StructuredAddressBlock` **не должен получать бизнес-логику.**  
В него передавать уже подготовленный mapping/chips, а не заставлять компонент самому знать про registry, resolver или Supabase. UI не должен содержать бизнес-логику.
6. **Миграция с адресными sub-fields — только idempotent.**  
Через `ON CONFLICT DO NOTHING`, без дублей, без изменения существующего save/load flow.
7. **DoD усилить реальным verify, а не только “chip появился”.**  
Обязательно:
  - token copied = `{{cf.legal_details.FLD-...}}`
  - шаблон документа с новым токеном реально резолвится
  - legacy UUID token, если уже существует, тоже временно резолвится
  - address sub-fields резолвятся из JSONB корректно
  - save/load реквизитов не изменился
8. **Product tokens в этом PATCH не трогать — это правильно.**  
Но прямо записать: это отдельный legacy-домен, не смешивать его миграцию с `legal_details`.
9. **В плане явно зафиксировать канонический путь резолва.**  
Нужна формулировка:  
`token(public_id) -> fields_registry.public_id -> fields_registry.id/key -> LEGAL_DETAILS_FIELD_MAP -> client_legal_details[column/jsonPath] -> value`

В остальном план уже правильный. Главная обязательная правка: **не делать жесткий разрыв с UUID без compatibility layer**, если старые legal_details токены уже могли сохраниться в шаблонах.

&nbsp;

PATCH 3.2.7D — Исправление канонического формата токенов + ID полей адреса

## Две проблемы

### 1. Токены используют UUID вместо public_id

Сейчас во всех местах токен строится как `{{cf.legal_details.<UUID>}}`. Нужно: `{{cf.legal_details.FLD-000042}}`.

Затронутые файлы:

- `src/hooks/useLegalDetailsFields.ts` — строка 42: `tokenString` через `f.id` → через `f.public_id`
- `src/lib/tokens/tokenRegistry.ts` — строка 94: `tokenString` через `f.id` → через `f.public_id`
- `src/lib/token-resolver.ts` — regex и резолвер: сейчас ищет UUID в токене → нужно искать `FLD-XXXXXX`, затем lookup `fields_registry.public_id` → получить `id/key` → whitelist → column
- `src/components/legal-details/FieldLabelWithId.tsx` — уже копирует `tokenString`, поэтому после исправления hook автоматически починится

**Резолвер — новый путь:**

```
{{cf.legal_details.FLD-000042}}
  → regex извлекает "FLD-000042"
  → SELECT id, key, data_type FROM fields_registry WHERE public_id IN (...)
  → key → LEGAL_DETAILS_FIELD_MAP → column
  → client_legal_details[column]
```

Regex для legal_details меняется с UUID-паттерна на `FLD-[0-9]+`.

**Совместимость с product tokens:** product tokens пока остаются на UUID (`{{cf.product.<UUID>}}`). Это legacy compatibility layer — не ломаем в этом патче. Legal details сразу делаем канонически правильно.

### 2. У адресных полей ЮЛ/ИП нет ID

Сейчас в seed есть только `leg_address` и `ent_address` — одна строка на весь адрес. Но адрес хранится структурированно в JSONB (`leg_address_structured`, `ent_address_structured`) с суб-полями: street, house, building, apartment, city, region, postal_code, country.

**Нужно:**

a) Зарегистрировать суб-поля адреса в `fields_registry`:

```
legal_details.leg_address_street    → Улица (ЮЛ)
legal_details.leg_address_house     → Дом (ЮЛ)
legal_details.leg_address_building  → Корпус (ЮЛ)
legal_details.leg_address_apartment → Кв./Офис (ЮЛ)
legal_details.leg_address_city      → Город (ЮЛ)
legal_details.leg_address_region    → Область (ЮЛ)
legal_details.leg_address_postal_code → Индекс (ЮЛ)
legal_details.leg_address_country   → Страна (ЮЛ)
```

Аналогично для `ent_address_*` (ИП).

b) Расширить `LEGAL_DETAILS_FIELD_MAP` — для адресных суб-полей маппинг будет не на колонку напрямую, а на `structured_column.sub_field`:

```typescript
"legal_details.leg_address_street": { column: "leg_address_structured", jsonPath: "street" },
"legal_details.leg_address_house": { column: "leg_address_structured", jsonPath: "house" },
```

c) Расширить резолвер — для JSONB-маппинга: читать `leg_address_structured` как JSONB, затем извлекать нужное суб-поле.

d) В UI — передать `fieldsMap` в `StructuredAddressBlock` (или обернуть каждое поле через prop), чтобы рядом с каждым адресным полем появился `CopyableIdChip`.

## Шаги

### Шаг 1: Миграция — добавить адресные суб-поля

Новая миграция — INSERT ~16 записей (8 для leg + 8 для ent) с `ON CONFLICT DO NOTHING`.

### Шаг 2: Расширить fieldMap.ts

Изменить структуру `LEGAL_DETAILS_FIELD_MAP` — для обычных полей остаётся string (column name), для адресных суб-полей — объект `{ column, jsonPath }`.

### Шаг 3: Исправить токенный формат на public_id

- `useLegalDetailsFields.ts`: `tokenString` через `public_id`
- `tokenRegistry.ts`: `tokenString` через `public_id`
- `token-resolver.ts`: regex `FLD-\\d+` вместо UUID, lookup по `public_id`

### Шаг 4: Резолвер — поддержка JSONB суб-полей

Резолвер для адресных полей:

- Определяет, что маппинг указывает на JSONB column + jsonPath
- Читает JSONB колонку, извлекает значение по jsonPath

### Шаг 5: UI — ID chips на адресных полях

Передать `fieldsMap` в `StructuredAddressBlock` через новый опциональный prop `fieldIds?: Map<string, LegalDetailsFieldEntry>`, где ключ — это `key` из StructuredAddress (street, house, etc.). Компонент рендерит `CopyableIdChip` рядом с label каждого поля.

## Не делаем

- Не меняем product tokens (остаются UUID — legacy compatibility)
- Не меняем save/load flow
- Не трогаем address pipeline логику

## DoD

- Канонический токен: `{{cf.legal_details.FLD-XXXXXX}}`
- CopyableIdChip копирует токен через public_id
- Резолвер: public_id → registry lookup → whitelist → column/jsonPath → value
- Адресные суб-поля зарегистрированы и имеют ID chips в UI
- Повторный запуск миграции безопасен
- Save/load flow не изменён