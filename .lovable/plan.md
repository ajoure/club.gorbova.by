# да, согласен, с учетом правок:

1. **Логика ID ячеек в плане пока не дожата.**  
Канонический токен должен быть **через** `public_id` **поля**, а не через пустой шаблон `{{cf.legal_details.}}`.  
Зафиксируй явно:
  - UI показывает `FLD-000042`
  - chip копирует, например, `{{cf.legal_details.FLD-000042}}`
  - резолвер сначала находит запись `fields_registry` по `public_id`, а уже потом внутри работает через `id uuid`.  
  Это соответствует ID-driven архитектуре: внутренняя логика только через UUID, UI — через `public_id`
2. **Не делать key главным идентификатором токена.**  
`legal_details.leg_unp` и подобные keys нужны для registry и whitelist mapping, это нормально. Но source of truth для токена должен быть не key, а зарегистрированное поле из `fields_registry` с его `public_id`.  
Иначе это не “логика ID ячеек”, а снова текстовый резолв.
3. **Резолвер опиши жестче.**  
Правильный путь такой:  
`token public_id -> fields_registry.public_id -> fields_registry.id/key -> LEGAL_DETAILS_FIELD_MAP -> client_legal_details[column]`  
Никаких прямых попыток резолвить документ по имени поля, slug, label или тексту. Внутренняя логика должна идти по идентификаторам
4. **Оставить structured columns как SoT — это правильно.**  
`client_legal_details` остается источником истины, а `fields_registry` — только registry/metadata/token layer. Это совместимо с постепенной миграцией без ломки production-логики
5. **Не создавать новую sequence для legal_details fields.**  
Здесь план верный: раз это записи в `fields_registry`, они должны жить в общей модели полей и получать обычный `FLD-*`, а не отдельное семейство ID.
6. **Вынести mapping в одно место.**  
`LEGAL_DETAILS_FIELD_MAP` должен быть один shared-source, а не копии в resolver, hook и UI.  
Иначе позже появится рассинхрон. По правилам нужно переиспользовать существующие решения и не плодить дубли
7. `useLegalDetailsFields()` **— да, это правильный ход.**  
Один shared hook для загрузки registry полей лучше, чем отдельные ad-hoc загрузчики в каждой форме. UI не должен разрастаться бизнес-логикой
8. **Добавь явный dry-run/verify на реальный шаблон документа.**  
Не только “chip копирует токен”, а еще:
  - вставили токен в шаблон
  - передали `legalDetailsId`
  - получили реальное значение из `client_legal_details`  
  Это обязательно по safe workflow: diagnose → plan → dry run → execute → verify
9. **DoD нужно уточнить формулировкой про токен.**  
Вместо
  - “клик копирует канонический токен `{{cf.legal_details.}}`”  
  нужно
  - “клик копирует канонический токен с `public_id` поля, например `{{cf.legal_details.FLD-000042}}`”.
10. **Если в token engine уже есть legacy-формат по key — не ломать его резко.**  
Новый ID-driven формат должен стать каноническим, а старый key-based формат, если он где-то уже существует, оставлять только как compatibility layer без смены source of truth. Это соответствует правилу постепенной миграции legacy -> compatibility layer -> canonical architecture

В целом план правильный. Главная обязательная правка: **в явном виде зафиксировать канонический токен через** `fields_registry.public_id`**, а не оставлять** `{{cf.legal_details.}}` **без ID**.

&nbsp;

PATCH 3.2.7C — Legal Details Field Registry (с правками)

## Что делаем

Регистрируем каждое поле реквизитов в `fields_registry` с `entity_type = 'legal_details'`, чтобы:

- каждое поле получило `public_id` (`FLD-XXXXXX`) через существующий trigger
- токены можно было вставлять в документы
- UI показывал `CopyableIdChip` рядом с каждым полем

## Архитектурные решения (по правкам)

### 1. Namespaced keys

Keys в формате `legal_details.<column>`:

- `legal_details.leg_unp`, `legal_details.leg_name`, `legal_details.bank_account` и т.д.
- Уникальность гарантирована constraint `UNIQUE(entity_type, key)`

### 2. ID-driven токен формат

Канонический токен: `{{cf.legal_details.<UUID>}}`

- Внутренний резолв: через `fields_registry.id` (UUID)
- UI chip показывает `public_id` (`FLD-000042`)
- Клик по chip копирует полный токен `{{cf.legal_details.<UUID>}}`
- Никакого резолва по текстовым ключам — только registry lookup по UUID

### 3. Единая sequence для полей

Не создаём новую запись в `public_id_sequences`. Все поля registry используют существующий `next_public_id('field')` → `FLD-*`. Trigger `trg_fields_registry_public_id` уже работает.

### 4. Whitelist mapping для резолвера

Явный `LEGAL_DETAILS_FIELD_MAP`:

```typescript
const LEGAL_DETAILS_FIELD_MAP: Record<string, string> = {
  "legal_details.leg_unp": "leg_unp",
  "legal_details.leg_name": "leg_name",
  "legal_details.bank_account": "bank_account",
  // ... все ~30 полей
};
```

Резолвер ищет field в registry по UUID → получает `key` → проверяет whitelist → читает колонку из `client_legal_details`. Динамический доступ `details[key]` запрещён.

### 5. Shared hook вместо дублирования

Один `useLegalDetailsFields()` hook:

- загружает `fields_registry` где `entity_type = 'legal_details'`
- строит map `column_name → { public_id, field_id, token }`
- используется и в `OrganizationDetailsForm`, и в `IndividualDetailsForm`

### 6. Idempotent seed

Migration через `INSERT ... ON CONFLICT (entity_type, key) DO NOTHING` — повторный deploy безопасен.

### 7. Entity ID в контексте резолва

Резолвер получает `context.legalDetailsId` (UUID `client_legal_details.id`) — никаких поисков по имени/slug.

---

## Шаги реализации

### Шаг 1: Миграция — seed ~30 полей

```sql
INSERT INTO fields_registry (entity_type, key, label, data_type, display_order)
VALUES
  ('legal_details', 'legal_details.leg_unp', 'УНП (ЮЛ)', 'text', 1),
  ('legal_details', 'legal_details.leg_org_form', 'Форма собственности', 'text', 2),
  ('legal_details', 'legal_details.leg_name', 'Название организации', 'text', 3),
  -- ... все поля leg_*, ent_*, ind_*, common (bank_*, phone, email)
ON CONFLICT (entity_type, key) DO NOTHING;
```

`public_id` присвоится автоматически trigger-ом.

### Шаг 2: Token resolver — поддержка legal_details

**Файл: `src/lib/token-resolver.ts**`

- Добавить regex `CF_LEGAL_TOKEN_REGEX` для `{{cf.legal_details.<UUID>}}`
- Добавить `context.legalDetailsId?: string`
- Резолв: UUID → registry lookup → whitelist map → `client_legal_details[column]`
- Без динамического доступа по key

### Шаг 3: Token registry — группа legal_details

**Файл: `src/lib/tokens/tokenRegistry.ts**`

- `loadLegalDetailsFields()` аналогично `loadProductFields()`
- Группа `"legal_details"` в `TokenDef.group`

### Шаг 4: Shared hook

**Новый файл: `src/hooks/useLegalDetailsFields.ts**`

- Загрузка registry для `entity_type = 'legal_details'`
- Map: `columnName → { publicId, fieldId, tokenString }`
- Используется обеими формами

### Шаг 5: UI — CopyableIdChip в формах

**Файлы: `OrganizationDetailsForm.tsx`, `IndividualDetailsForm.tsx**`

- Импорт `useLegalDetailsFields()`
- Рядом с каждым полем — `CopyableIdChip` с `public_id`
- `copyValue` = `{{cf.legal_details.<UUID>}}`

---

## Не делаем

- Не создаём новую sequence в `public_id_sequences`
- Не переносим данные в `field_values_v2`
- Не меняем save/load flow реквизитов
- Не трогаем address pipeline
- Не добавляем кастомные поля — только системные

## DoD

- В `fields_registry` ~30 записей с `entity_type='legal_details'`, keys namespaced
- Каждая имеет auto-generated `public_id` (`FLD-*`)
- UI показывает `public_id` через `CopyableIdChip`, клик копирует канонический токен `{{cf.legal_details.<UUID>}}`
- Token resolver резолвит через UUID → whitelist → column, не через текстовые ключи
- Повторный запуск миграции не создаёт дублей
- Save/load flow реквизитов не изменён
- Резолвер получает `legalDetailsId` (UUID), не ищет по текстовым полям