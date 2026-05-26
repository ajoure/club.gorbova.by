# План: PATCH-R4-SYNTHETIC-PROVIDER-SUB-CLEANUP-2026-05

## Контекст и принятие discovery

Отчёт discovery принят. Ключевой вывод:

Проблема не в UI и не в реальных bePaid-подписках, а в **synthetic `provider_subscriptions`**, созданных backfill-скриптом `token_direct_charge` 2026-05-25.

- **183 OK_real_linked** (real `sbs_*`) — НЕ трогать, bePaid API НЕ вызывать.
- **64 E_phantom_no_provider** — synthetic `internal:%` по ЗАКРОЙ ГОД (one-time продукт).
- **9 F_split_brain_synth_over_real** — synthetic `internal:%` поверх пользователей, у которых уже есть реальный активный bePaid `sbs_*`.
- **Scope R4 = 73 synthetic wrappers**.

Старая идея "Trek 1 cleanup 90 строк" отменяется. Новый cleanup строго synthetic-only:
`provider_subscription_id LIKE 'internal:%' AND meta.synthetic = true`.

## Цель

Убрать только синтетические `provider_subscriptions`, созданные backfill 2026-05-25, чтобы они не отображались как реальные bePaid-автосписания и не путали привязку продукт/тариф/доступ.

## Scope (ровно 73 строки)

```text
WHERE provider = 'bepaid'
  AND provider_subscription_id LIKE 'internal:%'
  AND (meta->>'synthetic')::boolean = true
  AND (meta->>'source' = 'token_direct_charge'
       OR (meta->>'batch') LIKE '%2026-05-25%'
       OR created_at::date = '2026-05-25')
```

Разбивка:
- 64 × E_phantom_no_provider (нет реального `sbs_*` у юзера на этот продукт).
- 9 × F_split_brain_synth_over_real (есть реальный active `sbs_*` рядом).

## Запрещено

- Не трогать `provider_subscriptions` с `sbs_*` (реальные bePaid).
- Не вызывать bePaid API (cancel/list/get) — 0 внешних вызовов.
- Не менять `entitlements` (никаких access_end_at/status/meta).
- Не менять `orders_v2` / `payments_v2`.
- Не менять `access_rules`.
- Не менять `access_end_at` / `status` реальных `subscriptions_v2`.
- Не удалять историю без backup.

## Preflight (read-only, до execute)

1. Подтвердить ровно **73** synthetic-строки по фильтру выше.
2. Подтвердить **0** строк с `sbs_*` в scope (anti-join guard).
3. Подтвердить, что у всех 73 одновременно `internal:%` И `meta.synthetic=true`.
4. Разделить когорты: 64 phantom_no_provider vs 9 split_brain_synth_over_real (по наличию параллельного real `sbs_*` у того же `user_id` + `product_id`).
5. Для 9 split-brain — подтвердить, что реальный active `sbs_*` существует и НЕ попадёт в обновление.
6. Контрольные кейсы:
   - **Ирина Гайдук** (`irina.borodzko@tut.by`) — synthetic ЗАКРОЙ ГОД должен пропасть из "Подписки"; реальные CHAT сделки/платежи не затронуты.
   - **Ольга Дещеня** (`strekhao@yandex.ru`) — real BUSINESS остаётся; "не продлевается" не должно возникать после cleanup.
   - **Елизавета Андреева** (`elizaveta.andreeva.15@yandex.by`) — synthetic active-state исчезает; локальный доступ до 05.06.2026 НЕ уменьшается.

Если хотя бы одна цифра расходится (не 73 / есть `sbs_*` в scope / нет `meta.synthetic=true`) — STOP, manual_review.

## Execute (порядок строго)

### Шаг 1. Backup snapshot

Создать таблицу `provider_subscriptions_synthetic_cleanup_backup_2026_05` с полным before-JSON по 73 строкам:

```sql
CREATE TABLE public.provider_subscriptions_synthetic_cleanup_backup_2026_05 AS
SELECT ps.*, to_jsonb(ps.*) AS before_json, now() AS backed_up_at
FROM public.provider_subscriptions ps
WHERE <scope filter>;
```

Подтвердить `count = 73`.

### Шаг 2. Soft-clean `provider_subscriptions` (предпочтительно)

Если enum `provider_subscription_state` допускает — перевести в `canceled` (или ближайший terminal), пометить `meta.synthetic_cleanup`. DELETE — только если soft-clean невозможен и FK позволяют; и только после backup, и только для `internal:% + synthetic=true`.

```sql
UPDATE public.provider_subscriptions
SET state = 'canceled',
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'synthetic_cleanup', jsonb_build_object(
        'patch', 'PATCH-R4-SYNTHETIC-PROVIDER-SUB-CLEANUP-2026-05',
        'executed_at', now(),
        'backup_table', 'provider_subscriptions_synthetic_cleanup_backup_2026_05',
        'cohort', <'phantom_no_provider'|'split_brain_synth_over_real'>
      ))
WHERE <scope filter>;
```

### Шаг 3. Очистка фантомных recurring-флагов в `subscriptions_v2` (точечно)

ТОЛЬКО для связанных `subscriptions_v2`, у которых:
- `auto_renew=true` пришло из synthetic provider_sub;
- НЕТ параллельного real `sbs_*` provider_subscription;
- продукт — one-time по SOT (`tariff_offers.meta.recurring.is_recurring` IS NULL/false).

```sql
UPDATE public.subscriptions_v2 sv
SET auto_renew = false,
    next_charge_at = NULL,
    meta = (COALESCE(meta, '{}'::jsonb) - 'recurring_snapshot' - 'recurring_amount')
           || jsonb_build_object(
             'synthetic_provider_cleanup_ref', 'PATCH-R4-2026-05',
             'prev_auto_renew', true,
             'prev_next_charge_at', next_charge_at
           )
WHERE sv.id IN (<subset из backup, прошедший все 3 условия>);
```

`access_end_at`, `status`, `entitlements` НЕ меняются. `payment_token` НЕ трогаем в этом patch.

### Шаг 4. Split-brain (9 строк)

Действия идентичны Шагам 2–3, но строго на synthetic-строке. Реальный `sbs_*` `provider_subscription` остаётся нетронутым; его `subscriptions_v2` не обновляется (там auto_renew законный).

## Audit

Записи в `audit_logs`:
- `provider_subscriptions.synthetic_cleanup.preflight` — counts (73 / 64 / 9), 0 real `sbs_*` в scope.
- `provider_subscriptions.synthetic_cleanup.executed` — counts, `backup_table`, `no_real_bepaid_touched=true`, `bepaid_api_calls=0`.
- `subscriptions_v2.recurring_flags_cleanup` — список затронутых `subscription_id`, prev/new значения.

## Post-verify

1. `SELECT count(*) FROM provider_subscriptions WHERE provider_subscription_id LIKE 'internal:%' AND (meta->>'synthetic')::bool = true AND state NOT IN ('canceled','synthetic_removed')` → **0**.
2. `SELECT count(*) FROM provider_subscriptions WHERE provider_subscription_id LIKE 'sbs_%' AND state IN ('active','trial','past_due','pending')` → **unchanged (183)**.
3. Ирина: ЗАКРОЙ ГОД исчез из "Подписки"; CHAT сделки/платежи на месте.
4. Ольга: BUSINESS real subscription активна; нет "не продлевается" из-за synthetic.
5. Елизавета: synthetic active-state исчез; доступ до 05.06.2026 сохранён.
6. Trek 1 cleanup по 90 строкам — не запускался.
7. bePaid API calls во время патча = **0** (проверить логи edge functions).
8. `nightly-system-health` / `nightly-payments-invariants` после cleanup — synthetic `internal:%` больше не отображается как live provider.

## Rollback

Из `provider_subscriptions_synthetic_cleanup_backup_2026_05.before_json` восстановить state/meta по `id`. Для `subscriptions_v2` — восстановить `auto_renew`, `next_charge_at`, `meta.recurring_snapshot` из `meta.prev_*` полей.

## Артефакты

- Proof: `.lovable/proofs/synthetic_provider_sub_cleanup_2026_05.md` — preflight counts, executed counts, backup table name, control cases before/after, audit IDs.
- CSV: `/mnt/documents/synthetic_provider_sub_cleanup_2026_05.csv` — 73 строки: `provider_sub_id`, `user_id`, `product_id`, `tariff_id`, `cohort`, `subscription_v2_id`, `before_state`, `after_state`, `subv2_auto_renew_cleaned`.

## Trek 2 (Елизавета 2a/2b/2c/2d)

Остаётся отдельным патчем после R4. Предварительно — 2d (provider dead → UI показывает честное состояние, доступ до 05.06.2026, без автопродления, CTA "оформить новую подписку"). 2b — только если canonical resume-eligibility (local + card + provider) пройдёт целиком.

## DoD

- Preflight 73 / 64 / 9 / 0 real в scope — подтверждено.
- Backup table создана, count=73.
- Soft-clean выполнен; DELETE не использовался (или применён только при невозможности soft-clean и оформлен в audit).
- Recurring-флаги subv2 очищены только у строк без real `sbs_*` на one-time продукте.
- 8 post-verify пунктов пройдены.
- Proof + CSV приложены.
- bePaid API calls = 0; entitlements/orders/access_rules/access_end_at не менялись.
