# Placeholders FLD-Backfill — Dry-run B (scope: 98)

Дата: 2026-05-13
Режим: **DRY-RUN — STOP. Execute не запускать без явного approve.**
Решение пользователя: **Вариант B** — канонизируем только реально покрытые SOT-токены.

---

## 1. Сводка (по форме отчёта)

| метрика | значение |
|---|---:|
| `found_typed_runtime_without_field_id_total` | **148** |
| `in_execute_scope` | **98** |
| `postponed_executor_ind` | **26** |
| `postponed_executor_ent` | **24** |
| `will_create_fields_registry_rows` | **98** |
| `will_update_document_token_registry_field_id` | **98** |
| `will_create_aliases` | **0** (согласовано: self-alias не создаём) |
| `conflicts` (existing `fields_registry.key`) | **0** |
| `current_max_public_id` | `FLD-000272` |
| `public_id_range_after_execute` | **`FLD-000273..FLD-000370`** |

Брейкдаун scope:

| namespace | n |
|---|---:|
| `customer.ind.*` | 26 |
| `customer.leg.*` | 24 |
| `customer.ent.*` | 24 |
| `executor.leg.*` | 24 |
| **итого** | **98** |

Postponed (не получают FLD-ID в этом execute):

| namespace | n | причина |
|---|---:|---|
| `executor.ind.*` | 26 | нет SOT — в `executors` нет колонок ФЛ (паспорт, ФИО как person, дата рождения, личный номер) |
| `executor.ent.*` | 24 | нет SOT — `executors` flat, без `subject_type=entrepreneur` и `ent_*` колонок |

---

## 2. SOT mapping (под Resolver)

### 2.1. `customer.ind.*` → `client_legal_details` (where `client_type='individual'`)

| token suffix | column / источник |
|---|---|
| `address.apartment` | `ind_address_structured->>'apartment'` (fallback `ind_address_apartment`) |
| `address.building` | `ind_address_structured->>'building'` |
| `address.city` | `ind_address_structured->>'city'` (fb `ind_address_city`) |
| `address.city_district` | `ind_address_structured->>'city_district'` |
| `address.country` | `ind_address_structured->>'country'` |
| `address.district` | `ind_address_structured->>'district'` (fb `ind_address_district`) |
| `address.full` | `ind_address_structured->>'formatted_address'` (fb `ind_address_structured->>'raw_input'`) |
| `address.house` | `ind_address_structured->>'house'` (fb `ind_address_house`) |
| `address.postal_code` | `ind_address_structured->>'postal_code'` (fb `ind_address_index`) |
| `address.region` | `ind_address_structured->>'region'` (fb `ind_address_region`) |
| `address.street` | `ind_address_structured->>'street'` (fb `ind_address_street`) |
| `bank_account` | `bank_account` |
| `bank_code` | `bank_code` |
| `bank_name` | `bank_name` |
| `birth_date` | `ind_birth_date` |
| `email` | `email` |
| `full_name` | `ind_full_name` |
| `full_name_short` | **computed** в resolver (Иванов И. И.) из `ind_full_name` |
| `passport_issued_by` | `ind_passport_issued_by` |
| `passport_issued_date` | `ind_passport_issued_date` |
| `passport_number` | `ind_passport_number` |
| `passport_number_full` | **computed** `ind_passport_series || ' ' || ind_passport_number` |
| `passport_series` | `ind_passport_series` |
| `passport_valid_until` | `ind_passport_valid_until` |
| `personal_number` | `ind_personal_number` |
| `phone` | `phone` |

### 2.2. `customer.leg.*` → `client_legal_details` (where `client_type='legal'`)

| token suffix | column |
|---|---|
| `acts_on_basis` | `leg_acts_on_basis` |
| `address.*` (11 шт.) | `leg_address_structured->>'<key>'` (fb `leg_address`) |
| `bank_account` / `bank_code` / `bank_name` | `bank_*` |
| `director_full_name` | `leg_director_name` |
| `director_position` | `leg_director_position` |
| `director_short_name` | **computed** initials из `leg_director_name` |
| `email` | `email` |
| `name` | `leg_name` |
| `org_form` | `leg_org_form` |
| `phone` | `phone` |
| `short_name` | **computed** `leg_org_form + " " + leg_name` (или fallback `leg_name`) |
| `unp` | `leg_unp` |

### 2.3. `customer.ent.*` → `client_legal_details` (where `client_type='entrepreneur'`)

Для ИП «директор» = сам ИП. Resolver применяет fallback на ent_*:

| token suffix | column / fallback |
|---|---|
| `acts_on_basis` | `ent_acts_on_basis` |
| `address.*` (11 шт.) | `ent_address_structured->>'<key>'` (fb `ent_address`) |
| `bank_account` / `bank_code` / `bank_name` | `bank_*` |
| `director_acts_on_basis` | **fallback** `ent_acts_on_basis` |
| `director_full_name` | **fallback** `ent_name` |
| `director_position` | **константа** `«Индивидуальный предприниматель»` |
| `director_short_name` | **computed** initials из `ent_name` |
| `email` | `email` |
| `name` | `ent_name` (без кавычек, формат «ИП Федорчук Сергей Валерьевич») |
| `phone` | `phone` |
| `short_name` | **computed** из `ent_name` (initials + ИП) |
| `unp` | `ent_unp` |

### 2.4. `executor.leg.*` → `executors`

| token suffix | column |
|---|---|
| `acts_on_basis` | `acts_on_basis` |
| `address.*` (11 шт.) | `legal_address_structured->>'<key>'` (fb `legal_address`) |
| `bank_account` / `bank_code` / `bank_name` | `bank_*` |
| `director_full_name` | `director_full_name` |
| `director_position` | `director_position` |
| `director_short_name` | `director_short_name` (есть в схеме) |
| `email` | `email` |
| `name` | `full_name` |
| `org_form` | ⚠️ **GAP**: колонки нет. Resolver вернёт пустую строку. См. §4. |
| `phone` | `phone` |
| `short_name` | `short_name` |
| `unp` | `unp` |

---

## 3. План INSERT (детерминированный mapping)

98 строк, отсортированных стабильно по `(ns_order, token_key)`:

```
ord  ns            token_key                             →  FLD-XXXXXX
1    customer.ind  customer.ind.address.apartment             FLD-000273
2    customer.ind  customer.ind.address.building              FLD-000274
...
26   customer.ind  customer.ind.phone                         FLD-000298
27   customer.leg  customer.leg.acts_on_basis                 FLD-000299
...
50   customer.leg  customer.leg.unp                           FLD-000322
51   customer.ent  customer.ent.acts_on_basis                 FLD-000323
...
74   customer.ent  customer.ent.unp                           FLD-000346
75   executor.leg  executor.leg.acts_on_basis                 FLD-000347
...
98   executor.leg  executor.leg.unp                           FLD-000370
```

Полная таблица 98×4 (`token_key`, `dtr.id`, `fields_registry.key`, `public_id`) фиксируется в момент execute и пишется отдельным артефактом `placeholders_fld_backfill_execute_B_98_2026_05_13.md`.

`fields_registry` columns на INSERT:
- `key` = `token_key` (1:1)
- `label` = `document_token_registry.ui_label`
- `data_type` = `dtr.data_type`
- `entity_type`:
  - `customer.ind.*` → `customer_individual`
  - `customer.leg.*` → `customer_legal`
  - `customer.ent.*` → `customer_entrepreneur`
  - `executor.leg.*` → `executor_legal`
- `options.batch_id` = `fld_backfill_B_98_2026_05_13` (для rollback)
- `public_id` — генерируется триггером `trg_fields_registry_public_id`, перед миграцией `SELECT setval('public_id_sequences', 272)` для `entity_type='field'` (если sequence ниже).

UPDATE `document_token_registry.field_id` = по `id` ↔ `fields_registry.id` через `key=token_key`. Условие `WHERE field_id IS NULL` (идемпотентность).

`conflicts=0` подтверждён: `SELECT count(*) FROM fields_registry WHERE key IN (<98 keys>)` = 0.

---

## 4. Известные суб-гэпы внутри scope (требуют решения ДО execute)

Эти токены войдут в 98, но их resolver требует уточнения:

| токен | гэп | предлагаемое поведение |
|---|---|---|
| `executor.leg.org_form` | нет колонки в `executors` | вернуть `""` (пустая строка); пометить в каталоге «не заполняется — добавьте поле в карточку исполнителя»; либо **исключить из scope → 97** |
| `customer.ind.full_name_short` | computed | initials по правилу `«Фамилия И. О.»` |
| `customer.leg.director_short_name` | computed | initials из `leg_director_name` |
| `customer.leg.short_name` | computed | `leg_org_form + " " + leg_name` |
| `customer.ent.director_*` (3) | у ИП нет «директора» | fallback на `ent_*` + константа должности |
| `customer.ent.short_name` / `director_short_name` | computed | initials из `ent_name` |

**Решение требуется:** оставляем `executor.leg.org_form` в scope с пустым значением, или режем до 97?

---

## 5. Rollback (готов перед execute)

```sql
-- 1) сбросить field_id на 98 dtr
UPDATE document_token_registry
SET field_id = NULL
WHERE field_id IN (
  SELECT id FROM fields_registry
  WHERE options->>'batch_id' = 'fld_backfill_B_98_2026_05_13'
);

-- 2) удалить 98 fields_registry
DELETE FROM fields_registry
WHERE options->>'batch_id' = 'fld_backfill_B_98_2026_05_13';

-- 3) aliases не создавались → пусто
```

---

## 6. Resolver — расширение (только в этом execute)

`supabase/functions/_shared/document-render.ts`:
- Добавить namespaces: `customer.ind.*`, `customer.leg.*`, `customer.ent.*` (источник: `client_legal_details` по `client_type` + `is_default` или явному выбору на сделке).
- Расширить `executor.leg.*` (источник: `executors`, по выбранному `executor_id` сделки / `is_default=true`).
- Computed helpers: `initials(fullName)`, `passportFull(series, number)`, `entShortName(entName)`.
- **НЕ трогать** `executor.ind.*` / `executor.ent.*` — не резолвятся, нет SOT.

Покрытие отображается в Resolver test fixture (см. §7 Smoke).

---

## 7. Smoke (после execute, не сейчас)

3 фикстуры × шаблон с **только `{{field:FLD-XXXXXX}}`**:

1. ФЛ-заказчик + исполнитель-ЮЛ → проверка `customer.ind.*` + `executor.leg.*`.
2. ЮЛ-заказчик + исполнитель-ЮЛ → проверка `customer.leg.*` + `executor.leg.*`.
3. ИП-заказчик («ИП Федорчук Сергей Валерьевич», без кавычек) + исполнитель-ЮЛ → проверка `customer.ent.*` + `executor.leg.*`.

DoD: `unresolved_count = 0`, в результирующем DOCX/PDF нет `{{...}}`. `executor.ind.*` / `executor.ent.*` НЕ участвуют в smoke и явно отмечены как `postponed`.

---

## 8. Postponed → backlog

Создаётся отдельный backlog-документ: `.lovable/backlog/executor_requisites_schema_expansion.md`.

Содержание (sprint brief):
- модель исполнителя: может ли быть ФЛ / ЮЛ / ИП;
- где это заполняется в UI (карточка исполнителя в админке);
- какие поля нужны для ФЛ (паспорт, ФИО, дата рождения, личный номер, адрес);
- какие поля нужны для ИП (УНП, имя «ИП ...», адрес, расчётный счёт, основание);
- хранение `subject_type` исполнителя (enum: `legal | individual | entrepreneur`);
- fallback на текущую flat-схему `executors` до миграции;
- только после этого спринта — backfill FLD для 50 отложенных токенов.

До тех пор в UI каталоге `executor.ind.*` и `executor.ent.*`:
- НЕ показываются как полноценные плейсхолдеры с FLD-ID;
- либо скрываются, либо отображаются в технической секции «Нет источника данных / not implemented» без кнопки копирования.

---

## 9. STOP

**Execute не запускается.** Жду подтверждения по:
1. ✅/❌ approve mapping 98 → `FLD-000273..FLD-000370`.
2. Решение по `executor.leg.org_form`: оставить с пустым значением (scope=98) или исключить (scope=97)?
3. ✅/❌ approve resolver-плана из §6 (включая fallback для ИП).
4. ✅/❌ approve backlog «Executor requisites schema expansion».

После approve следующий шаг — миграция backfill (98 INSERT + 98 UPDATE) с обязательным rollback-SQL рядом, затем правка `_shared/document-render.ts`, затем UI-обновление каталога (FLD-first + postponed-секция для `executor.ind/ent`), затем smoke на 3 фикстурах.
