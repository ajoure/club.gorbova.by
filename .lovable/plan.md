да, согласен, с учетом правок:

1. **Не использовать** `document_token_aliases` **как self-alias без необходимости.**  
Если `document_token_registry.token_key = fields_registry.key` и `field_id` проставлен, self-alias:
  &nbsp;
  ```text
  customer.ind.full_name → customer.ind.full_name
  ```
  технически избыточен.  
  Допустимо добавить только если текущий resolver реально читает `document_token_aliases` для legacy `{{token_key}}`.  
  В dry-run нужно отдельно доказать: **зачем нужны 148 self-alias и где они используются**. Если не используются — не создавать.
2. **Главное — не alias, а resolver coverage.**  
Execute запрещён, пока dry-run не покажет для каждого token_key:
  &nbsp;
  ```text
  token_key → SOT table/column/jsonPath → тестовое значение → expected output
  ```
  Иначе можно создать 148 FLD, которые снова будут пустыми.
3. **Формулировку про** `canonical-template-validate` **уточнить.**  
Старые `{{customer.ind.*}}` должны быть запрещены **для новых шаблонов**, но не должны ломать уже существующие legacy-шаблоны, если они где-то реально используются.  
В DoD добавить:
4. **Не использовать** `canonical-document-generate-strict` **для smoke, если эти поля резолвятся только в** `_shared/document-render.ts`**.**  
В плане указано smoke через strict. Нужно сначала подтвердить, что strict resolver после backfill действительно умеет:
  &nbsp;
  ```text
  field_id → token_key → typed resolver
  ```
  Если typed resolver реализуется только в non-strict `_shared/document-render.ts`, smoke через strict будет ложным или провалится.  
  Правильно:
  - либо расширить оба resolver-пути;
  - либо в DoD явно указать, какой pipeline является production для этих шаблонов.
5. **SOT должен быть зафиксирован до названий** `customer.ind.*`**.**  
Сейчас есть риск, что token_key уже создан как `customer.ind.*`, а category как `customer.individual`. Это нормально, но mapping должен быть железный:
  &nbsp;
  ```text
  customer.ind.* → individual
  customer.leg.* → legal_entity
  customer.ent.* → entrepreneur
  ```
  Без автогенерации по строкам.
6. `fields_registry.data_type` **брать из реальной семантики, а не** `COALESCE(data_type,'string')` **вслепую.**  
Для дат, чисел, money, email, phone, address-json:
  &nbsp;
  ```text
  birth_date → date
  passport_issue_date → date
  passport_valid_until → date
  amount/account? → string, не number
  unp → string
  ```
  В dry-run таблице добавить колонку `proposed_data_type`.
7. **Адресные части должны иметь отдельный resolver, не только** `address.full`**.**  
В DoD добавить проверку:
  &nbsp;
  ```text
  customer.leg.address.street
  customer.leg.address.house
  customer.leg.address.apartment
  customer.leg.address.postal_code
  executor.leg.address.full
  ```
  Иначе FLD появятся, но часть адресов может остаться пустой.
8. **ИП без кавычек добавить в smoke именно для typed FLD.**  
Проверить:
  &nbsp;
  ```text
  customer.ent.name → ИП Федорчук Сергей Валерьевич
  executor.ent.name → ИП Федорчук Сергей Валерьевич
  ```
  Запрещённый результат:
9. **Runtime-бейдж после backfill не должен исчезнуть “везде”.**  
Он должен исчезнуть только у 148 typed customer/executor.  
Для оставшихся runtime/technical — оставить. В verify указать точный остаток:
10. **Rollback должен учитывать FK/constraints.**  
Порядок rollback правильный, но добавить pre-check:

```sql
SELECT COUNT(*)
FROM document_token_registry
WHERE field_id IN (SELECT id FROM fields_registry WHERE options->>'batch_id'=...)
```

И только потом обнулять.

11. **Audit dry-run не должен писать в БД, если discovery заявлен read-only.**  
Если dry-run пишет `audit_logs`, это уже write.  
Либо:

- dry-run полностью read-only и только файл proof;
- либо явно разрешить audit write как исключение.  
Я бы оставил audit только на execute/verify, а dry-run — proof-файл без записи в БД.

12. **Перед execute добавить STOP по count mismatch.**  
Если найдено не 148, а 147/149/152 — execute не запускать. Только новый dry-run и новое подтверждение.

Итоговая команда для него:

```text
План принимаю после внесения правок выше. Главное: сначала dry-run с фактическим SOT, data_type, stable mapping, resolver coverage и smoke strategy. Execute не запускать, пока dry-run не докажет, что 148 новых FLD будут реально резолвиться, а не просто появятся в каталоге.

План: канонизация runtime customer/executor плейсхолдеров в FLD-ID-first (усиленная версия)
```

## 0. Ключевая правка по сравнению с черновиком

Направление верное (backfill FLD-ID + расширение резолвера), но без следующих усилений патч создаст **второй слой мёртвых FLD-полей**. Поэтому:

1. Alias canonical — **typed token_key**, а не universal `customer.*/executor.*`.
2. Все 148 mapping-строк фиксируются в proof **до** execute; миграция читает их из stable mapping, а не из `row_number()`.
3. Перед execute обязательно перечитать `max(public_id)` и `entity_type`-constraint.
4. Резолвер пишется только после фиксации фактического SOT для customer/executor реквизитов.
5. Rollback и audit с `batch_id` обязательны.

---

## 1. Прямые ответы на 7 вопросов

**1.1. Работают ли 152 typed-токена в новой DOCX pipeline?**  
**Нет.** В `_shared/document-render.ts` нет ни одной ветки для `customer.ind.*`, `customer.leg.*`, `customer.ent.*`, `executor.ind.*/leg.*/ent.*`. Резолвер знает только полиморфные `customer.*` / `executor.*` (35 FLD-000103..FLD-000218). Все typed-токены сейчас возвращают пустую строку, а `canonical-template-validate` отбракует их по regex `^\{\{field:FLD-[0-9]+\}\}$`. То есть они **dead-on-arrival**.

**1.2. Зачем v4 показал их «рабочими»?**  
v4 снимал только UI-фильтр в `PlaceholdersCatalogTab` — не знал о resolver coverage. Это и есть «временный fix видимости», который надо доканонизировать.

**1.3. Какие токены без `field_id` сейчас?**  
152 строки в `document_token_registry` (archived_at IS NULL, field_id IS NULL):  
`customer.individual`=26, `customer.legal`=24, `customer.entrepreneur`=24, `executor.individual`=26, `executor.legal`=24, `executor.entrepreneur`=24, `customer`=1, `executor`=1, `executor.signer`=4. Все имеют `source_type='system'`, `resolver_key = token_key`.

В патч войдут **только 148** (typed × 6 групп). Universal `customer`/`executor` (1+1) и `executor.signer` (4) — out of scope.

**1.4. Что мешает создать `fields_registry` записи?**  
Технически — ничего, но перед execute обязательно:  
(а) перечитать `SELECT max(public_id) FROM fields_registry WHERE public_id LIKE 'FLD-%'` (на момент discovery — FLD-000272, но к execute может вырасти);  
(б) перечитать ограничения: `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='fields_registry'::regclass;` — если `entity_type` имеет CHECK/enum, новые значения `customer_individual`/`customer_legal`/… **вводить нельзя** без отдельной миграции constraint. Fallback-стратегия: использовать существующие `entity_type ∈ {customer, executor}` + хранить дискриминатор в `options.subject_type ∈ {individual, legal_entity, entrepreneur}` и `options.typed_namespace`. Выбор делается **в dry-run** по фактическому результату проверки constraint, фиксируется в proof, и только тогда execute.

**1.5. Конфликты с существующими FLD?**  
Проверено: `fields_registry.key` не содержит `customer.ind.*` / `customer.leg.*` / `customer.ent.*` / `executor.<ns>.*`. Существующие 35 customer/executor FLD используют ключи `customer.name`, `customer.address` и т.п. — это **другая семантика** (полиморфия по типу плательщика), не пересекается с typed. UNIQUE на `fields_registry.key` страхует от случайных дублей в самой миграции.

**1.6. Какой резолвер обрабатывает `{{field:FLD-XXXXXX}}` после backfill?**  
`_shared/document-render.ts` собирает `resolved` по `registryByKey[token_key]`. Цепочка: `{{field:FLD-...}} → fields_registry.public_id → document_token_registry.field_id → token_key → resolverValues[token_key]`. `resolverValues` для typed ключей сейчас не заполняется — поэтому backfill **без** расширения резолвера запрещён.

**1.7. Нужно ли расширять резолвер?**  
**Да, обязательно и одним патчем** с backfill — иначе создаём «полноценные FLD-ID», которые подставляются пустыми строками.

---

## 2. Семантика alias — критическая правка

В `document_token_aliases.alias_token` хранится **чистый token_key без фигурных скобок**:

```
alias_token = "customer.ind.full_name"
alias_token = "executor.leg.name"
```

НЕ `{{customer.ind.full_name}}`.

**Canonical для typed-токенов = их собственный typed token_key** (self-alias):

```
alias_token         | canonical_token_key
customer.ind.full_name | customer.ind.full_name
executor.leg.name      | executor.leg.name
```

**Запрещено** автоматически вести alias на universal `customer.*/executor.*` FLD, потому что:

- `customer.ind.full_name ≠ customer.name`;
- `customer.leg.name ≠ customer.name`;
- `customer.ent.name ≠ customer.name`;
- universal `customer.name` — динамически выбирает по `client_type`, а typed-токен жёстко берёт свой источник (например, `customer.leg.name` всегда читает `leg_name`, даже если плательщик помечен как ИП).

Self-alias нужен только как явная запись «этот token_key известен registry, не делай unmapped warning», а реальный резолв идёт через расширенный резолвер.

---

## 3. Источник данных для typed-токенов (обязательная фиксация ДО кода)

В прошлых спринтах появлялись разные SOT: `client_legal_details`, `legal_entities_requisites`, `individual_requisites`, `executors`. Прежде чем писать резолвер, в dry-run артефакт зафиксировать:

### 3.1. Customer SOT discovery

Для каждого typed namespace выполнить:

- список колонок реально используемых таблиц (`client_legal_details`, `legal_entities_requisites`, `individual_requisites`, `entrepreneurs_requisites` — если существуют);
- какая таблица является **primary SOT** для каждого `subject_type`;
- какая — legacy fallback;
- где сейчас пишет UI реквизитов (см. `src/pages/settings/UserRequisites.tsx`, `OrganizationDetailsForm`, `IndividualDetailsForm`).

### 3.2. Executor SOT discovery

- какие колонки/JSONB есть в `executors`;
- как определяется `subject_type` исполнителя (колонка/derived);
- что делать, если у executor нет typed-структуры, а заполнены только универсальные поля — fallback на универсальные FLD-* через explicit branch, **не** через alias.

### 3.3. Сверка namespace

В discovery — `category = customer.individual / customer.legal / customer.entrepreneur` (полные слова).  
В черновике плана употреблялся короткий вариант `customer.ind / customer.leg / customer.ent` — это **наследие token_key**, а не category. Зафиксировать в dry-run proof фактическое соответствие:

```
category             ↔ token_key prefix
customer.individual  ↔ customer.ind.*
customer.legal       ↔ customer.leg.*
customer.entrepreneur ↔ customer.ent.*
executor.individual  ↔ executor.ind.*
executor.legal       ↔ executor.leg.*
executor.entrepreneur ↔ executor.ent.*
```

И только после фиксации — mapping `token_key suffix → колонка SOT`.

---

## 4. Dry-run (ОБЯЗАТЕЛЬНО до execute)

Edge function `document-tokens-fld-backfill?mode=dry_run` (новая, `verify_jwt=true` + super_admin guard, без service_role bypass).

### 4.1. Что выдаёт

Артефакт `.lovable/proofs/placeholders_fld_backfill_dryrun_2026_05_13.md`:

1. **batch_id** (стабильный): `PLACEHOLDERS-FLD-BACKFILL-2026-05-13`.
2. **Снимок `max(public_id)**` на момент dry-run.
3. **Результат проверки constraint** на `fields_registry.entity_type` (CHECK/enum/нет) + выбранная стратегия (расширить enum vs использовать existing `customer/executor` + `options.subject_type`).
4. **Стабильная mapping-таблица** (148 строк, фиксируется как канон):

```
document_token_registry.id | token_key | category | proposed_fields_registry.key | proposed_public_id | proposed_entity_type | options.subject_type | options.typed_namespace | resolver_path_planned
```

Порядок mapping фиксируется не `row_number() OVER (ORDER BY category, token_key)` без сохранения, а **именно из этого proof**: execute читает таблицу с `document_token_registry.id` и присваивает заранее перечисленные public_id.

5. **Discovered SOT** (раздел 3) — фактические таблицы/колонки.
6. **Resolver coverage plan** — кусок псевдокода с branches.
7. **Counts**:
  ```
   found_typed_runtime_without_field_id: 148
   will_create_fields_registry_rows: 148
   will_update_document_token_registry_field_id: 148
   will_create_aliases: 148 (self-alias на собственный token_key)
   conflicts: 0
   skipped_out_of_scope: customer=1, executor=1, executor.signer=4
   public_id_range: FLD-XXXXXX .. FLD-YYYYYY (по факту max+1)
  ```
8. **Rollback SQL** (раздел 6).

### 4.2. STOP

Execute не запускается, пока dry-run не покажет:

- точный список 148 mapping-строк с конкретными public_id;
- 0 конфликтов;
- актуальный диапазон FLD;
- понятный resolver coverage по фактическому SOT;
- готовый rollback.

---

## 5. Execute (после подтверждения; читает фиксированный mapping)

### 5.1. Миграция БД

Одна транзакция. Mapping приходит как `(document_token_registry_id, fields_registry_key, public_id, entity_type, options_jsonb)` массивом из dry-run proof (фронт-обвязка миграции либо seeded VALUES, либо temp staging table).

```text
BEGIN;

-- 1) INSERT 148 rows в fields_registry с заранее назначенными public_id
INSERT INTO fields_registry(entity_type, key, label, data_type, public_id, description, options)
VALUES
  (<from mapping row 1>),
  ...
  (<from mapping row 148>);

-- 2) Проставить field_id строго по document_token_registry.id ↔ fields_registry.key
UPDATE document_token_registry dtr
SET field_id = fr.id, updated_at = now()
FROM fields_registry fr
WHERE dtr.id IN (<148 ids from mapping>)
  AND dtr.token_key = fr.key
  AND dtr.field_id IS NULL;

-- 3) Self-alias (token_key без скобок)
INSERT INTO document_token_aliases(alias_token, canonical_token_key, notes, metadata)
SELECT dtr.token_key, dtr.token_key,
  'Sprint 11.1 typed FLD backfill self-alias',
  jsonb_build_object('batch_id','PLACEHOLDERS-FLD-BACKFILL-2026-05-13',
                     'source','sprint11_1_fld_backfill_2026_05_13')
FROM document_token_registry dtr
WHERE dtr.id IN (<148 ids>);

-- Sanity-check
SELECT
  (SELECT COUNT(*) FROM fields_registry WHERE options->>'batch_id'='PLACEHOLDERS-FLD-BACKFILL-2026-05-13') AS fr_inserted,
  (SELECT COUNT(*) FROM document_token_registry WHERE id IN (<148>) AND field_id IS NOT NULL) AS dtr_linked,
  (SELECT COUNT(*) FROM document_token_aliases WHERE metadata->>'batch_id'='PLACEHOLDERS-FLD-BACKFILL-2026-05-13') AS aliases_inserted;
-- expected: 148 / 148 / 148; иначе ROLLBACK
```

Все 148 строк в `fields_registry` получают `options.batch_id = 'PLACEHOLDERS-FLD-BACKFILL-2026-05-13'`. Это якорь для rollback.

### 5.2. Расширение резолвера

В `_shared/document-render.ts` добавить блок «8.5 typed customer/executor resolution» **по фактическому SOT из dry-run §3** (не «из `client_legal_details`» вслепую). Минимум:

- branch для `customer.<ns>.*` — читает из primary SOT (например, `client_legal_details` columns `ind_*/leg_*/ent_*` ИЛИ соответствующих requisites-таблиц — фиксируется в proof);
- branch для `executor.<ns>.*` — читает из `executors` (колонки/JSONB по проф. discovery);
- `<ns>.address.*` — через существующий `formatStructuredAddress`;
- fallback: если у executor нет typed-структуры — explicit branch на универсальные значения (с пометкой `source_trace.source = 'executor.universal_fallback'`), **не** через alias.

`sourceFor()` расширить ветками `customer.<ns>.*` / `executor.<ns>.*` с указанием фактического источника.

### 5.3. UI каталог

После миграции 148 строк автоматически получат `field_id`/`public_id` → существующий рендер `PlaceholdersCatalogTab` покажет `FLD-XXXXXX` вместо бейджа `runtime`, и копирование начнёт вставлять `{{field:FLD-XXXXXX}}`.

Доп. правка: серым вторым текстом показать `legacy alias: customer.ind.full_name` для прозрачности (это не плейсхолдер для копирования).

### 5.4. canonical-template-validate

Не меняется. 148 новых `{{field:FLD-XXXXXX}}` начинают проходить regex. Старые `{{customer.ind.*}}` остаются недопустимыми в новых шаблонах — это правильно; legacy DOCX покрывает alias-слой на этапе рендера, а не валидации.

### 5.5. Smoke DOCX (строгий FLD-first)

Шаблон `_smoke_sprint11_1_typed_fld.docx` содержит **только** `{{field:FLD-XXXXXX}}`. Запрещены: `{{customer.ind.*}}`, `{{customer.leg.*}}`, `{{customer.ent.*}}`, `{{executor.<ns>.*}}` (любой не-FLD формат) — smoke специально валидирует, что новые типизированные поля **не нужны** в legacy-формате.

Покрытие: 18 плейсхолдеров (по 3 из каждой из 6 групп) × 3 fixtures (`subject_type ∈ {individual, legal_entity, entrepreneur}`) → 3 рендера через `canonical-document-generate-strict`. DoD: `unresolved_count = 0`, в выходе нет `{{...}}`, source_trace показывает фактический SOT для каждого FLD-ID.

---

## 6. Rollback план (включается в dry-run артефакт)

```text
BEGIN;
-- 1) Снять field_id с document_token_registry
UPDATE document_token_registry
SET field_id = NULL, updated_at = now()
WHERE field_id IN (
  SELECT id FROM fields_registry WHERE options->>'batch_id'='PLACEHOLDERS-FLD-BACKFILL-2026-05-13'
);

-- 2) Удалить aliases
DELETE FROM document_token_aliases
WHERE metadata->>'batch_id' = 'PLACEHOLDERS-FLD-BACKFILL-2026-05-13';

-- 3) Удалить fields_registry rows
DELETE FROM fields_registry
WHERE options->>'batch_id' = 'PLACEHOLDERS-FLD-BACKFILL-2026-05-13';

-- audit rows НЕ удаляем (история должна остаться), но они обязаны содержать batch_id
COMMIT;
```

После rollback состояние ровно как до execute (resolver patch откатывается отдельно через revert коммита).

---

## 7. Audit

### Dry-run

```
action     = document_tokens.field_id_backfill_dryrun
actor_type = system
actor_label = migration
meta.batch_id = PLACEHOLDERS-FLD-BACKFILL-2026-05-13
meta.found_count = 148
meta.max_public_id_before = <snapshot>
meta.entity_type_constraint = <result>
meta.sot_discovered = { customer: ..., executor: ... }
```

### Execute

```
action     = document_tokens.field_id_backfill_execute
actor_type = system
actor_label = migration
meta.batch_id = PLACEHOLDERS-FLD-BACKFILL-2026-05-13
meta.fr_inserted = 148
meta.dtr_linked = 148
meta.aliases_inserted = 148
meta.public_id_range = FLD-XXXXXX..FLD-YYYYYY
```

### Verify

```
action     = document_tokens.field_id_backfill_verify
actor_type = system
meta.batch_id = PLACEHOLDERS-FLD-BACKFILL-2026-05-13
meta.smoke_fixtures = [individual, legal_entity, entrepreneur]
meta.unresolved_total = 0
meta.runtime_remaining_in_catalog = 6  // universal customer/executor + signer
```

---

## 8. STOP-guards (не трогать)

`payments_v2`, `orders_v2` schema, `allocate_document_number`, document scenarios storage, Contact Center, морфология, production-шаблоны, существующие 106 FLD-токенов с `field_id IS NOT NULL`, universal `customer`/`executor` (out of scope), `executor.signer` (out of scope, override-семантика).

---

## 9. Финальный DoD

- 148 typed customer/executor токенов имеют `field_id`.
- Каждый получил `FLD-XXXXXX` из актуального диапазона `max(public_id)+1` (не хардкод).
- Все 148 строк промечены `options.batch_id = 'PLACEHOLDERS-FLD-BACKFILL-2026-05-13'`.
- `document_token_aliases` содержит 148 self-alias записей (token_key без скобок; canonical = тот же token_key).
- Ни одного alias-ряда, ведущего typed-токен на universal `customer.*/executor.*` FLD.
- Резолвер обрабатывает typed namespaces из фактического SOT, зафиксированного в dry-run proof.
- В каталоге для этих 148 токенов исчез бейдж `runtime`.
- Каталог показывает `FLD-XXXXXX`, копирование вставляет `{{field:FLD-XXXXXX}}`.
- Бейдж `runtime` остаётся только для действительно runtime/technical токенов (universal customer/executor + signer + system).
- Smoke DOCX содержит только `{{field:FLD-XXXXXX}}` (regex-проверка), 3 fixtures, `unresolved_count = 0`, `{{...}}` в выходе отсутствует.
- `canonical-template-validate` принимает новые плейсхолдеры; legacy `{{customer.ind.*}}` корректно работают в старых DOCX через alias-слой.
- tsc + deno check clean.
- Audit dryrun/execute/verify с `batch_id`.
- Rollback SQL приложен к dry-run артефакту и проверен на staging-копии.
- Memory: дополнить `mem://architecture/documents/field-id-first-canon` записью о Sprint 11.1 + ссылкой на proof.

---

## 10. Порядок исполнения

1. **Dry-run edge function** → артефакт `.lovable/proofs/placeholders_fld_backfill_dryrun_2026_05_13.md` с: фактическим SOT, constraint-результатом, актуальным max(public_id), стабильным mapping на 148 строк, rollback SQL. **STOP.**
2. Жду подтверждения «execute».
3. Migration (5.1) — `INSERT ... VALUES` по фиксированному mapping, не по `row_number()`. types.ts регенерится автоматически.
4. Resolver patch (5.2) + alias INSERT — в том же коммите, что и миграция (атомарно).
5. UI правка `PlaceholdersCatalogTab` — показ `legacy alias:` второй строкой.
6. Smoke DOCX (5.5) — 3 fixtures, артефакт `.lovable/proofs/placeholders_fld_backfill_smoke_2026_05_13.md`.
7. Verify audit + memory update + closing report `.lovable/proofs/placeholders_fld_backfill_execute_2026_05_13.md`.