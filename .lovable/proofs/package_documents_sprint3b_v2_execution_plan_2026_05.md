# Sprint 3B v2.1 — Execution Plan (approved, but execution paused for 9 amendments)

Дата: 2026-05-27
Статус: `approved_as_execution_plan; pre_execution_amendments_required` — миграция / edge / UI не выполняются до закрытия §A1–§A9.

## 0. Инварианты (наследуются 3A + 3A.1)

- Reuse-first; existing 47 `legal_details` FLD — единственный source requisite-полей.
- Default-deny: без `package_session_id` / без `role_key` → `unresolved`. Никакого fallback на `legal_details_entity_person_links`.
- Billing / customer / executor resolver и `canonical-document-generate-strict` signature — без изменений.
- Alias-wrapper не имеет собственного source: только ссылка на canonical source FLD + `role_key` (исключение — `package_metadata` aliases, см. §A4).
- Auto-fill `plan_year` из текущей даты — запрещён.
- Hard DELETE запрещён; rollback = soft-disable через `archived_at` + feature flag.
- **Плейсхолдеры в шаблонах — только по public_id (`{{field:FLD-XXXXXX}}` и alias-token); slug/`key`-имена в DOCX/manifest/snapshot/source_trace запрещены** (canon: `architecture/documents/field-id-first-canon`).

## 1. FLD-дельта

### 1.1 Canonical person FLD (создаём ровно 1)

| Поле | Значение |
|---|---|
| `key` | `legal_details_persons.full_name` |
| `label` | ФИО физлица (legal_details_persons) |
| `entity_type` | **см. §A3** — выбирается строго по существующему дискавери `fields_registry`, без введения нового значения |
| `data_type` | `string` |
| `category` | `person` |
| `source_table` | `legal_details_persons` |
| `source_column` | `full_name` |
| `template_scope` | `generic` |
| `public_id` | `FLD-XXXXXX` через existing generator (см. §A6) |

### 1.2 Plan year — **не включается** в Sprint 3B v2 без отдельного approve (см. §A8, §6).

### 1.3 Role-specific FLD ФИО / должности — **НЕ создаются**.

## 2. Alias-wrappers (в `document_token_aliases`, не в `fields_registry`)

Aliases для INSERT:

| alias_token | source_field_public_id | role_key | context_kind |
|---|---|---|---|
| `package.role.company_head.full_name` | `FLD-XXXXXX` (canonical person) | `company_head` | `package_role` |
| `package.role.responsible_person.full_name` | `FLD-XXXXXX` (canonical person) | `responsible_person` | `package_role` |
| `package.role.company_head.position` | `NULL` (см. §A4) | `company_head` | `package_metadata` |
| `package.role.responsible_person.position` | `NULL` (см. §A4) | `responsible_person` | `package_metadata` |

Шаблоны используют alias-token. Прямой синтаксис `{{field:FLD-...|role=...}}` запрещён до §A5.

## 3. Resolver `_shared/resolve-package-tokens.ts`

См. v2 §3. Без изменений по сути; только дополнения по §A5 (parser-proof для `|role=`) и §A4 (явный `package_metadata` путь).

Гейтинг: `feature_flags.documents_package_resolver_enabled` default `false` (см. §A7).

## 4. Покрытие первого приказа

См. v2 §4. Уточнения:
- Город — см. §A9 (deferred если нет отдельной city-колонки).
- Plan year — см. §A8 (исключён из этого sprint).
- Номер/дата приказа — reuse `FLD-000069/070` (уже подтверждены generic в 3A.1).

---

# §A. Pre-execution amendments (обязательные, добавлены при approve)

## §A1 — `document_token_aliases` НЕ получает anon

Скорректированный DDL (заменяет блок в §2 v2):

```sql
CREATE TABLE IF NOT EXISTS public.document_token_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias_token text NOT NULL UNIQUE,
  source_field_public_id text NULL,         -- NULL для package_metadata aliases (см. §A4)
  role_key text NULL,
  context_kind text NOT NULL,               -- enum-like: 'package_role' | 'package_metadata'
  notes text NULL,
  archived_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Служебный registry: anon доступ запрещён.
GRANT SELECT ON public.document_token_aliases TO authenticated;
GRANT ALL ON public.document_token_aliases TO service_role;
-- NO grant to anon.

ALTER TABLE public.document_token_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "aliases readable to authenticated"
  ON public.document_token_aliases
  FOR SELECT
  TO authenticated
  USING (true);

-- Write — только service_role (RLS закрыт; service_role bypass RLS).
-- Никаких INSERT/UPDATE/DELETE policies для authenticated/anon.
```

## §A2 — Discovery аналога `document_token_aliases` ПЕРЕД CREATE TABLE

Перед `CREATE TABLE IF NOT EXISTS` обязательный read-only discovery (в proof-execution):

```sql
-- 1. Существует ли таблица с этим именем
SELECT to_regclass('public.document_token_aliases');

-- 2. Существует ли альтернативная alias-таблица под иным именем
SELECT table_name FROM information_schema.tables
WHERE table_schema='public'
  AND (table_name ILIKE '%token%alias%' OR table_name ILIKE '%alias%token%' OR table_name ILIKE '%document_alias%');

-- 3. Существует ли alias-функционал внутри document_token_registry
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='document_token_registry'
  AND (column_name ILIKE '%alias%' OR column_name='is_alias' OR column_name='alias_of');
```

Решение:
- Если существует прямой аналог → **не создаём новую таблицу**, переиспользуем найденную с минимальной adapter-логикой и фиксируем в proof.
- Если нет — создаём по DDL из §A1.

## §A3 — `entity_type` нового person FLD — discovery, не свободный выбор

Перед INSERT в `fields_registry`:

```sql
SELECT entity_type, count(*) FROM fields_registry GROUP BY entity_type ORDER BY count DESC;
SELECT public_id, key, entity_type FROM fields_registry
  WHERE source_table='legal_details_persons' OR key ILIKE '%legal_details_person%' OR entity_type ILIKE '%person%';
```

Правило:
- Использовать **только** значение `entity_type`, которое уже встречается в `fields_registry` для смежных person/legal_details_persons полей.
- **Нельзя** вводить новый `entity_type` (`person`, `legal_details_person`, и т.п.), если такого ещё нет в registry.
- Если ни одного подходящего `entity_type` не найдено → execution **stop**, выносим отдельным architecture decision.

## §A4 — Alias на metadata: `context_kind='package_metadata'`, не "token alias"

Для `package.role.*.position`:
- `source_field_public_id = NULL` допустим **только** при `context_kind='package_metadata'`.
- В resolver чётко разделены ветки: `package_role` (через `source_field_public_id` → fields_registry → DB column) vs `package_metadata` (прямое чтение `document_package_session_participants.metadata->>'position'`).
- В `document_token_registry` для этих 2 alias-token **не создаётся** строка с фиктивным `field_id` — alias живёт только в `document_token_aliases`. Резолвер при routing-точке принимает alias_token, не FLD-id.
- В proof фиксируется: «package_metadata alias ≠ token-alias на FLD; это metadata-token со своим путём резолвинга».

Ограничение CHECK (добавляется в DDL §A1):

```sql
ALTER TABLE public.document_token_aliases
  ADD CONSTRAINT document_token_aliases_source_consistency CHECK (
    (context_kind = 'package_role'     AND source_field_public_id IS NOT NULL) OR
    (context_kind = 'package_metadata' AND source_field_public_id IS NULL)
  );
```

## §A5 — Прямой `{{field:FLD-...|role=...}}` запрещён до parser-proof

- Основной путь — alias-wrapper.
- Прямой `|role=` модификатор включается **только** после отдельного proof:
  1. Парсер плейсхолдеров (regex `^\{\{field:FLD-[0-9]+(\|[a-z]+=[a-z_]+)*\}\}$` или эквивалент) распознаёт `|role=` без классификации как `legacy_placeholder_format_detected`.
  2. Render-движок резолвит `|role=` без регрессий по billing/existing шаблонам.
  3. В `canonical-template-validate` обновлён whitelist модификаторов.
- До закрытия proof — `|role=` в DOCX считается невалидным, alias-wrapper единственный способ.

## §A6 — `next_fld_public_id()` proof перед миграцией

Перед использованием в миграции:

```sql
-- Существование функции
SELECT proname, pg_get_function_arguments(oid)
FROM pg_proc WHERE proname ILIKE '%fld%public%id%' OR proname ILIKE '%next_fld%';

-- Если нет — найти как существующая pipeline выделяет FLD-XXXXXX
SELECT MAX(public_id) FROM fields_registry WHERE public_id ~ '^FLD-[0-9]{6}$';
```

Правило:
- Если функция существует → используем её.
- Если нет — выделяем `FLD-XXXXXX` явным `SELECT 'FLD-' || lpad((max+1)::text, 6, '0')` внутри миграции под advisory-lock, без введения новой generator-функции.
- Псевдовызов `next_fld_public_id()` в финальном SQL **запрещён**, заменяется на фактический механизм.

## §A7 — `feature_flags` не создаётся вслепую

Перед `INSERT INTO feature_flags ...`:

```sql
SELECT to_regclass('public.feature_flags');
SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='feature_flags';
```

Решение:
- Если таблица существует и поддерживает `(key text, enabled boolean)` или эквивалент → используем существующую схему (`ON CONFLICT DO NOTHING` по PK).
- Если схема иная — приводим INSERT под фактические колонки, в proof фиксируем точный shape.
- Если таблицы нет — execution **stop**; создание feature_flags-инфраструктуры — отдельный sprint, в Sprint 3B v2 не делается. Гейтинг временно реализуется hard-coded `false` в resolver-модуле до отдельного approve.

## §A8 — Plan year в Sprint 3B v2 **исключён**

- В этом sprint **не создаётся** никакой plan_year FLD, не добавляется alias `package.context.plan_year`, не активируется ни вариант A, ни B, ни C.
- Шаблон рендерит плейсхолдер `unresolved` для plan_year до отдельного manifest decision (новый отдельный sprint после 3B v2).
- Discovery `FLD-000082` (§6) — переносится в backlog задачи `package_plan_year_decision`.

## §A9 — Город приказа: deferred, если нет отдельной city-колонки

Discovery (read-only):

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='client_legal_details'
  AND (column_name ILIKE '%city%' OR column_name ILIKE '%locality%' OR column_name ILIKE '%settlement%');

SELECT public_id, key, label FROM fields_registry
WHERE source_table='client_legal_details'
  AND (key ILIKE '%city%' OR key ILIKE '%locality%' OR label ILIKE '%город%');
```

Решение:
- Если найдена отдельная city-колонка + FLD → reuse, фиксируем public_id в coverage matrix.
- Если city живёт только внутри full-address колонки → **deferred**, в этом sprint город приказа не закрывается, плейсхолдер остаётся `unresolved`. Auto-parse адреса regex/NER — запрещён.

## §A10 — Proof по отсутствию новых alias в активных шаблонах (DoD execution)

Перед включением `feature_flags.documents_package_resolver_enabled = true` (отдельным approve, не в этом sprint) обязателен regex-scan:

```sql
-- Проверка тел активных шаблонов на новые alias-token
SELECT id, name FROM document_templates
WHERE is_active = true
  AND (
    body ~ 'package\.role\.company_head\.full_name'
    OR body ~ 'package\.role\.responsible_person\.full_name'
    OR body ~ 'package\.role\.company_head\.position'
    OR body ~ 'package\.role\.responsible_person\.position'
  );
```

Правило:
- Ожидаемый результат: 0 строк.
- Если ≥1 строка — execution **stop**, шаблон содержит токен до того, как resolver гарантированно работает.
- Этот scan фиксируется в proof и выполняется **дважды**: до миграции и непосредственно перед flip feature flag.

---

## 7. Migration — порядок (обновлён с учётом §A)

1. §A2 discovery (alias-таблица) — read-only, фиксация в proof.
2. §A3 discovery (`entity_type`) — read-only, фиксация в proof.
3. §A6 proof (`next_fld_public_id` / max-PK путь) — фиксация в proof.
4. §A7 proof (`feature_flags`) — фиксация; решение использовать ли таблицу или hard-coded `false`.
5. §A9 discovery (city) — фиксация: reuse или deferred.
6. §A10 scan #1 (templates clean) — 0 rows.
7. Duplicate check `fields_registry` по `key='legal_details_persons.full_name'` + 4 alias_token.
8. `CREATE TABLE IF NOT EXISTS document_token_aliases` (если §A2 показал отсутствие) с CHECK из §A4 и GRANT/RLS из §A1.
9. INSERT 1 person FLD в `fields_registry` (§1.1, §A3, §A6).
10. INSERT строки в `document_token_registry` **только** для нового person FLD (template_scope `generic`). Для `package_metadata` aliases — **не INSERT-ить** в registry (§A4).
11. INSERT 4 alias-строк в `document_token_aliases`.
12. По §A7: INSERT в `feature_flags` если таблица существует; иначе skip (resolver рекомендуется с hard-coded `false`).

Plan_year — НЕ включается (§A8).

## 8. Rollback / disable

См. v2 §8 — без изменений. Default = soft-disable + feature flag `false`.

## 9. Proof package

Дополнения к v2 §9:
- Доказательство §A1 (no anon, RLS write-closed).
- Доказательство §A2 (нет аналога, либо найден аналог и переиспользован).
- Доказательство §A3 (выбран существующий `entity_type`).
- Доказательство §A4 (CHECK на consistency + package_metadata path).
- Доказательство §A5 (parser-proof отложен; alias = единственный путь).
- Доказательство §A6 (реальный механизм генерации public_id).
- Доказательство §A7 (feature_flags shape).
- Доказательство §A9 (city — reuse или deferred).
- §A10 scan #1 — 0 rows.

## 10. DoD (execution)

- [x] 9 amendments §A1–§A10 зафиксированы в этом документе.
- [ ] Все §A discovery выполнены read-only до миграции.
- [ ] §A10 scan #1 = 0 rows (до миграции).
- [ ] §A10 scan #2 = 0 rows (перед flip feature flag — в отдельном следующем sprint).
- [ ] Migration соответствует §7 (обновлённому).
- [ ] Billing diff = пуст; signature diff = пуст.
- [ ] Approval ревьюера на v2.1.
- [ ] Только после approval — фактический execution-запрос.

В рамках этого документа никакие INSERT / migration / deploy_edge_functions / UI-патчи не выполняются.
