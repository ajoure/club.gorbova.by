# Dry-run: backfill FLD-ID для typed customer/executor токенов

**Sprint:** 11.1 typed FLD canonization  
**batch_id:** `PLACEHOLDERS-FLD-BACKFILL-2026-05-13`  
**Mode:** read-only discovery (никаких DB writes, никаких audit_logs — согласно правке #11 утверждённого плана)  
**Дата:** 2026-05-13  
**Статус:** ⛔ **STOP перед execute** — найдено 2 блокера, требующих решения пользователя.

---

## 0. TL;DR

- ✅ Подтверждено 148 typed runtime токенов без `field_id`.
- ✅ Подтверждено отсутствие CHECK/enum на `fields_registry.entity_type` — добавление новых значений безопасно.
- ✅ `max(public_id) = FLD-000272`. Диапазон: **FLD-000273 .. FLD-000420**.
- ✅ Customer SOT найден и однозначен (`client_legal_details`), маппинг 1:1.
- ⛔ **БЛОКЕР-1:** Executor SOT (таблица `executors`) **не содержит typed-колонок** под `executor.ind.*` и `executor.ent.*` — 50 токенов из 148 не имеют источника данных. Создание для них FLD-ID без расширения схемы воспроизведёт ровно ту проблему «dead FLD», от которой план должен защитить.
- ⛔ **БЛОКЕР-2:** Резолвер в `_shared/document-render.ts` не покрывает ни `customer.<ns>.*`, ни `executor.<ns>.*` ни в одной ветке (см. §6) — `resolver coverage = 0/148`. До execute нужно либо реализовать резолвер, либо явное решение про fallback.

Execute **запрещён** до решения по обоим блокерам.

---

## 1. Снимок состояния `fields_registry`

```sql
SELECT MAX(public_id), COUNT(*) FROM fields_registry WHERE public_id LIKE 'FLD-%';
-- max_public_id = FLD-000272
-- total_rows    = 269
```

Следующий свободный public_id: **FLD-000273**. Под backfill зарезервируется диапазон **FLD-000273 .. FLD-000420** (148 значений).

Перед самим execute диапазон будет пересчитан повторно — если за время согласования появятся новые FLD, базовый номер сдвинется.

## 2. Проверка ограничений на `entity_type`

```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'public.fields_registry'::regclass;
```

| conname | def |
|---|---|
| `fields_registry_pkey` | `PRIMARY KEY (id)` |
| `fields_registry_key_unique` | `UNIQUE (key)` |
| `fields_registry_entity_type_key_key` | `UNIQUE (entity_type, key)` |

**Никаких CHECK/enum на `entity_type`.** Существующие значения включают `customer`, `executor`, `customer_signer`, `user_requisites`, `legal_details`, `entity_person` и др. — таблица уже использует свободный набор tag-значений.

**Выбранная стратегия:** добавить новые `entity_type` напрямую — `customer_individual`, `customer_legal`, `customer_entrepreneur`, `executor_individual`, `executor_legal`, `executor_entrepreneur`. Это:
- консистентно с уже существующими `customer_signer`;
- не требует миграции CHECK/enum;
- даёт UI каталога стабильный дискриминатор без чтения `options`.

В `options` дополнительно положим `{ subject_type, typed_namespace, batch_id, source }` для трассировки и rollback.

## 3. Фактическое распределение 148 целевых токенов

```sql
SELECT category, COUNT(*) FROM document_token_registry
WHERE archived_at IS NULL AND field_id IS NULL
GROUP BY category;
```

| category | n | в scope |
|---|---:|:---:|
| `customer.individual` | 26 | ✅ |
| `customer.legal` | 24 | ✅ |
| `customer.entrepreneur` | 24 | ✅ |
| `executor.individual` | 26 | ⚠ (нет SOT) |
| `executor.legal` | 24 | ✅ |
| `executor.entrepreneur` | 24 | ⚠ (нет SOT) |
| `customer` | 1 | ❌ out of scope (universal) |
| `executor` | 1 | ❌ out of scope (universal) |
| `executor.signer` | 4 | ❌ out of scope (override-семантика) |
| **итого typed** | **148** | |
| итого out of scope | 6 | |

**Канон namespace** (фиксируется как proof для миграции):

| `category` | `token_key` prefix | `subject_type` | `entity_type` (новый) |
|---|---|---|---|
| `customer.individual` | `customer.ind.*` | `individual` | `customer_individual` |
| `customer.legal` | `customer.leg.*` | `legal_entity` | `customer_legal` |
| `customer.entrepreneur` | `customer.ent.*` | `entrepreneur` | `customer_entrepreneur` |
| `executor.individual` | `executor.ind.*` | `individual` | `executor_individual` |
| `executor.legal` | `executor.leg.*` | `legal_entity` | `executor_legal` |
| `executor.entrepreneur` | `executor.ent.*` | `entrepreneur` | `executor_entrepreneur` |

Это **окончательная фиксация** — execute использует именно эту таблицу, без эвристик на стороне миграции.

## 4. Customer SOT — `client_legal_details`

Discovery колонок `public.client_legal_details` показал полное покрытие всех 74 customer typed-токенов:

| token_key suffix | SOT столбец | data_type |
|---|---|---|
| `customer.ind.full_name` | `ind_full_name` | text |
| `customer.ind.birth_date` | `ind_birth_date` | **date** |
| `customer.ind.passport_series` / `_number` / `_issued_by` | `ind_passport_*` | text |
| `customer.ind.passport_issued_date` / `_valid_until` | `ind_passport_issued_date` / `ind_passport_valid_until` | **date** |
| `customer.ind.personal_number` | `ind_personal_number` | text |
| `customer.ind.address.*` | `ind_address_structured` (JSONB) + flat fallback `ind_address_*` | text/jsonb |
| `customer.ind.bank_*`, `customer.ind.email`, `customer.ind.phone` | shared `bank_*`, `email`, `phone` (общие для всех subject_type) | text |
| `customer.leg.org_form` / `name` / `unp` / `address` | `leg_org_form` / `leg_name` / `leg_unp` / `leg_address` (или `leg_address_structured`) | text/jsonb |
| `customer.leg.director_*` / `acts_on_basis` | `leg_director_*`, `leg_acts_on_basis` | text |
| `customer.leg.short_name` | (нет своей колонки → producer из `leg_name`) | text |
| `customer.ent.name` / `unp` / `address` / `acts_on_basis` | `ent_name` / `ent_unp` / `ent_address` (или `ent_address_structured`) / `ent_acts_on_basis` | text |
| `customer.ent.director_*` | (нет своих колонок → reuse `leg_director_*` либо null; см. блокер ниже) | text |
| `customer.ent.bank_*` / `email` / `phone` | shared `bank_*`, `email`, `phone` | text |

**Найденная мелкая дырка (не блокер):** в `client_legal_details` нет `ent_director_*` колонок, а в реестре есть `customer.ent.director_full_name`, `customer.ent.director_position`, `customer.ent.director_short_name`, `customer.ent.director_acts_on_basis`. ИП в РБ часто действует «лично» (без директора), поэтому корректное поведение резолвера — отдавать пустую строку с `source_trace = 'no_director_for_entrepreneur'`. Это **ожидаемо** и не делает FLD «мёртвым», просто отражает доменную реальность.

Customer SOT — однозначный: `client_legal_details` для всех 74 customer typed-токенов.

## 5. ⛔ БЛОКЕР-1: Executor SOT не покрывает ИП/ФЛ

Discovery `public.executors`:

```
id, full_name, short_name, unp, legal_address, bank_account, bank_name, bank_code,
phone, email, director_position, director_full_name, director_short_name,
acts_on_basis, is_default, is_active, signature_url, legal_address_structured
```

Это **flat-схема под юрлицо**. Никаких `ind_*`, `ent_*`, `passport_*`, `birth_date` и т.п.

**Покрытие executor typed-токенов:**

| Группа | tokens | SOT | Покрытие |
|---|---:|---|:---:|
| `executor.leg.*` | 24 | `executors` (full_name → leg.name, unp → leg.unp, legal_address[_structured] → leg.address.*, director_* → leg.director_*, bank_* → leg.bank_*) | ✅ полное |
| `executor.ind.*` | 26 | **нет** | ⛔ 0/26 |
| `executor.ent.*` | 24 | частично (name, unp, address через те же колонки `executors`; нет `ent_*` дискриминатора и нет паспортных полей) | ⚠ ~12/24 |

`legal_entities_requisites` и `individual_requisites` — это таблицы для **owner-profile requisites** (личный кабинет пользователя), а не executor. Использовать их вместо `executors` нельзя.

**Без расширения схемы:** 50 токенов (26 ind + 24 ent) либо превращаются в честные «мёртвые FLD» (то, чего план явно избегает), либо требуют документированный fallback.

### Варианты решения (требуют выбора пользователя ДО execute)

**Вариант A — расширить таблицу `executors`** (правильно, но дорого):
- ALTER TABLE `executors` ADD COLUMN `ind_*` (full_name, birth_date, passport_*, personal_number, address_structured…), `ent_*` (name, unp, address_structured, acts_on_basis…), `subject_type text NOT NULL DEFAULT 'legal_entity' CHECK (subject_type IN ('individual','legal_entity','entrepreneur'))`.
- UI «Реквизиты исполнителя» должен научиться писать в новые колонки (новая миграция UI, не входит в текущий патч).
- Все 148 FLD получают живой SOT.

**Вариант B — backfill только 98 покрытых токенов** (74 customer + 24 executor.leg):
- 50 executor.ind/ent остаются runtime без FLD до отдельного спринта по расширению `executors`.
- Не противоречит канону: канон требует «FLD ИЛИ запрещён», 50 токенов остаются «запрещены в новых шаблонах», их можно скрыть в каталоге фильтром.
- Меньший scope, безопаснее.

**Вариант C — backfill всех 148, для executor.ind/ent резолвер явно возвращает пустую строку** с `source_trace = 'executor_typed_unsupported'`:
- Канон формально соблюдён (есть FLD), но семантика «токен всегда пустой» — это всё та же «мёртвая FLD». Прямо нарушает дух правки пользователя «не создать ещё один слой мёртвых FLD-полей».
- **Не рекомендуется.**

**Рекомендация:** Вариант B на текущий спринт + отдельный спринт 11.2 на схему `executors` для Варианта A.

## 6. ⛔ БЛОКЕР-2: Resolver coverage = 0

Прямая проверка `supabase/functions/_shared/document-render.ts`:
- веток `customer.ind.*` / `customer.leg.*` / `customer.ent.*` нет;
- веток `executor.ind.*` / `executor.leg.*` / `executor.ent.*` нет;
- `sourceFor()` не знает typed namespaces.

Текущий поток `field-id → token_key → resolverValues[token_key]` даст `undefined` для всех 148 ключей даже после backfill. Поэтому:

**Резолвер обязательно расширяется в том же execute-патче, что и миграция.** Без этого 148 новых FLD будут «компилироваться» каноном, но возвращать пустые строки. Это запрещено правкой #1 утверждённого плана:

> «Главное — не alias, а resolver coverage.»

План резолвера (псевдокод, фиксируется здесь как обязательство execute):

```ts
// _shared/document-render.ts, новый блок «8.5 typed customer resolution»
async function loadCustomerTypedValues(profileId: string): Promise<Record<string, string>> {
  const { data: cld } = await sb.from('client_legal_details')
    .select('*').eq('profile_id', profileId).eq('is_default', true).maybeSingle();
  if (!cld) return {};
  return {
    // customer.ind.*
    'customer.ind.full_name': cld.ind_full_name ?? '',
    'customer.ind.birth_date': fmtDate(cld.ind_birth_date),
    'customer.ind.passport_series': cld.ind_passport_series ?? '',
    // ... все 26 ключей
    'customer.ind.address.full': formatStructuredAddress(cld.ind_address_structured) || cld.ind_address_full || '',
    'customer.ind.address.city': cld.ind_address_structured?.city ?? cld.ind_address_city ?? '',
    // ...
    // customer.leg.*
    'customer.leg.name': cld.leg_name ?? '',
    // ...
    // customer.ent.*
    'customer.ent.name': cld.ent_name ?? '',
    // ent.director_* → '' (см. §4, ожидаемо)
  };
}

async function loadExecutorTypedValues(executorId: string): Promise<Record<string, string>> {
  const { data: ex } = await sb.from('executors').select('*').eq('id', executorId).maybeSingle();
  if (!ex) return {};
  return {
    // executor.leg.* — полное покрытие
    'executor.leg.name': ex.full_name ?? '',
    'executor.leg.short_name': ex.short_name ?? '',
    'executor.leg.unp': ex.unp ?? '',
    'executor.leg.address.full': formatStructuredAddress(ex.legal_address_structured) || ex.legal_address || '',
    // ...
    // executor.ind.* / executor.ent.* — зависит от выбранного варианта (см. §5)
  };
}

// в основном цикле:
const customerTyped = ctx.customer?.profile_id ? await loadCustomerTypedValues(ctx.customer.profile_id) : {};
const executorTyped = ctx.executor?.id ? await loadExecutorTypedValues(ctx.executor.id) : {};
Object.assign(resolverValues, customerTyped, executorTyped);
```

**До утверждения варианта по §5 точный объём резолвера не фиксируется.**

## 7. Стабильный mapping 148 → FLD (заготовка, фиксируется после §5)

Полная таблица из 148 строк генерируется детерминированно по фиксированному порядку:

```sql
SELECT id, token_key, category
FROM document_token_registry
WHERE archived_at IS NULL AND field_id IS NULL
  AND category IN ('customer.individual','customer.legal','customer.entrepreneur',
                   'executor.individual','executor.legal','executor.entrepreneur')
ORDER BY category, token_key;
```

После утверждения варианта по §5 эта таблица сохраняется в этот же proof в виде закрытого блока:

```
| # | document_token_registry.id | token_key                    | category            | proposed_public_id | proposed_entity_type | options.subject_type | proposed_data_type | sot_table.column                                | resolver_branch |
```

Execute читает именно эту таблицу (`INSERT ... VALUES` с явно перечисленными UUID и public_id, без `row_number()`).

**Канон data_type** (правка #6 утверждённого плана):

| token_key pattern | proposed_data_type |
|---|---|
| `*.birth_date`, `*.passport_issued_date`, `*.passport_valid_until` | `date` |
| `*.unp`, `*.personal_number`, `*.bank_account`, `*.bank_code` | `string` (не number — это коды) |
| `*.email` | `email` |
| `*.phone` | `phone` |
| `*.address.full`, остальные суффиксы | `string` |

Сейчас в `document_token_registry.data_type` у всех 148 стоит `string` — в `fields_registry` пропишем уточнённые типы по таблице выше; в самом `document_token_registry` обновлять `data_type` не будем (out of scope, registry хранит lowest-common-denominator).

## 8. Alias-слой (правка #1 утверждённого плана)

Self-alias **избыточен**, если резолвер уже находит ключ через `field-id → token_key`. Проверка фактической реализации `_shared/document-render.ts`: резолвер читает `document_token_aliases` только для **обратной совместимости** в legacy DOCX, где встречаются `{{customer.ind.full_name}}` без `field:`-префикса (потому что старый pipeline резолвил по token_key напрямую, без registry).

**Решение:** self-alias записи **не создавать**. Доказательство, что они не нужны: после миграции цепочка `{{field:FLD-XXXXXX}} → fields_registry.public_id → document_token_registry.field_id → token_key → resolverValues[token_key]` работает без alias-таблицы.

Старые DOCX, где встречается `{{customer.ind.full_name}}` без `field:`, всё ещё работают через текущую legacy-ветку `_shared/document-render.ts`, которая ходит в `resolverValues` по token_key напрямую. Никаких новых alias не требуется.

Counts в execute обновляются:
- `will_create_aliases: 0` (вместо 148).

## 9. Counts (промежуточные, финализируются после §5)

```
found_typed_runtime_without_field_id:   148
will_create_fields_registry_rows:       148 (Вариант A или C) / 98 (Вариант B)
will_update_document_token_registry:    148 (A/C) / 98 (B)
will_create_aliases:                    0    (см. §8)
conflicts_in_fields_registry_key:       0
public_id_range:                        FLD-000273..FLD-000420 (A/C) или FLD-000273..FLD-000370 (B)
skipped_out_of_scope:                   customer=1, executor=1, executor.signer=4
resolver_coverage_after_execute_plan:   148/148 (A) / 98/148 (B) / 98/148 живых + 50/148 пустых (C)
```

## 10. Rollback SQL (готов, не требует доработки)

```sql
BEGIN;

-- 1) Снять field_id с document_token_registry (по batch)
UPDATE document_token_registry
SET field_id = NULL, updated_at = now()
WHERE field_id IN (
  SELECT id FROM fields_registry WHERE options->>'batch_id' = 'PLACEHOLDERS-FLD-BACKFILL-2026-05-13'
);

-- 2) Удалить fields_registry rows
DELETE FROM fields_registry
WHERE options->>'batch_id' = 'PLACEHOLDERS-FLD-BACKFILL-2026-05-13';

-- audit rows НЕ удаляем (история должна остаться)
COMMIT;
```

Pre-check (правка #10):
```sql
SELECT COUNT(*) FROM document_token_registry
WHERE field_id IN (SELECT id FROM fields_registry WHERE options->>'batch_id'='PLACEHOLDERS-FLD-BACKFILL-2026-05-13');
```

Aliases-удаления не требуется (§8).

## 11. STOP-условия перед execute

Execute **не запускается**, пока пользователь не подтвердит:

1. **Решение по §5 Executor SOT:**
   - [ ] Вариант A (расширить `executors`, отдельная schema-миграция в этом же спринте — большой scope);
   - [ ] Вариант B (backfill только 98 покрытых: 74 customer + 24 executor.leg; 50 ind/ent отложены) ← **рекомендация**;
   - [ ] Вариант C (всех 148 с пустым резолвером для 50) — **не рекомендую**.

2. **Согласование §8 (no self-alias):**
   - [ ] Подтвердить, что self-alias не создаём.

3. **STOP по count mismatch (правка #12):** если перед execute SELECT покажет не 148 (а 147/149/152) — миграция блокируется и проводится новый dry-run.

После подтверждения варианта по §5 этот файл будет дополнен:
- закрытым блоком §7 (полная mapping-таблица на 98 или 148 строк с конкретными public_id и SOT-колонками);
- финальной формулировкой резолвера для §6;
- финальными counts §9.

---

## 12. Изменения относительно черновика плана

| # правки | Применено в dry-run |
|:---:|---|
| 1 (no self-alias) | §8 — обоснование, `will_create_aliases: 0` |
| 2 (resolver coverage обязателен) | §6 — выделено как блокер-2 |
| 3 (canonical-template-validate) | §6 — текущий резолвер описан, legacy ветка сохраняется |
| 4 (strict vs render mismatch) | §6 — указано, что typed branch добавляется в `_shared/document-render.ts`, strict pipeline покрытие будет финализировано после §5 |
| 5 (token_key vs category) | §3 — таблица фиксации namespace |
| 6 (data_type из семантики) | §7 — отдельная таблица типов |
| 7 (address parts) | §6 — `address.*` через `formatStructuredAddress` + flat fallback |
| 8 (ИП без кавычек) | будет в smoke после execute |
| 9 (runtime badge только у 148/98) | будет в verify |
| 10 (rollback pre-check) | §10 |
| 11 (dry-run read-only) | весь файл — никаких DB writes, никаких audit_logs |
| 12 (STOP по count mismatch) | §11 пункт 3 |

---

**Ожидание ответа пользователя по §5 и §8 перед написанием миграции и резолвера.**
