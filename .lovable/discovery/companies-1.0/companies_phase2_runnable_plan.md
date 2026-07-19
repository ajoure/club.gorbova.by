# Runnable plan: CRM Companies — Phase 2 Canonical RPC Layer

**Status:** `CLOSED PASS — APPLIED, CORRECTED, RUNTIME + CONCURRENCY PROVED, CLEAN BASELINE RESTORED`
**Date:** 2026-07-19 (final closure — Phase 2 complete; Phase 3/backfill not started)
**Phase 1 closure commit:** `ab2d4b05321938c01cf7ada07dda40c9a3e7de86`
**Database ref:** `hdjgkjceownmmnrqqtuz`
**Baseline schema hash:** `c41160b83c8e15c3d3c41a13028700d5` (подтверждён §2)
**Related ADR:** `adr-0002-company-external-ids.md`

---

## 1. Scope

**In-scope DRAFT-этапа (только markdown, никаких изменений БД):**

```
.lovable/discovery/companies-1.0/adr-0002-company-external-ids.md
.lovable/discovery/companies-1.0/companies_phase2_runnable_plan.md
```

**RPC, реализуемые Phase 2 миграцией (после отдельного execution approve):**

1. `public.crm_company_get_or_create` — полная реализация (сигнатура Phase 1 сохранена);
2. `public.crm_company_link_contact` — полная реализация (сигнатура Phase 1 сохранена);
3. `public.crm_company_upsert_from_billing(_client_legal_details_id uuid)` — новая, service-role only;
4. `public.search_companies(_filters jsonb)` — новая;
5. `public.crm_company_merge(_source_id uuid, _target_id uuid)` — новая;
6. `public.crm_company_archive(_id uuid, _reason text)` — новая;
7. `public.crm_company_grp_refetch(_id uuid)` — новая, queue-only;
8. `public.search_global(text, integer, integer)` — additive branch `company` (правка §6);
9. `public._crm_company_resolve_or_create_internal` — private helper resolve/create (правки 5, 15).

**Out-of-scope:** backfill; trigger на `client_legal_details`; `company-sync-worker`; cron; `orders_v2.company_id`; `crm_tasks.company_id`; UI `/admin/companies`; feature flag; admin section/resource inserts; CSV/Amo import; documents compatibility; hierarchy; `company_contact_person_map`; изменение global default privileges; универсальный `search_entities`.

---

## 2. Read-only discovery outputs (фактические, машинные)

### 2.1 Snapshot 2026-07-19

```
companies         = companies
company_contacts  = company_contacts
map               = client_legal_details_company_map
queue             = company_sync_queue
row counts        = 0, 0, 0, 0
public_id_sequences('company','CMP').last_value = 0
schema_hash(seven discovery tables) = c41160b83c8e15c3d3c41a13028700d5   -- MATCH baseline
```

### 2.2 RLS и ACL четырёх таблиц (pg_class.relacl, pg_class.relrowsecurity)

```
companies                          relrowsecurity=true
  postgres=arwdDxtm/postgres
  service_role=arwdDxtm/postgres
  authenticated=arwd/postgres
  sandbox_exec_hdjgkjceownmmnrqqtuz=ar/postgres
  sandbox_exec=ar/postgres

client_legal_details_company_map   relrowsecurity=true
  postgres=arwdDxtm/postgres
  service_role=arwdDxtm/postgres
  authenticated=arwd/postgres
  sandbox_exec_hdjgkjceownmmnrqqtuz=ar/postgres
  sandbox_exec=ar/postgres

company_contacts                   relrowsecurity=true
  postgres=arwdDxtm/postgres
  service_role=arwdDxtm/postgres
  authenticated=arwd/postgres
  sandbox_exec_hdjgkjceownmmnrqqtuz=ar/postgres
  sandbox_exec=ar/postgres

company_sync_queue                 relrowsecurity=true
  postgres=arwdDxtm/postgres
  service_role=arwdDxtm/postgres
  sandbox_exec_hdjgkjceownmmnrqqtuz=ar/postgres
  sandbox_exec=ar/postgres
  -- authenticated: no privileges  (Phase 1 hardening contract met)
```

### 2.3 Policies (13 строк, полный вывод)

Все policies `TO authenticated`. `polcmd`: `r=SELECT, a=INSERT, w=UPDATE, d=DELETE, *=ALL`.

```
1)  companies                          | a | insert for admin+manager
    USING: (null)
    WITH CHECK: has_role_v2(uid,'super_admin') OR has_role_v2(uid,'admin') OR has_role_v2(uid,'menedzher')
2)  companies                          | r | read for CRM staff
    USING: has_role_v2(uid,'super_admin') OR has_role_v2(uid,'admin') OR has_role_v2(uid,'menedzher') OR has_role_v2(uid,'support')
3)  companies                          | w | update for admin+manager
    USING: has_role_v2(uid,'super_admin') OR has_role_v2(uid,'admin') OR has_role_v2(uid,'menedzher')
4)  companies                          | d | delete for super_admin
    USING: has_role_v2(uid,'super_admin')

5)  client_legal_details_company_map   | a | insert for admin+manager
    WITH CHECK: same triple
6)  client_legal_details_company_map   | r | read for CRM staff
7)  client_legal_details_company_map   | w | update for admin+manager
8)  client_legal_details_company_map   | d | delete for super_admin

9)  company_contacts                   | a | insert for admin+manager
10) company_contacts                   | r | read for CRM staff
11) company_contacts                   | w | update for admin+manager
12) company_contacts                   | d | delete for super_admin

13) company_sync_queue                 | * | service only
    TO service_role
    USING: true   WITH CHECK: true
```

Итого 13 policies без дрейфа. Phase 2 миграция policies **не изменяет** (правка §12).

### 2.4 Phase 1 функции — фактические сигнатуры и bodies

`crm_company_get_or_create` — owner=postgres, SECURITY DEFINER, search_path=public, ACL `{postgres=X, authenticated=X}` (Phase 1 hardening):

```sql
CREATE OR REPLACE FUNCTION public.crm_company_get_or_create(
  _country text, _unp text, _full_name text, _company_kind text,
  _source text, _source_client_legal_details_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin')
       OR has_role_v2(auth.uid(),'super_admin')
       OR has_role_v2(auth.uid(),'menedzher')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT id INTO v_id
  FROM public.companies
  WHERE country = _country AND unp_normalized = _unp AND status <> 'merged'
  LIMIT 1;
  RETURN v_id;
END;
$function$
```

`crm_company_link_contact` — owner=postgres, SECURITY DEFINER, search_path=public, ACL `{postgres=X, authenticated=X}`:

```sql
CREATE OR REPLACE FUNCTION public.crm_company_link_contact(
  _company_id uuid, _profile_id uuid, _relationship_type text,
  _is_billing_contact boolean, _source text, _source_client_legal_details_map_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin')
       OR has_role_v2(auth.uid(),'super_admin')
       OR has_role_v2(auth.uid(),'menedzher')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN NULL;
END;
$function$
```

`set_companies_public_id()` — trigger, owner=postgres, SECURITY INVOKER, search_path=public, ACL `{postgres=X}` (никакого EXECUTE снаружи):

```sql
CREATE OR REPLACE FUNCTION public.set_companies_public_id()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.public_id IS NOT NULL THEN
    RAISE EXCEPTION 'companies.public_id must not be provided explicitly; use next_public_id(''company'')';
  END IF;
  NEW.public_id := public.next_public_id('company');
  RETURN NEW;
END;
$function$
```

### 2.5 Pre-Phase-2 `search_global` — exact body и SHA-256

Owner=postgres, SECURITY DEFINER, search_path=public, ACL включает `authenticated=X`, `service_role=X`, `anon=X`, `PUBLIC=X`.

Exact body: полный канонический дословный текст сохранён в §12.4. SHA-256 сохранённого нормализованного текста:

```
3f52ef62916b655d386f56ea1a44d78e261037a19b8c83d674ce09f6dd967e9f
```

md5 того же текста для быстрой сверки: `7641d12fc0bea802a93935a384e7e349`. При применении миграции SHA-256 фактически прочитанного pre-migration definition обязан совпасть с указанным — иначе HARD STOP.

### 2.6 Тестовая учётная запись

```sql
SELECT u.id, u.email, array_agg(r.code) AS roles
FROM auth.users u
LEFT JOIN public.user_roles_v2 urv ON urv.user_id=u.id
LEFT JOIN public.roles r ON r.id=urv.role_id
WHERE u.email='1@ajoure.by' GROUP BY u.id, u.email;
```

Output:

```
user_id = 37e91f59-e4db-4840-b9c9-e760e634ddd1
email   = 1@ajoure.by
roles   = { menedzher }
```

**Отклонение от плана §3.6:** учётка имеет роль `menedzher`, а не `admin`. Runtime proof для `crm_company_archive` и `crm_company_merge` требует отдельной admin-fixture; до её появления фиксируется blocker `RUNTIME PROOF BLOCKED — admin fixture required` (правка 11). Пароль не читается и не сохраняется. Правка 17: учётка используется только для authenticated RPC; `crm_company_upsert_from_billing` проверяется отдельно под `service_role` без подмены JWT.

### 2.7 Ключевые индексы (полный список для Phase 2 объектов)

```
companies_pkey                UNIQUE (id)
companies_public_id_key       UNIQUE (public_id)
companies_unp_unique          UNIQUE (country, unp_normalized) WHERE unp_normalized IS NOT NULL AND status <> 'merged'
companies_created_at_idx      btree  (created_at DESC)
companies_kind_idx            btree  (company_kind)
companies_status_idx          btree  (status)

client_legal_details_company_map_pkey                             UNIQUE (id)
client_legal_details_company_map_client_legal_details_id_key      UNIQUE (client_legal_details_id)
cld_company_map_company_idx                                       btree  (company_id)

company_contacts_pkey                     UNIQUE (id)
company_contacts_unique_profile_rel       UNIQUE (company_id, profile_id, relationship_type)
company_contacts_company_idx              btree  (company_id)
company_contacts_profile_idx              btree  (profile_id)
company_contacts_billing_idx              btree  (company_id) WHERE is_billing_contact=true

company_sync_queue_pkey                   UNIQUE (id)
company_sync_queue_idempotency_key_key    UNIQUE (idempotency_key)
csq_status_next_idx                       btree  (status, next_run_at) WHERE status IN ('queued','running')
```

### 2.8 Event/audit таблицы — точные схемы

```
audit_logs(id uuid, actor_user_id uuid?, action text NN, target_user_id uuid?, meta jsonb?,
           actor_type text NN default 'user', actor_label text?, entity_type text?, entity_id text?, created_at timestamptz NN)
domain_events(id uuid, event_type text, source text, entity_id uuid, payload jsonb, created_at timestamptz)
crm_activity_log(id uuid, public_id text, contact_id uuid, user_id uuid, activity_type text,
                 source_entity_id uuid, source_entity_type text, live_event_id uuid,
                 title_snapshot text, text_snapshot text, author_snapshot text,
                 visibility_scope text, idempotency_key text, created_at timestamptz, metadata jsonb)
```

**Наблюдение для правки 10:** в `domain_events` нет отдельного поля `idempotency_key` и Phase 2 **НЕ** добавляет к shared-таблице `domain_events` никаких DDL (индексов, колонок, constraints). Подавление дублей полностью реализуется на write-side через private helper `public._crm_company_emit_domain_event` (§10.1): `pg_advisory_xact_lock` по хэшу `idempotency_key` + conditional INSERT with WHERE NOT EXISTS по `event_type` и `payload->>'idempotency_key'`. Для `crm_activity_log` write-side dedupe выполняется через `WHERE NOT EXISTS` по `(source_entity_type, source_entity_id, idempotency_key)`. Изменение схемы `domain_events` возможно только отдельным ADR и отдельным execution approve (см. §11.11).

---

## 3. ADR-0002 — итог

См. `adr-0002-company-external-ids.md`. Итог: `companies.external_ids` не добавляется; `integration_field_mappings` — field-mapping dictionary (0 строк, отсутствует `external_id`); отдельная lookup-таблица `company_external_ids` — Phase 9, отдельный ADR. Phase 2 core RPC не блокируется.

---

## 4. Билинг-маппинг `client_legal_details → companies` (machine-checkable, без «при наличии»)

Все source-колонки существуют в `client_legal_details` (подтверждено `information_schema.columns`). `bank_code`, `email`, `phone` присутствуют.

| target `companies.<col>` | client_type=`legal_entity` source | client_type=`entrepreneur` source | normalization | ownership |
|---|---|---|---|---|
| `country` | константа `'BY'` | константа `'BY'` | `upper` | set-once (INSERT) |
| `unp_normalized` | `leg_unp` | `ent_unp` | `regexp_replace(x,'\D','','g')`, требуется `length>0` | set-once (INSERT), required |
| `company_kind` | константа `'legal_entity'` | константа `'entrepreneur'` | — | set-once (INSERT) |
| `full_name` | `btrim(concat_ws(' ', leg_org_form, leg_name))` | `btrim(ent_name)` | trim, `NULLIF('',x)` | admin-override snapshot |
| `short_name` | `btrim(leg_name)` | `btrim(ent_name)` | trim | admin-override snapshot |
| `legal_form` | `btrim(leg_org_form)` | `NULL` | trim | admin-override snapshot |
| `legal_address` | `btrim(leg_address)` | `btrim(ent_address)` | trim | admin-override snapshot |
| `director_name` | `btrim(leg_director_name)` | `NULL` | trim | admin-override snapshot |
| `director_position` | `btrim(leg_director_position)` | `NULL` | trim | admin-override snapshot |
| `acts_on_basis` | `btrim(leg_acts_on_basis)` (default `'Устава'`) | `btrim(ent_acts_on_basis)` (default `'свидетельства о государственной регистрации'`) | trim | admin-override snapshot |
| `bank_account` | `btrim(bank_account)` | `btrim(bank_account)` | trim | admin-override snapshot |
| `bank_name` | `btrim(bank_name)` | `btrim(bank_name)` | trim | admin-override snapshot |
| `bank_code` | `btrim(bank_code)` | `btrim(bank_code)` | trim | admin-override snapshot |
| `email` | `lower(btrim(email))` | `lower(btrim(email))` | lower+trim | admin-override snapshot |
| `phone` | `regexp_replace(phone,'[^\d+]','','g')` | `regexp_replace(phone,'[^\d+]','','g')` | E.164-friendly | admin-override snapshot |
| `grp_*` | не пишется этим RPC | не пишется этим RPC | — | Phase 4 worker |
| `legal_address_structured` | не пишется этим RPC | не пишется этим RPC | — | отдельный follow-up |

`purpose='document'` не читается никогда. Источник — только `purpose='billing' AND client_type IN ('legal_entity','entrepreneur')`.

---

## 5. Ownership snapshot (правка 16)

```json
{
  "company_sync": {
    "billing_snapshot": {},
    "last_billing_client_legal_details_id": null,
    "last_billing_synced_at": null,
    "last_billing_source_updated_at": null
  }
}
```

Snapshot хранит **нормализованные** значения. Stale-detection: если `client_legal_details.updated_at < metadata.company_sync.last_billing_source_updated_at` — идемпотентный no-op.

Алгоритм (для каждого mutable-поля):

```
IF normalized_billing IS NULL:            -- last non-null wins
    target unchanged; snapshot[f] unchanged; conflict NOT recorded; f NOT в changed_fields
ELSIF target IS NULL:                     target := billing; snapshot[f] := billing;      changed_fields += f
ELSIF target IS NOT DISTINCT FROM snapshot[f]:
                                          target := billing; snapshot[f] := billing;      changed_fields += f
ELSE:  -- admin/import override сохраняется
    snapshot[f] := billing                -- фиксируем последний билинг для будущего сравнения
    conflict_fields += f
    INSERT crm_activity_log(activity_type='company.field.override_conflict',
                            metadata contains field ownership metadata for the updated field)
```

`country`, `unp_normalized`, `company_kind` — только при INSERT canonical company; в mutable-блоки НЕ включаются.

Для service-role billing-вызова обязательный `crm_activity_log.user_id` определяется как
`COALESCE(profiles.user_id, profiles.id)` по `client_legal_details.profile_id`: реальный auth-user
используется при наличии, а для ghost-profile сохраняется стабильный UUID профиля. Это не меняет
схему shared-таблицы. Auto-created billing company получает guarded `company.created`, а каждый
override conflict — guarded `company.field.override_conflict`. `crm_company_link_contact` пишет
guarded activity с тем же idempotency key, что и соответствующий domain event.

---

## 6. `search_global` — additive branch `company` (правка §6 плана)

Сигнатура и return type не меняются. Ветки `contacts/deals/messages` семантически идентичны pre-Phase-2 body (SHA-256 §2.5).

Дополнительная ветка `companies` доступна только read-ролям Phase 2:

```sql
IF (
  public.has_role_v2(v_user_id, 'super_admin') OR public.has_role_v2(v_user_id, 'admin') OR
  public.has_role_v2(v_user_id, 'menedzher')   OR public.has_role_v2(v_user_id, 'support')
) THEN
  SELECT coalesce(jsonb_agg(row_to_json(c)), '[]'::jsonb) INTO v_companies
  FROM (
    SELECT c.id, c.public_id, c.full_name, c.short_name, c.unp_normalized,
           c.country, c.company_kind, c.status, 'company'::text AS entity
    FROM public.companies c
    WHERE c.status <> 'merged'
      AND (c.public_id      ILIKE '%'||p_query||'%'
        OR c.full_name      ILIKE '%'||p_query||'%'
        OR c.short_name     ILIKE '%'||p_query||'%'
        OR c.unp_normalized ILIKE '%'||p_query||'%')
    LIMIT p_limit OFFSET p_offset
  ) c;
ELSE
  v_companies := '[]'::jsonb;
END IF;
```

Возврат: `{ contacts, deals, messages, companies }`. Существующий guard-блок (`has_role/has_permission/has_admin_section_access`) не меняется — company branch добавляет только собственный role-check, не расширяет доступ к остальным веткам. Универсальный `search_entities` не создаётся.

---

## 7. Merge-контракт (правка 7, полный)

### 7.1 Разрешение цепочки merged_into (fully)

```sql
-- рекурсивно "схлопываем" цепочку до листа
WITH RECURSIVE chain AS (
  SELECT id, merged_into_company_id, status, workspace_id, 1 AS depth
    FROM public.companies WHERE id = _target_id
  UNION ALL
  SELECT c.id, c.merged_into_company_id, c.status, c.workspace_id, chain.depth + 1
    FROM public.companies c
    JOIN chain ON c.id = chain.merged_into_company_id
    WHERE chain.depth < 32
)
SELECT id INTO v_target_leaf FROM chain
WHERE merged_into_company_id IS NULL AND status <> 'merged'
LIMIT 1;
IF v_target_leaf IS NULL THEN RAISE EXCEPTION 'target chain broken or cyclic'; END IF;
-- source guard: если source уже merged в v_target_leaf — идемпотентный возврат
```

### 7.2 Detection циклов

Ограничение глубины 32; кроме того проверка `NOT EXISTS recursive chain check where target down-chain reaches _source_id` перед UPDATE — цикл target-to-source chain запрещён.

### 7.3 Locking (детерминированный порядок)

```sql
PERFORM 1 FROM public.companies WHERE id = LEAST(_source_id, v_target_leaf) FOR UPDATE;
PERFORM 1 FROM public.companies WHERE id = GREATEST(_source_id, v_target_leaf) FOR UPDATE;
-- переносимые строки:
PERFORM 1 FROM public.client_legal_details_company_map WHERE company_id = _source_id FOR UPDATE;
PERFORM 1 FROM public.company_contacts               WHERE company_id = _source_id FOR UPDATE;
-- целевые (для стабильной конфликт-обработки contacts):
PERFORM 1 FROM public.company_contacts               WHERE company_id = v_target_leaf FOR UPDATE;
```

### 7.4 Перенос map

```sql
UPDATE public.client_legal_details_company_map
SET company_id = v_target_leaf, updated_at = now(), updated_by = auth.uid()
WHERE company_id = _source_id;
```

### 7.5 Перенос contacts — конфликты по `(company_id, profile_id, relationship_type)`

Строгое правило слияния строк:

```sql
FOR v_src IN SELECT * FROM public.company_contacts WHERE company_id = _source_id LOOP
  SELECT * INTO v_tgt FROM public.company_contacts
   WHERE company_id = v_target_leaf
     AND profile_id = v_src.profile_id
     AND relationship_type = v_src.relationship_type
   FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.company_contacts SET company_id = v_target_leaf,
      updated_at = now(), updated_by = auth.uid()
      WHERE id = v_src.id;
    CONTINUE;
  END IF;

  -- Оба существуют → детерминированное слияние.
  -- Выбор billing lineage: valid billing (source='billing_requisites' AND map существует
  -- AND map.company_id = v_target_leaf после переноса) имеет приоритет.
  -- 1) is_billing_contact/is_primary: OR
  -- 2) source_client_legal_details_map_id:
  --    - если у target уже есть валидная billing lineage → target сохраняется
  --    - иначе если у source lineage валиден и ссылается на map, перенесённый на target → берём source
  --    - иначе NULL
  -- 3) source (text): 'billing_requisites' > 'manual' > прочие; ordered priority
  -- 4) metadata: COALESCE(source,{}) || COALESCE(target,{}) — при коллизии top-level ключей target побеждает; отдельный deep-merge helper не вводится
  UPDATE public.company_contacts SET
    is_billing_contact = v_tgt.is_billing_contact OR v_src.is_billing_contact,
    is_primary         = v_tgt.is_primary         OR v_src.is_primary,
    source_client_legal_details_map_id = CASE
      WHEN v_tgt.source_client_legal_details_map_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.client_legal_details_company_map m
         WHERE m.id = v_tgt.source_client_legal_details_map_id
           AND m.company_id = v_target_leaf)
        THEN v_tgt.source_client_legal_details_map_id
      WHEN v_src.source_client_legal_details_map_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.client_legal_details_company_map m
         WHERE m.id = v_src.source_client_legal_details_map_id
           AND m.company_id = v_target_leaf)
        THEN v_src.source_client_legal_details_map_id
      ELSE NULL END,
    source = CASE
      WHEN v_tgt.source = 'billing_requisites' OR v_src.source = 'billing_requisites'
        THEN 'billing_requisites'
      WHEN v_tgt.source = 'manual' OR v_src.source = 'manual' THEN 'manual'
      ELSE COALESCE(v_tgt.source, v_src.source) END,
    metadata = COALESCE(v_src.metadata,'{}'::jsonb) || COALESCE(v_tgt.metadata,'{}'::jsonb),
    updated_at = now(), updated_by = auth.uid()
  WHERE id = v_tgt.id;

  DELETE FROM public.company_contacts WHERE id = v_src.id;
END LOOP;
```

Правило "победы" в `metadata`: `source_meta || target_meta` — при одинаковых ключах target выигрывает; далее из объединённой карты убираются служебные поля `merge_hint.*`, если появились.

### 7.6 Объединение metadata source/target на уровне компании

Поля `companies.<col>` target **не переписываются**. Merge затрагивает только `metadata`:

```sql
UPDATE public.companies SET
  metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
    'merge', jsonb_build_object(
      'consumed', COALESCE(metadata->'merge'->'consumed','[]'::jsonb) ||
                  jsonb_build_array(jsonb_build_object(
                    'source_id', _source_id,
                    'source_public_id', v_src_public_id,
                    'at', now(),
                    'by', auth.uid()
                  ))
    )
  ),
  updated_at = now(), updated_by = auth.uid()
WHERE id = v_target_leaf;

UPDATE public.companies SET
  status='merged',
  merged_into_company_id = v_target_leaf,
  metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
    'merged', jsonb_build_object(
      'at', now(),
      'by', auth.uid(),
      'from', v_src_public_id,
      'into', v_tgt_public_id
    )
  ),
  updated_at = now(), updated_by = auth.uid()
WHERE id = _source_id AND status <> 'merged';
```

### 7.7 Идемпотентность

Если source уже `merged` и `merged_into_company_id = v_target_leaf` — RPC возвращает `v_target_leaf` без UPDATE, без событий, без `audit_logs`. Merge в другой target — `RAISE EXCEPTION 'source already merged into different target'`.

Hard delete запрещён.

---

## 8. Event/audit matrix (правка 10, полный контракт)

Payload version — v1 у всех событий Phase 2. Все Phase 2 события пишутся в `domain_events` **исключительно** через private helper `public._crm_company_emit_domain_event` из §10.1. Никаких DDL на shared-таблице `domain_events` (индексов, constraints, колонок) Phase 2 не создаёт — дедупликация выполнена на write-side.

Сводка (7 public RPC + 1 private write helper + 1 private emit helper):

| Операция | `domain_events.event_type` | `payload` version=1 обязательные поля | `payload.idempotency_key` (формат) | `crm_activity_log.activity_type` / `crm_activity_log.idempotency_key` | `audit_logs.action` |
|---|---|---|---|---|---|
| get-or-create (INSERT новой компании) | `company.created.v1` | `{version:1, company_id, public_id, country, unp_normalized, company_kind, source, source_cld_id, actor_user_id, occurred_at}` | `company.created:{company_id}` | `company.created` / `company.created:{company_id}` | manual → `company.create:{company_id}`, иначе нет |
| billing upsert (материальное изменение) | `company.upserted_from_billing.v1` | `{version:1, company_id, cld_id, changed_fields[], override_conflict_fields[], source_updated_at, occurred_at}` | `company.upserted_from_billing:{company_id}:{cld_id}:{md5(sorted(changed_fields))}` | override conflicts построчно как `company.field.override_conflict` / `company.field.override_conflict:{company_id}:{field}:{cld_id}` | нет |
| link contact (INSERT или материальное UPDATE) | `company.linked_to_contact.v1` | `{version:1, company_id, contact_id, profile_id, relationship_type, is_billing_contact, source, source_map_id, occurred_at}` | `company.linked_to_contact:{contact_id}` (первое событие) / `company.linked_to_contact.updated:{contact_id}:{md5(changed_fields)}` | `company.linked_to_contact` / см. слева | нет |
| merge (первый) | `company.merged.v1` | `{version:1, source_id, source_public_id, target_id, target_public_id, moved_map_rows, moved_contact_rows, merged_contact_rows, occurred_at, actor_user_id}` | `company.merged:{source_id}:{target_id}` | `company.merged` / `company.merged:{source_id}:{target_id}` | `company.merge:{source_id}:{target_id}` |
| archive (первый переход) | `company.archived.v1` | `{version:1, company_id, reason, occurred_at, actor_user_id}` | `company.archived:{company_id}:{md5(reason)}` | `company.archived` / `company.archived:{company_id}` | `company.archive:{company_id}` |
| GRP refetch (новая queue) | `company.grp_refetch_requested.v1` | `{version:1, company_id, queue_id, idempotency_key, occurred_at, actor_user_id}` | `company.grp_refetch_requested:{queue_id}` | нет | нет |

**Материальное изменение** (для `company.linked_to_contact.v1`): `is_billing_contact` перешёл false→true; `source_client_legal_details_map_id` установлен впервые; `source` изменился на более высокий приоритет. Простой no-op ON CONFLICT (все поля идентичны) события не создаёт.

**Механизм подавления дублей в `domain_events`:** реализован в helper `_crm_company_emit_domain_event` (§10.1) через `pg_advisory_xact_lock(hashtextextended(_idempotency_key,0))` и conditional insert with `WHERE NOT EXISTS`. Внешнего EXECUTE у helper нет. DDL на `domain_events` не выполняется. Прямых `INSERT INTO public.domain_events` из тел Phase 2 RPC нет — весь трафик идёт через helper.

**Подавление дублей в `crm_activity_log`:**

```sql
Activity log write uses an explicit INSERT column list with SELECT source and `WHERE NOT EXISTS` idempotency guard.
WHERE NOT EXISTS (
  SELECT 1 FROM public.crm_activity_log
   WHERE source_entity_type = 'company'
     AND source_entity_id   = v_company_id
     AND idempotency_key    = v_key
);
```

**`audit_logs`:** guarded write через `WHERE NOT EXISTS` по `(action, entity_type='company', entity_id=<company_id>::text, meta->>'idempotency_key')`.

---

## 9. Security matrix

Всего Phase 2 предоставляет **7 public RPC + 2 private helper**; полный перечень зафиксирован в §1 п.1–9. Все `SECURITY DEFINER`, `SET search_path=public`, owner=`postgres`, `REVOKE ALL FROM PUBLIC, anon`. Из 7 public RPC — **6** получают `GRANT EXECUTE TO authenticated`, **1** (`crm_company_upsert_from_billing`) — `TO service_role`.

| RPC / helper | authenticated | service_role | anon / PUBLIC |
|---|---|---|---|
| `crm_company_get_or_create` (public) | EXECUTE | none | none |
| `crm_company_link_contact` (public) | EXECUTE | none | none |
| `search_companies` (public) | EXECUTE | none | none |
| `crm_company_merge` (public) | EXECUTE | none | none |
| `crm_company_archive` (public) | EXECUTE | none | none |
| `crm_company_grp_refetch` (public) | EXECUTE | none | none |
| `crm_company_upsert_from_billing` (public) | none | EXECUTE | none |
| `_crm_company_resolve_or_create_internal` (private helper) | none | none | none |
| `_crm_company_emit_domain_event` (private helper, §10.1) | none | none | none |
| `search_global` (existing, additive edit §6) | сохраняется фактический исходный ACL: authenticated/service_role = EXECUTE; anon/PUBLIC = none | — | — |

Role matrix (в теле RPC): read — `super_admin, admin, menedzher, support`; write/link/create — `super_admin, admin, menedzher`; archive/merge — `super_admin, admin`; deny — `admin_gost, editor, user`. Global default privileges не меняются.

---

## 10. Private helper (правка 15) — полный контракт

**Имя:** `public._crm_company_resolve_or_create_internal`.
**Owner:** `postgres`. **Security:** `SECURITY DEFINER`. **search_path:** `public`. **Language:** `plpgsql`.
**Сигнатура:**

```
_crm_company_resolve_or_create_internal(
  _country        text,
  _unp_normalized text,     -- нормализация делается вызывающим RPC
  _full_name      text,
  _company_kind   text,     -- 'legal_entity' | 'entrepreneur'
  _actor_user_id  uuid,     -- auth.uid() из wrapper либо NULL для service_role
  _source         text,
  _source_cld_id  uuid
) RETURNS uuid
```

**ACL:** `REVOKE ALL ON FUNCTION <phase2-private-helper-signature> FROM PUBLIC, anon, authenticated, service_role`. Никаких GRANT. Функцию можно вызвать только из другой функции того же owner (`postgres`).

**Dependency graph:**

```
crm_company_get_or_create        ──┐
crm_company_upsert_from_billing  ──┴──> _crm_company_resolve_or_create_internal
                                              │
                                              ▼
                              _crm_company_emit_domain_event (§10.1)
crm_company_link_contact        ──────────────▲
crm_company_merge               ──────────────┤
crm_company_archive             ──────────────┤
crm_company_grp_refetch         ──────────────┘
```

Никто вне Phase 2 эти два private helper не вызывает.

**Rollback order (§12):** сначала DROP public RPC (§12.2), затем `_crm_company_resolve_or_create_internal`, затем `_crm_company_emit_domain_event` — оба helper без CASCADE, после того как их callers удалены.

**Полный CREATE приведён в §11.2 (resolve) и §10.1 / §11.11 (emit).**

### 10.1 Private helper `_crm_company_emit_domain_event` (правка 10)

Специальный helper для дедуплицированной записи в shared-таблицу `public.domain_events`. Введён взамен ранее предполагавшегося `CREATE UNIQUE INDEX` на `domain_events` (правка 10) — DDL на shared-таблице Phase 2 не производит.

**Имя:** `public._crm_company_emit_domain_event`.
**Owner:** `postgres`. **Security:** `SECURITY DEFINER`. **search_path:** `public`. **Language:** `plpgsql`. **volatility:** `VOLATILE`.

**Сигнатура:**

```
_crm_company_emit_domain_event(
  _event_type      text,   -- 'company.*.v1'
  _entity_id       uuid,   -- companies.id
  _idempotency_key text,   -- формат из §8: company.operation:hash-or-id
  _payload         jsonb   -- полный payload v1 (без source, без event_type — источник фиксирован)
) RETURNS uuid              -- domain_events.id (существующего или нового) либо NULL если запись подавлена
```

**Алгоритм (строгий):**

1. Валидация: `_event_type LIKE 'company.%'` и не NULL; `_idempotency_key` не NULL и длиной ≥ 8; `_payload ? 'version'` и `_payload->>'version' = '1'`; `_payload->>'idempotency_key' = _idempotency_key` (иначе `RAISE EXCEPTION 'emit: payload/key mismatch'`).
2. `PERFORM pg_advisory_xact_lock(hashtextextended('crm_company_emit:' || _idempotency_key, 0));` — блокировка только в рамках текущей транзакции, авто-освобождение на COMMIT/ROLLBACK.
3. `SELECT id INTO v_existing FROM public.domain_events WHERE event_type=_event_type AND payload->>'idempotency_key'=_idempotency_key LIMIT 1;` — если найдено, вернуть NULL (запись подавлена, вызывающий RPC не считает это ошибкой).
4. `INSERT INTO public.domain_events(event_type, source, entity_id, payload) VALUES (_event_type, 'crm', _entity_id, _payload) RETURNING id INTO v_new;` — `source` жёстко зафиксирован (`'crm'`).
5. `RETURN v_new;`.
6. При любом исключении внутри helper — `RAISE`, без swallow.

**ACL:** `REVOKE ALL ON FUNCTION public._crm_company_emit_domain_event(text,uuid,text,jsonb) FROM PUBLIC, anon, authenticated, service_role`. Никаких GRANT. Вызов возможен только из другой функции owner `postgres`.

**Callers (полный список Phase 2):** `crm_company_get_or_create`, `crm_company_link_contact`, `crm_company_upsert_from_billing`, `crm_company_merge`, `crm_company_archive`, `crm_company_grp_refetch`, а также `_crm_company_resolve_or_create_internal` (для `company.created.v1`). Все Phase 2 RPC в §11 вызывают helper напрямую; прямых `INSERT INTO public.domain_events` в §11 не осталось (единственное вхождение — в теле самого helper в §10.1 / §11.11).

**Rollback order:** DROP выполняется **после** `_crm_company_resolve_or_create_internal` (§12.5).

**Инварианты пост-миграции (§11.12):** функция существует, ACL пуста, `pg_proc.prosecdef=true`, `proowner=postgres`.

**Явно вне scope:** любые DDL на `public.domain_events`, любые тригерры, любые indexes на `domain_events`, любой EXECUTE GRANT external ролям. Ослабление любого из этих ограничений требует отдельного ADR.

---

## 11. Полный migration SQL

<!-- PHASE2_FORWARD_SQL_BEGIN -->
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 11.1.a Preflight
DO $preflight$
DECLARE v_hash text; v_pol int; v_sg_sha text; v_sg_md5 text; v_sg_oid oid;
BEGIN
  -- 4 таблицы
  IF to_regclass('public.companies') IS NULL
     OR to_regclass('public.company_contacts') IS NULL
     OR to_regclass('public.client_legal_details_company_map') IS NULL
     OR to_regclass('public.company_sync_queue') IS NULL THEN
    RAISE EXCEPTION 'preflight: phase1 tables missing';
  END IF;

  -- RLS
  PERFORM 1 FROM pg_class WHERE relnamespace='public'::regnamespace
    AND relname IN ('companies','company_contacts','client_legal_details_company_map','company_sync_queue')
    AND NOT relrowsecurity;
  IF FOUND THEN RAISE EXCEPTION 'preflight: RLS drift'; END IF;

  -- 13 policies
  SELECT count(*) INTO v_pol FROM pg_policy pl JOIN pg_class c ON c.oid=pl.polrelid
   WHERE c.relnamespace='public'::regnamespace
     AND c.relname IN ('companies','company_contacts','client_legal_details_company_map','company_sync_queue');
  IF v_pol <> 13 THEN RAISE EXCEPTION 'preflight: expected 13 policies, got %', v_pol; END IF;

  -- Baseline hash
  SELECT md5(string_agg(table_name || ':' || column_name || ':' || data_type,
                        ',' ORDER BY table_name, ordinal_position))
    INTO v_hash
    FROM information_schema.columns
   WHERE table_schema='public'
     AND table_name IN ('client_legal_details','profiles','public_id_sequences','roles',
                        'role_admin_resource_access','role_admin_section_access','admin_section');
  IF v_hash <> 'c41160b83c8e15c3d3c41a13028700d5' THEN
    RAISE EXCEPTION 'preflight: baseline hash drift %', v_hash;
  END IF;

  -- Skeleton signatures
  PERFORM 1 FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='crm_company_get_or_create'
     AND pg_get_function_identity_arguments(oid)
         = '_country text, _unp text, _full_name text, _company_kind text, _source text, _source_client_legal_details_id uuid';
  IF NOT FOUND THEN RAISE EXCEPTION 'preflight: crm_company_get_or_create signature drift'; END IF;

  PERFORM 1 FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname='crm_company_link_contact'
     AND pg_get_function_identity_arguments(oid)
         = '_company_id uuid, _profile_id uuid, _relationship_type text, _is_billing_contact boolean, _source text, _source_client_legal_details_map_id uuid';
  IF NOT FOUND THEN RAISE EXCEPTION 'preflight: crm_company_link_contact signature drift'; END IF;

  -- pre-Phase-2 search_global executable hash guard: SHA-256 via pgcrypto.digest if present,
  -- otherwise md5(pg_get_functiondef(function_oid)) fallback fixed in §2.5.
  SELECT oid INTO v_sg_oid
    FROM pg_proc
   WHERE pronamespace='public'::regnamespace
     AND proname='search_global'
     AND pg_get_function_identity_arguments(oid) = 'p_query text, p_limit integer, p_offset integer';
  IF v_sg_oid IS NULL THEN
    RAISE EXCEPTION 'preflight: search_global(text,integer,integer) missing';
  END IF;

  IF to_regprocedure('digest(bytea,text)') IS NOT NULL THEN
    EXECUTE 'SELECT encode(digest(convert_to(pg_get_functiondef($1), ''UTF8''), ''sha256''), ''hex'')'
      INTO v_sg_sha
      USING v_sg_oid;
    IF v_sg_sha <> '3f52ef62916b655d386f56ea1a44d78e261037a19b8c83d674ce09f6dd967e9f' THEN
      RAISE EXCEPTION 'preflight: search_global body drifted from expected SHA (got %)', v_sg_sha;
    END IF;
  ELSE
    SELECT md5(pg_get_functiondef(v_sg_oid)) INTO v_sg_md5;
    IF v_sg_md5 <> '7641d12fc0bea802a93935a384e7e349' THEN
      RAISE EXCEPTION 'preflight: search_global body drifted from expected md5 fallback (got %)', v_sg_md5;
    END IF;
  END IF;
END
$preflight$;
-- 11.2.a Private emit helper — дедуплицированная запись в domain_events (§10.1)
CREATE OR REPLACE FUNCTION public._crm_company_emit_domain_event(
  _event_type      text,
  _entity_id       uuid,
  _idempotency_key text,
  _payload         jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_existing uuid; v_new uuid;
BEGIN
  IF _event_type IS NULL OR _event_type NOT LIKE 'company.%' THEN
    RAISE EXCEPTION 'emit: bad event_type %', _event_type;
  END IF;
  IF _idempotency_key IS NULL OR length(_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'emit: bad idempotency_key';
  END IF;
  IF NOT (_payload ? 'version') OR (_payload->>'version') <> '1' THEN
    RAISE EXCEPTION 'emit: payload version must be 1';
  END IF;
  IF coalesce(_payload->>'idempotency_key','') <> _idempotency_key THEN
    RAISE EXCEPTION 'emit: payload/key mismatch';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('crm_company_emit:' || _idempotency_key, 0));

  SELECT id INTO v_existing FROM public.domain_events
   WHERE event_type = _event_type
     AND payload->>'idempotency_key' = _idempotency_key
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN NULL;  -- дубль подавлен
  END IF;

  INSERT INTO public.domain_events(event_type, source, entity_id, payload)
  VALUES (_event_type, 'crm', _entity_id, _payload)
  RETURNING id INTO v_new;
  RETURN v_new;
END $$;

-- 11.2.b Private resolve/create helper

CREATE OR REPLACE FUNCTION public._crm_company_resolve_or_create_internal(
  _country text, _unp_normalized text, _full_name text, _company_kind text,
  _actor_user_id uuid, _source text, _source_cld_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_row     public.companies%ROWTYPE;
  v_leaf    public.companies%ROWTYPE;
  v_id      uuid;
  v_country text;
  v_meta    jsonb;
  v_next    uuid;
  v_seen    uuid[] := '{}';
  v_depth   int := 0;
BEGIN
  IF _company_kind NOT IN ('legal_entity','entrepreneur') THEN
    RAISE EXCEPTION 'company_kind must be legal_entity or entrepreneur' USING ERRCODE='22023';
  END IF;
  IF _unp_normalized IS NULL OR length(_unp_normalized) = 0 THEN
    RAISE EXCEPTION 'unp is required' USING ERRCODE='23514';
  END IF;
  IF _full_name IS NULL OR length(btrim(_full_name)) = 0 THEN
    RAISE EXCEPTION 'full_name is required' USING ERRCODE='23514';
  END IF;

  v_country := upper(coalesce(_country,'BY'));

  PERFORM pg_advisory_xact_lock(hashtextextended('crm_company_resolve:' || v_country || ':' || _unp_normalized, 0));

  SELECT * INTO v_row FROM public.companies
   WHERE country = v_country
     AND unp_normalized = _unp_normalized
   ORDER BY CASE WHEN status <> 'merged' THEN 0 ELSE 1 END, created_at ASC, id ASC
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    IF v_row.status <> 'merged' THEN
      RETURN v_row.id;
    END IF;

    v_next := v_row.merged_into_company_id;
    LOOP
      v_depth := v_depth + 1;
      IF v_next IS NULL THEN
        RAISE EXCEPTION 'resolve: merged company % has no target', v_row.id USING ERRCODE='22023';
      END IF;
      IF v_depth > 32 OR v_next = ANY(v_seen) THEN
        RAISE EXCEPTION 'resolve: merged chain broken or cyclic for %/%', v_country, _unp_normalized USING ERRCODE='22023';
      END IF;
      v_seen := v_seen || v_next;

      SELECT * INTO v_leaf FROM public.companies WHERE id = v_next FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'resolve: merged target % not found', v_next USING ERRCODE='23503';
      END IF;
      IF v_leaf.status <> 'merged' THEN
        RETURN v_leaf.id;
      END IF;
      v_next := v_leaf.merged_into_company_id;
    END LOOP;
  END IF;

  v_meta := jsonb_build_object(
    'company_sync', jsonb_build_object(
      'billing_snapshot', '{}'::jsonb,
      'last_billing_client_legal_details_id', to_jsonb(_source_cld_id),
      'last_billing_synced_at', to_jsonb(now()),
      'last_billing_source_updated_at', null
    ),
    'created_source', to_jsonb(_source)
  );

  INSERT INTO public.companies (
    workspace_id, company_kind, country, unp_normalized, full_name,
    metadata, created_by, updated_by
  ) VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    _company_kind, v_country, _unp_normalized, btrim(_full_name),
    v_meta, _actor_user_id, _actor_user_id
  )
  RETURNING id INTO v_id;

  -- trigger set_companies_public_id проставляет public_id

  PERFORM public._crm_company_emit_domain_event(
    'company.created.v1',
    v_id,
    'company.created:' || v_id::text,
    jsonb_build_object(
      'version', 1,
      'company_id', v_id,
      'public_id', (SELECT public_id FROM public.companies WHERE id=v_id),
      'country', v_country,
      'unp_normalized', _unp_normalized,
      'company_kind', _company_kind,
      'source', _source,
      'source_cld_id', _source_cld_id,
      'actor_user_id', _actor_user_id,
      'occurred_at', now(),
      'idempotency_key', 'company.created:' || v_id::text
    )
  );

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public._crm_company_resolve_or_create_internal(
  text, text, text, text, uuid, text, uuid)
FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.crm_company_get_or_create(
  _country text, _unp text, _full_name text, _company_kind text,
  _source text, _source_client_legal_details_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_unp text; v_id uuid; v_cld public.client_legal_details%ROWTYPE;
BEGIN
  -- role guard (Phase 2 сохраняет tribution admin/super_admin/menedzher)
  IF NOT (has_role_v2(auth.uid(),'admin')
       OR has_role_v2(auth.uid(),'super_admin')
       OR has_role_v2(auth.uid(),'menedzher')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  -- _source contract
  IF _source NOT IN ('manual','billing_requisites','backfill') THEN
    RAISE EXCEPTION 'invalid _source: %', _source USING ERRCODE='22023';
  END IF;
  IF _source = 'manual' AND _source_client_legal_details_id IS NOT NULL THEN
    RAISE EXCEPTION 'manual source must not reference a client_legal_details_id' USING ERRCODE='22023';
  END IF;
  IF _source IN ('billing_requisites','backfill') THEN
    IF _source_client_legal_details_id IS NULL THEN
      RAISE EXCEPTION 'billing/backfill source requires client_legal_details_id' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v_cld FROM public.client_legal_details WHERE id=_source_client_legal_details_id;
    IF NOT FOUND OR v_cld.purpose <> 'billing' OR v_cld.client_type NOT IN ('legal_entity','entrepreneur') THEN
      RAISE EXCEPTION 'referenced cld is not a billing legal_entity/entrepreneur' USING ERRCODE='22023';
    END IF;
  END IF;

  v_unp := regexp_replace(coalesce(_unp,''), '\D', '', 'g');

  v_id := public._crm_company_resolve_or_create_internal(
    _country, v_unp, _full_name, _company_kind, auth.uid(), _source, _source_client_legal_details_id);

  -- manual source → audit_logs (guarded)
  IF _source = 'manual' THEN
    INSERT INTO public.audit_logs (actor_user_id, action, actor_type, entity_type, entity_id, meta)
    SELECT auth.uid(), 'company.create', 'user', 'company', v_id::text,
           jsonb_build_object('idempotency_key', 'company.create:' || v_id::text, 'source', _source)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.audit_logs
       WHERE action='company.create' AND entity_type='company' AND entity_id=v_id::text);
  END IF;

  -- crm_activity_log (guarded)
  INSERT INTO public.crm_activity_log (activity_type, source_entity_id, source_entity_type,
                                       user_id, idempotency_key, metadata)
  SELECT 'company.created', v_id, 'company', auth.uid(),
         'company.created:' || v_id::text,
         jsonb_build_object('source', _source, 'source_cld_id', _source_client_legal_details_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.crm_activity_log
     WHERE source_entity_type='company' AND source_entity_id=v_id
       AND idempotency_key='company.created:' || v_id::text);

  RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION public.crm_company_link_contact(
  _company_id uuid, _profile_id uuid, _relationship_type text,
  _is_billing_contact boolean, _source text,
  _source_client_legal_details_map_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_id uuid; v_existing public.company_contacts%ROWTYPE;
        v_material boolean := false; v_first_insert boolean := false;
        v_company public.companies%ROWTYPE;
        v_activity_key text;
BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin')
       OR has_role_v2(auth.uid(),'super_admin')
       OR has_role_v2(auth.uid(),'menedzher')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  IF _profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_id required in phase 2' USING ERRCODE='22023';
  END IF;
  IF _relationship_type IS NULL OR length(btrim(_relationship_type)) = 0 THEN
    RAISE EXCEPTION 'relationship_type required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_company FROM public.companies WHERE id=_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'company not found' USING ERRCODE='23503'; END IF;
  IF v_company.status = 'merged' THEN
    RAISE EXCEPTION 'merged company is not linkable' USING ERRCODE='22023';
  END IF;

  IF _is_billing_contact THEN
    IF _source <> 'billing_requisites' THEN
      RAISE EXCEPTION 'billing flag requires source=billing_requisites' USING ERRCODE='22023';
    END IF;
    IF _source_client_legal_details_map_id IS NULL THEN
      RAISE EXCEPTION 'source_client_legal_details_map_id required for billing contact' USING ERRCODE='22023';
    END IF;
    PERFORM 1 FROM public.client_legal_details_company_map
     WHERE id = _source_client_legal_details_map_id AND company_id = _company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'map does not belong to company' USING ERRCODE='23503';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'crm_company_link_contact:' || _company_id::text || ':' || _profile_id::text || ':' || btrim(_relationship_type), 0));

  SELECT * INTO v_existing FROM public.company_contacts
   WHERE company_id=_company_id AND profile_id=_profile_id AND relationship_type=_relationship_type
   FOR UPDATE;

  IF FOUND THEN
    v_id := v_existing.id;
    IF (COALESCE(v_existing.is_billing_contact,false) = false AND COALESCE(_is_billing_contact,false) = true)
       OR (v_existing.source_client_legal_details_map_id IS NULL AND _source_client_legal_details_map_id IS NOT NULL)
       OR (v_existing.source IS DISTINCT FROM _source AND _source = 'billing_requisites') THEN
      v_material := true;
    END IF;

    UPDATE public.company_contacts SET
      is_billing_contact = v_existing.is_billing_contact OR COALESCE(_is_billing_contact,false),
      source_client_legal_details_map_id = COALESCE(v_existing.source_client_legal_details_map_id,
                                                    _source_client_legal_details_map_id),
      source = CASE WHEN v_existing.source='billing_requisites' OR _source='billing_requisites'
                    THEN 'billing_requisites' ELSE COALESCE(v_existing.source, _source) END,
      updated_by = auth.uid(), updated_at = now()
    WHERE id = v_id;
  ELSE
    BEGIN
      INSERT INTO public.company_contacts (
        company_id, profile_id, relationship_type,
        is_billing_contact, source, source_client_legal_details_map_id,
        created_by, updated_by
      ) VALUES (
        _company_id, _profile_id, _relationship_type,
        COALESCE(_is_billing_contact,false), _source, _source_client_legal_details_map_id,
        auth.uid(), auth.uid()
      )
      RETURNING id INTO v_id;
      v_first_insert := true;
    EXCEPTION WHEN unique_violation THEN
      SELECT * INTO v_existing FROM public.company_contacts
       WHERE company_id=_company_id AND profile_id=_profile_id AND relationship_type=_relationship_type
       FOR UPDATE;
      IF NOT FOUND THEN RAISE; END IF;
      v_id := v_existing.id;
      IF (COALESCE(v_existing.is_billing_contact,false) = false AND COALESCE(_is_billing_contact,false) = true)
         OR (v_existing.source_client_legal_details_map_id IS NULL AND _source_client_legal_details_map_id IS NOT NULL)
         OR (v_existing.source IS DISTINCT FROM _source AND _source = 'billing_requisites') THEN
        v_material := true;
      END IF;
      UPDATE public.company_contacts SET
        is_billing_contact = v_existing.is_billing_contact OR COALESCE(_is_billing_contact,false),
        source_client_legal_details_map_id = COALESCE(v_existing.source_client_legal_details_map_id,
                                                      _source_client_legal_details_map_id),
        source = CASE WHEN v_existing.source='billing_requisites' OR _source='billing_requisites'
                      THEN 'billing_requisites' ELSE COALESCE(v_existing.source, _source) END,
        updated_by = auth.uid(), updated_at = now()
      WHERE id = v_id;
    END;
  END IF;

  IF v_first_insert THEN
    v_activity_key := 'company.linked_to_contact:' || v_id::text;
    PERFORM public._crm_company_emit_domain_event(
      'company.linked_to_contact.v1',
      _company_id,
      v_activity_key,
      jsonb_build_object(
        'version', 1, 'company_id', _company_id, 'contact_id', v_id, 'profile_id', _profile_id,
        'relationship_type', _relationship_type, 'is_billing_contact', COALESCE(_is_billing_contact,false),
        'source', _source, 'source_map_id', _source_client_legal_details_map_id,
        'occurred_at', now(),
        'idempotency_key', v_activity_key
      )
    );
  ELSIF v_material THEN
    v_activity_key := 'company.linked_to_contact.updated:' || v_id::text || ':' ||
      md5(coalesce(_source,'') || ':' || coalesce(_is_billing_contact::text,'') || ':' ||
          coalesce(_source_client_legal_details_map_id::text,''));
    PERFORM public._crm_company_emit_domain_event(
      'company.linked_to_contact.v1',
      _company_id,
      v_activity_key,
      jsonb_build_object(
        'version', 1, 'company_id', _company_id, 'contact_id', v_id, 'update', true,
        'occurred_at', now(),
        'idempotency_key', v_activity_key
      )
    );
  END IF;

  IF v_activity_key IS NOT NULL THEN
    INSERT INTO public.crm_activity_log (
      activity_type, source_entity_id, source_entity_type,
      user_id, idempotency_key, metadata
    )
    SELECT 'company.linked_to_contact', _company_id, 'company', auth.uid(),
           v_activity_key,
           jsonb_build_object(
             'contact_id', v_id,
             'profile_id', _profile_id,
             'relationship_type', _relationship_type,
             'is_billing_contact', COALESCE(_is_billing_contact,false),
             'source', _source,
             'source_map_id', _source_client_legal_details_map_id,
             'update', NOT v_first_insert
           )
    WHERE NOT EXISTS (
      SELECT 1 FROM public.crm_activity_log
       WHERE source_entity_type='company' AND source_entity_id=_company_id
         AND idempotency_key=v_activity_key
    );
  END IF;

  RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION public.crm_company_upsert_from_billing(_client_legal_details_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_cld       public.client_legal_details%ROWTYPE;
  v_company   public.companies%ROWTYPE;
  v_country   text := 'BY';
  v_unp       text;
  v_kind      text;
  v_full      text;
  v_id        uuid;
  v_snap      jsonb;
  v_prev_src  timestamptz;
  v_changed   text[] := '{}';
  v_conflicts text[] := '{}';
  v_first_billing_sync boolean := false;
  v_activity_user_id uuid;
  v_values_hash text;
  v_event_key text;
  -- Нормализованные значения per §4 (последний non-null billing wins; NULL = не трогать)
  n_full_name         text;
  n_short_name        text;
  n_legal_form        text;
  n_legal_address     text;
  n_director_name     text;
  n_director_position text;
  n_acts_on_basis     text;
  n_bank_account      text;
  n_bank_name         text;
  n_bank_code         text;
  n_email             text;
  n_phone             text;
  -- Новые значения после применения ownership (по умолчанию = текущее значение target)
  new_full_name         text;
  new_short_name        text;
  new_legal_form        text;
  new_legal_address     text;
  new_director_name     text;
  new_director_position text;
  new_acts_on_basis     text;
  new_bank_account      text;
  new_bank_name         text;
  new_bank_code         text;
  new_email             text;
  new_phone             text;
BEGIN
  SELECT * INTO v_cld FROM public.client_legal_details WHERE id=_client_legal_details_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cld not found' USING ERRCODE='23503'; END IF;
  IF v_cld.purpose <> 'billing' THEN
    RAISE EXCEPTION 'cld.purpose must be billing' USING ERRCODE='22023'; END IF;
  IF v_cld.client_type NOT IN ('legal_entity','entrepreneur') THEN
    RAISE EXCEPTION 'cld.client_type must be legal_entity or entrepreneur' USING ERRCODE='22023'; END IF;

  SELECT COALESCE(p.user_id, p.id)
    INTO v_activity_user_id
    FROM public.profiles p
   WHERE p.id = v_cld.profile_id;
  IF v_activity_user_id IS NULL THEN
    RAISE EXCEPTION 'billing profile not found' USING ERRCODE='23503';
  END IF;

  v_kind := v_cld.client_type;
  IF v_kind = 'legal_entity' THEN
    v_unp  := regexp_replace(coalesce(v_cld.leg_unp,''),'\D','','g');
    v_full := NULLIF(btrim(concat_ws(' ', v_cld.leg_org_form, v_cld.leg_name)),'');
  ELSE
    v_unp  := regexp_replace(coalesce(v_cld.ent_unp,''),'\D','','g');
    v_full := NULLIF(btrim(v_cld.ent_name),'');
  END IF;
  IF length(v_unp) = 0 OR v_full IS NULL THEN
    RAISE EXCEPTION 'billing cld missing unp or full_name' USING ERRCODE='23514';
  END IF;

  -- create-or-resolve через private helper (set-once поля: country/unp_normalized/company_kind
  -- задаются только при INSERT canonical company)
  v_id := public._crm_company_resolve_or_create_internal(
    v_country, v_unp, v_full, v_kind, NULL::uuid, 'billing_requisites', _client_legal_details_id);

  SELECT * INTO v_company FROM public.companies WHERE id=v_id FOR UPDATE;

  -- Auto-created billing companies must appear in the CRM timeline. The source
  -- profile supplies the mandatory crm_activity_log.user_id for service-role calls.
  IF v_company.metadata->>'created_source' = 'billing_requisites' THEN
    INSERT INTO public.crm_activity_log (
      activity_type, source_entity_id, source_entity_type,
      user_id, idempotency_key, metadata
    )
    SELECT 'company.created', v_id, 'company', v_activity_user_id,
           'company.created:' || v_id::text,
           jsonb_build_object('source', 'billing_requisites', 'source_cld_id', _client_legal_details_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.crm_activity_log
       WHERE source_entity_type='company' AND source_entity_id=v_id
         AND idempotency_key='company.created:' || v_id::text
    );
  END IF;

  -- stale detection: если source updated_at раньше зафиксированного — идемпотентный no-op
  v_prev_src := (v_company.metadata->'company_sync'->>'last_billing_source_updated_at')::timestamptz;
  IF v_prev_src IS NOT NULL AND v_cld.updated_at IS NOT NULL AND v_cld.updated_at < v_prev_src THEN
    RETURN v_id;
  END IF;

  v_snap := COALESCE(v_company.metadata->'company_sync'->'billing_snapshot','{}'::jsonb);
  v_first_billing_sync := (v_company.metadata->'company_sync'->>'last_billing_source_updated_at') IS NULL
                          AND v_snap = '{}'::jsonb;

  -- Нормализация 12 mutable-полей строго по §4
  n_full_name         := v_full;
  n_short_name        := CASE v_kind WHEN 'legal_entity'
                             THEN NULLIF(btrim(v_cld.leg_name),'')
                             ELSE NULLIF(btrim(v_cld.ent_name),'') END;
  n_legal_form        := CASE v_kind WHEN 'legal_entity'
                             THEN NULLIF(btrim(v_cld.leg_org_form),'')
                             ELSE NULL END;
  n_legal_address     := CASE v_kind WHEN 'legal_entity'
                             THEN NULLIF(btrim(v_cld.leg_address),'')
                             ELSE NULLIF(btrim(v_cld.ent_address),'') END;
  n_director_name     := CASE v_kind WHEN 'legal_entity'
                             THEN NULLIF(btrim(v_cld.leg_director_name),'')
                             ELSE NULL END;
  n_director_position := CASE v_kind WHEN 'legal_entity'
                             THEN NULLIF(btrim(v_cld.leg_director_position),'')
                             ELSE NULL END;
  n_acts_on_basis     := CASE v_kind WHEN 'legal_entity'
                             THEN NULLIF(btrim(v_cld.leg_acts_on_basis),'')
                             ELSE NULLIF(btrim(v_cld.ent_acts_on_basis),'') END;
  n_bank_account      := NULLIF(btrim(v_cld.bank_account),'');
  n_bank_name         := NULLIF(btrim(v_cld.bank_name),'');
  n_bank_code         := NULLIF(btrim(v_cld.bank_code),'');
  n_email             := NULLIF(lower(btrim(v_cld.email)),'');
  n_phone             := NULLIF(regexp_replace(coalesce(v_cld.phone,''),'[^\d+]','','g'),'');

  -- Default new_* = текущее значение target
  new_full_name         := v_company.full_name;
  new_short_name        := v_company.short_name;
  new_legal_form        := v_company.legal_form;
  new_legal_address     := v_company.legal_address;
  new_director_name     := v_company.director_name;
  new_director_position := v_company.director_position;
  new_acts_on_basis     := v_company.acts_on_basis;
  new_bank_account      := v_company.bank_account;
  new_bank_name         := v_company.bank_name;
  new_bank_code         := v_company.bank_code;
  new_email             := v_company.email;
  new_phone             := v_company.phone;

  -- Ownership §5 для каждого mutable-поля.
  -- Инвариант NULL: если normalized billing = NULL, target/snapshot/conflict не трогаем.

  -- full_name
  IF n_full_name IS NOT NULL THEN
    IF v_company.full_name IS NULL
       OR v_company.full_name IS NOT DISTINCT FROM (v_snap->>'full_name') THEN
      new_full_name := n_full_name;
      v_snap := jsonb_set(v_snap, '{full_name}', to_jsonb(n_full_name));
      v_changed := array_append(v_changed, 'full_name');
    ELSE
      v_snap := jsonb_set(v_snap, '{full_name}', to_jsonb(n_full_name));
      v_conflicts := array_append(v_conflicts, 'full_name');
    END IF;
  END IF;

  -- short_name
  IF n_short_name IS NOT NULL THEN
    IF v_company.short_name IS NULL
       OR v_company.short_name IS NOT DISTINCT FROM (v_snap->>'short_name') THEN
      new_short_name := n_short_name;
      v_snap := jsonb_set(v_snap, '{short_name}', to_jsonb(n_short_name));
      v_changed := array_append(v_changed, 'short_name');
    ELSE
      v_snap := jsonb_set(v_snap, '{short_name}', to_jsonb(n_short_name));
      v_conflicts := array_append(v_conflicts, 'short_name');
    END IF;
  END IF;

  -- legal_form
  IF n_legal_form IS NOT NULL THEN
    IF v_company.legal_form IS NULL
       OR v_company.legal_form IS NOT DISTINCT FROM (v_snap->>'legal_form') THEN
      new_legal_form := n_legal_form;
      v_snap := jsonb_set(v_snap, '{legal_form}', to_jsonb(n_legal_form));
      v_changed := array_append(v_changed, 'legal_form');
    ELSE
      v_snap := jsonb_set(v_snap, '{legal_form}', to_jsonb(n_legal_form));
      v_conflicts := array_append(v_conflicts, 'legal_form');
    END IF;
  END IF;

  -- legal_address
  IF n_legal_address IS NOT NULL THEN
    IF v_company.legal_address IS NULL
       OR v_company.legal_address IS NOT DISTINCT FROM (v_snap->>'legal_address') THEN
      new_legal_address := n_legal_address;
      v_snap := jsonb_set(v_snap, '{legal_address}', to_jsonb(n_legal_address));
      v_changed := array_append(v_changed, 'legal_address');
    ELSE
      v_snap := jsonb_set(v_snap, '{legal_address}', to_jsonb(n_legal_address));
      v_conflicts := array_append(v_conflicts, 'legal_address');
    END IF;
  END IF;

  -- director_name
  IF n_director_name IS NOT NULL THEN
    IF v_company.director_name IS NULL
       OR v_company.director_name IS NOT DISTINCT FROM (v_snap->>'director_name') THEN
      new_director_name := n_director_name;
      v_snap := jsonb_set(v_snap, '{director_name}', to_jsonb(n_director_name));
      v_changed := array_append(v_changed, 'director_name');
    ELSE
      v_snap := jsonb_set(v_snap, '{director_name}', to_jsonb(n_director_name));
      v_conflicts := array_append(v_conflicts, 'director_name');
    END IF;
  END IF;

  -- director_position
  IF n_director_position IS NOT NULL THEN
    IF v_company.director_position IS NULL
       OR v_company.director_position IS NOT DISTINCT FROM (v_snap->>'director_position') THEN
      new_director_position := n_director_position;
      v_snap := jsonb_set(v_snap, '{director_position}', to_jsonb(n_director_position));
      v_changed := array_append(v_changed, 'director_position');
    ELSE
      v_snap := jsonb_set(v_snap, '{director_position}', to_jsonb(n_director_position));
      v_conflicts := array_append(v_conflicts, 'director_position');
    END IF;
  END IF;

  -- acts_on_basis
  IF n_acts_on_basis IS NOT NULL THEN
    IF v_company.acts_on_basis IS NULL
       OR v_company.acts_on_basis IS NOT DISTINCT FROM (v_snap->>'acts_on_basis') THEN
      new_acts_on_basis := n_acts_on_basis;
      v_snap := jsonb_set(v_snap, '{acts_on_basis}', to_jsonb(n_acts_on_basis));
      v_changed := array_append(v_changed, 'acts_on_basis');
    ELSE
      v_snap := jsonb_set(v_snap, '{acts_on_basis}', to_jsonb(n_acts_on_basis));
      v_conflicts := array_append(v_conflicts, 'acts_on_basis');
    END IF;
  END IF;

  -- bank_account
  IF n_bank_account IS NOT NULL THEN
    IF v_company.bank_account IS NULL
       OR v_company.bank_account IS NOT DISTINCT FROM (v_snap->>'bank_account') THEN
      new_bank_account := n_bank_account;
      v_snap := jsonb_set(v_snap, '{bank_account}', to_jsonb(n_bank_account));
      v_changed := array_append(v_changed, 'bank_account');
    ELSE
      v_snap := jsonb_set(v_snap, '{bank_account}', to_jsonb(n_bank_account));
      v_conflicts := array_append(v_conflicts, 'bank_account');
    END IF;
  END IF;

  -- bank_name
  IF n_bank_name IS NOT NULL THEN
    IF v_company.bank_name IS NULL
       OR v_company.bank_name IS NOT DISTINCT FROM (v_snap->>'bank_name') THEN
      new_bank_name := n_bank_name;
      v_snap := jsonb_set(v_snap, '{bank_name}', to_jsonb(n_bank_name));
      v_changed := array_append(v_changed, 'bank_name');
    ELSE
      v_snap := jsonb_set(v_snap, '{bank_name}', to_jsonb(n_bank_name));
      v_conflicts := array_append(v_conflicts, 'bank_name');
    END IF;
  END IF;

  -- bank_code
  IF n_bank_code IS NOT NULL THEN
    IF v_company.bank_code IS NULL
       OR v_company.bank_code IS NOT DISTINCT FROM (v_snap->>'bank_code') THEN
      new_bank_code := n_bank_code;
      v_snap := jsonb_set(v_snap, '{bank_code}', to_jsonb(n_bank_code));
      v_changed := array_append(v_changed, 'bank_code');
    ELSE
      v_snap := jsonb_set(v_snap, '{bank_code}', to_jsonb(n_bank_code));
      v_conflicts := array_append(v_conflicts, 'bank_code');
    END IF;
  END IF;

  -- email
  IF n_email IS NOT NULL THEN
    IF v_company.email IS NULL
       OR v_company.email IS NOT DISTINCT FROM (v_snap->>'email') THEN
      new_email := n_email;
      v_snap := jsonb_set(v_snap, '{email}', to_jsonb(n_email));
      v_changed := array_append(v_changed, 'email');
    ELSE
      v_snap := jsonb_set(v_snap, '{email}', to_jsonb(n_email));
      v_conflicts := array_append(v_conflicts, 'email');
    END IF;
  END IF;

  -- phone
  IF n_phone IS NOT NULL THEN
    IF v_company.phone IS NULL
       OR v_company.phone IS NOT DISTINCT FROM (v_snap->>'phone') THEN
      new_phone := n_phone;
      v_snap := jsonb_set(v_snap, '{phone}', to_jsonb(n_phone));
      v_changed := array_append(v_changed, 'phone');
    ELSE
      v_snap := jsonb_set(v_snap, '{phone}', to_jsonb(n_phone));
      v_conflicts := array_append(v_conflicts, 'phone');
    END IF;
  END IF;


  -- Удаление ложных changed/conflict: поле считается changed только при реальном отличии target → new_*.
  -- Если billing-значение совпало с текущим target, повторный вызов с тем же source version остаётся no-op.
  v_changed := COALESCE(ARRAY(
    SELECT DISTINCT field FROM unnest(v_changed) AS field
     WHERE CASE field
       WHEN 'full_name'         THEN v_company.full_name         IS DISTINCT FROM new_full_name
       WHEN 'short_name'        THEN v_company.short_name        IS DISTINCT FROM new_short_name
       WHEN 'legal_form'        THEN v_company.legal_form        IS DISTINCT FROM new_legal_form
       WHEN 'legal_address'     THEN v_company.legal_address     IS DISTINCT FROM new_legal_address
       WHEN 'director_name'     THEN v_company.director_name     IS DISTINCT FROM new_director_name
       WHEN 'director_position' THEN v_company.director_position IS DISTINCT FROM new_director_position
       WHEN 'acts_on_basis'     THEN v_company.acts_on_basis     IS DISTINCT FROM new_acts_on_basis
       WHEN 'bank_account'      THEN v_company.bank_account      IS DISTINCT FROM new_bank_account
       WHEN 'bank_name'         THEN v_company.bank_name         IS DISTINCT FROM new_bank_name
       WHEN 'bank_code'         THEN v_company.bank_code         IS DISTINCT FROM new_bank_code
       WHEN 'email'             THEN v_company.email             IS DISTINCT FROM new_email
       WHEN 'phone'             THEN v_company.phone             IS DISTINCT FROM new_phone
       ELSE false END
     ORDER BY field), '{}'::text[]);

  v_conflicts := COALESCE(ARRAY(
    SELECT DISTINCT field FROM unnest(v_conflicts) AS field
     WHERE CASE field
       WHEN 'full_name'         THEN v_company.full_name         IS DISTINCT FROM n_full_name
       WHEN 'short_name'        THEN v_company.short_name        IS DISTINCT FROM n_short_name
       WHEN 'legal_form'        THEN v_company.legal_form        IS DISTINCT FROM n_legal_form
       WHEN 'legal_address'     THEN v_company.legal_address     IS DISTINCT FROM n_legal_address
       WHEN 'director_name'     THEN v_company.director_name     IS DISTINCT FROM n_director_name
       WHEN 'director_position' THEN v_company.director_position IS DISTINCT FROM n_director_position
       WHEN 'acts_on_basis'     THEN v_company.acts_on_basis     IS DISTINCT FROM n_acts_on_basis
       WHEN 'bank_account'      THEN v_company.bank_account      IS DISTINCT FROM n_bank_account
       WHEN 'bank_name'         THEN v_company.bank_name         IS DISTINCT FROM n_bank_name
       WHEN 'bank_code'         THEN v_company.bank_code         IS DISTINCT FROM n_bank_code
       WHEN 'email'             THEN v_company.email             IS DISTINCT FROM n_email
       WHEN 'phone'             THEN v_company.phone             IS DISTINCT FROM n_phone
       ELSE false END
     ORDER BY field), '{}'::text[]);

  v_values_hash := md5(jsonb_build_object(
    'source_updated_at', v_cld.updated_at,
    'first_billing_sync', v_first_billing_sync,
    'changed_fields', to_jsonb(v_changed),
    'conflict_fields', to_jsonb(v_conflicts),
    'values', jsonb_build_object(
      'full_name', n_full_name, 'short_name', n_short_name, 'legal_form', n_legal_form,
      'legal_address', n_legal_address, 'director_name', n_director_name,
      'director_position', n_director_position, 'acts_on_basis', n_acts_on_basis,
      'bank_account', n_bank_account, 'bank_name', n_bank_name, 'bank_code', n_bank_code,
      'email', n_email, 'phone', n_phone)
  )::text);
  v_event_key := 'company.upserted_from_billing:' || v_id::text || ':' || _client_legal_details_id::text || ':' ||
                 COALESCE(v_cld.updated_at::text, 'no-source-version') || ':' || v_values_hash;

  IF array_length(v_changed,1) IS NULL AND array_length(v_conflicts,1) IS NULL
     AND NOT v_first_billing_sync
     AND v_prev_src IS NOT NULL
     AND v_cld.updated_at IS NOT DISTINCT FROM v_prev_src THEN
    RETURN v_id;
  END IF;

  -- Единый UPDATE: значения полей + обновление metadata (snapshot + timestamps).
  UPDATE public.companies SET
    full_name         = new_full_name,
    short_name        = new_short_name,
    legal_form        = new_legal_form,
    legal_address     = new_legal_address,
    director_name     = new_director_name,
    director_position = new_director_position,
    acts_on_basis     = new_acts_on_basis,
    bank_account      = new_bank_account,
    bank_name         = new_bank_name,
    bank_code         = new_bank_code,
    email             = new_email,
    phone             = new_phone,
    metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
      'company_sync', COALESCE(metadata->'company_sync','{}'::jsonb) || jsonb_build_object(
        'billing_snapshot', v_snap,
        'last_billing_client_legal_details_id', to_jsonb(_client_legal_details_id),
        'last_billing_synced_at', to_jsonb(now()),
        'last_billing_source_updated_at', to_jsonb(v_cld.updated_at)
      )),
    updated_at = now()
  WHERE id = v_id;

  -- override conflicts → crm_activity_log (idempotent per (company, field, cld))
  IF array_length(v_conflicts,1) IS NOT NULL THEN
    INSERT INTO public.crm_activity_log (activity_type, source_entity_id, source_entity_type,
                                         user_id, idempotency_key, metadata)
    SELECT 'company.field.override_conflict', v_id, 'company', v_activity_user_id,
           'company.field.override_conflict:' || v_id::text || ':' || f || ':' || _client_legal_details_id::text,
           jsonb_build_object('field', f, 'cld_id', _client_legal_details_id)
      FROM unnest(v_conflicts) AS f
     WHERE NOT EXISTS (
       SELECT 1 FROM public.crm_activity_log
        WHERE source_entity_type='company' AND source_entity_id=v_id
          AND idempotency_key='company.field.override_conflict:' || v_id::text || ':' || f || ':' || _client_legal_details_id::text);
  END IF;

  -- domain_events только при material change/conflict; idempotency включает source version + normalized values hash.
  IF array_length(v_changed,1) IS NOT NULL OR array_length(v_conflicts,1) IS NOT NULL THEN
    PERFORM public._crm_company_emit_domain_event(
      'company.upserted_from_billing.v1',
      v_id,
      v_event_key,
      jsonb_build_object(
        'version', 1, 'company_id', v_id, 'cld_id', _client_legal_details_id,
        'changed_fields', to_jsonb(v_changed), 'override_conflict_fields', to_jsonb(v_conflicts),
        'source_updated_at', v_cld.updated_at, 'values_hash', v_values_hash,
        'first_billing_sync', v_first_billing_sync,
        'occurred_at', now(),
        'idempotency_key', v_event_key
      )
    );
  END IF;

  RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION public.search_companies(_filters jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed_keys text[] := ARRAY['q','status','company_kind','country','profile_id',
                                 'include_merged','limit','offset','sort_by','sort_dir'];
  v_key text;
  v_q text; v_country text; v_profile uuid; v_incl_merged boolean;
  v_limit int; v_offset int; v_sort_by text; v_sort_dir text;
  v_status text[]; v_kind text[];
  v_items jsonb; v_total bigint; v_sql text;
BEGIN
  IF NOT (has_role_v2(v_uid,'super_admin') OR has_role_v2(v_uid,'admin')
       OR has_role_v2(v_uid,'menedzher')   OR has_role_v2(v_uid,'support')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  IF _filters IS NULL THEN _filters := '{}'::jsonb; END IF;
  FOR v_key IN SELECT jsonb_object_keys(_filters) LOOP
    IF NOT (v_key = ANY(v_allowed_keys)) THEN
      RAISE EXCEPTION 'unknown filter key: %', v_key USING ERRCODE='22023';
    END IF;
  END LOOP;

  v_q            := NULLIF(btrim(_filters->>'q'),'');
  v_country      := NULLIF(upper(btrim(coalesce(_filters->>'country',''))),'');
  v_profile      := NULLIF(_filters->>'profile_id','')::uuid;
  v_incl_merged  := COALESCE((_filters->>'include_merged')::boolean, false);
  v_limit        := LEAST(GREATEST(COALESCE((_filters->>'limit')::int, 20), 1), 100);
  v_offset       := GREATEST(COALESCE((_filters->>'offset')::int, 0), 0);
  v_sort_by      := COALESCE(_filters->>'sort_by','created_at');
  v_sort_dir     := lower(COALESCE(_filters->>'sort_dir','desc'));
  IF v_sort_by NOT IN ('created_at','full_name','public_id') THEN
    RAISE EXCEPTION 'invalid sort_by' USING ERRCODE='22023'; END IF;
  IF v_sort_dir NOT IN ('asc','desc') THEN
    RAISE EXCEPTION 'invalid sort_dir' USING ERRCODE='22023'; END IF;

  IF jsonb_typeof(_filters->'status') = 'array' THEN
    SELECT array_agg(x) INTO v_status FROM jsonb_array_elements_text(_filters->'status') AS x;
    IF v_status && ARRAY[]::text[] THEN NULL; END IF;
    IF NOT (v_status <@ ARRAY['active','archived','merged']) THEN
      RAISE EXCEPTION 'invalid status[]' USING ERRCODE='22023'; END IF;
  END IF;
  IF jsonb_typeof(_filters->'company_kind') = 'array' THEN
    SELECT array_agg(x) INTO v_kind FROM jsonb_array_elements_text(_filters->'company_kind') AS x;
    IF NOT (v_kind <@ ARRAY['legal_entity','entrepreneur','foreign','unknown']) THEN
      RAISE EXCEPTION 'invalid company_kind[]' USING ERRCODE='22023'; END IF;
  END IF;

  v_sql := format($f$
    WITH base AS (
      SELECT c.id, c.public_id, c.full_name, c.short_name, c.unp_normalized,
             c.country, c.company_kind, c.status, c.email, c.phone, c.created_at
        FROM public.companies c
       WHERE ( $1 OR c.status <> 'merged' )
         AND ( $2::text IS NULL OR c.country = $2 )
         AND ( $3::uuid IS NULL OR EXISTS (
                 SELECT 1 FROM public.company_contacts cc
                  WHERE cc.company_id = c.id AND cc.profile_id = $3 ) )
         AND ( $4::text[] IS NULL OR c.status        = ANY($4) )
         AND ( $5::text[] IS NULL OR c.company_kind  = ANY($5) )
         AND ( $6::text IS NULL
               OR c.public_id      ILIKE '%%'||$6||'%%'
               OR c.full_name      ILIKE '%%'||$6||'%%'
               OR c.short_name     ILIKE '%%'||$6||'%%'
               OR c.unp_normalized ILIKE '%%'||$6||'%%'
               OR c.email          ILIKE '%%'||$6||'%%'
               OR c.phone          ILIKE '%%'||$6||'%%' )
    )
    SELECT jsonb_build_object(
      'items', COALESCE(jsonb_agg(row_to_json(b) ORDER BY %I %s), '[]'::jsonb),
      'total', (SELECT count(*) FROM base),
      'limit', %s, 'offset', %s)
    FROM (SELECT * FROM base ORDER BY %I %s LIMIT %s OFFSET %s) b
  $f$, v_sort_by, v_sort_dir, v_limit, v_offset, v_sort_by, v_sort_dir, v_limit, v_offset);

  EXECUTE v_sql
    INTO v_items
    USING v_incl_merged, v_country, v_profile, v_status, v_kind, v_q;

  RETURN v_items;
END $$;
CREATE OR REPLACE FUNCTION public.crm_company_merge(_source_id uuid, _target_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_target_leaf       uuid;
  v_src               public.companies%ROWTYPE;
  v_tgt               public.companies%ROWTYPE;
  v_src_public_id     text;
  v_tgt_public_id     text;
  v_moved_map         int := 0;
  v_moved_contacts    int := 0;
  v_merged_contacts   int := 0;
  v_cycle             int;
  v_src_row           public.company_contacts%ROWTYPE;
  v_tgt_row           public.company_contacts%ROWTYPE;
BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF _source_id = _target_id THEN RAISE EXCEPTION 'source=target' USING ERRCODE='22023'; END IF;

  -- §7.1 разрешение цепочки merged_into для target до листа
  WITH RECURSIVE chain AS (
    SELECT id, merged_into_company_id, status, 1 AS depth
      FROM public.companies WHERE id = _target_id
    UNION ALL
    SELECT c.id, c.merged_into_company_id, c.status, chain.depth + 1
      FROM public.companies c
      JOIN chain ON c.id = chain.merged_into_company_id
      WHERE chain.depth < 32
  )
  SELECT id INTO v_target_leaf FROM chain
   WHERE merged_into_company_id IS NULL AND status <> 'merged'
   LIMIT 1;
  IF v_target_leaf IS NULL THEN
    RAISE EXCEPTION 'target chain broken or cyclic' USING ERRCODE='22023';
  END IF;
  IF v_target_leaf = _source_id THEN
    RAISE EXCEPTION 'target leaf equals source' USING ERRCODE='22023';
  END IF;

  -- §7.2 detection циклов: source не должен лежать в цепочке target
  WITH RECURSIVE chk AS (
    SELECT id, merged_into_company_id, 1 AS depth
      FROM public.companies WHERE id = v_target_leaf
    UNION ALL
    SELECT c.id, c.merged_into_company_id, chk.depth + 1
      FROM public.companies c
      JOIN chk ON c.id = chk.merged_into_company_id
      WHERE chk.depth < 32
  )
  SELECT count(*) INTO v_cycle FROM chk WHERE id = _source_id;
  IF v_cycle > 0 THEN
    RAISE EXCEPTION 'cycle detected: source is ancestor of target' USING ERRCODE='22023';
  END IF;

  -- §7.3 locking — детерминированный порядок LEAST/GREATEST + FOR UPDATE
  PERFORM 1 FROM public.companies
    WHERE id = LEAST(_source_id, v_target_leaf) FOR UPDATE;
  PERFORM 1 FROM public.companies
    WHERE id = GREATEST(_source_id, v_target_leaf) FOR UPDATE;
  PERFORM 1 FROM public.client_legal_details_company_map
    WHERE company_id = _source_id FOR UPDATE;
  PERFORM 1 FROM public.company_contacts
    WHERE company_id = _source_id FOR UPDATE;
  PERFORM 1 FROM public.company_contacts
    WHERE company_id = v_target_leaf FOR UPDATE;

  SELECT * INTO v_src FROM public.companies WHERE id = _source_id;
  IF v_src.id IS NULL THEN
    RAISE EXCEPTION 'source not found' USING ERRCODE='23503';
  END IF;
  SELECT * INTO v_tgt FROM public.companies WHERE id = v_target_leaf;
  IF v_tgt.id IS NULL THEN
    RAISE EXCEPTION 'target leaf not found' USING ERRCODE='23503';
  END IF;
  v_src_public_id := v_src.public_id;
  v_tgt_public_id := v_tgt.public_id;

  -- workspace check
  IF v_src.workspace_id <> v_tgt.workspace_id THEN
    RAISE EXCEPTION 'workspace mismatch' USING ERRCODE='22023'; END IF;

  -- idempotency: если source уже merged в v_target_leaf → возврат без событий
  IF v_src.status='merged' AND v_src.merged_into_company_id = v_target_leaf THEN
    RETURN v_target_leaf;
  END IF;
  IF v_src.status='merged' AND v_src.merged_into_company_id <> v_target_leaf THEN
    RAISE EXCEPTION 'source already merged into different target' USING ERRCODE='22023';
  END IF;
  IF v_tgt.status='merged' THEN
    RAISE EXCEPTION 'target is merged' USING ERRCODE='22023';
  END IF;

  -- §7.4 перенос map (уникальный ключ = client_legal_details_id; конфликтов не создаёт).
  WITH m AS (
    UPDATE public.client_legal_details_company_map
       SET company_id = v_target_leaf, updated_at = now(), updated_by = auth.uid()
     WHERE company_id = _source_id
     RETURNING 1)
  SELECT count(*) INTO v_moved_map FROM m;

  -- §7.5 перенос contacts — строгий row-by-row алгоритм.
  FOR v_src_row IN
    SELECT * FROM public.company_contacts
     WHERE company_id = _source_id
     ORDER BY id
  LOOP
    SELECT * INTO v_tgt_row FROM public.company_contacts
     WHERE company_id = v_target_leaf
       AND profile_id = v_src_row.profile_id
       AND relationship_type = v_src_row.relationship_type
     FOR UPDATE;

    IF NOT FOUND THEN
      -- Целевой строки нет → простой перенос.
      UPDATE public.company_contacts
         SET company_id = v_target_leaf,
             updated_at = now(),
             updated_by = auth.uid()
       WHERE id = v_src_row.id;
      v_moved_contacts := v_moved_contacts + 1;
      CONTINUE;
    END IF;

    -- Обе строки существуют → детерминированное объединение.
    UPDATE public.company_contacts SET
      is_billing_contact = v_tgt_row.is_billing_contact OR v_src_row.is_billing_contact,
      is_primary         = v_tgt_row.is_primary         OR v_src_row.is_primary,
      source_client_legal_details_map_id = CASE
        WHEN v_tgt_row.source_client_legal_details_map_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.client_legal_details_company_map m
           WHERE m.id = v_tgt_row.source_client_legal_details_map_id
             AND m.company_id = v_target_leaf)
          THEN v_tgt_row.source_client_legal_details_map_id
        WHEN v_src_row.source_client_legal_details_map_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.client_legal_details_company_map m
           WHERE m.id = v_src_row.source_client_legal_details_map_id
             AND m.company_id = v_target_leaf)
          THEN v_src_row.source_client_legal_details_map_id
        ELSE NULL END,
      source = CASE
        WHEN v_tgt_row.source = 'billing_requisites' OR v_src_row.source = 'billing_requisites'
          THEN 'billing_requisites'
        WHEN v_tgt_row.source = 'manual' OR v_src_row.source = 'manual'
          THEN 'manual'
        ELSE COALESCE(v_tgt_row.source, v_src_row.source) END,
      metadata = COALESCE(v_src_row.metadata,'{}'::jsonb)
              || COALESCE(v_tgt_row.metadata,'{}'::jsonb)
              || jsonb_build_object(
                   'merged_from', COALESCE(v_tgt_row.metadata->'merged_from','[]'::jsonb) ||
                                  jsonb_build_array(jsonb_build_object(
                                    'source_contact_id', v_src_row.id,
                                    'source_metadata', COALESCE(v_src_row.metadata,'{}'::jsonb),
                                    'at', now(),
                                    'by', auth.uid()))),
      updated_at = now(),
      updated_by = auth.uid()
    WHERE id = v_tgt_row.id;

    DELETE FROM public.company_contacts WHERE id = v_src_row.id;
    v_merged_contacts := v_merged_contacts + 1;
  END LOOP;

  -- §7.6 объединение metadata на уровне компании и переключение status source.
  UPDATE public.companies SET
    metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
      'merge', jsonb_build_object(
        'consumed', COALESCE(metadata->'merge'->'consumed','[]'::jsonb) ||
                    jsonb_build_array(jsonb_build_object(
                      'source_id',        _source_id,
                      'source_public_id', v_src_public_id,
                       'source_status',    v_src.status,
                       'source_metadata',  COALESCE(v_src.metadata,'{}'::jsonb),
                      'at',               now(),
                      'by',               auth.uid()
                    ))
      )
    ),
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = v_target_leaf;

  UPDATE public.companies SET
    status = 'merged',
    merged_into_company_id = v_target_leaf,
    metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
      'merged', jsonb_build_object(
        'at',   now(),
        'by',   auth.uid(),
        'from', v_src_public_id,
        'into', v_tgt_public_id
      )
    ),
    updated_at = now(),
    updated_by = auth.uid()
  WHERE id = _source_id AND status <> 'merged';

  -- domain_events через private emit helper
  PERFORM public._crm_company_emit_domain_event(
    'company.merged.v1',
    _source_id,
    'company.merged:'||_source_id::text||':'||v_target_leaf::text,
    jsonb_build_object(
      'version',1,'source_id',_source_id,'source_public_id',v_src_public_id,
      'target_id',v_target_leaf,'target_public_id',v_tgt_public_id,
      'moved_map_rows',v_moved_map,'moved_contact_rows',v_moved_contacts,
      'merged_contact_rows',v_merged_contacts,'occurred_at',now(),'actor_user_id',auth.uid(),
      'idempotency_key','company.merged:'||_source_id::text||':'||v_target_leaf::text
    )
  );

  INSERT INTO public.audit_logs (actor_user_id, action, actor_type, entity_type, entity_id, meta)
  SELECT auth.uid(),'company.merge','user','company',_source_id::text,
         jsonb_build_object('idempotency_key','company.merge:'||_source_id::text||':'||v_target_leaf::text,
                            'target_id',v_target_leaf)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.audit_logs
     WHERE action='company.merge' AND entity_type='company' AND entity_id=_source_id::text
       AND meta->>'idempotency_key'='company.merge:'||_source_id::text||':'||v_target_leaf::text);

  INSERT INTO public.crm_activity_log (activity_type, source_entity_id, source_entity_type,
                                       user_id, idempotency_key, metadata)
  SELECT 'company.merged', _source_id, 'company', auth.uid(),
         'company.merged:'||_source_id::text||':'||v_target_leaf::text,
         jsonb_build_object('target_id',v_target_leaf)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.crm_activity_log
     WHERE source_entity_type='company' AND source_entity_id=_source_id
       AND idempotency_key='company.merged:'||_source_id::text||':'||v_target_leaf::text);

  RETURN v_target_leaf;
END $$;
CREATE OR REPLACE FUNCTION public.crm_company_archive(_id uuid, _reason text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_row public.companies%ROWTYPE; v_reason text; v_prev_reason text;
BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  v_reason := NULLIF(btrim(_reason),'');
  IF v_reason IS NULL THEN RAISE EXCEPTION 'reason required' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_row FROM public.companies WHERE id=_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE='23503'; END IF;
  IF v_row.status='merged' THEN RAISE EXCEPTION 'merged company cannot be archived' USING ERRCODE='22023'; END IF;

  IF v_row.status='archived' THEN
    v_prev_reason := v_row.metadata->'archive'->>'reason';
    IF v_prev_reason IS NOT DISTINCT FROM v_reason THEN
      RETURN _id;  -- идемпотентно
    ELSE
      RAISE EXCEPTION 'company already archived with different reason' USING ERRCODE='22023';
    END IF;
  END IF;

  UPDATE public.companies SET
    status='archived', archived_at=now(),
    metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
      'archive', jsonb_build_object('reason', v_reason, 'by', auth.uid(), 'at', now())),
    updated_at=now(), updated_by=auth.uid()
  WHERE id=_id;

  PERFORM public._crm_company_emit_domain_event(
    'company.archived.v1',
    _id,
    'company.archived:'||_id::text||':'||md5(v_reason),
    jsonb_build_object(
      'version',1,'company_id',_id,'reason',v_reason,'occurred_at',now(),'actor_user_id',auth.uid(),
      'idempotency_key','company.archived:'||_id::text||':'||md5(v_reason)
    )
  );

  INSERT INTO public.audit_logs(actor_user_id, action, actor_type, entity_type, entity_id, meta)
  SELECT auth.uid(),'company.archive','user','company',_id::text,
         jsonb_build_object('idempotency_key','company.archive:'||_id::text,'reason',v_reason)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.audit_logs
     WHERE action='company.archive' AND entity_type='company' AND entity_id=_id::text);

  INSERT INTO public.crm_activity_log(activity_type, source_entity_id, source_entity_type,
                                      user_id, idempotency_key, metadata)
  SELECT 'company.archived',_id,'company',auth.uid(),
         'company.archived:'||_id::text, jsonb_build_object('reason',v_reason)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.crm_activity_log
     WHERE source_entity_type='company' AND source_entity_id=_id
       AND idempotency_key='company.archived:'||_id::text);

  RETURN _id;
END $$;
CREATE OR REPLACE FUNCTION public.crm_company_grp_refetch(_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_row public.companies%ROWTYPE; v_existing uuid; v_new uuid; v_key text;
BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'super_admin')
       OR has_role_v2(auth.uid(),'menedzher')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_row FROM public.companies WHERE id=_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE='23503'; END IF;
  IF v_row.status <> 'active' THEN RAISE EXCEPTION 'company not active' USING ERRCODE='22023'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('company_grp_refetch:'||_id::text, 0));

  SELECT id INTO v_existing FROM public.company_sync_queue
   WHERE entity_type='company' AND entity_id=_id
     AND run_reason='grp_refetch'
     AND status IN ('queued','running')
   FOR UPDATE;

  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  v_key := 'company:'||_id::text||':grp_refetch:'||gen_random_uuid()::text;
  INSERT INTO public.company_sync_queue(entity_type, entity_id, run_reason, status,
                                        idempotency_key, next_run_at, payload, created_by, updated_by)
  VALUES ('company', _id, 'grp_refetch', 'queued', v_key, now(), '{}'::jsonb, auth.uid(), auth.uid())
  RETURNING id INTO v_new;

  PERFORM public._crm_company_emit_domain_event(
    'company.grp_refetch_requested.v1',
    _id,
    'company.grp_refetch_requested:'||v_new::text,
    jsonb_build_object(
      'version',1,'company_id',_id,'queue_id',v_new,
      'idempotency_key','company.grp_refetch_requested:'||v_new::text,
      'occurred_at',now(),'actor_user_id',auth.uid()
    )
  );

  RETURN v_new;
END $$;
CREATE OR REPLACE FUNCTION public.search_global(p_query text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contacts  jsonb;
  v_deals     jsonb;
  v_messages  jsonb;
  v_companies jsonb;
  v_user_id   uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(v_user_id, 'admin'::app_role)
    OR public.has_role(v_user_id, 'superadmin'::app_role)
    OR public.has_permission(v_user_id, 'users.view')
    OR public.has_admin_section_access(v_user_id, 'contacts', 'view')
    OR public.has_admin_section_access(v_user_id, 'deals', 'view')
    OR public.has_admin_section_access(v_user_id, 'communication', 'view')
  ) THEN
    RAISE EXCEPTION 'Forbidden: admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(c)), '[]'::jsonb) INTO v_contacts
  FROM (
    SELECT p.id as profile_id, p.full_name, p.email, p.phone,
           p.telegram_username, p.status
    FROM profiles p
    WHERE to_tsvector('simple',
      coalesce(p.full_name, '') || ' ' ||
      coalesce(p.email, '') || ' ' ||
      coalesce(p.phone, '') || ' ' ||
      coalesce(p.telegram_username, '')
    ) @@ websearch_to_tsquery('simple', p_query)
    LIMIT p_limit OFFSET p_offset
  ) c;

  SELECT coalesce(jsonb_agg(row_to_json(d)), '[]'::jsonb) INTO v_deals
  FROM (
    SELECT o.id as order_id, o.order_number, o.status::text, o.profile_id,
           o.customer_email, o.customer_phone, p.full_name as contact_name
    FROM orders_v2 o
    LEFT JOIN profiles p ON p.id = o.profile_id
    WHERE to_tsvector('simple',
      coalesce(o.order_number, '') || ' ' ||
      coalesce(o.customer_email, '') || ' ' ||
      coalesce(o.customer_phone, '')
    ) @@ websearch_to_tsquery('simple', p_query)
    LIMIT p_limit OFFSET p_offset
  ) d;

  SELECT coalesce(jsonb_agg(row_to_json(m)), '[]'::jsonb) INTO v_messages
  FROM (
    SELECT
      tm.id,
      'private'::text as source,
      left(tm.message_text, 150) as snippet,
      tm.created_at,
      tm.user_id,
      tm.telegram_user_id,
      NULL::bigint as chat_id,
      p.id as profile_id,
      p.full_name as contact_name
    FROM telegram_messages tm
    LEFT JOIN profiles p ON p.user_id = tm.user_id
    WHERE to_tsvector('simple', coalesce(tm.message_text, ''))
          @@ websearch_to_tsquery('simple', p_query)
    LIMIT p_limit OFFSET p_offset
  ) m;

  -- Additive Phase 2 branch: companies (собственный role guard, без расширения доступа других веток)
  IF (
    public.has_role_v2(v_user_id, 'super_admin') OR public.has_role_v2(v_user_id, 'admin') OR
    public.has_role_v2(v_user_id, 'menedzher')   OR public.has_role_v2(v_user_id, 'support')
  ) THEN
    SELECT coalesce(jsonb_agg(row_to_json(c)), '[]'::jsonb) INTO v_companies
    FROM (
      SELECT c.id, c.public_id, c.full_name, c.short_name, c.unp_normalized,
             c.country, c.company_kind, c.status, 'company'::text AS entity
      FROM public.companies c
      WHERE c.status <> 'merged'
        AND (c.public_id      ILIKE '%'||p_query||'%'
          OR c.full_name      ILIKE '%'||p_query||'%'
          OR c.short_name     ILIKE '%'||p_query||'%'
          OR c.unp_normalized ILIKE '%'||p_query||'%')
      LIMIT p_limit OFFSET p_offset
    ) c;
  ELSE
    v_companies := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'contacts',  v_contacts,
    'deals',     v_deals,
    'messages',  v_messages,
    'companies', v_companies
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_company_get_or_create(text,text,text,text,text,uuid)     FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.search_companies(jsonb)                                     FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.crm_company_merge(uuid,uuid)                                FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.crm_company_archive(uuid,text)                              FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.crm_company_grp_refetch(uuid)                               FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.crm_company_upsert_from_billing(uuid)                       FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.crm_company_get_or_create(text,text,text,text,text,uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_companies(jsonb)                                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_merge(uuid,uuid)                                TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_archive(uuid,text)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_grp_refetch(uuid)                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_upsert_from_billing(uuid)                       TO service_role;

-- Оба private helper — никаких GRANT
REVOKE ALL ON FUNCTION public._crm_company_resolve_or_create_internal(text,text,text,text,uuid,text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._crm_company_emit_domain_event(text,uuid,text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
DO $post$
DECLARE v_hash text;
BEGIN
  -- baseline hash unchanged
  SELECT md5(string_agg(table_name || ':' || column_name || ':' || data_type,
                        ',' ORDER BY table_name, ordinal_position))
    INTO v_hash
    FROM information_schema.columns
   WHERE table_schema='public'
     AND table_name IN ('client_legal_details','profiles','public_id_sequences','roles',
                        'role_admin_resource_access','role_admin_section_access','admin_section');
  IF v_hash <> 'c41160b83c8e15c3d3c41a13028700d5' THEN
    RAISE EXCEPTION 'post: baseline hash drift %', v_hash;
  END IF;

  -- ACL matrix: expected 6 authenticated RPC, 1 service-only RPC, 2 private helpers, preserved search_global.
  IF NOT has_function_privilege('authenticated','public.crm_company_get_or_create(text,text,text,text,text,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.search_companies(jsonb)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.crm_company_merge(uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.crm_company_archive(uuid,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.crm_company_grp_refetch(uuid)','EXECUTE')
  THEN RAISE EXCEPTION 'post: authenticated RPC grants missing'; END IF;

  IF has_function_privilege('anon','public.crm_company_get_or_create(text,text,text,text,text,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.search_companies(jsonb)','EXECUTE')
     OR has_function_privilege('anon','public.crm_company_merge(uuid,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.crm_company_archive(uuid,text)','EXECUTE')
     OR has_function_privilege('anon','public.crm_company_grp_refetch(uuid)','EXECUTE')
     OR has_function_privilege('service_role','public.crm_company_get_or_create(text,text,text,text,text,uuid)','EXECUTE')
     OR has_function_privilege('service_role','public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)','EXECUTE')
     OR has_function_privilege('service_role','public.search_companies(jsonb)','EXECUTE')
     OR has_function_privilege('service_role','public.crm_company_merge(uuid,uuid)','EXECUTE')
     OR has_function_privilege('service_role','public.crm_company_archive(uuid,text)','EXECUTE')
     OR has_function_privilege('service_role','public.crm_company_grp_refetch(uuid)','EXECUTE')
  THEN RAISE EXCEPTION 'post: unexpected anon/service_role grants on authenticated RPC'; END IF;

  IF NOT has_function_privilege('service_role','public.crm_company_upsert_from_billing(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.crm_company_upsert_from_billing(uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.crm_company_upsert_from_billing(uuid)','EXECUTE')
  THEN RAISE EXCEPTION 'post: billing RPC ACL drift'; END IF;

  IF has_function_privilege('anon','public._crm_company_resolve_or_create_internal(text,text,text,text,uuid,text,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public._crm_company_resolve_or_create_internal(text,text,text,text,uuid,text,uuid)','EXECUTE')
     OR has_function_privilege('service_role','public._crm_company_resolve_or_create_internal(text,text,text,text,uuid,text,uuid)','EXECUTE')
     OR has_function_privilege('anon','public._crm_company_emit_domain_event(text,uuid,text,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public._crm_company_emit_domain_event(text,uuid,text,jsonb)','EXECUTE')
     OR has_function_privilege('service_role','public._crm_company_emit_domain_event(text,uuid,text,jsonb)','EXECUTE')
  THEN RAISE EXCEPTION 'post: private helper ACL drift'; END IF;

  -- search_global ACL must preserve the observed pre-Phase-2 contract:
  -- authenticated/service_role may execute; anon (including privileges inherited from PUBLIC) may not.
  IF has_function_privilege('anon','public.search_global(text,integer,integer)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.search_global(text,integer,integer)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.search_global(text,integer,integer)','EXECUTE')
  THEN RAISE EXCEPTION 'post: search_global ACL drift from pre-Phase-2 contract'; END IF;

  -- emit helper exists и SECURITY DEFINER
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_crm_company_emit_domain_event' AND p.prosecdef;
  IF NOT FOUND THEN RAISE EXCEPTION 'post: emit helper missing or not SECURITY DEFINER'; END IF;

  -- shared-таблица domain_events НЕ должна иметь Phase 2 индексов
  PERFORM 1 FROM pg_indexes
   WHERE schemaname='public' AND tablename='domain_events'
     AND indexname LIKE '%company_idem%';
  IF FOUND THEN RAISE EXCEPTION 'post: unexpected Phase 2 index on domain_events'; END IF;
END $post$;

COMMIT;
<!-- PHASE2_FORWARD_SQL_END -->

**Copy-paste readiness §11 checklist:**

- [x] Весь canonical SQL §11 находится напрямую между `PHASE2_FORWARD_SQL_BEGIN/END`, без markdown-заголовков, прозы и code fences.
- [x] В canonical SQL нет placeholder-переменных, open-item-маркеров и вложенных SQL fences.
- [x] Порядок стейтментов соответствует зависимостям: preflight → `_crm_company_emit_domain_event` → `_crm_company_resolve_or_create_internal` → 7 public RPC → `search_global` replacement → ACL REVOKE/GRANT → post-apply invariants → `COMMIT`.

---

## 12. Полный rollback SQL

Файл: `.lovable/rollback/companies-phase2/phase2_rpc_rollback.sql`. Не выполняется без отдельного решения.

<!-- PHASE2_ROLLBACK_SQL_BEGIN -->
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DROP FUNCTION IF EXISTS public.crm_company_upsert_from_billing(uuid);
DROP FUNCTION IF EXISTS public.search_companies(jsonb);
DROP FUNCTION IF EXISTS public.crm_company_merge(uuid, uuid);
DROP FUNCTION IF EXISTS public.crm_company_archive(uuid, text);
DROP FUNCTION IF EXISTS public.crm_company_grp_refetch(uuid);
CREATE OR REPLACE FUNCTION public.crm_company_get_or_create(
  _country text, _unp text, _full_name text, _company_kind text,
  _source text, _source_client_legal_details_id uuid DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin')
       OR has_role_v2(auth.uid(),'super_admin')
       OR has_role_v2(auth.uid(),'menedzher')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT id INTO v_id FROM public.companies
    WHERE country=_country AND unp_normalized=_unp AND status <> 'merged' LIMIT 1;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.crm_company_link_contact(
  _company_id uuid, _profile_id uuid, _relationship_type text,
  _is_billing_contact boolean, _source text, _source_client_legal_details_map_id uuid DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin')
       OR has_role_v2(auth.uid(),'super_admin')
       OR has_role_v2(auth.uid(),'menedzher')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION public.search_global(p_query text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contacts jsonb;
  v_deals jsonb;
  v_messages jsonb;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(v_user_id, 'admin'::app_role)
    OR public.has_role(v_user_id, 'superadmin'::app_role)
    OR public.has_permission(v_user_id, 'users.view')
    OR public.has_admin_section_access(v_user_id, 'contacts', 'view')
    OR public.has_admin_section_access(v_user_id, 'deals', 'view')
    OR public.has_admin_section_access(v_user_id, 'communication', 'view')
  ) THEN
    RAISE EXCEPTION 'Forbidden: admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(c)), '[]'::jsonb) INTO v_contacts
  FROM (
    SELECT p.id as profile_id, p.full_name, p.email, p.phone,
           p.telegram_username, p.status
    FROM profiles p
    WHERE to_tsvector('simple',
      coalesce(p.full_name, '') || ' ' ||
      coalesce(p.email, '') || ' ' ||
      coalesce(p.phone, '') || ' ' ||
      coalesce(p.telegram_username, '')
    ) @@ websearch_to_tsquery('simple', p_query)
    LIMIT p_limit OFFSET p_offset
  ) c;

  SELECT coalesce(jsonb_agg(row_to_json(d)), '[]'::jsonb) INTO v_deals
  FROM (
    SELECT o.id as order_id, o.order_number, o.status::text, o.profile_id,
           o.customer_email, o.customer_phone, p.full_name as contact_name
    FROM orders_v2 o
    LEFT JOIN profiles p ON p.id = o.profile_id
    WHERE to_tsvector('simple',
      coalesce(o.order_number, '') || ' ' ||
      coalesce(o.customer_email, '') || ' ' ||
      coalesce(o.customer_phone, '')
    ) @@ websearch_to_tsquery('simple', p_query)
    LIMIT p_limit OFFSET p_offset
  ) d;

  SELECT coalesce(jsonb_agg(row_to_json(m)), '[]'::jsonb) INTO v_messages
  FROM (
    SELECT
      tm.id,
      'private'::text as source,
      left(tm.message_text, 150) as snippet,
      tm.created_at,
      tm.user_id,
      tm.telegram_user_id,
      NULL::bigint as chat_id,
      p.id as profile_id,
      p.full_name as contact_name
    FROM telegram_messages tm
    LEFT JOIN profiles p ON p.user_id = tm.user_id
    WHERE to_tsvector('simple', coalesce(tm.message_text, ''))
          @@ websearch_to_tsquery('simple', p_query)
    LIMIT p_limit OFFSET p_offset
  ) m;

  RETURN jsonb_build_object(
    'contacts', v_contacts,
    'deals',    v_deals,
    'messages', v_messages
  );
END;
$function$;
-- сначала resolve helper (его вызывали удалённые в §12.2 RPC)
DROP FUNCTION IF EXISTS public._crm_company_resolve_or_create_internal(
  text, text, text, text, uuid, text, uuid);
-- затем emit helper (его вызывали все Phase 2 RPC и resolve helper)
DROP FUNCTION IF EXISTS public._crm_company_emit_domain_event(
  text, uuid, text, jsonb);
-- shared-таблица domain_events не трогается — DDL не создавался
REVOKE ALL ON FUNCTION public.crm_company_get_or_create(text,text,text,text,text,uuid)     FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_get_or_create(text,text,text,text,text,uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)  TO authenticated;
-- search_global ACL остаётся идентичным фактическому pre-Phase-2: authenticated/service_role=EXECUTE, anon/PUBLIC=none
COMMIT;
<!-- PHASE2_ROLLBACK_SQL_END -->

Rollback не изменяет таблицы и данные. Не использует `CASCADE`. `company_sync_queue` очищается отдельным решением при необходимости.

**Copy-paste readiness §12 checklist:**

- [x] Весь canonical SQL §12 находится напрямую между `PHASE2_ROLLBACK_SQL_BEGIN/END`, без markdown-заголовков, прозы и code fences.
- [x] В canonical SQL нет placeholder-переменных, open-item-маркеров и вложенных SQL fences.
- [x] Порядок стейтментов соответствует зависимостям: BEGIN → DROP 5 новых RPC → `CREATE OR REPLACE` двух Phase 1 skeletons → `CREATE OR REPLACE` pre-Phase-2 `search_global` → DROP двух private helper (resolve, затем emit) → восстановление Phase 1 ACL → `COMMIT`.
- [x] Итог: 5 DROP + 2 DROP = **7 DROP FUNCTION**; 2 + 1 = **3 CREATE OR REPLACE FUNCTION**. `search_global` восстанавливается через `CREATE OR REPLACE` (без промежуточного DROP).

---

## 13. Verification SQL (post-apply, read-only)

```sql
-- 13.1 catalog: 7 public RPC + 2 private helper + search_global
SELECT proname, pg_get_function_identity_arguments(oid) FROM pg_proc
 WHERE pronamespace='public'::regnamespace
   AND proname IN ('crm_company_get_or_create','crm_company_link_contact','search_companies',
                   'crm_company_merge','crm_company_archive','crm_company_grp_refetch',
                   'crm_company_upsert_from_billing',
                   '_crm_company_resolve_or_create_internal',
                   '_crm_company_emit_domain_event',
                   'search_global') ORDER BY proname;

-- 13.2 ACL матрица (7 public + 2 private helper)
SELECT p.proname, pg_get_function_identity_arguments(p.oid) args,
       has_function_privilege('anon',           p.oid,'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated',  p.oid,'EXECUTE') AS auth_exec,
       has_function_privilege('service_role',   p.oid,'EXECUTE') AS srv_exec
FROM pg_proc p
WHERE p.pronamespace='public'::regnamespace
  AND (p.proname LIKE 'crm_company_%'
       OR p.proname = 'search_companies'
       OR p.proname = '_crm_company_resolve_or_create_internal'
       OR p.proname = '_crm_company_emit_domain_event');
-- expected: 6 из 7 public RPC — auth_exec=true (upsert_from_billing только srv_exec);
--           оба _crm_company_* helper — все три false.

-- 13.3 policies count = 13, RLS enabled
SELECT c.relname, c.relrowsecurity, count(pl.*) FROM pg_class c
LEFT JOIN pg_policy pl ON pl.polrelid=c.oid
WHERE c.relnamespace='public'::regnamespace
  AND c.relname IN ('companies','company_contacts','client_legal_details_company_map','company_sync_queue')
GROUP BY 1,2;

-- 13.4 baseline hash unchanged
SELECT md5(string_agg(table_name || ':' || column_name || ':' || data_type,
                      ',' ORDER BY table_name, ordinal_position))
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN ('client_legal_details','profiles','public_id_sequences','roles',
                     'role_admin_resource_access','role_admin_section_access','admin_section');
-- expected: c41160b83c8e15c3d3c41a13028700d5

-- 13.5 shared-таблица domain_events НЕ должна иметь Phase 2 индексов
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename='domain_events'
  AND indexname LIKE '%company%';
-- expected: 0 rows

-- 13.6 4 таблицы пусты (после apply, до runtime proof)
SELECT (SELECT count(*) FROM public.companies) c,
       (SELECT count(*) FROM public.company_contacts) cc,
       (SELECT count(*) FROM public.client_legal_details_company_map) m,
       (SELECT count(*) FROM public.company_sync_queue) q;

-- 13.7 CMP sequence unchanged
SELECT last_value FROM public.public_id_sequences WHERE entity_type='company';
```

### 13.8 Placeholder scan (static, applied to canonical SQL blocks §11 и §12)

Область: прямой текст между forward begin/end marker и rollback begin/end marker. Внутри marker-range нет markdown headings, prose и code fences; это copy-paste SQL.

Проверяемые классы маркеров: ellipsis-placeholders, сокращающие фразы, open-item и template markers, template-placeholders и ссылки вместо SQL-тела.

Фактический результат (`python3` extractor, только canonical SQL между markers):

```
--- forward:  0 hits
--- rollback: 0 hits
--- markdown headings inside forward: 0
--- markdown headings inside rollback: 0
--- code fences inside forward: 0
--- code fences inside rollback: 0
```

Ожидание: 0. Совпало.

### 13.9 Счётчики canonical SQL blocks

| Метрика | Область | Ожидание | Факт |
|---|---|---|---|
| `CREATE OR REPLACE FUNCTION` | §11 canonical | 10 (7 public RPC + 2 private helper + `search_global`) | 10 |
| `PERFORM public._crm_company_emit_domain_event(` | §11 canonical (caller bodies + resolve helper) | 7 | 7 |
| `CREATE OR REPLACE FUNCTION public._crm_company_emit_domain_event` | §11 canonical | 1 | 1 |
| `INSERT INTO public.domain_events` | §11 canonical | 1 (только внутри emit helper) | 1 |
| `ON CONFLICT ((payload->>'idempotency_key'))` | §11 canonical | 0 | 0 |
| `DROP FUNCTION` | §12 canonical | 7 (5 новых RPC + 2 private helper) | 7 |
| `CREATE OR REPLACE FUNCTION` | §12 canonical | 3 (2 Phase 1 skeleton + 1 `search_global` restore) | 3 |

### 13.10 Schema whitelist

Проверенные таблицы: `public.companies`, `public.company_contacts`, `public.client_legal_details_company_map`, `public.company_sync_queue`, `public.client_legal_details`. Все ссылки на колонки в canonical SQL §11 и §12 сверены с фактическим `information_schema.columns`.

- `companies`: `id`, `public_id`, `workspace_id`, `company_kind`, `country`, `unp_normalized`, `full_name`, `short_name`, `legal_form`, `legal_address`, `email`, `phone`, `director_name`, `director_position`, `acts_on_basis`, `bank_account`, `bank_name`, `bank_code`, `status`, `merged_into_company_id`, `archived_at`, `metadata`, `created_at`, `created_by`, `updated_at`, `updated_by` — все существуют.
- `company_contacts`: `id`, `company_id`, `profile_id`, `relationship_type`, `is_billing_contact`, `is_primary`, `source`, `source_client_legal_details_map_id`, `metadata`, `updated_at`, `updated_by` — все существуют.
- `client_legal_details_company_map`: `id`, `client_legal_details_id`, `company_id`, `updated_at`, `updated_by` — все существуют. Unique constraint = `client_legal_details_id`; update of `company_id` to `v_target_leaf` не создаёт конфликта.
- `company_sync_queue`: `entity_type`, `entity_id`, `run_reason`, `status`, `idempotency_key`, `next_run_at`, `payload`, `created_by`, `updated_by` — все существуют.
- `client_legal_details`: `id`, `client_type`, `purpose`, `leg_unp`, `ent_unp`, `leg_org_form`, `leg_name`, `ent_name`, `leg_address`, `ent_address`, `leg_director_name`, `leg_director_position`, `leg_acts_on_basis`, `ent_acts_on_basis`, `bank_account`, `bank_name`, `bank_code`, `email`, `phone`, `updated_at` — все существуют.

Неизвестных колонок: **0**.

### 13.11 FINALIZED gate

Все static gate-check пройдены:

- `.lovable/plan.md` должен быть восстановлен из commit `aa14bdaaa0de8fc0fbad99cb31e7f0df99ae51f7`;
- forward marker range — прямой SQL без markdown/prose/fences;
- rollback marker range — прямой SQL без markdown/prose/fences;
- placeholder scan: 0 hits;
- counter matrix (§13.9): все строки совпали;
- schema whitelist (§13.10): 0 неизвестных колонок.

Phase 2 runnable plan: **FINALIZED**. Execution одобрен пользователем 2026-07-19;
admin fixture для `1@ajoure.by` создан commit `3e813d07b` и blocker снят.
Перед apply пакет скорректирован patch v4 и повторно проходит §13 gate. После первого
runtime-прогона неоднозначные scalar-array concatenations в billing RPC заменены на
`array_append`; для уже применённой Phase 2 migration подготовлена отдельная corrective
migration `20260719235959_crm_company_billing_array_append_fix.sql`.

---

## 14. Runtime proof (последовательность, правки 11 и 17)

```
1. Preflight (read-only) через §13.
2. Commit migration артефактов (без применения): SHA-256, diff, filename, отдельный commit.
3. Отдельный execution approve.
4. Apply migration (атомарно, транзакция §11).
5. Отдельная транзакция runtime proof:
   BEGIN; SAVEPOINT proof;
   -- JWT context = user_id=37e91f59-e4db-4840-b9c9-e760e634ddd1 (menedzher):
   --   crm_company_get_or_create OK; повторный OK и одинаковый UUID; CMP-000001;
   --   crm_company_link_contact OK; повторный — не дублирует; invalid billing lineage — reject;
   --   search_companies filters/pagination;
   --   support→read (отдельный тест-JWT с ролью support), admin_gost/editor/user → deny;
   --   crm_company_grp_refetch: первый вызов → queue; повторный → тот же id;
   --   archive/merge → deny для menedzher (правильно);
   -- service_role:
   --   crm_company_upsert_from_billing create/update/stale/no-op/admin-override preservation;
   -- admin fixture 1@ajoure.by (admin + menedzher):
   --   crm_company_archive; crm_company_merge с конфликтующими links; чейн merge;
   -- verify: company branch в search_global.
   ROLLBACK TO SAVEPOINT proof; ROLLBACK;
6. Read-only §13.6/§13.7 — 4 таблицы пусты, sequence=0, тестовые строки activity/events/audit/queue отсутствуют.
```

**Admin fixture:** `1@ajoure.by` имеет роли `admin + menedzher`; admin-only proof разблокирован.

**Failure handling:** если post-commit runtime proof не прошёл — Phase 2 closure блокируется, Phase 3 не начинается, migration не редактируется, автоматический rollback не запускается; составляется blocker-отчёт и принимается отдельное решение о corrective migration или rollback.

### 14.1 Runtime corrective patch

Первый rollback-only proof прошёл для create/idempotency, search, link-contact,
grp-refetch, archive и merge, но billing RPC остановился с `SQLSTATE 22P02` на выражении
`text[] || 'scalar'`. Все proof-транзакции были откатаны; committed fixtures и residue
отсутствуют, company sequence сохранил `last_value=0`.

Corrective migration заменяет все 24 добавления элементов в `v_changed`/`v_conflicts`
на однозначный `array_append(text[], text)`, повторно нормализует service-role-only ACL и
проверяет отсутствие старой формы в `pg_get_functiondef`. Она не меняет таблицы,
данные, policies или другие функции. Отдельный rollback, возвращающий заведомо
дефектное тело, не создаётся; при решении откатить весь Phase 2 используется полный
rollback §12.

### 14.2 Closure result

Phase 2 закрыта после успешного применения forward migration и отдельной corrective
migration, повторного billing-proof и реального двухсессионного concurrency-proof.

- billing create/update/stale/no-op/NULL/admin-override: `PASS`;
- два одновременных `crm_company_get_or_create`: один company UUID, одна строка, без ошибок;
- два одновременных `crm_company_link_contact`: один contact UUID, одна строка, без ошибок;
- side effects дедуплицированы по idempotency keys;
- cleanup выполнен по точным ID; `companies`, `company_contacts`,
  `client_legal_details_company_map`, `company_sync_queue` снова пусты;
- `public_id_sequences('company','CMP').last_value=0`;
- RLS, 13 Phase 1 policies и роли admin fixture не изменились;
- Phase 3/backfill не запускались.

Полные timestamps двухсессионного proof, UUID, hashes, rollback-проверки и история
коррекций зафиксированы в `phase2_runtime_proof_report.md`.

---

## 15. SHA / diff / commit workflow

Перед execution approve:

1. Файл миграции коммитится отдельным commit (без исполнения).
2. Считается `sha256sum <migration-file>` — результат прикладывается к approve-запросу.
3. Нормализованный diff (`normalize whitespace`) старого и нового `search_global` прикладывается к approve-запросу.
4. Указывается exact filename миграции.
5. Migration history после apply — read-only query to migration history; результат = `VERIFIED` либо `NOT VERIFIED — permission denied` (не блокирует, если post-apply catalog state подтверждает применение — §13).

**Final closure fingerprints:**

- canonical forward `20260719210633_crm_companies_phase2_rpc_layer.sql` — 68,739 bytes,
  SHA-256 `990fa56df274cd75a6509647e540cfd4858e46730df11d179167d36c21caf2de`;
- managed applied forward `20260719214544_9aa2edb0-c9dc-4636-a1b4-711accf867c5.sql` —
  68,450 bytes, SHA-256 `3943ea306a2c296d4717b7e3b833f7869666b47fc081e7fcb28fe4c72d351aeb`;
- canonical corrective `20260719235959_crm_company_billing_array_append_fix.sql` —
  22,198 bytes, SHA-256 `11719a8db96444e3fb5ebd2af582637a6a9df12ed9f31751dd35e604374ee24d`;
- managed applied corrective `20260719221105_7ba01396-e921-4be5-b180-2a770a98d708.sql` —
  20,548 bytes, SHA-256 `63c8f6561aa934dd951cfacafb7afaebd79b2a70c0bf8705ae6db6f2528dbfc6`;
- managed exact-ID proof cleanup `20260719222532_d0f06e76-14dd-4829-beed-594b39d4fa54.sql` —
  1,606 bytes, SHA-256 `38389e1dd0e6076007f4433e187f5c1657dc989f1f627c25531e0f042c2ecdc8`;
- full rollback `phase2_rpc_rollback.sql` — 5,320 bytes,
  SHA-256 `6038be4d205bcd78750247ebee4e807db109ca038d7bb1a376654a7f1e2f56f0`.

---

## 16. Файловый scope этапа DRAFT

Ровно:

```
.lovable/discovery/companies-1.0/adr-0002-company-external-ids.md
.lovable/discovery/companies-1.0/companies_phase2_runnable_plan.md
```

**Восстановление `.lovable/plan.md`:** файл возвращён к содержимому Phase 1 ACL hardening (соответствующему commit `ab2d4b05`).

Никаких изменений в `supabase/migrations/**`, существующих RPC, таблицах, данных, `src/**`, `supabase/functions/**`, `supabase/config.toml`.

---

## 17. Stop-guards

Немедленная остановка при любом из:

- дрейф Phase 1 schema/ACL/policies;
- неожиданные данные в 4 таблицах;
- отличия skeleton signatures;
- SHA-256 pre-Phase-2 `search_global` ≠ `3f52ef62916b655d386f56ea1a44d78e261037a19b8c83d674ce09f6dd967e9f`;
- admin fixture отсутствует и archive/merge критичны для approve;
- billing mapping неоднозначен; правила перечислены в §4;
- ownership algorithm требует изменения frozen schema;
- ADR-0002 требует новый DDL;
- runtime proof нельзя выполнить (правка 11 задаёт fallback-статус);
- diff затрагивает UI, edge functions, backfill, worker или таблицы;
- migration history/SHA не зафиксированы до исполнения.

---

## 18. DoD этапа

- Созданы ровно два DRAFT-файла (§16); `.lovable/plan.md` восстановлен до commit `ab2d4b05`.
- Никаких изменений БД, миграций, RPC, UI, edge functions, `supabase/config.toml`.
- Все утверждения о текущем состоянии подкреплены фактическими read-only outputs (§2, §11.1 preflight).
- ADR-0002 содержит фактические outputs `integration_field_mappings` без `?`.
- Runnable-план содержит: RPC signatures, ACL matrix, полное billing mapping, ownership algorithm, event/audit contracts с полными idempotency keys и версиями payload, **полный migration SQL** (§11) и **полный rollback SQL** (§12), verification SQL (§13), runtime proof последовательность (§14), stop-guards (§17).
- Полный merge-контракт (§7) — с разрешением цепочек, запретом циклов, детерминированным locking, объединением contacts и metadata компании.
- Полный контракт private helper (§10) — сигнатура, ACL, dependency graph, order rollback, полный CREATE (§11.2).
- Условия запуска выполнены: execution approve получен, SHA-256 зафиксирован, admin fixture создан; apply выполняется только после успешного preflight.
