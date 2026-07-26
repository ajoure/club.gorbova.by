# Phase 4A — Company Sync Queue + Worker: Discovery & Runnable Plan

**Статус:** Discovery-only (read-only). Никаких DDL/DML/UI/секретов/строк очереди в этом шаге не создаётся.
**Дата:** 2026-07-20
**Область:** Только Phase 4A (queue + worker foundation). Phase 4B (UI-хуки в `useLegalDetails.tsx`, `LegalDetailsPickerDialog.tsx`, corporate draft flow, ALTER `client_legal_details ADD COLUMN company_id`) и Phase 4C (production enablement) — отдельными approval-шагами.
**Zero-change guarantee:** этот отчёт — единственный артефакт коммита. `companies` / `client_legal_details_company_map` / `company_contacts` / `company_sync_queue` не изменяются.

---

## 1. Baseline и inventory (read-only preflight)

### 1.1 Phase 3 baseline (проверено на момент discovery)

| Метрика | Ожидание | Факт | Статус |
|---|---|---|---|
| `companies` count | 16 | 16 | ✅ |
| `client_legal_details_company_map` count | 17 | 17 | ✅ |
| `company_contacts WHERE is_billing_contact=true` count | 17 | 17 | ✅ |
| `public_id_sequences.last_value WHERE entity_type='company'` | 16 | 16 | ✅ |
| `company_sync_queue` count | 0 | 0 | ✅ |

**Инвариант, который Phase 4 не должен нарушать:** после deploy worker в idle-состоянии (без новых billing CLD) счётчики остаются 16 / 17 / 17 / 16. Первый CLD, созданный через новую UI-интеграцию (Phase 4B), увеличит их до 17 / 18 / 18 / 17.

### 1.2 `public.company_sync_queue` — текущая схема

Источник: `20260719162721_..._sql` § «3.5 company_sync_queue».

Колонки (17):

| Колонка | Тип | NULL | Default |
|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` |
| `entity_id` | uuid | YES | — |
| `entity_type` | text | NO | — |
| `run_reason` | text | NO | — |
| `payload` | jsonb | NO | `'{}'::jsonb` |
| `status` | text | NO | `'queued'` |
| `attempts` | int | NO | `0` |
| `next_run_at` | timestamptz | NO | `now()` |
| `last_error` | text | YES | — |
| `locked_by` | text | YES | — |
| `locked_at` | timestamptz | YES | — |
| `idempotency_key` | text | YES | — |
| `metadata` | jsonb | NO | `'{}'::jsonb` |
| `created_at`, `updated_at` | timestamptz | NO | `now()` |
| `created_by`, `updated_by` | uuid | YES | — |

**Индексы:** `PK(id)`, `UNIQUE(idempotency_key)`, партиальный `csq_status_next_idx(status, next_run_at) WHERE status IN ('queued','running')`.

**RLS / Grants:**
- RLS: ENABLED.
- Policy: `company_sync_queue service only` — `FOR ALL TO service_role USING (true) WITH CHECK (true)`.
- Grants: `GRANT ALL ... TO service_role`. `anon` и `authenticated` — **нет прав вообще** (это защищено runtime-инвариантом в `20260719165300_...` шаг ACL hardening).

**Trigger:** `update_company_sync_queue_updated_at BEFORE UPDATE`.

### 1.3 Существующие producers (что уже пишет в очередь)

Единственный найденный producer сегодня — RPC `public.crm_company_grp_refetch(_id uuid)` (`20260719214544_...` строки 1250–1300):
- Требует роль `admin/super_admin/menedzher`.
- Берёт `pg_advisory_xact_lock('company_grp_refetch:'||id)`.
- Ищет уже висящий job с `run_reason='grp_refetch'` в `('queued','running')` с `FOR UPDATE` — если есть, возвращает его id (дедуп).
- Иначе INSERT с `idempotency_key='company:'||id||':grp_refetch:'||uuid` (random suffix — de-facto NOT dedup-key, guard даёт дедуп через SELECT).
- Эмитит `domain_event` `company.grp_refetch_requested.v1`.

`run_reason` currently in use: `'grp_refetch'`. Phase 4 добавит **новое** значение `'legal_details_upsert'` (см. §4.1).

### 1.4 Существующие consumers

Поиск по репозиторию (`rg "company_sync_queue" .`) не нашёл ни одной Edge Function, ни одного клиентского вызова через `supabase.from('company_sync_queue')`. Только:
- SQL миграции (DDL / RPC / ACL invariants);
- Discovery/plan-документы;
- `src/integrations/supabase/types.ts` (авто-типы).

**Вывод:** consumer-а нет; очередь — «спящая» инфраструктура. Phase 4A вводит первого consumer — Edge Function `company-sync-worker`.

### 1.5 Смежные объекты, которые worker будет использовать (без изменений в 4A)

| Объект | Роль исполнителя | Назначение |
|---|---|---|
| `public.crm_company_backfill_billing_cld(_client_legal_details_id uuid)` | `service_role` (Phase 3B remediation) | Permanent internal writer: upsert companies + read-then-insert map + link billing contact. Единственный вход для worker. |
| `public.crm_company_upsert_from_billing(_cld_id)` | вызывается только изнутри backfill RPC | Canonical company writer (`country='BY'` жёстко). |
| `public.crm_company_link_contact(...)` | принимает `service_role` (после remediation `v_actor_user_id = COALESCE(profiles.user_id, id)`) | Создаёт `company_contacts` c `relationship_type='billing_contact'`, `is_billing_contact=true`, `source='billing_requisites'`, `source_map_id=<map_id>`. |
| `public.client_legal_details_company_map` | UNIQUE(`client_legal_details_id`) | Read-then-insert. Blind ON CONFLICT запрещён. |
| `public.crm_activity_log` | writer через `link_contact` | `user_id` NOT NULL → уже покрыт `v_actor_user_id`. |
| `public.domain_events` | опц., через `_crm_company_emit_domain_event` | Producer будет эмитить `company.sync_requested.v1`. |

Ни один из этих объектов Phase 4A не переопределяет.

---

## 2. Source of truth и scope

- **In-scope (Phase 4A, будет реализовано в 4B-migration-шаге по этому плану):**
  1. Новая SQL-функция `public.crm_company_sync_enqueue(_cld_id uuid, _reason text)` (SECURITY DEFINER, gate: `authenticated` + `admin/super_admin/menedzher/klient`; см. §3.2).
  2. Новая SQL-функция `public.crm_company_sync_worker_claim(_batch int, _lease_seconds int)` (SECURITY DEFINER, gate: `service_role` only).
  3. Новая SQL-функция `public.crm_company_sync_worker_complete(_id uuid, _status text, _error text)` (SECURITY DEFINER, gate: `service_role` only).
  4. Партиальный индекс `csq_deadletter_idx (updated_at) WHERE status='dead_letter'` — только если dead-letter не будет наблюдаться другим индексом.
  5. Опциональная колонка `first_attempted_at timestamptz` (nullable) для observability — **включается только если preflight подтвердит отсутствие иного источника).
  6. Edge Function `supabase/functions/company-sync-worker/index.ts` (verify_jwt=false, авторизация через SERVICE_ROLE + shared-secret header).
  7. Cron (`pg_cron`) job `company-sync-worker-tick` @ `* * * * *`, вызывает Edge через `net.http_post` с anon key (стандартный шаблон Lovable). Создаётся через `supabase--insert`, не через migration (user-specific data).
- **Out-of-scope Phase 4A:** ALTER `client_legal_details ADD COLUMN company_id`, UI-хуки, backfill данных, любые изменения `companies` / `map` / `contacts` вручную.
- **Out-of-scope навсегда для worker:** запись в `entitlements`, `access_grant_ledger`, `orders_v2`, `payments_v2`, `telegram_*`.

---

## 3. Контракты

### 3.1 Idempotency key (deterministic, dedup-safe)

Единая формула:
```
idempotency_key = 'company_sync:v1:' || _cld_id::text || ':' || _reason
```
- `_reason ∈ {'legal_details_upsert','manual_replay'}`; `'grp_refetch'` остаётся ключом существующего producer и в worker Phase 4A **не обрабатывается** (skip с `run_reason` gate).
- Уникальный индекс `company_sync_queue_idempotency_key_key` гарантирует, что параллельный enqueue → `ON CONFLICT (idempotency_key) DO NOTHING`, возврат существующего `id`.
- Заменяет random-suffix, использованный в `grp_refetch`; сам `grp_refetch` не трогаем.

### 3.2 Enqueue API — `crm_company_sync_enqueue(_cld_id uuid, _reason text)`

- Роли: `authenticated` (owner-of-CLD ИЛИ `admin/super_admin/menedzher`). Владелец определяется через существующие RLS-предикаты `client_legal_details`.
- Guards:
  - `_reason IN ('legal_details_upsert','manual_replay')` → иначе 22023.
  - `EXISTS (SELECT 1 FROM client_legal_details WHERE id=_cld_id)` → иначе 23503.
  - `pg_advisory_xact_lock(hashtextextended('company_sync_enqueue:'||_cld_id::text, 0))`.
  - `INSERT ... ON CONFLICT (idempotency_key) DO UPDATE SET next_run_at=LEAST(EXCLUDED.next_run_at, company_sync_queue.next_run_at) RETURNING id`.
- Возврат: `uuid` job id.
- Эмит `domain_event` `company.sync_requested.v1` только при впервые созданном job (проверка `xmax=0`).

### 3.3 Claim API — `crm_company_sync_worker_claim(_batch int DEFAULT 10, _lease_seconds int DEFAULT 60)`

- Роли: **только** `service_role` (`IF auth.role() <> 'service_role' THEN 42501`).
- SQL:
  ```sql
  UPDATE company_sync_queue q
     SET status='running',
         attempts = attempts + 1,
         locked_by = 'company-sync-worker:'||_worker_id,
         locked_at = now(),
         next_run_at = now() + make_interval(secs => _lease_seconds)
    FROM (
      SELECT id FROM company_sync_queue
       WHERE status IN ('queued')
          OR (status='running' AND next_run_at < now())  -- expired lease
      ORDER BY next_run_at
      LIMIT _batch
      FOR UPDATE SKIP LOCKED
    ) picked
   WHERE q.id = picked.id
  RETURNING q.*;
  ```
- `FOR UPDATE SKIP LOCKED` обеспечивает concurrency-safety между воркерами.
- Expired lease (`status='running' AND next_run_at < now()`) реклеймится другим воркером → покрывает crash worker'а.

### 3.4 Complete API — `crm_company_sync_worker_complete(_id, _status, _error)`

- `_status ∈ ('done','retry','dead_letter')`.
- `retry`: `next_run_at = now() + backoff(attempts)`, `status='queued'`, сохранить `last_error`.
- Backoff: `min(3600, 30 * 2^(attempts-1))` sec, capped at 1h. С джиттером ±20% (через `random()`).
- `dead_letter`: перевод в терминальный статус когда `attempts >= 8` **или** worker классифицировал ошибку как non-retryable (`ERRCODE IN ('42501','23503','22023', наш конфликтный код map mismatch)`).
- Роль: `service_role` only.

### 3.5 Worker logic (Edge Function `company-sync-worker`)

```
1. Auth check: header X-Worker-Secret == PHASE4_WORKER_SHARED_SECRET (Deno.env)
                AND Authorization Bearer <SUPABASE_SERVICE_ROLE_KEY> (пришёл от pg_cron).
2. supabase.rpc('crm_company_sync_worker_claim', { _batch:10, _lease_seconds:60 })
3. For each job:
     a. Skip если run_reason NOT IN ('legal_details_upsert','manual_replay') → complete(done, 'skipped: unsupported reason').
     b. supabase.rpc('crm_company_backfill_billing_cld', { _client_legal_details_id: entity_id })  -- permanent writer из Phase 3B.
     c. Обработка результата:
        - jsonb.status='ok' → complete(done).
        - Ошибка с ERRCODE в non-retryable списке → complete(dead_letter, err.message).
        - Иначе → complete(retry, err.message).
4. Логируем в console (Edge logs) job_id, entity_id, status, attempts, elapsed_ms.
```
**Никаких прямых SQL к `companies`/`map`/`company_contacts` из воркера.** Только `crm_company_backfill_billing_cld`.

### 3.6 Аудит-семантика Phase 3 сохраняется

- Все записи в `companies` / `map` / `company_contacts` идут через тот же `crm_company_backfill_billing_cld`, который использовался в Phase 3C. Значит `created_by`/`updated_by`/`source_map_id`/`source='billing_requisites'` формируются идентично — новых значений или мутаций старых строк worker не производит.
- `crm_activity_log.user_id` заполняется `v_actor_user_id` (из `profiles`), NOT NULL сохраняется.

---

## 4. Минимальный DDL / functions (для Phase 4A migration шага, не сейчас)

### 4.1 DDL delta

```sql
-- Индекс под dead-letter observability (создаём, только если поле status='dead_letter' появится)
CREATE INDEX IF NOT EXISTS csq_deadletter_idx
  ON public.company_sync_queue (updated_at)
  WHERE status = 'dead_letter';

-- Опционально (см. §2.5): наблюдаемость первой попытки
ALTER TABLE public.company_sync_queue
  ADD COLUMN IF NOT EXISTS first_attempted_at timestamptz NULL;
```
Никаких изменений колонок, RLS, grants у `company_sync_queue` не требуется — существующая service-only policy покрывает всё.

### 4.2 Функции (все SECURITY DEFINER, `SET search_path=public`)

- `crm_company_sync_enqueue(_cld_id uuid, _reason text) RETURNS uuid`.
- `crm_company_sync_worker_claim(_batch int, _lease_seconds int) RETURNS SETOF company_sync_queue`.
- `crm_company_sync_worker_complete(_id uuid, _status text, _error text) RETURNS void`.

**EXECUTE grants (важно, не полагаться на default):**
```
REVOKE ALL ON FUNCTION public.crm_company_sync_enqueue FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_company_sync_enqueue TO authenticated;
REVOKE ALL ON FUNCTION public.crm_company_sync_worker_claim, public.crm_company_sync_worker_complete FROM PUBLIC;
-- service_role получает EXECUTE через 'ALL PRIVILEGES ... TO service_role' по проектному конвеншену? Нет — явно:
GRANT EXECUTE ON FUNCTION public.crm_company_sync_worker_claim TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_sync_worker_complete TO service_role;
```

### 4.3 Edge Function

- Путь: `supabase/functions/company-sync-worker/index.ts`.
- Секрет: `PHASE4_WORKER_SHARED_SECRET` (генерируется через `secrets--generate_secret` перед deploy, длина 64).
- Уже доступные секреты (не запрашиваем повторно): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- `verify_jwt = false` (защита через shared-secret + service-role внутри).
- CORS: не нужен (server-to-server), но `OPTIONS` вернём 405.

### 4.4 Cron

Через `supabase--insert` (user-specific data — URL + anon key, нельзя в migration):
```sql
select cron.schedule(
  'company-sync-worker-tick', '* * * * *',
  $$ select net.http_post(
       url:='https://<project>.supabase.co/functions/v1/company-sync-worker',
       headers:=jsonb_build_object(
         'Content-Type','application/json',
         'apikey','<anon>',
         'Authorization','Bearer <anon>',
         'X-Worker-Secret','<PHASE4_WORKER_SHARED_SECRET>'
       ),
       body:='{}'::jsonb) $$);
```
Расширения `pg_cron` и `pg_net` — верифицировать наличие через `SELECT extname FROM pg_extension`; если отсутствуют — включить отдельной миграцией **до** enqueue.

---

## 5. Migration sequence (для Phase 4A execution, отдельным approval)

1. **M1 (idempotent DDL):** индекс `csq_deadletter_idx` + `first_attempted_at`. Без изменения существующих строк (в очереди 0 записей).
2. **M2 (functions):** `enqueue` / `claim` / `complete` + EXECUTE grants. Preflight внутри блока: проверить, что `crm_company_backfill_billing_cld` существует и её сигнатура не менялась (`pg_proc` hash по имени/аргументам).
3. **M3 (extensions guard):** `CREATE EXTENSION IF NOT EXISTS pg_cron; CREATE EXTENSION IF NOT EXISTS pg_net;` — только если preflight покажет их отсутствие.
4. **Secret step:** `secrets--generate_secret PHASE4_WORKER_SHARED_SECRET`.
5. **Edge deploy:** `supabase/functions/company-sync-worker/index.ts`.
6. **Cron step (через `supabase--insert`):** `cron.schedule(...)` с `apikey` = anon (не в git).
7. **Smoke (без production данных):** `crm_company_sync_enqueue(<test cld>, 'manual_replay')` под admin identity в rehearsal-режиме (по протоколу Phase 3B: временная Edge + принудительный ROLLBACK). Не выполняется в production до Phase 4C.

### 5.1 Rollback plan (обратный порядок)

1. `select cron.unschedule('company-sync-worker-tick');`
2. `supabase--delete_edge_functions company-sync-worker`.
3. `secrets--delete_secret PHASE4_WORKER_SHARED_SECRET`.
4. `DROP FUNCTION crm_company_sync_enqueue, crm_company_sync_worker_claim, crm_company_sync_worker_complete;`
5. `DROP INDEX IF EXISTS csq_deadletter_idx; ALTER TABLE company_sync_queue DROP COLUMN IF EXISTS first_attempted_at;`
6. Оставить `company_sync_queue` и Phase 3 объекты нетронутыми. Baseline 16/17/17/16 сохраняется.

Каждый шаг обратим независимо; ни один не удаляет строки данных.

---

## 6. Authorization / trust boundaries

| Actor | Может enqueue? | Может claim/complete? | Может писать в canonical? |
|---|---|---|---|
| `anon` | нет | нет | нет |
| `authenticated` (обычный клиент) | да, только для собственного CLD (гейт в enqueue) | нет | нет |
| `admin/super_admin/menedzher` | да, для любого CLD | нет (нет прямого EXECUTE) | нет вручную; только через worker |
| `service_role` (Edge worker) | нет (не нужен) | да | да, через `crm_company_backfill_billing_cld` |

Никаких shared-JWT hacks, никаких `SET LOCAL role`. Shared secret живёт в Deno.env и **никогда** не логируется.

---

## 7. Failure / replay протокол

- **Retryable:** сетевые/timeout/lock timeout ошибки, любые SQLSTATE не из non-retryable списка. Backoff в §3.4. Max attempts=8 → dead_letter.
- **Non-retryable (immediate dead_letter):** `42501` forbidden, `23503` missing FK, `22023` guard violation, custom конфликт map mismatch (Phase 3B протокол — abort как conflict).
- **Poison job protection:** dead_letter — терминальное состояние, воркер их не забирает. Наблюдаемость через `csq_deadletter_idx`.
- **Manual replay:** админ вызывает `crm_company_sync_enqueue(cld, 'manual_replay')` — при существующем dead_letter создаёт **новый** job (у него другой idempotency_key потому что reason='manual_replay'). Прежний dead_letter остаётся как аудит.
- **Crashed worker:** lease через `locked_at`+`next_run_at`; после `_lease_seconds` (60 c) job автоматически реклеймится (§3.3).

---

## 8. Observability

- Edge logs: `job_id`, `entity_id`, `run_reason`, `attempts`, `status`, `elapsed_ms`, `err_code`.
- SQL мониторинг (read-only views не создаём в 4A, план на 4C):
  ```sql
  SELECT status, count(*) FROM company_sync_queue GROUP BY 1;
  SELECT * FROM company_sync_queue WHERE status='dead_letter' ORDER BY updated_at DESC;
  ```
- `domain_events` `company.sync_requested.v1` / `.v1` — уже есть инфраструктура.
- Alert-триггер (план на 4C, не 4A): `count(dead_letter) > 0` → `ai_admin_notifications`.

---

## 9. Test matrix (для 4B rehearsal — не сейчас)

| # | Сценарий | Setup | Ожидание |
|---|---|---|---|
| T1 | Happy path | новый billing CLD, enqueue('legal_details_upsert') | 1 job → done; +1 company/map/contact (17/18/18/17) |
| T2 | Idempotency (dup enqueue до обработки) | enqueue x2 для того же CLD/reason | 1 job (тот же id), 1 company создана |
| T3 | Idempotency (re-enqueue после done) | done job + enqueue снова | новый job → done без дельт (backfill RPC idempotent) |
| T4 | Retry transient | mock: временный `40001` внутри backfill | attempts растут, backoff растёт, финально `done` |
| T5 | Non-retryable | CLD не существует (23503) | 1 attempt → `dead_letter` |
| T6 | Concurrency | 3 воркера, 30 jobs | все обработаны ровно 1 раз (`SKIP LOCKED` proof) |
| T7 | Crashed lease | job в `running` с истёкшим `next_run_at` | реклейм следующим воркером, `attempts` растёт |
| T8 | Poison | forced dead_letter | не забирается воркером; виден в `csq_deadletter_idx` |
| T9 | Unsupported reason | prod-инцидент: job с `run_reason='grp_refetch'` | worker `done` со `skipped` (не трогает `grp_refetch` producer) |
| T10 | Cleanup / rollback | выполнить §5.1 | 16/17/17/16 baseline восстановлен, `company_sync_queue` count = как до |
| T11 | UNP 193405000 (duplicate scenario) | enqueue второго CLD того же UNP | 0 новых companies, +1 map, +1 contact (протокол Phase 3B) |
| T12 | Map mismatch guard | искусственный конфликт `company_id` для того же `client_legal_details_id` | job → `dead_letter` без частичной записи |

T1–T9 и T11–T12 выполняются **только** в rollback-only rehearsal режиме (Phase 3B-стиль: временная Edge + принудительный ROLLBACK) до Phase 4C production enablement.

---

## 10. Preflight / postflight гейты (executor протокола 4B)

**Preflight (обязательные, все PASS → продолжить):**
- P1. Baseline 16/17/17/16 подтверждён.
- P2. `company_sync_queue` count = 0.
- P3. Отсутствуют `pg_proc` записи для новых функций (fresh install).
- P4. `crm_company_backfill_billing_cld` сигнатура не менялась (hash проверен).
- P5. `pg_cron`, `pg_net` доступны.
- P6. Секрет `PHASE4_WORKER_SHARED_SECRET` **отсутствует** до генерации.

**Postflight (после M2, до cron enable):**
- Q1. Три новые функции существуют с правильными grants (нет EXECUTE у anon).
- Q2. `csq_deadletter_idx` существует.
- Q3. `company_sync_queue` count всё ещё 0.
- Q4. Baseline canonical 16/17/17/16 не изменился.
- Q5. `crm_company_link_contact` / `crm_company_backfill_billing_cld` не переопределены (hash тот же).

**Postflight cron enable (Phase 4C, не сейчас):** отдельный approval.

---

## 11. Fixtures cleanup

- В 4A нет фикстур в БД.
- В 4B rehearsal: любые тестовые CLD, созданные под dedicated admin test identity, удаляются в рамках ROLLBACK транзакции (Phase 3B протокол).
- Никаких упоминаний бизнес-email адресов как источников данных. `1@ajoure.by` — не используется.

---

## 12. Stop-guards (жёсткие)

1. **Нельзя** запускать worker cron без отдельного admin approval (Phase 4C gate).
2. **Нельзя** давать `anon`/`authenticated` любые права на `company_sync_queue` (existing invariant в `20260719165300_...`).
3. **Нельзя** писать в `companies`/`map`/`company_contacts` из Edge функции напрямую — только через `crm_company_backfill_billing_cld`.
4. **Нельзя** дедуплицировать через blind `ON CONFLICT (client_legal_details_id) DO UPDATE` в map — Phase 3B протокол read-then-insert обязателен.
5. **Нельзя** использовать `auth.uid()` внутри Edge worker сессии для аудита — используется `v_actor_user_id` производный от `profiles` (уже в `link_contact` remediation).
6. **Нельзя** делать worker cron до появления первого UI-producer (Phase 4B), иначе очередь пуста и рискуем pathлогировать «healthy» без реальных запусков.
7. **Нельзя** увеличивать `attempts` cap выше 8 или backoff cap выше 1h без нового approval.
8. **Нельзя** трогать Phase 3 canonical данные под любым предлогом в Phase 4A.
9. **Нельзя** логировать `PHASE4_WORKER_SHARED_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, любой JWT в Edge logs.

---

## 13. DoD Phase 4A discovery-плана

- ✅ Baseline 16/17/17/16 зафиксирован и защищён инвариантом.
- ✅ Существующие schema/RLS/policies/indexes/consumers/producers очереди перечислены.
- ✅ Idempotency / dedup / retry / lease / dead-letter / authorization / replay протоколы определены.
- ✅ Минимальный DDL/functions/Edge/cron delta перечислен с обратимой migration sequence и rollback.
- ✅ Аудит-семантика Phase 3 сохраняется (worker пишет только через permanent service writer).
- ✅ Preflight/postflight и тест-матрица определены.
- ✅ Stop-guards зафиксированы. Phase 4B/4C требуют отдельного approval.
