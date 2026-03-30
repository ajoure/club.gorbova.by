# да, согласен, с учетом правок:

&nbsp;

1. **Убери все OR/неопределённость из discriminator-правил и зафиксируй один точный источник для каждого path.**
  Формулировки вида accessGrantId или auditLogId потом снова вызовут новую волну правок.
  Нужна одна жёсткая таблица:
  &nbsp;
  - telegram-revoke-access manual/admin → только auditLogId
  - telegram-revoke-access downstream/system path → только accessGrantId или только telegram_[access.id](http://access.id)
    Но выбрать надо **один** конкретный id на каждую ветку и больше не оставлять альтернатив.
  &nbsp;
2. **Для telegram-check-expired и telegram-kick-violators зафиксируй единый подход к skip-веткам.**
  Сейчас в плане revoke идёт через executeRevoke, а skip местами через writeLedgerEntry.
  Нужно прямо закрепить одно правило:
  &nbsp;
  - либо executeRevoke используется только там, где helper сам принимает решение revoke/skip;
  - либо если решение уже принято снаружи, то skip пишется напрямую через writeLedgerEntry.
    Это надо прописать явно, чтобы потом не появилось ещё 5 уточнений по “почему тут helper, а тут нет”.
  &nbsp;
3. **Для subscription-admin-actions добавь жёсткий pre-state snapshot guard.**
  Не просто “если already canceled → skip”, а:
  &nbsp;
  - до ветки читается before_status, before_access_end_at, before_canceled_at
  - после действия сравнивается, был ли реальный projection change
    И именно от этого зависит revoked vs skipped.
    Иначе в delete/refund+revoke потом снова всплывут спорные кейсы.
  &nbsp;
4. **cancel-trial deferred-ветку пометь как intentional non-revoke event в proof.**
  Иначе позже её снова попытаются “починить” до revoke.
  Прямо добавь в план и proof:
  &nbsp;
  - deferred branch = skip
  - projection unchanged by design
  - future revoke expected from cron path later
  &nbsp;
5. **subscription-charge:failed_revoke закрепи как отдельный один конкретный branch-name в proof и inventory.**
  Не просто “failed_revoke”, а один канонический ярлык, например:
  &nbsp;
  - subscription-charge:trial_ended_no_payment
    Это снимет будущую путаницу между:
  - real payment failure
  - end-of-trial without payment
  - generic failed charge retry
  &nbsp;
6. **В telegram-revoke-access добавь явное правило “one ledger row per final outcome”.**
  Потому что там есть blocked/no-linked/ban-failed/successful-revoke ветки.
  Нужно прямо запретить multiple ledger rows на один request в рамках Sub-patch A, кроме случаев, где это уже отдельные item-level операции по циклу.
7. **В proof сразу раздели статусы на wrapped_in_code и runtime_deferred_non_blocking.**
  Не просто runtime_verified = deferred, а отдельная пометка, что deferred не блокирует продолжение спринта по новым правилам.
  Это согласуется с твоим новым правилом длинных спринтов.
8. **Добавь в конец плана обязательный блок ОТЛОЖЕНО НА ПОСЛЕ СПРИНТА и туда перенеси runtime этих 9 paths как один consolidated follow-up.**
  Не разрозненно, а одним пакетом:
  &nbsp;
  - runtime smoke 9 revoke paths
  - parent propagation runtime
  - batch/import runtime
  - coverage finalization
  - cutover decision
  &nbsp;

&nbsp;

&nbsp;

После этих уточнений план можно считать frozen для **Sub-patch A**.

&nbsp;

План: PATCH v22.6 Sub-patch A — Standalone Revoke Wrappers (FROZEN)

## Статус

```
SAFE_TO_CONTINUE_IMPLEMENTATION = YES
CUTOVER_ALLOWED = NO
```

## Scope: 9 paths, 2 класса

### Standalone revoke functions (4 файла)

1. `telegram-revoke-access`
2. `telegram-check-expired`
3. `telegram-kick-violators`
4. `cancel-trial`

### Embedded revoke branches (2 файла, 5 branches)

5. `subscription-charge:failed_revoke`
6. `subscription-admin-actions:cancel`
7. `subscription-admin-actions:revoke_access`
8. `subscription-admin-actions:delete`
9. `subscription-admin-actions:refund+revoke`

### Явно исключено

- `subscription-admin-actions:grant_access / extend / set_end_date` → не в этом патче
- `subscription-admin-actions:refund+reduce` = `excluded_from_v22_6_scope`
- `pause / resume / toggle_auto_renew` → вне ledger scope Phase 1

### Вне scope Sub-patch A

- Downstream lineage и parent propagation → Sub-patch B
- Batch/import tree → Sub-patch C

---

## Ключевые правила

### 1. executeRevoke vs writeLedgerEntry

**executeRevoke (через AccessRevoker)** — для всех 9 paths, т.к. все они принимают revoke-decision и должны проверять active-source:

- `telegram-revoke-access`
- `telegram-check-expired`
- `telegram-kick-violators`
- `cancel-trial` (immediate ветка)
- `subscription-charge:failed_revoke`
- `subscription-admin-actions:{cancel|revoke_access|delete|refund+revoke}`

**writeLedgerEntry напрямую** — только для `cancel-trial` skip-ветки (deferred cancel, нет revoke decision).

### 2. source_event_key: детерминированный событийный discriminator


| Path                              | source_event_key pattern                                     | Discriminator source                                                                                      |
| --------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| telegram-revoke-access            | `tg-revoke:{userId}:{clubId}:{accessGrantId или auditLogId}` | Создаётся audit запись → берём её id. Если вызов из downstream — accessGrantId из telegram_access_grants. |
| telegram-check-expired            | `cron-expire:{jobRunId}:{accessId}`                          | `accessId` = `telegram_access.id` записи, `jobRunId` = crypto.randomUUID() один на весь cron run          |
| telegram-kick-violators           | `cron-kick:{jobRunId}:{memberId}`                            | `memberId` = `telegram_club_members.id`, `jobRunId` = crypto.randomUUID() один на весь cron run           |
| cancel-trial (immediate)          | `trial-cancel:{subscriptionId}:{auditLogId}`                 | audit_logs.id из записи trial_canceled                                                                    |
| cancel-trial (deferred)           | `trial-cancel-defer:{subscriptionId}:{auditLogId}`           | audit_logs.id из записи trial_canceled                                                                    |
| subscription-charge:failed_revoke | `sub-trial-expire:{subId}:{chargeRunId}`                     | `chargeRunId` = jobRunId текущего charge run                                                              |
| admin:cancel                      | `admin-cancel:{subId}:{auditLogId}`                          | audit_logs.id записываемого лога                                                                          |
| admin:revoke_access               | `admin-revoke:{subId}:{auditLogId}`                          | audit_logs.id                                                                                             |
| admin:delete                      | `admin-delete:{subId}:{auditLogId}`                          | audit_logs.id                                                                                             |
| admin:refund+revoke               | `admin-refund-revoke:{subId}:{auditLogId}`                   | audit_logs.id                                                                                             |


**Правило:** audit_log insert делается ДО ledger write, чтобы получить id для discriminator. Для cron paths — один `jobRunId = crypto.randomUUID()` на весь run.

### 3. telegram-revoke-access: динамические поля по ветке вызова

Не хардкодить одно значение. Вычислять из body/контекста:


| Поле                 | Если `is_manual=true` / admin_id | Если system/cron call   | Если downstream (из queue/reconcile) |
| -------------------- | -------------------------------- | ----------------------- | ------------------------------------ |
| source_event_type    | `admin`                          | `system`                | из body или `system`                 |
| source_subject_type  | `admin_action`                   | `cron_job` или `system` | из body или `subscription`           |
| reason_code          | `admin_revoke`                   | из body.reason mapping  | из body или `subscription_expired`   |
| reconcile_basis      | `admin_manual_revoke`            | из body.reason          | из body                              |
| parent_event_key     | NULL                             | NULL                    | из body (Sub-patch B)                |
| parent_execution_key | NULL                             | NULL                    | из body (Sub-patch B)                |


**В Sub-patch A** parent_* всегда NULL (propagation = Sub-patch B). Функция читает parent_event_key/parent_execution_key из body, но в Sub-patch A callers их не передают → graceful NULL.

### 4. subscription-charge:failed_revoke — конкретный бизнес-сценарий

Развести по reason:

- Если trial закончился без auto_charge и access_end_at < now → `reason_code = 'trial_expired'`, `reconcile_basis = 'trial_ended_no_payment'`
- Не использовать generic `payment_failed` — это другой сценарий (был реальный неуспешный платёж).

### 5. cancel-trial: machine-rule по projection

```
keep_access_until_trial_end = true  → ТОЛЬКО skip (writeLedgerEntry, action_type='skip', status='skipped', reason_code='trial_expired')
keep_access_until_trial_end = false → ТОЛЬКО revoke (executeRevoke, action_type='revoke', status='revoked', reason_code='trial_expired')
Любое иное поведение = STOP
```

### 6. subscription-admin-actions: guard "no projection change → skip"

Перед ledger write проверить: реально ли ветка изменила projection.

- Если subscription уже `status='canceled'` до входа в ветку cancel/revoke_access/delete → `action_type='skip'`, `status='skipped'`, `reason_code` по ветке
- Если projection реально изменилась → `action_type='revoke'`, `status='revoked'`

---

## Реализация по файлам

### cancel-trial/index.ts

1. Добавить `import { executeRevoke } from '../_shared/access-revoker.ts'` и `import { writeLedgerEntry } from '../_shared/fulfillment-executor.ts'`
2. Сдвинуть audit_logs.insert ПЕРЕД ledger write (чтобы получить auditLogId)
3. После update subscriptions_v2:
  - Если `keep_access_until_trial_end = false` → `executeRevoke(supabase, { ... reason_code: 'trial_expired', reconcile_basis: 'trial_cancel_immediate', sourceEventKey: 'trial-cancel:{subId}:{auditLogId}', targetType: 'subscription_tier', ... })`
  - Если `keep_access_until_trial_end = true` → `writeLedgerEntry(supabase, { action_type: 'skip', status: 'skipped', reason_code: 'trial_expired', sourceEventKey: 'trial-cancel-defer:{subId}:{auditLogId}', ... })`
4. Не менять бизнес-логику (GC sync, existing audit_logs pattern остаётся)

### telegram-revoke-access/index.ts

1. Добавить `import { executeRevoke } from '../_shared/access-revoker.ts'`
2. В конце основного flow (после ban/update/audit), одна ledger row на итоговый бизнес-результат:
  - Вычислить source_event_type / source_subject_type / reason_code по is_manual/admin_id/reason
  - Для discriminator: использовать id из уже записанного `telegram_access_audit` insert (logAudit)
  - `executeRevoke(supabase, { sourceEventKey: 'tg-revoke:{userId}:{clubId}:{auditId}', targetType: 'club', targetKey: clubId, ... })`
3. Для blocked revoke path (line 273) — `writeLedgerEntry` с `action_type='skip'`
4. Для no-telegram-linked path (line 413) — тоже одна ledger row
5. Читать `parent_event_key` / `parent_execution_key` из body → записывать в ledger (nullable, backward compat)

### telegram-check-expired/index.ts

1. Добавить `import { executeRevoke } from '../_shared/access-revoker.ts'`
2. Сгенерировать `jobRunId = crypto.randomUUID()` в начале handler
3. Для каждого revoked access (line 121): `executeRevoke(supabase, { sourceEventKey: 'cron-expire:{jobRunId}:{access.id}', targetType: 'club', reason_code: 'cron_cleanup', reconcile_basis: 'access_expired', ... })`
4. Для каждого skipped (valid access, line 102): `writeLedgerEntry` с `action_type='skip'`

### telegram-kick-violators/index.ts

1. Добавить `import { executeRevoke } from '../_shared/access-revoker.ts'`
2. Сгенерировать `jobRunId = crypto.randomUUID()` в начале handler
3. Для каждого kicked violator: `executeRevoke(supabase, { sourceEventKey: 'cron-kick:{jobRunId}:{violator.id}', targetType: 'club', reason_code: 'violation_kick', reconcile_basis: 'no_valid_access', ... })`
4. Для skipped (has valid access): `writeLedgerEntry` с `action_type='skip'`

### subscription-charge/index.ts (failed_revoke branch only)

1. Перед `supabase.functions.invoke('telegram-revoke-access', ...)` на line 2153:
  - `executeRevoke(supabase, { sourceEventKey: 'sub-trial-expire:{sub.id}:{chargeRunId}', targetType: 'subscription_tier', reason_code: 'trial_expired', reconcile_basis: 'trial_ended_no_payment', ... })`
2. `chargeRunId` — уже существующий run identifier (или сгенерировать один на весь job)

### subscription-admin-actions/index.ts (4 revoke branches)

1. Добавить `import { executeRevoke } from '../_shared/access-revoker.ts'`
2. Для discriminator: сдвинуть audit_logs.insert (line 1024) ПЕРЕД switch-case ledger writes, или делать отдельный insert внутри каждой ветки и сохранять id.
3. Guard: проверить `subscription.status` перед ledger write. Если уже `canceled` → skip.
4. Для каждой ветки:
  - `cancel` → `executeRevoke({ sourceEventKey: 'admin-cancel:{subId}:{auditLogId}', reason_code: 'admin_cancel', targetType: 'subscription_tier', reconcile_basis: 'admin_cancel' })`
  - `revoke_access` → `executeRevoke({ sourceEventKey: 'admin-revoke:{subId}:{auditLogId}', reason_code: 'admin_revoke', targetType: 'subscription_tier', reconcile_basis: 'admin_revoke_access' })`
  - `delete` → `executeRevoke({ sourceEventKey: 'admin-delete:{subId}:{auditLogId}', reason_code: 'admin_revoke', targetType: 'subscription_tier', reconcile_basis: 'admin_delete' })`
  - `refund+revoke` → `executeRevoke({ sourceEventKey: 'admin-refund-revoke:{subId}:{auditLogId}', reason_code: 'admin_revoke', targetType: 'subscription_tier', reconcile_basis: 'admin_refund_revoke' })`

---

## Proof файлы

### Создать: `p0_revoke_wrapper_completion_proof.txt`

Таблица:


| #   | path                   | wrapped_in_code | runtime_verified | source_event_key pattern              | target_type | reason_code | status mapping  | uses_executeRevoke | notes                            |
| --- | ---------------------- | --------------- | ---------------- | ------------------------------------- | ----------- | ----------- | --------------- | ------------------ | -------------------------------- |
| 1   | telegram-revoke-access | yes             | deferred         | tg-revoke:{userId}:{clubId}:{auditId} | club        | dynamic     | revoked/skipped | yes                | dynamic fields by caller context |
| ... | ...                    | ...             | ...              | ...                                   | ...         | ...         | ...             | ...                | ...                              |


### Обновить: `p0_revoke_path_inventory.txt`

Четыре статуса: `pending` → `wrapped_in_code` → `runtime_verified` → `excluded_from_scope`

### Обновить: `p0_ledger_runtime_smoke_proof.txt`

Добавить decision block:

```
Decision: BLOCKED_SAFE_GUARD on subscription-charge is ACCEPTED as non-blocking for implementation.
Remains blocking for final cutover.
```

---

## ОТЛОЖЕНО НА ПОСЛЕ СПРИНТА

- Runtime smoke для всех 9 новых paths
- Coverage proof gaps
- Parent propagation runtime check (Sub-patch B)
- Batch/import runtime verification (Sub-patch C)
- `phase1_ledger_cutover_at` marker

---

## Файлы


| Действие | Файл                                                     |
| -------- | -------------------------------------------------------- |
| Изменить | `supabase/functions/cancel-trial/index.ts`               |
| Изменить | `supabase/functions/telegram-revoke-access/index.ts`     |
| Изменить | `supabase/functions/telegram-check-expired/index.ts`     |
| Изменить | `supabase/functions/telegram-kick-violators/index.ts`    |
| Изменить | `supabase/functions/subscription-charge/index.ts`        |
| Изменить | `supabase/functions/subscription-admin-actions/index.ts` |
| Создать  | `.lovable/proofs/p0_revoke_wrapper_completion_proof.txt` |
| Обновить | `.lovable/proofs/p0_revoke_path_inventory.txt`           |
| Обновить | `.lovable/proofs/p0_ledger_runtime_smoke_proof.txt`      |


## Что НЕ изменяется

- `_shared/fulfillment-executor.ts` — контракт заморожен
- `_shared/access-revoker.ts` — контракт заморожен
- Существующая бизнес-логика (audit_logs, telegram_logs, GC sync, ban/unban)
- grant/extend ветки subscription-admin-actions
- Parent propagation (Sub-patch B)
- UI компоненты

## STOP-guards

1. writeLedgerEntry / executeRevoke API изменился → STOP
2. cancel-trial пишет revoke при `keep_access_until_trial_end = true` → STOP
3. cancel-trial пишет skip при `keep_access_until_trial_end = false` → STOP
4. subscription-admin-actions пишет revoked для уже canceled subscription → STOP
5. source_event_key содержит timestamp или random (кроме jobRunId) → STOP
6. telegram-revoke-access хардкодит reason_code/source_subject_type одним значением → STOP

## DoD Sub-patch A

Все 9 paths wrapped_in_code:

1. telegram-revoke-access — wrapped (executeRevoke, dynamic fields)
2. telegram-check-expired — wrapped (executeRevoke)
3. telegram-kick-violators — wrapped (executeRevoke)
4. cancel-trial — wrapped (executeRevoke для immediate, writeLedgerEntry для deferred)
5. subscription-charge:failed_revoke — wrapped (executeRevoke)
6. subscription-admin-actions:cancel — wrapped (executeRevoke + no-change guard)
7. subscription-admin-actions:revoke_access — wrapped (executeRevoke + no-change guard)
8. subscription-admin-actions:delete — wrapped (executeRevoke + no-change guard)
9. subscription-admin-actions:refund+revoke — wrapped (executeRevoke + no-change guard)

Proof:

- `p0_revoke_wrapper_completion_proof.txt` создан с полной таблицей (wrapped_in_code + runtime_verified колонки)
- `p0_revoke_path_inventory.txt` обновлён (четыре статуса)
- `p0_ledger_runtime_smoke_proof.txt` обновлён с decision block

```
wrapped_in_code = yes (9/9)
runtime_verified = deferred
cutover_allowed = no
SAFE_TO_CONTINUE_IMPLEMENTATION = YES
CUTOVER_ALLOWED = NO
```