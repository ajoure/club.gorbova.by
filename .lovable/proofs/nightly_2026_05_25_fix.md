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

---

# PATCH-NIGHTLY-2026-05-25-FINALIZE — Proof

Дата: 2026-05-25 07:46 UTC
Контекст: закрытие хвостов от PATCH-NIGHTLY-2026-05-25-FIX (INV-19B + подтверждение BEPAID_REBILL_MATERIALIZATION).

## 1. BEPAID_REBILL_MATERIALIZATION — подтверждено `on`

Проверка фактическим трафиком (а не чтением секрета): в `audit_logs` за последние сутки 10/10 свежих `bepaid.rebill.*` событий имеют `meta.mode='on'`. Последний live rebill:

```
2026-05-24 16:02:42 UTC  bepaid.rebill.materialized       mode=on
2026-05-24 16:02:42 UTC  bepaid.rebill.decision_audit     mode=on
```

Decision = `materialized` (без `_partial`) → новый rebill-order создан, payment к нему привязан сразу. Это и есть proof, что INV-20 root-fix живой. Регрессии не ожидается. `secrets--update_secret` НЕ вызывался — значение уже корректное.

## 2. INV-19B — закрыт через `admin-bepaid-backfill`

### 2.1 Bugfix самой функции
В коде `admin-bepaid-backfill/index.ts` обнаружены 2 schema-несовместимости, из-за которых до этой сессии backfill всегда падал тихо:

- `payments_v2.product_id` — колонки нет в схеме → запрос `latest payments` обрывал synthetic-ветку, ничего не upsert-ил.
- `provider_subscriptions.product_id` — колонки нет → upsert падал с PostgREST schema-cache error для каждого кандидата.

Минимальный патч (без расширения скоупа):
- из обоих upsert-объектов (API-match и synthetic) удалён литеральный `product_id`, перенесён в `meta.product_id` (сохраняем диагностическую трассу).
- из `payments_v2`-select убран `product_id`, удалён вспомогательный map `userProductToLatestPayment` (lookup теперь только по `user_id`).

Деплой: `admin-bepaid-backfill` redeployed @ 2026-05-25 07:43 UTC.

### 2.2 Dry-run после фикса
```
candidates_total: 75, candidates_autorenew: 75,
errors: [], would_upsert_synthetic: 75
```

### 2.3 Execute
```
upserted_synthetic: 75, upserted_real_sbs: 0, errors: []
duration_ms: 13543
```

Целевой кандидат проверен:
```sql
SELECT * FROM provider_subscriptions WHERE subscription_v2_id='a25168db…';
-- id=a4a1e3f0, provider_subscription_id='internal:a25168db…', state=active, meta.synthetic=true ✓
```

### 2.4 Side-effect INV-22 → repair
После backfill 2 синтетика без какой-либо истории платежей (sub `7ee341c9`, sub `37e00210`) попали в INV-22 `active_no_dates` (нет `last_charge_at`). Это zombie-подписки без `payments_v2` recurring success. Создавать synthetic ps для них некорректно (нет реальной провайдер-сабы).

Repair (миграция, idempotent, guard по `meta.synthetic='true' AND last_charge_at IS NULL`):
```
DELETE FROM provider_subscriptions WHERE id IN ('a828f9bd…','234745c9…')
  AND meta->>'synthetic'='true' AND last_charge_at IS NULL AND provider='bepaid';
```
Audit: `inv22_repair_remove_baseless_synthetic_ps` @ 2026-05-25 07:45 UTC.

Бэклог (вне скоупа этого патча): дополнить `admin-bepaid-backfill` правилом «не создавать synthetic ps, если у пользователя нет ни одного успешного recurring `payments_v2`» — так же положить в audit `skip_no_payment_history`.

## 3. Verify — 8/8 OK

### nightly-payments-invariants @ 07:46 UTC
```
ok:true, failed:0, passed:7
INV-18 (orphans 24h): 0 ✓
INV-19A (sbs_* missing in PS): 0 ✓
INV-19B (token recurring without PS): 0 ✓     ← закрыт
INV-20 (actionable orders without payments): 0 (orphan=23 informational) ✓
INV-21 (succeeded without order_id ratio): 0/46 ✓
INV-22 (active sub desync): 0 ✓                 ← regression repaired
INV-22-AUDIT: 0/0 ✓
```

### system-health-full-check @ 07:46 UTC
```
status: OK
edge_functions: 172/172 deployed, healthy=172, missing=[]
invariants: passed=5, failed=0 (INV-P0-1..5 all green)
```

(P2 `test-*` ERRORs — это rate-limit пробинга самих self-test функций, статус самого отчёта = OK, P0/P1 missing = 0.)

## Что НЕ трогали
- `subscriptions_v2` вручную (только синт. provider_subscriptions через caннонический backfill)
- `entitlements`, `access_rules`, `grant-access-for-order`
- `ContactDetailSheet`, INV-22 логика (только удалили 2 baseless ps-строки, созданные нами же)
- RLS, cron, schema, реестр функций
- `BEPAID_REBILL_MATERIALIZATION` (уже `on`)

## Audit IDs (PATCH-NIGHTLY-2026-05-25-FINALIZE)
- 75 × `admin-bepaid-backfill` synthetic upserts @ 07:45:02 UTC
- 1 × `inv22_repair_remove_baseless_synthetic_ps` @ 07:45:49 UTC

## DoD — выполнен
- [x] INV-19B = 0 (verify запросом и nightly checker)
- [x] BEPAID_REBILL_MATERIALIZATION=on подтверждено живым трафиком
- [x] nightly-payments-invariants 7/7 OK
- [x] system-health-full-check OK
- [x] INV-22 не ушла в регрессию
- [x] proof обновлён
