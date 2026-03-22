# да, согласен, с учетом правок:

&nbsp;

1. ai_chat_messages привести к эталонной схеме:
  &nbsp;
  - использовать user_id, а не profile_id;
  - добавить conversation_id;
  - оставить attachments jsonb;
  - metadata можно добавлять только add-only, но не вместо attachments.
    Иначе это будет расхождение с уже утвержденным планом PATCH 2 и PATCH 8.
  &nbsp;
2. Для legal_details_persons не терять ранее зафиксированную модель адреса:
  &nbsp;
  - нужен не только address_structured jsonb,
  - но и сохранение/поддержка address_* полей, либо явное документированное решение, что они полностью вычисляются/рендерятся из address_structured без потери функционала StructuredAddressBlock.
    Иначе можно сломать reuse shared form logic из PATCH 6.
  &nbsp;
3. Для legal_details_roles_catalog и legal_details_positions_catalog не делать public read.
  Оставить чтение для authenticated и при необходимости admin manage.
  public read здесь лишний и не был зафиксирован в эталонном плане.
4. В legal_details_entity_person_links добавить явные CHECK-ограничения по семантике:
  &nbsp;
  - share_percent допустим только для founder;
  - position_catalog_id / custom_position_text допустимы только для position;
  - для other используется custom_role_text;
  - запретить одновременно конфликтующие комбинации полей.
    Сейчас в плане это описано логически, но не зафиксировано как constraint.
  &nbsp;
5. Реализацию partial unique indexes не завязывать на подзапросы к role_type внутри predicate и не на хардкод UUID seed-записей.
  Нужен безопасный, доказуемый способ без хардкод-UUID и без SQL-конструкций, которые могут быть нестабильны для partial index predicate. Это надо явно прописать до миграции.
6. Для расширения client_legal_details вместе с колонками purpose и status сразу добавить:
  &nbsp;
  - допустимые значения через CHECK или эквивалентный guard;
  - индексы не только по (profile_id, purpose) и (profile_id, status), но только если они реально нужны по планируемым query paths.
    Не добавлять “на всякий случай” лишние индексы без объяснения.
  &nbsp;
7. В PATCH 2 явно зафиксировать, что:
  &nbsp;
  - существующие policy и existing partial unique index по is_default не меняются;
  - setDefault guard по purpose='billing' **не реализуется в PATCH 2**, а только будет обязателен в следующем прикладном PATCH, где меняется логика.
    Иначе scope PATCH 2 может расползтись.
  &nbsp;
8. В DoD уточнить:
  &nbsp;
  - “код не менялся” означает без UI/edge changes;
  - auto-generated types.ts допустим, но только как следствие миграции;
  - нужен proof applied schema: список созданных таблиц, колонок, policy и индексов после миграции.
  &nbsp;

&nbsp;

&nbsp;

PATCH 2 — Новые таблицы + расширение `client_legal_details`

## Scope

6 миграций (один SQL-файл):

1. `purpose` + `status` в `client_legal_details`
2. `legal_details_persons`
3. `legal_details_roles_catalog` + seed
4. `legal_details_positions_catalog` + seed
5. `legal_details_entity_person_links` + partial unique indexes
6. `ai_chat_messages`

## Детали

### 1. Расширение `client_legal_details`

```sql
ALTER TABLE public.client_legal_details
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'billing',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

CREATE INDEX idx_client_legal_details_purpose ON public.client_legal_details(profile_id, purpose);
CREATE INDEX idx_client_legal_details_status ON public.client_legal_details(profile_id, status);
```

Все существующие записи автоматически получают `purpose='billing', status='active'`. Zero regression.

### 2. `legal_details_persons`

Карточки физлиц. Поля: id, profile_id, full_name, birth_date, personal_number, passport_series/number/issued_by/issued_date/valid_until, phone, email, address_structured (JSONB), notes, is_active, created_at, updated_at.

RLS: owner-based по `profile_id` (SELECT/INSERT/UPDATE/DELETE) + admin ALL.

### 3. `legal_details_roles_catalog`

Справочник типов связей. Поля: id, role_type (founder/position/other), code, label, sort_order, is_active.

Seed: 3 записи — `founder` (Учредитель), `position` (Должностное лицо), `other` (Другое).

Без RLS (public read).

### 4. `legal_details_positions_catalog`

Справочник должностей. Поля: id, code, label, country_scope, is_system, is_active, sort_order.

Seed: Директор, Главный бухгалтер, Заместитель директора, Бухгалтер, Секретарь.

Без RLS (public read).

### 5. `legal_details_entity_person_links`

Связи entity↔person. Поля: id, profile_id, legal_details_id (FK → client_legal_details), person_id (FK → legal_details_persons), role_catalog_id (FK → roles_catalog), position_catalog_id (FK nullable → positions_catalog), custom_role_text, custom_position_text, share_percent, acts_on_basis, is_primary, start_date, end_date, notes, created_at, updated_at.

RLS: owner-based по `profile_id` + admin ALL.

4 partial unique indexes per plan:

- `uq_link_founder`: (legal_details_id, person_id, role_catalog_id) WHERE role_type=founder
- `uq_link_position_catalog`: (legal_details_id, person_id, role_catalog_id, position_catalog_id) WHERE position_catalog_id IS NOT NULL
- `uq_link_position_custom`: (legal_details_id, person_id, role_catalog_id, custom_position_text) WHERE position_catalog_id IS NULL AND custom_position_text IS NOT NULL
- `uq_link_other`: (legal_details_id, person_id, role_catalog_id, custom_role_text) WHERE custom_role_text IS NOT NULL

### 6. `ai_chat_messages`

История AI-чата. Поля: id, profile_id, role (user/assistant/system), content, metadata (JSONB), created_at.

RLS: owner-based по `profile_id` + admin ALL.

### Triggers

`updated_at` trigger на `legal_details_persons` и `legal_details_entity_person_links`.

### Что НЕ меняется

- Существующие RLS на `client_legal_details` — остаются как есть
- Существующий unique index `idx_client_legal_details_default` — остаётся
- Все edge functions — не трогаем
- Все UI — не трогаем

### Файлы

- 1 новая миграция (через database migration tool)

### DoD

- Миграция применена
- 5 новых таблиц созданы
- `client_legal_details` расширена двумя колонками
- RLS на всех новых таблицах с персональными данными
- Seed данные в каталогах
- Partial unique indexes на links
- Код не менялся (кроме auto-generated types.ts)