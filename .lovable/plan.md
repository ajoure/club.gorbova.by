Да, согласен, с учетом правок:

&nbsp;

1. Верни path-specific source_event_key для grant-access-for-order.  
В v3 произошёл откат назад до order-grant:{order_id}, а это уже не соответствует принятому контракту idempotency/event-level.  
Нужно:  

  - webhook-вызов → gafo:webhook:{delivery_id|provider_event_id}:{order_id}
  - admin/manual replay → gafo:admin:{request_id}:{order_id}
  - fallback только если действительно нет event/request id, и это должно быть явно задокументировано.
2. &nbsp;
3. subscription-charge:renew/extend не должен иметь source_event_type='system' по умолчанию.  
Здесь нужен path-specific split:  

  - webhook success → source_event_type='webhook'
  - cron-initiated renew/extend → source_event_type='cron'  
  И ключи тоже должны это отражать. Иначе proof по типам событий потом поедет.
4. &nbsp;
5. Не фиксируй telegram-revoke-access только через subscription_id.  
Для manual/admin revoke там может не быть subscription context.  
Нужен контракт:  

  - primary key = subscription_id, если он реально есть
  - иначе fallback = {user_id}:{club_id}:{audit_log_id|request_id}  
  Это же правило явно зафиксировать в source_subject_ref.
6. &nbsp;
7. Phase 1 subset invariants нужно перечислить явно, а не писать “1–76 из DoD v22”.  
Сейчас это противоречит твоему же правилу, что p0_invariant_report.txt покрывает только Phase 0 + Phase 1.  
Исправить:  

  - выделить отдельный список Phase 1 subset invariants
  - только его проверять в p0_invariant_report.txt
  - инварианты Phase 2+ не упоминать как выполненные.
8. &nbsp;
9. Для DB-only paths выбери один технический механизм транзакции и зафиксируй его.  
Сейчас написано “SECURITY DEFINER RPC или explicit BEGIN…COMMIT”. Это оставляет две реализации и риск расхождения.  
Нужен один вариант по умолчанию для всех DB-only grant paths Phase 1. Лучше зафиксировать:  

  - либо единый SECURITY DEFINER RPC,
  - либо единый transactional helper,  
  но не “или”.
10. &nbsp;
11. p0_revoke_path_inventory.txt должен содержать точное количество и точный список, без формулировки 7+ revoke paths.  
Сейчас в Step 10 это уже расплывчато.  
Нужен точный контракт:  

  - 7 revoke-paths
  - отдельно перечислены все дополнительные admin ветки, если они мапятся на те же 7
  - без плавающих чисел.
12. &nbsp;
13. Добавь отдельный machine-check на config-source replacement.  
Не только grep на отсутствие hardcode, но и verify, что:  

  - products_v2.meta.access_window_rule='calendar_month'
  - bepaid-report-import реально читает bepaid_product_mappings
  - getcourse-import-deals реально читает tariffs.getcourse_offer_id
  - Learning.tsx и Products.tsx реально читают через product_club_mappings  
  Иначе можно убрать hardcode, но остаться без работающего SoT.
14. &nbsp;
15. Для downstream proof оставь orphan=0 только при single-row parent match по обоим полям одновременно.  
Это уже было принято раньше, но в v3 в тексте Step 5/10 это надо повторить явно, чтобы подрядчик не вернулся к двум отдельным EXISTS.

&nbsp;

&nbsp;

После этих правок execution plan уже можно считать финальным для запуска.

&nbsp;

&nbsp;

# Execution Plan v3 — Phase 1 / Steps 3–10

## Принятые правки v3


| #   | Правка                                                                                            |
| --- | ------------------------------------------------------------------------------------------------- |
| 1   | Mini-patch `products_v2.meta` через `jsonb_set(COALESCE(...))`, не затирая существующий meta      |
| 2   | Убраны все timestamp-based `source_event_key`. Только детерминированные discriminators            |
| 3   | Batch row key: primary = `row:{stable_external_id}`, fallback = `row:{row_index}:{hash(payload)}` |
| 4   | `refund+reduce` вынесен из Phase 1 scope (explicit exclude)                                       |
| 5   | Transactional contract: одна SQL transaction / один SECURITY DEFINER RPC, не "batch"              |
| 6   | `p0_invariant_report.txt` покрывает только Phase 0 + Phase 1 subset                               |
| 7   | Отдельный proof по config-source mini-patch                                                       |
| 8   | Frontend query contract через `product_club_mappings` — exact query, без slug/code/name           |
| 9   | Cutover-proof файл/блок для `phase1_ledger_cutover_at`                                            |


---

## Step 3: Hardcode cleanup

### 3.0 Mini-patch: config-source

```sql
UPDATE products_v2
SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{access_window_rule}', '"calendar_month"'::jsonb, true)
WHERE id = '11c9f1b8-0355-4753-bd74-40b42aa53616';
```

Proof-блок (в `p0_config_source_proof.txt`):

- rowcount = 1
- старый meta сохранён (snapshot до/после)
- новый ключ `access_window_rule = 'calendar_month'` появился
- все 5 edge paths и 2 frontend paths читают config, а не hardcode

### 3.1 Live scope: 7 файлов


| #   | Файл                              | Что захардкожено                                           | Чем заменяется                                               | SoT                          |
| --- | --------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------- |
| 1   | `grant-access-for-order/index.ts` | `CLUB_PRODUCT_ID` (L159)                                   | `products_v2.meta->>'access_window_rule' = 'calendar_month'` | `products_v2.meta`           |
| 2   | `subscription-charge/index.ts`    | `CLUB_PRODUCT_ID` (L1141)                                  | `products_v2.meta->>'access_window_rule'` lookup             | `products_v2.meta`           |
| 3   | `bepaid-report-import/index.ts`   | `productId` hardcode (L348, L458, L599) + tariff UUID maps | DB lookup `bepaid_product_mappings`                          | `bepaid_product_mappings`    |
| 4   | `getcourse-import-deals/index.ts` | `CLUB_PRODUCT_ID` (L697) + tariff maps                     | DB lookup `tariffs.getcourse_offer_id`                       | `tariffs.getcourse_offer_id` |
| 5   | `admin-manual-charge/index.ts`    | `isClubProduct` (L420)                                     | `products_v2.meta->>'access_window_rule'` lookup             | `products_v2.meta`           |
| 6   | `src/pages/Learning.tsx`          | `11c9f1b8...` UUID                                         | `product_club_mappings` → `product_id` list                  | `product_club_mappings`      |
| 7   | `src/pages/Products.tsx`          | `11c9f1b8...` UUID (L120)                                  | `product_club_mappings` → `product_id` list                  | `product_club_mappings`      |


### 3.2 Frontend query contract (Learning.tsx, Products.tsx)

```text
1. SELECT product_id FROM product_club_mappings
2. Использовать полученные product_id для subscriptions_v2 / entitlements lookup
3. Без code/name/slug
4. Без fallback на hardcoded UUID
```

### 3.3 Import mapping SoT proof

**bepaid-report-import:**

- authoritative SoT: `bepaid_product_mappings` (таблица уже существует)
- hardcoded tariff UUIDs в текущем коде → заменяются на lookup по `bepaid_product_mappings.bepaid_product_code`
- proof: список всех заменённых UUID + новый lookup query

**getcourse-import-deals:**

- authoritative SoT: `tariffs.getcourse_offer_id` (поле уже существует)
- hardcoded tariff/product UUID → заменяются на lookup `tariffs WHERE getcourse_offer_id = :gc_offer_id`
- proof: список всех заменённых UUID + новый lookup query

**STOP-guard:** если для любого hardcoded UUID не найден доказуемый DB SoT replacement → STOP.

### 3.4 Archival (не трогать)


| #   | Файл                                         | Причина                                            |
| --- | -------------------------------------------- | -------------------------------------------------- |
| 1   | `admin-fix-club-billing-dates/index.ts`      | Maintenance script                                 |
| 2   | `admin-backfill-recurring-snapshot/index.ts` | One-time backfill                                  |
| 3   | `test-full-trial-flow/index.ts`              | Test fixture                                       |
| 4   | `getcourse-import-file/index.ts`             | Legacy import (replaced by getcourse-import-deals) |


### 3.5 False positive

`src/components/admin/deals/EditDealDialog.tsx` — нет hardcoded club product ID. Исключён из scope.

### 3.6 Proof

`p0_hardcode_live_cleanup_proof.txt`: 7 live files patched + grep before/after, `hardcoded_club_id_occurrences_after = 0`
`p0_hardcode_archival_ignored_proof.txt`: 4 archival files + reasoning

---

## Step 4: FulfillmentExecutor — 4 grant-path groups

### Helper

`supabase/functions/_shared/fulfillment-executor.ts`

### Groups


| #   | Group                            | Files                                                                                                 | source_event_type |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------- |
| 1   | grant-access-for-order           | `grant-access-for-order/index.ts`                                                                     | `webhook`         |
| 2   | subscription-charge:renew/extend | `subscription-charge/index.ts` (success branch only)                                                  | `system`          |
| 3   | bulk imports                     | `bepaid-report-import`, `getcourse-import-deals`                                                      | `system`          |
| 4   | admin/manual                     | `admin-manual-charge`, `subscription-admin-actions:extend`, `subscription-admin-actions:grant_access` | `admin`           |


### source_event_key contract (no timestamps)


| Path                                    | source_event_key format                                                                          | Deterministic source           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------ |
| grant-access-for-order                  | `order-grant:{order_id}`                                                                         | order UUID                     |
| subscription-charge:renew               | `sub-renew:{subscription_id}:{payment_id}`                                                       | payment UUID                   |
| bepaid-report-import:row                | `bepaid-import:{batch_id}:row:{uid}` (fallback: `row:{row_index}:{sha256(normalized_payload)}`)  | external uid or row_index+hash |
| getcourse-import-deals:row              | `gc-import:{batch_id}:row:{gcDealId}` (fallback: `row:{row_index}:{sha256(normalized_payload)}`) | gcDealId or row_index+hash     |
| admin-manual-charge                     | `admin-charge:{order_id}`                                                                        | created order UUID             |
| subscription-admin-actions:extend       | `admin-extend:{subscription_id}:{audit_log_id}`                                                  | audit_log UUID                 |
| subscription-admin-actions:grant_access | `admin-grant:{subscription_id}:{audit_log_id}`                                                   | audit_log UUID                 |


**STOP-guard:** если source_event_key содержит `Date.now()`, `new Date()`, `Math.random()` как discriminator → STOP.

### subscription-admin-actions branch matrix


| Action                              | Role                | Ledger action_type | Scope                               |
| ----------------------------------- | ------------------- | ------------------ | ----------------------------------- |
| `extend`                            | FulfillmentExecutor | `extend`           | Phase 1 ✅                           |
| `grant_access`                      | FulfillmentExecutor | `grant`            | Phase 1 ✅                           |
| `set_end_date`                      | FulfillmentExecutor | `extend`           | Phase 1 ✅                           |
| `cancel`                            | AccessRevoker       | `revoke`           | Phase 1 ✅ (Step 6)                  |
| `revoke_access`                     | AccessRevoker       | `revoke`           | Phase 1 ✅ (Step 6)                  |
| `delete`                            | AccessRevoker       | `revoke`           | Phase 1 ✅ (Step 6)                  |
| `refund` + `access_action='revoke'` | AccessRevoker       | `revoke`           | Phase 1 ✅ (Step 6)                  |
| `refund` + `access_action='reduce'` | —                   | —                  | **Phase 1 EXCLUDED**                |
| `resume`                            | —                   | —                  | Вне scope ledger (no access change) |
| `pause`                             | —                   | —                  | Вне scope ledger (no access change) |
| `toggle_auto_renew`                 | —                   | —                  | Вне scope ledger (no access change) |


`**refund + reduce` decision:** явно исключён из Phase 1. Причина: текущий result-контракт для `revoke/expire` не фиксирует `new_access_end` при partial reduce. Требует отдельного `reason_code` (e.g. `refund_reduce`) и расширения result-схемы. Оставлен для Phase 2.

### subscription-charge branch matrix


| Branch                                   | Role                | Ledger action_type | source_event_key                                 |
| ---------------------------------------- | ------------------- | ------------------ | ------------------------------------------------ |
| success (charge OK, extend)              | FulfillmentExecutor | `extend`           | `sub-renew:{sub_id}:{payment_id}`                |
| failed_revoke (max attempts, cancel sub) | AccessRevoker       | `revoke`           | `sub-failed-revoke:{sub_id}:{payment_id}`        |
| failed_retry (not max, schedule next)    | —                   | —                  | Вне scope ledger Phase 1 (нет изменения доступа) |


---

## Step 5: Downstream parent propagation — 2 paths


| #   | Path                            | Parent contract                                                                    |
| --- | ------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | `telegram-grant-access`         | `parent_event_key` + `parent_execution_key` обязательны при вызове из primary path |
| 2   | `telegram-process-access-queue` | То же                                                                              |


**Error contract:** если primary path вызвал downstream без parent keys → ERROR, не silent fallback.

**Autonomous call** (e.g. manual admin invoke): оба parent поля NULL, создаёт свой первичный event.

---

## Step 6: AccessRevoker — 7 revoke paths

### Helper

`supabase/functions/_shared/access-revoker.ts`


| #   | Path                                | source_event_key                                   |
| --- | ----------------------------------- | -------------------------------------------------- |
| 1   | `telegram-revoke-access` (manual)   | `admin-revoke:{subscription_id}:{audit_log_id}`    |
| 2   | `telegram-check-expired`            | `cron-expire:{job_run_id}:{subscription_id}`       |
| 3   | `telegram-kick-violators`           | `cron-kick:{job_run_id}:{user_id}:{club_id}`       |
| 4   | `cancel-trial`                      | `cron-trial-expire:{job_run_id}:{subscription_id}` |
| 5   | `subscription-charge:failed_revoke` | `sub-failed-revoke:{sub_id}:{payment_id}`          |
| 6   | `subscription-admin-actions:cancel` | `admin-cancel:{subscription_id}:{audit_log_id}`    |
| 7   | `subscriptions-reconcile`           | `cron-reconcile:{job_run_id}:{subscription_id}`    |


`subscription-admin-actions:revoke_access`, `:delete`, `:refund+revoke` also map here with their own keys.

---

## Step 7: Batch/import tree

For `bepaid-report-import` and `getcourse-import-deals`:

```text
batch_start event (target_type='batch', action_type='batch_start')
  └── row event 1 (action_type='grant'/'extend', parent = batch_start)
       └── downstream telegram event (parent = row event, NOT batch event)
  └── row event 2 ...
```

### Row key contract (одинаковый для обоих import paths)

- primary: `row:{stable_external_id}` (uid для bepaid, gcDealId для getcourse)
- fallback (если external id отсутствует): `row:{row_index}:{sha256(JSON.stringify(sorted_payload_keys))}`
- proof: ни один live import не может сгенерить row event без stable key

---

## Step 8: resolveAccessWindow()

### Helper

`supabase/functions/_shared/resolve-access-window.ts`

Единая функция, приоритет:

1. Explicit window (из события)
2. Flow window
3. Tariff duration
4. Config rule (`products_v2.meta->>'access_window_rule' = 'calendar_month'`)
5. Extend existing (GREATEST mode)

### result JSONB contract по action_type


| action_type             | Обязательные поля result                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| grant/extend/reactivate | `access_start`, `access_end`, `window_days`, `source_window_rule`, `previous_end` (nullable), `post_check`   |
| revoke/expire           | `revoked_from`, `previous_access_end`, `reconcile_basis`, `other_active_sources_checked`, `kept_projections` |
| skip                    | `skip_reason`, `existing_ref`                                                                                |
| failed                  | `failed_at_step`, `error_message`                                                                            |
| batch_start             | `batch_size`, `source_file`, `import_type` (all nullable)                                                    |


---

## Step 9: Post-check + transactional contract

### 5 проверок post_check

1. entitlement created/updated
2. telegram grant created/queued
3. subscription exists/extended
4. ledger row written
5. target resolution matched

### Transactional contract

**DB-only paths** (grant-access-for-order, subscription-charge:renew, admin-manual-charge, subscription-admin-actions:extend):

- Projection changes + ledger INSERT в **одной SQL transaction** (через SECURITY DEFINER RPC `fn_fulfillment_execute` или explicit `BEGIN...COMMIT` в edge function через raw pg client).
- Success response невозможен без записанной ledger row.

**Downstream/external paths** (telegram-grant-access, telegram-process-access-queue):

- Parent ledger event ДОЛЖЕН существовать до вызова downstream.
- Downstream записывает свой child ledger event.
- Downstream не может считаться завершённым, пока child ledger row не записан.

**Batch paths** (bepaid-report-import, getcourse-import-deals):

- batch_start ledger row записывается первой.
- Каждый row event записывает ledger row атомарно с projection change.
- Итоговый batch summary обновляет batch_start row result.

---

## Step 10: Proof + cutover

### Phase 1 subset invariants (для p0_invariant_report.txt)

Покрываются **только** Phase 0 + Phase 1 инварианты. Future Phase 2+ инварианты **не упоминаются** как выполненные.

Subset:

- Инварианты 1–76 из DoD v22 (все текущие CHECK/FK/schema guards)
- Machine-check: post_check по action_type
- Machine-check: source_event_key determinism
- Machine-check: parent lineage single-row match
- Machine-check: hardcoded UUID occurrences = 0

### 7 proof-файлов

1. `p0_config_source_proof.txt` — mini-patch meta proof
2. `p0_hardcode_live_cleanup_proof.txt` — 7 live files
3. `p0_hardcode_archival_ignored_proof.txt` — 4 archival files
4. `p0_invariant_report.txt` — Phase 0+1 subset only
5. `p0_revoke_path_inventory.txt` — 7+3 revoke paths
6. `p0_ledger_path_coverage_proof.txt` — all paths covered
7. `p0_ledger_watermark_coverage_proof.txt` — single-row lineage, coverage from cutover_at

### Cutover-proof контракт

Файл/блок: `p0_cutover_proof.txt`

```text
1. Кто пишет: финальная миграция / deploy script
2. Что пишет:
   UPDATE app_settings
   SET value = jsonb_set(value, '{phase1_ledger_cutover_at}', to_jsonb(now()::text))
   WHERE key = 'system'
     AND NOT (value ? 'phase1_ledger_cutover_at');
3. Записывается ОДИН раз (idempotent guard: NOT value ? 'phase1_ledger_cutover_at')
4. Все coverage queries используют:
   WHERE created_at >= (SELECT (value->>'phase1_ledger_cutover_at')::timestamptz FROM app_settings WHERE key = 'system')
5. НЕ используют phase1_ledger_schema_ready_at для coverage
6. Proof: SELECT value->>'phase1_ledger_cutover_at' FROM app_settings WHERE key = 'system' → NOT NULL
```

### STOP-guards (8)

1. Nondeterministic `source_event_key` (timestamp/random as discriminator) → STOP
2. Primary grant path missing ledger row → STOP
3. Downstream called from primary without parent keys → STOP
4. `hardcoded_club_id_occurrences_after > 0` in live files → STOP
5. Watermark coverage diff > 0 по любому path → STOP
6. Orphan downstream > 0 → STOP
7. Missing required post_check → STOP
8. No доказуемый DB SoT replacement for any hardcoded UUID → STOP

---

## Порядок реализации

1. Mini-patch `products_v2.meta` (миграция)
2. Hardcode cleanup в 7 live files
3. Создать `_shared/resolve-access-window.ts`
4. Создать `_shared/fulfillment-executor.ts` + SECURITY DEFINER RPC
5. Обернуть 4 grant-path groups
6. Обернуть 2 downstream paths с parent propagation
7. Создать `_shared/access-revoker.ts`
8. Обернуть 7+ revoke paths
9. Batch/import tree для bepaid + getcourse
10. Post-check per ledger row
11. 7 proof-файлов
12. Cutover marker `phase1_ledger_cutover_at` (только после 11 = PASS)