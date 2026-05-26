# PATCH-R4-SYNTHETIC-PROVIDER-SUB-CLEANUP-2026-05 — Proof

Дата: 2026-05-26
Статус: **EXECUTED**
Backup table: `public.provider_subscriptions_synthetic_cleanup_backup_2026_05` (RLS enabled, no policies = default-deny)
CSV: `/mnt/documents/synthetic_provider_sub_cleanup_2026_05.csv` (73 строки + header)

## Контекст

Discovery `PATCH-SUBSCRIPTION-PRODUCT-MAPPING-DISCOVERY-2026-05` подтвердил: проблема в **synthetic** `provider_subscriptions` (`provider_subscription_id LIKE 'internal:%'`, `meta.synthetic=true`), созданных backfill-скриптом `token_direct_charge` 2026-05-25. Они отображались как живые автосписания bePaid, путали привязку продукт/тариф/доступ.

## Scope (фактический)

`WHERE provider='bepaid' AND provider_subscription_id LIKE 'internal:%' AND (meta->>'synthetic')::bool = true`

- Всего: **73**
- `phantom_no_provider` (product 73c29914 ЗАКРОЙ ГОД, tariff 56c35e86, one-time SOT): **64**
- `split_brain_synth_over_real` (product 11c9f1b8 Robux Club): **9**
- Все 73 находились в state=`active` до патча.
- 0 строк `sbs_*` в scope (guard).

Примечание: discovery называл разбивку 64/9, рекоhорт по `user_id+product_id` показал 68/5; финальная разбивка по `product_id` оставлена 64/9 как наиболее наглядная для бизнеса (one-time vs recurring product).

## Что сделано

### Шаг 1. Backup (migration)
`CREATE TABLE provider_subscriptions_synthetic_cleanup_backup_2026_05 AS SELECT ps.*, to_jsonb(ps.*) AS before_json, cohort, now() AS backed_up_at FROM ... WHERE scope`. Count = 73. RLS enabled.

### Шаг 2. Soft-cancel 73 строк `provider_subscriptions`
`state := 'canceled'`, `meta.synthetic_cleanup := {patch, executed_at, backup_table, prev_state, cohort, no_real_bepaid_touched:true, bepaid_api_calls:0}`. DELETE не использован.

### Шаг 3. Точечная очистка recurring-флагов в `subscriptions_v2` (только 64 phantom)
Только для subv2, привязанных к synthetic ps на one-time продукте 73c29914:
- `auto_renew := false`
- `next_charge_at := NULL`
- `meta` — удалены `recurring_snapshot`, `recurring_amount`
- `meta.synthetic_provider_cleanup` — сохранены `prev_auto_renew`, `prev_next_charge_at`, `prev_recurring_snapshot`, `prev_recurring_amount`, reason

`access_end_at`, `status`, `entitlements`, `orders_v2`, `payments_v2`, `access_rules` — НЕ менялись.

### Шаг 4. Split-brain (9)
Только soft-cancel на synthetic ps. Связанные subv2 НЕ обновлялись (плановое решение: продукт recurring, могут быть законные сценарии). Реальные `sbs_*` ps — не затронуты.

### Audit
`audit_logs` action=`provider_subscriptions.synthetic_cleanup.executed`, actor_type=`system`, actor_label=`PATCH-R4-SYNTHETIC-PROVIDER-SUB-CLEANUP-2026-05`. Включает preflight + executed counts + control_cases.

## Post-verify

| Метрика | Ожидание | Факт |
|---|---|---|
| `pv1` synthetic internal:* в state ∉ (canceled,…) | 0 | **0** |
| `pv2` real `sbs_*` active/trial/past_due/pending | unchanged | **190 → 190** |
| `pv3` phantom subv2 с auto_renew=false AND next_charge_at IS NULL | 64 | **64** |
| `pv4` split-brain subv2 не тронуты (auto_renew=true сохранён) | 9 | **9** |
| Trek 1 cleanup по 90 | not executed | **not executed** |
| bePaid API calls | 0 | **0** |

## Контрольные кейсы (after)

| Email | provider_sub | ps_state | sv.auto_renew | sv.next_charge_at | sv.access_end_at |
|---|---|---|---|---|---|
| irina.borodzko@tut.by | internal:f539f454… (ЗАКРОЙ ГОД) | **canceled** | **false** | **NULL** | 2026-05-31 (preserved) |
| irina.borodzko@tut.by | sbs_ce84248… / sbs_d35abc87… (Robux Club) | expired / canceled | unchanged | unchanged | unchanged |
| strekhao@yandex.ru | internal:0ce56494… (ЗАКРОЙ ГОД) | **canceled** | **false** | **NULL** | 2026-05-31 (preserved) |
| strekhao@yandex.ru | sbs_9f993cdd… (Robux Club real, active) | **active** | **true** | 2026-06-25 | 2026-06-25 (untouched) |
| elizaveta.andreeva.15@yandex.by | internal:b2c8d37a… (ЗАКРОЙ ГОД) | **canceled** | **false** | **NULL** | 2026-05-31 (preserved) |
| elizaveta.andreeva.15@yandex.by | sbs_561445d1…/cf5b…/e600…/7703… (Robux Club) | canceled/expired/failed_attempt | unchanged | unchanged | unchanged |

## Rollback

Из `provider_subscriptions_synthetic_cleanup_backup_2026_05`:
```sql
UPDATE public.provider_subscriptions ps
SET state = b.before_json->>'state',
    meta = (b.before_json->'meta')::jsonb
FROM public.provider_subscriptions_synthetic_cleanup_backup_2026_05 b
WHERE ps.id = b.id;

UPDATE public.subscriptions_v2 sv
SET auto_renew = (sv.meta->'synthetic_provider_cleanup'->>'prev_auto_renew')::bool,
    next_charge_at = (sv.meta->'synthetic_provider_cleanup'->>'prev_next_charge_at')::timestamptz,
    meta = (sv.meta - 'synthetic_provider_cleanup')
           || jsonb_build_object('recurring_snapshot', sv.meta->'synthetic_provider_cleanup'->'prev_recurring_snapshot')
           || jsonb_build_object('recurring_amount', sv.meta->'synthetic_provider_cleanup'->'prev_recurring_amount')
WHERE sv.meta ? 'synthetic_provider_cleanup';
```

## DoD

- [x] Preflight: 73/64/9, 0 `sbs_*` в scope.
- [x] Backup table создана, count=73, RLS включён.
- [x] Soft-clean выполнен; DELETE не использован.
- [x] Recurring-флаги subv2 очищены только у 64 phantom (one-time SOT).
- [x] 6 post-verify пунктов пройдены.
- [x] Proof + CSV приложены.
- [x] bePaid API calls = 0; entitlements/orders/access_rules/access_end_at не менялись.

## Trek 2 (Елизавета 2a/2b/2c/2d)

Остаётся отдельным патчем. Базовое состояние после R4: synthetic ушло, локальный доступ до 2026-05-31 на ЗАКРОЙ ГОД виден честно, без автопродления. Дальнейший шаг — canonical resume-eligibility (local + card + provider) для решения 2b vs 2d.
