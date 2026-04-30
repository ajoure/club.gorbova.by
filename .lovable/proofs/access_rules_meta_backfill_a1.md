# Access Rules — A1 Safe Meta Backfill (already_satisfied)

**Date:** 2026-04-30 (Minsk)
**Scope:** Антонина Ерастова (`user_id=41b83bf6-4b48-414a-9889-4880df9af265`,
`profile_id=db04f9c1-c8dd-4247-960f-122349627755`,
`antoninaerastova2020@gmail.com`),
тариф BUSINESS `7c748940-dcad-4c7c-a92e-76a2344622d3`.

## 1. Patch summary

`supabase/functions/_shared/product-access-grants.ts`:
- Добавлен outcome `metadata_backfilled` в `SecondaryGrantOutcome`.
- В ветке `already_satisfied` теперь:
  - **только** при наличии `priorInfo`,
  - **только** для отсутствующих/пустых ключей:
    `scope_resolution_mode`, `prior_purchase_match_type`, `prior_purchase_order_id`,
    `historical_purchase_type`, `historical_tariff_id`, `historical_module_product_ids`
  - выполняется partial UPDATE `meta` (плюс `metadata_backfilled_at`, `metadata_backfill_keys`).
  - **`expires_at` / `status` / lineage НЕ изменяются.**
  - **`allowReduceAccess` не используется.**
- Ledger пишется через `writeMetadataBackfillLedger`:
  `action_type='skip'`, `status='skipped'`, `reason_code='already_active'`,
  `result.outcome='metadata_backfilled'`, `result.backfilled_keys=[…]`,
  `metadata.backfill_kind='secondary_product_access_meta'`.
- DDL `chk_action_status_compat`: `skip → skipped` валидно. ✅

`supabase/functions/access-rules-nightly-reconcile/index.ts`:
- bucket `metadata_backfilled` добавлен в `OutcomeBuckets`, `bumpBucket`, response, audit summary.
- `condition_met` теперь включает `metadata_backfilled`.

Deploy: `access-rules-nightly-reconcile`, `grant-access-for-order`, `rules-retroapply`. ✅

## 2. Targeted dry-run

`POST /access-rules-nightly-reconcile { dry_run:true, tariff_ids:[BUSINESS], user_ids:[Erastova] }`

```
rule_pairs_evaluated: 11
elapsed_ms: 1271
buckets:
  metadata_backfilled: 3       ← CB20 + Маркетплейсы + Производство
  already_satisfied: 1
  skipped_no_change: 1
  condition_not_met_prior_purchase: 6
  granted/extended/reactivated/failed/conflict_*: 0
```

## 3. Targeted execute

`POST /access-rules-nightly-reconcile { dry_run:false, tariff_ids:[BUSINESS], user_ids:[Erastova] }`

```
buckets:
  metadata_backfilled: 3       ← фактический PATCH меты
  granted/extended/reactivated: 0
  failed: 0
  conflict_*: 0
elapsed_ms: 2088
```

Никаких писем датам/статусу. Только meta.

## 4. SQL-proof меты после execute

```sql
SELECT product_code, status, expires_at,
       meta->>'scope_resolution_mode'     AS scope,
       meta->>'prior_purchase_match_type' AS match,
       meta->>'prior_purchase_order_id'   AS prior_order,
       meta->>'historical_purchase_type'  AS hist_type,
       meta->'historical_module_product_ids' AS hist_modules,
       meta->>'metadata_backfilled_at'    AS backfilled_at,
       meta->>'source_type'               AS source_type
FROM entitlements
WHERE user_id='41b83bf6-…' AND product_id IN (CB20, Marketplaces, Production)
ORDER BY product_code;
```

| product_code            | scope                | match              | prior_order      | hist_type                | hist_modules        | expires_at | source_type |
|------------------------|----------------------|--------------------|------------------|--------------------------|---------------------|------------|-------------|
| cb20                    | module_scope_only    | direct             | ae6ae4f2…        | module_only_standalone   | [Marketplaces UUID] | 2026-05-03 | retroapply  |
| cb_module_marketplaces  | module_scope_only    | module_list_mapped | ae6ae4f2…        | module_only_standalone   | [Marketplaces UUID] | 2026-05-03 | retroapply  |
| cb_module_production    | module_scope_only    | module_list_mapped | dc60a7c4…        | module_only_standalone   | [Production UUID]   | 2026-05-03 | retroapply  |

`expires_at` и `status='active'` совпадают с до-execute значениями — **не тронуты**. ✅
`source_rule_id=1b497fba…`, `source_type='retroapply'` — lineage сохранён. ✅

## 5. Ledger proof

```sql
SELECT action_type, status, reason_code,
       result->>'outcome'         AS outcome,
       result->'backfilled_keys'  AS backfilled_keys
FROM access_grant_ledger
WHERE source_event_key LIKE 'nightly_reconcile:2026-04-30:%:meta_backfill';
```

3 строки, все:
- `action_type='skip'`, `status='skipped'`, `reason_code='already_active'`
- `result.outcome='metadata_backfilled'`
- `result.backfilled_keys` = full set (5 ключей).

## 6. Read-path / личный кабинет

`src/hooks/useTrainingContentRules.ts` (lines 159, 243–350):
- Entitlement с `scope_resolution_mode='module_scope_only'` + непустым
  `historical_module_product_ids` → генерируется синтетическое правило с
  `allowed_module_ids` из `historical_module_product_ids`.
- До патча: `scope_resolution_mode=NULL` → entitlement попадал в legacy-ветку
  без scope ⇒ модуль скрывался. Это и был корень жалобы.
- После патча: 3 entitlement'а Ерастовой получили `module_scope_only` +
  `historical_module_product_ids=[…UUID модуля…]` ⇒ Маркетплейсы и Производство
  должны появиться в её ЛК как доступные модули CB20, в полном соответствии с
  её исторической покупкой.

## 7. DoD по A1

| Пункт                                                                 | Статус |
|-----------------------------------------------------------------------|:------:|
| Helper меняет meta только для `already_satisfied + priorInfo`         | ✅     |
| Только missing/empty ключи patch'атся                                 | ✅     |
| `expires_at` / `status` НЕ меняются                                   | ✅     |
| `allowReduceAccess` не используется                                   | ✅     |
| Ledger outcome `metadata_backfilled` (action=skip, status=skipped)    | ✅     |
| Reconcile audit summary содержит `metadata_backfilled` bucket         | ✅     |
| Targeted dry-run по Ерастовой = 3 backfill, 0 failed, 0 conflicts     | ✅     |
| Targeted execute = 3 backfill применены                               | ✅     |
| SQL meta-proof по CB20 / Маркетплейсы / Производство                  | ✅     |
| Read-path читает `scope_resolution_mode` + `historical_module_product_ids` | ✅ |

## 8. Что НЕ делалось

- PATCH D (активация `training_content` правил для standalone-модулей) — не трогали;
  по DoD — только после визуального подтверждения Ерастовой в ЛК.
- Когортный execute по всему BUSINESS — не запускался; следующее окно cron
  03:00 Minsk сам применит meta-backfill ко всем `already_satisfied` записям с priorInfo.
- `allow_reduce_access` остаётся `false`.
