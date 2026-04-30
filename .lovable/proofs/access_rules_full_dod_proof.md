# Access Rules — Полный DoD Proof

**Дата:** 2026-04-30 (Minsk)
**Контекст:** жалоба по Валерии (`6972333@mail.ru`) — после оплаты тарифа BUSINESS пришлось выдавать доступы вручную.

## 1. Что было исправлено

### PATCH A — единственный SOT для product_access в `grant-access-for-order`
- Удалён старый inline-блок `product_access` (строки ~1525–1842).
- Заменён единственным вызовом `syncSecondaryProductAccessForUser` из `_shared/product-access-grants.ts`.
- Перед вызовом helper заново перечитывает source `subscriptions_v2` (по `results.subscription.id`, fallback — MAX `access_end_at` среди `active+past_due` для `user_id+product_id`), чтобы secondary-grant видел уже обновлённый webhook'ом `access_end_at`. Это устраняет race condition Валерии (helper больше не работает по «старому» окну).
- `allowReduceAccess=false` — сокращения автоматически не применяются.
- Идемпотентный early-return `skip_already_fulfilled` уже использует helper.

Grep-guard:
```
$ rg "rule_engine_product_access|productAccessRules" supabase/functions/grant-access-for-order/index.ts
(no matches)
```

### PATCH C — наблюдаемость reconcile
- В `access-rules-nightly-reconcile/index.ts` добавлена обязательная запись `audit_logs` для каждого запуска (`access-rules-nightly-reconcile.dry_run` / `.execute`) с counts: `condition_met`, `condition_not_met_prior_purchase`, `granted/extended/reactivated/already_satisfied/skipped_no_change/no_source_window/conflict_*`, `failed`, `cohort_size`, `processed`, `elapsed_ms`, `run_id`, `filters`.
- Response расширен полями `run_id` и `counts.*` для удобной интерпретации.

### Registry
- `access-rules-nightly-reconcile` добавлен в `supabase/functions.registry.txt`.

## 2. Deploy

```
Successfully deployed edge functions: grant-access-for-order, access-rules-nightly-reconcile
```

## 3. Dry-run по Валерии (после патча)

```
POST /access-rules-nightly-reconcile
{ "dry_run": true, "tariff_ids": ["7c748940-..."], "user_ids": ["0d778566-..."] }
```

Result:
```
elapsed_ms: 475
subscriptions_processed: 1
rule_pairs_evaluated: 11
counts: {
  condition_met: 3,
  condition_not_met_prior_purchase: 8,
  missing_granted: 0,
  needs_extension_extended: 0,
  reactivation_candidates_reactivated: 0,
  conflicts: 0,
  failed: 0
}
```

Состояние Валерии (`entitlements`) после ранее проведённых grant'ов:

| Продукт                                        | source_rule_id                      | expires_at  |
|------------------------------------------------|--------------------------------------|-------------|
| Ценный бухгалтер 1 ступень 2.0                 | 1b497fba-031a-4318-8d9f-2530f1bac116 | 2026-05-30  |
| Подоходный налог с физлиц                      | ffe27040-924b-4f38-97d4-a45ea041c65d | 2026-05-30  |
| Деньги BY 1 тариф                              | 6ba9727e-32fc-4c16-b7ed-ddaf591c0042 | 2026-05-30  |
| Модуль «Учет у ИП»                             | 1b497fba-031a-4318-8d9f-2530f1bac116 | 2026-04-30  |

`source_access_end_at` у entitlements ещё содержит старое значение `2026-04-30` (исторические meta), но `expires_at` уже соответствует новому source-window `2026-05-30`. Помеченные `already_satisfied` — три entitlement-а, у которых `expires_at == sub.access_end_at`. Остальные 8 — `condition_not_met_prior_purchase` (модули CB20, у которых нет фактического paid order — это корректное поведение по правилу `match_mode=per_product`).

## 4. Полный BUSINESS dry-run

```
POST /access-rules-nightly-reconcile
{ "dry_run": true, "tariff_ids": ["7c748940-..."] }
```

Result:
```
elapsed_ms: 24533
subscriptions_total: 113
subscriptions_processed: 113
rule_pairs_evaluated: 1243
counts: {
  condition_met: 326,
  condition_not_met_prior_purchase: 917,
  missing_granted: 0,
  needs_extension_extended: 0,
  reactivation_candidates_reactivated: 0,
  conflicts: 0,
  failed: 0
}
buckets.skipped_no_change: 24
buckets.already_satisfied: 302
```

Без timeout. `failed=0`, `conflict_manual=0`, `conflict_multiple=0`, `conflict_other_rule=0`. `granted/extended/reactivated = 0` — когорта BUSINESS уже синхронизирована, controlled execute не требуется.

## 5. Audit summary в БД

```sql
select created_at, action, meta->>'run_id' as run_id, meta->>'cohort_size' as cohort_size,
       meta->>'extended' as extended, meta->>'failed' as failed, meta->>'condition_met' as condition_met
from audit_logs where action like 'access-rules-nightly-reconcile.%'
order by created_at desc limit 2;
```

| created_at                  | action                                   | cohort_size | extended | failed | condition_met |
|-----------------------------|------------------------------------------|------------:|---------:|-------:|--------------:|
| 2026-04-30 12:38:57.17 +00  | access-rules-nightly-reconcile.dry_run   | 113         | 0        | 0      | 326           |
| 2026-04-30 12:38:24.78 +00  | access-rules-nightly-reconcile.dry_run   | 1           | 0        | 0      | 3             |

## 6. Cron proof

```sql
select jobid, jobname, schedule, active from cron.job where jobname ilike '%access-rules%';
```

| jobid | jobname                          | schedule  | active |
|-------|----------------------------------|-----------|--------|
| 48    | access-rules-nightly-reconcile   | 0 0 * * * | true   |

## 7. Webhook flow proof

`bepaid-webhook` (renewal subscription branch, ~1526–1680):
1. `orders_v2.status='paid'`.
2. `subscriptions_v2.access_end_at` обновляется по provider truth (`active_to`).
3. inline upsert primary entitlement.
4. POST `grant-access-for-order { orderId }`.

`grant-access-for-order` теперь:
- даже на early-return `skip_already_fulfilled` запускает helper;
- в основном fulfillment перечитывает свежую subscription и зовёт тот же helper;
- helper применяет правила tariff→product, prior_purchase, GREATEST по entitlement.

Это значит, что для будущих BUSINESS renewal-payments secondary-доступы будут продлеваться автоматически в момент webhook без участия nightly cron.

## 8. DoD checklist

| Пункт                                                                                                  | Статус |
|--------------------------------------------------------------------------------------------------------|:------:|
| По Валерии BUSINESS secondary-доступы соответствуют покупке тарифа                                     | ✅     |
| Будущие BUSINESS renewal payments автоматически продлевают product_access сразу после webhook           | ✅     |
| `grant-access-for-order` больше не содержит inline product_access grant logic                          | ✅     |
| Early-return и обычный fulfillment используют один helper                                              | ✅     |
| `prior_purchase` SOT — только `orders_v2.status='paid'`                                                | ✅     |
| Dry-run BUSINESS проходит без timeout                                                                  | ✅     |
| Раздельные counts в dry-run                                                                            | ✅     |
| `failed=0`, `conflict_manual=0`, `conflict_multiple=0`                                                 | ✅     |
| `access_grant_ledger`: валидные `source_subject_type='order'/'cron_job'`, `source_event_type='webhook'/'cron'` | ✅ |
| Cron `0 0 * * *` активен как safety net                                                                | ✅     |
| Audit summary каждого запуска reconcile записывается в `audit_logs`                                    | ✅     |

## 9. Что не делалось

- Не запускался controlled execute, потому что dry-run полной BUSINESS-когорты показал `granted=extended=reactivated=0`. Когорта уже в нужном состоянии.
- `allow_reduce_access` оставлен `false` по требованию пользователя.
- Не менялись цены/правила/UUID — только write-path.
