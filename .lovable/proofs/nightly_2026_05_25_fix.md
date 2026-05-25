# PATCH-NIGHTLY-2026-05-25-FIX — Proof

Дата: 2026-05-25
Источник: ночная проверка nightly-system-health (3 of 8 invariants failed)

## Diagnose

| Invariant | Count | Корневая причина |
|---|---|---|
| INV-SITE-1 | 1 | Страница `969210bb` (form-proof), у form-блока отсутствовало поле `version` |
| INV-19B    | 1 | Подписка `a25168db` (Клуб): active+auto_renew+provider_managed, у user 2 активных bePaid PM, но нет `provider_subscriptions` |
| INV-20     | 2 | Rebill-orders `ecd989f1`, `c82ad679` без `payments_v2`. Платежи `c5c7dcd0`, `e1238eac` (соответствующие provider_payment_id) были висели на исходных подписочных чекаут-orders (`ea774d6c`, `c11a518d`) |

## Preflight INV-20 (все guards пройдены)

| Pair | ppi match | user match | product match | tariff match | refund=0 | reference_payment_id=null | rebill_empty | is_recurring | initial keeps own first payment |
|---|---|---|---|---|---|---|---|---|---|
| `c5c7dcd0` → `ecd989f1` | ✓ `97fb20f7…` | ✓ `16bc061d…` | ✓ `11c9f1b8…` | ✓ `7c748940…` | ✓ | ✓ | ✓ (0 rows) | ✓ | ✓ `d9b874db` (ppi `5ea7235e…`, 19.04) |
| `e1238eac` → `c82ad679` | ✓ `2071054f…` | ✓ `5c6e6e0f…` | ✓ `11c9f1b8…` | ✓ `7c748940…` | ✓ | ✓ | ✓ (0 rows) | ✓ | ✓ `f20b0224` (ppi `a0e5a15b…`, 17.02) |

## Execute

### INV-SITE-1 — выполнено
SQL DO-блок: добавлен `version: 1` form-блоку страницы `969210bb`, idempotent (только если version отсутствует, только type='form').
Audit: `sitepage_block_version_backfill` @ 2026-05-25 07:31:04 UTC.

**Verify:**
```sql
SELECT (blocks->0->>'version'), (blocks->0->>'type') FROM site_pages WHERE id='969210bb-…';
-- → v=1, t=form ✓
```

### INV-20 — выполнено
SQL DO-блок с per-pair guards (ppi/user/product/tariff/refund/reference/empty-rebill).
2 пары re-attached.
Audit: 2 × `inv20_repair_reattach_rebill_payment` @ 2026-05-25 07:31:18 UTC с before/after order_id.

**Verify:**
```sql
SELECT id, order_id FROM payments_v2 WHERE id IN ('c5c7dcd0…','e1238eac…');
-- c5c7dcd0 → ecd989f1 ✓
-- e1238eac → c82ad679 ✓
```

### INV-19B — требует UI-клика
Кандидат подтверждён preflight-запросом:
```
sub_id=a25168db, user=1409fd0e, status=active, auto_renew=true,
billing_type=provider_managed, ps_count=0, active_bepaid_pms=2
```
Edge `admin-bepaid-backfill` требует superadmin JWT. Из агентской сессии 401 (preview-session token не пробрасывается на этот function). Пользователь должен:
1. Открыть `/admin/subscriptions-v2`
2. Нажать «Запустить admin-bepaid-backfill»
3. Сначала dry-run (увидеть candidates_autorenew=1), затем execute.

После execute audit-row создаст сам edge.

## Root-cause fix `bepaid-webhook` (rebill payment binding)

**Discovery:** механизм уже реализован — `runRebillFlow` (`rebill_flow.ts`), `rebillOrderIdFromFlow`, STEP-E переадресует upsert payment на rebill-order (строки 1745, 2721, 2740 в `bepaid-webhook/index.ts`), есть post-check `bepaid.rebill.payment_rebind_post_check_failed`. Управляется kill-switch `BEPAID_REBILL_MATERIALIZATION` (`off`/`dry_run`/`on`).

Два сломанных orders от 18/19.05 — следствие того, что на тот момент kill-switch был `off` или `dry_run`. После включения `on` будущие rebills будут привязывать payment сразу к rebill-order, INV-20 регрессий не будет.

**Действие:** убедиться что секрет `BEPAID_REBILL_MATERIALIZATION=on` в Lovable Cloud (если ещё не выставлен). Дополнительных правок кода не требуется — машинерия и post-check уже на месте.

## Что НЕ трогали
- `subscriptions_v2`, `provider_subscriptions`, `orders_v2` (кроме `meta` не трогали; orders не трогали вообще)
- `entitlements`, `access_rules`, write-path `grant-access-for-order`
- RLS, cron, schema, INV-22 logic
- ContactDetailSheet (наш предыдущий патч сохраняется)
- `bepaid-webhook` код (механика rebill уже есть)
- Исходные orders НЕ помечены `inv20_legacy_noise` — у них сохранён собственный первый платёж

## Audit IDs
- `sitepage_block_version_backfill` 2026-05-25 07:31:04
- `inv20_repair_reattach_rebill_payment` × 2 @ 2026-05-25 07:31:18

## Regression DoD
После ручного выполнения INV-19B backfill:
1. Запустить из UI `/admin/system-health` «Запустить полный чек».
2. Ожидаемо: 8/8 OK, в том числе INV-19B passed (count=0), INV-20 actionable=0, INV-SITE-1 passed.
3. Следующий rebill (cron 09:00 Минск) при kill-switch=on должен сразу привязать payment к rebill-order — без всплеска INV-20.
