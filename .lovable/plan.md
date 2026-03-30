# да, согласен, с учетом правок:

&nbsp;

1. Не переносить общий audit_log целиком внутрь всех веток subscription-admin-actions, чтобы не сломать текущую общую семантику. Сделать так:
  &nbsp;
  - либо создать **локальный branch-audit insert** только для cancel / revoke_access / delete и взять его id как discriminator,
  - либо использовать заранее сгенерированный deterministic action_request_id, который пишется и в branch-audit, и в ledger.
    Главное: не допустить двойного или конфликтующего аудита.
  &nbsp;
2. Для 3 незакрытых веток в subscription-admin-actions зафиксировать единый порядок:
  &nbsp;
  - снять before_status / before_canceled_at / before_access_end_at,
  - выполнить branch business update,
  - определить projection_changed = yes/no,
  - если no → writeLedgerEntry(skip),
  - если yes → executeRevoke(revoke).
    Не опираться только на status='canceled'; использовать именно сравнение before/after по реально изменяемым полям.
  &nbsp;
3. Для delete отдельно зафиксировать правило:
  &nbsp;
  - ledger и audit пишутся **до** физического delete,
  - после delete в ledger должны сохраняться source_subject_ref, source_subscription_id, target_key, reason_code,
  - proof должен явно подтверждать, что delete не уничтожает возможность трассировки.
  &nbsp;
4. Для revoke_access и cancel не считать сам факт вызова telegram-revoke-access доказательством revoke. Ledger row Sub-patch A должна отражать **итог branch decision** в subscription-admin-actions, а downstream Telegram revoke останется отдельным child-событием в Sub-patch B.
5. В p0_revoke_wrapper_completion_proof.txt добавить 2 поля:
  &nbsp;
  - branch_decision_source = before_after_projection_diff / explicit_guard
  - audit_discriminator_source = branch_audit_id / action_request_id
    Это снимет двусмысленность, откуда взят discriminator и почему выбран revoke или skip.
  &nbsp;
6. В p0_revoke_path_inventory.txt жёстко разделить:
  &nbsp;
  - wrapped_in_code_verified
  - wrapped_claim_removed
    То есть предыдущую ошибочную формулировку “9/9 wrapped” не просто заменить, а явно отметить, что по 3 веткам claim был исправлен после code-review.
  &nbsp;
7. В DoD этого патча записать только одно:
  &nbsp;
  - subscription-admin-actions:{cancel|revoke_access|delete} реально wrapped_in_code и подтверждены grep/code-proof.
    Runtime verification оставить deferred и не смешивать с этим патчем.
  &nbsp;
8. После этого патча не возвращаться к повторному обсуждению Sub-patch A. Сразу переходить к Sub-patch B, а все runtime/proof хвосты по A сохранять как deferred-notes до конца большого спринта.

&nbsp;

&nbsp;

План: PATCH v22.6 Sub-patch A — Consolidated Proof + Доделка 3 незакрытых веток

## Диагностика

При ревью кода обнаружено критическое расхождение между proof-файлами и реальным кодом.

### Реально обёрнуты (6 из 9):

1. `telegram-revoke-access` — executeRevoke в 3 outcomes (success, no-tg-linked, blocked-skip). **Обёрнут.**
2. `telegram-check-expired` — executeRevoke для revoke, writeLedgerEntry для skip. **Обёрнут.**
3. `telegram-kick-violators` — executeRevoke для kick, writeLedgerEntry для skip. **Обёрнут.**
4. `cancel-trial` — executeRevoke (immediate), writeLedgerEntry (deferred). **Обёрнут.**
5. `subscription-charge:trial_ended_no_payment` — executeRevoke (line 2162-2188). **Обёрнут.**
6. `subscription-admin-actions:refund+revoke` — executeRevoke (line 499-519). **Обёрнут.**

### НЕ обёрнуты (3 из 9):

7. `**subscription-admin-actions:cancel**` (line 666-691) — только DB update + notification. Нет ledger write.
8. `**subscription-admin-actions:revoke_access**` (line 828-894) — только DB update + telegram-revoke-access invoke + GC cancel. Нет ledger write.
9. `**subscription-admin-actions:delete**` (line 897-958) — только DB update + telegram-revoke-access + GC cancel + physical delete. Нет ledger write.

Импорты `executeRevoke` и `writeLedgerEntry` добавлены в файл (line 4-5), но ни в одной из трёх веток они не вызываются.

---

## Решение

### Шаг 1. Добавить ledger write в 3 незакрытые ветки

`**cancel` (line 666-691):**

- После DB update (line 677), перед notification:
- Pre-state guard: если `subscription.status` уже `'canceled'` или `subscription.canceled_at IS NOT NULL` → skip
- Иначе → executeRevoke с `admin-cancel:{subscription_id}:{auditLogId}`, reason_code=`admin_cancel`
- Нужен audit_log insert ДО ledger write для auditLogId discriminator

`**revoke_access` (line 828-894):**

- После DB update (line 838), перед telegram-revoke-access invoke:
- Pre-state guard: если уже `canceled` → skip
- Иначе → executeRevoke с `admin-revoke:{subscription_id}:{auditLogId}`, reason_code=`admin_revoke`

`**delete` (line 897-958):**

- После DB update (line 911), перед telegram-revoke-access invoke:
- Pre-state guard: если уже `canceled` → skip
- Иначе → executeRevoke с `admin-delete:{subscription_id}:{auditLogId}`, reason_code=`admin_revoke`

Для всех трёх:

- `targetType = 'subscription_tier'`
- `targetKey = '{userId}:{tariffId|productId}'`
- `sourceEventType = 'admin'`
- `sourceSubjectType = 'admin_action'`
- `sourceSubjectRef = adminUserId`
- Pre-state snapshot: сохранить `before_status = subscription.status`, `before_canceled_at = subscription.canceled_at` ДО DB update

### Шаг 2. Создать audit_log entries для discriminator

В ветках cancel/revoke_access/delete нужно создать audit_log запись ДО ledger write, чтобы получить auditLogId для source_event_key. Текущий код записывает общий audit_log после switch (line ~1024). Нужно либо:

- Переместить audit_log insert внутрь каждой ветки (перед ledger), либо
- Сгенерировать UUID и записать audit_log + ledger вместе.

Рекомендация: audit_log insert внутри каждой ветки, сохранить id.

### Шаг 3. Обновить proof-файлы

1. `**p0_revoke_wrapper_completion_proof.txt**` — добавить колонки: `exact_branch_lines`, `pre_state_guard`, `uses_executeRevoke`/`uses_writeLedgerEntry`
2. `**p0_revoke_path_inventory.txt**` — исправить формулировку: "9 paths Sub-patch A → wrapped_in_code", остальные "pending_next_subpatch"
3. Добавить отдельный **mini-proof по subscription-admin-actions** с branch-matrix:
  - cancel → revoke/skip
  - revoke_access → revoke/skip
  - delete → revoke/skip
  - refund+revoke → revoke
  - refund+reduce = excluded_from_v22_6_scope
4. Добавить отдельный **mini-proof по telegram-revoke-access** с outcome-matrix:
  - success revoke → executeRevoke (line 672-692)
  - blocked/valid-access → writeLedgerEntry skip (line 280-310)
  - no-telegram-linked → executeRevoke (line 448-469)
5. Добавить **mini-proof по telegram-check-expired и telegram-kick-violators**:
  - revoke → executeRevoke
  - valid-access skip → writeLedgerEntry
  - jobRunId = crypto.randomUUID() per cron run

---

## Файлы


| Действие | Файл                                                               |
| -------- | ------------------------------------------------------------------ |
| Изменить | `supabase/functions/subscription-admin-actions/index.ts` (3 ветки) |
| Обновить | `.lovable/proofs/p0_revoke_wrapper_completion_proof.txt`           |
| Обновить | `.lovable/proofs/p0_revoke_path_inventory.txt`                     |


## Что НЕ изменяется

- `_shared/fulfillment-executor.ts` — контракт заморожен
- `_shared/access-revoker.ts` — контракт заморожен
- Все остальные edge functions (telegram-*, cancel-trial, subscription-charge) — уже обёрнуты корректно
- grant/extend ветки — вне scope
- Parent propagation — Sub-patch B
- UI — не затрагивается

## STOP-guards

1. writeLedgerEntry / executeRevoke API изменился → STOP
2. Ветка пишет revoked для уже canceled subscription → STOP
3. auditLogId не получен до ledger write → STOP

## DoD

Все 9 paths Sub-patch A = wrapped_in_code (реально в коде, не только в proof):

1. telegram-revoke-access — ✅ verified in code
2. telegram-check-expired — ✅ verified in code
3. telegram-kick-violators — ✅ verified in code
4. cancel-trial — ✅ verified in code
5. subscription-charge:trial_ended_no_payment — ✅ verified in code
6. subscription-admin-actions:cancel — ❌ → обернуть
7. subscription-admin-actions:revoke_access — ❌ → обернуть
8. subscription-admin-actions:delete — ❌ → обернуть
9. subscription-admin-actions:refund+revoke — ✅ verified in code

```
wrapped_in_code = yes (6/9 verified, 3 to fix)
runtime_verified = deferred (runtime_deferred_non_blocking)
cutover_allowed = no
SAFE_TO_CONTINUE_IMPLEMENTATION = YES
CUTOVER_ALLOWED = NO
```