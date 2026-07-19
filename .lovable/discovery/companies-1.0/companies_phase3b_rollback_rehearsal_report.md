# Отчет о выполнении: CRM Companies — Phase 3B Rollback-only Identity Rehearsal (BLOCKER)

**Версия:** 1.0
**Статус:** **BLOCKER** — rehearsal остановлен на шаге §2 (execution identity gate). Никаких DML не выполнялось. Никаких COMMIT. Никаких DDL, миграций, RPC, UI, queue. Состояние БД не изменено.
**Основано на плане:** `companies_phase3_backfill_plan.md` v1.2 и `companies_phase3_backfill_discovery.md` v1.2.
**Managed executor:** психологическая роль сессии — `sandbox_exec` (см. §2.1).

---

## 1. Preflight (read-only) — PASS

Все проверки выполнены `SELECT`-ами, без транзакции с записью.

### 1.1 Baseline canonical

| Проверка | Ожидание | Факт | Итог |
|---|---|---|---|
| `public.companies` count | 0 | 0 | PASS |
| `public.client_legal_details_company_map` count | 0 | 0 | PASS |
| `public.company_contacts` (`relationship_type='billing_contact'` AND `is_billing_contact=true`) count | 0 | 0 | PASS |
| `public.public_id_sequences` where `entity_type='company'` → `last_value` | 0 | 0 | PASS |

`public_id_sequences` schema подтверждена: `(entity_type text PK, prefix text, last_value bigint)`. Для `client_legal_details_company_map` собственной sequence нет (`id UUID`), что соответствует discovery v1.2 §5.

### 1.2 CLD inventory

Применён eligibility-фильтр discovery v1.2:
`client_type IN ('entrepreneur','legal_entity') AND purpose='billing' AND status='active' AND COALESCE(NULLIF(ent_unp,''), NULLIF(leg_unp,'')) ~ '^[0-9]{9}$'`.

| Метрика | Ожидание (discovery v1.2) | Факт | Итог |
|---|---|---|---|
| Всего CLD | 48 | 48 | PASS |
| Eligible | 17 | 17 | PASS |
| Unique UNP | 16 | 16 | PASS |
| `legal_entity` | 7 | 7 | PASS |
| `entrepreneur` | 10 | 10 | PASS |

### 1.3 Ambiguities

| Класс | Ожидание | Факт | Итог |
|---|---|---|---|
| SOFT-FLAG: один UNP на нескольких profiles | `193405000` → 2 profiles | `193405000` → 2 profiles | PASS |
| Штатный сценарий: profile с несколькими UNP | 1 профиль с 2 UNP | 1 профиль (`a4b7c8c9-…`) с 2 UNP | PASS |
| Иных ambiguities | нет | нет | PASS |

Диагностика (без фильтра `purpose/status`) показала более широкую картину (25 eligible / 24 unique / 2 profile с 2 UNP), но она **не** конфликтует с discovery: discovery определяет eligibility именно как billing+active, и в этом пространстве метрики точно совпадают.

### 1.4 Function / ACL signatures (Phase 2 контракт)

| Функция | Аргументы | Security | Грантованные EXECUTE-роли |
|---|---|---|---|
| `public.crm_company_upsert_from_billing` | `_client_legal_details_id uuid` | DEFINER | `postgres`, `service_role`, `sandbox_exec*` |
| `public.crm_company_link_contact` | `_company_id uuid, _profile_id uuid, _relationship_type text, _is_billing_contact boolean, _source text, _source_client_legal_details_map_id uuid` | DEFINER | `postgres`, `authenticated`, `sandbox_exec*` |
| `public.has_role_v2` | `_user_id uuid, _role_code text` | DEFINER | `postgres`, `authenticated`, `service_role`, `sandbox_exec*` |
| `public.has_role` | `_user_id uuid, _role app_role` | DEFINER | `postgres`, `authenticated`, `service_role`, `sandbox_exec*` |

### 1.5 RLS матрица (canonical)

- `client_legal_details_company_map`: `INSERT`/`UPDATE` `TO authenticated` под `has_role_v2(auth.uid(), 'super_admin'|'admin'|'menedzher')`; `DELETE` — только `super_admin`. Явный `service_role` policy отсутствует.
- `company_contacts`: аналогично — `INSERT`/`UPDATE` под authenticated+role guard; никакой service_role policy.
- `companies`: пишется исключительно через `crm_company_upsert_from_billing` (SECURITY DEFINER под service_role).

ACL Phase 1 в силе; `anon`/`PUBLIC` grants не выданы (проверено косвенно через отсутствие политик и приложенный ACL Phase 1 baseline).

**Preflight итог:** PASS. Все stop-guards из плана §10 п. 1–5 удовлетворены.

---

## 2. Execution identity gate — **BLOCKER**

Согласно плану v1.2 §4, до rehearsal обязан быть выбран и доказан **один согласованный способ** оркестрации трёх действий (companies upsert / map insert / company_contacts insert) в рамках управляемой транзакции. Ниже — фактическая проверка, почему этот шаг невозможен в managed executor **без обхода** контракта.

### 2.1 Роль текущей сессии

| Роль | `rolsuper` | `rolbypassrls` | `rolcanlogin` | Прямые memberships |
|---|---|---|---|---|
| `sandbox_exec` | false | **true** | true | нет |
| `service_role` | false | true | false | — |
| `authenticated` | false | false | false | — |
| `anon` | false | false | false | — |
| `postgres` | false | true | true | включает `anon, authenticated, service_role, sandbox_exec_*` |

Managed executor подключает нас как **`sandbox_exec`**, не как `service_role` и не как `authenticated`. `sandbox_exec`:

- имеет `BYPASSRLS = true` — все RLS-политики канонических таблиц **обходятся автоматически**;
- имеет явные `EXECUTE`-гранты на `crm_company_upsert_from_billing` и `crm_company_link_contact`;
- **не имеет** доступа к схеме `auth` (`ERROR: permission denied for schema auth` при чтении `auth.users` и при прямом вызове `auth.uid()`);
- не является членом `service_role` или `authenticated` (не наследует их RLS-поведение).

### 2.2 Что это означает для варианта (a) плана v1.2

Вариант (a) требует: `crm_company_upsert_from_billing` под `service_role`, `crm_company_link_contact` под admin JWT (роль `authenticated` + guard `admin`), map INSERT под controlled, run-tagged SQL, — и всё это в единой безопасной транзакции.

В managed executor:

1. **Нет `service_role` identity.** Сессия — `sandbox_exec`. Успешный вызов `crm_company_upsert_from_billing` под `sandbox_exec` подтвердит лишь наличие явного EXECUTE-гранта у оператора managed executor, но **не** воспроизведёт runtime identity `service_role`.
2. **Нет admin JWT identity.** `auth.uid()` требует `request.jwt.claims`; даже если задать `SET LOCAL request.jwt.claims TO '{"sub":"<admin>","role":"authenticated"}'`, session role остаётся `sandbox_exec` с `BYPASSRLS`. Внутренний role guard `crm_company_link_contact` (`has_role_v2(auth.uid(), …)`) можно «удовлетворить» подставленным `sub`, но это **не проверка** admin JWT в authenticated identity — это подмена claim в operator-сессии с обходом RLS. Такой путь запрещён как «обход» согласно §2 протокола запроса.
3. **Map INSERT под `sandbox_exec` обходит RLS.** Даже строго read-then-insert map-writer с run-tag/ID-ledger выполнится по `BYPASSRLS`, не подтверждая, что admin identity действительно допущен политикой `client_legal_details_company_map insert for admin+manager`. Это делает proof identity бессмысленным.
4. **Транзакционная модель не проверяема.** Утверждение «service_role и admin JWT можно объединить в одну транзакцию» — предмет доказательства (план v1.2 §4, §11). Managed executor даёт **одну** сессию с одной ролью (`sandbox_exec`), поэтому вопрос многоидентичной транзакции внутри неё не адресуется.

### 2.3 Что это означает для варианта (b) плана v1.2

Вариант (b) требует нового узкого internal service writer и в текущем Phase 3B создан быть не может (нужен отдельный approval и migration/DDL, что запрещено настоящим запросом).

### 2.4 Итог §2

**Blocker подтверждён:** единая безопасная оркестрация трёх действий в managed executor невозможна без:
- либо обхода RLS через `BYPASSRLS` sandbox_exec (запрещено §2 запроса),
- либо подмены `request.jwt.claims` без реального authenticated контекста (запрещено §2 запроса),
- либо создания нового internal writer (вариант (b), требует отдельного approval, запрещено настоящим запросом).

Rehearsal **остановлен строго до открытия транзакции**. `BEGIN` не выполнялся. INSERT/UPDATE/DELETE не выполнялись. Никаких run-tag'ов в БД не создано.

---

## 3. Пропущенные шаги (в соответствии со stop)

Не выполнялись:

- §3 плана — обработка 17 eligible CLD (16 unique + 1 повтор UNP `193405000`).
- §4 — post-run expected counts (16/17/17), фиксация `193405000 ⇒ 1 company + 2 billing contacts`.
- §5 — идемпотентный повторный проход внутри транзакции.
- ROLLBACK — не требуется, так как транзакция не открывалась.
- Independent after-check — не требуется, так как никаких изменений не производилось.

---

## 4. Роли/claims, использованные при проверках

| Действие | Session role | `request.jwt.claims` | RLS | Комментарий |
|---|---|---|---|---|
| Preflight SELECT | `sandbox_exec` | пусто (`NULL`) | обход по `BYPASSRLS` | Только read-only, безопасно |
| ACL/schema introspection | `sandbox_exec` | пусто | `pg_catalog` доступен | Схема `auth` недоступна (permission denied) |

Никакие admin JWT не подставлялись. Никакие `SET LOCAL request.jwt.claims` не выполнялись.

---

## 5. Doказательства (evidence)

### 5.1 SOFT-FLAG UNP 193405000

```
SELECT unp, count(DISTINCT profile_id)
FROM (
  SELECT COALESCE(NULLIF(ent_unp,''), NULLIF(leg_unp,'')) AS unp, profile_id
  FROM public.client_legal_details
  WHERE client_type IN ('entrepreneur','legal_entity')
    AND purpose='billing' AND status='active'
) e
WHERE unp ~ '^[0-9]{9}$'
GROUP BY unp HAVING count(DISTINCT profile_id) > 1;

  unp     | count
----------+-------
 193405000|   2
```

### 5.2 Штатный сценарий (1 profile → 2 UNP)

```
profile_id                          | count
a4b7c8c9-…-2a5db2121577             |   2
```

### 5.3 Отсутствие sequence у map

```
\d public.client_legal_details_company_map
id | uuid | not null | default gen_random_uuid()
UNIQUE CONSTRAINT (client_legal_details_id)
```

Отдельной строки в `public_id_sequences` для map нет (список entity_type: `company, corporate_draft, call, document_package_field, site_page_tag, training_module, crm_task, product, tariff, site_page, site_domain_binding, site_form_submission, field`).

### 5.4 Managed executor role

```
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname='sandbox_exec';
sandbox_exec | f | t
```

### 5.5 Недоступность `auth` из sandbox_exec

```
SELECT auth.uid();
ERROR: permission denied for schema auth
```

---

## 6. Rollback status

- Транзакция **не открывалась**. `ROLLBACK` не требовался и не выполнялся.
- Никаких временных таблиц, run-tag'ов, ID-ledger'ов в БД не создано.
- Sequences не двигались; `public_id_sequences.company.last_value` остаётся `0`.

## 7. Residual scan

| Проверка | Результат |
|---|---|
| `companies` count | 0 |
| `client_legal_details_company_map` count | 0 |
| `company_contacts` (billing) count | 0 |
| `public_id_sequences.company.last_value` | 0 |
| Изменения схемы | нет |
| Изменения RPC/functions | нет |
| Новые edge functions / queue jobs / UI | нет |
| Новые миграции | нет |

Baseline **точно** воспроизведён.

---

## 8. Финальный вердикт и следующий шаг

- **Phase 3B rollback-only identity rehearsal: BLOCKER на §2 (execution identity).**
- **Phase 3C ЗАПРЕЩЕН** и не может быть открыт без явного admin approval.
- Данные не тронуты; production не тронут; DDL/DML/миграций/RPC/edge/UI/типов/зависимостей нет.

### Рекомендации для разблокировки (не выполнять без отдельного approval)

1. **Явный approval варианта (b)** плана v1.2 §4 — узкий internal service writer, покрывающий все три действия одним контрактом с явными identity requirements и без зависимости от operator role `sandbox_exec`. Требует отдельной миграции — вне scope настоящего запроса.
2. **Либо** внешний runtime executor (edge function/бэкенд) с реальным `service_role` ключом и параллельным admin JWT, где identity доказывается вне managed executor. Требует отдельного approval и не относится к Phase 3B в текущем виде.
3. **Не** пытаться доказывать identity под `sandbox_exec` через `BYPASSRLS` или подмену `request.jwt.claims` — это обход контракта и явно запрещено настоящим запросом.

---

## 9. DoD отчёта

- [x] Preflight PASS (baseline + inventory + ACL/signatures + RLS) зафиксирован.
- [x] Identity gate строго проверен и явно объявлен blocker'ом с обоснованием.
- [x] Никаких DML/DDL/COMMIT/миграций/RPC/edge/UI не выполнялось.
- [x] Residual scan подтверждает нулевое воздействие.
- [x] Phase 3C явно оставлен запрещённым.
