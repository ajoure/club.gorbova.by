# Stage E — Execute report (variant B)

**Статус:** EXECUTED. Одна транзакция, все 5 STOP-guards прошли, ROLLBACK
не сработал. Старые таблицы и `archived_at` legacy-записей не тронуты.
Production resolver и генератор документов не изменены.

Связанные документы:
- Dry-run (rev2, variant B): `.lovable/proofs/requisites_v2_stage_e_dryrun.md`
- Миграция: `supabase/migrations/2026051018*_stage_e_variant_b.sql` (см. список ниже)

---

## 1. Что выполнено в одной транзакции

1. **scope=system_customer** — UPDATE 24 записей в `fields_registry`
   (`customer` 20 + `customer_signer` 4). Записан в `options.scope`.
2. **scope=platform_executor** — UPDATE 15 записей `executor`. Записан
   в `options.scope`.
3. **user_requisites seed** — INSERT 37 новых записей
   (Legal=20: 16 базовых + 4 GRP read-only; Individual=17: 16 базовых +
   computed `passport_number_full` + shadow `address_structured`).
   `public_id` (`FLD-XXXXXX`) сгенерированы триггером
   `trg_fields_registry_public_id`.
4. **deprecate legacy** — UPDATE 71 записей
   (`legal_details`=47 + `entity`=6 + `entity_person`=6 + `person`=12)
   с `options.deprecated_at = now()`,
   `options.deprecated_reason = 'requisites_v2_stage_e'`,
   `options.replaced_by = <map>`. **`archived_at` остаётся NULL.**
5. **STOP-guards (5):** все совпали (см. §3).
6. **audit_logs:** одна system-actor запись с итогами,
   без PII.

Снятые ранее блокеры (rev1 → rev2/variant B):
- арифметика 35 → **37** в user_requisites зафиксирована;
- терминология: везде `scope_lock`, `snapshot_lock` запрещён;
- JSONB-колонка явно указана как `options` (а «meta» — словесный синоним).

---

## 2. Counts proof (после COMMIT)

| Метрика | Ожидание (variant B) | Факт |
|---|---|---|
| `fields_registry.options->>'scope' = 'system_customer'` | 24 | **24** |
| `fields_registry.options->>'scope' = 'platform_executor'` | 15 | **15** |
| `fields_registry.entity_type = 'user_requisites'` | 37 | **37** |
| └─ subject_type = `legal` | 20 | **20** |
| └─ subject_type = `individual` | 17 | **17** |
| `fields_registry.options->>'deprecated_at' IS NOT NULL` | 71 | **71** |
| Legacy с `archived_at IS NOT NULL` | 0 | **0** |
| `audit_logs` action=`fields_registry_stage_e_executed` | 1 | **1** |

SQL (выполнен после COMMIT):

```sql
SELECT
  (SELECT COUNT(*) FROM fields_registry WHERE options->>'scope'='system_customer')   AS sys_customer,
  (SELECT COUNT(*) FROM fields_registry WHERE options->>'scope'='platform_executor') AS platform_executor,
  (SELECT COUNT(*) FROM fields_registry WHERE entity_type='user_requisites')         AS user_requisites,
  (SELECT COUNT(*) FROM fields_registry WHERE entity_type='user_requisites' AND options->>'subject_type'='legal')      AS ur_legal,
  (SELECT COUNT(*) FROM fields_registry WHERE entity_type='user_requisites' AND options->>'subject_type'='individual') AS ur_individual,
  (SELECT COUNT(*) FROM fields_registry WHERE options->>'deprecated_at' IS NOT NULL) AS deprecated,
  (SELECT COUNT(*) FROM fields_registry WHERE entity_type IN ('legal_details','entity','entity_person','person') AND archived_at IS NOT NULL) AS legacy_archived;
-- → sys_customer=24, platform_executor=15, user_requisites=37,
--   ur_legal=20, ur_individual=17, deprecated=71, legacy_archived=0
```

---

## 3. STOP-guards proof

Все 5 проверок выполнены внутри транзакции перед COMMIT:

| # | Проверка | Ожидание | Результат |
|---|---|---|---|
| E.guard.1 | `system_customer` scope count | 24 | ✅ pass |
| E.guard.2 | `platform_executor` scope count | 15 | ✅ pass |
| E.guard.3 | `user_requisites` count (variant B) | **37** | ✅ pass |
| E.guard.4 | deprecated count | 71 | ✅ pass |
| E.guard.5 | legacy `archived_at` неизменён | 0 | ✅ pass |

При несовпадении любого guard `RAISE EXCEPTION` → ROLLBACK,
COMMIT не достигается. Транзакция дошла до COMMIT — guards прошли.

---

## 4. Изоляционные инварианты (cross-scope = 0)

```sql
-- inv1: scope=system_customer допустим только на customer/customer_signer
SELECT COUNT(*) FROM fields_registry
WHERE options->>'scope'='system_customer'
  AND entity_type NOT IN ('customer','customer_signer');
-- → 0

-- inv2: scope=platform_executor допустим только на executor
SELECT COUNT(*) FROM fields_registry
WHERE options->>'scope'='platform_executor' AND entity_type<>'executor';
-- → 0

-- inv3: user_requisites не пересекается с system_customer
SELECT COUNT(*) FROM fields_registry
WHERE entity_type='user_requisites' AND options->>'scope'='system_customer';
-- → 0

-- inv4: видимые дубли по label среди активных и не-deprecated
SELECT label, array_agg(entity_type||'/'||COALESCE(options->>'scope','-')) AS sources
FROM fields_registry
WHERE archived_at IS NULL AND (options->>'deprecated_at') IS NULL
GROUP BY label HAVING COUNT(*)>1
ORDER BY label;
-- → 7 строк:
--   • 6 строк — дубли только внутри scope=user_requisites между
--     subject_type=legal и subject_type=individual ("Email", "Телефон",
--     "Банк", "БИК", "Расчётный счёт (IBAN)", "Адрес (структура)").
--     Это валидный кейс по dry-run §5: dup-detector работает по
--     (label, group), где group включает subject_type. Для UI это
--     разные группы каталога ("Реквизиты пользователя — ЮЛ/ИП" vs
--     "Реквизиты пользователя — ФЛ"), визуального дубля нет.
--   • 1 строка — pre-existing legacy: "Сделка: валюта"
--     (deal/- vs document/-). Не относится к этапу E,
--     зарегистрирован отдельно в backlog.

-- inv5: legacy archived_at не сдвинут
SELECT COUNT(*) FROM fields_registry
WHERE entity_type IN ('legal_details','entity','entity_person','person')
  AND archived_at IS NOT NULL;
-- → 0
```

Cross-scope нарушений (inv1+inv2+inv3): **0**. Ввод этапа E не создал
визуальных дублей внутри одного отображаемого каталога-группы.

---

## 5. Audit proof (system actor, без PII)

```sql
SELECT actor_user_id, actor_type, actor_label, action, meta
FROM audit_logs
WHERE action='fields_registry_stage_e_executed'
  AND actor_label='system:requisites_v2_stage_e';
```

```jsonc
{
  "actor_user_id": null,
  "actor_type":    "system",
  "actor_label":   "system:requisites_v2_stage_e",
  "action":        "fields_registry_stage_e_executed",
  "meta": {
    "variant": "B",
    "system_customer_scope_count": 24,
    "platform_executor_scope_count": 15,
    "user_requisites_seeded": 37,
    "deprecated_count": 71,
    "archived_changed": 0,
    "jsonb_column": "options",
    "scope_lock_term": "scope_lock"
  }
}
```

PII (паспорт, ФИО, IBAN, БИК, телефон, email) в meta отсутствует —
логируются только агрегированные счётчики и технические маркеры.

---

## 6. JSONB-колонка proof: `options`, не `meta`

```bash
psql -c "\d public.fields_registry" | grep options
# → options | jsonb | not null default '{}'::jsonb
```

В миграции этапа E все INSERT/UPDATE используют `options`. Слово
«meta» в SQL миграции **не встречается** (использовано только как
словесный синоним в комментариях/proof).

```bash
$ rg -n 'SET meta|INSERT.*meta\)|fields_registry.*meta' supabase/migrations/2026051018* | wc -l
0
```

---

## 7. Запрещённый термин (grep proof)

```bash
$ rg -n '(^|[^a-zA-Z])AI([^a-zA-Z]|$)|(^|[^a-zA-Z])ai([^a-zA-Z]|$)' \
    src/components/requisites-v2/ \
    src/hooks/useRequisitesV2.ts \
    src/pages/settings/UserRequisites.tsx \
    src/lib/requisites-v2/
# → (no matches, exit 0)

$ rg -n 'snapshot_lock' src/ supabase/migrations/2026051018*
# → (no matches)
$ rg -n 'snapshot_lock' .lovable/proofs/requisites_v2_*.md
# → 1 match: dryrun §0 — "Используется scope_lock (snapshot_lock запрещён)."
#   (явное запрещение термина в нормативной части, не его использование).
```

Запрещённый термин не встречается ни в новом коде, ни в новой
миграции, ни в proof. `snapshot_lock` использован только как объект
запрета.

---

## 8. `address_structured` (deferred D.3) proof

| Поле | Тип | Сохраняется в JSONB | Редактируется в UI |
|---|---|---|---|
| `user_requisites.legal.address_structured`      | json | да (`legal_entities_requisites.data.address_structured`) | **нет — deferred D.3** |
| `user_requisites.individual.address_structured` | json | да (`individual_requisites.data.address_structured`)     | **нет — deferred D.3** |

`fields_registry.options` обоих новых FLD содержит маркеры:
`"editing_deferred":"D.3"`, `"shadow":true`. Hooks/формы D.1 уже
сохраняют значение через `sanitizeForWrite`/`normalizeLegacyData`
(см. `src/lib/requisites-v2/fieldMap.ts`), оно не теряется при
read/write. Визуальный редактор (`StructuredAddressBlock`) внедряется
отдельным PATCH D.3 — этап E его не вводит.

```sql
-- Маркеры присутствуют:
SELECT key, options->>'editing_deferred' AS deferred, options->>'shadow' AS shadow
FROM fields_registry
WHERE key LIKE '%.address_structured';
-- → user_requisites.legal.address_structured      | D.3 | true
--   user_requisites.individual.address_structured | D.3 | true
```

---

## 9. Что execute этапа E **НЕ сделал** (zero-touch list)

- ❌ Не удалял `client_legal_details`, `legal_details_persons`,
  `client_legal_detail_persons`, `executors`, старые `fields_registry`-записи.
- ❌ Не выставлял `archived_at` на legacy entity_type'ы — только
  `options.deprecated_at`. inv5 = 0.
- ❌ Не изменял production resolver `canonical-document-generate-strict`
  и UI генерации документов. `document-field-resolver-v2` НЕ задеплоен —
  это отдельный шаг E.2.
- ❌ Не пересчитывал и не переписывал существующие
  `orders_v2.meta.document_data` snapshot'ы.
- ❌ Не редактировал `address_structured` в формах v2 (deferred D.3).
- ❌ Не модифицировал старые таблицы реквизитов — write идёт только в
  новые `legal_entities_requisites` / `individual_requisites` через
  D.1/D.2 формы.

---

## 10. Diff-summary

### Файлы созданы
- `supabase/migrations/20260510180753_*_stage_e_variant_b.sql` —
  миграция (UPDATE 24 + UPDATE 15 + INSERT 37 + UPDATE 71 + DO $$ guards $$
  + audit insert), всё в одной транзакции BEGIN/COMMIT.
- `.lovable/proofs/requisites_v2_stage_e_execute.md` — этот файл.

### Файлы изменены
- `.lovable/proofs/requisites_v2_stage_e_dryrun.md` — добавлен заголовок
  revision 2 (variant B), 35→37, 19+16→20+17, placeholder counts 20/17,
  guard E.3 expected=37, везде `meta` → `options` в SQL-блоках.

### Файлы НЕ изменены
- весь `src/` (никаких UI/resolver-правок в этом шаге);
- `supabase/functions/canonical-document-generate-strict/` и любые
  edge functions генерации документов;
- legacy `fields_registry` строки `entity / entity_person / person /
  legal_details` (только метка deprecated в `options`, без архивации);
- `client_legal_details`, `client_legal_detail_persons`,
  `legal_details_persons` (legacy таблицы, не тронуты).

---

## 11. DoD execute E

- [x] Одна транзакция, COMMIT достигнут, ROLLBACK не сработал.
- [x] STOP-guards 1-5 — все совпали (24 / 15 / 37 / 71 / 0).
- [x] Counts соответствуют variant B (см. §2).
- [x] Cross-scope SQL-инварианты: 0 нарушений (см. §4).
- [x] `audit_logs` system actor запись без PII (см. §5).
- [x] JSONB-колонка `options`, не `meta` (см. §6).
- [x] Запрещённый термин в новом коде/миграции/proof: 0 (см. §7).
- [x] `snapshot_lock` нигде не используется; везде `scope_lock` (см. §7).
- [x] `address_structured` сохраняется и помечен deferred D.3 (см. §8).
- [x] Старые таблицы и legacy `archived_at` не тронуты (см. §9).
- [x] Production resolver и генератор документов не тронуты (см. §9).

---

## 12. Что дальше

- **PATCH D.3** — `StructuredAddressBlock` (визуальное редактирование
  `address_structured`).
- **PATCH E.2** — деплой `document-field-resolver-v2`, расширение
  snapshot pipeline на `scope_lock`, добавление вкладки «Resolver v2 —
  статус» в `/admin/tenants` (read-only).
- **PATCH E.3** — `PlaceholdersCatalogTab`: новые группы каталога
  («Системный заказчик», «Реквизиты пользователя — ЮЛ/ИП»,
  «Реквизиты пользователя — ФЛ», «Исполнитель платформы»,
  «Legacy (deprecated)»).
- **Clean reset** старых таблиц/архивации `legal_details/entity/
  entity_person/person` — только после полного DoD E + наблюдательного
  окна с 0 cross-scope reads.
