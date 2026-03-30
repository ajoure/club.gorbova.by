# да, согласен, с учетом правок:

&nbsp;

1. **Явно передай batch-context в helper-ветки, без скрытого доступа к body.**
  Для getcourse-import-deals зафиксируй, что processFileDeals(...) получает параметрами:
  &nbsp;
  - batchId
  - batchSourceEventKey
  - batchStartResult
  - batchMode
  - sourceEventType
  &nbsp;
  Нельзя оставлять неявное использование body.batch_mode или генерировать batch_start внутри и снаружи одновременно. Один вход — один batch_start.
2. **Во всех row-level ledger rows заполняй не только source_subject_ref, но и все уже известные бизнес-FK.**
  Где данные уже известны, обязательно писать:
  &nbsp;
  - order_id / source_order_id
  - source_subscription_id
  - source_offer_id
  - profile_id
  - user_id
  &nbsp;
  Это добавить и в success rows, и в skip rows, и в failed rows, если к моменту записи эти сущности уже созданы/известны. Не ограничиваться только source_subject_ref.
3. **Downstream telegram-grant-access в file-import ветке только после успешной row-level ledger row.**
  Явно зафиксируй:
  &nbsp;
  - downstream call допустим только для grant/granted row
  - для skip/skipped и grant/failed downstream не вызывать
  - если rowLedgerResult.execution_key = null, сначала попытаться дочитать existing row по source_event_key; только если не удалось — вызывать без *from*primary_path
  &nbsp;
4. **Для dryRun добавь отдельный машинный check в proof по обоим import paths.**
  Не просто текстом “dryRun не пишет ledger”, а отдельной проверкой:
  &nbsp;
  - before count
  - dryRun invocation
  - after count
  - diff = 0
  &nbsp;
  Это нужно и для bepaid-report-import, и для getcourse-import-deals в том режиме, где dryRun поддерживается.
5. **В proof закрепи строгую развязку batch/meta и row/access rows.**
  В p0_batch_import_tree_proof.txt и p0_ledger_path_coverage_proof.txt явно зафиксируй:
  &nbsp;
  - target_type='batch' существует только у batch_start
  - row-level rows никогда не используют target_type='batch'
  - Section A = только row-level access rows
  - Section B = только batch/meta rows
  &nbsp;

&nbsp;

&nbsp;

После внесения этих правок следующий проход — только сверка внесения, без новых замечаний, если не появятся новые факты из кода или базы.

&nbsp;

План: PATCH v22.6 Sub-patch C — Batch/Import Tree (с 12 уточнениями)

## Статус

```
SAFE_TO_CONTINUE_IMPLEMENTATION = YES
CUTOVER_ALLOWED = NO
```

## Диагностика

### Верификация helper contract (fulfillment-executor.ts — frozen, read-only)


| Требование                                            | Поддержка                       | Строки  |
| ----------------------------------------------------- | ------------------------------- | ------- |
| `chk_has_subject` — хотя бы один subject ref NOT NULL | ✅ `source_subject_ref` допустим | 204-214 |
| `batch_start` → `target_type='batch'`                 | ✅ `chk_batch_row_contract`      | 216-219 |
| `target_type = 'subscription_tier'`                   | ✅ в `VALID_TARGET_TYPES`        | 62-65   |
| `target_type = 'product'`                             | ✅                               | 62-65   |
| `reason_code = 'duplicate_skip'`                      | ✅                               | 67-73   |
| `reason_code = 'no_matching_target'`                  | ✅                               | 67-73   |
| `reason_code = 'bulk_import'`                         | ✅                               | 67-73   |
| `source_event_type = 'admin' / 'system'`              | ✅                               | 45      |
| `source_subject_type = 'import_batch'`                | ✅                               | 43      |
| idempotent skip → `execution_key = null`              | ✅                               | 271-274 |


Helper менять **не нужно**. Все типы уже поддержаны.

### Текущее состояние файлов


| Файл                     | Строк | Ledger | dryRun         | Downstream TG            |
| ------------------------ | ----- | ------ | -------------- | ------------------------ |
| `bepaid-report-import`   | 785   | ❌      | ✅ (line 315)   | ❌                        |
| `getcourse-import-deals` | 1139  | ❌      | ❌ (нет dryRun) | ✅ file import (line 880) |


---

## 12 уточнений — как закрыты

1. `**chk_has_subject` для batch_start**: `source_subject_ref = batchId`
2. `**chk_has_subject` для row-level**: `source_subject_ref = payment.uid` / `gcDealId` / fallback hash
3. `**target_type` для row-level**: `subscription_tier` если subscription создана, `product` если только order
4. **skip/failed reason_code + result**: `duplicate_skip`, `no_matching_target`, `failed` с `failed_at_step` + `error_message`
5. **getcourse downstream parent propagation idempotent guard**: если `execution_key = null` → не ставить `_from_primary_path`
6. **Fallback hash**: `sha256(JSON.stringify(sorted_keys_payload))`, единый для обоих imports
7. **Per-row failed ledger в catch**: каждая строка в try/catch, в catch — ledger row со status='failed'
8. **batch_start source_event_type по origin**: file/admin UI → `'admin'`, API/scheduled → `'system'`
9. **dryRun = no-ledger machine-check в proof**
10. **p0_ledger_path_coverage_proof: Section A (access) vs Section B (batch/meta)**
11. **p0_revoke_path_inventory: только sprint-status, не основной proof**
12. **Volume guard до batch_start**: count → guard → batch_start → rows

---

## Реализация

### Общая utility: deterministic fallback hash

Добавить в начало каждого import файла (не в shared helper):

```ts
async function stableRowHash(payload: Record<string, unknown>): Promise<string> {
  const sorted = JSON.stringify(
    Object.keys(payload).sort().reduce((acc, k) => { acc[k] = payload[k]; return acc; }, {} as Record<string, unknown>)
  );
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sorted));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
```

Одинаковая реализация в обоих файлах. Без timestamp, без random.

### Файл 1: `bepaid-report-import/index.ts`

**Import:**

```ts
import { writeLedgerEntry } from '../_shared/fulfillment-executor.ts';
```

**Порядок (после parse, перед циклом):**

1. Count payments
2. **Volume guard** (ДО batch_start): `if (payments.length > 1000 && !body.batch_mode) → return 400`
3. Пропуск ledger при `dryRun = true`
4. **batch_start row** (только `!dryRun`):
  ```ts
   const batchId = crypto.randomUUID();
   const batchSourceEventKey = `bepaid-import-batch:${batchId}`;
   const batchStartResult = await writeLedgerEntry(supabase, {
     source_event_type: 'admin',  // file upload from admin UI
     source_event_key: batchSourceEventKey,
     source_subject_type: 'import_batch',
     source_subject_ref: batchId,  // ← chk_has_subject
     action_type: 'batch_start',
     reason_code: 'batch_orchestration',
     target_type: 'batch',
     target_key: `bepaid-import:${batchId}`,
     status: 'completed',
     result: { batch_size: payments.length, import_type: 'bepaid_report', mode: 'execute', started_at: new Date().toISOString() },
   });
  ```

**Row-level ledger (внутри цикла, в try/catch):**

Source event key:

- Primary: `bepaid-import:${batchId}:row:${payment.uid}`
- Fallback (нет uid): `bepaid-import:${batchId}:row:${index}:${await stableRowHash(payment)}`

**target_type resolution:**

- Если subscription создана (tariffId exists) → `target_type: 'subscription_tier'`, `target_key: '{userId}:{tariffId}'`
- Если только order (no tariff) → `target_type: 'product'`, `target_key: '{userId}:{productId}'`

**Outcome mapping:**


| Outcome                                   | action_type | status  | reason_code        | result extras                       |
| ----------------------------------------- | ----------- | ------- | ------------------ | ----------------------------------- |
| order_created / profile_and_order_created | grant       | granted | bulk_import        | —                                   |
| order_exists (duplicate)                  | skip        | skipped | duplicate_skip     | —                                   |
| skipped_no_user_id                        | skip        | skipped | no_matching_target | —                                   |
| catch error                               | grant       | failed  | bulk_import        | `{ failed_at_step, error_message }` |


Parent lineage для всех row-level:

```ts
parent_event_key: batchSourceEventKey,
parent_execution_key: batchStartResult.execution_key,
```

**Per-row catch block** — обязательная ledger row:

```ts
catch (err) {
  const errorMessage = err instanceof Error ? err.message : String(err);
  const rowKey = payment.uid
    ? `bepaid-import:${batchId}:row:${payment.uid}`
    : `bepaid-import:${batchId}:row:${index}:${await stableRowHash(payment)}`;
  await writeLedgerEntry(supabase, {
    source_event_type: 'admin',
    source_event_key: rowKey,
    source_subject_type: 'import_batch',
    source_subject_ref: payment.uid || `row:${index}`,
    action_type: 'grant',
    status: 'failed',
    reason_code: 'bulk_import',
    target_type: 'product',
    target_key: `${userId || 'unknown'}:${productId}`,
    result: { failed_at_step: 'row_processing', error_message: errorMessage },
    parent_event_key: batchSourceEventKey,
    parent_execution_key: batchStartResult?.execution_key || null,
  });
  // existing error handling continues
}
```

**Rate limiting**: каждые 200 строк → `await new Promise(r => setTimeout(r, 100))`

### Файл 2: `getcourse-import-deals/index.ts`

**Import:**

```ts
import { writeLedgerEntry } from '../_shared/fulfillment-executor.ts';
```

Две ветки: file import (`processFileDeals`) и API import (main loop).

#### A. File import (`processFileDeals`, line 765-907)

1. **Volume guard** (до batch_start): `if (deals.length > 1000 && !body.batch_mode) → return 400`
2. **batch_start**:
  ```ts
   const batchId = crypto.randomUUID();
   const batchSourceEventKey = `gc-import-batch:${batchId}`;
   const batchStartResult = await writeLedgerEntry(supabase, {
     source_event_type: 'admin',  // file upload from admin UI
     source_event_key: batchSourceEventKey,
     source_subject_type: 'import_batch',
     source_subject_ref: batchId,
     action_type: 'batch_start',
     reason_code: 'batch_orchestration',
     target_type: 'batch',
     target_key: `gc-import:${batchId}`,
     status: 'completed',
     result: { batch_size: deals.length, import_type: 'getcourse_file', mode: 'execute', started_at: new Date().toISOString() },
   });
  ```
3. **Row-level** в each deal try/catch:
  - Primary key: `gc-import:${batchId}:row:${deal.externalId}`
  - Fallback: `gc-import:${batchId}:row:${index}:${await stableRowHash(deal)}`
  - `source_subject_ref`: `deal.externalId || fallback`
   **target_type:**
  - tariffId && subscription created → `subscription_tier`, `{userId}:{tariffId}`
  - только order → `product`, `{userId}:{productId}`
  - archive deal (no tariff) → `product`, `{userId}:archive`
   **Outcome mapping:**

  | Outcome                            | action_type | status  | reason_code                                       |
  | ---------------------------------- | ----------- | ------- | ------------------------------------------------- |
  | order+subscription created         | grant       | granted | bulk_import                                       |
  | order created, archive (no tariff) | grant       | granted | bulk_import                                       |
  | order skipped (exists)             | skip        | skipped | duplicate_skip                                    |
  | tariff unknown + skip              | skip        | skipped | no_matching_target                                |
  | catch error                        | grant       | failed  | bulk_import + `{ failed_at_step, error_message }` |

4. **Downstream telegram-grant-access** (line 880) — parent propagation с idempotent guard:
  ```ts
   const rowLedgerResult = await writeLedgerEntry(...);
   // downstream only if subscription active + product has telegram_club_id
   if (rowLedgerResult?.execution_key) {
     await supabase.functions.invoke('telegram-grant-access', {
       body: {
         user_id: userIdForRecords,
         club_id: product.telegram_club_id,
         valid_until: subscription.accessEndAt,
         source: 'import',
         parent_event_key: rowSourceEventKey,
         parent_execution_key: rowLedgerResult.execution_key,
         _from_primary_path: true,
       },
     });
   } else {
     // idempotent skip or null execution_key → call without _from_primary_path
     await supabase.functions.invoke('telegram-grant-access', {
       body: {
         user_id: userIdForRecords,
         club_id: product.telegram_club_id,
         valid_until: subscription.accessEndAt,
         source: 'import',
       },
     });
   }
  ```

#### B. API import (main loop, line 1058-1105)

Аналогично file import:

1. Volume guard
2. batch_start с `source_event_type: 'system'` (API/scheduled origin)
3. Row-level: `gc-import:${batchId}:row:${deal.id}`
4. Нет downstream telegram call в API mode

**Per-row catch** в обоих режимах: обязательная failed ledger row с `failed_at_step` + `error_message`.

---

## Правила

### Volume guard порядок (жёсткий)

```
1. Parse/count rows
2. Volume guard: if rows > 1000 && !batch_mode → return 400 (ДО batch_start)
3. batch_start ledger row
4. Row-level processing
```

### dryRun = no ledger

- `dryRun = true` → **ноль ledger rows** (ни batch_start, ни row-level)
- Все ledger writes обёрнуты в `if (!dryRun)` guard

### Fallback hash contract

- `sha256(JSON.stringify(sorted_keys_payload)).slice(0, 16)`
- Одинаковая реализация в обоих файлах
- Без timestamp, без random в discriminator

### Sub-patch C = последний основной code patch v22.6

После него допустим только один consolidated follow-up на proof/coverage/invariant finalization без новых code-идей, если не появятся новые факты.

---

## Файлы


| Действие | Файл                                                                        |
| -------- | --------------------------------------------------------------------------- |
| Изменить | `supabase/functions/bepaid-report-import/index.ts`                          |
| Изменить | `supabase/functions/getcourse-import-deals/index.ts`                        |
| Создать  | `.lovable/proofs/p0_batch_import_tree_proof.txt`                            |
| Обновить | `.lovable/proofs/p0_ledger_path_coverage_proof.txt`                         |
| Обновить | `.lovable/proofs/p0_ledger_contract_validation_proof.txt`                   |
| Обновить | `.lovable/proofs/p0_revoke_path_inventory.txt` (только sprint-status block) |


## Proof содержание

### p0_batch_import_tree_proof.txt

1. batch_start rows: оба import type, source_subject_ref = batchId
2. row-level rows: source_subject_ref = stable external id, target_type resolution table
3. Lineage: batch_start → row → single-row parent match SQL
4. batch_start rows excluded from access-proof / target-resolution proof
5. Volume guard contract: guard BEFORE batch_start
6. Downstream propagation (gc file import → telegram-grant-access) с idempotent guard
7. **dryRun machine-check**: dryRun → 0 new ledger rows, execute → batch_start + row rows
8. skip/failed reason_code + result mapping table
9. source_event_type по origin: admin vs system
10. Fallback hash: sha256 deterministic, identical in both files

### p0_ledger_path_coverage_proof.txt (add-only)

- **Section A**: access-affecting rows (grant/skip/failed row-level)
- **Section B**: batch/meta rows (batch_start, target_type='batch')

### p0_ledger_contract_validation_proof.txt (add-only)

- Sub-patch C section: chk_has_subject verified for batch_start + row-level

### p0_revoke_path_inventory.txt (add-only)

- Только sprint-status update:
  - Sub-patch A = done
  - Sub-patch B = done in code
  - Sub-patch C = done in code
  - Sub-patch D = next (consolidated proof/coverage finalization)
  - cutover = not allowed

## Что НЕ изменяется

- `_shared/fulfillment-executor.ts` — заморожен
- `_shared/access-revoker.ts` — заморожен
- Sub-patch A/B code
- UI, DDL

## STOP-guards

1. `writeLedgerEntry` не поддерживает нужный type → STOP (проверено: поддерживает)
2. Нужно менять frozen helpers → STOP
3. Downstream telegram ломает backward compat → STOP
4. dryRun случайно пишет ledger → STOP
5. Fallback hash содержит timestamp/random → STOP
6. Volume guard после batch_start → STOP
7. Per-row catch без ledger write → STOP

## DoD

1. bepaid: batch_start + row-level ledger, source_subject_ref populated, volume guard before batch_start
2. getcourse: batch_start + row-level ledger в обоих режимах, source_event_type по origin
3. target_type per row: subscription_tier / product по бизнес-outcome
4. skip rows: reason_code = duplicate_skip / no_matching_target
5. failed rows: reason_code + result.failed_at_step + result.error_message, per-row catch
6. gc file import downstream: parent propagation с idempotent guard для execution_key = null
7. Fallback hash: sha256 deterministic, identical implementation
8. dryRun = 0 ledger rows
9. Proof файлы: path_coverage с Section A / Section B split
10. revoke_path_inventory: только sprint-status, не основной proof
11. phase1_ledger_cutover_at = NOT SET
12. Sub-patch C = последний основной code patch

```
wrapped_in_code = pending (Sub-patch C)
runtime_verified = deferred
cutover_allowed = no
SAFE_TO_CONTINUE_IMPLEMENTATION = YES
```