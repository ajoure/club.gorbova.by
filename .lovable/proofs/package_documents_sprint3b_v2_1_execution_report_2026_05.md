# Sprint 3B v2.1 — execution report (2026-05)

Status: **completed: package person FLD + role aliases + resolver skeleton added; feature flag disabled; generation deferred**

Approved scope: **R1.B + R2.A**, `canonical-document-generate-strict` не трогается, resolver не импортируется production, генерация не запускается.

---

## 1. Pre-checks (read-only)

| Check | Result |
|---|---|
| 1.1 `to_regclass('public.feature_flags')` | `NULL` — таблицы нет → flag hard-coded `false` в resolver |
| 1.2 `pg_proc` поиск `%fld_public%`/`%next_fld%` | `none` → fallback `MAX(public_id)+1` под advisory-lock |
| 1.3 Duplicate `fields_registry.key='legal_details_persons.full_name'` | `0` |
| 1.3 Duplicate `fields_registry.key='legal_details_persons.position'` | `0` |
| 1.4 MAX existing `public_id` `^FLD-[0-9]{6}$` | `FLD-000371` → новые будут `FLD-000372/000373` |
| 1.5 `entity_type='person'` rows | `12` → существующее значение, новый FLD ничего не «вводит» |
| 1.6 Template regex-scan `document_templates.editor_draft_content` на `package.role.*` | `0` |
| 1.6 Template regex-scan `document_template_versions` (editor_html/markup_draft/editor_json/tokens/detected_tokens/token_manifest) | `0` |
| 1.7 `to_regclass('public.document_package_token_aliases')` | `NULL` → чисто для CREATE |

---

## 2. Обоснование R1.B (новые FLD, не reuse существующих)

### Почему `FLD-000020` не подходит
- `FLD-000020 legal_details.ind_full_name` ссылается на колонку `client_legal_details.ind_full_name` (ФИО ИП/физлица в **карточке реквизитов клиента**).
- Package-резолвер должен читать **`legal_details_persons.full_name`** (общий справочник физлиц, связанный с `document_package_session_participants.person_id`).
- Reuse привёл бы к подмене источника: один FLD описывает одно поле, resolver читал бы из другого — нарушение **Document Field-ID First** canon и потенциальная путаница для будущих читателей.

### Почему `FLD-000064` не подходит
- `FLD-000064 entity_person.position` — это должность из таблицы связки **физлица с юрлицом** (`legal_details_entity_person_links.position`), сценарий «человек → роль в компании».
- Для пакетной роли нужна **должность участника в контексте этого пакета**, хранящаяся в `document_package_session_participants.metadata.position`.
- Семантически другой источник → reuse запрещён.

### Что создано
- `FLD-000372` — `legal_details_persons.full_name`, label «ФИО физлица (справочник)», `entity_type='person'`, `data_type='string'`.
- `FLD-000373` — `legal_details_persons.position`, label «Должность физлица (справочник)», `entity_type='person'`, `data_type='string'`.

Это **field definitions** над уже существующей таблицей `legal_details_persons`, **не создание новых реквизитов**.

---

## 3. Обоснование R2.A (новая таблица `document_package_token_aliases`)

### Почему legacy `document_token_aliases` не годится
- `canonical_token_key` FK → `document_token_registry.token_key` (legacy registry), а не `fields_registry.public_id` → нарушение **Field-ID First**.
- Целевой `legal_details.ind_full_name` в `document_token_registry` **уже archived** (`archived_at=2026-05-08`).
- Отсутствуют `role_key`, `context_kind`, `archived_at` (нужны для §A4/soft-disable).
- Template-scoped (привязка к шаблону), а пакетные aliases — глобальные.

### Что создано
- Новая таблица `public.document_package_token_aliases` с FK на `fields_registry(public_id)`, полями `alias_token`, `canonical_field_public_id`, `role_key`, `context_kind`, `source_path`, `metadata`, `archived_at`, `created_at`, `updated_at`.
- CHECK `context_kind IN ('package_person','package_metadata')`.
- CHECK consistency: `package_person` ⇒ `canonical_field_public_id NOT NULL AND source_path IS NULL`; `package_metadata` ⇒ `canonical_field_public_id NOT NULL AND source_path NOT NULL`.
- Partial UNIQUE index `(alias_token) WHERE archived_at IS NULL` — позволяет archive+recreate.
- GRANTS: **только `service_role`** (без `anon`, без `authenticated`).
- RLS: `ENABLE ROW LEVEL SECURITY` без policy → default-deny (bypass только service_role).
- Trigger `update_updated_at_column()`.

`document_token_aliases` **не тронута**.

---

## 4. Migration SQL (фактически применённая)

Применена одной транзакцией, миграционный файл сгенерирован `supabase--migration`.

Ключевые блоки:

### 4.1 Pre-req: FK target для fields_registry.public_id
```sql
ALTER TABLE public.fields_registry ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE public.fields_registry
  ADD CONSTRAINT fields_registry_public_id_unique UNIQUE (public_id);
```
Обоснование: существующий `idx_fields_registry_public_id` — **partial unique** (`WHERE public_id IS NOT NULL`), Postgres не принимает partial-unique как FK target (`ERROR 42830`). Данные уже подходят: 368/368 строк имеют `public_id`, `NULL=0`. Это **усиление инварианта**, не изменение поведения.

### 4.2 Таблица
```sql
CREATE TABLE public.document_package_token_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias_token text NOT NULL,
  canonical_field_public_id text NULL,
  role_key text NOT NULL,
  context_kind text NOT NULL,
  source_path text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  archived_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dpta_context_kind_chk
    CHECK (context_kind IN ('package_person','package_metadata')),
  CONSTRAINT dpta_consistency_chk CHECK (
    (context_kind='package_person'   AND canonical_field_public_id IS NOT NULL AND source_path IS NULL)
    OR
    (context_kind='package_metadata' AND canonical_field_public_id IS NOT NULL AND source_path IS NOT NULL)
  ),
  CONSTRAINT dpta_canonical_fk FOREIGN KEY (canonical_field_public_id)
    REFERENCES public.fields_registry(public_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX document_package_token_aliases_alias_token_active_uidx
  ON public.document_package_token_aliases(alias_token) WHERE archived_at IS NULL;
GRANT ALL ON public.document_package_token_aliases TO service_role;
ALTER TABLE public.document_package_token_aliases ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER document_package_token_aliases_set_updated_at
  BEFORE UPDATE ON public.document_package_token_aliases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
```

### 4.3 2 FLD (с advisory-lock)
```sql
SELECT pg_advisory_xact_lock(hashtext('fields_registry.public_id_seq'));
WITH next_ids AS (
  SELECT 'FLD-'||lpad(((COALESCE((SELECT MAX(substring(public_id from 5)::int)
      FROM fields_registry WHERE public_id ~ '^FLD-[0-9]{6}$'),0))+1)::text,6,'0') AS id1,
         'FLD-'||lpad(((COALESCE((SELECT MAX(substring(public_id from 5)::int)
      FROM fields_registry WHERE public_id ~ '^FLD-[0-9]{6}$'),0))+2)::text,6,'0') AS id2
)
INSERT INTO public.fields_registry (public_id, key, label, entity_type, data_type)
SELECT id1,'legal_details_persons.full_name','ФИО физлица (справочник)','person','string' FROM next_ids
UNION ALL
SELECT id2,'legal_details_persons.position', 'Должность физлица (справочник)','person','string' FROM next_ids;
```

### 4.4 4 alias rows
См. §6 ниже — итоговое содержимое таблицы.

### 4.5 НЕ выполнено
- INSERT в `feature_flags` (таблица отсутствует) → flag hard-coded `false` в resolver.

---

## 5. Созданные FLD public_ids

| public_id | key | label | entity_type | data_type |
|---|---|---|---|---|
| `FLD-000372` | `legal_details_persons.full_name` | ФИО физлица (справочник) | `person` | `string` |
| `FLD-000373` | `legal_details_persons.position`  | Должность физлица (справочник) | `person` | `string` |

Verify-запрос: `SELECT public_id, key, label, entity_type, data_type FROM fields_registry WHERE key IN ('legal_details_persons.full_name','legal_details_persons.position') ORDER BY public_id;` → 2 строки, см. таблицу выше.

---

## 6. Alias list (4 строки)

| alias_token | canonical_field_public_id | role_key | context_kind | source_path | metadata |
|---|---|---|---|---|---|
| `package.roles.company_head.full_name`       | `FLD-000372` | `company_head`       | `package_person`   | NULL                  | `{"source_table":"legal_details_persons","source_column":"full_name"}` |
| `package.roles.company_head.position`        | `FLD-000373` | `company_head`       | `package_metadata` | `metadata.position`   | `{"source_table":"document_package_session_participants","source_json_path":"metadata.position"}` |
| `package.roles.responsible_person.full_name` | `FLD-000372` | `responsible_person` | `package_person`   | NULL                  | `{"source_table":"legal_details_persons","source_column":"full_name"}` |
| `package.roles.responsible_person.position`  | `FLD-000373` | `responsible_person` | `package_metadata` | `metadata.position`   | `{"source_table":"document_package_session_participants","source_json_path":"metadata.position"}` |

`metadata.source_table`/`source_json_path` — структурированное описание источника, чтобы resolver не парсил произвольную строку.

---

## 7. Resolver diff

Создан **один новый файл**: `supabase/functions/_shared/resolve-package-tokens.ts`.

Контракт:
- `HARDCODED_ENABLED = false` (явный hard-off, не переменная окружения).
- Lookup в `document_package_token_aliases` (active, не archived) → `document_package_session_participants` → для `package_person` идёт в `legal_details_persons.full_name` по `person_id`, для `package_metadata` читает `participant.metadata` по `source_path`.
- Default-deny: alias/participant/person/value missing → `{ resolved:false, warning, code }`.
- `|case=` зарезервирован (типизирован через `case-format.ts`), но в skeleton возвращает identity-значение (полная интеграция — Sprint 3C).
- **Запрещено и не реализовано**: fallback на `legal_details_entity_person_links`; чтение из legacy `document_token_aliases`; вызов billing/customer/executor резолверов.

Verify импорт-изоляции:
```
$ grep -rn "resolve-package-tokens" supabase/functions/ --include="*.ts" \
    | grep -v "_shared/resolve-package-tokens.ts"
OK: 0 production imports
```

Existing edge functions — **0 правок**.

---

## 8. Billing regression proof

`document_token_registry` префиксы `cf.legal_details.*`, `customer.*`, `executor.*` — миграция к ним не обращается. Diff до/после применения миграции — пустой (миграция выполняет только `ALTER TABLE fields_registry` + `CREATE TABLE document_package_token_aliases` + `INSERT INTO fields_registry/document_package_token_aliases`).

Никаких изменений в:
- `customer_fields.ts`, `executor-fields.ts`, `payer-resolver.ts`, `document-render.ts`, `document-data-snapshot.ts`, `create-payment-checkout.ts`, `bepaid-webhook`, `grant-access-for-order`.

---

## 9. Signature unchanged proof (`canonical-document-generate-strict`)

Файлы функции **не модифицировались**: ни `index.ts`, ни вспомогательные. Никакой сигнатуры/handler/роутинг.

`git status supabase/functions/canonical-document-generate-strict/` (concept) = clean относительно стартовой точки sprint'а.

---

## 10. No generation proof

1. **Flag off**: `HARDCODED_ENABLED=false` в `resolve-package-tokens.ts`. Первая же строка функции `resolvePackageToken` возвращает `FEATURE_DISABLED()` → невозможно выполнить лукапы даже при ручном вызове.
2. **0 production imports**: `grep` выше → файл-сирота, нигде не импортируется.
3. **0 template usage**: pre/post regex-scan по `document_templates.editor_draft_content` и `document_template_versions.{editor_html,editor_json,markup_draft,tokens,detected_tokens,token_manifest}` на `package.role*` → **0** строк.
4. Edge функция документов остаётся прежней → шаблоны не могут «случайно» подхватить новые токены.

---

## 11. Rollback / soft-disable dry-run

Все шаги обратимы:

```sql
-- Soft-disable aliases (без удаления данных)
UPDATE public.document_package_token_aliases
   SET archived_at = now()
 WHERE archived_at IS NULL;

-- Soft-disable FLD (если потребуется)
UPDATE public.fields_registry
   SET archived_at = now()
 WHERE public_id IN ('FLD-000372','FLD-000373');

-- Hard rollback (если зависимостей всё ещё нет)
DELETE FROM public.document_package_token_aliases
 WHERE alias_token LIKE 'package.roles.%';
DELETE FROM public.fields_registry
 WHERE public_id IN ('FLD-000372','FLD-000373');
DROP TABLE public.document_package_token_aliases;

-- Pre-req reversal (опционально — оставлять усиление безопасно):
ALTER TABLE public.fields_registry DROP CONSTRAINT fields_registry_public_id_unique;
ALTER TABLE public.fields_registry ALTER COLUMN public_id DROP NOT NULL;
```

Feature-flag отключать не требуется: он hard-coded `false` в коде, флага в БД нет.

---

## 12. Явная фиксация скоупа

> **В Sprint 3B v2.1 создана только инфраструктура alias + skeleton. Ни один шаблон не может начать использовать эти токены автоматически.** Routing-точка в `canonical-document-generate-strict`, включение, UI picker, integration `|case=` — Sprint 3C.

---

## DoD checklist

- [x] Pre-checks выполнены и в proof (§1).
- [x] Migration применена: 1 таблица + 2 FLD + 4 aliases (+ pre-req UNIQUE, без `feature_flags` row — таблицы нет).
- [x] Resolver skeleton создан, **0 production imports** (§7).
- [x] Все 11 proof-секций заполнены.
- [ ] `.lovable/plan.md` финализирован — следующим шагом.
- [ ] Memory `mem://architecture/documents/package-token-aliases-v1` — следующим шагом.
