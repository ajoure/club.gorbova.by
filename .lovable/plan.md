# да, согласен, с учетом правок:

1. **План стал намного ближе к правильной архитектуре**

Теперь логика правильная:

- не создаются отдельные FLD под `company_head.full_name` и `responsible_person.full_name`;
- создаётся **один canonical person FLD**:
  - `legal_details_persons.full_name`;
- роли в пакете реализуются через **alias**, а не через дублирование реквизитов;
- `position` берётся из `document_package_session_participants.metadata.position`;
- `plan_year` не создаётся;
- `canonical-document-generate-strict` не трогается;
- feature flag выключен;
- генерация не запускается.

Это уже соответствует твоей логике: **реквизиты одни, роли разные, пакет только выбирает, кого и в каком качестве использовать.**

---

## **Что нужно поправить перед approve**



### **1. Проверить, почему создается**

`legal_details_persons.full_name`

Перед созданием нового canonical person FLD нужно еще раз проверить: нет ли уже ФИО физлица под другим `entity_type`.

Добавить в pre-check:

```sql
SELECT id, public_id, key, label, entity_type
FROM fields_registry
WHERE archived_at IS NULL
  AND (
    key ILIKE '%full_name%'
    OR key ILIKE '%fio%'
    OR key ILIKE '%last_name%'
    OR key ILIKE '%first_name%'
    OR key ILIKE '%middle_name%'
    OR label ILIKE '%ФИО%'
    OR label ILIKE '%фамил%'
    OR label ILIKE '%имя%'
    OR label ILIKE '%отчеств%'
  );
```

Если уже есть FLD для ФИО физлица — **новый** `legal_details_persons.full_name` **не создавать**, а alias делать на existing FLD.

---

### **2. Уточнить entity_type для canonical person FLD**

Не фиксировать заранее `legal_details_persons`.

Правильно:

```md
entity_type выбирается по фактической модели registry.
Если уже существует entity_type='person' или 'entity_person' для физлиц — использовать существующий стандарт, а не создавать новый entity_type.
```

Иначе появится еще один новый тип, который потом будет мешать.

---

### **3. Alias-токены лучше назвать единообразно**

Сейчас:

```text
package.role.company_head.full_name
package.role.responsible_person.full_name
```

Лучше использовать множественное число, как в предыдущей модели:

```text
package.roles.company_head.full_name
package.roles.responsible_person.full_name
```

Чтобы не было двух стандартов `role` и `roles`.

Исправить все 4 alias:

```text
package.roles.company_head.full_name
package.roles.company_head.position
package.roles.responsible_person.full_name
package.roles.responsible_person.position
```

---

### **4. Alias-таблица должна быть service-role only**

В плане написано:

service_role only, no anon, RLS write-closed

Добавить:

```md
authenticated не должен иметь INSERT/UPDATE/DELETE в `document_token_aliases`.
SELECT для authenticated — только если picker реально должен читать alias. Если picker пока не подключается — authenticated SELECT не выдавать.
```

Так как сейчас UI не меняется, лучше:

```text
service_role ALL
anon — нет
authenticated — нет
```

---

### **5. Не создавать feature flag row, если feature flag infra непонятна**

Пункт нормальный, но нужно добавить:

```md
Если `feature_flags` существует, но используется в другом формате/схеме — не вставлять row автоматически. Сначала адаптировать к фактической структуре.
```

---

### **6. Resolver skeleton не должен импортироваться production-кодом**

Сейчас указано, что `canonical-document-generate-strict` не меняется, но при этом в плане есть “routing-точка” в `canonical-document-generate-strict`.

Это противоречие.

Нужно выбрать один вариант.

Для этого спринта лучше так:

```md
Sprint 3B v2.1 создаёт только:
- migration;
- alias registry;
- `resolve-package-tokens.ts` как отдельный неиспользуемый модуль.

`canonical-document-generate-strict` не изменяется вообще.
Routing-точка переносится в Sprint 3C после отдельного approve.
```

Иначе это уже изменение edge-function.

---

## **Исправленный ответ Lovable**

```md
да, согласен, с учетом правок:

1. Перед созданием `legal_details_persons.full_name` выполнить расширенный поиск existing person FLD по key/label/entity_type: ФИО, full_name, фамилия, имя, отчество. Если existing FLD найден — новый canonical person FLD не создавать, alias указывать на existing FLD.

2. Не фиксировать заранее `entity_type='legal_details_persons'`. Использовать фактический стандарт registry для физлиц (`person`, `entity_person`, `legal_details_persons` или иной существующий), подтвержденный discovery.

3. Alias keys привести к единому формату `package.roles.*`, не `package.role.*`:
   - `package.roles.company_head.full_name`
   - `package.roles.company_head.position`
   - `package.roles.responsible_person.full_name`
   - `package.roles.responsible_person.position`

4. `document_token_aliases` сделать service-role only. Не выдавать anon. Не выдавать authenticated SELECT/INSERT/UPDATE/DELETE, пока picker не подключается к alias-таблице.

5. Feature flag row создавать только если `feature_flags` существует и схема соответствует ожидаемой. Если формат другой — не вставлять, оставить hard-coded disabled и вынести flag integration отдельно.

6. В Sprint 3B v2.1 не менять `canonical-document-generate-strict` вообще. Routing-точка переносится в отдельный Sprint 3C после approve. Сейчас можно создать только отдельный resolver skeleton `resolve-package-tokens.ts`, который не импортируется production-кодом.

7. В proof добавить:
   - expanded person FLD search result;
   - выбранный entity_type для person FLD;
   - подтверждение, что `canonical-document-generate-strict/index.ts` git diff = empty;
   - подтверждение, что resolver skeleton нигде не импортируется production-кодом.

После этих правок можно approve Sprint 3B v2.1 execution.
```

## **Итог**

План можно утверждать **только после этих правок**.

Главное изменение: **не трогать** `canonical-document-generate-strict` **в Sprint 3B v2.1**. Сейчас достаточно создать безопасную основу: canonical person FLD/alias/resolver skeleton. Routing и реальное подключение — отдельный следующий шаг.

&nbsp;

План: Sprint 3B v2.1 execution

Выполнение строго по утвержденному v2.1 (`.lovable/proofs/package_documents_sprint3b_v2_execution_plan_2026_05.md`).

## Этап 1 — Pre-migration read-only checks (proof обязателен)

1. **Duplicate check canonical person FLD**
  ```sql
   SELECT id, public_id, key, entity_type
   FROM fields_registry
   WHERE key = 'legal_details_persons.full_name';
  ```
   Ожидается 0 строк. Если ≥1 — execution стоп, переходим к reuse.
2. **Alias-механизм discovery (§A2)**
  - Проверить наличие таблиц: `document_token_aliases`, `document_alias`, `token_alias`.
  - Проверить колонки `document_token_registry`: `alias_for`, `aliased_field_id`, `role_key`, `context_kind`.
  - Если найден existing alias-слой → адаптер поверх него, без новой таблицы.
  - Если ничего нет → создать `public.document_token_aliases` по §A1/§A4.
3. **Feature flag storage discovery (§A7)**
  ```sql
   SELECT to_regclass('public.feature_flags');
  ```
  - Если есть — INSERT `documents_package_resolver_enabled=false`.
  - Если нет — hard-coded `false` в resolver, отдельный sprint для flag-инфраструктуры.
4. **FLD public_id generator discovery (§A6)**
  ```sql
   SELECT proname FROM pg_proc WHERE proname = 'next_fld_public_id';
  ```
  - Есть → использовать.
  - Нет → `SELECT 'FLD-' || lpad((max(...)+1)::text, 6, '0')` под `pg_advisory_xact_lock`.
5. **entity_type discovery (§A3)** — `SELECT DISTINCT entity_type FROM fields_registry` для выбора корректного значения для person FLD.
6. **Template regex-scan #1 (§A10)** — 0 active templates содержат `package.role.*` токены. При >0 → стоп.

## Этап 2 — Migration (single BEGIN/COMMIT)

Порядок строго:

1. (Условно) `CREATE TABLE public.document_token_aliases` с GRANT (service_role only, no anon, RLS write-closed) + CHECK по §A4.
2. INSERT 1 canonical person FLD:
  - `key='legal_details_persons.full_name'`
  - `entity_type=<из §A3 discovery>`
  - `template_scope='generic'`
  - `data_type='string'`
  - `public_id` через generator из §A6
3. INSERT 4 alias rows:
  - `package.role.company_head.full_name` → person FLD + `role_key='company_head'`, `context_kind='package_person'`
  - `package.role.responsible_person.full_name` → person FLD + `role_key='responsible_person'`, `context_kind='package_person'`
  - `package.role.company_head.position` → `source_field_public_id=NULL`, `context_kind='package_metadata'`, source=`document_package_session_participants.metadata->>'position'`
  - `package.role.responsible_person.position` → аналогично
4. (Условно) INSERT `feature_flags(documents_package_resolver_enabled, enabled=false)`.

**Не создаётся:** `plan_year` FLD, role-specific full_name FLD, anon grants, billing-токены.

## Этап 3 — Resolver skeleton

Создать `supabase/functions/_shared/resolve-package-tokens.ts`:

- Lookup alias по `alias_token`.
- Если `context_kind='package_person'` → читать `document_package_session_participants` по `role_key` → `legal_details_persons.full_name`. Поддержка `|case=` через существующий `_shared/case-format.ts`.
- Если `context_kind='package_metadata'` → читать `participants.metadata->>field`.
- Default-deny: нет alias / нет участника / нет session → `{ resolved: false, warning: '...' }`.
- Никаких fallback на `legal_details_entity_person_links`.
- Никаких изменений billing resolver или signature `canonical-document-generate-strict`.
- Resolver НЕ вызывается production-кодом (flag=false). Только модульное добавление.

## Этап 4 — Template regex-scan #2 (§A10)

Повторный scan активных шаблонов: 0 совпадений с новыми alias-токенами. Это финальная проверка перед закрытием sprint (flag всё равно остаётся false).

## Этап 5 — Proof artifact

Создать `.lovable/proofs/package_documents_sprint3b_v2_1_execution_report_2026_05.md`:

- Pre-check results (duplicate, alias discovery, flag discovery, generator discovery, entity_type, scan #1).
- Migration SQL (точный текст).
- Созданный person FLD public_id.
- Alias list (4 строки).
- Resolver diff (новый файл, ноль изменений в существующих edge functions).
- **Billing regression proof:** diff `document_token_registry WHERE token_key LIKE 'cf.legal_details.%' OR 'customer.%' OR 'executor.%'` до/после = идентичен; billing resolver не тронут.
- **Signature unchanged proof:** `canonical-document-generate-strict/index.ts` не модифицирован (git diff пустой по этому файлу).
- **No generation proof:** 0 вызовов resolver из production; flag=false; scan #2 = 0.
- **Rollback/soft-disable proof:** `UPDATE fields_registry SET archived_at=now() WHERE public_id=<новый>` + `UPDATE document_token_aliases SET archived_at=now()` + `UPDATE feature_flags SET enabled=false` — dry-run SQL зафиксирован.

## Этап 6 — Финализация

Обновить `.lovable/plan.md`:

```
Sprint 3B v2.1: completed: package person FLD + role aliases + resolver skeleton added; feature flag disabled; generation deferred
```

## Ограничения (жёсткие)

- ❌ `plan_year` FLD не создавать.
- ❌ Role-specific FLD для ФИО/должностей не создавать.
- ❌ Anon grants на alias/token registry не выдавать.
- ❌ Billing/customer/executor resolver не менять.
- ❌ Signature `canonical-document-generate-strict` не менять.
- ❌ Feature flag не включать.
- ❌ Генерацию документов не запускать.
- ❌ Templates не модифицировать.

## DoD

- Pre-checks выполнены, proof зафиксирован.
- Migration применена (1 FLD + 4 aliases + optionally table + optionally flag row).
- Resolver skeleton создан, не вызывается production-кодом.
- Scan #2 = 0.
- Все 8 proof-секций в отчёте.
- `.lovable/plan.md` обновлён финальным статусом.