# да, согласен, с учетом правок:

&nbsp;

1. В этот патч добавь не только чтение meta в telegram-process-access-queue, но и **все места постановки в очередь**, чтобы они записывали parent_event_key / parent_execution_key в telegram_access_queue.meta. Иначе lineage в queue будет неоткуда брать.
2. Для grant-access-for-order зафиксируй безопасный порядок точнее:
  **primary DB changes → ledger row → downstream telegram call → audit/post-check update**.
  Нельзя переносом сломать текущую выдачу entitlement/subscription или welcome-flow.
3. Для telegram-grant-access явно зафиксируй, что при *from*primary_path=true и отсутствии parent keys функция возвращает ошибку, а при обычном ручном/автономном вызове без этого флага — работает с NULL parent keys. Это нужно отдельно указать как backward-compatible контракт.
4. Для subscription-admin-actions прямо допиши mapping по веткам после переноса ledger внутрь case, чтобы не осталось двусмысленности:
  &nbsp;
  - cancel → inline ledger, downstream не нужен
  - revoke_access → inline ledger, потом telegram-revoke-access с parent keys
  - delete → inline ledger, потом telegram-revoke-access, потом физическое удаление
  - refund+revoke → inline ledger, потом telegram-revoke-access
    И отдельно: **общий post-switch ledger block удалить полностью**.
  &nbsp;
5. Для telegram-grant-access добавь явный outcome-contract по ledger:
  &nbsp;
  - success → action_type='grant', status='granted'
  - no-op/already-linked/already-in-chat → action_type='skip', status='skipped'
  - hard failure → action_type='grant', status='failed'
  &nbsp;
6. В proof-файле p0_downstream_parent_propagation_proof.txt зафиксируй 3 отдельных режима:
  &nbsp;
  - primary → child с parent keys
  - autonomous/manual → NULL parents
  - queue child → lineage из telegram_access_queue.meta
    И lineage-proof делать только через **single-row parent match по двум полям одновременно**.
  &nbsp;
7. Явно добавь guard: если после DDL миграции telegram_access_queue.meta не используется ни одним enqueue writer, Sub-patch B считается **не завершённым**, даже если processor уже умеет читать meta.

&nbsp;

&nbsp;

После этих 7 уточнений план можно отдавать в работу как следующий патч без нового пересогласования всего спринта.

&nbsp;

План: PATCH v22.6 Sub-patch B — Downstream Parent Propagation

## Статус

```
SAFE_TO_CONTINUE_IMPLEMENTATION = YES
CUTOVER_ALLOWED = NO
```

## Диагностика текущего состояния


| Компонент                          | Ledger write                    | Сохраняет execution_key | Передаёт parent keys downstream            |
| ---------------------------------- | ------------------------------- | ----------------------- | ------------------------------------------ |
| grant-access-for-order             | ✅ (line 683)                    | ❌                       | ❌                                          |
| subscription-charge (trial_expire) | ✅ executeRevoke (line 2177)     | ❌                       | ❌ (downstream вызов line 2155 ДО ledger)   |
| subscriptions-reconcile            | ✅ executeRevoke (4 блока)       | ❌                       | ❌                                          |
| subscription-admin-actions         | ✅ (post-switch block line 1118) | ❌                       | ❌ (downstream внутри case, до ledger)      |
| telegram-grant-access              | ❌ нет ledger                    | —                       | —                                          |
| telegram-process-access-queue      | ❌                               | —                       | ❌                                          |
| telegram-revoke-access             | ✅                               | ✅                       | — (конечная точка, уже читает parent keys) |


**Критическая проблема**: `telegram_access_queue` таблица НЕ имеет поля `meta` — только `user_id, club_id, subscription_id, action, status, attempts, last_error, created_at, processed_at`. Для хранения lineage нужна DDL-миграция.

---

## Scope Sub-patch B

### 7 уточнений из ревью — как закрыты

1. **Idempotent skip guard**: если `execution_key = null` → не передавать `_from_primary_path = true`. Либо дочитать существующую ledger row по `source_event_key`.
2. **subscription-admin-actions двойная запись**: перенести ledger write внутрь каждого case (cancel/revoke_access/delete), удалить общий post-switch block (lines 1117-1205).
3. **telegram_access_queue meta**: DDL миграция — добавить колонку `meta JSONB DEFAULT NULL`. Писать `parent_event_key`/`parent_execution_key` в meta при постановке в очередь.
4. **telegram-grant-access outcome matrix**: grant→granted, already_has_access→skipped, failure→failed.
5. **Порядок операций**: primary DB changes → ledger row → downstream call.
6. **Proof 3 состояния**: primary with parents, autonomous NULL, queued from meta.
7. **Scope freeze**: без batch/import, без runtime smoke, без cutover marker.

---

## Реализация по файлам

### Шаг 0. DDL миграция

Добавить `meta` колонку в `telegram_access_queue`:

```sql
ALTER TABLE public.telegram_access_queue ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT NULL;
COMMENT ON COLUMN public.telegram_access_queue.meta IS 'Optional metadata including parent lineage keys for ledger propagation';
```

Также обновить триггеры, которые INSERT в queue, чтобы не ломались (они не пишут meta → NULL по default, ok).

### Шаг 1. telegram-grant-access/index.ts

**Добавить ledger integration + приём parent keys:**

- Import `writeLedgerEntry`, `buildPostCheck` из `fulfillment-executor.ts`
- Расширить `GrantAccessRequest`:
  ```
  parent_event_key?: string | null
  parent_execution_key?: string | null
  _from_primary_path?: boolean
  ```
- Guard: если `_from_primary_path = true` и parent keys отсутствуют → 400
- **Outcome matrix** (одна ledger row на весь request, после всех club iterations):


| Outcome                                 | action_type | status  |
| --------------------------------------- | ----------- | ------- |
| successful grant (invite links created) | grant       | granted |
| already has access / no-op              | skip        | skipped |
| hard failure (telegram API error)       | grant       | failed  |


- `source_event_key`: `tg-grant:{userId}:{clubIds.join(',')}:{auditId}` где `auditId` из `logAudit` записи
- parent_event_key / parent_execution_key из body → в ledger row (nullable)

### Шаг 2. telegram-process-access-queue/index.ts

- Читать `meta` из queue row (расширить select: `.select("id, user_id, club_id, subscription_id, action, attempts, meta")`)
- При вызове telegram-grant-access / telegram-revoke-access: пробрасывать `parent_event_key`/`parent_execution_key` из `item.meta` (если есть)
- Не ставить `_from_primary_path = true` — queue сам по себе не primary

### Шаг 3. grant-access-for-order/index.ts

**Изменить порядок операций:**

```
Было:  entitlement → telegram-grant-access → subscription → ledger
Будет: entitlement → subscription → ledger → telegram-grant-access (с parent keys)
```

- Сохранить результат: `const ledgerResult = await writeLedgerEntry(...)` → получить `execution_key`
- **Idempotent skip guard**: если `ledgerResult.execution_key === null` (idempotent skip) → не передавать `_from_primary_path: true`, либо дочитать:
  ```ts
  const existing = await supabase.from('access_grant_ledger')
    .select('execution_key').eq('source_event_key', sourceEventKey).single();
  ```
- При вызове telegram-grant-access добавить:
  ```ts
  parent_event_key: sourceEventKey,
  parent_execution_key: ledgerResult.execution_key || existing?.execution_key,
  _from_primary_path: true
  ```

### Шаг 4. subscription-charge/index.ts (trial_expire branch)

**Изменить порядок:**

```
Было:  telegram-revoke-access (line 2155) → executeRevoke (line 2162)
Будет: executeRevoke → telegram-revoke-access (с parent keys)
```

- `const revokeResult = await executeRevoke(...)` → получить `executionKey`
- Idempotent skip guard: если `revokeResult.executionKey === null` → передать parent keys как NULL
- При вызове telegram-revoke-access добавить `parent_event_key`, `parent_execution_key`

### Шаг 5. subscriptions-reconcile/index.ts

4 блока executeRevoke + downstream telegram-revoke-access:

В каждом блоке:

- `revokeResult` уже содержит `executionKey`
- При вызове telegram-revoke-access добавить:
  ```ts
  parent_event_key: revokeCtx.sourceEventKey,
  parent_execution_key: revokeResult.executionKey || null,
  ```
- Не ставить `_from_primary_path = true` для revoke — telegram-revoke-access уже сам пишет ledger

### Шаг 6. subscription-admin-actions/index.ts

**Критическое изменение: ликвидация двойной записи.**

Перенести ledger write из общего post-switch block (lines 1117-1205) внутрь каждого case:

- **cancel** (line 676-703): добавить ledger write после DB update. Нет downstream telegram call → parent propagation не нужен.
- **revoke_access** (line 852-933): ledger write после DB update + branch audit, ДО telegram-revoke-access call. Передать parent keys.
- **delete** (line 936-1010): ledger write после DB update + branch audit, ДО telegram-revoke-access call. Передать parent keys.
- **refund+revoke** (line 469-519): ledger write уже inline. Переместить ДО telegram-revoke-access (line 485). Передать parent keys.

**Удалить** общий post-switch block (lines 1117-1205) после переноса логики в cases.

Idempotent skip guard: если executeRevoke вернул `executionKey = null`:

```ts
// Не передавать _from_primary_path = true
// downstream получит parent_event_key = null → graceful NULL
```

---

## Правила

### Idempotent skip contract

```
if (ledgerResult.execution_key === null) {
  // idempotent_skip case
  // Option A: не вызывать downstream повторно
  // Option B: дочитать existing row по source_event_key → взять execution_key
  // Option C: вызвать downstream без _from_primary_path → parent keys NULL
}
```

Выбрано: **Option C** для revoke paths (downstream уже пишет свою ledger row), **Option B** для grant paths (grant-access-for-order → telegram-grant-access).

### Порядок операций (жёсткое правило)

```
1. Все primary DB-изменения (projections)
2. Ledger write (получаем execution_key)
3. Downstream call (с parent keys)
```

### One ledger row per final outcome

- telegram-grant-access: одна row на весь request
- telegram-revoke-access: одна row на итоговый результат (уже реализовано Sub-patch A)

---

## Файлы


| Действие     | Файл                                                         |
| ------------ | ------------------------------------------------------------ |
| DDL миграция | `telegram_access_queue` — добавить `meta JSONB`              |
| Изменить     | `supabase/functions/telegram-grant-access/index.ts`          |
| Изменить     | `supabase/functions/telegram-process-access-queue/index.ts`  |
| Изменить     | `supabase/functions/grant-access-for-order/index.ts`         |
| Изменить     | `supabase/functions/subscription-charge/index.ts`            |
| Изменить     | `supabase/functions/subscriptions-reconcile/index.ts`        |
| Изменить     | `supabase/functions/subscription-admin-actions/index.ts`     |
| Создать      | `.lovable/proofs/p0_downstream_parent_propagation_proof.txt` |
| Обновить     | `.lovable/proofs/p0_ledger_contract_validation_proof.txt`    |
| Обновить     | `.lovable/proofs/p0_ledger_runtime_smoke_proof.txt`          |


## Что НЕ изменяется

- `_shared/fulfillment-executor.ts` — заморожен
- `_shared/access-revoker.ts` — заморожен
- Batch/import tree — Sub-patch C
- UI
- Существующая бизнес-логика (audit_logs, telegram ban/unban, GC sync)

## STOP-guards

1. writeLedgerEntry / executeRevoke API изменился → STOP
2. Downstream ломает старые вызовы без parent keys → STOP
3. Нужно менять frozen helpers → STOP
4. Патч лезет в batch/import → STOP
5. execution_key = null при idempotent skip не обработан → STOP
6. Общий post-switch ledger block остался рядом с inline ledger writes → STOP (двойная запись)

## DoD

1. telegram-grant-access: принимает parent keys, пишет ledger (grant/skip/failed)
2. telegram-process-access-queue: читает meta из queue row, пробрасывает lineage
3. grant-access-for-order: ledger ДО downstream, передаёт parent keys
4. subscription-charge: ledger ДО downstream, передаёт parent keys
5. subscriptions-reconcile: передаёт parent keys в 4 downstream вызова
6. subscription-admin-actions: ledger внутри cases, без двойной записи, parent keys в downstream
7. Backward compatibility сохранена
8. DDL миграция для queue meta
9. Proof файл с 3 состояниями + single-row parent match SQL
10. phase1_ledger_cutover_at = NOT SET

```
wrapped_in_code = yes (Sub-patch B)
runtime_verified = deferred (runtime_deferred_non_blocking)
cutover_allowed = no
SAFE_TO_CONTINUE_IMPLEMENTATION = YES
CUTOVER_ALLOWED = NO
```

## ОТЛОЖЕНО НА ПОСЛЕ СПРИНТА

- Runtime smoke 9 revoke paths (Sub-patch A)
- Runtime smoke parent propagation paths (Sub-patch B)
- Parent propagation runtime verification
- Batch/import runtime verification (Sub-patch C)
- Coverage finalization
- Cutover decision + phase1_ledger_cutover_at