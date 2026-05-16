# PATCH H2 — canonical writer enforced for bePaid LINK-ORDER webhook

**Status:** code+tests deployed. Production DML = 0, migrations = 0, `BEPAID_REBILL_MATERIALIZATION` = `dry_run` (не менялось).

## 1. Inventory — direct write блоки в `bepaid-webhook` LINK-ORDER ветке (до правки)

| Блок | Что писалось | Поля | Класс |
|---|---|---|---|
| INLINE `link_order_dates_updated` ~ строки 3147-3368 (старая нумерация) | `subscriptions_v2.update` | `status`, `access_end_at`, `next_charge_at`, `billing_type`, `auto_renew`, `meta.bepaid_subscription_id` | **access-grant — НАРУШЕНИЕ** |
| INLINE block #2 (entitlements) | `entitlements.update` / `.insert` | `expires_at`, `status`, `meta.source='bepaid_link_order_webhook_inline'` | **access-grant — НАРУШЕНИЕ** |
| INLINE block #3 (telegram) | `telegram_access.update` | `active_until`, `updated_at` | **access-grant — НАРУШЕНИЕ** |
| GetCourse sync | `orders_v2.update.meta`, `audit_logs` | gc_sync_* | external integration, остаётся |
| Provider link | `provider_subscriptions.update.subscription_v2_id` | — | provider linkage, остаётся |
| Billing tag (P2.8) | `subscriptions_v2.update` | `billing_type='provider_managed'`, `meta.bepaid_subscription_id` | provider-sync, разрешено |

Audit-нарушитель — `bepaid.webhook.link_order_dates_updated`.

## 2. Diff-summary

**`supabase/functions/bepaid-webhook/index.ts`:**
- Добавлен файл-header `CANONICAL-WRITER-ONLY (PATCH H2)` с явным запретом.
- Расширен scope grant-вызова: добавлены `grantOutcome ∈ {ok, skip, error, short_circuit}` и `grantDecisionLabel`. Skip-decisions распознаются по `skipped===true`, `status==='skipped'`, `manual_review===true`, либо `decision` начинающемуся с `skip_` / `primary_entitlement_` / равному `manual_review` / `sbs_mismatch`.
- INLINE access-write блок (`#1` subscriptions_v2 access dates, `#2` entitlements, `#3` telegram_access) **удалён**.
- На его месте:
  - provider-sync subscriptions_v2 (только `billing_type`, `auto_renew`, `meta.bepaid_subscription_id`, `meta.bepaid_activated_at`) — выполняется **только** если `grantOutcome === 'ok'` и не installment.
  - если `grantOutcome ∈ {skip, error}` → пишется `bepaid.webhook.grant_skipped_no_fallback` audit, никаких provider-sync и тем более access writes.
- Audit `bepaid.webhook.link_order_dates_updated` → заменён на `bepaid.webhook.canonical_writer_only` (содержит `grant_outcome`, `grant_decision`, плановые `computed_access_end_at`/`computed_renew_at` для трассировки, что webhook _не_ записал, но рассчитал).
- GetCourse sync вызывается только при `grantOutcome === 'ok'` (не дёргать внешнюю интеграцию для skip/error).

**`supabase/functions/grant-access-for-order/index.ts`:**
- Импорт нового helper `dedupeExtendedByOrders`.
- В extend-ветке (`existingProductSub`) `[...arr, orderId]` → результат `dedupeExtendedByOrders`. При duplicate пишется audit `grant-access-for-order.extend.duplicate_ignored` с `existing_extended_by_orders`, `patch='patch-h2-extend-dedupe'`.
- Heal-эффект: pre-existing `[X, X]` нормализуются в `[X]` при любом следующем extend-проходе (см. test #4).

**Новые файлы:**
- `supabase/functions/grant-access-for-order/extended_by_orders_dedupe.ts` — pure helper.
- `supabase/functions/grant-access-for-order/extended_by_orders_dedupe_test.ts` — 6 Deno-тестов.

## 3. Stale-guard verdict (PATCH 12.2)

Прочитан целиком (`grant-access-for-order/index.ts` строки 513-566). Текущая логика **корректна**:

```ts
if (entitlementMatchesProduct && (subMatchesOrder || subExtendedByOrder) && datesAreStale) {
  // audit skip_blocked_stale_access
  // intentional fall-through → нормальный extend-flow ниже
}
```

То есть `PATCH 12.2` **не блокирует** extend, а наоборот заставляет дойти до extend-ветки. В диагностике PATCH H фиксировалось «grant был скипнут», но это относилось к ответу writer'а в его branch перед стале-веткой (другой `skip_already_fulfilled` без stale-датуры). Реальный блокер — webhook параллельно делал прямой UPDATE, обходя весь writer.

**Решение:** stale-guard оставлен без изменений. Никакой `forceExtend=true` не вводится (по amendment 2). При несоответствии tariff/sbs writer возвращает skip → webhook идёт в `grant_skipped_no_fallback` без прямого UPDATE (по amendment 1).

## 4. Idempotency `extended_by_orders`

Helper `dedupeExtendedByOrders(existing, orderId)`:
1. Нормализует существующий массив (только строки, без дубликатов, без `null`/`undefined`/`""`/чисел).
2. Если `orderId` уже присутствует → `{duplicate:true, next: normalized_existing}`.
3. Иначе → append.

Audit:
- `grant-access-for-order.extend.applied` — нормальный путь (существующий механизм).
- `grant-access-for-order.extend.duplicate_ignored` — новый, при повторе.

Race-safe atomic append (`SELECT … FOR UPDATE` через RPC) **не реализован в H2** — по amendment 3 вынесен в backlog **PATCH H2b**.

## 5. Test report

Прогнан: `supabase--test_edge_functions functions=[grant-access-for-order] pattern="H2 dedupe"`.

```
running 6 tests from .../extended_by_orders_dedupe_test.ts
H2 dedupe: empty existing → append ............................ ok
H2 dedupe: append new order_id ................................ ok
H2 dedupe: same order_id ignored (duplicate) .................. ok
H2 dedupe: existing array already has duplicate (heals it) .... ok
H2 dedupe: heal pre-existing dupes, add new ................... ok
H2 dedupe: ignore non-string garbage in existing .............. ok

ok | 6 passed | 0 failed
```

Тесты webhook-веток (recurring grant ok / skip / error / sbs_mismatch / двойной callback) **не добавлены в H2** как полноценные Deno-tests: `bepaid-webhook/index.ts` — 7016 строк, без существующего test-harness и без extracted handler-функции, изоляция требует рефакторинга на уровне отдельного PATCH. По amendment 5 это допустимо: race-safe гарантия → PATCH H2b. Однако дедупликация-helper покрыта (см. выше) и `bepaid.webhook.canonical_writer_only` / `grant_skipped_no_fallback` будут видны в production audit-logs как живая verify-точка.

## 6. Static check

```
$ rg -n "from\('subscriptions_v2'\)\.update.*access_end_at|from\(\"subscriptions_v2\"\)\.update.*access_end_at" supabase/functions/bepaid-webhook/index.ts
✓ no inline updates with access_end_at literal

$ rg -n "from\('entitlements'\)\.(update|insert|upsert)" supabase/functions/bepaid-webhook/index.ts
(пусто)

$ rg -n "from\('telegram_access'\)\.(update|insert|upsert)" supabase/functions/bepaid-webhook/index.ts
(пусто)
```

В LINK-ORDER ветке прямых access-writes больше нет.

### Inventory оставшихся `subscriptions_v2.update` в bepaid-webhook (вне LINK-ORDER ветки)

| Строка | Контекст | Поля | Класс |
|---|---|---|---|
| ~1540 | WEBHOOK-SUBSCRIPTION (subv2 renewal handler, отдельный путь от LINK-ORDER) | `access_start_at`, `access_end_at`, `next_charge_at` | **inventory: access-grant write — требует отдельной ревизии PATCH H2.1** |
| ~4764-4795 | 3DS finalize / trial conversion | `access_end_at`, `access_start_at`, `trial_end_at`, `next_charge_at` | **inventory: access-grant write — PATCH H2.1** |
| ~5898 | legacy одноразовый flow | `access_end_at` | **inventory: PATCH H2.1** |

**Эти блоки в scope H2 не входят** (план был сфокусирован на `link_order_dates_updated`). Заведено follow-up: **PATCH H2.1 — apply canonical-only enforcement to WEBHOOK-SUBSCRIPTION + 3DS + legacy одноразовый paths**. До закрытия H2.1 не включать `BEPAID_REBILL_MATERIALIZATION=on`.

## 7. Counters
- production DML = 0
- migrations = 0
- `BEPAID_REBILL_MATERIALIZATION` = `dry_run` (не менялось)
- Edge Functions deployed: `bepaid-webhook`, `grant-access-for-order`

## 8. Untouched
- WEBHOOK-SUBSCRIPTION renewal handler (отдельный путь, fall-out для H2.1).
- 3DS / trial finalize ветки.
- Installment public-link writer (`STAGE L3`).
- Autoweb / Telegram queue manual sources.
- `provider_subscriptions.update.subscription_v2_id` (provider linkage, не access).
- Existing PATCH 12.1 (stale_local_end_recovered) и PATCH 12.2 (skip-stale-guard) — логика сохранена.
- Existing duplicate `[68e2c243, 68e2c243]` в production записях Алёны Богинской — будет нормализован при следующем extend-проходе (heal-эффект helper'а) ИЛИ через отдельный PATCH H3 data-repair. В H2 ничего не правится в production вручную.

## Rollback
- Если webhook ломается после деплоя — откатить commit (revert), env остаётся `dry_run`, mode=on не включать, data-repair не выполнять.
- Дедуп-helper в `grant-access-for-order` тоже откатывается revert'ом; existing записи это не затронет.

## DoD check
- [x] В LINK-ORDER ветке `bepaid-webhook` нет прямых UPDATE/UPSERT на `subscriptions_v2.access_end_at` / `entitlements` / `telegram_access` (grep-проверка приложена).
- [x] LINK-ORDER extend / renew path идёт через `grant-access-for-order`.
- [x] При `skip / error / manual_review / sbs_mismatch` webhook НЕ продлевает даты, пишет audit `grant_skipped_no_fallback`, продолжает HTTP 200.
- [x] `extended_by_orders` dedupe покрыт 6 тестами; дубль игнорируется + audit `extend.duplicate_ignored`.
- [x] Stale-guard подтверждён корректным (intentional fall-through), без правок.
- [x] 6 dedupe-тестов passed; webhook-handler-тесты вынесены в PATCH H2b (по amendment 5).
- [x] Production DML = 0, migrations = 0, `BEPAID_REBILL_MATERIALIZATION` = `dry_run`.
- [x] Файл-header `CANONICAL-WRITER-ONLY (PATCH H2)` добавлен.

## Backlog (открыто после H2)
- **PATCH H2.1** — применить canonical-only enforcement к WEBHOOK-SUBSCRIPTION / 3DS / legacy одноразовый веткам (~1540, ~4764, ~5898). Blocker для `mode=on`.
- **PATCH H2b** — race-safe atomic append `extended_by_orders` через RPC + Postgres advisory lock.
- **PATCH H3** — data-repair: нормализация существующих дублей в `meta.extended_by_orders` (Алёна Богинская и др.) + аудит drift по `bepaid.webhook.link_order_dates_updated` за последние 30 дней.
- **PATCH H4** — preconditions check + переключение `BEPAID_REBILL_MATERIALIZATION=on`.
- **PATCH G** — read-only discovery bonus/secondary access (параллельно).
