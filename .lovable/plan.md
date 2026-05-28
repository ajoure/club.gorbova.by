# да, согласен, с учетом правок:

1. **План правильный: это должен быть только addendum / verify**
  &nbsp;
  Никаких миграций, UI, edge, шаблонов и генерации. Только read-only proof + обновление markdown.
2. **Уточнить “Before”-снимок**
  &nbsp;
  В §1.2 добавить:
  ```md
  Если точного before-снимка из execution-лога нет, не восстанавливать его предположениями. Указать честно:
  "Before reconstructed from migration pre-check / execution log; raw DB-before no longer available."
  ```
  Нельзя писать недоказанные цифры как факт.
3. **Billing regression query поправить**
  &nbsp;
  В §1.3 запрос:
  ```sql
  WHERE entity_type IN ('legal_details','entity_person','document','customer','executor')
  ```
  может не покрыть реальные типы вроде `customer_ind`, `customer_signer`, `executor_legal`, etc.
  Лучше:
4. **Проверку шаблонов сделать шире**
  &nbsp;
  Сейчас проверяется только `docx_body`. Добавить проверку по всем фактическим местам хранения шаблонов:
5. **Alias table grants/RLS**
  &nbsp;
  В §2.1 добавить проверку именно отсутствия `authenticated`:
  ```sql
  SELECT grantee, privilege_type
  FROM information_schema.role_table_grants
  WHERE table_schema='public'
    AND table_name='document_package_token_aliases'
    AND grantee IN ('anon','authenticated','service_role')
  ORDER BY grantee, privilege_type;
  ```
  Ожидание: только `service_role`.
6. **Resolver import scan**
  &nbsp;
  В §2.3 grep лучше сделать так:
  ```bash
  rg -n "resolve-package-tokens|resolvePackageTokens" supabase/functions src
  ```
  Ожидание:
  - найден сам файл;
  - нет импортов/вызовов из production.
7. `metadata.position`
  &nbsp;
  В §2.4 важно не только проверить SQL count, но и UI save-path:
8. **Memory не обязательно через** `mem://`
  &nbsp;
  Если `mem://` технически не является реальным файлом/механизмом проекта, не создавать фиктивные файлы. Тогда правило зафиксировать в:
9. **Финальный статус после addendum**
  &nbsp;
  Добавить ожидаемый статус:

```md
Sprint 3B v2.1 final status:
completed: package person FLD + role aliases + resolver skeleton added; pre-req proof verified; feature flag disabled; generation deferred
```

После этих правок можно approve на выполнение addendum.

&nbsp;

План: Sprint 3B v2.1 Addendum — Pre-req Proof + Verification Block

Цель: закрыть Sprint 3B v2.1 со статусом
`completed: package person FLD + role aliases + resolver skeleton added; feature flag disabled; generation deferred`,
добавив недостающий proof по pre-req изменению `fields_registry.public_id` и зафиксировав 4 verification-блока.

**Никаких** изменений в БД, edge functions, UI, шаблонах, генерации — этот спринт полностью read-only + документация.

---

## 1. Pre-req proof: `fields_registry.public_id NOT NULL + UNIQUE`

Read-only SQL для proof (выполнить через `supabase--read_query`):

### 1.1 «After»-снимок (текущее состояние, post-migration)

```sql
-- total rows + non-null + distinct
SELECT
  COUNT(*)                       AS total_rows,
  COUNT(public_id)               AS non_null_public_id,
  COUNT(DISTINCT public_id)      AS distinct_public_id,
  COUNT(*) FILTER (WHERE public_id IS NULL) AS null_count
FROM public.fields_registry;
-- ожидаем: 368 / 368 / 368 / 0  (либо актуальное N, если за это время добавили FLD-000372/000373 → 370)

-- NOT NULL constraint
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'fields_registry'
  AND column_name = 'public_id';
-- ожидаем: is_nullable = 'NO'

-- UNIQUE constraint / unique index
SELECT conname, contype, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.fields_registry'::regclass
  AND contype IN ('u','p')
  AND pg_get_constraintdef(oid) ILIKE '%public_id%';

-- FK validity
SELECT conname, convalidated, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.document_package_token_aliases'::regclass
  AND contype = 'f';
-- ожидаем: convalidated = true, FK на fields_registry(public_id)
```

### 1.2 «Before»-снимок

Канонический «before» восстанавливается из миграции `20260527202153_*.sql`:

- до миграции `public_id` был `NULLABLE` без UNIQUE;
- миграция содержала `ALTER COLUMN ... SET NOT NULL` + `ADD CONSTRAINT ... UNIQUE (public_id)`;
- pre-check внутри миграции (или в отчете 3B v2.1) подтвердил 368/368/368/0.

Если в исходном отчете явного "before"-блока нет — добавить его как цитату из execution-логов миграции (без повторного выполнения, только текстовая фиксация: «pre-migration: NULL=0, duplicates=0, count=368»).

### 1.3 Billing regression proof (read-only)

```sql
-- billing/customer/executor FLD не изменились по составу
SELECT entity_type, COUNT(*) 
FROM public.fields_registry
WHERE entity_type IN ('legal_details','entity_person','document','customer','executor')
GROUP BY entity_type
ORDER BY entity_type;
-- сравнить со snapshot из Sprint 11 baseline (если есть в .lovable/proofs/)

-- ни один active template не ссылается на новые FLD
SELECT id, name 
FROM public.document_templates
WHERE archived_at IS NULL
  AND (
    docx_body::text ILIKE '%FLD-000372%' OR
    docx_body::text ILIKE '%FLD-000373%' OR
    docx_body::text ILIKE '%package.roles.%'
  );
-- ожидаем: 0 строк
```

---

## 2. Verification block (4 пункта от ревьюера)

### 2.1 Alias table — grants/RLS audit

```sql
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='document_package_token_aliases';
-- ожидаем: только service_role (ALL); НЕТ anon, НЕТ authenticated

SELECT relrowsecurity, relforcerowsecurity 
FROM pg_class WHERE oid='public.document_package_token_aliases'::regclass;
-- ожидаем: rls enabled

SELECT polname, polcmd, polroles::regrole[], pg_get_expr(polqual, polrelid) AS using_expr
FROM pg_policy WHERE polrelid='public.document_package_token_aliases'::regclass;
-- ожидаем: 0 policies (default-deny для anon/authenticated, service_role bypass)
```

### 2.2 Новые FLD не попали в billing/customer/executor picker-группы

- `entity_type` у FLD-000372/000373 = `'person'` (не `legal_details`/`customer`/`executor`/`document`).
- Read-only проверка:

```sql
SELECT public_id, key, entity_type FROM public.fields_registry
WHERE public_id IN ('FLD-000372','FLD-000373');
-- ожидаем: entity_type='person' у обоих
```

- Grep по фронтенду `src/` на жесткие списки `entity_type` в picker (например, `FieldPicker`, `TokensTab`) — подтвердить, что `'person'` либо не включён в billing/customer/executor группы, либо вынесен в отдельную секцию.

### 2.3 `resolve-package-tokens.ts` — нет production imports

```bash
rg -n "resolve-package-tokens" supabase/functions src
# ожидаем: только сам файл; 0 import-ов
```

Зафиксировать в proof `HARDCODED_ENABLED = false` (грep строки).

### 2.4 UI анкеты пакета — поддержка `metadata.position`

Исследование (read-only):

- найти компонент редактирования участников `document_package_session_participants` (вероятно `src/components/documents/package/...`);
- проверить, есть ли поле «Должность» в форме и пишется ли оно в `metadata.position` (а не в отдельный column);
- проверить SQL текущих данных:

```sql
SELECT COUNT(*) AS total,
       COUNT(metadata->>'position') AS with_position,
       COUNT(*) FILTER (WHERE role_key IN ('company_head','responsible_person')) AS role_rows
FROM public.document_package_session_participants;
```

- Результат:
  - **Если UI уже сохраняет `metadata.position**` → зафиксировать proof + смело идти в Sprint 3C dry-run.
  - **Если НЕ сохраняет** → внести в backlog для Sprint 3C: «добавить поле "Должность" в UI ролей `company_head`/`responsible_person`, писать в `metadata.position`». Без этого `package.roles.*.position` всегда вернёт `unresolved`.

---

## 3. Артефакты

1. **Новый proof-файл** `.lovable/proofs/package_documents_sprint3b_v2_1_addendum_2026_05.md` со всеми SQL/grep-результатами по §1 и §2.
2. **Обновление** существующего `.lovable/proofs/package_documents_sprint3b_v2_1_execution_report_2026_05.md`: добавить ссылку «See addendum» в раздел про pre-req.
3. **Обновление** `.lovable/plan.md`:
  - закрыть Sprint 3B v2.1 финально;
  - переименовать Sprint 3C в `Sprint 3C — Package role metadata UI + resolver dry-run integration plan` с целью: «добавить/проверить должности в анкете пакета и подготовить безопасный dry-run resolver, без реальной генерации».
4. **Память** `mem://architecture/documents/package-token-aliases-v1` — короткая правка: упомянуть, что `fields_registry.public_id` стал `NOT NULL UNIQUE` как pre-req FK, и что alias-таблица service_role-only.

## 4. Hard constraints (повтор)

- 0 миграций, 0 INSERT/UPDATE/DELETE, 0 deploy edge functions, 0 UI-изменений.
- Никакого включения `HARDCODED_ENABLED`.
- Никакой генерации документов.
- Не трогать `document_token_aliases`, `canonical-document-generate-strict`, billing/customer/executor резолверы, шаблоны.

## 5. DoD

- §1 pre-req proof (before/after, NOT NULL, UNIQUE, FK valid, billing regression) — в новом addendum-файле.
- §2.1 alias table grants/RLS proof — service_role only, 0 policies, RLS on.
- §2.2 FLD-000372/000373 entity_type=`person`, не в billing/customer/executor группах.
- §2.3 resolver: 0 production imports, `HARDCODED_ENABLED=false`.
- §2.4 UI metadata.position — статус: supported / not-supported (+ запись в Sprint 3C backlog при not-supported).
- Sprint 3C в `.lovable/plan.md` переформулирован под «Package role metadata UI + resolver dry-run integration plan».

После approve — выполняю строго read-only checks и пишу addendum.