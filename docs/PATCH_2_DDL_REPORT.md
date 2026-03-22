# PATCH 2 — Отчет о выполнении

Отчет о выполнении: DDL миграция. Код не менялся.

---

## Что сделано

### 1. Расширение `client_legal_details`
- Добавлены колонки `purpose TEXT NOT NULL DEFAULT 'billing'` и `status TEXT NOT NULL DEFAULT 'active'`
- CHECK constraints: `purpose IN ('billing', 'document')`, `status IN ('active', 'archived')`
- Индекс `idx_cld_profile_purpose(profile_id, purpose)` — для фильтрации по назначению в list queries
- Все существующие записи автоматически получили `purpose='billing', status='active'`
- Existing RLS policies и `idx_client_legal_details_default` — **не изменены**

### 2. `legal_details_persons`
- 16 колонок: id, profile_id, full_name, birth_date, personal_number, passport_*, phone, email, address_structured (JSONB), notes, is_active, created_at, updated_at
- `address_structured` = canonical JSONB (CanonicalAddressPayload). Без legacy address_* полей — StructuredAddressBlock работает с JSONB напрямую
- RLS: owner-based (SELECT/INSERT/UPDATE/DELETE) + admin ALL
- Trigger `set_updated_at_persons`

### 3. `legal_details_roles_catalog`
- Seed: founder, position, other
- RLS: authenticated read + admin manage (не public!)

### 4. `legal_details_positions_catalog`
- Seed: Директор, Главный бухгалтер, Заместитель директора, Бухгалтер, Секретарь
- RLS: authenticated read + admin manage (не public!)

### 5. `legal_details_entity_person_links`
- Денормализованный `role_type TEXT` для stable partial indexes (без subqueries, без hardcoded UUID)
- 6 CHECK constraints (см. полный перечень ниже)
- 4 partial unique indexes (см. полный перечень ниже)
- Validation trigger `trg_validate_link_role_type` (PATCH 2.x) — гарантирует согласованность `role_type ↔ role_catalog_id`
- RLS: owner-based + admin ALL
- Trigger `set_updated_at_links`

### 6. `ai_chat_messages`
- `user_id` (не profile_id), `conversation_id`, `attachments JSONB`, `metadata JSONB`
- RLS: owner (SELECT/INSERT) + admin ALL

---

## Proof-пакет

### Таблицы (5 новых)

| Таблица | Колонок | RLS | Policies |
|---|---|---|---|
| legal_details_persons | 16 | ✅ | 5 (4 owner + 1 admin) |
| legal_details_roles_catalog | 6 | ✅ | 2 (read + admin) |
| legal_details_positions_catalog | 7 | ✅ | 2 (read + admin) |
| legal_details_entity_person_links | 16 | ✅ | 5 (4 owner + 1 admin) |
| ai_chat_messages | 8 | ✅ | 3 (2 owner + 1 admin) |

### Колонки (расширение `client_legal_details`)

| Колонка | Тип | Default | CHECK |
|---|---|---|---|
| purpose | TEXT NOT NULL | 'billing' | `purpose IN ('billing', 'document')` |
| status | TEXT NOT NULL | 'active' | `status IN ('active', 'archived')` |

### CHECK constraints на `legal_details_entity_person_links` (6 шт)

| Имя | SQL |
|---|---|
| `chk_share_percent_founder_only` | `share_percent IS NULL OR role_type = 'founder'` |
| `chk_position_catalog_position_only` | `position_catalog_id IS NULL OR role_type = 'position'` |
| `chk_custom_position_position_only` | `custom_position_text IS NULL OR role_type = 'position'` |
| `chk_custom_role_other_only` | `custom_role_text IS NULL OR role_type = 'other'` |
| `chk_position_exclusive` | `role_type <> 'position' OR (position_catalog_id IS NOT NULL AND custom_position_text IS NULL) OR (position_catalog_id IS NULL AND custom_position_text IS NOT NULL)` |
| `chk_other_has_text` | `role_type <> 'other' OR custom_role_text IS NOT NULL` |

### Partial unique indexes на `legal_details_entity_person_links` (4 шт)

| Имя | Колонки | WHERE |
|---|---|---|
| `uq_link_founder` | (legal_details_id, person_id, role_catalog_id) | `role_type = 'founder'` |
| `uq_link_position_catalog` | (legal_details_id, person_id, role_catalog_id, position_catalog_id) | `position_catalog_id IS NOT NULL` |
| `uq_link_position_custom` | (legal_details_id, person_id, role_catalog_id, custom_position_text) | `position_catalog_id IS NULL AND custom_position_text IS NOT NULL` |
| `uq_link_other` | (legal_details_id, person_id, role_catalog_id, custom_role_text) | `custom_role_text IS NOT NULL` |

### Индексы на `legal_details_entity_person_links` (FK lookup)

- `idx_links_legal_details(legal_details_id)`
- `idx_links_person(person_id)`
- `idx_links_profile(profile_id)`

### Индексы на `client_legal_details` (новые)

- `idx_cld_profile_purpose(profile_id, purpose)`

### Seed данные

#### `legal_details_roles_catalog` (3 записи)

| code | role_type | label | sort_order |
|---|---|---|---|
| founder | founder | Учредитель | 1 |
| position | position | Должностное лицо | 2 |
| other | other | Другое | 3 |

#### `legal_details_positions_catalog` (5 записей)

| code | label | country_scope | is_system | sort_order |
|---|---|---|---|---|
| director | Директор | BY | true | 1 |
| chief_accountant | Главный бухгалтер | BY | true | 2 |
| deputy_director | Заместитель директора | BY | true | 3 |
| accountant | Бухгалтер | BY | true | 4 |
| secretary | Секретарь | BY | true | 5 |

### RLS policies (поименно)

#### `legal_details_persons` (5 policies)

| Policy | Operation | Кто | Условие |
|---|---|---|---|
| persons_select_own | SELECT | authenticated | `profile_id = auth.uid()` |
| persons_insert_own | INSERT | authenticated | `profile_id = auth.uid()` |
| persons_update_own | UPDATE | authenticated | `profile_id = auth.uid()` |
| persons_delete_own | DELETE | authenticated | `profile_id = auth.uid()` |
| persons_admin_all | ALL | authenticated | `has_role(auth.uid(), 'admin')` |

#### `legal_details_roles_catalog` (2 policies)

| Policy | Operation | Кто | Условие |
|---|---|---|---|
| roles_catalog_read | SELECT | authenticated | true |
| roles_catalog_admin | ALL | authenticated | `has_role(auth.uid(), 'admin')` |

#### `legal_details_positions_catalog` (2 policies)

| Policy | Operation | Кто | Условие |
|---|---|---|---|
| positions_catalog_read | SELECT | authenticated | true |
| positions_catalog_admin | ALL | authenticated | `has_role(auth.uid(), 'admin')` |

#### `legal_details_entity_person_links` (5 policies)

| Policy | Operation | Кто | Условие |
|---|---|---|---|
| links_select_own | SELECT | authenticated | `profile_id = auth.uid()` |
| links_insert_own | INSERT | authenticated | `profile_id = auth.uid()` |
| links_update_own | UPDATE | authenticated | `profile_id = auth.uid()` |
| links_delete_own | DELETE | authenticated | `profile_id = auth.uid()` |
| links_admin_all | ALL | authenticated | `has_role(auth.uid(), 'admin')` |

#### `ai_chat_messages` (3 policies)

| Policy | Operation | Кто | Условие |
|---|---|---|---|
| chat_select_own | SELECT | authenticated | `user_id = auth.uid()` |
| chat_insert_own | INSERT | authenticated | `user_id = auth.uid()` |
| chat_admin_all | ALL | authenticated | `has_role(auth.uid(), 'admin')` |

---

## role_type consistency (PATCH 2.x)

### Проблема
Денормализованный `role_type` в `legal_details_entity_person_links` может рассинхронизироваться с `role_type` в referenced `legal_details_roles_catalog` записи. Это делает CHECK constraints и partial indexes логически хрупкими.

### Решение: validation trigger

| Параметр | Значение |
|---|---|
| Функция | `public.validate_link_role_type()` |
| Триггер | `trg_validate_link_role_type` |
| События | BEFORE INSERT OR UPDATE |
| Таблица | `public.legal_details_entity_person_links` |
| SECURITY | INVOKER |
| search_path | public |

### Логика
1. `SELECT role_type INTO v_catalog_role_type FROM legal_details_roles_catalog WHERE id = NEW.role_catalog_id`
2. Если `v_catalog_role_type IS NULL` → RAISE EXCEPTION (несуществующий role_catalog_id)
3. Если `NEW.role_type <> v_catalog_role_type` → RAISE EXCEPTION с описанием mismatch
4. Иначе → RETURN NEW

### Класс рассинхрона, который запрещён
- INSERT/UPDATE где `role_catalog_id` указывает на каталожную запись с `role_type='position'`, а `role_type` в строке links = `'founder'` (или любая другая комбинация)
- INSERT/UPDATE с несуществующим `role_catalog_id`

### Proof-check
- Существующие данные: таблица `legal_details_entity_person_links` пуста → конфликтов нет
- INSERT с корректным `role_type` → проходит (гарантировано логикой trigger)
- INSERT с несовпадающим `role_type` → RAISE EXCEPTION (гарантировано trigger)

---

## Address model decision

### Решение
`legal_details_persons` использует **только** `address_structured JSONB` как canonical source адреса. Legacy `address_*` текстовые колонки **не создаются**.

### Обоснование
- `StructuredAddressBlock` (shared UI component) работает напрямую с JSONB-объектом `CanonicalAddressPayload`
- Будущий `PersonFieldsForm` (PATCH 6) будет использовать тот же `StructuredAddressBlock`, передавая JSONB
- Отдельные текстовые колонки создавали бы необходимость двусторонней синхронизации (JSONB ↔ columns), что увеличивает сложность без пользы
- В `client_legal_details` legacy `ind_address_*` колонки сохранены для обратной совместимости, но для новых таблиц принята JSONB-only модель

---

## Что НЕ менялось
- Existing RLS на `client_legal_details` — без изменений
- Existing partial unique index `idx_client_legal_details_default` — без изменений
- `setDefault` guard по `purpose='billing'` — **не реализован**, будет в прикладном PATCH
- Edge functions — без изменений
- UI — без изменений
- Hooks — без изменений
- Код — без изменений (только auto-generated types.ts как следствие миграции)

---

## Linter
- 4 INFO warnings — pre-existing (другие таблицы), не от наших миграций
- `trigger_set_updated_at` — исправлен search_path в основной миграции
- 0 новых warnings от PATCH 2 / PATCH 2.x
