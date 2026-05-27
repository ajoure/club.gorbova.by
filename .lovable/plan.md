# да, согласен, с учетом правок:

1. **План в целом правильный**
  &nbsp;
  Сейчас архитектура уже выглядит корректно:
  - `legal_details_persons.full_name` и `legal_details_persons.position` создаются как **canonical FLD для справочника физлиц**, а не как role-specific токены.
  - Роли реализуются через alias:
    - `package.roles.company_head.full_name`
    - `package.roles.responsible_person.full_name`
  - `document_token_aliases` не трогается.
  - Создается отдельная `document_package_token_aliases`.
  - `canonical-document-generate-strict` не меняется.
  - Resolver skeleton не импортируется production-кодом.
  - Генерация не запускается.
2. **Исправить** `position` **alias consistency**
  &nbsp;
  В таблице `document_package_token_aliases` для `context_kind='package_metadata'` сейчас указано:
  ```text
  canonical_field_public_id = <новый FLD position>
  source_path = metadata->>position
  ```
  Но CHECK выше говорит:
  ```sql
  context_kind='package_metadata' AND source_path IS NOT NULL
  ```
  и не требует `canonical_field_public_id`.
  Нужно явно решить:
  ```md
  Для `package_metadata` alias `canonical_field_public_id` может быть NOT NULL, если он используется как type/label field definition.
  CHECK должен разрешать:
  context_kind='package_metadata' AND canonical_field_public_id IS NOT NULL AND source_path IS NOT NULL
  ```
  Иначе миграция может конфликтовать с собственным CHECK.
3. **Добавить** `source_field_key` **или** `source_json_path` **точнее**
  &nbsp;
  `source_path='metadata->>position'` лучше хранить явно:
  ```text
  source_path = document_package_session_participants.metadata.position
  ```
  или
  ```json
  metadata: {
    "source_table": "document_package_session_participants",
    "source_json_path": "metadata.position"
  }
  ```
  Чтобы resolver не парсил произвольную строку.
4. **Добавить UNIQUE не только на** `alias_token`**, но и на активные aliases**
  &nbsp;
  Если есть `archived_at`, лучше сделать partial unique:
  ```sql
  UNIQUE(alias_token) WHERE archived_at IS NULL
  ```
  Если PostgreSQL не позволяет inline partial unique — создать отдельный unique index:
  ```sql
  CREATE UNIQUE INDEX document_package_token_aliases_alias_token_active_uidx
  ON public.document_package_token_aliases(alias_token)
  WHERE archived_at IS NULL;
  ```
  Так можно будет архивировать старый alias и создать новый.
5. **Добавить CHECK role_key для package_person/package_metadata**
  &nbsp;
  Сейчас `role_key text NOT NULL` для всех. Это нормально. Но добавить проверку:
6. **Добавить** `updated_at` **trigger или явно не добавлять**
  &nbsp;
  Если в проекте есть стандартный trigger `set_updated_at`, подключить. Если нет — в proof указать, что `updated_at` пока техническое поле без trigger и будет обновляться вручную/service-role.
7. **Feature flag не нужен, если production-код не импортирует resolver**
  &nbsp;
  Так как `canonical-document-generate-strict` не меняется и resolver не импортируется, feature flag фактически не используется.
  Лучше оставить так:
8. **Memory не обязательно создавать через mem://, если такого механизма нет**
  &nbsp;
  Добавить:
9. **Добавить final STOP перед resolver skeleton**
  &nbsp;
  Перед созданием `resolve-package-tokens.ts` проверить:
10. **В proof добавить отдельную строку: это не подключение генерации**

```md
В Sprint 3B v2.1 создана только инфраструктура alias + skeleton. Ни один шаблон не может начать использовать эти токены автоматически.
```

После этих правок можно approve execution. Финальная формула:

```text
Approve Sprint 3B v2.1 execution с правками: R1.B + R2.A, canonical-document-generate-strict не трогать, resolver не импортировать, генерацию не запускать.

План: Sprint 3B v2.1 execution — продолжение после R1.B + R2.A
```

Approve по обеим развилкам зафиксирован. Продолжаю execution в рамках жёстких ограничений.

## Этап 1 — Оставшиеся pre-checks (read-only)

1. `SELECT to_regclass('public.feature_flags')` — определить наличие.
2. `SELECT proname FROM pg_proc WHERE proname ILIKE '%fld_public%' OR proname ILIKE '%next_fld%'` — генератор `FLD-XXXXXX`.
3. Regex-scan активных `document_templates` на `package.roles.*` токены — должен вернуть 0.
4. Duplicate check по новым FLD keys: `legal_details_persons.full_name`, `legal_details_persons.position` — должен вернуть 0.

Результаты — в proof artifact.

## Этап 2 — Migration (single BEGIN/COMMIT)

Создаётся ровно:

### 2.1. Новая таблица `public.document_package_token_aliases`

```
id                          uuid PK default gen_random_uuid()
alias_token                 text NOT NULL UNIQUE
canonical_field_public_id   text NULL  -- NULL только для context_kind='package_metadata'
role_key                    text NOT NULL
context_kind                text NOT NULL CHECK (context_kind IN ('package_person','package_metadata'))
source_path                 text NULL  -- jsonpath/column для package_metadata
metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb
archived_at                 timestamptz NULL
created_at                  timestamptz NOT NULL DEFAULT now()
updated_at                  timestamptz NOT NULL DEFAULT now()

CHECK: (context_kind='package_person' AND canonical_field_public_id IS NOT NULL AND source_path IS NULL)
    OR (context_kind='package_metadata' AND source_path IS NOT NULL)

FK: canonical_field_public_id → fields_registry(public_id)  -- field-id-first canon
```

GRANTS:

- `GRANT ALL ON public.document_package_token_aliases TO service_role`
- **НЕТ** grant для `anon`, **НЕТ** для `authenticated`

RLS:

- `ENABLE ROW LEVEL SECURITY`
- Без CREATE POLICY → default-deny (только service_role bypass).

### 2.2. INSERT 2 новых canonical FLD в `fields_registry`

`public_id` берётся из найденного генератора (Этап 1.2) или fallback `'FLD-' || lpad((max+1)::text, 6, '0')` под advisory-lock в той же транзакции.


| key                               | label                          | entity_type | data_type |
| --------------------------------- | ------------------------------ | ----------- | --------- |
| `legal_details_persons.full_name` | ФИО физлица (справочник)       | `person`    | `string`  |
| `legal_details_persons.position`  | Должность физлица (справочник) | `person`    | `string`  |


`entity_type='person'` — существующее значение (проверено в discovery).

### 2.3. INSERT 4 alias rows в `document_package_token_aliases`


| alias_token                                  | canonical_field_public_id | role_key             | context_kind       | source_path           |
| -------------------------------------------- | ------------------------- | -------------------- | ------------------ | --------------------- |
| `package.roles.company_head.full_name`       | `<новый FLD full_name>`   | `company_head`       | `package_person`   | NULL                  |
| `package.roles.company_head.position`        | `<новый FLD position>`    | `company_head`       | `package_metadata` | `metadata->>position` |
| `package.roles.responsible_person.full_name` | `<новый FLD full_name>`   | `responsible_person` | `package_person`   | NULL                  |
| `package.roles.responsible_person.position`  | `<новый FLD position>`    | `responsible_person` | `package_metadata` | `metadata->>position` |


Для `position` aliases canonical_field_public_id указывает на новый FLD position (для label/data_type метаданных), фактическое значение читается из `source_path` в resolver.

### 2.4. Feature flag (условно)

Только если `feature_flags` существует и схема (key/enabled) подходит — INSERT `documents_package_resolver_enabled=false`. Иначе hard-coded `false` в resolver.

### НЕ создаётся / НЕ меняется

- `plan_year` FLD.
- Role-specific full_name FLD.
- Existing `document_token_aliases` (никаких ALTER).
- Anon/authenticated grants.
- Billing/customer/executor токены в `document_token_registry`.
- `canonical-document-generate-strict` (никаких правок).

## Этап 3 — Resolver skeleton (изолированный)

Создать `supabase/functions/_shared/resolve-package-tokens.ts`:

- Lookup в `document_package_token_aliases` по `alias_token`.
- `context_kind='package_person'`:
→ `document_package_session_participants` по `(package_session_id, role_key)`
→ `person_id` → `legal_details_persons.full_name`
→ поддержка `|case=` через `_shared/case-format.ts`.
- `context_kind='package_metadata'`:
→ `document_package_session_participants.metadata->>field` по `source_path`.
- Default-deny: alias не найден / participant не найден / session NULL → `{ resolved: false, warning: '...' }`.
- **Запрещено**: fallback на `legal_details_entity_person_links`; чтение из legacy `document_token_aliases`; вызов billing resolver.

**Файл не импортируется production-кодом.** `canonical-document-generate-strict` остаётся без изменений (routing-точка переносится в Sprint 3C).

## Этап 4 — Verify

1. Повторный regex-scan templates на `package.roles.*` = 0.
2. `git diff supabase/functions/canonical-document-generate-strict/` = пустой.
3. `grep -r "resolve-package-tokens" supabase/functions/ --exclude-dir=_shared` = 0 импортов из production.
4. Diff `document_token_registry WHERE token_key LIKE 'cf.legal_details.%' OR 'customer.%' OR 'executor.%'` до/после миграции = идентичен.

## Этап 5 — Proof artifact

Создать `.lovable/proofs/package_documents_sprint3b_v2_1_execution_report_2026_05.md` с секциями:

1. Pre-checks результаты (1.1–1.4).
2. **Обоснование R1.B**: почему `FLD-000020` (другой источник `client_legal_details.ind_full_name`) и `FLD-000064` (другая семантика — связь person↔entity) не подходят; новые FLD = field definitions над `legal_details_persons`, не дублирование.
3. **Обоснование R2.A**: почему legacy `document_token_aliases` несовместима (FK на deprecated `document_token_registry.token_key`, отсутствие role_key/context_kind/archived_at, template-scoping); новая таблица соответствует field-id-first canon.
4. Migration SQL (точный текст).
5. Созданные FLD public_ids (2 шт).
6. Alias list (4 строки).
7. Resolver diff (один новый файл, 0 правок existing edge functions).
8. **Billing regression proof** (diff identical).
9. **Signature unchanged proof** (`canonical-document-generate-strict/index.ts` не тронут).
10. **No generation proof** (flag=false / hard-coded false; 0 production imports; scan=0).
11. **Rollback/soft-disable dry-run**:
  - `UPDATE fields_registry SET archived_at=now() WHERE public_id IN (...)`
    - `UPDATE document_package_token_aliases SET archived_at=now()`
    - (если применимо) `UPDATE feature_flags SET enabled=false`.

## Этап 6 — Финализация

- Обновить `.lovable/plan.md`:
  ```
  Sprint 3B v2.1: completed: package person FLD + role aliases + resolver skeleton added; feature flag disabled; generation deferred
  ```
- Сохранить memory `mem://architecture/documents/package-token-aliases-v1` (одна короткая запись: новая таблица `document_package_token_aliases` — single canonical alias-слой для package-резолвера, FK на `fields_registry.public_id`, не путать с legacy `document_token_aliases`).
- Обновить `mem://index.md` (одна строка-ссылка).

## Жёсткие ограничения

- ❌ Не трогать `document_token_aliases`.
- ❌ Не давать anon/authenticated доступ к новой таблице.
- ❌ Не менять billing/customer/executor resolver и `canonical-document-generate-strict`.
- ❌ Не включать feature flag.
- ❌ Не запускать генерацию документов.
- ❌ Не создавать `plan_year` FLD.
- ❌ Не модифицировать templates.

## DoD

- Pre-checks выполнены и в proof.
- Migration применена (1 таблица + 2 FLD + 4 aliases [+ optional flag row]).
- Resolver skeleton создан, не импортируется production-кодом.
- Все 11 proof-секций заполнены.
- `.lovable/plan.md` финализирован.
- Memory добавлен.