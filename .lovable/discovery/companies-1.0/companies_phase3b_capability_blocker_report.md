# Phase 3B — Lovable Native Service-Role Capability Blocker Report

**Версия:** 1.0
**Статус:** BLOCKER (no runtime execution attempted)
**Область:** Phase 3B rollback-only identity rehearsal для writer `public.crm_company_backfill_billing_cld(uuid)`.
**Режим:** read-only capability discovery. Никакие транзакции не открывались, никакие данные не менялись, никакие миграции не создавались.

---

## 1. Что требовалось

Выполнить rollback-only rehearsal нового writer'а под **реальной** идентичностью `service_role` строго внутри одной `BEGIN … ROLLBACK`, так чтобы:

- `auth.role() = 'service_role'` было истиной внутри тела `SECURITY DEFINER` writer'а (без `SET LOCAL request.jwt.claims`, без `BYPASSRLS`, без sandbox-обходов);
- вложенный вызов `crm_company_link_contact` проходил обновлённый service-role gate;
- всё это происходило под управлением Lovable/Supabase-native execution surface, без временного публичного endpoint, без broad grants, без запроса ключей у пользователя.

## 2. Что реально доступно в Lovable managed environment

Проведён read-only опрос execution surface, доступного агенту в этой среде:

| Execution surface | Идентичность в БД | `auth.role()` возвращает | Подходит для 3B? |
|---|---|---|---|
| Managed psql / `supabase--read_query` / `supabase--insert` | `sandbox_exec` (superuser-like, `BYPASSRLS=true`, нет доступа к схеме `auth`) | не определено (`auth.role()` недоступно; схема `auth` закрыта) | ❌ Не является `service_role`. Любая попытка «сыграть» роль требует `SET LOCAL request.jwt.claims` либо ручного `SET ROLE service_role`, что явно запрещено протоколом Phase 3B и является подделкой identity, а не её доказательством. |
| `supabase--migration` | Тот же миграционный runner (owner-level) | не `service_role` | ❌ Миграция — DDL/DML канал, а не runtime execution от лица `service_role`. Использовать её для «вызова» writer'а под service_role означало бы фактически исполнить backfill как побочный эффект миграции. |
| Edge Function (`supabase--deploy_edge_functions`) с `SUPABASE_SERVICE_ROLE_KEY` | В runtime edge — да, `service_role` через PostgREST | `service_role` | ⚠️ Технически единственный **runtime** канал, где `auth.role()='service_role'` подлинно достижимо. Но пользователь явно **запретил** создавать Edge Function / cron / временный публичный endpoint как обход для 3B, и запретил запрашивать/раскрывать ключи. |
| Прямое использование `SUPABASE_SERVICE_ROLE_KEY` из sandbox через `curl` к PostgREST | `service_role` | `service_role` | ❌ Ключ недоступен агенту в Lovable Cloud и по политике не должен запрашиваться, логироваться или сохраняться. |
| `SET ROLE service_role` внутри psql | псевдо-`service_role` без JWT claims | `auth.role()` всё равно вернёт NULL (нет `request.jwt.claim.role`) | ❌ Не эквивалентно реальной PostgREST-сессии `service_role`; gate внутри `crm_company_link_contact` проверяет именно `auth.role()`, а не `current_user`. Это тот же самый sandbox-обход, что и подделка JWT. |

Runtime-опрос текущей sandbox-сессии (единственная фактическая проверка, выполненная в этом шаге):

```
select current_user, session_user, current_setting('role',true);
-- sandbox_exec | sandbox_exec | none
-- auth.role()  → ERROR: permission denied for schema auth
```

Это подтверждает, что в текущей execution surface `auth.role()='service_role'` **не может быть истиной честным путём**.

## 3. Отсутствующая native capability (точное имя)

**Missing capability:** *Lovable-managed, non-public, transaction-scoped `service_role` SQL execution surface* — то есть встроенный агентский канал, который бы:

1. открывал одну транзакцию (`BEGIN … ROLLBACK`) в основной БД,
2. внутри неё устанавливал подлинную PostgREST-эквивалентную сессию `service_role` (валидные `request.jwt.claim.role='service_role'` из доверенного источника, без ручной подделки claims агентом),
3. позволял вызвать произвольную `SECURITY DEFINER` функцию (`public.crm_company_backfill_billing_cld`) от лица этой сессии,
4. и гарантированно откатывал транзакцию по завершении, без создания публичного HTTP endpoint, cron, миграции или временных grants.

Такой capability в интегрированной Lovable/Supabase поверхности агенту сейчас **не предоставлен**. Ближайший runtime-канал с настоящей `service_role` идентичностью — Edge Function, но её создание для 3B явно запрещено пользователем как обход.

## 4. Что НЕ было сделано (по протоколу)

- ❌ Не открывалась ни одна транзакция против БД.
- ❌ Не вызывался `crm_company_backfill_billing_cld` и не вызывался `crm_company_upsert_from_billing` / `crm_company_link_contact`.
- ❌ Не создавались миграции, Edge Functions, cron jobs, публичные endpoints, временные grants, RLS-исключения.
- ❌ Не выполнялись `SET LOCAL request.jwt.claims`, `SET ROLE service_role`, `BYPASSRLS`-манёвры.
- ❌ У пользователя не запрашивались `SUPABASE_SERVICE_ROLE_KEY` или пароли; никакие секреты не читались, не логировались и не сохранялись.
- ❌ Не заявляется, что service-role rehearsal возможен — до появления runtime proof это утверждение неверно.

## 5. Baseline данных (без изменений)

State подтверждён read-only ранее в фазе (v1.1 remediation report §Postflight) и не пересматривался этим отчётом:

- `public.companies` = 0
- `public.client_legal_details_company_map` = 0
- `public.company_contacts` (billing) = 0
- `public_id_sequences.company` = 0
- Инвентарь CLD: 48 total / 17 eligible / 16 unique UNP (soft-flag UNP `193405000` на двух профилях).

Никаких новых row/event/activity записей этим шагом не создано.

## 6. Единственный безопасный next step, который Lovable может предложить сам

Из четырёх поверхностей в §2 **единственная**, дающая подлинный `auth.role()='service_role'` без обходов и без раскрытия ключей пользователю, — **Lovable-managed Edge Function**, которую агент может задеплоить сам, используя уже сконфигурированный `SUPABASE_SERVICE_ROLE_KEY` из среды Edge runtime (ключ не запрашивается у пользователя, не появляется в Git, не логируется).

Такой next step **должен быть отдельно одобрен пользователем**, потому что противоречит нынешней формулировке запрета «без Edge Function как обхода». Предлагаемая безопасная форма (для отдельного approval, **не** выполняется этим отчётом):

- **Название:** `crm-company-backfill-rehearsal` (internal-only).
- **Auth:** `verify_jwt = true`, plus explicit caller-header shared-secret check против нового секрета `PHASE3B_REHEARSAL_TOKEN` (агент сгенерирует через `secrets--generate_secret`, значение никогда не выводится в чат и не коммитится).
- **Поведение:** открывает одну транзакцию через service-role Postgres клиент, вызывает `crm_company_backfill_billing_cld` для 17 eligible CLD в двух волнах, выполняет внутри-транзакционные assertions (16/17/17, actor/audit/event), затем **безусловный `ROLLBACK`**. Никаких COMMIT-путей в коде.
- **Scope:** только rehearsal. Не вызывается из UI, не подключается к queue/worker/cron, не имеет публичного пути активации, удаляется сразу после PASS-отчёта.
- **Артефакт:** отчёт `.lovable/discovery/companies-1.0/companies_phase3b_rollback_rehearsal_report.md` v1.1 с SQL/evidence, ID (сокращёнными), residual-scan = baseline.

**Альтернатива, которая НЕ требует Edge Function:** явное предоставление пользователем runtime-сессии `service_role` через любой поддерживаемый Lovable-native канал, если он появится (сейчас отсутствует).

## 7. Стоп-состояние

- Phase 3B rehearsal: **NOT STARTED** (capability blocker).
- Phase 3C: **BLOCKED** (условие «PASS rollback-only rehearsal» не выполнено).
- UI / queue / worker: без изменений.
- Требуется отдельное решение пользователя по §6, прежде чем агент предпримет любые следующие шаги.
