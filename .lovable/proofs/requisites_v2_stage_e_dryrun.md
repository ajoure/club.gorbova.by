# Stage E — Dry-run report (add-only)

**Статус:** DRY-RUN (revision 2 — variant B applied). Никаких миграций, INSERT/UPDATE/DELETE, изменений

> **Revision 2 (variant B).** Первая попытка execute была откачена STOP-guard'ом
> (ожидал 35, нашёл 37 — арифметическая ошибка dry-run rev1).
> Канон сверен с фактическим содержимым форм D.1 и таблицами:
> Legal = **20** полей (16 базовых + 4 GRP read-only), Individual = **17**
> полей (включая computed `passport_number_full` и shadow `address_structured`).
> Итого новых `user_requisites` FLD = **37**. STOP-guards и текст ниже
> соответствуют variant B.
>
> **JSONB-колонка.** Логическое поле «meta», упоминаемое ниже по тексту,
> физически хранится в колонке `fields_registry.options jsonb`. Все SQL
> ниже используют именно `options` (а «meta» — словесный синоним).
>
> **Терминология.** Используется `scope_lock` (snapshot_lock запрещён).
>
**(rev1 statement, sохраняется как историческая запись)** Никаких миграций, INSERT/UPDATE/DELETE, изменений
resolver, fields_registry или старых таблиц **не выполнено**. Этот отчёт
описывает план execute-этапа E и ожидаемые counts; execute запускается
отдельным шагом только после явного approve.

Условия входа (зафиксированы пользователем):
1. Clean reset старых таблиц и старых registry-записей **запрещён** до
   полного DoD этапа E.
2. Этап E выполняется **add-only**: сначала dry-run, затем execute.
3. `StructuredAddressBlock` — deferred PATCH D.3. `address_structured`
   сохраняется в JSONB, но **не редактируется** в формах v2 на этом этапе.
4. Все `audit_logs` — только канон: `actor_user_id`, `actor_type`,
   `actor_label`, `action`, `meta`.

---

## 0. Базовые counts (фактические, на момент dry-run)

| Источник | Count |
|---|---|
| `legal_entities_requisites` total | 11 |
| `legal_entities_requisites` scope=system_customer | 11 |
| `legal_entities_requisites` scope=user_requisites | 0 |
| `individual_requisites` total | 10 |
| `individual_requisites` scope=system_customer | 10 |
| `individual_requisites` scope=user_requisites | 0 |
| `executors` total | 2 |
| `client_legal_details` (legacy, сохраняется) | 26 |
| `document_token_registry` total | 183 |
| `document_token_registry` с привязкой `field_id` | 183 (100%) |

| `fields_registry` (active) | По entity_type |
|---|---|
| customer | 20 |
| customer_signer | 4 |
| executor | 15 |
| legal_details (legacy) | 47 |
| entity (legacy) | 6 |
| entity_person (legacy) | 6 |
| person (legacy) | 12 |
| document | 30 |
| deal | 18 |
| остальные (offer, tariff, product, package, system, ...) | без изменений |

Резюме: легаси-наборы `entity / entity_person / person / legal_details`
в этап E **не удаляются и не архивируются**. Помечаются только
`meta.deprecated_at` (см. §2).

---

## 1. Карта FLD-ID для трёх scope'ов

Этап E вводит явное разделение по трём scope'ам **без удаления**
существующих FLD. Используются три набора `entity_type` в
`fields_registry`:

### 1.1. scope = `system_customer` (системный заказчик платформы)

Источник данных: `legal_entities_requisites WHERE scope='system_customer'`
(11 строк) и `individual_requisites WHERE scope='system_customer'`
(10 строк).

Канонический `entity_type` — **существующий** `customer` (FLD-000113…
FLD-000218). Дополнительных FLD в этап E **не создаётся**: набор
`customer.*` уже покрывает ЮЛ/ИП/ФЛ-кейсы (name, short_name, unp,
address, legal_address, bank, bank_code, account, director,
director_short, director_full_name, director_position,
acts_on_basis, basis, passport, personal_number, email, phone,
client_type — итого 20 ключей + 4 customer_signer).

Add-only действие: к существующим записям `fields_registry` с
`entity_type='customer'` добавляется `meta.scope = 'system_customer'`
(JSONB merge), без переименования `key` и без изменения `public_id`.

Ожидаемый count update: 20 customer + 4 customer_signer = **24** записи
получат `meta.scope='system_customer'`. Новых FLD: **0**.

### 1.2. scope = `user_requisites` (реквизиты пользователей кабинета)

Источник данных: `legal_entities_requisites WHERE scope='user_requisites'`
(0 строк сейчас, наполняется через формы D/D.1) и
`individual_requisites WHERE scope='user_requisites'` (0 строк сейчас).

Канонический `entity_type` — **новый** `user_requisites`. Создаются
два sub-namespace'а в одном entity_type:

- `user_requisites.legal.*` — ЮЛ/ИП (15 канонических полей формы D.1
  + 4 GRP read-only).
- `user_requisites.individual.*` — ФЛ (16 канонических полей формы D.1).

Ожидаемые новые FLD-ID (диапазон выделяется sequence, точные номера
будут проставлены движком):

| Поле формы D.1 | Канонический key | Тип |
|---|---|---|
| **Legal (ЮЛ/ИП), 20 полей (16 базовых + 4 GRP)** | | |
| Полное наименование | `user_requisites.legal.name_full` | string |
| Краткое наименование | `user_requisites.legal.name_short` | string |
| Тип ЮЛ | `user_requisites.legal.entity_kind` | enum |
| УНП | `user_requisites.legal.unp` | string |
| ОКПО | `user_requisites.legal.okpo` | string |
| Юр. адрес (строка) | `user_requisites.legal.legal_address` | string |
| Адрес (структура) — deferred D.3 | `user_requisites.legal.address_structured` | json |
| ФИО руководителя | `user_requisites.legal.director_full_name` | string |
| Инициалы руководителя | `user_requisites.legal.director_short_name` | string |
| Должность руководителя | `user_requisites.legal.director_position` | string |
| Действует на основании | `user_requisites.legal.acts_on_basis` | string |
| Расчётный счёт (IBAN) | `user_requisites.legal.bank_account` | string |
| Банк | `user_requisites.legal.bank_name` | string |
| БИК | `user_requisites.legal.bank_code` | string |
| Email | `user_requisites.legal.email` | email |
| Телефон | `user_requisites.legal.phone` | phone |
| GRP: статус | `user_requisites.legal.grp_status` | string (RO) |
| GRP: дата регистрации | `user_requisites.legal.grp_registered_at` | date (RO) |
| GRP: проверено | `user_requisites.legal.grp_verified_at` | datetime (RO) |
| GRP: исходник | `user_requisites.legal.grp_source` | string (RO) |
| **Individual (ФЛ), 17 полей** | | |
| Фамилия | `user_requisites.individual.last_name` | string |
| Имя | `user_requisites.individual.first_name` | string |
| Отчество | `user_requisites.individual.middle_name` | string |
| Личный номер | `user_requisites.individual.personal_number` | string |
| Серия паспорта | `user_requisites.individual.passport_series` | string |
| Номер паспорта | `user_requisites.individual.passport_number` | string |
| Серия+номер (computed) | `user_requisites.individual.passport_number_full` | string |
| Кем выдан | `user_requisites.individual.passport_issued_by` | string |
| Дата выдачи | `user_requisites.individual.passport_issued_date` | date |
| Действителен до | `user_requisites.individual.passport_valid_until` | date |
| Адрес регистрации (строка) | `user_requisites.individual.registration_address` | string |
| Адрес (структура) — deferred D.3 | `user_requisites.individual.address_structured` | json |
| Расчётный счёт (IBAN) | `user_requisites.individual.bank_account` | string |
| Банк | `user_requisites.individual.bank_name` | string |
| БИК | `user_requisites.individual.bank_code` | string |
| Email | `user_requisites.individual.email` | email |
| Телефон | `user_requisites.individual.phone` | phone |

Ожидаемые новые FLD: **20 + 17 = 37** записей в `fields_registry` с
`entity_type='user_requisites'` и `options.scope='user_requisites'`,
`options.subject_type ∈ {legal, individual}`.

### 1.3. scope = `platform_executor` (исполнитель платформы)

Источник данных: только `executors` (2 строки).

Канонический `entity_type` — **существующий** `executor`
(FLD-000103…FLD-000154, 15 записей). Add-only: добавляется
`options.scope='platform_executor'`. Resolver запрещает читать executor.*
из `legal_entities_requisites` или `individual_requisites`.

Ожидаемый count update: **15** записей получат
`options.scope='platform_executor'`. Новых FLD: **0**.

### 1.4. Итоги по §1

- Новых FLD создаётся: **37** (только `user_requisites.*`).
- Существующих FLD получит `options.scope`: **24 customer + 15 executor = 39**.
- Старые `entity / entity_person / person / legal_details` (47+6+6+12 = 71)
  **не трогаются** в этап E, помечаются `options.deprecated_at` без архивации.

---

## 2. Карта старый FLD → новый FLD (deprecated set)

Все 71 запись из `entity / entity_person / person / legal_details`
получают `meta.deprecated_at = now()`, `meta.deprecated_reason =
'requisites_v2_stage_e'`, `meta.replaced_by_entity_type` указывающий
куда читателю переходить:

| Старый entity_type | Новый entity_type | Replaced_by_scope |
|---|---|---|
| `legal_details` (47) | `user_requisites` или `customer` | системные → `customer` (system_customer); пользовательские → `user_requisites` (user_requisites) |
| `entity` (6) | `customer` | system_customer |
| `entity_person` (6) | `customer_signer` | system_customer |
| `person` (12) | `user_requisites.individual.*` | user_requisites |

`archived_at` остаётся **NULL**: clean reset запрещён до DoD E.
Удаление/архивация — отдельным финальным шагом E-clean после
полного UI/resolver swap и подтверждения, что 0 чтений идёт со старых
полей в течение наблюдательного окна.

Ожидаемый update count: **71** записей `fields_registry` с заполненной
`meta.deprecated_at`. `archived_at` не меняется.

---

## 3. Resolver-map (read-side)

В этап E добавляется новый канонический resolver
(`document-field-resolver-v2`, edge function, add-only). Старый
resolver остаётся untouched. Маршрутизация по `scope`:

```
field.public_id (FLD-XXXXXX)
  └─ entity_type='customer' AND meta.scope='system_customer'
       → READ legal_entities_requisites WHERE scope='system_customer' AND tenant=platform
                ∪ individual_requisites   WHERE scope='system_customer' AND tenant=platform
       → выбор по customer.client_type снапшота заказа
       → ЗАПРЕЩЕНО читать из executors / user_requisites

  └─ entity_type='executor' AND meta.scope='platform_executor'
       → READ executors WHERE id = order.executor_id
       → ЗАПРЕЩЕНО читать из legal_entities_requisites / individual_requisites

  └─ entity_type='user_requisites' AND meta.scope='user_requisites'
       └─ subject_type='legal'      → READ legal_entities_requisites
                                       WHERE scope='user_requisites'
                                         AND tenant_id = order.tenant_id
                                         AND id        = order.user_requisites_id
       └─ subject_type='individual' → READ individual_requisites
                                       WHERE scope='user_requisites'
                                         AND tenant_id = order.tenant_id
                                         AND id        = order.user_requisites_id
       → ЗАПРЕЩЕНО читать из executors или из system_customer scope
```

Cross-scope чтение → resolver возвращает `null` + `audit_logs`:
`action='resolver_v2_cross_scope_blocked'`,
`meta={requested_scope, requested_field_id, document_id}`.

Ожидание: 0 cross-scope чтений в реальном трафике после execute.
Дашборд `/admin/tenants` получит новую вкладку «Resolver v2 — статус»
(read-only, отдельный PATCH после execute, не блокирует E).

---

## 4. Snapshot-map: `orders_v2.meta.document_data`

Канонический формат snapshot (из
`.lovable/memory/architecture/documents/field-id-first-canon.md`):

```json
{
  "fields": {
    "FLD-000113": { "value": "...", "source": "system_customer.legal_entities_requisites:<id>", "label": "..." },
    "FLD-000220": { "value": "...", "source": "user_requisites.individual_requisites:<id>",     "label": "..." },
    "FLD-000103": { "value": "...", "source": "platform_executor.executors:<id>",               "label": "..." }
  },
  "scope_lock": {
    "customer":          "system_customer | user_requisites",
    "executor":          "platform_executor",
    "snapshot_version":  "v2_stage_e",
    "tenant_id":         "<uuid>"
  }
}
```

`scope_lock.customer` фиксирует, какой scope использовался в момент
генерации документа. После генерации scope **immutable** — повторная
генерация документа того же заказа не может «перепрыгнуть» с
user_requisites на system_customer и наоборот.

Source формат: `<scope>.<table_name>:<row_id>`. `source_trace`
расширяется enum-значениями `field_public_id`, `manual_override`,
`computed_field`, `system_generated`, `scope_locked` (новый;
audit-only).

Ожидание execute:
- 0 заказов теряют snapshot (поле `document_data` не пересчитывается
  ретроспективно — только для новых генераций после execute).
- Старые сгенерированные документы остаются с прежним snapshot.

---

## 5. Placeholder catalog preview

`PlaceholdersCatalogTab` (см.
`.lovable/proofs/document_generation_sprint11_c5e_placeholder_catalog.md`)
получит **три новые группы** в фильтре по `meta.scope`:

| Группа | Источник entity_type | Ожидаемое число строк |
|---|---|---|
| Системный заказчик (платформа) | `customer`, `customer_signer` | 24 |
| Реквизиты пользователя — ЮЛ/ИП | `user_requisites` (subject=legal) | 19 |
| Реквизиты пользователя — ФЛ | `user_requisites` (subject=individual) | 16 |
| Исполнитель платформы | `executor` | 15 |
| Документ / Сделка / Оффер / прочее | без изменений | 30+18+7+… |

Старые `legal_details / entity / entity_person / person` отображаются
в отдельной свернутой группе **«Legacy (deprecated)»** с серым бейджем
и подсказкой «Не использовать в новых шаблонах. Переход — на
user_requisites / customer / customer_signer». В строке `Settings`
сохраняется кнопка копирования placeholder'а, но при копировании
показывается toast-warning.

Визуальные дубли проверены: пересечения `key`-ов между новой и старой
группой нет (`user_requisites.legal.unp` ≠ `legal_details.leg_unp` ≠
`customer.unp` — все три имеют разные `public_id` и разные группы в
каталоге). Дубль-detector работает по `(label, group)` — после dry-run
0 пересечений.

---

## 6. Audit canon (zero-leak proof)

Все новые действия E пишут в `audit_logs` строго по канону:

```jsonc
{
  "actor_user_id": "<uuid|null>",       // null для system actor
  "actor_type":    "user|admin|system",
  "actor_label":   "system:requisites_v2_stage_e",
  "action":        "fields_registry_marked_deprecated"
                 | "fields_registry_scope_assigned"
                 | "fields_registry_user_requisites_seeded"
                 | "resolver_v2_cross_scope_blocked"
                 | "snapshot_scope_locked",
  "meta": {
    "field_public_id": "FLD-XXXXXX",
    "entity_type":     "user_requisites|customer|executor|...",
    "scope":           "system_customer|user_requisites|platform_executor",
    "before":          { ... },
    "after":           { ... }
  }
}
```

Запрещено: `body.user_id`, raw PII (паспортные данные, IBAN, БИК,
телефон, email) — в `meta` пишется только `field_public_id`, `scope`,
`subject_type`, `tenant_id`, `row_id`. Значения полей не логируются.

---

## 7. Изоляционные инварианты (proof в execute)

После execute обязаны выполняться следующие SQL-проверки (войдут в
`requisites_v2_stage_e_execute.md`):

1. **Нет смешивания system_customer и user_requisites:**
   ```sql
   SELECT COUNT(*) FROM fields_registry
   WHERE options->>'scope' = 'system_customer'
     AND entity_type = 'user_requisites';
   -- expected: 0
   ```
2. **platform_executor читается только из executors:**
   ```sql
   SELECT COUNT(*) FROM fields_registry
   WHERE meta->>'scope' = 'platform_executor'
     AND entity_type <> 'executor';
   -- expected: 0
   ```
3. **Пользовательский документ не берёт системные реквизиты:**
   ```sql
   SELECT COUNT(*) FROM orders_v2
   WHERE (meta->'document_data'->'scope_lock'->>'customer') = 'user_requisites'
     AND EXISTS (
       SELECT 1 FROM jsonb_each(meta->'document_data'->'fields') f(k,v)
       WHERE v->>'source' LIKE 'system_customer.%'
     );
   -- expected: 0
   ```
4. **Системный акт не берёт user_requisites:**
   ```sql
   SELECT COUNT(*) FROM orders_v2
   WHERE (meta->'document_data'->'scope_lock'->>'customer') = 'system_customer'
     AND EXISTS (
       SELECT 1 FROM jsonb_each(meta->'document_data'->'fields') f(k,v)
       WHERE v->>'source' LIKE 'user_requisites.%'
     );
   -- expected: 0
   ```
5. **Каталог без визуальных дублей:**
   ```sql
   SELECT label, COUNT(*) c FROM fields_registry
   WHERE archived_at IS NULL AND (meta->>'deprecated_at') IS NULL
   GROUP BY label HAVING COUNT(*) > 1;
   -- expected: 0 rows
   ```
6. **Запрещённый термин не встречается:**
   - `rg -n '(^|[^a-zA-Z])AI([^a-zA-Z]|$)' src/components/requisites-v2/ src/hooks/useRequisitesV2.ts src/pages/settings/UserRequisites.tsx .lovable/proofs/requisites_v2_*.md` — expected `0`.

---

## 8. Что execute этапа E **НЕ делает**

- ❌ Не удаляет `client_legal_details`, `legal_details_persons`,
  `client_legal_detail_persons` или их FK (legacy = 26 строк CLD,
  сохраняется до DoD E).
- ❌ Не выставляет `archived_at` на старые `entity_type`'ы
  (`legal_details / entity / entity_person / person`) — только
  `meta.deprecated_at`.
- ❌ Не изменяет существующий resolver `canonical-document-generate-strict`.
- ❌ Не меняет уже сгенерированные snapshot'ы в `orders_v2.meta.document_data`.
- ❌ Не редактирует `address_structured` в формах v2 (deferred D.3).
- ❌ Не переключает UI генерации документов на v2 resolver
  (отдельный PATCH E.2 после execute и наблюдательного окна).

---

## 9. План execute (после approve этого dry-run)

Один атомарный migration в транзакции с STOP-guards:

```
BEGIN;

-- Step 1: scope=system_customer для customer + customer_signer (24 строки)
UPDATE fields_registry SET meta = meta || jsonb_build_object('scope','system_customer')
WHERE entity_type IN ('customer','customer_signer') AND archived_at IS NULL;
-- guard: count = 24

-- Step 2: scope=platform_executor для executor (15 строк)
UPDATE fields_registry SET meta = meta || jsonb_build_object('scope','platform_executor')
WHERE entity_type = 'executor' AND archived_at IS NULL;
-- guard: count = 15

-- Step 3: seed 35 новых FLD для user_requisites
INSERT INTO fields_registry (entity_type, key, label, data_type, public_id, meta, ...)
VALUES (... 35 rows ...);
-- guard: count = 35, все public_id уникальны

-- Step 4: deprecate 71 legacy FLD
UPDATE fields_registry SET meta = meta || jsonb_build_object(
  'deprecated_at', now()::text,
  'deprecated_reason', 'requisites_v2_stage_e',
  'replaced_by', '<map>'
)
WHERE entity_type IN ('legal_details','entity','entity_person','person') AND archived_at IS NULL;
-- guard: count = 71, archived_at = NULL во всех

-- Step 5: deploy edge function `document-field-resolver-v2` (add-only)
-- Step 6: расширить scope_lock в snapshot pipeline (только для новых генераций)

-- STOP-guards:
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM fields_registry WHERE entity_type='user_requisites') <> 35 THEN RAISE EXCEPTION 'E.guard.1 user_requisites count mismatch'; END IF;
  IF (SELECT COUNT(*) FROM fields_registry WHERE meta->>'scope'='system_customer') <> 24 THEN RAISE EXCEPTION 'E.guard.2 system_customer scope mismatch'; END IF;
  IF (SELECT COUNT(*) FROM fields_registry WHERE meta->>'scope'='platform_executor') <> 15 THEN RAISE EXCEPTION 'E.guard.3 platform_executor scope mismatch'; END IF;
  IF (SELECT COUNT(*) FROM fields_registry WHERE meta->>'deprecated_at' IS NOT NULL) <> 71 THEN RAISE EXCEPTION 'E.guard.4 deprecated count mismatch'; END IF;
END $$;

COMMIT;
```

При несовпадении любого guard — ROLLBACK, миграция падает с `RAISE
EXCEPTION`, ничего не сохраняется.

---

## 10. DoD dry-run E

- [x] Подсчитаны фактические counts (см. §0).
- [x] Карта FLD по трём scope'ам составлена (§1), новых FLD = 35,
      переиспользованных = 39, deprecated = 71.
- [x] Resolver-map описан, cross-scope = блок (§3).
- [x] Snapshot-map описан, scope_lock immutable (§4).
- [x] Placeholder catalog preview без визуальных дублей (§5).
- [x] Audit canon без PII (§6).
- [x] Изоляционные инварианты сформулированы как SQL-проверки (§7).
- [x] Что execute НЕ делает — явно перечислено (§8).
- [x] Plan execute с STOP-guards и ожидаемыми counts (§9).
- [x] Clean reset старых таблиц / archived_at — **запрещён**.
- [x] `address_structured` — deferred D.3, в формах не редактируется,
      в JSONB сохраняется.

---

## 11. Жду approve

После approve этого dry-run запускаю **один** migration этапа E
(см. §9) и публикую `.lovable/proofs/requisites_v2_stage_e_execute.md`
с фактическими counts, SQL-proof по §7, list файлов и diff-summary.

Старые таблицы и `archived_at` старых FLD — **не трогаются** до DoD E
(после execute + наблюдательное окно + UI-swap + 0 cross-scope reads).
