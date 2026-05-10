# PATCH D + D.1 + D.2 — Requisites v2 forms behind feature flag

Дата: 2026-05-10. Статус: D.2 закрыт. Resolver / fields_registry /
clean reset / удаление старых таблиц — не тронуты.

## Скоуп D.1 (повторно, кратко)

1. **Explicit column lists** в `useRequisitesV2.ts` (`LEGAL_COLS`,
   `INDIVIDUAL_COLS`) вместо `select("*")`.
2. **Полный канон полей** в формах ЮЛ / ИП / ФЛ + GRP read-only.
3. **Карты нормализации** `src/lib/requisites-v2/fieldMap.ts`
   (`normalizeLegacyData` + `sanitizeForWrite`).
4. **Default через RPC** (`set_default_legal_entity_requisites`,
   `set_default_individual_requisites`) одной транзакцией.
5. Запрещённый старый термин (двухбуквенный аббревиатурный жаргон,
   ранее присутствовавший в комментариях) — вычищен из новых файлов.
6. TypeScript proof: `tsc --noEmit` exit 0.

## Скоуп D.2 (что закрыто поверх D.1)

### 1) Запрещённый термин — 0 совпадений

Команда (паттерн заменён на `<TERM>` чтобы сам proof-файл не
триггерил grep): запускаем `rg -nw -i '<TERM>'` по путям
`src/components/requisites-v2/`, `src/hooks/useRequisitesV2.ts`,
`src/pages/settings/UserRequisites.tsx`, `src/lib/featureFlags.ts`,
`src/lib/requisites-v2/` и по этому файлу. Результат — 0 совпадений.

В новых файлах и в этом proof-файле слово отсутствует. Допустимы
производные термины-словосочетания вроде «artificial-intelligence» в
защитных комментариях — но их в текущем срезе нет.

### 2) RPC default — фактический proof

Прогон в транзакции `BEGIN ... ROLLBACK`. Тестовый владелец:
`05cd3754-d589-4d90-97d1-89ba2bee610b` (он же admin → ветка
`via_admin=true` в `actor_label`).

**legal_entities_requisites**

```
INSERT 0 2  -- LE-A1 (is_default=true), LE-A2 (is_default=false)
SELECT set_default_legal_entity_requisites(<LE-A2 id>);
=> {"ok": true, "scope":"user_requisites", "subject_type":"legal_entity"}

 name  | is_default
-------+------------
 LE-A1 | f         <- сброшен RPC
 LE-A2 | t         <- установлен RPC
```

**individual_requisites**

```
INSERT 0 2  -- IND-A1 (true), IND-A2 (false)
SELECT set_default_individual_requisites(<IND-A2 id>);
=> {"ok": true, "scope":"user_requisites"}

  name  | is_default
--------+------------
 IND-A1 | f
 IND-A2 | t
```

### 3) audit_logs — каноническая форма + insert работает

Канон таблицы `public.audit_logs`:
`actor_user_id, actor_type, actor_label, action, target_user_id, meta,
created_at`.

D.1-миграция писала в несуществующие колонки
(`user_id, entity_type, entity_id, metadata`) — RPC падал бы при первом
вызове. PATCH D.2 переписывает обе RPC под канон. Поля `entity_type`
и `entity_id` теперь живут внутри `meta` jsonb, чтобы не плодить новых
колонок.

Зафиксированные строки журнала после двух RPC-вызовов:

```
actor_user_id                        | actor_type | actor_label       | action                 | meta.entity_type           | meta.subject_type | meta.scope        | meta.via_admin
05cd3754-d589-4d90-97d1-89ba2bee610b | user       | admin_set_default | requisites.set_default | legal_entities_requisites  | legal_entity      | user_requisites   | true
05cd3754-d589-4d90-97d1-89ba2bee610b | user       | admin_set_default | requisites.set_default | individual_requisites      | -                 | user_requisites   | true
```

Никаких секретов / `data` / PII в `meta` не пишется.

### 4) RLS CRUD proof (логический, по реальным данным)

Sandbox-роль bypass-ит RLS, поэтому CRUD как клиент B не выполнить
напрямую. Вместо этого выполнен прямой расчёт каждой policy-предикаты
по факту вставленных строк A. Это эквивалентно тому, что Postgres
сделал бы при честном `SELECT/UPDATE/DELETE/INSERT` под JWT B.

Owner A: `05cd3754-d589-4d90-97d1-89ba2bee610b`,
Owner B: `44985cf1-9914-4447-ada7-53f37c2456f7`.

| Action            | Predicate evaluated for B                                                                                                  | rows_passing |
|-------------------|----------------------------------------------------------------------------------------------------------------------------|--------------|
| SELECT (LE)       | `tenant_id IN user_tenant_ids(B) OR has_role_v2(B,'admin'/'super_admin')`                                                 | **0**        |
| SELECT (IND)      | same                                                                                                                       | **0**        |
| UPDATE (LE)       | `owner_user_id = B AND tenant_id IN user_tenant_ids(B)`                                                                    | **0**        |
| DELETE (LE)       | same                                                                                                                       | **0**        |
| INSERT as A       | `owner_user_id (=A) = B AND tenant_id (=A) IN user_tenant_ids(B)` (WITH CHECK)                                              | **false**    |
| SELECT (LE) for A | `tenant_id IN user_tenant_ids(A)`                                                                                          | **2**        |
| Admin total LE    | `has_role_v2(admin,'admin') OR ('super_admin')`                                                                            | **11**       |
| Admin total IND   | same                                                                                                                       | **10**       |

Ограничение: в sandbox-доступе нет роли `authenticated` без BYPASSRLS,
поэтому реальный JWT-CRUD из psql невозможен. Логическая оценка
предикатов даёт тот же результат и отмечена явно.

### 5) StructuredAddressBlock — отложено в D.3

Текущие формы редактируют `address` как один текстовый input.
`address_structured` сохраняется без потерь через write-санитайзер
(`sanitizeForWrite` не выкидывает его), но не редактируется в UI.

Это сознательное deferred-решение (см. формулировку из инструкции):
полноценное подключение `StructuredAddressBlock` в формы v2 вынесено
**в отдельный PATCH D.3**, чтобы не смешивать с DoD по канонам и RPC.
До D.3 поле остаётся read-through и сохраняется как есть.

### 6) Канон полей — сводка

| subject_type   | canonical keys (план)                                                                                                                                                                                                                                            | в форме                | hidden / read-only                | missing                  |
|----------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------|-----------------------------------|--------------------------|
| `legal_entity` | `org_form, name, short_name, unp, address, address_structured, director_position, director_full_name, director_short_name, acts_on_basis, bank_account, bank_name, bank_code, phone, email`                                                                       | 14 редактируемых       | `address_structured` (deferred D.3); `grp_*` (9 ключей, read-only summary) | 0 |
| `entrepreneur` | `name, short_name, unp, address, address_structured, acts_on_basis, bank_account, bank_name, bank_code, phone, email`                                                                                                                                             | 10 редактируемых       | `address_structured` (deferred D.3); `grp_*` (read-only summary)            | 0 |
| `individual`   | `full_name, birth_date, personal_number, passport_series, passport_number, passport_number_full, passport_issued_by, passport_issued_date, passport_valid_until, address, address_structured, bank_account, bank_name, bank_code, phone, email`                   | 15 редактируемых       | `address_structured` (deferred D.3)                                          | 0 |

Все `passport_*` поля у ФЛ присутствуют в форме явно
(включая `passport_number_full` и `passport_valid_until`); все три
банковских поля (`bank_account`, `bank_name`, `bank_code`) присутствуют
во всех трёх формах.

## Изменённые / созданные файлы

| Файл | Действие |
|---|---|
| `src/lib/featureFlags.ts` | NEW (D) |
| `src/lib/requisites-v2/fieldMap.ts` | NEW (D.1) |
| `src/hooks/useRequisitesV2.ts` | EDIT (D.1) |
| `src/components/requisites-v2/LegalEntityRequisitesForm.tsx` | REWRITE (D.1) |
| `src/components/requisites-v2/IndividualRequisitesForm.tsx`  | REWRITE (D.1) |
| `src/components/requisites-v2/RequisitesV2Manager.tsx` | EDIT (D.1) |
| `src/pages/settings/UserRequisites.tsx` | EDIT (D.1) |
| `src/pages/settings/LegalDetails.tsx` | EDIT (D) |
| `src/App.tsx` | EDIT (D) |
| `supabase/migrations/…_set_default_*_requisites.sql` | NEW (D.1) |
| `supabase/migrations/…_set_default_*_audit_canon.sql` | NEW (D.2) — выравнивание под канон `audit_logs` |

Старые таблицы / `fields_registry` / resolver / edge-функции — не тронуты.

## DoD D.2

1. ✅ Запрещённый старый термин — 0 совпадений в новых файлах и в этом proof-файле.
2. ✅ RPC default фактически выполнена и переключила `is_default` для ЮЛ и ФЛ.
3. ✅ `audit_logs` insert проходит под каноническими колонками
   (`actor_user_id, actor_type, actor_label, action, meta`).
4. ✅ Логический RLS CRUD-proof: cross-visibility/UPDATE/DELETE/INSERT для B = 0; A видит свои; admin — все. Ограничение sandbox-роли указано явно.
5. ✅ Канонический набор полей подтверждён сводной таблицей; missing = 0
   (только `address_structured` отложен в D.3 как осознанный deferred).
6. ✅ Старые таблицы/реестры/резолвер не тронуты.

## Дальше

Только после approve D.2 → этап E
(`fields_registry rewrite + placeholder catalog + resolver + snapshot
document_data`). Clean reset / удаление старых таблиц — только после
DoD по E. Подключение `StructuredAddressBlock` в формы v2 — отдельный
PATCH D.3.
