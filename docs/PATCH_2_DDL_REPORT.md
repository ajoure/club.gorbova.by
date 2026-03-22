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
- 6 CHECK constraints:
  - `share_percent` только для founder
  - `position_catalog_id` / `custom_position_text` только для position
  - `custom_role_text` только для other
  - position: must have catalog XOR custom
  - other: must have custom_role_text
- 4 partial unique indexes: `uq_link_founder`, `uq_link_position_catalog`, `uq_link_position_custom`, `uq_link_other`
- RLS: owner-based + admin ALL
- Trigger `set_updated_at_links`

### 6. `ai_chat_messages`
- `user_id` (не profile_id), `conversation_id`, `attachments JSONB`, `metadata JSONB`
- RLS: owner (SELECT/INSERT) + admin ALL

---

## Proof: Applied Schema

### Таблицы (5 новых)
| Таблица | Колонок | RLS | Policies |
|---|---|---|---|
| legal_details_persons | 16 | ✅ | 5 (4 owner + 1 admin) |
| legal_details_roles_catalog | 6 | ✅ | 2 (read + admin) |
| legal_details_positions_catalog | 7 | ✅ | 2 (read + admin) |
| legal_details_entity_person_links | 16 | ✅ | 5 (4 owner + 1 admin) |
| ai_chat_messages | 8 | ✅ | 3 (2 owner + 1 admin) |

### Колонки (расширение)
| Таблица | Колонка | Default |
|---|---|---|
| client_legal_details | purpose | 'billing' |
| client_legal_details | status | 'active' |

### Индексы на links
- idx_links_legal_details, idx_links_person, idx_links_profile
- uq_link_founder, uq_link_position_catalog, uq_link_position_custom, uq_link_other

### Seed данные
- roles_catalog: 3 записи (founder, position, other)
- positions_catalog: 5 записей (director, chief_accountant, deputy_director, accountant, secretary)

---

## Что НЕ менялось
- Existing RLS на `client_legal_details` — без изменений
- Existing partial unique index `idx_client_legal_details_default` — без изменений
- `setDefault` guard по `purpose='billing'` — **не реализован**, будет в прикладном PATCH
- Edge functions — без изменений
- UI — без изменений
- Код — без изменений (только auto-generated types.ts как следствие миграции)

---

## Linter
- 4 INFO warnings — pre-existing (другие таблицы), не от нашей миграции
- `trigger_set_updated_at` — исправлен search_path
- 0 новых warnings от PATCH 2
