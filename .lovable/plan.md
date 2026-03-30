# да, согласен, с учетом правок:

&nbsp;

1. Уточни удаление в subscription-admin-actions/index.ts: удалять не “lines 1265–1355”, а **весь блок по сигнатуре**
  const revokeBranches = ['cancel', 'revoke_access', 'delete']; if (revokeBranches.includes(action)) { ... }
  чтобы не было ошибки из-за сдвига строк. При этом явно сохранить:
  &nbsp;
  - общий audit_logs insert после switch
  - pendingPhysicalDelete обработку
  - весь non-revoke код вне этого дубля
  &nbsp;
2. В subscription-charge/index.ts зафиксируй жёстко:
  &nbsp;
  - renewSourceEventKey создаётся **один раз**
  - в ledger write используется **ровно этот же** renewSourceEventKey
  - в queue.meta.parent_event_key пишется **ровно он же**, без повторной сборки строки
  &nbsp;
3. Для queue upsert добавь safeguard:
  если renewLedgerResult.execution_key отсутствует, meta не только не пишется, но и proof должен явно подтвердить, что существующий meta у conflict-row не был затёрт. То есть в proof нужен кейс:
  execution_key = null -> no meta overwrite.
4. В p0_downstream_parent_propagation_proof.txt добавь отдельную таблицу:
  &nbsp;
  - primary caller
  - downstream
  - lineage source
  - parented | autonomous
  - source_event_key reused exactly | yes/no
    Это нужно, чтобы не потерять главное требование про отсутствие drift.
  &nbsp;
5. Для telegram-club-members зафиксируй не просто “autonomous/no-parent”, а полный reason:
  &nbsp;
  - queue row создаётся без upstream ledger
  - meta = null допустимо
  - не считается orphan/missing-lineage defect
  - не блокирует Sub-patch B DoD
  &nbsp;
6. В p0_ledger_contract_validation_proof.txt добавь отдельный machine-check:
  после cleanup в subscription-admin-actions revoke-ветки имеют **только inline ledger path**, а duplicate post-switch revoke ledger path отсутствует полностью.
7. В статусном блоке proof укажи явно:
  &nbsp;
  - Sub-patch A = done
  - Sub-patch B = done in code
  - runtime verification for B = deferred
  - Sub-patch C = next
  - phase1_ledger_cutover_at = NOT SET
  &nbsp;

&nbsp;

&nbsp;

После этих правок план можно считать финальным и не пересогласовывать заново.

&nbsp;

План: PATCH v22.6 Sub-patch B — FINISH ONLY

## Диагностика

### Block A

`subscription-admin-actions/index.ts` lines 1265-1355 содержат **дублирующий post-switch ledger block** для cancel/revoke_access/delete. Все 4 ветки уже имеют inline ledger:

- cancel: lines 710-765
- revoke_access: lines 943-985
- delete: lines 1078-1114
- refund+revoke: lines 483-507

Post-switch block = дубль. Удалить lines 1265-1355 полностью.

### Block B

`subscription-charge/index.ts` line 1529: `writeLedgerEntry` не сохраняет результат. Source event key = `sub-renew:${id}:${payment.id}` (line 1531). Queue upsert на lines 1677-1685 не пишет meta.

Правка:

- Сохранить результат: `const renewLedgerResult = await writeLedgerEntry(...)`
- Извлечь `sourceEventKey` в переменную ДО вызова writeLedgerEntry
- В upsert добавить `meta` с условием: если `renewLedgerResult?.execution_key` есть → записать lineage, иначе **не перезаписывать meta на null** (использовать conditional spread или пропуск поля)

`telegram-club-members/index.ts` line 1146: autonomous enqueue (reinvite_ghosts). Нет upstream primary ledger row → meta = null by design. Не трогать. Зафиксировать в proof.

### Block C

`telegram-process-access-queue/index.ts` уже:

- Читает meta (line 36)
- Извлекает parent keys (lines 225-226, 272-273)
- Пробрасывает в grant/revoke calls
- Backward compatible (null meta → null parent keys)
**Изменения не нужны.**

### Block D

Создать/обновить proof-файлы.

---

## Реализация

### Файл 1: `subscription-admin-actions/index.ts`

**Удалить** lines 1265-1355 (весь блок `const revokeBranches = ['cancel', 'revoke_access', 'delete']; if (revokeBranches.includes(action)) { ... }`).

### Файл 2: `subscription-charge/index.ts`

1. Перед ledger write (line ~1529), извлечь source event key:

```ts
const renewSourceEventKey = `sub-renew:${id}:${payment.id}`;
```

2. Сохранить результат:

```ts
const renewLedgerResult = await writeLedgerEntry(supabase, {
  ...
  source_event_key: renewSourceEventKey,
  ...
});
```

3. В queue upsert (lines 1679-1685) добавить meta **только если lineage есть**:

```ts
.upsert({
  user_id,
  club_id: mapping.club_id,
  subscription_id: id,
  action: 'grant',
  status: 'pending',
  ...(renewLedgerResult?.execution_key ? {
    meta: {
      parent_event_key: renewSourceEventKey,
      parent_execution_key: renewLedgerResult.execution_key,
    }
  } : {}),
}, { onConflict: 'user_id,club_id,subscription_id,action' });
```

### Файл 3: `.lovable/proofs/p0_downstream_parent_propagation_proof.txt` (создать)

Содержание:

1. Primary callers → downstream table
2. Queue lineage path: writer → queue.meta → processor → downstream body
3. Два статуса: parented / autonomous
4. Branch-level table для subscription-admin-actions (inline ledger = yes, post-switch duplicate = no)
5. Single-row parent match SQL
6. telegram-club-members = autonomous/no-parent by design (reason: нет upstream primary ledger row)

### Файл 4: `.lovable/proofs/p0_ledger_contract_validation_proof.txt` (add-only update)

- Секция Sub-patch B finish
- Подтверждение: no duplicate post-switch ledger block, parent propagation wired, queue meta wired

### Файл 5: `.lovable/proofs/p0_ledger_runtime_smoke_proof.txt` (add-only update)

- Sub-patch B wrapped_in_code = yes
- runtime_verified = deferred_non_blocking
- cutover still blocked

### Файл 6: `.lovable/proofs/p0_revoke_path_inventory.txt` (add-only update)

- Sprint status: Sub-patch A = done, Sub-patch B = done, Sub-patch C = next, cutover = not allowed

---

## Machine-checks в proof

1. В `subscription-admin-actions/index.ts` после cleanup нет второго `executeRevoke`/`writeLedgerEntry` блока для revoke-веток **вне case-веток**
2. `telegram-process-access-queue` backward-compatible для rows без meta

## Файлы


| Действие | Файл                                                                                 |
| -------- | ------------------------------------------------------------------------------------ |
| Изменить | `supabase/functions/subscription-admin-actions/index.ts` (удалить post-switch block) |
| Изменить | `supabase/functions/subscription-charge/index.ts` (queue meta lineage)               |
| Создать  | `.lovable/proofs/p0_downstream_parent_propagation_proof.txt`                         |
| Обновить | `.lovable/proofs/p0_ledger_contract_validation_proof.txt`                            |
| Обновить | `.lovable/proofs/p0_ledger_runtime_smoke_proof.txt`                                  |
| Обновить | `.lovable/proofs/p0_revoke_path_inventory.txt`                                       |


## Что НЕ изменяется

- telegram-process-access-queue — уже готов
- telegram-club-members — autonomous, meta=null by design
- Frozen helpers, DDL, Sub-patch A code, UI, batch/import

## DoD

1. Post-switch ledger block удалён
2. subscription-charge queue upsert пишет lineage в meta (без drift — тот же source_event_key)
3. Meta не перезаписывается на null при отсутствии execution_key
4. telegram-club-members задокументирован как autonomous/no-parent
5. Proof создан с branch table, queue path, single-row SQL, machine-checks
6. phase1_ledger_cutover_at = NOT SET