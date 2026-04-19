

# План: PATCH 1.1 v3 — pre-approve discovery package (read-only)

## Scope

Это **не план execute**. Это план сбора 6 pre-approve deliverables через read-only tools. После них — финальный revised package на approve, и только потом execute.

Базовый scope PATCH 1.1 жёстко зафиксирован: **A1–A10 + B1**. A11 = pending scope-change, не входит в execute до отдельного approve по доказательствам.

---

## Pre-approve deliverables (что соберу до approve)

### D1. Proof package по `instagram-webhook` (для A11)

Через `code--view supabase/functions/instagram-webhook/index.ts` + `code--search_files`:
- Точный ingress contract: URL, методы, headers, query params
- Handshake invariants: `hub.challenge` / `hub.verify_token` GET handler
- Body invariants: `entry[].messaging[]` / `changes[]` shape, какие поля обязательны
- Auth model: `X-Hub-Signature-256` HMAC SHA-256 от raw body, App Secret source
- Где именно branch под ManyChat создаёт security regression (конкретные строки кода)
- Почему thin-wrapper хуже отдельного endpoint (по invariants)

**Output:** блок в revised plan «A11 proof of impossibility».

### D2. §7.2 — generic domain-event dispatcher discovery

Через `code--search_files` по `DomainEventService`, `domain_events`, `recordExecution`, по edge functions с pattern consumer/dispatcher:
- Есть ли существующий generic consumer pattern для `domain_events`
- Если да — какой артефакт reused (имя функции/RPC/cron)
- Если нет — какой минимальный downstream pattern допустим без нарушения domain-isolation

**Output:** один из двух конкретных выводов:
- (a) reuse existing dispatcher X
- (b) downstream выполняется inline через `DomainEventService.recordExecution` после ingress, без отдельного consumer (с обоснованием)

Никаких «если-если» в финальном плане.

### D3. B1 dry-run outputs (read-only SQL через `supabase--read_query`)

Запросы:
```sql
-- Структура integration_logs
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='integration_logs';

-- Существующие индексы
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename='integration_logs';

-- Размер payload
SELECT event_type, COUNT(*),
       AVG(octet_length(payload_meta::text)),
       MAX(octet_length(payload_meta::text))
FROM integration_logs GROUP BY event_type;

-- Retention
SELECT jobname, schedule, command FROM cron.job
WHERE command ILIKE '%integration_logs%';

-- Конфликты UNIQUE / PK
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid='public.integration_logs'::regclass;
```

**Output:** реальные значения. На их основе финальный verdict B1 = `confirmed reuse` или `escalate to new table`.

### D4. A4 pre-flight UNIQUE проверка

```sql
-- Текущий UNIQUE
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid='public.instagram_contacts'::regclass AND contype='u';

-- Конфликт legacy строк под новый composite UNIQUE
SELECT instagram_account_id, instagram_user_id, COUNT(*)
FROM instagram_contacts
GROUP BY 1,2 HAVING COUNT(*)>1;
```

**Output:** если 0 конфликтов → execute разрешён по default plan (drop старого UNIQUE, add `(instagram_account_id, provider_kind, instagram_user_id)`). Если ≥1 конфликт → hard-stop + remediation plan отдельно.

### D5. Operational-safe DDL order

На основе D3+D4 размечу для каждого ALTER/INDEX:
- Безопасен ли без long lock (ADD COLUMN с DEFAULT в Postgres ≥11 = быстрый)
- Какие индексы создавать `CONCURRENTLY` (partial UNIQUE на `instagram_messages`, `integration_logs`)
- Порядок: сначала ADD `provider_kind` с DEFAULT (legacy backfill), потом DROP старого UNIQUE на `instagram_contacts`, потом ADD нового composite UNIQUE — чтобы не словить дыру дедупликации

**Output:** фиксированный SQL-порядок Migration 1.

### D6. Updated `gap-register.md`

Два варианта на approve:
- (вариант A) addendum с A11 + полный proof из D1+D2 → PATCH 1.1 включает A1–A11 + B1
- (вариант B) A11 переносится в **PATCH 1.2** → PATCH 1.1 = A1–A10 + B1 без ingress

Решение принимаю на основе D1+D2: если proof убедителен — даю на approve вариант A; если нет — сразу вариант B без попытки протащить.

---

## Закреплённые решения (без пересмотра в execute)

| # | Решение | Жёсткость |
|---|---|---|
| A8 | Snapshot **только** в `config.sync_state`. Settings в root `config`. `integration_sync_logs` = история sync, **не SoT хранилище**. Вариант 2 удалён | final |
| A7 | Только 24h окно до закрытия `windowing-proof.md`. Никаких hard-coded `message_tag`. Вне окна — блокировка через `normalizeEdgeFunctionError`. HUMAN_AGENT и др. policy — только после live-proof + explicit config flag | final |
| A4 | Default = пересмотр UNIQUE на composite. Execute **только** при D4 = 0 конфликтов. Иначе hard-stop | conditional on D4 |
| B1 | Reuse `integration_logs`+`domain_events` через partial UNIQUE — **только** при положительном D3. Иначе escalate | conditional on D3 |
| A11 | Pending scope-change. Не входит в execute до D1+D2 + отдельного approve | gated |

---

## Расширенный legacy verify (добавлено к L1–L8)

| # | Verify шаг |
|---|---|
| L9 | Create/edit/delete существующего integration instance (ApiX-Drive/GetCourse/AmoCRM) после ADD `config_secrets` и ADD ManyChat в PROVIDERS — формы и сохранение работают |
| L10 | Визуальный smoke `/admin/integrations`: existing provider cards, категории, порядок не поехали; ManyChat карточка добавлена в правильную категорию без layout shift |

---

## Что НЕ делаю в pre-approve фазе

- ❌ Никаких миграций
- ❌ Никаких новых функций
- ❌ Никаких изменений existing функций
- ❌ Никакого UI кода
- ❌ Никакого scope-change без proof

Только read-only discovery + сбор пакета.

---

## Финальный revised package на approve (после D1–D6)

1. Updated `gap-register.md` (вариант A или B по итогам D1+D2)
2. D3 dry-run outputs по B1 + verdict
3. D4 pre-flight outputs по A4 UNIQUE + verdict
4. D1 proof package по `instagram-webhook`
5. D2 вывод по dispatcher (без развилок)
6. Финальный PATCH 1.1 v3 plan без открытых веток с фиксированным DDL order из D5

Только после approve этого пакета — execute.

---

## Порядок работы pre-approve

1. D1 (`code--view`, `code--search_files`) — instagram-webhook contract
2. D2 (`code--search_files`, `code--view`) — dispatcher pattern
3. D3 (`supabase--read_query` ×5) — B1 dry-run
4. D4 (`supabase--read_query` ×2) — A4 pre-flight
5. D5 — DDL order на основе D3+D4
6. D6 — gap-register addendum или fallback
7. Подача revised package

---

## Fallback при отсутствии A11 proof

Если D1+D2 не дают убедительного proof:
- A11 → PATCH 1.2 (отдельный план)
- PATCH 1.1 execute = только A1–A10 + B1
- Никаких частичных ingress попыток

