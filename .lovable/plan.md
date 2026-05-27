да, согласен, с учетом правок:

1. **document_token_aliases не выдавать anon**  
В плане сейчас:  
GRANT SELECT ON public.document_token_aliases TO anon, authenticated;
2. CREATE POLICY "aliases readable to all" ... USING (true);  
Заменить на:`document_token_aliases` не получает anon-доступ.
3. SELECT — только authenticated / service*_role.*
4. *Admin/service write — только service_*role/admin.  
Это служебный registry. Публичный anon-доступ здесь не нужен.
5. **Не создавать document_token_aliases, если уже есть аналог**  
Перед CREATE TABLE IF NOT EXISTS добавить обязательный discovery:
6. **Entity type для нового person FLD не выбирать произвольно**  
Сейчас написано:  
person или legal_details_person — уточнить по конвенции  
Лучше жестче:
7. **Не разрешать прямой синтаксис {{field:FLD-PERSON-FULL-NAME|role=...}} без parser-proof**  
Оставить alias-wrapper как основной путь.  
Прямой |role= — только после отдельного proof, что parser/render поддерживает новый модификатор без регрессии.
8. **Alias для должности без source_field_public_id допустим, но это не “token alias”, а metadata-token**  
Для:  
[package.role.company](http://package.role.company)_head.position
9. package.role.responsible_person.position  
уточнить:
10. **feature_flags не создавать вслепую**  
Добавить:
11. **next_fld_public_id() проверить до миграции**  
В плане написан псевдовызов:  
next_fld_public_id()  
Добавить:
12. **Город приказа — deferred, если нет отдельного city field**  
Уточнить:
13. **Plan year в Sprint 3B не включать без отдельного решения**  
В execution plan оставить только:
14. **Proof по отсутствию новых токенов в активных шаблонах**

Добавить в DoD execution:

До включения feature flag ни один активный шаблон не содержит новых alias-token.

Если содержит — execution стоп.

**Итог**

План можно одобрять **только как execution-plan**, но перед фактическим execution нужно внести эти правки.

Ключевое: да, теперь направление правильное — **1 canonical person FLD + alias-wrapper roles + metadata.position**, без создания отдельных FLD под каждую роль.

&nbsp;

Все плейсэолдеры должны быть только через их id  никаких slug имен быть не должно  

&nbsp;

# Sprint 3B v2 — Execution Plan (awaiting separate approve)

Статус: `planned, awaiting_execution_approve`. Никаких INSERT / migration / edge / UI изменений до отдельного approve.

## 0. Инварианты (наследуются из 3A closure + 3A.1)

- Reuse-first. Existing `legal_details` FLD (47) — единственный source для requisite-полей.
- Default-deny: без `package_session_id` / без явного `role_key` → `unresolved` warning. Никакого silent fallback (включая `legal_details_entity_person_links`).
- Billing / customer / executor resolver и `canonical-document-generate-strict` signature — **без изменений**.
- Alias-wrapper НЕ имеет собственного source: только ссылка на canonical source FLD + `role_key`.
- Auto-fill plan_year из текущей даты — запрещён.
- Hard DELETE запрещён; rollback = soft-disable через `archived_at` + feature flag.

## 1. FLD-дельта (max 1, possibly +1)

### 1.1 Canonical person FLD — `FLD-PERSON-FULL-NAME` (создаём, generic)


| Поле             | Значение                                                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`            | `legal_details_persons.full_name`                                                                                                                                                |
| `label`          | ФИО физлица (legal_details_persons)                                                                                                                                              |
| `entity_type`    | `person` (или `legal_details_person` — уточнить по существующей конвенции `fields_registry` в момент миграции; **выбрать тот, что уже используется проектом**, не вводить новый) |
| `data_type`      | `string`                                                                                                                                                                         |
| `category`       | `person`                                                                                                                                                                         |
| `source_table`   | `legal_details_persons`                                                                                                                                                          |
| `source_column`  | `full_name`                                                                                                                                                                      |
| `template_scope` | `generic` (не `package`, не `billing`)                                                                                                                                           |
| `archived_at`    | `NULL`                                                                                                                                                                           |
| `is_alias`       | `false`                                                                                                                                                                          |


Назначение: единый canonical FLD ФИО физлица. Без привязки к идеологии, без role binding.

### 1.2 Plan year — отложено в §6, не создаётся в этом sprint без явного выбора варианта.

### 1.3 Role-specific FLD ФИО / должности — **НЕ создаются** (явный запрет из user message).

## 2. Alias-wrappers (создаются в `document_token_aliases` или эквивалент; **не** в `fields_registry`)

Перед миграцией: discovery — существует ли таблица `document_token_aliases`. Если нет — создаётся в этой же миграции с минимальной схемой:

```sql
CREATE TABLE IF NOT EXISTS public.document_token_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias_token text NOT NULL UNIQUE,
  source_field_public_id text NOT NULL,  -- FK-логика на fields_registry.public_id
  role_key text NULL,                    -- например 'company_head' | 'responsible_person'
  context_kind text NOT NULL,            -- 'package_role' | 'package_metadata' | ...
  notes text NULL,
  archived_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.document_token_aliases TO anon, authenticated;
GRANT ALL ON public.document_token_aliases TO service_role;
ALTER TABLE public.document_token_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aliases readable to all" ON public.document_token_aliases FOR SELECT USING (true);
-- write — только service_role (никаких user-policies).
```

Aliases (INSERT в той же миграции):


| alias_token                                 | source_field_public_id                 | role_key             | context_kind       |
| ------------------------------------------- | -------------------------------------- | -------------------- | ------------------ |
| `package.role.company_head.full_name`       | `FLD-PERSON-FULL-NAME`                 | `company_head`       | `package_role`     |
| `package.role.responsible_person.full_name` | `FLD-PERSON-FULL-NAME`                 | `responsible_person` | `package_role`     |
| `package.role.company_head.position`        | *(нет source FLD — alias на metadata)* | `company_head`       | `package_metadata` |
| `package.role.responsible_person.position`  | *(нет source FLD — alias на metadata)* | `responsible_person` | `package_metadata` |


Для `position` `source_field_public_id` остаётся NULL, resolver читает `document_package_session_participants.metadata->>'position'` по `role_key`. Проверка `|case=` для строки должности — §5.

Шаблоны могут использовать либо alias, либо `{{field:FLD-PERSON-FULL-NAME|role=company_head|case=nom}}` напрямую — после A/B решения по поддержке `|role=` модификатора (§5).

## 3. Resolver — `_shared/resolve-package-tokens.ts` (новый модуль)

Контракт:

```ts
resolvePackageTokens(ctx: {
  package_session_id: string;
  token: { kind: 'field'|'alias', field_public_id?: string, alias_token?: string, role_key?: string, case?: string }
}): { resolved: boolean, value?: string, warning?: string, source_trace: {...} }
```

Резолвинг alias:

1. Lookup в `document_token_aliases` по `alias_token`, `archived_at IS NULL`.
2. Если `source_field_public_id` задан → читаем `fields_registry` → `legal_details_persons.full_name` по `person_id`, выбранному через `document_package_session_participants` (filter `role_key`, `package_session_id`). Несколько матчей → error `multiple_participants_for_role:<role_key>`.
3. Если `source_field_public_id` IS NULL и `context_kind='package_metadata'` → читаем `document_package_session_participants.metadata->>'position'` по `role_key`.
4. Применяем `|case=` если задано и тип строки поддерживает (§5).
5. On miss → `{ resolved:false, warning:'package_role_unassigned:<role_key>' | 'package_role_metadata_missing:<role_key>.<field>' }`. **Никаких** fallback на `legal_details_entity_person_links`.

Routing-точка в `canonical-document-generate-strict`:

```ts
if (token.startsWith('package.') || token is alias in document_token_aliases) {
  return resolvePackageTokens(ctx);
}
// billing-path без изменений
```

Гейтинг: `feature_flags.documents_package_resolver_enabled` (default `false`). При `false` → resolver возвращает `unresolved` с warning `package_resolver_disabled`; billing path не затрагивается.

## 4. Покрытие первого приказа (фиксируется до execution)


| Поле приказа                         | Источник                                                                                                                           | Действие                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Наименование организации, УНП, адрес | existing `legal_details.*` (47 FLD)                                                                                                | reuse, без изменений                    |
| Город                                | existing legal_details city/address FLD — подтвердить наличие; если только внутри full address → **deferred decision**, не парсить | discovery в Sprint 3B execution prelude |
| Дата приказа                         | existing document/system FLD (`FLD-000069/070` подтверждены generic в 3A.1)                                                        | reuse                                   |
| Номер приказа                        | existing document/system FLD                                                                                                       | reuse                                   |
| ФИО руководителя                     | alias `package.role.company_head.full_name` → `FLD-PERSON-FULL-NAME`                                                               | new alias                               |
| Должность руководителя               | alias `package.role.company_head.position` → metadata                                                                              | new alias, без source FLD               |
| ФИО ответственного                   | alias `package.role.responsible_person.full_name` → `FLD-PERSON-FULL-NAME`                                                         | new alias                               |
| Должность ответственного             | alias `package.role.responsible_person.position` → metadata                                                                        | new alias, без source FLD               |
| Плановый год                         | см. §6                                                                                                                             | **deferred until §6 decision**          |


Если city не закрыт existing FLD как чистое поле — выносится отдельным manifest decision, в этом sprint не создаётся.

## 5. `|case=` модификатор — A/B проверка перед execution

Discovery (read-only, до миграции):

- `_shared/case-format.ts` — какие input типы поддерживает (только канонические ФИО vs произвольная строка).
- Применимо ли к произвольной строке должности из metadata.

Решение:

- **A.** Если `|case=` работает на canonical person FLD + role-context → шаблон может использовать `{{field:FLD-PERSON-FULL-NAME|role=responsible_person|case=gen}}` напрямую, alias становится опциональным синтаксическим сахаром.
- **B.** Если `|role=` модификатор не поддержан render-движком → используем alias-wrappers как основной путь, `|case=` применяется resolver-ом после lookup.
- Для строки должности: если `|case=` некорректен на произвольной строке → склонение должности **не поддерживается** в этом sprint, фиксируется в proof.

Изменения в render-движке в этом sprint **запрещены**. Если ни A, ни B полностью не покрывает шаблон — escalate, не создавать новые FLD.

## 6. Plan year — отдельная микро-discovery + выбор варианта (до миграции)

Discovery:

- `SELECT public_id, key, label, entity_type, category FROM fields_registry WHERE public_id='FLD-000082'` — действительно ли semantically generic (`report_year`) или meeting-specific (`meeting.report_year`).
- Поиск любых других существующих year-FLD (`current_year`, `next_year`, `report_year`, `plan_year`).

Варианты решения (фиксируется в proof, выбор — отдельным approve):

- **A.** Reuse `FLD-000082` — если `entity_type`/`category` допускают generic использование. Без новых FLD. Alias `package.context.plan_year` опционально.
- **B.** Создать один generic context FLD `package_session.metadata.plan_year` (source: `document_package_sessions.metadata->>'plan_year'`, data_type `number`). Только если A невозможен.
- **C.** Deferred — резолвер возвращает `unresolved` с warning `package_context_plan_year_missing`, шаблон рендерит плейсхолдер до отдельного approve.

Auto-fill из текущей даты — **запрещён во всех вариантах**.

## 7. Migration — структура (один `BEGIN; ... COMMIT;`)

Порядок:

1. Duplicate check (raise notice если найдено): `fields_registry` по `key='legal_details_persons.full_name'`; `document_token_aliases` по 4 alias_token. Если ненулевые — миграция abort.
2. `CREATE TABLE IF NOT EXISTS document_token_aliases` (если отсутствует) + GRANT + RLS + policy (см. §2).
3. INSERT 1 FLD в `fields_registry` (§1.1), public_id выделяется existing generator.
4. INSERT в `document_token_registry` для нового FLD (template_scope `generic`, source_module = canonical person resolver).
5. INSERT 4 alias-строк в `document_token_aliases`.
6. `INSERT INTO feature_flags(key, enabled) VALUES ('documents_package_resolver_enabled', false) ON CONFLICT DO NOTHING`.
7. По §6: либо ничего (вариант A/C), либо +1 FLD для plan_year (вариант B) — только после явного выбора варианта.

Никаких изменений в billing-резолвере, никаких UPDATE по существующим 47 `legal_details` FLD, никаких изменений в `document_token_registry` для billing-токенов.

## 8. Rollback / disable

- Default = soft-disable: `archived_at = now()` для новых FLD и aliases; `feature_flags.documents_package_resolver_enabled = false`.
- После soft-disable resolver новых alias-токенов возвращает `unresolved`; billing полностью не затронут.
- Hard DELETE — только отдельным approve и только при 0 использований во всех таблицах: `document_templates`, `document_template_versions.tokens`, `token_manifest_snapshot`, `source_trace`, `ai_generated_documents`.

## 9. Proof package (готовится одновременно с execution-патчем)

1. Duplicate check before — SQL + 0 rows.
2. Discovery `|case=` capability (§5) — выбор A/B зафиксирован.
3. Discovery plan_year (§6) — выбор A/B/C зафиксирован.
4. Discovery city FLD (§4) — reuse или deferred зафиксирован.
5. Migration SQL — финальный текст.
6. Resolver diff — только новый файл `_shared/resolve-package-tokens.ts` + минимальная routing-точка в `canonical-document-generate-strict` (≤ ~10 строк).
7. Billing regression proof: diff `document_token_registry WHERE token_key LIKE 'cf.legal_details.%' OR LIKE 'customer.%' OR LIKE 'executor.%'` до/после — идентичен.
8. Signature unchanged proof: request/response edge-функции, `idempotency_key`, `snapshot`, `source_trace`, `template_version_id` — diff пуст.
9. No generation proof: ни один активный `document_templates` не содержит новых alias/токенов до явного включения; regex-scan.
10. Feature flag default `false` — подтверждено INSERT-ом.

## 10. DoD (только plan, не execution)

- 1 canonical generic person FLD зафиксирован (§1.1), без role-specific FLD.
- 4 alias-wrapper зафиксированы (§2), без собственного source.
- Должность — только из participants.metadata.position, без отдельных FLD (§2, §5).
- Номер/дата приказа — reuse existing document FLD (§4).
- Город — reuse или deferred, без auto-parse (§4).
- Plan year — отдельная A/B/C discovery, без auto-fill (§6).
- Запрет fallback на `legal_details_entity_person_links` зафиксирован (§0, §3).
- Resolver — отдельный модуль, минимальная routing-точка (§3).
- Feature flag default `false`, soft-disable default rollback (§7, §8).
- Билинг и signature не меняются (§0, §9.7, §9.8).
- Approval ревьюера на plan v2.
- Только после approval: отдельный execution-запрос (миграция + edge-патч + proof).

В рамках этого документа не выполняются INSERT, migration, deploy_edge_functions, UI-патчи.