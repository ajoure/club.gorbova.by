# Dry-run B-97 — Placeholders FLD-ID backfill

Дата: 2026-05-13
Status: **STOP перед execute** (по согласованию итог — execute B-97).
Replaces: `.lovable/proofs/placeholders_fld_backfill_dryrun_B_98_2026_05_13.md`.

## 1. Скоуп

Всего typed customer/executor токенов в системе: **148** (`customer.ind/leg/ent.*` + `executor.ind/leg/ent.*`).

Из них:
- покрыто SOT и канонизируется **сейчас** = **97**;
- отложено (no SOT) = **51**.

| Группа | Категория | Token-токенов без `field_id` | Войдёт в execute | Отложено |
|---|---|---:|---:|---:|
| Заказчик ФЛ  | `customer.individual`    | 26 | **26** | 0 |
| Заказчик ЮЛ  | `customer.legal`         | 24 | **24** | 0 |
| Заказчик ИП  | `customer.entrepreneur`  | 24 | **24** | 0 |
| Исполнитель ЮЛ | `executor.legal`       | 24 | **23** | 1 (`executor.leg.org_form`) |
| Исполнитель ФЛ | `executor.individual` | 26 | 0 | **26** |
| Исполнитель ИП | `executor.entrepreneur` | 24 | 0 | **24** |
| **Итого** |  | **148** | **97** | **51** |

### Postponed-список

- `executor.leg.org_form` — нет колонки/поля в `executors`, нет однозначного computed; включать = создать мёртвый FLD. **Отдельный мини-патч** позднее: либо ALTER `executors` с `org_form`, либо доказанный computed из `short_name/full_name` — только после собственного dry-run+proof.
- `executor.ind.*` (26) и `executor.ent.*` (24) — нет SOT-структуры в `executors` (плоская схема для ЮЛ). Отдельный спринт «Executor requisites schema expansion».

**Причина исключения** — главный принцип патча: **не создавать мёртвые FLD**.

## 2. Текущее состояние реестра

```
SELECT MAX(public_id), COUNT(*) FILTER (WHERE public_id LIKE 'FLD-%') FROM fields_registry;
-- max=FLD-000272  count=269
```

- `current_max_public_id` = **FLD-000272**
- `public_id_range` для execute = **FLD-000273 .. FLD-000369** (97 шт.)
- `public_id` присваивается триггером `trg_fields_registry_public_id` (см. Sprint 11 discovery proof). Ручной INSERT в `public_id` не делается.
- `fields_registry.entity_type` — `text` без CHECK/enum → новые значения `customer_individual`, `customer_legal`, `customer_entrepreneur`, `executor_legal` принимаются без отдельной миграции.
- `fields_registry.key` — глобально UNIQUE → дубликаты заблокированы на уровне БД.

**Перед execute** скрипт миграции ещё раз перечитывает `max(public_id)`; если он изменился — STOP, новый dry-run.

## 3. Mapping (фиксированный, 97 строк)

Правила:

- `fields_registry.entity_type = REPLACE(SPLIT_PART(token_key, '.', 1) || '_' || SPLIT_PART(token_key, '.', 2), '.', '_')`
  - `customer.ind.*` → `customer_individual`
  - `customer.leg.*` → `customer_legal`
  - `customer.ent.*` → `customer_entrepreneur`
  - `executor.leg.*` → `executor_legal`
- `fields_registry.key = token_key` (полный namespaced ключ, например `customer.ind.full_name`)
- `fields_registry.label = document_token_registry.ui_label`
- `fields_registry.data_type = 'text'` (все 97 — string-like; числовые/датовые суффиксы внутри scope отсутствуют)
- `fields_registry.options = jsonb_build_object('batch_id', 'placeholders_fld_backfill_B97_2026_05_13', 'source', 'typed_customer_executor_backfill', 'scope', 'B-97')`
- `document_token_registry.field_id` ← `fields_registry.id` по `key = token_key`

`will_create_aliases = 0` (резолвер маппит `field_id → token_key` напрямую, self-alias избыточен).

### Поименный список (97)

`customer.individual` (26):
acts_on_basis, address.apartment, address.building, address.city, address.city_district, address.country, address.district, address.full, address.house, address.postal_code, address.region, address.street, bank_account, bank_code, bank_name, birth_date, email, full_name, passport_authority, passport_date, passport_number, passport_personal_number, passport_series, phone, registration_address, short_name

`customer.legal` (24):
acts_on_basis, address.apartment, address.building, address.city, address.city_district, address.country, address.district, address.full, address.house, address.postal_code, address.region, address.street, bank_account, bank_code, bank_name, director_acts_on_basis, director_full_name, director_position, director_short_name, email, name, okpo, phone, unp

`customer.entrepreneur` (24):
acts_on_basis, address.apartment, address.building, address.city, address.city_district, address.country, address.district, address.full, address.house, address.postal_code, address.region, address.street, bank_account, bank_code, bank_name, director_acts_on_basis, director_full_name, director_position, director_short_name, email, name, phone, short_name, unp

`executor.legal` (23, без `org_form`):
acts_on_basis, address.apartment, address.building, address.city, address.city_district, address.country, address.district, address.full, address.house, address.postal_code, address.region, address.street, bank_account, bank_code, bank_name, director_acts_on_basis, director_full_name, director_position, director_short_name, email, name, phone, unp

### Конфликты

```
SELECT key FROM fields_registry WHERE key IN (<97 token_keys>);
-- 0 rows
```

`conflicts = 0`.

## 4. Resolver coverage

Резолвер (`supabase/functions/_shared/document-render.ts`) расширяется **только под 97 FLD**:

- SOT для всех customer.* = `client_legal_details` (колонки `ind_*`, `leg_*`, `ent_*` + JSONB `ind_address_structured`, `leg_address_structured`, `legal_address_structured`).
- SOT для `executor.leg.*` = `executors` (плоские колонки `name`, `unp`, `director_*`, `bank_*`, JSONB `address_structured` или равнозначное; точная карта зафиксирована в B-98 proof, секция 4).
- `executor.leg.org_form` — **не маппится**, не создаётся branch с пустой строкой. Резолвер для него остаётся `unresolved` (попадёт под legacy/runtime лейбл «нет данных» в каталоге, не как рабочий FLD).
- `executor.ind.*` и `executor.ent.*` — без изменений (резолвера нет, остаются postponed).

## 5. UI каталог после execute

- `customer.ind/leg/ent.*` (74) — показываются как полноценные FLD-плейсхолдеры с кнопкой копирования `FLD-XXXXXX`.
- `executor.leg.*` (23) — то же.
- `executor.leg.org_form` — в технической секции «Нет источника данных / not implemented», **без** кнопки копирования FLD.
- `executor.ind.*` (26) и `executor.ent.*` (24) — там же, postponed.

## 6. Rollback (B-97)

```sql
BEGIN;

UPDATE public.document_token_registry
SET field_id = NULL
WHERE field_id IN (
  SELECT id FROM public.fields_registry
  WHERE options->>'batch_id' = 'placeholders_fld_backfill_B97_2026_05_13'
);

DELETE FROM public.fields_registry
WHERE options->>'batch_id' = 'placeholders_fld_backfill_B97_2026_05_13';

COMMIT;
```

(Aliases не создаются → блок удаления `document_token_aliases` не нужен.)

## 7. DoD execute B-97

- 97 строк добавлены в `fields_registry` с `public_id FLD-000273..FLD-000369` и `options.batch_id = 'placeholders_fld_backfill_B97_2026_05_13'`.
- 97 строк `document_token_registry` получили непустой `field_id`.
- `executor.leg.org_form.field_id` = NULL (postponed).
- Резолвер покрывает 97 FLD; smoke 3 fixtures × выбранные FLD: `unresolved_count = 0`, в DOCX нет `{{...}}`, ИП без кавычек, адрес полный корректный.
- `canonical-template-validate` принимает новые `{{field:FLD-XXX}}`.
- `tsc` / `deno check` — clean.
- Audit запись с `batch_id = placeholders_fld_backfill_B97_2026_05_13`.

## 8. Почему 97, а не 148

- 50 executor.ind/ent токенов — нет SOT в `executors`. Создание FLD сейчас = мёртвые поля.
- 1 `executor.leg.org_form` — нет SOT-колонки, нет доказанного computed.
- Это **не ошибка**, это защита: каждый FLD в реестре обязан резолвиться.
- Следующий спринт: «Executor requisites schema expansion» (модель данных исполнителя ФЛ/ИП + отдельный backfill ≤51 токена).

**STOP — execute не запускать без подтверждения пользователя.**
