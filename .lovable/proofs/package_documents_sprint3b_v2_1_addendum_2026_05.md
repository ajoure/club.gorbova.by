# Sprint 3B v2.1 — Addendum: Pre-req Proof + Verification Block

Дата: 2026-05-28
Тип: **read-only audit + документация**. 0 миграций, 0 INSERT/UPDATE/DELETE, 0 deploy edge, 0 UI-изменений.

Финальный статус Sprint 3B v2.1:
```
completed: package person FLD + role aliases + resolver skeleton added;
pre-req proof verified; feature flag disabled; generation deferred
```

---

## 1. Pre-req proof: `fields_registry.public_id` → `NOT NULL UNIQUE`

### 1.1 «After»-снимок (post-migration, факт 2026-05-28)

| Метрика | Значение | Ожидание | OK |
|---|---:|---|:--:|
| `COUNT(*)` | **370** | 368 (до миграции 3B) + 2 (FLD-000372/000373) | ✅ |
| `COUNT(public_id)` | **370** | = total | ✅ |
| `COUNT(DISTINCT public_id)` | **370** | = total | ✅ |
| `COUNT(*) FILTER public_id IS NULL` | **0** | 0 | ✅ |
| `information_schema.columns.is_nullable` | **`NO`** | `NO` | ✅ |
| UNIQUE constraint | `fields_registry_public_id_unique UNIQUE (public_id)` | exists | ✅ |
| FK `dpta_canonical_fk` | `FOREIGN KEY (canonical_field_public_id) REFERENCES fields_registry(public_id) ON DELETE RESTRICT`, `convalidated=true` | valid | ✅ |

SQL-источники (read-only через `supabase--read_query`):
```sql
SELECT COUNT(*), COUNT(public_id), COUNT(DISTINCT public_id),
       COUNT(*) FILTER (WHERE public_id IS NULL)
FROM public.fields_registry;
-- 370 / 370 / 370 / 0

SELECT is_nullable FROM information_schema.columns
WHERE table_schema='public' AND table_name='fields_registry' AND column_name='public_id';
-- NO

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid='public.fields_registry'::regclass
  AND contype IN ('u','p') AND pg_get_constraintdef(oid) ILIKE '%public_id%';
-- fields_registry_public_id_unique UNIQUE (public_id)

SELECT conname, convalidated, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid='public.document_package_token_aliases'::regclass AND contype='f';
-- dpta_canonical_fk | true | FOREIGN KEY (canonical_field_public_id) REFERENCES fields_registry(public_id) ON DELETE RESTRICT
```

### 1.2 «Before»-снимок

**Before reconstructed from migration pre-check / execution log; raw DB-before no longer available.**

Из миграции `supabase/migrations/20260527202153_*.sql`:
- до миграции `public_id` был `NULLABLE` без UNIQUE;
- миграция содержала `ALTER COLUMN public_id SET NOT NULL` + `ADD CONSTRAINT fields_registry_public_id_unique UNIQUE (public_id)`;
- pre-check в execution-логе Sprint 3B v2.1 подтвердил: `total=368`, `non_null=368`, `distinct=368`, `null_count=0`, `duplicates=0` — поэтому добавление NOT NULL/UNIQUE прошло без CONFLICT.

Конкретные «before»-числа далее не выдумываются и не сверяются повторно — фиксируем только то, что подтверждается миграцией и логом.

### 1.3 Billing/templates regression (read-only)

**A. Состав FLD по `entity_type`** (срез 2026-05-28):

| entity_type | count |
|---|---:|
| agenda | 1 |
| contact | 6 |
| customer | 20 |
| customer_ent | 24 |
| customer_ind | 26 |
| customer_leg | 24 |
| customer_signer | 4 |
| deal | 18 |
| decision | 1 |
| document | 30 |
| entity | 6 |
| entity_person | 6 |
| executor | 15 |
| executor_leg | 23 |
| legal_details | 47 |
| meeting | 15 |
| offer | 7 |
| **package** | **8** |
| payment | 14 |
| **person** | **14** *(включая новые FLD-000372/000373)* |
| product | 7 |
| system | 11 |
| tariff | 6 |
| user_requisites | 37 |

Группы `legal_details / customer* / executor* / document` не получили новых записей в рамках 3B v2.1.

**B. Шаблоны на новые FLD/токены — 0 совпадений:**

```sql
-- document_templates (active = deleted_at IS NULL)
-- проверены: placeholders, editor_draft_content, file_name_template
SELECT id, name FROM public.document_templates
WHERE deleted_at IS NULL
  AND (placeholders::text ILIKE ANY (ARRAY['%FLD-000372%','%FLD-000373%','%package.roles.%'])
    OR coalesce(editor_draft_content::text,'') ILIKE ANY (ARRAY['%FLD-000372%','%FLD-000373%','%package.roles.%'])
    OR coalesce(file_name_template,'') ILIKE ANY (ARRAY['%FLD-000372%','%FLD-000373%','%package.roles.%']));
-- 0 rows

-- document_template_versions: tokens, detected_tokens, token_manifest, editor_html
SELECT count(*) FROM public.document_template_versions
WHERE coalesce(tokens::text,'')         ILIKE ANY (ARRAY['%FLD-000372%','%FLD-000373%','%package.roles.%'])
   OR coalesce(detected_tokens::text,'') ILIKE ANY (ARRAY['%FLD-000372%','%FLD-000373%','%package.roles.%'])
   OR coalesce(token_manifest::text,'')  ILIKE ANY (ARRAY['%FLD-000372%','%FLD-000373%','%package.roles.%'])
   OR coalesce(editor_html,'')           ILIKE ANY (ARRAY['%FLD-000372%','%FLD-000373%','%package.roles.%']);
-- 0
```

Вывод: ни один active template / версия не ссылается на новые FLD или alias-токены. Billing/customer/executor резолверы не задеты.

---

## 2. Verification block (4 пункта от ревьюера)

### 2.1 `document_package_token_aliases` — grants/RLS audit ✅

```sql
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='document_package_token_aliases'
  AND grantee IN ('anon','authenticated','service_role','PUBLIC')
ORDER BY grantee, privilege_type;
-- → 0 rows  (нет ни одного explicit grant для anon/authenticated/service_role/PUBLIC)
```

```sql
SELECT relrowsecurity AS rls_on, relforcerowsecurity AS rls_force,
  (SELECT count(*) FROM pg_policy WHERE polrelid='public.document_package_token_aliases'::regclass) AS policy_count,
  (SELECT relowner::regrole::text FROM pg_class WHERE oid='public.document_package_token_aliases'::regclass) AS owner
FROM pg_class WHERE oid='public.document_package_token_aliases'::regclass;
-- → rls_on=true, rls_force=false, policy_count=0, owner=postgres
```

**Trace:**
- RLS включён, **0 policies** → для `anon` и `authenticated` фактический доступ закрыт (default-deny).
- Нет explicit `GRANT` для `anon`/`authenticated` → PostgREST (Data API) не сможет даже увидеть таблицу с этих ролей.
- `service_role` обходит RLS на уровне Postgres role attribute (`BYPASSRLS`) и владеет дефолтным доступом через service-ключ; explicit grant ему не требуется. Edge-функции, использующие `SUPABASE_SERVICE_ROLE_KEY`, продолжат читать/писать таблицу.

**Итог:** таблица — service_role only, anon/authenticated полностью закрыты. ✅

### 2.2 Новые FLD не попали в billing/customer/executor picker-группы ✅

```sql
SELECT public_id, key, entity_type FROM public.fields_registry
WHERE public_id IN ('FLD-000372','FLD-000373');
-- FLD-000372 | legal_details_persons.full_name | person
-- FLD-000373 | legal_details_persons.position  | person
```

Picker-стороной (frontend `src/components/ai-documents/`):
- `DealDocumentsPanel.tsx` явно скрывает `entity_type='executor'` и работает по registry-driven SOT (`fields_registry.entity_type`). Группы `customer*`/`executor*`/`legal_details` не содержат `person`.
- `DocumentPackageIdeologyView.tsx` уже использует `entity_type === 'person'` как отдельный класс (role-bound), не смешивая с billing-группами.
- В `FieldPickerPopover.tsx` нет жёсткого whitelist `entity_type`, фильтрация поднимается из caller-а.

**Итог:** FLD-000372/000373 с `entity_type='person'` не попадают в billing/customer/executor секции picker-а. ✅

### 2.3 `resolve-package-tokens.ts` — нет production imports ✅

```bash
$ rg -n "resolve-package-tokens|resolvePackageTokens" supabase/functions src
supabase/functions/_shared/resolve-package-tokens.ts:2:// resolve-package-tokens.ts — Sprint 3B v2.1 SKELETON (isolated, NOT WIRED)
# → найден ТОЛЬКО сам файл; 0 import-ов, 0 call-sites
```

```bash
$ rg -n "HARDCODED_ENABLED" supabase/functions/_shared/resolve-package-tokens.ts
8:// отсутствует в БД → жёстко выключен через HARDCODED_ENABLED=false.
26: export const HARDCODED_ENABLED = false;
81: if (!HARDCODED_ENABLED) return FEATURE_DISABLED();
```

**Итог:** resolver — изолированный skeleton. `HARDCODED_ENABLED = false`, 0 production-импортов, billing flow не затронут. ✅

### 2.4 UI анкеты пакета — `metadata.position` ⚠️ NOT SUPPORTED

**DB-срез:**
```sql
SELECT COUNT(*) total,
  COUNT(*) FILTER (WHERE metadata ? 'position') with_position_key,
  COUNT(*) FILTER (WHERE coalesce(metadata->>'position','')<>'') with_position_value,
  COUNT(*) FILTER (WHERE role_key IN ('company_head','responsible_person')) role_rows
FROM public.document_package_session_participants;
-- total=0, with_position_key=0, with_position_value=0, role_rows=0
```
Таблица пока пуста — ни одна анкета пакета ещё не заполнялась в проде.

**UI save-path** (`src/hooks/useDocumentPackageSession.ts` + `src/components/ai-documents/DocumentPackageIdeologyView.tsx`):
- grep по `position` в этих файлах → **0 совпадений**;
- grep по `metadata` → **0 совпадений в save-path** участников пакета;
- значит форма участников НЕ имеет поля «Должность» и НЕ пишет `metadata.position`.

**Вывод:** alias-токены `package.roles.{company_head,responsible_person}.position` сейчас **гарантированно вернут `unresolved`**, потому что source отсутствует и в UI, и в данных.

**→ Backlog для Sprint 3C (обязательно):**
1. В UI ролей участников пакета (`DocumentPackageIdeologyView` + соответствующая форма) добавить поле «Должность».
2. Save-path: писать значение в `document_package_session_participants.metadata.position` (НЕ создавать отдельный column).
3. Дать тестовое заполнение для роли `company_head` / `responsible_person` и подтвердить, что после включения `HARDCODED_ENABLED=true` resolver вернёт `resolved`.

---

## 3. DoD checklist

- [x] §1.1 «After»-снимок: 370/370/370/0, NOT NULL=YES, UNIQUE constraint, FK valid.
- [x] §1.2 «Before»-снимок честно помечен как reconstructed из миграции/лога.
- [x] §1.3 Billing regression: 0 шаблонов и 0 версий ссылаются на новые FLD/токены.
- [x] §2.1 Alias table: RLS on, 0 policies, 0 grants для anon/authenticated → service_role only.
- [x] §2.2 FLD-000372/000373 → `entity_type='person'`, не в billing/customer/executor picker-группах.
- [x] §2.3 `resolve-package-tokens.ts`: 0 production imports, `HARDCODED_ENABLED=false`.
- [x] §2.4 UI `metadata.position` — **NOT supported**, занесено в Sprint 3C backlog.

## 4. Что НЕ делалось

- 0 миграций (FK/RLS/grants уже валидны).
- 0 INSERT/UPDATE/DELETE.
- 0 изменений в edge-функциях, UI, шаблонах, billing/customer/executor резолверах.
- `HARDCODED_ENABLED` не менялся (остаётся `false`).
- Документы не генерируются.

## 5. Кросс-ссылки

- Основной отчет: `.lovable/proofs/package_documents_sprint3b_v2_1_execution_report_2026_05.md` (§Pre-req — см. этот addendum).
- Миграция: `supabase/migrations/20260527202153_*.sql`.
- Resolver: `supabase/functions/_shared/resolve-package-tokens.ts`.
- Memory: `mem://architecture/documents/package-token-aliases-v1`.
- План: `.lovable/plan.md` (Sprint 3C переформулирован под «Package role metadata UI + resolver dry-run integration plan»).
