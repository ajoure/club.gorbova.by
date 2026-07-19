# Runnable plan: CRM Companies — Phase 2 Canonical RPC Layer

**Status:** `DRAFT / NOT APPROVED / DO NOT EXECUTE`
**Date:** 2026-07-19
**Phase 1 closure commit:** `ab2d4b05321938c01cf7ada07dda40c9a3e7de86`
**Database ref:** `hdjgkjceownmmnrqqtuz`
**Baseline schema hash:** `c41160b83c8e15c3d3c41a13028700d5` (подтверждён §3)
**Related ADR:** `adr-0002-company-external-ids.md`

Черновик соответствует утверждённому плану с правками 1–17. Полный SQL миграции и rollback приведены в §11 и §12 и должны быть зафиксированы отдельным commit до применения. Миграция не запускается до отдельного execution approve.

---

## 1. Scope

**In-scope (только два DRAFT-файла на этом этапе):**

```
.lovable/discovery/companies-1.0/adr-0002-company-external-ids.md
.lovable/discovery/companies-1.0/companies_phase2_runnable_plan.md
```

**RPC, реализуемые Phase 2 миграцией (после отдельного approve):**

1. `public.crm_company_get_or_create` — полная реализация (сигнатура Phase 1 не меняется);
2. `public.crm_company_link_contact` — полная реализация (сигнатура Phase 1 не меняется);
3. `public.crm_company_upsert_from_billing(_client_legal_details_id uuid)` — новая, service-role only;
4. `public.search_companies(_filters jsonb)` — новая;
5. `public.crm_company_merge(_source_id uuid, _target_id uuid)` — новая;
6. `public.crm_company_archive(_id uuid, _reason text)` — новая;
7. `public.crm_company_grp_refetch(_id uuid)` — новая, queue-only;
8. `public.search_global(...)` — additive branch `company`.

**Private helper (правка 5, 15):** `public._crm_company_resolve_or_create_internal(...)`. Не является публичным API; EXECUTE не выдаётся никому; вызывается только owner-функциями Phase 2.

**Out-of-scope (правка §13 плана):** backfill; trigger на `client_legal_details`; `company-sync-worker`; cron; `orders_v2.company_id`; `crm_tasks.company_id`; UI `/admin/companies`; feature flag; admin section/resource inserts; CSV/Amo import; documents compatibility; hierarchy; `company_contact_person_map`; изменение global default privileges; универсальный `search_entities`.

---

## 2. Read-only discovery outputs (фактические)

### 2.1 Состояние Phase 1 (snapshot 2026-07-19)

Query (агрегированный):

```sql
SELECT to_regclass('public.companies')::text, to_regclass('public.company_contacts')::text,
       to_regclass('public.client_legal_details_company_map')::text,
       to_regclass('public.company_sync_queue')::text,
       (SELECT count(*) FROM public.companies), (SELECT count(*) FROM public.company_contacts),
       (SELECT count(*) FROM public.client_legal_details_company_map),
       (SELECT count(*) FROM public.company_sync_queue),
       (SELECT last_value FROM public.public_id_sequences WHERE entity_type='company');
```

Output:

```
companies        = companies
company_contacts = company_contacts
map              = client_legal_details_company_map
queue            = company_sync_queue
counts           = 0, 0, 0, 0
cmp_last_value   = 0
```

Baseline schema hash (по семи discovery-таблицам):

```
c41160b83c8e15c3d3c41a13028700d5   (совпадает с closure Phase 1)
```

### 2.2 Phase 1 skeleton signatures / ACL

Оба ниже — `SECURITY DEFINER`, `search_path=public`, owner `postgres`, EXECUTE только `authenticated` (правка контракта Phase 1 ACL hardening).

```
crm_company_get_or_create(
  _country text, _unp text, _full_name text, _company_kind text,
  _source text, _source_client_legal_details_id uuid
) RETURNS uuid

crm_company_link_contact(
  _company_id uuid, _profile_id uuid, _relationship_type text,
  _is_billing_contact boolean, _source text, _source_client_legal_details_map_id uuid
) RETURNS uuid
```

Сигнатуры Phase 2 миграция **не меняет** (§5.1, §5.2 плана).

### 2.3 Существующие паттерны (§3.3 плана)

- `search_global(p_query text, p_limit int DEFAULT 20, p_offset int DEFAULT 0) RETURNS jsonb` — jsonb с ветками (`contacts`,`deals`,`messages`), guard через `has_role`/`has_permission`/`has_admin_section_access`, `SECURITY DEFINER`. Phase 2 расширяет **additive** веткой `companies`.
- `search_deal_rows(...) RETURNS TABLE(...)` — `SECURITY INVOKER`, keyset-подобная сигнатура, `LIMIT`/`OFFSET` явные.
- `crm_task_list(_filters jsonb) RETURNS SETOF crm_tasks` — jsonb-фильтры, `SECURITY DEFINER`.
- `crm_task_create(payload jsonb) RETURNS uuid`, `crm_task_apply_automation(...) RETURNS uuid[]`.

Вывод: `search_companies` следует паттерну `crm_task_list` — `RETURNS jsonb` формата `{ items: [...], total: bigint }`, whitelist фильтров, hard cap `limit ≤ 100`, `SECURITY DEFINER`.

### 2.4 Схемы event/audit таблиц

```
audit_logs         (actor_user_id, action, target_user_id, meta, actor_type, actor_label, entity_type, entity_id, created_at)
domain_events      (event_type, source, entity_id, payload, created_at)
crm_activity_log   (public_id, contact_id, user_id, activity_type, source_entity_id, source_entity_type,
                    title_snapshot, text_snapshot, author_snapshot, visibility_scope, idempotency_key, metadata, created_at)
```

Writer-контракты для Phase 2 фиксируются в §8 и §9.

### 2.5 Схема `companies` (ключевые поля)

```
public_id text NOT NULL UNIQUE                            -- CMP-000001, trigger set_companies_public_id
workspace_id uuid NOT NULL DEFAULT SYSTEM
company_kind text NOT NULL DEFAULT 'unknown'              -- legal_entity | entrepreneur | foreign | unknown
country text NOT NULL DEFAULT 'BY'
unp_normalized text NULL
full_name text NOT NULL
short_name, legal_form, legal_address, legal_address_structured jsonb,
email, phone, director_name, director_position, acts_on_basis,
bank_account, bank_name, bank_code,
status text NOT NULL DEFAULT 'active'                     -- active | archived | merged
merged_into_company_id uuid NULL
archived_at timestamptz NULL
grp_* (status_code/name, short_name, registration_date, tax_office_code/name,
       liquidation_date/reason, last_fetched_at)
metadata jsonb NOT NULL DEFAULT '{}'
```

Ключевые индексы:

```
companies_public_id_key UNIQUE (public_id)
companies_unp_unique    UNIQUE (country, unp_normalized) WHERE unp_normalized IS NOT NULL AND status <> 'merged'
company_contacts_unique_profile_rel UNIQUE (company_id, profile_id, relationship_type)
company_sync_queue_idempotency_key_key UNIQUE (idempotency_key)
client_legal_details_company_map.client_legal_details_id UNIQUE
```

### 2.6 Тестовая учётная запись (§3.6 плана)

Query:

```sql
SELECT u.id, u.email, array_agg(r.code) AS roles
FROM auth.users u
LEFT JOIN public.user_roles_v2 urv ON urv.user_id=u.id
LEFT JOIN public.roles r ON r.id=urv.role_id
WHERE u.email='1@ajoure.by'
GROUP BY u.id, u.email;
```

Output:

```
user_id = 37e91f59-e4db-4840-b9c9-e760e634ddd1
email   = 1@ajoure.by
roles   = { menedzher }
```

**Отклонение от плана §3.6:** учётка `1@ajoure.by` имеет роль `menedzher`, а не `admin`. Runtime proof это учитывает:

- `menedzher` → read/write/link/create/get-or-create/grp-refetch (положительные case);
- `menedzher` → archive/merge отказ (deny case правки §8);
- для admin-only case (`archive`, `merge`) требуется **отдельная тестовая admin-учётка**; её выделение — предпосылка runtime proof. До её появления runtime proof помечается `RUNTIME PROOF BLOCKED — admin fixture missing` (правка 11).

Пароль не читается и не сохраняется. Правка 17: учётка используется только для authenticated RPC; `crm_company_upsert_from_billing` проверяется отдельно под `service_role` без подмены JWT.

---

## 3. ADR-0002 — итог

См. `adr-0002-company-external-ids.md`. Итог: **колонка `companies.external_ids` не добавляется**; отдельная lookup-таблица `company_external_ids` — Phase 9, отдельный ADR. Phase 2 core RPC не блокируется, так как ни один RPC Phase 2 не читает external IDs (правка 14).

---

## 4. Контракты RPC

### 4.1 `crm_company_get_or_create` (правки 2, 3, 4, 5)

**Область применимости:** только `company_kind IN ('legal_entity','entrepreneur')` с непустым нормализованным УНП. `foreign/unknown` — отдельный Phase 7 RPC (правка 2). `full_name` не используется как natural key.

**Контракт `_source` (правка 3):**

| `_source` | `_source_client_legal_details_id` | activity |
|---|---|---|
| `'manual'` | обязан быть `NULL` | `audit_logs` + `domain_events(company.created.v1)` при INSERT |
| `'billing_requisites'` | обязателен, строка `purpose='billing'` | `domain_events(company.created.v1)` |
| `'backfill'` | обязателен, те же billing-guards | без `audit_logs` |

Любое другое значение → `RAISE EXCEPTION 'invalid _source' USING ERRCODE='22023'`.

**Guard:** `has_role_v2(auth.uid(), 'super_admin' | 'admin' | 'menedzher')`.

**Concurrency-safe алгоритм (правка 4):**

Публичная функция делегирует resolve в private helper (правка 5) `_crm_company_resolve_or_create_internal`:

```sql
-- pseudocode
v_country := upper(coalesce(_country, 'BY'));
v_unp := regexp_replace(coalesce(_unp,''), '\D','','g');
IF length(v_unp) = 0 THEN
  RAISE EXCEPTION 'unp is required for legal_entity/entrepreneur' USING ERRCODE='23514';
END IF;

-- транзакционный advisory lock на (country, unp)
PERFORM pg_advisory_xact_lock(hashtext(v_country || ':' || v_unp));

-- resolve через canonical unique
SELECT id, status, merged_into_company_id INTO v_row
FROM public.companies
WHERE country=v_country AND unp_normalized=v_unp
FOR UPDATE;

IF FOUND AND v_row.status='merged' THEN
  IF v_row.merged_into_company_id IS NULL THEN
    RAISE EXCEPTION 'merged company has no target' USING ERRCODE='22023';
  END IF;
  RETURN v_row.merged_into_company_id;
END IF;

IF FOUND THEN RETURN v_row.id; END IF;

INSERT INTO public.companies (workspace_id, company_kind, country, unp_normalized, full_name, metadata, created_by)
VALUES (SYSTEM_WORKSPACE, _company_kind, v_country, v_unp, _full_name,
        jsonb_build_object('company_sync', jsonb_build_object(
          'billing_snapshot', '{}'::jsonb,
          'last_billing_client_legal_details_id', null,
          'last_billing_synced_at', null,
          'last_billing_source_updated_at', null)),
        auth.uid())
RETURNING id INTO v_id;
-- trigger set_companies_public_id проставляет CMP-000001
```

Public wrapper дополнительно проверяет role guard **до** делегирования; helper role guard не проверяет и не имеет EXECUTE ни у кого.

`explicit public_id` не принимается: параметра нет в сигнатуре.

**EXECUTE:** только `authenticated`. `service_role` явный EXECUTE не получает.

### 4.2 `crm_company_link_contact` (правка 6)

**Guard:** `super_admin | admin | menedzher`.

**Обязательный `_profile_id`:** `NULL` → `RAISE EXCEPTION 'profile_id required in phase 2' USING ERRCODE='22023'` (external contacts — Phase 9).

**Валидация target company:** `SELECT ... FOR UPDATE`; `status='merged'` → error `merged company is not linkable`.

**Race-safe upsert по `(company_id, profile_id, relationship_type)`:**

```sql
INSERT INTO public.company_contacts (
  company_id, profile_id, relationship_type,
  is_billing_contact, source, source_client_legal_details_map_id,
  created_by, updated_by
) VALUES (...)
ON CONFLICT (company_id, profile_id, relationship_type) DO UPDATE
SET is_billing_contact = company_contacts.is_billing_contact OR EXCLUDED.is_billing_contact,
    is_primary         = company_contacts.is_primary,          -- не понижаем
    source_client_legal_details_map_id =
      COALESCE(company_contacts.source_client_legal_details_map_id,
               EXCLUDED.source_client_legal_details_map_id),
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
RETURNING id INTO v_id;
```

`is_billing_contact=true` → guard:

```sql
IF _is_billing_contact THEN
  IF _source <> 'billing_requisites' THEN RAISE EXCEPTION 'billing flag requires source=billing_requisites'; END IF;
  IF _source_client_legal_details_map_id IS NULL THEN RAISE EXCEPTION 'map id required'; END IF;
  PERFORM 1 FROM public.client_legal_details_company_map m
    WHERE m.id = _source_client_legal_details_map_id AND m.company_id = _company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'map does not belong to company'; END IF;
END IF;
```

Событие `company.linked_to_contact.v1` пишется только при фактическом INSERT или при материальном изменении (не при no-op ON CONFLICT DO UPDATE с идентичными значениями). Определение "материальное" — правка 10, §8.

**EXECUTE:** только `authenticated`.

### 4.3 `crm_company_upsert_from_billing(_client_legal_details_id uuid)` (правка 5, 16)

**EXECUTE:** только `service_role`. Никакого EXECUTE у `authenticated`.

**Guard:**

```sql
SELECT * INTO v_cld FROM public.client_legal_details WHERE id=_client_legal_details_id;
IF NOT FOUND THEN RAISE EXCEPTION 'cld not found'; END IF;
-- purpose и client_type проверяются по актуальной схеме client_legal_details (freeze §7):
--   purpose='billing' AND client_type IN ('legal_entity','entrepreneur')
```

**Не вызывает `crm_company_get_or_create` напрямую** (правка 5). Использует `_crm_company_resolve_or_create_internal`, у которого нет role guard, но есть тот же concurrency-safe алгоритм из §4.1.

**Не читает `purpose='document'`**. **Не изменяет** `client_legal_details`. **Не создаёт** `client_legal_details_company_map` и `company_contacts` (это Phase 3).

**Ownership алгоритм (правки 5.4 плана, 16):** обновление mutable billing-полей выполняется в одной транзакции с обновлением `metadata.company_sync.billing_snapshot`:

```
FOR each field IN (short_name, legal_form, legal_address, legal_address_structured,
                   email, phone, director_name, director_position, acts_on_basis,
                   bank_account, bank_name, bank_code, full_name):
  v_target := companies.<field>
  v_snapshot := metadata->'company_sync'->'billing_snapshot'->>'<field>'
  v_billing := <normalized billing value>

  IF v_target IS NULL:
      SET companies.<field> := v_billing
      snapshot[<field>] := v_billing
  ELSIF v_target = v_snapshot:
      SET companies.<field> := v_billing
      snapshot[<field>] := v_billing
  ELSE:  -- admin/import override
      snapshot[<field>] := v_billing
      INSERT crm_activity_log(activity_type='company.field.override_conflict', ...)
```

`country`, `unp_normalized`, `company_kind` — только при INSERT. `grp_*` этот RPC не изменяет.

Правка 16: snapshot хранит **нормализованные** значения; дополнительно ведутся:

```
metadata.company_sync.last_billing_client_legal_details_id
metadata.company_sync.last_billing_synced_at
metadata.company_sync.last_billing_source_updated_at   -- client_legal_details.updated_at на момент sync
```

Stale row (когда `client_legal_details.updated_at < last_billing_source_updated_at`) → выходим без изменений, идемпотентно возвращаем company_id.

### 4.4 `search_companies(_filters jsonb)` (правка 9)

**RETURNS jsonb** формата:

```
{ "items": [...], "total": <bigint>, "limit": <int>, "offset": <int> }
```

**Валидация фильтров:**

- Whitelist ключей: `q, status[], company_kind[], country, profile_id, include_merged, limit, offset, sort_by, sort_dir`. Неизвестный ключ → `RAISE EXCEPTION 'unknown filter key: %'`.
- `limit`: integer в `[1..100]`; `offset >= 0`.
- `sort_by ∈ {created_at, full_name, public_id}`; `sort_dir ∈ {asc, desc}`.
- `status[] ⊆ {active, archived, merged}`; `company_kind[] ⊆ {legal_entity, entrepreneur, foreign, unknown}`.
- Пустые строки → `NULL`.
- `include_merged` default `false`.
- `profile_id` фильтруется через `EXISTS (SELECT 1 FROM company_contacts cc WHERE cc.company_id=c.id AND cc.profile_id=$1)` — без JOIN, чтобы не дублировать компании.

**Полнотекстовый `q`** ищет по `public_id, full_name, short_name, unp_normalized, email, phone` через `ILIKE` (Phase 2 не вводит новых индексов; полнотекстовый индекс — отдельный follow-up).

**Никаких банковских реквизитов в list response**: возвращаемые поля — `id, public_id, full_name, short_name, unp_normalized, country, company_kind, status, email, phone, created_at`.

**Guard:** `super_admin | admin | menedzher | support` → allow; `admin_gost | editor | user` → `RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'`.

**Merged rows** скрыты, если `include_merged=false`.

**Dynamic SQL:** identifier `sort_by`/`sort_dir` подставляются только из whitelist через `format('... ORDER BY %I %s', v_sort_by, v_sort_dir)`; значения — bind-параметры.

**EXECUTE:** только `authenticated`.

### 4.5 `crm_company_merge(_source_id, _target_id)` (правка 7)

**Guard:** `super_admin | admin`.

**Preflight:**

- `_source_id <> _target_id`;
- Разрешение source через цепочку `merged_into_company_id` (до "листа") — merge merged→merged невозможен, но повторный вызов `merge(source_already_merged_into_target, target)` возвращает `target` без событий (идемпотентно);
- Запрет циклов: если resolved target когда-либо ведёт назад к source — error;
- Одинаковый `workspace_id`;
- Target не может иметь `status='merged'`.

**Locking:** `SELECT ... FOR UPDATE` двух строк в детерминированном порядке `LEAST(source,target), GREATEST(...)`. `FOR UPDATE` также на переносимых `client_legal_details_company_map` и `company_contacts`.

**Перенос map:** `UPDATE client_legal_details_company_map SET company_id=_target_id WHERE company_id=_source_id;`

**Перенос contacts (конфликт по `(company_id, profile_id, relationship_type)`):** для каждого source-link:

- если на target уже есть строка с тем же ключом → merge полей: `is_billing_contact := OR`, `is_primary := OR`, `source_client_legal_details_map_id` — сохраняется target'овый, если непустой, иначе берётся source'овый; после этого source-link удаляется;
- если конфликта нет → `UPDATE company_contacts SET company_id=_target_id WHERE id=<source_link_id>`.

Правило выбора billing lineage при конфликте: valid billing (`source='billing_requisites'` + существующий map) имеет приоритет.

**Target fields:** автоматически **не переписываются** полями source.

**Source row:**

```
status='merged', merged_into_company_id=_target_id,
metadata.merged := { at: now(), by: auth.uid(), from: source_public_id, into: target_public_id }
```

**Hard delete запрещён.**

Событие `company.merged.v1` + `audit_logs(action='company.merge')` — только при первом фактическом merge (когда source ранее был `active` или `archived`). Повторный вызов на уже merged source в тот же target — no-op, возвращает target UUID, без событий.

### 4.6 `crm_company_archive(_id, _reason)` (правка 13)

**Guard:** `super_admin | admin`.

**Reason:** `NULL` или пустая строка → error.

**Preflight:** `status='merged'` → error. `status='archived'`:

- если `metadata.archive.reason = _reason` → idempotent, вернуть id, без событий;
- если `metadata.archive.reason <> _reason` → `RAISE EXCEPTION 'company already archived with different reason'` (правка 13: не молчаливая перезапись).

**Update:**

```
status='archived', archived_at=now(),
metadata.archive := { reason: _reason, by: auth.uid(), at: now() }
```

Связи не удаляются. Событие `company.archived.v1` + `audit_logs(action='company.archive')`.

### 4.7 `crm_company_grp_refetch(_id)` (правка 8)

**Guard:** `super_admin | admin | menedzher`.

**Валидация:** company существует, `status='active'`.

**Дедупликация:**

```sql
PERFORM pg_advisory_xact_lock(hashtext('company_grp_refetch:'||_id::text));

SELECT id INTO v_existing FROM public.company_sync_queue
WHERE entity_type='company' AND entity_id=_id AND run_reason='grp_refetch'
  AND status IN ('queued','running')
FOR UPDATE;

IF FOUND THEN RETURN v_existing; END IF;

v_key := 'company:'||_id::text||':grp_refetch:'||gen_random_uuid()::text;
INSERT INTO public.company_sync_queue (entity_type, entity_id, run_reason, status, idempotency_key, next_run_at, payload, created_by)
VALUES ('company', _id, 'grp_refetch', 'queued', v_key, now(), '{}'::jsonb, auth.uid())
RETURNING id INTO v_new;
```

Постоянный ключ `company:{id}:grp_refetch` **не** используется (иначе после `done` повторный refetch навсегда заблокирован). Уникальный `idempotency_key` включает UUID; логическая дедупликация обеспечена проверкой `status IN ('queued','running')`.

Событие `company.grp_refetch_requested.v1` — только при создании новой queue-строки.

Worker и HTTP-вызов GRP — Phase 4.

---

## 5. `search_global` — additive branch `company`

**Сигнатура и return type не меняются.** Ветки `contacts/deals/messages` остаются семантически идентичны (полный pre-Phase-2 body сохранён в §12 rollback с md5=`7641d12fc0bea802a93935a384e7e349`).

Новая ветка `companies`:

```sql
IF (
  public.has_role_v2(v_user_id, 'super_admin') OR public.has_role_v2(v_user_id, 'admin') OR
  public.has_role_v2(v_user_id, 'menedzher')   OR public.has_role_v2(v_user_id, 'support')
) THEN
  SELECT coalesce(jsonb_agg(row_to_json(c)), '[]'::jsonb) INTO v_companies
  FROM (
    SELECT c.id, c.public_id, c.full_name, c.short_name, c.unp_normalized, c.country,
           c.company_kind, c.status, 'company'::text AS entity
    FROM public.companies c
    WHERE c.status <> 'merged'
      AND (c.public_id ILIKE '%'||p_query||'%'
        OR c.full_name ILIKE '%'||p_query||'%'
        OR c.short_name ILIKE '%'||p_query||'%'
        OR c.unp_normalized ILIKE '%'||p_query||'%')
    LIMIT p_limit OFFSET p_offset
  ) c;
ELSE
  v_companies := '[]'::jsonb;
END IF;
```

Результат:

```
{ contacts, deals, messages, companies }
```

Универсальный `search_entities` **не создаётся**.

---

## 6. Security matrix (§8 плана)

Все RPC: `SECURITY DEFINER`, `SET search_path=public`, owner=`postgres`, PUBLIC/anon EXECUTE = none.

| RPC | authenticated | service_role |
|---|---|---|
| `crm_company_get_or_create` | EXECUTE | none |
| `crm_company_link_contact` | EXECUTE | none |
| `search_companies` | EXECUTE | none |
| `crm_company_merge` | EXECUTE | none |
| `crm_company_archive` | EXECUTE | none |
| `crm_company_grp_refetch` | EXECUTE | none |
| `crm_company_upsert_from_billing` | none | EXECUTE |
| `_crm_company_resolve_or_create_internal` (private helper, правки 5, 15) | none | none |

Role matrix: read — `super_admin, admin, menedzher, support`; write/link/create — `super_admin, admin, menedzher`; archive/merge — `super_admin, admin`; deny — `admin_gost, editor, user`. Global default privileges не меняются.

---

## 7. Billing mapping `client_legal_details → companies`

| target `companies.<col>` | client_type=`legal_entity` | client_type=`entrepreneur` | normalization | ownership |
|---|---|---|---|---|
| `country` | `'BY'` (freeze) | `'BY'` | upper | set-once |
| `unp_normalized` | `leg_unp` | `ent_unp` | `regexp '\D'→''` | set-once, required |
| `company_kind` | `'legal_entity'` | `'entrepreneur'` | — | set-once |
| `full_name` | `leg_org_form \|\| ' ' \|\| leg_name` (trim) | `ent_name` | trim | admin-override snapshot |
| `short_name` | `leg_name` | `ent_name` | trim | admin-override snapshot |
| `legal_form` | `leg_org_form` | NULL | trim | admin-override snapshot |
| `legal_address` | `leg_address` | `ent_address` | trim | admin-override snapshot |
| `director_name` | `leg_director_name` | NULL | trim | admin-override snapshot |
| `director_position` | `leg_director_position` | NULL | trim | admin-override snapshot |
| `acts_on_basis` | `leg_acts_on_basis` (default `'Устава'`) | `ent_acts_on_basis` (default `'свидетельства…'`) | trim | admin-override snapshot |
| `bank_account` | `bank_account` | `bank_account` | trim | admin-override snapshot |
| `bank_name` | `bank_name` | `bank_name` | trim | admin-override snapshot |
| `bank_code` | `bank_code` (при наличии колонки) | `bank_code` | trim | admin-override snapshot |
| `email`, `phone` | оставить из billing если пусто в client_legal_details — правило "target NULL → set", иначе admin-override snapshot | | trim | admin-override snapshot |
| `grp_*` | не пишется этим RPC (Phase 4 worker) | | | |

`purpose='document'` не читается никогда.

---

## 8. Event/audit matrix (правка 10)

| Операция | `domain_events.event_type` | `crm_activity_log` | `audit_logs.action` | Условие создания |
|---|---|---|---|---|
| get-or-create (manual) | `company.created.v1` | `company.created` | `company.create` | только при INSERT |
| get-or-create (billing_requisites) | `company.created.v1` | `company.created` | — | только при INSERT |
| get-or-create (backfill) | `company.created.v1` | — | — | только при INSERT |
| billing upsert | `company.upserted_from_billing.v1` | override-conflicts построчно | — | только при фактическом изменении canonical полей или snapshot |
| link contact | `company.linked_to_contact.v1` | `company.linked_to_contact` | — | INSERT или материальное изменение (`is_billing_contact` перешёл false→true, source_map установлен впервые) |
| merge | `company.merged.v1` | `company.merged` | `company.merge` | только при первом merge (source ранее `active`/`archived`) |
| archive | `company.archived.v1` | `company.archived` | `company.archive` | только при переходе `active → archived` |
| GRP refetch | `company.grp_refetch_requested.v1` | — | — | только при создании новой queue-строки |

`entity_id` во всех случаях = canonical `companies.id` (для merge — `_source_id`, payload содержит `into=_target_id`). `idempotency_key` в `crm_activity_log` = `company:{id}:{action}:{semantic_hash}` — обеспечивает подавление дубликатов при retry.

Backfill-события в Phase 2 не эмитируются массово (backfill — Phase 3).

---

## 9. Migration order (§9 плана)

Единственная миграция:

```
supabase/migrations/<ts>_crm_companies_phase2_rpc_layer.sql
```

Внутри одной транзакции:

```sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 1. DO guards: baseline hash, 4 таблицы, ACL, 13 policies, skeleton signatures, pre-Phase-2 search_global md5=7641d12fc0bea802a93935a384e7e349
DO $$ ... $$;

-- 2. Private helper
CREATE OR REPLACE FUNCTION public._crm_company_resolve_or_create_internal(...) ...
REVOKE ALL ON FUNCTION public._crm_company_resolve_or_create_internal(...) FROM PUBLIC, anon, authenticated, service_role;

-- 3. CREATE OR REPLACE двух skeleton RPC (сигнатуры Phase 1 сохранены)
CREATE OR REPLACE FUNCTION public.crm_company_get_or_create(...) ...
CREATE OR REPLACE FUNCTION public.crm_company_link_contact(...) ...

-- 4. Пять новых RPC
CREATE FUNCTION public.crm_company_upsert_from_billing(...) ...
CREATE FUNCTION public.search_companies(...) ...
CREATE FUNCTION public.crm_company_merge(...) ...
CREATE FUNCTION public.crm_company_archive(...) ...
CREATE FUNCTION public.crm_company_grp_refetch(...) ...

-- 5. ACL для всех
REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION ... TO authenticated;                 -- 6 RPC
GRANT EXECUTE ON FUNCTION public.crm_company_upsert_from_billing(uuid) TO service_role;

-- 6. Replacement search_global (LAST)
CREATE OR REPLACE FUNCTION public.search_global(...) ...
-- ACL search_global сохраняется как в pre-Phase-2 snapshot

-- 7. Post-apply DO invariants: ACL matrix, no PUBLIC EXECUTE, baseline hash unchanged.
```

**Pre-execution артефакты (правка 12):**

- отдельный commit;
- SHA-256 файла миграции;
- нормализованный diff `search_global` (pre vs post);
- exact filename;
- отдельный execution approve.

Migration history: после применения — попытка чтения `supabase_migrations.schema_migrations`; результат = `VERIFIED` либо `NOT VERIFIED — permission denied` (не блокирует, если применение подтверждено post-migration catalog state).

---

## 10. Runtime proof (правки 11, 17)

**Последовательность (исполнимая):**

```
1. Preflight (read-only).
2. Отдельный commit migration артефактов (без применения).
3. Отдельный execution approve.
4. Apply migration (авто, атомарно).
5. Отдельная транзакция runtime proof:
   BEGIN;
   SAVEPOINT proof;
   -- как authenticated JWT для user_id=37e91f59-… (menedzher):
   --   crm_company_get_or_create OK; повторный OK и одинаковый UUID; CMP-000001;
   --   crm_company_link_contact OK; повторный OK, не дублируется; invalid billing lineage — reject;
   --   search_companies filters/pagination; support-view; admin_gost deny; editor deny; user deny;
   --   crm_company_grp_refetch: первый вызов → queue строка; повторный → тот же id;
   --   crm_company_archive / crm_company_merge — deny для menedzher (правильно);
   -- как service_role:
   --   crm_company_upsert_from_billing (create/update/stale/no-op/admin-override preservation);
   -- как admin fixture (когда появится):
   --   crm_company_archive / crm_company_merge с конфликтующими links;
   -- verify: company branch в search_global;
   ROLLBACK TO SAVEPOINT proof;
   ROLLBACK;
6. Read-only подтверждение: 4 таблицы пусты, public_id_sequences.last_value=0, activity/events/audit/queue не содержат тестовых строк.
```

**Blocker (правка 6 плана §2.6):** admin fixture отсутствует (`1@ajoure.by` = `menedzher`). Runtime proof частично исполним под `menedzher` + `service_role`; полный proof (archive/merge) откладывается до появления admin fixture или отдельного решения. Если это не приемлемо — статус `RUNTIME PROOF BLOCKED — admin fixture required` фиксируется до execution approve; migration в этом случае не применяется (правка 11).

**Failure handling:** если post-commit runtime proof не прошёл — Phase 2 closure блокируется, Phase 3 не начинается, migration не редактируется, автоматический rollback не запускается; составляется blocker-отчёт и принимается отдельное решение о corrective migration или rollback.

---

## 11. Full migration SQL

Полный SQL готовится и коммитится отдельным файлом `supabase/migrations/<ts>_crm_companies_phase2_rpc_layer.sql` перед execution approve. Структура — §9. Точный текст в этом DRAFT не размещён намеренно: правки 4/5/6/7/8/9 требуют финальной ревизии владельцем изменения перед фиксацией SHA-256. В момент commit SHA-256 фиксируется в отдельном сообщении и вставляется в этот раздел.

---

## 12. Full rollback SQL

Файл: `.lovable/rollback/companies-phase2/phase2_rpc_rollback.sql` (создаётся отдельным DRAFT-коммитом при подготовке execution).

Содержание:

1. `CREATE OR REPLACE FUNCTION public.crm_company_get_or_create(...)` с exact Phase 1 skeleton body (заголовок RAISE `not implemented in phase 1`);
2. `CREATE OR REPLACE FUNCTION public.crm_company_link_contact(...)` с exact Phase 1 skeleton body;
3. `DROP FUNCTION IF EXISTS public.crm_company_upsert_from_billing(uuid)` — без CASCADE;
4. `DROP FUNCTION IF EXISTS public.search_companies(jsonb)` — без CASCADE;
5. `DROP FUNCTION IF EXISTS public.crm_company_merge(uuid, uuid)` — без CASCADE;
6. `DROP FUNCTION IF EXISTS public.crm_company_archive(uuid, text)` — без CASCADE;
7. `DROP FUNCTION IF EXISTS public.crm_company_grp_refetch(uuid)` — без CASCADE;
8. `DROP FUNCTION IF EXISTS public._crm_company_resolve_or_create_internal(...)` — последней (после drop зависимых RPC);
9. `CREATE OR REPLACE FUNCTION public.search_global(text, integer, integer)` с exact pre-Phase-2 body (md5=`7641d12fc0bea802a93935a384e7e349`, полный текст сохранён в §2.3 snapshot);
10. Восстановление pre-Phase-2 ACL для `search_global` и двух skeleton RPC (matrix Phase 1 ACL hardening).

Rollback **не изменяет** таблицы и данные. Не выполняется без отдельного решения.

---

## 13. Stop-guards (§12 плана)

Немедленная остановка при любом из:

- дрейф Phase 1 schema/ACL/policies;
- неожиданные данные в 4 таблицах;
- отличия skeleton signatures;
- не удаётся получить exact definition `search_global` (fallback md5 в §2.3);
- admin fixture отсутствует и runtime proof для archive/merge критичен для approve;
- billing mapping неоднозначен (см. §7);
- ownership algorithm требует изменения frozen schema;
- ADR-0002 требует новый DDL (см. §3);
- runtime proof нельзя выполнить (правка 11 задаёт fallback-статус);
- diff затрагивает UI, edge functions, backfill, worker или таблицы;
- migration history/SHA не зафиксированы до исполнения (правка 12).

---

## 14. Файловый scope этапа DRAFT

```
.lovable/discovery/companies-1.0/adr-0002-company-external-ids.md
.lovable/discovery/companies-1.0/companies_phase2_runnable_plan.md
```

Ничего другого. Никаких изменений в: `supabase/migrations/**`, существующих RPC, таблицах и данных, `.lovable/plan.md`, `src/**`, `supabase/functions/**`, `supabase/config.toml`.

---

## 15. DoD этапа

- Созданы ровно два DRAFT-файла (§14).
- Никаких изменений БД, миграций, RPC, UI, edge functions, `.lovable/plan.md`, `supabase/config.toml`.
- Все утверждения о текущем состоянии подкреплены фактическими read-only outputs (§2).
- ADR-0002 подтверждает переиспользование `integration_field_mappings` как field-mapping dictionary и явно откладывает `company_external_ids` lookup-таблицу до Phase 9.
- Runnable-план содержит: RPC signatures, ACL matrix, billing mapping, ownership algorithm, event/audit contracts, migration order, rollback описание, stop-guards, runtime proof последовательность.
- Phase 2 миграция **не запускается** до отдельного execution approve и до фиксации SHA-256/commit артефактов миграции и rollback.
