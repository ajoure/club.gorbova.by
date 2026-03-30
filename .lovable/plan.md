Да, согласен, с учетом правок:

&nbsp;

1. Исправь несоответствие по количеству reason_code.  
В плане сейчас написано «17 значений», но в DDL перечислено 18 кодов:  
paid_order, trial_start, subscription_renew, subscription_extend, admin_grant, bulk_import, rule_engine_bonus, payment_failed, trial_expired, admin_cancel, subscription_expired, admin_revoke, cron_cleanup, violation_kick, duplicate_skip, already_active, no_matching_target, batch_orchestration.  
Это нужно синхронизировать в тексте плана, TS union и proof, иначе подрядчик легко уедет в off-by-one.
2. writeLedgerEntry() должен сразу возвращать не только id, но и execution_key.  
Даже если execution_key генерится дефолтом БД, helper обязан делать select('id, execution_key') и возвращать оба поля.  
Иначе следующий патч с parent_execution_key снова потребует переделки foundation helper.
3. Зафиксируй явный контракт target_key для каждого target_type в v22.3.  
Сейчас план нормализует target_type, но не фиксирует одинаково target_key. Нужна таблица:  

  - product → products_v2.code или детерминированный product key
  - subscription_tier → tariff_id/tariff.code по единому правилу
  - club → club_id или club.slug по единому правилу
  - batch → {batch_id}  
  Без этого proof по target-resolution останется расплывчатым.
4. &nbsp;
5. В p0_ledger_contract_validation_proof.txt добавь отдельный machine-check по result для каждого action_type.  
Не только schema post_check, но и:  

  - grant/extend/reactivate → есть access_start, access_end, window_days, source_window_rule, post_check
  - revoke/expire → есть revoked_from, previous_access_end, reconcile_basis, other_active_sources_checked
  - skip → есть skip_reason
  - failed → есть failed_at_step, error_message
  - batch_start → post_check IS NULL  
  И отдельной проверкой: post-check merge не затёр поля окна доступа.
6. &nbsp;
7. Для subscription-charge и subscription-admin-actions зафиксируй branch-level mapping не только по reason_code, но и по source_event_type + source_subject_type.  
То есть не общий дефолт на файл, а по каждой ветке:  

  - renew/extend
  - failed_revoke
  - cancel
  - grant_access
  - extend
  - refund+revoke  
  Иначе часть строк снова начнёт писать неверный source_subject_type.
8. &nbsp;
9. AccessRevoker оставь generic до конца: caller обязан передавать targetType, targetKey, targetRef, reasonCode, reconcileBasis, а helper ничего не “досочиняет” сам.  
Это особенно важно для subscriptions-reconcile, где у тебя уже есть block-by-block mapping. Нужно прямо зафиксировать как обязательный контракт helper-а.
10. p0_ledger_contract_validation_proof.txt делай не только code-based, но и runtime-based.  
Минимум по одному реальному ledger row после patch для:  

  - grant-access-for-order
  - subscription-charge
  - subscriptions-reconcile  
  И уже по этим строкам проверяй CHECK-совместимость, result-contract и merge post_check.
11. &nbsp;
12. EditDealDialog.tsx не клади в archival.  
Оставь отдельную секцию:  
UI-only non-access paths  
с формулировкой, которую ты уже зафиксировал. Это правильно и не смешивает UI-логику с историческими скриптами.

&nbsp;

&nbsp;

После этих правок PATCH v22.3 можно считать корректным foundation-fix перед продолжением Steps 4–10.

&nbsp;

# План: PATCH v22.3 — Foundation Fix

## Цель

Исправить shared helpers и уже обёрнутые paths до продолжения rollout Steps 4–10. Все ledger-записи должны проходить DDL CHECKs.

## Диагностика: 14 нарушений DDL


| #   | Файл                               | Дефект                                                                               | DDL CHECK                                                  |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 1   | fulfillment-executor.ts L29        | `status: 'completed'|'pending'`                                                      | `chk_action_status_compat`: grant→granted, extend→extended |
| 2   | fulfillment-executor.ts L38-42     | `PostCheckResult` с `applicable: boolean`                                            | Контракт v22: `applicability: 'required'|'not_applicable'` |
| 3   | fulfillment-executor.ts L112       | `updateLedgerPostCheck` ставит `status: 'completed'` + replace result                | Затирает access window fields; wrong status                |
| 4   | fulfillment-executor.ts L138       | `telegram_grant` как ключ post_check                                                 | Контракт: `telegram`                                       |
| 5   | fulfillment-executor.ts L169-174   | `validateSourceEventKey()` проверяет только `:`                                      | STOP-guard не закрыт                                       |
| 6   | access-revoker.ts L61,94           | `target_type: 'telegram_access'`                                                     | `chk_target_type`: нет такого значения                     |
| 7   | access-revoker.ts L97              | `status: 'completed'` для revoke                                                     | должен быть `'revoked'`                                    |
| 8   | access-revoker.ts L16-28           | Нет `targetType`, `targetKey`, `targetRef`, `reconcileBasis`, `profileId`, `orderId` | generic helper, не telegram-only                           |
| 9   | grant-access-for-order L689        | `reason_code: 'order_grant'`                                                         | `chk_reason_code`: нужен `'paid_order'`                    |
| 10  | grant-access-for-order L690        | `target_type: 'subscription'`                                                        | Временно `'product'` для v22.3                             |
| 11  | grant-access-for-order L696        | `status: 'completed'`                                                                | grant→`'granted'`, extend→`'extended'`                     |
| 12  | subscription-charge L1536          | `reason_code: 'subscription_renewal'`                                                | нужен `'subscription_renew'`                               |
| 13  | subscription-charge L1537          | `target_type: 'subscription'`                                                        | Временно `'subscription_tier'`                             |
| 14  | subscription-charge L1541          | `status: 'completed'`                                                                | extend→`'extended'`                                        |
| 15  | subscriptions-reconcile L144       | `reason: 'trial_canceled'`                                                           | нужен `'trial_expired'`                                    |
| 16  | subscriptions-reconcile L204       | `reason: 'access_expired'`                                                           | нужен `'subscription_expired'`                             |
| 17  | subscriptions-reconcile L249       | `reason: 'no_valid_access'`                                                          | нужен `'cron_cleanup'`                                     |
| 18  | subscriptions-reconcile L252       | `sourceSubjectType: 'telegram_access'`                                               | `chk_source_subject_type`: нет, нужен `'cron_job'`         |
| 19  | subscriptions-reconcile all blocks | `target_type` наследуется как `'telegram_access'` через helper                       | block-by-block mapping нужен                               |


## Шаги реализации

### Шаг 1. Переписать `fulfillment-executor.ts`

**LedgerEntry interface** — strict unions по DDL:

- `status`: `'granted'|'extended'|'revoked'|'expired'|'reactivated'|'skipped'|'failed'|'completed'`
- `target_type`: `'product'|'club'|'training_module'|'feature'|'batch'|'domain'|'menu_item'|'training_lesson'|'subscription_tier'`
- `reason_code`: все 17 значений из `chk_reason_code`
- `source_subject_type`: `'order'|'subscription'|'admin_action'|'import_batch'|'cron_job'|'system'|'rule_engine_trigger'`

**PostCheckResult** — нормализованная схема, унифицированные ключи:

```ts
interface PostCheckItem {
  applicability: 'required' | 'not_applicable';
  status: 'pass' | 'warn' | 'fail' | null;
  details?: string;
  ref?: string;
}
interface PostCheckResult {
  entitlement: PostCheckItem;
  telegram: PostCheckItem;        // НЕ telegram_grant
  subscription: PostCheckItem;
  ledger_row: PostCheckItem;
  target_resolution: PostCheckItem;
}
```

**updateLedgerPostCheck()** — merge, не replace:

- Сначала читает текущий `result` из БД
- Мержит `post_check` в существующий result
- НЕ трогает `status`, НЕ затирает `access_start/access_end/window_days/...`

**validateSourceEventKey()** — жёсткая валидация:

- Throw при пустом ключе или отсутствии `:`
- Throw при обнаружении ISO timestamp pattern, `Date.now()`, `Math.random()`, `new Date()`
- Допустимые discriminators: UUID, integer id, hash

**writeLedgerEntry()** — runtime-валидация всего DDL до insert:

- `action_type ↔ status` по `chk_action_status_compat`
- `reason_code` из словаря
- `target_type` из словаря
- `source_subject_type` из словаря
- `parent_event_key` и `parent_execution_key` — оба NULL или оба NOT NULL
- Хотя бы один subject reference NOT NULL (`order_id || source_order_id || source_subscription_id || source_offer_id || source_subject_ref`)
- `batch_start ↔ batch` symmetry
- При нарушении — throw, не silent fail

**buildPostCheck()** — переписать под новую схему:

- `applicable: true` → `applicability: 'required'`
- `applicable: false` → `applicability: 'not_applicable'`
- `status: 'written'` → `status: 'pass'`
- `status: 'not_applicable'` → `status: null`
- Ключ `telegramGrant` в input → маппится на `telegram` в output

### Шаг 2. Переписать `access-revoker.ts`

Сделать **generic helper**, не telegram-only.

**RevokeContext** — расширить:

```ts
interface RevokeContext {
  userId: string;
  profileId?: string | null;
  orderId?: string | null;
  targetType: 'product' | 'club' | 'subscription_tier';  // обязательный
  targetKey: string;                                        // обязательный
  targetRef?: string | null;
  subscriptionId?: string | null;
  reasonCode: string;                  // renamed from reason
  reconcileBasis: string;              // обязательный, передаётся caller-ом
  sourceEventType: 'webhook' | 'cron' | 'admin' | 'system';
  sourceEventKey: string;
  sourceSubjectType: string;
  sourceSubjectRef?: string | null;
  parentEventKey?: string | null;
  parentExecutionKey?: string | null;
  metadata?: Record<string, unknown>;
}
```

**executeRevoke():**

- Использовать `ctx.targetType`, `ctx.targetKey`, `ctx.targetRef` из caller, не собирать внутри
- `status: 'revoked'` для action_type='revoke'
- `status: 'skipped'` для action_type='skip' — OK
- `result.reconcile_basis = ctx.reconcileBasis` — из caller, не из внутренней логики
- Active-source check через authoritative tables, не через ledger

### Шаг 3. Исправить grant-access-for-order/index.ts

- `reason_code: 'order_grant'` → `'paid_order'`
- `target_type: 'subscription'` → `'product'` (временно v22.3, одна строка = primary target)
- `status: 'completed'` → `actionType === 'grant' ? 'granted' : 'extended'`
- `post_check` → через обновлённый `buildPostCheck()`

### Шаг 4. Исправить subscription-charge/index.ts

- `reason_code: 'subscription_renewal'` → `'subscription_renew'`
- `target_type: 'subscription'` → `'subscription_tier'` (временно v22.3)
- `status: 'completed'` → `'extended'`
- `source_event_type: 'cron'` — оставить для cron-branch (это реальный origin)
- `post_check` → через обновлённый `buildPostCheck()`
- Добавить `profile_id`

### Шаг 5. Исправить subscriptions-reconcile/index.ts

Block-by-block target mapping:


| Block                    | Семантика                 | reason_code              | target_type           | source_subject_type |
| ------------------------ | ------------------------- | ------------------------ | --------------------- | ------------------- |
| 1. Expired cancellations | subscription-layer expire | `'subscription_expired'` | `'subscription_tier'` | `'subscription'`    |
| 2. Trial expired         | subscription-layer expire | `'trial_expired'`        | `'subscription_tier'` | `'subscription'`    |
| 3. Access expired        | subscription-layer expire | `'subscription_expired'` | `'subscription_tier'` | `'subscription'`    |
| 4. Telegram sync         | club projection sync      | `'cron_cleanup'`         | `'club'`              | `'cron_job'`        |


Каждый блок передаёт в `executeRevoke()` свой `targetType`, `targetKey`, `reasonCode`, `reconcileBasis`.

### Шаг 6. Классифицировать EditDealDialog.tsx

Категория: **UI-only non-access path** (не archival, не grant, не revoke).
Обновить `p0_hardcode_archival_ignored_proof.txt`:

- Отдельная секция "UI-only non-access paths"
- Запись: `EditDealDialog.tsx L272 — UI display logic (shows next_charge_at field), not access grant/revoke path, no ledger impact. Follow-up UI-only patch.`

### Шаг 7. Создать `p0_ledger_contract_validation_proof.txt`

По каждому обёрнутому path (grant-access-for-order, subscription-charge, subscriptions-reconcile) проверить:

1. `action_type ↔ status` валиден по `chk_action_status_compat`
2. `reason_code` из словаря `chk_reason_code`
3. `target_type` из словаря `chk_target_type`
4. `source_subject_type` из словаря `chk_source_subject_type`
5. `chk_has_subject` — хотя бы один subject ref NOT NULL
6. `chk_parent_keys_pair` — оба NULL или оба NOT NULL
7. `chk_batch_row_contract` — N/A для текущих paths
8. `result.post_check` — ключи только из `{entitlement, telegram, subscription, ledger_row, target_resolution}`
9. `result.post_check` — schema `{applicability, status, details?, ref?}`
10. result не затёрт post-check update-ом (access window fields сохранились после merge)
11. Нет `'completed'` вне `batch_start`
12. Нет `'telegram_access'` / `'subscription'` как target_type

### Временный контракт v22.3

В v22.3 исправляем только валидность уже записываемых строк. Каждый path пишет одну строку с одним primary target_type. Полноценная декомпозиция event → product / subscription_tier / club rows выполняется следующим патчем Steps 4–10.

### STOP-guards v22.3

1. Любое значение status/action_type/target_type/reason_code/source_subject_type вне DDL CHECK → STOP
2. `post_check` использует `applicable: boolean` вместо `applicability: string` → STOP
3. `post_check` использует ключ `telegram_grant` вместо `telegram` → STOP
4. `'completed'` как status вне `batch_start` → STOP
5. `'telegram_access'` / `'subscription'` как target_type → STOP
6. `updateLedgerPostCheck` затирает result вместо merge → STOP
7. EditDealDialog не классифицирован в proof → STOP
8. `validateSourceEventKey` не блокирует timestamp discriminators → STOP

### Порядок

1. Переписать `_shared/fulfillment-executor.ts`
2. Переписать `_shared/access-revoker.ts`
3. Исправить `grant-access-for-order/index.ts`
4. Исправить `subscription-charge/index.ts`
5. Исправить `subscriptions-reconcile/index.ts`
6. Обновить `p0_hardcode_archival_ignored_proof.txt` (EditDealDialog → UI-only non-access path)
7. Создать `p0_ledger_contract_validation_proof.txt`

### После v22.3

Только после PASS `p0_ledger_contract_validation_proof.txt` продолжать Steps 4–10:

- Downstream parent propagation
- Remaining revoke paths
- Batch/import tree
- Path-specific transactional RPCs
- Target decomposition (multi-row per event)
- Coverage proofs + cutover marker