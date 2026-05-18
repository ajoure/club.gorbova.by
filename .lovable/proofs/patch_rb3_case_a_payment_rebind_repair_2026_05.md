# PATCH-RB3 — financial repair Case A (live-fail of PATCH-RB1.1 runtime watch)

## Контекст

Live REBILL 2026-05-17 18:01:10 UTC через subscription webhook:
- parent_order: `91b98bf3-282a-4ef0-854d-f71a86577139` (SUB-26-MMWC6988TBML)
- REBILL-order: `06f22ceb-9792-464e-adfb-d15519352d21` (REBILL-111dfc17-80c)
- payment: `f2892a00-5731-4adb-97d8-ff8d3472f953`
- provider_payment_id: `111dfc17-80c2-477c-8ecd-9b768744e8b7`
- sbs: `sbs_e1f92ff0e3fa4bff`
- amount: 250.00 BYN

REBILL-order создан корректно (status=paid, base_price=250.00). Grant отработал — доступ продлён каноническим writer'ом до `2026-06-17 12:00:00Z` (`primary_entitlement_verified=true`). НО payment остался привязан к parent — это последствие бага STEP E (см. PATCH-RB1.2).

## Scope (одобрено)

Только financial repair:
- UPDATE `payments_v2.f2892a00….order_id` с `91b98bf3…` → `06f22ceb…`;
- `grant-access-for-order` НЕ вызывать (доступ уже на месте);
- `subscriptions_v2` / `entitlements` / `access_rules` / `telegram_*` НЕ трогать;
- provider API НЕ вызывать.

## Что выполнено

Миграция (DO-блок с pre/post asserts):

1. Pre-check: payment row найден, `order_id = 91b98bf3` (parent), уид совпадает.
2. Проверка REBILL-order: существует с `order_number='REBILL-111dfc17-80c'`, `status='paid'`, `base_price=250.00`.
3. UPDATE `payments_v2.order_id = 06f22ceb…`, плюс merge `meta.patch_rb3_rebind` с from/to/reason/at.
4. `GET DIAGNOSTICS ROW_COUNT` = 1 (обязательно).
5. Post-check: `payment.order_id = 06f22ceb…`.
6. INSERT в `audit_logs`: action `bepaid.rebill.payment_rebind_repaired`, actor_label=`patch_rb3`, meta содержит все идентификаторы и `grant_invoked=false`, `access_unchanged_until='2026-06-17T12:00:00Z'`.

## Verify (post-state, фактический snapshot)

| поле | значение |
|---|---|
| `payments_v2.f2892a00….order_id` | `06f22ceb-9792-464e-adfb-d15519352d21` ✅ |
| `payments_v2.f2892a00….meta.patch_rb3_rebind.from_order_id` | `91b98bf3-…` |
| `payments_v2.f2892a00….meta.patch_rb3_rebind.to_order_id` | `06f22ceb-…` |
| `payments_v2.f2892a00….meta.patch_rb3_rebind.reason` | `rb1_1_legacy_step_e_overwrote_to_parent` |
| `payments_v2.f2892a00….meta.patch_rb3_rebind.at` | `2026-05-18T07:43:46.462Z` |
| Доступ клиента (entitlement `d18e0813…`) | не менялся, `expires_at=2026-06-17 12:00Z` |
| Subscription `572175f0…` | не менялся |

## Что НЕ делалось

- 0 вызовов `grant-access-for-order`;
- 0 правок `subscriptions_v2`/`entitlements`/`access_rules`/`telegram_*`/`payment_methods`;
- 0 secrets / mode changes;
- 0 правок edge-функций;
- 0 provider API calls;
- 0 других платежей не тронуто.

## Audit follow-up

- `bepaid.rebill.payment_rebind_repaired` × 1 с actor_label=`patch_rb3`, case_label=`case_a_live_fail_runtime_watch`.

## Rollback (если потребуется)

```sql
UPDATE payments_v2
SET order_id = '91b98bf3-282a-4ef0-854d-f71a86577139',
    meta = meta - 'patch_rb3_rebind'
WHERE id = 'f2892a00-5731-4adb-97d8-ff8d3472f953';
```

Доступ НЕ трогать (он корректен от первого grant).

## Итог

Case A полностью устранён: финансовая привязка платежа исправлена, доступ остался канонически продлён.
